import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Loader2, RefreshCw,
  Repeat, Search, Trash2, UserPlus, Users, XCircle
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
const NO_RIWAYAT = [];

export default function GuruPengganti({ ctx }) {
  const { toast, can, filters } = ctx;
  const bolehUbah = can('guru_pengganti', 'write');
  const [tanggal, setTanggal] = useState(() => hariIni());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cari, setCari] = useState('');
  const [filterSlot, setFilterSlot] = useState({ kelas: '', guru: '' });
  const [filterRiwayat, setFilterRiwayat] = useState({
    periode: 'bulanan', tanggal: hariIni(), dari: '', sampai: '', kelas: '', guru: '', mapel: '', q: ''
  });
  const [pilihSlot, setPilihSlot] = useState(null);   // slot untuk modal penunjukan
  const [busy, setBusy] = useState(0);
  const [riwayatDipilih, setRiwayatDipilih] = useState([]);
  const [hapusRiwayatBusy, setHapusRiwayatBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ tanggal, riwayat_periode: filterRiwayat.periode,
      riwayat_tanggal: filterRiwayat.tanggal || tanggal });
    if (filters?.ta) q.set('ta', filters.ta);
    if (filterSlot.kelas) q.set('kelas', filterSlot.kelas);
    if (filterSlot.guru) q.set('guru', filterSlot.guru);
    if (filterRiwayat.dari) q.set('riwayat_dari', filterRiwayat.dari);
    if (filterRiwayat.sampai) q.set('riwayat_sampai', filterRiwayat.sampai);
    if (filterRiwayat.kelas) q.set('riwayat_kelas', filterRiwayat.kelas);
    if (filterRiwayat.guru) q.set('riwayat_guru', filterRiwayat.guru);
    if (filterRiwayat.mapel) q.set('riwayat_mapel', filterRiwayat.mapel);
    if (filterRiwayat.q) q.set('riwayat_q', filterRiwayat.q);
    api('/api/guru-pengganti?' + q.toString())
      .then(r => setData(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [tanggal, filterSlot, filterRiwayat, filters?.ta]);
  useEffect(load, [load]);
  const riwayat = data?.riwayat || NO_RIWAYAT;
  const riwayatBisaDihapus = useMemo(() => riwayat.filter(r => ['batal', 'ditolak'].includes(String(r.status))), [riwayat]);
  const riwayatPilihSet = useMemo(() => new Set(riwayatDipilih.map(Number)), [riwayatDipilih]);
  const semuaRiwayatDipilih = riwayatBisaDihapus.length > 0
    && riwayatBisaDihapus.every(r => riwayatPilihSet.has(Number(r.id)));
  useEffect(() => {
    const tersedia = new Set(riwayatBisaDihapus.map(r => Number(r.id)));
    setRiwayatDipilih(ids => {
      const next = ids.filter(id => tersedia.has(Number(id)));
      return next.length === ids.length ? ids : next;
    });
  }, [riwayatBisaDihapus]);

  function pilihSemuaRiwayat(checked) {
    setRiwayatDipilih(checked ? riwayatBisaDihapus.map(r => Number(r.id)) : []);
  }

  function pilihRiwayat(id, checked) {
    setRiwayatDipilih(ids => checked
      ? [...new Set([...ids, Number(id)])]
      : ids.filter(x => Number(x) !== Number(id)));
  }

  async function hapusRiwayat() {
    if (!riwayatDipilih.length || !window.confirm(`Hapus ${riwayatDipilih.length} riwayat yang dipilih? Riwayat aktif atau menunggu tidak akan dihapus.`)) return;
    setHapusRiwayatBusy(true);
    try {
      const ids = [...new Set(riwayat.filter(r => riwayatPilihSet.has(Number(r.id)))
        .flatMap(r => (r.riwayat_ids || [r.id]).map(Number)))];
      const result = await api('/api/guru-pengganti/riwayat/hapus', { method: 'POST', body: { ids } });
      toast.ok(result.pesan || 'Riwayat terpilih dihapus.');
      setRiwayatDipilih([]);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setHapusRiwayatBusy(false); }
  }

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
    const seen = new Set();
    return list.filter(s => {
      const ids = (s.group_ids || [s.jadwal_id]).map(Number);
      const key = ids.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return !kw || (s.mapel_nama + ' ' + s.kelas_nama + ' ' + s.guru_nama + ' ' + (s.guru_efektif_nama || ''))
        .toLowerCase().includes(kw);
    }).filter(s => (!filterSlot.kelas || (s.kelas_ids || []).map(Number).includes(Number(filterSlot.kelas)))
      && (!filterSlot.guru || [Number(s.guru_id), Number(s.guru_efektif_id)].includes(Number(filterSlot.guru))));
  }, [data, cari, filterSlot]);

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
        right={<div className="flex flex-wrap items-center gap-2">
          {(data?.kelas || []).length ? (
            <select className="input !w-[150px] !py-1.5 text-[12px]" value={filterSlot.kelas}
              onChange={e => setFilterSlot(v => ({ ...v, kelas: e.target.value }))} data-filter-slot-kelas>
              <option value="">Semua kelas</option>
              {data.kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          ) : null}
          {(data?.guru || []).length ? (
            <select className="input !w-[170px] !py-1.5 text-[12px]" value={filterSlot.guru}
              onChange={e => setFilterSlot(v => ({ ...v, guru: e.target.value }))} data-filter-slot-guru>
              <option value="">Semua guru</option>
              {data.guru.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
            </select>
          ) : null}
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
                      <td className="c font-bold">{s.label_sesi}</td>
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
                            <button className="btn-sm border border-rose-200 bg-rose-50 text-rose-700"
                              disabled={!bolehUbah || busy === p.id || (s.absensi && Number(s.absensi.oleh) === Number(p.ke_guru))}
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

      <Card title="Riwayat Guru Piket / Pengganti"
        subtitle="Cari seluruh riwayat berdasarkan kelas, guru, mapel, dan rentang periode.">
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-filter-riwayat-pengganti>
          <Field label="Cari nama guru / kelas">
            <input className="input" value={filterRiwayat.q}
              onChange={e => setFilterRiwayat(v => ({ ...v, q: e.target.value }))}
              placeholder="Nama guru, kelas, atau mapel…" data-riwayat-cari />
          </Field>
          <Field label="Kelas">
            <select className="input" value={filterRiwayat.kelas}
              onChange={e => setFilterRiwayat(v => ({ ...v, kelas: e.target.value }))} data-riwayat-kelas>
              <option value="">Semua kelas</option>
              {(data?.kelas || []).map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </Field>
          <Field label="Nama Guru">
            <select className="input" value={filterRiwayat.guru}
              onChange={e => setFilterRiwayat(v => ({ ...v, guru: e.target.value }))} data-riwayat-guru>
              <option value="">Semua guru</option>
              {(data?.guru || []).map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
            </select>
          </Field>
          <Field label="Mata Pelajaran">
            <select className="input" value={filterRiwayat.mapel}
              onChange={e => setFilterRiwayat(v => ({ ...v, mapel: e.target.value }))} data-riwayat-mapel>
              <option value="">Semua mapel</option>
              {(data?.mapel || []).map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </Field>
          <Field label="Periode">
            <select className="input" value={filterRiwayat.periode}
              onChange={e => setFilterRiwayat(v => ({ ...v, periode: e.target.value }))} data-riwayat-periode>
              <option value="mingguan">Mingguan</option>
              <option value="bulanan">Bulanan</option>
              <option value="tahun">Tahun Pelajaran</option>
              <option value="custom">Rentang Tanggal</option>
              <option value="semua">Semua Periode</option>
            </select>
          </Field>
          {filterRiwayat.periode === 'custom' ? (
            <>
              <Field label="Dari Tanggal">
                <input type="date" className="input" value={filterRiwayat.dari}
                  onChange={e => setFilterRiwayat(v => ({ ...v, dari: e.target.value }))} data-riwayat-dari />
              </Field>
              <Field label="Sampai Tanggal">
                <input type="date" className="input" value={filterRiwayat.sampai}
                  onChange={e => setFilterRiwayat(v => ({ ...v, sampai: e.target.value }))} data-riwayat-sampai />
              </Field>
            </>
          ) : filterRiwayat.periode !== 'semua' ? (
            <Field label="Tanggal Acuan">
              <input type="date" className="input" value={filterRiwayat.tanggal}
                onChange={e => setFilterRiwayat(v => ({ ...v, tanggal: e.target.value }))} data-riwayat-tanggal />
            </Field>
          ) : null}
          <div className="flex items-end gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={load} data-riwayat-terapkan>
              <Search size={13} /> Terapkan Filter
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setFilterRiwayat({
              periode: 'bulanan', tanggal: hariIni(), dari: '', sampai: '', kelas: '', guru: '', mapel: '', q: ''
            })}>Reset</button>
          </div>
        </div>
        {!riwayat.length ? (
          <Empty icon={Repeat} title="Belum ada riwayat penugasan"
            desc="Penunjukan guru piket/pengganti akan tercatat di sini setelah disimpan." />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                <input type="checkbox" checked={semuaRiwayatDipilih}
                  disabled={!riwayatBisaDihapus.length || hapusRiwayatBusy}
                  onChange={e => pilihSemuaRiwayat(e.target.checked)} data-riwayat-all />
                Pilih Semua
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500" data-riwayat-count>{riwayatDipilih.length} dipilih</span>
                <button type="button" className="btn-danger btn-sm" onClick={hapusRiwayat}
                  disabled={!riwayatDipilih.length || hapusRiwayatBusy} data-riwayat-hapus>
                  {hapusRiwayatBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Hapus Terpilih
                </button>
              </div>
            </div>
            <p className="mb-2 text-[10.5px] text-slate-500">
              Hanya riwayat yang sudah dibatalkan atau ditolak yang dapat dihapus. Penugasan aktif dan permintaan menunggu harus diselesaikan terlebih dahulu.
            </p>
            <div className="tbl-wrap max-h-[42vh]">
              <table className="tbl" data-tbl="riwayat-guru-pengganti">
                <thead><tr><th className="w-10 c">Pilih</th><th>Jam</th><th>Kelas</th><th>Mapel</th><th>Guru Utama</th><th>Pengganti</th><th>Status</th><th>Catatan</th></tr></thead>
                <tbody>
                  {riwayat.map(r => {
                    const dapatDihapus = ['batal', 'ditolak'].includes(String(r.status));
                    return (
                      <tr key={r.id} data-riwayat-pengganti={r.id}>
                        <td className="c">
                          <input type="checkbox" checked={riwayatPilihSet.has(Number(r.id))}
                            disabled={!dapatDihapus || hapusRiwayatBusy}
                            onChange={e => pilihRiwayat(r.id, e.target.checked)}
                            aria-label={`Pilih riwayat ${r.id}`} data-riwayat-item={r.id} />
                        </td>
                        <td>{r.sesi ? `Jam ${r.sesi}${r.pasangan_sesi ? ` ↔ ${r.pasangan_sesi}` : ''}` : '-'} · {r.tanggal}</td>
                        <td>{r.kelas_nama || '-'}</td>
                        <td>{r.mapel_nama || '-'}</td>
                        <td>{r.dari_nama || '-'}</td>
                        <td>{r.ke_nama || '-'}</td>
                        <td><span className={cx('badge', r.status === 'diterima' ? 'badge-aman' : 'badge-netral')}>
                          {r.status === 'diterima' ? 'Aktif' : r.status === 'batal' ? 'Dibatalkan' : r.status}
                        </span>{r.jumlah_slot > 1 ? ` · ${r.jumlah_slot} jam` : ''}</td>
                        <td className="text-[11px]">{r.alasan || r.catatan_putus || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
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
  const [status, setStatus] = useState('sakit');
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [cari, setCari] = useState('');

  useEffect(() => {
    if (!open || !slot) return;
    setLoading(true); setData(null); setGuruId(''); setStatus('sakit'); setAlasan(''); setCari('');
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
    if (alasan.trim().length < 5) return toast.err('Catatan sakit/izin wajib diisi minimal 5 karakter.');
    setBusy(true);
    try {
      const r = await api('/api/guru-pengganti/tunjuk', {
        method: 'POST', body: {
          jadwal_id: slot.jadwal_id, tanggal, ke_guru: Number(guruId), status, catatan: alasan, alasan
        }
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
        <button className="btn-primary" disabled={busy || loading || !guruId || alasan.trim().length < 5} onClick={kirim} data-simpan-pengganti>
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

          <Field label="Guru utama tidak dapat mengajar karena" required>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['sakit', 'Sakit'],
                ['izin', 'Izin']
              ].map(([value, label]) => (
                <button key={value} type="button" onClick={() => setStatus(value)}
                  className={cx('btn-sm justify-center', status === value
                    ? 'border border-orange-300 bg-orange-50 text-orange-800'
                    : 'btn-ghost')}
                  aria-pressed={status === value} data-status-pengganti={value}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Catatan sakit / izin" required hint="Minimal 5 karakter; dicatat sebagai alasan ketidakhadiran guru utama.">
            <textarea className="input" rows={2} value={alasan} onChange={e => setAlasan(e.target.value)}
              placeholder="Tuliskan keterangan sakit atau izin…" data-alasan-pengganti />
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
