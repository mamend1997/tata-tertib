import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, Bell, Building2, Database, Download, FileText, HelpCircle, Layers, LayoutDashboard, LifeBuoy,
  LogOut, Menu, MessageCircle, Package, QrCode, RefreshCw, Server, Sparkles, UserCog, Wallet, X
} from 'lucide-react';
import { api, angka } from '../../api';
import { cx } from '../../ui';
import { applyBrandingHead } from '../../branding';
import { SuperDashboard, SuperSekolah } from './SuperSekolah';
import { SuperPembayaran, SuperPaket, SuperQris } from './SuperBilling';
import { SuperMenu, SuperBranding, SuperLegal, SuperPengumuman } from './SuperSettings';
import { SuperTiket, SuperPanduan, SuperAudit, SuperWa } from './SuperOps';
import { SuperBackup, SuperDatabase } from './SuperSystem';
import SuperProfil from './SuperProfil';

const MENUS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, grup: 'Ringkasan' },
  { key: 'sekolah', label: 'Daftar Sekolah', icon: Building2, grup: 'Tenant' },
  { key: 'pembayaran', label: 'Pembayaran & Penagihan', icon: Wallet, grup: 'Tenant' },
  { key: 'paket', label: 'Paket Langganan', icon: Package, grup: 'Tenant' },
  { key: 'profil', label: 'Pengaturan Profil', icon: UserCog, grup: 'Akun' },
  { key: 'menu', label: 'Default Menu Sekolah', icon: Layers, grup: 'Kustomisasi' },
  { key: 'branding', label: 'Branding Sistem', icon: Sparkles, grup: 'Kustomisasi' },
  { key: 'qris', label: 'QRIS & Harga', icon: QrCode, grup: 'Kustomisasi' },
  { key: 'legal', label: 'Syarat & SLA', icon: FileText, grup: 'Kustomisasi' },
  { key: 'tiket', label: 'Pusat Tiket', icon: LifeBuoy, grup: 'Operasional' },
  { key: 'pengumuman', label: 'Pengumuman & Maintenance', icon: Bell, grup: 'Operasional' },
  { key: 'panduan', label: 'Petunjuk Pengguna', icon: HelpCircle, grup: 'Operasional' },
  { key: 'audit', label: 'Audit Logs', icon: Activity, grup: 'Operasional' },
  { key: 'wa', label: 'WhatsApp Gateway', icon: MessageCircle, grup: 'Integrasi' },
  { key: 'backup', label: 'Backup & Restore', icon: Download, grup: 'Sistem' },
  { key: 'database', label: 'Database Manager', icon: Database, grup: 'Sistem' }
];

export const SAAS_PAGES = {
  dashboard: SuperDashboard, sekolah: SuperSekolah, pembayaran: SuperPembayaran, paket: SuperPaket,
  menu: SuperMenu, branding: SuperBranding, qris: SuperQris, legal: SuperLegal, tiket: SuperTiket,
  pengumuman: SuperPengumuman, panduan: SuperPanduan, audit: SuperAudit, wa: SuperWa,
  backup: SuperBackup, database: SuperDatabase, profil: SuperProfil
};

export default function SuperAdmin({ boot, onReload, onLogout }) {
  const [page, setPage] = useState(() => {
    const h = window.location.hash.replace(/^#\/?saas\/?/, '').split('?')[0];
    return SAAS_PAGES[h] ? h : 'dashboard';
  });
  const [navOpen, setNavOpen] = useState(false);
  const [ctxKey, setCtxKey] = useState(0);

  useEffect(() => { window.location.hash = '/saas/' + page; setNavOpen(false); }, [page]);
  /* tandai bahwa permintaan berasal dari panel platform (server memilih sesi
     Super Admin walau di browser yang sama ada sesi sekolah) */
  useEffect(() => {
    window.__PANEL__ = 'saas';
    return () => { window.__PANEL__ = ''; };
  }, []);
  /* judul tab & favicon panel mengikuti branding GLOBAL */
  useEffect(() => {
    applyBrandingHead(boot?.platform || {}, { suffix: 'Panel Platform' });
  }, [boot?.platform]);

  const ctx = {
    boot, go: setPage, reload: onReload, bump: () => setCtxKey(k => k + 1), key: ctxKey
  };
  const Page = SAAS_PAGES[page] || SuperDashboard;
  const groups = useMemo(() => {
    const map = new Map();
    for (const m of MENUS) { if (!map.has(m.grup)) map.set(m.grup, []); map.get(m.grup).push(m); }
    return [...map.entries()];
  }, []);
  const badge = {
    pembayaran: boot?.stats?.menunggu_verifikasi || 0,
    tiket: boot?.stats?.tiket_baru || 0
  };

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-40 text-white shadow-lg"
        style={{ background: 'linear-gradient(120deg, #1e293b 0%, #334155 55%, #0f766e 100%)' }}>
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:px-5">
          <button onClick={() => setNavOpen(v => !v)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-white transition hover:bg-white/25 lg:hidden" aria-label="Menu">
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex min-w-0 items-center gap-2.5">
            {boot.platform?.logo ? (
              <img src={boot.platform.logo} alt="" width="36" height="36" className="h-9 w-9 shrink-0 rounded-xl bg-white/90 object-contain p-1" />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30"><Server size={19} /></div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-extrabold uppercase leading-tight tracking-wide sm:text-[15.5px]">{boot.platform?.app_nama || 'Panel Platform'}</h1>
              <p className="truncate text-[11px] text-white/80">Super Admin Platform · Multi-Tenant</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onReload} title="Muat ulang" className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 hover:bg-white/25">
              <RefreshCw size={16} />
            </button>
            <button onClick={() => setPage('profil')} className="flex items-center gap-2 rounded-xl bg-white/15 py-1 pl-1 pr-2.5 ring-1 ring-white/20 transition hover:bg-white/25">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-white/25 text-[11px] font-bold">
                {(boot.user?.nama || 'S')[0]}
              </div>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[140px] truncate text-[12px] font-bold leading-tight">{boot.user?.nama}</span>
                <span className="block text-[10.5px] text-white/80">Pengaturan Profil</span>
              </span>
            </button>
            <button onClick={onLogout} className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 hover:bg-rose-500/70" title="Keluar">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-5 px-3 py-5 sm:px-5">
        {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />}
        <aside className={cx('no-print fixed inset-y-0 left-0 z-40 w-[268px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 transition-transform lg:static lg:z-0 lg:block lg:w-[248px] lg:rounded-2xl lg:border lg:border-white/70 lg:bg-white/80 lg:shadow-card lg:backdrop-blur-xl',
          navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <span className="text-[12.5px] font-bold text-slate-700">Menu Platform</span>
            <button onClick={() => setNavOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
          </div>
          <div className="mb-3 hidden rounded-xl bg-slate-900/[.04] px-2.5 py-2 lg:block">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Ringkasan</p>
            <p className="text-[13px] font-extrabold text-slate-800">{angka(boot.stats?.total || 0)} sekolah</p>
            <p className="text-[10.5px] text-slate-500">{angka(boot.stats?.aktif || 0)} aktif · {angka(boot.stats?.trial || 0)} uji coba</p>
          </div>
          <nav className="space-y-3">
            {groups.map(([grup, items]) => (
              <div key={grup}>
                <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{grup}</p>
                <div className="space-y-0.5">
                  {items.map(m => (
                    <button key={m.key} onClick={() => setPage(m.key)} className={cx('nav-item', page === m.key && 'active')}>
                      <m.icon size={17} className="shrink-0" />
                      <span className="truncate">{m.label}</span>
                      {badge[m.key] ? <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{badge[m.key]}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <button onClick={() => setPage('sekolah')} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 px-2 py-2 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-50">
            <Building2 size={14} /> Buka panel sekolah (Login as Tenant)
          </button>
        </aside>

        <main className="min-w-0 flex-1">
          <Page key={page + ':' + ctxKey} ctx={ctx} />
        </main>
      </div>
    </div>
  );
}
