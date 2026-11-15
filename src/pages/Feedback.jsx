import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Inbox, Loader2, Lock, MessageSquareWarning, Search, Send, Trash2
} from 'lucide-react';
import { api, tglPendek, waktu } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';

const TONE = { baru: 'badge-pantau', dibaca: 'badge-netral', diproses: 'badge-siaga', selesai: 'badge-aman' };
const JENIS_ICON = { masukan: MessageSquareWarning, kendala: AlertTriangle, fitur: CheckCircle2, lainnya: Inbox };

/* =====================================================================
   MASUKAN & KENDALA (dapat diisi semua pengguna sekolah)
   ===================================================================== */
export default function Feedback({ ctx }) {
  const { can, refreshKey, toast, setPage } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ jenis: 'masukan', judul: '', pesan: '', prioritas: 'normal' });

  const load = useCallback(() => {
    setLoading(true);
    api('/api/feedback')
      .then(setData).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(load, [refreshKey]);

  async function kirim(e) {
    e.preventDefault();
    if (String(form.pesan).trim().length < 5) return toast.err('Tulis isi masukan/kendala minimal 5 karakter.');
    setBusy(true);
    try {
      const r = await api('/api/feedback', { method: 'POST', body: form });
      toast.ok(r.pesan);
      setForm({ jenis: form.jenis, judul: '', pesan: '', prioritas: 'normal' });
      load();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  if (loading && !data) return <Spinner label="Memuat masukan…" />;
  const rows = data?.rows || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Masukan &amp; Kendala</h2>
          <p className="text-[12.5px] text-slate-500">
            Sampaikan saran, kendala teknis, atau permintaan fitur. Laporan Anda terekap pada halaman khusus yang hanya
            dapat dibaca pengelola (rahasia).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="chip !border-slate-200 !bg-white !text-slate-600"><Lock size={12} /> Bersifat rahasia</span>
          {can('feedback_admin', 'view') ? (
            <button className="btn-ghost" onClick={() => setPage && setPage('feedback_admin')}>
              <Inbox size={15} /> Rekap Semua Masukan
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[440px_1fr]">
        <Card title="Kirim Masukan / Kendala" subtitle="Semua kolom bertanda * wajib diisi" className="h-fit">
          {can('feedback', 'write') ? (
            <form onSubmit={kirim} className="space-y-3" data-form="feedback">
              <Field label="Jenis" required>
                <select className="input" value={form.jenis} onChange={e => setForm(f => ({ ...f, jenis: e.target.value }))}>
                  {(data?.jenis || []).map(j => <option key={j.key} value={j.key}>{j.label}</option>)}
                </select>
              </Field>
              <Field label="Judul Singkat" hint="Opsional — mis. “Tombol simpan tidak merespon”.">
                <input className="input" value={form.judul} maxLength={120}
                  onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} />
              </Field>
              <Field label="Isi Masukan / Kendala" required>
                <textarea className="input min-h-[130px]" value={form.pesan} required
                  placeholder="Jelaskan sedetail mungkin: menu apa, apa yang terjadi, dan apa yang Anda harapkan."
                  onChange={e => setForm(f => ({ ...f, pesan: e.target.value }))} />
              </Field>
              <Field label="Prioritas">
                <select className="input" value={form.prioritas} onChange={e => setForm(f => ({ ...f, prioritas: e.target.value }))}>
                  <option value="rendah">Rendah — saran perbaikan</option>
                  <option value="normal">Normal</option>
                  <option value="tinggi">Tinggi — menghambat pekerjaan</option>
                </select>
              </Field>
              <button className="btn-primary w-full py-2.5" type="submit" disabled={busy} data-save="feedback">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Kirim Masukan
              </button>
              <p className="text-[11.5px] text-slate-400">
                Nama, jabatan, dan role Anda otomatis dicatat agar pengelola dapat menindaklanjuti.
              </p>
            </form>
          ) : (
            <Alert tone="info" title="Mode baca saja">Role Anda tidak diberi izin mengirim masukan.</Alert>
          )}
        </Card>

        <Card title={data?.semua ? 'Semua Masukan Pengguna' : 'Masukan Saya'} subtitle={`${rows.length} laporan`}
          right={<button className="btn-ghost btn-sm" onClick={load}>Muat ulang</button>}>
          {rows.length ? (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {rows.map(r => {
                const Icon = JENIS_ICON[r.jenis] || Inbox;
                return (
                  <article key={r.id} className="rounded-xl border border-slate-100 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
                          <Icon size={13} className="text-orange-500" /> {r.judul || (r.jenis === 'kendala' ? 'Kendala' : 'Masukan')}
                          {r.prioritas === 'tinggi' ? <span className="badge badge-siaga">Prioritas</span> : null}
                        </p>
                        <p className="text-[11.5px] text-slate-500">
                          {waktu(r.created_at)} · {r.nama || '-'}{r.jabatan ? ` (${r.jabatan})` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={cx('badge', TONE[r.status] || 'badge-netral')}>{r.status}</span>
                        <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setDetail(r)} title="Lihat">
                          <Search size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600">{r.pesan}</p>
                    {r.balasan ? (
                      <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-[11.5px] text-sky-900">
                        <b>Balasan {r.balas_oleh || 'pengelola'}:</b> {r.balasan}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : <Empty icon={Inbox} title="Belum ada masukan" desc="Kirim masukan atau kendala pertama Anda melalui formulir di samping." />}
        </Card>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.judul || 'Rincian Masukan'}
        subtitle={detail ? `${detail.jenis} · ${waktu(detail.created_at)}` : ''}>
        {detail ? (
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2">
              <Info label="Pengirim" value={`${detail.nama || '-'}${detail.jabatan ? ' · ' + detail.jabatan : ''}`} />
              <Info label="Status" value={detail.status} />
              <Info label="Prioritas" value={detail.prioritas} />
              <Info label="Terkait halaman" value={detail.halaman || '-'} />
            </div>
            <div>
              <p className="label">Isi</p>
              <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600">{detail.pesan}</p>
            </div>
            {detail.balasan ? (
              <div>
                <p className="label">Balasan ({detail.balas_oleh || '-'})</p>
                <p className="whitespace-pre-wrap rounded-xl bg-sky-50 p-3 text-[12.5px] text-sky-900">{detail.balasan}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* =====================================================================
   REKAP MASUKAN & KENDALA USER — halaman rahasia (hak akses khusus)
   ===================================================================== */
export function FeedbackAdmin({ ctx }) {
  const { toast, refreshKey } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'all', jenis: 'all', q: '' });
  const [pilih, setPilih] = useState([]);
  const [edit, setEdit] = useState(null);
  const [balasan, setBalasan] = useState('');
  const [status, setStatus] = useState('dibaca');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ status: filter.status, jenis: filter.jenis, q: filter.q });
    api('/api/feedback?' + qs.toString())
      .then(r => { setData(r); setPilih([]); })
      .catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [filter.status, filter.jenis]);
  useEffect(load, [refreshKey, filter.status, filter.jenis]);

  async function simpanStatus() {
    setBusy(true);
    try {
      await api('/api/feedback/status', { method: 'POST', body: { id: edit.id, status, balasan } });
      toast.ok('Status masukan diperbarui.');
      setEdit(null); load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  async function hapusMasal() {
    if (!pilih.length) return toast.err('Pilih minimal satu masukan.');
    if (!window.confirm(`Hapus ${pilih.length} masukan terpilih?`)) return;
    setBusy(true);
    try {
      const r = await api('/api/feedback/delete', { method: 'POST', body: { ids: pilih } });
      toast.ok(r.pesan); load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  const rows = data?.rows || [];
  const stats = data?.stats || { total: 0, baru: 0, diproses: 0, selesai: 0 };
  const semua = rows.length > 0 && pilih.length === rows.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Masukan &amp; Kendala User</h2>
          <p className="text-[12.5px] text-slate-500">
            Rekapitulasi seluruh masukan pengguna sekolah. Halaman ini <b>rahasia</b> — hanya role yang diberi hak akses
            khusus (Permission Matrix) dapat membukanya.
          </p>
        </div>
        <span className="chip !border-rose-200 !bg-rose-50 !text-rose-700"><Lock size={12} /> Akses terbatas</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total" value={stats.total} icon={Inbox} />
        <Stat label="Baru" value={stats.baru} icon={MessageSquareWarning} tone="text-amber-600" />
        <Stat label="Diproses" value={stats.diproses} icon={Clock} tone="text-sky-600" />
        <Stat label="Selesai" value={stats.selesai} icon={CheckCircle2} tone="text-emerald-600" />
      </div>

      <Card title="Daftar Masukan" subtitle={`${rows.length} laporan ditampilkan`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input !w-[180px] !py-1.5 !pl-8 text-[12px]" placeholder="Cari nama / isi…" value={filter.q}
                onChange={e => setFilter(f => ({ ...f, q: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') load(); }} />
            </div>
            <select className="input !w-auto !py-1.5 text-[12px]" value={filter.status}
              onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
              <option value="all">Semua status</option>
              {(data?.status_list || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="input !w-auto !py-1.5 text-[12px]" value={filter.jenis}
              onChange={e => setFilter(f => ({ ...f, jenis: e.target.value }))}>
              <option value="all">Semua jenis</option>
              {(data?.jenis || []).map(j => <option key={j.key} value={j.key}>{j.label}</option>)}
            </select>
          </div>
        }>
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" checked={semua}
              data-fb-all="1" onChange={() => setPilih(semua ? [] : rows.map(r => r.id))} />
            Pilih Semua
          </label>
          <span className="text-[12px] font-semibold text-slate-500">Terpilih: <b className="text-orange-700">{pilih.length}</b></span>
          <button className="btn-danger btn-sm ml-auto" disabled={!pilih.length || busy} onClick={hapusMasal} data-fb-hapus="1">
            <Trash2 size={13} /> Hapus Terpilih
          </button>
        </div>
        {loading ? <Spinner /> : rows.length ? (
          <div className="tbl-wrap max-h-[70vh]">
            <table className="tbl" data-tbl="feedback-admin">
              <thead>
                <tr>
                  <th className="w-9" /><th className="w-28">Tanggal</th><th>Pengirim</th>
                  <th>Jenis</th><th>Masukan</th><th>Status</th><th className="w-16">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={pilih.includes(r.id) ? 'bg-orange-50/60' : ''}>
                    <td className="text-center">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" data-fb-item={r.id}
                        checked={pilih.includes(r.id)}
                        onChange={() => setPilih(l => l.includes(r.id) ? l.filter(x => x !== r.id) : [...l, r.id])} />
                    </td>
                    <td className="whitespace-nowrap text-[12px]">{tglPendek(r.created_at)}<span className="block text-slate-400">{String(r.created_at || '').slice(11, 16)}</span></td>
                    <td>
                      <p className="font-semibold text-slate-700">{r.nama || '-'}</p>
                      <p className="text-[11px] text-slate-400">{r.jabatan || r.role || '-'}</p>
                    </td>
                    <td><span className="chip !py-0.5">{r.jenis}</span></td>
                    <td className="max-w-[320px]">
                      <p className="truncate font-medium text-slate-700">{r.judul || '-'}</p>
                      <p className="truncate text-[11.5px] text-slate-400">{r.pesan}</p>
                    </td>
                    <td><span className={cx('badge', TONE[r.status] || 'badge-netral')}>{r.status}</span></td>
                    <td>
                      <button className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50" title="Tindak lanjut"
                        onClick={() => { setEdit(r); setStatus(r.status); setBalasan(r.balasan || ''); }}>
                        <Search size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Inbox} title="Belum ada masukan" desc="Masukan dari pengguna akan muncul di sini." />}
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Tindak Lanjut Masukan"
        subtitle={edit ? `${edit.nama || '-'} · ${waktu(edit.created_at)}` : ''}
        footer={<>
          <button className="btn-ghost" onClick={() => setEdit(null)}>Batal</button>
          <button className="btn-primary" onClick={simpanStatus} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan
          </button>
        </>}>
        {edit ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600 whitespace-pre-wrap">{edit.pesan}</div>
            <Field label="Status">
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                {(data?.status_list || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Balasan untuk pengguna" hint="Balasan tampil pada halaman Masukan & Kendala pengirim.">
              <textarea className="input min-h-[110px]" value={balasan} onChange={e => setBalasan(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-700">{value}</p>
    </div>
  );
}
function Stat({ label, value, icon: Icon, tone = 'text-slate-800' }) {
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-orange-500"><Icon size={17} /></span>
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={cx('text-[18px] font-extrabold leading-tight', tone)}>{value}</p>
      </div>
    </div>
  );
}
