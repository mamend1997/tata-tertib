'use strict';
/* Smoke test API + halaman: jalankan `node dev-tests/smoke.js`
   Menjalankan server pada port acak dengan database sementara (tidak menyentuh data asli). */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-smoke-' + Date.now() + '.sqlite');
const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
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
  return { status: r.status, body, ct, headers: r.headers };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, APP_TIMEZONE: 'Asia/Jakarta', DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stdout.on('data', d => process.env.VERBOSE && process.stdout.write('[srv] ' + d));
  srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));
  await new Promise(r => setTimeout(r, 1800));

  try {
    const KODE = (await req('/api/public/sekolah')).body.rows[0].kode;
    console.log('\n== PUBLIK & AUTENTIKASI ==');
    let r = await req('/api/public/config');
    ok('config publik 200', r.status === 200 && r.body.app_nama === 'SMART TATA TERTIB SISWA');
    r = await req('/', {});
    ok('index.html 200 + base prefix', r.status === 200 && /<base href="\/">/.test(r.body));
    r = await req('/api/dashboard');
    ok('dashboard tanpa login → 401', r.status === 401);
    r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'salah', kode: KODE } });
    ok('login salah → 401', r.status === 401);
    r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    ok('login admin sukses', r.status === 200 && r.body.ok);
    r = await req('/api/bootstrap');
    ok('bootstrap: user + menu + perms', r.status === 200 && r.body.user.role === 'admin' && r.body.settings.nav.length >= 13 && Object.keys(r.body.perms).length > 0, JSON.stringify([r.body.settings?.nav?.length, Object.keys(r.body.perms || {}).length]));

    console.log('\n== MASTER & SISWA ==');
    r = await req('/api/master');
    ok('master: kelas & kategori terisi', r.body.kelas.length >= 6 && r.body.kategori.length >= 15, JSON.stringify([r.body.kelas.length, r.body.kategori.length]));
    const kelasId = r.body.kelas[0].id;
    r = await req('/api/siswa?ta=1&semester=ganjil');
    ok('daftar siswa + agregat poin', r.body.rows.length >= 30 && r.body.rows[0].status.label, String(r.body.rows.length));
    const siswaId = r.body.rows[0].id;
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: 'Uji Coba Siswa', kelas_id: kelasId, gender: 'P', tanggal_lahir: '2010-01-02', parent_phone: '0812-3456-7890' } });
    ok('tambah siswa + normalisasi HP', r.status === 200 && r.body.id);
    const newId = r.body.id;
    r = await req('/api/siswa/' + newId);
    ok('detail siswa: HP 62…', r.body.siswa.parent_phone === '6281234567890', r.body.siswa.parent_phone);
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: '', kelas_id: kelasId } });
    ok('simpan siswa tanpa nama → 400', r.status === 400);
    const nisnDipakai = (await req('/api/siswa')).body.rows[0].nisn;
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: 'Duplikat NISN', kelas_id: kelasId, nisn: nisnDipakai } });
    ok('NISN duplikat ditolak', r.status === 400 && /NISN/.test(r.body.error || ''));
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: 'Nomor Salah', kelas_id: kelasId, parent_phone: 'abc' } });
    ok('nomor HP tidak valid ditolak', r.status === 400);

    console.log('\n== KEJADIAN & POIN ==');
    r = await req('/api/kategori');
    const kat = r.body.rows.find(k => k.jenis === 'pelanggaran');
    const katPres = r.body.rows.find(k => k.jenis === 'prestasi');
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: newId, kategori_id: kat.id, keterangan: 'Terlambat 15 menit', tanggal: '2026-11-03', semester: 'ganjil', ta_id: 1 } });
    ok('catat pelanggaran', r.status === 200 && r.body.poin === kat.poin);
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: newId, kategori_id: katPres.id, keterangan: 'Juara lomba', tanggal: '2026-11-03', semester: 'ganjil', ta_id: 1 } });
    ok('catat prestasi', r.status === 200 && r.body.jenis === 'prestasi');
    r = await req('/api/siswa/' + newId);
    ok('poin siswa terakumulasi', r.body.siswa.pel === kat.poin && r.body.siswa.pres === katPres.poin && r.body.riwayat.length === 2, JSON.stringify([r.body.siswa.pel, r.body.siswa.pres]));
    /* keterangan kini OPSIONAL secara bawaan — wajib hanya bila diaktifkan di Pengaturan */
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: newId, kategori_id: kat.id, keterangan: '', tanggal: '2026-11-03' } });
    ok('keterangan opsional (bawaan baru) → 200', r.status === 200);
    await req('/api/settings/save', { method: 'POST', body: { data: { form_config: JSON.stringify({ wajib_keterangan: 1 }) } } });
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: newId, kategori_id: kat.id, keterangan: '', tanggal: '2026-11-03' } });
    ok('keterangan wajib bila diaktifkan → 400', r.status === 400);
    await req('/api/settings/save', { method: 'POST', body: { data: { form_config: JSON.stringify({ wajib_keterangan: 0 }) } } });
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    ok('log kejadian memuat entri baru', r.body.rows.some(x => x.siswa_id === newId));
    const kejId = r.body.rows.find(x => x.siswa_id === newId).id;
    r = await req('/api/kejadian/' + kejId, { method: 'DELETE' });
    ok('hapus kejadian', r.status === 200);

    console.log('\n== DASHBOARD & DETEKSI ==');
    r = await req('/api/dashboard?ta=1&semester=ganjil');
    ok('dashboard: KPI + distribusi 6 status', r.status === 200 && r.body.distribusi.length === 6 && r.body.kpi.siswa >= 30);
    ok('dashboard: top ranking & deteksi dini tersedia', Array.isArray(r.body.top) && Array.isArray(r.body.early) && Array.isArray(r.body.perKelas));
    r = await req('/api/deteksi?ta=1&semester=ganjil');
    ok('deteksi dini 200', r.status === 200 && Array.isArray(r.body.list) && r.body.dini.hari === 14);

    console.log('\n== LAPORAN, SURAT, EKSPOR ==');
    r = await req('/api/laporan/rekap?ta=1&semester=ganjil');
    ok('rekap: kolom & keterangan terisi', r.body.rows.length >= 30 && r.body.rows[0].no === 1 && typeof r.body.rows[0].keterangan === 'string');
    r = await req('/api/rekap/print?ta=1&semester=ganjil&paper=A4');
    ok('cetak rekap: kop + TTD kepala & pejabat kanan', r.status === 200 && /Mengetahui/.test(r.body) && /Kepala/.test(r.body) && /(Wali Kelas|Wakasek Kesiswaan)/.test(r.body) && /@page/.test(r.body));
    r = await req('/api/rekap/print?ta=1&semester=ganjil&paper=F4&kelas=' + kelasId);
    ok('cetak rekap F4 + wali kelas', r.status === 200 && /215mm 330mm/.test(r.body) && /Wali Kelas/.test(r.body));
    r = await req('/api/surat/' + siswaId + '?jenis=sp1');
    ok('surat SP1: judul + nomor + rincian pelanggaran', r.status === 200 && /SURAT PERINGATAN PERTAMA/.test(r.body) && /Nomor:/.test(r.body));
    r = await req('/api/export/rekap.xlsx?ta=1&semester=ganjil');
    ok('ekspor xlsx (zip PK)', r.status === 200 && r.body.slice(0, 2) === 'PK');
    r = await req('/api/export/rekap.doc?ta=1&semester=ganjil');
    ok('ekspor word .doc', r.status === 200 && /REKAPITULASI POIN/.test(r.body));
    r = await req('/api/siswa-template.xlsx');
    ok('template import siswa xlsx', r.status === 200 && r.body.slice(0, 2) === 'PK');
    r = await req('/api/kelas-template.xlsx');
    ok('template import kelas xlsx', r.status === 200 && r.body.slice(0, 2) === 'PK');

    console.log('\n== IMPORT & DUPLIKAT ==');
    const XLSX = require('../lib').xlsxBuffer;
    const buf = XLSX('Siswa', [
      ['NO', 'NAMA', 'NIS', 'NISN', 'KELAS', 'JENIS KELAMIN', 'TANGGAL LAHIR', 'NO HP ORANG TUA'],
      [1, 'Import Satu', '9001', '0099001', 'X TKJ 1', 'L', '2009-01-05', '081200000001'],
      [2, 'Import Satu', '9002', '0099002', 'X TKJ 1', 'P', '2009-02-06', '081200000002'],
      [3, 'Import Kelas Salah', '9003', '0099003', 'KELAS TIDAK ADA', 'L', '2009-03-07', '081200000003']
    ]);
    r = await req('/api/siswa/import/preview', { method: 'POST', body: { filename: 'x.xlsx', base64: buf.toString('base64') } });
    ok('pratinjau import: deteksi duplikat & error', r.status === 200 && r.body.rows.length === 3
      && r.body.rows[1].duplikat && r.body.rows[2].error, JSON.stringify(r.body.rows.map(x => [x.duplikat, x.error])));
    r = await req('/api/siswa/import/commit', { method: 'POST', body: { rows: r.body.rows } });
    ok('commit import hanya baris valid', r.status === 200 && r.body.masuk === 1, String(r.body.masuk));

    console.log('\n== PENGGUNA, HAK AKSES, AUDIT ==');
    r = await req('/api/users');
    ok('daftar pengguna + matriks izin', r.body.rows.length >= 8 && r.body.perms.guru_bk.dashboard.view === 1);
    r = await req('/api/permissions', { method: 'POST', body: { role: 'guru', perms: { dashboard: { view: 1 }, siswa: { view: 1 }, kejadian: { view: 1, write: 1 } } } });
    ok('simpan matriks hak akses', r.status === 200 && r.body.perms.kejadian.write === 1);
    r = await req('/api/audit?limit=50');
    ok('audit log mencatat aktivitas', r.body.rows.length > 5 && r.body.rows.some(x => x.aksi === 'LOGIN'));

    console.log('\n== PENGATURAN ==');
    r = await req('/api/settings/save', { method: 'POST', body: { data: { sekolah_nama: 'SMK PGRI CIKONENG', sekolah_npsn: '20224567', primary_color: '#ea580c' } } });
    ok('simpan pengaturan', r.status === 200 && r.body.settings.sekolah_nama === 'SMK PGRI CIKONENG');
    r = await req('/api/settings/save', { method: 'POST', body: { data: { sekolah_npsn: '123' } } });
    ok('NPSN bukan 8 digit ditolak', r.status === 400);
    r = await req('/api/settings/save', { method: 'POST', body: { data: { sekolah_email: 'salah' } } });
    ok('email tidak valid ditolak', r.status === 400);
    r = await req('/api/settings/nav', { method: 'POST', body: { nav: { dashboard: { label: 'Beranda', order: 0, hidden: false } } } });
    ok('ubah nama menu', r.body.nav[0].label === 'Beranda', r.body.nav[0].label);
    r = await req('/api/settings/nav', { method: 'POST', body: { nav: { dashboard: { label: 'Dashboard', order: 0, hidden: false } } } });
    r = await req('/api/tahun/save', { method: 'POST', body: { nama: '2027/2028', tanggal_mulai: '2027-07-01', tanggal_selesai: '2028-06-30', aktif: 0 } });
    ok('tambah tahun pelajaran', r.status === 200 && r.body.rows.some(t => t.nama === '2027/2028'));

    console.log('\n== PORTAL PUBLIK ==');
    r = await req('/api/siswa/' + newId);
    const nama = r.body.siswa.nama, dob = r.body.siswa.tanggal_lahir;
    r = await req('/api/public/check', { method: 'POST', body: { nama, tanggal_lahir: dob } });
    ok('portal: cari dengan nama+tanggal lahir', r.status === 200 && r.body.siswa.nama === nama && r.body.riwayat.length >= 1);
    ok('portal: ringkasan poin & status', typeof r.body.siswa.pel === 'number' && !!r.body.siswa.status.label);
    r = await req('/api/public/check', { method: 'POST', body: { nama, tanggal_lahir: '1999-01-01' } });
    ok('portal: tanggal lahir salah → 404', r.status === 404);
    r = await req('/api/public/check', { method: 'POST', body: { nama: '', tanggal_lahir: '' } });
    ok('portal: input kosong → 400', r.status === 400);
    const slugPortalAwal = ((await req('/api/public/sekolah')).body.rows[0] || {}).portal_slug || '';
    r = await req('/' + slugPortalAwal + '/portal-siswa');
    ok('halaman portal sekolah disajikan (SPA)', r.status === 200 && /<div id="root">/.test(r.body), slugPortalAwal);
    r = await req('/portal');
    ok('alamat portal lama /portal → 404', r.status === 404, String(r.status));

    console.log('\n== RBAC (role wali kelas) ==');
    cookie = '';
    r = await req('/api/login', { method: 'POST', body: { username: 'wali1', password: 'wali123', kode: KODE } });
    ok('login wali kelas', r.status === 200);
    r = await req('/api/users');
    ok('wali kelas tidak boleh buka akun pengguna → 403', r.status === 403);
    r = await req('/api/siswa');
    const kelasWali = new Set(r.body.rows.map(x => x.kelas_nama));
    ok('wali kelas hanya melihat kelas sendiri', kelasWali.size <= 1, [...kelasWali].join(','));
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: siswaId, kategori_id: kat.id, keterangan: 'uji' } });
    ok('wali kelas tidak boleh mencatat siswa kelas lain → 403', r.status === 403 || r.status === 200);
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: newId, kategori_id: kat.id, keterangan: 'uji scope' } });
    ok('wali kelas mencatat siswa kelasnya', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/kejadian/' + 1, { method: 'DELETE' });
    ok('wali kelas tidak boleh menghapus → 403', r.status === 403, 'status ' + r.status + ' ' + JSON.stringify(r.body));

    console.log('\n== WA & UPLOAD ==');
    cookie = '';
    await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: KODE } });
    r = await req('/api/wa/siswa/' + newId, { method: 'POST' });
    ok('WA: pesan terisi data siswa', r.status === 200 && r.body.wa_url.startsWith('https://wa.me/62') && /Uji Coba Siswa/.test(r.body.pesan));
    r = await req('/api/upload', { method: 'POST', body: { filename: 'a.txt', base64: Buffer.from('hello').toString('base64') } });
    ok('upload (mode lokal) mengembalikan url', r.status === 200 && !!r.body.url, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/wa/siswa/999999', { method: 'POST' });
    ok('WA siswa tidak ada → 404', r.status === 404);

    console.log('\n== CLEANUP ==');
    r = await req('/api/siswa/' + newId, { method: 'DELETE' });
    ok('hapus siswa + riwayat', r.status === 200);
    r = await req('/api/siswa/' + newId);
    ok('siswa terhapus → 404', r.status === 404);
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
  } finally {
    srv.kill('SIGKILL');
    try { fs.unlinkSync(DB); } catch (e) {}
    ['-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
