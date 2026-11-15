'use strict';
/* ============ Pembaca XLSX / CSV (tanpa dependency) ============ */
const zlib = require('zlib');

function unzipEntries(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Berkas bukan file XLSX (ZIP) yang valid.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  const out = {};
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (localOff + 30 <= buf.length) {
      const lnameLen = buf.readUInt16LE(localOff + 26);
      const lextraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lnameLen + lextraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      try { out[name] = method === 0 ? raw : zlib.inflateRawSync(raw); } catch (e) { out[name] = Buffer.alloc(0); }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decodeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(String(ref || ''));
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  const list = [];
  if (!xml) return list;
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1];
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    // teks langsung (tanpa run) atau rph (rich text) — gabungkan semua <t>
    while ((t = tRe.exec(inner))) text += decodeXml(t[1]);
    list.push(text);
  }
  return list;
}

/** Baca satu sheet XML jadi baris-baris nilai mentah */
function parseSheetXml(xml, shared) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const attrs = rm[1];
    const body = rm[2];
    const rowNum = Number((/r="(\d+)"/.exec(attrs) || [])[1] || rows.length + 1);
    const cells = [];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    let autoCol = 0;
    while ((cm = cellRe.exec(body))) {
      const a = cm[2] !== undefined ? cm[2] : cm[1];
      const inner = cm[3] || '';
      const ref = (/r="([A-Z]+\d+)"/.exec(a) || [])[1];
      const col = ref ? colIndex(ref) : autoCol;
      autoCol = col + 1;
      const type = (/t="([^"]+)"/.exec(a) || [])[1] || 'n';
      let value = null;
      let num = null;
      if (type === 's') {
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        value = v !== undefined ? (shared[Number(v)] ?? '') : '';
      } else if (type === 'inlineStr') {
        let text = '';
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(inner))) text += decodeXml(t[1]);
        value = text;
      } else if (type === 'str') {
        value = decodeXml((/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1] || '');
      } else if (type === 'b') {
        value = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1] === '1';
      } else if (type === 'e') {
        value = '';
      } else {
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        if (v !== undefined && v !== '') {
          const n = Number(v);
          if (!Number.isNaN(n)) { num = n; value = n; } else value = decodeXml(v);
        }
      }
      if (value === '' || value === null) continue;
      cells[col] = { v: value, n: num };
    }
    // rapikan index kosong di depan
    const clean = [];
    for (let i = 0; i < cells.length; i++) clean[i] = cells[i] || null;
    rows[rowNum - 1] = clean;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function readXlsx(buf) {
  const files = unzipEntries(buf);
  const get = n => files[n] ? files[n].toString('utf8') : '';
  const shared = parseSharedStrings(get('xl/sharedStrings.xml'));
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const relMap = {};
  {
    const re = /<Relationship\b([^>]*)\/?>/g;
    let m;
    while ((m = re.exec(rels))) {
      const id = (/Id="([^"]+)"/.exec(m[1]) || [])[1];
      const target = (/Target="([^"]+)"/.exec(m[1]) || [])[1];
      if (id && target) relMap[id] = target;
    }
  }
  const sheets = [];
  {
    const re = /<sheet\b([^>]*)\/?>/g;
    let m;
    let idx = 0;
    while ((m = re.exec(wb))) {
      idx++;
      const name = decodeXml((/name="([^"]*)"/.exec(m[1]) || [])[1] || 'Sheet' + idx);
      const rid = (/r:id="([^"]+)"/.exec(m[1]) || [])[1];
      let target = relMap[rid] || `worksheets/sheet${idx}.xml`;
      target = target.replace(/^\/?xl\//, '').replace(/^\.\//, '');
      const xml = get('xl/' + target) || get('xl/worksheets/sheet' + idx + '.xml');
      sheets.push({ name, rows: xml ? parseSheetXml(xml, shared) : [] });
    }
  }
  if (!sheets.length) {
    // fallback: ambil sheet1 apa pun
    const keys = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
    for (const k of keys) {
      sheets.push({ name: k.split('/').pop().replace('.xml', ''), rows: parseSheetXml(files[k].toString('utf8'), shared) });
    }
  }
  if (!sheets.length) throw new Error('Tidak ada lembar kerja (sheet) yang bisa dibaca dari file ini.');
  return sheets;
}

/** CSV sederhana (pemisah , atau ;) */
function readCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim() !== '');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const rows = lines.map(line => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(v => {
      const s = v.trim();
      if (s === '') return null;
      const n = Number(s.replace(/\./g, '').replace(',', '.')) ;
      if (/^-?[\d.,]+$/.test(s) && !Number.isNaN(n)) return { v: n, n };
      return { v: s, n: null };
    });
  });
  return [{ name: 'CSV', rows }];
}

/* ============ parsing nilai sel ============ */
const BULAN_ID = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8, aug: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12 };

function pad2(n) { return String(n).padStart(2, '0'); }

/** normalisasi tanggal → 'YYYY-MM-DD' atau null */
function parseDateCell(cell) {
  if (!cell) return null;
  const raw = cell.v;
  // serial angka Excel (mis. 45000) → 1899-12-30 + n hari
  if (typeof raw === 'number' || (cell.n !== null && cell.n !== undefined && /^\d{4,5}$/.test(String(raw)))) {
    const n = Number(cell.n !== null && cell.n !== undefined ? cell.n : raw);
    if (n > 20000 && n < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  }
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/\s+/g, ' ');
  // buang jam
  s = s.replace(/\s+\d{1,2}[:.]\d{2}(:\d{2})?.*$/, '').trim();

  // YYYY-MM-DD / YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  // DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // format MM/DD/YYYY
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  // 5 Januari 2026 / 5 Jan 2026
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})$/);
  if (m) {
    const mo = BULAN_ID[m[2].toLowerCase()];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo) return `${y}-${pad2(mo)}-${pad2(+m[1])}`;
  }
  // Januari 2026 (tanpa hari) → tanggal 1
  m = s.match(/^([A-Za-z]+)[\s-]+(\d{4})$/);
  if (m) {
    const mo = BULAN_ID[m[1].toLowerCase()];
    if (mo) return `${m[2]}-${pad2(mo)}-01`;
  }
  // hanya "12" (hari) → tidak bisa ditentukan tanpa konteks
  return null;
}

/** normalisasi nominal → angka bulat (selalu positif; tanda ditentukan kolom) */
function parseMoneyCell(cell) {
  if (cell === null || cell === undefined) return 0;
  if (typeof cell.v === 'number') return Math.round(cell.v);
  let s = String(cell.v || '').trim();
  if (!s) return 0;
  const negParen = /^\(.*\)$/.test(s);
  s = s.replace(/rp\.?/gi, '').replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  let neg = negParen;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // pemisah desimal = simbol terakhir
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // "1.234,56" sudah ditangani; "1,234,567" → ribuan ; "1234,56" → desimal
    const parts = s.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (hasDot) {
    // titik ribuan gaya Indonesia: 1.234.567 atau 1.000
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = s.replace(/\./g, '');
  }
  let n = Number(s);
  if (Number.isNaN(n)) n = 0;
  n = Math.round(n);
  return neg ? -Math.abs(n) : n;
}

function cellText(cell) {
  if (!cell) return '';
  if (typeof cell.v === 'number') return String(cell.v);
  return String(cell.v || '').trim();
}

module.exports = { unzipEntries, readXlsx, readCsv, parseDateCell, parseMoneyCell, cellText, colIndex };
