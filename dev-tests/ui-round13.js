'use strict';
/* Uji UI pembayaran hybrid (Playwright): `node dev-tests/ui-round13.js`
   1. Panel Super Admin: sakelar QRIS otomatis & QRIS manual
   2. Sekolah: dua metode berdampingan, QRIS dinamis dapat dibuat,
      status pembayaran dapat diperiksa & disimulasikan lunas. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui13-' + Date.now() + '.sqlite');
const PORT = 5640 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

async function api(p, opts = {}, jar = { cookie: '' }) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(jar.cookie ? { Cookie: jar.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) jar.cookie = sc.map(c => c.split(';')[0]).join('; ');
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, APP_TIMEZONE: 'Asia/Jakarta' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2000));

  const jarSuper = { cookie: '' };
  const jarAdmin = { cookie: '' };
  let KODE2 = '';
  let errorTenant = '';

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1460, height: 980 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  try {
    /* siapkan data lewat API */
    await api('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } }, jarSuper);
    await api('/api/super/qris', { method: 'POST', body: { pay: { gateway_aktif: true, manual_aktif: true, provider: 'sandbox', mode: 'sandbox' } } }, jarSuper);
    const buat = await api('/api/super/sekolah/simpan', {
      method: 'POST',
      body: { nama: 'SMK Uji Bayar UI', jenjang: 'SMK', admin_username: 'admint13', admin_password: 'ujipass123', paket: 'basic' }
    }, jarSuper);
    KODE2 = (buat.body.tenant || {}).kode || '';
    ok('tenant uji dibuat untuk halaman perpanjangan', !!KODE2);

    console.log('\n== 1. PANEL SUPER ADMIN: METODE PEMBAYARAN ==');
    await page.goto(BASE + '/super-admin', { waitUntil: 'networkidle' });
    await page.fill('input[autocomplete="username"]', 'superadmin');
    await page.fill('input[autocomplete="current-password"]', 'superadmin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    const menuQris = page.locator('aside button:has-text("QRIS")').first();
    ok('menu "QRIS & Harga" ada di panel platform', (await menuQris.count()) > 0);
    await menuQris.click();
    await page.waitForTimeout(2000);
    ok('sakelar QRIS otomatis tersedia', (await page.locator('[data-pay-gateway]').count()) === 1);
    ok('sakelar QRIS manual tersedia', (await page.locator('[data-pay-manual]').count()) === 1);
    ok('QRIS otomatis aktif sesuai pengaturan', await page.locator('[data-pay-gateway]').isChecked());
    ok('QRIS manual aktif sesuai pengaturan', await page.locator('[data-pay-manual]').isChecked());
    ok('pemilih provider gateway ada', (await page.locator('[data-pay-provider]').count()) === 1);
    ok('field kredensial gateway ada', (await page.locator('[data-pay-key]').count()) === 1);
    ok('URL callback ditampilkan', (await page.locator('input[value*="/api/pay/callback"]').count()) >= 1);

    /* matikan lalu aktifkan lagi lewat UI + simpan */
    await page.locator('[data-pay-gateway]').uncheck();
    await page.click('button:has-text("Simpan QRIS & Harga")');
    await page.waitForTimeout(1600);
    const cek1 = await api('/api/super/qris', {}, jarSuper);
    ok('sakelar QRIS otomatis tersimpan mati lewat UI', cek1.body.pay.gateway_aktif === false);
    await page.locator('[data-pay-gateway]').check();
    await page.click('button:has-text("Simpan QRIS & Harga")');
    await page.waitForTimeout(1600);
    const cek2 = await api('/api/super/qris', {}, jarSuper);
    ok('sakelar QRIS otomatis tersimpan hidup lewat UI', cek2.body.pay.gateway_aktif === true);

    console.log('\n== 2. SEKOLAH: DUA METODE BERDAMPINGAN ==');
    /* paksa muat ulang penuh tanpa hash (ganti query → navigasi dokumen baru) */
    /* keluar dari sesi Super Admin agar halaman login sekolah tampil */
    await ctx.clearCookies();
    await page.goto(BASE + '/?masuk=' + Date.now(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.fill('input[placeholder*="kode sekolah"]', KODE2);
    await page.fill('input[autocomplete="username"]', 'admint13');
    await page.fill('input[autocomplete="current-password"]', 'ujipass123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await page.click('aside nav button:has-text("Info & Layanan")');
    await page.waitForTimeout(2200);
    ok('halaman Info & Layanan terbuka', (await page.locator('text=Perpanjangan Layanan').count()) > 0);
    ok('badge QRIS otomatis & manual tampil',
      (await page.locator('text=/QRIS Otomatis/').count()) > 0 && (await page.locator('text=/QRIS Manual/').count()) > 0);
    await page.click('button:has-text("Perpanjang Sekarang")');
    await page.waitForTimeout(800);
    ok('modal pembayaran menampilkan dua pilihan metode',
      (await page.locator('[data-metode="gateway"]').count()) === 1 && (await page.locator('[data-metode="manual"]').count()) === 1);

    console.log('\n== 3. ALUR QRIS OTOMATIS ==');
    await page.click('[data-metode="gateway"]');
    await page.waitForTimeout(400);
    ok('panel QRIS otomatis terbuka', (await page.locator('[data-panel="gateway"]').count()) === 1);
    await page.click('[data-buat-qris]');
    await page.waitForTimeout(1800);
    ok('QR dinamis berhasil dibuat', (await page.locator('[data-qris-gateway]').count()) === 1);
    ok('tombol simulasi lunas tersedia (provider sandbox)', (await page.locator('[data-simulasi-lunas]').count()) === 1);
    await page.click('[data-simulasi-lunas]');
    await page.waitForTimeout(2000);
    ok('status berubah menjadi terverifikasi',
      (await page.locator('text=Pembayaran terverifikasi').count()) > 0 ||
      (await page.locator('text=disetujui').count()) > 0);

    console.log('\n== 4. PANEL QRIS MANUAL TETAP ADA ==');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (await page.locator('button:has-text("Perpanjang Sekarang")').count()) {
      await page.click('button:has-text("Perpanjang Sekarang")');
      await page.waitForTimeout(700);
      await page.click('[data-metode="manual"]');
      await page.waitForTimeout(400);
      ok('panel QRIS manual (unggah bukti) tampil', (await page.locator('[data-panel="manual"]').count()) === 1);
      ok('form bukti pembayaran tersedia', (await page.locator('text=Bukti Pembayaran').count()) > 0);
    } else {
      ok('panel QRIS manual (unggah bukti) tampil', false, 'tombol perpanjangan tidak tersedia');
    }

    console.log('\n== 5. MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 820 });
    await page.waitForTimeout(600);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal', ov <= 2, String(ov));
    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL UI RONDE 13: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
