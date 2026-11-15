import React, { useState } from 'react';
import { Image as ImageIcon, Loader2, Upload as UploadIcon } from 'lucide-react';
import { api, angka } from '../../api';
import { cx, useToast } from '../../ui';

/* komponen & util bersama panel Super Admin */
export function Kpi({ label, value, sub, icon: Icon, tone = 'slate', onClick }) {
  const tones = {
    slate: 'from-slate-700 to-slate-900', emerald: 'from-emerald-500 to-teal-600',
    orange: 'from-orange-500 to-amber-600', sky: 'from-sky-500 to-indigo-600',
    rose: 'from-rose-500 to-pink-600', violet: 'from-violet-500 to-purple-600'
  };
  return (
    <button onClick={onClick} className={cx('group relative overflow-hidden rounded-2xl p-4 text-left text-white shadow-card transition',
      onClick && 'hover:-translate-y-0.5 hover:shadow-lg', 'bg-gradient-to-br', tones[tone] || tones.slate)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/75">{label}</p>
          <p className="mt-1 text-[26px] font-extrabold leading-none">{value}</p>
          {sub ? <p className="mt-1 text-[11.5px] text-white/80">{sub}</p> : null}
        </div>
        {Icon ? <Icon size={30} className="shrink-0 text-white/25" /> : null}
      </div>
    </button>
  );
}

export const Badge = ({ children, tone = 'slate' }) => <span className={cx('badge', `badge-${tone}`)}>{children}</span>;

export const statusTone = (t) => {
  const s = String(t || '').toLowerCase();
  if (s.includes('lifetime')) return 'prestasi';
  if (s.includes('aktif') || s.includes('disetujui') || s.includes('lunas') || s.includes('selesai')) return 'aman';
  if (s.includes('uji') || s.includes('trial') || s.includes('menunggu') || s.includes('baru') || s.includes('diproses')) return 'pantau';
  if (s.includes('tangguh') || s.includes('ditolak') || s.includes('gagal')) return 'siaga';
  if (s.includes('kedaluwarsa')) return 'waspada';
  return 'netral';
};

export const rupiah = n => 'Rp ' + angka(n || 0);
export const bytes = (b) => {
  const n = Number(b || 0);
  if (n > 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};
export async function salin(txt, toast, pesan = 'Disalin ke papan klip.') {
  try { await navigator.clipboard.writeText(String(txt)); toast.ok(pesan); }
  catch (e) { toast.err('Gagal menyalin — salin manual dari kolom teks.'); }
}

export function UploadGambar({ label, value, onChange, hint, jenis = 'logo' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
        r.onerror = rej; r.readAsDataURL(file);
      });
      const r = await api('/api/upload', { method: 'POST', body: { base64: b64, filename: file.name, jenis } });
      onChange(r.url);
      toast.ok('Berkas terunggah.');
    } catch (e) { toast.err(e.message); }
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
          <label className={cx('btn-ghost cursor-pointer', busy && 'pointer-events-none opacity-60')}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadIcon size={14} />} Pilih Gambar
            <input type="file" accept="image/*" className="hidden" onChange={e => pick(e.target.files?.[0])} />
          </label>
          {value ? <button type="button" className="btn-danger btn-sm" onClick={() => onChange('')}>Hapus</button> : null}
        </div>
      </div>
      {hint ? <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
