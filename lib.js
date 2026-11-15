'use strict';
const crypto = require('crypto');
const zlib = require('zlib');

/* ---------------- formatting ---------------- */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('id-ID');
}
function rupiah(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const s = Math.abs(Math.round(v)).toLocaleString('id-ID');
  return (neg ? '-Rp ' : 'Rp ') + s;
}
function rpShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return 'Rp ' + (v / 1e9).toFixed(1).replace('.', ',') + ' M';
  if (Math.abs(v) >= 1e6) return 'Rp ' + (v / 1e6).toFixed(1).replace('.', ',') + ' jt';
  if (Math.abs(v) >= 1e3) return 'Rp ' + (v / 1e3).toFixed(0) + ' rb';
  return rupiah(v);
}
/** baca nominal dari input form: "4.500.000" / "Rp 4.500.000" / "4500000" → 4500000 */
function parseMoney(v) {
  if (typeof v === 'number') return Math.round(v) || 0;
  let s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.charAt(0) === '-';
  s = s.replace(/rp\.?/gi, ' ').replace(/\s/g, '').replace(/[^\d.,]/g, '');
  if (!s) return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  let n = Number(s);
  if (Number.isNaN(n)) n = 0;
  n = Math.round(n);
  return neg ? -n : n;
}
/** format angka ribuan gaya Indonesia tanpa prefix (untuk value input) */
function moneyInput(n) {
  const v = Math.round(Number(n) || 0);
  return v ? v.toLocaleString('id-ID') : '';
}
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function tglID(iso) {
  if (!iso) return '-';
  const d = String(iso).slice(0, 10).split('-');
  if (d.length !== 3) return iso;
  return parseInt(d[2], 10) + ' ' + BULAN[parseInt(d[1], 10) - 1] + ' ' + d[0];
}
function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/* ---------------- zona waktu (WIB / Asia/Jakarta) ---------------- */
const tz = require('./tz');
/** label singkat zona aplikasi: 'WIB' */
function tzLabel() { return tz.label(); }
function tzOffset() { return tz.offsetLabel(); }
/**
 * Stempel waktu dapat dibaca: "04-11-2026 12:05:31 WIB".
 * Dipakai untuk audit log, riwayat transaksi & dokumen (permintaan: DD-MM-YYYY HH:mm:ss WIB).
 * Nilai yang tersimpan di database tetap "YYYY-MM-DD HH:mm:ss" (WIB) agar urutan teks = urutan waktu.
 */
function stampID(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6] || '00'} ${tz.label()}`;
}
/** versi ringkas untuk kolom tabel: "04-11-2026 12:05" */
function stampShort(v) {
  const s = stampID(v);
  if (s === '-' || s.length < 16) return s;
  return s.slice(0, 16);
}
/** tanggal + jam tanpa detik, tanpa label: "04-11-2026 12:05" */
function stampPlain(v) {
  const s = stampID(v);
  return s === '-' ? '-' : s.slice(0, 16);
}
/** stempel kedaluwarsa berbasis jam WIB (konsisten dengan nowStamp()) */
function plusMinutesStamp(minutes) {
  const d = new Date(Date.now() + (Number(minutes) || 0) * 60000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function plusDaysStamp(days) { return plusMinutesStamp((Number(days) || 0) * 1440); }
const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 12) return SATUAN[n] || 'nol';
  if (n < 20) return terbilang(n - 10) + ' belas';
  if (n < 100) return terbilang(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + terbilang(n % 10) : '');
  if (n < 200) return 'seratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 1000) return terbilang(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 2000) return 'seribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1e6) return terbilang(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilang(n % 1e6) : '');
  if (n < 1e12) return terbilang(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilang(n % 1e9) : '');
  return terbilang(Math.floor(n / 1e12)) + ' triliun' + (n % 1e12 ? ' ' + terbilang(n % 1e12) : '');
}
function terbilangRupiah(n) {
  const t = terbilang(n).trim().replace(/\s+/g, ' ');
  return (t.charAt(0).toUpperCase() + t.slice(1)) + ' rupiah';
}

/** ukuran berkas ringkas: 850 B, 12 KB, 2,4 MB, 1,1 GB */
function fileSize(bytes) {
  const b = Number(bytes) || 0;
  const fmt = v => v.toFixed(1).replace('.', ',');
  if (b >= 1024 ** 3) return fmt(b / 1024 ** 3) + ' GB';
  if (b >= 1024 ** 2) return fmt(b / 1024 ** 2) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return Math.round(b) + ' B';
}

/* ---------------- passwords & tokens ---------------- */
/**
 * Normalisasi nomor telepon/WhatsApp Indonesia → format 62xxxxxxxxxx.
 * Menerima "0812-3456-7890", "+62 812 3456 7890", "62812…", "812…", "(0812) …".
 * Mengembalikan '' bila tidak ada digit yang bisa dipakai.
 */
function normPhone(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw).replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = '62' + s.slice(1);
  else if (s.startsWith('8')) s = '62' + s;
  // buang awalan ganda yang lazim (6262…, 620…)
  s = s.replace(/^62{2,}/, '62').replace(/^6262/, '62');
  if (s.startsWith('620')) s = '62' + s.slice(3);
  if (!/^62\d{7,15}$/.test(s)) return '';
  return s;
}
/** tampilan nomor untuk manusia: 62812… → 0812… */
function phoneDisplay(raw) {
  const n = String(raw || '');
  if (/^62\d+$/.test(n)) return '0' + n.slice(2);
  return n;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + h;
}
function verifyPassword(pw, stored) {
  try {
    const [algo, salt, h] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const calc = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(h, 'hex'));
  } catch (e) { return false; }
}
function token(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

/* ---------------- tiny zip + xlsx writer ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, eocd]);
}
function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function xmlEsc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}
/**
 * rows: array of arrays. Cell can be string|number|{v, bold, num}
 */
function xlsxBuffer(sheetName, rows, widths) {
  const cols = Math.max(1, ...rows.map(r => r.length));
  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (widths && widths.length) {
    sheet += '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  }
  sheet += '<sheetData>';
  rows.forEach((row, ri) => {
    sheet += `<row r="${ri + 1}">`;
    for (let ci = 0; ci < cols; ci++) {
      const cell = row[ci];
      if (cell === null || cell === undefined || cell === '') continue;
      const ref = colName(ci) + (ri + 1);
      if (typeof cell === 'object') {
        const isNum = cell.num !== false && typeof cell.v === 'number';
        const st = (cell.bold ? 1 : 0) + (isNum ? 2 : 0);
        sheet += `<c r="${ref}" s="${st}"${isNum ? '' : ' t="inlineStr"'}>` + (isNum ? `<v>${cell.v}</v>` : `<is><t>${xmlEsc(cell.v)}</t></is>`) + '</c>';
      } else if (typeof cell === 'number') {
        sheet += `<c r="${ref}" s="2"><v>${cell}</v></c>`;
      } else {
        sheet += `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(cell)}</t></is></c>`;
      }
    }
    sheet += '</row>';
  });
  sheet += '</sheetData></worksheet>';

  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const files = [
    {
      name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${xmlEsc(sheetName).slice(0, 30)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ];
  return zip(files);
}

module.exports = {
  esc, num, rupiah, rpShort, fileSize, tglID, todayISO, nowStamp, BULAN, terbilang, terbilangRupiah,
  tz, tzLabel, tzOffset, stampID, stampShort, stampPlain, plusMinutesStamp, plusDaysStamp,
  parseMoney, moneyInput, normPhone, phoneDisplay,
  hashPassword, verifyPassword, token, xlsxBuffer, zip
};
