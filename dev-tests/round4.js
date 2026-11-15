'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* ============================================================================
   RONDE 4 — Ekspor/Impor database, Kelola File (media manager), stabilitas sesi,
   filter pencarian instan, kop surat dinamis, field website tanpa https://.

   1. Ekspor database: .json (lama) & .zip (database.json + CSV + media.json + README)
   2. Impor database: ZIP maupun JSON, validasi berkas asing ditolak, admin-only
   3. Kelola File: daftar berkas, checkbox & hapus masal, info penyimpanan
   4. Batas unggah default 2 MB (dapat diubah) + penolakan berkas melebihi batas
   5. Sesi login persisten: tetap masuk setelah server restart & keep-alive
   6. Filter pencarian: siswa-options?q=, kategori jurnal, nama tindak lanjut
   7. Kop surat dinamis: sumber auto/manual, teks tambahan, font per baris, logo terpisah
   8. Website tanpa https:// disimpan dengan protokol & tampil tanpa protokol
============================================================================ */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const zlib = require('zlib');
const Database = require('better-sqlite3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-r4-'));
const DB = path.join(TMP, 'tt.sqlite');
const PORT = 3681;
const base = `http://127.0.0.1:${PORT}`;
let KODE = '';
const env = { ...process.env, PORT, DB_PATH: DB, DEMO_SEED: '1' };
function start() {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { log += d; });
  p.stderr.on('data', d => { log += d; });
  return p;
}
let srv = start();
let log = '';

const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); if (!cond) console.log('FAIL', name, '→', extra); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => { try { return decodeURIComponent(String(s)); } catch (e) { return String(s); } };
let cookie = '';
async function req(method, url, body, opt = {}) {
  const headers = {};
  if (opt.cookie !== undefined) { if (opt.cookie) headers.Cookie = opt.cookie; } else if (cookie) headers.Cookie = cookie;
  let payload = null;
  if (body !== undefined && body !== null) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && opt.cookie === undefined) cookie = sc.split(';')[0];
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch (e) { }
  return { status: r.status, json, text: buf.toString('utf8'), buf, loc: r.headers.get('location') || '', type: r.headers.get('content-type') || '' };
}

(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/login')) .status === 200 || true) { const r = await fetch(base + '/api/public/config'); if (r.ok) break; } } catch (e) { } await sleep(150); }

  /* ---------- login ---------- */
  KODE = ((await (await fetch(base + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
  let r = await req('POST', '/api/login', { username: 'admin', password: 'admin123', kode: KODE });
  ok('login administrator', r.status === 200 && r.json && r.json.ok, String(r.status));
  const cookieAwal = cookie;

  /* ================== 1. EKSPOR DATABASE ================== */
  r = await req('GET', '/api/backup/info');
  ok('info backup tersedia', r.status === 200 && r.json.total > 20, String(r.json && r.json.total));
  r = await req('GET', '/api/backup/json');
  ok('ekspor JSON berhasil', r.status === 200 && r.type.includes('json') && r.buf.length > 500, String(r.status));
  const dumpJson = JSON.parse(r.buf.toString('utf8'));
  ok('ekspor JSON memuat penanda aplikasi', dumpJson.app === 'tata-tertib-sekolah');
  ok('ekspor JSON memuat tabel uploads', Array.isArray(dumpJson.tabel.uploads));

  r = await req('GET', '/api/backup/zip');
  ok('ekspor ZIP berhasil', r.status === 200 && r.type.includes('zip') && r.buf[0] === 0x50, String(r.status));
  const zipBuf = r.buf;
  const entries = require('../xlsx-read').unzipEntries(zipBuf);
  const names = Object.keys(entries);
  ok('ZIP memuat database.json', names.includes('database.json'));
  ok('ZIP memuat CSV per tabel', names.some(n => n.startsWith('data/') && n.endsWith('.csv')), names.filter(n => n.startsWith('data/')).slice(0, 3).join(','));
  ok('ZIP memuat media.json & README', names.includes('media.json') && names.includes('README.txt'));
  const zipDump = JSON.parse(entries['database.json'].toString('utf8'));
  ok('database.json di dalam ZIP valid', zipDump.app === 'tata-tertib-sekolah' && Object.keys(zipDump.tabel).length >= 15);
  const tgToken = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890';
  r = await req('POST', '/api/backup/telegram', { auto: true, jam: '06:00', chat_id: '-100123' });
  ok('backup otomatis tidak dapat diaktifkan tanpa token bot', r.status === 400, String(r.status));
  r = await req('POST', '/api/backup/telegram', {
    bot_token: tgToken, chat_id: '-100123', jam: '06:00, 15:00', auto: false
  });
  ok('konfigurasi Telegram sekolah tersimpan tanpa mengembalikan token', r.status === 200
    && r.json.telegram.token_set && !JSON.stringify(r.json).includes(tgToken), JSON.stringify(r.json.telegram));
  r = await req('GET', '/api/setup-checklist');
  ok('checklist setup administrator memuat delapan tahap', r.status === 200
    && r.json.total === 8 && Object.keys(r.json.stages || {}).length === 8, JSON.stringify(r.json && Object.keys(r.json.stages || {})));
  ok('backup checklist belum selesai saat jadwal otomatis nonaktif', r.status === 200
    && r.json.stages.backup.complete === false && Number.isInteger(r.json.percent));
  r = await req('POST', '/api/backup/telegram', { jam: '25:00', auto: false });
  ok('jam backup dengan format salah ditolak', r.status === 400, String(r.status));
  r = await req('GET', '/api/backup/info');
  ok('info backup hanya mengirim status token tersamar', r.status === 200
    && r.json.telegram.token_set && !JSON.stringify(r.json).includes(tgToken));
  r = await req('GET', '/api/backup/json');
  const jsonDumpSafe = JSON.parse(r.buf.toString('utf8'));
  ok('ekspor JSON tidak menyertakan token Telegram', (jsonDumpSafe.tabel.settings || [])
    .find(x => x.key === 'backup_telegram_bot_token')?.value === '');
  r = await req('GET', '/api/backup/zip');
  const tgZipEntries = require('../xlsx-read').unzipEntries(r.buf);
  const tgZipDump = JSON.parse(tgZipEntries['database.json'].toString('utf8'));
  ok('arsip ZIP dan CSV tidak menyertakan token Telegram', (tgZipDump.tabel.settings || [])
    .find(x => x.key === 'backup_telegram_bot_token')?.value === ''
    && !tgZipEntries['data/settings.csv'].toString('utf8').includes(tgToken));

  /* ================== 2. KELOLA FILE & BATAS UNGGAH ================== */
  const db = new Database(DB);
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/9wAAAABJRU5ErkJggg==';
  r = await req('POST', '/api/upload', { base64: pngB64, filename: 'bukti-uji.png', jenis: 'bukti' });
  ok('unggah berkas kecil berhasil', r.status === 200 && r.json && r.json.url, String(r.status));
  ok('unggah tercatat pada tabel uploads', db.prepare('SELECT COUNT(*) c FROM uploads').get().c >= 1);
  r = await req('POST', '/api/upload', { base64: pngB64, filename: 'bukti-2.png', jenis: 'logo' });
  ok('unggah kedua (logo) berhasil', r.status === 200);

  r = await req('GET', '/api/files');
  ok('daftar berkas dapat dibuka', r.status === 200 && Array.isArray(r.json.rows) && r.json.rows.length >= 2, String(r.json && r.json.rows.length));
  ok('info penyimpanan disertakan', r.json.storage && r.json.storage.used_bytes > 0 && r.json.storage.quota_mb >= 50);
  const idBerkas = r.json.rows.map(x => x.id);
  r = await req('GET', '/api/files?q=bukti-uji');
  ok('pencarian berkas berfungsi', r.json.rows.length === 1 && r.json.rows[0].filename === 'bukti-uji.png', String(r.json.rows.length));
  r = await req('GET', '/api/files?jenis=logo');
  ok('filter jenis berkas berfungsi', r.json.rows.every(x => x.jenis === 'logo') && r.json.rows.length >= 1);

  // hapus masal
  r = await req('POST', '/api/files/delete', { ids: idBerkas });
  ok('hapus masal berkas berhasil', r.status === 200 && r.json.dihapus === idBerkas.length, JSON.stringify(r.json && r.json.dihapus));
  ok('berkas terhapus dari database', db.prepare('SELECT COUNT(*) c FROM uploads').get().c === 0);

  // batas ukuran default 2 MB (2048 KB) & dapat diubah
  const st0 = db.prepare("SELECT value FROM settings WHERE key='upload_max_kb'").get();
  ok('batas unggah default 2048 KB (2 MB)', st0 && Number(st0.value) === 2048, st0 && st0.value);
  // berkas > batas → ditolak
  const bigB64 = Buffer.alloc(2100 * 1024, 7).toString('base64');
  r = await req('POST', '/api/upload', { base64: bigB64, filename: 'besar.jpg', jenis: 'bukti' });
  ok('berkas melebihi batas ditolak', r.status === 400 && /melebihi batas/i.test(r.json.error), String(r.status) + ' ' + (r.json && r.json.error));
  // ubah batas → 512 KB lalu berkas 600 KB ditolak, 300 KB lolos
  r = await req('POST', '/api/settings/save', { data: { upload_max_kb: '512', storage_quota_mb: '2048', upload_jpeg_quality: '0.8', upload_max_side: '1400' } });
  ok('batas unggah dapat diubah lewat pengaturan', r.status === 200 && Number(db.prepare("SELECT value FROM settings WHERE key='upload_max_kb'").get().value) === 512);
  r = await req('POST', '/api/upload', { base64: Buffer.alloc(600 * 1024, 3).toString('base64'), filename: 'sedang.jpg' });
  ok('batas baru langsung berlaku (600 KB ditolak)', r.status === 400, String(r.status));
  r = await req('POST', '/api/upload', { base64: Buffer.alloc(100 * 1024, 3).toString('base64'), filename: 'kecil.jpg' });
  ok('berkas di bawah batas baru diterima', r.status === 200, String(r.status));
  r = await req('POST', '/api/settings/save', { data: { upload_max_kb: '999999' } });
  ok('batas unggah tidak wajar ditolak', r.status === 400, String(r.status));
  await req('POST', '/api/settings/save', { data: { upload_max_kb: '2048' } });
  await req('POST', '/api/files/delete', { ids: db.prepare('SELECT id FROM uploads').all().map(x => x.id) });

  /* ================== 3. SESI PERSISTEN ================== */
  r = await req('POST', '/api/session/touch');
  ok('keep-alive sesi berjalan', r.status === 200 && r.json.ok && r.json.days >= 1, String(r.status));
  r = await req('GET', '/api/session/info');
  ok('info sesi aktif', r.status === 200 && r.json.aktif === true);
  /* sesi kini disimpan di control plane (saas_sesi) agar server tahu sekolah mana
     yang harus dibuka SEBELUM menyentuh database sekolah */
  const saasDb = new Database(path.join(TMP, 'saas.sqlite'), { readonly: true });
  ok('sesi tersimpan di database (tabel saas_sesi)', saasDb.prepare('SELECT COUNT(*) c FROM saas_sesi').get().c >= 1);
  const expAwal = String(saasDb.prepare('SELECT expires_at FROM saas_sesi ORDER BY last_seen DESC LIMIT 1').get().expires_at);
  saasDb.close();

  // restart server → sesi harus tetap berlaku (dulu hilang karena disimpan di memori)
  srv.kill('SIGKILL');
  await sleep(700);
  srv = start();
  for (let i = 0; i < 120; i++) { try { const rr = await fetch(base + '/api/public/config'); if (rr.ok) break; } catch (e) { } await sleep(150); }
  const cookieLama = cookieAwal;
  r = await req('GET', '/api/bootstrap', null, { cookie: cookieLama });
  ok('tetap login setelah server restart', r.status === 200 && r.json.user && r.json.user.username === 'admin',
    String(r.status) + ' user=' + (r.json && r.json.user && r.json.user.username));
  r = await req('GET', '/api/files', null, { cookie: cookieLama });
  ok('endpoint terproteksi tetap bisa diakses setelah restart', r.status === 200, String(r.status));
  cookie = cookieLama;

  /* ================== 4. FILTER PENCARIAN INSTAN ================== */
  const siswaNama = (db.prepare("SELECT nama FROM siswa WHERE status='aktif' ORDER BY id LIMIT 1").get() || {}).nama || '';
  const potong = String(siswaNama).slice(0, 3).toLowerCase();
  r = await req('GET', '/api/siswa-options?q=' + encodeURIComponent(potong));
  ok('siswa-options mendukung pencarian q', r.status === 200 && r.json.rows.length >= 1
    && r.json.rows.every(s => (s.nama + ' ' + (s.kelas_nama || '') + ' ' + (s.nis || '')).toLowerCase().includes(potong)),
    `${potong} → ${r.json && r.json.rows.length}`);
  r = await req('GET', '/api/siswa-options?q=' + encodeURIComponent('zzzz-tidak-ada'));
  ok('pencarian tanpa hasil mengembalikan daftar kosong', r.status === 200 && r.json.rows.length === 0);

  const kat = db.prepare("SELECT * FROM kategori ORDER BY id LIMIT 1").get();
  ok('kategori tersedia untuk filter', !!kat);
  r = await req('GET', '/api/jurnal?kategori=' + kat.id);
  ok('jurnal dapat difilter per kategori', r.status === 200 && (r.json.rows || []).every(x => Number(x.kategori_id) === Number(kat.id)),
    String((r.json.rows || []).length));
  r = await req('GET', '/api/jurnal?jenis=prestasi');
  ok('jurnal dapat difilter per jenis', r.status === 200 && (r.json.rows || []).every(x => x.jenis === 'prestasi'));
  r = await req('GET', '/api/tindak-lanjut?q=' + encodeURIComponent(String(siswaNama).slice(0, 4)));
  ok('tindak lanjut mendukung pencarian nama', r.status === 200 && Array.isArray(r.json.rows));

  /* ================== 5. KOP SURAT DINAMIS ================== */
  r = await req('GET', '/api/settings');
  const setAwal = r.json.settings;
  ok('pengaturan kop tersedia (default auto)', String(setAwal.kop_sumber) === 'auto', String(setAwal.kop_sumber));
  ok('logo kop terpisah tersedia', setAwal.kop_logo !== undefined);
  r = await req('POST', '/api/settings/save', {
    data: {
      kop_sumber: 'manual',
      kop_baris: 'YAYASAN UJI PENDIDIKAN\nUNIT SMK UJI\nSMK UJI MANDIRI\nJl. Uji No. 1 • Telp. 0265 111',
      kop_baris_tambahan: 'AKREDITASI: A',
      kop_format: JSON.stringify([{ size: 12, bold: true }, { size: 9 }, { size: 14, bold: true }, { size: 8 }]),
      kop_posisi: 'tengah', kop_rapat: 'kanan', kop_garis: 'single', kop_font: '10.5', kop_font_besar: '16'
    }
  });
  ok('pengaturan kop surat disimpan', r.status === 200, String(r.status));
  r = await req('GET', '/api/settings');
  ok('sumber kop manual tersimpan', String(r.json.settings.kop_sumber) === 'manual');
  ok('posisi & perataan kop tersimpan', String(r.json.settings.kop_posisi) === 'tengah' && String(r.json.settings.kop_rapat) === 'kanan',
    `posisi=${r.json.settings.kop_posisi} rapat=${r.json.settings.kop_rapat}`);
  ok('teks tambahan kop tersimpan', /AKREDITASI/.test(String(r.json.settings.kop_baris_tambahan)));
  r = await req('POST', '/api/settings/save', { data: { kop_posisi: 'diagonal' } });
  ok('posisi logo kop tidak dikenal ditolak', r.status === 400, String(r.status));
  r = await req('POST', '/api/settings/save', { data: { kop_sumber: 'campur' } });
  ok('sumber kop tidak dikenal ditolak', r.status === 400, String(r.status));
  // dokumen cetak memakai kop dinamis (teks manual + tambahan + font per baris)
  r = await req('GET', '/api/rekap/print');
  ok('cetakan memakai baris kop manual', r.status === 200 && /YAYASAN UJI PENDIDIKAN/.test(r.text), String(r.status));
  ok('cetakan memuat teks kop tambahan', /AKREDITASI: A/.test(r.text));
  ok('cetakan memakai ukuran font per baris (12pt)', /font-size:12pt/.test(r.text));
  ok('posisi logo mengikuti pengaturan (tengah)', /flex-direction:column/.test(r.text),
    (r.text.match(/class="kop"[^>]{0,120}/) || ['(kop tidak ditemukan)'])[0]);
  // kembali ke otomatis: kop mengikuti identitas sekolah
  r = await req('POST', '/api/settings/save', { data: { kop_sumber: 'auto', kop_baris_tambahan: '' } });
  r = await req('GET', '/api/rekap/print');
  ok('kop otomatis memakai identitas sekolah', r.status === 200 && new RegExp(String(setAwal.sekolah_nama).toUpperCase().slice(0, 12)).test(r.text));

  /* ================== 6. FIELD WEBSITE TANPA HTTPS ================== */
  r = await req('POST', '/api/settings/save', { data: { sekolah_website: 'www.sekolah-uji.sch.id' } });
  ok('website tanpa https:// diterima', r.status === 200, String(r.status));
  ok('website disimpan lengkap dengan protokol', db.prepare("SELECT value FROM settings WHERE key='sekolah_website'").get().value === 'https://www.sekolah-uji.sch.id',
    db.prepare("SELECT value FROM settings WHERE key='sekolah_website'").get().value);
  r = await req('POST', '/api/settings/save', { data: { sekolah_website: 'bukan url' } });
  ok('website tidak valid ditolak', r.status === 400 && /website/i.test(r.json.error), String(r.status));

  /* ================== 7. IMPOR DATABASE ================== */
  const sebelumImpor = db.prepare('SELECT COUNT(*) c FROM siswa').get().c;
  // tambah 1 siswa lalu pulihkan dari ZIP → jumlah siswa kembali seperti semula
  const kelasUji = db.prepare('SELECT * FROM kelas ORDER BY id LIMIT 1').get();
  const simpanSiswa = await req('POST', '/api/siswa/save', {
    nama: 'Siswa Sebelum Restore', nis: 'R4-001', jenis_kelamin: 'L', status: 'aktif',
    kelas_id: kelasUji ? kelasUji.id : null, tanggal_lahir: '2010-01-05'
  });
  ok('siswa uji dapat disimpan (prasyarat tes impor)', simpanSiswa.status === 200, String(simpanSiswa.status) + ' ' + (simpanSiswa.json && simpanSiswa.json.error));
  ok('data uji ditambahkan sebelum impor', db.prepare('SELECT COUNT(*) c FROM siswa').get().c === sebelumImpor + 1);
  r = await req('POST', '/api/backup/restore', { base64: zipBuf.toString('base64') });
  ok('impor dari ZIP berhasil', r.status === 200 && r.json.ok, String(r.status) + ' ' + (r.json && r.json.error));
  ok('jumlah siswa kembali seperti berkas backup', db.prepare('SELECT COUNT(*) c FROM siswa').get().c === sebelumImpor,
    String(db.prepare('SELECT COUNT(*) c FROM siswa').get().c));
  ok('sesi lama dibersihkan setelah restore', db.prepare('SELECT COUNT(*) c FROM sesi').get().c === 0);
  // login ulang
  r = await req('POST', '/api/login', { username: 'admin', password: 'admin123', kode: KODE });
  ok('login ulang setelah impor', r.status === 200 && r.json.ok);
  // impor JSON lama tetap didukung
  r = await req('GET', '/api/backup/json');
  const jsonLagi = r.buf;
  r = await req('POST', '/api/backup/restore', { base64: jsonLagi.toString('base64') });
  ok('impor dari JSON lama tetap didukung', r.status === 200 && r.json.ok, String(r.status));
  await req('POST', '/api/login', { username: 'admin', password: 'admin123', kode: KODE });
  // berkas asing ditolak
  r = await req('POST', '/api/backup/restore', { base64: Buffer.from('{"app":"aplikasi-lain","tabel":{}}').toString('base64') });
  ok('berkas backup aplikasi lain ditolak', r.status === 400, String(r.status));
  r = await req('POST', '/api/backup/restore', { base64: Buffer.from('bukan json').toString('base64') });
  ok('berkas rusak ditolak', r.status === 400, String(r.status));
  // hanya administrator yang boleh impor
  await req('POST', '/api/users/save', { nama: 'Guru Uji R4', username: 'guru_r4', role: 'guru', password: 'guru12345', aktif: 1 });
  const cookieAdmin = cookie;
  await req('POST', '/api/logout');
  r = await req('POST', '/api/login', { username: 'guru_r4', password: 'guru12345', kode: KODE });
  ok('login guru uji', r.status === 200);
  r = await req('POST', '/api/backup/restore', { base64: jsonLagi.toString('base64') });
  ok('impor database ditolak untuk non-administrator', r.status === 403 || r.status === 401, String(r.status));
  cookie = cookieAdmin;

  /* ---------- hasil ---------- */
  const gagal = results.filter(x => !x.ok);
  console.log('');
  console.log(`round4: ${results.length - gagal.length}/${results.length} cek lulus`);
  if (gagal.length) {
    console.log('GAGAL: ' + gagal.map(g => g.name).join(' | '));
    console.log('LOG SERVER:\n' + log.split('\n').slice(-25).join('\n'));
  }
  db.close();
  srv.kill('SIGKILL');
  process.exit(gagal.length ? 1 : 0);
})().catch(e => {
  console.error('ERROR TES:', e);
  console.log(log.split('\n').slice(-20).join('\n'));
  try { srv.kill('SIGKILL'); } catch (err) { }
  process.exit(1);
});
