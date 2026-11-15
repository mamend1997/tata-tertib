'use strict';
/**
 * ==================================================================
 * ZONA WAKTU APLIKASI (WIB / Asia/Jakarta)
 * ------------------------------------------------------------------
 * Modul ini WAJIB dimuat paling awal (lewat `env.js`, yang di-require
 * pertama oleh `db.js` & `server.js`) supaya seluruh `new Date()` di
 * proses ini — termasuk worker latar (pengiriman WA, penjadwalan
 * pengingat, backup otomatis) — memakai jam dinding Asia/Jakarta.
 *
 * Cara pakai:
 *   const tz = require('./tz');          // TZ sudah diterapkan
 *   tz.TZ                                 // 'Asia/Jakarta'
 *   tz.info()                             // { tz, label:'WIB', offset:'+07:00', now: Date }
 *
 * Diatur lewat `.env`:
 *   APP_TIMEZONE=Asia/Jakarta             (default bila kosong)
 *
 * Catatan SQLite:
 *   `CURRENT_TIMESTAMP` di SQLite SELALU UTC (tidak terpengaruh TZ proses).
 *   Karena itu aplikasi tidak memakainya. Untuk "sekarang" di dalam SQL pakai
 *   fungsi terdaftar `now_wib()` / `today_wib()` (didaftarkan di db.js pada
 *   setiap koneksi), atau `datetime('now','localtime')` yang menghormati TZ proses.
 * ==================================================================
 */
const DEFAULT_TZ = 'Asia/Jakarta';
/** alias jamak yang sering ditulis pengguna di .env */
const ALIASES = {
  wib: 'Asia/Jakarta',
  'wib/gmt+7': 'Asia/Jakarta',
  'gmt+7': 'Asia/Jakarta',
  jakarta: 'Asia/Jakarta',
  'asia/jakarta': 'Asia/Jakarta',
  wita: 'Asia/Makassar',
  wit: 'Asia/Jayapura',
  utc: 'UTC',
  gmt: 'UTC'
};
/** label singkat zona waktu Indonesia */
const LABELS = { 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT', UTC: 'UTC' };

function isValid(tz) {
  const v = String(tz || '').trim();
  if (!v) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch (e) { return false; }
}

/**
 * Terapkan zona waktu ke proses. Aman dipanggil berkali-kali (idempotent).
 * Nilai tidak dikenal → kembali ke Asia/Jakarta (dicatat di `applyWarning`).
 */
let applyWarning = '';
function apply(raw) {
  const wanted = String(raw === undefined || raw === null ? '' : raw).trim();
  let tz = DEFAULT_TZ;
  applyWarning = '';
  if (wanted) {
    const alias = ALIASES[wanted.toLowerCase()];
    if (alias) tz = alias;
    else if (isValid(wanted)) tz = wanted;
    else {
      applyWarning = `APP_TIMEZONE "${wanted}" tidak dikenal — memakai ${DEFAULT_TZ}.`;
      tz = DEFAULT_TZ;
    }
  }
  // process.env.TZ dibaca ulang oleh Node (Date) & oleh pustaka native (SQLite localtime)
  process.env.TZ = tz;
  process.env.APP_TIMEZONE = tz;
  return tz;
}

const TZ = apply(process.env.APP_TIMEZONE || process.env.TZ || DEFAULT_TZ);

/** bagian waktu lokal pada zona `tz` untuk sebuah Date */
function partsOf(date, tz = TZ) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const x of fmt.formatToParts(d)) if (x.type !== 'literal') p[x.type] = x.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second)
  };
}

/** selisih zona terhadap UTC dalam menit (WIB = 420) */
function offsetMinutes(date = new Date(), tz = TZ) {
  const p = partsOf(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
function offsetLabel(date = new Date(), tz = TZ) {
  const m = offsetMinutes(date, tz);
  const sign = m < 0 ? '-' : '+';
  const a = Math.abs(m);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function label(tz = TZ) {
  return LABELS[tz] || tz;
}

/** ringkasan untuk log startup & halaman konfigurasi */
function info(date = new Date()) {
  return {
    tz: TZ,
    label: label(),
    offset: offsetLabel(date),
    offsetMinutes: offsetMinutes(date),
    now: date,
    warning: applyWarning,
    isWib: offsetMinutes(date) === 420
  };
}
/** satu baris log startup: "[tz] Asia/Jakarta (WIB +07:00) — sekarang 04-11-2026 12:05:31 WIB" */
function startupLine() {
  const i = info();
  const d = i.now;
  const p = n => String(n).padStart(2, '0');
  const q = partsOf(d);
  return `[tz] ${i.tz} (${i.label} ${i.offset}) — sekarang ${p(q.day)}-${p(q.month)}-${q.year} ${p(q.hour)}:${p(q.minute)}:${p(q.second)} ${i.label}` +
    (i.warning ? ` — ${i.warning}` : '');
}

module.exports = {
  TZ, DEFAULT_TZ, ALIASES, LABELS, apply, isValid, partsOf, offsetMinutes, offsetLabel,
  label, info, startupLine,
  get warning() { return applyWarning; }
};
