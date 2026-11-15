/* Sinkronisasi branding GLOBAL (Branding Sistem Super Admin) di sisi klien.
   Dipakai halaman publik (login sekolah, portal Super Admin, pendaftaran) agar
   judul tab & favicon SELALU mengikuti database global — bukan cache perangkat. */
const BASE = (typeof window !== 'undefined' && window.__BASE__) || '';

export function faviconUrl(platform) {
  const ver = (platform && platform.version) || (typeof window !== 'undefined' && window.__BRAND__ && window.__BRAND__.version) || '1';
  return `${BASE}/favicon.ico?v=${encodeURIComponent(ver)}`;
}

export function setFavicon(platform) {
  if (typeof document === 'undefined') return;
  const href = faviconUrl(platform);
  let el = document.getElementById('app-favicon');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'icon';
    el.id = 'app-favicon';
    document.head.appendChild(el);
  }
  if (el.getAttribute('href') !== href) el.setAttribute('href', href);
  el.setAttribute('data-brand-version', String((platform && platform.version) || '1'));
}

/** judul tab + favicon dari branding global (tanpa identitas sekolah mana pun) */
export function applyBrandingHead(platform, opts = {}) {
  if (typeof document === 'undefined') return;
  const app = opts.title
    || (platform && (platform.login_judul || platform.app_nama))
    || (window.__BRAND__ && window.__BRAND__.app_nama)
    || 'Aplikasi';
  document.title = opts.suffix ? `${app} · ${opts.suffix}` : app;
  setFavicon(platform);
}

/**
 * Pantau perubahan branding global: ambil ulang tiap `intervalMs` dan saat tab
 * kembali aktif, sehingga perubahan dari Super Admin langsung terlihat pada
 * sesi/perangkat lain tanpa perlu hard reload.
 */
export function watchBranding(onData, intervalMs = 60000) {
  if (typeof window === 'undefined') return () => {};
  let alive = true;
  const fetchBrand = async () => {
    try {
      const r = await fetch(`${BASE}/api/public/config?global=1`, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (alive && data && data.platform) onData(data.platform);
    } catch (e) { /* offline — abaikan */ }
  };
  const t = setInterval(fetchBrand, intervalMs);
  const onVisible = () => { if (document.visibilityState === 'visible') fetchBrand(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  fetchBrand();
  return () => {
    alive = false;
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
