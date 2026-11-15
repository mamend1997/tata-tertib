'use strict';
/* Uji cetak: dokumen surat & rekapitulasi harus pas 1 halaman A4/F4, kop & TTD tidak terpotong.
   Jalankan: node dev-tests/print.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-print-' + Date.now() + '.sqlite');
const PORT = 5400 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const pagesOf = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1800));
  KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/');
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.close();

    let p = await ctx.newPage();
    await p.goto(BASE + '/api/surat/1?jenis=panggilan', { waitUntil: 'networkidle' });
    const kop = await p.locator('.kop .nama').innerText();
    ok('surat: kop nama sekolah tampil', /SMK PGRI/i.test(kop), kop);
    ok('surat: judul & nomor', (await p.locator('h2.judul').innerText()) === 'SURAT PEMANGGILAN ORANG TUA / WALI' && /Nomor:/.test(await p.locator('.nomor').innerText()));
    ok('surat: tabel rincian pelanggaran', (await p.locator('table.data tbody tr').count()) > 0);
    ok('surat: TTD kepala sekolah + wali kelas', (await p.locator('.ttd').count()) === 2 && /Kepala/.test(await p.locator('.ttd').first().innerText()) && /Wali Kelas/.test(await p.locator('.ttd').last().innerText()));
    await p.emulateMedia({ media: 'print' });
    let pdf = await p.pdf({ format: 'A4', printBackground: true });
    ok('surat: tercetak 1 halaman A4', pagesOf(pdf) === 1, 'halaman=' + pagesOf(pdf));
    ok('surat: toolbar tidak ikut tercetak', !/Cetak \/ Simpan PDF/.test(pdf.toString('latin1')));
    await p.close();

    p = await ctx.newPage();
    await p.goto(BASE + '/api/surat/1?jenis=sp3&paper=F4', { waitUntil: 'networkidle' });
    const css = await p.locator('style').first().innerText();
    ok('surat SP3: ukuran kertas F4', /215mm 330mm/.test(css) && /SURAT PERINGATAN KETIGA/.test(await p.locator('h2.judul').innerText()));
    await p.emulateMedia({ media: 'print' });
    pdf = await p.pdf({ width: '215mm', height: '330mm', printBackground: true });
    ok('surat SP3: 1 halaman F4', pagesOf(pdf) === 1, 'halaman=' + pagesOf(pdf));
    await p.close();

    /* Tambah siswa agar rekap benar-benar multi-halaman (footer "Dicetak …" sudah dihapus
       pada ronde 22 sehingga dokumen contoh sebelumnya menjadi 1 halaman). */
    const seedPage = await ctx.newPage();
    await seedPage.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await seedPage.evaluate(async () => {
      const j = await (await fetch('/api/jadwal', { credentials: 'same-origin' })).json();
      const kelasId = (j.kelas || [])[0] && j.kelas[0].id;
      for (let i = 1; i <= 60; i++) {
        await fetch('/api/siswa/save', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nama: `Siswa Cetak ${i}`, kelas_id: kelasId, gender: i % 2 ? 'L' : 'P', nis: `PC${i}` })
        });
      }
    });
    await seedPage.close();
    p = await ctx.newPage();
    await p.goto(BASE + '/api/rekap/print?ta=1&semester=ganjil&paper=A4', { waitUntil: 'networkidle' });
    const th = await p.locator('table.data thead th').allInnerTexts();
    ok('rekap: kolom lengkap', ['No', 'NISN', 'Nama Murid', 'Kelas', 'Pel', 'Pres', 'Total', 'Status', 'Keterangan'].every(h => th.includes(h)), th.join('|'));
    ok('rekap: footer TTD 2 kolom + tempat-tanggal', (await p.locator('.ttd').count()) === 2 && /Cikoneng,/.test(await p.locator('.tanggal').innerText()));
    await p.emulateMedia({ media: 'print' });
    pdf = await p.pdf({ format: 'A4', printBackground: true });
    const n = pagesOf(pdf);
    ok('rekap: multi-halaman dengan header berulang', n >= 2, 'halaman=' + n);
    await p.close();

    p = await ctx.newPage();
    await p.goto(BASE + '/api/rekap/print?ta=1&semester=ganjil&kelas=1&paper=F4', { waitUntil: 'networkidle' });
    ok('rekap per kelas: wali kelas di TTD kanan', /Wali Kelas/.test(await p.locator('.ttd').last().innerText()));
    await p.close();
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message); console.error(e);
  } finally {
    await browser.close();
    srv.kill('SIGKILL');
    ['', '-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL CETAK: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
