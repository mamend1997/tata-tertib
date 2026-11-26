'use strict';
/* Uji pratinjau video/PDF pada menu Petunjuk Pengguna akun sekolah. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-panduan-preview-'));
const PORT = 7400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(TMP, 'school.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
};

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(BASE + '/api/public/sekolah');
      if (response.ok) return;
    } catch (e) { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Server uji tidak siap.');
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS,
      APP_TIMEZONE: 'Asia/Jakarta', DEMO_SEED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const serverLogs = [];
  server.stdout.on('data', data => serverLogs.push(String(data)));
  server.stderr.on('data', data => serverLogs.push(String(data)));
  let browser;
  try {
    await waitForServer();
    const schoolData = await (await fetch(BASE + '/api/public/sekolah')).json();
    const kode = schoolData.rows?.[0]?.kode;
    if (!kode) throw new Error('Kode sekolah demo tidak ditemukan.');

    const superLogin = await fetch(BASE + '/api/super/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'superadmin123' })
    });
    const setCookies = superLogin.headers.getSetCookie
      ? superLogin.headers.getSetCookie()
      : [superLogin.headers.get('set-cookie') || ''];
    const cookie = setCookies.map(value => value.split(';')[0]).filter(Boolean).join('; ');
    if (!superLogin.ok || !cookie) throw new Error('Login API Super Admin untuk menyiapkan petunjuk gagal.');

    const guides = [
      ['Drive file', 'https://drive.google.com/file/d/DriveFileId123456789/view?usp=sharing',
        'https://drive.google.com/file/d/DriveFileId123456789/preview'],
      ['Google Docs', 'https://docs.google.com/document/d/DocumentId123456789/edit',
        'https://docs.google.com/document/d/DocumentId123456789/preview'],
      ['PDF HTTPS langsung', 'https://cdn.example.test/panduan.pdf',
        'https://cdn.example.test/panduan.pdf']
    ];
    for (let i = 0; i < guides.length; i++) {
      const response = await fetch(BASE + '/api/super/panduan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          untuk: 'sekolah', judul: guides[i][0], tipe: 'pdf',
          url: guides[i][1], deskripsi: 'Panduan contoh untuk uji pratinjau.',
          urutan: i + 1, aktif: 1
        })
      });
      if (!response.ok) throw new Error(`Gagal menambahkan petunjuk uji: ${await response.text()}`);
    }

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(BASE + '/#/panduan', { waitUntil: 'networkidle' });
    await page.locator('input[placeholder*="kode sekolah"]').fill(String(kode));
    await page.locator('input[autocomplete="username"]').fill('admin');
    await page.locator('input[autocomplete="current-password"]').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await page.waitForSelector('main h2:has-text("Petunjuk Pengguna")', { timeout: 15000 });
    await page.waitForSelector('iframe[data-panduan-preview]', { timeout: 10000 });

    const sources = await page.locator('iframe[data-panduan-preview]').evaluateAll(nodes =>
      nodes.map(node => ({ title: node.title, src: node.src })));
    for (const [title, , expected] of guides) {
      const row = sources.find(item => item.title === `Pratinjau ${title}`);
      ok(`${title} dipratinjau di halaman`, !!row, JSON.stringify(sources));
      if (row) ok(`${title} memakai URL preview yang benar`, row.src === expected, row.src);
    }
    ok('tidak ada error JavaScript pada halaman', pageErrors.length === 0, pageErrors.join(' | '));
    await context.close();
  } catch (error) {
    fail++;
    failures.push('EXCEPTION: ' + error.stack);
    console.error(error);
    console.error(serverLogs.join('').slice(-2000));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 300));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* cleanup best effort */ }
    console.log(`\n=== HASIL UI PETUNJUK PREVIEW: ${pass} lulus, ${fail} gagal ===`);
    if (failures.length) failures.forEach(message => console.log(' - ' + message));
    process.exit(fail ? 1 : 0);
  }
})();
