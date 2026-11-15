import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Bell, FileText, GripVertical, Image as ImageIcon, Layers, Loader2, Plus,
  Save, Sparkles, Trash2, Wrench
} from 'lucide-react';
import { api, tgl, waktu, angka } from '../../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../../ui';
import { Badge, UploadGambar, salin } from './ui-saas';
import { applyBrandingHead } from '../../branding';

/* =====================================================================
   6. DEFAULT MENU UNTUK SEKOLAH BARU (drag & drop)
   ===================================================================== */
export function SuperMenu({ ctx }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({});
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null);

  const load = useCallback(async () => {
    const r = await api('/api/super/menu-default');
    setRows(r.rows);
    setMeta({ fitur_all: r.fitur_all, nav_bawaan: r.nav_bawaan });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!rows) return <Spinner label="Memuat menu default…" />;

  const pindah = (from, to) => {
    if (from === to || to < 0 || to >= rows.length) return;
    setRows(list => {
      const next = list.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((n, i) => ({ ...n, urutan: i + 1 }));
    });
  };
  const ubah = (i, patch) => setRows(list => list.map((n, j) => j === i ? { ...n, ...patch } : n));

  async function simpan(terapkan) {
    setBusy(true);
    try {
      const r = await api('/api/super/menu-default', { method: 'POST', body: { rows, terapkan } });
      toast.ok(r.pesan);
      setRows(r.rows); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Default Menu Sekolah Baru</h2>
        <p className="text-[12.5px] text-slate-500">Susunan menu bawaan untuk setiap sekolah yang mendaftar — geser untuk mengubah urutan, klik nama untuk mengganti label.</p>
      </div>

      <Card title="Susunan Menu" subtitle="Seret ikon ⋮⋮ atau gunakan tombol panah" right={
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setRows([...meta.nav_bawaan].map((n, i) => ({ key: n.key, label: n.label, icon: n.icon, hidden: 0, urutan: i + 1 })))}>
            <Layers size={13} /> Muat Bawaan
          </button>
          <button className="btn-primary btn-sm" disabled={busy} onClick={() => simpan(false)}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan
          </button>
          <button className="btn-soft btn-sm" disabled={busy} onClick={() => {
            if (confirm('Terapkan susunan menu ini ke SEMUA sekolah yang sudah terdaftar?')) simpan(true);
          }}><Sparkles size={13} /> Simpan & Terapkan ke Semua</button>
        </div>
      }>
        <div className="space-y-1.5">
          {rows.map((n, i) => (
            <div key={n.key + i}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { pindah(drag, i); setDrag(null); }}
              className={cx('flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-2 transition',
                drag === i && 'opacity-50 ring-2 ring-orange-300')}>
              <span className="cursor-grab text-slate-300"><GripVertical size={15} /></span>
              <span className="w-6 text-center text-[11.5px] font-bold text-slate-400">{i + 1}</span>
              <input className="input !w-auto min-w-[160px] flex-1 !py-1 text-[12.5px]" value={n.label}
                onChange={e => ubah(i, { label: e.target.value })} placeholder="Nama menu" />
              <code className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500 sm:block">{n.key}</code>
              <label className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-600">
                <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600" checked={!n.hidden}
                  onChange={e => ubah(i, { hidden: e.target.checked ? 0 : 1 })} /> Tampil
              </label>
              <div className="flex gap-1">
                <button className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" onClick={() => pindah(i, i - 1)}><ArrowUp size={13} /></button>
                <button className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" onClick={() => pindah(i, i + 1)}><ArrowDown size={13} /></button>
              </div>
            </div>
          ))}
        </div>
        <Alert tone="info" title="Menu akun & layanan">
          Menu <b>Info &amp; Layanan</b>, <b>Pusat Bantuan</b>, <b>Petunjuk Pengguna</b>, dan <b>Legal &amp; SLA</b> selalu
          dibuka untuk semua sekolah agar mereka dapat memperpanjang layanan & menghubungi dukungan.
        </Alert>
      </Card>
    </div>
  );
}

/* =====================================================================
   7. BRANDING SISTEM (identitas global + tampilan halaman login + anti-spam)
   ===================================================================== */
export function SuperBranding({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api('/api/super/branding');
    setData(r);
    setF({
      app_nama: r.s.app_nama || '', app_subtitle: r.s.app_subtitle || '', logo: r.s.logo || '',
      favicon: r.s.favicon || '', trial_hari: r.s.trial_hari || '7', paket_default: r.s.paket_default || 'basic',
      domain_info: r.s.domain_info || '', subdomain_info: r.s.subdomain_info || '', server_info: r.s.server_info || '',
      /* baca dari platform (branding sudah menormalkan boolean) */
      pendaftaran_aktif: !!(r.platform && r.platform.pendaftaran_aktif),
      /* tampilan halaman login (global — bukan data sekolah) */
      login_judul: r.s.login_judul || '', login_subjudul: r.s.login_subjudul || '',
      login_deskripsi: r.s.login_deskripsi || '', login_footer: r.s.login_footer || '',
      login_copyright: r.s.login_copyright || '', login_logo: r.s.login_logo || '',
      /* proteksi anti-spam pendaftaran */
      recaptcha_site: r.s.recaptcha_site || '', recaptcha_secret: r.s.recaptcha_secret || '',
      daftar_min_detik: r.s.daftar_min_detik || '4', daftar_limit_jam: r.s.daftar_limit_jam || '5',
      daftar_limit_hari: r.s.daftar_limit_hari || '20',
      daftar_otp_aktif: !r.platform || r.platform.daftar_otp_aktif !== false
    });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!data) return <Spinner label="Memuat branding…" />;

  async function simpan() {
    setBusy(true);
    try {
      const r = await api('/api/super/branding', { method: 'POST', body: f });
      toast.ok(r.pesan);
      /* langsung terapkan judul tab & favicon baru di perangkat ini */
      applyBrandingHead(r.platform || {});
      await load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  const previewNama = f.login_judul || f.app_nama || 'Nama Aplikasi';
  const previewSub = f.login_subjudul || f.app_subtitle || 'Subjudul aplikasi';
  const previewLogo = f.login_logo || f.logo || '';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Branding Sistem</h2>
        <p className="text-[12.5px] text-slate-500">
          Identitas GLOBAL platform. Nama aplikasi, subjudul, logo, favicon, serta seluruh teks halaman login
          (judul, subjudul, footer, hak cipta) diatur di sini dan dipakai di semua perangkat — tidak pernah mengambil
          data sekolah/tenant tertentu.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card title="Identitas Aplikasi" subtitle="Dipakai pada judul tab, header panel, dan halaman login">
            <div className="space-y-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Nama Aplikasi Default (Global)"><input className="input" value={f.app_nama} onChange={e => setF(v => ({ ...v, app_nama: e.target.value }))} /></Field>
                <Field label="Subjudul Aplikasi"><input className="input" value={f.app_subtitle} onChange={e => setF(v => ({ ...v, app_subtitle: e.target.value }))} /></Field>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <UploadGambar label="Logo Default Sistem" value={f.logo} onChange={u => setF(v => ({ ...v, logo: u }))} hint="Dipakai sekolah baru & sebagai logo platform." />
                <UploadGambar label="Logo Halaman Login" value={f.login_logo} onChange={u => setF(v => ({ ...v, login_logo: u }))} hint="Kosong = memakai logo default di atas." />
                <UploadGambar label="Favicon" value={f.favicon} onChange={u => setF(v => ({ ...v, favicon: u }))} hint="Ikon tab browser (PNG/SVG). Langsung tersebar setelah disimpan." />
              </div>
            </div>
          </Card>

          <Card title="Tampilan Halaman Login Utama" subtitle="Teks murni milik platform — kosongkan untuk memakai nilai bawaan">
            <div className="space-y-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Judul Utama" hint={f.app_nama ? `Bawaan: ${f.app_nama}` : ''}>
                  <input className="input" value={f.login_judul} onChange={e => setF(v => ({ ...v, login_judul: e.target.value }))} placeholder="(ikut nama aplikasi)" />
                </Field>
                <Field label="Subjudul" hint={f.app_subtitle ? `Bawaan: ${f.app_subtitle}` : ''}>
                  <input className="input" value={f.login_subjudul} onChange={e => setF(v => ({ ...v, login_subjudul: e.target.value }))} placeholder="(ikut subjudul aplikasi)" />
                </Field>
              </div>
              <Field label="Deskripsi Singkat (panel kiri)">
                <textarea className="input min-h-[76px]" value={f.login_deskripsi} onChange={e => setF(v => ({ ...v, login_deskripsi: e.target.value }))} />
              </Field>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Teks Kiri Bawah (footer panel)" hint="Contoh: alamat domain platform">
                  <input className="input" value={f.login_footer} onChange={e => setF(v => ({ ...v, login_footer: e.target.value }))} placeholder={f.domain_info || 'platform.example.id'} />
                </Field>
                <Field label="Hak Cipta (bawah form login)" hint={`Bawaan: © ${new Date().getFullYear()} ${f.app_nama || 'Nama Aplikasi'}`}>
                  <input className="input" value={f.login_copyright} onChange={e => setF(v => ({ ...v, login_copyright: e.target.value }))} placeholder="(bawaan)" />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Pendaftaran & Proteksi Anti-Spam" subtitle="Tombol “Daftarkan Sekolah” pada halaman login">
            <div className="space-y-3">
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Field label="Masa Uji Coba (hari)"><input className="input" inputMode="numeric" value={f.trial_hari} onChange={e => setF(v => ({ ...v, trial_hari: e.target.value }))} /></Field>
                <Field label="Paket Default Pendaftaran">
                  <select className="input" value={f.paket_default} onChange={e => setF(v => ({ ...v, paket_default: e.target.value }))}>
                    {data.paket.map(p => <option key={p.kode} value={p.kode}>{p.nama}</option>)}
                  </select>
                </Field>
                <Field label="Pendaftaran Mandiri">
                  <select className="input" value={f.pendaftaran_aktif ? '1' : '0'} onChange={e => setF(v => ({ ...v, pendaftaran_aktif: e.target.value === '1' }))}>
                    <option value="1">Dibuka (tombol Daftar tampil)</option>
                    <option value="0">Ditutup</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <Field label="Batas / IP / Jam" hint="1–100"><input className="input" inputMode="numeric" value={f.daftar_limit_jam} onChange={e => setF(v => ({ ...v, daftar_limit_jam: e.target.value }))} /></Field>
                <Field label="Batas / IP / Hari" hint="1–500"><input className="input" inputMode="numeric" value={f.daftar_limit_hari} onChange={e => setF(v => ({ ...v, daftar_limit_hari: e.target.value }))} /></Field>
                <Field label="Waktu Isi Minimal (detik)" hint="Form lebih cepat dari ini ditolak"><input className="input" inputMode="numeric" value={f.daftar_min_detik} onChange={e => setF(v => ({ ...v, daftar_min_detik: e.target.value }))} /></Field>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3" data-daftar-otp-toggle>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600"
                  checked={!!f.daftar_otp_aktif}
                  onChange={e => setF(v => ({ ...v, daftar_otp_aktif: e.target.checked }))} />
                <span>
                  <span className="block text-[12.5px] font-semibold text-slate-700">Wajibkan kode OTP WhatsApp saat pendaftaran</span>
                  <span className="block text-[11px] leading-relaxed text-slate-500">
                    Matikan bila gateway bermasalah. Pembatasan pendaftaran, honeypot, dan reCAPTCHA (jika aktif) tetap berlaku. Form yang sudah terbuka perlu dimuat ulang.
                  </span>
                </span>
              </label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="reCAPTCHA Site Key" hint="Kosong = reCAPTCHA nonaktif (honeypot & rate limit tetap aktif)">
                  <input className="input font-mono text-[11.5px]" value={f.recaptcha_site} onChange={e => setF(v => ({ ...v, recaptcha_site: e.target.value }))} />
                </Field>
                <Field label="reCAPTCHA Secret Key" hint="Hanya disimpan di server, tidak pernah ditampilkan ke pengunjung">
                  <input className="input font-mono text-[11.5px]" type="password" value={f.recaptcha_secret} onChange={e => setF(v => ({ ...v, recaptcha_secret: e.target.value }))} />
                </Field>
              </div>
              <Alert tone="info" title="Perlindungan berlapis">
                Form pendaftaran dilindungi <b>honeypot</b> (kolom jebakan), <b>batas waktu pengisian</b>,
                <b> pembatasan laju per IP</b>, dan <b>reCAPTCHA</b> bila kunci diisi.
              </Alert>
            </div>
          </Card>

          <Card title="Informasi Platform" subtitle="Tidak tampil di halaman login sekolah">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Field label="Domain Platform" hint="Tujuan CNAME domain custom"><input className="input" value={f.domain_info} onChange={e => setF(v => ({ ...v, domain_info: e.target.value }))} /></Field>
              <Field label="Subdomain Sekolah"><input className="input" value={f.subdomain_info} onChange={e => setF(v => ({ ...v, subdomain_info: e.target.value }))} /></Field>
              <Field label="Server / Infrastruktur"><input className="input" value={f.server_info} onChange={e => setF(v => ({ ...v, server_info: e.target.value }))} /></Field>
            </div>
          </Card>

          <button className="btn-primary w-full py-2.5" disabled={busy} onClick={simpan}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Simpan Branding Sistem
          </button>
        </div>

        <div className="space-y-4">
          <Card title="Pratinjau Halaman Login" subtitle="Persis seperti yang dilihat pengunjung (global)">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="p-5 text-white" style={{ background: 'linear-gradient(150deg, #c2410c 0%, #ea580c 52%, #f59e0b 100%)' }}>
                <div className="flex items-center gap-2.5">
                  {previewLogo ? <img src={previewLogo} alt="" className="h-10 w-10 rounded-xl bg-white/95 object-contain p-1" /> :
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/20"><ImageIcon size={20} /></div>}
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-white/75">{previewSub}</p>
                    <p className="truncate text-[15px] font-extrabold uppercase leading-tight">{previewNama}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-[11.5px] leading-relaxed text-white/85">{f.login_deskripsi || 'Deskripsi singkat platform.'}</p>
                <p className="mt-3 text-[10.5px] text-white/60">{f.login_footer || f.domain_info || 'alamat platform'}</p>
              </div>
              <div className="space-y-2 bg-white p-4">
                <div className="h-8 rounded-lg bg-slate-100" />
                <div className="h-8 rounded-lg bg-slate-100" />
                <div className="h-8 rounded-lg bg-slate-100" />
                <div className="h-8 rounded-lg" style={{ background: 'linear-gradient(135deg,#ea580c,#c2410c)' }} />
                <p className="text-center text-[11px] text-slate-500">Belum punya akun? <b className="text-orange-600">Daftarkan Sekolah</b></p>
                <p className="pt-1 text-center text-[10.5px] text-slate-400">{f.login_copyright || `© ${new Date().getFullYear()} ${f.app_nama || 'Nama Aplikasi'}`}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 p-2.5">
              <img src={f.favicon || '/favicon.ico'} alt="" width="20" height="20" className="h-5 w-5 rounded object-contain" />
              <p className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-slate-600">{previewNama} · Masuk</p>
              <span className="text-[10px] text-slate-400">preview tab</span>
            </div>
          </Card>
          <Card title="Status Branding">
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-slate-500">Versi branding</span><b className="font-mono text-[11.5px]">{data.platform.version}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Pendaftaran</span><Badge tone={f.pendaftaran_aktif ? 'aman' : 'pantau'}>{f.pendaftaran_aktif ? 'Dibuka' : 'Ditutup'}</Badge></div>
              <div className="flex justify-between"><span className="text-slate-500">reCAPTCHA</span><Badge tone={f.recaptcha_site ? 'aman' : 'netral'}>{f.recaptcha_site ? 'Aktif' : 'Nonaktif'}</Badge></div>
              <div className="flex justify-between"><span className="text-slate-500">Uji coba</span><b>{f.trial_hari} hari</b></div>
              <p className="pt-1 text-[11px] leading-relaxed text-slate-400">
                Setiap penyimpanan menaikkan versi branding sehingga favicon & judul tab di perangkat lain
                ikut diperbarui (tanpa menunggu cache browser).
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   8. LEGAL: SYARAT & SLA
   ===================================================================== */
export function SuperLegal({ ctx }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('tos');
  const load = useCallback(async () => {
    const r = await api('/api/super/legal');
    setF({ tos_judul: r.tos_judul, tos_isi: r.tos_isi, sla_judul: r.sla_judul, sla_isi: r.sla_isi, diperbarui: r.diperbarui });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!f) return <Spinner label="Memuat dokumen legal…" />;

  async function simpan() {
    setBusy(true);
    try {
      const r = await api('/api/super/legal', { method: 'POST', body: f });
      toast.ok(r.pesan); load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Syarat &amp; Ketentuan / SLA</h2>
        <p className="text-[12.5px] text-slate-500">Dokumen ini otomatis muncul di menu <b>Legal &amp; SLA</b> pada setiap akun sekolah.</p>
      </div>
      <div className="tabs">
        <button className={cx('tab', tab === 'tos' && 'active')} onClick={() => setTab('tos')}>Syarat &amp; Ketentuan</button>
        <button className={cx('tab', tab === 'sla' && 'active')} onClick={() => setTab('sla')}>Service Level Agreement</button>
      </div>
      <Card title={tab === 'tos' ? 'Syarat & Ketentuan (TOS)' : 'Service Level Agreement (SLA)'}
        subtitle={f.diperbarui ? `Terakhir diperbarui ${tgl(f.diperbarui)}` : 'Belum pernah diperbarui'}>
        <div className="space-y-3">
          <Field label="Judul Dokumen">
            <input className="input" value={tab === 'tos' ? f.tos_judul : f.sla_judul}
              onChange={e => setF(v => tab === 'tos' ? { ...v, tos_judul: e.target.value } : { ...v, sla_judul: e.target.value })} />
          </Field>
          <Field label="Isi Dokumen" hint="Satu paragraf per baris. Nomor urut ditulis manual (1. … 2. …).">
            <textarea className="input min-h-[340px] font-mono text-[12.5px]" value={tab === 'tos' ? f.tos_isi : f.sla_isi}
              onChange={e => setF(v => tab === 'tos' ? { ...v, tos_isi: e.target.value } : { ...v, sla_isi: e.target.value })} />
          </Field>
          <button className="btn-primary" disabled={busy} onClick={simpan}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Dokumen</button>
        </div>
      </Card>
      <Card title="Pratinjau" subtitle="Tampilan di akun sekolah">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-[15px] font-extrabold text-slate-800">{tab === 'tos' ? f.tos_judul : f.sla_judul}</h3>
          <p className="text-[11.5px] text-slate-400">Diperbarui {f.diperbarui ? tgl(f.diperbarui) : '—'}</p>
          <div className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-600">{tab === 'tos' ? f.tos_isi : f.sla_isi}</div>
        </div>
      </Card>
    </div>
  );
}

/* =====================================================================
   9. PENGUMUMAN & MAINTENANCE
   ===================================================================== */
export function SuperPengumuman({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [maint, setMaint] = useState({ aktif: false, pesan: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api('/api/super/pengumuman');
    setData(r);
    setMaint(r.maintenance);
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!data) return <Spinner label="Memuat pengumuman…" />;

  async function simpan(body, msg) {
    setBusy(true);
    try {
      const r = await api('/api/super/pengumuman', { method: 'POST', body });
      toast.ok(r.pesan || msg);
      setEdit(null); load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Pengumuman &amp; Maintenance</h2>
          <p className="text-[12.5px] text-slate-500">Siarkan informasi ke seluruh sekolah atau aktifkan mode pemeliharaan.</p>
        </div>
        <button className="btn-primary" onClick={() => setEdit({ judul: '', isi: '', tipe: 'info', aktif: 1, mulai: '', selesai: '' })}>
          <Plus size={15} /> Buat Pengumuman
        </button>
      </div>

      <Card title="Mode Pemeliharaan" subtitle="Saat aktif, halaman login & panel sekolah menampilkan pesan pemeliharaan">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <Wrench size={20} className="text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-amber-900">{maint.aktif ? 'Mode pemeliharaan AKTIF' : 'Aplikasi berjalan normal'}</p>
            <p className="text-[11.5px] text-amber-800">Super Admin tetap dapat masuk untuk mematikan mode ini.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold text-amber-900">
            <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={!!maint.aktif}
              onChange={e => setMaint(m => ({ ...m, aktif: e.target.checked }))} /> Aktifkan
          </label>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input className="input" value={maint.pesan} onChange={e => setMaint(m => ({ ...m, pesan: e.target.value }))} placeholder="Pesan yang tampil saat maintenance" />
          <button className="btn-primary" disabled={busy} onClick={() => simpan({ maintenance_aktif: maint.aktif, maintenance_pesan: maint.pesan }, 'Mode pemeliharaan disimpan.')}>
            <Save size={15} /> Simpan
          </button>
        </div>
      </Card>

      <Card title="Daftar Pengumuman" bodyClass="p-0">
        <div className="divide-y divide-slate-100">
          {data.rows.map(p => (
            <div key={p.id} className="flex flex-wrap items-start gap-3 p-3">
              <Bell size={16} className="mt-0.5 text-orange-500" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-slate-800">{p.judul}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-slate-600">{p.isi}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {p.tipe} · {waktu(p.created_at)}
                  {p.mulai ? ` · mulai ${tgl(p.mulai)}` : ''}{p.selesai ? ` · s/d ${tgl(p.selesai)}` : ''}
                </p>
              </div>
              <Badge tone={p.aktif ? 'aman' : 'netral'}>{p.aktif ? 'Aktif' : 'Nonaktif'}</Badge>
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => setEdit(p)}>Edit</button>
                <button className="btn-danger btn-sm" onClick={() => { if (confirm('Hapus pengumuman ini?')) simpan({ hapus: p.id }); }}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {!data.rows.length ? <div className="p-5"><Empty title="Belum ada pengumuman" desc="Buat pengumuman untuk menginformasikan perubahan layanan." /></div> : null}
        </div>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit Pengumuman' : 'Buat Pengumuman'} size="md">
        {edit ? (
          <form id="fPeng" className="space-y-3" onSubmit={e => { e.preventDefault(); simpan(edit); }}>
            <Field label="Judul" required><input className="input" required value={edit.judul} onChange={e => setEdit(v => ({ ...v, judul: e.target.value }))} /></Field>
            <Field label="Isi Pengumuman"><textarea className="input min-h-[110px]" value={edit.isi || ''} onChange={e => setEdit(v => ({ ...v, isi: e.target.value }))} /></Field>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Field label="Tipe">
                <select className="input" value={edit.tipe} onChange={e => setEdit(v => ({ ...v, tipe: e.target.value }))}>
                  <option value="info">Informasi</option>
                  <option value="peringatan">Peringatan</option>
                  <option value="maintenance">Pemeliharaan</option>
                </select>
              </Field>
              <Field label="Mulai (opsional)"><input className="input" type="date" value={edit.mulai || ''} onChange={e => setEdit(v => ({ ...v, mulai: e.target.value }))} /></Field>
              <Field label="Selesai (opsional)"><input className="input" type="date" value={edit.selesai || ''} onChange={e => setEdit(v => ({ ...v, selesai: e.target.value }))} /></Field>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!Number(edit.aktif ?? 1)} onChange={e => setEdit(v => ({ ...v, aktif: e.target.checked ? 1 : 0 }))} /> Tampilkan ke sekolah
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Batal</button>
              <button className="btn-primary" type="submit" disabled={busy}><Save size={15} /> Simpan</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
