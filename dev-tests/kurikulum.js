'use strict';
/* Uji (tata-tertib) — kurikulum & cetak:
   1. Validasi TARGET JAM PELAJARAN per kelas per pekan (aktif/nonaktif,
      standar global, pengecualian per kelas, status kurang/lebih/pas)
   2. PEMETAAN BATAS JAM MENGAJAR GURU (target per pekan & per bulan,
      perkiraan jam/bulan dari pekan efektif, status kurang/lebih)
   3. KALENDER AKADEMIK: tanda libur/ujian/kegiatan (satuan & massal),
      statistik hari efektif, dan SINKRONISASI ke absensi/jadwal
      (absensi ditutup, presensi tidak dibuka, alfa otomatis dilewati)
   4. KOP SURAT SERAGAM di cetakan (rekap guru/siswa/bulanan/asesmen BK)
      + tombol PDF & Word pada Program Layanan BK, Kanal Aduan, Tindak Lanjut
   Jalankan: node dev-tests/kurikulum.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-kur-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-kur-saas-' + Date.now() + '.sqlite');
const PORT = 5700 + Math.floor(Math.random() * 200);
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
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
const cur = wib.getHours() * 60 + wib.getMinutes();
const base = Math.max(120, Math.min(cur, 1440 - 200));
const BULAN_INI = TODAY.slice(0, 7);

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2400));

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    /* ---------------- pengaturan jadwal dasar ---------------- */
    let r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(base + 26), selesai: hhmm(base + 60), istirahat: 0 },
          { label: 'Jam ke-3', mulai: hhmm(base + 61), selesai: hhmm(base + 95), istirahat: 0 }
        ],
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180, auto_alpha: 1 },
        wa: { aktif: 0, jam: '15:00' }
      }
    });
    ok('pengaturan jadwal disimpan', r.status === 200, r.body?.error);

    const users = (await req('/api/users')).body.rows || [];
    const gA = users.find(u => u.username === 'guru');
    const gB = users.find(u => u.username === 'guruumum');
    ok('dua akun guru tersedia', !!gA && !!gB);

    const kelasAll = (await req('/api/jadwal')).body.kelas || [];
    ok('kelas tersedia (≥2)', kelasAll.length >= 2, String(kelasAll.length));
    const k1 = kelasAll[0], k2 = kelasAll[1];

    const buatMapel = async (nama, kode, guruId) => (await req('/api/mapel/save', {
      method: 'POST', body: { nama, kode, guru_ids: guruId ? [guruId] : [] }
    })).body.id;
    const m1 = await buatMapel('Matematika Uji', 'MTKU', gA.id);
    const m2 = await buatMapel('Bahasa Uji', 'BINU', gB.id);
    ok('dua mata pelajaran uji dibuat', !!m1 && !!m2);

    const slot = async (sesi, mapelId, guruId, kelasId) => (await req('/api/jadwal/slot', {
      method: 'POST', body: { hari: HARI, sesi, mapel_id: mapelId, guru_id: guruId, kelas_ids: [kelasId], abaikan: 1 }
    })).body.id;

    /* ============ 1. VALIDASI TARGET JAM PELAJARAN PER KELAS ============ */
    console.log('\n== 1. TARGET JAM PELAJARAN PER KELAS ==');
    let s1 = await slot(1, m1, gA.id, k1.id);
    let s2 = await slot(2, m2, gB.id, k1.id);
    let s3 = await slot(3, m1, gA.id, k2.id);
    ok('tiga slot jadwal dibuat (2 jam kelas 1, 1 jam kelas 2)', !!s1 && !!s2 && !!s3);

    r = await req('/api/jadwal');
    ok('GET /api/jadwal mengirim konfigurasi target', !!r.body.target && Number(r.body.target.minggu) === 40,
      JSON.stringify(r.body.target && { aktif: r.body.target.aktif, minggu: r.body.target.minggu }));
    ok('target aktif secara bawaan', r.body.target.aktif === true);
    const t1 = (r.body.target.rows || []).find(x => Number(x.id) === Number(k1.id)) || {};
    const t2 = (r.body.target.rows || []).find(x => Number(x.id) === Number(k2.id)) || {};
    ok('jam terpasang tiap kelas dihitung benar', Number(t1.terisi) === 2 && Number(t2.terisi) === 1,
      JSON.stringify({ k1: t1.terisi, k2: t2.terisi }));
    ok('status kelas di bawah target = "kurang"', t1.status === 'kurang' && t2.status === 'kurang',
      JSON.stringify({ k1: t1.status, k2: t2.status }));
    ok('selisih negatif dihitung (2 − 40)', Number(t1.selisih) === -38, String(t1.selisih));

    /* standar global diubah */
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(base + 26), selesai: hhmm(base + 60), istirahat: 0 },
          { label: 'Jam ke-3', mulai: hhmm(base + 61), selesai: hhmm(base + 95), istirahat: 0 }
        ],
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180, auto_alpha: 1 },
        target_jam: { aktif: 1, minggu: 2 }
      }
    });
    ok('standar target jam disimpan (2 jam/pekan)', r.status === 200 && Number(r.body.config ? 1 : 1) === 1, r.body?.error);
    r = await req('/api/jadwal');
    ok('kelas dengan 2 jam menjadi "pas"', (r.body.target.rows || []).find(x => Number(x.id) === Number(k1.id)).status === 'pas',
      JSON.stringify((r.body.target.rows || []).map(x => [x.nama, x.terisi, x.target, x.status])));
    ok('kelas dengan 1 jam tetap "kurang"', (r.body.target.rows || []).find(x => Number(x.id) === Number(k2.id)).status === 'kurang');

    r = await req('/api/jadwal/pengaturan', { method: 'POST', body: { hari: [HARI], max_jam: 8, sesi: [{ label: 'Jam', mulai: hhmm(base), selesai: hhmm(base + 30), istirahat: 0 }], max_mapel_jam: 2, max_guru_jam: 8, target_jam: { aktif: 1, minggu: 0 } } });
    ok('validasi: target 0 jam ditolak 400', r.status === 400, r.status);
    r = await req('/api/jadwal/pengaturan');
    ok('penolakan tidak mengubah nilai sebelumnya (masih 2)', Number(r.body.target.minggu) === 2, String(r.body.target.minggu));

    /* pengecualian target per kelas */
    r = await req('/api/kelas/save', { method: 'POST', body: { id: k2.id, nama: k2.nama, tingkat: k2.tingkat, target_jam: 1 } });
    ok('target khusus kelas disimpan', r.status === 200, r.body?.error);
    r = await req('/api/jadwal');
    const t2b = (r.body.target.rows || []).find(x => Number(x.id) === Number(k2.id)) || {};
    ok('kelas memakai target khusus (1 jam) dan berstatus "pas"',
      Number(t2b.target) === 1 && t2b.status === 'pas' && t2b.khusus === true,
      JSON.stringify({ target: t2b.target, status: t2b.status, khusus: t2b.khusus }));
    r = await req('/api/kelas');
    ok('master kelas mengirim target_jam', (r.body.rows || []).some(k => Number(k.id) === Number(k2.id) && Number(k.target_jam) === 1));
    r = await req('/api/kelas/save', { method: 'POST', body: { id: k2.id, nama: k2.nama, tingkat: k2.tingkat, target_jam: 99 } });
    ok('validasi target kelas > 80 ditolak', r.status === 400, r.status);

    /* nonaktifkan aturan */
    r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(base + 26), selesai: hhmm(base + 60), istirahat: 0 },
          { label: 'Jam ke-3', mulai: hhmm(base + 61), selesai: hhmm(base + 95), istirahat: 0 }
        ],
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180, auto_alpha: 1 },
        target_jam: { aktif: 0, minggu: 2 }
      }
    });
    r = await req('/api/jadwal');
    ok('sakelar target bisa dinonaktifkan', r.body.target.aktif === false);
    ok('saat nonaktif status kelas = "nonaktif"', (r.body.target.rows || []).every(x => x.status === 'nonaktif'),
      JSON.stringify((r.body.target.rows || []).map(x => x.status)));
    /* kembalikan aktif */
    await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI], max_jam: 8,
        sesi: [
          { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(base + 26), selesai: hhmm(base + 60), istirahat: 0 },
          { label: 'Jam ke-3', mulai: hhmm(base + 61), selesai: hhmm(base + 95), istirahat: 0 }
        ],
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180, auto_alpha: 1 },
        target_jam: { aktif: 1, minggu: 2 }
      }
    });

    /* ============ 2. PEMETAAN BATAS JAM MENGAJAR GURU ============ */
    console.log('\n== 2. PEMETAAN JAM MENGAJAR GURU ==');
    r = await req('/api/jadwal/guru-target?bulan=' + BULAN_INI);
    ok('endpoint pemetaan jam guru tersedia', r.status === 200 && Array.isArray(r.body.rows), r.body?.error);
    const rowA = (r.body.rows || []).find(x => Number(x.guru_id) === Number(gA.id)) || {};
    ok('jam terpasang guru dihitung dari jadwal (2 jam)', Number(rowA.jam_minggu) === 2, JSON.stringify(rowA.jam_minggu));
    ok('guru tanpa target berstatus "belum"', rowA.status === 'belum', rowA.status);
    ok('perkiraan jam/bulan memakai pekan efektif', Number(rowA.jam_bulan) === Math.round(2 * (r.body.ringkas.pekan_efektif || 0) * 10) / 10,
      JSON.stringify({ jam_bulan: rowA.jam_bulan, pekan: r.body.ringkas.pekan_efektif }));

    r = await req('/api/jadwal/guru-target', {
      method: 'POST',
      body: { bulan: BULAN_INI, items: [{ guru_id: gA.id, target_minggu: 5, target_bulan: 20, catatan: 'guru mapel utama' }] }
    });
    ok('target jam guru disimpan', r.status === 200, r.body?.error);
    const rowA2 = (r.body.rows || []).find(x => Number(x.guru_id) === Number(gA.id)) || {};
    ok('status guru kurang jam (2 dari 5)', rowA2.status === 'kurang' && Number(rowA2.selisih) === -3,
      JSON.stringify({ s: rowA2.status, sel: rowA2.selisih }));
    ok('catatan & target bulan tersimpan', rowA2.catatan === 'guru mapel utama' && Number(rowA2.target_bulan) === 20);
    ok('ringkasan menghitung guru kurang', Number(r.body.ringkas.kurang) >= 1, JSON.stringify(r.body.ringkas));

    r = await req('/api/jadwal/guru-target', { method: 'POST', body: { items: [{ guru_id: gB.id, target_minggu: 1 }] } });
    const rowB = (r.body.rows || []).find(x => Number(x.guru_id) === Number(gB.id)) || {};
    ok('guru dengan jam sesuai target berstatus "pas"', rowB.status === 'pas', JSON.stringify({ s: rowB.status, j: rowB.jam_minggu }));
    r = await req('/api/jadwal/guru-target', { method: 'POST', body: { items: [{ guru_id: gA.id, target_minggu: 1 }] } });
    ok('guru melebihi target berstatus "lebih"', (r.body.rows || []).find(x => Number(x.guru_id) === Number(gA.id)).status === 'lebih');
    r = await req('/api/jadwal/guru-target', { method: 'POST', body: { items: [{ guru_id: gA.id, target_minggu: 200 }] } });
    ok('validasi target guru > 80 ditolak', r.status === 400, r.status);
    r = await req('/api/jadwal/guru-target', { method: 'POST', body: { items: [{ target_minggu: 3 }] } });
    ok('validasi baris tanpa guru ditolak', r.status === 400, r.status);

    /* ============ 3. KALENDER AKADEMIK ============ */
    console.log('\n== 3. KALENDER AKADEMIK & HARI EFEKTIF ==');
    r = await req('/api/kalender-akademik');
    ok('kalender akademik tersedia + kategori', r.status === 200 && (r.body.kategori || []).length === 3, r.body?.error);
    ok('daftar bulan tahun ajaran (12 bulan)', (r.body.bulan || []).length === 12, String((r.body.bulan || []).length));
    const efektifAwal = (r.body.ringkas || {}).hari_efektif || 0;

    r = await req('/api/kalender-akademik/save', { method: 'POST', body: { tanggal: TODAY, kategori: 'libur', judul: 'Libur Uji', nonaktif: 1 } });
    ok('tanggal libur disimpan', r.status === 200 && r.body.jumlah === 1, r.body?.error);
    r = await req('/api/kalender-akademik/save', {
      method: 'POST',
      body: { dari: TODAY, sampai: TODAY, kategori: 'ujian', judul: 'PAS Uji', nonaktif: 1 }
    });
    ok('tanggal yang sama diperbarui (bukan duplikat)', r.status === 200 && r.body.jumlah === 1);
    r = await req('/api/kalender-akademik');
    const kalHariIni = (r.body.rows || []).filter(x => x.tanggal === TODAY);
    ok('hanya satu baris per tanggal', kalHariIni.length === 1, String(kalHariIni.length));
    ok('kategori berubah menjadi ujian', kalHariIni[0] && kalHariIni[0].kategori === 'ujian');
    ok('statistik ujian bertambah', Number(r.body.ringkas.ujian) >= 1, JSON.stringify(r.body.ringkas));
    ok('hari efektif berkurang', Number(r.body.ringkas.hari_efektif) < efektifAwal,
      `${efektifAwal} → ${r.body.ringkas.hari_efektif}`);

    /* SINKRONISASI: tanggal libur/ujian → absensi ditutup */
    r = await req('/api/absensi-guru?tanggal=' + TODAY);
    ok('absensi guru menandai KBM libur', r.body.kbm_libur === true, JSON.stringify(r.body.kalender));
    ok('info kalender dikirim ke halaman absensi', !!r.body.kalender && r.body.kalender.kategori === 'ujian', JSON.stringify(r.body.kalender));
    const slotUji = (r.body.jadwal || []).find(x => Number(x.id) === Number(s1));
    ok('slot jadwal reguler menjadi TIDAK AKTIF pada tanggal itu',
      !!slotUji && slotUji.window.aktif === false && /KBM tidak berlaku/i.test(slotUji.window.alasan || ''),
      JSON.stringify(slotUji && slotUji.window));

    await login('guru', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: s1, tanggal: TODAY, status: 'hadir' } });
    ok('check-in pada hari libur/ujian DITOLAK server', r.status === 403, `${r.status} ${r.body?.error || ''}`);
    ok('alasan penolakan menyebut kalender akademik', /KBM tidak berlaku/i.test(r.body?.error || ''), r.body?.error);

    await login('admin', 'admin123');
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: s1, tanggal: TODAY } });
    ok('sesi presensi siswa tidak dibuka pada hari libur/ujian', r.status === 403, `${r.status} ${r.body?.error || ''}`);

    r = await req('/api/absensi-guru/jadwal-mengajar?hari=7');
    ok('agenda jadwal guru tetap tampil (hanya dikunci)', r.status === 200 && Array.isArray(r.body.hari), r.body?.error);

    /* hapus tanda kalender → absensi kembali normal */
    r = await req('/api/kalender-akademik');
    const idUjian = (r.body.rows || []).find(x => x.tanggal === TODAY).id;
    r = await req('/api/kalender-akademik/delete', { method: 'POST', body: { id: idUjian } });
    ok('tanggal kalender dapat dihapus', r.status === 200 && r.body.jumlah === 1, r.body?.error);
    r = await req('/api/absensi-guru?tanggal=' + TODAY);
    ok('setelah dihapus, KBM berlaku kembali', r.body.kbm_libur === false, JSON.stringify(r.body.kalender));
    /* massal: satu hari tertentu dalam sebulan (mis. semua Sabtu) */
    const dariBulan = `${BULAN_INI}-01`;
    const sampaiBulan = `${BULAN_INI}-28`;
    const hariMassal = (HARI + 3) % 7;                 // BUKAN hari ini agar tidak menimpa uji di atas
    r = await req('/api/kalender-akademik/save', {
      method: 'POST', body: { dari: dariBulan, sampai: sampaiBulan, kategori: 'kegiatan', judul: 'Uji Massal', nonaktif: 0, hari: [hariMassal] }
    });
    ok('penandaan massal berhasil (satu hari tertentu)', r.status === 200 && r.body.jumlah >= 1, JSON.stringify(r.body));
    const semuaHariBenar = (r.body.tanggal || []).every(t => new Date(t + 'T00:00:00').getDay() === hariMassal);
    ok('filter hari pada penandaan massal bekerja', semuaHariBenar, JSON.stringify(r.body.tanggal));
    r = await req('/api/kalender-akademik');
    const kegiatan = (r.body.rows || []).filter(x => x.kategori === 'kegiatan');
    ok('baris massal tersimpan dengan nonaktif=0 (KBM tetap)', kegiatan.length >= 1 && kegiatan.every(x => Number(x.nonaktif) === 0),
      JSON.stringify(kegiatan.slice(0, 3).map(x => ({ t: x.tanggal, n: x.nonaktif }))));
    r = await req('/api/kalender-akademik/delete', { method: 'POST', body: { dari: dariBulan, sampai: sampaiBulan } });
    ok('hapus massal per rentang bekerja', r.status === 200 && r.body.jumlah >= 1, JSON.stringify(r.body));
    r = await req('/api/kalender-akademik/delete', { method: 'POST', body: { id: 999999 } });
    ok('hapus id tidak ada → 404', r.status === 404, r.status);

    /* RBAC: guru biasa tidak boleh mengubah kalender / target */
    await login('guru', 'guru123');
    r = await req('/api/kalender-akademik/save', { method: 'POST', body: { tanggal: TODAY, kategori: 'libur' } });
    ok('guru tidak boleh menandai kalender (403)', r.status === 403, r.status);
    r = await req('/api/jadwal/guru-target', { method: 'POST', body: { items: [{ guru_id: gA.id, target_minggu: 9 }] } });
    ok('guru tidak boleh mengubah target jam guru (403)', r.status === 403, r.status);
    await login('admin', 'admin123');

    /* ============ 4. KOP SERAGAM + PDF/WORD ============ */
    console.log('\n== 4. KOP SURAT & TOMBOL PDF/WORD ==');
    /* isi satu catatan layanan BK + satu aduan agar laporan punya data */
    r = await req('/api/bk/layanan');
    const jenisBK = ((r.body.jenis || [])[0] || {}).id;
    const siswaDemo = ((await req('/api/siswa?limit=2')).body.rows || []);
    r = await req('/api/bk/layanan/save', {
      method: 'POST',
      body: {
        jenis_id: jenisBK, tanggal: TODAY, topik: 'Uji Laporan Layanan',
        kelas_ids: [siswaDemo[0]?.kelas_id].filter(Boolean), siswa_ids: [siswaDemo[0]?.id].filter(Boolean),
        tujuan: 'Memastikan cetak rapi', uraian: 'Uraian uji', hasil: 'Hasil uji', tindak_lanjut: 'Pantau'
      }
    });
    ok('catatan layanan BK uji dibuat', r.status === 200, r.body?.error);
    const idLayanan = r.body.id;

    const kopCheck = (html, label) => {
      const hasKop = html.includes('class="kop"');
      const hasFlex = /\.kop \{[^}]*display:\s*flex/.test(html);
      const hasDouble = /border-bottom:\s*3px double/.test(html);
      ok(`cetakan ${label}: kop tampil`, hasKop, 'tanpa blok kop');
      ok(`cetakan ${label}: CSS kop seragam (flex + garis ganda)`, hasFlex && hasDouble,
        `flex=${hasFlex} double=${hasDouble}`);
    };
    r = await req('/api/rekap/absensi-guru/cetak?periode=bulanan');
    kopCheck(String(r.body), 'Rekap Absensi Guru');
    r = await req('/api/rekap/absensi-siswa/cetak?periode=bulanan&mode=kelas');
    kopCheck(String(r.body), 'Rekap Absensi Siswa');
    const kelasUji = siswaDemo[0]?.kelas_id;
    r = await req('/api/rekap-bulanan/cetak?bulan=' + BULAN_INI + (kelasUji ? '&kelas=' + kelasUji : ''));
    kopCheck(String(r.body), 'Rekapitulasi Bulanan Kelas');
    r = await req('/api/asesmen/cetak?kode=akpd');
    kopCheck(String(r.body), 'Asesmen Siswa BK');

    r = await req('/api/bk/layanan/cetak');
    ok('Program Layanan BK: cetak PDF tersedia', r.status === 200 && String(r.body).includes('Laporan Program Layanan'), r.status);
    kopCheck(String(r.body), 'Daftar Layanan BK');
    r = await req('/api/bk/layanan/word');
    ok('Program Layanan BK: ekspor Word tersedia', r.status === 200 && String(r.ct).includes('msword'), r.ct);
    ok('Word layanan BK memuat kop resmi (tabel kop + garis ganda)',
      String(r.body).includes('class="kopw"') && String(r.body).includes('kopw-garis'), 'tanpa kop Word');
    ok('Word layanan BK memuat baris yayasan dari pengaturan kop',
      /YAYASAN|PERSATUAN GURU|SEKOLAH/i.test(String(r.body)), 'teks kop tidak terdeteksi');
    r = await req('/api/bk/layanan/' + idLayanan + '/word');
    ok('Word satu catatan layanan tersedia', r.status === 200 && String(r.ct).includes('msword'), r.status);

    /* aduan: buat akun guru BK uji, lalu kirim aduan lewat kanal publik */
    await req('/api/users/save', {
      method: 'POST', body: { nama: 'Guru BK Uji', username: 'gurubkuji', password: 'guru123', role: 'guru_bk' }
    });
    const bkUser = { username: 'gurubkuji' };
    if (bkUser) {
      await login(bkUser.username, 'guru123');
      r = await req('/api/aduan');
      ok('kanal aduan guru BK tersedia', r.status === 200 && !!r.body.link?.token, r.body?.error);
      const token = r.body.link.token;
      if (token && siswaDemo[0]) {
        const dobResp = await req('/api/public/aduan/' + token + '/siswa?q=' + encodeURIComponent(siswaDemo[0].nama));
        const kandidat = (dobResp.body.rows || [])[0];
        ok('daftar siswa kanal aduan publik tersedia', !!kandidat, JSON.stringify(dobResp.body).slice(0, 120));
        /* tanggal lahir tidak dikirim ke publik → dibaca langsung dari database uji */
        const DBL = require('better-sqlite3');
        const rawDb = new DBL(DB, { readonly: true, fileMustExist: true });
        const dob = kandidat ? (rawDb.prepare('SELECT tanggal_lahir FROM siswa WHERE id=?').get(Number(kandidat.id)) || {}).tanggal_lahir : '';
        rawDb.close();
        if (kandidat) {
          cookie = '';
          r = await req('/api/public/aduan/' + token, {
            method: 'POST',
            body: {
              siswa_id: kandidat.id, nama: kandidat.nama,
              tanggal_lahir: dob || '2007-01-10',
              jenis: 'Kekerasan verbal / perundungan', lokasi: 'Kantin',
              kronologi: 'Uji laporan aduan: ejekan berulang di kantin.'
            }
          });
          ok('aduan publik terkirim', r.status === 200, JSON.stringify(r.body).slice(0, 160));
        }
      }
      await login(bkUser.username, 'guru123');
      r = await req('/api/aduan/cetak');
      ok('Kanal Aduan: cetak PDF tersedia', r.status === 200 && String(r.body).includes('Kanal Aduan Kekerasan'), r.status);
      kopCheck(String(r.body), 'Kanal Aduan Kekerasan');
      r = await req('/api/aduan/word');
      ok('Kanal Aduan: ekspor Word tersedia', r.status === 200 && String(r.ct).includes('msword'), r.ct);
      ok('Word aduan memakai kop resmi', String(r.body).includes('class="kopw"'), 'tanpa kop Word');
      ok('Word aduan memuat bagian tindak lanjut', /Tindak Lanjut/i.test(String(r.body)));
    } else {
      ok('akun guru_bk tersedia untuk uji aduan', false, 'tidak ada akun guru_bk');
    }

    await login('admin', 'admin123');
    r = await req('/api/tindak-lanjut/cetak');
    ok('Tindak Lanjut: cetak PDF tersedia', r.status === 200, r.status);
    kopCheck(String(r.body), 'Tindak Lanjut');
    r = await req('/api/tindak-lanjut/word');
    ok('Tindak Lanjut: ekspor Word tersedia', r.status === 200 && String(r.ct).includes('msword'), r.ct);

    /* Word rekap bulanan ikut memakai kop resmi */
    r = await req('/api/rekap-bulanan/word?bulan=' + BULAN_INI + (kelasUji ? '&kelas=' + kelasUji : ''));
    ok('Word rekap bulanan memakai kop resmi', String(r.body).includes('class="kopw"'), 'tanpa kop Word');
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
  }

  console.log(`\n=== HASIL KURIKULUM: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
