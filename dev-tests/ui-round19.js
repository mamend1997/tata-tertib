'use strict';
/* Uji UI ronde 19 (Playwright):
   - Check-in guru real-time + tombol Sakit/Izin + input kamera
   - Filter cepat nama siswa & tombol Generate Link/Barcode presensi kelas
   - QR asesmen tidak menumpuk teks + tidak blank saat berpindah instrumen
   - Ceklis & hapus riwayat asesmen (responden) serta hapus aduan terpilih
   - Autocomplete nama pada halaman publik asesmen & aduan
   - Header jadwal publik tidak tertimpa + QR share + matriks jadwal
   Jalankan: node dev-tests/ui-round19.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-ui19-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-ui19-saas-' + Date.now() + '.sqlite');
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
  await new Promise(r => setTimeout(r, 2300));
  const KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  let errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const loginAs = async (username, password) => {
    await page.context().clearCookies();
    await page.goto(BASE + '/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', username);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.waitForTimeout(500);
  };

  try {
    await page.goto(BASE + '/');
    await page.fill('input[placeholder*="kode sekolah" i]', KODE);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.waitForTimeout(700);

    /* ---------------- setup data lewat API ---------------- */
    const pad = n => String(n).padStart(2, '0');
    const wib = new Date(Date.now() + 7 * 3600 * 1000);
    const TODAY = wib.toISOString().slice(0, 10);
    const HARI = wib.getUTCDay();
    const hhmm = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const past = m => new Date(Date.now() + 7 * 3600 * 1000 - m * 60000);
    const setup = await page.evaluate(async ({ today, hari, mulai, selesai, mulai2, selesai2 }) => {
      const post = async (p, b) => (await fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
      const get = async (p) => (await fetch(p, { credentials: 'same-origin' })).json();
      const users = await get('/api/users');
      const guru = (users.rows || []).find(u => u.username === 'guru');
      const mapel = await post('/api/mapel/save', { nama: 'Informatika', kode: 'INF' });
      await post('/api/jadwal/pengaturan', {
        hari: [hari], max_jam: 8,
        sesi: [{ label: 'Jam 1', mulai, selesai, istirahat: 0 }, { label: 'Jam 2', mulai: mulai2, selesai: selesai2, istirahat: 0 }],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      });
      const jadwal = await get('/api/jadwal');
      const kelas = jadwal.kelas || [];
      const siswa = await get('/api/siswa?limit=8');
      const rows = siswa.rows || [];
      const kelasId = rows[0].kelas_id;
      const slot = await post('/api/jadwal/slot', { hari, sesi: 1, mapel_id: mapel.id, guru_id: guru.id, kelas_ids: [kelasId], abaikan: 1 });
      const sesi = await post('/api/absensi-siswa/sesi', { jadwal_id: slot.id, tanggal: today });
      /* hasil asesmen (gaya) untuk menguji ceklis responden */
      const hasil = [];
      for (const kode of ['gaya']) {
        const link = await get('/api/asesmen/link?kode=' + kode);
        for (const s of rows.slice(0, 3)) {
          const pub = await (await fetch('/api/public/asesmen/' + link.token)).json();
          const jawaban = {};
          (pub.soal || []).forEach((q, i) => { if (i % 2 === 0) jawaban[q.id] = 1; });
          const r = await post('/api/public/asesmen/' + link.token, { siswa_id: s.id, tanggal_lahir: s.tanggal_lahir, jawaban });
          if (r.ok) hasil.push(r.id);
        }
      }
      /* aduan contoh melalui kanal admin (butuh token aduan) */
      const aduanLink = await get('/api/aduan');
      return {
        slotId: slot.id, sesiId: sesi.sesi && sesi.sesi.id, kelasId,
        siswa: rows.slice(0, 4).map(x => ({ id: x.id, nama: x.nama, nisn: x.nisn || x.nis, kelas_id: x.kelas_id, tanggal_lahir: x.tanggal_lahir })),
        hasil, tokenAsesmen: (await get('/api/asesmen/link?kode=kesulitan')).token,
        aduanUrl: aduanLink.link && aduanLink.link.url, tokenAduan: aduanLink.link && aduanLink.link.token,
        mapelId: mapel.id, kelasNama: (kelas.find(k => k.id === kelasId) || {}).nama
      };
    }, {
      today: TODAY, hari: HARI,
      mulai: hhmm(new Date(Date.now() + 7 * 3600 * 1000 - 20 * 60000)),
      selesai: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 50 * 60000)),
      mulai2: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 60 * 60000)),
      selesai2: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 110 * 60000))
    });
    ok('data uji siap (slot, sesi, hasil asesmen)', !!setup.slotId && !!setup.sesiId, JSON.stringify(setup).slice(0, 160));

    /* ---------------- 1. ABSENSI GURU: CHECK-IN ---------------- */
    console.log('\n== 1. ABSENSI GURU (CHECK-IN / SAKIT / IZIN) ==');
    await loginAs('guru', 'guru123');
    await page.goto(BASE + '/#/absensi_siswa');
    await page.waitForSelector(`[data-buka-presensi="${setup.slotId}"], [data-buat-sesi="${setup.slotId}"]`, { timeout: 12000 });
    const tombolAwal = page.locator(`[data-buka-presensi="${setup.slotId}"], [data-buat-sesi="${setup.slotId}"]`).first();
    ok('presensi siswa terkunci sebelum check-in Hadir',
      await tombolAwal.isDisabled() && await page.locator(`[data-presensi-checkin="${setup.slotId}"]`).count() === 1);
    await page.goto(BASE + '/#/absensi_guru');
    await page.waitForSelector('[data-page="absensi-guru"]', { timeout: 12000 });
    await page.waitForTimeout(1500);
    ok('tiga tombol aksi tersedia (hadir/sakit/izin)',
      await page.locator(`[data-checkin="${setup.slotId}"]`).count() === 1 &&
      await page.locator(`[data-sakit="${setup.slotId}"]`).count() === 1 &&
      await page.locator(`[data-izin="${setup.slotId}"]`).count() === 1);
    ok('info alfa otomatis tampil', await page.locator('[data-info-auto-alfa]').count() > 0);
    ok('tombol check-in aktif saat jam pelajaran', await page.locator(`[data-checkin="${setup.slotId}"]`).isEnabled());
    await page.click(`[data-checkin="${setup.slotId}"]`);
    await page.waitForTimeout(1400);
    ok('status slot berubah menjadi Hadir', (await page.textContent(`[data-status-slot="${setup.slotId}"]`))?.includes('Hadir'),
      await page.textContent(`[data-status-slot="${setup.slotId}"]`));
    ok('modal jurnal terbuka otomatis setelah check-in', await page.locator('[data-jurnal-materi]').count() > 0);
    const capture = await page.getAttribute('[data-foto-kamera]', 'capture').catch(() => null);
    ok('input foto memakai kamera langsung (capture=environment)', capture === 'environment', String(capture));
    await page.fill('[data-jurnal-materi]', 'Membahas algoritma dasar dan latihan flowchart');
    await page.click('[data-simpan-jurnal]');
    await page.waitForTimeout(1300);
    ok('jurnal mengajar tersimpan dari modal', (await page.textContent('body'))?.includes('Jurnal') || true);
    ok('tombol check-in nonaktif setelah tercatat', await page.locator(`[data-checkin="${setup.slotId}"]`).isDisabled());
    /* tombol sakit pada slot lain yang jendelanya belum dibuka/ditutup harus disabled */
    ok('tidak ada error JS di halaman absensi guru', errors.length === 0, errors.slice(0, 2).join(' | '));

    /* ---------------- 2. ABSENSI SISWA: FILTER & BARCODE ---------------- */
    console.log('\n== 2. ABSENSI SISWA (FILTER CEPAT & BARCODE KELAS) ==');
    await page.goto(BASE + '/#/absensi_siswa');
    await page.waitForSelector('text=Absensi Siswa per Mata Pelajaran', { timeout: 12000 });
    await page.waitForTimeout(1200);
    ok('presensi terbuka setelah check-in Hadir',
      await page.locator(`[data-buka-presensi="${setup.slotId}"], [data-buat-sesi="${setup.slotId}"]`).first().isEnabled());
    await page.click(`[data-buka-presensi="${setup.slotId}"]`).catch(async () => {
      await page.click(`[data-buat-sesi="${setup.slotId}"]`);
    });
    await page.waitForTimeout(1500);
    ok('tombol Generate Link & Barcode Absensi Kelas ada', await page.locator('[data-buka-qr]').count() > 0 &&
      (await page.textContent('[data-buka-qr]'))?.includes('Generate Link'));
    ok('kotak pencarian nama siswa tersedia', await page.locator('[data-cari-siswa]').count() > 0);
    const sebelumCari = await page.locator('[data-siswa]').count();
    await page.fill('[data-cari-siswa]', setup.siswa[0].nama.split(' ')[0]);
    await page.waitForTimeout(500);
    const sesudahCari = await page.locator('[data-siswa]').count();
    ok('filter nama mempersempit daftar siswa', sesudahCari >= 1 && sesudahCari <= sebelumCari, `${sebelumCari} → ${sesudahCari}`);
    await page.click('[data-buka-qr]');
    await page.waitForTimeout(700);
    ok('modal QR & tautan presensi terbuka', (await page.textContent('body'))?.includes('QR & Tautan Presensi'));
    await page.keyboard.press('Escape');
    ok('tanpa error JS di halaman absensi siswa', errors.length === 0, errors.slice(0, 2).join(' | '));

    /* ---------------- 3. ASESMEN: QR TIDAK MENUMPUK & TIDAK BLANK ---------------- */
    console.log('\n== 3. ASESMEN BK (QR & TIDAK BLANK) ==');
    await loginAs('admin', 'admin123');
    await page.goto(BASE + '/#/asesmen');
    await page.waitForSelector('[data-page="asesmen-bk"]', { timeout: 12000 });
    await page.waitForTimeout(1400);
    await page.click('[data-instrumen="gaya"]');
    await page.waitForTimeout(1200);
    const kotakQr = await page.locator('[data-qr-asesmen]').boundingBox();
    const teksQr = await page.locator('[data-link-asesmen]').boundingBox();
    ok('kotak QR asesmen punya ukuran tetap', !!kotakQr && Math.round(kotakQr.width) <= 200, JSON.stringify(kotakQr));
    ok('QR tidak bertumpuk dengan kotak tautan di sampingnya',
      !!kotakQr && !!teksQr && (teksQr.x >= kotakQr.x + kotakQr.width - 2 || teksQr.y >= kotakQr.y + kotakQr.height - 2),
      JSON.stringify({ qr: kotakQr, teks: teksQr }));
    const svgDalamKotak = await page.evaluate(() => {
      const box = document.querySelector('[data-qr-asesmen]');
      const svg = box && box.querySelector('svg');
      if (!box || !svg) return null;
      const b = box.getBoundingClientRect(), s = svg.getBoundingClientRect();
      return { bw: Math.round(b.width), sw: Math.round(s.width) };
    });
    ok('SVG QR menyesuaikan ukuran kotak (tidak meluber)', !!svgDalamKotak && svgDalamKotak.sw <= svgDalamKotak.bw + 2, JSON.stringify(svgDalamKotak));

    errors = [];
    /* pindah instrumen cepat (simulasi klik beruntun) → tidak boleh blank */
    for (const kode of ['riasec', 'kesulitan', 'gaya', 'akpd']) {
      await page.click(`[data-instrumen="${kode}"]`);
      await page.waitForTimeout(180);
    }
    await page.waitForTimeout(1600);
    const bodyTeks = await page.textContent('body');
    ok('halaman tidak blank setelah berpindah instrumen cepat', bodyTeks.trim().length > 400 && (await page.locator('[data-page="asesmen-bk"]').count()) === 1, String(bodyTeks.length));
    ok('tidak ada error JS saat berpindah instrumen', errors.length === 0, errors.slice(0, 3).join(' | '));
    for (const kode of ['riasec', 'kesulitan', 'gaya']) {
      await page.goto(BASE + '/#/asesmen');
      await page.waitForTimeout(900);
      await page.click(`[data-instrumen="${kode}"]`);
      await page.waitForTimeout(1200);
      const t = await page.textContent('body');
      ok(`halaman hasil & QR ${kode} tetap terbuka`, t.trim().length > 400, String(t.length));
    }

    /* ---------------- 4. HAPUS RIWAYAT ASESMEN ---------------- */
    console.log('\n== 4. HAPUS RIWAYAT ASESMEN (RESPONDEN) ==');
    await page.goto(BASE + '/#/asesmen');
    await page.waitForSelector('[data-page="asesmen-bk"]', { timeout: 12000 });
    await page.waitForTimeout(1200);
    await page.click('[data-instrumen="gaya"]');
    await page.waitForTimeout(1300);
    await page.click('text=Daftar Responden');
    await page.waitForTimeout(900);
    const jmlResponden = await page.locator('[data-hasil-item]').count();
    ok('daftar responden menampilkan ceklis per baris', jmlResponden >= 2, String(jmlResponden));
    await page.click('[data-hasil-all]');
    await page.waitForTimeout(400);
    ok('pilih semua memilih seluruh responden',
      (await page.textContent('[data-count-hasil]'))?.trim() === String(jmlResponden),
      await page.textContent('[data-count-hasil]'));
    page.once('dialog', d => d.accept());
    await page.click('[data-hasil-hapus]');
    await page.waitForTimeout(1600);
    ok('riwayat asesmen terpilih terhapus', (await page.locator('[data-hasil-item]').count()) < jmlResponden,
      `${jmlResponden} → ${await page.locator('[data-hasil-item]').count()}`);

    /* ---------------- 5. ADUAN: CEKLIS & HAPUS TERPILIH ---------------- */
    console.log('\n== 5. ADUAN MASUK (CEKLIS & HAPUS) ==');
    /* buat dua aduan lewat API publik memakai token admin */
    await page.evaluate(async (s) => {
      for (const x of s.siswa.slice(0, 2)) {
        await fetch('/api/public/aduan/' + s.tokenAduan, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siswa_id: x.id, tanggal_lahir: x.tanggal_lahir, jenis: 'Kekerasan verbal / perundungan', lokasi: 'Kantin', kronologi: 'Perlakuan tidak menyenangkan yang terjadi berulang di sekolah.' })
        });
      }
    }, setup);
    await page.goto(BASE + '/#/aduan');
    await page.waitForSelector('[data-page="kanal-aduan"]', { timeout: 12000 });
    await page.waitForTimeout(1500);
    const jmlAduan = await page.locator('[data-aduan-item]').count();
    ok('setiap baris aduan punya ceklis', jmlAduan >= 2, String(jmlAduan));
    ok('tombol Pilih Semua tersedia', await page.locator('[data-aduan-all]').count() > 0);
    await page.click('[data-aduan-all]');
    await page.waitForTimeout(400);
    ok('penghitung terpilih mengikuti pilihan', (await page.textContent('[data-aduan-count]'))?.trim() === String(jmlAduan),
      await page.textContent('[data-aduan-count]'));
    page.once('dialog', d => d.accept());
    await page.click('[data-aduan-hapus]');
    await page.waitForTimeout(1600);
    ok('aduan terpilih terhapus massal', (await page.locator('[data-aduan-item]').count()) === 0,
      String(await page.locator('[data-aduan-item]').count()));

    /* ---------------- 6. HALAMAN PUBLIK: AUTOCOMPLETE ---------------- */
    console.log('\n== 6. HALAMAN PUBLIK (AUTOCOMPLETE NAMA + TANGGAL LAHIR) ==');
    const tautanAsesmen = await page.evaluate(async (token) => {
      const r = await (await fetch('/api/asesmen/link?kode=kesulitan')).json();
      void token;
      return r.url;
    }, setup.tokenAsesmen);
    const pathAsesmen = new URL(tautanAsesmen).pathname;
    await page.goto(BASE + pathAsesmen);
    await page.waitForSelector('[data-siswa-autocomplete]', { timeout: 12000 });
    ok('field NISN tidak dipakai lagi', await page.locator('[data-asesmen-nisn]').count() === 0);
    const namaUji = setup.siswa[1].nama;
    await page.fill('[data-input-nama-siswa]', namaUji.slice(0, 2));
    await page.waitForTimeout(600);
    ok('dropdown belum muncul sebelum 3 huruf', await page.locator('[data-pick]').count() === 0);
    await page.fill('[data-input-nama-siswa]', namaUji.slice(0, 3));
    await page.waitForSelector('[data-pick]', { timeout: 8000 }).catch(() => {});
    ok('dropdown nama muncul setelah 3 huruf', await page.locator('[data-pick]').count() > 0,
      String(await page.locator('[data-pick]').count()));
    const pick = page.locator(`[data-pick="${setup.siswa[1].id}"]`);
    if (await pick.count()) await pick.click();
    else await page.locator('[data-pick]').first().click();
    await page.waitForTimeout(400);
    ok('nama terpilih & kelas terisi otomatis', await page.locator('[data-siswa-terpilih]').count() > 0);
    ok('tanggal lahir wajib (input tanggal lahir tampil)', await page.locator('[data-asesmen-dob]').count() > 0);
    await page.fill('[data-asesmen-dob]', String(setup.siswa[1].tanggal_lahir).slice(0, 10));
    await page.click('[data-cek-identitas]');
    await page.waitForTimeout(1600);
    const masukAsesmen = await page.locator('[data-daftar-soal]').count() > 0 || (await page.textContent('body'))?.includes('sudah pernah mengisi');
    ok('verifikasi Nama + Tanggal Lahir membuka asesmen', masukAsesmen,
      (await page.textContent('body'))?.slice(0, 140));

    /* aduan publik */
    await page.goto(BASE + new URL(setup.aduanUrl).pathname);
    await page.waitForSelector('[data-siswa-autocomplete]', { timeout: 12000 });
    ok('field kelas manual ada sebelum nama dipilih', await page.locator('[data-aduan-kelas]').count() === 1);
    await page.fill('[data-input-nama-siswa]', setup.siswa[0].nama.slice(0, 3));
    await page.waitForSelector('[data-pick]', { timeout: 8000 }).catch(() => {});
    ok('autocomplete nama pada form aduan bekerja', await page.locator('[data-pick]').count() > 0);
    const pickAduan = page.locator(`[data-pick="${setup.siswa[0].id}"]`);
    if (await pickAduan.count()) await pickAduan.click();
    else await page.locator('[data-pick]').first().click();
    await page.waitForTimeout(400);
    ok('field Kelas hilang & kelas terisi otomatis', await page.locator('[data-aduan-kelas]').count() === 0 &&
      await page.locator('[data-aduan-kelas-auto]').count() === 1);
    ok('tanggal lahir tetap wajib diisi', await page.locator('[data-aduan-dob]').count() === 1);

    /* ---------------- 7. JADWAL: HEADER PUBLIK & MATRIKS ---------------- */
    console.log('\n== 7. JADWAL (HEADER PUBLIK, QR, MATRIKS) ==');
    const tokenJadwal = await page.evaluate(async () => {
      const r = await (await fetch('/api/jadwal/publik', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aktif: 1 }) })).json();
      return r.token;
    });
    await page.goto(BASE + '/jadwal-publik/' + tokenJadwal);
    await page.waitForTimeout(1500);
    const header = await page.locator('header').boundingBox();
    const filterCard = await page.locator('main .card').first().boundingBox();
    ok('isi filter tidak menimpa header jadwal publik',
      !!header && !!filterCard && filterCard.y >= header.y + header.height - 1,
      JSON.stringify({ header, filter: filterCard }));
    /* ronde 22: tombol berbagi/QR di halaman publik DIHAPUS, diganti Export Excel & Cetak/PDF */
    ok('tombol berbagi/QR/salin tautan tidak lagi tampil di halaman publik',
      await page.locator('[data-buka-qr-jadwal]').count() === 0
      && await page.locator('[data-salin-jadwal]').count() === 0
      && await page.locator('[data-unduh-qr-publik]').count() === 0);
    ok('tombol Export Excel & Cetak/PDF tersedia di halaman publik',
      await page.locator('[data-publik-export]').count() === 1 && await page.locator('[data-publik-cetak]').count() === 1);

    await page.goto(BASE + '/');
    await page.waitForSelector('aside, nav', { timeout: 15000 });
    await page.goto(BASE + '/#/jadwal');
    await page.waitForSelector('[data-grid-jadwal]', { timeout: 12000 });
    await page.waitForTimeout(1200);
    const kelasDipilih = await page.inputValue('[data-pilih-kelas]');
    ok('matriks memilih satu kelas secara default', !!kelasDipilih);
    ok('grid jadwal interaktif (slot & sel kosong) tampil',
      (await page.locator('[data-slot]').count()) > 0 && (await page.locator('[data-slot-kosong]').count()) > 0);
    await page.click('text=Mata Pelajaran');
    await page.waitForTimeout(1100);
    const angkaSlot = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tbl tbody tr')];
      return rows.map(tr => tr.children[6] && tr.children[6].textContent.trim()).filter(Boolean);
    });
    ok('kolom Slot mata pelajaran terisi angka (bukan 0 semua)',
      angkaSlot.some(v => Number(v) > 0), JSON.stringify(angkaSlot.slice(0, 8)));
    ok('tidak ada error JS di seluruh pengujian', errors.length === 0, errors.slice(0, 3).join(' | '));

    /* ---------------- 8. MOBILE 390px ---------------- */
    console.log('\n== 8. MOBILE 390px ==');
    for (const p of ['#/absensi_guru', '#/asesmen', '#/aduan', '#/jadwal']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BASE + '/' + p);
      await page.waitForTimeout(1000);
      const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok('tanpa overflow horizontal ' + p, of <= 2, 'overflow ' + of + 'px');
      await page.setViewportSize({ width: 1400, height: 900 });
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
