'use strict';
/* =====================================================================
   MODUL BIMBINGAN KONSELING (BK)
   ---------------------------------------------------------------------
   1. Kanal Aduan Kekerasan per guru/BK: QR & tautan unik, nomor layanan
      bantuan, daftar aduan masuk (status baru/diproses/selesai) + Excel.
   2. Program Layanan BK: pencatatan layanan komprehensif (layanan dasar,
      perencanaan individual, layanan responsif), foto bukti, cetak PDF.
   3. Asesmen Siswa BK: AKPD, RIASEC, Gaya Belajar, Kesulitan Belajar —
      tautan publik + QR, pengisian satu kali (NISN), rekap & analisis BK.
   4. Pengaturan soal & kategori asesmen + import/template Excel.
   ===================================================================== */
const crypto = require('crypto');
const dbm = require('./db');
const lib = require('./lib');
const printdoc = require('./printdoc');
const doc = require('./doc');
const xr = require('./xlsx-read');
const { db } = dbm;

let QRLIB = null;
const qrlib = () => { if (!QRLIB) QRLIB = require('qrcode'); return QRLIB; };
const e = lib.esc;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const intArr = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(','))
  .map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0);
const rowsOf = (buf, filename) => {
  const list = /\.csv$/i.test(String(filename || '')) ? xr.readCsv(buf.toString('utf8')) : xr.readXlsx(buf);
  return (list && list[0] && list[0].rows) || [];
};
const txt = (cell) => xr.cellText(cell);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const parseDOB = (v) => {
  if (v && typeof v === 'object') { const r = xr.parseDateCell(v); if (r) return r; return parseDOB(v.v); }
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (ISO_RE.test(s)) return s;
  const r = xr.parseDateCell({ v: s, n: null });
  return r || '';
};
const tglPanjang = (iso) => dbm.tanggalPanjang(iso);

const PROGRAM_BIDANG = {
  pribadi: ['Bimbingan klasikal pengembangan konsep diri & kepercayaan diri', 'Konseling individual pengendalian emosi dan stres', 'Kolaborasi dengan orang tua untuk pembiasaan disiplin'],
  sosial: ['Bimbingan kelompok keterampilan sosial & komunikasi', 'Mediasi konflik antar teman', 'Kampanye anti-perundungan dan toleransi'],
  belajar: ['Bimbingan klasikal strategi belajar & manajemen waktu', 'Konseling individual peningkatan motivasi belajar', 'Konsultasi guru mapel untuk pembelajaran berdiferensiasi'],
  karir: ['Bimbingan klasikal informasi karier & pendidikan lanjut', 'Asesmen minat bakat (RIASEC) lanjutan', 'Konsultasi karier individual']
};
const KARIER = {
  R: 'Teknik mesin/otomotif, kelistrikan, konstruksi, pertanian, logistik, pekerjaan lapangan',
  I: 'Penelitian, laboratorium, analis data, kedokteran, teknologi informasi, statistika',
  A: 'Desain grafis, seni & musik, perfilman, arsitektur, penulisan kreatif, periklanan kreatif',
  S: 'Pendidikan, bimbingan konseling, keperawatan, pekerjaan sosial, pelayanan publik',
  E: 'Kewirausahaan, manajemen, pemasaran, hukum, hubungan masyarakat, penjualan',
  C: 'Akuntansi, administrasi, perpajakan, kesekretariatan, audit, keuangan'
};
const GAYA_SARAN = {
  visual: 'Gunakan infografis, peta konsep, video, dan catatan berwarna. Guru menyediakan diagram/rangkuman visual.',
  auditorial: 'Gunakan diskusi, rekaman audio, presentasi lisan, dan pengulangan verbal saat menjelaskan.',
  kinestetik: 'Gunakan praktik langsung, simulasi, proyek, dan aktivitas bergerak agar materi lebih melekat.'
};
const KESULITAN_SARAN = {
  internal: 'Rekomendasi: Konseling Individual — penguatan kebiasaan belajar, konsentrasi, manajemen waktu, dan motivasi.',
  eksternal: 'Rekomendasi: Konsultasi/Kolaborasi dengan orang tua & wali kelas, konferensi kasus, atau alih tangan kasus (referral) bila hambatan lingkungan/fasilitas berlanjut.',
  campuran: 'Rekomendasi: Konseling Kelompok + Konferensi Kasus bersama guru mapel dan orang tua untuk menangani faktor internal dan eksternal sekaligus.'
};

module.exports = function mount(api) {
  const { get, post, del, json, fail, guard, readBody, ipOf, uploadBuffer, appBaseUrl, tenantKode } = api;
  const taOf = (q) => Number((q && q.ta)) || (dbm.tahunAktif() || {}).id || 0;
  const absUrl = (req, path) => appBaseUrl(req) + path;

  async function qrPair(url) {
    const q = qrlib();
    const svg = await q.toString(url, { type: 'svg', margin: 1, width: 260, errorCorrectionLevel: 'M' });
    const png = await q.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
    return { svg, png };
  }

  function sendXlsx(res, buf, filename) {
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    res.end(buf);
  }
  function sendHTML(res, html) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }

  /* =================================================================
     1. KANAL ADUAN KEKERASAN
     ================================================================= */
  function ensureAduanToken(req, user) {
    const row = db.prepare('SELECT aduan_token, aduan_token_at FROM users WHERE id=?').get(Number(user.id)) || {};
    if (row.aduan_token) return { token: row.aduan_token, at: row.aduan_token_at || '' };
    const token = `${tenantKode(req)}.aduan.${crypto.randomBytes(10).toString('hex')}`;
    const at = dbm.now();
    db.prepare('UPDATE users SET aduan_token=?, aduan_token_at=? WHERE id=?').run(token, at, Number(user.id));
    return { token, at };
  }

  get('/api/aduan', (req, res, q) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const info = ensureAduanToken(req, user);
    const status = ['baru', 'diproses', 'selesai'].includes(String(q.status)) ? String(q.status) : 'semua';
    const where = ['guru_id=?'];
    const args = [Number(user.id)];
    if (status !== 'semua') { where.push('status=?'); args.push(status); }
    if (q.q) {
      where.push('(lower(COALESCE(nama_siswa,\'\')) LIKE ? OR lower(COALESCE(kelas_nama,\'\')) LIKE ? OR lower(COALESCE(kronologi,\'\')) LIKE ?)');
      const l = '%' + String(q.q).toLowerCase() + '%'; args.push(l, l, l);
    }
    const rows = db.prepare(`SELECT * FROM aduan WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 400`).all(...args);
    const counts = { semua: 0, baru: 0, diproses: 0, selesai: 0 };
    for (const r of db.prepare('SELECT status, COUNT(*) c FROM aduan WHERE guru_id=? GROUP BY status').all(Number(user.id))) {
      counts[r.status] = Number(r.c); counts.semua += Number(r.c);
    }
    const profil = db.prepare('SELECT nama, jabatan, aduan_keswa, aduan_ppa FROM users WHERE id=?').get(Number(user.id)) || {};
    json(res, 200, {
      ok: true,
      link: { token: info.token, created_at: info.at, url: absUrl(req, `/aduan/${info.token}`) },
      layanan: { keswa: profil.aduan_keswa || '', ppa: profil.aduan_ppa || '' },
      guru: { id: user.id, nama: profil.nama || user.nama, jabatan: profil.jabatan || dbm.roleLabelOf(user) },
      rows, counts, status, jenis: dbm.ADUAN_JENIS, status_list: dbm.ADUAN_STATUS
    });
  });

  get('/api/aduan/qr', async (req, res) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const info = ensureAduanToken(req, user);
    const url = absUrl(req, `/aduan/${info.token}`);
    const qr = await qrPair(url);
    json(res, 200, { ok: true, url, token: info.token, created_at: info.at, qr });
  });

  post('/api/aduan/reset', async (req, res) => {
    const user = guard(req, res, 'aduan', 'write'); if (!user) return;
    await readBody(req);
    const token = `${tenantKode(req)}.aduan.${crypto.randomBytes(10).toString('hex')}`;
    const at = dbm.now();
    db.prepare('UPDATE users SET aduan_token=?, aduan_token_at=? WHERE id=?').run(token, at, Number(user.id));
    dbm.logAudit(user, 'UBAH', 'aduan', 'Mereset token/QR Kanal Aduan Kekerasan (QR lama tidak berlaku)', ipOf(req));
    json(res, 200, { ok: true, link: { token, created_at: at, url: absUrl(req, `/aduan/${token}`) }, pesan: 'QR baru dibuat. QR lama tidak berlaku lagi.' });
  });

  post('/api/aduan/layanan', async (req, res) => {
    const user = guard(req, res, 'aduan', 'write'); if (!user) return;
    const b = await readBody(req);
    const keswa = String(b.keswa || '').trim().slice(0, 120);
    const ppa = String(b.ppa || '').trim().slice(0, 120);
    db.prepare('UPDATE users SET aduan_keswa=?, aduan_ppa=? WHERE id=?').run(keswa, ppa, Number(user.id));
    dbm.logAudit(user, 'UBAH', 'aduan', 'Memperbarui nomor layanan bantuan untuk siswa', ipOf(req));
    json(res, 200, { ok: true, pesan: 'Nomor layanan bantuan tersimpan.', layanan: { keswa, ppa } });
  });

  post('/api/aduan/status', async (req, res) => {
    const user = guard(req, res, 'aduan', 'write'); if (!user) return;
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM aduan WHERE id=? AND guru_id=?').get(Number(b.id), Number(user.id));
    if (!row) return fail(res, 404, 'Aduan tidak ditemukan atau bukan milik kanal Anda.');
    const status = dbm.ADUAN_STATUS.some(s => s.key === b.status) ? String(b.status) : row.status;
    const tanggapan = b.tanggapan === undefined ? (row.tanggapan || '') : String(b.tanggapan).slice(0, 2000);
    db.prepare('UPDATE aduan SET status=?,tanggapan=?,tanggapan_oleh=?,tanggapan_at=?,updated_at=? WHERE id=?')
      .run(status, tanggapan, user.nama, dbm.now(), dbm.now(), Number(row.id));
    dbm.logAudit(user, 'UBAH', 'aduan', `Aduan #${row.id} (${row.nama_siswa || '-'}) → ${status}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Status aduan diperbarui.' });
  });

  /* hapus aduan (satuan / massal) — hanya aduan milik kanal pengguna */
  post('/api/aduan/delete', async (req, res) => {
    const user = guard(req, res, 'aduan', 'write'); if (!user) return;
    const b = await readBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || b.id || '').split(','))
      .map(x => Number(x)).filter(Boolean);
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu aduan yang akan dihapus.');
    const rows = db.prepare(`SELECT * FROM aduan WHERE guru_id=? AND id IN (${ids.map(() => '?').join(',')})`)
      .all(Number(user.id), ...ids);
    if (!rows.length) return fail(res, 404, 'Aduan tidak ditemukan atau bukan milik kanal Anda.');
    db.transaction(() => {
      for (const r of rows) db.prepare('DELETE FROM aduan WHERE id=?').run(r.id);
    })();
    dbm.logAudit(user, 'HAPUS', 'aduan', `Hapus ${rows.length} aduan: ${rows.map(r => `#${r.id} ${r.nama_siswa || ''}`).join(', ')}`, ipOf(req));
    json(res, 200, { ok: true, jumlah: rows.length, pesan: `${rows.length} aduan dihapus permanen.` });
  });

  get('/api/aduan/export', (req, res) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const rows = db.prepare('SELECT * FROM aduan WHERE guru_id=? ORDER BY id DESC').all(Number(user.id));
    const st = dbm.allSettings();
    const head = [
      [{ v: 'KANAL ADUAN KEKERASAN — DAFTAR ADUAN MASUK', bold: true }],
      [{ v: `Guru/BK: ${user.nama} · ${st.sekolah_nama || ''}` }],
      [],
      ['NO', 'TANGGAL', 'NAMA SISWA', 'KELAS', 'JENIS KEKERASAN', 'LOKASI', 'KRONOLOGI', 'DUGAAN PELAKU', 'KONTAK', 'STATUS', 'TANGGAPAN']
    ];
    const body = rows.map((r, i) => [
      i + 1, lib.stampPlain(r.created_at || ''), r.nama_siswa || '', r.kelas_nama || '', r.jenis || '',
      r.lokasi || '', r.kronologi || '', r.pelaku || '', r.kontak || '',
      (dbm.ADUAN_STATUS.find(s => s.key === r.status) || {}).label || r.status, r.tanggapan || ''
    ]);
    const buf = lib.xlsxBuffer('Aduan Kekerasan', [...head, ...body], [5, 18, 24, 16, 24, 18, 50, 20, 18, 12, 40]);
    sendXlsx(res, buf, `aduan-kekerasan-${dbm.today()}.xlsx`);
  });

  /* ---------- publik: halaman & API aduan siswa ---------- */
  function guruByAduanToken(token) {
    return db.prepare('SELECT * FROM users WHERE aduan_token=? AND aktif=1').get(String(token || '')) || null;
  }
  function kelasPublik() {
    const ta = dbm.tahunAktif() || {};
    const rows = db.prepare(`SELECT id,nama FROM kelas WHERE tahun_ajaran_id=? ORDER BY urut,nama`).all(Number(ta.id) || 0);
    if (rows.length) return rows;
    return db.prepare('SELECT id,nama FROM kelas ORDER BY urut,nama').all();
  }
  /**
   * Pencarian siswa untuk halaman publik (aduan & asesmen): minimal 3 huruf,
   * mengembalikan nama + kelas saja. Tanggal lahir TIDAK pernah dikirim ke klien —
   * dipakai hanya untuk verifikasi di server.
   */
  function cariSiswaPublik(q, limit) {
    const kw = String(q || '').trim();
    if (kw.length < 3) return [];
    const like = '%' + kw.toLowerCase() + '%';
    const ta = dbm.tahunAktif() || {};
    return db.prepare(`SELECT s.id, s.nama, s.kelas_id, k.nama AS kelas_nama
      FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE COALESCE(s.status,'aktif')='aktif'
        AND (lower(s.nama) LIKE ? OR s.nisn LIKE ? OR COALESCE(s.nis,'') LIKE ?)
      ORDER BY s.nama LIMIT ?`).all(like, like, like, Math.max(1, Math.min(30, Number(limit) || 12)))
      .map(r => ({ ...r, ta_id: ta.id || null }));
  }
  const normNama = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function siswaDariId(id) {
    return db.prepare(`SELECT s.*, k.nama AS kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE s.id=?`).get(Number(id) || 0) || null;
  }
  function aduanIdentitas() {
    const st = dbm.allSettings();
    return { nama: st.sekolah_nama || '', alamat: st.sekolah_alamat || '', logo: st.logo || st.app_logo || '', app_nama: st.app_nama || '' };
  }

  get('/api/public/aduan/:token/siswa', (req, res, q, params) => {
    const guru = guruByAduanToken(params.token);
    if (!guru) return fail(res, 404, 'Tautan aduan tidak ditemukan atau sudah tidak berlaku.');
    json(res, 200, { ok: true, rows: cariSiswaPublik(q.q, q.limit) });
  });

  get('/api/public/aduan/:token', (req, res, q, params) => {
    const guru = guruByAduanToken(params.token);
    if (!guru) return fail(res, 404, 'Tautan aduan tidak ditemukan atau sudah tidak berlaku.');
    json(res, 200, {
      ok: true,
      guru: { nama: guru.nama, jabatan: guru.jabatan || dbm.roleLabelOf(guru) },
      sekolah: aduanIdentitas(),
      kelas: kelasPublik(),
      jenis: dbm.ADUAN_JENIS,
      layanan: { keswa: guru.aduan_keswa || '', ppa: guru.aduan_ppa || '' }
    });
  });

  post('/api/public/aduan/:token', async (req, res, q, params) => {
    const guru = guruByAduanToken(params.token);
    if (!guru) return fail(res, 404, 'Tautan aduan tidak ditemukan atau sudah tidak berlaku.');
    const b = await readBody(req);
    const dob = parseDOB(b.tanggal_lahir);
    /* data siswa: lewat pilihan autocomplete (siswa_id) atau isian manual lama */
    let siswaPilih = null;
    if (Number(b.siswa_id)) {
      siswaPilih = siswaDariId(b.siswa_id);
      if (!siswaPilih) return fail(res, 404, 'Data siswa tidak ditemukan. Pilih nama dari daftar.');
    }
    const nama = siswaPilih ? siswaPilih.nama : String(b.nama || '').trim().slice(0, 120);
    const kelasId = siswaPilih ? Number(siswaPilih.kelas_id) || 0 : Number(b.kelas_id) || 0;
    const jenis = dbm.ADUAN_JENIS.includes(String(b.jenis)) ? String(b.jenis) : 'Lainnya';
    const kronologi = String(b.kronologi || '').trim();
    const lokasi = String(b.lokasi || '').trim().slice(0, 160);
    const pelaku = String(b.pelaku || '').trim().slice(0, 160);
    const kontak = String(b.kontak || '').trim().slice(0, 60);
    if (nama.length < 3) return fail(res, 400, 'Nama lengkap wajib diisi (minimal 3 karakter).');
    if (!kelasId) return fail(res, 400, 'Pilih kelas Anda.');
    if (!dob) return fail(res, 400, 'Tanggal lahir wajib diisi dengan benar.');
    if (kronologi.length < 20) return fail(res, 400, 'Ceritakan kejadian secara jelas (minimal 20 karakter).');
    const siswa = siswaPilih || db.prepare(`SELECT s.*, k.nama AS kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE lower(trim(s.nama))=lower(trim(?)) AND s.kelas_id=? `).get(nama, kelasId);
    if (!siswa) return fail(res, 404, 'Data siswa tidak ditemukan pada kelas tersebut. Periksa kembali nama dan kelas Anda.');
    if (!siswa.tanggal_lahir) {
      return fail(res, 400, 'Data tanggal lahir siswa belum diisi sekolah. Hubungi Guru BK untuk melengkapi.');
    }
    if (String(siswa.tanggal_lahir).slice(0, 10) !== dob) {
      return fail(res, 403, 'Tanggal lahir tidak cocok dengan data sekolah. Silakan periksa kembali.');
    }
    const ta = dbm.tahunAktif() || {};
    const ins = db.prepare(`INSERT INTO aduan(guru_id,token,siswa_id,nama_siswa,kelas_id,kelas_nama,tanggal_lahir,
        jenis,lokasi,kronologi,pelaku,kontak,status,ta_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'baru',?,?,?)`);
    const r = ins.run(Number(guru.id), String(params.token), Number(siswa.id), siswa.nama, kelasId, siswa.kelas_nama || '',
      dob, jenis, lokasi, kronologi, pelaku, kontak, ta.id || null, dbm.now(), dbm.now());
    try {
      db.prepare('INSERT INTO audit(user_id,nama,role,aksi,modul,detail,ip,created_at) VALUES(NULL,?,?,?,?,?,?,?)')
        .run(siswa.nama, 'siswa', 'ADUAN', 'aduan', `Aduan kekerasan (${jenis}) dari ${siswa.nama} → ${guru.nama}`, ipOf(req), dbm.now());
    } catch (err) { /* audit opsional */ }
    json(res, 200, {
      ok: true, id: Number(r.lastInsertRowid),
      pesan: 'Aduan Anda sudah terkirim ke Guru BK. Identitas Anda hanya dapat dibaca oleh Guru BK yang bersangkutan.',
      layanan: { keswa: guru.aduan_keswa || '', ppa: guru.aduan_ppa || '' }
    });
  });

  /* ---------- CETAK PDF & WORD: KANAL ADUAN + TINDAK LANJUT ---------- */
  function aduanRowsOf(user, q = {}) {
    const status = ['baru', 'diproses', 'selesai'].includes(String(q.status)) ? String(q.status) : 'semua';
    const where = ['guru_id=?'];
    const args = [Number(user.id)];
    if (status !== 'semua') { where.push('status=?'); args.push(status); }
    if (q.from && ISO_RE.test(String(q.from))) { where.push('created_at>=?'); args.push(String(q.from) + ' 00:00:00'); }
    if (q.to && ISO_RE.test(String(q.to))) { where.push('created_at<=?'); args.push(String(q.to) + ' 23:59:59'); }
    if (q.q) {
      where.push('(lower(COALESCE(nama_siswa,\'\')) LIKE ? OR lower(COALESCE(kelas_nama,\'\')) LIKE ? OR lower(COALESCE(kronologi,\'\')) LIKE ?)');
      const l = '%' + String(q.q).toLowerCase() + '%'; args.push(l, l, l);
    }
    return db.prepare(`SELECT * FROM aduan WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 500`).all(...args);
  }
  function aduanStatusLabel(k) {
    const f = dbm.ADUAN_STATUS.find(s => s.key === k);
    return f ? f.label : (k || '-');
  }
  function aduanTtd(st) {
    const tempat = String(st.print_tempat || '').trim();
    return `<div class="ttd-grid">
      <div class="ttd"><div>Mengetahui,<br>Kepala Sekolah</div>
        <div class="nm">${e(st.kepala_nama || '................................')}</div>
        <div>NIP. ${e(st.kepala_nip || '................................')}</div></div>
      <div class="ttd"><div>${tempat ? e(tempat) + ', ' : ''}${e(lib.tglID(dbm.today()))}<br>${e(st.bk_ttd_jabatan || 'Koordinator BK')}</div>
        <div class="nm">${e(st.bk_ttd_guru_nama || st.bk_ttd_nama || '................................')}</div>
        <div>NIP. ${e(st.bk_ttd_nip || '................................')}</div></div>
    </div>`;
  }
  /** ringkasan + rincian aduan beserta tindak lanjutnya (dipakai PDF & Word) */
  function aduanReportBody(rows, user, st) {
    const ring = { baru: 0, diproses: 0, selesai: 0 };
    for (const r of rows) if (ring[r.status] !== undefined) ring[r.status]++;
    const tabel = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${e(lib.tglID(String(r.created_at || '').slice(0, 10)))}</td>
      <td>${e(r.nama_siswa || '-')}<br><span class="pill">${e(r.kelas_nama || '-')}</span></td>
      <td>${e(r.jenis || '-')}</td>
      <td>${e(r.lokasi || '-')}</td>
      <td class="c">${e(aduanStatusLabel(r.status))}</td>
      <td>${e(r.tanggapan || '-').replace(/\n/g, '<br>')}${r.tanggapan_oleh ? `<br><span class="muted">oleh ${e(r.tanggapan_oleh)}</span>` : ''}</td></tr>`).join('');
    const rincian = rows.map((r, i) => `<div class="aduan-item">
      <div class="aduan-head">${i + 1}. ${e(r.nama_siswa || '-')} — ${e(r.kelas_nama || '-')} · ${e(aduanStatusLabel(r.status))}</div>
      <table class="detail">
        <tr><th style="width:22%">Tanggal Laporan</th><td>${e(lib.tglID(String(r.created_at || '').slice(0, 10)))}</td></tr>
        <tr><th>Jenis Kekerasan</th><td>${e(r.jenis || '-')}</td></tr>
        <tr><th>Lokasi Kejadian</th><td>${e(r.lokasi || '-')}</td></tr>
        <tr><th>Kronologi</th><td>${e(r.kronologi || '-').replace(/\n/g, '<br>')}</td></tr>
        <tr><th>Terduga Pelaku</th><td>${e(r.pelaku || '-')}</td></tr>
        <tr><th>Kontak Pelapor</th><td>${e(r.kontak || '-')}</td></tr>
        <tr><th>Tindak Lanjut</th><td>${e(r.tanggapan || 'Belum ditindaklanjuti').replace(/\n/g, '<br>')}
          ${r.tanggapan_oleh ? `<br><span class="muted">Ditangani oleh ${e(r.tanggapan_oleh)} · ${e(String(r.tanggapan_at || '').slice(0, 16))}</span>` : ''}</td></tr>
      </table></div>`).join('');
    return `<div class="meta">
        <span>Guru BK: <b>${e(user.nama)}</b></span>
        <span>Jumlah aduan: <b>${rows.length}</b></span>
        <span>Baru: <b>${ring.baru}</b> · Diproses: <b>${ring.diproses}</b> · Selesai: <b>${ring.selesai}</b></span>
        <span>Dicetak: <b>${e(lib.stampID())}</b></span>
      </div>
      <h3 class="sec">A. Rekapitulasi Aduan</h3>
      <table><thead><tr><th style="width:30px">No</th><th style="width:74px">Tanggal</th><th style="width:16%">Pelapor</th>
        <th style="width:18%">Jenis</th><th style="width:14%">Lokasi</th><th style="width:74px">Status</th>
        <th>Tindak Lanjut</th></tr></thead>
      <tbody>${tabel || '<tr><td colspan="7" class="c muted">Belum ada aduan pada kanal ini.</td></tr>'}</tbody></table>
      <h3 class="sec">B. Rincian &amp; Tindak Lanjut</h3>
      ${rincian || '<p class="muted">Tidak ada rincian.</p>'}`;
  }
  const ADUAN_CSS = `.pill { display:inline-block; padding:1px 6px; border-radius:999px; font-size:8.4pt; border:1px solid #cbd5e1; background:#f8fafc; }
    .aduan-item { page-break-inside: avoid; margin: 0 0 12px; }
    .aduan-head { font-weight: 700; font-size: 10pt; margin: 8px 0 4px; }
    .detail th { background:#f8fafc; text-align:left; }
    .detail td { white-space:pre-wrap; }`;
  get('/api/aduan/cetak', (req, res, q) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const rows = aduanRowsOf(user, q);
    const html = printdoc.page({
      settings: st, title: 'Laporan Kanal Aduan Kekerasan & Tindak Lanjut',
      subtitle: `Kanal ${user.nama} · ${st.sekolah_nama || ''}`,
      body: `${aduanReportBody(rows, user, st)}${aduanTtd(st)}`,
      css: ADUAN_CSS, paper: st.print_paper || 'A4'
    });
    dbm.logAudit(user, 'CETAK', 'aduan', `Cetak laporan aduan kekerasan (${rows.length} aduan)`, ipOf(req));
    sendHTML(res, html);
  });
  get('/api/aduan/word', (req, res, q) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const rows = aduanRowsOf(user, q);
    const html = doc.wordPage({
      settings: st, title: 'LAPORAN KANAL ADUAN KEKERASAN & TINDAK LANJUT',
      subtitle: `Kanal ${user.nama} · ${st.sekolah_nama || ''}`,
      body: `${aduanReportBody(rows, user, st)}${aduanTtd(st)}`
    });
    dbm.logAudit(user, 'EXPORT', 'aduan', `Ekspor Word laporan aduan kekerasan (${rows.length} aduan)`, ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="aduan-kekerasan-${dbm.today()}.doc"`
    });
    res.end(html);
  });
  get('/api/aduan/:id/cetak', (req, res, q, params) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const row = db.prepare('SELECT * FROM aduan WHERE id=? AND guru_id=?').get(Number(params.id), Number(user.id));
    if (!row) return fail(res, 404, 'Aduan tidak ditemukan atau bukan milik kanal Anda.');
    const st = dbm.allSettings();
    const html = printdoc.page({
      settings: st, title: 'Rincian Aduan Kekerasan & Tindak Lanjut',
      subtitle: `Kanal ${user.nama} · ${st.sekolah_nama || ''}`,
      body: `${aduanReportBody([row], user, st)}${aduanTtd(st)}`, css: ADUAN_CSS
    });
    dbm.logAudit(user, 'CETAK', 'aduan', `Cetak rincian aduan #${row.id}`, ipOf(req));
    sendHTML(res, html);
  });
  get('/api/aduan/:id/word', (req, res, q, params) => {
    const user = guard(req, res, 'aduan', 'view'); if (!user) return;
    const row = db.prepare('SELECT * FROM aduan WHERE id=? AND guru_id=?').get(Number(params.id), Number(user.id));
    if (!row) return fail(res, 404, 'Aduan tidak ditemukan atau bukan milik kanal Anda.');
    const st = dbm.allSettings();
    const html = doc.wordPage({
      settings: st, title: 'RINCIAN ADUAN KEKERASAN & TINDAK LANJUT',
      subtitle: `Kanal ${user.nama} · ${st.sekolah_nama || ''}`,
      body: `${aduanReportBody([row], user, st)}${aduanTtd(st)}`
    });
    dbm.logAudit(user, 'EXPORT', 'aduan', `Ekspor Word rincian aduan #${row.id}`, ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="aduan-${row.id}.doc"`
    });
    res.end(html);
  });
  /* tindak lanjut pembinaan (modul Tindak Lanjut) — laporan PDF & Word */
  function tindakRowsOf(user, q = {}) {
    const scope = dbm.scopeWali(user);
    const where = ['1=1'];
    const args = [];
    if (q.from && ISO_RE.test(String(q.from))) { where.push('t.tanggal>=?'); args.push(String(q.from)); }
    if (q.to && ISO_RE.test(String(q.to))) { where.push('t.tanggal<=?'); args.push(String(q.to)); }
    if (q.jenis && dbm.TL_JENIS.includes(String(q.jenis))) { where.push('t.jenis=?'); args.push(String(q.jenis)); }
    if (q.status && dbm.TL_STATUS.some(s => s.key === q.status)) { where.push('t.status=?'); args.push(String(q.status)); }
    if (scope) where.push(scope.length ? `s.kelas_id IN (${scope.join(',')})` : '1=0');
    return db.prepare(`SELECT t.*, s.nama AS siswa_nama, s.nisn, k.nama AS kelas_nama
      FROM tindak_lanjut t LEFT JOIN siswa s ON s.id=t.siswa_id LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE ${where.join(' AND ')} ORDER BY t.tanggal DESC, t.id DESC LIMIT 500`).all(...args);
  }
  function tindakBody(rows) {
    const stT = (k) => (dbm.TL_STATUS.find(x => x.key === k) || {}).label || k;
    const tabel = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${e(lib.tglID(r.tanggal))}</td>
      <td>${e(r.siswa_nama || '-')}<br><span class="pill">${e(r.kelas_nama || '-')}</span></td>
      <td>${e(r.jenis || '-')}</td>
      <td>${e(r.hasil || '-').replace(/\n/g, '<br>')}</td>
      <td class="c">${e(stT(r.status))}</td>
      <td class="c">${r.next_at ? e(lib.tglID(r.next_at)) : '-'}</td>
      <td>${e(r.oleh_nama || '-')}</td></tr>`).join('');
    return `<div class="meta"><span>Jumlah catatan: <b>${rows.length}</b></span>
      <span>Dicetak: <b>${e(lib.stampID())}</b></span></div>
      <table><thead><tr><th style="width:30px">No</th><th style="width:74px">Tanggal</th><th style="width:16%">Siswa</th>
        <th style="width:16%">Jenis Pembinaan</th><th>Hasil</th><th style="width:106px">Status</th>
        <th style="width:74px">Pemantauan</th><th style="width:12%">Petugas</th></tr></thead>
      <tbody>${tabel || '<tr><td colspan="8" class="c muted">Belum ada catatan tindak lanjut.</td></tr>'}</tbody></table>`;
  }
  get('/api/tindak-lanjut/cetak', (req, res, q) => {
    const user = guard(req, res, 'tindak_lanjut', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const rows = tindakRowsOf(user, q);
    const html = printdoc.page({
      settings: st, title: 'Laporan Catatan Tindak Lanjut Pembinaan',
      subtitle: `${st.sekolah_nama || ''}`, body: tindakBody(rows),
      css: ADUAN_CSS, landscape: true, paper: st.print_paper || 'A4'
    });
    dbm.logAudit(user, 'CETAK', 'tindak_lanjut', `Cetak laporan tindak lanjut (${rows.length} catatan)`, ipOf(req));
    sendHTML(res, html);
  });
  get('/api/tindak-lanjut/word', (req, res, q) => {
    const user = guard(req, res, 'tindak_lanjut', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const rows = tindakRowsOf(user, q);
    const html = doc.wordPage({
      settings: st, landscape: true, title: 'LAPORAN CATATAN TINDAK LANJUT PEMBINAAN',
      subtitle: st.sekolah_nama || '', body: tindakBody(rows)
    });
    dbm.logAudit(user, 'EXPORT', 'tindak_lanjut', `Ekspor Word laporan tindak lanjut (${rows.length} catatan)`, ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="tindak-lanjut-${dbm.today()}.doc"`
    });
    res.end(html);
  });

  /* =================================================================
     2. PROGRAM LAYANAN BK
     ================================================================= */
  const KAT_LABEL = () => Object.fromEntries(dbm.BK_KATEGORI.map(k => [k.key, k.label]));
  function jenisList() {
    return db.prepare('SELECT * FROM bk_jenis ORDER BY urut,nama').all();
  }
  function namaKelas(ids) {
    if (!ids || !ids.length) return '';
    const ph = ids.map(() => '?').join(',');
    return db.prepare(`SELECT nama FROM kelas WHERE id IN (${ph}) ORDER BY urut,nama`).all(...ids).map(r => r.nama).join(', ');
  }
  function namaSiswa(ids) {
    if (!ids || !ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    return db.prepare(`SELECT id,nama FROM siswa WHERE id IN (${ph}) ORDER BY nama`).all(...ids);
  }
  function decorateLayanan(r) {
    let kelas = [], siswa = [];
    try { kelas = JSON.parse(r.kelas_ids || '[]'); } catch (err) { kelas = []; }
    try { siswa = JSON.parse(r.siswa_ids || '[]'); } catch (err) { siswa = []; }
    return {
      ...r, kelas_ids: kelas, siswa_ids: siswa,
      kelas_nama: namaKelas(kelas), siswa_detail: namaSiswa(siswa),
      kategori_label: KAT_LABEL()[r.kategori] || r.kategori || '-'
    };
  }
  function layananRows(q = {}) {
    const where = ['1=1'];
    const args = [];
    if (q.kategori && KAT_LABEL()[q.kategori]) { where.push('kategori=?'); args.push(String(q.kategori)); }
    if (q.q) {
      where.push('(lower(COALESCE(topik,\'\')) LIKE ? OR lower(COALESCE(jenis_nama,\'\')) LIKE ? OR lower(COALESCE(uraian,\'\')) LIKE ?)');
      const l = '%' + String(q.q).toLowerCase() + '%'; args.push(l, l, l);
    }
    if (q.from && ISO_RE.test(String(q.from))) { where.push('tanggal>=?'); args.push(String(q.from)); }
    if (q.to && ISO_RE.test(String(q.to))) { where.push('tanggal<=?'); args.push(String(q.to)); }
    return db.prepare(`SELECT * FROM bk_layanan WHERE ${where.join(' AND ')} ORDER BY tanggal DESC, id DESC LIMIT 500`).all(...args)
      .map(decorateLayanan);
  }

  get('/api/bk/layanan', (req, res, q) => {
    if (!guard(req, res, 'bk_layanan', 'view')) return;
    const rows = layananRows(q);
    const counts = { semua: rows.length, dasar: 0, individual: 0, responsif: 0 };
    for (const r of db.prepare('SELECT kategori, COUNT(*) c FROM bk_layanan GROUP BY kategori').all()) {
      if (counts[r.kategori] !== undefined) counts[r.kategori] = Number(r.c);
    }
    const st = dbm.allSettings();
    json(res, 200, {
      ok: true, rows, counts, kategori: dbm.BK_KATEGORI, jenis: jenisList(),
      kelas: dbm.kelasAll().map(k => ({ id: k.id, nama: k.nama, tingkat: k.tingkat, ta_id: k.tahun_ajaran_id })),
      siswa: dbm.siswaRows({ statusSiswa: 'aktif' }).map(s => ({ id: s.id, nama: s.nama, nisn: s.nisn || '', kelas_id: s.kelas_id, kelas_nama: s.kelas_nama })),
      ttd: {
        nama: st.bk_ttd_nama || '', nip: st.bk_ttd_nip || '', jabatan: st.bk_ttd_jabatan || 'Koordinator BK',
        guru_nama: st.bk_ttd_guru_nama || '', kepala_nama: st.kepala_nama || '', kepala_nip: st.kepala_nip || ''
      }
    });
  });

  post('/api/bk/layanan/save', async (req, res) => {
    const user = guard(req, res, 'bk_layanan', 'write'); if (!user) return;
    const b = await readBody(req);
    const jenis = db.prepare('SELECT * FROM bk_jenis WHERE id=?').get(Number(b.jenis_id));
    if (!jenis) return fail(res, 404, 'Jenis layanan BK tidak ditemukan.');
    const topik = String(b.topik || '').trim();
    if (topik.length < 3) return fail(res, 400, 'Topik/tema bimbingan wajib diisi minimal 3 karakter.');
    const kelasIds = intArr(b.kelas_ids);
    const siswaIds = intArr(b.siswa_ids);
    if (!kelasIds.length && !siswaIds.length) return fail(res, 400, 'Pilih minimal satu kelas atau satu siswa sebagai sasaran layanan.');
    const tanggal = ISO_RE.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
    const jam = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.jam || '')) ? String(b.jam) : '';
    const id = Number(b.id) || 0;
    const ada = id ? db.prepare('SELECT * FROM bk_layanan WHERE id=?').get(id) : null;
    let foto = ada ? (ada.foto_url || '') : '';
    if (b.hapus_foto === 1 || b.hapus_foto === '1') foto = '';
    const b64 = String(b.foto || '');
    if (b64 && b64.length > 120) {
      const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
      if (buf.length) {
        const up = await uploadBuffer({
          buf, filename: String(b.foto_nama || 'bukti-layanan-bk.webp'), jenis: 'bukti',
          refTabel: 'bk_layanan', refId: id || 0, user
        });
        if (!up.ok) return fail(res, 400, up.error || 'Gagal mengunggah foto bukti.');
        foto = up.url;
      }
    }
    const ta = dbm.tahunAktif() || {};
    const payload = [
      Number(jenis.id), jenis.nama, jenis.kategori, tanggal, jam,
      JSON.stringify(kelasIds), JSON.stringify(siswaIds),
      topik.slice(0, 200), String(b.tujuan || '').slice(0, 1000), String(b.uraian || '').slice(0, 4000),
      String(b.hasil || '').slice(0, 3000), String(b.tindak_lanjut || '').slice(0, 1000),
      String(b.tempat || '').slice(0, 120), foto
    ];
    let newId = id;
    db.transaction(() => {
      if (ada) {
        db.prepare(`UPDATE bk_layanan SET jenis_id=?,jenis_nama=?,kategori=?,tanggal=?,jam=?,kelas_ids=?,siswa_ids=?,
            topik=?,tujuan=?,uraian=?,hasil=?,tindak_lanjut=?,tempat=?,foto_url=?,updated_at=? WHERE id=?`)
          .run(...payload, dbm.now(), id);
      } else {
        const r = db.prepare(`INSERT INTO bk_layanan(jenis_id,jenis_nama,kategori,tanggal,jam,kelas_ids,siswa_ids,
            topik,tujuan,uraian,hasil,tindak_lanjut,tempat,foto_url,oleh,oleh_nama,oleh_role,ta_id,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(...payload, user.id, user.nama, dbm.roleLabelOf(user), ta.id || null, dbm.now(), dbm.now());
        newId = Number(r.lastInsertRowid);
      }
    })();
    dbm.logAudit(user, ada ? 'UBAH' : 'TAMBAH', 'bk_layanan', `${jenis.nama}: ${topik}`, ipOf(req));
    json(res, 200, { ok: true, id: newId, pesan: `Layanan BK tersimpan (${jenis.nama} — ${topik}).` });
  });

  del('/api/bk/layanan/:id', (req, res, q, params) => {
    const user = guard(req, res, 'bk_layanan', 'delete'); if (!user) return;
    const row = db.prepare('SELECT * FROM bk_layanan WHERE id=?').get(Number(params.id));
    if (!row) return fail(res, 404, 'Catatan layanan tidak ditemukan.');
    dbm.trashAdd(user, 'bk_layanan', row, `Layanan BK — ${row.topik || row.jenis_nama || ''}`);
    db.prepare('DELETE FROM bk_layanan WHERE id=?').run(row.id);
    dbm.logAudit(user, 'HAPUS', 'bk_layanan', `Hapus layanan ${row.jenis_nama || ''}: ${row.topik || ''}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Catatan layanan dipindahkan ke Kotak Sampah.' });
  });

  /* hapus riwayat layanan BK massal (dipindahkan ke Kotak Sampah) */
  post('/api/bk/layanan/delete-masal', async (req, res) => {
    const user = guard(req, res, 'bk_layanan', 'delete'); if (!user) return;
    const b = await readBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(','))
      .map(x => Number(x)).filter(Boolean);
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu catatan layanan yang akan dihapus.');
    const rows = db.prepare(`SELECT * FROM bk_layanan WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    if (!rows.length) return fail(res, 404, 'Catatan layanan tidak ditemukan.');
    db.transaction(() => {
      for (const r of rows) {
        dbm.trashAdd(user, 'bk_layanan', r, `Layanan BK — ${r.topik || r.jenis_nama || ''}`);
        db.prepare('DELETE FROM bk_layanan WHERE id=?').run(r.id);
      }
    })();
    dbm.logAudit(user, 'HAPUS', 'bk_layanan',
      `Hapus ${rows.length} riwayat layanan BK: ${rows.map(r => `${r.jenis_nama || ''} ${r.topik || ''}`.trim()).join(', ')}`, ipOf(req));
    json(res, 200, { ok: true, jumlah: rows.length, pesan: `${rows.length} riwayat layanan dipindahkan ke Kotak Sampah.` });
  });

  post('/api/bk/jenis/save', async (req, res) => {
    const user = guard(req, res, 'bk_layanan', 'write'); if (!user) return;
    const b = await readBody(req);
    const nama = String(b.nama || '').trim();
    if (nama.length < 3) return fail(res, 400, 'Nama jenis layanan minimal 3 karakter.');
    const kategori = dbm.BK_KATEGORI.some(k => k.key === b.kategori) ? String(b.kategori) : 'responsif';
    const sasaran = ['kelas', 'siswa', 'keduanya'].includes(String(b.sasaran)) ? String(b.sasaran) : 'siswa';
    const aktif = b.aktif === 0 || b.aktif === '0' ? 0 : 1;
    if (b.id) {
      db.prepare('UPDATE bk_jenis SET nama=?,kategori=?,sasaran=?,aktif=? WHERE id=?')
        .run(nama, kategori, sasaran, aktif, Number(b.id));
      dbm.logAudit(user, 'UBAH', 'bk_layanan', `Ubah jenis layanan BK ${nama}`, ipOf(req));
      return json(res, 200, { ok: true, pesan: 'Jenis layanan diperbarui.' });
    }
    const urut = (db.prepare('SELECT COALESCE(MAX(urut),0) m FROM bk_jenis').get().m || 0) + 1;
    db.prepare('INSERT INTO bk_jenis(nama,kategori,sasaran,aktif,urut,created_at) VALUES(?,?,?,?,?,?)')
      .run(nama, kategori, sasaran, aktif, urut, dbm.now());
    dbm.logAudit(user, 'TAMBAH', 'bk_layanan', `Tambah jenis layanan BK ${nama}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Jenis layanan ditambahkan.' });
  });

  post('/api/bk/jenis/delete', async (req, res) => {
    const user = guard(req, res, 'bk_layanan', 'write'); if (!user) return;
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM bk_jenis WHERE id=?').get(Number(b.id));
    if (!row) return fail(res, 404, 'Jenis layanan tidak ditemukan.');
    const dipakai = db.prepare('SELECT COUNT(*) c FROM bk_layanan WHERE jenis_id=?').get(row.id).c;
    if (dipakai) return fail(res, 400, `Jenis layanan "${row.nama}" sudah dipakai ${dipakai} catatan. Nonaktifkan saja agar riwayat tetap utuh.`);
    db.prepare('DELETE FROM bk_jenis WHERE id=?').run(row.id);
    dbm.logAudit(user, 'HAPUS', 'bk_layanan', `Hapus jenis layanan BK ${row.nama}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Jenis layanan dihapus.' });
  });

  post('/api/bk/ttd', async (req, res) => {
    const user = guard(req, res, 'bk_layanan', 'write'); if (!user) return;
    const b = await readBody(req);
    dbm.setSetting('bk_ttd_nama', String(b.nama || '').trim().slice(0, 120));
    dbm.setSetting('bk_ttd_nip', String(b.nip || '').trim().slice(0, 40));
    dbm.setSetting('bk_ttd_jabatan', String(b.jabatan || 'Koordinator BK').trim().slice(0, 80) || 'Koordinator BK');
    dbm.setSetting('bk_ttd_guru_nama', String(b.guru_nama || '').trim().slice(0, 120));
    dbm.logAudit(user, 'UBAH', 'bk_layanan', 'Memperbarui pengaturan tanda tangan dokumen BK', ipOf(req));
    json(res, 200, { ok: true, pesan: 'Pengaturan tanda tangan tersimpan.' });
  });

  get('/api/bk/layanan/export', (req, res, q) => {
    if (!guard(req, res, 'bk_layanan', 'view')) return;
    const rows = layananRows(q);
    const st = dbm.allSettings();
    const head = [
      [{ v: 'PROGRAM LAYANAN BK (BIMBINGAN KONSELING KOMPREHENSIF)', bold: true }],
      [{ v: `${st.sekolah_nama || ''} · dicetak ${lib.stampID(lib.nowStamp())}` }],
      [],
      ['NO', 'TANGGAL', 'JAM', 'KATEGORI', 'JENIS LAYANAN', 'SASARAN', 'TOPIK', 'TUJUAN', 'URAIAN KEGIATAN', 'HASIL', 'TINDAK LANJUT', 'TEMPAT', 'PENCATAT']
    ];
    const body = rows.map((r, i) => [
      i + 1, lib.tglID(r.tanggal), r.jam || '', r.kategori_label, r.jenis_nama || '',
      [r.kelas_nama, r.siswa_detail.map(s => s.nama).join(', ')].filter(Boolean).join(' · '),
      r.topik || '', r.tujuan || '', r.uraian || '', r.hasil || '', r.tindak_lanjut || '',
      r.tempat || '', r.oleh_nama || ''
    ]);
    const buf = lib.xlsxBuffer('Program Layanan BK', [...head, ...body], [5, 12, 8, 22, 26, 30, 30, 32, 50, 40, 30, 16, 22]);
    sendXlsx(res, buf, `program-layanan-bk-${dbm.today()}.xlsx`);
  });

  /* ---------- CETAK PDF & WORD: DAFTAR PROGRAM LAYANAN BK ---------- */
  function layananListBody(rows, st) {
    const baris = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${e(lib.tglID(r.tanggal))}</td>
      <td>${e(r.jenis_nama || '-')}<br><span class="pill">${e(r.kategori_label)}</span></td>
      <td>${e(r.kelas_nama || '-')}</td>
      <td>${e(r.siswa_detail.map(x => x.nama).join(', ') || '-')}</td>
      <td>${e(r.topik || '-')}</td>
      <td>${e(r.hasil || r.uraian || '-').replace(/\n/g, '<br>')}</td>
      <td>${e(r.tindak_lanjut || '-')}</td></tr>`).join('');
    return `<div class="meta">
        <span>Jumlah layanan: <b>${rows.length}</b></span>
        <span>Dicetak: <b>${e(lib.stampID())}</b></span>
      </div>
      <table><thead><tr><th style="width:32px">No</th><th style="width:80px">Tanggal</th><th style="width:15%">Jenis Layanan</th>
        <th style="width:10%">Kelas</th><th style="width:18%">Siswa</th><th style="width:16%">Topik / Tema</th>
        <th>Hasil / Uraian</th><th style="width:14%">Tindak Lanjut</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="8" class="c muted">Belum ada catatan layanan BK.</td></tr>'}</tbody></table>`;
  }
  function layananTtd(st) {
    const tempat = String(st.print_tempat || '').trim();
    return `<div class="ttd-grid">
      <div class="ttd"><div>Mengetahui,<br>Kepala Sekolah</div>
        <div class="nm">${e(st.kepala_nama || '................................')}</div>
        <div>NIP. ${e(st.kepala_nip || '................................')}</div></div>
      <div class="ttd"><div>${tempat ? e(tempat) + ', ' : ''}${e(lib.tglID(dbm.today()))}<br>${e(st.bk_ttd_jabatan || 'Koordinator BK')}</div>
        <div class="nm">${e(st.bk_ttd_guru_nama || st.bk_ttd_nama || '................................')}</div>
        <div>NIP. ${e(st.bk_ttd_nip || '................................')}</div></div>
    </div>`;
  }
  get('/api/bk/layanan/cetak', (req, res, q) => {
    const user = guard(req, res, 'bk_layanan', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const rows = layananRows(q);
    const filter = [];
    if (q.kategori && KAT_LABEL()[q.kategori]) filter.push(`Kategori: ${KAT_LABEL()[q.kategori]}`);
    if (q.from || q.to) filter.push(`Periode: ${q.from ? lib.tglID(q.from) : '…'} s.d. ${q.to ? lib.tglID(q.to) : '…'}`);
    if (q.q) filter.push(`Pencarian: "${q.q}"`);
    const html = printdoc.page({
      settings: st, title: 'Laporan Program Layanan Bimbingan Konseling',
      subtitle: filter.join(' · ') || 'Seluruh catatan layanan BK',
      body: `${layananListBody(rows, st)}${layananTtd(st)}`,
      css: `.pill { display:inline-block; padding:1px 6px; border-radius:999px; font-size:8.4pt; border:1px solid #cbd5e1; background:#f8fafc; }`,
      landscape: true, paper: st.print_paper || 'A4'
    });
    dbm.logAudit(user, 'CETAK', 'bk_layanan', `Cetak daftar layanan BK (${rows.length} catatan)`, ipOf(req));
    sendHTML(res, html);
  });
  get('/api/bk/layanan/word', (req, res, q) => {
    const user = guard(req, res, 'bk_layanan', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const rows = layananRows(q);
    const html = doc.wordPage({
      settings: st, landscape: true,
      title: 'LAPORAN PROGRAM LAYANAN BIMBINGAN KONSELING',
      subtitle: q.from || q.to ? `Periode ${q.from ? lib.tglID(q.from) : '…'} s.d. ${q.to ? lib.tglID(q.to) : '…'}` : '',
      body: `${layananListBody(rows, st)}${layananTtd(st)}`
    });
    dbm.logAudit(user, 'EXPORT', 'bk_layanan', `Ekspor Word daftar layanan BK (${rows.length} catatan)`, ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="layanan-bk-${dbm.today()}.doc"`
    });
    res.end(html);
  });

  /** body dokumen SATU catatan layanan (dipakai cetak PDF & ekspor Word) */
  function layananDetailBody(row, st) {
    const tempat = st.print_tempat || 'Cikoneng';
    const baris = (label, val) => `<tr><th style="width:26%;text-align:left">${e(label)}</th><td>${val || '-'}</td></tr>`;
    const namaSiswaTxt = row.siswa_detail.map(s => e(s.nama)).join(', ') || '-';
    const body = `
      <table class="detail">
        ${baris('Hari / Tanggal', `${e(dbm.HARI_LABEL[dbm.hariOf(row.tanggal)] || '')}, ${e(tglPanjang(row.tanggal))}`)}
        ${baris('Waktu', e(row.jam || '-'))}
        ${baris('Jenis Layanan', `${e(row.jenis_nama || '')} <span class="pill">${e(row.kategori_label)}</span>`)}
        ${baris('Sasaran Kelas', e(row.kelas_nama || '-'))}
        ${baris('Sasaran Siswa', namaSiswaTxt)}
        ${baris('Topik / Tema', e(row.topik || '-'))}
        ${baris('Tujuan Layanan', e(row.tujuan || '-'))}
        ${baris('Uraian Kegiatan', e(row.uraian || '-').replace(/\n/g, '<br>'))}
        ${baris('Hasil yang Dicapai', e(row.hasil || '-').replace(/\n/g, '<br>'))}
        ${baris('Tindak Lanjut', e(row.tindak_lanjut || '-'))}
        ${baris('Tempat', e(row.tempat || '-'))}
        ${baris('Dicatat oleh', `${e(row.oleh_nama || '-')} <span class="muted">(${e(row.oleh_role || '')})</span>`)}
      </table>
      ${row.foto_url ? `<div class="foto-wrap"><h3 class="sec">Foto Bukti Kegiatan</h3><img class="foto" src="${e(row.foto_url)}" alt="Bukti kegiatan"></div>` : ''}
      <div class="ttd-grid">
        <div class="ttd"><div>Mengetahui,<br>Kepala Sekolah</div>
          <div class="nm">${e(st.kepala_nama || '................................')}</div>
          <div>NIP. ${e(st.kepala_nip || '................................')}</div></div>
        <div class="ttd"><div>${e(tempat)}, ${e(tglPanjang(row.tanggal))}<br>${e(st.bk_ttd_jabatan || 'Koordinator BK')}</div>
          <div class="nm">${e(st.bk_ttd_guru_nama || st.bk_ttd_nama || '................................')}</div>
          <div>NIP. ${e(st.bk_ttd_nip || '................................')}</div></div>
      </div>`;
    return { body, css: `.detail th { background:#f8fafc; } .detail td { white-space:pre-wrap; }
        .foto-wrap { margin-top:14px; } .foto { max-width:100%; max-height:320px; border:1px solid #cbd5e1; border-radius:8px; }` };
  }
  get('/api/bk/layanan/:id/cetak', (req, res, q, params) => {
    const user = guard(req, res, 'bk_layanan', 'view'); if (!user) return;
    const raw = db.prepare('SELECT * FROM bk_layanan WHERE id=?').get(Number(params.id));
    if (!raw) return fail(res, 404, 'Catatan layanan tidak ditemukan.');
    const row = decorateLayanan(raw);
    const st = dbm.allSettings();
    const dok = layananDetailBody(row, st);
    const html = printdoc.page({
      settings: st, title: 'Laporan Layanan Bimbingan Konseling',
      subtitle: `Format Komprehensif BK · ${st.sekolah_nama || ''}`,
      body: dok.body, css: dok.css
    });
    dbm.logAudit(user, 'CETAK', 'bk_layanan', `Cetak laporan layanan BK: ${row.topik || '-'}`, ipOf(req));
    sendHTML(res, html);
  });
  get('/api/bk/layanan/:id/word', (req, res, q, params) => {
    const user = guard(req, res, 'bk_layanan', 'view'); if (!user) return;
    const raw = db.prepare('SELECT * FROM bk_layanan WHERE id=?').get(Number(params.id));
    if (!raw) return fail(res, 404, 'Catatan layanan tidak ditemukan.');
    const row = decorateLayanan(raw);
    const st = dbm.allSettings();
    const dok = layananDetailBody(row, st);
    const html = doc.wordPage({
      settings: st, title: 'LAPORAN LAYANAN BIMBINGAN KONSELING',
      subtitle: `Format Komprehensif BK · ${st.sekolah_nama || ''}`,
      body: dok.body
    });
    dbm.logAudit(user, 'EXPORT', 'bk_layanan', `Ekspor Word laporan layanan BK: ${row.topik || '-'}`, ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="layanan-bk-${row.id}.doc"`
    });
    res.end(html);
  });

  /* =================================================================
     3. ASESMEN SISWA BK
     ================================================================= */
  function instrumenAll() {
    return db.prepare('SELECT * FROM asesmen_instrumen ORDER BY kode').all().map(i => {
      const st = dbm.ASESMEN_DEFAULT.find(d => d.kode === i.kode) || {};
      return {
        ...i, nama: i.nama || st.nama || i.kode, deskripsi: i.deskripsi || st.deskripsi || '',
        petunjuk: i.petunjuk || st.petunjuk || '',
        kategori: dbm.ASESMEN_KATEGORI[i.kode] || [],
        jumlah_soal: db.prepare('SELECT COUNT(*) c FROM asesmen_soal WHERE kode=? AND aktif=1').get(i.kode).c,
        jumlah_hasil: db.prepare('SELECT COUNT(*) c FROM asesmen_hasil WHERE kode=?').get(i.kode).c
      };
    });
  }
  function ensureAsesmenToken(req, kode) {
    const row = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(String(kode));
    if (!row) return null;
    if (row.token) return row;
    const token = `${tenantKode(req)}.as.${crypto.randomBytes(9).toString('hex')}`;
    db.prepare('UPDATE asesmen_instrumen SET token=?,updated_at=? WHERE kode=?').run(token, dbm.now(), row.kode);
    return db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(row.kode);
  }
  function linkOf(req, row) {
    const url = absUrl(req, `/asesmen/${row.token}`);
    return { url, token: row.token, aktif: !!row.token_aktif, created_at: row.updated_at || row.created_at || '' };
  }

  get('/api/asesmen', (req, res) => {
    if (!guard(req, res, 'asesmen', 'view')) return;
    const rows = instrumenAll();
    json(res, 200, { ok: true, rows, kategori: dbm.ASESMEN_KATEGORI });
  });

  get('/api/asesmen/link', async (req, res, q) => {
    if (!guard(req, res, 'asesmen', 'view')) return;
    const row = ensureAsesmenToken(req, q.kode);
    if (!row) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const link = linkOf(req, row);
    const qr = await qrPair(link.url);
    json(res, 200, { ok: true, ...link, qr });
  });

  post('/api/asesmen/link', async (req, res) => {
    const user = guard(req, res, 'asesmen', 'write'); if (!user) return;
    const b = await readBody(req);
    let row = ensureAsesmenToken(req, b.kode);
    if (!row) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    if (b.rotate === 1 || b.rotate === '1') {
      const token = `${tenantKode(req)}.as.${crypto.randomBytes(9).toString('hex')}`;
      db.prepare('UPDATE asesmen_instrumen SET token=?,token_aktif=1,updated_at=? WHERE kode=?').run(token, dbm.now(), row.kode);
      row = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(row.kode);
      dbm.logAudit(user, 'UBAH', 'asesmen', `Mereset tautan publik asesmen ${row.nama}`, ipOf(req));
    } else if (b.aktif !== undefined) {
      const aktif = (b.aktif === 1 || b.aktif === '1' || b.aktif === true) ? 1 : 0;
      db.prepare('UPDATE asesmen_instrumen SET token_aktif=?,updated_at=? WHERE kode=?').run(aktif, dbm.now(), row.kode);
      row = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(row.kode);
      dbm.logAudit(user, 'UBAH', 'asesmen', `${aktif ? 'Mengaktifkan' : 'Menonaktifkan'} tautan publik asesmen ${row.nama}`, ipOf(req));
    }
    const link = linkOf(req, row);
    const qr = await qrPair(link.url);
    json(res, 200, { ok: true, ...link, qr, pesan: (b.rotate ? 'QR & tautan baru dibuat. Tautan lama tidak berlaku lagi.' : 'Pengaturan tautan tersimpan.') });
  });

  /* ---------- bank soal ---------- */
  function soalRows(kode, onlyActive) {
    const w = onlyActive ? 'AND aktif=1' : '';
    return db.prepare(`SELECT * FROM asesmen_soal WHERE kode=? ${w} ORDER BY nomor,id`).all(String(kode));
  }
  get('/api/asesmen/soal', (req, res, q) => {
    if (!guard(req, res, 'asesmen_soal', 'view')) return;
    const kode = String(q.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    json(res, 200, {
      ok: true, instrumen: ins, soal: soalRows(kode, false),
      semua_instrumen: instrumenAll(), kategori: dbm.ASESMEN_KATEGORI[kode] || [],
      tipe_label: ins.tipe === 'likert4' ? 'Skala Likert 1–4' : 'Centang (Ya/Tidak)'
    });
  });

  post('/api/asesmen/soal/save', async (req, res) => {
    const user = guard(req, res, 'asesmen_soal', 'write'); if (!user) return;
    const b = await readBody(req);
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(String(b.kode));
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const teks = String(b.teks || '').trim();
    if (teks.length < 5) return fail(res, 400, 'Butir pernyataan minimal 5 karakter.');
    const kategori = String(b.kategori || '').trim();
    const cats = (dbm.ASESMEN_KATEGORI[ins.kode] || []).map(c => c.key);
    if (cats.length && !cats.includes(kategori)) return fail(res, 400, 'Kategori analisis wajib dipilih sesuai instrumen.');
    const indikator = String(b.indikator || '').trim().slice(0, 120);
    const aktif = b.aktif === 0 || b.aktif === '0' ? 0 : 1;
    if (b.id) {
      db.prepare('UPDATE asesmen_soal SET teks=?,kategori=?,indikator=?,aktif=? WHERE id=? AND kode=?')
        .run(teks, kategori, indikator, aktif, Number(b.id), ins.kode);
      dbm.logAudit(user, 'UBAH', 'asesmen_soal', `Ubah butir ${ins.kode}: ${teks.slice(0, 60)}`, ipOf(req));
      return json(res, 200, { ok: true, pesan: 'Butir pernyataan diperbarui.' });
    }
    const nomor = (db.prepare('SELECT COALESCE(MAX(nomor),0) m FROM asesmen_soal WHERE kode=?').get(ins.kode).m || 0) + 1;
    db.prepare('INSERT INTO asesmen_soal(kode,nomor,teks,kategori,indikator,aktif,versi,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(ins.kode, nomor, teks, kategori, indikator, aktif, Number(ins.versi) || 1, dbm.now());
    dbm.logAudit(user, 'TAMBAH', 'asesmen_soal', `Tambah butir ${ins.kode}: ${teks.slice(0, 60)}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Butir pernyataan ditambahkan.' });
  });

  post('/api/asesmen/soal/delete', async (req, res) => {
    const user = guard(req, res, 'asesmen_soal', 'write'); if (!user) return;
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM asesmen_soal WHERE id=?').get(Number(b.id));
    if (!row) return fail(res, 404, 'Butir tidak ditemukan.');
    db.prepare('DELETE FROM asesmen_soal WHERE id=?').run(row.id);
    dbm.logAudit(user, 'HAPUS', 'asesmen_soal', `Hapus butir ${row.kode}: ${String(row.teks).slice(0, 60)}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Butir pernyataan dihapus.' });
  });

  /* hapus butir soal massal (ceklis + Pilih Semua) */
  post('/api/asesmen/soal/delete-masal', async (req, res) => {
    const user = guard(req, res, 'asesmen_soal', 'write'); if (!user) return;
    const b = await readBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(','))
      .map(x => Number(x)).filter(Boolean);
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu butir pernyataan yang akan dihapus.');
    const rows = db.prepare(`SELECT * FROM asesmen_soal WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    if (!rows.length) return fail(res, 404, 'Butir pernyataan tidak ditemukan.');
    db.transaction(() => {
      for (const r of rows) db.prepare('DELETE FROM asesmen_soal WHERE id=?').run(r.id);
      /* nomor butir dirapikan per instrumen */
      for (const kode of [...new Set(rows.map(r => r.kode))]) {
        const sisa = db.prepare('SELECT id FROM asesmen_soal WHERE kode=? ORDER BY nomor, id').all(kode);
        sisa.forEach((r, i) => db.prepare('UPDATE asesmen_soal SET nomor=? WHERE id=?').run(i + 1, r.id));
      }
    })();
    dbm.logAudit(user, 'HAPUS', 'asesmen_soal',
      `Hapus ${rows.length} butir soal: ${rows.map(r => `${r.kode}#${r.nomor}`).join(', ')}`, ipOf(req));
    json(res, 200, {
      ok: true, jumlah: rows.length,
      pesan: `${rows.length} butir pernyataan dihapus. Hasil asesmen yang sudah masuk tetap tersimpan.`
    });
  });

  post('/api/asesmen/soal/simpan', async (req, res) => {
    const user = guard(req, res, 'asesmen_soal', 'write'); if (!user) return;
    const b = await readBody(req);
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(String(b.kode));
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const cats = (dbm.ASESMEN_KATEGORI[ins.kode] || []).map(c => c.key);
    const bersih = [];
    for (const r of rows) {
      const teks = String(r.teks || '').trim();
      if (!teks) continue;
      if (teks.length < 5) return fail(res, 400, `Butir "${teks.slice(0, 40)}" terlalu pendek (minimal 5 karakter).`);
      const kategori = String(r.kategori || '').trim();
      if (cats.length && !cats.includes(kategori)) return fail(res, 400, `Kategori "${kategori || '-'}" tidak dikenal untuk instrumen ini.`);
      bersih.push({ id: Number(r.id) || 0, teks, kategori, indikator: String(r.indikator || '').trim().slice(0, 120), aktif: r.aktif === 0 || r.aktif === '0' ? 0 : 1 });
    }
    if (!bersih.length) return fail(res, 400, 'Tidak ada butir pernyataan yang tersimpan.');
    const versi = (Number(ins.versi) || 1) + 1;
    db.transaction(() => {
      db.prepare('UPDATE asesmen_instrumen SET versi=?,nama=?,deskripsi=?,petunjuk=?,tipe=?,aktif=?,updated_at=? WHERE kode=?')
        .run(versi, String(b.nama || ins.nama).slice(0, 160), String(b.deskripsi || ins.deskripsi || '').slice(0, 600),
          String(b.petunjuk || ins.petunjuk || '').slice(0, 1200),
          ['likert4', 'centang'].includes(b.tipe) ? b.tipe : ins.tipe,
          b.aktif === 0 || b.aktif === '0' ? 0 : 1, dbm.now(), ins.kode);
      let nomor = 0;
      for (const r of bersih) {
        nomor++;
        if (r.id) db.prepare('UPDATE asesmen_soal SET nomor=?,teks=?,kategori=?,indikator=?,aktif=?,versi=? WHERE id=? AND kode=?')
          .run(nomor, r.teks, r.kategori, r.indikator, r.aktif, versi, r.id, ins.kode);
        else db.prepare('INSERT INTO asesmen_soal(kode,nomor,teks,kategori,indikator,aktif,versi,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(ins.kode, nomor, r.teks, r.kategori, r.indikator, r.aktif, versi, dbm.now());
      }
    })();
    dbm.logAudit(user, 'UBAH', 'asesmen_soal', `Bank soal ${ins.kode} diperbarui (versi ${versi}, ${bersih.length} butir)`, ipOf(req));
    json(res, 200, {
      ok: true, versi, pesan: `Bank soal diperbarui (versi ${versi}). Hasil asesmen yang sudah masuk tetap tersimpan dengan versi lamanya.`
    });
  });

  get('/api/asesmen/template.xlsx', (req, res, q) => {
    if (!guard(req, res, 'asesmen_soal', 'view')) return;
    const kode = String(q.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const cats = dbm.ASESMEN_KATEGORI[kode] || [];
    const contohKat = cats.map(c => c.key).join(' / ');
    const sample = kode === 'akpd'
      ? ['Saya ingin lebih percaya diri saat tampil di depan kelas', 'pribadi', 'Kepercayaan diri']
      : kode === 'riasec'
        ? ['Saya suka memperbaiki peralatan yang rusak', 'R', 'Realistic']
        : kode === 'gaya'
          ? ['Saya lebih mudah paham dengan melihat gambar atau bagan', 'visual', 'Visual']
          : ['Saya sering menunda mengerjakan tugas', 'internal', 'Manajemen waktu'];
    const rows = [
      [{ v: `TEMPLATE BANK SOAL — ${ins.nama}`, bold: true }],
      [{ v: `Kategori yang sah: ${contohKat}. Isi data mulai baris ke-4.` }],
      [{ v: 'NO', bold: true }, { v: 'PERNYATAAN', bold: true }, { v: 'KATEGORI', bold: true }, { v: 'INDIKATOR', bold: true }],
      [1, ...sample],
      [2, 'Contoh butir kedua — ganti dengan pernyataan Anda', cats[0] ? cats[0].key : '', cats[0] ? cats[0].label : '']
    ];
    const buf = lib.xlsxBuffer(`Bank Soal ${kode}`, rows, [6, 70, 16, 30]);
    sendXlsx(res, buf, `template-soal-${kode}.xlsx`);
  });

  function previewSoal(kode, buf, filename) {
    const rows = rowsOf(buf, filename);
    const headerIdx = rows.findIndex(r => {
      const head = (r || []).map(c => norm(txt(c)));
      const col = (...names) => {
        const exact = head.findIndex(h => names.includes(h));
        return exact >= 0 ? exact : head.findIndex(h => names.some(n => h.includes(n)));
      };
      const cTeks = col('pernyataan', 'soal', 'pertanyaan', 'teks');
      const cKategori = col('kategori', 'bidang', 'tipe', 'dimensi');
      return cTeks >= 0 && cKategori >= 0 && cTeks !== cKategori;
    });
    if (headerIdx < 0) throw new Error('Header kolom (NO, PERNYATAAN, KATEGORI, INDIKATOR) tidak ditemukan pada berkas.');
    const head = rows[headerIdx].map(h => norm(txt(h)));
    const col = (...names) => head.findIndex(h => names.some(n => h.includes(n)));
    const cTeks = col('pernyataan', 'soal', 'pertanyaan', 'teks');
    const cKat = col('kategori', 'bidang', 'tipe', 'dimensi');
    const cInd = col('indikator', 'sub', 'keterangan');
    if (cTeks < 0) throw new Error('Kolom PERNYATAAN wajib ada pada berkas import.');
    const cats = (dbm.ASESMEN_KATEGORI[kode] || []).map(c => c.key);
    const labelOf = Object.fromEntries((dbm.ASESMEN_KATEGORI[kode] || []).map(c => [norm(c.label), c.key]));
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const teks = String(txt(r[cTeks]) || '').trim();
      if (!teks || /^(jumlah|total|keterangan|catatan)\b/i.test(teks)) continue;
      let kategori = cKat >= 0 ? String(txt(r[cKat]) || '').trim() : '';
      const kLower = norm(kategori);
      const katKey = cats.find(c => c.toLowerCase() === kLower) || labelOf[kLower] || (cats.length === 1 ? cats[0] : '');
      const errs = [];
      if (teks.length < 5) errs.push('Pernyataan terlalu pendek');
      if (cats.length && !katKey) errs.push(`Kategori "${kategori || '-'}" tidak dikenal (pilih: ${cats.join(', ')})`);
      out.push({
        baris: i + 1, teks, kategori: katKey || kategori,
        kategori_label: (dbm.ASESMEN_KATEGORI[kode] || []).find(c => c.key === (katKey || kategori))?.label || kategori,
        indikator: cInd >= 0 ? String(txt(r[cInd]) || '').trim() : '',
        error: errs.join(' • ')
      });
    }
    return out;
  }

  post('/api/asesmen/import/preview', async (req, res) => {
    if (!guard(req, res, 'asesmen_soal', 'write')) return;
    const b = await readBody(req);
    try {
      const kode = String(b.kode || 'akpd');
      const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
      if (!buf.length) return fail(res, 400, 'Berkas kosong / tidak terbaca.');
      const rows = previewSoal(kode, buf, String(b.filename || 'import.xlsx'));
      if (!rows.length) return fail(res, 400, 'Tidak ada baris pernyataan yang terdeteksi (gunakan template).');
      json(res, 200, { ok: true, rows, total: rows.length, siap: rows.filter(r => !r.error).length });
    } catch (err) { fail(res, 400, err.message); }
  });

  post('/api/asesmen/import/commit', async (req, res) => {
    const user = guard(req, res, 'asesmen_soal', 'write'); if (!user) return;
    const b = await readBody(req);
    const kode = String(b.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const ganti = b.mode === 'ganti';
    let masuk = 0;
    db.transaction(() => {
      if (ganti) db.prepare('DELETE FROM asesmen_soal WHERE kode=?').run(kode);
      let nomor = ganti ? 0 : (db.prepare('SELECT COALESCE(MAX(nomor),0) m FROM asesmen_soal WHERE kode=?').get(kode).m || 0);
      const insRow = db.prepare('INSERT INTO asesmen_soal(kode,nomor,teks,kategori,indikator,aktif,versi,created_at) VALUES(?,?,?,?,?,1,?,?)');
      for (const r of rows) {
        if (r.error) continue;
        nomor++;
        insRow.run(kode, nomor, String(r.teks || '').trim(), String(r.kategori || ''), String(r.indikator || ''), Number(ins.versi) || 1, dbm.now());
        masuk++;
      }
      db.prepare('UPDATE asesmen_instrumen SET versi=versi+1,updated_at=? WHERE kode=?').run(dbm.now(), kode);
    })();
    dbm.logAudit(user, 'IMPORT', 'asesmen_soal', `Import bank soal ${kode}: ${masuk} butir${ganti ? ' (mengganti)' : ''}`, ipOf(req));
    json(res, 200, { ok: true, masuk, pesan: `${masuk} butir pernyataan diimpor. Versi bank soal diperbarui.` });
  });

  /* ---------- publik: pengisian asesmen (satu kali) ---------- */
  function instrumenByToken(token) {
    return db.prepare('SELECT * FROM asesmen_instrumen WHERE token=? AND token_aktif=1 AND aktif=1').get(String(token || '')) || null;
  }
  function cariSiswa(nisn, nama) {
    const n = String(nisn || '').trim();
    const nm = String(nama || '').trim();
    if (!n || !nm) return null;
    return db.prepare(`SELECT s.*, k.nama AS kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
      WHERE (lower(trim(s.nisn))=lower(trim(?)) OR lower(trim(COALESCE(s.nis,'')))=lower(trim(?)))
        AND lower(trim(s.nama))=lower(trim(?))`)
      .get(n, n, nm) || null;
  }
  /**
   * Identitas pengisi asesmen: pilihan dari autocomplete (siswa_id) atau nama+kelas,
   * DIVALIDASI dengan TANGGAL LAHIR (bukan NISN lagi). Mengembalikan
   * { siswa } bila sah, atau { error, status } bila tidak.
   */
  function identitasSiswa(b) {
    const body = b || {};
    const dob = parseDOB(body.tanggal_lahir);
    let siswa = null;
    if (Number(body.siswa_id)) {
      siswa = siswaDariId(body.siswa_id);
      if (!siswa) return { status: 404, error: 'Data siswa tidak ditemukan. Pilih nama dari daftar yang muncul saat mengetik.' };
    } else if (isLegacyNisn(body)) {
      /* kompatibilitas: pengisian lama memakai NISN + nama */
      siswa = cariSiswa(body.nisn, body.nama);
      if (!siswa) return { status: 404, error: 'Data siswa tidak ditemukan. Periksa NISN dan nama lengkap sesuai data sekolah.' };
      return { siswa };
    } else {
      const nama = String(body.nama || '').trim();
      const kelasId = Number(body.kelas_id) || 0;
      if (!nama) return { status: 400, error: 'Nama siswa wajib dipilih dari daftar.' };
      siswa = kelasId
        ? db.prepare(`SELECT s.*, k.nama AS kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
            WHERE lower(trim(s.nama))=lower(trim(?)) AND s.kelas_id=?`).get(nama, kelasId)
        : db.prepare(`SELECT s.*, k.nama AS kelas_nama FROM siswa s LEFT JOIN kelas k ON k.id=s.kelas_id
            WHERE lower(trim(s.nama))=lower(trim(?))`).get(nama);
      if (!siswa) return { status: 404, error: 'Data siswa tidak ditemukan. Pilih nama dari daftar yang muncul saat mengetik.' };
    }
    if (!dob) return { status: 400, error: 'Tanggal lahir wajib diisi untuk verifikasi identitas.' };
    if (!siswa.tanggal_lahir) {
      return { status: 400, error: 'Tanggal lahir siswa belum diisi sekolah. Hubungi Guru BK untuk melengkapinya.' };
    }
    if (String(siswa.tanggal_lahir).slice(0, 10) !== dob) {
      return { status: 403, error: 'Tanggal lahir tidak cocok dengan data sekolah. Periksa kembali.' };
    }
    return { siswa };
  }
  const isLegacyNisn = (b) => !Number(b.siswa_id) && String(b.nisn || '').trim().length > 0;
  function nilaiJawaban(tipe, v) {
    if (tipe === 'likert4') {
      const n = Math.round(Number(v));
      return n >= 1 && n <= 4 ? n : 0;
    }
    return (v === 1 || v === '1' || v === true || v === 'on') ? 1 : 0;
  }
  function hitungSkor(ins, soal, jawabanObj) {
    const dim = {};
    const items = [];
    let total = 0;
    for (const s of soal) {
      const v = nilaiJawaban(ins.tipe, jawabanObj[s.id]);
      const d = dim[s.kategori] || (dim[s.kategori] = { sum: 0, count: 0 });
      d.sum += v; d.count += 1;
      total += v;
      items.push({ id: s.id, nomor: s.nomor, teks: s.teks, kategori: s.kategori, indikator: s.indikator || '', v });
    }
    return { skor: { dim, total, tipe: ins.tipe, versi: Number(ins.versi) || 1 }, items, total };
  }
  function ringkasHasil(kode, skor) {
    const dim = (skor && skor.dim) || {};
    const cats = dbm.ASESMEN_KATEGORI[kode] || [];
    if (kode === 'akpd') {
      const rows = cats.map(c => {
        const d = dim[c.key] || { sum: 0, count: 0 };
        return { key: c.key, label: c.label, ir: d.count ? r1((d.sum / (d.count * 4)) * 100) : 0 };
      }).sort((a, b) => b.ir - a.ir);
      return { utama: rows[0] ? rows[0].label : '-', nilai: rows[0] ? rows[0].ir : 0, rincian: rows };
    }
    if (kode === 'riasec') {
      const rows = cats.map(c => {
        const d = dim[c.key] || { sum: 0, count: 0 };
        return { key: c.key, label: c.label, pct: d.count ? r1((d.sum / d.count) * 100) : 0 };
      }).sort((a, b) => b.pct - a.pct);
      return {
        utama: rows.slice(0, 3).map(r => r.key).join(''), label: rows.slice(0, 3).map(r => r.label).join(' · '),
        nilai: rows[0] ? rows[0].pct : 0,
        rekomendasi: rows.slice(0, 2).map(r => KARIER[r.key]).join(' '), rincian: rows
      };
    }
    if (kode === 'gaya') {
      const rows = cats.map(c => {
        const d = dim[c.key] || { sum: 0, count: 0 };
        return { key: c.key, label: c.label, pct: d.count ? r1((d.sum / d.count) * 100) : 0 };
      }).sort((a, b) => b.pct - a.pct);
      return {
        utama: rows[0] ? rows[0].label : '-', nilai: rows[0] ? rows[0].pct : 0,
        rekomendasi: rows[0] ? GAYA_SARAN[rows[0].key] : '', rincian: rows
      };
    }
    const int = dim.internal || { sum: 0, count: 0 };
    const ekst = dim.eksternal || { sum: 0, count: 0 };
    const ip = int.count ? r1((int.sum / int.count) * 100) : 0;
    const ep = ekst.count ? r1((ekst.sum / ekst.count) * 100) : 0;
    const jenis = ip > ep ? 'internal' : (ep > ip ? 'eksternal' : 'campuran');
    return {
      utama: jenis === 'internal' ? 'Faktor Internal' : jenis === 'eksternal' ? 'Faktor Eksternal' : 'Internal & Eksternal',
      nilai: Math.max(ip, ep), internal: ip, eksternal: ep,
      rekomendasi: KESULITAN_SARAN[jenis] || '',
      rincian: [{ key: 'internal', label: 'Internal', pct: ip }, { key: 'eksternal', label: 'Eksternal', pct: ep }]
    };
  }

  get('/api/public/asesmen/:token/siswa', (req, res, q, params) => {
    const ins = instrumenByToken(params.token);
    if (!ins) return fail(res, 404, 'Tautan asesmen tidak ditemukan atau sudah tidak berlaku.');
    json(res, 200, { ok: true, rows: cariSiswaPublik(q.q, q.limit) });
  });

  get('/api/public/asesmen/:token', (req, res, q, params) => {
    const ins = instrumenByToken(params.token);
    if (!ins) return fail(res, 404, 'Tautan asesmen tidak ditemukan atau sudah tidak berlaku.');
    const soal = soalRows(ins.kode, true).map(s => ({ id: s.id, nomor: s.nomor, teks: s.teks }));
    json(res, 200, {
      ok: true,
      instrumen: {
        kode: ins.kode, nama: ins.nama, deskripsi: ins.deskripsi, petunjuk: ins.petunjuk, tipe: ins.tipe,
        jumlah_soal: soal.length
      },
      soal,
      sekolah: aduanIdentitas()
    });
  });

  post('/api/public/asesmen/:token/cek', async (req, res, q, params) => {
    const ins = instrumenByToken(params.token);
    if (!ins) return fail(res, 404, 'Tautan asesmen tidak ditemukan atau sudah tidak berlaku.');
    const b = await readBody(req);
    const idn = identitasSiswa(b);
    if (idn.error) return fail(res, idn.status || 400, idn.error);
    const siswa = idn.siswa;
    const ada = db.prepare('SELECT * FROM asesmen_hasil WHERE kode=? AND siswa_id=?').get(ins.kode, Number(siswa.id));
    if (ada) {
      let skor = {};
      try { skor = JSON.parse(ada.skor || '{}'); } catch (err) { skor = {}; }
      return json(res, 200, {
        ok: true, sudah: true, siswa: { nama: siswa.nama, kelas: siswa.kelas_nama || '', nisn: siswa.nisn || '' },
        hasil: { tanggal: ada.tanggal, ringkas: ringkasHasil(ins.kode, skor) },
        pesan: `Anda sudah mengisi ${ins.nama} pada ${tglPanjang(ada.tanggal)}. Setiap siswa hanya dapat mengisi satu kali.`
      });
    }
    json(res, 200, {
      ok: true, sudah: false,
      siswa: { id: siswa.id, nama: siswa.nama, kelas: siswa.kelas_nama || '', nisn: siswa.nisn || '', nis: siswa.nis || '' }
    });
  });

  post('/api/public/asesmen/:token', async (req, res, q, params) => {
    const ins = instrumenByToken(params.token);
    if (!ins) return fail(res, 404, 'Tautan asesmen tidak ditemukan atau sudah tidak berlaku.');
    const b = await readBody(req);
    const idn = identitasSiswa(b);
    if (idn.error) return fail(res, idn.status || 400, idn.error);
    const siswa = idn.siswa;
    const sudah = db.prepare('SELECT id FROM asesmen_hasil WHERE kode=? AND siswa_id=?').get(ins.kode, Number(siswa.id));
    if (sudah) return fail(res, 409, 'Anda sudah pernah mengisi asesmen ini. Setiap siswa hanya dapat mengisi satu kali.');
    const soal = soalRows(ins.kode, true);
    if (!soal.length) return fail(res, 400, 'Bank soal asesmen ini belum tersedia.');
    const jawaban = b.jawaban && typeof b.jawaban === 'object' ? b.jawaban : {};
    if (ins.tipe === 'likert4') {
      const kurang = soal.filter(s => !(Number(jawaban[s.id]) >= 1 && Number(jawaban[s.id]) <= 4));
      if (kurang.length) return fail(res, 400, `Masih ada ${kurang.length} pernyataan yang belum dinilai.`);
    }
    const hitung = hitungSkor(ins, soal, jawaban);
    const ta = dbm.tahunAktif() || {};
    let r;
    try {
      r = db.prepare(`INSERT INTO asesmen_hasil(kode,siswa_id,nisn,nama,kelas_id,kelas_nama,jawaban,skor,total,versi,tanggal,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(ins.kode, Number(siswa.id), siswa.nisn || siswa.nis || '', siswa.nama, siswa.kelas_id || null,
          siswa.kelas_nama || '', JSON.stringify(hitung.items), JSON.stringify(hitung.skor), hitung.total,
          Number(ins.versi) || 1, dbm.today(), dbm.now());
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err.message))) {
        return fail(res, 409, 'Anda sudah pernah mengisi asesmen ini. Setiap siswa hanya dapat mengisi satu kali.');
      }
      throw err;
    }
    try {
      db.prepare('INSERT INTO audit(user_id,nama,role,aksi,modul,detail,ip,created_at) VALUES(NULL,?,?,?,?,?,?,?)')
        .run(siswa.nama, 'siswa', 'ASESMEN', 'asesmen', `${ins.nama} diisi oleh ${siswa.nama}`, ipOf(req), dbm.now());
    } catch (err) { /* opsional */ }
    void ta;
    json(res, 200, {
      ok: true, id: Number(r.lastInsertRowid),
      ringkas: ringkasHasil(ins.kode, hitung.skor),
      pesan: 'Jawaban Anda tersimpan. Terima kasih — hasil akan dibaca oleh Guru BK.'
    });
  });

  /* ---------- hasil & analisis ---------- */
  function hasilRows(kode, kelasId) {
    const where = ['kode=?'];
    const args = [String(kode)];
    if (kelasId) { where.push('kelas_id=?'); args.push(Number(kelasId)); }
    return db.prepare(`SELECT * FROM asesmen_hasil WHERE ${where.join(' AND ')} ORDER BY kelas_nama, nama`).all(...args)
      .map(r => {
        let skor = {}, jawaban = [];
        try { skor = JSON.parse(r.skor || '{}'); } catch (err) { skor = {}; }
        try { jawaban = JSON.parse(r.jawaban || '[]'); } catch (err) { jawaban = []; }
        return { ...r, skor, jawaban, ringkas: ringkasHasil(r.kode, skor) };
      });
  }

  function analisisAkpd(rows) {
    const dims = dbm.ASESMEN_KATEGORI.akpd;
    const agg = {};
    dims.forEach(d => { agg[d.key] = { sum: 0, count: 0 }; });
    const itemMap = new Map();
    const siswa = [];
    for (const r of rows) {
      const dimS = (r.skor && r.skor.dim) || {};
      const per = dims.map(d => {
        const s = dimS[d.key] || { sum: 0, count: 0 };
        agg[d.key].sum += s.sum;
        agg[d.key].count += s.count;
        return { key: d.key, label: d.label, ir: s.count ? r1((s.sum / (s.count * 4)) * 100) : 0 };
      });
      const sorted = [...per].sort((a, b) => b.ir - a.ir);
      siswa.push({
        id: r.id, nama: r.nama, kelas: r.kelas_nama, nisn: r.nisn, tanggal: r.tanggal,
        bidang: per, utama: sorted[0] ? sorted[0].label : '-', ir: sorted[0] ? sorted[0].ir : 0,
        rata_ir: r1(per.reduce((a, b) => a + b.ir, 0) / per.length)
      });
      for (const it of r.jawaban || []) {
        if (!it || !it.kategori) continue;
        const key = String(it.teks || '').trim();
        if (!key) continue;
        const o = itemMap.get(key) || { teks: key, kategori: it.kategori, indikator: it.indikator || '', jumlah: 0, sum: 0, kuat: 0 };
        o.jumlah++; o.sum += Number(it.v) || 0;
        if ((Number(it.v) || 0) >= 3) o.kuat++;
        itemMap.set(key, o);
      }
    }
    const bidang = dims.map(d => {
      const a = agg[d.key];
      const ir = a.count ? r1((a.sum / (a.count * 4)) * 100) : 0;
      return { key: d.key, label: d.label, sum: a.sum, count: a.count, ir };
    });
    const sumIR = bidang.reduce((x, b) => x + b.ir, 0) || 1;
    bidang.forEach(b => { b.proporsi = r1((b.ir / sumIR) * 100); });
    bidang.sort((a, b) => b.ir - a.ir);
    bidang.forEach((b, i) => { b.peringkat = i + 1; });
    const kebutuhan = [...itemMap.values()]
      .map(o => ({ ...o, rata: r1(o.sum / o.jumlah) }))
      .filter(o => o.kuat > 0)
      .sort((a, b) => b.kuat - a.kuat || b.rata - a.rata)
      .slice(0, 20);
    const program = bidang.map(b => ({
      bidang: b.label, ir: b.ir, alokasi: b.proporsi,
      kebutuhan: kebutuhan.filter(k => k.kategori === b.key).slice(0, 3).map(k => k.teks),
      program: PROGRAM_BIDANG[b.key] || []
    }));
    const kelompok = siswa.filter(s => s.rata_ir >= 70)
      .sort((a, b) => b.rata_ir - a.rata_ir).slice(0, 15);
    return {
      total: rows.length, bidang, kebutuhan, program, siswa,
      kelompok_bermasalah: kelompok,
      rumusan: kebutuhan.slice(0, 6).map(k => ({
        kebutuhan: k.teks, bidang: (dims.find(d => d.key === k.kategori) || {}).label || k.kategori,
        jumlah_siswa: k.kuat, rata: k.rata
      }))
    };
  }

  function analisisUmum(kode, rows) {
    const dims = dbm.ASESMEN_KATEGORI[kode] || [];
    const agg = {};
    dims.forEach(d => { agg[d.key] = { sum: 0, count: 0, siswa: 0 }; });
    const indikator = new Map();
    const siswa = [];
    for (const r of rows) {
      const dimS = (r.skor && r.skor.dim) || {};
      const per = dims.map(d => {
        const s = dimS[d.key] || { sum: 0, count: 0 };
        agg[d.key].sum += s.sum;
        agg[d.key].count += s.count;
        return { key: d.key, label: d.label, pct: s.count ? r1((s.sum / s.count) * 100) : 0 };
      }).sort((a, b) => b.pct - a.pct);
      if (per.length) agg[per[0].key].siswa++;
      siswa.push({
        id: r.id, nama: r.nama, kelas: r.kelas_nama, nisn: r.nisn, tanggal: r.tanggal,
        rincian: per, utama: per[0] ? per[0].label : '-', nilai: per[0] ? per[0].pct : 0,
        ringkas: r.ringkas
      });
      for (const it of r.jawaban || []) {
        if (!it || !(Number(it.v) > 0)) continue;
        const key = `${it.kategori}|${it.indikator || it.teks}`;
        const o = indikator.get(key) || { kategori: it.kategori, indikator: it.indikator || it.teks, jumlah: 0 };
        o.jumlah++;
        indikator.set(key, o);
      }
    }
    const dist = dims.map(d => {
      const a = agg[d.key];
      const pct = a.count ? r1((a.sum / a.count) * 100) : 0;
      return { key: d.key, label: d.label, sum: a.sum, count: a.count, pct, siswa: a.siswa };
    }).sort((a, b) => b.pct - a.pct);
    let rekomendasi;
    if (kode === 'riasec') {
      rekomendasi = dist.slice(0, 3).map(d => ({ tipe: d.label, saran: KARIER[d.key] }));
    } else if (kode === 'gaya') {
      rekomendasi = dist.slice(0, 3).map(d => ({ tipe: d.label, saran: GAYA_SARAN[d.key] }));
    } else {
      const internal = dist.find(d => d.key === 'internal') || { pct: 0 };
      const eksternal = dist.find(d => d.key === 'eksternal') || { pct: 0 };
      const jenis = internal.pct > eksternal.pct ? 'internal' : (eksternal.pct > internal.pct ? 'eksternal' : 'campuran');
      rekomendasi = [{
        tipe: jenis === 'internal' ? 'Faktor Internal' : jenis === 'eksternal' ? 'Faktor Eksternal' : 'Internal & Eksternal',
        saran: KESULITAN_SARAN[jenis]
      }];
    }
    return {
      total: rows.length, distribusi: dist, siswa,
      indikator: [...indikator.values()].sort((a, b) => b.jumlah - a.jumlah).slice(0, 20),
      rekomendasi
    };
  }

  get('/api/asesmen/hasil', (req, res, q) => {
    if (!guard(req, res, 'asesmen', 'view')) return;
    const kode = String(q.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const kelasId = Number(q.kelas) || 0;
    const rows = hasilRows(kode, kelasId);
    json(res, 200, {
      ok: true, instrumen: ins, rows, jumlah: rows.length,
      kelas: dbm.kelasAll().map(k => ({ id: k.id, nama: k.nama })),
      kategori: dbm.ASESMEN_KATEGORI[kode] || []
    });
  });

  /* hapus hasil/riwayat asesmen (satuan atau massal) — data keliru / ganda */
  post('/api/asesmen/hasil/delete', async (req, res) => {
    const user = guard(req, res, 'asesmen', 'write'); if (!user) return;
    const b = await readBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || b.id || '').split(','))
      .map(x => Number(x)).filter(Boolean);
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu riwayat asesmen yang akan dihapus.');
    const rows = db.prepare(`SELECT * FROM asesmen_hasil WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    if (!rows.length) return fail(res, 404, 'Riwayat asesmen tidak ditemukan.');
    db.transaction(() => {
      for (const r of rows) db.prepare('DELETE FROM asesmen_hasil WHERE id=?').run(r.id);
    })();
    dbm.logAudit(user, 'HAPUS', 'asesmen',
      `Hapus ${rows.length} riwayat asesmen: ${rows.map(r => `${r.kode}/${r.nama}`).join(', ')}`, ipOf(req));
    json(res, 200, {
      ok: true, jumlah: rows.length,
      pesan: `${rows.length} riwayat asesmen dihapus. Siswa yang bersangkutan dapat mengisi ulang instrumen tersebut.`
    });
  });

  get('/api/asesmen/analisis', (req, res, q) => {
    if (!guard(req, res, 'asesmen', 'view')) return;
    const kode = String(q.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const kelasId = Number(q.kelas) || 0;
    const rows = hasilRows(kode, kelasId);
    if (kode === 'akpd') {
      const analisis = analisisAkpd(rows);
      const perKelas = {};
      for (const r of rows) {
        const key = r.kelas_nama || '(tanpa kelas)';
        (perKelas[key] = perKelas[key] || []).push(r);
      }
      const kelasAnalisis = Object.entries(perKelas).map(([nama, list]) => {
        const a = analisisAkpd(list);
        return { kelas: nama, jumlah: list.length, bidang: a.bidang, kebutuhan: a.kebutuhan.slice(0, 5) };
      }).sort((a, b) => String(a.kelas).localeCompare(String(b.kelas)));
      return json(res, 200, {
        ok: true, kode, instrumen: ins, jumlah: rows.length, analisis, kelas_analisis: kelasAnalisis,
        kelas: dbm.kelasAll().map(k => ({ id: k.id, nama: k.nama }))
      });
    }
    const analisis = analisisUmum(kode, rows);
    const perKelas = {};
    for (const r of rows) {
      const key = r.kelas_nama || '(tanpa kelas)';
      (perKelas[key] = perKelas[key] || []).push(r);
    }
    const kelasAnalisis = Object.entries(perKelas).map(([nama, list]) => {
      const a = analisisUmum(kode, list);
      return { kelas: nama, jumlah: list.length, distribusi: a.distribusi, indikator: a.indikator.slice(0, 5) };
    }).sort((a, b) => String(a.kelas).localeCompare(String(b.kelas)));
    json(res, 200, {
      ok: true, kode, instrumen: ins, jumlah: rows.length, analisis, kelas_analisis: kelasAnalisis,
      kelas: dbm.kelasAll().map(k => ({ id: k.id, nama: k.nama }))
    });
  });

  get('/api/asesmen/export', (req, res, q) => {
    if (!guard(req, res, 'asesmen', 'view')) return;
    const kode = String(q.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const rows = hasilRows(kode, Number(q.kelas) || 0);
    const head = [
      [{ v: `HASIL ASESMEN — ${ins.nama}`, bold: true }],
      [{ v: `${dbm.allSettings().sekolah_nama || ''}` }],
      []
    ];
    let cols;
    if (kode === 'akpd') {
      cols = ['NO', 'NISN', 'NAMA SISWA', 'KELAS', 'TANGGAL', 'PRIBADI (IR)', 'SOSIAL (IR)', 'BELAJAR (IR)', 'KARIR (IR)', 'KEBUTUHAN UTAMA'];
      head.push(cols);
      const kat = ['pribadi', 'sosial', 'belajar', 'karir'];
      rows.forEach((r, i) => head.push([
        i + 1, r.nisn || '', r.nama, r.kelas_nama || '', lib.tglID(r.tanggal),
        ...kat.map(k => {
          const d = (r.skor.dim || {})[k] || { sum: 0, count: 0 };
          return d.count ? r1((d.sum / (d.count * 4)) * 100) : 0;
        }), r.ringkas.utama
      ]));
    } else if (kode === 'riasec') {
      cols = ['NO', 'NISN', 'NAMA SISWA', 'KELAS', 'TANGGAL', 'R', 'I', 'A', 'S', 'E', 'C', 'KODE HOLLAND', 'REKOMENDASI KARIER'];
      head.push(cols);
      const keys = ['R', 'I', 'A', 'S', 'E', 'C'];
      rows.forEach((r, i) => head.push([
        i + 1, r.nisn || '', r.nama, r.kelas_nama || '', lib.tglID(r.tanggal),
        ...keys.map(k => {
          const d = (r.skor.dim || {})[k] || { sum: 0, count: 0 };
          return d.count ? r1((d.sum / d.count) * 100) : 0;
        }), r.ringkas.utama, r.ringkas.rekomendasi || ''
      ]));
    } else if (kode === 'gaya') {
      cols = ['NO', 'NISN', 'NAMA SISWA', 'KELAS', 'TANGGAL', 'VISUAL', 'AUDITORIAL', 'KINESTETIK', 'DOMINAN', 'SARAN PEMBELAJARAN'];
      head.push(cols);
      rows.forEach((r, i) => head.push([
        i + 1, r.nisn || '', r.nama, r.kelas_nama || '', lib.tglID(r.tanggal),
        ...['visual', 'auditorial', 'kinestetik'].map(k => {
          const d = (r.skor.dim || {})[k] || { sum: 0, count: 0 };
          return d.count ? r1((d.sum / d.count) * 100) : 0;
        }), r.ringkas.utama, r.ringkas.rekomendasi || ''
      ]));
    } else {
      cols = ['NO', 'NISN', 'NAMA SISWA', 'KELAS', 'TANGGAL', 'INTERNAL (%)', 'EKSTERNAL (%)', 'DOMINAN', 'REKOMENDASI LAYANAN'];
      head.push(cols);
      rows.forEach((r, i) => {
        const dim = r.skor.dim || {};
        const ip = dim.internal && dim.internal.count ? r1((dim.internal.sum / dim.internal.count) * 100) : 0;
        const ep = dim.eksternal && dim.eksternal.count ? r1((dim.eksternal.sum / dim.eksternal.count) * 100) : 0;
        head.push([i + 1, r.nisn || '', r.nama, r.kelas_nama || '', lib.tglID(r.tanggal), ip, ep, r.ringkas.utama, r.ringkas.rekomendasi || '']);
      });
    }
    if (kode === 'akpd') {
      const a = analisisAkpd(rows);
      head.push([]);
      head.push([{ v: 'REKAP BIDANG LAYANAN (IR & PRIORITAS)', bold: true }]);
      head.push(['BIDANG', 'RATA-RATA IR', 'PROPORSI ALOKASI (%)', 'PERINGKAT']);
      a.bidang.forEach(b => head.push([b.label, b.ir, b.proporsi, b.peringkat]));
      head.push([]);
      head.push([{ v: 'RUMUSAN KEBUTUHAN NYATA / MENDESAK', bold: true }]);
      head.push(['BIDANG', 'KEBUTUHAN', 'JUMLAH SISWA', 'RATA-RATA SKOR']);
      a.kebutuhan.forEach(k => head.push([
        (dbm.ASESMEN_KATEGORI.akpd.find(c => c.key === k.kategori) || {}).label || k.kategori,
        k.teks, k.kuat, k.rata
      ]));
    }
    const buf = lib.xlsxBuffer(`Hasil ${kode}`, head, [5, 16, 26, 16, 13, 14, 14, 14, 14, 40]);
    sendXlsx(res, buf, `hasil-asesmen-${kode}-${dbm.today()}.xlsx`);
  });

  get('/api/asesmen/cetak', (req, res, q) => {
    if (!guard(req, res, 'asesmen', 'view')) return;
    const kode = String(q.kode || 'akpd');
    const ins = db.prepare('SELECT * FROM asesmen_instrumen WHERE kode=?').get(kode);
    if (!ins) return fail(res, 404, 'Instrumen asesmen tidak ditemukan.');
    const rows = hasilRows(kode, Number(q.kelas) || 0);
    const st = dbm.allSettings();
    let body = '';
    if (kode === 'akpd') {
      const a = analisisAkpd(rows);
      const bidangRows = a.bidang.map(b => `<tr><td>${e(b.label)}</td><td class="c">${b.sum}</td>
        <td class="c">${b.count}</td><td class="c">${b.ir}%</td><td class="c">${b.proporsi}%</td>
        <td class="c">${b.peringkat}</td></tr>`).join('');
      const kebutuhanRows = a.kebutuhan.map((k, i) => `<tr><td class="c">${i + 1}</td>
        <td>${e((dbm.ASESMEN_KATEGORI.akpd.find(c => c.key === k.kategori) || {}).label || k.kategori)}</td>
        <td>${e(k.teks)}</td><td class="c">${k.kuat}</td><td class="c">${k.rata}</td></tr>`).join('');
      const programRows = a.program.map(p => `<tr><td>${e(p.bidang)}</td><td class="c">${p.ir}%</td><td class="c">${p.alokasi}%</td>
        <td>${p.kebutuhan.map(x => e(x)).join('<br>') || '-'}</td><td>${p.program.map(x => e(x)).join('<br>')}</td></tr>`).join('');
      const siswaRows = a.siswa.map((s, i) => `<tr><td class="c">${i + 1}</td><td>${e(s.nisn || '-')}</td>
        <td>${e(s.nama)}</td><td>${e(s.kelas || '-')}</td>
        ${s.bidang.map(b => `<td class="c">${b.ir}%</td>`).join('')}
        <td>${e(s.utama)}</td></tr>`).join('');
      body = `
        <div class="meta"><span>Jumlah responden: <b>${a.total}</b></span>
          <span>Sumber: <b>${e(ins.nama)}</b></span><span>Versi bank soal: <b>${Number(ins.versi) || 1}</b></span></div>
        <h3 class="sec">1. Rekap Bidang Layanan (IR & Prioritas)</h3>
        <table><thead><tr><th>Bidang Layanan</th><th>Σ Skor</th><th>Σ Butir</th><th>IR (%)</th><th>Proporsi Alokasi</th><th>Prioritas</th></tr></thead>
          <tbody>${bidangRows}</tbody></table>
        <h3 class="sec">2. Rumusan Kebutuhan Nyata / Mendesak</h3>
        <table><thead><tr><th>No</th><th>Bidang</th><th>Kebutuhan</th><th>Jumlah Siswa</th><th>Rata-rata</th></tr></thead>
          <tbody>${kebutuhanRows || '<tr><td colspan="5" class="c muted">Belum ada data.</td></tr>'}</tbody></table>
        <h3 class="sec">3. Draf Program BK (Protah / Prosem) & Proporsi Alokasi Waktu</h3>
        <table><thead><tr><th>Bidang</th><th>IR</th><th>Alokasi</th><th>Kebutuhan Utama</th><th>Rekomendasi Program</th></tr></thead>
          <tbody>${programRows || '<tr><td colspan="5" class="c muted">Belum ada data.</td></tr>'}</tbody></table>
        <h3 class="sec">4. Profil Konseli / Kelompok Bermasalah (rata-rata IR ≥ 70%)</h3>
        <table><thead><tr><th>Nama</th><th>Kelas</th><th>Bidang Prioritas</th><th>IR</th></tr></thead>
          <tbody>${a.kelompok_bermasalah.map(s => `<tr><td>${e(s.nama)}</td><td>${e(s.kelas || '-')}</td>
            <td>${e(s.utama)}</td><td class="c">${s.ir}%</td></tr>`).join('') || '<tr><td colspan="4" class="c muted">Tidak ada siswa dengan kebutuhan sangat tinggi.</td></tr>'}</tbody></table>
        <h3 class="sec">5. Daftar Hasil per Siswa</h3>
        <table><thead><tr><th>No</th><th>NISN</th><th>Nama</th><th>Kelas</th>
          ${dbm.ASESMEN_KATEGORI.akpd.map(c => `<th>${e(c.label.replace('Bidang ', ''))}</th>`).join('')}
          <th>Prioritas</th></tr></thead><tbody>${siswaRows || '<tr><td colspan="9" class="c muted">Belum ada data.</td></tr>'}</tbody></table>
        <div class="ttd-grid">
          <div class="ttd"><div>Mengetahui,<br>Kepala Sekolah</div><div class="nm">${e(st.kepala_nama || '................')}</div>
            <div>NIP. ${e(st.kepala_nip || '................')}</div></div>
          <div class="ttd"><div>${e(st.print_tempat || 'Cikoneng')}, ${e(tglPanjang(dbm.today()))}<br>${e(st.bk_ttd_jabatan || 'Koordinator BK')}</div>
            <div class="nm">${e(st.bk_ttd_nama || '................')}</div><div>NIP. ${e(st.bk_ttd_nip || '................')}</div></div>
        </div>`;
    } else {
      const a = analisisUmum(kode, rows);
      const distRows = a.distribusi.map(d => `<tr><td>${e(d.label)}</td><td class="c">${d.pct}%</td>
        <td class="c">${d.siswa}</td></tr>`).join('');
      const indikatorRows = a.indikator.map((x, i) => `<tr><td class="c">${i + 1}</td>
        <td>${e((dbm.ASESMEN_KATEGORI[kode].find(c => c.key === x.kategori) || {}).label || x.kategori)}</td>
        <td>${e(x.indikator)}</td><td class="c">${x.jumlah}</td></tr>`).join('');
      const siswaRows = a.siswa.map((s, i) => `<tr><td class="c">${i + 1}</td><td>${e(s.nisn || '-')}</td>
        <td>${e(s.nama)}</td><td>${e(s.kelas || '-')}</td><td>${e(s.utama)}</td>
        <td class="c">${s.nilai}%</td><td>${e(s.ringkas.rekomendasi || '-')}</td></tr>`).join('');
      body = `
        <div class="meta"><span>Jumlah responden: <b>${a.total}</b></span><span>Instrumen: <b>${e(ins.nama)}</b></span></div>
        <h3 class="sec">1. Distribusi Kecenderungan</h3>
        <table><thead><tr><th>Kategori</th><th>Persentase Rata-rata</th><th>Jumlah Siswa Dominan</th></tr></thead>
          <tbody>${distRows || '<tr><td colspan="3" class="c muted">Belum ada data.</td></tr>'}</tbody></table>
        <h3 class="sec">2. Rekomendasi Layanan</h3>
        <ul class="rapi">${a.rekomendasi.map(r => `<li><b>${e(r.tipe)}</b> — ${e(r.saran)}</li>`).join('') || '<li>-</li>'}</ul>
        <h3 class="sec">3. Indikator Terbanyak</h3>
        <table><thead><tr><th>No</th><th>Kategori</th><th>Indikator</th><th>Jumlah</th></tr></thead>
          <tbody>${indikatorRows || '<tr><td colspan="4" class="c muted">-</td></tr>'}</tbody></table>
        <h3 class="sec">4. Hasil per Siswa</h3>
        <table><thead><tr><th>No</th><th>NISN</th><th>Nama</th><th>Kelas</th><th>Kecenderungan</th>
          <th>Skor</th><th>Rekomendasi</th></tr></thead><tbody>${siswaRows || '<tr><td colspan="7" class="c muted">Belum ada data.</td></tr>'}</tbody></table>
        <div class="ttd-grid">
          <div class="ttd"><div>Mengetahui,<br>Kepala Sekolah</div><div class="nm">${e(st.kepala_nama || '................')}</div>
            <div>NIP. ${e(st.kepala_nip || '................')}</div></div>
          <div class="ttd"><div>${e(st.print_tempat || 'Cikoneng')}, ${e(tglPanjang(dbm.today()))}<br>${e(st.bk_ttd_jabatan || 'Koordinator BK')}</div>
            <div class="nm">${e(st.bk_ttd_nama || '................')}</div><div>NIP. ${e(st.bk_ttd_nip || '................')}</div></div>
        </div>`;
    }
    sendHTML(res, printdoc.page({
      settings: st, title: `Laporan Hasil ${ins.nama}`, subtitle: `Analisis Bimbingan Konseling · ${st.sekolah_nama || ''}`,
      body, landscape: true
    }));
  });

  return { instrumenAll };
};
