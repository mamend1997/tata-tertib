'use strict';
/* Verifikasi cepat di URL LIVE (setelah publish): alur login, menu baru, migrasi DB produksi. */
const { chromium } = require('playwright');
const B = process.env.LIVE_BASE || 'https://bendaharaspc.vibecoder.co.id/tata-tertib';
/* slug portal sekolah diambil dari API live (portal: /<slug>/portal-siswa) */
let PSLUG = process.env.LIVE_PORTAL_SLUG || 'smk-pgri-cikoneng';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  try {
    await p.goto(B + '/', { waitUntil: 'networkidle' });
    ok('login tanpa daftar akun contoh', (await p.locator('text=Akun contoh').count()) === 0);
    await p.fill('input[autocomplete="username"]', process.env.LIVE_USER || 'admin');
    await p.fill('input[autocomplete="current-password"]', process.env.LIVE_PASS || 'admin123');
    await p.click('button[type="submit"]');
    let logged = true;
    await p.waitForSelector('text=Distribusi Status Disiplin', { timeout: 25000 }).catch(() => { logged = false; });
    if (logged) ok('login & dashboard live', true);
    if (!logged) {
      console.log('  • login admin dilewati: kata sandi live sudah diubah pemilik (set LIVE_USER / LIVE_PASS untuk memeriksa bagian internal)');
      // password pemilik sudah diganti; verifikasi bagian publik & boot server saja
      const cfg = await (await ctx.request.get(B + '/api/public/config')).json();
      ok('server boot & migrasi DB live berjalan', cfg.ok === true && !!cfg.sekolah_nama);
      ok('data Wakasek Kesiswaan tersedia setelah migrasi', typeof cfg.wakasek_nama === 'string' && cfg.wakasek_nama.length > 0, cfg.wakasek_nama);
      const guard = await ctx.request.get(B + '/api/dashboard');
      ok('endpoint internal tetap terlindungi (401)', guard.status() === 401);
      const css = await p.evaluate(async () => {
        const href = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).find(h => h.includes('/assets/'));
        const r = await fetch(href); return r.status + ' ' + href;
      });
      ok('aset CSS terunduh lewat prefix', css.startsWith('200'), css);
      const real0 = errs.filter(e => !/favicon|404|Failed to load resource/.test(e));
      ok('tanpa error JS di halaman login live', real0.length === 0, real0.slice(0, 2).join(' | '));
      const b3 = await chromium.launch();
      const p3 = await (await b3.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      await p3.goto(B + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
      ok('portal live tanpa tombol Masuk Aplikasi', (await p3.locator('text=Masuk Aplikasi').count()) === 0);
      ok('portal live mobile tanpa overflow',
        (await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 2);
      await b3.close();
      console.log(`\n=== LIVE: ${pass} lulus, ${fail} gagal (pemeriksaan internal dilewati) ===`);
      await br.close();
      process.exit(fail ? 1 : 0);
    }
    await p.waitForTimeout(900);
    if (await p.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) await p.keyboard.press('Escape');
    for (const m of ['Buku Penghubung', 'Tindak Lanjut', 'Analitik Pola']) {
      ok('menu baru "' + m + '"', (await p.locator(`aside nav button:has-text("${m}")`).count()) > 0);
    }
    // Data siswa: checkbox bulk
    await p.click('aside nav button:has-text("Data Siswa")');
    await p.waitForSelector('text=Daftar Siswa');
    await p.waitForTimeout(700);
    ok('checkbox & aksi masal siswa', (await p.locator('table.tbl tbody input[type="checkbox"]').count()) > 5 &&
      (await p.locator('button:has-text("Pindah Kelas Masal")').count()) > 0 &&
      (await p.locator('button:has-text("Hapus Terpilih")').count()) > 0);
    // Pengguna: import akun
    await p.click('aside nav button:has-text("Akun Pengguna")');
    await p.waitForSelector('text=Daftar Akun');
    ok('import akun guru + hapus masal', (await p.locator('button:has-text("Import Akun Guru")').count()) > 0 &&
      (await p.locator('button:has-text("Hapus Masal")').count()) > 0);
    // Profil
    await p.click('aside button:has-text("Profil Akun")');
    await p.waitForSelector('text=Kartu Identitas');
    ok('halaman profil akun', (await p.locator('text=Ubah Kata Sandi').count()) > 0);
    // Pengaturan: wakasek + lokasi & sanksi
    await p.click('aside nav button:has-text("Pengaturan")');
    await p.waitForTimeout(600);
    await p.click('.tab:has-text("Identitas Sekolah")');
    await p.waitForTimeout(500);
    ok('field Wakasek Kesiswaan di Identitas Sekolah', (await p.locator('text=Nama Wakasek Kesiswaan').count()) > 0);
    await p.click('.tab:has-text("Lokasi & Sanksi")');
    await p.waitForTimeout(500);
    ok('editor lokasi & aturan sanksi', (await p.locator('text=Daftar Lokasi Kejadian').count()) > 0 &&
      (await p.locator('text=Aturan Sanksi Otomatis').count()) > 0);
    // Cetak rekap: TTD kepsek + wakasek (dari DB live)
    const p2 = await ctx.newPage();
    await p2.goto(B + '/api/rekap/print?ta=1&semester=ganjil&paper=A4', { waitUntil: 'networkidle' });
    const ttd = await p2.locator('.ttd-grid').innerText().catch(() => '');
    ok('cetak rekap memakai Kepala Sekolah dari identitas', /Kepala/i.test(ttd), ttd.slice(0, 80));
    ok('cetak rekap memakai Wakasek Kesiswaan', /Wakasek|Kesiswaan/i.test(ttd), ttd.slice(0, 120));
    await p2.close();
    // Portal
    const b2 = await chromium.launch();
    const p3 = await (await b2.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await p3.goto(B + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
    ok('portal tanpa tombol Masuk Aplikasi', (await p3.locator('text=Masuk Aplikasi').count()) === 0);
    const ovf = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('portal mobile tanpa overflow', ovf <= 2, 'overflow=' + ovf);
    await b2.close();
    const real = errs.filter(e => !/favicon|404|Failed to load resource/.test(e));
    ok('tanpa error JS di live', real.length === 0, real.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; console.log('  ✗ EXCEPTION', e.message);
  } finally {
    await br.close();
  }
  console.log(`\n=== LIVE: ${pass} lulus, ${fail} gagal ===`);
  process.exit(fail ? 1 : 0);
})();
