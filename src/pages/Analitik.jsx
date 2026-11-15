import React, { useEffect, useState } from 'react';
import {
  BarChart3, Clock, MapPin, CalendarDays, Loader2, ShieldAlert, TriangleAlert, Gavel, Info
} from 'lucide-react';
import { api, angka } from '../api';
import { Alert, Card, Empty, Spinner, cx, useToast } from '../ui';

export default function Analitik({ ctx }) {
  const { filters, refreshKey, boot } = ctx;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState({ from: '', to: '' });

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({
      ta: filters.ta || '', from: range.from, to: range.to
    }).toString();
    api('/api/analitik?' + q).then(setData).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [filters.ta, range.from, range.to, refreshKey]);

  if (loading && !data) return <Spinner label="Mengolah pola pelanggaran…" />;
  const pola = data?.pola || { byDay: [], byHour: [], byLokasi: [], perKategori: [], total: 0 };
  const maxDay = Math.max(1, ...pola.byDay.map(d => d.jml));
  const maxHour = Math.max(1, ...pola.byHour.map(d => d.jml));
  const maxLokasi = Math.max(1, ...pola.byLokasi.map(d => d.jml));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Analitik Pola &amp; Tren Pelanggaran</h2>
          <p className="text-[12.5px] text-slate-500">
            Olahan otomatis data pelanggaran: hari paling rawan, jam rawan, dan lokasi yang paling sering terjadi.
            Gunakan untuk menyusun jadwal piket &amp; kebijakan pencegahan.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dari
            <input type="date" className="input mt-1 !w-auto !py-1.5 text-[12px]" value={range.from}
              onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sampai
            <input type="date" className="input mt-1 !w-auto !py-1.5 text-[12px]" value={range.to}
              onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          </label>
          <span className="chip"><BarChart3 size={12} /> {angka(pola.total)} kejadian pelanggaran</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Insight icon={CalendarDays} title="Hari Paling Rawan" tone="orange"
          value={pola.hariRawan?.[0] ? pola.hariRawan[0].label : '-'}
          detail={pola.hariRawan?.map(d => `${d.label} ${d.jml}×`).join(' · ') || 'Belum ada data'} />
        <Insight icon={Clock} title="Jam Paling Rawan" tone="rose"
          value={pola.jamRawan?.[0] ? `${String(pola.jamRawan[0].hour).padStart(2, '0')}:00` : '-'}
          detail={pola.jamRawan?.map(d => `${String(d.hour).padStart(2, '0')}:00 ${d.jml}×`).join(' · ') || 'Belum ada data'} />
        <Insight icon={MapPin} title="Lokasi Paling Rawan" tone="sky"
          value={pola.lokasiRawan?.[0] ? pola.lokasiRawan[0].label : '-'}
          detail={pola.lokasiRawan?.map(d => `${d.label} ${d.jml}×`).join(' · ') || 'Belum ada data'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Distribusi per Hari" subtitle="Jumlah kejadian pelanggaran tiap hari dalam sepekan">
          {pola.byDay.some(d => d.jml) ? (
            <div className="flex h-[190px] items-end gap-2">
              {pola.byDay.map(d => (
                <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10.5px] font-bold text-slate-500">{d.jml || ''}</span>
                  <div className="w-full rounded-t-md bg-gradient-to-t from-orange-600 to-amber-400 transition-all"
                    style={{ height: Math.max(3, (d.jml / maxDay) * 140) + 'px' }}
                    title={`${d.label}: ${d.jml} kejadian, ${d.poin} poin`} />
                  <span className="text-[10.5px] font-semibold text-slate-500">{d.label.slice(0, 3)}</span>
                </div>
              ))}
            </div>
          ) : <Empty icon={CalendarDays} title="Belum ada data" />}
        </Card>

        <Card title="Distribusi per Jam" subtitle="Jam 06.00–18.00 — menunjukkan waktu rawan kejadian">
          {pola.byHour.some(d => d.jml) ? (
            <div className="flex h-[190px] items-end gap-1">
              {pola.byHour.map(d => (
                <div key={d.hour} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t-sm bg-gradient-to-t from-rose-600 to-orange-400"
                    style={{ height: Math.max(3, (d.jml / maxHour) * 150) + 'px' }}
                    title={`${String(d.hour).padStart(2, '0')}:00 — ${d.jml} kejadian`} />
                  <span className="text-[9px] font-semibold text-slate-400">{String(d.hour).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
          ) : <Empty icon={Clock} title="Belum ada data jam" desc="Isi jam pada form input kejadian / buku penghubung." />}
        </Card>

        <Card title="Distribusi per Lokasi" subtitle="Lokasi diambil dari field lokasi input kejadian & buku penghubung">
          {pola.byLokasi.length ? (
            <div className="space-y-2">
              {pola.byLokasi.map(l => (
                <div key={l.label}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-slate-600">{l.label}</span>
                    <span className="font-bold text-slate-700">{l.jml}× · {l.poin} poin</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400"
                      style={{ width: Math.max(2, (l.jml / maxLokasi) * 100) + '%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty icon={MapPin} title="Belum ada data lokasi" />}
        </Card>

        <Card title="Kategori Pelanggaran Terbanyak" subtitle="Bentuk pelanggaran yang paling sering muncul">
          {pola.perKategori.length ? (
            <div className="tbl-wrap max-h-[240px]">
              <table className="tbl">
                <thead><tr><th>Kategori</th><th className="w-16 text-center">Jumlah</th><th className="w-16 text-center">Poin</th></tr></thead>
                <tbody>
                  {pola.perKategori.map(k => (
                    <tr key={k.label}>
                      <td className="font-medium text-slate-700">{k.label}</td>
                      <td className="text-center font-bold">{k.jml}×</td>
                      <td className="text-center text-rose-600">{k.poin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={TriangleAlert} title="Belum ada data" />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Rekomendasi Sanksi Otomatis" subtitle="Diatur Administrator di Pengaturan → Lokasi & Sanksi">
          <div className="space-y-2">
            {(data?.sanksi_rules || []).map(r => {
              const jumlah = (data?.sanksiRekap || []).find(x => x.label === r.label);
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-slate-700">{r.label}</p>
                    <p className="text-[11px] text-slate-500">≥ {r.min} poin{r.catatan ? ' · ' + r.catatan : ''}</p>
                  </div>
                  <span className="shrink-0 badge badge-netral">{jumlah ? jumlah.jumlah : 0} siswa</span>
                </div>
              );
            })}
            {!data?.sanksi_rules?.length ? <Empty icon={Gavel} title="Belum ada aturan sanksi" /> : null}
          </div>
        </Card>

        <Card title="Sebaran Status Disiplin" subtitle="Kontribusi tiap kelas terhadap poin pelanggaran">
          <div className="grid gap-2 sm:grid-cols-2">
            {(data?.statusDist || []).map(s => (
              <div key={s.label} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <span className="text-[12.5px] font-semibold text-slate-600">{s.label}</span>
                <span className="text-[13px] font-extrabold text-slate-800">{s.jumlah}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 tbl-wrap max-h-[220px]">
            <table className="tbl">
              <thead><tr><th>Kelas</th><th className="w-20 text-center">Siswa</th><th className="w-20 text-center">Poin Pel.</th></tr></thead>
              <tbody>
                {(data?.perKelas || []).map(k => (
                  <tr key={k.id}><td className="font-semibold">{k.nama}</td>
                    <td className="text-center">{k.jumlah}</td>
                    <td className="text-center font-bold text-rose-600">{k.pel}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {pola.tanpaJam || pola.tanpaLokasi ? (
        <Alert tone="info" title="Lengkapi data untuk analitik lebih akurat">
          {pola.tanpaJam} kejadian belum memiliki jam dan {pola.tanpaLokasi} kejadian belum memiliki lokasi.
          Data lama tetap terhitung pada analitik, namun tidak masuk grafik jam/lokasi.
        </Alert>
      ) : null}
    </div>
  );
}

function Insight({ icon: Icon, title, value, detail, tone }) {
  const tones = { orange: 'from-orange-500 to-amber-500', rose: 'from-rose-500 to-orange-500', sky: 'from-sky-500 to-cyan-500' };
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', tones[tone])}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <p className="truncate text-[16px] font-extrabold leading-tight text-slate-800">{value}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{detail}</p>
      </div>
    </div>
  );
}
