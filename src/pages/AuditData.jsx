import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckSquare, Database, Loader2, RefreshCw, ShieldAlert, Trash2, X
} from 'lucide-react';
import { api } from '../api';
import { Alert, Card, Empty, Spinner, cx, useToast } from '../ui';

/**
 * Halaman audit data tersembunyi (data menggantung / yatim).
 * Sengaja TIDAK didaftarkan pada daftar fitur & navigasi (hanya bisa dibuka Administrator
 * lewat tautan di Pengaturan atau URL #/audit-data).
 */
export default function AuditData({ ctx }) {
  const { boot, refreshKey } = ctx;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState([]); // [{tabel, id}]
  const [busy, setBusy] = useState(false);
  const isAdmin = boot.user?.role === 'admin';

  const load = () => {
    setLoading(true);
    api('/api/audit-data').then(r => { setData(r); setSel([]); })
      .catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [refreshKey, isAdmin]);

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <h2 className="text-[19px] font-extrabold text-slate-800">Audit Data Tersembunyi</h2>
        <Alert tone="danger" title="Akses ditolak">Menu ini hanya dapat diakses oleh Administrator.</Alert>
      </div>
    );
  }

  const checks = data?.checks || [];
  const allItems = checks.flatMap(c => c.rows.map(r => ({ tabel: c.tabel, id: r.id, key: c.key })));
  const isSel = (tabel, id) => sel.some(s => s.tabel === tabel && s.id === id);
  const toggle = (tabel, id) => setSel(list => isSel(tabel, id) ? list.filter(s => !(s.tabel === tabel && s.id === id)) : [...list, { tabel, id }]);
  const toggleAll = () => setSel(sel.length === allItems.length ? [] : allItems.map(({ tabel, id }) => ({ tabel, id })));

  async function hapus() {
    if (!sel.length) return toast.err('Pilih minimal satu baris data.');
    if (!window.confirm(`Hapus permanen ${sel.length} baris data menggantung? Data ini tidak dapat dipulihkan.`)) return;
    setBusy(true);
    try {
      const grouped = {};
      for (const s of sel) (grouped[s.tabel] = grouped[s.tabel] || []).push(s.id);
      const items = Object.entries(grouped).map(([tabel, ids]) => ({ tabel, ids }));
      const r = await api('/api/audit-data/delete', { method: 'POST', body: { items } });
      toast.ok(r.pesan);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Audit Data Tersembunyi</h2>
          <p className="text-[12.5px] text-slate-500">
            Menampilkan baris data yang tidak terikat lagi ke induknya (mis. riwayat kejadian milik siswa yang sudah dihapus).
            Menu ini tidak tampil pada navigasi biasa — hanya Administrator.
          </p>
        </div>
        <button className="btn-ghost" onClick={load}><RefreshCw size={14} /> Pindai Ulang</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white"><AlertTriangle size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Jenis Masalah</p><p className="text-[19px] font-extrabold text-slate-800">{checks.length}</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white"><Database size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Baris Menggantung</p><p className="text-[19px] font-extrabold text-slate-800">{allItems.length}</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white"><CheckSquare size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dipilih</p><p className="text-[19px] font-extrabold text-slate-800">{sel.length}</p></div>
        </div>
      </div>

      <Card title="Daftar Temuan" subtitle={`${allItems.length} baris dari ${checks.length} jenis pemeriksaan`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
              <CheckSquare size={14} className="text-orange-500" /> {sel.length} dipilih
            </span>
            {sel.length ? <button onClick={() => setSel([])} className="chip !py-0.5"><X size={11} /> Bersihkan</button> : null}
            <button className="btn-danger btn-sm" disabled={!sel.length || busy} onClick={hapus}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Terpilih
            </button>
          </div>
        }>
        {loading ? <Spinner label="Memindai database…" /> : checks.length ? (
          <>
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={sel.length === allItems.length && allItems.length > 0} onChange={toggleAll} />
              Pilih semua ({allItems.length} baris)
            </label>
            <div className="space-y-3">
              {checks.map(c => (
                <div key={c.key} className="rounded-xl border border-slate-100">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                    <p className="text-[12.5px] font-bold text-slate-700">{c.label}</p>
                    <span className="badge badge-perhatian">{c.jumlah} baris · tabel {c.tabel}</span>
                  </div>
                  <div className="tbl-wrap max-h-[220px] !border-0">
                    <table className="tbl">
                      <thead><tr><th className="w-9" /><th className="w-24">ID</th><th>Nama / Ringkasan</th></tr></thead>
                      <tbody>
                        {c.rows.map(r => (
                          <tr key={c.key + '-' + r.id}>
                            <td className="text-center">
                              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={isSel(c.tabel, r.id)} onChange={() => toggle(c.tabel, r.id)} />
                            </td>
                            <td className="text-slate-500">#{r.id}</td>
                            <td className="text-slate-700">{r.nama || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : <Empty icon={ShieldAlert} title="Database bersih" desc="Tidak ada data menggantung yang ditemukan." />}
      </Card>

      <Alert tone="warn" title="Hati-hati">
        Data yang tampil di sini adalah sisa data yang induknya sudah tidak ada, sehingga tidak bisa dipakai lagi oleh aplikasi.
        Penghapusan bersifat permanen dan tidak masuk Kotak Sampah.
      </Alert>
    </div>
  );
}
