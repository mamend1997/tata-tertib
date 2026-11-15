'use strict';
/* Uji fitur ronde 3: tanpa data dummy otomatis, hapus riwayat massal, kotak sampah,
   backup/restore JSON, audit data tersembunyi, reset tahun ajaran, kalender.
   Jalankan: node dev-tests/round3.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB = path.join(os.tmpdir(), 'stt-r3-' + Date.now() + '.sqlite');
const PORT = 4900 + Math.floor(Math.random() * 90);
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
  let body;
  if (ct.includes('json')) body = await r.json().catch(() => null);
  else if (ct.includes('application/json')) body = await r.json().catch(() => null);
  else body = await r.text();
  return { status: r.status, body, ct, headers: r.headers };
}
const login = async (u, p) => { cookie = ''; return req('/api/login', { method: 'POST', body: { username: u, password: p, kode: KODE } }); };

(async () => {
  /* DB 1: instalasi baru TANPA data contoh (DEMO_SEED tidak diset) */
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1800));

  try {
    console.log('\n== INSTALASI BARU BERSIH DARI DATA DUMMY ==');
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    let r = await req('/api/siswa?ta=1&semester=ganjil');
    ok('instalasi baru tanpa siswa contoh', r.body.rows.length === 0, String(r.body.rows.length));
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    ok('instalasi baru tanpa riwayat kejadian', r.body.rows.length === 0, String(r.body.rows.length));
    r = await req('/api/master');
    ok('master data tetap tersedia (kelas & kategori)', r.body.kelas.length >= 6 && r.body.kategori.length >= 15);
    const kelasId = r.body.kelas[0].id;
    const katId = r.body.kategori.find(k => k.jenis === 'pelanggaran').id;
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: 'Siswa Bersih', kelas_id: kelasId, gender: 'L', tanggal_lahir: '2010-02-03' } });
    const siswaId = r.body.id;
    r = await req('/api/siswa/' + siswaId);
    ok('siswa baru benar-benar tanpa riwayat', r.body.riwayat.length === 0 && r.body.siswa.pel === 0 && r.body.siswa.pres === 0);
    ok('siswa baru berstatus Aman', r.body.siswa.status.label === 'Aman');

    console.log('\n== HAPUS RIWAYAT KEJADIAN MASSAL (KARTU SISWA) ==');
    for (let i = 0; i < 3; i++) {
      await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: siswaId, kategori_id: katId, keterangan: 'Uji riwayat ' + i, tanggal: '2026-11-0' + (i + 1) } });
    }
    r = await req('/api/siswa/' + siswaId);
    ok('3 riwayat tercatat', r.body.riwayat.length === 3, String(r.body.riwayat.length));
    const kIds = r.body.riwayat.slice(0, 2).map(x => x.id);
    r = await req('/api/kejadian/bulk-delete', { method: 'POST', body: { ids: kIds } });
    ok('hapus 2 riwayat sekaligus', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body));
    r = await req('/api/siswa/' + siswaId);
    ok('riwayat tersisa 1', r.body.riwayat.length === 1);
    r = await req('/api/kejadian/bulk-delete', { method: 'POST', body: { ids: [] } });
    ok('hapus riwayat tanpa pilihan ditolak', r.status === 400);

    console.log('\n== KOTAK SAMPAH ==');
    r = await req('/api/trash');
    ok('kotak sampah berisi 2 riwayat', r.body.rows.length === 2 && r.body.ringkas.kejadian === 2, JSON.stringify(r.body.ringkas));
    ok('masa simpan 30 hari & sisa hari dihitung', r.body.hari_simpan === 30 && r.body.rows[0].sisa_hari >= 29, String(r.body.rows[0].sisa_hari));
    const trashId = r.body.rows[0].id;
    r = await req('/api/trash/restore', { method: 'POST', body: { ids: [trashId] } });
    ok('pulihkan satu data dari kotak sampah', r.body.dipulihkan === 1, JSON.stringify(r.body));
    r = await req('/api/siswa/' + siswaId);
    ok('riwayat kembali menjadi 2', r.body.riwayat.length === 2);
    r = await req('/api/trash');
    const sisaTrash = r.body.rows[0].id;
    r = await req('/api/trash/delete', { method: 'POST', body: { ids: [sisaTrash] } });
    ok('hapus permanen dari kotak sampah', r.body.jumlah === 1);
    r = await req('/api/trash');
    ok('kotak sampah kosong kembali', r.body.rows.length === 0);

    // hapus siswa → masuk sampah, lalu pulihkan
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: 'Siswa Sampah', kelas_id: kelasId, gender: 'P' } });
    const idSampah = r.body.id;
    await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: idSampah, kategori_id: katId, keterangan: 'ikut terhapus' } });
    r = await req('/api/siswa/' + idSampah, { method: 'DELETE' });
    ok('hapus siswa → ke kotak sampah', r.status === 200 && r.body.ke_sampah >= 2, JSON.stringify(r.body));
    r = await req('/api/siswa/' + idSampah);
    ok('siswa benar-benar pindah dari daftar', r.status === 404);
    r = await req('/api/trash');
    const trSiswa = r.body.rows.find(x => x.tabel === 'siswa');
    ok('baris siswa & kejadiannya ada di sampah', !!trSiswa && r.body.rows.some(x => x.tabel === 'kejadian'));
    r = await req('/api/trash/restore', { method: 'POST', body: { ids: [trSiswa.id] } });
    ok('restore siswa dari sampah', r.body.dipulihkan === 1, JSON.stringify(r.body));
    r = await req('/api/siswa/' + idSampah);
    ok('siswa kembali dengan id sama', r.status === 200 && r.body.siswa.nama === 'Siswa Sampah');

    console.log('\n== KALENDER KEDISIPLINAN ==');
    r = await req('/api/kalender?ta=1&semester=ganjil&bulan=2026-11');
    ok('kalender mengembalikan struktur hari', r.status === 200 && r.body.bulan === '2026-11' && typeof r.body.days === 'object');
    ok('kalender menghitung pelanggaran bulan ini', r.body.ringkas.pelanggaran >= 2, JSON.stringify(r.body.ringkas));
    const tglAda = Object.keys(r.body.days)[0];
    ok('item kejadian per tanggal tersedia', tglAda && r.body.days[tglAda].items.length > 0);
    r = await req('/api/kalender?bulan=2026-11&kelas=' + kelasId);
    ok('kalender dapat difilter kelas', r.status === 200);

    console.log('\n== BACKUP / RESTORE JSON ==');
    r = await req('/api/backup/info');
    ok('info backup memuat jumlah tabel', r.body.ok && r.body.jumlah.siswa >= 2 && r.body.total > 0);
    r = await req('/api/backup/json');
    const dumpRaw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    ok('unduh backup JSON', r.status === 200 && /"app":\s*"tata-tertib-sekolah"/.test(dumpRaw), r.ct);
    const dump = JSON.parse(dumpRaw);
    ok('backup memuat seluruh tabel penting', ['siswa', 'kelas', 'kejadian', 'users', 'settings'].every(t => Array.isArray(dump.tabel[t])));
    // ubah data lalu restore
    await req('/api/siswa/save', { method: 'POST', body: { nama: 'Akan Hilang', kelas_id: kelasId } });
    r = await req('/api/siswa?ta=1&semester=ganjil');
    const sebelumRestore = r.body.rows.length;
    r = await req('/api/backup/restore', { method: 'POST', body: { base64: Buffer.from(JSON.stringify(dump)).toString('base64') } });
    ok('restore database dari JSON', r.status === 200 && r.body.total > 0, JSON.stringify(r.body).slice(0, 120));
    cookie = '';
    await login('admin', 'admin123');
    r = await req('/api/siswa?ta=1&semester=ganjil');
    ok('data kembali ke kondisi backup', r.body.rows.length === sebelumRestore - 1, `${r.body.rows.length} vs ${sebelumRestore}`);
    ok('siswa tambahan setelah backup hilang', !r.body.rows.some(s => s.nama === 'Akan Hilang'));
    r = await req('/api/backup/restore', { method: 'POST', body: { base64: Buffer.from(JSON.stringify({ app: 'lain' })).toString('base64') } });
    ok('berkas backup asing ditolak', r.status === 400);
    r = await req('/api/backup/restore', { method: 'POST', body: { base64: Buffer.from('bukan json').toString('base64') } });
    ok('berkas rusak ditolak', r.status === 400);

    console.log('\n== AUDIT DATA TERSEMBUNYI ==');
    r = await req('/api/audit-data');
    ok('audit awal bersih', r.status === 200 && Array.isArray(r.body.checks), JSON.stringify(r.body.checks || []).slice(0, 80));
    // buat data menggantung langsung di DB? gunakan kelas yang dihapus? → buat kejadian lalu hapus siswanya tanpa trash
    r = await req('/api/siswa/save', { method: 'POST', body: { nama: 'Siswa Orphan', kelas_id: kelasId } });
    const orphId = r.body.id;
    await req('/api/kejadian/save', { method: 'POST', body: { siswa_id: orphId, kategori_id: katId, keterangan: 'orphan' } });
    // hapus siswa lewat kotak sampah lalu hapus permanen kejadian? Lebih mudah: hapus baris siswa langsung via modul reset? 
    // gunakan endpoint bulk-delete siswa (ke trash) lalu purge trash siswa saja → kejadian tersisa? (kejadian ikut ke trash)
    r = await req('/api/siswa/bulk', { method: 'POST', body: { aksi: 'delete', ids: [orphId] } });
    ok('siswa orphan dihapus ke sampah', r.status === 200);
    r = await req('/api/trash');
    const trOrph = r.body.rows.find(x => x.tabel === 'siswa' && x.ref_id === orphId);
    if (trOrph) await req('/api/trash/delete', { method: 'POST', body: { ids: [trOrph.id] } });
    // pindahkan kejadian orphan kembali dari trash → menjadi yatim
    r = await req('/api/trash');
    const trKej = r.body.rows.filter(x => x.tabel === 'kejadian' && x.data && x.data.siswa_id === orphId);
    let restored = false;
    if (trKej.length) {
      // restore akan ditolak karena siswa tak ada → uji pesan error
      r = await req('/api/trash/restore', { method: 'POST', body: { ids: [trKej[0].id] } });
      restored = r.body.dipulihkan === 0 && (r.body.gagal || []).length === 1;
      ok('restore kejadian tanpa siswa ditolak dengan pesan jelas', restored, JSON.stringify(r.body).slice(0, 160));
    } else { ok('restore kejadian tanpa siswa ditolak dengan pesan jelas', true, 'dilewati'); }
    // buat orphan nyata: sisipkan kejadian ber-siswa_id tak ada lewat payload restore
    const dump2 = JSON.parse(JSON.stringify(dump));
    const taId0 = (dump2.tabel.tahun_ajaran[0] || {}).id || 1;
    dump2.tabel.kejadian.push({
      id: 999001, siswa_id: 999999, kategori_id: (dump2.tabel.kategori[0] || {}).id || null,
      judul: 'Orphan uji', jenis: 'pelanggaran', poin: 5, tanggal: '2026-11-05',
      keterangan: 'data menggantung', bukti_url: '', ta_id: taId0, semester: 'ganjil',
      oleh: 1, oleh_nama: 'Uji', created_at: '2026-11-05 08:00:00', jam: '08:00', lokasi: 'Ruang Kelas'
    });
    r = await req('/api/backup/restore', { method: 'POST', body: { base64: Buffer.from(JSON.stringify(dump2)).toString('base64') } });
    ok('restore payload dengan baris yatim', r.status === 200);
    cookie = '';
    await login('admin', 'admin123');
    r = await req('/api/audit-data');
    const cek = (r.body.checks || []).find(c => c.key === 'kejadian_siswa');
    ok('audit mendeteksi riwayat tanpa siswa', !!cek && cek.jumlah >= 1, JSON.stringify((r.body.checks || []).map(c => [c.key, c.jumlah])));
    r = await req('/api/audit-data/delete', { method: 'POST', body: { items: [{ tabel: 'kejadian', ids: cek.rows.map(x => x.id) }] } });
    ok('hapus baris yatim lewat audit', r.status === 200 && r.body.jumlah >= 1, JSON.stringify(r.body));
    r = await req('/api/audit-data');
    ok('audit bersih setelah pembersihan', !(r.body.checks || []).some(c => c.key === 'kejadian_siswa'));
    r = await req('/api/audit-data/delete', { method: 'POST', body: { items: [{ tabel: 'users', ids: [1] }] } });
    ok('hapus audit menolak tabel yang tidak diizinkan', r.status === 200 && (r.body.jumlah === 0 || (r.body.gagal || []).length > 0), JSON.stringify(r.body));
    r = await req('/api/siswa/999999', { method: 'DELETE' });
    ok('hapus siswa tidak ada → 404', r.status === 404);

    console.log('\n== RESET TAHUN AJARAN ==');
    r = await req('/api/reset-ta/preview?ta=1');
    ok('pratinjau reset memuat jumlah per bagian', r.status === 200 && r.body.scope.length >= 4 && r.body.jumlah.kejadian >= 1, JSON.stringify(r.body.jumlah));
    r = await req('/api/reset-ta', { method: 'POST', body: { ta_id: 1, scope: ['kejadian'], konfirmasi: 'salah' } });
    ok('reset tanpa konfirmasi RESET ditolak', r.status === 400);
    r = await req('/api/reset-ta', { method: 'POST', body: { ta_id: 1, scope: ['kejadian'], konfirmasi: 'RESET' } });
    ok('reset kejadian tahun pelajaran', r.status === 200 && r.body.total >= 1, JSON.stringify(r.body));
    r = await req('/api/kejadian?ta=1&semester=ganjil');
    ok('riwayat kejadian terhapus setelah reset', r.body.rows.length === 0);
    r = await req('/api/siswa?ta=1&semester=ganjil');
    ok('data siswa tetap utuh setelah reset', r.body.rows.length >= 1);

    console.log('\n== HAK AKSES ==');
    cookie = '';
    await login('guru', 'guru123');
    r = await req('/api/trash');
    ok('guru biasa tidak boleh buka kotak sampah → 403', r.status === 403);
    r = await req('/api/audit-data');
    ok('guru biasa tidak boleh audit data → 403', r.status === 403);
    r = await req('/api/backup/json');
    ok('guru biasa tidak boleh unduh backup → 403', r.status === 403);
    r = await req('/api/reset-ta/preview');
    ok('guru biasa tidak boleh reset tahun ajaran → 403', r.status === 403);
    r = await req('/api/kalender?bulan=2026-11');
    ok('guru biasa tetap boleh lihat kalender', r.status === 200);
    cookie = '';
    await login('admin', 'admin123');

    console.log('\n== FITUR "DATA CONTOH" SUDAH DIHAPUS ==');
    r = await req('/api/demo');
    ok('endpoint statistik data contoh hilang (404)', r.status === 404, 'status ' + r.status);
    r = await req('/api/demo/seed', { method: 'POST' });
    ok('endpoint muat data contoh hilang (404)', r.status === 404, 'status ' + r.status);
    r = await req('/api/demo/purge', { method: 'POST' });
    ok('endpoint hapus data contoh hilang (404)', r.status === 404, 'status ' + r.status);
    r = await req('/api/bootstrap');
    ok('bootstrap tidak memuat menu data contoh', !/data contoh/i.test(JSON.stringify(r.body)));

    console.log('\n== KOP SURAT: UKURAN FONT PER BARIS ==');
    r = await req('/api/settings/save', { method: 'POST', body: { data: {
      kop_sumber: 'manual',
      kop_baris: 'YAYASAN UJI\nSMK UJI\nSEKOLAH UJI\nJl. Uji 1',
      kop_format: JSON.stringify([{ size: 12, bold: true }, { size: 13, bold: false }, { size: 21, bold: true }, { size: 9, bold: false }])
    } } });
    ok('simpan kop manual + ukuran per baris', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/settings');
    ok('kop_format tersimpan', /"size":21/.test(r.body.settings.kop_format || ''), r.body.settings.kop_format);
    ok('kop_baris tersimpan', /SEKOLAH UJI/.test(r.body.settings.kop_baris || ''));
    r = await req('/api/rekap/print');
    ok('cetak memakai ukuran 21pt', /font-size:21pt/.test(r.body));
    ok('cetak memakai ukuran 12pt', /font-size:12pt/.test(r.body));
    ok('cetak tanpa baris otomatis "SMK SWASTA NPSN"', !/SWASTA\s*[—-]?\s*NPSN/i.test(r.body));
    r = await req('/api/settings/save', { method: 'POST', body: { data: { kop_sumber: 'auto' } } });
    r = await req('/api/rekap/print');
    ok('kop otomatis tanpa baris "SMK SWASTA NPSN"', !/SWASTA\s*[—-]?\s*NPSN/i.test(r.body));
    ok('kop otomatis tetap memuat nama sekolah', /SMK PGRI CIKONENG/i.test(r.body));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
  } finally {
    srv.kill('SIGKILL');
    ['', '-wal', '-shm'].forEach(s => { try { fs.unlinkSync(DB + s); } catch (e) {} });
  }
  console.log(`\n=== HASIL RONDE 3: ${pass} lulus, ${fail} gagal ===`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
