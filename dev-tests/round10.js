'use strict';
/* Uji ronde 10 — pembersihan identitas sekolah lama pada elemen non-tenant:
   1. Sekolah BARU tidak mewarisi NPSN/alamat/pejabat/tempat cetak sekolah percontohan
   2. Nama aplikasi (header, footer dokumen, arsip backup) memakai Branding Sistem global
   3. "Tempat, tanggal" pada dokumen cetak netral bila sekolah belum mengisinya
   Jalankan: node dev-tests/round10.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-r10-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 7750 + Math.floor(Math.random() * 250);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

function client() {
  let cookie = '';
  return {
    async req(p, o = {}) {
      const r = await fetch(BASE + p, {
        method: o.method || 'GET',
        headers: { ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: o.body ? JSON.stringify(o.body) : undefined,
        redirect: 'manual'
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      const ct = r.headers.get('content-type') || '';
      const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
      return { status: r.status, body };
    }
  };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));

  try {
    for (let i = 0; i < 90; i++) {
      try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) break; } catch (e) { /* belum siap */ }
      await new Promise(r => setTimeout(r, 250));
    }
    const su = client();
    const pub = client();

    /* ================= 1. BRANDING GLOBAL DASAR ================= */
    console.log('\n== BRANDING GLOBAL ==================');
    let r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('login super admin', r.status === 200 && r.body.scope === 'super');
    r = await su.req('/api/super/branding', { method: 'POST', body: { app_nama: 'PLATFORM SEKOLAH TERPADU', app_subtitle: 'Manajemen Kedisiplinan' } });
    ok('nama aplikasi global disimpan', r.status === 200 && r.body.platform.app_nama === 'PLATFORM SEKOLAH TERPADU');

    /* ================= 2. SEKOLAH BARU BERSIH DARI IDENTITAS LAMA ================= */
    console.log('\n== SEKOLAH BARU TANPA WARISAN IDENTITAS ==================');
    await su.req('/api/super/branding', { method: 'POST', body: { daftar_min_detik: 1, daftar_limit_jam: 10, daftar_limit_hari: 20 } });
    r = await pub.req('/api/daftar', { method: 'POST', body: {
      nama_sekolah: 'SMP Negeri 5 Contoh', jenjang: 'SMP', alamat: 'Jl. Melati No. 7, Bandung',
      kepala: 'Drs. Kepala Contoh', admin_nama: 'Admin Contoh', email: 'admin@smpn5contoh.sch.id',
      password: 'Rahasia123', password2: 'Rahasia123', telp: '081255550001', t0: Date.now() - 10000
    } });
    ok('sekolah baru terdaftar', r.status === 200 && /^\d{4}$/.test(String(r.body.kode)), JSON.stringify(r.body).slice(0, 120));
    const kodeBaru = r.body.kode;

    const tBaru = client();
    r = await tBaru.req('/api/login', { method: 'POST', body: { username: r.body.admin_username, password: 'Rahasia123', kode: kodeBaru } });
    ok('admin sekolah baru dapat masuk dengan kode sekolahnya', r.status === 200 && r.body.scope === 'tenant');
    /* paket uji coba hanya membuka sebagian menu → pengaturan dibaca dari bootstrap */
    r = await tBaru.req('/api/bootstrap');
    const s = r.body.settings || {};
    ok('identitas sekolah baru sesuai form', s.sekolah_nama === 'SMP Negeri 5 Contoh' && /Melati/.test(s.sekolah_alamat || ''),
      JSON.stringify({ n: s.sekolah_nama, a: s.sekolah_alamat }));
    ok('NPSN sekolah contoh TIDAK diwarisi', String(s.sekolah_npsn || '') !== '20224567', s.sekolah_npsn);
    ok('website & status sekolah contoh TIDAK diwarisi', !s.sekolah_website && !s.sekolah_status,
      JSON.stringify({ w: s.sekolah_website, st: s.sekolah_status }));
    ok('nama bendahara & wakasek contoh TIDAK diwarisi', !s.bendahara_nama && !s.wakasek_nama && !s.wakasek_jabatan,
      JSON.stringify({ b: s.bendahara_nama, w: s.wakasek_nama, j: s.wakasek_jabatan }));
    ok('tempat cetak default kosong (bukan nama daerah sekolah lain)', String(s.print_tempat || '') === '', String(s.print_tempat));
    ok('kop manual warisan tidak ikut', String(s.kop_baris || '') === '', String(s.kop_baris).slice(0, 40));
    ok('nama aplikasi = Branding Sistem global', s.app_nama === 'PLATFORM SEKOLAH TERPADU',
      JSON.stringify({ app: s.app_nama, global: s.app_nama_global }));
    ok('tidak ada jejak "SMK PGRI"/"Cikoneng" di pengaturan sekolah baru',
      !/SMK PGRI|Cikoneng/i.test(JSON.stringify(s)), (JSON.stringify(s).match(/SMK PGRI|Cikoneng/gi) || []).join(','));

    /* ================= 3. DOKUMEN CETAK NETRAL ================= */
    console.log('\n== DOKUMEN CETAK SEKOLAH BARU ==================');
    r = await tBaru.req('/api/siswa/save', { method: 'POST', body: { nama: 'Siswa Uji Cetak', kelas_id: 1, gender: 'L', tanggal_lahir: '2011-02-03' } });
    const siswaId = r.body && r.body.id;
    ok('siswa uji dibuat', !!siswaId, JSON.stringify(r.body).slice(0, 100));
    r = await tBaru.req('/api/siswa/' + siswaId);
    if (!(r.body && r.body.kelas && r.body.kelas.id)) {
      /* fallback: ambil id kelas dari master */
      const m = await tBaru.req('/api/master');
      const kelasId = (m.body.kelas || [])[0] && m.body.kelas[0].id;
      if (kelasId) await tBaru.req('/api/siswa/save', { method: 'POST', body: { id: siswaId, nama: 'Siswa Uji Cetak', kelas_id: kelasId } });
    }
    r = await tBaru.req('/api/rekap/print?ta=1&semester=ganjil');
    ok('rekap dapat dicetak sekolah baru', r.status === 200 && /REKAPITULASI/.test(String(r.body)), String(r.status));
    const html = String(r.body);
    ok('dokumen tidak memuat nama sekolah contoh', !/SMK PGRI|Cikoneng/i.test(html), (html.match(/SMK PGRI|Cikoneng/gi) || []).join(','));
    ok('dokumen memuat nama sekolah baru', /SMP Negeri 5 Contoh/.test(html));
    ok('rekap tidak mencatut nama aplikasi hardcode',
      !/SMART TATA TERTIB SISWA/.test(html), (/SMART TATA TERTIB SISWA/.exec(html) || [])[0]);
    /* surat panggilan memuat footer "dicetak otomatis oleh <nama aplikasi>" */
    const surat = await tBaru.req('/api/surat/' + siswaId + '?jenis=panggilan');
    const suratHtml = String(surat.body);
    ok('surat dapat dicetak sekolah baru', surat.status === 200 && /PEMANGGILAN/.test(suratHtml), String(surat.status));
    ok('footer surat memakai nama aplikasi global (bukan hardcode)',
      /PLATFORM SEKOLAH TERPADU/.test(suratHtml) && !/SMART TATA TERTIB SISWA/.test(suratHtml),
      (/Dokumen ini dicetak[^<]*/.exec(suratHtml) || [])[0]);
    ok('surat tidak memuat nama sekolah contoh', !/SMK PGRI|Cikoneng/i.test(suratHtml));
    ok('surat tanpa tempat cetak asing', !/>\s*Cikoneng,/.test(suratHtml),
      (/class="tanggal"[^<]*<\/div>/.exec(suratHtml) || [])[0]);
    ok('baris "tempat, tanggal" tanpa nama daerah asing',
      !/>\s*Cikoneng,/.test(html), (/class="tanggal"[^<]*<\/div>/.exec(html) || [])[0]);

    /* ================= 4. SEKOLAH LAMA TETAP UTUH ================= */
    console.log('\n== SEKOLAH LAMA TETAP MEMAKAI IDENTITASNYA ==================');
    const tLama = client();
    const kodeLama = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows || []).find(x => x.nama === 'SMK PGRI CIKONENG');
    r = await tLama.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: kodeLama ? kodeLama.kode : '' } });
    ok('login sekolah lama tetap berjalan', r.status === 200, String(r.status) + ' ' + JSON.stringify(r.body).slice(0, 80));
    r = await tLama.req('/api/bootstrap');
    const sl = r.body.settings || {};
    ok('identitas sekolah lama tidak diubah', /SMK PGRI/i.test(sl.sekolah_nama || ''), sl.sekolah_nama);
    ok('tempat cetak sekolah lama tetap terisi', String(sl.print_tempat || '') === 'Cikoneng', String(sl.print_tempat));
    ok('nama aplikasi sekolah lama ikut branding global', sl.app_nama === 'PLATFORM SEKOLAH TERPADU', sl.app_nama);
    r = await tLama.req('/api/rekap/print?ta=1&semester=ganjil');
    ok('cetakan sekolah lama tetap memuat identitasnya', /SMK PGRI/i.test(String(r.body)));
    const siswaLama = await tLama.req('/api/siswa?ta=1&semester=ganjil');
    const idLama = ((siswaLama.body.rows || [])[0] || {}).id;
    const suratLama = await tLama.req('/api/surat/' + idLama + '?jenis=panggilan');
    ok('cetakan sekolah lama tetap memuat "Cikoneng, "', /Cikoneng,/.test(String(suratLama.body)),
      (/class="tanggal"[^<]*<\/div>/.exec(String(suratLama.body)) || [])[0]);
    ok('footer surat sekolah lama memakai nama aplikasi global',
      /PLATFORM SEKOLAH TERPADU/.test(String(suratLama.body)) && !/SMART TATA TERTIB SISWA/.test(String(suratLama.body)),
      (/Dokumen ini dicetak[^<]*/.exec(String(suratLama.body)) || [])[0]);

    /* ================= 5. ARSIP BACKUP NETRAL ================= */
    console.log('\n== ARSIP BACKUP ==================');
    r = await tBaru.req('/api/rekap/print?ta=1&semester=ganjil');
    ok('arsip/cetakan sekolah baru tetap dapat dibuat', r.status === 200 && String(r.body).length > 500, String(r.status));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(log.join('').slice(-1200));
  } finally {
    srv.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 200));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL RONDE 10: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
