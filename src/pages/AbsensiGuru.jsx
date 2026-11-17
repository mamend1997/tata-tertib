import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CalendarClock, CalendarDays, Camera, CheckCircle2, Circle, Clock, Loader2, Lock, RefreshCw, Repeat,
  Send, ShieldCheck, Stethoscope, Timer, UserCheck, UserRoundX, Users, XCircle
} from 'lucide-react';
import { api, compressImage, hariIni } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';
import AbsensiKelas from '../components/AbsensiKelas';

const STATUS_TONE = {
  hadir: 'badge-aman', izin: 'badge-pantau', sakit: 'badge-perhatian', alpha: 'badge-siaga', belum: 'badge-netral'
};
const STATUS_LABEL = { hadir: 'Hadir', izin: 'Izin', sakit: 'Sakit', alpha: 'Alpha', belum: 'Belum Absen', sebagian: 'Sebagian' };
const RINGKAS_TONE = { Hadir: 'aman', Izin: 'pantau', Sakit: 'perhatian', Alpha: 'siaga', 'Belum Absen': 'netral', Sebagian: 'kritis' };

/** hitung mundur: countdown {arah,detik} dari server + waktu muat data */
function sisaDetik(cd, dimuat, tick) {
  if (!cd || !cd.detik) return '';
  const acuan = Number(dimuat) || Date.now();
  const sisa = Math.max(0, Math.round((acuan + cd.detik * 1000 - Date.now()) / 1000));
  if (sisa <= 0) return cd.arah === 'buka' ? 'Waktu buka telah tiba — muat ulang' : 'Sesi berakhir';
  const j = Math.floor(sisa / 3600), m = Math.floor((sisa % 3600) / 60), d = sisa % 60;
  const teks = j ? `${j}j ${m}m` : `${m}m ${String(d).padStart(2, '0')}d`;
  return cd.arah === 'buka' ? `Belum waktunya — dibuka dalam ${teks}` : `Sesi berakhir dalam ${teks}`;
}

const jamLengkap = (stamp) => {
  const s = String(stamp || '');
  return s ? s.slice(11, 19) || s.slice(11, 16) : '-';
};

export default function AbsensiGuru({ ctx }) {
  const { can, toast, filters } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tanggal, setTanggal] = useState(() => hariIni());
  const [guruId, setGuruId] = useState('');
  const [jurnal, setJurnal] = useState(null);     // slot untuk modal jurnal & foto
  const [alasan, setAlasan] = useState(null);     // { slot, status }
  const [busyId, setBusyId] = useState(0);
  const [waOpen, setWaOpen] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [waInfo, setWaInfo] = useState(null);
  const [tukarSlot, setTukarSlot] = useState(null);   // slot untuk modal tukar jadwal
  const [tukarBusy, setTukarBusy] = useState(0);
  /* JADWAL MENGAJAR SAYA (hari ini + hari berikutnya) + hitung mundur */
  const [agenda, setAgenda] = useState(null);
  const [agendaLoad, setAgendaLoad] = useState(true);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ tanggal });
    if (guruId) qs.set('guru', guruId);
    if (filters?.ta) qs.set('ta', String(filters.ta));
    api('/api/absensi-guru?' + qs.toString())
      .then(setData).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [tanggal, guruId, filters?.ta]);
  useEffect(load, [load]);

  const loadAgenda = useCallback(() => {
    setAgendaLoad(true);
    const qs = new URLSearchParams({ hari: '7' });
    if (guruId) qs.set('guru', guruId);
    if (filters?.ta) qs.set('ta', String(filters.ta));
    api('/api/absensi-guru/jadwal-mengajar?' + qs.toString())
      .then(r => setAgenda({ ...r, dimuat: Date.now() }))
      .catch(() => setAgenda(null))
      .finally(() => setAgendaLoad(false));
  }, [guruId, filters?.ta]);
  useEffect(loadAgenda, [loadAgenda]);
  /* ticker 1 detik untuk hitung mundur buka/tutup sesi */
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const jadwal = data?.jadwal || [];
  const jadwalTampil = useMemo(() => {
    const seen = new Set();
    return jadwal.filter(j => {
      const ids = (j.group_ids || [j.id]).map(Number);
      const key = ids.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(j => ({
      ...j,
      jam: j.group_jam || j.jam,
      group_ids: (j.group_ids || [j.id]).map(Number)
    }));
  }, [jadwal]);
  const rekap = data?.rekap;
  /* Admin/kepala sekolah may view the whole agenda; other roles see their own slots. */
  const agendaSemua = !!(agenda?.lihat_semua && !agenda?.target_guru);
  const agendaTampil = useMemo(() => (agenda?.hari || []).map(h => {
    const seen = new Set();
    const slots = h.slots.filter(sl => {
      const key = (sl.group_ids || [sl.jadwal_id]).map(Number).join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(sl => ({ ...sl, jam: sl.group_jam || sl.jam }));
    return { ...h, slots };
  }), [agenda]);
  const sudah = jadwalTampil.filter(j => j.absensi).length;
  const belum = jadwalTampil.length - sudah;
  const autoAktif = !!(data?.auto_alpha && data.auto_alpha.aktif);

  async function checkin(slot, status, catatan) {
    setBusyId(slot.id);
    try {
      const r = await api('/api/absensi-guru/checkin', {
        method: 'POST', body: { jadwal_id: slot.id, tanggal, status, catatan: catatan || '' }
      });
      toast.ok(r.pesan || 'Absensi tercatat.');
      setAlasan(null);
      load();
      loadAgenda();
      /* setelah hadir → buka panduan alur: absensi siswa → jurnal → foto */
      if (status === 'hadir') setJurnal({ slot: { ...slot, absensi: { status: 'hadir', waktu_submit: r.waktu_submit } } });
    } catch (e) { toast.err(e.message); }
    finally { setBusyId(0); }
  }

  async function bukaWa() {
    setWaOpen(true); setWaBusy(true); setWaInfo(null);
    try { setWaInfo(await api(`/api/absensi-guru/rekap-wa/preview?tanggal=${tanggal}`)); }
    catch (e) { toast.err(e.message); }
    finally { setWaBusy(false); }
  }
  async function putusTukar(row, aksi) {
    setTukarBusy(row.id);
    try {
      const r = await api('/api/tukar-jadwal/putus', { method: 'POST', body: { id: row.id, aksi } });
      toast.ok(r.pesan || 'Permintaan diproses.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setTukarBusy(0); }
  }
  async function kirimWa() {
    setWaBusy(true);
    try {
      const r = await api('/api/absensi-guru/rekap-wa', { method: 'POST', body: { tanggal } });
      toast.ok(`Rekap dikirim ke ${r.nomor.length} nomor (${r.hasil.map(h => h.status).join(', ')}).`);
      setWaInfo(v => ({ ...(v || {}), pesan: r.pesan, hasil: r.hasil, tautan: r.tautan }));
      load();
    } catch (e) { toast.err(e.message); } finally { setWaBusy(false); }
  }

  if (loading && !data) return <Spinner label="Memuat absensi guru…" />;

  return (
    <div className="space-y-4" data-page="absensi-guru">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800" data-tour-id="btn-jurnal-mengajar">Absensi Guru Mengajar</h2>
          <p className="text-[12.5px] text-slate-500">
            Tombol Check-in / Sakit / Izin hanya aktif selama jam pelajaran berlangsung. Tanpa check-in sampai jam
            berakhir, status guru otomatis tercatat <b>ALFA</b> dan terkunci.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input !w-auto" value={tanggal} max={hariIni()}
            onChange={e => setTanggal(e.target.value)} data-tanggal-absensi />
          {data?.lihat_semua ? (
            <select className="input !w-auto min-w-[190px]" value={guruId} onChange={e => setGuruId(e.target.value)}>
              <option value="">Semua guru (rekap)</option>
              {data.guru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
            </select>
          ) : null}
          {can('absensi_guru', 'write') ? (
            <button className="btn-ghost" onClick={bukaWa} data-rekap-wa><Send size={15} /> Rekap WA</button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Mapel Hari Ini" value={jadwalTampil.length} sub={data?.tanggal_label} icon={CalendarClock} tone="sky" />
        <Stat label="Sudah Diabsen" value={sudah} sub="check-in / sakit / izin" icon={CheckCircle2} tone="emerald" />
        <Stat label="Belum Diabsen" value={belum} sub="menunggu jam pelajaran" icon={Clock} tone="orange" />
        <Stat label="Guru Hadir" value={rekap?.hitung?.hadir ?? 0}
          sub={`${rekap?.hitung?.izin ?? 0} izin · ${rekap?.hitung?.sakit ?? 0} sakit · ${(rekap?.hitung?.alpha ?? 0) + (rekap?.hitung?.belum ?? 0) + (rekap?.hitung?.sebagian ?? 0)} alfa/belum`}
          icon={UserCheck} tone="violet" />
      </div>

      {data?.auto_alpha ? (
        <div className={cx('rounded-xl border px-3 py-2 text-[12px] font-semibold',
          autoAktif ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-600')} data-info-auto-alfa>
          {autoAktif
            ? <>ALFA otomatis aktif — guru yang tidak check-in hingga jam pelajaran berakhir dicatat <b>Tidak Hadir (Alfa)</b> dan terkunci.{data.auto_alpha.dibuat ? ` ${data.auto_alpha.dibuat} slot baru ditandai alfa.` : ''}</>
            : <>ALFA otomatis sedang dinonaktifkan oleh sekolah (Pengaturan → Pengaturan Jadwal).</>}
        </div>
      ) : null}

      {data?.config && !data.config.gateway_aktif ? (
        <Alert tone="warn" title="Gateway WhatsApp belum aktif">
          Rekap akan tercatat sebagai riwayat dan dapat dibuka lewat tautan wa.me. Aktifkan gateway di
          <b> Pengaturan → WhatsApp Gateway</b> agar terkirim otomatis ke Kepala Sekolah &amp; Wakasek Kurikulum.
        </Alert>
      ) : null}

      {/* ============ JADWAL MENGAJAR (HARI INI & HARI BERIKUTNYA) ============ */}
      <Card title={agendaSemua
        ? 'Jadwal Mengajar Seluruh Guru — Hari Ini & Hari Berikutnya'
        : 'Jadwal Mengajar Saya — Hari Ini & Hari Berikutnya'}
        subtitle={agendaSemua
          ? 'Jadwal seluruh guru hanya untuk dilihat. Aksi absensi hanya dapat dilakukan guru pemilik sesi atau admin.'
          : 'Seluruh sesi yang Anda ampu tetap tampil (termasuk hari esok). Tombol aksi hanya aktif pada hari-H saat jam pelajaran berlangsung.'}
        right={<div className="flex items-center gap-2">
          <span className="chip"><CalendarDays size={12} /> {agenda?.jumlah_hari || 7} hari</span>
          <button className="btn-ghost btn-sm" onClick={loadAgenda} data-agenda-muat><RefreshCw size={13} /> Muat</button>
        </div>}>
        {agendaLoad && !agenda ? <Spinner label="Menyusun jadwal mengajar…" /> : !(agenda?.hari || []).length ? (
          <Empty icon={CalendarClock} title="Belum ada jadwal" desc="Belum ada slot jadwal mengajar untuk akun Anda pada sepekan ke depan." />
        ) : (
          <div className="space-y-3" data-agenda-jadwal>
            {agendaTampil.map(h => (
              <div key={h.tanggal} className={cx('rounded-xl border p-2.5',
                h.hari_ini ? 'border-orange-300 bg-orange-50/50' : 'border-slate-200 bg-white')}>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-bold text-slate-800">
                    {h.tanggal_label}
                    {h.hari_ini ? <span className="ml-1.5 badge badge-aman">Hari ini</span>
                      : <span className="ml-1.5 badge badge-netral">{h.offset === 1 ? 'Besok' : `${h.offset} hari lagi`}</span>}
                  </p>
                  <span className="text-[11px] text-slate-500">{h.slots.length} sesi</span>
                </div>
                <div className="space-y-1.5">
                  {h.slots.map(sl => {
                    const sisa = sisaDetik(sl.countdown, agenda?.dimuat, tick);
                    const aktif = h.hari_ini && sl.window?.aktif && sl.window?.hari_ok;
                    /* Server determines ownership and permission; do not rely on time alone. */
                    const tombolSiap = (sl.bisa_checkin !== undefined ? !!sl.bisa_checkin : (aktif && !sl.status_absensi));
                    const bukanMilik = !sl.milik_saya;
                    return (
                      <div key={sl.jadwal_id} data-agenda-slot={sl.jadwal_id}
                        className={cx('flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5',
                          aktif ? 'border-emerald-200 bg-white' : 'border-slate-100 bg-slate-50/60')}>
                        <span className="w-[104px] shrink-0 text-[11px] font-semibold text-slate-500">
                          {sl.label_sesi}<br /><span className="font-normal">{sl.jam}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-bold text-slate-800">{sl.mapel_nama || '-'}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {sl.kelas_nama}{sl.tukar ? ` · pengganti ${sl.tukar.dari_nama ? `dari ${sl.tukar.dari_nama}` : ''}` : ''}
                            {agendaSemua && bukanMilik ? ` · ${sl.guru_efektif_nama || 'guru lain'}` : ''}
                          </span>
                        </span>
                        <span className={cx('badge shrink-0',
                          sl.status_absensi === 'hadir' ? 'badge-aman'
                            : sl.status_absensi === 'izin' ? 'badge-pantau'
                              : sl.status_absensi === 'sakit' ? 'badge-perhatian'
                                : sl.status_absensi === 'alpha' ? 'badge-siaga'
                                  : aktif ? 'badge-aman' : 'badge-netral')}>
                          {sl.status_absensi ? (STATUS_LABEL[sl.status_absensi] || sl.status_absensi)
                            : aktif ? 'Siap diisi' : (h.hari_ini ? 'Terkunci' : 'Hari-H')}
                        </span>
                        {tombolSiap ? (
                          <button className="btn-sm bg-emerald-600 text-white" disabled={busyId === sl.jadwal_id}
                            onClick={() => checkin({ ...sl, id: sl.jadwal_id }, 'hadir')} data-agenda-checkin={sl.jadwal_id}>
                            {busyId === sl.jadwal_id ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />} Check-in
                          </button>
                        ) : (
                          <button className="btn-sm cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                            disabled
                            title={sl.tukar?.jenis === 'penugasan'
                              ? 'Isi absensi siswa pada menu Guru Piket & Pengganti; kehadiran tercatat otomatis setelah presensi lengkap.'
                              : !sl.bisa_checkin && !sl.status_absensi && aktif && bukanMilik && !agenda?.target_guru
                              ? 'Hanya guru pemilik sesi atau admin yang dapat check-in.'
                              : sl.alasan_singkat}
                            data-agenda-terkunci={sl.jadwal_id}>
                            <Lock size={12} /> {sl.tukar?.jenis === 'penugasan' ? 'Guru Pengganti'
                              : !sl.bisa_checkin && !sl.status_absensi && aktif && bukanMilik && !agenda?.target_guru ? 'Sesi guru lain' : 'Nonaktif'}
                          </button>
                        )}
                        <span className={cx('w-full text-[10.5px] sm:w-auto sm:pl-1',
                          aktif ? 'text-emerald-700' : 'text-slate-500')}>
                          {sisa ? <><Timer size={10} className="mr-1 inline align-[-1px]" />{sisa}</> : sl.alasan_singkat}
                        </span>
                        {sl.bisa_rencana_tukar ? (
                          <button type="button" className="btn-ghost btn-sm"
                            onClick={() => setTukarSlot({ ...sl, id: sl.jadwal_id, tanggal: h.tanggal })}
                            data-tukar-hari={sl.jadwal_id}>
                            <Repeat size={12} /> Rencana Tukar Jadwal
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Jadwal Mengajar — ${data?.tanggal_label || ''}`}
        subtitle={data?.lihat_semua
          ? 'Seluruh jadwal dapat dilihat; aksi absensi hanya tersedia untuk guru pemilik sesi atau admin.'
          : 'Slot di bawah adalah jadwal mengajar Anda pada tanggal ini.'}>
        {!jadwal.length ? (
          <Empty icon={CalendarClock} title="Tidak ada jadwal mengajar" desc={data?.lihat_semua ? 'Belum ada slot jadwal pada tanggal ini.' : 'Belum ada slot jadwal untuk Anda pada tanggal ini. Hubungi Wakasek Kurikulum bila jadwal belum diatur.'} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {jadwalTampil.map((j, index) => {
              const a = j.absensi;
              const tone = a ? STATUS_TONE[a.status] : 'badge-netral';
              const bisa = !!j.bisa_checkin;
              const penugasan = j.tukar?.jenis === 'penugasan';
              return (
                <div key={j.id} className={cx('flex flex-col rounded-xl border p-3 transition',
                  a ? 'border-emerald-200 bg-emerald-50/40' : j.window.aktif ? 'border-orange-200 bg-orange-50/40' : 'border-slate-200')}
                  data-slot-absensi={j.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-slate-800">{j.mapel_nama || 'Mata pelajaran'}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                        {j.kelas_nama} · {j.ruang || 'ruang belum diisi'}
                        {data?.lihat_semua && !j.milik_saya && j.guru_efektif_nama ? ` · ${j.guru_efektif_nama}` : ''}
                      </p>
                    </div>
                    <span className={cx('badge shrink-0', tone)} data-status-slot={j.id}>
                      {a ? STATUS_LABEL[a.status] || a.status
                        : j.tukar?.jenis === 'penugasan' ? 'Digantikan' : 'Belum Absen'}
                    </span>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
                    <Clock size={12} /> {j.group_label || `Jam ${j.jam_no || '-'}`} · {j.jam}
                  </p>
                  <p className={cx('mt-1 flex items-start gap-1.5 text-[11px]',
                    j.window.aktif ? 'text-emerald-700' : (j.window.terkunci ? 'font-semibold text-amber-700' : 'text-slate-500'))}>
                    {j.window.aktif ? <CheckCircle2 size={12} className="mt-0.5" /> : (j.window.terkunci ? <Lock size={12} className="mt-0.5" /> : <XCircle size={12} className="mt-0.5" />)}
                    {j.window.aktif ? `Jendela absensi dibuka (${j.window.buka}–${j.window.tutup})` : j.window.alasan}
                  </p>

                  {a ? (
                    <div className="mt-2 rounded-lg bg-white/80 p-2 text-[11.5px] text-slate-600 ring-1 ring-slate-100">
                      <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                        {j.via_checkin ? <Lock size={11} /> : null} Check-in {jamLengkap(a.waktu_submit)}
                      </p>
                      <p className="mt-0.5 line-clamp-2"><b>Jurnal:</b> {a.materi || a.catatan || '-'}</p>
                      {a.foto_url ? <img src={a.foto_url} alt="Bukti" className="mt-1 h-16 w-full rounded object-cover" loading="lazy" /> : null}
                    </div>
                  ) : null}

                  {penugasan ? (
                    <p className="mt-2 rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-2 text-[11px] font-medium text-violet-800">
                      Isi absensi siswa dan jurnal pada menu Guru Piket & Pengganti. Kehadiran tercatat otomatis setelah presensi lengkap.
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                        <button type="button" disabled={!bisa || busyId === j.id}
                          onClick={() => checkin(j, 'hadir')}
                          className={cx('btn btn-sm justify-center', bisa ? 'bg-emerald-600 text-white hover:brightness-95' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                          data-checkin={j.id} data-tour-id={index === 0 ? 'btn-checkin-guru' : undefined}>
                          {busyId === j.id ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} Check-in Hadir
                        </button>
                        <button type="button" disabled={!bisa || busyId === j.id}
                          onClick={() => setAlasan({ slot: j, status: 'sakit' })}
                          className={cx('btn btn-sm justify-center', bisa ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                          data-sakit={j.id}>
                          <Stethoscope size={13} /> Sakit
                        </button>
                        <button type="button" disabled={!bisa || busyId === j.id}
                          onClick={() => setAlasan({ slot: j, status: 'izin' })}
                          className={cx('btn btn-sm justify-center', bisa ? 'border border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100' : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                          data-izin={j.id}>
                          <UserRoundX size={13} /> Izin
                        </button>
                      </div>
                      {a ? (
                        <button className={cx('btn-sm mt-1.5 justify-center',
                          !j.bisa_jurnal ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                            : j.alur && j.alur.selesai ? 'btn-ghost' : 'btn-soft')}
                            disabled={!j.bisa_jurnal}
                            title={!j.bisa_jurnal ? 'Hanya guru pemilik sesi atau admin yang dapat melengkapi jurnal.' : undefined}
                            onClick={() => setJurnal({ slot: j })} data-jurnal={j.id}>
                          {j.alur && j.alur.selesai ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                          {j.alur && j.alur.selesai ? 'Laporan lengkap' : 'Lanjutkan: Absensi → Jurnal → Foto'}
                        </button>
                      ) : !j.window.aktif ? (
                        <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-400">
                          <Lock size={11} /> Tombol terkunci{autoAktif ? ' · akan tercatat ALFA otomatis' : ''}
                        </p>
                      ) : null}
                    </>
                  )}

                  {/* Tukar posisi mapel dan jadwal dengan guru lain pada pekan ini. */}
                  {j.tukar ? (
                    <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-violet-50 px-2 py-1.5 text-[11px] font-semibold text-violet-800" data-tukar-aktif={j.id}>
                      <Repeat size={12} />
                      {j.tukar.jenis === 'penugasan'
                        ? <>Slot ditugaskan kepada <b>{j.tukar.ke_nama}</b>. Absensi siswa dan jurnal diisi melalui menu Guru Piket & Pengganti.</>
                        : Number(j.tukar.ke_guru) === Number(data?.saya?.id)
                        ? <>Sesi pengganti dari <b>{j.tukar.dari_nama}</b> (tukar jadwal pekan ini)</>
                        : <>Ditukar ke <b>{j.tukar.ke_nama}</b> untuk pekan ini</>}
                    </p>
                  ) : j.milik_saya ? (
                    <button type="button" disabled={!j.bisa_tukar || busyId === j.id}
                      onClick={() => setTukarSlot(j)}
                      className={cx('btn btn-sm mt-1.5 w-full justify-center',
                        j.bisa_tukar ? 'border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100'
                          : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400')}
                      title={j.bisa_tukar
                        ? 'Tukar posisi jadwal dengan guru lain pada kelas ini'
                        : (j.window?.terkunci
                          ? 'Terkunci — jam pelajaran sesi ini sudah berakhir, tukar jadwal tidak dapat diajukan lagi'
                          : 'Tukar jadwal hanya dapat diajukan sebelum check-in pada hari sesi ini')}
                      data-tukar={j.id}>
                      <Repeat size={13} /> Tukar Jadwal
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* permintaan tukar jadwal: masuk (butuh jawaban) & riwayat pengajuan saya */}
      <Card title="Permintaan Tukar Jadwal Masuk"
        subtitle="Guru lain mengajukan pertukaran dua arah untuk pekan ini — terima agar kedua guru saling bertukar mapel dan posisi jadwal."
        right={<span className="chip" data-tukar-jumlah>{(data?.tukar_masuk || []).length} permintaan</span>}>
        {!(data?.tukar_masuk || []).length ? (
          <p className="text-[12.5px] text-slate-500" data-tukar-kosong>Tidak ada permintaan tukar jadwal yang menunggu jawaban.</p>
        ) : (
          <div className="space-y-2">
            {data.tukar_masuk.map(t => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3" data-tukar-masuk={t.id}>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-800">{t.dari_nama} → Anda</p>
                  <p className="text-[11.5px] text-slate-600">
                    {t.mapel_nama || 'Mapel'} · {t.kelas_nama || '-'} · sesi {t.sesi} · {t.tanggal}
                  </p>
                  {t.alasan ? <p className="text-[11px] italic text-slate-500">“{t.alasan}”</p> : null}
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
        )}
        {(data?.tukar_keluar || []).length ? (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Pengajuan saya</p>
            <div className="tbl-wrap max-h-[240px]">
              <table className="tbl" data-tbl-tukar-keluar>
                <thead><tr><th>Tanggal</th><th>Mapel</th><th>Kelas</th><th>Guru Tujuan</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                  {data.tukar_keluar.map(t => (
                    <tr key={t.id}>
                      <td>{t.tanggal}</td>
                      <td>{t.mapel_nama || '-'}</td>
                      <td>{t.kelas_nama || '-'}</td>
                      <td>{t.ke_nama}</td>
                      <td>
                        <span className={cx('badge', t.status === 'diterima' ? 'badge-aman'
                          : t.status === 'pending' ? 'badge-pantau'
                            : t.status === 'ditolak' ? 'badge-siaga' : 'badge-netral')}>
                          {t.status === 'diterima' ? 'Diterima' : t.status === 'pending' ? 'Menunggu' : t.status === 'ditolak' ? 'Ditolak' : 'Dibatalkan'}
                        </span>
                      </td>
                      <td>
                        {t.status === 'pending' ? (
                          <button className="btn-ghost btn-sm" disabled={tukarBusy === t.id}
                            onClick={() => putusTukar(t, 'batal')} data-tukar-batal={t.id}>Batalkan</button>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Card>

      {rekap?.rows?.length ? (
        <Card title="Rekap Kehadiran Guru Hari Ini" subtitle={`${rekap.guru} guru · ${rekap.jadwal} mapel/hari`}>
          <div className="tbl-wrap max-h-[420px]">
            <table className="tbl">
              <thead><tr><th>Guru</th><th className="text-center">Mapel/Hari</th><th className="text-center">Hadir</th><th className="text-center">Izin</th><th className="text-center">Sakit</th><th className="text-center">Alpha</th><th>Status Hari Ini</th></tr></thead>
              <tbody>
                {rekap.rows.map(g => (
                  <tr key={g.guru_id}>
                    <td className="font-semibold">{g.nama}</td>
                    <td className="text-center">{g.jadwal}</td>
                    <td className="text-center text-emerald-700">{g.hadir}</td>
                    <td className="text-center text-sky-700">{g.izin}</td>
                    <td className="text-center text-amber-700">{g.sakit}</td>
                    <td className="text-center text-rose-700">{g.alpha + g.belum}</td>
                    <td><span className={cx('badge', 'badge-' + (RINGKAS_TONE[g.ringkas] || 'netral'))}>{g.ringkas}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <ModalJurnal open={!!jurnal} slot={jurnal?.slot} cfg={data?.config} tanggal={tanggal} user={data?.saya}
        onClose={() => setJurnal(null)} onSaved={() => { setJurnal(null); load(); }} />

      {/* alasan sakit / izin */}
      <ModalAlasan open={!!alasan} data={alasan} busy={busyId > 0}
        onClose={() => setAlasan(null)} onSubmit={(catatan) => checkin(alasan.slot, alasan.status, catatan)} />

      <ModalTukar open={!!tukarSlot} slot={tukarSlot} tanggal={tukarSlot?.tanggal || tanggal}
        onClose={() => setTukarSlot(null)} onSaved={() => { setTukarSlot(null); load(); }} />

      <Modal open={waOpen} onClose={() => setWaOpen(false)} title="Rekap Absensi Guru via WhatsApp" size="md"
        subtitle={waInfo ? 'Pratinjau pesan yang akan dikirim ke Kepala Sekolah & Wakasek Kurikulum.' : ''}
        footer={<>
          <button className="btn-ghost" onClick={() => setWaOpen(false)}>Tutup</button>
          {can('absensi_guru', 'write') ? <button className="btn-primary" disabled={waBusy} onClick={kirimWa} data-kirim-wa>{waBusy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Kirim Sekarang</button> : null}
        </>}>
        {waBusy && !waInfo ? <Spinner label="Menyiapkan rekap…" /> : waInfo ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[12px]">
              <span className="chip">Kepala Sekolah: {waInfo.nomor.kepsek || 'belum diisi'}</span>
              <span className="chip">Wakasek Kurikulum: {waInfo.nomor.wakasek || 'belum diisi'}</span>
              <span className={cx('chip', waInfo.gateway_aktif ? '!border-emerald-200 !bg-emerald-50 !text-emerald-700' : '!border-amber-200 !bg-amber-50 !text-amber-700')}>
                {waInfo.gateway_aktif ? 'Gateway aktif' : 'Gateway belum aktif'}
              </span>
            </div>
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">{waInfo.pesan}</pre>
            {waInfo.tautan?.length ? (
              <div className="space-y-1">
                {waInfo.tautan.map(t => (
                  <a key={t.phone} href={t.url} target="_blank" rel="noreferrer" className="block truncate text-[12px] font-semibold text-emerald-700 hover:underline">
                    Buka WhatsApp → {t.phone}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ---------------- item langkah alur kerja ---------------- */
function LangkahAlur({ no, selesai, judul, ket, aksi }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-extrabold',
        selesai ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600')}>
        {selesai ? <CheckCircle2 size={13} /> : no}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block text-[12.5px] font-bold', selesai ? 'text-emerald-800' : 'text-slate-800')}>{judul}</span>
        <span className="block text-[11px] text-slate-500">{ket}</span>
      </span>
      {aksi}
    </li>
  );
}

/* ---------------- modal alasan sakit / izin ---------------- */
function ModalAlasan({ open, data, busy, onClose, onSubmit }) {
  const [catatan, setCatatan] = useState('');
  useEffect(() => { if (open) setCatatan(''); }, [open, data]);
  const status = data?.status || 'izin';
  return (
    <Modal open={open} onClose={onClose} size="sm"
      title={status === 'sakit' ? 'Tandai Sakit' : 'Tandai Izin'}
      subtitle={data?.slot ? `${data.slot.mapel_nama} · ${data.slot.kelas_nama} · ${data.slot.jam}` : ''}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn-primary" disabled={busy || catatan.trim().length < 5} onClick={() => onSubmit(catatan)} data-simpan-alasan>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Simpan Status
        </button>
      </>}>
      <Field label="Alasan / Keterangan" required hint="Minimal 5 karakter. Status langsung terkunci setelah disimpan.">
        <textarea className="input" rows={3} value={catatan} onChange={e => setCatatan(e.target.value)}
          placeholder={status === 'sakit' ? 'mis. sakit demam, ada surat dokter…' : 'mis. menghadiri undangan dinas…'} data-alasan />
      </Field>
    </Modal>
  );
}

/* ---------------- modal tukar jadwal mengajar ---------------- */
function ModalTukar({ open, slot, tanggal, onClose, onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tanggalTujuan, setTanggalTujuan] = useState('');
  const [guruId, setGuruId] = useState('');
  const [mapelId, setMapelId] = useState('');
  const [alasan, setAlasan] = useState('');
  const [alasanJenis, setAlasanJenis] = useState('lainnya');
  const [modeTukar, setModeTukar] = useState('hari_sama');
  const [busy, setBusy] = useState(false);
  const lintasHari = modeTukar === 'lintas_hari';

  useEffect(() => {
    if (!open || !slot?.id) return;
    setLoading(true); setData(null); setTanggalTujuan(''); setGuruId(''); setMapelId(''); setAlasan('');
    const defaultMode = tanggal > hariIni() ? 'lintas_hari' : 'hari_sama';
    setModeTukar(defaultMode);
    setAlasanJenis(defaultMode === 'lintas_hari' ? 'sakit' : 'lainnya');
  }, [open, slot?.id, tanggal]);

  useEffect(() => {
    if (!open || !slot?.id) return;
    const jenis = lintasHari ? 'sakit' : 'lainnya';
    setLoading(true); setData(null); setGuruId(''); setMapelId('');
    let active = true;
    api(`/api/tukar-jadwal/kandidat?jadwal_id=${slot.id}&tanggal=${tanggal}&alasan_jenis=${jenis}`)
      .then(r => { if (active) setData(r); })
      .catch(e => { if (active) toast.err(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, slot?.id, tanggal, lintasHari]);

  const tanggalOpsi = lintasHari
    ? [...new Set((data?.kandidat || []).flatMap(k => (k.mapel || []).map(m => m.tanggal)).filter(Boolean))].sort()
    : [];
  useEffect(() => {
    if (!lintasHari) {
      setTanggalTujuan('');
      return;
    }
    if (!tanggalOpsi.includes(tanggalTujuan)) {
      setTanggalTujuan(tanggalOpsi[0] || '');
      setGuruId('');
      setMapelId('');
    }
  }, [data, lintasHari]);

  const kandidatSemua = data?.kandidat || [];
  const kandidat = lintasHari
    ? kandidatSemua.filter(k => (k.mapel || []).some(m => m.tanggal === tanggalTujuan))
    : kandidatSemua;
  const pilih = kandidat.find(k => Number(k.id) === Number(guruId)) || null;
  const mapelOpsi = lintasHari
    ? (pilih?.mapel || []).filter(m => m.tanggal === tanggalTujuan)
    : (pilih?.mapel || []);
  useEffect(() => {
    if (!mapelOpsi.length) { setMapelId(''); return; }
    const keyOf = m => lintasHari ? `${m.tanggal}:${m.jadwal_id}` : String(m.id);
    if (!mapelOpsi.some(m => keyOf(m) === mapelId)) setMapelId(keyOf(mapelOpsi[0]));
  }, [guruId, data, tanggalTujuan, lintasHari]);
  const mapelTerpilih = mapelOpsi.find(m => (lintasHari
    ? `${m.tanggal}:${m.jadwal_id}` === mapelId
    : String(m.id) === mapelId)) || null;

  async function kirim() {
    if (!guruId) return toast.err('Pilih guru pengganti terlebih dahulu.');
    if (!lintasHari && alasan.trim().length < 5) return toast.err('Alasan tukar wajib diisi minimal 5 karakter.');
    if (lintasHari && !['izin', 'sakit'].includes(alasanJenis)) return toast.err('Pilih alasan Izin atau Sakit.');
    setBusy(true);
    try {
      const r = await api('/api/tukar-jadwal', {
        method: 'POST', body: {
          jadwal_id: slot.id, tanggal, ke_guru: Number(guruId),
          mapel_id: Number(mapelTerpilih?.id) || 0,
          pasangan_jadwal_id: lintasHari ? Number(mapelTerpilih?.jadwal_id) || 0 : undefined,
          pasangan_tanggal: lintasHari ? mapelTerpilih?.tanggal : tanggal,
          alasan_jenis: lintasHari ? alasanJenis : 'lainnya',
          alasan: lintasHari ? alasanJenis : alasan
        }
      });
      toast.ok(r.pesan || 'Permintaan tukar jadwal dikirim.');
      onSaved?.();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  function ubahMode(mode) {
    setModeTukar(mode);
    setTanggalTujuan('');
    setAlasanJenis(mode === 'lintas_hari' ? 'sakit' : 'lainnya');
    setGuruId('');
    setMapelId('');
    setAlasan('');
  }

  return (
    <Modal open={open} onClose={onClose} title="Tukar Jadwal Mengajar" size="lg"
      subtitle={data?.slot ? `${data.slot.mapel_nama} · ${data.slot.kelas_nama} · sesi ${data.slot.sesi} · ${data.slot.jam}` : ''}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn-primary" disabled={busy || loading || !kandidat.length || !guruId || !mapelId}
          onClick={kirim} data-kirim-tukar>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Repeat size={15} />} Kirim Permintaan Tukar Jadwal
        </button>
      </>}>
      {loading ? <Spinner label="Mencari jadwal pasangan pada kelas ini…" /> : !data ? null : (
        <div className="space-y-3" data-modal-tukar>
          {tanggal >= hariIni() ? (
            <Field label="Jenis Pertukaran">
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => ubahMode('hari_sama')}
                  className={cx('btn justify-center', !lintasHari
                    ? 'border-violet-300 bg-violet-100 text-violet-900'
                    : 'border-slate-200 bg-white text-slate-600')}
                  data-tukar-mode="hari-sama">
                  <Repeat size={14} /> Jadwal pada hari yang sama
                </button>
                <button type="button" onClick={() => ubahMode('lintas_hari')}
                  className={cx('btn justify-center', lintasHari
                    ? 'border-violet-300 bg-violet-100 text-violet-900'
                    : 'border-slate-200 bg-white text-slate-600')}
                  data-tukar-mode="hari-berbeda">
                  <CalendarDays size={14} /> Jadwal di hari lain
                </button>
              </div>
            </Field>
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[12px] text-slate-600">
            <p><b>Sesi:</b> {data.slot.mapel_nama} ({data.slot.mapel_kode || '-'}) · sesi {data.slot.sesi} · {data.slot.jam}</p>
            <p><b>Kelas:</b> {data.slot.kelas_nama || '-'}</p>
            <p><b>Tanggal:</b> {data.tanggal} · <b>Guru pengampu:</b> {data.slot.guru_nama}</p>
            <p className="mt-1 text-[11.5px] italic text-slate-500">
              {lintasHari
                ? 'Pilih jadwal pasangan pada tanggal setelah jadwal asal dan masih dalam minggu ini. Alasan wajib Sakit atau Izin, tetapi tidak dicatat sebagai status absensi.'
                : 'Pertukaran memasangkan slot pada kelas dan hari yang sama yang belum dimulai. Guru tujuan tidak perlu Check-in. Alasan harus menjelaskan kendala mengajar, bukan Izin atau Sakit.'}
            </p>
          </div>

          {lintasHari ? (
            <Field label="Alasan pertukaran lintas hari" required>
              <div className="grid grid-cols-2 gap-2">
                {['izin', 'sakit'].map(jenis => (
                  <button type="button" key={jenis} onClick={() => setAlasanJenis(jenis)}
                    className={cx('btn justify-center', alasanJenis === jenis
                      ? 'border-violet-300 bg-violet-100 text-violet-900'
                      : 'border-slate-200 bg-white text-slate-600')}
                    data-alasan-tukar-jenis={jenis}>
                    {jenis === 'izin' ? <UserRoundX size={14} /> : <Stethoscope size={14} />}
                    {jenis === 'izin' ? 'Izin' : 'Sakit'}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          {lintasHari ? (
            <Field label="Hari Tujuan" required hint="Pilih tanggal setelah jadwal asal; hari yang sudah lewat tidak tersedia.">
              <select className="input" value={tanggalTujuan}
                onChange={e => { setTanggalTujuan(e.target.value); setGuruId(''); setMapelId(''); }}
                data-pilih-tanggal-tukar>
                <option value="">— pilih hari tujuan —</option>
                {tanggalOpsi.map(tgl => {
                  const hari = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'UTC' })
                    .format(new Date(`${tgl}T12:00:00Z`));
                  return <option key={tgl} value={tgl}>{hari.charAt(0).toUpperCase() + hari.slice(1)} · {tgl}</option>;
                })}
              </select>
            </Field>
          ) : null}

          <Field label="Guru Tujuan" required
            hint={lintasHari
              ? 'Setelah memilih hari, daftar hanya menampilkan guru yang memiliki slot pasangan di tanggal tersebut.'
              : 'Guru tujuan tidak perlu Check-in, tetapi jam slot pasangannya hari ini belum boleh dimulai.'}>
            <select className="input" value={guruId} onChange={e => setGuruId(e.target.value)} data-pilih-guru-tukar>
              <option value="">— pilih guru —</option>
              {kandidat.map(k => (
                <option key={k.id} value={k.id}>
                  {k.nama}
                </option>
              ))}
            </select>
          </Field>
          {!kandidat.length ? (
            <Alert tone="warn" title="Belum ada jadwal pasangan yang tersedia di kelas ini">
              {lintasHari
                ? 'Pastikan ada guru lain dengan slot pada tanggal setelah jadwal asal, di minggu ini, pada kelas dan jumlah jam yang sama.'
                : 'Slot pasangan harus pada kelas yang sama, jumlah jamnya sama, belum dimulai, dan belum dibuka/diisi absensinya.'}
            </Alert>
          ) : null}

          <Field label="Mapel yang dipasangkan" required
            hint="Slot pasangan harus memiliki jumlah jam mapel yang sama dan kelas yang sama.">
            <select className="input" value={mapelId} onChange={e => setMapelId(e.target.value)} data-pilih-mapel-tukar>
              {mapelOpsi.map(m => <option key={m.id + '-' + m.jadwal_id + '-' + (m.tanggal || '')}
                value={lintasHari ? `${m.tanggal}:${m.jadwal_id}` : String(m.id)}>
                {m.nama || m.kode} · {lintasHari ? `${m.tanggal} · ` : ''}sesi {m.sesi}{m.jam ? ` (${m.jam})` : ''}
              </option>)}
            </select>
          </Field>

          {!lintasHari ? (
            <Field label="Alasan / Keterangan" required hint="Minimal 5 karakter; alasan Sakit/Izin hanya dipakai untuk pertukaran lintas hari.">
              <textarea className="input" rows={3} value={alasan} onChange={e => setAlasan(e.target.value)}
                placeholder="mis. kegiatan sekolah di jam tersebut, tugas mendadak…" data-alasan-tukar />
            </Field>
          ) : null}

          <p className="flex items-start gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-[11.5px] text-violet-900">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Setelah guru tujuan <b>menerima</b>, guru dan mapel pada kedua slot berpindah posisi hanya pada tanggal yang dipilih.
            Pertukaran tidak membuat catatan sakit/izin pada rekap absensi guru.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- modal jurnal mengajar & foto (setelah check-in) ---------------- */
export function ModalJurnal({ open, slot, cfg, tanggal, user, startAbsensi = false, onClose, onSaved, onPresensiSaved }) {
  const toast = useToast();
  const [materi, setMateri] = useState('');
  const [catatan, setCatatan] = useState('');
  const [foto, setFoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [alur, setAlur] = useState(null);      // status alur: absensi siswa → jurnal → foto
  const [alurBusy, setAlurBusy] = useState(false);
  const [presensiMode, setPresensiMode] = useState(false);
  const [presensiDetail, setPresensiDetail] = useState(null);
  const [presensiBusy, setPresensiBusy] = useState(false);
  const [presensiError, setPresensiError] = useState('');

  const muatAlur = useCallback(() => {
    if (!slot?.id) return;
    setAlurBusy(true);
    api(`/api/absensi-guru/alur?jadwal_id=${slot.id}&tanggal=${tanggal}`)
      .then(r => setAlur(r.alur)).catch(() => setAlur(null)).finally(() => setAlurBusy(false));
  }, [slot?.id, tanggal]);

  useEffect(() => {
    if (!open) return;
    const a = slot?.absensi;
    setMateri(a?.materi || '');
    setCatatan(a?.catatan || '');
    setFoto(a?.foto_url ? { url: a.foto_url, base64: '', nama: '', size: 0 } : null);
    setPresensiMode(!!startAbsensi);
    setPresensiDetail(null);
    setPresensiError('');
    muatAlur();
    if (startAbsensi) bukaAbsensiSiswa();
  }, [open, slot, muatAlur, startAbsensi]);

  const langkahAbsensi = alur?.absensi_siswa || { total: 0, terisi: 0, lengkap: false };
  const langkahJurnal = alur?.jurnal || { lengkap: false, min: 0 };
  const langkahFoto = alur?.foto || { wajib: false, ada: false };
  const butuhAbsensi = (slot?.absensi?.status || 'hadir') === 'hadir' && !langkahAbsensi.lengkap;

  async function bukaAbsensiSiswa() {
    if (!slot?.id) return;
    setPresensiMode(true);
    setPresensiBusy(true);
    setPresensiError('');
    try {
      const detail = await api('/api/absensi-siswa/sesi', {
        method: 'POST', body: { jadwal_id: slot.id, tanggal }
      });
      setPresensiDetail(detail);
    } catch (e) {
      setPresensiError(e.message);
    } finally { setPresensiBusy(false); }
  }

  async function simpanAbsensiSiswa({ items }) {
    if (!presensiDetail?.sesi?.id) throw new Error('Sesi absensi siswa belum tersedia.');
    const result = await api('/api/absensi-siswa/simpan', {
      method: 'POST', body: { sesi_id: presensiDetail.sesi.id, items }
    });
    setPresensiDetail(detail => detail ? {
      ...detail,
      siswa: detail.siswa.map(s => {
        const item = items.find(x => Number(x.siswa_id) === Number(s.id));
        return item ? { ...s, status: item.status, keterangan: item.keterangan, terisi: true } : s;
      })
    } : detail);
    muatAlur();
    onPresensiSaved?.();
    return result;
  }

  async function pilihFoto(file) {
    if (!file) return;
    setUploading(true);
    try {
      const maxKb = Math.max(64, Number(cfg?.max_upload_kb) || 2048);
      const hasil = await compressImage(file, { maxKb, maxSide: 1280, quality: 0.8 });
      if (!hasil) { toast.err('Berkas bukan gambar yang dapat dikompres.'); return; }
      setFoto({ url: hasil.dataUrl, base64: hasil.dataUrl, nama: hasil.filename, size: hasil.bytes });
      if (hasil.bytes > maxKb * 1024) toast.info(`Foto masih ${Math.round(hasil.bytes / 1024)} KB — batas ${maxKb} KB.`);
    } catch (e) { toast.err(e.message); }
    finally { setUploading(false); }
  }

  async function simpan() {
    if (butuhAbsensi) {
      return toast.err(langkahAbsensi.total
        ? `Absensi siswa belum lengkap (${langkahAbsensi.terisi}/${langkahAbsensi.total}). Selesaikan dulu, lalu isi jurnal.`
        : 'Absensi siswa belum dibuat. Buka menu Absensi Siswa per Mapel terlebih dahulu.');
    }
    setBusy(true);
    try {
      const r = await api('/api/absensi-guru/jurnal', {
        method: 'POST', body: {
          jadwal_id: slot.id, group_ids: slot.group_ids || [slot.id], tanggal, materi, catatan,
          foto: foto?.base64 || '', foto_nama: foto?.nama || ''
        }
      });
      toast.ok(r.pesan || 'Jurnal mengajar tersimpan.');
      muatAlur();
      onSaved?.();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  const status = slot?.absensi?.status || 'hadir';
  return (
    <Modal open={open} onClose={onClose}
      title={presensiMode ? 'Absensi Siswa' : 'Jurnal Mengajar & Bukti Kegiatan'} size="lg"
      subtitle={slot ? `${slot.mapel_nama} · ${slot.kelas_nama} · ${slot.jam}` : ''}
      footer={<>
        {presensiMode ? (
          <button className="btn-ghost" onClick={() => setPresensiMode(false)} data-kembali-jurnal>
            <ArrowLeft size={14} /> Kembali ke Jurnal
          </button>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose}>Tutup</button>
            <button className="btn-primary" disabled={busy || uploading} onClick={simpan} data-simpan-jurnal>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan Jurnal
            </button>
          </>
        )}
      </>}>
      {slot ? (
        presensiMode ? (
          <div className="space-y-3" data-presensi-siswa-inline>
            {presensiBusy ? <Spinner label="Memuat daftar nama siswa…" /> : null}
            {presensiError ? <Alert tone="danger" title="Absensi siswa belum dapat dibuka">{presensiError}</Alert> : null}
            {presensiDetail ? (
              <AbsensiKelas detail={presensiDetail} simpan={simpanAbsensiSiswa}
                user={user} mode="guru" readOnly={presensiDetail.window?.terbuka === false} />
            ) : null}
          </div>
        ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('badge', STATUS_TONE[status] || 'badge-netral')}>{STATUS_LABEL[status] || status}</span>
            <span className="chip"><Lock size={11} /> Status terkunci</span>
            <span className="chip"><Clock size={11} /> Check-in {jamLengkap(slot.absensi?.waktu_submit)}</span>
          </div>

          {/* ---------- alur kerja wajib ---------- */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3" data-alur-absensi>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              Alur wajib · selesaikan berurutan sebelum jam pelajaran berakhir
            </p>
            <ol className="space-y-1.5">
              <LangkahAlur no={1} selesai={langkahAbsensi.lengkap}
                judul="Absensi Siswa"
                ket={langkahAbsensi.total
                  ? `${langkahAbsensi.terisi}/${langkahAbsensi.total} siswa tercatat`
                  : 'Sesi presensi belum dibuat'}
                aksi={!langkahAbsensi.lengkap ? (
                  <button type="button" className="btn-soft btn-sm" onClick={bukaAbsensiSiswa} disabled={presensiBusy}
                    data-buka-absensi-siswa>
                    <Users size={13} /> Isi Absensi Siswa
                  </button>
                ) : null} />
              <LangkahAlur no={2} selesai={langkahJurnal.lengkap} judul="Jurnal Kegiatan / Mengajar"
                ket={langkahJurnal.lengkap ? 'Jurnal terisi' : `Minimal ${langkahJurnal.min || 0} karakter (isi di bawah)`} />
              <LangkahAlur no={3} selesai={!langkahFoto.wajib || langkahFoto.ada} judul="Foto Kegiatan"
                ket={langkahFoto.wajib ? (langkahFoto.ada ? 'Foto tersedia' : 'Wajib — ambil dari kamera') : 'Opsional'} />
            </ol>
            {butuhAbsensi ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] font-semibold text-amber-800">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Jurnal tidak dapat disimpan sebelum absensi siswa lengkap. Bila tidak diselesaikan sampai jam
                pelajaran berakhir, kehadiran otomatis tercatat <b>ALFA</b> dan sesi terkunci.
              </p>
            ) : null}
            <button type="button" className="mt-2 text-[11px] font-semibold text-slate-500 underline" onClick={muatAlur} disabled={alurBusy}>
              {alurBusy ? 'Memuat status…' : 'Perbarui status alur'}
            </button>
          </div>
          <Field label="Ringkasan Materi / Jurnal Mengajar" hint={`Disarankan minimal ${cfg?.jurnal_min ?? 15} karakter agar tercatat lengkap.`}>
            <textarea className="input" rows={4} value={materi} onChange={e => setMateri(e.target.value)}
              placeholder="mis. Membahas persamaan kuadrat, latihan soal halaman 45…" data-jurnal-materi />
          </Field>
          <Field label="Catatan Tambahan (opsional)">
            <input className="input" value={catatan} onChange={e => setCatatan(e.target.value)}
              placeholder="mis. 2 siswa izin, kelas berjalan kondusif" />
          </Field>
          <Field label={`Foto Bukti Kegiatan${cfg?.foto_wajib ? ' *' : ' (opsional)'}`}
            hint="Foto diambil langsung dari kamera perangkat (galeri tidak tersedia).">
            <div className="flex flex-wrap items-center gap-3">
              <label className={cx('btn-ghost cursor-pointer', uploading && 'opacity-60')}>
                <Camera size={15} /> {foto ? 'Ambil Ulang Foto' : 'Ambil Foto (Kamera)'}
                <input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploading}
                  onChange={e => pilihFoto(e.target.files[0])} data-foto-kamera />
              </label>
              {uploading ? <span className="text-[12px] text-slate-500">Mengompres foto…</span> : null}
              {foto?.size ? <span className="text-[11.5px] text-slate-400">± {Math.max(1, Math.round(foto.size / 1024))} KB</span> : null}
              {foto?.url ? (
                <div className="relative">
                  <img src={foto.url} alt="Pratinjau" className="h-20 w-28 rounded-lg object-cover ring-1 ring-slate-200" />
                  <button type="button" onClick={() => setFoto(null)} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-rose-600 text-white shadow">
                    <XCircle size={13} />
                  </button>
                </div>
              ) : null}
            </div>
          </Field>
          {cfg?.foto_wajib && !foto?.url ? (
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-rose-600"><AlertTriangle size={12} /> Bukti foto wajib diunggah sesuai pengaturan sekolah.</p>
          ) : null}
          <p className="flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-600" />
            Status kehadiran dan cap waktu check-in tersimpan permanen. Jurnal &amp; foto dapat dilengkapi selama jam pelajaran berlangsung.
          </p>
        </div>
        )
      ) : null}
    </Modal>
  );
}
