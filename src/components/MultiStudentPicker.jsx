import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, GraduationCap, Search, UserPlus, X } from 'lucide-react';
import { api } from '../api';
import { cx } from '../ui';

/* =====================================================================
   Pemilih SISWA MULTI (masal)
   - Mengetik ≥3 huruf memunculkan dropdown nama yang sesuai
   - Klik satu baris = menambahkan siswa ke daftar terpilih (bisa banyak)
   - Daftar terpilih tampil sebagai chip di bawah kotak pencarian
   ===================================================================== */
export default function MultiStudentPicker({
  label = 'Nama Siswa', hint, required, value = [], onChange, all = false, max = 60, disabled = false
}) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);
  const boxRef = useRef(null);
  const terpilih = Array.isArray(value) ? value : [];

  /* daftar lengkap (untuk menampilkan nama chip & pencarian lokal) */
  useEffect(() => {
    if (loadedAll) return;
    api('/api/siswa-options?limit=1000' + (all ? '&all=1' : ''))
      .then(r => { setList(r.rows || []); setLoadedAll(true); })
      .catch(() => {});
  }, [all, loadedAll]);

  /* pencarian dari server (debounce) */
  useEffect(() => {
    const kw = q.trim();
    if (kw.length < 3) return;
    const t = setTimeout(() => {
      setBusy(true);
      api('/api/siswa-options?q=' + encodeURIComponent(kw) + (all ? '&all=1' : ''))
        .then(r => setList(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          for (const s of (r.rows || [])) map.set(s.id, s);
          return [...map.values()];
        }))
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 280);
    return () => clearTimeout(t);
  }, [q, all]);

  useEffect(() => {
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const namaOf = id => (list.find(s => s.id === Number(id)) || {}).nama || ('#' + id);
  const kelasOf = id => (list.find(s => s.id === Number(id)) || {}).kelas_nama || '';

  const hasil = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const dasar = kw.length >= 3
      ? list.filter(s => (s.nama + ' ' + (s.nis || '') + ' ' + (s.nisn || '') + ' ' + (s.kelas_nama || '')).toLowerCase().includes(kw))
      : list;
    return dasar.filter(s => !terpilih.includes(s.id)).slice(0, 40);
  }, [list, q, terpilih]);

  const add = id => {
    if (terpilih.includes(id) || terpilih.length >= max) return;
    onChange([...terpilih, id]);
    setQ('');
  };
  const remove = id => onChange(terpilih.filter(x => x !== id));

  return (
    <div data-multi-picker="1" data-student-picker-wrap="1">
      {label ? (
        <label className="label">
          {label}{required ? <span className="text-rose-500"> *</span> : null}
          {terpilih.length ? <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10.5px] font-bold text-orange-700">{terpilih.length} dipilih</span> : null}
        </label>
      ) : null}

      <div ref={boxRef} className="relative">
        <div className={cx('flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100', disabled && 'opacity-60')}>
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            className="w-full border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-slate-400"
            placeholder={all ? 'Ketik nama / NIS siswa (boleh lebih dari satu)…' : 'Ketik nama / NIS siswa kelas Anda…'}
            value={q} disabled={disabled}
            data-multi-input="1" data-student-picker="1"
            onFocus={() => setOpen(true)}
            onChange={e => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (hasil[0]) add(hasil[0].id); }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {busy ? <span className="text-[10.5px] text-slate-400">mencari…</span> : null}
        </div>

        {open && !disabled ? (
          <div className="absolute z-30 mt-1 max-h-[260px] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl">
            <p className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
              {q.trim().length >= 3 ? `${hasil.length} siswa cocok` : 'Pilih siswa (boleh beberapa)'}
            </p>
            {hasil.length ? hasil.map(s => (
              <button key={s.id} type="button" data-pick={s.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => add(s.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-orange-50">
                <GraduationCap size={14} className="shrink-0 text-orange-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-700">{s.nama}</span>
                  <span className="block truncate text-[10.5px] text-slate-400">{s.kelas_nama || '-'} · NIS {s.nis || '-'}</span>
                </span>
                <UserPlus size={13} className="shrink-0 text-slate-300" />
              </button>
            )) : <p className="px-2 py-2 text-[12px] text-slate-400">Tidak ada siswa yang cocok.</p>}
          </div>
        ) : null}
      </div>

      {terpilih.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-chip-list="1">
          {terpilih.map(id => (
            <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-orange-50 py-1 pl-2 pr-1 text-[11.5px] font-semibold text-orange-700 ring-1 ring-orange-200">
              <Check size={11} /> {namaOf(id)}
              {kelasOf(id) ? <span className="font-normal text-orange-500">· {kelasOf(id)}</span> : null}
              <button type="button" onClick={() => remove(id)} className="ml-0.5 rounded p-0.5 hover:bg-orange-200/70" aria-label="Hapus">
                <X size={11} />
              </button>
            </span>
          ))}
          {terpilih.length > 1 ? (
            <button type="button" onClick={() => onChange([])} className="rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">
              Bersihkan semua
            </button>
          ) : null}
        </div>
      ) : null}

      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
