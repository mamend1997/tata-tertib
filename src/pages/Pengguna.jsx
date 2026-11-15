import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Download, Loader2, Lock, Pencil, Plus, Save, ShieldCheck, Trash2, Upload, UserCog, Users, X } from 'lucide-react';
import { api, inisial, docUrl } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';
import ImportModal from '../components/ImportModal';

export default function Pengguna({ ctx }) {
  const { boot, can, refreshKey, bump, toast } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [role, setRole] = useState('guru_bk');
  const [matrix, setMatrix] = useState(null);
  const [savingPerm, setSavingPerm] = useState(false);
  const [selected, setSelected] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api('/api/users').then(r => { setData(r); setMatrix(r.perms); }).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]);

  useEffect(() => { setSelected([]); }, [refreshKey]);

  const rowsAll = data?.rows || [];
  const semuaDipilih = rowsAll.length > 0 && selected.length === rowsAll.length;
  const toggleAll = () => setSelected(semuaDipilih ? [] : rowsAll.map(u => u.id));
  const toggleRow = id => setSelected(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  async function hapusMasal() {
    if (!selected.length) return toast.err('Pilih minimal satu akun terlebih dahulu.');
    if (!window.confirm(`Hapus ${selected.length} akun terpilih? Tindakan ini tidak dapat dibatalkan.`)) return;
    setBulkBusy(true);
    try {
      const r = await api('/api/users/bulk-delete', { method: 'POST', body: { ids: selected } });
      toast.ok(r.pesan || 'Akun dihapus.');
      setSelected([]);
      load(); bump();
    } catch (e) { toast.err(e.message); }
    finally { setBulkBusy(false); }
  }

  const roles = data?.roles || boot.roles;
  const roleTab = role === 'admin' ? (roles[0]?.key || 'admin') : role;

  useEffect(() => {
    if (data && !data.roles.some(r => r.key === role)) setRole('guru_bk');
  }, [data]);

  async function hapus(u) {
    if (!window.confirm(`Hapus akun ${u.nama}?`)) return;
    try { await api('/api/users/' + u.id, { method: 'DELETE' }); toast.ok('Akun dihapus.'); load(); }
    catch (e) { toast.err(e.message); }
  }

  function toggle(feature, action) {
    if (roleTab === 'admin') return;
    setMatrix(m => ({ ...m, [roleTab]: { ...m[roleTab], [feature]: { ...m[roleTab][feature], [action]: m[roleTab][feature][action] ? 0 : 1 } } }));
  }

  async function simpanMatrix() {
    setSavingPerm(true);
    try {
      const r = await api('/api/permissions', { method: 'POST', body: { role: roleTab, perms: matrix[roleTab] } });
      setMatrix(m => ({ ...m, [roleTab]: r.perms }));
      toast.ok(`Hak akses role ${roles.find(x => x.key === roleTab)?.label} disimpan.`);
      bump();
    } catch (e) { toast.err(e.message); }
    finally { setSavingPerm(false); }
  }

  if (loading && !data) return <Spinner label="Memuat akun & hak akses…" />;
  const rows = data?.rows || [];
  const cur = matrix?.[roleTab] || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Akun Pengguna & Hak Akses</h2>
          <p className="text-[12.5px] text-slate-500">Kelola akun sekolah dan atur izin granular per role (lihat · tambah/ubah · hapus).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={docUrl('/api/users-template.xlsx')} download><Download size={15} /> Template</a>
          {can('pengguna', 'write') ? (
            <button className="btn-ghost" onClick={() => setImportOpen(true)}><Upload size={15} /> Import Akun Guru</button>
          ) : null}
          {can('pengguna', 'write') ? <button className="btn-primary" onClick={() => setEdit({ role: 'guru_bk', aktif: 1 })} data-guide-target="setup-user-add" data-tour-id="btn-tambah-guru"><Plus size={15} /> Tambah Akun</button> : null}
        </div>
      </div>

      <Card title="Daftar Akun" subtitle={`${rows.length} akun terdaftar`}>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
            <CheckSquare size={14} className="text-orange-500" /> {selected.length} akun dipilih
          </span>
          {selected.length ? (
            <button onClick={() => setSelected([])} className="chip !py-0.5 hover:!border-orange-300"><X size={11} /> Bersihkan</button>
          ) : null}
          <div className="ml-auto">
            {can('pengguna', 'delete') ? (
              <button className="btn-danger btn-sm" disabled={!selected.length || bulkBusy} onClick={hapusMasal}>
                {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Masal
              </button>
            ) : null}
          </div>
        </div>
        {rows.length ? (
          <div className="tbl-wrap max-h-[52vh]">
            <table className="tbl">
              <thead><tr>
                <th className="w-9 text-center">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" checked={semuaDipilih}
                    onChange={toggleAll} title={semuaDipilih ? 'Batalkan pilih semua' : 'Pilih semua'} />
                </th>
                <th>Nama Pengguna</th><th>Jabatan</th><th>Username</th><th>Kata Sandi</th><th>Role</th><th>Status</th><th className="w-24">Aksi</th>
              </tr></thead>
              <tbody>
                {rows.map(u => (
                  <tr key={u.id} className={selected.includes(u.id) ? 'bg-orange-50/60' : ''}>
                    <td className="text-center">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                        checked={selected.includes(u.id)} onChange={() => toggleRow(u.id)}
                        disabled={u.id === boot.user.id} title={u.id === boot.user.id ? 'Akun sendiri' : ''} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-[11px] font-bold text-white">
                          {inisial(u.nama)}
                          {u.foto ? <img src={u.foto} alt="" className="absolute inset-0 h-full w-full object-cover" onError={e => e.currentTarget.remove()} /> : null}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-700">{u.nama}</p>
                          {u.nip ? <p className="text-[10.5px] text-slate-400">NIP {u.nip}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="text-[12.5px]">{u.jabatan || '-'}</td>
                    <td className="font-mono text-[12px]">{u.username}</td>
                    <td><span className="chip !text-slate-400"><Lock size={11} /> terenkripsi</span></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(u.role_list || [u.role]).map(r => (
                          <span key={r} className="badge badge-netral">{roles.find(x => x.key === r)?.label || r}</span>
                        ))}
                      </div>
                    </td>
                    <td>{u.aktif ? <span className="badge badge-aman">Aktif</span> : <span className="badge badge-siaga">Nonaktif</span>}</td>
                    <td>
                      <div className="flex gap-0.5">
                        {can('pengguna', 'write') ? <button onClick={() => setEdit(u)} className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50"><Pencil size={14} /></button> : null}
                        {can('pengguna', 'delete') ? <button onClick={() => hapus(u)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Users} title="Belum ada akun" />}
      </Card>

      <Card title="Matriks Hak Akses per Role" subtitle="Centang izin untuk setiap fitur. Administrator selalu memiliki akses penuh."
        right={can('pengguna', 'write') && roleTab !== 'admin' ? (
          <button className="btn-primary btn-sm" onClick={simpanMatrix} disabled={savingPerm}>
            {savingPerm ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Hak Akses
          </button>
        ) : null}>
        <div className="tabs mb-3">
          {roles.map(r => (
            <button key={r.key} onClick={() => setRole(r.key)} className={cx('tab', roleTab === r.key && 'active')}>{r.label}</button>
          ))}
        </div>

        {roleTab === 'admin' ? (
          <Alert tone="info" title="Administrator memiliki akses penuh">
            Role Administrator tidak dapat dibatasi — seluruh fitur dan aksi (lihat, tambah/ubah, hapus) selalu aktif.
          </Alert>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Fitur</th>
                  <th className="w-24 text-center">Lihat</th>
                  <th className="w-32 text-center">Tambah/Ubah</th>
                  <th className="w-24 text-center">Hapus</th>
                </tr>
              </thead>
              <tbody>
                {(boot.features || []).map(f => (
                  <tr key={f.key}>
                    <td>
                      <p className="font-semibold text-slate-700">{f.label}</p>
                      <p className="text-[10.5px] text-slate-400">{f.grup}</p>
                    </td>
                    {boot.actions.map(a => (
                      <td key={a} className="text-center">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                          checked={!!(cur[f.key] && cur[f.key][a])}
                          onChange={() => toggle(f.key, a)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-slate-500">
          Role <b>Wali Kelas</b> hanya melihat siswa pada kelas yang diampu. Pengaturan hak akses berlaku untuk menu, tombol, dan API.
        </p>
      </Card>

      <FormUser open={!!edit} row={edit} roles={roles} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); bump(); }} toast={toast} />
      <ImportModal open={importOpen} jenis="users" onClose={() => setImportOpen(false)} onDone={() => { load(); bump(); }} />
    </div>
  );
}

function FormUser({ open, row, roles, onClose, onSaved, toast }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({
      id: row?.id || '', nama: row?.nama || '', jabatan: row?.jabatan || '', username: row?.username || '',
      password: '', role: row?.role || 'guru_bk',
      roles: (row?.role_list || (row?.roles ? String(row.roles).split(',') : [])).filter(r => r && r !== (row?.role || 'guru_bk')),
      nip: row?.nip || '', phone: row?.phone || '', aktif: row?.aktif ?? 1
    });
  }, [open, row]);

  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/users/save', { method: 'POST', body: form }); toast.ok('Akun disimpan.'); onSaved?.(); }
    catch (e2) { toast.err(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Ubah Akun Pengguna' : 'Tambah Akun Pengguna'}
      subtitle={form.id ? 'Biarkan kata sandi kosong bila tidak ingin mengubahnya.' : 'Minimal 6 karakter untuk kata sandi.'}
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button><button className="btn-primary" form="fUser" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan</button></>}>
      <form id="fUser" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Lengkap" required><input className="input" value={form.nama || ''} required onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} /></Field>
        <Field label="Jabatan"><input className="input" value={form.jabatan || ''} placeholder="mis. Koordinator BK" onChange={e => setForm(f => ({ ...f, jabatan: e.target.value }))} /></Field>
        <Field label="Username" required><input className="input" value={form.username || ''} required onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></Field>
        <Field label={form.id ? 'Kata Sandi Baru' : 'Kata Sandi'} required={!form.id}>
          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" type="password" value={form.password || ''} required={!form.id}
              placeholder={form.id ? 'kosongkan bila tetap' : 'minimal 6 karakter'} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
        </Field>
        <Field label="Role Utama" required hint="Role utama menentukan tampilan label & menu bawaan.">
          <select className="input" value={form.role || 'guru_bk'}
            onChange={e => setForm(f => ({ ...f, role: e.target.value, roles: (f.roles || []).filter(x => x !== e.target.value) }))}>
            {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Role Tambahan (multi-role)" hint="Satu guru dapat memegang beberapa role sekaligus — hak aksesnya digabung. Contoh: Guru Mata Pelajaran + Wakasek Kurikulum.">
            <div className="grid max-h-[190px] gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2" data-multi-role>
              {roles.filter(r => r.key !== 'admin' && r.key !== form.role).map(r => {
                const aktif = (form.roles || []).includes(r.key);
                return (
                  <label key={r.key} className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]',
                    aktif ? 'bg-orange-50 font-semibold text-orange-800' : 'hover:bg-slate-50')}>
                    <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={aktif}
                      onChange={() => setForm(f => ({
                        ...f,
                        roles: (f.roles || []).includes(r.key) ? (f.roles || []).filter(x => x !== r.key) : [...(f.roles || []), r.key]
                      }))} />
                    {r.label}
                  </label>
                );
              })}
            </div>
            {(form.roles || []).length ? (
              <p className="mt-1 text-[11.5px] font-semibold text-orange-700">
                Akses gabungan: {[form.role, ...(form.roles || [])].map(k => roles.find(r => r.key === k)?.label || k).join(' + ')}
              </p>
            ) : null}
          </Field>
        </div>
        <Field label="NIP"><input className="input" value={form.nip || ''} onChange={e => setForm(f => ({ ...f, nip: e.target.value }))} /></Field>
        <Field label="No HP"><input className="input" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
        <Field label="Status Akun">
          <select className="input" value={form.aktif ? 1 : 0} onChange={e => setForm(f => ({ ...f, aktif: Number(e.target.value) }))}>
            <option value={1}>Aktif</option><option value={0}>Nonaktif</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}
