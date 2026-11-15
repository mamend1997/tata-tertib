'use strict';
/* =====================================================================
   Uji UI ronde Akademik (Playwright):
   jadwal (grid + modal + tab), absensi guru, absensi siswa + QR,
   halaman publik presensi & jadwal, multi-role, mobile 390px.

   Jalankan: node dev-tests/ui-akademik.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

process.env.TZ = 'Asia/Jakarta';
const DB = path.join(os.tmpdir(), 'stt-akadui-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-akadui-saas-' + Date.now() + '.sqlite');
const PORT = 6300 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const cur = now.getHours() * 60 + now.getMinutes();
const hari = now.getDay();
const tgl = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const hhmm = (m) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
let cookie = '';
async function req(p, opt = {}) {
  const r = await fetch(BASE + p, {
    method: opt.method || 'GET',
    headers: { ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length && !opt.keep) cookie = sc.map(c => c.split(';')[0]).join('; ');
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

  let browser = null;
  try {
    const KODE = (await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0].kode;
    let r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'admin', password: 'admin123' } });
    ok('login admin untuk menyiapkan data', r.status === 200);

    /* ---------------- data uji ---------------- */
    const sesi = [
      { label: 'Jam 1', mulai: hhmm(cur - 15), selesai: hhmm(cur + 25), istirahat: 0 },
      { label: 'Istirahat', mulai: hhmm(cur + 26), selesai: hhmm(cur + 35), istirahat: 1 },
      { label: 'Jam 2', mulai: hhmm(cur + 36), selesai: hhmm(cur + 70), istirahat: 0 }
    ];
    await req('/api/jadwal/pengaturan', {
      method: 'POST', body: {
        hari: [hari], max_jam: 8, sesi, max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 120 },
        wa: { aktif: 0, jam: '14:00', kepsek: '081234567890', wakasek: '081234567891' }
      }
    });
    const mapel = (await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika', kode: 'MTK' } })).body.id;
    const mapel2 = (await req('/api/mapel/save', { method: 'POST', body: { nama: 'Bahasa Indonesia', kode: 'BIN' } })).body.id;
    const j0 = await req('/api/jadwal');
    const kelas = j0.body.kelas;
    const guru = j0.body.guru.find(g => g.username === 'guru');
    for (let i = 1; i <= 3; i++) {
      await req('/api/siswa/save', { method: 'POST', body: { nama: `Siti Aminah ${i}`, kelas_id: kelas[0].id, gender: 'P', nis: 'S' + i } });
    }
    const slot = await req('/api/jadwal/slot', { method: 'POST', body: { hari, sesi: 1, mapel_id: mapel, guru_id: guru.id, kelas_ids: [kelas[0].id], ruang: 'R-01' } });
    ok('data uji: slot jadwal dibuat', slot.status === 200, JSON.stringify(slot.body));
    const slotId = slot.body.id;

    /* ---------------- browser ---------------- */
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    const watch = (pg) => {
      pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
      pg.on('console', m => {
        const t = m.text();
        if (m.type() === 'error' && !/status of 409|status of 403|status of 400/.test(t)) errors.push('console: ' + t);
      });
      return pg;
    };
    watch(page);
    let pageRef = page;

    async function loginAt(pg, username, password) {
      await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await pg.waitForSelector('input[placeholder*="kode sekolah"]', { timeout: 15000 });
      await pg.fill('input[placeholder*="kode sekolah"]', KODE);
      await pg.fill('input[autocomplete="username"]', username);
      await pg.fill('input[type="password"]', password);
      await pg.click('button[type="submit"]');
      await pg.waitForFunction(() => !document.querySelector('input[placeholder*="kode sekolah"]'), null, { timeout: 20000 });
    }
    const login = (u, p) => loginAt(pageRef, u, p);
    async function halamanBaru(viewport) {
      if (pageRef) { await pageRef.close().catch(() => {}); pageRef = null; }
      const pg = watch(await browser.newPage({ viewport }));
      pageRef = pg;
      return pg;
    }
    await login('admin', 'admin123');
    ok('login lewat UI', await page.locator('nav').count() > 0);

    console.log('\n== 1. HALAMAN JADWAL ==');
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-grid-jadwal]', { timeout: 15000 });
    ok('matriks jadwal tampil', await page.locator('[data-grid-jadwal]').count() === 1);
    ok('slot jadwal terlihat pada grid', await page.locator('[data-slot]').count() >= 1);
    ok('nama mapel tampil di slot', (await page.locator('[data-slot]').first().innerText()).includes('Matematika'));
    ok('tombol template & export tersedia', await page.locator('a[href*="/api/jadwal/template.xlsx"]').count() === 1
      && await page.locator('a[href*="/api/jadwal/export.xlsx"]').count() === 1);

    /* tambah slot lewat modal */
    const kosong = page.locator('[data-slot-kosong]').first();
    await kosong.click();
    await page.waitForSelector('[data-modal]');
    ok('modal tambah slot terbuka', /Tambah Slot Jadwal/.test(await page.locator('[data-modal]').innerText()));
    const modal = page.locator('[data-modal]');
    await modal.locator('select').nth(0).selectOption({ label: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][hari] });
    await modal.locator('select').nth(1).selectOption({ index: 1 });
    /* Ronde 21: guru pengampu TIDAK dipilih manual — otomatis dari Data Master Mapel */
    await modal.locator('[data-mapel-slot]').selectOption({ index: 1 });
    ok('guru pengampu terkunci otomatis pada form slot',
      await modal.locator('[data-guru-terkunci]').count() === 1
      && (await modal.locator('[data-guru-terkunci]').innerText()).length > 3,
      await modal.locator('[data-guru-terkunci]').innerText());
    await modal.locator('input[type="checkbox"]').nth(1).check();
    await page.waitForTimeout(500);
    const tombolSimpan = page.locator('[data-modal] button[form="fSlot"]');
    try { await tombolSimpan.click({ timeout: 8000 }); }
    catch (e) { await tombolSimpan.click({ force: true }); }
    await page.waitForTimeout(1500);
    ok('slot baru tersimpan dari modal', await page.locator('[data-slot]').count() >= 2, JSON.stringify(errors.slice(0, 2)));

    /* tab mapel */
    await page.getByRole('button', { name: /Mata Pelajaran/i }).first().click();
    await page.waitForTimeout(600);
    ok('tab mata pelajaran menampilkan daftar', /Matematika/.test(await page.locator('main').innerText()));

    /* tab pengaturan */
    await page.getByRole('button', { name: /Pengaturan Jadwal/i }).first().click();
    await page.waitForSelector('[data-form-jadwal]');
    ok('form pengaturan jadwal tampil', await page.locator('[data-form-jadwal]').count() === 1);
    ok('tombol hari aktif & sesi jam tersedia', await page.locator('[data-form-jadwal] input[type="time"]').count() >= 3);
    ok('pengaturan menampilkan nomor WA kepsek', (await page.locator('[data-form-jadwal]').innerText()).includes('Kepala Sekolah'));

    console.log('\n== 2. ABSENSI GURU ==');
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(BASE + '/');
    await page.waitForTimeout(400);
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await page.context().clearCookies();
    await login('guru', 'guru123');
    await page.goto(BASE + '/#/absensi_guru');
    await page.waitForSelector('[data-slot-absensi]', { timeout: 15000 });
    ok('kartu jadwal mengajar tampil', await page.locator('[data-slot-absensi]').count() >= 1);
    ok('kartu menampilkan jendela absensi', /jendela absensi|dibuka/i.test(await page.locator('[data-slot-absensi]').first().innerText()));
    /* ronde 19: satu klik Check-in Hadir (cap waktu real-time, status terkunci) */
    const tombolCheckin = page.locator('[data-checkin]').first();
    ok('tombol Check-in Hadir tersedia', await tombolCheckin.count() === 1 && await tombolCheckin.isEnabled());
    await tombolCheckin.click();
    await page.waitForSelector('[data-jurnal-materi]', { timeout: 10000 });
    await page.fill('[data-jurnal-materi]', 'Menjelaskan persamaan linear dan latihan soal halaman 42');
    await page.locator('[data-simpan-jurnal]').click();
    await page.waitForTimeout(1800);
    ok('absensi tersimpan & status berubah', /Hadir/.test(await page.locator('[data-slot-absensi]').first().innerText()));

    console.log('\n== 3. ABSENSI SISWA + QR ==');
    await page.goto(BASE + '/#/absensi_siswa');
    await page.waitForTimeout(1500);
    ok('halaman absensi siswa tampil', (await page.locator('main').innerText()).includes('Absensi Siswa per Mata Pelajaran'));
    const buat = page.locator('[data-buat-sesi]').first();
    if (await buat.count()) { await buat.click(); await page.waitForTimeout(1800); }
    else { await page.locator('[data-buka-presensi]').first().click(); await page.waitForTimeout(1800); }
    ok('editor presensi kelas tampil', await page.locator('[data-absensi-kelas]').count() === 1);
    ok('daftar siswa tampil dengan tombol H/S/I/A/B', await page.locator('[data-siswa]').count() >= 3
      && await page.locator('[data-siswa] [data-status="B"]').count() >= 3);
    await page.locator('[data-mass="S"]').click();
    ok('tombol massal menandai semua siswa Sakit', await page.locator('[data-siswa] [data-status="S"].bg-amber-500').count() >= 3);
    await page.locator('[data-siswa]').first().locator('[data-status="H"]').click();
    const ket = page.locator('[data-siswa]').nth(1).locator('[data-keterangan]');
    ok('input keterangan muncul untuk status non-H', await ket.count() === 1);
    await ket.fill('demam sejak pagi');
    /* ronde 24: panel guru TIDAK lagi meminta nama pencatat (otomatis dari akun login) */
    ok('panel guru tanpa kolom nama pencatat', await page.locator('[data-pencatat]').count() === 0);
    ok('identitas pencatat otomatis tampil (akun guru)',
      /Dicatat otomatis atas nama/i.test(await page.locator('[data-absensi-kelas]').innerText()));
    await page.locator('[data-simpan-presensi]').click();
    await page.waitForTimeout(1600);
    ok('presensi oleh guru tersimpan (pesan sukses)', /tersimpan|Terima kasih/i.test(await page.locator('main').innerText()));

    await page.locator('[data-buka-qr]').click();
    await page.waitForSelector('[data-modal] svg');
    ok('modal QR menampilkan QR code', await page.locator('[data-modal] svg').count() >= 1);
    ok('tombol unduh QR & salin tautan tersedia', await page.locator('[data-modal] a[download]').count() >= 1
      && /Salin Link Presensi/.test(await page.locator('[data-modal]').innerText()));

    /* ambil token presensi */
    const tokenRow = (await req('/api/absensi-siswa?tanggal=' + tgl)).body.jadwal.find(j => j.token);
    ok('token sesi presensi tersedia untuk tautan publik', !!tokenRow, JSON.stringify((await req('/api/absensi-siswa?tanggal=' + tgl)).body.jadwal));
    await page.keyboard.press('Escape');

    console.log('\n== 4. HALAMAN PUBLIK PRESENSI ==');
    const pub = await halamanBaru({ width: 390, height: 844 });
    const pubErr = [];
    pub.on('pageerror', e => pubErr.push(e.message));
    await pub.goto(BASE + '/presensi/' + tokenRow.token, { waitUntil: 'domcontentloaded' });
    await pub.waitForSelector('[data-absensi-kelas]', { timeout: 15000 });
    const pubText = await pub.locator('main').innerText();
    const judulPub = await pub.locator('header').first().locator('h1').innerText();
    ok('judul halaman publik = "Absensi <sekolah>"', /absensi\s+smk/i.test(judulPub), judulPub);
    ok('nama kelas tampil besar', pubText.includes(kelas[0].nama));
    ok('tombol massal H/S/I/A/B tersedia', await pub.locator('[data-mass]').count() === 5);
    ok('setiap siswa punya 5 tombol status', await pub.locator('[data-siswa] [data-status]').count() >= 15);
    await pub.locator('[data-mass="H"]').click();
    await pub.locator('[data-siswa]').first().locator('[data-status="B"]').click();
    const ketPub = pub.locator('[data-siswa]').first().locator('[data-keterangan]');
    await ketPub.fill('keluar kelas saat pelajaran');
    /* ronde 19: nama pencatat diverifikasi — harus terdaftar di kelas */
    const namaKetuaUi = (await pub.locator('[data-siswa]').first().innerText()).replace(/^\d+\.\s*/, '').split('\n')[0].trim();
    await pub.locator('[data-pencatat]').fill(namaKetuaUi);
    await pub.locator('[data-simpan-presensi]').click();
    await pub.waitForTimeout(1600);
    ok('presensi publik tersimpan', /tersimpan|Terima kasih/i.test(await pub.locator('main').innerText()));
    const overflowPub = await pub.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman publik presensi tidak melebar di 390px', overflowPub <= 2, String(overflowPub));
    ok('tanpa error JS di halaman presensi publik', pubErr.length === 0, pubErr.join(' | '));

    console.log('\n== 5. JADWAL PUBLIK ==');
    const rp = await req('/api/jadwal/publik', { method: 'POST', body: { aktif: 1, rotate: 1 } });
    const tp = rp.body.token;
    const pubj = await halamanBaru({ width: 1360, height: 900 });
    const pjErr = [];
    pubj.on('pageerror', e => pjErr.push(e.message));
    await pubj.goto(BASE + '/jadwal-publik/' + tp, { waitUntil: 'domcontentloaded' });
    await pubj.waitForSelector('[data-filter-kelas]', { timeout: 15000 });
    ok('halaman jadwal publik terbuka tanpa login', await pubj.locator('[data-jadwal-publik]').count() >= 1);
    ok('filter kelas & guru tersedia', await pubj.locator('[data-filter-kelas]').count() === 1 && await pubj.locator('[data-filter-guru]').count() === 1);
    ok('jadwal publik menampilkan mapel & guru', /Matematika/.test(await pubj.locator('main').innerText()));
    await pubj.locator('[data-filter-kelas]').selectOption(String(kelas[0].id));
    await pubj.waitForTimeout(900);
    ok('filter kelas menyaring tampilan', await pubj.locator('[data-jadwal-publik="' + kelas[0].id + '"]').count() >= 1);
    await pubj.locator('[data-cari-jadwal]').fill('Matematika');
    await pubj.locator('[data-cari-jadwal]').press('Enter');
    await pubj.waitForTimeout(900);
    ok('pencarian jadwal publik bekerja', /Matematika/.test(await pubj.locator('main').innerText()));
    await pubj.locator('[data-cari-jadwal]').fill('mapel-tidak-ada-xyz');
    await pubj.locator('[data-cari-jadwal]').press('Enter');
    await pubj.waitForTimeout(900);
    ok('pencarian tanpa hasil menampilkan pesan kosong',
      /tidak ada|belum ada jadwal|kosong/i.test(await pubj.locator('main').innerText()));
    ok('tanpa error JS di jadwal publik', pjErr.length === 0, pjErr.join(' | '));

    console.log('\n== 6. MULTI-ROLE DI HALAMAN PENGGUNA ==');
    const adminPage = await halamanBaru({ width: 1360, height: 900 });
    await loginAt(adminPage, 'admin', 'admin123');
    await adminPage.goto(BASE + '/#/pengguna');
    await adminPage.waitForTimeout(1500);
    await adminPage.getByRole('button', { name: /Tambah Akun/i }).first().click();
    await adminPage.waitForSelector('[data-modal]');
    ok('form akun menampilkan pilihan role tambahan', await adminPage.locator('[data-multi-role]').count() === 1);
    const modalText = await adminPage.locator('[data-modal]').innerText();
    ok('role Wakasek Kurikulum tersedia di form', /Wakasek Kurikulum/.test(modalText));
    ok('petunjuk multi-role ditampilkan', /multi-role/i.test(modalText));
    await adminPage.keyboard.press('Escape');

    console.log('\n== 7. MOBILE 390px & ERROR JS ==');
    const mob = await halamanBaru({ width: 390, height: 844 });
    const mobErr = [];
    mob.on('pageerror', e => mobErr.push(e.message));
    await mob.goto(BASE + '/#/jadwal', { waitUntil: 'domcontentloaded' });
    await mob.waitForTimeout(2000);
    const ovJ = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman jadwal tidak melebar di 390px', ovJ <= 2, String(ovJ));
    await mob.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await mob.waitForTimeout(1600);
    const ovA = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('halaman absensi guru tidak melebar di 390px', ovA <= 2, String(ovA));
    ok('tanpa error JS pada halaman mobile', mobErr.length === 0, mobErr.join(' | '));
    ok('tanpa error JS selama pengujian desktop', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
  }

  console.log('\n=== HASIL UI AKADEMIK: ' + pass + ' lulus, ' + fail + ' gagal ===');
  if (fails.length) { console.log('\nGAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})();
