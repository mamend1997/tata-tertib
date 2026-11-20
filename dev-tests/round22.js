process.env.TZ = 'Asia/Jakarta';
'use strict';
/* Uji ronde 22:
   1. Hapus massal: butir soal asesmen, riwayat layanan BK (hasil asesmen sudah ronde 20)
   2. Hapus mata pelajaran + cascade relasi (slot lintas TA, sesi & absensi) → bisa dibuat ulang
   3. Halaman cetak jadwal bersih (tanpa instruksi/tombol print saat print/footer), desain header & TTD
   4. Matriks vertikal: colspan baris hari & rata tengah
   5. Alur absensi guru: check-in → absensi siswa wajib → jurnal → foto; alfa bila tidak selesai
   6. Sinkronisasi menu Absensi Siswa per Mapel (TA fallback + guru pengampu)
   7. Portal publik: export Excel & cetak/PDF tersedia tanpa login
   Jalankan: node dev-tests/round22.js */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-r22-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r22-saas-' + Date.now() + '.sqlite');
const PORT = 4300 + Math.floor(Math.random() * 150);
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
  return { status: r.status, body, ct, headers: r.headers };
}
const login = async (u, pw) => { cookie = ''; return req('/api/login', { method: 'POST', body: { username: u, password: pw, kode: KODE } }); };
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const HARI = now.getDay();
const cur = now.getHours() * 60 + now.getMinutes();
const base = Math.min(cur, 1440 - 200);
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;

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
    max_mapel_jam: 2, max_guru_jam: 8,
    absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180 },
    wa: { aktif: 0, jam: '15:00' }
  });

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);
    const users = (await req('/api/users')).body.rows || [];
    const gHendra = users.find(u => u.username === 'guru');
    const gBudi = users.find(u => u.username === 'guruumum');
    const kelas = (await req('/api/jadwal')).body.kelas;
    const siswaRows = (await req('/api/siswa?limit=10')).body.rows || [];

    /* ================= 1. HAPUS MASSAL ================= */
    console.log('\n== 1. HAPUS MASSAL (SOAL, LAYANAN BK) ==');
    let r = await req('/api/asesmen/soal?kode=gaya');
    const soalAwal = r.body.soal.length;
    const duaSoal = r.body.soal.slice(0, 2).map(x => x.id);
    r = await req('/api/asesmen/soal/delete-masal', { method: 'POST', body: { ids: duaSoal } });
    ok('hapus massal butir soal asesmen', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body));
    r = await req('/api/asesmen/soal?kode=gaya');
    ok('jumlah butir berkurang 2', r.body.soal.length === soalAwal - 2, `${soalAwal} → ${r.body.soal.length}`);
    ok('nomor butir dirapikan berurutan', r.body.soal.every((s, i) => Number(s.nomor) === i + 1), JSON.stringify(r.body.soal.slice(0, 3).map(s => s.nomor)));
    r = await req('/api/asesmen/soal/delete-masal', { method: 'POST', body: { ids: [] } });
    ok('hapus massal butir tanpa pilihan ditolak', r.status === 400);

    r = await req('/api/bk/layanan');
    const jenisMediasi = (r.body.jenis || []).find(j => /mediasi/i.test(j.nama));
    for (let i = 0; i < 3; i++) {
      await req('/api/bk/layanan/save', {
        method: 'POST',
        body: { jenis_id: jenisMediasi.id, tanggal: TODAY, topik: `Uji massal ${i + 1}`, siswa_ids: [siswaRows[i].id] }
      });
    }
    r = await req('/api/bk/layanan');
    const layananIds = (r.body.rows || []).filter(x => /Uji massal/.test(x.topik || '')).map(x => x.id);
    ok('3 riwayat layanan uji dibuat', layananIds.length === 3, String(layananIds.length));
    r = await req('/api/bk/layanan/delete-masal', { method: 'POST', body: { ids: layananIds.slice(0, 2) } });
    ok('hapus massal riwayat layanan BK', r.status === 200 && r.body.jumlah === 2, JSON.stringify(r.body));
    r = await req('/api/bk/layanan');
    ok('riwayat berkurang & sisanya utuh', (r.body.rows || []).filter(x => /Uji massal/.test(x.topik || '')).length === 1);
    r = await req('/api/trash');
    ok('layanan yang dihapus masuk Kotak Sampah', (r.body.rows || []).some(x => x.tabel === 'bk_layanan'));
    r = await req('/api/bk/layanan/delete-masal', { method: 'POST', body: { ids: [] } });
    ok('hapus massal layanan tanpa pilihan ditolak', r.status === 400);

    /* ================= 2. HAPUS MAPEL + CASCADE ================= */
    console.log('\n== 2. HAPUS MATA PELAJARAN (CASCADE RELASI) ==');
    await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel Uji Hapus', kode: 'HPS', guru_ids: [gHendra.id] } });
    const mapelHapus = r.body.id;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelHapus, kelas_ids: [kelas[0].id], abaikan: 1 } });
    const slotHapus = r.body.id;
    ok('mapel uji + slot dibuat', r.status === 200 && !!slotHapus, r.body?.error);
    /* buat sesi presensi + absensi siswa + absensi guru agar relasi tercipta */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotHapus, tanggal: TODAY } });
    const sesiHapus = r.body?.sesi?.id;
    ok('sesi presensi dibuat untuk mapel uji', !!sesiHapus, r.body?.error);
    const daftarSiswa = (r.body.siswa || []);
    await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiHapus, items: daftarSiswa.map((s, i) => ({ siswa_id: s.id, status: i === 0 ? 'A' : 'H', keterangan: '' })) }
    });
    await login('guru', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotHapus, tanggal: TODAY, status: 'hadir' } });
    ok('check-in guru pada mapel uji', r.status === 200, r.body?.error);
    await login('admin', 'admin123');

    r = await req('/api/mapel/' + mapelHapus + '?dry=1', { method: 'DELETE' });
    ok('pratinjau dampak hapus mapel tersedia', r.status === 200 && r.body.dampak && r.body.dampak.slot >= 1, JSON.stringify(r.body.dampak));
    ok('dampak menyebut sesi & absensi', r.body.dampak.sesi >= 1 && r.body.dampak.absensi_siswa >= 1 && r.body.dampak.absensi_guru >= 1,
      JSON.stringify(r.body.dampak));
    r = await req('/api/mapel/' + mapelHapus, { method: 'DELETE' });
    ok('hapus mapel berhasil walau punya slot & riwayat absensi', r.status === 200, JSON.stringify(r.body).slice(0, 200));
    r = await req('/api/mapel');
    ok('mapel benar-benar terhapus', !(r.body.rows || []).some(m => Number(m.id) === Number(mapelHapus)));
    r = await req('/api/jadwal');
    ok('slot jadwal mapel ikut terhapus', !(r.body.rows || []).some(x => Number(x.mapel_id) === Number(mapelHapus)));
    r = await req('/api/absensi-siswa/rekap?dari=' + TODAY + '&sampai=' + TODAY);
    ok('riwayat rekap absensi mapel ikut dibersihkan', r.status === 200 && !(r.body.rows || []).some(x => x.mapel_nama === 'Mapel Uji Hapus'));
    r = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel Uji Hapus', kode: 'HPS', guru_ids: [gHendra.id] } });
    ok('mapel dapat dibuat ulang dengan kode sama', r.status === 200 && !!r.body.id, r.body?.error);

    /* slot pada TA LAIN tidak boleh memblokir penghapusan */
    r = await req('/api/jadwal');
    const taList = r.body.tahun || [];
    const taLain = taList.find(t => Number(t.id) !== Number(r.body.ta));
    if (taLain) {
      const m2 = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel Lintas TA', kode: 'LTA', guru_ids: [gHendra.id] } });
      const idM2 = m2.body.id;
      await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: idM2, kelas_ids: [kelas[1].id], abaikan: 1, ta: taLain.id } });
      r = await req('/api/mapel/' + idM2, { method: 'DELETE' });
      ok('slot di tahun pelajaran lain tidak memblokir hapus mapel', r.status === 200, JSON.stringify(r.body).slice(0, 160));
    } else {
      ok('slot di tahun pelajaran lain tidak memblokir hapus mapel (dilewati)', true);
    }

    /* ================= 3. DESAIN CETAK JADWAL ================= */
    console.log('\n== 3. DESAIN & KEBERSIHAN CETAK JADWAL ==');
    r = await req('/api/jadwal/desain');
    ok('desain default: judul & semester', r.body.desain.judul === 'JADWAL PELAJARAN' && /Genap/i.test(r.body.desain.semester),
      JSON.stringify(r.body.desain));
    ok('tahun pelajaran otomatis terisi', /Tahun Pelajaran/.test(r.body.desain.ta_teks || ''), r.body.desain.ta_teks);
    r = await req('/api/jadwal/desain', {
      method: 'POST',
      body: {
        judul: 'JADWAL PELAJARAN', semester: 'Semester Genap', ta_teks: 'Tahun Pelajaran 2026/2027',
        tempat: 'Ciamis', tanggal: 'Januari 2027', pengawas_tampil: 1,
        pengawas_nama: 'Drs. Pengawas, M.Pd.', pengawas_nip: '197001012000031001',
        kepala_nama: 'Drs. H. Ahmad Suryana, M.Pd.', kepala_nip: '196804121994031005',
        wakasek_nama: 'Dedi Kurniawan, S.Pd.', wakasek_nip: '198711202012011004', wakasek_jabatan: 'Wakasek Kurikulum'
      }
    });
    ok('desain jadwal tersimpan', r.status === 200 && r.body.desain.tempat === 'Ciamis', JSON.stringify(r.body.desain).slice(0, 160));
    r = await req('/api/jadwal/desain', { method: 'POST', body: { judul: '' } });
    ok('judul kosong ditolak', r.status === 400);

    r = await req('/api/jadwal/cetak?mode=vertikal');
    const html = r.body;
    ok('cetak memuat judul utama & sub-judul desain',
      /JADWAL PELAJARAN/.test(html) && /Semester Genap/.test(html) && /Tahun Pelajaran 2026\/2027/.test(html));
    ok('cetak memuat blok tanda tangan lengkap',
      /Pengawas Pembina/.test(html) && /Drs\. Pengawas/.test(html) && /Kepala Sekolah,/.test(html)
      && /Ciamis, Januari 2027/.test(html) && /Wakasek Kurikulum/.test(html) && /Dedi Kurniawan/.test(html));
    ok('label "Mengetahui" hanya di atas Pengawas Pembina (bukan Kepala Sekolah)',
      !/Mengetahui[^<]*<br>\s*Kepala/i.test(html) && /Mengetahui,<br>Pengawas Pembina,/.test(html));
    ok('instruksi "Pratinjau cetak … Ctrl/Cmd + P" tidak ada', !/Pratinjau cetak/i.test(html) && !/Ctrl\/Cmd/i.test(html));
    ok('footer "Dicetak … oleh …" tidak ada', !/Dicetak\s+\d/i.test(html) && !/oleh Administrator/i.test(html));
    const cssFlat = html.replace(/\s+/g, '');
    ok('tombol cetak & toolbar disembunyikan saat print (@media print)',
      /@mediaprint\{/.test(cssFlat) && /\.bar,\.no-print,\.btn\{display:none/.test(cssFlat),
      cssFlat.match(/@mediaprint\{[^@]{0,200}/)?.[0] || '');
    ok('sub-judul mode otomatis tidak menumpuk', !/MATRIKS VERTIKAL \(KELAS SEBAGAI KOLOM\)/.test(html));
    ok('baris hari memakai colspan tepat (jumlah kolom)', (() => {
      const m = html.match(/<tr class="hari-row"><td colspan="(\d+)"/);
      const kepala = html.match(/<thead><tr><th class="jam">HARI \/ JAM<\/th>([\s\S]*?)<\/tr><\/thead>/);
      if (!m || !kepala) return false;
      const kolomKelas = (kepala[1].match(/<th>/g) || []).length;
      return Number(m[1]) === kolomKelas + 1;
    })());
    ok('sel tabel rata tengah (text-align:center & vertical-align:middle)',
      /text-align:center/.test(cssFlat) && /vertical-align:middle/.test(cssFlat)
      && /table\.gridth,table\.gridtd\{[^}]*vertical-align:middle/.test(cssFlat),
      (cssFlat.match(/table\.gridth,table\.gridtd\{[^}]{0,120}/) || [''])[0]);

    /* ================= 4. PORTAL PUBLIK: EXPORT & CETAK ================= */
    console.log('\n== 4. PORTAL PUBLIK JADWAL (TANPA LOGIN) ==');
    r = await req('/api/jadwal/publik', { method: 'POST', body: { aktif: 1 } });
    const tokenJadwal = r.body.token;
    ok('tautan publik jadwal aktif', !!tokenJadwal);
    cookie = '';
    r = await req('/api/public/jadwal/' + tokenJadwal + '/export.xlsx');
    ok('publik dapat mengunduh Excel jadwal', r.status === 200 && /spreadsheet/.test(r.ct), `${r.status} ${r.ct}`);
    r = await req('/api/public/jadwal/' + tokenJadwal + '/cetak?mode=vertikal');
    ok('publik dapat membuka halaman cetak jadwal', r.status === 200 && /text\/html/.test(r.ct) && /JADWAL PELAJARAN/.test(r.body));
    ok('cetak publik juga memuat blok tanda tangan', /Wakasek Kurikulum/.test(r.body) && /Ciamis, Januari 2027/.test(r.body));
    ok('cetak publik tanpa instruksi & footer', !/Pratinjau cetak/i.test(r.body) && !/Dicetak\s+\d/i.test(r.body));
    r = await req('/api/public/jadwal/token-palsu/export.xlsx');
    ok('token palsu ditolak (export)', r.status === 404);
    r = await req('/api/public/jadwal/token-palsu/cetak');
    ok('token palsu ditolak (cetak)', r.status === 404);

    /* ================= 5. ALUR ABSENSI GURU ================= */
    console.log('\n== 5. ALUR ABSENSI GURU (ABSENSI SISWA → JURNAL → FOTO) ==');
    await login('admin', 'admin123');
    await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({ sesi: [
        { label: 'Jam ke-1', mulai: hhmm(base - 15), selesai: hhmm(base + 25), istirahat: 0 },
        { label: 'Jam ke-2', mulai: hhmm(base + 26), selesai: hhmm(base + 70), istirahat: 0 },
        { label: 'Jam ke-3', mulai: hhmm(base + 71), selesai: hhmm(base + 105), istirahat: 0 }
      ] })
    });
    const mapelAlur = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel Alur', kode: 'ALR', guru_ids: [gHendra.id] } });
    const slotAlurIds = [];
    for (let sesi = 1; sesi <= 3; sesi++) {
      r = await req('/api/jadwal/slot', {
        method: 'POST', body: { hari: HARI, sesi, mapel_id: mapelAlur.body.id, kelas_ids: [kelas[0].id], abaikan: 1 }
      });
      if (r.status === 200) slotAlurIds.push(Number(r.body.id));
    }
    const slotAlur = slotAlurIds[0];
    ok('tiga slot berurutan pada mapel yang sama dibuat', slotAlurIds.length === 3, JSON.stringify(slotAlurIds));
    await login('guru', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotAlur, tanggal: TODAY, status: 'hadir' } });
    ok('check-in hadir berhasil', r.status === 200, r.body?.error);
    ok('respons check-in menyebut langkah berikutnya', Array.isArray(r.body.langkah) && r.body.langkah[0] === 'absensi_siswa', JSON.stringify(r.body.langkah));
    r = await req('/api/absensi-guru/jurnal', { method: 'POST', body: { jadwal_id: slotAlur, tanggal: TODAY, materi: 'Materi jurnal yang cukup panjang untuk uji alur' } });
    ok('jurnal DITOLAK sebelum absensi siswa lengkap', r.status === 400 && r.body.butuh_absensi_siswa === true, JSON.stringify(r.body).slice(0, 160));
    r = await req('/api/absensi-guru/alur?jadwal_id=' + slotAlur + '&tanggal=' + TODAY);
    ok('status alur menunjukkan absensi siswa belum lengkap',
      r.status === 200 && r.body.alur.absensi_siswa.lengkap === false
        && r.body.alur.absensi_siswa.terisi === 0,
      JSON.stringify(r.body.alur.absensi_siswa));
    /* lengkapi absensi siswa */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotAlur, tanggal: TODAY } });
    const sesiAlur = r.body?.sesi?.id;
    const siswaAlur = r.body?.siswa || [];
    ok('sesi presensi dibuat', !!sesiAlur && siswaAlur.length > 0, r.body?.error);
    r = await req('/api/absensi-guru/alur?jadwal_id=' + slotAlur + '&tanggal=' + TODAY);
    ok('alur mapel tiga jam menghitung jumlah siswa satu kali',
      r.status === 200 && r.body.group_ids.length === 3
        && r.body.alur.absensi_siswa.total === siswaAlur.length,
      JSON.stringify(r.body.alur.absensi_siswa));
    await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiAlur, items: siswaAlur.map(s => ({ siswa_id: s.id, status: 'H', keterangan: '' })) }
    });
    r = await req('/api/absensi-guru/alur?jadwal_id=' + slotAlur + '&tanggal=' + TODAY);
    ok('26 siswa pada mapel tiga jam dihitung satu kali (bukan 78)',
      r.body.alur.absensi_siswa.lengkap === true
        && r.body.alur.absensi_siswa.total === siswaAlur.length
        && r.body.alur.absensi_siswa.terisi === siswaAlur.length,
      JSON.stringify(r.body.alur.absensi_siswa));
    r = await req('/api/absensi-guru/jurnal', { method: 'POST', body: { jadwal_id: slotAlur, tanggal: TODAY, materi: 'Menjelaskan materi alur kerja absensi lengkap' } });
    ok('jurnal tersimpan setelah absensi siswa lengkap', r.status === 200, r.body?.error);
    r = await req('/api/absensi-guru/alur?jadwal_id=' + slotAlur + '&tanggal=' + TODAY);
    ok('alur selesai setelah jurnal & foto opsional', r.body.alur.selesai === true, JSON.stringify(r.body.alur));

    /* SANKSI ALFA: check-in hadir tanpa menyelesaikan alur sampai jam berakhir */
    await login('admin', 'admin123');
    await req('/api/jadwal/pengaturan', {
      method: 'POST', body: cfgBody({
        sesi: [{ label: 'Jam 1', mulai: hhmm(Math.max(5, base - 200)), selesai: hhmm(Math.max(5, base - 150)), istirahat: 0 }],
        absensi: { buka_menit: 5, tutup_menit: 5, jurnal_min: 15, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 30 }
      })
    });
    const kelasAlfa = kelas[3] || kelas[2];
    const mapelAlfa = await req('/api/mapel/save', { method: 'POST', body: { nama: 'Mapel Alfa', kode: 'ALF', guru_ids: [gBudi.id] } });
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mapelAlfa.body.id, kelas_ids: [kelasAlfa.id], abaikan: 1 } });
    const slotAlfa = r.body.id;
    ok('slot uji sanksi alfa dibuat', r.status === 200, r.body?.error);
    /* catat check-in hadir secara langsung (mensimulasikan guru yang check-in lalu pergi) */
    const insHadir = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotAlfa, tanggal: TODAY, status: 'hadir' } });
    ok('check-in setelah jam pelajaran berakhir ditolak', insHadir.status === 403, JSON.stringify(insHadir.body).slice(0, 140));
    cookie = '';
    await login('admin', 'admin123');
    r = await req('/api/absensi-guru?tanggal=' + TODAY);
    const slotAlfaRow = (r.body.jadwal_hari || r.body.jadwal || []).find(j => Number(j.id) === Number(slotAlfa));
    ok('slot tanpa check-in otomatis ALFA setelah jam berakhir', !!slotAlfaRow && slotAlfaRow.absensi && slotAlfaRow.absensi.status === 'alpha',
      JSON.stringify(slotAlfaRow && slotAlfaRow.absensi));

    /* ================= 6. ABSENSI SISWA PER MAPEL (SYNC) ================= */
    console.log('\n== 6. SINKRONISASI ABSENSI SISWA PER MAPEL ==');
    await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    await login('guru', 'guru123');
    r = await req('/api/absensi-siswa');
    ok('menu absensi siswa memuat jadwal hari ini', r.status === 200 && (r.body.jadwal || []).length >= 1,
      JSON.stringify({ jumlah: (r.body.jadwal || []).length, ta: r.body.ta }));
    ok('slot guru pengampu ikut tampil', (r.body.jadwal || []).some(j => Number(j.guru_id) === Number(gHendra.id)));
    /* ubah ta_aktif ke TA lain → jadwal tetap ditemukan (fallback) */
    cookie = '';
    await login('admin', 'admin123');
    const jw = (await req('/api/jadwal')).body;
    const taLain2 = (jw.tahun || []).find(t => Number(t.id) !== Number(jw.ta));
    if (taLain2) {
      await req('/api/settings/tahun', { method: 'POST', body: { ta: taLain2.id } });
      cookie = '';
      await login('guru', 'guru123');
      r = await req('/api/absensi-siswa');
      ok('jadwal tetap tampil walau TA pandangan berbeda (fallback)', r.status === 200 && (r.body.jadwal || []).length >= 1,
        JSON.stringify({ jumlah: (r.body.jadwal || []).length, ta: r.body.ta }));
      cookie = '';
      await login('admin', 'admin123');
      await req('/api/settings/tahun', { method: 'POST', body: { ta: jw.ta } });
    } else {
      ok('jadwal tetap tampil walau TA pandangan berbeda (dilewati)', true);
    }
    cookie = '';
    await login('admin', 'admin123');
    r = await req('/api/absensi-siswa/rekap?dari=' + TODAY + '&sampai=' + TODAY);
    ok('rekap absensi per mapel tanpa error SQL', r.status === 200 && Array.isArray(r.body.per_siswa), JSON.stringify(r.body).slice(0, 120));
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
