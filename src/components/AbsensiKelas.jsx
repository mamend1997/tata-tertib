import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, Loader2, Save, Search, UserCheck, Users, X } from 'lucide-react';
import { cx } from '../ui';

/* =====================================================================
   Editor absensi siswa per kelas/mapel — dipakai dua tempat:
   · panel guru/wali kelas (AbsensiSiswa.jsx)  → mode="guru"  (tanpa kolom nama pencatat;
     identitas pencatat diambil OTOMATIS dari akun guru yang login di server)
   · halaman tautan/QR ketua kelas (PresensiSiswa.jsx) → mode="publik"
     (kolom verifikasi nama siswa + tombol Simpan sejajar dalam satu grid)
   ===================================================================== */
const STATUS = [
  { key: 'H', label: 'Hadir', cls: 'hadir' },
  { key: 'S', label: 'Sakit', cls: 'sakit' },
  { key: 'I', label: 'Izin', cls: 'izin' },
  { key: 'A', label: 'Alpha', cls: 'alpha' },
  { key: 'B', label: 'Bolos', cls: 'bolos' }
];
const BTN = {
  hadir: 'bg-emerald-500 border-emerald-500 text-white',
  sakit: 'bg-amber-500 border-amber-500 text-white',
  izin: 'bg-sky-500 border-sky-500 text-white',
  alpha: 'bg-rose-500 border-rose-500 text-white',
  bolos: 'bg-red-700 border-red-700 text-white'
};
const BTN_SOFT = {
  hadir: 'hover:border-emerald-400 hover:text-emerald-600',
  sakit: 'hover:border-amber-400 hover:text-amber-600',
  izin: 'hover:border-sky-400 hover:text-sky-600',
  alpha: 'hover:border-rose-400 hover:text-rose-600',
  bolos: 'hover:border-red-500 hover:text-red-700'
};

export default function AbsensiKelas({ detail, simpan, readOnly, tglLabel, mode = 'guru', user }) {
  const [nilai, setNilai] = useState({});
  const [pencatat, setPencatat] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [cari, setCari] = useState('');

  useEffect(() => {
    const map = {};
    for (const s of (detail?.siswa || [])) map[s.id] = { status: s.status || 'H', keterangan: s.keterangan || '' };
    setNilai(map);
    setPencatat(detail?.sesi?.pencatat || '');
    setErr(''); setOkMsg('');
  }, [detail?.sesi?.id, detail?.tanggal]);

  const siswa = detail?.siswa || [];
  /* filter cepat nama siswa (real-time) — daftar kelas bisa panjang */
  const tampil = useMemo(() => {
    const kw = cari.trim().toLowerCase();
    if (!kw) return siswa;
    return siswa.filter(s => (s.nama || '').toLowerCase().includes(kw));
  }, [siswa, cari]);
  const setStatus = (id, status) => setNilai(v => ({ ...v, [id]: { ...(v[id] || {}), status } }));
  const setKet = (id, keterangan) => setNilai(v => ({ ...v, [id]: { ...(v[id] || {}), keterangan } }));
  const massal = (status) => {
    setNilai(v => {
      const out = { ...v };
      for (const s of siswa) out[s.id] = { status, keterangan: status === 'H' ? '' : (out[s.id]?.keterangan || '') };
      return out;
    });
  };
  const ringkas = useMemo(() => {
    const r = { H: 0, S: 0, I: 0, A: 0, B: 0 };
    for (const s of siswa) {
      const st = (nilai[s.id] || {}).status || 'H';
      r[st] = (r[st] || 0) + 1;
    }
    return r;
  }, [nilai, siswa]);

  async function submit(e) {
    e && e.preventDefault();
    setBusy(true); setErr(''); setOkMsg('');
    try {
      const items = siswa.map(s => ({
        siswa_id: s.id,
        status: (nilai[s.id] || {}).status || 'H',
        keterangan: (nilai[s.id] || {}).keterangan || ''
      }));
      /* panel guru: server memakai akun login; publik: nama siswa terverifikasi */
      const r = await simpan(mode === 'guru' ? { items } : { items, pencatat });
      const poin = r?.poin || {};
      const infoPoin = (poin.dibuat || poin.diperbarui || poin.dihapus)
        ? ` Buku Poin: ${poin.dibuat || 0} catatan baru, ${poin.diperbarui || 0} diperbarui${poin.dihapus ? `, ${poin.dihapus} dibatalkan` : ''}.`
        : '';
      setOkMsg((r?.pesan || 'Presensi tersimpan.') + infoPoin);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  const kelasNama = (detail?.kelas || []).map(k => k.nama).join(' + ');
  return (
    <form onSubmit={submit} className="space-y-3" data-absensi-kelas>
      <div className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50/60 p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600">Absensi Siswa per Mata Pelajaran</p>
        <h3 className="mt-1 text-[18px] font-extrabold leading-tight text-slate-800">{kelasNama || '-'}</h3>
        <p className="mt-1 text-[12.5px] font-semibold text-slate-600">
          {detail?.mapel?.nama} · {detail?.jadwal?.hari_label} {detail?.jadwal?.jam}
          {detail?.guru?.nama ? ` · ${detail.guru.nama}` : ''}
        </p>
        <p className="text-[11.5px] text-slate-500">{tglLabel || detail?.tanggal_label} · {siswa.length} siswa</p>

        {/* tombol status cepat massal */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] font-semibold text-slate-500">Set semua:</span>
          {STATUS.map(s => (
            <button type="button" key={s.key} disabled={readOnly} onClick={() => massal(s.key)}
              title={`Tandai semua siswa: ${s.label}`} data-mass={s.key}
              className={cx('grid h-8 w-8 place-items-center rounded-lg border text-[12px] font-extrabold transition',
                BTN[s.cls], 'opacity-90 hover:opacity-100 disabled:opacity-40')}>
              {s.key}
            </button>
          ))}
          <span className="ml-auto flex flex-wrap gap-1 text-[11px] text-slate-500">
            <b className="text-emerald-600">H {ringkas.H}</b> · <b className="text-amber-600">S {ringkas.S}</b> ·
            <b className="text-sky-600">I {ringkas.I}</b> · <b className="text-rose-600">A {ringkas.A}</b> ·
            <b className="text-red-700">B {ringkas.B}</b>
          </span>
        </div>
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700" data-err>{err}</div> : null}
      {okMsg ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-700" data-ok>
        <CheckCircle2 size={14} /> {okMsg}
      </div> : null}

      {siswa.length > 4 ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search size={14} className="shrink-0 text-slate-400" />
          <input className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-slate-700 outline-none"
            value={cari} onChange={e => setCari(e.target.value)}
            placeholder="Cari nama siswa… (filter cepat tanpa scroll)" data-cari-siswa />
          {cari ? (
            <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={() => setCari('')} aria-label="Bersihkan pencarian">
              <X size={13} />
            </button>
          ) : null}
          <span className="shrink-0 text-[11px] font-semibold text-slate-400">{tampil.length}/{siswa.length}</span>
        </div>
      ) : null}

      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {!siswa.length ? (
          <div className="flex flex-col items-center gap-1 py-10 text-slate-400">
            <Users size={22} /><p className="text-[12.5px]">Belum ada siswa aktif di kelas ini.</p>
          </div>
        ) : !tampil.length ? (
          <div className="py-8 text-center text-[12.5px] text-slate-400">Tidak ada nama siswa yang cocok dengan “{cari}”.</div>
        ) : tampil.map((s) => {
          const v = nilai[s.id] || { status: 'H', keterangan: '' };
          const i = siswa.findIndex(x => x.id === s.id);
          return (
            <div key={s.id} className="px-3 py-2.5" data-siswa={s.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 shrink-0 text-right text-[12px] font-bold text-slate-400">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-800">{s.nama}</span>
                <div className="flex shrink-0 gap-1">
                  {STATUS.map(st => (
                    <button type="button" key={st.key} disabled={readOnly}
                      onClick={() => setStatus(s.id, st.key)}
                      title={st.label} data-status={st.key}
                      className={cx('grid h-8 w-8 place-items-center rounded-lg border text-[12px] font-extrabold transition',
                        v.status === st.key ? BTN[st.cls] : cx('border-slate-200 bg-white text-slate-400', BTN_SOFT[st.cls]))}>
                      {st.key}
                    </button>
                  ))}
                </div>
              </div>
              {v.status !== 'H' ? (
                <input className="input mt-1.5 !py-1.5 !text-[12px] sm:ml-8"
                  value={v.keterangan} disabled={readOnly} maxLength={240}
                  placeholder={`Keterangan ${STATUS.find(x => x.key === v.status)?.label || ''} (opsional)…`}
                  onChange={e => setKet(s.id, e.target.value)} data-keterangan={s.id} />
              ) : null}
            </div>
          );
        })}
      </div>

      <datalist id="daftarSiswaKelas">
        {siswa.map(s => <option key={s.id} value={s.nama} />)}
      </datalist>

      {readOnly ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] font-semibold text-amber-900" data-terkunci>
          <Lock size={15} className="mt-0.5 shrink-0" />
          <span>
            {detail?.window?.keterangan || 'Sesi absensi sudah ditutup — data tidak dapat diubah lagi.'}
            <span className="mt-0.5 block font-normal">Rekap tetap dapat dilihat; hubungi Wakasek Kurikulum bila memerlukan koreksi resmi.</span>
          </span>
        </div>
      ) : null}

      {mode === 'guru' ? (
        /* ---- PANEL GURU: tanpa kolom nama pencatat (otomatis dari akun login) ---- */
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800">
            <UserCheck size={14} className="shrink-0" />
            <span>
              Dicatat otomatis atas nama <b>{user?.nama || 'guru yang login'}</b>
              {user?.role_label ? <span className="font-normal"> · {user.role_label}</span> : null}
            </span>
          </div>
          <button className="btn w-full justify-center px-5 py-2.5 text-white shadow-soft sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%)' }}
            disabled={busy || readOnly} data-simpan-presensi>
            {busy ? <Loader2 size={16} className="animate-spin" /> : (readOnly ? <Lock size={16} /> : <Save size={16} />)}
            {readOnly ? 'Sesi Ditutup' : 'Simpan Absensi'}
          </button>
        </div>
      ) : (
        /* ---- HALAMAN PUBLIK: verifikasi nama siswa + tombol sejajar dalam SATU grid ---- */
        <div className="grid grid-cols-1 items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          data-footer-publik>
          <label className="block min-w-0">
            <span className="label">Verifikasi Nama Pencatat (Ketua Kelas) <span className="text-rose-500">*</span></span>
            <input className="input w-full min-w-0" value={pencatat} required minLength={3} disabled={readOnly}
              list="daftarSiswaKelas" autoComplete="off"
              onChange={e => setPencatat(e.target.value)}
              placeholder="Ketik nama Anda (harus terdaftar di kelas ini)…"
              data-pencatat />
            <span className="mt-1 block text-[11px] text-slate-400">
              Nama wajib sesuai data siswa kelas ini sebagai bukti siapa yang merekap. Satu siswa hanya dapat mengisi satu kali per sesi.
            </span>
          </label>
          <button className="btn w-full justify-center px-5 py-2.5 text-white shadow-soft sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%)' }}
            disabled={busy || readOnly} data-simpan-presensi>
            {busy ? <Loader2 size={16} className="animate-spin" /> : (readOnly ? <Lock size={16} /> : <Save size={16} />)}
            {readOnly ? 'Sesi Ditutup' : 'Simpan'}
          </button>
        </div>
      )}
    </form>
  );
}
