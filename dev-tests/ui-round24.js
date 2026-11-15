'use strict';
/* Uji UI ronde 24 (Playwright, tata-tertib):
   A. Halaman publik presensi — judul tidak tertimpa konten, tombol Simpan
      sejajar dengan kolom nama siswa (mobile & desktop), audit trail
      "diwakili/diisi oleh", batas 1x isi per siswa, tampilan terkunci.
   B. Panel guru — tanpa kolom nama pencatat, tombol "Simpan Absensi".
   C. Navigasi bawah (ponsel) — 3 tombol untuk Guru Mapel, tombol tengah
      highlight, header: logo + nama pengguna + hamburger kanan → laci menu.
      Desktop tidak berubah (tanpa bottom nav). Admin mengubah susunan via UI.
   Jalankan: node dev-tests/ui-round24.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uir24-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uir24-saas-' + Date.now() + '.sqlite');
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
  let page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  /* hanya boleh 1 tab per browser instance → tutup halaman sebelumnya dulu */
  async function halamanBaru(viewport) {
    try { await page.close(); } catch (e) { /* abaikan */ }
    page = await browser.newPage({ viewport });
    page.on('pageerror', e => errors.push(e.message));
    return page;
  }
  const ke = (sel) => page.locator(sel);

  async function login(username, password, viewport) {
    if (viewport) await halamanBaru(viewport);
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
    await page.keyboard.press('Escape').catch(() => { });
    await page.waitForTimeout(200);
  }

  const pad = n => String(n).padStart(2, '0');
  const wib = new Date();
  const TODAY = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
  const HARI = wib.getDay();
  const cur = wib.getHours() * 60 + wib.getMinutes();
  const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
  const base = Math.min(cur, 1440 - 200);

  try {
    /* ---------------- setup data ---------------- */
    await login('admin', 'admin123');
    const setup = await page.evaluate(async ({ hari, mulai, selesai, mulai2, selesai2 }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const gA = (await post('/api/users/save', { nama: 'Guru UI A', username: 'gurua', password: 'guru123', role: 'guru_umum', roles: ['guru'] })).id;
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8,
        sesi: [{ label: 'Jam ke-1', mulai, selesai, istirahat: 0 }, { label: 'Jam ke-2', mulai: mulai2, selesai: selesai2, istirahat: 0 }],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 15, toleransi_tutup: 0, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, auto_alpha: 0 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const siswa = (await get('/api/siswa?limit=10')).rows || [];
      const kelas = siswa[0].kelas_id;
      const m = (await post('/api/mapel/save', { nama: 'Informatika', kode: 'INF', guru_ids: [gA] })).id;
      const slot = (await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: m, guru_id: gA, kelas_ids: [kelas], abaikan: 1 })).id;
      const sesi = await post('/api/absensi-siswa/sesi', { jadwal_id: slot, tanggal: '' + document.__tgl });
      /* nama siswa kelas tersebut (2 teratas) */
      const daftar = (await get('/api/siswa?kelas=' + kelas + '&limit=10')).rows || siswa;
      return {
        gA, slot, token: sesi.sesi ? sesi.sesi.token : '', sesiId: sesi.sesi ? sesi.sesi.id : null,
        kelasId: kelas, siswa: daftar.slice(0, 3).map(s => ({ id: s.id, nama: s.nama }))
      };
    }, { hari: HARI, mulai: hhmm(base - 10), selesai: hhmm(base + 40), mulai2: hhmm(base + 41), selesai2: hhmm(base + 90) });
    ok('data uji siap (slot, sesi presensi, siswa)', !!setup.token && setup.siswa.length >= 2, JSON.stringify(setup).slice(0, 200));

    /* ---------------- A. HALAMAN PUBLIK PRESENSI ---------------- */
    console.log('\n== A. HALAMAN PUBLIK PRESENSI (MOBILE 390px) ==');
    await halamanBaru({ width: 390, height: 844 });
    let errA = [];
    page.on('pageerror', e => errA.push(e.message));
    await page.goto(BASE + '/presensi/' + setup.token, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-absensi-kelas]', { timeout: 20000 });
    await page.waitForTimeout(500);

    const geometri = await page.evaluate(() => {
      const h = document.querySelector('header');
      const card = document.querySelector('[data-presensi-publik] > .card') || document.querySelector('[data-presensi-publik] .card');
      const hb = h.getBoundingClientRect();
      const cb = card ? card.getBoundingClientRect() : null;
      return { headerBottom: Math.round(hb.bottom), cardTop: cb ? Math.round(cb.top) : null, cardLeft: cb ? Math.round(cb.left) : null, cardRight: cb ? Math.round(cb.right) : null };
    });
    ok('konten TIDAK menimpa judul halaman (card di bawah header)',
      geometri.cardTop !== null && geometri.cardTop >= geometri.headerBottom - 1,
      JSON.stringify(geometri));

    const footer = await page.evaluate(() => {
      const f = document.querySelector('[data-footer-publik]');
      const card = document.querySelector('[data-presensi-publik] .card');
      const input = f.querySelector('[data-pencatat]');
      const btn = f.querySelector('[data-simpan-presensi]');
      const fb = f.getBoundingClientRect(), cb = card.getBoundingClientRect();
      const ib = input.getBoundingClientRect(), bb = btn.getBoundingClientRect();
      return {
        dalamKartu: fb.left >= cb.left - 1 && fb.right <= cb.right + 1,
        btnDalamFooter: bb.left >= fb.left - 1 && bb.right <= fb.right + 1,
        inputX: Math.round(ib.left), btnX: Math.round(bb.left),
        inputW: Math.round(ib.width), btnW: Math.round(bb.width),
        inputBottom: Math.round(ib.bottom), btnTop: Math.round(bb.top)
      };
    });
    ok('tombol Simpan berada DI DALAM kartu (tidak melayang keluar)', footer.dalamKartu && footer.btnDalamFooter,
      JSON.stringify(footer));
    ok('tombol Simpan sejajar dengan kolom nama siswa (mobile: lebar penuh)',
      Math.abs(footer.btnX - footer.inputX) <= 2 && Math.abs(footer.btnW - footer.inputW) <= 6, JSON.stringify(footer));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tidak ada overflow horizontal di 390px', overflow <= 2, 'overflow=' + overflow);

    /* desktop: input & tombol sejajar dalam satu baris */
    await halamanBaru({ width: 1180, height: 900 });
    await page.goto(BASE + '/presensi/' + setup.token, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-footer-publik]', { timeout: 20000 });
    const baris = await page.evaluate(() => {
      const f = document.querySelector('[data-footer-publik]');
      const ib = f.querySelector('[data-pencatat]').getBoundingClientRect();
      const bb = f.querySelector('[data-simpan-presensi]').getBoundingClientRect();
      return { ibTop: Math.round(ib.top), ibBottom: Math.round(ib.bottom), bbTop: Math.round(bb.top), bbBottom: Math.round(bb.bottom) };
    });
    ok('desktop: tombol Simpan satu baris dengan kolom nama siswa',
      baris.bbTop < baris.ibBottom && baris.bbBottom > baris.ibTop, JSON.stringify(baris));

    /* ---------------- audit trail & batas 1x ---------------- */
    console.log('\n== B. AUDIT TRAIL & BATAS 1X PENGISIAN ==');
    await halamanBaru({ width: 390, height: 844 });
    await page.goto(BASE + '/presensi/' + setup.token, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-absensi-kelas]', { timeout: 20000 });
    const nama1 = setup.siswa[0].nama;
    await ke('[data-mass="H"]').click();
    await ke('[data-pencatat]').fill(nama1);
    await ke('[data-simpan-presensi]').click();
    await page.waitForTimeout(1800);
    ok('presensi publik tersimpan', /tersimpan|Terima kasih/i.test(await ke('main').innerText()));
    ok('rekap menampilkan "diwakili/diisi oleh"', /diwakili\/diisi oleh/i.test(await ke('[data-pencatat-info]').innerText()),
      await ke('[data-pencatat-info]').innerText().catch(() => '(tidak ada)'));
    ok('nama pengisi muncul pada keterangan', (await ke('[data-pencatat-info]').innerText()).includes(nama1));

    /* percobaan kedua oleh siswa yang sama */
    await ke('[data-mass="A"]').click();
    await ke('[data-pencatat]').fill(nama1);
    await ke('[data-simpan-presensi]').click();
    await page.waitForTimeout(1600);
    const errTxt = await ke('[data-err]').innerText().catch(() => '');
    ok('siswa yang sama diblokir mengisi 2x', /sudah pernah Anda isi|satu kali/i.test(errTxt), errTxt);

    /* ---------------- C. PANEL GURU (tanpa nama pencatat) ---------------- */
    console.log('\n== C. PANEL GURU ==');
    await login('gurua', 'guru123', { width: 1400, height: 950 });
    await page.goto(BASE + '/#/absensi_siswa', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    const buka = ke('[data-buka-presensi]').first();
    if (await buka.count()) { await buka.click(); }
    else { await ke('[data-buat-sesi]').first().click(); }
    await page.waitForSelector('[data-absensi-kelas]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('panel guru TANPA kolom "Nama Pencatat"', await ke('[data-pencatat]').count() === 0);
    ok('identitas pencatat otomatis (akun guru) tampil',
      /Dicatat otomatis atas nama/i.test(await ke('[data-absensi-kelas]').innerText()));
    ok('tombol simpan berlabel "Simpan Absensi"',
      /Simpan Absensi/i.test(await ke('[data-simpan-presensi]').innerText()));
    ok('audit trail pengisian siswa tetap tampil di panel guru',
      /diwakili\/diisi oleh/i.test(await ke('[data-pencatat-info]').innerText().catch(() => '')));

    /* ---------------- D. TAMPILAN TERKUNCI ---------------- */
    console.log('\n== D. TAMPILAN TERKUNCI SETELAH JAM BERAKHIR ==');
    /* pengaturan jadwal hanya boleh diubah admin (guru tidak punya jadwal.write) */
    await login('admin', 'admin123', { width: 1400, height: 950 });
    await page.evaluate(async ({ hari, mulai, selesai }) => {
      await fetch('/api/jadwal/pengaturan', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hari: [hari], max_jam: 8,
          sesi: [{ label: 'Jam ke-1', mulai, selesai, istirahat: 0 }],
          max_mapel_jam: 2, max_guru_jam: 8,
          absensi: { buka_menit: 15, toleransi_tutup: 0, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, auto_alpha: 0 },
          wa: { aktif: 0, jam: '15:00' }
        })
      });
    }, { hari: HARI, mulai: hhmm(base - 130), selesai: hhmm(base - 70) });
    await halamanBaru({ width: 390, height: 844 });
    await page.goto(BASE + '/presensi/' + setup.token, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-absensi-kelas]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('halaman publik menampilkan status "Presensi ditutup"', /ditutup/i.test(await ke('[data-status-sesi]').innerText()));
    ok('keterangan terkunci tampil jelas', await ke('[data-terkunci]').count() === 1);
    ok('tombol Simpan berubah menjadi NONAKTIF (Disabled) saat sesi ditutup',
      await ke('[data-simpan-presensi]').isDisabled()
      && /ditutup/i.test(await ke('[data-simpan-presensi]').innerText()));
    ok('tombol status siswa nonaktif (tidak bisa mencentang)', await ke('[data-siswa] [data-status="S"]').first().isDisabled());

    /* pulihkan jam */
    await login('admin', 'admin123');
    await page.evaluate(async ({ hari, mulai, selesai }) => {
      await fetch('/api/jadwal/pengaturan', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hari: [hari], max_jam: 8,
          sesi: [{ label: 'Jam ke-1', mulai, selesai, istirahat: 0 }],
          max_mapel_jam: 2, max_guru_jam: 8,
          absensi: { buka_menit: 15, toleransi_tutup: 0, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, auto_alpha: 0 },
          wa: { aktif: 0, jam: '15:00' }
        })
      });
    }, { hari: HARI, mulai: hhmm(base - 10), selesai: hhmm(base + 40) });

    /* ---------------- E. NAVIGASI BAWAH (PONSEL) ---------------- */
    console.log('\n== E. NAVIGASI BAWAH & HEADER PONSEL ==');
    await login('gurua', 'guru123', { width: 390, height: 844 });
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    ok('navigasi bawah tampil di ponsel', await ke('[data-bottom-nav]').isVisible());
    const navItems = await page.locator('[data-bottom-nav-item]').evaluateAll(els => els.map(e => e.getAttribute('data-bottom-nav-item')));
    ok('3 tombol: kejadian · absensi_guru · jurnal',
      navItems.join(',') === 'kejadian,absensi_guru,jurnal', navItems.join(','));
    const fokus = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-bottom-nav-item]')];
      const mid = els[1];
      const span = mid.querySelector('span');
      return { kelas: span.className, teks: mid.innerText.trim() };
    });
    ok('tombol tengah (Absensi Guru) di-highlight', /bg-orange-(500|600)/.test(fokus.kelas), JSON.stringify(fokus));
    ok('label tombol tengah = "Absensi Guru Mapel"', /absensi guru/i.test(fokus.teks), fokus.teks);
    const urutanHeader = await page.evaluate(() => {
      const user = document.querySelector('header button span span');
      const ham = document.querySelector('[data-hamburger]');
      return { userRight: user ? Math.round(user.getBoundingClientRect().right) : null, hamRight: ham ? Math.round(ham.getBoundingClientRect().right) : null, hamLeft: ham ? Math.round(ham.getBoundingClientRect().left) : null };
    });
    ok('tombol garis tiga ada di pojok KANAN header', urutanHeader.hamLeft > 250, JSON.stringify(urutanHeader));
    const headerTxt = await page.locator('header.sticky').first().innerText();
    ok('nama pengguna tampil di header ponsel', headerTxt.includes('Guru UI A'), headerTxt.replace(/\n/g, ' | '));
    await ke('[data-hamburger]').click();
    await page.waitForTimeout(600);
    const laci = await page.evaluate(() => {
      const head = document.querySelector('[data-drawer-head]');
      const txt = document.body.innerText;
      return { ada: !!head, teks: head ? head.innerText : '', adaJadwal: /Jadwal Pelajaran/.test(txt), adaLaporan: /Laporan/i.test(txt) };
    });
    ok('laci menu terbuka dengan profil pengguna', laci.ada && /Guru UI A/.test(laci.teks), JSON.stringify(laci).slice(0, 200));
    ok('laci memuat menu pendukung yang tidak ada di bottom nav', laci.adaJadwal && laci.adaLaporan);

    /* desktop tidak berubah */
    await halamanBaru({ width: 1400, height: 950 });
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    ok('desktop TIDAK menampilkan navigasi bawah', await page.locator('[data-bottom-nav]').count() === 0);
    ok('desktop tanpa tombol hamburger', await page.locator('[data-hamburger]').isVisible().then(v => !v).catch(() => true));

    /* ---------------- F. PENGATURAN NAVIGASI OLEH ADMIN ---------------- */
    console.log('\n== F. PENGATURAN NAVIGASI OLEH ADMIN ==');
    await login('admin', 'admin123', { width: 1400, height: 950 });
    await page.goto(BASE + '/#/nav_mobile', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page="nav-mobile"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    ok('halaman pengaturan navigasi mobile terbuka untuk admin', await ke('[data-nav-role]').count() > 3);
    await ke('[data-nav-role="guru_umum"]').click();
    await page.waitForTimeout(500);
    const terpilih = await page.locator('[data-nav-item]').evaluateAll(els => els.map(e => e.getAttribute('data-nav-item')));
    ok('susunan awal guru mapel sesuai standar', terpilih.join(',') === 'kejadian,absensi_guru,jurnal', terpilih.join(','));
    await ke('[data-nav-hapus="jurnal"]').click();
    await page.waitForTimeout(300);
    await ke('[data-nav-pilih="laporan"]').click();
    await page.waitForTimeout(300);
    const sesudah = await page.locator('[data-nav-item]').evaluateAll(els => els.map(e => e.getAttribute('data-nav-item')));
    ok('menu dapat dilepas & ditambah', sesudah.join(',') === 'kejadian,absensi_guru,laporan', sesudah.join(','));
    await ke('[data-nav-simpan]').click();
    await page.waitForTimeout(1400);

    await login('gurua', 'guru123', { width: 390, height: 844 });
    await page.goto(BASE + '/#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    const navBaru = await page.locator('[data-bottom-nav-item]').evaluateAll(els => els.map(e => e.getAttribute('data-bottom-nav-item')));
    ok('perubahan admin langsung terpakai di ponsel guru', navBaru.join(',') === 'kejadian,absensi_guru,laporan', navBaru.join(','));

    ok('tidak ada error JS selama pengujian', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    for (const f of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
    console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
