import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpenCheck, CalendarClock, CheckCircle2, Clock, Loader2, RefreshCw,
  Repeat, UserCheck, UserX, Users
} from 'lucide-react';
import { api, hariIni, tgl } from '../api';
import { Alert, Card, Empty, Spinner, Stat, cx, useToast } from '../ui';

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

export default function MonitorKBM({ ctx }) {
  const { filters, toast } = ctx;
  const [tanggal, setTanggal] = useState(() => hariIni());
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [detik, setDetik] = useState(0);
  const [gridMode, setGridMode] = useState('semua');
  const [gridKelas, setGridKelas] = useState('');
  const [gridGuru, setGridGuru] = useState('');
  const ta = filters?.ta || '';

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api(`/api/monitor-kbm?ta=${encodeURIComponent(ta)}&tanggal=${encodeURIComponent(tanggal)}`)
      .then(r => { setD(r); setDetik(0); })
      .catch(e => { if (!silent) toast.err(e.message); })
      .finally(() => setLoading(false));
  }, [ta, tanggal]);

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
    .sort((a, b) => String(a.mulai).localeCompare(String(b.mulai)) || Number(a.jadwal_id) - Number(b.jadwal_id)),
  [jadwalMonitor, gridMode, gridKelas, gridGuru]);

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
            onChange={e => setTanggal(e.target.value)} data-monitor-tanggal />
          <button className="btn-ghost btn-sm" onClick={() => setTanggal(hariIni())} data-monitor-hari-ini>
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

      <Card title={`Matriks Jadwal Mengajar — ${d?.hari_label || ''}`}
        subtitle={`Status absensi diperbarui otomatis setiap ${REFRESH_MS / 1000} detik. Tanggal: ${tgl(d?.tanggal, { long: true })}`}
        right={<div className="flex flex-wrap gap-1.5">
          <select className="input !w-auto !py-1.5 text-[11.5px]" value={gridMode}
            onChange={e => setGridMode(e.target.value)} data-monitor-grid-mode>
            <option value="semua">Semua kelas</option>
            <option value="kelas">Pilih kelas</option>
            <option value="guru">Per guru</option>
          </select>
          {gridMode === 'kelas' ? (
            <select className="input !w-auto !py-1.5 text-[11.5px]" value={gridKelas}
              onChange={e => setGridKelas(e.target.value)} data-monitor-grid-kelas>
              {kelasMonitor.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          ) : null}
          {gridMode === 'guru' ? (
            <select className="input !w-auto !py-1.5 text-[11.5px]" value={gridGuru}
              onChange={e => setGridGuru(e.target.value)} data-monitor-grid-guru>
              <option value="">Semua guru</option>
              {guruMonitor.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
            </select>
          ) : null}
        </div>}>
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
                {barisGrid.map(x => (
                  <tr key={x.jadwal_id} data-monitor-jadwal={x.jadwal_id}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-white text-center">
                      <b>{x.label_sesi}</b><span className="block text-[10.5px] text-slate-500">{x.jam}</span>
                    </td>
                    {kolomKelas.map(k => {
                      if (!(x.kelas_ids || []).some(id => Number(id) === Number(k.id))) {
                        return <td key={k.id} className="text-center text-slate-300">—</td>;
                      }
                      const statusTone = ['hadir', 'sedang berlangsung'].includes(String(x.status_label).toLowerCase())
                        ? 'badge-aman'
                        : ['sakit'].includes(String(x.status_label).toLowerCase()) ? 'badge-perhatian'
                          : ['izin', 'akan datang'].includes(String(x.status_label).toLowerCase()) ? 'badge-pantau'
                            : ['alpha', 'belum check-in'].includes(String(x.status_label).toLowerCase()) ? 'badge-siaga'
                              : 'badge-netral';
                      return (
                        <td key={k.id} className="text-center align-middle">
                          <div className="mx-auto max-w-[220px] rounded-lg border border-slate-200 bg-white p-2 text-center">
                            <p className="text-[11.5px] font-extrabold text-slate-800">{x.mapel_kode ? `${x.mapel_kode} · ` : ''}{x.mapel_nama}</p>
                            <p className="mt-0.5 truncate text-[10.5px] text-slate-500">{x.guru_efektif_nama || x.guru_nama || '-'}</p>
                            <span className={cx('badge mt-1', statusTone)} data-monitor-grid-status={x.jadwal_id}>
                              {x.status_label}
                            </span>
                            {x.status_detail ? <span className="ml-1 text-[10px] capitalize text-slate-500">{x.status_detail}</span> : null}
                            {x.pengganti ? <p className="mt-1 text-[10px] font-semibold text-violet-700">
                              {x.pengganti.jenis === 'penugasan' ? 'Guru piket/pengganti' : 'Tukar jadwal'}
                            </p> : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
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
      <Card title={`Guru Berhalangan & Pengganti (${(d?.berhalangan || []).length})`}
        subtitle="Izin / sakit / alpha pada hari ini — termasuk yang sudah ditunjuk guru piket">
        {!(d?.berhalangan || []).length ? (
          <Empty icon={UserCheck} title="Semua guru pengampu hadir" desc="Tidak ada sesi dengan guru berhalangan pada tanggal ini." />
        ) : (
          <div className="tbl-wrap max-h-[46vh]">
            <table className="tbl" data-tbl="monitor-berhalangan">
              <thead><tr>
                <th className="w-10 c">No</th><th>Jam</th><th>Kelas</th><th>Mata Pelajaran</th>
                <th>Guru Pengampu</th><th className="c">Status</th><th>Pengganti</th>
              </tr></thead>
              <tbody>
                {(d.berhalangan || []).map((x, i) => (
                  <tr key={x.jadwal_id} data-berhalangan-slot={x.jadwal_id} className={x.pengganti ? 'bg-violet-50/40' : 'bg-rose-50/40'}>
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
            <tr key={x.jadwal_id} data-jurnal-slot={x.jadwal_id}>
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
