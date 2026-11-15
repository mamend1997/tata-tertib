/* penerapan tema (warna primer, gradien, judul) dari pengaturan sekolah */
export function shade(hex, amt) {
  let h = String(hex || '#ea580c').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v + amt))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
export function mix(hex, target, ratio) {
  const h = String(hex || '#ea580c').replace('#', '');
  const n = parseInt(h, 16), t = parseInt(target, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * (1 - ratio) + [((t >> 16) & 255), ((t >> 8) & 255), (t & 255)][i] * ratio));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
export function applyTheme(s, opts = {}) {
  const p = /^#[0-9a-fA-F]{6}$/.test(s?.primary_color || '') ? s.primary_color : '#ea580c';
  const root = document.documentElement.style;
  root.setProperty('--primary', p);
  root.setProperty('--primary-600', p);
  root.setProperty('--primary-700', shade(p, -34));
  root.setProperty('--primary-50', mix(p, '#ffffff', 0.94));
  root.setProperty('--primary-100', mix(p, '#ffffff', 0.87));
  root.setProperty('--primary-200', mix(p, '#ffffff', 0.74));
  root.setProperty('--ring', `rgba(${parseInt(p.slice(1, 3), 16)}, ${parseInt(p.slice(3, 5), 16)}, ${parseInt(p.slice(5, 7), 16)}, 0.25)`);
  document.body.classList.toggle('app-bg', String(s?.gradient_bg ?? '1') === '1');
  if (!opts.skipTitle) {
    /* nama aplikasi: pengaturan sekolah → branding GLOBAL (tanpa hardcode) */
    const app = s?.app_nama
      || (typeof window !== 'undefined' && window.__BRAND__ && window.__BRAND__.app_nama)
      || '';
    document.title = opts.title || (s?.sekolah_nama ? `${app} · ${s.sekolah_nama}` : app);
  }
}
