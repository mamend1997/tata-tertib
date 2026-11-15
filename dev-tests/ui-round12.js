'use strict';
/* Uji UI ronde 12 (Playwright): `node dev-tests/ui-round12.js`
   Lokasi manual, input multi-siswa, kategori hapus masal, riwayat di dashboard,
   WhatsApp masal + riwayat pengirim, dan menu Masukan & Kendala. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui12-' + Date.now() + '.sqlite');
const PORT = 5480 + Math.floor(Math.random() * 150);
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

    console.log('\n== INPUT KEJADIAN: URUTAN FIELD & KOMPONEN BARU ==');
    await page.click('aside nav button:has-text("Kejadian")');
    await page.waitForSelector('text=Form Input Kejadian');
    ok('field "Judul Kejadian" dihapus', (await page.locator('form label:has-text("Judul Kejadian")').count()) === 0);
    ok('jenis temuan berbentuk tombol (bukan dropdown)',
      (await page.locator('[data-jenis-opt="pelanggaran"]').count()) === 1 &&
      (await page.locator('[data-jenis-opt="prestasi"]').count()) === 1);
    ok('pemilih siswa multi (chip) tersedia', (await page.locator('[data-multi-picker]').count()) === 1);
    ok('kategori punya kotak pencarian', (await page.locator('[data-kategori-search]').count()) === 1);
    ok('keterangan ditandai opsional', (await page.locator('text=Opsional — boleh dikosongkan.').count()) > 0);

    /* urutan field: tanggal → siswa → lokasi → jenis → kategori */
    const urutan = await page.evaluate(() => {
      const f = document.querySelector('form[data-form="kejadian"]');
      const marks = [
        ['tanggal', f.querySelector('[data-field="tanggal"]')],
        ['siswa', f.querySelector('[data-multi-picker]')],
        ['lokasi', f.querySelector('[data-lokasi-select]')],
        ['jenis', f.querySelector('[data-jenis-field]')],
        ['kategori', f.querySelector('[data-kategori-field]')],
        ['keterangan', f.querySelector('[data-field="keterangan"]')]
      ];
      const pos = marks.map(([k, el]) => [k, el ? el.compareDocumentPosition(el.getRootNode().body) && el.getBoundingClientRect().top : -1]);
      return pos.sort((a, b) => a[1] - b[1]).map(x => x[0]);
    });
    ok('urutan field sesuai permintaan', JSON.stringify(urutan) === JSON.stringify(['tanggal', 'siswa', 'lokasi', 'jenis', 'kategori', 'keterangan']), JSON.stringify(urutan));

    console.log('\n== LOKASI "LAINNYA" → INPUT MANUAL ==');
    await page.selectOption('[data-lokasi-select]', { label: 'Lainnya' });
    await page.waitForSelector('[data-lokasi-manual]');
    ok('memilih Lainnya memunculkan input manual', await page.locator('[data-lokasi-manual]').isVisible());
    await page.fill('[data-lokasi-manual]', 'Belakang Lab Komputer');

    console.log('\n== SIMPAN MULTI-SISWA ==');
    const nama = await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/siswa-options?limit=5');
      return ((await r.json()).rows || []).map(s => s.nama);
    });
    await page.fill('[data-multi-input]', String(nama[0]).slice(0, 3));
    await page.waitForTimeout(650);
    await page.locator('[data-pick]').first().click();
    await page.fill('[data-multi-input]', String(nama[1] || nama[0]).slice(0, 3));
    await page.waitForTimeout(650);
    await page.locator('[data-pick]').first().click();
    ok('dua siswa terpilih (chip)', (await page.locator('[data-chip-list] span').count()) >= 2);
    await page.locator('[data-kategori-select]').selectOption({ index: 1 });
    await page.click('[data-save="kejadian"]');
    await page.waitForTimeout(1400);
    ok('tersimpan untuk lebih dari satu siswa',
      (await page.locator('text=/Tercatat untuk \\d+ siswa/').count()) > 0, 'toast tidak muncul');

    console.log('\n== DASHBOARD: RIWAYAT AKTIVITAS & HAPUS MASAL ==');
    await page.click('aside nav button:has-text("Dashboard")');
    await page.waitForSelector('text=Riwayat Aktivitas Siswa', { timeout: 15000 });
    ok('tabel riwayat tersedia', (await page.locator('[data-tbl="riwayat"]').count()) === 1);
    ok('kolom pelapor ada', (await page.locator('[data-tbl="riwayat"] th:has-text("Pelapor")').count()) === 1);
    const pelapor = await page.locator('[data-tbl="riwayat"] tbody tr td[data-pelapor]').first().innerText();
    ok('nama pelapor terisi', String(pelapor).trim().length > 1, pelapor);
    ok('lokasi manual ikut tampil di riwayat', (await page.locator('text=Belakang Lab Komputer').count()) > 0);
    await page.locator('[data-tbl="riwayat"] tbody input[type="checkbox"]').first().check();
    ok('tombol hapus masal aktif setelah memilih', await page.locator('[data-riwayat-hapus]').isEnabled());
    const totalRow = await page.locator('[data-tbl="riwayat"] tbody tr').count();
    await page.locator('[data-riwayat-all]').check();
    ok('pilih semua mencentang seluruh baris',
      (await page.locator('[data-tbl="riwayat"] tbody input[type="checkbox"]:checked').count()) === totalRow,
      `${await page.locator('[data-tbl="riwayat"] tbody input[type="checkbox"]:checked').count()}/${totalRow}`);
    page.once('dialog', d => d.accept());
    await page.click('[data-riwayat-hapus]');
    await page.waitForTimeout(1500);
    ok('baris riwayat berkurang setelah hapus masal',
      (await page.locator('[data-tbl="riwayat"] tbody tr').count()) < totalRow);

    console.log('\n== KATEGORI: CEKLIS & HAPUS TERPILIH ==');
    /* navigasi langsung (label sidebar bisa ambigu dengan "Soal & Kategori Asesmen") */
    await page.goto(BASE + '/#/kategori', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-kategori-all]', { timeout: 20000 });
    ok('tombol Pilih Semua tersedia', (await page.locator('[data-kategori-all]').count()) === 1);
    ok('tombol Hapus Terpilih tersedia', (await page.locator('[data-kategori-hapus]').count()) === 1);
    await page.locator('[data-kategori-item]').first().check();
    ok('penghitung terpilih berubah', (await page.locator('[data-kategori-count]').innerText()).trim() === '1');
    await page.locator('[data-kategori-all]').check();
    const semuaKat = await page.locator('[data-kategori-item]').count();
    ok('pilih semua mencentang semua kategori',
      (await page.locator('[data-kategori-item]:checked').count()) === semuaKat, String(semuaKat));
    await page.locator('[data-kategori-all]').uncheck();

    console.log('\n== DATA SISWA: WHATSAPP MASAL & RIWAYAT ==');
    await page.click('aside nav button:has-text("Data Siswa")');
    await page.waitForSelector('text=Daftar Siswa');
    await page.waitForTimeout(700);
    ok('tombol kirim WA masal tersedia', (await page.locator('[data-wa-massal]').count()) === 1);
    ok('kartu riwayat WhatsApp + info jeda ada',
      (await page.locator('text=Riwayat Pengiriman WhatsApp').count()) > 0 &&
      (await page.locator('text=/Penguncian jeda/').count()) > 0);
    /* kirim satu pesan lewat tombol per baris agar riwayat terisi */
    await page.locator('[data-tbl="wa-log"], table.tbl').first().waitFor({ state: 'attached' });
    const waBtn = page.locator('table.tbl tbody button[title*="WhatsApp"]').first();
    if (await waBtn.count()) {
      await waBtn.click();
      await page.waitForTimeout(1200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
    ok('kolom tanggal/waktu/akun pengirim pada riwayat',
      (await page.locator('th:has-text("Akun Pengirim")').count()) >= 1,
      'kolom riwayat WA tidak ditemukan');

    console.log('\n== PENGATURAN: TAB WHATSAPP GATEWAY ==');
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(500);
    await page.click('.tab:has-text("WhatsApp Gateway")');
    await page.waitForTimeout(500);
    ok('form gateway tampil', (await page.locator('[data-wa-url]').count()) === 1);
    ok('setelan jeda WA (24 jam) tampil', (await page.inputValue('[data-wa-cooldown]')) === '24');
    ok('setelan jeda input kejadian tampil', (await page.locator('[data-input-cooldown]').count()) === 1);
    ok('template pesan dapat diedit', (await page.locator('[data-wa-template]').count()) === 1);

    console.log('\n== MASUKAN & KENDALA ==');
    await page.click('aside nav button:has-text("Masukan & Kendala"):not(:has-text("User"))');
    await page.waitForSelector('text=Kirim Masukan / Kendala');
    await page.locator('form[data-form="feedback"] textarea').fill('Uji otomatis: mohon tambahkan filter bulan pada laporan.');
    await page.click('[data-save="feedback"]');
    await page.waitForTimeout(1200);
    ok('masukan terkirim & tampil pada daftar', (await page.locator('text=Uji otomatis: mohon tambahkan filter').count()) > 0);
    await page.click('aside nav button:has-text("Masukan & Kendala User")');
    await page.waitForSelector('text=Masukan & Kendala User');
    ok('admin melihat rekap semua masukan', (await page.locator('[data-tbl="feedback-admin"]').count()) === 1);

    console.log('\n== MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 820 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman rekap tanpa overflow horizontal', overflow <= 2, String(overflow));
    await page.click('aside nav button:has-text("Kejadian")').catch(async () => {
      await page.click('button[aria-label="Menu"]');
      await page.click('aside nav button:has-text("Kejadian")');
    });
    await page.waitForTimeout(700);
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

  console.log(`\n=== HASIL UI RONDE 12: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
