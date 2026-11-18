'use strict';
/* Uji ronde 9 — keamanan portal & branding global:
   1. Portal login Super Admin terpisah (/api/super/login) + menu Pengaturan Profil
   2. Login sekolah WAJIB kode sekolah 4 digit
   3. Anti-spam pendaftaran (honeypot, waktu isi minimal, batas per IP)
   4. Branding global: judul/deskripsi/favicon halaman login disajikan dari database
      (tanpa identitas sekolah), versi branding untuk cache-busting
   5. Nama aplikasi internal mengikuti Branding Sistem (bukan hardcode)
   Jalankan: node dev-tests/round9.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-r9-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const SAAS_DB = SAAS;
const PORT = 7420 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
/* penulisan nilai "lama" (string true/false) langsung ke control plane saat server berjalan */
function setSettingLangsung(key, value) {
  const d = new Database(SAAS_DB, { timeout: 5000 });
  try {
    d.prepare('INSERT INTO saas_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, String(value));
  } finally { d.close(); }
}
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

function client() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(p, o = {}) {
      const r = await fetch(BASE + p, {
        method: o.method || 'GET',
        headers: { ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: o.body ? JSON.stringify(o.body) : undefined,
        redirect: 'manual'
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      const ct = r.headers.get('content-type') || '';
      const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
      return { status: r.status, body, headers: r.headers };
    }
  };
}

(async () => {
  const gateway = await otpTest.startGateway();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));

  try {
    for (let i = 0; i < 90; i++) {
      try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) break; } catch (e) { /* belum siap */ }
      await new Promise(r => setTimeout(r, 250));
    }
    const pub = client();
    const su = client();
    const t1 = client();

    const daftar = await pub.req('/api/public/sekolah');
    const KODE = ((daftar.body.rows || [])[0] || {}).kode || '';
    ok('kode sekolah tenant tersedia', /^\d{4}$/.test(KODE), KODE);

    /* ============ 1. PORTAL LOGIN SUPER ADMIN TERPISAH ============ */
    console.log('\n== PORTAL SUPER ADMIN TERPISAH ==');
    let r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'salah' } });
    ok('portal super: sandi salah ditolak 401', r.status === 401, String(r.status));
    r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('portal super: login berhasil & scope super', r.status === 200 && r.body.scope === 'super', JSON.stringify(r.body).slice(0, 100));
    await otpTest.configure(su, gateway.url);
    r = await su.req('/api/bootstrap');
    ok('bootstrap panel super memakai scope super', r.body.scope === 'super');
    ok('bootstrap super memuat branding global', !!r.body.platform && r.body.platform.app_nama === 'SMART TATA TERTIB SISWA', JSON.stringify(r.body.platform || {}).slice(0, 120));

    /* profil super admin */
    r = await su.req('/api/super/profil');
    ok('menu profil: data akun super admin tersedia', r.status === 200 && r.body.user.username === 'superadmin', JSON.stringify(r.body.user || {}));
    r = await su.req('/api/super/profil', { method: 'POST', body: { nama: 'AB', username: 'superadmin' } });
    ok('nama akun terlalu pendek ditolak', r.status === 400, String(r.status));
    r = await su.req('/api/super/profil', { method: 'POST', body: { nama: 'Administrator Platform', username: 'Super Admin!' } });
    ok('username tidak valid ditolak', r.status === 400 && /username/i.test(r.body.error), r.body.error);
    r = await su.req('/api/super/profil', { method: 'POST', body: { nama: 'Administrator Platform', username: 'superadmin', email: 'bukan-email' } });
    ok('email tidak valid ditolak', r.status === 400 && /email/i.test(r.body.error), r.body.error);
    r = await su.req('/api/super/profil', { method: 'POST', body: { nama: 'Administrator Platform', username: 'superadmin', password_lama: 'salah', password_baru: 'RahasiaBaru123', password_ulang: 'RahasiaBaru123' } });
    ok('ganti sandi wajib sandi lama yang benar', r.status === 400 && /lama/i.test(r.body.error), r.body.error);
    r = await su.req('/api/super/profil', { method: 'POST', body: { nama: 'Administrator Platform', username: 'superadmin', password_lama: 'superadmin123', password_baru: 'pendek', password_ulang: 'pendek' } });
    ok('sandi baru minimal 8 karakter', r.status === 400 && /8 karakter/i.test(r.body.error), r.body.error);
    r = await su.req('/api/super/profil', { method: 'POST', body: { nama: 'Administrator Platform', username: 'superadmin', password_lama: 'superadmin123', password_baru: 'RahasiaBaru123', password_ulang: 'RahasiaBaru123' } });
    ok('nama & sandi super admin diperbarui', r.status === 200 && /kata sandi/i.test(r.body.pesan), r.body.pesan);
    r = await su.req('/api/super/profil');
    ok('nama baru tersimpan', r.body.user.nama === 'Administrator Platform', r.body.user.nama);

    const su2 = client();
    r = await su2.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('sandi lama tidak berlaku lagi', r.status === 401, String(r.status));
    r = await su2.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'RahasiaBaru123' } });
    ok('sandi baru dapat dipakai masuk', r.status === 200 && r.body.scope === 'super', String(r.status));

    /* ============ 2. LOGIN SEKOLAH WAJIB KODE ============ */
    console.log('\n== LOGIN SEKOLAH WAJIB KODE SEKOLAH ==');
    r = await t1.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    ok('login tanpa kode ditolak 400', r.status === 400 && /kode sekolah/i.test(r.body.error), r.body.error);
    r = await t1.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: 'abc' } });
    ok('kode bukan 4 digit ditolak', r.status === 400, String(r.status));
    r = await t1.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: '0000' } });
    ok('kode sekolah tidak dikenal ditolak 404', r.status === 404, String(r.status));
    r = await t1.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    ok('login dengan kode benar berhasil', r.status === 200 && r.body.scope === 'tenant', JSON.stringify(r.body).slice(0, 100));
    r = await t1.req('/api/bootstrap');
    ok('sesi sekolah hanya membuka sekolah yang dimaksud', r.body.tenant.kode === KODE, JSON.stringify(r.body.tenant || {}));

    const tSuper = client();
    r = await tSuper.req('/api/login', { method: 'POST', body: { username: 'superadmin', password: 'RahasiaBaru123', kode: KODE } });
    ok('akun super admin TIDAK bisa masuk lewat login sekolah', r.status === 401, String(r.status));

    /* ============ 3. ANTI-SPAM PENDAFTARAN ============ */
    console.log('\n== ANTI-SPAM PENDAFTARAN MANDIRI ==');
    const badan = (i) => ({
      nama_sekolah: 'Sekolah Uji Anti Spam ' + i, jenjang: 'SMA', alamat: 'Jl. Uji ' + i,
      admin_nama: 'Admin Uji ' + i, email: `admin${i}@uji.sch.id`, password: 'Rahasia123!',
      telp: '08120000001' + i, trial: true
    });
    r = await pub.req('/api/daftar', { method: 'POST', body: { ...badan(1), t0: Date.now() - 10000, website: 'http://bot.example' } });
    ok('honeypot terisi → pendaftaran ditolak', r.status === 400 && /otomatis/i.test(r.body.error), r.body.error);
    r = await pub.req('/api/daftar', { method: 'POST', body: { ...badan(2) } });
    ok('tanpa penanda waktu formulir ditolak', r.status === 400 && /formulir/i.test(r.body.error), r.body.error);
    r = await pub.req('/api/daftar', { method: 'POST', body: { ...badan(3), t0: Date.now() } });
    ok('form dikirim terlalu cepat ditolak 429', r.status === 429 && /terlalu cepat/i.test(r.body.error), r.body.error);

    /* batas per IP: set 1 pendaftaran/jam */
    r = await su.req('/api/super/branding', { method: 'POST', body: { daftar_limit_jam: 1, daftar_limit_hari: 5, daftar_min_detik: 1 } });
    ok('batas pendaftaran dapat diatur Super Admin', r.status === 200 && r.body.platform.daftar_limit_jam === 1, JSON.stringify(r.body.platform || {}).slice(0, 100));
    r = await pub.req('/api/daftar', { method: 'POST', body: await otpTest.bodyWithOtp(pub, gateway, { ...badan(4), t0: Date.now() - 10000 }) });
    ok('pendaftaran pertama dalam batas berhasil', r.status === 200 && /^\d{4}$/.test(String(r.body.kode)), JSON.stringify(r.body).slice(0, 120));
    r = await pub.req('/api/daftar', { method: 'POST', body: { ...badan(5), t0: Date.now() - 10000 } });
    ok('pendaftaran melebihi batas per IP ditolak 429', r.status === 429 && /terlalu banyak/i.test(r.body.error), r.body.error);
    await su.req('/api/super/branding', { method: 'POST', body: { daftar_limit_jam: 5, daftar_limit_hari: 20, daftar_min_detik: 4 } });

    /* ============ 4. BRANDING GLOBAL & HALAMAN LOGIN ============ */
    console.log('\n== BRANDING GLOBAL & HALAMAN LOGIN ==');
    const sebelum = await pub.req('/api/public/config?global=1');
    ok('config global: branding platform lengkap',
      sebelum.body.platform.app_nama === 'SMART TATA TERTIB SISWA' && !!sebelum.body.platform.login_judul, JSON.stringify(sebelum.body.platform || {}).slice(0, 140));
    ok('config global tidak membawa identitas sekolah',
      !sebelum.body.sekolah_nama && !sebelum.body.sekolah_alamat, JSON.stringify({ n: sebelum.body.sekolah_nama, a: sebelum.body.sekolah_alamat }));
    const verAwal = sebelum.body.branding_version;

    r = await su.req('/api/super/branding', { method: 'POST', body: {
      app_nama: 'PLATFORM DISIPLIN DIGITAL', app_subtitle: 'Subjudul Platform',
      login_judul: 'Masuk Platform Disiplin', login_subjudul: 'Kelola Kedisiplinan Sekolah',
      login_deskripsi: 'Deskripsi halaman login dari Super Admin.',
      login_footer: 'platform.contoh.id', login_copyright: '© 2026 Platform Disiplin Digital',
      favicon: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#0d9488"/></svg>').toString('base64')
    } });
    ok('branding global disimpan', r.status === 200, String(r.status));
    const verBaru = r.body.version;
    ok('versi branding berubah (cache busting)', verBaru && verBaru !== verAwal, `${verAwal} → ${verBaru}`);

    const sesudah = await pub.req('/api/public/config?global=1');
    ok('judul/subjudul login dari Branding Sistem',
      sesudah.body.platform.login_judul === 'Masuk Platform Disiplin' && sesudah.body.platform.login_subjudul === 'Kelola Kedisiplinan Sekolah');
    ok('footer & hak cipta login dari Branding Sistem',
      sesudah.body.platform.login_footer === 'platform.contoh.id' && sesudah.body.platform.login_copyright === '© 2026 Platform Disiplin Digital');
    ok('config global tetap tanpa data sekolah setelah branding diubah',
      !sesudah.body.sekolah_nama && !sesudah.body.sekolah_alamat && !/SMK PGRI/i.test(JSON.stringify(sesudah.body)));

    /* HTML head dinamis (judul + favicon berversii) */
    const html = await (await fetch(BASE + '/')).text();
    ok('<title> halaman mengikuti branding global', /<title>Masuk Platform Disiplin<\/title>/.test(html), (/<title>[^<]*<\/title>/.exec(html) || [])[0]);
    ok('meta description mengikuti branding global', /name="description" content="Deskripsi halaman login/i.test(html));
    ok('favicon memakai versi branding (cache busting)', new RegExp(`id="app-favicon" href="/favicon\\.ico\\?v=${verBaru}"`).test(html), (/id="app-favicon"[^>]*/.exec(html) || [])[0]);
    ok('judul tab tidak memuat nama sekolah', !/SMK PGRI/i.test(html));

    const fav = await fetch(BASE + '/favicon.ico?v=' + verBaru);
    const favBuf = Buffer.from(await fav.arrayBuffer());
    ok('favicon disajikan dari Branding Sistem (SVG ungu-hijau)', fav.status === 200 && /svg/.test(fav.headers.get('content-type') || '') && favBuf.toString().includes('#0d9488'));
    ok('favicon tidak di-cache lama', /no-store/.test(fav.headers.get('cache-control') || ''), fav.headers.get('cache-control'));

    /* ============ 4b. SAKELAR BOOLEAN BRANDING (regresi) ============ */
    console.log('\n== SAKELAR BOOLEAN BRANDING ==');
    const saklar = async () => (await su.req('/api/super/branding')).body.platform;
    r = await su.req('/api/super/branding', { method: 'POST', body: { pendaftaran_aktif: false } });
    ok('"Pendaftaran Ditutup" tersimpan (false)', r.status === 200 && r.body.platform.pendaftaran_aktif === false,
      String(r.body.platform.pendaftaran_aktif));
    r = await su.req('/api/super/branding');
    ok('baca ulang: pendaftaran tetap tertutup', r.body.platform.pendaftaran_aktif === false);
    r = await pub.req('/api/public/config?global=1');
    ok('config publik: pendaftaran tertutup', r.body.platform.pendaftaran_aktif === false);
    r = await pub.req('/api/daftar', { method: 'POST', body: {
      nama_sekolah: 'Sekolah Saat Ditutup', jenjang: 'SMA', alamat: 'x', admin_nama: 'Admin Tutup',
      email: 'tutup@uji.sch.id', password: 'Rahasia123!', telp: '081200000099',
      t0: Date.now() - 10000
    } });
    ok('pendaftaran ditolak saat sakelar ditutup', r.status === 403, String(r.status));

    r = await su.req('/api/super/branding', { method: 'POST', body: { pendaftaran_aktif: true } });
    ok('"Pendaftaran Dibuka" tersimpan (true) — dulu selalu kembali tertutup',
      r.status === 200 && r.body.platform.pendaftaran_aktif === true, String(r.body.platform.pendaftaran_aktif));
    r = await su.req('/api/super/branding');
    ok('baca ulang: pendaftaran tetap dibuka', r.body.platform.pendaftaran_aktif === true);
    r = await pub.req('/api/public/config?global=1');
    ok('config publik: pendaftaran dibuka', r.body.platform.pendaftaran_aktif === true);
    /* nilai lama yang terlanjur tersimpan sebagai "true"/"false" tetap terbaca benar */
    setSettingLangsung('pendaftaran_aktif', 'true');
    await new Promise(rs => setTimeout(rs, 1600));   // lewati memo branding (TTL 1,5 detik)
    r = await su.req('/api/super/branding');
    ok('nilai lama "true" dibaca sebagai dibuka (toleran)', r.body.platform.pendaftaran_aktif === true);
    setSettingLangsung('pendaftaran_aktif', 'false');
    await new Promise(rs => setTimeout(rs, 1600));
    r = await su.req('/api/super/branding');
    ok('nilai lama "false" dibaca sebagai tertutup', r.body.platform.pendaftaran_aktif === false);
    await su.req('/api/super/branding', { method: 'POST', body: { pendaftaran_aktif: true } });
    ok('sakelar mode pemeliharaan juga konsisten',
      (await saklar()).maintenance === false);

    /* ============ 5. NAMA APLIKASI INTERNAL ============ */
    console.log('\n== NAMA APLIKASI INTERNAL IKUT BRANDING GLOBAL ==');
    const t2 = client();
    r = await t2.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    r = await t2.req('/api/bootstrap');
    ok('bootstrap sekolah memuat platform global', r.body.platform.app_nama === 'PLATFORM DISIPLIN DIGITAL', JSON.stringify(r.body.platform || {}));
    ok('header sekolah memakai nama aplikasi global (bukan hardcode)',
      r.body.settings.app_nama === 'PLATFORM DISIPLIN DIGITAL' && r.body.settings.app_nama_global === 'PLATFORM DISIPLIN DIGITAL',
      JSON.stringify({ app: r.body.settings.app_nama, g: r.body.settings.app_nama_global }));
    ok('identitas sekolah tetap milik tenant sendiri', /SMK PGRI/i.test(r.body.settings.sekolah_nama), r.body.settings.sekolah_nama);
    r = await t2.req('/api/settings/save', { method: 'POST', body: { data: { app_nama: 'Nama Khusus Sekolah' } } });
    ok('sekolah boleh mengganti nama aplikasi sendiri', r.status === 200, String(r.status));
    r = await t2.req('/api/bootstrap');
    ok('nama khusus sekolah dipakai setelah disengaja diubah', r.body.settings.app_nama === 'Nama Khusus Sekolah', r.body.settings.app_nama);
    await t2.req('/api/settings/save', { method: 'POST', body: { data: { app_nama: '' } } });
    r = await t2.req('/api/bootstrap');
    ok('dikosongkan → kembali memakai branding global', r.body.settings.app_nama === 'PLATFORM DISIPLIN DIGITAL', r.body.settings.app_nama);

    /* portal publik tetap memakai identitas sekolah (bukan branding platform) */
    const t3 = client();
    r = await t3.req('/api/public/config');
    ok('portal publik tetap membaca identitas sekolah', /SMK PGRI/i.test(r.body.sekolah_nama || ''), r.body.sekolah_nama);

    /* ============ 6. HALAMAN /super-admin DISAJIKAN ============ */
    console.log('\n== URL PORTAL SUPER ADMIN ==');
    const sp = await fetch(BASE + '/super-admin', { redirect: 'manual' });
    const spHtml = await sp.text();
    ok('/super-admin menyajikan SPA (200)', sp.status === 200 && /<div id="root">/.test(spHtml), String(sp.status));
    ok('/super-admin memakai judul branding global', /<title>Masuk Platform Disiplin<\/title>/.test(spHtml));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(log.join('').slice(-1500));
  } finally {
    srv.kill('SIGKILL');
    await gateway.close().catch(() => {});
    await new Promise(r => setTimeout(r, 200));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL RONDE 9: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
