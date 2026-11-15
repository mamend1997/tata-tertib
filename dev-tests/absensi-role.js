'use strict';
/* =====================================================================
   CAKUPAN MENU ABSENSI UNTUK PENGAWAS (Wakasek Kesiswaan)

   Bug: role `kesiswaan` (Wakasek Kesiswaan) hanya melihat jadwal miliknya
   sendiri pada menu Absensi Guru Mapel & Absensi Siswa per Mapel, karena
   `lihatSemua` hanya mengenali admin / wakasek_kurikulum / kepala_sekolah.

   Perbaikan: helper `isPengawas()` (admin, wakasek_kurikulum, kepala_sekolah,
   kesiswaan) dipakai ketiga endpoint absensi. Hak MENGELOLA absensi guru
   (check-in/jurnal atas nama guru lain) tetap hanya admin/Wakasek Kurikulum.

   Jalankan: node dev-tests/absensi-role.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

process.env.TZ = 'Asia/Jakarta';
const DB = path.join(os.tmpdir(), 'stt-absrole-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-absrole-saas-' + Date.now() + '.sqlite');
const PORT = 6700 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

async function req(p, opt = {}) {
  const r = await fetch(BASE + p, {
    method: opt.method || 'GET',
    headers: {
      ...(opt.body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: opt.cookie === undefined ? cookie : opt.cookie
    },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || '';
  let body = null;
  try { body = ct.includes('json') ? await r.json() : await r.text(); } catch (e) { body = null; }
  return { status: r.status, body, ct };
}

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const cur = now.getHours() * 60 + now.getMinutes();
const HARI = now.getDay();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 1440) + 1440) % 1440 % 60)}`;

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
    const login = async (u, p) => {
      cookie = '';
      const r = await req('/api/login', { method: 'POST', body: { kode: KODE, username: u, password: p } });
      return r;
    };

    let r = await login('admin', 'admin123');
    ok('login administrator', r.status === 200, JSON.stringify(r.body));

    /* ---------- prasyarat: 2 guru, 2 mapel, 2 kelas, 1 slot masing-masing ---------- */
    r = await req('/api/bootstrap');
    const taId = (r.body.tahun.find(t => Number(t.aktif) === 1) || r.body.tahun[0] || {}).id;
    const mk = async (nama, username, role, extra = {}) => {
      const x = await req('/api/users/save', {
        method: 'POST', body: { nama, username, password: username + '123', role, ...extra }
      });
      return x;
    };
    await mk('Guru Pemilik A', 'guruA', 'guru');
    await mk('Guru Pemilik B', 'guruB', 'guru');
    await mk('Wakasek Kesiswaan Uji', 'wakesis', 'kesiswaan');
    ok('akun uji dibuat (2 guru + wakasek kesiswaan)', true);

    const users = (await req('/api/users')).body.rows;
    const guruA = users.find(u => u.username === 'guruA');
    const guruB = users.find(u => u.username === 'guruB');
    const wakesis = users.find(u => u.username === 'wakesis');
    ok('akun guru & wakasek kesiswaan terbaca', !!(guruA && guruB && wakesis));

    /* izin kesiswaan: lihat & isi absensi (disetel seperti sekolah nyata) */
    r = await req('/api/users');
    const matrix = JSON.parse(JSON.stringify(r.body.perms || {}));
    const perm = matrix.kesiswaan || {};
    for (const feat of ['absensi_guru', 'absensi_siswa', 'rekap_absensi_guru']) {
      perm[feat] = { ...(perm[feat] || {}), view: 1, write: 1 };
    }
    matrix.kesiswaan = perm;
    r = await req('/api/permissions', { method: 'POST', body: { role: 'kesiswaan', perms: perm } });
    ok('matriks izin role kesiswaan disetel (absensi guru & siswa)', r.status === 200, JSON.stringify(r.body && r.body.error));

    const mapel = async (nama, kode, guruId) => (await req('/api/mapel/save', {
      method: 'POST', body: { nama, kode, guru_ids: [guruId] }
    })).body.id;
    const mapelA = await mapel('Mapel Guru A', 'MGA', guruA.id);
    const mapelB = await mapel('Mapel Guru B', 'MGB', guruB.id);
    ok('dua mata pelajaran dibuat', !!(mapelA && mapelB));

    const kelas = (await req('/api/kelas')).body.rows;
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam 1', mulai: hhmm(cur - 20), selesai: hhmm(cur + 20), istirahat: 0 },
          { label: 'Jam 2', mulai: hhmm(cur + 21), selesai: hhmm(cur + 60), istirahat: 0 }
        ],
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 5, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 120 },
        wa: { aktif: 0, jam: '14:00' }
      }
    });
    ok('pengaturan jadwal disimpan', r.status === 200, JSON.stringify(r.body));

    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelA, kelas_ids: [kelas[0].id], abaikan: 1 } });
    const slotA = r.status === 200 ? r.body.id : 0;
    ok('slot guru A dibuat', !!slotA, JSON.stringify(r.body));
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelB, kelas_ids: [kelas[1].id], abaikan: 1 } });
    const slotB = r.status === 200 ? r.body.id : 0;
    ok('slot guru B dibuat', !!slotB, JSON.stringify(r.body));

    /* ---------- 1. GURU BIASA: hanya jadwal sendiri ---------- */
    console.log('\n== 1. GURU BIASA (tetap terbatas) ==');
    await login('guruA', 'guruA123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    ok('guru A: lihat_semua = false', r.body.lihat_semua === false, JSON.stringify(r.body.lihat_semua));
    ok('guru A: hanya 1 slot (miliknya)', (r.body.jadwal || []).length === 1,
      JSON.stringify((r.body.jadwal || []).map(x => x.id)));
    ok('guru A: slot memang miliknya', Number((r.body.jadwal || [])[0]?.id) === Number(slotA));
    r = await req(`/api/absensi-siswa?tanggal=${TODAY}`);
    ok('guru A: absensi siswa hanya slot miliknya', (r.body.jadwal || []).length === 1, String((r.body.jadwal || []).length));
    r = await req(`/api/absensi-guru/jadwal-mengajar?hari=7`);
    ok('guru A: agenda hanya slot miliknya', (r.body.hari || []).flatMap(h => h.slots).every(s => Number(s.guru_efektif_id) === Number(guruA.id)),
      JSON.stringify((r.body.hari || []).flatMap(h => h.slots).map(s => s.guru_efektif_id)));

    /* ---------- 2. WAKASEK KESISWAAN: seluruh jadwal ---------- */
    console.log('\n== 2. WAKASEK KESISWAAN MELIHAT SELURUH JADWAL ==');
    r = await login('wakesis', 'wakesis123');
    ok('login wakasek kesiswaan', r.status === 200, JSON.stringify(r.body));
    r = await req('/api/bootstrap');
    ok('peran kesiswaan aktif', (r.body.user.roles || []).includes('kesiswaan'), JSON.stringify(r.body.user.roles));

    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    ok('absensi guru: lihat_semua = true untuk Wakasek Kesiswaan', r.body.lihat_semua === true, JSON.stringify(r.body.lihat_semua));
    const idsGuru = (r.body.jadwal || []).map(x => Number(x.id));
    ok('absensi guru: SEMUA slot tampil (2 slot, dua guru berbeda)',
      idsGuru.includes(Number(slotA)) && idsGuru.includes(Number(slotB)), JSON.stringify(idsGuru));
    ok('absensi guru: daftar guru tersedia untuk filter', (r.body.guru || []).length > 1, String((r.body.guru || []).length));
    ok('absensi guru: rekap seluruh guru ikut', (r.body.rekap && (r.body.rekap.rows || []).length) > 0,
      JSON.stringify(r.body.rekap && (r.body.rekap.rows || []).length));
    const slotMilikOrang = (r.body.jadwal || []).find(x => Number(x.id) === Number(slotB)) || {};
    ok('absensi guru: slot guru lain tidak bisa di-check-in oleh kesiswaan', slotMilikOrang.bisa_checkin === false,
      JSON.stringify(slotMilikOrang.bisa_checkin));

    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotB, tanggal: TODAY, status: 'hadir' } });
    ok('server menolak check-in atas nama guru lain (403)', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);

    r = await req(`/api/absensi-siswa?tanggal=${TODAY}`);
    ok('absensi siswa: lihat_semua = true', r.body.lihat_semua === true, JSON.stringify(r.body.lihat_semua));
    const idsSiswa = (r.body.jadwal || []).map(x => Number(x.id));
    ok('absensi siswa: SEMUA sesi mapel tampil',
      idsSiswa.includes(Number(slotA)) && idsSiswa.includes(Number(slotB)), JSON.stringify(idsSiswa));
    ok('absensi siswa: sesi dapat dikelola pengawas (bisa = true)',
      (r.body.jadwal || []).every(x => x.bisa === true), JSON.stringify((r.body.jadwal || []).map(x => x.bisa)));

    r = await req('/api/absensi-guru/jadwal-mengajar?hari=7');
    const semuaSlotAgenda = (r.body.hari || []).flatMap(h => h.slots);
    ok('agenda: lihat_semua = true', r.body.lihat_semua === true, JSON.stringify(r.body.lihat_semua));
    ok('agenda: slot kedua guru tampil', semuaSlotAgenda.length >= 2, String(semuaSlotAgenda.length));
    const agendaOrangLain = semuaSlotAgenda.find(s => Number(s.jadwal_id) === Number(slotB)) || {};
    ok('agenda: tombol check-in slot guru lain nonaktif', agendaOrangLain.bisa_checkin === false,
      JSON.stringify(agendaOrangLain.bisa_checkin));

    /* sesi presensi untuk mapel guru lain tetap boleh dibuka Wakasek Kesiswaan */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotB, tanggal: TODAY } });
    ok('Wakasek Kesiswaan dapat membuka sesi presensi mapel guru lain', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

    /* ---------- 3. ADMIN / KURIKULUM tetap bisa bertindak atas nama guru ---------- */
    console.log('\n== 3. ADMIN TETAP BISA CHECK-IN ATAS NAMA GURU ==');
    await login('admin', 'admin123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    const slotAdmin = (r.body.jadwal || []).find(x => Number(x.id) === Number(slotB)) || {};
    ok('admin: slot guru lain bisa di-check-in (bisa_checkin = true)', slotAdmin.bisa_checkin === true,
      JSON.stringify(slotAdmin.bisa_checkin));
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotB, tanggal: TODAY, status: 'hadir' } });
    ok('admin: check-in atas nama guru B diterima', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

    /* ---------- 4. kepala sekolah juga pengawas ---------- */
    console.log('\n== 4. KEPALA SEKOLAH ==');
    await req('/api/users/save', { method: 'POST', body: { nama: 'Kepsek Uji', username: 'kepseku', password: 'kepseku123', role: 'kepala_sekolah' } });
    r = await login('kepseku', 'kepseku123');
    ok('login kepala sekolah', r.status === 200, JSON.stringify(r.body));
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    ok('kepala sekolah melihat semua slot', r.body.lihat_semua === true && (r.body.jadwal || []).length >= 2,
      JSON.stringify({ l: r.body.lihat_semua, n: (r.body.jadwal || []).length }));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  }
  try { srv.kill('SIGKILL'); } catch (e) { /* ignore */ }
  console.log(`\n${pass} lulus, ${fail} gagal`);
  if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
  await new Promise(r => setTimeout(r, 200));
  for (const f of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) {
    try { require('fs').unlinkSync(f); } catch (e) { /* ignore */ }
  }
})();
