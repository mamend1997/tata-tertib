import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { api } from '../api';
import { cx } from '../ui';

/**
 * Pemilih siswa dengan pencarian instan (autocomplete).
 * — daftar siswa diambil sekali (maks 600) saat komponen dipakai;
 * — mengetik ≥ `minChars` karakter langsung menyaring hasil di layar
 *   (tanpa menunggu server), dan sekaligus meminta hasil dari server
 *   agar siswa di luar 600 pertama tetap dapat ditemukan;
 * — dropdown muncul otomatis dan bisa dipilih dengan mouse/panah + Enter.
 */
export default function StudentPicker({
  value, onChange, placeholder = 'Cari nama siswa (min. 3 huruf)…',
  hint, required, minChars = 3, disabled, autoFocus, className, label = 'Pilih Siswa'
}) {
  const [all, setAll] = useState([]);
  const [extra, setExtra] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    api('/api/siswa-options?limit=800').then(r => setAll(r.rows || [])).catch(() => setAll([]));
  }, []);

  const selected = useMemo(
    () => all.find(s => s.id === Number(value)) || extra.find(s => s.id === Number(value)) || null,
    [all, extra, value]
  );

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    const pool = [...extra, ...all];
    const seen = new Set();
    const list = pool.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    if (term.length < minChars) return list.slice(0, 8);
    return list.filter(s =>
      String(s.nama || '').toLowerCase().includes(term)
      || String(s.nis || '').toLowerCase().includes(term)
      || String(s.nisn || '').toLowerCase().includes(term)
      || String(s.kelas_nama || '').toLowerCase().includes(term)
    ).slice(0, 30);
  }, [all, extra, term, minChars]);

  // permintaan ke server (untuk siswa di luar daftar awal) — debounce 300 ms
  useEffect(() => {
    if (term.length < minChars) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api('/api/siswa-options?q=' + encodeURIComponent(term) + '&limit=40');
        setExtra(r.rows || []);
      } catch (e) { /* abaikan, hasil lokal tetap dipakai */ }
      finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [term, minChars]);

  useEffect(() => {
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => { setActive(0); }, [term]);

  function pick(s) {
    onChange(String(s.id), s);
    setQ('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      if (open && results[active]) { e.preventDefault(); pick(results[active]); }
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  const showHintOnly = term.length > 0 && term.length < minChars;

  return (
    <div className={className} ref={boxRef}>
      {label ? (
        <label className="label">
          {label}{required ? <span className="text-rose-500"> *</span> : null}
        </label>
      ) : null}
      {selected ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-slate-800">{selected.nama}</p>
            <p className="text-[11px] text-slate-500">
              Kelas {selected.kelas_nama || '-'} · NIS {selected.nis || selected.nisn || '-'}
            </p>
          </div>
          <button type="button" onClick={() => { onChange('', null); setOpen(false); }}
            className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-500" title="Hapus pilihan">
            <X size={14} />
          </button>
        </div>
      ) : null}
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          data-student-picker="1"
          className="input pl-9" value={q} disabled={disabled} autoFocus={autoFocus}
          placeholder={selected ? 'Cari siswa lain…' : placeholder}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-autocomplete="list" aria-expanded={open}
        />
        {busy ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-orange-500" /> : null}
        {open ? (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            {showHintOnly ? (
              <p className="px-3 py-2.5 text-[12px] text-slate-500">
                Ketik minimal <b>{minChars}</b> huruf untuk mencari nama siswa.
              </p>
            ) : results.length ? (
              results.map((s, i) => (
                <button key={s.id} type="button" data-pick={s.id} data-nama={s.nama} onMouseEnter={() => setActive(i)} onClick={() => pick(s)}
                  className={cx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition',
                    i === active ? 'bg-orange-50' : 'hover:bg-slate-50')}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-700">{s.nama}</span>
                    <span className="block text-[11px] text-slate-400">NIS {s.nis || s.nisn || '-'}</span>
                  </span>
                  <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-600">{s.kelas_nama || '-'}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2.5 text-[12px] text-slate-500">Tidak ada siswa yang cocok.</p>
            )}
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-[11.5px] text-slate-400">
        {hint || (selected ? `Kelas: ${selected.kelas_nama || '-'} · NIS ${selected.nis || '-'}` : 'Ketik nama/NIS/kelas lalu pilih dari daftar.')}
      </p>
    </div>
  );
}
