'use strict';
/* =====================================================================
   RONDE 15 — Tingkat kelas dinamis, kenaikan kelas, kategori form,
   mode pemeliharaan, harga per sekolah, dan provider Kasera.

   Jalankan: node dev-tests/round15.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DB = path.join(os.tmpdir(), 'stt-r15-' + Date.now() + '.sqlite');
const PORT = 5830 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let superCookie = '';
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

async function req(p, opts = {}) {
  const useSuper = opts.super;
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(useSuper ? (superCookie ? { Cookie: superCookie } : {}) : (cookie ? { Cookie: cookie } : {})),
      ...(useSuper ? { 'X-Client-Panel': 'saas' } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) {
    const jar = sc.map(c => c.split(';')[0]).join('; ');
    if (useSuper) superCookie = jar; else cookie = jar;
  }
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
  await new Promise(r => setTimeout(r, 2200));

  try {
    KODE = (((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0]) || {}).kode || '';
    let r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'admin', password: 'admin123' } });
    ok('login admin sekolah', r.status === 200, JSON.stringify(r.body));

    /* ================= 1. KONFIGURASI TINGKAT ================= */
    console.log('\n== 1. JENJANG & FORMAT TINGKAT ==');
    r = await req('/api/tingkat');
    ok('konfigurasi tingkat terbaca', r.status === 200 && r.body.config.jenjang === 'SMK');
    ok('bawaan SMK = X, XI, XII', JSON.stringify(r.body.config.list) === JSON.stringify(['X', 'XI', 'XII']), JSON.stringify(r.body.config.list));

    r = await req('/api/tingkat', { method: 'POST', body: { jenjang: 'SMP', mode: 'jenjang' } });
    ok('ganti jenjang SMP → VII, VIII, IX', r.status === 200 && JSON.stringify(r.body.config.list) === JSON.stringify(['VII', 'VIII', 'IX']), JSON.stringify(r.body.config && r.body.config.list));

    r = await req('/api/tingkat', { method: 'POST', body: { jenjang: 'SMA', mode: 'angka', terapkan: true } });
    ok('format angka SMA → 10, 11, 12', r.status === 200 && JSON.stringify(r.body.config.list) === JSON.stringify(['10', '11', '12']), JSON.stringify(r.body.config && r.body.config.list));
    ok('kelas ikut dipetakan (terapkan)', r.body.hasil && r.body.hasil.diubah > 0, JSON.stringify(r.body.hasil));
    let kelas = (await req('/api/kelas')).body.rows;
    ok('tingkat kelas kini format angka', kelas.every(k => ['10', '11', '12'].includes(k.tingkat)), JSON.stringify(kelas.map(k => k.tingkat)));
    ok('nama kelas ikut disesuaikan', kelas.some(k => /\b11\b/.test(k.nama)) && kelas.some(k => /\b12\b/.test(k.nama)), JSON.stringify(kelas.map(k => k.nama)));

    r = await req('/api/tingkat', { method: 'POST', body: { jenjang: 'SMA', mode: 'custom', custom: 'Kelas 10\nKelas 11\nKelas 12', terapkan: true } });
    ok('format kustom tersimpan', r.status === 200 && r.body.config.list[0] === 'Kelas 10');
    kelas = (await req('/api/kelas')).body.rows;
    ok('kelas memakai label kustom', kelas.every(k => /^Kelas 1[012]$/.test(k.tingkat)), JSON.stringify(kelas.map(k => k.tingkat)));

    r = await req('/api/tingkat', { method: 'POST', body: { jenjang: 'SMA', mode: 'custom', custom: '' } });
    ok('kustom kosong ditolak', r.status === 400);

    /* ================= 2. KENAIKAN KELAS ================= */
    console.log('\n== 2. KENAIKAN KELAS & RIWAYAT KELAS ==');
    /* buat siswa di kelas tingkat awal & akhir */
    kelas = (await req('/api/kelas')).body.rows;
    const kelasAwal = kelas.find(k => k.tingkat === 'Kelas 10');
    const kelasAkhir = kelas.find(k => k.tingkat === 'Kelas 12');
    ok('kelas tingkat awal & akhir tersedia', !!kelasAwal && !!kelasAkhir);
    const mkSiswa = async (nama, kelasId) => (await req('/api/siswa/save', { method: 'POST', body: { nama, kelas_id: kelasId, gender: 'L' } })).body.id;
    const sAwal = await mkSiswa('Siswa Naik Tingkat', kelasAwal.id);
    const sAkhir = await mkSiswa('Siswa Lulus Tingkat', kelasAkhir.id);
    ok('dua siswa uji dibuat', !!(sAwal && sAkhir));

    const taLama = (await req('/api/tahun')).body.rows.find(t => t.aktif);
    r = await req('/api/tahun/kenaikan/preview?dari=' + taLama.id);
    ok('pratinjau kenaikan terbaca', r.status === 200 && r.body.preview.naik >= 1, JSON.stringify(r.body.preview && r.body.preview.naik));

    r = await req('/api/tahun/save', {
      method: 'POST',
      body: { nama: '2099/2100', tanggal_mulai: '2099-07-01', tanggal_selesai: '2100-06-30', aktif: true, salin_periodik: true }
    });
    ok('tahun pelajaran + salin periodik dibuat', r.status === 200 && !!r.body.kenaikan, JSON.stringify(r.body));
    ok('ada siswa yang naik tingkat', r.body.kenaikan.naik >= 1, JSON.stringify(r.body.kenaikan));
    ok('siswa tingkat akhir menjadi lulus', r.body.kenaikan.lulus >= 1, JSON.stringify(r.body.kenaikan));

    const detailAwal = (await req('/api/siswa/' + sAwal)).body;
    const detailAkhir = (await req('/api/siswa/' + sAkhir)).body;
    ok('siswa naik ke tingkat berikutnya', detailAwal.siswa.tingkat === 'Kelas 11', detailAwal.siswa.tingkat);
    ok('siswa tingkat akhir berstatus lulus', detailAkhir.siswa.status_siswa === 'lulus', detailAkhir.siswa.status_siswa);
    ok('riwayat kelas per TA tercatat', (detailAwal.siswa.riwayat_kelas || []).length >= 2, JSON.stringify((detailAwal.siswa.riwayat_kelas || []).length));
    ok('riwayat kelas memuat nama TA', (detailAwal.siswa.riwayat_kelas || []).some(x => x.ta_nama), JSON.stringify(detailAwal.siswa.riwayat_kelas));

    r = await req('/api/siswa?status_siswa=lulus');
    ok('daftar siswa lulus dapat difilter', r.status === 200 && r.body.rows.some(x => x.id === sAkhir), JSON.stringify(r.body.rows && r.body.rows.length));
    r = await req('/api/siswa');
    ok('daftar siswa aktif tidak memuat lulusan', r.status === 200 && !r.body.rows.some(x => x.id === sAkhir));

    /* idempoten: jalankan ulang tidak menggandakan kelas */
    const jumlahKelas = (await req('/api/kelas')).body.rows.length;
    r = await req('/api/tahun/kenaikan', { method: 'POST', body: { dari: taLama.id, ke: (await req('/api/tahun')).body.rows.find(t => t.aktif).id } });
    ok('kenaikan kelas manual berjalan', r.status === 200 && !!r.body.hasil);
    ok('kenaikan ulang tidak menggandakan kelas', (await req('/api/kelas')).body.rows.length === jumlahKelas);

    /* ================= 3. KATEGORI FORM TANPA IZIN MASTER ================= */
    console.log('\n== 3. AKSES KATEGORI POIN UNTUK GURU UMUM / TU ==');
    r = await req('/api/users/save', {
      method: 'POST',
      body: { nama: 'Guru Umum Uji', username: 'guruumum15', role: 'guru_umum', password: 'guru12345', aktif: 1 }
    });
    ok('akun guru_umum dibuat', r.status === 200, JSON.stringify(r.body));
    const matrix = (await req('/api/users')).body.perms || {};
    const pGuru = JSON.parse(JSON.stringify(matrix.guru_umum || {}));
    /* matikan izin Data Siswa & Kategori Poin untuk role guru_umum */
    for (const fitur of ['siswa', 'kategori', 'kelas']) {
      pGuru[fitur] = { view: 0, write: 0, delete: 0 };
    }
    r = await req('/api/permissions', { method: 'POST', body: { role: 'guru_umum', perms: pGuru } });
    ok('izin guru_umum dibatasi pada input kejadian/jurnal', r.status === 200 && r.body.perms.kategori.view === 0);
    const cookieAdmin = cookie;
    cookie = '';
    r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'guruumum15', password: 'guru12345' } });
    ok('login guru_umum berhasil', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/kategori');
    ok('master kategori tetap tertutup (403)', r.status === 403, String(r.status));
    r = await req('/api/form-master');
    ok('form-master tetap dapat diakses', r.status === 200, String(r.status) + ' ' + JSON.stringify(r.body && r.body.error));
    ok('kategori + bobot poin termuat', r.status === 200 && r.body.kategori.length > 0 && r.body.kategori.every(k => Number(k.poin) > 0));
    const kat = (r.body.kategori || [])[0];
    const sisaSiswa = (await req('/api/siswa-options?all=1')).body.rows || [];
    r = await req('/api/kejadian/save', {
      method: 'POST',
      body: { siswa_ids: [sisaSiswa[0].id], kategori_ids: [kat.id], keterangan: 'Uji guru umum', tanggal: '2099-08-01' }
    });
    ok('guru_umum tetap bisa mencatat kejadian', r.status === 200 && r.body.poin > 0, JSON.stringify(r.body));

    /* ================= 4. MODE PEMELIHARAAN ================= */
    console.log('\n== 4. MODE PEMELIHARAAN ==');
    cookie = cookieAdmin;
    r = await req('/api/super/login', { super: true, method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('login super admin', r.status === 200, JSON.stringify(r.body));
    ok('cookie panel super admin tersimpan', /stt_super=/.test(superCookie), superCookie);
    r = await req('/api/super/pengumuman', {
      super: true, method: 'POST',
      body: { maintenance_aktif: true, maintenance_pesan: 'Pemeliharaan uji coba sistem' }
    });
    ok('mode pemeliharaan diaktifkan', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/bootstrap', { super: true });
    ok('super admin tetap dapat memuat panel saat maintenance', r.status === 200 && r.body.scope === 'super', String(r.status) + JSON.stringify(r.body && r.body.scope));
    r = await req('/api/super/dashboard', { super: true });
    ok('API super admin tidak diblokir maintenance', r.status === 200, String(r.status));

    const cookieTenant = cookie;
    cookie = '';
    r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'admin', password: 'admin123' } });
    ok('login akun sekolah ditolak saat maintenance (503)', r.status === 503, String(r.status) + ' ' + JSON.stringify(r.body));
    ok('pesan maintenance terbaca', /pemeliharaan/i.test(String((r.body && (r.body.error || r.body.message)) || '')), JSON.stringify(r.body));

    cookie = cookieTenant;
    r = await req('/api/bootstrap');
    ok('bootstrap tenant melaporkan maintenance', r.status === 200 && r.body.maintenance === true, JSON.stringify(r.body && r.body.maintenance));
    r = await req('/api/siswa');
    ok('endpoint data sekolah diblokir (503)', r.status === 503, String(r.status));

    /* super admin bisa login BARU saat maintenance aktif */
    superCookie = '';
    r = await req('/api/super/login', { super: true, method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('super admin tetap bisa login saat maintenance', r.status === 200, String(r.status));

    r = await req('/api/super/pengumuman', { super: true, method: 'POST', body: { maintenance_aktif: false } });
    ok('mode pemeliharaan dinonaktifkan', r.status === 200);
    cookie = cookieAdmin;
    r = await req('/api/siswa');
    ok('akses sekolah pulih setelah maintenance', r.status === 200, String(r.status));

    /* ================= 5. HARGA LANGGANAN PER SEKOLAH ================= */
    console.log('\n== 5. HARGA LANGGANAN PER SEKOLAH ==');
    const tenantId = (await req('/api/super/sekolah', { super: true })).body.rows[0].id;
    const sebelum = (await req('/api/super/sekolah/' + tenantId, { super: true })).body;
    const hargaPaket = Number(sebelum.harga_paket_bulanan);
    r = await req('/api/super/sekolah/simpan', { super: true, method: 'POST', body: { id: tenantId, harga_bulanan: 99000, harga_tahunan: 990000, harga_catatan: 'Kesepakatan khusus' } });
    ok('harga khusus disimpan', r.status === 200 && Number(r.body.tenant.harga_bulanan) === 99000, JSON.stringify(r.body && r.body.tenant && r.body.tenant.harga_bulanan));
    const sesudah = (await req('/api/super/sekolah/' + tenantId, { super: true })).body;
    ok('harga efektif bulanan memakai override', Number(sesudah.harga_bulanan) === 99000, JSON.stringify(sesudah.harga_bulanan));
    ok('harga efektif tahunan memakai override', Number(sesudah.harga_tahunan) === 990000, JSON.stringify(sesudah.harga_tahunan));
    ok('harga dasar paket tetap terbaca', Number.isFinite(hargaPaket), String(hargaPaket));
    r = await req('/api/super/sekolah/simpan', { super: true, method: 'POST', body: { id: tenantId, harga_bulanan: 0, harga_tahunan: 0 } });
    ok('override dapat dikosongkan (ikut paket)', r.status === 200 && Number(r.body.tenant.harga_bulanan) === 0);

    /* ================= 6. PROVIDER KASERA ================= */
    console.log('\n== 6. PROVIDER GATEWAY KASERA ==');
    r = await req('/api/super/qris', { super: true });
    ok('Kasera ada pada daftar provider', (r.body.pay.providers || []).some(p => p.key === 'kasera'), JSON.stringify((r.body.pay.providers || []).map(p => p.key)));
    r = await req('/api/super/qris', { super: true, method: 'POST', body: { pay: { gateway_aktif: true, manual_aktif: true, provider: 'kasera', mode: 'sandbox', key: 'ksr-test-key', merchant: 'M-12345', callback: 'rahasia-callback', base: 'https://api.kasera.id', expire_menit: 60 } } });
    ok('konfigurasi Kasera tersimpan', r.status === 200, JSON.stringify(r.body && r.body.pesan));
    r = await req('/api/super/qris', { super: true });
    ok('provider aktif = kasera', r.body.pay.provider === 'kasera', r.body.pay.provider);
    ok('kunci tersimpan (tidak dikirim balik)', r.body.pay.key_set === true && !r.body.pay.key);

    /* unit test adapter Kasera dengan fetch tiruan */
    const payment = require('../payment');
    const calls = [];
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      if (String(url).endsWith('/v1/transactions')) {
        return { ok: false, status: 404, json: async () => ({ error: { code: 'not_found', message: 'not found' } }) };
      }
      if (String(url).endsWith('/v1/qris')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { qr_string: 'KASERA-QR-123', expires_at: '2099-01-01T00:00:00Z' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'payreq-tt', status: 'succeeded', external_id: 'TT-1-XYZ', amount: 99000 }) };
    };
    const charge = await payment.createCharge({ provider: 'kasera', mode: 'sandbox', base: 'https://api.kasera.id', key: 'ksr-test-key', merchant: 'M-12345' },
      { order_id: 'TT-1-XYZ', amount: 99000, label: 'Langganan 1 bulan' });
    ok('Kasera legacy fallback memakai Bearer + Merchant ID setelah endpoint resmi 404',
      calls[1] && /Bearer ksr-test-key/.test(calls[1].opts.headers.Authorization)
        && calls[1].opts.headers['X-Merchant-Id'] === 'M-12345', JSON.stringify(calls[1] && calls[1].opts.headers));
    ok('Kasera: qr_string terbaca', charge.ok && charge.qr_string === 'KASERA-QR-123', JSON.stringify(charge));
    const st = await payment.checkStatus({ provider: 'kasera', mode: 'sandbox', base: 'https://api.kasera.id', key: 'ksr-test-key', merchant: 'M-12345', transaction_id: 'payreq-tt' }, { order_id: 'TT-1-XYZ' });
    ok('Kasera: status lunas terbaca', st.ok && st.paid === true, JSON.stringify(st));
    global.fetch = origFetch;

    const raw = JSON.stringify({ reference_id: 'TT-1-XYZ', status: 'PAID', amount: 99000 });
    const sig = crypto.createHmac('sha256', 'rahasia-callback').update(raw).digest('hex');
    ok('Kasera: signature callback valid diterima', payment.verifyCallback({ provider: 'kasera', callback: 'rahasia-callback' }, JSON.parse(raw), { 'x-kasera-signature': sig }) === true);
    ok('Kasera: signature salah ditolak', payment.verifyCallback({ provider: 'kasera', callback: 'rahasia-callback' }, JSON.parse(raw), { 'x-kasera-signature': 'deadbeef' }) === false);
    const cb = payment.parseCallback({ provider: 'kasera' }, { data: { reference_id: 'TT-1-XYZ', status: 'SETTLED', amount: 99000 } });
    ok('Kasera: callback lunas diparse', cb.order_id === 'TT-1-XYZ' && cb.paid === true, JSON.stringify(cb));

    /* ================= 7. SEMESTER DIHAPUS ================= */
    console.log('\n== 7. SEMESTER TIDAK LAGI MEMFILTER DATA ==');
    r = await req('/api/bootstrap');
    ok('bootstrap tetap menyediakan daftar tahun pelajaran', Array.isArray(r.body.tahun) && r.body.tahun.length >= 2);
    r = await req('/api/dashboard?ta=' + (await req('/api/tahun')).body.rows.find(t => t.aktif).id);
    ok('dashboard tanpa parameter semester tetap berjalan', r.status === 200);
    r = await req('/api/siswa?ta=' + (await req('/api/tahun')).body.rows.find(t => t.aktif).id);
    ok('daftar siswa tanpa semester tetap berjalan', r.status === 200);

    /* ================= 8. MIGRASI DB SEKOLAH LAIN ================= */
    console.log('\n== 8. MIGRASI SKEMA DB SEKOLAH LAIN ==');
    /* modul inti dimuat dengan DB uji (JANGAN menyentuh database live) */
    process.env.DB_PATH = DB;
    process.env.SAAS_DB_PATH = process.env.SAAS_DB_PATH || path.join(path.dirname(DB), 'saas.sqlite');
    const saas = require('../saas');
    const dbm = require('../db');
    const Database = require('better-sqlite3');
    const buat = saas.createTenant({
      nama: 'Sekolah Migrasi Uji', jenjang: 'SMP', oleh: 'Uji', paket: 'basic', trial_hari: 7
    });
    const fileSekolah = saas.absDb(buat.tenant);
    ok('DB sekolah uji dibuat', require('fs').existsSync(fileSekolah), fileSekolah);
    /* lepas koneksi lalu hapus kolom baru → meniru DB sekolah versi skema lama */
    dbm.closeTenantDb(fileSekolah);
    const connSekolah = new Database(fileSekolah);
    let bisaDrop = true;
    try { connSekolah.exec('ALTER TABLE kelas DROP COLUMN tahun_ajaran_id'); } catch (e) { bisaDrop = false; }
    const kolomSesudahDrop = connSekolah.pragma('table_info(kelas)').map(c => c.name);
    connSekolah.close();
    if (bisaDrop) {
      ok('kolom baru dihapus (simulasi skema lama)', !kolomSesudahDrop.includes('tahun_ajaran_id'));
      let hasilKelas = null, errKelas = '';
      try { hasilKelas = dbm.useTenant(fileSekolah, () => dbm.kelasList()); }
      catch (e) { errKelas = e.message; }
      ok('membuka DB sekolah lama TIDAK error', !errKelas, errKelas);
      const cek = new Database(fileSekolah, { readonly: true });
      const kolomBaru = cek.pragma('table_info(kelas)').map(c => c.name);
      cek.close();
      ok('migrasi kolom baru otomatis dijalankan saat DB dibuka', kolomBaru.includes('tahun_ajaran_id'), JSON.stringify(kolomBaru));
      ok('kelas sekolah tersebut tetap terbaca', Array.isArray(hasilKelas) && hasilKelas.length > 0, String(hasilKelas && hasilKelas.length));
    } else {
      ok('ALTER TABLE DROP COLUMN tidak didukung — uji migrasi dilewati', true);
    }
    saas.deleteTenant(buat.tenant.id, 'Uji');

    /* ================= 9. SINKRON JENJANG SAAT IDENTITAS DIUBAH ================= */
    console.log('\n== 9. SINKRONISASI JENJANG PENDIDIKAN ==');
    r = await req('/api/tingkat', { method: 'POST', body: { jenjang: 'SMA', mode: 'jenjang' } });
    ok('jenjang awal SMA', r.status === 200 && r.body.config.jenjang === 'SMA');
    r = await req('/api/settings/save', { method: 'POST', body: { data: { sekolah_bentuk: 'SD' } } });
    ok('bentuk sekolah diubah ke SD', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/tingkat');
    ok('jenjang pendidikan ikut berubah menjadi SD', r.body.config.jenjang === 'SD', r.body.config.jenjang);
    ok('daftar tingkat menjadi I … VI', JSON.stringify(r.body.config.list) === JSON.stringify(['I', 'II', 'III', 'IV', 'V', 'VI']), JSON.stringify(r.body.config.list));
    r = await req('/api/tingkat', { method: 'POST', body: { jenjang: 'SMK', mode: 'jenjang' } });
    ok('jenjang dikembalikan ke SMK', r.status === 200 && r.body.config.jenjang === 'SMK');
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
  }

  console.log('\n=== HASIL RONDE 15: ' + pass + ' lulus, ' + fail + ' gagal ===');
  if (fails.length) { console.log('\nGAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})();
