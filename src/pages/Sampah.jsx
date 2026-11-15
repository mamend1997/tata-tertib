import React, { useEffect, useState } from 'react';
import {
  CheckSquare, Loader2, RotateCcw, Trash2, Undo2, X, Info, Users, School, ClipboardList
} from 'lucide-react';
import { api, tgl, waktu } from '../api';
import { Alert, Card, Empty, Spinner, cx, useToast } from '../ui';

const LABEL = { siswa: 'Siswa', kelas: 'Kelas', kejadian: 'Riwayat Kejadian', kategori: 'Kategori', tindak_lanjut: 'Catatan Pembinaan', jurnal: 'Jurnal' };

export default function Sampah({ ctx }) {
  const { can, refreshKey, bump, toast } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = () => {
    setLoading(true);
    api('/api/trash').then(r => { setData(r); setSel([]); })
      .catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);

  const rows = (data?.rows || []).filter(r => filter === 'all' || r.tabel === filter);
  const semua = rows.length > 0 && rows.every(r => sel.includes(r.id));
  const toggleAll = () => setSel(semua ? [] : rows.map(r => r.id));
  const toggle = id => setSel(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);

  async function pulihkan(ids) {
    const list = ids || sel;
    if (!list.length) return toast.err('Pilih data yang akan dipulihkan.');
    setBusy(true);
    try {
      const r = await api('/api/trash/restore', { method: 'POST', body: { ids: list } });
      toast.ok(r.pesan);
      if (r.gagal && r.gagal.length) toast.err(r.gagal.slice(0, 2).join(' · '));
      load(); bump();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  async function hapusPermanen(ids) {
    const list = ids || sel;
    if (!list.length) return toast.err('Pilih data yang akan dihapus.');
    if (!window.confirm(`Hapus permanen ${list.length} data terpilih? Tindakan ini tidak dapat dibatalkan.`)) return;
    setBusy(true);
    try {
      const r = await api('/api/trash/delete', { method: 'POST', body: { ids: list } });
      toast.ok(r.pesan); load(); bump();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  const ring = data?.ringkas || { siswa: 0, kelas: 0, kejadian: 0, lainnya: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Kotak Sampah</h2>
          <p className="text-[12.5px] text-slate-500">
            Data yang dihapus disimpan {data?.hari_simpan || 30} hari sebelum hilang permanen. Pulihkan bila terjadi salah hapus.
          </p>
        </div>
        <span className="chip !border-orange-200 !bg-orange-50 !text-orange-700">
          <Info size={12} /> {data?.total || 0} data di kotak sampah
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Mini label="Siswa" value={ring.siswa} icon={Users} tone="sky" />
        <Mini label="Kelas" value={ring.kelas} icon={School} tone="orange" />
        <Mini label="Riwayat Kejadian" value={ring.kejadian} icon={ClipboardList} tone="rose" />
        <Mini label="Lainnya" value={ring.lainnya} icon={Info} tone="violet" />
      </div>

      <Card title="Data Terhapus" subtitle={`${rows.length} baris ditampilkan`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto !py-1.5 text-[12px]" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">Semua jenis</option>
              {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        }>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
            <CheckSquare size={14} className="text-orange-500" /> {sel.length} dipilih
          </span>
          {sel.length ? <button onClick={() => setSel([])} className="chip !py-0.5 hover:!border-orange-300"><X size={11} /> Bersihkan</button> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {can('sampah', 'write') ? (
              <button className="btn-soft btn-sm" disabled={!sel.length || busy} onClick={() => pulihkan()}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Pulihkan Terpilih
              </button>
            ) : null}
            {can('sampah', 'delete') ? (
              <button className="btn-danger btn-sm" disabled={!sel.length || busy} onClick={() => hapusPermanen()}>
                <Trash2 size={13} /> Hapus Permanen
              </button>
            ) : null}
          </div>
        </div>

        {loading ? <Spinner /> : rows.length ? (
          <div className="tbl-wrap max-h-[66vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-9 text-center">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" checked={semua} onChange={toggleAll} />
                  </th>
                  <th className="w-32">Jenis</th><th>Keterangan</th><th className="w-44">Dihapus</th>
                  <th className="w-24 text-center">Sisa Hari</th><th className="w-36">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={sel.includes(r.id) ? 'bg-orange-50/60' : ''}>
                    <td className="text-center">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td><span className="badge badge-netral">{LABEL[r.tabel] || r.tabel}</span></td>
                    <td>
                      <p className="font-semibold text-slate-700">{r.label || ('#' + r.ref_id)}</p>
                      <p className="text-[11px] text-slate-400">ID #{r.ref_id} · {r.tabel}</p>
                    </td>
                    <td className="text-[12px]">{waktu(r.deleted_at)}<span className="block text-[11px] text-slate-400">oleh {r.oleh_nama || '-'}</span></td>
                    <td className="text-center">
                      <span className={cx('badge', (r.sisa_hari || 0) <= 5 ? 'badge-siaga' : 'badge-pantau')}>{r.sisa_hari} hari</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {can('sampah', 'write') ? (
                          <button onClick={() => pulihkan([r.id])} title="Pulihkan" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><RotateCcw size={14} /></button>
                        ) : null}
                        {can('sampah', 'delete') ? (
                          <button onClick={() => hapusPermanen([r.id])} title="Hapus permanen" className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Trash2} title="Kotak sampah kosong" desc="Data yang Anda hapus dari Data Siswa, Data Kelas, atau riwayat kejadian akan tampil di sini." />}
      </Card>

      <Alert tone="info" title="Cara kerja Kotak Sampah">
        Menghapus siswa/kelas/riwayat kejadian tidak langsung menghilangkan data — semuanya dipindahkan ke kotak sampah
        dan otomatis dihapus permanen setelah {data?.hari_simpan || 30} hari. Restore mengembalikan data dengan ID aslinya.
      </Alert>
    </div>
  );
}

function Mini({ label, value, icon: Icon, tone }) {
  const tones = {
    sky: 'from-sky-500 to-cyan-500', orange: 'from-orange-500 to-amber-500',
    rose: 'from-rose-500 to-orange-500', violet: 'from-violet-500 to-fuchsia-500'
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
