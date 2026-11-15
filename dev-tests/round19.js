'use strict';
/* Uji ronde 19: check-in guru real-time, alfa otomatis, jurnal+foto kamera,
   rekap absensi per mapel (bug s.kelas_id), slot mapel per tahun pelajaran,
   QR jadwal publik, dan validasi nama ketua kelas.
   Jalankan: node dev-tests/round19.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-r19-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r19-saas-' + Date.now() + '.sqlite');
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
const login = async (u, pw) => { cookie = ''; return req('/api/login', { method: 'POST', body: { username: u, password: pw, kode: KODE } }); };
const pad = n => String(n).padStart(2, '0');
const wib = new Date(Date.now() + 7 * 3600 * 1000);
const TODAY = wib.toISOString().slice(0, 10);
const HARI = wib.getUTCDay();
const hhmm = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const menit = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2300));

  const cfgBody = (extra = {}) => ({
    hari: [HARI], max_jam: 8,
    sesi: extra.sesi || [{ label: 'Jam 1', mulai: hhmm(new Date(Date.now() + 7 * 3600 * 1000 - 20 * 60000)), selesai: hhmm(new Date(Date.now() + 7 * 3600 * 1000 + 50 * 60000)), istirahat: 0 }],
    max_mapel_jam: 2, max_guru_jam: 8,
    absensi: extra.absensi || { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
    wa: { aktif: 0, jam: '15:00' }
  });

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    const users = (await req('/api/users')).body.rows || [];
    const gHendra = users.find(u => u.username === 'guru');
    /* Ronde 21: guru pengampu terkunci per mapel → buat mapel untuk tiap guru uji */
    const mapel = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Bahasa Indonesia', kode: 'BIN', guru_ids: [gHendra.id] } });
    ok('mapel uji dibuat', mapel.status === 200 && !!mapel.body.id);
    const mapelWawan = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Sejarah', kode: 'SJH', guru_ids: [users.find(u => u.username === 'guruumum').id] } });
    const mapelWali = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Geografi', kode: 'GEO', guru_ids: [users.find(u => u.username === 'wali1').id] } });
    ok('mapel pengampu tambahan dibuat', mapelWawan.status === 200 && mapelWali.status === 200);
    const kelas = (await req('/api/jadwal')).body.kelas;
    const siswaRows = (await req('/api/siswa?limit=6')).body.rows || [];
    const kelasUji = kelas.find(k => k.id === siswaRows[0].kelas_id) || kelas[0];
    ok('kelas & siswa uji tersedia', !!kelasUji && siswaRows.length > 0);

    await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    let r = await req('/api/jadwal/slot', {
      method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapel.body.id, guru_id: gHendra.id, kelas_ids: [kelasUji.id], abaikan: 1 }
    });
    const slotId = r.body.id;
    ok('slot jadwal hari ini dibuat', r.status === 200 && !!slotId, r.body?.error);

    /* ================= 1. CHECK-IN GURU ================= */
    console.log('\n== 1. CHECK-IN GURU (REAL-TIME & TERKUNCI) ==');
    const cookieAdmin = cookie;
    await login('guru', 'guru123');
    r = await req('/api/absensi-guru');
    const slot = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotId));
    ok('guru melihat slot mengajarnya', !!slot, JSON.stringify((r.body.jadwal || []).map(j => j.id)));
    ok('slot menandai tombol check-in tersedia', !!slot && slot.bisa_checkin === true, JSON.stringify(slot && { bisa: slot.bisa_checkin, window: slot.window }));
    ok('informasi alfa otomatis dibawa ke halaman', !!r.body.auto_alpha && r.body.auto_alpha.aktif === true);

    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY, status: 'hadir' } });
    ok('check-in hadir berhasil tanpa jurnal', r.status === 200 && r.body.status === 'hadir', r.body?.error);
    const waktuCheckin = r.body.waktu_submit || '';
    ok('check-in mencatat cap waktu real-time (detik)', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(waktuCheckin), waktuCheckin);

    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY, status: 'hadir' } });
    ok('check-in kedua ditolak (status terkunci)', r.status === 409, r.body?.error);
    r = await req('/api/absensi-guru/submit', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY, status: 'izin', catatan: 'mencoba ubah status' } });
    ok('guru tidak bisa mengubah status setelah check-in', r.status === 409, JSON.stringify(r.body).slice(0, 140));
    /* RONDE 22: jurnal hanya boleh disimpan SETELAH absensi siswa lengkap */
    r = await req('/api/absensi-guru/jurnal', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY, materi: 'Membahas teks eksposisi dan struktur paragraf' } });
    ok('jurnal ditolak sebelum absensi siswa lengkap', r.status === 400 && r.body.butuh_absensi_siswa === true,
      JSON.stringify(r.body).slice(0, 140));
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY } });
    const sesiAlur = r.body?.sesi?.id;
    const siswaAlur = r.body?.siswa || [];
    ok('sesi presensi alur dibuat', !!sesiAlur && siswaAlur.length > 0, r.body?.error);
    await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiAlur, items: siswaAlur.map(x => ({ siswa_id: x.id, status: 'H', keterangan: '' })) }
    });
    r = await req('/api/absensi-guru/jurnal', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY, materi: 'Membahas teks eksposisi dan struktur paragraf' } });
    ok('jurnal mengajar bisa dilengkapi setelah absensi siswa', r.status === 200, r.body?.error);
    const pngB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    r = await req('/api/absensi-guru/jurnal', { method: 'POST', body: { jadwal_id: slotId, tanggal: TODAY, materi: 'Membahas teks eksposisi dan struktur paragraf', foto: pngB64, foto_nama: 'kamera.webp' } });
    ok('foto bukti hasil kamera tersimpan', r.status === 200 && !!r.body.foto_url, JSON.stringify(r.body).slice(0, 140));
    r = await req('/api/absensi-guru');
    const sesudah = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotId));
    ok('status tetap hadir setelah jurnal diisi', !!sesudah && sesudah.absensi.status === 'hadir');
    ok('halaman menandai status terkunci (via_checkin)', !!sesudah && sesudah.via_checkin === true);
    ok('tombol check-in nonaktif setelah tercatat', !!sesudah && sesudah.bisa_checkin === false);

    r = await req('/api/absensi-guru/alur?jadwal_id=' + slotId + '&tanggal=' + TODAY);
    ok('status alur menandai absensi siswa & jurnal lengkap',
      r.status === 200 && r.body.alur.absensi_siswa.lengkap === true && r.body.alur.jurnal.lengkap === true,
      JSON.stringify(r.body.alur).slice(0, 160));

    /* ================= 2. SAKIT / IZIN ================= */
    console.log('\n== 2. SAKIT & IZIN ==');
    cookie = cookieAdmin;
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    const kelasKedua = kelas.find(k => k.id !== kelasUji.id) || kelasUji;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelWawan.body.id, guru_id: users.find(u => u.username === 'guruumum').id, kelas_ids: [kelasKedua.id], abaikan: 1 } });
    ok('slot kedua dibuat (jam sama, guru lain)', r.status === 200, r.body?.error);
    const slotSakit = r.body.id;
    await login('guruumum', 'guruumum123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotSakit, tanggal: TODAY, status: 'sakit', catatan: '' } });
    ok('sakit tanpa alasan ditolak', r.status === 400, r.body?.error);
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotSakit, tanggal: TODAY, status: 'sakit', catatan: 'Demam tinggi, ada surat dokter' } });
    ok('sakit dengan alasan tersimpan', r.status === 200 && r.body.status === 'sakit', r.body?.error);
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotSakit, tanggal: TODAY, status: 'izin', catatan: 'mencoba ubah' } });
    ok('status sakit terkunci (tidak bisa jadi izin)', r.status === 409);

    /* ================= 3. ALFA OTOMATIS ================= */
    console.log('\n== 3. ALFA OTOMATIS SETELAH JAM PELAJARAN ================');
    cookie = cookieAdmin;
    /* jam pelajaran digeser ke masa lalu → jendela berakhir */
    const past = (menitAwal) => new Date(Date.now() + 7 * 3600 * 1000 - menitAwal * 60000);
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({
        sesi: [{ label: 'Jam 1', mulai: hhmm(past(180)), selesai: hhmm(past(120)), istirahat: 0 }],
        absensi: { buka_menit: 5, tutup_menit: 5, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 30 }
      })
    });
    ok('jam pelajaran digeser ke masa lalu', r.status === 200);
    const kelasKetiga = kelas.find(k => k.id !== kelasUji.id && k.id !== kelasKedua.id);
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelWali.body.id, guru_id: users.find(u => u.username === 'wali1').id, kelas_ids: [kelasKetiga.id], abaikan: 1 } });
    const slotAlfa = r.body.id;
    ok('slot untuk uji alfa otomatis dibuat', r.status === 200, r.body?.error);
    r = await req('/api/absensi-guru');
    ok('alfa otomatis menandai slot yang tidak check-in', r.status === 200 && (r.body.auto_alpha || {}).dibuat >= 1, JSON.stringify(r.body.auto_alpha));
    const alfa = (r.body.jadwal_hari || r.body.jadwal || []).find(j => Number(j.id) === Number(slotAlfa));
    ok('slot tanpa check-in berstatus alpha', !!alfa && alfa.absensi && alfa.absensi.status === 'alpha', JSON.stringify(alfa && alfa.absensi));
    ok('status alfa ditandai otomatis (auto_alfa)', !!alfa && alfa.auto_alfa === true);
    r = await req('/api/absensi-guru/rekap');
    ok('rekap guru menghitung alfa otomatis', r.status === 200 && (r.body.rekap.hitung.alpha || 0) >= 1, JSON.stringify(r.body.rekap.hitung));
    await login('wali1', 'wali123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotAlfa, tanggal: TODAY, status: 'hadir' } });
    ok('check-in di luar jam pelajaran ditolak (terkunci)', r.status === 403, r.body?.error);

    /* admin dapat mematikan alfa otomatis lewat Pengaturan Jadwal */
    cookie = cookieAdmin;
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({
        sesi: [{ label: 'Jam 1', mulai: hhmm(past(180)), selesai: hhmm(past(120)), istirahat: 0 }],
        absensi: { buka_menit: 5, tutup_menit: 5, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 30, auto_alpha: 0 }
      })
    });
    ok('alfa otomatis dapat dinonaktifkan', r.status === 200);
    r = await req('/api/absensi-guru');
    ok('halaman menandai alfa otomatis nonaktif', r.body.auto_alpha && r.body.auto_alpha.aktif === false, JSON.stringify(r.body.auto_alpha));
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('alfa otomatis diaktifkan kembali', r.status === 200);

    /* ================= 4. REKAP ABSENSI PER MAPEL ================= */
    console.log('\n== 4. REKAP ABSENSI PER MAPEL (BUG s.kelas_id) ==');
    cookie = cookieAdmin;
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    const jadwalNow = (await req('/api/jadwal')).body.rows.find(x => Number(x.guru_id) === Number(gHendra.id));
    await login('guru', 'guru123');
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: jadwalNow.id, tanggal: TODAY } });
    const sesiId = r.body?.sesi?.id;
    ok('sesi presensi dibuat untuk rekap mapel', r.status === 200 && !!sesiId, r.body?.error);
    const daftarSiswa = r.body.siswa || [];
    r = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiId, items: daftarSiswa.map((s, i) => ({ siswa_id: s.id, status: i === 0 ? 'A' : i === 1 ? 'S' : 'H', keterangan: '' })) }
    });
    ok('presensi tersimpan + poin otomatis', r.status === 200 && r.body.poin && r.body.poin.dibuat >= 1, JSON.stringify(r.body.poin));

    cookie = cookieAdmin;
    r = await req(`/api/absensi-siswa/rekap?dari=${TODAY}&sampai=${TODAY}&kelas=${kelasUji.id}`);
    ok('rekap per KELAS tidak lagi error no such column', r.status === 200 && Array.isArray(r.body.per_siswa), JSON.stringify(r.body).slice(0, 160));
    r = await req(`/api/absensi-siswa/rekap?dari=${TODAY}&sampai=${TODAY}&mapel=${mapel.body.id}`);
    ok('rekap per MAPEL berjalan', r.status === 200 && r.body.jumlah >= 1, JSON.stringify(r.body.total));
    r = await req(`/api/absensi-siswa/rekap?dari=${TODAY}&sampai=${TODAY}&kelas=${kelasUji.id}&mapel=${mapel.body.id}`);
    ok('rekap dengan filter kelas + mapel sekaligus', r.status === 200 && r.body.per_siswa.length >= 1, JSON.stringify(r.body.per_siswa).slice(0, 140));
    ok('rekap memuat nama kelas siswa', (r.body.per_siswa || []).every(s => !!s.kelas_nama), JSON.stringify(r.body.per_siswa[0]));
    r = await req('/api/rekap/absensi-siswa?mode=kelas&kelas=' + kelasUji.id + '&periode=harian&tanggal=' + TODAY);
    ok('modul rekap absensi siswa tetap berjalan', r.status === 200 && Array.isArray(r.body.siswa), r.body?.error);

    /* ================= 5. JADWAL: SLOT MAPEL & QR PUBLIK ================= */
    console.log('\n== 5. JADWAL: SLOT MAPEL PER TA & QR PUBLIK ==');
    r = await req('/api/mapel');
    const mapelUji = (r.body.rows || []).find(m => m.id === mapel.body.id);
    ok('daftar mapel menghitung slot pada TA aktif', !!mapelUji && mapelUji.dipakai >= 1, JSON.stringify(mapelUji && { dipakai: mapelUji.dipakai }));
    r = await req('/api/mapel?ta=' + ((await req('/api/jadwal')).body.ta));
    ok('jumlah slot mapel mengikuti tahun pelajaran terpilih', (r.body.rows || []).find(m => m.id === mapel.body.id).dipakai >= 1);
    r = await req('/api/jadwal');
    ok('matriks jadwal mengirim daftar kelas (rombel) & slot', r.status === 200 && r.body.kelas.length > 0 && r.body.rows.length > 0, `${r.body.kelas.length} kelas / ${r.body.rows.length} slot`);
    ok('ringkasan jadwal memuat jumlah slot', typeof r.body.ringkas.slot === 'number' && r.body.ringkas.slot >= 1);

    r = await req('/api/jadwal/publik', { method: 'POST', body: { aktif: 1 } });
    ok('tautan publik jadwal di-generate', r.status === 200 && !!r.body.token, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/jadwal/publik/qr');
    ok('QR jadwal publik dibuat (svg + png)', r.status === 200 && /<svg/.test(r.body.qr.svg) && /^data:image\/png/.test(r.body.qr.png), r.body?.error);
    const tokenJadwal = r.body.token;
    ok('tautan publik jadwal absolut', /^https?:\/\/.+\/jadwal-publik\//.test(r.body.url || ''), r.body.url);
    r = await req('/api/public/jadwal/' + tokenJadwal + '/qr');
    ok('QR publik jadwal bisa diambil tanpa login', r.status === 200 && /<svg/.test(r.body.qr.svg), r.body?.error);
    r = await req('/api/public/jadwal/' + tokenJadwal);
    ok('data jadwal publik tetap memuat kelas & slot', r.status === 200 && r.body.kelas.length > 0 && r.body.rows.length > 0);
    r = await req('/api/public/jadwal/token-palsu/qr');
    ok('token jadwal palsu → 404', r.status === 404);

    /* ================= 6. VERIFIKASI NAMA KETUA KELAS ================= */
    console.log('\n== 6. VERIFIKASI NAMA PENCATAT PRESENSI KELAS ==');
    await login('guru', 'guru123');
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: jadwalNow.id, tanggal: TODAY } });
    const tokenPresensi = r.body.sesi.token;
    const items = (r.body.siswa || []).map(s => ({ siswa_id: s.id, status: 'H', keterangan: '' }));
    cookie = '';
    r = await req('/api/public/presensi/' + tokenPresensi);
    ok('halaman publik presensi tetap terbuka', r.status === 200 && r.body.siswa.length > 0);
    r = await req('/api/public/presensi/' + tokenPresensi, { method: 'POST', body: { pencatat: 'Nama Ngawur', items } });
    ok('nama pencatat yang tidak terdaftar ditolak', r.status === 400 && /terdaftar/i.test(r.body.error || ''), r.body?.error);
    const namaAsli = r.body && (await req('/api/public/presensi/' + tokenPresensi)).body.siswa[0].nama;
    r = await req('/api/public/presensi/' + tokenPresensi, { method: 'POST', body: { pencatat: namaAsli, items } });
    ok('nama siswa terdaftar diterima & presensi tersimpan', r.status === 200 && r.body.tersimpan > 0, JSON.stringify(r.body).slice(0, 140));
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
