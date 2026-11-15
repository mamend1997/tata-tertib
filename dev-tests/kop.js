'use strict';
/* Uji kop surat: teks dicetak PERSIS seperti yang diketik (tidak dipaksa KAPITAL),
   serta pengaturan ukuran logo (lebar & tinggi) pada pratinjau dan hasil cetak.
   Jalankan: node dev-tests/kop.js  (server port acak + DB sementara) */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-kop-' + Date.now() + '.sqlite');
const PORT = 4900 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let cookie = '';
let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  let body = null;
  if (ct.includes('json')) body = await r.json().catch(() => null);
  else body = await r.text();
  return { status: r.status, body };
}
const save = (data) => req('/api/settings/save', { method: 'POST', body: { data } });

/* contoh persis seperti kop sekolah pada gambar */
const KOP = [
  'PERWAKILAN YAYASAN PEMBINA LEMBAGA PENDIDIKAN',
  'PERSATUAN GURU REPUBLIK INDONESIA (YPLP-PGRI) KABUPATEN CIAMIS',
  'Sekolah Menengah Kejuruan PGRI Cikoneng',
  'NPSN: 20211525 TERAKREDITASI: A',
  'Jalan Raya Cikoneng No.144 Telp./Fax.:(0265)773258 E-mail:smkpgrickn@yahoo.co.id',
  'Cikoneng-Ciamis'
].join('\n');

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, APP_TIMEZONE: 'Asia/Jakarta', DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  const waitUp = async () => {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(BASE + '/api/bootstrap'); if (r.ok) return; } catch (e) { /* belum siap */ }
      await new Promise(r2 => setTimeout(r2, 250));
    }
    throw new Error('server tidak siap');
  };
  try {
    await waitUp();
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    let r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    ok('login administrator', r.status === 200, String(r.status));

    console.log('\n== KOP TIDAK DIPAKSA KAPITAL ==');
    r = await save({
      kop_sumber: 'manual', kop_baris: KOP, kop_format: JSON.stringify([]),
      kop_font: '10.5', kop_font_besar: '16.5', kop_rapat: 'tengah', kop_posisi: 'kiri', kop_garis: 'double'
    });
    ok('simpan kop manual', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/rekap/print');
    const html = String(r.body);
    ok('cetak: baris ke-3 tetap huruf campuran', html.includes('Sekolah Menengah Kejuruan PGRI Cikoneng'));
    ok('cetak: tidak ada versi KAPITAL baris sekolah', !html.includes('SEKOLAH MENENGAH KEJURUAN PGRI CIKONENG'));
    ok('cetak: NPSN & alamat apa adanya', html.includes('NPSN: 20211525 TERAKREDITASI: A') &&
      html.includes('Jalan Raya Cikoneng No.144'));
    ok('cetak: tanpa text-transform uppercase', !/text-transform:\s*uppercase/i.test(html));

    const siswa = (await req('/api/siswa')).body.rows?.[0];
    if (siswa) {
      const surat = String((await req(`/api/surat/${siswa.id}?jenis=sp1`)).body);
      ok('surat SP1: teks kop apa adanya', surat.includes('Sekolah Menengah Kejuruan PGRI Cikoneng'));
      ok('surat SP1: tanpa text-transform', !/text-transform:\s*uppercase/i.test(surat));
    } else ok('ada siswa uji', false);

    console.log('\n== KOP OTOMATIS JUGA APA ADANYA ==');
    r = await save({ kop_sumber: 'auto', sekolah_nama: 'SMK PGRI Cikoneng' });
    r = await req('/api/rekap/print');
    ok('kop otomatis: nama sekolah tidak dikapitalkan paksa', String(r.body).includes('SMK PGRI Cikoneng'));
    ok('kop otomatis: baris kontak tidak KAPITAL', !/text-transform:\s*uppercase/i.test(String(r.body)));

    console.log('\n== UKURAN LOGO (LEBAR & TINGGI) ==');
    r = await save({ kop_sumber: 'manual', kop_baris: KOP, kop_logo: 'https://contoh.test/logo.png', kop_logo_w: 170, kop_logo_h: 84 });
    ok('simpan ukuran logo', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/settings');
    ok('lebar logo tersimpan', String(r.body.settings.kop_logo_w) === '170', String(r.body.settings.kop_logo_w));
    ok('tinggi logo tersimpan', String(r.body.settings.kop_logo_h) === '84', String(r.body.settings.kop_logo_h));
    r = await req('/api/rekap/print');
    ok('cetak: logo lebar 170px', /width:170px/.test(String(r.body)));
    ok('cetak: logo tinggi 84px', /height:84px/.test(String(r.body)));

    r = await save({ kop_logo_w: 900 });
    ok('lebar logo > 400 px ditolak', r.status === 400, String(r.status));
    r = await save({ kop_logo_h: 5 });
    ok('tinggi logo < 16 px ditolak', r.status === 400, String(r.status));
    r = await req('/api/settings');
    ok('nilai logo tidak rusak setelah penolakan', String(r.body.settings.kop_logo_w) === '170' &&
      String(r.body.settings.kop_logo_h) === '84', `${r.body.settings.kop_logo_w}/${r.body.settings.kop_logo_h}`);

    r = await save({ kop_logo_w: null, kop_logo_h: '' });
    ok('logo kosong = ikut tinggi logo lama', r.status === 200);
    r = await save({ kop_logo_w: 74, kop_logo_h: 74, kop_tinggi_logo: 74 });

    console.log('\n== MIGRASI KOP MANUAL LAMA (sekali jalan) ==');
    const migDb = path.join(os.tmpdir(), 'stt-kop-mig-' + Date.now() + '.sqlite');
    const runIsolated = (code) => execFileSync(process.execPath, ['-e', code], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: migDb },
      encoding: 'utf8'
    });
    const sql = JSON.stringify(path.join(__dirname, '..', 'db.js'));
    runIsolated(`const dbm=require(${sql});dbm.setSetting('kop_sumber','manual');`
      + `dbm.setSetting('kop_baris','BARIS SATU\\nBARIS DUA\\nNAMA SEKOLAH\\nNPSN: 1\\nJALAN RAYA');`
      + `dbm.setSetting('kop_format','[]');dbm.setSetting('mig_kop_manual_bold_v1','');`);
    const mig1 = runIsolated(`const dbm=require(${sql});console.log(dbm.getSetting('kop_format'));`).trim();
    ok('migrasi: baris ke-4 kop manual lama tetap tebal', /"bold":true/.test(mig1), mig1);
    ok('migrasi: ukuran baris ke-4 memakai font nama sekolah', /"size":16.5/.test(mig1), mig1);
    const mig2 = runIsolated(`const dbm=require(${sql});console.log(dbm.getSetting('kop_format'));`).trim();
    ok('migrasi tidak dijalankan dua kali', mig2 === mig1, mig2);
    try { fs.unlinkSync(migDb); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(migDb + '-wal'); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(migDb + '-shm'); } catch (e) { /* abaikan */ }

    console.log('\n== PENYIMPANAN & PEMBACAAN ULANG ==');
    r = await req('/api/settings');
    ok('kop_baris utuh setelah beberapa penyimpanan', String(r.body.settings.kop_baris).includes('Sekolah Menengah Kejuruan PGRI Cikoneng'));
    ok('kop_sumber tetap manual', String(r.body.settings.kop_sumber) === 'manual');
    ok('data siswa tidak terpengaruh', (await req('/api/siswa')).status === 200);
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
  } finally {
    srv.kill('SIGKILL');
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(DB + '-wal'); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(DB + '-shm'); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL KOP: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
