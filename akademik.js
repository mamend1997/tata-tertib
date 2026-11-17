'use strict';
/* =====================================================================
   MODUL AKADEMIK — Jadwal Pelajaran, Absensi Guru Mapel, Absensi Siswa
   ---------------------------------------------------------------------
   Dipasang oleh server.js lewat mount(api) agar memakai helper HTTP yang
   sama (guard, readBody, json, fail, uploadBuffer, appBaseUrl).

   Keamanan absensi guru (anti manipulasi):
   1. Slot harus MILIK guru yang login (kecuali admin/wakasek mencatat
      atas nama guru, tetap dalam jendela waktu).
   2. Tanggal harus HARI INI dan hari pada jadwal harus cocok.
   3. Jam submit harus di dalam jendela [mulai − toleransi, selesai + toleransi].
   4. Satu slot hanya boleh punya satu absensi per tanggal (unique index);
      setelah jendela ditutup absensi tidak dapat diubah lagi.
   5. Wajib jurnal materi (panjang minimal) + bukti foto (bila diaktifkan).
   6. Semua submit dicatat di audit + kolom waktu_submit/ip/validasi.
   ===================================================================== */
const crypto = require('crypto');
const xr = require('./xlsx-read');
const dbm = require('./db');
const lib = require('./lib');
const { db } = dbm;

let QRLIB = null;
function qr() { if (!QRLIB) QRLIB = require('qrcode'); return QRLIB; }

module.exports = function mount(api) {
  const { get, post, del, json, fail, guard, readBody, ipOf, uploadBuffer, appBaseUrl, sessionFrom, numOr, tenantKode } = api;

  /* ---------------------------------------------------------------- util */
  /* tahun pelajaran efektif: parameter → pengaturan ta_aktif (dipakai filters())
     → bendera aktif. Dulu memakai tahunAktif() saja sehingga slot yang dibuat pada
     TA pilihan tidak terbaca di menu absensi (bug sinkronisasi jadwal→absensi).
     PENTING (perbaikan jadwal "kosong"): nilai `ta` dari peramban bisa menunjuk
     tahun pelajaran yang SUDAH DIHAPUS (tersimpan di localStorage). Nilai seperti
     itu DITOLAK dan diganti TA aktif — kalau tidak, slot jadwal tersimpan pada
     ta_id yang tidak ada sehingga hilang dari menu Absensi & cetak jadwal. */
  const taAda = (id) => Number(id) > 0 && dbm.tahunList().some(t => Number(t.id) === Number(id));
  const taOf = (q) => {
    const diminta = Number((q && q.ta) || 0);
    if (diminta && taAda(diminta)) return diminta;
    const aktif = Number(dbm.getSetting('ta_aktif', 0)) || 0;
    if (aktif && taAda(aktif)) return aktif;
    return Number((dbm.tahunAktif() || {}).id) || Number(((dbm.tahunList() || [])[0] || {}).id) || 0;
  };
  /* daftar id TA lain (untuk fallback pencarian slot hari ini) */
  const semuaTaIds = () => dbm.tahunList().map(t => Number(t.id)).filter(Boolean);
  /** guru pengampu sebuah mapel dari Data Master Mata Pelajaran */
  const guruMapelOf = (mapelId) => db.prepare('SELECT guru_id FROM guru_mapel WHERE mapel_id=? ORDER BY id').all(Number(mapelId) || 0)
    .map(r => Number(r.guru_id)).filter(Boolean);
  /** daftar sesi (jam pelajaran) untuk satu hari — mendukung pengaturan per hari */
  const sesiHari = (cfg, hari) => dbm.sesiOfHari(cfg, hari);
  const rolesOf = (u) => dbm.userRoleList(u);
  const isAdmin = (u) => rolesOf(u).includes('admin');
  const isKurikulum = (u) => isAdmin(u) || rolesOf(u).includes('wakasek_kurikulum');
  /**
   * Leadership roles can view broadly, but only admins and headmasters see all
   * attendance slots. Wakasek Kurikulum/Kesiswaan are scoped to their effective
   * teacher slots; only the assigned teacher or admin may perform actions.
   */
  const isPengawas = (u) => isKurikulum(u) || rolesOf(u).includes('kepala_sekolah') || rolesOf(u).includes('kesiswaan');
  const hanyaJadwalSendiri = (u) => !isAdmin(u) && !rolesOf(u).includes('kepala_sekolah')
    && rolesOf(u).some(r => ['wakasek_kurikulum', 'kesiswaan'].includes(r));
  const lihatSemuaJadwalAbsensi = (u) => isPengawas(u) && !hanyaJadwalSendiri(u);
  const rekapAbsensiUntuk = (rekap, user) => {
    if (lihatSemuaJadwalAbsensi(user)) return rekap;
    const rows = rekap.rows.filter(r => Number(r.guru_id) === Number(user.id));
    const hitung = { hadir: 0, izin: 0, sakit: 0, alpha: 0, belum: 0, sebagian: 0 };
    for (const row of rows) {
      if (row.ringkas === 'Hadir') hitung.hadir++;
      else if (row.ringkas === 'Izin') hitung.izin++;
      else if (row.ringkas === 'Sakit') hitung.sakit++;
      else if (row.ringkas === 'Alpha') hitung.alpha++;
      else if (row.ringkas === 'Sebagian') hitung.sebagian++;
      else hitung.belum++;
    }
    return {
      ...rekap, rows, guru: rows.length,
      jadwal: rows.reduce((total, row) => total + Number(row.jadwal || 0), 0),
      hitung, belum_absen: rows.filter(r => r.ringkas !== 'Hadir')
    };
  };
  const intArr = (v) => (Array.isArray(v) ? v : String(v === undefined || v === null ? '' : v).split(','))
    .map(x => Number(x)).filter(n => Number.isInteger(n));
  const strIds = (v) => intArr(v).filter(Boolean);
  const guruList = () => db.prepare(`SELECT id,nama,nip,username,role,roles,jabatan FROM users
    WHERE aktif=1 ORDER BY nama`).all().map(u => ({
    id: u.id, nama: u.nama, nip: u.nip || '', username: u.username,
    role: u.role, roles: dbm.userRoleList(u),
    label: dbm.roleLabelOf(u) + (u.jabatan ? ' · ' + u.jabatan : '')
  }));
  const kelasPicker = () => dbm.kelasAll().map(k => ({ id: k.id, nama: k.nama, tingkat: k.tingkat, ta_id: k.tahun_ajaran_id }));
  const tokenOf = (req, prefix) => `${tenantKode(req)}.${prefix || 's'}.${crypto.randomBytes(9).toString('hex')}`;
  const absUrl = (req, path) => appBaseUrl(req) + path;

  async function qrPair(url) {
    const q = qr();
    const svg = await q.toString(url, { type: 'svg', margin: 1, width: 260, errorCorrectionLevel: 'M' });
    const png = await q.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
    return { svg, png };
  }

  /**
   * Validasi daftar sesi jam pelajaran (dipakai untuk pengaturan umum maupun
   * pengaturan per hari). Mengembalikan { sesi } atau { error }.
   */
  function validasiSesi(raw, { maxJam = 15, label = 'sesi' } = {}) {
    const list = Array.isArray(raw) ? raw : [];
    if (!list.length) return { error: `Minimal satu ${label} jam pelajaran harus diatur.` };
    if (list.length > 30) return { error: 'Jumlah sesi maksimal 30 baris.' };
    const sesi = [];
    for (const s of list) {
      const mulai = String((s && s.mulai) || '').trim();
      const selesai = String((s && s.selesai) || '').trim();
      const istirahat = s && (s.istirahat === 1 || s.istirahat === true || s.istirahat === '1') ? 1 : 0;
      if (dbm.jamMenit(mulai) === null) return { error: `Jam mulai "${mulai}" tidak valid (format HH:MM).` };
      if (dbm.jamMenit(selesai) === null) return { error: `Jam selesai "${selesai}" tidak valid (format HH:MM).` };
      if (dbm.jamMenit(selesai) <= dbm.jamMenit(mulai)) return { error: `Jam selesai ${selesai} harus setelah jam mulai ${mulai}.` };
      const teks = String((s && s.label) || (istirahat ? 'Istirahat' : 'Jam')).trim().slice(0, 30);
      sesi.push({ label: teks || (istirahat ? 'Istirahat' : 'Jam'), mulai, selesai, istirahat });
    }
    sesi.sort((a, c) => dbm.jamMenit(a.mulai) - dbm.jamMenit(c.mulai));
    for (let i = 1; i < sesi.length; i++) {
      if (dbm.jamMenit(sesi[i].mulai) < dbm.jamMenit(sesi[i - 1].selesai)) {
        return { error: `Sesi ${sesi[i].label} (${sesi[i].mulai}) bertumpang tindih dengan ${sesi[i - 1].label} (…–${sesi[i - 1].selesai}).` };
      }
    }
    const jumlahPelajaran = sesi.filter(x => !x.istirahat).length;
    if (!jumlahPelajaran) return { error: 'Minimal satu sesi harus berupa jam pelajaran (bukan istirahat).' };
    if (jumlahPelajaran > maxJam) return { error: `Jumlah jam pelajaran (${jumlahPelajaran}) melebihi batas maksimal per hari (${maxJam}).` };
    return { sesi };
  }

  /* =================================================================
     1. PENGATURAN JADWAL (Wakasek Kurikulum)
     ================================================================= */
  get('/api/jadwal/pengaturan', (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const cfg = dbm.jadwalConfig();
    json(res, 200, {
      ok: true, config: cfg, hari_label: dbm.HARI_LABEL,
      mapel: dbm.mapelList({ aktifOnly: false }),
      kelas: kelasPicker(), guru: guruList(),
      absensi: {
        buka_menit: cfg.bukaMenit, tutup_menit: cfg.tutupMenit, toleransi_tutup: cfg.toleransiTutup,
        jurnal_min: cfg.jurnalMin,
        foto_wajib: cfg.fotoWajib ? 1 : 0, foto_hari: cfg.fotoHari,
        siswa_aktif: cfg.siswaAktif ? 1 : 0, siswa_tutup_menit: cfg.siswaTutupMenit,
        auto_alpha: cfg.autoAlpha ? 1 : 0
      },
      wa: { aktif: cfg.waAktif ? 1 : 0, jam: cfg.waJam, kepsek: cfg.kepsekWa, wakasek: cfg.wakasekWa },
      target: dbm.targetJamConfig(),
      gateway_aktif: !!(dbm.waConfig().aktif && dbm.waConfig().url),
      ta: taOf({})
    });
  });

  post('/api/jadwal/pengaturan', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    /* ---------- validasi DULU, simpan kemudian ---------- */
    const hari = [...new Set(intArr(b.hari))].filter(n => n >= 0 && n <= 6).sort((a, c) => a - c);
    if (!hari.length) return fail(res, 400, 'Pilih minimal satu hari pembelajaran aktif.');
    const maxJam = Math.round(Number(b.max_jam) || 0);
    if (maxJam < 1 || maxJam > 15) return fail(res, 400, 'Jumlah jam pelajaran maksimal per hari harus antara 1 dan 15.');
    const cekSesi = validasiSesi(b.sesi, { maxJam, label: 'sesi' });
    if (cekSesi.error) return fail(res, 400, cekSesi.error);
    const sesi = cekSesi.sesi;
    const jumlahPelajaran = sesi.filter(s => !s.istirahat).length;
    /* ---------- sesi KHUSUS per hari (opsional) ---------- */
    const sesiHariBaru = {};
    if (b.sesi_hari && typeof b.sesi_hari === 'object' && !Array.isArray(b.sesi_hari)) {
      for (const [k, v] of Object.entries(b.sesi_hari)) {
        const h = Number(k);
        if (!Number.isInteger(h) || h < 0 || h > 6) return fail(res, 400, `Hari "${k}" pada pengaturan sesi per hari tidak valid.`);
        if (!Array.isArray(v) || !v.length) continue;             // kosong = ikut pengaturan umum
        if (!hari.includes(h)) return fail(res, 400, `${dbm.HARI_LABEL[h]} bukan hari pembelajaran aktif, hapus pengaturan sesinya atau aktifkan harinya.`);
        const cek = validasiSesi(v, { maxJam, label: `sesi ${dbm.HARI_LABEL[h]}` });
        if (cek.error) return fail(res, 400, `${dbm.HARI_LABEL[h]}: ${cek.error}`);
        sesiHariBaru[h] = cek.sesi;
      }
    }
    const maxMapel = Math.round(Number(b.max_mapel_jam) || 0);
    const maxGuru = Math.round(Number(b.max_guru_jam) || 0);
    if (maxMapel < 1 || maxMapel > 12) return fail(res, 400, 'Batas jam mata pelajaran per hari harus antara 1 dan 12.');
    if (maxGuru < 1 || maxGuru > 15) return fail(res, 400, 'Batas jam mengajar guru per hari harus antara 1 dan 15.');
    const abs = b.absensi || {};
    const clampN = (v, a, c, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(c, n)) : def; };
    const buka = clampN(abs.buka_menit, 0, 240, 15);
    const tutup = clampN(abs.tutup_menit, 0, 240, 15);
    /* TIME-LOCKING: toleransi 0–60 menit setelah jam pelajaran selesai (0 = terkunci
       tepat pada jam selesai). */
    const toleransiTutup = clampN(abs.toleransi_tutup, 0, 60, 0);
    const jurnal = clampN(abs.jurnal_min, 0, 500, 15);
    const fotoHari = clampN(abs.foto_hari, 1, 3650, 90);
    const siswaTutup = clampN(abs.siswa_tutup_menit, 0, 720, 120);
    const autoAlpha = abs.auto_alpha === undefined ? true : !!abs.auto_alpha;
    const wa = b.wa || {};
    const waJam = String(wa.jam || '14:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(waJam)) return fail(res, 400, 'Jam kirim rekap WhatsApp tidak valid (format HH:MM).');
    const phone = (v, label) => {
      const raw = String(v === undefined || v === null ? '' : v).trim();
      if (!raw) return '';
      const n = lib.normPhone(raw);
      if (!n) throw new Error(`Nomor WhatsApp ${label} tidak valid.`);
      return n;
    };
    let kepsekWa = '', wakasekWa = '';
    try {
      kepsekWa = phone(wa.kepsek, 'Kepala Sekolah');
      wakasekWa = phone(wa.wakasek, 'Wakasek Kurikulum');
    } catch (e) { return fail(res, 400, e.message); }
    /* TARGET JAM PELAJARAN per kelas per pekan — null = tidak dikirim (tidak diubah) */
    const tjIn = (b.target_jam && typeof b.target_jam === 'object') ? b.target_jam : b;
    const targetJam = {
      aktif: tjIn.aktif === undefined || tjIn.aktif === null || tjIn.aktif === ''
        ? null
        : (tjIn.aktif === true || ['1', 'true', 'on', 'ya'].includes(String(tjIn.aktif).toLowerCase())),
      minggu: (tjIn.minggu === undefined || String(tjIn.minggu).trim() === '')
        ? null : Math.round(Number(tjIn.minggu))
    };
    if (targetJam.minggu !== null && (!Number.isFinite(targetJam.minggu) || targetJam.minggu < 1 || targetJam.minggu > 80)) {
      return fail(res, 400, 'Target jam pelajaran per minggu harus antara 1 dan 80 jam.');
    }

    dbm.setSetting('jadwal_hari', JSON.stringify(hari));
    dbm.setSetting('jadwal_max_jam', String(maxJam));
    dbm.setSetting('jadwal_sesi', JSON.stringify(sesi));
    dbm.setSetting('jadwal_sesi_hari', JSON.stringify(sesiHariBaru));
    dbm.setSetting('jadwal_max_mapel_jam', String(maxMapel));
    dbm.setSetting('jadwal_max_guru_jam', String(maxGuru));
    dbm.setSetting('absensi_buka_menit', String(buka));
    dbm.setSetting('absensi_tutup_menit', String(tutup));
    dbm.setSetting('absensi_toleransi_tutup', String(toleransiTutup));
    dbm.setSetting('absensi_jurnal_min', String(jurnal));
    dbm.setSetting('absensi_foto_wajib', abs.foto_wajib ? '1' : '0');
    dbm.setSetting('absensi_foto_hari', String(fotoHari));
    dbm.setSetting('absensi_siswa_aktif', abs.siswa_aktif ? '1' : '0');
    dbm.setSetting('absensi_siswa_tutup_menit', String(siswaTutup));
    dbm.setSetting('absensi_auto_alpha', autoAlpha ? '1' : '0');
    dbm.setSetting('absensi_wa_aktif', wa.aktif ? '1' : '0');
    dbm.setSetting('absensi_wa_jam', waJam);
    dbm.setSetting('kepsek_wa', kepsekWa);
    dbm.setSetting('wakasek_kur_wa', wakasekWa);
    /* VALIDASI TARGET JAM PELAJARAN per kelas per pekan (disimpan di bawah) */
    if (targetJam.aktif !== null) dbm.setSetting('target_jam_aktif', targetJam.aktif ? '1' : '0');
    if (targetJam.minggu !== null) dbm.setSetting('target_jam_minggu', String(targetJam.minggu));
    dbm.logAudit(user, 'UBAH', 'jadwal',
      `Pengaturan jadwal: ${hari.length} hari aktif, ${jumlahPelajaran} jam/hari, ${sesi.filter(s => s.istirahat).length} istirahat`
      + `${Object.keys(sesiHariBaru).length ? `, sesi khusus ${Object.keys(sesiHariBaru).map(h => dbm.HARI_LABEL[h]).join('/')}` : ''}, `
      + `toleransi buka ${buka} menit, kunci setelah selesai +${toleransiTutup} menit, retensi foto ${fotoHari} hari`, ipOf(req));
    json(res, 200, { ok: true, config: dbm.jadwalConfig(), pesan: 'Pengaturan jadwal & absensi disimpan.' });
  });

  /* =================================================================
     2. MATA PELAJARAN (nama, kode, guru pengampu, batas jam)
     ================================================================= */
  get('/api/mapel', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const rows = dbm.mapelList({ aktifOnly: false });
    const guru = new Map(guruList().map(g => [g.id, g]));
    const peta = db.prepare('SELECT * FROM guru_mapel').all();
    const byMapel = new Map();
    for (const p of peta) {
      const arr = byMapel.get(Number(p.mapel_id)) || [];
      if (guru.has(Number(p.guru_id))) arr.push(guru.get(Number(p.guru_id)));
      byMapel.set(Number(p.mapel_id), arr);
    }
    const pakai = db.prepare('SELECT mapel_id, COUNT(*) c FROM jadwal WHERE ta_id=? GROUP BY mapel_id').all(taOf(q));
    const pakaiMap = new Map(pakai.map(r => [Number(r.mapel_id), Number(r.c)]));
    json(res, 200, {
      ok: true,
      rows: rows.map(m => ({
        ...m,
        guru: byMapel.get(Number(m.id)) || [],
        guru_ids: (byMapel.get(Number(m.id)) || []).map(g => g.id),
        dipakai: pakaiMap.get(Number(m.id)) || 0
      })),
      guru: guruList(),
      ruang: dbm.jadwalRuangRows()
    });
  });

  post('/api/mapel/save', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const nama = String(b.nama || '').trim();
    const kode = String(b.kode || '').trim().toUpperCase();
    if (!nama) return fail(res, 400, 'Nama mata pelajaran wajib diisi.');
    if (!kode) return fail(res, 400, 'Kode mata pelajaran wajib diisi.');
    if (!/^[A-Z0-9._-]{2,12}$/.test(kode)) return fail(res, 400, 'Kode mapel 2–12 karakter (huruf, angka, titik, garis).');
    const id = Number(b.id) || 0;
    if (id && !db.prepare('SELECT id FROM mapel WHERE id=?').get(id)) {
      return fail(res, 404, 'Mata pelajaran tidak ditemukan.');
    }
    const dupNama = db.prepare('SELECT id FROM mapel WHERE lower(nama)=lower(?) AND id<>?').get(nama, id);
    if (dupNama) return fail(res, 400, 'Nama mata pelajaran sudah dipakai.');
    const dupKode = db.prepare('SELECT id FROM mapel WHERE upper(kode)=? AND id<>?').get(kode, id);
    if (dupKode) return fail(res, 400, `Kode mapel ${kode} sudah dipakai.`);
    const maxJam = Math.max(0, Math.min(12, Math.round(Number(b.max_jam_hari) || 0)));
    const ruangId = Number(b.ruang_id) || 0;
    const ruangWajib = ruangId ? db.prepare('SELECT nama FROM jadwal_ruang WHERE id=? AND aktif=1').get(ruangId) : null;
    if (ruangId && !ruangWajib) {
      return fail(res, 400, 'Pilih ruangan wajib yang aktif.');
    }
    if (ruangWajib) {
      const bentrokRuang = db.prepare(`SELECT a.hari,a.sesi FROM jadwal a JOIN jadwal b
        ON b.ta_id=a.ta_id AND b.hari=a.hari AND b.sesi=a.sesi AND b.id<>a.id
        WHERE a.mapel_id=? AND (b.mapel_id=? OR lower(trim(b.ruang))=lower(trim(?))) LIMIT 1`)
        .get(id || -1, id || -1, ruangWajib.nama);
      if (bentrokRuang) {
        return fail(res, 409, `${ruangWajib.nama} sudah bentrok dengan slot lain pada ${dbm.HARI_LABEL[Number(bentrokRuang.hari)] || 'hari'} sesi ${bentrokRuang.sesi}.`);
      }
    }
    const guruIds = [...new Set(strIds(b.guru_ids))];
    if (id) {
      const jadwalTidakSesuai = db.prepare('SELECT DISTINCT guru_id FROM jadwal WHERE mapel_id=?')
        .all(id).find(row => !guruIds.includes(Number(row.guru_id)));
      if (jadwalTidakSesuai) {
        return fail(res, 409,
          'Guru pengampu yang dipilih akan membuat jadwal yang sudah tersusun tidak sesuai. Tambahkan guru baru bersama guru lama, pindahkan slot jadwalnya, lalu simpan kembali tanpa guru lama.');
      }
    }
    let rowId = id;
    db.transaction(() => {
      if (id) {
        db.prepare('UPDATE mapel SET kode=?,nama=?,kelompok=?,aktif=?,max_jam_hari=?,ruang_id=? WHERE id=?')
          .run(kode, nama, String(b.kelompok || '').slice(0, 40), b.aktif === false || b.aktif === 0 || b.aktif === '0' ? 0 : 1, maxJam, ruangId || null, id);
        if (ruangWajib) db.prepare('UPDATE jadwal SET ruang=? WHERE mapel_id=?').run(ruangWajib.nama, id);
      } else {
        const urut = (db.prepare('SELECT COALESCE(MAX(urut),0) m FROM mapel').get().m || 0) + 1;
        const r = db.prepare('INSERT INTO mapel(kode,nama,kelompok,aktif,urut,max_jam_hari,ruang_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(kode, nama, String(b.kelompok || '').slice(0, 40), b.aktif === false || b.aktif === 0 || b.aktif === '0' ? 0 : 1, urut, maxJam, ruangId || null, dbm.now());
        rowId = Number(r.lastInsertRowid);
        if (ruangWajib) db.prepare('UPDATE jadwal SET ruang=? WHERE mapel_id=?').run(ruangWajib.nama, rowId);
      }
      db.prepare('DELETE FROM guru_mapel WHERE mapel_id=?').run(rowId);
      for (const gid of guruIds) {
        if (db.prepare('SELECT 1 FROM users WHERE id=?').get(gid)) {
          db.prepare('INSERT OR IGNORE INTO guru_mapel(guru_id,mapel_id,created_at) VALUES(?,?,?)').run(gid, rowId, dbm.now());
        }
      }
    })();
    dbm.logAudit(user, id ? 'UBAH' : 'TAMBAH', 'jadwal', `Mata pelajaran ${kode} — ${nama}`, ipOf(req));
    json(res, 200, { ok: true, id: rowId, pesan: `Mata pelajaran ${nama} disimpan.` });
  });

  /**
   * HAPUS MATA PELAJARAN + CASCADE.
   * Sebelumnya penghapusan gagal dengan pesan "masih dipakai pada N slot jadwal"
   * meskipun matriks pada tahun pelajaran aktif tampak kosong — karena slot dari
   * tahun pelajaran LAIN (dan sesi/absensi turunannya) tetap ada di database.
   * Sekarang seluruh relasi dibersihkan dalam satu transaksi:
   *   jadwal mapel (semua TA) → absensi_sesi, absensi_siswa, absensi_guru,
   *   kejadian otomatis dari absensi, guru_mapel, lalu mapel itu sendiri.
   * `?dry=1` hanya melaporkan dampaknya (dipakai dialog konfirmasi di UI).
   */
  del('/api/mapel/:id', (req, res, q, params) => {
    const user = guard(req, res, 'jadwal', 'delete'); if (!user) return;
    const id = Number(params.id) || 0;
    const m = db.prepare('SELECT * FROM mapel WHERE id=?').get(id);
    if (!m) return fail(res, 404, 'Mata pelajaran tidak ditemukan.');
    const slots = db.prepare('SELECT id, ta_id FROM jadwal WHERE mapel_id=?').all(id);
    const slotIds = slots.map(r => Number(r.id));
    const sesiIds = slotIds.length
      ? db.prepare(`SELECT id FROM absensi_sesi WHERE jadwal_id IN (${slotIds.map(() => '?').join(',')}) OR mapel_id=?`)
        .all(...slotIds, id).map(r => Number(r.id))
      : db.prepare('SELECT id FROM absensi_sesi WHERE mapel_id=?').all(id).map(r => Number(r.id));
    const absSiswaIds = sesiIds.length
      ? db.prepare(`SELECT id FROM absensi_siswa WHERE sesi_id IN (${sesiIds.map(() => '?').join(',')})`).all(...sesiIds).map(r => Number(r.id))
      : [];
    const dampak = {
      mapel: `${m.kode || ''} — ${m.nama}`,
      slot: slots.length,
      ta: [...new Set(slots.map(r => Number(r.ta_id) || 0))].length,
      sesi: sesiIds.length,
      absensi_siswa: absSiswaIds.length,
      absensi_guru: slotIds.length
        ? db.prepare(`SELECT COUNT(*) c FROM absensi_guru WHERE jadwal_id IN (${slotIds.map(() => '?').join(',')})`).get(...slotIds).c
        : 0,
      poin_otomatis: absSiswaIds.length
        ? db.prepare(`SELECT COUNT(*) c FROM kejadian WHERE sumber='absensi' AND ref_id IN (${absSiswaIds.map(() => '?').join(',')})`)
          .get(...absSiswaIds).c
        : 0,
      guru_pengampu: db.prepare('SELECT COUNT(*) c FROM guru_mapel WHERE mapel_id=?').get(id).c
    };
    if (q && (q.dry === '1' || q.dry === 1 || q.dry === 'true')) return json(res, 200, { ok: true, dampak });

    db.transaction(() => {
      if (slotIds.length) {
        const ph = slotIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM absensi_guru WHERE jadwal_id IN (${ph})`).run(...slotIds);
      }
      if (sesiIds.length) {
        const ph = sesiIds.map(() => '?').join(',');
        if (absSiswaIds.length) {
          db.prepare(`DELETE FROM kejadian WHERE sumber='absensi' AND ref_id IN (${absSiswaIds.map(() => '?').join(',')})`).run(...absSiswaIds);
        }
        db.prepare(`DELETE FROM absensi_siswa WHERE sesi_id IN (${ph})`).run(...sesiIds);
        db.prepare(`DELETE FROM absensi_sesi WHERE id IN (${ph})`).run(...sesiIds);
      }
      db.prepare('DELETE FROM jadwal WHERE mapel_id=?').run(id);
      db.prepare('DELETE FROM guru_mapel WHERE mapel_id=?').run(id);
      db.prepare('DELETE FROM mapel WHERE id=?').run(id);
    })();
    dbm.logAudit(user, 'HAPUS', 'jadwal',
      `Hapus mata pelajaran ${m.kode} — ${m.nama} (${dampak.slot} slot, ${dampak.sesi} sesi, `
      + `${dampak.absensi_siswa} absensi siswa, ${dampak.absensi_guru} absensi guru, ${dampak.poin_otomatis} catatan poin otomatis)`, ipOf(req));
    json(res, 200, {
      ok: true, dampak,
      pesan: `${m.nama} dihapus beserta ${dampak.slot} slot jadwal, ${dampak.sesi} sesi & riwayat absensinya. Kini mapel dapat dibuat ulang.`
    });
  });

  /* ---------- IMPORT MATA PELAJARAN (massal, termasuk guru pengampu) ---------- */
  const normTxt = (v) => String(v === undefined || v === null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
  function previewMapel(buf, filename) {
    const list = /\.csv$/i.test(String(filename || '')) ? xr.readCsv(buf.toString('utf8')) : xr.readXlsx(buf);
    const raw = (list && list[0] && list[0].rows) || [];
    if (!raw.length) throw new Error('Berkas kosong / tidak terbaca.');
    const headIdx = raw.findIndex(r => {
      const head = (r || []).map(c => normTxt(c && c.v !== undefined ? c.v : c || ''));
      const col = (...names) => {
        const exact = head.findIndex(h => names.includes(h));
        return exact >= 0 ? exact : head.findIndex(h => names.some(n => h.includes(n)));
      };
      const cNama = col('nama mapel', 'nama mata pelajaran', 'nama');
      const cKode = col('kode');
      const cGuru = col('guru');
      return cNama >= 0 && [cKode, cGuru].some(i => i >= 0 && i !== cNama);
    });
    if (headIdx < 0) throw new Error('Header kolom (KODE, NAMA MAPEL, KELOMPOK, MAKS JAM/HARI, GURU PENGAMPU) tidak ditemukan.');
    const head = raw[headIdx].map(h => normTxt(h && h.v !== undefined ? h.v : h));
    const col = (...names) => head.findIndex(h => names.some(n => h.includes(n)));
    const cKode = col('kode');
    const cNama = col('nama mapel', 'nama mata pelajaran', 'nama');
    const cKel = col('kelompok');
    const cMax = col('maks jam', 'max jam', 'jam/hari', 'jam per hari');
    const cGuru = col('guru');
    if (cNama < 0) throw new Error('Kolom NAMA MAPEL wajib ada pada berkas import.');
    const users = db.prepare('SELECT id,nama,username FROM users').all();
    const cariGuru = (teks) => {
      const t = normTxt(teks);
      if (!t) return null;
      return users.find(u => normTxt(u.username) === t) || users.find(u => normTxt(u.nama) === t) || null;
    };
    const adaKode = new Map(db.prepare('SELECT id,kode FROM mapel').all().map(m => [String(m.kode || '').toUpperCase(), m.id]));
    const out = [];
    const terlihat = new Set();
    for (let i = headIdx + 1; i < raw.length; i++) {
      const cells = raw[i] || [];
      const getv = (c) => (c >= 0 ? String((cells[c] && cells[c].v !== undefined ? cells[c].v : cells[c]) || '').trim() : '');
      const nama = getv(cNama);
      if (!nama || /^(jumlah|total|keterangan|catatan|petunjuk)/i.test(nama)) continue;
      const kode = (getv(cKode) || '').toUpperCase();
      const kelompok = getv(cKel);
      const maxRaw = getv(cMax);
      const maxJam = maxRaw ? Math.round(Number(String(maxRaw).replace(/[^0-9]/g, '')) || 0) : 0;
      const guruTxt = getv(cGuru);
      const guru = [];
      const gagalGuru = [];
      for (const bagian of String(guruTxt).split(/[,;/|]+/).map(x => x.trim()).filter(Boolean)) {
        const g = cariGuru(bagian);
        if (g) guru.push({ id: g.id, nama: g.nama }); else gagalGuru.push(bagian);
      }
      const errs = [];
      if (kode && !/^[A-Z0-9._-]{2,12}$/.test(kode)) errs.push('Kode mapel 2–12 karakter (huruf/angka/titik/garis).');
      if (maxRaw && !(maxJam >= 0 && maxJam <= 12)) errs.push('Maks jam/hari harus 0–12.');
      if (gagalGuru.length) errs.push(`Guru tidak ditemukan: ${gagalGuru.join(', ')}`);
      const key = kode || ('nama:' + normTxt(nama));
      if (terlihat.has(key)) errs.push('Duplikat di dalam berkas ini');
      terlihat.add(key);
      out.push({
        baris: i + 1, kode, nama, kelompok, max_jam_hari: maxJam, guru,
        guru_nama: guru.map(g => g.nama).join(', '),
        aksi: kode && adaKode.has(kode) ? 'perbarui' : 'baru',
        error: errs.join(' • ')
      });
    }
    return out;
  }

  post('/api/mapel/import/preview', async (req, res) => {
    if (!guard(req, res, 'jadwal', 'write')) return;
    const b = await readBody(req);
    try {
      const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
      if (!buf.length) return fail(res, 400, 'Berkas kosong / tidak terbaca.');
      const rows = previewMapel(buf, String(b.filename || 'import.xlsx'));
      if (!rows.length) return fail(res, 400, 'Tidak ada baris mata pelajaran yang terdeteksi (gunakan template).');
      json(res, 200, {
        ok: true, rows, total: rows.length, siap: rows.filter(r => !r.error).length,
        baru: rows.filter(r => !r.error && r.aksi === 'baru').length,
        perbarui: rows.filter(r => !r.error && r.aksi === 'perbarui').length
      });
    } catch (e) { fail(res, 400, e.message); }
  });

  post('/api/mapel/import/commit', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return fail(res, 400, 'Tidak ada baris untuk disimpan.');
    for (const r of rows) {
      if (r.error) continue;
      const nama = String(r.nama || '').trim();
      const kode = String(r.kode || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12);
      const guruIds = [...new Set((Array.isArray(r.guru) ? r.guru : []).map(g => Number(g.id || g)).filter(Boolean))];
      if (!nama || !guruIds.length) continue;
      const id = (kode && (db.prepare('SELECT id FROM mapel WHERE upper(kode)=?').get(kode) || {}).id)
        || (db.prepare('SELECT id FROM mapel WHERE lower(TRIM(nama))=lower(TRIM(?))').get(nama) || {}).id;
      if (!id) continue;
      const jadwalTidakSesuai = db.prepare('SELECT DISTINCT guru_id FROM jadwal WHERE mapel_id=?')
        .all(Number(id)).find(row => !guruIds.includes(Number(row.guru_id)));
      if (jadwalTidakSesuai) {
        return fail(res, 409,
          `Baris ${Number(r.baris) || '?'}: perubahan guru pengampu akan membuat jadwal ${nama} yang sudah tersusun tidak sesuai. Pindahkan slot terlebih dahulu.`);
      }
    }
    let masuk = 0, diperbarui = 0;
    db.transaction(() => {
      let urut = db.prepare('SELECT COALESCE(MAX(urut),0) m FROM mapel').get().m || 0;
      for (const r of rows) {
        if (r.error) continue;
        const nama = String(r.nama || '').trim();
        if (!nama) continue;
        const kode = String(r.kode || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12);
        const maxJam = Math.max(0, Math.min(12, Math.round(Number(r.max_jam_hari) || 0)));
        const guruIds = (Array.isArray(r.guru) ? r.guru : []).map(g => Number(g.id || g)).filter(Boolean);
        let id = kode ? (db.prepare('SELECT id FROM mapel WHERE upper(kode)=?').get(kode) || {}).id : null;
        if (!id) {
          const dup = db.prepare('SELECT id FROM mapel WHERE lower(TRIM(nama))=lower(TRIM(?))').get(nama);
          if (dup) id = dup.id;
        }
        if (id) {
          db.prepare('UPDATE mapel SET kode=?,nama=?,kelompok=?,max_jam_hari=? WHERE id=?')
            .run(kode || db.prepare('SELECT kode FROM mapel WHERE id=?').get(id).kode, nama,
              String(r.kelompok || '').slice(0, 40), maxJam, id);
          diperbarui++;
        } else {
          let finalKode = kode || (nama.slice(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'MAP');
          let n = 1;
          while (db.prepare('SELECT 1 FROM mapel WHERE upper(kode)=?').get(finalKode)) finalKode = `${(kode || 'MAP')}${++n}`;
          const ins = db.prepare('INSERT INTO mapel(kode,nama,kelompok,aktif,urut,max_jam_hari,created_at) VALUES(?,?,?,1,?,?,?)')
            .run(finalKode, nama, String(r.kelompok || '').slice(0, 40), ++urut, maxJam, dbm.now());
          id = Number(ins.lastInsertRowid);
          masuk++;
        }
        if (guruIds.length) {
          db.prepare('DELETE FROM guru_mapel WHERE mapel_id=?').run(id);
          for (const gid of guruIds) {
            if (db.prepare('SELECT 1 FROM users WHERE id=?').get(gid)) {
              db.prepare('INSERT OR IGNORE INTO guru_mapel(guru_id,mapel_id,created_at) VALUES(?,?,?)').run(gid, id, dbm.now());
            }
          }
        }
      }
    })();
    dbm.logAudit(user, 'IMPORT', 'jadwal', `Import mata pelajaran: ${masuk} baru, ${diperbarui} diperbarui`, ipOf(req));
    json(res, 200, { ok: true, masuk, diperbarui, pesan: `${masuk} mapel baru, ${diperbarui} mapel diperbarui (guru pengampu ikut disimpan).` });
  });

  /* =================================================================
     3. JADWAL: MATRIKS, SIMPAN SLOT, PINDAH (DRAG & DROP), HAPUS
     ================================================================= */
  get('/api/jadwal', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const taId = taOf(q);
    const cfg = dbm.jadwalConfig();
    const rows = dbm.jadwalRows(taId);
    const semuaKelas = kelasPicker();
    /* kelas milik tahun pelajaran terpilih; BILA belum ada yang cocok (mis. master kelas
       belum diisi TA-nya) tampilkan SELURUH rombel agar matriks tetap bisa dipakai. */
    let kelas = semuaKelas.filter(k => !k.ta_id || Number(k.ta_id) === Number(taId));
    if (!kelas.length) kelas = semuaKelas;
    const guru = guruList();
    /* mapel dilengkapi guru pengampu (dipakai form slot: guru terkunci otomatis) */
    const guruById = new Map(guru.map(g => [Number(g.id), g]));
    const petaGuru = new Map();
    for (const r of db.prepare('SELECT guru_id, mapel_id FROM guru_mapel ORDER BY id').all()) {
      const arr = petaGuru.get(Number(r.mapel_id)) || [];
      const g = guruById.get(Number(r.guru_id));
      if (g && !arr.some(x => x.id === g.id)) arr.push({ id: g.id, nama: g.nama, username: g.username });
      petaGuru.set(Number(r.mapel_id), arr);
    }
    const mapel = dbm.mapelList().map(m => {
      const list = petaGuru.get(Number(m.id)) || [];
      return { ...m, guru: list, guru_ids: list.map(g => g.id), guru_id: list.length ? list[0].id : 0, guru_nama: list.length ? list[0].nama : '' };
    });
    const ta = (dbm.tahunList().find(t => Number(t.id) === Number(taId)) || {});
    /* VALIDASI TARGET JAM: jam terpasang per kelas vs target per pekan
       (standar global 40 jam, dapat ditimpa per kelas lewat Data Kelas). */
    const targetRows = dbm.targetKelasRows(taId);
    const targetMap = new Map(targetRows.map(t => [Number(t.id), t]));
    const kelasPlus = kelas.map(k => {
      const t = targetMap.get(Number(k.id)) || {};
      return {
        ...k, terisi: t.terisi || 0, target: t.target || 0, target_jam: t.target_jam || 0,
        selisih: t.selisih || 0, status_target: t.status || 'nonaktif', target_khusus: !!t.khusus
      };
    });
    const kalRows = dbm.kalenderRows(taId, ta.tanggal_mulai || '', ta.tanggal_selesai || '');
    json(res, 200, {
      ok: true, ta: taId, ta_nama: ta.nama || '', tahun: dbm.tahunList(),
      config: cfg, hari_label: dbm.HARI_LABEL,
      rows, kelas: kelasPlus, guru, mapel, ruang: dbm.jadwalRuangRows(),
      target: { ...dbm.targetJamConfig(), rows: targetRows },
      kalender: {
        total: kalRows.length,
        nonaktif: kalRows.filter(x => Number(x.nonaktif) === 1).length,
        rows: kalRows.slice(0, 400)
      },
      publik: cfg.publik,
      ringkas: {
        slot: rows.length,
        kelas: kelas.length,
        mapel: mapel.length,
        bentrok: (() => {
          /* hitung bentrok nyata yang mungkin tersisa dari perubahan pengaturan */
          let n = 0;
          const seen = new Map();
          for (const r of rows) {
            for (const k of r.kelas_ids) {
              const key = `${r.hari}|${r.sesi}|${k}`;
              if (seen.has(key)) n++;
              else seen.set(key, r.id);
            }
            if (r.guru_id) {
              const gk = `${r.hari}|${r.sesi}|g${r.guru_id}`;
              if (seen.has(gk)) n++;
              else seen.set(gk, r.id);
            }
          }
          return n;
        })()
      }
    });
  });

  const slotBody = (b) => ({
    id: Number(b.id) || 0,
    hari: Number(b.hari),
    sesi: Number(b.sesi),
    mapel_id: Number(b.mapel_id) || 0,
    guru_id: Number(b.guru_id) || 0,
    kelas_ids: [...new Set(strIds(b.kelas_ids || b.kelas))],
    ruang: String(b.ruang || '').trim().slice(0, 40),
    catatan: String(b.catatan || '').trim().slice(0, 200)
  });

  /**
   * GURU PENGAMPU TERKUNCI: guru pada slot selalu berasal dari Data Master Mata
   * Pelajaran (tabel guru_mapel), bukan pilihan bebas pada form jadwal.
   * - pengampu = 1 guru  → guru slot DIKUNCI ke guru tersebut (pilihan form diabaikan)
   * - pengampu > 1 guru  → guru slot hanya boleh SALAH SATU dari daftar pengampu
   *                        (mis. Matematika diajar 5 guru; jangan dipaksa ke guru pertama)
   * - pengampu kosong    → guru dari form/impor diikat sebagai pengampu mapel
   */
  function guruTerkunci(mapelId, guruDariForm, guruSaatIni) {
    const mapel = db.prepare('SELECT id,nama,kode FROM mapel WHERE id=?').get(Number(mapelId) || 0);
    if (!mapel) return { error: 'Mata pelajaran tidak ditemukan.' };
    const daftar = guruMapelOf(mapel.id);
    const namaPengampu = () => db.prepare(`SELECT id,nama FROM users WHERE id IN (${daftar.map(() => '?').join(',')})`).all(...daftar);
    if (daftar.length) {
      const guruPengampu = namaPengampu();
      if (!guruPengampu.length) return { error: 'Guru pengampu pada Data Master Mata Pelajaran tidak ditemukan.' };
      if (daftar.length === 1) {
        const guru = guruPengampu[0];
        return {
          mapel, guru_id: Number(guru.id), guru_nama: guru.nama, terkunci: true,
          pilihan: [{ id: guru.id, nama: guru.nama }],
          diabaikan: !!guruDariForm && Number(guruDariForm) !== Number(guru.id)
        };
      }
      const boleh = new Set(daftar.map(Number));
      const calon = [guruDariForm, guruSaatIni].map(Number).find(id => id && boleh.has(id));
      if (!calon) {
        return {
          error: `${mapel.nama} memiliki ${daftar.length} guru pengampu (${guruPengampu.map(g => g.nama).join(', ')}). Pilih salah satu guru pengampu tersebut.`,
          mapel, pilihan: guruPengampu.map(g => ({ id: g.id, nama: g.nama }))
        };
      }
      const guru = guruPengampu.find(g => Number(g.id) === Number(calon));
      return {
        mapel, guru_id: Number(guru.id), guru_nama: guru.nama, terkunci: true,
        pilihan: guruPengampu.map(g => ({ id: g.id, nama: g.nama })),
        diabaikan: !!guruDariForm && Number(guruDariForm) !== Number(guru.id) && !boleh.has(Number(guruDariForm))
      };
    }
    const gid = Number(guruDariForm) || Number(guruSaatIni) || 0;
    if (!gid) return { error: `Mata pelajaran ${mapel.nama} belum memiliki guru pengampu. Atur dulu di tab Mata Pelajaran (Guru Pengampu), lalu susun slot jadwal.`, mapel, pilihan: [] };
    const guru = db.prepare('SELECT id,nama FROM users WHERE id=? AND aktif=1').get(gid);
    if (!guru) return { error: 'Guru pengampu yang dipilih tidak ditemukan.' };
    db.prepare('INSERT OR IGNORE INTO guru_mapel(guru_id,mapel_id,created_at) VALUES(?,?,?)').run(guru.id, mapel.id, dbm.now());
    return { mapel, guru_id: Number(guru.id), guru_nama: guru.nama, terkunci: true, baru: true, pilihan: [{ id: guru.id, nama: guru.nama }] };
  }

  function simpanSlot(user, req, res, body) {
    const taId = taOf(body);
    if (!taId) return fail(res, 400, 'Tahun pelajaran belum tersedia.');
    const s = slotBody(body);
    const slotLama = s.id
      ? db.prepare('SELECT * FROM jadwal WHERE id=? AND ta_id=?').get(s.id, taId)
      : null;
    if (s.id && !slotLama) return fail(res, 404, 'Slot jadwal tidak ditemukan pada tahun pelajaran terpilih.');
    const kelasTersedia = new Set(dbm.kelasAll().map(k => Number(k.id)));
    const kelasTidakDikenal = s.kelas_ids.filter(id => !kelasTersedia.has(id));
    if (kelasTidakDikenal.length) {
      return fail(res, 400, `Kelas/rombel tidak ditemukan: ${kelasTidakDikenal.join(', ')}.`);
    }
    /* guru pengampu selalu dari Data Master Mata Pelajaran (terkunci) */
    const penugasan = guruTerkunci(s.mapel_id, s.guru_id,
      slotLama && Number(slotLama.mapel_id) === Number(s.mapel_id) ? slotLama.guru_id : null);
    if (penugasan.error) return fail(res, 400, penugasan.error);
    s.guru_id = penugasan.guru_id;
    const alokasiRuang = dbm.jadwalRuangPilih({
      taId, hari: s.hari, sesi: s.sesi, mapelId: s.mapel_id, ruang: s.ruang, exceptId: s.id
    });
    if (alokasiRuang.error) return fail(res, 409, alokasiRuang.error, { jenis: 'bentrok', konflik: [{ jenis: 'ruang', pesan: alokasiRuang.error }] });
    s.ruang = alokasiRuang.ruang || '';
    const cfg = dbm.jadwalConfig();
    const konflik = dbm.jadwalConflict({
      taId, hari: s.hari, sesi: s.sesi, kelas_ids: s.kelas_ids, guru_id: s.guru_id,
      mapel_id: s.mapel_id, ruang: s.ruang, exceptId: s.id, cfg
    });
    if (konflik.hard.length) {
      return fail(res, 409, konflik.hard[0].pesan, { konflik: konflik.hard, jenis: 'bentrok' });
    }
    const abaikan = body.abaikan === true || body.abaikan === 1 || body.abaikan === '1';
    if (konflik.soft.length && !abaikan) {
      return fail(res, 409, konflik.soft[0].pesan, { konflik: konflik.soft, butuh_konfirmasi: true, jenis: 'peringatan' });
    }
    const kelasIds = s.kelas_ids;
    let id = s.id;
    db.transaction(() => {
      if (id) {
        db.prepare(`UPDATE jadwal SET hari=?,sesi=?,mapel_id=?,guru_id=?,kelas_ids=?,ruang=?,merged=?,catatan=?,updated_at=? WHERE id=? AND ta_id=?`)
          .run(s.hari, s.sesi, s.mapel_id, s.guru_id, JSON.stringify(kelasIds), s.ruang, kelasIds.length > 1 ? 1 : 0, s.catatan, dbm.now(), id, taId);
      } else {
        const r = db.prepare(`INSERT INTO jadwal(ta_id,hari,sesi,mapel_id,guru_id,kelas_ids,ruang,merged,catatan,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(taId, s.hari, s.sesi, s.mapel_id, s.guru_id, JSON.stringify(kelasIds), s.ruang, kelasIds.length > 1 ? 1 : 0, s.catatan, dbm.now(), dbm.now());
        id = Number(r.lastInsertRowid);
      }
    })();
    if (s.guru_id && s.mapel_id) {
      db.prepare('INSERT OR IGNORE INTO guru_mapel(guru_id,mapel_id,created_at) VALUES(?,?,?)').run(s.guru_id, s.mapel_id, dbm.now());
    }
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(s.mapel_id) || {};
    const guru = db.prepare('SELECT nama FROM users WHERE id=?').get(s.guru_id) || {};
    const kelasNama = db.prepare(`SELECT nama FROM kelas WHERE id IN (${kelasIds.map(() => '?').join(',') || 'NULL'})`)
      .all(...kelasIds).map(k => k.nama).join(', ');
    dbm.logAudit(user, s.id ? 'UBAH' : 'TAMBAH', 'jadwal',
      `${s.id ? 'Ubah' : 'Tambah'} slot ${dbm.HARI_LABEL[s.hari]} sesi ${s.sesi}: ${mapel.nama || '-'} · ${guru.nama || '-'} · ${kelasNama}`
      + (konflik.soft.length ? ` (disimpan dengan ${konflik.soft.length} peringatan)` : ''), ipOf(req));
    const catatanGuru = penugasan.diabaikan
      ? [`Guru pengampu ${penugasan.mapel.nama} dikunci ke ${penugasan.guru_nama} sesuai Data Master Mata Pelajaran.`]
      : (penugasan.baru ? [`Guru pengampu ${penugasan.mapel.nama} disimpan di Data Master Mata Pelajaran: ${penugasan.guru_nama}.`] : []);
    const catatanRuang = alokasiRuang.diganti
      ? [`Ruangan mapel dikunci ke ${alokasiRuang.ruang}.`]
      : (alokasiRuang.otomatis ? [`Ruangan ${alokasiRuang.ruang} dialokasikan otomatis.`] : []);
    json(res, 200, {
      ok: true, id, guru_id: penugasan.guru_id, guru_nama: penugasan.guru_nama,
      guru_pilihan: penugasan.pilihan || [],
      ruang: s.ruang, ruang_otomatis: !!alokasiRuang.otomatis,
      peringatan: [...catatanGuru, ...catatanRuang, ...konflik.soft.map(k => k.pesan)],
      pesan: `Jadwal disimpan — guru pengampu ${penugasan.guru_nama}${s.ruang ? ` · ruang ${s.ruang}` : ''}.`
    });
  }

  post('/api/jadwal/slot', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    simpanSlot(user, req, res, b);
  });

  /* pindah slot (drag & drop) — validasi sama ketatnya dengan simpan */
  post('/api/jadwal/move', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(b.id) || 0);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    simpanSlot(user, req, res, {
      ...row, ...b, id: row.id, ta: b.ta || row.ta_id,
      kelas_ids: dbm.jadwalKelasIds(row), mapel_id: row.mapel_id, guru_id: row.guru_id, ruang: row.ruang,
      hari: b.hari === undefined ? row.hari : b.hari, sesi: b.sesi === undefined ? row.sesi : b.sesi
    });
  });

  const hapusSlotDalamTransaksi = (row) => {
    /* Hapus seluruh turunan agar absensi/alfa/izin tidak tertinggal tanpa slot. */
    const sesiIds = db.prepare('SELECT id FROM absensi_sesi WHERE jadwal_id=?').all(Number(row.id)).map(r => Number(r.id));
    db.prepare('DELETE FROM absensi_guru WHERE jadwal_id=?').run(Number(row.id));
    db.prepare('DELETE FROM absensi_guru_izin WHERE jadwal_id=?').run(Number(row.id));
    db.prepare('DELETE FROM absensi_pencatat WHERE jadwal_id=?').run(Number(row.id));
    if (sesiIds.length) {
      const ph = sesiIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM kejadian WHERE sumber='absensi' AND ref_id IN (
        SELECT id FROM absensi_siswa WHERE sesi_id IN (${ph}))`).run(...sesiIds);
      db.prepare(`DELETE FROM absensi_siswa WHERE sesi_id IN (${ph})`).run(...sesiIds);
      db.prepare(`DELETE FROM absensi_sesi WHERE id IN (${ph})`).run(...sesiIds);
    }
    db.prepare('DELETE FROM jadwal_tukar WHERE jadwal_id=?').run(Number(row.id));
    db.prepare('DELETE FROM jadwal WHERE id=?').run(Number(row.id));
  };
  const hapusSlotJadwal = (rows, user, req, res, keterangan) => {
    db.transaction(() => rows.forEach(hapusSlotDalamTransaksi))();
    dbm.logAudit(user, 'HAPUS', 'jadwal', keterangan, ipOf(req));
    json(res, 200, { ok: true, jumlah: rows.length, pesan: `${rows.length} slot jadwal dihapus.` });
  };

  del('/api/jadwal/slot/:id', (req, res, q, params) => {
    const user = guard(req, res, 'jadwal', 'delete'); if (!user) return;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(params.id) || 0);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    hapusSlotJadwal([row], user, req, res,
      `Hapus slot ${dbm.HARI_LABEL[Number(row.hari)] || row.hari} sesi ${row.sesi} (${mapel.nama || '-'})`);
  });

  post('/api/jadwal/slot/delete-masal', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'delete'); if (!user) return;
    const b = await readBody(req);
    const taId = Number(b.ta) || 0;
    if (!taAda(taId)) return fail(res, 400, 'Tahun pelajaran tidak valid.');
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu slot jadwal.');
    if (ids.length > 1000) return fail(res, 400, 'Maksimal 1.000 slot dapat dihapus sekaligus.');
    const rows = db.prepare(`SELECT * FROM jadwal WHERE ta_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(taId, ...ids);
    if (rows.length !== ids.length) return fail(res, 404, 'Sebagian slot tidak ditemukan pada tahun pelajaran terpilih.');
    hapusSlotJadwal(rows, user, req, res, `Hapus ${rows.length} slot jadwal terpilih pada TA ${taId}`);
  });

  post('/api/jadwal/reset', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'delete'); if (!user) return;
    const b = await readBody(req);
    const taId = Number(b.ta) || 0;
    if (!taAda(taId)) return fail(res, 400, 'Tahun pelajaran tidak valid.');
    const rows = db.prepare('SELECT * FROM jadwal WHERE ta_id=? ORDER BY id').all(taId);
    if (!rows.length) return fail(res, 400, 'Tidak ada slot jadwal pada tahun pelajaran terpilih.');
    hapusSlotJadwal(rows, user, req, res, `Reset matriks jadwal: hapus ${rows.length} slot pada TA ${taId}`);
  });

  /* =================================================================
     4. TEMPLATE · IMPOR · EKSPOR · CETAK JADWAL
     ================================================================= */
  const HEADER_JADWAL = ['HARI', 'JAM MULAI', 'KODE MAPEL', 'MAPEL', 'GURU (USERNAME/NAMA)', 'KELAS (PISAH KOMA)', 'RUANG'];
  /* Catatan: kolom GURU pada template hanya dipakai bila mapel belum punya
     guru pengampu — guru pada Data Master Mata Pelajaran selalu menang. */
  const sama = (v) => String(v === undefined || v === null ? '' : v).trim().toLowerCase();

  get('/api/jadwal/template.xlsx', (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const st = dbm.allSettings();
    const cfg = dbm.jadwalConfig();
    const rows = [];
    rows.push([{ v: st.sekolah_nama || 'SEKOLAH', bold: true }]);
    rows.push([{ v: 'TEMPLATE IMPOR JADWAL PELAJARAN', bold: true }]);
    rows.push([`Tahun pelajaran: ${(dbm.tahunAktif() || {}).nama || '-'} · ${cfg.hari.length} hari aktif · ${cfg.sesi.filter(s => !s.istirahat).length} jam/hari`]);
    rows.push([`Hari yang dipakai: ${cfg.hari.map(h => dbm.HARI_LABEL[h]).join(', ')}`]);
    rows.push([`Sesi jam: ${cfg.sesi.filter(s => !s.istirahat).map(s => `${s.no}:${s.mulai}-${s.selesai}`).join(' | ')}`]);
    rows.push([]);
    rows.push([{ v: 'Petunjuk', bold: true }]);
    rows.push(['1. Isi satu baris untuk satu slot jadwal. Jangan mengubah baris judul di atas.']);
    rows.push(['2. HARI: Senin/Selasa/…  JAM MULAI: HH:MM (harus sama dengan sesi yang diatur).']);
    rows.push(['3. GURU: username atau nama lengkap guru yang sudah punya akun.']);
    rows.push(['4. KELAS: satu atau beberapa kelas dipisah koma untuk pembelajaran gabungan (merge).']);
    rows.push(['5. KODE MAPEL baru akan otomatis dibuatkan bila belum ada.']);
    rows.push([]);
    rows.push(HEADER_JADWAL.map(h => ({ v: h, bold: true })));
    rows.push(['Senin', '07:00', 'MTK', 'Matematika', 'guru', 'X TKJ 1', 'R-01']);
    rows.push(['Senin', '07:45', 'BIN', 'Bahasa Indonesia', 'guru', 'X TKJ 1, X AKL 1', 'Aula']);
    const buf = lib.xlsxBuffer('JADWAL', rows, [12, 12, 14, 24, 24, 24, 12]);
    dbm.logAudit(user, 'EXPORT', 'jadwal', 'Unduh template impor jadwal', ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="template-jadwal-pelajaran.xlsx"',
      'Content-Length': buf.length
    });
    res.end(buf);
  });

  function sheetOf(buf, filename) {
    if (/\.csv$/i.test(filename || '')) return xr.readCsv(buf.toString('utf8'))[0];
    const sheets = xr.readXlsx(buf);
    const cari = sheets.find(s => s.rows.some(r => r.some(c => /hari/i.test(xr.cellText(c)))));
    return cari || sheets[0];
  }

  /** analisa isi berkas impor → baris siap + baris bermasalah */
  function analyzeJadwal(buf, filename, taId) {
    const sheet = sheetOf(buf, filename);
    if (!sheet) throw new Error('Berkas tidak memiliki lembar kerja.');
    const raw = sheet.rows.map(r => r.map(c => xr.cellText(c)));
    let hIdx = -1;
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i].join(' ').toLowerCase();
      if (/\bhari\b/.test(t) && /(kelas|mapel|guru)/.test(t)) { hIdx = i; break; }
    }
    if (hIdx < 0) throw new Error('Baris judul kolom tidak ditemukan. Gunakan template yang disediakan (kolom HARI, JAM MULAI, MAPEL, GURU, KELAS).');
    const head = raw[hIdx].map(h => h.toLowerCase());
    const col = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
    const cHari = col('hari');
    const cJam = col('jam mulai', 'jam', 'sesi');
    const cKode = col('kode');
    const cMapel = col('mapel', 'mata pelajaran');
    const cGuru = col('guru', 'username', 'pendidik');
    const cKelas = col('kelas', 'rombel');
    const cRuang = col('ruang', 'lokasi');
    if ([cHari, cJam, cMapel, cGuru, cKelas].some(i => i < 0)) {
      throw new Error('Kolom wajib belum lengkap: HARI, JAM MULAI, MAPEL, GURU, KELAS.');
    }
    const cfg = dbm.jadwalConfig();
    const hariMap = {};
    for (let i = 0; i < dbm.HARI_LABEL.length; i++) {
      hariMap[sama(dbm.HARI_LABEL[i])] = i;
      hariMap[sama(dbm.HARI_LABEL[i]).slice(0, 3)] = i;
    }
    const kelasAll = dbm.kelasAll().map(k => ({ id: Number(k.id), nama: k.nama, ta: Number(k.tahun_ajaran_id) || 0 }));
    const users = db.prepare('SELECT id,nama,username FROM users').all();
    const mapelAll = db.prepare('SELECT * FROM mapel').all();
    const rows = [];
    const kunci = new Map();
    for (let i = hIdx + 1; i < raw.length; i++) {
      const cells = raw[i] || [];
      const getv = (c) => (c >= 0 ? String(cells[c] || '').trim() : '');
      const hariTxt = getv(cHari);
      const jamTxt = getv(cJam);
      const mapelTxt = getv(cMapel);
      const kodeTxt = getv(cKode).toUpperCase();
      const guruTxt = getv(cGuru);
      const kelasTxt = getv(cKelas);
      const ruang = getv(cRuang);
      if (!hariTxt && !jamTxt && !mapelTxt && !guruTxt && !kelasTxt) continue; // baris kosong
      if (/^(jumlah|total|catatan|petunjuk|tanda tangan)/i.test(hariTxt)) continue;
      const out = { baris: i + 1, hari: hariTxt, jam: jamTxt, kode: kodeTxt, mapel: mapelTxt, guru: guruTxt, kelas: kelasTxt, ruang, status: 'ok', pesan: '' };
      const err = (m) => { out.status = 'error'; out.pesan = m; };
      const hari = hariMap[sama(hariTxt)];
      if (hari === undefined) err(`Hari "${hariTxt}" tidak dikenal.`);
      else if (!cfg.hari.includes(hari)) err(`${hariTxt} bukan hari pembelajaran aktif.`);
      let sesi = null;
      /* sesi dicocokkan dengan daftar jam HARI ITU (hari khusus bisa beda dari sesi umum) */
      const daftarSesi = hari === undefined ? cfg.sesi : dbm.sesiOfHari(cfg, hari);
      const jamNum = (String(jamTxt).match(/^\d{1,2}$/) || [])[0];
      const jamHHMM = (String(jamTxt).match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/) || []);
      if (jamNum) sesi = daftarSesi.find(s => !s.istirahat && Number(s.no) === Number(jamNum));
      else if (jamHHMM) {
        const t = `${String(jamHHMM[1]).padStart(2, '0')}:${jamHHMM[2]}`;
        sesi = daftarSesi.find(s => !s.istirahat && s.mulai === t)
          || daftarSesi.find(s => !s.istirahat && dbm.jamMenit(s.mulai) <= dbm.jamMenit(t) && dbm.jamMenit(s.selesai) > dbm.jamMenit(t));
      }
      if (!sesi) err(`Jam "${jamTxt}" tidak cocok dengan sesi jam pelajaran mana pun.`);
      out.hari_no = hari;
      out.sesi = sesi ? sesi.idx : null;
      out.jam_pelajaran = sesi ? sesi.mulai + '–' + sesi.selesai : jamTxt;
      /* guru */
      let guru = users.find(u => sama(u.username) === sama(guruTxt)) || users.find(u => sama(u.nama) === sama(guruTxt));
      if (!guru) err(`Guru "${guruTxt}" tidak ditemukan (pakai username atau nama lengkap akun).`);
      out.guru_id = guru ? guru.id : null;
      /* kelas */
      const daftarKelas = String(kelasTxt).split(/[,;/|]+/).map(x => sama(x)).filter(Boolean);
      const ids = [];
      const namaKelas = [];
      for (const nk of daftarKelas) {
        const k = kelasAll.find(x => sama(x.nama) === nk && (!x.ta || Number(x.ta) === Number(taId)))
          || kelasAll.find(x => sama(x.nama) === nk);
        if (!k) { err(`Kelas "${nk}" tidak ditemukan.`); break; }
        if (!ids.includes(k.id)) { ids.push(k.id); namaKelas.push(k.nama); }
      }
      if (!ids.length && out.status !== 'error') err('Kelas wajib diisi.');
      out.kelas_ids = ids;
      out.kelas_nama = namaKelas.join(', ');
      /* mapel */
      let mapel = mapelAll.find(m => kodeTxt && sama(m.kode) === sama(kodeTxt)) || mapelAll.find(m => sama(m.nama) === sama(mapelTxt));
      if (!mapel && mapelTxt) {
        out.status = out.status === 'error' ? 'error' : 'mapel-baru';
        out.pesan = out.pesan || `Mapel baru akan dibuat (${kodeTxt || 'KODE?'} — ${mapelTxt}).`;
        out.mapel_id = null;
        out.mapel_nama = mapelTxt;
      } else if (!mapel) err('Mapel wajib diisi.');
      else {
        out.mapel_id = mapel.id; out.mapel_nama = mapel.nama; out.kode = mapel.kode;
        /* guru dikunci pada pengampu mapel (bila sudah diatur di Data Master) */
        const pengampu = guruMapelOf(mapel.id);
        if (pengampu.length === 1) {
          const g = users.find(u => Number(u.id) === Number(pengampu[0]));
          if (g && guru && Number(guru.id) !== Number(g.id)) {
            out.pesan = `Guru mengikuti pengampu ${mapel.nama}: ${g.nama}.`;
            out.guru = g.nama;
            out.guru_id = g.id;
          } else if (g && !guru) {
            out.guru = g.nama;
            out.guru_id = g.id;
            if (out.status === 'error' && /Guru/i.test(out.pesan)) { out.status = 'ok'; out.pesan = ''; }
          }
        } else if (pengampu.length > 1) {
          const namaList = pengampu.map(id => (users.find(u => Number(u.id) === Number(id)) || {}).nama).filter(Boolean);
          if (guru && pengampu.includes(Number(guru.id))) {
            /* guru ada di daftar pengampu → dibiarkan */
          } else {
            err(`Guru "${guruTxt}" bukan pengampu ${mapel.nama}. Pilih salah satu: ${namaList.join(', ')}`);
          }
        }
      }
      if (out.status !== 'error') {
        for (const kid of ids) {
          const key = `${hari}|${out.sesi}|k${kid}`;
          if (kunci.has(key)) { err(`Bentrok dengan baris ${kunci.get(key)} (kelas sama pada jam yang sama).`); break; }
          kunci.set(key, i + 1);
        }
        if (guru) {
          const gk = `${hari}|${out.sesi}|g${guru.id}`;
          if (kunci.has(gk)) err(`Guru ${guru.nama} mengajar dua kelas pada jam yang sama (baris ${kunci.get(gk)}).`);
          else kunci.set(gk, i + 1);
        }
      }
      rows.push(out);
    }
    return rows;
  }

  function commitJadwal(user, req, rows, taId, mode) {
    const hasil = { masuk: 0, dilewati: 0, mapelBaru: 0 };
    const cfg = dbm.jadwalConfig();
    db.transaction(() => {
      if (mode === 'ganti') db.prepare('DELETE FROM jadwal WHERE ta_id=?').run(taId);
      for (const r of rows) {
        if (r.status === 'error') { hasil.dilewati++; continue; }
        let mapelId = r.mapel_id;
        if (!mapelId) {
          const ada = db.prepare('SELECT * FROM mapel WHERE lower(nama)=lower(?)').get(r.mapel_nama || '');
          if (ada) mapelId = ada.id;
          else {
            const kode = String(r.kode || r.mapel_nama || 'MAP').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12) || 'MAP';
            let finalKode = kode, n = 1;
            while (db.prepare('SELECT 1 FROM mapel WHERE upper(kode)=?').get(finalKode)) finalKode = `${kode}${++n}`;
            const urut = (db.prepare('SELECT COALESCE(MAX(urut),0) m FROM mapel').get().m || 0) + 1;
            const ins = db.prepare('INSERT INTO mapel(kode,nama,aktif,urut,created_at) VALUES(?,?,1,?,?)')
              .run(finalKode, r.mapel_nama || kode, urut, dbm.now());
            mapelId = Number(ins.lastInsertRowid);
            hasil.mapelBaru++;
          }
        }
        /* guru selalu mengikuti pengampu mapel (bila sudah diatur) */
        const pengampu = guruMapelOf(mapelId);
        const guruFinal = pengampu.length === 1 ? pengampu[0]
          : (pengampu.length > 1 ? (pengampu.includes(Number(r.guru_id)) ? Number(r.guru_id) : null) : r.guru_id);
        if (!guruFinal) { hasil.dilewati++; continue; }
        const alokasiRuang = dbm.jadwalRuangPilih({
          taId, hari: r.hari_no, sesi: r.sesi, mapelId, ruang: r.ruang
        });
        if (alokasiRuang.error) { hasil.dilewati++; continue; }
        /* validasi ulang bentrok terhadap DB (mode tambah) */
        const konflik = dbm.jadwalConflict({
          taId, hari: r.hari_no, sesi: r.sesi, kelas_ids: r.kelas_ids, guru_id: guruFinal,
          mapel_id: mapelId, ruang: alokasiRuang.ruang, cfg
        });
        if (konflik.hard.length) { hasil.dilewati++; continue; }
        db.prepare(`INSERT INTO jadwal(ta_id,hari,sesi,mapel_id,guru_id,kelas_ids,ruang,merged,catatan,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(taId, r.hari_no, r.sesi, mapelId, guruFinal, JSON.stringify(r.kelas_ids), alokasiRuang.ruang || '',
            r.kelas_ids.length > 1 ? 1 : 0, '', dbm.now(), dbm.now());
        if (guruFinal) db.prepare('INSERT OR IGNORE INTO guru_mapel(guru_id,mapel_id,created_at) VALUES(?,?,?)').run(guruFinal, mapelId, dbm.now());
        hasil.masuk++;
      }
    })();
    dbm.logAudit(user, 'IMPORT', 'jadwal',
      `Impor jadwal (${mode === 'ganti' ? 'ganti seluruh' : 'tambah'}): ${hasil.masuk} masuk, ${hasil.dilewati} dilewati, ${hasil.mapelBaru} mapel baru`, ipOf(req));
    return hasil;
  }

  post('/api/jadwal/import/preview', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) return fail(res, 400, 'Berkas tidak terbaca.');
    if (buf.length > 8 * 1024 * 1024) return fail(res, 400, 'Ukuran berkas maksimal 8 MB.');
    let rows;
    try { rows = analyzeJadwal(buf, String(b.filename || ''), taOf(b)); }
    catch (e) { return fail(res, 400, e.message); }
    const error = rows.filter(r => r.status === 'error').length;
    const baru = rows.filter(r => r.status === 'mapel-baru').length;
    json(res, 200, {
      ok: true, rows,
      ringkas: { total: rows.length, siap: rows.length - error, error, mapel_baru: baru },
      pesan: `${rows.length} baris terbaca — ${rows.length - error} siap diimpor, ${error} bermasalah.`
    });
  });

  post('/api/jadwal/import/commit', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) return fail(res, 400, 'Berkas tidak terbaca.');
    let rows;
    try { rows = analyzeJadwal(buf, String(b.filename || ''), taOf(b)); }
    catch (e) { return fail(res, 400, e.message); }
    const error = rows.filter(r => r.status === 'error').length;
    if (error && rows.length === error) return fail(res, 400, 'Tidak ada baris valid untuk diimpor. Perbaiki berkas terlebih dahulu.');
    const hasil = commitJadwal(user, req, rows, taOf(b), String(b.mode) === 'ganti' ? 'ganti' : 'tambah');
    json(res, 200, {
      ok: true, ...hasil,
      pesan: `${hasil.masuk} slot jadwal diimpor${hasil.dilewati ? `, ${hasil.dilewati} baris dilewati` : ''}${hasil.mapelBaru ? `, ${hasil.mapelBaru} mapel baru dibuat` : ''}.`
    });
  });

  /* ---------- data matriks jadwal (dipakai ekspor & cetak) ---------- */
  function matriksData(q) {
    const taId = taOf(q);
    const cfg = dbm.jadwalConfig();
    const mode = ['kelas', 'vertikal', 'guru', 'semua'].includes(String(q.mode)) ? String(q.mode) : 'kelas';
    const kelasFilter = strIds(q.kelas);
    const guruFilter = Number(q.guru) || 0;
    const semuaKelas = kelasPicker();
    let kelasList = semuaKelas.filter(k => !k.ta_id || Number(k.ta_id) === Number(taId));
    if (!kelasList.length) kelasList = semuaKelas;                 // musim data lama / kelas tanpa TA
    if (kelasFilter.length) {
      const pilih = kelasList.filter(k => kelasFilter.includes(Number(k.id)));
      if (pilih.length) kelasList = pilih;
    }
    let rows = dbm.jadwalRows(taId);
    if (mode === 'guru' && guruFilter) rows = rows.filter(r => Number(r.guru_id) === guruFilter);
    else if (guruFilter) rows = rows.filter(r => Number(r.guru_id) === guruFilter);
    if (kelasFilter.length && !kelasList.length) rows = [];
    const hariList = cfg.hari.map(h => Number(h));
    const sesiFor = (hari) => dbm.sesiOfHari(cfg, hari);
    const guruNama = guruFilter ? ((dbm.userById(guruFilter) || {}).nama || '') : '';
    return { taId, cfg, mode, kelasList, rows, hariList, sesiFor, guruFilter, guruNama, kelasFilter };
  }

  /** baris grid vertikal: satu baris = satu hari + satu sesi jam pelajaran */
  function barisVertikal(m) {
    const out = [];
    for (const h of m.hariList) {
      const sesi = m.sesiFor(h);
      for (const s of sesi) {
        /* label KUSTOM hari itu ("Upacara", "Pembiasaan") dipertahankan;
           label generik "Jam …" diganti "Jam ke-N" agar seragam. */
        const lab = String(s.label || '').trim();
        const generik = !lab || /^jam(\s|$)/i.test(lab) || /^sesi\b/i.test(lab) || /^jam\s*ke-/i.test(lab);
        out.push({
          hari: h, hari_label: dbm.HARI_LABEL[h] || '', sesi: s.idx,
          label: s.istirahat ? (lab || 'Istirahat') : (generik ? (s.no ? `Jam ke-${s.no}` : 'Jam') : lab),
          jam: `${s.mulai}–${s.selesai}`, istirahat: !!s.istirahat, sesiRow: s
        });
      }
    }
    return out;
  }
  const slotOf = (m, hari, sesiIdx, kelasId) => m.rows.find(r => Number(r.hari) === Number(hari)
    && Number(r.sesi) === Number(sesiIdx) && r.kelas_ids.includes(Number(kelasId)));

  /** susun berkas Excel jadwal (dipakai panel admin & portal publik) */
  function excelJadwal(m, oleh) {
    const dsn = dbm.jadwalDesain();
    const tampil = dbm.jadwalTampil();
    const st = dbm.allSettings();
    const taNama = (dbm.tahunList().find(t => Number(t.id) === Number(m.taId)) || {}).nama || '-';
    /* isi sel mengikuti pilihan sekolah di menu Desain Jadwal Pelajaran */
    const teksSel = (r) => {
      const b = [];
      if (tampil.kode && r.mapel_kode) b.push(r.mapel_kode);
      if (tampil.nama && r.mapel_nama) b.push(r.mapel_nama);
      if (!b.length && (r.mapel_nama || r.mapel_kode)) b.push(r.mapel_nama || r.mapel_kode);
      if (tampil.guru && r.guru_nama) b.push(r.guru_nama);
      if (tampil.ruang && r.ruang) b.push(r.ruang);
      return b.join(' · ');
    };
    const lebarJam = Math.max(8, Math.round((Number(tampil.kolomJam) || 72) / 7));
    const out = [];
    out.push([{ v: st.sekolah_nama || '', bold: true }]);
    out.push([{ v: dsn.judul || 'JADWAL PELAJARAN', bold: true }]);
    out.push([[dsn.semester, dsn.ta_teks || `Tahun pelajaran: ${taNama}`].filter(Boolean).join(' · ')
      + `${m.guruNama ? ' · Guru: ' + m.guruNama : ''}${m.kelasList.length ? ' · ' + m.kelasList.length + ' rombel' : ''}`]);
    out.push([]);
    const labelMode = { kelas: 'PER KELAS', vertikal: 'MATRIKS VERTIKAL (KELAS SEBAGAI KOLOM)', guru: 'PER GURU', semua: 'SEMUA KELAS DALAM SATU GRID' };
    out.push([{ v: `MATRIKS ${labelMode[m.mode]}`, bold: true }]);

    if (m.mode === 'vertikal' || m.mode === 'semua') {
      /* kolom = kelas, baris = hari + jam */
      const baris = barisVertikal(m);
      out.push([{ v: 'HARI', bold: true }, { v: 'JAM', bold: true }, ...m.kelasList.map(k => ({ v: k.nama, bold: true }))]);
      if (!baris.length) {
        out.push(['(belum ada sesi jam pelajaran)', '', ...m.kelasList.map(() => '')]);
      }
      for (const b of baris) {
        const cells = m.kelasList.map(k => {
          if (b.istirahat) return b.label;
          const r = slotOf(m, b.hari, b.sesi, k.id);
          if (!r) return '';
          return teksSel(r);
        });
        out.push([`${b.hari_label} ${b.label}`, b.jam, ...(cells.length ? cells : [''])]);
      }
    } else {
      /* satu tabel per kelas (horizontal hari × jam) */
      const maxLen = Math.max(m.cfg.sesi.length, ...m.hariList.map(h => m.sesiFor(h).length), 1);
      for (const k of (m.kelasList.length ? m.kelasList : [{ id: 0, nama: '(belum ada kelas)' }])) {
        out.push([]);
        out.push([{ v: k.nama, bold: true }]);
        out.push([{ v: 'JAM', bold: true }, ...m.hariList.map(h => ({ v: dbm.HARI_LABEL[h], bold: true }))]);
        for (let i = 0; i < maxLen; i++) {
          const acuan = m.cfg.sesi[i] || null;
          const label = acuan ? (acuan.istirahat ? acuan.label : `Jam ${acuan.no}`) : `Sesi ${i + 1}`;
          const jam = acuan ? `${acuan.mulai}–${acuan.selesai}` : '';
          const cells = m.hariList.map(h => {
            const s = m.sesiFor(h)[i];
            if (!s) return '';
            if (s.istirahat) return s.label;
            if (!k.id) return '';
            const r = slotOf(m, h, s.idx, k.id);
            return r ? teksSel(r) : '';
          });
          out.push([`${label} ${jam}`.trim(), ...cells]);
        }
      }
    }

    out.push([]);
    out.push([{ v: 'RINCIAN SLOT', bold: true }]);
    out.push(['NO', 'HARI', 'JAM', 'SESI KE', 'KODE', 'MATA PELAJARAN', 'GURU', 'KELAS / ROMBEL', 'RUANG', 'GABUNGAN'].map(h => ({ v: h, bold: true })));
    if (!m.rows.length) {
      out.push(['—', 'Belum ada slot jadwal pada tahun pelajaran ini', '', '', '', '', '', '', '', '']);
    }
    m.rows.forEach((r, i) => {
      const s = m.sesiFor(r.hari).find(x => Number(x.idx) === Number(r.sesi)) || {};
      out.push([
        i + 1, dbm.HARI_LABEL[Number(r.hari)] || r.hari, s.mulai ? `${s.mulai}–${s.selesai}` : '',
        Number(s.no) || (s.label || ''), r.mapel_kode || '', r.mapel_nama || '', r.guru_nama || '', r.kelas_nama || '',
        r.ruang || '', r.kelas_ids.length > 1 ? 'YA' : ''
      ]);
    });
    return lib.xlsxBuffer('JADWAL', out, [Math.max(26, lebarJam), 18, 14, 12, 10, 26, 26, 24, 12, 10, 16, 16, 16, 16]);
  }

  get('/api/jadwal/export.xlsx', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const m = matriksData(q);
    const buf = excelJadwal(m, user.nama);
    dbm.logAudit(user, 'EXPORT', 'jadwal', `Ekspor jadwal Excel (${m.mode}, ${m.rows.length} slot)`, ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="jadwal-pelajaran-${m.mode}-${m.taId}.xlsx"`,
      'Content-Length': buf.length
    });
    res.end(buf);
  });

  get('/api/mapel/template.xlsx', (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const rows = [
      [{ v: 'TEMPLATE IMPOR MATA PELAJARAN', bold: true }],
      [],
      ['KODE', 'NAMA MAPEL', 'KELOMPOK', 'MAKS JAM/HARI', 'GURU PENGAMPU (USERNAME, PISAH KOMA)'].map(h => ({ v: h, bold: true })),
      ['MTK', 'Matematika', 'Umum', 5, 'guru'],
      ['BIN', 'Bahasa Indonesia', 'Umum', 5, 'guru, wali1']
    ];
    const buf = lib.xlsxBuffer('MAPEL', rows, [12, 30, 18, 14, 34]);
    dbm.logAudit(user, 'EXPORT', 'jadwal', 'Unduh template impor mata pelajaran', ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="template-mata-pelajaran.xlsx"',
      'Content-Length': buf.length
    });
    res.end(buf);
  });

  /* ---------- cetak jadwal (HTML siap PDF) ---------- */
  /**
   * Membangun HTML cetak jadwal (dipakai panel admin & portal publik).
   * - Judul, semester, tahun pelajaran, tempat/tanggal & blok tanda tangan berasal
   *   dari menu **Desain Jadwal Pelajaran** (`dbm.jadwalDesain()`).
   * - TIDAK ada teks instruksi cetak, tombol cetak disembunyikan saat print,
   *   dan tidak ada footer "Dicetak … oleh …".
   * - Kerangka grid tetap dirender walau belum ada slot/kelas.
   */
  function htmlCetakJadwal(m, opts = {}) {
    const st = dbm.allSettings();
    const dsn = dbm.jadwalDesain();
    /* pilihan ISI SEL & ukuran kolom diatur di menu Desain Jadwal Pelajaran */
    const tampil = dbm.jadwalTampil();
    const fontTabel = Math.max(6, Math.min(12, Number(tampil.kolomFont) || 7.4));
    const fontKecil = Math.max(5.5, fontTabel - 0.8);
    const esc = lib.esc;

    /**
     * Isi satu KARTU slot (meniru kartu pada matriks web):
     * kode mapel · nama mapel · nama guru · gabungan · ruang.
     * Nama kelas TIDAK diulang di sini (sudah tercetak sebagai judul matriks).
     * Seluruh elemen rata tengah (center).
     */
    const selIsi = (r) => {
      const bagian = [];
      if (tampil.kode && r.mapel_kode) bagian.push(`<span class="kd">${esc(r.mapel_kode)}</span>`);
      if (tampil.nama && r.mapel_nama) bagian.push(`<span class="mp">${esc(r.mapel_nama)}</span>`);
      if (!bagian.length) bagian.push(`<span class="mp">${esc(r.mapel_nama || r.mapel_kode || '')}</span>`);
      /* NAMA KELAS tidak dicetak di dalam kartu: sudah tampil pada judul
         di atas matriks (per kelas & per guru). Hanya kelas GABUNGAN yang
         tetap diberi catatan karena berbeda dari judul. */
      const gabung = tampil.gabungan && r.kelas_ids.length > 1;
      if (tampil.guru && r.guru_nama) bagian.push(`<span class="gr">${esc(r.guru_nama)}</span>`);
      if (gabung) bagian.push(`<span class="merge">Gabungan: ${esc(r.kelas_nama)}</span>`);
      if (tampil.ruang && r.ruang) bagian.push(`<span class="rg">${esc(r.ruang)}</span>`);
      return bagian.join('');
    };
    /* label sesi: label KUSTOM ("Upacara", "Sholat") menang atas "Jam ke-N" */
    const labelSesiOf = (s) => {
      if (!s) return 'Sesi';
      const lab = String(s.label || '').trim();
      if (s.istirahat) return lab || 'Istirahat';
      const generik = !lab || /^jam(\s|$)/i.test(lab) || /^sesi\b/i.test(lab) || /^jam\s*ke-/i.test(lab);
      return generik ? (s.no ? `Jam ke-${s.no}` : 'Jam') : lab;
    };
    const kepalaKartu = (s) => `<span class="lab">${esc(labelSesiOf(s))}</span>`
      + `<span class="wkt">${esc(s.mulai || '')}${s.mulai && s.selesai ? '–' : ''}${esc(s.selesai || '')}</span>`;

    /* 1) grid per kelas / per guru: kolom = hari, baris = sesi.
       Tiap sel = KARTU rounded berisi label jam, rentang waktu, mapel & guru
       (semua rata tengah) → sama seperti matriks kartu pada antarmuka web. */
    const tabelKelas = (k) => {
      const hari = m.hariList;
      const maxLen = Math.max(1, ...hari.map(h => m.sesiFor(h).length));
      const baris = [];
      for (let i = 0; i < maxLen; i++) {
        const tds = hari.map(h => {
          const ss = m.sesiFor(h)[i];
          if (!ss) return '<td class="slot"><div class="kartu kosong"><span class="dash">–</span></div></td>';
          /* CATATAN: label hari khusus (mis. "Upacara"/"Pembiasaan") SUDAH tampil
             lewat kepalaKartu() → jangan menambah <span class="khusus"> lagi,
             karena dulu label yang sama tercetak dua kali (JAM KE-1 dobel). */
          if (ss.istirahat) {
            return `<td class="slot"><div class="kartu ish"><span class="lab">${esc(ss.label || 'Istirahat')}</span>`
              + `<span class="wkt">${esc(ss.mulai || '')}${ss.mulai && ss.selesai ? '–' : ''}${esc(ss.selesai || '')}</span></div></td>`;
          }
          const r = k.id ? slotOf(m, h, ss.idx, k.id) : null;
          if (!r) {
            return `<td class="slot"><div class="kartu kosong">${kepalaKartu(ss)}`
              + `<span class="dash">—</span></div></td>`;
          }
          return `<td class="slot"><div class="kartu">${kepalaKartu(ss)}${selIsi(r)}</div></td>`;
        }).join('');
        baris.push(`<tr>${tds}</tr>`);
      }
      /* judul cukup NAMA KELAS — keterangan tingkat tidak perlu dicetak */
      return `<h3 class="kelas-h">${esc(k.nama || '-')}</h3>
        <table class="grid"><thead><tr>${hari.map(h => `<th>${dbm.HARI_LABEL[h]}</th>`).join('')}</tr></thead>
        <tbody>${baris.join('')}</tbody></table>`;
    };

    /* 2) matriks vertikal: kolom = kelas, baris = hari + jam */
    const tabelVertikal = () => {
      const baris = barisVertikal(m);
      const kolom = m.kelasList;
      const jmlKolom = (kolom.length || 1) + 1;      // kolom "HARI / JAM" + kelas
      const kepala = kolom.length ? kolom.map(k => `<th>${esc(k.nama)}</th>`).join('') : '<th>Belum ada kelas</th>';
      let isi = '';
      if (!baris.length) {
        isi = `<tr><td class="kosong" colspan="${jmlKolom}">Belum ada sesi jam pelajaran — atur di tab Pengaturan Jadwal.</td></tr>`;
      } else {
        let hariSebelum = null;
        for (const b of baris) {
          /* baris judul hari: colspan HARUS tepat = jumlah kolom tabel (kolom jam + kolom kelas) */
          if (b.hari !== hariSebelum) {
            hariSebelum = b.hari;
            isi += `<tr class="hari-row"><td colspan="${jmlKolom}">${esc(b.hari_label)}</td></tr>`;
          }
          const tds = (kolom.length ? kolom : [{ id: 0, nama: '' }]).map(k => {
            if (b.istirahat) return `<td class="slot"><div class="kartu ish"><span class="lab">${esc(b.label)}</span></div></td>`;
            if (!k.id) return '<td class="slot"><div class="kartu kosong"><span class="dash">–</span></div></td>';
            const r = slotOf(m, b.hari, b.sesi, k.id);
            if (!r) return '<td class="slot"><div class="kartu kosong"><span class="dash">–</span></div></td>';
            return `<td class="slot"><div class="kartu">${selIsi(r)}</div></td>`;
          }).join('');
          isi += `<tr class="${b.istirahat ? 'istirahat' : ''}"><th class="jam">${esc(b.label)}<br><span>${esc(b.jam)}</span></th>${tds}</tr>`;
        }
      }
      return `<table class="grid vert"><thead><tr><th class="jam">HARI / JAM</th>${kepala}</tr></thead><tbody>${isi}</tbody></table>`;
    };

    let isi;
    if (m.mode === 'vertikal' || m.mode === 'semua') isi = tabelVertikal();
    else {
      const daftar = m.kelasList.length ? m.kelasList : [{ id: 0, nama: '(belum ada kelas)' }];
      isi = daftar.map(tabelKelas).join('');
    }
    const infoKosong = m.rows.length ? ''
      : '<p class="kosong-info">Belum ada slot jadwal pada tahun pelajaran ini — kerangka kolom &amp; baris tetap ditampilkan.</p>';

    const subJudul = [dsn.semester, dsn.ta_teks].filter(Boolean).join(' · ');
    /* URUTAN TANDA TANGAN (sesuai contoh sekolah):
       baris atas  : Kepala Sekolah (kiri) · Tempat, tanggal + Wakasek Kurikulum (kanan)
       baris bawah : Mengetahui, Pengawas Pembina — di tengah halaman.
       Di atas nama Kepala Sekolah TIDAK ada tulisan "Mengetahui". */
    const tempatTanggal = `${dsn.tempat ? esc(dsn.tempat) + ', ' : ''}${esc(dsn.tanggal)}`;
    const ttdKepala = `<div class="ttd-row">
      <div class="ttd-col"><p>Kepala Sekolah,</p><p>&nbsp;</p>
        <div class="ttd-space"></div><p class="nm">${esc(dsn.kepala_nama || '..............................')}</p>
        <p class="nip">NIP. ${esc(dsn.kepala_nip || '..............................')}</p></div>
      <div class="ttd-col"><p>${tempatTanggal}</p><p>${esc(dsn.wakasek_jabatan)}${/,/.test(String(dsn.wakasek_jabatan || '')) ? '' : ','}</p>
        <div class="ttd-space"></div><p class="nm">${esc(dsn.wakasek_nama || '..............................')}</p>
        <p class="nip">NIP. ${esc(dsn.wakasek_nip || '..............................')}</p></div>
    </div>`;
    const ttdPengawas = dsn.pengawas_tampil && dsn.pengawas_nama
      ? `<div class="ttd-pengawas"><p>Mengetahui,<br>Pengawas Pembina,</p>
          <div class="ttd-space"></div><p class="nm">${esc(dsn.pengawas_nama)}</p>
          <p class="nip">NIP. ${esc(dsn.pengawas_nip || '..............................')}</p></div>`
      : '';

    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<title>${esc(dsn.judul)} — ${esc(st.sekolah_nama || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page { size: A4 landscape; margin: 9mm; }
*{box-sizing:border-box}
body{font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;margin:0;padding:12px;background:#f1f5f9}
.sheet{background:#fff;padding:12px;margin:0 auto;max-width:1600px;box-shadow:0 8px 30px rgba(15,23,42,.12)}
.kop{display:flex;align-items:center;gap:12px;border-bottom:3px double #111;padding-bottom:7px;margin-bottom:8px}
.kop img{width:60px;height:60px;object-fit:contain}
.kop .kop-txt{flex:1;text-align:center}
.kop .nama{font-size:15pt;font-weight:700}
.kop .sub,.kop .alamat{font-size:9pt}
h2.judul{text-align:center;font-size:13pt;text-transform:uppercase;letter-spacing:.6px;margin:8px 0 2px}
p.sub2{text-align:center;font-size:9.5pt;margin:0 0 10px;color:#334155}
h3.kelas-h{font-size:10.5pt;margin:12px 0 4px;background:#fff7ed;border-left:4px solid #ea580c;padding:4px 8px;page-break-after:avoid;text-align:center}
h3.kelas-h span{font-weight:400;font-size:8.5pt;color:#64748b}
table.grid{width:100%;border-collapse:separate;border-spacing:3px;table-layout:fixed;margin-bottom:8px}
table.grid th,table.grid td{border:1px solid #e2e8f0;font-size:${fontTabel}pt;padding:2px 3px;
  vertical-align:middle;text-align:center;word-wrap:break-word}
table.grid.vert th,table.grid.vert td{font-size:${Math.max(6, fontTabel - 0.4)}pt}
table.grid thead th{background:#f1f5f9;text-align:center;font-size:${Math.max(6, fontTabel + 0.2)}pt}
table.grid th.jam{width:${tampil.kolomJam}px;background:#fff7ed;font-size:${Math.max(6, fontTabel - 0.4)}pt;text-align:center}
table.grid th.jam span{white-space:nowrap}
/* KARTU SLOT — meniru matriks kartu pada antarmuka web (rounded, isi rata tengah) */
table.grid td.slot{border:0;background:transparent;padding:0;text-align:center;vertical-align:middle}
.kartu{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;text-align:center;
  border:1px solid #fed7aa;border-radius:7px;background:#fff7ed;padding:3px 2px;min-height:46px;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.kartu.kosong{min-height:42px;border-style:dashed;border-color:#e2e8f0;background:#fcfcfd}
.kartu.ish{border-color:#fde68a;background:#fef9c3}
table.grid td span{font-size:${fontKecil}pt;color:#475569}
table.grid .kartu span{display:block;line-height:1.2}
table.grid .kartu .lab{font-weight:800;color:#c2410c;font-size:${Math.max(5.5, fontKecil - 0.6)}pt;
  text-transform:uppercase;letter-spacing:.2px;line-height:1.1}
table.grid .kartu .wkt{color:#64748b;font-weight:600;font-size:${Math.max(5.5, fontKecil - 0.6)}pt;white-space:nowrap}
table.grid .kartu .kd{display:inline-block;border-radius:4px;background:#ccfbf1;color:#115e59;font-weight:800;
  font-size:${Math.max(5.5, fontKecil - 0.4)}pt;padding:0 4px;line-height:1.5}
table.grid .kartu .mp{font-weight:700;color:#0f172a;font-size:${fontKecil}pt}
table.grid .kartu .kls{color:#0f766e;font-weight:700;font-size:${Math.max(5.5, fontKecil - 0.3)}pt}
table.grid .kartu .gr{color:#475569;font-size:${fontKecil}pt}
table.grid .kartu .rg{color:#94a3b8;font-size:${Math.max(5.5, fontKecil - 0.4)}pt}
table.grid .kartu .merge{color:#be123c;font-size:${Math.max(5.5, fontKecil - 0.4)}pt;font-weight:700}
table.grid .kartu .khusus{font-weight:800;color:#6d28d9;font-size:${Math.max(5.5, fontKecil - 0.5)}pt;
  text-transform:uppercase;letter-spacing:.2px}
table.grid .kartu.ish .lab{color:#92400e}
table.grid .kartu .dash{color:#cbd5e1;font-weight:700}
tr.istirahat th{background:#fff7ed;font-style:italic}
tr.hari-row td{background:#e2e8f0;font-weight:700;font-size:8pt;padding:3px 6px;text-align:center;
  letter-spacing:.4px;text-transform:uppercase}
table.grid tr{page-break-inside:avoid}
p.kosong-info{text-align:center;color:#b45309;font-size:9pt;background:#fffbeb;border:1px dashed #f59e0b;padding:6px;border-radius:6px}
.ttd-grid{margin-top:18px;page-break-inside:avoid}
.ttd-row{display:flex;justify-content:space-between;gap:24px}
.ttd-col{flex:1;text-align:center;font-size:9pt;line-height:1.35}
.ttd-pengawas{width:42%;margin:16px auto 0;text-align:center;font-size:9pt;line-height:1.35}
.ttd-col .ttd-space{height:48px}
.ttd-pengawas .ttd-space{height:48px}
.ttd-col .nm{font-weight:700;text-decoration:underline;margin:0}
.ttd-pengawas .nm{font-weight:700;text-decoration:underline;margin:0}
.ttd-col .nip,.ttd-pengawas .nip{margin:1px 0 0;font-size:8.6pt}
.ttd-col p,.ttd-pengawas p{margin:0}
.bar{display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px}
.btn{background:#ea580c;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer}
@media print{
  body{background:#fff;padding:0}
  .sheet{box-shadow:none;padding:0;max-width:none}
  .bar,.no-print,.btn{display:none !important}
}
</style></head><body>
<div class="bar no-print"><button class="btn" onclick="window.print()">Cetak / Simpan PDF</button></div>
<div class="sheet">
${require('./doc').kop(st, { simetris: true, balance: true, widthPx: 1055 })}
<h2 class="judul">${esc(dsn.judul)}</h2>
${subJudul ? `<p class="sub2">${esc(subJudul)}</p>` : '<div style="height:6px"></div>'}
${opts.filterInfo ? `<p class="sub2" style="margin-top:-6px">${esc(opts.filterInfo)}</p>` : ''}
${infoKosong}
${isi}
<div class="ttd-grid">${ttdKepala}${ttdPengawas}</div>
</div></body></html>`;
    return html;
  }

  get('/api/jadwal/cetak', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const m = matriksData(q);
    const info = [];
    if (m.guruNama) info.push(`Guru: ${m.guruNama}`);
    const html = htmlCetakJadwal(m, {
      tampilMode: true,
      filterInfo: info.join(' · ')
    });
    dbm.logAudit(user, 'CETAK', 'jadwal', `Cetak jadwal pelajaran (${m.mode}, ${m.rows.length} slot, ${m.kelasList.length} rombel)`, ipOf(req));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  /* =================================================================
     4b. DESAIN CETAK JADWAL PELAJARAN (header & tanda tangan)
     ================================================================= */
  get('/api/jadwal/desain', (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    json(res, 200, {
      ok: true, desain: dbm.jadwalDesain(),
      tampil: dbm.jadwalTampil(),
      identitas: {
        sekolah: dbm.getSetting('sekolah_nama', ''),
        kepala_nama: dbm.getSetting('kepala_nama', ''),
        kepala_nip: dbm.getSetting('kepala_nip', ''),
        wakasek_nama: dbm.getSetting('wakasek_nama', ''),
        wakasek_nip: dbm.getSetting('wakasek_nip', ''),
        print_tempat: dbm.getSetting('print_tempat', '')
      },
      contoh_url: '/api/jadwal/cetak?mode=kelas'
    });
  });

  post('/api/jadwal/desain', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const teks = (v, maks = 120) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, maks);
    const judul = teks(b.judul, 80);
    if (!judul) return fail(res, 400, 'Judul utama jadwal wajib diisi.');
    const pengawasTampil = b.pengawas_tampil === undefined
      ? '1' : (b.pengawas_tampil === 1 || b.pengawas_tampil === '1' || b.pengawas_tampil === true ? '1' : '0');
    const isian = {
      jadwal_judul: judul,
      jadwal_semester: teks(b.semester, 60),
      jadwal_ta_teks: teks(b.ta_teks, 80),
      jadwal_ttd_tempat: teks(b.tempat, 60),
      jadwal_ttd_tanggal: teks(b.tanggal, 60),
      jadwal_pengawas_tampil: pengawasTampil,
      jadwal_pengawas_nama: teks(b.pengawas_nama, 120),
      jadwal_pengawas_nip: teks(b.pengawas_nip, 40),
      jadwal_kepala_nama: teks(b.kepala_nama, 120),
      jadwal_kepala_nip: teks(b.kepala_nip, 40),
      jadwal_wakasek_nama: teks(b.wakasek_nama, 120),
      jadwal_wakasek_nip: teks(b.wakasek_nip, 40),
      jadwal_wakasek_jabatan: teks(b.wakasek_jabatan, 60) || 'Wakasek Kurikulum'
    };
    /* ---- ISI SEL & UKURAN KOLOM TABEL (cetak PDF & Excel) ----
       Divalidasi SEBELUM menyimpan apa pun supaya permintaan yang ditolak
       tidak meninggalkan setting setengah tersimpan. */
    let tampilBaru = null;
    if (b.tampil && typeof b.tampil === 'object') {
      const t = b.tampil;
      const flag = (v, def) => (v === undefined || v === null || v === ''
        ? def : (v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'true' ? 1 : 0));
      const angka = (v, a, c, def) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.max(a, Math.min(c, n)) : def;
      };
      tampilBaru = {
        kode: flag(t.kode, 1), nama: flag(t.nama, 1), guru: flag(t.guru, 1),
        ruang: flag(t.ruang, 0), gabungan: flag(t.gabungan, 1),
        kolomJam: Math.round(angka(t.kolomJam, 40, 200, 72)),
        kolomFont: Math.round(angka(t.kolomFont, 6, 12, 7.4) * 10) / 10
      };
      if (!tampilBaru.kode && !tampilBaru.nama) {
        return fail(res, 400, 'Pilih minimal salah satu: Kode Mapel atau Nama Mapel untuk isi sel jadwal.');
      }
    }
    for (const [k, v] of Object.entries(isian)) dbm.setSetting(k, v);
    if (tampilBaru) dbm.setSetting('jadwal_tampil', JSON.stringify(tampilBaru));
    dbm.logAudit(user, 'UBAH', 'jadwal',
      `Desain cetak jadwal: judul "${judul}", ${isian.jadwal_semester || '-'} · ${isian.jadwal_ta_teks || 'TA otomatis'}`, ipOf(req));
    json(res, 200, { ok: true, desain: dbm.jadwalDesain(), tampil: dbm.jadwalTampil(), pesan: 'Desain cetak jadwal tersimpan.' });
  });

  /* =================================================================
     5. TAUTAN PUBLIK REKAP JADWAL
     ================================================================= */
  get('/api/jadwal/publik', (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const cfg = dbm.jadwalConfig();
    const path = cfg.publik.token ? `/jadwal-publik/${cfg.publik.token}` : '';
    json(res, 200, {
      ok: true, token: cfg.publik.token, aktif: cfg.publik.aktif,
      path, url: path ? absUrl(req, path) : ''
    });
  });

  post('/api/jadwal/publik', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    let token = dbm.getSetting('jadwal_publik_token', '');
    const rotate = b.rotate === true || b.rotate === 1 || b.rotate === '1';
    if (!token || rotate) {
      token = tokenOf(req, 'jp');
      dbm.setSetting('jadwal_publik_token', token);
    }
    const aktif = b.aktif === undefined ? '1' : (b.aktif ? '1' : '0');
    dbm.setSetting('jadwal_publik_aktif', aktif);
    const path = `/jadwal-publik/${token}`;
    dbm.logAudit(user, 'UBAH', 'jadwal', `${aktif === '1' ? 'Aktifkan' : 'Nonaktifkan'} tautan publik jadwal${rotate ? ' (token diperbarui)' : ''}`, ipOf(req));
    json(res, 200, { ok: true, token, aktif: aktif === '1', path, url: absUrl(req, path), pesan: 'Tautan publik jadwal disimpan.' });
  });

  /* QR & tautan publik jadwal (dipakai panel jadwal & halaman publik) */
  get('/api/jadwal/publik/qr', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const cfg = dbm.jadwalConfig();
    if (!cfg.publik.token) return fail(res, 404, 'Tautan publik jadwal belum dibuat.');
    const url = absUrl(req, `/jadwal-publik/${cfg.publik.token}`);
    const qr = await qrPair(url);
    json(res, 200, { ok: true, url, path: `/jadwal-publik/${cfg.publik.token}`, token: cfg.publik.token, aktif: !!cfg.publik.aktif, qr });
  });

  /** token publik jadwal valid (dipakai semua endpoint publik jadwal) */
  function tokenJadwalValid(token) {
    const saved = String(dbm.getSetting('jadwal_publik_token', '') || '');
    const aktif = String(dbm.getSetting('jadwal_publik_aktif', '0')) === '1';
    return !!saved && String(token || '') === saved && aktif;
  }

  /** data jadwal publik (dipakai halaman /jadwal-publik/<token>) */
  function publikJadwalData(token, q) {
    const taId = Number(q.ta) || Number(dbm.getSetting('ta_aktif', 0)) || (dbm.tahunAktif() || {}).id;
    const cfg = dbm.jadwalConfig();
    const kelasAll = kelasPicker().filter(k => !k.ta_id || Number(k.ta_id) === Number(taId));
    const guruAll = guruList();
    let rows = dbm.jadwalRows(taId);
    const kelasId = Number(q.kelas) || 0;
    const guruId = Number(q.guru) || 0;
    const cari = sama(q.q);
    if (kelasId) rows = rows.filter(r => r.kelas_ids.includes(kelasId));
    if (guruId) rows = rows.filter(r => Number(r.guru_id) === guruId);
    if (cari) {
      rows = rows.filter(r => [r.mapel_nama, r.guru_nama, r.kelas_nama, r.ruang].some(v => sama(v).includes(cari)));
    }
    return {
      ta: taId, ta_nama: (dbm.tahunList().find(t => Number(t.id) === Number(taId)) || {}).nama || '',
      sekolah: { nama: dbm.getSetting('sekolah_nama', ''), alamat: dbm.getSetting('sekolah_alamat', ''), logo: dbm.getSetting('logo', '') || dbm.getSetting('app_logo', '') },
      config: { hari: cfg.hari, sesi: cfg.sesi, sesi_hari: cfg.sesiHari || {} },
      hari_label: dbm.HARI_LABEL,
      kelas: kelasAll.map(k => ({ id: k.id, nama: k.nama, tingkat: k.tingkat, ta_id: k.ta_id })),
      guru: guruAll.map(g => ({ id: g.id, nama: g.nama })),
      rows, filter: { kelas: kelasId, guru: guruId, q: String(q.q || '') }
    };
  }

  get('/api/public/jadwal/:token/qr', async (req, res, q, params) => {
    const token = String(params.token || '');
    const saved = String(dbm.getSetting('jadwal_publik_token', '') || '');
    const aktif = String(dbm.getSetting('jadwal_publik_aktif', '0')) === '1';
    if (!saved || token !== saved || !aktif) return fail(res, 404, 'Tautan jadwal tidak ditemukan atau sudah tidak berlaku.');
    const url = absUrl(req, `/jadwal-publik/${token}`);
    const qr = await qrPair(url);
    json(res, 200, { ok: true, url, qr });
  });

  /* ---------- ekspor & cetak dari halaman publik (tanpa login) ---------- */
  function matriksPublik(q) {
    const taId = Number(q.ta) || Number(dbm.getSetting('ta_aktif', 0)) || (dbm.tahunAktif() || {}).id;
    const kelasFilter = strIds(q.kelas);
    const guruFilter = Number(q.guru) || 0;
    const mode = ['kelas', 'vertikal', 'guru', 'semua'].includes(String(q.mode)) ? String(q.mode) : 'kelas';
    return matriksData({ ...q, ta: taId, mode, kelas: kelasFilter, guru: guruFilter });
  }

  get('/api/public/jadwal/:token/export.xlsx', (req, res, q, params) => {
    if (!tokenJadwalValid(params.token)) return fail(res, 404, 'Tautan jadwal tidak ditemukan atau sudah tidak berlaku.');
    const m = matriksPublik(q);
    const buf = excelJadwal(m, 'Portal publik');
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="jadwal-pelajaran-${m.mode}-${m.taId}.xlsx"`,
      'Content-Length': buf.length, 'Cache-Control': 'no-store'
    });
    res.end(buf);
  });

  get('/api/public/jadwal/:token/cetak', (req, res, q, params) => {
    if (!tokenJadwalValid(params.token)) return fail(res, 404, 'Tautan jadwal tidak ditemukan atau sudah tidak berlaku.');
    const m = matriksPublik(q);
    const info = [];
    if (m.guruNama) info.push(`Guru: ${m.guruNama}`);
    const html = htmlCetakJadwal(m, { filterInfo: info.join(' · ') });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  get('/api/public/jadwal/:token', (req, res, q, params) => {
    const token = String(params.token || '');
    const saved = String(dbm.getSetting('jadwal_publik_token', '') || '');
    const aktif = String(dbm.getSetting('jadwal_publik_aktif', '0')) === '1';
    if (!saved || token !== saved || !aktif) {
      return fail(res, 404, 'Tautan rekap jadwal tidak ditemukan atau sudah tidak aktif.');
    }
    json(res, 200, { ok: true, ...publikJadwalData(token, q) });
  });

  /* =================================================================
     6. ABSENSI GURU MAPEL
     ================================================================= */
  const kelompokJadwal = (row, rows, cfg) => dbm.absensiKelompok(row, rows, cfg);
  const jendelaKelompok = (items, tanggal, cfg) => dbm.absensiWindowKelompok(items, tanggal, cfg);
  const sesiSudahLewat = (items, tanggal, cfg) => {
    const tgl = String(tanggal || '').slice(0, 10);
    const hariIni = dbm.today();
    if (tgl < hariIni) return true;
    if (tgl > hariIni) return false;
    const window = jendelaKelompok(items, tgl, cfg);
    const selesai = dbm.jamMenit((window.sesi_akhir || window.sesi || {}).selesai);
    return selesai !== null && dbm.nowMenit() > selesai + (Number(cfg?.toleransiTutup) || 0);
  };
  const mapelEfektif = (row, tukar) => {
    const id = tukar && Number(tukar.mapel_id) ? Number(tukar.mapel_id) : Number(row.mapel_id) || 0;
    if (id === Number(row.mapel_id)) return {};
    const mapel = db.prepare('SELECT id,nama,kode FROM mapel WHERE id=?').get(id) || {};
    return { mapel_id: id, mapel_nama: mapel.nama || '', mapel_kode: mapel.kode || '' };
  };
  const alurKelompok = (items, tanggal) => {
    const list = items.map(x => dbm.absensiAlur(x.id, tanggal));
    if (list.length < 2) return list[0] || null;
    return {
      ...list[0],
      absensi_siswa: {
        total: list.reduce((n, a) => n + a.absensi_siswa.total, 0),
        terisi: list.reduce((n, a) => n + a.absensi_siswa.terisi, 0),
        lengkap: list.every(a => a.absensi_siswa.lengkap),
        sebagian: list.some(a => a.absensi_siswa.sebagian),
        sesi_id: list[0].absensi_siswa.sesi_id
      },
      jurnal: { ...list[0].jurnal, lengkap: list.every(a => a.jurnal.lengkap) },
      foto: { ...list[0].foto, ada: list.every(a => a.foto.ada) },
      selesai: list.every(a => a.selesai), group: list
    };
  };
  get('/api/absensi-guru', (req, res, q) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const taId = taOf(q);
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    /* ALFA OTOMATIS: slot yang jam pelajarannya sudah berakhir tanpa check-in
       dicatat sebagai alpha sebelum rekap dibaca. */
    let auto = { dibuat: 0 };
    try { auto = dbm.autoAlfaGuru(tanggal); } catch (e) { auto = { dibuat: 0, error: e.message }; }
    const cfg = dbm.jadwalConfig();
    const hari = dbm.hariOf(tanggal);
    const guruId = Number(q.guru) || 0;
    const lihatSemua = lihatSemuaJadwalAbsensi(user);
    /* Wakasek Kurikulum dan Kesiswaan hanya melihat slot milik guru efektifnya. */
    const targetGuru = lihatSemua ? (guruId || 0) : user.id;
    /* SINKRONISASI JADWAL → ABSENSI: slot hari ini bisa saja tersimpan pada tahun
       pelajaran lain (mis. saat menyusun jadwal TA berikutnya). Bila TA yang
       sedang aktif belum punya slot untuk hari ini, pakai TA yang memilikinya. */
    let semua = dbm.jadwalRows(taId).filter(r => Number(r.hari) === hari);
    let taPakai = taId;
    if (!semua.length) {
      for (const id of semuaTaIds()) {
        if (Number(id) === Number(taId)) continue;
        const coba = dbm.jadwalRows(id).filter(r => Number(r.hari) === hari);
        if (coba.length) { semua = coba; taPakai = Number(id); break; }
      }
    }
    const abs = db.prepare('SELECT * FROM absensi_guru WHERE tanggal=? AND ta_id=?').all(tanggal, taPakai);
    const absMap = new Map(abs.map(a => [Number(a.jadwal_id), a]));
    /* TUKAR JADWAL (temporer hari ini): slot yang sudah ditukar menjadi milik
       guru pengganti — guru asli tidak lagi melihat tombol check-in untuknya. */
    const tukarHari = dbm.tukarMap(tanggal);
    const guruEfektifOf = (r) => dbm.tukarGuruEfektif(r, tanggal, tukarHari);
    const tukarOf = (r) => tukarHari.get(Number(r.id)) || null;
    const mapRow = (r) => {
      const group = kelompokJadwal(r, semua, cfg);
      const w = jendelaKelompok(group, tanggal, cfg);
      const a = absMap.get(Number(r.id)) || null;
      const viaCheckin = !!(a && /"sumber"\s*:\s*"checkin"/.test(String(a.validasi || '')));
      const autoAlfa = !!(a && /"auto"\s*:\s*true/.test(String(a.validasi || '')));
      const alur = a ? alurKelompok(group, tanggal) : null;
      const tukar = tukarOf(r);
      const gidEfektif = tukar ? Number(tukar.ke_guru) : Number(r.guru_id) || 0;
      const guruEfektif = gidEfektif && gidEfektif !== Number(r.guru_id)
        ? db.prepare('SELECT id,nama,nip FROM users WHERE id=?').get(gidEfektif) : null;
      const milikSaya = !!user.id && gidEfektif === Number(user.id);
      const atasNama = isAdmin(user);
      const bolehTulis = dbm.can(user, 'absensi_guru', 'write');
      return {
        alur,
        ...r, ...mapelEfektif(r, tukar), jam: w.sesi ? `${w.sesi.mulai}–${w.selesai}` : '',
        group_ids: group.map(x => Number(x.id)),
        group_jam: w.sesi ? `${w.sesi.mulai}–${w.selesai}` : '',
        group_label: group.length > 1
          ? `Jam ke-${w.sesi.no}–${w.sesi_akhir.no}` : (w.sesi ? `Jam ke-${w.sesi.no}` : ''),
        jam_no: w.sesi ? w.sesi.no : 0,
        guru_efektif_id: gidEfektif,
        guru_efektif_nama: guruEfektif ? guruEfektif.nama : (r.guru_nama || ''),
        milik_saya: milikSaya,
        tukar: tukar ? {
          id: tukar.id, dari_guru: tukar.dari_guru, dari_nama: tukar.dari_nama,
          ke_guru: tukar.ke_guru, ke_nama: tukar.ke_nama, alasan: tukar.alasan || '',
          jenis: tukar.jenis || 'tukar'
        } : null,
        window: {
          aktif: w.aktif, alasan: w.alasan, buka: w.buka, tutup: w.tutup,
          selesai: w.selesai || '', terkunci: !!w.terkunci,
          sekarang: w.sekarang
        },
        absensi: a, status: a ? a.status : '',
        via_checkin: viaCheckin, auto_alfa: autoAlfa,
        /* TIME-LOCKING: seluruh tombol aksi (check-in, presensi siswa, jurnal, edit)
           NONAKTIF setelah jam pelajaran selesai (+ toleransi) — sama di server.
           KEPEMILIKAN: pengawas yang hanya boleh MELIHAT (mis. Wakasek Kesiswaan)
           tidak mendapat tombol aktif pada slot milik guru lain — server juga menolak. */
        bisa_checkin: !!w.aktif && !a && bolehTulis && (milikSaya || atasNama)
          && !(tukar && String(tukar.jenis || '') === 'penugasan'),
        bisa_isi: (milikSaya || atasNama) && (!!w.aktif || !!a),
        bisa_ubah: !!(a && w.aktif && bolehTulis && !viaCheckin && !autoAlfa && (milikSaya || atasNama)),
        bisa_jurnal: !!(a && w.aktif && bolehTulis && (milikSaya || atasNama)),
        terkunci: !w.aktif,
        /* tombol "Tukar Jadwal" hanya untuk guru pemilik sesi pada hari ini dan
           masih SEBELUM jam pelajaran berakhir */
        bisa_tukar: !!(milikSaya && !a && w.sesi && Number(r.hari) === dbm.hariOf(tanggal)
          && tanggal === dbm.today() && !tukar && dbm.nowMenit() <= dbm.jamMenit(w.tutup))
      };
    };
    const jadwalGuru = semua.filter(r => !targetGuru || guruEfektifOf(r) === Number(targetGuru)).map(mapRow);
    const jadwalHari = lihatSemua ? semua.map(mapRow) : [];
    const rekap = rekapAbsensiUntuk(dbm.absensiGuruRekap(tanggal, taPakai), user);
    const hanyaGuru = !lihatSemua;
    json(res, 200, {
      ok: true, tanggal, hari, tanggal_label: dbm.tanggalPanjang(tanggal), hari_label: dbm.HARI_LABEL,
      ta: taPakai,
      jumlah_slot: jadwalGuru.length,
      /* KALENDER AKADEMIK: hari libur / ujian / kegiatan → jadwal reguler tidak berlaku */
      kalender: (() => {
        const k = dbm.kalenderOfDate(tanggal);
        if (!k) return null;
        return {
          id: k.id, kategori: k.kategori, label: dbm.KALENDER_KATEGORI_LABEL[k.kategori] || '',
          judul: k.judul || '', keterangan: k.keterangan || '', nonaktif: Number(k.nonaktif)
        };
      })(),
      kbm_libur: dbm.kalenderNonaktif(tanggal),
      config: {
        buka_menit: cfg.bukaMenit, tutup_menit: cfg.tutupMenit, jurnal_min: cfg.jurnalMin,
        foto_wajib: cfg.fotoWajib ? 1 : 0, foto_hari: cfg.fotoHari,
        max_upload_kb: Math.max(64, Number(dbm.getSetting('upload_max_kb', 2048)) || 2048),
        gateway_aktif: !!(dbm.waConfig().aktif && dbm.waConfig().url)
      },
      saya: { id: user.id, nama: user.nama, role_label: dbm.roleLabelOf(user) },
      guru: lihatSemua ? guruList() : [], lihat_semua: lihatSemua,
      jadwal: jadwalGuru, jadwal_hari: hanyaGuru ? [] : jadwalHari,
      rekap,
      /* permintaan tukar jadwal: masuk (harus dijawab) & riwayat yang saya ajukan */
      tukar_masuk: dbm.tukarMasuk(user.id),
      tukar_keluar: dbm.tukarKeluar(user.id, 20),
      status_list: dbm.ABSENSI_GURU_STATUS,
      auto_alpha: { aktif: String(dbm.getSetting('absensi_auto_alpha', '1')) === '1', dibuat: auto.dibuat || 0 },
      wa: { aktif: cfg.waAktif ? 1 : 0, jam: cfg.waJam, kepsek: cfg.kepsekWa, wakasek: cfg.wakasekWa, terakhir: cfg.waTerakhir }
    });
  });

  /* =================================================================
     JADWAL MENGAJAR SAYA — hari ini & hari-hari berikutnya
     ---------------------------------------------------------------------
     Menampilkan SELURUH sesi milik guru (termasuk hari esok / pekan depan)
     agar guru punya gambaran lengkap, TETAPI tombol aksi hanya aktif bila
     tanggal = hari ini dan waktu sekarang berada di dalam jendela sesi.
     ================================================================= */
  const isoAddDays = (iso, n) => {
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    d.setDate(d.getDate() + Number(n || 0));
    const p2 = v => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  };
  get('/api/absensi-guru/jadwal-mengajar', (req, res, q) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const cfg = dbm.jadwalConfig();
    const jumlahHari = Math.max(1, Math.min(21, Number(q.hari) || 7));
    const lihatSemua = lihatSemuaJadwalAbsensi(user);
    const guruTarget = lihatSemua ? (Number(q.guru) || 0) : Number(user.id);
    const taId = taOf(q);
    const mulai = dbm.today();
    /* SEMUA slot TA (dipakai lintas tanggal) + fallback TA lain seperti endpoint harian */
    let semua = dbm.jadwalRows(taId);
    let taPakai = taId;
    if (!semua.length) {
      for (const id of semuaTaIds()) {
        if (Number(id) === Number(taId)) continue;
        const coba = dbm.jadwalRows(id);
        if (coba.length) { semua = coba; taPakai = Number(id); break; }
      }
    }
    const cfgHari = dbm.jadwalConfig();
    const hasil = [];
    for (let i = 0; i < jumlahHari; i++) {
      const tanggal = isoAddDays(mulai, i);
      const hari = dbm.hariOf(tanggal);
      const tukarHari = dbm.tukarMap(tanggal);
      const absMap = new Map(db.prepare('SELECT * FROM absensi_guru WHERE tanggal=?').all(tanggal)
        .map(a => [Number(a.jadwal_id), a]));
      const jadwalHari = semua.filter(r => Number(r.hari) === hari);
      const slots = jadwalHari.map(r => {
        const group = kelompokJadwal(r, jadwalHari, cfgHari);
        const tukar = tukarHari.get(Number(r.id)) || null;
        const guruEfektif = tukar ? Number(tukar.ke_guru) : Number(r.guru_id) || 0;
        const mapelAktif = mapelEfektif(r, tukar);
        const w = jendelaKelompok(group, tanggal, cfgHari);
        const a = absMap.get(Number(r.id)) || null;
        const groupAbs = group.map(x => absMap.get(Number(x.id))).filter(Boolean);
        const penugasan = group.some(x => {
          const assignment = tukarHari.get(Number(x.id));
          return assignment && String(assignment.jenis || '') === 'penugasan';
        });
        const hariIni = tanggal === dbm.today();
        const kini = dbm.nowMenit();
        const bukaMenit = w.sesi ? dbm.jamMenit(w.sesi.mulai) - cfgHari.bukaMenit : null;
        const tutupMenit = w.sesi ? dbm.jamMenit(w.selesai) + (cfgHari.toleransiTutup || 0) : null;
        /* hitung mundur (detik) untuk ditampilkan klien */
        let countdown = null;
        let alasanSingkat = '';
        if (!hariIni) {
          alasanSingkat = `Hanya dapat diisi pada hari ${dbm.HARI_LABEL[hari] || '-'} (${dbm.tanggalPanjang(tanggal)})`;
        } else if (bukaMenit !== null && kini < bukaMenit) {
          countdown = { arah: 'buka', detik: (bukaMenit - kini) * 60 };
          alasanSingkat = `Belum waktunya — dibuka ${dbm.menitJam(bukaMenit)}`;
        } else if (tutupMenit !== null && kini > tutupMenit) {
          alasanSingkat = 'Sesi sudah berakhir / ditutup';
        } else if (w.aktif) {
          countdown = { arah: 'tutup', detik: Math.max(0, (tutupMenit - kini) * 60) };
          alasanSingkat = 'Sesi berlangsung — siap diisi';
        } else {
          alasanSingkat = w.alasan || '';
        }
        return {
          jadwal_id: Number(r.id), ...mapelAktif,
          mapel_id: mapelAktif.mapel_id || Number(r.mapel_id) || 0,
          mapel_nama: mapelAktif.mapel_nama || r.mapel_nama || '',
          mapel_kode: mapelAktif.mapel_kode || r.mapel_kode || '',
          kelas_nama: r.kelas_nama || '', kelas_ids: r.kelas_ids,
          group_ids: group.map(x => Number(x.id)),
          sesi: Number(r.sesi), jam: w.sesi ? `${w.sesi.mulai}–${w.selesai}` : '',
          group_jam: w.sesi ? `${w.sesi.mulai}–${w.selesai}` : '',
          label_sesi: w.sesi ? `Jam ke-${w.sesi.no}${w.sesi_akhir.no !== w.sesi.no ? `–${w.sesi_akhir.no}` : ''}` : `Sesi ${r.sesi}`,
          guru_id: Number(r.guru_id) || 0, guru_nama: r.guru_nama || '',
          guru_efektif_id: guruEfektif, guru_efektif_nama: tukar ? tukar.ke_nama : (r.guru_nama || ''),
          milik_saya: guruEfektif === Number(user.id),
          tukar: tukar ? {
            id: tukar.id, jenis: tukar.jenis || 'tukar', dari_nama: tukar.dari_nama,
            ke_guru: Number(tukar.ke_guru), ke_nama: tukar.ke_nama
          } : null,
          status_absensi: a ? a.status : (groupAbs[0] ? groupAbs[0].status : ''),
          waktu_checkin: a ? (a.waktu_submit || '') : (groupAbs[0] ? (groupAbs[0].waktu_submit || '') : ''),
          window: {
            aktif: !!w.aktif, alasan: w.alasan || '', buka: w.buka || '', tutup: w.tutup || '',
            hari_ini: hariIni, hari_ok: !!w.hariOk, terkunci: !!w.terkunci
          },
          terkunci: !w.aktif, alasan_singkat: alasanSingkat, countdown,
          bisa_checkin: !!w.aktif && !groupAbs.length && dbm.can(user, 'absensi_guru', 'write')
            && !penugasan
            && group.every(x => {
              const t = tukarHari.get(Number(x.id));
              return (t ? Number(t.ke_guru) : Number(x.guru_id)) === guruEfektif;
            })
            && (guruEfektif === Number(user.id) || isAdmin(user)),
          bisa_tukar: !!w.aktif && !groupAbs.length && !tukar && guruEfektif === Number(user.id),
          bisa_rencana_tukar: !hariIni && tanggalTukarMendatang(tanggal)
            && guruEfektif === Number(user.id) && !tukar && !groupAbs.length,
          bisa_jurnal: !!a && !!w.aktif && dbm.can(user, 'absensi_guru', 'write')
            && (guruEfektif === Number(user.id) || isAdmin(user))
        };
      }).filter(s => !guruTarget || Number(s.guru_efektif_id) === guruTarget);
      if (!slots.length) continue;
      hasil.push({
        tanggal, hari, hari_label: dbm.HARI_LABEL[hari] || '', tanggal_label: dbm.tanggalPanjang(tanggal),
        hari_ini: tanggal === dbm.today(), offset: i, slots
      });
    }
    json(res, 200, {
      ok: true, mulai, sampai: isoAddDays(mulai, jumlahHari - 1), jumlah_hari: jumlahHari, ta: taPakai,
      hari_ini: dbm.today(), sekarang: dbm.menitJam(dbm.nowMenit()),
      saya: { id: user.id, nama: user.nama, role_label: dbm.roleLabelOf(user) },
      lihat_semua: lihatSemua, guru: lihatSemua ? guruList() : [], target_guru: guruTarget,
      hari: hasil,
      total_slot: hasil.reduce((a, h) => a + h.slots.length, 0)
    });
  });

  /* -----------------------------------------------------------------
     CHECK-IN / SAKIT / IZIN (satu klik, cap waktu real-time, terkunci)
     ----------------------------------------------------------------- */
  post('/api/absensi-guru/checkin', async (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const jadwalId = Number(b.jadwal_id) || 0;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(jadwalId);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const cfg = dbm.jadwalConfig();
    const tanggal = String(b.tanggal || dbm.today()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return fail(res, 400, 'Tanggal tidak valid.');
    if (tanggal !== dbm.today()) return fail(res, 403, 'Absensi hanya dapat dilakukan pada hari pelajaran berlangsung (hari ini).');
    if (Number(row.hari) !== dbm.hariOf(tanggal)) {
      return fail(res, 403, `Jadwal ini untuk hari ${dbm.HARI_LABEL[Number(row.hari)] || '-'}, bukan hari ini.`);
    }
    /* TUKAR JADWAL: bila permintaan untuk tanggal ini diterima, pemilik sesi
       adalah guru pengganti (ia yang berhak check-in & mengisi absensi siswa). */
    const tukarIni = dbm.tukarAktif(row.id, tanggal);
    if (tukarIni && String(tukarIni.jenis || '') === 'penugasan') {
      return fail(res, 409, 'Guru pengganti tidak perlu check-in terpisah. Isi absensi siswa; kehadiran akan tercatat otomatis setelah presensi lengkap.');
    }
    const pemilik = tukarIni ? Number(tukarIni.ke_guru) : Number(row.guru_id);
    const atasNama = pemilik !== Number(user.id);
    if (atasNama && !isAdmin(user)) {
      return fail(res, 403, 'Anda hanya dapat melakukan check-in untuk slot jadwal mengajar Anda sendiri.');
    }
    const semua = dbm.jadwalRows(Number(row.ta_id) || taOf(b)).filter(r => Number(r.hari) === Number(row.hari));
    const group = kelompokJadwal(row, semua, cfg);
    const w = jendelaKelompok(group, tanggal, cfg);
    if (!w.aktif) {
      return fail(res, 403, `Tombol absensi hanya aktif selama jam pelajaran berlangsung — ${w.alasan}`, { window: w });
    }
    const ada = db.prepare(`SELECT jadwal_id FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${group.map(() => '?').join(',')})`)
      .all(tanggal, ...group.map(x => Number(x.id)));
    if (ada.length) {
      return fail(res, 409, 'Absensi sesi ini sudah tercatat dan terkunci. Status tidak dapat diubah lagi; Anda hanya dapat melengkapi jurnal & foto.');
    }
    const groupOwners = group.map(x => {
      const t = dbm.tukarAktif(x.id, tanggal);
      return t ? Number(t.ke_guru) : Number(x.guru_id);
    });
    if (groupOwners.some(id => id !== pemilik)) {
      return fail(res, 409, 'Slot dalam rentang ini memiliki guru efektif yang berbeda; lakukan check-in per slot.');
    }
    const status = ['hadir', 'sakit', 'izin'].includes(String(b.status)) ? String(b.status) : 'hadir';
    const catatan = String(b.catatan || '').trim();
    if (status !== 'hadir' && catatan.length < 5) {
      return fail(res, 400, 'Alasan sakit/izin wajib dituliskan (minimal 5 karakter).');
    }
    const waktu = dbm.now();
    const validasi = JSON.stringify({
      sumber: 'checkin', status,
      jendela: { buka: w.buka, tutup: w.tutup, checkin: w.sekarang, sesi: w.sesi ? `${w.sesi.mulai}-${w.selesai}` : '' },
      group_ids: group.map(x => Number(x.id)),
      ua: String(req.headers['user-agent'] || '').slice(0, 180),
      atas_nama_guru: atasNama ? pemilik : null,
      tukar_id: tukarIni ? Number(tukarIni.id) : null, guru_asli: tukarIni ? Number(tukarIni.dari_guru) : null
    });
    let id = 0;
    db.transaction(() => {
      for (const slot of group) {
        const r = db.prepare(`INSERT INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,foto_url,foto_id,waktu_submit,ip,validasi,created_at,updated_at)
          VALUES(?,?,?,?,?,'',?,NULL,NULL,?,?,?,?,?)`)
          .run(Number(slot.id), tanggal, pemilik, Number(slot.ta_id) || taOf(b), status, catatan, waktu, ipOf(req), validasi, dbm.now(), dbm.now());
        if (Number(slot.id) === jadwalId) id = Number(r.lastInsertRowid);
      }
    })();
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    dbm.logAudit(user, 'TAMBAH', 'absensi_guru',
      `Check-in ${status.toUpperCase()} — ${mapel.nama || 'mapel'} ${group.length > 1 ? `sesi ${group[0].sesi}–${group[group.length - 1].sesi}` : `sesi ${row.sesi}`} (${tanggal}) pukul ${waktu}${atasNama ? ' atas nama guru lain' : ''}`, ipOf(req));
    /* NOTIFIKASI KEPALA SEKOLAH / WAKASEK KURIKULUM saat guru Sakit/Izin */
    if (status !== 'hadir') kirimWaIzinGuru(row, tanggal, status, catatan, user).catch(() => { });
    json(res, 200, {
      ok: true, id, status, waktu_submit: waktu, group_ids: group.map(x => Number(x.id)),
      langkah: status === 'hadir' ? ['absensi_siswa', 'jurnal', 'foto'] : [],
      pesan: status === 'hadir'
        ? `Check-in HADIR tercatat pukul ${String(waktu).slice(11, 19)} untuk ${group.length > 1 ? `rentang ${w.sesi.mulai}–${w.selesai}` : `jam ${w.sesi.mulai}–${w.selesai}`} dan terkunci. Langkah berikutnya: isi absensi siswa, lalu jurnal mengajar, lalu foto kegiatan.`
        : `Status ${status.toUpperCase()} tercatat pukul ${String(waktu).slice(11, 19)} dan terkunci.`
    });
  });

  /* status alur kerja (check-in → absensi siswa → jurnal → foto) */
  get('/api/absensi-guru/alur', (req, res, q) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const jadwalId = Number(q.jadwal_id) || 0;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(jadwalId);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    if (hanyaJadwalSendiri(user) && dbm.tukarGuruEfektif(row, tanggal) !== Number(user.id)) {
      return fail(res, 403, 'Anda hanya dapat melihat alur absensi pada jadwal mengajar Anda sendiri.');
    }
    const semua = dbm.jadwalRows(Number(row.ta_id) || taOf(q)).filter(r => Number(r.hari) === Number(row.hari));
    const group = kelompokJadwal(row, semua, dbm.jadwalConfig());
    const alur = alurKelompok(group, tanggal);
    const sesi = alur.absensi_siswa.sesi_id
      ? db.prepare('SELECT token FROM absensi_sesi WHERE id=?').get(alur.absensi_siswa.sesi_id) : null;
    json(res, 200, {
      ok: true, tanggal, jadwal_id: jadwalId, group_ids: group.map(x => Number(x.id)), alur,
      sesi_token: sesi ? sesi.token : '',
      mapel: dbm.mapelList().find(m => Number(m.id) === Number(row.mapel_id)) || null
    });
  });

  /* simpan jurnal mengajar + foto bukti setelah check-in (status tidak berubah) */
  post('/api/absensi-guru/jurnal', async (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const b = await readBody(req);
    const jadwalId = Number(b.jadwal_id) || 0;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(jadwalId);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
    const semua = dbm.jadwalRows(Number(row.ta_id) || taOf(b)).filter(r => Number(r.hari) === Number(row.hari));
    const group = kelompokJadwal(row, semua, dbm.jadwalConfig());
    const absMap = new Map(db.prepare(`SELECT * FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${group.map(() => '?').join(',')})`)
      .all(tanggal, ...group.map(x => Number(x.id))).map(a => [Number(a.jadwal_id), a]));
    const absList = group.map(x => absMap.get(Number(x.id))).filter(Boolean);
    if (absList.length !== group.length) return fail(res, 400, 'Lakukan Check-in / Sakit / Izin terlebih dahulu sebelum mengisi jurnal mengajar.');
    const ada = absMap.get(jadwalId);
    if (!ada) return fail(res, 400, 'Check-in slot ini belum tercatat.');
    const tukarIni = dbm.tukarAktif(row.id, tanggal);
    const pemilik = tukarIni ? Number(tukarIni.ke_guru) : Number(row.guru_id);
    const jurnalPenugasan = tukarIni && String(tukarIni.jenis || '') === 'penugasan'
      && Number(tukarIni.ke_guru) === Number(user.id)
      && dbm.can(user, 'guru_pengganti', 'write');
    if (!dbm.can(user, 'absensi_guru', 'write') && !jurnalPenugasan) {
      return fail(res, 403, 'Anda tidak memiliki izin jurnal mengajar untuk sesi ini.');
    }
    if (pemilik !== Number(user.id) && !isAdmin(user)) {
      return fail(res, 403, 'Anda hanya dapat mengisi jurnal pada slot jadwal Anda sendiri.');
    }
    const cfg = dbm.jadwalConfig();
    const w = jendelaKelompok(group, tanggal, cfg);
    /* TIME-LOCKING: setelah jam pelajaran berakhir jurnal TERKUNCI untuk siapa pun. */
    if (!w.aktif) {
      return fail(res, 403, `Sesi sudah DITUTUP — jurnal mengajar tidak dapat diubah lagi. ${w.alasan}`, { terkunci: true });
    }
    const materi = String(b.materi || '').trim();
    const catatan = String(b.catatan || '').trim();
    /* URUTAN WAJIB: absensi siswa harus selesai sebelum jurnal disimpan
       (kecuali status izin/sakit). */
    if (absList.some(a => a.status === 'hadir')) {
      const alurList = group.map(x => dbm.absensiAlur(x.id, tanggal));
      const belumLengkap = alurList.find(a => !a.absensi_siswa.lengkap);
      if (belumLengkap) {
        return fail(res, 400, belumLengkap.absensi_siswa.total
          ? `Absensi siswa belum lengkap (${belumLengkap.absensi_siswa.terisi}/${belumLengkap.absensi_siswa.total} siswa pada salah satu jam). Selesaikan presensi seluruh jam terlebih dahulu, baru isi jurnal mengajar.`
          : 'Absensi siswa belum dibuat untuk seluruh jam pada rentang ini. Buka menu Absensi Siswa per Mapel dan lengkapi presensi kelas terlebih dahulu.',
        { butuh_absensi_siswa: true, alur: alurList });
      }
    }
    const b64 = String(b.foto || '');
    let fotoBuf = null;
    if (b64 && (/^data:[^,]*,/.test(b64) || b64.length > 200)) {
      fotoBuf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
      if (fotoBuf.length) {
        const maxKb = Math.max(64, Number(dbm.getSetting('upload_max_kb', 2048)) || 2048);
        if (fotoBuf.length > maxKb * 1024) return fail(res, 400, `Ukuran foto melebihi batas ${maxKb} KB.`);
      }
    }
    const fotoPerSlot = [];
    for (const slot of group) {
      const absSlot = absMap.get(Number(slot.id));
      let fotoUrl = absSlot.foto_url || '';
      let fotoId = absSlot.foto_id || null;
      if (fotoBuf && fotoBuf.length) {
        const up = await uploadBuffer({
          buf: fotoBuf, filename: String(b.foto_nama || 'bukti-absensi.webp'), jenis: 'absensi',
          refTabel: 'absensi_guru', refId: absSlot.id, user
        });
        if (!up.ok) return fail(res, 400, up.error || 'Gagal mengunggah bukti foto.');
        fotoUrl = up.url; fotoId = up.id;
      }
      fotoPerSlot.push({ abs: absSlot, fotoUrl, fotoId });
    }
    db.transaction(() => {
      for (const x of fotoPerSlot) {
        db.prepare('UPDATE absensi_guru SET materi=?,catatan=?,foto_url=?,foto_id=?,updated_at=? WHERE id=?')
          .run(materi, catatan || x.abs.catatan || '', x.fotoUrl, x.fotoId, dbm.now(), x.abs.id);
      }
    })();
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    dbm.logAudit(user, 'UBAH', 'absensi_guru', `Jurnal mengajar ${mapel.nama || 'mapel'} ${group.length > 1 ? `sesi ${group[0].sesi}–${group[group.length - 1].sesi}` : `sesi ${row.sesi}`} (${tanggal})`, ipOf(req));
    json(res, 200, { ok: true, id: ada.id, group_ids: group.map(x => Number(x.id)), foto_url: fotoPerSlot[0].fotoUrl, pesan: 'Jurnal mengajar & bukti tersimpan.' });
  });

  post('/api/absensi-guru/submit', async (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const jadwalId = Number(b.jadwal_id) || 0;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(jadwalId);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const cfg = dbm.jadwalConfig();
    const tanggal = String(b.tanggal || dbm.today()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return fail(res, 400, 'Tanggal tidak valid.');
    /* 1) hanya untuk HARI INI */
    if (tanggal !== dbm.today()) {
      return fail(res, 403, 'Absensi hanya dapat dilakukan pada hari pelajaran berlangsung (hari ini).');
    }
    /* 2) hari pada jadwal harus cocok */
    if (Number(row.hari) !== dbm.hariOf(tanggal)) {
      return fail(res, 403, `Jadwal ini untuk hari ${dbm.HARI_LABEL[Number(row.hari)] || '-'}, bukan hari ini.`);
    }
    /* 3) kepemilikan slot — guru hanya boleh mengabsen slot miliknya
       (slot hasil TUKAR JADWAL menjadi milik guru pengganti pada tanggal itu) */
    const tukarIni = dbm.tukarAktif(row.id, tanggal);
    const pemilik = tukarIni ? Number(tukarIni.ke_guru) : Number(row.guru_id);
    const atasNama = pemilik !== Number(user.id);
    if (atasNama && !isAdmin(user)) {
      return fail(res, 403, 'Anda hanya dapat mengisi absensi untuk slot jadwal mengajar Anda sendiri.');
    }
    /* 4) jendela waktu */
    const w = dbm.absensiWindow(row, tanggal, cfg);
    if (!w.aktif) return fail(res, 403, `Di luar jendela absensi — ${w.alasan}`, { window: w });
    /* 5) sudah ada? hanya boleh diubah selama jendela masih terbuka */
    const ada = db.prepare('SELECT * FROM absensi_guru WHERE jadwal_id=? AND tanggal=?').get(jadwalId, tanggal);
    /* 6) status & jurnal materi */
    const status = ['hadir', 'izin', 'sakit', 'alpha'].includes(String(b.status)) ? String(b.status) : 'hadir';
    /* STATUS TERKUNCI: baris hasil check-in / alfa otomatis tidak boleh diubah statusnya,
       kecuali oleh admin/wakasek kurikulum (koreksi resmi). Jurnal & foto tetap boleh. */
    if (ada) {
      const viaCheckin = /"sumber"\s*:\s*"checkin"/.test(String(ada.validasi || ''));
      const autoAlfa = /"auto"\s*:\s*true/.test(String(ada.validasi || ''));
      if ((viaCheckin || autoAlfa) && status !== ada.status && !isAdmin(user)) {
        return fail(res, 409, `Status absensi sesi ini sudah terkunci sebagai ${String(ada.status).toUpperCase()}. Anda hanya dapat melengkapi jurnal & foto bukti.`);
      }
    }
    const materi = String(b.materi || '').trim();
    const catatan = String(b.catatan || '').trim();
    if (tukarIni && String(tukarIni.jenis || '') === 'penugasan') {
      return fail(res, 403, 'Penugasan guru pengganti tidak memakai check-in manual. Kehadiran dicatat otomatis setelah absensi siswa lengkap.');
    }
    if (status === 'hadir') {
      if (materi.length < cfg.jurnalMin) {
        return fail(res, 400, `Ringkasan materi/jurnal mengajar wajib diisi minimal ${cfg.jurnalMin} karakter.`);
      }
    } else if (catatan.length < 5) {
      return fail(res, 400, 'Alasan izin/sakit/alpha wajib dituliskan (minimal 5 karakter).');
    }
    /* 7) bukti foto */
    let fotoUrl = ada ? (ada.foto_url || '') : '';
    let fotoId = ada ? (ada.foto_id || null) : null;
    const b64 = String(b.foto || '');
    if (b64 && /^data:[^,]*,/.test(b64) || (b64 && b64.length > 200)) {
      const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
      if (buf.length) {
        const maxKb = Math.max(64, Number(dbm.getSetting('upload_max_kb', 2048)) || 2048);
        if (buf.length > maxKb * 1024) return fail(res, 400, `Ukuran foto melebihi batas ${maxKb} KB.`);
        const up = await uploadBuffer({
          buf, filename: String(b.foto_nama || 'bukti-absensi.webp'), jenis: 'absensi',
          refTabel: 'absensi_guru', refId: ada ? ada.id : 0, user
        });
        if (!up.ok) return fail(res, 400, up.error || 'Gagal mengunggah bukti foto.');
        fotoUrl = up.url; fotoId = up.id;
      }
    }
    if (cfg.fotoWajib && !fotoUrl) {
      return fail(res, 400, 'Bukti foto aktivitas kelas wajib diunggah untuk absensi ini.');
    }
    const validasi = JSON.stringify({
      jendela: { buka: w.buka, tutup: w.tutup, submit: w.sekarang, sesi: w.sesi && `${w.sesi.mulai}-${w.sesi.selesai}` },
      ua: String(req.headers['user-agent'] || '').slice(0, 180),
      atas_nama_guru: atasNama ? pemilik : null
    });
    let id = ada ? ada.id : 0;
    db.transaction(() => {
      if (ada) {
        db.prepare(`UPDATE absensi_guru SET status=?,materi=?,catatan=?,foto_url=?,foto_id=?,waktu_submit=?,ip=?,validasi=?,updated_at=? WHERE id=?`)
          .run(status, materi, catatan, fotoUrl, fotoId, dbm.now(), ipOf(req), validasi, dbm.now(), ada.id);
      } else {
        const r = db.prepare(`INSERT INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,foto_url,foto_id,waktu_submit,ip,validasi,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(jadwalId, tanggal, pemilik, Number(row.ta_id) || taOf(b), status, materi, catatan, fotoUrl, fotoId,
            dbm.now(), ipOf(req), validasi, dbm.now(), dbm.now());
        id = Number(r.lastInsertRowid);
        if (fotoId) db.prepare('UPDATE uploads SET ref_id=? WHERE id=?').run(id, fotoId);
      }
    })();
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    dbm.logAudit(user, ada ? 'UBAH' : 'TAMBAH', 'absensi_guru',
      `Absensi ${status} — ${mapel.nama || 'mapel'} sesi ${row.sesi} (${tanggal})${atasNama ? ' atas nama guru lain' : ''}`, ipOf(req));
    json(res, 200, {
      ok: true, id, status, foto_url: fotoUrl,
      pesan: ada ? 'Absensi diperbarui.' : 'Absensi tersimpan.'
    });
  });

  get('/api/absensi-guru/rekap', (req, res, q) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const taId = taOf(q);
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    let auto = { dibuat: 0 };
    try { auto = dbm.autoAlfaGuru(tanggal); } catch (e) { /* abaikan */ }
    const rekap = rekapAbsensiUntuk(dbm.absensiGuruRekap(tanggal, taId), user);
    const semuaCatatan = db.prepare(`SELECT a.*, m.nama AS mapel_nama, u.nama AS guru_nama, j.sesi, j.kelas_ids
      FROM absensi_guru a LEFT JOIN jadwal j ON j.id=a.jadwal_id LEFT JOIN mapel m ON m.id=j.mapel_id
      LEFT JOIN users u ON u.id=a.guru_id WHERE a.tanggal=? AND a.ta_id=? ORDER BY u.nama, j.sesi`).all(tanggal, taId);
    const catatan = lihatSemuaJadwalAbsensi(user)
      ? semuaCatatan : semuaCatatan.filter(c => Number(c.guru_id) === Number(user.id));
    const kelasMap = new Map(kelasPicker().map(k => [Number(k.id), k.nama]));
    json(res, 200, {
      ok: true, rekap, auto_alpha: auto.dibuat || 0,
      catatan: catatan.map(c => ({ ...c, kelas_nama: dbm.jadwalKelasIds({ kelas_ids: c.kelas_ids }).map(id => kelasMap.get(id)).filter(Boolean).join(', ') })),
      status_list: dbm.ABSENSI_GURU_STATUS
    });
  });

  function kirimRekapWa(req, user, tanggal, opts) {
    const cfg = dbm.jadwalConfig();
    const tgl = tanggal || dbm.today();
    const rekap = dbm.absensiGuruRekap(tgl, taOf(opts || {}));
    const pesan = dbm.absensiWaText(rekap);
    const nomor = [...new Set([cfg.kepsekWa, cfg.wakasekWa].filter(Boolean))];
    if (!nomor.length) return { ok: false, error: 'Nomor WhatsApp Kepala Sekolah & Wakasek Kurikulum belum diisi (Pengaturan → Identitas / WhatsApp).', rekap, pesan, terkirim: [] };
    return { rekap, pesan, nomor, kirim: async () => {
      const hasil = [];
      for (const n of nomor) {
        const r = await dbm.waSend(n, pesan);
        hasil.push({ phone: n, status: r.status, error: r.error || '' });
        db.prepare(`INSERT INTO wa_log(siswa_id,nama,phone,jenis,pesan,oleh,oleh_nama,created_at,status,sumber,error,ta_id)
          VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?)`)
          .run('Rekap Absensi Guru', n, 'rekap-absensi-guru', pesan, user ? user.id : null,
            user ? user.nama : 'Sistem', dbm.now(), r.status, r.status === 'terkirim' ? 'gateway' : 'manual', r.error || '', taOf(opts || {}));
      }
      dbm.setSetting('absensi_wa_terakhir', tgl);
      return hasil;
    } };
  }

  get('/api/absensi-guru/rekap-wa/preview', (req, res, q) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    const rekap = dbm.absensiGuruRekap(tgl, taOf(q));
    const cfg = dbm.jadwalConfig();
    json(res, 200, {
      ok: true, tanggal: tgl, rekap, pesan: dbm.absensiWaText(rekap),
      nomor: { kepsek: cfg.kepsekWa, wakasek: cfg.wakasekWa },
      gateway_aktif: !!(dbm.waConfig().aktif && dbm.waConfig().url)
    });
  });

  post('/api/absensi-guru/rekap-wa', async (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
    const plan = kirimRekapWa(req, user, tgl, b);
    if (plan.error) return fail(res, 400, plan.error);
    const hasil = await plan.kirim();
    dbm.logAudit(user, 'WA', 'absensi_guru', `Kirim rekap absensi guru ${tgl} ke ${plan.nomor.length} nomor`, ipOf(req));
    json(res, 200, {
      ok: true, hasil, pesan: plan.pesan, nomor: plan.nomor, rekap: plan.rekap,
      tautan: plan.nomor.map(n => ({ phone: n, url: `https://wa.me/${n}?text=${encodeURIComponent(plan.pesan)}` }))
    });
  });

  /* =================================================================
     6b. TUKAR JADWAL MENGAJAR ANTAR GURU (pasangan slot, pekan berjalan)
     -----------------------------------------------------------------
     Alur: guru pemilik sesi mengajukan → guru tujuan menerima/menolak.
     Bila DITERIMA, guru tujuan menjadi guru EFEKTIF slot tersebut pada
     tanggal itu (check-in & absensi siswa pindah ke akunnya), sedangkan
     jadwal pekan berikutnya tidak berubah (tabel `jadwal` tidak disentuh).
     ================================================================= */
  const TUKAR_TGL = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : dbm.today());
  const mingguTukar = (tanggal) => {
    const d = new Date(`${String(tanggal).slice(0, 10)}T00:00:00Z`);
    const offset = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - offset);
    const awal = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    return { awal, akhir: d.toISOString().slice(0, 10) };
  };
  const tanggalTukarMendatang = (tanggal) => {
    const m = mingguTukar(dbm.today());
    return String(tanggal) > dbm.today() && String(tanggal) <= m.akhir;
  };
  const tanggalTukarMingguIni = (tanggal) => {
    const m = mingguTukar(dbm.today());
    return String(tanggal) >= dbm.today() && String(tanggal) <= m.akhir;
  };

  /** guru pemilik sesi pada tanggal tertentu (mempertimbangkan tukar diterima) */
  const guruPemilik = (row, tanggal) => {
    const t = dbm.tukarAktif(row.id, tanggal);
    return t ? Number(t.ke_guru) : Number(row.guru_id) || 0;
  };

  const kelasKey = row => (Array.isArray(row.kelas_ids)
    ? row.kelas_ids.map(Number).filter(Boolean)
    : dbm.jadwalKelasIds(row)).sort((a, b) => a - b).join(',');
  const sesiIds = group => new Set(group.map(x => Number(x.sesi)));

  /** Cari pasangan mapel guru tujuan pada kelas dan hari yang sama. */
  function kandidatTukar(row, tanggal) {
    const hari = Number(row.hari);
    const pemilik = guruPemilik(row, tanggal);
    const taId = Number(row.ta_id) || taOf({});
    const cfgTukar = dbm.jadwalConfig();
    const semua = dbm.jadwalRows(taId).filter(r => Number(r.hari) === hari);
    const groupAsal = dbm.absensiKelompok(row, semua, cfgTukar);
    const asalIds = new Set(groupAsal.map(x => Number(x.id)));
    const asalJam = sesiIds(groupAsal);
    const keyKelas = kelasKey(row);
    const guruIds = [...new Set(semua.filter(r => Number(r.guru_id) !== pemilik && kelasKey(r) === keyKelas)
      .map(r => Number(r.guru_id)).filter(Boolean))];
    return guruIds.map(guruId => {
      const jadwalTujuan = semua.filter(r => Number(r.guru_id) === guruId && kelasKey(r) === keyKelas);
      const grupSeen = new Set();
      const groups = [];
      for (const slot of jadwalTujuan) {
        const group = dbm.absensiKelompok(slot, semua, cfgTukar);
        const ids = group.map(x => Number(x.id));
        const key = ids.slice().sort((a, b) => a - b).join(',');
        if (grupSeen.has(key) || ids.some(id => asalIds.has(id)) || group.length !== groupAsal.length) continue;
        const ph = ids.map(() => '?').join(',');
        if (db.prepare(`SELECT 1 FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${ph}) LIMIT 1`)
          .get(tanggal, ...ids)
          || db.prepare(`SELECT 1 FROM absensi_sesi WHERE tanggal=? AND jadwal_id IN (${ph}) LIMIT 1`)
            .get(tanggal, ...ids)) continue;
        const window = jendelaKelompok(group, tanggal, cfgTukar);
        const mulai = dbm.jamMenit(window.sesi && window.sesi.mulai);
        if (!window.sesi || window.nonaktif || !window.hariOk
          || (tanggal === dbm.today() && (mulai === null || dbm.nowMenit() >= mulai))) continue;
        grupSeen.add(key);
        const jam = sesiIds(group);
        const bentrokAsal = semua.find(x => Number(x.guru_id) === pemilik && asalJam.has(Number(x.sesi)) === false
          && jam.has(Number(x.sesi)) && !asalIds.has(Number(x.id)));
        const bentrokTujuan = semua.find(x => Number(x.guru_id) === guruId && asalJam.has(Number(x.sesi))
          && !ids.includes(Number(x.id)));
        if (bentrokAsal || bentrokTujuan) continue;
        const pertama = group[0], terakhir = group[group.length - 1];
        const sesiHari = dbm.sesiOfHari(dbm.jadwalConfig(), hari);
        const awal = sesiHari.find(x => Number(x.idx) === Number(pertama.sesi));
        const akhir = sesiHari.find(x => Number(x.idx) === Number(terakhir.sesi));
        groups.push({
          id: Number(pertama.mapel_id) || 0, nama: pertama.mapel_nama || '', kode: pertama.mapel_kode || '',
          jadwal_id: Number(pertama.id), group_ids: ids, sesi: Number(pertama.sesi),
          jam: awal && akhir ? `${awal.mulai}–${akhir.selesai}` : '',
          _distance: Math.abs(Number(pertama.sesi) - Number(row.sesi))
        });
      }
      const byMapel = new Map();
      groups.sort((a, b) => a._distance - b._distance || a.sesi - b.sesi);
      for (const m of groups) if (!byMapel.has(m.id)) byMapel.set(m.id, m);
      const mapel = [...byMapel.values()].map(({ _distance, ...m }) => m);
      return {
        id: guruId,
        nama: (db.prepare('SELECT nama FROM users WHERE id=?').get(guruId) || {}).nama || ('Guru #' + guruId),
        nip: (db.prepare('SELECT nip FROM users WHERE id=?').get(guruId) || {}).nip || '',
        mapel, bentrok: !mapel.length,
        bentrok_info: mapel.length ? '' : 'tidak ada slot mapel pasangan yang dapat ditukar'
      };
    }).filter(k => k && k.mapel.length)
      .sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
  }

  /** Pasangan lintas hari: tanggal tujuan harus lebih akhir dalam minggu berjalan, kelas dan durasi sama. */
  function kandidatLintasTukar(row, tanggal) {
    if (!tanggalTukarMingguIni(tanggal)) return [];
    const taId = Number(row.ta_id) || taOf({});
    const keyKelas = kelasKey(row);
    const semua = dbm.jadwalRows(taId);
    const groupAsal = dbm.absensiKelompok(row, semua.filter(x => Number(x.hari) === Number(row.hari)), dbm.jadwalConfig());
    const asalIds = new Set(groupAsal.map(x => Number(x.id)));
    const pemilik = guruPemilik(row, tanggal);
    const hasil = new Map();
    const minggu = mingguTukar(tanggal);
    const awal = new Date(`${minggu.awal}T00:00:00Z`);
    const akhir = new Date(`${minggu.akhir}T00:00:00Z`);
    for (let d = new Date(awal); d <= akhir; d.setUTCDate(d.getUTCDate() + 1)) {
      const tanggalTarget = d.toISOString().slice(0, 10);
      const hariTarget = d.getUTCDay();
      if (tanggalTarget <= tanggal || tanggalTarget > minggu.akhir) continue;
      const slotsTarget = semua.filter(x => Number(x.hari) === hariTarget);
      const guruIds = [...new Set(slotsTarget.filter(x => Number(x.guru_id) !== pemilik && kelasKey(x) === keyKelas)
        .map(x => Number(x.guru_id)).filter(Boolean))];
      for (const guruId of guruIds) {
        const groupSeen = new Set();
        const slotsGuru = slotsTarget.filter(x => Number(x.guru_id) === guruId && kelasKey(x) === keyKelas);
        for (const target of slotsGuru) {
          const groupTujuan = dbm.absensiKelompok(target, slotsTarget, dbm.jadwalConfig());
          const ids = groupTujuan.map(x => Number(x.id));
          const groupKey = ids.slice().sort((a, b) => a - b).join(',');
          if (groupSeen.has(groupKey) || ids.length !== groupAsal.length) continue;
          groupSeen.add(groupKey);
          const ph = ids.map(() => '?').join(',');
          if (db.prepare(`SELECT 1 FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${ph}) LIMIT 1`)
            .get(tanggalTarget, ...ids)
            || db.prepare(`SELECT 1 FROM absensi_sesi WHERE tanggal=? AND jadwal_id IN (${ph}) LIMIT 1`)
              .get(tanggalTarget, ...ids)) continue;
          const sourceSessions = new Set(groupAsal.map(x => Number(x.sesi)));
          const targetSessions = new Set(groupTujuan.map(x => Number(x.sesi)));
          const bentrokTujuan = semua.some(x => Number(x.hari) === Number(row.hari)
            && Number(x.guru_id) === guruId && sourceSessions.has(Number(x.sesi))
            && !asalIds.has(Number(x.id)));
          const bentrokAsal = slotsTarget.some(x => Number(x.guru_id) === pemilik
            && targetSessions.has(Number(x.sesi)) && !ids.includes(Number(x.id)));
          if (bentrokTujuan || bentrokAsal) continue;
          const mapel = groupTujuan[0];
          const sesiHari = dbm.sesiOfHari(dbm.jadwalConfig(), hariTarget);
          const pertama = sesiHari.find(x => Number(x.idx) === Number(groupTujuan[0].sesi));
          const terakhir = sesiHari.find(x => Number(x.idx) === Number(groupTujuan[groupTujuan.length - 1].sesi));
          const slot = {
            id: Number(mapel.mapel_id) || 0, nama: mapel.mapel_nama || '', kode: mapel.mapel_kode || '',
            jadwal_id: Number(mapel.id), group_ids: ids, sesi: Number(mapel.sesi), tanggal: tanggalTarget,
            jam: pertama && terakhir ? `${pertama.mulai}–${terakhir.selesai}` : ''
          };
          if (!hasil.has(guruId)) hasil.set(guruId, { id: guruId, nama: '', nip: '', mapel: [] });
          const entry = hasil.get(guruId);
          entry.mapel.push(slot);
        }
      }
    }
    return [...hasil.values()].map(k => {
      const user = db.prepare('SELECT nama,nip FROM users WHERE id=?').get(k.id) || {};
      k.nama = user.nama || `Guru #${k.id}`;
      k.nip = user.nip || '';
      k.mapel.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.sesi - b.sesi);
      k.bentrok = !k.mapel.length;
      return k;
    }).filter(k => k.mapel.length).sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
  }

  /** validasi bersama untuk pengajuan tukar jadwal */
  function siapkanTukar(user, body) {
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(body.jadwal_id) || 0);
    if (!row) return { error: 'Slot jadwal tidak ditemukan.', status: 404 };
    const tanggal = TUKAR_TGL(body.tanggal);
    const alasanJenis = String(body.alasan_jenis || 'lainnya').toLowerCase();
    if (!['lainnya', 'izin', 'sakit'].includes(alasanJenis)) {
      return { error: 'Pilih alasan tukar yang valid.', status: 400 };
    }
    const pemilik = guruPemilik(row, tanggal);
    if (pemilik !== Number(user.id)) {
      return { error: 'Hanya guru pemilik sesi ini yang dapat mengajukan tukar jadwal.', status: 403 };
    }
    if (alasanJenis === 'lainnya' && !tanggalTukarMingguIni(tanggal)) {
      return { error: 'Tukar pada tanggal yang sama hanya dapat diajukan untuk hari ini atau hari mendatang dalam minggu ini.', status: 403 };
    }
    if (alasanJenis !== 'lainnya' && !tanggalTukarMingguIni(tanggal)) {
      return { error: 'Tukar karena sakit/izin hanya dapat diajukan untuk hari ini atau hari mendatang dalam minggu berjalan.', status: 403 };
    }
    if (Number(row.hari) !== dbm.hariOf(tanggal)) {
      return { error: `Slot ini untuk hari ${dbm.HARI_LABEL[Number(row.hari)] || '-'}, bukan hari ini.`, status: 403 };
    }
    const sudah = db.prepare("SELECT * FROM jadwal_tukar WHERE jadwal_id=? AND tanggal=? AND status IN ('pending','diterima') ORDER BY id DESC LIMIT 1")
      .get(Number(row.id), tanggal);
    if (sudah) {
      return {
        error: sudah.status === 'diterima'
          ? `Sesi ini sudah ditukar ke ${db.prepare('SELECT nama FROM users WHERE id=?').get(Number(sudah.ke_guru))?.nama || 'guru lain'} untuk tanggal ${tanggal}.`
          : 'Masih ada permintaan tukar jadwal yang menunggu jawaban untuk sesi ini.',
        status: 409, sudah
      };
    }
    const absensi = db.prepare('SELECT id FROM absensi_guru WHERE jadwal_id=? AND tanggal=?').get(Number(row.id), tanggal);
    if (absensi) return { error: 'Absensi sesi ini sudah tercatat — tukar jadwal tidak dapat diajukan lagi.', status: 409 };
    if (alasanJenis === 'lainnya') {
      /* Pertukaran hari yang sama ditutup begitu jam pelajaran berakhir. */
      const wTukar = dbm.absensiWindow(row, tanggal, dbm.jadwalConfig());
      if (!wTukar.sesi || dbm.nowMenit() > dbm.jamMenit(wTukar.tutup)) {
        return {
          error: `Sesi ini sudah berakhir (${wTukar.sesi ? wTukar.sesi.mulai + '–' + wTukar.sesi.selesai : '-'}) — tukar jadwal tidak dapat diajukan lagi untuk sesi yang sudah lewat.`,
          status: 403, terkunci: true
        };
      }
    }
    return { row, tanggal, pemilik, alasanJenis };
  }

  /* daftar kandidat guru pengganti + mata pelajaran tujuan */
  get('/api/tukar-jadwal/kandidat', (req, res, q) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(q.jadwal_id) || 0);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const tanggal = TUKAR_TGL(q.tanggal);
    const pemilik = guruPemilik(row, tanggal);
    if (pemilik !== Number(user.id) && !isKurikulum(user)) {
      return fail(res, 403, 'Anda bukan guru pemilik sesi ini.');
    }
    const mapelSlot = db.prepare('SELECT id,nama,kode FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    const kelas = (() => {
      const ids = dbm.jadwalKelasIds(row);
      if (!ids.length) return [];
      return db.prepare(`SELECT id,nama FROM kelas WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    })();
    const w = dbm.absensiWindow(row, tanggal, dbm.jadwalConfig());
    const alasanJenis = String(q.alasan_jenis || 'lainnya').toLowerCase();
    const kandidat = alasanJenis === 'lainnya'
      ? kandidatTukar(row, tanggal)
      : (['izin', 'sakit'].includes(alasanJenis) ? kandidatLintasTukar(row, tanggal) : []);
    json(res, 200, {
      ok: true, tanggal, hari: Number(row.hari),
      alasan_jenis: alasanJenis,
      slot: {
        jadwal_id: Number(row.id), mapel_id: Number(row.mapel_id) || 0, mapel_nama: mapelSlot.nama || '',
        mapel_kode: mapelSlot.kode || '', sesi: Number(row.sesi),
        jam: w.sesi ? `${w.sesi.mulai}–${w.sesi.selesai}` : '', kelas,
        kelas_nama: kelas.map(k => k.nama).join(', '),
        guru_id: pemilik,
        guru_nama: (db.prepare('SELECT nama FROM users WHERE id=?').get(pemilik) || {}).nama || ''
      },
      kandidat,
      riwayat: dbm.tukarOf(row.id, tanggal)
    });
  });

  /* ajukan permintaan tukar jadwal */
  post('/api/tukar-jadwal', async (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const siap = siapkanTukar(user, b);
    if (siap.error) return fail(res, siap.status || 400, siap.error);
    const { row, tanggal, pemilik, alasanJenis } = siap;
    const keId = Number(b.ke_guru) || 0;
    if (!keId) return fail(res, 400, 'Pilih guru tujuan terlebih dahulu.');
    if (keId === pemilik) return fail(res, 400, 'Guru tujuan tidak boleh diri sendiri.');
    const ke = db.prepare('SELECT id,nama,nip,aktif FROM users WHERE id=?').get(keId);
    if (!ke || Number(ke.aktif) !== 1) return fail(res, 404, 'Guru tujuan tidak ditemukan / tidak aktif.');
    const kandidat = (alasanJenis === 'lainnya'
      ? kandidatTukar(row, tanggal)
      : kandidatLintasTukar(row, tanggal)).find(k => Number(k.id) === keId);
    if (!kandidat) {
      const kelas = db.prepare(`SELECT nama FROM kelas WHERE id IN (${dbm.jadwalKelasIds(row).map(() => '?').join(',') || 'NULL'})`)
        .all(...dbm.jadwalKelasIds(row)).map(k => k.nama).join(', ');
      return fail(res, 409, `${ke.nama} tidak memiliki slot mapel pasangan pada kelas ${kelas || 'ini'} di pekan ini.`);
    }
    const targetJadwalId = Number(b.pasangan_jadwal_id) || 0;
    const targetTanggal = TUKAR_TGL(b.pasangan_tanggal || tanggal);
    const mapelTujuan = alasanJenis === 'lainnya'
      ? (kandidat.mapel.find(m => Number(m.id) === (Number(b.mapel_id) || 0)) || kandidat.mapel[0])
      : kandidat.mapel.find(m => Number(m.jadwal_id) === targetJadwalId && m.tanggal === targetTanggal);
    if (!mapelTujuan) return fail(res, 409, `${ke.nama} tidak memiliki slot mapel yang dapat dipasangkan pekan ini.`);
    const allTa = dbm.jadwalRows(Number(row.ta_id) || taOf({}));
    const semua = allTa.filter(r => Number(r.hari) === Number(row.hari));
    const groupAsal = dbm.absensiKelompok(row, semua, dbm.jadwalConfig());
    const rowsTujuan = allTa.filter(r => Number(r.hari) === dbm.hariOf(targetTanggal));
    const rowTujuan = rowsTujuan.find(r => Number(r.id) === Number(mapelTujuan.jadwal_id));
    if (!rowTujuan) return fail(res, 409, 'Slot mapel tujuan tidak lagi tersedia.');
    const groupTujuan = dbm.absensiKelompok(rowTujuan, rowsTujuan, dbm.jadwalConfig());
    if (groupAsal.length !== groupTujuan.length || kelasKey(row) !== kelasKey(rowTujuan)) {
      return fail(res, 409, 'Slot pasangan harus memiliki kelas dan jumlah jam mapel yang sama.');
    }
    if (alasanJenis === 'lainnya' && targetTanggal !== tanggal) {
      return fail(res, 400, 'Tukar pada hari yang sama hanya dapat memasangkan sesi pada tanggal yang sama.');
    }
    if (alasanJenis !== 'lainnya'
      && (targetTanggal <= tanggal || !tanggalTukarMendatang(targetTanggal) || !tanggalTukarMingguIni(tanggal))) {
      return fail(res, 403, 'Tukar sakit/izin hanya dapat menggeser jadwal sumber ke tanggal yang lebih akhir dalam minggu berjalan.');
    }
    const sourceIds = groupAsal.map(x => Number(x.id));
    const targetIds = groupTujuan.map(x => Number(x.id));
    const slotDates = [
      ...sourceIds.map(id => ({ id, tanggal })),
      ...targetIds.map(id => ({ id, tanggal: targetTanggal }))
    ];
    const existing = slotDates.some(s => db.prepare(`SELECT 1 FROM jadwal_tukar
      WHERE tanggal=? AND jadwal_id=? AND status IN ('pending','diterima') LIMIT 1`).get(s.tanggal, s.id));
    if (existing) return fail(res, 409, 'Salah satu slot sudah memiliki permintaan atau pertukaran aktif.');
    for (const slot of slotDates) {
      if (db.prepare('SELECT 1 FROM absensi_guru WHERE tanggal=? AND jadwal_id=?').get(slot.tanggal, slot.id)) {
        return fail(res, 409, 'Salah satu slot sudah diabsen dan tidak dapat ditukar.');
      }
      if (db.prepare('SELECT 1 FROM absensi_sesi WHERE tanggal=? AND jadwal_id=?').get(slot.tanggal, slot.id)) {
        return fail(res, 409, 'Salah satu slot sudah memiliki sesi presensi yang dibuka dan tidak dapat ditukar.');
      }
    }
    const cfgTukar = dbm.jadwalConfig();
    for (const [group, groupTanggal, isTujuan] of [
      [groupAsal, tanggal, false], [groupTujuan, targetTanggal, true]
    ]) {
      const w = jendelaKelompok(group, groupTanggal, cfgTukar);
      if (!w.sesi || w.nonaktif || !w.hariOk
        || (groupTanggal === dbm.today() && dbm.nowMenit() > dbm.jamMenit(w.tutup))) {
        return fail(res, 403, 'Kedua slot harus memiliki jam pelajaran yang berlaku dan belum terlewat.');
      }
      const mulai = dbm.jamMenit(w.sesi.mulai);
      if (alasanJenis === 'lainnya' && isTujuan && groupTanggal === dbm.today()
        && (mulai === null || dbm.nowMenit() >= mulai)) {
        return fail(res, 409, 'Jadwal guru tujuan sudah dimulai. Pilih slot pasangan yang belum masuk jam pelajaran.');
      }
    }
    const alasan = String(b.alasan || '').trim().slice(0, 240);
    if (alasanJenis === 'lainnya' && (!alasan || /\b(?:izin|sakit)\b/i.test(alasan))) {
      return fail(res, 400, 'Alasan tukar hari yang sama wajib diisi dan tidak boleh berupa Izin atau Sakit.');
    }
    if (alasanJenis !== 'lainnya' && !['izin', 'sakit'].includes(alasanJenis)) {
      return fail(res, 400, 'Tukar lintas hari hanya dapat beralasan Sakit atau Izin.');
    }
    const alasanTersimpan = alasanJenis === 'lainnya' ? alasan : alasanJenis[0].toUpperCase() + alasanJenis.slice(1);
    const createdAt = dbm.now();
    let requestId = 0;
    const createdIds = [];
    db.transaction(() => {
      const simpan = (slot, dari, keGuru, mapelId) => {
        const ins = db.prepare(`INSERT INTO jadwal_tukar
          (jadwal_id,tanggal,ta_id,dari_guru,ke_guru,mapel_id,alasan,alasan_jenis,status,jenis,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'pending','tukar',?,?)`)
          .run(Number(slot.id), slot === rowTujuan || targetIds.includes(Number(slot.id)) ? targetTanggal : tanggal,
            Number(slot.ta_id) || Number(row.ta_id) || 0, dari, keGuru, mapelId, alasanTersimpan, alasanJenis,
            createdAt, createdAt);
        const id = Number(ins.lastInsertRowid);
        createdIds.push(id);
        if (!requestId && Number(slot.id) === Number(row.id)) requestId = id;
      };
      for (const slot of groupAsal) simpan(slot, pemilik, keId, Number(mapelTujuan.id));
      for (const slot of groupTujuan) simpan(slot, keId, pemilik, Number(row.mapel_id));
      const placeholdersCreated = createdIds.map(() => '?').join(',');
      db.prepare(`UPDATE jadwal_tukar SET permintaan_id=? WHERE id IN (${placeholdersCreated})`)
        .run(requestId, ...createdIds);
    })();
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(mapelTujuan.id)) || {};
    dbm.logAudit(user, 'TAMBAH', 'absensi_guru',
      `Permintaan tukar jadwal dua arah ${row.mapel_nama || 'mapel'} ↔ ${mapel.nama || 'mapel'} (${tanggal}) ${pemilik} ↔ ${ke.nama}`, ipOf(req));
    json(res, 200, {
      ok: true, id: requestId,
      tukar: (dbm.tukarOf(row.id, tanggal).find(t => Number(t.id) === requestId)) || null,
      pasangan: { jadwal_id: rowTujuan.id, tanggal: targetTanggal, mapel_id: rowTujuan.mapel_id, mapel_nama: rowTujuan.mapel_nama, sesi: rowTujuan.sesi },
      pesan: `Permintaan pertukaran ${row.mapel_nama || 'mapel'} ↔ ${mapel.nama || 'mapel'} dikirim ke ${ke.nama}. Setelah diterima, guru dan mapel berpindah pada kedua slot; jadwal rutin tidak berubah.`
    });
  });

  /* daftar permintaan: masuk (harus dijawab) & riwayat yang saya ajukan */
  get('/api/tukar-jadwal', (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'view'); if (!user) return;
    json(res, 200, {
      ok: true,
      masuk: dbm.tukarMasuk(user.id),
      keluar: dbm.tukarKeluar(user.id, 30),
      jumlah_masuk: dbm.tukarMasuk(user.id).length
    });
  });

  /* terima / tolak (guru tujuan) atau batalkan (guru pengaju) */
  post('/api/tukar-jadwal/putus', async (req, res) => {
    const user = guard(req, res, 'absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const id = Number(b.id) || 0;
    const aksi = String(b.aksi || '').toLowerCase();
    if (!['terima', 'tolak', 'batal'].includes(aksi)) return fail(res, 400, 'Aksi tidak dikenal.');
    const t = db.prepare('SELECT * FROM jadwal_tukar WHERE id=?').get(id);
    if (!t) return fail(res, 404, 'Permintaan tukar jadwal tidak ditemukan.');
    if (t.status !== 'pending') return fail(res, 409, `Permintaan ini sudah ${t.status}.`);
    if (aksi === 'batal') {
      if (Number(t.dari_guru) !== Number(user.id)) return fail(res, 403, 'Hanya guru pengaju yang dapat membatalkan permintaan.');
    } else {
      if (Number(t.ke_guru) !== Number(user.id)) return fail(res, 403, 'Hanya guru tujuan yang dapat menerima/menolak permintaan ini.');
      const tgl = String(t.tanggal || '').slice(0, 10);
      if (tgl < dbm.today()) return fail(res, 409, 'Permintaan untuk tanggal yang sudah lewat tidak dapat diproses.');
    }
    const status = aksi === 'terima' ? 'diterima' : (aksi === 'tolak' ? 'ditolak' : 'batal');
    const catatan = String(b.catatan || '').trim().slice(0, 240);
    const permintaanId = Number(t.permintaan_id) || Number(t.id);
    const slotPasangan = db.prepare('SELECT DISTINCT jadwal_id,tanggal FROM jadwal_tukar WHERE COALESCE(permintaan_id,id)=?')
      .all(permintaanId).map(x => ({ jadwal_id: Number(x.jadwal_id), tanggal: String(x.tanggal).slice(0, 10) }));
    if (aksi === 'terima') {
      if (!slotPasangan.length) return fail(res, 409, 'Slot permintaan tukar jadwal tidak ditemukan.');
      const alasanJenis = String(t.alasan_jenis || 'lainnya');
      const tanggalUnik = [...new Set(slotPasangan.map(x => x.tanggal))];
      const barisPermintaan = db.prepare(`SELECT jadwal_id,tanggal,dari_guru FROM jadwal_tukar
        WHERE COALESCE(permintaan_id,id)=?`).all(permintaanId);
      const tanggalSumber = [...new Set(barisPermintaan
        .filter(x => Number(x.dari_guru) === Number(t.dari_guru)).map(x => String(x.tanggal).slice(0, 10)))];
      const tanggalTujuan = [...new Set(barisPermintaan
        .filter(x => Number(x.dari_guru) === Number(t.ke_guru)).map(x => String(x.tanggal).slice(0, 10)))];
      if (alasanJenis === 'lainnya' && (tanggalUnik.length !== 1 || !tanggalTukarMingguIni(tanggalUnik[0]))) {
        return fail(res, 409, 'Tukar pada tanggal yang sama hanya dapat diterima hari ini atau pada hari mendatang dalam minggu ini.');
      }
      if (alasanJenis !== 'lainnya'
        && (tanggalUnik.length !== 2 || tanggalSumber.length !== 1 || tanggalTujuan.length !== 1
          || !tanggalTukarMingguIni(tanggalSumber[0]) || !tanggalTukarMendatang(tanggalTujuan[0])
          || tanggalTujuan[0] <= tanggalSumber[0])) {
        return fail(res, 409, 'Permintaan Sakit/Izin hanya dapat menggeser jadwal sumber ke tanggal yang lebih akhir dalam minggu berjalan.');
      }
      const cfgTukar = dbm.jadwalConfig();
      const targetSlotIds = new Set(db.prepare(`SELECT jadwal_id FROM jadwal_tukar
        WHERE COALESCE(permintaan_id,id)=? AND dari_guru=?`).all(permintaanId, Number(t.ke_guru))
        .map(x => Number(x.jadwal_id)));
      const slotPerTanggal = new Map();
      for (const item of slotPasangan) {
        const group = slotPerTanggal.get(item.tanggal) || [];
        group.push(item.jadwal_id);
        slotPerTanggal.set(item.tanggal, group);
      }
      const semuaTerlibat = [];
      for (const [tgl, ids] of slotPerTanggal) {
        const placeholders = ids.map(() => '?').join(',');
        const jadwalTerlibat = db.prepare(`SELECT * FROM jadwal WHERE id IN (${placeholders})`).all(...ids);
        if (jadwalTerlibat.length !== ids.length) {
          return fail(res, 409, 'Sebagian slot jadwal sudah tidak tersedia. Permintaan tidak dapat diterima.');
        }
        semuaTerlibat.push(...jadwalTerlibat);
        const absensiAda = db.prepare(`SELECT 1 FROM absensi_guru
          WHERE tanggal=? AND jadwal_id IN (${placeholders}) LIMIT 1`).get(tgl, ...ids);
        const sesiAda = db.prepare(`SELECT 1 FROM absensi_sesi
          WHERE tanggal=? AND jadwal_id IN (${placeholders}) LIMIT 1`).get(tgl, ...ids);
        if (absensiAda || sesiAda) {
          return fail(res, 409, 'Salah satu sesi sudah mulai diabsen/dibuka. Permintaan tukar jadwal tidak dapat diterima.');
        }
        const sudahDikelompokkan = new Set();
        for (const slot of jadwalTerlibat) {
          const semua = dbm.jadwalRows(Number(slot.ta_id)).filter(x => Number(x.hari) === Number(slot.hari));
          const group = kelompokJadwal(slot, semua, cfgTukar);
          const groupKey = group.map(x => Number(x.id)).sort((a, b) => a - b).join(',');
          if (sudahDikelompokkan.has(groupKey)) continue;
          sudahDikelompokkan.add(groupKey);
          const window = jendelaKelompok(group, tgl, cfgTukar);
          if (!window.sesi || window.nonaktif || !window.hariOk
            || (tgl === dbm.today() && dbm.nowMenit() > dbm.jamMenit(window.tutup))) {
            return fail(res, 409, 'Salah satu sesi sudah berakhir atau tidak berlaku. Permintaan tidak dapat diterima.');
          }
          const mulai = dbm.jamMenit(window.sesi.mulai);
          if (alasanJenis === 'lainnya' && tgl === dbm.today()
            && group.some(item => targetSlotIds.has(Number(item.id)))
            && (mulai === null || dbm.nowMenit() >= mulai)) {
            return fail(res, 409, 'Jadwal guru tujuan sudah dimulai. Permintaan tukar tidak dapat diterima.');
          }
        }
      }
      if (alasanJenis === 'lainnya' && !semuaTerlibat.every(s => Number(s.hari) === dbm.hariOf(tanggalUnik[0]))) {
        return fail(res, 409, 'Kedua slot tukar hari yang sama harus berada pada hari dan tanggal pilihan.');
      }
    }
    db.transaction(() => {
      db.prepare(`UPDATE jadwal_tukar SET status=?, catatan_putus=?, diputus_at=?, diputus_oleh=?, diputus_nama=?, updated_at=?
        WHERE COALESCE(permintaan_id,id)=? AND status='pending'`)
        .run(status, catatan, dbm.now(), Number(user.id), user.nama || '', dbm.now(), permintaanId);
      if (status === 'diterima') {
        /* Satu slot hanya boleh masuk ke satu pertukaran pada tanggal ini. */
        for (const item of slotPasangan) {
          db.prepare(`UPDATE jadwal_tukar SET status='ditolak', catatan_putus=?, diputus_at=?,
              diputus_oleh=?, diputus_nama=?, updated_at=?
            WHERE tanggal=? AND jadwal_id=? AND status='pending'
              AND COALESCE(permintaan_id,id)<>?`)
            .run('Slot sudah masuk ke pertukaran lain yang diterima', dbm.now(), Number(user.id),
              user.nama || '', dbm.now(), item.tanggal, item.jadwal_id, permintaanId);
        }
      }
    })();
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(t.jadwal_id)) || {};
    const dari = db.prepare('SELECT nama FROM users WHERE id=?').get(Number(t.dari_guru)) || {};
    const ke = db.prepare('SELECT nama FROM users WHERE id=?').get(Number(t.ke_guru)) || {};
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(t.mapel_id)) || {};
    dbm.logAudit(user, 'UBAH', 'absensi_guru',
      `${status === 'diterima' ? 'Menerima' : status === 'ditolak' ? 'Menolak' : 'Membatalkan'} tukar jadwal ${mapel.nama || 'mapel'} sesi ${row.sesi || '-'} (${t.tanggal}): ${dari.nama || '-'} → ${ke.nama || '-'}`,
      ipOf(req));
    json(res, 200, {
      ok: true, status,
      pesan: status === 'diterima'
        ? `Permintaan diterima — jadwal ${dari.nama || 'guru'} dan ${ke.nama || 'guru'} saling bertukar mapel pada pekan ini; pekan berikutnya kembali normal.`
        : status === 'ditolak' ? 'Permintaan tukar jadwal ditolak. Jadwal tetap seperti semula.'
          : 'Permintaan tukar jadwal dibatalkan.'
    });
  });

  /* =================================================================
     6c. GURU PIKET & PENGGANTI (penunjukan oleh Kepala Sekolah / Kurikulum)
     ---------------------------------------------------------------------
     Penunjukan TIDAK mengubah master jadwal: hanya menulis satu baris
     `jadwal_tukar` berjenis 'penugasan' + status 'diterima' untuk TANGGAL itu,
     sehingga sesi otomatis berpindah ke akun guru pengganti (absensi, jurnal,
     presensi siswa, dan alfa otomatis).
     ================================================================= */
  const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;

  /** semua guru aktif yang TIDAK mengajar pada (hari,sesi) — kandidat pengganti */
  function kandidatPengganti(row, tanggal, cfgSemua) {
    const hari = Number(row.hari), sesi = Number(row.sesi);
    const semua = cfgSemua || [];
    const sibuk = new Set(semua.filter(r => Number(r.hari) === hari && Number(r.sesi) === sesi)
      .map(r => Number(r.guru_id)).filter(Boolean));
    const kelasIds = dbm.jadwalKelasIds(row);
    const kelasSama = new Set(semua.filter(r => r.kelas_ids.some(id => kelasIds.includes(id)))
      .map(r => Number(r.guru_id)).filter(Boolean));
    return guruList()
      .filter(g => Number(g.id) !== Number(row.guru_id))
      .map(g => ({
        id: g.id, nama: g.nama, nip: g.nip || '', jabatan: g.jabatan || '',
        role_label: g.label, sibuk: sibuk.has(Number(g.id)), kelas_sama: kelasSama.has(Number(g.id)),
        /* guru yang sudah mengajar jam yang sama tidak dapat ditunjuk */
        bisa: !sibuk.has(Number(g.id))
      }))
      .sort((a, b) => (Number(b.bisa) - Number(a.bisa)) || (Number(b.kelas_sama) - Number(a.kelas_sama))
        || String(a.nama).localeCompare(String(b.nama)));
  }

  get('/api/guru-pengganti', (req, res, q) => {
    const user = guard(req, res, 'guru_pengganti', 'view'); if (!user) return;
    const tanggal = TGL_RE.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    const hari = dbm.hariOf(tanggal);
    const taId = taOf(q);
    const cfg = dbm.jadwalConfig();
    let semua = dbm.jadwalRows(taId);
    if (!semua.length) {
      for (const id of semuaTaIds()) {
        if (Number(id) === Number(taId)) continue;
        const coba = dbm.jadwalRows(id);
        if (coba.length) { semua = coba; break; }
      }
    }
    const slotHari = semua.filter(r => Number(r.hari) === hari);
    const tukarHari = dbm.tukarMap(tanggal);
    const absMap = new Map(db.prepare('SELECT * FROM absensi_guru WHERE tanggal=?').all(tanggal)
      .map(a => [Number(a.jadwal_id), a]));
    const izinMap = new Map(db.prepare('SELECT * FROM absensi_guru_izin WHERE tanggal=?').all(tanggal)
      .map(a => [Number(a.jadwal_id), a]));
    const slots = slotHari.map(r => {
      const group = kelompokJadwal(r, slotHari, cfg);
      const t = tukarHari.get(Number(r.id)) || null;
      const a = absMap.get(Number(r.id)) || null;
      /* ketidakhadiran guru bisa berada di absensi_guru_izin (sudah ada pengganti)
         ATAU masih di absensi_guru (izin/sakit/alpha, belum ditunjuk pengganti) */
      const iz = izinMap.get(Number(r.id))
        || (a && ['izin', 'sakit', 'alpha'].includes(String(a.status)) ? a : null);
      const w = jendelaKelompok(group, tanggal, cfg);
      const mapelAktif = mapelEfektif(r, t);
      return {
        jadwal_id: Number(r.id), sesi: Number(r.sesi),
        label_sesi: w.sesi ? `Jam ke-${w.sesi.no}${w.sesi_akhir.no !== w.sesi.no ? `–${w.sesi_akhir.no}` : ''}` : `Sesi ${r.sesi}`,
        jam: w.sesi ? `${w.sesi.mulai}–${w.selesai}` : '', group_ids: group.map(x => Number(x.id)),
        kelas_ids: r.kelas_ids,
        istirahat: !!(w.sesi && w.sesi.istirahat),
        mapel_id: mapelAktif.mapel_id || Number(r.mapel_id) || 0,
        mapel_nama: mapelAktif.mapel_nama || r.mapel_nama || '', kelas_nama: r.kelas_nama || '',
        guru_id: Number(r.guru_id) || 0, guru_nama: r.guru_nama || '',
        guru_efektif_id: t ? Number(t.ke_guru) : Number(r.guru_id) || 0,
        guru_efektif_nama: t ? t.ke_nama : (r.guru_nama || ''),
        absensi: a ? {
          status: a.status, waktu: a.waktu_submit || '', oleh: a.guru_id,
          materi: a.materi || '', catatan: a.catatan || '', foto_url: a.foto_url || ''
        } : null,
        izin: iz ? { status: iz.status, catatan: iz.catatan || '', waktu: iz.waktu_submit || '' } : null,
        pengganti: t ? {
          id: t.id, jenis: t.jenis || 'tukar', dari_guru: t.dari_guru, dari_nama: t.dari_nama,
          ke_guru: t.ke_guru, ke_nama: t.ke_nama, alasan: t.alasan || '',
          dibuat_nama: t.dibuat_nama || '', dibuat_at: t.created_at || ''
        } : null,
        perlu_pengganti: !!(iz && ['izin', 'sakit', 'alpha'].includes(String(iz.status).toLowerCase())),
        window: {
          aktif: !!w.aktif, alasan: w.alasan || '', selesai: w.selesai || '',
          lewat: sesiSudahLewat(group, tanggal, cfg)
        }
      };
    }).filter(x => !x.istirahat);
    /* guru tidak hadir hari itu — gabungan rekam izin & absensi_guru (izin/sakit/alpha).
       INNER JOIN ke jadwal WAJIB: baris absensi tanpa jadwal (slot sudah dihapus)
       tidak boleh lagi muncul sebagai notifikasi dengan mapel/sesi kosong. */
    const tidakHadirRaw = [
      ...db.prepare(`SELECT z.*, u.nama AS guru_nama, m.nama AS mapel_nama, j.sesi, j.hari, j.kelas_ids
        FROM absensi_guru_izin z
        JOIN jadwal j ON j.id=z.jadwal_id
        LEFT JOIN users u ON u.id=z.guru_id
        LEFT JOIN mapel m ON m.id=j.mapel_id
        WHERE z.tanggal=? ORDER BY j.sesi`).all(tanggal),
      ...db.prepare(`SELECT g.id, g.jadwal_id, g.guru_id, g.status, g.catatan, g.waktu_submit,
          u.nama AS guru_nama, m.nama AS mapel_nama, j.sesi, j.hari, j.kelas_ids
        FROM absensi_guru g
        JOIN jadwal j ON j.id=g.jadwal_id
        LEFT JOIN users u ON u.id=g.guru_id
        LEFT JOIN mapel m ON m.id=j.mapel_id
        WHERE g.tanggal=? AND g.status IN ('izin','sakit','alpha')
          AND g.jadwal_id NOT IN (SELECT jadwal_id FROM absensi_guru_izin WHERE tanggal=?)
        ORDER BY j.sesi`).all(tanggal, tanggal)
    ];
    const tidakHadir = tidakHadirRaw.map(z => {
      const w = dbm.absensiWindow({ hari: z.hari, sesi: z.sesi }, tanggal, cfg);
      return {
        id: z.id, jadwal_id: z.jadwal_id, guru_id: z.guru_id, guru_nama: z.guru_nama || '',
        status: z.status, catatan: z.catatan || '', mapel_nama: z.mapel_nama || '',
        kelas_ids: dbm.jadwalKelasIds(z),
        sesi: z.sesi, jam: w.sesi ? `${w.sesi.mulai}–${w.sesi.selesai}` : '',
        waktu: z.waktu_submit || '', ada_pengganti: !!tukarHari.get(Number(z.jadwal_id))
      };
    });
    const periodeRiwayat = ['mingguan', 'bulanan', 'tahun', 'custom', 'semua'].includes(String(q.riwayat_periode || ''))
      ? String(q.riwayat_periode) : 'bulanan';
    const acuanRiwayat = TGL_RE.test(String(q.riwayat_tanggal || '')) ? String(q.riwayat_tanggal) : tanggal;
    let riwayatDari = acuanRiwayat, riwayatSampai = acuanRiwayat;
    if (periodeRiwayat === 'mingguan') {
      const d = new Date(acuanRiwayat + 'T12:00:00');
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      riwayatDari = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      riwayatSampai = isoAddDays(riwayatDari, 6);
    } else if (periodeRiwayat === 'bulanan') {
      riwayatDari = acuanRiwayat.slice(0, 7) + '-01';
      const d = new Date(Number(acuanRiwayat.slice(0, 4)), Number(acuanRiwayat.slice(5, 7)), 0);
      riwayatSampai = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else if (periodeRiwayat === 'tahun') {
      const ta = dbm.tahunById(taId) || {};
      riwayatDari = ta.tanggal_mulai || '0000-01-01';
      riwayatSampai = ta.tanggal_selesai || '9999-12-31';
    } else if (periodeRiwayat === 'custom') {
      const a = TGL_RE.test(String(q.riwayat_dari || '')) ? String(q.riwayat_dari) : acuanRiwayat;
      const b = TGL_RE.test(String(q.riwayat_sampai || '')) ? String(q.riwayat_sampai) : a;
      riwayatDari = a <= b ? a : b;
      riwayatSampai = a <= b ? b : a;
    } else if (periodeRiwayat === 'semua') {
      riwayatDari = '0000-01-01';
      riwayatSampai = '9999-12-31';
    }
    const riwayatRows = db.prepare(`SELECT t.*, d.nama AS dari_nama, k.nama AS ke_nama, m.nama AS mapel_nama,
        j.sesi, j.kelas_ids, j.mapel_id AS mapel_asal_id, ma.nama AS mapel_asal_nama
      FROM jadwal_tukar t
      LEFT JOIN users d ON d.id=t.dari_guru
      LEFT JOIN users k ON k.id=t.ke_guru
      LEFT JOIN mapel m ON m.id=t.mapel_id
      LEFT JOIN jadwal j ON j.id=t.jadwal_id
      LEFT JOIN mapel ma ON ma.id=j.mapel_id
      WHERE t.tanggal BETWEEN ? AND ? ORDER BY t.created_at DESC,t.id DESC LIMIT 5000`)
      .all(riwayatDari, riwayatSampai).map(x => ({
        ...x, dari_nama: x.dari_nama || 'Guru', ke_nama: x.ke_nama || 'Guru',
        kelas_nama: kelasNamaOf(dbm.jadwalKelasIds(x))
      }));
    const riwayat = [];
    const riwayatKey = new Set();
    for (const x of riwayatRows) {
      const key = Number(x.permintaan_id) ? `permintaan:${Number(x.permintaan_id)}`
        : `${x.jenis || 'tukar'}|${x.created_at}|${x.dari_guru}|${x.ke_guru}`;
      if (riwayatKey.has(key)) continue;
      riwayatKey.add(key);
      const anggota = riwayatRows.filter(y => (Number(y.permintaan_id) ? `permintaan:${Number(y.permintaan_id)}`
        : `${y.jenis || 'tukar'}|${y.created_at}|${y.dari_guru}|${y.ke_guru}`) === key);
      const utama = anggota.find(y => Number(y.id) === (Number(x.permintaan_id) || Number(x.id))) || x;
      const kelasNama = [...new Set(anggota.map(y => y.kelas_nama).filter(Boolean))].join(', ');
      const mapelNama = [...new Set(anggota.map(y => y.mapel_nama || y.mapel_asal_nama).filter(Boolean))].join(' ↔ ');
      const cocokKelas = !Number(q.riwayat_kelas) || anggota.some(y =>
        dbm.jadwalKelasIds(y).includes(Number(q.riwayat_kelas)));
      const cocokGuru = !Number(q.riwayat_guru) || anggota.some(y =>
        Number(y.dari_guru) === Number(q.riwayat_guru) || Number(y.ke_guru) === Number(q.riwayat_guru));
      const cocokMapel = !Number(q.riwayat_mapel) || anggota.some(y =>
        Number(y.mapel_id) === Number(q.riwayat_mapel) || Number(y.mapel_asal_id) === Number(q.riwayat_mapel));
      const kata = String(q.riwayat_q || '').trim().toLowerCase();
      const cocokKata = !kata || `${anggota.map(y => `${y.dari_nama} ${y.ke_nama} ${y.mapel_nama} ${y.mapel_asal_nama} ${y.kelas_nama}`).join(' ')}`
        .toLowerCase().includes(kata);
      if (!cocokKelas || !cocokGuru || !cocokMapel || !cocokKata) continue;
      riwayat.push({
        ...utama, group_ids: anggota.map(y => Number(y.jadwal_id)), jumlah_slot: anggota.length,
        riwayat_ids: anggota.map(y => Number(y.id)),
        kelas_nama: kelasNama, mapel_nama: mapelNama,
        mapel_asal_nama: utama.mapel_asal_nama || '', pasangan_sesi: anggota
          .filter(y => Number(y.id) !== Number(utama.id)).map(y => y.sesi).filter(Boolean).join(', ')
      });
    }
    const isPenggantiAkun = !isPengawas(user);
    const guruFilter = Number(q.guru) || 0;
    const kelasFilter = Number(q.kelas) || 0;
    const slotTampil = (isPenggantiAkun
      ? slots.filter(s => Number(s.guru_efektif_id) === Number(user.id))
      : slots).filter(s =>
        (!guruFilter || Number(s.guru_efektif_id) === guruFilter || Number(s.guru_id) === guruFilter)
        && (!kelasFilter || (s.kelas_ids || []).map(Number).includes(kelasFilter)));
    const riwayatTampil = isPenggantiAkun
      ? riwayat.filter(r => Number(r.ke_guru) === Number(user.id) || Number(r.dari_guru) === Number(user.id))
      : riwayat;
    json(res, 200, {
      ok: true, tanggal, tanggal_label: dbm.tanggalPanjang(tanggal), hari, hari_label: dbm.HARI_LABEL[hari] || '',
      hari_ini: tanggal === dbm.today(), sekarang: dbm.menitJam(dbm.nowMenit()),
      slots: slotTampil,
      tidak_hadir: isPenggantiAkun ? [] : tidakHadir.filter(s =>
        (!guruFilter || Number(s.guru_id) === guruFilter)
        && (!kelasFilter || (dbm.jadwalKelasIds(s)).includes(kelasFilter))),
      riwayat: riwayatTampil,
      guru: isPenggantiAkun ? [] : guruList(),
      kelas: isPenggantiAkun ? [] : kelasPicker(),
      mapel: isPenggantiAkun ? [] : dbm.mapelList({ aktifOnly: false }),
      filter_riwayat: {
        periode: periodeRiwayat, dari: riwayatDari, sampai: riwayatSampai,
        kelas: Number(q.riwayat_kelas) || 0, guru: Number(q.riwayat_guru) || 0,
        mapel: Number(q.riwayat_mapel) || 0
      },
      jurnal_min: cfg.jurnalMin,
      config: {
        jurnal_min: cfg.jurnalMin, foto_wajib: cfg.fotoWajib ? 1 : 0,
        max_upload_kb: Math.max(64, Number(dbm.getSetting('upload_max_kb', 2048)) || 2048)
      },
      jumlah_slot: slotTampil.length,
      jumlah_pengganti: slotTampil.filter(s => s.pengganti).length,
      jumlah_perlu: isPenggantiAkun ? 0 : slotTampil.filter(s => s.perlu_pengganti && !s.pengganti).length,
      kandidat_semua: kandidatPengganti({ hari, sesi: -1, kelas_ids: [] }, tanggal, [])
    });
  });

  get('/api/guru-pengganti/riwayat/detail', (req, res, q) => {
    const user = guard(req, res, 'guru_pengganti', 'view'); if (!user) return;
    const id = Number(q.id) || 0;
    const item = db.prepare(`SELECT t.*, d.nama AS dari_nama, k.nama AS ke_nama,
        m.nama AS mapel_nama, j.sesi, j.hari, j.kelas_ids, j.ta_id,
        j.mapel_id AS mapel_asal_id, ma.nama AS mapel_asal_nama
      FROM jadwal_tukar t
      LEFT JOIN users d ON d.id=t.dari_guru
      LEFT JOIN users k ON k.id=t.ke_guru
      LEFT JOIN mapel m ON m.id=t.mapel_id
      LEFT JOIN jadwal j ON j.id=t.jadwal_id
      LEFT JOIN mapel ma ON ma.id=j.mapel_id
      WHERE t.id=?`).get(id);
    if (!item) return fail(res, 404, 'Riwayat guru pengganti tidak ditemukan.');
    if (!isPengawas(user) && Number(item.dari_guru) !== Number(user.id)
      && Number(item.ke_guru) !== Number(user.id)) {
      return fail(res, 403, 'Anda hanya dapat melihat detail riwayat yang melibatkan akun Anda.');
    }

    const keyOf = row => Number(row.permintaan_id)
      ? `permintaan:${Number(row.permintaan_id)}`
      : `${row.jenis || 'tukar'}|${row.created_at}|${row.dari_guru}|${row.ke_guru}`;
    const itemKey = keyOf(item);
    const anggota = db.prepare(`SELECT t.*, d.nama AS dari_nama, k.nama AS ke_nama,
        m.nama AS mapel_nama, j.sesi, j.hari, j.kelas_ids, j.ta_id,
        j.mapel_id AS mapel_asal_id, ma.nama AS mapel_asal_nama
      FROM jadwal_tukar t
      LEFT JOIN users d ON d.id=t.dari_guru
      LEFT JOIN users k ON k.id=t.ke_guru
      LEFT JOIN mapel m ON m.id=t.mapel_id
      LEFT JOIN jadwal j ON j.id=t.jadwal_id
      LEFT JOIN mapel ma ON ma.id=j.mapel_id
      WHERE t.tanggal=? ORDER BY j.sesi,t.id`).all(item.tanggal)
      .filter(row => keyOf(row) === itemKey);
    const cfg = dbm.jadwalConfig();
    const jadwalRows = anggota.map(row =>
      db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(row.jadwal_id))).filter(Boolean);
    const rentang = dbm.absensiRentangSesi(jadwalRows, cfg);
    const statusGuruLabel = { hadir: 'Hadir', sakit: 'Sakit', izin: 'Izin', alpha: 'Alpha' };
    const slotDetails = anggota.map(row => {
      const jadwal = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(row.jadwal_id));
      if (!jadwal) return null;
      const kelasIds = dbm.jadwalKelasIds(jadwal);
      const daftarSesi = dbm.sesiOfHari(cfg, Number(jadwal.hari));
      const sesi = daftarSesi.find(x => Number(x.idx) === Number(jadwal.sesi));
      const absensi = db.prepare('SELECT * FROM absensi_guru WHERE jadwal_id=? AND tanggal=?')
        .get(Number(jadwal.id), String(item.tanggal));
      const izin = db.prepare('SELECT * FROM absensi_guru_izin WHERE jadwal_id=? AND tanggal=?')
        .get(Number(jadwal.id), String(item.tanggal));
      const guruAbsensi = absensi ? {
        status: absensi.status, status_label: statusGuruLabel[absensi.status] || absensi.status,
        guru_id: Number(absensi.guru_id) || 0,
        guru_nama: (db.prepare('SELECT nama FROM users WHERE id=?').get(Number(absensi.guru_id)) || {}).nama || '',
        waktu_submit: absensi.waktu_submit || ''
      } : null;
      const guruIzin = izin ? {
        status: izin.status, status_label: statusGuruLabel[izin.status] || izin.status,
        guru_id: Number(izin.guru_id) || 0,
        guru_nama: (db.prepare('SELECT nama FROM users WHERE id=?').get(Number(izin.guru_id)) || {}).nama || '',
        catatan: izin.catatan || '', waktu_submit: izin.waktu_submit || ''
      } : null;
      const sesiPresensi = db.prepare('SELECT * FROM absensi_sesi WHERE jadwal_id=? AND tanggal=?')
        .get(Number(jadwal.id), String(item.tanggal));
      let presensiSiswa = null;
      if (sesiPresensi) {
        const tercatat = db.prepare(`SELECT a.*, s.nama AS siswa_nama, k.nama AS kelas_nama
          FROM absensi_siswa a
          LEFT JOIN siswa s ON s.id=a.siswa_id
          LEFT JOIN kelas k ON k.id=a.kelas_id
          WHERE a.sesi_id=? ORDER BY k.nama,s.nama`).all(Number(sesiPresensi.id));
        const catatanBySiswa = new Map(tercatat.map(x => [Number(x.siswa_id), x]));
        const siswaAktif = dbm.siswaOfKelas(kelasIds);
        const siswaIds = new Set(siswaAktif.map(x => Number(x.id)));
        const siswa = siswaAktif.map(x => {
          const catatan = catatanBySiswa.get(Number(x.id));
          if (catatan) siswaIds.delete(Number(x.id));
          return {
            siswa_id: Number(x.id), nama: x.nama, kelas_nama: x.kelas_nama || '',
            status: catatan ? String(catatan.status || '').toUpperCase() : '',
            keterangan: catatan ? catatan.keterangan || '' : ''
          };
        });
        for (const catatan of tercatat) {
          if (!siswaIds.has(Number(catatan.siswa_id)) && siswaAktif.some(x => Number(x.id) === Number(catatan.siswa_id))) continue;
          siswa.push({
            siswa_id: Number(catatan.siswa_id), nama: catatan.siswa_nama || 'Siswa tidak aktif',
            kelas_nama: catatan.kelas_nama || '', status: String(catatan.status || '').toUpperCase(),
            keterangan: catatan.keterangan || ''
          });
        }
        const hitung = { H: 0, S: 0, I: 0, A: 0, B: 0, belum: 0 };
        for (const x of siswa) {
          if (Object.prototype.hasOwnProperty.call(hitung, x.status)) hitung[x.status]++;
          else hitung.belum++;
        }
        presensiSiswa = {
          sesi_id: Number(sesiPresensi.id), pencatat: sesiPresensi.pencatat || '',
          total: siswa.length, tercatat: siswa.length - hitung.belum, hitung, siswa
        };
      }
      const mapelId = Number(row.mapel_id) || Number(jadwal.mapel_id);
      const mapel = db.prepare('SELECT nama,kode FROM mapel WHERE id=?').get(mapelId) || {};
      return {
        jadwal_id: Number(jadwal.id), sesi: Number(jadwal.sesi),
        label_sesi: sesi ? (sesi.no ? `Jam ke-${sesi.no}` : sesi.label) : `Sesi ${jadwal.sesi}`,
        jam: sesi ? `${sesi.mulai}–${sesi.selesai}` : '',
        mapel_nama: mapel.nama || row.mapel_nama || row.mapel_asal_nama || '',
        mapel_kode: mapel.kode || '', kelas_nama: kelasNamaOf(kelasIds),
        guru_absensi: guruAbsensi, guru_izin: guruIzin,
        jurnal: absensi ? {
          materi: absensi.materi || '', catatan: absensi.catatan || '',
          foto_url: absensi.foto_url || ''
        } : null,
        presensi_siswa: presensiSiswa
      };
    }).filter(Boolean);
    json(res, 200, {
      ok: true,
      riwayat: {
        id: Number(item.id), tanggal: item.tanggal, status: item.status,
        jenis: item.jenis || 'tukar', dari_nama: item.dari_nama || 'Guru',
        ke_nama: item.ke_nama || 'Guru', alasan: item.alasan || '',
        catatan_putus: item.catatan_putus || '', dibuat_nama: item.dibuat_nama || '',
        dibuat_at: item.created_at || '', kelas_nama: [...new Set(anggota
          .map(x => kelasNamaOf(dbm.jadwalKelasIds(x))).filter(Boolean))].join(', '),
        mapel_nama: [...new Set(anggota.map(x => x.mapel_nama || x.mapel_asal_nama).filter(Boolean))].join(' ↔ '),
        label_sesi: rentang.label_sesi, jam: rentang.jam, jumlah_slot: anggota.length
      },
      slots: slotDetails
    });
  });

  /* daftar kandidat pengganti untuk satu slot (dipakai modal penunjukan) */
  get('/api/guru-pengganti/kandidat', (req, res, q) => {
    const user = guard(req, res, 'guru_pengganti', 'view'); if (!user) return;
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(q.jadwal_id) || 0);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const tanggal = TGL_RE.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    const cfg = dbm.jadwalConfig();
    let semua = dbm.jadwalRows(Number(row.ta_id) || taOf(q));
    if (!semua.length) semua = dbm.jadwalRows(taOf(q));
    const group = kelompokJadwal(row, semua.filter(r => Number(r.hari) === Number(row.hari)), cfg);
    const w = jendelaKelompok(group, tanggal, cfg);
    json(res, 200, {
      ok: true, tanggal, tanggal_label: dbm.tanggalPanjang(tanggal),
      slot: {
        jadwal_id: Number(row.id), sesi: Number(row.sesi),
        group_ids: group.map(x => Number(x.id)),
        label_sesi: w.sesi ? `Jam ke-${w.sesi.no}${w.sesi_akhir.no !== w.sesi.no ? `–${w.sesi_akhir.no}` : ''}` : `Sesi ${row.sesi}`,
        jam: w.sesi ? `${w.sesi.mulai}–${w.selesai}` : '',
        mapel_nama: (db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {}).nama || '',
        kelas_nama: kelasNamaOf(dbm.jadwalKelasIds(row)),
        guru_id: Number(row.guru_id) || 0,
        guru_nama: (db.prepare('SELECT nama FROM users WHERE id=?').get(Number(row.guru_id)) || {}).nama || ''
      },
      kandidat: (() => {
        const blocked = new Set(db.prepare(`SELECT DISTINCT guru_id FROM jadwal
          WHERE ta_id=? AND hari=? AND sesi IN (${group.map(() => '?').join(',')})
            AND id NOT IN (${group.map(() => '?').join(',')})`)
          .all(Number(row.ta_id) || 0, Number(row.hari), ...group.map(x => Number(x.sesi)),
            ...group.map(x => Number(x.id))).map(x => Number(x.guru_id)));
        return kandidatPengganti(row, tanggal, semua).map(k => ({
          ...k, sibuk: k.sibuk || blocked.has(Number(k.id)), bisa: k.bisa && !blocked.has(Number(k.id))
        }));
      })(),
      pengganti: dbm.tukarAktif(row.id, tanggal)
    });
  });

  /* tunjuk guru pengganti (langsung diterima, berlaku untuk tanggal itu saja) */
  post('/api/guru-pengganti/tunjuk', async (req, res) => {
    const user = guard(req, res, 'guru_pengganti', 'write'); if (!user) return;
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(b.jadwal_id) || 0);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const tanggal = TGL_RE.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
    if (Number(row.hari) !== dbm.hariOf(tanggal)) {
      return fail(res, 400, `Slot ini untuk hari ${dbm.HARI_LABEL[Number(row.hari)] || '-'}, bukan ${dbm.HARI_LABEL[dbm.hariOf(tanggal)] || tanggal}.`);
    }
    const semua = dbm.jadwalRows(Number(row.ta_id) || taOf(b)).filter(r => Number(r.hari) === Number(row.hari));
    const cfg = dbm.jadwalConfig();
    const group = kelompokJadwal(row, semua, cfg);
    if (sesiSudahLewat(group, tanggal, cfg)) {
      return fail(res, 403, 'Jam pelajaran sudah berakhir. Guru pengganti tidak dapat ditunjuk atau diganti setelah sesi terlewat.', { lewat: true });
    }
    const keId = Number(b.ke_guru) || 0;
    if (!keId) return fail(res, 400, 'Pilih guru pengganti terlebih dahulu.');
    const ke = db.prepare('SELECT * FROM users WHERE id=?').get(keId);
    if (!ke || Number(ke.aktif) !== 1) return fail(res, 404, 'Guru pengganti tidak ditemukan / tidak aktif.');
    if (keId === Number(row.guru_id)) return fail(res, 400, 'Guru pengganti tidak boleh guru pemilik slot.');
    /* kandidat tidak boleh sedang mengajar pada salah satu jam dalam rentang */
    const bentrok = db.prepare(`SELECT j.*, m.nama AS mapel_nama FROM jadwal j LEFT JOIN mapel m ON m.id=j.mapel_id
      WHERE j.ta_id=? AND j.hari=? AND j.sesi IN (${group.map(() => '?').join(',')})
        AND j.guru_id=? AND j.id NOT IN (${group.map(() => '?').join(',')})`)
      .get(Number(row.ta_id) || 0, Number(row.hari), ...group.map(x => Number(x.sesi)), keId,
        ...group.map(x => Number(x.id)));
    if (bentrok) {
      return fail(res, 409, `${ke.nama} sudah mengajar ${bentrok.mapel_nama || 'mapel lain'} pada jam yang sama sehingga tidak dapat ditunjuk.`);
    }
    const status = ['sakit', 'izin'].includes(String(b.status || '').toLowerCase())
      ? String(b.status).toLowerCase() : 'izin';
    const alasan = String(b.catatan || b.alasan || '').trim().slice(0, 240);
    if (b.status && alasan.length < 5) return fail(res, 400, 'Catatan sakit/izin wajib diisi minimal 5 karakter.');
    const absList = db.prepare(`SELECT * FROM absensi_guru WHERE tanggal=? AND jadwal_id IN (${group.map(() => '?').join(',')})`)
      .all(tanggal, ...group.map(x => Number(x.id)));
    if (absList.some(a => a.status === 'hadir')) {
      return fail(res, 409, 'Guru utama sudah check-in hadir. Penugasan pengganti tidak dapat menggantikan sesi yang sudah berjalan.');
    }
    const sebelum = dbm.tukarAktif(row.id, tanggal);
    let id = 0;
    const createdAt = dbm.now();
    db.transaction(() => {
      for (const slot of group) {
        db.prepare("UPDATE jadwal_tukar SET status='batal', catatan_putus=?, diputus_at=?, diputus_oleh=?, diputus_nama=?, updated_at=? WHERE jadwal_id=? AND tanggal=? AND status='diterima'")
          .run('Diganti dengan penunjukan baru', createdAt, Number(user.id), user.nama || '', createdAt, Number(slot.id), tanggal);
        const abs = db.prepare('SELECT * FROM absensi_guru WHERE jadwal_id=? AND tanggal=?').get(Number(slot.id), tanggal);
        const statusUtama = ['sakit', 'izin'].includes(String(b.status || '').toLowerCase())
          ? status : abs && ['sakit', 'izin'].includes(String(abs.status)) ? abs.status : status;
        const catatanUtama = abs && !b.status && abs.catatan ? abs.catatan : alasan;
        db.prepare(`INSERT INTO absensi_guru_izin(jadwal_id,tanggal,ta_id,guru_id,status,catatan,materi,foto_url,waktu_submit,ip,validasi,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(jadwal_id,tanggal) DO UPDATE SET guru_id=excluded.guru_id,status=excluded.status,
            catatan=excluded.catatan,materi=excluded.materi,foto_url=excluded.foto_url,
            waktu_submit=excluded.waktu_submit,ip=excluded.ip,validasi=excluded.validasi,updated_at=excluded.updated_at`)
          .run(Number(slot.id), tanggal, Number(slot.ta_id) || Number(row.ta_id) || 0, Number(slot.guru_id),
            statusUtama, catatanUtama, abs ? abs.materi || '' : '', abs ? abs.foto_url || null : null,
            abs ? abs.waktu_submit || '' : createdAt, abs ? abs.ip || '' : ipOf(req),
            abs ? abs.validasi || '' : JSON.stringify({ sumber: 'penunjukan_pengganti', status: statusUtama }),
            abs ? abs.created_at || createdAt : createdAt, createdAt);
        if (abs) db.prepare('DELETE FROM absensi_guru WHERE id=?').run(Number(abs.id));
        const r = db.prepare(`INSERT INTO jadwal_tukar(jadwal_id,tanggal,ta_id,dari_guru,ke_guru,mapel_id,alasan,status,jenis,dibuat_oleh,dibuat_nama,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,'diterima','penugasan',?,?,?,?)`)
          .run(Number(slot.id), tanggal, Number(slot.ta_id) || taOf(b), Number(slot.guru_id), keId,
            Number(slot.mapel_id) || 0, alasan, Number(user.id), user.nama || '', createdAt, createdAt);
        if (Number(slot.id) === Number(row.id)) id = Number(r.lastInsertRowid);
      }
    })();
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    dbm.logAudit(user, 'TAMBAH', 'jadwal',
      `Tunjuk guru pengganti ${mapel.nama || 'mapel'} ${group.length > 1 ? `sesi ${group[0].sesi}–${group[group.length - 1].sesi}` : `sesi ${row.sesi}`} (${tanggal}): ${ke.nama} menggantikan ${(db.prepare('SELECT nama FROM users WHERE id=?').get(Number(row.guru_id)) || {}).nama || '-'}${sebelum ? ' (mengganti penugasan sebelumnya)' : ''}`,
      ipOf(req));
    json(res, 200, {
      ok: true, id, tanggal,
      pengganti: dbm.tukarAktif(row.id, tanggal),
      pesan: `${ke.nama} ditunjuk sebagai guru pengganti ${group.length > 1 ? `pada rentang ${group[0].sesi}–${group[group.length - 1].sesi}` : `pada sesi ${row.sesi}`} (${tanggal}). Semua slot dalam rentang ini berpindah ke akunnya.`
    });
  });

  post('/api/guru-pengganti/riwayat/hapus', async (req, res) => {
    const user = guard(req, res, 'guru_pengganti', 'write'); if (!user) return;
    const b = await readBody(req);
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : [])
      .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu riwayat yang dapat dihapus.');
    if (ids.length > 500) return fail(res, 400, 'Maksimal 500 baris riwayat dapat dihapus sekaligus.');
    const selected = db.prepare(`SELECT * FROM jadwal_tukar WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    if (selected.length !== ids.length) return fail(res, 404, 'Sebagian riwayat yang dipilih tidak ditemukan.');
    const semuaIds = new Set();
    for (const row of selected) {
      let related;
      if (Number(row.permintaan_id)) {
        related = db.prepare('SELECT id,status FROM jadwal_tukar WHERE COALESCE(permintaan_id,id)=?')
          .all(Number(row.permintaan_id));
      } else {
        related = db.prepare(`SELECT id,status FROM jadwal_tukar
          WHERE tanggal=? AND created_at=? AND dari_guru=? AND ke_guru=? AND COALESCE(jenis,'tukar')=?`)
          .all(row.tanggal, row.created_at, Number(row.dari_guru), Number(row.ke_guru), row.jenis || 'tukar');
        if (!related.length) related = [{ id: row.id, status: row.status }];
      }
      for (const entry of related) {
        if (!['batal', 'ditolak'].includes(String(entry.status))) {
          return fail(res, 409, 'Riwayat yang masih aktif atau menunggu tidak dapat dihapus. Batalkan atau selesaikan prosesnya terlebih dahulu.');
        }
        semuaIds.add(Number(entry.id));
      }
    }
    if (semuaIds.size > 1000) return fail(res, 400, 'Pilihan mencakup terlalu banyak baris riwayat.');
    const hapusIds = [...semuaIds];
    db.transaction(() => {
      db.prepare(`DELETE FROM jadwal_tukar WHERE id IN (${hapusIds.map(() => '?').join(',')})`).run(...hapusIds);
    })();
    dbm.logAudit(user, 'HAPUS', 'jadwal', `Hapus ${hapusIds.length} baris riwayat guru piket/pengganti`, ipOf(req));
    json(res, 200, { ok: true, dihapus: hapusIds.length, pesan: `${hapusIds.length} baris riwayat dihapus.` });
  });

  /* batalkan penunjukan pengganti (kembali ke guru semula) */
  post('/api/guru-pengganti/batal', async (req, res) => {
    const user = guard(req, res, 'guru_pengganti', 'write'); if (!user) return;
    const b = await readBody(req);
    const t = db.prepare('SELECT * FROM jadwal_tukar WHERE id=?').get(Number(b.id) || 0);
    if (!t) return fail(res, 404, 'Penugasan tidak ditemukan.');
    if (String(t.status) !== 'diterima') return fail(res, 409, 'Penugasan ini sudah tidak aktif.');
    if (String(t.jenis || '') !== 'penugasan') return fail(res, 400, 'Hanya penugasan guru pengganti yang dapat dibatalkan dari menu ini.');
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(t.jadwal_id)) || {};
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(t.mapel_id)) || {};
    const ke = db.prepare('SELECT nama FROM users WHERE id=?').get(Number(t.ke_guru)) || {};
    const assigned = t.created_at
      ? db.prepare(`SELECT * FROM jadwal_tukar WHERE tanggal=? AND created_at=? AND dari_guru=? AND ke_guru=?
          AND jenis='penugasan' AND status='diterima'`)
        .all(t.tanggal, t.created_at, Number(t.dari_guru), Number(t.ke_guru))
      : [t];
    const detail = assigned.map(assignment => {
      const jadwalId = Number(assignment.jadwal_id);
      const absensiGuru = db.prepare('SELECT * FROM absensi_guru WHERE jadwal_id=? AND tanggal=?')
        .get(jadwalId, t.tanggal);
      const izinAsli = db.prepare('SELECT * FROM absensi_guru_izin WHERE jadwal_id=? AND tanggal=?')
        .get(jadwalId, t.tanggal);
      if (absensiGuru && Number(absensiGuru.guru_id) !== Number(assignment.ke_guru)
        && Number(absensiGuru.guru_id) !== Number(assignment.dari_guru)) {
        return { error: jadwalId };
      }
      const sesiIds = db.prepare('SELECT id FROM absensi_sesi WHERE jadwal_id=? AND tanggal=?')
        .all(jadwalId, t.tanggal).map(x => Number(x.id));
      const siswaIds = sesiIds.length
        ? db.prepare(`SELECT id FROM absensi_siswa WHERE sesi_id IN (${sesiIds.map(() => '?').join(',')})`)
          .all(...sesiIds).map(x => Number(x.id))
        : [];
      const guruAbsensiIds = absensiGuru && Number(absensiGuru.guru_id) === Number(assignment.ke_guru)
        ? [Number(absensiGuru.id)] : [];
      const uploadIds = guruAbsensiIds.length
        ? [...new Set([
          ...guruAbsensiIds.map(id => Number(absensiGuru.foto_id) || 0).filter(Boolean),
          ...db.prepare(`SELECT id FROM uploads WHERE ref_tabel='absensi_guru' AND ref_id IN (${guruAbsensiIds.map(() => '?').join(',')})`)
            .all(...guruAbsensiIds).map(x => Number(x.id))
        ])]
        : [];
      return { assignment, absensiGuru, izinAsli, sesiIds, siswaIds, guruAbsensiIds, uploadIds };
    });
    if (detail.some(x => x.error)) {
      return fail(res, 409, 'Data absensi pada sesi berubah. Muat ulang halaman sebelum membatalkan penugasan.');
    }
    let siswaDihapus = 0, sesiDihapus = 0, jurnalDihapus = 0;
    db.transaction(() => {
      for (const item of detail) {
        const assignment = item.assignment;
        db.prepare("UPDATE jadwal_tukar SET status='batal', catatan_putus=?, diputus_at=?, diputus_oleh=?, diputus_nama=?, updated_at=? WHERE id=?")
          .run('Dibatalkan oleh ' + (user.nama || 'sekolah'), dbm.now(), Number(user.id), user.nama || '', dbm.now(), Number(assignment.id));
        if (item.siswaIds.length) {
          const ph = item.siswaIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM kejadian WHERE sumber='absensi' AND ref_id IN (${ph})`).run(...item.siswaIds);
          siswaDihapus += db.prepare(`DELETE FROM absensi_siswa WHERE id IN (${ph})`).run(...item.siswaIds).changes;
        }
        if (item.sesiIds.length) {
          const ph = item.sesiIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM absensi_pencatat WHERE sesi_id IN (${ph})`).run(...item.sesiIds);
          sesiDihapus += db.prepare(`DELETE FROM absensi_sesi WHERE id IN (${ph})`).run(...item.sesiIds).changes;
        }
        for (const guruAbsensiId of item.guruAbsensiIds) {
          const guruAbsensi = db.prepare('SELECT materi FROM absensi_guru WHERE id=?').get(guruAbsensiId);
          if (guruAbsensi && String(guruAbsensi.materi || '').trim()) jurnalDihapus++;
          db.prepare('DELETE FROM absensi_guru WHERE id=?').run(guruAbsensiId);
        }
        if (item.uploadIds.length) dbm.uploadDelete(item.uploadIds);
        if (item.izinAsli) {
          const ada = db.prepare('SELECT id FROM absensi_guru WHERE jadwal_id=? AND tanggal=?')
            .get(Number(assignment.jadwal_id), t.tanggal);
          if (!ada) {
            db.prepare(`INSERT OR IGNORE INTO absensi_guru(jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,foto_url,foto_id,waktu_submit,ip,validasi,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`)
              .run(Number(assignment.jadwal_id), item.izinAsli.tanggal, Number(item.izinAsli.guru_id),
                Number(item.izinAsli.ta_id) || 0, item.izinAsli.status, item.izinAsli.materi || '',
                item.izinAsli.catatan || '', item.izinAsli.foto_url || null, item.izinAsli.waktu_submit || '',
                item.izinAsli.ip || '', item.izinAsli.validasi || '', item.izinAsli.created_at || dbm.now(), dbm.now());
          }
          db.prepare('DELETE FROM absensi_guru_izin WHERE id=?').run(Number(item.izinAsli.id));
        }
      }
    })();
    dbm.logAudit(user, 'UBAH', 'jadwal',
      `Batalkan penunjukan guru pengganti ${mapel.nama || 'mapel'} sesi ${row.sesi || '-'} (${t.tanggal}): ${ke.nama || '-'}; hapus ${siswaDihapus} presensi siswa dan ${jurnalDihapus} jurnal`, ipOf(req));
    json(res, 200, {
      ok: true, presensi_siswa_dihapus: siswaDihapus, sesi_dihapus: sesiDihapus, jurnal_dihapus: jurnalDihapus,
      pesan: `Penunjukan ${ke.nama || 'guru pengganti'} dibatalkan. Presensi siswa dan jurnal pengganti dihapus; status guru semula dipulihkan.`
    });
  });

  /** daftar guru yang sedang Sakit/Izin pada tanggal tertentu (dipakai notifikasi dashboard) */
  function guruTidakHadir(tanggal) {
    return db.prepare(`SELECT z.*, u.nama AS guru_nama FROM absensi_guru_izin z LEFT JOIN users u ON u.id=z.guru_id
      WHERE z.tanggal=? AND z.status IN ('izin','sakit')`).all(String(tanggal || dbm.today()).slice(0, 10));
  }

  /* =================================================================
     7. ABSENSI SISWA PER MATA PELAJARAN
     ================================================================= */
  const sesiBolehKelola = (user, jadwalRow, tanggal) => {
    const r = rolesOf(user);
    /* TUKAR JADWAL: pada tanggal yang sudah ditukar, sesi dikelola guru pengganti
       (guru asli tidak lagi berhak mengisi presensi sesi tersebut hari itu). */
    const tgl = String(tanggal || dbm.today()).slice(0, 10);
    const tukar = dbm.tukarAktif(jadwalRow.id, tgl);
    const guruEfektif = tukar ? Number(tukar.ke_guru) : Number(jadwalRow.guru_id);
    if (guruEfektif === Number(user.id)) return true;
    if (isAdmin(user)) return true;
    /* Wakasek/Kepala Sekolah may view wider schedules, but not operate another
       teacher's session. Wakasek roles must also be the assigned slot owner. */
    if (hanyaJadwalSendiri(user) || r.includes('kepala_sekolah')) return false;
    /* guru pengampu mapel (Data Master Mata Pelajaran) boleh mengelola sesi */
    if (!tukar && Number(jadwalRow.mapel_id)) {
      const pengampu = db.prepare('SELECT 1 FROM guru_mapel WHERE mapel_id=? AND guru_id=?')
        .get(Number(jadwalRow.mapel_id), Number(user.id));
      if (pengampu) return true;
    }
    /* wali kelas dari salah satu kelas pada slot */
    const kelasIds = dbm.jadwalKelasIds(jadwalRow);
    if (r.includes('wali_kelas') && kelasIds.length) {
      const ph = kelasIds.map(() => '?').join(',');
      const w = db.prepare(`SELECT 1 FROM kelas WHERE id IN (${ph}) AND wali_id=?`).get(...kelasIds, user.id);
      if (w) return true;
    }
    return false;
  };
  const guardAbsensiSiswaWrite = (req, res) => {
    const user = guard(req, res, 'absensi_siswa', 'view');
    if (!user) return null;
    if (dbm.can(user, 'absensi_siswa', 'write') || dbm.can(user, 'guru_pengganti', 'write')) return user;
    fail(res, 403, 'Anda tidak memiliki izin "Tambah/Ubah" pada modul ini.');
    return null;
  };
  const sesiBolehTulisPresensi = (user, jadwalRow, tanggal) => {
    const penugasan = dbm.tukarAktif(jadwalRow.id, tanggal);
    const bolehSebagaiPengganti = penugasan
      && String(penugasan.jenis || '') === 'penugasan'
      && dbm.can(user, 'guru_pengganti', 'write');
    return (dbm.can(user, 'absensi_siswa', 'write') || bolehSebagaiPengganti)
      && sesiBolehKelola(user, jadwalRow, tanggal);
  };
  const perluCheckinGuru = (user, jadwalRow, tanggal) => {
    if (isAdmin(user)) return false;
    const tukar = dbm.tukarAktif(jadwalRow.id, tanggal);
    if (tukar && String(tukar.jenis || '') === 'penugasan') return false;
    const guruEfektif = tukar ? Number(tukar.ke_guru) : Number(jadwalRow.guru_id);
    return guruEfektif === Number(user.id);
  };
  const checkinHadirGuru = (user, jadwalRow, tanggal) => {
    if (!perluCheckinGuru(user, jadwalRow, tanggal)) return true;
    const semua = dbm.jadwalRows(Number(jadwalRow.ta_id) || taOf({}))
      .filter(x => Number(x.hari) === Number(jadwalRow.hari));
    const group = kelompokJadwal(jadwalRow, semua, dbm.jadwalConfig());
    const records = db.prepare(`SELECT jadwal_id,guru_id,status FROM absensi_guru
      WHERE tanggal=? AND jadwal_id IN (${group.map(() => '?').join(',')})`)
      .all(String(tanggal).slice(0, 10), ...group.map(x => Number(x.id)));
    const bySlot = new Map(records.map(a => [Number(a.jadwal_id), a]));
    return group.every(slot => {
      const attendance = bySlot.get(Number(slot.id));
      return attendance && attendance.status === 'hadir' && Number(attendance.guru_id) === Number(user.id);
    });
  };
  const bolehBukaPresensi = (user, jadwalRow, tanggal) =>
    sesiBolehTulisPresensi(user, jadwalRow, tanggal) && checkinHadirGuru(user, jadwalRow, tanggal);

  function pastikanSesi(req, jadwalRow, tanggal, user) {
    const tgl = String(tanggal || dbm.today()).slice(0, 10);
    let s = db.prepare('SELECT * FROM absensi_sesi WHERE jadwal_id=? AND tanggal=?').get(Number(jadwalRow.id), tgl);
    if (!s) {
      const tukar = dbm.tukarAktif(jadwalRow.id, tgl);
      let token = tokenOf(req, 'ps');
      while (db.prepare('SELECT 1 FROM absensi_sesi WHERE token=?').get(token)) token = tokenOf(req, 'ps');
      const r = db.prepare(`INSERT INTO absensi_sesi(jadwal_id,tanggal,token,ta_id,mapel_id,guru_id,kelas_ids,pencatat,pencatat_role,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(Number(jadwalRow.id), tgl, token, Number(jadwalRow.ta_id) || taOf({}),
          tukar && Number(tukar.mapel_id) ? Number(tukar.mapel_id) : jadwalRow.mapel_id,
          tukar ? Number(tukar.ke_guru) : jadwalRow.guru_id,
          jadwalRow.kelas_ids, '', '', user ? user.id : null, dbm.now(), dbm.now());
      s = db.prepare('SELECT * FROM absensi_sesi WHERE id=?').get(Number(r.lastInsertRowid));
    }
    return s;
  }

  function sesiDetail(req, sesi, opts) {
    const cfg = dbm.jadwalConfig();
    const j = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(sesi.jadwal_id)) || {};
    const kelasIds = dbm.jadwalKelasIds(sesi);
    const siswa = dbm.siswaOfKelas(kelasIds);
    const nilai = db.prepare('SELECT * FROM absensi_siswa WHERE sesi_id=?').all(Number(sesi.id));
    const nilaiMap = new Map(nilai.map(v => [Number(v.siswa_id), v]));
    const sesiRow = dbm.sesiOfHari(cfg, j.hari).find(x => Number(x.idx) === Number(j.sesi)) || {};
    const tgl = String(sesi.tanggal);
    const buka = sesiRow.mulai ? dbm.jamMenit(sesiRow.mulai) - cfg.bukaMenit : 0;
    /* PENGUNCIAN WAKTU: presensi siswa ditutup tepat setelah jam pelajaran selesai
       (+ toleransi pengaturan, default 0 menit) — sama dengan absensi guru. */
    const tutup = sesiRow.selesai ? dbm.jamMenit(sesiRow.selesai) + (cfg.toleransiTutup || 0) : 0;
    const kini = dbm.nowMenit();
    const hariOk = Number(j.hari) === dbm.hariOf(tgl);
    const hariIni = tgl === dbm.today();
    /* KALENDER AKADEMIK: tanggal libur/ujian/kegiatan → KBM reguler tidak berlaku */
    const kal = dbm.kalenderOfDate(tgl);
    const kalNonaktif = !!(kal && Number(kal.nonaktif) === 1);
    const terbuka = !kalNonaktif && hariOk && hariIni && kini >= buka && kini <= tutup;
    const lewat = !!sesiRow.selesai && kini > tutup;
    const mapel = db.prepare('SELECT * FROM mapel WHERE id=?').get(Number(sesi.mapel_id)) || {};
    const guru = db.prepare('SELECT id,nama,nip FROM users WHERE id=?').get(Number(sesi.guru_id)) || {};
    const ident = dbm.allSettings();
    const terisi = nilai.length;
    /* audit trail: siapa (siswa) yang mengisi presensi ini lewat tautan publik */
    const pcat = dbm.pencatatOf(sesi.id);
    const pencatatInfo = pcat ? {
      nama: pcat.nama || '', kelas: pcat.kelas || '', role: pcat.role || 'ketua_kelas',
      siswa_id: pcat.siswa_id || null, jumlah: pcat.jumlah || 0, at: pcat.created_at || ''
    } : null;
    return {
      sesi: {
        id: sesi.id, token: sesi.token, tanggal: sesi.tanggal, jadwal_id: sesi.jadwal_id,
        pencatat: (pcat && pcat.nama) || sesi.pencatat || '',
        pencatat_role: (pcat && pcat.role) || sesi.pencatat_role || '',
        updated_at: sesi.updated_at || sesi.created_at || ''
      },
      pencatat_info: pencatatInfo,
      jadwal: { hari: Number(j.hari), hari_label: dbm.HARI_LABEL[Number(j.hari)] || '', sesi: Number(j.sesi), jam: sesiRow.mulai ? `${sesiRow.mulai}–${sesiRow.selesai}` : '', ruang: j.ruang || '' },
      mapel: { id: mapel.id, nama: mapel.nama || '', kode: mapel.kode || '' },
      guru, kelas: kelasIds.map(id => (kelasPicker().find(k => Number(k.id) === id) || { id, nama: '?' })),
      tanggal: tgl, tanggal_label: dbm.tanggalPanjang(tgl),
      sekolah: { nama: ident.sekolah_nama || '', alamat: ident.sekolah_alamat || '', logo: ident.logo || ident.app_logo || '' },
      app_nama: ident.app_nama || '',
      siswa: siswa.map((s, i) => {
        const v = nilaiMap.get(Number(s.id));
        return {
          ...s, no: i + 1,
          status: v ? v.status : 'H',
          keterangan: v ? (v.keterangan || '') : '',
          terisi: !!v
        };
      }),
      status_list: dbm.ABSENSI_SISWA_STATUS,
      window: {
        terbuka, hari_ok: hariOk, hari_ini: hariIni, lewat,
        buka: dbm.menitJam(buka), tutup: dbm.menitJam(tutup),
        selesai: sesiRow.selesai || '', terkunci: lewat || kalNonaktif,
        nonaktif: kalNonaktif,
        kalender: kal ? { kategori: kal.kategori, label: dbm.KALENDER_KATEGORI_LABEL[kal.kategori] || '', judul: kal.judul || '', keterangan: kal.keterangan || '' } : null,
        sekarang: dbm.menitJam(kini),
        keterangan: kalNonaktif
          ? `KBM tidak berlaku pada tanggal ini — ${dbm.KALENDER_KATEGORI_LABEL[kal.kategori] || 'agenda sekolah'}${kal.judul ? ': ' + kal.judul : ''}.`
          : lewat
            ? `Sesi presensi sudah DITUTUP — jam pelajaran ${sesiRow.mulai || ''}–${sesiRow.selesai || ''} telah berakhir${cfg.toleransiTutup ? ` (+ toleransi ${cfg.toleransiTutup} menit)` : ''}.`
            : (terbuka ? '' : (hariIni ? `Presensi dibuka ${dbm.menitJam(buka)}–${dbm.menitJam(tutup)}.` : 'Presensi hanya dapat diisi pada hari pelajaran tersebut.'))
      },
      kbm_libur: kalNonaktif,
      siswa_aktif: cfg.siswaAktif,
      terisi, total: siswa.length,
      auth: !!(opts && opts.auth)
    };
  }

  async function qrUntuk(req, sesi) {
    const url = absUrl(req, `/presensi/${sesi.token}`);
    const q = await qrPair(url);
    return { url, svg: q.svg, png: q.png };
  }

  get('/api/absensi-siswa', (req, res, q) => {
    const user = guard(req, res, 'absensi_siswa', 'view'); if (!user) return;
    const taId = taOf(q);
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    const hari = dbm.hariOf(tanggal);
    const cfg = dbm.jadwalConfig();
    const lihatSemua = lihatSemuaJadwalAbsensi(user);
    /* SINKRONISASI: slot hari ini bisa berada pada TA lain (jadwal disusun untuk TA
       berikutnya) — pakai TA yang benar-benar memiliki slot pada hari tersebut. */
    let semua = dbm.jadwalRows(taId).filter(r => Number(r.hari) === hari);
    let taPakai = taId;
    if (!semua.length) {
      for (const id of semuaTaIds()) {
        if (Number(id) === Number(taId)) continue;
        const coba = dbm.jadwalRows(id).filter(r => Number(r.hari) === hari);
        if (coba.length) { semua = coba; taPakai = Number(id); break; }
      }
    }
    /* guru juga melihat slot ketika ia terdaftar sebagai pengampu mapel (guru_mapel)
       ATAU ketika ia menjadi guru pengganti hasil TUKAR JADWAL pada tanggal ini */
    const mapelDiampu = new Set(db.prepare('SELECT mapel_id FROM guru_mapel WHERE guru_id=?')
      .all(Number(user.id)).map(r => Number(r.mapel_id)));
    const tukarHari = dbm.tukarMap(tanggal);
    const sesiRows = db.prepare('SELECT * FROM absensi_sesi WHERE tanggal=?').all(tanggal);
    const sesiMap = new Map(sesiRows.map(s => [Number(s.jadwal_id), s]));
    const hitung = new Map();
    if (sesiRows.length) {
      const ph = sesiRows.map(() => '?').join(',');
      for (const r of db.prepare(`SELECT sesi_id, status, COUNT(*) c FROM absensi_siswa WHERE sesi_id IN (${ph}) GROUP BY sesi_id, status`).all(...sesiRows.map(s => s.id))) {
        const o = hitung.get(Number(r.sesi_id)) || {};
        o[r.status] = Number(r.c);
        hitung.set(Number(r.sesi_id), o);
      }
    }
    const daftar = semua
      .filter(r => {
        if (lihatSemua) return true;
        const t = tukarHari.get(Number(r.id));
        const guruEfektif = t ? Number(t.ke_guru) : Number(r.guru_id);
        if (guruEfektif === Number(user.id)) return true;
        if (hanyaJadwalSendiri(user)) return false;
        /* slot hasil tukar bukan lagi milik guru asli */
        return !t && mapelDiampu.has(Number(r.mapel_id));
      })
      .map(r => {
        const s = sesiMap.get(Number(r.id));
        const w = dbm.absensiWindow(r, tanggal, cfg);
        const h = s ? (hitung.get(Number(s.id)) || {}) : {};
        const t = tukarHari.get(Number(r.id)) || null;
        const mapelAktif = mapelEfektif(r, t);
        return {
          ...r, ...mapelAktif, jam: w.sesi ? `${w.sesi.mulai}–${w.sesi.selesai}` : '',
          guru_efektif_id: t ? Number(t.ke_guru) : Number(r.guru_id),
          guru_pengganti: t ? t.ke_nama : '',
          tukar: t ? { id: t.id, dari_nama: t.dari_nama, ke_nama: t.ke_nama, alasan: t.alasan || '' } : null,
          sesi_id: s ? s.id : null, token: s ? s.token : '', pencatat: s ? s.pencatat : '',
          terisi: Object.values(h).reduce((a, b) => a + b, 0),
          hadir: h.H || 0, alpa: (h.A || 0) + (h.B || 0),
          window: { aktif: w.aktif, alasan: w.alasan },
          butuh_checkin: perluCheckinGuru(user, r, tanggal) && !checkinHadirGuru(user, r, tanggal),
          checkin_hadir: checkinHadirGuru(user, r, tanggal),
          bisa: bolehBukaPresensi(user, r, tanggal)
        };
      });
    json(res, 200, {
      ok: true, tanggal, tanggal_label: dbm.tanggalPanjang(tanggal), hari, hari_label: dbm.HARI_LABEL,
      kbm_libur: dbm.kalenderNonaktif(tanggal),
      kalender: (() => {
        const k = dbm.kalenderOfDate(tanggal);
        return k ? { id: k.id, kategori: k.kategori, label: dbm.KALENDER_KATEGORI_LABEL[k.kategori] || '', judul: k.judul || '', keterangan: k.keterangan || '', nonaktif: Number(k.nonaktif) } : null;
      })(),
      lihat_semua: lihatSemua, config: { siswa_aktif: cfg.siswaAktif ? 1 : 0, siswa_tutup_menit: cfg.siswaTutupMenit },
      jadwal: daftar, status_list: dbm.ABSENSI_SISWA_STATUS,
      mapel: dbm.mapelList(), kelas: kelasPicker(),
      poin: dbm.absensiPoinConfig()
    });
  });

  /* buat/buka sesi presensi + QR (guru) */
  post('/api/absensi-siswa/sesi', async (req, res) => {
    const user = guardAbsensiSiswaWrite(req, res); if (!user) return;
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(b.jadwal_id) || 0);
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
    if (!sesiBolehTulisPresensi(user, row, tanggal)) return fail(res, 403, 'Anda bukan guru pengampu / wali kelas pada slot jadwal ini.');
    if (!checkinHadirGuru(user, row, tanggal)) {
      return fail(res, 403, 'Lakukan Check-in Hadir pada Absensi Guru terlebih dahulu sebelum membuka presensi siswa.');
    }
    if (tanggal !== dbm.today()) return fail(res, 403, 'Sesi presensi hanya dapat dibuat pada hari jadwal berlangsung.');
    if (Number(row.hari) !== dbm.hariOf(tanggal)) return fail(res, 403, 'Slot jadwal ini bukan untuk hari ini.');
    if (dbm.kalenderNonaktif(tanggal)) {
      const kal = dbm.kalenderOfDate(tanggal) || {};
      return fail(res, 403, `KBM tidak berlaku pada tanggal ini — ${dbm.KALENDER_KATEGORI_LABEL[kal.kategori] || 'agenda sekolah'}${kal.judul ? ': ' + kal.judul : ''}. Sesi presensi tidak dibuka.`);
    }
    const wSesi = dbm.absensiWindow(row, tanggal, dbm.jadwalConfig());
    if (wSesi.sesi && dbm.nowMenit() > dbm.jamMenit(wSesi.tutup)) {
      return fail(res, 403, `Sesi presensi sudah DITUTUP — ${wSesi.alasan}`, { terkunci: true });
    }
    const sesi = pastikanSesi(req, row, tanggal, user);
    const detail = sesiDetail(req, sesi, { auth: true });
    const q = await qrUntuk(req, sesi);
    json(res, 200, {
      ok: true, ...detail, qr: q,
      bisa_simpan: detail.window.terbuka && bolehBukaPresensi(user, row, tanggal)
    });
  });

  /* detail sesi (guru) */
  get('/api/absensi-siswa/sesi', (req, res, q) => {
    const user = guard(req, res, 'absensi_siswa', 'view'); if (!user) return;
    let sesi = null;
    if (q.token) sesi = db.prepare('SELECT * FROM absensi_sesi WHERE token=?').get(String(q.token));
    else if (q.id) sesi = db.prepare('SELECT * FROM absensi_sesi WHERE id=?').get(Number(q.id));
    else if (q.jadwal_id) sesi = db.prepare('SELECT * FROM absensi_sesi WHERE jadwal_id=? AND tanggal=?')
      .get(Number(q.jadwal_id), /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today());
    if (!sesi) return fail(res, 404, 'Sesi presensi belum dibuat untuk slot ini.');
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(sesi.jadwal_id));
    if (!row) return fail(res, 404, 'Slot jadwal tidak ditemukan.');
    if (!sesiBolehKelola(user, row, sesi.tanggal)) return fail(res, 403, 'Anda tidak berhak membuka sesi presensi kelas ini.');
    if (!checkinHadirGuru(user, row, sesi.tanggal)) {
      return fail(res, 403, 'Lakukan Check-in Hadir pada Absensi Guru terlebih dahulu sebelum membuka presensi siswa.');
    }
    (async () => {
      const detail = sesiDetail(req, sesi, { auth: true });
      const qrData = await qrUntuk(req, sesi);
      json(res, 200, { ok: true, ...detail, qr: qrData, bisa_simpan: detail.window.terbuka && bolehBukaPresensi(user, row, sesi.tanggal) });
    })().catch(e => fail(res, 500, e.message));
  });

  /* simpan presensi oleh guru/wali kelas/admin */
  post('/api/absensi-siswa/simpan', async (req, res) => {
    const user = guardAbsensiSiswaWrite(req, res); if (!user) return;
    const b = await readBody(req);
    const sesi = db.prepare('SELECT * FROM absensi_sesi WHERE id=?').get(Number(b.sesi_id) || 0);
    if (!sesi) return fail(res, 404, 'Sesi presensi tidak ditemukan.');
    const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(sesi.jadwal_id));
    if (!row || !sesiBolehTulisPresensi(user, row, sesi.tanggal)) return fail(res, 403, 'Anda tidak berhak mengisi presensi kelas ini.');
    if (!checkinHadirGuru(user, row, sesi.tanggal)) {
      return fail(res, 403, 'Lakukan Check-in Hadir pada Absensi Guru terlebih dahulu sebelum mengisi presensi siswa.');
    }
    const detail = sesiDetail(req, sesi, { auth: true });
    /* TIME-LOCKING: presensi tidak dapat diubah setelah jam pelajaran selesai. */
    if (!detail.window.terbuka) {
      return fail(res, 403, detail.window.keterangan || 'Sesi presensi sudah ditutup — data tidak dapat diubah lagi.', { terkunci: true });
    }
    const hasil = simpanPresensi(sesi, b.items, user.nama, dbm.roleLabelOf(user), user.id);
    if (hasil.duplikat_harian) {
      return fail(res, 409, hasil.error, { duplikat_harian: hasil.duplikat_harian });
    }
    const penugasan = dbm.tukarAktif(row.id, sesi.tanggal);
    if (penugasan && String(penugasan.jenis || '') === 'penugasan'
      && Number(penugasan.ke_guru) === Number(user.id)) {
      const semua = dbm.jadwalRows(Number(row.ta_id) || taOf({}))
        .filter(x => Number(x.hari) === Number(row.hari));
      const group = kelompokJadwal(row, semua, dbm.jadwalConfig());
      const seluruhSlotDitugaskan = group.every(x => {
        const t = dbm.tukarAktif(x.id, sesi.tanggal);
        return t && String(t.jenis || '') === 'penugasan' && Number(t.ke_guru) === Number(user.id);
      });
      const presensiLengkap = group.every(x => dbm.absensiAlur(x.id, sesi.tanggal).absensi_siswa.lengkap);
      if (seluruhSlotDitugaskan && presensiLengkap) {
        const waktu = dbm.now();
        const validasi = JSON.stringify({ sumber: 'penugasan_absensi_siswa', jadwal_ids: group.map(x => Number(x.id)) });
        const catatHadir = db.prepare(`INSERT OR IGNORE INTO absensi_guru
          (jadwal_id,tanggal,guru_id,ta_id,status,materi,catatan,waktu_submit,ip,validasi,created_at,updated_at)
          VALUES(?,?,?,?,'hadir','','',?,?,?, ?,?)`);
        db.transaction(() => {
          for (const x of group) {
            catatHadir.run(Number(x.id), sesi.tanggal, Number(user.id), Number(x.ta_id) || Number(row.ta_id) || 0,
              dbm.now(), ipOf(req), validasi, waktu, waktu);
          }
        })();
      }
    }
    dbm.logAudit(user, 'UBAH', 'absensi_siswa',
      `Presensi ${detail.mapel.nama} ${detail.kelas.map(k => k.nama).join(', ')} (${sesi.tanggal}): ${hasil.tersimpan} siswa`, ipOf(req));
    /* NOTIFIKASI ORANG TUA (latar belakang): siswa berstatus Alpha/Bolos */
    kirimWaAlfa(sesi).catch(() => { });
    json(res, 200, { ok: true, ...hasil, pesan: `Presensi tersimpan (${hasil.tersimpan} siswa).` });
  });

  /* =================================================================
     NOTIFIKASI WHATSAPP OTOMATIS (Fonnte / gateway generik)
     ---------------------------------------------------------------------
     · Alfa & Bolos  → pesan ke nomor orang tua/wali siswa (per sesi, dedupe)
     · Sakit / Izin guru → pesan ke Kepala Sekolah & Wakasek Kurikulum
     Dikirim di latar belakang (tidak memblokir respons HTTP).
     ================================================================= */
  function kelasNamaOf(ids) {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
    if (!list.length) return '';
    return db.prepare(`SELECT nama FROM kelas WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY urut, nama`)
      .all(...list).map(k => k.nama).join(' + ');
  }
  /** kirim notifikasi ketidakhadiran (A/B) ke orang tua — dipanggil setelah presensi disimpan */
  async function kirimWaAlfa(sesi) {
    const cfg = dbm.waConfig();
    if (!cfg.alfaAktif) return { skip: 'nonaktif' };
    const sesiId = Number(sesi && sesi.id) || 0;
    if (!sesiId) return { skip: 'tanpa-sesi' };
    const jadwal = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(sesi.jadwal_id)) || {};
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(sesi.mapel_id || jadwal.mapel_id)) || {};
    const cfgJ = dbm.jadwalConfig();
    const sesiRow = dbm.sesiOfHari(cfgJ, jadwal.hari).find(x => Number(x.idx) === Number(jadwal.sesi)) || {};
    const kelasNama = kelasNamaOf(dbm.jadwalKelasIds(sesi));
    const st = dbm.allSettings();
    const tpl = dbm.waTemplateAlfa();
    const baris = db.prepare(`SELECT a.siswa_id, a.status, a.keterangan, s.nama, COALESCE(s.parent_phone,'') AS phone
      FROM absensi_siswa a JOIN siswa s ON s.id=a.siswa_id
      WHERE a.sesi_id=? AND a.status IN ('A','B')`).all(sesiId);
    const hasil = { total: baris.length, terkirim: 0, manual: 0, gagal: 0, dilewati: 0, tanpa_nomor: 0 };
    for (const b of baris) {
      if (!b.phone) { hasil.tanpa_nomor++; continue; }
      const ref = `alfa:${sesiId}`;
      if (dbm.waSudahKirim(ref, b.siswa_id)) { hasil.dilewati++; continue; }
      const pesan = dbm.waFill(tpl, {
        nama: b.nama, kelas: kelasNama, status: b.status === 'B' ? 'Bolos' : 'Alpha',
        mapel: mapel.nama || '-', jam: sesiRow.mulai ? `${sesiRow.mulai}–${sesiRow.selesai}` : '-',
        tanggal: dbm.tanggalPanjang(sesi.tanggal), keterangan: b.keterangan || '-',
        sekolah: st.sekolah_nama || '', guru: jadwal.guru_id ? ((db.prepare('SELECT nama FROM users WHERE id=?').get(Number(jadwal.guru_id)) || {}).nama || '') : ''
      });
      const r = await dbm.waSend(b.phone, pesan);
      hasil[r.status === 'terkirim' ? 'terkirim' : r.status === 'manual' ? 'manual' : 'gagal']++;
      dbm.waLogAdd({
        siswaId: b.siswa_id, nama: b.nama, phone: b.phone, jenis: 'alfa-siswa', pesan,
        status: r.status, sumber: cfg.provider === 'fonnte' ? 'fonnte' : 'gateway', error: r.error || '',
        taId: Number(sesi.ta_id) || 0, ref, modul: 'absensi_siswa'
      });
    }
    return hasil;
  }
  /** beri tahu Kepala Sekolah & Wakasek Kurikulum saat guru Sakit/Izin */
  async function kirimWaIzinGuru(row, tanggal, status, catatan, user) {
    const cfg = dbm.waConfig();
    if (!cfg.izinAktif) return { skip: 'nonaktif' };
    const jadwalId = Number(row && row.id) || 0;
    const ref = `izin:${jadwalId}:${tanggal}`;
    const nomor = [...new Set([String(dbm.getSetting('kepsek_wa', '') || ''), String(dbm.getSetting('wakasek_kur_wa', '') || '')].filter(Boolean))];
    if (!nomor.length) return { skip: 'tanpa-nomor' };
    if (dbm.waSudahKirim(ref, 0)) return { skip: 'sudah' };
    const mapel = db.prepare('SELECT nama FROM mapel WHERE id=?').get(Number(row.mapel_id)) || {};
    const guru = db.prepare('SELECT nama FROM users WHERE id=?').get(Number(user && user.id) || Number(row.guru_id)) || {};
    const cfgJ = dbm.jadwalConfig();
    const sesiRow = dbm.sesiOfHari(cfgJ, row.hari).find(x => Number(x.idx) === Number(row.sesi)) || {};
    const st = dbm.allSettings();
    const pesan = dbm.waFill(dbm.waTemplateIzin(), {
      guru: guru.nama || '-', status: status === 'sakit' ? 'Sakit' : 'Izin',
      tanggal: dbm.tanggalPanjang(tanggal), jam: sesiRow.mulai ? `${sesiRow.mulai}–${sesiRow.selesai}` : '-',
      mapel: mapel.nama || '-', kelas: kelasNamaOf(dbm.jadwalKelasIds(row)) || '-',
      alasan: catatan || '-', sekolah: st.sekolah_nama || ''
    });
    const hasil = { nomor: nomor.length, terkirim: 0, manual: 0, gagal: 0 };
    for (const n of nomor) {
      const r = await dbm.waSend(n, pesan);
      hasil[r.status === 'terkirim' ? 'terkirim' : r.status === 'manual' ? 'manual' : 'gagal']++;
      dbm.waLogAdd({
        nama: guru.nama || '', phone: n, jenis: 'izin-guru', pesan, status: r.status,
        sumber: cfg.provider === 'fonnte' ? 'fonnte' : 'gateway', error: r.error || '',
        oleh: user ? user.id : null, olehNama: user ? user.nama : '', ref, modul: 'absensi_guru'
      });
    }
    return hasil;
  }
  function validasiAlfaBolosHarian(sesi, items, siswaSah) {
    const siswaIds = [...new Set((Array.isArray(items) ? items : [])
      .filter(it => ['A', 'B'].includes(String(it && it.status)))
      .map(it => Number(it && it.siswa_id))
      .filter(id => id && siswaSah.has(id)))];
    if (!siswaIds.length) return [];
    const marks = siswaIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT a.siswa_id, a.status, s.nama, m.nama AS mapel
      FROM absensi_siswa a
      LEFT JOIN siswa s ON s.id=a.siswa_id
      LEFT JOIN absensi_sesi sesi_lain ON sesi_lain.id=a.sesi_id
      LEFT JOIN jadwal j ON j.id=a.jadwal_id
      LEFT JOIN mapel m ON m.id=COALESCE(sesi_lain.mapel_id, j.mapel_id)
      WHERE a.tanggal=? AND COALESCE(a.sesi_id,0)<>? AND a.siswa_id IN (${marks})
        AND a.status IN ('A','B')
      ORDER BY a.id`).all(sesi.tanggal, Number(sesi.id), ...siswaIds);
    const sudahAda = new Set();
    return rows.filter(r => {
      const id = Number(r.siswa_id);
      if (sudahAda.has(id)) return false;
      sudahAda.add(id);
      return true;
    }).map(r => ({
      siswa_id: Number(r.siswa_id),
      nama: r.nama || `Siswa #${r.siswa_id}`,
      status: r.status,
      mapel: r.mapel || ''
    }));
  }
  function simpanPresensi(sesi, items, pencatat, pencatatRole, userId) {
    const list = Array.isArray(items) ? items : [];
    const kelasIds = dbm.jadwalKelasIds(sesi);
    const sah = new Set(dbm.siswaOfKelas(kelasIds).map(s => Number(s.id)));
    const duplikatHarian = validasiAlfaBolosHarian(sesi, list, sah);
    if (duplikatHarian.length) {
      return {
        duplikat_harian: duplikatHarian,
        error: 'Siswa sudah tercatat Alfa atau Bolos pada mata pelajaran lain di tanggal yang sama.'
      };
    }
    const valid = new Set(dbm.ABSENSI_SISWA_STATUS.map(s => s.key));
    let tersimpan = 0, dilewati = 0;
    db.transaction(() => {
      for (const it of list) {
        const sid = Number(it && it.siswa_id);
        if (!sid || !sah.has(sid)) { dilewati++; continue; }
        const status = valid.has(String(it.status)) ? String(it.status) : 'H';
        const ket = String(it.keterangan || '').slice(0, 240);
        const ada = db.prepare('SELECT id FROM absensi_siswa WHERE sesi_id=? AND siswa_id=?').get(Number(sesi.id), sid);
        if (ada) {
          db.prepare('UPDATE absensi_siswa SET status=?,keterangan=?,oleh_nama=?,oleh_role=?,oleh_id=?,updated_at=? WHERE id=?')
            .run(status, ket, pencatat || '', pencatatRole || '', userId || null, dbm.now(), ada.id);
        } else {
          const s = db.prepare('SELECT kelas_id FROM siswa WHERE id=?').get(sid) || {};
          db.prepare(`INSERT INTO absensi_siswa(sesi_id,jadwal_id,tanggal,siswa_id,kelas_id,status,keterangan,oleh_nama,oleh_role,oleh_id,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(Number(sesi.id), Number(sesi.jadwal_id), sesi.tanggal, sid, s.kelas_id || null, status, ket,
              pencatat || '', pencatatRole || '', userId || null, dbm.now(), dbm.now());
        }
        tersimpan++;
      }
      db.prepare('UPDATE absensi_sesi SET pencatat=?,pencatat_role=?,updated_at=? WHERE id=?')
        .run(pencatat || '', pencatatRole || '', dbm.now(), Number(sesi.id));
    })();
    const ringkas = db.prepare(`SELECT status, COUNT(*) c FROM absensi_siswa WHERE sesi_id=? GROUP BY status`).all(Number(sesi.id));
    const map = {};
    for (const r of ringkas) map[r.status] = Number(r.c);
    /* OTOMATISASI POIN: status Alpha/Bolos langsung tercatat di Buku Poin siswa
       (bobot poin diambil dari Master Kategori Poin, kategori otomatis). */
    let poin = { dibuat: 0, diperbarui: 0, dihapus: 0 };
    try { poin = dbm.absensiPoinSync(sesi, pencatat, pencatatRole, userId); }
    catch (e) { console.error('[absensi-poin]', e.message); }
    return { tersimpan, dilewati, ringkas: map, poin };
  }

  /* rekap absensi siswa (per kelas/mapel/tanggal) */
  get('/api/absensi-siswa/rekap', (req, res, q) => {
    const user = guard(req, res, 'absensi_siswa', 'view'); if (!user) return;
    const taId = taOf(q);
    const dari = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dari || '')) ? String(q.dari) : dbm.today();
    const sampai = /^\d{4}-\d{2}-\d{2}$/.test(String(q.sampai || '')) ? String(q.sampai) : dari;
    const kelasId = Number(q.kelas) || 0;
    const mapelId = Number(q.mapel) || 0;
    const awal = dari < sampai ? dari : sampai;
    const akhir = dari < sampai ? sampai : dari;
    /* `s` = absensi_sesi menyimpan kelas jamak (kelas_ids JSON) — kelas siswa ada di
       `a.kelas_id` (absensi_siswa) atau `sd.kelas_id` (master siswa). */
    const where = ['a.tanggal BETWEEN ? AND ?', 'COALESCE(j.ta_id,s.ta_id)=?'];
    const args = [awal, akhir, taId];
    if (kelasId) { where.push('COALESCE(a.kelas_id, sd.kelas_id) = ?'); args.push(kelasId); }
    if (mapelId) { where.push('COALESCE(s.mapel_id, j.mapel_id) = ?'); args.push(mapelId); }
    const rows = db.prepare(`SELECT a.tanggal, a.siswa_id, a.status, a.keterangan, a.oleh_nama, sd.nama,
        k.nama AS kelas_nama, m.nama AS mapel_nama, j.sesi, a.kelas_id
      FROM absensi_siswa a
      LEFT JOIN absensi_sesi s ON s.id=a.sesi_id
      LEFT JOIN jadwal j ON j.id=s.jadwal_id
      LEFT JOIN mapel m ON m.id=COALESCE(s.mapel_id,j.mapel_id)
      LEFT JOIN siswa sd ON sd.id=a.siswa_id
      LEFT JOIN kelas k ON k.id=COALESCE(a.kelas_id, sd.kelas_id)
      WHERE ${where.join(' AND ')} ORDER BY a.tanggal, j.sesi, sd.nama LIMIT 4000`).all(...args);
    const perSiswa = new Map();
    for (const r of rows) {
      const key = `${r.siswa_id}`;
      const o = perSiswa.get(key) || { siswa_id: r.siswa_id, nama: r.nama, kelas_nama: r.kelas_nama, H: 0, S: 0, I: 0, A: 0, B: 0, sesi: 0 };
      o[r.status] = (o[r.status] || 0) + 1;
      o.sesi++;
      perSiswa.set(key, o);
    }
    const total = { H: 0, S: 0, I: 0, A: 0, B: 0 };
    for (const r of rows) total[r.status] = (total[r.status] || 0) + 1;
    json(res, 200, {
      ok: true, dari, sampai, rows: rows.slice(0, 600),
      per_siswa: [...perSiswa.values()].sort((a, b) => String(a.nama).localeCompare(String(b.nama))),
      total, jumlah: rows.length,
      kelas: kelasPicker(), mapel: dbm.mapelList(), status_list: dbm.ABSENSI_SISWA_STATUS,
      sesi_list: db.prepare('SELECT * FROM absensi_sesi WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal DESC')
        .all(dari < sampai ? dari : sampai, dari < sampai ? sampai : dari).slice(0, 100)
    });
  });

  /* ---------- API PUBLIK presensi siswa (via tautan/QR ketua kelas) ---------- */
  get('/api/public/presensi/:token', (req, res, q, params) => {
    const found = dbm.absensiSesiByToken(params.token);
    if (!found) return fail(res, 404, 'Tautan presensi tidak ditemukan atau sudah tidak berlaku.');
    const cfg = dbm.jadwalConfig();
    if (!cfg.siswaAktif) return fail(res, 403, 'Pengisian presensi oleh ketua kelas sedang dinonaktifkan sekolah.');
    const detail = sesiDetail(req, found.sesi, { auth: false });
    json(res, 200, { ok: true, ...detail, bisa_simpan: detail.window.terbuka });
  });

  post('/api/public/presensi/:token', async (req, res, q, params) => {
    const found = dbm.absensiSesiByToken(params.token);
    if (!found) return fail(res, 404, 'Tautan presensi tidak ditemukan atau sudah tidak berlaku.');
    const cfg = dbm.jadwalConfig();
    if (!cfg.siswaAktif) return fail(res, 403, 'Pengisian presensi oleh ketua kelas sedang dinonaktifkan sekolah.');
    const detail = sesiDetail(req, found.sesi, { auth: false });
    if (!detail.window.terbuka) {
      if (detail.window.nonaktif) return fail(res, 403, detail.window.keterangan);
      return fail(res, 403, `Presensi hanya dapat diisi pada jam pelajaran berlangsung (${detail.window.buka}–${detail.window.tutup}).`);
    }
    const b = await readBody(req);
    const pencatat = String(b.pencatat || '').trim();
    if (pencatat.length < 3) return fail(res, 400, 'Nama pencatat wajib diisi (minimal 3 karakter).');
    /* VERIFIKASI NAMA: pencatat (ketua kelas) wajib menuliskan namanya dan nama itu
       harus terdaftar sebagai siswa pada kelas sesi ini. */
    const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const cari = norm(pencatat);
    const cocok = (detail.siswa || []).find(s => {
      const n = norm(s.nama);
      return n === cari || (cari.length >= 3 && (n.includes(cari) || cari.includes(n)));
    });
    if (!cocok) {
      return fail(res, 400, `Nama "${pencatat}" tidak terdaftar pada kelas ${(detail.kelas || []).map(k => k.nama).join(', ')}. Tuliskan nama lengkap Anda sebagai pencatat.`);
    }
    /* BATAS 1x PENGISIAN: satu siswa hanya boleh submit satu kali per sesi.
       Pengaman berdasarkan identitas siswa (sidik nama → data siswa kelas). */
    if (Number(cocok.id) && dbm.pencatatSudah(found.sesi.id, Number(cocok.id))) {
      return fail(res, 409,
        `Presensi sesi ini sudah pernah Anda isi (${pencatat}). Satu siswa hanya dapat mengisi satu kali per sesi mata pelajaran. ` +
        'Bila perlu koreksi, hubungi guru mata pelajaran.', { sudah_mengisi: true });
    }
    const hasil = simpanPresensi(found.sesi, b.items, pencatat, 'ketua_kelas', Number(cocok.id) || null);
    if (hasil.duplikat_harian) {
      return fail(res, 409, hasil.error, { duplikat_harian: hasil.duplikat_harian });
    }
    const kelasNama = (detail.kelas || []).map(k => k.nama).join(', ');
    try {
      dbm.pencatatAdd({
        sesiId: found.sesi.id, jadwalId: found.sesi.jadwal_id, tanggal: found.sesi.tanggal,
        siswaId: Number(cocok.id) || 0, nama: pencatat, kelas: kelasNama,
        role: 'ketua_kelas', jumlah: hasil.tersimpan, ip: ipOf(req)
      });
    } catch (e) { /* pencatat opsional */ }
    try {
      db.prepare('INSERT INTO audit(user_id,nama,role,aksi,modul,detail,ip,created_at) VALUES(NULL,?,?,?,?,?,?,?)')
        .run(pencatat, 'ketua_kelas', 'PRESENSI', 'absensi_siswa',
          `Presensi publik ${detail.mapel.nama} ${kelasNama} (${found.sesi.tanggal}): ${hasil.tersimpan} siswa — diisi oleh ${pencatat}`,
          ipOf(req), dbm.now());
    } catch (e) { /* audit opsional */ }
    kirimWaAlfa(found.sesi).catch(() => { });
    json(res, 200, {
      ...hasil, ok: true,
      pencatat_info: { nama: pencatat, kelas: kelasNama, role: 'ketua_kelas', siswa_id: Number(cocok.id) || null, jumlah: hasil.tersimpan },
      pesan: `Presensi tersimpan (${hasil.tersimpan} siswa). Terima kasih, ${pencatat}.`
    });
  });

  /* =================================================================
     7a. DUPLIKAT SLOT JADWAL (tombol "Duplikat" pada kartu slot)
     ---------------------------------------------------------------------
     Menyalin satu slot (mapel, guru, kelas, ruang, catatan) ke sesi
     berikutnya pada hari yang sama — atau ke hari/sesi yang diminta.
     Validasi bentrok memakai aturan yang sama dengan penyimpanan slot.
     ================================================================= */
  post('/api/jadwal/duplikat', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const src = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(b.id) || 0);
    if (!src) return fail(res, 404, 'Slot jadwal yang akan diduplikasi tidak ditemukan.');
    const cfg = dbm.jadwalConfig();
    const hariTujuan = b.hari === undefined || b.hari === null || b.hari === ''
      ? Number(src.hari) : Number(b.hari);
    if (!Number.isInteger(hariTujuan) || hariTujuan < 0 || hariTujuan > 6) return fail(res, 400, 'Hari tujuan tidak valid.');
    const daftarSesi = dbm.sesiOfHari(cfg, hariTujuan);
    /* default: sesi berikutnya (bukan istirahat) pada hari tujuan */
    let sesiTujuan;
    if (b.sesi === undefined || b.sesi === null || b.sesi === '') {
      const posisi = daftarSesi.findIndex(x => Number(x.idx) === Number(src.sesi));
      const sisa = posisi >= 0 ? daftarSesi.slice(posisi + 1) : daftarSesi;
      const berikut = sisa.find(x => !x.istirahat);
      if (!berikut) {
        return fail(res, 400, 'Tidak ada sesi berikutnya pada hari itu. Pilih hari/sesi tujuan secara manual.');
      }
      sesiTujuan = Number(berikut.idx);
    } else sesiTujuan = Number(b.sesi);
    if (!daftarSesi.some(x => Number(x.idx) === sesiTujuan)) return fail(res, 400, 'Sesi tujuan tidak ada pada hari itu.');
    const sesiRow = daftarSesi.find(x => Number(x.idx) === sesiTujuan);
    if (sesiRow && sesiRow.istirahat) return fail(res, 400, `Sesi "${sesiRow.label}" adalah waktu istirahat — tidak dapat diisi pelajaran.`);
    const kelasIds = dbm.jadwalKelasIds(src);
    const konflik = dbm.jadwalConflict({
      taId: Number(src.ta_id) || taOf(b), hari: hariTujuan, sesi: sesiTujuan,
      kelas_ids: kelasIds, guru_id: Number(src.guru_id) || 0,
      mapel_id: Number(src.mapel_id) || 0, ruang: src.ruang || '', exceptId: 0, cfg
    });
    const hard = konflik.hard || [];
    if (hard.length) return fail(res, 409, `Tidak dapat diduplikasi — ${hard[0].pesan}`, { konflik: hard, jenis: 'bentrok' });
    const r = db.prepare(`INSERT INTO jadwal(ta_id,hari,sesi,mapel_id,guru_id,kelas_ids,ruang,merged,catatan,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(Number(src.ta_id) || taOf(b), hariTujuan, sesiTujuan, src.mapel_id, src.guru_id,
        src.kelas_ids, src.ruang || '', Number(src.merged) || 0, src.catatan || '', dbm.now(), dbm.now());
    const newId = Number(r.lastInsertRowid);
    const mapel = db.prepare('SELECT nama,kode FROM mapel WHERE id=?').get(Number(src.mapel_id)) || {};
    dbm.logAudit(user, 'TAMBAH', 'jadwal',
      `Duplikat slot ${dbm.HARI_LABEL[Number(src.hari)]} sesi ${src.sesi} → ${dbm.HARI_LABEL[hariTujuan]} sesi ${sesiTujuan} (${mapel.nama || '-'})`, ipOf(req));
    json(res, 200, {
      ok: true, id: newId, hari: hariTujuan, sesi: sesiTujuan,
      label_sesi: sesiRow ? `${sesiRow.mulai}–${sesiRow.selesai}` : '',
      pesan: `Slot ${mapel.kode || mapel.nama || ''} diduplikasi ke ${dbm.HARI_LABEL[hariTujuan]} sesi ${sesiTujuan}`
        + `${sesiRow ? ` (${sesiRow.mulai}–${sesiRow.selesai})` : ''}.`,
      peringatan: (konflik.soft || []).map(k => k.pesan)
    });
  });

  /* =================================================================
     7c. MONITORING KBM REAL-TIME (Wakasek Kurikulum)
     ---------------------------------------------------------------------
     Satu endpoint ringkas untuk dashboard pengawasan mutu pembelajaran:
       · kelas yang SEDANG belajar sekarang + status guru,
       · kelas yang gurunya berhalangan / sudah digantikan guru piket,
       · persentase guru yang sudah mengisi jurnal mengajar hari ini.
     Semua dihitung dari slot jadwal hari ini (jam pelajaran berjalan),
     absensi guru, rekam izin, dan data tukar/penunjukan pengganti.
     ================================================================= */
  get('/api/monitor-kbm', (req, res, q) => {
    const user = guard(req, res, 'monitor_kbm', 'view'); if (!user) return;
    const cfg = dbm.jadwalConfig();
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    const tanggalMatriks = /^\d{4}-\d{2}-\d{2}$/.test(String(q.tanggal_matriks || ''))
      ? String(q.tanggal_matriks) : tanggal;
    if (tanggal === dbm.today()) dbm.autoAlfaGuru(tanggal);
    const hari = dbm.hariOf(tanggal);
    const hariMatriks = dbm.hariOf(tanggalMatriks);
    const taId = taOf(q);
    const rowsForDate = (tglTarget, hariTarget) => {
      let rows = dbm.jadwalRows(taId).filter(r => Number(r.hari) === hariTarget);
      let ta = taId;
      if (!rows.length) {
        for (const id of semuaTaIds()) {
          if (Number(id) === Number(taId)) continue;
          const coba = dbm.jadwalRows(id).filter(r => Number(r.hari) === hariTarget);
          if (coba.length) { rows = coba; ta = Number(id); break; }
        }
      }
      return { rows, ta, tanggal: tglTarget };
    };
    const utama = rowsForDate(tanggal, hari);
    const semua = utama.rows;
    const taPakai = utama.ta;
    const matriks = tanggalMatriks === tanggal ? utama : rowsForDate(tanggalMatriks, hariMatriks);
    const semuaMatriks = matriks.rows;
    const taMatriks = matriks.ta;
    if (tanggalMatriks === dbm.today() && tanggal !== dbm.today()) dbm.autoAlfaGuru(tanggalMatriks);
    const absMap = new Map(db.prepare('SELECT * FROM absensi_guru WHERE tanggal=? AND ta_id=?').all(tanggal, taPakai)
      .map(a => [Number(a.jadwal_id), a]));
    const izinMap = new Map(db.prepare('SELECT * FROM absensi_guru_izin WHERE tanggal=?').all(tanggal)
      .map(a => [Number(a.jadwal_id), a]));
    const tukar = dbm.tukarMap(tanggal);
    const kal = dbm.kalenderOfDate(tanggal);
    const kbmLibur = !!(kal && Number(kal.nonaktif) === 1);
    const kini = dbm.nowMenit();
    const jumlahkan = (r, tglTarget = tanggal, absensiMap = absMap, izinAbsensiMap = izinMap,
      tukarTanggal = tukar, kiniTarget = kini) => {
      const w = dbm.absensiWindow(r, tglTarget, cfg);
      const sesi = w.sesi || {};
      const mulai = dbm.jamMenit(sesi.mulai);
      const selesai = dbm.jamMenit(sesi.selesai);
      const t = tukarTanggal.get(Number(r.id)) || null;
      const a = absensiMap.get(Number(r.id)) || null;
      const iz = izinAbsensiMap.get(Number(r.id))
        || (a && ['izin', 'sakit', 'alpha'].includes(String(a.status)) ? a : null);
      const statusGuru = a ? String(a.status) : (iz ? String(iz.status) : '');
      const sekarangTanggal = tglTarget === dbm.today() ? kiniTarget : (tglTarget < dbm.today() ? 1440 : -1);
      let fase = 'lain';                                   // lain | belum | berlangsung | selesai
      if (mulai !== null && selesai !== null) {
        fase = sekarangTanggal < mulai ? 'belum' : sekarangTanggal > selesai ? 'selesai' : 'berlangsung';
      }
      const materi = a ? String(a.materi || '').trim() : '';
      const jurnalOk = materi.length >= Math.max(4, cfg.jurnalMin);
      const guruEfektifId = t ? Number(t.ke_guru) : Number(r.guru_id) || 0;
      const statusLabel = t
        ? (t.jenis === 'penugasan' ? 'Diganti' : 'Ditukar')
        : statusGuru === 'alpha' ? 'Alpha'
          : statusGuru === 'sakit' ? 'Sakit'
            : statusGuru === 'izin' ? 'Izin'
              : statusGuru === 'hadir' && fase === 'berlangsung' ? 'Sedang berlangsung'
                : statusGuru === 'hadir' ? 'Hadir'
                  : fase === 'belum' ? 'Akan datang'
                    : 'Belum check-in';
      return {
        jadwal_id: Number(r.id), sesi: Number(r.sesi),
        label_sesi: sesi.istirahat ? sesi.label : (sesi.no ? `Jam ke-${sesi.no}` : (sesi.label || `Sesi ${r.sesi}`)),
        jam: sesi.mulai ? `${sesi.mulai}–${sesi.selesai}` : '',
        mulai: sesi.mulai || '', selesai: sesi.selesai || '',
        mapel_id: Number(t && t.mapel_id) || Number(r.mapel_id) || 0,
        mapel_nama: t && t.mapel_nama || r.mapel_nama || '',
        mapel_kode: t && t.mapel_kode || r.mapel_kode || '',
        mapel_asal_nama: r.mapel_nama || '',
        kelas_ids: r.kelas_ids, kelas_nama: r.kelas_nama || '',
        guru_id: Number(r.guru_id) || 0, guru_nama: r.guru_nama || '',
        guru_efektif_id: guruEfektifId,
        guru_efektif_nama: t ? t.ke_nama : (r.guru_nama || ''),
        ruang: r.ruang || '',
        fase, status_guru: statusGuru, status_label: statusLabel,
        status_detail: t && ['izin', 'sakit', 'alpha'].includes(statusGuru) ? statusGuru : '',
        hadir: statusGuru === 'hadir',
        belum_checkin: !a && !iz && fase !== 'belum',
        jurnal_isi: jurnalOk,
        jurnal_panjang: materi.length,
        pengganti: t ? {
          id: t.id, jenis: t.jenis || 'tukar', dari_nama: t.dari_nama || r.guru_nama || '',
          ke_nama: t.ke_nama || '', ke_guru: Number(t.ke_guru) || 0, alasan: t.alasan || ''
        } : null,
        diawasi: !!iz
      };
    };
    const slot = semua.filter(r => !r.istirahat).map(r => jumlahkan(r));
    const absMapMatriks = tanggalMatriks === tanggal ? absMap
      : new Map(db.prepare('SELECT * FROM absensi_guru WHERE tanggal=? AND ta_id=?').all(tanggalMatriks, taMatriks)
        .map(a => [Number(a.jadwal_id), a]));
    const izinMapMatriks = tanggalMatriks === tanggal ? izinMap
      : new Map(db.prepare('SELECT * FROM absensi_guru_izin WHERE tanggal=?').all(tanggalMatriks)
        .map(a => [Number(a.jadwal_id), a]));
    const tukarMatriks = tanggalMatriks === tanggal ? tukar : dbm.tukarMap(tanggalMatriks);
    const kiniMatriks = tanggalMatriks === dbm.today() ? kini : (tanggalMatriks < dbm.today() ? 1440 : -1);
    const monitorJadwal = semuaMatriks.filter(r => !r.istirahat)
      .map(r => jumlahkan(r, tanggalMatriks, absMapMatriks, izinMapMatriks, tukarMatriks, kiniMatriks));
    const berlangsung = slot.filter(x => x.fase === 'berlangsung');
    const selesai = slot.filter(x => x.fase === 'selesai');
    const belum = slot.filter(x => x.fase === 'belum');
    /* kelas yang gurunya berhalangan (izin/sakit/alfa) — sudah atau belum digantikan */
    const berhalangan = slot.filter(x => ['izin', 'sakit', 'alpha'].includes(x.status_guru));
    const belumAbsen = slot.filter(x => x.belum_checkin && x.fase !== 'belum');
    const denganJurnal = slot.filter(x => x.jurnal_isi);
    const rawById = new Map(semua.map(r => [Number(r.id), r]));
    const sameContext = (a, b) => Number(a.guru_efektif_id) === Number(b.guru_efektif_id)
      && Number(a.mapel_id) === Number(b.mapel_id)
      && (a.kelas_ids || []).map(Number).sort((x, y) => x - y).join(',') === (b.kelas_ids || []).map(Number).sort((x, y) => x - y).join(',');
    const mergeRecapRows = (items, sameStatus) => {
      const byId = new Map(items.map(x => [Number(x.jadwal_id), x]));
      const emitted = new Set();
      const merged = [];
      const flush = run => {
        if (!run.length) return;
        const first = run[0];
        const range = dbm.absensiRentangSesi(run.map(x => rawById.get(Number(x.jadwal_id))).filter(Boolean), cfg);
        merged.push({
          ...first,
          jadwal_ids: run.map(x => Number(x.jadwal_id)),
          label_sesi: range.label_sesi || first.label_sesi,
          jam: range.jam || first.jam
        });
      };
      for (const item of [...items].sort((a, b) => Number(a.sesi) - Number(b.sesi))) {
        const id = Number(item.jadwal_id);
        if (emitted.has(id)) continue;
        const raw = rawById.get(id);
        const chain = raw ? dbm.absensiKelompok(raw, semua, cfg) : [];
        let run = [];
        for (const scheduled of chain) {
          const next = byId.get(Number(scheduled.id));
          if (!next || emitted.has(Number(scheduled.id))) {
            flush(run); run = [];
            continue;
          }
          if (run.length && (!sameContext(run[run.length - 1], next) || !sameStatus(run[run.length - 1], next))) {
            flush(run); run = [];
          }
          run.push(next);
          emitted.add(Number(next.jadwal_id));
        }
        flush(run);
      }
      return merged;
    };
    const sameBerhalangan = (a, b) => sameContext(a, b)
      && a.status_guru === b.status_guru
      && Number(a.pengganti?.ke_guru || 0) === Number(b.pengganti?.ke_guru || 0)
      && String(a.pengganti?.jenis || '') === String(b.pengganti?.jenis || '');
    const persen = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    /* rekap per kelas untuk hari ini */
    const perKelas = new Map();
    for (const x of slot) {
      for (const kid of x.kelas_ids) {
        const o = perKelas.get(Number(kid)) || {
          kelas_id: Number(kid), kelas_nama: '', slot: 0, berlangsung: 0, selesai: 0,
          hadir: 0, belum_checkin: 0, berhalangan: 0, jurnal: 0
        };
        if (!o.kelas_nama) {
          o.kelas_nama = (kelasPicker().find(k => Number(k.id) === Number(kid)) || {}).nama || '';
        }
        o.slot++;
        if (x.fase === 'berlangsung') o.berlangsung++;
        if (x.fase === 'selesai') o.selesai++;
        if (x.hadir) o.hadir++;
        if (x.belum_checkin && x.fase !== 'belum') o.belum_checkin++;
        if (['izin', 'sakit', 'alpha'].includes(x.status_guru)) o.berhalangan++;
        if (x.jurnal_isi) o.jurnal++;
        perKelas.set(Number(kid), o);
      }
    }
    json(res, 200, {
      ok: true, tanggal, tanggal_label: dbm.tanggalPanjang(tanggal), hari, hari_label: dbm.HARI_LABEL[hari] || '',
      sekarang: dbm.menitJam(kini), jam_sekarang: dbm.menitJam(kini), ta: taPakai,
      tanggal_matriks: tanggalMatriks, tanggal_matriks_label: dbm.tanggalPanjang(tanggalMatriks),
      hari_matriks: hariMatriks, hari_matriks_label: dbm.HARI_LABEL[hariMatriks] || '', ta_matriks: taMatriks,
      kbm_libur: kbmLibur,
      kalender: kal ? {
        id: kal.id, kategori: kal.kategori, label: dbm.KALENDER_KATEGORI_LABEL[kal.kategori] || '',
        judul: kal.judul || '', keterangan: kal.keterangan || '', nonaktif: Number(kal.nonaktif)
      } : null,
      sesi_berjalan: (() => {
        const daftar = dbm.sesiOfHari(cfg, hari);
        const s = daftar.find(x => !x.istirahat && dbm.jamMenit(x.mulai) <= kini && kini < dbm.jamMenit(x.selesai));
        return s ? { label: s.no ? `Jam ke-${s.no}` : s.label, jam: `${s.mulai}–${s.selesai}`, mulai: s.mulai, selesai: s.selesai } : null;
      })(),
      stats: {
        slot: slot.length,
        kelas: perKelas.size,
        berlangsung: berlangsung.length,
        selesai: selesai.length,
        belum: belum.length,
        hadir: slot.filter(x => x.hadir).length,
        belum_checkin: belumAbsen.length,
        berhalangan: berhalangan.length,
        digantikan: berhalangan.filter(x => x.pengganti).length,
        perlu_pengganti: berhalangan.filter(x => !x.pengganti).length,
        jurnal_isi: denganJurnal.length,
        jurnal_belum: slot.length - denganJurnal.length,
        persen_jurnal: persen(denganJurnal.length, slot.length),
        persen_belum_jurnal: 100 - persen(denganJurnal.length, slot.length),
        persen_hadir: persen(slot.filter(x => x.hadir).length, slot.length)
      },
      sedang_belajar: berlangsung,
      berhalangan,
      berhalangan_rekap: mergeRecapRows(berhalangan, sameBerhalangan),
      belum_checkin: belumAbsen,
      jurnal: {
        sudah: mergeRecapRows(slot.filter(x => x.jurnal_isi), () => true),
        belum: mergeRecapRows(slot.filter(x => !x.jurnal_isi), () => true)
      },
      sesi: { berlangsung, selesai, belum },
      per_kelas: [...perKelas.values()].sort((a, b) => String(a.kelas_nama).localeCompare(String(b.kelas_nama))),
      monitor_jadwal: monitorJadwal,
      kelas: kelasPicker(),
      guru: guruList(),
      jurnal_min: Math.max(4, cfg.jurnalMin),
      terakhir: dbm.now()
    });
  });

  /* =================================================================
     7b. PEMETAAN JAM GURU & KALENDER AKADEMIK (Wakasek Kurikulum)
     ================================================================= */
  /** rekap beban mengajar + target per guru (jam per pekan & per bulan) */
  get('/api/jadwal/guru-target', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const taId = taOf(q);
    const bulan = /^\d{4}-\d{2}$/.test(String(q.bulan || '')) ? String(q.bulan) : String(dbm.today()).slice(0, 7);
    const data = dbm.guruTargetRows(taId, { bulan });
    json(res, 200, {
      ok: true, ta: taId, ...data,
      target_default: dbm.targetJamConfig(),
      guru: guruList(),
      bulan_list: (() => {
        const ta = dbm.tahunById(taId) || {};
        const mulai = String(ta.tanggal_mulai || '').slice(0, 7) || `${new Date().getFullYear()}-07`;
        const out = [];
        let [y, m] = mulai.split('-').map(Number);
        for (let i = 0; i < 12; i++) {
          out.push(`${y}-${String(m).padStart(2, '0')}`);
          m++; if (m > 12) { m = 1; y++; }
        }
        return out;
      })()
    });
  });

  /** simpan target jam mengajar guru (satu atau banyak sekaligus) */
  post('/api/jadwal/guru-target', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const items = Array.isArray(b.items) ? b.items : (b.guru_id ? [b] : []);
    if (!items.length) return fail(res, 400, 'Tidak ada data guru yang dikirim.');
    /* VALIDASI DULU, simpan kemudian */
    for (const it of items) {
      if (!Number(it.guru_id)) return fail(res, 400, 'Ada baris tanpa guru terpilih.');
      const m = Number(it.target_minggu);
      const bl = Number(it.target_bulan);
      if (it.target_minggu !== undefined && it.target_minggu !== '' && (!Number.isFinite(m) || m < 0 || m > 80)) {
        return fail(res, 400, 'Target jam per minggu harus antara 0 dan 80 jam.');
      }
      if (it.target_bulan !== undefined && it.target_bulan !== '' && (!Number.isFinite(bl) || bl < 0 || bl > 400)) {
        return fail(res, 400, 'Target jam per bulan harus antara 0 dan 400 jam.');
      }
    }
    let n = 0;
    for (const it of items) {
      dbm.guruTargetSave(Number(it.guru_id), {
        target_minggu: it.target_minggu, target_bulan: it.target_bulan, catatan: it.catatan
      }, user);
      n++;
    }
    dbm.logAudit(user, 'UBAH', 'jadwal', `Pemetaan target jam mengajar guru: ${n} baris diperbarui`, ipOf(req));
    const bulan = /^\d{4}-\d{2}$/.test(String(b.bulan || '')) ? String(b.bulan) : undefined;
    json(res, 200, {
      ok: true, jumlah: n, ...dbm.guruTargetRows(taOf(b), { bulan }),
      pesan: `Target jam mengajar ${n} guru disimpan.`
    });
  });

  /** kalender akademik: daftar + statistik hari efektif */
  get('/api/kalender-akademik', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const taId = taOf(q);
    const ta = dbm.tahunById(taId) || {};
    const dari = /^\d{4}-\d{2}-\d{2}$/.test(String(q.dari || '')) ? String(q.dari) : (ta.tanggal_mulai || '');
    const sampai = /^\d{4}-\d{2}-\d{2}$/.test(String(q.sampai || '')) ? String(q.sampai) : (ta.tanggal_selesai || '');
    const rows = dbm.kalenderRows(taId, dari, sampai);
    const cfg = dbm.jadwalConfig();
    /* hari efektif per bulan (Juli … Juni pada tahun ajaran) */
    const bulanList = [];
    if (dari && sampai) {
      let [y, m] = dari.slice(0, 7).split('-').map(Number);
      const [y2, m2] = sampai.slice(0, 7).split('-').map(Number);
      while (y < y2 || (y === y2 && m <= m2)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        bulanList.push({ bulan: key, ...dbm.hariEfektifBulan(key, { taId, cfg }) });
        m++; if (m > 12) { m = 1; y++; }
      }
    }
    const semester = dbm.kalenderSemester(ta);
    json(res, 200, {
      ok: true, ta: taId, ta_nama: ta.nama || '', dari, sampai,
      kategori: dbm.KALENDER_KATEGORI, hari_label: dbm.HARI_LABEL,
      hari_aktif: cfg.hari, bulan: bulanList, rows,
      semester,
      warna: dbm.kalenderWarna(),
      pengaturan: {
        pengawas_nama: dbm.getSetting('kal_pengawas_nama', '') || dbm.getSetting('jadwal_pengawas_nama', ''),
        pengawas_nip: dbm.getSetting('kal_pengawas_nip', '') || dbm.getSetting('jadwal_pengawas_nip', ''),
        judul: dbm.getSetting('kal_judul', ''),
        kepala_nama: dbm.getSetting('kepala_nama', ''),
        wakasek_nama: dbm.getSetting('wakasek_nama', ''),
        tempat: dbm.getSetting('print_tempat', '')
      },
      ringkas: {
        total: rows.length,
        libur: rows.filter(r => r.kategori === 'libur').length,
        ujian: rows.filter(r => r.kategori === 'ujian').length,
        kegiatan: rows.filter(r => r.kategori === 'kegiatan').length,
        nonaktif: rows.filter(r => Number(r.nonaktif) === 1).length,
        hari_efektif: bulanList.reduce((a, b) => a + b.hari, 0)
      }
    });
  });

  /** simpan tanggal kalender (satuan atau massal per rentang & hari) */
  post('/api/kalender-akademik/save', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const taId = taOf(b);
    const kategori = dbm.KALENDER_KATEGORI.some(k => k.key === b.kategori) ? String(b.kategori) : 'libur';
    const nonaktif = b.nonaktif === undefined ? 1 : (b.nonaktif === true || Number(b.nonaktif) === 1 ? 1 : 0);
    const judul = String(b.judul || '').trim().slice(0, 120);
    const keterangan = String(b.keterangan || '').trim().slice(0, 400);
    /* warna kustom per tanggal (opsional; kosong = ikut warna kategori) */
    const warna = /^#[0-9a-fA-F]{6}$/.test(String(b.warna || '')) ? String(b.warna) : '';
    const TGL = /^\d{4}-\d{2}-\d{2}$/;
    const dari = String(b.dari || b.tanggal || '').slice(0, 10);
    const sampai = String(b.sampai || b.dari || b.tanggal || '').slice(0, 10);
    if (!TGL.test(dari) || !TGL.test(sampai)) return fail(res, 400, 'Tanggal tidak valid (format YYYY-MM-DD).');
    if (sampai < dari) return fail(res, 400, 'Tanggal akhir tidak boleh lebih awal dari tanggal mulai.');
    /* 0..6 — KOSONG = semua hari. (intArr() memetakan '' menjadi 0, jadi nilai
       kosong harus disaring lebih dulu agar tidak dianggap hari Minggu.) */
    const hari = (Array.isArray(b.hari) ? b.hari : (b.hari === undefined || b.hari === null || b.hari === ''
      ? [] : String(b.hari).split(',')))
      .map(x => Number(x)).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
    const rentangHari = (new Date(sampai + 'T00:00:00') - new Date(dari + 'T00:00:00')) / 86400000 + 1;
    if (rentangHari > 400) return fail(res, 400, 'Rentang tanggal terlalu panjang (maksimal 400 hari).');
    const tanggalList = [];
    for (let i = 0; i < rentangHari; i++) {
      const d = new Date(new Date(dari + 'T00:00:00').getTime() + i * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (hari.length && !hari.includes(d.getDay())) continue;
      tanggalList.push(iso);
    }
    if (!tanggalList.length) return fail(res, 400, 'Tidak ada tanggal yang cocok dengan pilihan hari.');
    let n = 0;
    db.transaction(() => {
      for (const tgl of tanggalList) {
        dbm.kalenderSave({ tanggal: tgl, kategori, judul, keterangan, nonaktif, warna, ta_id: taId }, user);
        n++;
      }
    })();
    dbm.logAudit(user, 'UBAH', 'jadwal',
      `Kalender akademik: ${dbm.KALENDER_KATEGORI_LABEL[kategori]} — ${n} tanggal (${tanggalList[0]} s.d. ${tanggalList[tanggalList.length - 1]})`, ipOf(req));
    json(res, 200, {
      ok: true, jumlah: n, tanggal: tanggalList,
      pesan: `${n} tanggal ditandai sebagai ${dbm.KALENDER_KATEGORI_LABEL[kategori]}.`
    });
  });

  /** hapus tanggal kalender (satuan / rentang / semua pada rentang) */
  post('/api/kalender-akademik/delete', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'delete'); if (!user) return;
    const b = await readBody(req);
    const TGL = /^\d{4}-\d{2}-\d{2}$/;
    if (Number(b.id)) {
      const row = dbm.kalenderDelete(Number(b.id));
      if (!row) return fail(res, 404, 'Tanggal kalender tidak ditemukan.');
      dbm.logAudit(user, 'HAPUS', 'jadwal', `Hapus kalender akademik ${row.tanggal} (${row.judul || row.kategori})`, ipOf(req));
      return json(res, 200, { ok: true, jumlah: 1, pesan: 'Tanggal kalender dihapus.' });
    }
    const dari = String(b.dari || b.tanggal || '').slice(0, 10);
    const sampai = String(b.sampai || b.dari || b.tanggal || '').slice(0, 10);
    if (!TGL.test(dari) || !TGL.test(sampai)) return fail(res, 400, 'Tanggal tidak valid.');
    const taId = taOf(b);
    const rows = dbm.kalenderRows(taId, dari < sampai ? dari : sampai, dari < sampai ? sampai : dari);
    if (!rows.length) return fail(res, 404, 'Tidak ada tanggal kalender pada rentang tersebut.');
    db.transaction(() => { for (const r of rows) dbm.kalenderDelete(r.id); })();
    dbm.logAudit(user, 'HAPUS', 'jadwal', `Hapus ${rows.length} tanggal kalender akademik (${dari} s/d ${sampai})`, ipOf(req));
    json(res, 200, { ok: true, jumlah: rows.length, pesan: `${rows.length} tanggal kalender dihapus.` });
  });

  /* ---------- PENGATURAN KALENDER: rentang semester, warna, pengawas ---------- */
  post('/api/kalender-akademik/pengaturan', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const TGL = /^\d{4}-\d{2}-\d{2}$/;
    const teks = (v, maks = 120) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, maks);
    /* ---- VALIDASI DULU (tidak menyimpan separuh bila ada nilai salah) ---- */
    const sem = b.semester && typeof b.semester === 'object' ? b.semester : null;
    const isian = {};
    if (sem) {
      for (const [jenis, key] of [['ganjil', '1'], ['genap', '2']]) {
        const v = sem[jenis] || {};
        for (const sisi of ['mulai', 'selesai']) {
          const raw = String(v[sisi] === undefined || v[sisi] === null ? '' : v[sisi]).slice(0, 10);
          if (raw && !TGL.test(raw)) return fail(res, 400, `Tanggal ${sisi} semester ${key} tidak valid (format YYYY-MM-DD).`);
          isian[`kal_s${key}_${sisi}`] = raw;
        }
        const m = isian[`kal_s${key}_mulai`];
        const t = isian[`kal_s${key}_selesai`];
        if (m && t && t < m) return fail(res, 400, `Semester ${key}: tanggal selesai tidak boleh lebih awal dari tanggal mulai.`);
      }
      const g1 = isian.kal_s1_mulai, g2 = isian.kal_s1_selesai;
      const n1 = isian.kal_s2_mulai, n2 = isian.kal_s2_selesai;
      if (g1 && g2 && n1 && n2 && n1 <= g2) {
        return fail(res, 400, 'Rentang semester 2 harus dimulai setelah semester 1 berakhir.');
      }
    }
    /* warna kategori (color picker) */
    let warnaBaru = null;
    if (b.warna && typeof b.warna === 'object') {
      const HEX = /^#[0-9a-fA-F]{6}$/;
      warnaBaru = {};
      for (const k of dbm.KALENDER_KATEGORI) {
        const v = b.warna[k.key] || {};
        const def = dbm.KALENDER_WARNA_DEFAULT[k.key];
        for (const sisi of ['bg', 'text', 'border']) {
          const raw = String((v && v[sisi]) || '');
          if (raw && !HEX.test(raw)) return fail(res, 400, `Warna ${sisi} kategori "${k.label}" tidak valid (format #RRGGBB).`);
        }
        warnaBaru[k.key] = {
          bg: HEX.test(String(v.bg || '')) ? v.bg : def.bg,
          text: HEX.test(String(v.text || '')) ? v.text : def.text,
          border: HEX.test(String(v.border || '')) ? v.border : def.border
        };
      }
      /* kontras teks vs latar: bila terlalu dekat, teks diganti putih/hitam */
      const lum = (hex) => {
        const n = parseInt(String(hex).slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      };
      for (const k of Object.keys(warnaBaru)) {
        const c = warnaBaru[k];
        if (Math.abs(lum(c.bg) - lum(c.text)) < 0.35) c.text = lum(c.bg) > 0.6 ? '#111827' : '#FFFFFF';
      }
    }
    for (const [k, v] of Object.entries(isian)) dbm.setSetting(k, v);
    if (warnaBaru) dbm.setSetting('kal_warna', JSON.stringify(warnaBaru));
    if (b.pengawas_nama !== undefined) dbm.setSetting('kal_pengawas_nama', teks(b.pengawas_nama, 120));
    if (b.pengawas_nip !== undefined) dbm.setSetting('kal_pengawas_nip', teks(b.pengawas_nip, 40));
    if (b.judul !== undefined) dbm.setSetting('kal_judul', teks(b.judul, 120));
    dbm.logAudit(user, 'UBAH', 'jadwal', 'Pengaturan kalender akademik (rentang semester / warna / pengawas) diperbarui', ipOf(req));
    const ta = dbm.tahunById(taOf(b)) || {};
    json(res, 200, {
      ok: true, semester: dbm.kalenderSemester(ta), warna: dbm.kalenderWarna(),
      pesan: 'Pengaturan kalender akademik disimpan.'
    });
  });

  /* ---------- CETAK · EXCEL · WORD KALENDER AKADEMIK ---------- */
  const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus',
    'September', 'Oktober', 'November', 'Desember'];
  const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const tglPanjangID = (iso) => {
    const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '-';
    return `${d} ${BULAN_ID[m - 1]} ${y}`;
  };
  const tglPendekID = (iso) => {
    const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '-';
    return `${d} ${BULAN_PENDEK[m - 1]} ${y}`;
  };
  /** rentang tanggal untuk daftar keterangan: "14 - 28 Maret 2026" */
  const labelRentang = (dari, sampai) => {
    if (String(dari) === String(sampai)) return tglPanjangID(dari);
    const [ya, ma, da] = String(dari).slice(0, 10).split('-').map(Number);
    const [yb, mb, db2] = String(sampai).slice(0, 10).split('-').map(Number);
    if (ya === yb && ma === mb) return `${da} - ${db2} ${BULAN_ID[ma - 1]} ${ya}`;
    return `${tglPendekID(dari)} - ${tglPanjangID(sampai)}`;
  };
  /** bulan-bulan pada satu semester (mengikuti rentang tanggal semester) */
  const bulanSemester = (rentang) => {
    const out = [];
    if (!rentang || !rentang.mulai || !rentang.selesai) return out;
    let [y, m] = rentang.mulai.slice(0, 7).split('-').map(Number);
    const [y2, m2] = rentang.selesai.slice(0, 7).split('-').map(Number);
    while (y < y2 || (y === y2 && m <= m2)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  };
  /** data dokumen kalender akademik (dipakai cetak & ekspor) */
  function kalenderDokumen(q) {
    const taId = taOf(q);
    const ta = dbm.tahunById(taId) || {};
    const semester = dbm.kalenderSemester(ta);
    const warna = dbm.kalenderWarna();
    const rows = dbm.kalenderRows(taId, ta.tanggal_mulai || '', ta.tanggal_selesai || '');
    const cfg = dbm.jadwalConfig();
    const st = dbm.allSettings();
    /* PEJABAT PENANDATANGAN — SAMA PERSIS dengan cetak Jadwal Pelajaran
       (menu Desain Jadwal): kepala sekolah, Wakasek Kurikulum, dan Pengawas
       Pembina. Jangan memakai wakasek_nama (Wakasek Kesiswaan) di sini. */
    const dsn = dbm.jadwalDesain();
    const pengawas = {
      nama: String(dsn.pengawas_nama || dbm.getSetting('kal_pengawas_nama', '') || '').trim(),
      nip: String(dsn.pengawas_nip || dbm.getSetting('kal_pengawas_nip', '') || '').trim()
    };
    const bagian = ['ganjil', 'genap'].map((jenis) => {
      const rentang = semester[jenis];
      const bulan = bulanSemester(rentang);
      return {
        jenis, label: jenis === 'ganjil' ? 'Semester 1 (Ganjil)' : 'Semester 2 (Genap)',
        rentang, bulan,
        rows: rows.filter(r => String(r.tanggal) >= rentang.mulai && String(r.tanggal) <= rentang.selesai)
      };
    });
    return {
      taId, ta, semester, warna, rows, bagian, cfg, st, pengawas,
      /* seluruh bulan pada satu tahun pelajaran (dipakai cetak "Satu Tahun") */
      bulanTahun: bulanSemester({ mulai: String(ta.tanggal_mulai || (semester.ganjil || {}).mulai || ''),
        selesai: String(ta.tanggal_selesai || (semester.genap || {}).selesai || '') }),
      judul: dbm.getSetting('kal_judul', '') || 'KALENDER AKADEMIK',
      tempat: String(dsn.tempat || st.print_tempat || '').trim(),
      tanggal: String(dsn.tanggal || '').trim(),
      kepala: { nama: dsn.kepala_nama || '', nip: dsn.kepala_nip || '' },
      wakasek: { nama: dsn.wakasek_nama || '', nip: dsn.wakasek_nip || '', jabatan: dsn.wakasek_jabatan || 'Wakasek Kurikulum' }
    };
  }
  /** luminansi relatif 0..1 — dipakai memilih warna teks yang tetap terbaca */
  const kilau = (hex) => {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const c = [0, 2, 4].map(i => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  /* pilih dari (bg, text) warna yang paling kontras di atas kertas PUTIH */
  const lebihKontras = (bg, text) => {
    const a = kilau(bg), b = kilau(text);
    if (a === null) return text; if (b === null) return bg;
    return a <= b ? bg : text;
  };
  /**
   * Warna SATU SEL tanggal pada cetakan — SAMA dengan tampilan menu
   * Kalender Akademik di aplikasi (sel diwarnai penuh, bukan hanya angka):
   * warna khusus tanggal → warna kategori → warna bawaan.
   */
  const warnaSelTanggal = (d, row) => {
    if (!row) return null;
    const khusus = String(row.warna || '');
    if (/^#[0-9a-fA-F]{6}$/.test(khusus)) {
      return { bg: khusus, text: lebihKontras(khusus, '#111827'), border: khusus };
    }
    const w = d.warna[row.kategori] || d.warna.kegiatan;
    return { bg: w.bg, text: lebihKontras(w.bg, w.text), border: w.border || w.bg };
  };
  /** label kecil di dalam sel tanggal (seperti pada antarmuka web) */
  const labelSelTanggal = (row) => {
    if (Number(row.nonaktif) === 1) {
      return row.kategori === 'ujian' ? 'UJIAN' : row.kategori === 'libur' ? 'LIBUR' : 'KEGIATAN';
    }
    return 'KBM';
  };
  /**
   * SATU KOTAK BULAN — dibuat PERSIS seperti kartu `BulanGrid` pada menu
   * Kalender Akademik: kartu rounded, kepala bulan + "N hari efektif · N libur",
   * nama hari SEN…MIN, sel tanggal rounded berwarna penuh dengan label kecil
   * (LIBUR/UJIAN/KEGIATAN/KBM), dan daftar keterangan bergaris di bawahnya.
   */
  const gridBulanHtml = (bulanKey, d, kalMap) => {
    const [y, m] = bulanKey.split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    const pad0 = n => String(n).padStart(2, '0');
    /* Senin = kolom pertama (sama dengan tampilan web) */
    const startIdx = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const sel = [];
    for (let i = 0; i < startIdx; i++) sel.push(null);
    for (let day = 1; day <= total; day++) {
      const iso = `${y}-${pad0(m)}-${pad0(day)}`;
      sel.push({ day, iso, dow: new Date(y, m - 1, day).getDay(), kal: kalMap.get(iso) || null });
    }
    while (sel.length % 7) sel.push(null);
    const namaHari = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const kepala = namaHari.map(h => `<div class="kdh">${h}</div>`).join('');
    const selArr = sel.map(c => {
      if (!c) return '<div class="kdd kosong"></div>';
      const sekolah = d.cfg.hari.includes(c.dow);
      const w = warnaSelTanggal(d, c.kal);
      if (!w) {
        return `<div class="kdd${sekolah ? '' : ' minggu'}"><span class="kdnum">${c.day}</span></div>`;
      }
      return `<div class="kdd ada" style="background:${w.bg};color:${w.text};border-color:${w.border}">`
        + `<span class="kdnum">${c.day}</span><span class="kdket">${labelSelTanggal(c.kal)}</span></div>`;
    });
    /* pembagian per baris 7 sel (jangan join dulu lalu slice) */
    const baris = [];
    for (let i = 0; i < selArr.length; i += 7) baris.push(selArr.slice(i, i + 7).join(''));
    /* statistik bulan (sama seperti kepala kartu pada tampilan web) */
    const ef = (() => {
      try { return dbm.hariEfektifBulan(bulanKey, { taId: d.taId, cfg: d.cfg }); }
      catch (e) { return { hari: 0, libur: 0 }; }
    })();
    /* keterangan detail di bawah kartu; bulan tanpa agenda → kosong */
    const rentang = dbm.kalenderRentang([...kalMap.values()].filter(r => String(r.tanggal).startsWith(bulanKey)));
    const ket = rentang.length
      ? `<ul class="kal-list">${rentang.map(r => {
        const w = warnaSelTanggal(d, r.row);
        return `<li><span class="sw" style="background:${w.bg};border-color:${w.border}"></span>`
          + `<span class="ketx"><b>${lib.esc(labelRentang(r.dari, r.sampai))}</b> `
          + `${lib.esc(r.row.judul || dbm.KALENDER_KATEGORI_LABEL[r.row.kategori] || '')}`
          + `${r.row.keterangan ? `<span class="ket2"> — ${lib.esc(r.row.keterangan)}</span>` : ''}</span></li>`;
      }).join('')}</ul>`
      : '';
    return `<div class="kal-box">
      <div class="kal-head"><span class="mth">${BULAN_ID[m - 1]} ${y}</span>
        <span class="ef"><b class="ok">${ef.hari || 0}</b> hari efektif${ef.libur ? ` · <b class="lib">${ef.libur}</b> libur` : ''}</span></div>
      <div class="kal-days">${kepala}${baris.join('')}</div>
      ${ket}
    </div>`;
  };
  function kalenderCetakHtml(q, opts = {}) {
    const d = kalenderDokumen(q);
    const kalMap = new Map(d.rows.map(r => [String(r.tanggal), r]));
    const esc = lib.esc;
    const doc = require('./doc');
    /* ORIENTASI KERTAS: portrait (bawaan) atau landscape */
    const lanskap = String(q.orient || opts.orient || '').toLowerCase() === 'landscape';
    const kertas = lanskap ? { w: 297, h: 210, m: 9 } : { w: 210, h: 297, m: 9 };
    const widthPx = Math.round(((kertas.w - kertas.m * 2) / 25.4) * 96);
    /* CAKUPAN CETAK:
         tahun    → satu tahun ajaran penuh dalam SATU alur (tanpa pemisah halaman)
         semester → halaman terpisah per semester (bawaan)
         semester=1|2 → hanya semester itu                                  */
    const cakupan = String(q.cakupan || '').toLowerCase() === 'tahun' ? 'tahun' : 'semester';
    const diminta = String(q.semester || 'all');
    const blokTtd = () => {
      const tglTtd = `${d.tempat ? esc(d.tempat) + ', ' : ''}${esc(d.tanggal || tglPanjangID(dbm.today()))}`;
      return `<div class="ttd-grid">
        <div class="ttd-row">
          <div class="ttdc"><p>Kepala Sekolah,</p><p>&nbsp;</p>
            <div class="sp"></div><p class="nm">${esc(d.kepala.nama || '..............................')}</p>
            <p class="nip">NIP. ${esc(d.kepala.nip || '..............................')}</p></div>
          <div class="ttdc"><p>${tglTtd}</p><p>${esc(d.wakasek.jabatan)}</p>
            <div class="sp"></div><p class="nm">${esc(d.wakasek.nama || '..............................')}</p>
            <p class="nip">NIP. ${esc(d.wakasek.nip || '..............................')}</p></div>
        </div>
        <div class="ttdp"><p>Pengawas Pembina,</p>
          <div class="sp"></div><p class="nm">${esc(d.pengawas.nama || '..............................')}</p>
          <p class="nip">NIP. ${esc(d.pengawas.nip || '..............................')}</p></div>
      </div>`;
    };
    let isi;
    if (cakupan === 'tahun') {
      /* SATU TAHUN PENUH — kop, judul, seluruh bulan (Juli…Juni) berurutan
         tanpa pemisah halaman, lalu tanda tangan di akhir. */
      const bulan = d.bulanTahun.length ? d.bulanTahun : d.bagian.reduce((a, b) => a.concat(b.bulan), []);
      isi = `<div class="kal-sem"><section class="kal-page">
        ${opts.kop === false ? '' : doc.kop(d.st, { simetris: true, balance: true, widthPx })}
        <h1 class="kal-judul">${esc(d.judul)}</h1>
        <p class="kal-sub">Tahun Pelajaran ${esc(d.ta.nama || '-')}</p>
        <div class="kal-wrap">${bulan.map(b => gridBulanHtml(b, d, kalMap)).join('')}</div>
        ${blokTtd()}
      </section></div>`;
    } else {
      const daftar = diminta === '1' ? [d.bagian[0]] : diminta === '2' ? [d.bagian[1]] : d.bagian;
      isi = daftar.map((bag, i) => {
        const pakaiKop = i === 0 && opts.kop !== false;
        const judul = pakaiKop ? esc(d.judul) : `${esc(d.judul)} - ${esc(bag.label)}`;
        return `<div class="kal-sem${i > 0 ? ' pagebreak' : ''}"><section class="kal-page${pakaiKop ? '' : ' nokop'}">
          ${pakaiKop ? doc.kop(d.st, { simetris: true, balance: true, widthPx }) : ''}
          <h1 class="kal-judul">${judul}</h1>
          <p class="kal-sub">${pakaiKop ? esc(bag.label) + ' · ' : ''}Tahun Pelajaran ${esc(d.ta.nama || '-')}</p>
          <div class="kal-wrap">${bag.bulan.map(b => gridBulanHtml(b, d, kalMap)).join('')}</div>
          ${i === daftar.length - 1 ? blokTtd() : ''}
        </section></div>`;
      }).join('');
    }
    /* tautan toolbar mempertahankan tahun pelajaran, cakupan & orientasi */
    const qs = (over = {}) => {
      const p = new URLSearchParams();
      if (q.ta) p.set('ta', q.ta);
      const cak = over.cakupan !== undefined ? over.cakupan : cakupan;
      if (cak === 'tahun') p.set('cakupan', 'tahun');
      const sem = over.semester !== undefined ? over.semester : (cak === 'semester' ? diminta : 'all');
      if (cak === 'semester' && sem && sem !== 'all') p.set('semester', sem);
      p.set('orient', over.orient !== undefined ? over.orient : (lanskap ? 'landscape' : 'portrait'));
      return '?' + p.toString();
    };
    const labelCakupan = cakupan === 'tahun' ? 'Satu Tahun Pelajaran'
      : diminta === '1' ? 'Semester 1' : diminta === '2' ? 'Semester 2' : 'Per Semester';
    return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<title>${esc(d.judul)} — ${esc(d.st.sekolah_nama || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page { size: A4 ${lanskap ? 'landscape' : 'portrait'}; margin: 10mm ${kertas.m}mm; }
* { box-sizing: border-box; }
body { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a;
  margin: 0; background: #eef2f7; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${doc.kopCSS()}
/* kop tetap memakai font resmi sekolah */
.kop, .kop * { font-family: "Times New Roman", Times, serif; }
.kal-sem { background: #fff; max-width: ${kertas.w}mm; margin: 12px auto 24px; padding: 10mm ${kertas.m}mm;
  box-shadow: 0 10px 30px rgba(15,23,42,.14); }
.pagebreak { page-break-before: always; }
h1.kal-judul { text-align: center; font-size: 15pt; font-weight: 800; letter-spacing: .3px; margin: 2px 0 1px; color: #0f172a; }
p.kal-sub { text-align: center; font-size: 9.5pt; color: #475569; margin: 0 0 9px; }
.nokop h1.kal-judul { margin-top: 2px; }
.kal-wrap { display: grid; grid-template-columns: repeat(${lanskap ? 3 : 2}, minmax(0, 1fr)); gap: 10px; align-items: start; }
/* KARTU BULAN — rounded, border halus, bayangan lembut (mirip kartu web) */
.kal-box { border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; padding: 7px 8px 8px;
  page-break-inside: avoid; box-shadow: 0 1px 3px rgba(15,23,42,.08); }
.kal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin-bottom: 5px; }
.kal-head .mth { font-size: 9.5pt; font-weight: 800; color: #1e293b; letter-spacing: .1px; }
.kal-head .ef { font-size: 6.4pt; font-weight: 600; color: #64748b; white-space: nowrap; }
.kal-head .ef .ok { color: #059669; }
.kal-head .ef .lib { color: #e11d48; }
.kal-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; text-align: center; }
.kdh { font-size: 5.8pt; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; color: #94a3b8; padding-bottom: 1px; }
.kdd { border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; color: #334155;
  padding: 1px 0; min-height: ${lanskap ? 15 : 17}px; line-height: 1.05; }
.kdd.kosong { border: 0; background: transparent; }
.kdd.minggu { border-color: #f1f5f9; background: #f8fafc; color: #94a3b8; }
.kdd .kdnum { display: block; font-weight: 700; font-size: 6.6pt; }
.kdd .kdket { display: block; font-size: 4.8pt; font-weight: 700; letter-spacing: .2px; opacity: .95; }
ul.kal-list { list-style: none; margin: 5px 0 0; padding: 3px 0 0; border-top: 1px dashed #cbd5e1; }
ul.kal-list li { display: flex; align-items: flex-start; gap: 3px; font-size: 6.2pt; line-height: 1.3;
  color: #475569; padding: 1px 0; border-bottom: 1px dotted #e2e8f0; }
ul.kal-list li:last-child { border-bottom: 0; }
ul.kal-list li .ketx { min-width: 0; }
ul.kal-list li b { color: #334155; font-weight: 700; }
ul.kal-list li .ket2 { color: #64748b; }
.sw { display: inline-block; flex: none; width: 6px; height: 6px; border: 1px solid #334155; margin-top: 1.5px; }
/* tanda tangan: 2 kolom di atas + pengawas di tengah bawah (nama sejajar) */
.ttd-grid { margin-top: 16px; page-break-inside: avoid; }
.ttd-row { display: flex; justify-content: space-between; gap: 16px; }
.ttdc { flex: 1; text-align: center; font-size: 9pt; line-height: 1.3; }
.ttdp { width: 42%; margin: 14px auto 0; text-align: center; font-size: 9pt; line-height: 1.3; }
.ttdc p, .ttdp p { margin: 0; }
.ttdc .sp, .ttdp .sp { height: 44px; }
.ttdc .nm, .ttdp .nm { font-weight: 700; text-decoration: underline; }
.ttdc .nip, .ttdp .nip { font-size: 8.4pt; }
.bar { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 6px; padding: 10px;
  max-width: ${kertas.w}mm; margin: 0 auto; font-size: 12px; }
.bar .info { margin-right: auto; color: #475569; font-size: 11.5px; }
.bar a, .bar button { font: inherit; font-size: 12.5px; font-weight: 700; border: 1px solid #0f766e; border-radius: 8px;
  background: #fff; color: #0f766e; padding: 7px 12px; cursor: pointer; text-decoration: none; display: inline-block; }
.bar .aktif { background: #0f766e; color: #fff; }
.bar button.cetak { background: #ea580c; border-color: #ea580c; color: #fff; }
@media print {
  body { background: #fff; }
  .kal-sem { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  .bar { display: none !important; }
  .kal-box { box-shadow: none; }
}
</style></head><body>
<div class="bar no-print">
  <span class="info">Cakupan: <b>${esc(labelCakupan)}</b> · Orientasi: <b>${lanskap ? 'Landscape' : 'Portrait'}</b></span>
  <a class="${cakupan === 'tahun' ? 'aktif' : ''}" href="${esc(qs({ cakupan: 'tahun' }))}" data-kal-tahun>Satu Tahun</a>
  <a class="${cakupan === 'semester' ? 'aktif' : ''}" href="${esc(qs({ cakupan: 'semester' }))}" data-kal-semester>Per Semester</a>
  <a class="${lanskap ? '' : 'aktif'}" href="${esc(qs({ orient: 'portrait' }))}" data-kal-portrait>Portrait</a>
  <a class="${lanskap ? 'aktif' : ''}" href="${esc(qs({ orient: 'landscape' }))}" data-kal-landscape>Landscape</a>
  <button class="cetak" onclick="window.print()">Cetak / Simpan PDF</button>
</div>
${isi}
</body></html>`;
  }
  get('/api/kalender-akademik/cetak', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const html = kalenderCetakHtml(q);
    dbm.logAudit(user, 'CETAK', 'jadwal', `Cetak kalender akademik (semester ${q.semester || 'semua'})`, ipOf(req));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  get('/api/kalender-akademik/export', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const d = kalenderDokumen(q);
    const rows = [];
    rows.push([{ v: (d.st.sekolah_nama || '').toUpperCase(), bold: true }]);
    rows.push([{ v: d.judul, bold: true }]);
    rows.push([`Tahun Pelajaran ${d.ta.nama || '-'}`]);
    rows.push([]);
    for (const bag of d.bagian) {
      rows.push([{ v: bag.label.toUpperCase(), bold: true }]);
      rows.push([`Rentang tanggal efektif: ${tglPanjangID(bag.rentang.mulai)} s.d. ${tglPanjangID(bag.rentang.selesai)}`]);
      rows.push(['NO', 'TANGGAL', 'HARI', 'KATEGORI', 'JUDUL / KEGIATAN', 'KETERANGAN', 'KBM'].map(h => ({ v: h, bold: true })));
      if (!bag.rows.length) rows.push(['—', 'Belum ada kegiatan pada semester ini', '', '', '', '', '']);
      bag.rows.forEach((r, i) => {
        const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dbm.hariOf(r.tanggal)] || '';
        rows.push([i + 1, lib.tglID(r.tanggal), hari, dbm.KALENDER_KATEGORI_LABEL[r.kategori] || r.kategori,
          r.judul || '', r.keterangan || '', Number(r.nonaktif) === 1 ? 'Tidak berlaku' : 'Tetap KBM']);
      });
      rows.push([]);
      rows.push([{ v: 'REKAP RENTANG KEGIATAN', bold: true }]);
      rows.push(['RENTANG TANGGAL', 'KEGIATAN', 'KATEGORI'].map(h => ({ v: h, bold: true })));
      const rentang = dbm.kalenderRentang(bag.rows);
      if (!rentang.length) rows.push(['—', 'Tidak ada kegiatan', '']);
      for (const r of rentang) {
        rows.push([labelRentang(r.dari, r.sampai), r.row.judul || '', dbm.KALENDER_KATEGORI_LABEL[r.row.kategori] || r.row.kategori]);
      }
      rows.push([]);
    }
    rows.push([`Tanda tangan: Kepala Sekolah (${d.kepala.nama || '-'}) · ${d.wakasek.jabatan} (${d.wakasek.nama || '-'}) · Pembina/Pengawas (${d.pengawas.nama || '-'})`]);
    const buf = lib.xlsxBuffer('Kalender Akademik', rows, [6, 16, 12, 30, 34, 34, 14, 30, 12, 12]);
    dbm.logAudit(user, 'EXPORT', 'jadwal', 'Ekspor Excel kalender akademik', ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="kalender-akademik-${d.ta.nama ? String(d.ta.nama).replace(/[^\w]+/g, '-') : dbm.today()}.xlsx"`
    });
    res.end(buf);
  });
  get('/api/kalender-akademik/word', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const d = kalenderDokumen(q);
    const esc = lib.esc;
    const kalMap = new Map(d.rows.map(r => [String(r.tanggal), r]));
    const gridWord = (bulanKey) => {
      const [y, m] = bulanKey.split('-').map(Number);
      const total = new Date(y, m, 0).getDate();
      const pad0 = n => String(n).padStart(2, '0');
      const startIdx = new Date(y, m - 1, 1).getDay();
      const sel = [];
      for (let i = 0; i < startIdx; i++) sel.push(null);
      for (let day = 1; day <= total; day++) {
        const iso = `${y}-${pad0(m)}-${pad0(day)}`;
        sel.push({ day, iso, dow: new Date(y, m - 1, day).getDay(), kal: kalMap.get(iso) || null });
      }
      while (sel.length % 7) sel.push(null);
      const kepala = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
        .map(h => `<th style="border:1px solid #94a3b8;background:#f1f5f9;font-size:7pt;padding:1px">${h}</th>`).join('');
      const cellsArr = sel.map(c => {
        if (!c) return '<td style="border:1px solid #e2e8f0"></td>';
        const sekolah = d.cfg.hari.includes(c.dow);
        const bg = sekolah ? '#FFFFFF' : '#F8FAFC';
        if (!c.kal) {
          return `<td style="border:1px solid #e2e8f0;background:${bg};font-size:7pt;text-align:center;`
            + `vertical-align:middle;height:20px;padding:1px;color:${sekolah ? '#111827' : '#94A3B8'}"><b>${c.day}</b></td>`;
        }
        /* tanggal beragenda: sel diwarnai + label kecil (SAMA dengan tampilan web) */
        const w = warnaSelTanggal(d, c.kal);
        return `<td style="border:1px solid ${w.border};background:${w.bg};color:${w.text};font-size:7pt;text-align:center;`
          + `vertical-align:middle;height:20px;padding:1px"><b>${c.day}</b><br>`
          + `<span style="font-size:5pt">${labelSelTanggal(c.kal)}</span></td>`;
      });
      const baris = [];
      for (let i = 0; i < cellsArr.length; i += 7) baris.push(`<tr>${cellsArr.slice(i, i + 7).join('')}</tr>`);
      const rentang = dbm.kalenderRentang([...kalMap.values()].filter(r => String(r.tanggal).startsWith(bulanKey)));
      return `<p style="margin:6px 0 2px;font-weight:bold;font-size:9pt;text-align:center;background:#f1f5f9;border:1px solid #94a3b8">${BULAN_ID[m - 1]} ${y}</p>
        <table style="border-collapse:collapse;width:100%"><thead><tr>${kepala}</tr></thead><tbody>${baris.join('')}</tbody></table>
        ${rentang.length ? `<div style="font-size:7pt;border-top:1px dashed #94a3b8;margin-top:2px">
          ${rentang.map(r => `<div style="border-bottom:1px dotted #e2e8f0"><b>${esc(labelRentang(r.dari, r.sampai))}</b> ${esc(r.row.judul || dbm.KALENDER_KATEGORI_LABEL[r.row.kategori] || '')}</div>`).join('')}
        </div>` : ''}`;
    };
    const diminta = String(q.semester || 'all');
    const daftar = diminta === '1' ? [d.bagian[0]] : diminta === '2' ? [d.bagian[1]] : d.bagian;
    /* Kop sudah dicetak wordPage() di halaman pertama; tiap semester mulai dengan
       judul. Baris "rentang tanggal efektif" tidak lagi dicetak dan blok tanda
       tangan hanya ditulis pada halaman/semester TERAKHIR. */
    const isi = daftar.map((bag, idx) => `${idx > 0 ? '<p style="page-break-before:always"></p>' : ''}
      <h3 style="text-align:center;text-decoration:underline;margin:6px 0 2px">${esc(d.judul)}${idx > 0 ? ' - ' + esc(bag.label) : ''}</h3>
      <p style="text-align:center;margin:0 0 8px">Tahun Pelajaran ${esc(d.ta.nama || '-')} · ${esc(bag.label)}</p>
      <table style="width:100%;border:0">${(() => {
        const out = [];
        for (let i = 0; i < bag.bulan.length; i += 2) {
          out.push('<tr>');
          out.push(`<td style="width:50%;vertical-align:top;border:0;padding:3px">${gridWord(bag.bulan[i])}</td>`);
          out.push(bag.bulan[i + 1]
            ? `<td style="width:50%;vertical-align:top;border:0;padding:3px">${gridWord(bag.bulan[i + 1])}</td>`
            : '<td style="width:50%;border:0"></td>');
          out.push('</tr>');
        }
        return out.join('');
      })()}</table>
      ${idx === daftar.length - 1 ? `<table style="width:100%;margin-top:18px;border:0"><tr>
        <td style="text-align:center;border:0;font-size:9pt">Kepala ${esc(d.st.sekolah_nama || 'Sekolah')}<br><br><br><br>
          <b><u>${esc(d.kepala.nama || '..............................')}</u></b><br>NIP. ${esc(d.kepala.nip || '..............................')}</td>
        <td style="text-align:center;border:0;font-size:9pt">${d.tempat ? esc(d.tempat) + ', ' : ''}${esc(tglPanjangID(dbm.today()))}<br>${esc(d.wakasek.jabatan)}<br><br><br>
          <b><u>${esc(d.wakasek.nama || '..............................')}</u></b><br>NIP. ${esc(d.wakasek.nip || '..............................')}</td>
      </tr></table>
      <table style="width:42%;margin:14px auto 0;border:0"><tr>
        <td style="text-align:center;border:0;font-size:9pt">Pengawas Pembina<br><br><br><br>
          <b><u>${esc(d.pengawas.nama || '..............................')}</u></b><br>NIP. ${esc(d.pengawas.nip || '..............................')}</td>
      </tr></table>` : ''}`).join('');
    const html = require('./doc').wordPage({
      settings: d.st, title: d.judul,
      subtitle: `Tahun Pelajaran ${d.ta.nama || '-'}`,
      body: isi
    });
    dbm.logAudit(user, 'EXPORT', 'jadwal', 'Ekspor Word kalender akademik', ipOf(req));
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="kalender-akademik-${dbm.today()}.doc"`
    });
    res.end(html);
  });

  /* =================================================================
     8. SCHEDULER REKAP WHATSAPP HARIAN (dipanggil server.js)
     ================================================================= */
  async function checkWaRekap() {
    const cfg = dbm.jadwalConfig();
    if (!cfg.waAktif) return { skip: 'nonaktif' };
    const gw = dbm.waConfig();
    if (!gw.aktif || !gw.url) return { skip: 'gateway' };
    if (!cfg.kepsekWa && !cfg.wakasekWa) return { skip: 'nomor' };
    const tgl = dbm.today();
    if (cfg.waTerakhir === tgl) return { skip: 'sudah' };
    if (dbm.nowMenit() < dbm.jamMenit(cfg.waJam)) return { skip: 'belum-waktunya' };
    const plan = kirimRekapWa(null, null, tgl, {});
    if (plan.error) return { skip: 'nomor' };
    const hasil = await plan.kirim();
    return { sent: true, tanggal: tgl, hasil };
  }

  /* dipanggil scheduler server (setiap menit) untuk setiap sekolah:
     mencatat ALFA otomatis bagi guru yang tidak check-in sampai jam pelajaran berakhir */
  function autoAlfaHarian() {
    try { return dbm.autoAlfaGuru(dbm.today()); }
    catch (e) { return { dibuat: 0, error: e.message }; }
  }

  /* =================================================================
     8b. PENGINGAT JADWAL MENGAJAR & PERINGATAN CHECK-IN (WhatsApp/Fonnte)
     ---------------------------------------------------------------------
     Dipanggil scheduler server setiap menit untuk SETIAP sekolah:
       · PENGINGAT  → `ingatMenit` menit SEBELUM jam pelajaran dimulai.
       · TERLAMBAT  → `telatMenit` menit SETELAH jam pelajaran dimulai dan guru
                      belum check-in: pesan ke guru + laporan ke Kepala Sekolah /
                      Wakasek Kurikulum / Guru Piket (bila diaktifkan).
     Dedupe per (slot, tanggal) memakai kolom wa_log.ref; percobaan yang GAGAL
     diulang paling cepat 10 menit kemudian agar gateway tidak dibanjiri.
     ================================================================= */
  const WA_RETRY_MENIT = 10;
  /** sudah pernah terkirim (atau baru dicoba < 10 menit lalu) untuk ref tsb */
  function waSudahKirimRef(ref) {
    try {
      if (dbm.waSudahKirim(ref, null)) return true;
      const r = db.prepare('SELECT created_at FROM wa_log WHERE ref=? ORDER BY id DESC LIMIT 1').get(String(ref));
      if (!r || !r.created_at) return false;
      const t = new Date(String(r.created_at).replace(' ', 'T'));
      if (Number.isNaN(t.getTime())) return false;
      return (Date.now() - t.getTime()) < WA_RETRY_MENIT * 60000;
    } catch (e) { return false; }
  }

  async function checkWaJadwal() {
    const wj = dbm.waJadwalConfig();
    if (!wj.ingatAktif && !wj.telatAktif) return { skip: 'nonaktif', ingat: 0, telat: 0 };
    const gw = dbm.waConfig();
    if (!gw.aktif || !gw.url) return { skip: 'gateway', ingat: 0, telat: 0 };
    const tgl = dbm.today();
    /* KALENDER AKADEMIK: hari libur / ujian / kegiatan → tidak ada pengingat &
       peringatan mengajar karena KBM reguler tidak berlaku. */
    if (dbm.kalenderNonaktif(tgl)) {
      const kal = dbm.kalenderOfDate(tgl) || {};
      return { skip: 'libur', kalender: kal.kategori || '', ingat: 0, telat: 0, tanggal: tgl };
    }
    const hari = dbm.hariOf(tgl);
    const cfg = dbm.jadwalConfig();
    let taId = taOf({});
    let slots = dbm.jadwalRows(taId).filter(r => Number(r.hari) === hari);
    if (!slots.length) {
      for (const id of semuaTaIds()) {
        if (Number(id) === Number(taId)) continue;
        const coba = dbm.jadwalRows(id).filter(r => Number(r.hari) === hari);
        if (coba.length) { slots = coba; taId = Number(id); break; }
      }
    }
    if (!slots.length) return { skip: 'jadwal', ingat: 0, telat: 0, tanggal: tgl };

    const st = dbm.allSettings();
    const tukar = dbm.tukarMap(tgl);
    const sekarang = dbm.nowMenit();
    const tanggalLabel = dbm.tanggalPanjang(tgl);
    const guruOf = (id) => db.prepare('SELECT id,nama,phone FROM users WHERE id=?').get(Number(id) || 0) || {};
    const atasan = [...new Set([st.kepsek_wa, st.wakasek_kur_wa, wj.piketWa]
      .map(v => lib.normPhone(String(v || ''))).filter(Boolean))];
    const hasil = { ingat: 0, telat: 0, atasan: 0, tanpa_nomor: 0, tanggal: tgl, slot: slots.length, ta: taId };

    for (const r of slots) {
      if (!Number(r.guru_id)) continue;
      const w = dbm.absensiWindow(r, tgl, cfg);
      if (!w.sesi || w.sesi.istirahat || !w.hariOk) continue;
      const mulai = dbm.jamMenit(w.sesi.mulai);
      const selesai = dbm.jamMenit(w.sesi.selesai);
      if (mulai === null || selesai === null) continue;
      /* guru EFEKTIF (tukar / penunjukan pengganti) yang bertanggung jawab hari ini */
      const tukarRow = tukar.get(Number(r.id));
      const guru = guruOf(tukarRow ? tukarRow.ke_guru : r.guru_id);
      if (!guru.id) continue;
      const kelas = r.kelas_nama || kelasNamaOf(dbm.jadwalKelasIds(r));
      const vars = {
        guru: guru.nama || '-', mapel: r.mapel_nama || '-', kode: r.mapel_kode || '',
        kelas: kelas || '-', ruang: r.ruang || '-', jam: `${w.sesi.mulai}–${w.sesi.selesai}`,
        sesi: w.sesi.no ? `Jam ke-${w.sesi.no}` : (w.sesi.label || `Sesi ${r.sesi}`),
        tanggal: tanggalLabel, sekolah: st.sekolah_nama || '', menit: String(wj.ingatMenit), lewat: ''
      };

      /* 1) PENGINGAT SEBELUM JAM PELAJARAN */
      if (wj.ingatAktif && sekarang >= mulai - wj.ingatMenit && sekarang < mulai) {
        const ref = `jadwal-ingat:${r.id}:${tgl}`;
        if (!waSudahKirimRef(ref)) {
          if (!guru.phone) hasil.tanpa_nomor++;
          else {
            const pesan = dbm.waFill(dbm.waTemplateJadwalIngat(), vars);
            const kirim = await dbm.waSend(guru.phone, pesan);
            dbm.waLogAdd({
              nama: guru.nama, phone: guru.phone, jenis: 'jadwal-ingat', pesan,
              status: kirim.status, sumber: 'gateway', error: kirim.error || '',
              taId: Number(r.ta_id) || taId, ref, modul: 'akademik'
            });
            if (kirim.status !== 'gagal') hasil.ingat++;
          }
        }
      }

      /* 2) PERINGATAN KETERLAMBATAN CHECK-IN */
      if (wj.telatAktif && sekarang >= mulai + wj.telatMenit && sekarang < selesai) {
        const sudah = db.prepare('SELECT id FROM absensi_guru WHERE jadwal_id=? AND tanggal=?').get(Number(r.id), tgl)
          || db.prepare('SELECT id FROM absensi_guru_izin WHERE jadwal_id=? AND tanggal=?').get(Number(r.id), tgl);
        if (!sudah) {
          const varsTelat = { ...vars, lewat: String(Math.max(0, sekarang - mulai)) };
          const refGuru = `jadwal-telat:${r.id}:${tgl}`;
          if (!waSudahKirimRef(refGuru)) {
            if (!guru.phone) hasil.tanpa_nomor++;
            else {
              const pesan = dbm.waFill(dbm.waTemplateJadwalTelat(), varsTelat);
              const kirim = await dbm.waSend(guru.phone, pesan);
              dbm.waLogAdd({
                nama: guru.nama, phone: guru.phone, jenis: 'jadwal-telat', pesan,
                status: kirim.status, sumber: 'gateway', error: kirim.error || '',
                taId: Number(r.ta_id) || taId, ref: refGuru, modul: 'akademik'
              });
              if (kirim.status !== 'gagal') hasil.telat++;
            }
          }
          if (wj.telatAtasanAktif && atasan.length) {
            const refAtasan = `jadwal-telat-atasan:${r.id}:${tgl}`;
            if (!waSudahKirimRef(refAtasan)) {
              const pesan = dbm.waFill(dbm.waTemplateJadwalTelatAtasan(), varsTelat);
              let terkirim = false;
              for (const nomor of atasan) {
                const kirim = await dbm.waSend(nomor, pesan);
                if (kirim.status !== 'gagal') terkirim = true;
              }
              dbm.waLogAdd({
                nama: 'Kepala Sekolah / Wakasek Kurikulum / Guru Piket', phone: atasan.join(','),
                jenis: 'jadwal-telat-atasan', pesan, status: terkirim ? 'terkirim' : 'gagal',
                sumber: 'gateway', error: terkirim ? '' : 'Semua nomor tujuan gagal / tidak valid.',
                taId: Number(r.ta_id) || taId, ref: refAtasan, modul: 'akademik'
              });
              if (terkirim) hasil.atasan++;
            }
          }
        }
      }
    }
    return hasil;
  }

  /* tombol "Cek Pengingat Sekarang" pada Pengaturan → WhatsApp Gateway */
  post('/api/wa/jadwal/cek', async (req, res) => {
    const user = guard(req, res, 'pengaturan', 'write'); if (!user) return;
    const hasil = await checkWaJadwal();
    const pesan = hasil.skip === 'nonaktif'
      ? 'Pengingat jadwal & peringatan check-in sedang NONAKTIF — aktifkan lalu simpan dulu.'
      : hasil.skip === 'gateway' ? 'Gateway WhatsApp belum aktif/dikonfigurasi.'
        : hasil.skip === 'libur' ? `Hari ini ditandai di kalender akademik — ${dbm.KALENDER_KATEGORI_LABEL[hasil.kalender] || 'agenda sekolah'}; KBM reguler tidak berlaku sehingga tidak ada pengingat.`
        : hasil.skip === 'jadwal' ? 'Tidak ada jadwal pada hari ini.'
          : `Pemeriksaan selesai — ${hasil.ingat} pengingat, ${hasil.telat} peringatan guru, ${hasil.atasan} laporan ke manajemen${hasil.tanpa_nomor ? `, ${hasil.tanpa_nomor} tanpa nomor HP` : ''}.`;
    dbm.logAudit(user, 'CEK', 'pengaturan', `Cek pengingat jadwal WhatsApp: ${pesan}`, ipOf(req));
    json(res, 200, { ok: true, ...hasil, pesan });
  });

  return { checkWaRekap, autoAlfaHarian, checkWaJadwal };
};
