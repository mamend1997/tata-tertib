import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { inisial, statusKelas } from './api';

export const cx = (...a) => a.filter(Boolean).join(' ');

/* ---------------- Toast ---------------- */
const ToastCtx = createContext({ push: () => {} });
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems(list => [...list, { id, msg, type }]);
    setTimeout(() => setItems(list => list.filter(i => i.id !== id)), 4500);
  }, []);
  const value = useMemo(() => ({
    push,
    ok: (m) => push(m, 'ok'),
    err: (m) => push(m, 'err'),
    info: (m) => push(m, 'info')
  }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* di ponsel: naikkan agar tidak tertutup navigasi bawah */}
      <div className="no-print pointer-events-none fixed bottom-20 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2 lg:bottom-4">
        {items.map(i => (
          <div key={i.id}
            className={cx('pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium shadow-card backdrop-blur animate-fadeUp',
              i.type === 'ok' && 'border-emerald-200 bg-emerald-50/95 text-emerald-800',
              i.type === 'err' && 'border-rose-200 bg-rose-50/95 text-rose-800',
              i.type === 'info' && 'border-sky-200 bg-sky-50/95 text-sky-800')}>
            {i.type === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : i.type === 'err' ? <XCircle size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
            <span className="leading-snug">{i.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------- Badge status ---------------- */
export function StatusBadge({ label, size = 'md' }) {
  return (
    <span className={cx(statusKelas(label), size === 'sm' && 'px-2 py-0.5 text-[10.5px]')}>
      <span className={cx('inline-block h-1.5 w-1.5 rounded-full',
        String(label).toLowerCase() === 'aman' && 'bg-emerald-500',
        String(label).toLowerCase() === 'pantau' && 'bg-sky-500',
        String(label).toLowerCase() === 'perhatian' && 'bg-amber-500',
        String(label).toLowerCase() === 'kritis' && 'bg-orange-500',
        String(label).toLowerCase() === 'siaga' && 'bg-rose-500',
        String(label).toLowerCase() === 'waspada' && 'bg-red-600')} />
      {label}
    </span>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', closeOnBackdrop = true }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size] || 'max-w-2xl';
  const backdrop = (e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.(); };
  /* Panel selalu muat di layar: header & footer tetap, isi digulir sendiri.
     Modal WAJIB dirender lewat portal ke <body>: induk dengan backdrop-blur/transform
     (mis. .card) menjadi containing block sehingga `position:fixed` terkurung di dalam
     kartu — akibatnya modal tampil terpotong dan tombol Simpan tidak terjangkau. */
  return createPortal(
    <div data-modal="1" data-modal-title={title || ''}
      className="no-print fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-slate-900/45 backdrop-blur-sm"
      onMouseDown={backdrop}>
      <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4" onMouseDown={backdrop}>
        <div className={cx('flex max-h-[calc(100dvh-0.5rem)] w-full flex-col animate-pop rounded-t-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl', w)}>
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-bold text-slate-800">{title}</h3>
              {subtitle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Tutup">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------- form bits ---------------- */
export function Field({ label, hint, required, children, className }) {
  return (
    <div className={className}>
      {label ? (
        <label className="label">
          {label}{required ? <span className="text-rose-500"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = 'orange', onClick }) {
  const tones = {
    orange: 'from-orange-500 to-amber-500',
    rose: 'from-rose-500 to-orange-500',
    sky: 'from-sky-500 to-cyan-500',
    emerald: 'from-emerald-500 to-teal-500',
    violet: 'from-violet-500 to-fuchsia-500',
    slate: 'from-slate-500 to-slate-600'
  };
  return (
    <button type="button" onClick={onClick}
      className={cx('kpi group flex items-start gap-3 text-left transition', onClick && 'hover:-translate-y-0.5 hover:shadow-lg')}>
      <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', tones[tone] || tones.orange)}>
        {Icon ? <Icon size={19} /> : null}
      </div>
      <div className="min-w-0">
        <div className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-0.5 text-xl font-extrabold leading-tight text-slate-800">{value}</div>
        {sub ? <div className="mt-0.5 text-[11.5px] font-medium text-slate-500">{sub}</div> : null}
      </div>
    </button>
  );
}

export function Card({ title, subtitle, right, children, className, bodyClass }) {
  return (
    <section className={cx('card', className)}>
      {(title || right) ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="section-title truncate">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p> : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function Empty({ icon: Icon = Info, title = 'Belum ada data', desc }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-500"><Icon size={22} /></div>
      <p className="text-[13.5px] font-semibold text-slate-700">{title}</p>
      {desc ? <p className="max-w-sm text-[12.5px] text-slate-500">{desc}</p> : null}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] font-medium text-slate-500">
      <Loader2 size={18} className="animate-spin" /> {label || 'Memuat data…'}
    </div>
  );
}

export function Avatar({ nama, src, size = 34 }) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, fontWeight: 700 }}>
      {inisial(nama)}
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => e.currentTarget.remove()} /> : null}
    </span>
  );
}

export function Alert({ tone = 'warn', title, children, icon: Icon }) {
  const tones = {
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900'
  };
  const IconC = Icon || (tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle);
  return (
    <div className={cx('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed', tones[tone])}>
      <IconC size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-bold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
