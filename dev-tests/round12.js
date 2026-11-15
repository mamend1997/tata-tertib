'use strict';
/* =====================================================================
   RONDE 12 — Lokasi fleksibel, input multi-siswa, WhatsApp massal + jeda,
   penguncian anti double input, kategori hapus masal, riwayat aktivitas
   di dashboard, dan menu Masukan & Kendala.

   Jalankan: node dev-tests/round12.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-r12-' + Date.now() + '.sqlite');
const PORT = 5320 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let KODE = '';
let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
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
async function login(username, password) {
  cookie = '';
  const r = await req('/api/login', { method: 'POST', body: { kode: KODE, username, password } });
  return r;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, APP_TIMEZONE: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2000));

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');

    console.log('\n== 1. LOKASI FLEKSIBEL (DROPDOWN + MANUAL) ==');
    let r = await req('/api/master');
    ok('daftar lokasi memuat opsi "Lainnya"', (r.body.lokasi || []).some(l => String(l).toLowerCase() === 'lainnya'),
      JSON.stringify(r.body.lokasi));

    const kelas = (await req('/api/kelas')).body.rows;
    const mk = async (nama, kelasId) => (await req('/api/siswa/save', { method: 'POST', body: { nama, kelas_id: kelasId, gender: 'L' } })).body.id;
    const s1 = await mk('Siswa Uji Satu', kelas[0].id);
    const s2 = await mk('Siswa Uji Dua', kelas[0].id);
    const s3 = await mk('Siswa Uji Tiga', kelas[1].id);
    ok('tiga siswa uji dibuat', !!(s1 && s2 && s3));

    const katPel = (await req('/api/kategori')).body.rows.find(k => k.jenis === 'pelanggaran');
    const katPres = (await req('/api/kategori')).body.rows.find(k => k.jenis === 'prestasi');

    r = await req('/api/kejadian/save', {
      method: 'POST',
      body: { siswa_id: s1, kategori_id: katPel.id, keterangan: '', tanggal: '2026-11-04', lokasi: 'Belakang Lab Komputer' }
    });
    ok('lokasi manual (opsi Lainnya) tersimpan apa adanya', r.status === 200);
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    const ev1 = r.body.rows.find(x => x.siswa_id === s1);
    ok('lokasi manual muncul pada riwayat kejadian', ev1 && ev1.lokasi === 'Belakang Lab Komputer', ev1 && ev1.lokasi);

    console.log('\n== 2. INPUT SISWA MULTI-SELECT (MASAL) ==');
    r = await req('/api/kejadian/save', {
      method: 'POST',
      body: { siswa_ids: [s1, s2], kategori_id: katPres.id, keterangan: 'Kerja bakti bersama', tanggal: '2026-11-05' }
    });
    ok('kejadian tersimpan untuk 2 siswa sekaligus', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body).slice(0, 160));
    r = await req('/api/siswa/' + s2);
    ok('poin siswa kedua ikut bertambah', r.body.siswa.pres >= katPres.poin);

    r = await req('/api/jurnal/save', {
      method: 'POST',
      body: { siswa_ids: [s1, s2, s3], kategori_id: katPel.id, keterangan: '', tanggal: '2026-11-05', jam: '07:30', lokasi: 'Gerbang Sekolah' }
    });
    ok('buku penghubung menerima 3 siswa sekaligus', r.status === 200 && r.body.jumlah === 3, JSON.stringify(r.body).slice(0, 160));
    ok('keterangan jurnal opsional (boleh kosong)', r.status === 200);

    r = await req('/api/tindak-lanjut/save', {
      method: 'POST',
      body: { siswa_ids: [s1, s3], jenis: 'Konseling Individual', hasil: 'Pendekatan kelompok selesai dilakukan', status: 'pemantauan' }
    });
    ok('tindak lanjut untuk beberapa siswa sekaligus', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body).slice(0, 140));

    console.log('\n== 3. KETERANGAN OPSIONAL & JENIS TOMBOL ==');
    r = await req('/api/bootstrap');
    ok('wajib_keterangan bawaan = mati (opsional)', !r.body.settings.form_config.wajib_keterangan,
      JSON.stringify(r.body.settings.form_config));
    ok('field judul kejadian disembunyikan bawaan', !r.body.settings.form_config.tampilkan_judul);

    console.log('\n== 4. FITUR BARU TERDAFTAR (feedback & rekap) ==');
    r = await req('/api/bootstrap');
    ok('fitur feedback & feedback_admin terdaftar',
      ['feedback', 'feedback_admin'].every(k => (r.body.features || []).some(f => f.key === k)));
    const navKeys = (r.body.settings.nav || []).map(n => n.key);
    ok('menu Masukan & Kendala ada di navigasi', navKeys.includes('feedback'), navKeys.join(','));

    console.log('\n== 5. KATEGORI HAPUS MASAL ==');
    r = await req('/api/kategori/save', { method: 'POST', body: { nama: 'Kategori Uji A', jenis: 'pelanggaran', poin: 3 } });
    const kA = r.body.id || (await req('/api/kategori')).body.rows.find(k => k.nama === 'Kategori Uji A').id;
    r = await req('/api/kategori/save', { method: 'POST', body: { nama: 'Kategori Uji B', jenis: 'pelanggaran', poin: 4 } });
    const kB = r.body.id || (await req('/api/kategori')).body.rows.find(k => k.nama === 'Kategori Uji B').id;
    r = await req('/api/kategori/bulk-delete', { method: 'POST', body: { ids: [kA, kB] } });
    ok('hapus kategori masal', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body));
    r = await req('/api/kategori');
    ok('kategori terpilih benar-benar terhapus', !r.body.rows.some(k => [kA, kB].includes(k.id)));
    r = await req('/api/kategori/bulk-delete', { method: 'POST', body: { ids: [] } });
    ok('hapus masal tanpa pilihan ditolak', r.status === 400);

    console.log('\n== 6. RIWAYAT AKTIVITAS DI DASHBOARD ==');
    r = await req('/api/dashboard?ta=1&semester=ganjil');
    ok('dashboard mengirim riwayat aktivitas', Array.isArray(r.body.riwayat) && r.body.riwayat.length > 0);
    const pelaporAda = (r.body.riwayat || []).every(x => x.pelapor && String(x.pelapor).trim().length > 0);
    ok('setiap baris riwayat memuat nama pelapor', pelaporAda,
      JSON.stringify((r.body.riwayat || []).slice(0, 2).map(x => x.pelapor)));
    ok('riwayat memuat sumber jurnal & kejadian',
      (r.body.riwayat || []).some(x => x.sumber === 'jurnal') && (r.body.riwayat || []).some(x => x.sumber === 'kejadian'));

    const target = (r.body.riwayat || []).filter(x => x.siswa_id === s3)[0];
    r = await req('/api/riwayat/hapus-massal', { method: 'POST', body: { items: [{ sumber: target.sumber, id: target.id }] } });
    ok('hapus riwayat terpilih', r.status === 200 && r.body.jumlah === 1, JSON.stringify(r.body));
    r = await req('/api/dashboard?ta=1&semester=ganjil');
    ok('riwayat terhapus hilang dari dashboard',
      !(r.body.riwayat || []).some(x => x.sumber === target.sumber && x.id === target.id));

    console.log('\n== 7. ROLE WALI KELAS (SCOPE INPUT KEJADIAN vs BUKU PENGHUBUNG) ==');
    await login('wali1', 'wali123');
    let kelasWali = (await req('/api/kelas')).body.rows.filter(k => k.wali_id);
    r = await req('/api/siswa-options');
    const opsiWali = (r.body.rows || []).map(x => x.kelas_id);
    ok('daftar siswa Input Kejadian hanya kelas ampu', new Set(opsiWali).size === 1 && opsiWali.includes(kelasWali[0].id),
      JSON.stringify([...new Set(opsiWali)]));
    r = await req('/api/siswa-options?all=1');
    ok('buku penghubung dapat memilih siswa kelas lain', new Set((r.body.rows || []).map(x => x.kelas_id)).size > 1);

    const kelasLain = kelasWali.find(k => k.id !== kelasWali[0].id) || { id: kelas[1].id };
    /* siswa dibuat oleh admin (wali kelas tidak punya izin menambah siswa) */
    await login('admin', 'admin123');
    const sLain = await mk('Siswa Kelas Lain', kelasLain.id);
    ok('siswa kelas lain dibuat untuk uji scope', !!sLain);
    await login('wali1', 'wali123');
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: sLain, kategori_id: katPel.id, keterangan: '', tanggal: '2026-11-06' } });
    ok('wali kelas ditolak mencatat kejadian siswa kelas lain', r.status === 403, JSON.stringify(r.body).slice(0, 140));
    r = await req('/api/jurnal/save', { method: 'POST', body: { siswa_id: sLain, kategori_id: katPel.id, keterangan: '', tanggal: '2026-11-06', jam: '08:00' } });
    ok('wali kelas BOLEH mencatat buku penghubung siswa kelas lain', r.status === 200, JSON.stringify(r.body).slice(0, 140));

    console.log('\n== 8. PENGUNCIAN JEDA INPUT (ANTI DOUBLE INPUT) ==');
    await login('admin', 'admin123');
    const sLock = await mk('Siswa Kunci', kelas[0].id);
    r = await req('/api/wa/pengaturan', { method: 'POST', body: { input_cooldown_jam: 2 } });
    ok('setelan jeda input disimpan', r.status === 200);
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: sLock, kategori_id: katPel.id, keterangan: 'x', tanggal: '2026-11-07' } });
    const first = r.status;
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: sLock, kategori_id: katPel.id, keterangan: 'x', tanggal: '2026-11-07' } });
    ok('input kedua dalam jeda ditolak (429)', first === 200 && r.status === 429, `${first}/${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    r = await req('/api/wa/pengaturan', { method: 'POST', body: { input_cooldown_jam: 0 } });
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: sLock, kategori_id: katPel.id, keterangan: 'x', tanggal: '2026-11-07' } });
    ok('jeda dinonaktifkan → input kembali diterima', r.status === 200);

    console.log('\n== 9. WHATSAPP GATEWAY & KIRIM MASAL + JEDA 1 HARI ==');
    r = await req('/api/siswa/save', { method: 'POST', body: { id: s1, nama: 'Siswa Uji Satu', kelas_id: kelas[0].id, gender: 'L', parent_phone: '081234567890' } });
    ok('nomor orang tua tersimpan', r.status === 200);
    r = await req('/api/wa/pengaturan', { method: 'POST', body: { cooldown_jam: 24, template: 'Halo {nama} ({kelas}) — poin pelanggaran {pel}. Dari {sekolah}.' } });
    ok('setelan jeda WA 24 jam disimpan', r.status === 200);
    r = await req('/api/wa/pengaturan');
    ok('konfigurasi WA terbaca (jeda 24 jam)', r.body.config.cooldown_jam === 24, JSON.stringify(r.body.config));
    ok('token gateway tidak pernah dikirim balik ke klien', r.body.config.token === undefined || r.body.config.token === '');

    r = await req('/api/wa/massal', { method: 'POST', body: { ids: [s1, s2] } });
    ok('kirim WA masal diproses', r.status === 200 && Array.isArray(r.body.terkirim), JSON.stringify(r.body).slice(0, 160));
    ok('siswa tanpa nomor HP dilaporkan', (r.body.tanpa_nomor || []).includes('Siswa Uji Dua') || (r.body.terkirim || []).some(x => x === 'Siswa Uji Satu'));

    r = await req('/api/wa/siswa/' + s1, { method: 'POST' });
    ok('pengiriman ulang dalam jeda ditolak (429)', r.status === 429, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
    r = await req('/api/wa/massal', { method: 'POST', body: { ids: [s1] } });
    ok('kirim masal juga menghormati jeda', r.status === 200 && (r.body.terkunci || []).length === 1, JSON.stringify(r.body).slice(0, 160));

    r = await req('/api/wa/log');
    ok('riwayat WA mencatat tanggal, waktu & akun pengirim',
      (r.body.rows || []).length > 0 && r.body.rows.every(x => x.created_at && x.oleh_nama),
      JSON.stringify((r.body.rows || [])[0] || {}).slice(0, 160));

    r = await req('/api/wa/pengaturan', { method: 'POST', body: { cooldown_jam: 0 } });
    r = await req('/api/wa/siswa/' + s1, { method: 'POST' });
    ok('jeda 0 → boleh kirim ulang segera', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    await req('/api/wa/pengaturan', { method: 'POST', body: { cooldown_jam: 24 } });

    console.log('\n== 10. MASUKAN & KENDALA ==');
    r = await req('/api/feedback', { method: 'POST', body: { jenis: 'kendala', judul: 'Tombol simpan', pesan: 'Tombol simpan tidak merespon di halaman siswa.' } });
    ok('masukan terkirim', r.status === 200 && r.body.id, JSON.stringify(r.body).slice(0, 140));
    const fbId = r.body.id;
    r = await req('/api/feedback', { method: 'POST', body: { jenis: 'masukan', pesan: '' } });
    ok('masukan kosong ditolak', r.status === 400);
    r = await req('/api/feedback');
    ok('daftar masukan memuat laporan sendiri', r.status === 200 && (r.body.rows || []).some(x => x.id === fbId));
    ok('admin dapat melihat seluruh masukan (semua=true)', r.body.semua === true);
    r = await req('/api/feedback/status', { method: 'POST', body: { id: fbId, status: 'diproses', balasan: 'Sedang kami periksa.' } });
    ok('status & balasan masukan tersimpan', r.status === 200, JSON.stringify(r.body).slice(0, 140));
    r = await req('/api/feedback');
    const fb = (r.body.rows || []).find(x => x.id === fbId);
    ok('balasan terbaca oleh pengirim', fb && fb.status === 'diproses' && fb.balasan === 'Sedang kami periksa.');

    await login('guru', 'guru123');
    r = await req('/api/feedback');
    ok('guru melihat masukan miliknya saja (semua=false)', r.body.semua === false);
    r = await req('/api/feedback/status', { method: 'POST', body: { id: fbId, status: 'selesai' } });
    ok('guru biasa tidak boleh mengubah status masukan (403)', r.status === 403, String(r.status));
    r = await req('/api/feedback/delete', { method: 'POST', body: { ids: [fbId] } });
    ok('guru biasa tidak boleh menghapus masukan (403)', r.status === 403, String(r.status));

    await login('admin', 'admin123');
    r = await req('/api/feedback/delete', { method: 'POST', body: { ids: [fbId] } });
    ok('admin dapat menghapus masukan', r.status === 200 && r.body.jumlah === 1, JSON.stringify(r.body));

    console.log('\n== 11. HALAMAN APLIKASI ==');
    const html = await req('/');
    ok('SPA tetap tersaji (200)', html.status === 200);
  } catch (e) {
    fail++; fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
