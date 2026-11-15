import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { api } from '../api';
import { Alert, Spinner } from '../ui';
import AbsensiKelas from '../components/AbsensiKelas';
import { applyTheme } from '../theme';

/* =====================================================================
   Halaman publik presensi siswa (tanpa login).
   Dibuka dari tautan/QR yang dibuat guru pada sesi mata pelajaran.
   Diisi oleh ketua kelas / perwakilan siswa — identitas pengisi dicatat
   sebagai audit trail ("diwakili/diisi oleh") dan dibatasi 1x per siswa.
   ===================================================================== */
export default function PresensiSiswa({ token }) {
  const [detail, setDetail] = useState(null);
  const [galat, setGalat] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.body.classList.add('app-bg');
    let alive = true;
    (async () => {
      try {
        const r = await api('/api/public/presensi/' + encodeURIComponent(token));
        if (!alive) return;
        setDetail(r);
        applyTheme({});
        document.title = `Presensi ${r.mapel?.nama || ''} · ${r.sekolah?.nama || ''}`;
      } catch (e) {
        if (!alive) return;
        setGalat(e.message || 'Tautan presensi tidak ditemukan.');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; document.body.classList.remove('app-bg'); };
  }, [token]);

  async function simpan({ items, pencatat }) {
    const r = await api('/api/public/presensi/' + encodeURIComponent(token), { method: 'POST', body: { items, pencatat } });
    setDetail(d => d ? {
      ...d,
      sesi: { ...d.sesi, pencatat },
      pencatat_info: r.pencatat_info || d.pencatat_info || null,
      siswa: d.siswa.map(s => {
        const it = items.find(x => Number(x.siswa_id) === Number(s.id));
        return it ? { ...s, status: it.status, keterangan: it.keterangan, terisi: true } : s;
      })
    } : d);
    return r;
  }

  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Memuat sesi presensi…" /></div>;

  if (galat) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-[440px] p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600"><AlertTriangle size={26} /></div>
          <h1 className="mt-3 text-[17px] font-extrabold text-slate-800">Tautan presensi tidak dapat dibuka</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{galat}</p>
          <p className="mt-2 text-[11.5px] text-slate-400">Minta tautan/QR terbaru kepada guru mata pelajaran atau ketua kelas.</p>
          <a href={(window.__BASE__ || '') + '/'} className="btn-ghost mt-4 w-full justify-center"><ArrowLeft size={15} /> Kembali</a>
        </div>
      </div>
    );
  }

  const kelasNama = (detail.kelas || []).map(k => k.nama).join(' + ');
  const info = detail.pencatat_info;
  const terkunci = !detail.window?.terbuka;
  return (
    <div className="min-h-screen pb-12">
      <header className="text-white" style={{ background: 'linear-gradient(120deg, var(--primary-700) 0%, var(--primary) 55%, #f59e0b 100%)' }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5">
          {detail.sekolah?.logo ? (
            <img src={detail.sekolah.logo} alt="" width="38" height="38" className="h-10 w-10 shrink-0 rounded-xl bg-white/95 object-contain p-1" />
          ) : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30"><ShieldCheck size={20} /></div>}
          <div className="min-w-0">
            <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/80">{detail.sekolah?.nama}</p>
            <h1 className="truncate text-[15px] font-extrabold uppercase leading-tight sm:text-[17px]">
              Absensi {detail.sekolah?.nama || 'Sekolah'}
            </h1>
          </div>
        </div>
      </header>

      {/* JANGAN memakai margin negatif: header judul tertimpa konten di ponsel */}
      <main className="mx-auto max-w-3xl px-4 pt-4" data-presensi-publik>
        <div className="card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-orange-600">Presensi Mata Pelajaran</p>
              <h2 className="text-[18px] font-extrabold leading-tight text-slate-800">{kelasNama || '-'}</h2>
              <p className="text-[12px] text-slate-500">{detail.mapel?.nama} · {detail.tanggal_label} · {detail.jadwal?.jam}</p>
            </div>
            <span className={`badge ${detail.window?.terbuka ? 'badge-aman' : 'badge-siaga'}`} data-status-sesi>
              {detail.window?.terbuka ? 'Presensi dibuka' : 'Presensi ditutup'}
            </span>
          </div>

          {terkunci ? (
            <Alert tone="warn" title="Sesi presensi sudah ditutup" icon={Lock}>
              {detail.window?.keterangan
                || `Presensi hanya dapat diisi pada jam pelajaran berlangsung (jendela ${detail.window?.buka}–${detail.window?.tutup}).`}
              <span className="mt-1 block">Data presensi terkunci dan tidak dapat diubah. Hubungi guru mata pelajaran bila perlu koreksi.</span>
            </Alert>
          ) : (
            <Alert tone="info" title="Isi kehadiran dengan jujur">
              Semua siswa otomatis <b>Hadir (H)</b>. Ubah hanya yang Sakit (S), Izin (I), Alpha (A), atau Bolos (B). Gunakan kotak pencarian nama agar tidak perlu menggulir, lalu <b>tulis nama Anda</b> pada kolom verifikasi dan tekan Simpan.
            </Alert>
          )}

          <div className="mt-3">
            <AbsensiKelas detail={detail} simpan={simpan} readOnly={terkunci} mode="publik" tglLabel={detail.tanggal_label} />
          </div>

          {/* AUDIT TRAIL: siapa siswa yang mewakili/mengisi presensi ini */}
          {info && info.nama ? (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12.5px] text-emerald-900"
              data-pencatat-info>
              <UserCheck size={15} className="mt-0.5 shrink-0" />
              <span>
                Absensi ini diwakili/diisi oleh: <b>{info.nama}</b>
                {info.kelas ? <span> (Siswa Kelas {info.kelas})</span> : null}
                {info.at ? <span className="mt-0.5 block text-[11px] font-normal text-emerald-700">Dicatat {String(info.at).slice(0, 16)}</span> : null}
              </span>
            </div>
          ) : null}
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-400">
          {detail.app_nama || 'Aplikasi Sekolah'} · data presensi langsung tersinkron ke rekap guru, wali kelas, dan Wakasek Kurikulum.
        </p>
      </main>
    </div>
  );
}
