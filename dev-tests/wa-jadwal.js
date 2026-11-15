'use strict';
/* Uji (tata-tertib) — Pengingat & peringatan WhatsApp, desain isi tabel jadwal,
   dan pembersihan notifikasi "Guru Tidak Hadir" yang jadwalnya sudah dihapus.
   ---------------------------------------------------------------------------
   1. Absensi yatim (slot jadwal sudah dihapus) TIDAK muncul lagi di panel
      Notifikasi Guru Tidak Hadir + dibersihkan otomatis saat server start.
   2. Hapus slot jadwal ikut menghapus absensi guru / izin / sesi presensi.
   3. Desain Jadwal: pilihan isi sel (kode/nama mapel/guru/ruang) & ukuran
      kolom JAM berlaku pada cetak PDF dan ekspor Excel.
   4. Pengingat jadwal (N menit sebelum) & peringatan belum check-in
      (N menit setelah) terkirim lewat gateway Fonnte tiruan, tanpa dobel.
   Jalankan: node dev-tests/wa-jadwal.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-waj-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-waj-saas-' + Date.now() + '.sqlite');
const PORT = 5600 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const WA_PORT = PORT + 400;
const WA_URL = `http://127.0.0.1:${WA_PORT}/send`;
let KODE = '';
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  return { status: r.status, body, ct };
}
const login = async (u, pw) => { cookie = ''; return req('/api/login', { method: 'POST', body: { username: u, password: pw, kode: KODE } }); };

const pad = n => String(n).padStart(2, '0');
const wib = new Date();
const TODAY = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
const HARI = wib.getDay();
const kini = wib.getHours() * 60 + wib.getMinutes();
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;

/* jam sesi: satu untuk pengingat (mulai 12 menit lagi) & satu untuk peringatan check-in
   (sudah berjalan 20 menit). Sesi tidak boleh bertumpang tindih. */
const A_MULAI = Math.min(1430, kini + 12), A_SELESAI = Math.min(1439, A_MULAI + 30);
const B_MULAI = Math.max(1, kini - 20), B_SELESAI = Math.min(A_MULAI - 2, 1439);

/* gateway WhatsApp tiruan (gaya Fonnte) */
const waHits = [];
function startWa() {
  const http = require('http');
  const srv = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', c => { body += c; });
    rq.on('end', () => {
      waHits.push({ url: rq.url, ct: rq.headers['content-type'], auth: rq.headers.authorization || '', body });
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ status: true, detail: 'success' }));
    });
  });
  return new Promise(r => srv.listen(WA_PORT, '127.0.0.1', () => r(srv)));
}
const pesanTerkirim = () => waHits.map(h => decodeURIComponent(String(h.body || '').replace(/\+/g, ' ')));
const targetDari = (pesan) => (String(pesan).match(/target=(\d+)/) || [])[1] || '';

let srv = null;
function bootServer() {
  const s = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  s.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  return s;
}
async function tungguServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) return true; } catch (e) { /* belum siap */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}
/** berkas database sekolah (tenant) yang dipakai server */
function dbSekolah() {
  const dir = path.join(path.dirname(DB), 'sekolah');
  try {
    const f = fs.readdirSync(dir).find(x => x.endsWith('.sqlite') && !x.includes('-wal') && !x.includes('-shm'));
    if (f) return path.join(dir, f);
  } catch (e) { /* belum ada folder tenant */ }
  return DB;   // instalasi pertama: sekolah utama memakai DB_PATH
}
function q(sql, ...args) {
  const Database = require('better-sqlite3');
  const db = new Database(dbSekolah(), { timeout: 8000 });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}
function run(sql, ...args) {
  const Database = require('better-sqlite3');
  const db = new Database(dbSekolah(), { timeout: 8000 });
  try { return db.prepare(sql).run(...args); } finally { db.close(); }
}

(async () => {
  const wa = await startWa();
  srv = bootServer();
  const siap = await tungguServer();
  ok('server siap', siap);

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin dengan kode sekolah', !!cookie, KODE);

    /* ---------------- konfigurasi jadwal ---------------- */
    let r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam ke-1', mulai: hhmm(B_MULAI), selesai: hhmm(B_SELESAI), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(A_MULAI), selesai: hhmm(A_SELESAI), istirahat: 0 }
        ],
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 15, toleransi_tutup: 0, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 0, auto_alpha: 0 },
        wa: { aktif: 0, jam: '15:00' }
      }
    });
    ok('pengaturan jadwal hari ini disimpan', r.status === 200, r.body?.error);

    /* akun guru + nomor HP */
    r = await req('/api/users/save', {
      method: 'POST',
      body: { nama: 'Guru Pengingat Uji', username: 'gururing', password: 'guru123', role: 'guru_umum', roles: ['guru'], phone: '081200000777' }
    });
    const gId = r.body.id;
    ok('akun guru uji dibuat + nomor HP', !!gId, r.body?.error);

    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika Uji', kode: 'MTKU', guru_ids: [gId] } });
    const mapelId = r.body.id;
    ok('mata pelajaran uji dibuat', !!mapelId, r.body?.error);

    const siswa = (await req('/api/siswa?limit=5')).body.rows || [];
    const kelasId = siswa[0]?.kelas_id || (await req('/api/kelas')).body.rows?.[0]?.id;
    ok('kelas tersedia', !!kelasId, String(kelasId));

    const buatSlot = async (sesi) => (await req('/api/jadwal/slot', {
      method: 'POST',
      body: { hari: HARI, sesi, mapel_id: mapelId, guru_id: gId, kelas_ids: [kelasId], ruang: 'R-01', abaikan: 1 }
    })).body.id;
    const slotTelat = await buatSlot(1);      // sesi B: sudah berjalan 20 menit
    const slotIngat = await buatSlot(2);      // sesi A: mulai 12 menit lagi
    ok('dua slot jadwal dibuat', !!slotTelat && !!slotIngat, `${slotTelat} / ${slotIngat}`);

    /* ---------------- 1. DESAIN ISI TABEL JADWAL ---------------- */
    console.log('\n== 1. DESAIN JADWAL: ISI SEL & UKURAN KOLOM ==');
    r = await req('/api/jadwal/desain');
    ok('desain jadwal mengirim konfigurasi tampil', r.status === 200 && !!r.body.tampil, JSON.stringify(r.body?.tampil));
    ok('bawaan: kode + nama + guru tampil', Number(r.body.tampil.kode) === 1 && Number(r.body.tampil.nama) === 1
      && Number(r.body.tampil.guru) === 1, JSON.stringify(r.body.tampil));

    r = await req('/api/jadwal/desain', {
      method: 'POST',
      body: {
        judul: 'JADWAL PELAJARAN', semester: 'Semester Genap', ta_teks: '',
        tampil: { kode: 1, nama: 0, guru: 1, ruang: 0, gabungan: 0, kolomJam: 118, kolomFont: 9 }
      }
    });
    ok('desain jadwal dengan isi sel ringkas tersimpan', r.status === 200, r.body?.error);
    ok('konfigurasi tampil tersimpan apa adanya', Number(r.body.tampil.kolomJam) === 118
      && Number(r.body.tampil.kolomFont) === 9 && Number(r.body.tampil.nama) === 0, JSON.stringify(r.body.tampil));

    let cetak = await req('/api/jadwal/cetak?mode=kelas');
    const html = String(cetak.body || '');
    ok('cetak jadwal memuat lebar kolom JAM pilihan', /th\.jam\{width:118px/.test(html), (html.match(/th\.jam\{[^}]*/) || [])[0]);
    ok('cetak jadwal memuat ukuran font pilihan', /table\.grid th,table\.grid td\{[^}]*font-size:9pt/.test(html),
      (html.match(/table\.grid th,table\.grid td\{[^}]*/) || [])[0]);
    ok('nama mapel DISEMBUNYIKAN saat pilihan nama dimatikan', !html.includes('Matematika Uji'));
    ok('kode mapel & nama guru tetap dicetak', html.includes('MTKU') && html.includes('Guru Pengingat Uji'));

    cetak = await req('/api/jadwal/cetak?mode=vertikal');
    ok('matriks vertikal juga memakai pilihan isi sel', !String(cetak.body).includes('Matematika Uji')
      && String(cetak.body).includes('MTKU'), 'vertikal');

    r = await req('/api/jadwal/desain', {
      method: 'POST', body: { judul: 'JADWAL PELAJARAN', tampil: { kode: 0, nama: 0 } }
    });
    ok('validasi: kode & nama sama-sama mati ditolak 400', r.status === 400, JSON.stringify(r.body));
    r = await req('/api/jadwal/desain');
    ok('penolakan tidak mengubah setting sebelumnya', Number(r.body.tampil.kode) === 1 && Number(r.body.tampil.kolomJam) === 118,
      JSON.stringify(r.body.tampil));

    /* kembalikan ke lengkap untuk sisa pengujian */
    await req('/api/jadwal/desain', {
      method: 'POST',
      body: { judul: 'JADWAL PELAJARAN', tampil: { kode: 1, nama: 1, guru: 1, ruang: 1, gabungan: 1, kolomJam: 96, kolomFont: 8 } }
    });
    cetak = await req('/api/jadwal/cetak?mode=kelas');
    ok('pilihan lengkap: nama mapel + ruang ikut tercetak', String(cetak.body).includes('Matematika Uji')
      && String(cetak.body).includes('R-01'));

    r = await req('/api/jadwal/export.xlsx');
    ok('ekspor Excel jadwal tetap berhasil', r.status === 200 && String(r.ct).includes('spreadsheet'), r.status);

    /* ---------------- 2. WHATSAPP: PENGINGAT & PERINGATAN ---------------- */
    console.log('\n== 2. PENGINGAT JADWAL & PERINGATAN CHECK-IN ==');
    r = await req('/api/wa/pengaturan', {
      method: 'POST',
      body: {
        aktif: true, provider: 'fonnte', url: WA_URL, token: 'TOKEN-UJI', header: 'Authorization', prefix: 'Bearer ',
        kepsek_wa: '081200001111', wakasek_kur_wa: '081200002222', piket_wa: '081200003333'
      }
    });
    ok('gateway Fonnte tiruan dikonfigurasi', r.status === 200, r.body?.error);

    waHits.length = 0;
    r = await req('/api/wa/uji', {
      method: 'POST',
      body: { phone: '081200009999', pesan: 'Tes token tersimpan', aktif: true, url: WA_URL, provider: 'fonnte', prefix: 'Bearer ' }
    });
    ok('tes gateway memakai token tersimpan tanpa awalan Bearer', r.status === 200
      && waHits.some(hit => hit.auth === 'TOKEN-UJI'), JSON.stringify({ response: r.body, auth: waHits.map(hit => hit.auth) }));

    waHits.length = 0;
    r = await req('/api/wa/uji', {
      method: 'POST',
      body: {
        phone: '081200009998', pesan: 'Tes token terbaru', aktif: true, url: WA_URL,
        provider: 'fonnte', token: 'Bearer TOKEN-TERBARU', prefix: 'Bearer '
      }
    });
    ok('tes gateway menggunakan token baru yang belum disimpan', r.status === 200
      && waHits.some(hit => hit.auth === 'TOKEN-TERBARU'), JSON.stringify({ response: r.body, auth: waHits.map(hit => hit.auth) }));

    r = await req('/api/wa/pengaturan', {
      method: 'POST',
      body: { jadwal_ingat_aktif: 1, jadwal_ingat_menit: 15, jadwal_telat_aktif: 1, jadwal_telat_menit: 15, jadwal_telat_atasan_aktif: 1 }
    });
    ok('sakelar pengingat & peringatan disimpan', r.status === 200, r.body?.error);
    r = await req('/api/wa/pengaturan');
    const cfgWa = r.body.config || {};
    ok('konfigurasi terbaca kembali', Number(cfgWa.jadwal_ingat_aktif) === 1 && Number(cfgWa.jadwal_ingat_menit) === 15
      && Number(cfgWa.jadwal_telat_menit) === 15 && Number(cfgWa.jadwal_telat_atasan_aktif) === 1,
      JSON.stringify({ i: cfgWa.jadwal_ingat_aktif, m: cfgWa.jadwal_ingat_menit, a: cfgWa.jadwal_telat_atasan_aktif }));
    ok('contoh template pengingat & peringatan tersedia', /{guru}/.test(cfgWa.contoh_template_jadwal_ingat || '')
      && /{lewat}/.test(cfgWa.contoh_template_jadwal_telat || '')
      && /{guru}/.test(cfgWa.contoh_template_jadwal_telat_atasan || ''));
    ok('nomor guru piket tersimpan ternormalisasi', /^62/.test(String(cfgWa.piket_wa || '')), cfgWa.piket_wa);

    r = await req('/api/wa/pengaturan', { method: 'POST', body: { jadwal_ingat_menit: 0 } });
    ok('validasi: menit pengingat 0 ditolak', r.status === 400, JSON.stringify(r.body));
    r = await req('/api/wa/pengaturan', { method: 'POST', body: { jadwal_telat_menit: 500 } });
    ok('validasi: menit keterlambatan > 180 ditolak', r.status === 400, JSON.stringify(r.body));

    waHits.length = 0;
    r = await req('/api/wa/jadwal/cek', { method: 'POST', body: {} });
    ok('pemeriksaan pengingat dapat dijalankan manual', r.status === 200, r.body?.error);
    ok('pengingat sebelum jam pelajaran terkirim', Number(r.body.ingat) >= 1, JSON.stringify(r.body));
    ok('peringatan guru belum check-in terkirim', Number(r.body.telat) >= 1, JSON.stringify(r.body));
    ok('laporan ke manajemen terkirim', Number(r.body.atasan) >= 1, JSON.stringify(r.body));

    const pesan = pesanTerkirim();
    const isiIngat = pesan.find(x => /menit lagi jadwal mengajar/i.test(x)) || '';
    ok('pesan pengingat memuat nama guru', /Guru Pengingat Uji/.test(isiIngat), isiIngat.slice(0, 120));
    ok('pesan pengingat memuat mapel, kelas, ruang & jam', /Matematika Uji/.test(isiIngat)
      && /R-01/.test(isiIngat) && new RegExp(hhmm(A_MULAI)).test(isiIngat), isiIngat.slice(0, 200));
    ok('pengingat dikirim ke nomor HP guru', targetDari(isiIngat) === '6281200000777', targetDari(isiIngat));

    const isiTelat = pesan.find(x => /Peringatan Kehadiran Mengajar/i.test(x)) || '';
    ok('pesan peringatan ke guru memuat jam & menit terlambat', /Peringatan Kehadiran Mengajar/.test(isiTelat)
      && /Matematika Uji/.test(isiTelat) && /berjalan \*20 menit\*/.test(isiTelat), isiTelat.slice(0, 220));
    ok('peringatan ke guru dikirim ke nomor guru', targetDari(isiTelat) === '6281200000777', targetDari(isiTelat));

    const isiAtasan = pesan.find(x => /Laporan Guru Belum Check-in/i.test(x)) || '';
    ok('laporan manajemen memuat nama guru & kelas', /Guru Pengingat Uji/.test(isiAtasan) && /Matematika Uji/.test(isiAtasan),
      isiAtasan.slice(0, 160));
    const targetAtasan = waHits.map(h => targetDari(decodeURIComponent(String(h.body || '').replace(/\+/g, ' '))));
    ok('laporan dikirim ke Kepala Sekolah, Wakasek & Guru Piket',
      targetAtasan.includes('6281200001111') && targetAtasan.includes('6281200002222') && targetAtasan.includes('6281200003333'),
      JSON.stringify([...new Set(targetAtasan)]));
    ok('header token gateway dikirim', waHits.every(h => /TOKEN-UJI/.test(String(h.auth))));

    /* anti dobel: jalankan lagi → tidak ada pesan baru */
    const sebelum = waHits.length;
    r = await req('/api/wa/jadwal/cek', { method: 'POST', body: {} });
    await new Promise(x => setTimeout(x, 300));
    ok('pemeriksaan ulang tidak mengirim pesan dobel', waHits.length === sebelum, `${sebelum} → ${waHits.length}`);
    ok('hasil kedua melaporkan 0 kiriman', Number(r.body.ingat) === 0 && Number(r.body.telat) === 0, JSON.stringify(r.body));

    /* setelah guru check-in, peringatan tidak dikirim lagi untuk slot itu */
    await login('gururing', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotTelat, tanggal: TODAY, status: 'hadir' } });
    ok('guru dapat check-in pada sesi yang berjalan', r.status === 200, r.body?.error);
    await login('admin', 'admin123');
    r = await req('/api/wa/log?limit=30');
    const logWa = (r.body.rows || []).map(x => String(x.jenis || ''));
    ok('riwayat WhatsApp mencatat pengingat & peringatan',
      logWa.includes('jadwal-ingat') && logWa.includes('jadwal-telat') && logWa.includes('jadwal-telat-atasan'),
      JSON.stringify([...new Set(logWa)]));

    /* RBAC: role tanpa izin pengaturan tidak boleh memicu pemeriksaan */
    await req('/api/users/save', {
      method: 'POST', body: { nama: 'Guru Biasa', username: 'gurubiasa', password: 'guru123', role: 'guru_umum', roles: ['guru'] }
    });
    await login('gurubiasa', 'guru123');
    r = await req('/api/wa/jadwal/cek', { method: 'POST', body: {} });
    ok('pengguna tanpa izin pengaturan ditolak (403)', r.status === 403, r.status);
    await login('admin', 'admin123');

    /* ---------------- 3. NOTIFIKASI GURU TIDAK HADIR ---------------- */
    console.log('\n== 3. NOTIFIKASI GURU TIDAK HADIR (JADWAL SUDAH DIHAPUS) ==');
    /* baris absensi dengan jadwal_id yang tidak ada lagi (kasus nyata di lapangan) */
    run(`INSERT INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,waktu_submit,ip,validasi,created_at,updated_at)
      VALUES(?,?,?,?,'alpha','','Otomatis ALFA — slot jadwal sudah dihapus',?, '','',?,?)`,
      987654, TODAY, gId, 1, `${TODAY} 07:10:00`, `${TODAY} 07:10:00`, `${TODAY} 07:10:00`);
    r = await req('/api/guru-pengganti?tanggal=' + TODAY);
    ok('endpoint guru pengganti tetap 200', r.status === 200, r.body?.error);
    ok('baris absensi tanpa jadwal TIDAK muncul sebagai notifikasi',
      !(r.body.tidak_hadir || []).some(z => Number(z.jadwal_id) === 987654), JSON.stringify(r.body.tidak_hadir));
    ok('notifikasi yang tampil selalu punya mapel & sesi',
      (r.body.tidak_hadir || []).every(z => !!z.mapel_nama && !!z.sesi), JSON.stringify(r.body.tidak_hadir));

    /* hapus slot yang punya riwayat absensi → ikut terhapus (cascade) */
    run(`INSERT INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,waktu_submit,ip,validasi,created_at,updated_at)
      VALUES(?,?,?,?,'alpha','','uji cascade',?, '','',?,?)`,
      slotIngat, TODAY, gId, 1, `${TODAY} 08:00:00`, `${TODAY} 08:00:00`, `${TODAY} 08:00:00`);
    ok('baris absensi uji cascade tersimpan', q('SELECT id FROM absensi_guru WHERE jadwal_id=?', slotIngat).length === 1);
    r = await req(`/api/jadwal/slot/${slotIngat}`, { method: 'DELETE' });
    ok('slot jadwal dapat dihapus', r.status === 200, r.body?.error);
    ok('absensi guru milik slot ikut terhapus', q('SELECT id FROM absensi_guru WHERE jadwal_id=?', slotIngat).length === 0);
    r = await req('/api/guru-pengganti?tanggal=' + TODAY);
    ok('notifikasi untuk slot terhapus hilang', !(r.body.tidak_hadir || []).some(z => Number(z.jadwal_id) === Number(slotIngat)),
      JSON.stringify(r.body.tidak_hadir));

    /* ---------------- 4. PEMBERSIHAN SAAT SERVER START ---------------- */
    console.log('\n== 4. PEMBERSIHAN OTOMATIS SAAT SERVER START ==');
    run(`INSERT INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,waktu_submit,ip,validasi,created_at,updated_at)
      VALUES(?,?,?,?,'alpha','','yatim sebelum restart',?, '','',?,?)`,
      555111, TODAY, gId, 1, `${TODAY} 09:00:00`, `${TODAY} 09:00:00`, `${TODAY} 09:00:00`);
    run(`INSERT INTO absensi_guru_izin(jadwal_id,tanggal,ta_id,guru_id,status,catatan,waktu_submit,created_at,updated_at)
      VALUES(?,?,?,?,'izin','yatim izin',?,?,?)`, 555222, TODAY, 1, gId, `${TODAY} 09:00:00`, `${TODAY} 09:00:00`, `${TODAY} 09:00:00`);
    ok('baris yatim tersimpan sebelum restart', q('SELECT id FROM absensi_guru WHERE jadwal_id=555111').length === 1);

    srv.kill();
    await new Promise(x => setTimeout(x, 1200));
    srv = bootServer();
    await tungguServer();
    await new Promise(x => setTimeout(x, 900));
    await login('admin', 'admin123');
    await req('/api/guru-pengganti?tanggal=' + TODAY);   // memicu koneksi DB sekolah
    await new Promise(x => setTimeout(x, 500));
    ok('absensi yatim dibersihkan otomatis saat start', q('SELECT id FROM absensi_guru WHERE jadwal_id=555111').length === 0);
    ok('rekam izin yatim ikut dibersihkan', q('SELECT id FROM absensi_guru_izin WHERE jadwal_id=555222').length === 0);
    r = await req('/api/guru-pengganti?tanggal=' + TODAY);
    ok('panel notifikasi bersih dari data hantu',
      (r.body.tidak_hadir || []).every(z => ![555111, 555222].includes(Number(z.jadwal_id))), JSON.stringify(r.body.tidak_hadir));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    try { srv.kill(); } catch (e) { /* abaikan */ }
    try { wa.close(); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== ${fail ? 'GAGAL' : 'LULUS'} — ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) console.log('Gagal:\n- ' + fails.join('\n- '));
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})();
