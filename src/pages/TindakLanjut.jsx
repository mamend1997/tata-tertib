import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, CheckCircle2, ClipboardList, Download, HeartHandshake, Loader2, Plus, Printer, Search,
  Trash2, UserRound
} from 'lucide-react';
import { api, docUrl, openDoc, tgl, waktu } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';
import MultiStudentPicker from '../components/MultiStudentPicker';

const STATUS_TONE = { selesai: 'badge-aman', pemantauan: 'badge-pantau', lanjutan: 'badge-siaga' };
const nowLocal = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function TindakLanjut({ ctx }) {
  const { can, refreshKey, toast } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'all', q: '' });
  const [siswaList, setSiswaList] = useState([]);
  const [form, setForm] = useState({
    siswa_ids: [], tanggal: nowLocal(), jenis: '', hasil: '', status: 'pemantauan', next_at: ''
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams({ status: filter.status, q: filter.q }).toString();
    api('/api/tindak-lanjut?' + q)
      .then(setData).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [filter.status, refreshKey]);

  useEffect(() => {
    api('/api/siswa-options?all=1').then(r => setSiswaList(r.rows)).catch(() => {});
  }, []);

  const jenis = data?.jenis || [];
  const statusList = data?.status_list || [];
  useEffect(() => {
    if (jenis.length && !form.jenis) setForm(v => ({ ...v, jenis: jenis[0] }));
  }, [jenis.length]);

  async function simpan(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api('/api/tindak-lanjut/save', {
        method: 'POST',
        body: { ...form, siswa_id: form.siswa_ids[0] || '', tanggal: form.tanggal.replace('T', ' ') }
      });
      toast.ok(`Catatan tindak lanjut tersimpan untuk ${r.jumlah} siswa.`);
      setForm(v => ({ ...v, siswa_ids: [], hasil: '', next_at: '', tanggal: nowLocal() }));
      load();
    } catch (e2) { toast.err(e2.message); }
    finally { setSaving(false); }
  }

  async function hapus(row) {
    if (!window.confirm(`Hapus catatan pembinaan untuk ${row.siswa_nama}?`)) return;
    try { await api('/api/tindak-lanjut/' + row.id, { method: 'DELETE' }); toast.ok('Catatan dihapus.'); load(); }
    catch (e) { toast.err(e.message); }
  }

  const stats = data?.stats || { total: 0, selesai: 0, pemantauan: 0, lanjutan: 0 };
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of data?.rows || []) {
      const key = String(r.tanggal).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Catatan Tindak Lanjut &amp; Pendekatan Siswa</h2>
          <p className="text-[12.5px] text-slate-500">
            Dokumentasi hasil konseling, mediasi, home visit, dan pembinaan siswa — otomatis tampil pada kartu siswa
            sehingga wali kelas &amp; kesiswaan dapat memantau perkembangan secara transparan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={() => openDoc('/api/tindak-lanjut/cetak')} data-cetak-tl>
            <Printer size={14} /> Cetak / Simpan PDF
          </button>
          <a className="btn-ghost btn-sm" href={docUrl('/api/tindak-lanjut/word')} data-word-tl>
            <Download size={14} /> Word (.docx)
          </a>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Catatan" value={stats.total} tone="orange" icon={ClipboardList} />
        <StatCard label="Selesai" value={stats.selesai} tone="emerald" icon={CheckCircle2} />
        <StatCard label="Dalam Pemantauan" value={stats.pemantauan} tone="sky" icon={CalendarClock} />
        <StatCard label="Perlu Lanjutan" value={stats.lanjutan} tone="rose" icon={HeartHandshake} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card title="Catat Hasil Pendekatan" subtitle="Tanggal & jam terisi otomatis, dapat disesuaikan" className="h-fit">
          {can('tindak_lanjut', 'write') ? (
            <form onSubmit={simpan} className="space-y-3">
              <Field label="Tanggal & Jam Tindak Lanjut" required>
                <input type="datetime-local" className="input" value={form.tanggal} required
                  onChange={e => setForm(v => ({ ...v, tanggal: e.target.value }))} />
              </Field>
              <MultiStudentPicker label="Pilih Siswa" required value={form.siswa_ids} all
                onChange={(ids) => setForm(v => ({ ...v, siswa_ids: ids }))}
                hint="Bisa memilih beberapa siswa sekaligus (pendekatan kelompok)." />
              <Field label="Jenis Pendekatan / Metode" required>
                <select className="input" value={form.jenis} required
                  onChange={e => setForm(v => ({ ...v, jenis: e.target.value }))}>
                  {jenis.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </Field>
              <Field label="Hasil Catatan / Progress Perkembangan" required
                hint="Tuliskan poin dialog, kondisi siswa, dan kesepakatan yang dicapai.">
                <textarea className="input min-h-[128px]" value={form.hasil} required
                  placeholder="Contoh: Siswa mengakui sering terlambat karena membantu orang tua…"
                  onChange={e => setForm(v => ({ ...v, hasil: e.target.value }))} />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Status Penanganan" required>
                  <select className="input" value={form.status} onChange={e => setForm(v => ({ ...v, status: e.target.value }))}>
                    {statusList.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Sesi Berikutnya" hint="Opsional">
                  <input type="date" className="input" value={form.next_at} onChange={e => setForm(v => ({ ...v, next_at: e.target.value }))} />
                </Field>
              </div>
              <button type="submit" className="btn-primary w-full py-2.5" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Simpan Catatan
              </button>
            </form>
          ) : (
            <Alert tone="info" title="Mode baca saja">
              Role Anda dapat melihat riwayat pembinaan, namun pencatatan hanya untuk Guru BK, Kesiswaan, atau role yang
              diberi izin oleh Administrator.
            </Alert>
          )}
        </Card>

        <Card title="Riwayat Pembinaan" subtitle={`${data?.rows?.length || 0} catatan`}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input !w-[180px] !py-1.5 !pl-8 text-[12px]" placeholder="Cari siswa / isi catatan…"
                  value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') load(); }} />
              </div>
              <select className="input !w-auto !py-1.5 text-[12px]" value={filter.status}
                onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
                <option value="all">Semua status</option>
                {statusList.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button className="btn-soft btn-sm" onClick={load}>Terapkan</button>
            </div>
          }>
          {loading ? <Spinner /> : groups.length ? (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              {groups.map(([tanggal, rows]) => (
                <div key={tanggal}>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{tgl(tanggal, { long: true })}</p>
                  <div className="space-y-2">
                    {rows.map(r => (
                      <article key={r.id} className="rounded-xl border border-slate-100 bg-white p-3 transition hover:border-orange-200">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
                              <UserRound size={13} className="text-orange-500" /> {r.siswa_nama}
                              <span className="text-[11px] font-medium text-slate-400">· {r.kelas_nama || '-'}</span>
                            </p>
                            <p className="text-[11.5px] text-slate-500">
                              {r.jenis} · {waktu(r.tanggal)} · oleh {r.oleh_nama}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={cx('badge', STATUS_TONE[r.status] || 'badge-netral')}>
                              {(statusList.find(s => s.key === r.status) || {}).label || r.status}
                            </span>
                            {can('tindak_lanjut', 'delete') ? (
                              <button onClick={() => hapus(r)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-600">{r.hasil}</p>
                        {r.next_at ? (
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-orange-600">
                            <CalendarClock size={12} /> Sesi berikutnya: {tgl(r.next_at)}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty icon={HeartHandshake} title="Belum ada catatan pembinaan"
            desc="Catat hasil pendekatan pertama melalui formulir di samping." />}
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone, icon: Icon }) {
  const tones = {
    orange: 'from-orange-500 to-amber-500', emerald: 'from-emerald-500 to-teal-500',
    sky: 'from-sky-500 to-cyan-500', rose: 'from-rose-500 to-orange-500'
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
