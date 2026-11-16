import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CalendarRange, CheckCircle2, Copy, Download, ExternalLink, FileSpreadsheet,
  Info, Link2, Loader2, Lock, Pencil, Plus, Printer, RefreshCw, Repeat, Search, ShieldCheck, Sparkles, Table2, Trash2, Upload, Users, X
} from 'lucide-react';
import { api, tgl } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';
import GeneratorJadwal from './GeneratorJadwal';

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const TABS = [
  { key: 'matriks', label: 'Matriks Jadwal' },
  { key: 'target', label: 'Pemetaan Jam Guru' },
  { key: 'mapel', label: 'Mata Pelajaran' },
  { key: 'pengaturan', label: 'Pengaturan Jadwal' },
  { key: 'ai', label: 'AI Timetable Generator' }
];

export default function Jadwal({ ctx }) {
  const { can, toast, filters } = ctx;
  const [tab, setTab] = useState('matriks');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kelasId, setKelasId] = useState('');
  const [dragId, setDragId] = useState(null);
  const [edit, setEdit] = useState(null);          // slot yang diedit / slot baru
  const [importOpen, setImportOpen] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);
  const [view, setView] = useState('kelas');        // kelas | semua | guru
  const [guruId, setGuruId] = useState('');

  const ta = filters?.ta || '';

  useEffect(() => {
    if (ctx.guide?.page === 'jadwal' && ctx.guide.tab) setTab(ctx.guide.tab);
  }, [ctx.guide?.runId]);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/jadwal?ta=' + encodeURIComponent(ta))
      .then(r => {
        setData(r);
        setKelasId(k => (k && r.kelas.some(x => String(x.id) === String(k))) ? k : (r.kelas[0] ? String(r.kelas[0].id) : ''));
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, [ta]);
  useEffect(load, [load]);

  const cfg = data?.config;
  const hariAktif = (cfg?.hari || []).map(Number);
  const sesi = cfg?.sesi || [];
  /* API mengirim `sesiHari` (camelCase); endpoint publik memakai `sesi_hari`. */
  const sesiHari = cfg?.sesiHari || cfg?.sesi_hari || {};
  const rows = data?.rows || [];
  const kelas = data?.kelas || [];
  const mapel = data?.mapel || [];
  const guru = data?.guru || [];
  const mapelById = useMemo(() => new Map(mapel.map(m => [Number(m.id), m])), [mapel]);
  const guruById = useMemo(() => new Map(guru.map(g => [Number(g.id), g])), [guru]);
  const sesiById = useMemo(() => new Map(sesi.map(s => [Number(s.idx), s])), [sesi]);
  const kelasTerpilih = kelas.find(k => String(k.id) === String(kelasId));

  async function simpanSlot(body, { konfirmasi = true } = {}) {
    try {
      const r = await api('/api/jadwal/slot', { method: 'POST', body: { ...body, ta } });
      toast.ok(r.pesan || 'Jadwal disimpan.');
      if (r.peringatan && r.peringatan.length) toast.info(r.peringatan[0]);
      setEdit(null);
      load();
      return true;
    } catch (e) {
      if (konfirmasi && e.data && e.data.butuh_konfirmasi) {
        if (window.confirm(`${e.message}\n\nTetap simpan jadwal ini?`)) return simpanSlot(body, { konfirmasi: false });
        return false;
      }
      toast.err(e.message);
      return false;
    }
  }

  async function pindah(id, hari, sesiNo) {
    try {
      const r = await api('/api/jadwal/move', { method: 'POST', body: { id, hari, sesi: sesiNo, ta } });
      toast.ok(r.pesan || 'Slot dipindahkan.');
      if (r.peringatan && r.peringatan.length) toast.info(r.peringatan[0]);
      load();
    } catch (e) {
      if (e.data && e.data.butuh_konfirmasi) {
        if (window.confirm(`${e.message}\n\nTetap pindahkan?`)) {
          try {
            await api('/api/jadwal/move', { method: 'POST', body: { id, hari, sesi: sesiNo, ta, abaikan: 1 } });
            toast.ok('Slot dipindahkan.');
            load();
          } catch (e2) { toast.err(e2.message); }
        }
      } else toast.err(e.message);
    }
  }

  async function hapus(id) {
    if (!window.confirm('Hapus slot jadwal ini?')) return;
    try { await api('/api/jadwal/slot/' + id, { method: 'DELETE' }); toast.ok('Slot dihapus.'); load(); }
    catch (e) { toast.err(e.message); }
  }

  async function hapusSlotTerpilih(ids) {
    if (!ids.length) return false;
    if (!window.confirm(`Hapus ${ids.length} slot jadwal terpilih beserta data absensi terkait? Tindakan ini tidak dapat dibatalkan.`)) return false;
    try {
      const r = await api('/api/jadwal/slot/delete-masal', { method: 'POST', body: { ids, ta: data?.ta || ta } });
      toast.ok(r.pesan || `${r.jumlah} slot jadwal dihapus.`);
      load();
      return true;
    } catch (e) { toast.err(e.message); return false; }
  }

  async function resetMatriks() {
    if (!rows.length) return;
    const namaTa = data?.ta_nama || 'tahun pelajaran terpilih';
    if (!window.confirm(`Reset seluruh matriks untuk ${namaTa}?\n\n${rows.length} slot jadwal beserta data absensi terkait akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`)) return false;
    try {
      const r = await api('/api/jadwal/reset', { method: 'POST', body: { ta: data?.ta || ta } });
      toast.ok(r.pesan || 'Matriks jadwal direset.');
      load();
      return true;
    } catch (e) { toast.err(e.message); return false; }
  }

  /* DUPLIKAT SLOT: salin ke sesi berikutnya (atau hari/sesi pilihan lewat modal) */
  const [dup, setDup] = useState(null);            // slot yang akan diduplikasi
  const [dupBusy, setDupBusy] = useState(false);

  async function jalankanDuplikat(hari, sesiNo) {
    if (!dup) return;
    setDupBusy(true);
    try {
      const r = await api('/api/jadwal/duplikat', {
        method: 'POST', body: { id: dup.id, hari, sesi: sesiNo, ta }
      });
      toast.ok(r.pesan || 'Slot diduplikasi.');
      (r.peringatan || []).forEach(p2 => toast.warn ? toast.warn(p2) : toast.ok(p2));
      setDup(null); load();
    } catch (e) { toast.err(e.message); }
    finally { setDupBusy(false); }
  }

  if (loading && !data) return <Spinner label="Memuat jadwal pelajaran…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Jadwal Pelajaran</h2>
          <p className="text-[12.5px] text-slate-500">
            Susun jadwal per kelas, gabungkan rombel (merge), dan sistem otomatis mendeteksi bentrok guru/kelas/ruang.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={(window.__BASE__ || '') + '/api/jadwal/template.xlsx'} download><Download size={15} /> Template</a>
          {can('jadwal', 'write') ? <button className="btn-ghost" onClick={() => setImportOpen(true)} data-open-import><Upload size={15} /> Impor Jadwal</button> : null}
          <a className="btn-ghost"
            href={(window.__BASE__ || '') + '/api/jadwal/export.xlsx?ta=' + encodeURIComponent(ta)
              + '&mode=' + view + (view === 'kelas' && kelasId ? '&kelas=' + kelasId : '') + (guruId ? '&guru=' + guruId : '')}
            download data-export-jadwal><FileSpreadsheet size={15} /> Export Excel</a>
          <a className="btn-ghost"
            href={(window.__BASE__ || '') + '/api/jadwal/cetak?ta=' + encodeURIComponent(ta)
              + '&mode=' + view + (view === 'kelas' && kelasId ? '&kelas=' + kelasId : '') + (guruId ? '&guru=' + guruId : '')}
            target="_blank" rel="noreferrer" data-cetak-jadwal data-tour-id="btn-cetak-jadwal"><Printer size={15} /> Cetak / PDF</a>
          <button className="btn-primary" onClick={() => setPubOpen(true)} data-open-publik><Link2 size={15} /> Link Publik</button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx('tab flex items-center gap-1.5', tab === t.key && 'active')}>
            {t.key === 'matriks' ? <CalendarRange size={14} /> : t.key === 'target' ? <Users size={14} />
              : t.key === 'mapel' ? <FileSpreadsheet size={14} />
              : t.key === 'ai' ? <Sparkles size={14} /> : <ShieldCheck size={14} />} {t.label}
          </button>
        ))}
      </div>

      {tab === 'matriks' ? (
        <Matriks
          ctx={ctx} data={data} cfg={cfg} kelas={kelas} kelasId={kelasId} setKelasId={setKelasId}
          mapelById={mapelById} guruById={guruById} sesiById={sesiById} hariAktif={hariAktif} sesi={sesi} sesiHari={sesiHari} rows={rows}
          dragId={dragId} setDragId={setDragId} pindah={pindah} hapus={hapus}
          onHapusTerpilih={hapusSlotTerpilih} onResetMatriks={resetMatriks}
          onEdit={setEdit} onLoad={load} ta={ta} onDuplikat={setDup}
          view={view} setView={setView} guruId={guruId} setGuruId={setGuruId}
        />
      ) : tab === 'target' ? (
        <GuruTargetTab ctx={ctx} data={data} ta={ta} onLoad={load} />
      ) : tab === 'mapel' ? (
        <MapelTab ctx={ctx} data={data} onLoad={load} />
      ) : tab === 'ai' ? (
        <GeneratorJadwal ctx={ctx} ta={ta} onApplied={load} />
      ) : (
        <PengaturanTab ctx={ctx} data={data} onLoad={load} />
      )}

      <ModalSlot open={!!edit} slot={edit} onClose={() => setEdit(null)} simpan={simpanSlot}
        data={data} kelas={kelas} mapel={mapel} guru={guru} sesi={sesi} hariAktif={hariAktif} sesiHari={sesiHari} />

      <ModalDuplikat open={!!dup} slot={dup} sesi={sesi} sesiHari={sesiHari} hariAktif={hariAktif}
        busy={dupBusy} onClose={() => setDup(null)} onConfirm={jalankanDuplikat} />

      <ModalImport open={importOpen} onClose={() => setImportOpen(false)} ta={ta} onDone={() => { setImportOpen(false); load(); }} />

      <ModalPublik open={pubOpen} onClose={() => setPubOpen(false)} data={data} onChanged={load} />
    </div>
  );
}

/* ==================================================================
   MATRIKS JADWAL (drag & drop) — 3 mode tampilan:
   · kelas : satu rombel, hari × jam
   · semua : semua kelas dalam satu grid
   · guru  : jadwal satu guru
   ================================================================== */
const VIEWS = [
  { key: 'kelas', label: 'Per Kelas', icon: CalendarRange },
  { key: 'semua', label: 'Semua Kelas', icon: Table2 },
  { key: 'guru', label: 'Per Guru', icon: Users }
];

function Matriks({
  ctx, data, cfg, kelas, kelasId, setKelasId, mapelById, guruById, hariAktif, sesi, sesiHari, rows,
  dragId, setDragId, pindah, hapus, onEdit, view, setView, guruId, setGuruId, onDuplikat,
  onHapusTerpilih, onResetMatriks
}) {
  const [slotTerpilih, setSlotTerpilih] = useState([]);
  const [hapusBusy, setHapusBusy] = useState(false);
  const headerScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const k = kelas.find(x => String(x.id) === String(kelasId));
  const sesiUntuk = (hari) => (sesiHari && sesiHari[Number(hari)]) || sesi || [];
  const rowOf = (hari, sesiIdx, kelasTerpilih) => rows.find(r => Number(r.hari) === Number(hari)
    && Number(r.sesi) === Number(sesiIdx) && kelasTerpilih && r.kelas_ids.includes(Number(kelasTerpilih.id)));
  const jumlahJam = (sesi || []).filter(s => !s.istirahat).length;
  const slotTerlihatIds = useMemo(() => [...new Set(rows.filter(r => {
    if (!hariAktif.includes(Number(r.hari))) return false;
    const sesiHariIni = sesiUntuk(r.hari).find(s => Number(s.idx) === Number(r.sesi));
    if (!sesiHariIni || sesiHariIni.istirahat) return false;
    if ((view === 'kelas' || view === 'guru') && (!k || !r.kelas_ids.includes(Number(k.id)))) return false;
    if (view === 'guru' && (!guruId || Number(r.guru_id) !== Number(guruId))) return false;
    return true;
  }).map(r => Number(r.id)))], [rows, view, k?.id, guruId, hariAktif.join(','), JSON.stringify(sesiHari || {}), JSON.stringify(sesi || [])]);
  const allVisibleSelected = slotTerlihatIds.length > 0 && slotTerlihatIds.every(id => slotTerpilih.includes(id));
  const toggleSlot = (id) => setSlotTerpilih(selected => selected.includes(Number(id))
    ? selected.filter(x => x !== Number(id)) : [...selected, Number(id)]);
  const pilihSlot = (row) => ctx.can('jadwal', 'delete') ? (
    <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-rose-600"
      aria-label={`Pilih slot ${row.mapel_nama || ''}`}
      checked={slotTerpilih.includes(Number(row.id))}
      onChange={() => toggleSlot(row.id)}
      onClick={e => e.stopPropagation()}
      onDragStart={e => e.preventDefault()}
      data-slot-pilih={row.id} />
  ) : null;
  const hapusTerpilih = async () => {
    setHapusBusy(true);
    try {
      if (await onHapusTerpilih(slotTerpilih)) setSlotTerpilih([]);
    } finally { setHapusBusy(false); }
  };
  const resetMatriksPilih = async () => {
    if (await onResetMatriks()) setSlotTerpilih([]);
  };
  /* Catatan: grid horizontal TIDAK lagi memakai baris seragam — setiap kolom
     hari merender daftar sesinya sendiri (lihat gridHorizontal). */
  /* baris grid semua kelas: satu baris = satu hari + satu sesi */
  const barisSemua = useMemo(() => {
    const out = [];
    for (const h of hariAktif) {
      for (const s of sesiUntuk(h)) {
        out.push({
          hari: h, sesi: s.idx, label: s.istirahat ? s.label : (s.no ? `Jam ke-${s.no}` : (s.label || `Jam ${s.no}`)),
          jam: `${s.mulai}–${s.selesai}`, istirahat: !!s.istirahat, sesiRow: s
        });
      }
    }
    return out;
  }, [hariAktif.join(','), JSON.stringify(sesiHari || {}), JSON.stringify(sesi || [])]);

  /* ---------- label & tinggi slot mengikuti SESI HARI ITU ----------
     Tinggi kartu proporsional dengan DURASI sesi: istirahat/pembiasaan pendek
     → kartu ringkas; jam pelajaran 45 menit → tinggi standar. */
  const menitDari = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const durasiSesi = (s) => {
    if (!s) return 45;
    const a = menitDari(s.mulai), b = menitDari(s.selesai);
    return (a !== null && b !== null && b > a) ? (b - a) : 45;
  };
  const tinggiSesi = (s) => {
    const m = durasiSesi(s);
    if (!s) return 72;
    if (s.istirahat) return Math.max(26, Math.min(42, Math.round(m * 1.15)));
    return Math.max(58, Math.min(140, Math.round(m * 1.55)));
  };
  /* Label sesi: label KUSTOM ("Upacara", "Pembiasaan", "Sholat") selalu menang;
     label generik ("Jam"/"Jam ke-2") diganti nomor jam agar seragam. */
  const labelSesi = (s) => {
    if (!s) return 'Sesi';
    const lab = String(s.label || '').trim();
    if (s.istirahat) return lab || 'Istirahat';
    const generik = !lab || /^jam(\s|$)/i.test(lab) || /^sesi\b/i.test(lab) || /^jam\s*ke-/i.test(lab);
    return generik ? (s.no ? `Jam ke-${s.no}` : 'Jam') : lab;
  };
  /* sesi pendek (< 30 menit) dirender kompak agar tingginya benar-benar kecil */
  const sesiPadat = (s) => !!s && !s.istirahat && durasiSesi(s) < 30;

  /* KARTU SLOT: header = label sesi + rentang waktu, aksi di sudut kanan,
     isi = kode/nama mapel, guru, ruang. */
  const kartu = (row, s, aktifDrag = true) => {
    const padat = sesiPadat(s);
    return (
      <div draggable={aktifDrag && ctx.can('jadwal', 'write')}
        onDragStart={e => { setDragId(row.id); e.dataTransfer.setData('text/plain', String(row.id)); e.dataTransfer.effectAllowed = 'move'; }}
        onDoubleClick={() => ctx.can('jadwal', 'write') && onEdit(row)}
        style={padat ? { height: tinggiSesi(s) } : { minHeight: tinggiSesi(s) }}
        className={cx('group flex cursor-grab flex-col overflow-hidden rounded-lg border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 px-1.5 active:cursor-grabbing',
          padat ? 'py-0.5' : 'py-1')}
        data-slot={row.id} data-slot-sesi={s ? s.idx : ''} data-slot-padat={padat ? 1 : 0}>
        {/* --- baris atas: label sesi + jam, lalu tombol aksi di sudut --- */}
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 text-left">
            <p className="truncate text-[9.5px] font-extrabold uppercase tracking-wide text-orange-700" data-slot-label>
              {labelSesi(s)}
            </p>
            <p className="whitespace-nowrap text-[9px] font-semibold leading-tight text-slate-500" data-slot-jam>
              {s ? `${s.mulai}–${s.selesai}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {pilihSlot(row)}
            <button type="button" title="Ubah slot" data-slot-aksi="edit"
              onClick={e => { e.stopPropagation(); onEdit(row); }}
              className="rounded bg-white/90 p-0.5 text-slate-500 transition hover:text-orange-600"><Pencil size={10} /></button>
            <button type="button" title="Duplikat ke sesi berikutnya" data-slot-aksi="duplikat"
              onClick={e => { e.stopPropagation(); (onDuplikat || (() => {}))(row); }}
              className="rounded bg-white/90 p-0.5 text-slate-500 transition hover:text-teal-600"><Copy size={10} /></button>
            <button type="button" title="Hapus slot" data-slot-aksi="hapus"
              onClick={e => { e.stopPropagation(); hapus(row.id); }}
              className="rounded bg-white/90 p-0.5 text-slate-500 transition hover:text-rose-600"><Trash2 size={10} /></button>
          </div>
        </div>
        {/* --- isi kartu (kompak bila sesi pendek) --- */}
        {padat ? (
          <p className="mt-0.5 truncate text-[10px] font-bold leading-tight text-slate-800" data-slot-mapel>
            {row.mapel_kode ? <span className="mr-1 rounded bg-teal-100 px-1 text-[9px] font-extrabold text-teal-800">{row.mapel_kode}</span> : null}
            {row.mapel_nama || '-'} <span className="font-normal text-slate-500">· {row.guru_nama || '-'}</span>
          </p>
        ) : (
          <div className="mt-1 flex flex-1 flex-col justify-center text-center">
            <p className="text-[11.5px] font-bold leading-tight text-slate-800" data-slot-mapel>
              {row.mapel_kode ? <span className="mr-1 rounded bg-teal-100 px-1 text-[9.5px] font-extrabold text-teal-800">{row.mapel_kode}</span> : null}
              {row.mapel_nama || '-'}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">{row.guru_nama || 'Guru belum dipilih'}</p>
            {row.kelas_ids.length > 1 ? (
              <p className="mt-0.5 truncate text-[9.5px] font-semibold text-rose-600">Gabungan: {row.kelas_nama}</p>
            ) : row.ruang ? <p className="mt-0.5 text-[9.5px] text-slate-400">{row.ruang}</p> : null}
          </div>
        )}
      </div>
    );
  };

  const selDrag = (row, hari, sesiIdx, kelasIdSel) => ({
    onDragOver: e => { e.preventDefault(); e.currentTarget.classList.add('bg-orange-50'); },
    onDragLeave: e => e.currentTarget.classList.remove('bg-orange-50'),
    onDrop: e => {
      e.preventDefault(); e.currentTarget.classList.remove('bg-orange-50');
      const id = Number(e.dataTransfer.getData('text/plain')) || dragId;
      if (id) pindah(id, hari, sesiIdx, kelasIdSel);
      setDragId(null);
    }
  });

  let tourSlotAssigned = false;
  const kosongBtn = (hari, sesiIdx, kelasAwal, s) => {
    const tourId = tourSlotAssigned ? undefined : 'btn-tambah-jadwal';
    tourSlotAssigned = true;
    return (
    <button type="button" onClick={() => ctx.can('jadwal', 'write') && onEdit({ hari, sesi: sesiIdx, kelas_ids: kelasAwal ? [kelasAwal.id] : [] })}
      style={{ minHeight: s ? tinggiSesi(s) : 52 }}
      className="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-200 px-1 py-1 text-slate-300 transition hover:border-orange-300 hover:bg-orange-50/50 hover:text-orange-500"
      data-slot-kosong={`${hari}-${sesiIdx}${kelasAwal ? '-' + kelasAwal.id : ''}`}
      data-guide-target="setup-schedule-add" data-tour-id={tourId}
      data-slot-kosong-sesi={sesiIdx}>
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400" data-slot-kosong-label>
        {labelSesi(s)}
      </span>
      <span className="text-[9px] font-semibold text-slate-400">{s ? `${s.mulai}–${s.selesai}` : ''}</span>
      <Plus size={14} />
    </button>
    );
  };

  /* ---------- grid horizontal per kelas / per guru ----------
     Tiap kolom hari merender SESINYA SENDIRI (day-specific time slots),
     sehingga hari dengan sesi khusus (mis. Senin "Upacara", Jumat pendek)
     tidak lagi dipaksa mengikuti baris jam yang seragam. */
  const gridHorizontal = (daftarKelas) => {
    const aktif = daftarKelas[0] || null;
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-card" data-grid-jadwal>
        <div className="sticky top-0 z-30 rounded-t-2xl border-b border-slate-100 bg-white px-2 pt-2" data-grid-jadwal-header>
          <div className="overflow-x-auto" ref={headerScrollRef}
            onScroll={e => {
              const target = bodyScrollRef.current;
              if (target && target.scrollLeft !== e.currentTarget.scrollLeft) target.scrollLeft = e.currentTarget.scrollLeft;
            }}>
            <div className="flex min-w-full items-start gap-2">
              {hariAktif.map(h => {
                const daftar = sesiUntuk(h);
                const khusus = !!(sesiHari && sesiHari[h]);
                const jamPelajaran = daftar.filter(s => !s.istirahat).length;
                return (
                  <div key={h} className="min-w-[186px] flex-1">
                    <div className={cx('mb-1 rounded-lg border px-1.5 py-1 text-center',
                      khusus ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50')}
                      data-header-hari={h}>
                      <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-slate-700">
                        {HARI[h]}
                        {khusus ? <span className="ml-1 rounded bg-violet-200 px-1 text-[8.5px] font-bold text-violet-800">khusus</span> : null}
                      </p>
                      <p className="text-[9.5px] font-semibold text-slate-500">
                        {jamPelajaran} jam · {daftar.length} sesi
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto px-2 pb-2" ref={bodyScrollRef} data-grid-jadwal-body
          onScroll={e => {
            const target = headerScrollRef.current;
            if (target && target.scrollLeft !== e.currentTarget.scrollLeft) target.scrollLeft = e.currentTarget.scrollLeft;
          }}>
          <div className="flex min-w-full items-start gap-2">
            {hariAktif.map(h => {
              const daftar = sesiUntuk(h);
              return (
                <div key={h} className="min-w-[186px] flex-1" data-hari={h} data-hari-khusus={sesiHari && sesiHari[h] ? 1 : 0}>
                  <div className="space-y-1">
                    {daftar.map(s => {
                      if (s.istirahat) {
                        return (
                          <div key={s.idx} data-sesi-istirahat={`${h}-${s.idx}`}
                            style={{ minHeight: tinggiSesi(s) }}
                            className="flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-1 text-center">
                            <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-700">{s.label}</span>
                            <span className="text-[9px] font-semibold text-amber-600">{s.mulai}–{s.selesai}</span>
                          </div>
                        );
                      }
                      const row = rowOf(h, s.idx, aktif);
                      return (
                        <div key={s.idx} data-sesi-cell={`${h}-${s.idx}`}
                          className="rounded-lg p-0.5"
                          {...selDrag(row, h, s.idx, aktif ? aktif.id : null)}>
                          {row ? kartu(row, s) : kosongBtn(h, s.idx, aktif, s)}
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
      </div>
    );
  };

  /* ---------- grid semua kelas: kolom = kelas, baris = hari + jam ---------- */
  const gridSemua = () => {
    const kolom = kelas;
    const dipakai = kolom.length ? kolom : kelas;
    /* selalu ada minimal satu kolom agar colspan baris hari konsisten dengan <thead> */
    const daftarKolom = dipakai.length ? dipakai : [{ id: 0, nama: '(belum ada kelas)' }];
    let hariSebelum = null;
    return (
      <div className="max-h-[75vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-card" data-grid-semua-scroll>
        <table className="w-full border-collapse text-[12px]" data-grid-semua>
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 top-0 z-[30] w-[132px] min-w-[132px] border-b border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Hari / Jam</th>
              {daftarKolom.map(x => (
                <th key={x.id} className="sticky top-0 z-[20] min-w-[132px] border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11.5px] font-bold text-slate-600">{x.nama}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!barisSemua.length ? (
              <tr><td colSpan={daftarKolom.length + 1} className="px-3 py-6 text-center text-[12px] text-slate-400">
                Belum ada sesi jam pelajaran — atur di tab Pengaturan Jadwal.
              </td></tr>
            ) : barisSemua.map((b, i) => {
              const hariBaru = b.hari !== hariSebelum;
              hariSebelum = b.hari;
              return (
                <React.Fragment key={`${b.hari}-${b.sesi}-${i}`}>
                  {hariBaru ? (
                    <tr className="bg-slate-200/70">
                      <td colSpan={daftarKolom.length + 1}
                        className="border-b border-slate-300 px-2 py-1.5 text-center text-[11.5px] font-extrabold uppercase tracking-wide text-slate-700">
                        {HARI[b.hari]}
                      </td>
                    </tr>
                  ) : null}
                  <tr className={cx(b.istirahat && 'bg-amber-50/50')}
                    style={{ height: b.istirahat ? Math.max(24, Math.min(40, tinggiSesi(b.sesiRow))) : undefined }}>
                    <th className="sticky left-0 z-[1] w-[132px] border-b border-slate-100 bg-white px-2 py-1.5 text-center align-middle">
                      <span className="block text-[11px] font-bold text-slate-700">{b.label}</span>
                      <span className="block text-[10px] font-medium text-slate-400">{b.jam}</span>
                    </th>
                    {daftarKolom.map(x => {
                      if (b.istirahat) {
                        return <td key={x.id} className="border-b border-l border-slate-100 bg-amber-50/40 px-1.5 py-1 text-center align-middle text-[10.5px] italic text-amber-700">{b.label}</td>;
                      }
                      if (!x.id) {
                        return <td key="kosong" className="border-b border-l border-slate-100 px-2 py-1.5 text-center align-middle text-[11px] text-slate-300">–</td>;
                      }
                      const row = rowOf(b.hari, b.sesi, x);
                      return (
                        <td key={x.id} className="border-b border-l border-slate-100 p-1 align-middle" {...selDrag(row, b.hari, b.sesi, x.id)}>
                          {row ? (
                            <div style={{ minHeight: tinggiSesi(b.sesiRow) }}
                              className="group flex flex-col rounded-md border border-orange-200 bg-orange-50/70 px-1.5 py-1 text-center"
                              data-slot={row.id} data-slot-sesi={b.sesi}>
                              <div className="flex items-start justify-between gap-1">
                                <span className="truncate text-[9px] font-extrabold uppercase tracking-wide text-orange-700" data-slot-label>
                                  {b.label}
                                </span>
                                <span className="flex shrink-0 items-center gap-0.5">
                                  {pilihSlot(row)}
                                  <button type="button" title="Ubah slot" data-slot-aksi="edit"
                                    onClick={e => { e.stopPropagation(); onEdit(row); }}
                                    className="rounded bg-white/90 p-0.5 text-slate-500 hover:text-orange-600"><Pencil size={9} /></button>
                                  <button type="button" title="Duplikat" data-slot-aksi="duplikat"
                                    onClick={e => { e.stopPropagation(); (onDuplikat || (() => {}))(row); }}
                                    className="rounded bg-white/90 p-0.5 text-slate-500 hover:text-teal-600"><Copy size={9} /></button>
                                  <button type="button" title="Hapus slot" data-slot-aksi="hapus"
                                    onClick={e => { e.stopPropagation(); hapus(row.id); }}
                                    className="rounded bg-white/90 p-0.5 text-slate-500 hover:text-rose-600"><Trash2 size={9} /></button>
                                </span>
                              </div>
                              <span className="mt-0.5 block truncate text-[10.5px] font-extrabold text-teal-700">{row.mapel_kode || row.mapel_nama}</span>
                              <span className="block truncate text-[9.5px] text-slate-500">{row.guru_nama || '-'}</span>
                              <span className="block text-[8.5px] font-semibold text-slate-400" data-slot-jam>{b.jam}</span>
                            </div>
                          ) : kosongBtn(b.hari, b.sesi, x, b.sesiRow)}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const guruTerpilih = (data?.guru || []).find(g => Number(g.id) === Number(guruId)) || null;

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="tabs !p-1">
          {VIEWS.map(v => {
            const Ikon = v.icon;
            return (
              <button key={v.key} onClick={() => { setSlotTerpilih([]); setView(v.key); }}
                className={cx('tab flex items-center gap-1.5 !py-1.5', view === v.key && 'active')} data-view={v.key}>
                <Ikon size={13} /> {v.label}
              </button>
            );
          })}
        </div>
        {view === 'kelas' || view === 'guru' ? (
          <select className="input !w-auto min-w-[180px]" value={kelasId}
            onChange={e => { setSlotTerpilih([]); setKelasId(e.target.value); }} data-pilih-kelas>
            {kelas.length ? kelas.map(x => (
              <option key={x.id} value={x.id}>
                {x.nama}{x.status_target === 'kurang' ? ` — kurang ${x.terisi}/${x.target} jam`
                  : x.status_target === 'lebih' ? ` — lebih ${x.terisi}/${x.target} jam` : ''}
              </option>
            )) : <option value="">Belum ada kelas</option>}
          </select>
        ) : null}
        {view === 'guru' ? (
          <select className="input !w-auto min-w-[190px]" value={guruId}
            onChange={e => { setSlotTerpilih([]); setGuruId(e.target.value); }} data-pilih-guru>
            <option value="">— pilih guru —</option>
            {(data?.guru || []).map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
          </select>
        ) : null}
        <span className="chip"><CalendarDays size={12} /> {hariAktif.length} hari aktif</span>
        <span className="chip"><Repeat size={12} /> {jumlahJam} jam/hari</span>
        <span className={cx('chip', data.ringkas?.bentrok ? '!border-rose-200 !bg-rose-50 !text-rose-700' : '')}>
          {data.ringkas?.bentrok ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {data.ringkas?.bentrok || 0} bentrok
        </span>
        {data.target?.aktif ? (
          <span className={cx('chip', (data.target.rows || []).some(t => t.status === 'kurang')
            ? '!border-amber-300 !bg-amber-50 !text-amber-800' : '')} data-chip-target>
            <AlertTriangle size={12} /> target {(data.target.minggu || 0)} jam/pekan ·
            {' '}{(data.target.rows || []).filter(t => t.status === 'kurang').length} kelas kurang
          </span>
        ) : null}
        {view === 'kelas' ? <span className="text-[11.5px] text-slate-400">Tarik kartu pelajaran untuk memindahkan slot.</span> : null}
        {ctx.can('jadwal', 'delete') ? (
          <div className="flex flex-wrap items-center gap-2 border-l border-slate-200 pl-2" data-kontrol-hapus-matriks>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-rose-600" checked={allVisibleSelected}
                disabled={!slotTerlihatIds.length}
                onChange={e => setSlotTerpilih(selected => e.target.checked
                  ? [...new Set([...selected, ...slotTerlihatIds])]
                  : selected.filter(id => !slotTerlihatIds.includes(id)))}
                data-pilih-semua-slot />
              Pilih semua pada tampilan
            </label>
            <button type="button" className="btn-ghost btn-sm text-rose-700" disabled={!slotTerpilih.length || hapusBusy}
              onClick={hapusTerpilih} data-slot-hapus-terpilih>
              {hapusBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Hapus Terpilih ({slotTerpilih.length})
            </button>
            <button type="button" className="btn-ghost btn-sm text-rose-700" disabled={!rows.length}
              onClick={resetMatriksPilih} data-reset-matriks>
              <RefreshCw size={13} /> Reset Matriks TA Dipilih
            </button>
          </div>
        ) : null}
      </div>

      {/* VALIDASI TARGET JAM: peringatan per kelas (kurang / lebih dari target) */}
      {data.target?.aktif && (data.target.rows || []).length ? (
        <div className="card p-3" data-target-kelas>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] font-extrabold text-slate-800">
              Target Jam Pelajaran per Pekan · standar {(data.target.minggu || 0)} jam
            </p>
            <p className="text-[11px] text-slate-500">
              {(data.target.rows || []).filter(t => t.status === 'pas').length} pas ·{' '}
              <span className="font-bold text-amber-700">{(data.target.rows || []).filter(t => t.status === 'kurang').length} kurang</span> ·{' '}
              <span className="font-bold text-rose-700">{(data.target.rows || []).filter(t => t.status === 'lebih').length} lebih</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(data.target.rows || []).map(t => (
              <span key={t.id} data-target-item={t.id} title={`${t.nama}: ${t.terisi} dari target ${t.target} jam per pekan${t.khusus ? ' (target khusus kelas)' : ''}`}
                className={cx('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] font-semibold',
                  t.status === 'pas' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : t.status === 'kurang' ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : t.status === 'lebih' ? 'border-rose-300 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500')}>
                {t.status === 'kurang' ? <AlertTriangle size={11} /> : t.status === 'lebih' ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                {t.nama} <b>{t.terisi}</b>/{t.target}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!kelas.length ? <Card><Empty icon={Users} title="Belum ada kelas" desc="Tambahkan kelas/rombel terlebih dahulu di menu Data Kelas." /></Card>
        : !hariAktif.length ? <Card><Empty icon={CalendarDays} title="Hari pembelajaran belum diatur" desc="Buka tab Pengaturan Jadwal untuk memilih hari aktif dan jam pelajaran." /></Card>
          : view === 'semua' ? gridSemua()
            : view === 'guru' ? (
              !guruTerpilih ? (
                <Card><Empty icon={Users} title="Pilih guru" desc="Pilih nama guru untuk melihat dan menyusun jadwal mengajarnya." /></Card>
              ) : (
                <div className="space-y-2">
                  <div className="card p-3">
                    <p className="text-[13.5px] font-extrabold text-slate-800">{guruTerpilih.nama}</p>
                    <p className="text-[11.5px] text-slate-500">
                      {rows.filter(r => Number(r.guru_id) === Number(guruId)).length} jam mengajar pada tahun pelajaran ini
                      {guruTerpilih.jabatan ? ` · ${guruTerpilih.jabatan}` : ''}
                    </p>
                  </div>
                  {gridHorizontal([k || kelas[0]])}
                </div>
              )
            ) : gridHorizontal([k || kelas[0]])}

      {/* rekap jam mengajar guru */}
      <Card title="Rekap Jam Mengajar per Guru" subtitle="Dihitung dari seluruh slot jadwal pada tahun pelajaran aktif">
        <div className="tbl-wrap max-h-[320px]">
          <table className="tbl">
            <thead><tr><th>Guru</th><th className="text-center">Jumlah Jam</th><th>Mata Pelajaran</th></tr></thead>
            <tbody>
              {(() => {
                const map = new Map();
                for (const r of rows) {
                  const key = Number(r.guru_id) || 0;
                  const o = map.get(key) || { nama: r.guru_nama || '(belum dipilih)', jam: 0, mapel: new Set() };
                  o.jam++;
                  if (r.mapel_nama) o.mapel.add(r.mapel_nama);
                  map.set(key, o);
                }
                const list = [...map.values()].sort((a, b) => b.jam - a.jam);
                if (!list.length) return <tr><td colSpan={3} className="py-6 text-center text-slate-400">Belum ada slot jadwal.</td></tr>;
                return list.map((g, i) => (
                  <tr key={i}><td className="font-semibold">{g.nama}</td><td className="text-center">{g.jam}</td>
                    <td className="text-[12px] text-slate-500">{[...g.mapel].join(', ')}</td></tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ==================================================================
   MODAL SLOT (tambah / ubah, termasuk merge kelas)
   ================================================================== */
function ModalSlot({ open, slot, onClose, simpan, data, kelas, mapel, guru, sesi, hariAktif, sesiHari }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const sesiUntuk = (hari) => (sesiHari && sesiHari[Number(hari)]) || sesi || [];
  useEffect(() => {
    if (!open) return;
    const hariAwal = slot?.hari ?? hariAktif[0] ?? 1;
    const daftar = (sesiHari && sesiHari[Number(hariAwal)]) || sesi || [];
    setF({
      id: slot?.id || '', hari: hariAwal, sesi: slot?.sesi ?? (daftar.find(s => !s.istirahat)?.idx || 1),
      mapel_id: slot?.mapel_id || '', guru_id: slot?.guru_id || '', ruang: slot?.ruang || '',
      kelas_ids: slot?.kelas_ids || [], catatan: slot?.catatan || ''
    });
  }, [open, slot]);
  const kelasIds = Array.isArray(f.kelas_ids) ? f.kelas_ids : [];
  const toggleKelas = (id) => setF(v => ({
    ...v, kelas_ids: (v.kelas_ids || []).includes(id) ? v.kelas_ids.filter(x => x !== id) : [...(v.kelas_ids || []), id]
  }));
  const daftarSesi = sesiUntuk(f.hari);
  const jam = daftarSesi.find(s => Number(s.idx) === Number(f.sesi)) || (sesi || []).find(s => Number(s.idx) === Number(f.sesi));
  /* GURU TERKUNCI: guru pengampu mengikuti Data Master Mata Pelajaran */
  const mapelDipilih = useMemo(() => (mapel || []).find(m => Number(m.id) === Number(f.mapel_id)) || null, [mapel, f.mapel_id]);
  const pengampuMapel = (mapelDipilih && mapelDipilih.guru) || [];
  const ruangTersedia = (data?.ruang || []).filter(r => Number(r.aktif) === 1);
  const ruangSaatIni = (data?.ruang || []).find(r => String(r.nama).toLowerCase() === String(f.ruang || '').toLowerCase());
  const ruangLama = f.ruang && !ruangSaatIni;
  const guruTerkunci = pengampuMapel.length === 1 ? pengampuMapel[0] : null;
  const multiPengampu = pengampuMapel.length > 1;
  const guruCadangan = useMemo(() => (guru || []).find(g => Number(g.id) === Number(f.guru_id)) || null, [guru, f.guru_id]);
  /* multi pengampu: guru WAJIB salah satu dari daftar Data Master */
  useEffect(() => {
    if (!multiPengampu) return;
    if (pengampuMapel.some(g => Number(g.id) === Number(f.guru_id))) return;
    setF(v => ({ ...v, guru_id: pengampuMapel[0].id }));
  }, [f.mapel_id, multiPengampu]);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    await simpan({ ...f, id: f.id || undefined });
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title={f.id ? 'Ubah Slot Jadwal' : 'Tambah Slot Jadwal'} size="lg"
      subtitle={jam ? `${HARI[f.hari]} · ${jam.mulai}–${jam.selesai}${jam.istirahat ? ' (istirahat)' : ''}` : 'Pilih hari & sesi jam pelajaran.'}
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn-primary" form="fSlot" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan Jadwal</button></>}>
      <form id="fSlot" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Hari" required>
          <select className="input" value={f.hari} onChange={e => setF(v => ({ ...v, hari: Number(e.target.value) }))}>
            {hariAktif.map(h => <option key={h} value={h}>{HARI[h]}</option>)}
          </select>
        </Field>
        <Field label="Sesi Jam Pelajaran" required hint={sesiHari && sesiHari[Number(f.hari)] ? 'Jam khusus untuk hari ini.' : 'Mengikuti pengaturan jam umum.'}>
          <select className="input" value={f.sesi} onChange={e => setF(v => ({ ...v, sesi: Number(e.target.value) }))} data-sesi-slot>
            {daftarSesi.filter(s => !s.istirahat).map(s => (
              <option key={s.idx} value={s.idx}>{s.label || `Jam ${s.no}`} · {s.mulai}–{s.selesai}</option>
            ))}
          </select>
        </Field>
        <Field label="Mata Pelajaran" required>
          <select className="input" value={f.mapel_id} required data-mapel-slot
            onChange={e => {
              const terpilih = mapel.find(m => Number(m.id) === Number(e.target.value));
              setF(v => ({
                ...v, mapel_id: Number(e.target.value), guru_id: '',
                ruang: terpilih?.ruang_wajib_nama || v.ruang || ''
              }));
            }}>
            <option value="">— pilih mapel —</option>
            {mapel.map(m => (
              <option key={m.id} value={m.id}>
                {m.kode} · {m.nama}{(m.guru || []).length ? ` — ${m.guru[0].nama}` : ' — guru belum diatur'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Guru Pengampu"
          hint={guruTerkunci
            ? 'Terkunci otomatis sesuai Data Master Mata Pelajaran (tidak dapat diubah di sini).'
            : (multiPengampu
              ? `Mapel ini punya ${pengampuMapel.length} guru pengampu — pilih salah satu dari daftar (guru lain tidak dapat dipilih).`
              : (mapelDipilih ? 'Atur guru pengampu di tab Mata Pelajaran agar terkunci otomatis.' : 'Pilih mata pelajaran lebih dahulu.'))}>
          {multiPengampu ? (
            <div className="flex items-center gap-2" data-guru-terkunci={f.guru_id || ''}>
              <Lock size={14} className="shrink-0 text-emerald-600" />
              <select className="input" value={f.guru_id} data-guru-pengampu
                onChange={e => setF(v => ({ ...v, guru_id: Number(e.target.value) }))}>
                {pengampuMapel.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
            </div>
          ) : (
            <div className={cx('flex items-center gap-2 rounded-xl border px-3 py-2',
              guruTerkunci ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50')} data-guru-terkunci={guruTerkunci ? guruTerkunci.id : ''}>
              <Lock size={14} className={guruTerkunci ? 'text-emerald-600' : 'text-slate-400'} />
              <span className={cx('min-w-0 flex-1 truncate text-[13px] font-semibold', guruTerkunci ? 'text-emerald-900' : 'text-slate-500')}>
                {guruTerkunci ? guruTerkunci.nama : (guruCadangan ? `${guruCadangan.nama} (akan disimpan sebagai pengampu)` : 'Belum ada guru pengampu')}
              </span>
              {guruTerkunci ? <span className="badge badge-aman shrink-0">Terkunci</span> : null}
            </div>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Kelas / Rombel" required hint="Centang lebih dari satu kelas untuk pembelajaran gabungan (merge).">
            <div className="grid max-h-[180px] gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2">
              {kelas.map(k => (
                <label key={k.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]',
                  kelasIds.includes(k.id) ? 'bg-orange-50 font-semibold text-orange-800' : 'hover:bg-slate-50')}>
                  <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={kelasIds.includes(k.id)} onChange={() => toggleKelas(k.id)} />
                  {k.nama}
                </label>
              ))}
            </div>
          </Field>
          {kelasIds.length > 1 ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-rose-600">
              <Repeat size={12} /> Slot gabungan: {kelasIds.map(id => (kelas.find(k => k.id === id) || {}).nama).filter(Boolean).join(' + ')}
            </p>
          ) : null}
        </div>
        <Field label="Ruang" hint={mapelDipilih?.ruang_wajib_nama
          ? 'Ruangan dikunci sesuai aturan Mata Pelajaran.'
          : 'Pilih otomatis atau ruangan aktif dari master.'}>
          {mapelDipilih?.ruang_wajib_nama ? (
            <input className="input" value={mapelDipilih.ruang_wajib_nama} readOnly data-ruang-slot />
          ) : (
            <select className="input" value={f.ruang || ''} data-ruang-slot
              onChange={e => setF(v => ({ ...v, ruang: e.target.value }))}>
              <option value="">Alokasi otomatis</option>
              {ruangTersedia.map(r => <option key={r.id} value={r.nama}>{r.nama}</option>)}
              {ruangSaatIni && Number(ruangSaatIni.aktif) !== 1
                ? <option value={ruangSaatIni.nama} disabled>{ruangSaatIni.nama} · nonaktif</option> : null}
              {ruangLama ? <option value={f.ruang}>{f.ruang} · ruang lama</option> : null}
            </select>
          )}
        </Field>
        <Field label="Catatan"><input className="input" value={f.catatan} onChange={e => setF(v => ({ ...v, catatan: e.target.value }))} /></Field>
      </form>
    </Modal>
  );
}

/* ==================================================================
   PEMETAAN JAM GURU (target batas jam mengajar per pekan & per bulan)
   · Jam "terpasang" dihitung dari slot jadwal guru pada tahun pelajaran ini.
   · Badge KUNING = kurang dari target, MERAH = melebihi target.
   ================================================================== */
function GuruTargetTab({ ctx, data, ta, onLoad }) {
  const { can, toast } = ctx;
  const bolehUbah = can('jadwal', 'write');
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bulan, setBulan] = useState('');
  const [cari, setCari] = useState('');
  const [edit, setEdit] = useState({});      // guru_id → {target_minggu,target_bulan,catatan}
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/jadwal/guru-target?ta=' + encodeURIComponent(ta) + (bulan ? '&bulan=' + bulan : ''))
      .then(r => {
        setD(r);
        setBulan(b => b || r.bulan || '');
        const e = {};
        for (const g of (r.rows || [])) {
          e[g.guru_id] = { target_minggu: g.target_minggu || '', target_bulan: g.target_bulan || '', catatan: g.catatan || '' };
        }
        setEdit(e);
      })
      .catch(err => toast.err(err.message)).finally(() => setLoading(false));
  }, [ta, bulan]);
  useEffect(load, [load]);

  async function simpanSemua() {
    const items = (d?.rows || []).map(g => ({
      guru_id: g.guru_id,
      target_minggu: Number(edit[g.guru_id]?.target_minggu || 0),
      target_bulan: Number(edit[g.guru_id]?.target_bulan || 0),
      catatan: edit[g.guru_id]?.catatan || ''
    }));
    if (!items.length) return;
    setBusy(true);
    try {
      const r = await api('/api/jadwal/guru-target', { method: 'POST', body: { items, ta, bulan } });
      toast.ok(r.pesan || 'Target jam guru disimpan.');
      onLoad && onLoad();
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  /** isi cepat: target minggu guru = jam terpasang (menyamakan semua) */
  function samakanTarget() {
    const next = { ...edit };
    for (const g of (d?.rows || [])) {
      if (!g.jam_minggu) continue;
      next[g.guru_id] = { ...next[g.guru_id], target_minggu: g.jam_minggu };
    }
    setEdit(next);
    toast.ok('Target diisi sesuai jam terpasang — tekan Simpan untuk menerapkan.');
  }

  if (loading && !d) return <Spinner label="Memuat pemetaan jam guru…" />;
  const rows = (d?.rows || []).filter(g => !cari
    || `${g.nama} ${g.nip} ${g.jabatan} ${(g.mapel || []).join(' ')}`.toLowerCase().includes(cari.toLowerCase()));
  const rk = d?.ringkas || {};

  return (
    <div className="space-y-4" data-tab-target>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Guru Punya Target" value={`${rk.ada_target || 0}/${rk.guru || 0}`} sub="guru dipetakan" icon={Users} tone="sky" />
        <Stat label="Kurang Jam" value={rk.kurang || 0} sub="perlu ditambah pembagian jam" icon={AlertTriangle} tone="orange" />
        <Stat label="Melebihi Target" value={rk.lebih || 0} sub="jam melebihi batas" icon={AlertTriangle} tone="rose" />
        <Stat label="Total Jam Terpasang" value={rk.total_jam || 0} sub={`pekan efektif ${rk.pekan_efektif || 0} · ${rk.hari_efektif || 0} hari`} icon={CalendarDays} tone="violet" />
      </div>

      <Card title="Pemetaan Batas Jam Mengajar Guru"
        subtitle="Isi target jam per pekan (dan/atau per bulan). Jam terpasang dihitung otomatis dari slot jadwal tahun pelajaran ini."
        right={<div className="flex flex-wrap items-center gap-2">
          <select className="input !w-auto !py-1.5 text-[12px]" value={bulan} onChange={e => setBulan(e.target.value)} data-target-bulan>
            {(d?.bulan_list || []).map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input !w-[190px] !py-1.5 !pl-8 text-[12px]" value={cari}
              onChange={e => setCari(e.target.value)} placeholder="Cari guru / mapel…" data-target-cari />
          </div>
          {bolehUbah ? (
            <>
              <button className="btn-ghost btn-sm" onClick={samakanTarget} data-target-samakan>
                <Copy size={13} /> Isi = Jam Terpasang
              </button>
              <button className="btn-primary btn-sm" onClick={simpanSemua} disabled={busy} data-target-simpan>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Simpan Target
              </button>
            </>
          ) : null}
        </div>}>
        <Alert tone="info" title="Cara membaca status">
          Badge <b className="text-amber-700">kuning</b> = jumlah jam jadwal masih <b>kurang</b> dari target,
          <b className="text-rose-700"> merah</b> = melebihi target, hijau = sesuai.
          Target <b>0</b> berarti guru tersebut belum dipetakan (tidak dinilai). Jam per bulan dikira-kira dari
          pekan efektif pada bulan terpilih (libur/ujian di kalender akademik ikut dihitung).
        </Alert>
        <div className="tbl-wrap max-h-[60vh] overflow-auto" data-target-wrap>
          <table className="tbl" data-tbl="guru-target">
            <thead><tr>
              <th className="w-8 c">No</th><th className="sticky-col">Nama Guru</th><th>Mata Pelajaran</th>
              <th className="c">Jam Terpasang/Pekan</th><th className="c">Perkiraan Jam/Bulan</th>
              <th className="c w-[110px]">Target/Pekan</th><th className="c w-[110px]">Target/Bulan</th>
              <th className="c">Status</th><th>Catatan</th>
            </tr></thead>
            <tbody>
              {rows.map((g, i) => {
                const st = g.status;
                const tone = st === 'pas' ? 'badge-aman' : st === 'kurang' ? 'badge-pantau' : st === 'lebih' ? 'badge-siaga' : '';
                return (
                  <tr key={g.guru_id} data-guru-target={g.guru_id}
                    className={cx(st === 'kurang' && 'bg-amber-50/50', st === 'lebih' && 'bg-rose-50/40')}>
                    <td className="c">{i + 1}</td>
                    <td className="sticky-col">
                      <div className="font-semibold text-slate-800">{g.nama}</div>
                      <div className="text-[10.5px] text-slate-500">{g.jabatan || g.role_label}{g.nip ? ` · NIP ${g.nip}` : ''}</div>
                    </td>
                    <td className="text-[11.5px]">{(g.mapel || []).join(', ') || <span className="text-slate-400">belum ada jam</span>}</td>
                    <td className="c font-bold">{g.jam_minggu}</td>
                    <td className="c">{g.jam_bulan}</td>
                    <td className="c">
                      <input type="number" min="0" max="80" className="input !w-[86px] !py-1 text-center text-[12px]"
                        disabled={!bolehUbah} value={edit[g.guru_id]?.target_minggu ?? ''}
                        data-target-minggu={g.guru_id}
                        onChange={e => setEdit(v => ({ ...v, [g.guru_id]: { ...v[g.guru_id], target_minggu: e.target.value } }))} />
                    </td>
                    <td className="c">
                      <input type="number" min="0" max="400" className="input !w-[86px] !py-1 text-center text-[12px]"
                        disabled={!bolehUbah} value={edit[g.guru_id]?.target_bulan ?? ''}
                        data-target-bulan-guru={g.guru_id}
                        onChange={e => setEdit(v => ({ ...v, [g.guru_id]: { ...v[g.guru_id], target_bulan: e.target.value } }))} />
                    </td>
                    <td className="c">
                      {st === 'belum' ? <span className="text-[11px] text-slate-400">belum dipetakan</span> : (
                        <span className={cx('badge', tone)} data-target-status={g.guru_id}>
                          {st === 'kurang' ? `Kurang ${Math.abs(g.selisih)} jam`
                            : st === 'lebih' ? `Lebih ${g.selisih} jam` : 'Sesuai'}
                        </span>
                      )}
                    </td>
                    <td>
                      <input className="input !py-1 text-[11.5px]" disabled={!bolehUbah}
                        placeholder="mis. juga wali kelas XI AKL"
                        value={edit[g.guru_id]?.catatan ?? ''}
                        data-target-catatan={g.guru_id}
                        onChange={e => setEdit(v => ({ ...v, [g.guru_id]: { ...v[g.guru_id], catatan: e.target.value } }))} />
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={9} className="c text-slate-400">Tidak ada guru yang cocok.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ==================================================================
   MATA PELAJARAN
   ================================================================== */
function MapelTab({ ctx, data, onLoad }) {
  const { can, toast, filters } = ctx;
  const [rows, setRows] = useState(data?.mapel || []);
  const [guru, setGuru] = useState(data?.guru || []);
  const [ruang, setRuang] = useState(data?.ruang || []);
  const [edit, setEdit] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const ta = filters?.ta || '';
  const load = () => api('/api/mapel?ta=' + encodeURIComponent(ta))
    .then(r => { setRows(r.rows); setGuru(r.guru); setRuang(r.ruang || []); }).catch(e => toast.err(e.message));
  useEffect(() => { load(); }, [ta]);
  async function hapus(m) {
    /* tampilkan dampak relasi (slot lintas tahun pelajaran + riwayat absensi) sebelum menghapus */
    let dampak = null;
    try { dampak = (await api('/api/mapel/' + m.id + '?dry=1', { method: 'DELETE' })).dampak; }
    catch (e) { toast.err(e.message); return; }
    const rincian = [
      dampak.slot ? `${dampak.slot} slot jadwal (${dampak.ta} tahun pelajaran)` : 'tidak ada slot jadwal',
      dampak.sesi ? `${dampak.sesi} sesi absensi` : null,
      dampak.absensi_siswa ? `${dampak.absensi_siswa} catatan absensi siswa` : null,
      dampak.absensi_guru ? `${dampak.absensi_guru} absensi guru` : null,
      dampak.poin_otomatis ? `${dampak.poin_otomatis} catatan poin otomatis dari absensi` : null
    ].filter(Boolean).join('\n• ');
    if (!window.confirm(`Hapus mata pelajaran “${m.nama}”?\n\nAkan ikut dihapus:\n• ${rincian}\n\nSetelah dihapus, mapel dapat dibuat ulang. Lanjutkan?`)) return;
    try {
      const r = await api('/api/mapel/' + m.id, { method: 'DELETE' });
      toast.ok(r.pesan || 'Mata pelajaran dihapus.');
      load(); onLoad();
    } catch (e) { toast.err(e.message); }
  }
  return (
    <Card title="Daftar Mata Pelajaran"
      subtitle={`${rows.length} mata pelajaran · guru pengampu pada kolom kanan otomatis mengunci pilihan guru di form slot jadwal`}
      right={<div className="flex flex-wrap gap-1.5">
        <a className="btn-ghost btn-sm" href={(window.__BASE__ || '') + '/api/mapel/template.xlsx'} download data-template-mapel>
          <Download size={13} /> Template Excel
        </a>
        {can('jadwal', 'write') ? (
          <>
            <button className="btn-soft btn-sm" onClick={() => setImportOpen(true)} data-import-mapel>
              <Upload size={13} /> Import Mata Pelajaran
            </button>
            <button className="btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={14} /> Tambah Mapel</button>
          </>
        ) : null}
      </div>}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Kode</th><th>Nama Mata Pelajaran</th><th>Kelompok</th><th className="text-center">Maks Jam/Hari</th><th>Guru Pengampu</th><th>Ruang Wajib</th><th className="text-center">Slot</th><th className="w-24">Aksi</th></tr></thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id}>
                <td className="font-mono text-[12px] font-bold">{m.kode}</td>
                <td className="font-semibold">{m.nama}</td>
                <td className="text-slate-500">{m.kelompok || '-'}</td>
                <td className="text-center">{m.max_jam_hari || '-'}</td>
                <td className="text-[12px]">
                  {(m.guru || []).length ? (
                    <span className="flex flex-wrap items-center gap-1">
                      {(m.guru || []).map(g => <span key={g.id} className="chip !py-0.5">{g.nama}</span>)}
                      {(m.guru || []).length === 1
                        ? <span className="badge badge-aman !py-0.5">terkunci</span>
                        : <span className="badge badge-pantau !py-0.5">{(m.guru || []).length} pengampu</span>}
                    </span>
                  ) : <span className="font-semibold text-rose-600">belum diatur</span>}
                </td>
                <td>{m.ruang_wajib_nama ? <span className="chip">{m.ruang_wajib_nama}</span> : <span className="text-slate-400">Otomatis</span>}</td>
                <td className="text-center text-slate-500">{m.dipakai ?? '-'}</td>
                <td>
                  {can('jadwal', 'write') ? (
                    <div className="flex gap-1">
                      <button type="button" data-edit-mapel={m.id} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setEdit(m)}><Pencil size={14} /></button>
                      <button type="button" data-hapus-mapel={m.id} className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => hapus(m)}><Trash2 size={14} /></button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={8} className="py-8 text-center text-slate-400">Belum ada mata pelajaran. Tambahkan minimal satu sebelum menyusun jadwal.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ModalMapel open={!!edit} row={edit} guru={guru} ruang={ruang} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); load(); onLoad(); }} />
      <ModalImportMapel open={importOpen} onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); load(); onLoad(); }} />
      <a className="mt-3 inline-flex text-[12px] font-semibold text-orange-600 hover:underline" href={(window.__BASE__ || '') + '/api/mapel/template.xlsx'} download>
        <Download size={13} className="mr-1" /> Template Excel daftar mapel
      </a>
    </Card>
  );
}

/* ---------------- Import Mata Pelajaran (massal) ---------------- */
function ModalImportMapel({ open, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setFile(null); setPreview(null); setErr(''); } }, [open]);

  async function baca(f) {
    setErr(''); setBusy(true); setPreview(null);
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      const base64 = btoa(bin);
      setFile({ base64, filename: f.name });
      setPreview(await api('/api/mapel/import/preview', { method: 'POST', body: { base64, filename: f.name } }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/api/mapel/import/commit', { method: 'POST', body: { rows: preview.rows } });
      toast.ok(r.pesan || 'Import mata pelajaran selesai.');
      onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Import Mata Pelajaran" size="lg"
      subtitle="Unggah Excel/CSV: kode, nama, kelompok, maks jam/hari, dan guru pengampu (username/nama, pisah koma)."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <a className="btn-ghost" href={(window.__BASE__ || '') + '/api/mapel/template.xlsx'} download><Download size={14} /> Template</a>
        <button className="btn-primary" disabled={!preview || busy} onClick={commit} data-import-mapel-simpan>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null} Impor {preview ? `(${preview.siap} mapel)` : ''}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-dashed border-orange-200 bg-orange-50/50 p-4 text-center">
          <Upload size={22} className="mx-auto text-orange-500" />
          <p className="mt-1 text-[13px] font-semibold text-slate-700">Pilih berkas mata pelajaran (.xlsx / .csv)</p>
          <p className="text-[11.5px] text-slate-500">Kolom: KODE · NAMA MAPEL · KELOMPOK · MAKS JAM/HARI · GURU PENGAMPU</p>
          <input type="file" accept=".xlsx,.xls,.csv" className="mt-2 w-full text-[12px]" data-file-mapel
            onChange={e => e.target.files[0] && baca(e.target.files[0])} />
        </div>
        {err ? <Alert tone="danger" title="Gagal membaca berkas">{err}</Alert> : null}
        {busy && !preview ? <Spinner label="Menganalisa berkas…" /> : null}
        {preview ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-[12px]">
              <span className="chip">Total {preview.total} baris</span>
              <span className="chip !border-emerald-200 !bg-emerald-50 !text-emerald-700">Siap {preview.siap}</span>
              {preview.baru ? <span className="chip !border-violet-200 !bg-violet-50 !text-violet-700">Baru {preview.baru}</span> : null}
              {preview.perbarui ? <span className="chip !border-sky-200 !bg-sky-50 !text-sky-700">Perbarui {preview.perbarui}</span> : null}
              {preview.total - preview.siap ? <span className="chip !border-rose-200 !bg-rose-50 !text-rose-700">{preview.total - preview.siap} bermasalah</span> : null}
            </div>
            <div className="max-h-[320px] overflow-auto rounded-xl border border-slate-200">
              <table className="tbl" data-tbl-mapel-import>
                <thead><tr><th>Baris</th><th>Kode</th><th>Nama Mapel</th><th>Kelompok</th><th className="text-center">Maks Jam</th><th>Guru Pengampu</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.baris} className={r.error ? 'bg-rose-50/60' : ''}>
                      <td className="text-center">{r.baris}</td>
                      <td className="font-mono text-[11.5px]">{r.kode || '-'}</td>
                      <td className="font-semibold">{r.nama}</td>
                      <td className="text-[11.5px]">{r.kelompok || '-'}</td>
                      <td className="text-center">{r.max_jam_hari || '-'}</td>
                      <td className="text-[11.5px]">{r.guru_nama || '-'}</td>
                      <td className="text-[11px]">
                        {r.error ? <span className="font-semibold text-rose-700">{r.error}</span>
                          : <span className="font-semibold text-emerald-700">{r.aksi === 'perbarui' ? 'Perbarui' : 'Baru'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-slate-500">Baris bermasalah tidak disimpan. Guru pengampu yang terisi akan langsung mengunci pilihan guru pada slot jadwal mapel tersebut.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ModalMapel({ open, row, guru, ruang, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({
      id: row?.id || '', kode: row?.kode || '', nama: row?.nama || '', kelompok: row?.kelompok || '',
      max_jam_hari: row?.max_jam_hari || '', guru_ids: row?.guru_ids || [], ruang_id: row?.ruang_id || ''
    });
  }, [open, row]);
  const toggle = (id) => setF(v => ({ ...v, guru_ids: (v.guru_ids || []).includes(id) ? v.guru_ids.filter(x => x !== id) : [...(v.guru_ids || []), id] }));
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/mapel/save', { method: 'POST', body: f }); toast.ok('Mata pelajaran disimpan.'); onSaved?.(); }
    catch (e2) { toast.err(e2.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={f.id ? 'Ubah Mata Pelajaran' : 'Tambah Mata Pelajaran'} size="md"
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button><button className="btn-primary" form="fMapel" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan</button></>}>
      <form id="fMapel" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode Mapel" required><input className="input uppercase" value={f.kode} required placeholder="MTK" onChange={e => setF(v => ({ ...v, kode: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Nama Mapel" required><input className="input" value={f.nama} required onChange={e => setF(v => ({ ...v, nama: e.target.value }))} /></Field>
        <Field label="Kelompok"><input className="input" value={f.kelompok} placeholder="Umum / Produktif / Muatan Lokal" onChange={e => setF(v => ({ ...v, kelompok: e.target.value }))} /></Field>
        <Field label="Maks Jam per Hari" hint="0 / kosong = ikut batas umum di pengaturan.">
          <input type="number" min="0" max="12" className="input" value={f.max_jam_hari} onChange={e => setF(v => ({ ...v, max_jam_hari: e.target.value }))} />
        </Field>
        <Field label="Ruangan Wajib" hint="Kosong = dialokasikan otomatis ke ruangan aktif yang tersedia.">
          <select className="input" value={f.ruang_id || ''} data-mapel-ruang-wajib
            onChange={e => setF(v => ({ ...v, ruang_id: e.target.value ? Number(e.target.value) : '' }))}>
            <option value="">Alokasi otomatis</option>
            {(ruang || []).filter(r => Number(r.aktif) === 1).map(r =>
              <option key={r.id} value={r.id}>{r.nama}{r.jenis ? ` · ${r.jenis}` : ''}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Guru Pengampu" hint="Guru yang dipilih di sini otomatis tersedia saat menyusun slot mapel ini.">
            <div className="grid max-h-[160px] gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2">
              {guru.map(g => (
                <label key={g.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]',
                  f.guru_ids?.includes(g.id) ? 'bg-orange-50 font-semibold text-orange-800' : 'hover:bg-slate-50')}>
                  <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={(f.guru_ids || []).includes(g.id)} onChange={() => toggle(g.id)} />
                  {g.nama}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/* ==================================================================
   PENGATURAN JADWAL & ABSENSI
   ================================================================== */
function PengaturanTab({ ctx, data, onLoad }) {
  const { can, toast } = ctx;
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(null);
  /* hooks WAJIB di atas early-return (React error #310 bila setelah `if (!f) return`) */
  const [hariEdit, setHariEdit] = useState(null);
  useEffect(() => {
    api('/api/jadwal/pengaturan').then(r => setF({
      hari: r.config.hari,
      max_jam: r.config.maxJam,
      sesi: (r.config.sesi || []).map(s => ({ label: s.label, mulai: s.mulai, selesai: s.selesai, istirahat: !!s.istirahat })),
      sesi_hari: Object.fromEntries(Object.entries(r.config.sesiHari || {}).map(([h, list]) => [h,
        (list || []).map(s => ({ label: s.label, mulai: s.mulai, selesai: s.selesai, istirahat: !!s.istirahat }))])),
      max_mapel_jam: r.config.maxMapelJam, max_guru_jam: r.config.maxGuruJam,
      target_jam: { aktif: !!r.target?.aktif, minggu: r.target?.minggu || 40 },
      absensi: { ...r.absensi }, wa: { ...r.wa }
    })).catch(e => toast.err(e.message));
  }, []);
  if (!f) return <Spinner label="Memuat pengaturan…" />;
  const set = (patch) => setF(v => ({ ...v, ...patch }));
  const setSesi = (i, patch) => setF(v => ({ ...v, sesi: v.sesi.map((s, j) => j === i ? { ...s, ...patch } : s) }));
  const sesiHariIni = (h) => (f.sesi_hari && f.sesi_hari[String(h)]) || null;
  const aktifkanHari = (h) => setF(v => ({
    ...v,
    sesi_hari: { ...(v.sesi_hari || {}), [String(h)]: (v.sesi_hari && v.sesi_hari[String(h)]) || v.sesi.map(x => ({ ...x })) }
  }));
  const matikanHari = (h) => setF(v => {
    const next = { ...(v.sesi_hari || {}) };
    delete next[String(h)];
    return { ...v, sesi_hari: next };
  });
  const setSesiHari = (h, i, patch) => setF(v => ({
    ...v,
    sesi_hari: { ...(v.sesi_hari || {}), [String(h)]: (v.sesi_hari[String(h)] || []).map((s, j) => j === i ? { ...s, ...patch } : s) }
  }));
  const tambahSesiHari = (h, istirahat) => setF(v => {
    const list = v.sesi_hari[String(h)] || [];
    const akhir = list[list.length - 1];
    const mulai = akhir ? akhir.selesai : '07:00';
    const [hh, mm] = mulai.split(':').map(Number);
    const total = hh * 60 + mm + (istirahat ? 15 : 45);
    const selesai = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    return { ...v, sesi_hari: { ...v.sesi_hari, [String(h)]: [...list, { label: istirahat ? 'Istirahat' : 'Jam', mulai, selesai, istirahat: !!istirahat }] } };
  });
  const tambahSesi = (istirahat) => setF(v => ({
    ...v, sesi: [...v.sesi, { label: istirahat ? 'Istirahat' : 'Jam', mulai: '07:00', selesai: istirahat ? '07:15' : '07:45', istirahat: !!istirahat }]
  }));
  const hapusSesi = (i) => setF(v => ({ ...v, sesi: v.sesi.filter((s, j) => j !== i) }));
  async function simpan(e) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/jadwal/pengaturan', { method: 'POST', body: f });
      toast.ok(r.pesan || 'Pengaturan disimpan.'); onLoad();
    } catch (e2) { toast.err(e2.message); } finally { setBusy(false); }
  }
  const jamPelajaran = f.sesi.filter(s => !s.istirahat).length;
  return (
    <form onSubmit={simpan} className="grid gap-4 xl:grid-cols-2" data-form-jadwal>
      <Card title="Hari & Jam Pembelajaran" subtitle="Wakasek Kurikulum dapat mengubah kapan sekolah mengadakan KBM">
        <Field label="Hari Pembelajaran Aktif" className="mb-3">
          <div className="flex flex-wrap gap-1.5">
            {HARI.map((h, i) => (
              <button type="button" key={h} disabled={!can('jadwal', 'write')}
                onClick={() => set({ hari: f.hari.includes(i) ? f.hari.filter(x => x !== i) : [...f.hari, i].sort() })}
                className={cx('rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition',
                  f.hari.includes(i) ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-500')}>
                {h}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jam Pelajaran Maksimal per Hari" hint={`Saat ini ${jamPelajaran} jam pelajaran di daftar sesi.`}>
            <input type="number" min="1" max="15" className="input" value={f.max_jam} onChange={e => set({ max_jam: e.target.value })} />
          </Field>
          <Field label="Maks Jam Mapel Sama / Kelas / Hari">
            <input type="number" min="1" max="12" className="input" value={f.max_mapel_jam} onChange={e => set({ max_mapel_jam: e.target.value })} />
          </Field>
          <Field label="Maks Jam Mengajar Guru per Hari">
            <input type="number" min="1" max="15" className="input" value={f.max_guru_jam} onChange={e => set({ max_guru_jam: e.target.value })} />
          </Field>
        </div>
        {/* VALIDASI TARGET JAM PELAJARAN PER KELAS PER PEKAN */}
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3" data-form-target>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" data-target-aktif
              disabled={!can('jadwal', 'write')} checked={!!f.target_jam?.aktif}
              onChange={e => set({ target_jam: { ...f.target_jam, aktif: e.target.checked } })} />
            <span>
              <span className="block text-[12.5px] font-bold text-slate-800">Aktifkan validasi target jam pelajaran per kelas</span>
              <span className="block text-[11px] text-slate-500">
                Menampilkan badge <b className="text-amber-700">kuning</b> (kurang) /
                <b className="text-rose-700"> merah</b> (lebih) pada kelas di matriks jadwal &amp; daftar Pemetaan Jam Guru.
              </span>
            </span>
          </label>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Standar jam pelajaran per pekan (per kelas)"
              hint="Default 40 jam. Target khusus per kelas diatur di menu Data Kelas.">
              <input type="number" min="1" max="80" className="input" data-target-minggu-jam
                disabled={!can('jadwal', 'write')} value={f.target_jam?.minggu ?? 40}
                onChange={e => set({ target_jam: { ...f.target_jam, minggu: e.target.value } })} />
            </Field>
            <div className="flex items-end">
              <p className="text-[11px] text-slate-500">
                Jumlah jam terpasang dihitung otomatis dari slot jadwal tiap kelas pada tahun pelajaran ini.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label !mb-0">Sesi Jam Pelajaran & Istirahat</span>
            <div className="flex gap-1.5">
              <button type="button" className="btn-ghost btn-sm" onClick={() => tambahSesi(false)}><Plus size={12} /> Jam</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => tambahSesi(true)}><Plus size={12} /> Istirahat</button>
            </div>
          </div>
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {f.sesi.map((s, i) => (
              <div key={i} className={cx('grid grid-cols-[minmax(0,1fr)_84px_84px_auto] items-center gap-1.5 rounded-lg border p-1.5',
                s.istirahat ? 'border-amber-200 bg-amber-50/70' : 'border-slate-200')}>
                <input className="input !py-1 !text-[12px]" value={s.label} placeholder={s.istirahat ? 'Istirahat' : 'Jam 1'}
                  onChange={e => setSesi(i, { label: e.target.value })} />
                <input type="time" className="input !py-1 !text-[12px]" value={s.mulai} onChange={e => setSesi(i, { mulai: e.target.value })} />
                <input type="time" className="input !py-1 !text-[12px]" value={s.selesai} onChange={e => setSesi(i, { selesai: e.target.value })} />
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1 text-[10.5px] font-semibold text-amber-700" title="Tandai sebagai jam istirahat">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-amber-500" checked={s.istirahat} onChange={e => setSesi(i, { istirahat: e.target.checked })} />
                    ISH
                  </label>
                  <button type="button" className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => hapusSesi(i)}><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Urutan otomatis mengikuti jam mulai. Jam istirahat tidak dapat diisi pelajaran.</p>
        </div>

        {/* ---------- sesi khusus per hari ---------- */}
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3" data-sesi-per-hari>
          <p className="text-[12px] font-bold text-violet-900">Sesi Jam Khusus per Hari (opsional)</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-violet-800">
            Setiap hari bisa punya label &amp; jam berbeda — mis. Senin jam pertama <b>Upacara</b>, Jumat <b>Pembiasaan</b>,
            atau istirahat <b>Sholat</b>. Hari tanpa pengaturan khusus mengikuti sesi umum di atas.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {f.hari.map(h => (
              <button type="button" key={h} disabled={!can('jadwal', 'write')}
                onClick={() => setHariEdit(hariEdit === h ? null : h)}
                className={cx('chip', sesiHariIni(h) ? '!border-violet-400 !bg-violet-100 !text-violet-800' : '',
                  hariEdit === h && 'ring-2 ring-violet-300')} data-hari-sesi={h}>
                {HARI[h]}{sesiHariIni(h) ? ' ✓' : ''}
              </button>
            ))}
          </div>
          {hariEdit === null ? (
            <p className="mt-2 text-[11px] text-violet-700">Pilih hari untuk mengatur sesi khususnya.</p>
          ) : !sesiHariIni(hariEdit) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-[11.5px] text-slate-600">{HARI[hariEdit]} masih memakai sesi umum.</p>
              <button type="button" className="btn-soft btn-sm" disabled={!can('jadwal', 'write')}
                onClick={() => aktifkanHari(hariEdit)} data-aktifkan-sesi-hari>
                <Plus size={12} /> Atur sesi khusus {HARI[hariEdit]}
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-1.5" data-editor-sesi-hari={hariEdit}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px] font-bold text-violet-900">Sesi {HARI[hariEdit]}</span>
                <button type="button" className="btn-ghost btn-sm" disabled={!can('jadwal', 'write')}
                  onClick={() => tambahSesiHari(hariEdit, false)}><Plus size={12} /> Jam</button>
                <button type="button" className="btn-ghost btn-sm" disabled={!can('jadwal', 'write')}
                  onClick={() => tambahSesiHari(hariEdit, true)}><Plus size={12} /> Istirahat</button>
                <button type="button" className="btn-danger btn-sm ml-auto" disabled={!can('jadwal', 'write')}
                  onClick={() => matikanHari(hariEdit)} data-hapus-sesi-hari>
                  <X size={12} /> Kembali ke sesi umum
                </button>
              </div>
              {(f.sesi_hari[String(hariEdit)] || []).map((s, i) => (
                <div key={i} className={cx('grid grid-cols-[minmax(0,1fr)_84px_84px_auto] items-center gap-1.5 rounded-lg border bg-white p-1.5',
                  s.istirahat ? 'border-amber-200' : 'border-slate-200')}>
                  <input className="input !py-1 !text-[12px]" value={s.label} placeholder={s.istirahat ? 'Istirahat / Sholat' : 'Upacara / Jam 1'}
                    disabled={!can('jadwal', 'write')}
                    onChange={e => setSesiHari(hariEdit, i, { label: e.target.value })} data-label-sesi-hari={i} />
                  <input type="time" className="input !py-1 !text-[12px]" value={s.mulai} disabled={!can('jadwal', 'write')}
                    onChange={e => setSesiHari(hariEdit, i, { mulai: e.target.value })} />
                  <input type="time" className="input !py-1 !text-[12px]" value={s.selesai} disabled={!can('jadwal', 'write')}
                    onChange={e => setSesiHari(hariEdit, i, { selesai: e.target.value })} />
                  <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1 text-[10.5px] font-semibold text-amber-700">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-amber-500" checked={s.istirahat} disabled={!can('jadwal', 'write')}
                        onChange={e => setSesiHari(hariEdit, i, { istirahat: e.target.checked })} />
                      ISH
                    </label>
                    <button type="button" className="rounded p-1 text-slate-400 hover:text-rose-600" disabled={!can('jadwal', 'write')}
                      onClick={() => setF(v => ({ ...v, sesi_hari: { ...v.sesi_hari, [String(hariEdit)]: v.sesi_hari[String(hariEdit)].filter((_, j) => j !== i) } }))}>
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Validasi Absensi Guru (anti-manipulasi)" subtitle="Jendela waktu & syarat bukti mengajar">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Absensi dibuka (menit sebelum mulai)" hint="Default 15 menit.">
              <input type="number" min="0" max="240" className="input" value={f.absensi.buka_menit}
                onChange={e => set({ absensi: { ...f.absensi, buka_menit: e.target.value } })} />
            </Field>
            <Field label="Kunci absensi setelah jam pelajaran selesai (menit)"
              hint="0 = terkunci TEPAT saat jam pelajaran berakhir (disarankan). Seluruh tombol aksi (check-in, presensi siswa, jurnal, tukar jadwal) nonaktif setelah batas ini.">
              <input type="number" min="0" max="60" className="input" value={f.absensi.toleransi_tutup ?? 0}
                onChange={e => set({ absensi: { ...f.absensi, toleransi_tutup: e.target.value } })} data-toleransi-tutup />
            </Field>
            <Field label="Panjang minimal jurnal materi (karakter)">
              <input type="number" min="0" max="500" className="input" value={f.absensi.jurnal_min}
                onChange={e => set({ absensi: { ...f.absensi, jurnal_min: e.target.value } })} />
            </Field>
            <Field label="Masa simpan bukti foto (hari)" hint="Foto otomatis dibersihkan setelah melewati masa ini.">
              <input type="number" min="1" max="3650" className="input" value={f.absensi.foto_hari}
                onChange={e => set({ absensi: { ...f.absensi, foto_hari: e.target.value } })} />
            </Field>
            <Field label="Jendela presensi siswa"
              hint="Mengikuti aturan kunci yang sama: tautan/QR ketua kelas menerima isian sampai jam selesai + toleransi di atas.">
              <input type="text" className="input" value="Otomatis (mengikuti kunci absensi)" disabled readOnly />
            </Field>
          </div>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.absensi.foto_wajib}
                onChange={e => set({ absensi: { ...f.absensi, foto_wajib: e.target.checked ? 1 : 0 } })} />
              <span className="text-[12px]"><b className="text-slate-700">Wajib bukti foto aktivitas kelas</b>
                <span className="block text-[11px] text-slate-500">Guru harus mengunggah foto (dikompres otomatis) saat mengisi absensi.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.absensi.siswa_aktif}
                onChange={e => set({ absensi: { ...f.absensi, siswa_aktif: e.target.checked ? 1 : 0 } })} />
              <span className="text-[12px]"><b className="text-slate-700">Izinkan ketua kelas mengisi presensi</b>
                <span className="block text-[11px] text-slate-500">Lewat tautan/QR sesi mata pelajaran (tanpa login).</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={f.absensi.auto_alpha !== 0}
                onChange={e => set({ absensi: { ...f.absensi, auto_alpha: e.target.checked ? 1 : 0 } })} data-auto-alfa="1" />
              <span className="text-[12px]"><b className="text-slate-700">Alfa otomatis bila guru tidak check-in</b>
                <span className="block text-[11px] text-slate-500">Setelah jam pelajaran berakhir tanpa Check-in/Sakit/Izin, status guru menjadi ALFA dan terkunci.</span></span>
            </label>
          </div>
        </Card>

        <Card title="Notifikasi WhatsApp Rekap Absensi" subtitle="Dikirim otomatis ke Kepala Sekolah & Wakasek Kurikulum">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nomor WhatsApp Kepala Sekolah">
              <input className="input" value={f.wa.kepsek || ''} placeholder="08xxxxxxxxxx" onChange={e => set({ wa: { ...f.wa, kepsek: e.target.value } })} />
            </Field>
            <Field label="Nomor WhatsApp Wakasek Kurikulum">
              <input className="input" value={f.wa.wakasek || ''} placeholder="08xxxxxxxxxx" onChange={e => set({ wa: { ...f.wa, wakasek: e.target.value } })} />
            </Field>
            <Field label="Jam kirim rekap harian (WIB)">
              <input type="time" className="input" value={f.wa.jam || '14:00'} onChange={e => set({ wa: { ...f.wa, jam: e.target.value } })} />
            </Field>
            <Field label="Kirim otomatis">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={!!f.wa.aktif}
                  onChange={e => set({ wa: { ...f.wa, aktif: e.target.checked ? 1 : 0 } })} />
                <span className="text-[12.5px] font-semibold text-slate-700">Aktifkan rekap harian</span>
              </label>
            </Field>
          </div>
          <Alert tone="info" title="Gateway WhatsApp" className="mt-2">
            Pesan memakai gateway yang sama dengan pengingat orang tua (menu Pengaturan → WhatsApp Gateway).
            Tanpa gateway aktif, rekap hanya disimpan sebagai riwayat dan dapat dibuka lewat tautan wa.me.
          </Alert>
        </Card>
      </div>

      {can('jadwal', 'write') ? (
        <div className="xl:col-span-2 flex justify-end gap-2">
          <button className="btn-primary" disabled={busy} data-simpan-pengaturan>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan Pengaturan Jadwal
          </button>
        </div>
      ) : null}
    </form>
  );
}

/* ==================================================================
   MODAL IMPOR JADWAL
   ================================================================== */
/* ==================================================================
   MODAL DUPLIKAT SLOT
   Menyalin satu slot ke sesi berikutnya pada hari yang sama (default),
   atau ke hari/sesi pilihan — berguna untuk menyusun jam beruntun.
   ================================================================== */
function ModalDuplikat({ open, slot, sesi, sesiHari, hariAktif, busy, onClose, onConfirm }) {
  const sesiUntuk = (hari) => (sesiHari && sesiHari[Number(hari)]) || sesi || [];
  const [hari, setHari] = useState(0);
  const [sesiNo, setSesiNo] = useState('');

  useEffect(() => {
    if (!open || !slot) return;
    const h = Number(slot.hari);
    setHari(h);
    /* default = sesi berikutnya (bukan istirahat) pada hari yang sama */
    const daftar = sesiUntuk(h);
    const pos = daftar.findIndex(x => Number(x.idx) === Number(slot.sesi));
    const berikut = (pos >= 0 ? daftar.slice(pos + 1) : daftar).find(x => !x.istirahat);
    setSesiNo(berikut ? String(berikut.idx) : '');
  }, [open, slot]);

  if (!open || !slot) return null;
  const daftar = sesiUntuk(hari);
  const opsi = daftar.filter(x => !x.istirahat);
  const target = daftar.find(x => Number(x.idx) === Number(sesiNo));
  return (
    <Modal open={open} onClose={onClose} size="md" title="Duplikat Slot Jadwal"
      subtitle={`${slot.mapel_nama || slot.mapel_kode || '-'} · ${sesiHari && sesiHari[Number(slot.hari)] ? 'hari sesi khusus' : HARI[Number(slot.hari)]}`}
      footer={<>
        <button className="btn-ghost" type="button" onClick={onClose}>Batal</button>
        <button className="btn-primary" type="submit" form="fDuplikat" disabled={busy || !sesiNo} data-duplikat-simpan>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />} Duplikat Sekarang
        </button>
      </>}>
      <form id="fDuplikat" className="grid gap-3" onSubmit={e => { e.preventDefault(); onConfirm(Number(hari), Number(sesiNo)); }}>
        <div className="rounded-xl border border-orange-200 bg-orange-50/60 px-3 py-2 text-[11.5px] text-orange-900">
          Slot asal: <b>{HARI[Number(slot.hari)]}</b> · sesi {slot.sesi}
          {' '}· mapel <b>{slot.mapel_kode || slot.mapel_nama || '-'}</b>
          {' '}· guru <b>{slot.guru_nama || '-'}</b>
        </div>
        <Field label="Hari Tujuan" required>
          <select className="input" value={hari} data-duplikat-hari onChange={e => { setHari(Number(e.target.value)); setSesiNo(''); }}>
            {hariAktif.map(h => <option key={h} value={h}>{HARI[h]}{sesiHari && sesiHari[h] ? ' (sesi khusus)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Sesi / Jam Tujuan" required
          hint={target ? `${target.mulai}–${target.selesai}${target.label ? ` · ${target.label}` : ''}` : 'Pilih sesi tujuan'}>
          <select className="input" value={sesiNo} data-duplikat-sesi onChange={e => setSesiNo(e.target.value)}>
            <option value="">— pilih sesi —</option>
            {opsi.map(x => (
              <option key={x.idx} value={x.idx}>
                {(x.no ? `Jam ke-${x.no}` : (x.label || `Sesi ${x.idx}`))} · {x.mulai}–{x.selesai}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[11px] text-slate-500">
          Slot baru berisi mapel, guru, kelas, dan ruang yang sama. Sistem menolak bila sesi tujuan
          sudah terisi/berbentrok dengan guru atau kelas yang sama.
        </p>
      </form>
    </Modal>
  );
}

function ModalImport({ open, onClose, ta, onDone }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState('tambah');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setFile(null); setPreview(null); setErr(''); setMode('tambah'); } }, [open]);

  const baca = async (f) => {
    setErr(''); setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      const base64 = btoa(bin);
      setFile({ base64, filename: f.name });
      const r = await api('/api/jadwal/import/preview', { method: 'POST', body: { base64, filename: f.name, ta } });
      setPreview(r);
    } catch (e) { setErr(e.message); setPreview(null); }
    finally { setBusy(false); }
  };
  async function commit() {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/api/jadwal/import/commit', { method: 'POST', body: { ...file, ta, mode } });
      toast.ok(r.pesan || 'Impor jadwal selesai.');
      onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Impor Jadwal Pelajaran" size="lg"
      subtitle="Unggah berkas Excel/CSV sesuai template. Sistem memvalidasi bentrok sebelum menyimpan."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <a className="btn-ghost" href={(window.__BASE__ || '') + '/api/jadwal/template.xlsx'} download><Download size={14} /> Template</a>
        <button className="btn-primary" disabled={!preview || busy} onClick={commit} data-impor-simpan>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null} Impor {preview ? `(${preview.ringkas.siap} slot)` : ''}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-dashed border-orange-200 bg-orange-50/50 p-4 text-center">
          <Upload size={22} className="mx-auto text-orange-500" />
          <p className="mt-1 text-[13px] font-semibold text-slate-700">Pilih berkas jadwal (.xlsx / .csv)</p>
          <p className="text-[11.5px] text-slate-500">Kolom: HARI · JAM MULAI · KODE MAPEL · MAPEL · GURU · KELAS · RUANG</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="mt-2 w-full text-[12px]" onChange={e => e.target.files[0] && baca(e.target.files[0])} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <span className="font-semibold text-slate-600">Mode impor:</span>
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'tambah'} onChange={() => setMode('tambah')} className="accent-orange-600" /> Tambah ke jadwal yang ada</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'ganti'} onChange={() => setMode('ganti')} className="accent-orange-600" /> Ganti seluruh jadwal tahun pelajaran</label>
        </div>
        {err ? <Alert tone="danger" title="Gagal membaca berkas">{err}</Alert> : null}
        {busy && !preview ? <Spinner label="Menganalisa berkas…" /> : null}
        {preview ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-[12px]">
              <span className="chip">Total {preview.ringkas.total} baris</span>
              <span className="chip !border-emerald-200 !bg-emerald-50 !text-emerald-700">Siap {preview.ringkas.siap}</span>
              <span className="chip !border-rose-200 !bg-rose-50 !text-rose-700">Bermasalah {preview.ringkas.error}</span>
              <span className="chip !border-violet-200 !bg-violet-50 !text-violet-700">Mapel baru {preview.ringkas.mapel_baru}</span>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-xl border border-slate-200">
              <table className="tbl">
                <thead><tr><th>Baris</th><th>Hari</th><th>Jam</th><th>Mapel</th><th>Guru</th><th>Kelas</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.baris} className={cx(r.status === 'error' && 'bg-rose-50/60')}>
                      <td className="text-slate-500">{r.baris}</td>
                      <td>{r.hari}</td>
                      <td className="whitespace-nowrap">{r.jam_pelajaran || r.jam}</td>
                      <td className="font-semibold">{r.mapel_nama || r.mapel}</td>
                      <td className="text-[12px]">{r.guru}</td>
                      <td className="text-[12px]">{r.kelas_nama || r.kelas}</td>
                      <td>
                        {r.status === 'error' ? <span className="badge badge-siaga">Bermasalah</span>
                          : r.status === 'mapel-baru' ? <span className="badge badge-prestasi">Mapel baru</span>
                            : <span className="badge badge-aman">Siap</span>}
                        {r.pesan ? <p className="mt-0.5 text-[10.5px] text-slate-500">{r.pesan}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.ringkas.error ? <p className="text-[11.5px] text-amber-700">Baris bermasalah akan dilewati — perbaiki berkas bila ingin semua baris masuk.</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ==================================================================
   MODAL TAUTAN PUBLIK JADWAL
   ================================================================== */
function ModalPublik({ open, onClose, data, onChanged }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/jadwal/publik').then(r => { setInfo(r); muatQr(); }).catch(e => toast.err(e.message));
  const muatQr = () => api('/api/jadwal/publik/qr').then(setQr).catch(() => setQr(null));
  useEffect(() => { if (open) load(); }, [open]);
  async function ubah(body) {
    setBusy(true);
    try {
      const r = await api('/api/jadwal/publik', { method: 'POST', body });
      setInfo(r); muatQr(); toast.ok(r.pesan || 'Tautan disimpan.'); onChanged?.();
    }
    catch (e) { toast.err(e.message); } finally { setBusy(false); }
  }
  const url = info?.url || '';
  const salin = async () => {
    try { await navigator.clipboard.writeText(url); toast.ok('Tautan publik disalin.'); }
    catch (e) { toast.err('Gagal menyalin — salin manual: ' + url); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Tautan Publik Rekap Jadwal" size="md"
      subtitle="Dapat dibuka siswa/guru tanpa login, lengkap dengan filter kelas & guru."
      footer={<button className="btn-ghost" onClick={onClose}>Tutup</button>}>
      {!info ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('badge', info.aktif ? 'badge-aman' : 'badge-netral')}>{info.aktif ? 'Aktif' : 'Nonaktif'}</span>
            {info.path ? <code className="break-all rounded-lg bg-slate-50 px-2 py-1 text-[11.5px] text-slate-600">{info.path}</code> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => ubah({ aktif: 1, rotate: !info.token })} data-publik-buat>
              {info.token ? <><Link2 size={14} /> Aktifkan Tautan</> : <><Link2 size={14} /> Generate Link Publik</>}
            </button>
            <button className="btn-ghost btn-sm" disabled={!info.token || busy} onClick={() => ubah({ aktif: 1, rotate: 1 })}>
              <RefreshCw size={14} /> Ganti Token
            </button>
            <button className="btn-ghost btn-sm" disabled={!info.token || busy} onClick={() => ubah({ aktif: 0 })}>
              Nonaktifkan
            </button>
          </div>
          {info.token ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="mx-auto grid h-[172px] w-[172px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm" data-qr-jadwal>
                  {qr?.qr?.svg ? <div className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.qr.svg }} />
                    : <Loader2 size={18} className="animate-spin text-slate-300" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex gap-2">
                    <input readOnly className="input font-mono !text-[11.5px]" value={url} data-url-jadwal />
                    <button className="btn-ghost" onClick={salin}><Copy size={14} /> Salin</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <a className="btn-ghost btn-sm" href={qr?.qr?.png || '#'} download="qr-jadwal-publik.png"
                      onClick={e => { if (!qr?.qr?.png) e.preventDefault(); }} data-unduh-qr-jadwal>
                      <Download size={13} /> Unduh Barcode
                    </a>
                    <a className="btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> Buka Halaman
                    </a>
                  </div>
                  <p className="text-[11px] text-slate-400">Tempel QR ini di mading/papan pengumuman agar siswa &amp; orang tua dapat memindai jadwal.</p>
                </div>
              </div>
            </>
          ) : <p className="text-[12px] text-slate-500">Tautan belum dibuat. Tekan “Generate Link Publik” untuk membuat tautan khusus tanpa login.</p>}
          <Alert tone="info" title="Keamanan">Siapa pun yang memiliki tautan dapat melihat rekap jadwal (tanpa data pribadi siswa). Ganti token bila tautan bocor.</Alert>
        </div>
      )}
    </Modal>
  );
}
