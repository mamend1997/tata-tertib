import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Building2, ChevronRight, Copy, CreditCard, ExternalLink, Eye, Layers, LifeBuoy, Loader2, Plus,
  RefreshCw, RotateCcw, Save, Search, ShieldCheck, Sparkles, Trash2, UserCog, Wallet, Zap
} from 'lucide-react';
import { api, tgl, waktu, angka } from '../../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../../ui';
import { Kpi, Badge, statusTone, rupiah, salin, bytes } from './ui-saas';

/* =====================================================================
   1. DASHBOARD
   ===================================================================== */
export function SuperDashboard({ ctx }) {
  const { boot, go } = ctx;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const load = useCallback(() => api('/api/super/dashboard').then(setData).catch(e => toast.err(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Spinner label="Memuat ringkasan platform…" />;

  async function jalankanCron() {
    setBusy('cron');
    try {
      const r = await api('/api/super/cron', { method: 'POST' });
      toast.ok(r.pesan);
      load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }

  const s = data.stats;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Dashboard Super Admin</h2>
        <p className="text-[12.5px] text-slate-500">Ringkasan seluruh sekolah (tenant) yang terdaftar pada platform.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Sekolah" value={angka(s.total)} sub="seluruh tenant terdaftar" icon={Building2} tone="slate" onClick={() => go('sekolah')} />
        <Kpi label="Sekolah Aktif" value={angka(s.aktif)} sub={`${angka(s.lifetime)} lifetime · ${angka(s.trial)} uji coba`} icon={BadgeCheck} tone="emerald" onClick={() => go('sekolah')} />
        <Kpi label="Sekolah Terdaftar" value={angka(s.terdaftar)} sub={`${angka(s.ditangguhkan)} ditangguhkan`} icon={Layers} tone="sky" onClick={() => go('sekolah')} />
        <Kpi label="Siswa Terkelola" value={angka(s.siswa)} sub="akumulasi seluruh sekolah" icon={UserCog} tone="violet" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Menunggu Verifikasi" value={angka(s.menunggu_verifikasi)} sub="pembayaran perlu dicek" icon={Wallet} tone="orange" onClick={() => go('pembayaran')} />
        <Kpi label="Tagihan Terbuka" value={angka(s.tagihan_terbuka)} sub={rupiah(s.nilai_tagihan)} icon={CreditCard} tone="rose" onClick={() => go('pembayaran')} />
        <Kpi label="Tiket Baru" value={angka(s.tiket_baru)} sub="belum ditanggapi" icon={LifeBuoy} tone="sky" onClick={() => go('tiket')} />
        <Kpi label="Siswa / Sekolah" value={s.total ? angka(Math.round(s.siswa / s.total)) : 0} sub="rata-rata" icon={UserCog} tone="slate" />
      </div>

      <Card title="Penagihan & Pembekuan Otomatis" subtitle="Cron harian: notifikasi H-7, tagihan otomatis, dan suspend setelah masa aktif berakhir"
        right={<button className="btn-primary btn-sm" disabled={!!busy} onClick={jalankanCron}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Jalankan Pemeriksaan Tagihan Sekarang
        </button>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Terakhir dijalankan</p>
            <p className="text-[13px] font-bold text-slate-700">{data.cron.terakhir ? waktu(data.cron.terakhir) : 'Belum pernah'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Tagihan baru (putaran terakhir)</p>
            <p className="text-[13px] font-bold text-slate-700">{angka(data.cron.hasil?.dibuat || 0)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Ditangguhkan (putaran terakhir)</p>
            <p className="text-[13px] font-bold text-slate-700">{angka(data.cron.hasil?.ditangguhkan || 0)}</p>
          </div>
        </div>
        <Alert tone="info" title="Aman dijalankan berkali-kali">
          Pemeriksaan bersifat <b>idempoten</b> — tagihan dibuat satu kali per sekolah/periode, notifikasi H-7
          hanya dikirim sekali, dan sekolah yang sudah ditangguhkan tidak diproses ulang.
        </Alert>
        {data.cron.hasil?.detail?.length ? (
          <ul className="mt-2 space-y-1 text-[12px] text-slate-600">
            {data.cron.hasil.detail.map((d, i) => <li key={i} className="flex gap-2"><ChevronRight size={13} className="mt-0.5 shrink-0 text-orange-400" />{d}</li>)}
          </ul>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sekolah Terbaru" subtitle="5 tenant terakhir" right={<button className="btn-ghost btn-sm" onClick={() => go('sekolah')}>Lihat semua</button>}>
          {data.terbaru.length ? (
            <div className="space-y-2">
              {data.terbaru.map(t => (
                <button key={t.id} onClick={() => go('sekolah')} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-2.5 text-left hover:bg-slate-50">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-50 text-[11px] font-extrabold text-orange-600">{t.kode}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-slate-800">{t.nama}</p>
                    <p className="text-[11px] text-slate-500">{t.paket_nama} · {t.jenjang}</p>
                  </div>
                  <Badge tone={statusTone(t.status_label)}>{t.status_label}</Badge>
                </button>
              ))}
            </div>
          ) : <Empty title="Belum ada sekolah" />}
        </Card>

        <Card title="Perlu Tindakan" subtitle="Pembayaran & tiket menunggu">
          <div className="space-y-2">
            {data.pembayaran.length ? data.pembayaran.map(p => (
              <button key={p.id} onClick={() => go('pembayaran')} className="flex w-full items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-2.5 text-left hover:bg-amber-50">
                <Wallet size={16} className="text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-bold text-slate-800">{p.sekolah}</p>
                  <p className="text-[11px] text-slate-500">{p.bulan} bulan · {rupiah(p.total)}</p>
                </div>
                <ChevronRight size={14} className="text-slate-400" />
              </button>
            )) : <p className="text-[12.5px] text-slate-400">Tidak ada pembayaran menunggu.</p>}
            {data.tiket.length ? data.tiket.map(k => (
              <button key={k.id} onClick={() => go('tiket')} className="flex w-full items-center gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-2.5 text-left hover:bg-sky-50">
                <LifeBuoy size={16} className="text-sky-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-bold text-slate-800">#{k.id} {k.judul}</p>
                  <p className="text-[11px] text-slate-500">{k.sekolah} · {k.kategori}</p>
                </div>
                <ChevronRight size={14} className="text-slate-400" />
              </button>
            )) : null}
          </div>
        </Card>
      </div>

      <Card title="Aktivitas Terakhir Super Admin" subtitle="Audit log terbaru" right={<button className="btn-ghost btn-sm" onClick={() => go('audit')}>Semua log</button>}>
        <div className="space-y-1.5">
          {data.audit.map(a => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg px-1 py-1 text-[12px]">
              <span className="w-[110px] shrink-0 text-slate-400">{waktu(a.created_at)}</span>
              <Badge tone="netral">{a.modul}</Badge>
              <span className="font-semibold text-slate-700">{a.aksi}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{a.detail}</span>
            </div>
          ))}
          {!data.audit.length ? <p className="text-[12.5px] text-slate-400">Belum ada aktivitas.</p> : null}
        </div>
      </Card>
    </div>
  );
}

/* =====================================================================
   2. DAFTAR SEKOLAH + DETAIL
   ===================================================================== */
export function SuperSekolah({ ctx }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ paket: [], jenjang: [], fitur_all: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tambah, setTambah] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [form, setForm] = useState({ jenjang: 'SMK', paket: 'basic', trial_hari: 7 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/super/sekolah?q=' + encodeURIComponent(q) + '&status=' + encodeURIComponent(status));
      setRows(r.rows);
      setMeta({ paket: r.paket, jenjang: r.jenjang, fitur_all: r.fitur_all, stats: r.stats });
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  }, [q, status]);
  useEffect(() => { load(); }, [load]);

  async function simpanBaru(e) {
    e.preventDefault();
    try {
      const r = await api('/api/super/sekolah/simpan', { method: 'POST', body: form });
      toast.ok(r.pesan);
      if (r.kredensial) {
        toast.ok(`Akun admin: ${r.kredensial.username} / ${r.kredensial.password}`);
      }
      setTambah(false); setForm({ jenjang: 'SMK', paket: 'basic', trial_hari: 7 });
      load(); ctx.reload();
    } catch (e2) { toast.err(e2.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Daftar Sekolah</h2>
          <p className="text-[12.5px] text-slate-500">Manajemen tenant sekolah: paket, status, domain, akun admin, dan kontrol fitur.</p>
        </div>
        <button className="btn-primary" onClick={() => setTambah(true)}><Plus size={15} /> Tambah Sekolah</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Total" value={angka(meta.stats.total || 0)} icon={Building2} tone="slate" />
        <Kpi label="Aktif" value={angka(meta.stats.aktif || 0)} icon={BadgeCheck} tone="emerald" />
        <Kpi label="Uji Coba" value={angka(meta.stats.trial || 0)} icon={Sparkles} tone="sky" />
        <Kpi label="Ditangguhkan" value={angka(meta.stats.ditangguhkan || 0)} icon={AlertTriangle} tone="rose" />
      </div>

      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Cari nama sekolah, kode, email, domain…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <select className="input max-w-[190px]" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Semua status</option>
            <option value="aktif">Aktif</option>
            <option value="trial">Uji Coba</option>
            <option value="ditangguhkan">Ditangguhkan</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
        </div>
        {loading ? <div className="p-6"><Spinner label="Memuat sekolah…" /></div> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Kode</th><th>Sekolah</th><th>Paket</th><th>Status</th><th>Masa Aktif</th>
                  <th>Domain</th><th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id}>
                    <td><span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[12px] font-bold text-slate-700">{t.kode}</span></td>
                    <td>
                      <p className="font-bold text-slate-800">{t.nama}</p>
                      <p className="text-[11px] text-slate-500">{t.jenjang} · {t.email_admin || '—'}</p>
                    </td>
                    <td><Badge tone={t.paket === 'lifetime' ? 'prestasi' : t.paket === 'premium' ? 'pantau' : 'netral'}>{t.paket_nama}</Badge></td>
                    <td><Badge tone={statusTone(t.status_label)}>{t.status_label}</Badge></td>
                    <td className="whitespace-nowrap text-[12px]">{t.lifetime ? <span className="font-bold text-violet-600">Lifetime</span> : tgl(t.aktif_sampai)}</td>
                    <td className="text-[11.5px]">{t.custom_domain ? <span className="text-emerald-700">{t.custom_domain}</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="text-right">
                      <button className="btn-ghost btn-sm" onClick={() => setDetailId(t.id)}><Eye size={13} /> Detail Sekolah</button>
                    </td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={7}><Empty title="Belum ada sekolah" desc="Tekan “Tambah Sekolah” untuk membuat tenant pertama." /></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- modal tambah ---------- */}
      <Modal open={tambah} onClose={() => setTambah(false)} title="Tambah Sekolah" subtitle="Kode sekolah 4 digit dibuat otomatis" size="lg">
        <form id="fSekolahBaru" className="grid gap-3 sm:grid-cols-2" onSubmit={simpanBaru}>
          <Field label="Nama Sekolah" required className="sm:col-span-2">
            <input className="input" required value={form.nama || ''} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} placeholder="SMP Negeri 1 Contoh" />
          </Field>
          <Field label="Jenjang Pendidikan">
            <select className="input" value={form.jenjang} onChange={e => setForm(f => ({ ...f, jenjang: e.target.value }))}>
              {meta.jenjang.map(j => <option key={j.key} value={j.key}>{j.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">Kelas bawaan dibuat otomatis sesuai jenjang.</p>
          </Field>
          <Field label="Paket Langganan">
            <select className="input" value={form.paket} onChange={e => setForm(f => ({ ...f, paket: e.target.value }))}>
              {meta.paket.map(p => <option key={p.kode} value={p.kode}>{p.nama}</option>)}
            </select>
          </Field>
          <Field label="Masa Uji Coba (hari)" hint="0 = langsung aktif sesuai paket"><input className="input" inputMode="numeric" value={form.trial_hari} onChange={e => setForm(f => ({ ...f, trial_hari: e.target.value }))} /></Field>
          <Field label="Nama Kepala Sekolah"><input className="input" value={form.kepala || ''} onChange={e => setForm(f => ({ ...f, kepala: e.target.value }))} /></Field>
          <Field label="Nama Kontak / Admin"><input className="input" value={form.kontak_nama || ''} onChange={e => setForm(f => ({ ...f, kontak_nama: e.target.value }))} /></Field>
          <Field label="Telepon / WhatsApp"><input className="input" value={form.telp || ''} onChange={e => setForm(f => ({ ...f, telp: e.target.value }))} placeholder="0812xxxxxxx" /></Field>
          <Field label="Email Admin"><input className="input" type="email" value={form.email_admin || ''} onChange={e => setForm(f => ({ ...f, email_admin: e.target.value }))} /></Field>
          <Field label="Username Admin Sekolah"><input className="input" value={form.admin_username || ''} onChange={e => setForm(f => ({ ...f, admin_username: e.target.value }))} placeholder="admin" /></Field>
          <Field label="Kata Sandi Admin" hint="Kosongkan = dibuat otomatis"><input className="input" value={form.admin_password || ''} onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))} /></Field>
          <Field label="Alamat" className="sm:col-span-2"><textarea className="input" value={form.alamat || ''} onChange={e => setForm(f => ({ ...f, alamat: e.target.value }))} /></Field>
        </form>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setTambah(false)}>Batal</button>
          <button className="btn-primary" form="fSekolahBaru" type="submit"><Save size={15} /> Simpan Sekolah</button>
        </div>
      </Modal>

      {detailId ? <DetailSekolah id={detailId} onClose={() => setDetailId(null)} ctx={ctx} meta={meta} onChanged={load} /> : null}
    </div>
  );
}

function DetailSekolah({ id, onClose, ctx, meta, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('info');
  const [busy, setBusy] = useState('');
  const [pass, setPass] = useState('');
  const [hasilPass, setHasilPass] = useState(null);
  const [fitur, setFitur] = useState([]);
  const [form, setForm] = useState({});
  const [domain, setDomain] = useState('');
  const [cekDomain, setCekDomain] = useState(null);
  const [slugPortal, setSlugPortal] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api('/api/super/sekolah/' + id);
      setD(r);
      setForm({
        nama: r.tenant.nama, jenjang: r.tenant.jenjang, alamat: r.tenant.alamat || '',
        kepala: r.tenant.kepala || '', kontak_nama: r.tenant.kontak_nama || '',
        telp: r.tenant.telp || '', email_admin: r.tenant.email_admin || '',
        paket: r.tenant.paket, status: r.tenant.status, aktif_sampai: r.tenant.aktif_sampai || '',
        catatan: r.tenant.catatan || '',
        harga_bulanan: r.tenant.harga_bulanan || 0, harga_tahunan: r.tenant.harga_tahunan || 0,
        harga_catatan: r.tenant.harga_catatan || ''
      });
      setFitur(r.tenant.fitur || []);
      setDomain(r.tenant.custom_domain || '');
      setSlugPortal(r.tenant.portal_slug || r.tenant.slug || '');
    } catch (e) { toast.err(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return (
    <Modal open onClose={onClose} title="Detail Sekolah" size="lg"><Spinner label="Memuat detail sekolah…" /></Modal>
  );

  const t = d.tenant;
  const act = async (path, body, msg) => {
    setBusy(path);
    try {
      const r = await api(path, { method: 'POST', body: { id: t.id, ...(body || {}) } });
      toast.ok(r.pesan || msg || 'Tersimpan.');
      await load(); onChanged?.(); ctx.reload();
      return r;
    } catch (e) { toast.err(e.message); return null; }
    finally { setBusy(''); }
  };

  const TABS = [
    ['info', 'Informasi'], ['admin', 'Akun Admin'], ['fitur', 'Kontrol Fitur'],
    ['domain', 'Portal & Domain'], ['tagihan', 'Tagihan'], ['tiket', 'Tiket'], ['ringkas', 'Ringkasan']
  ];

  return (
    <Modal open onClose={onClose} title={`Detail Sekolah — ${t.nama}`} subtitle={`Kode ${t.kode} · ${t.paket_nama} · ${t.status_label}`} size="xl">
      <div className="tabs mb-3 sticky top-0 z-10">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('tab', tab === k && 'active')}>{l}</button>
        ))}
      </div>

      {tab === 'info' ? (
        <div className="space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Nama Sekolah"><input className="input" value={form.nama} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} /></Field>
            <Field label="Kode Sekolah"><input className="input bg-slate-50 font-mono" value={t.kode} readOnly /></Field>
            <Field label="Jenjang">
              <select className="input" value={form.jenjang} onChange={e => setForm(f => ({ ...f, jenjang: e.target.value }))}>
                {(meta.jenjang || []).map(j => <option key={j.key} value={j.key}>{j.label}</option>)}
              </select>
            </Field>
            <Field label="Paket">
              <select className="input" value={form.paket} onChange={e => setForm(f => ({ ...f, paket: e.target.value }))}>
                {(d.paket || []).map(p => <option key={p.kode} value={p.kode}>{p.nama}</option>)}
              </select>
            </Field>
            <Field label="Status Sekolah">
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="aktif">Aktif</option>
                <option value="trial">Uji Coba</option>
                <option value="ditangguhkan">Ditangguhkan</option>
                <option value="nonaktif">Nonaktif</option>
              </select>
            </Field>
            <Field label="Masa Aktif"><input className="input" type="date" value={form.aktif_sampai} onChange={e => setForm(f => ({ ...f, aktif_sampai: e.target.value }))} /></Field>
            <Field label="Telepon / WhatsApp"><input className="input" value={form.telp} onChange={e => setForm(f => ({ ...f, telp: e.target.value }))} /></Field>
            <Field label="Email Admin"><input className="input" value={form.email_admin} onChange={e => setForm(f => ({ ...f, email_admin: e.target.value }))} /></Field>
            <Field label="Nama Kontak"><input className="input" value={form.kontak_nama} onChange={e => setForm(f => ({ ...f, kontak_nama: e.target.value }))} /></Field>
            <Field label="Nama Kepala Sekolah"><input className="input" value={form.kepala} onChange={e => setForm(f => ({ ...f, kepala: e.target.value }))} /></Field>
            <Field label="Alamat" className="sm:col-span-2"><textarea className="input" value={form.alamat} onChange={e => setForm(f => ({ ...f, alamat: e.target.value }))} /></Field>
          </div>

          {/* Harga langganan khusus sekolah ini (override harga paket) */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-harga-override>
            <p className="text-[12.5px] font-bold text-amber-900">Harga Langganan Khusus Sekolah</p>
            <p className="mb-2 text-[11.5px] text-amber-800">
              Kosongkan / isi 0 untuk mengikuti harga paket <b>{t.paket_nama}</b>
              (Rp {(d.harga_paket_bulanan || 0).toLocaleString('id-ID')} / bulan · Rp {(d.harga_paket_tahunan || 0).toLocaleString('id-ID')} / tahun).
              Harga efektif saat ini: Rp {(d.harga_bulanan || 0).toLocaleString('id-ID')} / bulan.
              Isi nominal untuk memberi harga berbeda pada sekolah ini — dipakai saat membuat tagihan & QRIS.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Harga Khusus 1 Bulan (Rp)" hint="0 = ikut harga paket">
                <input className="input" inputMode="numeric" data-harga-bulanan value={form.harga_bulanan || ''}
                  placeholder={String(d.harga_paket_bulanan || 0)}
                  onChange={e => setForm(f => ({ ...f, harga_bulanan: e.target.value }))} />
              </Field>
              <Field label="Harga Khusus 12 Bulan (Rp)" hint="0 = 12 × harga bulanan">
                <input className="input" inputMode="numeric" data-harga-tahunan value={form.harga_tahunan || ''}
                  placeholder={String(d.harga_paket_tahunan || 0)}
                  onChange={e => setForm(f => ({ ...f, harga_tahunan: e.target.value }))} />
              </Field>
              <Field label="Catatan Kesepakatan" className="sm:col-span-2">
                <input className="input" data-harga-catatan value={form.harga_catatan || ''} placeholder="mis. harga khusus mitra / yayasan"
                  onChange={e => setForm(f => ({ ...f, harga_catatan: e.target.value }))} />
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold text-violet-800">Akses Lifetime</p>
              <p className="text-[11.5px] text-violet-700">Aktifkan agar sekolah tidak terkena tagihan & suspend otomatis.</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold text-violet-800">
              <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={!!t.lifetime}
                onChange={e => act('/api/super/sekolah/lifetime', { lifetime: e.target.checked })} />
              {t.lifetime ? 'Lifetime aktif' : 'Aktifkan Lifetime'}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!busy} onClick={() => act('/api/super/sekolah/simpan', form, 'Data sekolah disimpan.')}>
              {busy === '/api/super/sekolah/simpan' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Perubahan
            </button>
            <button className="btn-ghost" disabled={!!busy} onClick={async () => {
              const r = await act('/api/super/sekolah/impersonate', {}, 'Masuk sebagai admin sekolah…');
              if (r && r.ok) window.location.href = (window.__BASE__ || '') + '/';
            }}><ShieldCheck size={15} /> Login as Tenant</button>
            <button className="btn-ghost" disabled={!!busy} onClick={() => act('/api/super/sekolah/perpanjang', { bulan: 1 }, 'Masa aktif diperpanjang 1 bulan.')}>
              <RotateCcw size={15} /> Perpanjang 1 Bulan
            </button>
            <button className="btn-danger" disabled={!!busy} onClick={() => {
              if (confirm(`Nonaktifkan sekolah ${t.nama}? Data tetap tersimpan dan dapat diaktifkan kembali.`)) {
                act('/api/super/sekolah/hapus', {}, 'Sekolah dinonaktifkan.');
              }
            }}><Trash2 size={15} /> Nonaktifkan</button>
            <button className="btn-danger" disabled={!!busy} onClick={async () => {
              const ketik = prompt(`HAPUS PERMANEN sekolah ${t.nama} (${t.kode})?\nBerkas database sekolah ikut dihapus dan tidak dapat dikembalikan.\n\nKetik HAPUS untuk melanjutkan:`);
              if (ketik === null) return;
              setBusy('hapus-permanen');
              try {
                const r = await api('/api/super/sekolah/hapus-permanen', { method: 'POST', body: { id: t.id, konfirmasi: ketik } });
                toast.ok(r.pesan);
                onClose(); onChanged?.(); ctx.reload();
              } catch (e) { toast.err(e.message); }
              finally { setBusy(''); }
            }}><Trash2 size={15} /> Hapus Permanen</button>
          </div>
        </div>
      ) : null}

      {tab === 'admin' ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-100">
            <table className="tbl">
              <thead><tr><th>Nama</th><th>Username</th><th>Status</th><th>Dibuat</th></tr></thead>
              <tbody>
                {d.admins.map(a => (
                  <tr key={a.id}>
                    <td className="font-semibold">{a.nama}</td>
                    <td className="font-mono text-[12px]">{a.username}</td>
                    <td>{a.aktif ? <Badge tone="aman">Aktif</Badge> : <Badge tone="netral">Nonaktif</Badge>}</td>
                    <td className="text-[11.5px] text-slate-500">{waktu(a.created_at)}</td>
                  </tr>
                ))}
                {!d.admins.length ? <tr><td colSpan={4} className="text-slate-400">Belum ada akun admin.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3">
            <p className="text-[12.5px] font-bold text-orange-800">Reset Kata Sandi Admin Sekolah</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className="input max-w-[260px]" value={pass} onChange={e => setPass(e.target.value)} placeholder="Kata sandi baru" />
              <button className="btn-ghost btn-sm" onClick={async () => {
                const r = await api('/api/super/sekolah/' + t.id + '/password-acak?panjang=12');
                setPass(r.password);
              }}><Sparkles size={13} /> Generator Kata Sandi Acak</button>
              <button className="btn-primary btn-sm" disabled={!pass || !!busy} onClick={async () => {
                const r = await act('/api/super/sekolah/password', { password: pass }, 'Kata sandi direset.');
                if (r) setHasilPass({ username: r.username, password: r.password });
                setPass('');
              }}><ShieldCheck size={13} /> Reset</button>
            </div>
            {hasilPass ? (
              <div className="mt-2 rounded-lg bg-white p-2.5 text-[12px] ring-1 ring-orange-200">
                Kredensial baru — <b>{hasilPass.username}</b> / <b className="font-mono">{hasilPass.password}</b>
                <button className="ml-2 text-[11.5px] font-bold text-orange-700 underline" onClick={() => salin(`${hasilPass.username} / ${hasilPass.password}`, toast)}>Salin</button>
                <p className="mt-1 text-[11px] text-slate-500">Tampilkan sekali ini saja — catat dan serahkan ke sekolah.</p>
              </div>
            ) : null}
          </div>
          <Alert tone="info" title="Bantuan teknis">
            Gunakan <b>Login as Tenant</b> (tab Informasi) untuk masuk ke panel sekolah ini tanpa mengetahui kata sandinya —
            berguna saat menelusuri kendala yang dilaporkan melalui Pusat Bantuan.
          </Alert>
        </div>
      ) : null}

      {tab === 'fitur' ? (
        <div className="space-y-3">
          <Alert tone="info" title="Kontrol fitur sesuai paket">
            Bawaan mengikuti paket <b>{t.paket_nama}</b>. Ubah ceklis di bawah untuk memberi/membatasi akses khusus sekolah ini
            (biarkan kosong & simpan untuk kembali mengikuti paket).
          </Alert>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(meta.fitur_all || []).map(f => (
              <label key={f.key} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-[12.5px]">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={fitur.includes(f.key)}
                  onChange={e => setFitur(list => e.target.checked ? [...new Set([...list, f.key])] : list.filter(x => x !== f.key))} />
                <span className="min-w-0 flex-1 truncate text-slate-700">{f.label}</span>
                <span className="text-[10.5px] text-slate-400">{f.grup}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!busy} onClick={() => act('/api/super/sekolah/fitur', { fitur }, 'Kontrol fitur disimpan.')}>
              <Save size={15} /> Simpan Kontrol Fitur
            </button>
            <button className="btn-ghost" onClick={() => act('/api/super/sekolah/fitur', { fitur: [] }, 'Kontrol fitur mengikuti paket.')}>
              <RotateCcw size={15} /> Ikuti Paket
            </button>
            <button className="btn-ghost" onClick={() => setFitur((meta.fitur_all || []).map(f => f.key))}>Pilih Semua</button>
          </div>
        </div>
      ) : null}

      {tab === 'domain' ? (
        <div className="space-y-3">
          <Card title="Slug Khusus Portal Sekolah" subtitle="Alamat publik portal siswa: /nama-sekolah/portal-siswa">
            <div className="space-y-2 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-600">Kode sekolah:</span>
                <span className="font-mono font-bold text-slate-800">{t.kode}</span>
                <button className="btn-ghost btn-sm ml-auto" onClick={() => salin(t.kode, toast)}><Copy size={12} /> Salin</button>
              </div>
              <div>
                <label className="label">Slug portal (nama sekolah pada URL)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-[220px] flex-1 items-center rounded-lg bg-white px-2 ring-1 ring-slate-200">
                    <span className="py-2 font-mono text-[12px] text-slate-400">/</span>
                    <input className="input !w-auto min-w-0 flex-1 !border-0 !py-1.5 font-mono text-[12.5px] !shadow-none"
                      data-portal-slug value={slugPortal}
                      onChange={e => setSlugPortal(String(e.target.value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-'))}
                      placeholder="nama-sekolah" />
                    <span className="whitespace-nowrap py-2 font-mono text-[12px] text-slate-400">/portal-siswa</span>
                  </div>
                  <button className="btn-primary btn-sm" disabled={busy === 'slug' || !slugPortal}
                    onClick={() => act('/api/super/sekolah/simpan', { portal_slug: slugPortal }, 'Slug portal disimpan.')}>
                    <Save size={13} /> Simpan Slug
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Dipakai otomatis pada semua tautan portal di aplikasi (dashboard, sidebar, dan berbagi tautan).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-600">Portal siswa:</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-slate-700" data-portal-url>
                  {(window.location.origin || '') + (window.__BASE__ || '') + (t.portal_path || '')}
                </span>
                <button className="btn-ghost btn-sm" onClick={() => salin((window.location.origin || '') + (window.__BASE__ || '') + (t.portal_path || ''), toast)}><Copy size={12} /> Salin</button>
                <a className="btn-ghost btn-sm" href={(window.__BASE__ || '') + (t.portal_path || '')} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Buka</a>
              </div>
              <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" defaultChecked={!!t.portal_aktif}
                  onChange={e => act('/api/super/sekolah/simpan', { portal_aktif: e.target.checked }, 'Status portal disimpan.')} />
                Portal publik aktif untuk sekolah ini
              </label>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Alamat lama <code className="rounded bg-slate-100 px-1">/portal</code> sudah tidak dipakai (404).
                Sekolah juga dapat mengubah slug ini sendiri di <b>Pengaturan → Portal Publik</b>.
              </p>
            </div>
          </Card>

          <Card title="Domain Custom" subtitle="Sekolah juga dapat mengubahnya sendiri di Pengaturan → Domain & Langganan">
            <div className="flex flex-wrap gap-2">
              <input className="input max-w-[320px]" value={domain} onChange={e => setDomain(e.target.value)} placeholder="tertib.sekolah.sch.id" />
              <button className="btn-primary btn-sm" onClick={() => act('/api/super/sekolah/domain', { domain }, 'Domain disimpan.')}><Save size={14} /> Simpan</button>
              <button className="btn-ghost btn-sm" disabled={!domain} onClick={async () => {
                setBusy('cek');
                try {
                  const r = await api('/api/super/sekolah/domain/cek', { method: 'POST', body: { id: t.id } });
                  setCekDomain(r);
                  toast.ok(r.cocok ? 'Domain sudah mengarah ke platform.' : 'Domain belum terdeteksi.');
                } catch (e) { toast.err(e.message); }
                finally { setBusy(''); }
              }}>{busy === 'cek' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Cek Domain</button>
            </div>
            {t.domain_status ? <p className="mt-2 text-[11.5px]">Status domain: <Badge tone={t.domain_status === 'aktif' ? 'aman' : 'pantau'}>{t.domain_status}</Badge> {t.domain_cek_at ? <span className="text-slate-400">· dicek {waktu(t.domain_cek_at)}</span> : null}</p> : null}
            {cekDomain ? <Alert tone={cekDomain.cocok ? 'info' : 'warn'} title={cekDomain.cocok ? 'Domain terhubung' : 'Perlu pengaturan DNS'}>{cekDomain.pesan}</Alert> : null}
            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600">
              <p className="mb-1 font-bold text-slate-700">Panduan pemasangan domain custom</p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Buka panel DNS domain sekolah (registrar / Cloudflare).</li>
                <li>Tambahkan <b>CNAME</b>: nama bebas → <code className="rounded bg-white px-1">{d.platform?.domain || 'domain platform'}</code>.</li>
                <li>Alternatif: <b>A Record</b> ke IP server platform (minta ke dukungan).</li>
                <li>Tekan <b>Cek Domain</b> — propagasi 5–30 menit.</li>
                <li>Hubungi Pusat Bantuan bila lewat 24 jam belum aktif.</li>
              </ol>
            </div>
            {d.domain_log?.length ? (
              <div className="mt-2 space-y-1">
                {d.domain_log.map(l => (
                  <p key={l.id} className="text-[11.5px] text-slate-500">{waktu(l.created_at)} · <b>{l.status}</b> · {l.pesan}</p>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === 'tagihan' ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Paket</p>
              <p className="text-[13px] font-bold text-slate-800">{t.paket_nama}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Masa aktif</p>
              <p className="text-[13px] font-bold text-slate-800">{t.lifetime ? 'Lifetime' : tgl(t.aktif_sampai)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Terdaftar</p>
              <p className="text-[13px] font-bold text-slate-800">{tgl(t.created_at)}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="tbl">
              <thead><tr><th>Periode</th><th>Nominal</th><th>Jatuh Tempo</th><th>Status</th><th>Notif H-7</th></tr></thead>
              <tbody>
                {(d.tagihan || []).map(g => (
                  <tr key={g.id}>
                    <td className="font-mono text-[12px]">{g.periode}</td>
                    <td>{rupiah(g.total)}</td>
                    <td>{tgl(g.jatuh_tempo)}</td>
                    <td><Badge tone={g.status === 'lunas' ? 'aman' : g.status === 'batal' ? 'netral' : 'pantau'}>{g.status}</Badge></td>
                    <td className="text-[11.5px] text-slate-500">{g.notif_h7 ? waktu(g.notif_h7) : '—'}</td>
                  </tr>
                ))}
                {!(d.tagihan || []).length ? <tr><td colSpan={5} className="text-slate-400">Belum ada tagihan.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="tbl">
              <thead><tr><th>Diajukan</th><th>Bulan</th><th>Total</th><th>Status</th><th>Pembayar</th></tr></thead>
              <tbody>
                {(d.pembayaran || []).map(p => (
                  <tr key={p.id}>
                    <td className="text-[11.5px]">{waktu(p.created_at)}</td>
                    <td>{p.bulan} bulan</td>
                    <td>{rupiah(p.total)}</td>
                    <td><Badge tone={p.status === 'disetujui' ? 'aman' : p.status === 'ditolak' ? 'siaga' : 'pantau'}>{p.status}</Badge></td>
                    <td className="text-[11.5px]">{p.oleh_nama || '—'}</td>
                  </tr>
                ))}
                {!(d.pembayaran || []).length ? <tr><td colSpan={5} className="text-slate-400">Belum ada pengajuan pembayaran.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'tiket' ? (
        <div className="space-y-2">
          {(d.tiket || []).map(k => (
            <div key={k.id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400">#{k.id}</span>
                <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-800">{k.judul}</p>
                <Badge tone={k.status === 'selesai' ? 'aman' : k.status === 'baru' ? 'pantau' : 'netral'}>{k.status}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{waktu(k.dibuat)} · {k.kategori} · {k.jumlah_pesan} pesan</p>
            </div>
          ))}
          {!(d.tiket || []).length ? <Empty title="Tidak ada tiket" desc="Sekolah ini belum pernah mengirim kendala." /> : null}
        </div>
      ) : null}

      {tab === 'ringkas' ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            {[['Siswa', d.jumlah.siswa], ['Kelas', d.jumlah.kelas], ['Kejadian', d.jumlah.kejadian], ['Pengguna', d.jumlah.pengguna]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{l}</p>
                <p className="text-[18px] font-extrabold text-slate-800">{angka(v)}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-100 p-3 text-[12.5px] leading-relaxed text-slate-600">
            <p><b>Nama sekolah:</b> {t.nama}</p>
            <p><b>Kode:</b> {t.kode} · <b>Slug:</b> {t.slug || '-'}</p>
            <p><b>Paket:</b> {t.paket_nama}{t.lifetime ? ' (Lifetime)' : ''}</p>
            <p><b>Status:</b> {t.status_label} · <b>Masa aktif:</b> {t.lifetime ? 'Lifetime' : tgl(t.aktif_sampai)}</p>
            <p><b>Terdaftar:</b> {waktu(t.created_at)} · <b>Terakhir masuk:</b> {t.terakhir_masuk ? waktu(t.terakhir_masuk) : '—'}</p>
            <p><b>Kontak:</b> {t.kontak_nama || '—'} · {t.telp || '—'} · {t.email_admin || '—'}</p>
            <p><b>Alamat:</b> {t.alamat || '—'}</p>
            <p><b>Penyimpanan DB:</b> {bytes(t.db_size)}</p>
            <p><b>Domain custom:</b> {t.custom_domain || '—'} ({t.domain_status || 'belum diatur'})</p>
            <p><b>Fitur dibuka:</b> {t.fitur ? t.fitur.length + ' modul' : 'semua modul'}</p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
