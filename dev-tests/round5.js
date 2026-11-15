'use strict';
/* =====================================================================
   RONDE 5 (tata-tertib) — tenant baru TANPA akun bawaan, menu akordeon,
   sidebar interaktif (hover fly-out + sakelar preferensi).
   Jalankan: node dev-tests/round5.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-r5-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 6100 + Math.floor(Math.random() * 700);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x !== undefined ? ' — ' + x : '')); console.log('  ✗ ' + n + (x !== undefined ? ' — ' + x : '')); }
};
function client() {
  let cookie = '';
  const req = async (p, opts = {}) => {
    const r = await fetch(BASE + p, {
      method: opts.method || 'GET',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      redirect: 'manual'
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    if (sc.length) {
      const map = new Map();
      for (const part of (cookie ? cookie.split('; ') : []).concat(sc.map(c => c.split(';')[0]))) {
        const i = part.indexOf('=');
        if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
      }
      cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const ct = r.headers.get('content-type') || '';
    let body = null;
    if (ct.includes('json')) body = await r.json().catch(() => null);
    else body = await r.text();
    return { status: r.status, body };
  };
  return { req, cookieOf: () => cookie };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, APP_TIMEZONE: 'Asia/Jakarta', DEMO_SEED: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));
  try {
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(BASE + '/api/public/config')).ok) break; } catch (e) { }
      await new Promise(r => setTimeout(r, 250));
    }
    const su = client(), t2 = client();
    let r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('login Super Admin', r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 120));

    /* ============ 1. TENANT BARU TANPA AKUN BAWAAN ============ */
    r = await su.req('/api/super/sekolah/simpan', {
      method: 'POST', body: {
        nama: 'SMP Negeri 5 Bersih', jenjang: 'SMP', alamat: 'Jl. Baru 5', kepala: 'Drs. Bersih',
        telp: '081200000009', email_admin: 'smp5@contoh.sch.id',
        admin_username: 'admin', admin_password: 'SandiBersih1', paket: 'basic', trial_hari: 7
      }
    });
    ok('buat sekolah baru', r.status === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 200));
    const kode = r.body.tenant.kode;
    r = await t2.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBersih1', kode } });
    ok('admin sekolah baru bisa masuk', r.status === 200 && r.body.scope === 'tenant', JSON.stringify(r.body).slice(0, 140));

    /* daftar akun dibaca dari panel Super Admin (paket uji coba belum membuka modul Pengguna) */
    r = await su.req('/api/super/sekolah/' + (await su.req('/api/super/sekolah')).body.rows.find(t => t.kode === kode).id);
    const admins = (r.body && r.body.admins) || [];
    ok('sekolah baru hanya punya SATU akun (admin dari form)', admins.length === 1, 'jumlah=' + admins.length + ' → ' + admins.map(a => a.username).join(','));
    ok('akun admin tercatat pada ringkasan sekolah (total pengguna = 1)',
      r.body.jumlah && r.body.jumlah.pengguna === 1, JSON.stringify(r.body.jumlah));
    ok('username akun admin sesuai formulir', admins[0] && admins[0].username === 'admin', admins[0] && admins[0].username);
    ok('akun admin aktif', admins[0] && Number(admins[0].aktif) === 1, admins[0] && admins[0].aktif);

    /* akun contoh bawaan (kepsek/guru/bk/…) TIDAK boleh bisa login lagi */
    const contoh = [['kepsek', 'kepsek123'], ['guru', 'guru123'], ['bk', 'bk123'], ['kesiswaan', 'kesiswaan123']];
    let bisaMasuk = [];
    for (const [u, p] of contoh) {
      const c2 = client();
      const rr = await c2.req('/api/login', { method: 'POST', body: { username: u, password: p, kode } });
      if (rr.status === 200) bisaMasuk.push(u);
    }
    ok('akun contoh bawaan tidak ada / tidak bisa login', bisaMasuk.length === 0, bisaMasuk.join(','));

    /* ============ 2. UI: AKORDEON GRUP + SIDEBAR HOVER ============ */
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ck = t2.cookieOf().split('; ').map(x => x.split('='));
    await ctx.addCookies(ck.map(([name, ...v]) => ({ name, value: v.join('='), domain: '127.0.0.1', path: '/' })));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '/');
    await page.waitForSelector('aside nav', { timeout: 15000 });

    const groupBtns = page.locator('aside nav button[aria-expanded]');
    ok('setiap grup menu memakai tombol akordeon (aria-expanded)', (await groupBtns.count()) >= 4, 'n=' + await groupBtns.count());

    // bawaan: seluruh grup terbuka agar semua menu langsung terlihat
    const nGroup = await groupBtns.count();
    let semuaTerbuka = true;
    for (let i = 0; i < nGroup; i++) if ((await groupBtns.nth(i).getAttribute('aria-expanded')) !== 'true') semuaTerbuka = false;
    ok('bawaan: semua grup menu terbuka (semua menu langsung terlihat)', semuaTerbuka);
    const bukaCount = async () => {
      let n = 0;
      for (let i = 0; i < await groupBtns.count(); i++) if ((await groupBtns.nth(i).getAttribute('aria-expanded')) === 'true') n++;
      return n;
    };
    // AKORDEON EKSKLUSIF: buka grup 2 → hanya grup itu yang terbuka
    await groupBtns.nth(1).click();
    await page.waitForTimeout(180);
    ok('klik judul grup membuka grup tersebut', (await groupBtns.nth(1).getAttribute('aria-expanded')) === 'true');
    ok('AKORDEON EKSKLUSIF: hanya SATU grup terbuka setelah diklik', (await bukaCount()) === 1, 'terbuka=' + await bukaCount());
    ok('grup yang sebelumnya terbuka ikut tertutup', (await groupBtns.nth(0).getAttribute('aria-expanded')) === 'false');
    // buka grup lain lagi → tetap hanya satu
    await groupBtns.nth(2).click();
    await page.waitForTimeout(180);
    ok('berpindah grup tetap menyisakan satu grup terbuka', (await bukaCount()) === 1
      && (await groupBtns.nth(2).getAttribute('aria-expanded')) === 'true'
      && (await groupBtns.nth(1).getAttribute('aria-expanded')) === 'false');
    // klik grup yang sama sekali lagi → semua terlipat
    await groupBtns.nth(2).click();
    await page.waitForTimeout(180);
    ok('klik grup yang sedang terbuka melipat semuanya', (await bukaCount()) === 0, 'terbuka=' + await bukaCount());

    // lipat sidebar → klik tombol lipat
    const lipat = page.locator('aside button[title*="Lipat menu samping"], aside button[title*="Tampilkan menu samping"]').first();
    ok('tombol lipat/tampilkan menu tersedia di desktop', await lipat.count() > 0);
    await lipat.click();
    await page.waitForTimeout(300);
    const widthCollapsed = await page.evaluate(() => document.querySelector('aside').getBoundingClientRect().width);
    ok('sidebar terlipat menjadi ikon saja (±78px)', widthCollapsed < 120, 'lebar=' + Math.round(widthCollapsed));

    // sakelar preferensi ON + kursor mendekat → fly-out terbuka (lebar penuh)
    const pref = page.locator('aside input[type=checkbox]').first();
    ok('sakelar preferensi hover tersedia', await pref.count() > 0);
    await page.hover('aside');
    await page.waitForTimeout(450);
    const widthHover = await page.evaluate(() => {
      const inner = document.querySelectorAll('aside > div')[0];
      return inner ? inner.getBoundingClientRect().width : 0;
    });
    ok('kursor mendekat membuka sidebar (fly-out ±268px)', widthHover > 200, 'lebar panel=' + Math.round(widthHover));
    /* panel melayang harus DI ATAS konten utama (bukan tenggelam) */
    const lapisan = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const panel = aside.querySelector(':scope > div');
      const main = document.querySelector('main');
      const pr = panel.getBoundingClientRect();
      const cx = pr.x + pr.width / 2, cy = pr.y + Math.min(pr.height / 2, 120);
      const atas = document.elementFromPoint(cx, cy);
      return {
        zPanel: Number(getComputedStyle(panel).zIndex) || 0,
        zAside: Number(getComputedStyle(aside).zIndex) || 0,
        diAtasKonten: !!(atas && (panel === atas || panel.contains(atas))),
        menutupiMain: !!(main && main.contains(document.elementFromPoint(pr.right + 30, cy)))
      };
    });
    ok('panel fly-out berada di atas konten (z-index tinggi)', lapisan.diAtasKonten && (lapisan.zPanel >= 50 || lapisan.zAside >= 40),
      JSON.stringify(lapisan));

    // matikan sakelar → fly-out tidak muncul lagi
    await pref.uncheck({ force: true }).catch(async () => { await page.evaluate(() => { const c = document.querySelector('aside input[type=checkbox]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
    await page.mouse.move(700, 400);
    await page.waitForTimeout(350);
    await page.hover('aside');
    await page.waitForTimeout(400);
    const widthOff = await page.evaluate(() => {
      const inner = document.querySelectorAll('aside > div')[0];
      return inner ? inner.getBoundingClientRect().width : 0;
    });
    ok('sakelar OFF mematikan buka-otomatis', widthOff < 200, 'lebar panel=' + Math.round(widthOff));

    // preferensi tersimpan di peramban
    const prefStored = await page.evaluate(() => localStorage.getItem('stt:nav-hover'));
    ok('preferensi hover tersimpan (localStorage)', prefStored === '0', String(prefStored));

    // tampilkan lagi sidebar
    await page.evaluate(() => document.querySelector('aside input[type=checkbox]')?.click());
    await page.evaluate(() => { const b = [...document.querySelectorAll('aside button')].find(x => /Tampilkan menu samping|Lipat menu samping/.test(x.title || '')); b && b.click(); });
    await page.waitForTimeout(300);
    const widthBack = await page.evaluate(() => document.querySelector('aside').getBoundingClientRect().width);
    ok('sidebar dapat ditampilkan kembali', widthBack > 180, 'lebar=' + Math.round(widthBack));

    // mobile: sidebar drawer tetap berfungsi
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal di mobile 390px', overflow <= 0, 'overflow=' + overflow);
    ok('tidak ada error JavaScript', errs.length === 0, errs.join(' | '));
    await browser.close();
  } catch (e) {
    console.error('FATAL', e);
    console.log(log.join('').slice(-2500));
    fail++;
  }
  console.log(`\n=== HASIL RONDE 5 tata-tertib: ${pass} lulus, ${fail} gagal ===`);
  if (fail) console.log('Gagal:\n- ' + fails.join('\n- '));
  srv.kill();
  process.exit(fail ? 1 : 0);
})();
