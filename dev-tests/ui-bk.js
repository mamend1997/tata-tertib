'use strict';
/* Uji UI (Playwright) modul baru: rekap absensi, kanal aduan, layanan BK,
   asesmen BK & pengaturan soal, serta halaman publik aduan/asesmen.
   Jalankan: node dev-tests/ui-bk.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uibk-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uibk-saas-' + Date.now() + '.sqlite');
const PORT = 5100 + Math.floor(Math.random() * 150);
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
  await new Promise(r => setTimeout(r, 2200));
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  try {
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.waitForTimeout(700);

    /* siapkan data absensi (mapel, jadwal hari ini, sesi, presensi) lewat API
       agar rekap & peringkat memiliki isi. */
    const wib = new Date(Date.now() + 7 * 3600 * 1000);
    const TODAY = wib.toISOString().slice(0, 10);
    const HARI = wib.getUTCDay();
    const hhmm = d => String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    const mulai = hhmm(new Date(Date.now() + 7 * 3600 * 1000 - 30 * 60000));
    const selesai = hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 60 * 60000));
    const setup = await page.evaluate(async ({ today, hari, mulai, selesai }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const users = await get('/api/users');
      const guru = (users.rows || []).find(u => u.role === 'guru');
      const mapel = await post('/api/mapel/save', { nama: 'Matematika', kode: 'MTK' });
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8,
        sesi: [{ label: 'Jam 1', mulai, selesai, istirahat: 0 }],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const siswa = await get('/api/siswa?limit=8');
      const rows = siswa.rows || [];
      const kelasId = rows[0].kelas_id;
      const slot = await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: mapel.id, guru_id: guru.id, kelas_ids: [kelasId], abaikan: 1 });
      const sesi = await post('/api/absensi-siswa/sesi', { jadwal_id: slot.id, tanggal: today });
      const items = rows.slice(0, 5).map((s, i) => ({
        siswa_id: s.id, status: ['A', 'B', 'S', 'I', 'H'][i], keterangan: i < 4 ? 'catatan' : ''
      }));
      await post('/api/absensi-siswa/simpan', { sesi_id: sesi.sesi.id, items });
      return { kelasId, jumlah: rows.length, sesi: sesi.sesi.id, jadwalId: slot.id, guruId: guru.id,
        siswa: rows.slice(0, 4).map(x => ({ nama: x.nama, nisn: x.nisn || x.nis, kelas_id: x.kelas_id, tanggal_lahir: x.tanggal_lahir })) };
    }, { today: TODAY, hari: HARI, mulai, selesai });
    ok('data absensi uji siap', !!setup.kelasId && !!setup.sesi, JSON.stringify(setup));

    /* ---------- rekap absensi guru ---------- */
    console.log('\n== REKAP ABSENSI GURU ==');
    await page.goto(BASE + '/#/rekap_absensi_guru');
    await page.waitForSelector('[data-page="rekap-absensi-guru"]', { timeout: 12000 });
    await page.waitForTimeout(700);
    ok('judul halaman rekap absensi guru', (await page.textContent('h2'))?.includes('Rekap Absensi Guru'));
    ok('filter periode & tanggal tersedia', await page.locator('[data-periode]').count() > 0);
    ok('filter guru & mapel tersedia',
      await page.locator('[data-filter-guru]').count() > 0 && await page.locator('[data-filter-mapel]').count() > 0);
    ok('tombol ekspor Excel & cetak PDF', await page.locator('[data-export-guru]').count() > 0 && await page.locator('[data-cetak-guru]').count() > 0);
    const rekapHariIni = await page.evaluate(async () =>
      (await fetch('/api/rekap/absensi-guru?periode=harian').then(r => r.json())));
    const barisBelum = (rekapHariIni.rows || []).find(r => Number(r.jadwal_id) === Number(setup.jadwalId));
    const ringkasanGuru = (rekapHariIni.guru || []).find(g => Number(g.guru_id) === Number(setup.guruId));
    ok('jadwal hari ini yang belum selesai tercatat sebagai Belum Dicatat, bukan Alpha',
      barisBelum?.status === 'belum' && Number(ringkasanGuru?.A) === 0 && Number(ringkasanGuru?.belum) === 1,
      JSON.stringify({ status: barisBelum?.status, A: ringkasanGuru?.A, belum: ringkasanGuru?.belum }));
    const headerRekap = await page.locator('[data-tbl="rekap-guru"] thead').innerText();
    ok('ringkasan memisahkan kolom Alpha dan Belum Dicatat',
      /Alpha/i.test(headerRekap) && /Belum Dicatat/i.test(headerRekap), headerRekap);
    await page.selectOption('[data-periode]', 'tahun');
    await page.waitForTimeout(800);
    ok('ganti periode memuat ulang tanpa error', errors.length === 0, errors.join(' | '));
    ok('KPI total jam mengajar tampil', (await page.textContent('body'))?.includes('Total Jam Mengajar'));

    /* ---------- rekap absensi siswa ---------- */
    console.log('\n== REKAP ABSENSI SISWA ==');
    await page.goto(BASE + '/#/rekap_absensi_siswa');
    await page.waitForSelector('[data-page="rekap-absensi-siswa"]', { timeout: 12000 });
    await page.waitForTimeout(800);
    ok('tab per kelas / per siswa / peringkat / WA', await page.locator('.tab').count() >= 4);
    await page.selectOption('[data-filter-kelas]', String(setup.kelasId));
    await page.click('text=Terapkan Filter');
    await page.waitForTimeout(900);
    ok('tabel rekap siswa tampil', await page.locator('[data-tbl="rekap-siswa"]').count() > 0,
      (await page.textContent('body'))?.slice(0, 120));
    await page.click('[data-tab="peringkat"]');
    await page.waitForTimeout(1000);
    ok('peringkat memuat 4 tabel kategori',
      await page.locator('[data-ranking]').count() === 4, String(await page.locator('[data-ranking]').count()));
    await page.click('[data-tab="whatsapp"]');
    await page.waitForSelector('[data-wa-kelas-jam]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    ok('pengaturan jam pengiriman & hari kerja tampil',
      await page.locator('[data-wa-kelas-jam]').count() > 0 && (await page.textContent('body'))?.includes('Hari Pengiriman'));
    ok('tabel pemetaan nomor wali kelas', await page.locator('[data-tbl="wali-kelas"]').count() > 0);
    ok('tombol pratinjau & kirim sekarang', await page.locator('[data-wa-kirim]').count() > 0);
    await page.click('[data-wa-preview]');
    await page.waitForSelector('[data-preview-rekap]', { timeout: 12000 }).catch(async () => console.log('[debug]', (await page.textContent('body')).slice(-400)));
    ok('pratinjau pesan rekap per kelas muncul', await page.locator('[data-preview-rekap]').count() > 0);
    await page.keyboard.press('Escape');

    /* ---------- kanal aduan ---------- */
    console.log('\n== KANAL ADUAN KEKERASAN ==');
    await page.goto(BASE + '/#/aduan');
    await page.waitForSelector('[data-page="kanal-aduan"]', { timeout: 12000 });
    await page.waitForTimeout(1200);
    ok('judul & panduan kanal aduan', (await page.textContent('body'))?.includes('Kanal Aduan Kekerasan') &&
      (await page.textContent('body'))?.includes('Hanya Anda yang bisa membaca aduan untuk Anda'));
    ok('QR aduan tampil (SVG)', await page.locator('[data-qr-aduan] svg').count() > 0);
    ok('kotak link aduan terisi', (await page.inputValue('[data-link-aduan]')).includes('/aduan/'));
    ok('tombol bagikan/unduh/salin/reset', await page.locator('[data-unduh-qr]').count() > 0 &&
      await page.locator('[data-reset-qr]').count() > 0 && await page.locator('[data-salin-link]').count() > 0);
    ok('input nomor layanan kesehatan jiwa & Unit PPA',
      await page.locator('[data-aduan-keswa]').count() > 0 && await page.locator('[data-aduan-ppa]').count() > 0);
    await page.fill('[data-aduan-keswa]', '119 ext 8');
    await page.fill('[data-aduan-ppa]', '0812-9999-0000');
    await page.click('[data-simpan-layanan]');
    await page.waitForTimeout(700);
    ok('nomor layanan tersimpan via UI', (await page.inputValue('[data-aduan-keswa]')) === '119 ext 8');
    ok('tab status aduan dengan penghitung (4)', await page.locator('[data-status-aduan]').count() === 4);
    ok('tombol Unduh Excel hijau tersedia', (await page.textContent('body'))?.includes('Unduh Excel'));

    /* ---------- program layanan BK ---------- */
    console.log('\n== PROGRAM LAYANAN BK ==');
    await page.goto(BASE + '/#/bk_layanan');
    await page.waitForSelector('[data-page="program-bk"]', { timeout: 12000 });
    await page.waitForTimeout(700);
    ok('judul & deskripsi Program Layanan BK', (await page.textContent('body'))?.includes('Program Layanan BK') &&
      (await page.textContent('body'))?.includes('bimbingan konseling komprehensif'));
    ok('tab kategori layanan (semua + 3)', await page.locator('[data-kategori-bk]').count() === 4);
    await page.click('[data-catat-layanan]');
    await page.waitForSelector('[data-jenis-layanan]', { timeout: 8000 });
    ok('modal Catat Layanan terbuka', await page.locator('[data-jenis-layanan]').count() > 0);
    const opsiJenis = await page.locator('[data-jenis-layanan] option').count();
    ok('dropdown jenis layanan berkelompok (13+ jenis)', opsiJenis >= 13, String(opsiJenis));
    await page.selectOption('[data-jenis-layanan]', { label: 'Bimbingan Klasikal' });
    await page.waitForTimeout(300);
    ok('sasaran kelas muncul untuk bimbingan klasikal', await page.locator('[data-kelas-bk]').count() > 0);
    await page.selectOption('[data-jenis-layanan]', { label: 'Mediasi' });
    await page.waitForTimeout(300);
    ok('sasaran siswa muncul untuk mediasi', await page.locator('[data-multi-picker]').count() > 0);
    await page.fill('[data-topik-bk]', 'Berkelahi di kantin');
    await page.selectOption('[data-jenis-layanan]', { label: 'Mediasi' });
    /* pilih satu siswa lewat pencarian picker */
    await page.fill('[data-multi-input]', 'Ahmad');
    await page.waitForTimeout(600);
    if (await page.locator('[data-multi-picker] [data-pick]').count() > 0) {
      await page.locator('[data-multi-picker] [data-pick]').first().click();
    }
    await page.click('[data-simpan-layanan-bk]');
    await page.waitForTimeout(1200);
    ok('layanan BK tersimpan lewat UI', (await page.textContent('body'))?.includes('Berkelahi di kantin'),
      (await page.textContent('body'))?.slice(0, 120));

    /* pengaturan tanda tangan */
    await page.click('text=Pengaturan Tanda Tangan');
    await page.waitForTimeout(500);
    ok('modal pengaturan tanda tangan & jenis layanan terbuka', (await page.textContent('body'))?.includes('Jenis Layanan (dapat diedit)'));
    await page.keyboard.press('Escape');

    /* ---------- asesmen BK ---------- */
    console.log('\n== ASESMEN SISWA BK ==');
    await page.goto(BASE + '/#/asesmen');
    await page.waitForSelector('[data-page="asesmen-bk"]', { timeout: 12000 });
    await page.waitForTimeout(1200);
    ok('4 kartu instrumen asesmen', await page.locator('[data-instrumen]').count() === 4);
    ok('tautan asesmen & QR tampil', (await page.inputValue('[data-link-asesmen]')).includes('/asesmen/'));
    ok('QR asesmen tampil', await page.locator('[data-link-asesmen]').count() > 0 && await page.locator('svg').count() > 0);
    ok('tombol reset QR & unduh', await page.locator('[data-rotate-link]').count() > 0 && await page.locator('[data-unduh-qr-asesmen]').count() > 0);
    await page.click('[data-instrumen="riasec"]');
    await page.waitForTimeout(800);
    ok('ganti instrumen ke RIASEC', (await page.textContent('body'))?.includes('RIASEC'));
    ok('empty state analisis sebelum ada hasil', (await page.textContent('body'))?.includes('Belum ada hasil asesmen'));

    /* ---------- pengaturan soal ---------- */
    console.log('\n== PENGATURAN SOAL ASESMEN ==');
    await page.goto(BASE + '/#/asesmen_soal');
    await page.waitForSelector('[data-page="asesmen-soal"]', { timeout: 12000 });
    await page.waitForTimeout(900);
    ok('tab 4 instrumen soal', await page.locator('[data-instrumen-soal]').count() === 4);
    ok('tabel bank soal AKPD (28 butir)', await page.locator('[data-tbl="bank-soal"] tbody tr').count() === 28,
      String(await page.locator('[data-tbl="bank-soal"] tbody tr').count()));
    ok('select kategori analisis per butir', await page.locator('[data-butir-kategori]').count() === 28);
    const sebelum = await page.locator('[data-tbl="bank-soal"] tbody tr').count();
    await page.click('[data-tambah-butir]');
    await page.waitForTimeout(300);
    ok('tambah butir baris baru', await page.locator('[data-tbl="bank-soal"] tbody tr').count() === sebelum + 1);
    await page.fill('[data-butir-teks="' + sebelum + '"]', 'Saya ingin mengikuti kegiatan pengembangan diri di sekolah');
    await page.click('[data-simpan-bank-soal]');
    await page.waitForTimeout(1200);
    ok('simpan & perbarui bank soal berhasil versi naik',
      (await page.textContent('body'))?.includes(`Versi bank soal saat ini: 2`),
      (await page.textContent('body'))?.match(/Versi bank soal saat ini: \d+/)?.[0] || '');
    ok('tombol template & import soal tersedia',
      (await page.textContent('body'))?.includes('Template Excel') && await page.locator('[data-import-soal]').count() > 0);

    /* ---------- halaman publik (aduan & asesmen) ---------- */
    console.log('\n== HALAMAN PUBLIK ==');
    const aduanLink = await page.evaluate(async () => {
      const r = await fetch('/api/aduan', { credentials: 'same-origin' });
      const j = await r.json();
      return j.link.url;
    });
    const aduanPath = new URL(aduanLink).pathname;
    await page.goto(BASE + aduanPath);
    await page.waitForSelector('[data-form-aduan]', { timeout: 12000 });
    ok('halaman aduan publik: judul & form', (await page.textContent('body'))?.includes('Kanal Aduan Kekerasan') &&
      await page.locator('[data-aduan-nama]').count() > 0);
    ok('halaman aduan publik menampilkan nomor layanan',
      (await page.textContent('body'))?.includes('119 ext 8'));
    const sAduan = setup.siswa[0];
    await page.fill('[data-aduan-nama]', sAduan.nama);
    await page.selectOption('[data-aduan-kelas]', String(sAduan.kelas_id));
    await page.fill('[data-aduan-dob]', String(sAduan.tanggal_lahir).slice(0, 10));
    await page.fill('[data-aduan-kronologi]', 'Saya mendapat perlakuan tidak menyenangkan dari teman sekelas saat jam istirahat.');
    await page.click('[data-kirim-aduan]');
    await page.waitForSelector('[data-aduan-sukses]', { timeout: 12000 }).catch(() => {});
    ok('siswa dapat mengirim aduan lewat halaman publik', await page.locator('[data-aduan-sukses]').count() > 0,
      (await page.textContent('body'))?.slice(0, 160));
    const asesmenLink = await (async () => {
      await page.goto(BASE + '/#/asesmen');
      await page.waitForSelector('[data-page="asesmen-bk"]', { timeout: 12000 });
      await page.waitForTimeout(900);
      await page.click('[data-instrumen="kesulitan"]');
      await page.waitForTimeout(900);
      return page.inputValue('[data-link-asesmen]');
    })();
    const asesmenPath = new URL(asesmenLink).pathname;
    await page.goto(BASE + asesmenPath);
    await page.waitForSelector('[data-identitas-asesmen]', { timeout: 12000 });
    ok('halaman asesmen publik: autocomplete nama + tanggal lahir',
      await page.locator('[data-input-nama-siswa]').count() > 0 && await page.locator('[data-asesmen-dob]').count() > 0);
    ok('petunjuk pengerjaan tampil', (await page.textContent('body'))?.length > 100);
    const sAsesmen = setup.siswa[1];
    await page.fill('[data-input-nama-siswa]', sAsesmen.nama);
    await page.waitForSelector('[data-pick]', { timeout: 8000 }).catch(() => {});
    const pickAsesmen = page.locator(`[data-pick="${sAsesmen.id}"]`);
    if (await pickAsesmen.count()) await pickAsesmen.click();
    else await page.locator('[data-pick]').first().click();
    await page.waitForTimeout(300);
    await page.fill('[data-asesmen-dob]', String(sAsesmen.tanggal_lahir).slice(0, 10));
    await page.click('[data-cek-identitas]');
    await page.waitForSelector('[data-daftar-soal]', { timeout: 12000 }).catch(() => {});
    ok('verifikasi identitas membuka daftar pernyataan', await page.locator('[data-daftar-soal]').count() > 0,
      (await page.textContent('body'))?.slice(0, 160));
    ok('jumlah pernyataan sesuai instrumen (15)', await page.locator('[data-soal]').count() === 15);
    const ceklis = page.locator('[data-soal] input[type="checkbox"]');
    await ceklis.nth(0).check();
    await ceklis.nth(3).check();
    await ceklis.nth(7).check();
    await page.click('[data-kirim-asesmen]');
    await page.waitForSelector('[data-asesmen-sukses]', { timeout: 15000 }).catch(() => {});
    ok('siswa dapat menyelesaikan asesmen lewat halaman publik', await page.locator('[data-asesmen-sukses]').count() > 0,
      (await page.textContent('body'))?.slice(0, 160));

    /* ---------- mobile tanpa overflow ---------- */
    console.log('\n== MOBILE 390px ==');
    const pagesMobile = ['#/rekap_absensi_guru', '#/rekap_absensi_siswa', '#/aduan', '#/bk_layanan', '#/asesmen', '#/asesmen_soal'];
    for (const p of pagesMobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BASE + '/' + p);
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok('tanpa overflow horizontal ' + p, overflow <= 2, 'overflow ' + overflow + 'px');
      await page.setViewportSize({ width: 1366, height: 900 });
    }
    ok('tidak ada error JavaScript di seluruh halaman', errors.length === 0, errors.slice(0, 3).join(' | '));
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
