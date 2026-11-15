'use strict';
/* =====================================================================
   RONDE 13 — Pembayaran hybrid (QRIS otomatis via payment gateway
   + QRIS manual) pada aplikasi tata tertib.

   Jalankan: node dev-tests/round13.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-r13-' + Date.now() + '.sqlite');
const PORT = 5590 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let KODE = '';
let KODE2 = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  let body = null;
  try { body = ct.includes('json') ? await r.json() : await r.text(); } catch (e) { body = null; }
  return { status: r.status, body };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, APP_TIMEZONE: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2000));

  try {
    KODE = (((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0]) || {}).kode || '';

    console.log('\n== 1. PENGATURAN METODE DI PANEL SUPER ADMIN ==');
    let r = await req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('login Super Admin', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/super/qris');
    ok('konfigurasi pembayaran terbaca', r.status === 200 && !!r.body.pay, JSON.stringify(r.body).slice(0, 120));
    ok('QRIS manual aktif secara bawaan', r.body.pay.manual_aktif === true);
    ok('QRIS otomatis nonaktif secara bawaan', r.body.pay.gateway_aktif === false);
    ok('daftar provider tersedia (midtrans/duitku/xendit/sandbox)',
      ['midtrans', 'duitku', 'xendit', 'sandbox'].every(k => (r.body.pay.providers || []).some(p => p.key === k)));
    ok('URL callback otomatis tersedia', /\/api\/pay\/callback$/.test(r.body.pay.callback_url || ''), r.body.pay.callback_url);
    ok('kredensial tidak dibocorkan (hanya penanda terisi)', r.body.pay.key === undefined);

    r = await req('/api/super/qris', {
      method: 'POST',
      body: { pay: { gateway_aktif: true, manual_aktif: true, provider: 'sandbox', mode: 'sandbox', expire_menit: 45, key: 'uji-kunci' } }
    });
    ok('simpan sakelar metode pembayaran', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/super/qris');
    ok('QRIS otomatis kini aktif', r.body.pay.gateway_aktif === true);
    ok('QRIS manual tetap aktif (berdampingan)', r.body.pay.manual_aktif === true);
    ok('provider & kedaluwarsa tersimpan', r.body.pay.provider === 'sandbox' && r.body.pay.expire_menit === 45);
    ok('kunci gateway tercatat terisi (tanpa menampilkan nilainya)', r.body.pay.key_set === true);

    r = await req('/api/super/qris', { method: 'POST', body: { pay: { gateway_aktif: false, manual_aktif: false, provider: 'sandbox' } } });
    r = await req('/api/super/qris');
    ok('kedua metode dimatikan → QRIS manual otomatis dipaksa aktif', r.body.pay.manual_aktif === true && r.body.pay.gateway_aktif === false);
    /* kembalikan: keduanya aktif */
    await req('/api/super/qris', { method: 'POST', body: { pay: { gateway_aktif: true, manual_aktif: true, provider: 'sandbox', mode: 'sandbox' } } });

    console.log('\n== 2. HALAMAN PERPANJANGAN SEKOLAH (tenant berbayar) ==');
    /* sekolah utama berstatus Lifetime → buat tenant berbayar untuk menguji perpanjangan */
    r = await req('/api/super/sekolah/simpan', {
      method: 'POST',
      body: { nama: 'SMK Uji Pembayaran', jenjang: 'SMK', admin_username: 'adminuji', admin_password: 'ujipass123', paket: 'basic' }
    });
    ok('tenant berbayar dibuat', r.status === 200 && r.body.tenant && r.body.tenant.kode, JSON.stringify(r.body).slice(0, 160));
    KODE2 = r.body.tenant.kode;
    cookie = '';
    r = await req('/api/login', { method: 'POST', body: { kode: KODE2, username: 'adminuji', password: 'ujipass123' } });
    ok('login admin sekolah berbayar', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/langganan');
    ok('info langganan menyertakan konfigurasi pembayaran', r.status === 200 && !!r.body.pay);
    ok('kedua metode tampil berdampingan', r.body.pay.gateway_aktif === true && r.body.pay.manual_aktif === true);
    ok('label provider dikirim', typeof r.body.pay.provider_label === 'string' && r.body.pay.provider_label.length > 2);

    const aktifSebelum = r.body.tenant.aktif_sampai;

    console.log('\n== 3. QRIS OTOMATIS (PAYMENT GATEWAY) ==');
    r = await req('/api/langganan/bayar', { method: 'POST', body: { paket: r.body.tenant.paket, bulan: 1, metode: 'gateway' } });
    ok('tagihan QRIS dinamis dibuat', r.status === 200 && r.body.mode === 'gateway', JSON.stringify(r.body).slice(0, 180));
    const py = r.body.pembayaran;
    ok('order id gateway terbentuk', /^TT-\d+-/.test(py.order_id || ''), py.order_id);
    ok('status awal menunggu verifikasi', py.status === 'menunggu');
    ok('channel = gateway', py.channel === 'gateway');
    ok('QR string tersedia (mode simulasi)', String(py.qr_string || '').startsWith('SIMULASI-QRIS'));
    ok('kedaluwarsa QRIS tercatat', !!py.expires_at);

    r = await req('/api/langganan/gateway/status?order=' + encodeURIComponent(py.order_id));
    ok('polling status → belum lunas', r.status === 200 && r.body.paid === false, JSON.stringify(r.body).slice(0, 140));

    r = await req('/api/langganan/gateway/status?order=TT-0-PALSU');
    ok('order tidak dikenal → 404', r.status === 404);

    r = await req('/api/langganan/gateway/simulasi', { method: 'POST', body: { order: py.order_id } });
    ok('simulasi pembayaran lunas (mode sandbox)', r.status === 200 && r.body.paid === true, JSON.stringify(r.body).slice(0, 160));
    r = await req('/api/langganan');
    ok('masa aktif layanan diperpanjang setelah pembayaran terverifikasi',
      r.body.tenant.aktif_sampai && r.body.tenant.aktif_sampai !== aktifSebelum,
      `${aktifSebelum} → ${r.body.tenant.aktif_sampai}`);
    const sudah = (r.body.pembayaran || []).find(p => p.order_id === py.order_id);
    ok('riwayat pembayaran mencatat status disetujui', sudah && sudah.status === 'disetujui', JSON.stringify(sudah || {}).slice(0, 140));

    console.log('\n== 4. CALLBACK GATEWAY (PUBLIK, SIGNATURE DIVERIFIKASI) ==');
    r = await req('/api/langganan/bayar', { method: 'POST', body: { paket: 'basic', bulan: 1, metode: 'gateway' } });
    const py2 = r.body.pembayaran;
    ok('tagihan kedua dibuat', r.status === 200 && !!py2.order_id);
    r = await req('/api/pay/callback', { method: 'POST', body: { order_id: py2.order_id, paid: true, amount: py2.total } });
    ok('callback tanpa login diterima untuk provider simulasi', r.status === 200 && r.body.paid === true, JSON.stringify(r.body).slice(0, 140));
    r = await req('/api/pay/callback', { method: 'POST', body: { order_id: py2.order_id, paid: true, amount: py2.total } });
    ok('callback ulang idempoten (tidak dobel perpanjangan)', r.status === 200 && r.body.sudah === true, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/pay/callback', { method: 'POST', body: { order_id: 'TT-0-TIDAKADA', paid: true } });
    ok('callback untuk order tak dikenal → 404', r.status === 404);

    console.log('\n== 5. SAKELAR METODE MENYEMBUNYIKAN PILIHAN ==');
    await req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    await req('/api/super/qris', { method: 'POST', body: { pay: { gateway_aktif: false, manual_aktif: true, provider: 'sandbox' } } });
    cookie = '';
    await req('/api/login', { method: 'POST', body: { kode: KODE2, username: 'adminuji', password: 'ujipass123' } });
    r = await req('/api/langganan');
    ok('mode gateway nonaktif terbaca di sekolah', r.body.pay.gateway_aktif === false && r.body.pay.manual_aktif === true);
    r = await req('/api/langganan/bayar', { method: 'POST', body: { paket: 'basic', bulan: 1, metode: 'gateway' } });
    ok('pengajuan gateway ditolak saat sakelar dimatikan', r.status === 400, JSON.stringify(r.body).slice(0, 140));

    console.log('\n== 6. QRIS MANUAL TETAP BERJALAN ==');
    r = await req('/api/langganan/bayar', {
      method: 'POST',
      body: { paket: 'basic', bulan: 1, metode: 'qris', bukti_url: 'https://media.contoh/bukti.jpg', catatan: 'uji manual' }
    });
    ok('pengajuan QRIS manual (unggah bukti) tetap diterima', r.status === 200 && r.body.pembayaran.status === 'menunggu',
      JSON.stringify(r.body).slice(0, 160));
    ok('pembayaran manual menunggu verifikasi Super Admin', r.body.pembayaran.channel === 'manual' || r.body.pembayaran.channel === null || r.body.pembayaran.channel !== 'gateway');

    await req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    r = await req('/api/super/pembayaran');
    ok('Super Admin melihat daftar pembayaran', r.status === 200 && (r.body.rows || []).length >= 3, JSON.stringify(r.body).slice(0, 120));
    const manual = (r.body.rows || []).find(x => x.status === 'menunggu');
    ok('pembayaran manual dapat diverifikasi', !!manual);
    if (manual) {
      r = await req('/api/super/pembayaran/verifikasi', { method: 'POST', body: { id: manual.id, aksi: 'setuju' } });
      ok('verifikasi manual berhasil', r.status === 200, JSON.stringify(r.body).slice(0, 140));
    }

    console.log('\n== 7. HALAMAN APLIKASI ==');
    r = await req('/');
    ok('SPA tetap tersaji', r.status === 200);
  } catch (e) {
    fail++; fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL RONDE 13: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
