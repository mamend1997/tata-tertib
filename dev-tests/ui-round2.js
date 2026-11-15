'use strict';
/* Uji UI fitur ronde lanjutan (Playwright): `node dev-tests/ui-round2.js` */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui2-' + Date.now() + '.sqlite');
const PORT = 5000 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let PSLUG = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  try {
    console.log('\n== LOGIN BERSIH ==');
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok('halaman login tanpa daftar akun contoh', (await page.locator('text=Akun contoh').count()) === 0 && (await page.locator('text=admin / admin123').count()) === 0);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });

    console.log('\n== DASHBOARD: ALERT & ANALITIK ==');
    ok('banner peringatan berkedip tampil', await page.locator('.alert-blink').isVisible());
    const menuBaru = ['Buku Penghubung', 'Tindak Lanjut', 'Analitik Pola'];
    for (const m of menuBaru) {
      ok('menu "' + m + '" ada di sidebar', (await page.locator(`aside nav button:has-text("${m}")`).count()) > 0);
    }
    ok('menu Profil Akun di sidebar', (await page.locator('aside button:has-text("Profil Akun")').count()) > 0);
    ok('kartu pola hari rawan', (await page.locator('text=Pola Hari Rawan').count()) > 0);
    ok('kartu rekomendasi sanksi otomatis', (await page.locator('text=Rekomendasi Sanksi Otomatis').count()) > 0);
    await page.waitForTimeout(600);
    const popup = await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count();
    ok('pop-up peringatan Siaga/Kritis muncul', popup > 0);
    if (popup) await page.keyboard.press('Escape');

    console.log('\n== BULK ACTION SISWA ==');
    await page.click('aside nav button:has-text("Data Siswa")');
    await page.waitForSelector('text=Daftar Siswa');
    await page.waitForTimeout(600);
    const checks = page.locator('table.tbl tbody input[type="checkbox"]');
    ok('checkbox per baris tersedia', (await checks.count()) > 10, String(await checks.count()));
    ok('tombol aksi masal tersedia',
      (await page.locator('button:has-text("Hapus Terpilih")').count()) > 0 &&
      (await page.locator('button:has-text("Pindah Kelas Masal")').count()) > 0);
    await checks.nth(0).check();
    await checks.nth(1).check();
    ok('menghitung baris terpilih', /2 dipilih/.test(await page.locator('text=/\\d+ dipilih/').first().innerText()));
    const header = page.locator('table.tbl thead input[type="checkbox"]');
    await header.check();
    const total = await checks.count();
    ok('pilih semua mencentang seluruh baris', /(\d+) dipilih/.test(await page.locator('text=/\\d+ dipilih/').first().innerText()) &&
      Number((await page.locator('text=/\\d+ dipilih/').first().innerText()).match(/(\d+)/)[1]) === total);
    await header.uncheck();
    ok('batal pilih semua mengosongkan pilihan', /0 dipilih/.test(await page.locator('text=/\\d+ dipilih/').first().innerText()));

    // pindah kelas masal 2 baris
    await checks.nth(0).check();
    await checks.nth(1).check();
    const kelasSelect = page.locator('select').filter({ hasText: 'kelas tujuan' });
    await kelasSelect.selectOption({ index: 2 });
    await page.click('button:has-text("Pindah Kelas Masal")');
    await page.waitForTimeout(1100);
    ok('pindah kelas masal berhasil (notifikasi)', (await page.locator('text=dipindahkan ke').count()) > 0);

    // detail siswa: riwayat pembinaan + sanksi
    await page.waitForTimeout(500);
    await page.locator('table.tbl tbody tr').first().locator('button').first().click();
    await page.waitForTimeout(900);
    ok('modal siswa memuat riwayat pembinaan', (await page.locator('text=Riwayat Pembinaan / Tindak Lanjut').count()) > 0);
    ok('modal siswa memuat rekomendasi sanksi', (await page.locator('text=Rekomendasi sanksi otomatis').count()) > 0);
    await page.keyboard.press('Escape');

    console.log('\n== IMPORT AKUN GURU & HAPUS MASAL ==');
    await page.click('aside nav button:has-text("Akun Pengguna")');
    await page.waitForSelector('text=Daftar Akun');
    ok('tombol Import Akun Guru', (await page.locator('button:has-text("Import Akun Guru")').count()) > 0);
    ok('tombol Template akun guru', (await page.locator('a:has-text("Template")').count()) > 0);
    ok('tombol Hapus Masal', (await page.locator('button:has-text("Hapus Masal")').count()) > 0);
    const userChecks = page.locator('table.tbl tbody input[type="checkbox"]');
    ok('checkbox baris akun tersedia', (await userChecks.count()) > 5, String(await userChecks.count()));
    await page.locator('table.tbl thead input[type="checkbox"]').check();
    ok('pilih semua akun', /\d+ akun dipilih/.test(await page.locator('text=/\\d+ akun dipilih/').first().innerText()));
    await page.locator('table.tbl thead input[type="checkbox"]').uncheck();
    await page.click('button:has-text("Import Akun Guru")');
    await page.waitForSelector('text=Import Akun Guru / Pegawai dari Excel');
    await page.keyboard.press('Escape');

    console.log('\n== PROFIL AKUN ==');
    await page.click('aside button:has-text("Profil Akun")');
    await page.waitForSelector('text=Kartu Identitas');
    ok('form profil: nama, username, sandi', (await page.locator('text=Ubah Kata Sandi').count()) > 0 &&
      (await page.locator('text=Data Akun').count()) > 0);
    const namaInput = page.locator('form input').first();
    await namaInput.fill('Administrator Sistem');
    await page.click('button:has-text("Simpan Profil")');
    await page.waitForTimeout(1000);
    ok('simpan profil berhasil', (await page.locator('text=Profil akun diperbarui').count()) > 0);

    console.log('\n== TINDAK LANJUT ==');
    await page.click('aside nav button:has-text("Tindak Lanjut")');
    await page.waitForSelector('text=Catat Hasil Pendekatan');
    ok('form tindak lanjut lengkap', (await page.locator('text=Jenis Pendekatan / Metode').count()) > 0 &&
      (await page.locator('text=Status Penanganan').count()) > 0 &&
      (await page.locator('text=Sesi Berikutnya').count()) > 0);
    await page.locator('form select').first().selectOption({ index: 1 });
    await page.locator('form textarea').fill('Pendekatan uji otomatis: siswa berkomitmen memperbaiki kehadiran.');
    await page.click('button:has-text("Simpan Catatan")');
    await page.waitForTimeout(1200);
    ok('catatan tersimpan dan muncul di riwayat', (await page.locator('text=Pendekatan uji otomatis').count()) > 0);

    console.log('\n== BUKU PENGHUBUNG ==');
    await page.click('aside nav button:has-text("Buku Penghubung")');
    await page.waitForSelector('text=Catat Temuan Cepat');
    ok('form buku penghubung: jam & lokasi', (await page.locator('text=Jam Temuan').count()) > 0 &&
      (await page.locator('text=Lokasi Temuan').count()) > 0);
    /* ronde 4: siswa dipilih lewat autocomplete, bukan <select> */
    const namaSiswa = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/siswa-options?limit=3');
      const j = await r.json();
      return (j.rows || [])[0] ? j.rows[0].nama : '';
    });
    await page.fill('form [data-student-picker]', String(namaSiswa).slice(0, 3));
    await page.waitForTimeout(700);
    await page.locator('form [data-pick]').first().click();
    await page.locator('form select').nth(0).selectOption({ index: 1 }); // kategori
    await page.locator('form select').nth(1).selectOption({ index: 1 }); // lokasi
    await page.locator('form textarea').fill('Temuan uji: atribut tidak lengkap saat gerbang');
    await page.click('button:has-text("Simpan & Teruskan ke Poin Siswa")');
    await page.waitForTimeout(1300);
    ok('temuan tercatat + rekomendasi', (await page.locator('text=siswa tercatat').count()) > 0 ||
      (await page.locator('text=poin tercatat').count()) > 0);

    console.log('\n== ANALITIK POLA ==');
    await page.click('aside nav button:has-text("Analitik Pola")');
    await page.waitForSelector('text=Analitik Pola & Tren Pelanggaran');
    ok('insight hari/jam/lokasi', (await page.locator('text=Hari Paling Rawan').count()) > 0 &&
      (await page.locator('text=Jam Paling Rawan').count()) > 0 &&
      (await page.locator('text=Lokasi Paling Rawan').count()) > 0);
    ok('grafik hari & jam dirender', (await page.locator('text=Distribusi per Hari').count()) > 0 &&
      (await page.locator('text=Distribusi per Jam').count()) > 0);

    console.log('\n== PENGATURAN: LOKASI & SANKSI ==');
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(500);
    await page.click('.tab:has-text("Identitas Sekolah")');
    await page.waitForTimeout(400);
    ok('field Wakasek Kesiswaan pada Identitas Sekolah', (await page.locator('text=Wakasek Kesiswaan').count()) > 0 &&
      (await page.locator('text=Nama Wakasek Kesiswaan').count()) > 0);
    await page.click('.tab:has-text("Lokasi & Sanksi")');
    await page.waitForTimeout(500);
    ok('editor daftar lokasi', (await page.locator('text=Daftar Lokasi Kejadian').count()) > 0);
    ok('editor aturan sanksi', (await page.locator('text=Aturan Sanksi Otomatis').count()) > 0);
    ok('pengaturan buku penghubung', (await page.locator('text=Buku Penghubung Digital').count()) > 0);

    console.log('\n== LAPORAN: KOLOM SANKSI & POLA ==');
    await page.click('aside nav button:has-text("Laporan & Surat")');
    await page.waitForSelector('text=Rekapitulasi Poin Murid');
    await page.waitForSelector('table.tbl thead th');
    await page.waitForTimeout(900);
    ok('kolom rekomendasi sanksi di rekap', (await page.locator('th:has-text("Rekomendasi Sanksi")').count()) > 0);
    ok('kartu pola waktu & tempat', (await page.locator('text=Pola Waktu & Tempat Pelanggaran').count()) > 0);

    console.log('\n== PORTAL PUBLIK ==');
    const b2 = await chromium.launch();
    const p2 = await (await b2.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    p2.on('pageerror', e => errors.push('PORTAL: ' + e.message));
    await p2.goto(BASE + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
    ok('tombol "Masuk Aplikasi" dihapus dari portal', (await p2.locator('text=Masuk Aplikasi').count()) === 0);
    ok('label portal mandiri tampil', (await p2.locator('text=Portal Cek Poin Mandiri').count()) > 0);
    const ovf = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('portal mobile tanpa overflow horizontal', ovf <= 2, 'overflow=' + ovf);
    await p2.close();
    await b2.close();

    console.log('\n== MOBILE: MENU BARU ==');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.click('header button[aria-label="Menu"]');
    await page.waitForTimeout(400);
    ok('menu baru tampil di drawer mobile', (await page.locator('aside nav button:has-text("Buku Penghubung")').count()) > 0);
    await page.click('aside nav button:has-text("Buku Penghubung")');
    await page.waitForTimeout(900);
    const ovf2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('buku penghubung mobile tanpa overflow', ovf2 <= 2, 'overflow=' + ovf2);

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
  console.log(`\n=== HASIL UI RONDE 2: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
