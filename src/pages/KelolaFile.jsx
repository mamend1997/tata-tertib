import React, { useEffect, useMemo, useState } from 'react';
import {
  FolderOpen, HardDrive, Image as ImageIcon, Loader2, RefreshCw, Search, Trash2, Upload
} from 'lucide-react';
import { api, tgl, waktu } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';

const KB = 1024, MB = 1024 * 1024;
export const sizeText = bytes => {
  const b = Number(bytes) || 0;
  if (b >= MB) return (b / MB).toFixed(b >= 10 * MB ? 0 : 1).replace('.', ',') + ' MB';
  if (b >= KB) return Math.round(b / KB) + ' KB';
  return b + ' B';
};
const pct = (a, b) => Math.max(0, Math.min(100, Math.round((Number(a) || 0) / Math.max(1, Number(b) || 1) * 100)));

export default function KelolaFile({ ctx }) {
  const { can, toast, refreshKey } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [jenis, setJenis] = useState('');
  const [pilih, setPilih] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lihat, setLihat] = useState(null);
  const bolehHapus = can('berkas', 'delete');

  const load = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (jenis) qs.set('jenis', jenis);
    api('/api/files?' + qs.toString())
      .then(r => { setData(r); setPilih(p => p.filter(id => (r.rows || []).some(x => x.id === id))); })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [jenis, refreshKey]);

  const rows = data?.rows || [];
  const st = data?.storage || { used_bytes: 0, quota_bytes: 1, files_bytes: 0, db_bytes: 0, file_count: 0, sisa_bytes: 0, quota_mb: 0 };
  const semua = rows.length > 0 && pilih.length === rows.length;

  async function hapusMassal() {
    if (!pilih.length) return toast.err('Centang berkas yang ingin dihapus terlebih dahulu.');
    if (!window.confirm(`Hapus ${pilih.length} berkas terpilih? Catatan berkas dihapus dan bukti foto pada kejadian terkait akan dikosongkan.`)) return;
    setBusy(true);
    try {
      const r = await api('/api/files/delete', { method: 'POST', body: { ids: pilih } });
      toast.ok(`${r.dihapus} berkas dihapus · ${sizeText(r.dibebaskan)} dibebaskan.`);
      setPilih([]);
      if (r.storage) setData(d => ({ ...d, storage: r.storage }));
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Kelola File Terunggah</h2>
          <p className="text-[12.5px] text-slate-500">
            Semua foto/bukti yang diunggah ke sistem: lihat, telusuri, dan hapus masal agar penyimpanan tetap ringan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-ghost"><RefreshCw size={14} className={cx('shrink-0', loading && 'animate-spin')} /> Muat Ulang</button>
        </div>
      </div>

      {/* ringkasan penyimpanan */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white"><HardDrive size={19} /></div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Terpakai</p>
            <p className="text-[17px] font-extrabold text-slate-800">{sizeText(st.used_bytes)}</p>
            <p className="text-[11px] text-slate-500">dari kuota {st.quota_mb} MB</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white"><ImageIcon size={19} /></div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Berkas Foto</p>
            <p className="text-[17px] font-extrabold text-slate-800">{st.file_count}</p>
            <p className="text-[11px] text-slate-500">{sizeText(st.files_bytes)}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"><FolderOpen size={19} /></div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Database</p>
            <p className="text-[17px] font-extrabold text-slate-800">{sizeText(st.db_bytes)}</p>
            <p className="text-[11px] text-slate-500">seluruh data aplikasi</p>
          </div>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sisa Kuota</p>
          <p className="text-[17px] font-extrabold text-emerald-600">{sizeText(st.sisa_bytes)}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: pct(st.used_bytes, st.quota_bytes) + '%' }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{pct(st.used_bytes, st.quota_bytes)}% terpakai · kuota diatur di Pengaturan → Unggahan</p>
        </div>
      </div>

      <Card title="Daftar Berkas" subtitle={`${rows.length} berkas ditampilkan · batas unggah ${Math.round((st.max_upload_kb || 2048) / 1024 * 10) / 10} MB/foto`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input !w-[190px] !py-1.5 !pl-8 text-[12px]" placeholder="Cari nama berkas…"
                value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
            </div>
            <select className="input !w-auto !py-1.5 text-[12px]" value={jenis} onChange={e => setJenis(e.target.value)}>
              <option value="">Semua jenis</option>
              <option value="bukti">Bukti kejadian</option>
              <option value="logo">Logo</option>
              <option value="foto">Foto</option>
              <option value="lain">Lainnya</option>
            </select>
            <button className="btn-soft btn-sm" onClick={load}>Cari</button>
          </div>
        }>
        {loading && !data ? <Spinner label="Memuat daftar berkas…" /> : rows.length ? (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={semua}
                  onChange={e => setPilih(e.target.checked ? rows.map(r => r.id) : [])} />
                Pilih semua ({rows.length})
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-500">{pilih.length} dipilih</span>
                {bolehHapus ? (
                  <button onClick={hapusMassal} disabled={!pilih.length || busy} className="btn-danger btn-sm">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Hapus Masal
                  </button>
                ) : null}
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-10"></th><th className="w-16">Pratinjau</th><th>Berkas</th>
                    <th className="hidden md:table-cell">Jenis</th><th className="w-24">Ukuran</th>
                    <th className="hidden lg:table-cell">Diunggah</th><th className="w-24">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(r.filename || '') || /^data:image\//.test(r.url || '');
                    return (
                      <tr key={r.id}>
                        <td>
                          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={pilih.includes(r.id)}
                            onChange={e => setPilih(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} />
                        </td>
                        <td>
                          {isImg ? (
                            <button onClick={() => setLihat(r)} className="block h-10 w-12 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                              <img src={r.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                            </button>
                          ) : <span className="badge badge-netral">berkas</span>}
                        </td>
                        <td className="max-w-[280px]">
                          <p className="truncate font-semibold text-slate-700">{r.filename || '-'}</p>
                          <p className="truncate text-[11px] text-slate-400">
                            {r.ref_tabel ? `${r.ref_tabel} #${r.ref_id || '-'} · ` : ''}{r.oleh_nama || '-'}
                          </p>
                        </td>
                        <td className="hidden md:table-cell"><span className="badge badge-netral">{r.jenis}</span></td>
                        <td className="whitespace-nowrap text-[12px]">{sizeText(r.ukuran)}</td>
                        <td className="hidden whitespace-nowrap text-[12px] text-slate-500 lg:table-cell">{waktu(r.created_at)}</td>
                        <td>
                          <button onClick={() => setLihat(r)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Lihat"><FolderOpen size={15} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-400">
              Catatan: menghapus berkas akan menghapus catatannya di aplikasi dan mengosongkan tautan bukti pada kejadian terkait.
              Berkas asli di penyimpanan media tetap tersimpan sesuai kebijakan penyimpanan platform.
            </p>
          </>
        ) : <Empty icon={ImageIcon} title="Belum ada berkas" desc="Berkas akan muncul di sini setelah Anda mengunggah bukti foto pada kejadian." />}
      </Card>

      <Modal open={!!lihat} onClose={() => setLihat(null)} title={lihat?.filename || 'Berkas'} size="lg"
        subtitle={lihat ? `${sizeText(lihat.ukuran)} · ${waktu(lihat.created_at)}` : ''}
        footer={<>
          <button className="btn-ghost" onClick={() => setLihat(null)}>Tutup</button>
          {lihat && bolehHapus ? (
            <button className="btn-danger" onClick={async () => {
              try {
                await api('/api/files/delete', { method: 'POST', body: { ids: [lihat.id] } });
                toast.ok('Berkas dihapus.');
                setLihat(null); load();
              } catch (e) { toast.err(e.message); }
            }}><Trash2 size={15} /> Hapus Berkas</button>
          ) : null}
        </>}>
        {lihat ? (
          /^data:image\//.test(lihat.url || '') || /\.(png|jpe?g|webp|gif|svg)$/i.test(lihat.filename || '') ? (
            <img src={lihat.url} alt={lihat.filename} className="mx-auto max-h-[60vh] w-auto rounded-xl bg-slate-50 object-contain" />
          ) : (
            <div className="space-y-2 text-[12.5px] text-slate-600">
              <p>Berkas ini tidak dapat dipratinjau.</p>
              <a className="btn-primary btn-sm" href={lihat.url} target="_blank" rel="noreferrer"><Upload size={14} /> Buka Berkas</a>
            </div>
          )
        ) : null}
      </Modal>
    </div>
  );
}
