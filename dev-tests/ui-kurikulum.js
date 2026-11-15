process.env.TZ = 'Asia/Jakarta';
'use strict';
/* Uji UI (Playwright) — kurikulum & cetak:
   1. Matriks jadwal: kartu target jam per kelas + badge kurang/lebih
   2. Tab "Pemetaan Jam Guru": isi target, simpan, badge status
   3. Pengaturan Jadwal: sakelar & standar target jam
   4. Data Kelas: kolom & isian target khusus kelas
   5. Halaman Kalender Akademik: grid 12 bulan, tandai tanggal, tandai massal, hapus
   6. Tombol Cetak/Word pada Program Layanan BK, Kanal Aduan, Tindak Lanjut
   7. Mobile 390px tanpa overflow & tanpa error JS
   Jalankan: node dev-tests/ui-kurikulum.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uikur-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uikur-saas-' + Date.now() + '.sqlite');
const PORT = 5900 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
const pad = n => String(n).padStart(2, '0');
const wib = new Date();
const TODAY = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
const BULAN = TODAY.slice(0, 7);

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2500));
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1420, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  try {
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 20000 });
    await page.waitForTimeout(900);

    /* siapkan data: pengaturan jadwal + 2 slot (2 mapel) */
    const setup = await page.evaluate(async ({ today }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const hari = new Date(today + 'T12:00:00').getDay();
      const sesi = [
        { label: 'Jam ke-1', mulai: '07:00', selesai: '07:45', istirahat: 0 },
        { label: 'Jam ke-2', mulai: '07:45', selesai: '08:30', istirahat: 0 },
        { label: 'Jam ke-3', mulai: '08:30', selesai: '09:15', istirahat: 0 }
      ];
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8, sesi, max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 15, tutup_menit: 15, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 60, auto_alpha: 1 },
        target_jam: { aktif: 1, minggu: 2 }
      });
      const users = (await get('/api/users')).rows || [];
      const gA = users.find(u => u.username === 'guru');
      const gB = users.find(u => u.username === 'guruumum');
      const kelas = (await get('/api/jadwal')).kelas || [];
      const m1 = (await post('/api/mapel/save', { nama: 'Matematika UI', kode: 'MTKUI', guru_ids: [gA.id] })).id;
      const m2 = (await post('/api/mapel/save', { nama: 'Bahasa UI', kode: 'BINUI', guru_ids: [gB.id] })).id;
      await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: m1, guru_id: gA.id, kelas_ids: [kelas[0].id], abaikan: 1 });
      await post('/api/jadwal/slot', { hari, sesi: 2, mapel_id: m2, guru_id: gB.id, kelas_ids: [kelas[0].id], abaikan: 1 });
      return { hari, kelasId: kelas[0].id, kelasNama: kelas[0].nama, guruA: gA.nama };
    }, { today: TODAY });
    ok('data uji siap (2 slot pada 1 kelas)', !!setup.kelasId, JSON.stringify(setup));

    /* ================= 1. MATRIKS: TARGET JAM PER KELAS ================= */
    console.log('\n== 1. MATRIKS JADWAL: VALIDASI TARGET JAM ==');
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-target-kelas]', { timeout: 20000 });
    await page.waitForTimeout(700);
    ok('kartu target jam per kelas tampil', (await page.locator('[data-target-kelas]').count()) === 1);
    const itemTarget = await page.locator('[data-target-item]').count();
    ok('badge target muncul untuk setiap kelas', itemTarget >= 1, String(itemTarget));
    const teksTarget = (await page.textContent('[data-target-kelas]')) || '';
    ok('kartu menampilkan standar jam sekolah', /standar\s*2\s*jam/i.test(teksTarget), teksTarget.slice(0, 120));
    ok('kelas dengan jam sesuai target berstatus pas', /1 pas|pas/i.test(teksTarget), teksTarget.slice(0, 160));
    const chipTarget = await page.locator('[data-chip-target]').count();
    ok('chip ringkas target tampil di toolbar', chipTarget === 1);

    /* ================= 2. TAB PEMETAAN JAM GURU ================= */
    console.log('\n== 2. PEMETAAN JAM GURU ==');
    await page.click('.tab:has-text("Pemetaan Jam Guru")');
    await page.waitForSelector('[data-tbl="guru-target"]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('tabel pemetaan jam guru tampil', (await page.locator('[data-tbl="guru-target"]').count()) === 1);
    const barisGuru = await page.locator('[data-guru-target]').count();
    ok('seluruh guru terdaftar pada tabel', barisGuru >= 2, String(barisGuru));
    const guruIdA = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-guru-target]')];
      const r = rows.find(x => /guru/i.test(x.textContent || '')) || rows[0];
      return r ? r.getAttribute('data-guru-target') : '';
    });
    ok('baris guru memiliki id target', !!guruIdA, guruIdA);
    await page.fill(`[data-target-minggu="${guruIdA}"]`, '5');
    await page.click('[data-target-simpan]');
    await page.waitForTimeout(1500);
    const statusA = (await page.textContent(`[data-target-status="${guruIdA}"]`)) || '';
    ok('status guru menjadi "Kurang" setelah target diisi', /kurang/i.test(statusA), statusA);
    const kelasKurang = await page.locator('.badge-pantau').count();
    ok('badge peringatan kuning muncul', kelasKurang >= 1, String(kelasKurang));
    /* muat ulang: nilai target tersimpan */
    await page.reload();
    await page.waitForSelector('.tab:has-text("Pemetaan Jam Guru")', { timeout: 20000 });
    await page.click('.tab:has-text("Pemetaan Jam Guru")');
    await page.waitForSelector('[data-tbl="guru-target"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    ok('target tersimpan setelah muat ulang',
      (await page.inputValue(`[data-target-minggu="${guruIdA}"]`)) === '5',
      await page.inputValue(`[data-target-minggu="${guruIdA}"]`));

    /* ================= 3. PENGATURAN JADWAL: TARGET ================= */
    console.log('\n== 3. PENGATURAN JADWAL: SAKELAR TARGET ==');
    await page.click('.tab:has-text("Pengaturan Jadwal")');
    await page.waitForSelector('[data-form-target]', { timeout: 20000 });
    await page.waitForTimeout(500);
    ok('sakelar target jam tampil', (await page.locator('[data-target-aktif]').count()) === 1);
    ok('sakelar target aktif', await page.locator('[data-target-aktif]').isChecked());
    ok('isian standar jam per pekan tersedia', (await page.inputValue('[data-target-minggu-jam]')) === '2',
      await page.inputValue('[data-target-minggu-jam]'));
    await page.fill('[data-target-minggu-jam]', '40');
    await page.click('button:has-text("Simpan Pengaturan Jadwal")');
    await page.waitForTimeout(1400);
    const simpanOk = await page.evaluate(async () => (await (await fetch('/api/jadwal/pengaturan', { credentials: 'same-origin' })).json()).target);
    ok('standar target tersimpan dari UI (40)', Number(simpanOk.minggu) === 40, JSON.stringify(simpanOk));

    /* ================= 4. DATA KELAS: TARGET KHUSUS ================= */
    console.log('\n== 4. DATA KELAS: TARGET KHUSUS ==');
    await page.goto(BASE + '/#/kelas');
    await page.waitForSelector('table', { timeout: 20000 });
    await page.waitForTimeout(700);
    ok('kolom target jam/pekan tampil', (await page.locator('th:has-text("Target Jam/Pekan")').count()) === 1);
    ok('sel target kelas tampil', (await page.locator('[data-kelas-target]').count()) >= 1);
    await page.click('button:has-text("Tambah Kelas")');
    await page.waitForTimeout(500);
    ok('isian target khusus tersedia pada form kelas', (await page.locator('[data-kelas-target-jam]').count()) === 1);
    await page.fill('#fKelas input.input >> nth=0', 'XII UI 1');
    await page.fill('[data-kelas-target-jam]', '36');
    await page.click('button[form="fKelas"]');
    await page.waitForTimeout(1400);
    const kelasBaru = await page.evaluate(async () => (await (await fetch('/api/kelas', { credentials: 'same-origin' })).json()).rows
      .find(k => k.nama === 'XII UI 1'));
    ok('target khusus kelas tersimpan (36 jam)', Number(kelasBaru?.target_jam) === 36, JSON.stringify(kelasBaru && kelasBaru.target_jam));

    /* ================= 5. HALAMAN KALENDER AKADEMIK ================= */
    console.log('\n== 5. KALENDER AKADEMIK ==');
    await page.goto(BASE + '/#/kalender_akademik');
    await page.waitForSelector('[data-page="kalender-akademik"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    const jumlahBulan = await page.locator('[data-bulan]').count();
    ok('grid menampilkan 12 bulan tahun ajaran', jumlahBulan === 12, String(jumlahBulan));
    ok('tombol Tandai Massal tersedia', (await page.locator('[data-tandai-massal]').count()) === 1);
    /* tandai satu tanggal lewat grid */
    await page.click(`[data-day="${TODAY}"]`);
    await page.waitForSelector('[data-kal-kategori]', { timeout: 10000 });
    await page.selectOption('[data-kal-kategori]', 'ujian');
    await page.fill('[data-kal-judul]', 'PAS Uji UI');
    await page.click('[data-simpan-tanggal]');
    await page.waitForTimeout(1500);
    const kalApi = await page.evaluate(async () => (await (await fetch('/api/kalender-akademik', { credentials: 'same-origin' })).json()));
    const adaUjian = (kalApi.rows || []).find(r => r.tanggal === new Date().toISOString().slice(0, 10));
    ok('tanggal berhasil ditandai dari grid', !!(kalApi.rows || []).find(r => r.kategori === 'ujian'), JSON.stringify((kalApi.rows || []).slice(0, 2)));
    ok('komponen hari pada grid berubah warna kategori', (await page.locator(`[data-day="${TODAY}"].bg-violet-100`).count()) === 1);
    /* tandai massal */
    await page.click('[data-tandai-massal]');
    await page.waitForSelector('[data-massal-dari]', { timeout: 10000 });
    await page.fill('[data-massal-dari]', `${BULAN}-01`);
    await page.fill('[data-massal-sampai]', `${BULAN}-28`);
    await page.selectOption('[data-massal-kategori]', 'libur');
    await page.fill('[data-massal-judul]', 'Libur Massal UI');
    await page.click('[data-simpan-massal]');
    await page.waitForTimeout(1600);
    const kalApi2 = await page.evaluate(async () => (await (await fetch('/api/kalender-akademik', { credentials: 'same-origin' })).json()));
    ok('penandaan massal dari UI tersimpan', (kalApi2.rows || []).filter(r => r.judul === 'Libur Massal UI').length >= 1,
      JSON.stringify((kalApi2.rows || []).length));
    /* tampilan daftar */
    await page.click('[data-mode-daftar]');
    await page.waitForSelector('[data-tbl="kalender-akademik"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    ok('tampilan daftar tanggal khusus tampil', (await page.locator('[data-tbl="kalender-akademik"] tbody tr').count()) >= 1);
    /* hapus satu baris */
    page.once('dialog', d => d.accept());
    await page.locator('[data-tbl="kalender-akademik"] tbody tr').first().locator('button[title="Hapus"]').click();
    await page.waitForTimeout(1400);
    const kalApi3 = await page.evaluate(async () => (await (await fetch('/api/kalender-akademik', { credentials: 'same-origin' })).json()));
    ok('hapus tanggal dari daftar bekerja', (kalApi3.rows || []).length < (kalApi2.rows || []).length,
      `${(kalApi2.rows || []).length} → ${(kalApi3.rows || []).length}`);

    /* ================= 6. TOMBOL CETAK/WORD ================= */
    console.log('\n== 6. TOMBOL CETAK & WORD (BK / ADUAN / TINDAK LANJUT) ==');
    await page.goto(BASE + '/#/bk_layanan');
    await page.waitForSelector('[data-page="program-bk"]', { timeout: 20000 });
    await page.waitForTimeout(700);
    ok('Program Layanan BK: tombol Cetak PDF tersedia', (await page.locator('[data-cetak-bk]').count()) === 1);
    const wordHref = await page.getAttribute('[data-word-bk]', 'href');
    ok('Program Layanan BK: tautan Word tersedia', /\/api\/bk\/layanan\/word/.test(wordHref || ''), wordHref);

    await page.goto(BASE + '/#/aduan');
    await page.waitForSelector('[data-cetak-aduan]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('Kanal Aduan: tombol Cetak PDF tersedia', (await page.locator('[data-cetak-aduan]').count()) === 1);
    ok('Kanal Aduan: tautan Word tersedia', /\/api\/aduan\/word/.test(await page.getAttribute('[data-word-aduan]', 'href') || ''));

    await page.goto(BASE + '/#/tindak_lanjut');
    await page.waitForSelector('[data-cetak-tl]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('Tindak Lanjut: tombol Cetak PDF tersedia', (await page.locator('[data-cetak-tl]').count()) === 1);
    ok('Tindak Lanjut: tautan Word tersedia', /\/api\/tindak-lanjut\/word/.test(await page.getAttribute('[data-word-tl]', 'href') || ''));

    /* ================= 7. MOBILE 390px ================= */
    console.log('\n== 7. MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 820 });
    for (const [hash, label] of [['#/kalender_akademik', 'kalender akademik'], ['#/jadwal', 'jadwal']]) {
      await page.goto(BASE + '/' + hash);
      await page.waitForTimeout(1100);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`tanpa overflow horizontal: ${label}`, ov <= 2, String(ov));
    }
    await page.goto(BASE + '/#/jadwal');
    await page.waitForTimeout(900);
    await page.click('.tab:has-text("Pemetaan Jam Guru")');
    await page.waitForSelector('[data-tbl="guru-target"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal: pemetaan jam guru', ov2 <= 2, String(ov2));

    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL UI KURIKULUM: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
