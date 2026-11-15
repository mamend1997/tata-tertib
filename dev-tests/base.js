'use strict';
/* Uji publikasi di bawah sub-path: meniru platform (strip prefix /<slug> + header X-Public-Base-Path).
   Jalankan: node dev-tests/base.js */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-base-' + Date.now() + '.sqlite');
const APP_PORT = 5713, PORT = 5714;
const UP = 'http://127.0.0.1:' + APP_PORT;
const BASE = 'http://127.0.0.1:' + PORT;
const SLUG = '/tata-tertib';
let KODE = '';
let PSLUG = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(APP_PORT), DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
});
srv.stderr.on('data', d => process.stderr.write('[app] ' + d));

/* proxy sederhana yang meniru perilaku platform */
const proxy = http.createServer((req, res) => {
  let p = req.url || '/';
  if (!p.startsWith(SLUG)) { res.writeHead(404); return res.end('not found'); }
  p = p.slice(SLUG.length) || '/';
  const headers = { ...req.headers, host: '127.0.0.1:' + APP_PORT, 'x-public-base-path': SLUG };
  const up = http.request({ host: '127.0.0.1', port: APP_PORT, path: p, method: req.method, headers }, r2 => {
    res.writeHead(r2.statusCode, r2.headers);
    r2.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end('bad gateway ' + e.message); });
  req.pipe(up);
});

(async () => {
  await new Promise(r => setTimeout(r, 1600));
  await new Promise(r => proxy.listen(PORT, r));
  const sek0 = ((await (await fetch(UP + '/api/public/sekolah')).json()).rows[0] || {});
  KODE = sek0.kode || '';
  PSLUG = sek0.portal_slug || '';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('pageerror', e => failed.push('JS: ' + e.message));
  try {
    await page.goto(BASE + SLUG + '/' + PSLUG + '/portal-siswa', { waitUntil: 'networkidle' });
    const info = await page.evaluate(() => ({
      baseURI: document.baseURI,
      css: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).filter(h => h.includes('127.0.0.1')),
      js: [...document.querySelectorAll('script[src]')].map(s => s.src),
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      title: document.title,
      api: window.__BASE__
    }));
    ok('aset JS/CSS memakai prefix slug', info.css.every(u => u.includes(SLUG + '/assets/')) && info.js.every(u => u.includes(SLUG + '/assets/')), JSON.stringify(info.css.concat(info.js)));
    ok('window.__BASE__ = slug', info.api === SLUG, info.api);
    ok('tema & judul portal memakai pengaturan sekolah', info.primary.toLowerCase() === '#ea580c' && /SMK PGRI/.test(info.title), info.primary + ' / ' + info.title);

    await page.goto(BASE + SLUG + '/', { waitUntil: 'networkidle' });
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="current-password"]', 'admin123');
    await page.waitForFunction(k => document.querySelector('input[placeholder*="kode sekolah"]')?.value === k, KODE);
    ok('kode tenant tunggal terisi otomatis di halaman login',
      await page.locator('input[placeholder*="kode sekolah"]').inputValue() === KODE, KODE);
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
    await page.waitForTimeout(700);
    if (await page.locator('text=Peringatan Dini — Siswa Siaga & Kritis').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    ok('login & dashboard berjalan di sub-path', (await page.locator('.kpi').count()) >= 4);
    await page.click('aside nav button:has-text("Laporan & Surat")');
    await page.waitForSelector('text=Rekapitulasi Poin Murid');
    ok('navigasi SPA tidak keluar dari prefix', page.url().startsWith(BASE + SLUG), page.url());
    const cssStatus = await page.evaluate(async () => {
      const href = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).find(h => h.includes('/assets/'));
      const r = await fetch(href);
      return r.status + ' ' + href;
    });
    ok('stylesheet terunduh 200 lewat prefix', cssStatus.startsWith('200'), cssStatus);
    ok('tidak ada request gagal / error JS', failed.length === 0, failed.slice(0, 3).join(' | '));
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message); console.error(e);
  } finally {
    await browser.close();
    proxy.close();
    srv.kill('SIGKILL');
    ['', '-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL SUB-PATH: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
