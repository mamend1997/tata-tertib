'use strict';
/* Uji ronde 23 (tata-tertib):
   1. JADWAL "KOSONG" di Absensi Siswa per Mapel — slot yang tahun pelajarannya
      sudah dihapus (ta_id yatim) diperbaiki otomatis saat server start, dan
      parameter `ta` basi dari peramban tidak lagi membuat data kosong.
   2. Tanda tangan cetak jadwal: Kepala Sekolah (kiri) · Wakasek Kurikulum (kanan),
      Pengawas Pembina di bawah tengah, tanpa tulisan "Mengetahui" di atas Kepala.
   3. Tukar Jadwal Mengajar: kandidat HANYA guru yang mengampu kelas yang sama,
      permintaan masuk + Terima/Tolak, guru pengganti menjadi pemilik sesi hari itu
      saja (jadwal pekan berikutnya tetap normal).
   Jalankan: node dev-tests/tukar.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-tukar-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-tukar-saas-' + Date.now() + '.sqlite');
const PORT = 4700 + Math.floor(Math.random() * 150);
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
const wib = new Date();
const TODAY = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
const HARI = wib.getDay();
const hhmm = (m) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
const cur = wib.getHours() * 60 + wib.getMinutes();
const base = Math.min(cur, 1440 - 160);
/* tanggal pekan berikutnya (hari sama, 7 hari lagi) */
const NEXT_WEEK = (() => { const d = new Date(wib.getTime() + 7 * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();

let srv = null;
async function startServer() {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2300));
}
async function stopServer() {
  if (!srv) return;
  srv.kill('SIGTERM');
  srv = null;
  await new Promise(r => setTimeout(r, 700));
}

(async () => {
  await startServer();

  const cfgBody = (extra = {}) => ({
    hari: [HARI], max_jam: 8,
    sesi: extra.sesi || [
      { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
      { label: 'Jam ke-2', mulai: hhmm(base + 26), selesai: hhmm(base + 60), istirahat: 0 },
      { label: 'Jam ke-3', mulai: hhmm(base + 61), selesai: hhmm(base + 95), istirahat: 0 },
      { label: 'Jam ke-4', mulai: hhmm(base + 96), selesai: hhmm(base + 130), istirahat: 0 },
      { label: 'Jam ke-5', mulai: hhmm(base + 131), selesai: hhmm(base + 165), istirahat: 0 },
      { label: 'Jam ke-6', mulai: hhmm(base + 166), selesai: hhmm(base + 200), istirahat: 0 }
    ],
    max_mapel_jam: 8, max_guru_jam: 8,
    absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
    wa: { aktif: 0, jam: '15:00' }
  });

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    /* akun guru uji: dua guru ber-role guru_umum (punya izin absensi_guru.write) */
    const mkUser = async (nama, username, roles) => {
      const r = await req('/api/users/save', { method: 'POST', body: { nama, username, password: 'guru123', role: 'guru_umum', roles } });
      return r.body.id;
    };
    const gA = await mkUser('Guru Pengampu A', 'gurua', ['guru']);
    const gB = await mkUser('Guru Pengganti B', 'gurub', ['guru']);
    const gC = await mkUser('Guru Kelas Lain C', 'guruc', ['guru']);
    ok('3 akun guru uji dibuat', !!gA && !!gB && !!gC, JSON.stringify([gA, gB, gC]));

    let r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('pengaturan jadwal disimpan', r.status === 200, r.body?.error);

    const kelas = (await req('/api/jadwal')).body.kelas || [];
    ok('kelas uji tersedia', kelas.length >= 2, String(kelas.length));
    const K1 = kelas[0].id, K2 = kelas[1].id;

    const mapel = async (nama, kode, guruId) => {
      const x = await req('/api/mapel/save', { method: 'POST', body: { nama, kode, guru_ids: [guruId] } });
      return x.body.id;
    };
    const mA = await mapel('Mapel A', 'MPA', gA);
    const mB = await mapel('Mapel B', 'MPB', gB);
    const mC = await mapel('Mapel C', 'MPC', gC);

    /* Dua slot berurutan per mapel untuk memastikan pertukaran dan rekap
       memperlakukan rentang mapel sebagai satu kehadiran per hari. */
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mA, guru_id: gA, kelas_ids: [K1], abaikan: 1 } });
    ok('slot guru A (kelas 1) dibuat', r.status === 200, r.body?.error);
    const slotA = r.body.id;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 2, mapel_id: mA, guru_id: gA, kelas_ids: [K1], abaikan: 1 } });
    const slotA2 = r.body.id;
    ok('jam kedua mapel A tersambung', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 3, mapel_id: mB, guru_id: gB, kelas_ids: [K1], abaikan: 1 } });
    const slotB = r.body.id;
    ok('slot guru B (kelas 1) dibuat', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 4, mapel_id: mB, guru_id: gB, kelas_ids: [K1], abaikan: 1 } });
    const slotB2 = r.body.id;
    ok('jam kedua mapel B tersambung', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 5, mapel_id: mA, guru_id: gA, kelas_ids: [K1], abaikan: 1 } });
    const slotA3 = r.body.id;
    ok('mapel A muncul lagi setelah jeda mapel lain', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 6, mapel_id: mC, guru_id: gC, kelas_ids: [K2], abaikan: 1 } });
    ok('slot guru C (kelas 2) dibuat', r.status === 200, r.body?.error);

    /* ============ 1. JADWAL TIDAK LAGI KOSONG ============ */
    console.log('\n== 1. JADWAL & ABSENSI SISWA TIDAK KOSONG ==');
    r = await req('/api/jadwal?ta=99999');
    ok('parameter TA basi diabaikan (memakai TA aktif)', Number(r.body.ta) === 1, JSON.stringify({ ta: r.body.ta }));
    ok('slot tetap terbaca walau TA di URL tidak ada', (r.body.rows || []).length === 6, String((r.body.rows || []).length));

    r = await req(`/api/absensi-siswa?tanggal=${TODAY}&ta=99999`);
    ok('Absensi Siswa per Mapel menampilkan sesi hari ini', (r.body.jadwal || []).length >= 2,
      JSON.stringify((r.body.jadwal || []).map(j => j.id)));

    /* SIMULASI BUG ASLI: slot disimpan pada TA yang kemudian dihapus (ta_id yatim) */
    await stopServer();
    const Database = require('better-sqlite3');
    {
      const d = new Database(DB);
      d.prepare("INSERT INTO tahun_ajaran(nama,tanggal_mulai,tanggal_selesai,aktif,created_at) VALUES('2099/2100','2099-07-01','2100-06-30',0,?)").run('2099-07-01 00:00:00');
      const orphanTa = d.prepare("SELECT id FROM tahun_ajaran WHERE nama='2099/2100'").get().id;
      d.prepare('UPDATE jadwal SET ta_id=? WHERE id=?').run(orphanTa, slotA);
      d.prepare('DELETE FROM tahun_ajaran WHERE id=?').run(orphanTa);
      const cek = d.prepare('SELECT ta_id FROM jadwal WHERE id=?').get(slotA);
      ok('simulasi: slot menyimpan TA yatim', Number(cek.ta_id) === Number(orphanTa), JSON.stringify(cek));
      d.close();
    }
    await startServer();
    await login('admin', 'admin123');
    r = await req('/api/jadwal');
    ok('migrasi memperbaiki ta_id slot yatim → TA aktif', (r.body.rows || []).some(x => Number(x.id) === Number(slotA)),
      JSON.stringify((r.body.rows || []).map(x => ({ id: x.id, ta: x.ta_id }))));
    r = await req(`/api/absensi-siswa?tanggal=${TODAY}`);
    ok('sesi hasil perbaikan muncul di Absensi Siswa per Mapel',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotA)), JSON.stringify((r.body.jadwal || []).map(j => j.id)));
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}&guru=${gA}&mapel=${mA}`);
    ok('mapel dan kelas yang terpisah jamnya tetap satu baris rekap',
      r.status === 200 && (r.body.rows || []).length === 1
        && (r.body.rows[0].jadwal_ids || []).length === 3
        && Number(r.body.rows[0].jadwal_id) === Number(slotA),
      JSON.stringify((r.body.rows || []).map(x => ({ mapel: x.mapel_id, kelas: x.kelas_nama, slots: x.jadwal_ids }))));
    r = await req(`/api/absensi-guru/rekap?tanggal=${TODAY}`);
    const guruARekap = (r.body.rekap?.rows || []).find(x => Number(x.guru_id) === Number(gA));
    ok('ringkasan harian juga menghitung mapel-kelas hanya sekali',
      r.status === 200 && Number(r.body.rekap?.jadwal) === 3
        && Number(guruARekap?.jadwal) === 1
        && (guruARekap?.slots?.[0]?.jadwal_ids || []).length === 3,
      JSON.stringify({ total: r.body.rekap?.jadwal, guruA: guruARekap }));

    /* ============ 2. TANDA TANGAN CETAK JADWAL ============ */
    console.log('\n== 2. URUTAN TANDA TANGAN CETAK JADWAL ==');
    await login('admin', 'admin123');
    await req('/api/jadwal/desain', {
      method: 'POST', body: {
        judul: 'JADWAL PELAJARAN', semester: 'Semester Genap', ta_teks: 'Tahun Pelajaran 2026/2027',
        tempat: 'Cikoneng', tanggal: '2 Januari 2027', pengawas_tampil: 1,
        pengawas_nama: 'IKA JULIANTININGSIH, S.Pd., M.Pd.', pengawas_nip: '1969071419980 2 200 1',
        kepala_nama: 'Agung Hermawan, S.Pd.', kepala_nip: '-',
        wakasek_nama: 'Mohamad Faizal Adha, S.Pd.', wakasek_nip: '-', wakasek_jabatan: 'Wakasek Kurikulum'
      }
    });
    r = await req('/api/jadwal/cetak?mode=vertikal');
    const html = String(r.body || '');
    ok('halaman cetak jadwal dirender', r.status === 200 && html.includes('Agung Hermawan'));
    const posKepala = html.indexOf('Kepala Sekolah,');
    const posWakasek = html.indexOf('Wakasek Kurikulum,');
    const posPengawas = html.indexOf('Pengawas Pembina,');
    ok('label "Kepala Sekolah," ada', posKepala > 0);
    ok('label "Wakasek Kurikulum," ada', posWakasek > 0);
    ok('label "Pengawas Pembina," ada', posPengawas > 0);
    ok('tidak ada tulisan "Mengetahui" di atas Kepala Sekolah', !/Mengetahui[^<]*<br>\s*Kepala/i.test(html));
    ok('urutan: Kepala → Wakasek → Pengawas (bawah tengah)', posKepala < posWakasek && posWakasek < posPengawas,
      JSON.stringify({ posKepala, posWakasek, posPengawas }));
    ok('nama pengawas berada setelah label pengawas', html.indexOf('IKA JULIANTININGSIH', posPengawas) > posPengawas);
    ok('blok tanda tangan pengawas memakai kelas ttd-pengawas', /class="ttd-pengawas"/.test(html));

    /* ============ 3. TUKAR JADWAL MENGAJAR ============ */
    console.log('\n== 3. TUKAR JADWAL MENGAJAR ==');
    await login('admin', 'admin123');
    r = await req('/api/jadwal');
    await login('gurua', 'guru123');
    r = await req(`/api/tukar-jadwal/kandidat?jadwal_id=${slotA}&tanggal=${TODAY}`);
    ok('kandidat guru pengganti tersedia', r.status === 200 && Array.isArray(r.body.kandidat), r.body?.error);
    const kand = r.body.kandidat || [];
    ok('guru B (mengampu kelas yang sama) muncul', kand.some(k => Number(k.id) === Number(gB)),
      JSON.stringify({ slot: r.body.slot, kandidat: kand.map(k => ({ id: k.id, mapel: k.mapel, bentrok_info: k.bentrok_info })) }));
    ok('guru C (kelas lain) TIDAK muncul', !kand.some(k => Number(k.id) === Number(gC)), JSON.stringify(kand.map(k => k.nama)));
    const kB = kand.find(k => Number(k.id) === Number(gB)) || {};
    ok('kandidat menyertakan mata pelajaran yang diampu', (kB.mapel || []).length >= 1, JSON.stringify(kB.mapel));

    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, ke_guru: gC, alasan: 'uji' } });
    ok('guru yang mengampu kelas lain ditolak server', r.status === 409 && /tidak memiliki slot mapel pasangan/i.test(r.body.error || ''), r.body?.error);

    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotB, tanggal: TODAY, ke_guru: gB, alasan: 'uji' } });
    ok('guru tidak boleh menukar sesi milik guru lain', r.status === 403, r.body?.error);

    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, ke_guru: gB, alasan: 'ada tugas luar' } });
    ok('permintaan tukar jadwal terkirim', r.status === 200 && r.body.tukar?.status === 'pending', JSON.stringify(r.body).slice(0, 200));
    const tukarId = r.body.id;
    ok('permintaan memuat alasan', /tugas luar/.test(JSON.stringify(r.body.tukar || {})));

    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, ke_guru: gB } });
    ok('permintaan ganda untuk sesi yang sama ditolak', r.status === 409, r.body?.error);

    /* guru B menerima notifikasi */
    await login('gurub', 'guru123');
    r = await req('/api/tukar-jadwal');
    ok('guru tujuan melihat permintaan masuk', (r.body.masuk || []).some(t => Number(t.id) === Number(tukarId)),
      JSON.stringify((r.body.masuk || []).map(t => t.id)));
    r = await req('/api/dashboard');
    ok('dashboard guru tujuan memuat tukar_masuk (notifikasi)', (r.body.tukar_masuk || []).length === 1,
      JSON.stringify(r.body?.tukar_masuk));

    /* Sesi yang dibuka setelah permintaan dibuat tidak boleh kemudian dipindah. */
    const sesiSaatMenunggu = await req('/api/absensi-siswa/sesi', {
      method: 'POST', body: { jadwal_id: slotB, tanggal: TODAY }
    });
    ok('guru tujuan dapat membuka sesi presensi saat permintaan masih menunggu',
      sesiSaatMenunggu.status === 200 && !!sesiSaatMenunggu.body?.sesi?.id, sesiSaatMenunggu.body?.error);
    r = await req('/api/tukar-jadwal/putus', { method: 'POST', body: { id: tukarId, aksi: 'terima' } });
    ok('permintaan ditolak bila sesi sudah dibuka sebelum diterima', r.status === 409, r.body?.error);
    if (sesiSaatMenunggu.body?.sesi?.id) {
      const fixture = new Database(DB);
      fixture.transaction(() => {
        fixture.prepare('DELETE FROM absensi_pencatat WHERE sesi_id=?').run(Number(sesiSaatMenunggu.body.sesi.id));
        fixture.prepare('DELETE FROM absensi_siswa WHERE sesi_id=?').run(Number(sesiSaatMenunggu.body.sesi.id));
        fixture.prepare('DELETE FROM absensi_sesi WHERE id=?').run(Number(sesiSaatMenunggu.body.sesi.id));
      })();
      fixture.close();
    }

    /* TOLAK dulu → jadwal tetap milik guru A */
    r = await req('/api/tukar-jadwal/putus', { method: 'POST', body: { id: tukarId, aksi: 'tolak' } });
    ok('guru tujuan dapat menolak permintaan', r.status === 200 && r.body.status === 'ditolak', JSON.stringify(r.body).slice(0, 160));
    r = await req('/api/tukar-jadwal/putus', { method: 'POST', body: { id: tukarId, aksi: 'terima' } });
    ok('permintaan yang sudah diputus tidak dapat diproses ulang', r.status === 409);

    await login('gurua', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    ok('setelah DITOLAK, sesi tetap milik guru asli',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotA) && !j.tukar), JSON.stringify((r.body.jadwal || []).map(j => j.id)));

    /* ajukan ulang lalu TERIMA */
    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, ke_guru: gB, alasan: 'dinas luar' } });
    ok('pengajuan ulang setelah ditolak diterima', r.status === 200, r.body?.error);
    const tukarId2 = r.body.id;

    await login('gurub', 'guru123');
    r = await req('/api/tukar-jadwal/putus', { method: 'POST', body: { id: tukarId2, aksi: 'batal' } });
    ok('guru tujuan tidak boleh MEMBATALKAN permintaan orang lain', r.status === 403, r.body?.error);
    r = await req('/api/tukar-jadwal/putus', { method: 'POST', body: { id: tukarId2, aksi: 'terima' } });
    ok('guru tujuan dapat MENERIMA permintaan', r.status === 200 && r.body.status === 'diterima', JSON.stringify(r.body).slice(0, 160));

    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    const slotBView = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotA));
    ok('sesi masuk ke menu check-in guru pengganti', !!slotBView, JSON.stringify((r.body.jadwal || []).map(j => j.id)));
    ok('slot ditandai sebagai sesi pengganti (tukar)', !!slotBView?.tukar && Number(slotBView.tukar.ke_guru) === Number(gB),
      JSON.stringify(slotBView?.tukar));
    ok('guru pengganti dapat check-in (tombol aktif/hak penuh)', !!slotBView && slotBView.milik_saya === true);
    ok('mapel slot pertama berubah ke mapel tujuan', Number(slotBView?.mapel_id) === Number(mB)
      && slotBView?.mapel_nama === 'Mapel B', JSON.stringify({ id: slotBView?.mapel_id, nama: slotBView?.mapel_nama }));
    ok('pertukaran mencakup seluruh jam mapel berurutan', Number(slotBView?.jumlah_jam) === 2
      || (slotBView?.jadwal_ids || slotBView?.group_ids || []).length === 2,
    JSON.stringify({ jam: slotBView?.jumlah_jam, ids: slotBView?.jadwal_ids || slotBView?.group_ids }));

    r = await req(`/api/absensi-siswa?tanggal=${TODAY}`);
    ok('Absensi Siswa per Mapel memperlihatkan sesi pengganti ke guru B',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotA) && Number(j.guru_efektif_id) === Number(gB)),
      JSON.stringify((r.body.jadwal || []).map(j => ({ id: j.id, g: j.guru_efektif_id }))));
    ok('Absensi Siswa menggunakan mapel tujuan pada slot pertama',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotA) && Number(j.mapel_id) === Number(mB)),
      JSON.stringify((r.body.jadwal || []).map(j => ({ id: j.id, m: j.mapel_id }))));

    await login('gurua', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    ok('guru asli TIDAK lagi melihat sesi yang sudah ditukar',
      !(r.body.jadwal || []).some(j => Number(j.id) === Number(slotA)), JSON.stringify((r.body.jadwal || []).map(j => j.id)));
    const slotABView = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotB));
    ok('guru pertama menerima slot kedua dengan mapel asalnya', !!slotABView
      && Number(slotABView.guru_efektif_id) === Number(gA) && Number(slotABView.mapel_id) === Number(mA),
    JSON.stringify(slotABView && { guru: slotABView.guru_efektif_id, mapel: slotABView.mapel_id }));
    ok('kedua jam slot tujuan juga berpindah dua arah',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotB2) && Number(j.mapel_id) === Number(mA)
        && Number(j.guru_efektif_id) === Number(gA)),
      JSON.stringify((r.body.jadwal || []).map(j => ({ id: j.id, guru: j.guru_efektif_id, mapel: j.mapel_id }))));
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, status: 'hadir' } });
    ok('guru asli tidak dapat check-in sesi hasil tukar', r.status === 403, r.body?.error);

    /* temporer: pekan berikutnya kembali normal */
    await login('admin', 'admin123');
    r = await req('/api/jadwal');
    const slotDb = (r.body.rows || []).find(x => Number(x.id) === Number(slotA));
    ok('jadwal asli tidak berubah (guru A tetap pemilik slot)', Number(slotDb?.guru_id) === Number(gA), JSON.stringify(slotDb && { g: slotDb.guru_id }));

    await login('gurua', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${NEXT_WEEK}`);
    ok('pekan berikutnya jadwal kembali ke guru asli (temporer 1 hari)',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotA) && !j.tukar),
      JSON.stringify((r.body.jadwal || []).map(j => ({ id: j.id, tukar: !!j.tukar }))));

    /* guru B check-in sesi pengganti */
    await login('gurub', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, status: 'hadir' } });
    ok('check-in sesi pengganti tercatat atas nama guru B', r.status === 200, r.body?.error);
    await login('admin', 'admin123');
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}&guru=${gB}&mapel=${mB}`);
    ok('rekap menghitung dua jam mapel sebagai satu kehadiran per hari',
      r.status === 200 && (r.body.rows || []).length === 1 && (r.body.rows[0].jadwal_ids || []).length === 2,
      JSON.stringify((r.body.rows || []).map(x => ({ mapel: x.mapel_id, slots: x.jadwal_ids, status: x.status }))));

    /* setelah ada absensi, tukar baru ditolak */
    await login('gurub', 'guru123');
    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, ke_guru: gA } });
    ok('sesi yang sudah diabsen tidak dapat ditukar lagi', r.status === 409 || r.status === 403, r.body?.error);

    /* RBAC: pengguna tanpa izin absensi_guru tidak boleh mengajukan */
    await login('wali1', 'wali123');
    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotA, tanggal: TODAY, ke_guru: gA } });
    ok('role tanpa izin absensi_guru ditolak (403)', r.status === 403, r.body?.error);
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    await stopServer();
    try { fs.unlinkSync(DB); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(DB + '-wal'); } catch (e) { /* abaikan */ }
    try { fs.unlinkSync(DB + '-shm'); } catch (e) { /* abaikan */ }
    for (const f of [SAAS, SAAS + '-wal', SAAS + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
    console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
