'use strict';
/* Uji fitur ronde lanjutan: bulk action, import akun, profil, tindak lanjut,
   jurnal, analitik pola, sanksi otomatis, role baru, dan tanda tangan cetak.
   Jalankan: node dev-tests/round2.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-r2-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r2-saas-' + Date.now() + '.sqlite');
const PORT = 4800 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
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
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  return { status: r.status, body, ct };
}
async function reqBuffer(p) {
  const r = await fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || '' };
}
const login = async (u, p) => { cookie = ''; return req('/api/login', { method: 'POST', body: { username: u, password: p, kode: KODE } }); };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1800));

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');

    console.log('\n== ROLE BARU & HAK AKSES ==');
    let r = await req('/api/bootstrap');
    const roles = r.body.roles.map(x => x.key);
    ok('role guru_umum & tu tersedia', roles.includes('guru_umum') && roles.includes('tu'), roles.join(','));
    ok('fitur baru terdaftar (jurnal, tindak_lanjut, analitik)',
      ['jurnal', 'tindak_lanjut', 'analitik'].every(k => r.body.features.some(f => f.key === k)));
    ok('lokasi default & aturan sanksi terbawa ke bootstrap',
      Array.isArray(r.body.settings.lokasi) && r.body.settings.lokasi.length >= 5 && r.body.settings.sanksi_rules.length >= 3);
    const matriks = await req('/api/users');
    const pGuruUmum = matriks.body.perms.guru_umum;
    const pTu = matriks.body.perms.tu;
    ok('guru_umum boleh lapor kejadian + jurnal, tidak boleh hapus',
      pGuruUmum.kejadian.write === 1 && pGuruUmum.jurnal.write === 1 && pGuruUmum.kejadian.delete === 0,
      JSON.stringify(pGuruUmum.kejadian));
    ok('tu boleh jurnal & laporan', pTu.jurnal.write === 1 && pTu.laporan.view === 1);
    ok('guru BK punya izin tindak lanjut', matriks.body.perms.guru_bk.tindak_lanjut.write === 1);

    console.log('\n== BULK ACTION SISWA ==');
    r = await req('/api/siswa?ta=1&semester=ganjil');
    const ids = r.body.rows.slice(0, 3).map(x => x.id);
    const kelasId = r.body.rows.find(x => x.id === ids[0]).kelas_id;
    r = await req('/api/kelas');
    const kelasTujuan = r.body.rows.find(k => k.id !== kelasId);
    r = await req('/api/siswa/bulk', { method: 'POST', body: { aksi: 'kelas', ids, kelas_id: kelasTujuan.id } });
    ok('pindah kelas masal', r.status === 200 && r.body.jumlah === 3, JSON.stringify(r.body));
    r = await req('/api/siswa?ta=1&semester=ganjil');
    ok('siswa benar-benar pindah kelas', r.body.rows.filter(x => ids.includes(x.id)).every(x => x.kelas_id === kelasTujuan.id));
    r = await req('/api/siswa/bulk', { method: 'POST', body: { aksi: 'kelas', ids: [], kelas_id: kelasTujuan.id } });
    ok('bulk tanpa pilihan ditolak', r.status === 400);
    r = await req('/api/siswa/bulk', { method: 'POST', body: { aksi: 'delete', ids: ids.slice(0, 2) } });
    ok('hapus siswa masal', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body));
    r = await req('/api/siswa/' + ids[0]);
    ok('siswa terpilih benar-benar terhapus', r.status === 404);

    console.log('\n== IMPORT AKUN GURU ==');
    const templateUsers = await reqBuffer('/api/users-template.xlsx');
    ok('template akun guru xlsx', templateUsers.status === 200 && templateUsers.buf.slice(0, 2).toString() === 'PK');
    r = await req('/api/users/import/preview', { method: 'POST', body: {
      filename: 'template-akun.xlsx', base64: templateUsers.buf.toString('base64')
    } });
    ok('template akun sendiri terbaca tanpa petunjuk ikut diimpor',
      r.status === 200 && r.body.rows.length === 2
        && r.body.rows.some(x => x.username === 'wawan')
        && r.body.rows.some(x => x.username === 'lina'),
      JSON.stringify(r.body?.rows?.map(x => x.username)));
    const XLSX = require('../lib').xlsxBuffer;
    const buf = XLSX('Akun', [
      ['NO', 'NAMA', 'JABATAN', 'USERNAME', 'ROLE', 'NIP', 'NO HP', 'KATA SANDI'],
      [1, 'Guru Import Satu', 'Guru Piket', 'import1', 'Guru Umum', '111', '081200000010', ''],
      [2, 'Staf Import Dua', 'TU', 'import2', 'Tenaga Administrasi (TU)', '112', '081200000011', 'rahasia123'],
      [3, 'Username Dobel', 'TU', 'admin', 'Tenaga Administrasi (TU)', '113', '', ''],
      [4, 'Role Salah', 'X', 'import4', 'Role Ngawur', '114', '', '']
    ]);
    r = await req('/api/users/import/preview', { method: 'POST', body: { filename: 'a.xlsx', base64: buf.toString('base64') } });
    ok('pratinjau import akun: role dipetakan', r.body.rows[0].role === 'guru_umum' && r.body.rows[1].role === 'tu', JSON.stringify(r.body.rows.map(x => x.role)));
    ok('pratinjau deteksi username ganda & role asing', r.body.rows[2].duplikat && r.body.rows[3].error, JSON.stringify(r.body.rows.map(x => [x.duplikat, x.error])));
    r = await req('/api/users/import/commit', { method: 'POST', body: { rows: r.body.rows } });
    ok('commit import hanya baris valid', r.status === 200 && r.body.masuk === 2, String(r.body.masuk));
    r = await req('/api/users');
    const imported = r.body.rows.filter(u => ['import1', 'import2'].includes(u.username));
    ok('akun import masuk dengan role benar', imported.length === 2 && imported.some(u => u.role === 'guru_umum'));
    const importedIds = imported.map(u => u.id);
    r = await req('/api/users/bulk-delete', { method: 'POST', body: { ids: importedIds } });
    ok('hapus akun masal', r.status === 200 && r.body.jumlah === 2);
    r = await req('/api/users');
    ok('akun import terhapus', !r.body.rows.some(u => importedIds.includes(u.id)));

    console.log('\n== LOGIN & PROFIL ==');
    cookie = '';
    r = await req('/api/login', { method: 'POST', body: { username: 'guruumum', password: 'guruumum123', kode: KODE } });
    ok('login akun Guru Umum', r.status === 200);
    r = await req('/api/bootstrap');
    ok('bootstrap memuat username & foto untuk profil', typeof r.body.user.username === 'string' && 'foto' in r.body.user);
    r = await req('/api/profile/save', { method: 'POST', body: { nama: 'Wawan Setiawan, S.Pd.', username: 'guruumum', phone: '081234567808' } });
    ok('simpan profil (nama & username)', r.status === 200 && r.body.user.username === 'guruumum');
    r = await req('/api/profile/save', { method: 'POST', body: { nama: 'X', username: 'admin' } });
    ok('username milik akun lain ditolak', r.status === 400 && /Username/.test(r.body.error));
    r = await req('/api/profile/save', { method: 'POST', body: { nama: 'Wawan', username: 'guruumum', password: 'baru12345' } });
    ok('ganti sandi tanpa sandi lama ditolak', r.status === 400 && /saat ini/.test(r.body.error));
    r = await req('/api/profile/save', { method: 'POST', body: { nama: 'Wawan Setiawan, S.Pd.', username: 'guruumum', password: 'baru12345', password_lama: 'salah' } });
    ok('sandi lama salah ditolak', r.status === 400);
    r = await req('/api/profile/save', { method: 'POST', body: { nama: 'Wawan Setiawan, S.Pd.', username: 'guruumum', password: 'baru12345', password_lama: 'guruumum123', password_ulang: 'baru12345' } });
    ok('ganti sandi dengan sandi lama benar', r.status === 200);
    cookie = '';
    r = await req('/api/login', { method: 'POST', body: { username: 'guruumum', password: 'baru12345', kode: KODE } });
    ok('login dengan sandi baru', r.status === 200);

    console.log('\n== BUKU PENGHUBUNG (JURNAL) ==');
    r = await req('/api/siswa-options');
    const siswa1 = r.body.rows[0];
    r = await req('/api/master');
    const kat = r.body.kategori.find(k => k.jenis === 'pelanggaran');
    r = await req('/api/jurnal/save', {
      method: 'POST',
      body: { siswa_id: siswa1.id, kategori_id: kat.id, jenis: 'pelanggaran', lokasi: 'Gerbang Sekolah', jam: '07:05', keterangan: 'Terlambat masuk gerbang' }
    });
    ok('guru umum mencatat temuan dari buku penghubung', r.status === 200 && r.body.kejadian_id > 0, JSON.stringify(r.body));
    ok('temuan langsung merekomendasikan sanksi (jika ambang tercapai)', 'sanksi' in r.body);
    r = await req('/api/jurnal');
    ok('jurnal menampilkan entri hari ini', r.body.hari_ini.length >= 1 && r.body.rows.some(x => x.lokasi === 'Gerbang Sekolah'));
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    ok('temuan muncul di log kejadian dengan lokasi & jam',
      r.body.rows.some(x => x.lokasi === 'Gerbang Sekolah' && x.jam === '07:05'));
    /* keterangan kini OPSIONAL (perubahan disengaja) — pengujian "wajib bila
       diaktifkan" dilakukan oleh admin pada dev-tests/round12.js */
    r = await req('/api/jurnal/save', { method: 'POST', body: { siswa_id: siswa1.id, kategori_id: kat.id, keterangan: '' } });
    ok('jurnal tanpa keterangan diterima (opsional)', r.status === 200);

    console.log('\n== TINDAK LANJUT (KHUSUS BK / KESISWAAN) ==');
    cookie = '';
    await login('guruumum', 'baru12345');
    r = await req('/api/tindak-lanjut');
    ok('guru umum tidak boleh membuka tindak lanjut → 403', r.status === 403);
    cookie = '';
    await login('bk', 'bk12345');
    r = await req('/api/tindak-lanjut');
    ok('guru BK dapat membaca tindak lanjut', r.status === 200 && Array.isArray(r.body.rows) && r.body.jenis.length >= 4);
    const sebelum = r.body.rows.length;
    r = await req('/api/tindak-lanjut/save', {
      method: 'POST',
      body: {
        siswa_id: siswa1.id, tanggal: '2026-11-04 09:30', jenis: 'Konseling Individual',
        hasil: 'Dialog dengan siswa: komitmen memperbaiki keterlambatan, orang tua dihubungi.',
        status: 'pemantauan', next_at: '2026-11-11'
      }
    });
    ok('simpan catatan tindak lanjut', r.status === 200 && r.body.id > 0);
    r = await req('/api/tindak-lanjut');
    ok('catatan masuk riwayat + statistik', r.body.rows.length === sebelum + 1 && r.body.stats.total === sebelum + 1);
    const tlId = r.body.rows[0].id;
    r = await req('/api/tindak-lanjut/save', { method: 'POST', body: { siswa_id: siswa1.id, jenis: 'Mediasi', hasil: '' } });
    ok('hasil catatan wajib diisi', r.status === 400);
    r = await req('/api/siswa/' + siswa1.id);
    ok('riwayat pembinaan muncul pada kartu siswa', Array.isArray(r.body.pembinaan) && r.body.pembinaan.length >= 1);
    ok('kartu siswa memuat rekomendasi sanksi', 'sanksi' in r.body.siswa);
    r = await req('/api/tindak-lanjut/' + tlId, { method: 'DELETE' });
    ok('guru BK boleh menghapus catatan', r.status === 200);

    console.log('\n== ANALITIK POLA & LOKASI ==');
    cookie = '';
    await login('admin', 'admin123');
    r = await req('/api/analitik?ta=1&semester=ganjil');
    ok('analitik: pola hari/jam/lokasi', r.status === 200 && r.body.pola.byDay.length === 7
      && r.body.pola.byHour.length === 13 && r.body.pola.byLokasi.length > 0);
    ok('analitik: insight teratas tersedia', !!r.body.pola.hariRawan[0] && !!r.body.pola.jamRawan[0] && !!r.body.pola.lokasiRawan[0],
      JSON.stringify(r.body.pola.lokasiRawan[0]));
    ok('analitik: sebaran sanksi & status', r.body.sanksiRekap.length > 0 && r.body.statusDist.length === 6);
    r = await req('/api/dashboard?ta=1&semester=ganjil');
    ok('dashboard memuat pola + alert siaga/kritis + rekap sanksi',
      !!r.body.pola && Array.isArray(r.body.alerts) && Array.isArray(r.body.sanksiRekap));
    ok('dashboard: siswa siaga/kritis terdeteksi', r.body.alerts.length > 0 && ['siaga', 'kritis', 'waspada'].includes(r.body.alerts[0].level),
      JSON.stringify(r.body.alerts[0] && r.body.alerts[0].level));

    console.log('\n== ATURAN SANKSI OTOMATIS ==');
    r = await req('/api/settings/save', {
      method: 'POST',
      body: { data: { sanksi_rules: JSON.stringify([
        { id: 'a', min: 10, label: 'Teguran Lisan', surat: '', catatan: 'Peringatan lisan wali kelas' },
        { id: 'b', min: 30, label: 'Surat Peringatan 1', surat: 'sp1', catatan: 'SP1' }
      ]) } }
    });
    ok('simpan aturan sanksi kustom', r.status === 200 && r.body.settings.sanksi_rules.length === 2);
    r = await req('/api/siswa?ta=1&semester=ganjil');
    const dengan10 = r.body.rows.find(x => x.pel >= 10 && x.pel < 30);
    const dengan30 = r.body.rows.find(x => x.pel >= 30);
    ok('rekomendasi menyesuaikan ambang baru',
      (!dengan10 || dengan10.sanksi.label === 'Teguran Lisan') && (!dengan30 || dengan30.sanksi.label === 'Surat Peringatan 1'));
    r = await req('/api/settings/save', { method: 'POST', body: { data: { sanksi_rules: '[]' } } });
    ok('aturan sanksi kosong ditolak', r.status === 400);

    console.log('\n== LOKASI DI PENGATURAN ==');
    r = await req('/api/settings/save', { method: 'POST', body: { data: { lokasi_list: JSON.stringify(['Gerbang Sekolah', 'Kantin', 'Ruang Guru']) } } });
    /* opsi "Lainnya" selalu ditambahkan otomatis oleh server → daftar 3 + 1 */
    ok('simpan daftar lokasi', r.status === 200 && r.body.settings.lokasi.filter(l => l !== 'Lainnya').length === 3,
      JSON.stringify(r.body.settings.lokasi));
    r = await req('/api/master');
    ok('master memuat lokasi terbaru', r.body.lokasi.includes('Ruang Guru'));
    r = await req('/api/kejadian/save', {
      method: 'POST', body: { siswa_id: siswa1.id, kategori_id: kat.id, keterangan: 'Uji lokasi', tanggal: '2026-11-04', jam: '09:45', lokasi: 'Ruang Guru' }
    });
    ok('kejadian menyimpan jam & lokasi', r.status === 200);
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    ok('jam & lokasi tersimpan pada log', r.body.rows.some(x => x.lokasi === 'Ruang Guru' && x.jam === '09:45'));

    console.log('\n== TANDA TANGAN CETAK (KEPSEK & WAKASEK) ==');
    r = await req('/api/settings/save', {
      method: 'POST', body: { data: { kepala_nama: 'KEPSEK RESMI', kepala_nip: '111222', wakasek_nama: 'WAKASEK RESMI', wakasek_nip: '333444', wakasek_jabatan: 'Wakasek Kesiswaan' } }
    });
    ok('simpan data wakasek kesiswaan', r.status === 200 && r.body.settings.wakasek_nama === 'WAKASEK RESMI');
    r = await req('/api/rekap/print?ta=1&semester=ganjil&paper=A4');
    ok('cetak rekap: kolom Kepala Sekolah dari identitas', /KEPSEK RESMI/.test(r.body) && /NIP\. 111222/.test(r.body));
    ok('cetak rekap: kolom Wakasek Kesiswaan dari identitas', /WAKASEK RESMI/.test(r.body) && /NIP\. 333444/.test(r.body));
    ok('cetak rekap: tidak memakai nama akun login', !/Administrator Sistem<\/div>\s*<div class="nip">NIP\. -/.test(r.body));
    r = await req('/api/export/rekap.doc?ta=1&semester=ganjil');
    ok('ekspor Word memakai data wakasek', /WAKASEK RESMI/.test(r.body) && /KEPSEK RESMI/.test(r.body));

    console.log('\n== RBAC ROLE BARU ==');
    cookie = '';
    await login('tu', 'tu123456');
    r = await req('/api/jurnal');
    ok('TU dapat membuka buku penghubung', r.status === 200);
    r = await req('/api/users');
    ok('TU tidak boleh mengelola akun → 403', r.status === 403);
    r = await req('/api/tindak-lanjut');
    ok('TU tidak boleh tindak lanjut → 403', r.status === 403);
    r = await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: siswa1.id, kategori_id: kat.id, keterangan: 'Laporan TU' } });
    ok('TU boleh melaporkan temuan pelanggaran', r.status === 200);

    console.log('\n== PORTAL & LOGIN ==');
    r = await req('/api/public/config');
    ok('config publik memuat identitas wakasek', /WAKASEK RESMI/.test(r.body.wakasek_nama || ''));
    const cekSiswa = await req('/api/siswa?ta=1&semester=ganjil');
    const target = cekSiswa.body.rows[0];
    r = await req('/api/public/check', { method: 'POST', body: { nama: target.nama, tanggal_lahir: target.tanggal_lahir } });
    ok('portal publik tetap berjalan', r.status === 200 && !!r.body.siswa.status.label, JSON.stringify(r.body).slice(0, 120));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
  } finally {
    srv.kill('SIGKILL');
    ['', '-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL RONDE 2: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
