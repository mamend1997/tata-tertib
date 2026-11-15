import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Award, CalendarDays, CheckCircle2, ClipboardList, GraduationCap, Info, Loader2, Printer,
  ScanLine, Search, ShieldAlert, ShieldCheck, TriangleAlert, UserRound, XCircle
} from 'lucide-react';
import { api, tgl, tglPendek } from '../api';
import { Alert, Empty, StatusBadge, cx } from '../ui';
import { applyTheme } from '../theme';
import { applyBrandingHead } from '../branding';
import { slugFromLocation, setSekolahKode } from '../portalurl';

export default function Portal() {
  const [cfg, setCfg] = useState(null);
  const [galat, setGalat] = useState('');            // portal tidak ditemukan / nonaktif
  const [form, setForm] = useState({ nama: '', tanggal_lahir: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const slug = slugFromLocation();

  /* Portal publik per sekolah: alamat /<slug-sekolah>/portal-siswa.
     Slug di URL menentukan sekolah yang datanya dibaca (header X-Sekolah-Kode). */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) {
        if (alive) setGalat('Alamat portal tidak dikenali. Gunakan tautan resmi dari sekolah.');
        return;
      }
      try {
        const r = await api('/api/public/portal/' + encodeURIComponent(slug));
        if (!alive) return;
        setSekolahKode(r.sekolah.kode);
        const c = await api('/api/public/config?slug=' + encodeURIComponent(slug));
        if (!alive) return;
        setCfg(c);
        applyTheme(c, { skipTitle: true });
        applyBrandingHead({ app_nama: c.app_nama, version: c.branding_version }, {
          title: `${c.portal_judul || 'Portal Siswa'} · ${c.sekolah_nama || ''}`
        });
      } catch (e) {
        if (!alive) return;
        setSekolahKode('');
        setGalat(e.message || 'Portal sekolah tidak ditemukan.');
        setCfg({});
      }
    })();
    return () => { alive = false; setSekolahKode(''); };
  }, [slug]);

  useEffect(() => {
    document.body.classList.add('app-bg');
    return () => document.body.classList.remove('app-bg');
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/api/public/check', { method: 'POST', body: form });
      setResult(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(e2.message);
      setResult(null);
    } finally { setBusy(false); }
  }

  const off = cfg && String(cfg.portal_aktif) === '0';

  /* ---------- portal tidak ditemukan / alamat tidak sah ---------- */
  if (galat && !cfg?.sekolah_nama) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-[460px] p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-orange-50 text-orange-600"><TriangleAlert size={26} /></div>
          <p className="mt-3 text-[34px] font-extrabold leading-none text-orange-600">404</p>
          <h1 className="mt-1 text-[18px] font-extrabold text-slate-800">Portal sekolah tidak ditemukan</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-500">{galat}</p>
          <p className="mt-1 break-all rounded-lg bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-400">
            /{'<slug-sekolah>'}/portal-siswa
          </p>
          <a href={(window.__BASE__ || '') + '/'} className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 py-2.5">
            <ArrowLeft size={15} /> Buka Halaman Masuk
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-14">
      {/* HEADER */}
      <header className="portal-hero text-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3.5">
          {cfg?.app_logo || cfg?.logo ? (
            <img src={cfg.app_logo || cfg.logo} alt="" width="38" height="38" className="h-10 w-10 rounded-xl bg-white/95 object-contain p-1" />
          ) : (
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30"><ShieldCheck size={21} /></div>
          )}
          <div className="min-w-0">
            <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/80">{cfg?.sekolah_nama || 'Sekolah'}</p>
            <h1 className="truncate text-[15px] font-extrabold uppercase leading-tight sm:text-[17px]">{cfg?.app_nama || (window.__BRAND__ && window.__BRAND__.app_nama) || 'Aplikasi'}</h1>
          </div>
          <span className="no-print ml-auto hidden rounded-xl bg-white/15 px-3 py-2 text-[11.5px] font-semibold ring-1 ring-white/25 sm:block">
            Portal Cek Poin Mandiri
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4">
        {!result ? (
          <div className="-mt-5 mb-6 grid gap-5">
            <div className="card overflow-hidden">
              <div className="bg-gradient-to-br from-orange-50 to-amber-50/60 px-5 py-6 sm:px-7">
                <span className="chip !border-orange-200 !bg-white !text-orange-700"><ScanLine size={13} /> Portal Cek Poin Mandiri</span>
                <h2 className="mt-3 text-[21px] font-extrabold leading-snug text-slate-800 sm:text-[24px]">
                  {cfg?.portal_judul || 'Cek Poin Kedisiplinan Siswa'}
                </h2>
                <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-slate-600">
                  {cfg?.portal_subtitle || 'Masukkan nama lengkap dan tanggal lahir untuk melihat rekap poin, prestasi, dan riwayat kejadian.'}
                </p>
              </div>
              <form onSubmit={submit} className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-7">
                <div className="sm:col-span-2">
                  <label className="label">Nama Lengkap Siswa</label>
                  <div className="relative">
                    <UserRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-9" placeholder="Tulis nama lengkap sesuai data sekolah" value={form.nama}
                      onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} required />
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="label">Tanggal Lahir</label>
                  <input type="date" className="input" value={form.tanggal_lahir}
                    onChange={e => setForm(f => ({ ...f, tanggal_lahir: e.target.value }))} required />
                  <p className="mt-1 text-[11.5px] text-slate-400">Gunakan tanggal lahir yang terdaftar di sekolah.</p>
                </div>
                <div className="flex flex-col justify-between gap-2">
                  <span className="hidden text-[11.5px] text-slate-400 sm:block">Data poin bersifat pribadi — pastikan nama &amp; tanggal lahir benar.</span>
                  <button type="submit" disabled={busy || off} className="btn-primary w-full py-2.5 text-[14px]">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {busy ? 'Memeriksa…' : 'Lihat Poin'}
                  </button>
                </div>
              </form>
            </div>

            {off ? <Alert tone="warn" title="Portal sedang dinonaktifkan">Sekolah menonaktifkan portal cek poin publik. Silakan hubungi wali kelas atau guru BK.</Alert> : null}
            {err ? <Alert tone="danger" title="Data tidak ditemukan">{err}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: ClipboardList, t: 'Rekap Poin', d: 'Total pelanggaran, prestasi, dan poin bersih.' },
                { icon: ShieldAlert, t: 'Status Disiplin', d: 'Aman · Pantau · Perhatian · Kritis · Siaga · Waspada.' },
                { icon: CalendarDays, t: 'Riwayat Kejadian', d: 'Seluruh catatan kejadian ditampilkan transparan.' }
              ].map((f, i) => (
                <div key={i} className="card flex h-full flex-col items-start gap-2 p-4">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-orange-500"><f.icon size={17} /></span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-800">{f.t}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
            {cfg?.sekolah_alamat ? (
              <div className="card flex flex-col items-center gap-1 px-4 py-3 text-center text-[11.5px] text-slate-500 sm:flex-row sm:justify-center sm:gap-2">
                <span className="font-semibold text-slate-600">{cfg.sekolah_nama}</span>
                <span className="hidden sm:inline">•</span>
                <span>{cfg.sekolah_alamat}</span>
                {cfg.sekolah_telp ? <><span className="hidden sm:inline">•</span><span>{cfg.sekolah_telp}</span></> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <Hasil data={result} onBack={() => { setResult(null); setErr(''); }} />
        )}
      </main>
    </div>
  );
}

function Hasil({ data, onBack }) {
  const s = data.siswa;
  const rules = data.rules || [];
  const maxPoin = Math.max(100, ...rules.map(r => Number(r.max) || 0), s.bersih + 10);
  const pct = Math.min(100, Math.round((Math.max(0, s.bersih) / maxPoin) * 100));
  const kat = data.peringkat || [];
  const pel = kat.filter(k => k.jenis === 'pelanggaran');
  const pres = kat.filter(k => k.jenis === 'prestasi');
  const tone = String(s.status.label).toLowerCase();

  return (
    <div className="-mt-5 mb-8 space-y-5 print-area">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="btn-ghost"><ArrowLeft size={15} /> Cek siswa lain</button>
        <button onClick={() => window.print()} className="btn-primary"><Printer size={15} /> Cetak / Simpan PDF</button>
      </div>

      {/* identitas */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 bg-gradient-to-br from-orange-50 to-amber-50/40 px-5 py-5">
          <div className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-soft" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-700))' }}>
            <GraduationCap size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Rekap Kedisiplinan Siswa</p>
            <h2 className="truncate text-[20px] font-extrabold leading-tight text-slate-800">{s.nama}</h2>
            <p className="mt-0.5 text-[12.5px] text-slate-600">
              Kelas <b>{s.kelas || '-'}</b> · NIS {s.nis || '-'} · NISN {s.nisn || '-'} · {s.gender === 'P' ? 'Perempuan' : 'Laki-laki'}
            </p>
            <p className="text-[11.5px] text-slate-500">Wali Kelas: {s.wali_nama || '-'} · TTL: {tgl(s.tanggal_lahir)}</p>
          </div>
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status Disiplin</p>
            <div className="mt-1 scale-110"><StatusBadge label={s.status.label} /></div>
          </div>
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
          <Ringkasan label="Poin Pelanggaran" value={s.pel} tone="rose" icon={TriangleAlert} />
          <Ringkasan label="Poin Prestasi" value={s.pres} tone="violet" icon={Award} />
          <Ringkasan label="Poin Bersih" value={s.bersih} tone="emerald" icon={CheckCircle2} />
        </div>

        {/* skala status */}
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-[11.5px] font-semibold text-slate-500">
            <span>Skala Status Disiplin</span><span>{Math.max(0, s.bersih)} / {maxPoin} poin</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={cx('h-full rounded-full transition-all',
              tone === 'aman' && 'bg-emerald-500', tone === 'pantau' && 'bg-sky-500', tone === 'perhatian' && 'bg-amber-500',
              tone === 'kritis' && 'bg-orange-500', tone === 'siaga' && 'bg-rose-500', tone === 'waspada' && 'bg-red-600')}
              style={{ width: Math.max(3, pct) + '%' }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rules.map(r => (
              <span key={r.label} className={cx('rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                r.label === s.status.label ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' : 'bg-slate-100 text-slate-500')}>
                {r.label} {r.max === null || r.max === undefined ? `≥${r.min}` : `${r.min}–${r.max}`}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card">
          <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <TriangleAlert size={16} className="text-rose-500" />
            <h3 className="section-title">Rincian Pelanggaran</h3>
            <span className="ml-auto chip !border-rose-200 !text-rose-600">{s.pel} poin</span>
          </header>
          <div className="p-4">
            {pel.length ? (
              <ul className="space-y-2">
                {pel.map((k, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-slate-700">{k.nama}</p>
                      <p className="text-[11px] text-slate-400">{k.jumlah}× kejadian · {k.poin} poin/kejadian</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-rose-50 px-2 py-1 text-[11.5px] font-bold text-rose-600">{k.poin * k.jumlah}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={CheckCircle2} title="Tidak ada pelanggaran" desc="Terus pertahankan kedisiplinanmu." />}
          </div>
        </div>

        <div className="card">
          <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Award size={16} className="text-violet-500" />
            <h3 className="section-title">Rincian Prestasi</h3>
            <span className="ml-auto chip !border-violet-200 !text-violet-600">{s.pres} poin</span>
          </header>
          <div className="p-4">
            {pres.length ? (
              <ul className="space-y-2">
                {pres.map((k, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-slate-700">{k.nama}</p>
                      <p className="text-[11px] text-slate-400">{k.jumlah}× pencapaian · {k.poin} poin</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-violet-50 px-2 py-1 text-[11.5px] font-bold text-violet-600">{k.poin * k.jumlah}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={Award} title="Belum ada catatan prestasi" desc="Prestasi yang dicatat akan menambah poin positif." />}
          </div>
        </div>
      </div>

      {/* riwayat */}
      <div className="card overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <ClipboardList size={16} className="text-orange-500" />
          <h3 className="section-title">Riwayat Log Kejadian</h3>
          <span className="ml-auto text-[11.5px] text-slate-500">{data.riwayat.length} catatan</span>
        </header>
        <div className="tbl-wrap !border-0">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10 text-center">No</th><th>Tanggal</th><th>Kejadian</th><th className="hidden sm:table-cell">Keterangan</th>
                <th className="w-24">Jenis</th><th className="w-16 text-center">Poin</th>
              </tr>
            </thead>
            <tbody>
              {data.riwayat.map((r, i) => (
                <tr key={r.id}>
                  <td className="text-center text-slate-400">{i + 1}</td>
                  <td className="whitespace-nowrap">{tglPendek(r.tanggal)}</td>
                  <td>
                    <p className="font-semibold text-slate-700">{r.judul}</p>
                    <p className="text-[11px] text-slate-400">{r.kategori || '-'} · Tahun Pelajaran {r.ta_nama || '-'}</p>
                    {r.keterangan ? <p className="mt-0.5 text-[11.5px] text-slate-500 sm:hidden">{r.keterangan}</p> : null}
                  </td>
                  <td className="hidden max-w-[280px] text-[12px] text-slate-500 sm:table-cell">{r.keterangan || '-'}</td>
                  <td>
                    <span className={cx('badge', r.jenis === 'prestasi' ? 'badge-prestasi' : 'badge-siaga')}>
                      {r.jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran'}
                    </span>
                  </td>
                  <td className={cx('text-center font-bold', r.jenis === 'prestasi' ? 'text-violet-600' : 'text-rose-600')}>
                    {r.jenis === 'prestasi' ? '+' : '−'}{r.poin}
                  </td>
                </tr>
              ))}
              {!data.riwayat.length ? (
                <tr><td colSpan="6"><Empty icon={Info} title="Belum ada catatan kejadian" desc="Siswa ini belum memiliki catatan pelanggaran maupun prestasi." /></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* tanda tangan */}
      <div className="card p-5">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="text-center text-[12.5px] text-slate-600">
            <p>Mengetahui,</p>
            <p className="font-semibold">Orang Tua / Wali Murid</p>
            <div className="h-16" />
            <p className="border-t border-dashed border-slate-300 pt-1 font-semibold text-slate-500">………………………………………</p>
          </div>
          <div className="text-center text-[12.5px] text-slate-600">
            <p>{(data.sekolah.tempat ? data.sekolah.tempat + ', ' : '')}{tgl(new Date().toISOString().slice(0, 10))}</p>
            <p className="font-semibold">Wali Kelas {s.kelas || ''}</p>
            <div className="h-16" />
            <p className="border-t border-dashed border-slate-300 pt-1 font-semibold text-slate-500">{s.wali_nama || '………………………………………'}</p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-center text-[11px] text-slate-400">
          Dicetak dari portal {data.sekolah.nama} · {data.sekolah.alamat} · {data.sekolah.telp}
        </p>
      </div>

      <div className="no-print flex flex-wrap justify-center gap-2">
        <button onClick={onBack} className="btn-ghost"><ArrowLeft size={15} /> Kembali</button>
        <button onClick={() => window.print()} className="btn-primary"><Printer size={15} /> Cetak / Simpan PDF</button>
      </div>
    </div>
  );
}

function Ringkasan({ label, value, tone, icon: Icon }) {
  const map = {
    rose: 'border-rose-100 bg-rose-50/70 text-rose-600',
    violet: 'border-violet-100 bg-violet-50/70 text-violet-600',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-600'
  };
  return (
    <div className={cx('flex items-center gap-3 rounded-xl border px-3.5 py-3', map[tone])}>
      <Icon size={20} />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
        <p className="text-[19px] font-extrabold leading-tight text-slate-800">{value}</p>
      </div>
    </div>
  );
}
