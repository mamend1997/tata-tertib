import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, UserRound, X } from 'lucide-react';
import { api } from '../api';
import { cx } from '../ui';

/* =====================================================================
   SiswaAutocomplete — pencarian nama siswa untuk halaman PUBLIK
   (aduan kekerasan & asesmen BK).
   - Mulai mencari setelah pengguna mengetik MINIMAL 3 huruf
   - Daftar muncul real-time (debounce 250 ms) dan bisa diklik
   - Setelah dipilih, kelas otomatis diketahui dari data sekolah
   ===================================================================== */
export default function SiswaAutocomplete({
  endpoint, value, onPick, label = 'Nama Lengkap', hint, placeholder = 'Ketik minimal 3 huruf nama Anda…',
  disabled = false, required = true
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aktif, setAktif] = useState(-1);
  const boxRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    const kw = q.trim();
    if (kw.length < 3) { setRows([]); setBusy(false); return; }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      api(endpoint(kw))
        .then(r => { if (my === seq.current) { setRows(r.rows || []); setOpen(true); setAktif(-1); } })
        .catch(() => { if (my === seq.current) setRows([]); })
        .finally(() => { if (my === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, endpoint]);

  useEffect(() => {
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const hasil = useMemo(() => rows.slice(0, 12), [rows]);

  function pilih(s) {
    onPick(s);
    setQ('');
    setRows([]);
    setOpen(false);
    setAktif(-1);
  }

  if (value) {
    return (
      <div data-siswa-terpilih={value.id}>
        <label className="label">{label}{required ? <span className="text-rose-500"> *</span> : null}</label>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2">
          <Check size={15} className="shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-emerald-900">{value.nama}</p>
            <p className="text-[11px] text-emerald-700">{value.kelas_nama || 'kelas belum diisi'}</p>
          </div>
          {!disabled ? (
            <button type="button" className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100" onClick={() => onPick(null)} aria-label="Ganti siswa">
              <X size={14} />
            </button>
          ) : null}
        </div>
        {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative" data-siswa-autocomplete="1">
      <label className="label">{label}{required ? <span className="text-rose-500"> *</span> : null}</label>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input !pl-9"
          value={q}
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          onFocus={() => { if (hasil.length) setOpen(true); }}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={e => {
            if (!open || !hasil.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setAktif(i => Math.min(hasil.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAktif(i => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              const s = hasil[aktif >= 0 ? aktif : 0];
              if (s) pilih(s);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          data-nama-autocomplete={1}
          data-input-nama-siswa={1}
        />
        {busy ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" /> : null}
      </div>
      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
      {open && q.trim().length >= 3 ? (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {!hasil.length ? (
            <p className="px-3 py-2.5 text-[12px] text-slate-500">
              {busy ? 'Mencari…' : 'Nama tidak ditemukan. Periksa ejaan atau hubungi Guru BK.'}
            </p>
          ) : (
            hasil.map((s, i) => (
              <button
                key={s.id}
                type="button"
                data-pick={s.id}
                onMouseEnter={() => setAktif(i)}
                onClick={() => pilih(s)}
                className={cx('flex w-full items-center gap-2 px-3 py-2 text-left transition',
                  i === aktif ? 'bg-orange-50' : 'hover:bg-slate-50')}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><UserRound size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-800">{s.nama}</span>
                  <span className="block truncate text-[11px] text-slate-500">{s.kelas_nama || '-'}</span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
