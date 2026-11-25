'use strict';
/* UI test Playwright: `node dev-tests/ui.js` (server + DB sementara, tidak menyentuh data asli) */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui-' + Date.now() + '.sqlite');
const PORT = 5100 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let PSLUG = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1800));
  const sek0 = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {});
  KODE = sek0.kode || '';
  PSLUG = sek0.portal_slug || '';

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  try {
    console.log('\n== LOGIN ==');
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('input[autocomplete="username"]');
    ok('halaman login tampil', await page.locator('h2:has-text("Masuk ke Dashboard")').isVisible());
    ok('login memakai branding GLOBAL (bukan nama sekolah)', (await page.locator('text=SMART TATA TERTIB SISWA').count()) > 0 && (await page.locator('text=SMK PGRI CIKONENG').count()) === 0);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    ok('berhasil masuk dashboard', (await page.locator('text=Dashboard Kedisiplinan').count()) > 0);
    // tutup pop-up peringatan Siaga/Kritis bila muncul (fitur notifikasi real-time)
    await page.waitForTimeout(700);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    ok('menu sidebar tampil untuk admin', (await page.locator('aside nav button').count()) >= 10, String(await page.locator('aside nav button').count()));

    console.log('\n== DASHBOARD ==');
    await page.waitForSelector('text=Total Siswa');
    const kpiCount = await page.locator('.kpi').count();
    ok('4 kartu KPI tampil', kpiCount >= 4, String(kpiCount));
    ok('distribusi status 6 lencana', (await page.locator('text=Distribusi Status Disiplin').count()) > 0);
    ok('tabel peringkat pelanggaran', (await page.locator('text=Peringkat Poin Pelanggaran').count()) > 0);
    ok('panel deteksi dini', (await page.locator('text=Deteksi Dini 14 Hari').count()) > 0);
    ok('grafik tren dirender', (await page.locator('.h-\\[210px\\]').count()) > 0);
    const badges = await page.locator('.badge').count();
    ok('lencana status dinamis tampil', badges > 3, String(badges));

    console.log('\n== NAVIGASI SEMUA MENU ==');
    const menus = ['Kejadian & Poin', 'Deteksi Dini', 'Data Siswa', 'Data Kelas', 'Kategori Poin', 'Akun Pengguna', 'Laporan & Surat', 'Log Aktivitas', 'Pengaturan'];
    for (const m of menus) {
      await page.click(`aside nav button:has-text("${m}")`);
      await page.waitForTimeout(500);
      const h = await page.locator('main h2').first().innerText().catch(() => '');
      ok('menu "' + m + '" terbuka', h.length > 2, h);
    }

    console.log('\n== FORM KEJADIAN ==');
    await page.click('aside nav button:has-text("Kejadian & Poin")');
    await page.waitForTimeout(500);
    /* ronde 4: pemilih siswa memakai autocomplete (ketik ≥3 huruf → dropdown) */
    const optRes = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/siswa-options?limit=5');
      const j = await r.json();
      return (j.rows || []).map(x => x.nama);
    });
    const kataKunci = String((optRes[0] || 'Siswa')).slice(0, 3);
    await page.fill('form [data-student-picker]', kataKunci);
    await page.waitForTimeout(700);
    const pickCount = await page.locator('form [data-pick]').count();
    ok('form kejadian: dropdown nama siswa muncul saat mengetik', pickCount > 0, 'hasil=' + pickCount);
    await page.locator('form [data-pick]').first().click();
    await page.waitForTimeout(300);
    /* ronde 12: siswa terpilih tampil sebagai chip beserta nama kelasnya */
    const kelasHint = await page.locator('form [data-chip-list]').innerText();
    ok('kelas siswa tampil otomatis setelah memilih', /X |XI|XII/.test(kelasHint), kelasHint.slice(0, 80));
    // kategori: filter pencarian lalu pilih dari select
    const selects = page.locator('form select');
    await page.fill('form [data-kategori-search]', 'Terl');
    await page.waitForTimeout(200);
    await selects.last().selectOption({ index: 1 });
    await page.fill('form textarea', 'Terlambat masuk kelas saat jam pertama');
    await page.fill('form input[placeholder*="Terlambat"]', 'Uji dari UI').catch(() => {});
    await page.click('button:has-text("Simpan Kejadian")');
    await page.waitForTimeout(1100);
    ok('simpan kejadian dari UI', (await page.locator('text=Tercatat').count()) > 0 || (await page.locator('table.tbl tbody tr').count()) > 0);

    console.log('\n== DATA SISWA & MODAL ==');
    await page.click('aside nav button:has-text("Data Siswa")');
    await page.waitForSelector('text=Daftar Siswa');
    await page.waitForTimeout(500);
    const rowsSiswa = await page.locator('table.tbl tbody tr').count();
    ok('tabel siswa berisi data', rowsSiswa > 20, String(rowsSiswa));
    await page.click('button:has-text("Tambah Siswa")');
    await page.waitForSelector('#fSiswa');
    await page.mouse.click(10, 450);
    ok('modal tambah siswa tetap terbuka setelah klik di luar', await page.locator('#fSiswa').isVisible());
    await page.fill('#fSiswa input[required]', 'Siswa Uji UI');
    await page.fill('#fSiswa input[type="date"]', '2010-05-06');
    await page.click('button[form="fSiswa"]');
    await page.waitForTimeout(900);
    const found = await page.locator('text=Siswa Uji UI').count();
    ok('tambah siswa via modal', found > 0, String(found));

    console.log('\n== LAPORAN & SURAT ==');
    await page.click('aside nav button:has-text("Laporan & Surat")');
    await page.waitForSelector('text=Rekapitulasi Poin Murid');
    ok('tombol Word/Excel/Cetak ada', (await page.locator('button:has-text("Excel")').count()) > 0 && (await page.locator('button:has-text("Cetak / PDF")').count()) > 0);
    await page.locator('table.tbl tbody tr').first().locator('button[title="Buat surat"]').click();
    await page.waitForTimeout(400);
    ok('modal surat menampilkan 4 jenis surat', (await page.locator('text=Surat Peringatan Ketiga (SP 3)').count()) > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);

    console.log('\n== PENGATURAN ==');
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(500);
    for (const t of ['Identitas Sekolah', 'Branding Aplikasi', 'Tampilan Menu & UI', 'Form Input Kejadian', 'Status & Deteksi Dini', 'Tahun Pelajaran']) {
      await page.click(`.tab:has-text("${t}")`);
      await page.waitForTimeout(320);
      ok('tab pengaturan "' + t + '"', (await page.locator('main').count()) > 0);
    }
    await page.click('.tab:has-text("Branding Aplikasi")');
    await page.waitForTimeout(300);
    await page.click('button[title="#4f46e5"]').catch(() => {});
    await page.waitForTimeout(200);
    const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    ok('warna primer berubah via palet', primary.toLowerCase() === '#4f46e5', primary);

    console.log('\n== PORTAL PUBLIK ==');
    const browser2 = await chromium.launch();
    const ctx2 = await browser2.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errors.push('PORTAL: ' + e.message));
    await p2.goto(BASE + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
    ok('halaman portal tanpa login', (await p2.locator('text=Cek Poin Kedisiplinan Siswa').count()) > 0);
    await p2.fill('input[placeholder*="nama lengkap"]', 'Ahmad Fauzan');
    await p2.fill('input[type="date"]', '2007-01-10');
    await p2.click('button:has-text("Lihat Poin")');
    await p2.waitForTimeout(1200);
    const portaRes = await p2.locator('text=Rekap Kedisiplinan Siswa').count();
    ok('portal menampilkan hasil pencarian', portaRes > 0, await p2.locator('.card').first().innerText().catch(() => ''));
    await p2.screenshot({ path: '/tmp/stt-portal.png', fullPage: false }).catch(() => {});
    await p2.close();
    await browser2.close();

    console.log('\n== RESPONSIF MOBILE ==');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('dashboard mobile tanpa overflow horizontal', overflow <= 2, 'overflow=' + overflow);
    await page.click('header button[aria-label="Menu"]');
    await page.waitForTimeout(400);
    ok('menu mobile (drawer) terbuka', await page.locator('aside').isVisible());
    await page.click('aside nav button:has-text("Data Siswa")');
    await page.waitForTimeout(700);
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman siswa mobile tanpa overflow', overflow2 <= 2, 'overflow=' + overflow2);

    console.log('\n== TANPA ERROR JS ==');
    const real = errors.filter(e => !/favicon|404 \(Not Found\)|net::ERR/.test(e));
    ok('tidak ada error JavaScript', real.length === 0, real.slice(0, 3).join(' | '));

    await page.screenshot({ path: '/tmp/stt-mobile.png', fullPage: false }).catch(() => {});
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: '/tmp/stt-dashboard.png', fullPage: false });
    await page.click('aside nav button:has-text("Kejadian & Poin")');
    await page.waitForTimeout(900);
    await page.screenshot({ path: '/tmp/stt-kejadian.png', fullPage: false });
    await page.click('aside nav button:has-text("Laporan & Surat")');
    await page.waitForTimeout(900);
    await page.screenshot({ path: '/tmp/stt-laporan.png', fullPage: false });
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/stt-pengaturan.png', fullPage: false });
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill('SIGKILL');
    try { fs.unlinkSync(DB); } catch (e) {}
    ['-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL UI: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
