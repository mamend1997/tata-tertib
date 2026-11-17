import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Award, CalendarClock, CheckCircle2, ClipboardList, Clock, ExternalLink, FileText,
  Gavel, HardDrive, HeartHandshake, Loader2, MapPin, Repeat, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Users, XCircle
} from 'lucide-react';
import { api, tgl, tglPendek, waktu } from '../api';
import { Alert, Card, Empty, Modal, Spinner, Stat, StatusBadge, cx } from '../ui';
import { portalUrlOf, portalAbsUrl } from '../portalurl';
import SetupChecklist from '../components/SetupChecklist';

export default function Dashboard({ ctx }) {
  const { filters, refreshKey, toast, setPage, boot } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAlert, setShowAlert] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [selRiwayat, setSelRiwayat] = useState([]);
  const [busyRiwayat, setBusyRiwayat] = useState(false);
  const [showTukar, setShowTukar] = useState(false);
  const [tukarBusy, setTukarBusy] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/api/dashboard?ta=${filters.ta || ''}`)
      .then(r => { if (alive) setData(r); })
      .catch(e => toast.err(e.message))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters.ta, refreshKey]);

  const taNama = ((boot.tahun || []).find(t => t.id === Number(filters.ta)) || {}).nama || '-';
  const alertKey = 'stt:alert:' + (filters.ta || '') + ':' + ((data?.alerts || []).length);
  useEffect(() => {
    if (!data?.alerts?.length) return;
    let seen = false;
    try { seen = sessionStorage.getItem(alertKey) === '1'; } catch (e) { /* abaikan */ }
    if (!seen) setShowAlert(true);
  }, [data, alertKey]);
  function tutupAlert() {
    setShowAlert(false);
    setAlertDismissed(true);
    try { sessionStorage.setItem(alertKey, '1'); } catch (e) { /* abaikan */ }
  }
  /* PERMINTAAN TUKAR JADWAL MASUK — pop-up sekali per sesi peramban */
  const tukarKey = 'stt:tukar:' + ((data?.tukar_masuk || []).map(t => t.id).join('-') || '');
  useEffect(() => {
    if (!(data?.tukar_masuk || []).length) return;
    let seen = false;
    try { seen = sessionStorage.getItem(tukarKey) === '1'; } catch (e) { /* abaikan */ }
    if (!seen) setShowTukar(true);
  }, [tukarKey, data?.tukar_masuk?.length]);
  function tutupTukar() {
    setShowTukar(false);
    try { sessionStorage.setItem(tukarKey, '1'); } catch (e) { /* abaikan */ }
  }
  async function putusTukar(row, aksi) {
    setTukarBusy(row.id);
    try {
      const r = await api('/api/tukar-jadwal/putus', { method: 'POST', body: { id: row.id, aksi } });
      toast.ok(r.pesan || 'Permintaan diproses.');
      const fresh = await api(`/api/dashboard?ta=${filters.ta || ''}`);
      setData(fresh);
    } catch (e) { toast.err(e.message); }
    finally { setTukarBusy(0); }
  }
  /* kartu portal publik siswa — tautan SELALU mengikuti slug sekolah yang login */
  const portalHref = portalUrlOf(boot?.tenant);
  const portalLabel = portalAbsUrl(boot?.tenant);

  if (loading && !data) return <Spinner label="Menghitung data kedisiplinan…" />;
  if (!data) return <Empty title="Data dashboard tidak tersedia" />;

  const { kpi, distribusi, top, early, perKelas, terbaru, tren, rules } = data;
  const maxDist = Math.max(1, ...distribusi.map(d => d.jumlah));
  const maxTren = Math.max(1, ...tren.map(t => Math.max(t.pel, t.pres)));

  return (
    <div className="space-y-4">
      {/* hero */}
      <section className="card overflow-hidden">
        <div className="relative px-5 py-5" style={{ background: 'linear-gradient(125deg, rgba(255,247,237,.96) 0%, rgba(254,243,199,.7) 55%, rgba(255,255,255,.9) 100%)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="chip !border-orange-200 !bg-white/90 !text-orange-700"><Sparkles size={13} /> Dashboard Kedisiplinan</span>
              <h2 className="mt-2 text-[20px] font-extrabold leading-tight text-slate-800">
                Selamat datang, {boot.user.nama.split(',')[0]}
              </h2>
              <p className="mt-1 text-[12.5px] text-slate-600">
                Tahun Pelajaran <b>{taNama}</b> · {kpi.siswa} siswa aktif terpantau
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {ctx.can('kejadian', 'write') ? (
                <button onClick={() => setPage('kejadian')} className="btn-primary"><ClipboardList size={15} /> Catat Kejadian</button>
              ) : null}
              {ctx.can('laporan', 'view') ? (
                <button onClick={() => setPage('laporan')} className="btn-soft"><FileText size={15} /> Laporan & Surat</button>
              ) : null}
              {ctx.can('analitik', 'view') ? (
                <button onClick={() => setPage('analitik')} className="btn-ghost"><TrendingUp size={15} /> Analitik Pola</button>
              ) : null}
              {portalHref ? (
                <a href={portalHref} target="_blank" rel="noreferrer" className="btn-ghost" title={portalLabel}>
                  <ExternalLink size={15} /> Portal Siswa
                </a>
              ) : null}
            </div>
          </div>
          {/* indikator penyimpanan ringkas (ukuran data aplikasi, bukan disk host) */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(() => {
              const st = data.storage || null;
              if (!st) return null;
              const mb = v => (Number(v) || 0) / (1024 * 1024);
              const used = mb(st.used_bytes), quota = Math.max(1, mb(st.quota_bytes));
              const pctUse = Math.max(0, Math.min(100, Math.round(used / quota * 100)));
              const txt = used >= 1 ? used.toFixed(1).replace('.', ',') + ' MB' : Math.round(used * 1024) + ' KB';
              return (
                <button onClick={() => ctx.can('berkas', 'view') && setPage('berkas')}
                  title={`Terpakai ${txt} dari kuota ${st.quota_mb} MB (${st.file_count} berkas foto · ${(mb(st.db_bytes)).toFixed(1).replace('.', ',')} MB database)`}
                  className={cx('flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition',
                    ctx.can('berkas', 'view') && 'hover:border-orange-300 hover:text-orange-700')}>
                  <HardDrive size={12} className="text-orange-500" />
                  <span>Penyimpanan {txt}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: pctUse + '%' }} />
                  </span>
                  <span className="text-slate-400">{pctUse}%</span>
                </button>
              );
            })()}
          </div>
        </div>
      </section>

      {boot.user.role === 'admin' ? <SetupChecklist ctx={ctx} /> : null}

      {/* NOTIFIKASI REAL-TIME: siswa Siaga / Kritis */}
      {data.alerts?.length ? (
        <button onClick={() => setShowAlert(true)}
          className="alert-blink no-print flex w-full items-center gap-3 rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-left shadow-soft transition hover:border-red-400">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-600 text-white"><ShieldAlert size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-extrabold text-red-800">
              {data.alerts.length} siswa berstatus Siaga / Kritis / Waspada — perlu penanganan segera
            </span>
            <span className="block truncate text-[11.5px] text-red-700">
              {data.alerts.slice(0, 4).map(a => `${a.nama} (${a.kelas || '-'} · ${a.bersih} poin)`).join(' · ')}
            </span>
          </span>
          <span className="hidden shrink-0 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white sm:block">Lihat</span>
        </button>
      ) : null}

      {/* PERMINTAAN TUKAR JADWAL MENGAJAR MASUK (guru tujuan) */}
      {(data.tukar_masuk || []).length ? (
        <section className="rounded-2xl border-2 border-violet-300 bg-violet-50 px-4 py-3" data-tukar-card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white"><Repeat size={17} /></span>
              <div>
                <p className="text-[13px] font-extrabold text-violet-900">Permintaan Tukar Jadwal Masuk</p>
                <p className="text-[11.5px] text-violet-700">{data.tukar_masuk.length} permintaan menunggu jawaban Anda</p>
              </div>
            </div>
            <button className="btn-sm border border-violet-300 bg-white text-violet-800" onClick={() => setShowTukar(true)} data-tukar-lihat>
              Lihat &amp; Jawab
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {data.tukar_masuk.map(t => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-white p-2.5" data-tukar-masuk={t.id}>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold text-slate-800">{t.dari_nama} → Anda</p>
                  <p className="text-[11px] text-slate-600">{t.mapel_nama || 'Mapel'} · {t.kelas_nama || '-'} · sesi {t.sesi} · {t.tanggal}</p>
                  {t.alasan ? <p className="text-[10.5px] italic text-slate-500">“{t.alasan}”</p> : null}
                </div>
                <div className="flex gap-1.5">
                  <button className="btn-sm border border-emerald-300 bg-emerald-50 text-emerald-800"
                    disabled={tukarBusy === t.id} onClick={() => putusTukar(t, 'terima')} data-tukar-terima={t.id}>
                    {tukarBusy === t.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Terima
                  </button>
                  <button className="btn-sm border border-rose-300 bg-rose-50 text-rose-700"
                    disabled={tukarBusy === t.id} onClick={() => putusTukar(t, 'tolak')} data-tukar-tolak={t.id}>
                    <XCircle size={13} /> Tolak
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Siswa" value={kpi.siswa} sub={`${kpi.kelas} kelas terpantau`} icon={Users} tone="sky" onClick={() => setPage('siswa')} />
        <Stat label="Kejadian Pelanggaran" value={kpi.pelanggaran} sub={`${kpi.totalPel} poin pelanggaran`} icon={AlertTriangle} tone="rose" onClick={() => setPage('kejadian')} />
        <Stat label="Kejadian Prestasi" value={kpi.prestasi} sub={`${kpi.totalPres} poin prestasi`} icon={Award} tone="violet" onClick={() => setPage('kejadian')} />
        <Stat label="Perlu Perhatian" value={kpi.perluPerhatian} sub={`${kpi.dini} siswa sinyal deteksi dini`} icon={ShieldAlert} tone="orange" onClick={() => setPage('deteksi')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* distribusi status */}
        <Card title="Distribusi Status Disiplin" subtitle="Berdasarkan poin bersih (pelanggaran − prestasi)" className="xl:col-span-1">
          <div className="space-y-2.5">
            {distribusi.map(d => (
              <div key={d.label}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <StatusBadge label={d.label} size="sm" />
                  <span className="font-bold text-slate-700">{d.jumlah} siswa</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={cx('h-full rounded-full',
                    d.label === 'Aman' && 'bg-emerald-500', d.label === 'Pantau' && 'bg-sky-500',
                    d.label === 'Perhatian' && 'bg-amber-500', d.label === 'Kritis' && 'bg-orange-500',
                    d.label === 'Siaga' && 'bg-rose-500', d.label === 'Waspada' && 'bg-red-600')}
                    style={{ width: Math.max(2, (d.jumlah / maxDist) * 100) + '%' }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            Ambang batas: {rules.map(r => `${r.label} ${r.max === null ? `≥${r.min}` : `${r.min}–${r.max}`}`).join(' · ')}
          </div>
        </Card>

        {/* tren */}
        <Card title="Tren Poin per Bulan" subtitle="Akumulasi poin pelanggaran vs prestasi" className="xl:col-span-2">
          {tren.length ? (
            <div className="flex h-[210px] items-end gap-2.5 overflow-x-auto pb-1">
              {tren.map(t => (
                <div key={t.key} className="flex min-w-[46px] flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-[150px] w-full items-end justify-center gap-1">
                    <div className="group relative w-1/2 max-w-[16px] rounded-t-md bg-gradient-to-t from-rose-500 to-orange-400"
                      style={{ height: Math.max(3, (t.pel / maxTren) * 140) + 'px' }} title={`Pelanggaran ${t.pel} poin`} />
                    <div className="w-1/2 max-w-[16px] rounded-t-md bg-gradient-to-t from-violet-500 to-fuchsia-400"
                      style={{ height: Math.max(3, (t.pres / maxTren) * 140) + 'px' }} title={`Prestasi ${t.pres} poin`} />
                  </div>
                  <span className="text-[10.5px] font-semibold text-slate-500">{bulanPendek(t.key)}</span>
                </div>
              ))}
            </div>
          ) : <Empty icon={TrendingDown} title="Belum ada data tren" />}
          <div className="mt-3 flex items-center gap-4 text-[11.5px] font-semibold text-slate-500">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-rose-500 to-orange-400" /> Pelanggaran</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-violet-500 to-fuchsia-400" /> Prestasi</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* top ranking */}
        <Card title="Peringkat Poin Pelanggaran" subtitle="10 siswa dengan poin pelanggaran tertinggi"
          className="xl:col-span-2"
          right={<button onClick={() => setPage('siswa')} className="text-[12px] font-bold text-orange-600 hover:text-orange-700">Lihat semua <ArrowRight size={12} className="inline" /></button>}>
          <div className="tbl-wrap max-h-[420px]">
            <table className="tbl">
              <thead><tr><th className="w-12 text-center">#</th><th>Nama Siswa</th><th>Kelas</th><th className="text-center">Pel</th><th className="text-center">Pres</th><th className="text-center">Bersih</th><th>Status</th></tr></thead>
              <tbody>
                {top.map(s => (
                  <tr key={s.id}>
                    <td className="text-center">
                      <span className={cx('inline-grid h-6 w-6 place-items-center rounded-lg text-[11.5px] font-bold',
                        s.rank === 1 ? 'bg-orange-500 text-white' : s.rank <= 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500')}>{s.rank}</span>
                    </td>
                    <td className="font-semibold text-slate-700">{s.nama}</td>
                    <td className="whitespace-nowrap">{s.kelas_nama || '-'}</td>
                    <td className="text-center font-bold text-rose-600">{s.pel}</td>
                    <td className="text-center font-semibold text-violet-600">{s.pres}</td>
                    <td className="text-center font-bold">{s.bersih}</td>
                    <td><StatusBadge label={s.status.label} size="sm" /></td>
                  </tr>
                ))}
                {!top.length ? <tr><td colSpan="7"><Empty icon={Award} title="Belum ada pelanggaran" desc="Semua siswa bersih pada periode ini." /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>

        {/* deteksi dini */}
        <Card title="Deteksi Dini 14 Hari" subtitle={`Siaga ≥ ${data.dini.siaga} poin · Waspada ≥ ${data.dini.waspada} poin`}
          right={<button onClick={() => setPage('deteksi')} className="text-[12px] font-bold text-orange-600 hover:text-orange-700">Detail <ArrowUpRight size={12} className="inline" /></button>}>
          {early.length ? (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {early.slice(0, 8).map(e => (
                <li key={e.id} className={cx('rounded-xl border px-3 py-2',
                  e.level === 'waspada' ? 'border-red-200 bg-red-50/70' : 'border-rose-200 bg-rose-50/60')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-bold text-slate-800">{e.nama}</p>
                      <p className="text-[11px] text-slate-500">{e.kelas} · {e.jml} kejadian · terakhir {tglPendek(e.terakhir)}</p>
                    </div>
                    <div className="text-right">
                      <span className={cx('badge', e.level === 'waspada' ? 'badge-waspada' : 'badge-siaga')}>
                        <ShieldAlert size={11} /> {e.level === 'waspada' ? 'WASPADA' : 'SIAGA'}
                      </span>
                      <p className="mt-1 text-[11px] font-bold text-slate-600">{e.poin14} poin</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty icon={ShieldAlert} title="Tidak ada sinyal dini" desc="Tidak ada siswa yang menembus ambang Siaga / Waspada dalam 14 hari terakhir." />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Ringkasan per Kelas" subtitle="Poin pelanggaran & prestasi tiap kelas" className="xl:col-span-2">
          <div className="tbl-wrap max-h-[360px]">
            <table className="tbl">
              <thead><tr><th>Kelas</th><th>Wali Kelas</th><th className="text-center">Siswa</th><th className="text-center">Pel</th><th className="text-center">Pres</th><th className="text-center">Kritis+</th></tr></thead>
              <tbody>
                {perKelas.map(k => (
                  <tr key={k.id}>
                    <td className="font-semibold">{k.nama}</td>
                    <td className="text-[12px] text-slate-600">{k.wali}</td>
                    <td className="text-center">{k.jumlah}</td>
                    <td className="text-center font-bold text-rose-600">{k.pel}</td>
                    <td className="text-center font-semibold text-violet-600">{k.pres}</td>
                    <td className="text-center">
                      <span className={cx('badge', k.kritis ? 'badge-kritis' : 'badge-aman')}>{k.kritis}</span>
                    </td>
                  </tr>
                ))}
                {!perKelas.length ? <tr><td colSpan="6"><Empty title="Belum ada kelas" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Aktivitas Terbaru" subtitle="Catatan kejadian terakhir">
          {terbaru.length ? (
            <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {terbaru.map(e => (
                <li key={e.id} className="flex items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2">
                  <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold',
                    e.jenis === 'prestasi' ? 'bg-violet-100 text-violet-700' : 'bg-rose-100 text-rose-700')}>
                    {e.jenis === 'prestasi' ? '+' : '−'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-slate-700">{e.siswa_nama}</p>
                    <p className="truncate text-[11.5px] text-slate-500">{e.judul} · {e.poin} poin</p>
                    <p className="text-[10.5px] text-slate-400">{e.kelas_nama || '-'} · {tglPendek(e.tanggal)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty icon={ClipboardList} title="Belum ada aktivitas" />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Pola Hari Rawan" subtitle="Kejadian pelanggaran per hari">
          {data.pola?.byDay?.some(d => d.jml) ? (
            <div className="flex h-[150px] items-end gap-1.5">
              {data.pola.byDay.map(d => {
                const max = Math.max(1, ...data.pola.byDay.map(x => x.jml));
                return (
                  <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t-md bg-gradient-to-t from-orange-600 to-amber-400"
                      style={{ height: Math.max(3, (d.jml / max) * 108) + 'px' }} title={`${d.label}: ${d.jml} kejadian`} />
                    <span className="text-[9.5px] font-semibold text-slate-400">{d.label.slice(0, 3)}</span>
                  </div>
                );
              })}
            </div>
          ) : <Empty icon={CalendarClock} title="Belum ada data" />}
          <p className="mt-2 text-[11px] text-slate-500">
            Teratas: <b>{(data.pola?.hariRawan?.[0] || {}).label || '-'}</b> · {(data.pola?.hariRawan?.[0] || {}).jml || 0} kejadian
          </p>
        </Card>

        <Card title="Jam Rawan" subtitle="Distribusi pelanggaran per jam (06–18)">
          {data.pola?.byHour?.some(d => d.jml) ? (
            <div className="flex h-[150px] items-end gap-[3px]">
              {data.pola.byHour.map(d => {
                const max = Math.max(1, ...data.pola.byHour.map(x => x.jml));
                return (
                  <div key={d.hour} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t-sm bg-gradient-to-t from-rose-600 to-orange-400"
                      style={{ height: Math.max(3, (d.jml / max) * 108) + 'px' }} title={`${String(d.hour).padStart(2, '0')}:00 — ${d.jml}`} />
                    <span className="text-[8.5px] font-semibold text-slate-400">{String(d.hour).padStart(2, '0')}</span>
                  </div>
                );
              })}
            </div>
          ) : <Empty icon={Clock} title="Belum ada data jam" />}
          <p className="mt-2 text-[11px] text-slate-500">
            Puncak: <b>{data.pola?.jamRawan?.[0] ? String(data.pola.jamRawan[0].hour).padStart(2, '0') + ':00' : '-'}</b>
            {data.pola?.jamRawan?.[0] ? ` · ${data.pola.jamRawan[0].jml} kejadian` : ''}
          </p>
        </Card>

        <Card title="Lokasi Rawan" subtitle="Tempat kejadian paling sering"
          right={ctx.can('analitik', 'view') ? <button onClick={() => setPage('analitik')} className="text-[12px] font-bold text-orange-600">Detail</button> : null}>
          {data.pola?.byLokasi?.length ? (
            <div className="space-y-2">
              {data.pola.byLokasi.slice(0, 5).map(l => {
                const max = Math.max(1, ...data.pola.byLokasi.map(x => x.jml));
                return (
                  <div key={l.label}>
                    <div className="mb-0.5 flex items-center justify-between text-[11.5px]">
                      <span className="truncate font-semibold text-slate-600">{l.label}</span>
                      <span className="font-bold text-slate-700">{l.jml}×</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400"
                        style={{ width: Math.max(3, (l.jml / max) * 100) + '%' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <Empty icon={MapPin} title="Belum ada data lokasi" />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Rekomendasi Sanksi Otomatis" subtitle="Siswa per tingkat sanksi berdasarkan akumulasi poin pelanggaran"
          right={ctx.can('laporan', 'view') ? <button onClick={() => setPage('laporan')} className="text-[12px] font-bold text-orange-600">Cetak surat</button> : null}>
          {data.sanksiRekap?.length ? (
            <div className="space-y-2">
              {data.sanksiRekap.map(r => (
                <div key={r.label} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
                    <Gavel size={14} className="text-orange-500" /> {r.label}
                  </span>
                  <span className="badge badge-netral">{r.jumlah} siswa</span>
                </div>
              ))}
            </div>
          ) : <Empty icon={Gavel} title="Belum ada rekomendasi sanksi" />}
        </Card>

        <Card title="Catatan Pembinaan" subtitle="Tindak lanjut yang sudah dicatat guru BK / kesiswaan"
          right={ctx.can('tindak_lanjut', 'view') ? <button onClick={() => setPage('tindak_lanjut')} className="text-[12px] font-bold text-orange-600">Buka</button> : null}>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Total Catatan" value={data.tindakStats?.total || 0} />
            <MiniStat label="Selesai" value={data.tindakStats?.selesai || 0} tone="text-emerald-600" />
            <MiniStat label="Pemantauan" value={data.tindakStats?.pemantauan || 0} tone="text-sky-600" />
            <MiniStat label="Perlu Lanjutan" value={data.tindakStats?.lanjutan || 0} tone="text-rose-600" />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <HeartHandshake size={12} /> Catatan otomatis tampil pada kartu siswa &amp; riwayat pembinaan.
          </p>
        </Card>
      </div>

      {/* pop-up permintaan tukar jadwal masuk */}
      <Modal open={showTukar && !!(data.tukar_masuk || []).length} onClose={tutupTukar} size="md"
        title="Permintaan Tukar Jadwal Masuk"
        subtitle="Terima untuk mengambil alih sesi hari ini, tolak agar jadwal tetap seperti semula.">
        <div className="space-y-2">
          {(data.tukar_masuk || []).map(t => (
            <div key={t.id} className="rounded-xl border border-violet-200 bg-violet-50/60 p-3" data-tukar-popup={t.id}>
              <p className="text-[13px] font-bold text-slate-800">{t.dari_nama} → Anda</p>
              <p className="text-[11.5px] text-slate-600">
                {t.mapel_nama || 'Mapel'} · {t.kelas_nama || '-'} · sesi {t.sesi} · {t.tanggal}
              </p>
              {t.alasan ? <p className="text-[11px] italic text-slate-500">“{t.alasan}”</p> : null}
              <div className="mt-2 flex gap-1.5">
                <button className="btn-sm border border-emerald-300 bg-emerald-50 text-emerald-800"
                  disabled={tukarBusy === t.id} onClick={() => putusTukar(t, 'terima')} data-tukar-popup-terima={t.id}>
                  {tukarBusy === t.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Terima
                </button>
                <button className="btn-sm border border-rose-300 bg-rose-50 text-rose-700"
                  disabled={tukarBusy === t.id} onClick={() => putusTukar(t, 'tolak')} data-tukar-popup-tolak={t.id}>
                  <XCircle size={13} /> Tolak
                </button>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* pop-up notifikasi Siaga / Kritis */}
      <Modal open={showAlert && !alertDismissed} onClose={tutupAlert} size="md"
        title="Peringatan Dini — Siswa Siaga & Kritis"
        subtitle={`${data.alerts.length} siswa perlu penanganan segera pada periode ini`}
        footer={<>
          <button className="btn-ghost" onClick={tutupAlert}>Tutup</button>
          {ctx.can('deteksi', 'view') ? <button className="btn-primary" onClick={() => { tutupAlert(); setPage('deteksi'); }}>Buka Deteksi Dini</button> : null}
        </>}>
        <div className="tbl-wrap max-h-[52vh]">
          <table className="tbl">
            <thead><tr><th>Nama</th><th>Kelas</th><th className="text-center">Poin</th><th>Status</th><th>Rekomendasi</th></tr></thead>
            <tbody>
              {data.alerts.map(a => (
                <tr key={a.id}>
                  <td className="font-semibold text-slate-700">{a.nama}</td>
                  <td className="whitespace-nowrap">{a.kelas || '-'}</td>
                  <td className="text-center font-bold text-rose-600">{a.bersih}</td>
                  <td><StatusBadge label={a.status.label} size="sm" /></td>
                  <td className="text-[11.5px] text-slate-500">{a.sanksi ? a.sanksi.label : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* RIWAYAT AKTIVITAS SISWA (jurnal harian + kejadian) — eksklusif di dashboard */}
      <Card title="Riwayat Aktivitas Siswa" subtitle="Catatan dari Input Kejadian & Buku Penghubung — lengkap dengan nama pelapor"
        data-riwayat-card="1"
        right={<span className="text-[11.5px] font-semibold text-slate-500">{selRiwayat.length} dipilih</span>}>
        {(() => {
          const list = data.riwayat || [];
          const semua = list.length > 0 && selRiwayat.length === list.length;
          const keyOf = r => r.sumber + ':' + r.id;
          return (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" checked={semua}
                    data-riwayat-all="1"
                    onChange={() => setSelRiwayat(semua ? [] : list.map(keyOf))} />
                  Pilih Semua
                </label>
                {selRiwayat.length ? (
                  <button className="chip !py-0.5 hover:!border-orange-300" onClick={() => setSelRiwayat([])}>Bersihkan</button>
                ) : null}
                <button className="btn-danger btn-sm ml-auto" data-riwayat-hapus="1"
                  disabled={!selRiwayat.length || busyRiwayat}
                  onClick={async () => {
                    if (!selRiwayat.length) return toast.err('Pilih minimal satu riwayat.');
                    if (!window.confirm(`Hapus ${selRiwayat.length} riwayat terpilih? Data dipindahkan ke Kotak Sampah.`)) return;
                    setBusyRiwayat(true);
                    try {
                      const items = selRiwayat.map(k => { const [sumber, id] = k.split(':'); return { sumber, id: Number(id) }; });
                      const r = await api('/api/riwayat/hapus-massal', { method: 'POST', body: { items } });
                      toast.ok(r.pesan); setSelRiwayat([]); ctx.bump();
                    } catch (e) { toast.err(e.message); }
                    finally { setBusyRiwayat(false); }
                  }}>
                  <Gavel size={13} /> Hapus Terpilih
                </button>
              </div>
              {list.length ? (
                <div className="tbl-wrap max-h-[460px]">
                  <table className="tbl" data-tbl="riwayat">
                    <thead>
                      <tr>
                        <th className="w-9 text-center"><CheckboxHead /></th>
                        <th className="w-24">Tanggal</th><th className="w-14">Jam</th><th>Siswa</th>
                        <th className="hidden md:table-cell">Kelas</th><th>Kategori / Temuan</th>
                        <th className="w-20 text-center">Poin</th><th>Sumber</th><th>Pelapor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(r => {
                        const key = r.sumber + ':' + r.id;
                        return (
                          <tr key={key} className={selRiwayat.includes(key) ? 'bg-orange-50/60' : ''}>
                            <td className="text-center">
                              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                                checked={selRiwayat.includes(key)}
                                onChange={() => setSelRiwayat(l => l.includes(key) ? l.filter(x => x !== key) : [...l, key])} />
                            </td>
                            <td className="whitespace-nowrap text-[12px]">{tglPendek(r.tanggal)}</td>
                            <td className="whitespace-nowrap text-[12px]">{r.jam || '-'}</td>
                            <td>
                              <p className="font-semibold text-slate-700">{r.siswa_nama || '-'}</p>
                              {r.lokasi ? <p className="flex items-center gap-1 text-[10.5px] text-orange-600"><MapPin size={10} /> {r.lokasi}</p> : null}
                            </td>
                            <td className="hidden whitespace-nowrap md:table-cell">{r.kelas_nama || '-'}</td>
                            <td className="max-w-[280px]">
                              <p className="truncate font-medium text-slate-700">{r.kategori_nama || '-'}</p>
                              {r.keterangan ? <p className="truncate text-[11px] text-slate-400">{r.keterangan}</p> : null}
                            </td>
                            <td className="text-center">
                              <span className={cx('font-bold', r.jenis === 'prestasi' ? 'text-violet-600' : 'text-rose-600')}>
                                {r.jenis === 'prestasi' ? '+' : '−'}{r.poin}
                              </span>
                            </td>
                            <td><span className="chip !py-0.5">{r.sumber === 'jurnal' ? 'Buku Penghubung' : 'Kejadian'}</span></td>
                            <td className="whitespace-nowrap text-[12px] font-semibold text-slate-600" data-pelapor={key}>{r.pelapor || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <Empty icon={ClipboardList} title="Belum ada riwayat aktivitas" desc="Catat kejadian atau jurnal harian untuk melihat riwayat di sini." />}
            </>
          );
        })()}
      </Card>

      {data.feedback_baru ? (
        <Alert tone="info" title={`${data.feedback_baru} masukan & kendala pengguna belum ditindaklanjuti`}>
          Buka menu <b>Masukan &amp; Kendala User</b> pada grup Sistem untuk melihat dan membalas laporan pengguna.
        </Alert>
      ) : null}

      {kpi.dini > 0 ? (
        <Alert tone="warn" title={`${kpi.dini} siswa memerlukan perhatian khusus`}>
          Terdapat siswa dengan akumulasi poin pelanggaran tinggi dalam 14 hari terakhir. Buka menu <b>Deteksi Dini</b> untuk
          melihat rincian dan mengirim peringatan WhatsApp ke orang tua.
        </Alert>
      ) : null}
    </div>
  );
}

function CheckboxHead() {
  return <span className="sr-only">Pilih</span>;
}

function bulanPendek(key) {
  const B = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m] = String(key).split('-');
  return `${B[Number(m) - 1]} ${String(y).slice(2)}`;
}

function MiniStat({ label, value, tone = 'text-slate-800' }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cx('text-[17px] font-extrabold leading-tight', tone)}>{value}</p>
    </div>
  );
}
