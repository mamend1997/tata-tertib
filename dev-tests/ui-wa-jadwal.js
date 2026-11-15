process.env.TZ = 'Asia/Jakarta';
'use strict';
/* Uji UI (Playwright):
   - Desain Jadwal Pelajaran: pilihan ISI SEL (kode/nama mapel/guru/ruang/gabungan),
     lebar kolom JAM & ukuran font, pratinjau langsung, tersimpan setelah reload
   - Pengaturan → WhatsApp Gateway: kartu Pengingat Jadwal & Peringatan Check-in
     (sakelar, menit, template, nomor Guru Piket, tombol Cek Pengingat)
   - mobile 390px tanpa overflow & tanpa error JS
   Jalankan: node dev-tests/ui-wa-jadwal.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uiwaj-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uiwaj-saas-' + Date.now() + '.sqlite');
const PORT = 5500 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2400));
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1420, height: 940 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  try {
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.waitForTimeout(700);

    /* ================= 1. DESAIN JADWAL: ISI SEL & UKURAN KOLOM ================= */
    console.log('\n== 1. DESAIN JADWAL: ISI TABEL & UKURAN KOLOM ==');
    await page.goto(BASE + '/#/desain_jadwal');
    await page.waitForSelector('[data-desain-sel]', { timeout: 15000 });
    await page.waitForTimeout(600);
    ok('5 pilihan isi sel tersedia', (await page.locator('[data-desain-sel]').count()) === 5,
      String(await page.locator('[data-desain-sel]').count()));
    ok('pilihan kode & nama mapel aktif secara bawaan',
      await page.locator('[data-desain-sel="kode"]').isChecked() && await page.locator('[data-desain-sel="nama"]').isChecked());
    ok('input lebar kolom JAM tersedia', (await page.locator('[data-desain-kolom-jam]').count()) === 1);
    ok('input ukuran font tabel tersedia', (await page.locator('[data-desain-kolom-font]').count()) === 1);

    const pratinjauAwal = (await page.textContent('[data-desain-preview]')) || '';
    ok('pratinjau memuat kode, nama & guru', /MTK/.test(pratinjauAwal) && /Matematika/.test(pratinjauAwal) && /Budi/.test(pratinjauAwal),
      pratinjauAwal.slice(0, 100));

    await page.uncheck('[data-desain-sel="nama"]');
    await page.waitForTimeout(250);
    const pratinjauTanpaNama = (await page.textContent('[data-desain-preview]')) || '';
    ok('nama mapel hilang dari pratinjau saat dimatikan', !/Matematika/.test(pratinjauTanpaNama) && /MTK/.test(pratinjauTanpaNama),
      pratinjauTanpaNama.slice(0, 100));

    await page.fill('[data-desain-kolom-jam]', '124');
    await page.fill('[data-desain-kolom-font]', '9');
    await page.waitForTimeout(250);
    const lebarJam = await page.evaluate(() => {
      const th = document.querySelector('[data-desain-preview]')?.closest('table')?.querySelector('th');
      return th ? th.style.width : '';
    });
    ok('pratinjau mengikuti lebar kolom JAM', lebarJam === '124px', lebarJam);

    await page.click('[data-desain-simpan]');
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForSelector('[data-desain-sel]', { timeout: 15000 });
    await page.waitForTimeout(700);
    ok('pilihan isi sel tersimpan setelah reload', !(await page.locator('[data-desain-sel="nama"]').isChecked()));
    ok('lebar kolom JAM tersimpan setelah reload',
      (await page.inputValue('[data-desain-kolom-jam]')) === '124', await page.inputValue('[data-desain-kolom-jam]'));
    ok('ukuran font tersimpan setelah reload',
      (await page.inputValue('[data-desain-kolom-font]')) === '9', await page.inputValue('[data-desain-kolom-font]'));

    const cetak = await page.evaluate(async () => (await fetch('/api/jadwal/cetak?mode=kelas', { credentials: 'same-origin' })).text());
    ok('hasil cetak memakai lebar kolom & font pilihan', /th\.jam\{width:124px/.test(cetak) && /font-size:9pt/.test(cetak));

    /* kembalikan pilihan lengkap lewat UI (checkbox nama) */
    await page.check('[data-desain-sel="nama"]');
    await page.click('[data-desain-simpan]');
    await page.waitForTimeout(1000);
    ok('pilihan lengkap dapat diaktifkan kembali', await page.locator('[data-desain-sel="nama"]').isChecked());

    /* ================= 2. PENGATURAN WA: PENGINGAT & PERINGATAN ================= */
    console.log('\n== 2. PENGATURAN: PENGINGAT JADWAL & PERINGATAN CHECK-IN ==');
    await page.click('aside nav button:has-text("Pengaturan")');
    await page.waitForTimeout(600);
    await page.click('.tab:has-text("WhatsApp Gateway")');
    await page.waitForTimeout(600);
    const kartu = await page.locator('text=Pengingat Jadwal & Peringatan Check-in').count();
    ok('kartu pengingat jadwal tampil', kartu >= 1, String(kartu));
    ok('sakelar pengingat sebelum jam pelajaran tersedia', (await page.locator('[data-wa-jadwal-ingat]').count()) === 1);
    ok('sakelar peringatan belum check-in tersedia', (await page.locator('[data-wa-jadwal-telat]').count()) === 1);
    ok('sakelar laporan ke manajemen tersedia', (await page.locator('[data-wa-jadwal-telat-atasan]').count()) === 1);
    ok('isian menit pengingat bawaan 15', (await page.inputValue('[data-wa-jadwal-ingat-menit]')) === '15',
      await page.inputValue('[data-wa-jadwal-ingat-menit]'));
    ok('isian menit keterlambatan bawaan 15', (await page.inputValue('[data-wa-jadwal-telat-menit]')) === '15');
    ok('kolom nomor Guru Piket tersedia', (await page.locator('[data-wa-piket]').count()) === 1);
    ok('tombol Cek Pengingat Sekarang tersedia', (await page.locator('[data-wa-jadwal-cek]').count()) === 1);

    await page.check('[data-wa-jadwal-ingat]');
    await page.check('[data-wa-jadwal-telat]');
    await page.check('[data-wa-jadwal-telat-atasan]');
    await page.fill('[data-wa-jadwal-ingat-menit]', '20');
    await page.fill('[data-wa-jadwal-telat-menit]', '10');
    await page.fill('[data-wa-piket]', '081200009999');
    await page.click('[data-save="wa"]');
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForSelector('.tab:has-text("WhatsApp Gateway")', { timeout: 15000 });
    await page.click('.tab:has-text("WhatsApp Gateway")');
    await page.waitForTimeout(700);
    ok('sakelar pengingat tersimpan aktif', await page.locator('[data-wa-jadwal-ingat]').isChecked());
    ok('sakelar laporan manajemen tersimpan aktif', await page.locator('[data-wa-jadwal-telat-atasan]').isChecked());
    ok('menit pengingat tersimpan (20)', (await page.inputValue('[data-wa-jadwal-ingat-menit]')) === '20',
      await page.inputValue('[data-wa-jadwal-ingat-menit]'));
    ok('menit keterlambatan tersimpan (10)', (await page.inputValue('[data-wa-jadwal-telat-menit]')) === '10');
    ok('nomor Guru Piket tersimpan (format 62…)', /^6281200009999$/.test(await page.inputValue('[data-wa-piket]')),
      await page.inputValue('[data-wa-piket]'));

    await page.click('[data-wa-jadwal-cek]');
    await page.waitForTimeout(1400);
    ok('tombol cek pengingat memberi umpan balik', (await page.locator('text=/Pemeriksaan selesai|NONAKTIF|Gateway|Tidak ada jadwal/i').count()) >= 1);

    /* ================= 3. MOBILE 390px ================= */
    console.log('\n== 3. MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 820 });
    await page.waitForTimeout(500);
    let ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('pengaturan WhatsApp tanpa overflow horizontal', ov <= 2, String(ov));
    await page.goto(BASE + '/#/desain_jadwal');
    await page.waitForSelector('[data-desain-sel]', { timeout: 15000 });
    await page.waitForTimeout(800);
    ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('desain jadwal tanpa overflow horizontal', ov <= 2, String(ov));

    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL UI WA-JADWAL: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
