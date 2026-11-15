import React, { useEffect, useMemo, useState } from 'react';
import { Award, Download, Loader2, Pencil, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { api, docUrl } from '../api';
import { Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';
import ImportModal from '../components/ImportModal';

export default function Kategori({ ctx }) {
  const { can, refreshKey, bump, toast } = ctx;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pilih, setPilih] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api('/api/kategori').then(r => setRows(r.rows)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);

  const pel = useMemo(() => rows.filter(r => r.jenis === 'pelanggaran'), [rows]);
  const pres = useMemo(() => rows.filter(r => r.jenis === 'prestasi'), [rows]);

  useEffect(() => { setPilih(list => list.filter(id => rows.some(r => r.id === id))); }, [rows]);
  const semuaDipilih = rows.length > 0 && pilih.length === rows.length;
  const toggle = id => setPilih(l => l.includes(id) ? l.filter(x => x !== id) : [...l, id]);
  const toggleSemua = () => setPilih(semuaDipilih ? [] : rows.map(r => r.id));

  async function hapusMasal() {
    if (!pilih.length) return toast.err('Pilih minimal satu kategori terlebih dahulu.');
    if (!window.confirm(`Hapus ${pilih.length} kategori terpilih? Riwayat kejadian lama tetap tersimpan tanpa kategori.`)) return;
    setBusy(true);
    try {
      const r = await api('/api/kategori/bulk-delete', { method: 'POST', body: { ids: pilih } });
      toast.ok(r.pesan || `${r.jumlah} kategori dihapus.`);
      setPilih([]); load(); bump();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  async function hapus(k) {
    if (!window.confirm(`Hapus kategori "${k.nama}"? Riwayat kejadian lama tetap tersimpan tanpa kategori.`)) return;
    try { await api('/api/kategori/' + k.id, { method: 'DELETE' }); toast.ok('Kategori dihapus.'); load(); }
    catch (e) { toast.err(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Kategori Poin</h2>
          <p className="text-[12.5px] text-slate-500">Kelola daftar pelanggaran & prestasi beserta besaran poin masing-masing.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('kategori', 'view') ? (
            <>
              <a className="btn-ghost" href={docUrl('/api/kategori-template.xlsx')} download><Download size={15} /> Template Excel</a>
              {can('kategori', 'write') ? <button className="btn-soft" onClick={() => setImportOpen(true)}><Upload size={15} /> Import Kategori</button> : null}
            </>
          ) : null}
          {can('kategori', 'write') ? (
            <>
              <button className="btn-soft" onClick={() => setEdit({ jenis: 'pelanggaran', poin: 5 })} data-guide-target="setup-category-add"><Plus size={15} /> Kategori Pelanggaran</button>
              <button className="btn-primary" onClick={() => setEdit({ jenis: 'prestasi', poin: 10 })}><Plus size={15} /> Kategori Prestasi</button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
        <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" checked={semuaDipilih}
            onChange={toggleSemua} data-kategori-all="1" />
          Pilih Semua
        </label>
        <span className="text-[12px] font-semibold text-slate-500">
          Terpilih: <b className="text-orange-700" data-kategori-count="1">{pilih.length}</b>
        </span>
        {pilih.length ? (
          <button className="chip !py-0.5 hover:!border-orange-300" onClick={() => setPilih([])}>Bersihkan</button>
        ) : null}
        <button className="btn-danger btn-sm ml-auto" disabled={!pilih.length || busy || !can('kategori', 'delete')}
          onClick={hapusMasal} data-kategori-hapus="1">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Terpilih
        </button>
      </div>

      {loading ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <DaftarKategori title="Poin Pelanggaran" subtitle="Kategori yang mengurangi poin kedisiplinan"
            icon={TriangleAlert} tone="rose" rows={pel} can={can} onEdit={setEdit} onDelete={hapus}
            pilih={pilih} onToggle={toggle}
            onAdd={can('kategori', 'write') ? () => setEdit({ jenis: 'pelanggaran', poin: 5 }) : null} />
          <DaftarKategori title="Poin Prestasi" subtitle="Kategori yang menambah poin positif siswa"
            icon={Award} tone="violet" rows={pres} can={can} onEdit={setEdit} onDelete={hapus}
            pilih={pilih} onToggle={toggle}
            onAdd={can('kategori', 'write') ? () => setEdit({ jenis: 'prestasi', poin: 10 }) : null} />
        </div>
      )}

      <Card title="Cara kerja poin" subtitle="Ringkasan perhitungan status disiplin">
        <ul className="space-y-1.5 text-[12.5px] text-slate-600">
          <li>• <b>Poin bersih</b> = total poin pelanggaran − total poin prestasi (tidak pernah di bawah 0 saat menentukan status).</li>
          <li>• Status disiplin mengikuti ambang batas yang dapat diubah di <b>Pengaturan → Status &amp; Ambang Poin</b>.</li>
          <li>• Setiap kejadian yang dicatat langsung memengaruhi rekap, dashboard, dan portal cek poin siswa.</li>
          <li>• <b>Alpha &amp; Bolos dari absensi</b> otomatis menjadi catatan pelanggaran (bawaan <b>5</b> dan <b>10</b> poin). Ubah poin pada dua kategori bertanda <span className="badge badge-pantau !py-0.5">Otomatis Absensi</span> di atas — perubahan langsung dipakai saat presensi disimpan.</li>
          <li>• Menambah banyak kategori sekaligus? Gunakan <b>Import Kategori</b> pada tombol di atas (unduh template Excel lebih dulu).</li>
        </ul>
      </Card>

      <FormKategori open={!!edit} row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); bump(); }} toast={toast} />

      <ImportModal open={importOpen} jenis="kategori" onClose={() => setImportOpen(false)}
        onDone={() => { load(); bump(); }} />
    </div>
  );
}

function DaftarKategori({ title, subtitle, icon: Icon, tone, rows, can, onEdit, onDelete, onAdd, pilih = [], onToggle }) {
  return (
    <Card title={title} subtitle={subtitle}
      right={onAdd ? <button className="btn-soft btn-sm" onClick={onAdd}><Plus size={13} /> Tambah</button> : null}>
      {rows.length ? (
        <div className="tbl-wrap max-h-[56vh]">
          <table className="tbl">
            <thead><tr><th className="w-9" /><th>Kategori</th><th className="text-center">Poin</th><th className="text-center">Dipakai</th><th className="w-20">Aksi</th></tr></thead>
            <tbody>
              {rows.map(k => (
                <tr key={k.id} className={pilih.includes(k.id) ? 'bg-orange-50/60' : ''}>
                  <td className="text-center">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" data-kategori-item={k.id}
                      checked={pilih.includes(k.id)} onChange={() => onToggle && onToggle(k.id)} />
                  </td>
                  <td>
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-700">
                      {k.nama}
                      {k.auto_key ? <span className="badge badge-pantau !py-0.5">Otomatis Absensi</span> : null}
                    </p>
                    {k.keterangan ? <p className="text-[11px] text-slate-400">{k.keterangan}</p> : null}
                  </td>
                  <td className="text-center">
                    <span className={cx('inline-block rounded-lg px-2 py-0.5 text-[12px] font-extrabold',
                      tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-violet-50 text-violet-600')}>+{k.poin}</span>
                  </td>
                  <td className="text-center text-[12px] text-slate-500">{k.dipakai}×</td>
                  <td>
                    <div className="flex gap-0.5">
                      {can('kategori', 'write') ? <button onClick={() => onEdit(k)} className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50"><Pencil size={14} /></button> : null}
                      {can('kategori', 'delete') && !k.auto_key ? <button onClick={() => onDelete(k)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={Icon} title="Belum ada kategori" desc="Tambahkan kategori poin terlebih dahulu." />}
    </Card>
  );
}

function FormKategori({ open, row, onClose, onSaved, toast }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({ id: row?.id || '', nama: row?.nama || '', jenis: row?.jenis || 'pelanggaran', poin: row?.poin ?? 5, keterangan: row?.keterangan || '' });
  }, [open, row]);

  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/kategori/save', { method: 'POST', body: form }); toast.ok('Kategori disimpan.'); onSaved?.(); }
    catch (e2) { toast.err(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Ubah Kategori Poin' : 'Tambah Kategori Poin'}
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button><button className="btn-primary" form="fKat" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan</button></>}>
      <form id="fKat" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Kategori" required className="sm:col-span-2">
          <input className="input" value={form.nama || ''} required placeholder="mis. Terlambat masuk sekolah" onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} />
        </Field>
        <Field label="Jenis Poin" required>
          <select className="input" value={form.jenis || 'pelanggaran'} onChange={e => setForm(f => ({ ...f, jenis: e.target.value }))}>
            <option value="pelanggaran">Pelanggaran</option><option value="prestasi">Prestasi</option>
          </select>
        </Field>
        <Field label="Jumlah Poin" required hint="Bilangan bulat positif">
          <input type="number" min="1" className="input" value={form.poin ?? ''} required onChange={e => setForm(f => ({ ...f, poin: e.target.value }))} />
        </Field>
        <Field label="Keterangan" className="sm:col-span-2">
          <textarea className="input" value={form.keterangan || ''} placeholder="Penjelasan singkat kategori ini" onChange={e => setForm(f => ({ ...f, keterangan: e.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}
