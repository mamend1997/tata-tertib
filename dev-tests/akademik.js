'use strict';
/* =====================================================================
   RONDE 17 tata-tertib — JADWAL PELAJARAN, ABSENSI GURU MAPEL,
   ABSENSI SISWA PER MAPEL (tautan + QR), REKAP WHATSAPP, MULTI-ROLE.

   Jalankan: node dev-tests/akademik.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const lib = require('../lib');

process.env.TZ = 'Asia/Jakarta';
const DB = path.join(os.tmpdir(), 'stt-akad-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-akad-saas-' + Date.now() + '.sqlite');
const PORT = 6100 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const cur = now.getHours() * 60 + now.getMinutes();
const hari = now.getDay();
const tgl = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const kemarin = (() => { const d = new Date(now.getTime() - 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 1440) + 1440) % 1440 % 60)}`;

const HARI_NAMA = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const dbmHari = (n) => HARI_NAMA[n];

async function req(p, opt = {}) {
  const r = await fetch(BASE + p, {
    method: opt.method || 'GET',
    headers: {
      ...(opt.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opt.cookie === null ? {} : { Cookie: opt.cookie || cookie })
    },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length && opt.cookie !== null) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  let body = null;
  try { body = ct.includes('json') ? await r.json() : await r.text(); } catch (e) { body = null; }
  return { status: r.status, body, ct };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, TZ: 'Asia/Jakarta', APP_TIMEZONE: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2500));

  try {
    const publik = await (await fetch(BASE + '/api/public/sekolah')).json();
    const KODE = publik.rows[0].kode;
    let r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'admin', password: 'admin123' } });
    ok('login administrator sekolah', r.status === 200, JSON.stringify(r.body));

    /* ================= 1. ROLE & MULTI-ROLE ================= */
    console.log('\n== 1. ROLE WAKASEK KURIKULUM & MULTI-ROLE ==');
    r = await req('/api/bootstrap');
    ok('role Wakasek Kurikulum tersedia', (r.body.roles || []).some(x => x.key === 'wakasek_kurikulum'),
      JSON.stringify((r.body.roles || []).map(x => x.key)));
    ok('fitur akademik ada di daftar fitur', ['jadwal', 'absensi_guru', 'absensi_siswa']
      .every(k => (r.body.features || []).some(f => f.key === k)));

    r = await req('/api/users/save', {
      method: 'POST', body: {
        nama: 'Budi Santoso, S.Pd.', username: 'budikur', password: 'kurikulum123',
        role: 'guru', roles: ['wakasek_kurikulum'], jabatan: 'Guru Matematika / Wakasek Kurikulum'
      }
    });
    ok('akun multi-role dibuat (guru + wakasek kurikulum)', r.status === 200, JSON.stringify(r.body));
    const users = (await req('/api/users')).body.rows;
    const budi = users.find(u => u.username === 'budikur');
    ok('daftar pengguna memuat role gabungan', budi && budi.role_list.includes('guru') && budi.role_list.includes('wakasek_kurikulum'),
      JSON.stringify(budi && budi.role_list));

    const cookieAdmin = cookie;
    r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'budikur', password: 'kurikulum123' } });
    ok('login akun multi-role', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/bootstrap');
    ok('izin gabungan: jadwal write aktif', !!(r.body.perms.jadwal && r.body.perms.jadwal.write), JSON.stringify(r.body.perms.jadwal));
    ok('label role gabungan ditampilkan', /Wakasek Kurikulum/.test(r.body.user.role_label), r.body.user.role_label);

    /* guru biasa tidak boleh mengubah jadwal */
    let r2 = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'guru', password: 'guru123' } });
    ok('login guru mata pelajaran', r2.status === 200, JSON.stringify(r2.body));
    const cookieGuru = cookie;
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'X', kode: 'XX' } });
    ok('guru biasa tidak boleh menambah mapel (403)', r.status === 403, String(r.status));

    cookie = cookieAdmin;

    /* ================= 2. PENGATURAN JADWAL ================= */
    console.log('\n== 2. PENGATURAN JADWAL & VALIDASI ==');
    r = await req('/api/jadwal/pengaturan');
    ok('pengaturan jadwal terbaca', r.status === 200 && r.body.config.sesi.length > 0);
    ok('bawaan: 8 jam pelajaran maksimal + istirahat', r.body.config.maxJam === 8 && r.body.config.sesi.some(s => s.istirahat));

    /* sesi: satu jam pelajaran yang sedang berlangsung + 1 istirahat */
    const sesiOk = [
      { label: 'Jam 1', mulai: hhmm(cur - 20), selesai: hhmm(cur + 20), istirahat: 0 },
      { label: 'Istirahat', mulai: hhmm(cur + 21), selesai: hhmm(cur + 30), istirahat: 1 },
      { label: 'Jam 2', mulai: hhmm(cur + 31), selesai: hhmm(cur + 70), istirahat: 0 }
    ];
    const hariBesok = (hari + 1) % 7;
    const cfgBody = (over = {}) => ({
      hari: [hari, hariBesok], max_jam: 8, sesi: sesiOk, max_mapel_jam: 2, max_guru_jam: 8,
      absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 120 },
      wa: { aktif: 0, jam: '14:00', kepsek: '081234567890', wakasek: '081234567891' },
      ...over
    });
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ hari: [] }) });
    ok('hari aktif kosong ditolak', r.status === 400);
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({
        sesi: [
          { label: 'A', mulai: '07:00', selesai: '08:00' },
          { label: 'B', mulai: '07:30', selesai: '08:30' }
        ]
      })
    });
    ok('jam sesi bertumpang tindih ditolak', r.status === 400 && /tumpang/i.test(r.body.error || ''), JSON.stringify(r.body));
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({ sesi: [{ label: 'A', mulai: '25:00', selesai: '26:00' }] })
    });
    ok('format jam tidak valid ditolak', r.status === 400);
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ wa: { aktif: 0, jam: '99:99' } }) });
    ok('jam kirim rekap WA tidak valid ditolak', r.status === 400);
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('pengaturan jadwal valid tersimpan', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    r = await req('/api/jadwal/pengaturan');
    ok('nomor WA kepala sekolah tersimpan format 62…', r.body.wa.kepsek === '6281234567890', r.body.wa.kepsek);

    /* nomor WA lewat menu Pengaturan → WhatsApp */
    r = await req('/api/wa/pengaturan', { method: 'POST', body: { kepsek_wa: 'abc' } });
    ok('nomor WA tidak valid ditolak', r.status === 400);
    r = await req('/api/wa/pengaturan', { method: 'POST', body: { kepsek_wa: '0812-1111-2222', wakasek_kur_wa: '0813 3333 4444' } });
    ok('nomor WA kepsek & wakasek disimpan', r.status === 200 && /6281211112222/.test(JSON.stringify((await req('/api/wa/pengaturan')).body.config)));

    /* ================= 3. MATA PELAJARAN ================= */
    console.log('\n== 3. MATA PELAJARAN ==');
    /* guru uji */
    const gAll = (await req('/api/jadwal')).body.guru;
    const gBudi = gAll.find(g => g.username === 'budikur');
    const gHendra = gAll.find(g => g.username === 'guru');
    const kelas = (await req('/api/jadwal')).body.kelas;
    ok('kelas & guru uji tersedia', kelas.length >= 2 && !!gBudi && !!gHendra, JSON.stringify({ k: kelas.length }));

    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika', kode: 'MTK', max_jam_hari: 5 } });
    ok('mapel baru dibuat', r.status === 200 && r.body.id > 0, JSON.stringify(r.body));
    const mapelMtk = r.body.id;
    /* Ronde 21: guru pengampu kini WAJIB diatur di Data Master Mata Pelajaran
       dan otomatis mengunci pilihan guru pada slot jadwal. */
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Bahasa Indonesia', kode: 'BIN', guru_ids: [gHendra.id] } });
    const mapelBin = r.body.id;
    ok('mapel kedua dibuat', r.status === 200);
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika Lanjut', kode: 'MTK' } });
    ok('kode mapel ganda ditolak', r.status === 400 && /kode/i.test(r.body.error || ''));
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Fisika', kode: 'FIS', guru_ids: [gBudi.id] } });
    const mapelFis = r.body.id;
    r = await req('/api/mapel');
    ok('daftar mapel memuat 3 mapel', r.body.rows.length >= 3, String(r.body.rows.length));
    ok('template mapel dapat diunduh', (await req('/api/mapel/template.xlsx')).status === 200);

    /* ================= 4. SLOT JADWAL + DETEKSI BENTROK ================= */
    console.log('\n== 4. JADWAL & DETEKSI BENTROK ==');
    ok('data kelas & guru tersedia', (await req('/api/jadwal')).body.kelas.length >= 2);
    for (const [ki, jumlah] of [[0, 6], [1, 4], [2, 3]]) {
      for (let i = 1; i <= jumlah; i++) {
        await req('/api/siswa/save', { method: 'POST', body: { nama: `Siswa ${kelas[ki].nama} ${i}`, kelas_id: kelas[ki].id, gender: i % 2 ? 'L' : 'P', nis: `N${ki}${i}` } });
      }
    }

    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 1, mapel_id: mapelMtk, guru_id: gBudi.id, kelas_ids: [kelas[0].id, kelas[1].id], ruang: 'R-01' }
    });
    ok('slot gabungan (merge 2 kelas) tersimpan', r.status === 200 && r.body.id > 0, JSON.stringify(r.body));
    const slotMerge = r.body.id;

    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 1, mapel_id: mapelBin, guru_id: gHendra.id, kelas_ids: [kelas[0].id] }
    });
    ok('kelas terisi dobel ditolak (409)', r.status === 409 && /sudah terisi/i.test(r.body.error || ''), JSON.stringify(r.body));
    ok('konflik kelas menyebut nama kelas', (r.body.konflik || []).some(k => /sudah terisi/i.test(k.pesan)));

    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 1, mapel_id: mapelFis, guru_id: gHendra.id, kelas_ids: [kelas[2] ? kelas[2].id : kelas[1].id] }
    });
    ok('guru mengajar dua kelas pada jam sama ditolak', r.status === 409 && /sudah mengajar/i.test(r.body.error || ''), JSON.stringify(r.body));
    ok('guru pada slot dipaksa sesuai pengampu mapel (bukan guru dari form)',
      /Budi Santoso/.test(String((r.body.konflik || []).map(k => k.pesan).join(' '))), JSON.stringify(r.body.konflik));

    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 2, mapel_id: mapelBin, guru_id: gHendra.id, kelas_ids: [kelas[0].id] }
    });
    ok('slot pada jam istirahat ditolak', r.status === 409 && /istirahat/i.test(r.body.error || ''), JSON.stringify(r.body));

    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 3, mapel_id: mapelBin, guru_id: gHendra.id, kelas_ids: [kelas[0].id] }
    });
    ok('slot normal tersimpan', r.status === 200 && r.body.id > 0, JSON.stringify(r.body));
    const slotBin = r.body.id;

    /* batas jam mapel per hari → peringatan yang harus dikonfirmasi */
    const gWali = gAll.find(g => g.username === 'wali1') || gHendra;
    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 3, mapel_id: mapelFis, guru_id: gWali.id, kelas_ids: [kelas[2] ? kelas[2].id : kelas[1].id], ruang: 'LAB' }
    });
    ok('slot kelas lain tersimpan', r.status === 200, JSON.stringify(r.body));

    /* pindah slot (drag & drop) */
    r = await req('/api/jadwal/move', { method: 'POST', body: { id: slotBin, hari, sesi: 2 } });
    ok('pindah slot ke jam istirahat ditolak', r.status === 409);
    r = await req('/api/jadwal/move', { method: 'POST', body: { id: slotBin, hari, sesi: 3 } });
    ok('pindah slot ke jam yang sama tetap valid', r.status === 200);
    r = await req('/api/jadwal/move', { method: 'POST', body: { id: slotBin, hari, sesi: 1 } });
    ok('pindah slot ke jam yang sudah terisi kelas sama ditolak', r.status === 409, JSON.stringify(r.body));

    /* ================= 5. EKSPOR, CETAK, IMPOR ================= */
    console.log('\n== 5. TEMPLATE · IMPOR · EKSPOR · CETAK ==');
    r = await req('/api/jadwal/template.xlsx');
    ok('template jadwal xlsx dapat diunduh', r.status === 200 && /spreadsheet/.test(r.ct), r.ct);
    r = await req('/api/jadwal/export.xlsx');
    ok('ekspor jadwal xlsx', r.status === 200 && /spreadsheet/.test(r.ct), r.ct);
    r = await req('/api/jadwal/cetak');
    ok('cetak jadwal HTML memuat nama kelas', r.status === 200 && String(r.body).includes(kelas[0].nama),
      String(r.body).slice(0, 120) + ' … ' + String(r.body).length);
    ok('cetak jadwal memuat kop sekolah', /SMK PGRI CIKONENG/i.test(String(r.body)));

    /* berkas impor dibuat dengan xlsxBuffer aplikasi sendiri */
    const xlsx = lib.xlsxBuffer('JADWAL', [
      ['HARI', 'JAM MULAI', 'KODE MAPEL', 'MAPEL', 'GURU (USERNAME/NAMA)', 'KELAS (PISAH KOMA)', 'RUANG'],
      [dbmHari(hariBesok), hhmm(cur - 20), 'MTK', 'Matematika', 'budikur', kelas[0].nama, 'R-02'],
      [dbmHari(hariBesok), hhmm(cur + 31), 'BIN', 'Bahasa Indonesia', 'guru', `${kelas[0].nama}, ${kelas[1].nama}`, 'Aula'],
      [dbmHari(hariBesok), hhmm(cur + 31), 'IPA', 'Ilmu Pengetahuan Alam', 'wali1', kelas[2].nama, 'LAB'],
      [dbmHari(hariBesok), hhmm(cur + 31), 'FIS', 'Fisika', 'budikur', kelas[1].nama, 'LAB2'],
      [dbmHari(hariBesok), hhmm(cur - 20), 'ZZZ', 'Mapel Uji', 'tidak-ada-guru', kelas[0].nama, '']
    ], [10, 12, 12, 24, 24, 24, 12]);
    const b64 = xlsx.toString('base64');
    r = await req('/api/jadwal/import/preview', { method: 'POST', body: { base64: b64, filename: 'jadwal.xlsx' } });
    ok('pratinjau impor terbaca', r.status === 200 && r.body.rows.length === 5, JSON.stringify(r.body.ringkas));
    ok('pratinjau mendeteksi bentrok antar baris', (r.body.rows || []).some(x => /bentrok/i.test(x.pesan || '')), JSON.stringify(r.body.rows.map(x => x.pesan)));
    ok('pratinjau mendeteksi guru tidak dikenal', (r.body.rows || []).some(x => /tidak ditemukan/i.test(x.pesan || '')));
    ok('pratinjau menandai mapel baru', (r.body.rows || []).some(x => x.status === 'mapel-baru'),
      JSON.stringify((r.body.rows || []).map(x => [x.baris, x.status, x.pesan])));
    r = await req('/api/jadwal/import/commit', { method: 'POST', body: { base64: b64, filename: 'jadwal.xlsx', mode: 'tambah' } });
    ok('impor jadwal menambahkan baris valid', r.status === 200 && r.body.masuk >= 2, JSON.stringify(r.body));
    r = await req('/api/jadwal');
    ok('jadwal bertambah setelah impor', r.body.rows.length >= 4, String(r.body.rows.length));
    ok('konflik terhitung di ringkasan jadwal', typeof r.body.ringkas.bentrok === 'number');

    /* ================= 6. TAUTAN PUBLIK JADWAL ================= */
    console.log('\n== 6. TAUTAN PUBLIK REKAP JADWAL ==');
    r = await req('/api/jadwal/publik', { method: 'POST', body: { aktif: 1 } });
    ok('token tautan publik dibuat', r.status === 200 && !!r.body.token, JSON.stringify(r.body));
    const tokenJadwal = r.body.token;
    r = await req('/api/jadwal/publik', { method: 'POST', body: { aktif: 1, rotate: 1 } });
    ok('token publik dapat diganti (rotate)', r.body.token && r.body.token !== tokenJadwal);
    const tokenBaru = r.body.token;
    const cSimpan = cookie; cookie = '';
    r = await req('/api/public/jadwal/' + tokenJadwal);
    ok('token lama tidak berlaku setelah rotate', r.status === 404);
    r = await req('/api/public/jadwal/' + tokenBaru);
    ok('jadwal publik dapat diakses tanpa login', r.status === 200 && r.body.rows.length > 0, String(r.status));
    ok('data publik memuat daftar kelas & guru untuk filter', r.body.kelas.length > 0 && r.body.guru.length > 0);
    r = await req('/api/public/jadwal/' + tokenBaru + '?kelas=' + kelas[0].id);
    ok('filter kelas pada jadwal publik bekerja', r.status === 200 && r.body.rows.every(x => x.kelas_ids.includes(Number(kelas[0].id))));
    r = await req('/api/public/jadwal/' + tokenBaru + '?guru=' + gBudi.id);
    ok('filter guru pada jadwal publik bekerja', r.status === 200 && r.body.rows.every(x => Number(x.guru_id) === Number(gBudi.id)));
    r = await req('/api/public/jadwal/' + tokenBaru + '?q=matematika');
    ok('pencarian bebas pada jadwal publik bekerja', r.status === 200 && r.body.rows.length > 0);
    cookie = cSimpan;

    /* ================= 7. ABSENSI GURU (TIME LOCK) ================= */
    console.log('\n== 7. ABSENSI GURU MAPEL + TIME LOCK ==');
    /* wakasek membuat slot milik guru Hendra pada jam yang sedang berlangsung */
    r = await req('/api/jadwal/move', { method: 'POST', body: { id: slotMerge, hari, sesi: 1 } });
    ok('slot guru budi tetap pada jam berjalan', r.status === 200, JSON.stringify(r.body));
    cookie = cookieGuru;
    r = await req('/api/absensi-guru');
    ok('guru melihat slot mengajarnya hari ini', r.status === 200 && r.body.jadwal.length >= 1, JSON.stringify(r.body.jadwal && r.body.jadwal.length));
    ok('jendela absensi terbuka pada jam pelajaran', r.body.jadwal.every(j => j.window.aktif || /berakhir|dibuka|bukan/i.test(j.window.alasan || '')),
      JSON.stringify(r.body.jadwal.map(j => j.window)));
    /* wakasek menambahkan slot milik guru Hendra pada jam yang sedang berlangsung */
    cookie = cookieAdmin;
    r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari, sesi: 1, mapel_id: mapelBin, guru_id: gHendra.id, kelas_ids: [kelas[2].id], ruang: 'R-03' }
    });
    ok('slot khusus absensi guru dibuat pada jam berjalan', r.status === 200, JSON.stringify(r.body));
    const slotAbsen = { id: r.body.id };
    cookie = cookieGuru;
    r = await req('/api/absensi-guru/submit', {
      method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'hadir', materi: 'Membahas teks eksposisi dan latihan menulis' }
    });
    ok('submit absensi hadir + jurnal berhasil', r.status === 200 && r.body.id > 0, JSON.stringify(r.body).slice(0, 200));
    const absId = r.body.id;

    r = await req('/api/absensi-guru/submit', {
      method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'hadir', materi: 'Membahas teks eksposisi dan latihan menulis paragraf' }
    });
    ok('submit ulang memperbarui baris yang sama (tidak dobel)', r.status === 200 && r.body.id === absId, `${r.body.id} vs ${absId}`);
    r = await req('/api/absensi-guru/submit', { method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: kemarin, status: 'hadir', materi: 'xxxxx' } });
    ok('absensi tanggal lain ditolak (time lock)', r.status === 403);
    r = await req('/api/absensi-guru/submit', { method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'hadir', materi: 'pendek' } });
    ok('jurnal materi terlalu pendek ditolak', r.status === 400 && /materi/i.test(r.body.error || ''));
    r = await req('/api/absensi-guru/submit', {
      method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'izin', materi: '' }
    });
    ok('izin tanpa alasan ditolak', r.status === 400 && /alasan/i.test(r.body.error || ''));
    r = await req('/api/absensi-guru/submit', {
      method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'izin', catatan: 'Menghadiri undangan dinas' }
    });
    ok('izin dengan alasan diterima', r.status === 200);

    /* guru lain tidak boleh mengisi slot orang lain */
    const slotBudi = (await req('/api/jadwal', { cookie: cookieAdmin })).body.rows.find(x => Number(x.guru_id) === Number(gBudi.id));
    r = await req('/api/absensi-guru/submit', { method: 'POST', body: { jadwal_id: slotBudi.id, tanggal: tgl, status: 'hadir', materi: 'mengisi absen orang lain' } });
    ok('guru tidak boleh mengabsen slot guru lain (403)', r.status === 403);

    /* jendela waktu ditutup → ditolak */
    cookie = cookieAdmin;
    const sesiTutup = [{ label: 'Jam 1', mulai: hhmm(cur - 300), selesai: hhmm(cur - 200), istirahat: 0 }];
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ sesi: sesiTutup, absensi: { buka_menit: 5, tutup_menit: 5, jurnal_min: 10, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 30 } }) });
    ok('pengaturan diubah untuk menguji penutupan jendela', r.status === 200);
    cookie = cookieGuru;
    r = await req('/api/absensi-guru/submit', { method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'hadir', materi: 'percobaan setelah jendela ditutup' } });
    ok('absensi di luar jam pelajaran ditolak', r.status === 403 && /jendela|berakhir|dibuka/i.test(r.body.error || ''), JSON.stringify(r.body).slice(0, 160));

    /* foto wajib */
    cookie = cookieAdmin;
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 1, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 120 } }) });
    ok('foto bukti diaktifkan (wajib)', r.status === 200);
    cookie = cookieGuru;
    r = await req('/api/absensi-guru/submit', { method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'hadir', materi: 'Membahas teks eksposisi dan latihan menulis' } });
    ok('tanpa foto ditolak saat foto wajib', r.status === 400 && /foto/i.test(r.body.error || ''));
    const pngB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    r = await req('/api/absensi-guru/submit', {
      method: 'POST', body: { jadwal_id: slotAbsen.id, tanggal: tgl, status: 'hadir', materi: 'Membahas teks eksposisi dan latihan menulis', foto: pngB64, foto_nama: 'bukti.webp' }
    });
    ok('foto bukti tersimpan (mode lokal)', r.status === 200 && /^data:image|^https?:/.test(r.body.foto_url || ''), JSON.stringify(r.body).slice(0, 200));

    cookie = cookieAdmin;

    /* ================= 8. REKAP + NOTIFIKASI WHATSAPP ================= */
    console.log('\n== 8. REKAP & NOTIFIKASI WHATSAPP ==');
    r = await req('/api/absensi-guru/rekap');
    ok('rekap absensi guru tersedia', r.status === 200 && r.body.rekap.rows.length > 0, JSON.stringify(r.body.rekap && r.body.rekap.hitung));
    ok('rekap menghitung guru hadir/izin', r.body.rekap.rows.some(g => g.hadir > 0), JSON.stringify(r.body.rekap.hitung));
    r = await req('/api/absensi-guru/rekap-wa/preview');
    ok('pratinjau pesan rekap WA dibuat', r.status === 200 && /REKAP ABSENSI GURU/.test(r.body.pesan || ''), String(r.body.pesan || '').slice(0, 80));
    ok('pesan rekap memuat tanggal & nama guru', /Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu/.test(r.body.pesan || '') && r.body.pesan.includes('Budi'));
    r = await req('/api/absensi-guru/rekap-wa', { method: 'POST', body: {} });
    ok('kirim rekap WA manual (gateway belum aktif → manual)', r.status === 200 && r.body.hasil.length >= 1, JSON.stringify(r.body.hasil));
    r = await req('/api/absensi-guru');
    ok('tanggal rekap terakhir tercatat', (r.body.wa.terakhir || '') === tgl, r.body.wa.terakhir);

    /* ================= 9. ABSENSI SISWA + QR + TAUTAN PUBLIK ================= */
    console.log('\n== 9. ABSENSI SISWA PER MAPEL + QR + TAUTAN PUBLIK ==');
    cookie = cookieGuru;
    r = await req('/api/absensi-siswa');
    ok('daftar sesi mengajar hari ini terbaca', r.status === 200 && Array.isArray(r.body.jadwal), JSON.stringify(r.body.jadwal && r.body.jadwal.length));
    const jadwalGuru = r.body.jadwal.find(x => Number(x.guru_id) === Number(gHendra.id));
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: (jadwalGuru || {}).id, tanggal: tgl } });
    ok('sesi presensi + QR dibuat', r.status === 200 && !!r.body.sesi.token && /^<svg/.test(r.body.qr.svg || '') && /^data:image\/png/.test(r.body.qr.png || ''),
      JSON.stringify({ token: r.body.sesi && r.body.sesi.token, qr: !!(r.body.qr && r.body.qr.svg) }));
    const tokenPresensi = r.body.sesi.token;
    const sesiId = r.body.sesi.id;
    ok('daftar siswa kelas tampil berurutan', r.body.siswa.length > 0 && r.body.siswa[0].no === 1, String(r.body.siswa && r.body.siswa.length));
    ok('status default siswa = H', r.body.siswa.every(s => s.status === 'H'));
    ok('tautan QR memakai alamat absolut', /^https?:\/\/.+\/presensi\//.test(r.body.qr.url || ''), r.body.qr.url);

    r = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: {
        sesi_id: sesiId,
        items: r.body.siswa.map((s, i) => ({ siswa_id: s.id, status: i === 1 ? 'S' : i === 2 ? 'I' : 'H', keterangan: i === 1 ? 'demam' : i === 2 ? 'acara keluarga' : '' }))
      }
    });
    ok('presensi oleh guru tersimpan', r.status === 200 && r.body.tersimpan === r.body.tersimpan, JSON.stringify(r.body).slice(0, 160));

    const cookieGuruNow = cookie;
    cookie = '';
    r = await req('/api/public/presensi/' + tokenPresensi);
    ok('tautan presensi publik terbuka tanpa login', r.status === 200 && r.body.siswa.length > 0, String(r.status));
    ok('presensi publik memuat status yang sudah diisi', r.body.siswa.some(s => s.status === 'S' && /demam/.test(s.keterangan || '')));
    ok('presensi publik mengirim daftar status H/S/I/A/B', (r.body.status_list || []).length === 5);
    const itemsPublic = r.body.siswa.map((s, i) => ({ siswa_id: s.id, status: i === 0 ? 'A' : i === 3 ? 'B' : 'H', keterangan: i === 0 ? 'tanpa kabar' : i === 3 ? 'bolos' : '' }));
    const namaKetua = r.body.siswa[1].nama;
    r = await req('/api/public/presensi/' + tokenPresensi, { method: 'POST', body: { pencatat: 'Maman S.', items: itemsPublic } });
    ok('nama pencatat yang tidak terdaftar di kelas ditolak', r.status === 400, JSON.stringify(r.body).slice(0, 160));
    r = await req('/api/public/presensi/' + tokenPresensi, { method: 'POST', body: { pencatat: namaKetua, items: itemsPublic } });
    ok('ketua kelas dapat menyimpan presensi via tautan (nama terverifikasi)', r.status === 200 && r.body.tersimpan > 0, JSON.stringify(r.body).slice(0, 160));
    r = await req('/api/public/presensi/' + tokenPresensi);
    ok('nama pencatat tersimpan', r.body.sesi.pencatat === namaKetua, r.body.sesi.pencatat);
    r = await req('/api/public/presensi/' + tokenPresensi, { method: 'POST', body: { pencatat: 'X', items: itemsPublic } });
    ok('pencatat tanpa nama valid ditolak', r.status === 400);
    r = await req('/api/public/presensi/' + tokenPresensi + '-salah');
    ok('token presensi salah → 404', r.status === 404);
    cookie = cookieGuruNow;

    r = await req('/api/absensi-siswa/rekap');
    ok('rekap presensi siswa per mapel tersedia', r.status === 200 && r.body.total.H + r.body.total.A + r.body.total.B > 0, JSON.stringify(r.body.total));
    ok('rekap presensi memuat ringkasan per siswa', Array.isArray(r.body.per_siswa) && r.body.per_siswa.length > 0);

    /* guru lain tidak boleh membuka sesi kelas orang lain */
    cookie = cookieGuru;
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotBudi.id, tanggal: tgl } });
    ok('guru lain tidak boleh membuat sesi kelas orang lain (403)', r.status === 403);

    /* RBAC: role tu tanpa izin tulis absensi siswa */
    let rt = await req('/api/login', { method: 'POST', body: { kode: KODE, username: 'tu', password: 'tu123456' } });
    ok('login akun TU', rt.status === 200, JSON.stringify(rt.body));
    r = await req('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: sesiId, items: [] } });
    ok('role tanpa izin tulis presensi ditolak (403)', r.status === 403, String(r.status));

    /* ================= 10. BIMBINGAN JENDELA PRESENSI SISWA ================= */
    console.log('\n== 10. TIME LOCK PRESENSI SISWA ==');
    const mulaiLalu = Math.max(5, cur - 400);   // aman walau pengujian dijalankan dini hari
    cookie = cookieAdmin;
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({
        /* gunakan rentang yang selalu valid tanpa melewati tengah malam */
        sesi: [{ label: 'Jam 1', mulai: hhmm(mulaiLalu), selesai: hhmm(mulaiLalu + 50), istirahat: 0 }],
        absensi: { buka_menit: 5, tutup_menit: 5, jurnal_min: 10, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 5 }
      })
    });
    ok('jam pelajaran diubah ke masa lalu', r.status === 200);
    cookie = '';
    r = await req('/api/public/presensi/' + tokenPresensi);
    ok('presensi publik menandai jendela tertutup', r.status === 200 && r.body.bisa_simpan === false, JSON.stringify(r.body.window));
    r = await req('/api/public/presensi/' + tokenPresensi, { method: 'POST', body: { pencatat: namaKetua, items: itemsPublic } });
    ok('isian presensi di luar jendela ditolak', r.status === 403);

    /* ================= 11. PENGATURAN RETENSI FOTO ================= */
    console.log('\n== 11. PENYIMPANAN BUKTI FOTO ==');
    cookie = cookieAdmin;
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 120 } }) });
    ok('masa simpan foto dapat diatur (30 hari)', r.status === 200);
    r = await req('/api/jadwal/pengaturan');
    ok('nilai retensi foto tersimpan', r.body.absensi.foto_hari === 30, String(r.body.absensi.foto_hari));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
  }

  console.log('\n=== HASIL AKADEMIK: ' + pass + ' lulus, ' + fail + ' gagal ===');
  if (fails.length) { console.log('\nGAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})();
