'use strict';
/* =====================================================================
   SMART TATA TERTIB SISWA — server HTTP (tanpa framework)
   ===================================================================== */
require('./tz');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbm = require('./db');
const lib = require('./lib');
const doc = require('./doc');
const saas = require('./saas');
const telegramBackup = require('./telegram-backup');
const assistantHelp = require('./assistant');
const { db } = dbm;

const PORT = Number(process.env.PORT || 3000);
const DIST = path.join(__dirname, 'dist');
const COOKIE = 'stt_sid';          // sesi pengguna sekolah (tenant)
const COOKIE_SUPER = 'stt_super';  // sesi Super Admin platform
const COOKIE_TENANT = 'stt_tenant';// kode sekolah terakhir (untuk portal & login)
const APP_VERSION = '1.0.0';

/* ============================ util ============================ */
const json = (res, code, body) => {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
  res.end(data);
};
const fail = (res, code, message, extra) => json(res, code, { ok: false, error: message, ...(extra || {}) });
const esc = lib.esc;

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const mimeOf = f => /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp'
  : /\.gif$/i.test(f) ? 'image/gif' : /\.svg$/i.test(f) ? 'image/svg+xml'
    : /\.pdf$/i.test(f) ? 'application/pdf' : 'image/jpeg';
let pendingUpload = 0;
function readBody(req, limit = 14 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Ukuran data terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = String(req.headers['content-type'] || '');
      try {
        if (ct.includes('application/json')) return resolve(JSON.parse(raw));
        const out = {};
        for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
        resolve(out);
      } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}
const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

/**
 * Body MENTAH (byte asli) — dipakai verifikasi tanda tangan webhook payment
 * gateway (HMAC dihitung dari body yang dikirim gateway, bukan hasil parse).
 */
function readRaw(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Ukuran data terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Rute yang DIKECUALIKAN dari proteksi CSRF: dipanggil server pihak ketiga
 * (payment gateway) tanpa cookie sesi & tanpa form, jadi tidak mungkin
 * membawa token CSRF. Aplikasi ini memakai cookie sesi, dan daftar ini juga
 * dipakai bila proteksi CSRF diaktifkan di reverse proxy.
 */
const CSRF_EXEMPT = new Set(['/api/webhook/kasera', '/api/pay/callback', '/api/super/login', '/api/login']);
const isCsrfExempt = p => CSRF_EXEMPT.has(String(p || ''));

/* ---------- sesi (PERSISTEN di database → tidak logout saat server restart) ----------
   Sesi disimpan pada tabel `sesi` dan diperpanjang otomatis setiap ada aktivitas
   (sliding expiration, `session_days` default 90 hari). Dengan begitu pengguna
   TETAP masuk selama memakai aplikasi, termasuk setelah aplikasi di-restart. */
/* ================= SESI MULTI-TENANT =================
   Sesi disimpan di control plane (saas_sesi) agar server dapat mengetahui
   SEKOLAH MANA yang harus dibuka sebelum menyentuh database sekolah.
   Dua cookie terpisah:
     stt_sid   → pengguna sekolah (tenant)
     stt_super → Super Admin platform (boleh membuka panel sekolah mana pun) */
const SESSION_COOKIE_MAX = () => 365 * 86400;
const sessionDays = () => Math.max(1, Math.min(365, Number(dbm.getSetting('session_days', 90)) || 90));
let lastSessionPurge = 0;

const tenantDbFile = t => saas.absDb(t);
const tenantAktif = t => {
  if (!t) return false;
  if (t.status === 'nonaktif' || t.status === 'ditangguhkan') return false;
  if (Number(t.lifetime) === 1) return true;
  return !t.aktif_sampai || t.aktif_sampai >= lib.todayISO();
};

/** konteks permintaan: sesi + sekolah (tenant) yang dipakai */
function contextOf(req) {
  if (req.__ctx) return req.__ctx;
  const cookies = parseCookies(req);
  const out = { scope: null, sid: null, tenant: null, user: null, session: null };

  /* 1. sesi pengguna sekolah */
  const sid = cookies[COOKIE];
  if (sid) {
    const row = saas.sessionGet(sid);
    if (row && row.scope === 'tenant') {
      const tenant = saas.tenantById(row.tenant_id);
      if (tenant) {
        out.sid = sid; out.scope = 'tenant'; out.session = row; out.tenant = tenant;
        try {
          out.user = dbm.useTenant(tenantDbFile(tenant), () => dbm.userById(row.user_id));
        } catch (e) { out.user = null; }
        if (!out.user || !out.user.aktif) { saas.sessionDelete(sid); out.scope = null; out.user = null; }
      } else saas.sessionDelete(sid);
    } else if (row && row.scope === 'super') {
      /* cookie lama super admin di slot tenant → perlakukan sebagai super */
      out.sid = sid; out.scope = 'super'; out.session = row;
      out.user = saas.adminById(row.user_id);
    }
  }

  /* 2. sesi Super Admin (cookie terpisah) — diutamakan bila permintaan datang
        dari panel platform (header X-Client-Panel: saas) agar Super Admin bisa
        memakai panel di browser yang sama dengan sesi sekolah. */
  const dariPanel = String(req.headers['x-client-panel'] || '') === 'saas';
  if (out.scope !== 'tenant' || dariPanel) {
    const sidS = cookies[COOKIE_SUPER];
    if (sidS) {
      const row = saas.sessionGet(sidS);
      if (row && row.scope === 'super') {
        const admin = saas.adminById(row.user_id);
        if (admin && admin.aktif) {
          out.sidS = sidS; out.scope = 'super'; out.session = row; out.user = admin;
          if (dariPanel) { out.tenant = null; out.sid = null; }   // panel platform: tanpa konteks sekolah
        } else saas.sessionDelete(sidS);
      }
    }
  }

  /* 3. tidak ada sesi → tetap bisa menentukan sekolah dari cookie/kode (portal publik),
        lalu jatuh ke sekolah utama (instalasi satu sekolah) */
  if (!out.tenant) {
    const kode = String(req.headers['x-sekolah-kode'] || '') || cookies[COOKIE_TENANT] || '';
    out.tenant = (kode && saas.tenantByKode(kode)) || saas.tenantUtama();
  }
  if (Date.now() - lastSessionPurge > 3600000) {
    lastSessionPurge = Date.now();
    try { saas.sessionPurge(); dbm.sessionPurge(); } catch (e) { /* abaikan */ }
  }
  req.__ctx = out;
  return out;
}

/** sesi untuk endpoint yang membutuhkan login (tenant ATAU super admin) */
function sessionFrom(req) {
  const c = contextOf(req);
  if (!c.user) return null;
  return { sid: c.sid || c.sidS, scope: c.scope, user: c.user, tenant: c.tenant, session: c.session };
}

function setCookie(res, name, value, maxAge) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [String(prev)]) : [];
  list.push(`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
  res.setHeader('Set-Cookie', list);
}
function cookieValue(res, name, value, maxAge) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [String(prev)]) : [];
  list.push(`${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
  res.setHeader('Set-Cookie', list);
}

/** buat sesi pengguna sekolah */
function createSession(res, user, req, tenant) {
  const sid = crypto.randomBytes(24).toString('hex');
  saas.sessionSave(sid, { scope: 'tenant', userId: user.id, tenantId: tenant.id, ua: req ? req.headers['user-agent'] : '' });
  setCookie(res, COOKIE, sid, 365 * 86400);
  cookieValue(res, COOKIE_TENANT, tenant.kode, 365 * 86400);
  try {
    saas.sdb.prepare('UPDATE tenants SET terakhir_masuk=? WHERE id=?').run(lib.nowStamp(), tenant.id);
  } catch (e) { /* abaikan */ }
  return sid;
}
/** buat sesi super admin */
function createSuperSession(res, admin, req) {
  const sid = crypto.randomBytes(24).toString('hex');
  saas.sessionSave(sid, { scope: 'super', userId: admin.id, ua: req ? req.headers['user-agent'] : '' });
  setCookie(res, COOKIE_SUPER, sid, 365 * 86400);
  return sid;
}
/** perpanjang cookie yang sudah ada (dipanggil pada aktivitas login/bootstrap) */
function refreshSessionCookie(res, ctx) {
  if (!ctx) return;
  if (ctx.sid) setCookie(res, COOKIE, ctx.sid, 365 * 86400);
  if (ctx.sidS) setCookie(res, COOKIE_SUPER, ctx.sidS, 365 * 86400);
  if (ctx.tenant) cookieValue(res, COOKIE_TENANT, ctx.tenant.kode, 365 * 86400);
}
function destroySession(req, res, scope) {
  const c = contextOf(req);
  if (scope === 'super') {
    if (c.sidS) saas.sessionDelete(c.sidS);
    setCookie(res, COOKIE_SUPER, '', 0);
    return;
  }
  if (c.sid) saas.sessionDelete(c.sid);
  setCookie(res, COOKIE, '', 0);
}

/* ---------- RBAC + kendali paket/tenant ---------- */
/* Menu akun tetap terbuka walau sekolah ditangguhkan / paket tidak mencakup,
   supaya sekolah dapat memperpanjang & menghubungi bantuan. */
const ALWAYS_FEATURES = ['langganan', 'tiket', 'panduan', 'legal'];

/** fitur apa saja yang dibuka oleh paket sekolah (null = semua) */
function fiturTenant(req) {
  const c = contextOf(req);
  if (!c.tenant) return null;
  if (c.scope === 'super') return null;             // super admin selalu penuh
  return saas.allowedFeatures(c.tenant);
}
function fiturBoleh(req, feature) {
  if (ALWAYS_FEATURES.includes(feature)) return true;
  const list = fiturTenant(req);
  if (!list) return true;
  return list.includes(feature);
}
function guard(req, res, feature, action) {
  const s = sessionFrom(req);
  if (!s) { fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.'); return null; }
  /* MODE PEMELIHARAAN: seluruh akun sekolah diblokir (Super Admin tetap bebas
     karena memakai endpoint /api/super/... dan tidak melewati guard ini). */
  if (String(isMaintenance().aktif) === '1' && s.scope !== 'super') {
    fail(res, 503, isMaintenance().pesan);
    return null;
  }
  if (s.scope === 'super') {
    /* Super Admin memakai endpoint panel platform (/api/super/...) atau "Login as Tenant"
       untuk masuk ke panel sekolah — bukan endpoint operasional sekolah. */
    fail(res, 400, 'Panel Super Admin tidak memakai endpoint ini. Gunakan tombol "Login as Tenant" untuk membuka panel sekolah.');
    return null;
  }
  const tenant = s.tenant;
  if (tenant && tenant.status === 'ditangguhkan' && !ALWAYS_FEATURES.includes(feature)) {
    fail(res, 402, 'Masa aktif layanan sekolah sudah berakhir (akun ditangguhkan). Silakan perpanjang melalui menu Info & Layanan.');
    return null;
  }
  if (!dbm.can(s.user, feature, action)) {
    fail(res, 403, `Anda tidak memiliki izin "${(dbm.ACTION_LABEL[action] || action)}" pada modul ini.`);
    return null;
  }
  if (!fiturBoleh(req, feature)) {
    fail(res, 403, 'Modul ini tidak termasuk dalam paket langganan sekolah Anda. Silakan tingkatkan paket melalui menu Info & Layanan.');
    return null;
  }
  return s.user;
}
/** guard khusus Super Admin platform */
function guardSuper(req, res) {
  const c = contextOf(req);
  if (!c.user || c.scope !== 'super') {
    fail(res, 401, c.user ? 'Hanya Super Admin platform yang dapat membuka panel ini.' : 'Sesi berakhir. Silakan masuk kembali.');
    return null;
  }
  return c.user;
}
/** guard untuk halaman sekolah (bukan super admin) */
function guardTenant(req, res, feature, action) {
  const c = contextOf(req);
  if (c.scope === 'super') {
    fail(res, 400, 'Panel Super Admin tidak memakai endpoint ini. Gunakan "Login as Tenant" untuk membuka panel sekolah.');
    return null;
  }
  return guard(req, res, feature, action);
}
const baseOf = req => {
  const h = String(req.headers['x-public-base-path'] || '').replace(/\/+$/, '');
  return /^\/[A-Za-z0-9\-._~]*$/.test(h) ? h : '';
};
/** alamat absolut aplikasi (dipakai tautan portal & WA) */
function appBaseUrl(req) {
  const env = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (env) return env + baseOf(req);
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${host}${baseOf(req)}`;
}

/* ---------- filter periode ----------
   Satu tahun pelajaran penuh: pilihan semester dihapus dari antarmuka, jadi
   tanpa parameter `semester` data TIDAK lagi dibatasi semester (semua riwayat
   dalam TA tersebut ikut terhitung). `semester` masih diterima demi kompatibilitas. */
function filters(q) {
  const qq = q || {};
  /* `ta` dari peramban bisa menunjuk tahun pelajaran yang sudah DIHAPUS (nilai
     lama di localStorage) — nilai seperti itu diabaikan agar data tidak kosong. */
  const ids = dbm.tahunList().map(t => Number(t.id));
  const diminta = Number(qq.ta) || 0;
  const ta = (diminta && ids.includes(diminta)) ? diminta
    : (ids.includes(Number(dbm.getSetting('ta_aktif', 0))) ? Number(dbm.getSetting('ta_aktif', 0))
      : ((dbm.tahunAktif() || {}).id || ids[0] || null));
  const semester = ['ganjil', 'genap'].includes(qq.semester) ? qq.semester : '';
  return { taId: ta, semester };
}
const numOr = v => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : null);

/* ---------- mode pemeliharaan platform ---------- */
function isMaintenance() {
  let b = {};
  try { b = saas.branding() || {}; } catch (e) { b = {}; }
  return {
    aktif: b.maintenance ? '1' : '0',
    pesan: b.maintenance_pesan || 'Sistem sedang dalam pemeliharaan, silakan coba beberapa saat lagi.'
  };
}

/* ---------- import kategori poin (Excel/CSV) ----------
   Kolom minimal: NAMA + POIN. JENIS (pelanggaran/prestasi) & KETERANGAN opsional.
   Baris tanpa nama/poin valid dilaporkan sebagai error; kategori dengan nama+jenis
   yang sama ditandai duplikat dan dilewati. */
function importKategoriPreview(buf, filename) {
  const rows = rowsOf(buf, filename);
  const headerIdx = rows.findIndex(row => {
    const head = (row || []).map(c => normName(txt(c)));
    const cNama = headerColumn(head, 'nama kategori', 'nama', 'kategori');
    const cPoin = headerColumn(head, 'poin', 'bobot', 'nilai');
    if (cNama < 0) return false;
    if (cPoin >= 0) return cPoin !== cNama;
    return ['nama kategori', 'nama', 'kategori'].includes(head[cNama]);
  });
  if (headerIdx < 0) throw new Error('Header kolom (NAMA, JENIS, POIN, KETERANGAN) tidak ditemukan pada berkas.');
  const head = rows[headerIdx].map(h => normName(txt(h)));
  const col = (...names) => headerColumn(head, ...names);
  const cNama = col('nama kategori', 'nama', 'kategori');
  const cJenis = col('jenis', 'tipe');
  const cPoin = col('poin', 'bobot', 'nilai');
  const cKet = col('keterangan', 'deskripsi', 'catatan');
  if (cNama < 0) throw new Error('Kolom NAMA wajib ada pada berkas import.');
  if (cPoin < 0) throw new Error('Kolom POIN wajib ada pada berkas import.');

  const ada = db.prepare('SELECT id,nama,jenis FROM kategori').all();
  const kunci = (nama, jenis) => normName(nama) + '|' + jenis;
  const terpakai = new Set(ada.map(k => kunci(k.nama, k.jenis)));
  const terlihat = new Set();
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nama = txt(r[cNama]);
    if (!nama || /^(jumlah|total|keterangan|catatan)\b/i.test(nama)) continue;
    const jenisRaw = normName(cJenis >= 0 ? txt(r[cJenis]) : 'pelanggaran');
    let jenis = 'pelanggaran';
    if (/prestasi|penghargaan|positif|plus/.test(jenisRaw)) jenis = 'prestasi';
    else if (/pelanggaran|minus|negatif|sanksi|hukuman/.test(jenisRaw)) jenis = 'pelanggaran';
    /* kosong / tidak dikenali → pelanggaran (nilai bawaan lembar kerja) */
    const poinRaw = cPoin >= 0 ? txt(r[cPoin]) : '';
    const poin = lib.parseMoney(String(poinRaw).replace(/[^0-9.,-]/g, '')) || Number(String(poinRaw).replace(/[^0-9.-]/g, '')) || 0;
    const ket = cKet >= 0 ? txt(r[cKet]) : '';
    const errs = [];
    if (!String(nama).trim()) errs.push('Nama kategori kosong');
    if (!(poin > 0)) errs.push(`Poin "${poinRaw || '-'}" harus angka lebih dari 0`);
    if (poin > 1000) errs.push('Poin terlalu besar (maksimal 1000)');
    const kk = kunci(nama, jenis);
    let dup = '';
    if (terpakai.has(kk)) dup = `Kategori "${nama}" (${jenis}) sudah ada`;
    else if (terlihat.has(kk)) dup = `Kategori "${nama}" (${jenis}) ganda di berkas ini`;
    terlihat.add(kk);
    out.push({
      baris: i + 1, nama: String(nama).trim(), jenis,
      jenis_label: jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran',
      poin: Math.round(poin), keterangan: String(ket || '').trim(),
      error: errs.join(' • '), duplikat: dup, skip: !!dup
    });
  }
  return out;
}

/* ============================ PORTAL PUBLIK SISWA ============================
   Alamat portal per sekolah:  /<slug-sekolah>/portal-siswa
   - slug diatur Super Admin (detail sekolah) atau admin sekolah (Pengaturan)
   - alamat lama "/portal" (dan "/portal?kode=…") DIHAPUS → 404
   ========================================================================== */
/** path relatif terhadap base aplikasi (platform men-strip prefix sebelum aplikasi) */
function pathTanpaBase(req, pathname) {
  const base = baseOf(req);
  if (base && (pathname === base || pathname.startsWith(base + '/'))) {
    return pathname.slice(base.length) || '/';
  }
  return pathname;
}
/** { slug } bila path berbentuk /<slug>/portal-siswa[/…], selain itu null */
function portalSlugFromPath(p) {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,60})\/portal-siswa(?:\/.*)?$/.exec(p);
  return m ? m[1].toLowerCase() : null;
}
function portalTidakDitemukan(res, judul, pesan, opsi = {}) {
  const brand = saas.branding();
  const base = opsi.base || '';
  const nama = esc(brand.app_nama || 'Aplikasi');
  const logo = brand.logo
    ? `<img src="${esc(brand.logo)}" alt="" width="42" height="42" style="width:42px;height:42px;object-fit:contain;border-radius:12px;background:#fff;padding:4px">`
    : '<div style="width:42px;height:42px;border-radius:12px;background:#ea580c"></div>';
  const tautan = (opsi.tautan || []).map(t =>
    `<a href="${esc(t.href)}" style="display:inline-block;margin:4px 6px 0 0;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;color:#fff;background:#ea580c">${esc(t.label)}</a>`).join('');
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(judul)} · ${nama}</title>
<link rel="icon" href="${base}/favicon.ico">
<style>
  body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:460px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:24px;
        box-shadow:0 18px 40px -24px rgba(15,23,42,.35);text-align:center}
  .brand{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:14px}
  .brand span{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#475569}
  h1{font-size:19px;margin:6px 0 8px}
  p{font-size:13px;line-height:1.65;color:#475569;margin:0 0 6px}
  code{background:#f1f5f9;border-radius:6px;padding:2px 6px;font-size:12px}
  .kode{font-size:44px;font-weight:900;color:#ea580c;line-height:1;margin:8px 0 2px}
  .acts{margin-top:16px}
</style></head><body><div class="card">
  <div class="brand">${logo}<span>${nama}</span></div>
  <div class="kode">404</div>
  <h1>${esc(judul)}</h1>
  <p>${pesan}</p>
  <div class="acts">${tautan}</div>
</div></body></html>`;
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/* ============================ DOKUMEN ============================ */
function sendHtml(res, html, filename) {
  const data = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...(filename ? { 'Content-Disposition': `inline; filename="${filename}"` } : {})
  });
  res.end(data);
}
function sendFile(res, buf, mime, filename, disposition = 'attachment') {
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Content-Disposition': `${disposition}; filename="${filename}"`
  });
  res.end(buf);
}

/* ============================ IMPORT ============================ */
const xr = require('./xlsx-read');

function rowsOf(buf, filename) {
  const list = /\.csv$/i.test(filename) ? xr.readCsv(buf.toString('utf8')) : xr.readXlsx(buf);
  return (list && list[0] && list[0].rows) || [];
}
const txt = (cell) => xr.cellText(cell);

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function headerColumn(head, ...names) {
  const exact = head.findIndex(h => names.includes(h));
  return exact >= 0 ? exact : head.findIndex(h => names.some(n => h.includes(n)));
}
function headerRowIndex(rows, ...groups) {
  return rows.findIndex(row => {
    const head = (row || []).map(c => normName(txt(c)));
    const columns = groups.map(names => headerColumn(head, ...names));
    return columns.every(i => i >= 0) && new Set(columns).size === columns.length;
  });
}
function parseDOB(v) {
  if (v && typeof v === 'object') {
    const r = xr.parseDateCell(v);
    if (r) return r;
    return parseDOB(v.v);
  }
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const r2 = xr.parseDateCell({ v: s, n: null });
  if (r2) return r2;
  return '';
}

function importSiswaPreview(buf, filename) {
  const rows = rowsOf(buf, filename);
  const headerIdx = headerRowIndex(rows,
    ['nama', 'nama siswa', 'nama lengkap'], ['kelas', 'kelas siswa', 'rombel']);
  if (headerIdx < 0) throw new Error('Header kolom (NAMA, NIS, NISN, KELAS, …) tidak ditemukan pada berkas.');
  const head = rows[headerIdx].map(h => normName(txt(h)));
  const col = (...names) => headerColumn(head, ...names);
  const cNama = col('nama'), cNis = col('nis'), cNisn = col('nisn'), cKelas = col('kelas'),
    cGender = col('jenis kelamin', 'gender', 'jk'), cTgl = col('tanggal lahir', 'tgl lahir'),
    cHp = col('hp', 'wa', 'telepon', 'kontak');
  if (cNama < 0) throw new Error('Kolom NAMA wajib ada pada berkas import.');
  const kelasMap = new Map(dbm.kelasList().map(k => [normName(k.nama), k]));
  const existing = db.prepare('SELECT id,nama,nis,nisn,kelas_id FROM siswa').all();
  const byNisn = new Map(existing.filter(s => s.nisn).map(s => [String(s.nisn), s]));
  const byNis = new Map(existing.filter(s => s.nis).map(s => [String(s.nis), s]));
  const byName = new Map(existing.map(s => [normName(s.nama) + '|' + (s.kelas_id || 0), s]));
  const seenNisn = new Set(), seenNis = new Set(), seenName = new Set();
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nama = txt(r[cNama]);
    if (!nama || /^(jumlah|total|keterangan)/i.test(nama)) continue;
    const nis = cNis >= 0 ? txt(r[cNis]) : '';
    const nisn = cNisn >= 0 ? txt(r[cNisn]) : '';
    const kelasNama = cKelas >= 0 ? txt(r[cKelas]) : '';
    const kelas = kelasMap.get(normName(kelasNama));
    let gender = cGender >= 0 ? txt(r[cGender]).toUpperCase() : 'L';
    gender = /^(P|PEREMPUAN|W|F)$/.test(gender) ? 'P' : 'L';
    const tgl = cTgl >= 0 ? parseDOB(r[cTgl]) : '';
    const phone = cHp >= 0 ? lib.normPhone(txt(r[cHp])) : '';
    const errs = [];
    if (!kelas) errs.push(`Kelas "${kelasNama || '-'}" belum terdaftar di Data Kelas`);
    if (cTgl >= 0 && txt(r[cTgl]) && !tgl) errs.push('Tanggal lahir tidak dikenali');
    if (cHp >= 0 && txt(r[cHp]) && !phone) errs.push('Nomor HP orang tua tidak valid');
    let dup = '';
    if (nisn && (byNisn.has(nisn) || seenNisn.has(nisn))) dup = 'NISN sudah ada (duplikat)';
    else if (nis && (byNis.has(nis) || seenNis.has(nis))) dup = 'NIS sudah ada (duplikat)';
    else if (seenName.has(normName(nama) + '|' + (kelas ? kelas.id : 0))) dup = 'Nama sama di kelas yang sama';
    else if (byName.has(normName(nama) + '|' + (kelas ? kelas.id : 0))) dup = 'Nama sama di kelas yang sama (sudah terdaftar)';
    if (nisn) seenNisn.add(nisn);
    if (nis) seenNis.add(nis);
    seenName.add(normName(nama) + '|' + (kelas ? kelas.id : 0));
    out.push({
      baris: i + 1, nama, nis, nisn, kelas: kelas ? kelas.nama : kelasNama, kelas_id: kelas ? kelas.id : null,
      gender, tanggal_lahir: tgl, parent_phone: phone,
      error: errs.join(' • '), duplikat: dup, skip: !!dup
    });
  }
  return out;
}

function importKelasPreview(buf, filename) {
  const rows = rowsOf(buf, filename);
  const headerIdx = headerRowIndex(rows, ['nama kelas', 'kelas'], ['tingkat', 'level']);
  if (headerIdx < 0) throw new Error('Header kolom (NAMA KELAS, TINGKAT, JURUSAN, WALI KELAS) tidak ditemukan.');
  const head = rows[headerIdx].map(h => normName(txt(h)));
  const col = (...n) => headerColumn(head, ...n);
  const cNama = col('nama kelas', 'kelas'), cTingkat = col('tingkat'), cJur = col('jurusan'),
    cWali = col('wali kelas', 'wali');
  const wali = new Map(dbm.waliUsers().map(u => [normName(u.nama), u]));
  const existing = new Set(dbm.kelasList().map(k => normName(k.nama)));
  const seen = new Set();
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nama = cNama >= 0 ? txt(r[cNama]) : '';
    if (!nama) continue;
    let tingkat = (cTingkat >= 0 ? txt(r[cTingkat]) : '').toUpperCase().replace(/[^IVX0-9]/g, '');
    if (!dbm.tingkatList().some(x => String(x).toUpperCase() === tingkat)) {
      const m = /\b(XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)\b/i.exec(nama);
      tingkat = m ? m[1].toUpperCase() : '';
    }
    tingkat = normalisasiTingkat(tingkat, nama);
    const waliNama = cWali >= 0 ? txt(r[cWali]) : '';
    const w = wali.get(normName(waliNama));
    const errs = [];
    if (waliNama && !w) errs.push(`Wali kelas "${waliNama}" tidak ditemukan pada Akun Pengguna (role Wali Kelas)`);
    const dup = existing.has(normName(nama)) || seen.has(normName(nama)) ? 'Nama kelas sudah ada' : '';
    seen.add(normName(nama));
    out.push({
      baris: i + 1, nama, tingkat, jurusan: cJur >= 0 ? txt(r[cJur]) : '',
      wali_nama: w ? w.nama : waliNama, wali_id: w ? w.id : null,
      error: errs.join(' • '), duplikat: dup, skip: !!dup
    });
  }
  return out;
}

/* ---------- import akun guru (Excel/CSV) ---------- */
const ROLE_ALIASES = {
  administrator: 'admin', admin: 'admin',
  'kepala sekolah': 'kepala_sekolah', kepsek: 'kepala_sekolah',
  'guru bk': 'guru_bk', bk: 'guru_bk', 'bimbingan konseling': 'guru_bk',
  'guru kesiswaan': 'kesiswaan', kesiswaan: 'kesiswaan', 'wakasek kesiswaan': 'kesiswaan',
  'wakasek kurikulum': 'wakasek_kurikulum', kurikulum: 'wakasek_kurikulum', wakasekkurikulum: 'wakasek_kurikulum',
  'wali kelas': 'wali_kelas', walikelas: 'wali_kelas',
  'guru mata pelajaran': 'guru', guru: 'guru',
  'guru umum': 'guru_umum', guruumum: 'guru_umum',
  'tenaga administrasi': 'tu', tu: 'tu', 'tenaga administrasi tu': 'tu', administrasi: 'tu'
};
function roleOf(raw) {
  const k = normName(raw).replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  if (ROLE_ALIASES[k]) return ROLE_ALIASES[k];
  const key = k.replace(/\s+/g, '_');
  return dbm.ROLES.includes(key) ? key : '';
}
function importUsersPreview(buf, filename) {
  const rows = rowsOf(buf, filename);
  const headerIdx = headerRowIndex(rows, ['nama', 'nama lengkap'], ['username', 'user']);
  if (headerIdx < 0) throw new Error('Header kolom (NAMA, JABATAN, USERNAME, ROLE, NIP, NO HP, KATA SANDI) tidak ditemukan.');
  const head = rows[headerIdx].map(h => normName(txt(h)));
  const col = (...names) => headerColumn(head, ...names);
  const cNama = col('nama'), cJab = col('jabatan', 'posisi'), cUser = col('username', 'user'),
    cRole = col('role', 'peran'), cNip = col('nip'), cHp = col('hp', 'wa', 'telepon', 'kontak'),
    cPass = col('sandi', 'password', 'pass');
  if (cNama < 0 || cUser < 0) throw new Error('Kolom NAMA dan USERNAME wajib ada pada berkas import.');
  const existing = db.prepare('SELECT id,username FROM users').all();
  const byUser = new Set(existing.map(u => String(u.username).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nama = cNama >= 0 ? txt(r[cNama]) : '';
    if (!nama || /^(jumlah|total|keterangan)/i.test(nama)) continue;
    const username = (cUser >= 0 ? txt(r[cUser]) : '').toLowerCase().replace(/\s+/g, '.');
    const roleRaw = cRole >= 0 ? txt(r[cRole]) : '';
    /* beberapa role sekaligus: "Guru + Wakasek Kurikulum" */
    const roleParts = String(roleRaw).split(/\s*[+/&,]\s*/).map(x => x.trim()).filter(Boolean);
    const roleList = [...new Set(roleParts.map(roleOf).filter(Boolean))];
    const role = roleList[0] || 'guru';
    const extraRoles = roleList.slice(1);
    const pass = cPass >= 0 ? txt(r[cPass]) : '';
    const phone = cHp >= 0 ? lib.normPhone(txt(r[cHp])) : '';
    const errs = [];
    if (!username) errs.push('Username wajib diisi');
    if (cRole >= 0 && roleRaw && !roleList.length) errs.push(`Role "${roleRaw}" tidak dikenali`);
    if (pass && pass.length < 6) errs.push('Kata sandi minimal 6 karakter');
    if (cHp >= 0 && txt(r[cHp]) && !phone) errs.push('Nomor HP tidak valid');
    let dup = '';
    if (username && (byUser.has(username) || seen.has(username))) dup = 'Username sudah dipakai';
    if (username) seen.add(username);
    out.push({
      baris: i + 1, nama, jabatan: cJab >= 0 ? txt(r[cJab]) : '',
      username, role, roles: extraRoles,
      role_label: [role, ...extraRoles].map(x => dbm.ROLE_LABEL[x] || x).join(' + '), role_raw: roleRaw,
      nip: cNip >= 0 ? txt(r[cNip]) : '', phone,
      password: pass || '', error: errs.join(' • '), duplikat: dup, skip: !!dup
    });
  }
  return out;
}

/* ============================ API ============================ */
const routes = [];
const get = (p, fn, opt) => routes.push({ method: 'GET', p, fn, opt: opt || {} });
const post = (p, fn, opt) => routes.push({ method: 'POST', p, fn, opt: opt || {} });
const del = (p, fn, opt) => routes.push({ method: 'DELETE', p, fn, opt: opt || {} });
const assistantRate = new Map();

async function requestAssistantProvider(provider, messages, maxTokens = 700) {
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  let endpoint;
  try {
    const parsed = new URL(baseUrl);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !localHttp)
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid URL');
    endpoint = new URL('chat/completions', baseUrl + '/').toString();
  } catch (e) {
    return { ok: false, error: 'base URL tidak valid' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages
      })
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    let data;
    try { data = await response.json(); } catch (e) {
      return { ok: false, error: 'respons JSON tidak valid' };
    }
    const rawContent = data && data.choices && data.choices[0] && data.choices[0].message
      && data.choices[0].message.content;
    const content = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map(part => typeof part === 'string' ? part : String((part && part.text) || '')).join('')
        : '';
    if (!content.trim()) {
      return { ok: false, error: 'respons tidak berisi jawaban' };
    }
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'koneksi gagal' };
  } finally {
    clearTimeout(timeout);
  }
}

post('/api/super/ai-test', async (req, res) => {
  if (!guardSuper(req, res)) return;
  const config = saas.assistantConfig();
  const providers = [
    { name: 'utama', apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model },
    { name: 'cadangan', apiKey: config.fallbackApiKey, baseUrl: config.fallbackBaseUrl, model: config.fallbackModel }
  ].filter(provider => provider.apiKey);
  if (!providers.length) return fail(res, 400, 'Atur API key penyedia utama atau cadangan terlebih dahulu.');

  const results = [];
  for (const provider of providers) {
    const result = await requestAssistantProvider(provider, [
      { role: 'system', content: 'Kembalikan objek JSON dengan properti answer berisi teks persis OK.' },
      { role: 'user', content: 'Tes koneksi.' }
    ], 32);
    const parsed = result.ok ? assistantHelp.parseAssistantReply(result.content) : null;
    const ok = !!(result.ok && parsed && parsed.answer);
    results.push({
      name: provider.name,
      model: provider.model,
      ok,
      error: ok ? '' : (result.error || 'format respons tidak valid')
    });
  }
  json(res, 200, { ok: results.some(result => result.ok), providers: results });
}, { saas: true });

post('/api/assistant/chat', async (req, res) => {
  const user = guard(req, res, 'dashboard', 'view');
  if (!user) return;
  const session = sessionFrom(req);
  if (!session || session.scope !== 'tenant') return fail(res, 403, 'Asisten edupoin hanya tersedia untuk pengguna sekolah.');

  const body = await readBody(req, 16 * 1024);
  const question = String(body.message || '').trim();
  if (!question || question.length > 1200) return fail(res, 400, 'Pertanyaan wajib diisi dan maksimal 1.200 karakter.');
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
    .slice(-8)
    .map(item => ({ role: item.role, content: String(item.content || '').trim().slice(0, 1000) }))
    .filter(item => item.content);
  const scopeText = [...history.filter(item => item.role === 'user').map(item => item.content), question].join(' ');
  if (!assistantHelp.isInScope(scopeText)) {
    return json(res, 200, { ok: true, answer: assistantHelp.REFUSAL, tour: null });
  }

  const now = Date.now();
  const rateKey = session.sid;
  const rate = assistantRate.get(rateKey) || { start: now, count: 0 };
  if (now - rate.start >= 60_000) { rate.start = now; rate.count = 0; }
  if (rate.count >= 10) return fail(res, 429, 'Batas pertanyaan sementara tercapai. Coba lagi dalam satu menit.');
  rate.count += 1;
  assistantRate.set(rateKey, rate);
  if (assistantRate.size > 500) {
    for (const [key, value] of assistantRate) if (now - value.start > 60_000) assistantRate.delete(key);
  }

  const aiConfig = saas.assistantConfig();
  const providers = [
    { name: 'utama', apiKey: aiConfig.apiKey, baseUrl: aiConfig.baseUrl, model: aiConfig.model },
    { name: 'cadangan', apiKey: aiConfig.fallbackApiKey, baseUrl: aiConfig.fallbackBaseUrl, model: aiConfig.fallbackModel }
  ].filter(provider => provider.apiKey);
  if (!providers.length) {
    return fail(res, 503, 'Asisten AI belum dikonfigurasi. Atur API key utama atau cadangan di Super Admin → Integrasi → AI Tutorial edupoin.');
  }

  const allowedTargets = assistantHelp.TARGETS.filter(target =>
    (!target.feature || (dbm.can(user, target.feature, target.action || 'view') && fiturBoleh(req, target.feature)))
  );
  const failures = [];
  for (const provider of providers) {
    const result = await requestAssistantProvider(provider, [
      { role: 'system', content: assistantHelp.buildSystemPrompt(allowedTargets) },
      ...history,
      { role: 'user', content: question }
    ]);
    if (!result.ok) {
      console.error(`[assistant] penyedia ${provider.name} gagal: ${result.error}`);
      failures.push(`${provider.name}: ${result.error}`);
      continue;
    }
    const parsed = assistantHelp.parseAssistantReply(result.content);
    if (!parsed.answer) {
      console.error(`[assistant] penyedia ${provider.name} mengirim jawaban dengan format tidak valid`);
      failures.push(`${provider.name}: format jawaban tidak valid`);
      continue;
    }
    const target = allowedTargets.find(item => item.id === parsed.tourId) || null;
    return json(res, 200, { ok: true, answer: parsed.answer, tour: target });
  }
  console.error(`[assistant] semua penyedia gagal (${failures.join('; ') || 'unknown'})`);
  fail(res, 502, `Asisten AI tidak tersedia. ${failures.join('; ') || 'Tidak ada penyedia yang dapat digunakan.'} Periksa API key, model, base URL, dan koneksi server pada Super Admin → Integrasi → AI Tutorial edupoin.`);
});

/* ---------- rute platform (panel Super Admin + langganan sekolah) ---------- */
/* nama aplikasi GLOBAL (Branding Sistem) dipakai semua pembaca allSettings():
   halaman internal, dokumen cetak, ekspor, dan arsip backup. */
dbm.setAppNamaGlobal(() => saas.branding().app_nama);

require('./saas-routes')({
  get, post, del, json, fail, readBody, readRaw, guard, guardTenant, guardSuper, contextOf,
  ipOf, lib, saas, dbm, path, fs, appBaseUrl, createSession, createSuperSession
});

/* ---------- publik ---------- */
get('/api/public/config', (req, res, q) => {
  const platform = saas.branding();
  const c = contextOf(req);
  /* ?global=1 → halaman login publik: HANYA branding platform (tanpa data sekolah) */
  const hanyaGlobal = String(q.global || '') === '1';
  const dariSlug = q.slug ? saas.tenantByPortalSlug(q.slug) : null;
  const tenant = hanyaGlobal ? null
    : (dariSlug || (q.kode && saas.tenantByKode(q.kode)) || c.tenant || null);
  const s = tenant ? dbm.allSettings() : {};
  json(res, 200, {
    ok: true,
    /* branding platform (judul halaman login) — sumber tunggal halaman publik */
    platform: {
      app_nama: platform.layanan_nama || platform.app_nama,
      layanan_nama: platform.layanan_nama || platform.app_nama,
      app_nama_default: platform.app_nama,
      app_subtitle: platform.app_subtitle,
      logo: platform.logo, favicon: platform.favicon, domain: platform.domain,
      login_judul: platform.login_judul, login_subjudul: platform.login_subjudul,
      login_deskripsi: platform.login_deskripsi, login_footer: platform.login_footer,
      login_copyright: platform.login_copyright, login_logo: platform.login_logo,
      version: platform.version,
      recaptcha_site: platform.recaptcha_site, daftar_min_detik: platform.daftar_min_detik,
      daftar_otp_aktif: platform.daftar_otp_aktif,
      pendaftaran_aktif: platform.pendaftaran_aktif, trial_hari: platform.trial_hari,
      maintenance: platform.maintenance, maintenance_pesan: platform.maintenance_pesan,
      harga_bulanan: platform.harga_bulanan, harga_tahunan: platform.harga_tahunan
    },
    branding_version: platform.version,
    app_nama: s.app_nama || platform.app_nama,
    app_logo: s.app_logo || s.logo || platform.logo,
    sekolah_nama: tenant ? tenant.nama : '', sekolah_alamat: s.sekolah_alamat || '',
    sekolah_telp: s.sekolah_telp || '', sekolah_email: s.sekolah_email || '', sekolah_website: s.sekolah_website || '',
    kepala_nama: s.kepala_nama || '', kepala_nip: s.kepala_nip || '', npsn: s.sekolah_npsn || '',
    wakasek_nama: s.wakasek_nama || '', wakasek_nip: s.wakasek_nip || '', wakasek_jabatan: s.wakasek_jabatan || '',
    logo: s.logo || '', primary_color: s.primary_color || '', gradient_bg: s.gradient_bg || '',
    portal_aktif: s.portal_aktif !== undefined ? s.portal_aktif : '1',
    portal_judul: s.portal_judul || '', portal_subtitle: s.portal_subtitle || '',
    sekolah_kode: tenant ? tenant.kode : '',
    portal_slug: tenant ? saas.portalSlugOf(tenant) : '',
    version: APP_VERSION
  });
});
/* ---------- resolusi slug portal publik siswa ----------
   Dipakai halaman portal (/<slug>/portal-siswa): mengubah slug di URL menjadi
   kode sekolah, lalu seluruh permintaan portal mengirim header X-Sekolah-Kode
   agar data yang dibaca benar-benar milik sekolah tersebut. */
get('/api/public/portal/:slug', (req, res, q, params) => {
  const slug = String(params.slug || '').toLowerCase();
  const t = saas.tenantByPortalSlug(slug) || saas.tenantByKode(slug);
  if (!t) return fail(res, 404, 'Portal sekolah tidak ditemukan. Periksa kembali tautan yang Anda terima.');
  if (t.status === 'nonaktif') return fail(res, 403, 'Sekolah ini sedang tidak aktif di platform.');
  json(res, 200, {
    ok: true,
    sekolah: { kode: t.kode, nama: t.nama, jenjang: t.jenjang, alamat: t.alamat || '' },
    portal: {
      slug: saas.portalSlugOf(t), path: saas.portalPathOf(t),
      aktif: Number(t.portal_aktif) !== 0
    }
  });
});

/* daftar sekolah untuk pemilih pada halaman login (hanya nama + kode, tanpa data sensitif) */
get('/api/public/sekolah', (req, res, q) => {
  const kw = String(q.q || '').trim().toLowerCase();
  const rows = saas.tenants().filter(t => t.status !== 'nonaktif')
    .filter(t => !kw || (t.nama + ' ' + t.kode).toLowerCase().includes(kw))
    .slice(0, 30)
    .map(t => ({
      kode: t.kode, nama: t.nama, jenjang: t.jenjang, kota: String(t.alamat || '').slice(0, 60),
      portal_slug: saas.portalSlugOf(t), portal_path: saas.portalPathOf(t)
    }));
  json(res, 200, { ok: true, rows });
});

const checkHits = new Map();
post('/api/public/check', async (req, res) => {
  const ip = ipOf(req);
  const nowT = Date.now();
  const arr = (checkHits.get(ip) || []).filter(t => nowT - t < 60000);
  if (arr.length >= 20) return fail(res, 429, 'Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi.');
  arr.push(nowT); checkHits.set(ip, arr);

  if (dbm.getSetting('portal_aktif', '1') !== '1') return fail(res, 403, 'Portal cek poin sedang dinonaktifkan oleh sekolah.');
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  const dob = parseDOB(b.tanggal_lahir);
  if (!nama || !dob) return fail(res, 400, 'Nama lengkap dan tanggal lahir wajib diisi dengan benar.');

  const list = db.prepare(`SELECT s.*, k.nama AS kelas_nama, k.tingkat, k.jurusan, u.nama AS wali_nama
    FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id LEFT JOIN users u ON u.id=k.wali_id
    WHERE s.status='aktif'`).all();
  const target = list.find(s => normName(s.nama) === normName(nama) && String(s.tanggal_lahir || '') === dob);
  if (!target) return fail(res, 404, 'Data siswa tidak ditemukan. Periksa kembali penulisan nama lengkap dan tanggal lahir.');

  const siswa = dbm.siswaById(target.id);
  const riwayat = db.prepare(`SELECT e.*, kat.nama AS kategori_nama, t.nama AS ta_nama FROM kejadian e
    LEFT JOIN kategori kat ON kat.id=e.kategori_id LEFT JOIN tahun_ajaran t ON t.id=e.ta_id
    WHERE e.siswa_id=? ORDER BY e.tanggal DESC, e.id DESC`).all(target.id);
  const perKat = {};
  for (const r of riwayat) {
    const key = (r.jenis === 'prestasi' ? '+' : '-') + (r.kategori_nama || r.judul || 'Lainnya');
    perKat[key] = perKat[key] || { nama: r.kategori_nama || r.judul, jenis: r.jenis, poin: r.poin, jumlah: 0 };
    perKat[key].jumlah++;
  }
  const s = dbm.allSettings();
  json(res, 200, {
    ok: true,
    sekolah: {
      nama: s.sekolah_nama, alamat: s.sekolah_alamat, telp: s.sekolah_telp,
      email: s.sekolah_email, website: s.sekolah_website, npsn: s.sekolah_npsn,
      kepala: s.kepala_nama, kepala_nip: s.kepala_nip, logo: s.logo, tempat: s.print_tempat
    },
    siswa: {
      id: siswa.id, nama: siswa.nama, kelas: siswa.kelas_nama, nis: siswa.nis, nisn: siswa.nisn,
      gender: siswa.gender, tanggal_lahir: siswa.tanggal_lahir, wali_nama: siswa.wali_nama,
      pel: siswa.pel, pres: siswa.pres, bersih: siswa.bersih, status: siswa.status
    },
    peringkat: Object.values(perKat),
    riwayat: riwayat.map(r => ({
      id: r.id, tanggal: r.tanggal, judul: r.judul, jenis: r.jenis, poin: r.poin,
      kategori: r.kategori_nama, keterangan: r.keterangan, bukti_url: r.bukti_url,
      semester: r.semester, ta_nama: r.ta_nama || ''
    })),
    rules: dbm.statusRules()
  });
});

/* ---------- auth ---------- */
const loginHits = new Map();
post('/api/login', async (req, res) => {
  const b = await readBody(req);
  const platform = saas.branding();
  if (platform.maintenance) {
    return fail(res, 503, platform.maintenance_pesan || 'Sistem sedang dalam pemeliharaan.');
  }
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  const key = username.toLowerCase() + '|' + ipOf(req);
  const nowT = Date.now();
  const arr = (loginHits.get(key) || []).filter(t => nowT - t < 300000);
  if (arr.length >= 12) return fail(res, 429, 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
  arr.push(nowT); loginHits.set(key, arr);

  /* 1. Kompatibilitas: login Super Admin lewat endpoint lama HANYA bila permintaan
        secara eksplisit memakai scope=super. Halaman login sekolah tidak pernah
        mengirim scope ini — portal Super Admin punya endpoint sendiri
        (/api/super/login) dan URL sendiri (/super-admin). */
  const sb = String(b.scope || b.mode || '').toLowerCase();
  if (sb === 'super') {
    const admin = saas.adminByUsername(username) || saas.adminByEmail(username);
    if (admin && admin.aktif && lib.verifyPassword(password, admin.pass_hash)) {
      loginHits.delete(key);
      saas.sdb.prepare('UPDATE saas_admins SET terakhir_masuk=? WHERE id=?').run(lib.nowStamp(), admin.id);
      createSuperSession(res, admin, req);
      saas.logAudit(admin.nama, 'LOGIN', 'auth', 'Masuk panel Super Admin', ipOf(req));
      return json(res, 200, { ok: true, scope: 'super', user: { id: admin.id, nama: admin.nama, role: 'super_admin', role_label: 'Super Admin' } });
    }
    return fail(res, 401, 'Akun Super Admin tidak ditemukan atau kata sandi salah.');
  }

  /* 2. Pengguna sekolah — KODE SEKOLAH WAJIB (4 digit) agar database sekolah
        yang dibuka benar-benar sekolah yang dimaksud. */
  const kode = String(b.kode || b.sekolah || '').trim();
  if (!/^\d{4}$/.test(kode)) {
    return fail(res, 400, 'Kode sekolah wajib diisi (4 digit angka).');
  }
  const tenant = saas.tenantByKode(kode);
  if (!tenant) return fail(res, 404, `Sekolah dengan kode "${kode}" tidak ditemukan.`);
  const cek = t => {
    try {
      return dbm.useTenant(tenantDbFile(t), () => {
        const u = dbm.userByUsername(username);
        if (u && u.aktif && lib.verifyPassword(password, u.pass_hash)) return u;
        return null;
      });
    } catch (e) { return null; }
  };
  const user = cek(tenant);
  if (tenant.status === 'ditangguhkan' || tenant.status === 'nonaktif') {
    const u = cek(tenant);
    if (!u) return fail(res, 401, 'Username atau kata sandi salah.');
    /* tetap izinkan masuk untuk memperpanjang, tetapi tandai */
    loginHits.delete(key);
    createSession(res, u, req, tenant);
    return json(res, 200, {
      ok: true, scope: 'tenant', ditangguhkan: true,
      user: { id: u.id, nama: u.nama, role: u.role },
      pesan: 'Masa aktif layanan sekolah berakhir — akun dibatasi sampai perpanjangan dilakukan.'
    });
  }
  if (!user) return fail(res, 401, 'Username atau kata sandi salah.');
  loginHits.delete(key);
  createSession(res, user, req, tenant);
  dbm.useTenant(tenantDbFile(tenant), () => {
    dbm.logAudit(user, 'LOGIN', 'auth', `Masuk sebagai ${dbm.ROLE_LABEL[user.role] || user.role}`, ipOf(req));
  });
  json(res, 200, {
    ok: true, scope: 'tenant', sekolah: { kode: tenant.kode, nama: tenant.nama },
    user: { id: user.id, nama: user.nama, role: user.role }
  });
});
/* keep-alive sesi: dipanggil berkala oleh aplikasi agar pengguna tidak pernah
   ter-logout sendiri selama aplikasi masih terbuka (sliding expiration). */
post('/api/session/touch', (req, res) => {
  const s = sessionFrom(req);
  if (!s) return fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.');
  refreshSessionCookie(res, s.sid);
  json(res, 200, { ok: true, user: { id: s.user.id, nama: s.user.nama }, days: sessionDays() });
});
get('/api/session/info', (req, res) => {
  const s = sessionFrom(req);
  if (!s) return json(res, 200, { ok: true, aktif: false });
  const row = saas.sdb.prepare('SELECT * FROM saas_sesi WHERE sid=?').get(String(s.sid)) || {};
  json(res, 200, {
    ok: true, aktif: true, scope: s.scope, days: sessionDays(),
    expires_at: row.expires_at || '', last_seen: row.last_seen || ''
  });
});

post('/api/logout', (req, res) => {
  const c = contextOf(req);
  if (c.scope === 'super') {
    saas.logAudit(c.user ? c.user.nama : '-', 'LOGOUT', 'auth', 'Keluar panel Super Admin', ipOf(req));
    destroySession(req, res, 'super');
    return json(res, 200, { ok: true });
  }
  if (c.user && c.tenant) {
    try { dbm.logAudit(c.user, 'LOGOUT', 'auth', 'Keluar dari aplikasi', ipOf(req)); } catch (e) { /* abaikan */ }
  }
  destroySession(req, res);
  setCookie(res, COOKIE_TENANT, '', 0);
  json(res, 200, { ok: true });
});

get('/api/bootstrap', (req, res) => {
  const ctx = contextOf(req);
  const s = sessionFrom(req);
  // perpanjang sesi & cookie setiap aplikasi dibuka (sliding, tetap login)
  if (ctx) refreshSessionCookie(res, ctx);

  /* ---------- panel Super Admin: tidak memakai data sekolah ---------- */
  if (ctx.scope === 'super') {
    return json(res, 200, {
      ok: true, scope: 'super', maintenance: saas.branding().maintenance,
      user: {
        id: ctx.user.id, nama: ctx.user.nama, username: ctx.user.username, email: ctx.user.email || '',
        role: 'super_admin', role_label: 'Super Admin Platform'
      },
      settings: { app_nama: saas.setting('app_nama'), app_subtitle: saas.setting('app_subtitle'), logo: saas.setting('logo') },
      platform: saas.branding(), stats: saas.tenantStats(),
      version: APP_VERSION
    });
  }

  const settings = dbm.allSettings();
  const ta = dbm.tahunList();
  const f = filters({});
  const brand = saas.branding();
  const absensiRoles = s ? dbm.userRoleList(s.user) : [];
  const pengawasAbsensi = absensiRoles.some(role =>
    ['kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan'].includes(role));
  const hasAbsensiSchedule = !!(s && ta.some(t => dbm.jadwalRows(t.id)
    .some(row => Number(row.guru_id) === Number(s.user.id))));
  const absensiMenuVisible = !!(s && (absensiRoles.includes('admin') || pengawasAbsensi || hasAbsensiSchedule));
  /* MODE PEMELIHARAAN: akun sekolah tidak boleh memuat data apa pun.
     Super Admin (blok di atas) tidak terpengaruh. */
  const maint = isMaintenance();
  if (maint.aktif === '1' && ctx.scope !== 'super') {
    return json(res, 200, {
      ok: true, maintenance: true, maintenance_pesan: maint.pesan,
      platform: {
        app_nama: brand.app_nama, app_subtitle: brand.app_subtitle,
        logo: brand.logo, favicon: brand.favicon, version: brand.version,
        assistant_widget_enabled: saas.setting('assistant_widget_enabled', '1') !== '0'
      },
      settings: { app_nama: settings.app_nama, sekolah_nama: settings.sekolah_nama },
      features: [], tahun: [], user: null
    });
  }
  /* nama aplikasi efektif sudah diselesaikan di dbm.allSettings() lewat
     setAppNamaGlobal() di bawah — di sini cukup memastikan nilainya terkirim. */
  settings.app_nama_global = settings.app_nama_global || brand.app_nama;
  json(res, 200, {
    ok: true,
    /* identitas platform GLOBAL (dipakai judul tab, header, footer) */
    platform: {
      app_nama: brand.app_nama, app_subtitle: brand.app_subtitle,
      logo: brand.logo, favicon: brand.favicon, version: brand.version,
      assistant_widget_enabled: saas.setting('assistant_widget_enabled', '1') !== '0'
    },
    user: s ? {
      id: s.user.id, nama: s.user.nama, role: s.user.role, jabatan: s.user.jabatan,
      roles: dbm.userRoleList(s.user),
      role_label: dbm.roleLabelOf(s.user), nip: s.user.nip,
      username: s.user.username, phone: s.user.phone || '', foto: s.user.foto || ''
    } : null,
    settings: {
      ...settings,
      status_rules: dbm.statusRules(),
      dini: dbm.diniConfig(),
      form_config: dbm.formConfig(),
      nav: dbm.navConfig(),
      lokasi: dbm.lokasiList(),
      sanksi_rules: dbm.sanksiRules(),
      jurnal_config: dbm.jurnalConfig()
    },
    /* tombol navigasi bawah (khusus ponsel) sesuai role pengguna */
    bottom_nav: s ? dbm.bottomNavFor(s.user) : [],
    /* Absensi mapel ditampilkan untuk admin, pimpinan sekolah, dan pemilik slot jadwal. */
    absensi_menu_visible: absensiMenuVisible,
    tindak_lanjut_jenis: dbm.TL_JENIS,
    tindak_lanjut_status: dbm.TL_STATUS,
    features: dbm.FEATURES,
    actions: dbm.ACTIONS,
    action_labels: dbm.ACTION_LABEL,
    roles: dbm.ROLES.map(r => ({ key: r, label: dbm.ROLE_LABEL[r] })),
    perms: s ? dbm.permsFor(s.user) : {},
    tahun: ta,
    semester: dbm.SEMESTER,
    filters: f,
    /* ---------- informasi platform & langganan ---------- */
    scope: 'tenant',
    tenant: ctx.tenant ? tenantPublicInfo(ctx.tenant, req) : null,
    fitur_paket: saas.allowedFeatures(ctx.tenant),
    pengumuman: saas.pengumumanList({ aktifOnly: true }).slice(0, 3),
    panduan: saas.panduanList('sekolah').filter(p => Number(p.aktif) === 1),
    panduan_super: [],
    paket_list: saas.paketList({ aktifOnly: true }),
    platform: saas.branding(),
    version: APP_VERSION
  });
});

/** info sekolah yang aman dikirim ke klien (tanpa kolom internal) */
function tenantPublicInfo(t, req) {
  const d = saas.decorateTenant(t);
  return {
    id: d.id, kode: d.kode, nama: d.nama, slug: d.slug, jenjang: d.jenjang,
    paket: d.paket, paket_nama: d.paket_nama, status: d.status, status_label: d.status_label,
    lifetime: d.lifetime, trial_berakhir: d.trial_berakhir, aktif_sampai: d.aktif_sampai,
    custom_domain: d.custom_domain || '', domain_status: d.domain_status || '',
    created_at: d.created_at, expired: d.expired, telp: d.telp || '', email_admin: d.email_admin || '',
    alamat: d.alamat || '', kontak_nama: d.kontak_nama || '', kepala: d.kepala || '',
    portal_aktif: Number(d.portal_aktif) === 1, fitur: d.fitur,
    /* alamat portal publik siswa milik sekolah ini (dinamis, bukan tautan statis) */
    portal_slug: d.portal_slug || '',
    portal_path: d.portal_path || '',
    portal_url: d.portal_path ? appBaseUrl(req) + d.portal_path : ''
  };
}

/* ---------- master untuk form ---------- */
/* /api/master dipakai halaman data (siswa/kelas) — butuh izin salah satu modul
   data. Form Input Kejadian & Buku Penghubung memakai /api/form-master di bawah
   agar TETAP dapat memuat kategori + bobot poin walau role tidak diberi akses
   menu "Kategori Poin" maupun "Data Siswa". */
get('/api/master', (req, res) => {
  const s = sessionFrom(req);
  if (!s) return fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.');
  if (s.scope === 'super') return fail(res, 400, 'Panel Super Admin tidak memakai endpoint ini.');
  const boleh = ['siswa', 'kejadian', 'jurnal', 'kelas', 'laporan'].some(f => dbm.can(s.user, f, 'view'));
  if (!boleh) return fail(res, 403, 'Anda tidak memiliki izin membuka data master.');
  json(res, 200, {
    ok: true,
    kelas: dbm.kelasList(),
    kategori: dbm.kategoriList(),
    wali: dbm.waliUsers(),
    tahun: dbm.tahunList(),
    lokasi: dbm.lokasiList(),
    sanksi: dbm.sanksiRules(),
    tingkat: dbm.tingkatConfig(),
    tl_jenis: dbm.TL_JENIS,
    tl_status: dbm.TL_STATUS
  });
});

/* Data pilihan untuk FORM pencatatan (kategori + bobot poin, lokasi, sanksi).
   Otorisasinya TERPISAH dari menu master poin: cukup punya izin lihat/tulis
   pada modul kejadian ATAU jurnal. */
get('/api/form-master', (req, res) => {
  const s = sessionFrom(req);
  if (!s) return fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.');
  if (s.scope === 'super') return fail(res, 400, 'Panel Super Admin tidak memakai endpoint ini.');
  const u = s.user;
  const bolehKejadian = dbm.can(u, 'kejadian', 'view') || dbm.can(u, 'kejadian', 'write');
  const bolehJurnal = dbm.can(u, 'jurnal', 'view') || dbm.can(u, 'jurnal', 'write');
  if (!bolehKejadian && !bolehJurnal) {
    return fail(res, 403, 'Anda tidak memiliki izin mencatat kejadian maupun buku penghubung.');
  }
  json(res, 200, {
    ok: true,
    kategori: dbm.kategoriList(),
    lokasi: dbm.lokasiList(),
    sanksi: dbm.sanksiRules(),
    kelas: dbm.kelasList(),
    tingkat: dbm.tingkatConfig(),
    form_config: dbm.formConfig(),
    jurnal_config: dbm.jurnalConfig()
  });
});

get('/api/siswa-options', (req, res, q) => {
  const user = guard(req, res, 'kejadian', 'view'); if (!user) return;
  /* all=1 → seluruh siswa (dipakai Buku Penghubung / Tindak Lanjut / WhatsApp masal,
     di mana wali kelas memang boleh mencatat siswa kelas lain). Input Kejadian tetap dibatasi. */
  const semua = String(q.all || '') === '1' && (dbm.can(user, 'jurnal', 'view') || dbm.can(user, 'tindak_lanjut', 'view'));
  const scope = semua ? null : dbm.scopeWali(user);
  const kw = String(q.q || '').trim().toLowerCase();
  const kelasId = numOr(q.kelas);
  const limit = Math.max(1, Math.min(1000, Number(q.limit) || 600));
  let sql = `SELECT s.id, s.nama, s.nis, s.nisn, s.parent_phone, s.kelas_id, k.nama AS kelas_nama
    FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
    WHERE s.status='aktif'`;
  const args = [];
  if (scope) sql += ' AND s.kelas_id IN (' + (scope.length ? scope.join(',') : 0) + ')';
  if (kelasId) { sql += ' AND s.kelas_id=?'; args.push(kelasId); }
  if (kw) {
    sql += ' AND (lower(s.nama) LIKE ? OR lower(COALESCE(s.nis,\'\')) LIKE ? OR lower(COALESCE(s.nisn,\'\')) LIKE ? OR lower(COALESCE(k.nama,\'\')) LIKE ?)';
    args.push('%' + kw + '%', '%' + kw + '%', '%' + kw + '%', '%' + kw + '%');
  }
  sql += ' ORDER BY k.urut, k.nama, s.nama LIMIT ' + limit;
  const rows = db.prepare(sql).all(...args);
  json(res, 200, { ok: true, rows, total: rows.length, q: kw });
});

/* ---------- dashboard ---------- */
get('/api/dashboard', (req, res, q) => {
  const user = guard(req, res, 'dashboard', 'view'); if (!user) return;
  const f = filters(q);
  const rows = dbm.siswaRows({ taId: f.taId, semester: f.semester, user });
  const rules = dbm.statusRules();
  const dist = rules.map(r => ({ ...r, jumlah: rows.filter(s => s.status.label === r.label).length }));
  const dini = dbm.diniConfig();
  const recent = dbm.recentPoints(dini.hari);
  const recentMap = new Map(recent.map(r => [r.siswa_id, r]));
  const early = rows
    .map(s => {
      const rr = recentMap.get(s.id);
      if (!rr) return null;
      const poin = Number(rr.poin) || 0;
      let level = '';
      if (poin >= Number(dini.waspada)) level = 'waspada';
      else if (poin >= Number(dini.siaga)) level = 'siaga';
      if (!level) return null;
      return { id: s.id, nama: s.nama, kelas: s.kelas_nama, poin14: poin, jml: rr.jml, terakhir: rr.terakhir, level, status: s.status };
    })
    .filter(Boolean)
    .sort((a, b) => b.poin14 - a.poin14);

  const top = [...rows].filter(s => s.pel > 0).sort((a, b) => b.pel - a.pel).slice(0, 10)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const allKejadian = db.prepare(`SELECT e.tanggal, e.jenis, e.poin FROM kejadian e
    JOIN siswa s ON s.id=e.siswa_id WHERE e.ta_id=? AND e.semester=? ${user.role === 'wali_kelas' ? 'AND s.kelas_id IN (SELECT id FROM kelas WHERE wali_id=' + Number(user.id) + ')' : ''}`)
    .all(f.taId, f.semester);
  const bulan = {};
  for (const k of allKejadian) {
    const key = String(k.tanggal).slice(0, 7);
    bulan[key] = bulan[key] || { key, pel: 0, pres: 0, jml: 0 };
    if (k.jenis === 'prestasi') bulan[key].pres += k.poin; else bulan[key].pel += k.poin;
    bulan[key].jml++;
  }
  const tren = Object.values(bulan).sort((a, b) => a.key.localeCompare(b.key)).slice(-8);

  const perKelas = dbm.kelasList().map(k => {
    const list = rows.filter(s => s.kelas_id === k.id);
    return {
      id: k.id, nama: k.nama, wali: k.wali_nama || '-', jumlah: list.length,
      pel: list.reduce((a, s) => a + s.pel, 0), pres: list.reduce((a, s) => a + s.pres, 0),
      kritis: list.filter(s => ['Kritis', 'Siaga', 'Waspada'].includes(s.status.label)).length
    };
  });

  const totalPel = rows.reduce((a, s) => a + s.pel, 0);
  const totalPres = rows.reduce((a, s) => a + s.pres, 0);

  /* notifikasi real-time: siswa Siaga & Kritis/Waspada */
  const alertRows = rows
    .filter(s => ['Siaga', 'Kritis', 'Waspada'].includes(s.status.label))
    .sort((a, b) => b.bersih - a.bersih)
    .map(s => ({
      id: s.id, nama: s.nama, kelas: s.kelas_nama, pel: s.pel, pres: s.pres, bersih: s.bersih,
      status: s.status, sanksi: s.sanksi,
      level: s.status.label === 'Siaga' ? 'siaga' : (s.status.label === 'Waspada' ? 'waspada' : 'kritis')
    }));
  const pola = dbm.polaPelanggaran({ taId: f.taId, semester: f.semester, user });
  const sanksiRekap = {};
  for (const s of rows) {
    const key = s.sanksi ? s.sanksi.label : 'Belum ada rekomendasi';
    sanksiRekap[key] = (sanksiRekap[key] || 0) + 1;
  }
  const tindakStats = dbm.tindakLanjutStats();
  json(res, 200, {
    ok: true, filters: f,
    kpi: {
      siswa: rows.length,
      pelanggaran: countKejadian(f, user, 'pelanggaran'),
      prestasi: countKejadian(f, user, 'prestasi'),
      totalPel, totalPres,
      perluPerhatian: rows.filter(s => ['Kritis', 'Siaga', 'Waspada'].includes(s.status.label)).length,
      aman: dist.find(d => d.label === 'Aman') ? dist.find(d => d.label === 'Aman').jumlah : 0,
      dini: early.length,
      kelas: perKelas.length
    },
    distribusi: dist,
    top, early, tren, perKelas, pola,
    alerts: alertRows,
    sanksiRekap: Object.entries(sanksiRekap).map(([label, jumlah]) => ({ label, jumlah })).sort((a, b) => b.jumlah - a.jumlah),
    tindakStats,
    terbaru: dbm.kejadianList({ taId: f.taId, semester: f.semester, user, limit: 12 }),
    riwayat: dbm.riwayatAktivitas({ taId: f.taId, user, limit: 150 }),
    /* permintaan tukar jadwal mengajar yang menunggu jawaban guru ini */
    tukar_masuk: dbm.tukarMasuk(user.id),
    feedback_baru: dbm.can(user, 'feedback_admin', 'view') ? dbm.feedbackStats().baru : 0,
    wa: { cooldown_jam: dbm.waConfig().cooldownJam, gateway_aktif: dbm.waConfig().aktif },
    rules, dini,
    storage: storageFor(req)
  });
});

/** info penyimpanan untuk dashboard (ringkas, tidak pernah membaca disk host) */
function storageFor(req) {
  const user = req.user || (sessionFrom(req) || {}).user;
  if (!user || !dbm.can(user, 'berkas', 'view')) {
    const st = dbm.storageInfo();
    return { file_count: st.file_count, files_bytes: st.files_bytes, db_bytes: st.db_bytes, used_bytes: st.used_bytes, quota_mb: st.quota_mb, quota_bytes: st.quota_bytes, sisa_bytes: st.sisa_bytes };
  }
  return dbm.storageInfo();
}

function countKejadian(f, user, jenis) {
  const scope = dbm.scopeWali(user);
  const extra = scope ? ` AND s.kelas_id IN (${scope.length ? scope.join(',') : 0})` : '';
  return db.prepare(`SELECT COUNT(*) c FROM kejadian e JOIN siswa s ON s.id=e.siswa_id
    WHERE e.ta_id=? AND e.semester=? AND e.jenis=?${extra}`).get(f.taId, f.semester, jenis).c;
}

/* ---------- deteksi dini ---------- */
get('/api/deteksi', (req, res, q) => {
  const user = guard(req, res, 'deteksi', 'view'); if (!user) return;
  const f = filters(q);
  const dini = dbm.diniConfig();
  const rows = dbm.siswaRows({ taId: f.taId, semester: f.semester, user });
  const recent = new Map(dbm.recentPoints(dini.hari).map(r => [r.siswa_id, r]));
  const list = rows.map(s => {
    const r = recent.get(s.id);
    const poin = r ? Number(r.poin) : 0;
    let level = 'normal';
    if (poin >= Number(dini.waspada)) level = 'waspada';
    else if (poin >= Number(dini.siaga)) level = 'siaga';
    return { ...s, poin14: poin, jml14: r ? r.jml : 0, terakhir: r ? r.terakhir : null, level };
  }).filter(s => s.level !== 'normal').sort((a, b) => b.poin14 - a.poin14);
  const riwayat = db.prepare(`SELECT e.*, s.nama AS siswa_nama, k.nama AS kelas_nama, kat.nama AS kategori_nama
    FROM kejadian e JOIN siswa s ON s.id=e.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
    LEFT JOIN kategori kat ON kat.id=e.kategori_id
    WHERE e.jenis='pelanggaran' AND e.tanggal >= ? ORDER BY e.tanggal DESC, e.id DESC LIMIT 100`)
    .all(new Date(Date.now() - (dini.hari - 1) * 86400000).toISOString().slice(0, 10));
  json(res, 200, { ok: true, dini, list, riwayat, total: list.length });
});

/* ---------- siswa ---------- */
get('/api/siswa', (req, res, q) => {
  const user = guard(req, res, 'siswa', 'view'); if (!user) return;
  const f = filters(q);
  const rows = dbm.siswaRows({
    taId: f.taId, semester: f.semester, user,
    kelasId: numOr(q.kelas), q: (q.q || '').trim(), statusKey: q.status || 'all',
    statusSiswa: q.status_siswa || 'aktif'
  });
  json(res, 200, { ok: true, rows, total: rows.length, filters: f });
});

get('/api/siswa/:id', (req, res, q, params) => {
  const user = guard(req, res, 'siswa', 'view'); if (!user) return;
  const s = dbm.siswaById(params.id);
  if (!s) return fail(res, 404, 'Siswa tidak ditemukan.');
  const riwayat = db.prepare(`SELECT e.*, kat.nama AS kategori_nama, t.nama AS ta_nama,
      (SELECT k2.nama FROM siswa_kelas sk JOIN kelas k2 ON k2.id=sk.kelas_id
        WHERE sk.siswa_id=e.siswa_id AND sk.ta_id=e.ta_id) AS kelas_saat_itu
    FROM kejadian e LEFT JOIN kategori kat ON kat.id=e.kategori_id
    LEFT JOIN tahun_ajaran t ON t.id=e.ta_id
    WHERE e.siswa_id=? ORDER BY e.tanggal DESC, e.id DESC`).all(params.id);
  const perKat = {};
  for (const r of riwayat) {
    const key = r.kategori_nama || r.judul || '-';
    perKat[key] = perKat[key] || { nama: key, jenis: r.jenis, poin: r.poin, jumlah: 0 };
    perKat[key].jumlah++;
  }
  const pembinaan = dbm.tindakLanjutRows({ siswaId: Number(params.id) });
  json(res, 200, { ok: true, siswa: s, riwayat, perKat: Object.values(perKat), pembinaan });
});

post('/api/siswa/save', async (req, res) => {
  const user = guard(req, res, 'siswa', 'write'); if (!user) return;
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  if (!nama) return fail(res, 400, 'Nama siswa wajib diisi.');
  const kelasId = numOr(b.kelas_id);
  if (!kelasId) return fail(res, 400, 'Kelas wajib dipilih.');
  const nis = String(b.nis || '').trim(), nisn = String(b.nisn || '').trim();
  if (nisn) {
    const dup = db.prepare('SELECT id,nama FROM siswa WHERE nisn=? AND id<>?').get(nisn, Number(b.id) || 0);
    if (dup) return fail(res, 400, `NISN ${nisn} sudah dipakai oleh ${dup.nama}.`);
  }
  if (nis) {
    const dup = db.prepare('SELECT id,nama FROM siswa WHERE nis=? AND id<>?').get(nis, Number(b.id) || 0);
    if (dup) return fail(res, 400, `NIS ${nis} sudah dipakai oleh ${dup.nama}.`);
  }
  const dob = parseDOB(b.tanggal_lahir);
  const phone = b.parent_phone ? lib.normPhone(b.parent_phone) : '';
  if (b.parent_phone && !phone) return fail(res, 400, 'Nomor HP orang tua tidak valid (contoh: 0812-3456-7890).');
  const gender = b.gender === 'P' ? 'P' : 'L';
  const ta = dbm.tahunAktif();
  if (b.id) {
    db.prepare(`UPDATE siswa SET nama=?,nis=?,nisn=?,kelas_id=?,gender=?,tanggal_lahir=?,parent_phone=? WHERE id=?`)
      .run(nama, nis, nisn, kelasId, gender, dob, phone, Number(b.id));
    dbm.siswaKelasSet(Number(b.id), kelasId, ta ? ta.id : null);
    if (b.status && ['aktif', 'lulus', 'nonaktif', 'pindah'].includes(String(b.status))) {
      db.prepare('UPDATE siswa SET status=? WHERE id=?').run(String(b.status), Number(b.id));
    }
    dbm.logAudit(user, 'UBAH', 'siswa', `Memperbarui siswa ${nama}`, ipOf(req));
    return json(res, 200, { ok: true, id: Number(b.id) });
  }
  const r = db.prepare(`INSERT INTO siswa(nama,nis,nisn,kelas_id,gender,tanggal_lahir,parent_phone,status,tahun_ajaran_id,created_at)
    VALUES(?,?,?,?,?,?,?,'aktif',?,?)`).run(nama, nis, nisn, kelasId, gender, dob, phone, ta ? ta.id : null, dbm.now());
  dbm.siswaKelasSet(Number(r.lastInsertRowid), kelasId, ta ? ta.id : null);
  dbm.logAudit(user, 'TAMBAH', 'siswa', `Menambah siswa ${nama}`, ipOf(req));
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

/* aksi masal data siswa */
post('/api/siswa/bulk', async (req, res) => {
  const user = guard(req, res, 'siswa', 'write'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu siswa terlebih dahulu.');
  const aksi = String(b.aksi || '');
  const list = db.prepare(`SELECT id,nama,kelas_id FROM siswa WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (!list.length) return fail(res, 404, 'Siswa yang dipilih tidak ditemukan.');
  const scope = dbm.scopeWali(user);
  if (scope && list.some(r => !scope.includes(r.kelas_id))) {
    return fail(res, 403, 'Sebagian siswa berada di kelas yang bukan Anda ampu.');
  }
  if (aksi === 'kelas') {
    const kelasId = numOr(b.kelas_id);
    const kelas = kelasId ? db.prepare('SELECT * FROM kelas WHERE id=?').get(kelasId) : null;
    if (!kelas) return fail(res, 400, 'Pilih kelas tujuan terlebih dahulu.');
    db.transaction(() => {
      for (const r of list) {
        db.prepare('UPDATE siswa SET kelas_id=? WHERE id=?').run(kelas.id, r.id);
        dbm.siswaKelasSet(r.id, kelas.id, kelas.tahun_ajaran_id || (dbm.tahunAktif() || {}).id);
      }
    })();
    dbm.logAudit(user, 'UBAH', 'siswa', `Pindah kelas masal: ${list.length} siswa → ${kelas.nama}`, ipOf(req));
    return json(res, 200, { ok: true, jumlah: list.length, pesan: `${list.length} siswa dipindahkan ke ${kelas.nama}.` });
  }
  if (aksi === 'delete') {
    const u = guard(req, res, 'siswa', 'delete'); if (!u) return;
    db.transaction(() => {
      for (const r of list) {
        const full = db.prepare('SELECT * FROM siswa WHERE id=?').get(r.id);
        for (const t of ['kejadian', 'tindak_lanjut', 'jurnal']) {
          for (const row of db.prepare(`SELECT * FROM ${t} WHERE siswa_id=?`).all(r.id)) {
            dbm.trashAdd(user, t, row, `${r.nama} — ${row.judul || row.jenis || row.keterangan || ''}`);
            db.prepare(`DELETE FROM ${t} WHERE id=?`).run(row.id);
          }
        }
        dbm.trashAdd(user, 'siswa', full, r.nama);
        db.prepare('DELETE FROM siswa WHERE id=?').run(r.id);
      }
    })();
    dbm.logAudit(user, 'HAPUS', 'siswa', `Hapus masal ${list.length} siswa → Kotak Sampah`, ipOf(req));
    return json(res, 200, { ok: true, jumlah: list.length, pesan: `${list.length} siswa dipindahkan ke Kotak Sampah (dapat dipulihkan dalam 30 hari).` });
  }
  return fail(res, 400, 'Aksi masal tidak dikenali.');
});

del('/api/siswa/:id', (req, res, q, params) => {
  const user = guard(req, res, 'siswa', 'delete'); if (!user) return;
  const s = db.prepare('SELECT * FROM siswa WHERE id=?').get(params.id);
  if (!s) return fail(res, 404, 'Siswa tidak ditemukan.');
  let n = 0;
  db.transaction(() => {
    for (const t of ['kejadian', 'tindak_lanjut', 'jurnal']) {
      for (const row of db.prepare(`SELECT * FROM ${t} WHERE siswa_id=?`).all(params.id)) {
        dbm.trashAdd(user, t, row, `${s.nama} — ${row.judul || row.jenis || row.keterangan || ''}`);
        db.prepare(`DELETE FROM ${t} WHERE id=?`).run(row.id);
        n++;
      }
    }
    dbm.trashAdd(user, 'siswa', s, s.nama);
    db.prepare('DELETE FROM siswa WHERE id=?').run(params.id);
  })();
  dbm.logAudit(user, 'HAPUS', 'siswa', `Menghapus siswa ${s.nama} (+${n} riwayat) → Kotak Sampah`, ipOf(req));
  json(res, 200, { ok: true, ke_sampah: n + 1 });
});

get('/api/siswa-template.xlsx', (req, res) => {
  if (!guard(req, res, 'siswa', 'view')) return;
  const rows = [
    [{ v: 'TEMPLATE IMPORT DATA SISWA', bold: true }],
    [{ v: 'Isi data mulai baris ke-4. Kolom Kelas harus sama dengan nama kelas di menu Data Kelas.' }],
    [{ v: 'NO', bold: true }, { v: 'NAMA', bold: true }, { v: 'NIS', bold: true }, { v: 'NISN', bold: true },
    { v: 'KELAS', bold: true }, { v: 'JENIS KELAMIN', bold: true }, { v: 'TANGGAL LAHIR', bold: true }, { v: 'NO HP ORANG TUA', bold: true }],
    [1, 'Ahmad Fauzan', '20241001', '00700001', 'X TKJ 1', 'L', '2009-07-12', '081234567890'],
    [2, 'Nabila Putri', '20241002', '00700002', 'X TKJ 1', 'P', '2009-03-04', '081234567891']
  ];
  const buf = lib.xlsxBuffer('Siswa', rows, [5, 30, 14, 14, 16, 16, 16, 20]);
  sendFile(res, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'template-import-siswa.xlsx');
});

post('/api/siswa/import/preview', async (req, res) => {
  if (!guard(req, res, 'siswa', 'write')) return;
  const b = await readBody(req);
  try {
    const buf = Buffer.from(String(b.base64 || ''), 'base64');
    if (!buf.length) return fail(res, 400, 'Berkas tidak terbaca.');
    const rows = importSiswaPreview(buf, String(b.filename || 'import.xlsx'));
    json(res, 200, { ok: true, rows, total: rows.length, siap: rows.filter(r => !r.error && !r.skip).length });
  } catch (e) { fail(res, 400, e.message); }
});
post('/api/siswa/import/commit', async (req, res) => {
  const user = guard(req, res, 'siswa', 'write'); if (!user) return;
  const b = await readBody(req);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const ta = dbm.tahunAktif();
  let n = 0;
  const ins = db.prepare(`INSERT INTO siswa(nama,nis,nisn,kelas_id,gender,tanggal_lahir,parent_phone,status,tahun_ajaran_id,created_at)
    VALUES(?,?,?,?,?,?,?,'aktif',?,?)`);
  db.transaction(() => {
    for (const r of rows) {
      if (r.error || r.skip || !r.kelas_id) continue;
      const info = ins.run(String(r.nama).trim(), r.nis || '', r.nisn || '', r.kelas_id, r.gender === 'P' ? 'P' : 'L',
        r.tanggal_lahir || '', r.parent_phone || '', ta ? ta.id : null, dbm.now());
      dbm.siswaKelasSet(Number(info.lastInsertRowid), r.kelas_id, ta ? ta.id : null);
      n++;
    }
  })();
  dbm.logAudit(user, 'IMPORT', 'siswa', `Import data siswa: ${n} baris masuk`, ipOf(req));
  json(res, 200, { ok: true, masuk: n });
});

/* ---------- kelas ---------- */
/** normalisasi label tingkat dari input bebas ke daftar tingkat aktif */
function normalisasiTingkat(raw, nama) {
  const levels = dbm.tingkatList();
  const v = String(raw || '').trim();
  if (v) {
    const hit = levels.find(x => String(x).toLowerCase() === v.toLowerCase());
    if (hit) return hit;
    const flat = [];
    for (let i = 1; i <= 12; i++) { flat.push(dbm.romanOf(i)); flat.push(String(i)); }
    const pos = flat.findIndex(x => x.toLowerCase() === v.toLowerCase());
    if (pos >= 0) {
      const idx = Math.floor(pos / 2);
      if (idx < levels.length) return levels[idx];
    }
  }
  if (nama) {
    const m = /\b(XII|XI|IX|X|VIII|VII|VI|IV|V|III|II|I)\b/i.exec(String(nama));
    if (m) {
      const hit2 = levels.find(x => String(x).toLowerCase() === m[1].toLowerCase());
      if (hit2) return hit2;
    }
  }
  return levels[0];
}
get('/api/kelas', (req, res) => {
  if (!guard(req, res, 'kelas', 'view')) return;
  json(res, 200, {
    ok: true, rows: dbm.kelasList(), wali: dbm.waliUsers(),
    tingkat: dbm.tingkatConfig(), tahun: dbm.tahunAktif()
  });
});
post('/api/kelas/save', async (req, res) => {
  const user = guard(req, res, 'kelas', 'write'); if (!user) return;
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  if (!nama) return fail(res, 400, 'Nama kelas wajib diisi.');
  const tingkat = normalisasiTingkat(b.tingkat, nama);
  const waliId = numOr(b.wali_id);
  const jurusan = String(b.jurusan || '').trim();
  /* TARGET JAM khusus kelas (0 = ikut standar global di Pengaturan Jadwal) */
  const targetJam = b.target_jam === undefined || String(b.target_jam).trim() === ''
    ? null : Math.round(Number(b.target_jam));
  if (targetJam !== null && (!Number.isFinite(targetJam) || targetJam < 0 || targetJam > 80)) {
    return fail(res, 400, 'Target jam pelajaran kelas harus antara 0 dan 80 jam (0 = ikut standar sekolah).');
  }
  if (b.id) {
    const cur = db.prepare('SELECT * FROM kelas WHERE id=?').get(Number(b.id));
    if (!cur) return fail(res, 404, 'Kelas tidak ditemukan.');
    db.prepare('UPDATE kelas SET nama=?,tingkat=?,jurusan=?,wali_id=?,target_jam=? WHERE id=?')
      .run(nama, tingkat, jurusan, waliId, targetJam, Number(b.id));
    dbm.logAudit(user, 'UBAH', 'kelas',
      `Memperbarui kelas ${nama}${targetJam ? ` (target ${targetJam} jam/pekan)` : ''}`, ipOf(req));
    return json(res, 200, { ok: true });
  }
  const taId = numOr(b.tahun_ajaran_id) || (dbm.tahunAktif() || {}).id || null;
  const urut = (db.prepare('SELECT COALESCE(MAX(urut),0) m FROM kelas WHERE tahun_ajaran_id IS ?').get(taId).m || 0) + 1;
  const r = db.prepare('INSERT INTO kelas(nama,tingkat,jurusan,wali_id,urut,created_at,tahun_ajaran_id,target_jam) VALUES(?,?,?,?,?,?,?,?)')
    .run(nama, tingkat, jurusan, waliId, urut, dbm.now(), taId, targetJam);
  dbm.logAudit(user, 'TAMBAH', 'kelas', `Menambah kelas ${nama} (tingkat ${tingkat})`, ipOf(req));
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});
del('/api/kelas/:id', (req, res, q, params) => {
  const user = guard(req, res, 'kelas', 'delete'); if (!user) return;
  const k = db.prepare('SELECT * FROM kelas WHERE id=?').get(params.id);
  if (!k) return fail(res, 404, 'Kelas tidak ditemukan.');
  const n = db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND status='aktif'").get(params.id).c;
  if (n) return fail(res, 400, `Kelas masih memiliki ${n} siswa aktif. Pindahkan siswa terlebih dahulu.`);
  dbm.trashAdd(user, 'kelas', k, k.nama);
  db.prepare('DELETE FROM kelas WHERE id=?').run(params.id);
  dbm.logAudit(user, 'HAPUS', 'kelas', `Menghapus kelas ${k.nama} → Kotak Sampah`, ipOf(req));
  json(res, 200, { ok: true });
});
get('/api/kelas-template.xlsx', (req, res) => {
  if (!guard(req, res, 'kelas', 'view')) return;
  const rows = [
    [{ v: 'TEMPLATE IMPORT DATA KELAS', bold: true }],
    [{ v: 'Nama wali kelas harus sama dengan nama pengguna ber-role Wali Kelas (boleh dikosongkan).' }],
    [{ v: 'NAMA KELAS', bold: true }, { v: 'TINGKAT', bold: true }, { v: 'JURUSAN', bold: true }, { v: 'WALI KELAS', bold: true }],
    ['X TKJ 2', 'X', 'Teknik Komputer & Jaringan', 'Rina Kusmiati, S.Pd.'],
    ['XI AKL 2', 'XI', 'Akuntansi & Keuangan Lembaga', '']
  ];
  const buf = lib.xlsxBuffer('Kelas', rows, [18, 10, 32, 28]);
  sendFile(res, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'template-import-kelas.xlsx');
});
post('/api/kelas/import/preview', async (req, res) => {
  if (!guard(req, res, 'kelas', 'write')) return;
  const b = await readBody(req);
  try {
    const buf = Buffer.from(String(b.base64 || ''), 'base64');
    const rows = importKelasPreview(buf, String(b.filename || 'import.xlsx'));
    json(res, 200, { ok: true, rows, total: rows.length, siap: rows.filter(r => !r.error && !r.skip).length });
  } catch (e) { fail(res, 400, e.message); }
});
post('/api/kelas/import/commit', async (req, res) => {
  const user = guard(req, res, 'kelas', 'write'); if (!user) return;
  const b = await readBody(req);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  let n = 0, taId = (dbm.tahunAktif() || {}).id || null;
  let urut = db.prepare('SELECT COALESCE(MAX(urut),0) m FROM kelas WHERE tahun_ajaran_id IS ?').get(taId).m || 0;
  const ins = db.prepare('INSERT INTO kelas(nama,tingkat,jurusan,wali_id,urut,created_at,tahun_ajaran_id) VALUES(?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const r of rows) {
      if (r.error || r.skip) continue;
      ins.run(r.nama, r.tingkat, r.jurusan || '', r.wali_id || null, ++urut, dbm.now(), taId);
      n++;
    }
  })();
  dbm.logAudit(user, 'IMPORT', 'kelas', `Import data kelas: ${n} baris masuk`, ipOf(req));
  json(res, 200, { ok: true, masuk: n });
});

/* ---------- kategori ---------- */
get('/api/kategori', (req, res) => {
  if (!guard(req, res, 'kategori', 'view')) return;
  const rows = dbm.kategoriList().map(k => ({
    ...k,
    dipakai: db.prepare('SELECT COUNT(*) c FROM kejadian WHERE kategori_id=?').get(k.id).c
  }));
  json(res, 200, { ok: true, rows });
});
post('/api/kategori/save', async (req, res) => {
  const user = guard(req, res, 'kategori', 'write'); if (!user) return;
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  if (!nama) return fail(res, 400, 'Nama kategori wajib diisi.');
  const jenis = b.jenis === 'prestasi' ? 'prestasi' : 'pelanggaran';
  const poin = Math.max(0, Math.round(Number(b.poin) || 0));
  if (!poin) return fail(res, 400, 'Poin harus lebih dari 0.');
  const ket = String(b.keterangan || '').trim();
  if (b.id) {
    const lama = db.prepare('SELECT * FROM kategori WHERE id=?').get(Number(b.id));
    if (lama && lama.auto_key && jenis !== 'pelanggaran') {
      return fail(res, 400, 'Kategori otomatis dari absensi harus tetap berjenis pelanggaran — hanya besaran poinnya yang dapat diubah.');
    }
    db.prepare('UPDATE kategori SET nama=?,jenis=?,poin=?,keterangan=?,aktif=? WHERE id=?')
      .run(nama, jenis, poin, ket, b.aktif === 0 || b.aktif === '0' ? 0 : 1, Number(b.id));
    dbm.logAudit(user, 'UBAH', 'kategori', `Memperbarui kategori ${nama}`, ipOf(req));
    return json(res, 200, { ok: true });
  }
  const urut = (db.prepare('SELECT COALESCE(MAX(urut),0) m FROM kategori').get().m || 0) + 1;
  const r = db.prepare('INSERT INTO kategori(nama,jenis,poin,keterangan,aktif,urut) VALUES(?,?,?,?,?,?)')
    .run(nama, jenis, poin, ket, 1, urut);
  dbm.logAudit(user, 'TAMBAH', 'kategori', `Menambah kategori ${jenis} ${nama} (${poin} poin)`, ipOf(req));
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});
/* template Excel untuk import kategori poin */
get('/api/kategori-template.xlsx', (req, res) => {
  if (!guard(req, res, 'kategori', 'view')) return;
  const rows = [
    [{ v: 'TEMPLATE IMPORT KATEGORI POIN', bold: true }],
    [{ v: 'Isi data mulai baris ke-4. JENIS: Pelanggaran / Prestasi (kosong = Pelanggaran). POIN: angka lebih dari 0.' }],
    [{ v: 'NAMA KATEGORI', bold: true }, { v: 'JENIS', bold: true }, { v: 'POIN', bold: true }, { v: 'KETERANGAN', bold: true }],
    ['Terlambat masuk sekolah', 'Pelanggaran', 5, 'Datang setelah bel masuk berbunyi'],
    ['Tidak memakai atribut lengkap', 'Pelanggaran', 10, 'Seragam/dasi/sepatu tidak sesuai ketentuan'],
    ['Membuli teman', 'Pelanggaran', 35, 'Perundungan verbal maupun fisik'],
    ['Juara 1 Lomba Akademik', 'Prestasi', 40, 'Tingkat kabupaten/provinsi/nasional'],
    ['Pengurus OSIS / MPK', 'Prestasi', 15, 'Aktif dalam organisasi sekolah']
  ];
  const buf = lib.xlsxBuffer('Kategori Poin', rows, [36, 16, 10, 50]);
  sendFile(res, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'template-import-kategori-poin.xlsx');
});
post('/api/kategori/import/preview', async (req, res) => {
  if (!guard(req, res, 'kategori', 'write')) return;
  const b = await readBody(req);
  try {
    const buf = Buffer.from(String(b.base64 || ''), 'base64');
    if (!buf.length) return fail(res, 400, 'Berkas kosong / tidak terbaca.');
    const rows = importKategoriPreview(buf, String(b.filename || 'import.xlsx'));
    if (!rows.length) return fail(res, 400, 'Tidak ada baris data yang terdeteksi. Pastikan header kolom NAMA/POIN ada (gunakan template).');
    json(res, 200, { ok: true, rows, total: rows.length, siap: rows.filter(r => !r.error && !r.skip).length });
  } catch (e) { fail(res, 400, e.message); }
});
post('/api/kategori/import/commit', async (req, res) => {
  const user = guard(req, res, 'kategori', 'write'); if (!user) return;
  const b = await readBody(req);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  let n = 0, dilewati = 0;
  let urut = db.prepare('SELECT COALESCE(MAX(urut),0) m FROM kategori').get().m || 0;
  const ins = db.prepare('INSERT INTO kategori(nama,jenis,poin,keterangan,aktif,urut) VALUES(?,?,?,?,?,?)');
  const adaNama = db.prepare('SELECT id FROM kategori WHERE lower(TRIM(nama))=lower(TRIM(?)) AND jenis=?');
  db.transaction(() => {
    for (const r of rows) {
      if (r.error || r.skip) { dilewati++; continue; }
      const nama = String(r.nama || '').trim();
      const jenis = r.jenis === 'prestasi' ? 'prestasi' : 'pelanggaran';
      const poin = Math.round(Number(r.poin) || 0);
      if (!nama || poin <= 0) { dilewati++; continue; }
      if (adaNama.get(nama, jenis)) { dilewati++; continue; }   // cegah ganda saat commit
      ins.run(nama, jenis, Math.min(1000, poin), String(r.keterangan || '').trim(), 1, ++urut);
      n++;
    }
  })();
  dbm.logAudit(user, 'IMPORT', 'kategori', `Import kategori poin: ${n} baris masuk${dilewati ? `, ${dilewati} dilewati` : ''}`, ipOf(req));
  json(res, 200, { ok: true, masuk: n, dilewati });
});
del('/api/kategori/:id', (req, res, q, params) => {
  const user = guard(req, res, 'kategori', 'delete'); if (!user) return;
  const k = db.prepare('SELECT * FROM kategori WHERE id=?').get(params.id);
  if (!k) return fail(res, 404, 'Kategori tidak ditemukan.');
  if (k.auto_key) return fail(res, 400, 'Kategori otomatis dari absensi tidak dapat dihapus — ubah besaran poinnya saja agar sinkronisasi absensi tetap berjalan.');
  db.prepare('DELETE FROM kategori WHERE id=?').run(params.id);
  dbm.logAudit(user, 'HAPUS', 'kategori', `Menghapus kategori ${k.nama}`, ipOf(req));
  json(res, 200, { ok: true });
});
/* hapus kategori secara masal (ceklis + "Pilih Semua") */
post('/api/kategori/bulk-delete', async (req, res) => {
  const user = guard(req, res, 'kategori', 'delete'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(',')).map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu kategori terlebih dahulu.');
  const semua = db.prepare(`SELECT * FROM kategori WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (!semua.length) return fail(res, 404, 'Kategori tidak ditemukan.');
  const otomatis = semua.filter(r => r.auto_key);
  if (otomatis.length) return fail(res, 400, `Kategori otomatis tidak dapat dihapus: ${otomatis.map(r => r.nama).join(', ')}. Ubah poinnya saja.`);
  const rows = semua;
  db.transaction(() => {
    for (const k of rows) db.prepare('DELETE FROM kategori WHERE id=?').run(k.id);
  })();
  dbm.logAudit(user, 'HAPUS', 'kategori', `Hapus ${rows.length} kategori masal: ${rows.map(r => r.nama).join(', ')}`, ipOf(req));
  json(res, 200, { ok: true, jumlah: rows.length, pesan: `${rows.length} kategori dihapus.` });
});

/* ---------- kejadian ---------- */
get('/api/kejadian', (req, res, q) => {
  const user = guard(req, res, 'kejadian', 'view'); if (!user) return;
  const f = filters(q);
  const rows = dbm.kejadianList({
    taId: f.taId, semester: f.semester, user,
    siswaId: numOr(q.siswa), kelasId: numOr(q.kelas), jenis: q.jenis || '',
    from: q.from || '', to: q.to || '', q: (q.q || '').trim()
  });
  json(res, 200, { ok: true, rows, total: rows.length, filters: f });
});
post('/api/kejadian/save', async (req, res) => {
  const user = guard(req, res, 'kejadian', 'write'); if (!user) return;
  const b = await readBody(req);
  /* ---------- siswa: boleh lebih dari satu (input masal) ---------- */
  const ids = (Array.isArray(b.siswa_ids) ? b.siswa_ids : String(b.siswa_ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  const single = numOr(b.siswa_id);
  if (single && !ids.includes(single)) ids.push(single);
  if (!ids.length) return fail(res, 400, 'Siswa wajib dipilih.');
  const daftar = ids.map(id => db.prepare('SELECT * FROM siswa WHERE id=?').get(id)).filter(Boolean);
  if (!daftar.length) return fail(res, 404, 'Siswa tidak ditemukan.');
  if (daftar.length !== ids.length) return fail(res, 404, 'Sebagian siswa tidak ditemukan.');

  /* ---------- wali kelas: hanya siswa kelas yang diampu (menu Input Kejadian) ---------- */
  const scope = dbm.scopeWali(user);
  if (scope) {
    const luar = daftar.filter(s => !scope.includes(s.kelas_id));
    if (luar.length) return fail(res, 403, `Anda hanya dapat mencatat siswa kelas yang Anda ampu sebagai wali kelas (${luar.map(s => s.nama).join(', ')} di luar kelas Anda). Gunakan menu Buku Penghubung untuk mencatat siswa kelas lain.`);
  }

  /* ---------- kategori: boleh LEBIH DARI SATU dalam satu kejadian ----------
     Setiap pasangan (siswa × kategori) dicatat sebagai satu baris kejadian,
     sehingga poin, analitik kategori, dan laporan tetap akurat. */
  const katIds = (Array.isArray(b.kategori_ids) ? b.kategori_ids : String(b.kategori_ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  const singleKat = numOr(b.kategori_id);
  if (singleKat && !katIds.includes(singleKat)) katIds.push(singleKat);
  if (!katIds.length) return fail(res, 400, 'Kategori poin wajib dipilih.');
  const kategori = katIds.map(id => db.prepare('SELECT * FROM kategori WHERE id=?').get(id)).filter(Boolean);
  if (kategori.length !== katIds.length) return fail(res, 404, 'Sebagian kategori poin tidak ditemukan.');
  const tanggal = String(b.tanggal || '').slice(0, 10) || dbm.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return fail(res, 400, 'Tanggal kejadian tidak valid.');
  const jam = /^\d{2}:\d{2}$/.test(String(b.jam || '')) ? String(b.jam) : '';
  /* lokasi: pilihan daftar ATAU teks manual (opsi "Lainnya") */
  const lokasi = String(b.lokasi || b.lokasi_manual || '').trim().slice(0, 80);
  const keterangan = String(b.keterangan || '').trim();
  const cfg = dbm.formConfig();
  if (cfg.wajib_keterangan && !keterangan) return fail(res, 400, 'Keterangan kronologi kejadian wajib diisi.');
  const taId = Number(b.ta_id) || (dbm.tahunAktif() || {}).id || null;
  const semester = ['ganjil', 'genap'].includes(b.semester) ? b.semester : dbm.getSetting('semester_aktif', 'ganjil');
  const poin = kategori.reduce((a, k) => a + (Number(k.poin) || 0), 0);
  const jenisSet = [...new Set(kategori.map(k => k.jenis))];
  const jenis = jenisSet.length === 1 ? jenisSet[0] : 'campuran';
  const judulInput = String(b.judul || '').trim();
  const bukti = String(b.bukti_url || '').trim();

  /* ---------- penguncian jeda input (anti double input) ---------- */
  const cooldown = Math.max(0, Number(dbm.getSetting('input_cooldown_jam', 0)) || 0);
  if (cooldown) {
    const terkunci = [];
    for (const s of daftar) {
      const last = db.prepare(`SELECT e.created_at, e.oleh_nama FROM kejadian e
        WHERE e.siswa_id=? ORDER BY e.id DESC LIMIT 1`).get(s.id);
      if (!last || !last.created_at) continue;
      const t = new Date(String(last.created_at).replace(' ', 'T'));
      if (Number.isNaN(t.getTime())) continue;
      const sisa = t.getTime() + cooldown * 3600000 - Date.now();
      if (sisa > 0) terkunci.push(`${s.nama} (${Math.ceil(sisa / 60000)} menit lagi, dicatat ${last.oleh_nama || '-'})`);
    }
    if (terkunci.length) {
      return fail(res, 429, `Penguncian jeda input aktif selama ${cooldown} jam — siswa berikut baru saja dicatat: ${terkunci.join('; ')}.`);
    }
  }

  const ins = db.prepare(`INSERT INTO kejadian(siswa_id,kategori_id,judul,jenis,poin,tanggal,keterangan,bukti_url,ta_id,semester,oleh,oleh_nama,created_at,jam,lokasi)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const hasil = [];
  let baris = 0;
  db.transaction(() => {
    for (const sw of daftar) {
      let firstId = null, poinSiswa = 0;
      for (const k of kategori) {
        const r = ins.run(sw.id, k.id, judulInput || k.nama, k.jenis, Number(k.poin) || 0, tanggal, keterangan, bukti,
          taId, semester, user.id, user.nama, dbm.now(), jam, lokasi);
        if (firstId === null) firstId = Number(r.lastInsertRowid);
        poinSiswa += Number(k.poin) || 0;
        baris++;
      }
      const totalPel = db.prepare("SELECT COALESCE(SUM(poin),0) p FROM kejadian WHERE siswa_id=? AND jenis='pelanggaran'").get(sw.id).p;
      hasil.push({
        id: firstId, siswa: sw.nama, siswa_id: sw.id, poin: poinSiswa, jenis,
        jumlah_kategori: kategori.length, kategori: kategori.map(k => k.nama).join(', '),
        sanksi: dbm.sanksiOf(totalPel)
      });
    }
  })();
  dbm.logAudit(user, 'TAMBAH', 'kejadian',
    `${kategori.map(k => `${k.nama} (${k.poin} poin)`).join(' + ')} — ${daftar.map(sw => sw.nama).join(', ')}${lokasi ? ' @ ' + lokasi : ''}`, ipOf(req));
  json(res, 200, {
    ok: true, jumlah: hasil.length, baris,
    id: hasil[0].id, poin, jenis,
    jumlah_kategori: kategori.length,
    kategori: kategori.map(k => k.nama).join(', '),
    siswa: hasil.map(h => h.siswa).join(', '),
    sanksi: hasil[hasil.length - 1].sanksi,
    hasil
  });
});
del('/api/kejadian/:id', (req, res, q, params) => {
  const user = guard(req, res, 'kejadian', 'delete'); if (!user) return;
  const e = db.prepare('SELECT e.*, s.nama siswa_nama FROM kejadian e JOIN siswa s ON s.id=e.siswa_id WHERE e.id=?').get(params.id);
  if (!e) return fail(res, 404, 'Kejadian tidak ditemukan.');
  dbm.trashAdd(user, 'kejadian', e, `${e.siswa_nama} — ${e.judul}`);
  db.prepare('DELETE FROM kejadian WHERE id=?').run(e.id);
  dbm.logAudit(user, 'HAPUS', 'kejadian', `Menghapus kejadian ${e.jenis} ${e.poin} poin — ${e.siswa_nama}: ${e.judul} → Kotak Sampah`, ipOf(req));
  json(res, 200, { ok: true, ke_sampah: 1 });
});
/* hapus banyak riwayat kejadian sekaligus (dari Kartu Siswa) */
post('/api/kejadian/bulk-delete', async (req, res) => {
  const user = guard(req, res, 'kejadian', 'delete'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(',')).map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu riwayat terlebih dahulu.');
  const rows = db.prepare(`SELECT e.*, s.nama siswa_nama, s.kelas_id FROM kejadian e JOIN siswa s ON s.id=e.siswa_id
    WHERE e.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const scope = dbm.scopeWali(user);
  if (scope && rows.some(r => !scope.includes(r.kelas_id))) return fail(res, 403, 'Sebagian riwayat milik kelas yang bukan Anda ampu.');
  db.transaction(() => {
    for (const r of rows) {
      dbm.trashAdd(user, 'kejadian', r, `${r.siswa_nama} — ${r.judul}`);
      db.prepare('DELETE FROM kejadian WHERE id=?').run(r.id);
    }
  })();
  dbm.logAudit(user, 'HAPUS', 'kejadian', `Hapus ${rows.length} riwayat kejadian → Kotak Sampah`, ipOf(req));
  json(res, 200, { ok: true, jumlah: rows.length, pesan: `${rows.length} riwayat dipindahkan ke Kotak Sampah.` });
});

/* ---------- catatan tindak lanjut / pendekatan siswa ---------- */
get('/api/tindak-lanjut', (req, res, q) => {
  const user = guard(req, res, 'tindak_lanjut', 'view'); if (!user) return;
  const rows = dbm.tindakLanjutRows({
    siswaId: numOr(q.siswa), status: q.status || 'all', q: (q.q || '').trim(), user
  });
  json(res, 200, { ok: true, rows, stats: dbm.tindakLanjutStats(), jenis: dbm.TL_JENIS, status_list: dbm.TL_STATUS });
});
post('/api/tindak-lanjut/save', async (req, res) => {
  const user = guard(req, res, 'tindak_lanjut', 'write'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.siswa_ids) ? b.siswa_ids : String(b.siswa_ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  const single = numOr(b.siswa_id);
  if (single && !ids.includes(single)) ids.push(single);
  if (!ids.length) return fail(res, 400, 'Siswa wajib dipilih.');
  const daftar = ids.map(id => db.prepare('SELECT * FROM siswa WHERE id=?').get(id)).filter(Boolean);
  if (!daftar.length) return fail(res, 404, 'Siswa tidak ditemukan.');
  const jenis = String(b.jenis || '').trim();
  if (!jenis) return fail(res, 400, 'Jenis pendekatan wajib dipilih.');
  const hasil = String(b.hasil || '').trim();
  if (hasil.length < 5) return fail(res, 400, 'Hasil catatan / progress wajib diisi (minimal 5 karakter).');
  const status = ['selesai', 'pemantauan', 'lanjutan'].includes(b.status) ? b.status : 'pemantauan';
  let tanggal = String(b.tanggal || '').replace('T', ' ').trim();
  if (!tanggal) tanggal = dbm.now().slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}/.test(tanggal)) return fail(res, 400, 'Tanggal tindak lanjut tidak valid.');
  tanggal = tanggal.slice(0, 16);
  const nextAt = /^\d{4}-\d{2}-\d{2}$/.test(String(b.next_at || '').slice(0, 10)) ? String(b.next_at).slice(0, 10) : '';
  const ta = dbm.tahunAktif();
  const ins = db.prepare(`INSERT INTO tindak_lanjut(siswa_id,tanggal,jenis,hasil,status,next_at,kejadian_id,oleh,oleh_nama,oleh_role,ta_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const out = [];
  db.transaction(() => {
    for (const s of daftar) {
      const r = ins.run(s.id, tanggal, jenis, hasil, status, nextAt, numOr(b.kejadian_id), user.id, user.nama, user.role, ta ? ta.id : null, dbm.now());
      out.push({ id: Number(r.lastInsertRowid), siswa: s.nama });
    }
  })();
  dbm.logAudit(user, 'TAMBAH', 'tindak_lanjut', `Catatan pembinaan ${jenis} — ${daftar.map(s => s.nama).join(', ')} (${status})`, ipOf(req));
  json(res, 200, { ok: true, jumlah: out.length, id: out[0].id, siswa: out.map(o => o.siswa).join(', '), hasil: out });
});
del('/api/tindak-lanjut/:id', (req, res, q, params) => {
  const user = guard(req, res, 'tindak_lanjut', 'delete'); if (!user) return;
  const row = db.prepare('SELECT tl.*, s.nama FROM tindak_lanjut tl JOIN siswa s ON s.id=tl.siswa_id WHERE tl.id=?').get(params.id);
  if (!row) return fail(res, 404, 'Catatan tidak ditemukan.');
  db.prepare('DELETE FROM tindak_lanjut WHERE id=?').run(params.id);
  dbm.logAudit(user, 'HAPUS', 'tindak_lanjut', `Menghapus catatan pembinaan ${row.jenis} — ${row.nama}`, ipOf(req));
  json(res, 200, { ok: true });
});

/* ---------- buku penghubung digital (jurnal harian) ---------- */
get('/api/jurnal', (req, res, q) => {
  const user = guard(req, res, 'jurnal', 'view'); if (!user) return;
  const f = filters(q);
  const rows = dbm.jurnalRows({
    taId: f.taId, tanggal: q.tanggal || '', q: (q.q || '').trim(), user,
    kategoriId: numOr(q.kategori), jenis: ['pelanggaran', 'prestasi'].includes(q.jenis) ? q.jenis : ''
  });
  const hariIni = dbm.jurnalRows({ taId: f.taId, tanggal: dbm.today(), user });
  json(res, 200, {
    ok: true, rows, hari_ini: hariIni, tanggal: dbm.today(),
    lokasi: dbm.lokasiList(), config: dbm.jurnalConfig(), filters: f,
    ringkas: {
      total: rows.length, hari_ini: hariIni.length,
      pelanggaran: hariIni.filter(r => r.jenis === 'pelanggaran').length,
      prestasi: hariIni.filter(r => r.jenis === 'prestasi').length
    }
  });
});
post('/api/jurnal/save', async (req, res) => {
  const user = guard(req, res, 'jurnal', 'write'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.siswa_ids) ? b.siswa_ids : String(b.siswa_ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  const single = numOr(b.siswa_id);
  if (single && !ids.includes(single)) ids.push(single);
  if (!ids.length) return fail(res, 400, 'Siswa wajib dipilih.');
  const daftar = ids.map(id => db.prepare('SELECT * FROM siswa WHERE id=?').get(id)).filter(Boolean);
  if (!daftar.length) return fail(res, 404, 'Siswa tidak ditemukan.');
  /* CATATAN: Buku Penghubung sengaja TIDAK dibatasi kelas wali — wali kelas boleh
     mencatat siswa kelas lain (temuan harian lintas kelas). Pembatasan hanya pada Input Kejadian. */
  /* ---------- kategori: boleh lebih dari satu per temuan ---------- */
  const katIds = (Array.isArray(b.kategori_ids) ? b.kategori_ids : String(b.kategori_ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  const singleKat = numOr(b.kategori_id);
  if (singleKat && !katIds.includes(singleKat)) katIds.push(singleKat);
  if (!katIds.length) return fail(res, 400, 'Kategori poin wajib dipilih agar temuan langsung tercatat pada poin siswa.');
  const kategori = katIds.map(id => db.prepare('SELECT * FROM kategori WHERE id=?').get(id)).filter(Boolean);
  if (kategori.length !== katIds.length) return fail(res, 404, 'Sebagian kategori poin tidak ditemukan.');
  const poinTotal = kategori.reduce((a, k) => a + (Number(k.poin) || 0), 0);
  const jenisSet = [...new Set(kategori.map(k => k.jenis))];
  const jenis = jenisSet.length === 1 ? jenisSet[0] : 'campuran';
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
  const jam = /^\d{2}:\d{2}$/.test(String(b.jam || '')) ? String(b.jam) : dbm.now().slice(11, 16);
  const lokasi = String(b.lokasi || b.lokasi_manual || '').trim().slice(0, 80);
  const cfg = dbm.jurnalConfig();
  if (cfg.wajib_lokasi && !lokasi) return fail(res, 400, 'Lokasi temuan wajib diisi.');
  const keterangan = String(b.keterangan || '').trim();
  if (cfg.wajib_keterangan && !keterangan) return fail(res, 400, 'Keterangan temuan wajib diisi.');
  const ta = dbm.tahunAktif();
  const semester = ['ganjil', 'genap'].includes(b.semester) ? b.semester : dbm.getSetting('semester_aktif', 'ganjil');
  const bukti = String(b.bukti_url || '').trim();
  const insKej = db.prepare(`INSERT INTO kejadian(siswa_id,kategori_id,judul,jenis,poin,tanggal,keterangan,bukti_url,ta_id,semester,oleh,oleh_nama,created_at,jam,lokasi)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insJur = db.prepare(`INSERT INTO jurnal(tanggal,jam,siswa_id,kategori_id,jenis,poin,lokasi,keterangan,kejadian_id,petugas,petugas_role,petugas_id,ta_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const hasil = [];
  let baris = 0;
  db.transaction(() => {
    for (const siswa of daftar) {
      let kejadianId = null, firstKejadian = null;
      for (const k of kategori) {
        let kid = null;
        if (cfg.auto_poin) {
          const r = insKej.run(siswa.id, k.id, k.nama, k.jenis, Number(k.poin) || 0, tanggal, keterangan, bukti,
            ta ? ta.id : null, semester, user.id, user.nama, dbm.now(), jam, lokasi);
          kid = Number(r.lastInsertRowid);
          if (firstKejadian === null) firstKejadian = kid;
        }
        insJur.run(tanggal, jam, siswa.id, k.id, k.jenis, Number(k.poin) || 0, lokasi, keterangan, kid,
          user.nama, user.role, user.id, ta ? ta.id : null, dbm.now());
        baris++;
      }
      if (cfg.auto_poin) kejadianId = firstKejadian;
      const totalPel = db.prepare("SELECT COALESCE(SUM(poin),0) p FROM kejadian WHERE siswa_id=? AND jenis='pelanggaran'").get(siswa.id).p;
      hasil.push({
        kejadian_id: kejadianId, siswa: siswa.nama, siswa_id: siswa.id,
        poin: poinTotal, jenis, jumlah_kategori: kategori.length,
        kategori: kategori.map(k => k.nama).join(', '), sanksi: dbm.sanksiOf(totalPel)
      });
    }
  })();
  dbm.logAudit(user, 'TAMBAH', 'jurnal',
    `${kategori.map(k => `${k.nama} (${k.poin} poin)`).join(' + ')} — ${daftar.map(sw => sw.nama).join(', ')} @ ${lokasi || 'lokasi tidak dicatat'}`, ipOf(req));
  json(res, 200, {
    ok: true, jumlah: hasil.length, baris, hasil,
    kejadian_id: hasil[0].kejadian_id, poin: poinTotal, jenis,
    jumlah_kategori: kategori.length,
    kategori: kategori.map(k => k.nama).join(', '),
    siswa: hasil.map(h => h.siswa).join(', '),
    sanksi: hasil[hasil.length - 1].sanksi
  });
});

/* =====================================================================
   RIWAYAT AKTIVITAS (dipindah ke dashboard, tidak lagi di form input)
   ===================================================================== */
get('/api/riwayat', (req, res, q) => {
  const user = guard(req, res, 'dashboard', 'view'); if (!user) return;
  const f = filters(q);
  const limit = Math.max(1, Math.min(500, Number(q.limit) || 150));
  const rows = dbm.riwayatAktivitas({ taId: f.taId, user, limit });
  json(res, 200, { ok: true, rows, total: rows.length });
});

post('/api/riwayat/hapus-massal', async (req, res) => {
  const user = guard(req, res, 'dashboard', 'view'); if (!user) return;
  const b = await readBody(req);
  let items = [];
  if (Array.isArray(b.items)) items = b.items;
  else items = String(b.items || '').split(',').map(x => { const [s, i] = x.split(':'); return { sumber: s, id: Number(i) }; });
  items = items.map(it => ({ sumber: String(it.sumber || ''), id: Number(it.id) })).filter(it => it.id && ['jurnal', 'kejadian'].includes(it.sumber));
  if (!items.length) return fail(res, 400, 'Pilih minimal satu riwayat terlebih dahulu.');
  const scope = dbm.scopeWali(user);
  let hapus = 0, ditolak = 0;
  db.transaction(() => {
    for (const it of items) {
      if (it.sumber === 'kejadian') {
        if (!dbm.can(user, 'kejadian', 'delete')) { ditolak++; continue; }
        const e = db.prepare('SELECT e.*, s.nama siswa_nama, s.kelas_id FROM kejadian e JOIN siswa s ON s.id=e.siswa_id WHERE e.id=?').get(it.id);
        if (!e) continue;
        if (scope && !scope.includes(e.kelas_id)) { ditolak++; continue; }
        dbm.trashAdd(user, 'kejadian', e, `${e.siswa_nama} — ${e.judul}`);
        db.prepare('DELETE FROM kejadian WHERE id=?').run(e.id);
        hapus++;
      } else {
        if (!dbm.can(user, 'jurnal', 'write')) { ditolak++; continue; }
        const j = db.prepare('SELECT j.*, s.nama siswa_nama, s.kelas_id FROM jurnal j LEFT JOIN siswa s ON s.id=j.siswa_id WHERE j.id=?').get(it.id);
        if (!j) continue;
        if (scope && j.kelas_id && !scope.includes(j.kelas_id)) { ditolak++; continue; }
        dbm.trashAdd(user, 'jurnal', j, `${j.siswa_nama || '-'} — ${j.keterangan || 'jurnal'}`);
        db.prepare('DELETE FROM jurnal WHERE id=?').run(j.id);
        hapus++;
      }
    }
  })();
  if (!hapus && ditolak) return fail(res, 403, 'Role Anda tidak berhak menghapus riwayat yang dipilih.');
  dbm.logAudit(user, 'HAPUS', 'riwayat', `Hapus ${hapus} riwayat aktivitas → Kotak Sampah`, ipOf(req));
  json(res, 200, { ok: true, jumlah: hapus, ditolak, pesan: `${hapus} riwayat dipindahkan ke Kotak Sampah${ditolak ? `, ${ditolak} dilewati (tidak berhak)` : ''}.` });
});

/* =====================================================================
   MASUKAN & KENDALA (umpan balik pengguna → halaman rekap rahasia)
   ===================================================================== */
get('/api/feedback', (req, res, q) => {
  const user = guard(req, res, 'feedback', 'view'); if (!user) return;
  /* daftar milik sendiri + (bila berhak) seluruh masukan */
  const semua = dbm.can(user, 'feedback_admin', 'view');
  const rows = dbm.feedbackRows({
    userId: semua ? 0 : user.id, status: q.status || 'all',
    jenis: q.jenis || 'all', q: (q.q || '').trim(), limit: Number(q.limit) || 300
  });
  json(res, 200, {
    ok: true, rows, semua, jenis: dbm.FEEDBACK_JENIS, status_list: dbm.FEEDBACK_STATUS,
    stats: dbm.feedbackStats()
  });
});
post('/api/feedback', async (req, res) => {
  const user = guard(req, res, 'feedback', 'write'); if (!user) return;
  const b = await readBody(req);
  try {
    const id = dbm.feedbackAdd(user, b);
    dbm.logAudit(user, 'TAMBAH', 'feedback', `Masukan/kendala baru (#${id}): ${String(b.judul || b.pesan || '').slice(0, 60)}`, ipOf(req));
    json(res, 200, { ok: true, id, pesan: 'Terima kasih! Masukan & kendala Anda sudah terkirim ke pengelola.' });
  } catch (e) { fail(res, 400, e.message); }
});
post('/api/feedback/status', async (req, res) => {
  const user = guard(req, res, 'feedback_admin', 'write'); if (!user) return;
  const b = await readBody(req);
  const id = Number(b.id);
  const status = dbm.FEEDBACK_STATUS.some(s => s.key === b.status) ? b.status : 'dibaca';
  const row = db.prepare('SELECT * FROM feedback WHERE id=?').get(id);
  if (!row) return fail(res, 404, 'Masukan tidak ditemukan.');
  db.prepare('UPDATE feedback SET status=?, balasan=?, balas_oleh=?, balas_at=?, updated_at=? WHERE id=?')
    .run(status, b.balasan !== undefined ? String(b.balasan || '').slice(0, 2000) : row.balasan,
      b.balasan !== undefined ? user.nama : row.balas_oleh,
      b.balasan !== undefined ? dbm.now() : row.balas_at, dbm.now(), id);
  dbm.logAudit(user, 'UBAH', 'feedback', `Status masukan #${id} → ${status}`, ipOf(req));
  json(res, 200, { ok: true, pesan: 'Status masukan diperbarui.' });
});
post('/api/feedback/delete', async (req, res) => {
  const user = guard(req, res, 'feedback_admin', 'delete'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || b.id || '').split(',')).map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu masukan.');
  const r = db.prepare(`DELETE FROM feedback WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  dbm.logAudit(user, 'HAPUS', 'feedback', `Hapus ${r.changes} masukan/kendala`, ipOf(req));
  json(res, 200, { ok: true, jumlah: r.changes, pesan: `${r.changes} masukan dihapus.` });
});

/* ---------- analitik pola waktu & tempat ---------- */
get('/api/analitik', (req, res, q) => {
  const user = guard(req, res, 'analitik', 'view'); if (!user) return;
  const f = filters(q);
  const pola = dbm.polaPelanggaran({
    taId: f.taId, semester: f.semester, user,
    from: q.from || '', to: q.to || ''
  });
  const rows = dbm.siswaRows({ taId: f.taId, semester: f.semester, user });
  const sanksiRekap = {};
  for (const s of rows) {
    const key = s.sanksi ? s.sanksi.label : 'Belum ada rekomendasi';
    sanksiRekap[key] = (sanksiRekap[key] || 0) + 1;
  }
  json(res, 200, {
    ok: true, pola, filters: f,
    lokasi: dbm.lokasiList(),
    sanksi_rules: dbm.sanksiRules(),
    sanksiRekap: Object.entries(sanksiRekap).map(([label, jumlah]) => ({ label, jumlah })).sort((a, b) => b.jumlah - a.jumlah),
    statusDist: dbm.statusRules().map(r => ({ label: r.label, jumlah: rows.filter(s => s.status.label === r.label).length })),
    perKelas: dbm.kelasList().map(k => {
      const list = rows.filter(s => s.kelas_id === k.id);
      return { id: k.id, nama: k.nama, jumlah: list.length, pel: list.reduce((a, s) => a + s.pel, 0) };
    })
  });
});

/* ---------- Kotak Sampah ---------- */
get('/api/trash', (req, res) => {
  if (!guard(req, res, 'sampah', 'view')) return;
  const rows = dbm.trashList();
  json(res, 200, {
    ok: true, rows, total: rows.length,
    ringkas: {
      siswa: rows.filter(r => r.tabel === 'siswa').length,
      kelas: rows.filter(r => r.tabel === 'kelas').length,
      kejadian: rows.filter(r => r.tabel === 'kejadian').length,
      lainnya: rows.filter(r => !['siswa', 'kelas', 'kejadian'].includes(r.tabel)).length
    },
    hari_simpan: dbm.TRASH_DAYS
  });
});
post('/api/trash/restore', async (req, res) => {
  const user = guard(req, res, 'sampah', 'write'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(',')).map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu data terlebih dahulu.');
  const ok = [], gagal = [];
  for (const id of ids) {
    try { const r = dbm.trashRestore(id, user); ok.push(r); }
    catch (e) { gagal.push(e.message); }
  }
  json(res, 200, {
    ok: true, dipulihkan: ok.length, gagal,
    pesan: `${ok.length} data dipulihkan${gagal.length ? `, ${gagal.length} gagal` : ''}.`
  });
});
post('/api/trash/delete', async (req, res) => {
  const user = guard(req, res, 'sampah', 'delete'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(',')).map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu data terlebih dahulu.');
  let n = 0;
  for (const id of ids) if (dbm.trashPurgeHabis(id, user)) n++;
  json(res, 200, { ok: true, jumlah: n, pesan: `${n} data dihapus permanen.` });
});

/* ---------- Audit data tersembunyi (orphan) — administrator saja ---------- */
function adminOnly(req, res) {
  const s = sessionFrom(req);
  if (!s) { fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.'); return null; }
  if (s.user.role !== 'admin') { fail(res, 403, 'Menu ini hanya untuk Administrator.'); return null; }
  return s.user;
}
get('/api/setup-checklist', (req, res) => {
  if (!adminOnly(req, res)) return;
  const count = sql => Number(db.prepare(sql).get().jumlah) || 0;
  const schoolName = String(dbm.getSetting('sekolah_nama', '') || '').trim();
  const activeYear = db.prepare('SELECT id,nama FROM tahun_ajaran WHERE aktif=1 ORDER BY id DESC LIMIT 1').get() || null;
  const staff = db.prepare('SELECT role,roles FROM users WHERE aktif=1').all()
    .filter(u => dbm.userRoleList(u).some(role => role !== 'admin')).length;
  const students = count("SELECT COUNT(*) AS jumlah FROM siswa WHERE LOWER(COALESCE(status,'aktif'))='aktif'");
  const classes = count('SELECT COUNT(*) AS jumlah FROM kelas');
  const categories = count('SELECT COUNT(*) AS jumlah FROM kategori WHERE aktif=1');
  const slots = activeYear
    ? Number((db.prepare('SELECT COUNT(*) AS jumlah FROM jadwal WHERE ta_id=?').get(activeYear.id) || {}).jumlah) || 0
    : 0;
  const telegramReady = String(dbm.getSetting('backup_telegram_auto', '0')) === '1'
    && !!String(dbm.getSetting('backup_telegram_bot_token', '') || '').trim()
    && !!String(dbm.getSetting('backup_telegram_chat_id', '') || '').trim();
  const stages = {
    profile: { complete: !!schoolName, detail: schoolName ? `Nama sekolah: ${schoolName}` : 'Nama sekolah belum diisi.' },
    year: { complete: !!activeYear, detail: activeYear ? `Tahun aktif: ${activeYear.nama}` : 'Belum ada tahun pelajaran aktif.' },
    classes: { complete: classes > 0, detail: classes ? `${classes} kelas sudah dibuat.` : 'Belum ada kelas.' },
    staff: { complete: staff > 0, detail: staff ? `${staff} akun guru/pegawai aktif.` : 'Belum ada akun guru/pegawai selain administrator.' },
    students: { complete: students > 0, detail: students ? `${students} siswa aktif terdaftar.` : 'Belum ada siswa aktif.' },
    categories: { complete: categories > 0, detail: categories ? `${categories} kategori poin aktif tersedia.` : 'Belum ada kategori poin aktif.' },
    schedule: { complete: slots > 0, detail: slots ? `${slots} slot jadwal pada tahun aktif.` : 'Belum ada slot jadwal pada tahun aktif.' },
    backup: { complete: telegramReady, detail: telegramReady ? 'Backup otomatis Telegram aktif.' : 'Bot Token, Chat ID, dan backup otomatis perlu disiapkan.' }
  };
  const total = Object.keys(stages).length;
  const completed = Object.values(stages).filter(stage => stage.complete).length;
  json(res, 200, { ok: true, stages, completed, total, percent: Math.round(completed / total * 100) });
});
get('/api/audit-data', (req, res) => {
  if (!adminOnly(req, res)) return;
  json(res, 200, { ok: true, checks: dbm.orphanData(), tabel: dbm.ORPHAN_CHECKS.map(c => ({ key: c.key, tabel: c.tabel, label: c.label })) });
});
post('/api/audit-data/delete', async (req, res) => {
  const user = adminOnly(req, res); if (!user) return;
  const b = await readBody(req);
  const items = Array.isArray(b.items) ? b.items : [];
  let total = 0;
  const gagal = [];
  for (const it of items) {
    try { total += dbm.orphanDelete(String(it.tabel || ''), it.ids || [], user); }
    catch (e) { gagal.push(e.message); }
  }
  json(res, 200, { ok: true, jumlah: total, gagal, pesan: `${total} baris data menggantung dihapus.` });
});

/* ---------- Kalender kedisiplinan ---------- */
get('/api/kalender', (req, res, q) => {
  const user = guard(req, res, 'kalender', 'view'); if (!user) return;
  const f = filters(q);
  const data = dbm.kalenderData({
    taId: f.taId, semester: f.semester, bulan: q.bulan, kelasId: numOr(q.kelas), user
  });
  json(res, 200, {
    ok: true, ...data, filters: f,
    kelas: dbm.kelasList().map(k => ({ id: k.id, nama: k.nama }))
  });
});

/* ---------- Backup & Restore (JSON) ---------- */
get('/api/backup/json', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'write')) return;
  const user = sessionFrom(req).user;
  const dump = schoolBackupDump();
  dbm.logAudit(user, 'BACKUP', 'pengaturan', `Mengunduh backup database JSON (${Object.values(dump.jumlah).reduce((a, b) => a + b, 0)} baris)`, ipOf(req));
  const buf = Buffer.from(JSON.stringify(dump, null, 1), 'utf8');
  const stamp = telegramBackup.partsAt().date;
  sendFile(res, buf, 'application/json', `backup-tata-tertib-${stamp}.json`);
});

/** CSV satu tabel (untuk arsip ZIP yang bisa dibuka Excel) */
function csvOf(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc2 = v => {
    const s2 = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => { const v = r[c]; return esc2(typeof v === 'string' && v.length > 320 ? v.slice(0, 320) + '…' : v); }).join(','))].join('\r\n');
}
function schoolBackupDump() {
  const dump = dbm.dumpAll();
  dump.tabel.settings = telegramBackup.redactSettingRows('settings', dump.tabel.settings || []);
  return dump;
}
function buildSchoolBackupZip() {
  const dump = schoolBackupDump();
  const total = Object.values(dump.jumlah).reduce((a, b) => a + b, 0);
  const files = [{ name: 'database.json', data: JSON.stringify(dump, null, 1) }];
  for (const [t, rows] of Object.entries(dump.tabel)) {
    if (!rows.length) continue;
    files.push({ name: 'data/' + t + '.csv', data: Buffer.from('\ufeff' + csvOf(rows), 'utf8') });
  }
  const media = dbm.uploadList({ limit: 5000 }).map(r => ({
    id: r.id, filename: r.filename, url: r.url, ukuran: r.ukuran, jenis: r.jenis, ref_tabel: r.ref_tabel, ref_id: r.ref_id, created_at: r.created_at
  }));
  files.push({ name: 'media.json', data: JSON.stringify({ jumlah: media.length, berkas: media }, null, 1) });
  const settings = dbm.allSettings();
  files.push({
    name: 'README.txt',
    data: [
      'ARSIP DATABASE — ' + (settings.app_nama || saas.branding().app_nama),
      'Sekolah      : ' + (settings.sekolah_nama || '-') + ' (NPSN ' + (settings.sekolah_npsn || '-') + ')',
      'Dibuat       : ' + lib.stampID(lib.nowStamp()),
      'Total baris  : ' + total,
      '',
      'ISI ARSIP',
      '  database.json  → dipakai tombol "Restore" pada menu Pengaturan → Backup & Restore',
      '  data/*.csv     → salinan tiap tabel agar bisa dibuka/dibaca dengan Excel',
      '  media.json     → daftar berkas foto yang pernah diunggah (URL penyimpanan)',
      '',
      'CARA MEMULIHKAN',
      '  1. Buka aplikasi → Pengaturan → Backup & Restore',
      '  2. Unggah berkas .zip ini (boleh juga database.json saja)',
      '  3. Ketik PULIHKAN lalu klik "Pulihkan Database Sekarang"'
    ].join('\n')
  });
  return { buf: lib.zip(files), total, media: media.length };
}
function schoolTelegramConfig() {
  const token = String(dbm.getSetting('backup_telegram_bot_token', '') || '').trim();
  return {
    token_set: Boolean(token),
    token_masked: telegramBackup.maskSecret(token),
    chat_id: String(dbm.getSetting('backup_telegram_chat_id', '') || '').trim(),
    auto: String(dbm.getSetting('backup_telegram_auto', '0')) === '1',
    jam: telegramBackup.safeSchedule(dbm.getSetting('backup_telegram_jam', telegramBackup.DEFAULT_SCHEDULE)),
    terakhir: String(dbm.getSetting('backup_telegram_terakhir', '') || ''),
    status: String(dbm.getSetting('backup_telegram_status', '') || ''),
    error: String(dbm.getSetting('backup_telegram_error', '') || '')
  };
}
/** EKSPOR LENGKAP: satu berkas .zip berisi database.json + CSV per tabel + daftar berkas */
get('/api/backup/zip', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  const user = sessionFrom(req).user;
  const { buf: zipBuf, total, media } = buildSchoolBackupZip();
  const stamp = telegramBackup.partsAt().stamp;
  dbm.logAudit(user, 'EKSPOR DATABASE', 'pengaturan',
    `Mengunduh arsip ZIP database (${total} baris, ${media} berkas, ${Math.round(zipBuf.length / 1024)} KB)`, ipOf(req));
  sendFile(res, zipBuf, 'application/zip', `backup-tata-tertib-${stamp}.zip`);
});
/**
 * Baca berkas backup: .json (lama) ATAU .zip (arsip ekspor lengkap).
 * Aman: hanya membaca `database.json`, tidak mengekstrak apa pun ke disk.
 */
function parseBackupPayload(b) {
  const base64 = String(b.base64 || '').replace(/^data:[^,]*,/, '');
  if (!base64) throw new Error('Berkas backup kosong.');
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new Error('Berkas backup tidak terbaca.');
  // ZIP ditandai "PK\x03\x04"
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    let entries;
    try { entries = require('./xlsx-read').unzipEntries(buf); }
    catch (e) { throw new Error('Arsip ZIP tidak dapat dibuka: ' + e.message); }
    const key = Object.keys(entries).find(n => /(^|\/)database\.json$/i.test(n));
    if (!key) throw new Error('Arsip ZIP tidak memuat database.json. Gunakan berkas hasil tombol "Ekspor Database (.zip)".');
    const raw = Buffer.isBuffer(entries[key]) ? entries[key].toString('utf8') : String(entries[key] || '');
    return JSON.parse(raw);
  }
  return JSON.parse(buf.toString('utf8'));
}

post('/api/backup/restore', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  if (user.role !== 'admin') return fail(res, 403, 'Restore database hanya dapat dilakukan Administrator.');
  const b = await readBody(req);
  let payload;
  try {
    payload = parseBackupPayload(b);
  } catch (e) {
    return fail(res, 400, e.message || 'Berkas backup tidak dapat dibaca.');
  }
  if (!payload) return fail(res, 400, 'Berkas backup tidak dapat dibaca (bukan JSON/ZIP yang valid).');
  try {
    const r = dbm.restoreAll(payload, user);
    // sesi lama dibersihkan agar memakai akun hasil restore
    try { db.prepare('DELETE FROM sesi').run(); } catch (e) { }
    destroySession(req, res);
    json(res, 200, { ok: true, total: r.total, snapshot: r.snapshot ? 'tersimpan' : '-', pesan: `Database dipulihkan (${r.total} baris). Silakan masuk kembali.` });
  } catch (e) { fail(res, 400, e.message); }
});
get('/api/backup/info', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  const dump = dbm.dumpAll();
  json(res, 200, {
    ok: true, jumlah: dump.jumlah, total: Object.values(dump.jumlah).reduce((a, b) => a + b, 0),
    ukuran_kb: Math.round(Buffer.byteLength(JSON.stringify(dump)) / 1024),
    telegram: schoolTelegramConfig()
  });
});
post('/api/backup/telegram', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  if (user.role !== 'admin') return fail(res, 403, 'Pengaturan backup Telegram hanya dapat diubah Administrator.');
  const b = await readBody(req);
  const current = schoolTelegramConfig();
  const token = String(b.bot_token || '').trim();
  const chat = b.chat_id === undefined ? current.chat_id : String(b.chat_id || '').trim();
  let jam;
  try { jam = telegramBackup.parseSchedule(b.jam === undefined ? current.jam : b.jam).join(', '); }
  catch (e) { return fail(res, 400, e.message); }
  const auto = b.auto === undefined ? current.auto
    : b.auto === true || b.auto === 1 || b.auto === '1' || b.auto === 'true';
  if (token.length > 256) return fail(res, 400, 'Bot token terlalu panjang.');
  if (token && !telegramBackup.isValidToken(token)) return fail(res, 400, 'Format Bot Token Telegram tidak valid.');
  if (chat.length > 128) return fail(res, 400, 'Chat ID terlalu panjang.');
  if (auto && (!(token || current.token_set) || !chat)) {
    return fail(res, 400, 'Token bot dan Chat ID wajib diisi sebelum backup otomatis diaktifkan.');
  }
  if (token) dbm.setSetting('backup_telegram_bot_token', token);
  if (b.chat_id !== undefined) dbm.setSetting('backup_telegram_chat_id', chat);
  dbm.setSetting('backup_telegram_jam', jam);
  dbm.setSetting('backup_telegram_auto', auto ? '1' : '0');
  dbm.logAudit(user, 'UBAH BACKUP TELEGRAM', 'pengaturan', 'Konfigurasi backup Telegram', ipOf(req));
  json(res, 200, { ok: true, telegram: schoolTelegramConfig(), pesan: 'Konfigurasi backup Telegram disimpan.' });
});
post('/api/backup/telegram/uji', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  if (user.role !== 'admin') return fail(res, 403, 'Uji Telegram hanya dapat dilakukan Administrator.');
  const b = await readBody(req);
  const token = String(b.bot_token || '').trim() || String(dbm.getSetting('backup_telegram_bot_token', '') || '').trim();
  const chat = String(b.chat_id || '').trim() || String(dbm.getSetting('backup_telegram_chat_id', '') || '').trim();
  try {
    await telegramBackup.testConnection(token, chat);
    dbm.logAudit(user, 'UJI BACKUP TELEGRAM', 'pengaturan', 'Pesan uji berhasil dikirim', ipOf(req));
    json(res, 200, { ok: true, pesan: 'Pesan uji berhasil dikirim ke Telegram.' });
  } catch (e) {
    dbm.logAudit(user, 'GAGAL UJI BACKUP TELEGRAM', 'pengaturan', e.message, ipOf(req));
    fail(res, 400, e.message);
  }
});
post('/api/backup/telegram/kirim', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  if (user.role !== 'admin') return fail(res, 403, 'Pengiriman backup Telegram hanya dapat dilakukan Administrator.');
  const cfg = schoolTelegramConfig();
  const token = String(dbm.getSetting('backup_telegram_bot_token', '') || '').trim();
  if (!token || !cfg.chat_id) return fail(res, 400, 'Simpan Token Bot dan Chat ID sebelum mengirim backup.');
  const stamp = telegramBackup.partsAt().stamp;
  const nama = `Backup_${String(dbm.getSetting('sekolah_nama', 'Sekolah') || 'Sekolah').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60)}_${stamp}.zip`;
  try {
    const { buf } = buildSchoolBackupZip();
    await telegramBackup.sendDocument(token, cfg.chat_id, buf, nama, `Backup sekolah ${lib.nowStamp()}`);
    dbm.setSetting('backup_telegram_terakhir', lib.nowStamp());
    dbm.setSetting('backup_telegram_status', 'sukses');
    dbm.setSetting('backup_telegram_error', '');
    dbm.logAudit(user, 'BACKUP TELEGRAM', 'pengaturan', `Backup manual ${nama} (${Math.round(buf.length / 1024)} KB)`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Arsip backup sekolah terkirim ke Telegram.' });
  } catch (e) {
    dbm.setSetting('backup_telegram_status', 'gagal');
    dbm.setSetting('backup_telegram_error', e.message);
    dbm.logAudit(user, 'GAGAL BACKUP TELEGRAM', 'pengaturan', `${nama}: ${e.message}`, ipOf(req));
    fail(res, 400, e.message);
  }
});

/* ---------- Reset data tahun ajaran ---------- */
get('/api/reset-ta/preview', (req, res, q) => {
  if (!adminOnly(req, res)) return;
  const taId = numOr(q.ta) || (dbm.tahunAktif() || {}).id;
  json(res, 200, {
    ok: true, ta_id: taId,
    ta: dbm.tahunList().find(t => t.id === taId) || null,
    tahun: dbm.tahunList(),
    scope: dbm.RESET_SCOPE,
    jumlah: dbm.resetPreview(taId)
  });
});
post('/api/reset-ta', async (req, res) => {
  const user = adminOnly(req, res); if (!user) return;
  const b = await readBody(req);
  if (String(b.konfirmasi || '').trim().toUpperCase() !== 'RESET') {
    return fail(res, 400, 'Ketik kata RESET pada kolom konfirmasi untuk melanjutkan.');
  }
  const taId = numOr(b.ta_id) || (dbm.tahunAktif() || {}).id;
  if (!taId) return fail(res, 400, 'Tahun pelajaran tidak ditemukan.');
  try {
    const r = dbm.resetTa(taId, Array.isArray(b.scope) ? b.scope : String(b.scope || '').split(','), user);
    json(res, 200, { ok: true, ...r, pesan: `${r.total} baris data tahun pelajaran direset. Snapshot ${r.snapshot ? 'tersimpan' : 'gagal dibuat'}.` });
  } catch (e) { fail(res, 400, e.message); }
});

/* Catatan: fitur "Data Contoh" (pemuatan data dummy) sudah DIHAPUS dari aplikasi.
   Tidak ada menu, tombol, maupun endpoint yang bisa menyuntikkan data contoh. */
/* ---------- pengguna & hak akses ---------- */
get('/api/users', (req, res) => {
  if (!guard(req, res, 'pengguna', 'view')) return;
  const rows = db.prepare('SELECT id,nama,jabatan,username,role,roles,nip,phone,aktif,foto,created_at FROM users ORDER BY role, nama').all()
    .map(u => ({ ...u, role_list: dbm.userRoleList(u), role_label: dbm.roleLabelOf(u) }));
  json(res, 200, { ok: true, rows, perms: dbm.permissionMatrix(), roles: dbm.ROLES.map(r => ({ key: r, label: dbm.ROLE_LABEL[r] })) });
});
post('/api/users/save', async (req, res) => {
  const user = guard(req, res, 'pengguna', 'write'); if (!user) return;
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  const username = String(b.username || '').trim();
  const role = dbm.ROLES.includes(b.role) ? b.role : 'guru';
  /* MULTI-ROLE: role utama + role tambahan (mis. Guru + Wakasek Kurikulum).
     Role tambahan tidak boleh menggandakan role utama. */
  const extraRoles = [...new Set((Array.isArray(b.roles) ? b.roles : String(b.roles || '').split(','))
    .map(x => String(x || '').trim()).filter(x => dbm.ROLES.includes(x) && x !== role))];
  if (!nama || !username) return fail(res, 400, 'Nama dan username wajib diisi.');
  const dup = db.prepare('SELECT id FROM users WHERE lower(username)=lower(?) AND id<>?').get(username, Number(b.id) || 0);
  if (dup) return fail(res, 400, 'Username sudah digunakan pengguna lain.');
  const pass = String(b.password || '');
  const jabatan = String(b.jabatan || '').trim() || dbm.ROLE_LABEL[role];
  const rolesJson = extraRoles.length ? JSON.stringify(extraRoles) : '';
  const nip = String(b.nip || '').trim();
  const phone = b.phone ? lib.normPhone(b.phone) : '';
  if (b.id) {
    const cur = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b.id));
    if (!cur) return fail(res, 404, 'Pengguna tidak ditemukan.');
    if (cur.role === 'admin' && role !== 'admin' && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND aktif=1").get().c <= 1) {
      return fail(res, 400, 'Tidak dapat mengubah role Administrator terakhir.');
    }
    if (pass) {
      if (pass.length < 6) return fail(res, 400, 'Kata sandi minimal 6 karakter.');
      db.prepare('UPDATE users SET nama=?,jabatan=?,username=?,role=?,roles=?,nip=?,phone=?,aktif=?,pass_hash=? WHERE id=?')
        .run(nama, jabatan, username, role, rolesJson, nip, phone, b.aktif === 0 || b.aktif === '0' ? 0 : 1, lib.hashPassword(pass), Number(b.id));
    } else {
      db.prepare('UPDATE users SET nama=?,jabatan=?,username=?,role=?,roles=?,nip=?,phone=?,aktif=? WHERE id=?')
        .run(nama, jabatan, username, role, rolesJson, nip, phone, b.aktif === 0 || b.aktif === '0' ? 0 : 1, Number(b.id));
    }
    dbm.logAudit(user, 'UBAH', 'pengguna', `Memperbarui akun ${nama} (${[role, ...extraRoles].map(r => dbm.ROLE_LABEL[r]).join(' + ')})`, ipOf(req));
    return json(res, 200, { ok: true });
  }
  if (pass.length < 6) return fail(res, 400, 'Kata sandi minimal 6 karakter.');
  const r = db.prepare('INSERT INTO users(nama,jabatan,username,pass_hash,role,roles,nip,phone,aktif,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)')
    .run(nama, jabatan, username, lib.hashPassword(pass), role, rolesJson, nip, phone, dbm.now());
  dbm.logAudit(user, 'TAMBAH', 'pengguna', `Menambah akun ${nama} (${[role, ...extraRoles].map(r => dbm.ROLE_LABEL[r]).join(' + ')})`, ipOf(req));
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});
del('/api/users/:id', (req, res, q, params) => {
  const user = guard(req, res, 'pengguna', 'delete'); if (!user) return;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
  if (!u) return fail(res, 404, 'Pengguna tidak ditemukan.');
  if (u.id === user.id) return fail(res, 400, 'Anda tidak dapat menghapus akun sendiri.');
  if (u.role === 'admin' && db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND aktif=1").get().c <= 1) {
    return fail(res, 400, 'Minimal harus ada satu Administrator aktif.');
  }
  db.prepare('DELETE FROM users WHERE id=?').run(params.id);
  db.prepare('UPDATE kelas SET wali_id=NULL WHERE wali_id=?').run(params.id);
  dbm.logAudit(user, 'HAPUS', 'pengguna', `Menghapus akun ${u.nama}`, ipOf(req));
  json(res, 200, { ok: true });
});
get('/api/users-template.xlsx', (req, res) => {
  if (!guard(req, res, 'pengguna', 'view')) return;
  const rows = [
    [{ v: 'TEMPLATE IMPORT AKUN GURU / PEGAWAI', bold: true }],
    [{ v: 'Role yang dikenali: Administrator, Kepala Sekolah, Guru BK, Guru Kesiswaan, Wali Kelas, Guru Mata Pelajaran, Guru Umum, Tenaga Administrasi (TU).' }],
    [{ v: 'Kata sandi kosong = otomatis "sekolah123" (sampaikan ke pegawai agar segera diubah di menu Profil Akun).' }],
    [{ v: 'NO', bold: true }, { v: 'NAMA', bold: true }, { v: 'JABATAN', bold: true }, { v: 'USERNAME', bold: true },
    { v: 'ROLE', bold: true }, { v: 'NIP', bold: true }, { v: 'NO HP', bold: true }, { v: 'KATA SANDI', bold: true }],
    [1, 'Wawan Setiawan, S.Pd.', 'Guru Umum / Guru Piket', 'wawan', 'Guru Umum', '199401182019011006', '081234567890', ''],
    [2, 'Lina Herlina', 'Staf Tata Usaha', 'lina', 'Tenaga Administrasi (TU)', '199507212020012007', '081234567891', 'rahasia123']
  ];
  const buf = lib.xlsxBuffer('Akun Guru', rows, [5, 30, 26, 18, 28, 22, 18, 18]);
  sendFile(res, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'template-import-akun-guru.xlsx');
});
post('/api/users/import/preview', async (req, res) => {
  if (!guard(req, res, 'pengguna', 'write')) return;
  const b = await readBody(req);
  try {
    const buf = Buffer.from(String(b.base64 || ''), 'base64');
    if (!buf.length) return fail(res, 400, 'Berkas tidak terbaca.');
    const rows = importUsersPreview(buf, String(b.filename || 'import.xlsx'));
    json(res, 200, { ok: true, rows, total: rows.length, siap: rows.filter(r => !r.error && !r.skip).length });
  } catch (e) { fail(res, 400, e.message); }
});
post('/api/users/import/commit', async (req, res) => {
  const user = guard(req, res, 'pengguna', 'write'); if (!user) return;
  const b = await readBody(req);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  let n = 0;
  const ins = db.prepare('INSERT INTO users(nama,jabatan,username,pass_hash,role,roles,nip,phone,aktif,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)');
  db.transaction(() => {
    for (const r of rows) {
      if (r.error || r.skip || !r.username) continue;
      const pass = r.password && r.password.length >= 6 ? r.password : 'sekolah123';
      const primary = dbm.ROLES.includes(r.role) ? r.role : 'guru';
      const extra = (Array.isArray(r.roles) ? r.roles : []).filter(x => dbm.ROLES.includes(x) && x !== primary);
      ins.run(String(r.nama).trim(), r.jabatan || dbm.ROLE_LABEL[primary] || '', String(r.username).toLowerCase(),
        lib.hashPassword(pass), primary, extra.length ? JSON.stringify(extra) : '', r.nip || '', r.phone || '', dbm.now());
      n++;
    }
  })();
  dbm.logAudit(user, 'IMPORT', 'pengguna', `Import akun guru/pegawai: ${n} akun masuk`, ipOf(req));
  json(res, 200, { ok: true, masuk: n });
});
post('/api/users/bulk-delete', async (req, res) => {
  const user = guard(req, res, 'pengguna', 'delete'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(',')).map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu akun terlebih dahulu.');
  if (ids.includes(user.id)) return fail(res, 400, 'Akun yang sedang Anda gunakan tidak dapat dihapus.');
  const list = db.prepare(`SELECT id,nama,role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const adminAktif = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND aktif=1").get().c;
  const adminDihapus = list.filter(u => u.role === 'admin').length;
  if (adminDihapus && adminAktif - adminDihapus < 1) return fail(res, 400, 'Minimal harus ada satu Administrator aktif.');
  db.transaction(() => {
    for (const u of list) {
      db.prepare('UPDATE kelas SET wali_id=NULL WHERE wali_id=?').run(u.id);
      db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    }
  })();
  dbm.logAudit(user, 'HAPUS', 'pengguna', `Hapus masal ${list.length} akun: ${list.map(u => u.nama).join(', ').slice(0, 180)}`, ipOf(req));
  json(res, 200, { ok: true, jumlah: list.length, pesan: `${list.length} akun dihapus.` });
});

/* ---------- profil akun sendiri ---------- */
post('/api/profile/save', async (req, res) => {
  const sesi = sessionFrom(req);
  if (!sesi) return fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.');
  const me = sesi.user;
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  const username = String(b.username || '').trim();
  if (!nama) return fail(res, 400, 'Nama lengkap wajib diisi.');
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return fail(res, 400, 'Username 3–32 karakter (huruf, angka, titik, garis bawah, strip).');
  const dup = db.prepare('SELECT id FROM users WHERE lower(username)=lower(?) AND id<>?').get(username, me.id);
  if (dup) return fail(res, 400, 'Username sudah digunakan pengguna lain.');
  const phone = b.phone ? lib.normPhone(b.phone) : (me.phone || '');
  if (b.phone && !phone) return fail(res, 400, 'Nomor HP tidak valid.');
  const foto = b.foto === undefined ? (me.foto || '') : String(b.foto || '').trim();
  const passBaru = String(b.password || '');
  const passLama = String(b.password_lama || '');
  if (passBaru) {
    if (!lib.verifyPassword(passLama, me.pass_hash)) return fail(res, 400, 'Kata sandi saat ini tidak sesuai.');
    if (passBaru.length < 6) return fail(res, 400, 'Kata sandi baru minimal 6 karakter.');
    if (passBaru !== String(b.password_ulang || passBaru)) return fail(res, 400, 'Konfirmasi kata sandi baru tidak sama.');
    db.prepare('UPDATE users SET nama=?,username=?,phone=?,foto=?,pass_hash=? WHERE id=?')
      .run(nama, username, phone, foto, lib.hashPassword(passBaru), me.id);
  } else {
    db.prepare('UPDATE users SET nama=?,username=?,phone=?,foto=? WHERE id=?')
      .run(nama, username, phone, foto, me.id);
  }
  dbm.logAudit(me, 'UBAH', 'profil', `Memperbarui profil sendiri${passBaru ? ' (kata sandi diubah)' : ''}`, ipOf(req));
  const fresh = dbm.userById(me.id);
  json(res, 200, {
    ok: true,
    user: {
      id: fresh.id, nama: fresh.nama, username: fresh.username, role: fresh.role,
      role_label: dbm.ROLE_LABEL[fresh.role] || fresh.role, jabatan: fresh.jabatan,
      nip: fresh.nip, phone: fresh.phone || '', foto: fresh.foto || ''
    }
  });
});

post('/api/permissions', async (req, res) => {
  const user = guard(req, res, 'pengguna', 'write'); if (!user) return;
  const b = await readBody(req);
  const role = String(b.role || '');
  if (!dbm.ROLES.includes(role) || role === 'admin') return fail(res, 400, 'Role tidak dapat diubah.');
  const perms = b.perms || {};
  db.transaction(() => {
    for (const f of dbm.FEATURES) {
      for (const a of dbm.ACTIONS) {
        const v = perms[f.key] && perms[f.key][a] ? 1 : 0;
        dbm.setPermission(role, f.key, a, v);
      }
    }
  })();
  dbm.logAudit(user, 'UBAH', 'pengguna', `Mengubah matriks hak akses role ${dbm.ROLE_LABEL[role]}`, ipOf(req));
  json(res, 200, { ok: true, perms: dbm.permissionMatrix()[role] });
});

/* ---------- laporan ---------- */
function rekapRows(q, user) {
  const f = filters(q);
  const rows = dbm.siswaRows({
    taId: f.taId, semester: f.semester, user: user || null,
    kelasId: numOr(q.kelas), q: (q.q || '').trim(), statusKey: q.status || 'all'
  });
  const summary = dbm.kejadianSummary({ taId: f.taId, semester: f.semester });
  const bySiswa = new Map();
  for (const s of summary) {
    const o = bySiswa.get(s.siswa_id) || { pel: [], pres: [] };
    const parts = String(s.kat || '').split(',').filter(Boolean);
    (s.jenis === 'prestasi' ? o.pres : o.pel).push(...parts);
    bySiswa.set(s.siswa_id, o);
  }
  return {
    filters: f,
    rows: rows.map((s, i) => {
      const d = bySiswa.get(s.id) || { pel: [], pres: [] };
      const uniq = a => [...new Set(a)];
      const ket = [
        d.pel.length ? 'Pelanggaran: ' + uniq(d.pel).join(', ') : '',
        d.pres.length ? 'Prestasi: ' + uniq(d.pres).join(', ') : ''
      ].filter(Boolean).join(' | ') || 'Tidak ada catatan';
      return { ...s, no: i + 1, keterangan: ket };
    })
  };
}
get('/api/laporan/rekap', (req, res, q) => {
  const user = guard(req, res, 'laporan', 'view'); if (!user) return;
  const r = rekapRows(q, user);
  json(res, 200, { ok: true, ...r, rules: dbm.statusRules() });
});
get('/api/surat/:id', (req, res, q, params) => {
  const user = guard(req, res, 'laporan', 'view'); if (!user) return;
  const jenis = ['panggilan', 'sp1', 'sp2', 'sp3'].includes(q.jenis) ? q.jenis : 'panggilan';
  const siswa = dbm.siswaById(params.id);
  if (!siswa) return fail(res, 404, 'Siswa tidak ditemukan.');
  const riwayat = db.prepare(`SELECT e.*, kat.nama AS kategori_nama FROM kejadian e
    LEFT JOIN kategori kat ON kat.id=e.kategori_id WHERE e.siswa_id=? AND e.jenis='pelanggaran'
    ORDER BY e.tanggal DESC, e.id DESC`).all(params.id);
  const settings = dbm.allSettings();
  const nomor = dbm.nextNomor(jenis);
  const html = doc.suratHTML({ settings, siswa, riwayat, jenis, nomor, paper: q.paper || settings.print_paper, rules: dbm.statusRules() });
  // catat surat
  db.prepare('INSERT INTO surat_log(siswa_id,nama,jenis,nomor,poin,oleh,oleh_nama,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(siswa.id, siswa.nama, jenis, nomor, siswa.pel, user.id, user.nama, dbm.now());
  dbm.logAudit(user, 'CETAK', 'laporan', `Surat ${jenis} untuk ${siswa.nama} (${nomor})`, ipOf(req));
  sendHtml(res, html);
});
get('/api/rekap/print', (req, res, q) => {
  const user = guard(req, res, 'laporan', 'view'); if (!user) return;
  const r = rekapRows(q, user);
  const settings = dbm.allSettings();
  const kelas = q.kelas ? db.prepare(`SELECT k.*, u.nama AS wali_nama, u.nip AS wali_nip FROM kelas k
    LEFT JOIN users u ON u.id=k.wali_id WHERE k.id=?`).get(numOr(q.kelas)) : null;
  const html = doc.rekapHTML({
    settings, rows: r.rows, kelas, filters: r.filters,
    ta: (dbm.tahunList().find(t => t.id === r.filters.taId) || {}), semester: r.filters.semester,
    paper: q.paper || settings.print_paper, user
  });
  dbm.logAudit(user, 'CETAK', 'laporan', `Cetak rekapitulasi poin (${r.rows.length} siswa)`, ipOf(req));
  sendHtml(res, html);
});
get('/api/export/rekap.xlsx', (req, res, q) => {
  const user = guard(req, res, 'laporan', 'view'); if (!user) return;
  const r = rekapRows(q, user);
  const settings = dbm.allSettings();
  const ta = (dbm.tahunList().find(t => t.id === r.filters.taId) || {}).nama || '';
  const head = ['NO', 'NISN', 'NAMA MURID', 'KELAS', 'PEL', 'PRES', 'TOTAL', 'STATUS', 'KETERANGAN'];
  const rows = [
    [{ v: settings.sekolah_nama, bold: true }],
    [{ v: 'REKAPITULASI POIN KEDISIPLINAN SISWA' }],
    [{ v: `Tahun Pelajaran ${ta} — ${r.filters.semester === 'genap' ? 'Semester Genap' : 'Semester Ganjil'}` }],
    [],
    head.map(h => ({ v: h, bold: true }))
  ];
  for (const s of r.rows) {
    rows.push([s.no, s.nisn || '-', s.nama, s.kelas_nama || '-', s.pel, s.pres, s.bersih, s.status.label, s.keterangan]);
  }
  rows.push([]);
  rows.push([{ v: `Dicetak: ${lib.stampID(dbm.now())} oleh ${user.nama}` }]);
  const buf = lib.xlsxBuffer('Rekap Poin', rows, [6, 14, 28, 14, 8, 8, 8, 14, 60]);
  dbm.logAudit(user, 'EXPORT', 'laporan', `Ekspor Excel rekap poin (${r.rows.length} siswa)`, ipOf(req));
  sendFile(res, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `rekap-poin-${(ta || '').replace(/\//g, '-')}.xlsx`);
});
get('/api/export/rekap.doc', (req, res, q) => {
  const user = guard(req, res, 'laporan', 'view'); if (!user) return;
  const r = rekapRows(q, user);
  const settings = dbm.allSettings();
  const ta = (dbm.tahunList().find(t => t.id === r.filters.taId) || {}).nama || '';
  const html = doc.rekapWord({ settings, rows: r.rows, ta, semester: r.filters.semester, user });
  dbm.logAudit(user, 'EXPORT', 'laporan', `Ekspor Word rekap poin (${r.rows.length} siswa)`, ipOf(req));
  sendFile(res, Buffer.from(html, 'utf8'), 'application/msword', `rekap-poin-${(ta || '').replace(/\//g, '-')}.doc`);
});

/* ---------- deteksi dini & audit ---------- */
get('/api/audit', (req, res, q) => {
  if (!guard(req, res, 'audit', 'view')) return;
  const limit = Math.min(500, Number(q.limit) || 200);
  const where = [];
  const params = [];
  if (q.q) { where.push('(lower(nama) LIKE ? OR lower(aksi) LIKE ? OR lower(modul) LIKE ? OR lower(detail) LIKE ?)'); const l = '%' + q.q.toLowerCase() + '%'; params.push(l, l, l, l); }
  if (q.modul) { where.push('modul=?'); params.push(q.modul); }
  const rows = db.prepare(`SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  const modul = db.prepare('SELECT DISTINCT modul FROM audit ORDER BY modul').all().map(r => r.modul);
  json(res, 200, { ok: true, rows, modul });
});

/* ---------- pengaturan ---------- */
const SETTING_KEYS = [
  'sekolah_nama', 'sekolah_npsn', 'sekolah_bentuk', 'sekolah_status', 'sekolah_telp', 'sekolah_email',
  'sekolah_website', 'sekolah_alamat', 'kepala_nama', 'kepala_nip', 'bendahara_nama', 'bendahara_nip',
  'wakasek_nama', 'wakasek_nip', 'wakasek_jabatan',
  'logo', 'app_nama', 'app_logo', 'primary_color', 'gradient_bg', 'print_paper', 'print_tempat',
  'portal_aktif', 'portal_judul', 'portal_subtitle', 'wa_template',
  // unggahan & penyimpanan
  'upload_max_kb', 'upload_jpeg_quality', 'upload_max_side', 'storage_quota_mb',
  // kop surat dinamis
  'kop_sumber', 'kop_logo', 'kop_posisi', 'kop_rapat', 'kop_baris', 'kop_baris_tambahan',
  'kop_font', 'kop_font_besar', 'kop_tinggi_logo', 'kop_logo_w', 'kop_logo_h', 'kop_format', 'kop_garis',
  // sesi login
  'session_days'
];
/** website: isian tanpa "https://" → selalu disimpan lengkap dengan protokol */
const URL_BARE_RE = /^(?=.{3,190}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s]*)?$/i;
const isWebsite = v => {
  const t = String(v || '').trim();
  if (!t) return true;
  return URL_BARE_RE.test(t.replace(/^https?:\/\//i, ''));
};
const normWebsite = v => {
  const t = String(v || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t.replace(/\s+/g, '');
  return 'https://' + t.replace(/^\/+/, '').replace(/\s+/g, '');
};
/* ---------- slug khusus portal publik sekolah (diatur admin sekolah) ---------- */
get('/api/portal-slug', (req, res) => {
  const user = guard(req, res, 'pengaturan', 'view'); if (!user) return;
  const c = contextOf(req);
  const t = c.tenant;
  if (!t) return fail(res, 404, 'Data sekolah tidak ditemukan.');
  json(res, 200, {
    ok: true,
    slug: saas.portalSlugOf(t),
    path: saas.portalPathOf(t),
    url: saas.portalPathOf(t) ? appBaseUrl(req) + saas.portalPathOf(t) : '',
    portal_aktif: Number(t.portal_aktif) !== 0
  });
});
post('/api/portal-slug', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const c = contextOf(req);
  const t = c.tenant;
  if (!t) return fail(res, 404, 'Data sekolah tidak ditemukan.');
  const b = await readBody(req);
  const lama = saas.portalPathOf(t);
  try {
    const next = saas.setPortalSlug(t.id, b.slug, user.nama);
    const path = next.portal_path;
    dbm.logAudit(user, 'UBAH', 'pengaturan',
      `Slug portal publik: ${lama || '-'} → ${path}`, ipOf(req));
    json(res, 200, {
      ok: true, slug: next.portal_slug, path,
      url: appBaseUrl(req) + path,
      lama, pesan: `Slug portal disimpan: ${path}`
    });
  } catch (e) { fail(res, 400, e.message); }
});

/* ---------- NAVIGASI BAWAH (BOTTOM NAV) PER ROLE — hanya Administrator ----------
   Administrator mengatur tombol navigasi bawah (tampilan ponsel) untuk setiap
   role: urutan & visibilitasnya. Menu utama (sidebar) tetap mengikuti matriks
   hak akses; di sini hanya pintasan bawah yang diatur. */
get('/api/nav-mobile', (req, res) => {
  const user = guard(req, res, 'nav_mobile', 'view'); if (!user) return;
  const cfg = dbm.bottomNavConfig();
  json(res, 200, {
    ok: true,
    roles: dbm.ROLES.map(r => ({ key: r, label: dbm.ROLE_LABEL[r] })),
    features: dbm.FEATURES.map(f => ({ key: f.key, label: f.label, grup: f.grup })),
    nav: dbm.navConfig().map(n => ({ key: n.key, label: n.label, icon: n.icon, hidden: n.hidden })),
    config: cfg,
    defaults: dbm.BOTTOM_NAV_DEFAULT,
    max: dbm.BOTTOM_NAV_MAX
  });
});
post('/api/nav-mobile', async (req, res) => {
  const user = guard(req, res, 'nav_mobile', 'write'); if (!user) return;
  const b = await readBody(req);
  const role = String(b.role || '');
  if (!dbm.ROLES.includes(role)) return fail(res, 400, 'Role tidak dikenal.');
  const keys = (Array.isArray(b.keys) ? b.keys : String(b.keys || '').split(','))
    .map(k => String(k || '').trim()).filter(Boolean);
  const takDikenal = keys.filter(k => !dbm.FEATURES.some(f => f.key === k));
  if (takDikenal.length) return fail(res, 400, `Menu tidak dikenal: ${takDikenal.join(', ')}.`);
  if (keys.length > dbm.BOTTOM_NAV_MAX) return fail(res, 400, `Maksimal ${dbm.BOTTOM_NAV_MAX} tombol navigasi bawah.`);
  if (!keys.length) return fail(res, 400, 'Pilih minimal satu menu untuk navigasi bawah.');
  dbm.setBottomNav(role, keys);
  dbm.logAudit(user, 'UBAH', 'nav_mobile',
    `Navigasi bawah role ${dbm.ROLE_LABEL[role]}: ${keys.join(' → ')}`, ipOf(req));
  json(res, 200, { ok: true, pesan: `Navigasi bawah role ${dbm.ROLE_LABEL[role]} disimpan.`, config: dbm.bottomNavConfig() });
});
post('/api/nav-mobile/reset', async (req, res) => {
  const user = guard(req, res, 'nav_mobile', 'write'); if (!user) return;
  const b = await readBody(req);
  const role = String(b.role || '');
  if (!dbm.ROLES.includes(role)) return fail(res, 400, 'Role tidak dikenal.');
  dbm.setBottomNav(role, dbm.BOTTOM_NAV_DEFAULT[role] || []);
  dbm.logAudit(user, 'UBAH', 'nav_mobile', `Navigasi bawah role ${dbm.ROLE_LABEL[role]} dikembalikan ke bawaan`, ipOf(req));
  json(res, 200, { ok: true, pesan: `Navigasi bawah role ${dbm.ROLE_LABEL[role]} dikembalikan ke susunan bawaan.`, config: dbm.bottomNavConfig() });
});

get('/api/settings', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  json(res, 200, {
    ok: true, settings: dbm.allSettings(), nav: dbm.navConfig(), form: dbm.formConfig(),
    rules: dbm.statusRules(), dini: dbm.diniConfig(), storage: dbm.storageInfo()
  });
});
post('/api/settings/save', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const bag = b.data || {};
  if (bag.sekolah_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(bag.sekolah_email))) return fail(res, 400, 'Format email sekolah tidak valid.');
  if (bag.sekolah_npsn && !/^\d{8}$/.test(String(bag.sekolah_npsn).trim())) return fail(res, 400, 'NPSN harus terdiri dari 8 digit angka.');
  if (bag.sekolah_website && !isWebsite(bag.sekolah_website)) {
    return fail(res, 400, 'Format website tidak valid — tulis tanpa https:// (contoh: www.sekolah.sch.id).');
  }
  if (bag.primary_color && !/^#[0-9a-fA-F]{6}$/.test(String(bag.primary_color))) return fail(res, 400, 'Warna primer harus format heksadesimal (#ea580c).');
  /* ---- VALIDASI DULU, BARU SIMPAN -------------------------------------
     Dulu nilai kop/unggahan ditulis sebelum divalidasi sehingga permintaan
     yang ditolak (mis. posisi kop "diagonal") tetap meninggalkan data
     setengah tersimpan. Sekarang kunci tersebut divalidasi lebih dulu. */
  const KOP_KEYS = ['kop_sumber', 'kop_logo', 'kop_posisi', 'kop_rapat', 'kop_baris', 'kop_baris_tambahan',
    'kop_font', 'kop_font_besar', 'kop_tinggi_logo', 'kop_logo_w', 'kop_logo_h', 'kop_format', 'kop_garis'];
  const UPLOAD_KEYS = ['upload_max_kb', 'upload_jpeg_quality', 'upload_max_side', 'storage_quota_mb', 'session_days'];
  for (const k of SETTING_KEYS) {
    if (bag[k] === undefined) continue;
    if (KOP_KEYS.includes(k) || UPLOAD_KEYS.includes(k) || k === 'sekolah_website') continue;
    dbm.setSetting(k, bag[k]);
  }
  if (bag.sekolah_website !== undefined) dbm.setSetting('sekolah_website', normWebsite(bag.sekolah_website));
  /* jenjang pendidikan WAJIB sinkron dengan bentuk sekolah yang diubah di sini,
     agar daftar tingkat kelas tidak memakai jenjang lama. */
  if (bag.sekolah_bentuk !== undefined && dbm.JENJANG.includes(String(bag.sekolah_bentuk).toUpperCase())) {
    dbm.setSetting('jenjang_pendidikan', String(bag.sekolah_bentuk).toUpperCase());
  }
  /* penanda: nama aplikasi diganti sendiri oleh sekolah. Nama yang sama dengan branding
     global TIDAK dianggap kustom, sehingga perubahan nama dari Super Admin tetap mengalir. */
  if (bag.app_nama !== undefined) {
    const nama = String(bag.app_nama).trim();
    const global = saas.branding().app_nama;
    dbm.setSetting('app_nama_custom', nama && nama !== global ? '1' : '');
  }
  /* ---- unggahan: batas ukuran 64 KB–25 MB, kualitas kompresi 0.4–0.95 ---- */
  if (bag.upload_max_kb !== undefined) {
    const kb = Math.round(Number(String(bag.upload_max_kb).replace(',', '.')) || 0);
    if (!Number.isFinite(kb) || kb < 64 || kb > 25600) return fail(res, 400, 'Batas unggah harus antara 64 KB dan 25.600 KB (25 MB).');
    dbm.setSetting('upload_max_kb', String(kb));
  }
  if (bag.upload_jpeg_quality !== undefined) {
    let q = Number(String(bag.upload_jpeg_quality).replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) q = 0.82;
    if (q > 1) q = q / 100;                            // boleh diisi 82 (persen)
    q = Math.max(0.4, Math.min(0.95, q));
    dbm.setSetting('upload_jpeg_quality', String(Math.round(q * 100) / 100));
  }
  if (bag.upload_max_side !== undefined) {
    const side = Math.round(Number(bag.upload_max_side) || 0);
    dbm.setSetting('upload_max_side', String(Math.max(320, Math.min(4000, side || 1600))));
  }
  if (bag.storage_quota_mb !== undefined) {
    const mb = Math.round(Number(bag.storage_quota_mb) || 0);
    if (!Number.isFinite(mb) || mb < 50 || mb > 102400) return fail(res, 400, 'Kuota penyimpanan harus antara 50 MB dan 102.400 MB.');
    dbm.setSetting('storage_quota_mb', String(mb));
  }
  if (bag.session_days !== undefined) {
    const d = Math.round(Number(bag.session_days) || 0);
    dbm.setSetting('session_days', String(Math.max(1, Math.min(365, d || 90))));
  }
  /* ---- kop surat dinamis ---- */
  if (bag.kop_sumber !== undefined && !['auto', 'manual'].includes(String(bag.kop_sumber))) {
    return fail(res, 400, 'Sumber data kop harus "auto" atau "manual".');
  }
  if (bag.kop_posisi !== undefined && !['kiri', 'tengah', 'kanan'].includes(String(bag.kop_posisi))) {
    return fail(res, 400, 'Posisi logo kop tidak dikenal.');
  }
  if (bag.kop_rapat !== undefined && !['kiri', 'tengah', 'kanan'].includes(String(bag.kop_rapat))) {
    return fail(res, 400, 'Perataan teks kop tidak dikenal.');
  }
  if (bag.kop_garis !== undefined && !['single', 'double', 'none'].includes(String(bag.kop_garis))) {
    return fail(res, 400, 'Gaya garis kop tidak dikenal.');
  }
  for (const k of ['kop_font', 'kop_font_besar', 'kop_tinggi_logo']) {
    if (bag[k] === undefined) continue;
    const v = Number(String(bag[k]).replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return fail(res, 400, 'Ukuran font/logo kop tidak valid.');
    dbm.setSetting(k, String(v));
  }
  /* lebar & tinggi logo kop (px) — 16 s.d. 400 px; kosong = ikut tinggi logo */
  for (const k of ['kop_logo_w', 'kop_logo_h']) {
    if (bag[k] === undefined) continue;
    const raw = String(bag[k] === null ? '' : bag[k]).trim();
    if (!raw) { dbm.setSetting(k, ''); continue; }
    const v = Math.round(Number(raw.replace(',', '.')));
    if (!Number.isFinite(v) || v < 16 || v > 400) {
      return fail(res, 400, 'Ukuran logo kop harus antara 16 dan 400 piksel.');
    }
    dbm.setSetting(k, String(v));
  }
  if (bag.kop_format !== undefined) {
    let fmt = bag.kop_format;
    if (typeof fmt === 'string') {
      try { fmt = JSON.parse(fmt); } catch (e) { fmt = []; }
    }
    if (!Array.isArray(fmt)) return fail(res, 400, 'Pengaturan font per baris kop tidak valid.');
    const clean = fmt.slice(0, 12).map(f => ({
      size: Number(f && f.size) > 0 ? Math.min(36, Math.max(6, Number(f.size))) : null,
      bold: !!(f && (f.bold === true || Number(f.bold) === 1))
    }));
    dbm.setSetting('kop_format', JSON.stringify(clean));
  }
  /* setelah SEMUA validasi kop lolos, barulah nilai teks kop disimpan */
  for (const k of ['kop_sumber', 'kop_logo', 'kop_posisi', 'kop_rapat', 'kop_baris', 'kop_baris_tambahan', 'kop_garis']) {
    if (bag[k] !== undefined) dbm.setSetting(k, String(bag[k] === null ? '' : bag[k]));
  }
  if (bag.status_rules) {
    try {
      const parsed = JSON.parse(bag.status_rules);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('x');
      dbm.setSetting('status_rules', JSON.stringify(parsed.map((r, i) => ({
        key: r.key || 'lvl' + i, label: String(r.label || 'Status'), min: Number(r.min) || 0,
        max: r.max === null || r.max === '' || r.max === undefined ? null : Number(r.max)
      }))));
    } catch (e) { return fail(res, 400, 'Ambang status poin tidak valid.'); }
  }
  if (bag.dini_config) {
    const d = typeof bag.dini_config === 'string' ? JSON.parse(bag.dini_config) : bag.dini_config;
    dbm.setSetting('dini_config', JSON.stringify({
      hari: Math.max(1, Number(d.hari) || 14), siaga: Math.max(1, Number(d.siaga) || 20),
      waspada: Math.max(2, Number(d.waspada) || 40), aktif: d.aktif ? 1 : 0
    }));
  }
  if (bag.form_config) {
    const fc = typeof bag.form_config === 'string' ? JSON.parse(bag.form_config) : bag.form_config;
    dbm.setSetting('form_config', JSON.stringify(fc));
  }
  if (bag.lokasi_list !== undefined) {
    let list = bag.lokasi_list;
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (e) { list = String(list).split('\n'); }
    }
    if (!Array.isArray(list)) return fail(res, 400, 'Daftar lokasi tidak valid.');
    const clean = list.map(x => String(x || '').trim()).filter(Boolean).slice(0, 40);
    if (!clean.length) return fail(res, 400, 'Minimal satu lokasi harus diisi.');
    dbm.setSetting('lokasi_list', JSON.stringify([...new Set(clean)]));
  }
  if (bag.sanksi_rules !== undefined) {
    let rules = bag.sanksi_rules;
    if (typeof rules === 'string') {
      try { rules = JSON.parse(rules); } catch (e) { return fail(res, 400, 'Aturan sanksi tidak valid.'); }
    }
    if (!Array.isArray(rules)) return fail(res, 400, 'Aturan sanksi tidak valid.');
    const clean = rules.map((r, i) => ({
      id: String(r.id || 's' + i),
      min: Math.max(0, Number(r.min) || 0),
      label: String(r.label || '').trim() || `Sanksi ${i + 1}`,
      surat: ['sp1', 'sp2', 'sp3', 'panggilan'].includes(r.surat) ? r.surat : '',
      catatan: String(r.catatan || '').trim()
    })).sort((a, b) => a.min - b.min);
    if (!clean.length) return fail(res, 400, 'Minimal satu aturan sanksi harus ada.');
    dbm.setSetting('sanksi_rules', JSON.stringify(clean));
  }
  if (bag.jurnal_config) {
    const jc = typeof bag.jurnal_config === 'string' ? JSON.parse(bag.jurnal_config) : bag.jurnal_config;
    dbm.setSetting('jurnal_config', JSON.stringify({
      tampil_dashboard: jc.tampil_dashboard ? 1 : 0,
      wajib_lokasi: jc.wajib_lokasi ? 1 : 0,
      wajib_keterangan: jc.wajib_keterangan ? 1 : 0,
      auto_poin: jc.auto_poin ? 1 : 0
    }));
  }
  dbm.logAudit(user, 'UBAH', 'pengaturan', 'Memperbarui pengaturan aplikasi / identitas sekolah', ipOf(req));
  json(res, 200, {
    ok: true,
    storage: dbm.storageInfo(),
    settings: {
      ...dbm.allSettings(),
      status_rules: dbm.statusRules(), dini: dbm.diniConfig(), form_config: dbm.formConfig(),
      nav: dbm.navConfig(), lokasi: dbm.lokasiList(), sanksi_rules: dbm.sanksiRules(),
      jurnal_config: dbm.jurnalConfig()
    }
  });
});
post('/api/settings/nav', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const nav = b.nav || {};
  const clean = {};
  for (const n of dbm.DEFAULT_NAV) {
    const v = nav[n.key] || {};
    clean[n.key] = {
      label: String(v.label || n.label).slice(0, 40),
      hidden: !!v.hidden,
      order: Number.isFinite(Number(v.order)) ? Number(v.order) : 0
    };
  }
  dbm.setSetting('nav_ui', JSON.stringify(clean));
  dbm.logAudit(user, 'UBAH', 'pengaturan', 'Mengubah tampilan & urutan menu', ipOf(req));
  json(res, 200, { ok: true, nav: dbm.navConfig() });
});
post('/api/settings/tahun', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  if (b.ta) dbm.setSetting('ta_aktif', Number(b.ta));
  json(res, 200, { ok: true });
});

/* ---------- tahun ajaran ---------- */
get('/api/tahun', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  json(res, 200, { ok: true, rows: dbm.tahunList(), tingkat: dbm.tingkatConfig() });
});
/** dampak penghapusan satu tahun pelajaran (dipakai dialog konfirmasi) */
get('/api/tahun/:id/dampak', (req, res, q, params) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  const ta = db.prepare('SELECT * FROM tahun_ajaran WHERE id=?').get(Number(params.id));
  if (!ta) return fail(res, 404, 'Tahun pelajaran tidak ditemukan.');
  const dampak = dbm.tahunDampak(ta.id);
  json(res, 200, {
    ok: true, ta,
    dampak,
    total: Object.values(dampak).reduce((a, b) => a + b, 0),
    bisa_hapus: !ta.aktif && db.prepare('SELECT COUNT(*) c FROM tahun_ajaran').get().c > 1
  });
});
/** hapus tahun pelajaran (+ data terkait bila `paksa`) */
post('/api/tahun/delete', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const id = Number(b.id) || 0;
  const paksa = b.paksa === true || b.paksa === 1 || b.paksa === '1' || b.paksa === 'on';
  if (!id) return fail(res, 400, 'Tahun pelajaran tidak dipilih.');
  try {
    const r = dbm.tahunDelete(id, user, { paksa });
    json(res, 200, {
      ok: true, rows: dbm.tahunList(), ...r,
      pesan: `Tahun pelajaran ${r.nama} dihapus` + (r.totalData ? ` beserta ${r.hapus} baris data terkait` : '') + '.'
    });
  } catch (e) {
    fail(res, e.status || 400, e.message, { dampak: e.dampak || null });
  }
});

/* ---------- jenjang pendidikan & format tingkat kelas ---------- */
get('/api/tingkat', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  const cfg = dbm.tingkatConfig();
  const kelas = dbm.kelasAll();
  const perTingkat = {};
  for (const k of kelas) perTingkat[k.tingkat] = (perTingkat[k.tingkat] || 0) + 1;
  json(res, 200, {
    ok: true,
    config: cfg,
    jenjang: dbm.JENJANG.map(j => ({ key: j, label: dbm.JENJANG_LABEL[j] })),
    modes: dbm.TINGKAT_MODE,
    /* daftar tingkat bawaan setiap jenjang — dipakai pratinjau langsung di klien */
    per_jenjang: dbm.TINGKAT_PER_JENJANG,
    per_tingkat: perTingkat,
    jumlah_kelas: kelas.length
  });
});
/**
 * Simpan jenjang + format tingkat. Bila `terapkan` bernilai true, seluruh kelas
 * yang ada di-remap berdasarkan URUTAN tingkat (hierarki kenaikan kelas tetap).
 */
post('/api/tingkat', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const sebelum = dbm.tingkatConfig();
  const jenjang = dbm.JENJANG.includes(String(b.jenjang || '').toUpperCase())
    ? String(b.jenjang).toUpperCase() : sebelum.jenjang;
  const mode = ['jenjang', 'romawi', 'angka', 'kelas', 'custom'].includes(String(b.mode || ''))
    ? String(b.mode) : 'jenjang';
  const kustom = dbm.parseTingkatList(b.custom !== undefined ? b.custom : b.tingkat_custom);
  if (mode === 'custom' && kustom.length < 1) {
    return fail(res, 400, 'Mode kustom membutuhkan minimal satu nama tingkat.');
  }
  if (mode === 'custom' && kustom.some(x => x.length > 30)) {
    return fail(res, 400, 'Nama tingkat maksimal 30 karakter.');
  }
  dbm.setSetting('jenjang_pendidikan', jenjang);
  /* sekolah_bentuk ikut disesuaikan agar kop & identitas konsisten */
  dbm.setSetting('sekolah_bentuk', jenjang);
  dbm.setSetting('tingkat_mode', mode);
  dbm.setSetting('tingkat_custom', kustom.length ? JSON.stringify(kustom) : '');
  const sesudah = dbm.tingkatConfig();
  let hasil = { diubah: 0, dilewati: 0, detail: [] };
  if (b.terapkan) {
    hasil = dbm.terapkanTingkatKelas({ dariList: sebelum.list, keList: sesudah.list, user });
  }
  dbm.logAudit(user, 'UBAH', 'pengaturan',
    `Jenjang ${jenjang} · format tingkat ${mode} (${sesudah.list.join(' → ')})` +
    (b.terapkan ? ` · ${hasil.diubah} kelas disesuaikan` : ''));
  json(res, 200, { ok: true, config: sesudah, hasil });
});
/** Terapkan format tingkat aktif ke kelas (pemetaan berdasarkan urutan). */
post('/api/tingkat/terapkan', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const cfg = dbm.tingkatConfig();
  /* daftar tingkat lama = nilai distinct pada tabel kelas, urut menurut `urut` */
  const lama = dbm.db.prepare(`SELECT tingkat, MIN(urut) u FROM kelas
    WHERE COALESCE(tingkat,'')<>'' GROUP BY tingkat ORDER BY u, tingkat`).all().map(r => r.tingkat);
  if (!lama.length) return json(res, 200, { ok: true, hasil: { diubah: 0, dilewati: 0, detail: [] } });
  const hasil = dbm.terapkanTingkatKelas({ dariList: lama, keList: cfg.list, user });
  json(res, 200, { ok: true, hasil, config: cfg });
});

/**
 * Preview & eksekusi kenaikan kelas.
 * Saat tahun pelajaran baru dibuat dengan centang "Salin Periodik",
 * proses ini dijalankan otomatis (lihat POST /api/tahun/save).
 */
get('/api/tahun/kenaikan/preview', (req, res, q) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  const dari = numOr(q.dari) || (dbm.tahunAktif() || {}).id;
  const ke = numOr(q.ke) || null;
  try { json(res, 200, { ok: true, preview: dbm.kenaikanPreview(dari, ke) }); }
  catch (e) { fail(res, 400, e.message); }
});
post('/api/tahun/kenaikan', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  try {
    const hasil = dbm.kenaikanKelas(numOr(b.dari), numOr(b.ke), user);
    json(res, 200, { ok: true, hasil, rows: dbm.tahunList() });
  } catch (e) { fail(res, 400, e.message); }
});

post('/api/tahun/save', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const nama = String(b.nama || '').trim();
  if (!nama) return fail(res, 400, 'Nama tahun pelajaran wajib diisi.');
  const salin = b.salin_periodik === true || b.salin_periodik === 1 || b.salin_periodik === '1' || b.salin_periodik === 'on';
  const tanggalMulai = String(b.tanggal_mulai || '').slice(0, 10);
  const tanggalSelesai = String(b.tanggal_selesai || '').slice(0, 10);
  /* validasi dulu, simpan kemudian — rentang tanggal menentukan pemetaan
     tanggal kejadian/tahun pelajaran di seluruh aplikasi */
  if (tanggalMulai && tanggalSelesai && tanggalMulai >= tanggalSelesai) {
    return fail(res, 400, 'Tanggal selesai harus setelah tanggal mulai tahun pelajaran.');
  }
  if ((tanggalMulai && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai)) || (tanggalSelesai && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalSelesai))) {
    return fail(res, 400, 'Format tanggal harus YYYY-MM-DD.');
  }
  /* rentang tahun pelajaran tidak boleh tumpang tindih dengan tahun pelajaran lain */
  if (tanggalMulai && tanggalSelesai) {
    const bentrok = db.prepare(`SELECT nama FROM tahun_ajaran
      WHERE id<>? AND COALESCE(tanggal_mulai,'')<>'' AND COALESCE(tanggal_selesai,'')<>''
        AND NOT (tanggal_selesai < ? OR tanggal_mulai > ?) LIMIT 1`).get(Number(b.id) || 0, tanggalMulai, tanggalSelesai);
    if (bentrok) return fail(res, 400, `Rentang tanggal bertumpang tindih dengan tahun pelajaran ${bentrok.nama}. Periksa kembali tanggal mulai & selesai.`);
  }
  let kenaikan = null;
  let taId = Number(b.id) || 0;
  if (b.id) {
    db.prepare('UPDATE tahun_ajaran SET nama=?,tanggal_mulai=?,tanggal_selesai=?,aktif=? WHERE id=?')
      .run(nama, b.tanggal_mulai || '', b.tanggal_selesai || '', b.aktif ? 1 : 0, Number(b.id));
  } else {
    /* TA lama harus dibaca SEBELUM baris baru dibuat (bisa jadi langsung aktif) */
    const sebelum = dbm.tahunAktif();
    const r = db.prepare('INSERT INTO tahun_ajaran(nama,tanggal_mulai,tanggal_selesai,aktif,created_at) VALUES(?,?,?,?,?)')
      .run(nama, b.tanggal_mulai || '', b.tanggal_selesai || '', b.aktif ? 1 : 0, dbm.now());
    const baruId = Number(r.lastInsertRowid);
    taId = baruId;
    if (!dbm.getSetting('ta_aktif', '')) dbm.setSetting('ta_aktif', baruId);
    if (salin && sebelum && sebelum.id !== baruId) {
      try {
        dbm.adopsiKelasTanpaTa(sebelum.id);
        if (b.aktif) {
          /* TA baru langsung aktif → siswa benar-benar naik tingkat */
          kenaikan = dbm.kenaikanKelas(sebelum.id, baruId, user, { salin_periodik: true });
          dbm.setSetting('ta_aktif', baruId);
        } else {
          /* belum aktif → hanya struktur kelas yang disalin (siswa tetap di TA lama) */
          const salinKelas = dbm.salinKelasTa(sebelum.id, baruId);
          kenaikan = { naik: 0, lulus: 0, kelasBaru: salinKelas.kelasBaru, belum_aktif: true };
        }
      } catch (e) {
        dbm.logAudit(user, 'KENAIKAN KELAS', 'siswa', `Gagal kenaikan kelas otomatis: ${e.message}`);
      }
    }
  }
  if (b.aktif && taId) {
    db.prepare('UPDATE tahun_ajaran SET aktif=0 WHERE id<>?').run(taId);
    db.prepare('UPDATE tahun_ajaran SET aktif=1 WHERE id=?').run(taId);
    dbm.setSetting('ta_aktif', taId);
  }
  dbm.logAudit(user, 'UBAH', 'pengaturan',
    `Menyimpan tahun pelajaran ${nama}` + (salin ? ' (salin periodik + kenaikan kelas)' : '') +
    (kenaikan ? ` — ${kenaikan.naik} siswa naik, ${kenaikan.lulus} lulus` : ''));
  json(res, 200, { ok: true, rows: dbm.tahunList(), kenaikan });
});

/* ---------- WhatsApp Gateway: peringatan ke orang tua ---------- */
post('/api/wa/siswa/:id', async (req, res, q, params) => {
  const user = guard(req, res, 'kejadian', 'view'); if (!user) return;
  const s = dbm.siswaById(params.id);
  if (!s) return fail(res, 404, 'Siswa tidak ditemukan.');
  if (!s.parent_phone) return fail(res, 400, 'Nomor HP orang tua belum diisi untuk siswa ini.');
  const cfg = dbm.waConfig();
  const lock = dbm.waLockOf(s.id);
  if (lock) {
    return fail(res, 429, `Pesan untuk ${s.nama} sudah dikirim pada ${lock.terakhir} — tombol dikunci sampai ${lock.sampai} (± ${lock.sisa_jam} jam lagi).`);
  }
  const pesan = dbm.waMessage(s, { guru: user.nama });
  const hasil = await dbm.waSend(s.parent_phone, pesan);
  db.prepare(`INSERT INTO wa_log(siswa_id,nama,phone,jenis,pesan,oleh,oleh_nama,created_at,status,sumber,error)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(s.id, s.nama, s.parent_phone, 'peringatan', pesan, user.id, user.nama, dbm.now(),
      hasil.status, cfg.aktif ? 'gateway' : 'manual', hasil.error || '');
  dbm.logAudit(user, 'WA', 'kejadian', `Kirim peringatan WhatsApp ke orang tua ${s.nama} (${hasil.status})`, ipOf(req));
  json(res, 200, {
    ok: true, phone: s.parent_phone, pesan, status: hasil.status, error: hasil.error || '',
    wa_url: `https://wa.me/${s.parent_phone}?text=${encodeURIComponent(pesan)}`,
    cooldown_jam: cfg.cooldownJam
  });
});

/* daftar siswa + status penguncian jeda (dipakai halaman Data Siswa) */
get('/api/wa/status', (req, res, q) => {
  const user = guard(req, res, 'siswa', 'view'); if (!user) return;
  const cfg = dbm.waConfig();
  const map = dbm.waLastMap();
  const ids = String(q.ids || '').split(',').map(x => Number(x)).filter(Boolean);
  const out = {};
  for (const id of ids) out[id] = dbm.waLockOf(id, map, cfg.cooldownJam);
  json(res, 200, { ok: true, locks: out, cooldown_jam: cfg.cooldownJam, gateway_aktif: cfg.aktif });
});

/* kirim peringatan masal */
post('/api/wa/massal', async (req, res) => {
  const user = guard(req, res, 'kejadian', 'view'); if (!user) return;
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(','))
    .map(x => Number(x)).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu siswa terlebih dahulu.');
  const tpl = String(b.template || '').trim();
  const cfg = dbm.waConfig();
  const map = dbm.waLastMap();
  const terkirim = [], terkunci = [], tanpaNomor = [], gagal = [], tautan = [];
  for (const id of ids) {
    const s = dbm.siswaById(id);
    if (!s) continue;
    if (!s.parent_phone) { tanpaNomor.push(s.nama); continue; }
    const lock = dbm.waLockOf(id, map, cfg.cooldownJam);
    if (lock) { terkunci.push({ nama: s.nama, sampai: lock.sampai, terakhir: lock.terakhir }); continue; }
    const pesan = dbm.waMessage(s, { guru: user.nama, template: tpl });
    const hasil = await dbm.waSend(s.parent_phone, pesan);
    db.prepare(`INSERT INTO wa_log(siswa_id,nama,phone,jenis,pesan,oleh,oleh_nama,created_at,status,sumber,error)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(s.id, s.nama, s.parent_phone, 'massal', pesan, user.id, user.nama, dbm.now(),
        hasil.status, cfg.aktif ? 'gateway' : 'manual', hasil.error || '');
    map.set(s.id, dbm.now());
    if (hasil.status === 'gagal') gagal.push({ nama: s.nama, error: hasil.error });
    else terkirim.push(s.nama);
    tautan.push({ nama: s.nama, phone: s.parent_phone, url: `https://wa.me/${s.parent_phone}?text=${encodeURIComponent(pesan)}` });
  }
  dbm.logAudit(user, 'WA', 'siswa',
    `Kirim peringatan WhatsApp masal: ${terkirim.length} terkirim, ${terkunci.length} terkunci jeda, ${tanpaNomor.length} tanpa nomor`, ipOf(req));
  json(res, 200, {
    ok: true, terkirim, terkunci, tanpa_nomor: tanpaNomor, gagal, tautan,
    gateway_aktif: cfg.aktif, cooldown_jam: cfg.cooldownJam,
    pesan: `${terkirim.length} pesan diproses${terkunci.length ? `, ${terkunci.length} masih terkunci jeda ${cfg.cooldownJam} jam` : ''}${tanpaNomor.length ? `, ${tanpaNomor.length} siswa tanpa nomor HP` : ''}.`
  });
});

/* riwayat pengiriman WhatsApp (tanggal, waktu, akun pengirim) */
get('/api/wa/log', (req, res, q) => {
  const user = guard(req, res, 'siswa', 'view'); if (!user) return;
  const limit = Math.max(1, Math.min(500, Number(q.limit) || 100));
  const rows = db.prepare(`SELECT l.*, s.kelas_id, k.nama AS kelas_nama
    FROM wa_log l LEFT JOIN siswa s ON s.id=l.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
    ORDER BY l.id DESC LIMIT ${limit}`).all();
  json(res, 200, { ok: true, rows, cooldown_jam: dbm.waConfig().cooldownJam });
});

/* pengaturan gateway WhatsApp */
get('/api/wa/pengaturan', (req, res) => {
  if (!guard(req, res, 'pengaturan', 'view')) return;
  const c = dbm.waConfig();
  const wjc = dbm.waJadwalConfig();
  json(res, 200, {
    ok: true,
    config: {
      aktif: c.aktif, url: c.url, token_set: !!c.token, payload: c.payload,
      header: c.header, prefix: c.prefix, cooldown_jam: c.cooldownJam, template: c.template,
      kepsek_wa: dbm.getSetting('kepsek_wa', ''),
      wakasek_kur_wa: dbm.getSetting('wakasek_kur_wa', ''),
      absensi_wa_aktif: String(dbm.getSetting('absensi_wa_aktif', '0')) === '1' ? 1 : 0,
      absensi_wa_jam: dbm.getSetting('absensi_wa_jam', '14:00'),
      /* notifikasi otomatis */
      provider: c.provider, alfa_aktif: c.alfaAktif ? 1 : 0, izin_aktif: c.izinAktif ? 1 : 0,
      template_alfa: dbm.getSetting('wa_template_alfa', ''),
      template_izin: dbm.getSetting('wa_template_izin', ''),
      contoh_template_alfa: dbm.waTemplateAlfa(), contoh_template_izin: dbm.waTemplateIzin(),
      alfa_terkirim: (() => { try { return db.prepare("SELECT COUNT(*) c FROM wa_log WHERE jenis='alfa-siswa'").get().c; } catch (e) { return 0; } })(),
      izin_terkirim: (() => { try { return db.prepare("SELECT COUNT(*) c FROM wa_log WHERE jenis='izin-guru'").get().c; } catch (e) { return 0; } })(),
      /* PENGINGAT JADWAL MENGAJAR & PERINGATAN CHECK-IN */
      jadwal_ingat_aktif: wjc.ingatAktif ? 1 : 0,
      jadwal_ingat_menit: wjc.ingatMenit,
      jadwal_telat_aktif: wjc.telatAktif ? 1 : 0,
      jadwal_telat_menit: wjc.telatMenit,
      jadwal_telat_atasan_aktif: wjc.telatAtasanAktif ? 1 : 0,
      piket_wa: wjc.piketWa,
      template_jadwal_ingat: dbm.getSetting('wa_template_jadwal_ingat', ''),
      template_jadwal_telat: dbm.getSetting('wa_template_jadwal_telat', ''),
      template_jadwal_telat_atasan: dbm.getSetting('wa_template_jadwal_telat_atasan', ''),
      contoh_template_jadwal_ingat: dbm.waTemplateJadwalIngat(),
      contoh_template_jadwal_telat: dbm.waTemplateJadwalTelat(),
      contoh_template_jadwal_telat_atasan: dbm.waTemplateJadwalTelatAtasan(),
      jadwal_ingat_terkirim: (() => { try { return db.prepare("SELECT COUNT(*) c FROM wa_log WHERE jenis='jadwal-ingat'").get().c; } catch (e) { return 0; } })(),
      jadwal_telat_terkirim: (() => { try { return db.prepare("SELECT COUNT(*) c FROM wa_log WHERE jenis IN ('jadwal-telat','jadwal-telat-atasan')").get().c; } catch (e) { return 0; } })()
    },
    contoh_payload: '{"target":"{phone}","message":"{message}"}'
  });
});
post('/api/wa/pengaturan', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const punya = k => b[k] !== undefined;
  if (punya('payload')) {
    const payload = String(b.payload || '').trim();
    if (payload) {
      try { JSON.parse(payload.replace(/\{phone\}/g, '0').replace(/\{message\}/g, 'x')); }
      catch (e) { return fail(res, 400, 'Template body gateway harus berupa JSON valid (gunakan {phone} dan {message}).'); }
    }
    dbm.setSetting('wa_gateway_payload', payload || '{"target":"{phone}","message":"{message}"}');
  }
  if (punya('cooldown_jam')) {
    const cooldown = Math.max(0, Math.min(720, Number(b.cooldown_jam) || 0));
    dbm.setSetting('wa_cooldown_jam', String(cooldown));
  }
  if (punya('aktif')) {
    dbm.setSetting('wa_aktif', (String(b.aktif) === '1' || b.aktif === true || b.aktif === 'true') ? '1' : '0');
  }
  if (punya('url')) dbm.setSetting('wa_gateway_url', String(b.url || '').trim());
  /* token hanya ditimpa bila field diisi (agar tidak hilang saat form dikirim kosong) */
  if (String(b.token || '').trim()) dbm.setSetting('wa_gateway_token', String(b.token).trim());
  if (String(b.token_hapus || '') === '1') dbm.setSetting('wa_gateway_token', '');
  if (punya('header')) dbm.setSetting('wa_gateway_header', String(b.header || 'Authorization').trim());
  if (punya('prefix')) dbm.setSetting('wa_gateway_prefix', String(b.prefix || ''));
  if (punya('template')) dbm.setSetting('wa_template_massal', String(b.template || ''));
  if (String(b.template_utama || '').trim()) dbm.setSetting('wa_template', String(b.template_utama));
  if (punya('input_cooldown_jam')) {
    dbm.setSetting('input_cooldown_jam', String(Math.max(0, Math.min(720, Number(b.input_cooldown_jam) || 0))));
  }
  if (punya('absensi_wa_aktif')) {
    dbm.setSetting('absensi_wa_aktif', (String(b.absensi_wa_aktif) === '1' || b.absensi_wa_aktif === true) ? '1' : '0');
  }
  if (punya('absensi_wa_jam')) {
    const jam = String(b.absensi_wa_jam || '').trim();
    if (jam && !/^([01]\d|2[0-3]):[0-5]\d$/.test(jam)) return fail(res, 400, 'Jam kirim absensi tidak valid (HH:MM).');
    if (jam) dbm.setSetting('absensi_wa_jam', jam);
  }
  /* ---- notifikasi otomatis: alfa siswa & izin guru (Fonnte/gateway) ---- */
  if (punya('provider')) {
    const prov = String(b.provider || 'generik').toLowerCase();
    dbm.setSetting('wa_provider', ['fonnte', 'generik'].includes(prov) ? prov : 'generik');
  }
  if (punya('alfa_aktif')) {
    dbm.setSetting('wa_alfa_aktif', (String(b.alfa_aktif) === '1' || b.alfa_aktif === true) ? '1' : '0');
  }
  if (punya('izin_aktif')) {
    dbm.setSetting('wa_izin_aktif', (String(b.izin_aktif) === '1' || b.izin_aktif === true) ? '1' : '0');
  }
  if (punya('template_alfa')) dbm.setSetting('wa_template_alfa', String(b.template_alfa || ''));
  if (punya('template_izin')) dbm.setSetting('wa_template_izin', String(b.template_izin || ''));
  /* ---- PENGINGAT JADWAL MENGAJAR & PERINGATAN CHECK-IN (Fonnte) ---- */
  const boolKeys = [
    ['jadwal_ingat_aktif', 'wa_jadwal_ingat_aktif'],
    ['jadwal_telat_aktif', 'wa_jadwal_telat_aktif'],
    ['jadwal_telat_atasan_aktif', 'wa_jadwal_telat_atasan_aktif']
  ];
  for (const [input, key] of boolKeys) {
    if (!punya(input)) continue;
    const nyala = b[input] === true || ['1', 'true', 'on', 'ya'].includes(String(b[input]).toLowerCase());
    dbm.setSetting(key, nyala ? '1' : '0');
  }
  for (const [input, key, label] of [
    ['jadwal_ingat_menit', 'wa_jadwal_ingat_menit', 'waktu pengingat sebelum jam pelajaran'],
    ['jadwal_telat_menit', 'wa_jadwal_telat_menit', 'batas keterlambatan check-in']
  ]) {
    if (!punya(input)) continue;
    const n = Number(b[input]);
    if (!Number.isFinite(n) || n < 1 || n > 180) {
      return fail(res, 400, `Menit ${label} harus antara 1 dan 180.`);
    }
    dbm.setSetting(key, String(Math.round(n)));
  }
  for (const [input, key] of [
    ['template_jadwal_ingat', 'wa_template_jadwal_ingat'],
    ['template_jadwal_telat', 'wa_template_jadwal_telat'],
    ['template_jadwal_telat_atasan', 'wa_template_jadwal_telat_atasan']
  ]) {
    if (punya(input)) dbm.setSetting(key, String(b[input] || '').slice(0, 3000));
  }
  /* nomor penerima rekap absensi guru (Kepala Sekolah & Wakasek Kurikulum & Guru Piket) */
  for (const [key, label] of [['kepsek_wa', 'Kepala Sekolah'], ['wakasek_kur_wa', 'Wakasek Kurikulum'],
    ['piket_wa', 'Guru Piket']]) {
    if (!punya(key)) continue;
    const raw = String(b[key] || '').trim();
    const num = raw ? lib.normPhone(raw) : '';
    if (raw && !num) return fail(res, 400, `Nomor WhatsApp ${label} tidak valid.`);
    dbm.setSetting(key, num);
  }
  dbm.logAudit(user, 'UBAH', 'pengaturan', 'Pengaturan WhatsApp Gateway / jeda (WA & input)', ipOf(req));
  json(res, 200, { ok: true, pesan: 'Pengaturan disimpan.' });
});
/* uji kirim ke satu nomor */
post('/api/wa/uji', async (req, res) => {
  const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
  const b = await readBody(req);
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  if (!phone) return fail(res, 400, 'Nomor tujuan wajib diisi.');
  const saved = dbm.waConfig();
  const active = b.aktif === undefined ? saved.aktif
    : b.aktif === true || ['1', 'true', 'on'].includes(String(b.aktif).toLowerCase());
  const cfg = {
    ...saved,
    aktif: active,
    url: b.url === undefined ? saved.url : String(b.url || '').trim(),
    token: String(b.token || '').trim() || saved.token,
    header: b.header === undefined ? saved.header : String(b.header || '').trim(),
    prefix: b.prefix === undefined ? saved.prefix : String(b.prefix || ''),
    payload: b.payload === undefined ? saved.payload : String(b.payload || ''),
    provider: ['fonnte', 'generik'].includes(String(b.provider || '').toLowerCase())
      ? String(b.provider).toLowerCase() : saved.provider
  };
  if (!cfg.aktif || !cfg.url) return fail(res, 400, 'Gateway belum aktif/dikonfigurasi — isi URL & token lalu aktifkan.');
  const hasil = await dbm.waSend(phone, String(b.pesan || 'Uji koneksi WhatsApp Gateway dari aplikasi tata tertib.'), cfg);
  json(res, hasil.status === 'gagal' ? 400 : 200, { ok: hasil.status !== 'gagal', status: hasil.status, error: hasil.error || '', pesan: hasil.status === 'gagal' ? hasil.error : 'Pesan uji terkirim.' });
});

/* ---------- upload bukti foto (proxy media platform) ---------- */
/** unggah satu buffer ke penyimpanan media platform (dipakai /api/upload &
    modul akademik untuk bukti foto absensi). Mengembalikan {ok,url,id,via,error} */
async function uploadBuffer({ buf, filename, mime, jenis, refTabel, refId, user }) {
  const name = String(filename || 'berkas.jpg').replace(/[^\w.\-]/g, '_');
  const maxKb = Math.max(64, Number(dbm.getSetting('upload_max_kb', 2048)) || 2048);
  if (buf.length > maxKb * 1024) {
    return { ok: false, error: `Ukuran berkas melebihi batas ${(maxKb / 1024).toFixed(maxKb % 1024 ? 1 : 0)} MB. Kompres dulu atau ubah batas di menu Pengaturan → Unggahan.` };
  }
  const jns = ['bukti', 'logo', 'foto', 'lain', 'absensi'].includes(String(jenis)) ? String(jenis) : 'bukti';
  const refTabelSafe = refTabel ? String(refTabel).slice(0, 40) : null;
  const refIdSafe = refId ? Number(refId) : null;
  const token = process.env.APP_MEDIA_TOKEN;
  const base = (process.env.APP_MEDIA_URL || 'http://127.0.0.1:4310').replace(/\/+$/, '');
  const mimeFinal = mime || mimeOf(name);
  if (token) {
    try {
      const r = await fetch(`${base}/api/app-media/upload?filename=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'X-App-Media-Token': token, 'Content-Type': 'application/octet-stream' },
        body: buf
      });
      const out = await r.json().catch(() => ({}));
      if (out && out.url) {
        const id = dbm.uploadAdd({
          filename: name, url: out.url, mime: mimeFinal, ukuran: buf.length, jenis: jns,
          ref_tabel: refTabelSafe, ref_id: refIdSafe, oleh: user ? user.id : null, oleh_nama: user ? user.nama : ''
        });
        return { ok: true, url: out.url, via: 'media', id };
      }
      return { ok: false, error: out && out.error ? out.error : 'Gagal mengunggah berkas ke penyimpanan media.' };
    } catch (e) {
      return { ok: false, error: 'Gagal menghubungi penyimpanan media: ' + e.message };
    }
  }
  /* mode pengembangan lokal (token media belum tersedia): simpan data URL */
  if (buf.length > Math.min(600 * 1024, maxKb * 1024)) {
    return { ok: false, error: 'Mode lokal: ukuran foto maksimal 600 KB. Unggah akan penuh aktif setelah aplikasi dipublikasikan.' };
  }
  const dataUrl = `data:${mimeFinal};base64,${buf.toString('base64')}`;
  const id = dbm.uploadAdd({
    filename: name, url: dataUrl, mime: mimeFinal, ukuran: buf.length, jenis: jns,
    ref_tabel: refTabelSafe, ref_id: refIdSafe, oleh: user ? user.id : null, oleh_nama: user ? user.nama : ''
  });
  return { ok: true, url: dataUrl, via: 'local', id };
}

post('/api/upload', async (req, res) => {
  const sesi = sessionFrom(req);
  if (!sesi) return fail(res, 401, 'Sesi berakhir. Silakan masuk kembali.');
  const user = sesi.user;
  const b = await readBody(req);
  const filename = String(b.filename || 'bukti.jpg').replace(/[^\w.\-]/g, '_');
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) return fail(res, 400, 'Berkas tidak terbaca.');
  const jenis = ['bukti', 'logo', 'foto', 'lain'].includes(String(b.jenis)) ? String(b.jenis) : 'bukti';
  const out = await uploadBuffer({
    buf, filename, jenis,
    refTabel: b.ref_tabel ? String(b.ref_tabel).slice(0, 40) : null,
    refId: b.ref_id ? Number(b.ref_id) : null, user
  });
  if (!out.ok) return fail(res, 400, out.error);
  json(res, 200, { ok: true, url: out.url, via: out.via, id: out.id });
});

/* ---------- KELOLA FILE (media manager) ---------- */
get('/api/files', (req, res, q) => {
  if (!guard(req, res, 'berkas', 'view')) return;
  const rows = dbm.uploadList({ jenis: q.jenis || '', q: q.q || '', limit: 500 });
  json(res, 200, { ok: true, rows, storage: dbm.storageInfo(), jenis: ['bukti', 'logo', 'foto', 'lain'] });
});
post('/api/files/delete', async (req, res) => {
  const user = guard(req, res, 'berkas', 'delete'); if (!user) return;
  const b = await readBody(req);
  const ids = [].concat(b.ids || b.id || []).map(Number).filter(Boolean);
  if (!ids.length) return fail(res, 400, 'Pilih minimal satu berkas.');
  const r = dbm.uploadDelete(ids);
  dbm.logAudit(user, 'HAPUS', 'berkas', `Hapus masal ${r.dihapus} berkas terunggah (${Math.round(r.dibebaskan / 1024)} KB)`, ipOf(req));
  json(res, 200, { ok: true, dihapus: r.dihapus, dibebaskan: r.dibebaskan, storage: dbm.storageInfo() });
});
get('/api/storage', (req, res) => {
  if (!guard(req, res, 'berkas', 'view')) return;
  json(res, 200, { ok: true, storage: dbm.storageInfo() });
});

/* ---------- MODUL AKADEMIK: jadwal, absensi guru & absensi siswa ---------- */
const tenantKodeOf = (req) => {
  const c = contextOf(req);
  return (c.tenant && c.tenant.kode) || '0000';
};
const akademik = require('./akademik')({
  get, post, del, json, fail, guard, readBody, ipOf, uploadBuffer,
  appBaseUrl, sessionFrom, numOr, tenantKode: tenantKodeOf
});
/* modul rekap absensi (guru/siswa, peringkat, WA wali kelas) */
const rekapMod = require('./rekap')({ get, post, json, fail, guard, readBody, ipOf });
/* modul Bimbingan Konseling: aduan kekerasan, layanan BK, asesmen siswa */
const bkMod = require('./bk')({
  get, post, del, json, fail, guard, readBody, ipOf, uploadBuffer,
  appBaseUrl, tenantKode: tenantKodeOf
});
/* modul AI Timetable Generator: beban mengajar, batasan guru, ruang, generate & apply */
const timetableMod = require('./timetable')({ get, post, json, fail, guard, readBody, ipOf });

/* ---------- favicon (SELALU dari Branding Sistem global) ---------- */
function brandingFavicon() {
  const br = saas.branding();
  const src = br.favicon || br.logo || '';
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
  if (m) return { kind: 'data', mime: m[1], data: Buffer.from(m[2], 'base64') };
  if (/^https?:\/\//i.test(src) || /^\/[^/]/.test(src)) return { kind: 'redirect', url: src };
  const inisial = esc(String(br.app_nama || 'S')
    .replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'S');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ea580c"/><text x="32" y="43" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${inisial}</text></svg>`;
  return { kind: 'data', mime: 'image/svg+xml', data: Buffer.from(svg, 'utf8') };
}
function serveFavicon(req, res) {
  const fav = brandingFavicon();
  /* URL favicon diberi ?v=<versi branding>; jangan pernah di-cache lama agar
     perubahan favicon dari Super Admin langsung terlihat di perangkat mana pun. */
  const headers = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  if (fav.kind === 'redirect') { res.writeHead(302, { ...headers, Location: fav.url }).end(); return; }
  res.writeHead(200, { ...headers, 'Content-Type': fav.mime, 'Content-Length': fav.data.length });
  res.end(fav.data);
}
get('/favicon.ico', (req, res) => serveFavicon(req, res));
get('/favicon.svg', (req, res) => serveFavicon(req, res));
get('/favicon.png', (req, res) => serveFavicon(req, res));

/* ============================ STATIC ============================ */
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json'
};
let indexCache = { base: '', html: '', mtime: 0, ver: '' };

function indexHTML(req) {
  const base = baseOf(req);
  const fp = path.join(DIST, 'index.html');
  const mtime = fs.existsSync(fp) ? fs.statSync(fp).mtimeMs : 0;
  /* branding global dibaca SETIAP permintaan (bukan di-cache) supaya judul tab,
     deskripsi, dan favicon langsung ikut perubahan Branding Sistem. */
  const br = saas.branding();
  const ver = String(br.version || '1');
  if (indexCache.base === base && indexCache.mtime === mtime && indexCache.ver === ver && indexCache.html) return indexCache.html;
  let html = fs.readFileSync(fp, 'utf8');
  const b = base || '';
  const baseHref = b ? b + '/' : '/';
  const judul = esc(br.login_judul || br.app_nama || 'Aplikasi');
  const sub = esc(br.login_subjudul || br.app_subtitle || '');
  const deskripsi = esc(br.login_deskripsi || '');
  const favUrl = `${b}/favicon.ico?v=${encodeURIComponent(ver)}`;
  html = html.replace('<head>', `<head>\n    <base href="${baseHref}">\n    <script>window.__BASE__=${JSON.stringify(b)};window.__BRAND__=${JSON.stringify({
    app_nama: br.app_nama, app_subtitle: br.app_subtitle, login_judul: br.login_judul,
    login_subjudul: br.login_subjudul, version: ver, logo: br.logo, favicon: br.favicon
  }).replace(/</g, '\\u003c')};</script>`);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${judul}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${deskripsi || sub}">`);
  html = html.replace(/<meta name="theme-color"[^>]*>/i, `<meta name="theme-color" content="#ea580c">`);
  html = html.replace(/<link rel="(?:shortcut )?icon"[^>]*>/gi, '');
  html = html.replace('</head>', `    <link rel="icon" id="app-favicon" href="${favUrl}" data-brand-version="${esc(ver)}">\n  </head>`);
  indexCache = { base, html, mtime, ver };
  return html;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.startsWith('assets/') || rel === 'favicon.ico') {
    const fp = path.join(DIST, rel);
    if (rel.startsWith('assets/') && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp).toLowerCase();
      const data = fs.readFileSync(fp);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
      });
      return res.end(data);
    }
  }
  for (const name of ['logo.svg', 'app-logo.svg', 'robots.txt']) {
    if (rel === name) {
      const fp = path.join(DIST, name);
      if (fs.existsSync(fp)) {
        const data = fs.readFileSync(fp);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Content-Length': data.length });
        return res.end(data);
      }
    }
  }
  // SPA fallback
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>Build belum tersedia</h1><p>Jalankan <code>npm run build</code> terlebih dahulu.</p>');
  }
  const html = indexHTML(req);
  const data = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

/* ============================ ROUTER ============================ */
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    if (!r.p.includes(':')) { if (r.p === pathname) return { route: r, params: {} }; continue; }
    const rp = r.p.split('/'), pp = pathname.split('/');
    if (rp.length !== pp.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = pp[i];
      else if (rp[i] !== pp[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  let parsed;
  try { parsed = new URL(req.url || '/', 'http://localhost'); } catch (e) { return fail(res, 400, 'Permintaan tidak valid.'); }
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const query = {};
  for (const [key, value] of parsed.searchParams) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
    } else {
      query[key] = value;
    }
  }
  const method = req.method || 'GET';

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  const relPath = pathTanpaBase(req, pathname);

  const handle = async () => {
    try {
      const hit = matchRoute(method, pathname);
      if (hit) {
        await hit.route.fn(req, res, query, hit.params);
        return;
      }
      if (pathname.startsWith('/api/')) return fail(res, 404, 'Endpoint tidak ditemukan.');
      if (method !== 'GET' && method !== 'HEAD') return fail(res, 405, 'Metode tidak diizinkan.');
      return serveStatic(req, res, pathname);
    } catch (e) {
      console.error('[error]', method, pathname, e);
      if (!res.headersSent) fail(res, 500, 'Terjadi kesalahan pada server: ' + e.message);
      else res.end();
    }
  };

  /* Tentukan sekolah (tenant) yang menangani permintaan ini, lalu jalankan
     seluruh handler DI DALAM konteks database sekolah tersebut. Endpoint
     control plane (Super Admin) menyatakan sendiri bahwa ia tidak butuh
     database sekolah lewat `route.opt.saas`. */
  try {
    const hit0 = matchRoute(method, pathname);
    if (hit0 && hit0.route.opt && hit0.route.opt.saas) return await handle();  // panel platform

    /* ---------- PORTAL PUBLIK SISWA: /<slug-sekolah>/portal-siswa ----------
       Alamat lama "/portal" dihapus (404). Slug portal menentukan sekolah yang
       databasenya dipakai, sehingga portal tiap sekolah benar-benar terpisah. */
    let portalTenant = null;
    if ((method === 'GET' || method === 'HEAD') && !relPath.startsWith('/api/')) {
      /* "/portal" (alamat lama) dan "/portal-siswa" tanpa nama sekolah = alamat tidak sah */
      if (relPath === '/portal' || relPath.startsWith('/portal/')
        || relPath === '/portal-siswa' || relPath.startsWith('/portal-siswa/')) {
        return portalTidakDitemukan(res, 'Alamat portal sudah dipindahkan',
          'Portal siswa kini memakai alamat khusus setiap sekolah dengan format ' +
          '<code>/nama-sekolah/portal-siswa</code>. Silakan minta tautan terbaru kepada ' +
          'administrator sekolah Anda.', {
          base: baseOf(req),
          tautan: [{ href: baseOf(req) + '/', label: 'Buka Halaman Masuk' }]
        });
      }
      const slugPortal = portalSlugFromPath(relPath);
      if (slugPortal) {
        portalTenant = saas.tenantByPortalSlug(slugPortal);
        if (!portalTenant) {
          return portalTidakDitemukan(res, 'Portal sekolah tidak ditemukan',
            'Tidak ada sekolah dengan alamat portal <code>/' + esc(slugPortal) + '/portal-siswa</code>. ' +
            'Periksa kembali tautan yang Anda terima atau hubungi administrator sekolah.', {
            base: baseOf(req),
            tautan: [{ href: baseOf(req) + '/', label: 'Buka Halaman Masuk' }]
          });
        }
      }
    }

    const ctx = contextOf(req);
    /* sekolah dapat ditentukan dari kode eksplisit (portal/daftar) */
    let tenant = ctx.tenant;
    if (!tenant && (query.kode || query.sekolah)) {
      tenant = saas.tenantByKode(query.kode || query.sekolah);
    }
    /* endpoint publik: sekolah ditentukan oleh kode yang dikirim halaman portal
       (header X-Sekolah-Kode / ?kode=) — jangan bergantung pada sesi login lain
       yang mungkin ada di browser yang sama. */
    if (pathname.startsWith('/api/public/')) {
      /* token publik (presensi siswa / rekap jadwal) membawa kode sekolah:
         <kode>.<jenis>.<acak> — sekolah ditentukan dari token itu sendiri agar
         tautan yang dibagikan selalu membuka database sekolah yang benar. */
      const mTok = /^\/api\/public\/(?:presensi|jadwal|aduan|asesmen)\/([^/]+)(?:\/[^/]+)?$/.exec(pathname);
      const kodeToken = mTok ? (() => { try { return String(decodeURIComponent(mTok[1]) || '').split('.')[0]; } catch (e) { return ''; } })() : '';
      const kodePublik = String(req.headers['x-sekolah-kode'] || '').trim()
        || String(query.kode || query.sekolah || '').trim()
        || kodeToken;
      const tPublik = kodePublik ? saas.tenantByKode(kodePublik) : null;
      if (tPublik) tenant = tPublik;
    }
    if (portalTenant) tenant = portalTenant;   // portal publik menang atas sesi lain
    if (tenant) {
      req.__tenant = tenant;
      return await dbm.useTenant(tenantDbFile(tenant), handle);
    }
    /* tanpa sekolah: pakai DB utama (instalasi pertama / platform) */
    return await handle();
  } catch (e) {
    console.error('[fatal]', method, pathname, e);
    if (!res.headersSent) fail(res, 500, 'Terjadi kesalahan pada server: ' + e.message);
    else res.end();
  }
});

/* Khusus pengujian otomatis (dev-tests) — BUKAN fitur aplikasi: bila variabel
   lingkungan DEMO_SEED=1, database pengujian diisi contoh agar UI dapat diuji.
   Tidak ada menu/tombol/endpoint yang memanggil ini pada pemakaian nyata. */
if (process.env.DEMO_SEED === '1') {
  try {
    if (!dbm.demoStats().siswa) {
      const r = dbm.seedDemo(null);
      console.log(`[test-seed] data uji dimuat: ${r.siswa} siswa, ${r.kejadian} kejadian`);
    }
  } catch (e) { console.error('[test-seed] gagal memuat data uji:', e.message); }
}

/* pembersih Kotak Sampah setiap 6 jam (masa simpan 30 hari) */
setInterval(() => { try { dbm.trashPurge(); } catch (e) { /* abaikan */ } }, 6 * 3600 * 1000).unref();

/* =====================================================================
   SCHEDULER AKADEMIK (berjalan untuk SETIAP sekolah/tenant)
   · rekap absensi guru dikirim otomatis ke WhatsApp Kepala Sekolah &
     Wakasek Kurikulum sekali sehari setelah jam yang diatur;
   · bukti foto absensi yang melewati masa simpan (default 90 hari)
     dibersihkan berkala.
   ===================================================================== */
function tenantAktifList() {
  /* hanya sekolah yang berkas databasenya benar-benar ada — mencegah pembuatan
     berkas SQLite baru untuk tenant yang sudah dihapus. */
  try {
    return saas.tenantList().filter(t => {
      if (!t || t.status === 'nonaktif') return false;
      try { return fs.existsSync(saas.absDb(t)); } catch (e) { return false; }
    });
  } catch (e) { return []; }
}
async function jalankanRekapWaSemua() {
  for (const t of tenantAktifList()) {
    try { await dbm.useTenant(saas.absDb(t), () => akademik.checkWaRekap()); }
    catch (e) { /* satu sekolah gagal tidak menghentikan yang lain */ }
    /* rekap absensi harian siswa → WhatsApp Wali Kelas (jam diatur sekolah) */
    try { await dbm.useTenant(saas.absDb(t), () => rekapMod.checkWaKelas()); }
    catch (e) { /* abaikan */ }
    /* guru yang tidak check-in sampai jam pelajaran berakhir → ALFA otomatis */
    try { await dbm.useTenant(saas.absDb(t), () => akademik.autoAlfaHarian()); }
    catch (e) { /* abaikan */ }
    /* pengingat jadwal mengajar (N menit sebelum) & peringatan guru belum
       check-in (N menit setelah jam mulai) — dikirim lewat WhatsApp/Fonnte */
    try { await dbm.useTenant(saas.absDb(t), () => akademik.checkWaJadwal()); }
    catch (e) { /* abaikan */ }
  }
}
const backupTelegramInFlight = new Set();
async function checkSchoolTelegramBackup(t) {
  const tenantKey = String(t.id || t.kode || t.slug);
  return dbm.useTenant(saas.absDb(t), async () => {
    const cfg = schoolTelegramConfig();
    if (!cfg.auto || !cfg.token_set || !cfg.chat_id) return;
    const lastAttempt = String(dbm.getSetting('backup_telegram_last_attempt', '') || '');
    let marker;
    try { marker = telegramBackup.dueMarker(cfg.auto, cfg.jam, lastAttempt, new Date()); }
    catch (e) {
      console.error(`[backup-telegram:${tenantKey}] jadwal tidak valid:`, e.message);
      return;
    }
    if (!marker) return;
    const lock = `${tenantKey}:${marker}`;
    if (backupTelegramInFlight.has(lock)) return;
    backupTelegramInFlight.add(lock);
    dbm.setSetting('backup_telegram_last_attempt', marker);
    const stamp = marker.replace(/\D/g, '');
    const namaSekolah = String(dbm.getSetting('sekolah_nama', t.nama || t.kode || 'Sekolah') || t.nama || t.kode || 'Sekolah')
      .replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60);
    const nama = `Backup_${namaSekolah}_${stamp}.zip`;
    try {
      const { buf } = buildSchoolBackupZip();
      await telegramBackup.sendDocument(
        String(dbm.getSetting('backup_telegram_bot_token', '') || '').trim(),
        cfg.chat_id,
        buf,
        nama,
        `Backup otomatis ${namaSekolah} ${marker} (${require('./tz').label()})`
      );
      dbm.setSetting('backup_telegram_terakhir', lib.nowStamp());
      dbm.setSetting('backup_telegram_status', 'sukses');
      dbm.setSetting('backup_telegram_error', '');
      dbm.logAudit(null, 'BACKUP TELEGRAM', 'pengaturan', `Backup otomatis ${nama} (${Math.round(buf.length / 1024)} KB)`);
      console.log(`[backup-telegram:${tenantKey}] terkirim ${nama}`);
    } catch (e) {
      dbm.setSetting('backup_telegram_status', 'gagal');
      dbm.setSetting('backup_telegram_error', e.message);
      dbm.logAudit(null, 'GAGAL BACKUP TELEGRAM', 'pengaturan', `${nama}: ${e.message}`);
      console.error(`[backup-telegram:${tenantKey}] gagal:`, e.message);
    } finally {
      backupTelegramInFlight.delete(lock);
    }
  });
}
async function jalankanBackupTelegramSemua() {
  for (const t of tenantAktifList()) {
    try { await checkSchoolTelegramBackup(t); }
    catch (e) { console.error(`[backup-telegram:${t.kode || t.id}] gagal memeriksa jadwal:`, e.message); }
  }
}
function bersihkanFotoAbsensi() {
  for (const t of tenantAktifList()) {
    try { dbm.useTenant(saas.absDb(t), () => dbm.absensiPurgeFoto()); }
    catch (e) { /* abaikan */ }
  }
}
setInterval(() => { jalankanRekapWaSemua().catch(() => {}); }, 60 * 1000).unref();
setTimeout(() => { jalankanRekapWaSemua().catch(() => {}); }, 20000).unref();
setInterval(() => { jalankanBackupTelegramSemua().catch(e => console.error('[backup-telegram] gagal:', e.message)); }, 15 * 1000).unref();
setTimeout(() => { jalankanBackupTelegramSemua().catch(e => console.error('[backup-telegram] gagal:', e.message)); }, 25000).unref();
setInterval(bersihkanFotoAbsensi, 6 * 3600 * 1000).unref();
setTimeout(bersihkanFotoAbsensi, 45000).unref();

server.listen(PORT, () => {
  console.log(`[smart-tata-tertib] http://localhost:${PORT} — DB ${dbm.DB_PATH}`);
  console.log(require('./tz').startupLine());
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
