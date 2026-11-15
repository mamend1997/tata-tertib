import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, CalendarDays, CalendarRange, ChartPie, ChevronDown, ClipboardCheck, ClipboardList, CreditCard, FileText, GraduationCap,
  HeartHandshake, LayoutDashboard, LifeBuoy, ListChecks, LogOut, Menu, NotebookPen, RefreshCw, Scale, School,
  ScrollText, Server, Settings, ShieldAlert, ShieldCheck, Sparkles, Trash2, UserCheck, UserCircle, UserCog, UserRound, Users, X, FolderOpen, Copy,
  Inbox, MessageSquareWarning, PanelLeftClose, PanelLeftOpen, MousePointerClick, FileSignature, Table2,
  Smartphone, Repeat, UserRoundCheck, FileSpreadsheet, UserPlus, CalendarClock, Activity
} from 'lucide-react';
import { api } from './api';
import { applyTheme } from './theme';
import { setFavicon } from './branding';
import { Avatar, Modal, Spinner, StatusBadge, ToastProvider, cx, useToast } from './ui';
import GuideHighlight from './components/GuideHighlight';
import Portal from './pages/Portal';
import Login from './pages/Login';
import Maintenance from './pages/Maintenance';
import SuperLogin from './pages/SuperLogin';
import { onPortalPath, portalUrlOf, portalAbsUrl, portalPathOf } from './portalurl';
import Dashboard from './pages/Dashboard';
import Kejadian from './pages/Kejadian';
import Siswa from './pages/Siswa';
import Kelas from './pages/Kelas';
import Kategori from './pages/Kategori';
import Pengguna from './pages/Pengguna';
import Laporan from './pages/Laporan';
import Deteksi from './pages/Deteksi';
import Audit from './pages/Audit';
import Pengaturan from './pages/Pengaturan';
import Profil from './pages/Profil';
import TindakLanjut from './pages/TindakLanjut';
import Jurnal from './pages/Jurnal';
import Analitik from './pages/Analitik';
import Kalender from './pages/Kalender';
import KalenderAkademik from './pages/KalenderAkademik';
import MonitorKBM from './pages/MonitorKBM';
import NavMobile from './pages/NavMobile';
import GuruPengganti from './pages/GuruPengganti';
import RekapBulanan from './pages/RekapBulanan';
import Sampah from './pages/Sampah';
import KelolaFile from './pages/KelolaFile';
import AuditData from './pages/AuditData';
import Jadwal from './pages/Jadwal';
import DesainJadwal from './pages/DesainJadwal';
import AbsensiGuru from './pages/AbsensiGuru';
import AbsensiSiswa from './pages/AbsensiSiswa';
import RekapAbsensiGuru from './pages/RekapAbsensiGuru';
import RekapAbsensiSiswa from './pages/RekapAbsensiSiswa';
import KanalAduan from './pages/KanalAduan';
import ProgramBK from './pages/ProgramBK';
import AsesmenBK from './pages/AsesmenBK';
import AsesmenSoal from './pages/AsesmenSoal';
import AduanPublik from './pages/AduanPublik';
import AsesmenPublik from './pages/AsesmenPublik';
import PresensiSiswa from './pages/PresensiSiswa';
import JadwalPublik from './pages/JadwalPublik';
import Langganan, { Tiket, Panduan, Legal } from './pages/Langganan';
import Feedback, { FeedbackAdmin } from './pages/Feedback';
import SuperAdmin from './pages/superadmin/SuperAdmin';

const PAGES = {
  dashboard: Dashboard, kejadian: Kejadian, deteksi: Deteksi, jurnal: Jurnal, tindak_lanjut: TindakLanjut,
  analitik: Analitik, siswa: Siswa, kelas: Kelas, kategori: Kategori, pengguna: Pengguna,
  laporan: Laporan, audit: Audit, pengaturan: Pengaturan, profil: Profil,
  jadwal: Jadwal, kalender_akademik: KalenderAkademik, monitor_kbm: MonitorKBM, desain_jadwal: DesainJadwal,
  absensi_guru: AbsensiGuru, absensi_siswa: AbsensiSiswa,
  rekap_absensi_guru: RekapAbsensiGuru, rekap_absensi_siswa: RekapAbsensiSiswa,
  guru_pengganti: GuruPengganti, rekap_bulanan: RekapBulanan,
  bk_layanan: ProgramBK, asesmen: AsesmenBK, asesmen_soal: AsesmenSoal, aduan: KanalAduan,
  kalender: Kalender, sampah: Sampah, berkas: KelolaFile, nav_mobile: NavMobile,
  // menu akun & layanan (selalu tersedia untuk semua role)
  langganan: Langganan, tiket: Tiket, panduan: Panduan, legal: Legal,
  feedback: Feedback, feedback_admin: FeedbackAdmin,
  // halaman tersembunyi (tidak ada di daftar fitur/navigasi) — khusus Administrator
  'audit-data': AuditData
};

/** area aplikasi ditentukan oleh hash: #/saas → panel platform, #/super → portal Super Admin */
const areaOf = (hash) => {
  const h = String(hash || '');
  if (/^#\/super(\/|$)/.test(h)) return 'superlogin';   // #/super → portal eksklusif Super Admin
  if (/^#\/saas(\/|$)/.test(h)) return 'saas';
  return 'app';
};

/** path relatif terhadap prefix aplikasi (base) */
const relPath = () => {
  let p = String(window.location.pathname || '');
  const base = (window.__BASE__ || '');
  if (base && (p === base || p.startsWith(base + '/'))) p = p.slice(base.length) || '/';
  return p;
};
/** URL fisik portal Super Admin: <base>/super-admin (terpisah dari login sekolah) */
const onSuperLoginPath = () => /^\/super-admin\/?$/i.test(relPath());
/** URL halaman pendaftaran sekolah baru: <base>/daftar */
const onDaftarPath = () => /^\/daftar(\/|$)/i.test(relPath());
/** halaman publik presensi siswa: <base>/presensi/<token> (tanpa login) */
const presensiToken = () => {
  const m = /^\/presensi\/([A-Za-z0-9._%-]+)\/?$/i.exec(relPath());
  return m ? decodeURIComponent(m[1]) : '';
};
const onPresensiPath = () => !!presensiToken();
/** halaman publik rekap jadwal: <base>/jadwal-publik/<token> (tanpa login) */
const jadwalPublikToken = () => {
  const m = /^\/jadwal-publik\/([A-Za-z0-9._%-]+)\/?$/i.exec(relPath());
  return m ? decodeURIComponent(m[1]) : '';
};
const onJadwalPublikPath = () => !!jadwalPublikToken();
/** halaman publik aduan kekerasan: <base>/aduan/<token> */
const aduanToken = () => {
  const m = /^\/aduan\/([A-Za-z0-9._%-]+)\/?$/i.exec(relPath());
  return m ? decodeURIComponent(m[1]) : '';
};
const onAduanPath = () => !!aduanToken();
/** halaman publik asesmen BK: <base>/asesmen/<token> */
const asesmenToken = () => {
  const m = /^\/asesmen\/([A-Za-z0-9._%-]+)\/?$/i.exec(relPath());
  return m ? decodeURIComponent(m[1]) : '';
};
const onAsesmenPath = () => !!asesmenToken();

export default function App() {
  const [area, setArea] = useState(() => {
    if (onSuperLoginPath()) return 'superlogin';
    if (onDaftarPath()) return 'daftar';
    /* halaman publik tanpa login */
    if (onPresensiPath()) return 'presensi';
    if (onJadwalPublikPath()) return 'jadwalpublik';
    if (onAduanPath()) return 'aduan';
    if (onAsesmenPath()) return 'asesmen';
    /* portal publik siswa: <base>/<slug-sekolah>/portal-siswa (alamat lama /portal → 404) */
    if (onPortalPath()) return 'portal';
    return areaOf(window.location.hash);
  });
  useEffect(() => {
    /* halaman berbasis PATH (/daftar, /<slug>/portal-siswa, /super-admin) tidak boleh
       ditimpa oleh perubahan hash dari panel (mis. #/dashboard). */
    const onHash = () => {
      if (onSuperLoginPath() || onDaftarPath() || onPortalPath() || onPresensiPath() || onJadwalPublikPath() || onAduanPath() || onAsesmenPath()) return;
      setArea(areaOf(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (area === 'presensi') return <ToastProvider><PresensiSiswa token={presensiToken()} /></ToastProvider>;
  if (area === 'jadwalpublik') return <ToastProvider><JadwalPublik token={jadwalPublikToken()} /></ToastProvider>;
  if (area === 'aduan') return <ToastProvider><AduanPublik token={aduanToken()} /></ToastProvider>;
  if (area === 'asesmen') return <ToastProvider><AsesmenPublik token={asesmenToken()} /></ToastProvider>;
  if (area === 'portal') return <ToastProvider><Portal /></ToastProvider>;
  if (area === 'superlogin') return <ToastProvider><SuperLogin /></ToastProvider>;
  if (area === 'daftar') return <ToastProvider><AdminApp daftarAwal /></ToastProvider>;
  if (area === 'saas') return <ToastProvider><SuperArea key="saas" /></ToastProvider>;
  return <ToastProvider><AdminApp /></ToastProvider>;
}

/* ================= PANEL SUPER ADMIN PLATFORM ================= */
function SuperArea() {
  const toast = useToast();
  const [boot, setBoot] = useState(null);
  /* tandai sejak awal agar /api/bootstrap memilih sesi Super Admin
     (bukan sesi sekolah yang mungkin ada di browser yang sama) */
  if (typeof window !== 'undefined') window.__PANEL__ = 'saas';
  useEffect(() => () => { if (typeof window !== 'undefined') window.__PANEL__ = ''; }, []);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/bootstrap');
      setBoot(data);
      applyTheme(data.settings || {});
      setFavicon(data.platform || {});
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    setBoot(null);
    window.location.hash = '';
    window.location.reload();
  }

  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Menyiapkan panel platform…" /></div>;
  if (!boot?.user || boot.scope !== 'super') {
    const base = (typeof window !== 'undefined' && window.__BASE__) || '';
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-[420px] p-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white"><Server size={22} /></div>
          <h1 className="mt-3 text-[18px] font-extrabold text-slate-800">Panel Super Admin</h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Panel ini hanya untuk Super Admin platform. Silakan masuk melalui portal khusus Super Admin.
          </p>
          <a href={base + '/super-admin'} className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 py-2.5">
            <ShieldCheck size={15} /> Buka Portal Super Admin
          </a>
          <a href={base + '/'} className="btn-ghost mt-2 w-full justify-center"><LogOut size={15} /> Kembali ke login sekolah</a>
        </div>
      </div>
    );
  }
  return <SuperAdmin boot={boot} onReload={load} onLogout={logout} />;
}

function AdminApp({ daftarAwal = false }) {
  const toast = useToast();
  const [boot, setBoot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    return PAGES[h] ? h : 'dashboard';
  });
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [filters, setFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem('stt:filters') || '{}'); } catch (e) { return {}; }
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [openSiswaId, setOpenSiswaId] = useState(null);
  const [guide, setGuide] = useState(null);
  /* ---- sidebar interaktif: lipat, hover fly-out, akordeon grup menu ---- */
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try { return localStorage.getItem('stt:nav-collapsed') === '1'; } catch (e) { return false; }
  });
  const [hoverPref, setHoverPref] = useState(() => {
    try { return localStorage.getItem('stt:nav-hover') !== '0'; } catch (e) { return true; }
  });
  const [hoverOpen, setHoverOpen] = useState(false);
  /* null = semua grup terbuka (bawaan). Array = pilihan pengguna yang disimpan. */
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const raw = localStorage.getItem('stt:nav-groups');
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
    } catch (e) { }
    return null;
  });

  const load = useCallback(async () => {
    try {
      const data = await api('/api/bootstrap');
      /* Super Admin platform memakai panel tersendiri (#/saas) — jangan pernah
         dirender dengan panel sekolah (data sekolah tidak tersedia). */
      if (data && data.scope === 'super') {
        window.location.hash = '/saas/dashboard';
        setBoot(data);
        setLoading(false);
        return;
      }
      if (data && data.maintenance) {
        setBoot(data);
        setLoading(false);
        return;
      }
      setBoot(data);
      applyTheme(data.settings);
      setFavicon(data.platform || {});
      if (data.user && data.filters) {
        /* Satu tahun pelajaran penuh — semester tidak lagi dipakai sebagai filter.
           PENTING: TA lama di localStorage bisa sudah dihapus → kembali ke TA server
           (kalau tidak, jadwal & absensi tampak kosong karena TA-nya tidak ada). */
        setFilters(f => {
          const ids = (data.tahun || []).map(t => Number(t.id));
          const ta = ids.includes(Number(f.ta)) ? Number(f.ta) : Number(data.filters.taId);
          return { ...f, ta: ta || data.filters.taId };
        });
      }
    } catch (e) {
      /* 503 = mode pemeliharaan aktif → tampilkan halaman pemeliharaan */
      if (e.status === 503) setBoot({ maintenance: true, maintenance_pesan: e.message, settings: {}, platform: {} });
      else toast.err(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ANTI AUTO-LOGOUT: kirim keep-alive berkala selama aplikasi terbuka.
     Sesi di server diperpanjang otomatis (sliding) sehingga pengguna tidak
     terlempar ke halaman login walau aplikasi dibiarkan terbuka lama. */
  useEffect(() => {
    if (!boot?.user) return;
    let alive = true;
    const touch = () => { api('/api/session/touch', { method: 'POST' }).catch(() => { }); };
    const t = setInterval(() => { if (alive && document.visibilityState !== 'hidden') touch(); }, 10 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') touch(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [boot?.user]);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      if (PAGES[h]) setPage(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    /* di halaman pendaftaran (/daftar) jangan menulis hash — URL harus tetap bersih */
    if (!daftarAwal) window.location.hash = '/' + page;
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  /* selesai daftar/login dari halaman /daftar → pindahkan ke URL aplikasi normal */
  useEffect(() => {
    if (!daftarAwal || !boot?.user) return;
    try { window.history.replaceState({}, '', (window.__BASE__ || '') + '/#/' + page); } catch (e) { /* abaikan */ }
  }, [daftarAwal, boot?.user]);

  useEffect(() => {
    localStorage.setItem('stt:filters', JSON.stringify(filters));
  }, [filters]);

  /* preferensi tampilan sidebar disimpan per peramban (bukan pengaturan sekolah) */
  useEffect(() => { try { localStorage.setItem('stt:nav-collapsed', sideCollapsed ? '1' : '0'); } catch (e) { } }, [sideCollapsed]);
  useEffect(() => { try { localStorage.setItem('stt:nav-hover', hoverPref ? '1' : '0'); } catch (e) { } }, [hoverPref]);
  useEffect(() => {
    try { localStorage.setItem('stt:nav-groups', JSON.stringify(openGroups === null ? 'semua' : openGroups)); } catch (e) { }
  }, [openGroups]);
  /* saat menu dilipat lagi, tutup panel fly-out */
  useEffect(() => { if (!sideCollapsed) setHoverOpen(false); }, [sideCollapsed]);

  const perms = boot?.perms || {};
  const can = useCallback((key, action = 'view') => !!(perms[key] && perms[key][action]), [perms]);
  const stopGuide = useCallback(() => setGuide(null), []);
  const startGuide = useCallback(step => {
    setGuide({ ...step, runId: Date.now() + Math.random() });
    if (step.page) setPage(step.page);
  }, []);

  const navItems = useMemo(() => {
    const nav = boot?.settings?.nav || [];
    return nav.filter(n => !n.hidden && can(n.key, 'view'));
  }, [boot, can]);

  useEffect(() => {
    if (!boot?.user) return;
    if (page === 'profil') return;
    if (page === 'audit-data') {
      if (boot.user.role !== 'admin') setPage('dashboard');
      return;
    }
    if (!can(page, 'view')) {
      const first = navItems[0]?.key;
      if (first && first !== page) setPage(first);
    }
  }, [boot, page, can, navItems]);

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    setBoot(null);
    setUserOpen(false);
    window.location.reload();
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Menyiapkan aplikasi…" /></div>;
  }

  if (boot?.maintenance) {
    return (
      <Maintenance
        pesan={boot.maintenance_pesan}
        namaApp={(boot.platform && boot.platform.app_nama) || (boot.settings && boot.settings.app_nama)}
        logo={(boot.platform && (boot.platform.logo || boot.platform.favicon)) || ''}
        onRetry={() => { setLoading(true); load(); }}
      />
    );
  }

  if (!boot?.user) {
    return <Login initialMode={daftarAwal ? 'daftar' : 'login'} onDone={async () => { await load(); }} />;
  }

  if (boot.scope === 'super') {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-[420px] p-6 text-center">
          <Spinner label="Membuka panel Super Admin…" />
          <a href="#/saas/dashboard" className="btn-primary mt-3 w-full justify-center py-2.5">Buka Panel Super Admin</a>
        </div>
      </div>
    );
  }

  const settings = boot.settings;
  const PageComp = PAGES[page] || Dashboard;
  const tahun = boot.tahun || [];
  const schoolLogo = settings.logo || settings.app_logo || '';
  const appLogo = settings.app_logo || settings.logo || '';
  /* nama aplikasi: pengaturan sekolah → branding GLOBAL (tanpa hardcode) */
  const appName = settings.app_nama || boot.platform?.app_nama || '';
  // dikelompokkan per grup menu (bukan hook — dipanggil setelah early return)
  const groups = (() => {
    const map = new Map();
    for (const f of boot.features || []) {
      const item = navItems.find(n => n.key === f.key);
      if (!item) continue;
      if (!map.has(f.grup)) map.set(f.grup, []);
      map.get(f.grup).push(item);
    }
    return [...map.entries()];
  })();

  /* tautan portal publik SISWA: selalu dari slug sekolah yang sedang login */
  const portalHref = portalUrlOf(boot.tenant) || portalUrlOf(settings) || '';
  const portalLabel = portalPathOf(boot.tenant) || '';
  const salinPortal = async () => {
    const abs = portalAbsUrl(boot.tenant);
    try { await navigator.clipboard.writeText(abs); toast.ok('Tautan portal disalin: ' + abs); }
    catch (e) { toast.err('Gagal menyalin — salin manual: ' + abs); }
  };

  /* tombol navigasi bawah: dari server (sesuai role & pengaturan admin),
     dengan fallback 3 menu pertama bila data belum tersedia */
  const bottomNav = (() => {
    const dariServer = Array.isArray(boot.bottom_nav) ? boot.bottom_nav : [];
    if (dariServer.length) return dariServer;
    return navItems.slice(0, 3).map(n => ({ key: n.key, label: n.label, icon: n.icon }));
  })();

  const ctx = {
    boot, can, filters, setFilters, toast, refreshKey,
    reloadBoot: load,
    guide, startGuide, stopGuide,
    page, setPage,
    openSiswaCard: (id) => { setOpenSiswaId(Number(id)); setPage('siswa'); },
    openSiswaId, clearOpenSiswa: () => setOpenSiswaId(null),
    bump: () => setRefreshKey(k => k + 1)
  };

  return (
    <div className="min-h-screen">
      {/* ================= HEADER ================= */}
      <header className="no-print sticky top-0 z-40 text-white shadow-lg" style={{ background: 'linear-gradient(120deg, var(--primary-700) 0%, var(--primary) 55%, #f59e0b 100%)' }}>
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:px-5">
          {/* LOGO SEKOLAH (ponsel) / logo aplikasi (desktop) */}
          <div className="flex min-w-0 items-center gap-2.5">
            {schoolLogo ? (
              <img src={schoolLogo} alt="" className="h-9 w-9 shrink-0 rounded-xl bg-white/90 object-contain p-1 shadow-soft sm:hidden" width="36" height="36" />
            ) : null}
            {appLogo ? (
              <img src={appLogo} alt="" className={cx('h-9 w-9 shrink-0 rounded-xl bg-white/90 object-contain p-1 shadow-soft', schoolLogo && 'hidden sm:block')} width="36" height="36" />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30"><ShieldCheck size={19} /></div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-extrabold uppercase leading-tight tracking-wide sm:text-[15.5px]">{appName}</h1>
              <p className="truncate text-[11px] text-white/80">{settings.sekolah_nama}</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-xl bg-white/15 px-2 py-1.5 ring-1 ring-white/20 md:flex">
              <CalendarDays size={14} className="text-white/85" />
              <select value={filters.ta || ''} onChange={e => setFilters(f => ({ ...f, ta: Number(e.target.value) }))}
                className="cursor-pointer border-0 bg-transparent pr-1 text-[12px] font-semibold text-white outline-none [&>option]:text-slate-800">
                {tahun.map(t => <option key={t.id} value={t.id}>TP {t.nama}</option>)}
              </select>
            </div>

            <button onClick={() => setRefreshKey(k => k + 1)} title="Muat ulang data"
              className="hidden h-9 w-9 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 transition hover:bg-white/25 sm:grid">
              <RefreshCw size={16} />
            </button>

            <div className="relative">
              <button onClick={() => setUserOpen(v => !v)} className="flex items-center gap-2 rounded-xl bg-white/15 py-1 pl-1 pr-2.5 ring-1 ring-white/20 transition hover:bg-white/25">
                <Avatar nama={boot.user.nama} src={boot.user.foto} size={28} />
                <span className="block text-left">
                  <span className="block max-w-[86px] truncate text-[11px] font-bold leading-tight sm:max-w-[130px] sm:text-[12px]">{boot.user.nama}</span>
                  <span className="hidden text-[10.5px] text-white/80 sm:block">{boot.user.role_label}</span>
                </span>
                <ChevronDown size={14} className="hidden text-white/80 sm:block" />
              </button>
              {userOpen ? (
                <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xl">
                  <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-3">
                    <p className="truncate text-[13px] font-bold text-slate-800">{boot.user.nama}</p>
                    <p className="text-[11.5px] text-slate-500">{boot.user.jabatan || boot.user.role_label}</p>
                    {boot.user.nip ? <p className="text-[11px] text-slate-400">NIP. {boot.user.nip}</p> : null}
                  </div>
                  <button onClick={() => { setUserOpen(false); setPage('profil'); }} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] font-semibold hover:bg-slate-50">
                    <UserCircle size={15} className="text-orange-500" /> Profil Akun
                  </button>
                  <button onClick={() => { setUserOpen(false); setNotifOpen(true); }} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] font-semibold hover:bg-slate-50">
                    <Sparkles size={15} className="text-orange-500" /> Informasi aplikasi
                  </button>
                  <button onClick={logout} className="flex w-full items-center gap-2 border-t border-slate-100 px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-rose-600 hover:bg-rose-50">
                    <LogOut size={15} /> Keluar
                  </button>
                </div>
              ) : null}
            </div>

            {/* TOMBOL GARIS TIGA (hamburger) — pojok kanan atas, khusus ponsel */}
            <button onClick={() => setNavOpen(v => !v)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-white ring-1 ring-white/20 transition hover:bg-white/25 lg:hidden"
              aria-label="Menu" aria-expanded={navOpen} data-hamburger>
              {navOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* filter mobile */}
        <div className="flex items-center gap-2 border-t border-white/15 px-3 pb-2 pt-1.5 md:hidden">
          <select value={filters.ta || ''} onChange={e => setFilters(f => ({ ...f, ta: Number(e.target.value) }))}
            className="flex-1 rounded-lg bg-white/15 px-2 py-1.5 text-[11.5px] font-semibold text-white outline-none ring-1 ring-white/20 [&>option]:text-slate-800">
            {tahun.map(t => <option key={t.id} value={t.id}>TP {t.nama}</option>)}
          </select>
        </div>
      </header>

      {boot.pengumuman && boot.pengumuman.length ? (
        <div className="no-print mx-auto max-w-[1600px] px-3 pt-3 sm:px-5">
          {boot.pengumuman.map(p => (
            <div key={p.id} className={cx('mb-2 rounded-xl border px-3 py-2 text-[12.5px]',
              p.tipe === 'maintenance' ? 'border-amber-200 bg-amber-50 text-amber-900' :
                p.tipe === 'peringatan' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-sky-200 bg-sky-50 text-sky-800')}>
              <b>{p.judul}</b>{p.isi ? <span className="ml-1">— {p.isi}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {boot.tenant && boot.tenant.status === 'ditangguhkan' ? (
        <div className="no-print mx-auto max-w-[1600px] px-3 pt-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
            <ShieldAlert size={15} />
            <span className="min-w-0 flex-1">Masa aktif layanan sekolah berakhir — menu operasional dibatasi. Perpanjang untuk membuka kembali semua menu.</span>
            <button onClick={() => setPage('langganan')} className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-bold text-rose-700 ring-1 ring-rose-200">Info &amp; Layanan</button>
          </div>
        </div>
      ) : boot.tenant && !boot.tenant.lifetime && boot.tenant.aktif_sampai ? (
        <div className="no-print mx-auto max-w-[1600px] px-3 pt-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-900">
            <CreditCard size={14} />
            <span className="min-w-0 flex-1">Paket <b>{boot.tenant.paket_nama}</b> aktif sampai <b>{boot.tenant.aktif_sampai}</b>.</span>
            <button onClick={() => setPage('langganan')} className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-bold text-amber-800 ring-1 ring-amber-200">Perpanjang</button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1600px] gap-5 px-3 py-5 pb-24 sm:px-5 lg:pb-5">
        {/* ================= SIDEBAR (akordeon grup + fly-out saat dilipat) ================= */}
        {navOpen && <div className="no-print fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />}
        <aside
          onMouseEnter={() => { if (hoverPref && sideCollapsed) setHoverOpen(true); }}
          onMouseLeave={() => setHoverOpen(false)}
          className={cx('no-print fixed inset-y-0 left-0 z-40 w-[268px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 transition-[width] duration-200',
            'lg:static lg:block lg:self-start lg:rounded-2xl lg:border lg:border-white/70 lg:bg-white/80 lg:shadow-card lg:backdrop-blur-xl',
            navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
            /* panel melayang saat hover harus DI ATAS konten halaman (bukan tenggelam) */
            (sideCollapsed && hoverOpen) ? 'lg:relative lg:z-50 lg:overflow-visible' : 'lg:z-0 lg:overflow-visible',
            sideCollapsed ? 'lg:w-[78px]' : 'lg:w-[236px]')}>
          <div className={cx('min-w-0',
            sideCollapsed && hoverOpen && 'lg:absolute lg:left-0 lg:top-0 lg:z-[60] lg:max-h-[calc(100vh-1rem)] lg:w-[268px] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-3 lg:shadow-2xl')}>
          {/* header laci (ponsel): logo sekolah · profil pengguna · tombol tutup */}
          <div className="mb-3 lg:hidden" data-drawer-head>
            <div className="flex items-center gap-2.5 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 px-3 py-2.5 text-white">
              {schoolLogo ? (
                <img src={schoolLogo} alt="" width="34" height="34" className="h-[34px] w-[34px] shrink-0 rounded-xl bg-white/90 object-contain p-1" />
              ) : <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30"><GraduationCap size={18} /></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-extrabold leading-tight">{boot.user.nama}</p>
                <p className="truncate text-[10.5px] text-white/85">{boot.user.role_label} · {settings.sekolah_nama}</p>
              </div>
              <button onClick={() => setNavOpen(false)} aria-label="Tutup menu"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/20 hover:bg-white/30">
                <X size={15} />
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 px-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <Menu size={12} /> Semua Menu
            </p>
          </div>
          <div className="mb-2 hidden items-center gap-2 rounded-xl bg-orange-50/80 px-2.5 py-2 lg:flex">
            {schoolLogo ? <img src={schoolLogo} alt="" width="28" height="28" loading="lazy" className="h-7 w-7 shrink-0 rounded-lg bg-white object-contain p-0.5" /> : <GraduationCap size={18} className="shrink-0 text-orange-500" />}
            <div className={cx('min-w-0 flex-1', sideCollapsed && !hoverOpen && 'lg:hidden')}>
              <p className="truncate text-[11.5px] font-bold text-slate-700">{settings.sekolah_nama}</p>
              <p className="text-[10.5px] text-slate-500">NPSN {settings.sekolah_npsn || '-'}</p>
            </div>
            <button type="button" onClick={() => setSideCollapsed(v => !v)}
              title={sideCollapsed ? 'Tampilkan menu samping' : 'Lipat menu samping'}
              aria-label={sideCollapsed ? 'Tampilkan menu samping' : 'Lipat menu samping'}
              className="hidden shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-orange-600 lg:grid lg:place-items-center">
              {sideCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
          <nav className="space-y-1.5">
            {groups.map(([grup, items]) => {
              const isOpen = openGroups === null ? true : openGroups.includes(grup);
              /* saat menu dilipat (ikon saja) sub-menu selalu ditampilkan */
              const showItems = (sideCollapsed && !hoverOpen) ? true : isOpen;
              /* AKORDEON EKSKLUSIF: membuka satu grup otomatis menutup grup lain */
              const toggleGroup = () => {
                const aktif = openGroups === null ? groups.map(g => g[0]) : openGroups.slice();
                setOpenGroups(aktif.includes(grup) && aktif.length === 1 ? [] : [grup]);
              };
              return (
                <div key={grup} className="min-w-0">
                  <button type="button" onClick={toggleGroup} aria-expanded={showItems}
                    title={grup}
                    className={cx('mb-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 transition hover:bg-slate-50 hover:text-slate-600',
                      sideCollapsed && !hoverOpen && 'lg:justify-center lg:px-0')}>
                    <span className={cx('min-w-0 flex-1 truncate text-left', sideCollapsed && !hoverOpen && 'lg:hidden')}>{grup}</span>
                    <ChevronDown size={12} className={cx('shrink-0 transition-transform', showItems && 'rotate-180', sideCollapsed && !hoverOpen && 'lg:hidden')} />
                  </button>
                  {showItems && (
                    <div className="space-y-0.5">
                      {items.map(n => (
                        <button key={n.key} onClick={() => { setPage(n.key); setNavOpen(false); }}
                          title={n.label}
                          className={cx('nav-item', page === n.key && 'active', sideCollapsed && !hoverOpen && 'lg:justify-center lg:px-0')}>
                          <NavIcon name={n.icon} />
                          <span className={cx('truncate', sideCollapsed && !hoverOpen && 'lg:hidden')}>{n.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <button onClick={() => { setPage('profil'); setNavOpen(false); }} title="Profil Akun"
              className={cx('nav-item', page === 'profil' && 'active', sideCollapsed && !hoverOpen && 'lg:justify-center lg:px-0')}>
              <UserCircle size={17} className="shrink-0" />
              <span className={cx('truncate', sideCollapsed && !hoverOpen && 'lg:hidden')}>Profil Akun</span>
            </button>
          </div>
          {/* sakelar preferensi: buka otomatis saat kursor mendekat */}
          <div className={cx('mt-3 rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2', sideCollapsed && !hoverOpen && 'lg:hidden')}>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={hoverPref} onChange={e => setHoverPref(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500" />
              <span className="text-[11px] font-semibold leading-snug text-slate-600">
                <MousePointerClick size={11} className="mr-1 inline align-[-1px] text-orange-500" />
                Buka otomatis saat kursor mendekat
                <span className="block text-[10px] font-normal text-slate-400">berlaku saat menu samping dilipat</span>
              </span>
            </label>
          </div>
          <div className={cx('mt-4 rounded-xl border border-dashed border-orange-200 bg-orange-50/60 p-3', sideCollapsed && !hoverOpen && 'lg:hidden')}>
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-orange-700"><ShieldCheck size={13} /> Portal Siswa</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">Bagikan tautan portal agar siswa & orang tua bisa memeriksa poin sendiri tanpa login.</p>
            {portalHref ? (
              <>
                <p className="mt-1.5 break-all rounded-md bg-white/70 px-1.5 py-1 font-mono text-[10px] text-slate-500">{portalLabel}</p>
                <div className="mt-2 flex gap-1.5">
                  <a href={portalHref} target="_blank" rel="noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[11.5px] font-bold text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100">
                    Buka Portal
                  </a>
                  <button type="button" onClick={() => salinPortal()}
                    className="grid w-8 shrink-0 place-items-center rounded-lg bg-white text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100" title="Salin tautan portal">
                    <Copy size={13} />
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-[10.5px] text-slate-500">Slug portal belum diatur.</p>
            )}
          </div>
          </div>
        </aside>

        {/* ================= CONTENT ================= */}
        <main className="min-w-0 flex-1">
          <PageComp key={page} ctx={ctx} />
        </main>
      </div>

      {/* ================= NAVIGASI BAWAH (KHUSUS PONSEL) ================= */}
      <BottomNav items={bottomNav} page={page} onPick={(k) => { setPage(k); setNavOpen(false); }} />

      <GuideHighlight guide={guide} onClose={stopGuide} />

      <footer className="no-print mx-auto max-w-[1600px] px-4 pb-28 pt-2 text-center text-[11.5px] text-slate-400 lg:pb-6">
        {appName} v{boot.version} · {settings.sekolah_nama}
        {boot.tenant ? <> · Kode sekolah <b className="font-mono">{boot.tenant.kode}</b> · Paket {boot.tenant.paket_nama}</> : null}
      </footer>

      <Modal open={notifOpen} onClose={() => setNotifOpen(false)} title="Informasi aplikasi" size="sm">
        <div className="space-y-3 text-[13px] text-slate-600">
          <div className="flex items-center gap-3 rounded-xl bg-orange-50 p-3">
            <UserRound size={18} className="text-orange-500" />
            <div>
              <p className="font-bold text-slate-800">{boot.user.nama}</p>
              <p className="text-[12px]">{boot.user.role_label} · {boot.user.jabatan}</p>
            </div>
          </div>
          <p>Aplikasi <b>{appName}</b> versi {boot.version}. Digunakan untuk mencatat pelanggaran & prestasi siswa, memantau status disiplin, serta mencetak laporan dan surat peringatan.</p>
          <AlertTriangle size={0} />
          <p className="text-[12px] text-slate-500">Status disiplin dihitung dari poin pelanggaran dikurangi poin prestasi (poin bersih). Ambang batas dapat diubah di menu Pengaturan.</p>
        </div>
      </Modal>
    </div>
  );
}

/* =====================================================================
   BOTTOM NAVIGATION — hanya tampil pada perangkat ponsel (lg:hidden).
   Susunan & visibilitas tombol diatur Administrator per role
   (menu Navigasi Mobile); tombol tengah = fokus utama (highlight).
   ===================================================================== */
function BottomNav({ items = [], page, onPick }) {
  if (!items.length) return null;
  const tengah = Math.floor(items.length / 2);
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-6px_24px_rgba(15,23,42,0.10)] backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} data-bottom-nav>
      <div className="mx-auto flex max-w-[640px] items-end justify-around px-1.5 pb-1.5 pt-1">
        {items.map((it, i) => {
          const aktif = page === it.key;
          const fokus = i === tengah;
          return (
            <button key={it.key} type="button" onClick={() => onPick(it.key)}
              data-bottom-nav-item={it.key} aria-current={aktif ? 'page' : undefined}
              className={cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1 transition',
                fokus && '-mt-4')}>
              <span className={cx('grid place-items-center rounded-full transition',
                fokus ? 'h-11 w-11 shadow-lg' : 'h-8 w-8',
                fokus
                  ? (aktif ? 'bg-orange-600 text-white' : 'bg-orange-500 text-white hover:bg-orange-600')
                  : (aktif ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'))}>
                <NavIcon name={it.icon} />
              </span>
              <span className={cx('w-full truncate text-center text-[9.5px] font-bold leading-tight',
                fokus ? 'text-orange-700' : (aktif ? 'text-orange-600' : 'text-slate-500'))}>
                {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const NAV_ICONS = {
  LayoutDashboard, ClipboardList, ShieldAlert, Users, School, ListChecks, UserCog, FileText, ScrollText, Settings,
  NotebookPen, HeartHandshake, ChartPie, UserCircle, CalendarDays, Trash2, FolderOpen,
  CreditCard, LifeBuoy, BookOpen, Scale, Inbox, MessageSquareWarning, CalendarRange, UserCheck, ClipboardCheck, FileSignature,
  Smartphone, UserRoundCheck, FileSpreadsheet, CalendarClock, Activity
};
function NavIcon({ name }) {
  const C = NAV_ICONS[name] || LayoutDashboard;
  return <C size={17} className="shrink-0" />;
}
