import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, GraduationCap, Loader2, Pencil, Plus, School, Trash2, Upload, Users } from 'lucide-react';
import { api } from '../api';
import { Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';
import ImportModal from '../components/ImportModal';

export default function Kelas({ ctx }) {
  const { can, refreshKey, bump, toast, setPage } = ctx;
  const [data, setData] = useState({ rows: [], wali: [] });
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api('/api/kelas').then(setData).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);

  async function hapus(k) {
    if (!window.confirm(`Hapus kelas ${k.nama}?`)) return;
    try { await api('/api/kelas/' + k.id, { method: 'DELETE' }); toast.ok('Kelas dihapus.'); load(); }
    catch (e) { toast.err(e.message); }
  }

  const totalSiswa = data.rows.reduce((a, k) => a + (k.jumlah || 0), 0);
  /* daftar tingkat mengikuti jenjang & format yang diatur di Pengaturan */
  const tingkatList = (data.tingkat && data.tingkat.list) || ['X', 'XI', 'XII'];
  const tingkatAwal = tingkatList[0] || 'X';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Data Kelas</h2>
          <p className="text-[12.5px] text-slate-500">Wali kelas dipetakan otomatis dari akun pengguna dengan role <b>Wali Kelas</b>.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setImportOpen(true)}><Upload size={15} /> Import Excel</button>
          <a className="btn-ghost" href={(window.__BASE__ || '') + '/api/kelas-template.xlsx'} download><Download size={15} /> Template</a>
          {can('kelas', 'write') ? <button className="btn-primary" onClick={() => setEdit({ tingkat: tingkatAwal })} data-guide-target="setup-class-add"><Plus size={15} /> Tambah Kelas</button> : null}
        </div>
      </div>

      {/* Info format tingkat aktif + pintasan ke pengaturan tingkat */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5" data-info-tingkat>
        <GraduationCap size={15} className="text-violet-600" />
        <span className="text-[12px] text-violet-900">
          Jenjang <b>{data.tingkat?.jenjang || '-'}</b> · format tingkat:
          <b> {(data.tingkat?.list || []).join(' → ') || '-'}</b>
          {data.tahun ? <span className="text-violet-700"> · tahun pelajaran {data.tahun.nama}</span> : null}
        </span>
        {can('pengaturan', 'view') && setPage ? (
          <button className="ml-auto rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-[11.5px] font-bold text-violet-700 hover:bg-violet-100"
            onClick={() => setPage('pengaturan')} data-atur-tingkat>
            Atur Format Tingkat
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white"><School size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Jumlah Kelas</p><p className="text-[19px] font-extrabold text-slate-800">{data.rows.length}</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white"><Users size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Siswa Terdaftar</p><p className="text-[19px] font-extrabold text-slate-800">{totalSiswa}</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"><GraduationCap size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Wali Kelas Aktif</p><p className="text-[19px] font-extrabold text-slate-800">{data.rows.filter(k => k.wali_id).length}</p></div>
        </div>
      </div>

      <Card title="Daftar Kelas" subtitle={`${data.rows.length} kelas`}>
        {loading ? <Spinner /> : data.rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Nama Kelas</th><th>Tingkat</th><th>Jurusan</th><th>Wali Kelas</th>
                <th className="text-center" title="Target jam pelajaran per pekan (khusus kelas)">Target Jam/Pekan</th>
                <th className="text-center">Siswa</th><th className="w-24">Aksi</th></tr></thead>
              <tbody>
                {data.rows.map(k => (
                  <tr key={k.id}>
                    <td className="font-semibold text-slate-700">{k.nama}</td>
                    <td><span className="badge badge-netral">{k.tingkat}</span></td>
                    <td className="text-[12.5px]">{k.jurusan || '-'}</td>
                    <td>
                      {k.wali_nama ? (
                        <span className="text-[12.5px] font-medium text-slate-700">{k.wali_nama}{k.wali_nip ? <span className="block text-[10.5px] text-slate-400">NIP {k.wali_nip}</span> : null}</span>
                      ) : <span className="text-[11.5px] italic text-slate-400">belum ditetapkan</span>}
                    </td>
                    <td className="text-center" data-kelas-target={k.id}>
                      {Number(k.target_jam) > 0
                        ? <span className="badge badge-siaga">{k.target_jam} jam (khusus)</span>
                        : <span className="text-[11.5px] text-slate-400">standar</span>}
                    </td>
                    <td className="text-center font-semibold">{k.jumlah}</td>
                    <td>
                      <div className="flex gap-0.5">
                        {can('kelas', 'write') ? <button onClick={() => setEdit(k)} className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50" title="Ubah"><Pencil size={14} /></button> : null}
                        {can('kelas', 'delete') ? <button onClick={() => hapus(k)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50" title="Hapus"><Trash2 size={14} /></button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={School} title="Belum ada kelas" desc="Tambahkan kelas atau import dari Excel." />}
      </Card>

      <FormKelas open={!!edit} row={edit} wali={data.wali} tingkatList={tingkatList} tingkatAwal={tingkatAwal}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); bump(); }} toast={toast} />
      <ImportModal open={importOpen} jenis="kelas" onClose={() => setImportOpen(false)} onDone={() => { load(); bump(); }} />
    </div>
  );
}

function FormKelas({ open, row, wali, onClose, onSaved, toast, tingkatList = ['X', 'XI', 'XII'], tingkatAwal = 'X' }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({
      id: row?.id || '', nama: row?.nama || '', tingkat: row?.tingkat || tingkatAwal,
      jurusan: row?.jurusan || '', wali_id: row?.wali_id || '',
      target_jam: row?.target_jam ? String(row.target_jam) : ''
    });
  }, [open, row]);

  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/kelas/save', { method: 'POST', body: form }); toast.ok('Data kelas disimpan.'); onSaved?.(); }
    catch (e2) { toast.err(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Ubah Kelas' : 'Tambah Kelas'}
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button><button className="btn-primary" form="fKelas" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan</button></>}>
      <form id="fKelas" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Kelas" required hint="Contoh: X TKJ 1"><input className="input" value={form.nama || ''} required onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} /></Field>
        <Field label="Tingkat Kelas" required>
          <select className="input" value={form.tingkat || tingkatAwal} onChange={e => setForm(f => ({ ...f, tingkat: e.target.value }))}>
            {tingkatList.map(tk => <option key={tk} value={tk}>{tk}</option>)}
          </select>
        </Field>
        <Field label="Jurusan Kelas" className="sm:col-span-2">
          <input className="input" value={form.jurusan || ''} placeholder="Teknik Komputer & Jaringan" onChange={e => setForm(f => ({ ...f, jurusan: e.target.value }))} />
        </Field>
        <Field label="Target Jam Pelajaran per Pekan (khusus kelas ini)"
          hint={`Kosong / 0 = ikut standar sekolah (diatur di Pengaturan Jadwal). Contoh: kelas tingkat akhir 36 jam.`}
          className="sm:col-span-2">
          <input type="number" min="0" max="80" className="input" data-kelas-target-jam
            value={form.target_jam || ''} placeholder="mis. 36 — kosong = standar sekolah"
            onChange={e => setForm(f => ({ ...f, target_jam: e.target.value }))} />
        </Field>
        <Field label="Wali Kelas" className="sm:col-span-2" hint={wali.length ? '' : 'Belum ada akun dengan role Wali Kelas. Tambahkan dulu di menu Akun Pengguna.'}>
          <select className="input" value={form.wali_id || ''} onChange={e => setForm(f => ({ ...f, wali_id: e.target.value }))}>
            <option value="">— belum ditetapkan —</option>
            {wali.map(u => <option key={u.id} value={u.id}>{u.nama}{u.nip ? ` — NIP ${u.nip}` : ''}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
