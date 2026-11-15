'use strict';
/* Uji UI ronde 11 (Playwright):
   - halaman login: TANPA tautan "Cek Poin Siswa tanpa login", ADA tautan
     "Belum punya akun sekolah? Daftarkan sekolah Anda" → form pendaftaran
   - portal publik per sekolah: /<slug>/portal-siswa bekerja, /portal → 404
   - tautan Portal Siswa di dashboard & sidebar mengikuti slug sekolah
   - slug diubah admin sekolah → tautan & portal ikut berubah, slug lama 404
   Jalankan: node dev-tests/ui-round11.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-ui11-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 7900 + Math.floor(Math.random() * 250);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) break; } catch (e) { /* belum siap */ }
    await new Promise(r => setTimeout(r, 250));
  }
  const sek0 = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows || [])[0] || {};
  const KODE = sek0.kode;
  const PSLUG = sek0.portal_slug;

  const browser = await chromium.launch();
  const errors = [];
  try {
    /* ================= 1. HALAMAN LOGIN ================= */
    console.log('\n== HALAMAN LOGIN ==');
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/401|403|404|429/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    let txt = await page.locator('body').innerText();

    ok('tautan "Cek Poin Siswa tanpa login" DIHAPUS dari halaman login',
      !/Cek Poin Siswa tanpa login/i.test(txt) && (await page.locator('a:has-text("Cek Poin")').count()) === 0);
    ok('ada kalimat "Belum punya akun sekolah? Daftarkan sekolah Anda"',
      /Belum punya akun sekolah\?/i.test(txt) && /Daftarkan sekolah Anda/i.test(txt));
    const daftarLink = page.locator('a[data-daftar-link]');
    ok('kalimat tersebut berupa tautan interaktif', (await daftarLink.count()) === 1);
    ok('tautan mengarah ke halaman pendaftaran', /\/daftar$/.test(await daftarLink.first().getAttribute('href') || ''),
      await daftarLink.first().getAttribute('href'));

    await daftarLink.first().click();
    await page.waitForTimeout(700);
    ok('tautan membuka formulir pendaftaran sekolah',
      /Form Pendaftaran Sekolah/i.test(await page.locator('body').innerText()));
    ok('URL berubah menjadi /daftar', /\/daftar$/.test(new URL(page.url()).pathname), page.url());

    /* URL /daftar dapat dibuka langsung (deep link) */
    await page.goto(BASE + '/daftar', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    ok('URL /daftar dibuka langsung menampilkan formulir', /Form Pendaftaran Sekolah/i.test(await page.locator('body').innerText()));
    await page.click('button:has-text("Kembali")');
    await page.waitForTimeout(700);
    ok('tombol kembali mengembalikan ke form login',
      /Masuk ke Dashboard Sekolah/i.test(await page.locator('body').innerText()));

    /* ================= 2. LOGIN & TAUTAN PORTAL DINAMIS ================= */
    console.log('\n== LOGIN SEKOLAH & TAUTAN PORTAL DINAMIS ==');
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.waitForTimeout(900);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await page.keyboard.press('Escape');

    const dashPortal = page.locator('a:has-text("Portal Siswa")').first();
    ok('tombol "Portal Siswa" ada di dashboard', (await dashPortal.count()) > 0);
    const hrefDash = await dashPortal.getAttribute('href');
    ok('tombol dashboard memakai slug sekolah (bukan /portal statis)',
      hrefDash === '/' + PSLUG + '/portal-siswa', hrefDash);

    const sidebarPortal = page.locator('aside a:has-text("Buka Portal")').first();
    ok('tautan portal di sidebar ada', (await sidebarPortal.count()) > 0);
    ok('tautan sidebar memakai slug sekolah', (await sidebarPortal.getAttribute('href')) === '/' + PSLUG + '/portal-siswa',
      await sidebarPortal.getAttribute('href'));
    ok('sidebar menampilkan path portal sekolah', (await page.locator('aside').innerText()).includes('/' + PSLUG + '/portal-siswa'));

    /* ================= 3. PORTAL PUBLIK ================= */
    console.log('\n== PORTAL PUBLIK PER SEKOLAH ==');
    await page.close(); await ctx.close();
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PORTAL: ' + e.message));

    const respPortal = await page.goto(BASE + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    ok('portal sekolah terbuka (200)', respPortal.status() === 200, String(respPortal.status()));
    txt = await page.locator('body').innerText();
    ok('portal menampilkan nama sekolah pemilik slug', /SMK PGRI CIKONENG/i.test(txt), txt.slice(0, 80));
    ok('portal menampilkan judul portal dari pengaturan sekolah', /Cek Poin/i.test(txt));

    /* alamat lama → 404 */
    const r404 = await page.goto(BASE + '/portal', { waitUntil: 'networkidle' });
    ok('/portal sekarang 404', r404.status() === 404, String(r404.status()));
    ok('halaman 404 menjelaskan alamat baru', /portal-siswa/.test(await page.locator('body').innerText()));
    const r404b = await page.goto(BASE + '/portal?kode=' + KODE, { waitUntil: 'networkidle' });
    ok('/portal?kode=… juga 404', r404b.status() === 404, String(r404b.status()));
    const r404c = await page.goto(BASE + '/sekolah-ngawur/portal-siswa', { waitUntil: 'networkidle' });
    ok('slug sekolah tidak dikenal → 404', r404c.status() === 404, String(r404c.status()));
    await page.close(); await ctx.close();

    /* ================= 4. UBAH SLUG DARI PENGATURAN SEKOLAH ================= */
    console.log('\n== UBAH SLUG (ADMIN SEKOLAH) ==');
    ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR2: ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.waitForTimeout(800);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await page.keyboard.press('Escape');

    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(900);
    await page.click('button[role="tab"]:has-text("Branding Aplikasi"), .tab:has-text("Branding Aplikasi")').catch(() => {});
    await page.waitForTimeout(600);
    const slugInput = page.locator('[data-portal-slug]').first();
    ok('form "Slug Khusus Portal Sekolah" tersedia di Pengaturan',
      (await slugInput.count()) > 0 && /Slug Khusus Portal Sekolah/i.test(await page.locator('body').innerText()));
    ok('slug saat ini terisi otomatis', (await slugInput.inputValue()) === PSLUG, await slugInput.inputValue());
    const urlShown = await page.locator('[data-portal-url]').first().innerText();
    ok('tautan portal ditampilkan lengkap', new RegExp('/' + PSLUG + '/portal-siswa').test(urlShown), urlShown);

    await slugInput.fill('sekolah-contoh-ubah');
    await page.click('button:has-text("Simpan Slug")');
    await page.waitForTimeout(1600);
    ok('slug baru tersimpan', /sekolah-contoh-ubah/.test(await page.locator('[data-portal-url]').first().innerText()),
      await page.locator('[data-portal-url]').first().innerText());

    /* tautan sidebar ikut berubah tanpa logout */
    ok('tautan sidebar otomatis mengikuti slug baru',
      (await page.locator('aside a:has-text("Buka Portal")').first().getAttribute('href')) === '/sekolah-contoh-ubah/portal-siswa',
      await page.locator('aside a:has-text("Buka Portal")').first().getAttribute('href'));

    /* slug baru hidup, slug lama mati */
    await page.close(); await ctx.close();
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await ctx.newPage();
    const rBaru = await page.goto(BASE + '/sekolah-contoh-ubah/portal-siswa', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    ok('alamat portal baru berfungsi', rBaru.status() === 200 && /SMK PGRI CIKONENG/i.test(await page.locator('body').innerText()),
      String(rBaru.status()));
    const rLama = await page.goto(BASE + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
    ok('alamat portal lama menjadi 404', rLama.status() === 404, String(rLama.status()));
    await page.close(); await ctx.close();

    /* ================= 5. MOBILE ================= */
    console.log('\n== MOBILE 390px ==');
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await page.goto(BASE + '/sekolah-contoh-ubah/portal-siswa', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    let ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('portal mobile tanpa overflow horizontal', ov <= 2, String(ov));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman login mobile tanpa overflow horizontal', ov <= 2, String(ov));
    await page.close(); await ctx.close();

    console.log('\n== TANPA ERROR JS ==');
    const penting = errors.filter(e => !/Failed to load resource|favicon|401|403|404|429|503/.test(e));
    ok('tidak ada error JavaScript', penting.length === 0, penting.slice(0, 3).join(' | '));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(log.join('').slice(-1500));
  } finally {
    await browser.close().catch(() => {});
    srv.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 250));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL UI RONDE 11: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
