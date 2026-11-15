import React, { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, Camera, Eye, EyeOff, IdCard, KeyRound, Loader2, Save, ShieldCheck, Trash2, UserCircle
} from 'lucide-react';
import { api, compressImage } from '../api';
import { Alert, Avatar, Card, Field, useToast } from '../ui';

export default function Profil({ ctx }) {
  const { boot, reloadBoot } = ctx;
  const toast = useToast();
  const u = boot.user;
  const [f, setF] = useState({ nama: '', username: '', phone: '', foto: '' });
  const [pass, setPass] = useState({ password_lama: '', password: '', password_ulang: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setF({ nama: u.nama || '', username: u.username || '', phone: u.phone || '', foto: u.foto || '' });
  }, [u]);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const small = await compressImage(file, { maxKb: 512, maxSide: 640, quality: 0.9 });
      let body;
      if (small) body = { base64: small.base64, filename: small.filename, jenis: 'foto' };
      else {
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
          fr.onerror = rej; fr.readAsDataURL(file);
        });
        body = { base64: b64, filename: file.name, jenis: 'foto' };
      }
      const r = await api('/api/upload', { method: 'POST', body });
      setF(v => ({ ...v, foto: r.url }));
      toast.ok('Foto profil siap disimpan.');
    } catch (e) { toast.err(e.message); }
    finally { setUploading(false); }
  }

  async function simpan(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f };
      if (pass.password || pass.password_lama) Object.assign(body, pass);
      await api('/api/profile/save', { method: 'POST', body });
      toast.ok('Profil akun diperbarui.');
      setPass({ password_lama: '', password: '', password_ulang: '' });
      await reloadBoot();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Profil Akun</h2>
        <p className="text-[12.5px] text-slate-500">Kelola foto, nama lengkap, username, dan kata sandi akun yang sedang Anda gunakan.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card title="Kartu Identitas" subtitle="Tampil pada header aplikasi">
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="relative">
              <Avatar nama={f.nama || u.nama} src={f.foto} size={96} />
              <label className="absolute -bottom-1 -right-1 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-orange-600 text-white shadow-soft ring-2 ring-white">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => upload(e.target.files?.[0])} />
              </label>
            </div>
            <div>
              <p className="text-[15px] font-extrabold text-slate-800">{f.nama || u.nama}</p>
              <p className="text-[12px] text-slate-500">{u.role_label}</p>
            </div>
            <div className="flex w-full flex-col gap-1.5 text-left">
              <Info icon={IdCard} label="Username" value={u.username || '-'} />
              <Info icon={BadgeCheck} label="Jabatan" value={u.jabatan || u.role_label} />
              <Info icon={ShieldCheck} label="NIP" value={u.nip || '-'} />
            </div>
            {f.foto ? (
              <button type="button" onClick={() => { setF(v => ({ ...v, foto: '' })); if (fileRef.current) fileRef.current.value = ''; }}
                className="btn-danger btn-sm w-full"><Trash2 size={13} /> Hapus foto</button>
            ) : null}
            <p className="text-[11px] leading-snug text-slate-400">Foto otomatis dikompres ke 512 px dan disimpan melalui penyimpanan media sekolah.</p>
          </div>
        </Card>

        <form onSubmit={simpan} className="space-y-4">
          <Card title="Data Akun" subtitle="Nama & username dipakai pada pencatatan kejadian dan log aktivitas">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama Lengkap" required className="sm:col-span-2">
                <input className="input" value={f.nama} required onChange={e => setF(v => ({ ...v, nama: e.target.value }))} />
              </Field>
              <Field label="Username" required hint="3–32 karakter: huruf, angka, titik, garis bawah, strip.">
                <input className="input" value={f.username} required onChange={e => setF(v => ({ ...v, username: e.target.value }))} />
              </Field>
              <Field label="Nomor HP" hint="Format 0812… (untuk kontak internal)">
                <input className="input" value={f.phone} onChange={e => setF(v => ({ ...v, phone: e.target.value }))} />
              </Field>
              <Field label="Role / Hak Akses" className="sm:col-span-2" hint="Perubahan role hanya dapat dilakukan Administrator melalui menu Akun Pengguna.">
                <input className="input" value={u.role_label} disabled readOnly />
              </Field>
            </div>
          </Card>

          <Card title="Ubah Kata Sandi" subtitle="Biarkan kosong bila tidak ingin mengganti kata sandi">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Kata Sandi Saat Ini">
                <input className="input" type={show ? 'text' : 'password'} value={pass.password_lama}
                  autoComplete="current-password" onChange={e => setPass(v => ({ ...v, password_lama: e.target.value }))} />
              </Field>
              <Field label="Kata Sandi Baru" hint="Minimal 6 karakter">
                <input className="input" type={show ? 'text' : 'password'} value={pass.password}
                  autoComplete="new-password" onChange={e => setPass(v => ({ ...v, password: e.target.value }))} />
              </Field>
              <Field label="Ulangi Kata Sandi Baru">
                <input className="input" type={show ? 'text' : 'password'} value={pass.password_ulang}
                  autoComplete="new-password" onChange={e => setPass(v => ({ ...v, password_ulang: e.target.value }))} />
              </Field>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-slate-500">
              <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600" checked={show} onChange={e => setShow(e.target.checked)} />
              {show ? <Eye size={13} /> : <EyeOff size={13} />} Tampilkan kata sandi
            </label>
            <Alert tone="info" title="Keamanan akun">
              Gunakan kombinasi huruf, angka, dan simbol. Kata sandi baru langsung berlaku pada login berikutnya.
            </Alert>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Profil
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
      <Icon size={14} className="shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-[12.5px] font-semibold text-slate-700">{value}</p>
      </div>
    </div>
  );
}
