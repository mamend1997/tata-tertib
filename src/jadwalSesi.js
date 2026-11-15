/* =====================================================================
   Helper tampilan MATRIKS KARTU SLOT jadwal pelajaran.
   Dipakai halaman pengelolaan jadwal (admin) DAN halaman publik
   (/jadwal-publik/<token>) supaya bentuk kartu, label sesi, serta tinggi
   kartu yang proporsional terhadap durasi sesi SELALU sama.

   Konfigurasi sesi dari server:
     cfg.sesi       → daftar sesi UMUM  [{ idx, no, label, mulai, selesai, istirahat }]
     cfg.sesi_hari  → sesi KHUSUS per hari  { "1": [ … ], "5": [ … ] }
   Nomor `idx` = posisi (dihitung ulang di klien), `no` = urutan jam pelajaran.
   ===================================================================== */
export const HARI_NAMA = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** menit dari "HH:MM" (null bila tidak valid) */
export const menitDari = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** normalisasi daftar sesi satu hari (idx = posisi, no = jam pelajaran ke-) */
export function sesiUntuk(cfg, hari) {
  const map = (cfg && cfg.sesi_hari) || {};
  const khusus = map[hari] !== undefined ? map[hari] : map[String(hari)];
  const daftar = Array.isArray(khusus) && khusus.length ? khusus : ((cfg && cfg.sesi) || []);
  let no = 0;
  return daftar.map((s, i) => {
    const istirahat = s.istirahat === 1 || s.istirahat === true || s.istirahat === '1';
    if (!istirahat) no++;
    return {
      idx: Number(s.idx) > 0 ? Number(s.idx) : i + 1,
      posisi: i,
      no: istirahat ? 0 : (Number(s.no) || no),
      label: String(s.label || (istirahat ? 'Istirahat' : 'Jam')),
      mulai: String(s.mulai || ''),
      selesai: String(s.selesai || ''),
      istirahat
    };
  });
}

/** durasi sesi (menit) — dasar tinggi kartu proporsional */
export const durasiSesi = (s) => {
  if (!s) return 45;
  const a = menitDari(s.mulai), b = menitDari(s.selesai);
  return (a !== null && b !== null && b > a) ? (b - a) : 45;
};

/** tinggi kartu (px) mengikuti DURASI sesi seperti pada matriks web */
export const tinggiSesi = (s) => {
  const m = durasiSesi(s);
  if (!s) return 72;
  if (s.istirahat) return Math.max(26, Math.min(42, Math.round(m * 1.15)));
  return Math.max(58, Math.min(140, Math.round(m * 1.55)));
};

/** label sesi: label KUSTOM ("Upacara", "Pembiasaan") menang atas "Jam ke-N" */
export const labelSesi = (s) => {
  if (!s) return 'Sesi';
  const lab = String(s.label || '').trim();
  if (s.istirahat) return lab || 'Istirahat';
  const generik = !lab || /^jam(\s|$)/i.test(lab) || /^sesi\b/i.test(lab) || /^jam\s*ke-/i.test(lab);
  return generik ? (s.no ? `Jam ke-${s.no}` : 'Jam') : lab;
};

/** sesi sangat pendek (< 30 menit) dirender kompak */
export const sesiPadat = (s) => !!s && !s.istirahat && durasiSesi(s) < 30;
