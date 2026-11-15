'use strict';
/* Uji UI ronde 3 (Playwright): kalender, kotak sampah, backup/reset/demo di Pengaturan,
   audit data tersembunyi, baris Deteksi Dini dapat diklik, hapus riwayat massal di Kartu Siswa.
   Jalankan: node dev-tests/ui-round3.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui3-' + Date.now() + '.sqlite');
const PORT = 5200 + Math.floor(Math.random() * 150);
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
  await new Promise(r => setTimeout(r, 1900));
  KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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

    console.log('\n== MENU BARU ==');
    ok('menu Kalender Disiplin ada', (await page.locator('aside nav button:has-text("Kalender Disiplin")').count()) > 0);
    ok('menu Kotak Sampah ada (admin)', (await page.locator('aside nav button:has-text("Kotak Sampah")').count()) > 0);
    ok('audit data TIDAK tampil di navigasi', (await page.locator('aside nav button:has-text("Audit Data")').count()) === 0);

    console.log('\n== KALENDER KEDISIPLINAN ==');
    await page.click('aside nav button:has-text("Kalender Disiplin")');
    await page.waitForSelector('text=Kalender Bulanan');
    await page.waitForTimeout(900);
    ok('grid kalender tampil (7 kolom)', (await page.locator('text=Kalender Bulanan').count()) > 0);
    const gridCount = await page.locator('.cal-grid button').count();
    ok('kalender berisi tanggal', gridCount > 20, String(gridCount));
    // klik tanggal yang memiliki badge pelanggaran
    const withBadge = page.locator('.cal-grid button:has-text("pel")').first();
    if (await withBadge.count()) {
      await withBadge.click();
      await page.waitForTimeout(700);
      const panel = await page.locator('main').innerText();
      ok('klik tanggal menampilkan rincian harian', /Kejadian .*\d{4}/.test(panel), panel.slice(0, 60));
    } else {
      ok('klik tanggal menampilkan rincian harian', false, 'tidak ada tanggal dengan pelanggaran');
    }
    // ganti bulan
    await page.click('button[aria-label="Bulan berikutnya"]');
    await page.waitForTimeout(900);
    ok('navigasi bulan berikutnya', (await page.locator('text=Kalender Bulanan').count()) > 0);

    console.log('\n== DETEKSI DINI: BARIS DIKLIK → KARTU SISWA ==');
    await page.click('aside nav button:has-text("Deteksi Dini")');
    await page.waitForTimeout(1200);
    const rowDeteksi = page.locator('table.tbl tbody tr').first();
    ok('baris deteksi dini tersedia', (await rowDeteksi.count()) > 0);
    if (await rowDeteksi.count()) {
      const namaSel = (await rowDeteksi.locator('td').first().innerText()).trim();
      await rowDeteksi.click();
      await page.waitForTimeout(1400);
      const modalTitle = await page.locator('[data-modal]').first().getAttribute('data-modal-title').catch(() => '');
      ok('klik baris membuka Kartu Siswa', (await page.locator('text=Riwayat Kejadian').count()) > 0, 'nama: ' + namaSel);
      ok('kartu siswa menampilkan nama yang sama', String(modalTitle || '').includes(namaSel), `${modalTitle} vs ${namaSel}`);
      ok('halaman Data Siswa aktif', page.url().includes('/siswa') || (await page.locator('text=Daftar Siswa').count()) > 0);

      console.log('\n== HAPUS RIWAYAT MASSAL DI KARTU SISWA ==');
      const riwayatChecks = page.locator('[data-modal] table.tbl tbody input[type="checkbox"]');
      const jml = await riwayatChecks.count();
      ok('checkbox riwayat kejadian tersedia', jml > 0, String(jml));
      if (jml > 1) {
        await riwayatChecks.nth(0).check();
        await riwayatChecks.nth(1).check();
        ok('tombol hapus terpilih aktif', await page.locator('[data-modal] button:has-text("Hapus Terpilih")').isEnabled());
        page.once('dialog', d => d.accept());
        await page.click('[data-modal] button:has-text("Hapus Terpilih")');
        await page.waitForTimeout(1800);
        const setelah = await page.locator('[data-modal] table.tbl tbody input[type="checkbox"]').count();
        ok('riwayat berkurang setelah dihapus', setelah === jml - 2, `${setelah} vs ${jml - 2}`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }

    console.log('\n== KOTAK SAMPAH ==');
    await page.click('aside nav button:has-text("Kotak Sampah")');
    await page.waitForSelector('text=Data Terhapus');
    await page.waitForTimeout(700);
    ok('kotak sampah memuat riwayat terhapus', (await page.locator('table.tbl tbody tr').count()) >= 2,
      String(await page.locator('table.tbl tbody tr').count()));
    const trRow = page.locator('table.tbl tbody tr').first();
    await trRow.locator('input[type="checkbox"]').check();
    ok('tombol pulihkan & hapus permanen tersedia',
      (await page.locator('button:has-text("Pulihkan Terpilih")').count()) > 0 &&
      (await page.locator('button:has-text("Hapus Permanen")').count()) > 0);
    await page.click('button:has-text("Pulihkan Terpilih")');
    await page.waitForTimeout(1400);
    ok('pulihkan data dari kotak sampah', (await page.locator('text=/dipulihkan/').count()) > 0);

    console.log('\n== PENGATURAN: BACKUP, RESET, DATA CONTOH, AUDIT ==');
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(600);
    await page.click('.tab:has-text("Backup & Restore")');
    await page.waitForTimeout(900);
    ok('kartu backup & restore', (await page.locator('text=Unduh Backup (.json)').count()) > 0 &&
      (await page.locator('text=Pulihkan Database Sekarang').count()) > 0);
    ok('tautan audit data tersembunyi', (await page.locator('button:has-text("Buka Audit Data Tersembunyi")').count()) > 0);

    await page.click('.tab:has-text("Reset Tahun Ajaran")');
    await page.waitForTimeout(900);
    ok('kartu reset tahun ajaran', (await page.locator('text=Konfirmasi Reset').count()) > 0 &&
      (await page.locator('input[placeholder="RESET"]').count()) > 0);

    ok('tab "Data Contoh" sudah dihapus', (await page.locator('.tab:has-text("Data Contoh")').count()) === 0);
    ok('tidak ada tombol "Muat Data Contoh"', (await page.locator('button:has-text("Muat Data Contoh")').count()) === 0 &&
      (await page.locator('text=Muat Data Contoh').count()) === 0);

    console.log('\n== KOP SURAT INTERAKTIF ==');
    await page.click('.tab:has-text("Kop Surat")');
    await page.waitForTimeout(800);
    const taKop = page.locator('[data-kop-manual]');
    ok('textarea teks kop bisa diketik (tidak terkunci)', !(await taKop.isDisabled()));
    await taKop.click();
    await taKop.fill('YAYASAN UJI\nSMK UJI\nSEKOLAH UJI COBA\nJl. Uji No. 1');
    await page.waitForTimeout(300);
    ok('pratinjau kop ikut berubah', /SEKOLAH UJI COBA/.test(await page.locator('[data-kop-preview]').innerText()));
    await page.locator('[data-kop-size="0"]').selectOption('20');
    await page.waitForTimeout(300);
    const fsKop = await page.locator('[data-kop-line="0"]').evaluate(el => getComputedStyle(el).fontSize);
    ok('selector ukuran font berfungsi (baris 1 = 20pt)', Math.abs(parseFloat(fsKop) - 26.67) < 0.8, fsKop);
    ok('teks kop tidak hilang setelah ubah ukuran', (await taKop.inputValue()).includes('SEKOLAH UJI COBA'));
    ok('pratinjau tidak memuat baris otomatis "SMK SWASTA NPSN"',
      !/SMK\s+SWASTA\s+NPSN/i.test(await page.locator('[data-kop-preview]').innerText()));
    await page.click('button:has-text("Simpan Kop Surat")');
    await page.waitForTimeout(1400);

    await page.click('.tab:has-text("Backup & Restore")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Buka Audit Data Tersembunyi")');
    await page.waitForTimeout(1100);
    ok('halaman audit data terbuka', (await page.locator('h2:has-text("Audit Data Tersembunyi")').count()) > 0);
    ok('halaman audit menampilkan hasil pemindaian', (await page.locator('text=Jenis Masalah').count()) > 0);
    ok('URL hash audit data', page.url().includes('audit-data'));

    console.log('\n== SISWA BARU BERSIH (UI) ==');
    await page.click('aside nav button:has-text("Data Siswa")');
    await page.waitForSelector('text=Daftar Siswa');
    await page.waitForTimeout(700);
    await page.click('button:has-text("Tambah Siswa")');
    await page.waitForSelector('#fSiswa');
    await page.fill('#fSiswa input[required]', 'Siswa Baru Bersih UI');
    await page.click('button[form="fSiswa"]');
    await page.waitForTimeout(1200);
    const rowBaru = page.locator('table.tbl tbody tr', { hasText: 'Siswa Baru Bersih UI' }).first();
    ok('siswa baru muncul di daftar', (await rowBaru.count()) > 0);
    await rowBaru.locator('button').first().click();
    await page.waitForTimeout(900);
    ok('kartu siswa baru tanpa riwayat', (await page.locator('text=siswa ini bersih').count()) > 0);
    await page.keyboard.press('Escape');

    console.log('\n== MENU KOTAK SAMPAH TIDAK UNTUK GURU ==');
    await page.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p2.fill('input[autocomplete="username"]', 'guru');
    await p2.fill('input[autocomplete="current-password"]', 'guru123');
    await p2.fill('input[placeholder*="kode sekolah"]', KODE);
    await p2.click('button[type="submit"]');
    await p2.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await p2.waitForTimeout(800);
    if (await p2.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await p2.keyboard.press('Escape');
    ok('guru tidak melihat menu Kotak Sampah', (await p2.locator('aside nav button:has-text("Kotak Sampah")').count()) === 0);
    ok('guru tetap melihat menu Kalender', (await p2.locator('aside nav button:has-text("Kalender Disiplin")').count()) > 0);
    await p2.close();
    await ctx2.close();

    console.log('\n== RESPONSIF MOBILE ==');
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 860 } });
    const p3 = await ctx3.newPage();
    await p3.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p3.fill('input[autocomplete="username"]', 'admin');
    await p3.fill('input[autocomplete="current-password"]', 'admin123');
    await p3.fill('input[placeholder*="kode sekolah"]', KODE);
    await p3.click('button[type="submit"]');
    await p3.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await p3.waitForTimeout(700);
    if (await p3.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await p3.keyboard.press('Escape');
    await p3.click('header button[aria-label="Menu"]');
    await p3.waitForTimeout(400);
    await p3.click('aside nav button:has-text("Kalender Disiplin")');
    await p3.waitForTimeout(1100);
    let ovf = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('kalender mobile tanpa overflow', ovf <= 2, 'overflow=' + ovf);
    await p3.click('header button[aria-label="Menu"]');
    await p3.waitForTimeout(300);
    await p3.click('aside nav button:has-text("Kotak Sampah")');
    await p3.waitForTimeout(1000);
    ovf = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('kotak sampah mobile tanpa overflow', ovf <= 2, 'overflow=' + ovf);
    await p3.close();
    await ctx3.close();

    console.log('\n== TANPA ERROR JS ==');
    const real = errors.filter(e => !/favicon|404 \(Not Found\)|net::ERR|Failed to load resource/.test(e));
    ok('tidak ada error JavaScript', real.length === 0, real.slice(0, 3).join(' | '));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill('SIGKILL');
    ['', '-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL UI RONDE 3: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
