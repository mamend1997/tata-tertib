'use strict';
/* Uji import Kategori Poin (API):
   template Excel, pratinjau (validasi & duplikat), commit idempoten, CSV,
   berkas salah, serta hak akses (guru biasa tidak boleh).
   Jalankan: node dev-tests/kategori.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const xr = require('../xlsx-read');
const lib = require('../lib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-kat-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 6400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x !== undefined ? ' — ' + x : '')); console.log('  ✗ ' + n + (x !== undefined ? ' — ' + x : '')); }
};

async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: r.status, body: await r.json(), ct };
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ct };
}
const xlsx = (rows, widths) => lib.xlsxBuffer('Kategori', rows, widths || [36, 16, 10, 50]);
const kirim = (rows, filename = 'kategori.xlsx') =>
  req('/api/kategori/import/preview', { method: 'POST', body: { filename, base64: xlsx(rows).toString('base64') } });

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));
  try {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) break; } catch (e) { /* belum siap */ }
      await new Promise(r => setTimeout(r, 250));
    }
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    let r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    ok('login administrator', r.status === 200, String(r.status));

    /* ---------------- TEMPLATE ---------------- */
    console.log('\n== TEMPLATE EXCEL ==');
    r = await req('/api/kategori-template.xlsx');
    ok('template dapat diunduh', r.status === 200 && r.buf && r.buf.length > 1000, String(r.status));
    ok('template bertipe XLSX', /spreadsheetml/.test(r.ct), r.ct);
    const sheet = xr.readXlsx(r.buf)[0];
    const barisTemplate = sheet.rows.map(row => row.map(c => xr.cellText(c)));
    ok('template memuat judul', /TEMPLATE IMPORT KATEGORI POIN/i.test(barisTemplate[0].join(' ')), barisTemplate[0].join(' '));
    const head = barisTemplate[2].map(h => h.toUpperCase());
    ok('header kolom NAMA/JENIS/POIN/KETERANGAN',
      head.includes('NAMA KATEGORI') && head.includes('JENIS') && head.includes('POIN') && head.includes('KETERANGAN'),
      barisTemplate[2].join(' | '));
    ok('template memuat contoh pelanggaran & prestasi',
      barisTemplate.slice(3).some(row => /Pelanggaran/i.test(row[1])) && barisTemplate.slice(3).some(row => /Prestasi/i.test(row[1])),
      barisTemplate.slice(3).map(r2 => r2[1]).join(','));
    const pratinjauTemplate = await req('/api/kategori/import/preview', {
      method: 'POST', body: { filename: 'template-kategori.xlsx', base64: r.buf.toString('base64') }
    });
    ok('template kategori yang diunduh bisa dipratinjau',
      pratinjauTemplate.status === 200 && pratinjauTemplate.body.rows.some(x => x.nama === 'Terlambat masuk sekolah' && x.poin === 5),
      JSON.stringify(pratinjauTemplate.body?.error || pratinjauTemplate.body?.rows?.map(x => x.nama)));

    /* ---------------- PRATINJAU ---------------- */
    console.log('\n== PRATINJAU IMPORT ==');
    const awal = (await req('/api/kategori')).body.rows;
    ok('kategori awal tersedia (seed)', awal.length >= 15, String(awal.length));
    const namaPrestasi = (awal.find(k => k.jenis === 'prestasi') || {}).nama;
    const rows = [
      [{ v: 'KRITERIA UJI' }],
      [{ v: 'diisi otomatis' }],
      [{ v: 'NAMA KATEGORI', bold: true }, { v: 'JENIS', bold: true }, { v: 'POIN', bold: true }, { v: 'KETERANGAN', bold: true }],
      ['Terlambat uji import', 'Pelanggaran', 7, 'contoh keterangan'],
      ['Juara Olimpiade uji', 'Prestasi', 50, ''],
      ['Tanpa jenis (default)', '', 12, ''],
      [namaPrestasi, 'Prestasi', 15, 'duplikat nama+jenis'],
      ['Poin tidak valid', 'Pelanggaran', 0, 'harus error']
    ];
    r = await kirim(rows);
    ok('pratinjau berhasil', r.status === 200 && Array.isArray(r.body.rows), JSON.stringify(r.body).slice(0, 120));
    const p = r.body.rows;
    ok('baris judul & keterangan tidak ikut terbaca', p.length === 5, String(p.length));
    const b1 = p.find(x => x.nama === 'Terlambat uji import');
    ok('baris valid terbaca (nama/jenis/poin/keterangan)',
      b1 && b1.jenis === 'pelanggaran' && b1.poin === 7 && b1.keterangan === 'contoh keterangan', JSON.stringify(b1));
    const b2 = p.find(x => x.nama === 'Juara Olimpiade uji');
    ok('jenis "Prestasi" dikenali', b2 && b2.jenis === 'prestasi' && b2.poin === 50, JSON.stringify(b2));
    const b3 = p.find(x => x.nama === 'Tanpa jenis (default)');
    ok('jenis kosong otomatis Pelanggaran', b3 && b3.jenis === 'pelanggaran', JSON.stringify(b3));
    const b4 = p.find(x => x.nama === namaPrestasi);
    ok('duplikat nama+jenis terdeteksi & dilewati', b4 && /sudah ada/.test(b4.duplikat) && b4.skip === true, JSON.stringify(b4));
    const b5 = p.find(x => x.nama === 'Poin tidak valid');
    ok('poin 0 ditandai error', b5 && /lebih dari 0/.test(b5.error), JSON.stringify(b5));
    ok('ringkasan "siap" dihitung benar', r.body.siap === 3, String(r.body.siap));

    /* ---------------- COMMIT ---------------- */
    console.log('\n== SIMPAN (COMMIT) ==');
    r = await req('/api/kategori/import/commit', { method: 'POST', body: { rows: p } });
    ok('commit berhasil', r.status === 200 && r.body.masuk === 3, JSON.stringify(r.body));
    ok('baris error & duplikat dilewati', r.body.dilewati === 2, JSON.stringify(r.body));
    let semua = (await req('/api/kategori')).body.rows;
    ok('kategori bertambah sesuai baris siap', semua.length === awal.length + 3, `${awal.length} → ${semua.length}`);
    const baru = semua.find(k => k.nama === 'Terlambat uji import');
    ok('data tersimpan lengkap (jenis/poin/keterangan)',
      baru && baru.jenis === 'pelanggaran' && Number(baru.poin) === 7 && baru.keterangan === 'contoh keterangan', JSON.stringify(baru));
    ok('kategori prestasi tersimpan sebagai prestasi',
      (semua.find(k => k.nama === 'Juara Olimpiade uji') || {}).jenis === 'prestasi');

    /* idempoten: commit ulang tidak menambah */
    const ulang = (await kirim(rows)).body.rows;
    r = await req('/api/kategori/import/commit', { method: 'POST', body: { rows: ulang } });
    const setelah = (await req('/api/kategori')).body.rows;
    ok('commit ulang tidak membuat kategori ganda', setelah.length === semua.length, `${semua.length} → ${setelah.length}`);
    ok('commit ulang melaporkan 0 masuk', r.body.masuk === 0, JSON.stringify(r.body));

    /* ---------------- CSV ---------------- */
    console.log('\n== BERKAS CSV ==');
    const csv = 'NAMA,JENIS,POIN,KETERANGAN\nBerkelahi (uji csv),Pelanggaran,60,uji csv\nJuara Debat (uji csv),Prestasi,25,uji csv\n';
    r = await req('/api/kategori/import/preview', { method: 'POST', body: { filename: 'kategori.csv', base64: Buffer.from(csv).toString('base64') } });
    ok('CSV terbaca', r.status === 200 && r.body.rows.length === 2, JSON.stringify(r.body).slice(0, 120));
    ok('jenis & poin dari CSV benar',
      r.body.rows[0].jenis === 'pelanggaran' && r.body.rows[0].poin === 60 &&
      r.body.rows[1].jenis === 'prestasi' && r.body.rows[1].poin === 25,
      JSON.stringify(r.body.rows.map(x => [x.nama, x.jenis, x.poin])));

    /* ---------------- VALIDASI BERKAS ---------------- */
    console.log('\n== VALIDASI BERKAS ==');
    r = await req('/api/kategori/import/preview', { method: 'POST', body: { filename: 'salah.xlsx', base64: xlsx([[{ v: 'A' }, { v: 'B' }], ['x', 'y']]).toString('base64') } });
    ok('berkas tanpa header ditolak dengan pesan jelas', r.status === 400 && /Header kolom/i.test(r.body.error), r.body.error);
    r = await req('/api/kategori/import/preview', { method: 'POST', body: { filename: 'kosong.xlsx', base64: '' } });
    ok('berkas kosong ditolak', r.status === 400, String(r.status));
    r = await req('/api/kategori/import/preview', { method: 'POST', body: {
      filename: 'tanpa-poin.xlsx', base64: xlsx([[{ v: 'NAMA KATEGORI' }, { v: 'KETERANGAN' }], ['Contoh', 'x']]).toString('base64')
    } });
    ok('kolom POIN wajib ada', r.status === 400 && /POIN wajib/i.test(r.body.error), r.body.error);

    /* ---------------- HAK AKSES ---------------- */
    console.log('\n== HAK AKSES ==');
    await req('/api/logout', { method: 'POST' });
    cookie = '';
    await req('/api/login', { method: 'POST', body: { username: 'guru', password: 'guru123', kode: KODE } });
    r = await req('/api/kategori/import/preview', { method: 'POST', body: { filename: 'kategori.xlsx', base64: xlsx(rows).toString('base64') } });
    ok('guru tanpa izin tidak boleh import', r.status === 403, String(r.status));
    r = await req('/api/kategori/import/commit', { method: 'POST', body: { rows: [] } });
    ok('guru tanpa izin tidak boleh commit', r.status === 403, String(r.status));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(log.join('').slice(-2000));
  } finally {
    srv.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 250));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL KATEGORI: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
