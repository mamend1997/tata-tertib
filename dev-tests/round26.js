'use strict';
/* Uji ronde 26 — AI TIMETABLE GENERATOR
   1. Konfigurasi & data master (beban mengajar, batasan guru, ruang/lab)
   2. Generate pratinjau (tanpa menulis), aturan (sebar mapel harian, batas guru)
   3. Apply (insert tervalidasi ulang), mode tambah → tidak dobel, mode ganti → bongkar & susun ulang
   4. Sinkron beban dari jadwal, determinisme seed, RBAC guru
   Jalankan: node dev-tests/round26.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-r26-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r26-saas-' + Date.now() + '.sqlite');
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

/** cek tidak ada kelas / guru / ruang dobel pada slot */
function cekUnik(slots) {
  const k = new Set(), g = new Set(), r = new Set();
  for (const s of slots) {
    for (const kid of s.kelas_ids) {
      const key = `${kid}:${s.hari}:${s.sesi}`;
      if (k.has(key)) return 'kelas dobel ' + key;
      k.add(key);
    }
    const gk = `${s.guru_id}:${s.hari}:${s.sesi}`;
    if (g.has(gk)) return 'guru dobel ' + gk;
    g.add(gk);
    if (s.ruang) {
      const rk = `${s.ruang}:${s.hari}:${s.sesi}`;
      if (r.has(rk)) return 'ruang dobel ' + rk;
      r.add(rk);
    }
  }
  return '';
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2300));

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    const users = (await req('/api/users')).body.rows || [];
    const gA = users.find(u => u.username === 'guru');
    const gB = users.find(u => u.username === 'guruumum');
    ok('akun guru uji tersedia', !!gA && !!gB);

    /* ================= 1. KONFIGURASI & DATA MASTER ================= */
    console.log('\n== 1. KONFIGURASI & DATA MASTER ==');
    let r = await req('/api/jadwal/pengaturan', {
      method: 'POST', body: {
        hari: [1, 2, 3, 4, 5], max_jam: 6,
        sesi: [
          { label: 'Jam ke-1', mulai: '07:00', selesai: '07:45', istirahat: 0 },
          { label: 'Jam ke-2', mulai: '07:45', selesai: '08:30', istirahat: 0 },
          { label: 'Jam ke-3', mulai: '08:30', selesai: '09:15', istirahat: 0 },
          { label: 'Jam ke-4', mulai: '09:15', selesai: '10:00', istirahat: 0 },
          { label: 'Jam ke-5', mulai: '10:00', selesai: '10:45', istirahat: 0 },
          { label: 'Jam ke-6', mulai: '10:45', selesai: '11:30', istirahat: 0 }
        ],
        max_mapel_jam: 2, max_guru_jam: 8
      }
    });
    ok('pengaturan jadwal 5 hari × 6 jam disimpan', r.status === 200, r.body?.error);

    /* dua mapel dengan guru pengampu berbeda */
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika AI', kode: 'MTKAI', guru_ids: [gA.id] } });
    const mapelA = r.body.id;
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Bahasa AI', kode: 'BNAI', guru_ids: [gB.id] } });
    const mapelB = r.body.id;
    ok('dua mapel dengan guru pengampu dibuat', !!mapelA && !!mapelB);

    r = await req('/api/jadwal');
    const ta = Number(r.body.ta) || 1;
    const kelas = (r.body.kelas || []).filter(k => Number(k.ta_id) === ta || !k.ta_id);
    ok('daftar kelas tersedia (>= 2 rombel)', kelas.length >= 2, String(kelas.length));
    const K1 = Number(kelas[0].id), K2 = Number(kelas[1].id);

    r = await req('/api/jadwal/ai/konfigurasi?ta=' + ta);
    ok('GET konfigurasi AI 200', r.status === 200 && r.body.ok === true, r.body?.error);
    ok('konfigurasi memuat aturan default (5 aturan)',
      r.body.aturan_default && Object.keys(r.body.aturan_default).length === 5, JSON.stringify(Object.keys(r.body.aturan_default || {})));
    ok('konfigurasi memuat daftar kelas, mapel, guru, beban, ruang',
      Array.isArray(r.body.kelas) && Array.isArray(r.body.mapel) && Array.isArray(r.body.guru) && Array.isArray(r.body.beban) && Array.isArray(r.body.ruang));
    ok('batas jam guru per hari & mapel per hari dikirim',
      Number(r.body.batas_guru_hari) > 0 && Number(r.body.batas_mapel_hari) > 0,
      JSON.stringify({ g: r.body.batas_guru_hari, m: r.body.batas_mapel_hari }));
    ok('guru membawa daftar mapel yang diampu',
      r.body.guru.some(g => g.guru_id === gA.id && (g.mapel || []).some(m => Number(m.id) === mapelA)));

    /* beban mengajar: 2 kelas × 2 mapel × 4 jam */
    r = await req('/api/jadwal/ai/beban', {
      method: 'POST', body: {
        ta, items: [
          { kelas_id: K1, mapel_id: mapelA, guru_id: gA.id, jam_minggu: 4, ruang: '' },
          { kelas_id: K1, mapel_id: mapelB, guru_id: gB.id, jam_minggu: 4, ruang: 'Lab Uji' },
          { kelas_id: K2, mapel_id: mapelA, guru_id: gA.id, jam_minggu: 4, ruang: '' },
          { kelas_id: K2, mapel_id: mapelB, guru_id: gB.id, jam_minggu: 4, ruang: 'Lab Uji' }
        ]
      }
    });
    ok('beban mengajar disimpan (4 baris)', r.status === 200 && r.body.masuk === 4, JSON.stringify(r.body).slice(0, 140));
    ok('daftar beban menampilkan jam & jumlah terpasang',
      r.body.beban.length === 4 && r.body.beban.every(b => Number(b.jam_minggu) === 4 && Number(b.terpasang) === 0));

    /* beban tanpa guru dilaporkan (mapel tanpa pengampu tidak dipakai) */
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Seni AI', kode: 'SNAI', guru_ids: [] } });
    const mapelC = r.body.id;
    r = await req('/api/jadwal/ai/beban', { method: 'POST', body: { ta, items: [{ kelas_id: K1, mapel_id: mapelC, jam_minggu: 2 }] } });
    ok('beban tanpa guru tetap disimpan', r.status === 200 && r.body.masuk === 1);

    /* batasan guru: batas 6 jam/pekan untuk guru A + Jumat tidak bersedia */
    r = await req('/api/jadwal/ai/guru', {
      method: 'POST', body: { ta, items: [{ guru_id: gA.id, max_jam: 6, tidak_hadir: [5] }] }
    });
    ok('batasan guru disimpan', r.status === 200 && r.body.jumlah === 1, JSON.stringify(r.body).slice(0, 120));
    const gAInfo = (r.body.guru || []).find(g => Number(g.guru_id) === gA.id);
    ok('batasan guru terbaca kembali (max 6, Jumat terlarang)',
      !!gAInfo && Number(gAInfo.max_jam) === 6 && (gAInfo.tidak_hadir || []).includes(5), JSON.stringify(gAInfo && { m: gAInfo.max_jam, h: gAInfo.tidak_hadir }));

    /* ruang/lab */
    r = await req('/api/jadwal/ai/ruang', { method: 'POST', body: { nama: 'Lab Uji', jenis: 'lab', kapasitas: 32 } });
    ok('ruang baru dibuat', r.status === 200 && r.body.ruang.some(x => x.nama === 'Lab Uji'));
    r = await req('/api/jadwal/ai/ruang', { method: 'POST', body: { nama: 'lab uji' } });
    ok('nama ruang ganda ditolak', r.status === 400, JSON.stringify(r.body).slice(0, 120));
    r = await req('/api/jadwal/ai/ruang', { method: 'POST', body: { nama: 'Lab Kosong' } });
    const ruangKosongId = (r.body.ruang || []).find(x => x.nama === 'Lab Kosong').id;
    r = await req('/api/jadwal/ai/ruang/hapus', { method: 'POST', body: { id: ruangKosongId } });
    ok('ruang kosong dapat dihapus', r.status === 200 && !r.body.ruang.some(x => x.nama === 'Lab Kosong'));
    r = await req('/api/jadwal/ai/ruang/hapus', { method: 'POST', body: { id: (r.body.ruang || []).find(x => x.nama === 'Lab Uji').id } });
    ok('ruang yang dipakai beban tidak dapat dihapus', r.status === 409, JSON.stringify(r.body).slice(0, 120));

    /* konfigurasi aturan + mode */
    r = await req('/api/jadwal/ai/konfigurasi', {
      method: 'POST', body: {
        aturan: { hindari_jam_kosong: 1, sebar_mapel_berat: 1, sebar_mapel_harian: 1, hormati_ruang: 1, hormati_batas_guru: 1 },
        mode: 'tambah', kelas_ids: [K1, K2], seed: 11
      }
    });
    ok('konfigurasi aturan disimpan', r.status === 200 && r.body.pengaturin?.seed === 11 || (r.status === 200 && r.body.pengaturan.seed === 11),
      JSON.stringify(r.body).slice(0, 140));
    ok('mode & kelas pilihan tersimpan',
      r.body.pengaturan.mode === 'tambah' && (r.body.pengaturan.kelas_ids || []).length === 2, JSON.stringify(r.body.pengaturan));

    /* ================= 2. GENERATE PRATINJAU ================= */
    console.log('\n== 2. GENERATE PRATINJAU (tanpa menulis) ==');
    const jumlahSebelum = ((await req('/api/jadwal?ta=' + ta)).body.rows || []).length;
    r = await req('/api/jadwal/ai/generate', { method: 'POST', body: { ta, seed: 11 } });
    ok('generate 200 + hasil', r.status === 200 && !!r.body.hasil, JSON.stringify(r.body).slice(0, 160));
    const h = r.body.hasil;
    /* 2 kelas × (4+4) = 16 jam; mapel C tidak punya guru → tidak dihitung (beban tanpa guru dilewati) */
    ok('total unit = 16 jam (mapel tanpa guru dilewati)', h.ringkasan.total_unit === 16, JSON.stringify(h.ringkasan));
    ok('seluruh jam terjadwal (sisa 0)', h.ringkasan.sisa === 0, JSON.stringify(h.sisa).slice(0, 200));
    ok('jumlah slot = 16', h.slots.length === 16, String(h.slots.length));
    ok('tidak ada kelas/guru/ruang dobel', cekUnik(h.slots) === '', cekUnik(h.slots));
    ok('slot memuat nama kelas, mapel, guru, hari, label sesi',
      h.slots.every(s => s.kelas_nama && s.mapel_nama && s.guru_nama && s.hari_nama && s.label_sesi));
    ok('aturan dikembalikan tanpa metadata internal',
      Object.keys(h.aturan).every(kk => !kk.startsWith('_')) && Object.keys(h.aturan).length === 5, JSON.stringify(h.aturan));
    /* aturan: mapel sama tidak dobel dalam sehari per kelas */
    const perHari = new Map();
    for (const s of h.slots) {
      for (const kid of s.kelas_ids) {
        const key = `${kid}:${s.mapel_id}:${s.hari}`;
        perHari.set(key, (perHari.get(key) || 0) + 1);
      }
    }
    ok('aturan sebar mapel harian dipatuhi (maks 1 mapel/hari)',
      [...perHari.values()].every(n => n <= 1), JSON.stringify([...perHari.entries()].filter(([, n]) => n > 1)));
    /* aturan: guru A tidak mengajar hari Jumat */
    ok('guru yang tidak bersedia Jumat tidak dijadwalkan hari Jumat',
      !h.slots.some(s => Number(s.guru_id) === gA.id && Number(s.hari) === 5),
      JSON.stringify(h.slots.filter(s => Number(s.guru_id) === gA.id).map(s => s.hari)));
    /* aturan: ruang Lab Uji tidak dobel */
    ok('aturan hormati ruang dipatuhi', cekUnik(h.slots) === '');
    ok('generate TIDAK menulis jadwal', ((await req('/api/jadwal?ta=' + ta)).body.rows || []).length === jumlahSebelum);
    ok('kapasitas dihitung (hari × jam × kelas)',
      h.kapasitas.hari === 5 && h.kapasitas.jam_per_hari === 6 && h.kapasitas.total_slot === 2 * 5 * 6, JSON.stringify(h.kapasitas));

    /* determinisme seed */
    const h2 = (await req('/api/jadwal/ai/generate', { method: 'POST', body: { ta, seed: 11 } })).body.hasil;
    const kunci = (x) => x.slots.map(s => `${s.kelas_id}|${s.hari}|${s.sesi}|${s.mapel_id}|${s.guru_id}`).sort().join(',');
    ok('seed sama menghasilkan susunan sama', kunci(h2) === kunci(h), '');

    /* ================= 3. BATAS GURU → SISA JAM ================= */
    console.log('\n== 3. BATAS GURU & SISA JAM ==');
    /* guru A dibatasi 6 jam/pekan padahal butuh 8 → minimal 2 jam sisa */
    r = await req('/api/jadwal/ai/generate', { method: 'POST', body: { ta, seed: 21 } });
    const h3 = r.body.hasil;
    const jamA = h3.slots.filter(s => Number(s.guru_id) === gA.id).length;
    ok('batas 6 jam/pekan guru A dipatuhi', jamA <= 6, String(jamA));
    ok('sisa jam dilaporkan beserta alasan', h3.ringkasan.sisa >= 2 && h3.sisa.every(s => !!s.alasan),
      JSON.stringify(h3.sisa.slice(0, 2)));
    ok('peringatan menyebut jumlah jam tidak terjadwal',
      (h3.peringatan || []).some(p => /tidak terjadwal/i.test(p)), JSON.stringify(h3.peringatan));

    /* ================= 4. APPLY ================= */
    console.log('\n== 4. TERAPKAN JADWAL ==');
    r = await req('/api/jadwal/ai/apply', { method: 'POST', body: { ta, seed: 11 } });
    ok('apply 200 + jumlah masuk', r.status === 200 && r.body.masuk === 16, JSON.stringify(r.body).slice(0, 140));
    let rows = (await req('/api/jadwal?ta=' + ta)).body.rows || [];
    ok('16 baris jadwal tersimpan di database', rows.length === 16, String(rows.length));
    ok('slot AI ditandai catatan "AI Timetable Generator"',
      rows.filter(x => /AI Timetable/i.test(x.catatan || '')).length === 16);
    ok('guru pengampu mapel tersimpan di Data Master',
      (await req('/api/mapel')).body.rows.some(m => Number(m.id) === mapelA && (m.guru || []).some(g => Number(g.id) === gA.id)));

    /* mode tambah setelah penuh → tidak ada perubahan */
    r = await req('/api/jadwal/ai/generate', { method: 'POST', body: { ta, seed: 11 } });
    ok('mode tambah setelah penuh → 0 slot baru', r.body.hasil.slots.length === 0 && r.body.hasil.dipertahankan.length === 16,
      JSON.stringify({ s: r.body.hasil.slots.length, d: r.body.hasil.dipertahankan.length }));
    r = await req('/api/jadwal/ai/apply', { method: 'POST', body: { ta, seed: 11 } });
    ok('apply tanpa perubahan ditolak 400', r.status === 400, JSON.stringify(r.body).slice(0, 120));

    /* mode ganti → bongkar 16, susun 16 */
    r = await req('/api/jadwal/ai/generate', { method: 'POST', body: { ta, mode: 'ganti', seed: 33 } });
    const h4 = r.body.hasil;
    ok('mode ganti membongkar 16 slot lama', h4.hapus.length === 16 && h4.dipertahankan.length === 0, JSON.stringify({ h: h4.hapus.length, d: h4.dipertahankan.length }));
    ok('mode ganti menyusun 16 slot baru', h4.slots.length === 16, String(h4.slots.length));
    r = await req('/api/jadwal/ai/apply', { method: 'POST', body: { ta, mode: 'ganti', seed: 33 } });
    ok('apply mode ganti: 16 masuk, 16 dibongkar', r.status === 200 && r.body.masuk === 16 && r.body.dihapus === 16, JSON.stringify(r.body).slice(0, 140));
    rows = (await req('/api/jadwal?ta=' + ta)).body.rows || [];
    ok('total slot tetap 16 setelah bongkar + susun', rows.length === 16, String(rows.length));
    ok('tidak ada kelas/guru dobel setelah apply', cekUnik(rows) === '', cekUnik(rows));

    /* ================= 5. SINKRON BEBAN & BERSIH-BERSIH ================= */
    console.log('\n== 5. SINKRON BEBAN DARI JADWAL ==');
    await req('/api/jadwal/ai/beban', { method: 'POST', body: { ta, items: [{ kelas_id: K1, mapel_id: mapelA, jam_minggu: 1 }] } });
    r = await req('/api/jadwal/ai/beban/sinkron', { method: 'POST', body: { ta } });
    ok('sinkron menarik beban dari jadwal', r.status === 200 && r.body.masuk === 2, JSON.stringify(r.body).slice(0, 140));
    ok('total beban hasil sinkron = 16 jam', (r.body.beban || []).reduce((s, b) => s + Number(b.jam_minggu), 0) === 16,
      JSON.stringify((r.body.beban || []).map(b => b.jam_minggu)));
    ok('jumlah slot terpasang tiap beban terbaca', (r.body.beban || []).every(b => Number(b.terpasang) === 8),
      JSON.stringify((r.body.beban || []).map(b => Number(b.terpasang))));

    /* audit tercatat */
    const audit = (await req('/api/audit?modul=jadwal&limit=100')).body.rows || [];
    ok('audit generate & apply tercatat',
      audit.some(a => /AI Timetable generate/i.test(a.detail || '')) && audit.some(a => /AI Timetable apply/i.test(a.detail || '')),
      JSON.stringify(audit.slice(0, 3).map(a => a.detail)));

    /* ================= 6. RBAC ================= */
    console.log('\n== 6. RBAC GURU (VIEW SAJA) ==');
    await login('guru', 'guru123');
    ok('login guru', !!cookie);
    r = await req('/api/jadwal/ai/konfigurasi?ta=' + ta);
    ok('guru dapat melihat konfigurasi AI', r.status === 200 && r.body.ok === true, String(r.status));
    r = await req('/api/jadwal/ai/generate', { method: 'POST', body: { ta, seed: 11 } });
    ok('guru boleh melihat pratinjau generate', r.status === 200, JSON.stringify(r.body).slice(0, 120));
    const jumlahGuru = ((await req('/api/jadwal?ta=' + ta)).body.rows || []).length;
    r = await req('/api/jadwal/ai/apply', { method: 'POST', body: { ta, seed: 11 } });
    ok('guru ditolak saat apply (butuh izin tulis)', r.status === 403, String(r.status));
    r = await req('/api/jadwal/ai/beban', { method: 'POST', body: { ta, items: [{ kelas_id: K1, mapel_id: mapelA, jam_minggu: 2 }] } });
    ok('guru ditolak mengubah beban', r.status === 403, String(r.status));
    ok('jadwal tidak berubah oleh percobaan guru', ((await req('/api/jadwal?ta=' + ta)).body.rows || []).length === jumlahGuru);

    /* kembali sebagai admin untuk memastikan konfigurasi tersimpan */
    await login('admin', 'admin123');
    r = await req('/api/jadwal/ai/konfigurasi?ta=' + ta);
    ok('konfigurasi tetap tersimpan setelah uji guru', r.status === 200 && Number(r.body.pengaturin?.seed || r.body.pengaturan.seed) === 11);
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