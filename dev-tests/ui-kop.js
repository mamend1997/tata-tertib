'use strict';
/* Uji UI Kop Surat (Playwright):
   - teks kop dapat diketik bebas dan tampil APA ADANYA (tidak dipaksa KAPITAL)
   - ukuran font per baris langsung berubah di pratinjau & tersimpan
   - ukuran logo (lebar & tinggi) dapat diatur dan pratinjau mengikuti
   Jalankan: node dev-tests/ui-kop.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uikop-' + Date.now() + '.sqlite');
const PORT = 5550 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

const KOP = [
  'PERWAKILAN YAYASAN PEMBINA LEMBAGA PENDIDIKAN',
  'PERSATUAN GURU REPUBLIK INDONESIA (YPLP-PGRI) KABUPATEN CIAMIS',
  'Sekolah Menengah Kejuruan PGRI Cikoneng',
  'NPSN: 20211525 TERAKREDITASI: A',
  'Jalan Raya Cikoneng No.144 Telp./Fax.:(0265)773258 E-mail:smkpgrickn@yahoo.co.id',
  'Cikoneng-Ciamis'
].join('\n');

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1900));

  KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
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
    await page.waitForTimeout(700);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await page.keyboard.press('Escape');

    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(700);
    await page.click('.tab:has-text("Kop Surat")');
    await page.waitForTimeout(700);

    console.log('\n== TEKS KOP APA ADANYA ==');
    const ta = page.locator('[data-kop-manual]');
    ok('textarea teks kop aktif (tidak terkunci)', !(await ta.isDisabled()));
    await ta.click();
    await ta.fill(KOP);
    await page.waitForTimeout(300);
    const line3 = await page.locator('[data-kop-line="2"]').evaluate(el => ({
      text: el.textContent, transform: getComputedStyle(el).textTransform, weight: getComputedStyle(el).fontWeight
    }));
    ok('pratinjau baris sekolah apa adanya', line3.text === 'Sekolah Menengah Kejuruan PGRI Cikoneng', line3.text);
    ok('pratinjau tidak uppercase', line3.transform === 'none', line3.transform);
    ok('mode manual tidak memaksa tebal', Number(line3.weight) < 700, line3.weight);
    const prevText = await page.locator('[data-kop-preview]').innerText();
    ok('pratinjau tidak memuat "SMK SWASTA NPSN"', !/SMK\s+SWASTA\s+NPSN/i.test(prevText), prevText);
    ok('jumlah baris pratinjau = 6', (await page.locator('[data-kop-line]').count()) === 6,
      String(await page.locator('[data-kop-line]').count()));

    console.log('\n== UKURAN FONT PER BARIS ==');
    await page.locator('[data-kop-size="2"]').selectOption('22');
    await page.waitForTimeout(250);
    const fs22 = await page.locator('[data-kop-line="2"]').evaluate(el => getComputedStyle(el).fontSize);
    ok('baris sekolah jadi 22pt (≈29,3px)', Math.abs(parseFloat(fs22) - 29.33) < 0.8, fs22);
    await page.locator('[data-kop-size="3"]').selectOption('9');
    await page.waitForTimeout(250);
    const fs9 = await page.locator('[data-kop-line="3"]').evaluate(el => getComputedStyle(el).fontSize);
    ok('baris NPSN jadi 9pt (12px)', Math.abs(parseFloat(fs9) - 12) < 0.5, fs9);
    ok('teks kop tidak hilang setelah ubah ukuran', (await ta.inputValue()).includes('Sekolah Menengah Kejuruan'));
    ok('nilai ukuran baris tetap tampil di form', (await page.locator('[data-kop-size="2"]').inputValue()) === '22');

    console.log('\n== UKURAN LOGO ==');
    const w = page.locator('[data-kop-logow]');
    const h = page.locator('[data-kop-logoh]');
    ok('input lebar & tinggi logo tersedia', (await w.count()) === 1 && (await h.count()) === 1);
    await w.fill('180');
    await h.fill('90');
    await page.waitForTimeout(350);
    const box = await page.locator('[data-kop-logo]').first().evaluate(el => {
      const rc = el.getBoundingClientRect(); return { w: Math.round(rc.width), h: Math.round(rc.height) };
    });
    ok('pratinjau logo lebar 180px', Math.abs(box.w - 180) <= 2, JSON.stringify(box));
    ok('pratinjau logo tinggi 90px', Math.abs(box.h - 90) <= 2, JSON.stringify(box));
    await page.click('button:has-text("Lebar (lambang + teks)")');
    await page.waitForTimeout(250);
    ok('preset logo lebar mengisi 200 × 80', (await w.inputValue()) === '200' && (await h.inputValue()) === '80');

    console.log('\n== SIMPAN & MUAT ULANG ==');
    await page.click('button:has-text("Simpan Kop Surat")');
    await page.waitForTimeout(1500);
    const s = await (await page.request.get(BASE + '/api/settings')).json();
    ok('kop_baris tersimpan utuh', String(s.settings.kop_baris).includes('Sekolah Menengah Kejuruan PGRI Cikoneng'));
    ok('kop_format tersimpan (22pt baris 3)', /"size":22/.test(String(s.settings.kop_format)), String(s.settings.kop_format));
    ok('kop_logo_w / kop_logo_h tersimpan', String(s.settings.kop_logo_w) === '200' && String(s.settings.kop_logo_h) === '80',
      `${s.settings.kop_logo_w}/${s.settings.kop_logo_h}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await page.keyboard.press('Escape');
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(600);
    await page.click('.tab:has-text("Kop Surat")');
    await page.waitForTimeout(700);
    ok('lebar logo bertahan setelah muat ulang', (await w.inputValue()) === '200', await w.inputValue());
    ok('teks kop bertahan setelah muat ulang', (await ta.inputValue()).includes('Cikoneng-Ciamis'));
    const fsPrev = await page.locator('[data-kop-line="2"]').evaluate(el => getComputedStyle(el).fontSize);
    ok('ukuran font bertahan setelah muat ulang (22pt)', Math.abs(parseFloat(fsPrev) - 29.33) < 0.8, fsPrev);

    console.log('\n== MOBILE 390px ==');
    await page.close();
    const p2 = await ctx.newPage();
    await p2.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p2.waitForTimeout(600);
    if (await p2.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await p2.keyboard.press('Escape');
    await p2.setViewportSize({ width: 390, height: 844 });
    await p2.waitForTimeout(400);
    await p2.click('header button:has-text("Menu"), aside nav button:has-text("Pengaturan")').catch(() => {});
    await p2.waitForTimeout(500);
    await p2.click('aside nav button:has-text("Pengaturan")').catch(() => {});
    await p2.waitForTimeout(700);
    await p2.click('.tab:has-text("Kop Surat")').catch(() => {});
    await p2.waitForTimeout(700);
    const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal di mobile', overflow <= 2, String(overflow));
    await p2.close();

    console.log('\n== TANPA ERROR JS ==');
    ok('tidak ada error JavaScript', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
  } finally {
    await browser.close().catch(() => {});
    srv.kill('SIGKILL');
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(DB + '-wal'); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(DB + '-shm'); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL UI KOP: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
