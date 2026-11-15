'use strict';
/* Uji UI ronde 9 (Playwright): portal Super Admin eksklusif, login sekolah wajib kode,
   proteksi anti-spam pendaftaran, dan branding global yang langsung ter-render.
   Jalankan: node dev-tests/ui-round9.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-ui9-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 7600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

function apiClient() {
  let cookie = '';
  return {
    async req(p, options = {}) {
      const response = await fetch(BASE + p, {
        method: options.method || 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
      return { status: response.status, body: await response.json().catch(() => null) };
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
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) break; } catch (e) { /* belum siap */ }
    await new Promise(r => setTimeout(r, 250));
  }
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const errors = [];
  try {
    await otpTest.configure(apiClient(), gateway.url);
    /* ================= 1. HALAMAN LOGIN SEKOLAH ================= */
    console.log('\n== HALAMAN LOGIN SEKOLAH (BRANDING GLOBAL) ==');
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/401|403|404|429/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    const body = await page.locator('body').innerText();
    ok('judul tab memakai branding global', /SMART TATA TERTIB SISWA/i.test(await page.title()), await page.title());
    ok('tidak ada tautan login Super Admin di halaman sekolah',
      (await page.locator('a:has-text("Panel Super Admin")').count()) === 0 && !/Panel Super Admin/i.test(body));
    ok('tidak menampilkan nama/alamat sekolah tenant', !/SMK PGRI/i.test(body) && !/Cikoneng/i.test(body), body.slice(0, 100));
    ok('judul & subjudul login dari branding global',
      (await page.locator('h1:has-text("SMART TATA TERTIB SISWA")').count()) > 0 &&
      /Sistem Manajemen Kedisiplinan/i.test(body));
    ok('hak cipta bawah form tersedia', /©/.test(body));
    ok('label Kode Sekolah wajib tampil', (await page.locator('label:has-text("Kode Sekolah")').count()) > 0);
    ok('tautan "Daftarkan sekolah Anda" tersedia', (await page.locator('a[data-daftar-link]').count()) > 0);

    /* kode wajib: submit tanpa kode → pesan kesalahan, tidak login */
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(900);
    const masihLogin = await page.locator('body').innerText();
    ok('login tanpa kode dicegah (kode wajib)',
      /Masuk ke Dashboard Sekolah/i.test(masihLogin) && !/Distribusi Status Disiplin/i.test(masihLogin),
      masihLogin.slice(0, 80));

    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.waitForTimeout(800);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await page.keyboard.press('Escape');
    ok('login dengan kode sekolah berhasil masuk dashboard', (await page.locator('aside nav button').count()) >= 10);
    ok('header dashboard memakai nama aplikasi global',
      /SMART TATA TERTIB SISWA/i.test(await page.locator('header').first().innerText()));
    await page.close();
    await ctx.close();

    /* ================= 2. PENDAFTARAN + ANTI-SPAM ================= */
    console.log('\n== PENDAFTARAN SEKOLAH & ANTI-SPAM ==');
    ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR2: ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.click('a[data-daftar-link]');
    await page.waitForTimeout(600);
    ok('form pendaftaran terbuka', (await page.locator('text=Form Pendaftaran Sekolah').count()) > 0);
    const honeypot = page.locator('input[name="website"]');
    ok('honeypot tersembunyi tersedia di form', (await honeypot.count()) === 1);
    const box = honeypot.first();
    const bb = await box.boundingBox();
    ok('honeypot berada di luar area layar', !bb || bb.x < 0 || bb.width === 0, JSON.stringify(bb));

    await page.fill('input[placeholder*="SMP Negeri"]', 'SMA Uji Anti Spam');
    await page.selectOption('select', 'SMA');
    await page.fill('textarea', 'Jl. Uji No. 1');
    await page.fill('input[placeholder="admin@sekolah.sch.id"]', 'admin@ujiantispam.sch.id');
    await page.fill('input[placeholder="0812xxxxxxx"]', '081299990001');
    await page.locator('input[type="password"]').nth(0).fill('Rahasia123');
    await page.locator('input[type="password"]').nth(1).fill('Rahasia123');
    await page.locator('label:has-text("Nama Admin") + div input, label:has-text("Nama Admin") ~ div input').first().fill('Admin Uji').catch(() => {});
    ok('pendaftaran belum dapat dikirim sebelum OTP diisi',
      await page.locator('button:has-text("Coba Gratis")').isDisabled());
    await page.waitForTimeout(4800);
    gateway.clearCode();
    await page.click('button:has-text("Kirim Kode OTP WhatsApp")');
    await page.fill('input[placeholder="000000"]', await gateway.waitForCode());
    await page.click('button:has-text("Coba Gratis")');
    await page.waitForTimeout(800);
    ok('pendaftaran berhasil setelah OTP dan waktu isi wajar',
      /Pendaftaran Berhasil/i.test(await page.locator('body').innerText()),
      (await page.locator('body').innerText()).slice(0, 120));
    await page.waitForTimeout(2800);
    ok('pratinjau hasil pendaftaran tidak dialihkan otomatis ke dashboard',
      /Pendaftaran Berhasil/i.test(await page.locator('body').innerText()) &&
      (await page.locator('aside nav button').count()) === 0, page.url());
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('[data-ke-dashboard]')
    ]);
    await page.waitForTimeout(2000);
    ok('tombol pratinjau membuka dashboard sekolah baru', (await page.locator('aside nav button').count()) >= 8);
    await page.close();
    await ctx.close();

    /* ================= 3. PORTAL SUPER ADMIN EKSKLUSIF ================= */
    console.log('\n== PORTAL SUPER ADMIN EKSKLUSIF ==');
    ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR3: ' + e.message));
    await page.goto(BASE + '/super-admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const spTxt = await page.locator('body').innerText();
    ok('URL /super-admin membuka portal khusus', /Masuk Panel Platform/i.test(spTxt));
    ok('portal super tanpa blok pendaftaran sekolah',
      (await page.locator('a[data-daftar-link]').count()) === 0 && !/Daftarkan Sekolah/i.test(spTxt));
    ok('tampilan portal super berbeda (tema gelap)', await page.evaluate(() => {
      const el = document.querySelector('div[class*="bg-slate-950"]');
      return !!el;
    }));
    await page.fill('input[autocomplete="username"]', 'superadmin');
    await page.fill('input[autocomplete="current-password"]', 'superadmin123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await page.waitForTimeout(2200);
    ok('masuk panel platform lewat portal eksklusif', /#\/saas/.test(page.url()), page.url());

    /* menu Pengaturan Profil */
    ok('menu "Pengaturan Profil" ada', (await page.locator('aside nav button:has-text("Pengaturan Profil")').count()) > 0);
    await page.click('aside nav button:has-text("Pengaturan Profil")');
    await page.waitForTimeout(1200);
    ok('form profil: nama & username dapat diubah',
      (await page.locator('text=Nama Akun Super Admin').count()) > 0 &&
      (await page.locator('input[value="superadmin"]').count()) > 0);
    ok('form profil: bagian kata sandi tersedia', (await page.locator('text=Perbarui Kata Sandi').count()) > 0);
    const namaBaru = 'Administrator Platform Uji';
    await page.fill('input[placeholder="mis. Administrator Platform"]', namaBaru);
    await page.click('button:has-text("Simpan Profil")');
    await page.waitForTimeout(1400);
    ok('nama baru tersimpan & tampil di header', /Administrator Platform Uji/.test(await page.locator('header').first().innerText()),
      (await page.locator('header').first().innerText()).slice(0, 120));

    /* ================= 4. BRANDING GLOBAL DISEBARKAN ================= */
    console.log('\n== BRANDING SISTEM DISEBARKAN KE SEMUA HALAMAN ==');
    await page.click('aside nav button:has-text("Branding Sistem")');
    await page.waitForTimeout(900);
    ok('form branding memuat teks halaman login', (await page.locator('text=Tampilan Halaman Login Utama').count()) > 0);
    ok('form branding memuat proteksi anti-spam', (await page.locator('text=Proteksi Anti-Spam').count()) > 0);

    /* ---- regresi: sakelar "Pendaftaran Mandiri" harus benar-benar tersimpan ---- */
    const selectDaftar = page.locator('select').filter({ has: page.locator('option[value="0"]') }).first();
    const setDaftar = async (v) => {
      // pilih select "Pendaftaran Mandiri" (opsi Dibuka=1 / Ditutup=0)
      const opts = await selectDaftar.locator('option').allInnerTexts();
      const target = opts.find(o => v === '1' ? /Dibuka/i.test(o) : /Ditutup/i.test(o));
      await selectDaftar.selectOption({ label: target });
    };
    await setDaftar('1');
    await page.click('button:has-text("Simpan Branding Sistem")');
    await page.waitForTimeout(1800);
    const nilaiSetelahSimpan = await page.locator('select').filter({ has: page.locator('option[value="0"]') }).first()
      .evaluate(el => el.options[el.selectedIndex].text).catch(() => '');
    ok('pilihan "Dibuka" tetap tersimpan setelah Simpan (dulu kembali Ditutup)',
      /Dibuka/i.test(nilaiSetelahSimpan), nilaiSetelahSimpan);

    /* muat ulang halaman → nilai harus tetap Dibuka (dibaca dari database) */
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.click('aside nav button:has-text("Branding Sistem")');
    await page.waitForTimeout(1200);
    const optsReload = await page.locator('select').filter({ has: page.locator('option[value="0"]') }).first().locator('option').allInnerTexts();
    const selected = await page.locator('select').filter({ has: page.locator('option[value="0"]') }).first()
      .evaluate(el => el.options[el.selectedIndex].text).catch(() => '');
    ok('setelah reload, Pendaftaran Mandiri masih "Dibuka"', /Dibuka/i.test(selected), `${selected} | ${optsReload.join(',')}`);
    ok('badge Status Branding menampilkan Dibuka', /Dibuka/.test(await page.locator('body').innerText()));
    const judulBaru = 'Platform Disiplin UI Uji';
    await page.fill('input[placeholder="(ikut nama aplikasi)"]', judulBaru);
    await page.fill('input[placeholder="(ikut subjudul aplikasi)"]', 'Subjudul UI Uji');
    await page.fill('textarea', 'Deskripsi login dari UI uji.');
    await page.click('button:has-text("Simpan Branding Sistem")');
    await page.waitForTimeout(1600);
    ok('judul tab panel langsung mengikuti branding baru', /Platform Disiplin UI Uji/.test(await page.title()), await page.title());
    const favHref = await page.evaluate(() => (document.getElementById('app-favicon') || {}).getAttribute
      ? document.getElementById('app-favicon').getAttribute('href') : '');
    ok('favicon memakai parameter versi branding', /\?v=/.test(favHref), favHref);
    await page.close();
    await ctx.close();

    /* halaman login sekolah ikut berubah (tanpa nama sekolah) */
    ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
    const loginTxt = await page.locator('body').innerText();
    ok('judul login baru tampil di halaman sekolah', /Platform Disiplin UI Uji/i.test(loginTxt), loginTxt.slice(0, 120));
    ok('subjudul baru tampil', /Subjudul UI Uji/i.test(loginTxt));
    ok('deskripsi login dari branding', /Deskripsi login dari UI uji/i.test(loginTxt));
    ok('judul tab login mengikuti branding', /Platform Disiplin UI Uji/.test(await page.title()), await page.title());
    ok('halaman login tetap tanpa identitas sekolah', !/SMK PGRI/i.test(loginTxt));

    /* ================= 5. MOBILE ================= */
    console.log('\n== MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman login mobile tanpa overflow horizontal', ov <= 2, String(ov));
    await page.close();
    await ctx.close();

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
    await gateway.close().catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL UI RONDE 9: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
