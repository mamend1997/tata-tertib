'use strict';
/* Uji UI ronde 25 (Playwright, tata-tertib):
   A. Akun guru — daftar jadwal mengajar (hari ini + hari berikutnya),
      tombol terkunci + hitung mundur, tombol check-in hanya saat sesi aktif
   B. Rekap Absensi Siswa — tab "Hapus Riwayat": ceklis + Pilih Semua +
      hapus terpilih (modal PIN) & form hapus per tanggal/kelas
   C. Rekap Absensi Guru — tab "Hapus Riwayat" (ceklis + rentang tanggal)
   D. Rekap Bulanan Kelas — filter, tab kehadiran/asesmen/kejadian, tombol ekspor
   E. Guru Piket & Pengganti — tabel slot, penunjukan, pilih semua & hapus riwayat
   F. Pengaturan → WhatsApp Gateway: pilihan Fonnte + template alfa/izin
   G. Mobile 390px tanpa overflow & tanpa error JS
   Jalankan: node dev-tests/ui-round25.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uir25-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uir25-saas-' + Date.now() + '.sqlite');
const PORT = 5400 + Math.floor(Math.random() * 120);
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

  async function login(username, password, viewport) {
    if (viewport) {
      try { await page.close(); } catch (e) { /* abaikan */ }
      page = await browser.newPage({ viewport });
      page.on('pageerror', e => errors.push(e.message));
    }
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
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape').catch(() => { });
    await page.waitForTimeout(200);
  }

  const pad = n => String(n).padStart(2, '0');
  const wib = new Date();
  const TODAY = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
  const HARI = wib.getDay();
  const cur = wib.getHours() * 60 + wib.getMinutes();
  const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
  const base = Math.max(120, Math.min(cur, 1440 - 220));

  try {
    await login('admin', 'admin123');

    /* ---------------- setup data ---------------- */
    const setup = await page.evaluate(async ({ hari, sesi }) => {
      const post = async (u, b) => (await fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (u) => (await fetch(u, { credentials: 'same-origin' })).json();
      const gA = (await post('/api/users/save', { nama: 'Guru Jadwal A', username: 'gurua', password: 'guru123', role: 'guru_umum', roles: ['guru'] })).id;
      const gB = (await post('/api/users/save', { nama: 'Guru Pengganti B', username: 'gurub', password: 'guru123', role: 'guru_umum', roles: ['guru'] })).id;
      await post('/api/jadwal/pengaturan', {
        hari: [hari, (hari + 1) % 7], max_jam: 8, sesi,
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 15, toleransi_tutup: 0, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, auto_alpha: 0 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const siswa = (await get('/api/siswa?limit=12')).rows || [];
      const kelas = siswa[0].kelas_id;
      const kelasLain = ((await get('/api/jadwal')).kelas || []).find(k => Number(k.id) !== Number(kelas));
      const m = (await post('/api/mapel/save', { nama: 'Informatika', kode: 'INF', guru_ids: [gA] })).id;
      const m2 = (await post('/api/mapel/save', { nama: 'Matematika', kode: 'MTK', guru_ids: [gB] })).id;
      const slotLalu = (await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: m, guru_id: gA, kelas_ids: [kelas], abaikan: 1 })).id;
      const slotKini = (await post('/api/jadwal/slot', { hari, sesi: 2, mapel_id: m, guru_id: gA, kelas_ids: [kelas], abaikan: 1 })).id;
      const slotNanti = (await post('/api/jadwal/slot', { hari, sesi: 3, mapel_id: m2, guru_id: gB, kelas_ids: [kelas], abaikan: 1 })).id;
      const slotLewat = (await post('/api/jadwal/slot', {
        hari, sesi: 1, mapel_id: m2, guru_id: gB, kelas_ids: [Number(kelasLain?.id) || Number(kelas)], abaikan: 1
      })).id;
      const slotBesok = (await post('/api/jadwal/slot', { hari: (hari + 1) % 7, sesi: 2, mapel_id: m, guru_id: gA, kelas_ids: [kelas], abaikan: 1 })).id;
      /* presensi untuk diuji hapus */
      const sesiRow = await post('/api/absensi-siswa/sesi', { jadwal_id: slotKini, tanggal: '' });
      const s1 = siswa[0];
      if (sesiRow.sesi) {
        await post('/api/absensi-siswa/simpan', { sesi_id: sesiRow.sesi.id, items: [{ siswa_id: s1.id, status: 'A' }] });
      }
      return { gA, gB, kelas, slotLalu, slotKini, slotNanti, slotLewat, slotBesok, siswa: s1.nama };
    }, {
      hari: HARI,
      sesi: [
        { label: 'Jam ke-1', mulai: hhmm(base - 60), selesai: hhmm(base - 30), istirahat: 0 },
        { label: 'Jam ke-2', mulai: hhmm(base - 10), selesai: hhmm(base + 10), istirahat: 0 },
        { label: 'Jam ke-3', mulai: hhmm(base + 11), selesai: hhmm(base + 45), istirahat: 0 },
        { label: 'Jam ke-4', mulai: hhmm(base + 90), selesai: hhmm(base + 120), istirahat: 0 }
      ]
    });
    ok('data uji siap (4 slot + presensi)', !!setup.slotKini && !!setup.slotBesok);

    /* ---------------- A. JADWAL MENGAJAR GURU ---------------- */
    console.log('\n== A. DAFTAR JADWAL MENGAJAR (AKUN GURU) ==');
    await login('gurua', 'guru123', { width: 1400, height: 950 });
    await page.goto(BASE + '/#/absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-agenda-jadwal]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('daftar jadwal mengajar tampil', await page.locator('[data-agenda-jadwal]').count() === 1);
    const agendaSlot = await page.locator('[data-agenda-slot]').count();
    ok('rentang sesi berurutan tampil sebagai satu kartu, ditambah jadwal besok', agendaSlot === 2, String(agendaSlot));
    ok('check-in rentang tersedia satu kali pada kartu gabungan',
      await page.locator(`[data-agenda-checkin="${setup.slotLalu}"]`).count() === 1 &&
      await page.locator(`[data-agenda-checkin="${setup.slotKini}"]`).count() === 0);
    ok('dua slot berurutan tidak dirender sebagai check-in terpisah',
      await page.locator(`[data-agenda-slot="${setup.slotLalu}"]`).count() === 1 &&
      await page.locator(`[data-agenda-slot="${setup.slotKini}"]`).count() === 0);
    const teksBesok = await page.locator(`[data-agenda-slot="${setup.slotBesok}"]`).innerText().catch(() => '');
    if (teksBesok) {
      ok('jadwal hari esok tampil & terkunci', /Nonaktif|Hari-H/i.test(teksBesok), teksBesok.replace(/\n/g, ' | '));
    } else {
      ok('jadwal hari esok tampil & terkunci', false, 'slot hari esok tidak dirender');
    }
    ok('hitung mundur tampil untuk sesi yang belum dibuka',
      /dibuka dalam|berakhir dalam/i.test(await page.locator('[data-agenda-jadwal]').innerText()),
      (await page.locator('[data-agenda-jadwal]').innerText()).slice(0, 200).replace(/\n/g, ' | '));

    /* check-in sesi berlangsung (agar ada baris absensi guru untuk diuji hapus) */
    const chk = await page.evaluate(async ({ jadwal, tgl }) => {
      const r = await fetch('/api/absensi-guru/checkin', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jadwal_id: jadwal, tanggal: tgl, status: 'hadir' })
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { jadwal: setup.slotKini, tgl: TODAY });
    ok('check-in sesi berlangsung tersimpan (data uji hapus)', chk.status === 200, JSON.stringify(chk.body).slice(0, 120));
    const rentangTersimpan = await page.evaluate(async ({ tgl, awal, akhir }) => {
      const r = await (await fetch(`/api/absensi-guru?tanggal=${tgl}`)).json();
      const rows = r.jadwal || [];
      return [awal, akhir].every(id => rows.some(j => Number(j.id) === Number(id) && j.absensi?.status === 'hadir'));
    }, { tgl: TODAY, awal: setup.slotLalu, akhir: setup.slotKini });
    ok('satu check-in mengisi semua slot dalam rentang', rentangTersimpan);

    /* ---------------- B. HAPUS RIWAYAT ABSENSI SISWA ---------------- */
    console.log('\n== B. HAPUS RIWAYAT ABSENSI SISWA ==');
    await login('admin', 'admin123');
    await page.goto(BASE + '/#/rekap_absensi_siswa', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page="rekap-absensi-siswa"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.click('[data-tab="hapus"]');
    await page.waitForSelector('[data-hapus-riwayat-siswa]', { timeout: 20000 });
    await page.waitForTimeout(800);
    ok('tab Hapus Riwayat (siswa) tampil', await page.locator('[data-tbl="hapus-siswa"]').count() === 1);
    ok('kolom ceklis + Pilih Semua tersedia', await page.locator('[data-pilih-semua]').count() === 1
      && await page.locator('[data-pilih]').count() >= 1);
    ok('form hapus per tanggal & kelas tersedia', await page.locator('[data-hapus-dari]').count() === 1
      && await page.locator('[data-hapus-kelas]').count() === 1 && await page.locator('[data-hapus-filter]').count() === 1);
    await page.locator('[data-pilih-semua]').check();
    await page.waitForTimeout(200);
    const terpilih = await page.locator('[data-pilih]:checked').count();
    ok('Pilih Semua mencentang seluruh baris', terpilih >= 1, String(terpilih));
    await page.click('[data-hapus-terpilih]');
    await page.waitForSelector('[data-modal-hapus]', { timeout: 15000 });
    ok('dialog konfirmasi hapus muncul (wajib PIN)', await page.locator('[data-pin-hapus]').count() === 1
      && await page.locator('[data-cek-hapus]').count() === 1);
    ok('tombol konfirmasi terkunci sebelum PIN & ceklis',
      await page.locator('[data-konfirmasi-hapus]').isDisabled());
    await page.fill('[data-pin-hapus]', 'salah');
    await page.locator('[data-cek-hapus]').check();
    await page.click('[data-konfirmasi-hapus]');
    await page.waitForTimeout(900);
    ok('PIN salah ditolak (pesan error tampil)', await page.locator('[data-err-hapus]').count() === 1);
    await page.fill('[data-pin-hapus]', 'admin123');
    await page.click('[data-konfirmasi-hapus]');
    await page.waitForTimeout(1600);
    ok('hapus terpilih berhasil (modal tertutup)', await page.locator('[data-modal-hapus]').count() === 0);

    /* ---------------- C. HAPUS RIWAYAT ABSENSI GURU ---------------- */
    console.log('\n== C. HAPUS RIWAYAT ABSENSI GURU ==');
    await page.goto(BASE + '/#/rekap_absensi_guru', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page="rekap-absensi-guru"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.click('[data-tab-hapus-guru]');
    await page.waitForSelector('[data-hapus-riwayat-guru]', { timeout: 20000 });
    await page.waitForTimeout(600);
    ok('tab Hapus Riwayat (guru) tampil', await page.locator('[data-tbl="hapus-guru"]').count() === 1);
    ok('ceklis & Pilih Semua pada rekap guru', await page.locator('[data-pilih-semua-guru]').count() === 1);
    ok('form hapus berdasarkan rentang tanggal', await page.locator('[data-hapus-guru-dari]').count() === 1
      && await page.locator('[data-hapus-guru-filter]').count() === 1);
    await page.locator('[data-pilih-semua-guru]').check();
    await page.waitForTimeout(200);
    ok('baris absensi guru dapat dipilih', await page.locator('[data-pilih-guru]:checked').count() >= 1,
      String(await page.locator('[data-pilih-guru]:checked').count()));
    await page.click('[data-hapus-guru-terpilih]');
    await page.waitForSelector('[data-modal-hapus]', { timeout: 15000 });
    await page.fill('[data-pin-hapus]', 'admin123');
    await page.locator('[data-cek-hapus]').check();
    await page.click('[data-konfirmasi-hapus]');
    await page.waitForTimeout(1600);
    ok('hapus absensi guru terpilih berhasil', await page.locator('[data-modal-hapus]').count() === 0);

    /* ---------------- D. REKAP BULANAN ---------------- */
    console.log('\n== D. REKAP BULANAN KELAS ==');
    await page.goto(BASE + '/#/rekap_bulanan', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page="rekap-bulanan"]', { timeout: 20000 });
    await page.waitForTimeout(1200);
    ok('halaman rekap bulanan terbuka', await page.locator('[data-filter-bulan]').count() === 1);
    ok('tabel kehadiran & poin tampil', await page.locator('[data-tbl="bulanan-kehadiran"]').count() === 1);
    await page.click('[data-tab-bulanan="asesmen"]');
    await page.waitForTimeout(400);
    ok('tab ringkasan asesmen menampilkan kartu instrumen', await page.locator('[data-asesmen]').count() >= 1);
    await page.click('[data-tab-bulanan="kejadian"]');
    await page.waitForTimeout(400);
    ok('tab catatan kejadian tersedia', await page.locator('[data-tab-bulanan="kejadian"]').count() === 1);
    ok('tombol ekspor PDF/Excel/Word tersedia',
      await page.locator('[data-cetak-bulanan]').count() === 1
      && await page.locator('[data-export-bulanan]').count() === 1
      && await page.locator('[data-word-bulanan]').count() === 1);

    /* ---------------- E. GURU PIKET & PENGGANTI ---------------- */
    console.log('\n== E. GURU PIKET & PENGGANTI ==');
    /* buat guru B izin pada sesi 3 agar muncul sebagai guru tidak hadir */
    await page.evaluate(async ({ jadwal, tgl }) => {
      await fetch('/api/absensi-guru/checkin', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jadwal_id: jadwal, tanggal: tgl, status: 'izin', catatan: 'tugas dinas luar' })
      });
    }, { jadwal: setup.slotNanti, tgl: TODAY });
    await page.goto(BASE + '/#/guru_pengganti', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page="guru-pengganti"]', { timeout: 20000 });
    await page.waitForTimeout(1000);
    ok('halaman guru piket & pengganti terbuka', await page.locator('[data-tbl="guru-pengganti"]').count() === 1);
    ok('daftar guru tidak hadir tampil', await page.locator('[data-tidak-hadir]').count() >= 1);
    ok('slot terlewat ditandai oleh server',
      await page.locator(`[data-slot-pengganti="${setup.slotLewat}"]`).getAttribute('data-slot-pengganti-lewat') === '1');
    ok('tombol Tunjuk/Ganti pada slot terlewat dinonaktifkan',
      await page.locator(`[data-tunjuk="${setup.slotLewat}"]`).isDisabled());
    await page.click(`[data-tunjuk="${setup.slotNanti}"]`);
    await page.waitForSelector('[data-modal-pengganti]', { timeout: 15000 });
    ok('modal penunjukan + daftar kandidat tampil', await page.locator('[data-kandidat]').count() >= 1);
    const kandidatAktif = page.locator('[data-kandidat]:not([disabled])').first();
    const idKandidat = await kandidatAktif.getAttribute('data-kandidat');
    await kandidatAktif.click();
    await page.fill('[data-alasan-pengganti]', 'menggantikan guru tugas dinas');
    await page.click('[data-simpan-pengganti]');
    await page.waitForTimeout(1600);
    ok('penunjukan tersimpan (modal tertutup)', await page.locator('[data-modal-pengganti]').count() === 0);
    ok('tombol Batal muncul untuk penugasan', await page.locator('[data-batal]').count() >= 1);
    ok('kolom guru efektif berubah menjadi pengganti',
      /Pengganti/i.test(await page.locator('[data-tbl="guru-pengganti"]').innerText()));
    ok('penugasan menampilkan aksi absensi siswa dan jurnal di menu pengganti',
      await page.locator('[data-absensi-pengganti]').count() >= 1
        && await page.locator('[data-jurnal-pengganti]').count() >= 1);
    ok('kontrol Pilih Semua tersedia pada riwayat', await page.locator('[data-riwayat-all]').count() === 1);
    ok('riwayat aktif tidak dapat dipilih untuk dihapus',
      await page.locator('[data-riwayat-item]').count() >= 1
        && await page.locator('[data-riwayat-item]').first().isDisabled()
        && await page.locator('[data-riwayat-hapus]').isDisabled());
    await page.locator('[data-riwayat-detail-btn]').first().click();
    await page.waitForSelector('[data-riwayat-detail]', { timeout: 15000 });
    ok('tombol Detail membuka modal riwayat pengganti',
      await page.locator('[data-modal-title="Detail Riwayat Guru Pengganti"]').count() === 1);
    ok('modal riwayat menyediakan detail absensi siswa dan jurnal',
      await page.locator('[data-detail-absensi-siswa]').count() >= 1
        && await page.locator('[data-detail-jurnal]').count() >= 1);
    await page.locator('[data-modal-title="Detail Riwayat Guru Pengganti"] button[aria-label="Tutup"]').click();
    page.on('dialog', dialog => dialog.accept());
    await page.locator('[data-batal]').first().click();
    await page.waitForTimeout(1200);
    ok('penugasan yang dibatalkan menjadi dapat dipilih',
      await page.locator('[data-riwayat-item]:not([disabled])').count() >= 1);
    await page.locator('[data-riwayat-all]').check();
    ok('Pilih Semua memilih semua riwayat terminal',
      await page.locator('[data-riwayat-count]').innerText().then(x => x.trim()) === '1 dipilih');
    await page.locator('[data-riwayat-hapus]').click();
    await page.waitForTimeout(1200);
    ok('Hapus Terpilih menghapus riwayat yang dibatalkan',
      await page.locator('[data-riwayat-pengganti]').count() === 0);

    /* ---------------- F. PENGATURAN WHATSAPP ---------------- */
    console.log('\n== F. PENGATURAN WHATSAPP (FONNTE) ==');
    await page.goto(BASE + '/#/pengaturan', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    /* buka tab WhatsApp Gateway */
    const tabWa = page.locator('button.tab', { hasText: 'WhatsApp' }).first();
    if (await tabWa.count()) { await tabWa.click(); }
    await page.waitForSelector('[data-wa-provider]', { timeout: 20000 });
    ok('pilihan penyedia Fonnte tersedia', await page.locator('[data-wa-provider]').count() === 1);
    ok('sakelar notifikasi Alfa/Bolos tersedia', await page.locator('[data-wa-alfa-aktif]').count() === 1);
    ok('sakelar notifikasi guru Sakit/Izin tersedia', await page.locator('[data-wa-izin-aktif]').count() === 1);
    ok('editor template alfa & izin tersedia',
      await page.locator('[data-wa-template-alfa]').count() === 1
      && await page.locator('[data-wa-template-izin]').count() === 1);

    /* ---------------- G. MOBILE ---------------- */
    console.log('\n== G. MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [hash, nama] of [['#/absensi_guru', 'absensi guru'], ['#/guru_pengganti', 'guru pengganti'], ['#/rekap_bulanan', 'rekap bulanan']]) {
      await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1400);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`tanpa overflow horizontal — ${nama}`, ov <= 2, String(ov));
    }
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
