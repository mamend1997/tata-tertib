'use strict';

process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const DB = path.join(os.tmpdir(), `stt-room-${Date.now()}.sqlite`);
const SAAS = path.join(os.tmpdir(), `stt-room-saas-${Date.now()}.sqlite`);
const PORT = 6300 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let pass = 0;
let fail = 0;

function ok(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(route, opts = {}) {
  const response = await fetch(BASE + route, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    body: type.includes('json') ? await response.json() : await response.text()
  };
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.stderr.on('data', data => process.stderr.write('[srv] ' + data));
  try {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const school = await req('/api/public/sekolah');
    const kode = school.body?.rows?.[0]?.kode;
    const login = await req('/api/login', {
      method: 'POST', body: { kode, username: 'admin', password: 'admin123' }
    });
    ok('login admin', login.status === 200, JSON.stringify(login.body));
    if (login.status !== 200) throw new Error('admin login failed');

    const jadwal = await req('/api/jadwal');
    const classes = jadwal.body?.kelas || [];
    const day = (jadwal.body?.config?.hari || []).find(n => Number(n) !== 0);
    const session = (jadwal.body?.config?.sesi || []).find(s => !s.istirahat)?.idx;
    ok('data kelas dan sesi tersedia', classes.length >= 2 && Number.isInteger(day) && !!session);
    if (classes.length < 2 || !session) throw new Error('schedule fixtures unavailable');

    const stamp = String(Date.now()).slice(-6);
    const teacherIds = [];
    for (let i = 1; i <= 2; i++) {
      await req('/api/users/save', {
        method: 'POST',
        body: { nama: `Guru Ruang ${i}`, username: `gruang${stamp}${i}`, password: 'guru12345', role: 'guru' }
      });
      const users = await req('/api/users');
      teacherIds.push(Number((users.body.rows || []).find(u => u.username === `gruang${stamp}${i}`)?.id));
    }
    ok('guru uji tersedia', teacherIds.every(Boolean));

    const ruangWajib = await req('/api/jadwal/ai/ruang', {
      method: 'POST', body: { nama: `Lab Komputer ${stamp}`, jenis: 'lab', kapasitas: 36, aktif: 1 }
    });
    const ruangUmum = await req('/api/jadwal/ai/ruang', {
      method: 'POST', body: { nama: `Ruang Reguler ${stamp}`, jenis: 'kelas', kapasitas: 36, aktif: 1 }
    });
    const labId = Number(ruangWajib.body?.id);
    ok('master ruangan tersimpan', ruangWajib.status === 200 && ruangUmum.status === 200 && labId > 0);

    const mapelA = await req('/api/mapel/save', {
      method: 'POST',
      body: { kode: `RA${stamp}`, nama: `Praktikum ${stamp}`, guru_ids: [teacherIds[0]], ruang_id: labId }
    });
    const mapelB = await req('/api/mapel/save', {
      method: 'POST',
      body: { kode: `RB${stamp}`, nama: `Teori ${stamp}`, guru_ids: [teacherIds[1]] }
    });
    const mapelList = await req('/api/mapel');
    const wajibTerlihat = (mapelList.body.rows || []).find(m => Number(m.id) === Number(mapelA.body?.id));
    ok('mapel menyimpan ruang wajib', mapelA.status === 200 && mapelB.status === 200
      && wajibTerlihat?.ruang_wajib_nama === `Lab Komputer ${stamp}`);

    const first = await req('/api/jadwal/slot', {
      method: 'POST',
      body: {
        ta: jadwal.body.ta, hari: day, sesi: session, mapel_id: mapelA.body.id,
        guru_id: teacherIds[0], kelas_ids: [classes[0].id], ruang: `Ruang Reguler ${stamp}`
      }
    });
    ok('mapel wajib mengunci ruang pada slot', first.status === 200
      && first.body.ruang === `Lab Komputer ${stamp}` && first.body.peringatan?.some(x => /dikunci/.test(x)));

    const second = await req('/api/jadwal/slot', {
      method: 'POST',
      body: {
        ta: jadwal.body.ta, hari: day, sesi: session, mapel_id: mapelB.body.id,
        guru_id: teacherIds[1], kelas_ids: [classes[1].id], ruang: ''
      }
    });
    ok('ruangan kosong dialokasikan otomatis tanpa bentrok', second.status === 200
      && second.body.ruang === `Ruang Reguler ${stamp}`);

    const conflict = await req('/api/jadwal/slot', {
      method: 'POST',
      body: {
        ta: jadwal.body.ta, hari: day, sesi: session, mapel_id: mapelB.body.id,
        guru_id: teacherIds[1], kelas_ids: [classes[1].id], ruang: `Lab Komputer ${stamp}`
      }
    });
    ok('bentrok ruang fisik ditolak sebagai konflik keras', conflict.status === 409
      && conflict.body.konflik?.some(x => x.jenis === 'ruang'));

    console.log(`\n=== HASIL ROOM API: ${pass} lulus, ${fail} gagal ===`);
    if (fail) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
})();
