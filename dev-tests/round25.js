'use strict';
/* Uji ronde 25 (tata-tertib) — API:
   1. Jadwal mengajar guru: hari ini + hari berikutnya tampil, tombol aksi terkunci
      (hari lain / belum waktunya / sudah berakhir) + hitung mundur
   2. Time-lock tetap berlaku pada aksi (server menolak)
   3. Hapus riwayat absensi SISWA: terpilih & per filter tanggal+kelas (wajib PIN)
   4. Hapus riwayat absensi GURU: terpilih & per rentang tanggal (wajib PIN)
   5. Rekap bulanan terpadu (kehadiran + kejadian + asesmen) & ekspor PDF/Excel/Word
   6. WA otomatis Alfa/Bolos (Fonnte) + notifikasi guru Sakit/Izin
   7. Guru piket & pengganti: penunjukan tanpa mengubah master jadwal,
      sesi berpindah ke guru pengganti, izin guru asli tetap tercatat, batal
   Jalankan: node dev-tests/round25.js */
process.env.TZ = 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB = path.join(os.tmpdir(), 'stt-r25-' + Date.now() + '.sqlite');
const SAAS = path.join(os.tmpdir(), 'stt-r25-saas-' + Date.now() + '.sqlite');
const PORT = 5000 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const WA_PORT = PORT + 400;
const WA_URL = `http://127.0.0.1:${WA_PORT}/send`;
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
const BESOK = (() => { const d = new Date(wib.getTime() + 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const cur = wib.getHours() * 60 + wib.getMinutes();
const hhmm = m => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
const base = Math.max(120, Math.min(cur, 1440 - 200));

/* gateway WhatsApp tiruan (Fonnte style) */
const waHits = [];
function startWa() {
  const http = require('http');
  const srv = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', c => { body += c; });
    rq.on('end', () => {
      waHits.push({ url: rq.url, ct: rq.headers['content-type'], auth: rq.headers.authorization || '', body });
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ status: true, detail: 'success' }));
    });
  });
  return new Promise(r => srv.listen(WA_PORT, '127.0.0.1', () => r(srv)));
}

(async () => {
  const wa = await startWa();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1', TZ: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 2400));

  const cfgBody = (extra = {}) => ({
    hari: [HARI, (HARI + 1) % 7], max_jam: 8,
    sesi: extra.sesi || [
      { label: 'Jam ke-1', mulai: hhmm(base - 60), selesai: hhmm(base - 30), istirahat: 0 },
      { label: 'Jam ke-2', mulai: hhmm(base - 10), selesai: hhmm(base + 10), istirahat: 0 },
      { label: 'Jam ke-3', mulai: hhmm(base + 11), selesai: hhmm(base + 45), istirahat: 0 },
      { label: 'Jam ke-4', mulai: hhmm(base + 90), selesai: hhmm(base + 120), istirahat: 0 }
    ],
    max_mapel_jam: 3, max_guru_jam: 8,
    absensi: { buka_menit: 15, toleransi_tutup: 0, jurnal_min: 10, foto_wajib: 0, foto_hari: 30, siswa_aktif: 1, auto_alpha: 0 },
    wa: { aktif: 0, jam: '15:00' }
  });

  try {
    KODE = ((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';
    await login('admin', 'admin123');
    ok('login admin', !!cookie, KODE);

    let r = await req('/api/jadwal/pengaturan', { method: 'POST', body: cfgBody() });
    ok('pengaturan jadwal disimpan', r.status === 200, r.body?.error);

    /* akun guru: role guru (punya absensi_guru.write & tukar jadwal) */
    const mk = async (nama, username, roles) => (await req('/api/users/save', {
      method: 'POST', body: { nama, username, password: 'guru123', role: 'guru_umum', roles: roles || ['guru'] }
    })).body.id;
    const gA = await mk('Guru Pengampu A', 'gurua');
    const gB = await mk('Guru Pengganti B', 'gurub');
    ok('akun guru dibuat', !!gA && !!gB);

    const siswa = (await req('/api/siswa?limit=12')).body.rows || [];
    ok('data siswa contoh tersedia', siswa.length >= 4, String(siswa.length));
    const kelas1 = siswa[0].kelas_id;
    const kelas2 = (siswa.find(s => s.kelas_id !== kelas1) || {}).kelas_id || kelas1;
    const s1 = siswa.find(s => s.kelas_id === kelas1);

    /* nomor orang tua untuk notifikasi WA */
    await req('/api/siswa/save', {
      method: 'POST',
      body: { id: s1.id, nama: s1.nama, nisn: s1.nisn || '', kelas_id: kelas1, parent_phone: '081234567890' }
    });
    const cekSiswa = (await req('/api/siswa?q=' + encodeURIComponent(s1.nama))).body.rows.find(x => Number(x.id) === Number(s1.id));
    ok('nomor HP orang tua tersimpan (format 62…)', /^62/.test(String(cekSiswa?.parent_phone || '')), JSON.stringify(cekSiswa?.parent_phone));

    const mapel = async (nama, kode, guruId) => (await req('/api/mapel/save', { method: 'POST', body: { nama, kode, guru_ids: [guruId] } })).body.id;
    const mA = await mapel('Mapel A', 'MPA', gA);
    const mB = await mapel('Mapel B', 'MPB', gB);
    const mC = await mapel('Mapel C', 'MPC', gA);

    /* slot guru A: sesi 1 (sudah berakhir), sesi 2 (berlangsung), sesi 3 (belum) */
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 1, mapel_id: mA, guru_id: gA, kelas_ids: [kelas1], abaikan: 1 } });
    const slotLalu = r.body.id; ok('slot sesi 1 dibuat', r.status === 200, r.body?.error);
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 2, mapel_id: mC, guru_id: gA, kelas_ids: [kelas1], abaikan: 1 } });
    const slotKini = r.body.id; ok('slot sesi 2 (berlangsung) dibuat', r.status === 200, r.body?.error);
    /* sesi 3 masih TERBUKA (dipakai untuk izin guru & pengganti) */
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 3, mapel_id: mA, guru_id: gA, kelas_ids: [kelas2], abaikan: 1 } });
    const slotNanti = r.body.id; ok('slot sesi 3 (berlangsung) dibuat', r.status === 200, r.body?.error);
    /* sesi 4 BELUM WAKTUNYA (untuk uji hitung mundur) */
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI, sesi: 4, mapel_id: mA, guru_id: gA, kelas_ids: [kelas2], abaikan: 1 } });
    const slotBelum = r.body.id; ok('slot sesi 4 (belum waktunya) dibuat', r.status === 200, r.body?.error);
    /* slot BESOK untuk guru A (hari berikutnya) */
    const HARI_BESOK = (HARI + 1) % 7;
    r = await req('/api/jadwal/slot', { method: 'POST', body: { hari: HARI_BESOK, sesi: 2, mapel_id: mC, guru_id: gA, kelas_ids: [kelas1], abaikan: 1 } });
    const slotBesok = r.body.id;
    ok('slot untuk hari esok dibuat', r.status === 200, r.body?.error);

    /* ================= 1. JADWAL MENGAJAR GURU ================= */
    console.log('\n== 1. DAFTAR JADWAL MENGAJAR (HARI INI & BERIKUTNYA) ==');
    await login('gurua', 'guru123');
    r = await req('/api/absensi-guru/jadwal-mengajar?hari=7');
    ok('endpoint jadwal mengajar tersedia', r.status === 200 && Array.isArray(r.body.hari), r.body?.error);
    const hariIni = (r.body.hari || []).find(h => h.hari_ini);
    ok('kelompok HARI INI tampil', !!hariIni, JSON.stringify((r.body.hari || []).map(h => h.tanggal)));
    ok('seluruh slot hari ini muncul (4 sesi)', (hariIni?.slots || []).length === 4,
      JSON.stringify((hariIni?.slots || []).map(s => s.sesi)));
    const sLalu = (hariIni?.slots || []).find(s => s.sesi === 1) || {};
    const sKini = (hariIni?.slots || []).find(s => s.sesi === 2) || {};
    const sNanti = (hariIni?.slots || []).find(s => Number(s.jadwal_id) === Number(slotBelum)) || {};
    ok('sesi yang sudah berakhir terkunci', sLalu.terkunci === true && sLalu.bisa_checkin === false,
      JSON.stringify({ t: sLalu.terkunci, b: sLalu.bisa_checkin }));
    ok('sesi berlangsung: tombol aktif', sKini.bisa_checkin === true, JSON.stringify(sKini.window));
    ok('sesi belum waktunya: NONAKTIF + label "Belum waktunya"', sNanti.bisa_checkin === false && /Belum waktunya/i.test(sNanti.alasan_singkat || ''),
      sNanti.alasan_singkat);
    ok('sesi belum waktunya punya hitung mundur', !!sNanti.countdown && sNanti.countdown.arah === 'buka' && sNanti.countdown.detik > 0,
      JSON.stringify(sNanti.countdown));
    const besok = (r.body.hari || []).find(h => h.tanggal === BESOK);
    ok('jadwal HARI ESOK tetap tampil di daftar', !!besok, JSON.stringify((r.body.hari || []).map(h => h.tanggal)));
    const sBesok = (besok?.slots || []).find(s => Number(s.jadwal_id) === Number(slotBesok)) || {};
    ok('sesi hari esok: semua tombol nonaktif', sBesok.bisa_checkin === false && sBesok.terkunci === true,
      JSON.stringify({ b: sBesok.bisa_checkin, t: sBesok.terkunci }));
    ok('sesi hari esok menjelaskan aturan hari-H', /Hanya dapat diisi pada hari/i.test(sBesok.alasan_singkat || ''), sBesok.alasan_singkat);

    /* server tetap menolak aksi di luar jendela */
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotLalu, tanggal: TODAY, status: 'hadir' } });
    ok('server menolak check-in sesi yang sudah berakhir', r.status === 403, r.body?.error);
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotBesok, tanggal: BESOK, status: 'hadir' } });
    ok('server menolak check-in untuk hari esok', r.status === 403, r.body?.error);

    /* ================= 2. WA ALFA/BOLOS (FONNTE) ================= */
    console.log('\n== 2. NOTIFIKASI WHATSAPP OTOMATIS ==');
    await login('admin', 'admin123');
    r = await req('/api/wa/pengaturan', {
      method: 'POST',
      body: {
        aktif: true, provider: 'fonnte', url: WA_URL, token: 'TOKEN-FONNTE', header: 'Authorization', prefix: '',
        alfa_aktif: 1, izin_aktif: 1,
        kepsek_wa: '081200000001', wakasek_kur_wa: '081200000002'
      }
    });
    ok('gateway Fonnte dikonfigurasi', r.status === 200, r.body?.error);
    r = await req('/api/wa/pengaturan');
    ok('provider tersimpan sebagai fonnte', r.body.config.provider === 'fonnte', r.body.config.provider);
    ok('template bawaan alfa & izin tersedia',
      /Alfa|Alpha|{nama}/.test(r.body.config.contoh_template_alfa || '') && /{guru}/.test(r.body.config.contoh_template_izin || ''));

    await login('gurua', 'guru123');
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY, status: 'hadir' } });
    ok('check-in sesi berlangsung diterima', r.status === 200, r.body?.error);
    r = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY } });
    ok('sesi presensi dibuat', r.status === 200, r.body?.error);
    const sesiId = r.body.sesi.id;
    const s2 = siswa.filter(x => x.kelas_id === kelas1)[1] || siswa[1];
    r = await req('/api/absensi-siswa/simpan', {
      method: 'POST', body: {
        sesi_id: sesiId,
        items: [{ siswa_id: s1.id, status: 'A', keterangan: 'tanpa kabar' }, { siswa_id: s2.id, status: 'B' }]
      }
    });
    ok('presensi dengan Alfa & Bolos tersimpan', r.status === 200, r.body?.error);
    await new Promise(r2 => setTimeout(r2, 1200));
    const hitAlfa = waHits.filter(h => /x-www-form-urlencoded/.test(String(h.ct)) && /target=/.test(h.body));
    ok('gateway Fonnte dipanggil dengan form-urlencoded', hitAlfa.length >= 1, JSON.stringify(waHits.map(h => h.ct)));
    const isiAlfa = hitAlfa.map(h => decodeURIComponent(h.body.replace(/\+/g, ' '))).join(' || ');
    ok('pesan memuat nama siswa & status', isiAlfa.includes(s1.nama) && /Alpha/i.test(isiAlfa), isiAlfa.slice(0, 160));
    ok('nomor orang tua dipakai (62…)', /target=62/.test(hitAlfa.map(h => h.body).join('&')) || /62\d{8,}/.test(hitAlfa.map(h => h.body).join('&')),
      hitAlfa.map(h => h.body).join(' | ').slice(0, 160));
    ok('token gateway dikirim pada header Authorization', hitAlfa.every(h => /TOKEN-FONNTE/.test(String(h.auth))), JSON.stringify(hitAlfa.map(h => h.auth)));

    /* simpan ulang → tidak dobel kirim untuk siswa yang sama */
    const sebelum = waHits.length;
    r = await req('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: sesiId, items: [{ siswa_id: s1.id, status: 'A' }] } });
    await new Promise(r2 => setTimeout(r2, 900));
    ok('pengiriman ulang tidak menduplikasi pesan siswa yang sama', waHits.length === sebelum,
      `${sebelum} → ${waHits.length}`);

    r = await req('/api/wa/log?limit=10');
    ok('riwayat WhatsApp mencatat pesan alfa-siswa',
      JSON.stringify(r.body || {}).toLowerCase().includes('alfa') || JSON.stringify(r.body || {}).includes('Alfa'),
      JSON.stringify(r.body).slice(0, 200));

    /* notifikasi guru sakit/izin */
    await login('gurua', 'guru123');
    const sebelumIzin = waHits.length;
    r = await req('/api/absensi-guru/checkin', {
      method: 'POST', body: { jadwal_id: slotNanti, tanggal: TODAY, status: 'izin', catatan: 'menghadiri undangan dinas' }
    });
    ok('check-in IZIN tercatat', r.status === 200, r.body?.error);
    await new Promise(r2 => setTimeout(r2, 1200));
    const hitIzin = waHits.slice(sebelumIzin).map(h => decodeURIComponent(h.body.replace(/\+/g, ' '))).join(' || ');
    ok('notifikasi izin guru terkirim ke Kepala Sekolah/Wakasek', waHits.length > sebelumIzin && /Guru Pengampu A/.test(hitIzin),
      `${sebelumIzin} → ${waHits.length} :: ${hitIzin.slice(0, 140)}`);

    /* ================= 3. GURU PIKET & PENGGANTI ================= */
    console.log('\n== 3. GURU PIKET & PENGGANTI ==');
    await login('admin', 'admin123');
    r = await req('/api/guru-pengganti?tanggal=' + TODAY);
    ok('halaman data guru pengganti tersedia', r.status === 200 && Array.isArray(r.body.slots), r.body?.error);
    ok('guru tidak hadir (izin) terdeteksi', (r.body.tidak_hadir || []).some(z => Number(z.guru_id) === Number(gA)),
      JSON.stringify(r.body.tidak_hadir));
    ok('slot yang perlu pengganti ditandai', (r.body.slots || []).some(s => s.perlu_pengganti === true && Number(s.jadwal_id) === Number(slotNanti)),
      JSON.stringify((r.body.slots || []).map(s => ({ id: s.jadwal_id, p: s.perlu_pengganti }))));

    r = await req(`/api/guru-pengganti/kandidat?jadwal_id=${slotNanti}&tanggal=${TODAY}`);
    ok('daftar kandidat pengganti tersedia', r.status === 200 && (r.body.kandidat || []).length > 0, r.body?.error);
    ok('guru pemilik slot tidak ikut kandidat', !(r.body.kandidat || []).some(k => Number(k.id) === Number(gA)));

    r = await req('/api/guru-pengganti/tunjuk', { method: 'POST', body: { jadwal_id: slotNanti, tanggal: TODAY, ke_guru: gB, alasan: 'menggantikan guru izin' } });
    ok('penunjukan guru pengganti berhasil', r.status === 200, r.body?.error);
    const idTunjuk = r.body.id;

    /* master jadwal TIDAK berubah */
    r = await req('/api/jadwal');
    const slotDb = (r.body.rows || []).find(x => Number(x.id) === Number(slotNanti));
    ok('master jadwal tetap milik guru asli', Number(slotDb?.guru_id) === Number(gA), JSON.stringify(slotDb && { g: slotDb.guru_id }));

    /* rekam izin guru asli tetap ada */
    r = await req(`/api/guru-pengganti?tanggal=${TODAY}`);
    ok('ketidakhadiran guru asli tetap tercatat', (r.body.tidak_hadir || []).some(z => Number(z.jadwal_id) === Number(slotNanti)),
      JSON.stringify(r.body.tidak_hadir));
    ok('slot kini tercatat punya pengganti', (r.body.slots || []).some(s => Number(s.jadwal_id) === Number(slotNanti) && s.pengganti && Number(s.pengganti.ke_guru) === Number(gB)));

    r = await req(`/api/guru-pengganti?tanggal=${TODAY}&kelas=${kelas2}&guru=${gB}`);
    ok('slot guru piket dapat difilter menurut kelas dan guru efektif',
      (r.body.slots || []).some(s => Number(s.jadwal_id) === Number(slotNanti)),
      JSON.stringify((r.body.slots || []).map(s => s.jadwal_id)));
    const filterRiwayat = `riwayat_periode=custom&riwayat_dari=${TODAY}&riwayat_sampai=${TODAY}`
      + `&riwayat_kelas=${kelas2}&riwayat_guru=${gA}&riwayat_mapel=${mA}`
      + `&riwayat_q=${encodeURIComponent('Guru Pengganti B')}`;
    r = await req(`/api/guru-pengganti?tanggal=${TODAY}&${filterRiwayat}`);
    ok('riwayat pengganti dapat difilter kelas, guru, tanggal, mapel, dan nama',
      (r.body.riwayat || []).some(x => Number(x.id) === Number(idTunjuk)),
      JSON.stringify(r.body.riwayat || []));
    r = await req(`/api/guru-pengganti?tanggal=${TODAY}&riwayat_periode=mingguan&riwayat_tanggal=${TODAY}`);
    ok('filter riwayat mingguan menghasilkan rentang tujuh hari',
      r.body.filter_riwayat?.sampai === new Date(new Date(TODAY + 'T12:00:00').getTime() + 6 * 86400000)
        .toISOString().slice(0, 10),
      JSON.stringify(r.body.filter_riwayat));

    /* sesi berpindah ke guru B */
    await login('gurub', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    const slotB = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotNanti));
    ok('sesi pengganti masuk ke akun guru B', !!slotB && Number(slotB.guru_efektif_id) === Number(gB), JSON.stringify((r.body.jadwal || []).map(j => j.id)));
    r = await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotNanti, tanggal: TODAY, status: 'hadir' } });
    ok('guru pengganti dapat check-in (tidak terblokir rekam izin)', r.status === 200, r.body?.error);

    /* guru asli kehilangan sesi yang sudah berpindah ke guru pengganti */
    await login('gurua', 'guru123');
    r = await req(`/api/absensi-guru?tanggal=${TODAY}`);
    const slotAsli = (r.body.jadwal || []).find(j => Number(j.id) === Number(slotNanti));
    ok('slot guru utama berpindah dan tidak lagi tampil pada akunnya',
      !slotAsli,
      JSON.stringify(slotAsli && { bisa: slotAsli.bisa_checkin, efektif: slotAsli.guru_efektif_id }));

    /* rekap tetap menghitung izin guru asli */
    await login('admin', 'admin123');
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}`);
    const rekapIzin = (r.body.rows || []).filter(x => Number(x.jadwal_id) === Number(slotNanti));
    ok('rekap memuat baris izin guru asli + baris guru pengganti', rekapIzin.length >= 2,
      JSON.stringify(rekapIzin.map(x => ({ g: x.guru_nama, s: x.status }))));
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}&guru=${gA}&mapel=${mA}`);
    ok('filter nama guru tetap menampilkan baris izin guru asli',
      (r.body.rows || []).some(x => Number(x.guru_id) === Number(gA) && x.dari_izin),
      JSON.stringify((r.body.rows || []).map(x => ({ guru: x.guru_id, izin: x.dari_izin, status: x.status }))));

    /* pengambilalihan tidak dapat dibatalkan setelah pengganti mulai mengisi */
    r = await req('/api/guru-pengganti/batal', { method: 'POST', body: { id: idTunjuk } });
    ok('penunjukan terkunci setelah pengganti mulai mengisi', r.status === 409, r.body?.error);
    await login('admin', 'admin123');
    r = await req(`/api/guru-pengganti?tanggal=${TODAY}`);
    ok('penugasan tetap aktif setelah pengganti mulai mengisi',
      (r.body.slots || []).some(s => Number(s.jadwal_id) === Number(slotNanti) && Number(s.guru_efektif_id) === Number(gB)));
    r = await req('/api/guru-pengganti/riwayat/hapus', { method: 'POST', body: { ids: [idTunjuk] } });
    ok('hapus riwayat menolak penugasan yang masih aktif', r.status === 409, r.body?.error);

    const fixtureDb = new (require('better-sqlite3'))(DB);
    const taFixture = fixtureDb.prepare('SELECT ta_id FROM jadwal WHERE id=?').get(slotBelum).ta_id;
    const fixture = fixtureDb.prepare(`INSERT INTO jadwal_tukar
      (jadwal_id,tanggal,ta_id,dari_guru,ke_guru,mapel_id,alasan,status,jenis,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'uji hapus riwayat','batal','penugasan','2000-01-01 00:00:00','2000-01-01 00:00:00')`);
    const riwayatFixtureA = Number(fixture.run(slotBelum, TODAY, taFixture, gA, gB, mA).lastInsertRowid);
    fixture.run(slotBesok, TODAY, taFixture, gA, gB, mA);
    fixtureDb.close();
    await login('gurua', 'guru123');
    r = await req('/api/guru-pengganti/riwayat/hapus', {
      method: 'POST', body: { ids: [riwayatFixtureA] }
    });
    ok('guru biasa tidak boleh menghapus riwayat pengganti', r.status === 403, r.body?.error);
    await login('admin', 'admin123');
    r = await req('/api/guru-pengganti/riwayat/hapus', {
      method: 'POST', body: { ids: [riwayatFixtureA] }
    });
    ok('hapus terpilih menghapus seluruh slot dalam riwayat', r.status === 200 && Number(r.body.dihapus) === 2, JSON.stringify(r.body));
    r = await req(`/api/guru-pengganti?tanggal=${TODAY}&riwayat_periode=semua`);
    ok('riwayat terpilih sudah tidak muncul', !(r.body.riwayat || []).some(x => (x.riwayat_ids || [x.id]).includes(riwayatFixtureA)),
      JSON.stringify((r.body.riwayat || []).map(x => x.riwayat_ids)));

    /* RBAC */
    await login('gurua', 'guru123');
    r = await req('/api/guru-pengganti/tunjuk', { method: 'POST', body: { jadwal_id: slotNanti, tanggal: TODAY, ke_guru: gB } });
    ok('guru biasa tidak boleh menunjuk pengganti (403)', r.status === 403, r.body?.error);

    /* ================= 4. REKAP BULANAN TERPADU ================= */
    console.log('\n== 4. REKAP BULANAN (PORTOFOLIO KELAS) ==');
    await login('admin', 'admin123');
    const bulan = TODAY.slice(0, 7);
    r = await req(`/api/rekap-bulanan?bulan=${bulan}&kelas=${kelas1}`);
    ok('rekap bulanan tersedia', r.status === 200 && Array.isArray(r.body.siswa), r.body?.error);
    ok('memuat data kehadiran siswa', (r.body.siswa || []).length > 0 && (r.body.total || {}).total > 0,
      JSON.stringify(r.body.total));
    ok('memuat ringkasan asesmen', Array.isArray(r.body.asesmen), JSON.stringify((r.body.asesmen || []).map(a => a.kode)));
    ok('memuat catatan kejadian', Array.isArray(r.body.kejadian));
    ok('rekap memuat identitas wali kelas', !!r.body.kelas && 'wali_nama' in r.body.kelas);

    r = await req(`/api/rekap-bulanan/cetak?bulan=${bulan}&kelas=${kelas1}`);
    ok('cetak PDF/HTML rekap bulanan berhasil', r.status === 200 && /REKAPITULASI BULANAN/i.test(String(r.body)),
      String(r.body).slice(0, 80));
    ok('cetakan memuat kop sekolah', /SMK|SEKOLAH/i.test(String(r.body)));
    ok('cetakan memuat 3 blok tanda tangan (kepala, wali, guru BK)', (String(r.body).match(/class="ttd"/g) || []).length >= 3);
    ok('cetakan memuat nama kepala sekolah dari identitas', /Kepala/i.test(String(r.body)));

    r = await req(`/api/rekap-bulanan/export?bulan=${bulan}&kelas=${kelas1}`);
    ok('ekspor Excel rekap bulanan', r.status === 200 && /spreadsheet/.test(r.ct));
    r = await req(`/api/rekap-bulanan/word?bulan=${bulan}&kelas=${kelas1}`);
    ok('ekspor Word rekap bulanan', r.status === 200 && /msword/.test(r.ct));

    /* wali kelas hanya kelasnya sendiri */
    await login('wali1', 'wali123');
    r = await req(`/api/rekap-bulanan?bulan=${bulan}`);
    ok('wali kelas dapat membuka rekap bulannya', r.status === 200, r.body?.error);
    const kelasWali = (r.body.kelas_list || []).map(k => Number(k.id));
    ok('wali kelas hanya melihat kelas yang diampu', (r.body.kelas_list || []).length <= 1, JSON.stringify(kelasWali));
    const kelasLain = [1, 2, 3, 4, 5, 6, 7, 12].find(id => !kelasWali.includes(Number(id)));
    if (kelasLain) {
      r = await req(`/api/rekap-bulanan?bulan=${bulan}&kelas=${kelasLain}`);
      ok('wali kelas ditolak membuka kelas lain', r.status === 400, JSON.stringify(r.body).slice(0, 120));
    }
    await login('guru_bk', 'bk123').catch(() => { });
    await login('admin', 'admin123');

    /* ================= 5. HAPUS RIWAYAT ABSENSI ================= */
    console.log('\n== 5. HAPUS RIWAYAT ABSENSI (BULK & FILTER) ==');
    r = await req(`/api/rekap/absensi-siswa?periode=harian&tanggal=${TODAY}&mode=kelas&kelas=${kelas1}`);
    ok('riwayat absensi siswa tersedia untuk dihapus', r.status === 200 && (r.body.rows || []).length > 0,
      JSON.stringify({ n: (r.body.rows || []).length }));
    const rowSiswa = (r.body.rows || [])[0];

    r = await req('/api/rekap/absensi-siswa/hapus', { method: 'POST', body: { ids: [rowSiswa.id] } });
    ok('hapus tanpa PIN ditolak', r.status === 400, r.body?.error);
    r = await req('/api/rekap/absensi-siswa/hapus', { method: 'POST', body: { ids: [rowSiswa.id], pin: 'salah-sekali' } });
    ok('hapus dengan PIN salah ditolak', r.status === 400 && /salah/i.test(r.body.error || ''), r.body?.error);
    r = await req('/api/rekap/absensi-siswa/hapus', { method: 'POST', body: { ids: [rowSiswa.id], pin: 'admin123' } });
    ok('hapus terpilih berhasil dengan PIN benar', r.status === 200 && Number(r.body.dihapus) === 1, r.body?.error);
    ok('snapshot penghapusan dibuat', Number(r.body.snapshot) === 1);

    /* hapus per filter tanggal + kelas */
    const sesi2 = await req('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY } });
    await req('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: sesi2.body.sesi.id, items: [{ siswa_id: s1.id, status: 'H' }] } });
    r = await req('/api/rekap/absensi-siswa/hapus-filter', {
      method: 'POST', body: { dari: TODAY, sampai: TODAY, kelas: kelas1, pin: 'admin123' }
    });
    ok('hapus per filter tanggal & kelas berhasil', r.status === 200 && Number(r.body.dihapus) >= 1, r.body?.error);
    r = await req(`/api/rekap/absensi-siswa?periode=harian&tanggal=${TODAY}&mode=kelas&kelas=${kelas1}`);
    ok('riwayat absensi siswa pada filter tersebut kosong', (r.body.rows || []).length === 0,
      JSON.stringify({ n: (r.body.rows || []).length }));

    /* ---- absensi guru ---- */
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}`);
    const rowsGuru = (r.body.rows || []).filter(x => x.absensi_id);
    ok('riwayat absensi guru tersedia', rowsGuru.length > 0, String(rowsGuru.length));
    r = await req('/api/rekap/absensi-guru/hapus', {
      method: 'POST', body: { items: [{ jadwal_id: rowsGuru[0].jadwal_id, tanggal: rowsGuru[0].tanggal }] }
    });
    ok('hapus absensi guru tanpa PIN ditolak', r.status === 400, r.body?.error);
    /* filter dulu (menghapus semua absensi guru pada tanggal itu) */
    r = await req('/api/rekap/absensi-guru/hapus-filter', {
      method: 'POST', body: { dari: TODAY, sampai: TODAY, pin: 'admin123' }
    });
    ok('hapus absensi guru per rentang tanggal berhasil', r.status === 200 && Number(r.body.dihapus) >= 1, r.body?.error);
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}`);
    ok('absensi guru pada tanggal tersebut bersih', (r.body.rows || []).filter(x => x.absensi_id).length === 0,
      JSON.stringify((r.body.rows || []).filter(x => x.absensi_id).map(x => x.absensi_id)));
    /* buat satu absensi baru lalu hapus terpilih */
    await login('gurua', 'guru123');
    await req('/api/absensi-guru/checkin', { method: 'POST', body: { jadwal_id: slotKini, tanggal: TODAY, status: 'hadir' } });
    await login('admin', 'admin123');
    r = await req(`/api/rekap/absensi-guru?periode=harian&tanggal=${TODAY}`);
    const rowsBaru = (r.body.rows || []).filter(x => x.absensi_id);
    r = await req('/api/rekap/absensi-guru/hapus', { method: 'POST', body: { ids: [rowsBaru[0].absensi_id], pin: 'admin123' } });
    ok('hapus absensi guru terpilih berhasil', r.status === 200 && Number(r.body.dihapus) === 1, r.body?.error);

    r = await req('/api/audit?limit=20');
    ok('penghapusan tercatat di Log Aktivitas',
      /Hapus \d+ baris (riwayat absensi siswa|absensi guru)/i.test(JSON.stringify(r.body || {})),
      JSON.stringify(r.body).slice(0, 160));
  } catch (e) {
    fail++;
    fails.push('exception: ' + e.message);
    console.error(e);
  } finally {
    srv.kill('SIGTERM');
    try { wa.close(); } catch (e) { /* abaikan */ }
    await new Promise(r => setTimeout(r, 500));
    for (const f of [DB, DB + '-wal', DB + '-shm', SAAS, SAAS + '-wal', SAAS + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* abaikan */ } }
    console.log(`\n=== ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
