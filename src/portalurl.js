/* =====================================================================
   Alamat portal publik siswa — SELALU dari slug unik sekolah yang aktif.
   Format: <base>/<slug-sekolah>/portal-siswa
   Tidak ada tautan statis/hardcode ke sekolah tertentu di aplikasi.
   ===================================================================== */
export const BASE = () => (typeof window !== 'undefined' && window.__BASE__) || '';

/** slug portal dari objek tenant (bootstrap) / config publik */
export function slugOf(tenant) {
  if (!tenant) return '';
  return String(tenant.portal_slug || tenant.slug || '').trim();
}

/** path portal relatif terhadap base, mis. /smk-pgri-cikoneng/portal-siswa */
export function portalPathOf(tenant) {
  if (tenant && tenant.portal_path) return String(tenant.portal_path);
  const slug = slugOf(tenant);
  return slug ? `/${slug}/portal-siswa` : '';
}

/** URL portal siap dipakai pada atribut href (sudah termasuk prefix aplikasi) */
export function portalUrlOf(tenant) {
  const p = portalPathOf(tenant);
  return p ? BASE() + p : '';
}

/** URL absolut (untuk tombol "salin tautan") */
export function portalAbsUrl(tenant) {
  const p = portalPathOf(tenant);
  if (!p) return '';
  const origin = (typeof window !== 'undefined' && window.location.origin) || '';
  return origin + BASE() + p;
}

/** slug portal yang sedang dibuka pada URL (halaman portal publik) */
export function slugFromLocation() {
  if (typeof window === 'undefined') return '';
  let p = String(window.location.pathname || '');
  const base = BASE();
  if (base && (p === base || p.startsWith(base + '/'))) p = p.slice(base.length) || '/';
  const m = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,60})\/portal-siswa(?:\/|$)/.exec(p);
  return m ? m[1].toLowerCase() : '';
}

/** path fisik halaman portal (tanpa base) — dipakai deteksi area di App.jsx */
export function onPortalPath() {
  return !!slugFromLocation();
}

/** set kode sekolah untuk seluruh permintaan API halaman portal publik */
export function setSekolahKode(kode) {
  if (typeof window !== 'undefined') window.__SEKOLAH_KODE__ = String(kode || '');
}
