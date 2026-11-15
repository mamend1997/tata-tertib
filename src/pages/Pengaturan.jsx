import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, CalendarDays, Eye, EyeOff, Image as ImageIcon, Loader2, Palette, Plus, Save,
  Settings2, ShieldCheck, Type, Upload, Building2, ListChecks, Pencil, MapPin, Gavel, Trash2,
  DatabaseBackup, RotateCcw, FileSignature, HardDrive, Link2, Copy, ExternalLink, MessageCircle, Send, Lock,
  GraduationCap
} from 'lucide-react';
import { api, compressImage } from '../api';
import { BackupRestore, ResetTahun, TautanAuditData } from './PengaturanExtra';
import { TingkatJenjang, KenaikanKelas } from './PengaturanTingkat';
import RekapAbsensiWA from './PengaturanRekap';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';

const shadeColor = (hex, amt) => {
  const n = parseInt(String(hex).slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(v => Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, '0')).join('');
};

const TABS = [
  { key: 'identitas', label: 'Identitas Sekolah', icon: Building2 },
  { key: 'branding', label: 'Branding Aplikasi', icon: Palette },
  { key: 'menu', label: 'Tampilan Menu & UI', icon: ListChecks },
  { key: 'form', label: 'Form Input Kejadian', icon: Type },
  { key: 'poin', label: 'Status & Deteksi Dini', icon: ShieldCheck },
  { key: 'lokasi', label: 'Lokasi & Sanksi', icon: MapPin },
  { key: 'kop', label: 'Kop Surat', icon: FileSignature },
  { key: 'wa', label: 'WhatsApp Gateway', icon: MessageCircle },
  { key: 'absensi', label: 'Rekap Absensi & WA', icon: ListChecks },
  { key: 'unggahan', label: 'Unggahan & Penyimpanan', icon: HardDrive },
  { key: 'backup', label: 'Backup & Restore', icon: DatabaseBackup },
  { key: 'reset', label: 'Reset Tahun Ajaran', icon: RotateCcw },
  { key: 'tingkat', label: 'Jenjang & Tingkat Kelas', icon: GraduationCap },
  { key: 'tahun', label: 'Tahun Pelajaran', icon: CalendarDays }
];

/* =====================================================================
   Slug Khusus Portal Sekolah — alamat publik: /<slug>/portal-siswa
   ===================================================================== */
function SlugPortal({ readOnly, onSaved }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api('/api/portal-slug');
      setState(r);
      setSlug(r.slug);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function simpan() {
    setErr(''); setBusy(true);
    try {
      const r = await api('/api/portal-slug', { method: 'POST', body: { slug } });
      toast.ok(r.pesan);
      await load();
      /* segarkan bootstrap agar tautan portal di dashboard & sidebar langsung berubah */
      if (onSaved) await onSaved();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const url = state ? (state.url || '') : '';
  const path = state ? (state.path || '') : '';
  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-orange-900">
        <Link2 size={14} /> Slug Khusus Portal Sekolah
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-orange-800">
        Alamat publik portal siswa milik sekolah ini. Format: <code className="rounded bg-white px-1">/nama-sekolah/portal-siswa</code>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <div className="flex min-w-[200px] flex-1 items-center rounded-lg bg-white px-2 ring-1 ring-orange-200">
          <span className="py-2 font-mono text-[12px] text-slate-400">/</span>
          <input className="input !w-auto min-w-0 flex-1 !border-0 !py-1.5 font-mono text-[12.5px] !shadow-none"
            value={slug} disabled={readOnly || busy} data-portal-slug
            onChange={e => setSlug(String(e.target.value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-'))}
            placeholder="nama-sekolah" />
          <span className="whitespace-nowrap py-2 font-mono text-[12px] text-slate-400">/portal-siswa</span>
        </div>
        <button type="button" className="btn-primary btn-sm" disabled={readOnly || busy || !slug} onClick={simpan}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Slug
        </button>
      </div>
      {err ? <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600">{err}</p> : null}
      {state ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-orange-100">
            <span className="text-[11px] font-semibold text-slate-500">Tautan portal:</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700" data-portal-url>{url || path || '-'}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(url).then(() => toast.ok('Tautan portal disalin.'), () => toast.err('Gagal menyalin.')); }}>
              <Copy size={12} /> Salin
            </button>
            <a href={path} target="_blank" rel="noreferrer" className="btn-ghost btn-sm"><ExternalLink size={12} /> Buka</a>
          </div>
          {!state.portal_aktif ? (
            <p className="text-[11px] font-semibold text-amber-700">Portal sedang dinonaktifkan — aktifkan sakelar portal di atas agar tautan ini bisa dipakai.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Pengaturan({ ctx }) {
  const { can, boot, refreshKey, reloadBoot, toast, filters, setFilters } = ctx;
  const [tab, setTab] = useState('identitas');
  const readOnly = !can('pengaturan', 'write');

  useEffect(() => {
    if (ctx.guide?.page === 'pengaturan' && ctx.guide.tab) setTab(ctx.guide.tab);
  }, [ctx.guide?.runId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Pengaturan</h2>
        <p className="text-[12.5px] text-slate-500">Identitas sekolah, branding, tampilan menu, form input kejadian, ambang poin, dan tahun pelajaran.</p>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx('tab flex items-center gap-1.5', tab === t.key && 'active')}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {readOnly ? <Alert tone="info" title="Mode baca saja">Role Anda hanya dapat melihat pengaturan. Perubahan memerlukan izin Tambah/Ubah pada modul Pengaturan.</Alert> : null}

      {tab === 'identitas' ? <Identitas ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'branding' ? <Branding ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'menu' ? <MenuUI ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'form' ? <FormConfig ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'poin' ? <PoinConfig ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'lokasi' ? <LokasiSanksi ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'kop' ? <KopSurat ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'wa' ? <WAGateway ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'absensi' ? <RekapAbsensiWA ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'unggahan' ? <Unggahan ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'backup' ? (
        <div className="space-y-4">
          <BackupRestore ctx={ctx} readOnly={readOnly} />
          <TautanAuditData ctx={ctx} />
        </div>
      ) : null}
      {tab === 'reset' ? <ResetTahun ctx={ctx} /> : null}
      {tab === 'tahun' ? <TahunAjaran ctx={ctx} readOnly={readOnly} /> : null}
      {tab === 'tingkat' ? (
        <div className="space-y-4">
          <TingkatJenjang ctx={ctx} readOnly={readOnly} />
          {!readOnly ? <KenaikanKelas ctx={ctx} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- helper simpan ---------------- */
function useSave(ctx) {
  const [busy, setBusy] = useState(false);
  const save = async (data, msg = 'Pengaturan disimpan.') => {
    setBusy(true);
    try {
      await api('/api/settings/save', { method: 'POST', body: { data } });
      ctx.toast.ok(msg);
      await ctx.reloadBoot();
    } catch (e) { ctx.toast.err(e.message); }
    finally { setBusy(false); }
  };
  return { busy, save };
}

/* ---------------- upload gambar (logo) ---------------- */
function ImageInput({ label, value, onChange, hint, disabled }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function pick(file) {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const small = await compressImage(file, { maxKb: 900, maxSide: 720, quality: 0.9 });
      let body;
      if (small) body = { base64: small.base64, filename: small.filename, jenis: 'logo' };
      else {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = rej; r.readAsDataURL(file); });
        body = { base64: b64, filename: file.name, jenis: 'logo' };
      }
      const r = await api('/api/upload', { method: 'POST', body });
      onChange(r.url);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {value ? <img src={value} alt="" className="h-full w-full object-contain p-1" /> : <ImageIcon size={20} className="text-slate-300" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={cx('btn-ghost cursor-pointer', (busy || disabled) && 'pointer-events-none opacity-60')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Pilih Gambar
            <input type="file" accept="image/*" className="hidden" disabled={disabled} onChange={e => pick(e.target.files?.[0])} />
          </label>
          {value ? <button type="button" className="btn-danger btn-sm" onClick={() => onChange('')} disabled={disabled}>Hapus</button> : null}
        </div>
      </div>
      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
      {err ? <p className="mt-1 text-[11.5px] text-rose-600">{err}</p> : null}
    </div>
  );
}

/* ---------------- Identitas ---------------- */
function Identitas({ ctx, readOnly }) {
  const s = ctx.boot.settings;
  const { busy, save } = useSave(ctx);
  const [f, setF] = useState({});
  useEffect(() => setF({
    sekolah_nama: s.sekolah_nama || '', sekolah_npsn: s.sekolah_npsn || '', sekolah_bentuk: s.sekolah_bentuk || 'SMK',
    sekolah_status: s.sekolah_status || 'Swasta', sekolah_telp: s.sekolah_telp || '', sekolah_email: s.sekolah_email || '',
    sekolah_website: String(s.sekolah_website || '').replace(/^https?:\/\//i, ''), sekolah_alamat: s.sekolah_alamat || '', kepala_nama: s.kepala_nama || '',
    kepala_nip: s.kepala_nip || '', bendahara_nama: s.bendahara_nama || '', bendahara_nip: s.bendahara_nip || '',
    wakasek_nama: s.wakasek_nama || '', wakasek_nip: s.wakasek_nip || '', wakasek_jabatan: s.wakasek_jabatan || 'Wakasek Kesiswaan',
    logo: s.logo || '', print_tempat: s.print_tempat || ''
  }), [s]);

  return (
    <form onSubmit={e => { e.preventDefault(); save(f, 'Identitas sekolah disimpan.'); }} className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Informasi Sekolah" subtitle="Dipakai otomatis pada kop surat & portal publik">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama Sekolah" required className="sm:col-span-2">
            <input className="input" value={f.sekolah_nama || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_nama: e.target.value }))} />
          </Field>
          <Field label="NPSN" hint="8 digit angka"><input className="input" value={f.sekolah_npsn || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_npsn: e.target.value }))} /></Field>
          <Field label="Bentuk Pendidikan">
            <select className="input" value={f.sekolah_bentuk || 'SMK'} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_bentuk: e.target.value }))}>
              {['SMK', 'SMA', 'MA', 'SMP', 'MTS', 'SD', 'MI', 'PAUD'].map(x => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Status Sekolah">
            <select className="input" value={f.sekolah_status || 'Swasta'} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_status: e.target.value }))}>
              <option>Negeri</option><option>Swasta</option>
            </select>
          </Field>
          <Field label="Tempat pada Tanggal Cetak"><input className="input" value={f.print_tempat || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, print_tempat: e.target.value }))} /></Field>
          <Field label="No. Telepon"><input className="input" value={f.sekolah_telp || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_telp: e.target.value }))} /></Field>
          <Field label="Email"><input className="input" value={f.sekolah_email || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_email: e.target.value }))} /></Field>
          <Field label="Website" className="sm:col-span-2"
            hint="Tulis tanpa https:// — contoh: www.sekolah.sch.id (protokol ditambahkan otomatis).">
            <input className="input" value={f.sekolah_website || ''} disabled={readOnly} placeholder="www.sekolah.sch.id"
              onChange={e => setF(v => ({ ...v, sekolah_website: e.target.value.replace(/^https?:\/\//i, '') }))} />
          </Field>
          <Field label="Alamat Lengkap" className="sm:col-span-2">
            <textarea className="input" value={f.sekolah_alamat || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, sekolah_alamat: e.target.value }))} />
          </Field>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Logo & Pejabat">
          <ImageInput label="Logo Sekolah (favicon & kop surat)" value={f.logo} onChange={url => setF(v => ({ ...v, logo: url }))}
            hint="Otomatis menjadi favicon browser dan logo kop surat." disabled={readOnly} />
          <div className="mt-3 grid gap-3">
            <Field label="Nama Kepala Sekolah"><input className="input" value={f.kepala_nama || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, kepala_nama: e.target.value }))} /></Field>
            <Field label="NIP Kepala Sekolah"><input className="input" value={f.kepala_nip || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, kepala_nip: e.target.value }))} /></Field>
            <Field label="Nama Bendahara"><input className="input" value={f.bendahara_nama || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, bendahara_nama: e.target.value }))} /></Field>
            <Field label="NIP Bendahara"><input className="input" value={f.bendahara_nip || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, bendahara_nip: e.target.value }))} /></Field>
          </div>
        </Card>

        <Card title="Wakasek Kesiswaan" subtitle="Nama & NIP ini tercetak pada kolom tanda tangan laporan rekap poin">
          <div className="grid gap-3">
            <Field label="Jabatan pada Tanda Tangan" hint="Contoh: Wakasek Kesiswaan / Kesiswaan">
              <input className="input" value={f.wakasek_jabatan || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, wakasek_jabatan: e.target.value }))} />
            </Field>
            <Field label="Nama Wakasek Kesiswaan">
              <input className="input" value={f.wakasek_nama || ''} disabled={readOnly} placeholder="Nama lengkap & gelar"
                onChange={e => setF(v => ({ ...v, wakasek_nama: e.target.value }))} />
            </Field>
            <Field label="NIP Wakasek Kesiswaan">
              <input className="input" value={f.wakasek_nip || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, wakasek_nip: e.target.value }))} />
            </Field>
            <p className="rounded-xl bg-orange-50 px-3 py-2 text-[11.5px] leading-relaxed text-orange-800">
              Tanda tangan cetak menggunakan data resmi di atas — <b>bukan</b> nama akun yang sedang login.
            </p>
          </div>
        </Card>
        {!readOnly ? <button className="btn-primary w-full" disabled={busy} data-guide-target="setup-profile-save">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Identitas
        </button> : null}
      </div>
    </form>
  );
}

/* ---------------- Branding ---------------- */
function Branding({ ctx, readOnly }) {
  const s = ctx.boot.settings;
  const { busy, save } = useSave(ctx);
  const [f, setF] = useState({});
  useEffect(() => setF({
    app_nama: s.app_nama || '', app_logo: s.app_logo || '', primary_color: s.primary_color || '#ea580c',
    gradient_bg: String(s.gradient_bg ?? '1'), portal_judul: s.portal_judul || '', portal_subtitle: s.portal_subtitle || '',
    portal_aktif: String(s.portal_aktif ?? '1'), wa_template: s.wa_template || ''
  }), [s]);

  const colors = ['#ea580c', '#dc2626', '#d97706', '#16a34a', '#0ea5e9', '#4f46e5', '#7c3aed', '#db2777', '#0f766e', '#334155'];
  const preview = (c) => {
    setF(v => ({ ...v, primary_color: c }));
    if (/^#[0-9a-fA-F]{6}$/.test(c)) {
      document.documentElement.style.setProperty('--primary', c);
      document.documentElement.style.setProperty('--primary-700', shadeColor(c, -34));
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); save(f, 'Branding aplikasi disimpan.'); }} className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Branding Aplikasi" subtitle="Nama & logo aplikasi pada header, login, dan portal">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama Aplikasi" required className="sm:col-span-2">
            <input className="input" value={f.app_nama || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, app_nama: e.target.value }))} />
          </Field>
          <Field label="Warna Primer" hint="Warna header, tombol utama, dan aksen">
            <div className="flex flex-wrap items-center gap-2">
              <input type="color" className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" value={f.primary_color || '#ea580c'} disabled={readOnly}
                onChange={e => preview(e.target.value)} />
              <input className="input !w-[120px]" value={f.primary_color || ''} disabled={readOnly} onChange={e => preview(e.target.value)} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {colors.map(c => (
                <button key={c} type="button" title={c} onClick={() => preview(c)} disabled={readOnly}
                  className={cx('h-6 w-6 rounded-full ring-2 ring-offset-1 transition', f.primary_color === c ? 'ring-slate-700' : 'ring-transparent')}
                  style={{ background: c }} />
              ))}
            </div>
          </Field>
          <Field label="Latar Belakang Gradien">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={String(f.gradient_bg) === '1'} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, gradient_bg: e.target.checked ? '1' : '0' }))} />
              <span className="text-[12.5px] font-medium text-slate-600">Aktifkan latar gradien lembut</span>
            </label>
          </Field>
          <div className="sm:col-span-2">
            <ImageInput label="Logo Aplikasi" value={f.app_logo} onChange={url => setF(v => ({ ...v, app_logo: url }))}
              hint="Tampil di header aplikasi & portal publik." disabled={readOnly} />
          </div>
          <Field label="Judul Portal Publik" className="sm:col-span-2">
            <input className="input" value={f.portal_judul || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, portal_judul: e.target.value }))} />
          </Field>
          <Field label="Subjudul Portal Publik" className="sm:col-span-2">
            <textarea className="input" value={f.portal_subtitle || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, portal_subtitle: e.target.value }))} />
          </Field>
          <Field label="Sakelar Portal Publik">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={String(f.portal_aktif) === '1'} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, portal_aktif: e.target.checked ? '1' : '0' }))} />
              <span className="text-[12.5px] font-medium text-slate-600">Izinkan siswa/orang tua cek poin tanpa login</span>
            </label>
          </Field>
          <div className="sm:col-span-2">
            <SlugPortal readOnly={readOnly} onSaved={() => ctx.reloadBoot()} />
          </div>
          <Field label="Template Pesan WhatsApp" className="sm:col-span-2"
            hint="Variabel: {nama} {kelas} {pel} {pres} {bersih} {status} {sekolah} {guru}">
            <textarea className="input min-h-[140px]" value={f.wa_template || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, wa_template: e.target.value }))} />
          </Field>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Pratinjau">
          <div className="overflow-hidden rounded-xl text-white" style={{ background: `linear-gradient(120deg, ${f.primary_color || '#ea580c'}, ${f.primary_color || '#ea580c'}dd, #f59e0b)` }}>
            <div className="flex items-center gap-2 p-3">
              {(f.app_logo || s.logo) ? <img src={f.app_logo || s.logo} alt="" className="h-9 w-9 rounded-lg bg-white/90 object-contain p-1" /> : <ShieldCheck size={20} />}
              <div>
                <p className="text-[12px] font-extrabold uppercase leading-tight">{f.app_nama || 'Nama Aplikasi'}</p>
                <p className="text-[10px] text-white/80">{s.sekolah_nama}</p>
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-3">
            <p className="text-[11.5px] font-semibold text-slate-500">Judul portal:</p>
            <p className="text-[14px] font-extrabold text-slate-800">{f.portal_judul || 'Cek Poin Kedisiplinan Siswa'}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-slate-500">{f.portal_subtitle || 'Masukkan nama lengkap dan tanggal lahir…'}</p>
          </div>
        </Card>
        {!readOnly ? <button className="btn-primary w-full" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Branding</button> : null}
      </div>
    </form>
  );
}

/* ---------------- Menu & UI ---------------- */
function MenuUI({ ctx, readOnly }) {
  const [nav, setNav] = useState(ctx.boot.settings.nav || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNav(ctx.boot.settings.nav || []), [ctx.boot.settings.nav]);

  function move(i, dir) {
    const next = [...nav];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setNav(next.map((n, k) => ({ ...n, order: k })));
  }
  async function simpan() {
    setBusy(true);
    try {
      const payload = {};
      nav.forEach((n, i) => { payload[n.key] = { label: n.label, hidden: n.hidden, order: i }; });
      await api('/api/settings/nav', { method: 'POST', body: { nav: payload } });
      ctx.toast.ok('Tampilan menu disimpan.');
      await ctx.reloadBoot();
    } catch (e) { ctx.toast.err(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Tampilan Menu & UI" subtitle="Ubah nama menu, atur urutan, dan sembunyikan menu yang tidak dipakai"
      right={!readOnly ? <button className="btn-primary btn-sm" onClick={simpan} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Menu</button> : null}>
      <div className="space-y-2">
        {nav.map((n, i) => (
          <div key={n.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-orange-50 text-[11px] font-bold text-orange-600">{i + 1}</span>
            <input className="input !w-[220px] !py-1.5 text-[12.5px]" value={n.label} disabled={readOnly}
              onChange={e => setNav(list => list.map((x, k) => k === i ? { ...x, label: e.target.value } : x))} />
            <span className="chip !text-[10.5px]">{n.key}</span>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">
              <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600" checked={!!n.hidden} disabled={readOnly}
                onChange={e => setNav(list => list.map((x, k) => k === i ? { ...x, hidden: e.target.checked } : x))} />
              {n.hidden ? <EyeOff size={13} /> : <Eye size={13} />} {n.hidden ? 'Disembunyikan' : 'Tampil'}
            </label>
            <div className="flex gap-1">
              <button className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40" onClick={() => move(i, -1)} disabled={readOnly || i === 0}><ArrowUp size={13} /></button>
              <button className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40" onClick={() => move(i, 1)} disabled={readOnly || i === nav.length - 1}><ArrowDown size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      <Alert tone="info" title="Catatan">
        Menu yang disembunyikan tetap dapat diakses lewat tautan langsung, namun izin akses tetap ditentukan oleh Matriks Hak Akses role.
      </Alert>
    </Card>
  );
}

/* ---------------- Form config ---------------- */
function FormConfig({ ctx, readOnly }) {
  const { busy, save } = useSave(ctx);
  const [f, setF] = useState({});
  useEffect(() => {
    const c = ctx.boot.settings.form_config || {};
    setF({
      tampilkan_judul: !!c.tampilkan_judul, wajib_keterangan: !!c.wajib_keterangan,
      tampilkan_bukti: !!c.tampilkan_bukti, auto_tanggal: !!c.auto_tanggal,
      judul_default: c.judul_default || '', placeholder_keterangan: c.placeholder_keterangan || ''
    });
  }, [ctx.boot.settings.form_config]);

  return (
    <form onSubmit={e => { e.preventDefault(); save({ form_config: f }, 'Konfigurasi form kejadian disimpan.'); }} className="grid gap-4 lg:grid-cols-2">
      <Card title="Komponen Form Input Kejadian" subtitle="Sesuaikan field yang tampil saat guru mencatat kejadian">
        {[
          ['tampilkan_judul', 'Tampilkan field Judul Kejadian', 'Bila dimatikan, judul otomatis memakai nama kategori.'],
          ['wajib_keterangan', 'Keterangan kronologi wajib diisi', 'Mencegah catatan tanpa penjelasan.'],
          ['tampilkan_bukti', 'Tampilkan unggah Bukti Foto', 'Foto dikompres otomatis sebelum diunggah.'],
          ['auto_tanggal', 'Tanggal otomatis hari ini', 'Petugas tetap dapat mengubah tanggal secara manual.']
        ].map(([k, t, d]) => (
          <label key={k} className="mb-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f[k]} disabled={readOnly}
              onChange={e => setF(v => ({ ...v, [k]: e.target.checked }))} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">{t}</span>
              <span className="block text-[11px] text-slate-500">{d}</span>
            </span>
          </label>
        ))}
      </Card>
      <div className="space-y-4">
        <Card title="Teks Bawaan Form">
          <div className="space-y-3">
            <Field label="Judul kejadian bawaan" hint="Dapat dikosongkan bila tidak memakai judul default">
              <input className="input" value={f.judul_default || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, judul_default: e.target.value }))} />
            </Field>
            <Field label="Petunjuk pengisian kronologi">
              <textarea className="input" value={f.placeholder_keterangan || ''} disabled={readOnly} onChange={e => setF(v => ({ ...v, placeholder_keterangan: e.target.value }))} />
            </Field>
          </div>
        </Card>
        {!readOnly ? <button className="btn-primary w-full" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Konfigurasi Form</button> : null}
      </div>
    </form>
  );
}


/* ---------------- WhatsApp Gateway & jeda pengiriman ---------------- */
function WAGateway({ ctx, readOnly }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState({
    aktif: false, url: '', token: '', payload: '{"target":"{phone}","message":"{message}"}',
    header: 'Authorization', prefix: '', cooldown_jam: 24, template: '', input_cooldown_jam: 0,
    kepsek_wa: '', wakasek_kur_wa: '', absensi_wa_aktif: 0, absensi_wa_jam: '14:00',
    provider: 'generik', alfa_aktif: 1, izin_aktif: 1, template_alfa: '', template_izin: '',
    jadwal_ingat_aktif: 0, jadwal_ingat_menit: 15, jadwal_telat_aktif: 0, jadwal_telat_menit: 15,
    jadwal_telat_atasan_aktif: 0, piket_wa: '',
    template_jadwal_ingat: '', template_jadwal_telat: '', template_jadwal_telat_atasan: ''
  });
  const [templateUtama, setTemplateUtama] = useState('');
  const [busy, setBusy] = useState(false);
  const [uji, setUji] = useState({ phone: '', pesan: '' });
  const [ujiBusy, setUjiBusy] = useState(false);
  const [cekBusy, setCekBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/wa/pengaturan').then(r => {
      setD(r);
      setF({
        aktif: !!r.config.aktif, url: r.config.url, token: '',
        payload: r.config.payload, header: r.config.header || 'Authorization',
        prefix: r.config.prefix || '', cooldown_jam: r.config.cooldown_jam,
        template: r.config.template || '', input_cooldown_jam: r.config.input_cooldown_jam || 0,
        kepsek_wa: r.config.kepsek_wa || '', wakasek_kur_wa: r.config.wakasek_kur_wa || '',
        absensi_wa_aktif: Number(r.config.absensi_wa_aktif) || 0, absensi_wa_jam: r.config.absensi_wa_jam || '14:00',
        provider: r.config.provider || 'generik',
        alfa_aktif: Number(r.config.alfa_aktif) || 0, izin_aktif: Number(r.config.izin_aktif) || 0,
        template_alfa: r.config.template_alfa || '', template_izin: r.config.template_izin || '',
        jadwal_ingat_aktif: Number(r.config.jadwal_ingat_aktif) || 0,
        jadwal_ingat_menit: Number(r.config.jadwal_ingat_menit) || 15,
        jadwal_telat_aktif: Number(r.config.jadwal_telat_aktif) || 0,
        jadwal_telat_menit: Number(r.config.jadwal_telat_menit) || 15,
        jadwal_telat_atasan_aktif: Number(r.config.jadwal_telat_atasan_aktif) || 0,
        piket_wa: r.config.piket_wa || '',
        template_jadwal_ingat: r.config.template_jadwal_ingat || '',
        template_jadwal_telat: r.config.template_jadwal_telat || '',
        template_jadwal_telat_atasan: r.config.template_jadwal_telat_atasan || ''
      });
      setTemplateUtama(ctx.boot.settings.wa_template || '');
    }).catch(e => toast.err(e.message));
  }, []);
  useEffect(load, []);

  async function simpan(e) {
    e && e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/wa/pengaturan', { method: 'POST', body: { ...f, template_utama: templateUtama } });
      toast.ok(r.pesan); load();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }
  async function cekPengingat() {
    setCekBusy(true);
    try {
      const r = await api('/api/wa/jadwal/cek', { method: 'POST', body: {} });
      toast.ok(r.pesan || 'Pemeriksaan selesai.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setCekBusy(false); }
  }
  async function kirimUji() {
    setUjiBusy(true);
    try {
      const r = await api('/api/wa/uji', { method: 'POST', body: uji });
      toast.ok(r.pesan || 'Pesan uji terkirim.');
    } catch (e) { toast.err(e.message); }
    finally { setUjiBusy(false); }
  }

  if (!d) return <Spinner label="Memuat pengaturan WhatsApp…" />;
  const set = patch => setF(v => ({ ...v, ...patch }));

  return (
    <form onSubmit={simpan} className="grid gap-4 lg:grid-cols-2" data-form="wa-gateway">
      <div className="space-y-4">
        <Card title="Koneksi WhatsApp Gateway" subtitle="Dipakai untuk mengirim peringatan otomatis ke orang tua">
          <label className="mb-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.aktif} disabled={readOnly}
              data-wa-aktif="1" onChange={e => set({ aktif: e.target.checked })} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">Aktifkan pengiriman lewat gateway</span>
              <span className="block text-[11px] text-slate-500">Bila dimatikan: pesan tidak dikirim server, aplikasi hanya membuka tautan wa.me.</span>
            </span>
          </label>
          <div className="space-y-3">
            <Field label="URL Endpoint Gateway" hint="Contoh Fonnte: https://api.fonnte.com/send · Wablas / Watzap / Baileys lokal juga dapat dipakai.">
              <input className="input" value={f.url} disabled={readOnly} placeholder="https://api.fonnte.com/send"
                data-wa-url="1" onChange={e => set({ url: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Nama Header Token" hint="Umumnya Authorization">
                <input className="input" value={f.header} disabled={readOnly} onChange={e => set({ header: e.target.value })} />
              </Field>
              <Field label="Awalan Token" hint="mis. Bearer (boleh kosong)">
                <input className="input" value={f.prefix} disabled={readOnly} onChange={e => set({ prefix: e.target.value })} />
              </Field>
            </div>
            <Field label="Token / API Key" hint={d.config.token_set ? 'Token sudah tersimpan — isi hanya bila ingin mengganti.' : 'Belum ada token tersimpan.'}>
              <div className="relative">
                <Lock size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input !pl-9" type="password" value={f.token} disabled={readOnly} autoComplete="new-password"
                  placeholder={d.config.token_set ? '•••••••• (tersimpan)' : 'tempel token di sini'}
                  data-wa-token="1" onChange={e => set({ token: e.target.value })} />
              </div>
            </Field>
            <Field label="Body Permintaan (JSON)" hint='Gunakan {phone} dan {message}. Contoh: {"target":"{phone}","message":"{message}"}'>
              <textarea className="input font-mono text-[11.5px]" value={f.payload} disabled={readOnly}
                onChange={e => set({ payload: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Jeda & Penguncian" subtitle="Mencegah pengiriman/pencatatan berulang">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jeda kirim ulang WhatsApp (jam)" hint="Default 24 jam = 1 hari. 0 = tanpa jeda.">
              <input type="number" min="0" max="720" className="input" value={f.cooldown_jam} disabled={readOnly}
                data-wa-cooldown="1" onChange={e => set({ cooldown_jam: e.target.value })} />
            </Field>
            <Field label="Jeda input kejadian siswa (jam)" hint="0 = nonaktif. Bila aktif, siswa yang baru dicatat terkunci sementara (anti double input).">
              <input type="number" min="0" max="720" className="input" value={f.input_cooldown_jam} disabled={readOnly}
                data-input-cooldown="1" onChange={e => set({ input_cooldown_jam: e.target.value })} />
            </Field>
          </div>
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
            Tombol kirim WhatsApp pada Data Siswa otomatis terkunci untuk siswa yang sudah dikirimi pesan dalam rentang jeda di atas.
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Notifikasi Otomatis (Fonnte)"
          subtitle="Pesan WhatsApp otomatis saat siswa Alfa/Bolos dan saat guru Sakit/Izin">
          <Field label="Penyedia Gateway" hint="Fonnte memakai form-urlencoded (target + message). Pilih Generik untuk gateway lain (JSON).">
            <select className="input" value={f.provider || 'generik'} disabled={readOnly}
              data-wa-provider="1" onChange={e => set({ provider: e.target.value })}>
              <option value="generik">Generik (JSON payload)</option>
              <option value="fonnte">Fonnte (api.fonnte.com/send)</option>
            </select>
          </Field>
          <p className="mt-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
            Fonnte: isi <b>URL</b> <code>https://api.fonnte.com/send</code>, header <b>Authorization</b>, lalu tempel <b>Device Token</b> pada kolom Token.
          </p>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.alfa_aktif} disabled={readOnly}
              data-wa-alfa-aktif="1" onChange={e => set({ alfa_aktif: e.target.checked ? 1 : 0 })} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">Kirim WhatsApp ke orang tua saat siswa <b>Alfa / Bolos</b></span>
              <span className="block text-[11px] text-slate-500">Dikirim otomatis begitu guru menyimpan presensi (sekali per siswa per sesi). Nomor diambil dari kolom “No. HP/WA Orang Tua” pada Data Siswa.</span>
            </span>
          </label>
          <Field label="Template Pesan Alfa/Bolos"
            hint="Variabel: {nama} {kelas} {status} {mapel} {jam} {tanggal} {keterangan} {sekolah} {guru}. Kosong = template bawaan.">
            <textarea className="input min-h-[120px] font-mono text-[11px]" value={f.template_alfa || ''} disabled={readOnly}
              placeholder={d.config.contoh_template_alfa || ''} data-wa-template-alfa="1"
              onChange={e => set({ template_alfa: e.target.value })} />
          </Field>

          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.izin_aktif} disabled={readOnly}
              data-wa-izin-aktif="1" onChange={e => set({ izin_aktif: e.target.checked ? 1 : 0 })} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">Beri tahu Kepala Sekolah / Wakasek Kurikulum saat guru <b>Sakit / Izin</b></span>
              <span className="block text-[11px] text-slate-500">Nomor tujuan memakai kolom di kartu “Nomor Penerima Rekap Absensi Guru” di samping.</span>
            </span>
          </label>
          <Field label="Template Pesan Guru Tidak Hadir"
            hint="Variabel: {guru} {status} {tanggal} {jam} {mapel} {kelas} {alasan} {sekolah}.">
            <textarea className="input min-h-[110px] font-mono text-[11px]" value={f.template_izin || ''} disabled={readOnly}
              placeholder={d.config.contoh_template_izin || ''} data-wa-template-izin="1"
              onChange={e => set({ template_izin: e.target.value })} />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="chip">Alfa terkirim: {d.config.alfa_terkirim ?? 0}</span>
            <span className="chip">Notifikasi izin: {d.config.izin_terkirim ?? 0}</span>
          </div>
        </Card>

        <Card title="Pengingat Jadwal & Peringatan Check-in"
          subtitle="Pesan otomatis ke guru sebelum jam pelajaran & saat belum check-in (aktif secara bawaan — matikan bila tidak diperlukan)">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.jadwal_ingat_aktif} disabled={readOnly}
              data-wa-jadwal-ingat="1" onChange={e => set({ jadwal_ingat_aktif: e.target.checked ? 1 : 0 })} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">Pengingat jadwal mengajar</span>
              <span className="block text-[11px] text-slate-500">
                Dikirim ke nomor WhatsApp guru beberapa menit sebelum jam pelajaran dimulai
                (nomor diambil dari data pengguna → No. HP).
              </span>
            </span>
          </label>
          <div className="mt-2 grid gap-2.5 sm:grid-cols-[150px_1fr] sm:items-end">
            <Field label="Kirim sebelum (menit)">
              <input type="number" min="1" max="180" className="input" value={f.jadwal_ingat_menit} disabled={readOnly}
                data-wa-jadwal-ingat-menit="1" onChange={e => set({ jadwal_ingat_menit: e.target.value })} />
            </Field>
            <Field label="Template Pengingat"
              hint="Variabel: {guru} {menit} {mapel} {kode} {kelas} {ruang} {jam} {sesi} {tanggal} {sekolah}. Kosong = bawaan.">
              <textarea className="input min-h-[96px] font-mono text-[11px]" value={f.template_jadwal_ingat || ''} disabled={readOnly}
                placeholder={d.config.contoh_template_jadwal_ingat || ''} data-wa-template-jadwal-ingat="1"
                onChange={e => set({ template_jadwal_ingat: e.target.value })} />
            </Field>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.jadwal_telat_aktif} disabled={readOnly}
              data-wa-jadwal-telat="1" onChange={e => set({ jadwal_telat_aktif: e.target.checked ? 1 : 0 })} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">Peringatan guru belum <b>check-in</b></span>
              <span className="block text-[11px] text-slate-500">
                Dikirim ke guru bersangkutan bila sampai batas menit setelah jam pelajaran dimulai belum ada check-in.
              </span>
            </span>
          </label>
          <div className="mt-2 grid gap-2.5 sm:grid-cols-[150px_1fr] sm:items-end">
            <Field label="Batas keterlambatan (menit)">
              <input type="number" min="1" max="180" className="input" value={f.jadwal_telat_menit} disabled={readOnly}
                data-wa-jadwal-telat-menit="1" onChange={e => set({ jadwal_telat_menit: e.target.value })} />
            </Field>
            <Field label="Template Peringatan ke Guru"
              hint="Variabel sama + {lewat} (menit berjalan). Kosong = bawaan.">
              <textarea className="input min-h-[96px] font-mono text-[11px]" value={f.template_jadwal_telat || ''} disabled={readOnly}
                placeholder={d.config.contoh_template_jadwal_telat || ''} data-wa-template-jadwal-telat="1"
                onChange={e => set({ template_jadwal_telat: e.target.value })} />
            </Field>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.jadwal_telat_atasan_aktif} disabled={readOnly}
              data-wa-jadwal-telat-atasan="1" onChange={e => set({ jadwal_telat_atasan_aktif: e.target.checked ? 1 : 0 })} />
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">Laporkan juga ke Kepala Sekolah / Wakasek Kurikulum / Guru Piket</span>
              <span className="block text-[11px] text-slate-500">
                Nomor tujuan memakai kolom di kartu “Nomor Penerima Rekap Absensi Guru” (termasuk No. WhatsApp Guru Piket).
              </span>
            </span>
          </label>
          <Field label="Template Laporan ke Manajemen"
            hint="Variabel: {guru} {mapel} {kelas} {ruang} {jam} {sesi} {lewat} {tanggal} {sekolah}.">
            <textarea className="input min-h-[96px] font-mono text-[11px]" value={f.template_jadwal_telat_atasan || ''} disabled={readOnly}
              placeholder={d.config.contoh_template_jadwal_telat_atasan || ''} data-wa-template-jadwal-atasan="1"
              onChange={e => set({ template_jadwal_telat_atasan: e.target.value })} />
          </Field>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-soft btn-sm" disabled={readOnly || cekBusy} onClick={cekPengingat} data-wa-jadwal-cek="1">
              {cekBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Cek Pengingat Sekarang
            </button>
            <span className="chip">Pengingat: {d.config.jadwal_ingat_terkirim ?? 0}</span>
            <span className="chip">Peringatan: {d.config.jadwal_telat_terkirim ?? 0}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Pemeriksaan berjalan otomatis tiap menit di server. Pesan tidak dikirim ulang untuk sesi &amp; tanggal yang sama.
            Tombol di atas hanya memeriksa kondisi saat ini (simpan pengaturan dulu agar nilai terbaru dipakai).
          </p>
        </Card>

        <Card title="Nomor Penerima Rekap Absensi Guru"
          subtitle="Rekap kehadiran guru mapel dikirim otomatis ke Kepala Sekolah & Wakasek Kurikulum">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="No. WhatsApp Kepala Sekolah" hint="Kosongkan bila tidak ingin dikirimi rekap.">
              <input className="input" value={f.kepsek_wa || ''} disabled={readOnly} placeholder="08xxxxxxxxxx"
                data-wa-kepsek="1" onChange={e => set({ kepsek_wa: e.target.value })} />
            </Field>
            <Field label="No. WhatsApp Wakasek Kurikulum" hint="Nomor ini juga dipakai pada Pengaturan Jadwal.">
              <input className="input" value={f.wakasek_kur_wa || ''} disabled={readOnly} placeholder="08xxxxxxxxxx"
                data-wa-wakasek="1" onChange={e => set({ wakasek_kur_wa: e.target.value })} />
            </Field>
            <Field label="No. WhatsApp Guru Piket" hint="Penerima laporan guru belum check-in (opsional).">
              <input className="input" value={f.piket_wa || ''} disabled={readOnly} placeholder="08xxxxxxxxxx"
                data-wa-piket="1" onChange={e => set({ piket_wa: e.target.value })} />
            </Field>
            <Field label="Jam kirim rekap harian (WIB)">
              <input type="time" className="input" value={f.absensi_wa_jam || '14:00'} disabled={readOnly}
                data-wa-jam-rekap="1" onChange={e => set({ absensi_wa_jam: e.target.value })} />
            </Field>
            <Field label="Kirim otomatis tiap hari">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={!!f.absensi_wa_aktif} disabled={readOnly}
                  data-wa-rekap-aktif="1" onChange={e => set({ absensi_wa_aktif: e.target.checked ? 1 : 0 })} />
                <span className="text-[12.5px] font-semibold text-slate-700">Aktifkan rekap harian</span>
              </label>
            </Field>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Pesan berisi rekap Hadir / Izin / Sakit / Alpha beserta daftar guru yang mengajar hari itu.
          </p>
        </Card>

        <Card title="Template Pesan Peringatan" subtitle="Variabel otomatis: {nama} {kelas} {pel} {pres} {bersih} {status} {sanksi} {sekolah} {guru}">
          <textarea className="input min-h-[220px] font-mono text-[11.5px]" value={templateUtama} disabled={readOnly}
            data-wa-template="1" onChange={e => setTemplateUtama(e.target.value)} />
          <p className="mt-1 text-[11px] text-slate-400">
            Template ini dipakai untuk pengiriman perorangan &amp; masal. Isi pesan akan disesuaikan per siswa.
          </p>
        </Card>

        {!readOnly ? (
          <button className="btn-primary w-full" disabled={busy} data-save="wa">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Pengaturan WhatsApp
          </button>
        ) : null}

        <Card title="Uji Koneksi Gateway" subtitle="Pastikan token & endpoint benar sebelum dipakai massal">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Nomor Tujuan"><input className="input" placeholder="0812xxxxxxx" value={uji.phone}
              onChange={e => setUji(v => ({ ...v, phone: e.target.value }))} /></Field>
            <Field label="Pesan Uji"><input className="input" placeholder="Uji koneksi WhatsApp Gateway" value={uji.pesan}
              onChange={e => setUji(v => ({ ...v, pesan: e.target.value }))} /></Field>
          </div>
          <button type="button" className="btn-soft mt-2 w-full" disabled={ujiBusy || readOnly || !f.aktif} onClick={kirimUji}>
            {ujiBusy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Kirim Pesan Uji
          </button>
          {!f.aktif ? <p className="mt-1 text-[11px] text-slate-400">Aktifkan gateway &amp; simpan dulu sebelum mengirim pesan uji.</p> : null}
        </Card>
      </div>
    </form>
  );
}

/* ---------------- Poin & deteksi dini ---------------- */
function PoinConfig({ ctx, readOnly }) {
  const { busy, save } = useSave(ctx);
  const [rules, setRules] = useState(ctx.boot.settings.status_rules || []);
  const [dini, setDini] = useState(ctx.boot.settings.dini || { hari: 14, siaga: 20, waspada: 40, aktif: 1 });
  useEffect(() => { setRules(ctx.boot.settings.status_rules || []); setDini(ctx.boot.settings.dini || {}); }, [ctx.boot.settings]);

  function setRule(i, k, v) {
    setRules(list => list.map((r, j) => j === i ? { ...r, [k]: v } : r));
  }
  async function simpan() {
    await save({
      status_rules: JSON.stringify(rules.map((r, i) => ({
        key: r.key || 'lvl' + i, label: r.label, min: Number(r.min) || 0,
        max: r.max === '' || r.max === null || r.max === undefined ? null : Number(r.max)
      }))),
      dini_config: { hari: Number(dini.hari) || 14, siaga: Number(dini.siaga) || 20, waspada: Number(dini.waspada) || 40, aktif: dini.aktif ? 1 : 0 }
    }, 'Ambang status & deteksi dini disimpan.');
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card title="Ambang Status Disiplin" subtitle="Urut dari poin terendah. Batas maksimum kosong = tak terbatas.">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Label Status</th><th className="w-24">Poin Min</th><th className="w-24">Poin Maks</th><th>Pratinjau</th></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i}>
                  <td><input className="input !py-1.5 text-[12.5px]" value={r.label} disabled={readOnly} onChange={e => setRule(i, 'label', e.target.value)} /></td>
                  <td><input type="number" className="input !py-1.5 text-center text-[12.5px]" value={r.min} disabled={readOnly} onChange={e => setRule(i, 'min', e.target.value)} /></td>
                  <td><input type="number" className="input !py-1.5 text-center text-[12.5px]" value={r.max ?? ''} disabled={readOnly} onChange={e => setRule(i, 'max', e.target.value)} /></td>
                  <td><span className="badge badge-netral">{r.label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Deteksi Dini" subtitle="Peringatan otomatis siswa berisiko">
          <div className="space-y-3">
            <Field label="Rentang hari pemantauan"><input type="number" min="1" max="90" className="input" value={dini.hari || 14} disabled={readOnly} onChange={e => setDini(v => ({ ...v, hari: e.target.value }))} /></Field>
            <Field label="Ambang SIAGA (poin)"><input type="number" min="1" className="input" value={dini.siaga || 20} disabled={readOnly} onChange={e => setDini(v => ({ ...v, siaga: e.target.value }))} /></Field>
            <Field label="Ambang WASPADA (poin)"><input type="number" min="2" className="input" value={dini.waspada || 40} disabled={readOnly} onChange={e => setDini(v => ({ ...v, waspada: e.target.value }))} /></Field>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={!!dini.aktif} disabled={readOnly} onChange={e => setDini(v => ({ ...v, aktif: e.target.checked ? 1 : 0 }))} />
              <span className="text-[12.5px] font-medium text-slate-600">Aktifkan deteksi dini</span>
            </label>
          </div>
        </Card>
        {!readOnly ? <button className="btn-primary w-full" onClick={simpan} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan</button> : null}
      </div>
    </div>
  );
}

/* ---------------- Lokasi & Sanksi ---------------- */
const SURAT_OPT = [
  { v: '', l: 'Tanpa surat otomatis' },
  { v: 'sp1', l: 'Surat Peringatan 1' },
  { v: 'sp2', l: 'Surat Peringatan 2' },
  { v: 'sp3', l: 'Surat Peringatan 3' },
  { v: 'panggilan', l: 'Surat Panggilan Orang Tua' }
];

function LokasiSanksi({ ctx, readOnly }) {
  const s = ctx.boot.settings;
  const { busy, save } = useSave(ctx);
  const [lokasi, setLokasi] = useState([]);
  const [baru, setBaru] = useState('');
  const [rules, setRules] = useState([]);
  const [jc, setJc] = useState({ wajib_lokasi: 0, auto_poin: 1, tampil_dashboard: 1 });

  useEffect(() => {
    setLokasi([...(s.lokasi || [])]);
    setRules((s.sanksi_rules || []).map(r => ({ ...r })));
    setJc({ wajib_lokasi: 0, auto_poin: 1, tampil_dashboard: 1, ...(s.jurnal_config || {}) });
  }, [s]);

  function tambahLokasi() {
    const v = baru.trim();
    if (!v) return;
    if (lokasi.some(x => x.toLowerCase() === v.toLowerCase())) return ctx.toast.err('Lokasi sudah ada pada daftar.');
    setLokasi(list => [...list, v]);
    setBaru('');
  }
  function setRule(i, k, v) {
    setRules(list => list.map((r, j) => j === i ? { ...r, [k]: v } : r));
  }
  function tambahRule() {
    const last = rules[rules.length - 1];
    setRules(list => [...list, {
      id: 's' + Date.now(), min: (last ? Number(last.min) : 0) + 25,
      label: 'Sanksi Baru', surat: '', catatan: ''
    }]);
  }

  async function simpan() {
    await save({
      lokasi_list: JSON.stringify(lokasi),
      sanksi_rules: JSON.stringify(rules),
      jurnal_config: jc
    }, 'Lokasi kejadian, aturan sanksi & pengaturan buku penghubung disimpan.');
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Daftar Lokasi Kejadian" subtitle="Pilihan lokasi pada form input kejadian & buku penghubung">
        <div className="mb-3 flex gap-2">
          <input className="input" placeholder="Nama lokasi baru, mis. Masjid / Lapangan" value={baru}
            disabled={readOnly} onChange={e => setBaru(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tambahLokasi(); } }} />
          <button type="button" className="btn-soft shrink-0" onClick={tambahLokasi} disabled={readOnly}><Plus size={14} /> Tambah</button>
        </div>
        <ul className="space-y-2">
          {lokasi.map((l, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-orange-50 text-[11px] font-bold text-orange-600">{i + 1}</span>
              <input className="input !py-1.5 text-[12.5px]" value={l} disabled={readOnly}
                onChange={e => setLokasi(list => list.map((x, k) => k === i ? e.target.value : x))} />
              <button type="button" className="btn-danger btn-sm shrink-0" disabled={readOnly}
                onClick={() => setLokasi(list => list.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
            </li>
          ))}
          {!lokasi.length ? <p className="text-[12px] text-slate-500">Belum ada lokasi. Tambahkan minimal satu.</p> : null}
        </ul>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
          Lokasi dipakai untuk analitik <b>tempat paling rawan</b> pada Dashboard & menu Analitik Pola.
        </p>
      </Card>

      <div className="space-y-4">
        <Card title="Aturan Sanksi Otomatis" subtitle="Rekomendasi sanksi muncul otomatis pada kartu siswa & laporan"
          right={!readOnly ? <button className="btn-soft btn-sm" onClick={tambahRule}><Plus size={13} /> Aturan</button> : null}>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={r.id || i} className="rounded-xl border border-slate-100 p-2.5">
                <div className="grid grid-cols-[88px_1fr_auto] items-center gap-2">
                  <div>
                    <label className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Min. Poin</label>
                    <input type="number" min="0" className="input !py-1.5 text-center text-[12.5px]" value={r.min}
                      disabled={readOnly} onChange={e => setRule(i, 'min', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Nama Sanksi</label>
                    <input className="input !py-1.5 text-[12.5px]" value={r.label} disabled={readOnly}
                      onChange={e => setRule(i, 'label', e.target.value)} />
                  </div>
                  <button type="button" className="btn-danger btn-sm mt-4" disabled={readOnly}
                    onClick={() => setRules(list => list.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select className="input !py-1.5 text-[12px]" value={r.surat || ''} disabled={readOnly}
                    onChange={e => setRule(i, 'surat', e.target.value)}>
                    {SURAT_OPT.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                  <input className="input !py-1.5 text-[12px]" placeholder="Catatan singkat" value={r.catatan || ''}
                    disabled={readOnly} onChange={e => setRule(i, 'catatan', e.target.value)} />
                </div>
              </div>
            ))}
            {!rules.length ? <p className="text-[12px] text-slate-500">Belum ada aturan sanksi.</p> : null}
          </div>
        </Card>

        <Card title="Buku Penghubung Digital" subtitle="Pengaturan modul pencatatan cepat guru piket / TU">
          <div className="space-y-2">
            {[
              ['auto_poin', 'Temuan langsung membuat transaksi poin', 'Jika dimatikan, jurnal hanya mencatat temuan tanpa mengubah poin siswa.'],
              ['wajib_lokasi', 'Lokasi wajib diisi saat mencatat temuan', 'Membantu kelengkapan analitik lokasi rawan.'],
              ['tampil_dashboard', 'Tampilkan ringkasan jurnal di dashboard', 'Menampilkan jumlah temuan hari ini.']
            ].map(([k, t, d]) => (
              <label key={k} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!jc[k]} disabled={readOnly}
                  onChange={e => setJc(v => ({ ...v, [k]: e.target.checked ? 1 : 0 }))} />
                <span>
                  <span className="block text-[12.5px] font-semibold text-slate-700">{t}</span>
                  <span className="block text-[11px] text-slate-500">{d}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        {!readOnly ? <button className="btn-primary w-full" onClick={simpan} disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Lokasi &amp; Sanksi
        </button> : null}
      </div>
    </div>
  );
}

/* ---------------- Tahun ajaran ---------------- */
function TahunAjaran({ ctx, readOnly }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [hapus, setHapus] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api('/api/tahun').then(r => setRows(r.rows)).catch(e => ctx.toast.err(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [refreshKeySafe(ctx)]);

  /* buka dialog hapus: ambil dulu jumlah data terkait dari server */
  async function mintaHapus(t) {
    if (t.aktif) { ctx.toast.err('Tahun pelajaran aktif tidak dapat dihapus. Aktifkan tahun pelajaran lain terlebih dahulu.'); return; }
    try {
      const r = await api('/api/tahun/' + t.id + '/dampak');
      setHapus({ row: t, dampak: r.dampak, total: r.total });
    } catch (e) { ctx.toast.err(e.message); }
  }

  return (
    <Card title="Tahun Pelajaran" subtitle="Satu tahun pelajaran penuh — dipakai sebagai filter data di seluruh aplikasi"
      right={!readOnly ? <button className="btn-primary btn-sm" onClick={() => setEdit({ aktif: 0 })} data-guide-target="setup-year-add"><Plus size={13} /> Tambah</button> : null}>
      {loading ? <Spinner /> : rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Tahun Pelajaran</th><th>Mulai</th><th>Selesai</th><th className="text-center">Status</th><th className="w-24">Aksi</th></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} data-ta-row={t.id}>
                  <td className="font-semibold text-slate-700">{t.nama}</td>
                  <td className="text-[12px]">{t.tanggal_mulai || '-'}</td>
                  <td className="text-[12px]">{t.tanggal_selesai || '-'}</td>
                  <td className="text-center">{t.aktif ? <span className="badge badge-aman">Aktif</span> : <span className="badge badge-netral">Arsip</span>}</td>
                  <td>
                    {!readOnly ? (
                      <div className="flex gap-0.5">
                        <button onClick={() => setEdit(t)} title="Ubah" data-ta-edit={t.id}
                          className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50"><Pencil size={14} /></button>
                        <button onClick={() => mintaHapus(t)} data-ta-hapus={t.id}
                          disabled={!!t.aktif}
                          title={t.aktif ? 'Tahun pelajaran aktif tidak dapat dihapus' : 'Hapus tahun pelajaran'}
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={14} /></button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={CalendarDays} title="Belum ada tahun pelajaran" />}
      <FormTahun open={!!edit} row={edit} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); load(); ctx.reloadBoot(); }} toast={ctx.toast} />
      <HapusTahun open={!!hapus} data={hapus} onClose={() => setHapus(null)}
        onDone={() => { setHapus(null); load(); ctx.reloadBoot(); }} toast={ctx.toast} />
    </Card>
  );
}
const refreshKeySafe = (ctx) => ctx.refreshKey;

const DAMPAK_LABEL = {
  siswa: 'Data siswa', kelas: 'Data kelas', kejadian: 'Riwayat pelanggaran & prestasi',
  jurnal: 'Catatan buku penghubung', tindak_lanjut: 'Catatan tindak lanjut',
  siswa_kelas: 'Riwayat penempatan kelas', feedback: 'Masukan & kendala', wa_log: 'Riwayat pesan WhatsApp'
};

function HapusTahun({ open, data, onClose, onDone, toast }) {
  const [paksa, setPaksa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setPaksa(false); setErr(''); } }, [open, data]);
  const nama = data?.row?.nama || '';
  const dampak = data?.dampak || {};
  const total = data?.total || 0;
  const baris = Object.keys(DAMPAK_LABEL).filter(k => Number(dampak[k] || 0) > 0);

  async function hapus() {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/tahun/delete', { method: 'POST', body: { id: data.row.id, paksa: total > 0 ? paksa : undefined } });
      toast.ok(r.pesan || 'Tahun pelajaran dihapus.');
      onDone?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Hapus Tahun Pelajaran"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn-danger" onClick={hapus} disabled={busy || (total > 0 && !paksa)} data-hapus-konfirmasi>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Hapus Permanen
        </button>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          Tahun pelajaran <b className="text-slate-800">{nama}</b> akan dihapus permanen dan tidak dapat dibatalkan.
        </p>
        {total > 0 ? (
          <>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[12px] font-bold text-amber-900">Data terkait yang ikut terhapus ({total} baris)</p>
              <ul className="mt-1 space-y-0.5">
                {baris.map(k => (
                  <li key={k} className="flex justify-between text-[12px] text-amber-900">
                    <span>{DAMPAK_LABEL[k]}</span><b>{dampak[k]}</b>
                  </li>
                ))}
              </ul>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-rose-600" checked={paksa}
                onChange={e => setPaksa(e.target.checked)} data-hapus-paksa />
              <span className="text-[12px] font-semibold text-rose-800">
                Saya mengerti — hapus juga seluruh data terkait tahun pelajaran ini.
              </span>
            </label>
          </>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600">
            Tidak ada data siswa/kejadian pada tahun pelajaran ini — aman untuk dihapus.
          </p>
        )}
        {err ? <p className="text-[12px] font-semibold text-rose-600">{err}</p> : null}
      </div>
    </Modal>
  );
}


function FormTahun({ open, row, onClose, onSaved, toast }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({
      id: row?.id || '', nama: row?.nama || '', tanggal_mulai: row?.tanggal_mulai || '',
      tanggal_selesai: row?.tanggal_selesai || '', aktif: !!row?.aktif, salin_periodik: false
    });
  }, [open, row]);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/tahun/save', { method: 'POST', body: f });
      const k = r.kenaikan;
      toast.ok('Tahun pelajaran disimpan.' + (k
        ? ` Salin periodik: ${k.naik} siswa naik tingkat, ${k.lulus} siswa lulus, ${k.kelasBaru} kelas dibuat.`
        : ''));
      onSaved?.();
    }
    catch (e2) { toast.err(e2.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={f.id ? 'Ubah Tahun Pelajaran' : 'Tambah Tahun Pelajaran'}
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button><button className="btn-primary" form="fTa" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan</button></>}>
      <form id="fTa" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Tahun Pelajaran" required className="sm:col-span-2" hint="Contoh: 2026/2027">
          <input className="input" value={f.nama || ''} required onChange={e => setF(v => ({ ...v, nama: e.target.value }))} />
        </Field>
        <Field label="Tanggal Mulai"><input type="date" className="input" value={f.tanggal_mulai || ''} onChange={e => setF(v => ({ ...v, tanggal_mulai: e.target.value }))} /></Field>
        <Field label="Tanggal Selesai"><input type="date" className="input" value={f.tanggal_selesai || ''} onChange={e => setF(v => ({ ...v, tanggal_selesai: e.target.value }))} /></Field>
        <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={!!f.aktif} onChange={e => setF(v => ({ ...v, aktif: e.target.checked }))} />
          <span className="text-[12.5px] font-medium text-slate-600">Jadikan tahun pelajaran aktif (default filter)</span>
        </label>
        {!f.id ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-orange-200 bg-orange-50/70 px-3 py-2.5 sm:col-span-2" data-salin-periodik>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.salin_periodik}
              onChange={e => setF(v => ({ ...v, salin_periodik: e.target.checked }))} />
            <span>
              <span className="block text-[12.5px] font-bold text-orange-900">Salin Periodik + Kenaikan Kelas Otomatis</span>
              <span className="block text-[11px] leading-relaxed text-orange-800">
                Kelas tahun lalu disalin ke tahun pelajaran baru dengan tingkat +1 (mis. X → XI, XI → XII).
                Siswa di tingkat terakhir otomatis berstatus <b>Lulus / Nonaktif</b>.
                Riwayat pelanggaran & prestasi tetap tersimpan.
              </span>
            </span>
          </label>
        ) : null}
      </form>
    </Modal>
  );
}

/* =========================================================
   KOP SURAT DINAMIS
   ========================================================= */
const KOP_POSISI = [['kiri', 'Logo di kiri'], ['tengah', 'Logo di tengah'], ['kanan', 'Logo di kanan']];
const KOP_RAPAT = [['kiri', 'Teks rata kiri'], ['tengah', 'Teks rata tengah'], ['kanan', 'Teks rata kanan']];
const KOP_GARIS = [['double', 'Garis ganda'], ['single', 'Garis tunggal'], ['none', 'Tanpa garis']];
/* pilihan ukuran font per baris kop (pt) — harus sama dengan batas validasi server 6–36 pt */
const KOP_SIZES = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13', '14', '15', '16', '17', '18', '20', '22', '24', '26', '28', '32', '36'];

function barisKop(s, f) {
  // teks contoh pada pratinjau: manual memakai isian, otomatis memakai identitas sekolah
  const manual = String(f.kop_baris || '').split('\n').map(x => x.trim()).filter(Boolean);
  /* Baris "SMK SWASTA NPSN …" sengaja TIDAK dibuat otomatis lagi; bila ingin
     ditampilkan, pengguna menuliskannya di Teks Bebas Tambahan. */
  const auto = [
    ...(String(s.sekolah_kepemilikan || '').trim() ? [[String(s.sekolah_kepemilikan).trim(), 'sub']] : []),
    [s.sekolah_nama || 'Nama Sekolah', 'nama'],
    [[s.sekolah_alamat, s.sekolah_telp ? 'Telp. ' + s.sekolah_telp : '', s.sekolah_website]
      .filter(Boolean).join(' • '), 'alamat']
  ];
  const tambahan = String(f.kop_baris_tambahan || '').split('\n').map(x => x.trim()).filter(Boolean);
  /* mode manual: tidak ada baris yang otomatis dibesarkan/ditebalkan —
     hasil cetak persis seperti yang diketik. */
  const base = String(f.kop_sumber) === 'manual'
    ? manual.map(t => [t, 'sub'])
    : auto;
  return base.concat(tambahan.map(t => [t, '']));
}

function KopSurat({ ctx, readOnly }) {
  const { boot } = ctx;
  const s = boot.settings || {};
  const { busy, save } = useSave(ctx);
  const [f, setF] = useState({});
  useEffect(() => setF({
    kop_sumber: s.kop_sumber || 'auto',
    kop_logo: s.kop_logo || '',
    kop_posisi: s.kop_posisi || 'kiri',
    kop_rapat: s.kop_rapat || 'tengah',
    kop_baris: s.kop_baris || '',
    kop_baris_tambahan: s.kop_baris_tambahan || '',
    kop_font: s.kop_font || '10.5',
    kop_font_besar: s.kop_font_besar || '16.5',
    kop_tinggi_logo: s.kop_tinggi_logo || '74',
    kop_logo_w: s.kop_logo_w || s.kop_tinggi_logo || '74',
    kop_logo_h: s.kop_logo_h || s.kop_tinggi_logo || '74',
    kop_garis: s.kop_garis || 'double',
    kop_format: s.kop_format || ''
  }), [s]);

  let fmt = [];
  try { fmt = JSON.parse(f.kop_format || '[]'); } catch (e) { fmt = []; }
  if (!Array.isArray(fmt)) fmt = [];
  /* PENTING: dulu fungsi ini memanggil setF('kop_format', …) sehingga seluruh state
     form tertimpa string dan semua input menjadi tidak responsif. Sekarang memakai
     updater fungsi agar nilai lain tetap utuh. */
  const setFmt = (i, key, val) => setF(prev => {
    let list = [];
    try { list = JSON.parse((prev && prev.kop_format) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    while (list.length <= i) list.push({ size: null, bold: false });
    list[i] = { ...(list[i] || {}), [key]: val };
    return { ...prev, kop_format: JSON.stringify(list) };
  });

  const baris = barisKop(s, f);
  const logoUrl = f.kop_logo || s.logo || s.app_logo || '';
  const pxOf = (v, def) => {
    const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.max(16, Math.min(400, Math.round(n))) : def;
  };
  const logoH = pxOf(f.kop_logo_h, pxOf(f.kop_tinggi_logo, 74));
  const logoW = pxOf(f.kop_logo_w, pxOf(f.kop_tinggi_logo, 74));
  const justify = f.kop_rapat === 'kiri' ? 'flex-start' : f.kop_rapat === 'kanan' ? 'flex-end' : 'center';
  const textAlign = f.kop_rapat === 'kanan' ? 'right' : f.kop_rapat === 'kiri' ? 'left' : 'center';
  const border = f.kop_garis === 'none' ? 'none' : f.kop_garis === 'single' ? '1px solid #111' : '3px double #111';

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card title="Pengaturan Kop Surat" subtitle="Berlaku pada seluruh dokumen cetak (surat, rekap, laporan poin)">
        <div className="space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Sumber Data Kop" hint="Otomatis mengambil identitas sekolah; manual menulis sendiri.">
              <select className="input" value={f.kop_sumber} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, kop_sumber: e.target.value }))}>
                <option value="auto">Otomatis — dari Identitas Sekolah</option>
                <option value="manual">Manual — teks bebas</option>
              </select>
            </Field>
            <Field label="Gaya Garis Bawah Kop">
              <select className="input" value={f.kop_garis} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, kop_garis: e.target.value }))}>
                {KOP_GARIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Posisi Logo">
              <select className="input" value={f.kop_posisi} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, kop_posisi: e.target.value }))}>
                {KOP_POSISI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Perataan Teks Kop">
              <select className="input" value={f.kop_rapat} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, kop_rapat: e.target.value }))}>
                {KOP_RAPAT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
          <ImageInput label="Logo Kop Surat (boleh berbeda dari logo aplikasi)" value={f.kop_logo}
            disabled={readOnly} onChange={url => setF(v => ({ ...v, kop_logo: url }))}
            hint="Kosongkan untuk memakai logo utama sekolah." />
          {f.kop_logo ? (
            <button type="button" className="btn-ghost btn-sm" disabled={readOnly}
              onClick={() => setF(v => ({ ...v, kop_logo: '' }))}>Pakai logo utama</button>
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Font teks (pt)">
              <input className="input" value={f.kop_font} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, kop_font: e.target.value }))} />
            </Field>
            <Field label="Font nama sekolah (pt)">
              <input className="input" value={f.kop_font_besar} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, kop_font_besar: e.target.value }))} />
            </Field>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="mb-2 text-[12px] font-bold text-slate-700">Ukuran Logo Kop</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Lebar logo (px)" hint="16–400 px. Untuk logo lambang + tulisan, lebarkan (mis. 150–220).">
                <input className="input" inputMode="numeric" value={f.kop_logo_w} disabled={readOnly}
                  data-kop-logow="1"
                  onChange={e => setF(v => ({ ...v, kop_logo_w: e.target.value }))} />
              </Field>
              <Field label="Tinggi logo (px)" hint="16–400 px. Samakan dengan lebar bila logo persegi.">
                <input className="input" inputMode="numeric" value={f.kop_logo_h} disabled={readOnly}
                  data-kop-logoh="1"
                  onChange={e => setF(v => ({ ...v, kop_logo_h: e.target.value }))} />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[['Kecil', 56, 56], ['Sedang', 74, 74], ['Besar', 100, 100], ['Lebar (lambang + teks)', 200, 80]].map(([lbl, w, h]) => (
                <button key={lbl} type="button" className="btn-ghost btn-sm" disabled={readOnly}
                  onClick={() => setF(v => ({ ...v, kop_logo_w: String(w), kop_logo_h: String(h), kop_tinggi_logo: String(h) }))}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <Field label="Teks Kop Manual (satu baris = satu baris kop)"
            hint="Hanya dipakai bila Sumber Data Kop = Manual. Mengetik di sini otomatis memindahkan sumber ke Manual. Teks dicetak PERSIS seperti yang Anda ketik (huruf besar/kecil tidak diubah) — atur ukuran & tebal tiap baris di tabel bawah.">
            <textarea className="input min-h-[110px] font-mono text-[12px]" value={f.kop_baris} disabled={readOnly}
              data-kop-manual="1"
              placeholder={'YAYASAN PENDIDIKAN\nSMK — SWASTA\nNAMA SEKOLAH\nAlamat • Telp. • Website'}
              onFocus={() => {
                /* saat masih "otomatis", isi dulu dengan baris kop yang sedang tampil agar
                   pengguna tinggal mengeditnya (tidak ada teks kop yang hilang); baris nama
                   sekolah ikut ditandai tebal supaya tampilannya tetap sama. */
                if (f.kop_sumber !== 'manual') {
                  setF(v => {
                    if (v.kop_baris) return v;
                    const list = baris.map(b => b[0]);
                    let cur = [];
                    try { cur = JSON.parse(v.kop_format || '[]'); } catch (e) { cur = []; }
                    const styled = Array.isArray(cur) ? cur.slice() : [];
                    if (!styled.some(x => x && (x.bold || x.size))) {
                      baris.forEach((b, i) => {
                        if (b[1] === 'nama') {
                          while (styled.length <= i) styled.push({});
                          styled[i] = { ...(styled[i] || {}), bold: true };
                        }
                      });
                    }
                    return { ...v, kop_baris: list.join('\n'), kop_format: styled.length ? JSON.stringify(styled) : v.kop_format };
                  });
                }
              }}
              onChange={e => {
                const val = e.target.value;
                setF(v => ({ ...v, kop_baris: val, kop_sumber: v.kop_sumber === 'auto' && val ? 'manual' : v.kop_sumber }));
              }} />
          </Field>
          <Field label="Teks Bebas Tambahan (selalu ditampilkan)"
            hint="Contoh: baris akreditasi, motto, atau keterangan lain yang dulu muncul otomatis (mis. “SMK SWASTA — NPSN …”). Satu baris = satu baris tambahan.">
            <textarea className="input min-h-[64px] font-mono text-[12px]" value={f.kop_baris_tambahan} disabled={readOnly}
              data-kop-extra="1"
              placeholder={'AKREDITASI: A — NPSN 12345678\nSEKOLAH SWASTA — NPSN 12345678'}
              onChange={e => setF(v => ({ ...v, kop_baris_tambahan: e.target.value }))} />
          </Field>

          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-bold text-slate-700">Ukuran Font &amp; Tebal per Baris</p>
              <button type="button" className="btn-ghost btn-sm" disabled={readOnly || !fmt.length}
                onClick={() => setF(v => ({ ...v, kop_format: '' }))}>Reset ke otomatis</button>
            </div>
            <div className="space-y-1.5">
              {baris.map(([teks, jenis], i) => {
                const o = fmt[i] || {};
                const isNama = jenis === 'nama';
                const autoSize = isNama ? (Number(f.kop_font_besar) || 16.5) : (Number(f.kop_font) || 10.5);
                const cur = o.size ? String(o.size) : '';
                const opts = cur && !KOP_SIZES.includes(cur) ? [...KOP_SIZES, cur].sort((a, b) => Number(a) - Number(b)) : KOP_SIZES;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500">
                      Baris {i + 1}: {teks || '—'}
                    </span>
                    <select className="input !w-[124px] !py-1 text-[12px]" value={cur} disabled={readOnly}
                      data-kop-size={i}
                      title={`Ukuran font baris ${i + 1} (otomatis = ${autoSize} pt)`}
                      onChange={e => setFmt(i, 'size', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Otomatis ({autoSize} pt)</option>
                      {opts.map(sz => <option key={sz} value={sz}>{sz} pt</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-600"
                      title={isNama ? 'Nama sekolah selalu dicetak tebal' : undefined}>
                      <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600" checked={!!o.bold || isNama}
                        disabled={readOnly || isNama} onChange={e => setFmt(i, 'bold', e.target.checked)} /> Tebal
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Perubahan ukuran langsung terlihat pada pratinjau di samping dan ikut tersimpan ke seluruh hasil cetak.
            </p>
          </div>

          <button className="btn-primary w-full py-2.5" disabled={readOnly || busy} onClick={() => save(f, 'Pengaturan kop surat disimpan.')}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Simpan Kop Surat
          </button>
        </div>
      </Card>

      <Card title="Pratinjau Kop" subtitle="Tampilan pada dokumen cetak">
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200" data-kop-preview="1">
          <div style={{ overflow: 'hidden', display: 'flex', flexDirection: f.kop_posisi === 'tengah' ? 'column' : (f.kop_posisi === 'kanan' ? 'row-reverse' : 'row'), alignItems: 'center', gap: 14, justifyContent: justify, borderBottom: border, paddingBottom: 8 }}>
            {logoUrl ? <img src={logoUrl} alt="Logo" data-kop-logo="1" style={{ width: logoW, height: logoH, objectFit: 'contain', maxWidth: '100%', flex: 'none' }} /> : (
              <div data-kop-logo="1" style={{ width: logoW, height: logoH, borderRadius: 12, border: '2px solid #f97316', display: 'grid', placeItems: 'center', color: '#ea580c', fontWeight: 800, flex: 'none', maxWidth: '100%' }}>
                {(s.sekolah_nama || 'S').charAt(0)}
              </div>
            )}
            <div style={{ flex: 1, textAlign, minWidth: 0 }}>
              {baris.length ? baris.map(([teks, jenis], i) => {
                const o = fmt[i] || {};
                const isNama = jenis === 'nama';
                const size = Number(o.size) || (isNama ? Number(f.kop_font_besar) || 16.5 : Number(f.kop_font) || 10.5);
                return (
                  <div key={i} data-kop-line={i} style={{
                    fontSize: size + 'pt', fontWeight: (o.bold || isNama) ? 700 : 400,
                    /* teks dirender apa adanya — sama dengan hasil cetak */
                    whiteSpace: 'pre-wrap',
                    lineHeight: isNama ? 1.15 : 1.3, margin: isNama ? '1px 0' : 0, color: '#111'
                  }}>{teks || '—'}</div>
                );
              }) : <p className="text-[12px] text-slate-400">Belum ada baris kop — isi teks kop manual atau identitas sekolah.</p>}
            </div>
          </div>
          <p className="mt-3 text-center text-[10.5px] text-slate-400">Pratinjau kop surat — skala warna dokumen cetak</p>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
          Kop ini dipakai otomatis pada <b>surat panggilan &amp; SP</b>, <b>rekapitulasi poin</b>, serta seluruh cetakan laporan.
        </p>
      </Card>
    </div>
  );
}

/* =========================================================
   UNGGAHAN & PENYIMPANAN
   ========================================================= */
function Unggahan({ ctx, readOnly }) {
  const { boot } = ctx;
  const s = boot.settings || {};
  const { busy, save } = useSave(ctx);
  const [st, setSt] = useState(null);
  const [f, setF] = useState({});
  useEffect(() => { api('/api/storage').then(r => setSt(r.storage)).catch(() => {}); }, []);
  useEffect(() => setF({
    upload_max_kb: s.upload_max_kb || '2048',
    upload_jpeg_quality: s.upload_jpeg_quality || '0.82',
    upload_max_side: s.upload_max_side || '1600',
    storage_quota_mb: s.storage_quota_mb || '1024',
    session_days: s.session_days || '90'
  }), [s]);

  const mb = v => ((Number(v) || 0) / (1024 * 1024)).toFixed(1).replace('.', ',');
  const pct = st ? Math.max(0, Math.min(100, Math.round(Number(st.used_bytes) / Math.max(1, Number(st.quota_bytes)) * 100))) : 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Card title="Batas Unggah & Kompresi Foto" subtitle="Berlaku untuk semua unggahan bukti, logo, dan foto profil">
        <div className="space-y-3">
          <Alert tone="info" title="Kompresi otomatis">
            Setiap foto dikompres di perangkat pengguna sebelum dikirim (dikonversi ke WebP dan diperkecil), sehingga
            penyimpanan tetap ringan namun gambar tetap jelas.
          </Alert>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Batas ukuran per foto (KB)" hint="Default 2048 KB = 2 MB.">
              <input className="input" inputMode="numeric" value={f.upload_max_kb} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, upload_max_kb: e.target.value }))} />
            </Field>
            <Field label="Kualitas kompresi" hint="0,4 – 0,95 (semakin kecil semakin ringan).">
              <input className="input" value={f.upload_jpeg_quality} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, upload_jpeg_quality: e.target.value }))} />
            </Field>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Sisi terpanjang gambar (px)" hint="1600 px cukup jelas untuk bukti foto.">
              <input className="input" inputMode="numeric" value={f.upload_max_side} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, upload_max_side: e.target.value }))} />
            </Field>
            <Field label="Kuota penyimpanan aplikasi (MB)" hint="Dipakai untuk indikator di dashboard.">
              <input className="input" inputMode="numeric" value={f.storage_quota_mb} disabled={readOnly}
                onChange={e => setF(v => ({ ...v, storage_quota_mb: e.target.value }))} />
            </Field>
          </div>
          <Field label="Masa berlaku sesi login (hari)" hint="Sesi diperpanjang otomatis setiap aktivitas — pengguna tidak mudah keluar sendiri.">
            <input className="input" inputMode="numeric" value={f.session_days} disabled={readOnly}
              onChange={e => setF(v => ({ ...v, session_days: e.target.value }))} />
          </Field>
          <button className="btn-primary w-full py-2.5" disabled={readOnly || busy} onClick={() => save(f, 'Pengaturan unggahan disimpan.')}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Simpan Pengaturan
          </button>
        </div>
      </Card>
      <Card title="Pemakaian Penyimpanan" subtitle="Data aplikasi (berkas + database)">
        {st ? (
          <div className="space-y-2">
            <p className="text-[22px] font-extrabold text-slate-800">{mb(st.used_bytes)} MB</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: pct + '%' }} />
            </div>
            <p className="text-[11.5px] text-slate-500">{pct}% dari kuota {st.quota_mb} MB · sisa {mb(st.sisa_bytes)} MB</p>
            <div className="mt-3 space-y-1.5 text-[12px] text-slate-600">
              <p className="flex justify-between"><span>Berkas foto terunggah</span><b>{st.file_count} · {mb(st.files_bytes)} MB</b></p>
              <p className="flex justify-between"><span>Database aplikasi</span><b>{mb(st.db_bytes)} MB</b></p>
            </div>
            {ctx.can('berkas', 'view') ? (
              <button className="btn-ghost btn-sm mt-2 w-full" onClick={() => ctx.setPage('berkas')}>Buka Kelola File</button>
            ) : null}
          </div>
        ) : <Spinner label="Menghitung pemakaian…" />}
      </Card>
    </div>
  );
}
