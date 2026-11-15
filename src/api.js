const BASE = (typeof window !== 'undefined' && window.__BASE__) || '';

export async function api(path, opts = {}) {
  const panel = (typeof window !== 'undefined' && window.__PANEL__) || '';
  /* portal publik: kode sekolah dari slug URL agar data yang dibaca milik
     sekolah tersebut, bukan sekolah lain yang kebetulan punya sesi di browser. */
  const kodeSekolah = (typeof window !== 'undefined' && window.__SEKOLAH_KODE__) || '';
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(panel ? { 'X-Client-Panel': panel } : {}),
      ...(kodeSekolah ? { 'X-Sekolah-Kode': String(kodeSekolah) } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* bukan JSON */ }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && data.error) || `Gagal memuat data (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data || {};
}

export const docUrl = (path) => BASE + path;
export const openDoc = (path) => window.open(BASE + path, '_blank', 'noopener');
export const basePrefix = () => BASE;

/* ---------------- format ---------------- */
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function tgl(iso, opt = {}) {
  if (!iso) return '-';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  if (opt.short) return `${d} ${BULAN[m - 1].slice(0, 3)} ${y}`;
  if (opt.long) return `${HARI[new Date(y, m - 1, d).getDay()]}, ${d} ${BULAN[m - 1]} ${y}`;
  return `${d} ${BULAN[m - 1]} ${y}`;
}
/**
 * Tanggal HARI INI menurut zona waktu APLIKASI (default Asia/Jakarta/WIB).
 * `new Date().toISOString()` memakai UTC sehingga pukul 00:00–07:00 WIB terbaca
 * sebagai tanggal kemarin, dan perangkat dengan zona lain bisa berbeda sehari
 * dengan tanggal yang dipakai server — keduanya membuat jadwal hari ini tidak muncul.
 */
export function hariIni(offsetHari = 0) {
  const tz = (typeof window !== 'undefined' && window.__TZ__) || 'Asia/Jakarta';
  const base = new Date(Date.now() + Number(offsetHari || 0) * 86400000);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(base);            // en-CA → YYYY-MM-DD
  } catch (e) {
    const p = n => String(n).padStart(2, '0');
    return `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
  }
}
export function tglPendek(iso) {
  if (!iso) return '-';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function waktu(v) {
  if (!v) return '-';
  const s = String(v);
  const d = s.slice(0, 10), t = s.slice(11, 16);
  return `${tglPendek(d)} ${t}`;
}
export const angka = (n) => Number(n || 0).toLocaleString('id-ID');
export const inisial = (nama) =>
  String(nama || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const statusKelas = (label) => 'badge badge-' + String(label || 'netral').toLowerCase().replace(/[^a-z]/g, '');
export const uid = () => Math.random().toString(36).slice(2, 9);

export function waLink(phone, pesan) {
  const p = String(phone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${p}?text=${encodeURIComponent(pesan || '')}`;
}

/* baca berkas jadi base64 tanpa prefix data: */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* kompres gambar di klien supaya unggahan ringan */
export function shrinkImage(file, maxSide = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type) || /svg|gif/i.test(file.type)) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try {
        const out = c.toDataURL('image/webp', quality);
        resolve({ base64: out.replace(/^data:[^,]*,/, ''), mime: 'image/webp', filename: (file.name || 'gambar').replace(/\.[^.]+$/, '') + '.webp', dataUrl: out });
      } catch (e) { resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/**
 * Kompres gambar agar tetap jelas tapi ringan.
 * - dikonversi ke WebP (jauh lebih kecil dari JPG/PNG pada ukuran sama)
 * - sisi terpanjang dibatasi `maxSide`
 * - kualitas diturunkan bertahap sampai ukuran hasilnya ≤ `maxKb`
 * Mengembalikan null bila berkas bukan gambar raster (mis. PDF/SVG/GIF).
 */
export async function compressImage(file, opts = {}) {
  const maxKb = Math.max(64, Number(opts.maxKb) || 2048);
  const maxSide = Math.max(320, Number(opts.maxSide) || 1600);
  const quality0 = Math.min(0.95, Math.max(0.4, Number(opts.quality) || 0.82));
  if (!file || !/^image\//.test(file.type) || /svg|gif/i.test(file.type)) return null;
  const loadImg = () => new Promise((resolve, reject) => {
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('Gambar tidak dapat dibaca.')); };
    img.src = u;
  });
  const img = await loadImg();
  let side = maxSide;
  let best = null;
  // 1) turunkan dimensi & kualitas bertahap sampai di bawah batas ukuran
  for (let step = 0; step < 6; step++) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx2 = c.getContext('2d');
    ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(img, 0, 0, w, h);
    for (const q of [quality0, 0.72, 0.62, 0.52, 0.45]) {
      let out = '';
      try { out = c.toDataURL('image/webp', q); } catch (e) { out = ''; }
      if (!out.startsWith('data:image/')) break;
      const b64 = out.replace(/^data:[^,]*,/, '');
      const bytes = Math.ceil(b64.length * 0.75);
      best = { base64: b64, dataUrl: out, mime: 'image/webp', bytes, width: w, height: h, quality: q,
        filename: String(file.name || 'gambar').replace(/\.[^.]+$/, '') + '.webp' };
      if (bytes <= maxKb * 1024) return best;
    }
    side = Math.round(side * 0.75);
  }
  return best;   // sudah dikompres maksimal walau masih di atas batas → pemanggil memberi peringatan
}
