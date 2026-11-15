'use strict';
/* =====================================================================
   Halaman cetak generik (dipakai laporan rekap absensi, layanan BK,
   hasil asesmen). Memakai kop surat dinamis dari doc.js sehingga semua
   dokumen sekolah seragam. Pengguna menyimpan sebagai PDF lewat dialog
   cetak peramban (tombol "Cetak / Simpan PDF").
   ===================================================================== */
const lib = require('./lib');
const doc = require('./doc');

const e = lib.esc;

const BASE_CSS = `
  @page { margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #111827; background: #eef2f7; font-size: 11pt; line-height: 1.4; }
  .sheet { background: #fff; max-width: 980px; margin: 14px auto 40px; padding: 20px 24px 28px; box-shadow: 0 10px 30px rgba(15,23,42,.12); }
  .judul-wrap { text-align: center; margin: 6px 0 14px; }
  .judul { margin: 0; font-size: 14pt; letter-spacing: .4px; text-transform: uppercase; }
  .subjudul { margin: 2px 0 0; font-size: 10.5pt; color: #475569; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 22px; font-size: 9.8pt; color: #334155; margin: 0 0 12px; }
  .meta b { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; font-size: 9.4pt; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
  th { background: #f1f5f9; text-align: center; font-weight: 700; }
  td.c, th.c { text-align: center; }
  tfoot td { background: #f8fafc; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #64748b; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 8.6pt; border: 1px solid #cbd5e1; background: #f8fafc; }
  .aksi { position: sticky; top: 0; z-index: 5; display: flex; justify-content: flex-end; gap: 8px; background: #fff; padding: 6px 0 10px; }
  .aksi button, .aksi a { font: inherit; font-size: 10pt; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; padding: 7px 12px; cursor: pointer; text-decoration: none; color: #0f172a; }
  .aksi button.primary { background: #0f766e; border-color: #0f766e; color: #fff; }
  .ttd-grid { display: flex; justify-content: space-between; gap: 24px; margin-top: 26px; page-break-inside: avoid; }
  .ttd { flex: 1; text-align: center; font-size: 10pt; }
  .ttd .nm { margin-top: 54px; font-weight: 700; text-decoration: underline; }
  .note { margin-top: 10px; font-size: 8.8pt; color: #64748b; }
  h3.sec { font-size: 11pt; margin: 16px 0 6px; }
  ul.rapi { margin: 4px 0 0 18px; padding: 0; font-size: 9.6pt; }
  ul.rapi li { margin: 1px 0; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .aksi, .no-print, button, .btn { display: none !important; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
  ${doc.kopCSS()}
`;

function page(opts = {}) {
  const settings = opts.settings || {};
  const paper = String(opts.paper || settings.print_paper || 'A4').toUpperCase() === 'F4' ? 'F4' : 'A4';
  const landscape = !!opts.landscape;
  const size = paper === 'F4' ? '215mm 330mm' : '210mm 297mm';
  const pageSize = landscape
    ? (paper === 'F4' ? '330mm 215mm' : '297mm 210mm')
    : size;
  const css = String(opts.css || '');
  const body = String(opts.body || '');
  const ident = settings;
  const judul = opts.title || 'Dokumen';
  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(judul)} — ${e(ident.sekolah_nama || '')}</title>
<style>
  @page { size: ${pageSize}; }
  ${BASE_CSS}
  ${css}
</style>
</head><body>
<div class="sheet">
  <div class="aksi no-print">
    ${opts.backHref ? `<a href="${e(opts.backHref)}">Kembali</a>` : ''}
    <button class="primary" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>
  ${doc.kop(ident)}
  <div class="judul-wrap">
    <h1 class="judul">${e(judul)}</h1>
    ${opts.subtitle ? `<p class="subjudul">${e(opts.subtitle)}</p>` : ''}
  </div>
  ${body}
</div>
</body></html>`;
}

module.exports = { page, BASE_CSS, e };
