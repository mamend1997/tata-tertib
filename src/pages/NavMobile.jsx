import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, Eye, Loader2, RotateCcw, Save, Smartphone, Star, X
} from 'lucide-react';
import { api } from '../api';
import { Alert, Card, Field, Spinner, cx, useToast } from '../ui';

/* =====================================================================
   PENGATURAN NAVIGASI BAWAH (BOTTOM NAV) PER ROLE — khusus Administrator.
   Mengatur menu mana yang tampil sebagai tombol navigasi bawah pada ponsel,
   beserta urutannya. Menu desktop (sidebar) TIDAK terpengaruh.
   Tombol posisi tengah ditandai sebagai fokus utama (highlight).
   ===================================================================== */
export default function NavMobile({ ctx }) {
  const { can, toast } = ctx;
  const bolehUbah = can('nav_mobile', 'write');
  const [d, setD] = useState(null);
  const [role, setRole] = useState('guru');
  const [cfg, setCfg] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/nav-mobile')
      .then(r => { setD(r); setCfg(r.config || {}); })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const daftar = cfg[role] || [];
  const navInfo = useMemo(() => {
    const m = new Map();
    for (const n of (d?.nav || [])) m.set(n.key, n);
    return m;
  }, [d]);

  const ubah = (keys) => setCfg(v => ({ ...v, [role]: keys }));
  const tambah = (key) => {
    if (daftar.includes(key)) return ubah(daftar.filter(k => k !== key));
    if (daftar.length >= (d?.max || 5)) return toast.err(`Maksimal ${d?.max || 5} tombol navigasi bawah.`);
    ubah([...daftar, key]);
  };
  const geser = (key, arah) => {
    const i = daftar.indexOf(key);
    const j = i + arah;
    if (i < 0 || j < 0 || j >= daftar.length) return;
    const next = daftar.slice();
    [next[i], next[j]] = [next[j], next[i]];
    ubah(next);
  };
  async function simpan() {
    setBusy(true);
    try {
      const r = await api('/api/nav-mobile', { method: 'POST', body: { role, keys: daftar } });
      toast.ok(r.pesan || 'Navigasi bawah disimpan.');
      setCfg(r.config || cfg);
      if (ctx.reloadBoot) ctx.reloadBoot();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true);
    try {
      const r = await api('/api/nav-mobile/reset', { method: 'POST', body: { role } });
      toast.ok(r.pesan || 'Dikembalikan ke bawaan.');
      setCfg(r.config || cfg);
      if (ctx.reloadBoot) ctx.reloadBoot();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  if (loading && !d) return <Spinner label="Memuat pengaturan navigasi…" />;
  if (!d) return <Alert tone="warn" title="Pengaturan tidak tersedia">Muat ulang halaman ini.</Alert>;

  const tengah = Math.floor(daftar.length / 2);
  const grupList = [...new Set((d.nav || []).map(n => {
    const f = (d.features || []).find(x => x.key === n.key);
    return f ? f.grup : 'Lainnya';
  }))];

  return (
    <div className="space-y-4" data-page="nav-mobile">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Navigasi Mobile &amp; Menu Role</h2>
        <p className="text-[12.5px] text-slate-500">
          Atur tombol navigasi bawah (khusus <b>tampilan ponsel</b>) untuk setiap role. Tampilan desktop tidak berubah —
          menu lengkap tetap tersedia lewat tombol garis tiga di kanan atas. Hak akses menu tetap mengikuti
          <b> Permission Matrix</b>; menu yang tidak diizinkan otomatis tidak tampil.
        </p>
      </div>

      <Card title="Menu Utama (Sidebar) & Hak Akses"
        subtitle="Selain navigasi bawah, lengkapi pengaturan tampilan menu utama di dua tempat berikut">
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => ctx.setPage('pengaturan')}
            className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-left transition hover:border-orange-300 hover:bg-orange-50/60"
            data-nav-ke-pengaturan>
            <span className="block text-[12.5px] font-bold text-slate-800">Pengaturan → Tampilan &amp; Urutan Menu</span>
            <span className="block text-[11px] text-slate-500">Ubah judul, urutan, dan sembunyikan menu utama (berlaku untuk semua role).</span>
          </button>
          <button type="button" onClick={() => ctx.setPage('pengguna')}
            className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-left transition hover:border-orange-300 hover:bg-orange-50/60"
            data-nav-ke-pengguna>
            <span className="block text-[12.5px] font-bold text-slate-800">Permission Matrix per Role</span>
            <span className="block text-[11px] text-slate-500">Tentukan menu yang boleh dilihat / diisi oleh setiap role (Guru Mapel, Wali Kelas, Guru BK, dll.).</span>
          </button>
        </div>
      </Card>

      <Card title="Pilih Role" subtitle="Susunan tombol dapat berbeda untuk tiap role">
        <div className="flex flex-wrap gap-1.5">
          {d.roles.map(r => (
            <button key={r.key} type="button" onClick={() => setRole(r.key)}
              className={cx('chip transition', role === r.key
                ? '!border-orange-400 !bg-orange-500 !text-white' : 'hover:!border-orange-300')}
              data-nav-role={r.key}>
              {r.label}
              <span className={cx('ml-1.5 rounded-full px-1.5 text-[10.5px] font-bold',
                role === r.key ? 'bg-white/25' : 'bg-slate-100 text-slate-500')}>
                {(cfg[r.key] || []).length}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Susunan Tombol Navigasi Bawah"
          subtitle="Urutan kiri → kanan. Tombol tepat di tengah ditandai bintang sebagai fokus utama."
          right={<span className="chip"><Smartphone size={12} /> {daftar.length}/{d.max}</span>}>
          {!daftar.length ? (
            <p className="text-[12.5px] text-slate-500">Belum ada tombol — pilih menu di panel sebelah.</p>
          ) : (
            <ol className="space-y-2" data-nav-terpilih>
              {daftar.map((key, i) => {
                const info = navInfo.get(key) || { label: key };
                const fokus = i === tengah;
                return (
                  <li key={key} data-nav-item={key}
                    className={cx('flex items-center gap-2 rounded-xl border px-3 py-2',
                      fokus ? 'border-orange-300 bg-orange-50/70' : 'border-slate-200 bg-white')}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-[11.5px] font-extrabold text-slate-600">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-slate-800">{info.label}</span>
                      <span className="block text-[10.5px] text-slate-500">{key}{fokus ? ' · fokus utama (tengah)' : ''}</span>
                    </span>
                    {fokus ? <Star size={14} className="shrink-0 text-orange-500" /> : null}
                    <button type="button" disabled={!bolehUbah || i === 0} onClick={() => geser(key, -1)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Naik" data-nav-naik={key}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" disabled={!bolehUbah || i === daftar.length - 1} onClick={() => geser(key, 1)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Turun" data-nav-turun={key}>
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" disabled={!bolehUbah} onClick={() => tambah(key)}
                      className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-30" title="Hapus dari navigasi bawah" data-nav-hapus={key}>
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
              <Eye size={12} /> Pratinjau tampilan ponsel
            </p>
            <div className="mx-auto flex max-w-[320px] items-end justify-around gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 shadow-soft">
              {daftar.length ? daftar.map((key, i) => {
                const info = navInfo.get(key) || { label: key };
                const fokus = i === tengah;
                return (
                  <span key={key} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                    <span className={cx('grid h-8 w-8 place-items-center rounded-full',
                      fokus ? 'bg-orange-500 text-white shadow' : 'bg-slate-100 text-slate-500')}>
                      <Check size={fokus ? 16 : 13} />
                    </span>
                    <span className={cx('w-full truncate text-center text-[9.5px] font-semibold',
                      fokus ? 'text-orange-600' : 'text-slate-500')}>{info.label}</span>
                  </span>
                );
              }) : <span className="text-[11.5px] text-slate-400">Belum ada tombol</span>}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-primary btn-sm" disabled={!bolehUbah || busy || !daftar.length}
              onClick={simpan} data-nav-simpan>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Navigasi
            </button>
            <button className="btn-ghost btn-sm" disabled={!bolehUbah || busy} onClick={reset} data-nav-reset>
              <RotateCcw size={13} /> Kembalikan Bawaan
            </button>
            {!bolehUbah ? <span className="text-[11.5px] text-slate-400">Anda hanya dapat melihat pengaturan ini.</span> : null}
          </div>
        </Card>

        <Card title="Menu yang Tersedia" subtitle="Klik untuk menambah / melepas dari navigasi bawah">
          <div className="space-y-3">
            {grupList.map(grup => (
              <div key={grup}>
                <p className="mb-1 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{grup}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(d.nav || []).filter(n => {
                    const f = (d.features || []).find(x => x.key === n.key);
                    return (f ? f.grup : 'Lainnya') === grup;
                  }).map(n => {
                    const aktif = daftar.includes(n.key);
                    return (
                      <button key={n.key} type="button" disabled={!bolehUbah} onClick={() => tambah(n.key)}
                        data-nav-pilih={n.key}
                        className={cx('chip transition disabled:opacity-60',
                          aktif ? '!border-emerald-400 !bg-emerald-50 !text-emerald-800' : 'hover:!border-orange-300')}>
                        {aktif ? <Check size={11} className="mr-1" /> : null}{n.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Alert tone="info" title="Catatan">
            Susunan <b>Guru Mata Pelajaran</b> bawaan: <b>Input Kejadian</b> → <b>Absensi Guru Mapel</b> (tengah / fokus utama) → <b>Buku Penghubung</b>.
            Perubahan langsung berlaku setelah pengguna memuat ulang aplikasi di ponsel.
          </Alert>
        </Card>
      </div>
    </div>
  );
}
