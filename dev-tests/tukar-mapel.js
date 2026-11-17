'use strict';
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), `stt-tukar-mapel-${Date.now()}.sqlite`);
const SAAS = path.join(os.tmpdir(), `stt-tukar-mapel-saas-${Date.now()}.sqlite`);
const PORT = 4850 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '', KODE = '', server = null, pass = 0, fail = 0;
const fails = [];
const ok = (name, condition, extra) => {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function req(url, options = {}) {
  const response = await fetch(BASE + url, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
  if (cookies.length) cookie = cookies.map(x => x.split(';')[0]).join('; ');
  const body = (response.headers.get('content-type') || '').includes('json')
    ? await response.json().catch(() => null) : await response.text();
  return { status: response.status, body };
}
const login = async (username, password) => {
  cookie = '';
  return req('/api/login', { method: 'POST', body: { username, password, kode: KODE } });
};
const pad = n => String(n).padStart(2, '0');
const formatDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date, amount) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return formatDate(d);
};
const weekKey = date => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
async function start() {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', data => process.stderr.write('[srv] ' + data));
  await new Promise(resolve => setTimeout(resolve, 2300));
}
async function stop() {
  if (!server) return;
  server.kill('SIGTERM');
  server = null;
  await new Promise(resolve => setTimeout(resolve, 500));
}

(async () => {
  await start();
  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows || [])[0]?.kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie);

    const now = new Date();
    const today = formatDate(now);
    let sourceDate = '', targetDate = '';
    for (let sourceOffset = 1; sourceOffset <= 6 && !targetDate; sourceOffset++) {
      const sourceTry = addDays(today, sourceOffset);
      for (let targetOffset = sourceOffset + 1; targetOffset <= 7; targetOffset++) {
        const targetTry = addDays(today, targetOffset);
        if (weekKey(sourceTry) === weekKey(targetTry)) {
          sourceDate = sourceTry; targetDate = targetTry; break;
        }
      }
    }
    if (!targetDate) throw new Error('Tidak menemukan dua hari mendatang dalam rentang uji.');
    const sourceDay = new Date(`${sourceDate}T12:00:00`).getDay();
    const targetDay = new Date(`${targetDate}T12:00:00`).getDay();
    const kelas = (await req('/api/jadwal')).body.kelas || [];
    const guruResult = await req('/api/users/save', {
      method: 'POST',
      body: { nama: 'Guru Tukar Mapel', username: 'gurumapelswap', password: 'guru123', role: 'guru_umum', roles: ['guru'] }
    });
    const guruId = Number(guruResult.body?.id) || 0;
    const mapelA = await req('/api/mapel/save', {
      method: 'POST', body: { nama: 'Matematika Uji', kode: 'MPSW1', guru_ids: [guruId] }
    });
    const mapelB = await req('/api/mapel/save', {
      method: 'POST', body: { nama: 'Administrasi Pajak Uji', kode: 'MPSW2', guru_ids: [guruId] }
    });
    const mapelAId = Number(mapelA.body?.id) || 0;
    const mapelBId = Number(mapelB.body?.id) || 0;
    const sesi = [
      { label: 'Jam ke-1', mulai: '08:00', selesai: '08:40', istirahat: 0 },
      { label: 'Jam ke-2', mulai: '08:45', selesai: '09:25', istirahat: 0 },
      { label: 'Jam ke-3', mulai: '09:30', selesai: '10:10', istirahat: 0 },
      { label: 'Jam ke-4', mulai: '10:15', selesai: '10:55', istirahat: 0 }
    ];
    let r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [sourceDay, targetDay], max_jam: 4, sesi, max_mapel_jam: 4, max_guru_jam: 4,
        absensi: { buka_menit: 30, tutup_menit: 30, jurnal_min: 5, foto_wajib: 0, foto_hari: 30,
          siswa_aktif: 1, siswa_tutup_menit: 30 },
        wa: { aktif: 0, jam: '15:00' }
      }
    });
    ok('pengaturan hari dan sesi uji disimpan', r.status === 200, r.body?.error);
    const roomId = Number(kelas[0]?.id) || 0;
    const saveSlot = async (hari, mapelId, sesiNo) => req('/api/jadwal/slot', {
      method: 'POST',
      body: { hari, sesi: sesiNo, mapel_id: mapelId, guru_id: guruId, kelas_ids: [roomId], abaikan: 1 }
    });
    const slotA = await saveSlot(sourceDay, mapelAId, 1);
    const slotB = await saveSlot(targetDay, mapelBId, 1);
    ok('dua mapel berbeda dijadwalkan untuk guru yang sama', !!guruId && !!roomId
      && slotA.status === 200 && slotB.status === 200, slotA.body?.error || slotB.body?.error);

    await login('gurumapelswap', 'guru123');
    r = await req(`/api/tukar-mapel/kandidat?jadwal_id=${slotA.body.id}&tanggal=${sourceDate}`);
    const targetCandidate = (r.body?.sementara || []).find(x => Number(x.jadwal_id) === Number(slotB.body.id));
    ok('daftar kandidat memuat mapel tujuan beserta hari dan jam', r.status === 200 && !!targetCandidate
      && targetCandidate.hari_label && targetCandidate.jam, JSON.stringify(r.body?.sementara));

    r = await req('/api/tukar-mapel', {
      method: 'POST',
      body: { mode: 'sementara', jadwal_id: slotA.body.id, pasangan_jadwal_id: slotB.body.id, tanggal: sourceDate }
    });
    ok('tukar sementara tersimpan untuk dua tanggal', r.status === 200 && r.body.mode === 'sementara', r.body?.error);
    const absSource = await req(`/api/absensi-guru?tanggal=${sourceDate}`);
    const absTarget = await req(`/api/absensi-guru?tanggal=${targetDate}`);
    const sourceChanged = (absSource.body?.jadwal || []).find(x => Number(x.id) === Number(slotA.body.id));
    const targetChanged = (absTarget.body?.jadwal || []).find(x => Number(x.id) === Number(slotB.body.id));
    ok('mapel berubah di Absensi Guru pada kedua tanggal tukar',
      Number(sourceChanged?.mapel_id) === mapelBId && Number(targetChanged?.mapel_id) === mapelAId,
      JSON.stringify({ source: sourceChanged?.mapel_id, target: targetChanged?.mapel_id }));
    const nextWeek = addDays(sourceDate, 7);
    const absNextWeek = await req(`/api/absensi-guru?tanggal=${nextWeek}`);
    const originalNextWeek = (absNextWeek.body?.jadwal || []).find(x => Number(x.id) === Number(slotA.body.id));
    ok('jadwal pekan berikutnya kembali seperti semula',
      Number(originalNextWeek?.mapel_id) === mapelAId, String(originalNextWeek?.mapel_id));

    const Database = require('better-sqlite3');
    const db = new Database(DB);
    db.prepare("UPDATE jadwal_tukar SET status='batal' WHERE jenis='mapel'").run();
    db.close();
    r = await req('/api/tukar-mapel', {
      method: 'POST',
      body: { mode: 'tetap', jadwal_id: slotA.body.id, pasangan_jadwal_id: slotB.body.id, tanggal: sourceDate }
    });
    ok('tukar tetap mengubah jadwal rutin', r.status === 200 && r.body.mode === 'tetap', r.body?.error);
    const jadwal = await req('/api/jadwal');
    const rowA = (jadwal.body?.rows || []).find(x => Number(x.id) === Number(slotA.body.id));
    const rowB = (jadwal.body?.rows || []).find(x => Number(x.id) === Number(slotB.body.id));
    ok('menu Jadwal/Matriks menampilkan mapel yang sudah ditukar tetap',
      Number(rowA?.mapel_id) === mapelBId && Number(rowB?.mapel_id) === mapelAId,
      JSON.stringify({ a: rowA?.mapel_id, b: rowB?.mapel_id }));
    const historicDate = addDays(sourceDate, -7);
    const history = await req(`/api/rekap/absensi-guru?periode=custom&dari=${historicDate}&sampai=${historicDate}&guru=${guruId}`);
    const historic = (history.body?.rows || []).find(x => Number(x.jadwal_id) === Number(slotA.body.id));
    ok('rekap tanggal sebelum tukar tetap mempertahankan mapel sebelumnya',
      Number(historic?.mapel_id) === mapelAId, JSON.stringify(historic && { mapel: historic.mapel_id, status: historic.status }));

    await login('admin', 'admin123');
    r = await req('/api/tukar-mapel', {
      method: 'POST',
      body: { mode: 'tetap', jadwal_id: slotA.body.id, pasangan_jadwal_id: slotB.body.id, tanggal: sourceDate }
    });
    ok('guru lain tidak dapat menukar mapel milik guru', r.status === 403, r.body?.error);
  } catch (error) {
    fail++;
    fails.push(`exception: ${error.message}`);
    console.error(error);
  } finally {
    await stop();
    for (const file of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) {
      try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
    }
    console.log(`\n=== HASIL TUKAR MAPEL: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) fails.forEach(item => console.log(' - ' + item));
    process.exit(fail ? 1 : 0);
  }
})();
