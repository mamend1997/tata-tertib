import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, Loader2, MousePointerClick, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { Card, cx, useToast } from '../ui';

const STEPS = [
  {
    id: 'profile', title: 'Profil Sekolah', page: 'pengaturan', tab: 'identitas', target: 'setup-profile-save',
    description: 'Lengkapi nama sekolah. Identitas ini dipakai pada header aplikasi, portal, dan dokumen resmi.'
  },
  {
    id: 'year', title: 'Tahun Pelajaran', page: 'pengaturan', tab: 'tahun', target: 'setup-year-add',
    description: 'Pastikan tahun pelajaran yang sedang digunakan sudah dibuat dan ditandai aktif.'
  },
  {
    id: 'classes', title: 'Kelas', page: 'kelas', target: 'setup-class-add',
    description: 'Buat rombongan belajar agar siswa dan data akademik dapat ditempatkan dengan benar.'
  },
  {
    id: 'staff', title: 'Guru & Pegawai', page: 'pengguna', target: 'setup-user-add',
    description: 'Tambahkan akun guru atau pegawai supaya mereka bisa masuk sesuai role dan hak aksesnya.'
  },
  {
    id: 'students', title: 'Siswa', page: 'siswa', target: 'setup-student-add',
    description: 'Masukkan data siswa, manual atau melalui impor Excel, sebelum mencatat kejadian.'
  },
  {
    id: 'categories', title: 'Kategori Poin', page: 'kategori', target: 'setup-category-add',
    description: 'Tinjau kategori pelanggaran dan prestasi beserta bobot poin yang akan digunakan.'
  },
  {
    id: 'schedule', title: 'Jadwal & Absensi', page: 'jadwal', target: 'setup-schedule-add',
    description: 'Susun minimal satu slot jadwal. Jadwal menjadi dasar absensi guru dan siswa per mata pelajaran.'
  },
  {
    id: 'backup', title: 'Backup Telegram', page: 'pengaturan', tab: 'backup', target: 'setup-backup-save',
    description: 'Masukkan Bot Token dan Chat ID, atur satu atau lebih jam, lalu aktifkan backup otomatis.'
  }
];

export default function SetupChecklist({ ctx }) {
  const { boot, refreshKey, startGuide, toast } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (boot?.user?.role !== 'admin') return;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    api('/api/setup-checklist')
      .then(result => { if (active) setData(result); })
      .catch(err => {
        if (!active) return;
        setError(err.message);
        toast.err(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [boot?.user?.role, refreshKey, retryKey]);

  if (boot?.user?.role !== 'admin') return null;

  const done = Number(data?.completed) || 0;
  const total = Number(data?.total) || STEPS.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  if (dismissed || (data && total > 0 && done >= total)) return null;

  const status = loading
    ? <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400"><Loader2 size={13} className="animate-spin" /> Memeriksa</span>
    : error
      ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-extrabold text-rose-700">Tidak tersedia</span>
      : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-extrabold text-amber-800">
        {done}/{total} selesai · {percent}%
      </span>;

  return (
    <div data-setup-checklist>
      <Card title="Siapkan Sekolah Anda" subtitle="Checklist setup awal untuk mulai menggunakan aplikasi"
        right={<div className="flex items-center gap-2">
          {status}
          <button type="button" onClick={() => setDismissed(true)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup checklist setup awal" title="Tutup checklist" data-setup-close>
            <X size={15} />
          </button>
        </div>}>
        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800">
            <p>Checklist setup gagal dimuat: {error}</p>
            <button type="button" className="btn-soft btn-sm mt-2" onClick={() => setRetryKey(v => v + 1)}>Coba lagi</button>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cx('h-full rounded-full transition-all', percent === 100 ? 'bg-emerald-500' : 'bg-orange-500')}
                  style={{ width: percent + '%' }} />
              </div>
              <p className="mt-1.5 text-[11.5px] text-slate-500" aria-live="polite">
                {percent === 100
                  ? 'Semua tahap utama sudah terpenuhi. Sekolah siap mulai digunakan.'
                  : 'Tahap yang belum lengkap tetap bisa dibuka lewat tombol Pandu Saya.'}
              </p>
            </div>

            <ol className="grid gap-2 sm:grid-cols-2">
              {STEPS.map((step, index) => {
                const complete = !!data?.stages?.[step.id]?.complete;
                const detail = data?.stages?.[step.id]?.detail || '';
                return (
                  <li key={step.id} data-setup-step={step.id}
                    className={cx('flex min-w-0 items-start gap-2.5 rounded-xl border p-2.5',
                      complete ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white')}>
                    {complete
                      ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Selesai" />
                      : <Circle size={17} className="mt-0.5 shrink-0 text-slate-300" aria-label="Belum selesai" />}
                    <div className="min-w-0 flex-1">
                      <p className={cx('text-[12px] font-bold', complete ? 'text-emerald-900' : 'text-slate-700')}>
                        {index + 1}. {step.title}
                        {complete ? <span className="ml-1.5 text-[10px] font-extrabold uppercase text-emerald-700">Selesai</span> : null}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">{detail || step.description}</p>
                      <button type="button" className="mt-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-bold text-orange-700 transition hover:bg-orange-100"
                        onClick={() => startGuide(step)} data-setup-guide={step.id}>
                        <MousePointerClick size={12} /> Pandu Saya <ArrowRight size={11} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <Sparkles size={12} /> Panduan interaktif berjalan di aplikasi dan tidak mengirim data ke layanan AI eksternal.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
