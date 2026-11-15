import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, GraduationCap, Loader2, Lock, ShieldCheck, TrendingUp, User, UserPlus, Users } from 'lucide-react';
import { api } from '../api';
import { applyTheme } from '../theme';
import { applyBrandingHead, watchBranding } from '../branding';
import Daftar from './Daftar';
import Maintenance from './Maintenance';

/* Halaman login TENANT/SEKOLAH.
   Seluruh teks, logo, sub-judul & footer MURNI berasal dari Branding Sistem
   global (diatur Super Admin) — TIDAK PERNAH mengambil nama/alamat sekolah
   tertentu. Tidak ada tautan apa pun menuju login Super Admin di halaman ini. */
export default function Login({ onDone, initialMode = 'login' }) {
  const [cfg, setCfg] = useState(null);
  const [mode, setMode] = useState(() => (initialMode === 'daftar' ? 'daftar' : 'login'));
  const [form, setForm] = useState(() => ({
    username: '', password: '',
    kode: (() => {
      const q = new URLSearchParams(window.location.search).get('kode');
      return q && /^\d{4}$/.test(q) ? q : '';
    })()
  }));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [maintPesan, setMaintPesan] = useState('');

  const pakaiBranding = (c) => {
    setCfg(c);
    applyTheme(c || {}, { skipTitle: true });
    applyBrandingHead((c && c.platform) || {});
  };

  useEffect(() => {
    api('/api/public/config?global=1').then(c => pakaiBranding(c)).catch(() => pakaiBranding({}));
    const stop = watchBranding(p => {
      setCfg(prev => ({ ...(prev || {}), platform: p }));
      applyBrandingHead(p);
    }, 60000);
    return stop;
  }, []);

  /* buka/formulir pendaftaran: URL asli <base>/daftar (bisa dibagikan) */
  const daftarPath = (window.__BASE__ || '') + '/daftar';
  function bukaDaftar() {
    try { window.history.replaceState({}, '', daftarPath); } catch (e) { /* abaikan */ }
    setMode('daftar');
    window.scrollTo({ top: 0 });
  }
  function tutupDaftar() {
    try { window.history.replaceState({}, '', (window.__BASE__ || '') + '/'); } catch (e) { /* abaikan */ }
    setMode('login');
  }

  if (mode === 'daftar') {
    return (
      <Daftar cfg={cfg} onSelesai={async () => { await onDone?.(); }}
        onBatal={tutupDaftar} />
    );
  }

  const P = (cfg && cfg.platform) || {};
  const namaApp = P.login_judul || P.app_nama_default || P.app_nama || (window.__BRAND__ && window.__BRAND__.app_nama) || 'Aplikasi';

  /* Mode pemeliharaan global aktif → seluruh akun sekolah tidak boleh masuk */
  if (P.maintenance || maintPesan) {
    return (
      <Maintenance
        pesan={maintPesan || P.maintenance_pesan}
        namaApp={namaApp}
        logo={P.login_logo || P.logo || ''}
        onRetry={() => { setMaintPesan(''); api('/api/public/config?global=1').then(c => pakaiBranding(c)).catch(() => {}); }}
      />
    );
  }
  const subApp = P.login_subjudul || P.app_subtitle || '';
  const deskripsi = P.login_deskripsi || '';
  const logo = P.login_logo || P.logo || '';
  const footerKiri = P.login_footer || P.domain || '';
  const copyright = P.login_copyright || `© ${new Date().getFullYear()} ${namaApp}`;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!/^\d{4}$/.test(String(form.kode))) {
      setErr('Kode sekolah wajib diisi — 4 digit angka dari administrator sekolah Anda.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/login', { method: 'POST', body: form });
      await onDone?.();
    } catch (e2) {
      /* 503 = Mode Pemeliharaan aktif → tampilkan halaman khusus, bukan pesan form */
      if (e2.status === 503) setMaintPesan(e2.message);
      else setErr(e2.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* panel branding global */}
      <div className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between"
        style={{ background: 'linear-gradient(150deg, var(--primary-700) 0%, var(--primary) 52%, #f59e0b 100%)' }}>
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-amber-200/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt="" className="h-12 w-12 rounded-2xl bg-white/95 object-contain p-1.5" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30"><ShieldCheck size={24} /></div>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">{subApp}</p>
              <h1 className="text-[21px] font-extrabold uppercase leading-tight tracking-wide">{namaApp}</h1>
            </div>
          </div>
          <p className="mt-8 max-w-md text-[14px] leading-relaxed text-white/90">{deskripsi}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              { icon: TrendingUp, t: 'Portal Siswa', d: 'Siswa & orang tua memeriksa poin lewat tautan sekolah' },
              { icon: TrendingUp, t: 'Deteksi Dini', d: 'Peringatan Siaga & Waspada 14 hari terakhir' },
              { icon: Users, t: 'Multi Role', d: 'Kepsek, BK, Kesiswaan, Wali Kelas' },
              { icon: GraduationCap, t: 'Surat Otomatis', d: 'Panggilan orang tua & SP 1–3 siap cetak' }
            ].map((f, i) => (
              <div key={i} className="rounded-2xl bg-white/12 p-3.5 ring-1 ring-white/20 backdrop-blur">
                <f.icon size={18} className="text-white/90" />
                <p className="mt-2 text-[13px] font-bold">{f.t}</p>
                <p className="text-[11.5px] leading-snug text-white/75">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-10 text-[11.5px] text-white/70">{footerKiri}</div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            {logo ? <img src={logo} alt="" className="h-11 w-11 rounded-xl bg-white object-contain p-1 shadow-soft" /> : <div className="grid h-11 w-11 place-items-center rounded-xl text-white" style={{ background: 'var(--primary)' }}><ShieldCheck size={22} /></div>}
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400">{subApp}</p>
              <h1 className="text-[15px] font-extrabold uppercase leading-tight text-slate-800">{namaApp}</h1>
            </div>
          </div>

          <div className="card p-6 sm:p-7">
            <h2 className="text-[19px] font-extrabold text-slate-800">Masuk ke Dashboard Sekolah</h2>
            <p className="mt-1 text-[13px] text-slate-500">Masukkan kode sekolah, username, dan kata sandi yang diberikan administrator sekolah.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label">Kode Sekolah <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <GraduationCap size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-9 font-mono tracking-[0.3em]" value={form.kode} inputMode="numeric" maxLength={4}
                    required autoComplete="off" placeholder="4 digit kode sekolah"
                    onChange={e => setForm(f => ({ ...f, kode: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Kode 4 digit diberikan administrator sekolah saat pendaftaran.</p>
              </div>
              <div>
                <label className="label">Username</label>
                <div className="relative">
                  <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-9" value={form.username} autoComplete="username"
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="mis. admin" />
                </div>
              </div>
              <div>
                <label className="label">Kata Sandi</label>
                <div className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-9 pr-10" type={show ? 'text' : 'password'} value={form.password}
                    autoComplete="current-password" onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
                  <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                    {show ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700">{err}</div> : null}

              <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 text-[14px]">
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}{busy ? 'Memproses…' : 'Masuk'}
              </button>
            </form>

            {P.pendaftaran_aktif !== false ? (
              <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50/70 p-3">
                <a href={(window.__BASE__ || '') + '/daftar'} data-daftar-link
                  onClick={e => { e.preventDefault(); bukaDaftar(); }}
                  className="group flex items-start gap-2 text-[12.5px] font-bold leading-relaxed text-orange-900 hover:text-orange-700">
                  <UserPlus size={15} className="mt-0.5 shrink-0 text-orange-600" />
                  <span>
                    Belum punya akun sekolah?{' '}
                    <span className="underline decoration-orange-400 decoration-2 underline-offset-2 group-hover:decoration-orange-600">
                      Daftarkan sekolah Anda
                    </span>
                  </span>
                </a>
                <p className="mt-1 text-[11.5px] leading-relaxed text-orange-800">
                  Coba gratis {P.trial_hari || 7} hari — formulir pendaftaran sekolah baru terbuka langsung.
                </p>
                <a href={(window.__BASE__ || '') + '/daftar'} onClick={e => { e.preventDefault(); bukaDaftar(); }}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-2 text-[12.5px] font-bold text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100">
                  <UserPlus size={14} /> Daftarkan Sekolah
                </a>
              </div>
            ) : null}

            <div className="mt-5 border-t border-slate-100 pt-4 text-center">
              <p className="text-[11px] leading-relaxed text-slate-400">
                Lupa kata sandi? Hubungi Administrator sekolah untuk pengaturan ulang akun.
              </p>
            </div>
          </div>
          <p className="mt-5 text-center text-[11.5px] text-slate-400">{copyright}</p>
        </div>
      </div>
    </div>
  );
}
