import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HeartPulse, Loader2, Send, Shield, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import SiswaAutocomplete from '../components/SiswaAutocomplete';

/* Halaman publik aduan kekerasan — dibuka siswa lewat QR/tautan guru BK. */
export default function AduanPublik({ token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sukses, setSukses] = useState(null);
  const [f, setF] = useState({
    nama: '', kelas_id: '', tanggal_lahir: '', jenis: 'Kekerasan verbal / perundungan',
    lokasi: '', kronologi: '', pelaku: '', kontak: ''
  });
  const [pilih, setPilih] = useState(null);   // siswa hasil autocomplete (kelas otomatis)
  const endpointSiswa = useCallback(
    (kw) => '/api/public/aduan/' + encodeURIComponent(token) + '/siswa?q=' + encodeURIComponent(kw),
    [token]);

  useEffect(() => {
    api('/api/public/aduan/' + encodeURIComponent(token))
      .then(r => setData(r)).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, [token]);

  async function kirim(ev) {
    ev.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = pilih
        ? { siswa_id: pilih.id, tanggal_lahir: f.tanggal_lahir, jenis: f.jenis, lokasi: f.lokasi,
            kronologi: f.kronologi, pelaku: f.pelaku, kontak: f.kontak }
        : f;
      const r = await api('/api/public/aduan/' + encodeURIComponent(token), { method: 'POST', body });
      setSukses(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-50"><Loader2 size={26} className="animate-spin text-orange-500" /></div>;
  if (!data && err) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="card max-w-md p-6 text-center">
          <AlertTriangle size={30} className="mx-auto text-rose-500" />
          <h1 className="mt-2 text-[16px] font-extrabold text-slate-800">Tautan tidak berlaku</h1>
          <p className="mt-1 text-[13px] text-slate-500">{err}</p>
        </div>
      </div>
    );
  }

  const sekolah = data?.sekolah || {};
  const layanan = data?.layanan || {};

  return (
    <div className="min-h-screen bg-slate-50" data-page="aduan-publik">
      <header className="bg-gradient-to-r from-sky-700 via-blue-700 to-indigo-700 px-4 py-6 text-white" data-aduan-header>
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            {sekolah.logo ? <img src={sekolah.logo} alt="" className="h-11 w-11 rounded-xl bg-white/90 object-contain p-1" /> : (
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 ring-1 ring-white/30"><Shield size={22} /></div>
            )}
            <div className="min-w-0">
              <h1 className="text-[18px] font-extrabold leading-tight">Kanal Aduan Kekerasan</h1>
              <p className="text-[12.5px] text-white/85">{sekolah.nama || ''}</p>
            </div>
          </div>
          <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[12.5px] leading-relaxed ring-1 ring-white/20">
            Aduanmu akan dibaca oleh <b>{data.guru?.nama || 'Guru BK'}</b> ({data.guru?.jabatan || 'Guru BK'}).
            Identitasmu hanya dapat dibaca oleh Guru BK yang bersangkutan. Kamu juga bisa melapor langsung di ruang BK.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-5 sm:px-4">
        {sukses ? (
          <div className="card p-6 text-center" data-aduan-sukses>
            <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
            <h2 className="mt-2 text-[17px] font-extrabold text-slate-800">Aduan terkirim</h2>
            <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-slate-600">{sukses.pesan}</p>
            <p className="mt-2 text-[11.5px] text-slate-400">Nomor aduan: #{sukses.id}</p>
            {(sukses.layanan?.keswa || sukses.layanan?.ppa) ? (
              <div className="mt-4 space-y-2 text-left">
                <p className="text-[12px] font-bold text-slate-600">Bila kamu butuh bantuan segera:</p>
                {sukses.layanan.keswa ? (
                  <p className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    <HeartPulse size={15} /> Layanan kesehatan jiwa: <b>{sukses.layanan.keswa}</b>
                  </p>
                ) : null}
                {sukses.layanan.ppa ? (
                  <p className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-[12.5px] text-sky-800">
                    <ShieldCheck size={15} /> Unit PPA: <b>{sukses.layanan.ppa}</b>
                  </p>
                ) : null}
              </div>
            ) : null}
            <button className="btn-ghost mt-5" onClick={() => { setSukses(null); setF(s => ({ ...s, kronologi: '', pelaku: '', lokasi: '' })); }}>
              Kirim aduan lain
            </button>
          </div>
        ) : (
          <form className="card space-y-3 p-4 sm:p-5" onSubmit={kirim} data-form-aduan>
            <h2 className="text-[15px] font-extrabold text-slate-800">Formulir Aduan</h2>
            <p className="text-[12px] text-slate-500">
              Isi data dirimu dengan benar agar aduan dapat ditindaklanjuti. Data yang kamu tulis bersifat rahasia.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <SiswaAutocomplete endpoint={endpointSiswa} value={pilih} onPick={setPilih}
                  label="Nama Lengkap" hint="Ketik minimal 3 huruf nama Anda, lalu pilih dari daftar. Kelas terisi otomatis." />
                {!pilih ? (
                  <label className="mt-2 block">
                    <span className="label">Nama tidak ada di daftar? Tulis manual</span>
                    <input className="input" value={f.nama} onChange={e => setF(s => ({ ...s, nama: e.target.value }))}
                      placeholder="Nama lengkap sesuai data sekolah" data-aduan-nama />
                  </label>
                ) : null}
              </div>
              {!pilih ? (
                <label className="block">
                  <span className="label">Kelas <span className="text-rose-500">*</span></span>
                  <select className="input" required value={f.kelas_id} onChange={e => setF(s => ({ ...s, kelas_id: e.target.value }))} data-aduan-kelas>
                    <option value="">— pilih kelas —</option>
                    {(data.kelas || []).map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
                  </select>
                </label>
              ) : (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-sky-700">Kelas (otomatis)</p>
                  <p className="text-[12.5px] font-semibold text-sky-900" data-aduan-kelas-auto>{pilih?.kelas_nama || '-'}</p>
                </div>
              )}
              <label className="block">
                <span className="label">Tanggal Lahir <span className="text-rose-500">*</span></span>
                <input type="date" className="input" required value={f.tanggal_lahir} onChange={e => setF(s => ({ ...s, tanggal_lahir: e.target.value }))} data-aduan-dob />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">Jenis Kekerasan <span className="text-rose-500">*</span></span>
                <select className="input" required value={f.jenis} onChange={e => setF(s => ({ ...s, jenis: e.target.value }))} data-aduan-jenis>
                  {(data.jenis || []).map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Lokasi Kejadian</span>
                <input className="input" value={f.lokasi} onChange={e => setF(s => ({ ...s, lokasi: e.target.value }))} placeholder="Kelas, kantin, gerbang…" />
              </label>
              <label className="block">
                <span className="label">Dugaan Pelaku (opsional)</span>
                <input className="input" value={f.pelaku} onChange={e => setF(s => ({ ...s, pelaku: e.target.value }))} placeholder="Nama/kelas bila diketahui" />
              </label>
            </div>
            <label className="block">
              <span className="label">Ceritakan Kejadian <span className="text-rose-500">*</span></span>
              <textarea className="input" rows={5} required value={f.kronologi} onChange={e => setF(s => ({ ...s, kronologi: e.target.value }))}
                placeholder="Apa yang terjadi, kapan, siapa yang terlibat, dan bagaimana perasaanmu…" data-aduan-kronologi />
              <span className="mt-1 block text-[11px] text-slate-400">Minimal 20 karakter. Tulis sedetail mungkin agar mudah ditindaklanjuti.</span>
            </label>
            <label className="block">
              <span className="label">Nomor HP / Kontak (opsional)</span>
              <input className="input" value={f.kontak} onChange={e => setF(s => ({ ...s, kontak: e.target.value }))} placeholder="Agar Guru BK bisa menghubungimu" />
            </label>
            {err ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{err}</p> : null}
            <button className="btn-primary w-full justify-center py-2.5" disabled={busy} data-kirim-aduan>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Kirim Aduan
            </button>
            <p className="text-center text-[11px] text-slate-400">
              Bila kamu dalam bahaya, segera hubungi Guru BK, orang tua, atau layanan darurat setempat.
            </p>
          </form>
        )}

        {(layanan.keswa || layanan.ppa) ? (
          <div className="card mt-4 p-4">
            <h3 className="text-[13px] font-extrabold text-slate-800">Nomor Layanan Bantuan</h3>
            <div className="mt-2 space-y-1.5 text-[12.5px]">
              {layanan.keswa ? <p className="flex items-center gap-2 text-rose-800"><HeartPulse size={14} /> Layanan kesehatan jiwa: <b>{layanan.keswa}</b></p> : null}
              {layanan.ppa ? <p className="flex items-center gap-2 text-sky-800"><ShieldCheck size={14} /> Unit PPA setempat: <b>{layanan.ppa}</b></p> : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
