'use strict';
/* Uji UI ronde 23 (Playwright, tata-tertib):
   - Tombol opsi "Tukar Jadwal" muncul di bawah Check-in Hadir / Sakit / Izin
   - Modal Tukar Jadwal: pilihan guru HANYA yang mengampu kelas yang sama,
     pilihan mata pelajaran mengikuti guru pengganti, kirim permintaan
   - Guru tujuan melihat box "Permintaan Tukar Jadwal Masuk" lalu Terima/Tolak
   - Tidak ada error JS & layout mobile 390px tidak melebar
   Jalankan: node dev-tests/ui-tukar.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uitukar-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uitukar-saas-' + Date.now() + '.sqlite');
const PORT = 5300 + Math.floor(Math.random() * 150);
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
  await new Promise(r => setTimeout(r, 2300));
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const login = async (username, password) => {
    try { await page.context().clearCookies(); } catch (e) { /* abaikan */ }
    await page.goto(BASE + '/');
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { } });
    await page.goto(BASE + '/');
    await page.waitForSelector('input[placeholder*="kode sekolah" i]');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', username);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 20000 });
    await page.waitForTimeout(800);
    /* tutup pop-up peringatan dini bila muncul */
    await page.keyboard.press('Escape').catch(() => { });
    await page.waitForTimeout(200);
  };

  try {
    await login('admin', 'admin123');

    const pad = n => String(n).padStart(2, '0');
    const wib = new Date(Date.now() + 7 * 3600 * 1000);
    const TODAY = wib.toISOString().slice(0, 10);
    const HARI = wib.getUTCDay();
    const hhmm = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const past = m => new Date(Date.now() + 7 * 3600 * 1000 - m * 60000);
    const mulai = hhmm(past(10)), selesai = hhmm(new Date(past(-25)));

    /* ---------------- setup data lewat API ---------------- */
    const setup = await page.evaluate(async ({ hari, mulai, selesai, mulai2, selesai2, mulai3, selesai3 }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const mk = async (nama, username) => (await post('/api/users/save', { nama, username, password: 'guru123', role: 'guru_umum', roles: ['guru'] })).id;
      const gA = await mk('Guru Pengampu A', 'gurua');
      const gB = await mk('Guru Pengganti B', 'gurub');
      const gC = await mk('Guru Kelas Lain C', 'guruc');
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8,
        sesi: [
          { label: 'Jam 1', mulai, selesai, istirahat: 0 },
          { label: 'Jam 2', mulai: mulai2, selesai: selesai2, istirahat: 0 },
          { label: 'Jam 3', mulai: mulai3, selesai: selesai3, istirahat: 0 }
        ],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const kelas = (await get('/api/jadwal')).kelas || [];
      const mA = (await post('/api/mapel/save', { nama: 'Mapel A', kode: 'MPA', guru_ids: [gA] })).id;
      const mB = (await post('/api/mapel/save', { nama: 'Mapel B', kode: 'MPB', guru_ids: [gB] })).id;
      const mC = (await post('/api/mapel/save', { nama: 'Mapel C', kode: 'MPC', guru_ids: [gC] })).id;
      const slotA = (await post('/api/jadwal/slot', { hari, sesi: 2, mapel_id: mA, guru_id: gA, kelas_ids: [kelas[0].id], abaikan: 1 })).id;
      await post('/api/jadwal/slot', { hari, sesi: 3, mapel_id: mB, guru_id: gB, kelas_ids: [kelas[0].id], abaikan: 1 });
      await post('/api/jadwal/slot', { hari, sesi: 3, mapel_id: mC, guru_id: gC, kelas_ids: [kelas[1].id], abaikan: 1 });
      const slotHadir = (await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: mB, guru_id: gB, kelas_ids: [kelas[1].id], abaikan: 1 })).id;
      return { gA, gB, gC, slotA, slotHadir, kelas1: kelas[0].nama };
    }, {
      hari: HARI, mulai, selesai,
      mulai2: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 40 * 60000)),
      selesai2: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 65 * 60000)),
      mulai3: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 80 * 60000)),
      selesai3: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 105 * 60000))
    });
    ok('data uji siap (2 guru satu kelas + 1 guru kelas lain)', !!setup.slotA && !!setup.gB);
    const Database = require('better-sqlite3');
    const fixture = new Database(DB);
    const checkinGuruB = fixture.prepare('SELECT 1 FROM absensi_guru WHERE guru_id=? AND tanggal=? LIMIT 1')
      .get(setup.gB, TODAY);
    fixture.close();
    ok('guru tujuan belum Check-in Hadir saat pertukaran diajukan', !checkinGuruB);

    /* ---------------- 1. guru A melihat tombol Tukar Jadwal ---------------- */
    await login('gurua', 'guru123');
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`[data-slot-absensi="${setup.slotA}"]`, { timeout: 20000 });
    const card = page.locator(`[data-slot-absensi="${setup.slotA}"]`);
    ok('tombol Check-in Hadir / Sakit / Izin tampil', await card.locator('[data-checkin]').count() === 1
      && await card.locator('[data-sakit]').count() === 1 && await card.locator('[data-izin]').count() === 1);
    ok('tombol opsi "Tukar Jadwal" tersedia di kartu sesi', await card.locator('[data-tukar]').count() === 1);
    ok('tombol muncul setelah tombol Izin (urutan opsi)', await page.evaluate((id) => {
      const el = document.querySelector(`[data-slot-absensi="${id}"]`);
      const izin = el.querySelector('[data-izin]');
      const tukar = el.querySelector('[data-tukar]');
      return !!(izin && tukar) && (izin.compareDocumentPosition(tukar) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }, setup.slotA));

    /* ---------------- 2. modal tukar jadwal ---------------- */
    await card.locator('[data-tukar]').click();
    await page.waitForSelector('[data-modal-tukar]', { timeout: 15000 });
    ok('modal Tukar Jadwal terbuka', true);
    ok('pilihan pertukaran lintas hari tersedia pada jadwal hari ini',
      await page.locator('[data-tukar-mode="hari-berbeda"]').count() === 1);
    await page.click('[data-tukar-mode="hari-berbeda"]');
    await page.waitForSelector('[data-alasan-tukar-jenis="izin"]', { timeout: 15000 });
    ok('mode hari berbeda menampilkan pilihan alasan Izin/Sakit',
      await page.locator('[data-alasan-tukar-jenis]').count() === 2);
    await page.click('[data-tukar-mode="hari-sama"]');
    await page.waitForSelector(`[data-pilih-guru-tukar] option[value="${setup.gB}"]`, { state: 'attached', timeout: 15000 });
    const opsiGuru = await page.locator('[data-pilih-guru-tukar] option').allTextContents();
    ok('guru yang mengampu kelas sama muncul (Guru Pengganti B)', opsiGuru.some(t => /Guru Pengganti B/.test(t)), JSON.stringify(opsiGuru));
    ok('guru kelas lain TIDAK muncul di pilihan', !opsiGuru.some(t => /Guru Kelas Lain C/.test(t)), JSON.stringify(opsiGuru));
    await page.selectOption('[data-pilih-guru-tukar]', String(setup.gB));
    await page.waitForTimeout(300);
    const opsiMapel = await page.locator('[data-pilih-mapel-tukar] option').allTextContents();
    ok('pilihan mata pelajaran mengikuti guru pengganti', opsiMapel.some(t => /Mapel B/.test(t)), JSON.stringify(opsiMapel));
    await page.fill('[data-alasan-tukar]', 'ada tugas luar kota');
    await page.click('[data-kirim-tukar]');
    await page.waitForTimeout(1200);
    ok('permintaan terkirim & modal tertutup', await page.locator('[data-modal-tukar]').count() === 0);

    /* ---------------- 3. guru B menerima ---------------- */
    await login('gurub', 'guru123');
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-tukar-masuk]', { timeout: 20000 });
    ok('box "Permintaan Tukar Jadwal Masuk" tampil di akun guru tujuan', await page.locator('[data-tukar-masuk]').count() >= 1);
    const teksMasuk = await page.locator('[data-tukar-masuk]').first().innerText();
    ok('permintaan menyebut pengaju & sesi', /Guru Pengampu A/.test(teksMasuk), teksMasuk.replace(/\n/g, ' | '));
    await page.locator('[data-tukar-terima]').first().click();
    await page.waitForTimeout(1500);
    ok('sesi pengganti masuk ke daftar check-in guru B',
      await page.locator(`[data-slot-absensi="${setup.slotA}"]`).count() === 1);
    ok('kartu menandai sesi pengganti (tukar jadwal)', await page.locator(`[data-tukar-aktif="${setup.slotA}"]`).count() === 1);

    /* ---------------- 4. guru asli tidak lagi memiliki sesi ---------------- */
    await login('gurua', 'guru123');
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    ok('guru asli tidak lagi melihat sesi tersebut', await page.locator(`[data-slot-absensi="${setup.slotA}"]`).count() === 0);

    /* ---------------- 5. dashboard guru B: box + popup ---------------- */
    await login('admin', 'admin123');
    /* admin mengajukan untuk guru? tidak bisa — cukup pastikan halaman dashboard guru B tetap bersih tanpa error */
    await login('gurub', 'guru123');
    await page.goto(BASE + '/#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    ok('dashboard guru B tanpa error (permintaan sudah dijawab)', await page.locator('[data-tukar-card]').count() === 0);

    /* ---------------- 6. mobile 390px ---------------- */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal di mobile 390px', overflow <= 2, 'overflow=' + overflow);
    ok('tidak ada error JS', errors.length === 0, errors.join('; '));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    for (const f of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
    console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
