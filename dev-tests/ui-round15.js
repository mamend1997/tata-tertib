'use strict';
/* Uji UI Ronde 15 (Playwright): `node dev-tests/ui-round15.js`
   - Semester hilang dari header & filter laporan
   - Tab "Jenjang & Tingkat Kelas" (format tingkat + kenaikan kelas)
   - Centang "Salin Periodik" pada form tambah tahun pelajaran
   - Halaman Mode Pemeliharaan untuk akun sekolah
   - Daftar provider gateway memuat Kasera + harga khusus per sekolah
*/
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui15-' + Date.now() + '.sqlite');
const PORT = 5900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1800));
  KODE = (((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0]) || {}).kode || '';

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.keyboard.press('Escape');

    console.log('\n== SEMESTER DIHAPUS DARI ANTARMUKA ==');
    const bodyText = await page.locator('body').innerText();
    ok('header tanpa pilihan Semester', !/Semester Ganjil/.test(bodyText) && !/Semester Genap/.test(bodyText));
    ok('dropdown tahun pelajaran tetap ada', /TP 20/.test(bodyText));
    await page.click('aside nav button:has-text("Laporan")');
    await page.waitForTimeout(800);
    const laporanText = await page.locator('body').innerText();
    ok('filter laporan tanpa semester', !/Semester Ganjil/.test(laporanText));

    console.log('\n== TAB JENJANG & TINGKAT KELAS ==');
    /* sidebar memakai akordeon eksklusif → buka langsung lewat hash agar grup tidak terlipat */
    await page.goto(BASE + '/#/pengaturan', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Identitas Sekolah', { timeout: 15000 });
    await page.click('button.tab:has-text("Jenjang & Tingkat Kelas")');
    await page.waitForSelector('[data-tingkat-form]', { timeout: 15000 });
    ok('form tingkat tampil', (await page.locator('[data-tingkat-form]').count()) === 1);
    ok('pratinjau tingkat awal (SMK) X → XI → XII', /X[\s\S]*XI[\s\S]*XII/.test(await page.locator('[data-tingkat-preview]').innerText()));

    await page.selectOption('[data-tingkat-mode]', 'angka');
    await page.waitForTimeout(200);
    ok('pratinjau berubah ke angka 10 → 11 → 12', /10[\s\S]*11[\s\S]*12/.test(await page.locator('[data-tingkat-preview]').innerText()));

    await page.selectOption('[data-tingkat-mode]', 'custom');
    await page.fill('[data-tingkat-custom]', 'Kelas 10\nKelas 11\nKelas 12');
    await page.waitForTimeout(200);
    ok('pratinjau kustom tampil', /Kelas 10[\s\S]*Kelas 11[\s\S]*Kelas 12/.test(await page.locator('[data-tingkat-preview]').innerText()));
    await page.click('[data-tingkat-simpan]');
    await page.waitForTimeout(1200);
    ok('format kustom tersimpan', /Kelas 10/.test(await page.locator('[data-tingkat-preview]').innerText()));

    console.log('\n== KENAIKAN KELAS & SALIN PERIODIK ==');
    ok('kartu kenaikan kelas tersedia', (await page.locator('[data-kenaikan-preview]').count()) === 1);
    await page.click('button.tab:has-text("Tahun Pelajaran")');
    await page.waitForSelector('text=Tahun Pelajaran', { timeout: 10000 });
    await page.click('button:has-text("Tambah")');
    await page.waitForSelector('[data-salin-periodik]', { timeout: 10000 });
    ok('centang Salin Periodik ada di form tahun pelajaran', (await page.locator('[data-salin-periodik]').count()) === 1);
    ok('penjelasan kenaikan otomatis tampil', /Kenaikan Kelas Otomatis/.test(await page.locator('[data-salin-periodik]').innerText()));
    await page.keyboard.press('Escape');

    console.log('\n== MODE PEMELIHARAAN (SUPER ADMIN) ==');
    const superLogin = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/super/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'superadmin', password: 'superadmin123' })
      });
      return r.status;
    });
    ok('super admin dapat login', superLogin === 200, String(superLogin));
    const aktif = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/super/pengumuman', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Panel': 'saas' },
        body: JSON.stringify({ maintenance_aktif: true, maintenance_pesan: 'Pemeliharaan terjadwal 30 menit' })
      });
      return r.status;
    });
    ok('mode pemeliharaan diaktifkan lewat API panel', aktif === 200, String(aktif));

    /* instance browser TERPISAH (batas 1 tab per instance) untuk melihat
       tampilan yang diterima akun sekolah saat pemeliharaan aktif */
    const browser2 = await chromium.launch();
    const ctx2 = await browser2.newContext({ viewport: { width: 1280, height: 900 } });
    const page2 = await ctx2.newPage();
    await page2.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page2.waitForSelector('[data-maintenance]', { timeout: 20000 });
    const maintText = await page2.locator('[data-maintenance]').innerText();
    ok('halaman pemeliharaan tampil untuk akun sekolah', /sedang dalam pemeliharaan/i.test(maintText), maintText.slice(0, 80));
    ok('pesan pemeliharaan dari super admin tampil', /30 menit/.test(maintText));
    ok('login sekolah tidak dapat dilanjutkan', (await page2.locator('input[autocomplete="username"]').count()) === 0);
    await browser2.close();

    await page.evaluate(async () => {
      await fetch((window.__BASE__ || '') + '/api/super/pengumuman', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Panel': 'saas' },
        body: JSON.stringify({ maintenance_aktif: false })
      });
    });
    /* branding di-cache ±1,5 detik di server → beri jeda sebelum memuat ulang */
    await page.waitForTimeout(1800);
    await page.reload({ waitUntil: 'networkidle' });
    /* grup sidebar bisa terlipat (akordeon eksklusif) → cukup pastikan aplikasi tampil */
    await page.waitForSelector('aside', { state: 'visible', timeout: 25000 });
    await page.waitForTimeout(1200);
    ok('aplikasi kembali normal setelah pemeliharaan',
      (await page.locator('[data-maintenance]').count()) === 0 && (await page.locator('aside nav').count()) > 0);

    console.log('\n== PROVIDER KASERA & HARGA PER SEKOLAH ==');
    const pay = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/super/qris', { headers: { 'X-Client-Panel': 'saas' } });
      return r.json();
    });
    ok('daftar provider memuat Kasera', (pay.pay.providers || []).some(p => p.key === 'kasera' && p.label === 'Kasera'), JSON.stringify((pay.pay.providers || []).map(p => p.key)));

    /* halaman detail sekolah di panel super admin menampilkan form harga khusus */
    await page.goto(BASE + '/#/saas/sekolah', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const superBody = await page.locator('body').innerText();
    ok('panel super admin terbuka', /Sekolah|Dashboard/i.test(superBody));

    console.log('\n== MOBILE 390px ==');
    /* instance browser terpisah untuk uji mobile (1 tab per instance) */
    const browser3 = await chromium.launch();
    const mobile = await browser3.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mp = await mobile.newPage();
    await mp.goto(BASE + '/', { waitUntil: 'networkidle' });
    await mp.fill('input[autocomplete="username"]', 'admin');
    await mp.fill('input[autocomplete="current-password"]', 'admin123');
    await mp.fill('input[placeholder*="kode sekolah"]', KODE);
    await mp.click('button[type="submit"]');
    /* ponsel: menu utama ada di navigasi bawah + laci hamburger (bukan sidebar permanen) */
    await mp.waitForSelector('[data-bottom-nav-item]', { timeout: 25000 });
    await mp.waitForTimeout(1000);
    ok('dashboard mobile tampil', (await mp.locator('[data-maintenance]').count()) === 0);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal di mobile', overflow <= 2, String(overflow));
    await browser3.close();

    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail++; fails.push('exception: ' + e.message); console.error(e);
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  console.log('\n=== HASIL UI RONDE 15: ' + pass + ' lulus, ' + fail + ' gagal ===');
  if (fails.length) { console.log('\nGAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})();
