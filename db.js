'use strict';
/* =====================================================================
   SMART TATA TERTIB SISWA — lapisan database (SQLite / better-sqlite3)
   ===================================================================== */
require('./tz');                       // terapkan zona waktu WIB sebelum Date dipakai
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const lib = require('./lib');

/* ---------- .env sederhana (tanpa dependency) ---------- */
(function loadEnv() {
  const f = process.env.ENV_FILE || path.join(__dirname, '.env');
  try {
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] !== undefined && process.env[m[1]] !== '') continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* abaikan */ }
})();

const { AsyncLocalStorage } = require('async_hooks');

/* =====================================================================
   MULTI-TENANT: setiap sekolah punya berkas SQLite sendiri.
   Koneksi "aktif" dipilih lewat AsyncLocalStorage sehingga SELURUH kode
   lama (db.prepare/db.exec/db.transaction) otomatis memakai database
   sekolah yang sedang menangani permintaan — tanpa mengubah satu query pun.
   `useTenant(file, fn)` dipanggil server per permintaan; di luar konteks
   itu dipakai koneksi utama (DB_PATH) — mis. saat seed/migrasi awal.
   ===================================================================== */
const DB_PATH = process.env.DB_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'tata-tertib.sqlite')
  : path.join(__dirname, 'data', 'tata-tertib.sqlite'));
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const als = new AsyncLocalStorage();
const CONNS = new Map();

function pragmas(conn) {
  conn.pragma('journal_mode = WAL');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  return conn;
}
/** buka/gunakan koneksi untuk sebuah berkas database (schema diterapkan bila baru) */
function rawConn(file) {
  const key = file === ':memory:' ? file + ':' + Math.random() : file;
  if (CONNS.has(key)) return CONNS.get(key);
  if (key !== ':memory:' && !key.startsWith(':memory:')) fs.mkdirSync(path.dirname(key), { recursive: true });
  const conn = pragmas(new Database(key === ':memory:' ? key : file));
  if (typeof SCHEMA_SQL === 'string' && SCHEMA_SQL) conn.exec(SCHEMA_SQL);
  CONNS.set(key, conn);
  return conn;
}
/** tanda koneksi yang migrasinya sudah dijalankan pada proses ini */
const MIGRATED_CONNS = new Set();
/**
 * Jalankan migrasi (ALTER TABLE + backfill) untuk sebuah koneksi.
 * PENTING: migrasi TIDAK boleh hanya dijalankan untuk DB utama — setiap DB
 * sekolah dibuat pada versi skema yang berbeda, sehingga kolom baru harus
 * ditambahkan saat DB tersebut pertama kali dibuka pada proses ini.
 * (Tanpa ini, sekolah selain tenant utama akan error "no such column".)
 */
function migrateConn(conn) {
  let key = '';
  try { key = conn && conn.name ? String(conn.name) : ''; } catch (e) { key = ''; }
  if (key && MIGRATED_CONNS.has(key)) return;
  try {
    /* skema lengkap hanya perlu dijalankan untuk berkas yang benar-benar baru
       (menghindari puluhan pernyataan CREATE pada DB yang sudah ada). */
    const ada = (() => {
      try { return !!conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='siswa'").get(); }
      catch (e) { return false; }
    })();
    const sudahSeed = (() => {
      try { return !!conn.prepare("SELECT 1 FROM settings WHERE key='seed_version'").get(); }
      catch (e) { return false; }
    })();
    if (!ada) applySchema(conn);
    als.run({ db: conn }, () => {
      runMigrations();
      seedPermissions();
      /* data awal modul BK hanya untuk database yang SUDAH pernah di-seed.
         Database baru di-seed lewat seed() (ensureTenantDb) agar daftar
         kategori bawaan dibuat lebih dulu, baru kategori otomatis absensi. */
      if (sudahSeed) seedFiturBaru();
    });
    if (key) MIGRATED_CONNS.add(key);
  } catch (e) {
    console.error('[db] migrasi database gagal:', key || '(memory)', e.message);
  }
}

/** jalankan fn dengan koneksi database tertentu (dipakai server per permintaan) */
function useTenant(file, fn) {
  const conn = rawConn(file);
  migrateConn(conn);
  return als.run({ db: conn }, fn);
}
const currentConn = () => (als.getStore() && als.getStore().db) || ROOT_DB;
let ROOT_DB = null;

/* proxy: semua pemakaian `db.*` diarahkan ke koneksi aktif */
const db = new Proxy({}, {
  get(_t, prop) {
    const conn = (als.getStore() && als.getStore().db) || ROOT_DB;
    const v = conn[prop];
    return typeof v === 'function' ? v.bind(conn) : v;
  },
  set(_t, prop, val) { currentConn()[prop] = val; return true; },
  has(_t, prop) { return prop in currentConn(); },
  ownKeys() { return Reflect.ownKeys(currentConn()); },
  getOwnPropertyDescriptor(_t, prop) {
    const d = Object.getOwnPropertyDescriptor(currentConn(), prop);
    return d ? { ...d, configurable: true } : undefined;
  }
});
const currentPath = () => { try { return db.name || ''; } catch (e) { return DB_PATH; } };

const now = () => lib.nowStamp();
const today = () => lib.todayISO();
const isoOf = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* =========================== SKEMA =========================== */
/* Tabel modul BK (aduan kekerasan, program layanan, asesmen) dipisah agar dapat
   dijalankan ulang lewat runMigrations() untuk database sekolah yang SUDAH ada
   (applySchema hanya dijalankan pada berkas yang benar-benar baru). */
const BK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS aduan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guru_id INTEGER NOT NULL,
  token TEXT,
  siswa_id INTEGER, nama_siswa TEXT, kelas_id INTEGER, kelas_nama TEXT, tanggal_lahir TEXT,
  jenis TEXT, lokasi TEXT, kronologi TEXT NOT NULL, pelaku TEXT, kontak TEXT,
  status TEXT NOT NULL DEFAULT 'baru',
  tanggapan TEXT, tanggapan_oleh TEXT, tanggapan_at TEXT,
  ta_id INTEGER, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_aduan_guru ON aduan(guru_id, status, created_at);

CREATE TABLE IF NOT EXISTS bk_jenis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT 'responsif',
  sasaran TEXT NOT NULL DEFAULT 'siswa',
  aktif INTEGER NOT NULL DEFAULT 1,
  urut INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS bk_layanan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis_id INTEGER, jenis_nama TEXT, kategori TEXT,
  tanggal TEXT NOT NULL, jam TEXT,
  kelas_ids TEXT, siswa_ids TEXT,
  topik TEXT, tujuan TEXT, uraian TEXT, hasil TEXT, tindak_lanjut TEXT, tempat TEXT,
  foto_url TEXT,
  oleh INTEGER, oleh_nama TEXT, oleh_role TEXT,
  ta_id INTEGER, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bk_layanan_tgl ON bk_layanan(tanggal);

CREATE TABLE IF NOT EXISTS asesmen_instrumen (
  kode TEXT PRIMARY KEY,
  nama TEXT NOT NULL, deskripsi TEXT, petunjuk TEXT,
  tipe TEXT NOT NULL DEFAULT 'centang',
  aktif INTEGER NOT NULL DEFAULT 1,
  token TEXT UNIQUE, token_aktif INTEGER NOT NULL DEFAULT 1,
  versi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS asesmen_soal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT NOT NULL, nomor INTEGER NOT NULL,
  teks TEXT NOT NULL, kategori TEXT, indikator TEXT,
  aktif INTEGER NOT NULL DEFAULT 1, versi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_asesmen_soal ON asesmen_soal(kode, nomor);
CREATE TABLE IF NOT EXISTS asesmen_hasil (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT NOT NULL,
  siswa_id INTEGER, nisn TEXT, nama TEXT,
  kelas_id INTEGER, kelas_nama TEXT,
  jawaban TEXT, skor TEXT, total INTEGER NOT NULL DEFAULT 0, versi INTEGER,
  tanggal TEXT, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asesmen_hasil ON asesmen_hasil(kode, siswa_id);
CREATE INDEX IF NOT EXISTS idx_asesmen_hasil_kelas ON asesmen_hasil(kode, kelas_id);
`;

/* PERMINTAAN TUKAR JADWAL MENGAJAR (temporer: tanggal kejadian pada pekan berjalan).
   status: pending → diterima | ditolak | batal.
   Bila satu permintaan 'diterima' untuk (jadwal_id, tanggal), maka guru
   pengganti (ke_guru) menjadi guru EFEKTIF pada sesi tersebut hari itu.
   Dipisah dari SCHEMA_SQL agar dapat dijalankan ulang lewat runMigrations()
   untuk database sekolah yang sudah berjalan. */
const TUKAR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jadwal_tukar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jadwal_id INTEGER NOT NULL, tanggal TEXT NOT NULL, ta_id INTEGER,
  dari_guru INTEGER NOT NULL, ke_guru INTEGER NOT NULL, mapel_id INTEGER,
  alasan TEXT, alasan_jenis TEXT DEFAULT 'lainnya',
  status TEXT NOT NULL DEFAULT 'pending',
  /* jenis: 'tukar' = pengajuan guru antar rekan · 'penugasan' = penunjukan
     guru pengganti/piket oleh Kepala Sekolah / Wakasek Kurikulum (langsung
     diterima, master jadwal TIDAK diubah — hanya berlaku pada tanggal itu). */
  jenis TEXT DEFAULT 'tukar',
  dibuat_oleh INTEGER, dibuat_nama TEXT,
  permintaan_id INTEGER,
  catatan_putus TEXT, diputus_at TEXT, diputus_oleh INTEGER, diputus_nama TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tukar_slot ON jadwal_tukar(jadwal_id, tanggal, status);
CREATE INDEX IF NOT EXISTS idx_tukar_guru ON jadwal_tukar(ke_guru, status, tanggal);
`;

/* REKAM KETIDAKHADIRAN GURU pada satu slot/tanggal (Sakit/Izin/Alpha).
   Dipisah dari absensi_guru karena absensi_guru hanya boleh satu baris per
   (jadwal,tanggal): bila kurikulum menunjuk GURU PENGGANTI, baris ketidakhadiran
   guru asli dipindahkan ke sini agar guru pengganti dapat check-in & mengisi
   jurnal pada slot yang sama. */
const IZIN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS absensi_guru_izin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jadwal_id INTEGER NOT NULL, tanggal TEXT NOT NULL, ta_id INTEGER,
  guru_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'izin',
  catatan TEXT, materi TEXT, foto_url TEXT,
  waktu_submit TEXT, ip TEXT, validasi TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_guru_izin ON absensi_guru_izin(jadwal_id, tanggal);
`;

/* Penanda penghapusan riwayat rekap per slot/tanggal. Dipakai untuk
   menyembunyikan Alpha historis yang dihitung dari jadwal tanpa baris absensi. */
const ABSENSI_GURU_ABAIKAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS absensi_guru_abaikan (
  jadwal_id INTEGER NOT NULL, tanggal TEXT NOT NULL,
  dibuat_oleh INTEGER, dibuat_nama TEXT, created_at TEXT,
  PRIMARY KEY (jadwal_id, tanggal)
);
`;

/* =====================================================================
   KALENDER AKADEMIK & PEMETAAN JAM GURU (Wakasek Kurikulum)
   ---------------------------------------------------------------------
   · kalender_akademik : tanggal khusus satu tahun ajaran — Libur / Ujian /
     Kegiatan. Bila `nonaktif=1`, jadwal mapel reguler TIDAK BERLAKU pada
     tanggal itu (absensi & alfa otomatis ikut menyesuaikan, master jadwal
     mingguan tidak diubah).
   · guru_jam_target  : target/batas jam mengajar per guru (per minggu &
     per bulan) untuk indikator "kurang jam".
   Dipisah dari SCHEMA_SQL agar dapat dijalankan ulang (DB sekolah lama).
   ===================================================================== */
const KURIKULUM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kalender_akademik (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ta_id INTEGER, tanggal TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT 'libur',      /* libur | ujian | kegiatan */
  judul TEXT, keterangan TEXT,
  nonaktif INTEGER NOT NULL DEFAULT 1,          /* 1 = KBM libur/tidak berlaku */
  oleh INTEGER, oleh_nama TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kalender_tgl ON kalender_akademik(ta_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_kalender_ta ON kalender_akademik(ta_id, tanggal);

CREATE TABLE IF NOT EXISTS guru_jam_target (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guru_id INTEGER NOT NULL UNIQUE,
  target_minggu INTEGER NOT NULL DEFAULT 0,
  target_bulan INTEGER NOT NULL DEFAULT 0,
  catatan TEXT,
  oleh INTEGER, oleh_nama TEXT,
  created_at TEXT, updated_at TEXT
);
`;

/* =====================================================================
   AI TIMETABLE GENERATOR (penyusun jadwal otomatis berbasis aturan)
   ---------------------------------------------------------------------
   · jadwal_beban : beban mengajar per KELAS + MATA PELAJARAN (jam/pekan)
     sekaligus guru pengampu & ruang default untuk slot yang akan dibuat.
     Satu baris = satu mapel pada satu rombel (unique kelas_id+mapel_id).
   · jadwal_ruang : daftar ruangan / laboratorium (opsional, untuk aturan
     "ruang tidak boleh dobel pada jam yang sama").
   Kolom batasan guru (batas jam maksimal per pekan & hari tidak bersedia)
   ditambahkan pada `guru_jam_target` yang sudah ada.
   Migrasi OLD DB: backfill beban dari slot jadwal yang sudah tersusun
   (bila JSON1 tersedia) + backfill daftar ruang dari nilai `ruang` slot.
   ===================================================================== */
const JADWAL_AI_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jadwal_beban (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ta_id INTEGER,
  kelas_id INTEGER NOT NULL,
  mapel_id INTEGER NOT NULL,
  guru_id INTEGER,
  jam_minggu INTEGER NOT NULL DEFAULT 0,
  ruang TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jadwal_beban ON jadwal_beban(kelas_id, mapel_id);
CREATE INDEX IF NOT EXISTS idx_jadwal_beban_ta ON jadwal_beban(ta_id, kelas_id);

CREATE TABLE IF NOT EXISTS jadwal_ruang (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  jenis TEXT NOT NULL DEFAULT 'kelas',
  kapasitas INTEGER NOT NULL DEFAULT 0,
  aktif INTEGER NOT NULL DEFAULT 1,
  catatan TEXT,
  created_at TEXT, updated_at TEXT
);
`;

/* PENCATAT PRESENSI (audit trail pengisian presensi per sesi).
   Dipakai halaman publik (ketua kelas / perwakilan siswa):
   · satu siswa hanya boleh MENGISI satu kali per sesi (unique sesi_id+siswa_id)
   · nama & kelas pencatat ditampilkan pada rekap sebagai "diwakili/diisi oleh". */
const PENCATAT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS absensi_pencatat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id INTEGER NOT NULL, jadwal_id INTEGER, tanggal TEXT,
  siswa_id INTEGER, nama TEXT, kelas TEXT, role TEXT DEFAULT 'ketua_kelas',
  jumlah INTEGER NOT NULL DEFAULT 0, ip TEXT, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_pencatat ON absensi_pencatat(sesi_id, siswa_id);
CREATE INDEX IF NOT EXISTS idx_absensi_pencatat_sesi ON absensi_pencatat(sesi_id);
`;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  jabatan TEXT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guru',
  nip TEXT,
  phone TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  role TEXT NOT NULL, feature TEXT NOT NULL, action TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role, feature, action)
);

CREATE TABLE IF NOT EXISTS tahun_ajaran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  tanggal_mulai TEXT, tanggal_selesai TEXT,
  aktif INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS kelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  tingkat TEXT NOT NULL DEFAULT 'X',
  jurusan TEXT,
  wali_id INTEGER,
  urut INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS siswa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  nis TEXT, nisn TEXT,
  kelas_id INTEGER,
  gender TEXT DEFAULT 'L',
  tanggal_lahir TEXT,
  parent_phone TEXT,
  status TEXT NOT NULL DEFAULT 'aktif',
  tahun_ajaran_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS kategori (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'pelanggaran',
  poin INTEGER NOT NULL DEFAULT 0,
  keterangan TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  urut INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kejadian (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id INTEGER NOT NULL,
  kategori_id INTEGER,
  judul TEXT,
  jenis TEXT NOT NULL DEFAULT 'pelanggaran',
  poin INTEGER NOT NULL DEFAULT 0,
  tanggal TEXT NOT NULL,
  keterangan TEXT,
  bukti_url TEXT,
  ta_id INTEGER,
  semester TEXT,
  oleh INTEGER,
  oleh_nama TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS wa_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id INTEGER, nama TEXT, phone TEXT, jenis TEXT, pesan TEXT,
  oleh INTEGER, oleh_nama TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS surat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id INTEGER, nama TEXT, jenis TEXT, nomor TEXT, poin INTEGER,
  oleh INTEGER, oleh_nama TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, nama TEXT, role TEXT,
  aksi TEXT, modul TEXT, detail TEXT, ip TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS sesi (
  sid TEXT PRIMARY KEY,
  user_id INTEGER,
  created_at TEXT, last_seen TEXT
);

CREATE TABLE IF NOT EXISTS tindak_lanjut (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id INTEGER NOT NULL,
  tanggal TEXT NOT NULL,
  jenis TEXT NOT NULL,
  hasil TEXT,
  status TEXT NOT NULL DEFAULT 'pemantauan',
  next_at TEXT,
  kejadian_id INTEGER,
  oleh INTEGER, oleh_nama TEXT, oleh_role TEXT,
  ta_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS jurnal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal TEXT NOT NULL,
  jam TEXT,
  siswa_id INTEGER,
  kategori_id INTEGER,
  jenis TEXT NOT NULL DEFAULT 'pelanggaran',
  poin INTEGER NOT NULL DEFAULT 0,
  lokasi TEXT,
  keterangan TEXT,
  kejadian_id INTEGER,
  petugas TEXT, petugas_role TEXT, petugas_id INTEGER,
  ta_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tabel TEXT NOT NULL,
  ref_id INTEGER,
  label TEXT,
  data TEXT NOT NULL,
  extra TEXT,
  oleh INTEGER, oleh_nama TEXT,
  deleted_at TEXT, expired_at TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT, url TEXT, mime TEXT, ukuran INTEGER NOT NULL DEFAULT 0,
  jenis TEXT NOT NULL DEFAULT 'bukti',
  ref_tabel TEXT, ref_id INTEGER,
  oleh INTEGER, oleh_nama TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS demo_rows (
  tabel TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  created_at TEXT,
  PRIMARY KEY (tabel, row_id)
);

/* Masukan & Kendala dari pengguna sekolah (rahasia — hanya role ber-hak akses) */
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, nama TEXT, role TEXT, jabatan TEXT,
  jenis TEXT NOT NULL DEFAULT 'masukan',
  judul TEXT, pesan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'baru',
  balasan TEXT, balas_oleh TEXT, balas_at TEXT,
  halaman TEXT, prioritas TEXT NOT NULL DEFAULT 'normal',
  ta_id INTEGER, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);

CREATE INDEX IF NOT EXISTS idx_trash_expired ON trash(expired_at);
CREATE INDEX IF NOT EXISTS idx_kejadian_siswa ON kejadian(siswa_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_tl_siswa ON tindak_lanjut(siswa_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal ON jurnal(tanggal);
CREATE INDEX IF NOT EXISTS idx_kejadian_ta ON kejadian(ta_id, semester);
CREATE INDEX IF NOT EXISTS idx_siswa_kelas ON siswa(kelas_id);

/* Riwayat penempatan kelas per tahun pelajaran (dipakai kenaikan kelas otomatis
   dan kartu siswa agar jenjang/kelas tahun lalu tetap terlihat). */
CREATE TABLE IF NOT EXISTS siswa_kelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siswa_id INTEGER NOT NULL,
  kelas_id INTEGER,
  ta_id INTEGER,
  created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_siswa_kelas_ta ON siswa_kelas(siswa_id, ta_id);
CREATE INDEX IF NOT EXISTS idx_siswa_kelas_siswa ON siswa_kelas(siswa_id);

/* ================= AKADEMIK: MAPEL · JADWAL · ABSENSI ================= */
CREATE TABLE IF NOT EXISTS mapel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT, nama TEXT NOT NULL, kelompok TEXT,
  ruang_id INTEGER,
  aktif INTEGER NOT NULL DEFAULT 1, urut INTEGER NOT NULL DEFAULT 0, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mapel_kode ON mapel(kode);

/* guru pengampu satu mata pelajaran (boleh lebih dari satu guru per mapel) */
CREATE TABLE IF NOT EXISTS guru_mapel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guru_id INTEGER NOT NULL, mapel_id INTEGER NOT NULL, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guru_mapel ON guru_mapel(guru_id, mapel_id);

/* satu baris = satu slot jadwal (hari + sesi). Kelas boleh lebih dari satu
   (fitur merge/penggabungan rombel) → kelas_ids berisi JSON array. */
CREATE TABLE IF NOT EXISTS jadwal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ta_id INTEGER, hari INTEGER NOT NULL, sesi INTEGER NOT NULL,
  mapel_id INTEGER, guru_id INTEGER, kelas_ids TEXT, ruang TEXT,
  merged INTEGER NOT NULL DEFAULT 0, catatan TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jadwal_ta ON jadwal(ta_id, hari, sesi);

/* sesi presensi siswa per (jadwal, tanggal) + token tautan/QR publik */
CREATE TABLE IF NOT EXISTS absensi_sesi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jadwal_id INTEGER, tanggal TEXT, token TEXT UNIQUE,
  ta_id INTEGER, mapel_id INTEGER, guru_id INTEGER, kelas_ids TEXT,
  pencatat TEXT, pencatat_role TEXT,
  created_by INTEGER, created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_sesi ON absensi_sesi(jadwal_id, tanggal);

/* absensi kehadiran guru mengajar (satu baris per slot per tanggal) */
CREATE TABLE IF NOT EXISTS absensi_guru (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jadwal_id INTEGER, tanggal TEXT, guru_id INTEGER, ta_id INTEGER,
  status TEXT NOT NULL DEFAULT 'hadir',
  materi TEXT, catatan TEXT, foto_url TEXT, foto_id INTEGER,
  waktu_submit TEXT, ip TEXT, validasi TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_guru ON absensi_guru(jadwal_id, tanggal);

/* absensi kehadiran siswa per sesi mata pelajaran (H/S/I/A/B) */
CREATE TABLE IF NOT EXISTS absensi_siswa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id INTEGER, jadwal_id INTEGER, tanggal TEXT,
  siswa_id INTEGER, kelas_id INTEGER,
  status TEXT NOT NULL DEFAULT 'H', keterangan TEXT,
  oleh_nama TEXT, oleh_role TEXT, oleh_id INTEGER,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_siswa ON absensi_siswa(sesi_id, siswa_id);
CREATE INDEX IF NOT EXISTS idx_absensi_siswa_tgl ON absensi_siswa(tanggal, kelas_id);

/* PERMINTAAN TUKAR JADWAL MENGAJAR (temporer: satu tanggal saja).
   status: pending → diterima | ditolak | batal.
   Bila satu permintaan 'diterima' untuk (jadwal_id, tanggal), maka guru
   pengganti (ke_guru) menjadi guru EFEKTIF pada sesi tersebut hari itu. */
${TUKAR_SCHEMA_SQL}

/* token tautan publik rekap jadwal pelajaran sekolah */
CREATE TABLE IF NOT EXISTS jadwal_publik (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ta_id INTEGER, token TEXT UNIQUE, aktif INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at TEXT, updated_at TEXT
);

/* ---- modul BK (aduan kekerasan, program layanan, asesmen) ---- */
${BK_SCHEMA_SQL}

${PENCATAT_SCHEMA_SQL}

${IZIN_SCHEMA_SQL}
${ABSENSI_GURU_ABAIKAN_SCHEMA_SQL}
${KURIKULUM_SCHEMA_SQL}
`;

/* koneksi utama dibuat SETELAH skema tersedia (seed dijalankan di akhir berkas,
   sama seperti sebelumnya agar semua nilai bawaan sudah terdefinisi). */
ROOT_DB = rawConn(DB_PATH);
function applySchema(conn) { conn.exec(SCHEMA_SQL); }

/* =========================== MIGRASI KOLOM =========================== */
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
function ensureColumn(table, col, ddl) {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
/** migrasi kolom tambahan — dijalankan untuk DB utama & setiap DB sekolah baru */
function runMigrations() {
  db.transaction(() => {
    ensureColumn('kejadian', 'jam', 'TEXT');
    ensureColumn('kejadian', 'lokasi', 'TEXT');
    ensureColumn('users', 'foto', 'TEXT');
    ensureColumn('tindak_lanjut', 'kejadian_id', 'INTEGER');
    ensureColumn('jurnal', 'kejadian_id', 'INTEGER');
    /* sesi persisten (anti auto-logout setelah server restart) */
    ensureColumn('sesi', 'expires_at', 'TEXT');
    ensureColumn('sesi', 'user_agent', 'TEXT');
    ensureColumn('sesi', 'role', 'TEXT');
    /* penanda tenant (dipakai panel Super Admin) */
    ensureColumn('settings', 'tenant_kode', 'TEXT');
    /* Naikkan kuota bawaan 1 GB ke 5 GB tanpa mengubah kuota yang dikustomisasi. */
    if (getSetting('mig_storage_quota_5gb_v1', '') !== '1') {
      if (String(getSetting('storage_quota_mb', '')) === '1024') {
        setSetting('storage_quota_mb', '5120');
      }
      setSetting('mig_storage_quota_5gb_v1', '1');
    }
    /* WhatsApp massal: status & sumber pengiriman + pencatat */
    ensureColumn('wa_log', 'status', "TEXT DEFAULT 'terkirim'");
    ensureColumn('wa_log', 'sumber', "TEXT DEFAULT 'manual'");
    ensureColumn('wa_log', 'ta_id', 'INTEGER');
    ensureColumn('wa_log', 'error', 'TEXT');
    /* kelas per tahun pelajaran (satu set kelas untuk setiap TA) */
    ensureColumn('kelas', 'tahun_ajaran_id', 'INTEGER');
    /* MULTI-ROLE: satu pengguna boleh memegang beberapa role sekaligus
       (mis. Guru Mata Pelajaran + Wakasek Kurikulum). `role` tetap menjadi
       role utama, `roles` menyimpan daftar tambahan (JSON array). */
    ensureColumn('users', 'roles', 'TEXT');
    /* mata pelajaran: kolom tambahan untuk pengaturan jam maksimal */
    ensureColumn('mapel', 'max_jam_hari', 'INTEGER');
    ensureColumn('mapel', 'ruang_id', 'INTEGER');
    /* ---- MODUL BK & OTOMATISASI POIN ABSENSI ---- */
    /* kategori poin yang dibuat otomatis dari absensi (Alpha / Bolos) */
    ensureColumn('kategori', 'auto_key', 'TEXT');
    /* kejadian yang lahir otomatis menyimpan sumber + id baris absensi agar
       dapat diperbarui/dihapus saat status absensi dikoreksi */
    ensureColumn('kejadian', 'sumber', 'TEXT');
    ensureColumn('kejadian', 'ref_id', 'INTEGER');
    /* kanal aduan kekerasan per guru/BK + nomor layanan bantuan */
    ensureColumn('users', 'aduan_token', 'TEXT');
    ensureColumn('users', 'aduan_token_at', 'TEXT');
    ensureColumn('users', 'aduan_keswa', 'TEXT');
    ensureColumn('users', 'aduan_ppa', 'TEXT');
    /* tabel modul BK untuk database sekolah yang sudah berjalan */
    db.exec(BK_SCHEMA_SQL);
    /* kalender akademik & pemetaan jam guru (kurikulum) */
    db.exec(KURIKULUM_SCHEMA_SQL);
    /* target jam pelajaran per minggu (validasi kurikulum) — boleh berbeda per kelas */
    ensureColumn('kelas', 'target_jam', 'INTEGER');
    /* ---- AI TIMETABLE GENERATOR: beban mapel per kelas, daftar ruang,
            batas jam maksimal guru & hari tidak bersedia ---- */
    db.exec(JADWAL_AI_SCHEMA_SQL);
    ensureColumn('guru_jam_target', 'max_jam', 'INTEGER');
    ensureColumn('guru_jam_target', 'tidak_hadir', 'TEXT');
    /* backfill beban dari slot jadwal yang sudah ada (idempoten) */
    try {
      db.exec(`INSERT OR IGNORE INTO jadwal_beban(ta_id,kelas_id,mapel_id,guru_id,jam_minggu,ruang,created_at,updated_at)
        SELECT j.ta_id, CAST(je.value AS INTEGER), j.mapel_id, MIN(j.guru_id), COUNT(*), MIN(j.ruang), ?, ?
        FROM jadwal j, json_each(j.kelas_ids) je
        WHERE j.mapel_id IS NOT NULL AND TRIM(COALESCE(j.kelas_ids,''))<>''
        GROUP BY j.ta_id, CAST(je.value AS INTEGER), j.mapel_id`, now(), now());
    } catch (e) { /* JSON1 tidak tersedia → beban diatur manual dari panel */ }
    /* backfill daftar ruang/lab dari nilai ruang pada slot yang sudah ada */
    db.exec(`INSERT OR IGNORE INTO jadwal_ruang(nama,jenis,kapasitas,aktif,created_at,updated_at)
      SELECT DISTINCT TRIM(j.ruang), 'kelas', 0, 1, ?, ?
      FROM jadwal j WHERE TRIM(COALESCE(j.ruang,''))<>''`, now(), now());
    /* warna kustom per tanggal kalender akademik (kosong = ikut warna kategori) */
    ensureColumn('kalender_akademik', 'warna', 'TEXT');
    /* permintaan tukar jadwal mengajar (temporer per tanggal) */
    db.exec(TUKAR_SCHEMA_SQL);
    /* kolom penunjukan pengganti (DB sekolah yang sudah berjalan) */
    ensureColumn('jadwal_tukar', 'jenis', "TEXT DEFAULT 'tukar'");
    ensureColumn('jadwal_tukar', 'dibuat_oleh', 'INTEGER');
    ensureColumn('jadwal_tukar', 'dibuat_nama', 'TEXT');
    ensureColumn('jadwal_tukar', 'permintaan_id', 'INTEGER');
    ensureColumn('jadwal_tukar', 'alasan_jenis', "TEXT DEFAULT 'lainnya'");
    /* log undangan/pesan otomatis (alfa siswa, izin guru) — penanda dedupe */
    ensureColumn('wa_log', 'ref', 'TEXT');
    ensureColumn('wa_log', 'modul', 'TEXT');
    /* pencatat presensi (audit trail + batas 1x isi per siswa per sesi) */
    db.exec(PENCATAT_SCHEMA_SQL);
    /* rekam ketidakhadiran guru saat guru pengganti ditunjuk */
    db.exec(IZIN_SCHEMA_SQL);
    db.exec(ABSENSI_GURU_ABAIKAN_SCHEMA_SQL);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_kejadian_ref ON kejadian(sumber, ref_id) WHERE sumber IS NOT NULL AND ref_id IS NOT NULL');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_kategori_auto ON kategori(auto_key) WHERE auto_key IS NOT NULL');
    /* REPARASI SLOT JADWAL YATIM: slot yang dibuat saat peramban masih memilih
       tahun pelajaran yang SUDAH DIHAPUS menyimpan ta_id yang tidak ada. Akibatnya
       slot hilang dari menu Jadwal, Absensi Guru, dan Absensi Siswa per Mapel
       ("Tidak ada jadwal pada tanggal ini") walau jadwalnya jelas tersusun.
       Solusi: pindahkan ke TA milik kelas pada slot tersebut, lalu ke TA aktif. */
    try {
      db.exec(`UPDATE jadwal SET ta_id=(
          SELECT k.tahun_ajaran_id FROM json_each(jadwal.kelas_ids) je
          JOIN kelas k ON k.id=CAST(je.value AS INTEGER)
          WHERE k.tahun_ajaran_id IS NOT NULL LIMIT 1)
        WHERE ta_id IS NULL OR ta_id NOT IN (SELECT id FROM tahun_ajaran)`);
    } catch (e) { /* JSON1 tidak wajib */ }
    db.exec(`UPDATE jadwal SET ta_id=(
        SELECT id FROM tahun_ajaran WHERE aktif=1 ORDER BY id DESC LIMIT 1)
      WHERE (ta_id IS NULL OR ta_id NOT IN (SELECT id FROM tahun_ajaran))
        AND EXISTS(SELECT 1 FROM tahun_ajaran)`);
    /* permintaan tukar yang menunjuk slot jadwal yang sudah tidak ada */
    db.exec('DELETE FROM jadwal_tukar WHERE jadwal_id NOT IN (SELECT id FROM jadwal)');
    db.exec('DELETE FROM absensi_guru_abaikan WHERE jadwal_id NOT IN (SELECT id FROM jadwal)');
    /* ABSENSI YATIM: slot jadwal yang DIHAPUS meninggalkan baris absensi guru
       (termasuk ALFA otomatis) & rekam izin yang tidak punya jadwal lagi.
       Baris seperti itu tetap muncul di panel "Notifikasi Guru Tidak Hadir"
       dengan nama mapel/sesi kosong — padahal jadwalnya sudah tidak ada.
       Semua baris tanpa jadwal dibersihkan di sini (idempoten, sekali per
       koneksi) supaya riwayat hantu tidak tampil lagi. */
    for (const sql of [
      'DELETE FROM absensi_guru_izin WHERE jadwal_id IS NOT NULL AND jadwal_id NOT IN (SELECT id FROM jadwal)',
      'DELETE FROM absensi_guru WHERE jadwal_id IS NOT NULL AND jadwal_id NOT IN (SELECT id FROM jadwal)',
      'DELETE FROM absensi_pencatat WHERE jadwal_id IS NOT NULL AND jadwal_id NOT IN (SELECT id FROM jadwal)',
      /* sesi presensi tanpa jadwal DAN tanpa data siswa (riwayat kosong) — sesi yang
         masih menyimpan presensi siswa DIBIARKAN agar riwayat kehadiran tidak hilang */
      `DELETE FROM absensi_sesi WHERE jadwal_id IS NOT NULL AND jadwal_id NOT IN (SELECT id FROM jadwal)
        AND id NOT IN (SELECT DISTINCT sesi_id FROM absensi_siswa WHERE sesi_id IS NOT NULL)`
    ]) {
      try { db.exec(sql); } catch (e) { /* tabel belum ada pada DB sangat lama */ }
    }
    /* backfill: kelas lama tanpa TA diikutkan ke TA aktif (bila sudah ada) */
    db.exec(`UPDATE kelas SET tahun_ajaran_id=(
        SELECT id FROM tahun_ajaran WHERE aktif=1 ORDER BY id DESC LIMIT 1)
      WHERE tahun_ajaran_id IS NULL
        AND EXISTS(SELECT 1 FROM tahun_ajaran)`);
    /* backfill riwayat penempatan kelas siswa aktif */
    db.exec(`INSERT OR IGNORE INTO siswa_kelas(siswa_id,kelas_id,ta_id)
      SELECT s.id, s.kelas_id, s.tahun_ajaran_id FROM siswa s
      WHERE s.kelas_id IS NOT NULL AND s.tahun_ajaran_id IS NOT NULL`);
  })();
}
runMigrations();

/* ================= JENJANG PENDIDIKAN & KELAS BAWAAN =================
   Saat sekolah mendaftar, daftar kelas dibuat otomatis mengikuti jenjang
   yang dipilih. Semuanya tetap dapat diubah/ditambah di menu Data Kelas. */
const JENJANG = ['PAUD', 'TK', 'SD', 'MI', 'SMP', 'MTs', 'SMA', 'MA', 'SMK'];
const TINGKAT_PER_JENJANG = {
  PAUD: ['Kelompok Bermain', 'TK A'],
  TK: ['TK A', 'TK B'],
  SD: ['I', 'II', 'III', 'IV', 'V', 'VI'],
  MI: ['I', 'II', 'III', 'IV', 'V', 'VI'],
  SMP: ['VII', 'VIII', 'IX'],
  MTs: ['VII', 'VIII', 'IX'],
  SMA: ['X', 'XI', 'XII'],
  MA: ['X', 'XI', 'XII'],
  SMK: ['X', 'XI', 'XII']
};
const JENJANG_LABEL = {
  PAUD: 'PAUD / KB', TK: 'Taman Kanak-kanak', SD: 'Sekolah Dasar', MI: 'Madrasah Ibtidaiyah',
  SMP: 'Sekolah Menengah Pertama', MTs: 'Madrasah Tsanawiyah', SMA: 'Sekolah Menengah Atas',
  MA: 'Madrasah Aliyah', SMK: 'Sekolah Menengah Kejuruan'
};
const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const romanOf = n => ROMAWI[Math.min(12, Math.max(1, Number(n) || 1)) - 1];
/** daftar kelas bawaan untuk sebuah jenjang (dipakai pendaftaran sekolah) */
function kelasDefaultForJenjang(jenjang, listTingkat) {
  const jen = JENJANG.includes(String(jenjang || '').toUpperCase()) ? String(jenjang).toUpperCase() : 'SMK';
  const levels = (Array.isArray(listTingkat) && listTingkat.length)
    ? listTingkat
    : (TINGKAT_PER_JENJANG[jen] || TINGKAT_PER_JENJANG.SMK);
  return levels.map((tk, i) => ({
    nama: jen === 'SMK' ? `${tk} 1` : (/^kelas\b/i.test(tk) ? tk : `Kelas ${tk}`),
    tingkat: tk, jurusan: '', urut: i + 1
  }));
}
/** tingkat yang dianggap kelas akhir (dipakai surat/laporan) */
function tingkatAkhirOf(jenjang) {
  const list = TINGKAT_PER_JENJANG[String(jenjang || 'SMK').toUpperCase()] || TINGKAT_PER_JENJANG.SMK;
  return list[list.length - 1];
}

/* ================= TINGKAT KELAS DINAMIS (dapat dikustom) =================
   Sekolah dapat memakai format bawaan jenjangnya (Romawi), format angka
   (10/11/12), atau daftar tingkat buatan sendiri ("Kelas 1", "Fase E", …).
   Semua logika yang butuh URUTAN tingkat (kenaikan kelas, kelas akhir,
   validasi form) membaca dari tingkatList() — bukan konstanta tetap. */
const TINGKAT_MODE = [
  { key: 'jenjang', label: 'Ikuti Jenjang (bawaan)' },
  { key: 'romawi', label: 'Angka Romawi (I, II, III, …)' },
  { key: 'angka', label: 'Angka (1, 2, 3, …)' },
  { key: 'kelas', label: 'Kata "Kelas N" (Kelas 1, Kelas 2, …)' },
  { key: 'custom', label: 'Kustom (daftar sendiri)' }
];
const ROMAN_VAL = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
/** ubah label tingkat apa pun (X / 10 / Kelas 10) menjadi angka urut 1..12 */
function angkaTingkat(tk) {
  const s = String(tk || '').trim().toUpperCase().replace(/^KELAS\s+/, '');
  if (/^\d+$/.test(s)) return Number(s);
  return ROMAN_VAL[s] || 0;
}
/** format angka tingkat sesuai mode (romawi / angka / kelas) */
function formatTingkat(n, mode) {
  const num = Number(n) || 1;
  if (mode === 'angka') return String(num);
  if (mode === 'kelas') return `Kelas ${num}`;
  return romanOf(num);
}

/** jenjang pendidikan yang aktif di sekolah ini */
function jenjangAktif() {
  const v = String(getSetting('jenjang_pendidikan', '') || getSetting('sekolah_bentuk', '') || '').toUpperCase();
  return JENJANG.includes(v) ? v : 'SMK';
}
/** jumlah tingkat bawaan untuk jenjang aktif */
function jumlahTingkatJenjang(jenjang) {
  return (TINGKAT_PER_JENJANG[String(jenjang || 'SMK').toUpperCase()] || TINGKAT_PER_JENJANG.SMK).length;
}
/** parse daftar tingkat kustom (JSON array atau teks satu per baris) */
function parseTingkatList(raw) {
  if (!raw) return [];
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else {
    const s = String(raw).trim();
    if (!s) return [];
    if (s.startsWith('[')) { try { const j = JSON.parse(s); if (Array.isArray(j)) arr = j; } catch (e) { arr = []; } }
    else arr = s.split(/\r?\n|\|/);
  }
  return arr.map(x => String(x || '').trim()).filter(Boolean).slice(0, 12);
}
/** konfigurasi tingkat kelas aktif: { jenjang, mode, list, kustom } */
function tingkatConfig() {
  const jenjang = jenjangAktif();
  const mode = ['jenjang', 'romawi', 'angka', 'kelas', 'custom'].includes(String(getSetting('tingkat_mode', 'jenjang')))
    ? String(getSetting('tingkat_mode', 'jenjang')) : 'jenjang';
  const kustom = parseTingkatList(getSetting('tingkat_custom', ''));
  const bawaan = (TINGKAT_PER_JENJANG[jenjang] || TINGKAT_PER_JENJANG.SMK).slice();
  let list;
  if (mode === 'custom' && kustom.length) list = kustom;
  else if (mode === 'jenjang') list = bawaan;
  else {
    /* romawi / angka / kelas: nomor tingkat diambil dari jenjang (SMA→10, SMP→7, SD→1) */
    list = bawaan.map((tk, i) => formatTingkat(angkaTingkat(tk) || (i + 1), mode));
  }
  return { jenjang, mode, list, kustom, modes: TINGKAT_MODE };
}
/** daftar tingkat kelas aktif (urut dari tingkat awal ke tingkat akhir) */
function tingkatList() { return tingkatConfig().list; }
/** indeks tingkat pada daftar aktif (-1 bila tidak dikenal) */
function tingkatIndex(tingkat, list) {
  const arr = list || tingkatList();
  const t = String(tingkat || '').trim().toLowerCase();
  return arr.findIndex(x => String(x).trim().toLowerCase() === t);
}
/** tingkat kelas terakhir pada daftar aktif */
function tingkatAkhir() {
  const list = tingkatList();
  return list[list.length - 1] || 'XII';
}
/** apakah sebuah tingkat adalah tingkat akhir (siswa akan lulus saat naik) */
function isTingkatAkhir(tingkat) {
  const i = tingkatIndex(tingkat);
  return i >= 0 && i === tingkatList().length - 1;
}

/* =========================== KONSTANTA =========================== */
const ROLES = ['admin', 'kepala_sekolah', 'wakasek_kurikulum', 'guru_bk', 'kesiswaan', 'wali_kelas', 'guru', 'guru_umum', 'tu'];
const ROLE_LABEL = {
  admin: 'Administrator',
  kepala_sekolah: 'Kepala Sekolah',
  wakasek_kurikulum: 'Wakasek Kurikulum',
  guru_bk: 'Guru BK',
  kesiswaan: 'Guru Kesiswaan',
  wali_kelas: 'Wali Kelas',
  guru: 'Guru Mata Pelajaran',
  guru_umum: 'Guru Umum',
  tu: 'Tenaga Administrasi (TU)'
};
const FEATURES = [
  { key: 'dashboard', label: 'Dashboard Kedisiplinan', grup: 'Utama' },
  { key: 'kejadian', label: 'Input & Log Kejadian', grup: 'Utama' },
  { key: 'kalender', label: 'Kalender Kedisiplinan', grup: 'Utama' },
  { key: 'deteksi', label: 'Deteksi Dini (Siaga / Waspada)', grup: 'Utama' },
  /* ---- Akademik: jadwal pelajaran & absensi ---- */
  { key: 'jadwal', label: 'Jadwal Pelajaran', grup: 'Akademik' },
  { key: 'kalender_akademik', label: 'Kalender Akademik & Hari Efektif', grup: 'Akademik' },
  { key: 'monitor_kbm', label: 'Monitoring KBM Real-Time (Kurikulum)', grup: 'Akademik' },
  { key: 'desain_jadwal', label: 'Desain Jadwal Pelajaran', grup: 'Akademik' },
  { key: 'absensi_guru', label: 'Absensi Guru Mapel', grup: 'Akademik' },
  { key: 'absensi_siswa', label: 'Absensi Siswa per Mapel', grup: 'Akademik' },
  { key: 'rekap_absensi_guru', label: 'Rekap Absensi Guru', grup: 'Akademik' },
  { key: 'rekap_absensi_siswa', label: 'Rekap Absensi Siswa & Peringkat', grup: 'Akademik' },
  { key: 'guru_pengganti', label: 'Guru Piket & Pengganti', grup: 'Akademik' },
  { key: 'rekap_bulanan', label: 'Rekap Bulanan Kelas (Portofolio)', grup: 'Laporan' },
  /* ---- Bimbingan Konseling ---- */
  { key: 'bk_layanan', label: 'Program Layanan BK', grup: 'Bimbingan Konseling' },
  { key: 'asesmen', label: 'Asesmen Siswa BK', grup: 'Bimbingan Konseling' },
  { key: 'asesmen_soal', label: 'Pengaturan Soal Asesmen', grup: 'Bimbingan Konseling' },
  { key: 'aduan', label: 'Kanal Aduan Kekerasan', grup: 'Bimbingan Konseling' },
  { key: 'jurnal', label: 'Buku Penghubung Digital', grup: 'Pembinaan' },
  { key: 'tindak_lanjut', label: 'Catatan Tindak Lanjut', grup: 'Pembinaan' },
  { key: 'analitik', label: 'Analitik Pola & Tren', grup: 'Laporan' },
  { key: 'siswa', label: 'Data Siswa', grup: 'Data Master' },
  { key: 'kelas', label: 'Data Kelas', grup: 'Data Master' },
  { key: 'kategori', label: 'Kategori Poin', grup: 'Data Master' },
  { key: 'pengguna', label: 'Akun Pengguna & Hak Akses', grup: 'Data Master' },
  { key: 'laporan', label: 'Laporan Poin & Surat', grup: 'Laporan' },
  { key: 'audit', label: 'Log Aktivitas Sistem', grup: 'Laporan' },
  { key: 'sampah', label: 'Kotak Sampah', grup: 'Sistem' },
  { key: 'berkas', label: 'Kelola File Terunggah', grup: 'Sistem' },
  { key: 'pengaturan', label: 'Pengaturan', grup: 'Sistem' },
  { key: 'nav_mobile', label: 'Navigasi Mobile & Menu Role', grup: 'Sistem' },
  { key: 'feedback_admin', label: 'Masukan & Kendala User', grup: 'Sistem' },
  /* menu akun & layanan (otomatis tersedia untuk semua role) */
  { key: 'langganan', label: 'Info & Layanan Langganan', grup: 'Akun & Layanan' },
  { key: 'tiket', label: 'Pusat Bantuan / Tiket Kendala', grup: 'Akun & Layanan' },
  { key: 'feedback', label: 'Masukan & Kendala', grup: 'Akun & Layanan' },
  { key: 'panduan', label: 'Petunjuk Pengguna', grup: 'Akun & Layanan' },
  { key: 'legal', label: 'Syarat Ketentuan & SLA', grup: 'Akun & Layanan' }
];
/** fitur yang selalu boleh DILIHAT semua role (menu akun, bukan operasional) */
const ACCOUNT_FEATURES = ['langganan', 'tiket', 'panduan', 'legal', 'feedback'];
/** fitur yang boleh DILIHAT **dan DIISI** oleh semua role (umpan balik pengguna) */
const OPEN_WRITE_FEATURES = ['feedback'];
const ACTIONS = ['view', 'write', 'delete'];
const ACTION_LABEL = { view: 'Lihat', write: 'Tambah/Ubah', delete: 'Hapus' };

const TINGKAT = ['X', 'XI', 'XII'];
const SEMESTER = [
  { key: 'ganjil', label: 'Semester Ganjil' },
  { key: 'genap', label: 'Semester Genap' }
];

const DEFAULT_STATUS = [
  { key: 'aman', label: 'Aman', min: 0, max: 9 },
  { key: 'pantau', label: 'Pantau', min: 10, max: 24 },
  { key: 'perhatian', label: 'Perhatian', min: 25, max: 49 },
  { key: 'kritis', label: 'Kritis', min: 50, max: 74 },
  { key: 'siaga', label: 'Siaga', min: 75, max: 99 },
  { key: 'waspada', label: 'Waspada', min: 100, max: null }
];

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const TL_JENIS = [
  'Konseling Individual',
  'Mediasi / Rekonsiliasi',
  'Kunjungan Rumah (Home Visit)',
  'Teguran Persuasif',
  'Pembinaan Kelompok',
  'Koordinasi dengan Orang Tua'
];
const TL_STATUS = [
  { key: 'selesai', label: 'Selesai', tone: 'aman' },
  { key: 'pemantauan', label: 'Dalam Pemantauan', tone: 'pantau' },
  { key: 'lanjutan', label: 'Perlu Tindak Lanjut Lanjutan', tone: 'siaga' }
];
const LOKASI_DEFAULT = ['Gerbang Sekolah', 'Halaman Sekolah', 'Ruang Kelas', 'Kantin', 'Perpustakaan', 'Lingkungan Luar Sekolah', 'Lainnya'];
const SANKSI_DEFAULT = [
  { id: 'sp1', min: 25, label: 'Surat Peringatan 1 (SP 1)', surat: 'sp1', catatan: 'Teguran tertulis pertama' },
  { id: 'sp2', min: 50, label: 'Surat Peringatan 2 (SP 2)', surat: 'sp2', catatan: 'Peringatan serius + panggilan orang tua' },
  { id: 'panggilan', min: 75, label: 'Panggilan Orang Tua / Wali', surat: 'panggilan', catatan: 'Pertemuan pembinaan bersama orang tua' },
  { id: 'sp3', min: 100, label: 'Surat Peringatan 3 (SP 3)', surat: 'sp3', catatan: 'Peringatan terakhir sebelum penyerahan ke pihak berwenang' }
];

/* ===================== BIMBINGAN KONSELING (BK) ===================== */
const BK_KATEGORI = [
  { key: 'dasar', label: 'Layanan Dasar' },
  { key: 'individual', label: 'Perencanaan Individual' },
  { key: 'responsif', label: 'Layanan Responsif' }
];
const BK_JENIS_DEFAULT = [
  { nama: 'Bimbingan Klasikal', kategori: 'dasar', sasaran: 'kelas' },
  { nama: 'Bimbingan Kelompok', kategori: 'dasar', sasaran: 'siswa' },
  { nama: 'Perencanaan Pendidikan', kategori: 'individual', sasaran: 'siswa' },
  { nama: 'Perencanaan Karir', kategori: 'individual', sasaran: 'siswa' },
  { nama: 'Perencanaan Pribadi', kategori: 'individual', sasaran: 'siswa' },
  { nama: 'Konseling Kelompok', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Konseling Individual/Perorangan', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Konsultasi', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Mediasi', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Kunjungan Rumah (Home Visit)', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Konferensi Kasus', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Alih Tangan Kasus (Referral)', kategori: 'responsif', sasaran: 'siswa' },
  { nama: 'Kolaborasi (dengan Guru/Ortu/Pihak Lain)', kategori: 'responsif', sasaran: 'keduanya' }
];
const ADUAN_JENIS = [
  'Kekerasan fisik', 'Kekerasan verbal / perundungan', 'Kekerasan psikis',
  'Kekerasan seksual', 'Perundungan siber (cyberbullying)', 'Diskriminasi',
  'Pemerasan / pungutan liar', 'Lainnya'
];
const ADUAN_STATUS = [
  { key: 'baru', label: 'Baru', tone: 'rose' },
  { key: 'diproses', label: 'Diproses', tone: 'amber' },
  { key: 'selesai', label: 'Selesai', tone: 'emerald' }
];

/* ---------- instrumen asesmen BK: kategori analisis & bank soal bawaan ---------- */
const ASESMEN_KATEGORI = {
  akpd: [
    { key: 'pribadi', label: 'Bidang Pribadi' },
    { key: 'sosial', label: 'Bidang Sosial' },
    { key: 'belajar', label: 'Bidang Belajar' },
    { key: 'karir', label: 'Bidang Karir' }
  ],
  riasec: [
    { key: 'R', label: 'Realistic (R)' }, { key: 'I', label: 'Investigative (I)' },
    { key: 'A', label: 'Artistic (A)' }, { key: 'S', label: 'Social (S)' },
    { key: 'E', label: 'Enterprising (E)' }, { key: 'C', label: 'Conventional (C)' }
  ],
  gaya: [
    { key: 'visual', label: 'Visual' }, { key: 'auditorial', label: 'Auditorial' },
    { key: 'kinestetik', label: 'Kinestetik' }
  ],
  kesulitan: [
    { key: 'internal', label: 'Faktor Internal' }, { key: 'eksternal', label: 'Faktor Eksternal' }
  ]
};

const ASESMEN_DEFAULT = [
  {
    kode: 'akpd', nama: 'Angket Kebutuhan Peserta Didik (AKPD)', tipe: 'likert4',
    deskripsi: 'Memetakan kebutuhan layanan bimbingan pada bidang pribadi, sosial, belajar, dan karir.',
    petunjuk: 'Beri penilaian 1 sampai 4 pada setiap pernyataan sesuai tingkat kebutuhanmu. 1 = Sangat Tidak Perlu, 2 = Tidak Perlu, 3 = Perlu, 4 = Sangat Perlu.',
    soal: [
      ['pribadi', 'Konsep diri', 'Saya ingin memahami kelebihan dan kekurangan diri saya'],
      ['pribadi', 'Kepercayaan diri', 'Saya ingin lebih percaya diri dalam bergaul dan tampil di depan orang'],
      ['pribadi', 'Pengendalian emosi', 'Saya ingin mampu mengendalikan emosi dan mengelola stres'],
      ['pribadi', 'Kedisiplinan', 'Saya ingin hidup lebih disiplin dan teratur'],
      ['pribadi', 'Perkembangan diri', 'Saya ingin memahami perubahan fisik dan psikis pada diri saya'],
      ['pribadi', 'Kemandirian', 'Saya ingin mandiri dalam mengambil keputusan'],
      ['pribadi', 'Penyesuaian diri', 'Saya ingin memperbaiki kebiasaan buruk yang merugikan diri saya'],
      ['sosial', 'Relasi sosial', 'Saya ingin lebih mudah bergaul dan memiliki banyak teman'],
      ['sosial', 'Komunikasi', 'Saya ingin mengatasi rasa malu saat berkomunikasi'],
      ['sosial', 'Penyelesaian konflik', 'Saya ingin menyelesaikan konflik dengan teman secara baik'],
      ['sosial', 'Toleransi', 'Saya ingin lebih menghargai pendapat dan perbedaan orang lain'],
      ['sosial', 'Penerimaan kelompok', 'Saya ingin diterima dan dihargai dalam kelompok teman'],
      ['sosial', 'Kepedulian', 'Saya ingin mampu menolong teman yang sedang bermasalah'],
      ['sosial', 'Kerja sama', 'Saya ingin bekerja sama dengan baik dalam tugas kelompok'],
      ['belajar', 'Strategi belajar', 'Saya ingin memiliki cara belajar yang efektif'],
      ['belajar', 'Manajemen waktu', 'Saya ingin mengatur waktu belajar dengan baik'],
      ['belajar', 'Konsentrasi', 'Saya ingin meningkatkan konsentrasi saat belajar'],
      ['belajar', 'Motivasi belajar', 'Saya ingin mengatasi rasa malas dalam belajar'],
      ['belajar', 'Hasil belajar', 'Saya ingin memperbaiki nilai pelajaran yang kurang baik'],
      ['belajar', 'Keaktifan kelas', 'Saya ingin lebih aktif bertanya dan berpendapat di kelas'],
      ['belajar', 'Persiapan ujian', 'Saya ingin mempersiapkan diri menghadapi ujian dengan baik'],
      ['karir', 'Informasi karier', 'Saya ingin mengenal berbagai pilihan pekerjaan'],
      ['karir', 'Bakat dan minat', 'Saya ingin memahami bakat dan minat yang saya miliki'],
      ['karir', 'Perencanaan karier', 'Saya ingin memilih jurusan atau karier yang tepat'],
      ['karir', 'Pendidikan lanjut', 'Saya ingin mengetahui syarat melanjutkan pendidikan'],
      ['karir', 'Perencanaan masa depan', 'Saya ingin merencanakan masa depan dengan jelas'],
      ['karir', 'Dunia kerja', 'Saya ingin memahami dunia kerja dan profesi yang berkembang'],
      ['karir', 'Konsultasi karier', 'Saya ingin berkonsultasi tentang pilihan karier saya']
    ]
  },
  {
    kode: 'riasec', nama: 'Tes Minat & Bakat (RIASEC)', tipe: 'centang',
    deskripsi: 'Menelusuri kecenderungan tipe kepribadian dunia kerja (Holland) untuk perencanaan karier.',
    petunjuk: 'Baca setiap pernyataan. Centang bila kamu setuju dengan pernyataan itu. Tidak ada jawaban benar atau salah — isi sesuai dirimu.',
    soal: [
      ['R', 'Realistic', 'Saya suka mengutak-atik atau memperbaiki kendaraan'],
      ['I', 'Investigative', 'Saya suka mengerjakan teka-teki (puzzle)'],
      ['E', 'Enterprising', 'Saya tertarik bekerja secara mandiri'],
      ['S', 'Social', 'Saya suka bekerja dalam tim'],
      ['E', 'Enterprising', 'Saya orang yang ambisius — saya menetapkan target untuk diri sendiri'],
      ['C', 'Conventional', 'Saya suka menata dan merapikan barang (berkas, meja, gulungan)'],
      ['R', 'Realistic', 'Saya suka membuat atau membangun sesuatu'],
      ['A', 'Artistic', 'Saya suka membaca tentang seni dan musik'],
      ['C', 'Conventional', 'Saya suka mengerjakan sesuatu dengan petunjuk yang jelas'],
      ['S', 'Social', 'Saya suka mengenal atau menolong orang lain'],
      ['I', 'Investigative', 'Saya suka melakukan percobaan (eksperimen)'],
      ['S', 'Social', 'Saya suka menjaga atau melatih orang lain'],
      ['S', 'Social', 'Saya suka memberi orang lain nasihat atas masalahnya'],
      ['R', 'Realistic', 'Saya suka memelihara dan merawat hewan'],
      ['C', 'Conventional', 'Saya tidak keberatan bekerja 8 jam sehari di dalam kantor'],
      ['I', 'Investigative', 'Saya suka menjelajah sesuatu'],
      ['A', 'Artistic', 'Saya senang menulis karya kreatif (cerita, puisi)'],
      ['I', 'Investigative', 'Saya senang dengan ilmu pengetahuan alam (sains)'],
      ['E', 'Enterprising', 'Saya cepat mengambil tanggung jawab baru'],
      ['S', 'Social', 'Saya tertarik merawat dan menyembuhkan orang sakit'],
      ['I', 'Investigative', 'Saya senang mencari tahu cara kerja suatu benda'],
      ['R', 'Realistic', 'Saya suka mengoleksi atau merakit benda'],
      ['A', 'Artistic', 'Saya orang yang kreatif'],
      ['C', 'Conventional', 'Saya memperhatikan hal-hal kecil (detail)'],
      ['E', 'Enterprising', 'Saya suka mengatur dan mengelola pekerjaan orang lain'],
      ['I', 'Investigative', 'Saya suka menganalisis sesuatu (masalah atau keadaan)'],
      ['A', 'Artistic', 'Saya suka memainkan alat musik atau bernyanyi'],
      ['A', 'Artistic', 'Saya senang mempelajari budaya daerah atau bangsa lain'],
      ['E', 'Enterprising', 'Saya ingin membuka usaha sendiri suatu saat nanti'],
      ['R', 'Realistic', 'Saya suka memasak'],
      ['A', 'Artistic', 'Saya suka bermain peran dalam drama atau teater'],
      ['R', 'Realistic', 'Saya orang yang praktis'],
      ['C', 'Conventional', 'Saya suka bekerja dengan angka atau grafik'],
      ['S', 'Social', 'Saya suka terlibat diskusi tentang berbagai persoalan'],
      ['C', 'Conventional', 'Saya terbiasa mencatat dan menyimpan rapi hasil pekerjaan saya'],
      ['S', 'Social', 'Saya suka menolong orang lain'],
      ['R', 'Realistic', 'Saya suka bekerja di luar ruangan'],
      ['C', 'Conventional', 'Saya ingin bekerja di kantor'],
      ['I', 'Investigative', 'Saya mahir dalam matematika'],
      ['S', 'Social', 'Saya senang membantu teman yang kesulitan belajar'],
      ['A', 'Artistic', 'Saya suka menggambar'],
      ['E', 'Enterprising', 'Saya suka berbicara di depan umum (berpidato)']
    ]
  },
  {
    kode: 'gaya', nama: 'Tes Gaya Belajar', tipe: 'centang',
    deskripsi: 'Mengidentifikasi kecenderungan modalitas belajar: visual, auditorial, atau kinestetik.',
    petunjuk: 'Baca setiap pernyataan. Centang bila pernyataan itu sesuai dengan kebiasaanmu saat belajar. Tidak ada jawaban benar atau salah.',
    soal: [
      ['visual', 'Visual', 'Saya lebih mudah paham bila melihat gambar, bagan, atau grafik'],
      ['visual', 'Visual', 'Saya suka mencatat dengan warna-warni atau membuat peta konsep'],
      ['visual', 'Visual', 'Saya lebih ingat wajah seseorang daripada namanya'],
      ['visual', 'Visual', 'Saya lebih suka membaca sendiri daripada mendengar penjelasan'],
      ['visual', 'Visual', 'Saya terbantu bila guru menuliskan poin penting di papan tulis'],
      ['auditorial', 'Auditorial', 'Saya lebih mudah paham bila mendengarkan penjelasan guru'],
      ['auditorial', 'Auditorial', 'Saya senang belajar sambil berdiskusi atau menjelaskan kepada teman'],
      ['auditorial', 'Auditorial', 'Saya sering membaca dengan bersuara atau menggumam'],
      ['auditorial', 'Auditorial', 'Saya mudah terganggu oleh suara bising saat belajar'],
      ['auditorial', 'Auditorial', 'Saya lebih ingat apa yang saya dengar daripada yang saya baca'],
      ['kinestetik', 'Kinestetik', 'Saya lebih mudah paham bila langsung mempraktikkannya'],
      ['kinestetik', 'Kinestetik', 'Saya sulit duduk diam terlalu lama saat belajar'],
      ['kinestetik', 'Kinestetik', 'Saya suka belajar sambil bergerak atau memegang sesuatu'],
      ['kinestetik', 'Kinestetik', 'Saya lebih ingat hal yang pernah saya kerjakan sendiri'],
      ['kinestetik', 'Kinestetik', 'Saya menyukai pelajaran yang ada praktik atau percobaannya']
    ]
  },
  {
    kode: 'kesulitan', nama: 'Tes Kesulitan Belajar', tipe: 'centang',
    deskripsi: 'Memetakan hambatan belajar siswa (faktor internal & eksternal) sebagai dasar layanan konseling.',
    petunjuk: 'Baca setiap pernyataan. Centang bila pernyataan itu kamu alami. Jawablah sejujurnya agar guru bisa membantu dengan tepat.',
    soal: [
      ['internal', 'Kebiasaan belajar', 'Saya belajar hanya ketika akan ada ulangan atau ujian'],
      ['internal', 'Kebiasaan belajar', 'Saya tidak punya jadwal belajar yang teratur'],
      ['internal', 'Kebiasaan belajar', 'Catatan pelajaran saya tidak lengkap atau berantakan'],
      ['internal', 'Kebiasaan belajar', 'Saya jarang mengulang kembali pelajaran di rumah'],
      ['internal', 'Kebiasaan belajar', 'Saya sering bingung harus mulai belajar dari mana'],
      ['internal', 'Konsentrasi', 'Saya sulit berkonsentrasi lebih dari 15 menit saat belajar'],
      ['internal', 'Manajemen waktu', 'Saya sering menunda mengerjakan tugas'],
      ['internal', 'Konsentrasi', 'Saya mudah teralihkan oleh HP atau media sosial saat belajar'],
      ['internal', 'Motivasi', 'Saya merasa kurang bersemangat mengikuti pelajaran'],
      ['internal', 'Motivasi', 'Saya cepat menyerah bila menemui soal yang sulit'],
      ['eksternal', 'Lingkungan rumah', 'Suasana rumah saya ribut atau kurang nyaman untuk belajar'],
      ['eksternal', 'Lingkungan rumah', 'Saya tidak punya tempat khusus untuk belajar di rumah'],
      ['eksternal', 'Fasilitas belajar', 'Saya kesulitan memiliki buku atau perlengkapan belajar yang dibutuhkan'],
      ['eksternal', 'Dukungan belajar', 'Tidak ada yang bisa saya tanyai bila kesulitan belajar di rumah'],
      ['eksternal', 'Beban keluarga', 'Saya banyak membantu pekerjaan rumah sehingga waktu belajar berkurang']
    ]
  }
];

const DEFAULT_PERMS = {
  kepala_sekolah: {
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'tindak_lanjut', 'analitik', 'siswa', 'kelas', 'kategori', 'laporan', 'audit', 'pengguna',
      'jadwal', 'kalender_akademik', 'monitor_kbm', 'desain_jadwal', 'absensi_guru', 'absensi_siswa', 'rekap_absensi_guru', 'rekap_absensi_siswa',
      'guru_pengganti', 'rekap_bulanan',
      'bk_layanan', 'asesmen', 'asesmen_soal', 'aduan'],
    write: ['tindak_lanjut', 'guru_pengganti']
  },
  wakasek_kurikulum: {
    view: ['dashboard', 'jadwal', 'kalender_akademik', 'monitor_kbm', 'desain_jadwal', 'absensi_guru', 'absensi_siswa', 'rekap_absensi_guru', 'rekap_absensi_siswa',
      'guru_pengganti', 'rekap_bulanan',
      'siswa', 'kelas', 'kategori', 'laporan', 'analitik', 'deteksi', 'aduan'],
    write: ['jadwal', 'kalender_akademik', 'monitor_kbm', 'desain_jadwal', 'absensi_guru', 'absensi_siswa', 'kelas', 'guru_pengganti'],
    delete: ['jadwal', 'kalender_akademik']
  },
  guru_bk: {
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'tindak_lanjut', 'siswa', 'kategori', 'laporan', 'analitik', 'dashboard', 'kalender',
      'jadwal', 'kalender_akademik', 'absensi_guru', 'absensi_siswa', 'rekap_absensi_guru', 'rekap_absensi_siswa', 'rekap_bulanan',
      'guru_pengganti', 'bk_layanan', 'asesmen', 'asesmen_soal', 'aduan'],
    write: ['kejadian', 'jurnal', 'tindak_lanjut', 'siswa', 'kategori', 'laporan', 'analitik', 'deteksi', 'dashboard', 'kalender', 'absensi_siswa',
      'bk_layanan', 'asesmen', 'asesmen_soal', 'aduan'],
    delete: ['kejadian', 'tindak_lanjut', 'bk_layanan']
  },
  kesiswaan: {
    /* Wakasek Kesiswaan melihat SELURUH jadwal & absensi (guru maupun siswa),
       termasuk rekap absensi guru — tapi tidak boleh check-in/jurnal atas nama guru. */
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'tindak_lanjut', 'analitik', 'siswa', 'kelas', 'kategori', 'laporan', 'jadwal',
      'kalender_akademik', 'absensi_guru', 'absensi_siswa', 'rekap_absensi_guru', 'rekap_absensi_siswa', 'bk_layanan', 'aduan'],
    write: ['kejadian', 'jurnal', 'tindak_lanjut', 'siswa', 'aduan', 'absensi_siswa']
  },
  wali_kelas: {
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'tindak_lanjut', 'analitik', 'siswa', 'kelas', 'kategori', 'laporan', 'jadwal', 'kalender_akademik', 'absensi_guru', 'absensi_siswa',
      'rekap_absensi_guru', 'rekap_absensi_siswa', 'rekap_bulanan', 'guru_pengganti', 'bk_layanan', 'asesmen', 'aduan'],
    write: ['kejadian', 'jurnal', 'absensi_siswa', 'aduan']
  },
  guru: {
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'siswa', 'laporan', 'jadwal', 'kalender_akademik', 'absensi_guru', 'absensi_siswa',
      'rekap_absensi_guru', 'rekap_absensi_siswa', 'guru_pengganti', 'bk_layanan', 'aduan'],
    write: ['jurnal', 'absensi_guru', 'absensi_siswa', 'aduan']
  },
  guru_umum: {
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'analitik', 'siswa', 'kelas', 'laporan', 'jadwal', 'absensi_guru', 'absensi_siswa',
      'rekap_absensi_guru', 'guru_pengganti', 'bk_layanan', 'aduan'],
    write: ['kejadian', 'jurnal', 'absensi_guru', 'absensi_siswa', 'aduan']
  },
  tu: {
    view: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'analitik', 'siswa', 'kelas', 'laporan', 'jadwal', 'absensi_guru', 'absensi_siswa',
      'rekap_absensi_guru', 'rekap_absensi_siswa'],
    write: ['kejadian', 'jurnal']
  }
};

const DEFAULT_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { key: 'kejadian', label: 'Kejadian & Poin', icon: 'ClipboardList' },
  { key: 'kalender', label: 'Kalender Disiplin', icon: 'CalendarDays' },
  { key: 'deteksi', label: 'Deteksi Dini', icon: 'ShieldAlert' },
  { key: 'jadwal', label: 'Jadwal Pelajaran', icon: 'CalendarRange' },
  { key: 'kalender_akademik', label: 'Kalender Akademik', icon: 'CalendarClock' },
  { key: 'monitor_kbm', label: 'Monitoring KBM Real-Time', icon: 'Activity' },
  { key: 'desain_jadwal', label: 'Desain Jadwal Pelajaran', icon: 'FileSignature' },
  { key: 'absensi_guru', label: 'Absensi Guru Mapel', icon: 'UserCheck' },
  { key: 'absensi_siswa', label: 'Absensi Siswa per Mapel', icon: 'ClipboardCheck' },
  { key: 'rekap_absensi_guru', label: 'Rekap Absensi Guru', icon: 'UserCheck' },
  { key: 'rekap_absensi_siswa', label: 'Rekap Absensi Siswa', icon: 'ClipboardList' },
  { key: 'guru_pengganti', label: 'Guru Piket & Pengganti', icon: 'UserRoundCheck' },
  { key: 'rekap_bulanan', label: 'Rekap Bulanan Kelas', icon: 'FileSpreadsheet' },
  { key: 'bk_layanan', label: 'Program Layanan BK', icon: 'HeartHandshake' },
  { key: 'asesmen', label: 'Asesmen Siswa BK', icon: 'ClipboardCheck' },
  { key: 'asesmen_soal', label: 'Soal & Kategori Asesmen', icon: 'ListChecks' },
  { key: 'aduan', label: 'Kanal Aduan Kekerasan', icon: 'ShieldAlert' },
  { key: 'jurnal', label: 'Buku Penghubung', icon: 'NotebookPen' },
  { key: 'tindak_lanjut', label: 'Tindak Lanjut', icon: 'HeartHandshake' },
  { key: 'siswa', label: 'Data Siswa', icon: 'Users' },
  { key: 'kelas', label: 'Data Kelas', icon: 'School' },
  { key: 'kategori', label: 'Kategori Poin', icon: 'ListChecks' },
  { key: 'pengguna', label: 'Akun Pengguna', icon: 'UserCog' },
  { key: 'laporan', label: 'Laporan & Surat', icon: 'FileText' },
  { key: 'analitik', label: 'Analitik Pola', icon: 'ChartPie' },
  { key: 'audit', label: 'Log Aktivitas', icon: 'ScrollText' },
  { key: 'sampah', label: 'Kotak Sampah', icon: 'Trash2' },
  { key: 'berkas', label: 'Kelola File', icon: 'FolderOpen' },
  { key: 'nav_mobile', label: 'Navigasi Mobile & Menu', icon: 'Smartphone' },
  { key: 'pengaturan', label: 'Pengaturan', icon: 'Settings' },
  { key: 'feedback_admin', label: 'Masukan & Kendala User', icon: 'Inbox' },
  { key: 'langganan', label: 'Info & Layanan', icon: 'CreditCard' },
  { key: 'tiket', label: 'Pusat Bantuan', icon: 'LifeBuoy' },
  { key: 'feedback', label: 'Masukan & Kendala', icon: 'MessageSquareWarning' },
  { key: 'panduan', label: 'Petunjuk Pengguna', icon: 'BookOpen' },
  { key: 'legal', label: 'Legal & SLA', icon: 'Scale' }
];

const SETTINGS_DEFAULT = {
  sekolah_nama: 'SMK PGRI CIKONENG',
  sekolah_npsn: '20224567',
  sekolah_bentuk: 'SMK',
  jenjang_pendidikan: 'SMK',       // jenjang aktif → menentukan daftar tingkat kelas
  tingkat_mode: 'jenjang',          // jenjang | romawi | angka | kelas | custom
  tingkat_custom: '',               // daftar tingkat kustom (JSON array / satu per baris)
  sekolah_status: 'Swasta',
  sekolah_telp: '(0265) 771234',
  sekolah_email: 'info@smkpgricikoneng.sch.id',
  sekolah_website: 'https://smkpgricikoneng.sch.id',
  sekolah_alamat: 'Jl. Raya Cikoneng No. 12, Kec. Cikoneng, Kab. Ciamis, Jawa Barat 46271',
  kepala_nama: 'Drs. H. Ahmad Suryana, M.Pd.',
  kepala_nip: '196804121994031005',
  bendahara_nama: 'Rina Kusmiati, S.Pd.',
  bendahara_nip: '197905202006042010',
  wakasek_nama: 'Dedi Kurniawan, S.Pd.',
  wakasek_nip: '198711202012011004',
  wakasek_jabatan: 'Wakasek Kesiswaan',
  logo: '',
  app_nama: 'SMART TATA TERTIB SISWA',
  app_nama_custom: '',            // '1' bila sekolah sengaja mengganti nama aplikasi sendiri
  app_logo: '',
  primary_color: '#ea580c',
  gradient_bg: '1',
  nav_ui: '',
  form_config: '',
  status_rules: '',
  dini_config: '',
  lokasi_list: '',
  sanksi_rules: '',
  jurnal_config: '',
  print_paper: 'A4',
  print_tempat: 'Cikoneng',
  /* ---- unggahan & penyimpanan (menu Pengaturan → Unggahan) ---- */
  upload_max_kb: '2048',          // batas ukuran satu foto (KB) — default 2 MB, dapat diubah
  upload_jpeg_quality: '0.82',    // kualitas kompresi gambar di sisi klien
  upload_max_side: '1600',        // sisi terpanjang gambar setelah dikompres (px)
  storage_quota_mb: '5120',       // kuota penyimpanan aplikasi (informasi dashboard)
  /* ---- kop surat dinamis (menu Pengaturan → Kop Surat) ---- */
  kop_sumber: 'auto',             // auto = dari identitas sekolah, manual = teks sendiri
  kop_logo: '',                   // logo kop terpisah (kosong = logo utama)
  kop_posisi: 'kiri',             // kiri | tengah | kanan → posisi logo
  kop_rapat: 'tengah',            // kiri | tengah | kanan → perataan teks kop
  kop_baris: '',                  // teks bebas (sumber manual), satu baris = satu baris kop
  kop_baris_tambahan: '',         // teks bebas tambahan yang SELALU ditampilkan (mis. akreditasi)
  kop_font: '10.5',               // ukuran font dasar (pt)
  kop_font_besar: '16.5',         // ukuran font nama sekolah (pt)
  kop_tinggi_logo: '74',          // tinggi logo kop (px)
  kop_format: '',                 // JSON [{size,bold}] ukuran/tebal per baris
  kop_garis: 'double',            // double | single | none
  session_days: '90',             // masa berlaku sesi login (hari)
  portal_aktif: '1',
  portal_judul: 'Cek Poin Kedisiplinan Siswa',
  portal_subtitle: 'Masukkan nama lengkap dan tanggal lahir untuk melihat rekap poin, prestasi, dan riwayat kejadian.',
  wa_template:
    'Assalamualaikum, Bapak/Ibu wali dari {nama}.\n\n' +
    'Kami informasikan bahwa {nama} (Kelas {kelas}) memiliki catatan kedisiplinan di sekolah:\n' +
    '- Poin pelanggaran: {pel}\n- Poin prestasi: {pres}\n- Poin bersih: {bersih}\n- Status disiplin: {status}\n\n' +
    'Mohon perhatian dan kerja sama Bapak/Ibu untuk pembinaan di rumah. Terima kasih.\n\n' +
    '{sekolah}\n{guru}',

  /* ---- WhatsApp Gateway & peringatan masal ke orang tua ---- */
  wa_aktif: '0',                  // '1' = kirim langsung lewat gateway, '0' = buka tautan wa.me (manual)
  wa_gateway_url: '',             // endpoint gateway (mis. https://api.fonnte.com/send)
  wa_gateway_token: '',           // token/API key gateway
  wa_gateway_payload: '{"target":"{phone}","message":"{message}"}', // body JSON; {phone} & {message}
  wa_gateway_header: 'Authorization', // nama header token (kosong = tanpa header)
  wa_gateway_prefix: '',          // awalan nilai header, mis. "Bearer "
  wa_cooldown_jam: '24',          // jeda minimal pengiriman ulang ke siswa yang sama (jam)
  wa_template_massal: '',         // kosong = memakai wa_template
  wa_max_sekali: '1',             // kirim massal sekaligus (info saja)

  /* ---- Penguncian jeda input kejadian (anti double input) ---- */
  input_cooldown_jam: '0',        // 0 = nonaktif; >0 = siswa terkunci sekian jam setelah diinput

  /* ================= AKADEMIK: JADWAL PELAJARAN ================= */
  jadwal_hari: '',                // JSON array hari aktif, 0=Minggu … 6=Sabtu (kosong = Senin–Sabtu)
  jadwal_max_jam: '8',            // jumlah jam pelajaran maksimal per hari
  jadwal_sesi: '',                // JSON [{label,mulai,selesai,istirahat}] — termasuk jam istirahat
  jadwal_max_mapel_jam: '2',      // maksimal jam pelajaran yang sama per kelas per hari
  jadwal_max_guru_jam: '8',       // maksimal jam mengajar satu guru per hari
  jadwal_publik_token: '',        // token tautan publik rekap jadwal
  jadwal_publik_aktif: '0',
  /* validasi target jumlah jam pelajaran per kelas per minggu (kurikulum) */
  target_jam_aktif: '1',          // '1' = tampilkan peringatan kurang/lebih jam per kelas
  target_jam_minggu: '40',        // standar jam pelajaran per minggu (per kelas)
  /* ===== AI TIMETABLE GENERATOR (penyusun jadwal otomatis) ===== */
  jadwal_ai_cfg: '',              // JSON { aturan:{…}, mode:'tambah'|'ganti', kelas_ids:[…], seed }
  jadwal_ai_terakhir: '',         // ringkasan hasil generate terakhir (JSON, informasi saja)
  /* ===== KALENDER AKADEMIK: rentang semester, warna kategori, pengawas ===== */
  kal_s1_mulai: '',               // kosong = otomatis awal tahun pelajaran
  kal_s1_selesai: '',             // kosong = otomatis 31 Desember
  kal_s2_mulai: '',               // kosong = otomatis 1 Januari
  kal_s2_selesai: '',             // kosong = otomatis akhir tahun pelajaran
  kal_warna: '',                  // JSON warna per kategori (kosong = bawaan)
  kal_pengawas_nama: '',          // Pembina / Pengawas Pembina Sekolah
  kal_pengawas_nip: '',
  kal_judul: '',                  // judul dokumen cetak kalender (kosong = bawaan)

  /* ================= ABSENSI GURU MAPEL ================= */
  absensi_buka_menit: '15',       // absensi dibuka N menit sebelum jam pelajaran dimulai
  absensi_tutup_menit: '15',      // (lama) toleransi penutupan — kini diatur absensi_toleransi_tutup
  absensi_toleransi_tutup: '0',   // menit toleransi SETELAH jam pelajaran selesai (0 = terkunci tepat waktu)
  absensi_jurnal_min: '15',       // panjang minimal ringkasan materi (karakter)
  absensi_foto_wajib: '1',        // '1' = bukti foto/jurnal mengajar wajib
  absensi_foto_hari: '90',        // masa simpan bukti foto (hari) — otomatis dibersihkan
  absensi_siswa_aktif: '1',       // '1' = ketua kelas boleh mengisi presensi lewat tautan/QR
  absensi_siswa_tutup_menit: '120',// tautan presensi siswa masih menerima isian N menit setelah jam selesai

  /* ============ NOTIFIKASI WHATSAPP OTOMATIS (Fonnte) ============ */
  wa_provider: 'generik',         // generik | fonnte (deteksi otomatis dari URL juga)
  wa_alfa_aktif: '1',             // '1' = kirim WA ke orang tua saat siswa Alfa/Bolos
  wa_template_alfa: '',           // kosong = template bawaan (waTemplateAlfa)
  wa_izin_aktif: '1',             // '1' = beri tahu Kepsek/Wakasek saat guru Sakit/Izin
  wa_template_izin: '',           // kosong = template bawaan (waTemplateIzin)

  /* ================= NOTIFIKASI WHATSAPP REKAP ABSENSI ================= */
  kepsek_wa: '',                  // nomor WhatsApp Kepala Sekolah
  wakasek_kur_wa: '',             // nomor WhatsApp Wakasek Kurikulum
  absensi_wa_aktif: '0',          // '1' = kirim rekap otomatis setiap hari
  absensi_wa_jam: '14:00',        // jam pengiriman rekap (WIB)
  absensi_wa_terakhir: '',        // tanggal terakhir rekap terkirim (cegah kirim ganda)
  absensi_auto_alpha: '1',        // '1' = guru yang tidak check-in sampai jam pelajaran berakhir otomatis ALFA

  /* ================= OTOMATISASI POIN DARI ABSENSI ================= */
  absensi_auto_poin: '1',         // '1' = status Alpha/Bolos otomatis membuat catatan pelanggaran
  absensi_poin_alfa: '5',         // poin bawaan saat kategori otomatis "Alpha" dibuat
  absensi_poin_bolos: '10',       // poin bawaan saat kategori otomatis "Bolos" dibuat

  /* ============ REKAP ABSENSI SISWA → WHATSAPP WALI KELAS ============ */
  absensi_wa_kelas_aktif: '0',    // '1' = kirim rekap harian ke Wali Kelas otomatis
  absensi_wa_kelas_jam: '15:00',  // jam pengiriman (WIB)
  absensi_wa_kelas_hari: '1,2,3,4,5', // hari kerja aktif (0=Minggu … 6=Sabtu)
  absensi_wa_kelas_terakhir: '',  // tanggal terakhir rekap kelas dikirim (anti kirim ganda)

  /* ============ DESAIN CETAK JADWAL PELAJARAN (header & tanda tangan) ============ */
  jadwal_judul: 'JADWAL PELAJARAN',
  jadwal_semester: 'Semester Genap',
  jadwal_ta_teks: '',            // kosong = otomatis "Tahun Pelajaran <TA aktif>"
  jadwal_ttd_tempat: '',         // kosong = ikut print_tempat (default Cikoneng)
  jadwal_ttd_tanggal: '',        // kosong = otomatis bulan & tahun cetak
  jadwal_pengawas_tampil: '1',   // '1' = kolom Pengawas Pembina ditampilkan
  jadwal_pengawas_nama: '',
  jadwal_pengawas_nip: '',
  jadwal_kepala_nama: '',        // kosong = ikut kepala_nama
  jadwal_kepala_nip: '',         // kosong = ikut kepala_nip
  jadwal_wakasek_nama: '',       // kosong = ikut wakasek_nama
  jadwal_wakasek_nip: '',
  jadwal_wakasek_jabatan: '',    // kosong = "Wakasek Kurikulum"

  /* ================= PROGRAM LAYANAN BK: TANDA TANGAN ================= */
  bk_ttd_nama: '',                // nama penanggung jawab BK pada dokumen cetak
  bk_ttd_jabatan: 'Koordinator BK',
  bk_ttd_nip: '',
  bk_ttd_guru_nama: '',           // guru pembimbing yang menandatangani (opsional)
};

/* =========================== SETTINGS =========================== */
function getSetting(key, fallback = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r && r.value !== null && r.value !== undefined ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value === null || value === undefined ? '' : String(value));
}
/* Nama aplikasi GLOBAL (Branding Sistem Super Admin) disuntikkan oleh server.js
   lewat setAppNamaGlobal() agar seluruh pembaca allSettings() — halaman internal,
   dokumen cetak, ekspor, arsip backup — otomatis memakai identitas platform,
   kecuali sekolah sengaja mengganti nama aplikasinya sendiri (app_nama_custom=1). */
let appNamaGlobalFn = null;
function setAppNamaGlobal(fn) { appNamaGlobalFn = typeof fn === 'function' ? fn : null; }
function allSettings() {
  const out = { ...SETTINGS_DEFAULT };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  let global = '';
  try { global = appNamaGlobalFn ? String(appNamaGlobalFn() || '') : ''; } catch (e) { global = ''; }
  out.app_nama_global = global || out.app_nama_global || '';
  if (out.app_nama_global && (out.app_nama_custom !== '1' || !out.app_nama)) out.app_nama = out.app_nama_global;
  return out;
}
function jsonSetting(key, fallback) {
  try {
    const raw = getSetting(key, '');
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) { return fallback; }
}
function statusRules() {
  const r = jsonSetting('status_rules', null);
  if (Array.isArray(r) && r.length) return r;
  return DEFAULT_STATUS;
}
function diniConfig() {
  return {
    hari: 14,
    siaga: 20,
    waspada: 40,
    aktif: 1,
    ...jsonSetting('dini_config', {})
  };
}
function formConfig() {
  return {
    tampilkan_judul: 0,
    wajib_keterangan: 0,
    tampilkan_bukti: 1,
    auto_tanggal: 1,
    tampilkan_jam: 1,
    judul_default: '',
    placeholder_keterangan: 'Tuliskan kronologi kejadian secara detail…',
    ...jsonSetting('form_config', {})
  };
}
function lokasiList() {
  let list = null;
  const raw = getSetting('lokasi_list', '');
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.length) list = v.map(x => String(x).trim()).filter(Boolean);
    } catch (e) { /* pakai bawaan */ }
  }
  if (!list) list = LOKASI_DEFAULT.slice();
  /* opsi "Lainnya" selalu tersedia → memunculkan input lokasi manual di formulir */
  if (!list.some(x => x.toLowerCase() === 'lainnya')) list = [...list, 'Lainnya'];
  return list;
}
function sanksiRules() {
  const raw = getSetting('sanksi_rules', '');
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.length) {
        return v.map((r, i) => ({
          id: r.id || 's' + i,
          min: Math.max(0, Number(r.min) || 0),
          label: String(r.label || 'Sanksi'),
          surat: ['sp1', 'sp2', 'sp3', 'panggilan'].includes(r.surat) ? r.surat : '',
          catatan: String(r.catatan || '')
        })).sort((a, b) => a.min - b.min);
      }
    } catch (e) { /* pakai bawaan */ }
  }
  return SANKSI_DEFAULT.slice();
}
/** rekomendasi sanksi otomatis untuk poin pelanggaran tertentu */
function sanksiOf(poin) {
  const v = Math.max(0, Number(poin) || 0);
  const list = sanksiRules();
  let hit = null;
  for (const r of list) if (v >= r.min) hit = r;
  if (!hit) return null;
  const next = list.find(r => r.min > v) || null;
  return { ...hit, sisa: next ? next.min - v : 0, berikutnya: next ? next.label : '' };
}
function jurnalConfig() {
  return {
    tampil_dashboard: 1,
    wajib_lokasi: 0,
    wajib_keterangan: 0,
    auto_poin: 1,
    ...jsonSetting('jurnal_config', {})
  };
}
/* =====================================================================
   NAVIGASI BAWAH (BOTTOM NAV) PER ROLE — khusus tampilan ponsel.
   Tombol navigasi bawah dapat diatur Administrator (menu Navigasi Mobile):
   urutan & visibilitasnya disimpan pada setting `bottom_nav` (JSON per role).
   ===================================================================== */
const BOTTOM_NAV_DEFAULT = {
  /* WAJIB (permintaan sekolah): Guru Mata Pelajaran → Input Kejadian ·
     Absensi Guru Mapel (tengah/fokus) · Buku Penghubung */
  guru: ['kejadian', 'absensi_guru', 'jurnal'],
  guru_umum: ['kejadian', 'absensi_guru', 'jurnal'],
  wali_kelas: ['kejadian', 'absensi_guru', 'jurnal'],
  guru_bk: ['dashboard', 'bk_layanan', 'jurnal'],
  kesiswaan: ['dashboard', 'absensi_guru', 'absensi_siswa', 'kejadian', 'tindak_lanjut'],
  wakasek_kurikulum: ['dashboard', 'absensi_guru', 'absensi_siswa', 'laporan'],
  kepala_sekolah: ['dashboard', 'absensi_guru', 'absensi_siswa', 'laporan', 'deteksi'],
  tu: ['dashboard', 'kejadian', 'jurnal'],
  admin: ['dashboard', 'kejadian', 'laporan']
};
const BOTTOM_NAV_MAX = 5;
/** konfigurasi tombol navigasi bawah seluruh role (sudah dinormalisasi) */
function bottomNavConfig() {
  const saved = jsonSetting('bottom_nav', {}) || {};
  const out = {};
  for (const role of ROLES) {
    const raw = Array.isArray(saved[role]) ? saved[role] : null;
    const list = (raw || BOTTOM_NAV_DEFAULT[role] || [])
      .map(k => String(k || '').trim())
      .filter(k => FEATURES.some(f => f.key === k));
    out[role] = [...new Set(list)].slice(0, BOTTOM_NAV_MAX);
  }
  return out;
}
/** tombol navigasi bawah efektif untuk satu pengguna (dihormati izin & nav hidden) */
function bottomNavFor(user) {
  if (!user) return [];
  const cfg = bottomNavConfig();
  const roles = userRoleList(user);
  let keys = [];
  for (const r of roles) {
    if (cfg[r] && cfg[r].length) { keys = cfg[r]; break; }
  }
  if (!keys.length) {
    /* fallback: 3 menu pertama yang boleh dilihat pengguna */
    keys = Object.keys(permsFor(user)).filter(k => can(user, k, 'view')).slice(0, 3);
  }
  const nav = new Map(navConfig().filter(n => !n.hidden).map(n => [n.key, n]));
  return keys
    .filter(k => can(user, k, 'view') && nav.has(k))
    .map(k => {
      const n = nav.get(k);
      return { key: k, label: n.label, icon: n.icon };
    });
}
function setBottomNav(role, keys) {
  if (!ROLES.includes(role)) return false;
  const cfg = jsonSetting('bottom_nav', {}) || {};
  const list = (Array.isArray(keys) ? keys : [])
    .map(k => String(k || '').trim())
    .filter(k => FEATURES.some(f => f.key === k));
  cfg[role] = [...new Set(list)].slice(0, BOTTOM_NAV_MAX);
  setSetting('bottom_nav', JSON.stringify(cfg));
  return true;
}
function navConfig() {
  const saved = jsonSetting('nav_ui', {});
  return DEFAULT_NAV.map((n, i) => {
    const s = saved[n.key] || {};
    return {
      key: n.key,
      icon: n.icon,
      label: s.label || n.label,
      hidden: !!s.hidden,
      order: Number.isFinite(s.order) ? s.order : i
    };
  }).sort((a, b) => a.order - b.order);
}
function statusOf(poinBersih, rules) {
  const v = Math.max(0, Number(poinBersih) || 0);
  const list = rules || statusRules();
  for (const r of list) {
    if (v >= Number(r.min) && (r.max === null || r.max === undefined || v <= Number(r.max))) return r;
  }
  return list[list.length - 1];
}

/* =========================== AUTH / RBAC =========================== */
function userByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(username || '').trim());
}
function userById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
/** daftar role efektif pengguna: role utama + role tambahan (multi-role) */
function userRoleList(user) {
  if (!user) return [];
  let extra = [];
  try {
    const v = JSON.parse(user.roles || '[]');
    if (Array.isArray(v)) extra = v;
  } catch (e) { extra = []; }
  const all = [String(user.role || ''), ...extra.map(String)]
    .map(r => r.trim()).filter(r => ROLES.includes(r));
  return [...new Set(all)];
}
/** label role gabungan, mis. "Guru Mata Pelajaran + Wakasek Kurikulum" */
function roleLabelOf(user) {
  const list = userRoleList(user);
  if (!list.length) return String(user && user.role || '');
  return list.map(r => ROLE_LABEL[r] || r).join(' + ');
}
/** izin gabungan dari SEMUA role pengguna */
function permsFor(user) {
  const out = {};
  for (const f of FEATURES) out[f.key] = { view: 0, write: 0, delete: 0 };
  const roles = userRoleList(user);
  if (!roles.length) return out;
  if (roles.includes('admin')) {
    for (const f of FEATURES) out[f.key] = { view: 1, write: 1, delete: 1 };
    return out;
  }
  const ph = roles.map(() => '?').join(',');
  for (const r of db.prepare(`SELECT feature,action,allowed FROM permissions WHERE role IN (${ph})`).all(...roles)) {
    const slot = out[r.feature];
    if (!slot || slot[r.action] === undefined) continue;
    if (r.allowed) slot[r.action] = 1;
  }
  return out;
}
function can(user, feature, action) {
  if (!user) return false;
  const roles = userRoleList(user);
  if (!roles.length) return false;
  if (roles.includes('admin')) return true;
  const ph = roles.map(() => '?').join(',');
  const r = db.prepare(`SELECT allowed FROM permissions WHERE role IN (${ph}) AND feature=? AND action=? AND allowed=1 LIMIT 1`)
    .get(...roles, feature, action);
  return !!(r && r.allowed);
}
function permissionMatrix() {
  const out = {};
  for (const role of ROLES) {
    out[role] = {};
    for (const f of FEATURES) out[role][f.key] = { view: 0, write: 0, delete: 0 };
  }
  for (const r of db.prepare('SELECT * FROM permissions').all()) {
    if (!out[r.role] || !out[r.role][r.feature]) continue;
    out[r.role][r.feature][r.action] = r.allowed ? 1 : 0;
  }
  // Administrator selalu memiliki akses penuh (sama dengan aturan can())
  for (const f of FEATURES) out.admin[f.key] = { view: 1, write: 1, delete: 1 };
  return out;
}
function setPermission(role, feature, action, allowed) {
  if (!ROLES.includes(role) || !FEATURES.some(f => f.key === feature) || !ACTIONS.includes(action)) return;
  if (role === 'admin') return; // admin selalu penuh
  db.prepare(`INSERT INTO permissions(role,feature,action,allowed) VALUES(?,?,?,?)
    ON CONFLICT(role,feature,action) DO UPDATE SET allowed=excluded.allowed`)
    .run(role, feature, action, allowed ? 1 : 0);
}
function logAudit(user, aksi, modul, detail, ip) {
  db.prepare('INSERT INTO audit(user_id,nama,role,aksi,modul,detail,ip,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(user ? user.id : null, user ? user.nama : 'Sistem', user ? user.role : '-',
      aksi, modul, detail === undefined ? '' : String(detail), ip || '', now());
}

/* =========================== TAHUN AJARAN =========================== */
function tahunList() {
  return db.prepare('SELECT * FROM tahun_ajaran ORDER BY tanggal_mulai DESC, id DESC').all();
}
function tahunAktif() {
  return db.prepare('SELECT * FROM tahun_ajaran WHERE aktif=1 ORDER BY id DESC').get()
    || db.prepare('SELECT * FROM tahun_ajaran ORDER BY id DESC').get()
    || null;
}
function tahunById(id) {
  return db.prepare('SELECT * FROM tahun_ajaran WHERE id = ?').get(id) || tahunAktif();
}
/** id siswa yang terdaftar pada sebuah tahun pelajaran */
function siswaIdsOfTa(taId) {
  try { return db.prepare('SELECT id FROM siswa WHERE tahun_ajaran_id=?').all(Number(taId) || 0).map(r => r.id); }
  catch (e) { return []; }
}
/** klausa IN (?,?,…) + argumen, aman untuk daftar kosong */
function inClause(ids) {
  return { ph: ids.map(() => '?').join(','), args: ids };
}
/**
 * Dampak penghapusan sebuah tahun pelajaran: jumlah baris data yang AKAN ikut
 * terhapus (termasuk riwayat milik siswa tahun pelajaran tersebut meskipun
 * riwayatnya tercatat pada tahun pelajaran lain, agar tidak menjadi data yatim).
 * Dipakai dialog konfirmasi "Hapus Tahun Pelajaran".
 */
function tahunDampak(id) {
  const n = Number(id) || 0;
  const ids = siswaIdsOfTa(n);
  const q = (sql, ...a) => { try { return db.prepare(sql).get(...a).c || 0; } catch (e) { return 0; } };
  const bySiswa = (tabel) => {
    if (!ids.length) return 0;
    const { ph } = inClause(ids);
    return q(`SELECT COUNT(*) c FROM ${tabel} WHERE ta_id=? OR siswa_id IN (${ph})`, n, ...ids);
  };
  return {
    siswa: q('SELECT COUNT(*) c FROM siswa WHERE tahun_ajaran_id=?', n),
    kelas: q('SELECT COUNT(*) c FROM kelas WHERE tahun_ajaran_id=?', n),
    kejadian: bySiswa('kejadian'),
    jurnal: bySiswa('jurnal'),
    tindak_lanjut: bySiswa('tindak_lanjut'),
    siswa_kelas: bySiswa('siswa_kelas'),
    feedback: q('SELECT COUNT(*) c FROM feedback WHERE ta_id=?', n),
    jadwal: q('SELECT COUNT(*) c FROM jadwal WHERE ta_id=?', n),
    wa_log: hasColumn('wa_log', 'ta_id') ? q('SELECT COUNT(*) c FROM wa_log WHERE ta_id=?', n) : 0
  };
}
/**
 * Hapus tahun pelajaran.
 * - Tahun pelajaran AKTIF tidak boleh dihapus (aktifkan tahun lain dulu).
 * - Tahun pelajaran terakhir tidak boleh dihapus (aplikasi butuh minimal satu).
 * - Bila masih ada data terkait, wajib `paksa:true` (snapshot + audit dicatat).
 * Semua penghapusan dilakukan dalam satu transaksi setelah snapshot dibuat.
 */
function tahunDelete(id, user, opts = {}) {
  const n = Number(id) || 0;
  const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(n);
  if (!ta) throw new Error('Tahun pelajaran tidak ditemukan.');
  if (ta.aktif) throw new Error(`Tahun pelajaran ${ta.nama} sedang AKTIF dan tidak dapat dihapus. Aktifkan tahun pelajaran lain terlebih dahulu.`);
  if (db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c <= 1) {
    throw new Error('Tahun pelajaran terakhir tidak dapat dihapus — aplikasi membutuhkan minimal satu tahun pelajaran.');
  }
  const dampak = tahunDampak(n);
  const totalData = Object.values(dampak).reduce((a, b) => a + b, 0);
  if (totalData > 0 && !opts.paksa) {
    const err = new Error(`Tahun pelajaran ${ta.nama} masih memiliki ${totalData} baris data terkait. Centang "Hapus juga data terkait" untuk melanjutkan.`);
    err.dampak = dampak;
    err.status = 409;
    throw err;
  }
  const snapshot = totalData > 0 ? snapshotFile('pre-hapus-ta') : '';
  const ids = siswaIdsOfTa(n);
  let hapus = 0;
  db.transaction(() => {
    if (totalData > 0) {
      if (ids.length) {
        const { ph } = inClause(ids);
        /* riwayat milik siswa tahun pelajaran ini (semua tahun pelajaran) → tidak ada data yatim */
        hapus += db.prepare(`DELETE FROM kejadian WHERE siswa_id IN (${ph})`).run(...ids).changes;
        hapus += db.prepare(`DELETE FROM jurnal WHERE siswa_id IN (${ph})`).run(...ids).changes;
        hapus += db.prepare(`DELETE FROM tindak_lanjut WHERE siswa_id IN (${ph})`).run(...ids).changes;
        hapus += db.prepare(`DELETE FROM siswa_kelas WHERE siswa_id IN (${ph})`).run(...ids).changes;
      }
      hapus += db.prepare('DELETE FROM kejadian WHERE ta_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM jurnal WHERE ta_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM tindak_lanjut WHERE ta_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM siswa_kelas WHERE ta_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM feedback WHERE ta_id=?').run(n).changes;
      if (hasColumn('wa_log', 'ta_id')) hapus += db.prepare('DELETE FROM wa_log WHERE ta_id=?').run(n).changes;
      /* jadwal & absensi mengajar milik tahun pelajaran ini — tanpa ini slot jadwal
         menjadi yatim (ta_id tidak ada) dan hilang dari menu Absensi. */
      hapus += db.prepare('DELETE FROM absensi_siswa WHERE sesi_id IN (SELECT id FROM absensi_sesi WHERE ta_id=?)').run(n).changes;
      hapus += db.prepare('DELETE FROM absensi_sesi WHERE ta_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM absensi_guru WHERE ta_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM jadwal_tukar WHERE ta_id=? OR jadwal_id IN (SELECT id FROM jadwal WHERE ta_id=?)').run(n, n).changes;
      hapus += db.prepare('DELETE FROM jadwal WHERE ta_id=?').run(n).changes;
      /* siswa & kelas milik tahun pelajaran ini */
      hapus += db.prepare('DELETE FROM siswa WHERE tahun_ajaran_id=?').run(n).changes;
      hapus += db.prepare('DELETE FROM kelas WHERE tahun_ajaran_id=?').run(n).changes;
      /* baris kotak sampah yang menunjuk data tahun pelajaran ini */
      try { db.prepare("DELETE FROM trash WHERE tabel IN ('siswa','kelas') AND CAST(json_extract(data,'$.tahun_ajaran_id') AS INTEGER)=?").run(n); } catch (e) { /* JSON1 tidak wajib */ }
    }
    hapus += db.prepare('DELETE FROM tahun_ajaran WHERE id=?').run(n).changes;
  })();
  if (Number(getSetting('ta_aktif', 0)) === n) setSetting('ta_aktif', (tahunAktif() || {}).id || '');
  logAudit(user, 'HAPUS', 'pengaturan',
    `Hapus tahun pelajaran ${ta.nama}` + (totalData ? ` beserta ${hapus} baris data terkait` : '') +
    (snapshot ? ` · snapshot ${path.basename(snapshot)}` : ''), '');
  return { nama: ta.nama, hapus, dampak, snapshot, totalData };
}

/* ============== KELAS PER TAHUN PELAJARAN & KENAIKAN KELAS ============== */
/** ganti label tingkat di dalam nama kelas ("X TKJ 1" → "XI TKJ 1") */
function gantiTingkatNama(nama, lama, baru) {
  const n = String(nama || '');
  const a = String(lama || '').trim();
  const b = String(baru || '').trim();
  if (!a || !b || a === b) return n;
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9])${esc}(?=$|[^A-Za-z0-9])`, 'i');
  return re.test(n) ? n.replace(re, (m, p1) => p1 + b) : n;
}
/** kelas lama (tanpa TA) diadopsi ke sebuah tahun pelajaran */
function adopsiKelasTanpaTa(taId) {
  if (!taId) return 0;
  const r = db.prepare('UPDATE kelas SET tahun_ajaran_id=? WHERE tahun_ajaran_id IS NULL').run(taId);
  return Number(r.changes) || 0;
}
/** daftar kelas milik satu TA (tanpa fallback) */
function kelasOfTa(taId) {
  return db.prepare('SELECT * FROM kelas WHERE tahun_ajaran_id=? ORDER BY urut, tingkat, nama').all(Number(taId) || 0);
}
/** simpan/refresh riwayat penempatan kelas seorang siswa */
function siswaKelasSet(siswaId, kelasId, taId) {
  if (!siswaId || !taId) return;
  db.prepare(`INSERT INTO siswa_kelas(siswa_id,kelas_id,ta_id,created_at) VALUES(?,?,?,?)
    ON CONFLICT(siswa_id,ta_id) DO UPDATE SET kelas_id=excluded.kelas_id`).run(Number(siswaId), kelasId || null, Number(taId), now());
}
/** riwayat kelas seorang siswa (urut TA terbaru di atas) */
function siswaKelasRiwayat(siswaId) {
  return db.prepare(`SELECT sk.*, k.nama AS kelas_nama, k.tingkat, k.jurusan, t.nama AS ta_nama
    FROM siswa_kelas sk
    LEFT JOIN kelas k ON k.id=sk.kelas_id
    LEFT JOIN tahun_ajaran t ON t.id=sk.ta_id
    WHERE sk.siswa_id=? ORDER BY sk.ta_id DESC`).all(Number(siswaId) || 0);
}

/**
 * Remap label tingkat seluruh kelas ketika format tingkat diubah
 * (Romawi → Angka → Kustom). Pemetaan dilakukan berdasarkan URUTAN tingkat,
 * bukan namanya, sehingga hierarki kenaikan kelas tetap konsisten.
 * @returns {{diubah:number, dilewati:number, detail:Array}}
 */
function terapkanTingkatKelas({ dariList, keList, taId = null, user = null } = {}) {
  const lama = Array.isArray(dariList) ? dariList : [];
  const baru = Array.isArray(keList) ? keList : [];
  if (!lama.length || !baru.length) return { diubah: 0, dilewati: 0, detail: [] };
  const rows = taId ? kelasOfTa(taId) : db.prepare('SELECT * FROM kelas ORDER BY tahun_ajaran_id, urut, id').all();
  /* urutan tingkat AKTUAL pada data kelas — dipakai bila label lama tidak ada di
     daftar `dariList` (mis. format diubah dua kali berturut-turut). */
  const aktual = [...new Set(rows.map(r => String(r.tingkat || '').trim()).filter(Boolean))];
  let diubah = 0, dilewati = 0;
  const detail = [];
  db.transaction(() => {
    for (const k of rows) {
      let i = lama.findIndex(x => String(x).trim().toLowerCase() === String(k.tingkat || '').trim().toLowerCase());
      if (i < 0) i = aktual.findIndex(x => x.toLowerCase() === String(k.tingkat || '').trim().toLowerCase());
      if (i < 0 || i >= baru.length) { dilewati++; continue; }
      const tkBaru = baru[i];
      if (String(tkBaru) === String(k.tingkat)) { dilewati++; continue; }
      const nama = gantiTingkatNama(k.nama, k.tingkat, tkBaru);
      db.prepare('UPDATE kelas SET tingkat=?, nama=? WHERE id=?').run(tkBaru, nama, k.id);
      diubah++;
      detail.push(`${k.nama} → ${nama} (${tkBaru})`);
    }
  })();
  if (user && diubah) logAudit(user, 'UBAH', 'kelas', `Format tingkat kelas diterapkan: ${diubah} kelas diperbarui`);
  return { diubah, dilewati, detail: detail.slice(0, 20) };
}

/** salin struktur kelas ke TA baru TANPA memindahkan siswa (dipakai bila TA
    baru belum diaktifkan, sehingga tampilan TA aktif tidak berubah). */
function salinKelasTa(prevTaId, newTaId) {
  const levels = tingkatList();
  const prevId = Number(prevTaId) || taKelasId();
  const newId = Number(newTaId) || 0;
  if (!prevId || !newId || prevId === newId) return { kelasBaru: 0 };
  adopsiKelasTanpaTa(prevId);
  let kelasBaru = 0;
  db.transaction(() => {
    for (const k of kelasOfTa(prevId)) {
      const i = tingkatIndex(k.tingkat, levels);
      if (i < 0 || i >= levels.length - 1) continue;
      const tingkatBaru = levels[i + 1];
      const namaBaru = gantiTingkatNama(k.nama, k.tingkat, tingkatBaru);
      const ada = db.prepare(`SELECT id FROM kelas WHERE tahun_ajaran_id=? AND lower(nama)=lower(?)`).get(newId, namaBaru);
      if (ada) continue;
      db.prepare(`INSERT INTO kelas(nama,tingkat,jurusan,wali_id,urut,created_at,tahun_ajaran_id)
        VALUES(?,?,?,?,?,?,?)`).run(namaBaru, tingkatBaru, k.jurusan || '', k.wali_id || null,
        k.urut || 0, now(), newId);
      kelasBaru++;
    }
  })();
  return { kelasBaru };
}

/** rencana kenaikan kelas (tanpa menulis apa pun) */
function kenaikanPreview(prevTaId, newTaId) {
  const levels = tingkatList();
  const prevId = Number(prevTaId) || taKelasId();
  const newId = Number(newTaId) || null;
  const prev = prevId ? db.prepare('SELECT * FROM kelas WHERE tahun_ajaran_id=?').all(prevId) : [];
  let naik = 0, lulus = 0, kelasBaru = 0, dilewati = 0;
  const plan = [];
  for (const k of prev.sort((a, b) => (a.urut || 0) - (b.urut || 0))) {
    const i = tingkatIndex(k.tingkat, levels);
    const jml = db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='aktif'").get(k.id).c;
    if (i < 0) { dilewati += jml; plan.push({ kelas: k.nama, tingkat: k.tingkat, ke: '-', siswa: jml, aksi: 'dilewati' }); continue; }
    if (i === levels.length - 1) {
      lulus += jml;
      plan.push({ kelas: k.nama, tingkat: k.tingkat, ke: 'Lulus / Nonaktif', siswa: jml, aksi: 'lulus' });
      continue;
    }
    const ke = levels[i + 1];
    naik += jml; kelasBaru++;
    plan.push({ kelas: k.nama, tingkat: k.tingkat, ke, siswa: jml, aksi: 'naik' });
  }
  return { prevTaId: prevId, newTaId: newId, levels, naik, lulus, kelasBaru, dilewati, plan };
}

/**
 * Kenaikan kelas otomatis:
 *  1. kelas tahun lalu disalin ke tahun pelajaran baru dengan tingkat +1
 *     (siswa tingkat akhir tidak dibuatkan kelas → status 'lulus'),
 *  2. siswa aktif dipindahkan ke kelas barunya + dicatat di riwayat siswa_kelas.
 * Idempoten: menjalankan ulang tidak membuat kelas/siswa ganda.
 */
function kenaikanKelas(prevTaId, newTaId, user = null, opts = {}) {
  const levels = tingkatList();
  const newId = Number(newTaId) || 0;
  if (!newId) throw new Error('Tahun pelajaran tujuan belum ditentukan.');
  const newTa = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(newId);
  if (!newTa) throw new Error('Tahun pelajaran tujuan tidak ditemukan.');
  let prevId = Number(prevTaId) || 0;
  if (!prevId) prevId = taKelasId();
  if (!prevId || prevId === newId) throw new Error('Tahun pelajaran asal tidak valid.');
  if (adopsiKelasTanpaTa(prevId)) { /* kelas lama diadopsi ke TA asal */ }
  const prevKelas = kelasOfTa(prevId);
  const hasil = { prevTaId: prevId, newTaId: newId, ta: newTa.nama, naik: 0, lulus: 0, kelasBaru: 0, dilewati: 0 };
  const mapKelas = new Map();   // kelas lama → kelas baru
  const kelasAkhir = [];        // kelas tingkat akhir (siswa lulus)

  db.transaction(() => {
    for (const k of prevKelas.sort((a, b) => (a.urut || 0) - (b.urut || 0))) {
      const i = tingkatIndex(k.tingkat, levels);
      if (i < 0) { hasil.dilewati++; continue; }
      if (i === levels.length - 1) { kelasAkhir.push(k); continue; }
      const tingkatBaru = levels[i + 1];
      const namaBaru = gantiTingkatNama(k.nama, k.tingkat, tingkatBaru);
      let target = db.prepare(`SELECT * FROM kelas WHERE tahun_ajaran_id=? AND lower(tingkat)=lower(?)
        AND lower(nama)=lower(?)`).get(newId, tingkatBaru, namaBaru);
      if (!target) {
        const r = db.prepare(`INSERT INTO kelas(nama,tingkat,jurusan,wali_id,urut,created_at,tahun_ajaran_id)
          VALUES(?,?,?,?,?,?,?)`).run(namaBaru, tingkatBaru, k.jurusan || '', k.wali_id || null,
          k.urut || 0, now(), newId);
        target = db.prepare('SELECT * FROM kelas WHERE id=?').get(Number(r.lastInsertRowid));
        hasil.kelasBaru++;
      }
      mapKelas.set(k.id, target.id);
    }
    /* penempatan siswa: catat riwayat TA lama dulu */
    for (const k of [...prevKelas]) {
      for (const s of db.prepare("SELECT id FROM siswa WHERE kelas_id=? AND status='aktif'").all(k.id)) {
        siswaKelasSet(s.id, k.id, prevId);
      }
    }
    for (const [oldId, newKelasId] of mapKelas.entries()) {
      for (const s of db.prepare("SELECT id FROM siswa WHERE kelas_id=? AND status='aktif'").all(oldId)) {
        db.prepare("UPDATE siswa SET kelas_id=?, status='aktif', tahun_ajaran_id=? WHERE id=?").run(newKelasId, newId, s.id);
        siswaKelasSet(s.id, newKelasId, newId);
        hasil.naik++;
      }
    }
    /* siswa tingkat akhir → lulus (riwayat kelas akhir tetap tercatat) */
    for (const k of kelasAkhir) {
      for (const s of db.prepare("SELECT id FROM siswa WHERE kelas_id=? AND status='aktif'").all(k.id)) {
        db.prepare("UPDATE siswa SET status='lulus' WHERE id=?").run(s.id);
        siswaKelasSet(s.id, k.id, prevId);
        hasil.lulus++;
      }
    }
  })();
  if (user) {
    logAudit(user, 'KENAIKAN KELAS', 'siswa',
      `${newTa.nama}: ${hasil.naik} siswa naik tingkat, ${hasil.lulus} siswa lulus, ${hasil.kelasBaru} kelas baru`);
  }
  return hasil;
}

/* =========================== MASTER QUERIES =========================== */
/** Tahun ajaran default untuk query kelas (TA aktif). */
function taKelasId(taId) {
  if (taId !== undefined && taId !== null && taId !== '') return Number(taId) || null;
  const t = tahunAktif();
  return t ? t.id : null;
}
/**
 * Daftar kelas. Bila `taId` diberikan → hanya kelas milik TA tersebut.
 * Tanpa argumen → kelas TA aktif (+ kelas lama yang belum punya TA, agar data
 * hasil migrasi tetap terpakai).
 */
function kelasList(taId) {
  const id = taKelasId(taId);
  const where = id ? 'WHERE (k.tahun_ajaran_id = ? OR k.tahun_ajaran_id IS NULL)' : '';
  const args = id ? [id] : [];
  return db.prepare(`SELECT k.*, u.nama AS wali_nama, u.nip AS wali_nip,
      (SELECT COUNT(*) FROM siswa s WHERE s.kelas_id=k.id AND s.status='aktif') AS jumlah
    FROM kelas k LEFT JOIN users u ON u.id=k.wali_id
    ${where}
    ORDER BY k.urut, k.tingkat, k.nama`).all(...args);
}
/** seluruh kelas (semua TA) — dipakai halaman master & remap tingkat */
function kelasAll() {
  return db.prepare(`SELECT k.*, t.nama AS ta_nama FROM kelas k
    LEFT JOIN tahun_ajaran t ON t.id=k.tahun_ajaran_id
    ORDER BY k.tahun_ajaran_id, k.urut, k.tingkat, k.nama`).all();
}
function waliUsers() {
  return db.prepare(`SELECT id,nama,nip,jabatan FROM users WHERE role='wali_kelas' AND aktif=1 ORDER BY nama`).all();
}
function kategoriList(jenis) {
  if (jenis) return db.prepare('SELECT * FROM kategori WHERE jenis=? ORDER BY urut, poin, nama').all(jenis);
  return db.prepare('SELECT * FROM kategori ORDER BY jenis DESC, urut, poin, nama').all();
}

/* ---------- ringkasan poin per siswa ---------- */
function scopeWali(user) {
  if (!user || user.role !== 'wali_kelas') return null;
  return db.prepare("SELECT id FROM kelas WHERE wali_id=?").all(user.id).map(r => r.id);
}

function siswaRows(opts = {}) {
  const { taId, semester, kelasId, q, statusKey, user, limit, offset } = opts;
  /* statusSiswa: aktif (default) | lulus | nonaktif | semua */
  const statusSiswa = opts.statusSiswa || 'aktif';
  const where = [];
  const params = [];
  if (statusSiswa !== 'semua') { where.push('s.status = ?'); params.push(String(statusSiswa)); }
  if (!where.length) where.push('1=1');
  if (kelasId) { where.push('s.kelas_id = ?'); params.push(Number(kelasId)); }
  if (q) { where.push('(lower(s.nama) LIKE ? OR s.nis LIKE ? OR s.nisn LIKE ? OR lower(k.nama) LIKE ?)'); const like = '%' + String(q).toLowerCase().trim() + '%'; params.push(like, like, like, like); }
  const scope = scopeWali(user);
  if (scope && scope.length) { where.push(`s.kelas_id IN (${scope.join(',')})`); }
  else if (scope && !scope.length) return [];

  let sql = `SELECT s.*, s.status AS status_siswa, k.nama AS kelas_nama, k.tingkat, k.jurusan, u.nama AS wali_nama,
      COALESCE(pl.poin,0) AS pel, COALESCE(pr.poin,0) AS pres
    FROM siswa s
    LEFT JOIN kelas k ON k.id = s.kelas_id
    LEFT JOIN users u ON u.id = k.wali_id
    LEFT JOIN (SELECT siswa_id, SUM(poin) poin FROM kejadian WHERE jenis='pelanggaran' ${taId ? 'AND ta_id=' + Number(taId) : ''} ${semester ? "AND semester='" + String(semester).replace(/[^a-z]/g, '') + "'" : ''} GROUP BY siswa_id) pl ON pl.siswa_id = s.id
    LEFT JOIN (SELECT siswa_id, SUM(poin) poin FROM kejadian WHERE jenis='prestasi' ${taId ? 'AND ta_id=' + Number(taId) : ''} ${semester ? "AND semester='" + String(semester).replace(/[^a-z]/g, '') + "'" : ''} GROUP BY siswa_id) pr ON pr.siswa_id = s.id
    WHERE ${where.join(' AND ')}
    ORDER BY k.urut, k.nama, s.nama`;
  let rows = db.prepare(sql).all(...params).map(decorate);
  if (statusKey && statusKey !== 'all') rows = rows.filter(r => r.status.key === statusKey);
  if (limit) rows = rows.slice(offset || 0, (offset || 0) + limit);
  return rows;
}

function decorate(r) {
  const rules = statusRules();
  const pel = Number(r.pel) || 0;
  const pres = Number(r.pres) || 0;
  const bersih = pel - pres;
  const st = statusOf(bersih, rules);
  return { ...r, pel, pres, bersih, status: st, sanksi: sanksiOf(pel), kelas_label: kelasLabelOf(r) };
}
function kelasLabelOf(r) {
  return (r.kelas_nama || '-');
}

function siswaById(id) {
  const r = db.prepare(`SELECT s.*, s.status AS status_siswa, k.nama AS kelas_nama, k.tingkat, k.jurusan,
      u.nama AS wali_nama, u.nip AS wali_nip, t.nama AS ta_nama
    FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id LEFT JOIN users u ON u.id=k.wali_id
    LEFT JOIN tahun_ajaran t ON t.id=s.tahun_ajaran_id WHERE s.id=?`).get(id);
  if (!r) return null;
  const row = siswaRowsAll(r);
  row.riwayat_kelas = siswaKelasRiwayat(id);
  return row;
}
function siswaRowsAll(base) {
  const pel = db.prepare("SELECT COALESCE(SUM(poin),0) p FROM kejadian WHERE siswa_id=? AND jenis='pelanggaran'").get(base.id).p;
  const pres = db.prepare("SELECT COALESCE(SUM(poin),0) p FROM kejadian WHERE siswa_id=? AND jenis='prestasi'").get(base.id).p;
  return decorate({ ...base, pel, pres });
}

/** poin pelanggaran dalam rentang hari terakhir (deteksi dini) */
function recentPoints(hari) {
  const from = new Date(Date.now() - (Number(hari) - 1) * 86400000);
  return db.prepare(`SELECT siswa_id, SUM(poin) poin, COUNT(*) jml, MAX(tanggal) terakhir
    FROM kejadian WHERE jenis='pelanggaran' AND tanggal >= ?
    GROUP BY siswa_id`).all(isoOf(from));
}

function kejadianList(opts = {}) {
  const { taId, semester, siswaId, kelasId, jenis, from, to, q, user, limit = 300 } = opts;
  const where = ['1=1'];
  const params = [];
  if (taId) { where.push('e.ta_id = ?'); params.push(Number(taId)); }
  if (semester) { where.push('e.semester = ?'); params.push(semester); }
  if (siswaId) { where.push('e.siswa_id = ?'); params.push(Number(siswaId)); }
  if (kelasId) { where.push('s.kelas_id = ?'); params.push(Number(kelasId)); }
  if (jenis) { where.push('e.jenis = ?'); params.push(jenis); }
  if (from) { where.push('e.tanggal >= ?'); params.push(from); }
  if (to) { where.push('e.tanggal <= ?'); params.push(to); }
  if (q) { where.push('(lower(s.nama) LIKE ? OR lower(e.judul) LIKE ? OR lower(e.keterangan) LIKE ?)'); const l = '%' + q.toLowerCase() + '%'; params.push(l, l, l); }
  const scope = scopeWali(user);
  if (scope) { where.push(scope.length ? `s.kelas_id IN (${scope.join(',')})` : '1=0'); }
  return db.prepare(`SELECT e.*, s.nama AS siswa_nama, s.nisn, s.nis, k.nama AS kelas_nama, kat.nama AS kategori_nama
    FROM kejadian e
    JOIN siswa s ON s.id = e.siswa_id
    LEFT JOIN kelas k ON k.id = s.kelas_id
    LEFT JOIN kategori kat ON kat.id = e.kategori_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.tanggal DESC, e.id DESC LIMIT ?`).all(...params, limit);
}

function kejadianSummary({ taId, semester } = {}) {
  const params = [];
  let w = '1=1';
  if (taId) { w += ' AND e.ta_id = ?'; params.push(Number(taId)); }
  if (semester) { w += ' AND e.semester = ?'; params.push(semester); }
  return db.prepare(`SELECT e.siswa_id, e.jenis, SUM(e.poin) poin, COUNT(*) jml,
      GROUP_CONCAT(DISTINCT COALESCE(kat.nama,'-')) kat
    FROM kejadian e LEFT JOIN kategori kat ON kat.id=e.kategori_id
    WHERE ${w} GROUP BY e.siswa_id, e.jenis`).all(...params);
}

/* ---------- tindak lanjut (pembinaan) ---------- */
function tindakLanjutRows(opts = {}) {
  const { siswaId, status, q, limit = 200, user } = opts;
  const where = ['1=1'];
  const params = [];
  if (siswaId) { where.push('tl.siswa_id = ?'); params.push(Number(siswaId)); }
  if (status && status !== 'all') { where.push('tl.status = ?'); params.push(status); }
  if (q) {
    where.push('(lower(s.nama) LIKE ? OR lower(tl.hasil) LIKE ? OR lower(tl.jenis) LIKE ? OR lower(k.nama) LIKE ?)');
    const l = '%' + String(q).toLowerCase() + '%'; params.push(l, l, l, l);
  }
  const scope = scopeWali(user);
  if (scope) where.push(scope.length ? `s.kelas_id IN (${scope.join(',')})` : '1=0');
  return db.prepare(`SELECT tl.*, s.nama AS siswa_nama, s.nisn, k.nama AS kelas_nama
    FROM tindak_lanjut tl
    JOIN siswa s ON s.id = tl.siswa_id
    LEFT JOIN kelas k ON k.id = s.kelas_id
    WHERE ${where.join(' AND ')}
    ORDER BY tl.tanggal DESC, tl.id DESC LIMIT ?`).all(...params, limit);
}
function tindakLanjutStats() {
  const rows = db.prepare("SELECT status, COUNT(*) c FROM tindak_lanjut GROUP BY status").all();
  const out = { selesai: 0, pemantauan: 0, lanjutan: 0, total: 0 };
  for (const r of rows) { out[r.status] = r.c; out.total += r.c; }
  return out;
}

/* ---------- buku penghubung digital ---------- */
function jurnalRows(opts = {}) {
  const { taId, tanggal, limit = 200, user, q } = opts;
  const where = ['1=1'];
  const params = [];
  if (taId) { where.push('j.ta_id = ?'); params.push(Number(taId)); }
  if (tanggal) { where.push('j.tanggal = ?'); params.push(tanggal); }
  if (q) { where.push('(lower(s.nama) LIKE ? OR lower(j.keterangan) LIKE ? OR lower(j.lokasi) LIKE ?)'); const l = '%' + String(q).toLowerCase() + '%'; params.push(l, l, l); }
  if (opts.kategoriId) { where.push('j.kategori_id = ?'); params.push(Number(opts.kategoriId)); }
  if (opts.jenis) { where.push('j.jenis = ?'); params.push(String(opts.jenis)); }
  const scope = scopeWali(user);
  if (scope) where.push(scope.length ? `s.kelas_id IN (${scope.join(',')})` : '1=0');
  return db.prepare(`SELECT j.*, s.nama AS siswa_nama, k.nama AS kelas_nama, kat.nama AS kategori_nama
    FROM jurnal j LEFT JOIN siswa s ON s.id=j.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
    LEFT JOIN kategori kat ON kat.id=j.kategori_id
    WHERE ${where.join(' AND ')}
    ORDER BY j.tanggal DESC, j.jam DESC, j.id DESC LIMIT ?`).all(...params, limit);
}

/* =====================================================================
   WHATSAPP GATEWAY (peringatan masal ke orang tua)
   ===================================================================== */
function waConfig() {
  const url = getSetting('wa_gateway_url', '');
  const provider = String(getSetting('wa_provider', '') || '').toLowerCase();
  const isFonnteUrl = /fonnte\.(com|co\.id|id)/i.test(String(url));
  return {
    aktif: String(getSetting('wa_aktif', '0')) === '1',
    url,
    token: getSetting('wa_gateway_token', ''),
    payload: getSetting('wa_gateway_payload', '') || '{"target":"{phone}","message":"{message}"}',
    header: getSetting('wa_gateway_header', 'Authorization'),
    prefix: getSetting('wa_gateway_prefix', ''),
    /* Fonnte memakai form-urlencoded (target+message) — terdeteksi otomatis dari URL */
    provider: isFonnteUrl ? 'fonnte'
      : ['fonnte', 'generik'].includes(provider) ? provider : 'generik',
    cooldownJam: Math.max(0, Number(getSetting('wa_cooldown_jam', 24)) || 0),
    template: getSetting('wa_template_massal', '') || getSetting('wa_template', ''),
    /* NOTIFIKASI OTOMATIS */
    alfaAktif: String(getSetting('wa_alfa_aktif', '1')) === '1',
    alfaTemplate: getSetting('wa_template_alfa', ''),
    izinAktif: String(getSetting('wa_izin_aktif', '1')) === '1',
    izinTemplate: getSetting('wa_template_izin', '')
  };
}
/** template bawaan notifikasi ketidakhadiran siswa (Alfa/Bolos) */
function waTemplateAlfa() {
  return String(getSetting('wa_template_alfa', '') || '').trim() || [
    'Assalamualaikum Bapak/Ibu wali dari {nama}.',
    '',
    'Kami informasikan bahwa {nama} (Kelas {kelas}) tercatat *{status}* pada mata pelajaran {mapel}',
    '({jam}) tanggal {tanggal} dan tidak mengikuti pembelajaran tanpa keterangan.',
    '',
    'Mohon perhatian Bapak/Ibu untuk pembinaan di rumah. Bila ada surat/keterangan, silakan sampaikan kepada wali kelas.',
    '',
    'Terima kasih.',
    '{sekolah}'
  ].join('\n');
}
/** template bawaan notifikasi guru tidak hadir (Sakit/Izin) */
function waTemplateIzin() {
  return String(getSetting('wa_template_izin', '') || '').trim() || [
    'Notifikasi Guru Tidak Hadir',
    '',
    'Guru : *{guru}*',
    'Status : *{status}*',
    'Tanggal : {tanggal}',
    'Jam pelajaran : {jam}',
    'Mapel/Kelas : {mapel} · {kelas}',
    'Alasan : {alasan}',
    '',
    'Silakan menunjuk guru pengganti pada menu *Guru Piket & Pengganti* agar kelas tetap terisi.',
    '{sekolah}'
  ].join('\n');
}

/* =====================================================================
   PENGINGAT JADWAL MENGAJAR & PERINGATAN CHECK-IN (WhatsApp / Fonnte)
   ---------------------------------------------------------------------
   · PENGINGAT dikirim `ingatMenit` menit SEBELUM jam pelajaran dimulai.
   · PERINGATAN keterlambatan dikirim bila guru BELUM check-in `telatMenit`
     menit setelah jam pelajaran dimulai:
       a) ke guru bersangkutan,
       b) ke Kepala Sekolah / Wakasek Kurikulum / Guru Piket (opsional).
   Nilai dibaca dalam SATU query agar tidak menambah beban per request.
   Kedua fitur bawaan NONAKTIF sampai sekolah mengaktifkannya (pesan WA
   berbiaya kirim, jadi tidak boleh menyala sendiri).
   ===================================================================== */
const WA_JADWAL_KEYS = [
  'wa_jadwal_ingat_aktif', 'wa_jadwal_ingat_menit', 'wa_jadwal_telat_aktif', 'wa_jadwal_telat_menit',
  'wa_jadwal_telat_atasan_aktif', 'wa_template_jadwal_ingat', 'wa_template_jadwal_telat',
  'wa_template_jadwal_telat_atasan', 'piket_wa'
];
function waJadwalConfig() {
  const val = {};
  try {
    const ph = WA_JADWAL_KEYS.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT key,value FROM settings WHERE key IN (${ph})`).all(...WA_JADWAL_KEYS)) {
      val[r.key] = r.value;
    }
  } catch (e) { /* tabel settings belum ada */ }
  /* Belum pernah diatur (kunci tidak ada / kosong) = AKTIF. Pengingat hanya
     benar-benar terkirim bila gateway WhatsApp sekolah juga sudah aktif,
     sehingga sekolah yang belum memakai WA tidak terpengaruh. */
  const on = (k) => {
    const v = val[k];
    if (v === undefined || v === null || String(v).trim() === '') return true;
    return ['1', 'true', 'on', 'ya'].includes(String(v).toLowerCase());
  };
  const menit = (k, def) => Math.max(1, Math.min(180, Number(val[k]) || def));
  return {
    ingatAktif: on('wa_jadwal_ingat_aktif'),
    ingatMenit: menit('wa_jadwal_ingat_menit', 15),
    telatAktif: on('wa_jadwal_telat_aktif'),
    telatMenit: menit('wa_jadwal_telat_menit', 15),
    telatAtasanAktif: on('wa_jadwal_telat_atasan_aktif'),
    piketWa: String(val.piket_wa || '')
  };
}
/** template bawaan pengingat sebelum jam pelajaran (variabel lihat waFill) */
function waTemplateJadwalIngat() {
  return String(getSetting('wa_template_jadwal_ingat', '') || '').trim() || [
    'Pengingat Jadwal Mengajar',
    '',
    'Bapak/Ibu *{guru}*, {menit} menit lagi jadwal mengajar dimulai:',
    '',
    'Mata pelajaran : {mapel}',
    'Kelas : {kelas}',
    'Ruang : {ruang}',
    'Jam : {jam} ({sesi})',
    '',
    'Mohon bersiap menuju kelas agar pembelajaran dimulai tepat waktu.',
    '{sekolah}'
  ].join('\n');
}
/** template bawaan peringatan ke GURU yang belum check-in */
function waTemplateJadwalTelat() {
  return String(getSetting('wa_template_jadwal_telat', '') || '').trim() || [
    'Peringatan Kehadiran Mengajar',
    '',
    'Bapak/Ibu *{guru}*, jam pelajaran berikut sudah berjalan *{lewat} menit* tetapi belum ada check-in:',
    '',
    'Mata pelajaran : {mapel}',
    'Kelas : {kelas}',
    'Ruang : {ruang}',
    'Jam : {jam} ({sesi})',
    '',
    'Mohon segera lakukan *Check-in* pada menu Absensi Guru Mapel. Bila berhalangan, konfirmasi Sakit/Izin agar kelas dapat ditangani.',
    '{sekolah}'
  ].join('\n');
}
/** template bawaan laporan ke Kepala Sekolah / Wakasek Kurikulum / Guru Piket */
function waTemplateJadwalTelatAtasan() {
  return String(getSetting('wa_template_jadwal_telat_atasan', '') || '').trim() || [
    'Laporan Guru Belum Check-in',
    '',
    'Guru : *{guru}*',
    'Mapel : {mapel}',
    'Kelas : {kelas}',
    'Ruang : {ruang}',
    'Jam : {jam} ({sesi})',
    'Terlambat : *{lewat} menit* (belum check-in)',
    '',
    'Mohon pengawasan, atau pertimbangkan penunjukan guru pengganti pada menu *Guru Piket & Pengganti* agar kelas tetap terisi.',
    '{sekolah}'
  ].join('\n');
}

/** waktu kirim terakhir per siswa (untuk penguncian jeda) */
function waLastMap() {
  const out = new Map();
  const rows = db.prepare(`SELECT siswa_id, MAX(created_at) AS terakhir FROM wa_log
    WHERE siswa_id IS NOT NULL GROUP BY siswa_id`).all();
  for (const r of rows) out.set(Number(r.siswa_id), String(r.terakhir || ''));
  return out;
}

/** cek apakah pengiriman ke siswa masih terkunci (jeda wa_cooldown_jam) */
function waLockOf(siswaId, lastMap, cooldownJam) {
  const jam = cooldownJam === undefined ? waConfig().cooldownJam : Number(cooldownJam);
  if (!jam) return null;
  const map = lastMap || waLastMap();
  const last = map.get(Number(siswaId));
  if (!last) return null;
  const t = new Date(String(last).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  const sampai = new Date(t.getTime() + jam * 3600000);
  if (Date.now() >= sampai.getTime()) return null;
  return { terakhir: last, sampai: lib.plusMinutesStamp(Math.ceil((sampai.getTime() - Date.now()) / 60000)), sisa_jam: Math.max(1, Math.ceil((sampai.getTime() - Date.now()) / 3600000)) };
}

/** isi template pesan peringatan untuk satu siswa */
function waMessage(siswa, opts = {}) {
  const st = allSettings();
  const tpl = String(opts.template || waConfig().template || st.wa_template || '');
  const guru = String(opts.guru || '').trim() || '-';
  return tpl
    .replace(/\{nama\}/g, siswa.nama || '-')
    .replace(/\{kelas\}/g, siswa.kelas_nama || '-')
    .replace(/\{pel\}/g, String(siswa.pel ?? 0))
    .replace(/\{pres\}/g, String(siswa.pres ?? 0))
    .replace(/\{bersih\}/g, String(siswa.bersih ?? 0))
    .replace(/\{status\}/g, (siswa.status && siswa.status.label) || '-')
    .replace(/\{sanksi\}/g, (siswa.sanksi && siswa.sanksi.label) || '-')
    .replace(/\{sekolah\}/g, st.sekolah_nama || '')
    .replace(/\{guru\}/g, guru);
}

/** kirim satu pesan melalui gateway (bila belum dikonfigurasi → status 'manual') */
async function waSend(phone, message, overrides = {}) {
  const cfg = { ...waConfig(), ...overrides };
  if (/fonnte\.(com|co\.id|id)/i.test(String(cfg.url))) cfg.provider = 'fonnte';
  if (!cfg.aktif || !cfg.url) return { status: 'manual', error: '' };
  const nomor = String(phone || '').replace(/[^\d]/g, '');
  if (!nomor) return { status: 'gagal', error: 'Nomor tujuan kosong.' };
  try {
    const headers = {};
    if (cfg.provider === 'fonnte') {
      const token = String(cfg.token || '').trim().replace(/^Bearer\s+/i, '');
      if (!token) return { status: 'gagal', error: 'Token Fonnte belum diisi.' };
      headers.Authorization = token;
    } else if (cfg.token && cfg.header) {
      headers[cfg.header] = cfg.prefix ? cfg.prefix + cfg.token : cfg.token;
    }
    let body, url = cfg.url;
    if (cfg.provider === 'fonnte') {
      /* FONNTE: POST https://api.fonnte.com/send — form-urlencoded { target, message } */
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ target: nomor, message: String(message || '') }).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      const raw = String(cfg.payload || '')
        .replace(/\{phone\}/g, nomor).replace(/\{message\}/g, String(message || '').replace(/\n/g, '\\n'));
      let parsed;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = { target: nomor, message }; }
      body = JSON.stringify(parsed);
    }
    const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    if (!r.ok) return { status: 'gagal', error: `HTTP ${r.status} ${txt.slice(0, 160)}` };
    /* Fonnte membalas {"status":false,"reason":"..."} saat token/nomor bermasalah */
    if (cfg.provider === 'fonnte') {
      try {
        const j = JSON.parse(txt);
        if (j && j.status === false) return { status: 'gagal', error: String(j.reason || txt).slice(0, 200) };
      } catch (e) { /* balasan bukan JSON → anggap sukses */ }
    }
    return { status: 'terkirim', error: '', response: txt.slice(0, 300) };
  } catch (e) {
    return { status: 'gagal', error: e.message };
  }
}

/* ---------- notifikasi otomatis (alfa siswa & izin guru) ---------- */
/** isi template: {nama} {kelas} {status} {mapel} {jam} {tanggal} {keterangan} {sekolah} */
function waFill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}
/** catat hasil kirim ke wa_log (riwayat + penanda dedupe) */
function waLogAdd({ siswaId, nama, phone, jenis, pesan, oleh, olehNama, status, sumber, error, taId, ref, modul }) {
  try {
    db.prepare(`INSERT INTO wa_log(siswa_id,nama,phone,jenis,pesan,oleh,oleh_nama,created_at,status,sumber,ta_id,error,ref,modul)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(siswaId ? Number(siswaId) : null, String(nama || ''), String(phone || ''), String(jenis || ''),
        String(pesan || ''), oleh ? Number(oleh) : null, String(olehNama || ''), now(),
        String(status || 'terkirim'), String(sumber || 'gateway'), taId ? Number(taId) : null,
        String(error || ''), ref ? String(ref) : null, modul ? String(modul) : null);
    return true;
  } catch (e) { return false; }
}
/** apakah notifikasi untuk (ref, siswa) sudah pernah dikirim */
function waSudahKirim(ref, siswaId) {
  try {
    const sid = Number(siswaId) || 0;
    return sid
      ? !!db.prepare("SELECT id FROM wa_log WHERE ref=? AND siswa_id=? AND COALESCE(status,'')<>'gagal' LIMIT 1").get(String(ref || ''), sid)
      : !!db.prepare("SELECT id FROM wa_log WHERE ref=? AND siswa_id IS NULL AND COALESCE(status,'')<>'gagal' LIMIT 1").get(String(ref || ''));
  } catch (e) { return false; }
}

/* =====================================================================
   MASUKAN & KENDALA (umpan balik pengguna)
   ===================================================================== */
const FEEDBACK_JENIS = [
  { key: 'masukan', label: 'Masukan / Saran' },
  { key: 'kendala', label: 'Kendala Teknis' },
  { key: 'fitur', label: 'Permintaan Fitur' },
  { key: 'lainnya', label: 'Lainnya' }
];
const FEEDBACK_STATUS = [
  { key: 'baru', label: 'Baru', tone: 'pantau' },
  { key: 'dibaca', label: 'Dibaca', tone: 'netral' },
  { key: 'diproses', label: 'Diproses', tone: 'siaga' },
  { key: 'selesai', label: 'Selesai', tone: 'aman' }
];

function feedbackAdd(user, data = {}) {
  const jenis = FEEDBACK_JENIS.some(j => j.key === data.jenis) ? data.jenis : 'masukan';
  const pesan = String(data.pesan || '').trim();
  if (pesan.length < 5) throw new Error('Isi masukan/kendala wajib diisi (minimal 5 karakter).');
  const ta = tahunAktif();
  const r = db.prepare(`INSERT INTO feedback(user_id,nama,role,jabatan,jenis,judul,pesan,status,prioritas,halaman,ta_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'baru',?,?,?,?,?)`)
    .run(user.id, user.nama, user.role, user.jabatan || '', jenis,
      String(data.judul || '').trim().slice(0, 120), pesan.slice(0, 4000),
      ['rendah', 'normal', 'tinggi'].includes(data.prioritas) ? data.prioritas : 'normal',
      String(data.halaman || '').slice(0, 60), ta ? ta.id : null, now(), now());
  return Number(r.lastInsertRowid);
}

function feedbackRows(opts = {}) {
  const where = ['1=1'];
  const params = [];
  if (opts.userId) { where.push('user_id = ?'); params.push(Number(opts.userId)); }
  if (opts.status && opts.status !== 'all') { where.push('status = ?'); params.push(opts.status); }
  if (opts.jenis && opts.jenis !== 'all') { where.push('jenis = ?'); params.push(opts.jenis); }
  if (opts.q) {
    where.push('(lower(COALESCE(nama,\'\')) LIKE ? OR lower(COALESCE(judul,\'\')) LIKE ? OR lower(pesan) LIKE ?)');
    const l = '%' + String(opts.q).toLowerCase() + '%'; params.push(l, l, l);
  }
  return db.prepare(`SELECT * FROM feedback WHERE ${where.join(' AND ')}
    ORDER BY CASE status WHEN 'baru' THEN 0 WHEN 'diproses' THEN 1 WHEN 'dibaca' THEN 2 ELSE 3 END,
      CASE prioritas WHEN 'tinggi' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      id DESC LIMIT ?`).all(...params, Number(opts.limit) || 300);
}

function feedbackStats() {
  const out = { total: 0, baru: 0, dibaca: 0, diproses: 0, selesai: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) c FROM feedback GROUP BY status').all()) {
    out[r.status] = r.c; out.total += r.c;
  }
  return out;
}

/* =====================================================================
   RIWAYAT AKTIVITAS (jurnal harian + kejadian) — hanya untuk dashboard
   ===================================================================== */
function riwayatAktivitas(opts = {}) {
  const { limit = 120, user, taId } = opts;
  const scope = scopeWali(user);
  const sc = (alias) => scope ? ` AND s.kelas_id IN (${scope.length ? scope.join(',') : 0})` : '';
  const j = db.prepare(`SELECT j.id, 'jurnal' AS sumber, j.tanggal, j.jam, j.jenis, j.poin, j.lokasi,
      j.keterangan, j.created_at, COALESCE(j.petugas, u.nama, '-') AS pelapor, COALESCE(j.petugas_role, u.role, '') AS pelapor_role,
      s.nama AS siswa_nama, s.id AS siswa_id, k.nama AS kelas_nama, kat.nama AS kategori_nama
    FROM jurnal j LEFT JOIN siswa s ON s.id=j.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
    LEFT JOIN kategori kat ON kat.id=j.kategori_id LEFT JOIN users u ON u.id=j.petugas_id
    WHERE 1=1 ${taId ? 'AND j.ta_id=' + Number(taId) : ''}${sc('s')}`).all();
  const e = db.prepare(`SELECT e.id, 'kejadian' AS sumber, e.tanggal, COALESCE(e.jam,'') AS jam, e.jenis, e.poin, e.lokasi,
      e.keterangan, e.created_at, COALESCE(e.oleh_nama, u.nama, '-') AS pelapor, COALESCE(u.role, '') AS pelapor_role,
      s.nama AS siswa_nama, s.id AS siswa_id, k.nama AS kelas_nama, kat.nama AS kategori_nama
    FROM kejadian e JOIN siswa s ON s.id=e.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
    LEFT JOIN kategori kat ON kat.id=e.kategori_id LEFT JOIN users u ON u.id=e.oleh
    WHERE NOT EXISTS (SELECT 1 FROM jurnal jj WHERE jj.kejadian_id = e.id) ${taId ? 'AND e.ta_id=' + Number(taId) : ''}${sc('s')}`).all();
  const all = [...j, ...e].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))
    || String(b.tanggal || '').localeCompare(String(a.tanggal || '')) || b.id - a.id);
  return all.slice(0, limit);
}


function polaPelanggaran(opts = {}) {
  const { taId, semester, user, from, to } = opts;
  const where = ["e.jenis='pelanggaran'"];
  const params = [];
  if (taId) { where.push('e.ta_id = ?'); params.push(Number(taId)); }
  if (semester) { where.push('e.semester = ?'); params.push(semester); }
  if (from) { where.push('e.tanggal >= ?'); params.push(from); }
  if (to) { where.push('e.tanggal <= ?'); params.push(to); }
  const scope = scopeWali(user);
  if (scope) where.push(scope.length ? `s.kelas_id IN (${scope.join(',')})` : '1=0');
  const rows = db.prepare(`SELECT e.tanggal, e.jam, e.lokasi, e.poin, COALESCE(kat.nama, e.judul) AS kategori
    FROM kejadian e JOIN siswa s ON s.id=e.siswa_id
    LEFT JOIN kategori kat ON kat.id=e.kategori_id
    WHERE ${where.join(' AND ')}`).all(...params);

  const byDay = HARI.map(h => ({ label: h, jml: 0, poin: 0 }));
  const byHour = {};
  const byLokasi = {};
  for (const r of rows) {
    const d = new Date(String(r.tanggal) + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) {
      const day = byDay[d.getDay()];
      day.jml++; day.poin += Number(r.poin) || 0;
    }
    const hh = String(r.jam || '').slice(0, 2);
    const hour = /^\d{2}$/.test(hh) ? Number(hh) : null;
    if (hour !== null) {
      byHour[hour] = byHour[hour] || { hour, jml: 0, poin: 0 };
      byHour[hour].jml++; byHour[hour].poin += Number(r.poin) || 0;
    }
    const lok = (r.lokasi || '').trim() || 'Tidak dicatat';
    byLokasi[lok] = byLokasi[lok] || { label: lok, jml: 0, poin: 0 };
    byLokasi[lok].jml++; byLokasi[lok].poin += Number(r.poin) || 0;
  }
  const hours = [];
  for (let h = 6; h <= 18; h++) hours.push(byHour[h] || { hour: h, jml: 0, poin: 0 });
  const perKategori = {};
  for (const r of rows) {
    const key = r.kategori || 'Lainnya';
    perKategori[key] = perKategori[key] || { label: key, jml: 0, poin: 0 };
    perKategori[key].jml++; perKategori[key].poin += Number(r.poin) || 0;
  }
  const top = (arr, n) => [...arr].sort((a, b) => b.jml - a.jml || b.poin - a.poin).slice(0, n);
  return {
    total: rows.length,
    byDay,
    byHour: hours,
    byLokasi: top(Object.values(byLokasi), 8),
    perKategori: top(Object.values(perKategori), 8),
    jamRawan: top(hours.filter(h => h.jml), 3),
    hariRawan: top(byDay.filter(d => d.jml), 3),
    lokasiRawan: top(Object.values(byLokasi), 3),
    tanpaJam: rows.filter(r => !r.jam).length,
    tanpaLokasi: rows.filter(r => !(r.lokasi || '').trim()).length
  };
}

function nextNomor(jenis) {
  const n = db.prepare("SELECT COUNT(*) c FROM surat_log WHERE jenis=?").get(jenis).c + 1;
  const rom = { panggilan: 'I', sp1: 'I', sp2: 'II', sp3: 'III' }[jenis] || 'I';
  return `${String(n).padStart(3, '0')}/SP-${rom}/${new Date().getFullYear()}`;
}

/* =========================== SEED =========================== */
const SEED_VERSION = '1';
/**
 * Lengkapi baris `permissions` untuk role/fitur/aksi yang belum ada.
 * Dipanggil setiap kali seed() berjalan DAN setiap kali sebuah database sekolah
 * dibuka pertama kali pada proses ini — sehingga role baru (mis. Wakasek
 * Kurikulum) serta fitur baru (jadwal / absensi) otomatis mendapat baris izin
 * bawaan pada database sekolah lama tanpa menimpa pengaturan manual.
 */
/* ===================== MODUL BK: SEED & HELPER ===================== */
/** kategori poin otomatis (Alpha / Bolos) — sumber bobot poin ada di Master Kategori Poin */
function kategoriAuto(autoKey) {
  return db.prepare('SELECT * FROM kategori WHERE auto_key=?').get(String(autoKey)) || null;
}
function absensiPoinConfig() {
  const aktif = String(getSetting('absensi_auto_poin', '1')) !== '0';
  const alfa = kategoriAuto('absensi_alfa');
  const bolos = kategoriAuto('absensi_bolos');
  return {
    aktif,
    alfa: alfa ? { id: alfa.id, nama: alfa.nama, poin: Number(alfa.poin) || 0, aktif: !!alfa.aktif }
      : { id: null, nama: 'Alpha', poin: Number(getSetting('absensi_poin_alfa', 5)) || 5, aktif: false },
    bolos: bolos ? { id: bolos.id, nama: bolos.nama, poin: Number(bolos.poin) || 0, aktif: !!bolos.aktif }
      : { id: null, nama: 'Bolos', poin: Number(getSetting('absensi_poin_bolos', 10)) || 10, aktif: false }
  };
}
function semesterOf(iso) {
  const m = Number(String(iso || '').slice(5, 7));
  return m >= 7 ? 'ganjil' : 'genap';
}
/**
 * Sinkronisasi status absensi siswa (Alpha / Bolos) menjadi catatan pelanggaran
 * di Buku Poin. Dipanggil setiap kali presensi disimpan (guru, wali kelas,
 * ketua kelas, maupun admin). Idempoten: satu baris absensi = satu catatan.
 * Status yang dikoreksi menjadi Hadir/Sakit/Izin menghapus catatan otomatis.
 */
function absensiPoinSync(sesi, pencatat, pencatatRole, userId) {
  if (!sesi || !sesi.id) return { dibuat: 0, diperbarui: 0, dihapus: 0 };
  const cfg = absensiPoinConfig();
  const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(sesi.mapel_id)) || {};
  const rows = db.prepare(`SELECT a.*, s.nama AS siswa_nama, k.nama AS kelas_nama
    FROM absensi_siswa a LEFT JOIN siswa s ON s.id=a.siswa_id LEFT JOIN kelas k ON k.id=a.kelas_id
    WHERE a.sesi_id=?`).all(Number(sesi.id));
  const jam = (() => {
    try {
      const j = db.prepare('SELECT sesi,hari FROM jadwal WHERE id=?').get(Number(sesi.jadwal_id)) || {};
      const s = sesiOfHari(null, j.hari).find(x => Number(x.idx) === Number(j.sesi));
      return s ? s.mulai : '';
    } catch (e) { return ''; }
  })();
  let dibuat = 0, diperbarui = 0, dihapus = 0;
  db.transaction(() => {
    for (const r of rows) {
      const ada = db.prepare("SELECT * FROM kejadian WHERE sumber='absensi' AND ref_id=?").get(Number(r.id));
      const alfa = r.status === 'A', bolos = r.status === 'B';
      if (!alfa && !bolos) {
        if (ada) { db.prepare('DELETE FROM kejadian WHERE id=?').run(ada.id); dihapus++; }
        continue;
      }
      if (!cfg.aktif) continue;
      const kat = alfa ? cfg.alfa : cfg.bolos;
      if (!kat.id || !kat.aktif) continue;
      const label = alfa ? 'Alpha' : 'Bolos';
      const ket = `Otomatis dari Absensi ${mapel.nama || 'Mata Pelajaran'} tanggal ${tanggalPanjang(sesi.tanggal)}`
        + ` - Status: ${label}`
        + (r.kelas_nama ? ` · Kelas ${r.kelas_nama}` : '')
        + (pencatat ? ` · Pencatat: ${pencatat}` : '');
      const judul = `${label} — ${mapel.nama || 'Mata Pelajaran'}`;
      const taId = Number(sesi.ta_id) || (tahunAktif() || {}).id || null;
      const sem = semesterOf(sesi.tanggal);
      if (ada) {
        db.prepare(`UPDATE kejadian SET kategori_id=?,judul=?,jenis='pelanggaran',poin=?,tanggal=?,jam=?,keterangan=?,ta_id=?,semester=?,oleh=?,oleh_nama=? WHERE id=?`)
          .run(kat.id, judul, kat.poin, sesi.tanggal, jam, ket, taId, sem, userId || null, pencatat || ada.oleh_nama || '', ada.id);
        diperbarui++;
      } else {
        db.prepare(`INSERT INTO kejadian(siswa_id,kategori_id,judul,jenis,poin,tanggal,jam,keterangan,bukti_url,ta_id,semester,oleh,oleh_nama,created_at,sumber,ref_id)
          VALUES(?,?,?,?,?,?,?,?,'',?,?,?,?,?,?,?)`)
          .run(Number(r.siswa_id), kat.id, judul, 'pelanggaran', kat.poin, sesi.tanggal, jam, ket,
            taId, sem, userId || null, pencatat || '', now(), 'absensi', Number(r.id));
        dibuat++;
      }
    }
  })();
  return { dibuat, diperbarui, dihapus };
}

/** pastikan kategori otomatis & bank soal bawaan tersedia (idempoten) */
function seedFiturBaru() {
  /* 1) kategori poin otomatis dari absensi */
  const autoCats = [
    { key: 'absensi_alfa', nama: 'Alpha / Tidak Hadir Tanpa Keterangan', poin: Number(getSetting('absensi_poin_alfa', 5)) || 5,
      ket: 'Dibuat otomatis dari absensi siswa (status Alpha). Ubah poin di halaman ini bila perlu.' },
    { key: 'absensi_bolos', nama: 'Bolos / Keluar Kelas Tanpa Izin', poin: Number(getSetting('absensi_poin_bolos', 10)) || 10,
      ket: 'Dibuat otomatis dari absensi siswa (status Bolos). Ubah poin di halaman ini bila perlu.' }
  ];
  for (const c of autoCats) {
    if (db.prepare('SELECT id FROM kategori WHERE auto_key=?').get(c.key)) continue;
    const urut = (db.prepare('SELECT COALESCE(MAX(urut),0) m FROM kategori').get().m || 0) + 1;
    db.prepare('INSERT INTO kategori(nama,jenis,poin,keterangan,aktif,urut,auto_key) VALUES(?,?,?,?,1,?,?)')
      .run(c.nama, 'pelanggaran', Math.max(1, c.poin), c.ket, urut, c.key);
  }
  /* 2) jenis layanan BK */
  if (!db.prepare('SELECT COUNT(*) c FROM bk_jenis').get().c) {
    const ins = db.prepare('INSERT INTO bk_jenis(nama,kategori,sasaran,aktif,urut,created_at) VALUES(?,?,?,1,?,?)');
    BK_JENIS_DEFAULT.forEach((j, i) => ins.run(j.nama, j.kategori, j.sasaran, i + 1, now()));
  }
  /* 3) instrumen asesmen + bank soal bawaan (hanya bila instrumen belum ada) */
  for (const ins of ASESMEN_DEFAULT) {
    const ada = db.prepare('SELECT kode FROM asesmen_instrumen WHERE kode=?').get(ins.kode);
    if (!ada) {
      db.prepare(`INSERT INTO asesmen_instrumen(kode,nama,deskripsi,petunjuk,tipe,aktif,token_aktif,versi,created_at,updated_at)
        VALUES(?,?,?,?,?,1,1,1,?,?)`).run(ins.kode, ins.nama, ins.deskripsi, ins.petunjuk, ins.tipe, now(), now());
    }
    const jml = db.prepare('SELECT COUNT(*) c FROM asesmen_soal WHERE kode=?').get(ins.kode).c;
    if (!jml) {
      const insSoal = db.prepare('INSERT INTO asesmen_soal(kode,nomor,teks,kategori,indikator,aktif,versi,created_at) VALUES(?,?,?,?,?,1,1,?)');
      ins.soal.forEach((s, i) => insSoal.run(ins.kode, i + 1, s[2], s[0], s[1], now()));
    }
  }
}

function seedPermissions() {
  db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO permissions(role,feature,action,allowed) VALUES(?,?,?,?)');
    for (const role of ROLES) {
      for (const f of FEATURES) {
        for (const a of ACTIONS) {
          const d = DEFAULT_PERMS[role] || {};
          let allowed = 0;
          if (a === 'view' && ACCOUNT_FEATURES.includes(f.key)) allowed = 1;
          if (OPEN_WRITE_FEATURES.includes(f.key) && (a === 'view' || a === 'write')) allowed = 1;
          if ((d.view || []).includes(f.key) && a === 'view') allowed = 1;
          if ((d.write || []).includes(f.key) && (a === 'write' || a === 'view')) allowed = 1;
          if ((d.delete || []).includes(f.key) && a === 'delete') allowed = 1;
          ins.run(role, f.key, a, allowed);
        }
      }
    }
    if (getSetting('mig_absensi_pimpinan_view_v1', '') !== '1') {
      const grantView = db.prepare(`INSERT INTO permissions(role,feature,action,allowed) VALUES(?,?, 'view',1)
        ON CONFLICT(role,feature,action) DO UPDATE SET allowed=1`);
      for (const role of ['kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan']) {
        for (const feature of ['absensi_guru', 'absensi_siswa']) grantView.run(role, feature);
      }
      setSetting('mig_absensi_pimpinan_view_v1', '1');
    }
  })();
}

function seed() {
  const already = getSetting('seed_version', '');
  db.transaction(() => {
    for (const [k, v] of Object.entries(SETTINGS_DEFAULT)) {
      if (getSetting(k, null) === null) setSetting(k, v);
    }
    if (!getSetting('seed_version', '')) setSetting('seed_version', SEED_VERSION);

    /* MIGRASI kop manual: dulu baris ke-4 kop manual SELALU dicetak tebal & sebesar kop_font_besar
       (dianggap "nama sekolah"). Aturan paksa itu dihapus agar teks dicetak persis seperti yang
       diketik, jadi tampilan lama disalin SEKALI ke kop_format supaya hasil cetak tidak berubah. */
    if (!getSetting('mig_kop_manual_bold_v1', '')) {
      if (String(getSetting('kop_sumber', '')) === 'manual') {
        const barisManual = String(getSetting('kop_baris', '') || '').split('\n').map(x => x.trim()).filter(Boolean);
        let fmt = [];
        try { fmt = JSON.parse(getSetting('kop_format', '[]') || '[]'); } catch (e) { fmt = []; }
        if (Array.isArray(fmt) && barisManual.length > 3) {
          while (fmt.length < 4) fmt.push({ size: null, bold: false });
          const row = fmt[3] || {};
          if (row.bold !== true || !(Number(row.size) > 0)) {
            fmt[3] = {
              size: Number(row.size) > 0 ? Number(row.size) : (Number(getSetting('kop_font_besar', '16.5')) || 16.5),
              bold: true
            };
            setSetting('kop_format', JSON.stringify(fmt));
          }
        }
      }
      setSetting('mig_kop_manual_bold_v1', '1');
    }

    /* tahun ajaran */
    if (!db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c) {
      const y = new Date().getFullYear();
      const ins = db.prepare('INSERT INTO tahun_ajaran(nama,tanggal_mulai,tanggal_selesai,aktif,created_at) VALUES(?,?,?,?,?)');
      ins.run(`${y}/${y + 1}`, `${y}-07-01`, `${y + 1}-06-30`, 1, now());
      ins.run(`${y - 1}/${y}`, `${y - 1}-07-01`, `${y}-06-30`, 0, now());
    }

    /* admin + contoh pengguna */
    if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
      const ins = db.prepare('INSERT INTO users(nama,jabatan,username,pass_hash,role,nip,phone,aktif,created_at) VALUES(?,?,?,?,?,?,?,1,?)');
      ins.run('Administrator Sistem', 'Administrator', 'admin', lib.hashPassword('admin123'), 'admin', '-', '', now());
      ins.run('Drs. H. Ahmad Suryana, M.Pd.', 'Kepala Sekolah', 'kepsek', lib.hashPassword('kepsek123'), 'kepala_sekolah', '196804121994031005', '081234567801', now());
      ins.run('Siti Nurhaliza, S.Psi.', 'Koordinator BK', 'bk', lib.hashPassword('bk12345'), 'guru_bk', '198503112010012003', '081234567802', now());
      ins.run('Dedi Kurniawan, S.Pd.', 'Wakasek Kesiswaan', 'kesiswaan', lib.hashPassword('kesiswaan123'), 'kesiswaan', '198711202012011004', '081234567803', now());
      ins.run('Rina Kusmiati, S.Pd.', 'Wali Kelas X TKJ 1', 'wali1', lib.hashPassword('wali123'), 'wali_kelas', '197905202006042010', '081234567804', now());
      ins.run('Agus Setiawan, S.Kom.', 'Wali Kelas XI TKJ 1', 'wali2', lib.hashPassword('wali123'), 'wali_kelas', '198901052014031002', '081234567805', now());
      ins.run('Nina Marlina, S.Pd.', 'Wali Kelas XII AKL 1', 'wali3', lib.hashPassword('wali123'), 'wali_kelas', '199003172015042001', '081234567806', now());
      ins.run('Hendra Gunawan, S.Pd.', 'Guru Mata Pelajaran', 'guru', lib.hashPassword('guru123'), 'guru', '199205232018011005', '081234567807', now());
      ins.run('Wawan Setiawan, S.Pd.', 'Guru Umum / Guru Piket', 'guruumum', lib.hashPassword('guruumum123'), 'guru_umum', '199401182019011006', '081234567808', now());
      ins.run('Lina Herlina', 'Staf Tenaga Administrasi', 'tu', lib.hashPassword('tu123456'), 'tu', '199507212020012007', '081234567809', now());
    }

    /* matriks izin bawaan — baris yang belum ada selalu dilengkapi (role/fitur baru) */
    seedPermissions();

    /* kategori poin */
    if (!db.prepare('SELECT COUNT(*) c FROM kategori').get().c) {
      const ins = db.prepare('INSERT INTO kategori(nama,jenis,poin,keterangan,aktif,urut) VALUES(?,?,?,?,1,?)');
      const pel = [
        ['Terlambat masuk sekolah', 5, 'Datang setelah bel masuk berbunyi'],
        ['Tidak memakai atribut lengkap', 5, 'Seragam, dasi, sepatu, atau kaos kaki tidak lengkap'],
        ['Membolos / keluar kelas tanpa izin', 15, 'Meninggalkan pelajaran tanpa keterangan'],
        ['Tidak mengerjakan tugas / PR', 5, 'Tugas tidak dikumpulkan tanpa alasan'],
        ['Menggunakan HP saat KBM', 10, 'Bermain ponsel selama pembelajaran'],
        ['Berkelahi', 50, 'Perkelahian fisik antar siswa'],
        ['Merokok / vaping', 40, 'Merokok di lingkungan sekolah'],
        ['Merusak sarana sekolah', 30, 'Vandalisme dan perusakan fasilitas'],
        ['Mencuri', 75, 'Mengambil barang milik orang lain'],
        ['Membuli teman', 35, 'Perundungan verbal maupun fisik']
      ];
      pel.forEach((p, i) => ins.run(p[0], 'pelanggaran', p[1], p[2], i + 1));
      const pres = [
        ['Juara 1 Lomba Akademik', 40, 'Tingkat kabupaten/provinsi/nasional'],
        ['Juara 2 Lomba Akademik', 30, 'Tingkat kabupaten/provinsi/nasional'],
        ['Juara 3 Lomba Akademik', 20, 'Tingkat kabupaten/provinsi/nasional'],
        ['Pengurus OSIS / MPK', 15, 'Aktif dalam organisasi sekolah'],
        ['Petugas Upacara / Piket Teladan', 10, 'Kedisiplinan dan tanggung jawab'],
        ['Juara Lomba Non-Akademik', 25, 'Olahraga, seni, atau keterampilan'],
        ['Membantu Kegiatan Sekolah', 10, 'Kontribusi sukarela pada kegiatan sekolah']
      ];
      pres.forEach((p, i) => ins.run(p[0], 'prestasi', p[1], p[2], i + 1));
    }

    /* kelas + siswa contoh */
    if (!db.prepare('SELECT COUNT(*) c FROM kelas').get().c) {
      const wali = (uname) => db.prepare("SELECT id FROM users WHERE username=?").get(uname);
      const ins = db.prepare('INSERT INTO kelas(nama,tingkat,jurusan,wali_id,urut,created_at) VALUES(?,?,?,?,?,?)');
      const rows = [
        ['X TKJ 1', 'X', 'Teknik Komputer & Jaringan', (wali('wali1') || {}).id, 1],
        ['X AKL 1', 'X', 'Akuntansi & Keuangan Lembaga', null, 2],
        ['XI TKJ 1', 'XI', 'Teknik Komputer & Jaringan', (wali('wali2') || {}).id, 3],
        ['XI AKL 1', 'XI', 'Akuntansi & Keuangan Lembaga', null, 4],
        ['XII TKJ 1', 'XII', 'Teknik Komputer & Jaringan', null, 5],
        ['XII AKL 1', 'XII', 'Akuntansi & Keuangan Lembaga', (wali('wali3') || {}).id, 6]
      ];
      rows.forEach(r => ins.run(r[0], r[1], r[2], r[3], r[4], now()));
    }

    /* CATATAN: data siswa, riwayat kejadian, dan catatan pembinaan contoh TIDAK lagi
       dibuat otomatis. Instalasi baru hanya berisi master data (sekolah, akun, kelas,
       kategori poin, tahun pelajaran) sehingga setiap siswa yang ditambahkan benar-benar
       bersih. Fitur "Data Contoh" sudah DIHAPUS dari aplikasi; seedDemo() hanya
       dipakai pengujian otomatis (env DEMO_SEED=1) dan id-nya dicatat di demo_rows. */

    /* modul BK & kategori poin otomatis — dijalankan SETELAH kategori bawaan dibuat
       agar instalasi baru tetap memiliki daftar kategori pelanggaran & prestasi. */
    seedFiturBaru();
  })();
}

/* =========================== KOTAK SAMPAH (TRASH) =========================== */
const TRASH_DAYS = 30;
const TRASH_TABEL = ['siswa', 'kelas', 'kejadian', 'kategori', 'tindak_lanjut', 'jurnal', 'bk_layanan'];

function trashAdd(user, tabel, row, label) {
  if (!TRASH_TABEL.includes(tabel) || !row || row.id === undefined) return null;
  const exp = isoOf(new Date(Date.now() + TRASH_DAYS * 86400000));
  const r = db.prepare(`INSERT INTO trash(tabel,ref_id,label,data,extra,oleh,oleh_nama,deleted_at,expired_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(tabel, row.id, String(label || '').slice(0, 160), JSON.stringify(row), '', user ? user.id : null,
      user ? user.nama : 'Sistem', now(), exp);
  return Number(r.lastInsertRowid);
}
function trashList() {
  trashPurge();
  return db.prepare('SELECT * FROM trash ORDER BY id DESC').all().map(r => {
    let data = {};
    try { data = JSON.parse(r.data); } catch (e) { data = {}; }
    const hari = Math.max(0, Math.ceil((new Date(String(r.expired_at) + 'T23:59:59') - Date.now()) / 86400000));
    return { ...r, data, sisa_hari: hari };
  });
}
function trashCount() {
  return db.prepare('SELECT COUNT(*) c FROM trash WHERE expired_at >= ?').get(today()).c;
}
function insertFromRow(tabel, row) {
  const cols = db.prepare(`PRAGMA table_info(${tabel})`).all().map(c => c.name);
  const keys = Object.keys(row).filter(k => cols.includes(k));
  if (!keys.length) throw new Error('Data tidak dapat dipulihkan (struktur tidak cocok).');
  const sql = `INSERT OR REPLACE INTO ${tabel}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`;
  db.prepare(sql).run(...keys.map(k => row[k]));
}
function trashRestore(id, user) {
  const r = db.prepare('SELECT * FROM trash WHERE id=?').get(id);
  if (!r) throw new Error('Data sampah tidak ditemukan.');
  const row = JSON.parse(r.data);
  if (r.tabel === 'kelas') {
    const dup = db.prepare('SELECT id FROM kelas WHERE lower(nama)=lower(?)').get(String(row.nama || ''));
    if (dup) throw new Error(`Kelas "${row.nama}" sudah ada — ubah nama kelas tersebut dulu.`);
  }
  if (r.tabel === 'siswa') {
    if (row.nisn && db.prepare('SELECT id FROM siswa WHERE nisn=?').get(row.nisn)) throw new Error('NISN siswa ini sudah dipakai siswa lain.');
    if (row.nis && db.prepare('SELECT id FROM siswa WHERE nis=?').get(row.nis)) throw new Error('NIS siswa ini sudah dipakai siswa lain.');
    if (row.kelas_id && !db.prepare('SELECT id FROM kelas WHERE id=?').get(row.kelas_id)) row.kelas_id = null;
  }
  if (r.tabel === 'kejadian' && !db.prepare('SELECT id FROM siswa WHERE id=?').get(row.siswa_id)) {
    throw new Error('Siswa pemilik kejadian ini sudah tidak ada — pulihkan siswanya terlebih dahulu.');
  }
  insertFromRow(r.tabel, row);
  db.prepare('DELETE FROM trash WHERE id=?').run(id);
  logAudit(user, 'PULIHKAN', 'sampah', `Memulihkan ${r.tabel}: ${r.label || '#' + r.ref_id}`, '');
  return { tabel: r.tabel, ref_id: r.ref_id, label: r.label };
}
function trashPurgeHabis(id, user) {
  const r = db.prepare('SELECT * FROM trash WHERE id=?').get(id);
  if (!r) return false;
  db.prepare('DELETE FROM trash WHERE id=?').run(id);
  logAudit(user, 'HAPUS PERMANEN', 'sampah', `${r.tabel}: ${r.label || '#' + r.ref_id}`, '');
  return true;
}
/** hapus permanen semua baris yang masa simpannya sudah lewat (dipanggil saat start & tiap 6 jam) */
function trashPurge() {
  const t = today();
  const rows = db.prepare('SELECT id FROM trash WHERE expired_at < ?').all(t);
  if (!rows.length) return 0;
  db.prepare('DELETE FROM trash WHERE expired_at < ?').run(t);
  return rows.length;
}

/* =========================== AUDIT DATA TERSEMBUNYI (ORPHAN) =========================== */
const ORPHAN_CHECKS = [
  { key: 'kejadian_siswa', tabel: 'kejadian', label: 'Riwayat kejadian tanpa siswa',
    sql: 'SELECT e.id, (SELECT COALESCE(kat.nama, e.judul) FROM kategori kat WHERE kat.id=e.kategori_id) AS nama FROM kejadian e WHERE NOT EXISTS (SELECT 1 FROM siswa s WHERE s.id=e.siswa_id) OR e.siswa_id IS NULL' },
  { key: 'kejadian_kategori', tabel: 'kejadian', label: 'Riwayat kejadian dengan kategori terhapus',
    sql: 'SELECT e.id, e.judul AS nama FROM kejadian e WHERE e.kategori_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kategori k WHERE k.id=e.kategori_id)' },
  { key: 'siswa_kelas', tabel: 'siswa', label: 'Siswa tanpa kelas',
    sql: 'SELECT s.id, s.nama FROM siswa s WHERE s.kelas_id IS NULL OR NOT EXISTS (SELECT 1 FROM kelas k WHERE k.id=s.kelas_id)' },
  { key: 'kelas_wali', tabel: 'kelas', label: 'Kelas dengan wali kelas terhapus',
    sql: 'SELECT k.id, k.nama FROM kelas k WHERE k.wali_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=k.wali_id)' },
  { key: 'tl_siswa', tabel: 'tindak_lanjut', label: 'Catatan pembinaan tanpa siswa',
    sql: 'SELECT tl.id, tl.jenis AS nama FROM tindak_lanjut tl WHERE NOT EXISTS (SELECT 1 FROM siswa s WHERE s.id=tl.siswa_id)' },
  { key: 'jurnal_siswa', tabel: 'jurnal', label: 'Jurnal tanpa siswa',
    sql: 'SELECT j.id, j.keterangan AS nama FROM jurnal j WHERE j.siswa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM siswa s WHERE s.id=j.siswa_id)' },
  { key: 'kejadian_ta', tabel: 'kejadian', label: 'Riwayat kejadian dengan tahun pelajaran terhapus',
    sql: 'SELECT e.id, e.judul AS nama FROM kejadian e WHERE e.ta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tahun_ajaran t WHERE t.id=e.ta_id)' },
  { key: 'siswa_ta', tabel: 'siswa', label: 'Siswa dengan tahun pelajaran terhapus',
    sql: 'SELECT s.id, s.nama FROM siswa s WHERE s.tahun_ajaran_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tahun_ajaran t WHERE t.id=s.tahun_ajaran_id)' }
];
function orphanData() {
  return ORPHAN_CHECKS.map(c => {
    let rows = [];
    try { rows = db.prepare(c.sql).all(); } catch (e) { rows = []; }
    return { key: c.key, tabel: c.tabel, label: c.label, jumlah: rows.length, rows: rows.slice(0, 200) };
  }).filter(c => c.jumlah > 0);
}
function orphanDelete(tabel, ids, user) {
  if (!ORPHAN_CHECKS.some(c => c.tabel === tabel)) throw new Error('Tabel tidak diizinkan.');
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return 0;
  let n = 0;
  db.transaction(() => {
    const del = db.prepare(`DELETE FROM ${tabel} WHERE id=?`);
    for (const id of list) n += del.run(id).changes;
  })();
  logAudit(user, 'BERSIHKAN', 'audit-data', `Menghapus ${n} baris data menggantung pada tabel ${tabel}`, '');
  return n;
}

/* =========================== BACKUP / RESTORE JSON =========================== */
const BACKUP_TABLES = [
  'settings', 'users', 'permissions', 'tahun_ajaran', 'kelas', 'siswa', 'kategori', 'kejadian',
  'tindak_lanjut', 'jurnal', 'wa_log', 'surat_log', 'audit', 'trash', 'demo_rows', 'uploads', 'feedback',
  'bk_jenis', 'bk_layanan', 'aduan', 'asesmen_instrumen', 'asesmen_soal', 'asesmen_hasil'
];
function dumpAll() {
  const out = {};
  for (const t of BACKUP_TABLES) {
    try { out[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch (e) { out[t] = []; }
  }
  return {
    app: 'tata-tertib-sekolah',
    versi: 2,
    dibuat: now(),
    jumlah: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
    tabel: out
  };
}
function snapshotFile(prefix) {
  try {
    const cur = currentPath();
    const base = !cur || cur.startsWith(':memory:') ? path.join(__dirname, 'data', 'x.sqlite') : cur;
    const dir = path.join(path.dirname(base), 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${prefix}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(dumpAll()));
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix + '-')).sort();
    while (files.length > 3) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) { /* abaikan */ } }
    return file;
  } catch (e) { return ''; }
}
/** snapshot JSON ringan (hanya baris yang dihapus) — retensi 3 berkas per prefix.
    Dipakai penghapusan massal riwayat absensi agar data masih bisa ditelusuri. */
function snapshotJson(prefix, payload) {
  try {
    const cur = currentPath();
    const base = !cur || cur.startsWith(':memory:') ? path.join(__dirname, 'data', 'x.sqlite') : cur;
    const dir = path.join(path.dirname(base), 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${prefix}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix + '-')).sort();
    while (files.length > 3) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) { /* abaikan */ } }
    return file;
  } catch (e) { return ''; }
}
function restoreAll(payload, user) {
  if (!payload || payload.app !== 'tata-tertib-sekolah' || !payload.tabel) {
    throw new Error('Berkas bukan backup aplikasi ini (penanda "app" tidak sesuai).');
  }
  const snapshot = snapshotFile('pre-restore');
  let total = 0;
  db.transaction(() => {
    for (const t of BACKUP_TABLES) {
      const rows = Array.isArray(payload.tabel[t]) ? payload.tabel[t] : [];
      if (!rows.length && !Array.isArray(payload.tabel[t])) continue;
      db.prepare(`DELETE FROM ${t}`).run();
      if (!rows.length) continue;
      for (const row of rows) { insertFromRow(t, row); total++; }
    }
  })();
  seed();
  logAudit(user, 'RESTORE', 'pengaturan', `Memulihkan database dari berkas JSON (${total} baris)`, '');
  return { total, snapshot };
}


/* =========================== RESET DATA TAHUN AJARAN =========================== */
const RESET_SCOPE = [
  { key: 'kejadian', label: 'Riwayat kejadian (pelanggaran & prestasi)' },
  { key: 'jurnal', label: 'Buku penghubung digital' },
  { key: 'tindak_lanjut', label: 'Catatan tindak lanjut / pembinaan' },
  { key: 'surat_log', label: 'Riwayat pencetakan surat' },
  { key: 'wa_log', label: 'Riwayat pesan WhatsApp' }
];
function resetPreview(taId) {
  const q = (sql, ...a) => { try { return db.prepare(sql).get(...a).c; } catch (e) { return 0; } };
  return {
    kejadian: q('SELECT COUNT(*) c FROM kejadian WHERE ta_id=?', taId),
    jurnal: q('SELECT COUNT(*) c FROM jurnal WHERE ta_id=?', taId),
    tindak_lanjut: q('SELECT COUNT(*) c FROM tindak_lanjut WHERE ta_id=?', taId),
    surat_log: q('SELECT COUNT(*) c FROM surat_log WHERE created_at LIKE ?', String(taId || '').length ? '' : ''),
    wa_log: q('SELECT COUNT(*) c FROM wa_log'),
    siswa: q("SELECT COUNT(*) c FROM siswa WHERE status='aktif'")
  };
}
function resetTa(taId, scopes, user) {
  const list = (scopes || []).filter(s => RESET_SCOPE.some(x => x.key === s));
  if (!list.length) throw new Error('Pilih minimal satu bagian data yang akan direset.');
  const snapshot = snapshotFile('pre-reset');
  let total = 0;
  db.transaction(() => {
    if (list.includes('kejadian')) total += db.prepare('DELETE FROM kejadian WHERE ta_id=?').run(taId).changes;
    if (list.includes('jurnal')) total += db.prepare('DELETE FROM jurnal WHERE ta_id=?').run(taId).changes;
    if (list.includes('tindak_lanjut')) total += db.prepare('DELETE FROM tindak_lanjut WHERE ta_id=?').run(taId).changes;
    if (list.includes('surat_log')) total += db.prepare('DELETE FROM surat_log').run().changes;
    if (list.includes('wa_log')) total += db.prepare('DELETE FROM wa_log').run().changes;
  })();
  const ta = tahunById(taId);
  logAudit(user, 'RESET', 'pengaturan',
    `Reset data tahun pelajaran ${ta ? ta.nama : taId} (${list.join(', ')}) — ${total} baris dihapus`, '');
  return { total, snapshot, scopes: list };
}

/* =========================== KALENDER KEDISIPLINAN =========================== */
function kalenderData(opts = {}) {
  const { taId, semester, bulan, kelasId, user } = opts;
  const b = /^\d{4}-\d{2}$/.test(String(bulan || '')) ? String(bulan) : today().slice(0, 7);
  const from = `${b}-01`;
  const [yy, mm] = b.split('-').map(Number);
  const to = isoOf(new Date(Date.UTC(yy, mm, 0)));
  const where = ['e.tanggal >= ?', 'e.tanggal <= ?'];
  const params = [from, to];
  if (taId) { where.push('e.ta_id = ?'); params.push(Number(taId)); }
  if (semester) { where.push('e.semester = ?'); params.push(semester); }
  if (kelasId) { where.push('s.kelas_id = ?'); params.push(Number(kelasId)); }
  const scope = scopeWali(user);
  if (scope) where.push(scope.length ? `s.kelas_id IN (${scope.join(',')})` : '1=0');
  const rows = db.prepare(`SELECT e.id, e.tanggal, e.jenis, e.poin, e.judul, e.jam, e.lokasi, e.keterangan,
      s.id AS siswa_id, s.nama AS siswa_nama, k.nama AS kelas_nama
    FROM kejadian e JOIN siswa s ON s.id=e.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.tanggal, e.jam, e.id`).all(...params);
  const days = {};
  for (const r of rows) {
    const d = String(r.tanggal).slice(0, 10);
    const o = days[d] || (days[d] = { tanggal: d, pel: 0, pres: 0, poinPel: 0, poinPres: 0, jml: 0, items: [] });
    if (r.jenis === 'prestasi') { o.pres++; o.poinPres += r.poin; } else { o.pel++; o.poinPel += r.poin; }
    o.jml++;
    if (o.items.length < 40) o.items.push(r);
  }
  return {
    bulan: b, dari: from, sampai: to, days,
    ringkas: {
      hari: Object.keys(days).length,
      pelanggaran: rows.filter(r => r.jenis !== 'prestasi').length,
      prestasi: rows.filter(r => r.jenis === 'prestasi').length,
      poin: rows.reduce((a, r) => a + (r.jenis === 'prestasi' ? 0 : r.poin), 0)
    },
    maxPel: Math.max(0, ...Object.values(days).map(d => d.pel))
  };
}

/* ============ DATA CONTOH — hanya untuk pengujian (DEMO_SEED) ============
   Tidak ada lagi menu/tombol/endpoint "Data Contoh" di aplikasi. */
function demoStats() {
  const count = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE EXISTS (SELECT 1 FROM demo_rows d WHERE d.tabel=? AND d.row_id=${t}.id)`).get(t).c; } catch (e) { return 0; } };
  return { siswa: count('siswa'), kejadian: count('kejadian'), jurnal: count('jurnal'), tindak_lanjut: count('tindak_lanjut') };
}
function seedDemo(user) {
  const ta = tahunAktif();
  const kelas = db.prepare('SELECT * FROM kelas ORDER BY id').all();
  if (!kelas.length) throw new Error('Tambahkan kelas terlebih dahulu sebelum memuat data contoh.');
  const names = ['Ahmad Fauzan', 'Nabila Putri', 'Rizky Ramadhan', 'Siti Aminah', 'Dimas Prakoso',
    'Ayu Lestari', 'Bagas Saputra', 'Cindy Maharani', 'Dewi Anggraeni', 'Eko Prasetyo',
    'Fajar Nugraha', 'Gita Permata', 'Hadi Wijaya', 'Indah Permatasari', 'Joko Susilo',
    'Kartika Sari', 'Lukman Hakim', 'Maya Sari', 'Nanda Pratama', 'Oki Setiana',
    'Putra Mahendra', 'Qori Amalia', 'Rafi Ardiansyah', 'Salsa Bila', 'Taufik Hidayat',
    'Umi Kalsum', 'Vina Oktaviani', 'Wahyu Saputra', 'Yuni Astuti', 'Zaki Mubarok'];
  const pel = db.prepare("SELECT * FROM kategori WHERE jenis='pelanggaran' ORDER BY id").all();
  const pre = db.prepare("SELECT * FROM kategori WHERE jenis='prestasi' ORDER BY id").all();
  const insS = db.prepare(`INSERT INTO siswa(nama,nis,nisn,kelas_id,gender,tanggal_lahir,parent_phone,status,tahun_ajaran_id,created_at)
    VALUES(?,?,?,?,?,?,?,'aktif',?,?)`);
  const insK = db.prepare(`INSERT INTO kejadian(siswa_id,kategori_id,judul,jenis,poin,tanggal,keterangan,bukti_url,ta_id,semester,oleh,oleh_nama,created_at,jam,lokasi)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insD = db.prepare('INSERT OR IGNORE INTO demo_rows(tabel,row_id,created_at) VALUES(?,?,?)');
  const jamPola = ['07:05', '07:15', '09:40', '09:50', '12:35'];
  const lokPola = ['Gerbang Sekolah', 'Gerbang Sekolah', 'Ruang Kelas', 'Kantin', 'Halaman Sekolah'];
  let nSiswa = 0, nKej = 0;
  db.transaction(() => {
    let n = 0;
    kelas.forEach((k, ki) => {
      for (let i = 0; i < 5; i++) {
        const nama = names[(n++) % names.length];
        const r = insS.run(nama, `DEMO${String(1000 + n)}`, `DEMO${String(70000 + n)}`, k.id, i % 2 ? 'P' : 'L',
          `20${String(7 + (ki % 3)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}-${String(10 + i).padStart(2, '0')}`,
          `0812345${String(6000 + n)}`, ta ? ta.id : null, now());
        insD.run('siswa', Number(r.lastInsertRowid), now());
        nSiswa++;
      }
    });
    const siswa = db.prepare('SELECT id FROM siswa ORDER BY id DESC LIMIT ?').all(nSiswa);
    siswa.forEach((s, i) => {
      const nPel = i % 7 === 0 ? 5 : (i % 5 === 0 ? 3 : (i % 3 === 0 ? 2 : 1));
      for (let j = 0; j < nPel; j++) {
        const k = pel[(i * 3 + j) % (pel.length || 1)];
        if (!k) continue;
        const r = insK.run(s.id, k.id, k.nama, 'pelanggaran', k.poin, isoOf(new Date(Date.now() - ((i * 3 + j * 7) % 40) * 86400000)),
          k.keterangan || '', '', ta ? ta.id : null, 'ganjil', 1, 'Data Contoh', now(),
          jamPola[(i + j) % jamPola.length], lokPola[(i + j) % lokPola.length]);
        insD.run('kejadian', Number(r.lastInsertRowid), now());
        nKej++;
      }
      if (i % 3 === 0 && pre.length) {
        const k = pre[i % pre.length];
        const r = insK.run(s.id, k.id, k.nama, 'prestasi', k.poin, isoOf(new Date(Date.now() - (i % 20) * 86400000)),
          'Diraih pada kegiatan sekolah', '', ta ? ta.id : null, 'ganjil', 1, 'Data Contoh', now(), '10:00', 'Ruang Kelas');
        insD.run('kejadian', Number(r.lastInsertRowid), now());
        nKej++;
      }
    });
  })();
  logAudit(user, 'TAMBAH', 'demo', `Memuat data contoh: ${nSiswa} siswa, ${nKej} kejadian`, '');
  return { siswa: nSiswa, kejadian: nKej };
}
seed();
trashPurge();

/* Backfill sekali setelah seed: kelas lama (tanpa TA) diikutkan ke TA aktif &
   riwayat penempatan siswa diisi agar kenaikan kelas berikutnya akurat. */
(function backfillKelasTa() {
  try {
    const ta = db.prepare('SELECT id FROM tahun_ajaran WHERE aktif=1 ORDER BY id DESC LIMIT 1').get()
      || db.prepare('SELECT id FROM tahun_ajaran ORDER BY id DESC LIMIT 1').get();
    if (!ta) return;
    db.prepare('UPDATE kelas SET tahun_ajaran_id=? WHERE tahun_ajaran_id IS NULL').run(ta.id);
    db.exec(`INSERT OR IGNORE INTO siswa_kelas(siswa_id,kelas_id,ta_id)
      SELECT s.id, s.kelas_id, s.tahun_ajaran_id FROM siswa s
      WHERE s.kelas_id IS NOT NULL AND s.tahun_ajaran_id IS NOT NULL`);
  } catch (e) { /* migrasi best-effort — jangan gagalkan boot */ }
})();

/* =====================================================================
   SESI LOGIN PERSISTEN (anti auto-logout)
   ---------------------------------------------------------------------
   Sesi disimpan di tabel `sesi` (bukan hanya memori proses) sehingga
   pengguna TETAP masuk walau server restart / aplikasi dipublikasikan
   ulang. Masa berlaku sliding: setiap aktivitas memperpanjang masa sesi
   (`session_days`, default 90 hari).
   ===================================================================== */
function sessionSave(sid, userId, opts = {}) {
  if (!sid || !userId) return null;
  const days = Math.max(1, Math.min(365, Number(opts.days) || Number(getSetting('session_days', 90)) || 90));
  const t = now();
  const exp = lib.plusDaysStamp(days);
  const user = userById(userId);
  db.prepare(`INSERT INTO sesi (sid,user_id,created_at,last_seen,expires_at,user_agent,role)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(sid) DO UPDATE SET user_id=excluded.user_id, last_seen=excluded.last_seen,
      expires_at=excluded.expires_at, user_agent=excluded.user_agent, role=excluded.role`)
    .run(String(sid), Number(userId), t, t, exp, String(opts.ua || '').slice(0, 200), user ? user.role : '');
  return { expires_at: exp, days };
}
/** baca sesi + perpanjang otomatis (sliding). null bila tidak valid/kedaluwarsa. */
function sessionGet(sid, opts = {}) {
  if (!sid) return null;
  let row = null;
  try { row = db.prepare('SELECT * FROM sesi WHERE sid=?').get(String(sid)); } catch (e) { return null; }
  if (!row) return null;
  const exp = String(row.expires_at || '').trim();
  if (!exp || exp < now()) {
    try { db.prepare('DELETE FROM sesi WHERE sid=?').run(String(sid)); } catch (e) { }
    return null;
  }
  const days = Math.max(1, Math.min(365, Number(opts.days) || Number(getSetting('session_days', 90)) || 90));
  const nextExp = lib.plusDaysStamp(days);
  try {
    db.prepare('UPDATE sesi SET last_seen=?, expires_at=? WHERE sid=?').run(now(), nextExp, String(sid));
    row.expires_at = nextExp;
  } catch (e) { }
  return row;
}
function sessionDelete(sid) {
  if (!sid) return;
  try { db.prepare('DELETE FROM sesi WHERE sid=?').run(String(sid)); } catch (e) { }
}
function sessionPurge() {
  try {
    return db.prepare("DELETE FROM sesi WHERE COALESCE(expires_at,'')<>? AND expires_at<?").run('', now()).changes || 0;
  }
  catch (e) { return 0; }
}
function sessionList() {
  try { return db.prepare('SELECT s.*, u.nama FROM sesi s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.last_seen DESC').all(); }
  catch (e) { return []; }
}

/* =====================================================================
   MANAJEMEN BERKAS TERUNGGAH (media manager)
   ===================================================================== */
function uploadAdd(row = {}) {
  const info = db.prepare(`INSERT INTO uploads (filename,url,mime,ukuran,jenis,ref_tabel,ref_id,oleh,oleh_nama,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    String(row.filename || 'berkas').slice(0, 200), String(row.url || '').slice(0, 2000),
    String(row.mime || ''), Math.max(0, Number(row.ukuran) || 0),
    String(row.jenis || 'bukti').slice(0, 30),
    row.ref_tabel ? String(row.ref_tabel).slice(0, 40) : null,
    row.ref_id ? Number(row.ref_id) : null,
    row.oleh ? Number(row.oleh) : null, String(row.oleh_nama || '').slice(0, 120), now());
  return Number(info.lastInsertRowid);
}
function uploadList(opts = {}) {
  const where = ['1=1'];
  const args = [];
  if (opts.jenis) { where.push('jenis=?'); args.push(String(opts.jenis)); }
  const q = String(opts.q || '').trim().toLowerCase();
  if (q) {
    where.push("(lower(filename) LIKE ? OR lower(COALESCE(oleh_nama,'')) LIKE ?)");
    args.push('%' + q + '%', '%' + q + '%');
  }
  return db.prepare(`SELECT * FROM uploads WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${Number(opts.limit) || 500}`).all(...args);
}
function uploadById(id) { return db.prepare('SELECT * FROM uploads WHERE id=?').get(Number(id)); }
/**
 * Hapus catatan berkas. Bila nama berkas dipakai pada kejadian/bukti lain,
 * rujukannya dikosongkan agar tidak ada tautan mati.
 */
function uploadDelete(ids) {
  const list = [].concat(ids || []).map(Number).filter(Boolean);
  if (!list.length) return { dihapus: 0, dibebaskan: 0 };
  let dihapus = 0, dibebaskan = 0;
  db.transaction(() => {
    for (const id of list) {
      const row = uploadById(id);
      if (!row) continue;
      dibebaskan += Number(row.ukuran || 0);
      // kosongkan rujukan pada data yang memakainya
      try {
        if (row.ref_tabel === 'kejadian' && row.ref_id) {
          db.prepare("UPDATE kejadian SET bukti_url='' WHERE id=? AND bukti_url=?").run(Number(row.ref_id), row.url);
        }
      } catch (e) { }
      try { db.prepare("UPDATE kejadian SET bukti_url='' WHERE bukti_url=?").run(String(row.url)); } catch (e) { }
      try { db.prepare('DELETE FROM uploads WHERE id=?').run(id); } catch (e) { }
      dihapus++;
    }
  })();
  return { dihapus, dibebaskan };
}
/** ringkasan pemakaian penyimpanan: berkas terunggah + database aplikasi */
function storageInfo() {
  const up = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(ukuran),0) b FROM uploads').get() || { c: 0, b: 0 };
  let dbBytes = 0;
  try {
    const cur = currentPath();
    const p = !cur || cur === ':memory:' || cur.startsWith(':memory:') ? '' : cur;
    if (p && fs.existsSync(p)) dbBytes = fs.statSync(p).size;
    for (const ext of ['-wal', '-shm']) {
      const f = p + ext;
      if (p && fs.existsSync(f)) dbBytes += fs.statSync(f).size;
    }
  } catch (e) { }
  const quotaMb = Math.max(50, Number(getSetting('storage_quota_mb', 5120)) || 5120);
  const used = Number(up.b || 0) + dbBytes;
  return {
    file_count: Number(up.c || 0),
    files_bytes: Number(up.b || 0),
    db_bytes: dbBytes,
    used_bytes: used,
    quota_bytes: quotaMb * 1024 * 1024,
    quota_mb: quotaMb,
    sisa_bytes: Math.max(0, quotaMb * 1024 * 1024 - used),
    max_upload_kb: Math.max(64, Number(getSetting('upload_max_kb', 2048)) || 2048)
  };
}

/* =====================================================================
   AKADEMIK — JADWAL PELAJARAN & ABSENSI (guru mapel + siswa per mapel)
   ===================================================================== */
const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DEFAULT_HARI = [1, 2, 3, 4, 5, 6];
const DEFAULT_SESI = [
  { label: 'Jam ke-1', mulai: '07:00', selesai: '07:45', istirahat: 0 },
  { label: 'Jam ke-2', mulai: '07:45', selesai: '08:30', istirahat: 0 },
  { label: 'Istirahat', mulai: '08:30', selesai: '08:45', istirahat: 1 },
  { label: 'Jam ke-3', mulai: '08:45', selesai: '09:30', istirahat: 0 },
  { label: 'Jam ke-4', mulai: '09:30', selesai: '10:15', istirahat: 0 },
  { label: 'Istirahat', mulai: '10:15', selesai: '10:30', istirahat: 1 },
  { label: 'Jam ke-5', mulai: '10:30', selesai: '11:15', istirahat: 0 },
  { label: 'Jam ke-6', mulai: '11:15', selesai: '12:00', istirahat: 0 },
  { label: 'ISHOMA', mulai: '12:00', selesai: '12:45', istirahat: 1 },
  { label: 'Jam ke-7', mulai: '12:45', selesai: '13:30', istirahat: 0 },
  { label: 'Jam ke-8', mulai: '13:30', selesai: '14:15', istirahat: 0 }
];
const JAM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** status kehadiran siswa per mata pelajaran (H/S/I/A/B) */
const ABSENSI_SISWA_STATUS = [
  { key: 'H', label: 'Hadir', ket: 'Hadir', tone: 'hadir' },
  { key: 'S', label: 'Sakit', ket: 'Sakit', tone: 'sakit' },
  { key: 'I', label: 'Izin', ket: 'Izin', tone: 'izin' },
  { key: 'A', label: 'Alpha', ket: 'Tanpa keterangan', tone: 'alpha' },
  { key: 'B', label: 'Bolos', ket: 'Bolos / keluar kelas', tone: 'bolos' }
];
const ABSENSI_GURU_STATUS = [
  { key: 'hadir', label: 'Hadir' },
  { key: 'izin', label: 'Izin' },
  { key: 'sakit', label: 'Sakit' },
  { key: 'alpha', label: 'Alpha / Belum Absen' }
];
const jamMenit = (v) => {
  const m = JAM_RE.exec(String(v || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const menitJam = (n) => {
  const v = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(n) || 0)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
/** jam sekarang (menit sejak 00:00) menurut zona waktu aplikasi (WIB) */
function nowMenit() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
/** hari (0=Minggu … 6=Sabtu) dari tanggal ISO YYYY-MM-DD */
function hariOf(tanggal) {
  const d = String(tanggal || today()).slice(0, 10);
  const dt = new Date(d + 'T12:00:00');
  return Number.isNaN(dt.getTime()) ? new Date().getDay() : dt.getDay();
}
function tanggalPanjang(tanggal) {
  const d = String(tanggal || today()).slice(0, 10);
  const dt = new Date(d + 'T12:00:00');
  if (Number.isNaN(dt.getTime())) return d;
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${HARI_LABEL[dt.getDay()]}, ${dt.getDate()} ${bulan[dt.getMonth()]} ${dt.getFullYear()}`;
}
/** normalisasi daftar sesi jam pelajaran (termasuk istirahat) */
function normSesi(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const s of arr.slice(0, 40)) {
    const mulai = String((s && s.mulai) || '');
    const selesai = String((s && s.selesai) || '');
    if (!JAM_RE.test(mulai) || !JAM_RE.test(selesai)) continue;
    if (jamMenit(selesai) <= jamMenit(mulai)) continue;
    out.push({
      label: String((s && s.label) || (s && s.istirahat ? 'Istirahat' : 'Jam')).slice(0, 30),
      mulai, selesai, istirahat: s && (s.istirahat === 1 || s.istirahat === true || s.istirahat === '1') ? 1 : 0
    });
  }
  return out.length ? out : DEFAULT_SESI.map(s => ({ ...s }));
}
/** lengkapi nomor urut sesi (idx = posisi, no = urutan jam pelajaran) */
function sesiBernomor(list) {
  let no = 0;
  return (Array.isArray(list) ? list : []).map((s, i) => {
    if (!s.istirahat) no++;
    return { ...s, idx: i + 1, no: s.istirahat ? 0 : no };
  });
}
/**
 * Pengaturan sesi JAM PELAJARAN PER HARI (opsional).
 * Contoh: Senin jam pertama berupa "Upacara" 07:00–07:45, hari lain "Jam ke-1".
 * Nilai kosong / hari tanpa entri = mengikuti pengaturan umum (`jadwal_sesi`).
 */
function sesiHariMap() {
  const raw = jsonSetting('jadwal_sesi_hari', null);
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const h = Number(k);
    if (!Number.isInteger(h) || h < 0 || h > 6) continue;
    if (!Array.isArray(v) || !v.length) continue;
    const list = normSesi(v);
    if (!list.length) continue;
    out[h] = sesiBernomor(list);
  }
  return out;
}
/** daftar sesi untuk satu hari (fallback: pengaturan umum) */
function sesiOfHari(cfg, hari) {
  const c = cfg || jadwalConfig();
  const h = Number(hari);
  return (c.sesiHari && c.sesiHari[h]) || c.sesi || [];
}
/**
 * Desain cetak jadwal pelajaran (judul, semester, tahun pelajaran, blok tanda tangan).
 * Nilai kosong otomatis memakai identitas sekolah / tahun pelajaran aktif.
 */
function jadwalDesain() {
  const st = allSettings();
  const ta = tahunById(Number(getSetting('ta_aktif', 0)) || 0) || tahunAktif() || {};
  const bulanID = lib.BULAN || ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const hariIni = new Date(String(today()) + 'T00:00:00');
  return {
    judul: String(st.jadwal_judul || '').trim() || 'JADWAL PELAJARAN',
    semester: String(st.jadwal_semester || '').trim(),
    ta_teks: String(st.jadwal_ta_teks || '').trim() || (ta && ta.nama ? `Tahun Pelajaran ${ta.nama}` : ''),
    tempat: String(st.jadwal_ttd_tempat || '').trim() || String(st.print_tempat || '').trim(),
    tanggal: String(st.jadwal_ttd_tanggal || '').trim() || `${bulanID[hariIni.getMonth()]} ${hariIni.getFullYear()}`,
    pengawas_tampil: String(st.jadwal_pengawas_tampil === undefined ? '1' : st.jadwal_pengawas_tampil) !== '0',
    pengawas_nama: String(st.jadwal_pengawas_nama || '').trim(),
    pengawas_nip: String(st.jadwal_pengawas_nip || '').trim(),
    kepala_nama: String(st.jadwal_kepala_nama || '').trim() || String(st.kepala_nama || '').trim(),
    kepala_nip: String(st.jadwal_kepala_nip || '').trim() || String(st.kepala_nip || '').trim(),
    wakasek_nama: String(st.jadwal_wakasek_nama || '').trim() || String(st.wakasek_nama || '').trim(),
    wakasek_nip: String(st.jadwal_wakasek_nip || '').trim() || String(st.wakasek_nip || '').trim(),
    wakasek_jabatan: String(st.jadwal_wakasek_jabatan || '').trim() || 'Wakasek Kurikulum'
  };
}

/* =====================================================================
   TAMPILAN ISI SEL TABEL JADWAL (berlaku untuk cetak PDF & ekspor Excel)
   ---------------------------------------------------------------------
   Sekolah dapat memilih apa saja yang ditulis di dalam sel jadwal:
   kode mapel, nama mapel, nama guru, ruang, dan keterangan gabungan kelas.
   Lebar kolom JAM (px) & ukuran font tabel juga dapat diatur supaya tulisan
   jam (07:15–08:00) tidak terlipat ke bawah.
   ===================================================================== */
const JADWAL_TAMPIL_DEFAULT = { kode: 1, nama: 1, guru: 1, ruang: 0, gabungan: 1, kolomJam: 72, kolomFont: 7.4 };
function jadwalTampil() {
  const raw = jsonSetting('jadwal_tampil', null) || {};
  const on = (v, def) => (v === undefined || v === null || v === '' ? def
    : (v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true' ? 1 : 0));
  const angka = (v, a, b, def) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.max(a, Math.min(b, n)) : def;
  };
  const d = JADWAL_TAMPIL_DEFAULT;
  return {
    kode: on(raw.kode, d.kode), nama: on(raw.nama, d.nama), guru: on(raw.guru, d.guru),
    ruang: on(raw.ruang, d.ruang), gabungan: on(raw.gabungan, d.gabungan),
    kolomJam: Math.round(angka(raw.kolomJam, 40, 200, d.kolomJam)),
    kolomFont: Math.round(angka(raw.kolomFont, 6, 12, d.kolomFont) * 10) / 10
  };
}

/** konfigurasi jadwal aktif (hari, sesi, batas jam, token publik) */
function jadwalConfig() {  const rawSesi = jsonSetting('jadwal_sesi', null);
  const sesi = normSesi(Array.isArray(rawSesi) && rawSesi.length ? rawSesi : DEFAULT_SESI);
  const sesiRows = sesiBernomor(sesi);
  const sesiHari = sesiHariMap();
  const rawHari = jsonSetting('jadwal_hari', null);
  const hari = (Array.isArray(rawHari) && rawHari.length ? rawHari : DEFAULT_HARI)
    .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  const clamp = (v, a, b, def) => Math.max(a, Math.min(b, Number(v) || def));
  return {
    sesi: sesiRows,
    sesiHari,
    hari: hari.length ? [...new Set(hari)] : DEFAULT_HARI.slice(),
    maxJam: clamp(getSetting('jadwal_max_jam', 8), 1, 15, 8),
    maxMapelJam: clamp(getSetting('jadwal_max_mapel_jam', 2), 1, 12, 2),
    maxGuruJam: clamp(getSetting('jadwal_max_guru_jam', 8), 1, 15, 8),
    publik: {
      token: String(getSetting('jadwal_publik_token', '') || ''),
      aktif: String(getSetting('jadwal_publik_aktif', '0')) === '1'
    },
    bukaMenit: clamp(getSetting('absensi_buka_menit', 15), 0, 240, 15),
    tutupMenit: clamp(getSetting('absensi_tutup_menit', 15), 0, 240, 15),
    /* PENGUNCIAN WAKTU (time-locking): setelah jam pelajaran SELESAI + toleransi
       ini, SELURUH aksi absensi (check-in, presensi siswa, jurnal, edit, tukar
       jadwal) terkunci — di UI maupun di server. Default 0 = terkunci tepat
       pada jam selesai. */
    toleransiTutup: clamp(getSetting('absensi_toleransi_tutup', 0), 0, 60, 0),
    jurnalMin: clamp(getSetting('absensi_jurnal_min', 15), 0, 500, 15),
    fotoWajib: String(getSetting('absensi_foto_wajib', '1')) === '1',
    fotoHari: clamp(getSetting('absensi_foto_hari', 90), 1, 3650, 90),
    siswaAktif: String(getSetting('absensi_siswa_aktif', '1')) === '1',
    siswaTutupMenit: clamp(getSetting('absensi_siswa_tutup_menit', 120), 0, 720, 120),
    autoAlpha: String(getSetting('absensi_auto_alpha', '1')) === '1',
    waAktif: String(getSetting('absensi_wa_aktif', '0')) === '1',
    waJam: JAM_RE.test(String(getSetting('absensi_wa_jam', '14:00'))) ? String(getSetting('absensi_wa_jam', '14:00')) : '14:00',
    waTerakhir: String(getSetting('absensi_wa_terakhir', '') || ''),
    kepsekWa: String(getSetting('kepsek_wa', '') || ''),
    wakasekWa: String(getSetting('wakasek_kur_wa', '') || '')
  };
}
/* =====================================================================
   TARGET JAM PELAJARAN PER KELAS (validasi kurikulum)
   ---------------------------------------------------------------------
   Standar jumlah JAM PELAJARAN per PEKAN ditentukan global (default 40 jam),
   dan boleh DITIMPA per kelas lewat `kelas.target_jam` (0/kosong = ikut global).
   Jumlah jam terpasang dihitung dari slot jadwal pada tahun pelajaran aktif;
   slot gabungan (merge) dihitung untuk SETIAP kelas yang memakainya.
   ===================================================================== */
function targetJamConfig() {
  return {
    aktif: String(getSetting('target_jam_aktif', '1')) !== '0',
    minggu: Math.max(1, Math.min(80, Number(getSetting('target_jam_minggu', 40)) || 40))
  };
}
/** target jam satu kelas (pakai target_jam kelas bila diisi) */
function kelasTargetJam(kelasRow, cfg) {
  const c = cfg || targetJamConfig();
  const khusus = Number((kelasRow || {}).target_jam) || 0;
  return {
    target: khusus > 0 ? Math.max(1, Math.min(80, khusus)) : c.minggu,
    khusus: khusus > 0,
    aktif: c.aktif
  };
}
/** jumlah jam (slot) terpasang per kelas pada satu tahun pelajaran */
function bebanKelas(taId) {
  const map = new Map();
  for (const r of jadwalRows(taId)) {
    for (const id of r.kelas_ids) map.set(Number(id), (map.get(Number(id)) || 0) + 1);
  }
  return map;
}
/** status target jam seluruh kelas (dipakai badge peringatan di matriks jadwal) */
function targetKelasRows(taId) {
  const cfg = targetJamConfig();
  const beban = bebanKelas(taId);
  const list = kelasList(taId).length ? kelasList(taId) : kelasAll();
  return list.map(k => {
    const t = kelasTargetJam(k, cfg);
    const terisi = beban.get(Number(k.id)) || 0;
    const selisih = terisi - t.target;
    const status = !t.aktif ? 'nonaktif' : selisih === 0 ? 'pas' : selisih < 0 ? 'kurang' : 'lebih';
    return {
      id: Number(k.id), nama: k.nama, tingkat: k.tingkat || '', target_jam: Number(k.target_jam) || 0,
      target: t.target, khusus: t.khusus, terisi, selisih, status, aktif: t.aktif
    };
  });
}

/* =====================================================================
   PEMETAAN BATAS JAM MENGAJAR GURU (target per minggu & per bulan)
   ---------------------------------------------------------------------
   Jam terpasang = jumlah slot jadwal yang guru tersebut ampu pada TA aktif
   (satu slot = satu jam pelajaran per pekan). Jam per bulan diperkirakan dari
   jumlah PEKAN EFEKTIF bulan berjalan (hari sekolah aktif dibagi hari efektif
   per pekan) — memakai kalender akademik sehingga libur/ujian ikut dihitung.
   ===================================================================== */
function guruTargetMap() {
  const out = new Map();
  for (const r of db.prepare('SELECT * FROM guru_jam_target').all()) out.set(Number(r.guru_id), r);
  return out;
}
/** jumlah hari efektif (hari sekolah yang tidak libur) pada satu bulan YYYY-MM */
function hariEfektifBulan(bulan, opts = {}) {
  const cfg = opts.cfg || jadwalConfig();
  const m = /^(\d{4})-(\d{2})$/.exec(String(bulan || ''));
  if (!m) return { bulan: String(bulan || ''), hari: 0, pekan: 0, libur: 0 };
  const taId = opts.taId !== undefined ? Number(opts.taId) : 0;
  const y = Number(m[1]), mo = Number(m[2]);
  const jml = new Date(y, mo, 0).getDate();
  const kal = kalenderMap(taId, `${m[1]}-${m[2]}-01`, `${m[1]}-${m[2]}-${String(jml).padStart(2, '0')}`);
  let hari = 0, libur = 0;
  for (let d = 1; d <= jml; d++) {
    const tgl = `${m[1]}-${m[2]}-${String(d).padStart(2, '0')}`;
    const dow = hariOf(tgl);
    if (!cfg.hari.includes(dow)) continue;                  // bukan hari sekolah
    const k = kal.get(tgl);
    if (k && Number(k.nonaktif) === 1) { libur++; continue; } // libur / ujian / kegiatan non-KBM
    hari++;
  }
  const perPekan = Math.max(1, cfg.hari.length);
  return { bulan, hari, libur, pekan: Math.round((hari / perPekan) * 10) / 10 };
}
/** rekap beban mengajar + target per guru */
function guruTargetRows(taId, opts = {}) {
  const rows = jadwalRows(taId);
  const beban = new Map();
  const mapelOf = new Map();
  for (const r of rows) {
    const gid = Number(r.guru_id) || 0;
    if (!gid) continue;
    beban.set(gid, (beban.get(gid) || 0) + 1);
    const arr = mapelOf.get(gid) || new Set();
    if (r.mapel_nama) arr.add(r.mapel_nama);
    mapelOf.set(gid, arr);
  }
  const targets = guruTargetMap();
  const bulan = opts.bulan || String(today()).slice(0, 7);
  const ef = hariEfektifBulan(bulan, { taId });
  const users = db.prepare(`SELECT id,nama,nip,jabatan,role,roles,aktif FROM users WHERE aktif=1 ORDER BY nama`).all();
  const out = users.map(u => {
    const t = targets.get(Number(u.id)) || {};
    const jamMinggu = beban.get(Number(u.id)) || 0;
    const targetMinggu = Number(t.target_minggu) || 0;
    const targetBulan = Number(t.target_bulan) || 0;
    const jamBulan = Math.round(jamMinggu * ef.pekan * 10) / 10;
    const selisih = targetMinggu > 0 ? jamMinggu - targetMinggu : 0;
    return {
      guru_id: Number(u.id), nama: u.nama, nip: u.nip || '', jabatan: u.jabatan || '',
      role_label: roleLabelOf(u),
      mapel: [...(mapelOf.get(Number(u.id)) || [])],
      jam_minggu: jamMinggu, jam_bulan: jamBulan,
      target_minggu: targetMinggu, target_bulan: targetBulan,
      selisih, catatan: t.catatan || '',
      status: !targetMinggu ? 'belum' : selisih === 0 ? 'pas' : selisih < 0 ? 'kurang' : 'lebih',
      punya_target: targetMinggu > 0
    };
  });
  /* urutkan: yang punya target lebih dulu, lalu jam terbanyak */
  out.sort((a, b) => (Number(b.punya_target) - Number(a.punya_target)) || (b.jam_minggu - a.jam_minggu)
    || String(a.nama).localeCompare(String(b.nama)));
  const ringkas = {
    guru: out.length, ada_target: out.filter(g => g.punya_target).length,
    kurang: out.filter(g => g.status === 'kurang').length,
    lebih: out.filter(g => g.status === 'lebih').length,
    pas: out.filter(g => g.status === 'pas').length,
    belum: out.filter(g => g.status === 'belum').length,
    total_jam: [...beban.values()].reduce((a, n) => a + n, 0),
    bulan, hari_efektif: ef.hari, pekan_efektif: ef.pekan
  };
  return { rows: out, ringkas, bulan, efektif: ef };
}
/** simpan target jam guru (satu per satu; target_bulan 0 = otomatis dari pekan efektif) */
function guruTargetSave(guruId, data = {}, user) {
  const gid = Number(guruId) || 0;
  if (!gid) throw new Error('Guru tidak dipilih.');
  const minggu = Math.max(0, Math.min(80, Math.round(Number(data.target_minggu) || 0)));
  const bulan = Math.max(0, Math.min(400, Math.round(Number(data.target_bulan) || 0)));
  const catatan = String(data.catatan === undefined ? '' : data.catatan).trim().slice(0, 240);
  const ada = db.prepare('SELECT id FROM guru_jam_target WHERE guru_id=?').get(gid);
  if (ada) {
    db.prepare('UPDATE guru_jam_target SET target_minggu=?,target_bulan=?,catatan=?,oleh=?,oleh_nama=?,updated_at=? WHERE guru_id=?')
      .run(minggu, bulan, catatan, user ? user.id : null, user ? user.nama : '', now(), gid);
  } else {
    db.prepare(`INSERT INTO guru_jam_target(guru_id,target_minggu,target_bulan,catatan,oleh,oleh_nama,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(gid, minggu, bulan, catatan, user ? user.id : null, user ? user.nama : '', now(), now());
  }
  return { guru_id: gid, target_minggu: minggu, target_bulan: bulan, catatan };
}

/* =====================================================================
   AI TIMETABLE GENERATOR — konfigurasi, beban mengajar, batasan guru, ruang
   ---------------------------------------------------------------------
   Dipakai halaman "AI Timetable Generator" (tab pada menu Jadwal Pelajaran)
   dan modul `timetable.js`. Semua fungsi di bawah idempoten & aman dipanggil
   pada DB sekolah lama (kolom/tabel dibuat oleh runMigrations()).
   ===================================================================== */
const JADWAL_AI_ATURAN_DEFAULT = {
  hindari_jam_kosong: 1,      /* jangan tinggalkan lubang jam kosong bagi guru */
  sebar_mapel_berat: 1,       /* mapel berat (jam banyak) di awal pekan */
  sebar_mapel_harian: 1,      /* mapel sama tidak berurutan / dobel dalam sehari */
  hormati_ruang: 1,           /* satu ruang/lab tidak dipakai dua kelas */
  hormati_batas_guru: 1       /* batas jam guru per hari & per pekan dipatuhi */
};

/** konfigurasi generator tersimpan (aturan centang, mode, pilihan kelas, seed) */
function jadwalAiConfig() {
  const raw = jsonSetting('jadwal_ai_cfg', null) || {};
  const at = (raw && typeof raw.aturan === 'object' && raw.aturan) || {};
  const on = (v, def) => (v === undefined || v === null || v === '' ? def
    : (v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true' ? 1 : 0));
  const aturan = {};
  for (const [k, v] of Object.entries(JADWAL_AI_ATURAN_DEFAULT)) aturan[k] = on(at[k], v);
  aturan.hormati_ruang = 1;
  const kelasIds = Array.isArray(raw.kelas_ids) ? raw.kelas_ids.map(Number).filter(Boolean) : [];
  const seed = Number(raw.seed);
  return {
    aturan,
    mode: String(raw.mode) === 'ganti' ? 'ganti' : 'tambah',
    kelas_ids: [...new Set(kelasIds)],
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : 0,
    diperbarui: String(raw.diperbarui || '')
  };
}

/** simpan konfigurasi generator (hanya kunci yang dikirim yang diubah) */
function jadwalAiConfigSave(patch = {}) {
  const lama = jadwalAiConfig();
  const at = { ...lama.aturan, ...((patch.aturan && typeof patch.aturan === 'object') ? patch.aturan : {}) };
  const on = (v, def) => (v === undefined || v === null || v === '' ? def
    : (v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true' ? 1 : 0));
  const aturan = {};
  for (const [k, v] of Object.entries(JADWAL_AI_ATURAN_DEFAULT)) aturan[k] = on(at[k], lama.aturan[k]);
  aturan.hormati_ruang = 1;
  const kelasIds = patch.kelas_ids === undefined ? lama.kelas_ids
    : (Array.isArray(patch.kelas_ids) ? patch.kelas_ids.map(Number).filter(Boolean) : []);
  const seed = patch.seed === undefined ? lama.seed : (Number(patch.seed) > 0 ? Math.floor(Number(patch.seed)) : 0);
  const out = {
    aturan,
    mode: patch.mode === undefined ? lama.mode : (String(patch.mode) === 'ganti' ? 'ganti' : 'tambah'),
    kelas_ids: [...new Set(kelasIds)],
    seed,
    diperbarui: now()
  };
  setSetting('jadwal_ai_cfg', JSON.stringify(out));
  return out;
}

/** jumlah slot terpasang per (kelas, mapel) pada satu tahun pelajaran */
function bebanTerpasang(taId) {
  const map = new Map();
  for (const r of jadwalRows(taId)) {
    const mid = Number(r.mapel_id) || 0;
    if (!mid) continue;
    for (const kid of r.kelas_ids) {
      const key = `${kid}|${mid}`;
      const o = map.get(key) || { slot: 0, guru: new Set(), ruang: '' };
      o.slot++;
      if (Number(r.guru_id)) o.guru.add(Number(r.guru_id));
      if (!o.ruang && r.ruang) o.ruang = r.ruang;
      map.set(key, o);
    }
  }
  return map;
}

/** daftar beban mengajar (kelas × mapel) + jumlah slot yang sudah terpasang */
function jadwalBebanRows(taId) {
  const terpasang = bebanTerpasang(taId);
  return db.prepare(`SELECT b.*, k.nama AS kelas_nama, k.tingkat, k.tahun_ajaran_id,
      m.nama AS mapel_nama, m.kode AS mapel_kode, m.max_jam_hari, m.urut AS mapel_urut,
      u.nama AS guru_nama
    FROM jadwal_beban b
    LEFT JOIN kelas k ON k.id=b.kelas_id
    LEFT JOIN mapel m ON m.id=b.mapel_id
    LEFT JOIN users u ON u.id=b.guru_id
    ORDER BY k.tahun_ajaran_id, k.urut, k.tingkat, k.nama, m.urut, m.nama`).all()
    .map(b => {
      const t = terpasang.get(`${b.kelas_id}|${b.mapel_id}`) || { slot: 0, guru: new Set(), ruang: '' };
      return {
        ...b, jam_minggu: Number(b.jam_minggu) || 0,
        terpasang: t.slot, kurang: Math.max(0, (Number(b.jam_minggu) || 0) - t.slot),
        guru_terpasang: [...t.guru], ruang_terpasang: t.ruang
      };
    });
}

/** simpan beban mengajar satu/lebih baris (jam 0 = hapus baris beban) */
function jadwalBebanSave(items, taId, user) {
  let masuk = 0, hapus = 0, dilewati = 0;
  const daftar = Array.isArray(items) ? items : [];
  db.transaction(() => {
    for (const it of daftar) {
      const kelasId = Number(it.kelas_id) || 0;
      const mapelId = Number(it.mapel_id) || 0;
      if (!kelasId || !mapelId) { dilewati++; continue; }
      const adaKelas = db.prepare('SELECT id FROM kelas WHERE id=?').get(kelasId);
      const adaMapel = db.prepare('SELECT id FROM mapel WHERE id=?').get(mapelId);
      if (!adaKelas || !adaMapel) { dilewati++; continue; }
      const jam = Math.max(0, Math.min(40, Math.round(Number(it.jam_minggu) || 0)));
      if (!jam) {
        hapus += db.prepare('DELETE FROM jadwal_beban WHERE kelas_id=? AND mapel_id=?').run(kelasId, mapelId).changes;
        continue;
      }
      const guruId = Number(it.guru_id) || 0;
      const guruSah = guruId && db.prepare('SELECT id FROM users WHERE id=? AND aktif=1').get(guruId);
      const ruang = String(it.ruang === undefined || it.ruang === null ? '' : it.ruang).trim().slice(0, 40);
      db.prepare(`INSERT INTO jadwal_beban(ta_id,kelas_id,mapel_id,guru_id,jam_minggu,ruang,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(kelas_id,mapel_id) DO UPDATE SET ta_id=excluded.ta_id, guru_id=excluded.guru_id,
          jam_minggu=excluded.jam_minggu, ruang=excluded.ruang, updated_at=excluded.updated_at`)
        .run(Number(taId) || null, kelasId, mapelId, guruSah ? guruId : null, jam, ruang, now(), now());
      masuk++;
    }
  })();
  if (user) logAudit(user, masuk ? 'UBAH' : 'HAPUS', 'jadwal',
    `Beban mengajar AI: ${masuk} baris disimpan, ${hapus} dihapus, ${dilewati} dilewati`, '');
  return { masuk, hapus, dilewati };
}

/** daftar guru + batasan (target/maks jam pekan, hari tidak bersedia, beban terpasang) */
function jadwalGuruBatasRows(taId) {
  const targets = guruTargetMap();
  const beban = new Map();
  for (const r of jadwalRows(taId)) {
    const gid = Number(r.guru_id) || 0;
    if (gid) beban.set(gid, (beban.get(gid) || 0) + 1);
  }
  const mapelOf = new Map();
  for (const r of db.prepare('SELECT guru_id, mapel_id FROM guru_mapel ORDER BY id').all()) {
    const arr = mapelOf.get(Number(r.guru_id)) || [];
    arr.push(Number(r.mapel_id));
    mapelOf.set(Number(r.guru_id), arr);
  }
  const namaMapel = new Map(db.prepare('SELECT id,nama,kode FROM mapel').all().map(m => [Number(m.id), m]));
  return db.prepare(`SELECT id,nama,username,jabatan,role,roles,aktif FROM users WHERE aktif=1 ORDER BY nama`).all()
    .map(u => {
      const t = targets.get(Number(u.id)) || {};
      const hari = (() => {
        try { const a = JSON.parse(t.tidak_hadir || '[]'); return Array.isArray(a) ? a.map(Number).filter(n => n >= 0 && n <= 6) : []; }
        catch (e) { return []; }
      })();
      const mapelIds = mapelOf.get(Number(u.id)) || [];
      return {
        guru_id: Number(u.id), nama: u.nama, username: u.username, nip: u.nip || '',
        jabatan: u.jabatan || '', role: u.role, roles: userRoleList(u),
        target_minggu: Number(t.target_minggu) || 0, target_bulan: Number(t.target_bulan) || 0,
        max_jam: Number(t.max_jam) || 0, tidak_hadir: hari, catatan: t.catatan || '',
        mapel: mapelIds.map(id => ({ id, nama: (namaMapel.get(id) || {}).nama || '', kode: (namaMapel.get(id) || {}).kode || '' })),
        jam_minggu: beban.get(Number(u.id)) || 0,
        batas: (Number(t.max_jam) || Number(t.target_minggu) || 0)
      };
    });
}

/** simpan batasan guru (batas jam maksimal per pekan & hari tidak bersedia) */
function jadwalGuruBatasSave(items, user) {
  let n = 0;
  const daftar = Array.isArray(items) ? items : [];
  db.transaction(() => {
    for (const it of daftar) {
      const gid = Number(it.guru_id) || 0;
      if (!gid || !db.prepare('SELECT id FROM users WHERE id=?').get(gid)) continue;
      const ada = db.prepare('SELECT id FROM guru_jam_target WHERE guru_id=?').get(gid);
      const max = Math.max(0, Math.min(40, Math.round(Number(it.max_jam) || 0)));
      const hari = [...new Set((Array.isArray(it.tidak_hadir) ? it.tidak_hadir : [])
        .map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b);
      const catatan = String(it.catatan === undefined ? '' : it.catatan).trim().slice(0, 240);
      if (ada) {
        db.prepare('UPDATE guru_jam_target SET max_jam=?, tidak_hadir=?, catatan=?, oleh=?, oleh_nama=?, updated_at=? WHERE guru_id=?')
          .run(max, JSON.stringify(hari), catatan, user ? user.id : null, user ? user.nama : '', now(), gid);
      } else {
        db.prepare(`INSERT INTO guru_jam_target(guru_id,target_minggu,target_bulan,max_jam,tidak_hadir,catatan,oleh,oleh_nama,created_at,updated_at)
          VALUES(?,?,0,?,?,?,?,?,?,?)`)
          .run(gid, 0, max, JSON.stringify(hari), catatan, user ? user.id : null, user ? user.nama : '', now(), now());
      }
      n++;
    }
  })();
  if (user && n) logAudit(user, 'UBAH', 'jadwal', `Batasan mengajar guru (AI): ${n} guru diperbarui`, '');
  return n;
}

/** daftar ruang / laboratorium */
function jadwalRuangRows() {
  return db.prepare('SELECT * FROM jadwal_ruang ORDER BY aktif DESC, jenis, nama').all()
    .map(r => ({ ...r, kapasitas: Number(r.kapasitas) || 0, aktif: Number(r.aktif) }));
}

/** simpan satu ruang (insert bila tanpa id) */
function jadwalRuangSave(data = {}, user) {
  const nama = String(data.nama || '').trim().slice(0, 60);
  if (!nama) throw new Error('Nama ruangan wajib diisi.');
  const jenis = ['kelas', 'lab', 'lapangan', 'aula', 'lain'].includes(String(data.jenis)) ? String(data.jenis) : 'kelas';
  const kapasitas = Math.max(0, Math.min(5000, Math.round(Number(data.kapasitas) || 0)));
  const aktif = data.aktif === 0 || data.aktif === '0' || data.aktif === false ? 0 : 1;
  const catatan = String(data.catatan === undefined ? '' : data.catatan).trim().slice(0, 200);
  const id = Number(data.id) || 0;
  const dup = db.prepare('SELECT id FROM jadwal_ruang WHERE lower(nama)=lower(?) AND id<>?').get(nama, id);
  if (dup) throw new Error(`Ruang "${nama}" sudah ada.`);
  if (id) {
    const lama = db.prepare('SELECT nama FROM jadwal_ruang WHERE id=?').get(id);
    if (!lama) throw new Error('Ruang tidak ditemukan.');
    if (!aktif) {
      const dipakaiMapel = db.prepare('SELECT COUNT(*) c FROM mapel WHERE ruang_id=?').get(id).c;
      const dipakaiBeban = db.prepare("SELECT COUNT(*) c FROM jadwal_beban WHERE lower(trim(ruang))=lower(trim(?))").get(lama.nama).c;
      const dipakaiJadwal = db.prepare("SELECT COUNT(*) c FROM jadwal WHERE lower(trim(ruang))=lower(trim(?))").get(lama.nama).c;
      if (dipakaiMapel || dipakaiBeban || dipakaiJadwal) {
        throw new Error(`Ruang "${lama.nama}" tidak dapat dinonaktifkan saat masih diwajibkan mapel atau dipakai jadwal.`);
      }
    }
    db.transaction(() => {
      db.prepare('UPDATE jadwal_ruang SET nama=?,jenis=?,kapasitas=?,aktif=?,catatan=?,updated_at=? WHERE id=?')
        .run(nama, jenis, kapasitas, aktif, catatan, now(), id);
      if (String(lama.nama).toLowerCase() !== nama.toLowerCase()) {
        db.prepare('UPDATE jadwal SET ruang=? WHERE lower(trim(ruang))=lower(trim(?))').run(nama, lama.nama);
        db.prepare('UPDATE jadwal_beban SET ruang=? WHERE lower(trim(ruang))=lower(trim(?))').run(nama, lama.nama);
      }
    })();
  } else {
    const r = db.prepare('INSERT INTO jadwal_ruang(nama,jenis,kapasitas,aktif,catatan,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(nama, jenis, kapasitas, aktif, catatan, now(), now());
    if (user) logAudit(user, 'TAMBAH', 'jadwal', `Ruang/lab baru: ${nama}`, '');
    return { id: Number(r.lastInsertRowid) };
  }
  if (user) logAudit(user, 'UBAH', 'jadwal', `Ruang/lab diperbarui: ${nama}`, '');
  return { id };
}

/** hapus ruang (ditolak bila masih dipakai sebagai ruang default beban) */
function jadwalRuangDelete(id) {
  const rid = Number(id) || 0;
  const row = db.prepare('SELECT * FROM jadwal_ruang WHERE id=?').get(rid);
  if (!row) return { ok: false, error: 'Ruang tidak ditemukan.' };
  const beban = db.prepare("SELECT COUNT(*) c FROM jadwal_beban WHERE lower(TRIM(ruang))=lower(?)").get(String(row.nama)).c;
  const mapel = db.prepare('SELECT COUNT(*) c FROM mapel WHERE ruang_id=?').get(rid).c;
  const slot = db.prepare("SELECT COUNT(*) c FROM jadwal WHERE lower(TRIM(ruang))=lower(?)").get(String(row.nama)).c;
  if (beban || mapel || slot) {
    const alasan = [];
    if (mapel) alasan.push(`${mapel} mapel mewajibkan ruangan ini`);
    if (beban) alasan.push(`${beban} beban mengajar menggunakan ruangan ini`);
    if (slot) alasan.push(`${slot} slot jadwal menggunakan ruangan ini`);
    return { ok: false, error: `Ruang "${row.nama}" tidak dapat dihapus: ${alasan.join(', ')}.` };
  }
  db.prepare('DELETE FROM jadwal_ruang WHERE id=?').run(rid);
  return { ok: true };
}

/** Pilih ruang wajib atau alokasikan ruang aktif yang belum dipakai pada slot. */
function jadwalRuangPilih({ taId, hari, sesi, mapelId, ruang, exceptId } = {}) {
  const mapel = db.prepare(`SELECT m.ruang_id, r.nama AS ruang_nama, r.aktif AS ruang_aktif
    FROM mapel m LEFT JOIN jadwal_ruang r ON r.id=m.ruang_id WHERE m.id=?`).get(Number(mapelId) || 0) || {};
  const wajib = Number(mapel.ruang_id) || 0;
  if (wajib && (!mapel.ruang_nama || Number(mapel.ruang_aktif) !== 1)) {
    return { error: 'Ruangan wajib mapel tidak ditemukan atau sedang nonaktif.' };
  }
  const diminta = String(ruang || '').trim().slice(0, 60);
  const nama = wajib ? String(mapel.ruang_nama) : diminta;
  if (nama) {
    const master = db.prepare('SELECT aktif FROM jadwal_ruang WHERE lower(trim(nama))=lower(trim(?))').get(nama);
    if (master && Number(master.aktif) !== 1) return { error: `Ruang "${nama}" sedang nonaktif.` };
    return { ruang: nama, wajib: !!wajib, otomatis: false, diganti: !!(wajib && diminta && diminta.toLowerCase() !== nama.toLowerCase()) };
  }
  const aktif = jadwalRuangRows().filter(r => Number(r.aktif) === 1);
  if (!aktif.length) return { ruang: '', wajib: false, otomatis: false };
  const terpakai = new Set(db.prepare(`SELECT lower(trim(ruang)) AS ruang FROM jadwal
    WHERE ta_id=? AND hari=? AND sesi=? AND id<>? AND trim(COALESCE(ruang,''))<>''`)
    .all(Number(taId) || 0, Number(hari), Number(sesi), Number(exceptId) || 0).map(r => r.ruang));
  const bebas = aktif.find(r => !terpakai.has(String(r.nama).trim().toLowerCase()));
  if (!bebas) return { error: `Tidak ada ruangan yang tersedia pada ${HARI_LABEL[Number(hari)] || 'hari tersebut'} sesi ${Number(sesi)}.` };
  return { ruang: bebas.nama, wajib: false, otomatis: true };
}

/* =====================================================================
   KALENDER AKADEMIK (hari libur / ujian / kegiatan) — 1 tahun ajaran
   ---------------------------------------------------------------------
   Setiap tanggal yang ditandai dengan `nonaktif=1` membuat JADWAL MAPEL
   REGULER TIDAK BERLAKU pada hari itu: absensi guru/siswa ditutup, alfa
   otomatis & pengingat WA dilewati, tanpa mengubah master jadwal mingguan.
   ===================================================================== */
const KALENDER_KATEGORI = [
  { key: 'libur', label: 'Hari Libur Nasional', tone: 'rose', nonaktif: 1 },
  { key: 'ujian', label: 'Jadwal Ujian (PTS/PAS/Ujian Sekolah)', tone: 'violet', nonaktif: 1 },
  { key: 'kegiatan', label: 'Kegiatan Sekolah Lainnya', tone: 'sky', nonaktif: 1 }
];
const KALENDER_KATEGORI_LABEL = Object.fromEntries(KALENDER_KATEGORI.map(k => [k.key, k.label]));
function kalenderRows(taId, from, to) {
  const where = [];
  const args = [];
  if (taId !== undefined && taId !== null && Number(taId) > 0) { where.push('ta_id=?'); args.push(Number(taId)); }
  if (from) { where.push('tanggal>=?'); args.push(String(from)); }
  if (to) { where.push('tanggal<=?'); args.push(String(to)); }
  return db.prepare(`SELECT * FROM kalender_akademik ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY tanggal`).all(...args);
}
function kalenderMap(taId, from, to) {
  const out = new Map();
  for (const r of kalenderRows(taId, from, to)) out.set(String(r.tanggal), r);
  return out;
}
/** kalender pada satu tanggal (lintas TA — dipakai validasi absensi) */
function kalenderOfDate(tanggal) {
  const tgl = String(tanggal || today()).slice(0, 10);
  try {
    return db.prepare('SELECT * FROM kalender_akademik WHERE tanggal=? ORDER BY id DESC LIMIT 1').get(tgl) || null;
  } catch (e) { return null; }
}
/** true bila tanggal itu KBM reguler tidak berlaku (libur / ujian / kegiatan) */
function kalenderNonaktif(tanggal) {
  const row = kalenderOfDate(tanggal);
  return !!(row && Number(row.nonaktif) === 1);
}
/** simpan / ubah satu tanggal kalender */
function kalenderSave(data = {}, user) {
  const tgl = String(data.tanggal || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) throw new Error('Tanggal tidak valid (format YYYY-MM-DD).');
  const kategori = KALENDER_KATEGORI.some(k => k.key === data.kategori) ? data.kategori : 'libur';
  const judul = String(data.judul || '').trim().slice(0, 120) || KALENDER_KATEGORI_LABEL[kategori];
  const keterangan = String(data.keterangan || '').trim().slice(0, 400);
  const nonaktif = data.nonaktif === undefined ? 1 : (data.nonaktif === true || Number(data.nonaktif) === 1 ? 1 : 0);
  /* warna kustom per tanggal (kosong = ikut warna kategori) */
  const warna = HEX_RE.test(String(data.warna || '')) ? String(data.warna) : '';
  const taId = Number(data.ta_id) || Number((tahunById(Number(getSetting('ta_aktif', 0))) || tahunAktif() || {}).id) || 0;
  const ada = db.prepare('SELECT * FROM kalender_akademik WHERE ta_id=? AND tanggal=?').get(taId, tgl);
  if (data.id && !ada) {
    const byId = db.prepare('SELECT * FROM kalender_akademik WHERE id=?').get(Number(data.id));
    if (byId) {
      db.prepare('UPDATE kalender_akademik SET tanggal=?,kategori=?,judul=?,keterangan=?,nonaktif=?,warna=?,oleh=?,oleh_nama=?,updated_at=? WHERE id=?')
        .run(tgl, kategori, judul, keterangan, nonaktif, warna, user ? user.id : null, user ? user.nama : '', now(), Number(data.id));
      return db.prepare('SELECT * FROM kalender_akademik WHERE id=?').get(Number(data.id));
    }
  }
  if (ada) {
    db.prepare('UPDATE kalender_akademik SET kategori=?,judul=?,keterangan=?,nonaktif=?,warna=?,oleh=?,oleh_nama=?,updated_at=? WHERE id=?')
      .run(kategori, judul, keterangan, nonaktif, warna, user ? user.id : null, user ? user.nama : '', now(), Number(ada.id));
    return db.prepare('SELECT * FROM kalender_akademik WHERE id=?').get(Number(ada.id));
  }
  const r = db.prepare(`INSERT INTO kalender_akademik(ta_id,tanggal,kategori,judul,keterangan,nonaktif,warna,oleh,oleh_nama,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(taId, tgl, kategori, judul, keterangan, nonaktif, warna, user ? user.id : null, user ? user.nama : '', now(), now());
  return db.prepare('SELECT * FROM kalender_akademik WHERE id=?').get(Number(r.lastInsertRowid));
}
/* ---------------------------------------------------------------------
   WARNA KATEGORI & RENTANG SEMESTER (dokumen cetak kalender akademik)
   --------------------------------------------------------------------- */
const KALENDER_WARNA_DEFAULT = {
  libur: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  ujian: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  kegiatan: { bg: '#E0F2FE', text: '#075985', border: '#7DD3FC' }
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** warna kategori kalender (boleh diubah admin lewat color picker) */
function kalenderWarna() {
  const raw = jsonSetting('kal_warna', null) || {};
  const out = {};
  for (const k of KALENDER_KATEGORI) {
    const def = KALENDER_WARNA_DEFAULT[k.key];
    const v = raw[k.key] || {};
    out[k.key] = {
      bg: HEX_RE.test(String(v.bg || '')) ? String(v.bg) : def.bg,
      text: HEX_RE.test(String(v.text || '')) ? String(v.text) : def.text,
      border: HEX_RE.test(String(v.border || '')) ? String(v.border) : def.border
    };
  }
  return out;
}
/**
 * Rentang tanggal semester 1 & 2.
 * Kosong = otomatis dari tahun pelajaran: S1 = awal TA s.d. 31 Desember,
 * S2 = 1 Januari s.d. akhir TA.
 */
function kalenderSemester(ta) {
  const t = ta || tahunById(Number(getSetting('ta_aktif', 0))) || tahunAktif() || {};
  const mulai = String(t.tanggal_mulai || '').slice(0, 10);
  const selesai = String(t.tanggal_selesai || '').slice(0, 10);
  const TGL = /^\d{4}-\d{2}-\d{2}$/;
  const auto1s = mulai || `${new Date().getFullYear()}-07-01`;
  const auto1e = `${auto1s.slice(0, 4)}-12-31`;
  const auto2s = `${Number(auto1s.slice(0, 4)) + 1}-01-01`;
  const auto2e = selesai || `${Number(auto1s.slice(0, 4)) + 1}-06-30`;
  const pick = (k, def) => (TGL.test(String(getSetting(k, '') || '').slice(0, 10))
    ? String(getSetting(k, '')).slice(0, 10) : def);
  return {
    ganjil: { mulai: pick('kal_s1_mulai', auto1s), selesai: pick('kal_s1_selesai', auto1e) },
    genap: { mulai: pick('kal_s2_mulai', auto2s), selesai: pick('kal_s2_selesai', auto2e) }
  };
}
/** semester ('ganjil'|'genap'|'') dari sebuah tanggal */
function kalenderSemesterOf(tanggal, sem) {
  const tgl = String(tanggal || '').slice(0, 10);
  const s = sem || kalenderSemester();
  if (tgl >= s.ganjil.mulai && tgl <= s.ganjil.selesai) return 'ganjil';
  if (tgl >= s.genap.mulai && tgl <= s.genap.selesai) return 'genap';
  return '';
}
/**
 * Kelompokkan baris kalender menjadi RENTANG tanggal berurutan dengan
 * judul+kategori+warna yang sama → dipakai daftar keterangan di bawah grid
 * bulan pada dokumen cetak (mis. "14 - 28 Maret 2026  Prakiraan Libur Awal Ramadan").
 */
function kalenderRentang(rows) {
  const urut = [...(rows || [])].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  const out = [];
  const key = r => `${r.kategori}|${r.judul || ''}|${r.keterangan || ''}|${r.warna || ''}|${Number(r.nonaktif) === 1 ? 1 : 0}`;
  for (const r of urut) {
    const last = out[out.length - 1];
    if (last && key(last.row) === key(r)) {
      /* sambung bila HANYA berbeda 1..3 hari (mis. jeda akhir pekan) */
      const beda = (new Date(String(r.tanggal) + 'T00:00:00') - new Date(String(last.sampai) + 'T00:00:00')) / 86400000;
      if (beda >= 1 && beda <= 3) { last.sampai = String(r.tanggal); last.jumlah++; continue; }
    }
    out.push({ row: r, dari: String(r.tanggal), sampai: String(r.tanggal), jumlah: 1 });
  }
  return out;
}

/** hapus satu tanggal kalender */
function kalenderDelete(id) {
  const row = db.prepare('SELECT * FROM kalender_akademik WHERE id=?').get(Number(id) || 0);
  if (!row) return null;
  db.prepare('DELETE FROM kalender_akademik WHERE id=?').run(Number(id));
  return row;
}

function mapelList({ aktifOnly } = {}) {
  const rows = db.prepare(`SELECT m.*, r.nama AS ruang_wajib_nama, r.aktif AS ruang_wajib_aktif
    FROM mapel m LEFT JOIN jadwal_ruang r ON r.id=m.ruang_id ORDER BY m.urut, m.nama`).all();
  return aktifOnly === false ? rows : rows.filter(m => Number(m.aktif) !== 0);
}
/** kelas yang ikut pada satu slot jadwal (fitur merge = lebih dari satu) */
function jadwalKelasIds(row) {
  if (Array.isArray(row && row.kelas_ids)) {
    return row.kelas_ids.map(Number).filter(Boolean);
  }
  try {
    const a = JSON.parse((row && row.kelas_ids) || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Boolean) : [];
  } catch (e) { return []; }
}
/** daftar slot jadwal satu tahun pelajaran (lengkap dengan nama mapel/guru/kelas) */
function jadwalRows(taId) {
  const kelas = new Map(kelasAll().map(k => [Number(k.id), k]));
  const rows = db.prepare(`SELECT j.*, m.nama AS mapel_nama, m.kode AS mapel_kode, u.nama AS guru_nama, u.nip AS guru_nip
    FROM jadwal j LEFT JOIN mapel m ON m.id=j.mapel_id LEFT JOIN users u ON u.id=j.guru_id
    WHERE j.ta_id=? ORDER BY j.hari, j.sesi, j.id`).all(Number(taId) || 0);
  return rows.map(r => {
    const ids = jadwalKelasIds(r);
    return {
      ...r,
      kelas_ids: ids,
      kelas: ids.map(id => kelas.get(id)).filter(Boolean).map(k => ({ id: k.id, nama: k.nama })),
      kelas_nama: ids.map(id => (kelas.get(id) || {}).nama).filter(Boolean).join(', '),
      merged: ids.length > 1
    };
  });
}
/**
 * ============ TUKAR JADWAL MENGAJAR ANTAR GURU (temporer) ============
 * Satu permintaan memasangkan dua slot mapel pada tanggal tersebut. Bila guru
 * tujuan menerima, guru dan mapel efektif kedua slot saling bertukar; tanggal
 * berikutnya (termasuk pekan berikutnya) tetap memakai jadwal induk.
 */
const TUKAR_SELECT = `SELECT t.*, d.nama AS dari_nama, d.nip AS dari_nip, k.nama AS ke_nama, k.nip AS ke_nip,
    m.nama AS mapel_nama, m.kode AS mapel_kode, j.hari, j.sesi, j.kelas_ids, j.ta_id AS jadwal_ta
  FROM jadwal_tukar t
  LEFT JOIN users d ON d.id=t.dari_guru
  LEFT JOIN users k ON k.id=t.ke_guru
  LEFT JOIN mapel m ON m.id=t.mapel_id
  LEFT JOIN jadwal j ON j.id=t.jadwal_id`;
const tglOf = v => String(v || today()).slice(0, 10);

/** semua permintaan tukar untuk satu slot pada satu tanggal (terbaru dulu) */
function tukarOf(jadwalId, tanggal) {
  return db.prepare(`${TUKAR_SELECT} WHERE t.jadwal_id=? AND t.tanggal=? ORDER BY t.id DESC`)
    .all(Number(jadwalId) || 0, tglOf(tanggal)).map(dekorTukar);
}
/** permintaan yang SUDAH DITERIMA (guru pengganti efektif) pada slot+tanggal */
function tukarAktif(jadwalId, tanggal) {
  const row = db.prepare(`${TUKAR_SELECT} WHERE t.jadwal_id=? AND t.tanggal=? AND t.status='diterima' ORDER BY t.id DESC LIMIT 1`)
    .get(Number(jadwalId) || 0, tglOf(tanggal));
  return row ? dekorTukar(row) : null;
}
/** peta jadwal_id → permintaan diterima untuk satu tanggal (efisien untuk daftar) */
function tukarMap(tanggal) {
  const m = new Map();
  for (const r of db.prepare(`${TUKAR_SELECT} WHERE t.tanggal=? AND t.status='diterima'`).all(tglOf(tanggal))) {
    m.set(Number(r.jadwal_id), dekorTukar(r));
  }
  return m;
}
/** guru efektif satu slot pada tanggal (guru pengganti bila tukar diterima) */
function tukarGuruEfektif(row, tanggal, map) {
  const peta = map || tukarMap(tanggal);
  const t = peta.get(Number(row && row.id));
  return t ? Number(t.ke_guru) : (Number(row && row.guru_id) || 0);
}
function dekorTukar(r) {
  const kelasIds = (() => { try { const a = JSON.parse(r.kelas_ids || '[]'); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch (e) { return []; } })();
  const kelasNama = kelasIds.length
    ? db.prepare(`SELECT nama FROM kelas WHERE id IN (${kelasIds.map(() => '?').join(',')})`).all(...kelasIds).map(k => k.nama).join(', ')
    : '';
  return { ...r, dari_nama: r.dari_nama || 'Guru', ke_nama: r.ke_nama || 'Guru', kelas_ids: kelasIds, kelas_nama: kelasNama };
}
/** permintaan tukar MASUK (menunggu jawaban) untuk seorang guru tujuan */
function tukarMasuk(guruId, { status } = {}) {
  const st = status ? String(status) : 'pending';
  return db.prepare(`${TUKAR_SELECT} WHERE t.ke_guru=? AND t.status=?
    AND (t.permintaan_id IS NULL OR t.permintaan_id=t.id) ORDER BY t.tanggal DESC, t.id DESC`)
    .all(Number(guruId) || 0, st).map(dekorTukar);
}
/** riwayat permintaan yang DIAJUKAN seorang guru (semua status) */
function tukarKeluar(guruId, limit = 30) {
  return db.prepare(`${TUKAR_SELECT} WHERE t.dari_guru=?
    AND (t.permintaan_id IS NULL OR t.permintaan_id=t.id)
    ORDER BY t.tanggal DESC, t.id DESC LIMIT ?`)
    .all(Number(guruId) || 0, Math.max(1, Number(limit) || 30)).map(dekorTukar);
}

/**
 * Deteksi bentrok jadwal.
 * KERAS (ditolak): guru mengajar 2 kelas di jam sama, kelas terisi dobel, ruang dobel.
 * LUNAK (peringatan): melebihi batas jam mapel/guru per hari, hari tidak aktif, dsb.
 */
function jadwalConflict(opts = {}) {
  const cfg = opts.cfg || jadwalConfig();
  const taId = Number(opts.taId) || 0;
  const hari = Number(opts.hari);
  const sesi = Number(opts.sesi);
  const kelasIds = (Array.isArray(opts.kelas_ids) ? opts.kelas_ids : []).map(Number).filter(Boolean);
  const guruId = Number(opts.guru_id) || 0;
  const mapelId = Number(opts.mapel_id) || 0;
  const ruang = String(opts.ruang || '').trim().toLowerCase();
  const exceptId = Number(opts.exceptId) || 0;
  const hard = [], soft = [];
  /* SESI PER HARI: hari yang punya pengaturan jam khusus (mis. Jumat tanpa istirahat
     pada jam ke-3) HARUS divalidasi memakai daftar sesi hari itu, bukan sesi umum —
     kalau tidak, slot pelajaran yang sah di hari khusus ikut ditolak sebagai
     "waktu istirahat" karena posisi idx-nya kebetulan sama dengan istirahat umum. */
  const sesiRow = sesiOfHari(cfg, hari).find(s => Number(s.idx) === sesi);
  if (!cfg.hari.includes(hari)) hard.push({ jenis: 'hari', pesan: `${HARI_LABEL[hari] || 'Hari'} bukan hari pembelajaran aktif.` });
  if (!sesiRow) hard.push({ jenis: 'sesi', pesan: `Sesi jam pelajaran tidak dikenal pada hari ${HARI_LABEL[hari] || 'tersebut'}.` });
  else if (sesiRow.istirahat) hard.push({ jenis: 'sesi', pesan: `${sesiRow.label} adalah waktu istirahat, tidak dapat diisi pelajaran.` });
  if (!kelasIds.length) hard.push({ jenis: 'kelas', pesan: 'Pilih minimal satu kelas/rombel.' });
  if (!guruId) hard.push({ jenis: 'guru', pesan: 'Guru pengampu belum dipilih.' });
  if (!mapelId) hard.push({ jenis: 'mapel', pesan: 'Mata pelajaran belum dipilih.' });

  const semua = jadwalRows(taId);
  const hariIni = semua.filter(r => Number(r.hari) === hari && Number(r.sesi) === sesi && Number(r.id) !== exceptId);
  const kelasMap = new Map(kelasAll().map(k => [Number(k.id), k.nama]));
  for (const r of hariIni) {
    const irisan = r.kelas_ids.filter(id => kelasIds.includes(id));
    if (irisan.length) {
      hard.push({
        jenis: 'kelas',
        pesan: `Kelas ${irisan.map(id => kelasMap.get(id) || id).join(', ')} sudah terisi ${r.mapel_nama || 'mapel lain'}`
          + `${r.guru_nama ? ' oleh ' + r.guru_nama : ''} pada ${HARI_LABEL[hari]} ${sesiRow ? sesiRow.mulai + '–' + sesiRow.selesai : 'jam tersebut'}.`
      });
    }
    if (guruId && Number(r.guru_id) === guruId) {
      hard.push({
        jenis: 'guru',
        pesan: `${r.guru_nama || 'Guru'} sudah mengajar ${r.mapel_nama || 'mapel lain'} di ${r.kelas_nama || 'kelas lain'} pada jam yang sama.`
      });
    }
    if (ruang && String(r.ruang || '').trim().toLowerCase() === ruang) {
      hard.push({ jenis: 'ruang', pesan: `Ruang "${opts.ruang}" sudah dipakai ${r.mapel_nama || 'mapel lain'} di ${r.kelas_nama || 'kelas lain'} pada ${HARI_LABEL[hari]} sesi ${sesi}.` });
    }
  }
  if (mapelId) {
    const mapel = db.prepare(`SELECT m.ruang_id, r.nama AS ruang_nama, r.aktif AS ruang_aktif
      FROM mapel m LEFT JOIN jadwal_ruang r ON r.id=m.ruang_id WHERE m.id=?`).get(mapelId);
    if (mapel && Number(mapel.ruang_id)) {
      if (!mapel.ruang_nama || Number(mapel.ruang_aktif) !== 1) {
        hard.push({ jenis: 'ruang-wajib', pesan: 'Ruangan wajib untuk mata pelajaran ini tidak tersedia atau sedang nonaktif.' });
      } else if (ruang !== String(mapel.ruang_nama).trim().toLowerCase()) {
        hard.push({ jenis: 'ruang-wajib', pesan: `${mapel.ruang_nama} adalah ruangan wajib untuk mata pelajaran ini.` });
      }
    }
  }
  /* batas jam mengajar guru per hari */
  if (guruId) {
    const jamGuru = semua.filter(r => Number(r.hari) === hari && Number(r.guru_id) === guruId && Number(r.id) !== exceptId).length + 1;
    if (jamGuru > cfg.maxGuruJam) {
      soft.push({ jenis: 'guru-max', pesan: `Guru ini akan mengajar ${jamGuru} jam pada ${HARI_LABEL[hari]} (batas ${cfg.maxGuruJam} jam/hari).` });
    }
  }
  /* batas jam mata pelajaran yang sama per kelas per hari */
  if (mapelId) {
    const mapel = db.prepare('SELECT * FROM mapel WHERE id=?').get(mapelId);
    for (const kelasId of kelasIds) {
      const n = semua.filter(r => Number(r.hari) === hari && Number(r.mapel_id) === mapelId
        && Number(r.id) !== exceptId && r.kelas_ids.includes(kelasId)).length + 1;
      const batas = Math.min(cfg.maxMapelJam, Number(mapel && mapel.max_jam_hari) || 99);
      if (n > batas) {
        soft.push({ jenis: 'mapel-max', pesan: `Mapel ${mapel ? mapel.nama : ''} menjadi ${n} jam di ${kelasMap.get(kelasId) || 'kelas'} pada ${HARI_LABEL[hari]} (batas ${batas} jam/hari).` });
      }
    }
  }
  return { hard, soft };
}
/** jendela waktu absensi satu slot pada tanggal tertentu */
function absensiWindow(jadwalRow, tanggal, cfg) {
  const c = cfg || jadwalConfig();
  const tgl = String(tanggal || today()).slice(0, 10);
  const daftarSesi = sesiOfHari(c, jadwalRow.hari);
  const sesi = daftarSesi.find(s => Number(s.idx) === Number(jadwalRow.sesi)) || null;
  if (!sesi) return { aktif: false, alasan: 'Sesi jam pelajaran tidak ditemukan pada pengaturan jadwal.', sesi: null };
  const hariOk = Number(jadwalRow.hari) === hariOf(tgl);
  const hariIni = tgl === today();
  const buka = jamMenit(sesi.mulai) - c.bukaMenit;
  /* PENGUNCIAN WAKTU: batas akhir = jam selesai + toleransi (default 0 menit),
     sehingga begitu jam pelajaran berakhir seluruh aksi absensi terkunci. */
  const tutup = jamMenit(sesi.selesai) + (c.toleransiTutup || 0);
  const now = nowMenit();
  /* KALENDER AKADEMIK: tanggal libur / ujian / kegiatan dengan `nonaktif=1`
     membuat jadwal mapel reguler TIDAK BERLAKU — absensi ditutup hari itu
     tanpa mengubah master jadwal mingguan. */
  const kal = kalenderOfDate(tgl);
  const kalNonaktif = !!(kal && Number(kal.nonaktif) === 1);
  let alasan = '';
  if (kalNonaktif) {
    alasan = `KBM tidak berlaku pada tanggal ini — ${KALENDER_KATEGORI_LABEL[kal.kategori] || 'agenda sekolah'}`
      + `${kal.judul ? ': ' + kal.judul : ''}.`;
  } else if (!hariIni) alasan = 'Absensi hanya dapat dilakukan pada hari pelajaran tersebut berlangsung.';
  else if (!hariOk) alasan = `Jadwal ini bukan untuk hari ${HARI_LABEL[hariOf(tgl)]}.`;
  else if (now < buka) alasan = `Absensi dibuka mulai ${menitJam(buka)} (${c.bukaMenit} menit sebelum ${sesi.mulai}).`;
  else if (now > tutup) {
    alasan = c.toleransiTutup
      ? `Sesi absensi sudah DITUTUP pukul ${menitJam(tutup)} (jam pelajaran ${sesi.mulai}–${sesi.selesai} + toleransi ${c.toleransiTutup} menit).`
      : `Sesi absensi sudah DITUTUP — jam pelajaran ${sesi.mulai}–${sesi.selesai} telah berakhir.`;
  }
  return {
    aktif: !alasan, alasan, sesi,
    tgl, hariIni, hariOk,
    buka: menitJam(buka), tutup: menitJam(tutup),
    selesai: sesi.selesai,
    terkunci: !hariIni || !hariOk || now > tutup || kalNonaktif,
    nonaktif: kalNonaktif,
    kalender: kal ? { id: kal.id, kategori: kal.kategori, label: KALENDER_KATEGORI_LABEL[kal.kategori] || '', judul: kal.judul || '', keterangan: kal.keterangan || '', nonaktif: Number(kal.nonaktif) } : null,
    sekarang: menitJam(now)
  };
}
/** Slot berurutan untuk mapel, guru, dan himpunan kelas yang sama. */
function absensiKelompok(jadwalRow, rows, cfg) {
  const c = cfg || jadwalConfig();
  const sesi = sesiOfHari(c, jadwalRow.hari).filter(s => !s.istirahat);
  const kelasKey = r => (Array.isArray(r.kelas_ids) ? r.kelas_ids.map(Number) : jadwalKelasIds(r))
    .sort((a, b) => a - b).join(',');
  const cocok = r => Number(r.hari) === Number(jadwalRow.hari)
    && Number(r.mapel_id) === Number(jadwalRow.mapel_id)
    && Number(r.guru_id) === Number(jadwalRow.guru_id)
    && kelasKey(r) === kelasKey(jadwalRow);
  const sesiByNo = new Map(sesi.map(s => [Number(s.no), s]));
  const jadwalByNo = new Map();
  for (const r of rows.filter(cocok)) {
    const s = sesi.find(x => Number(x.idx) === Number(r.sesi));
    if (s && !jadwalByNo.has(Number(s.no))) jadwalByNo.set(Number(s.no), r);
  }
  const utama = sesi.find(s => Number(s.idx) === Number(jadwalRow.sesi));
  if (!utama || !Number(utama.no)) return [jadwalRow];
  const bisaMenyambung = (noA, noB) => {
    const sebelumnya = sesi.find(s => Number(s.no) === noA);
    const berikutnya = sesi.find(s => Number(s.no) === noB);
    return !!sebelumnya && !!berikutnya
      && jamMenit(berikutnya.mulai) - jamMenit(sebelumnya.selesai) <= 30;
  };
  let awal = Number(utama.no), akhir = awal;
  while (jadwalByNo.has(awal - 1) && sesiByNo.has(awal - 1) && bisaMenyambung(awal - 1, awal)) awal--;
  while (jadwalByNo.has(akhir + 1) && sesiByNo.has(akhir + 1) && bisaMenyambung(akhir, akhir + 1)) akhir++;
  return Array.from({ length: akhir - awal + 1 }, (_, i) => jadwalByNo.get(awal + i))
    .filter(Boolean).sort((a, b) => Number(a.sesi) - Number(b.sesi));
}
/** Kelompok rekap satu mapel efektif per kelas dan guru pada hari yang sama. */
function absensiMapelHari(rows, tukar = new Map()) {
  const groups = new Map();
  for (const row of rows || []) {
    const perubahan = tukar.get(Number(row.id));
    const guruId = perubahan ? Number(perubahan.ke_guru) : Number(row.guru_id) || 0;
    const mapelId = perubahan && Number(perubahan.mapel_id)
      ? Number(perubahan.mapel_id) : Number(row.mapel_id) || 0;
    const kelasIds = jadwalKelasIds(row).sort((a, b) => a - b);
    const key = `${guruId}|${mapelId}|${kelasIds.join(',')}`;
    if (!groups.has(key)) groups.set(key, {
      guru_id: guruId, mapel_id: mapelId, kelas_ids: kelasIds, rows: []
    });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group => ({
    ...group,
    rows: group.rows.sort((a, b) => Number(a.sesi) - Number(b.sesi))
  }));
}
/** Jendela absensi bersama untuk rentang sesi berurutan. */
function absensiWindowKelompok(items, tanggal, cfg) {
  if (!Array.isArray(items) || !items.length) {
    return { aktif: false, alasan: 'Slot jadwal tidak ditemukan.', sesi: null };
  }
  const c = cfg || jadwalConfig();
  const sorted = [...items].sort((a, b) => Number(a.sesi) - Number(b.sesi));
  const pertama = absensiWindow(sorted[0], tanggal, c);
  const sesiSemua = sesiOfHari(c, sorted[0].hari);
  const sesiAkhir = sesiSemua.find(s => Number(s.idx) === Number(sorted[sorted.length - 1].sesi));
  if (!pertama.sesi || !sesiAkhir) return pertama;
  const buka = jamMenit(pertama.sesi.mulai) - c.bukaMenit;
  const tutup = jamMenit(sesiAkhir.selesai) + (c.toleransiTutup || 0);
  const now = nowMenit();
  let alasan = '';
  if (pertama.nonaktif) alasan = pertama.alasan;
  else if (!pertama.hariIni) alasan = 'Absensi hanya dapat dilakukan pada hari pelajaran tersebut berlangsung.';
  else if (!pertama.hariOk) alasan = `Jadwal ini bukan untuk hari ${HARI_LABEL[hariOf(tanggal)]}.`;
  else if (now < buka) alasan = `Absensi dibuka mulai ${menitJam(buka)} (${c.bukaMenit} menit sebelum ${pertama.sesi.mulai}).`;
  else if (now > tutup) alasan = `Sesi absensi sudah DITUTUP — jam pelajaran ${pertama.sesi.mulai}–${sesiAkhir.selesai} telah berakhir.`;
  return {
    ...pertama, aktif: !alasan, alasan,
    buka: menitJam(buka), tutup: menitJam(tutup), selesai: sesiAkhir.selesai,
    terkunci: !pertama.hariIni || !pertama.hariOk || now > tutup || !!pertama.nonaktif,
    sesi_akhir: sesiAkhir
  };
}
/** Gabungkan jam pelajaran berurutan menjadi rentang untuk tampilan rekap. */
function absensiRentangSesi(items, cfg) {
  if (!Array.isArray(items) || !items.length) return { label_sesi: '', jam: '' };
  const c = cfg || jadwalConfig();
  const daftar = sesiOfHari(c, items[0].hari);
  const terurut = [...items].sort((a, b) => Number(a.sesi) - Number(b.sesi));
  const rentang = [];
  for (const row of terurut) {
    const sesi = daftar.find(x => Number(x.idx) === Number(row.sesi));
    if (!sesi || sesi.istirahat) continue;
    const no = Number(sesi.no) || 0;
    const terakhir = rentang[rentang.length - 1];
    const jarak = terakhir
      ? jamMenit(sesi.mulai) - jamMenit(terakhir.akhir.selesai)
      : null;
    if (terakhir && no > 0 && terakhir.noAkhir > 0 && no === terakhir.noAkhir + 1
      && jarak !== null && jarak <= 30) {
      terakhir.akhir = sesi;
      terakhir.noAkhir = no;
    } else {
      rentang.push({ awal: sesi, akhir: sesi, noAwal: no, noAkhir: no });
    }
  }
  return {
    label_sesi: rentang.map(x => x.noAwal && x.noAkhir
      ? (x.noAwal === x.noAkhir ? `Jam ke-${x.noAwal}` : `Jam ke-${x.noAwal}–${x.noAkhir}`)
      : x.awal.label).join(', '),
    jam: rentang.map(x => `${x.awal.mulai}–${x.akhir.selesai}`).join(', ')
  };
}
/* ---------- pencatat presensi (audit trail halaman publik) ---------- */
/** pencatat terakhir sebuah sesi presensi (nama & kelas) */
function pencatatOf(sesiId) {
  const row = db.prepare('SELECT * FROM absensi_pencatat WHERE sesi_id=? ORDER BY id DESC LIMIT 1')
    .get(Number(sesiId) || 0);
  return row || null;
}
/** apakah seorang siswa sudah pernah mengisi sesi ini (batas 1x) */
function pencatatSudah(sesiId, siswaId) {
  return !!db.prepare('SELECT id FROM absensi_pencatat WHERE sesi_id=? AND siswa_id=?')
    .get(Number(sesiId) || 0, Number(siswaId) || 0);
}
/** catat pengisian presensi oleh siswa (unikt per sesi+siswa) */
function pencatatAdd({ sesiId, jadwalId, tanggal, siswaId, nama, kelas, role, jumlah, ip }) {
  const r = db.prepare(`INSERT OR IGNORE INTO absensi_pencatat(sesi_id,jadwal_id,tanggal,siswa_id,nama,kelas,role,jumlah,ip,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(Number(sesiId) || 0, Number(jadwalId) || 0, String(tanggal || today()).slice(0, 10),
      Number(siswaId) || 0, String(nama || ''), String(kelas || ''), String(role || 'ketua_kelas'),
      Number(jumlah) || 0, String(ip || ''), now());
  return Number(r.lastInsertRowid) || 0;
}

/** absensi guru satu guru pada satu tanggal */function absensiGuruOf(guruId, tanggal, taId) {
  return db.prepare('SELECT * FROM absensi_guru WHERE guru_id=? AND tanggal=? AND ta_id=?')
    .all(Number(guruId) || 0, String(tanggal || today()).slice(0, 10), Number(taId) || 0);
}
/**
 * Kelengkapan alur absensi guru untuk satu slot+tanggal:
 *   1) check-in (status tersimpan)  2) absensi siswa lengkap  3) jurnal mengajar  4) foto (bila wajib)
 * Dipakai untuk menegakkan urutan kerja & sanksi alfa otomatis.
 */
function absensiAlur(jadwalId, tanggal) {
  const jid = Number(jadwalId) || 0;
  const tgl = String(tanggal || today()).slice(0, 10);
  const row = db.prepare('SELECT * FROM absensi_guru WHERE jadwal_id=? AND tanggal=?').get(jid, tgl) || null;
  const jadwal = db.prepare('SELECT * FROM jadwal WHERE id=?').get(jid) || {};
  const kelasIds = jadwalKelasIds(jadwal);
  const total = kelasIds.length ? siswaOfKelas(kelasIds).length : 0;
  const sesi = db.prepare('SELECT id FROM absensi_sesi WHERE jadwal_id=? AND tanggal=?').get(jid, tgl);
  const terisi = sesi
    ? db.prepare('SELECT COUNT(*) c FROM absensi_siswa WHERE sesi_id=?').get(Number(sesi.id)).c
    : 0;
  const cfg = jadwalConfig();
  const jurnalTeks = row ? String(row.materi || '').trim() : '';
  const jurnalLengkap = !!row && row.status !== 'hadir'
    ? true                                   // izin/sakit tidak wajib jurnal
    : jurnalTeks.length >= Math.max(4, cfg.jurnalMin);
  return {
    ada: !!row, status: row ? row.status : '',
    absensi_siswa: {
      sesi_id: sesi ? Number(sesi.id) : null,
      total, terisi,
      lengkap: !!sesi && total > 0 && terisi >= total,
      sebagian: terisi > 0 && terisi < total
    },
    jurnal: { teks: jurnalTeks, lengkap: jurnalLengkap, min: cfg.jurnalMin },
    foto: { wajib: !!cfg.fotoWajib, ada: !!(row && row.foto_url) },
    /* alur hanya relevan untuk status hadir (izin/sakit cukup alasan) */
    perlu_absensi_siswa: !!row && row.status === 'hadir',
    selesai: !!row && row.status === 'hadir'
      ? (!cfg.fotoWajib || !!(row.foto_url)) && jurnalLengkap
        && (!!sesi && total > 0 && terisi >= total)
      : !!row
  };
}

/**
 * ALFA OTOMATIS: setiap slot jadwal yang jendela absensinya SUDAH BERAKHIR dan
 * gurunya tidak melakukan Check-in / Sakit / Izin dicatat sebagai `alpha`.
 * Idempoten (unique index jadwal_id+tanggal) sehingga aman dipanggil berkala.
 * Hanya untuk tanggal HARI INI (data hari lalu dibiarkan apa adanya).
 */
function autoAlfaGuru(tanggal) {
  const tgl = String(tanggal || today()).slice(0, 10);
  if (tgl !== today()) return { dibuat: 0, tgl };
  if (String(getSetting('absensi_auto_alpha', '1')) === '0') return { dibuat: 0, tgl, nonaktif: true };
  const cfg = jadwalConfig();
  const hari = hariOf(tgl);
  /* KALENDER AKADEMIK: hari libur / ujian / kegiatan non-KBM → tidak ada ALFA. */
  if (kalenderNonaktif(tgl)) return { dibuat: 0, tgl, libur: true };
  /* TA efektif = pengaturan ta_aktif (sama dengan filters() di server), lalu cari
     TA lain yang punya slot hari ini (sinkronisasi jadwal ↔ absensi). */
  let taId = Number(getSetting('ta_aktif', 0)) || Number((tahunAktif() || {}).id) || 0;
  let slots = jadwalRows(taId).filter(r => Number(r.hari) === hari && Number(r.guru_id) > 0);
  if (!slots.length) {
    for (const t of tahunList()) {
      if (Number(t.id) === Number(taId)) continue;
      const coba = jadwalRows(t.id).filter(r => Number(r.hari) === hari && Number(r.guru_id) > 0);
      if (coba.length) { slots = coba; taId = Number(t.id); break; }
    }
  }
  if (!slots.length) return { dibuat: 0, tgl };
  /* TUKAR JADWAL: slot yang sudah ditukar untuk tanggal ini menjadi tanggung
     jawab guru pengganti — guru asli tidak boleh tercatat ALFA. */
  const tukar = tukarMap(tgl);
  const guruEfektif = (r) => {
    const t = tukar.get(Number(r.id));
    return t ? Number(t.ke_guru) : Number(r.guru_id);
  };
  const kelompok = new Map();
  for (const r of slots) {
    const items = absensiKelompok(r, slots, cfg);
    kelompok.set(items.map(x => Number(x.id)).sort((a, b) => a - b).join(','), items);
  }
  const kini = nowMenit();
  let dibuat = 0, diturunkan = 0;
  db.transaction(() => {
    for (const items of kelompok.values()) {
      const w = absensiWindowKelompok(items, tgl, cfg);
      if (!w.sesi || w.sesi.istirahat || !w.hariOk) continue;
      const tutup = jamMenit(w.tutup);
      if (tutup === null || kini <= tutup) continue;   // jendela masih berjalan / belum mulai
      const ids = items.map(x => Number(x.id));
      const diabaikan = new Set(db.prepare(`SELECT jadwal_id FROM absensi_guru_abaikan
        WHERE tanggal=? AND jadwal_id IN (${ids.map(() => '?').join(',')})`).all(tgl, ...ids)
        .map(row => Number(row.jadwal_id)));
      if (ids.every(id => diabaikan.has(id))) continue;
      const ada = db.prepare(`SELECT jadwal_id FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${ids.map(() => '?').join(',')})`)
        .all(tgl, ...ids);
      if (!ada.length) {
        const validasi = JSON.stringify({
          auto: true, group_ids: ids,
          alasan: 'Tidak ada check-in sampai jam pelajaran berakhir', jendela: w.tutup
        });
        for (const r of items) {
          const r2 = db.prepare(`INSERT OR IGNORE INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,foto_url,foto_id,waktu_submit,ip,validasi,created_at,updated_at)
            VALUES(?,?,?,?,'alpha','','Otomatis ALFA — guru tidak melakukan check-in hingga jam pelajaran berakhir',NULL,NULL,?,?,?,?,?)`)
            .run(Number(r.id), tgl, guruEfektif(r), Number(r.ta_id) || taId || 0, now(), 'sistem', validasi, now(), now());
          if (r2.changes) dibuat++;
        }
      }
    }
    /* SANKSI ALFA: check-in HADIR tetapi absensi siswa / jurnal belum selesai hingga
       jam pelajaran berakhir → status diturunkan menjadi alpha (terkunci). */
    for (const items of kelompok.values()) {
      const ids = items.map(x => Number(x.id));
      const rows = db.prepare(`SELECT * FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${ids.map(() => '?').join(',')})`)
        .all(tgl, ...ids);
      if (!rows.some(row => row.status === 'hadir') || rows.every(row => String(row.validasi || '').includes('"auto":true'))) continue;
      const alurList = items.map(r => absensiAlur(r.id, tgl));
      if (alurList.every(alur => alur.selesai)) continue;
      const w = absensiWindowKelompok(items, tgl, cfg);
      const tutup = w.tutup ? jamMenit(w.tutup) : null;
      if (tutup === null || kini <= tutup) continue;
      const kurang = [];
      const siswaKurang = alurList.filter(alur => alur.perlu_absensi_siswa && !alur.absensi_siswa.lengkap);
      if (siswaKurang.length) {
        kurang.push(`absensi siswa pada ${siswaKurang.length} jam belum lengkap`);
      }
      if (alurList.some(alur => !alur.jurnal.lengkap)) kurang.push('jurnal mengajar');
      if (alurList.some(alur => alur.foto.wajib && !alur.foto.ada)) kurang.push('foto bukti');
      const validasi = JSON.stringify({
        auto: true, group_ids: ids,
        alasan: 'Alur absensi tidak diselesaikan sampai jam pelajaran berakhir',
        kurang, jendela: w.tutup, checkin: (rows.find(row => row.status === 'hadir') || {}).waktu_submit || ''
      });
      for (const row of rows.filter(x => x.status === 'hadir')) {
        db.prepare(`UPDATE absensi_guru SET status='alpha', catatan=?, validasi=?, updated_at=? WHERE id=?`)
          .run(`Otomatis ALFA — belum menyelesaikan ${kurang.join(', ')} hingga jam pelajaran berakhir`,
            validasi, now(), row.id);
        diturunkan++;
      }
    }
  })();
  return { dibuat, diturunkan, tgl };
}

/** rekap kehadiran guru mengajar pada satu tanggal */
function absensiGuruRekap(tanggal, taId) {
  const tgl = String(tanggal || today()).slice(0, 10);
  const hari = hariOf(tgl);
  const cfg = jadwalConfig();
  const slots = jadwalRows(taId).filter(r => Number(r.hari) === hari);
  const abs = db.prepare('SELECT * FROM absensi_guru WHERE tanggal=? AND ta_id=?')
    .all(tgl, Number(taId) || 0);
  const absMap = new Map(abs.map(a => [Number(a.jadwal_id), a]));
  const diabaikan = new Set(db.prepare('SELECT jadwal_id FROM absensi_guru_abaikan WHERE tanggal=?').all(tgl)
    .map(row => Number(row.jadwal_id)));
  const tukar = tukarMap(tgl);
  const guru = new Map();
  for (const mapelHari of absensiMapelHari(slots, tukar)) {
    const group = mapelHari.rows;
    const s = group[0];
    const ids = group.map(x => Number(x.id));
    const t = tukar.get(Number(s.id));
    const gid = mapelHari.guru_id;
    const penugasanPengganti = group.some(slot => {
      const assignment = tukar.get(Number(slot.id));
      return assignment && String(assignment.jenis || '') === 'penugasan'
        && Number(assignment.ke_guru) === Number(gid);
    });
    if (!gid) continue;
    const key = gid;
    const guruNama = t ? t.ke_nama : (s.guru_nama || ('Guru #' + gid));
    const guruNip = t ? t.ke_nip : s.guru_nip;
    const entry = guru.get(key) || {
      guru_id: gid, nama: guruNama || ('Guru #' + gid), nip: guruNip || '',
      jadwal: 0, hadir: 0, izin: 0, sakit: 0, alpha: 0, belum: 0, slots: []
    };
    const absGroup = ids.map(id => absMap.get(id)).filter(Boolean);
    if (!absGroup.length && ids.every(id => diabaikan.has(id))) continue;
    entry.jadwal++;
    const a = absGroup[0] || null;
    const w = absensiWindowKelompok(group, tgl, cfg);
    let status = '';
    if (absGroup.length) {
      status = ['alpha', 'izin', 'sakit', 'hadir'].find(x => absGroup.some(row => row.status === x)) || 'hadir';
    } else if (w.aktif) status = 'belum';
    else if (w.tutup && nowMenit() > jamMenit(w.tutup)) status = 'alpha';
    else status = 'belum';
    const mapelId = mapelHari.mapel_id;
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(mapelId) || {};
    const waktu = absensiRentangSesi(group, cfg);
    entry[status] = (entry[status] || 0) + 1;
    entry.slots.push({
      jadwal_id: s.id, jadwal_ids: ids, mapel_id: mapelId,
      mapel: penugasanPengganti ? '' : (mapel.nama || s.mapel_nama), penugasan_pengganti: penugasanPengganti,
      kelas: s.kelas_nama, sesi: group[0].sesi,
      label_sesi: waktu.label_sesi, jam: waktu.jam,
      status, absensi_id: a ? a.id : null, waktu_submit: a ? a.waktu_submit : '',
      guru_asli: t ? (s.guru_nama || '') : '', tukar: !!t
    });
    guru.set(key, entry);
  }
  const rows = [...guru.values()].map(g => {
    let ringkas = 'Belum Absen';
    if (g.jadwal && g.hadir === g.jadwal) ringkas = 'Hadir';
    else if (g.sakit) ringkas = 'Sakit';
    else if (g.izin) ringkas = 'Izin';
    else if (g.alpha) ringkas = 'Alpha';
    else if (g.hadir) ringkas = 'Sebagian';
    return { ...g, ringkas };
  }).sort((a, b) => a.nama.localeCompare(b.nama));
  const hitung = { hadir: 0, izin: 0, sakit: 0, alpha: 0, belum: 0, sebagian: 0 };
  for (const g of rows) {
    if (g.ringkas === 'Hadir') hitung.hadir++;
    else if (g.ringkas === 'Izin') hitung.izin++;
    else if (g.ringkas === 'Sakit') hitung.sakit++;
    else if (g.ringkas === 'Alpha') hitung.alpha++;
    else if (g.ringkas === 'Sebagian') hitung.sebagian++;
    else hitung.belum++;
  }
  return {
    tanggal: tgl, hari, tanggal_label: tanggalPanjang(tgl),
    jadwal: rows.reduce((total, row) => total + row.jadwal, 0), guru: rows.length, rows, hitung,
    belum_absen: rows.filter(g => g.ringkas !== 'Hadir'),
    sesi: sesiOfHari(cfg, hari)
  };
}
/** susun teks WhatsApp rekap absensi guru */
function absensiWaText(rekap, opts = {}) {
  const st = allSettings();
  const lines = [];
  lines.push('*REKAP ABSENSI GURU MENGAJAR*');
  lines.push(st.sekolah_nama || '');
  lines.push(rekap.tanggal_label || tanggalPanjang(rekap.tanggal));
  lines.push('');
  lines.push(`Total guru mengajar: ${rekap.guru} orang · ${rekap.jadwal} mapel/hari`);
  lines.push(`Hadir: ${rekap.hitung.hadir} · Izin: ${rekap.hitung.izin} · Sakit: ${rekap.hitung.sakit} · Alpha/Belum Absen: ${rekap.hitung.alpha + rekap.hitung.belum + rekap.hitung.sebagian}`);
  lines.push('');
  if (rekap.rows.length) {
    lines.push('Daftar guru:');
    rekap.rows.forEach((g, i) => {
      lines.push(`${i + 1}. ${g.nama} — ${g.ringkas} (${g.hadir}/${g.jadwal} mapel/hari)`);
    });
  } else {
    lines.push('Tidak ada jadwal mengajar pada hari ini.');
  }
  lines.push('');
  lines.push(opts.catatan || 'Mohon tindak lanjut guru yang belum mengisi absensi.');
  lines.push(`— ${st.app_nama || 'Aplikasi Sekolah'} (otomatis)`);
  return lines.join('\n');
}
/** bersihkan bukti foto absensi yang melewati masa simpan (default 90 hari) */
function absensiPurgeFoto(hari) {
  const batasHari = Math.max(1, Number(hari) || jadwalConfig().fotoHari);
  const cut = new Date(Date.now() - batasHari * 86400000);
  const cutStr = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')} 23:59:59`;
  let hapus = 0;
  const rows = db.prepare(`SELECT id, ref_id FROM uploads WHERE jenis='absensi' AND created_at < ?`).all(cutStr);
  if (!rows.length) return { hapus: 0 };
  const ids = rows.map(r => Number(r.id));
  try {
    for (const r of rows) {
      db.prepare("UPDATE absensi_guru SET foto_url='' WHERE id=?").run(Number(r.ref_id) || 0);
    }
    const r = uploadDelete(ids);
    hapus = r.dihapus;
  } catch (e) { hapus = 0; }
  return { hapus, hari: batasHari };
}
/** sesi presensi siswa berdasarkan token publik */
function absensiSesiByToken(token) {
  const tok = String(token || '').trim();
  if (!tok) return null;
  const s = db.prepare('SELECT * FROM absensi_sesi WHERE token=?').get(tok);
  if (!s) return null;
  const j = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(s.jadwal_id));
  if (!j) return null;
  const mapel = db.prepare('SELECT * FROM mapel WHERE id=?').get(Number(s.mapel_id));
  const guru = db.prepare('SELECT id,nama,nip FROM users WHERE id=?').get(Number(s.guru_id));
  return { sesi: s, jadwal: j, mapel, guru, kelas_ids: jadwalKelasIds(s) };
}
/** siswa dalam satu/beberapa kelas, urut nama */
function siswaOfKelas(kelasIds) {
  const ids = (Array.isArray(kelasIds) ? kelasIds : []).map(Number).filter(Boolean);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`SELECT s.id, s.nama, s.nis, s.nisn, s.kelas_id, k.nama AS kelas_nama, s.gender
    FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
    WHERE s.kelas_id IN (${ph}) AND COALESCE(s.status,'aktif')='aktif'
    ORDER BY k.nama, s.nama`).all(...ids);
}


/** buka (atau buat) DB sekolah lengkap dengan skema + data awal, lalu kembalikan path */
function ensureTenantDb(file) {
  const conn = rawConn(file);
  migrateConn(conn);
  als.run({ db: conn }, () => {
    applySchema(conn);
    runMigrations();
    seed();
    trashPurge();
  });
  return file;
}
function closeTenantDb(file) {
  const conn = CONNS.get(file);
  if (!conn) return false;
  try { conn.close(); } catch (e) { /* abaikan */ }
  CONNS.delete(file);
  /* buang penanda migrasi: berkas yang dibuka kembali harus diverifikasi ulang
     (mis. setelah restore backup / penambahan kolom dari proses lain). */
  try { MIGRATED_CONNS.delete(String(file)); } catch (e) { /* abaikan */ }
  return true;
}
function dbSizeOf(file) {
  let total = 0;
  for (const f of [file, file + '-wal', file + '-shm']) {
    try { if (fs.existsSync(f)) total += fs.statSync(f).size; } catch (e) { /* abaikan */ }
  }
  return total;
}

module.exports = {
  db, DB_PATH, lib, now, today,
  useTenant, ensureTenantDb, closeTenantDb, dbSizeOf, currentPath,
  JENJANG, JENJANG_LABEL, TINGKAT_PER_JENJANG, ACCOUNT_FEATURES, OPEN_WRITE_FEATURES,
  kelasDefaultForJenjang, tingkatAkhirOf, romanOf,
  ROLES, ROLE_LABEL, FEATURES, ACTIONS, ACTION_LABEL, TINGKAT, SEMESTER,
  userRoleList, roleLabelOf, permsFor, seedPermissions,
  HARI_LABEL, DEFAULT_HARI, DEFAULT_SESI, ABSENSI_SISWA_STATUS, ABSENSI_GURU_STATUS,
  jamMenit, menitJam, nowMenit, hariOf, tanggalPanjang, jadwalConfig, jadwalDesain, jadwalTampil, normSesi, sesiBernomor, sesiHariMap, sesiOfHari, mapelList,
  jadwalRows, jadwalKelasIds, jadwalConflict, absensiWindow, absensiKelompok, absensiMapelHari, absensiWindowKelompok, absensiRentangSesi,
  absensiGuruOf, absensiGuruRekap, autoAlfaGuru, absensiAlur,
  targetJamConfig, kelasTargetJam, bebanKelas, targetKelasRows,
  guruTargetMap, guruTargetRows, guruTargetSave, hariEfektifBulan,
  /* ---- AI TIMETABLE GENERATOR ---- */
  JADWAL_AI_SCHEMA_SQL, JADWAL_AI_ATURAN_DEFAULT, jadwalAiConfig, jadwalAiConfigSave,
  jadwalBebanRows, jadwalBebanSave, jadwalGuruBatasRows, jadwalGuruBatasSave,
  jadwalRuangRows, jadwalRuangSave, jadwalRuangDelete, jadwalRuangPilih,
  KALENDER_KATEGORI, KALENDER_KATEGORI_LABEL, kalenderRows, kalenderMap, kalenderOfDate,
  kalenderNonaktif, kalenderSave, kalenderDelete, KURIKULUM_SCHEMA_SQL,
  KALENDER_WARNA_DEFAULT, kalenderWarna, kalenderSemester, kalenderSemesterOf, kalenderRentang,
  tukarOf, tukarAktif, tukarMap, tukarGuruEfektif, tukarMasuk, tukarKeluar, TUKAR_SCHEMA_SQL,
  pencatatOf, pencatatSudah, pencatatAdd, PENCATAT_SCHEMA_SQL, IZIN_SCHEMA_SQL,
  waFill, waTemplateAlfa, waTemplateIzin, waLogAdd, waSudahKirim,
  BOTTOM_NAV_DEFAULT, BOTTOM_NAV_MAX, bottomNavConfig, bottomNavFor, setBottomNav,
  absensiWaText, absensiPurgeFoto, absensiSesiByToken, siswaOfKelas,
  DEFAULT_STATUS, DEFAULT_NAV, DEFAULT_PERMS, HARI, TL_JENIS, TL_STATUS, LOKASI_DEFAULT, SANKSI_DEFAULT,
  getSetting, setSetting, allSettings, setAppNamaGlobal, jsonSetting, statusRules, diniConfig, formConfig, navConfig, statusOf,
  lokasiList, sanksiRules, sanksiOf, jurnalConfig, tindakLanjutRows, tindakLanjutStats, jurnalRows, polaPelanggaran,
  waConfig, waLastMap, waLockOf, waMessage, waSend, waJadwalConfig,
  waTemplateJadwalIngat, waTemplateJadwalTelat, waTemplateJadwalTelatAtasan,
  FEEDBACK_JENIS, FEEDBACK_STATUS, feedbackAdd, feedbackRows, feedbackStats, riwayatAktivitas,
  userByUsername, userById, can, permissionMatrix, setPermission, logAudit,
  tahunList, tahunAktif, tahunById, tahunDampak, tahunDelete,
  TINGKAT_MODE, jenjangAktif, tingkatConfig, tingkatList, tingkatIndex, tingkatAkhir, isTingkatAkhir,
  parseTingkatList, gantiTingkatNama, terapkanTingkatKelas, angkaTingkat, formatTingkat,
  kelasOfTa, kelasAll, adopsiKelasTanpaTa, siswaKelasSet, siswaKelasRiwayat,
  kenaikanPreview, kenaikanKelas, salinKelasTa,
  kelasList, waliUsers, kategoriList, siswaRows, siswaById, decorate, recentPoints,
  kejadianList, kejadianSummary, nextNomor, scopeWali,
  TRASH_DAYS, TRASH_TABEL, trashAdd, trashList, trashCount, trashRestore, trashPurgeHabis, trashPurge,
  ORPHAN_CHECKS, orphanData, orphanDelete,
  BACKUP_TABLES, dumpAll, restoreAll, snapshotFile, snapshotJson,
  RESET_SCOPE, resetPreview, resetTa,
  kalenderData, demoStats, seedDemo,
  sessionSave, sessionGet, sessionDelete, sessionPurge, sessionList,
  uploadAdd, uploadList, uploadById, uploadDelete, storageInfo,
  /* modul BK & otomatisasi poin absensi */
  BK_KATEGORI, BK_JENIS_DEFAULT, ADUAN_JENIS, ADUAN_STATUS, ASESMEN_KATEGORI, ASESMEN_DEFAULT,
  kategoriAuto, absensiPoinConfig, absensiPoinSync, semesterOf, seedFiturBaru
};
