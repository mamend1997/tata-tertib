'use strict';
/* Uji UI ronde 21 (Playwright):
   - Form slot: guru pengampu TERKUNCI (tidak ada select guru)
   - Tab Mata Pelajaran: guru pengampu tampil, tombol Import + template
   - Matriks: 3 mode tampilan (per kelas/semua kelas/per guru), hapus massal & sticky header
   - Pengaturan: editor sesi jam khusus per hari (mis. Upacara)
   - Cetak/ekspor jadwal tidak menampilkan pesan "belum ada kelas atau slot"
   - Menu Absensi Guru: sesi hari ini langsung muncul
   Jalankan: node dev-tests/ui-round21.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui21-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-ui21-saas-' + Date.now() + '.sqlite');
const PORT = 5200 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const HARI = now.getDay();
const cur = now.getHours() * 60 + now.getMinutes();
const base = Math.min(cur, 1440 - 130);
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2300));
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  let errors = [];
  page.on('pageerror', e => errors.push(e.message));

  try {
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.waitForTimeout(600);

    /* ---------------- siapkan data: sesi 3 jam + slot ---------------- */
    const setup = await page.evaluate(async ({ hari, mulai, selesai, mulai2, selesai2, mulai3, selesai3 }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const users = await get('/api/users');
      const guru = (users.rows || []).find(u => u.username === 'guru');
      const guru2 = (users.rows || []).find(u => u.username === 'guruumum');
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8,
        sesi: [
          { label: 'Jam ke-1', mulai, selesai, istirahat: 0 },
          { label: 'Istirahat', mulai: selesai, selesai: mulai2, istirahat: 1 },
          { label: 'Jam ke-2', mulai: mulai2, selesai: selesai2, istirahat: 0 },
          { label: 'Jam ke-3', mulai: mulai3, selesai: selesai3, istirahat: 0 }
        ],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 120 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const mapel = await post('/api/mapel/save', { nama: 'Matematika', kode: 'MTK', guru_ids: [guru.id] });
      const mapel2 = await post('/api/mapel/save', { nama: 'Bahasa Indonesia', kode: 'BIN', guru_ids: [guru2.id] });
      const jadwal = await get('/api/jadwal');
      const kelas = jadwal.kelas || [];
      const slot = await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: mapel.id, kelas_ids: [kelas[0].id], abaikan: 1 });
      await post('/api/jadwal/slot', { hari, sesi: 3, mapel_id: mapel2.id, kelas_ids: [kelas[1].id], abaikan: 1 });
      return {
        guruId: guru.id, guruNama: guru.nama, guru2Id: guru2.id, guru2Nama: guru2.nama,
        mapelId: mapel.id, mapel2Id: mapel2.id, slotId: slot.id, kelasNama: kelas[0].nama, kelas2Nama: kelas[1].nama,
        jumlahKelas: kelas.length
      };
    }, {
      hari: HARI,
      mulai: hhmm(base - 10), selesai: hhmm(base + 25),
      mulai2: hhmm(base + 26), selesai2: hhmm(base + 60),
      mulai3: hhmm(base + 61), selesai3: hhmm(base + 95)
    });
    ok('data uji siap (mapel + guru pengampu + slot)', !!setup.slotId, JSON.stringify(setup).slice(0, 160));

    /* ---------------- 1. FORM SLOT: GURU TERKUNCI ---------------- */
    console.log('\n== 1. FORM SLOT: GURU TERKUNCI ==');
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-grid-jadwal]', { timeout: 15000 });
    await page.waitForTimeout(900);
    await page.locator('[data-slot-kosong]').first().click();
    await page.waitForSelector('[data-mapel-slot]', { timeout: 8000 });
    ok('form slot tidak menyediakan pemilihan guru manual', await page.locator('select[name="guru_id"]').count() === 0);
    await page.selectOption('[data-mapel-slot]', String(setup.mapelId));
    await page.waitForTimeout(400);
    ok('guru pengampu terisi & terkunci dari mapel',
      (await page.getAttribute('[data-guru-terkunci]', 'data-guru-terkunci')) === String(setup.guruId),
      await page.getAttribute('[data-guru-terkunci]', 'data-guru-terkunci'));
    const teksGuru = await page.locator('[data-guru-terkunci]').innerText();
    ok('nama guru pengampu tampil pada kotak terkunci', teksGuru.includes(setup.guruNama.split(',')[0]), teksGuru);
    ok('ada penanda "Terkunci"', teksGuru.includes('Terkunci'), teksGuru);
    /* ganti ke mapel lain → guru ikut berganti */
    await page.selectOption('[data-mapel-slot]', String(setup.mapel2Id));
    await page.waitForTimeout(400);
    ok('ganti mapel mengganti guru terkunci otomatis',
      (await page.getAttribute('[data-guru-terkunci]', 'data-guru-terkunci')) === String(setup.guru2Id));
    await page.keyboard.press('Escape');

    /* ---------------- 2. GURU PENGAMPU & IMPORT MAPEL ---------------- */
    console.log('\n== 2. TAB MATA PELAJARAN (GURU & IMPORT) ==');
    await page.click('text=Mata Pelajaran');
    await page.waitForTimeout(1000);
    const teksMapel = await page.locator('main').innerText();
    ok('tabel mapel menampilkan guru pengampu', teksMapel.includes(setup.guruNama.split(',')[0]));
    ok('ada penanda guru terkunci', /terkunci|pengampu/i.test(teksMapel), teksMapel.slice(0, 160));
    ok('tombol Import Mata Pelajaran tersedia', await page.locator('[data-import-mapel]').count() === 1);
    ok('tautan Template Excel tersedia', await page.locator('[data-template-mapel]').count() === 1);
    await page.click('[data-import-mapel]');
    await page.waitForSelector('[data-file-mapel]', { timeout: 8000 });
    ok('modal import mapel terbuka (unggah berkas)', await page.locator('[data-file-mapel]').count() === 1);
    ok('modal menyebut kolom wajib template', /GURU PENGAMPU/.test(await page.locator('[data-modal]').innerText()));
    await page.keyboard.press('Escape');

    /* ---------------- 3. MULTI-TAMPILAN MATRIKS ---------------- */
    console.log('\n== 3. MULTI-TAMPILAN MATRIKS ==');
    await page.click('text=Matriks Jadwal');
    await page.waitForTimeout(700);
    ok('3 pilihan tampilan dengan urutan Per Kelas → Semua Kelas → Per Guru',
      await page.locator('[data-view]').count() === 3
      && (await page.locator('[data-view]').allTextContents()).map(x => x.trim()).join('|').includes('Per Kelas|Semua Kelas|Per Guru'));
    ok('tampilan default per kelas', await page.locator('[data-grid-jadwal]').count() === 1);
    ok('kartu slot menampilkan kode mapel', (await page.locator('[data-slot]').first().innerText()).includes('MTK'),
      await page.locator('[data-slot]').first().innerText());
    ok('kontrol hapus massal tampil untuk pengguna berizin',
      await page.locator('[data-pilih-semua-slot]').count() === 1
      && await page.locator('[data-slot-hapus-terpilih]').count() === 1
      && await page.locator('[data-reset-matriks]').count() === 1);
    const cekSlot = page.locator('[data-slot-pilih]').first();
    await cekSlot.check();
    ok('menandai slot mengaktifkan tombol Hapus Terpilih',
      await page.locator('[data-slot-hapus-terpilih]').isEnabled());
    await cekSlot.uncheck();
    await page.click('[data-view="semua"]');
    await page.waitForTimeout(800);
    ok('tampilan semua kelas menampilkan grid bersama', await page.locator('[data-grid-semua]').count() === 1);
    const headerSemua = await page.locator('[data-grid-semua] thead').innerText();
    ok('grid semua kelas memuat judul Hari/Jam dan nama kelas',
      /Hari \/ Jam/i.test(headerSemua) && headerSemua.includes(setup.kelasNama), headerSemua.slice(0, 80));
    const bodySemua = await page.locator('[data-grid-semua] tbody').innerText();
    ok('grid semua kelas berisi hari, jam, dan mapel', /Jam ke-1/.test(bodySemua) && /MTK|BIN/.test(bodySemua));
    const stickySemua = await page.evaluate(async () => {
      const scroller = document.querySelector('[data-grid-semua-scroll]');
      const heading = scroller?.querySelector('thead th');
      if (!scroller || !heading) return false;
      scroller.scrollTop = 500;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Math.abs(heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top) <= 3;
    });
    ok('judul Hari/Jam dan kelas tetap terlihat saat grid semua kelas digulir', stickySemua);
    await page.click('[data-view="kelas"]');
    await page.waitForTimeout(500);
    const stickyKelas = await page.evaluate(async () => {
      const grid = document.querySelector('[data-grid-jadwal]');
      const heading = grid?.querySelector('[data-header-hari]');
      if (!grid || !heading) return null;
      window.scrollTo(0, grid.getBoundingClientRect().top + window.scrollY + 100);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const info = {
        top: Math.round(heading.getBoundingClientRect().top),
        gridTop: Math.round(grid.getBoundingClientRect().top),
        gridBottom: Math.round(grid.getBoundingClientRect().bottom),
        scrollY: Math.round(window.scrollY)
      };
      window.scrollTo(0, 0);
      return info;
    });
    ok('judul hari per kelas melekat saat halaman digulir',
      !!stickyKelas && stickyKelas.top >= 0 && stickyKelas.top <= 10, JSON.stringify(stickyKelas));
    await page.click('[data-view="guru"]');
    await page.waitForTimeout(700);
    ok('pilihan guru muncul pada tampilan per guru', await page.locator('[data-pilih-guru]').count() === 1);
    await page.selectOption('[data-pilih-guru]', String(setup.guruId));
    await page.waitForTimeout(800);
    ok('tampilan per guru merender grid jadwal guru', await page.locator('[data-grid-jadwal]').count() === 1);
    const kartuGuruTerpilih = await page.locator('[data-grid-jadwal] [data-slot]').allTextContents();
    ok('matriks per guru hanya menampilkan slot guru terpilih',
      kartuGuruTerpilih.length > 0 && kartuGuruTerpilih.every(teks => teks.includes(setup.guruNama)),
      kartuGuruTerpilih.map(teks => teks.slice(-50)).join(' | '));
    await page.click('[data-view="semua"]');
    await page.waitForTimeout(800);
    ok('tampilan semua kelas dalam satu grid', await page.locator('[data-grid-semua]').count() === 1);
    await page.selectOption('[data-filter-guru-semua]', String(setup.guruId));
    const kartuGuruVertikal = await page.locator('[data-grid-semua] [data-slot]').allTextContents();
    ok('filter guru pada tampilan baris hanya menampilkan slot guru terpilih',
      kartuGuruVertikal.length > 0 && kartuGuruVertikal.every(teks => teks.includes(setup.guruNama)),
      kartuGuruVertikal.map(teks => teks.slice(-50)).join(' | '));
    ok('tanpa error JS pada semua tampilan', errors.length === 0, errors.slice(0, 2).join(' | '));

    /* ---------------- 4. SESI JAM KHUSUS PER HARI ---------------- */
    console.log('\n== 4. SESI JAM KHUSUS PER HARI ==');
    await page.locator('.tab', { hasText: 'Pengaturan Jadwal' }).first().click();
    await page.waitForSelector('[data-form-jadwal]', { timeout: 15000 });
    await page.waitForTimeout(900);
    ok('panel sesi khusus per hari tersedia', await page.locator('[data-sesi-per-hari]').count() === 1,
      (await page.locator('main').innerText()).slice(0, 120));
    await page.click(`[data-hari-sesi="${HARI}"]`);
    await page.waitForTimeout(400);
    await page.click('[data-aktifkan-sesi-hari]');
    await page.waitForTimeout(500);
    ok('editor sesi per hari muncul', await page.locator(`[data-editor-sesi-hari="${HARI}"]`).count() === 1);
    await page.fill('[data-label-sesi-hari="0"]', 'Upacara Bendera');
    await page.waitForTimeout(200);
    await page.click('button:has-text("Simpan Pengaturan")');
    await page.waitForTimeout(1400);
    ok('sesi khusus tersimpan', /tersimpan|disimpan/i.test(await page.locator('main').innerText()));
    await page.reload();
    await page.waitForTimeout(1200);
    await page.locator('.tab', { hasText: 'Pengaturan Jadwal' }).first().click();
    await page.waitForSelector('[data-sesi-per-hari]', { timeout: 15000 });
    await page.click(`[data-hari-sesi="${HARI}"]`);
    await page.waitForTimeout(500);
    ok('label sesi khusus bertahan setelah muat ulang',
      (await page.inputValue('[data-label-sesi-hari="0"]')) === 'Upacara Bendera',
      await page.inputValue('[data-label-sesi-hari="0"]'));
    /* tampil juga di matriks */
    await page.click('text=Matriks Jadwal');
    await page.waitForTimeout(900);
    ok('label Upacara tampil pada matriks jadwal',
      /upacara/i.test(await page.locator('[data-grid-jadwal]').innerText()),
      (await page.locator('[data-grid-jadwal]').innerText()).slice(0, 120));

    /* ---------------- 5. CETAK / EKSPOR JADWAL ---------------- */
    console.log('\n== 5. CETAK & EKSPOR JADWAL ==');
    for (const [mode, label] of [['kelas', 'Per Kelas'], ['semua', 'Semua Kelas'], ['guru', 'Per Guru']]) {
      await page.click(`[data-view="${mode}"]`);
      await page.waitForTimeout(500);
      if (mode === 'guru' && (await page.locator('[data-pilih-guru]').count())) {
        await page.selectOption('[data-pilih-guru]', String(setup.guruId));
        await page.waitForTimeout(400);
      }
      const href = await page.getAttribute('[data-cetak-jadwal]', 'href');
      const res = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'same-origin' });
        return { status: r.status, text: await r.text() };
      }, new URL(href, BASE).pathname);
      ok(`cetak PDF mode ${mode} (${label}) terbuka`, res.status === 200 && /JADWAL PELAJARAN/.test(res.text), String(res.status));
      ok(`mode ${mode} tidak menampilkan pesan "belum ada kelas atau slot jadwal"`, !/Belum ada kelas atau slot jadwal/i.test(res.text));
      const exp = await page.getAttribute('[data-export-jadwal]', 'href');
      const resX = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'same-origin' });
        return { status: r.status, ct: r.headers.get('content-type') || '' };
      }, new URL(exp, BASE).pathname);
      ok(`ekspor Excel mode ${mode}`, resX.status === 200 && /spreadsheet/.test(resX.ct), `${resX.status} ${resX.ct}`);
    }

    /* ---------------- 6. ABSENSI GURU: SESI LANGSUNG MUNCUL ---------------- */
    console.log('\n== 6. ABSENSI GURU MENDETEKSI JADWAL HARI INI ==');
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await page.context().clearCookies();
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'guru');
    await page.fill('input[type="password"]', 'guru123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.goto(BASE + '/#/absensi_guru');
    await page.waitForSelector('[data-page="absensi-guru"]', { timeout: 15000 });
    await page.waitForTimeout(1500);
    ok('sesi mengajar hari ini langsung tampil', await page.locator('[data-slot-absensi]').count() >= 1,
      String(await page.locator('[data-slot-absensi]').count()));
    ok('tanggal default memakai tanggal lokal (hari ini)', /Rekap Absensi Guru|Absensi Guru Mengajar/.test(await page.locator('main').innerText()));
    ok('tombol Check-in Hadir tersedia & aktif', await page.locator('[data-checkin]').first().isEnabled());
    ok('tombol Sakit & Izin juga tersedia',
      await page.locator('[data-sakit]').count() >= 1 && await page.locator('[data-izin]').count() >= 1);
    await page.locator('[data-checkin]').first().click();
    await page.waitForTimeout(1600);
    ok('check-in berhasil dari UI', /Hadir/.test(await page.locator('[data-slot-absensi]').first().innerText()),
      (await page.locator('[data-slot-absensi]').first().innerText()).slice(0, 80));
    ok('tidak ada error JS di halaman absensi guru', errors.length === 0, errors.slice(0, 2).join(' | '));

    /* ---------------- 7. MOBILE 390px ---------------- */
    console.log('\n== 7. MOBILE 390px ==');
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await page.context().clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    for (const p of ['#/jadwal', '#/absensi_guru']) {
      await page.goto(BASE + '/' + p);
      await page.waitForTimeout(1100);
      const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok('tanpa overflow horizontal ' + p, of <= 2, 'overflow ' + of + 'px');
    }
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-reset-matriks]', { timeout: 15000 });
    const resetBefore = await page.evaluate(async () => {
      const r = await (await fetch('/api/jadwal', { credentials: 'same-origin' })).json();
      return { ta: r.ta, count: (r.rows || []).length };
    });
    page.once('dialog', dialog => dialog.accept());
    await page.click('[data-reset-matriks]');
    await page.waitForTimeout(1200);
    const resetAfter = await page.evaluate(async ta => {
      const r = await (await fetch(`/api/jadwal?ta=${ta}`, { credentials: 'same-origin' })).json();
      return (r.rows || []).length;
    }, resetBefore.ta);
    ok('Reset Matriks menghapus slot pada TA terpilih setelah konfirmasi',
      resetBefore.count > 0 && resetAfter === 0, `${resetBefore.count} → ${resetAfter}`);
    ok('tanpa error JS pada pengujian mobile', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) {}
    try { fs.unlinkSync(SAAS); } catch (e) {}
  }

  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) {
    console.log('GAGAL:');
    fails.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
