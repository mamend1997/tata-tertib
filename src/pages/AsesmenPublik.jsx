import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Send, Sparkles } from 'lucide-react';
import { api } from '../api';
import SiswaAutocomplete from '../components/SiswaAutocomplete';

/* Halaman publik pengisian asesmen BK (satu kali per siswa). */
export default function AsesmenPublik({ token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [siswa, setSiswa] = useState(null);
  const [sudah, setSudah] = useState(null);
  const [jawaban, setJawaban] = useState({});
  const [sukses, setSukses] = useState(null);
  const [pilih, setPilih] = useState(null);          // siswa hasil autocomplete
  const [dob, setDob] = useState('');                // tanggal lahir (verifikasi)
  const endpointSiswa = useCallback(
    (kw) => '/api/public/asesmen/' + encodeURIComponent(token) + '/siswa?q=' + encodeURIComponent(kw),
    [token]);

  useEffect(() => {
    api('/api/public/asesmen/' + encodeURIComponent(token))
      .then(r => setData(r)).catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, [token]);

  const ins = data?.instrumen;
  const soal = data?.soal || [];
  const terjawab = useMemo(() => soal.filter(s => {
    const v = jawaban[s.id];
    return ins?.tipe === 'likert4' ? (Number(v) >= 1 && Number(v) <= 4) : !!v;
  }).length, [soal, jawaban, ins]);

  async function cekIdentitas(ev) {
    ev.preventDefault();
    if (!pilih) return setErr('Pilih nama Anda dari daftar yang muncul setelah mengetik minimal 3 huruf.');
    if (!dob) return setErr('Tanggal lahir wajib diisi untuk verifikasi identitas.');
    setBusy(true); setErr('');
    try {
      const r = await api('/api/public/asesmen/' + encodeURIComponent(token) + '/cek',
        { method: 'POST', body: { siswa_id: pilih.id, tanggal_lahir: dob } });
      if (r.sudah) setSudah(r);
      else setSiswa(r.siswa);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function kirim() {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/public/asesmen/' + encodeURIComponent(token), {
        method: 'POST', body: { siswa_id: pilih?.id, tanggal_lahir: dob, jawaban }
      });
      setSukses(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-100"><Loader2 size={26} className="animate-spin text-blue-600" /></div>;
  if (!data && err) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 px-4">
        <div className="card max-w-md p-6 text-center">
          <AlertTriangle size={30} className="mx-auto text-rose-500" />
          <h1 className="mt-2 text-[16px] font-extrabold text-slate-800">Tautan tidak berlaku</h1>
          <p className="mt-1 text-[13px] text-slate-500">{err}</p>
        </div>
      </div>
    );
  }

  const sekolah = data?.sekolah || {};

  return (
    <div className="min-h-screen bg-slate-100 pb-20" data-page="asesmen-publik">
      <header className="bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-600 px-4 py-5 text-white" data-asesmen-header>
        <div className="mx-auto max-w-3xl">
          <h1 className="text-[19px] font-extrabold leading-tight">{ins?.nama}</h1>
          <p className="text-[12.5px] text-white/85">{sekolah.nama || ''}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-4 sm:px-4">
        {sukses ? (
          <div className="card p-6 text-center" data-asesmen-sukses>
            <CheckCircle2 size={42} className="mx-auto text-emerald-500" />
            <h2 className="mt-2 text-[17px] font-extrabold text-slate-800">Jawaban tersimpan</h2>
            <p className="mt-1 text-[13px] text-slate-600">{sukses.pesan}</p>
            {sukses.ringkas ? (
              <div className="mx-auto mt-4 max-w-md rounded-xl border border-blue-200 bg-blue-50 p-3 text-left">
                <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Ringkasan hasil Anda</p>
                <p className="mt-1 text-[15px] font-extrabold text-blue-900">{sukses.ringkas.label || sukses.ringkas.utama}</p>
                {sukses.ringkas.rekomendasi ? <p className="mt-1 text-[12px] leading-relaxed text-blue-900/80">{sukses.ringkas.rekomendasi}</p> : null}
              </div>
            ) : null}
            <p className="mt-4 text-[11.5px] text-slate-400">Halaman ini boleh ditutup. Terima kasih sudah jujur mengisi.</p>
          </div>
        ) : sudah ? (
          <div className="card p-6" data-asesmen-sudah>
            <div className="flex items-start gap-3">
              <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-emerald-500" />
              <div>
                <h2 className="text-[15px] font-extrabold text-slate-800">Kamu sudah pernah mengisi</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{sudah.pesan}</p>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12.5px]">
                  <p><b>{sudah.siswa?.nama}</b> · {sudah.siswa?.kelas || '-'}</p>
                  <p className="mt-1">Tanggal pengisian: <b>{sudah.hasil?.tanggal}</b></p>
                  {sudah.hasil?.ringkas ? (
                    <p className="mt-1">Hasil: <b>{sudah.hasil.ringkas.label || sudah.hasil.ringkas.utama}</b>
                      {sudah.hasil.ringkas.rekomendasi ? <span className="block text-slate-500">{sudah.hasil.ringkas.rekomendasi}</span> : null}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : !siswa ? (
          <form className="card space-y-3 p-5" onSubmit={cekIdentitas} data-identitas-asesmen>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-blue-900">
              {ins?.petunjuk}
            </div>
            <h2 className="text-[15px] font-extrabold text-slate-800">Verifikasi Identitas</h2>
            <p className="text-[12px] text-slate-500">
              Ketik nama Anda (minimal 3 huruf) lalu pilih dari daftar, kemudian isi tanggal lahir.
              Setiap siswa hanya dapat mengisi asesmen ini <b>satu kali</b>.
            </p>
            <SiswaAutocomplete endpoint={endpointSiswa} value={pilih} onPick={setPilih}
              label="Nama Siswa" hint="Daftar nama muncul otomatis setelah 3 huruf. Kelas terisi otomatis." />
            <label className="block">
              <span className="label">Tanggal Lahir <span className="text-rose-500">*</span></span>
              <input type="date" className="input" required value={dob} disabled={!pilih}
                onChange={e => setDob(e.target.value)} data-asesmen-dob />
              <span className="mt-1 block text-[11px] text-slate-400">Dipakai untuk memastikan benar ini data Anda.</span>
            </label>
            {err ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{err}</p> : null}
            <button className="btn-primary w-full justify-center py-2.5" disabled={busy} data-cek-identitas>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />} Lanjut ke Asesmen
            </button>
          </form>
        ) : (
          <>
            <div className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge badge-aman">Terverifikasi</span>
                <b className="text-[13px] text-slate-800">{siswa.nama}</b>
                <span className="text-[12px] text-slate-500">{siswa.kelas}</span>
                <button className="btn-ghost btn-sm ml-auto" onClick={() => { setSiswa(null); setJawaban({}); setPilih(null); setDob(''); }}><ArrowLeft size={13} /> Ganti</button>
              </div>
              <p className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] leading-relaxed text-blue-900">
                {ins?.petunjuk}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[11.5px] font-semibold text-slate-500">
                <span>{soal.length} pernyataan</span>
                <span className="ml-auto text-blue-700">{terjawab} dijawab</span>
              </div>
            </div>

            <div className="mt-3 space-y-2.5" data-daftar-soal>
              {soal.map((s, i) => (
                <div key={s.id} className="card p-3.5" data-soal={s.id}>
                  <div className="flex gap-2.5">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11.5px] font-extrabold text-slate-600">{i + 1}</span>
                    <p className="min-w-0 flex-1 text-[12.8px] leading-relaxed text-slate-700">{s.teks}</p>
                  </div>
                  {ins?.tipe === 'likert4' ? (
                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {[
                        { v: 1, l: 'Sangat Tidak Perlu' }, { v: 2, l: 'Tidak Perlu' },
                        { v: 3, l: 'Perlu' }, { v: 4, l: 'Sangat Perlu' }
                      ].map(o => (
                        <label key={o.v} className={
                          `flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition ` +
                          (Number(jawaban[s.id]) === o.v ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300')
                        }>
                          <input type="radio" className="h-3.5 w-3.5 accent-blue-600" name={'soal-' + s.id} value={o.v}
                            checked={Number(jawaban[s.id]) === o.v}
                            onChange={() => setJawaban(j => ({ ...j, [s.id]: o.v }))} />
                          {o.l}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <label className={
                      `mt-2 flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px] font-semibold transition ` +
                      (jawaban[s.id] ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300')
                    }>
                      <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={!!jawaban[s.id]}
                        onChange={e => setJawaban(j => ({ ...j, [s.id]: e.target.checked ? 1 : 0 }))} />
                      Saya setuju / mengalami hal ini
                    </label>
                  )}
                </div>
              ))}
            </div>

            {err ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{err}</p> : null}

            <p className="mt-3 text-center text-[11px] text-slate-400">
              Tidak apa-apa bila hanya sedikit yang kamu centang — isi sesuai dirimu yang sebenarnya.
            </p>
          </>
        )}
      </main>

      {siswa && !sukses ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="text-[11.5px] font-semibold text-slate-500">{terjawab}/{soal.length} dijawab</span>
            <button className="btn-primary flex-1 justify-center py-2.5" onClick={kirim} disabled={busy} data-kirim-asesmen>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Kirim Jawaban
            </button>
          </div>
        </div>
      ) : null}

      <footer className="mx-auto mt-6 max-w-3xl px-4 pb-6 text-center text-[10.5px] text-slate-400">
        <Sparkles size={11} className="mr-1 inline" /> Asesmen Bimbingan Konseling · {sekolah.nama || ''}
      </footer>
    </div>
  );
}
