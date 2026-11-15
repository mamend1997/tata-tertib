'use strict';
/* Uji (tata-tertib) — ronde 28:
   1. Dashboard Monitoring KBM real-time (kelas aktif, guru berhalangan /
      pengganti, persentase jurnal mengajar, rekap per kelas, kalender libur)
   2. Duplikat slot jadwal (sesi berikutnya, hari/sesi manual, validasi bentrok)
   3. Matriks jadwal dinamis per hari: sesi khusus per hari, label sesi + jam,
      tinggi kartu proporsional durasi
   4. Kalender akademik: ekspor PDF/Excel/Word (kop + 3 tanda tangan +
      dipisah per semester), rentang semester, warna kategori & per tanggal
   Jalankan: node dev-tests/monitor.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-mon-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-mon-saas-' + Date.now() + '.sqlite');
const PORT = 5200 + Math.floor(Math.random() * 200);
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
const HARI_LAIN = (HARI + 1) % 7;
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
const cur = wib.getHours() * 60 + wib.getMinutes();
/* sesi 1 SEDANG BERJALAN (mulai 10 menit lalu, selesai 35 menit lagi),
   sesi 2 & 3 menyusul pada hari yang sama. */
const S1_MULAI = Math.max(1, Math.min(cur - 10, 1400));
const S1_SELESAI = Math.min(1439, S1_MULAI + 45);

const BULAN = TODAY.slice(0, 7);

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

    /* ---------------- pengaturan jadwal ---------------- */
    let r = await req('/api/jadwal/pengaturan', {
      method: 'POST',
      body: {
        hari: [HARI, HARI_LAIN], max_jam: 8,
        sesi: [
          { label: 'Pembiasaan', mulai: hhmm(S1_MULAI), selesai: hhmm(S1_MULAI + 15), istirahat: 0 },
          { label: 'Jam ke-2', mulai: hhmm(S1_MULAI + 16), selesai: hhmm(S1_MULAI + 61), istirahat: 0 },
          { label: 'Jam ke-3', mulai: hhmm(S1_MULAI + 62), selesai: hhmm(S1_MULAI + 107), istirahat: 0 }
        ],
        max_mapel_jam: 3, max_guru_jam: 8,
        absensi: { buka_menit: 30, tutup_menit: 60, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, siswa_tutup_menit: 180, auto_alpha: 1 },
        target_jam: { aktif: 1, minggu: 3 }
      }
    });
    ok('pengaturan jadwal 3 sesi disimpan', r.status === 200, r.body?.error);

    const users = (await req('/api/users')).body.rows || [];
    const gA = users.find(u => u.username === 'guru');
    const gB = users.find(u => u.username === 'guruumum');
    const kelas = (await req('/api/jadwal')).body.kelas || [];
    ok('2 guru & 2 kelas tersedia', !!gA && !!gB && kelas.length >= 2);

    const mapelId = async (nama, kode, guruId) => (await req('/api/mapel/save', {
      method: 'POST', body: { nama, kode, guru_ids: [guruId] }
    })).body.id;
    const m1 = await mapelId('Matematika Monitor', 'MTKM', gA.id);
    const m2 = await mapelId('Bahasa Monitor', 'BINM', gB.id);
    const slotBaru = async (sesi, mapel, guru, kelasId) => (await req('/api/jadwal/slot', {
      method: 'POST', body: { hari: HARI, sesi, mapel_id: mapel, guru_id: guru, kelas_ids: [kelasId], abaikan: 1, ruang: 'R-1' }
    })).body.id;
    const sA = await slotBaru(1, m1, gA.id, kelas[0].id);
    const sB = await slotBaru(2, m2, gB.id, kelas[0].id);
    const sC = await slotBaru(3, m1, gA.id, kelas[1].id);
    ok('tiga slot jadwal dibuat', !!sA && !!sB && !!sC);

    /* ============ 1. DUPLIKAT SLOT ============ */
    console.log('\n== 1. DUPLIKAT SLOT JADWAL ==');
    r = await req('/api/jadwal/duplikat', { method: 'POST', body: { id: sC } });
    ok('duplikat tanpa sesi → memakai sesi berikutnya yang tersedia', r.status === 400 || r.status === 200,
      `${r.status} ${r.body?.error || ''}`);
    /* sC ada di sesi 3 (terakhir) → tidak ada sesi berikutnya */
    ok('slot di sesi terakhir ditolak dengan pesan jelas', r.status === 400 && /sesi berikutnya/i.test(r.body?.error || ''),
      r.body?.error);
    /* duplikat ke hari lain (sesi 1) */
    r = await req('/api/jadwal/duplikat', { method: 'POST', body: { id: sA, hari: HARI_LAIN, sesi: 1 } });
    ok('duplikat ke hari lain berhasil', r.status === 200, r.body?.error);
    const idDup = r.body?.id;
    ok('respons menyebut hari & jam tujuan', /sesi 1/i.test(r.body?.pesan || ''), r.body?.pesan);
    r = await req('/api/jadwal');
    const dup = (r.body.rows || []).find(x => Number(x.id) === Number(idDup));
    ok('slot hasil duplikat menyimpan mapel & guru yang sama',
      !!dup && Number(dup.mapel_id) === Number(m1) && Number(dup.guru_id) === Number(gA.id) && Number(dup.hari) === HARI_LAIN,
      JSON.stringify(dup && { m: dup.mapel_id, g: dup.guru_id, h: dup.hari }));
    ok('slot hasil duplikat menyimpan kelas & ruang',
      !!dup && dup.kelas_ids.includes(Number(kelas[0].id)) && dup.ruang === 'R-1', JSON.stringify(dup && dup.kelas_ids));
    /* bentrok: duplikat ke slot yang sudah dipakai guru+kelas yang sama */
    r = await req('/api/jadwal/duplikat', { method: 'POST', body: { id: sA, hari: HARI, sesi: 2 } });
    ok('duplikat ke sesi yang bentrok ditolak 409', r.status === 409, `${r.status} ${r.body?.error || ''}`);
    r = await req('/api/jadwal/duplikat', { method: 'POST', body: { id: 999999 } });
    ok('duplikat slot tidak ada → 404', r.status === 404, r.status);
    /* hapus hasil duplikat agar data uji bersih */
    await req(`/api/jadwal/slot/${idDup}`, { method: 'DELETE' });

    /* ============ 2. MONITORING KBM ============ */
    console.log('\n== 2. MONITORING KBM REAL-TIME ==');
    r = await req('/api/monitor-kbm?tanggal=' + TODAY);
    ok('endpoint monitoring tersedia', r.status === 200 && !!r.body.stats, r.body?.error);
    ok('tanggal & jam server dikirim', r.body.tanggal === TODAY && !!r.body.jam_sekarang, JSON.stringify({ t: r.body.tanggal, j: r.body.jam_sekarang }));
    ok('3 slot hari ini dihitung', Number(r.body.stats.slot) === 3, JSON.stringify(r.body.stats));
    ok('sesi yang sedang berjalan terdeteksi', (r.body.sedang_belajar || []).length >= 1,
      JSON.stringify((r.body.sedang_belajar || []).map(x => x.label_sesi)));
    const aktif = (r.body.sedang_belajar || [])[0] || {};
    ok('kartu kelas aktif memuat kelas, mapel, guru, jam & label sesi',
      !!aktif.kelas_nama && !!aktif.mapel_nama && !!aktif.guru_nama && !!aktif.jam && !!aktif.label_sesi,
      JSON.stringify(aktif).slice(0, 200));
    ok('status guru "belum check-in" terdeteksi', Number(r.body.stats.belum_checkin) >= 1, JSON.stringify(r.body.stats));
    ok('persentase jurnal 0% saat belum ada jurnal', Number(r.body.stats.persen_jurnal) === 0, String(r.body.stats.persen_jurnal));
    ok('daftar jurnal belum diisi = seluruh slot',
      (r.body.jurnal?.belum || []).length === 3, JSON.stringify((r.body.jurnal?.belum || []).length));
    ok('rekap per kelas tersedia', (r.body.per_kelas || []).length === 2,
      JSON.stringify((r.body.per_kelas || []).map(k => k.kelas_nama)));

    /* guru A check-in pada sesi 1 + isi jurnal */
    await login('guru', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: sA, tanggal: TODAY, status: 'hadir' } });
    ok('guru A berhasil check-in (sesi berjalan)', r.status === 200, r.body?.error);
    /* alur wajib: absensi siswa dulu, baru jurnal mengajar */
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: sA, tanggal: TODAY } });
    ok('sesi presensi siswa dibuat', r.status === 200, r.body?.error);
    const sesiId = r.body?.sesi?.id;
    const siswaKelas = ((await req('/api/siswa?limit=20')).body.rows || [])
      .filter(x => Number(x.kelas_id) === Number(kelas[0].id));
    r = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: sesiId, items: siswaKelas.map(x => ({ siswa_id: x.id, status: 'H' })) }
    });
    ok('presensi siswa tersimpan (H semua)', r.status === 200, r.body?.error);
    r = await req('/api/absensi-guru/jurnal', {
      method: 'POST', body: { jadwal_id: sA, tanggal: TODAY, materi: 'Membahas persamaan linear dan latihan soal' }
    });
    ok('guru A mengisi jurnal mengajar', r.status === 200, r.body?.error);
    await login('admin', 'admin123');
    r = await req('/api/monitor-kbm?tanggal=' + TODAY);
    const s1row = (r.body.jurnal?.sudah || []).find(x => Number(x.jadwal_id) === Number(sA));
    ok('jurnal yang sudah diisi masuk daftar "sudah"', !!s1row && s1row.jurnal_isi === true, JSON.stringify(r.body.jurnal?.sudah));
    ok('persentase jurnal naik (33%)', Number(r.body.stats.persen_jurnal) === 33, String(r.body.stats.persen_jurnal));
    ok('guru yang check-in tercatat hadir', Number(r.body.stats.hadir) >= 1, JSON.stringify(r.body.stats.hadir));

    /* guru berhalangan + pengganti */
    await login('guruumum', 'guruumum123');
    r = await req('/api/absensi-guru/checkin', {
      method: 'POST', body: { jadwal_id: sB, tanggal: TODAY, status: 'izin', catatan: 'menghadiri undangan dinas' }
    });
    ok('guru B mengajukan izin', r.status === 200, r.body?.error);
    await login('admin', 'admin123');
    r = await req('/api/monitor-kbm?tanggal=' + TODAY);
    ok('guru berhalangan terdeteksi', (r.body.berhalangan || []).some(x => Number(x.jadwal_id) === Number(sB)),
      JSON.stringify(r.body.berhalangan));
    ok('status "perlu pengganti" bertambah', Number(r.body.stats.perlu_pengganti) >= 1, JSON.stringify(r.body.stats));
    /* tunjuk guru pengganti */
    r = await req('/api/guru-pengganti/tunjuk', {
      method: 'POST', body: { jadwal_id: sB, tanggal: TODAY, ke_guru: gA.id, alasan: 'uji monitoring' }
    });
    ok('guru pengganti ditunjuk', r.status === 200, r.body?.error);
    r = await req('/api/monitor-kbm?tanggal=' + TODAY);
    const bh = (r.body.berhalangan || []).find(x => Number(x.jadwal_id) === Number(sB)) || {};
    ok('status pengganti tampil pada monitoring', !!bh.pengganti && Number(bh.pengganti.ke_guru) === Number(gA.id),
      JSON.stringify(bh.pengganti));
    ok('hitungan "digantikan" bertambah', Number(r.body.stats.digantikan) >= 1, JSON.stringify(r.body.stats));

    /* hari libur → tidak dihitung */
    r = await req('/api/kalender-akademik/save', {
      method: 'POST', body: { tanggal: TODAY, kategori: 'libur', judul: 'Libur Uji Monitoring', nonaktif: 1 }
    });
    ok('tanggal hari ini ditandai libur', r.status === 200, r.body?.error);
    r = await req('/api/monitor-kbm?tanggal=' + TODAY);
    ok('monitoring menandai KBM libur', r.body.kbm_libur === true, JSON.stringify(r.body.kalender));
    ok('info kalender dikirim ke dashboard', !!r.body.kalender && r.body.kalender.kategori === 'libur');

    /* ============ 3. KALENDER: SEMESTER, WARNA, EKSPOR ============ */
    console.log('\n== 3. KALENDER AKADEMIK: SEMESTER · WARNA · EKSPOR ==');
    r = await req('/api/kalender-akademik');
    ok('kalender mengirim rentang semester', !!r.body.semester?.ganjil?.mulai && !!r.body.semester?.genap?.selesai,
      JSON.stringify(r.body.semester));
    ok('semester bawaan: S1 Desember, S2 Januari',
      /-12-31$/.test(r.body.semester.ganjil.selesai) && /-01-01$/.test(r.body.semester.genap.mulai),
      JSON.stringify(r.body.semester));
    ok('kalender mengirim warna kategori', !!r.body.warna?.libur?.bg, JSON.stringify(r.body.warna));

    r = await req('/api/kalender-akademik/pengaturan', {
      method: 'POST',
      body: {
        semester: {
          ganjil: { mulai: `${TODAY.slice(0, 4)}-07-13`, selesai: `${TODAY.slice(0, 4)}-12-18` },
          genap: { mulai: `${Number(TODAY.slice(0, 4)) + 1}-01-04`, selesai: `${Number(TODAY.slice(0, 4)) + 1}-06-25` }
        },
        warna: {
          libur: { bg: '#FF0000', text: '#FFFFFF', border: '#990000' },
          ujian: { bg: '#FFA500', text: '#111827', border: '#B45309' },
          kegiatan: { bg: '#00AA00', text: '#FFFFFF', border: '#065F46' }
        },
        pengawas_nama: 'Drs. Pengawas Uji, M.Pd.',
        pengawas_nip: '19700101 199001 1 001'
      }
    });
    ok('rentang semester & warna disimpan', r.status === 200, r.body?.error);
    ok('rentang semester tersimpan sesuai input',
      r.body.semester.ganjil.mulai === `${TODAY.slice(0, 4)}-07-13` && r.body.semester.genap.selesai === `${Number(TODAY.slice(0, 4)) + 1}-06-25`,
      JSON.stringify(r.body.semester));
    ok('warna kategori tersimpan (color picker)', r.body.warna.libur.bg === '#FF0000', JSON.stringify(r.body.warna.libur));
    r = await req('/api/kalender-akademik/pengaturan', {
      method: 'POST', body: { semester: { ganjil: { mulai: '2026-12-01', selesai: '2026-11-01' } } }
    });
    ok('validasi: semester selesai < mulai ditolak', r.status === 400, r.status);
    r = await req('/api/kalender-akademik/pengaturan', { method: 'POST', body: { warna: { libur: { bg: 'merah' } } } });
    ok('validasi: warna bukan hex ditolak', r.status === 400, r.status);
    r = await req('/api/kalender-akademik');
    ok('penolakan tidak mengubah warna sebelumnya', r.body.warna.libur.bg === '#FF0000', r.body.warna.libur.bg);

    /* warna per tanggal */
    r = await req('/api/kalender-akademik/save', {
      method: 'POST',
      body: { tanggal: `${BULAN}-15`, kategori: 'kegiatan', judul: 'SMARTTREN', nonaktif: 1, warna: '#8B5CF6' }
    });
    ok('tanggal dengan warna khusus disimpan', r.status === 200, r.body?.error);
    r = await req('/api/kalender-akademik');
    const warnaRow = (r.body.rows || []).find(x => x.tanggal === `${BULAN}-15`);
    ok('warna khusus tersimpan pada baris', warnaRow && warnaRow.warna === '#8B5CF6', JSON.stringify(warnaRow && warnaRow.warna));

    /* CETAK: kop hanya halaman 1 + TTD hanya halaman terakhir + kotak bulan kartu */
    r = await req('/api/kalender-akademik/cetak');
    const html = String(r.body || '');
    ok('cetak kalender: tersedia', r.status === 200 && html.includes('kal-page'), r.status);
    ok('cetak kalender: memuat kop surat resmi (simetris)', html.includes('class="kop sym"')
      && /class="kop-txt" style="width:100%/.test(html), 'tanpa kop');
    ok('cetak kalender: kop HANYA di halaman pertama (semester 1)',
      (html.match(/class="kop sym"/g) || []).length === 1 && /kal-page nokop/.test(html),
      String((html.match(/class="kop sym"/g) || []).length));
    ok('cetak kalender: halaman semester 2 memakai judul + label semester',
      /KALENDER AKADEMIK - Semester 2 \(Genap\)/.test(html), (html.match(/kal-judul">[^<]*/) || [])[0]);
    ok('cetak kalender: 2 kolom TTD + pengawas di tengah (sekali di halaman akhir)',
      (html.match(/class="ttdc"/g) || []).length === 2 && (html.match(/class="ttdp"/g) || []).length === 1,
      (html.match(/class="ttdc"/g) || []).length + '/' + (html.match(/class="ttdp"/g) || []).length);
    ok('cetak kalender: nama pengawas tercetak', html.includes('Pengawas Uji'), 'nama pengawas tidak ada');
    ok('cetak kalender: kolom Kepala Sekolah tanpa "Mengetahui"',
      /Kepala Sekolah,/i.test(html) && !/Mengetahui/i.test(html));
    ok('cetak kalender: kolom Wakasek Bidang Kurikulum ada', /Wakasek[^<]*Kurikulum/i.test(html),
      (html.match(/Wakasek[^<]{0,40}/) || [])[0]);
    ok('cetak kalender: dipisah per semester (page-break-before)',
      html.includes('class="kal-sem pagebreak"') && /page-break-before:\s*always/.test(html));
    ok('cetak kalender: tanpa baris "Rentang tanggal efektif"', !/Rentang tanggal efektif/.test(html),
      (html.match(/Rentang tanggal efektif[^<]*/) || [])[0]);
    ok('cetak kalender: header hari Minggu…Sabtu', ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
      .every(h => html.includes(`>${h}<`)), 'header hari tidak lengkap');
    ok('cetak kalender: daftar keterangan rentang kegiatan', /class="kal-list"/.test(html));
    ok('cetak kalender: bulan tanpa agenda tidak menulis pesan kosong',
      !/Belum ada kegiatan/i.test(html) && !/kal-none/.test(html));
    ok('cetak kalender: sel tanggal beragenda diwarnai penuh + label kategori kecil',
      /<div class="kdd ada" style="background:#[0-9A-Fa-f]{6}[^"]*"><span class="kdnum">\d+<\/span><span class="kdket">(LIBUR|UJIAN|KEGIATAN|KBM)<\/span><\/div>/.test(html),
      (html.match(/<div class="kdd ada"[^>]*>[\s\S]{0,90}/) || [''])[0]);
    ok('cetak kalender: warna kategori dipakai pada latar sel',
      /class="kdd ada" style="background:#FF0000/i.test(html), 'warna kategori tidak ditemukan');
    ok('cetak kalender: warna khusus tanggal dipakai', /background:#8B5CF6/i.test(html), 'warna khusus tidak ditemukan');
    ok('cetak kalender: kotak bulan rounded (border-radius)',
      /\.kal-box\s*\{[^}]*border-radius/.test(html), (html.match(/\.kal-box\s*\{[^}]*/) || [])[0]);
    ok('cetak kalender: grid tanggal rata tengah',
      /\.kal-days\s*\{[^}]*text-align:\s*center/.test(html)
      && /\.kdd\s*\{[^}]*border-radius:\s*6px/.test(html));
    /* hanya semester 1 */
    r = await req('/api/kalender-akademik/cetak?semester=1');
    ok('cetak semester 1 saja: tanpa page break', !String(r.body).includes('class="kal-sem pagebreak"'), 'masih ada pemisah');
    ok('cetak semester 1 saja: hanya label Semester 1', /Semester 1/.test(String(r.body)) && !/Semester 2 \(Genap\)/.test(String(r.body)));
    ok('cetak semester 1 saja: kop tetap ada & TTD tetap ada',
      /class="kop sym"/.test(String(r.body)) && /class="ttdp"/.test(String(r.body)));
    /* hanya semester 2 → kop tetap tampil karena ia halaman pertama dokumen */
    r = await req('/api/kalender-akademik/cetak?semester=2');
    ok('cetak semester 2 saja: kop tampil (halaman pertama) & judul menyebut semester 2',
      /class="kop sym"/.test(String(r.body)) && /Semester 2 \(Genap\)/.test(String(r.body)));

    /* EXCEL */
    r = await req('/api/kalender-akademik/export');
    ok('ekspor Excel tersedia', r.status === 200 && String(r.ct).includes('spreadsheet'), r.ct);
    const zlib = require('zlib');
    const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.from(String(r.body), 'binary');
    ok('berkas Excel berisi arsip ZIP', buf.slice(0, 2).toString() === 'PK', buf.slice(0, 4).toString('hex'));

    /* WORD */
    r = await req('/api/kalender-akademik/word');
    ok('ekspor Word tersedia', r.status === 200 && String(r.ct).includes('msword'), r.ct);
    const word = String(r.body);
    ok('Word memakai kop resmi (tabel kop)', word.includes('class="kopw"'), 'tanpa kop Word');
    ok('Word memuat 3 tanda tangan', /Kepala/.test(word) && /Wakasek[^<]*Kurikulum/.test(word) && /Pengawas/.test(word));
    ok('Word tanpa baris "Rentang tanggal efektif"', !/Rentang tanggal efektif/.test(word));
    ok('Word: tanda tangan hanya pada semester terakhir',
      (word.match(/Pengawas Pembina/g) || []).length === 1
      && (word.match(/Kepala Sekolah|Kepala SMK|Kepala </g) || []).length <= 1,
      'pengawas=' + (word.match(/Pengawas Pembina/g) || []).length
      + ' kepala=' + (word.match(/Kepala Sekolah|Kepala SMK|Kepala </g) || []).length);
    ok('Word: sel tanggal beragenda hanya diwarnai angkanya (tanpa label)',
      !/<br><span style="font-size:5\.5pt">/.test(word));
    ok('Word memisahkan halaman per semester', /page-break-before/.test(word), 'tanpa page break');

    /* RBAC: guru tidak boleh mengubah pengaturan kalender */
    await login('guru', 'guru123');
    r = await req('/api/kalender-akademik/pengaturan', { method: 'POST', body: { pengawas_nama: 'X' } });
    ok('guru tidak boleh mengubah pengaturan kalender (403)', r.status === 403, r.status);
    r = await req('/api/monitor-kbm');
    ok('monitoring khusus kurikulum — guru biasa ditolak (403)', r.status === 403, r.status);
    await login('admin', 'admin123');
    /* bersihkan tanda libur hari ini */
    r = await req('/api/kalender-akademik');
    const liburRow = (r.body.rows || []).find(x => x.tanggal === TODAY);
    if (liburRow) await req('/api/kalender-akademik/delete', { method: 'POST', body: { id: liburRow.id } });
    r = await req('/api/monitor-kbm?tanggal=' + TODAY);
    ok('setelah tanda libur dihapus, monitoring normal kembali', r.body.kbm_libur === false);
  } catch (e) {
    fail++; fails.push('EXCEPTION: ' + e.message);
    console.error(e);
  } finally {
    srv.kill();
  }

  console.log(`\n=== HASIL MONITOR: ${pass} lulus, ${fail} gagal ===`);
  if (fails.length) { console.log('Gagal:'); fails.forEach(f => console.log('- ' + f)); process.exitCode = 1; }
})();
