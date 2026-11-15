'use strict';
/* Uji scheduler WhatsApp rekap absensi harian ke Wali Kelas (tanpa server HTTP
   aplikasi): memastikan rekap terkirim sekali per hari dan tidak dobel.
   Jalankan: node dev-tests/rekap-scheduler.js */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-wa-'));
process.env.DB_PATH = path.join(TMP, 'db.sqlite');
process.env.SAAS_DB_PATH = path.join(TMP, 'saas.sqlite');
process.env.TZ = 'Asia/Jakarta';

const dbm = require('../db');
const lib = require('../lib');
const db = dbm.db;

let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const dummyApi = {
  get() {}, post() {}, del() {}, json() {}, fail() {}, guard() {}, readBody() {}, ipOf() {}, uploadBuffer: async () => ({ ok: false }),
  appBaseUrl: () => 'http://localhost', tenantKode: () => '1234'
};

(async () => {
  const rekap = require('../rekap')(dummyApi);
  const terkirim = [];
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => { terkirim.push(b); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const port = mock.address().port;

  try {
    /* data awal: kelas + wali bernomor + siswa + presensi hari ini */
    dbm.seedDemo(null);
    const hari = dbm.hariOf(dbm.today());
    const wali = db.prepare("SELECT id FROM users WHERE role='wali_kelas' LIMIT 1").get();
    db.prepare('UPDATE users SET phone=? WHERE id=?').run('081234567890', wali.id);
    const kelas = db.prepare('SELECT * FROM kelas WHERE wali_id=?').get(wali.id)
      || db.prepare('SELECT * FROM kelas LIMIT 1').get();
    db.prepare('UPDATE kelas SET wali_id=? WHERE id=?').run(wali.id, kelas.id);
    const siswa = db.prepare('SELECT * FROM siswa WHERE kelas_id=? LIMIT 3').all(kelas.id);
    ok('data uji: kelas dengan wali + siswa contoh', siswa.length >= 1, String(siswa.length));
    const mapel = db.prepare("INSERT INTO mapel(kode,nama,aktif,urut,created_at) VALUES('TST','Matematika',1,1,?)").run(dbm.now());
    const jadwal = db.prepare(`INSERT INTO jadwal(ta_id,hari,sesi,mapel_id,guru_id,kelas_ids,ruang,merged,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'',0,?,?)`).run(
      (dbm.tahunAktif() || {}).id || 1, hari, 1, Number(mapel.lastInsertRowid), wali.id, JSON.stringify([kelas.id]), dbm.now(), dbm.now());
    const sesi = db.prepare(`INSERT INTO absensi_sesi(jadwal_id,tanggal,token,ta_id,mapel_id,guru_id,kelas_ids,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(Number(jadwal.lastInsertRowid), dbm.today(), 'TST.1', (dbm.tahunAktif() || {}).id || 1,
      Number(mapel.lastInsertRowid), wali.id, JSON.stringify([kelas.id]), dbm.now(), dbm.now());
    const status = ['S', 'I', 'A'];
    siswa.forEach((s, i) => {
      db.prepare(`INSERT INTO absensi_siswa(sesi_id,jadwal_id,tanggal,siswa_id,kelas_id,status,keterangan,oleh_nama,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(Number(sesi.lastInsertRowid), Number(jadwal.lastInsertRowid), dbm.today(),
        s.id, kelas.id, status[i % status.length], 'uji', 'Petugas', dbm.now(), dbm.now());
    });

    dbm.setSetting('wa_aktif', '1');
    dbm.setSetting('wa_gateway_url', `http://127.0.0.1:${port}/send`);
    dbm.setSetting('wa_gateway_token', 'uji');
    dbm.setSetting('absensi_wa_kelas_aktif', '1');
    dbm.setSetting('absensi_wa_kelas_jam', '00:00');
    dbm.setSetting('absensi_wa_kelas_hari', [0, 1, 2, 3, 4, 5, 6].join(','));
    dbm.setSetting('absensi_wa_kelas_terakhir', '');

    console.log('\n== SCHEDULER REKAP WA WALI KELAS ==');
    const hasil1 = await rekap.checkWaKelas();
    ok('scheduler mengirim rekap pada jam yang diatur', hasil1.sent === true, JSON.stringify(hasil1));
    ok('ada pesan terkirim ke gateway', terkirim.length >= 1, String(terkirim.length));
    const payload = terkirim[0] ? JSON.parse(terkirim[0]) : {};
    ok('payload berisi nomor wali & teks rekap', /628|0812/.test(String(payload.target || payload.phone || '')) && /REKAP ABSENSI HARIAN/.test(String(payload.message || '')),
      JSON.stringify(payload).slice(0, 160));
    ok('pesan memuat rincian per mata pelajaran & nama siswa',
      /Matematika/.test(String(payload.message || '')) && /(Sakit|Izin|Alpha)/.test(String(payload.message || '')),
      String(payload.message || '').slice(0, 200));
    ok('tanggal terakhir tercatat agar tidak dobel', String(dbm.getSetting('absensi_wa_kelas_terakhir', '')) === dbm.today());

    const jumlahSebelum = terkirim.length;
    const hasil2 = await rekap.checkWaKelas();
    ok('scheduler tidak mengirim dua kali pada hari yang sama', hasil2.skip === 'sudah' && terkirim.length === jumlahSebelum, JSON.stringify(hasil2));

    dbm.setSetting('absensi_wa_kelas_aktif', '0');
    const hasil3 = await rekap.checkWaKelas();
    ok('scheduler berhenti saat fitur dinonaktifkan', hasil3.skip === 'nonaktif', JSON.stringify(hasil3));
  } catch (e) {
    fail++; fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    mock.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { fails.forEach(f => console.log(' - ' + f)); process.exit(1); }
  process.exit(0);
})();
