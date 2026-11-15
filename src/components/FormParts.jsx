import React, { useEffect, useMemo, useState } from 'react';
import { Award, MapPin, Search, TriangleAlert, X } from 'lucide-react';
import { api, compressImage } from '../api';
import { cx } from '../ui';

/* =====================================================================
   LokasiField — dropdown lokasi dengan opsi "Lainnya"
   Memilih "Lainnya" langsung memunculkan input teks manual.
   ===================================================================== */
export function LokasiField({ label = 'Lokasi Temuan', value = '', onChange, list = [], hint, required }) {
  const opsi = useMemo(() => {
    const arr = (list || []).filter(Boolean);
    if (!arr.some(x => String(x).toLowerCase() === 'lainnya')) arr.push('Lainnya');
    return arr;
  }, [list]);
  const cocokDaftar = opsi.some(l => l.toLowerCase() !== 'lainnya' && l === value);
  const [manual, setManual] = useState(!cocokDaftar && !!value);
  const [pilih, setPilih] = useState(cocokDaftar ? value : (value ? 'Lainnya' : ''));

  useEffect(() => {
    const adaDiDaftar = opsi.some(l => l.toLowerCase() !== 'lainnya' && l === value);
    setPilih(adaDiDaftar ? value : (value ? 'Lainnya' : ''));
    setManual(!adaDiDaftar && !!value);
  }, [value, opsi.join('|')]);

  const ubahPilih = v => {
    setPilih(v);
    if (v === 'Lainnya') { setManual(true); onChange(''); }
    else { setManual(false); onChange(v); }
  };

  return (
    <div>
      <label className="label">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <div className="relative">
        <MapPin size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <select className="input !pl-9" value={pilih} data-lokasi-select="1"
          onChange={e => ubahPilih(e.target.value)} required={!!required}>
          <option value="">— pilih lokasi —</option>
          {opsi.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      {manual ? (
        <input className="input mt-2" data-lokasi-manual="1" autoFocus
          placeholder="Tulis lokasi kejadian (mis. belakang lab komputer)"
          value={value} onChange={e => onChange(e.target.value.slice(0, 80))} />
      ) : null}
      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

/* =====================================================================
   KategoriField — pencarian manual + dropdown responsif kategori poin
   Mendukung PILIHAN GANDA (beberapa kategori dalam satu kejadian),
   sama seperti pemilih siswa masal. Nilai = array id kategori.
   ===================================================================== */
export function KategoriField({
  label = 'Kategori Poin', value = [], onChange, kategori = [], jenis = 'pelanggaran',
  required, hint, multi = true
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = React.useRef(null);
  const terpilih = useMemo(() => (Array.isArray(value) ? value : (value ? [Number(value)] : [])), [value]);
  const semuaKat = useMemo(() => kategori.filter(k => k.aktif !== 0), [kategori]);
  /* daftar default mengikuti jenis yang dipilih, tetapi pencarian/penambahan
     boleh lintas jenis (mis. pelanggaran + prestasi dalam satu catatan). */
  const dasar = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const sameJenis = semuaKat.filter(k => k.jenis === jenis);
    if (!kw) return sameJenis.filter(k => !terpilih.includes(k.id));
    return semuaKat
      .filter(k => (k.nama + ' ' + (k.keterangan || '') + ' ' + k.jenis).toLowerCase().includes(kw))
      .filter(k => !terpilih.includes(k.id));
  }, [semuaKat, jenis, q, terpilih]);
  const hasil = useMemo(() => dasar.slice(0, 30), [dasar]);
  const dipilih = useMemo(() => terpilih.map(id => semuaKat.find(k => k.id === id)).filter(Boolean), [terpilih, semuaKat]);
  const totalPoin = dipilih.reduce((a, k) => a + (Number(k.poin) || 0), 0);

  const add = id => {
    const n = Number(id);
    if (!n || terpilih.includes(n)) return;
    onChange(multi ? [...terpilih, n] : [n]);
    setQ('');
    setOpen(false);
  };

  /* klik di luar area kategori menutup dropdown (agar chip & tombol simpan tak tertutup) */
  useEffect(() => {
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const remove = id => onChange(terpilih.filter(x => x !== id));

  return (
    <div data-kategori-field="1" data-kategori-multi={multi ? '1' : '0'} ref={boxRef}>
      <label className="label">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
        {multi && terpilih.length ? (
          <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10.5px] font-bold text-orange-700">
            {terpilih.length} kategori · {totalPoin} poin
          </span>
        ) : null}
      </label>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input !pl-9" data-kategori-search="1"
          placeholder={`Cari kategori (${semuaKat.length} tersedia) — boleh lebih dari satu`}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (hasil[0]) add(hasil[0].id); }
            if (e.key === 'Escape') setOpen(false);
          }} />
        {open ? (
          <div className="absolute z-30 mt-1 max-h-[240px] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl">
            <p className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
              {q.trim() ? `${hasil.length} kategori cocok` : `Kategori ${jenis} — klik untuk menambahkan`}
            </p>
            {hasil.length ? hasil.map(k => (
              <button key={k.id} type="button" data-kategori-pick={k.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => add(k.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-orange-50">
                {k.jenis === 'prestasi'
                  ? <Award size={13} className="shrink-0 text-violet-500" />
                  : <TriangleAlert size={13} className="shrink-0 text-rose-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-700">{k.nama}</span>
                  <span className="block truncate text-[10.5px] text-slate-400">{k.jenis} · {k.poin} poin</span>
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">+{k.poin}</span>
              </button>
            )) : <p className="px-2 py-2 text-[12px] text-slate-400">Tidak ada kategori yang cocok.</p>}
          </div>
        ) : null}
      </div>

      {multi ? (
        <>
          <select className="input mt-2" data-kategori-select="1" value=""
            onChange={e => { add(e.target.value); e.target.value = ''; }}>
            <option value="">— tambah kategori dari daftar ({hasil.length}) —</option>
            {hasil.map(k => <option key={k.id} value={k.id}>{k.nama} ({k.poin} poin){k.jenis !== jenis ? ` · ${k.jenis}` : ''}</option>)}
          </select>
          {dipilih.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5" data-kategori-chips="1">
              {dipilih.map(k => (
                <span key={k.id}
                  className={cx('inline-flex items-center gap-1 rounded-lg py-1 pl-2 pr-1 text-[11.5px] font-semibold ring-1',
                    k.jenis === 'prestasi' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-orange-50 text-orange-700 ring-orange-200')}>
                  {k.jenis === 'prestasi' ? <Award size={11} /> : <TriangleAlert size={11} />}
                  {k.nama} <span className="font-normal opacity-70">+{k.poin}</span>
                  <button type="button" onClick={() => remove(k.id)} className="ml-0.5 rounded p-0.5 hover:bg-white/70" aria-label="Hapus kategori">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-[11.5px] font-bold text-slate-600">
                Total {totalPoin} poin
              </span>
              <button type="button" onClick={() => onChange([])}
                className="rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">Bersihkan</button>
            </div>
          ) : null}
        </>
      ) : (
        <select className="input mt-2" data-kategori-select="1" value={terpilih[0] || ''}
          onChange={e => onChange(e.target.value ? [Number(e.target.value)] : [])} required={!!required}>
          <option value="">— pilih kategori ({hasil.length}) —</option>
          {hasil.map(k => <option key={k.id} value={k.id}>{k.nama} ({k.poin} poin)</option>)}
        </select>
      )}

      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
      {!dipilih.length && q && !hasil.length ? (
        <p className="mt-1 text-[11.5px] text-rose-500">Tidak ada kategori yang cocok dengan “{q}”.</p>
      ) : null}
    </div>
  );
}

/* =====================================================================
   PhotoField — unggah bukti foto (opsional) dengan kompresi otomatis
   ===================================================================== */
export function PhotoField({ value = '', onChange, settings = {}, label = 'Bukti Foto (opsional)' }) {
  const [uploading, setUploading] = useState(false);
  const ref = React.useRef(null);
  const maxKb = Number(settings.upload_max_kb) || 2048;
  async function pilih(file) {
    if (!file) return;
    setUploading(true);
    try {
      let payload = await compressImage(file, {
        maxKb,
        maxSide: Number(settings.upload_max_side) || 1600,
        quality: Number(settings.upload_jpeg_quality) || 0.82
      });
      if (!payload) {
        if (file.size > maxKb * 1024) throw new Error(`Ukuran berkas melebihi batas ${(maxKb / 1024).toFixed(1)} MB.`);
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
          fr.onerror = rej; fr.readAsDataURL(file);
        });
        payload = { base64: b64, filename: file.name };
      }
      const r = await api('/api/upload', { method: 'POST', body: { base64: payload.base64, filename: payload.filename, jenis: 'bukti' } });
      onChange(r.url);
    } catch (e) { window.alert(e.message); }
    finally { setUploading(false); }
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <label className={cx('btn-ghost flex-1 cursor-pointer', uploading && 'opacity-60')}>
          {uploading ? <span className="text-[11.5px]">mengunggah…</span> : (value ? 'Ganti Foto' : 'Pilih Foto')}
          <input ref={ref} type="file" accept="image/*" className="hidden" disabled={uploading}
            onChange={e => pilih(e.target.files?.[0])} />
        </label>
        {value ? (
          <button type="button" className="btn-danger btn-sm" onClick={() => { onChange(''); if (ref.current) ref.current.value = ''; }}>Hapus</button>
        ) : null}
      </div>
      {value ? <img src={value} alt="Bukti" className="mt-2 h-24 w-full rounded-xl object-cover ring-1 ring-slate-200" /> : null}
    </div>
  );
}

/* =====================================================================
   JenisField — tombol pilihan Pelanggaran / Prestasi (bukan dropdown)
   ===================================================================== */
export function JenisField({ value = 'pelanggaran', onChange, label = 'Jenis Temuan', required }) {
  const opsi = [
    { key: 'pelanggaran', label: 'Pelanggaran', Icon: TriangleAlert, on: 'border-rose-300 bg-rose-50 text-rose-700' },
    { key: 'prestasi', label: 'Prestasi', Icon: Award, on: 'border-violet-300 bg-violet-50 text-violet-700' }
  ];
  return (
    <div data-jenis-field="1">
      <label className="label">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {opsi.map(({ key, label: l, Icon, on }) => (
          <button key={key} type="button" data-jenis-opt={key}
            onClick={() => onChange(key)}
            className={cx('flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-bold transition',
              value === key ? on : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300')}>
            <Icon size={14} /> {l}
          </button>
        ))}
      </div>
    </div>
  );
}
