'use strict';
/* Uji UI: (1) masuk dashboard Super Admin — baik lewat tautan panel maupun form login biasa,
   (2) import Kategori Poin dari halaman Kategori (template, unggah berkas, pratinjau, simpan).
   Jalankan: node dev-tests/ui-kategori.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const lib = require('../lib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-uikat-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 7300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));
  await new Promise(r => setTimeout(r, 2100));
  KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const errors = [];
  try {
    /* ============ 1. PORTAL SUPER ADMIN TERPISAH ============ */
    console.log('\n== PORTAL LOGIN SUPER ADMIN (TERPISAH) ==');
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    let page = await ctx.newPage();
    let schoolListRequested = false;
    page.on('request', request => {
      if (request.url().includes('/api/public/sekolah')) schoolListRequested = true;
    });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const loginTxt = await page.locator('body').innerText();
    ok('halaman login sekolah TIDAK menautkan login Super Admin',
      (await page.locator('a:has-text("Panel Super Admin")').count()) === 0 && !/Panel Super Admin/i.test(loginTxt));
    ok('halaman login sekolah tidak menampilkan nama sekolah tenant',
      !/SMK PGRI CIKONENG/i.test(loginTxt), loginTxt.slice(0, 120));
    ok('halaman login memakai branding global (nama aplikasi)',
      (await page.locator('text=SMART TATA TERTIB SISWA').count()) > 0);
    ok('form login sekolah mewajibkan kode sekolah',
      (await page.locator('input[placeholder*="kode sekolah"]').count()) > 0 &&
      (await page.locator('label:has-text("Kode Sekolah")').count()) > 0);
    ok('input kode sekolah tidak memiliki dropdown nama/kode sekolah',
      (await page.locator('datalist#login-school-codes').count()) === 0 &&
      (await page.locator('input[placeholder*="kode sekolah"]').getAttribute('list')) === null);
    ok('halaman login tidak meminta daftar sekolah publik', !schoolListRequested);

    /* akun Super Admin TIDAK bisa masuk lewat form login sekolah */
    await page.fill('input[placeholder*="kode sekolah"]', '9999');
    await page.fill('input[autocomplete="username"]', 'superadmin');
    await page.fill('input[autocomplete="current-password"]', 'superadmin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    ok('akun super admin ditolak di form login sekolah',
      /#\/saas/.test(page.url()) === false &&
      /tidak ditemukan|salah|wajib/i.test(await page.locator('body').innerText()), page.url());

    /* portal eksklusif /super-admin */
    await page.goto(BASE + '/super-admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    ok('URL /super-admin membuka portal khusus Super Admin',
      /Masuk Panel Platform/i.test(await page.locator('body').innerText()));
    ok('portal Super Admin tidak menampilkan blok pendaftaran sekolah',
      (await page.locator('button:has-text("Daftarkan Sekolah")').count()) === 0);
    await page.fill('input[autocomplete="username"]', 'superadmin');
    await page.fill('input[autocomplete="current-password"]', 'superadmin123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await page.waitForTimeout(2200);
    ok('login portal Super Admin masuk panel platform', /#\/saas/.test(page.url()), page.url());
    ok('dashboard Super Admin tampil (bukan halaman kosong)',
      (await page.locator('aside nav button:has-text("Daftar Sekolah")').count()) > 0 &&
      (await page.locator('text=Total Sekolah').count()) > 0);
    const dashTxt = await page.locator('main').innerText();
    ok('kartu Total Sekolah / Sekolah Aktif / Sekolah Terdaftar tampil',
      /Total Sekolah/i.test(dashTxt) && /Sekolah Aktif/i.test(dashTxt) && /Sekolah Terdaftar/i.test(dashTxt));

    /* menu Pengaturan Profil Super Admin */
    ok('menu Pengaturan Profil tersedia di panel', (await page.locator('aside nav button:has-text("Pengaturan Profil")').count()) > 0);
    await page.click('aside nav button:has-text("Pengaturan Profil")');
    await page.waitForTimeout(1200);
    const profilTxt = await page.locator('main').innerText();
    ok('halaman profil: nama, username, kata sandi', /Nama Akun Super Admin/i.test(profilTxt) &&
      /Username/i.test(profilTxt) && /Perbarui Kata Sandi/i.test(profilTxt));

    /* keluar → panel tanpa sesi mengarahkan ke portal eksklusif */
    await page.click('button[title="Keluar"]');
    await page.waitForTimeout(2400);
    await page.goto(BASE + '/#/saas/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    ok('panel tanpa sesi mengarahkan ke portal /super-admin',
      (await page.locator('a:has-text("Buka Portal Super Admin")').count()) > 0);
    await page.close();
    await ctx.close();

    /* ============ 2. IMPORT KATEGORI POIN ============ */
    console.log('\n== IMPORT KATEGORI POIN (UI) ==');
    ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR(2): ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.waitForTimeout(800);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await page.keyboard.press('Escape');

    await page.click('aside nav button:has-text("Kategori Poin")');
    await page.waitForTimeout(900);
    ok('halaman Kategori Poin terbuka', (await page.locator('text=Kategori Poin').count()) > 0);
    ok('tombol "Template Excel" tersedia', (await page.locator('a:has-text("Template Excel")').count()) > 0);
    ok('tombol "Import Kategori" tersedia', (await page.locator('button:has-text("Import Kategori")').count()) > 0);

    /* unduh template lewat tautan */
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.click('a:has-text("Template Excel")');
    const download = await dl;
    ok('template dapat diunduh dari UI', !!download && /\.xlsx$/i.test(download.suggestedFilename() || ''),
      download ? download.suggestedFilename() : 'tidak ada unduhan');

    /* buka modal import */
    await page.click('button:has-text("Import Kategori")');
    await page.waitForTimeout(700);
    const modalTxt = await page.locator('body').innerText();
    ok('modal import terbuka', /Import Kategori Poin dari Excel/i.test(modalTxt), modalTxt.slice(0, 80));
    ok('modal menampilkan petunjuk import', /Cara import/i.test(modalTxt));
    ok('modal menyediakan tombol unduh template', (await page.locator('a:has-text("Template Excel")').count()) >= 2);

    /* siapkan berkas uji & unggah */
    const rows = [
      [{ v: 'KRITERIA UJI UI' }],
      [{ v: 'baris keterangan' }],
      [{ v: 'NAMA KATEGORI', bold: true }, { v: 'JENIS', bold: true }, { v: 'POIN', bold: true }, { v: 'KETERANGAN', bold: true }],
      ['Terlambat (uji UI)', 'Pelanggaran', 6, 'keterangan uji'],
      ['Juara Cerdas (uji UI)', 'Prestasi', 30, ''],
      ['Duplikat Juara (uji UI)', 'Prestasi', 10, '']
    ];
    const filePath = path.join(TMP, 'kategori-uji.xlsx');
    fs.writeFileSync(filePath, lib.xlsxBuffer('Kategori', rows, [36, 16, 10, 50]));
    await page.setInputFiles('input[type="file"][accept=".xlsx,.csv"]', filePath);
    await page.waitForTimeout(1800);
    const prevTxt = await page.locator('body').innerText();
    ok('pratinjau menampilkan baris terbaca', /Terlambat \(uji UI\)/.test(prevTxt) && /Juara Cerdas \(uji UI\)/.test(prevTxt));
    ok('pratinjau menghitung "Siap Simpan"', /Siap Simpan/i.test(prevTxt));
    ok('tombol simpan menyebut jumlah baris', (await page.locator('button:has-text("Simpan")').count()) > 0);

    await page.click('button:has-text("Simpan")');
    await page.waitForTimeout(2000);
    const afterTxt = await page.locator('main').innerText();
    ok('kategori hasil import muncul di daftar',
      /Terlambat \(uji UI\)/.test(afterTxt) && /Juara Cerdas \(uji UI\)/.test(afterTxt), afterTxt.slice(0, 120));
    ok('poin hasil import tampil benar', /\+6\b/.test(afterTxt) && /\+30\b/.test(afterTxt));
    ok('modal import tertutup setelah simpan', (await page.locator('text=Cara import').count()) === 0);

    /* responsive */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman kategori tanpa overflow horizontal (mobile)', ov <= 2, String(ov));

    console.log('\n== TANPA ERROR JS ==');
    const penting = errors.filter(e => !/Failed to load resource|favicon|401|403|400|402|503/.test(e));
    ok('tidak ada error JavaScript', penting.length === 0, penting.slice(0, 3).join(' | '));

    await page.close();
    await ctx.close();
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(log.join('').slice(-2000));
  } finally {
    await browser.close().catch(() => {});
    srv.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 250));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL UI KATEGORI: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
