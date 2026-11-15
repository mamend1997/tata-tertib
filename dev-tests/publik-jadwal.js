'use strict';
/* Uji (tata-tertib) — halaman JADWAL PUBLIK (/jadwal-publik/<token>):
   1. Tampilan memakai MATRIKS KARTU SLOT (bukan tabel baris teks) — sama dengan
      menu pengelolaan jadwal, baik difilter per KELAS maupun per GURU.
   2. Setiap kartu: label sesi + rentang waktu di atas, badge kode mapel & nama
      mapel, lalu nama guru tanpa nama kelas — semuanya RATA TENGAH.
   3. Sesi KHUSUS per hari (Senin "Upacara", Jumat "Pembiasaan") didukung penuh;
      tinggi kartu proporsional mengikuti durasi sesi.
   4. Cetak dari halaman publik juga memakai kartu; ekspor Excel tetap jalan.
   Jalankan: node dev-tests/publik-jadwal.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const APP = path.join(__dirname, '..');
const DB = path.join(os.tmpdir(), 'stt-pj-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-pj-saas-' + Date.now() + '.sqlite');
const PORT = 5300 + Math.floor(Math.random() * 190);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  return { status: r.status, body, ct };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(APP, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 4200));
  let browser = null;
  try {
    const pub = await req('/api/public/sekolah');
    const KODE = ((pub.body || {}).rows || [])[0].kode;
    await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    const ta = await req('/api/tahun');
    const taId = ((ta.body || {}).rows || [])[0].id;

    /* ---- SESI KHUSUS: Senin diawali "Upacara", Jumat diawali "Pembiasaan" ---- */
    const jd0 = ((await req('/api/jadwal?ta=' + taId)).body || {}).config || {};
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    /* daftar sesi 45 menit dengan istirahat 15 menit setelah jam ke-2, mulai `awal` */
    const buatSesi = (awal, namaAwal) => {
      const out = [];
      let t = awal;
      if (namaAwal) { out.push({ label: namaAwal, mulai: hm(t), selesai: hm(t + 45), istirahat: 1 }); t += 45; }
      for (let i = 1; i <= 6; i++) {
        out.push({ label: `Jam ke-${i}`, mulai: hm(t), selesai: hm(t + 45), istirahat: 0 });
        t += 45;
        if (i === 2) { out.push({ label: 'Istirahat', mulai: hm(t), selesai: hm(t + 15), istirahat: 1 }); t += 15; }
      }
      return out;
    };
    const sesiUmum = buatSesi(7 * 60);
    const setCfg = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [1, 2, 3, 4, 5], max_jam: 8, sesi: sesiUmum,
        sesi_hari: {
          1: buatSesi(7 * 60, 'Upacara'),          // Senin diawali Upacara 07:00–07:45
          5: buatSesi(7 * 60, 'Pembiasaan')        // Jumat diawali Pembiasaan
        },
        max_mapel_jam: 6, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      }
    });
    ok('pengaturan sesi khusus per hari tersimpan (Senin & Jumat)', setCfg.status === 200
      && Object.keys((setCfg.body.config || {}).sesiHari || {}).length >= 2, JSON.stringify(setCfg.body).slice(0, 200));
    /* mapel + slot pada Senin (hari khusus) & Selasa */
    let jd = (await req('/api/jadwal?ta=' + taId)).body || {};
    for (const [kode, nama] of [['OTKU', 'OTKU'], ['BK', 'Bimbingan Konseling'], ['KA', 'Kearsipan'], ['MTK', 'Matematika']]) {
      await req('/api/mapel/save', { method: 'POST', body: { kode, nama, kelompok: 'Umum', maks_jam: 6 } });
    }
    jd = (await req('/api/jadwal?ta=' + taId)).body || {};
    const kelasA = (jd.kelas || [])[0] || {};
    const guruA = (jd.guru || [])[0] || {};
    const sesiSenin = (jd.config.sesiHari || {})[1] || jd.config.sesi;
    const idxSenin = sesiSenin.filter(s => !s.istirahat).map(s => s.idx);
    const sesiSelasa = (jd.config.sesiHari || {})[2] || jd.config.sesi;
    const idxSelasa = sesiSelasa.filter(s => !s.istirahat).map(s => s.idx);
    for (let i = 0; i < Math.min(3, (jd.mapel || []).length); i++) {
      const r = await req('/api/jadwal/slot', {
        method: 'POST',
        body: { ta: taId, hari: 1, sesi: idxSenin[i], mapel_id: jd.mapel[i].id, guru_id: guruA.id, kelas_ids: [kelasA.id], ruang: 'R-01' }
      });
      if (r.status !== 200) console.log('   (slot senin gagal)', JSON.stringify(r.body).slice(0, 120));
    }
    if ((jd.mapel || []).length) {
      await req('/api/jadwal/slot', {
        method: 'POST',
        body: { ta: taId, hari: 2, sesi: idxSelasa[0], mapel_id: jd.mapel[0].id, guru_id: guruA.id, kelas_ids: [kelasA.id], ruang: '' }
      });
    }
    /* aktifkan tautan publik */
    const pubTok = await req('/api/jadwal/publik', { method: 'POST', body: { aktif: 1 } });
    ok('tautan publik jadwal dapat diaktifkan', pubTok.status === 200 && !!pubTok.body.token, JSON.stringify(pubTok.body).slice(0, 140));
    const TOKEN = pubTok.body.token;

    /* ================= A. API PUBLIK ================= */
    console.log('\n== A. API PUBLIK ==');
    let r = await req('/api/public/jadwal/' + TOKEN);
    ok('API publik: 200 + data jadwal', r.status === 200 && Array.isArray(r.body.rows), r.status);
    ok('API publik mengirim sesi umum & sesi khusus per hari',
      Array.isArray(r.body.config.sesi) && !!r.body.config.sesi_hari
      && Array.isArray(r.body.config.sesi_hari['1']) && Array.isArray(r.body.config.sesi_hari['5']),
      JSON.stringify(Object.keys(r.body.config || {})));
    ok('sesi khusus Senin diawali Upacara & Jumat diawali Pembiasaan',
      /Upacara/i.test(r.body.config.sesi_hari['1'][0].label) && /Pembiasaan/i.test(r.body.config.sesi_hari['5'][0].label),
      `${r.body.config.sesi_hari['1'][0].label} / ${r.body.config.sesi_hari['5'][0].label}`);
    ok('API publik mengirim daftar kelas & guru untuk filter',
      (r.body.kelas || []).length > 0 && (r.body.guru || []).length > 0);
    r = await req('/api/public/jadwal/' + TOKEN + '?kelas=' + kelasA.id);
    ok('filter kelas: hanya slot kelas tsb', r.status === 200 && r.body.rows.every(x => x.kelas_ids.includes(Number(kelasA.id))));
    r = await req('/api/public/jadwal/' + TOKEN + '?guru=' + guruA.id);
    ok('filter guru: hanya slot guru tsb', r.status === 200 && r.body.rows.every(x => Number(x.guru_id) === Number(guruA.id)));

    /* ================= B. CETAK & EKSPOR DARI PUBLIK ================= */
    console.log('\n== B. CETAK & EKSPOR PUBLIK (KARTU SLOT) ==');
    r = await req('/api/public/jadwal/' + TOKEN + '/cetak?kelas=' + kelasA.id);
    const htmlCetak = String(r.body || '');
    ok('cetak publik: 200', r.status === 200, r.status);
    ok('cetak publik memakai KARTU slot (bukan tabel teks biasa)', /class="kartu/.test(htmlCetak));
    ok('cetak publik: kartu memuat label jam + rentang waktu',
      /class="lab">/.test(htmlCetak) && /class="wkt">\d{2}:\d{2}/.test(htmlCetak));
    ok('cetak publik: kolom tabel = nama hari (tanpa kolom JAM kiri)',
      !/<th class="jam">JAM<\/th>/.test(htmlCetak));
    ok('cetak publik: label sesi tidak dobel per kartu', !/class="khusus"/.test(htmlCetak));
    /* setiap kartu hanya boleh punya SATU label sesi (dulu "JAM KE-1" tercetak dua kali
       pada hari bersesi khusus seperti Senin & Jumat) */
    const kartuCetak = htmlCetak.match(/<div class="kartu[^"]*">[\s\S]*?<\/div>/g) || [];
    ok('cetak publik: tiap kartu hanya 1 label sesi', kartuCetak.length > 0
      && kartuCetak.every(c => (c.match(/class="lab"/g) || []).length <= 1),
      String(kartuCetak.filter(c => (c.match(/class="lab"/g) || []).length > 1).length) + ' kartu dobel');
    ok('cetak publik: hari khusus tetap berlabel Upacara / Pembiasaan',
      /class="lab">Upacara</.test(htmlCetak) && /class="lab">Pembiasaan</.test(htmlCetak));
    r = await req('/api/public/jadwal/' + TOKEN + '/export.xlsx?kelas=' + kelasA.id);
    ok('ekspor Excel publik tetap berfungsi', r.status === 200 && /spreadsheet/.test(r.ct), r.ct);

    /* ================= C. HALAMAN PUBLIK (SPA) ================= */
    console.log('\n== C. TAMPILAN HALAMAN PUBLIK ==');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 1600 } });
    await ctx.addCookies(cookie.split('; ').map(c => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    let page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/jadwal-publik/' + TOKEN, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-grid-publik]', { timeout: 20000 });

    const lay = await page.evaluate(() => {
      const grid = document.querySelector('[data-grid-publik]');
      const hari = [...grid.querySelectorAll('[data-hari]')];
      const kartu = [...grid.querySelectorAll('[data-kartu-slot="mapel"]')];
      const satu = kartu[0];
      const mapelEl = satu?.querySelector('[data-slot-mapel]');
      const guruEl = satu?.querySelector('[data-slot-guru]');
      const labels = satu ? [...satu.querySelectorAll('[data-slot-label]')].map(x => x.textContent.trim()) : [];
      const info = satu ? {
        label: labels,
        jam: satu.querySelector('[data-slot-jam]')?.textContent.trim(),
        mapel: mapelEl?.textContent.trim(),
        kelas: !!satu.querySelector('[data-slot-kelas]'),
        guru: guruEl?.textContent.trim(),
        urutanMapelGuru: !!(mapelEl && guruEl && (mapelEl.contains(guruEl)
          || mapelEl.compareDocumentPosition(guruEl) & Node.DOCUMENT_POSITION_FOLLOWING)),
        align: [satu, ...satu.querySelectorAll('p')].map(x => getComputedStyle(x).textAlign)
      } : null;
      const tinggi = (sel) => {
        const el = grid.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      };
      /* jumlah sesi & tinggi kartu per hari (proporsional durasi) */
      const perHari = hari.map(h => ({
        hari: h.getAttribute('data-hari'),
        sesi: h.querySelectorAll('[data-kartu-slot]').length,
        upacara: !!h.querySelector('[data-sesi-istirahat*="Upacara"]'),
        pembiasaan: !!h.querySelector('[data-sesi-istirahat*="Pembiasaan"]'),
        khusus: h.querySelector('[data-hari-khusus="1"]') ? 1 : 0
      }));
      return {
        adaTabel: !!grid.querySelector('table'),
        jumlahHari: hari.length, jumlahKartu: kartu.length, info,
        perHari,
        tinggiJam: tinggi('[data-hari="1"] [data-kartu-slot="mapel"]'),
        tinggiIstirahat: tinggi('[data-hari="1"] [data-kartu-slot="istirahat"]')
      };
    });
    console.log('   ' + JSON.stringify(lay).slice(0, 620));
    ok('tidak memakai tabel baris teks (matriks kartu)', lay.adaTabel === false);
    ok('kolom hari dirender (≥5 hari aktif)', lay.jumlahHari >= 5, String(lay.jumlahHari));
    ok('kartu slot dirender', lay.jumlahKartu > 0, String(lay.jumlahKartu));
    ok('kartu: label sesi tepat SATU (tidak dobel)', lay.info && lay.info.label.length === 1,
      JSON.stringify(lay.info && lay.info.label));
    ok('kartu: rentang waktu jam tampil', lay.info && /\d{2}:\d{2}–\d{2}:\d{2}/.test(lay.info.jam || ''), lay.info && lay.info.jam);
    ok('kartu: nama mapel + kode mapel tampil', lay.info && /[A-Z]{2,}/.test(lay.info.mapel || ''), lay.info && lay.info.mapel);
    ok('kartu publik tidak menampilkan nama kelas', lay.info && lay.info.kelas === false);
    ok('kartu: nama guru tampil', lay.info && !!lay.info.guru, lay.info && lay.info.guru);
    ok('urutan kartu: nama mapel lalu nama guru', lay.info && lay.info.urutanMapelGuru);
    ok('kartu: seluruh teks rata tengah', lay.info && lay.info.align.every(a => a === 'center'),
      JSON.stringify(lay.info && lay.info.align));
    ok('sesi khusus Senin (Upacara) tampil sebagai kartu tersendiri',
      lay.perHari.some(h => h.upacara), JSON.stringify(lay.perHari.map(h => h.hari + ':' + h.sesi)));
    ok('sesi khusus Jumat (Pembiasaan) tampil', lay.perHari.some(h => h.pembiasaan));
    ok('hari khusus ditandai badge "khusus"', lay.perHari.some(h => h.khusus === 1));
    ok('tinggi kartu proporsional (istirahat lebih pendek dari jam pelajaran)',
      lay.tinggiIstirahat > 0 && lay.tinggiJam > lay.tinggiIstirahat,
      `jam=${lay.tinggiJam} istirahat=${lay.tinggiIstirahat}`);

    /* filter guru di UI → tetap matriks kartu */
    await page.selectOption('[data-filter-guru]', String(guruA.id));
    await page.waitForTimeout(1200);
    const guruView = await page.evaluate(() => ({
      grid: document.querySelectorAll('[data-grid-publik]').length,
      kartu: document.querySelectorAll('[data-kartu-slot="mapel"]').length,
      tabel: document.querySelectorAll('[data-grid-publik] table').length
    }));
    ok('filter GURU memakai matriks kartu (bukan tabel)',
      guruView.grid > 0 && guruView.kartu > 0 && guruView.tabel === 0, JSON.stringify(guruView));

    /* filter kelas */
    await page.selectOption('[data-filter-guru]', '');
    await page.waitForTimeout(900);
    await page.selectOption('[data-filter-kelas]', String(kelasA.id));
    await page.waitForTimeout(1200);
    const kelasView = await page.evaluate(() => ({
      grid: document.querySelectorAll('[data-grid-publik]').length,
      kartu: document.querySelectorAll('[data-kartu-slot="mapel"]').length
    }));
    ok('filter KELAS memakai matriks kartu', kelasView.grid === 1 && kelasView.kartu > 0, JSON.stringify(kelasView));

    /* mobile 390px tanpa overflow */
    await page.setViewportSize({ width: 390, height: 820 });
    await page.waitForTimeout(900);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('tanpa overflow horizontal di ponsel 390px', ov <= 2, String(ov));
    ok('tanpa error JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    await browser.close();
    browser = null;
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    if (browser) await browser.close().catch(() => { });
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(SAAS); } catch (e) { /* abaikan */ }
  }
  console.log(`\n=== HASIL JADWAL PUBLIK: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
