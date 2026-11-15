'use strict';
/* Uji ronde 21:
   1. Guru pengampu TERKUNCI pada slot jadwal (mengikuti Data Master Mata Pelajaran)
   2. Sesi jam pelajaran per hari (label berbeda tiap hari, mis. Upacara)
   3. Import Mata Pelajaran (preview + commit, guru pengampu massal)
   4. Multi-tampilan matriks & ekspor/cetak (mode kelas/vertikal/guru/semua, grid kosong rapi)
   5. Sinkronisasi jadwal → Check-in Absensi Guru (TA berbeda & tanggal lokal)
   Jalankan: node dev-tests/round21.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-r21-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r21-saas-' + Date.now() + '.sqlite');
const PORT = 4400 + Math.floor(Math.random() * 150);
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
/* bila pengujian dijalankan menjelang tengah malam, geser jadwal uji ke belakang
   agar seluruh sesi tetap berada di hari yang sama */
const base = Math.min(cur, 1440 - 160);

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2300));

  const cfgBody = (extra = {}) => ({
    hari: [HARI], max_jam: 8,
    sesi: extra.sesi || [
      { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
      { label: 'Istirahat', mulai: hhmm(base + 26), selesai: hhmm(base + 35), istirahat: 1 },
      { label: 'Jam ke-2', mulai: hhmm(base + 36), selesai: hhmm(base + 70), istirahat: 0 },
      { label: 'Jam ke-3', mulai: hhmm(base + 71), selesai: hhmm(base + 105), istirahat: 0 },
      { label: 'Jam ke-4', mulai: hhmm(base + 106), selesai: hhmm(base + 140), istirahat: 0 }
    ],
    sesi_hari: extra.sesi_hari || undefined,
    max_mapel_jam: 2, max_guru_jam: 8,
    absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
    wa: { aktif: 0, jam: '15:00' }
  });

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    const users = (await req('/api/users')).body.rows || [];
    const gHendra = users.find(u => u.username === 'guru');
    const gBudi = users.find(u => u.username === 'guruumum');
    ok('akun guru uji tersedia', !!gHendra && !!gBudi);

    /* ================= 1. GURU PENGAMPU TERKUNCI ================= */
    console.log('\n== 1. GURU PENGAMPU TERKUNCI PADA SLOT JADWAL ==');
    let r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('pengaturan jadwal disimpan', r.status === 200, r.body?.error);

    /* mapel dengan guru pengampu diatur di Data Master */
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Matematika', kode: 'MTK', guru_ids: [gHendra.id] } });
    const mapelMtk = r.body.id;
    ok('mapel dengan guru pengampu dibuat', r.status === 200 && !!mapelMtk);

    r = await req('/api/jadwal?ta=1');
    const infoMapel = (r.body.mapel || []).find(m => Number(m.id) === Number(mapelMtk));
    ok('GET /api/jadwal mengirim guru pengampu per mapel',
      !!infoMapel && infoMapel.guru_id === gHendra.id && (infoMapel.guru || []).length === 1, JSON.stringify(infoMapel && infoMapel.guru));

    const kelas = (await req('/api/jadwal')).body.kelas;
    ok('kelas uji tersedia', kelas.length >= 2, String(kelas.length));
    r = await req('/api/jadwal/slot', {
      method: 'POST',
      body: { hari: HARI, sesi: 1, mapel_id: mapelMtk, guru_id: gBudi.id, kelas_ids: [kelas[0].id], abaikan: 1 }
    });
    ok('slot tetap tersimpan walau guru di form berbeda', r.status === 200, r.body?.error);
    ok('guru pada slot DIPAKSA sesuai pengampu mapel', r.body.guru_id === gHendra.id,
      JSON.stringify({ dikirim: gBudi.id, hasil: r.body.guru_id }));
    ok('respons menjelaskan guru terkunci', (r.body.peringatan || []).some(p => /dikunci/i.test(p)) || /guru pengampu/i.test(r.body.pesan || ''),
      JSON.stringify(r.body.peringatan));
    r = await req('/api/jadwal');
    const slotBaru = (r.body.rows || []).find(x => Number(x.mapel_id) === Number(mapelMtk));
    ok('slot di database memakai guru pengampu mapel', !!slotBaru && Number(slotBaru.guru_id) === gHendra.id);

    /* mapel TANPA guru pengampu: guru dari form diikat otomatis */
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Sejarah', kode: 'SJH' } });
    const mapelSjh = r.body.id;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 3, mapel_id: mapelSjh, guru_id: gBudi.id, kelas_ids: [kelas[1].id], abaikan: 1 } });
    ok('mapel tanpa pengampu: guru dari form diikat otomatis', r.status === 200 && r.body.guru_id === gBudi.id, JSON.stringify(r.body));
    r = await req('/api/mapel');
    const sjh = (r.body.rows || []).find(m => Number(m.id) === Number(mapelSjh));
    ok('ikatan guru tersimpan di Data Master Mata Pelajaran', !!sjh && (sjh.guru || []).some(g => g.id === gBudi.id));
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 4, mapel_id: mapelSjh, guru_id: gHendra.id, kelas_ids: [kelas[0].id], abaikan: 1 } });
    ok('slot berikutnya tetap memakai pengampu terikat (bukan guru baru)', r.status === 200 && r.body.guru_id === gBudi.id, JSON.stringify(r.body));
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: 99999, guru_id: gBudi.id, kelas_ids: [kelas[0].id] } });
    ok('mapel tidak dikenal ditolak', r.status === 400);

    /* MULTI PENGAMPU (kasus nyata: Matematika diajar beberapa guru) */
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Bahasa Inggris', kode: 'ENG', guru_ids: [gHendra.id, gBudi.id] } });
    const mapelMulti = r.body.id;
    ok('mapel dengan 2 guru pengampu dibuat', r.status === 200);
    r = await req('/api/jadwal/slot', {
      method: 'POST',
      body: { hari: HARI, sesi: 4, mapel_id: mapelMulti, guru_id: users.find(u => u.username === 'wali1').id, kelas_ids: [kelas[2].id], abaikan: 1 }
    });
    ok('guru di luar daftar pengampu ditolak', r.status === 400 && /guru pengampu/i.test(r.body.error || ''), r.body?.error);
    r = await req('/api/jadwal/slot', {
      method: 'POST',
      body: { hari: HARI, sesi: 5, mapel_id: mapelMulti, guru_id: gBudi.id, kelas_ids: [kelas[2].id], abaikan: 1 }
    });
    ok('guru dari daftar pengampu diterima (tidak dipaksa guru pertama)', r.status === 200 && r.body.guru_id === gBudi.id, JSON.stringify(r.body).slice(0, 160));
    ok('respons menyertakan daftar pilihan pengampu', (r.body.guru_pilihan || []).length === 2, JSON.stringify(r.body.guru_pilihan));

    /* ================= 2. SESI JAM PER HARI ================= */
    console.log('\n== 2. SESI JAM PELAJARAN PER HARI ==');
    const sesiSenin = [
      { label: 'Upacara Bendera', mulai: '07:00', selesai: '07:45', istirahat: 0 },
      { label: 'Jam ke-1', mulai: '07:45', selesai: '08:30', istirahat: 0 },
      { label: 'Istirahat / Sholat', mulai: '08:30', selesai: '09:00', istirahat: 1 }
    ];
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ sesi_hari: { [HARI]: sesiSenin } }) });
    ok('sesi khusus per hari disimpan', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/pengaturan');
    const sesiHariCfg = (r.body.config.sesiHari || {})[String(HARI)] || [];
    ok('config memuat sesiHari', sesiHariCfg.length === 3, JSON.stringify(Object.keys(r.body.config.sesiHari || {})));
    ok('label sesi khusus terbaca (Upacara)', (sesiHariCfg[0] || {}).label === 'Upacara Bendera', JSON.stringify(sesiHariCfg[0]));
    ok('penanda istirahat/sholat ikut tersimpan', (sesiHariCfg[2] || {}).istirahat === 1, JSON.stringify(sesiHariCfg[2]));
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ sesi_hari: { [HARI]: [{ label: 'X', mulai: '10:00', selesai: '09:00', istirahat: 0 }] } }) });
    ok('jam sesi per hari tidak valid ditolak', r.status === 400, r.body?.error);
    const hariNonaktif = [0, 1, 2, 3, 4, 5, 6].find(h => h !== HARI);
    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody({ sesi_hari: { [hariNonaktif]: [{ label: 'X', mulai: '07:00', selesai: '08:00', istirahat: 0 }] } }) });
    ok('sesi per hari pada hari nonaktif ditolak', r.status === 400, r.body?.error);
    /* kembali ke sesi normal untuk uji berikutnya */
    await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });

    /* ================= 3. IMPORT MATA PELAJARAN ================= */
    console.log('\n== 3. IMPORT MATA PELAJARAN ==');
    r = await req('/api/mapel/template.xlsx');
    ok('template Excel mata pelajaran tersedia', r.status === 200 && /spreadsheet/.test(r.ct));
    /* buat XLSX sederhana dengan lib.xlsxBuffer (tanpa dependency baru) */
    const lib = require('../lib');
    const xlsx = lib.xlsxBuffer('MAPEL', [
      [{ v: 'TEMPLATE IMPOR MATA PELAJARAN', bold: true }], [],
      ['KODE', 'NAMA MAPEL', 'KELOMPOK', 'MAKS JAM/HARI', 'GURU PENGAMPU (USERNAME, PISAH KOMA)'],
      ['BIN', 'Bahasa Indonesia', 'Umum', 4, 'guru'],
      ['IPA', 'Ilmu Pengetahuan Alam', 'Umum', 3, 'guruumum'],
      ['TIK', 'Teknologi Informasi', 'Produktif', 2, 'guru, guruumum'],
      ['BAD', 'Mapel Dengan Guru Salah', 'Umum', 2, 'tidak-ada-akun']
    ], [12, 30, 18, 14, 34]);
    const base64 = xlsx.toString('base64');
    r = await req('/api/mapel/import/preview', { method: 'POST', body: { base64, filename: 'mapel.xlsx' } });
    ok('pratinjau import mapel membaca 4 baris', r.status === 200 && r.body.total === 4, JSON.stringify(r.body).slice(0, 160));
    const barisBin = (r.body.rows || []).find(x => x.kode === 'BIN');
    ok('guru pengampu terpetakan dari username', !!barisBin && barisBin.guru.some(g => g.id === gHendra.id), JSON.stringify(barisBin && barisBin.guru));
    ok('multi guru pengampu didukung', (r.body.rows || []).find(x => x.kode === 'TIK').guru.length === 2);
    ok('guru tidak dikenal dilaporkan sebagai error',
      !!(r.body.rows || []).find(x => x.kode === 'BAD').error, JSON.stringify((r.body.rows || []).find(x => x.kode === 'BAD')));
    ok('baris error tidak dihitung siap', r.body.siap === 3, String(r.body.siap));
    r = await req('/api/mapel/import/commit', { method: 'POST', body: { rows: r.body.rows } });
    ok('commit import mapel menyimpan 3 mapel', r.status === 200 && r.body.masuk === 3, JSON.stringify(r.body));
    r = await req('/api/mapel');
    const bin = (r.body.rows || []).find(m => m.kode === 'BIN');
    ok('mapel hasil import tersedia beserta kode & kelompok', !!bin && bin.kelompok === 'Umum');
    ok('guru pengampu hasil import tersimpan', !!bin && (bin.guru || []).some(g => g.id === gHendra.id));
    const tik = (r.body.rows || []).find(m => m.kode === 'TIK');
    ok('mapel dengan 2 pengampu tersimpan keduanya', !!tik && (tik.guru || []).length === 2);
    ok('mapel berguru salah tidak dibuat', !(r.body.rows || []).some(m => m.kode === 'BAD'));
    /* import ulang → perbarui, bukan duplikat */
    r = await req('/api/mapel/import/preview', { method: 'POST', body: { base64, filename: 'mapel.xlsx' } });
    ok('import ulang dikenali sebagai "perbarui"',
      (r.body.rows || []).filter(x => x.aksi === 'perbarui').length >= 3, JSON.stringify((r.body.rows || []).map(x => x.aksi)));
    r = await req('/api/mapel/import/commit', { method: 'POST', body: { rows: r.body.rows } });
    ok('commit ulang tidak membuat duplikat', r.body.masuk === 0 && r.body.diperbarui >= 3, JSON.stringify(r.body));

    /* ================= 4. MULTI-TAMPILAN & EKSPOR ================= */
    console.log('\n== 4. MULTI-TAMPILAN MATRIKS & EKSPOR ==');
    for (const mode of ['kelas', 'vertikal', 'guru', 'semua']) {
      r = await req('/api/jadwal/export.xlsx?ta=1&mode=' + mode);
      ok(`ekspor Excel mode ${mode}`, r.status === 200 && /spreadsheet/.test(r.ct), r.status + ' ' + r.ct);
      r = await req('/api/jadwal/cetak?ta=1&mode=' + mode);
      ok(`cetak PDF mode ${mode}`, r.status === 200 && /text\/html/.test(r.ct) && /JADWAL PELAJARAN/i.test(r.body));
    }
    r = await req('/api/jadwal/cetak?ta=1&mode=vertikal');
    ok('matriks vertikal memuat kolom kelas & baris hari',
      r.body.includes('HARI / JAM') && kelas.slice(0, 2).every(k => r.body.includes(k.nama)));
    ok('cetak TIDAK memunculkan pesan "belum ada kelas atau slot jadwal"', !/Belum ada kelas atau slot jadwal/i.test(r.body));
    r = await req('/api/jadwal/cetak?ta=1&mode=kelas');
    ok('cetak mode kelas memuat nama mapel & guru', /Matematika/.test(r.body) && /Hendra Gunawan/.test(r.body),
      r.body.slice(0, 60));

    /* TA tanpa data → kerangka grid tetap tampil (bukan pesan kosong) */
    cookie = '';
    await login('admin', 'admin123');
    const taBaru = await req('/api/tahun/save', { method: 'POST', body: { nama: '2030/2031', tanggal_mulai: '2030-07-01', tanggal_selesai: '2031-06-30', aktif: 0 } });
    const idTaBaru = (taBaru.body?.rows || []).find(t => t.nama === '2030/2031')?.id;
    ok('tahun pelajaran baru dibuat untuk uji grid kosong', taBaru.status === 200 && !!idTaBaru, JSON.stringify(taBaru.body).slice(0, 140));
    r = await req('/api/jadwal/cetak?ta=' + idTaBaru + '&mode=vertikal');
    ok('TA tanpa slot tetap merender kerangka grid', r.status === 200 && /HARI \/ JAM/.test(r.body) && /Belum ada slot jadwal/.test(r.body));
    ok('cetak TA kosong tidak memakai pesan kelas/slot jadwal lama', !/Belum ada kelas atau slot jadwal/i.test(r.body));
    r = await req('/api/jadwal/export.xlsx?ta=' + idTaBaru + '&mode=vertikal');
    ok('ekspor Excel TA kosong tetap berhasil', r.status === 200 && /spreadsheet/.test(r.ct));

    /* ================= 5. SINKRONISASI JADWAL → ABSENSI ================= */
    console.log('\n== 5. SINKRONISASI JADWAL → CHECK-IN ABSENSI GURU ==');
    cookie = '';
    await login('admin', 'admin123');
    await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    await login('guru', 'guru123');
    r = await req('/api/absensi-guru?tanggal=' + TODAY);
    ok('guru melihat sesi mengajar hari ini', r.status === 200 && (r.body.jadwal || []).length >= 1,
      JSON.stringify({ jumlah: (r.body.jadwal || []).length, ta: r.body.ta }));
    ok('slot menandai jendela absensi terbuka', (r.body.jadwal || []).some(j => j.window && j.window.aktif === true),
      JSON.stringify((r.body.jadwal || []).map(j => ({ id: j.id, w: j.window }))));
    /* tanggal kemarin tetap terbaca (tidak kosong/error) */
    const kemarin = new Date(wib.getTime() - 86400000);
    const tglKemarin = `${kemarin.getFullYear()}-${pad(kemarin.getMonth() + 1)}-${pad(kemarin.getDate())}`;
    r = await req('/api/absensi-guru?tanggal=' + tglKemarin);
    ok('tanggal lain tetap merespons normal', r.status === 200 && Array.isArray(r.body.jadwal));

    /* jadwal dibuat pada TA yang dipilih (ta_aktif) tetapi absensi dibuka tanpa ?ta */
    cookie = '';
    await login('admin', 'admin123');
    const daftarTa = (await req('/api/jadwal')).body.tahun || [];
    const taAktif = (await req('/api/jadwal')).body.ta;
    const taLain = (daftarTa.find(t => Number(t.id) !== Number(taAktif)) || {});
    if (taLain.id) {
      r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 5, mapel_id: mapelMtk, kelas_ids: [kelas[3].id], abaikan: 1, ta: taLain.id } });
      ok('slot dapat dibuat pada tahun pelajaran lain', r.status === 200, r.body?.error);
      const slotLain = r.body.id;
      /* pindahkan sudut pandang ke TA tersebut (ta_aktif) */
      r = await req('/api/settings/tahun', { method: 'POST', body: { ta: taLain.id } });
      ok('tahun pelajaran pandangan dipindah', r.status === 200);
      cookie = '';
      await login('guru', 'guru123');
      r = await req('/api/absensi-guru?tanggal=' + TODAY);
      ok('sesi pada TA pilihan tetap muncul di absensi guru', r.status === 200
        && (r.body.jadwal || []).some(j => Number(j.id) === Number(slotLain)), JSON.stringify({ ta: r.body.ta, jumlah: (r.body.jadwal || []).length }));
      cookie = '';
      await login('admin', 'admin123');
      await req('/api/settings/tahun', { method: 'POST', body: { ta: taAktif } });
    } else {
      ok('slot dapat dibuat pada tahun pelajaran lain (dilewati: hanya 1 TA)', false, 'hanya satu TA');
      ok('sesi pada TA pilihan tetap muncul di absensi guru', false, 'hanya satu TA');
    }
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
