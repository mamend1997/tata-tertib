'use strict';
/* =====================================================================
   RONDE 14 — Kategori poin GANDA dalam satu kejadian
   (Input Kejadian & Buku Penghubung), seperti pemilih siswa masal.

   Jalankan: node dev-tests/round14.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-r14-' + Date.now() + '.sqlite');
const PORT = 5730 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  let body = null;
  try { body = ct.includes('json') ? await r.json() : await r.text(); } catch (e) { body = null; }
  return { status: r.status, body };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, APP_TIMEZONE: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2000));

  try {
    KODE = (((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0]) || {}).kode || '';
    let r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'admin', password: 'admin123' } });
    ok('login admin', r.status === 200);

    const kelas = (await req('/api/kelas')).body.rows;
    const mk = async (nama, kelasId) => (await req('/api/siswa/save', { method: 'POST', body: { nama, kelas_id: kelasId, gender: 'L' } })).body.id;
    const s1 = await mk('Siswa Multi Satu', kelas[0].id);
    const s2 = await mk('Siswa Multi Dua', kelas[0].id);
    ok('dua siswa uji dibuat', !!(s1 && s2));

    const katAll = (await req('/api/kategori')).body.rows;
    const katPel = katAll.filter(k => k.jenis === 'pelanggaran').slice(0, 2);
    const katPres = katAll.find(k => k.jenis === 'prestasi');
    ok('tersedia ≥2 kategori pelanggaran + 1 prestasi', katPel.length === 2 && !!katPres,
      JSON.stringify({ pel: katPel.map(k => k.nama), pres: katPres && katPres.nama }));

    console.log('\n== 1. KEJADIAN: BEBERAPA KATEGORI PELANGGARAN ==');
    const totalPel = Number(katPel[0].poin) + Number(katPel[1].poin);
    r = await req('/api/kejadian/save', {
      method: 'POST',
      body: {
        siswa_id: s1, kategori_ids: [katPel[0].id, katPel[1].id],
        keterangan: 'Dua pelanggaran sekaligus', tanggal: '2026-11-10', lokasi: 'Ruang Kelas'
      }
    });
    ok('kejadian dengan 2 kategori tersimpan', r.status === 200, JSON.stringify(r.body).slice(0, 160));
    ok('respons melaporkan jumlah kategori = 2', r.body.jumlah_kategori === 2, String(r.body.jumlah_kategori));
    ok('poin dijumlahkan otomatis', r.body.poin === totalPel, `${r.body.poin} vs ${totalPel}`);
    ok('jenis tetap pelanggaran (semua kategori sama)', r.body.jenis === 'pelanggaran');

    r = await req('/api/siswa/' + s1);
    ok('poin siswa = jumlah kedua kategori', r.body.siswa.pel === totalPel, `${r.body.siswa.pel} vs ${totalPel}`);
    ok('riwayat mencatat 2 baris kejadian (satu per kategori)', (r.body.riwayat || []).length === 2,
      String((r.body.riwayat || []).length));
    const duaKat = (r.body.riwayat || []).map(x => x.kategori_nama).sort();
    ok('kedua kategori tercatat masing-masing', duaKat.join(' | ') === [katPel[0].nama, katPel[1].nama].sort().join(' | '), duaKat.join(' | '));

    console.log('\n== 2. KEJADIAN: CAMPUR PELANGGARAN + PRESTASI ==');
    const totalMix = totalPel + Number(katPres.poin);
    r = await req('/api/kejadian/save', {
      method: 'POST',
      body: { siswa_id: s1, kategori_ids: [katPel[0].id, katPres.id], keterangan: 'campur', tanggal: '2026-11-11' }
    });
    ok('kejadian campur jenis diterima', r.status === 200, JSON.stringify(r.body).slice(0, 160));
    ok('jenis dilaporkan "campuran"', r.body.jenis === 'campuran', String(r.body.jenis));
    r = await req('/api/siswa/' + s1);
    ok('poin pelanggaran bertambah sesuai kategori pelanggaran', r.body.siswa.pel === totalPel + Number(katPel[0].poin),
      `${r.body.siswa.pel} vs ${totalPel + Number(katPel[0].poin)}`);
    ok('poin prestasi bertambah sesuai kategori prestasi', r.body.siswa.pres === Number(katPres.poin),
      `${r.body.siswa.pres} vs ${katPres.poin}`);
    ok('total riwayat = 4 baris', (r.body.riwayat || []).length === 4, String((r.body.riwayat || []).length));

    console.log('\n== 3. MULTI SISWA × MULTI KATEGORI ==');
    r = await req('/api/kejadian/save', {
      method: 'POST',
      body: { siswa_ids: [s1, s2], kategori_ids: [katPel[0].id, katPel[1].id], keterangan: 'masal', tanggal: '2026-11-12' }
    });
    ok('2 siswa × 2 kategori tersimpan', r.status === 200 && r.body.jumlah === 2 && r.body.baris === 4,
      JSON.stringify({ jumlah: r.body.jumlah, baris: r.body.baris }));
    ok('total poin per siswa dijumlahkan', r.body.poin === totalPel, String(r.body.poin));
    r = await req('/api/siswa/' + s2);
    ok('siswa kedua mendapat kedua kategori', (r.body.riwayat || []).length === 2, String((r.body.riwayat || []).length));

    console.log('\n== 4. BUKU PENGHUBUNG: BEBERAPA KATEGORI ==');
    const s3 = await mk('Siswa Jurnal Multi', kelas[1].id);
    r = await req('/api/jurnal/save', {
      method: 'POST',
      body: { siswa_id: s3, kategori_ids: [katPel[0].id, katPel[1].id], keterangan: '', tanggal: '2026-11-13', jam: '08:15', lokasi: 'Kantin' }
    });
    ok('jurnal dengan 2 kategori tersimpan', r.status === 200 && r.body.jumlah_kategori === 2,
      JSON.stringify(r.body).slice(0, 160));
    ok('poin jurnal dijumlahkan', r.body.poin === totalPel, String(r.body.poin));
    r = await req('/api/jurnal?tanggal=2026-11-13');
    const jr = (r.body.rows || []).filter(x => x.siswa_id === s3);
    ok('jurnal menampilkan 2 baris (satu per kategori)', jr.length === 2, String(jr.length));
    ok('setiap baris jurnal memuat kategori yang berbeda', new Set(jr.map(x => x.kategori_nama)).size === 2,
      jr.map(x => x.kategori_nama).join(' | '));
    r = await req('/api/siswa/' + s3);
    ok('poin siswa jurnal = jumlah kategori', r.body.siswa.pel === totalPel, `${r.body.siswa.pel} vs ${totalPel}`);

    console.log('\n== 5. KOMPATIBILITAS & VALIDASI ==');
    r = await req('/api/kejadian/save', {
      method: 'POST', body: { siswa_id: s1, kategori_id: katPel[0].id, keterangan: 'single lama', tanggal: '2026-11-14' }
    });
    ok('payload kategori tunggal (kategori_id) tetap didukung', r.status === 200 && r.body.jumlah_kategori === 1,
      JSON.stringify(r.body).slice(0, 140));
    ok('poin tunggal tetap benar', r.body.poin === Number(katPel[0].poin), String(r.body.poin));

    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: s1, kategori_ids: [], tanggal: '2026-11-14' } });
    ok('tanpa kategori ditolak (400)', r.status === 400, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: s1, kategori_ids: [katPel[0].id, 999999], tanggal: '2026-11-14' } });
    ok('kategori tidak dikenal ditolak (404)', r.status === 404, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/jurnal/save', { method: 'POST', body: { siswa_id: s3, kategori_ids: [], tanggal: '2026-11-14' } });
    ok('jurnal tanpa kategori ditolak (400)', r.status === 400, JSON.stringify(r.body).slice(0, 120));

    console.log('\n== 6. AGREGAT & ANALITIK ==');
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    const baris = (r.body.rows || []).filter(x => [s1, s2].includes(x.siswa_id));
    /* s1: 2 (langkah 1) + 2 (langkah 2) + 2 (langkah 3) + 1 (langkah 5) = 7 · s2: 2 */
    ok('log kejadian memuat baris per kategori', baris.length === 9, String(baris.length));
    r = await req('/api/analitik?ta=1&semester=ganjil');
    ok('analitik kategori tetap terbaca', r.status === 200 && Array.isArray(r.body.pola && r.body.pola.perKategori ? r.body.pola.perKategori : []),
      JSON.stringify(Object.keys(r.body).slice(0, 6)));
  } catch (e) {
    fail++; fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
  }

  console.log(`\n=== HASIL RONDE 14: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
