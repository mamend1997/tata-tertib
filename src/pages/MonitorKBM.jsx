import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpenCheck, CalendarClock, CheckCircle2, Clock, Eye, Image as ImageIcon, Loader2, RefreshCw,
  Repeat, UserCheck, UserX, Users
} from 'lucide-react';
import { api, hariIni, tgl } from '../api';
import { Alert, Card, Empty, Modal, Spinner, Stat, cx, useToast } from '../ui';

/* =====================================================================
   MONITORING KBM REAL-TIME (Wakasek Kurikulum)
   ---------------------------------------------------------------------
   Satu halaman pengawasan mutu pembelajaran:
     · kelas yang SEDANG belajar sekarang + status gurunya,
     · kelas yang gurunya berhalangan / sudah digantikan guru piket,
     · persentase guru yang sudah mengisi Jurnal Mengajar hari ini.
   Data dihitung server dari slot jadwal hari ini, absensi guru, rekam izin,
   dan data tukar/penunjukan pengganti. Halaman menyegarkan diri otomatis.
   ===================================================================== */
const REFRESH_MS = 30000;
const ABSENSI_STATUS = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpa', B: 'Bolos' };

export default function MonitorKBM({ ctx }) {
  const { filters, toast } = ctx;
  const [tanggal, setTanggal] = useState(() => hariIni());
  const [tanggalMatriks, setTanggalMatriks] = useState(() => hariIni());
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [detik, setDetik] = useState(0);
  const [gridMode, setGridMode] = useState('semua');
  const [gridKelas, setGridKelas] = useState('');
  const [gridGuru, setGridGuru] = useState('');
  const [previewSlot, setPreviewSlot] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [nonaktifTarget, setNonaktifTarget] = useState(null);
  const [alasanNonaktif, setAlasanNonaktif] = useState('');
  const [nonaktifBusy, setNonaktifBusy] = useState(false);
  const [nonaktifTerpilih, setNonaktifTerpilih] = useState([]);
  const ta = filters?.ta || '';

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api(`/api/monitor-kbm?ta=${encodeURIComponent(ta)}&tanggal=${encodeURIComponent(tanggal)}&tanggal_matriks=${encodeURIComponent(tanggalMatriks)}`)
      .then(r => { setD(r); setDetik(0); })
      .catch(e => { if (!silent) toast.err(e.message); })
      .finally(() => setLoading(false));
  }, [ta, tanggal, tanggalMatriks]);

  useEffect(() => { load(); }, [load]);

  /* penyegaran berkala (real-time) */
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => { load(true); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [auto, load]);
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => setDetik(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [auto]);
  useEffect(() => {
    const kelas = d?.kelas || [];
    if (kelas.length && !kelas.some(k => String(k.id) === gridKelas)) setGridKelas(String(kelas[0].id));
  }, [d?.kelas, gridKelas]);

  const stats = d?.stats || {};
  const perKelas = d?.per_kelas || [];
  const berlangsung = d?.sedang_belajar || [];
  const berhalanganRekap = d?.berhalangan_rekap || d?.berhalangan || [];
  const jadwalMonitor = d?.monitor_jadwal || [];
  const kelasMonitor = d?.kelas || [];
  const guruMonitor = d?.guru || [];
  const kolomKelas = useMemo(() => {
    if (gridMode === 'kelas' && gridKelas) return kelasMonitor.filter(k => String(k.id) === gridKelas);
    if (gridMode === 'guru' && gridGuru) {
      const ids = new Set(jadwalMonitor.filter(x => Number(x.guru_efektif_id) === Number(gridGuru))
        .flatMap(x => (x.kelas_ids || []).map(Number)));
      return kelasMonitor.filter(k => ids.has(Number(k.id)));
    }
    return kelasMonitor;
  }, [gridMode, gridKelas, gridGuru, kelasMonitor, jadwalMonitor]);
  const barisGrid = useMemo(() => jadwalMonitor
    .filter(x => gridMode !== 'kelas' || !gridKelas || (x.kelas_ids || []).some(id => Number(id) === Number(gridKelas)))
    .filter(x => gridMode !== 'guru' || !gridGuru || Number(x.guru_efektif_id) === Number(gridGuru))
    .sort((a, b) => Number(a.sesi) - Number(b.sesi)
      || String(a.mulai).localeCompare(String(b.mulai))
      || Number(a.jadwal_id) - Number(b.jadwal_id)),
  [jadwalMonitor, gridMode, gridKelas, gridGuru]);
  const kelompokSesiGrid = useMemo(() => {
    const groups = new Map();
    for (const slot of barisGrid) {
      const sesi = Number(slot.sesi);
      if (!groups.has(sesi)) groups.set(sesi, []);
      groups.get(sesi).push(slot);
    }
    return [...groups.entries()].map(([sesi, slots]) => ({ sesi, slots }));
  }, [barisGrid]);
  const tanggalGrid = d?.tanggal_matriks || tanggalMatriks;
  const dapatPilihNonaktif = !!d?.boleh_nonaktifkan && tanggalGrid >= hariIni();
  const slotNonaktifMendatang = useMemo(() => barisGrid.filter(x =>
    dapatPilihNonaktif && !x.nonaktif && x.preview_primary && x.fase === 'belum'
      && (x.kelas_ids || []).length > 0
  ), [barisGrid, dapatPilihNonaktif]);
  const selectedIds = new Set(slotNonaktifMendatang
    .filter(x => nonaktifTerpilih.includes(Number(x.jadwal_id)))
    .map(x => Number(x.jadwal_id)));
  const semuaSlotTerpilih = slotNonaktifMendatang.length > 0
    && slotNonaktifMendatang.every(x => selectedIds.has(Number(x.jadwal_id)));

  const kelasDenganStatus = useMemo(() => new Map(perKelas.map(k => [Number(k.kelas_id), k])), [perKelas]);

  if (loading && !d) return <Spinner label="Memuat monitoring KBM…" />;

  const toneGuru = (x) => {
    if (['izin', 'sakit', 'alpha'].includes(x.status_guru)) return 'badge-siaga';
    if (x.hadir) return 'badge-aman';
    if (x.belum_checkin) return 'badge-pantau';
    return 'badge-netral';
  };
  const labelGuru = (x) => {
    if (x.pengganti) return `Digantikan ${x.pengganti.ke_nama}`;
    if (x.status_guru === 'hadir') return 'Hadir (check-in)';
    if (x.status_guru === 'izin') return 'Izin';
    if (x.status_guru === 'sakit') return 'Sakit';
    if (x.status_guru === 'alpha') return 'Alpha';
    if (x.belum_checkin) return 'Belum check-in';
    return 'Menunggu jam';
  };
  async function bukaPratinjau(x) {
    setPreviewSlot(x);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      setPreviewData(await api(`/api/monitor-kbm/pratinjau?jadwal_id=${x.jadwal_id}&tanggal=${encodeURIComponent(d?.tanggal_matriks || tanggalMatriks)}`));
    } catch (e) {
      toast.err(e.message);
      setPreviewSlot(null);
    } finally {
      setPreviewLoading(false);
    }
  }
  function tutupPratinjau() {
    setPreviewSlot(null);
    setPreviewData(null);
  }
  function bukaNonaktifkan(x) {
    setNonaktifTarget(x);
    setAlasanNonaktif('');
  }
  function bukaNonaktifkanMasal() {
    const ids = slotNonaktifMendatang.filter(x => selectedIds.has(Number(x.jadwal_id)))
      .map(x => Number(x.jadwal_id));
    if (!ids.length) return;
    setNonaktifTarget({
      jadwal_ids: ids,
      pilihan: slotNonaktifMendatang.filter(x => ids.includes(Number(x.jadwal_id)))
    });
    setAlasanNonaktif('');
  }
  function tutupNonaktifkan() {
    if (nonaktifBusy) return;
    setNonaktifTarget(null);
    setAlasanNonaktif('');
  }
  async function simpanNonaktifkan() {
    if (!nonaktifTarget || alasanNonaktif.trim().length < 5) {
      toast.err('Alasan penonaktifan wajib diisi minimal 5 karakter.');
      return;
    }
    setNonaktifBusy(true);
    try {
      const massal = Array.isArray(nonaktifTarget.jadwal_ids);
      const r = await api(massal ? '/api/monitor-kbm/nonaktif-masal' : '/api/monitor-kbm/nonaktif', {
        method: 'POST',
        body: {
          ...(massal ? { jadwal_ids: nonaktifTarget.jadwal_ids } : { jadwal_id: nonaktifTarget.jadwal_id }),
          tanggal: d?.tanggal_matriks || tanggalMatriks,
          alasan: alasanNonaktif.trim()
        }
      });
      toast.ok(r.pesan || 'KBM reguler dinonaktifkan untuk tanggal ini.');
      setNonaktifTarget(null);
      setAlasanNonaktif('');
      setNonaktifTerpilih([]);
      load(true);
    } catch (e) { toast.err(e.message); }
    finally { setNonaktifBusy(false); }
  }

  return (
    <div className="space-y-4" data-page="monitor-kbm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[19px] font-extrabold text-slate-800">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-soft">
              <Activity size={17} />
            </span>
            Monitoring KBM Real-Time
          </h2>
          <p className="mt-1 max-w-3xl text-[12.5px] text-slate-500">
            Pantau kelas yang sedang belajar, guru yang berhalangan/digantikan, serta kelengkapan
            <b> Jurnal Mengajar</b> hari ini — tanpa mengecek satu per satu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input !w-auto !py-1.5 text-[12px]" value={tanggal}
            onChange={e => { setTanggal(e.target.value); setTanggalMatriks(e.target.value); }} data-monitor-tanggal />
          <button className="btn-ghost btn-sm" onClick={() => { setTanggal(hariIni()); setTanggalMatriks(hariIni()); }} data-monitor-hari-ini>
            <CalendarClock size={14} /> Hari Ini
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600" checked={auto}
              data-monitor-auto onChange={e => setAuto(e.target.checked)} />
            Auto {auto ? `${Math.max(0, REFRESH_MS / 1000 - detik)}s` : 'off'}
          </label>
          <button className="btn-primary btn-sm" onClick={() => load(true)} data-monitor-refresh>
            <RefreshCw size={14} /> Segarkan
          </button>
        </div>
      </div>

      {d?.kbm_libur ? (
        <Alert tone="warn" title="KBM reguler tidak berlaku hari ini">
          Tanggal <b>{tgl(d.tanggal, { long: true })}</b> ditandai di kalender akademik sebagai
          <b> {d.kalender?.label || 'agenda sekolah'}</b>
          {d.kalender?.judul ? `: ${d.kalender.judul}` : ''}. Jadwal mapel reguler tidak dijalankan,
          sehingga absensi & jurnal mengajar tidak dihitung.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Kelas Sedang Belajar" value={berlangsung.length}
          sub={d?.sesi_berjalan ? `${d.sesi_berjalan.label} · ${d.sesi_berjalan.jam}` : 'di luar jam pelajaran'}
          icon={Users} tone="emerald" />
        <Stat label="Guru Berhalangan" value={stats.berhalangan || 0}
          sub={`${stats.digantikan || 0} digantikan · ${stats.perlu_pengganti || 0} perlu pengganti`}
          icon={UserX} tone="rose" />
        <Stat label="Belum Check-in" value={stats.belum_checkin || 0}
          sub={`dari ${stats.slot || 0} jam pelajaran hari ini`} icon={Clock} tone="orange" />
        <Stat label="Jurnal Mengajar" value={`${stats.persen_jurnal || 0}%`}
          sub={`${stats.jurnal_isi || 0} sudah · ${stats.jurnal_belum || 0} belum`} icon={BookOpenCheck} tone="violet" />
      </div>

      {/* progress jurnal */}
      <Card title="Kelengkapan Jurnal Mengajar Hari Ini"
        subtitle={`Dianggap terisi bila jurnal materi ≥ ${d?.jurnal_min || 15} karakter. Diperbarui ${d?.sekarang || '-'} WIB.`}>
        <div className="flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all"
              style={{ width: `${Math.min(100, stats.persen_jurnal || 0)}%` }} data-jurnal-bar />
          </div>
          <span className="text-[13px] font-extrabold text-slate-700" data-jurnal-persen>{stats.persen_jurnal || 0}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
          <span className="chip !border-emerald-200 !bg-emerald-50 !text-emerald-700">
            <CheckCircle2 size={11} /> {stats.jurnal_isi || 0} sudah mengisi
          </span>
          <span className="chip !border-amber-200 !bg-amber-50 !text-amber-800">
            <AlertTriangle size={11} /> {stats.jurnal_belum || 0} belum mengisi
          </span>
          <span className="chip"><Repeat size={11} /> {stats.digantikan || 0} sesi digantikan</span>
          <span className="chip"><UserCheck size={11} /> {stats.hadir || 0} guru check-in</span>
          <span className="chip">Tanggal: {tgl(d?.tanggal, { long: true })}</span>
        </div>
      </Card>

      <Card title={`Matriks Jadwal Mengajar — ${d?.hari_matriks_label || ''}`}
        subtitle={`Status absensi diperbarui otomatis setiap ${REFRESH_MS / 1000} detik. Tanggal: ${tgl(d?.tanggal_matriks, { long: true })}`}
        right={<div className="flex flex-wrap gap-1.5">
          <input type="date" className="input !w-auto !py-1.5 text-[11.5px]" value={tanggalMatriks}
            onChange={e => { setTanggalMatriks(e.target.value); setNonaktifTerpilih([]); }} aria-label="Tanggal matriks jadwal"
            title="Pilih hari untuk melihat matriks jadwal mengajar" data-monitor-grid-tanggal />
          <select className="input !w-auto !py-1.5 text-[11.5px]" value={gridMode}
            onChange={e => { setGridMode(e.target.value); setNonaktifTerpilih([]); }} data-monitor-grid-mode>
            <option value="semua">Semua kelas</option>
            <option value="kelas">Pilih kelas</option>
            <option value="guru">Per guru</option>
          </select>
          {gridMode === 'kelas' ? (
            <select className="input !w-auto !py-1.5 text-[11.5px]" value={gridKelas}
              onChange={e => { setGridKelas(e.target.value); setNonaktifTerpilih([]); }} data-monitor-grid-kelas>
              {kelasMonitor.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          ) : null}
          {gridMode === 'guru' ? (
            <select className="input !w-auto !py-1.5 text-[11.5px]" value={gridGuru}
              onChange={e => { setGridGuru(e.target.value); setNonaktifTerpilih([]); }} data-monitor-grid-guru>
              <option value="">Semua guru</option>
              {guruMonitor.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
            </select>
          ) : null}
        </div>}>
        {dapatPilihNonaktif ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2"
            data-monitor-nonaktif-masal>
            <label className="flex cursor-pointer items-center gap-2 text-[11.5px] font-semibold text-amber-900">
              <input type="checkbox" className="h-4 w-4 accent-amber-600"
                checked={semuaSlotTerpilih}
                disabled={!slotNonaktifMendatang.length}
                onChange={e => setNonaktifTerpilih(e.target.checked
                  ? slotNonaktifMendatang.map(x => Number(x.jadwal_id)) : [])}
                data-monitor-nonaktif-semua />
              Pilih semua slot mapel yang akan datang
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-800" data-monitor-nonaktif-count>
                {selectedIds.size} dipilih · {slotNonaktifMendatang.length} tersedia
              </span>
              <button type="button" className="btn-sm bg-amber-600 text-white hover:bg-amber-700"
                disabled={!selectedIds.size || nonaktifBusy}
                onClick={bukaNonaktifkanMasal} data-monitor-nonaktif-masal-buka>
                <UserX size={13} /> Nonaktifkan Terpilih
              </button>
            </div>
          </div>
        ) : null}
        {!barisGrid.length || !kolomKelas.length ? (
          <Empty icon={CalendarClock} title="Tidak ada jadwal untuk filter ini"
            desc="Pilih kelas atau guru lain, atau ubah tanggal monitoring." />
        ) : (
          <div className="tbl-wrap max-h-[58vh]">
            <table className="tbl min-w-[760px] text-center align-middle" data-tbl="monitor-jadwal">
              <thead>
                <tr><th className="sticky left-0 z-10 bg-slate-50">Jam / Mapel</th>
                  {kolomKelas.map(k => <th key={k.id} className="min-w-[180px] text-center">{k.nama}</th>)}
                </tr>
              </thead>
              <tbody>
                {kelompokSesiGrid.map(({ sesi, slots }) => {
                  const x = slots[0];
                  return (
                  <tr key={sesi} data-monitor-sesi={sesi}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-white text-center">
                      <b>{x.label_sesi}</b><span className="block text-[10.5px] text-slate-500">{x.jam}</span>
                    </td>
                    {kolomKelas.map(k => {
                      const slotsKelas = slots.filter(slot =>
                        (slot.kelas_ids || []).some(id => Number(id) === Number(k.id)));
                      if (!slotsKelas.length) {
                        return <td key={k.id} className="text-center text-slate-300">—</td>;
                      }
                      return (
                        <td key={k.id} className="text-center align-middle">
                          <div className="space-y-2">
                            {slotsKelas.map(x => {
                              const statusTone = ['hadir', 'sedang berlangsung'].includes(String(x.status_label).toLowerCase())
                                || String(x.status_label).toLowerCase() === 'selesai' ? 'badge-aman'
                                : ['sakit'].includes(String(x.status_label).toLowerCase()) ? 'badge-perhatian'
                                  : ['izin', 'akan datang'].includes(String(x.status_label).toLowerCase()) ? 'badge-pantau'
                                    : ['alpha', 'belum check-in'].includes(String(x.status_label).toLowerCase()) ? 'badge-siaga'
                                      : 'badge-netral';
                              const bolehPilihNonaktif = dapatPilihNonaktif && !x.nonaktif && x.preview_primary
                                && x.fase === 'belum' && Number((x.kelas_ids || [])[0]) === Number(k.id);
                              return (
                                <div key={x.jadwal_id}
                                  className="mx-auto max-w-[220px] rounded-lg border border-slate-200 bg-white p-2 text-center"
                                  data-monitor-jadwal={x.jadwal_id}>
                                  <p className="text-[11.5px] font-extrabold text-slate-800">{x.mapel_kode ? `${x.mapel_kode} · ` : ''}{x.mapel_nama}</p>
                                  <p className="mt-0.5 truncate text-[10.5px] text-slate-500">{x.guru_efektif_nama || x.guru_nama || '-'}</p>
                                  <span className={cx('badge mt-1', statusTone)} data-monitor-grid-status={x.jadwal_id}>
                                    {x.status_label}
                                  </span>
                                  {x.status_detail ? <span className="ml-1 text-[10px] capitalize text-slate-500">{x.status_detail}</span> : null}
                                  {x.nonaktif ? (
                                    <p className="mt-1 text-[10px] font-semibold text-amber-800"
                                      data-monitor-nonaktif-alasan={x.jadwal_id}>
                                      Alasan: {x.nonaktif_alasan || 'KBM reguler tidak berlaku pada tanggal ini.'}
                                    </p>
                                  ) : null}
                                  {bolehPilihNonaktif ? (
                                    <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 text-[10.5px] font-semibold text-amber-800">
                                      <input type="checkbox" className="h-4 w-4 accent-amber-600"
                                        checked={selectedIds.has(Number(x.jadwal_id))}
                                        onChange={e => setNonaktifTerpilih(previous => e.target.checked
                                          ? [...new Set([...previous, Number(x.jadwal_id)])]
                                          : previous.filter(id => Number(id) !== Number(x.jadwal_id)))}
                                        data-monitor-nonaktif-pilih={x.jadwal_id} />
                                      Pilih untuk nonaktif massal
                                    </label>
                                  ) : null}
                                  {x.pengganti?.jenis === 'tukar' ? (
                                    <p className="mt-1 text-[10px] font-semibold text-violet-700"
                                      data-monitor-tukar={x.jadwal_id}>
                                      Ditukar: {x.mapel_asal_nama || '-'} → {x.mapel_nama}
                                    </p>
                                  ) : x.pengganti ? (
                                    <p className="mt-1 text-[10px] font-semibold text-violet-700">Guru piket/pengganti</p>
                                  ) : null}
                                  {d?.boleh_nonaktifkan && !x.nonaktif && x.preview_primary && x.fase === 'belum'
                                    && Number((x.kelas_ids || [])[0]) === Number(k.id) ? (
                                    <button type="button" className="btn-ghost btn-sm mt-2 text-amber-800"
                                      onClick={() => bukaNonaktifkan(x)} data-monitor-nonaktif={x.jadwal_id}>
                                      <UserX size={13} /> Nonaktifkan KBM
                                    </button>
                                  ) : null}
                                  {x.alur_selesai && x.preview_primary && !x.nonaktif ? (
                                    <button type="button" className="btn-ghost btn-sm mt-2"
                                      onClick={() => bukaPratinjau(x)} data-monitor-preview={x.jadwal_id}
                                      data-monitor-preview-group={(x.group_ids || [x.jadwal_id]).join(',')}>
                                      <Eye size={13} /> Pratinjau
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* kelas yang sedang belajar */}
      <Card title={`Kelas Sedang Belajar (${berlangsung.length})`}
        subtitle="Slot yang jam pelajarannya sedang berlangsung saat halaman ini dibuka"
        right={<span className="chip"><Clock size={11} /> {d?.jam_sekarang || '-'} WIB</span>}>
        {!berlangsung.length ? (
          <Empty icon={Clock} title="Tidak ada jam pelajaran berjalan"
            desc={d?.sesi_berikutnya ? `Jam berikutnya ${d.sesi_berikutnya.label} (${d.sesi_berikutnya.jam}).` : 'Di luar jam pelajaran atau hari libur.'} />
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-monitor-aktif>
            {berlangsung.map(x => (
              <div key={x.jadwal_id} data-monitor-slot={x.jadwal_id}
                className={cx('rounded-xl border p-2.5',
                  x.pengganti ? 'border-violet-200 bg-violet-50/60'
                    : ['izin', 'sakit', 'alpha'].includes(x.status_guru) ? 'border-rose-200 bg-rose-50/60'
                      : x.hadir ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-extrabold text-slate-800">{x.kelas_nama || '-'}</p>
                    <p className="truncate text-[11.5px] text-slate-600">
                      {x.mapel_kode ? <b className="mr-1 text-teal-700">{x.mapel_kode}</b> : null}{x.mapel_nama || '-'}
                    </p>
                  </div>
                  <span className={cx('badge shrink-0', toneGuru(x))} data-monitor-status={x.jadwal_id}>{labelGuru(x)}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {x.label_sesi} · {x.jam} · {x.guru_efektif_nama || x.guru_nama || '-'}
                  {x.ruang ? ` · ${x.ruang}` : ''}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px]">
                  <span className={cx('chip !py-0', x.jurnal_isi
                    ? '!border-emerald-200 !bg-white !text-emerald-700' : '!border-amber-300 !bg-white !text-amber-800')}>
                    {x.jurnal_isi ? 'Jurnal terisi' : 'Jurnal belum'}
                  </span>
                  {x.pengganti ? <span className="chip !py-0 !border-violet-300 !bg-white !text-violet-700">Guru piket</span> : null}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* berhalangan / digantikan */}
      <Card title={`Guru Berhalangan & Pengganti (${berhalanganRekap.length})`}
        subtitle="Izin / sakit / alpha pada hari ini — jam mapel berurutan digabung dalam satu baris">
        {!berhalanganRekap.length ? (
          <Empty icon={UserCheck} title="Semua guru pengampu hadir" desc="Tidak ada sesi dengan guru berhalangan pada tanggal ini." />
        ) : (
          <div className="tbl-wrap max-h-[46vh]">
            <table className="tbl" data-tbl="monitor-berhalangan">
              <thead><tr>
                <th className="w-10 c">No</th><th>Jam</th><th>Kelas</th><th>Mata Pelajaran</th>
                <th>Guru Pengampu</th><th className="c">Status</th><th>Pengganti</th>
              </tr></thead>
              <tbody>
                {berhalanganRekap.map((x, i) => (
                  <tr key={(x.jadwal_ids || [x.jadwal_id]).join(',')} data-berhalangan-slot={x.jadwal_id}
                    data-berhalangan-jadwal-ids={(x.jadwal_ids || [x.jadwal_id]).join(',')}
                    className={x.pengganti ? 'bg-violet-50/40' : 'bg-rose-50/40'}>
                    <td className="c">{i + 1}</td>
                    <td className="whitespace-nowrap">{x.label_sesi}<span className="block text-[10.5px] text-slate-500">{x.jam}</span></td>
                    <td className="font-semibold">{x.kelas_nama || '-'}</td>
                    <td>{x.mapel_kode ? <b className="mr-1 text-teal-700">{x.mapel_kode}</b> : null}{x.mapel_nama || '-'}</td>
                    <td>{x.guru_nama || '-'}</td>
                    <td className="c">
                      <span className={cx('badge', x.status_guru === 'sakit' ? 'badge-pantau' : 'badge-siaga')}>
                        {x.status_guru === 'sakit' ? 'Sakit' : x.status_guru === 'izin' ? 'Izin' : 'Alpha'}
                      </span>
                    </td>
                    <td>
                      {x.pengganti
                        ? <span className="font-semibold text-violet-700">{x.pengganti.ke_nama}</span>
                        : <span className="text-[11.5px] font-bold text-rose-600">Belum ada pengganti</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* per kelas */}
      <Card title="Ringkasan per Kelas" subtitle="Kehadiran guru & kelengkapan jurnal tiap rombel hari ini">
        {!perKelas.length ? <Empty icon={Users} title="Belum ada jadwal" desc="Tidak ada slot jadwal pada tanggal ini." /> : (
          <div className="tbl-wrap max-h-[52vh]">
            <table className="tbl" data-tbl="monitor-kelas">
              <thead><tr>
                <th className="w-10 c">No</th><th>Kelas</th><th className="c">Jam</th>
                <th className="c">Berlangsung</th><th className="c">Selesai</th>
                <th className="c">Guru Hadir</th><th className="c">Belum Check-in</th>
                <th className="c">Berhalangan</th><th className="c">Jurnal</th>
              </tr></thead>
              <tbody>
                {perKelas.map((k, i) => {
                  const jurnalKurang = k.slot > 0 && k.jurnal < k.slot;
                  return (
                    <tr key={k.kelas_id} data-monitor-kelas={k.kelas_id}
                      className={cx(jurnalKurang && 'bg-amber-50/40', k.berhalangan && 'bg-rose-50/40')}>
                      <td className="c">{i + 1}</td>
                      <td className="font-semibold">{k.kelas_nama || '-'}</td>
                      <td className="c">{k.slot}</td>
                      <td className="c">{k.berlangsung ? <span className="badge badge-aman">{k.berlangsung}</span> : '-'}</td>
                      <td className="c">{k.selesai || '-'}</td>
                      <td className="c">{k.hadir}</td>
                      <td className="c">{k.belum_checkin ? <span className="badge badge-pantau">{k.belum_checkin}</span> : 0}</td>
                      <td className="c">{k.berhalangan ? <span className="badge badge-siaga">{k.berhalangan}</span> : 0}</td>
                      <td className="c">
                        <span className={cx('badge', k.jurnal >= k.slot ? 'badge-aman' : 'badge-pantau')}>
                          {k.jurnal}/{k.slot}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* daftar jurnal */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Jurnal Sudah Diisi (${(d?.jurnal?.sudah || []).length})`} subtitle="Sesi dengan jurnal materi lengkap">
          <DaftarJurnal rows={d?.jurnal?.sudah || []} status="sudah" />
        </Card>
        <Card title={`Jurnal Belum Diisi (${(d?.jurnal?.belum || []).length})`} subtitle="Perlu ditindaklanjuti kurikulum">
          <DaftarJurnal rows={d?.jurnal?.belum || []} status="belum" />
        </Card>
      </div>
      <Modal open={!!previewSlot} onClose={tutupPratinjau} title="Pratinjau Rekap KBM" size="xl"
        subtitle={previewData
          ? `${previewData.mapel_nama || previewSlot?.mapel_nama || ''} · ${previewData.kelas_nama || ''} · ${previewData.tanggal_label || ''}`
          : `${previewSlot?.mapel_nama || ''} · ${tgl(d?.tanggal_matriks || tanggalMatriks, { long: true })}`}>
        {previewLoading || !previewData ? <Spinner label="Memuat rekap absensi, jurnal, dan dokumentasi…" /> : (
          <div className="space-y-4" data-monitor-preview-content>
            <p className="text-[12px] text-slate-500">
              Guru: <b className="text-slate-700">{previewData.guru_nama || previewSlot?.guru_efektif_nama || '-'}</b>
            </p>
            {(previewData.slots || []).map(slot => (
              <section key={slot.jadwal_id} className="space-y-3 rounded-xl border border-slate-200 p-3"
                data-monitor-preview-slot={slot.jadwal_id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-bold text-slate-800">
                      {slot.label_sesi} · {slot.jam} · {slot.mapel_kode ? `${slot.mapel_kode} · ` : ''}{slot.mapel_nama}
                    </h3>
                    <p className="text-[11.5px] text-slate-500">{slot.guru_nama || '-'}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ABSENSI_STATUS).map(([kode, label]) => (
                      <span key={kode} className="chip !py-0.5" data-preview-ringkasan={kode}>
                        {label}: {slot.ringkasan?.[kode] || 0}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3" data-preview-jurnal>
                    <h4 className="text-[12px] font-bold text-slate-700">Jurnal Mengajar</h4>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] text-slate-700">{slot.jurnal?.materi || 'Materi tidak dicatat.'}</p>
                    {slot.jurnal?.catatan ? <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-slate-500">{slot.jurnal.catatan}</p> : null}
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3" data-preview-dokumentasi>
                    <h4 className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
                      <ImageIcon size={14} /> Dokumentasi
                    </h4>
                    {slot.dokumentasi?.url ? (
                      <img src={slot.dokumentasi.url} alt={`Dokumentasi ${slot.mapel_nama}`}
                        className="mt-2 max-h-56 w-full rounded-lg border border-slate-200 bg-white object-contain"
                        data-preview-foto />
                    ) : (
                      <p className="mt-1 text-[11.5px] text-slate-500">
                        {slot.dokumentasi?.wajib ? 'Dokumentasi wajib tidak ditemukan.' : 'Tidak ada dokumentasi (opsional).'}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="mb-1 text-[12px] font-bold text-slate-700">
                    Rekap Absensi Siswa ({(slot.absensi_siswa || []).length})
                  </h4>
                  <div className="tbl-wrap max-h-60">
                    <table className="tbl" data-preview-absensi>
                      <thead><tr><th className="w-10 c">No</th><th>Nama Siswa</th><th>Kelas</th><th>Status</th><th>Keterangan</th></tr></thead>
                      <tbody>
                        {(slot.absensi_siswa || []).map(siswa => (
                          <tr key={`${slot.jadwal_id}-${siswa.no}`}>
                            <td className="c">{siswa.no}</td>
                            <td className="font-semibold">{siswa.nama}</td>
                            <td>{siswa.kelas_nama || '-'}</td>
                            <td>{ABSENSI_STATUS[siswa.status] || siswa.status}</td>
                            <td>{siswa.keterangan || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </Modal>
      <Modal open={!!nonaktifTarget} onClose={tutupNonaktifkan}
        title={Array.isArray(nonaktifTarget?.jadwal_ids) ? 'Nonaktifkan KBM Terpilih' : 'Nonaktifkan KBM Reguler'}
        subtitle={nonaktifTarget
          ? Array.isArray(nonaktifTarget.jadwal_ids)
            ? `${nonaktifTarget.jadwal_ids.length} rentang mapel · ${tgl(d?.tanggal_matriks || tanggalMatriks, { long: true })}`
            : `${nonaktifTarget.mapel_nama || ''} · ${nonaktifTarget.kelas_nama || ''} · ${nonaktifTarget.jam || ''} · ${tgl(d?.tanggal_matriks || tanggalMatriks, { long: true })}`
          : ''}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={tutupNonaktifkan} disabled={nonaktifBusy}>Batal</button>
            <button type="button" className="btn-primary" onClick={simpanNonaktifkan}
              disabled={nonaktifBusy || alasanNonaktif.trim().length < 5} data-monitor-nonaktif-simpan>
              {nonaktifBusy ? <Loader2 size={14} className="animate-spin" /> : null}
              Simpan Nonaktif
            </button>
          </>
        }>
        <div className="space-y-2">
          <p className="text-[12px] text-slate-600">
            {Array.isArray(nonaktifTarget?.jadwal_ids)
              ? 'Penonaktifan berlaku untuk seluruh rentang mapel yang dipilih pada tanggal ini. Semua pilihan diproses bersama; jadwal mingguan tidak berubah.'
              : 'Penonaktifan berlaku untuk seluruh rentang mapel ini pada tanggal yang dipilih. Jadwal mingguan tidak berubah dan aktif kembali pada pekan berikutnya.'}
          </p>
          {Array.isArray(nonaktifTarget?.pilihan) ? (
            <ul className="max-h-36 list-disc space-y-1 overflow-auto rounded-lg bg-slate-50 px-8 py-2 text-[11px] text-slate-600"
              data-monitor-nonaktif-ringkasan>
              {nonaktifTarget.pilihan.map(x => (
                <li key={x.jadwal_id}>{x.mapel_nama} · {x.kelas_nama || '-'} · {x.jam || x.label_sesi}</li>
              ))}
            </ul>
          ) : null}
          <label className="block">
            <span className="label">Alasan kegiatan / penonaktifan <b className="text-rose-500">*</b></span>
            <textarea className="input min-h-24 w-full" value={alasanNonaktif}
              onChange={e => setAlasanNonaktif(e.target.value)} minLength={5} maxLength={500}
              placeholder="Contoh: Sosialisasi program sekolah" data-monitor-nonaktif-alasan-input />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function DaftarJurnal({ rows, status }) {
  if (!rows.length) {
    return <Empty icon={status === 'sudah' ? CheckCircle2 : AlertTriangle}
      title={status === 'sudah' ? 'Belum ada jurnal terisi' : 'Semua jurnal sudah diisi'}
      desc={status === 'sudah' ? 'Guru belum mengisi jurnal mengajar pada tanggal ini.' : 'Tidak ada sesi yang tertunda.'} />;
  }
  return (
    <div className="tbl-wrap max-h-[42vh]">
      <table className="tbl" data-tbl={`monitor-jurnal-${status}`}>
        <thead><tr><th>Jam</th><th>Kelas</th><th>Mapel</th><th>Guru</th></tr></thead>
        <tbody>
          {rows.map(x => (
            <tr key={(x.jadwal_ids || [x.jadwal_id]).join(',')} data-jurnal-slot={x.jadwal_id}
              data-jurnal-jadwal-ids={(x.jadwal_ids || [x.jadwal_id]).join(',')}>
              <td className="whitespace-nowrap">{x.label_sesi}<span className="block text-[10.5px] text-slate-500">{x.jam}</span></td>
              <td className="font-semibold">{x.kelas_nama || '-'}</td>
              <td>{x.mapel_kode ? <b className="mr-1 text-teal-700">{x.mapel_kode}</b> : null}{x.mapel_nama || '-'}</td>
              <td className="text-[11.5px]">{x.guru_efektif_nama || x.guru_nama || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
