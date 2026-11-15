import React, { useEffect, useMemo, useState } from 'react';
import {
  Award, CalendarDays, ChevronLeft, ChevronRight, Loader2, TriangleAlert
} from 'lucide-react';
import { api, tgl, tglPendek, waktu } from '../api';
import { Card, Empty, Spinner, StatusBadge, cx, useToast } from '../ui';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const pad = n => String(n).padStart(2, '0');
const bulanIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export default function Kalender({ ctx }) {
  const { filters, refreshKey, boot } = ctx;
  const toast = useToast();
  const [bulan, setBulan] = useState(bulanIni());
  const [kelas, setKelas] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pilih, setPilih] = useState('');

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({
      ta: filters.ta || '', bulan, kelas: kelas || ''
    }).toString();
    api('/api/kalender?' + q).then(r => { setData(r); setPilih(''); })
      .catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [filters.ta, bulan, kelas, refreshKey]);

  const grid = useMemo(() => {
    if (!data) return [];
    const [y, m] = data.bulan.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startIdx = (first.getDay() + 6) % 7; // Senin = 0
    const total = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startIdx; i++) cells.push(null);
    for (let d = 1; d <= total; d++) {
      const key = `${y}-${pad(m)}-${pad(d)}`;
      cells.push({ key, d, day: data.days[key] || null });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [data]);

  const maxPel = data?.maxPel || 0;
  const selected = pilih && data?.days[pilih] ? data.days[pilih] : null;

  function geser(delta) {
    const [y, m] = bulan.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setBulan(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }

  const tone = (day) => {
    if (!day) return '';
    const p = day.pel;
    if (!p) return 'day-pres';
    const rasio = maxPel ? p / maxPel : 0;
    if (rasio > 0.75) return 'day-pel-4';
    if (rasio > 0.5) return 'day-pel-3';
    if (rasio > 0.25) return 'day-pel-2';
    return 'day-pel-1';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Kalender Kedisiplinan</h2>
          <p className="text-[12.5px] text-slate-500">
            Peta kejadian pelanggaran & prestasi per hari. Klik tanggal untuk melihat rincian kejadian.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !w-auto !py-1.5 text-[12px]" value={kelas} onChange={e => setKelas(e.target.value)}>
            <option value="">Semua kelas</option>
            {(data?.kelas || []).map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            <button onClick={() => geser(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Bulan sebelumnya"><ChevronLeft size={15} /></button>
            <span className="min-w-[130px] text-center text-[12.5px] font-bold text-slate-700">
              {(() => { const [y, m] = bulan.split('-').map(Number); return `${BULAN[m - 1]} ${y}`; })()}
            </span>
            <button onClick={() => geser(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Bulan berikutnya"><ChevronRight size={15} /></button>
          </div>
          <input type="month" className="input !w-auto !py-1.5 text-[12px]" value={bulan} onChange={e => setBulan(e.target.value || bulanIni())} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Hari Ada Kejadian" value={data?.ringkas?.hari ?? 0} icon={CalendarDays} tone="sky" />
        <Kpi label="Pelanggaran" value={data?.ringkas?.pelanggaran ?? 0} icon={TriangleAlert} tone="rose" />
        <Kpi label="Prestasi" value={data?.ringkas?.prestasi ?? 0} icon={Award} tone="violet" />
        <Kpi label="Total Poin Pelanggaran" value={data?.ringkas?.poin ?? 0} icon={TriangleAlert} tone="orange" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card title="Kalender Bulanan" subtitle="Warna makin pekat = makin banyak pelanggaran"
          right={loading ? <Loader2 size={14} className="animate-spin text-slate-400" /> : null}>
          <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
            {HARI.map(h => <div key={h} className="py-1">{h.slice(0, 3)}</div>)}
          </div>
          <div className="cal-grid mt-1 grid grid-cols-7 gap-1">
            {grid.map((c, i) => c === null ? <div key={'x' + i} /> : (
              <button key={c.key} data-day={c.key} onClick={() => setPilih(c.key)}
                className={cx('relative flex min-h-[62px] flex-col items-start rounded-xl border p-1.5 text-left transition',
                  pilih === c.key ? 'border-orange-400 ring-2 ring-orange-200' : 'border-slate-100 hover:border-orange-200',
                  c.day ? tone(c.day) : 'bg-white')}>
                <span className={cx('text-[12px] font-bold', c.day ? 'text-slate-800' : 'text-slate-400')}>{c.d}</span>
                {c.day ? (
                  <span className="mt-0.5 flex flex-wrap gap-1 leading-none">
                    {c.day.pel ? <span className="rounded-md bg-rose-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">{c.day.pel} pel</span> : null}
                    {c.day.pres ? <span className="rounded-md bg-violet-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">{c.day.pres} pres</span> : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
            <span>Intensitas:</span>
            {['day-pel-1', 'day-pel-2', 'day-pel-3', 'day-pel-4'].map((t, i) => <span key={t} className={cx('h-3 w-6 rounded', t)} title={`Tingkat ${i + 1}`} />)}
            <span className="ml-2 flex items-center gap-1"><span className="h-3 w-6 rounded day-pres" /> Prestasi</span>
          </div>
        </Card>

        <Card title={selected ? `Kejadian ${tgl(selected.tanggal, { long: true })}` : 'Rincian Harian'}
          subtitle={selected ? `${selected.jml} kejadian · ${selected.pel} pelanggaran · ${selected.pres} prestasi` : 'Klik salah satu tanggal pada kalender'}>
          {loading ? <Spinner /> : selected ? (
            selected.items.length ? (
              <ul className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {selected.items.map(it => (
                  <li key={it.id} className="rounded-xl border border-slate-100 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-bold text-slate-800">{it.siswa_nama}</p>
                        <p className="text-[11px] text-slate-500">
                          {it.kelas_nama || '-'} · {it.judul}
                        </p>
                        <p className="text-[10.5px] text-slate-400">
                          {it.jam ? `${it.jam} · ` : ''}{it.lokasi || 'lokasi tidak dicatat'}
                        </p>
                      </div>
                      <span className={cx('shrink-0 badge', it.jenis === 'prestasi' ? 'badge-prestasi' : 'badge-siaga')}>
                        {it.jenis === 'prestasi' ? '+' : '−'}{it.poin}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={CalendarDays} title="Tidak ada kejadian" />
          ) : (
            <div className="space-y-2">
              <Empty icon={CalendarDays} title="Belum ada tanggal dipilih" desc="Klik tanggal pada kalender untuk melihat detail kejadian hari itu." />
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
                Periode: {boot.settings.portal_aktif ? 'sesuai tahun pelajaran aktif' : '-'}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }) {
  const tones = {
    sky: 'from-sky-500 to-cyan-500', rose: 'from-rose-500 to-orange-500',
    violet: 'from-violet-500 to-fuchsia-500', orange: 'from-orange-500 to-amber-500'
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', tones[tone])}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-[19px] font-extrabold leading-tight text-slate-800">{value}</p>
      </div>
    </div>
  );
}
