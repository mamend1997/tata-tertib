'use strict';
/* =====================================================================
   SAAS PLATFORM — panel Super Admin (multi-tenant)
   =====================================================================
   Control plane terpisah dari database sekolah:
     data/saas.sqlite            → tenants, paket, tagihan, tiket, audit, sesi, dll.
     data/sekolah/<kode>-<slug>.sqlite → database operasional tiap sekolah

   Semua fungsi di sini HANYA menyentuh control plane, kecuali yang secara
   eksplisit membuka database sekolah (createTenant, resetPassword, dll).
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const Database = require('better-sqlite3');
const lib = require('./lib');
const payment = require('./payment');
const telegramBackup = require('./telegram-backup');

const DATA_DIR = path.join(__dirname, 'data');
/* Bila DB sekolah utama diarahkan ke tempat lain (mis. saat pengujian memakai
   DB_PATH sementara), control plane & folder database sekolah ikut diarahkan
   ke folder yang sama supaya TIDAK menyentuh data produksi. */
const BASE_DIR = process.env.SAAS_DB_PATH ? path.dirname(process.env.SAAS_DB_PATH)
  : (process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? path.dirname(process.env.DB_PATH)
    : (process.env.RAILWAY_VOLUME_MOUNT_PATH || DATA_DIR));
const SEKOLAH_DIR = path.join(BASE_DIR, 'sekolah');
if (!fs.existsSync(SEKOLAH_DIR)) fs.mkdirSync(SEKOLAH_DIR, { recursive: true });
const SAAS_DB = process.env.SAAS_DB_PATH || path.join(BASE_DIR, 'saas.sqlite');
if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

const sdb = new Database(SAAS_DB);
sdb.pragma('journal_mode = WAL');
sdb.pragma('busy_timeout = 5000');
sdb.pragma('synchronous = NORMAL');

const now = () => lib.nowStamp();
const today = () => lib.todayISO();
const clean = v => String(v === null || v === undefined ? '' : v).trim();

sdb.exec(`
CREATE TABLE IF NOT EXISTS saas_settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS saas_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  pass_hash TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1,
  terakhir_masuk TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  slug TEXT,
  jenjang TEXT DEFAULT 'SMK',
  alamat TEXT,
  kepala TEXT,
  kontak_nama TEXT,
  telp TEXT,
  email_admin TEXT,
  paket TEXT DEFAULT 'basic',
  status TEXT NOT NULL DEFAULT 'trial',
  lifetime INTEGER NOT NULL DEFAULT 0,
  trial_berakhir TEXT,
  aktif_sampai TEXT,
  custom_domain TEXT,
  domain_status TEXT DEFAULT '',
  domain_cek_at TEXT,
  portal_aktif INTEGER NOT NULL DEFAULT 1,
  portal_slug TEXT,                                  -- slug publik portal siswa: /<slug>/portal-siswa
  db_file TEXT NOT NULL,
  catatan TEXT,
  fitur_override TEXT,
  created_at TEXT,
  updated_at TEXT,
  terakhir_masuk TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_domain ON tenants(custom_domain);

CREATE TABLE IF NOT EXISTS saas_paket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  harga_bulanan INTEGER NOT NULL DEFAULT 0,
  harga_tahunan INTEGER NOT NULL DEFAULT 0,
  deskripsi TEXT,
  trial_hari INTEGER NOT NULL DEFAULT 0,
  fitur TEXT DEFAULT '[]',
  aktif INTEGER NOT NULL DEFAULT 1,
  urutan INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saas_tagihan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  periode TEXT NOT NULL,
  paket TEXT,
  nominal INTEGER NOT NULL DEFAULT 0,
  potongan INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  jatuh_tempo TEXT,
  status TEXT NOT NULL DEFAULT 'menunggu',
  pembayaran_id INTEGER,
  notif_h7 TEXT,
  dibuat TEXT,
  lunas_at TEXT,
  UNIQUE(tenant_id, periode)
);
CREATE INDEX IF NOT EXISTS idx_tagihan_status ON saas_tagihan(status, jatuh_tempo);

CREATE TABLE IF NOT EXISTS saas_pembayaran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  tagihan_id INTEGER,
  paket TEXT,
  bulan INTEGER NOT NULL DEFAULT 1,
  nominal INTEGER NOT NULL DEFAULT 0,
  potongan INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  promo TEXT,
  metode TEXT DEFAULT 'qris',
  bukti_url TEXT,
  catatan TEXT,
  status TEXT NOT NULL DEFAULT 'menunggu',
  oleh_nama TEXT,
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bayar_status ON saas_pembayaran(status, created_at);

CREATE TABLE IF NOT EXISTS saas_tiket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  judul TEXT NOT NULL,
  kategori TEXT DEFAULT 'umum',
  prioritas TEXT DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'baru',
  oleh_nama TEXT,
  dibuat TEXT,
  diperbarui TEXT
);
CREATE TABLE IF NOT EXISTS saas_tiket_pesan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tiket_id INTEGER NOT NULL,
  dari TEXT NOT NULL DEFAULT 'tenant',
  oleh TEXT,
  pesan TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saas_pengumuman (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  isi TEXT,
  tipe TEXT DEFAULT 'info',
  aktif INTEGER NOT NULL DEFAULT 1,
  mulai TEXT,
  selesai TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saas_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oleh TEXT,
  aksi TEXT,
  modul TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_saas_audit_time ON saas_audit(created_at);

CREATE TABLE IF NOT EXISTS saas_wa_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  tujuan TEXT,
  pesan TEXT,
  status TEXT DEFAULT 'pending',
  error TEXT,
  jenis TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saas_panduan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  untuk TEXT NOT NULL DEFAULT 'sekolah',
  judul TEXT NOT NULL,
  tipe TEXT DEFAULT 'youtube',
  url TEXT,
  deskripsi TEXT,
  urutan INTEGER DEFAULT 1,
  aktif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saas_sesi (
  sid TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  user_id INTEGER,
  tenant_id INTEGER,
  created_at TEXT,
  last_seen TEXT,
  expires_at TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS saas_backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis TEXT,
  nama TEXT,
  ukuran INTEGER DEFAULT 0,
  status TEXT DEFAULT 'sukses',
  pesan TEXT,
  pemicu TEXT,
  oleh TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saas_domain_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  domain TEXT,
  status TEXT,
  pesan TEXT,
  created_at TEXT
);

/* log notifikasi webhook payment gateway (deduplikasi berdasarkan id event) */
CREATE TABLE IF NOT EXISTS kasera_event (
  event_id TEXT PRIMARY KEY,
  tipe TEXT, status TEXT, order_id TEXT, jumlah REAL,
  tenant_id INTEGER, sasaran TEXT, hasil TEXT, pesan TEXT,
  diterima_at TEXT, diproses_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kasera_event_waktu ON kasera_event(diterima_at);
`);
if (!sdb.prepare("PRAGMA table_info('saas_admins')").all().some(column => column.name === 'phone')) {
  sdb.exec('ALTER TABLE saas_admins ADD COLUMN phone TEXT');
}

/* ============================ SETTINGS ============================ */
const DEFAULTS = {
  app_nama: 'SMART TATA TERTIB SISWA',
  app_subtitle: 'Sistem Manajemen Kedisiplinan Siswa Multi Sekolah',
  logo: '',
  favicon: '',
  /* ---- halaman login publik (murni branding GLOBAL, bukan data sekolah) ---- */
  login_judul: '',                       // kosong = ikut app_nama
  login_subjudul: '',                    // kosong = ikut app_subtitle
  login_deskripsi: 'Pantau poin pelanggaran dan prestasi siswa, deteksi dini siswa berisiko, ' +
    'cetak laporan serta surat pemanggilan orang tua — semuanya dalam satu dashboard yang rapi.',
  login_footer: '',                      // teks kiri bawah (kosong = domain platform)
  login_copyright: '',                   // kosong = "© <tahun> <app_nama>"
  login_logo: '',                        // logo khusus halaman login (kosong = logo platform)
  branding_version: '',                  // penanda versi branding (cache busting favicon/title)
  /* ---- anti-spam pendaftaran mandiri ---- */
  recaptcha_site: '',
  recaptcha_secret: '',
  daftar_limit_jam: '5',
  daftar_limit_hari: '20',
  daftar_min_detik: '4',
  daftar_otp_aktif: '1',
  trial_hari: '7',
  paket_default: 'basic',
  domain_info: 'tata-tertib.vibecoder.co.id',
  subdomain_info: 'sekolah.tertib.id',
  server_info: 'VPS Indonesia · Node.js + SQLite',
  /* QRIS & harga */
  qris_img: '',
  rek_nama: '',
  rek_nomor: '',
  instruksi_bayar: 'Pindai QRIS di atas lalu unggah bukti transfer pada menu perpanjangan. Verifikasi maksimal 1×24 jam kerja.',
  harga_bulanan: '50000',
  harga_tahunan: '500000',
  /* ---- metode pembayaran hybrid (QRIS otomatis vs manual) ---- */
  pay_gateway_aktif: '0',
  pay_manual_aktif: '1',
  pay_gateway_provider: 'sandbox',
  pay_gateway_mode: 'sandbox',
  pay_gateway_merchant: '',
  pay_gateway_key: '',
  pay_gateway_key2: '',
  pay_gateway_callback: '',
  pay_gateway_expire_menit: '60',
  promo_list: '[]',
  layanan_nama: '',
  /* legal */
  tos_judul: 'Syarat & Ketentuan Layanan',
  tos_isi: '',
  sla_judul: 'Service Level Agreement (SLA)',
  sla_isi: '',
  legal_updated: '',
  /* operasional */
  maintenance_aktif: '0',
  maintenance_pesan: 'Sistem sedang dalam pemeliharaan. Silakan coba beberapa saat lagi.',
  wa_aktif: '0',
  wa_api_url: '',
  wa_api_token: '',
  wa_payload: '{"target":"{phone}","message":"{pesan}"}',
  telegram_bot_token: '',
  telegram_chat_id: '',
  telegram_auto: '1',
  telegram_jam: '02:00',
  telegram_terakhir: '',
  menu_default: '',
  pendaftaran_aktif: '1',
  max_sekolah: '0'
};
function setting(key, fallback) {
  const r = sdb.prepare('SELECT value FROM saas_settings WHERE key=?').get(key);
  if (r && r.value !== null && r.value !== undefined) return r.value;
  if (fallback !== undefined) return fallback;
  return DEFAULTS[key] !== undefined ? DEFAULTS[key] : '';
}
let brandCache = null;
function setSetting(key, value) {
  sdb.prepare('INSERT INTO saas_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value === null || value === undefined ? '' : String(value));
  brandCache = null;   // branding() dipakai setiap allSettings() → jaga tetap segar
}
function settings() {
  const out = { ...DEFAULTS };
  for (const r of sdb.prepare('SELECT key,value FROM saas_settings').all()) out[r.key] = r.value;
  return out;
}
function assistantConfig() {
  const envKey = clean(process.env.EDUPOIN_AI_API_KEY);
  const storedKey = clean(setting('edupoin_ai_api_key'));
  const envFallbackKey = clean(process.env.EDUPOIN_AI_FALLBACK_API_KEY);
  const storedFallbackKey = clean(setting('edupoin_ai_fallback_api_key'));
  return {
    apiKey: envKey || storedKey,
    envKeySet: !!envKey,
    storedKeySet: !!storedKey,
    apiKeySource: envKey ? 'environment' : (storedKey ? 'super_admin' : ''),
    baseUrl: clean(process.env.EDUPOIN_AI_BASE_URL || setting('edupoin_ai_base_url')) || 'https://api.openai.com/v1',
    model: clean(process.env.EDUPOIN_AI_MODEL || setting('edupoin_ai_model')) || 'gpt-4o-mini',
    fallbackApiKey: envFallbackKey || storedFallbackKey,
    fallbackEnvKeySet: !!envFallbackKey,
    fallbackStoredKeySet: !!storedFallbackKey,
    fallbackApiKeySource: envFallbackKey ? 'environment' : (storedFallbackKey ? 'super_admin' : ''),
    fallbackBaseUrl: clean(process.env.EDUPOIN_AI_FALLBACK_BASE_URL || setting('edupoin_ai_fallback_base_url'))
      || 'https://api.groq.com/openai/v1',
    fallbackModel: clean(process.env.EDUPOIN_AI_FALLBACK_MODEL || setting('edupoin_ai_fallback_model'))
      || 'llama-3.3-70b-versatile'
  };
}
/** penanda versi branding — dipakai untuk cache-busting favicon & judul tab */
function brandingVersion() {
  return String(setting('branding_version', '') || '') || '1';
}
/** dipanggil setiap Branding Sistem disimpan (termasuk logo/favicon/teks login) */
function bumpBranding() {
  const v = Date.now().toString(36);
  setSetting('branding_version', v);
  return v;
}
/** sakelar boolean toleran: '1' | 'true' | 'on' | 'ya' | true → aktif
    (nilai lama dari formulir pernah tersimpan sebagai string "true"/"false") */
function isOn(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'ya' || s === 'yes';
}
const BRAND_TTL_MS = 1500;
function clearBrandCache() { brandCache = null; }
function branding() {
  /* memo singkat (TTL 1,5 detik), dibatalkan setiap setSetting() sehingga perubahan
     Branding Sistem langsung terpakai, tanpa query berulang di setiap halaman.
     TTL juga menyembuhkan perubahan yang ditulis dari luar proses ini
     (mis. pemulihan database lewat panel Super Admin). */
  if (brandCache && (Date.now() - brandCache.__at) < BRAND_TTL_MS) return brandCache;
  const s = settings();
  const appNama = s.app_nama || DEFAULTS.app_nama;
  const appSub = s.app_subtitle || DEFAULTS.app_subtitle;
  const out = {
    app_nama: appNama, app_subtitle: appSub, logo: s.logo, favicon: s.favicon,
    layanan_nama: s.layanan_nama || appNama, domain: s.domain_info, subdomain: s.subdomain_info,
    server: s.server_info, trial_hari: Number(s.trial_hari) || 7,
    maintenance: isOn(s.maintenance_aktif), maintenance_pesan: s.maintenance_pesan,
    pendaftaran_aktif: isOn(s.pendaftaran_aktif),
    harga_bulanan: Number(s.harga_bulanan) || 0, harga_tahunan: Number(s.harga_tahunan) || 0,
    qris_img: s.qris_img, rek_nama: s.rek_nama, rek_nomor: s.rek_nomor, instruksi: s.instruksi_bayar,
    /* halaman login publik — SELALU dari branding global, bukan data sekolah */
    login_judul: s.login_judul || appNama,
    login_subjudul: s.login_subjudul || appSub,
    login_deskripsi: s.login_deskripsi || DEFAULTS.login_deskripsi,
    login_footer: s.login_footer || '',
    login_copyright: s.login_copyright || '',
    login_logo: s.login_logo || s.logo || '',
    version: brandingVersion(),
    /* anti-spam pendaftaran */
    recaptcha_site: s.recaptcha_site || '',
    daftar_min_detik: Math.max(0, Number(s.daftar_min_detik) || 0),
    daftar_limit_jam: Math.max(1, Number(s.daftar_limit_jam) || 5),
    daftar_limit_hari: Math.max(1, Number(s.daftar_limit_hari) || 20),
    daftar_otp_aktif: isOn(s.daftar_otp_aktif),
    assistant_widget_enabled: isOn(
      s.assistant_widget_enabled === undefined ? '1' : s.assistant_widget_enabled
    )
  };
  Object.defineProperty(out, '__at', { value: Date.now(), enumerable: false });
  brandCache = out;
  return out;
}
function promos() {
  try {
    const arr = JSON.parse(setting('promo_list', '[]'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function promoFind(kode) {
  const k = clean(kode).toUpperCase();
  if (!k) return null;
  return promos().find(p => clean(p.kode).toUpperCase() === k && Number(p.persen) > 0) || null;
}

/* ============================ AUDIT ============================ */
function logAudit(oleh, aksi, modul, detail, ip) {
  try {
    sdb.prepare('INSERT INTO saas_audit(oleh,aksi,modul,detail,ip,created_at) VALUES(?,?,?,?,?,?)')
      .run(clean(oleh) || 'Super Admin', aksi, modul, clean(detail), clean(ip), now());
  } catch (e) { /* abaikan */ }
}
function auditList(q = {}) {
  const where = [], args = [];
  if (q.q) {
    where.push('(lower(aksi) LIKE ? OR lower(modul) LIKE ? OR lower(COALESCE(detail,\'\')) LIKE ? OR lower(COALESCE(oleh,\'\')) LIKE ?)');
    const l = '%' + clean(q.q).toLowerCase() + '%';
    args.push(l, l, l, l);
  }
  if (q.modul) { where.push('modul=?'); args.push(q.modul); }
  const limit = Math.min(1000, Math.max(20, Number(q.limit) || 300));
  const rows = sdb.prepare(`SELECT * FROM saas_audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit);
  const modul = sdb.prepare('SELECT DISTINCT modul FROM saas_audit ORDER BY modul').all().map(r => r.modul);
  return { rows, modul };
}

/* ============================ PAKET ============================ */
const FITUR_ALL = () => (require('./db').FEATURES || []).map(f => f.key);
const PAKET_DEFAULT = [
  {
    kode: 'basic', nama: 'Basic', harga_bulanan: 50000, harga_tahunan: 500000, trial_hari: 7, urutan: 1,
    deskripsi: 'Untuk sekolah kecil — kedisiplinan inti, data siswa, dan laporan dasar.',
    fitur: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'siswa', 'kelas', 'kategori', 'laporan',
      'jadwal', 'desain_jadwal', 'absensi_guru', 'absensi_siswa', 'rekap_absensi_guru', 'rekap_absensi_siswa',
      'bk_layanan', 'asesmen', 'aduan']
  },
  {
    kode: 'premium', nama: 'Premium', harga_bulanan: 100000, harga_tahunan: 1000000, trial_hari: 14, urutan: 2,
    deskripsi: 'Semua modul kedisiplinan, buku penghubung, analitik, kelola berkas, dan portal orang tua.',
    fitur: ['dashboard', 'kejadian', 'kalender', 'deteksi', 'jurnal', 'tindak_lanjut', 'analitik', 'siswa',
      'kelas', 'kategori', 'laporan', 'audit', 'berkas', 'pengguna',
      'jadwal', 'desain_jadwal', 'absensi_guru', 'absensi_siswa', 'rekap_absensi_guru', 'rekap_absensi_siswa',
      'bk_layanan', 'asesmen', 'asesmen_soal', 'aduan']
  },
  {
    kode: 'lifetime', nama: 'Lifetime', harga_bulanan: 0, harga_tahunan: 2500000, trial_hari: 0, urutan: 3,
    deskripsi: 'Sekali bayar, akses seluruh fitur tanpa batas masa aktif.',
    fitur: ['*']
  }
];
function paketList({ aktifOnly } = {}) {
  const rows = sdb.prepare('SELECT * FROM saas_paket ORDER BY urutan, id').all()
    .map(r => ({ ...r, fitur: parseFitur(r.fitur) }));
  return aktifOnly ? rows.filter(r => r.aktif) : rows;
}
function parseFitur(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch (e) { arr = []; } }
  return Array.isArray(arr) ? arr.map(String) : [];
}
function paketByKode(kode) {
  const r = sdb.prepare('SELECT * FROM saas_paket WHERE kode=?').get(clean(kode));
  return r ? { ...r, fitur: parseFitur(r.fitur) } : null;
}
function savePaket(b) {
  const kode = clean(b.kode).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const nama = clean(b.nama);
  if (!kode || !nama) throw new Error('Kode & nama paket wajib diisi.');
  const fitur = Array.isArray(b.fitur) ? b.fitur.map(String) : parseFitur(b.fitur);
  const row = {
    kode, nama,
    harga_bulanan: Math.max(0, Number(b.harga_bulanan) || 0),
    harga_tahunan: Math.max(0, Number(b.harga_tahunan) || 0),
    deskripsi: clean(b.deskripsi),
    trial_hari: Math.max(0, Math.min(365, Number(b.trial_hari) || 0)),
    fitur: JSON.stringify(fitur),
    aktif: b.aktif === false || b.aktif === 0 || b.aktif === '0' ? 0 : 1,
    urutan: Math.max(1, Number(b.urutan) || 1)
  };
  const ada = sdb.prepare('SELECT id FROM saas_paket WHERE kode=?').get(kode);
  if (ada) {
    sdb.prepare(`UPDATE saas_paket SET nama=?,harga_bulanan=?,harga_tahunan=?,deskripsi=?,trial_hari=?,fitur=?,aktif=?,urutan=? WHERE id=?`)
      .run(row.nama, row.harga_bulanan, row.harga_tahunan, row.deskripsi, row.trial_hari, row.fitur, row.aktif, row.urutan, ada.id);
    return { ...row, id: ada.id, created: false };
  }
  const r = sdb.prepare(`INSERT INTO saas_paket(kode,nama,harga_bulanan,harga_tahunan,deskripsi,trial_hari,fitur,aktif,urutan,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(row.kode, row.nama, row.harga_bulanan, row.harga_tahunan, row.deskripsi, row.trial_hari, row.fitur, row.aktif, row.urutan, now());
  return { ...row, id: Number(r.lastInsertRowid), created: true };
}
function deletePaket(kode) {
  const dipakai = sdb.prepare('SELECT COUNT(*) c FROM tenants WHERE paket=?').get(kode).c;
  if (dipakai) throw new Error(`Paket "${kode}" masih dipakai ${dipakai} sekolah — nonaktifkan saja.`);
  sdb.prepare('DELETE FROM saas_paket WHERE kode=?').run(kode);
}
/** daftar fitur efektif sebuah paket (null = semua fitur) */
function fiturPaket(kode) {
  const p = paketByKode(kode);
  if (!p) return null;
  if (p.fitur.includes('*')) return null;
  return p.fitur;
}
function allowedFeatures(tenant) {
  if (!tenant) return null;
  if (tenant.fitur_override) {
    const arr = parseFitur(tenant.fitur_override);
    if (arr.length) return arr;
  }
  if (Number(tenant.lifetime) === 1) return null;
  return fiturPaket(tenant.paket);
}

/* ============================ TENANT ============================ */
function randomKode() {
  for (let i = 0; i < 500; i++) {
    const k = String(crypto.randomInt(1000, 10000));
    if (!sdb.prepare('SELECT 1 FROM tenants WHERE kode=?').get(k)) return k;
  }
  throw new Error('Gagal membuat kode sekolah unik. Coba lagi.');
}
function slugify(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sekolah';
}
function uniqueSlug(base, exceptId) {
  let slug = slugify(base);
  let n = 1;
  while (true) {
    const row = sdb.prepare('SELECT id FROM tenants WHERE slug=?').get(slug);
    if (!row || Number(row.id) === Number(exceptId)) return slug;
    n++;
    slug = slugify(base) + '-' + n;
  }
}
/* ==================== SLUG PORTAL PUBLIK SISWA ====================
   Format URL portal: /<slug-sekolah>/portal-siswa
   - slug disimpan di tenants.portal_slug (diisi otomatis dari nama sekolah)
   - boleh diubah Super Admin (menu detail sekolah) maupun admin sekolah (Pengaturan)
   - slug lama "/portal" TIDAK dipakai lagi (404)                                   */
const PORTAL_SUFIX = 'portal-siswa';
/** kata yang tidak boleh dipakai sebagai slug portal (jalur aplikasi / API) */
const RESERVED_PORTAL_SLUGS = new Set([
  'portal', 'portals', 'portal-siswa', 'super-admin', 'admin', 'api', 'assets', 'daftar',
  'login', 'logout', 'favicon.ico', 'favicon.svg', 'favicon.png', 'files', 'media',
  'public', 'static', 'app', 'dashboard', 'sekolah', 'tata-tertib'
]);
function slugIsReserved(slug) {
  const s = clean(slug).toLowerCase();
  return RESERVED_PORTAL_SLUGS.has(s) || s.startsWith('api-');
}
/** validasi slug portal; mengembalikan pesan kesalahan atau '' bila sah */
function portalSlugError(raw, exceptId) {
  const slug = clean(raw).toLowerCase();
  if (!slug) return 'Slug portal wajib diisi.';
  if (slug.length < 3) return 'Slug portal minimal 3 karakter.';
  if (slug.length > 40) return 'Slug portal maksimal 40 karakter.';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return 'Slug portal hanya boleh huruf kecil, angka, dan tanda hubung (tanpa spasi).';
  }
  if (/--/.test(slug)) return 'Slug portal tidak boleh memuat dua tanda hubung berturut-turut.';
  if (slugIsReserved(slug)) return `"${slug}" dipakai jalur aplikasi — pilih slug lain.`;
  const kembar = sdb.prepare(
    "SELECT id,nama FROM tenants WHERE lower(COALESCE(portal_slug, ''))=lower(?) " +
    "OR ((portal_slug IS NULL OR portal_slug='') AND lower(COALESCE(slug,''))=lower(?))"
  ).get(slug, slug);
  if (kembar && Number(kembar.id) !== Number(exceptId || 0)) {
    return `Slug "${slug}" sudah dipakai sekolah lain (${kembar.nama}).`;
  }
  return '';
}
/** slug portal efektif sebuah tenant (fallback: slug lama → nama sekolah) */
function portalSlugOf(t) {
  if (!t) return '';
  return clean(t.portal_slug) || clean(t.slug) || slugify(t.nama);
}
/** slug unik untuk tenant baru, menghindari kata terlarang & benturan */
function uniquePortalSlug(base, exceptId) {
  const dasar = slugify(base);
  let slug = slugIsReserved(dasar) ? dasar + '-sekolah' : dasar;
  let n = 1;
  while (portalSlugError(slug, exceptId)) {
    n++;
    slug = slugify(dasar) + '-' + n;
    if (n > 500) { slug = slugify(dasar) + '-' + crypto.randomInt(100, 999); break; }
  }
  return slug;
}
/** ubah slug portal sebuah tenant (dipakai Super Admin & admin sekolah) */
function setPortalSlug(id, raw, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const slug = clean(raw).toLowerCase();
  const err = portalSlugError(slug, t.id);
  if (err) throw new Error(err);
  sdb.prepare('UPDATE tenants SET portal_slug=?, updated_at=? WHERE id=?').run(slug, now(), t.id);
  logAudit(oleh || 'Sistem', 'UBAH SLUG PORTAL', 'sekolah',
    `${t.nama} (${t.kode}) → /${slug}/${PORTAL_SUFIX}`);
  return decorateTenant(tenantById(t.id));
}
/** tenant berdasarkan slug portal (portal publik) */
function tenantByPortalSlug(slug) {
  const s = clean(slug).toLowerCase();
  if (!s) return null;
  return sdb.prepare(
    "SELECT * FROM tenants WHERE lower(COALESCE(portal_slug, ''))=? " +
    "OR ((portal_slug IS NULL OR portal_slug='') AND lower(COALESCE(slug,''))=?) ORDER BY id LIMIT 1"
  ).get(s, s) || null;
}
/** path publik portal siswa sebuah tenant, mis. /smk-pgri-cikoneng/portal-siswa */
function portalPathOf(t) {
  const slug = portalSlugOf(t);
  return slug ? '/' + slug + '/' + PORTAL_SUFIX : '';
}

/** path absolut berkas DB sekolah (tahan terhadap perubahan folder kerja) */
const absDb = t => path.resolve(__dirname, typeof t === 'string' ? t : t.db_file);
const tenantById = id => sdb.prepare('SELECT * FROM tenants WHERE id=?').get(Number(id)) || null;
/** sekolah utama = tenant yang memakai berkas database aplikasi (DB_PATH) */
function tenantUtama() {
  try {
    const rel = path.relative(__dirname, require('./db').DB_PATH).split(path.sep).join('/');
    return sdb.prepare('SELECT * FROM tenants WHERE db_file=?').get(rel)
      || sdb.prepare("SELECT * FROM tenants WHERE status<>'nonaktif' ORDER BY id LIMIT 1").get() || null;
  } catch (e) { return null; }
}
const tenantByKode = kode => sdb.prepare('SELECT * FROM tenants WHERE kode=?').get(clean(kode)) || null;
const tenantBySlug = slug => sdb.prepare('SELECT * FROM tenants WHERE slug=?').get(clean(slug)) || null;
const tenantByDomain = host => {
  const h = clean(host).toLowerCase().replace(/^www\./, '').split(':')[0];
  if (!h) return null;
  return sdb.prepare('SELECT * FROM tenants WHERE lower(COALESCE(custom_domain,\'\'))=?').get(h) || null;
};
function tenants(q = {}) {
  const where = [], args = [];
  if (q.status) { where.push('status=?'); args.push(q.status); }
  if (q.paket) { where.push('paket=?'); args.push(q.paket); }
  if (q.q) {
    where.push('(lower(nama) LIKE ? OR kode LIKE ? OR lower(COALESCE(email_admin,\'\')) LIKE ? OR lower(COALESCE(custom_domain,\'\')) LIKE ?)');
    const l = '%' + clean(q.q).toLowerCase() + '%';
    args.push(l, l, l, l);
  }
  const rows = sdb.prepare(`SELECT * FROM tenants ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`).all(...args);
  return rows.map(t => decorateTenant(t));
}
function decorateTenant(t) {
  if (!t) return null;
  const paket = paketByKode(t.paket);
  const expired = t.aktif_sampai ? t.aktif_sampai < today() : false;
  return {
    ...t,
    paket_nama: (paket && paket.nama) || t.paket || '-',
    lifetime: Number(t.lifetime) === 1,
    expired: Number(t.lifetime) === 1 ? false : expired,
    status_label: statusTenantLabel(t),
    fitur: allowedFeatures(t),
    portal_slug: portalSlugOf(t),
    portal_path: portalPathOf(t),
    harga_bulanan_efektif: hargaTenant(t, 1),
    harga_tahunan_efektif: hargaTenant(t, 12),
    db_size: (() => { try { return require('./db').dbSizeOf(absDb(t)); } catch (e) { return 0; } })()
  };
}
function statusTenantLabel(t) {
  if (Number(t.lifetime) === 1) return 'Lifetime';
  if (t.status === 'ditangguhkan') return 'Ditangguhkan';
  if (t.status === 'trial') return 'Uji Coba';
  if (t.aktif_sampai && t.aktif_sampai < today()) return 'Kedaluwarsa';
  return 'Aktif';
}
function tenantStats() {
  const all = sdb.prepare('SELECT * FROM tenants').all();
  const aktif = all.filter(t => t.status === 'aktif' && (Number(t.lifetime) === 1 || !t.aktif_sampai || t.aktif_sampai >= today()));
  const trial = all.filter(t => t.status === 'trial');
  const ditangguhkan = all.filter(t => t.status === 'ditangguhkan');
  const menunggu = sdb.prepare("SELECT COUNT(*) c FROM saas_pembayaran WHERE status='menunggu'").get().c;
  const tiketBaru = sdb.prepare("SELECT COUNT(*) c FROM saas_tiket WHERE status='baru'").get().c;
  const tagihanTerbuka = sdb.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) n FROM saas_tagihan WHERE status='menunggu'").get();
  return {
    total: all.length, aktif: aktif.length, trial: trial.length,
    ditangguhkan: ditangguhkan.length, terdaftar: all.length,
    lifetime: all.filter(t => Number(t.lifetime) === 1).length,
    menunggu_verifikasi: menunggu, tiket_baru: tiketBaru,
    tagihan_terbuka: Number(tagihanTerbuka.c || 0), nilai_tagihan: Number(tagihanTerbuka.n || 0),
    siswa: 0
  };
}
/** jumlah siswa tiap sekolah (dibaca dari DB masing-masing, murah: 1 query) */
function tenantSiswaCount(t) {
  try {
    return require('./db').useTenant(absDb(t), () => {
      const d = require('./db');
      return d.db.prepare('SELECT COUNT(*) c FROM siswa').get().c;
    });
  } catch (e) { return 0; }
}

function tenantDbPath(kode, nama) {
  const abs = path.join(SEKOLAH_DIR, `${kode}-${slugify(nama).slice(0, 24)}.sqlite`);
  /* disimpan relatif terhadap folder aplikasi agar portabel */
  return path.relative(__dirname, abs).split(path.sep).join('/');
}

/**
 * Buat sekolah baru: kode 4 digit acak, DB sendiri, akun admin, kelas sesuai jenjang.
 * opts: { nama, jenjang, alamat, kepala, kontak_nama, telp, email_admin, admin_nama,
 *         admin_username, admin_password, paket, trial_hari, lifetime, aktif_sampai, oleh }
 */
function createTenant(opts = {}) {
  const nama = clean(opts.nama);
  if (nama.length < 3) throw new Error('Nama sekolah minimal 3 karakter.');
  const dbm = require('./db');
  const jenjang = dbm.JENJANG.includes(clean(opts.jenjang).toUpperCase()) ? clean(opts.jenjang).toUpperCase() : 'SMK';
  const kode = clean(opts.kode) && /^\d{4}$/.test(clean(opts.kode)) ? clean(opts.kode) : randomKode();
  if (sdb.prepare('SELECT 1 FROM tenants WHERE kode=?').get(kode)) throw new Error('Kode sekolah sudah dipakai.');
  const paketKode = paketByKode(opts.paket) ? clean(opts.paket) : setting('paket_default', 'basic');
  const paket = paketByKode(paketKode) || paketByKode('basic');
  const trialHari = opts.trial_hari !== undefined ? Number(opts.trial_hari)
    : (Number(paket && paket.trial_hari) || Number(setting('trial_hari', 7)) || 0);
  const lifetime = opts.lifetime === true || Number(opts.lifetime) === 1 ? 1 : 0;
  const mulai = today();
  const adminSampai = opts.aktif_sampai || addDays(mulai, Math.max(1, trialHari || 30));
  const dbFile = tenantDbPath(kode, nama);
  const dbAbs = path.resolve(__dirname, dbFile);
  const slug = uniqueSlug(nama);

  dbm.ensureTenantDb(dbAbs);

  /* data awal di dalam DB sekolah */
  let adminUser = null;
  dbm.useTenant(dbAbs, () => {
    const d = dbm.db;
    /* identitas sekolah */
    const put = (k, v) => d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v === undefined || v === null ? '' : String(v));
    put('sekolah_nama', nama);
    put('sekolah_bentuk', jenjang);
    put('sekolah_alamat', clean(opts.alamat));
    put('kepala_nama', clean(opts.kepala));
    put('sekolah_telp', clean(opts.telp));
    put('sekolah_email', clean(opts.email_admin));
    put('tenant_kode', kode);
    put('app_nama', setting('app_nama'));
    /* ---- BERSIHKAN IDENTITAS SEKOLAH LAIN ------------------------------
       Seeder internal memakai identitas sekolah percontohan (nama, NPSN, alamat,
       pejabat, tempat cetak). Sekolah baru TIDAK boleh mewarisi data itu —
       semuanya dikosongkan agar yang tampil hanya milik sekolah ini. */
    for (const k of ['sekolah_npsn', 'sekolah_website', 'sekolah_status', 'sekolah_kepemilikan',
      'bendahara_nama', 'bendahara_nip', 'wakasek_nama', 'wakasek_nip', 'wakasek_jabatan',
      'print_tempat', 'kop_baris', 'kop_baris_tambahan', 'kop_logo', 'kop_format']) put(k, '');
    if (setting('logo')) put('logo', setting('logo'));

    /* kelas bawaan sesuai jenjang (kelas SMK bawaan seed diganti) */
    const adaSiswa = d.prepare('SELECT COUNT(*) c FROM siswa').get().c;
    if (!adaSiswa) {
      d.prepare('DELETE FROM kelas').run();
      const insK = d.prepare('INSERT INTO kelas(nama,tingkat,jurusan,wali_id,urut,created_at) VALUES(?,?,?,?,?,?)');
      dbm.kelasDefaultForJenjang(jenjang).forEach(k => insK.run(k.nama, k.tingkat, k.jurusan, null, k.urut, now()));
    }

    /* akun admin sekolah */
    const uname = clean(opts.admin_username) || 'admin';
    const pass = clean(opts.admin_password) || defaultPassword();
    const exist = d.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').get(uname);
    if (exist) {
      d.prepare('UPDATE users SET nama=?,pass_hash=?,role=?,aktif=1 WHERE id=?')
        .run(clean(opts.admin_nama) || 'Administrator Sekolah', lib.hashPassword(pass), 'admin', exist.id);
      adminUser = { id: exist.id, username: uname };
    } else {
      const r = d.prepare(`INSERT INTO users(nama,jabatan,username,pass_hash,role,nip,phone,aktif,created_at)
        VALUES(?,?,?,?,?,?,?,1,?)`)
        .run(clean(opts.admin_nama) || 'Administrator Sekolah', 'Administrator', uname,
          lib.hashPassword(pass), 'admin', '-', clean(opts.telp), now());
      adminUser = { id: Number(r.lastInsertRowid), username: uname };
    }
    /* ---- HANYA akun admin dari formulir pendaftaran --------------------
       Seeder internal membuat beberapa akun contoh (kepsek, guru BK, wali kelas,
       dll.). Sekolah/tenant baru harus BERSIH: seluruh akun contoh dihapus
       sehingga pemilik mulai dari nol dan membuat akunnya sendiri. */
    try {
      const dibuang = d.prepare('DELETE FROM users WHERE id<>?').run(adminUser.id).changes;
      if (dibuang) {
        d.prepare('INSERT INTO audit(user_id,nama,role,aksi,modul,detail,ip,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(adminUser.id, clean(opts.admin_nama) || 'Administrator', 'admin', 'HAPUS', 'auth',
            `${dibuang} akun contoh bawaan dihapus (tenant baru tanpa akun default)`, '', now());
      }
    } catch (e) { /* tabel users selalu ada; abaikan bila gagal */ }
    d.prepare('INSERT INTO audit(user_id,nama,role,aksi,modul,detail,ip,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(adminUser.id, clean(opts.admin_nama) || 'Administrator', 'admin', 'DAFTAR', 'auth',
        `Sekolah terdaftar (kode ${kode})`, '', now());
  });

  /* slug portal publik siswa: /<portal_slug>/portal-siswa (unik, bukan jalur aplikasi) */
  const portalSlug = clean(opts.portal_slug) && !portalSlugError(opts.portal_slug, 0)
    ? clean(opts.portal_slug).toLowerCase()
    : uniquePortalSlug(nama);
  const info = sdb.prepare(`INSERT INTO tenants(kode,nama,slug,jenjang,alamat,kepala,kontak_nama,telp,email_admin,
      paket,status,lifetime,trial_berakhir,aktif_sampai,custom_domain,portal_aktif,portal_slug,db_file,catatan,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(kode, nama, slug, jenjang, clean(opts.alamat), clean(opts.kepala), clean(opts.kontak_nama),
      clean(opts.telp), clean(opts.email_admin), paket ? paket.kode : 'basic',
      lifetime ? 'aktif' : (trialHari > 0 ? 'trial' : 'aktif'), lifetime,
      lifetime ? '' : adminSampai, lifetime ? '' : adminSampai, null, 1, portalSlug, dbFile, clean(opts.catatan),
      now(), now());
  const tenant = tenantById(Number(info.lastInsertRowid));
  logAudit(opts.oleh || 'Sistem', 'TAMBAH', 'sekolah', `Menambah sekolah ${nama} (${kode})${lifetime ? ' — Lifetime' : ''}`);
  return { tenant: decorateTenant(tenant), admin_username: adminUser ? adminUser.username : 'admin', admin_password: clean(opts.admin_password) || null };
}

function defaultPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}
function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < Math.max(8, Math.min(32, len)); i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}
function addDays(iso, days) {
  const d = new Date(String(iso || today()) + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addMonths(iso, months) {
  const d = new Date(String(iso || today()) + 'T00:00:00');
  d.setMonth(d.getMonth() + Number(months || 0));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function updateTenant(id, patch = {}, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const next = {
    nama: patch.nama !== undefined ? clean(patch.nama) : t.nama,
    jenjang: patch.jenjang !== undefined && require('./db').JENJANG.includes(clean(patch.jenjang).toUpperCase())
      ? clean(patch.jenjang).toUpperCase() : t.jenjang,
    alamat: patch.alamat !== undefined ? clean(patch.alamat) : t.alamat,
    kepala: patch.kepala !== undefined ? clean(patch.kepala) : t.kepala,
    kontak_nama: patch.kontak_nama !== undefined ? clean(patch.kontak_nama) : t.kontak_nama,
    telp: patch.telp !== undefined ? clean(patch.telp) : t.telp,
    email_admin: patch.email_admin !== undefined ? clean(patch.email_admin) : t.email_admin,
    paket: patch.paket !== undefined && paketByKode(patch.paket) ? clean(patch.paket) : t.paket,
    status: patch.status !== undefined && ['aktif', 'trial', 'ditangguhkan', 'nonaktif'].includes(patch.status)
      ? patch.status : t.status,
    lifetime: patch.lifetime !== undefined ? (patch.lifetime ? 1 : 0) : t.lifetime,
    aktif_sampai: patch.aktif_sampai !== undefined ? clean(patch.aktif_sampai) : t.aktif_sampai,
    portal_aktif: patch.portal_aktif !== undefined ? (patch.portal_aktif ? 1 : 0) : t.portal_aktif,
    portal_slug: (() => {
      if (patch.portal_slug === undefined) return portalSlugOf(t);
      const slug = clean(patch.portal_slug).toLowerCase();
      if (!slug || slug === portalSlugOf(t)) return portalSlugOf(t);
      const err = portalSlugError(slug, t.id);
      if (err) throw new Error(err);
      return slug;
    })(),
    catatan: patch.catatan !== undefined ? clean(patch.catatan) : t.catatan,
    harga_bulanan: patch.harga_bulanan !== undefined
      ? Math.max(0, Math.round(Number(String(patch.harga_bulanan).replace(/[^\d]/g, '')) || 0)) : (Number(t.harga_bulanan) || 0),
    harga_tahunan: patch.harga_tahunan !== undefined
      ? Math.max(0, Math.round(Number(String(patch.harga_tahunan).replace(/[^\d]/g, '')) || 0)) : (Number(t.harga_tahunan) || 0),
    harga_catatan: patch.harga_catatan !== undefined ? clean(patch.harga_catatan) : (t.harga_catatan || ''),
    fitur_override: patch.fitur_override !== undefined
      ? (Array.isArray(patch.fitur_override) ? JSON.stringify(patch.fitur_override) : clean(patch.fitur_override))
      : t.fitur_override
  };
  if (next.lifetime === 1) { next.aktif_sampai = ''; if (next.status === 'trial') next.status = 'aktif'; }
  sdb.prepare(`UPDATE tenants SET nama=?,jenjang=?,alamat=?,kepala=?,kontak_nama=?,telp=?,email_admin=?,paket=?,
      status=?,lifetime=?,aktif_sampai=?,portal_aktif=?,portal_slug=?,catatan=?,fitur_override=?,
      harga_bulanan=?,harga_tahunan=?,harga_catatan=?,updated_at=? WHERE id=?`)
    .run(next.nama, next.jenjang, next.alamat, next.kepala, next.kontak_nama, next.telp, next.email_admin,
      next.paket, next.status, next.lifetime, next.aktif_sampai, next.portal_aktif, next.portal_slug,
      next.catatan, next.fitur_override, next.harga_bulanan, next.harga_tahunan, next.harga_catatan, now(), Number(id));

  /* sinkronkan identitas di DB sekolah (nama/jenjang/alamat) */
  try {
    require('./db').useTenant(absDb(t), () => {
      const d = require('./db').db;
      const put = (k, v) => d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v === undefined || v === null ? '' : String(v));
      put('sekolah_nama', next.nama);
      put('sekolah_bentuk', next.jenjang);
      put('sekolah_alamat', next.alamat);
      put('portal_aktif', next.portal_aktif ? '1' : '0');
    });
  } catch (e) { /* DB sekolah tidak terjangkau — abaikan, panel tetap tersimpan */ }

  logAudit(oleh || 'Super Admin', 'UBAH', 'sekolah', `Memperbarui sekolah ${next.nama} (${t.kode})`);
  return decorateTenant(tenantById(id));
}

function setTenantStatus(id, status, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  sdb.prepare('UPDATE tenants SET status=?,updated_at=? WHERE id=?').run(status, now(), Number(id));
  logAudit(oleh || 'Super Admin', status === 'ditangguhkan' ? 'SUSPEND' : 'AKTIFKAN', 'sekolah',
    `${status === 'ditangguhkan' ? 'Menangguhkan' : 'Mengaktifkan'} sekolah ${t.nama} (${t.kode})`);
  return decorateTenant(tenantById(id));
}

function setTenantPassword(id, password, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const pass = clean(password) || randomPassword(12);
  let username = '';
  require('./db').useTenant(absDb(t), () => {
    const d = require('./db').db;
    const admin = d.prepare("SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
    if (!admin) throw new Error('Akun admin sekolah tidak ditemukan.');
    d.prepare('UPDATE users SET pass_hash=?, aktif=1 WHERE id=?').run(lib.hashPassword(pass), admin.id);
    username = admin.username;
  });
  logAudit(oleh || 'Super Admin', 'RESET SANDI', 'sekolah', `Reset kata sandi admin ${t.nama} (${username})`);
  return { username, password: pass };
}

/** buat sesi "login as tenant": super admin masuk ke panel sekolah tanpa sandi */
function impersonateUserId(id) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  return require('./db').useTenant(absDb(t), () => {
    const d = require('./db').db;
    const admin = d.prepare("SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
    if (!admin) throw new Error('Akun admin sekolah tidak ditemukan.');
    return admin.id;
  });
}

/**
 * Hapus PERMANEN (Super Admin): baris tenant + berkas database sekolah.
 * Dipakai untuk membersihkan sekolah uji/salah daftar. Berkas yang tidak bisa
 * dihapus (mis. terkunci sistem) dilaporkan tanpa menggagalkan proses.
 */
function hapusPermanen(id, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  if (t.db_file === path.relative(__dirname, require('./db').DB_PATH).split(path.sep).join('/')) {
    throw new Error('Sekolah utama (database aplikasi) tidak boleh dihapus.');
  }
  sdb.prepare('DELETE FROM tenants WHERE id=?').run(t.id);
  sdb.prepare('DELETE FROM saas_tagihan WHERE tenant_id=?').run(t.id);
  sdb.prepare('DELETE FROM saas_pembayaran WHERE tenant_id=?').run(t.id);
  sdb.prepare('DELETE FROM saas_tiket_pesan WHERE tiket_id IN (SELECT id FROM saas_tiket WHERE tenant_id=?)').run(t.id);
  sdb.prepare('DELETE FROM saas_tiket WHERE tenant_id=?').run(t.id);
  sdb.prepare('DELETE FROM saas_sesi WHERE tenant_id=?').run(t.id);
  const file = absDb(t);
  let berkas = 'dihapus';
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(file + ext)) fs.unlinkSync(file + ext); } catch (e) { /* abaikan */ } }
    }
  } catch (e) { berkas = 'tidak dapat dihapus (' + e.message + ')'; }
  logAudit(oleh || 'Super Admin', 'HAPUS PERMANEN', 'sekolah', `Sekolah ${t.nama} (${t.kode}) dihapus — berkas ${berkas}`);
  return { kode: t.kode, nama: t.nama, berkas };
}

function deleteTenant(id, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  sdb.prepare('UPDATE tenants SET status=?,updated_at=? WHERE id=?').run('nonaktif', now(), Number(id));
  logAudit(oleh || 'Super Admin', 'NONAKTIFKAN', 'sekolah', `Menonaktifkan sekolah ${t.nama} (${t.kode}) — data tetap disimpan`);
}

/* ==================== DOMAIN CUSTOM ==================== */
async function checkDomain(tenant, host) {
  const target = clean(setting('domain_info')) || clean(host);
  const hasil = { domain: '', cname: [], a: [], cocok: false, pesan: '' };
  const t = tenantById(tenant.id || tenant);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const dom = clean(t.custom_domain).toLowerCase().replace(/^www\./, '');
  if (!dom) { hasil.pesan = 'Domain custom belum diatur.'; return hasil; }
  hasil.domain = dom;
  try { hasil.cname = await dns.resolveCname(dom); } catch (e) { /* tidak ada CNAME */ }
  try { hasil.a = await dns.resolve4(dom); } catch (e) { /* tidak ada A */ }
  const targetHost = clean(setting('domain_info')).toLowerCase();
  hasil.cocok = hasil.cname.some(c => c.toLowerCase().includes(targetHost)) ||
    (targetHost && hasil.a.length > 0);
  hasil.pesan = hasil.cocok
    ? `Domain aktif mengarah ke platform (${hasil.cname[0] || hasil.a[0] || '-'}).`
    : `Belum terdeteksi mengarah ke ${targetHost || 'platform'}. Tambahkan CNAME ${dom} → ${targetHost || 'domain platform'} (atau A Record ke IP server).`;
  hasil.target = targetHost;
  sdb.prepare('UPDATE tenants SET domain_status=?,domain_cek_at=?,updated_at=? WHERE id=?')
    .run(hasil.cocok ? 'aktif' : 'menunggu', now(), now(), t.id);
  try {
    sdb.prepare('INSERT INTO saas_domain_log(tenant_id,domain,status,pesan,created_at) VALUES(?,?,?,?,?)')
      .run(t.id, dom, hasil.cocok ? 'aktif' : 'menunggu', hasil.pesan, now());
  } catch (e) { /* abaikan */ }
  return hasil;
}
function setTenantDomain(id, domain, oleh) {
  const t = tenantById(id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  let dom = clean(domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').split(':')[0];
  if (dom && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dom)) throw new Error('Format domain tidak valid (contoh: tata-tertib.sekolah.sch.id).');
  if (dom) {
    const ada = sdb.prepare('SELECT id,nama FROM tenants WHERE lower(COALESCE(custom_domain,\'\'))=? AND id<>?').get(dom, Number(id));
    if (ada) throw new Error(`Domain sudah dipakai sekolah lain (${ada.nama}).`);
  }
  sdb.prepare('UPDATE tenants SET custom_domain=?,domain_status=?,updated_at=? WHERE id=?')
    .run(dom || null, dom ? 'menunggu' : '', now(), Number(id));
  logAudit(oleh || 'Super Admin', 'UBAH DOMAIN', 'sekolah', `Domain custom ${t.nama}: ${dom || '(dihapus)'}`);
  return decorateTenant(tenantById(id));
}

/* ==================== TAGIHAN & PEMBAYARAN ==================== */
function tagihanList(q = {}) {
  const where = [], args = [];
  if (q.status) { where.push('g.status=?'); args.push(q.status); }
  if (q.tenant_id) { where.push('g.tenant_id=?'); args.push(Number(q.tenant_id)); }
  return sdb.prepare(`SELECT g.*, t.nama AS sekolah, t.kode, t.telp, t.email_admin
    FROM saas_tagihan g LEFT JOIN tenants t ON t.id=g.tenant_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.id DESC LIMIT 500`).all(...args);
}
function tagihanAktif(tenantId) {
  return sdb.prepare("SELECT * FROM saas_tagihan WHERE tenant_id=? AND status='menunggu' ORDER BY id LIMIT 1").get(Number(tenantId)) || null;
}
function hargaPaket(paketKode, bulan = 1) {
  const p = paketByKode(paketKode);
  let nominal;
  if (p) nominal = Number(bulan) >= 12 ? Number(p.harga_tahunan) || 0 : Number(p.harga_bulanan) || 0;
  else nominal = Number(bulan) >= 12 ? Number(setting('harga_tahunan', 0)) : Number(setting('harga_bulanan', 0));
  if (!nominal) nominal = Number(bulan) >= 12 ? Number(setting('harga_tahunan', 0)) || 0 : Number(setting('harga_bulanan', 0)) || 0;
  return Math.max(0, Math.round(nominal));
}

/** harga efektif seorang TENANT: override khusus bila diatur, selain itu paket. */
function hargaTenant(t, bulan = 1) {
  if (!t) return hargaPaket(null, bulan);
  const tahunan = Number(bulan) >= 12;
  const hb = Number(t.harga_bulanan) || 0;
  const ht = Number(t.harga_tahunan) || 0;
  if (tahunan) {
    if (ht > 0) return Math.round(ht);
    if (hb > 0) return Math.round(hb * 12);   // hanya bulanan diatur → tahunan = 12 × bulanan
  } else if (hb > 0) return Math.round(hb);
  return hargaPaket(t.paket, bulan);
}

/** buat tagihan bila belum ada (IDEMPOTEN: unik per sekolah+periode) */
function ensureTagihan(tenant, { periode, bulan = 1, jatuh_tempo } = {}) {
  const t = typeof tenant === 'object' ? tenant : tenantById(tenant);
  if (!t) return null;
  if (Number(t.lifetime) === 1) return null;
  const per = clean(periode) || t.aktif_sampai || today();
  const ada = sdb.prepare('SELECT * FROM saas_tagihan WHERE tenant_id=? AND periode=?').get(t.id, per);
  if (ada) return ada;
  const nominal = hargaTenant(t, bulan);
  const tempo = clean(jatuh_tempo) || t.aktif_sampai || addDays(today(), 7);
  const info = sdb.prepare(`INSERT INTO saas_tagihan(tenant_id,periode,paket,nominal,potongan,total,jatuh_tempo,status,dibuat)
    VALUES(?,?,?,?,0,?,?,'menunggu',?)`).run(t.id, per, t.paket, nominal, nominal, tempo, now());
  return sdb.prepare('SELECT * FROM saas_tagihan WHERE id=?').get(Number(info.lastInsertRowid));
}

function bayarManual({ tenant_id, paket, bulan = 1, promo, metode = 'qris', bukti_url, catatan, oleh_nama }) {
  const t = tenantById(tenant_id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const p = paketByKode(paket) ? paketByKode(paket) : paketByKode(t.paket);
  const nBulan = Number(bulan) >= 12 ? 12 : 1;
  const nominal = hargaTenant({ ...t, paket: p ? p.kode : t.paket }, nBulan);
  const pr = promoFind(promo);
  const potongan = pr ? Math.round(nominal * (Number(pr.persen) || 0) / 100) : 0;
  const total = Math.max(0, nominal - potongan);
  const aktif = t.aktif_sampai && t.aktif_sampai > today() ? t.aktif_sampai : today();
  const invoice = ensureTagihan(t, { periode: addMonths(aktif, nBulan), bulan: nBulan, jatuh_tempo: t.aktif_sampai || today() });
  const info = sdb.prepare(`INSERT INTO saas_pembayaran(tenant_id,tagihan_id,paket,bulan,nominal,potongan,total,promo,metode,bukti_url,catatan,status,oleh_nama,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'menunggu',?,?)`)
    .run(t.id, invoice ? invoice.id : null, p ? p.kode : t.paket, nBulan, nominal, potongan, total,
      pr ? clean(promo).toUpperCase() : '', clean(metode) || 'qris', clean(bukti_url), clean(catatan),
      clean(oleh_nama), now());
  logAudit(clean(oleh_nama) || t.nama, 'AJUKAN BAYAR', 'pembayaran',
    `${t.nama} mengajukan pembayaran ${nBulan} bulan — Rp ${total.toLocaleString('id-ID')}`);
  return sdb.prepare('SELECT * FROM saas_pembayaran WHERE id=?').get(Number(info.lastInsertRowid));
}

function verifikasiPembayaran(id, aksi, oleh, catatan) {
  const py = sdb.prepare('SELECT * FROM saas_pembayaran WHERE id=?').get(Number(id));
  if (!py) throw new Error('Pembayaran tidak ditemukan.');
  if (py.status !== 'menunggu') throw new Error('Pembayaran ini sudah diproses.');
  const t = tenantById(py.tenant_id);
  if (aksi === 'setuju') {
    sdb.prepare("UPDATE saas_pembayaran SET status='disetujui',verified_by=?,verified_at=?,catatan=? WHERE id=?")
      .run(clean(oleh), now(), clean(catatan) || py.catatan, py.id);
    if (py.tagihan_id) {
      sdb.prepare("UPDATE saas_tagihan SET status='lunas',pembayaran_id=?,lunas_at=? WHERE id=?")
        .run(py.id, now(), py.tagihan_id);
    }
    const mulai = t && t.aktif_sampai && t.aktif_sampai > today() ? t.aktif_sampai : today();
    const sampai = addMonths(mulai, Number(py.bulan) >= 12 ? 12 : 1);
    sdb.prepare("UPDATE tenants SET aktif_sampai=?,status='aktif',paket=?,updated_at=? WHERE id=?")
      .run(sampai, py.paket || (t && t.paket), now(), py.tenant_id);
    logAudit(clean(oleh), 'VERIFIKASI BAYAR', 'pembayaran',
      `Menyetujui pembayaran ${t ? t.nama : '#' + py.tenant_id} — aktif s.d. ${sampai}`);
    waNotify(py.tenant_id, `Pembayaran Anda telah DISETUJUI. Masa aktif layanan diperpanjang sampai ${sampai}. Terima kasih.`, 'pembayaran');
  } else {
    sdb.prepare("UPDATE saas_pembayaran SET status='ditolak',verified_by=?,verified_at=?,catatan=? WHERE id=?")
      .run(clean(oleh), now(), clean(catatan), py.id);
    if (py.tagihan_id) sdb.prepare("UPDATE saas_tagihan SET status='menunggu' WHERE id=?").run(py.tagihan_id);
    logAudit(clean(oleh), 'TOLAK BAYAR', 'pembayaran', `Menolak pembayaran ${t ? t.nama : '#' + py.tenant_id}: ${clean(catatan) || '-'}`);
    waNotify(py.tenant_id, `Pembayaran Anda belum dapat disetujui${clean(catatan) ? ': ' + clean(catatan) : '.'} Silakan ajukan ulang.`, 'pembayaran');
  }
  return sdb.prepare('SELECT * FROM saas_pembayaran WHERE id=?').get(py.id);
}
/* ==================== PEMBAYARAN HYBRID (GATEWAY QRIS) ==================== */
/** konfigurasi gateway (rahasia) dari control plane */
function gatewayCfg() {
  return {
    provider: clean(setting('pay_gateway_provider')) || 'sandbox',
    mode: clean(setting('pay_gateway_mode')) || 'sandbox',
    merchant: clean(setting('pay_gateway_merchant')),
    key: clean(setting('pay_gateway_key')),
    key2: clean(setting('pay_gateway_key2')),
    callback: clean(setting('pay_gateway_callback')),
    base: clean(setting('pay_gateway_base')),
    /* khusus Kasera: auto | transactions | qris */
    kasera_api: clean(setting('pay_gateway_kasera_api')) || 'auto',
    expire_menit: Math.max(5, Number(setting('pay_gateway_expire_menit')) || 60)
  };
}
/** konfigurasi publik (aman untuk dikirim ke klien) */
function payConfig(baseUrl) {
  const pub = payment.publicConfig(setting);
  pub.callback_url = baseUrl ? `${String(baseUrl).replace(/\/$/, '')}/api/pay/callback` : '';
  /* endpoint webhook Kasera Pay (didaftarkan di dashboard Kasera) */
  pub.webhook_url = kaseraWebhookUrl(baseUrl);
  pub.kasera_api = clean(setting('pay_gateway_kasera_api')) || 'auto';
  pub.webhook_secret_set = !!clean(setting('pay_gateway_callback') || setting('pay_gateway_key2')
    || process.env.KASERA_WEBHOOK_SECRET);
  return pub;
}

/**
 * Buat tagihan QRIS dinamis lewat payment gateway.
 * Membuat baris saas_pembayaran (channel='gateway') lebih dulu agar order_id
 * dapat dilacak walau respons gateway gagal/timeout.
 */
async function bayarGateway({ tenant_id, paket, bulan = 1, promo, oleh_nama, base_url }) {
  const t = tenantById(tenant_id);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  if (!isOn(setting('pay_gateway_aktif'))) throw new Error('Metode QRIS otomatis sedang dinonaktifkan Super Admin.');
  const p = paketByKode(paket) ? paketByKode(paket) : paketByKode(t.paket);
  const nBulan = Number(bulan) >= 12 ? 12 : 1;
  const nominal = hargaTenant({ ...t, paket: p ? p.kode : t.paket }, nBulan);
  const pr = promoFind(promo);
  const potongan = pr ? Math.round(nominal * (Number(pr.persen) || 0) / 100) : 0;
  const total = Math.max(0, nominal - potongan);
  const aktif = t.aktif_sampai && t.aktif_sampai > today() ? t.aktif_sampai : today();
  const invoice = ensureTagihan(t, { periode: addMonths(aktif, nBulan), bulan: nBulan, jatuh_tempo: t.aktif_sampai || today() });
  const cfg = gatewayCfg();
  const oid = payment.orderId(t.id);
  const info = sdb.prepare(`INSERT INTO saas_pembayaran(tenant_id,tagihan_id,paket,bulan,nominal,potongan,total,promo,metode,bukti_url,catatan,status,oleh_nama,created_at,channel,provider,order_id,gateway_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'menunggu',?,?,?,?,?,?)`)
    .run(t.id, invoice ? invoice.id : null, p ? p.kode : t.paket, nBulan, nominal, potongan, total,
      pr ? clean(promo).toUpperCase() : '', 'qris-gateway', '', 'Pembayaran QRIS otomatis',
      clean(oleh_nama), now(), 'gateway', cfg.provider, oid, 'PENDING');
  const id = Number(info.lastInsertRowid);

  const charge = await payment.createCharge(
    {
      ...cfg,
      callback_url: base_url ? `${String(base_url).replace(/\/$/, '')}/api/pay/callback` : '',
      webhook_url: kaseraWebhookUrl(base_url),
      return_url: base_url || ''
    },
    { order_id: oid, amount: total, label: `Langganan ${nBulan} bulan — ${t.nama}`, customer: { nama: t.nama, email: t.email_admin || '' } });

  if (!charge.ok) {
    sdb.prepare("UPDATE saas_pembayaran SET status='ditolak',gateway_status='GAGAL',catatan=? WHERE id=?")
      .run('Gagal membuat QRIS: ' + (charge.error || 'tidak diketahui'), id);
    logAudit(clean(oleh_nama) || t.nama, 'BAYAR GATEWAY', 'pembayaran', `${t.nama} gagal membuat QRIS (${cfg.provider}): ${charge.error || '-'}`);
    throw new Error(charge.error || 'Gagal membuat QRIS pada payment gateway.');
  }

  sdb.prepare(`UPDATE saas_pembayaran SET qr_string=?,qr_url=?,checkout_url=?,expires_at=?,gateway_payload=?,gateway_status='PENDING' WHERE id=?`)
    .run(clean(charge.qr_string), clean(charge.qr_url), clean(charge.checkout_url), clean(charge.expires_at),
      JSON.stringify(charge.raw || {}).slice(0, 4000), id);
  logAudit(clean(oleh_nama) || t.nama, 'BAYAR GATEWAY', 'pembayaran',
    `${t.nama} membuat QRIS otomatis Rp ${Number(total).toLocaleString('id-ID')} (${cfg.provider}) — order ${oid}`);
  return sdb.prepare('SELECT * FROM saas_pembayaran WHERE id=?').get(id);
}

/** cari pembayaran berdasarkan order_id gateway */
function gatewayRow(order_id) {
  return sdb.prepare('SELECT * FROM saas_pembayaran WHERE order_id=?').get(clean(order_id)) || null;
}

/** tandai lunas (dipakai callback & polling status) — idempoten */
function gatewayMarkPaid(order_id, oleh) {
  const py = gatewayRow(order_id);
  if (!py) throw new Error('Transaksi gateway tidak ditemukan.');
  if (py.status === 'disetujui') return { pembayaran: py, sudah: true };
  if (py.status !== 'menunggu') throw new Error('Transaksi ini sudah diproses (' + py.status + ').');
  sdb.prepare("UPDATE saas_pembayaran SET gateway_status='PAID',paid_at=? WHERE id=?").run(now(), py.id);
  const res = verifikasiPembayaran(py.id, 'setuju', clean(oleh) || 'Payment Gateway', 'Pembayaran QRIS otomatis terverifikasi gateway');
  return { pembayaran: res, sudah: false };
}

/** cek status terkini ke gateway (dipakai halaman perpanjangan untuk polling) */
async function gatewaySync(order_id) {
  const py = gatewayRow(order_id);
  if (!py) throw new Error('Transaksi gateway tidak ditemukan.');
  if (py.status !== 'menunggu') return { status: py.status, paid: py.status === 'disetujui', pembayaran: py };
  const cfg = gatewayCfg();
  let transactionId = '';
  if (cfg.provider === 'kasera') {
    try {
      const payload = JSON.parse(String(py.gateway_payload || '{}'));
      transactionId = clean(payload.id || (payload.data && payload.data.id));
    } catch (e) {
      return { status: py.status, paid: false, gateway_status: py.gateway_status || 'ERROR',
        error: 'Respons Kasera tersimpan dengan format tidak valid; pembayaran akan diverifikasi melalui webhook.' };
    }
    if (!transactionId) {
      return { status: py.status, paid: false, gateway_status: py.gateway_status || 'ERROR',
        error: 'ID transaksi Kasera tidak tersimpan; pembayaran akan diverifikasi melalui webhook.' };
    }
  }
  const st = await payment.checkStatus({ ...cfg, transaction_id: transactionId },
    { order_id: py.order_id, amount: py.total });
  if (st.ok) sdb.prepare('UPDATE saas_pembayaran SET gateway_status=? WHERE id=?').run(clean(st.status) || 'PENDING', py.id);
  if (st.paid) {
    const r = gatewayMarkPaid(py.order_id, 'Payment Gateway');
    return { status: 'disetujui', paid: true, pembayaran: r.pembayaran };
  }
  return { status: py.status, paid: false, gateway_status: st.status || '', error: st.error || '' };
}

/* ==================== WEBHOOK KASERA PAY ====================
   Notifikasi pembayaran dari Kasera (tanpa sesi). Keaslian dijamin
   HMAC-SHA256 timestamp + BODY MENTAH pada header `kasera-signature-v1`,
   lalu event dideduplikasi lewat tabel kasera_event supaya event yang sama
   tidak diproses dua kali (mis. kiriman ulang saat jaringan terputus).
   ============================================================ */
function kaseraWebhookUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  return b ? b + '/api/webhook/kasera' : '';
}
function kaseraEventRow(eventId) {
  return sdb.prepare('SELECT * FROM kasera_event WHERE event_id=?').get(clean(eventId)) || null;
}
function kaseraEventSave(r) {
  const row = r || {};
  if (kaseraEventRow(row.event_id)) {
    sdb.prepare(`UPDATE kasera_event SET tipe=?,status=?,order_id=?,jumlah=?,tenant_id=?,sasaran=?,hasil=?,pesan=?,diproses_at=? WHERE event_id=?`)
      .run(clean(row.tipe), clean(row.status), clean(row.order_id), Number(row.jumlah) || 0,
        Number(row.tenant_id) || null, clean(row.sasaran), clean(row.hasil), clean(row.pesan), now(), row.event_id);
    return;
  }
  sdb.prepare(`INSERT INTO kasera_event(event_id,tipe,status,order_id,jumlah,tenant_id,sasaran,hasil,pesan,diterima_at,diproses_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(clean(row.event_id), clean(row.tipe), clean(row.status), clean(row.order_id), Number(row.jumlah) || 0,
      Number(row.tenant_id) || null, clean(row.sasaran), clean(row.hasil), clean(row.pesan), now(), now());
}
function kaseraEvents(limit = 12) {
  return sdb.prepare('SELECT * FROM kasera_event ORDER BY diterima_at DESC, rowid DESC LIMIT ?')
    .all(Math.max(1, Number(limit) || 12));
}
/**
 * Proses satu notifikasi webhook Kasera.
 * @returns {{code:number, out:object}}
 */
function kaseraHandleWebhook({ raw, body, headers = {} } = {}) {
  const bahan = raw === undefined || raw === null ? JSON.stringify(body || {}) : raw;
  let payload = body;
  if (!payload || typeof payload !== 'object') {
    try { payload = JSON.parse(String(bahan || '{}')); } catch (e) { payload = {}; }
  }
  const ev = payment.kaseraEvent(payload);
  const order = clean(ev.order_id);
  const secrets = payment.kaseraSecrets(gatewayCfg());

  /* ---- 1. verifikasi tanda tangan (wajib) ---- */
  if (!secrets.length) {
    console.error('[kasera] webhook ditolak: Webhook Secret belum diatur.');
    return { code: 503, out: { ok: false, error: 'Webhook Secret Kasera belum diatur pada pengaturan pembayaran.' } };
  }
  const verif = payment.kaseraVerifySignature(bahan, headers, secrets);
  if (!verif.ok) {
    console.error('[kasera] webhook ditolak:', verif.reason, '· order', order || '-');
    return { code: 401, out: { ok: false, error: 'Tanda tangan webhook tidak valid.' } };
  }

  /* ---- 2. deduplikasi berdasarkan id event ---- */
  const eventId = clean(ev.event_id) || ('ev-' + lib.token(8));
  const sudah = kaseraEventRow(eventId);
  if (sudah && sudah.hasil === 'ok') {
    return { code: 200, out: { ok: true, duplicate: true, event_id: eventId, pesan: 'Event sudah pernah diproses.' } };
  }
  const dasar = {
    event_id: eventId, tipe: ev.type || '(tanpa tipe)', status: ev.status,
    order_id: order, jumlah: ev.amount
  };
  if (!order) {
    kaseraEventSave({ ...dasar, hasil: 'ditolak', pesan: 'external_id tidak ada pada event.' });
    return { code: 400, out: { ok: false, error: 'external_id (nomor pesanan) tidak ada pada event.' } };
  }

  /* ---- 3. event yang bukan pelunasan → hanya dicatat ---- */
  if (!ev.paid) {
    kaseraEventSave({ ...dasar, hasil: 'diabaikan', pesan: `Event ${ev.type || 'tanpa tipe'} (${ev.status || '-'}) tidak menandai lunas.` });
    return { code: 200, out: { ok: true, paid: false, event_id: eventId } };
  }

  try {
    const py = gatewayRow(order);
    if (!py) {
      kaseraEventSave({ ...dasar, hasil: 'tidak-ditemukan', pesan: 'Nomor pesanan tidak dikenal.' });
      return { code: 404, out: { ok: false, error: 'Transaksi tidak ditemukan.' } };
    }
    if (Number(ev.amount) > 0 && Number(py.total) > 0 && Number(ev.amount) < Number(py.total)) {
      kaseraEventSave({
        ...dasar, tenant_id: py.tenant_id, sasaran: 'langganan', hasil: 'jumlah-tidak-cocok',
        pesan: `Dibayar ${ev.amount} < tagihan ${py.total}`
      });
      return { code: 400, out: { ok: false, error: 'Nominal pembayaran lebih kecil dari tagihan.' } };
    }
    const r = gatewayMarkPaid(order, 'Kasera Pay');
    kaseraEventSave({
      ...dasar, tenant_id: py.tenant_id, sasaran: 'langganan', hasil: 'ok',
      pesan: r.sudah ? 'Sudah lunas sebelumnya.' : 'Masa aktif diperpanjang otomatis.'
    });
    logAudit(null, 'WEBHOOK KASERA', 'pembayaran',
      `Order ${order} lunas (${ev.status || 'PAID'}) — perpanjangan sekolah #${py.tenant_id}`);
    return { code: 200, out: { ok: true, paid: true, sudah: !!r.sudah } };
  } catch (e) {
    console.error('[kasera] gagal memproses webhook', order, e);
    kaseraEventSave({ ...dasar, sasaran: '-', hasil: 'gagal', pesan: e.message });
    return { code: 500, out: { ok: false, error: e.message } };
  }
}

function pembayaranList(q = {}) {
  const where = [], args = [];
  if (q.status && q.status !== 'semua') { where.push('p.status=?'); args.push(q.status); }
  return sdb.prepare(`SELECT p.*, t.nama AS sekolah, t.kode FROM saas_pembayaran p
    LEFT JOIN tenants t ON t.id=p.tenant_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 500`).all(...args);
}

/** perpanjang manual oleh super admin (tanpa pembayaran) */
function perpanjang(tenantId, bulan, oleh, catatan) {
  const t = tenantById(tenantId);
  if (!t) throw new Error('Sekolah tidak ditemukan.');
  const n = Number(bulan) >= 12 ? 12 : Math.max(1, Number(bulan) || 1);
  const mulai = t.aktif_sampai && t.aktif_sampai > today() ? t.aktif_sampai : today();
  const sampai = addMonths(mulai, n);
  sdb.prepare("UPDATE tenants SET aktif_sampai=?,status='aktif',updated_at=? WHERE id=?").run(sampai, now(), t.id);
  logAudit(oleh || 'Super Admin', 'PERPANJANG', 'sekolah', `${t.nama} diperpanjang ${n} bulan s.d. ${sampai}${catatan ? ' — ' + catatan : ''}`);
  return decorateTenant(tenantById(t.id));
}

/* ==================== AUTOMATION CRON (idempoten) ==================== */
/**
 * Pemeriksaan tagihan harian:
 *  1. Tagihan baru dibuat H-7 sebelum masa aktif berakhir (unik per sekolah+periode).
 *  2. Notifikasi H-7 dikirim SEKALI (kolom notif_h7).
 *  3. Sekolah yang masa aktifnya lewat → otomatis DITANGGUHKAN (sekali).
 * Semua langkah idempoten: dijalankan berkali-kali hasilnya sama.
 */
function runBillingCheck({ oleh = 'Cron Otomatis', kirim_wa = true } = {}) {
  const hasil = { dibuat: 0, notif: 0, ditangguhkan: 0, dilewati: 0, detail: [] };
  const list = sdb.prepare("SELECT * FROM tenants WHERE status IN ('aktif','trial') AND lifetime=0").all();
  for (const t of list) {
    if (!t.aktif_sampai) { hasil.dilewati++; continue; }
    const sisaHari = Math.ceil((new Date(t.aktif_sampai + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
    /* 1. tagihan baru H-7 (atau lebih dekat) */
    if (sisaHari <= 7 && sisaHari >= 0) {
      const ada = sdb.prepare('SELECT * FROM saas_tagihan WHERE tenant_id=? AND status=\'menunggu\'').get(t.id);
      if (!ada) {
        const tag = ensureTagihan(t, { periode: t.aktif_sampai, bulan: 1, jatuh_tempo: t.aktif_sampai });
        if (tag) {
          hasil.dibuat++;
          hasil.detail.push(`Tagihan ${t.nama} (${t.kode}) Rp ${Number(tag.total).toLocaleString('id-ID')} jatuh tempo ${tag.jatuh_tempo}`);
        }
      }
      /* 2. notifikasi H-7 sekali saja */
      const tag = sdb.prepare("SELECT * FROM saas_tagihan WHERE tenant_id=? AND status='menunggu' ORDER BY id LIMIT 1").get(t.id);
      if (tag && !tag.notif_h7) {
        sdb.prepare('UPDATE saas_tagihan SET notif_h7=? WHERE id=?').run(now(), tag.id);
        hasil.notif++;
        if (kirim_wa) {
          waNotify(t.id, `Pengingat: masa aktif layanan ${t.nama} berakhir ${t.aktif_sampai}. ` +
            `Tagihan Rp ${Number(tag.total).toLocaleString('id-ID')} dapat dibayar melalui menu Info & Layanan.`, 'tagihan');
        }
      }
    }
    /* 3. suspend otomatis setelah lewat masa aktif */
    if (sisaHari < 0) {
      sdb.prepare("UPDATE tenants SET status='ditangguhkan',updated_at=? WHERE id=? AND status IN ('aktif','trial')")
        .run(now(), t.id);
      hasil.ditangguhkan++;
      hasil.detail.push(`Sekolah ${t.nama} (${t.kode}) ditangguhkan otomatis (masa aktif ${t.aktif_sampai}).`);
      if (kirim_wa) waNotify(t.id, `Masa aktif layanan ${t.nama} telah berakhir. Akun ditangguhkan sementara — silakan perpanjang melalui menu Info & Layanan.`, 'suspend');
    }
  }
  setSetting('cron_terakhir', now());
  setSetting('cron_hasil', JSON.stringify({ ...hasil, detail: hasil.detail.slice(0, 20), oleh }));
  if (hasil.dibuat || hasil.notif || hasil.ditangguhkan) {
    logAudit(oleh, 'CRON TAGIHAN', 'penagihan',
      `Tagihan baru ${hasil.dibuat}, notifikasi ${hasil.notif}, ditangguhkan ${hasil.ditangguhkan}`);
  }
  return hasil;
}

/* ==================== WHATSAPP GATEWAY ==================== */
function waConfig() {
  const s = settings();
  return {
    aktif: String(s.wa_aktif) === '1',
    url: clean(process.env.WA_API_URL || s.wa_api_url),
    token: clean(process.env.WA_API_TOKEN || s.wa_api_token),
    payload: clean(process.env.WA_API_PAYLOAD || s.wa_payload) || DEFAULTS.wa_payload
  };
}
function waLog(tenantId, tujuan, pesan, status, error, jenis) {
  try {
    sdb.prepare('INSERT INTO saas_wa_log(tenant_id,tujuan,pesan,status,error,jenis,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(tenantId || null, clean(tujuan), clean(pesan).slice(0, 2000), status, clean(error), clean(jenis) || 'umum', now());
  } catch (e) { /* abaikan */ }
}
function buildWaUrl(cfg, phone, pesan) {
  let payload = cfg.payload || DEFAULTS.wa_payload;
  payload = payload.split('{phone}').join(phone).split('{pesan}').join(pesan.replace(/\n/g, '\\n'));
  const url = cfg.url;
  if (!url || !phone) return '';
  if (/post/i.test(payload) || url.includes('?')) return url;
  return url;
}
/** kirim WA (best effort; dicatat ke log apa pun hasilnya) */
async function waSend(phone, pesan, { tenantId = null, jenis = 'umum', logMessage = '', hideError = false } = {}) {
  const cfg = waConfig();
  const tujuan = lib.normPhone(phone) || clean(phone);
  if (!cfg.aktif || !cfg.url || !tujuan) {
    waLog(tenantId, tujuan, logMessage || pesan, 'gagal',
      !cfg.aktif ? 'Gateway belum diaktifkan' : (!cfg.url ? 'URL gateway kosong' : 'Nomor tujuan kosong'), jenis);
    return { ok: false, error: 'Gateway WhatsApp belum aktif atau nomor tidak valid.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const body = (cfg.payload || DEFAULTS.wa_payload)
      .split('{phone}').join(tujuan)
      .split('{pesan}').join(pesan);
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {}) },
      body: JSON.parse(body) ? body : body,
      signal: controller.signal
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    try {
      const result = JSON.parse(txt);
      if (result && (result.status === false || result.ok === false || result.success === false)) {
        throw new Error(result.reason || result.message || 'Gateway menolak pesan');
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Sebagian gateway mengembalikan teks biasa saat berhasil.
      } else {
        throw e;
      }
    }
    waLog(tenantId, tujuan, logMessage || pesan, 'terkirim', '', jenis);
    return { ok: true };
  } catch (e) {
    waLog(tenantId, tujuan, logMessage || pesan, 'gagal', hideError ? 'Pengiriman WhatsApp gagal' : e.message, jenis);
    return { ok: false, error: hideError ? 'Gateway WhatsApp gagal mengirim pesan.' : e.message };
  } finally {
    clearTimeout(timer);
  }
}
/** notifikasi ke sekolah (nomor kontak tenant) — tidak melempar error */
function waNotify(tenantId, pesan, jenis) {
  const t = tenantById(tenantId);
  if (!t) return null;
  const phone = t.telp;
  if (!waConfig().aktif) { waLog(t.id, phone, pesan, 'antre', 'Gateway belum aktif', jenis); return null; }
  waSend(phone, pesan, { tenantId: t.id, jenis }).catch(() => { });
  return true;
}
function waLogList(q = {}) {
  const where = [], args = [];
  if (q.status) { where.push('w.status=?'); args.push(q.status); }
  return sdb.prepare(`SELECT w.*, t.nama AS sekolah FROM saas_wa_log w LEFT JOIN tenants t ON t.id=w.tenant_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.id DESC LIMIT 300`).all(...args);
}

/* ==================== TIKET ==================== */
const TIKET_KATEGORI = ['umum', 'teknis', 'tagihan', 'fitur', 'data'];
const TIKET_STATUS = [
  { key: 'baru', label: 'Baru' },
  { key: 'diproses', label: 'Diproses' },
  { key: 'selesai', label: 'Selesai' },
  { key: 'ditutup', label: 'Ditutup' }
];
function tiketList(q = {}) {
  const where = [], args = [];
  if (q.status && q.status !== 'semua') { where.push('k.status=?'); args.push(q.status); }
  if (q.tenant_id) { where.push('k.tenant_id=?'); args.push(Number(q.tenant_id)); }
  const rows = sdb.prepare(`SELECT k.*, t.nama AS sekolah, t.kode,
      (SELECT COUNT(*) FROM saas_tiket_pesan m WHERE m.tiket_id=k.id) AS jumlah_pesan,
      (SELECT MAX(created_at) FROM saas_tiket_pesan m WHERE m.tiket_id=k.id) AS terakhir_pesan
    FROM saas_tiket k LEFT JOIN tenants t ON t.id=k.tenant_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.id DESC LIMIT 300`).all(...args);
  return rows;
}
function tiketDetail(id) {
  const t = sdb.prepare(`SELECT k.*, t.nama AS sekolah, t.kode FROM saas_tiket k
    LEFT JOIN tenants t ON t.id=k.tenant_id WHERE k.id=?`).get(Number(id));
  if (!t) return null;
  t.pesan = sdb.prepare('SELECT * FROM saas_tiket_pesan WHERE tiket_id=? ORDER BY id').all(Number(id));
  return t;
}
function tiketBuat({ tenant_id, judul, kategori, prioritas, pesan, oleh }) {
  if (!clean(judul)) throw new Error('Judul tiket wajib diisi.');
  const info = sdb.prepare('INSERT INTO saas_tiket(tenant_id,judul,kategori,prioritas,status,oleh_nama,dibuat,diperbarui) VALUES(?,?,?,?,?,?,?,?)')
    .run(Number(tenant_id) || null, clean(judul), TIKET_KATEGORI.includes(clean(kategori)) ? clean(kategori) : 'umum',
      ['rendah', 'normal', 'tinggi'].includes(clean(prioritas)) ? clean(prioritas) : 'normal',
      'baru', clean(oleh) || 'Sekolah', now(), now());
  const id = Number(info.lastInsertRowid);
  if (clean(pesan)) sdb.prepare('INSERT INTO saas_tiket_pesan(tiket_id,dari,oleh,pesan,created_at) VALUES(?,?,?,?,?)')
    .run(id, 'tenant', clean(oleh) || 'Sekolah', clean(pesan), now());
  logAudit(clean(oleh) || 'Sekolah', 'TIKET BARU', 'tiket', `#${id} ${clean(judul)}`);
  return tiketDetail(id);
}
function tiketBalas(id, { dari, oleh, pesan, status }) {
  const t = sdb.prepare('SELECT * FROM saas_tiket WHERE id=?').get(Number(id));
  if (!t) throw new Error('Tiket tidak ditemukan.');
  if (clean(pesan)) sdb.prepare('INSERT INTO saas_tiket_pesan(tiket_id,dari,oleh,pesan,created_at) VALUES(?,?,?,?,?)')
    .run(t.id, dari === 'super' ? 'super' : 'tenant', clean(oleh), clean(pesan), now());
  const nextStatus = TIKET_STATUS.some(s => s.key === status) ? status : (dari === 'super' && t.status === 'baru' ? 'diproses' : t.status);
  sdb.prepare('UPDATE saas_tiket SET status=?,diperbarui=? WHERE id=?').run(nextStatus, now(), t.id);
  if (dari === 'super') logAudit(clean(oleh), 'BALAS TIKET', 'tiket', `#${t.id} ${t.judul} → ${nextStatus}`);
  return tiketDetail(t.id);
}

/* ==================== PENGUMUMAN ==================== */
function pengumumanList({ aktifOnly } = {}) {
  const rows = sdb.prepare('SELECT * FROM saas_pengumuman ORDER BY id DESC').all();
  const hariIni = today();
  return aktifOnly ? rows.filter(p => Number(p.aktif) === 1 &&
    (!p.mulai || p.mulai <= hariIni) && (!p.selesai || p.selesai >= hariIni)) : rows;
}
function pengumumanSave(b) {
  const judul = clean(b.judul);
  if (!judul) throw new Error('Judul pengumuman wajib diisi.');
  const row = [judul, clean(b.isi), ['info', 'peringatan', 'maintenance'].includes(b.tipe) ? b.tipe : 'info',
    b.aktif === false || b.aktif === 0 || b.aktif === '0' ? 0 : 1, clean(b.mulai), clean(b.selesai), now()];
  if (b.id) {
    sdb.prepare('UPDATE saas_pengumuman SET judul=?,isi=?,tipe=?,aktif=?,mulai=?,selesai=? WHERE id=?')
      .run(row[0], row[1], row[2], row[3], row[4], row[5], Number(b.id));
    return { id: Number(b.id), created: false };
  }
  const info = sdb.prepare('INSERT INTO saas_pengumuman(judul,isi,tipe,aktif,mulai,selesai,created_at) VALUES(?,?,?,?,?,?,?)').run(...row);
  return { id: Number(info.lastInsertRowid), created: true };
}
function pengumumanDelete(id) { sdb.prepare('DELETE FROM saas_pengumuman WHERE id=?').run(Number(id)); }

/* ==================== PETUNJUK PENGGUNA ==================== */
function panduanList(untuk) {
  const rows = sdb.prepare(`SELECT * FROM saas_panduan ${untuk ? 'WHERE untuk=?' : ''} ORDER BY urutan, id`)
    .all(...(untuk ? [clean(untuk)] : []));
  return rows;
}
function panduanSave(b) {
  const judul = clean(b.judul);
  if (!judul) throw new Error('Judul petunjuk wajib diisi.');
  const url = clean(b.url);
  if (url && !/^https?:\/\//i.test(url)) throw new Error('Tautan harus dimulai dengan https://');
  const row = [['super', 'sekolah'].includes(clean(b.untuk)) ? clean(b.untuk) : 'sekolah', judul,
    ['youtube', 'pdf', 'tautan', 'teks'].includes(clean(b.tipe)) ? clean(b.tipe) : 'youtube',
    url, clean(b.deskripsi), Math.max(1, Number(b.urutan) || 1),
    b.aktif === false || b.aktif === 0 || b.aktif === '0' ? 0 : 1, now()];
  if (b.id) {
    sdb.prepare('UPDATE saas_panduan SET untuk=?,judul=?,tipe=?,url=?,deskripsi=?,urutan=?,aktif=? WHERE id=?')
      .run(...row, Number(b.id));
    return { id: Number(b.id) };
  }
  const info = sdb.prepare('INSERT INTO saas_panduan(untuk,judul,tipe,url,deskripsi,urutan,aktif,created_at) VALUES(?,?,?,?,?,?,?,?)').run(...row);
  return { id: Number(info.lastInsertRowid) };
}
function panduanDelete(id) { sdb.prepare('DELETE FROM saas_panduan WHERE id=?').run(Number(id)); }
/** ekstrak ID video YouTube untuk embed */
function youtubeId(url) {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(clean(url));
  return m ? m[1] : '';
}

/* ==================== AKUN SUPER ADMIN ==================== */
function adminByUsername(username) {
  return sdb.prepare('SELECT * FROM saas_admins WHERE lower(username)=lower(?)').get(clean(username)) || null;
}
function adminByEmail(email) {
  return sdb.prepare('SELECT * FROM saas_admins WHERE lower(COALESCE(email,\'\'))=lower(?)').get(clean(email)) || null;
}
function adminById(id) { return sdb.prepare('SELECT * FROM saas_admins WHERE id=?').get(Number(id)) || null; }
function adminSave(b) {
  const nama = clean(b.nama), username = clean(b.username).toLowerCase();
  if (!nama || !username) throw new Error('Nama & username wajib diisi.');
  const pass = clean(b.password);
  const current = b.id ? adminById(b.id) : null;
  const phone = b.phone === undefined
    ? lib.normPhone((current && current.phone) || '')
    : (clean(b.phone) ? lib.normPhone(b.phone) : '');
  if (clean(b.phone) && !phone) throw new Error('Nomor WhatsApp tidak valid.');
  if (pass && pass.length < 6) throw new Error('Kata sandi minimal 6 karakter.');
  const ada = adminByUsername(username);
  if (b.id) {
    if (pass) sdb.prepare('UPDATE saas_admins SET nama=?,username=?,email=?,phone=?,pass_hash=?,aktif=? WHERE id=?')
      .run(nama, username, clean(b.email), phone, lib.hashPassword(pass), b.aktif ? 1 : 0, Number(b.id));
    else sdb.prepare('UPDATE saas_admins SET nama=?,username=?,email=?,phone=?,aktif=? WHERE id=?')
      .run(nama, username, clean(b.email), phone, b.aktif ? 1 : 0, Number(b.id));
    return { id: Number(b.id) };
  }
  if (ada) throw new Error('Username sudah dipakai.');
  const info = sdb.prepare('INSERT INTO saas_admins(nama,username,email,phone,pass_hash,aktif,created_at) VALUES(?,?,?,?,?,1,?)')
    .run(nama, username, clean(b.email), phone, lib.hashPassword(pass || randomPassword(12)), now());
  return { id: Number(info.lastInsertRowid) };
}

/**
 * Ubah profil Super Admin yang sedang masuk (nama, username, email, nomor HP, kata sandi).
 * Mengganti kata sandi WAJIB menyertakan kata sandi lama yang benar.
 */
function adminUpdateSelf(id, b = {}) {
  const admin = adminById(id);
  if (!admin) throw new Error('Akun Super Admin tidak ditemukan.');
  const nama = clean(b.nama);
  const username = clean(b.username).toLowerCase();
  const email = clean(b.email);
  const phone = b.phone === undefined
    ? lib.normPhone(admin.phone || '')
    : (clean(b.phone) ? lib.normPhone(b.phone) : '');
  if (nama.length < 3) throw new Error('Nama akun minimal 3 karakter.');
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Format email tidak valid.');
  if (clean(b.phone) && !phone) throw new Error('Nomor WhatsApp tidak valid.');
  const kembar = adminByUsername(username);
  if (kembar && Number(kembar.id) !== Number(admin.id)) throw new Error('Username sudah dipakai akun lain.');
  const emailKembar = email ? adminByEmail(email) : null;
  if (emailKembar && Number(emailKembar.id) !== Number(admin.id)) throw new Error('Email sudah dipakai akun lain.');

  const lama = String(b.password_lama || '');
  const baru = String(b.password_baru || b.password || '');
  if (baru) {
    if (!lib.verifyPassword(lama, admin.pass_hash)) throw new Error('Kata sandi lama tidak sesuai.');
    if (baru.length < 8) throw new Error('Kata sandi baru minimal 8 karakter.');
    if (baru === lama) throw new Error('Kata sandi baru tidak boleh sama dengan kata sandi lama.');
    if (String(b.password_ulang || baru) !== baru) throw new Error('Ulangi kata sandi baru tidak sama.');
    sdb.prepare('UPDATE saas_admins SET nama=?,username=?,email=?,phone=?,pass_hash=? WHERE id=?')
      .run(nama, username, email, phone, lib.hashPassword(baru), Number(admin.id));
  } else {
    sdb.prepare('UPDATE saas_admins SET nama=?,username=?,email=?,phone=? WHERE id=?')
      .run(nama, username, email, phone, Number(admin.id));
  }
  return {
    id: Number(admin.id), nama, username, email, phone,
    password_diubah: !!baru
  };
}

/* ==================== SESI (control plane) ==================== */
const SESSION_DAYS = 30;
function sessionSave(sid, { scope, userId, tenantId, ua }) {
  const exp = addDays(today(), SESSION_DAYS) + ' 23:59:59';
  sdb.prepare(`INSERT INTO saas_sesi(sid,scope,user_id,tenant_id,created_at,last_seen,expires_at,user_agent)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sid) DO UPDATE SET last_seen=excluded.last_seen,expires_at=excluded.expires_at`)
    .run(sid, scope, userId || null, tenantId || null, now(), now(), exp, clean(ua).slice(0, 250));
  return sid;
}
function sessionGet(sid) {
  if (!sid) return null;
  let row;
  try { row = sdb.prepare('SELECT * FROM saas_sesi WHERE sid=?').get(String(sid)); } catch (e) { return null; }
  if (!row) return null;
  if (row.expires_at && row.expires_at < now()) { sessionDelete(sid); return null; }
  /* sliding expiration */
  try {
    sdb.prepare('UPDATE saas_sesi SET last_seen=?,expires_at=? WHERE sid=?')
      .run(now(), addDays(today(), SESSION_DAYS) + ' 23:59:59', row.sid);
  } catch (e) { /* abaikan */ }
  return row;
}
function sessionDelete(sid) { try { sdb.prepare('DELETE FROM saas_sesi WHERE sid=?').run(String(sid)); } catch (e) { /* abaikan */ } }
function sessionPurge() {
  try { return sdb.prepare('DELETE FROM saas_sesi WHERE COALESCE(expires_at,\'\')< ?').run(now()).changes || 0; } catch (e) { return 0; }
}
function sessionHapusTenant(tenantId) {
  try { sdb.prepare('DELETE FROM saas_sesi WHERE tenant_id=?').run(Number(tenantId)); } catch (e) { /* abaikan */ }
}

/* ==================== MENU DEFAULT ==================== */
function menuDefault() {
  const dbm = require('./db');
  const raw = setting('menu_default', '');
  if (raw) {
    let arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch (e) { arr = []; } }
    if (Array.isArray(arr) && arr.length) {
      return arr.filter(n => n && n.key).map((n, i) => ({
        key: String(n.key), label: String(n.label || n.key), icon: String(n.icon || 'LayoutDashboard'),
        hidden: n.hidden ? 1 : 0, urutan: Number(n.urutan) || i + 1
      })).sort((a, b) => a.urutan - b.urutan);
    }
  }
  return dbm.DEFAULT_NAV.map((n, i) => ({ key: n.key, label: n.label, icon: n.icon, hidden: 0, urutan: i + 1 }));
}
function saveMenuDefault(list) {
  const clean2 = (Array.isArray(list) ? list : []).slice(0, 40).map((n, i) => ({
    key: clean(n.key),
    label: clean(n.label),
    icon: clean(n.icon) || 'LayoutDashboard',
    hidden: n.hidden ? 1 : 0,
    urutan: Number(n.urutan) || i + 1
  })).filter(n => n.key);
  setSetting('menu_default', JSON.stringify(clean2));
  return clean2;
}
/** terapkan menu default ke sekolah baru (dipanggil createTenant / tombol terapkan) */
function applyMenuDefault(tenantId) {
  const t = tenantId ? tenantById(tenantId) : null;
  if (!t) return false;
  const list = menuDefault();
  const navUi = {};
  list.forEach((n, i) => { navUi[n.key] = { label: n.label, hidden: n.hidden ? 1 : 0, order: Number(n.urutan) || i + 1 }; });
  try {
    require('./db').useTenant(absDb(t), () => {
      const d = require('./db').db;
      d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run('nav_ui', JSON.stringify(navUi));
    });
    return true;
  } catch (e) { return false; }
}

/* ==================== TIDAK DIPAKAI: berkas DB yatim ====================
   Berkas SQLite di folder `sekolah/` yang tidak lagi dipakai tenant mana pun
   (mis. sisa sekolah yang dihapus permanen). Ditampilkan di Database Manager
   agar Super Admin dapat merapikannya. */
function orphanDbFiles() {
  const dipakai = new Set(sdb.prepare('SELECT db_file FROM tenants').all().map(r => r.db_file));
  let files = [];
  try { files = fs.readdirSync(SEKOLAH_DIR); } catch (e) { return []; }
  const map = new Map();
  for (const f of files) {
    if (!/\.sqlite$/i.test(f)) continue;
    const abs = path.join(SEKOLAH_DIR, f);
    const rel = path.relative(__dirname, abs).split(path.sep).join('/');
    if (dipakai.has(rel)) continue;
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (e) { /* abaikan */ }
    map.set(f, { nama: f, rel, ukuran: size });
  }
  return [...map.values()].sort((a, b) => b.ukuran - a.ukuran);
}
function hapusOrphanDb() {
  const hasil = { dihapus: 0, gagal: 0, ukuran: 0, pesan: [] };
  for (const f of orphanDbFiles()) {
    const abs = path.join(__dirname, f.rel);
    try {
      fs.unlinkSync(abs);
      for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(abs + ext)) fs.unlinkSync(abs + ext); } catch (e) { /* abaikan */ } }
      hasil.dihapus++; hasil.ukuran += f.ukuran;
    } catch (e) { hasil.gagal++; hasil.pesan.push(`${f.nama}: ${e.message}`); }
  }
  if (hasil.dihapus) logAudit('Sistem', 'RAPIKAN BERKAS', 'database', `${hasil.dihapus} berkas database yatim dihapus`);
  return hasil;
}

/* ==================== BACKUP (ZIP / SQL / TELEGRAM) ==================== */
function telegramCfg() {
  const s = settings();
  const credentials = telegramCredentials();
  return {
    token_set: Boolean(credentials.token),
    token_masked: telegramBackup.maskSecret(credentials.token),
    chat: credentials.chat,
    auto: String(s.telegram_auto) === '1',
    jam: telegramBackup.safeSchedule(s.telegram_jam, '02:00'),
    terakhir: s.telegram_terakhir || ''
  };
}
function telegramCredentials() {
  const s = settings();
  return {
    token: clean(process.env.TELEGRAM_BOT_TOKEN || s.telegram_bot_token),
    chat: clean(process.env.TELEGRAM_CHAT_ID || s.telegram_chat_id)
  };
}
function backupLog(jenis, nama, ukuran, status, pesan, pemicu, oleh) {
  try {
    sdb.prepare('INSERT INTO saas_backup_log(jenis,nama,ukuran,status,pesan,pemicu,oleh,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(jenis, clean(nama), Number(ukuran) || 0, status, clean(pesan), clean(pemicu), clean(oleh), now());
  } catch (e) { /* abaikan */ }
}
function backupLogList() {
  return sdb.prepare('SELECT * FROM saas_backup_log ORDER BY id DESC LIMIT 60').all();
}
async function sendTelegram(fileBuf, filename, caption) {
  const cfg = telegramCredentials();
  await telegramBackup.sendDocument(cfg.token, cfg.chat, fileBuf, filename, caption);
  setSetting('telegram_terakhir', now());
  return true;
}
async function testTelegram(token, chat) {
  const cfg = telegramCredentials();
  return telegramBackup.testConnection(clean(token) || cfg.token, clean(chat) || cfg.chat);
}

/* ==================== RINGKASAN SEKOLAH (panel tenant) ==================== */
function ringkasanTenant(tenantId) {
  const t = decorateTenant(tenantById(tenantId));
  if (!t) return null;
  const tagihan = tagihanAktif(t.id);
  const paket = paketByKode(t.paket) || null;
  const pembayaran = sdb.prepare('SELECT * FROM saas_pembayaran WHERE tenant_id=? ORDER BY id DESC LIMIT 10').all(t.id);
  return {
    tenant: t, paket, tagihan,
    pembayaran,
    sisa_hari: t.aktif_sampai
      ? Math.ceil((new Date(t.aktif_sampai + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000) : null,
    pengumuman: pengumumanList({ aktifOnly: true }).slice(0, 5),
    harga_bulanan: hargaTenant(t, 1),
    harga_tahunan: hargaTenant(t, 12),
    paket_list: paketList({ aktifOnly: true }).map(p => ({
      kode: p.kode, nama: p.nama, harga_bulanan: p.harga_bulanan, harga_tahunan: p.harga_tahunan,
      deskripsi: p.deskripsi, trial_hari: p.trial_hari, fitur: p.fitur
    })),
    promo: promos().map(p => ({ kode: p.kode, persen: Number(p.persen) || 0 })),
    qris: { img: setting('qris_img'), nama: setting('rek_nama'), nomor: setting('rek_nomor'), instruksi: setting('instruksi_bayar') }
  };
}

/* ==================== INISIALISASI ==================== */
function init() {
  /* ---- migrasi kontrol plane: kolom portal_slug (slug publik portal siswa) ---- */
  try {
    const cols = sdb.prepare("PRAGMA table_info(tenants)").all().map(c => c.name);
    if (!cols.includes('portal_slug')) sdb.exec('ALTER TABLE tenants ADD COLUMN portal_slug TEXT');
    /* harga langganan khusus per sekolah (0 / NULL = mengikuti harga paket) */
    if (!cols.includes('harga_bulanan')) sdb.exec('ALTER TABLE tenants ADD COLUMN harga_bulanan INTEGER DEFAULT 0');
    if (!cols.includes('harga_tahunan')) sdb.exec('ALTER TABLE tenants ADD COLUMN harga_tahunan INTEGER DEFAULT 0');
    if (!cols.includes('harga_catatan')) sdb.exec('ALTER TABLE tenants ADD COLUMN harga_catatan TEXT');
  } catch (e) { console.error('[saas] migrasi portal_slug/harga gagal:', e.message); }

  /* ---- migrasi kolom payment gateway pada tabel pembayaran ---- */
  try {
    const cols = sdb.prepare('PRAGMA table_info(saas_pembayaran)').all().map(c => c.name);
    const add = (name, ddl) => { if (!cols.includes(name)) sdb.exec(`ALTER TABLE saas_pembayaran ADD COLUMN ${name} ${ddl}`); };
    add('channel', "TEXT DEFAULT 'manual'");     // manual | gateway
    add('provider', 'TEXT');
    add('order_id', 'TEXT');
    add('qr_string', 'TEXT');
    add('qr_url', 'TEXT');
    add('checkout_url', 'TEXT');
    add('gateway_status', 'TEXT');
    add('gateway_payload', 'TEXT');
    add('paid_at', 'TEXT');
    add('expires_at', 'TEXT');
    sdb.exec('CREATE INDEX IF NOT EXISTS idx_bayar_order ON saas_pembayaran(order_id)');
  } catch (e) { console.error('[saas] migrasi kolom gateway gagal:', e.message); }

  /* paket bawaan */
  if (!sdb.prepare('SELECT COUNT(*) c FROM saas_paket').get().c) {
    for (const p of PAKET_DEFAULT) {
      sdb.prepare(`INSERT INTO saas_paket(kode,nama,harga_bulanan,harga_tahunan,deskripsi,trial_hari,fitur,aktif,urutan,created_at)
        VALUES(?,?,?,?,?,?,?,1,?,?)`)
        .run(p.kode, p.nama, p.harga_bulanan, p.harga_tahunan, p.deskripsi, p.trial_hari, JSON.stringify(p.fitur), p.urutan, now());
    }
  }
  /* MODUL AKADEMIK BARU — paket yang menyimpan daftar fitur eksplisit
     (basic/premium) ikut ditambahkan agar sekolah lama tidak kehilangan akses. */
  try {
    const BARU = ['jadwal', 'desain_jadwal', 'absensi_guru', 'absensi_siswa',
      'rekap_absensi_guru', 'rekap_absensi_siswa', 'bk_layanan', 'asesmen', 'asesmen_soal', 'aduan'];
    for (const p of sdb.prepare('SELECT kode,fitur FROM saas_paket').all()) {
      const arr = parseFitur(p.fitur);
      if (!arr.length || arr.includes('*')) continue;
      const tambah = BARU.filter(k => !arr.includes(k));
      if (tambah.length) {
        sdb.prepare('UPDATE saas_paket SET fitur=? WHERE kode=?').run(JSON.stringify([...arr, ...tambah]), p.kode);
      }
    }
    /* tenant dengan fitur_override eksplisit juga mendapat modul akademik */
    for (const t of sdb.prepare("SELECT id,fitur_override FROM tenants WHERE COALESCE(fitur_override,'')<>''").all()) {
      const arr = parseFitur(t.fitur_override);
      if (!arr.length || arr.includes('*')) continue;
      const tambah = BARU.filter(k => !arr.includes(k));
      if (tambah.length) {
        sdb.prepare('UPDATE tenants SET fitur_override=? WHERE id=?').run(JSON.stringify([...arr, ...tambah]), t.id);
      }
    }
  } catch (e) { console.error('[saas] migrasi fitur paket gagal:', e.message); }

  /* akun super admin pertama */
  if (!sdb.prepare('SELECT COUNT(*) c FROM saas_admins').get().c) {
    const user = clean(process.env.SAAS_ADMIN_USER) || 'superadmin';
    const pass = clean(process.env.SAAS_ADMIN_PASS) || 'superadmin123';
    const phone = lib.normPhone(process.env.SAAS_ADMIN_PHONE || '');
    sdb.prepare('INSERT INTO saas_admins(nama,username,email,phone,pass_hash,aktif,created_at) VALUES(?,?,?,?,?,1,?)')
      .run('Super Admin', user, clean(process.env.SAAS_ADMIN_EMAIL), phone || null, lib.hashPassword(pass), now());
  }
  const adminPhone = lib.normPhone(process.env.SAAS_ADMIN_PHONE || '');
  if (clean(process.env.SAAS_ADMIN_PHONE) && !adminPhone) {
    console.error('[saas] SAAS_ADMIN_PHONE tidak valid; nomor pemulihan tidak disimpan.');
  } else if (adminPhone) {
    const username = clean(process.env.SAAS_ADMIN_USER) || 'superadmin';
    sdb.prepare("UPDATE saas_admins SET phone=? WHERE lower(username)=lower(?) AND COALESCE(phone,'')=''")
      .run(adminPhone, username);
  }
  /* ---- normalisasi sakelar boolean lama ----
     Versi sebelumnya menyimpan nilai formulir apa adanya ("true"/"false"),
     sedangkan pembaca hanya mengenali '1' → aktifkan/tutup tidak pernah tersimpan.
     Nilai lama dirapikan sekali di sini agar konsisten ('1' / '0'). */
  for (const key of ['pendaftaran_aktif', 'maintenance_aktif']) {
    const raw = sdb.prepare('SELECT value FROM saas_settings WHERE key=?').get(key);
    if (!raw) continue;
    const v = String(raw.value === null || raw.value === undefined ? '' : raw.value).trim().toLowerCase();
    if (!v) { setSetting(key, key === 'pendaftaran_aktif' ? '1' : '0'); continue; }  // kosong = bawaan
    if (v !== '1' && v !== '0') setSetting(key, isOn(v) ? '1' : '0');
  }

  /* teks legal bawaan */
  if (!setting('tos_isi')) setSetting('tos_isi', DEFAULT_TOS);
  if (!setting('sla_isi')) setSetting('sla_isi', DEFAULT_SLA);

  /* tenant utama: database yang SUDAH ADA dipakai sekolah pertama (Lifetime) */
  const dbm = require('./db');
  const relMain = path.relative(__dirname, dbm.DB_PATH).split(path.sep).join('/');
  const adaMain = sdb.prepare("SELECT id FROM tenants WHERE db_file=?").get(relMain);
  /* sekolah yang berkas DB-nya sudah tidak ada (mis. sisa pengujian) dibersihkan
     agar panel Super Admin tidak menampilkan tenant hantu */
  for (const t of sdb.prepare('SELECT id,kode,nama,db_file FROM tenants').all()) {
    if (t.db_file === relMain) continue;
    if (!fs.existsSync(absDb(t))) {
      sdb.prepare('DELETE FROM tenants WHERE id=?').run(t.id);
      logAudit('Sistem', 'BERSIHKAN', 'sekolah', `Tenant ${t.nama} (${t.kode}) dihapus — berkas database tidak ditemukan`);
    }
  }
  if (!adaMain) {
    const rel = path.relative(__dirname, dbm.DB_PATH).split(path.sep).join('/');
    const nama = (() => {
      try { return dbm.getSetting('sekolah_nama', '') || 'Sekolah Pertama'; } catch (e) { return 'Sekolah Pertama'; }
    })();
    const jenjang = (() => {
      try { return clean(dbm.getSetting('sekolah_bentuk', 'SMK')).toUpperCase() || 'SMK'; } catch (e) { return 'SMK'; }
    })();
    const kode = (() => {
      try {
        const npsn = clean(dbm.getSetting('sekolah_npsn', ''));
        if (/^\d{4,}$/.test(npsn)) return npsn.slice(-4);
      } catch (e) { /* abaikan */ }
      return randomKode();
    })();
    let kodeFinal = kode;
    if (sdb.prepare('SELECT 1 FROM tenants WHERE kode=?').get(kodeFinal)) kodeFinal = randomKode();
    const alamat0 = (() => { try { return dbm.getSetting('sekolah_alamat', ''); } catch (e) { return ''; } })();
    const kepala0 = (() => { try { return dbm.getSetting('kepala_nama', ''); } catch (e) { return ''; } })();
    const telp0 = (() => { try { return dbm.getSetting('sekolah_telp', ''); } catch (e) { return ''; } })();
    const email0 = (() => { try { return dbm.getSetting('sekolah_email', ''); } catch (e) { return ''; } })();
    sdb.prepare(`INSERT INTO tenants(kode,nama,slug,jenjang,alamat,kepala,kontak_nama,telp,email_admin,
        paket,status,lifetime,trial_berakhir,aktif_sampai,custom_domain,portal_aktif,db_file,catatan,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(kodeFinal, nama, uniqueSlug(nama), dbm.JENJANG.includes(jenjang) ? jenjang : 'SMK',
        alamat0, kepala0, kepala0, telp0, email0,
        'lifetime', 'aktif', 1, '', '', null, 1, rel,
        'Sekolah pertama — paket Lifetime (data lama dipertahankan)', now(), now());

    /* tandai kode tenant di DB sekolah */
    try {
      dbm.setSetting('tenant_kode', kodeFinal);
    } catch (e) { /* abaikan */ }
    logAudit('Sistem', 'INISIALISASI', 'sekolah', `Sekolah lama dijadikan tenant Lifetime (kode ${kodeFinal})`);
  }

  /* ---- backfill slug portal untuk tenant lama -------------------------
     Slug portal WAJIB ada di setiap sekolah (alamat publik portal siswa).
     Nilai diisi dari slug lama / nama sekolah, menghindari kata terlarang. */
  for (const t of sdb.prepare('SELECT * FROM tenants').all()) {
    const ada = clean(t.portal_slug);
    if (ada && !portalSlugError(ada, t.id)) continue;
    const slug = uniquePortalSlug(t.nama, t.id);
    sdb.prepare('UPDATE tenants SET portal_slug=? WHERE id=?').run(slug, t.id);
  }
}

const DEFAULT_TOS = `1. Layanan SMART TATA TERTIB SISWA disediakan sebagai layanan berlangganan (SaaS) untuk sekolah.
2. Sekolah bertanggung jawab atas kebenaran data yang diunggah, termasuk data siswa dan wali murid.
3. Akun administrator sekolah bersifat rahasia dan tidak boleh dibagikan kepada pihak lain.
4. Platform tidak menggunakan data sekolah untuk keperluan selain operasional layanan.
5. Pembayaran langganan bersifat di muka. Keterlambatan perpanjangan dapat menyebabkan akun ditangguhkan sementara.
6. Sekolah dapat menghentikan layanan kapan saja; data dapat diekspor sebelum masa aktif berakhir.
7. Pelanggaran terhadap ketentuan ini dapat menyebabkan pembatasan akses layanan.`;
const DEFAULT_SLA = `1. Ketersediaan layanan (uptime) ditargetkan minimal 99% per bulan.
2. Gangguan kritis (aplikasi tidak dapat diakses) ditangani maksimal 4 jam kerja.
3. Permintaan bantuan melalui Pusat Bantuan dijawab maksimal 1×24 jam kerja.
4. Pemeliharaan terjadwal diinformasikan melalui menu Pengumuman minimal 1 hari sebelumnya.
5. Pencadangan data dilakukan otomatis setiap hari.
6. Kuota penyimpanan berkas mengikuti paket langganan yang aktif.`;

init();

module.exports = {
  sdb, SAAS_DB, DATA_DIR, SEKOLAH_DIR, now, today, addDays, addMonths,
  setting, setSetting, settings, assistantConfig, branding, brandingVersion, bumpBranding, isOn, clearBrandCache, promos, promoFind,
  logAudit, auditList,
  paketList, paketByKode, savePaket, deletePaket, fiturPaket, allowedFeatures, parseFitur,
  tenants, tenantById, tenantUtama, tenantByKode, tenantBySlug, tenantByDomain, tenantByPortalSlug,
  tenantStats, tenantSiswaCount, PORTAL_SUFIX, portalSlugOf, portalPathOf, portalSlugError, setPortalSlug,
  uniquePortalSlug, slugIsReserved,
  decorateTenant, decorate: decorateTenant, createTenant, updateTenant, setTenantStatus, setTenantPassword,
  impersonateUserId, deleteTenant, hapusPermanen, randomPassword, randomKode, defaultPassword, absDb,
  checkDomain, setTenantDomain,
  tagihanList, tagihanAktif, ensureTagihan, hargaPaket, hargaTenant, bayarManual, verifikasiPembayaran,
  payConfig, gatewayCfg, bayarGateway, gatewayRow, gatewayMarkPaid, gatewaySync, payment,
  kaseraWebhookUrl, kaseraHandleWebhook, kaseraEvents,
  pembayaranList, perpanjang, runBillingCheck,
  waConfig, waSend, waNotify, waLogList, buildWaUrl,
  tiketList, tiketDetail, tiketBuat, tiketBalas, TIKET_STATUS, TIKET_KATEGORI,
  pengumumanList, pengumumanSave, pengumumanDelete,
  panduanList, panduanSave, panduanDelete, youtubeId,
  adminByUsername, adminByEmail, adminById, adminSave, adminUpdateSelf,
  sessionSave, sessionGet, sessionDelete, sessionPurge, sessionHapusTenant,
  menuDefault, saveMenuDefault, applyMenuDefault,
  orphanDbFiles, hapusOrphanDb,
  telegramCfg, backupLog, backupLogList, sendTelegram, testTelegram,
  ringkasanTenant, statusTenantLabel, init
};
