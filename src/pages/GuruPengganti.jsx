import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Loader2, RefreshCw,
  Repeat, Search, UserPlus, Users, XCircle
} from 'lucide-react';
import { api, hariIni } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';

/* =====================================================================
   GURU PIKET & PENGGANTI
   Kepala Sekolah / Wakasek Kurikulum menunjuk guru pengganti pada slot jam
   pelajaran tertentu TANPA mengubah master jadwal — berlaku hanya pada
   tanggal tersebut. Sesi otomatis berpindah ke akun guru pengganti
   (check-in, presensi siswa, jurnal, dan alfa otomatis).
   ===================================================================== */
const geserTanggal = (iso, n) => {
  const d = new Date(String(iso) + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const p = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function GuruPengganti({ ctx }) {
  const { toast, can } = ctx;
  const bolehUbah = can('guru_pengganti', 'write');
  const [tanggal, setTanggal] = useState(() => hariIni());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cari, setCari] = useState('');
  const [pilihSlot, setPilihSlot] = useState(null);   // slot untuk modal penunjukan
  const [busy, setBusy] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/guru-pengganti?tanggal=' + tanggal)
      .then(r => setData(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [tanggal]);
  useEffect(load, [load]);

  async function batal(p) {
    if (!window.confirm(`Batalkan penunjukan ${p.ke_nama} dan kembalikan sesi ke guru semula?`)) return;
    setBusy(p.id);
    try {
      const r = await api('/api/guru-pengganti/batal', { method: 'POST', body: { id: p.id } });
      toast.ok(r.pesan || 'Penunjukan dibatalkan.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(0); }
  }

  const slots = useMemo(() => {
    const list = data?.slots || [];
    const kw = cari.trim().toLowerCase();
    if (!kw) return list;
    return list.filter(s => (s.mapel_nama + ' ' + s.kelas_nama + ' ' + s.guru_nama + ' ' + (s.guru_efektif_nama || ''))
      .toLowerCase().includes(kw));
  }, [data, cari]);

  if (loading && !data) return <Spinner label="Memuat data guru piket…" />;

  return (
    <div className="space-y-4" data-page="guru-pengganti">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Guru Piket &amp; Pengganti</h2>
          <p className="text-[12.5px] text-slate-500">
            Tunjuk guru pengganti ketika ada guru Sakit/Izin. Master jadwal pelajaran <b>tidak diubah</b> —
            penugasan hanya berlaku pada tanggal yang dipilih, dan sesi otomatis berpindah ke akun guru pengganti.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setTanggal(t => geserTanggal(t, -1))} data-hari-sebelum>
            <ChevronLeft size={14} /> Sebelumnya
          </button>
          <input type="date" className="input !w-auto" value={tanggal} onChange={e => setTanggal(e.target.value)} data-tanggal-pengganti />
          <button className="btn-ghost btn-sm" onClick={() => setTanggal(t => geserTanggal(t, 1))} data-hari-berikut>
            Berikutnya <ChevronRight size={14} />
          </button>
          <button className="btn-ghost btn-sm" onClick={load}><RefreshCw size={14} /> Muat Ulang</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Slot Mengajar" value={data?.jumlah_slot || 0} sub={data?.tanggal_label} icon={CalendarClock} tone="sky" />
        <Stat label="Perlu Pengganti" value={data?.jumlah_perlu || 0} sub="guru sakit/izin belum diganti" icon={AlertTriangle} tone="orange" />
        <Stat label="Sudah Ditunjuk" value={data?.jumlah_pengganti || 0} sub="sesi berpindah ke guru pengganti" icon={Repeat} tone="violet" />
        <Stat label="Guru Tidak Hadir" value={(data?.tidak_hadir || []).length} sub="izin / sakit hari ini" icon={Users} tone="rose" />
      </div>

      {(data?.tidak_hadir || []).length ? (
        <Card title="Notifikasi Guru Tidak Hadir" subtitle="Guru yang mengajukan Sakit/Izin — segera tunjuk pengganti agar kelas tetap terisi">
          <div className="space-y-2">
            {data.tidak_hadir.map(z => (
              <div key={z.id} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5',
                z.ada_pengganti ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60')}
                data-tidak-hadir={z.id}>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold text-slate-800">{z.guru_nama}</p>
                  <p className="text-[11px] text-slate-600">
                    {z.status === 'sakit' ? 'Sakit' : z.status === 'izin' ? 'Izin' : 'Alpha'} · {z.mapel_nama || '-'} · sesi {z.sesi} · {z.jam}
                  </p>
                  {z.catatan ? <p className="text-[10.5px] italic text-slate-500">“{z.catatan}”</p> : null}
                </div>
                <span className={cx('badge', z.ada_pengganti ? 'badge-aman' : 'badge-siaga')}>
                  {z.ada_pengganti ? 'Sudah ada pengganti' : 'Belum ada pengganti'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={`Slot Jam Pelajaran — ${data?.tanggal_label || ''}`}
        subtitle="Klik Tunjuk Pengganti pada slot yang gurunya tidak hadir."
        right={<div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input !w-[190px] !py-1.5 !pl-8 text-[12px]" value={cari}
              onChange={e => setCari(e.target.value)} placeholder="Cari mapel / kelas / guru…" data-cari-pengganti />
          </div>
        </div>}>
        {!slots.length ? (
          <Empty icon={CalendarClock} title="Tidak ada slot" desc="Belum ada jadwal mengajar pada tanggal ini." />
        ) : (
          <div className="tbl-wrap max-h-[64vh]">
            <table className="tbl" data-tbl="guru-pengganti">
              <thead>
                <tr>
                  <th className="w-12 c">Sesi</th><th>Jam</th><th>Mata Pelajaran</th><th>Kelas</th>
                  <th>Guru Pengampu</th><th>Guru Efektif</th><th className="c">Status</th><th className="c">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(s => {
                  const izin = s.izin ? s.izin.status : '';
                  const p = s.pengganti;
                  return (
                    <tr key={s.jadwal_id} data-slot-pengganti={s.jadwal_id}
                      className={cx(izin && !p && 'bg-rose-50/50')}>
                      <td className="c font-bold">{s.sesi}</td>
                      <td className="whitespace-nowrap text-[11.5px]">{s.jam}</td>
                      <td className="font-semibold text-slate-700">{s.mapel_nama}</td>
                      <td className="text-[11.5px]">{s.kelas_nama}</td>
                      <td className="text-[11.5px]">{s.guru_nama}</td>
                      <td className="text-[11.5px]">
                        <span className={cx('font-semibold', p ? 'text-violet-700' : 'text-slate-700')}>{s.guru_efektif_nama}</span>
                        {p ? <span className="ml-1 badge badge-pantau">{p.jenis === 'penugasan' ? 'Pengganti' : 'Tukar'}</span> : null}
                      </td>
                      <td className="c">
                        {s.absensi ? (
                          <span className={cx('badge', s.absensi.status === 'hadir' ? 'badge-aman'
                            : s.absensi.status === 'sakit' ? 'badge-perhatian'
                              : s.absensi.status === 'izin' ? 'badge-pantau' : 'badge-siaga')}>
                            {s.absensi.status === 'hadir' ? 'Hadir' : s.absensi.status === 'sakit' ? 'Sakit'
                              : s.absensi.status === 'izin' ? 'Izin' : 'Alpha'}
                          </span>
                        ) : izin ? (
                          <span className="badge badge-siaga">{izin === 'sakit' ? 'Sakit' : 'Izin'} · tanpa pengganti</span>
                        ) : (
                          <span className="badge badge-netral">Belum diabsen</span>
                        )}
                      </td>
                      <td className="c">
                        <div className="flex items-center justify-center gap-1">
                          <button className={cx('btn-sm', p ? 'btn-ghost' : 'btn-soft')} disabled={!bolehUbah}
                            onClick={() => setPilihSlot(s)} data-tunjuk={s.jadwal_id}
                            title={p ? 'Ganti guru pengganti' : 'Tunjuk guru pengganti'}>
                            <UserPlus size={13} /> {p ? 'Ganti' : 'Tunjuk'}
                          </button>
                          {p && p.jenis === 'penugasan' ? (
                            <button className="btn-sm border border-rose-200 bg-rose-50 text-rose-700" disabled={!bolehUbah || busy === p.id}
                              onClick={() => batal(p)} data-batal={p.id}>
                              {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Batal
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!bolehUbah ? (
          <Alert tone="info" title="Hanya dapat dilihat">
            Penunjukan guru pengganti dilakukan oleh Kepala Sekolah / Wakasek Kurikulum.
          </Alert>
        ) : null}
      </Card>

      <ModalTunjuk open={!!pilihSlot} slot={pilihSlot} tanggal={tanggal}
        onClose={() => setPilihSlot(null)} onSaved={() => { setPilihSlot(null); load(); }} />
    </div>
  );
}

/* ---------------- modal penunjukan ---------------- */
function ModalTunjuk({ open, slot, tanggal, onClose, onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [guruId, setGuruId] = useState('');
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [cari, setCari] = useState('');

  useEffect(() => {
    if (!open || !slot) return;
    setLoading(true); setData(null); setGuruId(''); setAlasan(''); setCari('');
    api(`/api/guru-pengganti/kandidat?jadwal_id=${slot.jadwal_id}&tanggal=${tanggal}`)
      .then(r => setData(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [open, slot?.jadwal_id, tanggal]);

  const kandidat = useMemo(() => {
    const list = data?.kandidat || [];
    const kw = cari.trim().toLowerCase();
    if (!kw) return list;
    return list.filter(k => (k.nama + ' ' + (k.nip || '') + ' ' + (k.jabatan || '')).toLowerCase().includes(kw));
  }, [data, cari]);

  async function kirim() {
    if (!guruId) return toast.err('Pilih guru pengganti terlebih dahulu.');
    setBusy(true);
    try {
      const r = await api('/api/guru-pengganti/tunjuk', {
        method: 'POST', body: { jadwal_id: slot.jadwal_id, tanggal, ke_guru: Number(guruId), alasan }
      });
      toast.ok(r.pesan || 'Guru pengganti ditunjuk.');
      onSaved?.();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Tunjuk Guru Pengganti" size="lg"
      subtitle={data?.slot ? `${data.slot.mapel_nama} · ${data.slot.kelas_nama} · ${data.slot.label_sesi} (${data.slot.jam})` : ''}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn-primary" disabled={busy || loading || !guruId} onClick={kirim} data-simpan-pengganti>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Tunjuk sebagai Pengganti
        </button>
      </>}>
      {loading ? <Spinner label="Memuat kandidat guru…" /> : !data ? null : (
        <div className="space-y-3" data-modal-pengganti>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[12px] text-slate-600">
            <p><b>Slot:</b> {data.slot.mapel_nama} · {data.slot.kelas_nama} · {data.slot.label_sesi} ({data.slot.jam})</p>
            <p><b>Guru semula:</b> {data.slot.guru_nama} · <b>Tanggal:</b> {data.tanggal_label}</p>
            {data.pengganti ? (
              <p className="mt-1 text-[11.5px] font-semibold text-violet-700">
                Saat ini digantikan <b>{data.pengganti.ke_nama}</b>
                {data.pengganti.dibuat_nama ? ` (ditunjuk ${data.pengganti.dibuat_nama})` : ''}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] italic text-slate-500">Master jadwal tidak diubah — penugasan berlaku pada tanggal ini saja.</p>
          </div>

          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input !pl-8" value={cari} onChange={e => setCari(e.target.value)}
              placeholder="Cari nama guru / NIP…" data-cari-kandidat />
          </div>

          <div className="max-h-[280px] space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
            {!kandidat.length ? <p className="p-3 text-center text-[12px] text-slate-500">Tidak ada guru yang cocok.</p> : kandidat.map(k => (
              <button key={k.id} type="button" disabled={!k.bisa} onClick={() => setGuruId(String(k.id))}
                data-kandidat={k.id}
                className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition',
                  guruId === String(k.id) ? 'bg-orange-50 ring-1 ring-orange-300' : 'hover:bg-slate-50',
                  !k.bisa && 'cursor-not-allowed opacity-50')}>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-slate-800">{k.nama}</span>
                  <span className="block text-[10.5px] text-slate-500">
                    {k.jabatan || k.role_label}{k.nip ? ` · NIP ${k.nip}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] font-semibold">
                  {!k.bisa ? <span className="text-rose-600">Sedang mengajar</span>
                    : k.kelas_sama ? <span className="text-emerald-600">Mengampu kelas ini</span>
                      : <span className="text-slate-400">Siap</span>}
                </span>
              </button>
            ))}
          </div>

          <Field label="Alasan / Catatan (opsional)">
            <textarea className="input" rows={2} value={alasan} onChange={e => setAlasan(e.target.value)}
              placeholder="mis. menggantikan guru yang sakit sampai jam pelajaran berakhir" data-alasan-pengganti />
          </Field>

          <p className="flex items-start gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-[11.5px] text-violet-900">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            Setelah ditunjuk, sesi ini langsung masuk ke menu Absensi Guru milik guru pengganti (check-in, presensi siswa, jurnal).
            Ketidakhadiran guru semula tetap tercatat pada rekap absensi guru.
          </p>
        </div>
      )}
    </Modal>
  );
}
