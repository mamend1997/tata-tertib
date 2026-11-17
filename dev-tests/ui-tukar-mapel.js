'use strict';
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), `stt-ui-tukar-mapel-${Date.now()}.sqlite`);
const SAAS = path.join(os.tmpdir(), `stt-ui-tukar-mapel-saas-${Date.now()}.sqlite`);
const PORT = 5350 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (name, condition, extra) => {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', data => process.stderr.write('[srv] ' + data));
  await new Promise(resolve => setTimeout(resolve, 2300));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());

  const login = async (username, password) => {
    await page.context().clearCookies();
    await page.goto(BASE + '/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(BASE + '/');
    const code = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows || [])[0]?.kode || '';
    await page.waitForSelector('input[placeholder*="kode sekolah" i]');
    await page.fill('input[placeholder*="kode sekolah" i]', code);
    await page.fill('input[autocomplete="username"]', username);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 20000 });
    await page.waitForTimeout(500);
  };

  try {
    await login('admin', 'admin123');
    const dates = await page.evaluate(() => {
      const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const add = (date, n) => { const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
      const week = date => {
        const x = new Date(`${date}T12:00:00Z`);
        x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
        return x.toISOString().slice(0, 10);
      };
      const today = iso(new Date());
      for (let a = 1; a <= 5; a++) {
        for (let b = a + 1; b <= 6; b++) {
          const source = add(today, a), target = add(today, b);
          if (week(source) === week(target)) {
            return { today, source, target, sourceDay: new Date(`${source}T12:00:00`).getDay(),
              targetDay: new Date(`${target}T12:00:00`).getDay() };
          }
        }
      }
      return null;
    });
    if (!dates) throw new Error('Tidak menemukan dua hari yang cocok untuk data uji.');

    const setup = await page.evaluate(async d => {
      const post = async (url, body) => {
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      const get = async url => (await fetch(url, { credentials: 'same-origin' })).json();
      const guru = await post('/api/users/save', {
        nama: 'Guru Tukar Mapel UI', username: 'gurumapelui', password: 'guru123',
        role: 'guru_umum', roles: ['guru']
      });
      const mapelA = await post('/api/mapel/save', { nama: 'Matematika UI', kode: 'MUI1', guru_ids: [guru.body.id] });
      const mapelB = await post('/api/mapel/save', { nama: 'Administrasi Pajak UI', kode: 'MUI2', guru_ids: [guru.body.id] });
      const settings = await post('/api/jadwal/pengaturan', {
        hari: [d.sourceDay, d.targetDay], max_jam: 4,
        sesi: [
          { label: 'Jam ke-1', mulai: '08:00', selesai: '08:40', istirahat: 0 },
          { label: 'Jam ke-2', mulai: '08:45', selesai: '09:25', istirahat: 0 },
          { label: 'Jam ke-3', mulai: '09:30', selesai: '10:10', istirahat: 0 },
          { label: 'Jam ke-4', mulai: '10:15', selesai: '10:55', istirahat: 0 }
        ],
        max_mapel_jam: 4, max_guru_jam: 4,
        absensi: { buka_menit: 30, tutup_menit: 30, jurnal_min: 5, foto_wajib: 0,
          foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 30 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const kelas = (await get('/api/jadwal')).kelas || [];
      const source = await post('/api/jadwal/slot', {
        hari: d.sourceDay, sesi: 1, mapel_id: mapelA.body.id, guru_id: guru.body.id,
        kelas_ids: [kelas[0].id], abaikan: 1
      });
      const target = await post('/api/jadwal/slot', {
        hari: d.targetDay, sesi: 1, mapel_id: mapelB.body.id, guru_id: guru.body.id,
        kelas_ids: [kelas[0].id], abaikan: 1
      });
      return {
        guru: guru.body.id, mapelA: mapelA.body.id, mapelB: mapelB.body.id,
        source: source.body.id, target: target.body.id,
        ready: guru.status === 200 && settings.status === 200 && source.status === 200 && target.status === 200
      };
    }, dates);
    ok('data dua mapel guru pada hari berbeda siap', setup.ready, JSON.stringify(setup));

    await login('gurumapelui', 'guru123');
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    const sourceButton = `[data-tukar-mapel-agenda="${setup.source}"]`;
    await page.waitForSelector(sourceButton, { timeout: 20000 });
    ok('tombol Tukar Mapel tersedia pada agenda guru', await page.locator(sourceButton).count() === 1);
    await page.locator(sourceButton).click();
    await page.waitForSelector('[data-modal-tukar-mapel]', { timeout: 10000 });
    const defaultOptions = await page.locator('[data-pilih-tukar-mapel] option').allTextContents();
    ok('dialog menampilkan mapel tujuan beserta hari dan jam',
      defaultOptions.some(text => /Administrasi Pajak UI/.test(text) && /08:00/.test(text)),
      JSON.stringify(defaultOptions));
    await page.locator('[data-mode-tukar-mapel="tetap"]').click();
    ok('pilihan tukar sementara dan tetap tersedia',
      await page.locator('[data-mode-tukar-mapel="sementara"]').count() === 1
        && await page.locator('[data-mode-tukar-mapel="tetap"]').count() === 1);
    await page.locator('[data-mode-tukar-mapel="sementara"]').click();
    await page.locator('[data-simpan-tukar-mapel]').click();
    await page.waitForSelector('[data-modal-tukar-mapel]', { state: 'detached', timeout: 15000 });
    ok('tukar sementara dapat disimpan dari dialog', true);

    const Database = require('better-sqlite3');
    const fixture = new Database(DB);
    fixture.prepare("UPDATE jadwal_tukar SET status='batal' WHERE jenis='mapel'").run();
    fixture.close();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sourceButton, { timeout: 15000 });
    await page.locator(sourceButton).click();
    await page.waitForSelector('[data-modal-tukar-mapel]', { timeout: 10000 });
    await page.locator('[data-mode-tukar-mapel="tetap"]').click();
    await page.locator('[data-simpan-tukar-mapel]').click();
    await page.waitForSelector('[data-modal-tukar-mapel]', { state: 'detached', timeout: 15000 });
    const jadwalBerubah = await page.evaluate(async ids => {
      const response = await fetch('/api/jadwal', { credentials: 'same-origin' });
      const data = await response.json();
      const source = (data.rows || []).find(x => Number(x.id) === Number(ids.source));
      const target = (data.rows || []).find(x => Number(x.id) === Number(ids.target));
      return Number(source?.mapel_id) === Number(ids.mapelB) && Number(target?.mapel_id) === Number(ids.mapelA);
    }, setup);
    ok('tukar tetap mengubah mapel yang ditampilkan pada menu Jadwal', jadwalBerubah);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tampilan Tukar Mapel tidak menyebabkan overflow ponsel', overflow <= 2, `overflow=${overflow}`);
    ok('tanpa error JavaScript', errors.length === 0, errors.join('; '));
  } catch (error) {
    fail++;
    fails.push(`exception: ${error.message}`);
    console.error(error);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 400));
    for (const file of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) {
      try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
    }
    console.log(`\n=== HASIL UI TUKAR MAPEL: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) fails.forEach(item => console.log(' - ' + item));
    process.exit(fail ? 1 : 0);
  }
})();
