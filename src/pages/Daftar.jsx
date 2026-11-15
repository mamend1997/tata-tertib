import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Building2, Check, CheckCircle2, Copy, ExternalLink,
  GraduationCap, KeyRound, LayoutDashboard, ListChecks, Loader2, Lock, Mail, MapPin, Phone,
  School, ShieldCheck, Sparkles, User
} from 'lucide-react';
import { api } from '../api';
import { Alert, Field, cx } from '../ui';

/* satu baris "label : nilai" pada kartu pratinjau pendaftaran */
function InfoRow({ label, value, mono }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <span className="shrink-0 text-[12px] text-slate-500">{label}</span>
      <span className={cx('min-w-0 break-words text-right text-[12.5px] font-semibold text-slate-800', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

/* daftar kecil "apa yang sudah disiapkan otomatis" */
function SiapItem({ icon, judul, isi, tone = 'emerald' }) {
  const warna = {
    emerald: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-orange-50 text-orange-600',
    sky: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600'
  }[tone] || 'bg-slate-100 text-slate-600';
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white/70 p-2.5">
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', warna)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[12.5px] font-bold text-slate-700">{judul}</p>
        <p className="text-[11.5px] leading-snug text-slate-500">{isi}</p>
      </div>
    </div>
  );
}

const JENJANG = [
  ['SD', 'SD — Sekolah Dasar'], ['MI', 'MI — Madrasah Ibtidaiyah'],
  ['SMP', 'SMP — Sekolah Menengah Pertama'], ['MTs', 'MTs — Madrasah Tsanawiyah'],
  ['SMA', 'SMA — Sekolah Menengah Atas'], ['MA', 'MA — Madrasah Aliyah'],
  ['SMK', 'SMK — Sekolah Menengah Kejuruan'], ['TK', 'TK — Taman Kanak-kanak'],
  ['PAUD', 'PAUD / Kelompok Bermain']
];

/* props `onSelesai` tidak lagi dipakai: setelah daftar sukses pendaftar melihat
   pratinjau hasil lebih dulu dan masuk dashboard lewat tombol sendiri. */
export default function Daftar({ cfg, onBatal }) {
  const platform = (cfg && cfg.platform) || {};
  const [f, setF] = useState({ jenjang: 'SMK' });
  const [busy, setBusy] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSentPhone, setOtpSentPhone] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [err, setErr] = useState('');
  const [hasil, setHasil] = useState(null);
  const [errs, setErrs] = useState([]);
  const [copied, setCopied] = useState('');
  /* anti-spam: waktu form dibuka + honeypot + token reCAPTCHA */
  const t0 = useRef(Date.now());
  const [honeypot, setHoneypot] = useState('');
  const [captcha, setCaptcha] = useState('');
  const captchaBox = useRef(null);
  const siteKey = platform.recaptcha_site || '';

  useEffect(() => { t0.current = Date.now(); }, []);

  async function sendOtp() {
    setErr('');
    setOtpBusy(true);
    try {
      const r = await api('/api/daftar/otp', {
        method: 'POST',
        body: { telp: f.telp, website: honeypot }
      });
      setOtpCode('');
      setOtpSentPhone(f.telp || '');
      setOtpMessage(r.pesan || 'Kode verifikasi dikirim melalui WhatsApp.');
    } catch (e) {
      setOtpMessage(e.message);
    } finally { setOtpBusy(false); }
  }

  /* reCAPTCHA hanya dimuat bila Super Admin mengisi Site Key */
  useEffect(() => {
    if (!siteKey || !captchaBox.current) return;
    const render = () => {
      try {
        if (window.grecaptcha && window.grecaptcha.render && captchaBox.current && !captchaBox.current.dataset.done) {
          window.grecaptcha.render(captchaBox.current, { sitekey: siteKey, callback: t => setCaptcha(t), 'expired-callback': () => setCaptcha('') });
          captchaBox.current.dataset.done = '1';
        }
      } catch (e) { /* abaikan */ }
    };
    if (window.grecaptcha && window.grecaptcha.render) { render(); return; }
    const sc = document.createElement('script');
    sc.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    sc.async = true; sc.defer = true;
    sc.onload = render;
    document.head.appendChild(sc);
    return () => { try { sc.remove(); } catch (e) { /* abaikan */ } };
  }, [siteKey]);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setErrs([]); setBusy(true);
    try {
      const r = await api('/api/daftar', {
        method: 'POST',
        body: { ...f, otp: otpCode, trial: true, t0: t0.current, website: honeypot, captcha_token: captcha }
      });
      setHasil(r);
      /* TIDAK ada pengalihan otomatis: pendaftar melihat pratinjau hasil
         pendaftaran lebih dulu, lalu menekan tombol sendiri menuju dashboard. */
    } catch (e2) {
      setErr(e2.message);
      setErrs(String(e2.message).split(' • '));
    } finally { setBusy(false); }
  }

  const namaApp = platform.login_judul || platform.app_nama_default || platform.app_nama || (window.__BRAND__ && window.__BRAND__.app_nama) || 'Aplikasi';
  const subApp = platform.login_subjudul || platform.app_subtitle || '';
  const copyright = platform.login_copyright || `© ${new Date().getFullYear()} ${namaApp}`;
  const otpSentForCurrent = Boolean(otpSentPhone && otpSentPhone === (f.telp || ''));
  const otpReady = otpSentForCurrent && /^\d{6}$/.test(otpCode);

  /* ---------------- PRATINJAU HASIL PENDAFTARAN ----------------
     Setelah pendaftaran berhasil, pendaftar TIDAK langsung dilempar ke
     dashboard: semua yang baru dibuat ditampilkan dulu (identitas sekolah,
     kode sekolah, akun admin, kelas & menu bawaan, alamat portal), lalu
     tombol "Buka Dashboard Sekolah" yang membawanya masuk. */
  if (hasil) {
    const s = hasil.sekolah || {};
    const ring = hasil.ringkasan || {};
    const kode = String(hasil.kode || '');
    const base = (window.__BASE__ || '');
    const portalPath = (hasil.portal && hasil.portal.path) || '';
    const portalUrl = portalPath ? base + portalPath : '';
    const kelasList = Array.isArray(ring.kelas) ? ring.kelas : [];
    const menuList = Array.isArray(ring.menu) ? ring.menu : [];
    const masaAktif = hasil.aktif_sampai
      ? new Date(hasil.aktif_sampai + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      : 'Tanpa batas (Lifetime)';
    const keDashboard = () => {
      /* sesi login sudah dibuat server saat pendaftaran (auto_login) */
      if (hasil.auto_login) window.location.href = base + '/#/dashboard';
      else window.location.href = base + '/?kode=' + encodeURIComponent(kode);
    };
    async function salin(teks, label) {
      let sukses = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(teks);
          sukses = true;
        }
      } catch (e) { sukses = false; }
      if (!sukses) {
        /* fallback untuk konteks non-HTTPS / izin clipboard ditolak */
        try {
          const ta = document.createElement('textarea');
          ta.value = teks;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '-1000px';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          sukses = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (e) { sukses = false; }
      }
      if (sukses) {
        setCopied(label);
        setTimeout(() => setCopied(''), 2000);
      }
      return sukses;
    }

    return (
      <div className="min-h-screen px-3 py-6 sm:px-5 sm:py-9"
        style={{ background: 'linear-gradient(180deg,#fdfbf8 0%,#f6f4f1 55%,#f4f2ef 100%)' }}>
        <div className="mx-auto w-full max-w-[880px] space-y-4">
          <div className="card overflow-hidden">
            {/* kepala: berhasil */}
            <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50/70 px-5 py-4 sm:flex-row sm:items-center">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500 text-white shadow-soft"><CheckCircle2 size={26} /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[18px] font-extrabold leading-tight text-slate-800">Pendaftaran Berhasil!</h2>
                <p className="text-[12.5px] text-slate-600">{hasil.pesan}</p>
              </div>
              <span className="shrink-0 self-start rounded-full bg-white px-3 py-1 text-[11.5px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                {hasil.status_label || (hasil.trial ? 'Uji Coba' : 'Aktif')}
              </span>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              {/* kode sekolah — elemen paling penting, tampil besar */}
              <div className="rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.18em] text-orange-700">
                      <KeyRound size={12} /> Kode Sekolah
                    </p>
                    <p data-preview-kode className="mt-1 font-mono text-[36px] font-extrabold leading-none tracking-[0.16em] text-orange-900">{kode}</p>
                    <p className="mt-1.5 text-[12px] leading-snug text-orange-900/75">
                      Wajib diketik saat masuk aplikasi, bersama username <b>{hasil.admin_username}</b> dan kata sandi admin yang Anda buat.
                    </p>
                  </div>
                  <button type="button" onClick={() => salin(kode, 'kode')}
                    data-salin-kode
                    className="btn-ghost shrink-0 border-orange-200 bg-white text-orange-700 hover:bg-orange-50">
                    {copied === 'kode' ? <Check size={15} /> : <Copy size={15} />}
                    {copied === 'kode' ? 'Tersalin' : 'Salin Kode'}
                  </button>
                </div>
              </div>

              {/* rincian: identitas sekolah + akun & layanan */}
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="rounded-2xl border border-slate-100 bg-white/80 p-3.5">
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-extrabold text-slate-800">
                    <Building2 size={14} className="text-orange-500" /> Identitas Sekolah
                  </h3>
                  <InfoRow label="Nama Sekolah" value={s.nama} />
                  <InfoRow label="Jenjang" value={s.jenjang_label || s.jenjang} />
                  <InfoRow label="Kepala Sekolah" value={s.kepala || '—'} />
                  <InfoRow label="Alamat" value={s.alamat} />
                  <InfoRow label="WhatsApp" value={s.telp} />
                  <InfoRow label="Email" value={s.email} />
                </section>

                <section className="rounded-2xl border border-slate-100 bg-white/80 p-3.5">
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-extrabold text-slate-800">
                    <ShieldCheck size={14} className="text-orange-500" /> Akun &amp; Layanan
                  </h3>
                  <InfoRow label="Username Admin" value={hasil.admin_username} mono />
                  <InfoRow label="Nama Admin" value={hasil.admin_nama} />
                  <InfoRow label="Paket" value={hasil.paket_nama || hasil.paket} />
                  <InfoRow label="Status" value={hasil.trial ? 'Masa Uji Coba' : 'Aktif'} />
                  <InfoRow label={hasil.trial ? 'Uji Coba s.d.' : 'Masa Aktif s.d.'} value={masaAktif} />
                  <InfoRow label="Tahun Pelajaran" value={hasil.tahun_ajaran || '—'} />
                </section>
              </div>

              {/* apa yang sudah disiapkan otomatis */}
              <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-slate-800">
                  <Sparkles size={14} className="text-orange-500" /> Sudah Disiapkan Otomatis
                </h3>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <SiapItem icon={<School size={15} />} tone="orange"
                    judul={`${ring.jumlah_kelas || 0} kelas bawaan`}
                    isi={kelasList.length ? kelasList.join(' · ') : 'Belum ada kelas'} />
                  <SiapItem icon={<ListChecks size={15} />} tone="emerald"
                    judul={`${ring.jumlah_kategori || 0} kategori poin`}
                    isi="Pelanggaran & prestasi siap dipakai" />
                  <SiapItem icon={<User size={15} />} tone="sky"
                    judul="Akun admin aktif"
                    isi={`${hasil.admin_username} — sudah bisa masuk sekarang`} />
                  <SiapItem icon={<LayoutDashboard size={15} />} tone="violet"
                    judul={`${ring.jumlah_menu || 0} menu aplikasi`}
                    isi={menuList.length ? menuList.slice(0, 6).join(' · ') + (menuList.length > 6 ? ' · …' : '') : 'Sesuai paket Anda'} />
                </div>
                {portalUrl ? (
                  <div className="mt-2 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/80 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700"><ExternalLink size={13} className="text-orange-500" /> Portal Cek Poin Siswa</p>
                      <p className="truncate font-mono text-[11.5px] text-slate-500">{portalUrl}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => salin(portalUrl, 'portal')} className="btn-ghost btn-sm">
                        {copied === 'portal' ? <Check size={13} /> : <Copy size={13} />} {copied === 'portal' ? 'Tersalin' : 'Salin'}
                      </button>
                      <a href={portalUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">Buka</a>
                    </div>
                  </div>
                ) : null}
              </section>

              <Alert tone="warn" title="Simpan informasi ini">
                Kode sekolah <b>{kode}</b> dan kata sandi admin diperlukan untuk masuk kembali. Catat atau salin sekarang —
                kode juga sudah dikirim ke WhatsApp {s.telp || 'Anda'} bila notifikasi aktif.
              </Alert>

              {/* tombol lanjut */}
              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                <button type="button" onClick={keDashboard} data-ke-dashboard
                  className="btn-primary order-1 w-full py-2.5 sm:order-2 sm:w-auto sm:flex-1">
                  <LayoutDashboard size={16} />
                  {hasil.auto_login ? 'Buka Dashboard Sekolah' : 'Masuk Halaman Login'}
                  <ArrowRight size={16} />
                </button>
                <button type="button" onClick={() => onBatal?.()}
                  className="btn-ghost order-2 w-full justify-center sm:order-1 sm:w-auto">
                  <ArrowLeft size={15} /> Kembali ke Halaman Masuk
                </button>
              </div>
              <p className="text-center text-[11.5px] leading-snug text-slate-400">
                Anda tidak dialihkan otomatis — periksa dulu data di atas, lalu buka dashboard saat sudah siap.
              </p>
            </div>
          </div>
          <p className="text-center text-[11.5px] text-slate-400">{copyright}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
      <div className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between"
        style={{ background: 'linear-gradient(150deg, var(--primary-700) 0%, var(--primary) 52%, #f59e0b 100%)' }}>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div>
          <button onClick={onBatal} className="mb-6 inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-[12px] font-bold ring-1 ring-white/25 hover:bg-white/25">
            <ArrowLeft size={14} /> Kembali ke halaman masuk
          </button>
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30"><ShieldCheck size={24} /></div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">{subApp}</p>
              <h1 className="text-[21px] font-extrabold uppercase leading-tight tracking-wide">{namaApp}</h1>
            </div>
          </div>
          <p className="mt-6 max-w-md text-[13.5px] leading-relaxed text-white/90">
            Daftarkan sekolah Anda dan mulai kelola kedisiplinan siswa hari ini. Coba gratis
            <b> {platform.trial_hari || 7} hari</b> tanpa perlu kartu kredit.
          </p>
          <ul className="mt-6 space-y-2 text-[12.5px] text-white/90">
            {[
              'Dashboard kedisiplinan & poin siswa otomatis',
              'Portal cek poin untuk siswa dan orang tua',
              'Kelas bawaan otomatis sesuai jenjang sekolah',
              'Surat panggilan & SP 1–3 siap cetak',
              `Masa uji coba ${platform.trial_hari || 7} hari penuh`
            ].map((t, i) => (
              <li key={i} className="flex items-start gap-2"><BadgeCheck size={15} className="mt-0.5 shrink-0 text-white/80" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="mt-8 text-[11.5px] text-white/70">{platform.login_footer || platform.domain || ''}</p>
      </div>

      <div className="flex items-start justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-[560px]">
          <button onClick={onBatal} className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-500 hover:text-slate-700 lg:hidden">
            <ArrowLeft size={14} /> Kembali
          </button>
          <div className="card p-5 sm:p-6">
            <h2 className="text-[18px] font-extrabold text-slate-800">Form Pendaftaran Sekolah</h2>
            <p className="text-[12.5px] text-slate-500">Isi data sekolah & akun admin. Tombol <b>Coba Gratis {platform.trial_hari || 7} Hari</b> langsung mengaktifkan akun.</p>

            {err ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12.5px] text-rose-700">
                <p className="font-bold">Pendaftaran belum bisa dilanjutkan:</p>
                <ul className="ml-4 list-disc">
                  {errs.length > 1 ? errs.map((x, i) => <li key={i}>{x}</li>) : <li>{err}</li>}
                </ul>
              </div>
            ) : null}

            <form className="mt-3 space-y-2.5" onSubmit={submit}>
              {/* honeypot anti-bot: tidak terlihat & tidak pernah diisi manusia */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', height: 0, width: 0, overflow: 'hidden' }}>
                <label>Website
                  <input tabIndex={-1} autoComplete="off" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)} />
                </label>
              </div>
              <Field label="Nama Sekolah" required>
                <div className="relative">
                  <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-9" required value={f.nama_sekolah || ''} onChange={e => setF(v => ({ ...v, nama_sekolah: e.target.value }))} placeholder="contoh: SMP Negeri 2 Ciamis" />
                </div>
              </Field>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Jenjang Pendidikan" required>
                  <select className="input" value={f.jenjang} onChange={e => setF(v => ({ ...v, jenjang: e.target.value }))}>
                    {JENJANG.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Nama Kepala Sekolah (opsional)">
                  <div className="relative">
                    <GraduationCap size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9" value={f.kepala || ''} onChange={e => setF(v => ({ ...v, kepala: e.target.value }))} />
                  </div>
                </Field>
              </div>
              <Field label="Alamat Sekolah" required>
                <div className="relative">
                  <MapPin size={15} className="absolute left-3 top-3 text-slate-400" />
                  <textarea className="input min-h-[70px] pl-9" required value={f.alamat || ''} onChange={e => setF(v => ({ ...v, alamat: e.target.value }))} placeholder="Jalan, kelurahan, kecamatan, kabupaten/kota" />
                </div>
              </Field>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Nama Admin" required>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9" required value={f.admin_nama || ''} onChange={e => setF(v => ({ ...v, admin_nama: e.target.value }))} />
                  </div>
                </Field>
                <Field label="No WhatsApp" required hint="Diverifikasi lewat OTP dan dipakai untuk notifikasi tagihan">
                  <div className="relative">
                    <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9" required value={f.telp || ''} onChange={e => {
                      setF(v => ({ ...v, telp: e.target.value }));
                      setOtpCode(''); setOtpSentPhone(''); setOtpMessage('');
                    }} placeholder="0812xxxxxxx" />
                  </div>
                </Field>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button type="button" className="btn-secondary shrink-0" disabled={otpBusy || !f.telp} onClick={sendOtp}>
                    {otpBusy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                    {otpBusy ? 'Mengirim kode…' : otpSentForCurrent ? 'Kirim Ulang Kode OTP' : 'Kirim Kode OTP WhatsApp'}
                  </button>
                  {otpSentForCurrent && (
                    <Field label="Kode OTP" required hint="Masukkan 6 digit kode yang diterima">
                      <input
                        className="input font-mono tracking-[0.3em]"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        pattern="[0-9]{6}"
                        required
                        value={otpCode}
                        onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                      />
                    </Field>
                  )}
                </div>
                <p className="mt-2 text-[11.5px] text-slate-600">
                  {otpMessage || 'Verifikasi nomor WhatsApp wajib sebelum pendaftaran dapat dikirim.'}
                </p>
              </div>
              <Field label="Email Admin" required hint="Dipakai sebagai username untuk masuk">
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="input pl-9" type="email" required value={f.email || ''} onChange={e => setF(v => ({ ...v, email: e.target.value }))} placeholder="admin@sekolah.sch.id" />
                </div>
              </Field>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Password Admin" required hint="Minimal 6 karakter">
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9" type="password" required value={f.password || ''} onChange={e => setF(v => ({ ...v, password: e.target.value }))} />
                  </div>
                </Field>
                <Field label="Ulangi Password" required>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9" type="password" required value={f.password2 || ''} onChange={e => setF(v => ({ ...v, password2: e.target.value }))} />
                  </div>
                </Field>
              </div>
              <Alert tone="info" title="Kelas otomatis">
                Sistem membuat daftar kelas default sesuai jenjang yang dipilih. Kelas tetap dapat diubah/ditambah
                melalui menu <b>Data Kelas</b> di dashboard sekolah.
              </Alert>
              {siteKey ? <div ref={captchaBox} className="flex justify-center py-1" /> : null}
              <button className="btn-primary w-full py-2.5" disabled={busy || !otpReady}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Coba Gratis {platform.trial_hari || 7} Hari
              </button>
              <p className="text-center text-[11.5px] text-slate-400">
                Dengan mendaftar Anda menyetujui Syarat &amp; Ketentuan layanan yang dapat dibaca pada menu Legal &amp; SLA setelah masuk.
                Formulir ini dilindungi verifikasi anti-bot.
              </p>
            </form>
          </div>
          <p className="mt-4 text-center text-[11.5px] text-slate-400">{copyright}</p>
        </div>
      </div>
    </div>
  );
}
