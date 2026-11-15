import React from 'react';
import { RefreshCw, ShieldCheck, Wrench } from 'lucide-react';

/* =====================================================================
   Halaman Mode Pemeliharaan
   Ditampilkan untuk SEMUA akun sekolah (admin, guru, TU, wali kelas, …)
   ketika Super Admin mengaktifkan Mode Pemeliharaan. Akun Super Admin
   tidak pernah melihat halaman ini (panel platform tetap dapat dibuka).
   ===================================================================== */
export default function Maintenance({ pesan, namaApp, logo, onRetry }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 px-4 py-10 text-slate-100"
      style={{ background: 'radial-gradient(1000px 500px at 15% -10%, #1e3a8a55, transparent), radial-gradient(900px 500px at 100% 0%, #b4530955, transparent), #0b1120' }}
      data-maintenance="1">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-7 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg">
          {logo
            ? <img src={logo} alt="" className="h-10 w-10 object-contain" />
            : <Wrench size={28} />}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-300/90">Mode Pemeliharaan</p>
        <h1 className="mt-2 text-[22px] font-extrabold leading-tight">Sistem sedang dalam pemeliharaan</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-slate-300" data-maintenance-pesan>
          {pesan || 'Sistem sedang dalam pemeliharaan, silakan coba beberapa saat lagi.'}
        </p>
        <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-[12px] leading-relaxed text-slate-300">
          <p className="font-bold text-slate-100">Akses akun sekolah ditutup sementara</p>
          <p>Seluruh halaman dan transaksi (dashboard, input kejadian, laporan, dsb.) tidak dapat dibuka selama pemeliharaan berlangsung. Data Anda tetap aman.</p>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 text-[13px] font-bold text-white shadow transition hover:brightness-110" data-maintenance-retry>
              <RefreshCw size={15} /> Coba Lagi
            </button>
          ) : null}
          <button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2.5 text-[13px] font-semibold text-slate-200 transition hover:bg-white/10">
            <RefreshCw size={15} /> Muat Ulang
          </button>
        </div>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck size={13} /> {namaApp || 'SMART POIN SISWA'} · dijalankan oleh administrator platform
        </p>
      </div>
    </div>
  );
}
