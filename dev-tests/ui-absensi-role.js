'use strict';
/* =====================================================================
   UI — MENU ABSENSI TERSEDIA UNTUK PIMPINAN & GURU BERPENJADWAL (Playwright)

   Memastikan di antarmuka:
   · Wakasek Kesiswaan melihat menu absensi dan hanya jadwal miliknya
   · Jadwal guru lain tidak muncul dan tidak dapat dikelola
   · Tanpa error JS & tanpa overflow di 390px

   Jalankan: node dev-tests/ui-absensi-role.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

process.env.TZ = 'Asia/Jakarta';
const DB = path.join(os.tmpdir(), 'stt-absrole-ui-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-absrole-ui-saas-' + Date.now() + '.sqlite');
const PORT = 6900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const cur = now.getHours() * 60 + now.getMinutes();
const HARI = now.getDay();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 1440) + 1440) % 1440 % 60)}`;

let cookie = '';
async function req(p, opt = {}) {
  const r = await fetch(BASE + p, {
    method: opt.method || 'GET',
    headers: { ...(opt.body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  let body = null;
  try { body = ct.includes('json') ? await r.json() : await r.text(); } catch (e) { body = null; }
  return { status: r.status, body };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, TZ: 'Asia/Jakarta', APP_TIMEZONE: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2500));
  try {
    const publik = await (await fetch(BASE + '/api/public/sekolah')).json();
    const KODE = publik.rows[0].kode;
    let r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'admin', password: 'admin123' } });
    ok('login administrator', r.status === 200);

    r = await req('/api/bootstrap');
    const taId = (r.body.tahun.find(t => Number(t.aktif) === 1) || r.body.tahun[0] || {}).id;
    await req('/api/users/save', { method: 'POST', body: { nama: 'Guru A', username: 'guA', password: 'guA123', role: 'guru' } });
    await req('/api/users/save', { method: 'POST', body: { nama: 'Guru B', username: 'guB', password: 'guB123', role: 'guru' } });
    await req('/api/users/save', { method: 'POST', body: { nama: 'Wakasek Kesiswaan', username: 'wks', password: 'wks123', role: 'kesiswaan', jabatan: 'Wakasek Kesiswaan' } });
    const users = (await req('/api/users')).body.rows;
    const gA = users.find(u => u.username === 'guA');
    const gB = users.find(u => u.username === 'guB');
    const wks = users.find(u => u.username === 'wks');

    const matrix = JSON.parse(JSON.stringify((await req('/api/users')).body.perms));
    const perm = matrix.kesiswaan || {};
    for (const feat of ['absensi_guru', 'absensi_siswa', 'rekap_absensi_guru']) perm[feat] = { view: 1, write: 1 };
    await req('/api/permissions', { method: 'POST', body: { role: 'kesiswaan', perms: perm } });

    const mapelA = (await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel A', kode: 'MPA', guru_ids: [gA.id] } })).body.id;
    const mapelB = (await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel B', kode: 'MPB', guru_ids: [gB.id] } })).body.id;
    const kelas = (await req('/api/kelas')).body.rows;
    await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam 1', mulai: hhmm(cur - 20), selesai: hhmm(cur + 20), istirahat: 0 },
          { label: 'Jam 2', mulai: hhmm(cur + 21), selesai: hhmm(cur + 60), istirahat: 0 }
        ],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 5, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 120 },
        wa: { aktif: 0, jam: '14:00' }
      }
    });
    const slotA = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelA, kelas_ids: [kelas[0].id], abaikan: 1 } });
    const slotB = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelB, kelas_ids: [kelas[1].id], abaikan: 1 } });
    await req('/api/mapel/save', { method: 'POST', body: { id: mapelA, nama: 'Mapel A', kode: 'MPA', guru_ids: [wks.id] } });
    await req('/api/jadwal/slot', {
      method: 'POST',
      body: { id: slotA.body.id, hari: HARI, sesi: 1, mapel_id: mapelA, guru_id: wks.id, kelas_ids: [kelas[0].id], abaikan: 1 }
    });

    /* ---------------- Playwright ---------------- */
    const errs = [];
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.fill('input[placeholder*="kode sekolah"]', KODE);
    await page.fill('input[autocomplete="username"], input >> nth=1', 'wks');
    await page.fill('input[type="password"]', 'wks123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2200);

    /* ---------- menu absensi tersedia untuk Wakasek Kesiswaan ---------- */
    const navText = await page.locator('aside nav').innerText();
    ok('menu Absensi Guru Mapel tampil', /Absensi Guru Mapel/i.test(navText), navText);
    ok('menu Absensi Siswa per Mapel tampil', /Absensi Siswa per Mapel/i.test(navText), navText);
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    ok('agenda Absensi Guru menampilkan hanya slot Wakasek', await page.locator('[data-agenda-slot]').count() === 1,
      await page.locator('h2').first().innerText().catch(() => ''));
    ok('agenda tidak menampilkan slot guru lain', !(await page.locator('[data-agenda-jadwal]').innerText()).includes('Mapel B'));
    ok('slot guru lain tidak menyediakan tombol check-in', await page.locator(`[data-agenda-slot="${slotB.body.id}"]`).count() === 0);
    await page.goto(BASE + '/#/absensi_siswa', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    ok('akses langsung Absensi Siswa membuka halaman', await page.locator('h2[data-tour-id="btn-absensi-siswa"]').count() === 1,
      await page.locator('h2').first().innerText().catch(() => ''));
    ok('Absensi Siswa hanya menampilkan slot Wakasek', await page.locator('[data-sesi-jadwal]').count() === 1);
    ok('slot guru lain tidak menyediakan tombol sesi', await page.locator(`[data-sesi-jadwal="${slotB.body.id}"]`).count() === 0);

    /* ---------- mobile 390px ---------- */
    await page.close();
    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page2.on('pageerror', e => errs.push(String(e)));
    for (const hash of ['absensi_guru', 'absensi_siswa']) {
      await page2.goto(BASE + '/#/' + hash, { waitUntil: 'domcontentloaded' });
      await page2.waitForTimeout(1600);
      const overflow = await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`tanpa overflow horizontal — ${hash} (390px)`, overflow <= 2, String(overflow));
    }
    await page2.close();
    await browser.close();
    ok('tanpa error JS', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  }
  try { srv.kill('SIGKILL'); } catch (e) { /* ignore */ }
  console.log(`\n${pass} lulus, ${fail} gagal`);
  if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
  await new Promise(r => setTimeout(r, 200));
  for (const f of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) {
    try { require('fs').unlinkSync(f); } catch (e) { /* ignore */ }
  }
})();
