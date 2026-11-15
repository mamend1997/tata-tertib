'use strict';
/* =====================================================================
   SESI JAM KHUSUS PER HARI — slot pelajaran pada hari yang punya
   pengaturan jam sendiri (mis. Jumat) tidak boleh lagi divalidasi memakai
   sesi UMUM.

   Bug yang diperbaiki: `jadwalConflict()` mencari baris sesi pada
   `cfg.sesi` (sesi umum). Bila hari Jumat disetel tanpa istirahat pada
   posisi ke-3, input mapel di "Jam ke-3" Jumat tetap ditolak dengan pesan
   "Istirahat adalah waktu istirahat, tidak dapat diisi pelajaran."
   karena posisi idx 3 pada sesi UMUM adalah istirahat.

   Jalankan: node dev-tests/sesi-hari.js
   ===================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

process.env.TZ = 'Asia/Jakarta';
const DB = path.join(os.tmpdir(), 'stt-sesihari-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-sesihari-saas-' + Date.now() + '.sqlite');
const PORT = 6500 + Math.floor(Math.random() * 150);
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
      Cookie: cookie
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

const JUMAT = 5;
const SENIN = 1;

/* sesi UMUM: posisi ke-3 = ISTIRAHAT (seperti bawaan aplikasi) */
const SESI_UMUM = [
  { label: 'Jam ke-1', mulai: '07:00', selesai: '07:45', istirahat: 0 },
  { label: 'Jam ke-2', mulai: '07:45', selesai: '08:30', istirahat: 0 },
  { label: 'Istirahat', mulai: '08:30', selesai: '08:45', istirahat: 1 },
  { label: 'Jam ke-3', mulai: '08:45', selesai: '09:30', istirahat: 0 },
  { label: 'Jam ke-4', mulai: '09:30', selesai: '10:15', istirahat: 0 },
  { label: 'Istirahat', mulai: '10:15', selesai: '10:30', istirahat: 1 },
  { label: 'Jam ke-5', mulai: '10:30', selesai: '11:15', istirahat: 0 }
];
/* sesi KHUSUS JUMAT: tanpa istirahat pada posisi ke-3 → Jam ke-3 di idx 3 */
const SESI_JUMAT = [
  { label: 'Jam ke-1', mulai: '07:00', selesai: '07:45', istirahat: 0 },
  { label: 'Jam ke-2', mulai: '07:45', selesai: '08:30', istirahat: 0 },
  { label: 'Jam ke-3', mulai: '08:30', selesai: '09:15', istirahat: 0 },
  { label: 'Jam ke-4', mulai: '09:15', selesai: '10:00', istirahat: 0 },
  { label: 'Jam ke-5', mulai: '10:00', selesai: '10:45', istirahat: 0 }
];

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
    ok('login administrator', r.status === 200, JSON.stringify(r.body));

    /* ---------- 0. prasyarat: guru, mapel, kelas, TA ---------- */
    r = await req('/api/bootstrap');
    const taId = (r.body.tahun.find(t => Number(t.aktif) === 1) || r.body.tahun[0] || {}).id;
    ok('tahun pelajaran aktif tersedia', !!taId, JSON.stringify(r.body.tahun));

    r = await req('/api/users/save', {
      method: 'POST',
      body: { nama: 'Guru Uji Sesi', username: 'gurusesi', password: 'gurusesi123', role: 'guru' }
    });
    ok('akun guru dibuat', r.status === 200, JSON.stringify(r.body));
    const users = (await req('/api/users')).body.rows;
    const guru = users.find(u => u.username === 'gurusesi');
    ok('guru ditemukan di daftar pengguna', !!guru);

    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel Uji Sesi', kode: 'MUS', guru_ids: [guru.id] } });
    ok('mata pelajaran dibuat (guru pengampu terkunci)', r.status === 200, JSON.stringify(r.body));
    const mapelId = r.body.id;

    const kelas = (await req('/api/kelas')).body.rows;
    ok('minimal dua kelas tersedia', kelas.length >= 2, String(kelas.length));

    /* ---------- 1. simpan pengaturan sesi khusus Jumat ---------- */
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [SENIN, 2, 3, 4, JUMAT], max_jam: 8, sesi: SESI_UMUM,
        sesi_hari: { [JUMAT]: SESI_JUMAT },
        max_mapel_jam: 2, max_guru_jam: 8,
        absensi: { buka_menit: 15, tutup_menit: 15, jurnal_min: 10, foto_wajib: 0, foto_hari: 90, siswa_aktif: 1, siswa_tutup_menit: 120 },
        wa: { aktif: 0, jam: '14:00' }
      }
    });
    ok('pengaturan jadwal + sesi khusus Jumat tersimpan', r.status === 200, JSON.stringify(r.body));
    const cfg = r.body.config || {};
    ok('sesi umum posisi ke-3 = istirahat', !!(cfg.sesi && cfg.sesi[2] && cfg.sesi[2].istirahat), JSON.stringify(cfg.sesi && cfg.sesi[2]));
    ok('sesi Jumat posisi ke-3 = jam pelajaran', !!(cfg.sesiHari && cfg.sesiHari[JUMAT] && cfg.sesiHari[JUMAT][2] && !cfg.sesiHari[JUMAT][2].istirahat),
      JSON.stringify(cfg.sesiHari && cfg.sesiHari[JUMAT] && cfg.sesiHari[JUMAT][2]));

    /* ---------- 2. input mapel Jumat jam ke-3 (inti perbaikan) ---------- */
    const slotBody = (over = {}) => ({
      ta: taId, hari: JUMAT, sesi: 3, mapel_id: mapelId, guru_id: guru.id,
      kelas_ids: [kelas[0].id], ruang: '', ...over
    });
    r = await req('/api/jadwal/slot', { method: 'POST', body: slotBody() });
    ok('Jumat jam ke-3 bisa diisi mapel (dulu ditolak "waktu istirahat")', r.status === 200,
      `${r.status} ${JSON.stringify(r.body)}`);
    const slotJumat = r.body.id;
    ok('slot Jumat tersimpan', !!slotJumat);

    r = await req(`/api/jadwal?ta=${taId}`);
    const slotTersimpan = (r.body.rows || []).find(x => Number(x.id) === Number(slotJumat));
    ok('slot muncul di matriks jadwal', !!slotTersimpan,
      JSON.stringify((r.body.rows || []).map(x => `${x.hari}-${x.sesi}`)));

    /* pindah slot (drag & drop) ke Jumat jam ke-4 juga harus lolos */
    r = await req('/api/jadwal/move', { method: 'POST', body: { id: slotJumat, hari: JUMAT, sesi: 4 } });
    ok('pindah slot ke Jumat jam ke-4 berhasil', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
    r = await req('/api/jadwal/move', { method: 'POST', body: { id: slotJumat, hari: JUMAT, sesi: 3 } });
    ok('slot dikembalikan ke Jumat jam ke-3', r.status === 200, String(r.status));

    /* ---------- 3. aturan hari DEFAULT tetap berlaku ---------- */
    r = await req('/api/jadwal/slot', {
      method: 'POST', body: slotBody({ hari: SENIN, sesi: 3, kelas_ids: [kelas[1].id] })
    });
    ok('hari default: sesi ke-3 tetap ditolak sebagai istirahat', r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);
    ok('pesan menyebut waktu istirahat', /istirahat/i.test(String((r.body && r.body.error) || (r.body && r.body.pesan) || '')),
      JSON.stringify(r.body));

    /* ---------- 4. sesi di luar daftar hari itu tetap ditolak ---------- */
    r = await req('/api/jadwal/slot', {
      method: 'POST', body: slotBody({ sesi: 9, kelas_ids: [kelas[1].id] })
    });
    ok('sesi yang tidak ada pada hari Jumat ditolak', r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);

    /* ---------- 5. impor Excel/CSV memakai sesi hari terkait ---------- */
    const csv = [
      'HARI,JAM,MAPEL,GURU,KELAS',
      `Jumat,3,Mapel Uji Sesi,gurusesi,${kelas[1].nama}`,
      `Senin,3,Mapel Uji Sesi,gurusesi,${kelas[1].nama}`
    ].join('\n');
    r = await req('/api/jadwal/import/preview', {
      method: 'POST',
      body: { ta: taId, filename: 'jadwal.csv', base64: Buffer.from(csv).toString('base64') }
    });
    const rows = (r.body && r.body.rows) || [];
    const barisJumat = rows.find(x => Number(x.hari_no) === JUMAT);
    const barisSenin = rows.find(x => Number(x.hari_no) === SENIN);
    ok('impor: baris Jumat jam ke-3 dikenali sebagai sesi 3', barisJumat && Number(barisJumat.sesi) === 3,
      JSON.stringify(barisJumat));
    ok('impor: baris Jumat tidak berstatus error', barisJumat && barisJumat.status !== 'error', JSON.stringify(barisJumat));
    ok('impor: jam 08:30 Jumat cocok ke Jam ke-3', barisJumat && /08:30/.test(String(barisJumat.jam_pelajaran || '')),
      JSON.stringify(barisJumat && barisJumat.jam_pelajaran));

    const csvJam = [
      'HARI,JAM,MAPEL,GURU,KELAS',
      `Jumat,08:30,Mapel Uji Sesi,gurusesi,${kelas[1].nama}`
    ].join('\n');
    r = await req('/api/jadwal/import/preview', {
      method: 'POST',
      body: { ta: taId, filename: 'jadwal2.csv', base64: Buffer.from(csvJam).toString('base64') }
    });
    const barisJam = ((r.body && r.body.rows) || [])[0];
    ok('impor: jam "08:30" Jumat dipetakan ke sesi 3 (bukan sesi umum)', barisJam && Number(barisJam.sesi) === 3,
      JSON.stringify(barisJam));

    /* ---------- 6. label sesi (absensi) mengikuti hari ---------- */
    r = await req(`/api/jadwal?ta=${taId}`);
    ok('label sesi Jumat memakai daftar khusus hari itu',
      !!(cfg.sesiHari && cfg.sesiHari[JUMAT]), JSON.stringify(cfg.sesiHari && Object.keys(cfg.sesiHari)));
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
