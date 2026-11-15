'use strict';
/* Uji ronde 24 (tata-tertib) — API:
   1. PENGUNCIAN WAKTU (time-locking): setelah jam pelajaran selesai seluruh aksi
      absensi terkunci (check-in, presensi siswa, jurnal, tukar jadwal) — di server.
      Toleransi penutupan (absensi_toleransi_tutup) dapat melonggarkan.
   2. Presensi publik: audit trail "diwakili/diisi oleh" + batas 1x isi per siswa.
   3. Panel guru: presensi disimpan atas nama akun yang login (tanpa nama pencatat).
   4. Navigasi bawah per role: default Guru Mapel = Input Kejadian · Absensi Guru ·
      Buku Penghubung, dapat diubah Administrator, RBAC dijaga.
   Jalankan: node dev-tests/round24.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-r24-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r24-saas-' + Date.now() + '.sqlite');
const PORT = 4900 + Math.floor(Math.random() * 120);
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
const cur = wib.getHours() * 60 + wib.getMinutes();
const hhmm = (m) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
/* sesi 1 = SUDAH BERAKHIR 30 menit lalu · sesi 2 = sedang berlangsung */
const base = Math.max(60, Math.min(cur, 1440 - 200));
const SESI_LALU = { mulai: hhmm(base - 90), selesai: hhmm(base - 30) };
const SESI_KINI = { mulai: hhmm(base - 10), selesai: hhmm(base + 40) };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2400));

  const cfgBody = (extra = {}) => ({
    hari: [HARI], max_jam: 8,
    sesi: extra.sesi || [
      { label: 'Jam ke-1', mulai: SESI_LALU.mulai, selesai: SESI_LALU.selesai, istirahat: 0 },
      { label: 'Jam ke-2', mulai: SESI_KINI.mulai, selesai: SESI_KINI.selesai, istirahat: 0 }
    ],
    max_mapel_jam: 2, max_guru_jam: 8,
    absensi: {
      buka_menit: 15, toleransi_tutup: extra.toleransi === undefined ? 0 : extra.toleransi,
      jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1,
      auto_alpha: 0
    },
    wa: { aktif: 0, jam: '15:00' }
  });

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    let r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('pengaturan jadwal + kunci ketat disimpan', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/pengaturan');
    ok('toleransi penutupan default 0 (terkunci tepat waktu)', Number(r.body.absensi.toleransi_tutup) === 0,
      JSON.stringify(r.body.absensi));

    /* akun guru (role guru → punya absensi_guru.write) */
    const mk = async (nama, username) => (await req('/api/users/save', {
      method: 'POST', body: { nama, username, password: 'guru123', role: 'guru_umum', roles: ['guru'] }
    })).body.id;
    const gA = await mk('Guru Uji A', 'gurua');
    const gB = await mk('Guru Uji B', 'gurub');
    ok('akun guru uji dibuat', !!gA && !!gB);

    const siswa = (await req('/api/siswa?limit=10')).body.rows || [];
    ok('data siswa contoh tersedia', siswa.length >= 4, String(siswa.length));
    const kelas1 = siswa[0].kelas_id;
    const kelas2 = (siswa.find(s => s.kelas_id !== kelas1) || {}).kelas_id || kelas1;
    const s1 = siswa.find(s => s.kelas_id === kelas1);
    const s2 = siswa.filter(s => s.kelas_id === kelas1 && s.id !== s1.id)[0];

    const mapel = async (nama, kode, guruId) => (await req('/api/mapel/save', { method: 'POST', body: { nama, kode, guru_ids: [guruId] } })).body.id;
    const mA = await mapel('Mapel A', 'MPA', gA);
    const mB = await mapel('Mapel B', 'MPB', gA);
    const mC = await mapel('Mapel C', 'MPC', gB);

    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mA, guru_id: gA, kelas_ids: [kelas1], abaikan: 1 } });
    ok('slot sesi 1 (sudah berakhir) dibuat', r.status === 200, r.body?.error);
    const slotLalu = r.body.id;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 2, mapel_id: mB, guru_id: gA, kelas_ids: [kelas1], abaikan: 1 } });
    ok('slot sesi 2 (sedang berlangsung) dibuat', r.status === 200, r.body?.error);
    const slotKini = r.body.id;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 2, mapel_id: mC, guru_id: gB, kelas_ids: [kelas2], abaikan: 1 } });
    ok('slot guru pengganti (kelas lain) dibuat', r.status === 200, r.body?.error);

    /* ================= 1. PENGUNCIAN WAKTU ================= */
    console.log('\n== 1. PENGUNCIAN WAKTU (TIME-LOCKING) ==');
    await login('gurua', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    const jLalu = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotLalu)) || {};
    const jKini = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotKini)) || {};
    ok('sesi yang sudah berakhir ditandai terkunci', jLalu.window?.terkunci === true, JSON.stringify(jLalu.window));
    ok('sesi yang sudah berakhir: check-in nonaktif', jLalu.bisa_checkin === false);
    ok('sesi yang sudah berakhir: tukar jadwal nonaktif', jLalu.bisa_tukar === false);
    ok('keterangan penutupan jelas (DITUTUP)', /DITUTUP|berakhir/i.test(jLalu.window?.alasan || ''), jLalu.window?.alasan);
    ok('sesi yang sedang berlangsung tetap aktif', jKini.bisa_checkin === true && jKini.bisa_tukar === true,
      JSON.stringify({ c: jKini.bisa_checkin, t: jKini.bisa_tukar, w: jKini.window }));

    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotLalu, tanggal: TODAY, status: 'hadir' } });
    ok('server menolak check-in sesi yang sudah berakhir', r.status === 403, r.body?.error);
    r = await req('/api/tukar-jadwal', { method: 'POST', body: { jadwal_id: slotLalu, tanggal: TODAY, ke_guru: gB } });
    ok('server menolak tukar jadwal sesi yang sudah berakhir', r.status === 403 && /berakhir/i.test(r.body.error || ''), r.body?.error);

    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotLalu, tanggal: TODAY } });
    ok('server menolak membuat sesi presensi setelah jam berakhir', r.status === 403 && /DITUTUP/i.test(r.body.error || ''), r.body?.error);

    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY, status: 'hadir' } });
    ok('check-in sesi yang masih berjalan diterima', r.status === 200, r.body?.error);
    r = await req('/api/absensi-guru/jurnal', { method: 'POST', body: { jadwal_id: slotLalu, tanggal: TODAY, materi: 'percobaan jurnal sesi lampau' } });
    ok('jurnal sesi lampau ditolak', r.status === 400 || r.status === 403, r.body?.error);

    /* sesi presensi siswa: dibuat saat masih berjalan lalu jadwalnya dipindah ke sesi 1 */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY } });
    ok('sesi presensi dibuat saat jam berlangsung', r.status === 200, r.body?.error);
    const sesiKini = r.body.sesi;
    const token = r.body.sesi.token;
    r = await req('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: sesiKini.id, items: [{ siswa_id: s1.id, status: 'H' }] } });
    ok('presensi siswa dapat disimpan saat jam berlangsung', r.status === 200, r.body?.error);
    /* SIMULASI JAM BERAKHIR: jam sesi 2 digeser ke masa lalu oleh admin →
       presensi yang sudah ada harus terkunci dan tidak dapat diubah. */
    await login('admin', 'admin123');
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({
        sesi: [
          { label: 'Jam ke-1', mulai: hhmm(base - 260), selesai: hhmm(base - 200), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(base - 190), selesai: hhmm(base - 130), istirahat: 0 }
        ]
      })
    });
    ok('jam sesi 2 digeser ke masa lalu (simulasi)', r.status === 200, r.body?.error);
    await login('gurua', 'guru123');
    r = await req('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: sesiKini.id, items: [{ siswa_id: s1.id, status: 'A' }] } });
    ok('perubahan presensi setelah jam berakhir DITOLAK', r.status === 403 && /ditutup|terkunci/i.test(r.body.error || ''), r.body?.error);
    r = await req(`/api/absensi-siswa/sesi?jadwal_id=${slotKini}&tanggal=${TODAY}`);
    ok('detail sesi melaporkan window.terkunci', r.status === 200 && r.body.window?.terkunci === true, JSON.stringify(r.body?.window));
    ok('detail sesi memuat keterangan penutupan', /DITUTUP/i.test(r.body.window?.keterangan || ''), r.body.window?.keterangan);
    /* kembalikan pengaturan jam seperti semula */
    await login('admin', 'admin123');
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('pengaturan jam dikembalikan', r.status === 200, r.body?.error);

    /* toleransi dapat melonggarkan (30 menit setelah selesai) */
    await login('admin', 'admin123');
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ toleransi: 60 }) });
    ok('toleransi penutupan 60 menit disimpan', r.status === 200 && Number((await req('/api/jadwal/pengaturan')).body.absensi.toleransi_tutup) === 60, r.body?.error);
    await login('gurua', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    ok('dengan toleransi, sesi yang baru berakhir 30 menit kembali terbuka',
      (r.body.jadwal || []).some(j => Number(j.id) === Number(slotLalu) && j.window?.aktif === true),
      JSON.stringify((r.body.jadwal || []).map(j => ({ id: j.id, a: j.window?.aktif }))));
    await login('admin', 'admin123');
    await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ toleransi: 0 }) });

    /* ================= 2. PRESENSI PUBLIK: AUDIT + 1x ISI ================= */
    console.log('\n== 2. PRESENSI PUBLIK (AUDIT TRAIL & BATAS 1x) ==');
    /* sesi presensi publik untuk slot yang sedang berlangsung (sesi 2) */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotLalu, tanggal: TODAY } });
    /* slot sesi 1 sudah berakhir → dibuat sesi harus ditolak; pakai slotKini */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY } });
    ok('sesi publik tersedia', r.status === 200, r.body?.error);
    const tokPub = r.body.sesi.token;

    cookie = '';
    r = await req(`/api/public/presensi/${tokPub}`);
    ok('halaman publik dapat dibuka tanpa login', r.status === 200, r.body?.error);
    ok('belum ada pencatat (pencatat_info null)', !r.body.pencatat_info);
    const nama1 = s1.nama, nama2 = s2 ? s2.nama : '';
    r = await req(`/api/public/presensi/${tokPub}`, {
      method: 'POST', body: { pencatat: nama1, items: [{ siswa_id: s1.id, status: 'H' }, { siswa_id: s2.id, status: 'S' }] }
    });
    ok('pengisian publik pertama tersimpan', r.status === 200, r.body?.error);
    ok('respons memuat identitas pengisi', r.body?.pencatat_info?.nama === nama1, JSON.stringify(r.body?.pencatat_info));

    r = await req(`/api/public/presensi/${tokPub}`);
    ok('rekap menampilkan "diwakili/diisi oleh"', r.body?.pencatat_info?.nama === nama1
      && !!r.body?.pencatat_info?.kelas, JSON.stringify(r.body?.pencatat_info));

    r = await req(`/api/public/presensi/${tokPub}`, {
      method: 'POST', body: { pencatat: nama1, items: [{ siswa_id: s1.id, status: 'A' }] }
    });
    ok('siswa yang sama TIDAK boleh mengisi 2x', r.status === 409 && /sudah pernah Anda isi/i.test(r.body.error || ''), r.body?.error);

    r = await req(`/api/public/presensi/${tokPub}`, {
      method: 'POST', body: { pencatat: nama2, items: [{ siswa_id: s1.id, status: 'H' }] }
    });
    ok('siswa lain masih boleh mengisi (per siswa, bukan per sesi)', r.status === 200, r.body?.error);
    r = await req(`/api/public/presensi/${tokPub}`);
    ok('pencatat terbaru tercatat pada rekap', r.body?.pencatat_info?.nama === nama2, JSON.stringify(r.body?.pencatat_info));

    /* presensi oleh guru: dicatat atas nama akun yang login (tanpa nama pencatat) */
    await login('gurua', 'guru123');
    r = await req('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: sesiKini.id, items: [{ siswa_id: s1.id, status: 'I', keterangan: 'izin keluarga' }] } });
    ok('guru menyimpan presensi tanpa mengirim nama pencatat', r.status === 200, r.body?.error);
    r = await req(`/api/absensi-siswa/sesi?jadwal_id=${slotKini}&tanggal=${TODAY}`);
    ok('pencatat versi siswa tetap tercatat sebagai audit trail', r.body?.pencatat_info?.nama === nama2, JSON.stringify(r.body?.pencatat_info));

    /* ================= 3. NAVIGASI BAWAH PER ROLE ================= */
    console.log('\n== 3. NAVIGASI BAWAH PER ROLE ==');
    await login('admin', 'admin123');
    r = await req('/api/nav-mobile');
    ok('admin dapat membuka pengaturan navigasi bawah', r.status === 200 && Array.isArray(r.body.roles), r.body?.error);
    ok('default Guru Mapel: Input Kejadian · Absensi Guru · Buku Penghubung',
      JSON.stringify(r.body.config.guru) === JSON.stringify(['kejadian', 'absensi_guru', 'jurnal']),
      JSON.stringify(r.body.config.guru));
    ok('batas maksimal tombol = 5', r.body.max === 5);

    await login('gurua', 'guru123');
    r = await req('/api/bootstrap');
    const bn = r.body.bottom_nav || [];
    ok('bootstrap guru mengirim 3 tombol navigasi bawah', bn.length === 3, JSON.stringify(bn));
    ok('urutan tombol sesuai standar (kejadian → absensi_guru → jurnal)',
      bn.map(x => x.key).join(',') === 'kejadian,absensi_guru,jurnal', JSON.stringify(bn.map(x => x.key)));
    ok('tombol memuat label & ikon', bn.every(x => x.label && x.icon), JSON.stringify(bn));
    ok('role guru tidak boleh mengubah pengaturan navigasi', (r.body.perms?.nav_mobile?.write || 0) === 0);
    r = await req('/api/nav-mobile', { method: 'POST', body: { role: 'guru', keys: ['dashboard'] } });
    ok('POST /api/nav-mobile ditolak untuk guru (403)', r.status === 403, r.body?.error);

    await login('admin', 'admin123');
    /* akun uji memakai role utama guru_umum + role tambahan guru → role UTAMA menang */
    r = await req('/api/nav-mobile', { method: 'POST', body: { role: 'guru_umum', keys: ['absensi_guru', 'kejadian'] } });
    ok('admin dapat mengubah susunan navigasi guru mapel', r.status === 200, r.body?.error);
    await login('gurua', 'guru123');
    r = await req('/api/bootstrap');
    ok('susunan baru langsung dipakai bootstrap guru',
      (r.body.bottom_nav || []).map(x => x.key).join(',') === 'absensi_guru,kejadian', JSON.stringify((r.body.bottom_nav || []).map(x => x.key)));
    await login('admin', 'admin123');
    await req('/api/nav-mobile/reset', { method: 'POST', body: { role: 'guru_umum' } });

    await login('admin', 'admin123');
    r = await req('/api/nav-mobile', { method: 'POST', body: { role: 'guru', keys: ['tidak-ada-menu'] } });
    ok('menu tidak dikenal ditolak', r.status === 400, r.body?.error);
    r = await req('/api/nav-mobile', { method: 'POST', body: { role: 'guru', keys: ['dashboard', 'kejadian', 'jadwal', 'laporan', 'siswa', 'kelas'] } });
    ok('lebih dari 5 tombol ditolak', r.status === 400, r.body?.error);
    r = await req('/api/nav-mobile', { method: 'POST', body: { role: 'guru', keys: [] } });
    ok('daftar kosong ditolak', r.status === 400, r.body?.error);
    r = await req('/api/nav-mobile/reset', { method: 'POST', body: { role: 'guru' } });
    ok('reset mengembalikan susunan bawaan',
      r.status === 200 && JSON.stringify(r.body.config.guru) === JSON.stringify(['kejadian', 'absensi_guru', 'jurnal']),
      JSON.stringify(r.body.config?.guru));
    r = await req('/api/nav-mobile', { method: 'POST', body: { role: 'kepala_sekolah', keys: ['dashboard', 'laporan'] } });
    ok('role lain dapat diatur terpisah', r.status === 200, r.body?.error);
    await req('/api/nav-mobile/reset', { method: 'POST', body: { role: 'kepala_sekolah' } });
    r = await req('/api/audit?limit=5');
    ok('perubahan navigasi tercatat di audit', JSON.stringify(r.body || {}).includes('Navigasi bawah'), JSON.stringify(r.body).slice(0, 160));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    for (const f of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
    console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
