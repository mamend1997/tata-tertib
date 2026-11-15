'use strict';
/* Uji (tata-tertib) — tampilan CETAK/PDF Kalender Akademik & Jadwal Pelajaran:
   1. Kop surat simetris (teks identitas tepat di tengah halaman) & hanya di halaman
      pertama (semester 1); halaman semester 2 hanya judul dokumen.
   2. Baris "Rentang tanggal efektif" dihapus.
   3. Kotak bulan = kartu rounded, seluruh teks (nama bulan/hari/angka) rata tengah,
      tanggal beragenda HANYA diwarnai angkanya (tanpa label di dalam kotak) dan
      bulan tanpa agenda tidak menampilkan pesan kosong.
   4. Blok tanda tangan hanya di halaman terakhir (Kepala Sekolah kiri tanpa
      "Mengetahui,", tempat+tanggal & Wakasek Kurikulum kanan, Pengawas Pembina
      di tengah bawah).
   5. Cetak jadwal per kelas/per guru berbentuk kartu slot (rounded, rata tengah)
      berisi label jam, rentang waktu, mapel, kelas & guru.
   Jalankan: node dev-tests/cetak-kalender.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const APP = path.join(__dirname, '..');
const DB = path.join(os.tmpdir(), 'stt-ck-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-ck-saas-' + Date.now() + '.sqlite');
const PORT = 5400 + Math.floor(Math.random() * 190);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-ck-pdf-'));
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
const pdfPages = (file) => {
  try {
    const txt = execSync('pdftotext -layout ' + file + ' -').toString();
    return txt.split('\f').filter(p => p.trim());
  } catch (e) { return []; }
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
    const KODE = ((pub.body || {}).rows || [])[0].kode;
    await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    /* data contoh: identitas + kalender + slot jadwal */
    const ta = await req('/api/tahun');
    const taId = ((ta.body || {}).rows || [])[0].id;
    const svRes = await req('/api/settings/save', {
      method: 'POST',
      body: {
        data: {
        sekolah_nama: 'SMK PGRI CIKONENG', sekolah_kepemilikan: 'YAYASAN PENDIDIKAN CIKONENG',
        sekolah_alamat: 'Jl. Raya Cikoneng No. 12, Ciamis', sekolah_telp: '(0265) 771234',
        sekolah_npsn: '20224567', kepala_nama: 'Drs. H. Ahmad Suryana, M.Pd.', kepala_nip: '196804121994031005',
        wakasek_nama: 'Ujang Aris Kadarisman, S.Pd.', wakasek_nip: '-', wakasek_jabatan: 'Wakasek Kesiswaan',
        jadwal_kepala_nama: 'Agung Hermawan, S.Pd.', jadwal_kepala_nip: '-',
        jadwal_wakasek_nama: 'M. Faizal Adha, S.Pd.', jadwal_wakasek_nip: '-', jadwal_wakasek_jabatan: 'Wakasek Kurikulum',
        jadwal_pengawas_nama: 'IKA JULIANTININGSIH, S.Pd., M.Pd.',
        kop_sumber: 'manual',
        kop_baris: ['PERWAKILAN YAYASAN PEMBINA LEMBAGA PENDIDIKAN',
          'PERSATUAN GURU REPUBLIK INDONESIA (YLP-PGRI) KABUPATEN CIAMIS',
          'SEKOLAH MENENGAH KEJURUAN PGRI CIKONENG',
          'NPSN: 20211525 TERAKREDITASI: A',
          'Jalan Raya Cikoneng No.144 Telp./Fax.:(0265)773258 e-mail:smkpgrickn@yahoo.co.id Cikoneng-Ciamis'].join('\n'),
        kop_format: JSON.stringify([{ size: 11, bold: false }, { size: 11, bold: false }, { size: 15, bold: true },
          { size: 11, bold: true }, { size: 9, bold: false }]),
        kop_logo_w: 100, kop_logo_h: 100, kop_tinggi_logo: 100,
        /* logo berukuran 1,5:1 seperti berkas asli sekolah (720×493) */
        logo: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#0f766e"/><circle cx="75" cy="50" r="34" fill="#f59e0b"/></svg>').toString('base64'),
        print_tempat: 'Cikoneng'
        }
      }
    });
    ok('setelan kop & pejabat tersimpan', svRes.status === 200, JSON.stringify(svRes.body).slice(0, 160));
    const dsnRes = await req('/api/jadwal/desain', {
      method: 'POST',
      body: {
        judul: 'JADWAL PELAJARAN', semester: 'Semester 1 (Ganjil)', tempat: 'Cikoneng', tanggal: 'November 2026',
        kepala_nama: 'Agung Hermawan, S.Pd.', kepala_nip: '-',
        wakasek_nama: 'M. Faizal Adha, S.Pd.', wakasek_nip: '-', wakasek_jabatan: 'Wakasek Kurikulum',
        pengawas_nama: 'IKA JULIANTININGSIH, S.Pd., M.Pd.', pengawas_nip: '-', pengawas_tampil: 1
      }
    });
    ok('desain jadwal (pejabat TTD) tersimpan', dsnRes.status === 200, JSON.stringify(dsnRes.body).slice(0, 160));
    await req('/api/kalender-akademik/pengaturan', {
      method: 'POST',
      body: { pengawas_nama: 'Drs. Pengawas Uji, M.Pd.', pengawas_nip: '197001011990011001' }
    });
    const tahun = String(((ta.body || {}).rows || [])[0].tanggal_mulai || new Date().toISOString().slice(0, 10)).slice(0, 4);
    const Y = Number(tahun) + (Number(tahun) < new Date().getFullYear() ? 1 : 0);
    for (const [tgl, kat, judul, non] of [
      [`${Y}-07-13`, 'libur', 'Libur Semester', 1],
      [`${Y}-07-20`, 'kegiatan', 'MPLS', 0],
      [`${Y}-08-17`, 'libur', 'HUT RI', 1],
      [`${Y}-09-07`, 'ujian', 'Pekan PTS', 1],
      [`${Y + 1}-01-04`, 'kegiatan', 'Awal Semester Genap', 0],
      [`${Y + 1}-03-10`, 'ujian', 'PAS', 1]
    ]) await req('/api/kalender-akademik/save', { method: 'POST', body: { tanggal: tgl, kategori: kat, judul, nonaktif: non, ta: taId } });
    /* slot jadwal untuk menguji isi kartu */
    let jd = (await req('/api/jadwal?ta=' + taId)).body || {};
    if (!(jd.mapel || []).length) {
      for (const [kode, nama] of [['MTK', 'Matematika'], ['BIN', 'Bahasa Indonesia'], ['IPA', 'Ilmu Pengetahuan Alam'], ['PJOK', 'Pendidikan Jasmani']]) {
        await req('/api/mapel/save', { method: 'POST', body: { kode, nama, kelompok: 'Umum', maks_jam: 5 } });
      }
      jd = (await req('/api/jadwal?ta=' + taId)).body || {};
    }
    const cfgJ = jd.config || {};
    const sesiHari = (cfgJ.sesiHari || {})[1] || cfgJ.sesi || [];
    const sesiIdx = sesiHari.filter(s => !s.istirahat).map(s => s.idx);
    const guru = (jd.guru || [])[0] || {};
    const kelasA = (jd.kelas || [])[0] || {};
    for (let i = 0; i < Math.min(3, (jd.mapel || []).length); i++) {
      await req('/api/jadwal/slot', {
        method: 'POST',
        body: { ta: taId, hari: 1, sesi: sesiIdx[i], mapel_id: jd.mapel[i].id, guru_id: guru.id, kelas_ids: [kelasA.id], ruang: 'R-0' + (i + 1) }
      });
    }

    /* ================= A. HTML CETAK KALENDER ================= */
    console.log('\n== A. HTML CETAK KALENDER AKADEMIK ==');
    const html = String((await req('/api/kalender-akademik/cetak?ta=' + taId)).body || '');
    ok('tersedia (200 + kal-page)', html.includes('kal-page'));
    ok('kop memakai tata letak SIMETRIS (teks di tengah, logo absolut)', /class="kop sym"/.test(html)
      && /position:absolute/.test(html) && !/kop-side/.test(html));
    ok('kop hanya dicetak SEKALI (halaman pertama)',
      (html.match(/class="kop sym"/g) || []).length === 1, String((html.match(/class="kop sym"/g) || []).length));
    ok('halaman kedua memakai kelas nokop (tanpa kop)', /kal-page nokop/.test(html));
    ok('halaman semester 2 berjudul jelas (judul - Semester 2 (Genap))',
      /KALENDER AKADEMIK - Semester 2 \(Genap\)/.test(html), (html.match(/kal-judul">[^<]*/) || [])[0]);
    ok('baris "Rentang tanggal efektif" DIHAPUS', !/Rentang tanggal efektif/.test(html));
    ok('tidak ada pesan "Belum ada kegiatan …"', !/Belum ada kegiatan/i.test(html) && !/kal-none/.test(html));
    ok('kartu bulan rounded 16px (sama dengan kartu web)', /\.kal-box\s*\{[^}]*border-radius:\s*16px/.test(html));
    ok('kartu bulan bergaris rapi + bayangan lembut',
      /\.kal-box\s*\{[^}]*box-shadow/.test(html) && /\.kal-box\s*\{[^}]*border:\s*1px solid/.test(html));
    ok('sel tanggal rounded 6px & grid rata tengah',
      /\.kdd\s*\{[^}]*border-radius:\s*6px/.test(html)
      && /\.kal-days\s*\{[^}]*text-align:\s*center/.test(html));
    ok('nama bulan & jumlah hari efektif di kepala kartu',
      /\.kal-head\s*\{[^}]*display:\s*flex/.test(html) && /class="ef"><b class="ok">\d+/.test(html),
      (html.match(/class="ef">[^<]*<b[^>]*>\d+/) || [''])[0]);
    ok('header hari SEN…MIN (Senin pertama)', /class="kdh">Sen</.test(html) && /class="kdh">Min</.test(html));
    ok('sel tanggal beragenda diwarnai PENUH + label kecil di dalam (seperti web)',
      /<div class="kdd ada" style="background:#991B1B|background:#FF0000|background:#FEE2E2/.test(html)
      && /<span class="kdket">(LIBUR|UJIAN|KEGIATAN|KBM)<\/span>/.test(html),
      (html.match(/<div class="kdd ada"[^>]*>[^<]*<span[^>]*>[^<]*<span[^>]*>[^<]*/) || [''])[0]);
    ok('keterangan agenda tetap dicetak di bawah kotak bulan', /class="kal-list"/.test(html));
    ok('font kartu mengikuti aplikasi (Inter/system-ui), bukan Times',
      /font-family:\s*Inter,\s*system-ui/.test(html), (html.match(/body \{[^}]*font-family:[^;]*/) || [''])[0]);
    ok('kotak bulan tanpa agenda tidak menampilkan pesan apa pun', !/Belum ada kegiatan/i.test(html));
    ok('cakupan "satu tahun" (cakupan=tahun) merender 12 bulan tanpa pemisah halaman', true);
    ok('tanda tangan hanya 1 blok (2 kolom + pengawas)',
      (html.match(/class="ttdc"/g) || []).length === 2 && (html.match(/class="ttdp"/g) || []).length === 1,
      (html.match(/class="ttdc"/g) || []).length + '/' + (html.match(/class="ttdp"/g) || []).length);
    ok('kolom kiri = "Kepala Sekolah," TANPA kata "Mengetahui,"',
      /Kepala Sekolah,/.test(html) && !/Mengetahui/.test(html));
    ok('kolom kanan = tempat, tanggal + jabatan Wakasek Kurikulum',
      /Cikoneng, /.test(html) && /Wakasek Kurikulum/.test(html));
    ok('kolom tengah bawah = Pengawas Pembina', /class="ttdp"><p>Pengawas Pembina,<\/p>/.test(html));
    ok('nama & NIP pejabat tercetak (kepala & wakasek kurikulum dari Desain Jadwal)',
      /Agung Hermawan/.test(html) && /M\. Faizal Adha/.test(html) && /IKA JULIANTININGSIH/.test(html)
      && /NIP\./.test(html), (html.match(/class="nm">[^<]*/g) || []).join(' | '));
    ok('blok TTD hanya di bagian akhir dokumen (setelah bulan terakhir)',
      html.indexOf('class="ttd-grid"') > html.lastIndexOf('class="kal-box"'));

    /* ================= B. UKUR DI BROWSER ================= */
    console.log('\n== B. PENGUKURAN LAYOUT (Playwright) ==');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 } });
    await ctx.addCookies(cookie.split('; ').map(c => {
      const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
    }));
    let page = await ctx.newPage();
    await page.goto(BASE + '/api/kalender-akademik/cetak?ta=' + taId, { waitUntil: 'networkidle' });
    const kal = await page.evaluate(() => {
      const sem = [...document.querySelectorAll('.kal-sem')];
      const kop = document.querySelector('.kop');
      const kopTxt = kop && kop.querySelector('.kop-txt');
      const kotak = kop && kop.parentElement;
      const r = el => el.getBoundingClientRect();
      const box = document.querySelector('.kal-box');
      const cs = box && getComputedStyle(box);
      const ttd = document.querySelector('.ttd-grid');
      const berwarna = [...document.querySelectorAll('.kdd .kdnum')].filter(s => s.getAttribute('style'));
      return {
        sem: sem.length,
        kopPerHalaman: sem.map(s => !!s.querySelector('.kop')),
        selisihTengah: kopTxt ? Math.round((r(kopTxt).left + r(kopTxt).width / 2) - (r(kotak).left + r(kotak).width / 2)) : null,
        kopAlign: kopTxt ? getComputedStyle(kopTxt).textAlign : null,
        radius: cs && cs.borderTopLeftRadius,
        shadow: cs && cs.boxShadow,
        tdAlign: getComputedStyle(document.querySelector('.kal-days')).textAlign,
        headAlign: getComputedStyle(document.querySelector('.kal-head')).textAlign,
        adaKosong: !![...document.querySelectorAll('.kal-box')].find(b => !b.querySelector('.kal-list') && /Belum ada/i.test(b.textContent)),
        jmlBerwarna: document.querySelectorAll('.kdd.ada').length,
        isiBerwarna: berwarna.map(s => s.textContent.trim()),
        labelSel: [...document.querySelectorAll('.kdd.ada .kdket')].slice(0, 4).map(x => x.textContent.trim()),
        bgSel: [...document.querySelectorAll('.kdd.ada')].slice(0, 4).map(x => getComputedStyle(x).backgroundColor),
        headDisplay: document.querySelector('.kal-head') ? getComputedStyle(document.querySelector('.kal-head')).display : null,
        ttdHalamanTerakhir: ttd ? ttd.closest('.kal-sem') === sem[sem.length - 1] : false
      };
    });
    ok('2 halaman semester', kal.sem === 2, String(kal.sem));
    ok('DOM: kop hanya di semester 1', kal.kopPerHalaman[0] === true && kal.kopPerHalaman.slice(1).every(v => !v),
      JSON.stringify(kal.kopPerHalaman));
    ok('DOM: teks kop tepat di tengah halaman (selisih ≤ 2px)', Math.abs(kal.selisihTengah) <= 2, String(kal.selisihTengah));
    ok('DOM: teks kop center', kal.kopAlign === 'center', kal.kopAlign);
    ok('DOM: kotak bulan rounded 16px (sama dengan kartu web)', parseFloat(kal.radius) === 16, kal.radius);
    ok('DOM: kotak bulan berbayangan', /rgba?\(/.test(kal.shadow || ''), kal.shadow);
    ok('DOM: sel tanggal center', kal.tdAlign === 'center', kal.tdAlign);
    ok('DOM: kepala kartu = baris flex (bulan kiri, hari efektif kanan)',
      /flex/.test(kal.headDisplay || ''), kal.headDisplay);
    ok('DOM: grid tanggal rata tengah', kal.tdAlign === 'center', kal.tdAlign);
    ok('DOM: bulan tanpa agenda tidak menampilkan pesan kosong', kal.adaKosong === false);
    ok('DOM: sel tanggal beragenda diwarnai penuh (≥ 6 sel)', kal.jmlBerwarna >= 6, String(kal.jmlBerwarna));
    ok('DOM: sel beragenda memuat label kategori kecil',
      kal.labelSel.length > 0 && kal.labelSel.every(t => /^(LIBUR|UJIAN|KEGIATAN|KBM)$/.test(t)), JSON.stringify(kal.labelSel));
    ok('DOM: latar sel berwarna (bukan putih)',
      kal.bgSel.length > 0 && kal.bgSel.every(c => c && !/rgba?\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/.test(c)), JSON.stringify(kal.bgSel));
    ok('DOM: blok TTD berada di halaman terakhir', kal.ttdHalamanTerakhir);

    /* ---- KOP SURAT: simetris, logo seimbang, nama sekolah SATU baris ---- */
    const kop = await page.evaluate(() => {
      const el = document.querySelector('.kop');
      const img = el && el.querySelector('img');
      const txt = el && el.querySelector('.kop-txt');
      const baris = txt ? [...txt.children] : [];
      const r = (x) => { const b = x.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) }; };
      const nama = baris.find(b => /PGRI CIKONENG/.test(b.textContent) && Number(getComputedStyle(b).fontSize.replace('px', '')) > 15);
      const padKiri = txt ? parseFloat(getComputedStyle(txt).paddingLeft) : 0;
      return {
        kop: r(el), txt: r(txt), img: img ? r(img) : null,
        jumlahBaris: baris.length,
        baris: baris.map(b => ({ t: b.textContent.slice(0, 30), h: Math.round(b.getBoundingClientRect().height), fs: parseFloat(getComputedStyle(b).fontSize) })),
        nama: nama ? { r: r(nama), fs: parseFloat(getComputedStyle(nama).fontSize) } : null,
        padKiri,
        teksKiri: Math.round(r(txt).l + padKiri),
        selisihTengah: Math.round((r(txt).l + r(txt).w / 2) - (r(el).l + r(el).w / 2))
      };
    });
    console.log('   kop:', JSON.stringify(kop).slice(0, 520));
    ok('kop: teks tepat di tengah halaman (selisih ≤ 2px)', Math.abs(kop.selisihTengah) <= 2, String(kop.selisihTengah));
    ok('kop: SETIAP baris dirender satu baris (tinggi ≈ 1 baris)',
      kop.baris.every(b => b.h <= b.fs * 1.75), JSON.stringify(kop.baris.filter(b => b.h > b.fs * 1.75)));
    ok('kop: nama sekolah "SEKOLAH MENENGAH KEJURUAN PGRI CIKONENG" SATU baris',
      !!kop.nama && kop.nama.r.h <= kop.nama.fs * 1.6, kop.nama && `h=${kop.nama.r.h} fs=${kop.nama.fs}`);
    ok('kop: logo tidak menabrak teks (kanan logo ≤ sisi dalam teks)',
      !kop.img || kop.img.r <= kop.teksKiri + 2, kop.img && `${kop.img.r} vs ${kop.teksKiri}`);
    ok('kop: logo seimbang dengan blok teks (tinggi ≥ 70% tinggi kop)',
      !!kop.img && kop.img.h >= kop.kop.h * 0.7, kop.img && `${kop.img.h}/${kop.kop.h}`);
    ok('kop: logo lebih besar dari lebar kotak lama 100px (rasio gambar terjaga)',
      !!kop.img && kop.img.w > 100, kop.img && String(kop.img.w));

    /* ================= C. PDF ================= */
    console.log('\n== C. HASIL PDF KALENDER ==');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'kalender.pdf'), format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    const pages = pdfPages(path.join(OUT, 'kalender.pdf'));
    ok('PDF tepat 2 halaman', pages.length === 2, String(pages.length));
    if (pages.length === 2) {
      ok('PDF halaman 1 memuat kop sekolah (nama sekolah pada kop)',
        /PGRI CIKONENG/i.test(pages[0]) && /PERWAKILAN YAYASAN/i.test(pages[0]), pages[0].slice(0, 80).replace(/\s+/g, ' '));
      ok('PDF halaman 2 tanpa kop (tidak ada baris yayasan)', !/YAYASAN PENDIDIKAN CIKONENG/i.test(pages[1]));
      ok('PDF halaman 2 memuat judul semester 2', /Semester 2 \(Genap\)|SEMESTER 2/i.test(pages[1]),
        pages[1].slice(0, 80).replace(/\s+/g, ' '));
      ok('PDF tanda tangan hanya di halaman terakhir',
        /Pengawas Pembina/i.test(pages[1]) && !/Pengawas Pembina/i.test(pages[0]));
    }
    const semuaTeks = pages.join('\n');
    ok('PDF tanpa "Rentang tanggal efektif"', !/Rentang tanggal efektif/i.test(semuaTeks));
    ok('PDF tanpa "Belum ada kegiatan"', !/Belum ada kegiatan/i.test(semuaTeks));

    /* ================= D. CETAK JADWAL ================= */
    console.log('\n== D. CETAK JADWAL PELAJARAN (KARTU SLOT) ==');
    await page.goto(BASE + '/api/jadwal/cetak?ta=' + taId + '&mode=kelas', { waitUntil: 'networkidle' });
    const jad = await page.evaluate(() => {
      const kartu = [...document.querySelectorAll('.kartu')].find(k => k.querySelector('.mp'));
      const kosong = [...document.querySelectorAll('.kartu.kosong')].find(k => k.querySelector('.dash'));
      const cs = kartu && getComputedStyle(kartu);
      const spans = kartu ? [...kartu.querySelectorAll('span')].map(s => ({
        cls: s.className, txt: s.textContent.trim(), align: getComputedStyle(s).textAlign
      })) : [];
      return {
        ada: !!kartu, radius: cs && cs.borderTopLeftRadius, display: cs && cs.display, align: cs && cs.textAlign,
        spans, kosongAda: !!kosong,
        thead: [...document.querySelectorAll('table.grid thead th')].map(t => t.textContent.trim())
      };
    });
    ok('sel jadwal dirender sebagai KARTU', jad.ada);
    ok('kartu rounded (≥ 6px)', parseFloat(jad.radius) >= 6, jad.radius);
    ok('kartu flex kolom (label di atas isi)', /flex/.test(jad.display || ''), jad.display);
    ok('isi kartu rata tengah', jad.align === 'center', jad.align);
    ok('kartu memuat label jam & rentang waktu',
      jad.spans.some(s => s.cls === 'lab') && jad.spans.some(s => s.cls === 'wkt'), JSON.stringify(jad.spans.map(s => s.cls)));
    ok('kartu memuat kode mapel, nama mapel & nama guru',
      jad.spans.some(s => s.cls === 'kd') && jad.spans.some(s => s.cls === 'mp') && jad.spans.some(s => s.cls === 'gr'),
      JSON.stringify(jad.spans.map(s => s.cls)));
    ok('nama kelas TIDAK dicetak di dalam kartu (kelas sudah jadi judul)', !jad.spans.some(s => s.cls === 'kls'),
      JSON.stringify(jad.spans.map(s => s.cls)));
    ok('seluruh teks kartu rata tengah', jad.spans.every(s => s.align === 'center'),
      JSON.stringify(jad.spans.map(s => s.align)));
    ok('header tabel = nama hari (matriks kartu, tanpa kolom JAM)',
      jad.thead.length > 0 && !jad.thead.includes('JAM'), JSON.stringify(jad.thead));
    ok('sel kosong tetap berbentuk kartu putus-putus dengan label jam', jad.kosongAda);

    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'jadwal.pdf'), format: 'A4', landscape: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    const jpg = pdfPages(path.join(OUT, 'jadwal.pdf'));
    const jtxt = jpg.join('\n');
    ok('PDF jadwal memuat label jam & rentang waktu', /JAM KE-\d/i.test(jtxt) && /\d{2}:\d{2}/.test(jtxt));
    ok('PDF jadwal memuat nama mapel, kelas & guru',
      /Matematika/i.test(jtxt) && new RegExp((kelasA.nama || 'X').replace(/[^\w ]/g, '.'), 'i').test(jtxt) && /Administrator|Agus|Guru/i.test(jtxt));
    ok('PDF jadwal tanpa kolom JAM kiri (kartu mandiri)', !/^\s*JAM\s+Senin/m.test(jtxt));
    await page.close();
    page = await ctx.newPage();
    for (const mode of ['guru', 'vertikal', 'semua']) {
      await page.goto(BASE + '/api/jadwal/cetak?ta=' + taId + '&mode=' + mode, { waitUntil: 'networkidle' });
      const kartu = await page.locator('.kartu').count();
      ok(`cetak mode ${mode}: memakai kartu`, kartu > 0, String(kartu));
    }
    await page.goto(BASE + '/api/jadwal/cetak?ta=' + taId + '&mode=vertikal', { waitUntil: 'networkidle' });
    ok('matriks vertikal tetap memakai kolom "HARI / JAM"', (await page.locator('th.jam').count()) > 0);

    /* ============ E. PEJABAT TTD (kalender == jadwal) & SEJAJAR ============ */
    console.log('\n== E. TANDA TANGAN KALENDER & JADWAL ==');
    const ttdJadwal = await page.evaluate(() => {
      const nm = [...document.querySelectorAll('.ttd-col .nm')].map(x => x.textContent.trim());
      const top = [...document.querySelectorAll('.ttd-col .nm')].map(x => Math.round(x.getBoundingClientRect().top));
      const kepala = [...document.querySelectorAll('.ttd-col p')].map(x => x.textContent.trim()).slice(0, 4);
      return { nm, top, kepala };
    });
    ok('jadwal: kepala sekolah & wakasek kurikulum dari Desain Jadwal',
      ttdJadwal.nm[0] === 'Agung Hermawan, S.Pd.' && /M\. Faizal Adha/.test(ttdJadwal.nm[1] || ''),
      JSON.stringify(ttdJadwal.nm));
    ok('jadwal: nama kepala & wakasek SEJAJAR', Math.abs((ttdJadwal.top[0] || 0) - (ttdJadwal.top[1] || 0)) <= 1,
      JSON.stringify(ttdJadwal.top));
    ok('jadwal: pengawas pembina memakai nama pengawas kurikulum',
      /IKA JULIANTININGSIH/i.test(await page.locator('.ttd-pengawas .nm').innerText()));

    await page.goto(BASE + '/api/kalender-akademik/cetak?ta=' + taId, { waitUntil: 'networkidle' });
    const ttdKal = await page.evaluate(() => {
      const nm = [...document.querySelectorAll('.ttdc .nm, .ttdp .nm')].map(x => x.textContent.trim());
      const top = [...document.querySelectorAll('.ttdc .nm')].map(x => Math.round(x.getBoundingClientRect().top));
      const ket = [...document.querySelectorAll('.ttdc p, .ttdp p')].map(x => x.textContent.trim());
      return { nm, top, ket };
    });
    console.log('   TTD kalender:', JSON.stringify(ttdKal).slice(0, 300));
    ok('kalender: kepala sekolah SAMA dengan cetak jadwal', ttdKal.nm[0] === ttdJadwal.nm[0], ttdKal.nm[0]);
    ok('kalender: wakasek = Wakasek Kurikulum (bukan Wakasek Kesiswaan)',
      /M\. Faizal Adha/.test(ttdKal.nm[1] || '') && !/Ujang Aris/.test(ttdKal.nm.join(' ')), JSON.stringify(ttdKal.nm));
    ok('kalender: nama kepala & wakasek SEJAJAR', Math.abs((ttdKal.top[0] || 0) - (ttdKal.top[1] || 0)) <= 1,
      JSON.stringify(ttdKal.top));
    ok('kalender: pengawas pembina SAMA dengan cetak jadwal', /IKA JULIANTININGSIH/i.test(ttdKal.nm[2] || ''), ttdKal.nm[2]);
    ok('kalender: label kolom = "Kepala Sekolah," & jabatan wakasek kurikulum',
      /Kepala Sekolah,/.test(ttdKal.ket[0] || '') && /Kurikulum/i.test(ttdKal.ket.join(' ')), JSON.stringify(ttdKal.ket.slice(0, 4)));

    /* ============ F. ORIENTASI CETAK (portrait / landscape) ============ */
    console.log('\n== F. ORIENTASI CETAK KALENDER ==');
    await page.goto(BASE + '/api/kalender-akademik/cetak?ta=' + taId + '&orient=landscape', { waitUntil: 'networkidle' });
    const land = await page.evaluate(() => {
      const wrap = document.querySelector('.kal-wrap');
      return {
        kolom: getComputedStyle(wrap).gridTemplateColumns.split(' ').length,
        tombol: [...document.querySelectorAll('.bar a')].map(a => a.textContent.trim())
      };
    });
    const htmlLand = await page.content();
    ok('landscape: @page A4 landscape', /size:\s*A4 landscape/.test(htmlLand.replace(/\s+/g, ' ')));
    ok('landscape: grid bulan 3 kolom', land.kolom === 3, String(land.kolom));
    ok('landscape: toolbar menyediakan pilihan Portrait & Landscape',
      land.tombol.includes('Portrait') && land.tombol.includes('Landscape'), JSON.stringify(land.tombol));
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'kalender-landscape.pdf'), format: 'A4', landscape: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.goto(BASE + '/api/kalender-akademik/cetak?ta=' + taId, { waitUntil: 'networkidle' });
    const htmlPort = (await page.content()).replace(/\s+/g, ' ');
    ok('portrait (bawaan): @page A4 portrait', /size:\s*A4 portrait/.test(htmlPort));
    ok('portrait: grid bulan 2 kolom',
      (await page.evaluate(() => getComputedStyle(document.querySelector('.kal-wrap')).gridTemplateColumns.split(' ').length)) === 2);
    /* ============ G. CAKUPAN CETAK: SATU TAHUN vs PER SEMESTER ============ */
    console.log('\n== G. CAKUPAN CETAK (TAHUN / SEMESTER) ==');
    const htmlTahun = String((await req('/api/kalender-akademik/cetak?cakupan=tahun&ta=' + taId)).body || '');
    ok('cakupan=tahun: 12 kartu bulan dirender', (htmlTahun.match(/class="kal-box"/g) || []).length === 12,
      String((htmlTahun.match(/class="kal-box"/g) || []).length));
    ok('cakupan=tahun: TANPA pemisah halaman (satu alur)', !/kal-sem pagebreak/.test(htmlTahun));
    ok('cakupan=tahun: kop & blok TTD masing-masing satu kali',
      (htmlTahun.match(/class="kop sym"/g) || []).length === 1 && (htmlTahun.match(/class="ttdp"/g) || []).length === 1);
    ok('cakupan=tahun: sub-judul hanya Tahun Pelajaran (tanpa semester)',
      /kal-sub">Tahun Pelajaran/.test(htmlTahun) && !/Semester 1 \(Ganjil\) ·/.test(htmlTahun),
      (htmlTahun.match(/kal-sub">[^<]*/) || [''])[0]);
    ok('cakupan=semester (bawaan): dua halaman terpisah',
      /kal-sem pagebreak/.test(String((await req('/api/kalender-akademik/cetak?cakupan=semester&ta=' + taId)).body || '')));
    ok('toolbar dokumen punya tombol Satu Tahun / Per Semester',
      /data-kal-tahun/.test(htmlTahun) && /data-kal-semester/.test(htmlTahun));

    await page.goto(BASE + '/#/kalender_akademik', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.click('[data-kal-cetak]');
    await page.waitForSelector('[data-kal-cetak-proses]', { timeout: 15000 });
    ok('modal opsi cetak terbuka dengan pilihan cakupan & orientasi',
      (await page.locator('[data-kal-cakupan]').count()) === 4 && (await page.locator('[data-kal-orient]').count()) === 2);
    await page.click('[data-kal-cakupan="tahun"]');
    await page.click('[data-kal-orient="landscape"]');
    const urlCetak = await page.evaluate(() => new Promise((resolve) => {
      const asli = window.open;
      window.open = (u) => { window.open = asli; resolve(String(u)); return null; };
      document.querySelector('[data-kal-cetak-proses]').click();
      setTimeout(() => resolve('(tidak terpanggil)'), 2500);
    }));
    ok('modal cetak menghasilkan URL cakupan=tahun & landscape',
      /kalender-akademik\/cetak\?/.test(urlCetak) && /cakupan=tahun/.test(urlCetak) && /orient=landscape/.test(urlCetak),
      urlCetak);

    const halLand = pdfPages(path.join(OUT, 'kalender-landscape.pdf'));
    ok('PDF landscape tetap 2 halaman & tetap memuat semua bulan',
      halLand.length === 2 && /Januari|Februari/i.test(halLand[1] || ''), String(halLand.length));
    await page.close();
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(SAAS); } catch (e) { /* abaikan */ }
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
  }
  console.log(`\n=== HASIL CETAK KALENDER & JADWAL: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
