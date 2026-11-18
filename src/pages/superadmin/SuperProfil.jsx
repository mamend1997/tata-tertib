import React, { useCallback, useEffect, useState } from 'react';
import { AtSign, CheckCircle2, KeyRound, Loader2, Phone, Save, ShieldCheck, User, UserCog } from 'lucide-react';
import { api } from '../../api';
import { Alert, Card, Field, Spinner, useToast } from '../../ui';

/* =====================================================================
   PENGATURAN PROFIL SUPER ADMIN
   - ubah Nama Akun, username, email, dan nomor WhatsApp pemulihan
   - perbarui kata sandi (wajib kata sandi lama)
   ===================================================================== */
export default function SuperProfil({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState({ nama: '', username: '', email: '', phone: '' });
  const [pw, setPw] = useState({ password_lama: '', password_baru: '', password_ulang: '' });
  const [busy, setBusy] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const [err, setErr] = useState('');
  const [errPw, setErrPw] = useState('');

  const load = useCallback(async () => {
    const r = await api('/api/super/profil');
    setData(r);
    setF({ nama: r.user.nama || '', username: r.user.username || '', email: r.user.email || '', phone: r.user.phone || '' });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!data) return <Spinner label="Memuat profil Super Admin…" />;

  async function simpanProfil(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api('/api/super/profil', { method: 'POST', body: f });
      toast.ok(r.pesan);
      await load();
      await ctx.reload?.();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  async function simpanSandi(e) {
    e.preventDefault();
    setErrPw(''); setBusyPw(true);
    try {
      const r = await api('/api/super/profil', {
        method: 'POST',
        body: { ...f, ...pw }
      });
      toast.ok(r.pesan);
      setPw({ password_lama: '', password_baru: '', password_ulang: '' });
      await load();
    } catch (e2) { setErrPw(e2.message); }
    finally { setBusyPw(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-[19px] font-extrabold text-slate-800">
          <UserCog size={19} className="text-slate-500" /> Pengaturan Profil Super Admin
        </h2>
        <p className="text-[12.5px] text-slate-500">
          Ubah nama akun, username, email, nomor WhatsApp pemulihan, dan kata sandi akun Super Admin yang sedang dipakai. Perubahan berlaku
          pada login berikutnya & seluruh perangkat yang memakai akun ini.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Identitas Akun" subtitle="Nama tampilan dan username untuk masuk">
          <form className="space-y-3" onSubmit={simpanProfil}>
            <Field label="Nama Akun Super Admin" required>
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" required value={f.nama} onChange={e => setF(v => ({ ...v, nama: e.target.value }))} placeholder="mis. Administrator Platform" />
              </div>
            </Field>
            <Field label="Username" required hint="3–32 karakter: huruf kecil, angka, titik, garis bawah, strip">
              <div className="relative">
                <ShieldCheck size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9 font-mono" required value={f.username} onChange={e => setF(v => ({ ...v, username: e.target.value }))} placeholder="superadmin" />
              </div>
            </Field>
            <Field label="Email (opsional)" hint="Boleh dipakai sebagai alternatif username saat masuk">
              <div className="relative">
                <AtSign size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" type="email" value={f.email} onChange={e => setF(v => ({ ...v, email: e.target.value }))} />
              </div>
            </Field>
            <Field label="Nomor WhatsApp Pemulihan" hint="OTP lupa kata sandi dikirim ke nomor ini melalui WhatsApp Gateway.">
              <div className="relative">
                <Phone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" type="tel" autoComplete="tel" value={f.phone}
                  onChange={e => setF(v => ({ ...v, phone: e.target.value }))} placeholder="0812xxxxxxx" />
              </div>
            </Field>
            {err ? <Alert tone="danger" title="Belum dapat disimpan">{err}</Alert> : null}
            <button className="btn-primary w-full py-2.5" type="submit" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Simpan Profil
            </button>
          </form>
        </Card>

        <Card title="Perbarui Kata Sandi" subtitle="Wajib menyertakan kata sandi lama sebagai verifikasi">
          <form className="space-y-3" onSubmit={simpanSandi}>
            <Field label="Kata Sandi Lama" required>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" type="password" required autoComplete="current-password"
                  value={pw.password_lama} onChange={e => setPw(v => ({ ...v, password_lama: e.target.value }))} />
              </div>
            </Field>
            <Field label="Kata Sandi Baru" required hint="Minimal 8 karakter, tidak boleh sama dengan sandi lama">
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" type="password" required minLength={8} autoComplete="new-password"
                  value={pw.password_baru} onChange={e => setPw(v => ({ ...v, password_baru: e.target.value }))} />
              </div>
            </Field>
            <Field label="Ulangi Kata Sandi Baru" required>
              <div className="relative">
                <CheckCircle2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" type="password" required minLength={8} autoComplete="new-password"
                  value={pw.password_ulang} onChange={e => setPw(v => ({ ...v, password_ulang: e.target.value }))} />
              </div>
            </Field>
            {errPw ? <Alert tone="danger" title="Kata sandi belum diubah">{errPw}</Alert> : null}
            <button className="btn-primary w-full py-2.5" type="submit" disabled={busyPw}>
              {busyPw ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Simpan Kata Sandi
            </button>
            <p className="text-[11.5px] leading-relaxed text-slate-400">
              Setelah kata sandi diubah, sesi yang sedang aktif tetap berjalan sampai Anda keluar (logout).
            </p>
          </form>
        </Card>
      </div>

      <Card title="Informasi Akun">
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-500">Username aktif</span><b className="font-mono">{data.user.username}</b></div>
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-500">Terakhir masuk</span><b>{data.user.terakhir_masuk || '—'}</b></div>
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-500">Email</span><b>{data.user.email || '—'}</b></div>
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-500">WhatsApp pemulihan</span><b>{data.user.phone || '—'}</b></div>
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-500">Jumlah akun Super Admin</span><b>{data.jumlah_admin || 1}</b></div>
        </div>
      </Card>
    </div>
  );
}
