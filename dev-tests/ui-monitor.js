process.env.TZ = 'Asia/Jakarta';
'use strict';
/* Uji UI (Playwright) — ronde 28:
   1. Matriks jadwal: kolom per hari dengan sesi sendiri (sesi khusus per hari),
      label sesi + rentang jam di atas kartu, tinggi kartu proporsional durasi
   2. Tombol Duplikat pada kartu slot (per kelas & per guru) + modal penempatan
   3. Dashboard Monitoring KBM (kartu kelas aktif, status guru, % jurnal,
      tabel guru berhalangan, rekap per kelas, auto-refresh)
   4. Kalender akademik: tombol Cetak/Excel/Word, panel Semester & Warna,
      warna kategori dipakai pada grid, keterangan rentang kegiatan
   5. Mobile 390px tanpa overflow & tanpa error JS
   Jalankan: node dev-tests/ui-monitor.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-uimon-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-uimon-saas-' + Date.now() + '.sqlite');
const PORT = 5400 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
/* helper API sisi Node (cookie terpisah) — untuk menyiapkan data sebagai guru */
let apiCookie = '';
let KODE = '';
async function apiReq(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(apiCookie ? { Cookie: apiCookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) apiCookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json().catch(() => null) : await r.text() };
}
async function apiLogin(u, pw) {
  apiCookie = '';
  return apiReq('/api/login', { method: 'POST', body: { username: u, password: pw, kode: KODE } });
}

const pad = n => String(n).padStart(2, '0');
const wib = new Date();
const TODAY = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
const besok = new Date(wib);
besok.setDate(besok.getDate() + 1);
const BESOK = `${besok.getFullYear()}-${pad(besok.getMonth() + 1)}-${pad(besok.getDate())}`;
const HARI = wib.getDay();
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
const cur = wib.getHours() * 60 + wib.getMinutes();
const S1 = Math.max(1, Math.min(cur - 10, 1400));

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2500));
  KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

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
    await page.waitForTimeout(800);

    /* ---------- data uji: 2 hari aktif, hari ini 3 sesi, Jumat sesi khusus ---------- */
    const sesiUmum = [
      { label: 'Pembiasaan', mulai: hhmm(S1), selesai: hhmm(S1 + 15), istirahat: 0 },
      { label: 'Jam ke-2', mulai: hhmm(S1 + 16), selesai: hhmm(S1 + 61), istirahat: 0 },
      { label: 'Istirahat', mulai: hhmm(S1 + 62), selesai: hhmm(S1 + 77), istirahat: 1 },
      { label: 'Jam ke-3', mulai: hhmm(S1 + 78), selesai: hhmm(S1 + 123), istirahat: 0 }
    ];
    const sesiKhusus = [
      { label: 'Upacara', mulai: hhmm(S1), selesai: hhmm(S1 + 30), istirahat: 0 },
      { label: 'Jam ke-1', mulai: hhmm(S1 + 31), selesai: hhmm(S1 + 76), istirahat: 0 }
    ];
    const setup = await page.evaluate(async ({ today, sesi, sesiKhusus, hari, hariLain }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const cfgRes = await post('/api/jadwal/pengaturan', {
        hari: [hari, hariLain], max_jam: 8, sesi, max_mapel_jam: 3, max_guru_jam: 8,
        /* sesi KHUSUS untuk hari lain: hanya 2 sesi (lebih pendek) */
        sesi_hari: { [String(hariLain)]: sesiKhusus },
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180, auto_alpha: 1 },
        target_jam: { aktif: 1, minggu: 3 }
      });
      const cek = await get('/api/jadwal');
      if (cfgRes.status >= 400 || (cek.config.hari || []).length !== 2) {
        return { error: 'pengaturan gagal', status: cfgRes.status, err: cfgRes.error, hari: cek.config.hari };
      }
      const users = (await get('/api/users')).rows || [];
      const gA = users.find(u => u.username === 'guru');
      const gB = users.find(u => u.username === 'guruumum');
      const kelas = (await get('/api/jadwal')).kelas || [];
      const m1 = (await post('/api/mapel/save', { nama: 'Matematika UI', kode: 'MTKUI', guru_ids: [gA.id] })).id;
      const m2 = (await post('/api/mapel/save', { nama: 'Bahasa UI', kode: 'BINUI', guru_ids: [gB.id] })).id;
      const s1id = (await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: m1, guru_id: gA.id, kelas_ids: [kelas[0].id], abaikan: 1 })).id;
      const s2id = (await post('/api/jadwal/slot', { hari, sesi: 2, mapel_id: m2, guru_id: gB.id, kelas_ids: [kelas[0].id], abaikan: 1 })).id;
      const s3id = (await post('/api/jadwal/slot', { hari: hariLain, sesi: 1, mapel_id: m1, guru_id: gA.id, kelas_ids: [kelas[1].id], abaikan: 1 })).id;
      return { hari, hariLain, kelasId: kelas[0].id, guruA: gA.id, guruB: gB.id, m1, m2, s1id, s2id, s3id };
    }, { today: TODAY, sesi: sesiUmum, sesiKhusus, hari: HARI, hariLain: (HARI + 1) % 7 });
    ok('data uji siap (2 hari aktif + sesi khusus)', !!setup.s1id && !!setup.s2id && !!setup.s3id, JSON.stringify(setup).slice(0, 300));

    /* ================= 1. MATRIKS DINAMIS PER HARI ================= */
    console.log('\n== 1. MATRIKS JADWAL: SESI PER HARI & LABEL WAKTU ==');
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-grid-jadwal]', { timeout: 20000 });
    await page.waitForTimeout(900);
    ok('grid matriks tampil (kolom per hari)', (await page.locator('[data-grid-jadwal]').count()) === 1);
    ok('kolom hari dirender per hari aktif', (await page.locator('[data-hari]').count()) === 2,
      String(await page.locator('[data-hari]').count()));
    const kolomKhusus = await page.locator(`[data-hari="${setup.hariLain}"]`).getAttribute('data-hari-khusus');
    ok('hari dengan sesi khusus ditandai', kolomKhusus === '1', String(kolomKhusus));
    /* jumlah sel sesi per hari mengikuti sesi hari itu (hari khusus hanya 2 sesi) */
    const selHariIni = await page.locator(`[data-hari="${setup.hari}"] [data-sesi-cell]`).count();
    const selHariLain = await page.locator(`[data-hari="${setup.hariLain}"] [data-sesi-cell]`).count();
    ok('hari normal merender 3 sesi pelajaran', selHariIni === 3, String(selHariIni));
    ok('hari khusus merender 2 sesi (tidak ikut baris seragam)', selHariLain === 2, String(selHariLain));
    ok('istirahat dirender ringkas (bukan kartu pelajaran)',
      (await page.locator('[data-sesi-istirahat]').count()) >= 1);
    const labelUpacara = await page.locator(`[data-hari="${setup.hariLain}"]`).innerText();
    ok('label sesi khusus ("Upacara") tampil pada matriks', /upacara/i.test(labelUpacara), labelUpacara.slice(0, 120));

    /* label sesi + rentang waktu di atas kartu */
    const kartu1 = page.locator(`[data-slot="${setup.s1id}"]`);
    const teksKartu = await kartu1.innerText();
    ok('kartu slot memuat label sesi & rentang jam',
      /Pembiasaan/i.test(teksKartu) && /\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/.test(teksKartu), teksKartu.slice(0, 120));
    ok('kartu slot tetap memuat mapel & guru', /MTKUI/.test(teksKartu) && /Hendra/i.test(teksKartu), teksKartu.slice(0, 160));
    const urutan = await page.locator(`[data-slot="${setup.s1id}"]`).evaluate(el => {
      const lab = el.querySelector('[data-slot-label]');
      const mapel = el.querySelector('[data-slot-mapel]');
      return lab && mapel ? (lab.compareDocumentPosition(mapel) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false;
    });
    ok('label sesi berada DI ATAS nama mapel', urutan === true);

    /* tinggi kartu proporsional durasi */
    const tinggi = await page.evaluate(({ s1id, s2id }) => {
      const h = (id) => {
        const el = document.querySelector(`[data-slot="${id}"]`);
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      };
      const istirahat = document.querySelector('[data-sesi-istirahat]');
      return { pembiasaan: h(s1id), normal: h(s2id), istirahat: istirahat ? Math.round(istirahat.getBoundingClientRect().height) : 0 };
    }, setup);
    ok('kartu sesi pendek (15 menit) lebih rendah dari sesi normal (45 menit)',
      tinggi.pembiasaan > 0 && tinggi.normal > 0 && tinggi.pembiasaan < tinggi.normal,
      JSON.stringify(tinggi));
    ok('baris istirahat paling ringkas', tinggi.istirahat > 0 && tinggi.istirahat < tinggi.pembiasaan,
      JSON.stringify(tinggi));

    /* ================= 2. DUPLIKAT SLOT ================= */
    console.log('\n== 2. DUPLIKAT SLOT JADWAL ==');
    ok('tombol duplikat tersedia pada kartu slot',
      (await page.locator(`[data-slot="${setup.s1id}"] [data-slot-aksi="duplikat"]`).count()) === 1);
    ok('tombol edit & hapus tetap ada',
      (await page.locator(`[data-slot="${setup.s1id}"] [data-slot-aksi="edit"]`).count()) === 1
      && (await page.locator(`[data-slot="${setup.s1id}"] [data-slot-aksi="hapus"]`).count()) === 1);
    /* buka modal duplikat pada slot sesi 2 → default sesi berikutnya (sesi 4 = Jam ke-3) */
    await page.click(`[data-slot="${setup.s2id}"] [data-slot-aksi="duplikat"]`);
    await page.waitForSelector('[data-duplikat-hari]', { timeout: 10000 });
    ok('modal duplikat terbuka dengan opsi hari & sesi',
      (await page.locator('[data-duplikat-hari]').count()) === 1 && (await page.locator('[data-duplikat-sesi]').count()) === 1);
    const sesiDefault = await page.inputValue('[data-duplikat-sesi]');
    ok('sesi tujuan default = sesi berikutnya (bukan istirahat)', sesiDefault === '4', sesiDefault);
    await page.click('[data-duplikat-simpan]');
    await page.waitForTimeout(1600);
    const setelahDup = await page.evaluate(async () => (await (await fetch('/api/jadwal', { credentials: 'same-origin' })).json()).rows.length);
    ok('slot terduplikasi bertambah di database', setelahDup >= 3, String(setelahDup));
    const slotDup = await page.locator('[data-slot]').count();
    ok('kartu hasil duplikat tampil pada matriks', slotDup >= 3, String(slotDup));

    /* duplikat lintas hari lewat modal (hari khusus) */
    await page.click(`[data-slot="${setup.s1id}"] [data-slot-aksi="duplikat"]`);
    await page.waitForSelector('[data-duplikat-hari]', { timeout: 10000 });
    await page.selectOption('[data-duplikat-hari]', String(setup.hariLain));
    await page.waitForTimeout(300);
    const opsiSesiHariLain = await page.locator('[data-duplikat-sesi] option').count();
    ok('pilihan sesi mengikuti sesi hari tujuan (hari khusus = 2 sesi)', opsiSesiHariLain === 3,
      String(opsiSesiHariLain));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    /* duplikat juga tersedia pada tampilan per guru */
    await page.click('[data-view="guru"]');
    await page.waitForTimeout(800);
    if (await page.locator('[data-pilih-guru]').count()) {
      await page.selectOption('[data-pilih-guru]', String(setup.guruA));
      await page.waitForTimeout(700);
    }
    ok('tampilan per guru tetap menampilkan grid jadwal', (await page.locator('[data-grid-jadwal]').count()) === 1);
    ok('tombol duplikat tersedia pada kartu di tampilan per guru',
      (await page.locator('[data-slot-aksi="duplikat"]').count()) >= 1,
      String(await page.locator('[data-slot-aksi="duplikat"]').count()));
    await page.click('[data-view="kelas"]');
    await page.waitForTimeout(600);

    /* ================= 3. MONITORING KBM ================= */
    console.log('\n== 3. DASHBOARD MONITORING KBM ==');
    await page.goto(BASE + '/#/monitor_kbm');
    await page.waitForSelector('[data-page="monitor-kbm"]', { timeout: 20000 });
    await page.waitForTimeout(1100);
    ok('halaman monitoring terbuka', (await page.locator('[data-page="monitor-kbm"]').count()) === 1);
    ok('kartu KPI jurnal mengajar tampil', (await page.locator('[data-jurnal-persen]').count()) === 1);
    ok('bar progres jurnal tampil', (await page.locator('[data-jurnal-bar]').count()) === 1);
    const persenAwal = (await page.textContent('[data-jurnal-persen]')) || '';
    ok('persentase jurnal terisi angka', /\d+%/.test(persenAwal), persenAwal);
    const urutanMatriks = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('section.card')];
      const jurnal = cards.find(el => el.textContent.includes('Kelengkapan Jurnal Mengajar Hari Ini'));
      const matriks = cards.find(el => el.textContent.includes('Matriks Jadwal Mengajar'));
      return !!jurnal && !!matriks && (jurnal.compareDocumentPosition(matriks) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    ok('matriks jadwal hari ini tampil tepat setelah ringkasan jurnal',
      urutanMatriks && (await page.locator('[data-tbl="monitor-jadwal"]').count()) === 1
      && await page.locator('[data-monitor-jadwal]').count() >= 3
      && await page.locator('[data-monitor-grid-mode]').inputValue() === 'semua');
    ok('status real-time tampil pada sel matriks',
      (await page.locator('[data-monitor-grid-status]').count()) >= 1);
    const matriksBesokResponse = page.waitForResponse(response =>
      response.url().includes('/api/monitor-kbm')
      && decodeURIComponent(response.url()).includes(`tanggal_matriks=${BESOK}`));
    await page.fill('[data-monitor-grid-tanggal]', BESOK);
    const matriksBesok = await (await matriksBesokResponse).json();
    ok('filter matriks memuat jadwal hari berikutnya terpisah dari ringkasan',
      matriksBesok.tanggal === TODAY && matriksBesok.tanggal_matriks === BESOK
      && !!matriksBesok.hari_matriks_label,
      JSON.stringify({ tanggal: matriksBesok.tanggal, tanggal_matriks: matriksBesok.tanggal_matriks }));
    ok('tombol nonaktif tersedia untuk slot mapel yang belum dimulai',
      await page.locator(`[data-monitor-nonaktif="${setup.s3id}"]`).count() === 1);
    await page.locator(`[data-monitor-nonaktif="${setup.s3id}"]`).click();
    await page.waitForSelector('[data-monitor-nonaktif-alasan-input]', { timeout: 10000 });
    ok('alasan wajib diisi sebelum penonaktifan disimpan',
      await page.locator('[data-monitor-nonaktif-simpan]').isDisabled());
    await page.fill('[data-monitor-nonaktif-alasan-input]', 'Sosialisasi program sekolah');
    await page.locator('[data-monitor-nonaktif-simpan]').click();
    await page.waitForFunction(id => {
      const row = document.querySelector(`[data-monitor-grid-status="${id}"]`);
      return row && row.textContent.includes('KBM tidak berlaku');
    }, setup.s3id, { timeout: 15000 });
    ok('alasan tersimpan dan matriks menandai KBM tidak berlaku',
      await page.locator(`[data-monitor-nonaktif-alasan="${setup.s3id}"]`).innerText()
        === 'Alasan: Sosialisasi program sekolah');
    ok('slot nonaktif tidak menyediakan tombol pratinjau',
      await page.locator(`[data-monitor-preview="${setup.s3id}"]`).count() === 0);
    await page.fill('[data-monitor-grid-tanggal]', TODAY);
    await page.selectOption('[data-monitor-grid-mode]', 'kelas');
    ok('filter matriks per kelas tersedia', (await page.locator('[data-monitor-grid-kelas]').count()) === 1);
    await page.selectOption('[data-monitor-grid-mode]', 'guru');
    ok('filter matriks per guru tersedia', (await page.locator('[data-monitor-grid-guru]').count()) === 1);
    await page.selectOption('[data-monitor-grid-guru]', String(setup.guruA));
    ok('filter guru menyisakan jadwal guru terpilih',
      (await page.locator('[data-monitor-jadwal]').count()) >= 1);
    await page.selectOption('[data-monitor-grid-mode]', 'semua');
    ok('daftar kelas sedang belajar tampil', (await page.locator('[data-monitor-aktif]').count()) === 1);
    ok('kartu kelas aktif memuat status guru', (await page.locator('[data-monitor-status]').count()) >= 1,
      String(await page.locator('[data-monitor-status]').count()));
    ok('tabel rekap per kelas tampil', (await page.locator('[data-tbl="monitor-kelas"]').count()) === 1);
    ok('daftar jurnal belum diisi tampil', (await page.locator('[data-tbl="monitor-jurnal-belum"]').count()) === 1);
    ok('sakelar auto-refresh tersedia', (await page.locator('[data-monitor-auto]').count()) === 1);
    /* guru mengisi jurnal → persentase naik setelah disegarkan */
    const loginA = await apiLogin('guru', 'guru123');
    ok('login guru A untuk mengisi alur KBM', loginA.status === 200, loginA.status);
    const checkinA = await apiReq('/api/absensi-guru/checkin', {
      method: 'POST', body: { jadwal_id: setup.s1id, tanggal: TODAY, status: 'hadir' }
    });
    ok('guru A check-in hadir', checkinA.status === 200, checkinA.body?.error);
    const siswaA = ((await apiReq('/api/siswa?limit=30')).body.rows || [])
      .filter(x => Number(x.kelas_id) === Number(setup.kelasId));
    const sesiA = await apiReq('/api/absensi-siswa/sesi', {
      method: 'POST', body: { jadwal_id: setup.s1id, tanggal: TODAY }
    });
    ok('sesi presensi guru A dibuat', sesiA.status === 200, sesiA.body?.error);
    const simpanA = await apiReq('/api/absensi-siswa/simpan', {
      method: 'POST', body: {
        sesi_id: sesiA.body?.sesi?.id,
        items: siswaA.map(x => ({ siswa_id: x.id, status: 'H' }))
      }
    });
    ok('absensi siswa guru A lengkap', simpanA.status === 200, simpanA.body?.error);
    const jurnalA = await apiReq('/api/absensi-guru/jurnal', {
      method: 'POST', body: {
        jadwal_id: setup.s1id, tanggal: TODAY, materi: 'Materi monitoring dan latihan soal'
      }
    });
    ok('jurnal guru A tersimpan', jurnalA.status === 200, jurnalA.body?.error);
    await page.click('[data-monitor-refresh]').catch(() => {});
    await page.waitForTimeout(1200);
    ok('tombol segarkan memuat ulang data', (await page.locator('[data-page="monitor-kbm"]').count()) === 1);
    /* status guru berhalangan: guru B mengajukan izin (lewat API sisi Node) */
    const loginB = await apiLogin('guruumum', 'guruumum123');
    ok('login guru B untuk uji izin', loginB.status === 200, loginB.status);
    const izinRes = await apiReq('/api/absensi-guru/checkin', {
      method: 'POST', body: { jadwal_id: setup.s2id, tanggal: TODAY, status: 'izin', catatan: 'uji monitoring UI' }
    });
    ok('izin guru B tercatat', izinRes.status === 200, izinRes.body?.error || izinRes.status);
    await apiLogin('admin', 'admin123');
    await page.evaluate(async ({ kode }) => fetch('/api/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', kode })
    }), { kode: KODE });
    await page.reload();
    await page.waitForSelector('[data-page="monitor-kbm"]', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const previewButton = page.locator(`[data-monitor-preview="${setup.s1id}"]`);
    ok('tombol pratinjau muncul setelah semua langkah KBM selesai', await previewButton.count() === 1);
    await previewButton.click();
    await page.waitForSelector('[data-monitor-preview-content]', { timeout: 15000 });
    ok('pratinjau rekap tampil di modal tanpa navigasi halaman',
      await page.locator('[data-modal-title="Pratinjau Rekap KBM"]').count() === 1
      && await page.locator('[data-preview-absensi]').count() === 1
      && await page.locator('[data-preview-jurnal]').count() === 1
      && await page.locator('[data-preview-dokumentasi]').count() === 1);
    await page.locator('[data-modal-title="Pratinjau Rekap KBM"] button[aria-label="Tutup"]').click();
    const teksMon = await page.locator('[data-page="monitor-kbm"]').innerText();
    ok('tabel guru berhalangan tampil setelah ada izin', (await page.locator('[data-tbl="monitor-berhalangan"]').count()) === 1,
      teksMon.slice(0, 120));
    ok('status "Belum ada pengganti" tampil', /belum ada pengganti/i.test(teksMon), teksMon.slice(0, 200));
    ok('ringkasan per kelas menyebut jumlah jam', /Jurnal|jurnal/.test(teksMon));

    /* ================= 4. KALENDER AKADEMIK ================= */
    console.log('\n== 4. KALENDER AKADEMIK: EKSPOR, WARNA, SEMESTER ==');
    await page.goto(BASE + '/#/kalender_akademik');
    await page.waitForSelector('[data-page="kalender-akademik"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    ok('tombol Cetak/PDF tersedia (membuka modal opsi cetak)',
      (await page.locator('[data-kal-cetak]').count()) === 1);
    await page.click('[data-kal-cetak]');
    await page.waitForSelector('[data-kal-cetak-proses]', { timeout: 10000 });
    ok('modal cetak menyediakan pilihan cakupan (tahun/semester) & orientasi',
      (await page.locator('[data-kal-cakupan]').count()) === 4
      && (await page.locator('[data-kal-orient]').count()) === 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok('tombol Export Excel tersedia', /\/api\/kalender-akademik\/export/.test(await page.getAttribute('[data-kal-excel]', 'href') || ''));
    ok('tombol Export Word tersedia', /\/api\/kalender-akademik\/word/.test(await page.getAttribute('[data-kal-word]', 'href') || ''));
    ok('tombol pengaturan Semester & Warna tersedia', (await page.locator('[data-kal-pengaturan]').count()) === 1);
    ok('info rentang semester tampil di halaman',
      /Semester 1/.test(await page.textContent('[data-kal-semester-info]')) && /Semester 2/.test(await page.textContent('[data-kal-semester-info]')));
    /* panel pengaturan */
    await page.click('[data-kal-pengaturan]');
    await page.waitForSelector('[data-kal-sem-mulai="ganjil"]', { timeout: 10000 });
    ok('panel berisi input rentang semester 1 & 2',
      (await page.locator('[data-kal-sem-mulai="ganjil"]').count()) === 1
      && (await page.locator('[data-kal-sem-mulai="genap"]').count()) === 1);
    ok('panel berisi color picker per kategori (3 × 3 warna)',
      (await page.locator('[data-kal-warna-kat]').count()) === 9,
      String(await page.locator('[data-kal-warna-kat]').count()));
    ok('panel berisi nama & NIP pengawas',
      (await page.locator('[data-kal-pengawas-nama]').count()) === 1
      && (await page.locator('[data-kal-pengawas-nip]').count()) === 1);
    /* ubah warna libur jadi hijau + simpan */
    await page.fill('[data-kal-pengawas-nama]', 'Drs. Pengawas UI, M.Pd.');
    await page.locator('[data-kal-warna-kat="libur"][data-kal-warna-sisi="bg"]').evaluate(el => {
      el.value = '#16A34A';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('[data-kal-pengaturan-simpan]');
    await page.waitForTimeout(1500);
    const warnaTersimpan = await page.evaluate(async () => (await (await fetch('/api/kalender-akademik', { credentials: 'same-origin' })).json()).warna.libur.bg);
    ok('warna kategori tersimpan lewat color picker',
      String(warnaTersimpan || '').toLowerCase() === '#16a34a', warnaTersimpan);
    /* tandai satu tanggal libur → sel memakai warna kategori baru */
    await page.click(`[data-day="${TODAY}"]`);
    await page.waitForSelector('[data-kal-kategori]', { timeout: 10000 });
    await page.selectOption('[data-kal-kategori]', 'libur');
    await page.fill('[data-kal-judul]', 'Libur Uji UI');
    await page.click('[data-simpan-tanggal]');
    await page.waitForTimeout(1600);
    const styleSel = await page.locator(`[data-day="${TODAY}"]`).evaluate(el => getComputedStyle(el).backgroundColor);
    ok('sel tanggal memakai warna kategori kustom', /22,\s*163,\s*74/.test(styleSel), styleSel);
    ok('keterangan rentang kegiatan tampil di bawah kotak bulan',
      (await page.locator('[data-bulan-keterangan]').count()) >= 1);
    const ketBulan = await page.locator('[data-bulan-keterangan]').first().innerText();
    ok('keterangan memuat rentang tanggal + judul', /\d/.test(ketBulan) && /Libur/i.test(ketBulan), ketBulan.slice(0, 100));
    /* warna khusus per tanggal */
    await page.click(`[data-day="${TODAY}"]`);
    await page.waitForSelector('[data-kal-warna]', { timeout: 10000 });
    await page.locator('[data-kal-warna]').evaluate(el => {
      el.value = '#8B5CF6';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('[data-simpan-tanggal]');
    await page.waitForTimeout(1500);
    const styleKhusus = await page.locator(`[data-day="${TODAY}"]`).evaluate(el => getComputedStyle(el).backgroundColor);
    ok('warna khusus tanggal menimpa warna kategori', /139,\s*92,\s*246/.test(styleKhusus), styleKhusus);
    /* dokumen cetak bisa diambil (kop hanya halaman 1 + TTD hanya halaman akhir) */
    const cetak = await page.evaluate(async () => {
      const r = await fetch('/api/kalender-akademik/cetak', { credentials: 'same-origin' });
      const t = await r.text();
      return {
        status: r.status, len: t.length, kop: (t.match(/class="kop sym"/g) || []).length,
        ttd: (t.match(/class="ttdc"/g) || []).length, ttdp: (t.match(/class="ttdp"/g) || []).length,
        nokop: t.includes('kal-page nokop'), pb: t.includes('class="kal-sem pagebreak"'),
        rentang: /Rentang tanggal efektif/.test(t), kosong: /Belum ada kegiatan/i.test(t)
      };
    });
    ok('dokumen cetak: 200 + kop sekali + 2 kolom TTD + pengawas + pemisah semester',
      cetak.status === 200 && cetak.kop === 1 && cetak.ttd === 2 && cetak.ttdp === 1 && cetak.pb, JSON.stringify(cetak));
    ok('dokumen cetak: halaman semester 2 tanpa kop & tanpa baris rentang tanggal',
      cetak.nokop && !cetak.rentang && !cetak.kosong, JSON.stringify(cetak));

    /* ================= 5. MOBILE 390px ================= */
    console.log('\n== 5. MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 820 });
    for (const [hash, label] of [['#/monitor_kbm', 'monitoring KBM'], ['#/kalender_akademik', 'kalender akademik'], ['#/jadwal', 'jadwal']]) {
      await page.goto(BASE + '/' + hash);
      await page.waitForTimeout(1200);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`tanpa overflow horizontal: ${label}`, ov <= 2, String(ov));
    }

    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    await browser.close();
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL UI MONITOR: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
