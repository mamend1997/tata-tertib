import React, { useEffect, useState } from 'react';
import { Activity, ScrollText, Search, ShieldCheck } from 'lucide-react';
import { api, waktu } from '../api';
import { Card, Empty, Spinner, cx, useToast } from '../ui';

const TONE = {
  TAMBAH: 'badge-aman', UBAH: 'badge-pantau', HAPUS: 'badge-siaga', IMPORT: 'badge-perhatian',
  LOGIN: 'badge-netral', LOGOUT: 'badge-netral', CETAK: 'badge-prestasi', EXPORT: 'badge-prestasi',
  WA: 'badge-aman'
};

export default function Audit({ ctx }) {
  const { refreshKey } = ctx;
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [modul, setModul] = useState([]);
  const [q, setQ] = useState('');
  const [filterModul, setFilterModul] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams({ q, modul: filterModul, limit: 300 }).toString();
    api('/api/audit?' + p).then(r => { setRows(r.rows); setModul(r.modul); })
      .catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Log Aktivitas Sistem</h2>
        <p className="text-[12.5px] text-slate-500">Jejak audit seluruh aksi pengguna: input kejadian, perubahan data master, cetak surat, hingga ekspor laporan.</p>
      </div>

      <Card title="Riwayat Aktivitas" subtitle={`${rows.length} catatan terakhir`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input !w-[200px] !py-1.5 !pl-8 text-[12px]" placeholder="Cari nama / aksi / detail…"
                value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
            </div>
            <select className="input !w-auto !py-1.5 text-[12px]" value={filterModul} onChange={e => setFilterModul(e.target.value)}>
              <option value="">Semua modul</option>
              {modul.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn-soft btn-sm" onClick={load}>Terapkan</button>
          </div>
        }>
        {loading ? <Spinner /> : rows.length ? (
          <div className="tbl-wrap max-h-[70vh]">
            <table className="tbl">
              <thead><tr><th className="w-40">Waktu</th><th className="w-36">Pengguna</th><th className="w-24">Aksi</th><th className="w-24">Modul</th><th>Detail</th><th className="w-28">IP</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-[12px]">{waktu(r.created_at)}</td>
                    <td>
                      <p className="font-semibold text-slate-700">{r.nama}</p>
                      <p className="text-[10.5px] text-slate-400">{r.role}</p>
                    </td>
                    <td><span className={cx('badge', TONE[r.aksi] || 'badge-netral')}>{r.aksi}</span></td>
                    <td className="text-[12px] text-slate-600">{r.modul}</td>
                    <td className="text-[12px] text-slate-600">{r.detail}</td>
                    <td className="font-mono text-[10.5px] text-slate-400">{r.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={ScrollText} title="Belum ada aktivitas" />}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card flex items-start gap-3 p-4">
          <ShieldCheck size={18} className="mt-0.5 text-emerald-500" />
          <div>
            <p className="text-[12.5px] font-bold text-slate-700">Audit tidak dapat diubah</p>
            <p className="text-[11.5px] text-slate-500">Setiap aksi tercatat dengan nama pengguna, role, waktu (WIB), dan alamat IP.</p>
          </div>
        </div>
        <div className="card flex items-start gap-3 p-4">
          <Activity size={18} className="mt-0.5 text-orange-500" />
          <div>
            <p className="text-[12.5px] font-bold text-slate-700">Pantau perubahan poin</p>
            <p className="text-[11.5px] text-slate-500">Detail aksi memuat nama siswa, kategori, dan jumlah poin yang diubah.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
