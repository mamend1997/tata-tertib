'use strict';
/* =====================================================================
   MODUL AI TIMETABLE GENERATOR — penyusun jadwal pelajaran otomatis
   ---------------------------------------------------------------------
   Dipasang oleh server.js lewat mount(api) (helper guard/readBody/json/fail).

   Alur:
   1. Data master → `jadwal_beban` (jam/pekan per kelas × mapel, guru, ruang),
      `guru_jam_target.max_jam` (batas jam/pekan) + `tidak_hadir` (hari tidak
      bersedia mengajar), `jadwal_ruang` (daftar ruang/lab).
   2. Aturan centang → pengaturan `jadwal_ai_cfg`: hindari jam kosong, sebar mapel
      berat, sebar mapel harian, hormati ruang, hormati batas guru; mode
      `tambah` (tambal slot kosong) / `ganti` (susun ulang kelas terpilih).
   3. `POST /api/jadwal/ai/generate` → PRATINJAU (tidak menulis jadwal).
   4. `POST /api/jadwal/ai/apply`    → validasi ULANG di server → transaksi → audit.
      Bentrok keras (kelas/guru/ruang dobel) → 409, tidak ada perubahan.

   Mesin penyusun murni (`susunJadwal`) tidak menyentuh DB sehingga dapat diuji
   langsung. Algoritma: backtracking + MRV (unit dengan kandidat tersedikit
   dulu) dengan penilaian lunak (padatkan hari, sebar mapel), anggaran node,
   lalu pengisian darurat untuk sisa unit (aturan keras tetap dipatuhi).
   ===================================================================== */
const dbm = require('./db');
const { db } = dbm;

/* ============================ ENGINE (murni) ============================ */

const HARI_NAMA = (h) => dbm.HARI_LABEL[h] || `Hari ${h}`;

/** PRNG deterministik (mulberry32) — seed sama = hasil sama */
function rng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  if (!a) a = 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** daftar sesi MENGELAS (bukan istirahat) untuk satu hari */
function slotHari(cfg, hari) {
  const list = dbm.sesiOfHari(cfg, hari) || [];
  return list.filter(s => !s.istirahat).map(s => ({
    sesi: Number(s.idx), no: Number(s.no) || Number(s.idx), mulai: s.mulai, selesai: s.selesai, label: s.label
  }));
}

/**
 * Susun jadwal (murni, tanpa DB).
 * @param {object} inp { taId, cfg, kelas[], mapel[], beban[], guru[], ruang[], aturan, mode, kelasIds, seed, jadwal[] }
 */
function susunJadwal(inp = {}) {
  const cfg = inp.cfg || dbm.jadwalConfig();
  const aturan = Object.assign({}, dbm.JADWAL_AI_ATURAN_DEFAULT, inp.aturan || {});
  const mode = inp.mode === 'ganti' ? 'ganti' : 'tambah';
  const seed = Number(inp.seed) || 0;
  const rand = rng(seed);
  const hariList = (cfg.hari || []).slice().sort((a, b) => a - b);
  const kelasAll = (Array.isArray(inp.kelas) ? inp.kelas : []).map(k => ({ ...k, id: Number(k.id) }));
  const kelasMap = new Map(kelasAll.map(k => [k.id, k]));
  const mapelAll = (Array.isArray(inp.mapel) ? inp.mapel : []).map(m => ({ ...m, id: Number(m.id) }));
  const mapelMap = new Map(mapelAll.map(m => [m.id, m]));
  const guruAll = (Array.isArray(inp.guru) ? inp.guru : []).map(g => ({
    ...g, guru_id: Number(g.guru_id),
    target_minggu: Number(g.target_minggu) || 0,
    max_jam: Number(g.max_jam) || 0,
    tidak_hadir: (Array.isArray(g.tidak_hadir) ? g.tidak_hadir : []).map(Number).filter(n => Number.isInteger(n))
  }));
  const guruMap = new Map(guruAll.map(g => [g.guru_id, g]));
  /* guru pengampu per mapel dari Data Master Mata Pelajaran (guru pertama = utama) */
  const pengampu = new Map();
  for (const g of guruAll) {
    for (const m of (Array.isArray(g.mapel) ? g.mapel : [])) {
      const mid = Number(m.id) || 0;
      if (!mid) continue;
      const arr = pengampu.get(mid) || [];
      arr.push(g.guru_id);
      pengampu.set(mid, arr);
    }
  }

  /* aturan efektif + metadata internal (hari aktif, indeks hari, hari terlarang guru) */
  const hariIdx = new Map(hariList.map((h, i) => [h, i]));
  const tidakHadir = {};
  for (const g of guruAll) tidakHadir[g.guru_id] = g.tidak_hadir;
  const AT = Object.assign({}, aturan, {
    _cfg: cfg, _hariList: hariList, _hariIdx: hariIdx, _tidakHadir: tidakHadir
  });

  /* ------------------------------ okupansi ------------------------------ */
  const kelasBusy = new Set();       /* `${kid}:${hari}:${sesi}` */
  const guruBusy = new Set();        /* `${gid}:${hari}:${sesi}` */
  const guruHari = new Map();        /* `${gid}:${hari}` → jam */
  const guruSlot = new Map();        /* gid → jam */
  const kelasMapelHari = new Map();  /* `${kid}:${mid}:${hari}` → jam */
  const ruangBusy = new Map();       /* `${ruang}:${hari}:${sesi}` → jumlah pemakaian */
  const ruangAktif = (Array.isArray(inp.ruang) ? inp.ruang : [])
    .filter(r => Number(r.aktif) === 1)
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
  const k2 = (a, b) => `${a}:${b}`;
  const k3 = (a, b, c) => `${a}:${b}:${c}`;

  const hapus = [];
  const dipertahankan = [];
  const peringatan = [];

  const tandai = (s, sign) => {
    for (const kid of (s.kelas_ids || [])) {
      const key = k3(kid, s.hari, s.sesi);
      if (sign > 0) kelasBusy.add(key); else kelasBusy.delete(key);
    }
    const gid = Number(s.guru_id) || 0;
    if (gid) {
      const gb = k3(gid, s.hari, s.sesi);
      if (sign > 0) guruBusy.add(gb); else guruBusy.delete(gb);
      const gh = k2(gid, s.hari);
      guruHari.set(gh, Math.max(0, (guruHari.get(gh) || 0) + sign));
      guruSlot.set(gid, Math.max(0, (guruSlot.get(gid) || 0) + sign));
    }
    for (const kid of (s.kelas_ids || [])) {
      const key = k3(kid, s.mapel_id, s.hari);
      kelasMapelHari.set(key, Math.max(0, (kelasMapelHari.get(key) || 0) + sign));
    }
    const rg = String(s.ruang || '').trim().toLowerCase();
    if (rg) {
      const rb = k3(rg, s.hari, s.sesi);
      const jumlah = ruangBusy.get(rb) || 0;
      if (sign > 0) ruangBusy.set(rb, jumlah + 1);
      else if (jumlah <= 1) ruangBusy.delete(rb);
      else ruangBusy.set(rb, jumlah - 1);
    }
  };

  const kelasTerpilih = new Set((Array.isArray(inp.kelasIds) && inp.kelasIds.length
    ? inp.kelasIds.map(Number) : kelasAll.map(k => k.id)));

  /* ---- okupansi awal: muat slot yang sudah ada ---- */
  const terpasangAwal = new Map();   /* `${kid}:${mid}` → jumlah slot yang DIPERTAHANKAN */
  for (const row of (Array.isArray(inp.jadwal) ? inp.jadwal : [])) {
    const kids = (row.kelas_ids || []).map(Number);
    const masukPilihan = kids.some(k => kelasTerpilih.has(k));
    if (mode === 'ganti' && masukPilihan) {
      hapus.push({
        id: Number(row.id) || 0, hari: Number(row.hari), sesi: Number(row.sesi),
        mapel_id: Number(row.mapel_id), guru_id: Number(row.guru_id),
        kelas_ids: kids, ruang: row.ruang || '', alasan: 'Dibongkar untuk disusun ulang'
      });
      continue;
    }
    tandai({ hari: Number(row.hari), sesi: Number(row.sesi), mapel_id: Number(row.mapel_id), guru_id: Number(row.guru_id), kelas_ids: kids, ruang: row.ruang || '' }, 1);
    dipertahankan.push({ id: Number(row.id) || 0, hari: Number(row.hari), sesi: Number(row.sesi) });
    for (const kid of kids) {
      const key = k2(kid, row.mapel_id);
      terpasangAwal.set(key, (terpasangAwal.get(key) || 0) + 1);
    }
  }

  /* --------------------- kebutuhan (unit = 1 jam) --------------------- */
  const beban = (Array.isArray(inp.beban) ? inp.beban : [])
    .map(b => ({ ...b, kelas_id: Number(b.kelas_id), mapel_id: Number(b.mapel_id), guru_id: Number(b.guru_id) || 0, jam_minggu: Number(b.jam_minggu) || 0 }))
    .filter(b => b.kelas_id && b.mapel_id && b.jam_minggu > 0 && kelasTerpilih.has(b.kelas_id));

  const sisa = [];
  const unitsByClass = new Map();
  let uid = 0;
  for (const b of beban) {
    const kid = b.kelas_id, mid = b.mapel_id;
    const terpasang = terpasangAwal.get(k2(kid, mid)) || 0;
    /* mode 'tambah' hanya menambal kekurangannya; mode 'ganti' menyusun penuh */
    const kurang = mode === 'tambah' ? Math.max(0, b.jam_minggu - terpasang) : b.jam_minggu;
    if (!kurang) continue;
    let gid = Number(b.guru_id) || 0;
    if (!gid) gid = Number((pengampu.get(mid) || [])[0]) || 0;
    const mapel = mapelMap.get(mid) || {};
    const guru = guruMap.get(gid) || null;
    let ruangFixed = String(b.ruang || '').trim();
    const ruangWajib = Number(mapel.ruang_id) || 0;
    if (ruangWajib) {
      if (!mapel.ruang_wajib_nama || Number(mapel.ruang_wajib_aktif) !== 1) {
        sisa.push({
          kelas_id: kid, kelas_nama: (kelasMap.get(kid) || {}).nama || '-', mapel_id: mid,
          mapel_nama: mapel.nama || '-', mapel_kode: mapel.kode || '', guru_id: Number(b.guru_id) || 0,
          guru_nama: '', jam: kurang, alasan: `Ruangan wajib untuk ${mapel.nama || 'mapel ini'} tidak ditemukan atau sedang nonaktif.`
        });
        continue;
      }
      ruangFixed = String(mapel.ruang_wajib_nama);
    }
    const u = {
      uid: `u${uid++}`, kelas_id: kid, mapel_id: mid, guru_id: gid,
      jam_minggu: kurang, ruang: ruangFixed, ruang_wajib: ruangWajib ? String(mapel.ruang_wajib_nama) : '',
      mapel_nama: mapel.nama || '-', mapel_kode: mapel.kode || '',
      mapel_max_hari: Number(mapel.max_jam_hari) || 0,
      guru_nama: guru ? guru.nama : '', kelas_nama: (kelasMap.get(kid) || {}).nama || '-',
      gagal: ''
    };
    if (!kelasMap.has(kid)) continue;
    if (!u.guru_id) {
      u.gagal = 'Guru pengampu belum ditentukan pada Data Master Mata Pelajaran.';
      sisa.push({ kelas_id: kid, kelas_nama: u.kelas_nama, mapel_id: mid, mapel_nama: u.mapel_nama, mapel_kode: u.mapel_kode, guru_id: 0, guru_nama: '', jam: kurang, alasan: u.gagal });
      continue;
    }
    /* SATU unit per jam pelajaran (uid unik) — unit mapel yang sama dipakai
       beberapa kali, jadi tidak boleh berbagi uid atau hanya satu jam yang bisa
       ditempatkan. */
    for (let j = 0; j < kurang; j++) {
      const unit = { ...u, uid: `${u.uid}#${j}` };
      const arr = unitsByClass.get(kid) || [];
      arr.push(unit);
      unitsByClass.set(kid, arr);
    }
  }

  /* --------------------------- batas jam guru --------------------------- */
  const cfgMaxGuruJam = Math.max(1, Number(cfg.maxGuruJam) || 8);
  const cfgMaxMapelJam = Math.max(1, Number(cfg.maxMapelJam) || 2);
  const batasMinggu = (g) => {
    const raw = Number(g.max_jam) || Number(g.target_minggu) || 0;
    return raw > 0 ? Math.min(48, raw) : 0;    /* 0 = tidak dibatasi */
  };

  /** apakah slot (hari,sesi) boleh dipakai unit pada okupansi saat ini */
  const boleh = (u, c, at) => {
    const kid = u.kelas_id, gid = u.guru_id;
    if (kelasBusy.has(k3(kid, c.hari, c.sesi))) return false;
    if (guruBusy.has(k3(gid, c.hari, c.sesi))) return false;
    if (at.hormati_batas_guru) {
      const g = guruMap.get(gid) || {};
      if ((g.tidak_hadir || []).includes(c.hari)) return false;
      if ((guruHari.get(k2(gid, c.hari)) || 0) + 1 > cfgMaxGuruJam) return false;
      const bm = batasMinggu(g);
      if (bm && (guruSlot.get(gid) || 0) + 1 > bm) return false;
    }
    /* mapel sama pada hari yang sama */
    const sudah = kelasMapelHari.get(k3(kid, u.mapel_id, c.hari)) || 0;
    const batasSehari = Math.max(1, Math.min(at.sebar_mapel_harian ? 1 : cfgMaxMapelJam, u.mapel_max_hari || 99));
    if (sudah + 1 > batasSehari) return false;
    /* Bentrok fisik selalu keras; checkbox aturan tidak dapat menonaktifkannya. */
    const rg = String(c.ruang || '').trim().toLowerCase();
    if (rg && ruangBusy.has(k3(rg, c.hari, c.sesi))) return false;
    return true;
  };

  /** penalti lunak (lebih kecil lebih baik) */
  const skor = (u, c, at) => {
    let sc = c.urutHari * 100 + c.urutSesi * 4;      /* padatkan: jam awal diutamakan */
    if (at.hindari_jam_kosong) {
      let adaSesudah = false, adaSebelum = false;
      for (const s2 of slotHari(cfg, c.hari)) {
        if (!kelasBusy.has(k3(u.kelas_id, c.hari, s2.sesi))) continue;
        if (s2.no > c.no) adaSesudah = true;
        if (s2.no < c.no) adaSebelum = true;
      }
      if (!adaSebelum && adaSesudah) sc += 150;
      else if (adaSebelum && !adaSesudah) sc += 70;
      /* jangan meninggalkan lubang pada hari guru tsb */
      let gSesudah = false, gSebelum = false;
      for (const s2 of slotHari(cfg, c.hari)) {
        if (!guruBusy.has(k3(u.guru_id, c.hari, s2.sesi))) continue;
        if (s2.no > c.no) gSesudah = true;
        if (s2.no < c.no) gSebelum = true;
      }
      if (!gSebelum && gSesudah) sc += 100;
    }
    if (at.sebar_mapel_berat && u.jam_minggu >= 4) sc += c.no * 5;   /* mapel berat lebih awal */
    if (at.sebar_mapel_harian) {
      for (const dh of [-1, 1]) {
        if (kelasMapelHari.get(k3(u.kelas_id, u.mapel_id, c.hari + dh))) sc += 30;
      }
    }
    return sc + rand() * 3;
  };

  const slotsBaru = [];
  const ringkasanKelas = [];

  const kelasDiurut = [...unitsByClass.keys()].map(kid => ({ kid, units: unitsByClass.get(kid) }))
    .sort((a, b) => {
      const ja = a.units.length, jb = b.units.length;
      if (jb !== ja) return jb - ja;
      return String((kelasMap.get(a.kid) || {}).nama || '').localeCompare(String((kelasMap.get(b.kid) || {}).nama || ''));
    });

  for (const { kid, units } of kelasDiurut) {
    const kelas = kelasMap.get(kid) || { nama: '-' };
    const dipakai = new Set();
    const rencana = [];
    let node = 0;
    const NODE_LIMIT = 6000;
    const daftarSisa = () => units.filter(u => !dipakai.has(u.uid));
    /* kandidat terurut skor (murah → mahal); dipakai untuk MRV & percabangan */
    const kandidat = (u, at) => {
      const daftarRuang = u.ruang ? [u.ruang] : (ruangAktif.length ? ruangAktif.map(r => r.nama) : ['']);
      const cand = kandidatOf(u, AT)
        .flatMap(c => daftarRuang.map(ruang => ({ ...c, ruang })))
        .filter(c => boleh(u, c, at));
      const dinilai = cand.map(c => ({ c, sc: skor(u, c, at) }));
      dinilai.sort((a, b) => a.sc - b.sc);
      return dinilai.map(x => x.c);
    };

    const rekam = (list) => {
      if (!list.length) return true;
      if (node++ > NODE_LIMIT) return false;
      let pilih = null;
      for (const u of list) {
        const cand = kandidat(u, AT);
        if (!cand.length) return false;              /* dead end: unit ini tak bisa ditempatkan */
        if (!pilih || cand.length < pilih.cand.length) pilih = { u, cand };
        if (cand.length === 1) break;                /* MRV: tidak ada pilihan lain */
      }
      if (!pilih) return false;
      const { u, cand } = pilih;
      /* percabangan dibatasi 8 kandidat terbaik agar anggaran node cukup */
      const batas = Math.min(cand.length, 8);
      for (let i = 0; i < batas; i++) {
        const c = cand[i];
        const s = { hari: c.hari, sesi: c.sesi, mapel_id: u.mapel_id, guru_id: u.guru_id, kelas_ids: [kid], ruang: c.ruang, baru: true };
        dipakai.add(u.uid);
        tandai(s, 1);
        rencana.push({ s, u, c });
        if (rekam(daftarSisa())) return true;
        rencana.pop();
        tandai(s, -1);
        dipakai.delete(u.uid);
        if (node > NODE_LIMIT) return false;
      }
      return false;
    };

    let ok = false;
    try { ok = rekam(daftarSisa()); } catch (e) { ok = false; }

    /* pengisian darurat: hanya preferensi (padatkan hari, mapel berat) dilepas.
       Aturan "mapel sama tidak dobel dalam sehari", "ruang tidak dobel" dan
       "batas jam guru" TETAP dipatuhi — kalau masih tidak bisa, jam itu masuk
       daftar "Sisa jam" beserta alasannya. */
    if (!ok) {
      const lunak = { ...AT, hindari_jam_kosong: 0, sebar_mapel_berat: 0 };
      for (const u of daftarSisa()) {
        const cand = kandidat(u, lunak);
        if (!cand.length) continue;
        cand.sort((a, b) => (a.urutHari - b.urutHari) || (a.no - b.no));
        const c = cand[0];
        const s = { hari: c.hari, sesi: c.sesi, mapel_id: u.mapel_id, guru_id: u.guru_id, kelas_ids: [kid], ruang: c.ruang, baru: true };
        dipakai.add(u.uid);
        tandai(s, 1);
        rencana.push({ s, u, c });
      }
    }

    for (const u of daftarSisa()) {
      sisa.push({
        kelas_id: kid, kelas_nama: kelas.nama, mapel_id: u.mapel_id, mapel_nama: u.mapel_nama,
        mapel_kode: u.mapel_kode, guru_id: u.guru_id, guru_nama: u.guru_nama, jam: 1,
        alasan: alasanGagal(u, {
          hariList, guruMap, guruSlot, batasMinggu, at: AT, cfg, kelasMapelHari,
          ruangBusy, ruangAktif
        })
      });
    }

    for (const { s, u } of rencana) {
      slotsBaru.push({
        ...s,
        kelas_nama: kelas.nama,
        mapel_nama: u.mapel_nama, mapel_kode: u.mapel_kode, guru_nama: u.guru_nama,
        hari_nama: HARI_NAMA(s.hari),
        label_sesi: (slotHari(cfg, s.hari).find(x => x.sesi === s.sesi) || {}).label || `Sesi ${s.sesi}`,
        alasan: ''
      });
    }

    const target = units.length;
    const jadi = rencana.length;
    ringkasanKelas.push({ kelas_id: kid, kelas_nama: kelas.nama, target, jadi, sisa: target - jadi, persen: target ? Math.round(jadi / target * 100) : 0 });
    if (target - jadi > 0) peringatan.push(`${kelas.nama}: ${target - jadi} jam tidak dapat ditempatkan — lihat daftar "Sisa jam".`);
  }

  const jamPerHari = slotHari(cfg, hariList[0] === undefined ? 1 : hariList[0]).length;
  const totalSlot = kelasAll.filter(k => kelasTerpilih.has(k.id)).length * hariList.length * jamPerHari;
  const terpakai = kelasBusy.size;
  const kapasitas = {
    hari: hariList.length, jam_per_hari: jamPerHari, total_slot: totalSlot,
    terpakai, sisa: Math.max(0, totalSlot - terpakai)
  };
  if (sisa.length) peringatan.push(`${sisa.length} jam pelajaran tidak terjadwal.`);
  const tanpaRuang = slotsBaru.filter(s => !String(s.ruang || '').trim()).length;
  if (tanpaRuang) peringatan.push(`${tanpaRuang} slot belum memiliki ruangan — tambahkan ruang aktif pada Master Ruangan agar dapat dialokasikan otomatis.`);
  if (kapasitas.sisa > 0) peringatan.push(`Masih ada ${kapasitas.sisa} slot kosong (kapasitas lebih besar dari kebutuhan jam pelajaran).`);
  if (!slotsBaru.length && !hapus.length) peringatan.push('Tidak ada perubahan: seluruh jam pelajaran sudah terpasang pada mode ini.');

  return {
    ta_id: Number(inp.taId) || 0, mode, aturan: bersihkanAturan(aturan), seed,
    slots: slotsBaru, sisa, hapus, dipertahankan,
    ringkasan: {
      kelas: ringkasanKelas,
      total_unit: ringkasanKelas.reduce((s, k) => s + k.target, 0),
      terpasang: ringkasanKelas.reduce((s, k) => s + k.jadi, 0),
      sisa: ringkasanKelas.reduce((s, k) => s + k.sisa, 0),
      mapel: new Set(beban.map(b => b.mapel_id)).size,
      guru: new Set(beban.map(b => b.guru_id).filter(Boolean)).size
    },
    kapasitas, peringatan
  };
}

/** kandidat (hari,sesi) mungkin untuk sebuah unit menurut pengaturan hari & guru */
function kandidatOf(u, at) {
  const out = [];
  const hariTerlarang = new Set(at._tidakHadir && at._tidakHadir[u.guru_id] ? at._tidakHadir[u.guru_id] : []);
  for (const hari of at._hariList) {
    if (hariTerlarang.has(hari)) continue;
    for (const s of slotHari(at._cfg, hari)) {
      out.push({ hari, sesi: s.sesi, no: s.no, urutHari: at._hariIdx.get(hari), urutSesi: s.no });
    }
  }
  return out;
}

/** alasan sebuah unit gagal ditempatkan (laporan "Sisa jam") */
function alasanGagal(u, ctx) {
  const { hariList, guruMap, guruSlot, batasMinggu, at, cfg, kelasMapelHari, ruangBusy, ruangAktif } = ctx;
  const g = guruMap.get(u.guru_id);
  if (!g) return 'Guru pengampu tidak ditemukan pada Data Master.';
  const terlarang = new Set(g.tidak_hadir || []);
  const hariTersedia = hariList.filter(h => !terlarang.has(h));
  if (!hariTersedia.length) return `${u.guru_nama} tidak bersedia mengajar pada seluruh hari aktif.`;
  /* 1. batas jam mengajar guru per pekan */
  const bm = at.hormati_batas_guru ? batasMinggu(g) : 0;
  const terpakai = guruSlot.get(u.guru_id) || 0;
  if (bm && terpakai >= bm) {
    return `Batas ${bm} jam/pekan untuk ${u.guru_nama} sudah tercapai (${terpakai} jam).`;
  }
  /* 2. batas jam mapel yang sama per hari untuk kelas ini */
  let hariPenuh = 0;
  for (const h of hariTersedia) {
    const n = kelasMapelHari.get(`${u.kelas_id}:${u.mapel_id}:${h}`) || 0;
    const batas = Math.max(1, Math.min(at.sebar_mapel_harian ? 1 : (Number(cfg.maxMapelJam) || 2), u.mapel_max_hari || 99));
    if (n >= batas) hariPenuh++;
  }
  if (hariPenuh >= hariTersedia.length) {
    return `Batas ${Math.max(1, Math.min(at.sebar_mapel_harian ? 1 : (Number(cfg.maxMapelJam) || 2), u.mapel_max_hari || 99))} jam ${u.mapel_nama} per hari sudah tercapai pada seluruh hari.`;
  }
  const pilihanRuang = u.ruang ? [u.ruang] : (ruangAktif || []).map(r => r.nama);
  if (pilihanRuang.length) {
    const semuaPenuh = hariTersedia.every(h => slotHari(cfg, h)
      .every(s => pilihanRuang.every(nama => ruangBusy.has(`${String(nama).trim().toLowerCase()}:${h}:${s.sesi}`))));
    if (semuaPenuh) {
      return u.ruang_wajib
        ? `Ruangan wajib ${u.ruang_wajib} selalu terpakai pada slot yang tersedia.`
        : 'Semua ruangan terdaftar sudah terpakai pada slot yang tersedia.';
    }
  }
  return 'Tidak ada jam kosong yang tersisa (kelas/guru sudah terjadwal pada seluruh slot yang tersedia).';
}

/** buang metadata internal (diawali "_") sebelum aturan dikirim ke klien */
function bersihkanAturan(at) {
  const out = {};
  for (const [k, v] of Object.entries(at || {})) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/* ============================ MODUL ROUTES ============================ */

module.exports = function mount(api) {
  const { get, post, json, fail, guard, readBody, ipOf } = api;

  /** TA efektif (parameter → ta_aktif → TA aktif) — sama seperti akademik.js */
  const taOf = (q) => {
    const diminta = Number((q && q.ta) || 0);
    if (diminta && dbm.tahunList().some(t => Number(t.id) === diminta)) return diminta;
    const aktif = Number(dbm.getSetting('ta_aktif', 0)) || 0;
    if (aktif && dbm.tahunList().some(t => Number(t.id) === aktif)) return aktif;
    return Number((dbm.tahunAktif() || {}).id) || Number(((dbm.tahunList() || [])[0] || {}).id) || 0;
  };

  /** kelas milik TA terpilih (fallback seluruh rombel bila master belum diisi TA) */
  const kelasOfTa = (taId) => {
    const semua = dbm.kelasList(0);
    const milik = semua.filter(k => !k.ta_id || Number(k.ta_id) === Number(taId));
    return milik.length ? milik : semua;
  };

  const kelasIdsOf = (row) => {
    try { const v = JSON.parse(row.kelas_ids || '[]'); return Array.isArray(v) ? v.map(Number).filter(Boolean) : []; }
    catch (e) { return []; }
  };

  const konteks = (q) => {
    const taId = taOf(q);
    const cfg = dbm.jadwalConfig();
    const kelas = kelasOfTa(taId).map(k => ({ id: Number(k.id), nama: k.nama, tingkat: k.tingkat, ta_id: Number(k.tahun_ajaran_id) || 0 }));
    const mapel = db.prepare(`SELECT m.id,m.kode,m.nama,m.kelompok,m.urut,m.max_jam_hari,m.aktif,m.ruang_id,
        r.nama AS ruang_wajib_nama,r.aktif AS ruang_wajib_aktif
      FROM mapel m LEFT JOIN jadwal_ruang r ON r.id=m.ruang_id ORDER BY m.urut, m.nama`).all()
      .map(m => ({
        id: Number(m.id), kode: m.kode, nama: m.nama, kelompok: m.kelompok,
        urut: Number(m.urut) || 0, max_jam_hari: Number(m.max_jam_hari) || 0, aktif: Number(m.aktif),
        ruang_id: Number(m.ruang_id) || 0, ruang_wajib_nama: m.ruang_wajib_nama || '',
        ruang_wajib_aktif: Number(m.ruang_wajib_aktif) || 0
      }));
    const guru = dbm.jadwalGuruBatasRows(taId);
    const beban = dbm.jadwalBebanRows(taId);
    const ruang = dbm.jadwalRuangRows();
    const jadwal = dbm.jadwalRows(taId).map(r => ({
      id: Number(r.id), hari: Number(r.hari), sesi: Number(r.sesi), mapel_id: Number(r.mapel_id),
      guru_id: Number(r.guru_id), kelas_ids: kelasIdsOf(r), ruang: r.ruang || ''
    }));
    const pengaturan = dbm.jadwalAiConfig();
    return { taId, cfg, kelas, mapel, guru, beban, ruang, jadwal, pengaturan };
  };

  /* ----------------------------- konfigurasi ----------------------------- */
  get('/api/jadwal/ai/konfigurasi', (req, res, q) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const k = konteks(req.query || q || {});
    json(res, 200, {
      ok: true, ta_id: k.taId, hari_label: dbm.HARI_LABEL,
      hari: k.cfg.hari, sesi: k.cfg.sesi, sesi_hari: k.cfg.sesiHari,
      batas_guru_hari: k.cfg.maxGuruJam, batas_mapel_hari: k.cfg.maxMapelJam,
      aturan_default: dbm.JADWAL_AI_ATURAN_DEFAULT,
      pengaturan: k.pengaturan,
      kelas: k.kelas, mapel: k.mapel, guru: k.guru, beban: k.beban, ruang: k.ruang,
      ringkasan: {
        beban_total: k.beban.reduce((s, b) => s + b.jam_minggu, 0),
        slot_terpasang: k.jadwal.length,
        guru_terpakai: new Set(k.beban.map(b => Number(b.guru_id)).filter(Boolean)).size,
        ruang_aktif: k.ruang.filter(r => Number(r.aktif) === 1).length,
        hari: k.cfg.hari.length,
        jam_per_hari: slotHari(k.cfg, k.cfg.hari[0] === undefined ? 1 : k.cfg.hari[0]).length
      }
    });
  });

  post('/api/jadwal/ai/konfigurasi', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const cfg = dbm.jadwalAiConfigSave({ aturan: b.aturan, mode: b.mode, kelas_ids: b.kelas_ids, seed: b.seed });
    const aktif = Object.entries(cfg.aturan).filter(([, v]) => v).map(([k2]) => k2);
    dbm.logAudit(user, 'UBAH', 'jadwal', `Konfigurasi AI Timetable: mode ${cfg.mode}, aturan ${aktif.join('/') || 'kosong'}, ${cfg.kelas_ids.length} kelas`, ipOf(req));
    json(res, 200, { ok: true, pengaturan: cfg });
  });

  /* -------------------------------- guru -------------------------------- */
  post('/api/jadwal/ai/guru', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const items = Array.isArray(b.items) ? b.items : (b.guru_id ? [b] : []);
    if (!items.length) return fail(res, 400, 'Tidak ada data guru yang dikirim.');
    const n = dbm.jadwalGuruBatasSave(items, user);
    json(res, 200, { ok: true, jumlah: n, guru: dbm.jadwalGuruBatasRows(taOf(b)) });
  });

  /* -------------------------------- beban -------------------------------- */
  post('/api/jadwal/ai/beban', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const items = Array.isArray(b.items) ? b.items : (b.kelas_id && b.mapel_id ? [b] : []);
    if (!items.length) return fail(res, 400, 'Tidak ada baris beban yang dikirim.');
    const out = dbm.jadwalBebanSave(items, taOf(b), user);
    json(res, 200, { ok: true, ...out, beban: dbm.jadwalBebanRows(taOf(b)) });
  });

  /** tarik beban dari slot jadwal yang sudah tersusun (sinkronisasi sekali jalan) */
  post('/api/jadwal/ai/beban/sinkron', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const taId = taOf(b);
    const rows = db.prepare(`SELECT j.ta_id, CAST(je.value AS INTEGER) AS kelas_id, j.mapel_id,
        MIN(j.guru_id) AS guru_id, COUNT(*) AS jam, MIN(j.ruang) AS ruang
      FROM jadwal j, json_each(j.kelas_ids) je
      WHERE j.mapel_id IS NOT NULL AND TRIM(COALESCE(j.kelas_ids,''))<>''
      GROUP BY j.ta_id, CAST(je.value AS INTEGER), j.mapel_id`).all();
    const items = rows.map(r => ({
      kelas_id: Number(r.kelas_id), mapel_id: Number(r.mapel_id), guru_id: Number(r.guru_id) || 0,
      jam_minggu: Number(r.jam) || 0, ruang: r.ruang || ''
    }));
    if (!items.length) return fail(res, 400, 'Belum ada slot jadwal yang dapat disinkronkan.');
    const out = dbm.jadwalBebanSave(items, taId, user);
    json(res, 200, { ok: true, ...out, beban: dbm.jadwalBebanRows(taId) });
  });

  /* -------------------------------- ruang -------------------------------- */
  post('/api/jadwal/ai/ruang', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const out = dbm.jadwalRuangSave(b || {}, user);
    json(res, 200, { ok: true, ...out, ruang: dbm.jadwalRuangRows() });
  });

  post('/api/jadwal/ai/ruang/hapus', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = await readBody(req);
    const out = dbm.jadwalRuangDelete(b.id);
    if (!out.ok) return fail(res, 409, out.error);
    dbm.logAudit(user, 'HAPUS', 'jadwal', `Ruang/lab dihapus (id ${Number(b.id) || 0})`, ipOf(req));
    json(res, 200, { ok: true, ruang: dbm.jadwalRuangRows() });
  });

  /* ------------------------------- generate ------------------------------- */
  /** bangun input engine dari DB + parameter (aturan & mode dari body bila dikirim) */
  const buildInput = (q, body) => {
    const k = konteks({ ...(q || {}), ta: (body && body.ta) || (q && q.ta) });
    const p = k.pengaturan;
    const aturan = Object.assign({}, p.aturan, (body && body.aturan && typeof body.aturan === 'object') ? body.aturan : {});
    aturan.hormati_ruang = 1;
    const mode = ['tambah', 'ganti'].includes(String(body && body.mode)) ? String(body.mode)
      : (String(p.mode) === 'ganti' ? 'ganti' : 'tambah');
    const kirimKelas = Array.isArray(body && body.kelas_ids) ? body.kelas_ids.map(Number).filter(Boolean) : [];
    const kelasIds = kirimKelas.length ? kirimKelas : (Array.isArray(p.kelas_ids) ? p.kelas_ids.map(Number).filter(Boolean) : []);
    const seed = Number(body && body.seed) || Number(p.seed) || 0;
    return {
      taId: k.taId, cfg: k.cfg, kelas: k.kelas, mapel: k.mapel, guru: k.guru,
      beban: k.beban, ruang: k.ruang, aturan, mode,
      kelasIds: kelasIds.length ? kelasIds : k.kelas.map(x => x.id),
      seed, jadwal: k.jadwal, aturanBersih: aturan
    };
  };

  post('/api/jadwal/ai/generate', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    const b = (await readBody(req)) || {};
    const inp = buildInput(req.query || {}, b);
    if (!inp.kelasIds.length) return fail(res, 400, 'Pilih minimal satu kelas yang akan disusun.');
    const hasil = susunJadwal(inp);
    hasil.aturan = inp.aturanBersih;
    dbm.logAudit(user, 'TA', 'jadwal', `AI Timetable generate (mode ${inp.mode}): ${hasil.ringkasan.terpasang}/${hasil.ringkasan.total_unit} jam, ${hasil.slots.length} slot baru`, ipOf(req));
    try {
      dbm.setSetting('jadwal_ai_terakhir', JSON.stringify({
        ta_id: inp.taId, mode: inp.mode, seed: inp.seed, waktu: dbm.now(),
        terpasang: hasil.ringkasan.terpasang, total: hasil.ringkasan.total_unit,
        slot: hasil.slots.length, sisa: hasil.ringkasan.sisa
      }));
    } catch (e) { /* informasi saja */ }
    json(res, 200, { ok: true, hasil });
  });

  /* --------------------------------- apply --------------------------------- */
  /** bentrok keras slot usulan terhadap baris jadwal yang TIDAK dibongkar + di dalam usulan */
  const konflikUsul = (inp, hasil) => {
    const hapusIds = new Set(hasil.hapus.map(h => Number(h.id)).filter(Boolean));
    const rows = db.prepare('SELECT * FROM jadwal WHERE ta_id=?').all(inp.taId)
      .filter(r => !hapusIds.has(Number(r.id)))
      .map(r => ({ id: Number(r.id), hari: Number(r.hari), sesi: Number(r.sesi), mapel_id: Number(r.mapel_id), guru_id: Number(r.guru_id), kelas_ids: kelasIdsOf(r), ruang: r.ruang || '' }));
    const bentrok = [];
    const sama = (a, b) => Number(a) === Number(b);
    for (const s of hasil.slots) {
      for (const r of rows) {
        if (!sama(r.hari, s.hari) || !sama(r.sesi, s.sesi)) continue;
        const irisan = (s.kelas_ids || []).filter(k => r.kelas_ids.includes(k));
        if (irisan.length) {
          const nama = irisan.map(k => (db.prepare('SELECT nama FROM kelas WHERE id=?').get(k) || {}).nama || k).join(', ');
          bentrok.push({ jenis: 'kelas', hari: s.hari, sesi: s.sesi, pesan: `Kelas ${nama} sudah terisi pada ${HARI_NAMA(s.hari)} sesi ${s.sesi}.` });
        }
        if (s.guru_id && r.guru_id && sama(s.guru_id, r.guru_id)) {
          const g = (db.prepare('SELECT nama FROM users WHERE id=?').get(r.guru_id) || {}).nama || '';
          bentrok.push({ jenis: 'guru', hari: s.hari, sesi: s.sesi, pesan: `Guru ${g} sudah mengajar pada ${HARI_NAMA(s.hari)} sesi ${s.sesi}.` });
        }
        const rs = String(s.ruang || '').trim().toLowerCase();
        const rr = String(r.ruang || '').trim().toLowerCase();
        if (rs && rr && rs === rr) {
          bentrok.push({ jenis: 'ruang', hari: s.hari, sesi: s.sesi, pesan: `Ruang "${s.ruang}" sudah dipakai pada ${HARI_NAMA(s.hari)} sesi ${s.sesi}.` });
        }
      }
    }
    const lihat = new Map();
    const dup = (key, jenis, hari, sesi) => {
      if (!lihat.has(key)) { lihat.set(key, 1); return; }
      const pesan = jenis === 'kelas'
        ? `Usulan menempatkan kelas yang sama dua kali pada ${HARI_NAMA(hari)} sesi ${sesi}.`
        : jenis === 'ruang'
          ? `Usulan memakai ruangan yang sama dua kali pada ${HARI_NAMA(hari)} sesi ${sesi}.`
          : `Usulan menempatkan guru yang sama pada dua kelas di ${HARI_NAMA(hari)} sesi ${sesi}.`;
      if (!bentrok.some(b => b.pesan === pesan)) bentrok.push({ jenis, hari, sesi, pesan });
    };
    for (const s of hasil.slots) {
      for (const kid of (s.kelas_ids || [])) dup(`k:${s.hari}:${s.sesi}:${kid}`, 'kelas', s.hari, s.sesi);
      if (s.guru_id) dup(`g:${s.hari}:${s.sesi}:${s.guru_id}`, 'guru', s.hari, s.sesi);
      const rg = String(s.ruang || '').trim().toLowerCase();
      if (rg) dup(`r:${s.hari}:${s.sesi}:${rg}`, 'ruang', s.hari, s.sesi);
    }
    return bentrok;
  };

  /** cascade hapus slot (mode 'ganti') — sama seperti DELETE /api/jadwal/slot/:id */
  const hapusSlotCascade = (row) => {
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

  post('/api/jadwal/ai/apply', async (req, res) => {
    const user = guard(req, res, 'jadwal', 'write'); if (!user) return;
    const b = (await readBody(req)) || {};
    const inp = buildInput(req.query || {}, b);
    if (!inp.kelasIds.length) return fail(res, 400, 'Pilih minimal satu kelas yang akan disusun.');
    if (!inp.beban.length) return fail(res, 400, 'Beban mengajar (kelas × mata pelajaran) belum diisi.');

    const hasil = susunJadwal(inp);
    hasil.aturan = inp.aturanBersih;
    /* VALIDASI ULANG di server: klien tidak dipercaya */
    const bentrok = konflikUsul(inp, hasil);
    if (bentrok.length) {
      return fail(res, 409, bentrok[0].pesan, { konflik: bentrok, jenis: 'bentrok' });
    }
    if (!hasil.slots.length && !hasil.hapus.length) {
      return fail(res, 400, 'Tidak ada perubahan yang perlu diterapkan.', { ringkasan: hasil.ringkasan });
    }

    let masuk = 0, terhapus = 0;
    db.transaction(() => {
      for (const h of hasil.hapus) {
        const row = db.prepare('SELECT * FROM jadwal WHERE id=?').get(Number(h.id));
        if (!row) continue;
        hapusSlotCascade(row);
        terhapus++;
      }
      for (const s of hasil.slots) {
        const kids = (s.kelas_ids || []).map(Number).filter(Boolean);
        const guruId = Number(s.guru_id) || 0;
        if (!kids.length || !guruId) continue;
        db.prepare(`INSERT INTO jadwal(ta_id,hari,sesi,mapel_id,guru_id,kelas_ids,ruang,merged,catatan,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(inp.taId, Number(s.hari), Number(s.sesi), Number(s.mapel_id), guruId,
            JSON.stringify(kids), String(s.ruang || ''), kids.length > 1 ? 1 : 0,
            'AI Timetable Generator', dbm.now(), dbm.now());
        db.prepare('INSERT OR IGNORE INTO guru_mapel(guru_id,mapel_id,created_at) VALUES(?,?,?)')
          .run(guruId, Number(s.mapel_id), dbm.now());
        masuk++;
      }
    })();

    dbm.logAudit(user, 'UBAH', 'jadwal',
      `AI Timetable apply: ${masuk} slot ditambahkan, ${terhapus} slot dibongkar (mode ${inp.mode}, ${hasil.ringkasan.terpasang}/${hasil.ringkasan.total_unit} jam)`, ipOf(req));
    json(res, 200, {
      ok: true, masuk, dihapus: terhapus, sisa: hasil.ringkasan.sisa,
      ringkasan: hasil.ringkasan,
      pesan: `Jadwal diterapkan: ${masuk} slot baru${terhapus ? `, ${terhapus} slot dibongkar` : ''}.`
    });
  });

  /* ringkasan hasil generate terakhir (informasi) */
  get('/api/jadwal/ai/terakhir', (req, res) => {
    const user = guard(req, res, 'jadwal', 'view'); if (!user) return;
    let info = null;
    try { info = JSON.parse(dbm.getSetting('jadwal_ai_terakhir', '') || 'null'); } catch (e) { info = null; }
    json(res, 200, { ok: true, info: info || {} });
  });

  return { susunJadwal };
};

module.exports.susunJadwal = susunJadwal;
module.exports.kandidatOf = kandidatOf;