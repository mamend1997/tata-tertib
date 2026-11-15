'use strict';
/* =====================================================================
   Dokumen cetak: kop surat, rekapitulasi poin, surat panggilan / SP1-3
   ===================================================================== */
const lib = require('./lib');

const PAPER = {
  A4: { w: '210mm', h: '297mm', label: 'A4' },
  F4: { w: '215mm', h: '330mm', label: 'F4 / Legal' }
};
const SURAT_JUDUL = {
  panggilan: 'SURAT PEMANGGILAN ORANG TUA / WALI',
  sp1: 'SURAT PERINGATAN PERTAMA (SP 1)',
  sp2: 'SURAT PERINGATAN KEDUA (SP 2)',
  sp3: 'SURAT PERINGATAN KETIGA (SP 3)'
};
const SURAT_INTRO = {
  panggilan: 'Sehubungan dengan adanya catatan kedisiplinan siswa di sekolah, dengan ini kami mengharap kehadiran Bapak/Ibu orang tua/wali murid untuk membicarakan pembinaan putra/putri Bapak/Ibu.',
  sp1: 'Berdasarkan catatan kedisiplinan siswa yang telah mencapai batas peringatan pertama, dengan ini kami memberikan <b>Surat Peringatan Pertama (SP 1)</b> kepada siswa yang bersangkutan agar dapat memperbaiki perilaku dan mematuhi tata tertib sekolah.',
  sp2: 'Berdasarkan catatan kedisiplinan siswa yang kembali menembus batas peringatan, dengan ini kami memberikan <b>Surat Peringatan Kedua (SP 2)</b>. Surat ini merupakan peringatan serius dan akan diikuti tindakan pembinaan khusus.',
  sp3: 'Berdasarkan catatan kedisiplinan siswa yang telah mencapai batas maksimal, dengan ini kami memberikan <b>Surat Peringatan Ketiga (SP 3)</b>. Apabila siswa masih melakukan pelanggaran, sekolah akan menyerahkan penanganan kepada pihak yang berwenang sesuai ketentuan yang berlaku.'
};
const SURAT_PENUTUP = {
  panggilan: 'Demikian surat ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.',
  sp1: 'Demikian surat peringatan ini disampaikan untuk diperhatikan dan dilaksanakan sebagaimana mestinya.',
  sp2: 'Demikian surat peringatan ini disampaikan. Kami mohon kerja sama Bapak/Ibu untuk melakukan pembinaan di rumah.',
  sp3: 'Demikian surat peringatan ini disampaikan. Sekolah berharap siswa dapat kembali menaati tata tertib yang berlaku.'
};

const e = lib.esc;
const tglID = lib.tglID;
const stampNow = () => lib.stampID(lib.nowStamp());

/* =====================================================================
   CSS KOP SURAT BERSAMA
   ---------------------------------------------------------------------
   Satu sumber gaya untuk SEMUA dokumen cetak (surat, rekap penilaian,
   laporan BK, absensi, asesmen) supaya kop tampil SERAGAM: logo di kiri,
   teks rata tengah, dan garis ganda pembatas di bawahnya. Dipakai oleh
   doc.js sendiri DAN printdoc.js (halaman cetak laporan).
   ===================================================================== */
function kopCSS() {
  return `
  .kop { display: flex; align-items: center; gap: 14px; border-bottom: 3px double #111; padding-bottom: 8px; margin: 0 0 14px; }
  .kop img { object-fit: contain; flex: none; }
  .kop .kop-txt { flex: 1; min-width: 0; text-align: center; }
  /* kop SIMETRIS: logo dipasang absolut di tepi kiri, blok teks memakai lebar
     penuh halaman dengan perataan tengah → teks identitas tepat di TENGAH
     halaman (tidak bergeser karena logo) dan baris panjang tetap satu baris. */
  .kop.sym { display: flex; }
  .kop.sym .kop-txt { flex: 1 1 auto; }
  .kop.sym img { position: absolute; left: 0; top: 50%; transform: translateY(-50%); }
  /* teks kop dirender PERSIS seperti yang diketik pengguna — tanpa text-transform */
  .kop .kop-txt .sub { font-size: 10.5pt; letter-spacing: .2px; line-height: 1.28; }
  .kop .kop-txt .nama { font-size: 16.5pt; font-weight: 700; line-height: 1.15; margin: 1px 0; letter-spacing: .2px; }
  .kop .kop-txt .alamat { font-size: 9.5pt; line-height: 1.3; }
  `;
}

function baseCSS(paper) {
  const p = PAPER[paper] || PAPER.A4;
  return `
  @page { size: ${p.w} ${p.h}; margin: 12mm 14mm 12mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, serif; color: #111; font-size: 11.5pt; line-height: 1.38; background: #f1f5f9; }
  .sheet { background: #fff; max-width: ${p.w}; margin: 0 auto; padding: 12mm 14mm; box-shadow: 0 12px 40px rgba(15,23,42,.16); }
  ${kopCSS()}
  .kop img { width: 74px; height: 74px; }
  h2.judul { text-align: center; font-size: 13.5pt; margin: 16px 0 2px; text-decoration: underline; letter-spacing: .3px; }
  .nomor { text-align: center; font-size: 11.5pt; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  table.data th, table.data td { border: 1px solid #333; padding: 3px 5px; font-size: 9.5pt; vertical-align: top; }
  table.data th { background: #f3f4f6; text-align: center; font-weight: 700; }
  table.data td.c { text-align: center; }
  table.data td.r { text-align: right; }
  table.info td { padding: 2px 4px; font-size: 11.5pt; vertical-align: top; }
  table.info td.label { width: 130px; }
  table.info td.pemisah { width: 12px; }
  .ttd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; page-break-inside: avoid; }
  .ttd-grid.three { grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .ttd-grid.three .ttd { font-size: 10.5pt; }
  .ttd-grid.three .nama { font-size: 10.5pt; }
  .ttd { text-align: center; font-size: 11.5pt; }
  .ttd .ruang { height: 54px; }
  .ttd .nama { font-weight: 700; text-decoration: underline; }
  .ttd .nip { font-size: 10.5pt; }
  .tanggal { text-align: right; margin: 12px 0 2px; font-size: 11.5pt; }
  .note { font-size: 9.5pt; color: #444; }
  .doc-actions { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 99; }
  .doc-actions button, .doc-actions a { font-family: system-ui, sans-serif; font-size: 13px; border: 0; border-radius: 8px;
    padding: 9px 14px; background: #ea580c; color: #fff; cursor: pointer; text-decoration: none; box-shadow: 0 4px 14px rgba(234,88,12,.35); }
  .doc-actions .ghost { background: #fff; color: #334155; border: 1px solid #cbd5e1; box-shadow: none; }
  .rekap-meta { font-size: 10.5pt; margin: 0 0 10px; }
  .rekap-meta b { font-weight: 700; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .doc-actions { display: none !important; }
  }
  @media screen and (max-width: 620px) { .sheet { padding: 18px; } }
  `;
}
function shell(title, paper, body, extraCSS = '') {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<style>${baseCSS(paper)}${extraCSS}</style></head>
<body>
<div class="doc-actions">
  <button onclick="window.print()">Cetak / Simpan PDF</button>
  <a class="ghost" href="javascript:window.close()">Tutup</a>
</div>
${body}
<script>window.addEventListener('load',function(){ if(location.search.indexOf('auto=1')>=0) setTimeout(function(){window.print()},350); });</script>
</body></html>`;
}

/* =====================================================================
   KOP SURAT DINAMIS (diatur di Pengaturan → Kop Surat)
   ---------------------------------------------------------------------
   · kop_sumber        'auto'  → disusun dari Identitas Sekolah
                       'manual'→ teks bebas pada kop_baris
   · kop_baris_tambahan→ baris bebas yang SELALU ditambahkan (akreditasi, motto)
   · kop_format        → JSON [{size,bold}] ukuran & tebal per baris
   · kop_posisi        → posisi logo (kiri/tengah/kanan)
   · kop_rapat         → perataan teks kop
   · kop_logo          → logo kop terpisah (fallback logo utama)
   · kop_garis         → gaya garis bawah (double/single/none)
   ===================================================================== */
function kopFormatOf(settings) {
  const raw = settings.kop_format;
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (err) { arr = []; }
  }
  return Array.isArray(arr) ? arr : [];
}
function kopLogo(settings) {
  return String(settings.kop_logo || settings.logo || settings.app_logo || '').trim();
}
function kopLines(settings) {
  const barisTambahan = String(settings.kop_baris_tambahan || '')
    .split('\n').map(x => x.trim()).filter(Boolean);
  const auto = () => {
    const list = [];
    /* Baris "SMK SWASTA NPSN …" TIDAK lagi dibuat otomatis: pengguna yang ingin
       menampilkannya cukup menuliskannya di "Teks Bebas Tambahan" (kop_baris_tambahan). */
    const kep = String(settings.sekolah_kepemilikan || '').trim();
    if (kep) list.push({ teks: kep, jenis: 'sub' });
    list.push({ teks: String(settings.sekolah_nama || '-'), jenis: 'nama' });
    const kontak = [
      settings.sekolah_alamat,
      [settings.sekolah_telp ? 'Telp. ' + settings.sekolah_telp : '', settings.sekolah_email,
        String(settings.sekolah_website || '').replace(/^https?:\/\//i, '')].filter(Boolean).join(' • ')
    ].filter(Boolean).join(' — ');
    list.push({ teks: kontak, jenis: 'alamat' });
    return list;
  };
  /* Mode manual: SEMUA baris netral (tidak ada yang otomatis ditebalkan/dibesarkan)
     supaya hasil cetak persis seperti yang diketik. Gaya per baris diatur
     pengguna lewat "Ukuran Font & Tebal per Baris" (kop_format). */
  const manual = () => String(settings.kop_baris || '')
    .split('\n').map(x => x.trim()).filter(Boolean)
    .map(teks => ({ teks, jenis: 'sub' }));
  const base = String(settings.kop_sumber || 'auto') === 'manual' ? manual() : auto();
  const all = base.concat(barisTambahan.map(t => ({ teks: t, jenis: 'sub' })));
  const fmt = kopFormatOf(settings);
  return all.filter(l => String(l.teks || '').trim()).map((l, i) => {
    const o = fmt[i] || {};
    const auto = l.jenis === 'nama' ? Number(settings.kop_font_besar) || 16.5 : Number(settings.kop_font) || 10.5;
    return {
      teks: l.teks, jenis: l.jenis,
      size: Number(o.size) > 0 ? Number(o.size) : auto,
      bold: o.bold === true || Number(o.bold) === 1 || l.jenis === 'nama'
    };
  });
}
/** lebar teks (px) perkiraan untuk font Times New Roman — dipakai agar setiap
    baris kop muat SATU baris (nama sekolah tidak pecah dua baris). Nilai
    dikalibrasi terhadap lebar asli di browser (rasio ±1,0). */
const CHAR_W = (() => {
  const w = {};
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') w[c] = 0.645;
  for (const c of 'abcdefghijklmnopqrstuvwxyz') w[c] = 0.45;
  for (const c of '0123456789') w[c] = 0.45;
  for (const c of ' ') w[c] = 0.235;
  for (const c of '.,:;\'!|') w[c] = 0.235;
  for (const c of '()[]') w[c] = 0.30;
  for (const c of '-/\\') w[c] = 0.30;
  for (const c of '@%&') w[c] = 0.73;
  return w;
})();
function estWidthPx(teks, sizePt, bold) {
  let em = 0;
  for (const ch of String(teks || '')) em += CHAR_W[ch.toUpperCase()] === undefined ? 0.49 : CHAR_W[ch];
  return em * sizePt * (96 / 72) * (bold ? 1.03 : 1);
}
/** tinggi blok teks kop (px) */
function kopTextHeight(lines) {
  return lines.reduce((a, l) => a + l.size * (96 / 72) * (l.jenis === 'nama' ? 1.18 : 1.34), 0);
}
function kop(settings, opts = {}) {
  const logo = kopLogo(settings);
  const lines = kopLines(settings);
  if (!lines.length) return '';
  const posisi = String(settings.kop_posisi || 'kiri');
  const rapat = String(settings.kop_rapat || 'tengah');
  const garis = String(settings.kop_garis || 'double');
  const px = (v, def) => {
    const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.max(16, Math.min(400, Math.round(n))) : def;
  };
  const heightPx = px(settings.kop_logo_h, px(settings.kop_tinggi_logo, 74));
  const lebar = px(settings.kop_logo_w, px(settings.kop_tinggi_logo, 74));
  const border = garis === 'none' ? 'none' : garis === 'single' ? '1.5px solid #111' : '3px double #111';
  const cls = l => l.jenis === 'nama' ? 'nama' : l.jenis === 'alamat' ? 'alamat' : 'sub';

  /* ---------------- MODE SIMETRIS (kalender & jadwal) ----------------
     · blok teks memakai lebar penuh halaman, rata tengah → tepat di TENGAH;
     · logo dipasang absolut di tepi kiri dengan lebar maksimum = lebar kolom
       kosong (gutter) sehingga TIDAK menabrak teks & TIDAK menggeser teks;
     · seluruh baris kop diperkecil dengan SATU faktor yang sama bila perlu,
       supaya setiap baris (termasuk nama sekolah) tetap SATU baris dan
       proporsi ukuran antar-baris tetap sama seperti standar kop. */
  if (opts.simetris) {
    const widthPx = Number(opts.widthPx) || 700;
    const pad = Math.max(64, Math.min(220, Math.round(widthPx * 0.17)));
    const textW = Math.max(150, widthPx - pad * 2);
    const maxAsli = Math.max(...lines.map(l => estWidthPx(l.teks, l.size, l.bold)), 1);
    const skala = Math.min(1, Math.max(0.62, textW / maxAsli));
    const fits = lines.map(l => {
      const size = Math.round(l.size * skala * 10) / 10;
      return { ...l, size, nowrap: estWidthPx(l.teks, size, l.bold) <= textW * 1.02 };
    });
    const textH = kopTextHeight(fits);
    /* tinggi logo: minimal sebesar blok teks agar tidak tampak kecil */
    const tinggi = opts.balance
      ? Math.max(16, Math.min(400, Math.max(heightPx, Math.round(textH * 0.95))))
      : heightPx;
    const logoHtml = logo
      ? `<img src="${e(logo)}" alt="Logo" style="position:absolute;left:0;top:50%;transform:translateY(-50%);`
        + `height:${tinggi}px;width:auto;max-width:${pad}px;object-fit:contain">`
      : '';
    const txt = fits.map(l => `<div class="${cls(l)}" style="font-size:${l.size}pt;${l.bold ? 'font-weight:700;' : ''}`
      + `${l.jenis === 'nama' ? 'line-height:1.15;margin:1px 0;' : ''}${l.nowrap ? 'white-space:nowrap;' : ''}">${e(l.teks)}</div>`).join('');
    return `<div class="kop sym" style="position:relative;display:flex;align-items:center;justify-content:center;`
      + `min-height:${logo ? tinggi : 0}px;border-bottom:${border};padding:0 0 8px;margin:0 0 14px">
    ${logoHtml}
    <div class="kop-txt" style="width:100%;min-width:0;text-align:center;padding:0 ${pad}px">${txt}</div>
  </div>`;
  }

  /* ---------------- MODE STANDAR (surat, rekap, laporan, BK, …) ---------------- */
  const order = posisi === 'kanan' ? 'row-reverse' : posisi === 'tengah' ? 'column' : 'row';
  const align = rapat === 'kiri' ? 'flex-start' : rapat === 'kanan' ? 'flex-end' : 'center';
  const txtAlign = rapat === 'kanan' ? 'right' : rapat === 'kiri' ? 'left' : 'center';
  /* tinggi logo seimbang dengan tinggi blok teks bila `balance` diminta */
  const textHStd = kopTextHeight(lines);
  const tinggiStd = opts.balance ? Math.min(400, Math.max(heightPx, Math.round(textHStd * 0.95))) : heightPx;
  const logoStyleStd = opts.balance
    ? `height:${tinggiStd}px;width:auto;max-width:${Math.round(Math.max(lebar, tinggiStd * 2.2))}px;object-fit:contain;flex:none`
    : `width:${lebar}px;height:${tinggiStd}px;max-width:45%;object-fit:contain;flex:none`;
  const logoHtmlStd = logo ? `<img src="${e(logo)}" alt="Logo" style="${logoStyleStd}">` : '';
  /* teks dicetak apa adanya (tidak dipaksa uppercase) */
  const txtStd = lines.map(l => `<div class="${cls(l)}" style="font-size:${l.size}pt;${l.bold ? 'font-weight:700;' : ''}`
    + `${l.jenis === 'nama' ? 'line-height:1.15;margin:1px 0;' : ''}">${e(l.teks)}</div>`).join('');
  return `<div class="kop" style="flex-direction:${order};align-items:center;justify-content:${align};border-bottom:${border};padding-bottom:8px;margin-bottom:14px;gap:14px">
    ${logoHtmlStd}
    <div class="kop-txt" style="flex:1;min-width:0;text-align:${txtAlign}">${txtStd}</div>
  </div>`;
}

/** CSS kop untuk dokumen Word (HTML .doc) — tabel agar rapi di MS Word */
function kopWordCSS() {
  return `
  .kopw { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .kopw td { border: 0; padding: 0; vertical-align: middle; }
  .kopw td.logo { width: 84px; text-align: center; }
  .kopw td.teks { text-align: center; }
  .kopw .l { line-height: 1.25; }
  .kopw .l.nama { font-size: 15pt; font-weight: bold; }
  .kopw .l.alamat { font-size: 9pt; }
  .kopw-garis { border: 0; border-top: 3px double #000; margin: 2px 0 12px; height: 0; }
  `;
}
/**
 * Kop surat RESMI untuk dokumen Word (.doc).
 * Memakai baris kop yang sama dengan cetak PDF (doc.kopLines) + logo sekolah,
 * sehingga hasil Word identik dengan PDF — bukan lagi kop ringkas 2 baris.
 */
function kopWord(settings) {
  const lines = kopLines(settings);
  if (!lines.length) return '';
  const logo = kopLogo(settings);
  const px = (v, def) => {
    const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.max(16, Math.min(400, Math.round(n))) : def;
  };
  const h = px(settings.kop_logo_h, px(settings.kop_tinggi_logo, 84));
  const w = px(settings.kop_logo_w, px(settings.kop_tinggi_logo, 84));
  const cls = l => l.jenis === 'nama' ? 'l nama' : l.jenis === 'alamat' ? 'l alamat' : 'l';
  const teks = lines.map(l => `<div class="${cls(l)}" style="font-size:${l.size}pt;${l.bold ? 'font-weight:bold;' : ''}">${e(l.teks)}</div>`).join('');
  const logoCell = logo
    ? `<td class="logo"><img src="${e(logo)}" width="${w}" height="${h}" alt="Logo" style="width:${w}px;height:${h}px"></td>`
    : '';
  return `<table class="kopw"><tr>${logoCell}<td class="teks">${teks}</td></tr></table>
  <div class="kopw-garis"></div>`;
}

/**
 * Bungkus dokumen Word (.doc) dengan kop resmi + gaya tabel yang siap cetak.
 * Dipakai semua ekspor Word (rekap bulanan, layanan BK, aduan, rekap poin)
 * supaya kop & formatnya SERAGAM dengan versi PDF.
 */
function wordPage(opts = {}) {
  const settings = opts.settings || {};
  const judul = String(opts.title || 'Dokumen');
  const sub = opts.subtitle ? `<p style="text-align:center;margin:0 0 10px">${e(opts.subtitle)}</p>` : '';
  const landscape = !!opts.landscape;
  const style = `
  @page { size: ${landscape ? '330mm 215mm' : '215mm 330mm'}; margin: 15mm 15mm 15mm 18mm; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 4px 6px; font-size: 9.5pt; vertical-align: top; }
  th { background: #f3f4f6; text-align: center; font-weight: bold; }
  td.c, th.c { text-align: center; }
  .num { text-align: right; }
  tfoot td { background: #f8fafc; font-weight: bold; }
  h3.judul { text-align: center; text-decoration: underline; margin: 6px 0 2px; font-size: 13pt; }
  h4.sec { font-size: 11pt; margin: 14px 0 4px; }
  .meta { font-size: 10pt; margin: 0 0 10px; }
  .ttd { width: 100%; margin-top: 26px; }
  .ttd td { border: 0; text-align: center; vertical-align: top; padding-top: 6px; }
  .note { font-size: 9pt; color: #444; }
  ul.rapi { margin: 4px 0 0 18px; padding: 0; }
  ${kopWordCSS()}
  `;
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8"><title>${e(judul)} — ${e(settings.sekolah_nama || '')}</title>
  <style>${style}</style></head><body>
  ${kopWord(settings)}
  <h3 class="judul">${e(judul)}</h3>
  ${sub}
  ${String(opts.body || '')}
  </body></html>`;
}

/** pejabat resmi dari menu Identitas Sekolah (bukan akun yang sedang login) */
function pejabat(settings) {
  return {
    kepala: { label: 'Kepala ' + (settings.sekolah_nama || 'Sekolah'), nama: settings.kepala_nama || '', nip: settings.kepala_nip || '' },
    wakasek: {
      label: settings.wakasek_jabatan || 'Wakasek Kesiswaan',
      nama: settings.wakasek_nama || '',
      nip: settings.wakasek_nip || ''
    }
  };
}
function ttdCol(p) {
  return `<div class="ttd">
      <div>${p.ket || '&nbsp;'}</div>
      <div>${e(p.label || '')}</div>
      <div class="ruang"></div>
      <div class="nama">${e(p.nama || '.................................')}</div>
      <div class="nip">NIP. ${e(p.nip || '-')}</div>
    </div>`;
}
/**
 * Blok tanda tangan cetak.
 * Kolom kiri SELALU Kepala Sekolah dari menu Identitas Sekolah (bukan akun yang login),
 * kolom kanan default Wakasek Kesiswaan (juga dari Identitas Sekolah), dan kolom
 * ketiga opsional (mis. Wali Kelas saat mencetak per kelas).
 */
function ttdBlock(settings, opts = {}) {
  /* tempat CETAK: dari pengaturan sekolah (kosong = tanpa baris tempat) — tidak ada default
     nama daerah tertentu supaya dokumen tidak mencatut identitas sekolah lain. */
  const tempat = String(opts.tempat || settings.print_tempat || '').trim();
  const tanggal = opts.tanggal ? tglID(opts.tanggal) : tglID(new Date().toISOString().slice(0, 10));
  const pj = pejabat(settings);
  const kanan = opts.kanan || pj.wakasek;
  const ketiga = opts.ketiga || null;
  const kepala = {
    ket: 'Mengetahui,', label: 'Kepala ' + (settings.sekolah_nama || 'Sekolah'),
    nama: settings.kepala_nama, nip: settings.kepala_nip
  };
  return `<div class="tanggal">${tempat ? e(tempat) + ', ' : ''}${e(tanggal)}</div>
  <div class="ttd-grid${ketiga ? ' three' : ''}">
    ${ttdCol(kepala)}
    ${ttdCol({ ket: '&nbsp;', ...kanan })}
    ${ketiga ? ttdCol({ ket: '&nbsp;', ...ketiga }) : ''}
  </div>`;
}

/* ---------------- SURAT ---------------- */
function suratHTML({ settings, siswa, riwayat, jenis, nomor, paper }) {
  const judul = SURAT_JUDUL[jenis] || SURAT_JUDUL.panggilan;
  const pelanggaran = riwayat.slice(0, 12);
  const totalPoin = pelanggaran.reduce((a, r) => a + (Number(r.poin) || 0), 0);
  const rows = pelanggaran.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${e(tglID(r.tanggal))}</td>
      <td>${e(r.kategori_nama || r.judul || '-')}</td>
      <td>${e(r.keterangan || '-')}</td>
      <td class="c">${Number(r.poin) || 0}</td>
    </tr>`).join('');

  const body = `<div class="sheet">
    ${kop(settings)}
    <h2 class="judul">${e(judul)}</h2>
    <div class="nomor">Nomor: ${e(nomor)}</div>
    <p style="margin:0 0 10px">Kepada Yth.<br><b>Bapak/Ibu Orang Tua/Wali dari ${e(siswa.nama)}</b><br>di tempat</p>
    <p style="margin:0 0 12px">${SURAT_INTRO[jenis] || SURAT_INTRO.panggilan}</p>
    <table class="info" style="margin-bottom:12px">
      <tr><td class="label">Nama Siswa</td><td class="pemisah">:</td><td><b>${e(siswa.nama)}</b></td></tr>
      <tr><td class="label">NIS / NISN</td><td class="pemisah">:</td><td>${e(siswa.nis || '-')} / ${e(siswa.nisn || '-')}</td></tr>
      <tr><td class="label">Kelas</td><td class="pemisah">:</td><td>${e(siswa.kelas_nama || '-')}${siswa.jurusan ? ' — ' + e(siswa.jurusan) : ''}</td></tr>
      <tr><td class="label">Wali Kelas</td><td class="pemisah">:</td><td>${e(siswa.wali_nama || '-')}</td></tr>
      <tr><td class="label">Poin Pelanggaran</td><td class="pemisah">:</td><td><b>${siswa.pel}</b> poin (poin prestasi ${siswa.pres} • poin bersih ${siswa.bersih})</td></tr>
      <tr><td class="label">Status Disiplin</td><td class="pemisah">:</td><td><b>${e(siswa.status.label)}</b></td></tr>
    </table>
    <p style="margin:0 0 6px"><b>Rincian catatan pelanggaran</b> (${pelanggaran.length} kejadian terakhir, total ${totalPoin} poin):</p>
    <table class="data">
      <thead><tr><th style="width:34px">No</th><th style="width:92px">Tanggal</th><th style="width:34%">Bentuk Pelanggaran</th><th>Kronologi / Keterangan</th><th style="width:52px">Poin</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="c">Tidak ada catatan pelanggaran</td></tr>'}</tbody>
    </table>
    <p style="margin:12px 0 0">${SURAT_PENUTUP[jenis] || SURAT_PENUTUP.panggilan}</p>
    ${jenis === 'panggilan' ? '<p class="note" style="margin-top:10px">Catatan: kehadiran orang tua/wali sangat kami harapkan pada hari kerja pukul 08.00–12.00 WIB di ruang Bimbingan Konseling.</p>' : ''}
    ${ttdBlock(settings, { kanan: { label: 'Wali Kelas ' + (siswa.kelas_nama || ''), nama: siswa.wali_nama, nip: siswa.wali_nip } })}
    <div class="note" style="margin-top:14px">Dokumen ini dicetak otomatis oleh ${e(settings.app_nama || 'aplikasi ini')} pada ${e(stampNow())}.</div>
  </div>`;
  return shell(judul, paper, body);
}

/* ---------------- REKAP CETAK ---------------- */
function rekapHTML({ settings, rows, kelas, filters, ta, semester, paper, user }) {
  const body = `<div class="sheet">
    ${kop(settings)}
    <h2 class="judul">REKAPITULASI POIN KEDISIPLINAN SISWA</h2>
    <div class="rekap-meta">
      Tahun Pelajaran: <b>${e((ta || {}).nama || '-')}</b> &nbsp;•&nbsp;
      Semester: <b>${semester === 'genap' ? 'Genap' : 'Ganjil'}</b> &nbsp;•&nbsp;
      ${kelas ? `Kelas: <b>${e(kelas.nama)}</b> &nbsp;•&nbsp; ` : ''}
      Jumlah siswa: <b>${rows.length}</b>
    </div>
    <table class="data">
      <thead><tr>
        <th style="width:30px">No</th><th style="width:78px">NISN</th><th>Nama Murid</th>
        <th style="width:78px">Kelas</th><th style="width:40px">Pel</th><th style="width:44px">Pres</th>
        <th style="width:44px">Total</th><th style="width:70px">Status</th><th>Keterangan</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td class="c">${r.no}</td>
          <td class="c">${e(r.nisn || '-')}</td>
          <td>${e(r.nama)}</td>
          <td class="c">${e(r.kelas_nama || '-')}</td>
          <td class="c">${r.pel}</td>
          <td class="c">${r.pres}</td>
          <td class="c"><b>${r.bersih}</b></td>
          <td class="c">${e(r.status.label)}</td>
          <td style="font-size:9pt">${e(r.keterangan)}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="c">Tidak ada data</td></tr>'}
      </tbody>
    </table>
    ${ttdBlock(settings, {
      kanan: pejabat(settings).wakasek,
      ketiga: kelas && kelas.wali_nama
        ? { label: 'Wali Kelas ' + kelas.nama, nama: kelas.wali_nama, nip: kelas.wali_nip }
        : null
    })}
    <div class="note" style="margin-top:12px">Dicetak oleh ${e((user || {}).nama || '-')} — ${e(stampNow())}</div>
  </div>`;
  return shell('Rekapitulasi Poin Siswa', paper, body);
}

/* ---------------- WORD (HTML .doc) ---------------- */
function rekapWord({ settings, rows, ta, semester, user }) {
  return wordPage({
    settings, landscape: true,
    title: 'REKAPITULASI POIN KEDISIPLINAN SISWA',
    subtitle: `Tahun Pelajaran ${ta || '-'} — Semester ${semester === 'genap' ? 'Genap' : 'Ganjil'}`,
    body: `<table><thead><tr><th>NO</th><th>NISN</th><th>NAMA MURID</th><th>KELAS</th><th>PEL</th><th>PRES</th><th>TOTAL</th><th>STATUS</th><th>KETERANGAN</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td align="center">${r.no}</td><td>${e(r.nisn || '-')}</td><td>${e(r.nama)}</td>
    <td align="center">${e(r.kelas_nama || '-')}</td><td align="center">${r.pel}</td><td align="center">${r.pres}</td>
    <td align="center"><b>${r.bersih}</b></td><td align="center">${e(r.status.label)}</td><td>${e(r.keterangan)}</td></tr>`).join('')}</tbody></table>
  <p style="text-align:right;margin-top:18px">${String(settings.print_tempat || '').trim() ? e(String(settings.print_tempat).trim()) + ', ' : ''}${e(tglID(new Date().toISOString().slice(0, 10)))}</p>
  <table class="ttd"><tr>
    <td>Mengetahui,<br>Kepala ${e(settings.sekolah_nama || 'Sekolah')}<br><br><br><br>
      <b><u>${e(settings.kepala_nama || '........................')}</u></b><br>NIP. ${e(settings.kepala_nip || '-')}</td>
    <td>${e(settings.wakasek_jabatan || 'Wakasek Kesiswaan')}<br><br><br><br><br>
      <b><u>${e(settings.wakasek_nama || '........................')}</u></b><br>NIP. ${e(settings.wakasek_nip || '-')}</td>
  </tr></table>
  <p class="note">Dicetak: ${e(stampNow())}</p>`
  });
}

module.exports = { suratHTML, rekapHTML, rekapWord, PAPER, SURAT_JUDUL, pejabat, kop, kopLines, kopCSS, kopWord, kopWordCSS, wordPage };
