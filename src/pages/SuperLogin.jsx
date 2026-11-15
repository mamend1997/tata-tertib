import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Fingerprint, Loader2, Lock, Server, ShieldCheck, User } from 'lucide-react';
import { api } from '../api';
import { applyBrandingHead, watchBranding } from '../branding';

/* =====================================================================
   PORTAL LOGIN SUPER ADMIN — halaman TERPISAH & EKSKLUSIF.
   URL: /super-admin (tidak pernah ditautkan dari login sekolah).
   Tampilan sengaja berbeda total dari login sekolah (tema gelap platform),
   sehingga tidak mungkin tertukar dengan portal tenant/sekolah.
   ===================================================================== */
export default function SuperLogin() {
  const [brand, setBrand] = useState(() => (typeof window !== 'undefined' && window.__BRAND__) || {});
  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cek, setCek] = useState(true);
  const [err, setErr] = useState('');
  const BASE = (typeof window !== 'undefined' && window.__BASE__) || '';

  const lanjut = () => window.location.replace(BASE + '/#/saas/dashboard');

  useEffect(() => {
    window.__PANEL__ = 'saas';
    applyBrandingHead(brand, { suffix: 'Panel Platform' });
    const stop = watchBranding(p => { setBrand(p); applyBrandingHead(p, { suffix: 'Panel Platform' }); }, 60000);
    /* sudah punya sesi Super Admin? langsung ke panel */
    api('/api/bootstrap').then(d => {
      if (d && d.scope === 'super') lanjut();
      else setCek(false);
    }).catch(() => setCek(false));
    return () => { stop(); window.__PANEL__ = ''; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await api('/api/super/login', { method: 'POST', body: form });
      lanjut();
    } catch (e2) {
      setErr(e2.message);
    } finally { setBusy(false); }
  }

  const namaApp = brand.app_nama || (window.__BRAND__ && window.__BRAND__.app_nama) || 'Panel Platform';
  const subApp = brand.app_subtitle || 'Multi-Tenant Management';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100"
      style={{ backgroundImage: 'radial-gradient(60% 60% at 15% 0%, rgba(13,148,136,.28) 0%, rgba(2,6,23,0) 60%), radial-gradient(55% 55% at 100% 100%, rgba(99,102,241,.22) 0%, rgba(2,6,23,0) 60%)' }}>
      <div className="mx-auto flex min-h-screen max-w-[1120px] flex-col px-5 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {brand.logo ? (
              <img src={brand.logo} alt="" className="h-10 w-10 rounded-xl bg-white/95 object-contain p-1" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-500/20 ring-1 ring-teal-400/40"><Server size={20} className="text-teal-300" /></div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.22em] text-teal-300/80">{subApp}</p>
              <p className="truncate text-[15px] font-extrabold leading-tight text-white">{namaApp}</p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 sm:inline-flex">
            <Fingerprint size={13} className="text-teal-300" /> Portal Khusus Super Admin
          </span>
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-500/15 ring-1 ring-teal-400/30">
                <ShieldCheck size={26} className="text-teal-300" />
              </div>
              <h1 className="mt-3 text-[22px] font-extrabold tracking-tight text-white">Masuk Panel Platform</h1>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">
                Halaman ini khusus akun <b className="text-slate-200">Super Admin</b> pengelola platform.
                Akun sekolah tidak dapat masuk di sini.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
              {cek ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[12.5px] text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> Memeriksa sesi…
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[11.5px] font-bold uppercase tracking-wider text-slate-400">Username / Email Super Admin</label>
                    <div className="relative">
                      <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input className="w-full rounded-xl border border-white/10 bg-slate-950/60 py-2.5 pl-9 pr-3 text-[13.5px] text-white outline-none transition placeholder:text-slate-600 focus:border-teal-400/60 focus:ring-2 focus:ring-teal-500/20"
                        autoFocus autoComplete="username" value={form.username} placeholder="superadmin"
                        onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11.5px] font-bold uppercase tracking-wider text-slate-400">Kata Sandi</label>
                    <div className="relative">
                      <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input type={show ? 'text' : 'password'} autoComplete="current-password"
                        className="w-full rounded-xl border border-white/10 bg-slate-950/60 py-2.5 pl-9 pr-10 text-[13.5px] text-white outline-none transition placeholder:text-slate-600 focus:border-teal-400/60 focus:ring-2 focus:ring-teal-500/20"
                        value={form.password} placeholder="••••••••"
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                      <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300">
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  {err ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] font-medium text-rose-200">{err}</div> : null}

                  <button type="submit" disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 py-2.5 text-[14px] font-bold text-slate-950 transition hover:bg-teal-400 disabled:opacity-60">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{busy ? 'Memverifikasi…' : 'Masuk Panel Platform'}
                  </button>
                </form>
              )}
            </div>

            <p className="mt-5 text-center text-[11.5px] leading-relaxed text-slate-500">
              Portal ini terpisah dari login sekolah. Pengguna sekolah masuk melalui halaman utama aplikasi.
            </p>
            <p className="mt-2 text-center text-[11px] text-slate-600">
              {brand.login_copyright || `© ${new Date().getFullYear()} ${namaApp}`}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
