process.env.TZ = 'Asia/Jakarta';
'use strict';
/* Uji modul: otomatisasi poin absensi, rekap absensi guru/siswa + peringkat +
   WhatsApp wali kelas, kanal aduan kekerasan, program layanan BK, dan asesmen BK.
   Jalankan: node dev-tests/bk.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB = path.join(os.tmpdir(), 'stt-bk-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-bk-saas-' + Date.now() + '.sqlite');
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
  const body = ct.includes('json') ? await r.json().catch(() => null)
    : await r.text().then(t => ({ text: t, bytes: t.length })).catch(() => null);
  return { status: r.status, body, ct, headers: r.headers };
}
async function reqBuffer(p) {
  const r = await fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || '' };
}
const login = async (u, pw) => { cookie = ''; return req('/api/login', { method: 'POST', body: { username: u, password: pw, kode: KODE } }); };
const pad = n => String(n).padStart(2, '0');
const nowDate = new Date();
const TODAY = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`;
const HARI = nowDate.getDay();
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2200));

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    /* ================= KATEGORI POIN OTOMATIS ================= */
    console.log('\n== POIN OTOMATIS DARI ABSENSI ==');
    let r = await req('/api/kategori');
    const autoAlfa = (r.body.rows || []).find(k => k.auto_key === 'absensi_alfa');
    const autoBolos = (r.body.rows || []).find(k => k.auto_key === 'absensi_bolos');
    ok('kategori otomatis Alpha & Bolos tersedia', !!autoAlfa && !!autoBolos,
      JSON.stringify((r.body.rows || []).filter(k => k.auto_key)));
    ok('bobot bawaan Alpha 5 poin & Bolos 10 poin', autoAlfa.poin === 5 && autoBolos.poin === 10,
      `${autoAlfa?.poin}/${autoBolos?.poin}`);
    r = await req('/api/kategori/save', { method: 'POST', body: { id: autoAlfa.id, nama: autoAlfa.nama, jenis: 'pelanggaran', poin: 7, keterangan: autoAlfa.keterangan } });
    ok('admin dapat mengubah poin kategori Alpha', r.status === 200);
    r = await req('/api/kategori/' + autoAlfa.id, { method: 'DELETE' });
    ok('kategori otomatis tidak boleh dihapus', r.status === 400, r.body?.error);

    /* siapkan mapel + jadwal + sesi hari ini agar bisa presensi */
    r = await req('/api/users');
    const guruId = (r.body.rows || []).find(u => u.role === 'guru')?.id;
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika', kode: 'MTK' } });
    const mapelId = r.body.id;
    ok('mapel dibuat', r.status === 200 && !!mapelId);

    /* sesi jam pelajaran mencakup waktu sekarang */
    r = await req('/api/jadwal/pengaturan');
    const mulai = hhmm(new Date(Date.now() - 30 * 60000));
    const selesai = hhmm(new Date(Date.now() + 60 * 60000));
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [{ label: 'Jam 1', mulai, selesai, istirahat: 0 }],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_tutup_menit: 180 },
        wa: { aktif: 0, jam: '15:00' }
      }
    });
    ok('pengaturan jadwal & jendela absensi disimpan', r.status === 200, r.body?.error);
    r = await req('/api/siswa?limit=5');
    const siswa1 = (r.body.rows || [])[0];
    const siswa2 = (r.body.rows || [])[1];
    ok('data siswa contoh tersedia (DEMO_SEED)', !!siswa1 && !!siswa2);
    r = await req('/api/jadwal/slot', {
      method: 'POST',
      body: { hari: HARI, sesi: 1, mapel_id: mapelId, guru_id: guruId, kelas_ids: [siswa1.kelas_id], abaikan: 1 }
    });
    const jadwalId = r.body.id;
    ok('slot jadwal hari ini dibuat', r.status === 200 && !!jadwalId, r.body?.error);
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: jadwalId, tanggal: TODAY } });
    const sesiId = r.body?.sesi?.id;
    ok('sesi presensi dibuka', r.status === 200 && !!sesiId, r.body?.error);

    r = await req('/api/absensi-siswa/simpan', {
      method: 'POST',
      body: { sesi_id: sesiId, items: [
        { siswa_id: siswa1.id, status: 'A', keterangan: 'tanpa kabar' },
        { siswa_id: siswa2.id, status: 'B', keterangan: 'keluar kelas' }
      ] }
    });
    ok('presensi tersimpan + info poin otomatis', r.status === 200 && r.body.poin && r.body.poin.dibuat === 2, JSON.stringify(r.body));
    r = await req('/api/siswa/' + siswa1.id);
    const auto1 = (r.body.riwayat || []).find(x => x.sumber === 'absensi');
    ok('catatan pelanggaran otomatis dibuat untuk Alpha', !!auto1 && auto1.poin === 7, JSON.stringify(auto1));
    ok('keterangan otomatis memuat mapel, tanggal, status & pencatat',
      !!auto1 && /Otomatis dari Absensi Matematika/.test(auto1.keterangan) && /Status: Alpha/.test(auto1.keterangan) && /Pencatat:/.test(auto1.keterangan),
      auto1?.keterangan);
    r = await req('/api/siswa/' + siswa2.id);
    const auto2 = (r.body.riwayat || []).find(x => x.sumber === 'absensi');
    ok('catatan otomatis untuk Bolos memakai bobot 10 poin', !!auto2 && auto2.poin === 10, JSON.stringify(auto2));

    const sameSessionAlpha = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiId, items: [{ siswa_id: siswa1.id, status: 'A' }] }
    });
    ok('status Alpha pada sesi yang sama tetap dapat dikoreksi/disimpan', sameSessionAlpha.status === 200, JSON.stringify(sameSessionAlpha.body));

    const fixtureDb = new Database(DB);
    fixtureDb.prepare(`INSERT INTO absensi_siswa(sesi_id,jadwal_id,tanggal,siswa_id,kelas_id,status)
      VALUES(?,?,?,?,?,'B')`).run(999999, jadwalId, TODAY, siswa1.id, siswa1.kelas_id);
    let duplicateAlpha = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiId, items: [{ siswa_id: siswa1.id, status: 'A' }] }
    });
    ok('Alpha ditolak bila siswa sudah Alpha/Bolos di mapel lain pada hari yang sama',
      duplicateAlpha.status === 409 && duplicateAlpha.body.duplikat_harian?.[0]?.status === 'B', JSON.stringify(duplicateAlpha.body));
    let duplicateBolos = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiId, items: [{ siswa_id: siswa1.id, status: 'B' }] }
    });
    ok('Bolos ditolak bila siswa sudah Alpha/Bolos di mapel lain pada hari yang sama',
      duplicateBolos.status === 409 && duplicateBolos.body.duplikat_harian?.[0]?.status === 'B', JSON.stringify(duplicateBolos.body));
    fixtureDb.prepare('DELETE FROM absensi_siswa WHERE sesi_id=?').run(999999);
    fixtureDb.close();

    /* koreksi status → catatan otomatis dihapus */
    r = await req('/api/absensi-siswa/simpan', {
      method: 'POST',
      body: { sesi_id: sesiId, items: [{ siswa_id: siswa1.id, status: 'H', keterangan: '' }] }
    });
    ok('koreksi presensi melaporkan penghapusan poin', r.status === 200 && r.body.poin.dihapus >= 1, JSON.stringify(r.body.poin));
    r = await req('/api/siswa/' + siswa1.id);
    ok('catatan Alpha otomatis ikut dibatalkan', !(r.body.riwayat || []).some(x => x.sumber === 'absensi'));

    /* ================= REKAP ABSENSI ================= */
    console.log('\n== REKAP ABSENSI GURU & SISWA ==');
    r = await req('/api/rekap/absensi-guru?periode=harian&tanggal=' + TODAY);
    ok('rekap absensi guru berjalan', r.status === 200 && Array.isArray(r.body.rows), r.body?.error);
    ok('rekap guru memuat kolom hadir/izin/sakit/alpha', !!r.body.hitung && ['H', 'I', 'S', 'A', 'belum'].every(k => typeof r.body.hitung[k] === 'number'));
    r = await req('/api/rekap/absensi-guru?periode=tahun');
    ok('rekap guru periode satu tahun pelajaran', r.status === 200 && r.body.periode === 'tahun', r.body?.error);
    r = await req('/api/rekap/absensi-guru?periode=custom&dari=' + TODAY + '&sampai=' + TODAY);
    ok('rekap guru rentang custom', r.status === 200 && r.body.dari === TODAY);
    r = await req('/api/rekap/absensi-guru/export?periode=harian&tanggal=' + TODAY);
    ok('ekspor Excel rekap guru', r.status === 200 && /spreadsheet/.test(r.ct), r.status + ' ' + r.ct);
    r = await req('/api/rekap/absensi-guru/cetak?periode=harian&tanggal=' + TODAY);
    ok('cetak PDF rekap guru', r.status === 200 && /text\/html/.test(r.ct) && /REKAP ABSENSI MENGAJAR GURU/i.test(r.body.text || ''), r.status);
    r = await req('/api/rekap/absensi-guru/cetak?periode=harian&tanggal=' + TODAY);
    ok('cetak guru memuat kop sekolah', /SMK PGRI CIKONENG/i.test(r.body.text || ''), 'kop');

    r = await req('/api/rekap/absensi-siswa?mode=kelas&kelas=' + siswa1.kelas_id + '&periode=bulanan');
    ok('rekap absensi siswa per kelas', r.status === 200 && (r.body.siswa || []).length >= 5, r.body?.error);
    const rowSiswa2 = (r.body.siswa || []).find(s => s.siswa_id === siswa2.id);
    ok('rekap kelas menghitung status Bolos', !!rowSiswa2 && rowSiswa2.B >= 1, JSON.stringify(rowSiswa2));
    r = await req('/api/rekap/absensi-siswa?mode=siswa&siswa=' + siswa2.id + '&periode=bulanan');
    ok('rekap absensi per siswa + riwayat detail', r.status === 200 && (r.body.rows || []).length >= 1);
    r = await req('/api/rekap/absensi-siswa/export?mode=kelas&kelas=' + siswa1.kelas_id);
    ok('ekspor Excel rekap siswa', r.status === 200 && /spreadsheet/.test(r.ct));
    r = await req('/api/rekap/absensi-siswa/cetak?mode=kelas&kelas=' + siswa1.kelas_id);
    ok('cetak PDF rekap siswa', r.status === 200 && /REKAP ABSENSI SISWA/i.test(r.body.text || ''));
    r = await req('/api/rekap/ranking?periode=bulanan');
    ok('peringkat ketidakhadiran 4 kategori', r.status === 200 && ['izin', 'sakit', 'alfa', 'bolos'].every(k => Array.isArray(r.body.ranking[k])),
      JSON.stringify(r.body?.ranking && Object.keys(r.body.ranking)));
    ok('siswa bolos masuk peringkat bolos', (r.body.ranking.bolos || []).some(s => s.siswa_id === siswa2.id));

    /* ================= PENGATURAN & WA WALI KELAS ================= */
    console.log('\n== WHATSAPP REKAP WALI KELAS ==');
    r = await req('/api/rekap-absensi/pengaturan');
    ok('pengaturan rekap & pemetaan wali kelas', r.status === 200 && Array.isArray(r.body.kelas) && r.body.config.jam === '15:00', r.body?.error);
    ok('pemetaan memuat nomor WhatsApp wali kelas', (r.body.kelas || []).some(k => k.wali_phone));
    r = await req('/api/rekap-absensi/pengaturan', { method: 'POST', body: { aktif: 1, jam: '99:99', hari: [1] } });
    ok('jam pengiriman tidak valid ditolak', r.status === 400, r.body?.error);
    r = await req('/api/rekap-absensi/pengaturan', { method: 'POST', body: { aktif: 0, jam: '15:00', hari: [1, 2, 3, 4, 5], auto_poin: 1 } });
    ok('pengaturan jam & hari pengiriman tersimpan', r.status === 200);
    r = await req('/api/rekap-absensi/wa/preview?tanggal=' + TODAY);
    ok('pratinjau rekap per kelas (semua kelas)', r.status === 200 && (r.body.rows || []).length >= 5, r.body?.error);
    const kelasPreview = (r.body.rows || []).find(x => x.kelas_id === siswa1.kelas_id);
    ok('pesan berisi rincian per mapel + nama siswa bolos',
      !!kelasPreview && /Rincian per mata pelajaran/.test(kelasPreview.pesan) && /Bolos/.test(kelasPreview.pesan),
      kelasPreview?.pesan?.slice(0, 120));
    r = await req('/api/rekap-absensi/wa/kirim', { method: 'POST', body: { tanggal: TODAY, kelas: siswa1.kelas_id } });
    ok('kirim manual tanpa gateway → tautan wa.me', r.status === 200 && r.body.gateway === false && Array.isArray(r.body.tautan), JSON.stringify(r.body).slice(0, 160));

    /* ================= KANAL ADUAN KEKERASAN ================= */
    console.log('\n== KANAL ADUAN KEKERASAN ==');
    r = await req('/api/aduan');
    ok('panel aduan memuat tautan & QR unik', r.status === 200 && /\/aduan\//.test(r.body.link.url), r.body?.error);
    const token = r.body.link.token;
    r = await req('/api/aduan/qr');
    ok('QR aduan dibuat (SVG + PNG)', r.status === 200 && /<svg/.test(r.body.qr.svg) && /^data:image\/png/.test(r.body.qr.png));
    r = await req('/api/aduan/layanan', { method: 'POST', body: { keswa: '119 ext 8', ppa: '0812-1111-2222' } });
    ok('nomor layanan bantuan tersimpan', r.status === 200 && r.body.layanan.keswa === '119 ext 8');
    let pub = await req('/api/public/aduan/' + token);
    ok('halaman publik aduan terbuka (tanpa login)', pub.status === 200 && pub.body.guru && pub.body.kelas.length > 0, pub.body?.error);
    ok('nomor layanan tampil di halaman publik', pub.body.layanan.keswa === '119 ext 8');
    const siswaPublik = siswa1;
    /* autocomplete nama siswa (minimal 3 huruf) */
    r = await req('/api/public/aduan/' + token + '/siswa?q=' + encodeURIComponent(siswaPublik.nama.slice(0, 1)));
    ok('pencarian siswa butuh minimal 3 huruf', r.status === 200 && Array.isArray(r.body.rows) && r.body.rows.length === 0);
    r = await req('/api/public/aduan/' + token + '/siswa?q=' + encodeURIComponent(siswaPublik.nama.slice(0, 3)));
    ok('autocomplete nama siswa aduan menemukan siswa', r.status === 200 && r.body.rows.some(x => x.id === siswaPublik.id), JSON.stringify(r.body.rows).slice(0, 140));
    ok('hasil autocomplete memuat kelas otomatis', r.body.rows[0] && !!r.body.rows[0].kelas_nama);
    ok('tanggal lahir tidak dibocorkan ke halaman publik', r.body.rows.every(x => x.tanggal_lahir === undefined));
    r = await req('/api/public/aduan/' + token, {
      method: 'POST',
      body: {
        nama: siswaPublik.nama, kelas_id: siswaPublik.kelas_id, tanggal_lahir: siswaPublik.tanggal_lahir,
        jenis: 'Kekerasan verbal / perundungan', lokasi: 'Kantin', kronologi: 'Saya dipanggil dengan sebutan yang merendahkan setiap hari.',
        pelaku: 'Siswa kelas lain', kontak: '08123'
      }
    });
    ok('siswa dapat mengirim aduan (verifikasi kelas + tanggal lahir)', r.status === 200 && !!r.body.id, r.body?.error);
    r = await req('/api/public/aduan/' + token, {
      method: 'POST',
      body: { nama: siswaPublik.nama, kelas_id: siswaPublik.kelas_id, tanggal_lahir: '2000-01-01', jenis: 'Lainnya', kronologi: 'Tanggal lahir salah seharusnya ditolak.' }
    });
    ok('tanggal lahir salah ditolak', r.status === 403, r.body?.error);
    /* jalur baru: siswa dipilih dari autocomplete (kelas otomatis, tanpa field kelas) */
    r = await req('/api/public/aduan/' + token, {
      method: 'POST',
      body: {
        siswa_id: siswa2.id, tanggal_lahir: siswa2.tanggal_lahir,
        jenis: 'Perundungan siber (cyberbullying)', lokasi: 'Grup kelas', kronologi: 'Saya dipanggil dengan kata kasar di grup kelas setiap hari.',
        pelaku: 'Teman sekelas', kontak: '0813'
      }
    });
    ok('aduan lewat pilihan autocomplete (tanpa kelas) tersimpan', r.status === 200 && !!r.body.id, r.body?.error);
    r = await req('/api/public/aduan/' + token, {
      method: 'POST',
      body: { siswa_id: siswa2.id, tanggal_lahir: '1999-12-31', jenis: 'Lainnya', kronologi: 'Tanggal lahir salah harus ditolak pada jalur siswa_id.' }
    });
    ok('jalur siswa_id tetap memverifikasi tanggal lahir', r.status === 403, r.body?.error);
    cookie = '';
    await login('admin', 'admin123');
    r = await req('/api/aduan?status=semua');
    ok('aduan masuk terlihat di panel guru/BK', r.status === 200 && r.body.rows.length === 2, JSON.stringify(r.body.counts));
    ok('penghitung status aduan akurat', r.body.counts.semua === 2 && r.body.counts.baru === 2);
    const aduanId = r.body.rows[0].id;
    const ad = await fetch(BASE + '/api/aduan/export', { headers: { Cookie: cookie } });
    ok('ekspor Excel aduan masuk', ad.status === 200 && /spreadsheet/.test(ad.headers.get('content-type') || ''));
    r = await req('/api/aduan/status', { method: 'POST', body: { id: aduanId, status: 'diproses', tanggapan: 'Sedang dimediasi' } });
    ok('status aduan dapat diperbarui', r.status === 200);
    r = await req('/api/aduan?status=diproses');
    ok('filter status aduan bekerja', r.body.rows.length === 1 && r.body.rows[0].status === 'diproses');
    /* hapus massal aduan (hanya milik kanal sendiri) */
    r = await req('/api/aduan?status=semua');
    const hapusIds = r.body.rows.map(x => x.id).slice(0, 1);
    r = await req('/api/aduan/delete', { method: 'POST', body: { ids: hapusIds } });
    ok('hapus aduan terpilih berhasil', r.status === 200 && r.body.jumlah === 1, JSON.stringify(r.body));
    r = await req('/api/aduan?status=semua');
    ok('jumlah aduan berkurang setelah dihapus', r.body.rows.length === 1);
    r = await req('/api/aduan/delete', { method: 'POST', body: { ids: [] } });
    ok('hapus aduan tanpa pilihan ditolak', r.status === 400);
    r = await req('/api/aduan/reset', { method: 'POST', body: {} });
    ok('reset QR membuat token baru', r.status === 200 && r.body.link.token !== token);
    pub = await req('/api/public/aduan/' + token);
    ok('token aduan lama tidak berlaku setelah reset', pub.status === 404);

    /* ================= PROGRAM LAYANAN BK ================= */
    console.log('\n== PROGRAM LAYANAN BK ==');
    r = await req('/api/bk/layanan');
    ok('daftar jenis layanan BK bawaan (13 jenis)', r.status === 200 && r.body.jenis.length === 13, String(r.body?.jenis?.length));
    ok('kategori BK: dasar/individual/responsif', Array.isArray(r.body.kategori) && r.body.kategori.length === 3);
    const jenisMediasi = r.body.jenis.find(j => /mediasi/i.test(j.nama));
    const jenisKlasikal = r.body.jenis.find(j => /klasikal/i.test(j.nama));
    ok('jenis klasikal bersasaran kelas & mediasi bersasaran siswa',
      jenisKlasikal.sasaran === 'kelas' && jenisMediasi.sasaran === 'siswa');
    r = await req('/api/bk/layanan/save', {
      method: 'POST',
      body: {
        jenis_id: jenisMediasi.id, tanggal: TODAY, jam: '09:00',
        siswa_ids: [siswa1.id, siswa2.id], topik: 'Berkelahi', tujuan: 'Mediasi kedua siswa',
        uraian: 'Mediasi dilakukan di ruang BK', hasil: 'Kedua siswa berdamai', tindak_lanjut: 'Pemantauan 1 minggu',
        tempat: 'Ruang BK'
      }
    });
    const layananId = r.body.id;
    ok('catat layanan BK tersimpan', r.status === 200 && !!layananId, r.body?.error);
    r = await req('/api/bk/layanan');
    ok('daftar riwayat layanan menampilkan sasaran siswa', r.body.rows.length === 1 && r.body.rows[0].siswa_ids.length === 2);
    ok('penghitung kategori responsif bertambah', r.body.counts.responsif === 1, JSON.stringify(r.body.counts));
    r = await req('/api/bk/layanan/' + layananId + '/cetak');
    ok('cetak PDF layanan BK memuat detail & tanda tangan',
      r.status === 200 && /Berkelahi/.test(r.body.text) && /Kepala Sekolah/.test(r.body.text) && /Koordinator BK/.test(r.body.text), r.status);
    r = await req('/api/bk/ttd', { method: 'POST', body: { nama: 'Siti Nurhaliza, S.Psi.', nip: '198503112010012003', jabatan: 'Koordinator BK' } });
    ok('pengaturan tanda tangan BK tersimpan', r.status === 200);
    r = await req('/api/bk/layanan/' + layananId + '/cetak');
    ok('nama penanggung jawab BK muncul di dokumen', /Siti Nurhaliza/.test(r.body.text || ''));
    r = await req('/api/bk/jenis/save', { method: 'POST', body: { nama: 'Konseling Krisis', kategori: 'responsif', sasaran: 'siswa' } });
    ok('jenis layanan BK dapat ditambah', r.status === 200);
    r = await req('/api/bk/layanan/save', { method: 'POST', body: { jenis_id: jenisMediasi.id, tanggal: TODAY, topik: '', siswa_ids: [siswa1.id] } });
    ok('layanan tanpa topik ditolak', r.status === 400);
    r = await req('/api/bk/layanan/' + layananId, { method: 'DELETE' });
    ok('hapus layanan BK dipindahkan ke kotak sampah', r.status === 200);
    r = await req('/api/trash');
    ok('baris layanan BK tercatat di kotak sampah', (r.body.rows || []).some(x => x.tabel === 'bk_layanan'));

    /* ================= ASESMEN BK ================= */
    console.log('\n== ASESMEN SISWA BK ==');
    r = await req('/api/asesmen');
    ok('4 instrumen asesmen tersedia', r.status === 200 && r.body.rows.length === 4, String(r.body?.rows?.length));
    ok('bank soal bawaan terisi (AKPD 28, RIASEC 42, Gaya 15, Kesulitan 15)',
      r.body.rows.find(x => x.kode === 'akpd').jumlah_soal === 28 &&
      r.body.rows.find(x => x.kode === 'riasec').jumlah_soal === 42 &&
      r.body.rows.find(x => x.kode === 'gaya').jumlah_soal === 15 &&
      r.body.rows.find(x => x.kode === 'kesulitan').jumlah_soal === 15,
      r.body.rows.map(x => x.kode + ':' + x.jumlah_soal).join(','));
    r = await req('/api/asesmen/link?kode=gaya');
    ok('tautan & QR asesmen dibuat', r.status === 200 && /\/asesmen\//.test(r.body.url) && /<svg/.test(r.body.qr.svg));
    const tokenAsesmen = r.body.token;
    const urlAsesmen = r.body.url;
    const pathAsesmen = new URL(urlAsesmen).pathname.replace(/^.*?\/asesmen\//, '/asesmen/');
    let pub2 = await req('/api/public/asesmen/' + tokenAsesmen);
    ok('halaman publik asesmen memuat soal', pub2.status === 200 && pub2.body.soal.length === 15, pub2.body?.error);
    const soalGaya = pub2.body.soal;
    r = await req('/api/public/asesmen/' + tokenAsesmen + '/siswa?q=' + encodeURIComponent(siswa1.nama.slice(0, 3)));
    ok('autocomplete nama siswa asesmen tersedia', r.status === 200 && r.body.rows.some(x => x.id === siswa1.id), JSON.stringify(r.body.rows).slice(0, 120));
    const identitas = { siswa_id: siswa1.id, tanggal_lahir: siswa1.tanggal_lahir };
    r = await req('/api/public/asesmen/' + tokenAsesmen + '/cek', { method: 'POST', body: { siswa_id: siswa1.id, tanggal_lahir: '2001-02-03' } });
    ok('asesmen menolak tanggal lahir yang salah', r.status === 403, r.body?.error);
    r = await req('/api/public/asesmen/' + tokenAsesmen + '/cek', { method: 'POST', body: { siswa_id: siswa1.id } });
    ok('asesmen mewajibkan tanggal lahir', r.status === 400, r.body?.error);
    r = await req('/api/public/asesmen/' + tokenAsesmen + '/cek', { method: 'POST', body: identitas });
    ok('verifikasi NISN + nama berhasil', r.status === 200 && r.body.sudah === false, r.body?.error);
    const jawabanGaya = {};
    soalGaya.forEach((s, i) => { if (i % 3 !== 0) jawabanGaya[s.id] = 1; });
    r = await req('/api/public/asesmen/' + tokenAsesmen, { method: 'POST', body: { ...identitas, jawaban: jawabanGaya } });
    ok('pengisian asesmen gaya belajar tersimpan', r.status === 200 && r.body.ringkas && !!r.body.ringkas.utama, JSON.stringify(r.body.ringkas));
    r = await req('/api/public/asesmen/' + tokenAsesmen, { method: 'POST', body: { ...identitas, jawaban: jawabanGaya } });
    ok('pengisian kedua ditolak (satu kali)', r.status === 409, r.body?.error);
    r = await req('/api/public/asesmen/' + tokenAsesmen + '/cek', { method: 'POST', body: identitas });
    ok('cek ulang menampilkan status sudah mengisi', r.status === 200 && r.body.sudah === true && !!r.body.hasil.ringkas.utama);

    /* AKPD oleh siswa kedua */
    r = await req('/api/asesmen/link?kode=akpd');
    const tokenAkpd = r.body.token;
    pub2 = await req('/api/public/asesmen/' + tokenAkpd);
    ok('bank soal AKPD memakai skala Likert', pub2.body.instrumen.tipe === 'likert4' && pub2.body.soal.length === 28);
    r = await req('/api/public/asesmen/' + tokenAkpd, { method: 'POST', body: { nisn: siswa2.nisn, nama: siswa2.nama, jawaban: {} } });
    ok('AKPD menolak jawaban kosong', r.status === 400, r.body?.error);
    const jawabanAkpd = {};
    pub2.body.soal.forEach((s, i) => { jawabanAkpd[s.id] = (i % 4) + 1; });
    r = await req('/api/public/asesmen/' + tokenAkpd, { method: 'POST', body: { nisn: siswa2.nisn, nama: siswa2.nama, jawaban: jawabanAkpd } });
    ok('AKPD terisi & menghasilkan ringkasan kebutuhan', r.status === 200 && r.body.ringkas.rincian.length === 4, JSON.stringify(r.body?.ringkas));

    r = await req('/api/asesmen/hasil?kode=akpd');
    ok('rekap hasil AKPD terbaca', r.status === 200 && r.body.rows.length === 1);
    /* hapus riwayat asesmen (data keliru/ganda) */
    r = await req('/api/asesmen/hasil?kode=gaya');
    const idHasil = r.body.rows[0].id;
    r = await req('/api/asesmen/hasil/delete', { method: 'POST', body: { ids: [idHasil] } });
    ok('hapus riwayat asesmen terpilih berhasil', r.status === 200 && r.body.jumlah === 1, JSON.stringify(r.body));
    r = await req('/api/asesmen/hasil?kode=gaya');
    ok('riwayat asesmen berkurang setelah dihapus', r.body.rows.length === 0);
    r = await req('/api/asesmen/hasil/delete', { method: 'POST', body: { ids: [] } });
    ok('hapus riwayat tanpa pilihan ditolak', r.status === 400);
    /* isi ulang agar analisis berikut tetap punya data */
    const tokenGaya = (await req('/api/asesmen/link?kode=gaya')).body.token;
    const pubGaya = await req('/api/public/asesmen/' + tokenGaya);
    const jawabGaya = {};
    pubGaya.body.soal.forEach((q, i) => { if (i % 3 !== 0) jawabGaya[q.id] = 1; });
    r = await req('/api/public/asesmen/' + tokenGaya, { method: 'POST', body: { siswa_id: siswa1.id, tanggal_lahir: siswa1.tanggal_lahir, jawaban: jawabGaya } });
    ok('siswa dapat mengisi ulang instrumen setelah riwayat dihapus', r.status === 200 && !!r.body.ringkas, r.body?.error);

    r = await req('/api/asesmen/analisis?kode=akpd');
    const anal = r.body.analisis || {};
    ok('analisis AKPD: ranking bidang + IR', r.status === 200 && anal.bidang.length === 4 && anal.bidang.every(b => typeof b.ir === 'number' && b.peringkat));
    ok('analisis AKPD: proporsi alokasi waktu total ~100%',
      Math.abs(anal.bidang.reduce((a, b) => a + b.proporsi, 0) - 100) < 1.5,
      anal.bidang.map(b => b.proporsi).join('+'));
    ok('analisis AKPD: rumusan kebutuhan & draf program BK', (anal.rumusan || []).length > 0 && anal.program.length === 4);
    r = await req('/api/asesmen/analisis?kode=gaya');
    ok('analisis gaya belajar: distribusi + rekomendasi', r.status === 200 && r.body.analisis.distribusi.length === 3 && r.body.analisis.rekomendasi.length > 0);
    r = await req('/api/asesmen/export?kode=akpd');
    ok('ekspor Excel hasil asesmen', r.status === 200 && /spreadsheet/.test(r.ct));
    r = await req('/api/asesmen/cetak?kode=akpd');
    ok('cetak PDF analisis AKPD memuat rekap bidang & protah/prosem',
      r.status === 200 && /Rekap Bidang Layanan/i.test(r.body.text) && /Protah \/ Prosem/i.test(r.body.text), r.status);

    /* soal & kategori */
    r = await req('/api/asesmen/soal?kode=gaya');
    const soalList = r.body.soal;
    ok('halaman soal menampilkan kategori analisis', r.status === 200 && r.body.kategori.length === 3 && soalList.length === 15);
    r = await req('/api/asesmen/soal/save', { method: 'POST', body: { kode: 'gaya', teks: 'Saya suka belajar dengan diagram warna', kategori: 'visual', indikator: 'Visual' } });
    ok('menambah butir soal baru', r.status === 200);
    r = await req('/api/asesmen/soal/save', { method: 'POST', body: { kode: 'gaya', teks: 'Butir kategori salah', kategori: 'internal' } });
    ok('kategori tidak sesuai instrumen ditolak', r.status === 400, r.body?.error);
    r = await req('/api/asesmen/soal?kode=gaya');
    const rowsSoal = r.body.soal.map(s => ({ id: s.id, teks: s.teks, kategori: s.kategori, indikator: s.indikator, aktif: s.aktif }));
    r = await req('/api/asesmen/soal/simpan', { method: 'POST', body: { kode: 'gaya', rows: rowsSoal } });
    ok('simpan & perbarui bank soal menaikkan versi', r.status === 200 && r.body.versi === 2, JSON.stringify(r.body));
    r = await req('/api/asesmen/hasil?kode=gaya');
    ok('hasil asesmen lama tetap ada setelah bank soal diubah', r.body.rows.length === 1 && r.body.rows[0].versi === 1, JSON.stringify(r.body.rows[0]?.versi));
    const templateSoal = await reqBuffer('/api/asesmen/template.xlsx?kode=riasec');
    ok('template Excel bank soal tersedia', templateSoal.status === 200 && /spreadsheet/.test(templateSoal.ct));
    r = await req('/api/asesmen/import/preview', { method: 'POST', body: {
      kode: 'riasec', filename: 'template-riasec.xlsx', base64: templateSoal.buf.toString('base64')
    } });
    ok('template soal yang diunduh bisa dipratinjau',
      r.status === 200 && r.body.rows.length === 2 && /memperbaiki peralatan/i.test(r.body.rows[0].teks)
        && !r.body.rows[0].error,
      JSON.stringify(r.body?.error || r.body?.rows?.map(x => [x.teks, x.error])));
    r = await req('/api/asesmen/import/preview', { method: 'POST', body: { kode: 'riasec', base64: Buffer.from('bukan excel').toString('base64'), filename: 'x.xlsx' } });
    ok('import berkas rusak ditolak dengan pesan jelas', r.status === 400 && !!r.body.error, r.body?.error);

    /* ================= RBAC ================= */
    console.log('\n== HAK AKSES ==');
    cookie = '';
    await login('tu', 'tu123456');
    r = await req('/api/asesmen');
    ok('role TU tidak boleh membuka asesmen', r.status === 403, JSON.stringify(r.status));
    r = await req('/api/rekap-absensi/pengaturan');
    ok('role TU boleh melihat pengaturan rekap', r.status === 200);
    cookie = '';
    await login('guru', 'guru123');
    r = await req('/api/aduan');
    ok('guru memiliki kanal aduan sendiri', r.status === 200 && !!r.body.link.token);
    r = await req('/api/bk/layanan');
    ok('guru boleh melihat layanan BK', r.status === 200);
    r = await req('/api/bk/layanan/save', { method: 'POST', body: { jenis_id: 1, tanggal: TODAY, topik: 'Tes', siswa_ids: [1] } });
    ok('guru tanpa izin write tidak dapat mencatat layanan', r.status === 403);

    /* halaman publik HTML */
    const html = await (await fetch(BASE + pathAsesmen)).text();
    ok('halaman publik asesmen dapat dibuka langsung', html.includes('root'));
    const htmlAduan = await (await fetch(BASE + '/aduan/' + token)).text();
    ok('halaman publik aduan dapat dibuka langsung', htmlAduan.includes('root'));
  } catch (e) {
    fail++; fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
    try { fs.unlinkSync(DB); } catch (e) {}
    try { fs.unlinkSync(SAAS); } catch (e) {}
  }

  console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) {
    console.log('GAGAL:');
    fails.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
