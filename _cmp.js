'use strict';
/* Bandingkan tampilan CETAK kalender dengan kartu bulan pada MENU WEB
   (warna, radius, font, label dalam sel) + tangkap layar untuk penilaian visual. */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const APP = __dirname;
const DB = path.join(os.tmpdir(), 'stt-cmp-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-cmp-saas-' + Date.now() + '.sqlite');
const PORT = 5500 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '_cmp');
fs.mkdirSync(OUT, { recursive: true });
let cookie = '';
async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json().catch(() => null) : await r.text() };
}
const KOP = {
  kop_sumber: 'manual',
  kop_baris: ['PERWAKILAN YAYASAN PEMBINA LEMBAGA PENDIDIKAN',
    'PERSATUAN GURU REPUBLIK INDONESIA (YLP-PGRI) KABUPATEN CIAMIS',
    'SEKOLAH MENENGAH KEJURUAN PGRI CIKONENG',
    'NPSN: 20211525 TERAKREDITASI: A',
    'Jalan Raya Cikoneng No.144 Telp./Fax.:(0265)773258 e-mail:smkpgrickn@yahoo.co.id Cikoneng-Ciamis'].join('\n'),
  kop_format: JSON.stringify([{ size: 11 }, { size: 11 }, { size: 15, bold: true }, { size: 11, bold: true }, { size: 9 }]),
  kop_logo_w: 100, kop_logo_h: 100, kop_tinggi_logo: 100,
  logo: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#0f766e"/><circle cx="75" cy="50" r="34" fill="#f59e0b"/></svg>').toString('base64'),
  sekolah_nama: 'SMK PGRI CIKONENG', kepala_nama: 'Agung Hermawan, S.Pd.', kepala_nip: '-',
  jadwal_kepala_nama: 'Agung Hermawan, S.Pd.', jadwal_wakasek_nama: 'M. Faizal Adha, S.Pd.',
  jadwal_wakasek_jabatan: 'Wakasek Kurikulum', jadwal_pengawas_nama: 'IKA JULIANTININGSIH, S.Pd., M.Pd.',
  print_tempat: 'Cikoneng'
};

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
    const KODE = (pub.body.rows || [])[0].kode;
    await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    await req('/api/settings/save', { method: 'POST', body: { data: KOP } });
    const ta = await req('/api/tahun');
    const taId = (ta.body.rows || [])[0].id;
    /* setelan warna kategori seperti data live */
    await req('/api/kalender-akademik/pengaturan', {
      method: 'POST',
      body: {
        semester: { ganjil: { mulai: '2026-07-01', selesai: '2026-12-31' }, genap: { mulai: '2027-01-01', selesai: '2027-06-30' } },
        warna: {
          libur: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
          ujian: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
          kegiatan: { bg: '#E0F2FE', text: '#075985', border: '#7DD3FC' }
        },
        pengawas_nama: 'IKA JULIANTININGSIH, S.Pd., M.Pd.'
      }
    });
    for (const [tgl, kat, judul, warna, non] of [
      ['2026-07-01', 'libur', 'Hari Libur Nasional', '#ff0000', 1],
      ['2026-07-02', 'libur', 'Hari Libur Nasional', '', 1],
      ['2026-08-25', 'kegiatan', 'Kegiatan Semaja ulang tahun', '#66ff00', 1],
      ['2026-08-28', 'ujian', 'pas', '', 1],
      ['2026-12-20', 'libur', 'Libur Semester Ganjil', '', 1],
      ['2027-03-10', 'ujian', 'PAS Genap', '', 1]
    ]) {
      await req('/api/kalender-akademik/save', { method: 'POST', body: { tanggal: tgl, kategori: kat, judul, warna, nonaktif: non, ta: taId } });
    }

    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 }, deviceScaleFactor: 1.3 });
    await ctx.addCookies(cookie.split('; ').map(c => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE }; }));
    const page = await ctx.newPage();
    /* tampilan web (menu kalender akademik) */
    await page.goto(BASE + '/#/kalender_akademik', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, 'web.png'), fullPage: false });
    const web = await page.evaluate(() => {
      const box = document.querySelector('[data-bulan]');
      const sel = [...box.querySelectorAll('[data-day]')].filter(b => b.getAttribute('style'));
      const cs = getComputedStyle(box);
      const first = sel[0] && getComputedStyle(sel[0]);
      return {
        radius: cs.borderRadius, bg: cs.backgroundColor,
        cellRadius: first && first.borderRadius, cellFont: first && first.fontSize,
        cells: sel.map(b => ({ t: b.textContent.trim(), bg: b.style.background || b.style.backgroundColor, style: b.getAttribute('style') })).slice(0, 4),
        head: box.querySelector('p') && box.querySelector('p').textContent.trim()
      };
    });
    /* cetak: satu tahun (portrait) & per semester */
    const cetak = async (q, nama) => {
      await page.goto(BASE + '/api/kalender-akademik/cetak?' + q + '&ta=' + taId, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, nama + '.png'), fullPage: true });
      const info = await page.evaluate(() => {
        const box = document.querySelector('.kal-box');
        const sel = [...box.querySelectorAll('.kdd.ada')];
        const cs = getComputedStyle(box);
        const c1 = sel[0] && getComputedStyle(sel[0]);
        return {
          radius: cs.borderRadius, bg: cs.backgroundColor, cellRadius: c1 && c1.borderRadius,
          cellFont: c1 && c1.fontSize, font: getComputedStyle(document.querySelector('.kal-box')).fontFamily,
          cells: sel.map(b => ({ t: b.textContent.trim(), bg: b.style.background, color: b.style.color })).slice(0, 4),
          head: box.querySelector('.kal-head')?.textContent.replace(/\s+/g, ' ').trim()
        };
      });
      console.log('\n=== ' + nama + ' ===\n' + JSON.stringify(info, null, 1));
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(OUT, nama + '.pdf'), format: 'A4', landscape: /landscape/.test(q), printBackground: true });
      await page.emulateMedia({ media: 'screen' });
    };
    console.log('\n=== WEB ===\n' + JSON.stringify(web, null, 1));
    await cetak('cakupan=tahun&orient=portrait', 'tahun-portrait');
    await cetak('cakupan=semester&orient=landscape', 'semester-landscape');
    await page.close();
  } catch (e) { console.error(e); }
  finally {
    if (browser) await browser.close().catch(() => { });
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { }
    try { fs.unlinkSync(SAAS); } catch (e) { }
  }
})();
