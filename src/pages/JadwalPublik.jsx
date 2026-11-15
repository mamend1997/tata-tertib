import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarRange, FileSpreadsheet, Printer, Search, ShieldCheck, UserRound } from 'lucide-react';
import { api, docUrl, openDoc } from '../api';
import { Spinner } from '../ui';
import { applyTheme } from '../theme';
import { HARI_NAMA, sesiUntuk, labelSesi } from '../jadwalSesi';
import { KartuSlot, KartuKosong, KartuIstirahat, KepalaHari } from '../components/JadwalKartu';

/* =====================================================================
   Halaman publik rekap jadwal pelajaran (tanpa login).
   Alamat: /jadwal-publik/<token> · filter kelas, guru, dan pencarian.

   Tampilan memakai MATRIKS KARTU SLOT yang sama dengan menu pengelolaan
   jadwal (kolom = hari, kartu = jam pelajaran) sehingga siswa/tamu melihat
   bentuk yang identik dengan layar admin — termasuk sesi khusus per hari
   (Senin "Upacara", Jumat "Pembiasaan") dan tinggi kartu proporsional
   mengikuti durasi sesi.
   ===================================================================== */
export default function JadwalPublik({ token }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ kelas: '', guru: '', q: '' });
  const [q, setQ] = useState('');

  useEffect(() => {
    document.body.classList.add('app-bg');
    return () => document.body.classList.remove('app-bg');
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setGalat('');
    const qs = new URLSearchParams();
    if (filter.kelas) qs.set('kelas', filter.kelas);
    if (filter.guru) qs.set('guru', filter.guru);
    if (filter.q) qs.set('q', filter.q);
    api('/api/public/jadwal/' + encodeURIComponent(token) + (qs.toString() ? '?' + qs : ''))
      .then(r => {
        if (!alive) return;
        setData(r);
        applyTheme({});
        document.title = `Jadwal Pelajaran · ${r.sekolah?.nama || ''}`;
      })
      .catch(e => { if (alive) setGalat(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, filter]);

  /* tautan ekspor & cetak mengikuti filter aktif + mode tampilan */
  const qsEkspor = () => {
    const p = new URLSearchParams();
    if (filter.kelas) p.set('kelas', filter.kelas);
    if (filter.guru) p.set('guru', filter.guru);
    if (filter.guru) p.set('mode', 'guru');
    const s = p.toString();
    return s ? '?' + s : '';
  };

  const cfg = data?.config || {};
  const rows = data?.rows || [];
  const kelas = data?.kelas || [];
  const guruList = data?.guru || [];
  const hariAktif = (cfg.hari || []).map(Number);

  /* peta slot: `hari|sesi|kelas` → baris jadwal (pencarian O(1)) */
  const peta = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      for (const k of (r.kelas_ids || [])) map.set(`${r.hari}|${r.sesi}|${k}`, r);
    }
    return map;
  }, [rows]);

  const daftarKelas = (filter.kelas ? kelas.filter(k => String(k.id) === String(filter.kelas)) : kelas)
    .filter(k => !filter.guru || rows.some(r => (r.kelas_ids || []).includes(Number(k.id))));

  if (galat) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-[440px] p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600"><AlertTriangle size={26} /></div>
          <h1 className="mt-3 text-[17px] font-extrabold text-slate-800">Tautan jadwal tidak aktif</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{galat}</p>
          <a href={(window.__BASE__ || '') + '/'} className="btn-ghost mt-4 w-full justify-center"><ArrowLeft size={15} /> Kembali</a>
        </div>
      </div>
    );
  }

  const guruNama = (filter.guru && (guruList.find(g => String(g.id) === String(filter.guru)) || {}).nama) || '';

  /* ---------- MATRIKS KARTU SLOT SATU KELAS ---------- */
  const matriksKelas = (k) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-card"
      data-jadwal-publik={k.id} data-grid-publik="">
      <div className="flex min-w-full items-start gap-2">
        {hariAktif.map(h => {
          const daftar = sesiUntuk(cfg, h);
          const khusus = !!(cfg.sesi_hari && (cfg.sesi_hari[h] || cfg.sesi_hari[String(h)]));
          const jamPelajaran = daftar.filter(s => !s.istirahat).length;
          return (
            <div key={h} className="min-w-[186px] flex-1" data-hari={h}>
              <KepalaHari nama={HARI_NAMA[h]} khusus={khusus}
                jumlahJam={jamPelajaran} jumlahSesi={daftar.length} />
              <div className="space-y-1">
                {daftar.map(s => {
                  if (s.istirahat) return <KartuIstirahat key={s.idx} sesi={s} />;
                  const row = peta.get(`${h}|${s.idx}|${Number(k.id)}`);
                  return (
                    <div key={s.idx} className="rounded-lg p-0.5" data-sesi-cell={`${h}-${s.idx}`}>
                      {row
                        ? <KartuSlot row={row} sesi={s} showClass={false} dataAttr={{ 'data-slot': row.id, 'data-slot-sesi': s.idx }} />
                        : <KartuKosong sesi={s} />}
                    </div>
                  );
                })}
                {!daftar.length ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-2 py-6 text-center text-[11px] text-slate-400">
                    Tidak ada sesi pada hari ini.
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-12">
      <header className="text-white" style={{ background: 'linear-gradient(120deg, var(--primary-700) 0%, var(--primary) 55%, #f59e0b 100%)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5">
          {data?.sekolah?.logo ? (
            <img src={data.sekolah.logo} alt="" width="38" height="38" className="h-10 w-10 rounded-xl bg-white/95 object-contain p-1" />
          ) : <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30"><ShieldCheck size={20} /></div>}
          <div className="min-w-0">
            <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/80">{data?.sekolah?.nama}</p>
            <h1 className="truncate text-[15px] font-extrabold uppercase leading-tight sm:text-[17px]">Jadwal Pelajaran</h1>
          </div>
          <span className="ml-auto hidden rounded-xl bg-white/15 px-3 py-2 text-[11.5px] font-semibold ring-1 ring-white/25 sm:block">
            {data?.ta_nama ? `TP ${data.ta_nama}` : ''}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-3 px-4 py-4">
        <div className="card p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="min-w-0">
              <span className="label">Filter Kelas</span>
              <select className="input" value={filter.kelas} onChange={e => setFilter(f => ({ ...f, kelas: e.target.value }))} data-filter-kelas>
                <option value="">Semua kelas</option>
                {kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="label">Filter Guru</span>
              <select className="input" value={filter.guru} onChange={e => setFilter(f => ({ ...f, guru: e.target.value }))} data-filter-guru>
                <option value="">Semua guru</option>
                {guruList.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
            </label>
            <form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); setFilter(f => ({ ...f, q })); }}>
              <label className="min-w-0 flex-1">
                <span className="label">Cari</span>
                <input className="input" value={q} placeholder="mapel / guru / kelas" onChange={e => setQ(e.target.value)} data-cari-jadwal />
              </label>
              <button className="btn-primary" type="submit"><Search size={14} /></button>
            </form>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
            <span className="chip"><CalendarRange size={12} /> {rows.length} slot ditampilkan</span>
            {guruNama ? <span className="chip"><UserRound size={12} /> {guruNama}</span> : null}
            {filter.kelas || filter.guru || filter.q ? (
              <button className="text-[11.5px] font-semibold text-orange-600 hover:underline"
                onClick={() => { setFilter({ kelas: '', guru: '', q: '' }); setQ(''); }}>Reset filter</button>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-1.5">
              <a className="btn-ghost btn-sm"
                href={docUrl('/api/public/jadwal/' + encodeURIComponent(token) + '/export.xlsx' + qsEkspor())}
                data-publik-export>
                <FileSpreadsheet size={13} /> Export Excel
              </a>
              <button className="btn-soft btn-sm"
                onClick={() => openDoc('/api/public/jadwal/' + encodeURIComponent(token) + '/cetak' + qsEkspor())}
                data-publik-cetak>
                <Printer size={13} /> Cetak / Simpan PDF
              </button>
            </div>
          </div>
        </div>

        {loading && !data ? <div className="card"><Spinner label="Memuat jadwal…" /></div>
          : !rows.length || !daftarKelas.length ? (
            <div className="card p-8 text-center text-[13px] text-slate-500">Belum ada jadwal yang cocok dengan filter ini.</div>
          ) : daftarKelas.map(k => (
            <div key={k.id} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-orange-50/60 px-3 py-2">
                <p className="text-[13px] font-extrabold text-slate-800">{k.nama}</p>
                <span className="text-[11px] text-slate-500">
                  {hariAktif.length} hari · {sesiUntuk(cfg, hariAktif[0]).filter(s => !s.istirahat).length} jam
                </span>
              </div>
              <div className="p-1.5 sm:p-2">{matriksKelas(k)}</div>
            </div>
          ))}
        <p className="pt-1 text-center text-[11px] text-slate-400">
          Jadwal publik · {data?.sekolah?.nama} — hubungi Wakasek Kurikulum bila ada jadwal yang perlu diperbaiki.
        </p>
      </main>
    </div>
  );
}
