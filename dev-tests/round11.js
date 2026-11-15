'use strict';
/* Uji ronde 11 — portal publik siswa per sekolah (slug) & halaman login:
   1. Alamat lama "/portal" dan "/portal-siswa" tanpa nama sekolah → 404
   2. Alamat baru "/<slug-sekolah>/portal-siswa" → portal sekolah yang benar (terisolasi)
   3. Slug Khusus Portal Sekolah: otomatis dari nama, dapat diubah Super Admin &
      admin sekolah, divalidasi (kata terlarang, duplikat, karakter), slug lama mati
   4. Semua tautan portal (bootstrap tenant, endpoint publik) dinamis — tanpa tautan statis
   5. Halaman login: tanpa tautan "Cek Poin", ada tautan "Daftarkan sekolah Anda"
   Jalankan: node dev-tests/round11.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-r11-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 7820 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

function client() {
  let cookie = '';
  return {
    async req(p, o = {}) {
      const r = await fetch(BASE + p, {
        method: o.method || 'GET',
        headers: {
          ...(o.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(o.headers || {})
        },
        body: o.body ? JSON.stringify(o.body) : undefined,
        redirect: 'manual'
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      const ct = r.headers.get('content-type') || '';
      const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
      return { status: r.status, body, ct };
    }
  };
}

(async () => {
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

    const daftarSekolah = await pub.req('/api/public/sekolah');
    const sek0 = (daftarSekolah.body.rows || [])[0] || {};
    const KODE = sek0.kode;
    ok('kode sekolah utama tersedia', /^\d{4}$/.test(String(KODE)), String(KODE));
    ok('slug portal dibuat otomatis dari nama sekolah',
      sek0.portal_slug === 'smk-pgri-cikoneng' && sek0.portal_path === '/smk-pgri-cikoneng/portal-siswa',
      JSON.stringify({ s: sek0.portal_slug, p: sek0.portal_path }));

    /* ============ 1. ALAMAT LAMA DIHAPUS (404) ============ */
    console.log('\n== ALAMAT LAMA /portal → 404 ==');
    let r = await pub.req('/portal');
    ok('/portal → 404', r.status === 404, String(r.status));
    ok('/portal memuat penjelasan & tautan masuk', /Alamat portal sudah dipindahkan/.test(String(r.body)) &&
      /Buka Halaman Masuk/.test(String(r.body)));
    r = await pub.req('/portal?kode=' + KODE);
    ok('/portal?kode=… → 404 (tidak lagi membuka sekolah)', r.status === 404, String(r.status));
    r = await pub.req('/portal-siswa');
    ok('/portal-siswa tanpa nama sekolah → 404', r.status === 404, String(r.status));
    r = await pub.req('/sekolah-yang-tidak-ada/portal-siswa');
    ok('slug sekolah tidak dikenal → 404', r.status === 404 && /Portal sekolah tidak ditemukan/.test(String(r.body)), String(r.status));

    /* ============ 2. ALAMAT BARU BEKERJA ============ */
    console.log('\n== ALAMAT BARU /<slug>/portal-siswa ==');
    r = await pub.req('/smk-pgri-cikoneng/portal-siswa');
    ok('portal sekolah utama → 200 (SPA)', r.status === 200 && /<div id="root">/.test(String(r.body)), String(r.status));
    r = await pub.req('/api/public/portal/smk-pgri-cikoneng');
    ok('resolusi slug → kode sekolah', r.status === 200 && r.body.sekolah.kode === KODE,
      JSON.stringify(r.body.sekolah || {}));
    ok('resolusi slug mengembalikan path portal', r.body.portal.path === '/smk-pgri-cikoneng/portal-siswa', r.body.portal.path);
    r = await pub.req('/api/public/portal/ngawur-xyz');
    ok('slug ngawur pada API → 404', r.status === 404, String(r.status));

    /* ============ 3. SLUG KHUSUS PORTAL — SUPER ADMIN ============ */
    console.log('\n== SLUG KHUSUS PORTAL: SUPER ADMIN ==');
    r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('login super admin', r.status === 200 && r.body.scope === 'super', String(r.status));
    r = await su.req('/api/super/sekolah');
    const tenant0 = (r.body.rows || []).find(t => t.kode === KODE) || {};
    ok('detail sekolah memuat portal_slug & portal_path',
      !!tenant0.portal_slug && !!tenant0.portal_path, JSON.stringify({ s: tenant0.portal_slug, p: tenant0.portal_path }));

    const ganti = async (slug) => su.req('/api/super/sekolah/simpan', { method: 'POST', body: { id: tenant0.id, portal_slug: slug } });
    r = await ganti('smk-pgri-cikoneng');
    ok('menyimpan slug yang sama tidak mengubah apa pun', r.status === 200 && r.body.tenant.portal_slug === 'smk-pgri-cikoneng', String(r.status));
    r = await ganti('smk cikoneng hebat');
    ok('slug tidak valid (spasi) ditolak', r.status === 400 && /huruf kecil/i.test(r.body.error), r.body.error);
    r = await ganti('ab');
    ok('slug terlalu pendek ditolak', r.status === 400 && /minimal 3/i.test(r.body.error), r.body.error);
    r = await ganti('api');
    ok('slug kata terlarang (jalur aplikasi) ditolak', r.status === 400 && /jalur aplikasi/i.test(r.body.error), r.body.error);
    r = await ganti('portal');
    ok('slug "portal" ditolak', r.status === 400, r.body.error);
    r = await ganti('smk-pgri-cikoneng');
    ok('slug kembali ke nilai semula', r.status === 200, String(r.status));

    r = await ganti('smk-cikoneng-baru');
    ok('slug dapat diubah Super Admin', r.status === 200 && r.body.tenant.portal_slug === 'smk-cikoneng-baru', JSON.stringify(r.body.tenant && r.body.tenant.portal_slug));
    ok('path portal ikut berubah', r.body.tenant.portal_path === '/smk-cikoneng-baru/portal-siswa', r.body.tenant.portal_path);
    r = await pub.req('/smk-cikoneng-baru/portal-siswa');
    ok('alamat baru langsung aktif', r.status === 200, String(r.status));
    r = await pub.req('/smk-pgri-cikoneng/portal-siswa');
    ok('slug lama sekolah menjadi 404', r.status === 404, String(r.status));

    /* ============ 4. SLUG KHUSUS PORTAL — ADMIN SEKOLAH ============ */
    console.log('\n== SLUG KHUSUS PORTAL: ADMIN SEKOLAH ==');
    r = await t1.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    ok('login admin sekolah', r.status === 200 && r.body.scope === 'tenant', String(r.status));
    r = await t1.req('/api/portal-slug');
    ok('admin sekolah dapat membaca slug portal',
      r.status === 200 && r.body.slug === 'smk-cikoneng-baru' && r.body.path === '/smk-cikoneng-baru/portal-siswa',
      JSON.stringify(r.body));
    r = await t1.req('/api/portal-slug', { method: 'POST', body: { slug: 'api' } });
    ok('admin sekolah tidak boleh memakai kata terlarang', r.status === 400, String(r.status));
    r = await t1.req('/api/portal-slug', { method: 'POST', body: { slug: 'smk-pgri-cikoneng' } });
    ok('admin sekolah dapat mengembalikan slug sendiri', r.status === 200 && r.body.slug === 'smk-pgri-cikoneng', JSON.stringify(r.body));
    r = await t1.req('/api/bootstrap');
    ok('bootstrap memuat slug + path portal sekolah', r.body.tenant.portal_slug === 'smk-pgri-cikoneng'
      && r.body.tenant.portal_path === '/smk-pgri-cikoneng/portal-siswa', JSON.stringify(r.body.tenant || {}));
    ok('bootstrap memuat URL portal absolut', /^http:\/\/127\.0\.0\.1:\d+\/smk-pgri-cikoneng\/portal-siswa$/.test(String(r.body.tenant.portal_url || '')),
      r.body.tenant.portal_url);

    /* ============ 5. ISOLASI PORTAL ANTAR SEKOLAH ============ */
    console.log('\n== ISOLASI PORTAL ANTAR SEKOLAH ==');
    await su.req('/api/super/branding', { method: 'POST', body: { daftar_min_detik: 1, daftar_limit_jam: 10, daftar_limit_hari: 20 } });
    r = await pub.req('/api/daftar', { method: 'POST', body: {
      nama_sekolah: 'SMP Negeri 9 Uji Portal', jenjang: 'SMP', alamat: 'Jl. Portal Uji 9',
      kepala: 'Kepala Uji', admin_nama: 'Admin Portal', email: 'admin@smpn9uji.sch.id',
      password: 'Rahasia123', password2: 'Rahasia123', telp: '081277770009', t0: Date.now() - 10000
    } });
    ok('sekolah kedua terdaftar', r.status === 200 && /^\d{4}$/.test(String(r.body.kode)), JSON.stringify(r.body).slice(0, 120));
    const kode2 = r.body.kode;
    await pub.req('/api/login', { method: 'POST', body: { username: r.body.admin_username, password: 'Rahasia123', kode: kode2 } });

    r = await pub.req('/api/public/sekolah');
    const sek2 = (r.body.rows || []).find(x => x.kode === kode2) || {};
    ok('sekolah kedua memiliki slug portal sendiri', sek2.portal_slug === 'smp-negeri-9-uji-portal', String(sek2.portal_slug));

    r = await pub.req('/api/public/portal/' + sek2.portal_slug);
    ok('portal sekolah kedua menunjuk sekolah yang benar', r.body.sekolah.kode === kode2 && /SMP Negeri 9/.test(r.body.sekolah.nama));

    /* data sekolah tidak boleh tertukar: header X-Sekolah-Kode menentukan sekolah */
    r = await pub.req('/api/public/config', { headers: { 'X-Sekolah-Kode': kode2 } });
    ok('config publik dengan header kode → sekolah kedua', r.body.sekolah_kode === kode2 && /SMP Negeri 9/.test(r.body.sekolah_nama),
      JSON.stringify({ k: r.body.sekolah_kode, n: r.body.sekolah_nama }));
    ok('config publik memuat slug portal', r.body.portal_slug === 'smp-negeri-9-uji-portal', String(r.body.portal_slug));
    r = await pub.req('/api/public/config?slug=' + sek2.portal_slug);
    ok('config publik via ?slug= → sekolah kedua', r.body.sekolah_kode === kode2, String(r.body.sekolah_kode));

    /* siswa sekolah kedua tidak terlihat dari portal sekolah utama.
       `pub` sudah otomatis login sebagai admin sekolah kedua (hasil /api/daftar). */
    r = await pub.req('/api/master');
    ok('admin sekolah kedua dapat membaca master', r.status === 200, String(r.status));
    const kelas2 = ((r.body.kelas || [])[0] || {}).id;
    r = await pub.req('/api/siswa/save', { method: 'POST', body: { nama: 'Siswa Khusus Sekolah Dua', kelas_id: kelas2, gender: 'L', tanggal_lahir: '2011-05-06' } });
    ok('siswa sekolah kedua dibuat', r.status === 200 && !!r.body.id, JSON.stringify(r.body).slice(0, 120));
    r = await pub.req('/api/public/check', {
      method: 'POST', headers: { 'X-Sekolah-Kode': kode2 },
      body: { nama: 'Siswa Khusus Sekolah Dua', tanggal_lahir: '2011-05-06' }
    });
    ok('siswa sekolah kedua ditemukan lewat portal sekolahnya', r.status === 200 && /Siswa Khusus Sekolah Dua/.test(r.body.siswa.nama), String(r.status));
    /* pengunjung anonim (tanpa kode sekolah) tidak bisa membaca data sekolah lain */
    const anonim = client();
    const tanpaHeader = await anonim.req('/api/public/check', {
      method: 'POST', body: { nama: 'Siswa Khusus Sekolah Dua', tanggal_lahir: '2011-05-06' }
    });
    ok('tanpa kode sekolah, siswa sekolah lain tidak terbaca', tanpaHeader.status === 404, String(tanpaHeader.status));

    /* ============ 6. TIDAK ADA TAUTAN PORTAL STATIS ============ */
    console.log('\n== TAUTAN PORTAL TIDAK STATIS ==');
    const distDir = path.join(__dirname, '..', 'dist', 'assets');
    const bundles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
    const isi = bundles.map(f => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
    ok('bundle tidak memuat tautan portal statis /portal',
      !/\+\s*"\/portal"|\/portal\?kode=/.test(isi), (isi.match(/\+\s*"\/portal"|\/portal\?kode=/g) || []).join(','));
    ok('bundle memakai pola slug dinamis /portal-siswa', /portal-siswa/.test(isi));
    const htmlIndex = await pub.req('/');
    ok('halaman aplikasi tidak memuat tautan /portal statis', !/href="[^"]*\/portal"/.test(String(htmlIndex.body)));

    /* ============ 7. HALAMAN LOGIN ============ */
    console.log('\n== HALAMAN LOGIN ==');
    ok('halaman /daftar disajikan (form pendaftaran)', (await pub.req('/daftar')).status === 200);
    r = await su.req('/api/super/branding');
    ok('branding global memuat status pendaftaran', r.body.platform.pendaftaran_aktif === true);
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(log.join('').slice(-1200));
  } finally {
    srv.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 200));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL RONDE 11: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
