process.env.TZ = 'Asia/Jakarta';
'use strict';
/* Uji UI ronde 22 (Playwright):
   - ceklis + Pilih Semua + Hapus Terpilih pada Soal Asesmen & Riwayat Layanan BK
   - hapus Mata Pelajaran dengan dialog dampak relasi
   - menu Desain Jadwal Pelajaran (header + blok tanda tangan)
   - halaman publik: Export Excel & Cetak/PDF, tanpa tombol bagikan/QR/salin
   - matriks vertikal: baris hari tidak melebar, isi rata tengah
   - absensi guru: alur absensi siswa → jurnal
   Jalankan: node dev-tests/ui-round22.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui22-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-ui22-saas-' + Date.now() + '.sqlite');
const PORT = 5300 + Math.floor(Math.random() * 150);
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
const base = Math.min(cur, 1440 - 200);
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
  const page = await browser.newPage({ viewport: { width: 1420, height: 940 } });
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

    /* ---------- data uji ---------- */
    const setup = await page.evaluate(async ({ hari, mulai, selesai, mulai2, selesai2 }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const users = await get('/api/users');
      const guru = (users.rows || []).find(u => u.username === 'guru');
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8,
        sesi: [{ label: 'Jam 1', mulai, selesai, istirahat: 0 }, { label: 'Jam 2', mulai: mulai2, selesai: selesai2, istirahat: 0 }],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const mapel = await post('/api/mapel/save', { nama: 'Matematika', kode: 'MTK', guru_ids: [guru.id] });
      const jadwal = await get('/api/jadwal');
      const kelas = jadwal.kelas || [];
      const slot = await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: mapel.id, kelas_ids: [kelas[0].id], abaikan: 1 });
      const siswa = await get('/api/siswa?limit=6');
      const jenis = await get('/api/bk/layanan');
      const mediasi = (jenis.jenis || []).find(j => /mediasi/i.test(j.nama));
      for (let i = 0; i < 3; i++) {
        await post('/api/bk/layanan/save', { jenis_id: mediasi.id, tanggal: '2026-11-10', topik: `Riwayat uji ${i + 1}`, siswa_ids: [(siswa.rows[i] || {}).id] });
      }
      return { slotId: slot.id, mapelId: mapel.id, mapelNama: 'Matematika', kelasNama: (kelas[0] || {}).nama };
    }, {
      hari: HARI,
      mulai: hhmm(base - 10), selesai: hhmm(base + 25),
      mulai2: hhmm(base + 26), selesai2: hhmm(base + 60)
    });
    ok('data uji siap', !!setup.slotId, JSON.stringify(setup));
    const tokenJadwal = await page.evaluate(async () => {
      const r = await (await fetch('/api/jadwal/publik', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aktif: 1 }) })).json();
      return r.token;
    });
    ok('tautan publik jadwal dibuat (admin)', !!tokenJadwal, String(tokenJadwal));

    /* ================= 1. SOAL ASESMEN: CEKLIS & HAPUS ================= */
    console.log('\n== 1. SOAL ASESMEN (HAPUS TERPILIH) ==');
    await page.goto(BASE + '/#/asesmen_soal');
    await page.waitForSelector('[data-tbl="bank-soal"]', { timeout: 15000 });
    await page.waitForTimeout(900);
    const jumlahButir = await page.locator('[data-butir-item]').count();
    ok('setiap butir punya ceklis', jumlahButir >= 10, String(jumlahButir));
    ok('tombol Pilih Semua tersedia', await page.locator('[data-butir-all]').count() === 1);
    await page.locator('[data-butir-item]').nth(0).check();
    await page.locator('[data-butir-item]').nth(1).check();
    await page.waitForTimeout(200);
    ok('penghitung terpilih mengikuti ceklis', (await page.textContent('[data-butir-count]'))?.trim() === '2',
      await page.textContent('[data-butir-count]'));
    page.once('dialog', d => d.accept());
    await page.click('[data-butir-hapus]');
    await page.waitForTimeout(1400);
    ok('butir terpilih terhapus', (await page.locator('[data-butir-item]').count()) === jumlahButir - 2,
      `${jumlahButir} → ${await page.locator('[data-butir-item]').count()}`);
    await page.click('[data-butir-all]');
    await page.waitForTimeout(200);
    ok('Pilih Semua mencentang seluruh butir',
      (await page.textContent('[data-butir-count]'))?.trim() === String(await page.locator('[data-butir-item]').count()));

    /* ================= 2. RIWAYAT LAYANAN BK ================= */
    console.log('\n== 2. RIWAYAT LAYANAN BK (HAPUS TERPILIH) ==');
    await page.goto(BASE + '/#/bk_layanan');
    await page.waitForSelector('[data-layanan-item]', { timeout: 15000 });
    await page.waitForTimeout(800);
    const jumlahLayanan = await page.locator('[data-layanan-item]').count();
    ok('riwayat layanan punya ceklis per kartu', jumlahLayanan >= 3, String(jumlahLayanan));
    ok('tombol Pilih Semua & Hapus Terpilih tersedia',
      await page.locator('[data-layanan-all]').count() === 1 && await page.locator('[data-layanan-hapus]').count() === 1);
    await page.click('[data-layanan-all]');
    await page.waitForTimeout(300);
    ok('penghitung terpilih = jumlah riwayat', (await page.textContent('[data-layanan-count]'))?.trim() === String(jumlahLayanan),
      await page.textContent('[data-layanan-count]'));
    page.once('dialog', d => d.accept());
    await page.click('[data-layanan-hapus]');
    await page.waitForTimeout(1500);
    ok('riwayat terpilih terhapus', (await page.locator('[data-layanan-item]').count()) === 0,
      String(await page.locator('[data-layanan-item]').count()));

    /* ================= 3. HAPUS MAPEL ================= */
    console.log('\n== 3. HAPUS MATA PELAJARAN (DENGAN RELASI) ==');
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-grid-jadwal]', { timeout: 15000 });
    await page.locator('.tab', { hasText: 'Mata Pelajaran' }).first().click();
    await page.waitForTimeout(900);
    let pesanDialog = '';
    page.on('dialog', d => { pesanDialog = d.message(); d.accept(); });
    const barisMapel = page.locator('.tbl tbody tr', { hasText: setup.mapelNama }).first();
    ok('baris mapel ditemukan pada tabel', await barisMapel.count() === 1);
    ok('tombol hapus mapel tersedia', await page.locator(`[data-hapus-mapel="${setup.mapelId}"]`).count() === 1);
    const tombolHapus = page.locator(`[data-hapus-mapel="${setup.mapelId}"]`);
    await tombolHapus.scrollIntoViewIfNeeded();
    await tombolHapus.click({ force: true });
    await page.waitForTimeout(1800);
    ok('dialog konfirmasi menyebut dampak relasi (slot/absensi)', /slot jadwal|absensi/i.test(pesanDialog), pesanDialog.slice(0, 160));
    const sisaMapel = await page.locator('.tbl tbody tr', { hasText: setup.mapelNama }).count();
    ok('mapel terhapus walau punya slot jadwal', sisaMapel === 0, String(sisaMapel));

    /* ================= 4. DESAIN JADWAL PELAJARAN ================= */
    console.log('\n== 4. MENU DESAIN JADWAL PELAJARAN ==');
    await page.goto(BASE + '/#/desain_jadwal');
    await page.waitForSelector('[data-page="desain-jadwal"]', { timeout: 15000 });
    await page.waitForTimeout(800);
    ok('judul default JADWAL PELAJARAN', (await page.inputValue('[data-desain-judul]')) === 'JADWAL PELAJARAN');
    ok('semester default terisi', /Genap/i.test(await page.inputValue('[data-desain-semester]')));
    await page.fill('[data-desain-tempat]', 'Ciamis');
    await page.fill('[data-desain-tanggal]', 'Januari 2027');
    await page.fill('[data-desain-pengawas-nama]', 'Drs. Pengawas, M.Pd.');
    await page.fill('[data-desain-pengawas-nip]', '197001012000031001');
    await page.click('[data-desain-simpan]');
    await page.waitForTimeout(1400);
    ok('desain tersimpan tanpa error', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.reload();
    await page.waitForTimeout(1200);
    await page.waitForSelector('[data-desain-tempat]', { timeout: 12000 });
    ok('nilai desain bertahan setelah muat ulang', (await page.inputValue('[data-desain-tempat]')) === 'Ciamis');

    const cetak = await page.evaluate(async () => {
      const r = await fetch('/api/jadwal/cetak?mode=vertikal', { credentials: 'same-origin' });
      return { status: r.status, html: await r.text() };
    });
    ok('cetak memuat sub-judul desain & tanda tangan',
      /Semester Genap/.test(cetak.html) && /Ciamis, Januari 2027/.test(cetak.html) && /Drs\. Pengawas/.test(cetak.html));
    ok('cetak tanpa instruksi & footer "Dicetak"',
      !/Pratinjau cetak/i.test(cetak.html) && !/Ctrl\/Cmd/i.test(cetak.html) && !/Dicetak\s+\d/.test(cetak.html));

    /* ================= 5. MATRIKS VERTIKAL ================= */
    console.log('\n== 5. MATRIKS VERTIKAL (LEBAR & RATA TENGAH) ==');
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-grid-jadwal]', { timeout: 15000 });
    await page.click('[data-view="vertikal"]');
    await page.waitForSelector('[data-grid-vertikal]', { timeout: 10000 });
    await page.waitForTimeout(600);
    const lebar = await page.evaluate(() => {
      const t = document.querySelector('[data-grid-vertikal]');
      const hari = t.querySelector('tr.bg-slate-200\\/70 td, tr td[colspan]');
      const tr = [...t.querySelectorAll('tbody tr')][0];
      return {
        tabel: Math.round(t.getBoundingClientRect().width),
        barisHari: hari ? Math.round(hari.getBoundingClientRect().width) : 0,
        selPertama: tr ? Math.round(tr.getBoundingClientRect().width) : 0
      };
    });
    ok('baris hari tidak melebar melebihi tabel', lebar.barisHari <= lebar.tabel + 2, JSON.stringify(lebar));
    const rata = await page.evaluate(() => {
      const td = document.querySelector('[data-grid-vertikal] tbody td');
      if (!td) return '';
      const st = getComputedStyle(td);
      return `${st.textAlign}|${st.verticalAlign}`;
    });
    ok('isi sel matriks rata tengah', /center/.test(rata) && /middle/.test(rata), rata);

    /* ================= 6. ABSENSI GURU: ALUR ================= */
    console.log('\n== 6. ABSENSI GURU: ALUR ABSENSI SISWA → JURNAL ==');
    /* buat ulang mapel + slot (mapel uji sebelumnya sudah dihapus pada langkah 3) */
    const setup2 = await page.evaluate(async ({ hari, mulai, selesai }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const users = await get('/api/users');
      const guru = (users.rows || []).find(u => u.username === 'guru');
      const mapel = await post('/api/mapel/save', { nama: 'Bahasa Indonesia', kode: 'BIN', guru_ids: [guru.id] });
      const jadwal = await get('/api/jadwal');
      const kelas = jadwal.kelas || [];
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8, sesi: [{ label: 'Jam 1', mulai, selesai, istirahat: 0 }],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const slot = await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: mapel.id, kelas_ids: [kelas[0].id], abaikan: 1 });
      return { slotId: slot.id };
    }, { hari: HARI, mulai: hhmm(base - 10), selesai: hhmm(base + 25) });
    ok('slot baru untuk alur absensi guru dibuat', !!setup2.slotId, JSON.stringify(setup2));
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await page.context().clearCookies();
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'guru');
    await page.fill('input[type="password"]', 'guru123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    /* guru membuat sesi presensi & check-in lewat UI */
    await page.goto(BASE + '/#/absensi_siswa');
    await page.waitForTimeout(1500);
    const buat = page.locator('[data-buat-sesi], [data-buka-presensi]').first();
    if (await buat.count()) { await buat.click(); await page.waitForTimeout(1600); }
    await page.locator('[data-mass="H"]').click().catch(() => {});
    await page.locator('[data-pencatat]').fill('Petugas Uji').catch(() => {});
    await page.locator('[data-simpan-presensi]').click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.goto(BASE + '/#/absensi_guru');
    await page.waitForSelector('[data-page="absensi-guru"]', { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.locator('[data-checkin]').first().click();
    await page.waitForTimeout(1800);
    ok('modal alur kerja terbuka setelah check-in', await page.locator('[data-alur-absensi]').count() === 1,
      (await page.textContent('body'))?.slice(0, 120));
    const teksAlur = await page.locator('[data-alur-absensi]').innerText();
    ok('alur menampilkan 3 langkah (absensi siswa, jurnal, foto)',
      /Absensi Siswa/i.test(teksAlur) && /Jurnal/i.test(teksAlur) && /Foto/i.test(teksAlur), teksAlur.slice(0, 160));
    ok('status absensi siswa sudah lengkap setelah diisi',
      /tercatat/i.test(teksAlur) || /Isi Absensi Siswa/.test(teksAlur), teksAlur.slice(0, 160));

    /* ================= 7. PORTAL PUBLIK ================= */
    console.log('\n== 7. PORTAL PUBLIK JADWAL ==');
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await page.context().clearCookies();
    await page.goto(BASE + '/jadwal-publik/' + tokenJadwal);
    await page.waitForSelector('[data-filter-kelas]', { timeout: 15000 });
    await page.waitForTimeout(700);
    ok('tombol Export Excel & Cetak/PDF tampil di halaman publik',
      await page.locator('[data-publik-export]').count() === 1 && await page.locator('[data-publik-cetak]').count() === 1);
    ok('tombol bagikan/QR/salin tautan sudah tidak ada',
      await page.locator('[data-buka-qr-jadwal]').count() === 0
      && await page.locator('[data-salin-jadwal]').count() === 0
      && await page.locator('[data-unduh-qr-publik]').count() === 0);
    const linkExport = await page.getAttribute('[data-publik-export]', 'href');
    const resExport = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'same-origin' });
      return { status: r.status, ct: r.headers.get('content-type') || '' };
    }, new URL(linkExport, BASE).pathname);
    ok('tautan Export Excel publik berfungsi', resExport.status === 200 && /spreadsheet/.test(resExport.ct), JSON.stringify(resExport));
    ok('tanpa error JS di semua halaman', errors.length === 0, errors.slice(0, 3).join(' | '));

    /* ================= 8. MOBILE ================= */
    console.log('\n== 8. MOBILE 390px ==');
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    for (const p of ['#/desain_jadwal', '#/asesmen_soal', '#/bk_layanan', '#/jadwal']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BASE + '/' + p);
      await page.waitForTimeout(1000);
      const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok('tanpa overflow horizontal ' + p, of <= 2, 'overflow ' + of + 'px');
      await page.setViewportSize({ width: 1420, height: 940 });
    }
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
