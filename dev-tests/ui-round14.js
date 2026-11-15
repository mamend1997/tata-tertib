'use strict';
/* Uji UI kategori ganda (Playwright): `node dev-tests/ui-round14.js`
   Input Kejadian & Buku Penghubung: memilih beberapa kategori sekaligus
   (chip + total poin), sinkron dengan pemilih siswa masal. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui14-' + Date.now() + '.sqlite');
const PORT = 5800 + Math.floor(Math.random() * 90);
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

    console.log('\n== INPUT KEJADIAN: KATEGORI GANDA ==');
    await page.click('aside nav button:has-text("Kejadian")');
    await page.waitForSelector('text=Form Input Kejadian');
    ok('komponen kategori ditandai multi', (await page.locator('[data-kategori-multi="1"]').count()) === 1);

    /* pilih dua kategori pelanggaran dari dropdown pencarian */
    const kategori = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/kategori');
      const j = await r.json();
      return j.rows.filter(k => k.jenis === 'pelanggaran' && k.aktif !== 0).slice(0, 2).map(k => ({ id: k.id, nama: k.nama, poin: k.poin }));
    });
    ok('dua kategori pelanggaran tersedia untuk uji', kategori.length === 2, JSON.stringify(kategori));

    await page.fill('[data-kategori-search]', String(kategori[0].nama).slice(0, 4));
    await page.waitForTimeout(350);
    ok('dropdown kategori muncul saat mengetik', (await page.locator('[data-kategori-pick]').count()) > 0);
    await page.locator('[data-kategori-pick="' + kategori[0].id + '"]').first().click();
    await page.waitForTimeout(250);
    ok('kategori pertama masuk sebagai chip', (await page.locator('[data-kategori-chips] span').count()) >= 1);

    /* kategori kedua lewat select (jalur cepat) */
    await page.selectOption('[data-kategori-select]', String(kategori[1].id));
    await page.waitForTimeout(300);
    const chipText = await page.locator('[data-kategori-chips]').innerText();
    ok('kategori kedua ditambahkan (2 chip)', (await page.locator('[data-kategori-chips] button[aria-label="Hapus kategori"]').count()) === 2, chipText.slice(0, 120));
    const total = Number(kategori[0].poin) + Number(kategori[1].poin);
    ok('total poin dijumlahkan otomatis', new RegExp('Total ' + total + ' poin').test(chipText), chipText.slice(0, 160));

    /* hapus satu kategori lalu tambahkan lagi */
    await page.locator('[data-kategori-chips] button[aria-label="Hapus kategori"]').first().click();
    await page.waitForTimeout(250);
    ok('chip kategori dapat dihapus', (await page.locator('[data-kategori-chips] button[aria-label="Hapus kategori"]').count()) === 1);
    await page.selectOption('[data-kategori-select]', String(kategori[0].id));
    await page.waitForTimeout(250);

    /* pilih siswa lalu simpan */
    const nama = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/siswa-options?limit=3');
      return ((await r.json()).rows || [])[0].nama;
    });
    await page.fill('[data-multi-input]', String(nama).slice(0, 3));
    await page.waitForTimeout(650);
    await page.locator('[data-pick]').first().click();
    await page.click('[data-save="kejadian"]');
    await page.waitForTimeout(1600);
    ok('tersimpan dengan 2 kategori',
      (await page.locator('text=/2 kategori/').count()) > 0, 'toast tidak menyebut 2 kategori');

    console.log('\n== BUKU PENGHUBUNG: KATEGORI GANDA ==');
    await page.click('aside nav button:has-text("Buku Penghubung")');
    await page.waitForSelector('text=Catat Temuan Cepat');
    ok('buku penghubung juga memakai kategori multi', (await page.locator('form[data-form="jurnal"] [data-kategori-multi="1"]').count()) === 1);
    await page.selectOption('form[data-form="jurnal"] [data-kategori-select]', String(kategori[0].id));
    await page.waitForTimeout(200);
    await page.selectOption('form[data-form="jurnal"] [data-kategori-select]', String(kategori[1].id));
    await page.waitForTimeout(250);
    ok('dua kategori terpilih di buku penghubung',
      (await page.locator('form[data-form="jurnal"] [data-kategori-chips] button[aria-label="Hapus kategori"]').count()) === 2);
    const nama2 = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/siswa-options?all=1&limit=3');
      return ((await r.json()).rows || [])[0].nama;
    });
    await page.fill('form[data-form="jurnal"] [data-multi-input]', String(nama2).slice(0, 3));
    await page.waitForTimeout(650);
    await page.locator('form[data-form="jurnal"] [data-pick]').first().click();
    await page.click('[data-save="jurnal"]');
    await page.waitForTimeout(1600);
    ok('jurnal tersimpan dengan 2 kategori',
      (await page.locator('text=/2 kategori/').count()) > 0, 'flash jurnal tidak menyebut 2 kategori');

    console.log('\n== DASHBOARD: BARIS PER KATEGORI ==');
    await page.click('aside nav button:has-text("Dashboard")');
    await page.waitForSelector('text=Riwayat Aktivitas Siswa', { timeout: 15000 });
    ok('riwayat menampilkan baris per kategori', (await page.locator('[data-tbl="riwayat"] tbody tr').count()) >= 2);

    console.log('\n== MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 820 });
    await page.waitForTimeout(500);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('dashboard mobile tanpa overflow', ov <= 2, String(ov));
    await page.click('button[aria-label="Menu"]').catch(() => {});
    await page.click('aside nav button:has-text("Kejadian")').catch(() => {});
    await page.waitForTimeout(800);
    const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('form kejadian mobile tanpa overflow', ov2 <= 2, String(ov2));
    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL UI RONDE 14: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
