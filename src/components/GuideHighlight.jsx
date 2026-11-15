import React, { useEffect, useState } from 'react';
import { MousePointerClick, Sparkles, X } from 'lucide-react';

export default function GuideHighlight({ guide, onClose }) {
  const [rect, setRect] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!guide?.target && !guide?.tourId) return undefined;
    let target = null;
    let timer = 0;
    let attempts = 0;
    let resizeObserver = null;
    let retryObserver = null;

    const updateRect = () => {
      if (!target || !document.body.contains(target)) {
        setRect(null);
        return;
      }
      const box = target.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height });
    };
    const targetClicked = () => onClose();
    const locate = () => {
      const selector = guide.tourId
        ? `[data-tour-id="${guide.tourId}"]`
        : `[data-guide-target="${guide.target}"]`;
      const candidate = document.querySelector(selector);
      if (candidate) {
        target = candidate;
        setMissing(false);
        candidate.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        candidate.addEventListener('click', targetClicked, { once: true });
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(updateRect);
          resizeObserver.observe(candidate);
        }
        retryObserver?.disconnect();
        requestAnimationFrame(updateRect);
        return;
      }
      attempts += 1;
      if (attempts < 30) {
        timer = window.setTimeout(locate, 200);
      } else {
        setMissing(true);
      }
    };

    retryObserver = new MutationObserver(() => {
      if (!target) locate();
    });
    retryObserver.observe(document.body, { childList: true, subtree: true });
    locate();
    const escape = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);

    return () => {
      window.clearTimeout(timer);
      retryObserver?.disconnect();
      resizeObserver?.disconnect();
      if (target) {
        target.removeEventListener('click', targetClicked);
        window.removeEventListener('resize', updateRect);
        window.removeEventListener('scroll', updateRect, true);
      }
      window.removeEventListener('keydown', escape);
    };
  }, [guide?.runId, guide?.target, guide?.tourId, onClose]);

  if (!guide) return null;

  const viewportWidth = typeof window === 'undefined' ? 360 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 640 : window.innerHeight;
  const cardWidth = Math.min(344, Math.max(240, viewportWidth - 24));
  const cardHeight = 170;
  const left = rect
    ? Math.max(12, Math.min(rect.left, viewportWidth - cardWidth - 12))
    : Math.max(12, (viewportWidth - cardWidth) / 2);
  const top = rect
    ? (rect.bottom + cardHeight + 16 < viewportHeight
      ? rect.bottom + 12
      : Math.max(12, rect.top - cardHeight - 12))
    : Math.max(24, (viewportHeight - cardHeight) / 2);
  const tooltipBelow = !rect || top >= rect.bottom;

  return (
    <>
      {rect ? (
        <div aria-hidden="true" className="fixed z-[1000] animate-pulse rounded-lg border-[3px] border-emerald-400"
          style={{
            top: Math.max(2, rect.top - 4), left: Math.max(2, rect.left - 4),
            width: Math.max(20, rect.width + 8), height: Math.max(20, rect.height + 8),
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, .62)', pointerEvents: 'none'
          }} />
      ) : <div aria-hidden="true" className="fixed inset-0 z-[1000] bg-slate-900/55" />}
      <section role="dialog" aria-modal="false" aria-live="polite"
        className="fixed z-[1001] w-[min(344px,calc(100vw-24px))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
        style={{ top, left, pointerEvents: 'auto' }}>
        {rect ? <span aria-hidden="true"
          className={`absolute left-6 h-3 w-3 rotate-45 border-slate-200 bg-white ${tooltipBelow
            ? '-top-1.5 border-l border-t'
            : '-bottom-1.5 border-b border-r'}`} /> : null}
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-700"><Sparkles size={16} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-orange-600">Pandu Saya</p>
            <h2 className="mt-0.5 text-[13px] font-extrabold text-slate-800">{guide.title}</h2>
          </div>
          <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose} aria-label="Tutup panduan"><X size={15} /></button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-slate-600">{guide.description}</p>
        {rect ? (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-800">
            <MousePointerClick size={13} /> Klik tombol/kolom yang disorot untuk melanjutkan.
          </p>
        ) : (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800">
            {missing ? 'Tombol panduan tidak ditemukan. Periksa halaman dan hak akses Anda.' : 'Mencari tombol yang perlu digunakan…'}
          </p>
        )}
        <p className="mt-2 text-right text-[10px] text-slate-400">Tekan Esc atau Tutup untuk mengakhiri panduan.</p>
      </section>
    </>
  );
}
