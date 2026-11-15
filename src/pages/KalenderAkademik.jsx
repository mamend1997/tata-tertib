import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, CalendarOff, CalendarRange, CheckCircle2, ClipboardList, Download, FileSpreadsheet,
  Loader2, Palette, Plus, Printer, RefreshCw, Save, Settings2, Trash2, Upload, X
} from 'lucide-react';
import { api, docUrl, openDoc, tgl, hariIni } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';

/* =====================================================================
   KALENDER AKADEMIK & HARI EFEKTIF KBM (grid 1 tahun ajaran)
   ---------------------------------------------------------------------
   Admin / Wakasek Kurikulum menandai tanggal: Hari Libur Nasional, Jadwal
   Ujian (PTS/STS · PAS/SAS · Ujian Sekolah), atau Kegiatan Sekolah Lainnya.
   Tanggal bertanda `nonaktif` membuat JADWAL MAPEL REGULER TIDAK BERLAKU pada
   hari itu: absensi guru/siswa ditutup, alfa otomatis & pengingat WA dilewati —
   master jadwal mingguan TIDAK diubah.
   ===================================================================== */
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus',
  'September', 'Oktober', 'November', 'Desember'];
const HARI_SINGKAT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const pad = n => String(n).padStart(2, '0');

/* warna bawaan dipakai bila pengaturan warna kategori belum dimuat */
const WARNA_BAWAAN = {
  libur: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  ujian: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  kegiatan: { bg: '#E0F2FE', text: '#075985', border: '#7DD3FC' }
};
/** warna satu tanggal: warna khusus tanggal → warna kategori → bawaan */
const warnaOf = (kal, warna) => {
  if (!kal) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(String(kal.warna || ''))) {
    return { bg: String(kal.warna), text: '#111827', border: String(kal.warna) };
  }
  return (warna || {})[kal.kategori] || WARNA_BAWAAN[kal.kategori] || WARNA_BAWAAN.kegiatan;
};
/** label rentang tanggal untuk daftar keterangan (mis. "14 - 28 Maret 2026") */
const BULAN_ID = BULAN;
const labelRentangTanggal = (dari, sampai) => {
  if (String(dari) === String(sampai)) return tgl(dari);
  const [ya, ma, da] = String(dari).slice(0, 10).split('-').map(Number);
  const [yb, mb, db] = String(sampai).slice(0, 10).split('-').map(Number);
  if (ya === yb && ma === mb) return `${da} - ${db} ${BULAN_ID[ma - 1]} ${ya}`;
  return `${tgl(dari)} - ${tgl(sampai)}`;
};
/** kelompokkan tanggal berurutan dengan judul+kategori+warna sama → rentang */
const rentangDari = (list) => {
  const urut = [...list].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  const out = [];
  const key = r => `${r.kategori}|${r.judul || ''}|${r.keterangan || ''}|${r.warna || ''}|${Number(r.nonaktif) === 1 ? 1 : 0}`;
  for (const r of urut) {
    const last = out[out.length - 1];
    if (last && key(last.row) === key(r)) {
      const beda = (new Date(String(r.tanggal) + 'T00:00:00') - new Date(String(last.sampai) + 'T00:00:00')) / 86400000;
      if (beda >= 1 && beda <= 3) { last.sampai = String(r.tanggal); continue; }
    }
    out.push({ row: r, dari: String(r.tanggal), sampai: String(r.tanggal) });
  }
  return out;
};

export default function KalenderAkademik({ ctx }) {
  const { can, filters, toast } = ctx;
  const bolehUbah = can('kalender_akademik', 'write');
  const bolehHapus = can('kalender_akademik', 'delete');
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [daftar, setDaftar] = useState(false);          // tampilan grid / daftar
  const [form, setForm] = useState(null);               // modal tanggal
  const [bulk, setBulk] = useState(null);               // modal massal
  const [cari, setCari] = useState('');
  const [busy, setBusy] = useState(false);
  const [warnaOpen, setWarnaOpen] = useState(false);
  const [warna, setWarna] = useState(null);
  const [semester, setSemester] = useState(null);
  const [pengawas, setPengawas] = useState({ nama: '', nip: '' });
  const [simpanSet, setSimpanSet] = useState(false);
  const [cetakOpen, setCetakOpen] = useState(false);
  const [cetakForm, setCetakForm] = useState({ cakupan: 'semester', orient: 'portrait' });

  const ta = filters?.ta || '';

  const load = useCallback(() => {
    setLoading(true);
    api('/api/kalender-akademik?ta=' + encodeURIComponent(ta))
      .then(r => {
        setD(r);
        setWarna(r.warna || null);
        setSemester(r.semester || null);
        setPengawas({
          nama: r.pengaturan?.pengawas_nama || '',
          nip: r.pengaturan?.pengawas_nip || ''
        });
      }).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [ta]);
  useEffect(load, [load]);

  const kalMap = useMemo(() => {
    const m = new Map();
    for (const r of (d?.rows || [])) m.set(String(r.tanggal), r);
    return m;
  }, [d]);

  /* daftar bulan pada tahun ajaran (Juli … Juni, mengikuti tanggal TA) */
  const bulanList = useMemo(() => {
    if (d?.bulan?.length) return d.bulan.map(b => b.bulan);
    const mulai = String(d?.dari || '').slice(0, 7) || `${new Date().getFullYear()}-07`;
    const [y0, m0] = mulai.split('-').map(Number);
    const out = [];
    let y = y0, m = m0;
    for (let i = 0; i < 12; i++) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }, [d]);

  const efektifOf = (bulan) => (d?.bulan || []).find(b => b.bulan === bulan) || { hari: 0, libur: 0, pekan: 0 };

  async function simpanTanggal(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/kalender-akademik/save', {
        method: 'POST',
        body: {
          tanggal: form.tanggal, kategori: form.kategori, judul: form.judul,
          keterangan: form.keterangan, nonaktif: form.nonaktif ? 1 : 0,
          warna: form.warna || '', ta
        }
      });
      toast.ok(r.pesan || 'Tanggal kalender disimpan.');
      setForm(null); load();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  async function simpanMassal(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/kalender-akademik/save', {
        method: 'POST', body: { ...bulk, hari: bulk.hari, ta }
      });
      toast.ok(r.pesan || 'Tanggal ditandai.');
      setBulk(null); load();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  async function hapus(row) {
    if (!window.confirm(`Hapus tanda kalender ${tgl(row.tanggal)} (${row.judul || row.kategori})?`)) return;
    try {
      await api('/api/kalender-akademik/delete', { method: 'POST', body: { id: row.id, ta } });
      toast.ok('Tanggal kalender dihapus.'); load();
    } catch (e) { toast.err(e.message); }
  }

  /* simpan rentang semester + warna kategori + nama pengawas */
  async function simpanPengaturan() {
    setSimpanSet(true);
    try {
      const r = await api('/api/kalender-akademik/pengaturan', {
        method: 'POST',
        body: { semester, warna, pengawas_nama: pengawas.nama, pengawas_nip: pengawas.nip, ta }
      });
      toast.ok(r.pesan || 'Pengaturan kalender disimpan.');
      setWarna(r.warna); setSemester(r.semester);
      setWarnaOpen(false); load();
    } catch (e) { toast.err(e.message); }
    finally { setSimpanSet(false); }
  }
  const setWarnaKat = (kat, sisi, nilai) => setWarna(w => ({
    ...(w || {}), [kat]: { ...((w || {})[kat] || {}), [sisi]: nilai }
  }));

  if (loading && !d) return <Spinner label="Memuat kalender akademik…" />;

  const ringkas = d?.ringkas || {};
  const hariAktif = d?.hari_aktif || [];
  const kategoriList = d?.kategori || [];
  const rows = (d?.rows || []).filter(r => !cari
    || `${r.tanggal} ${r.judul || ''} ${r.keterangan || ''} ${r.kategori}`.toLowerCase().includes(cari.toLowerCase()));

  const selTanggal = (iso) => {
    const ada = kalMap.get(iso);
    setForm({
      tanggal: iso, kategori: ada?.kategori || 'libur', judul: ada?.judul || '',
      keterangan: ada?.keterangan || '', nonaktif: ada ? Number(ada.nonaktif) === 1 : true,
      warna: ada?.warna || '', id: ada?.id || 0
    });
  };

  return (
    <div className="space-y-4" data-page="kalender-akademik">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[19px] font-extrabold text-slate-800">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-soft">
              <CalendarClock size={17} />
            </span>
            Kalender Akademik &amp; Hari Efektif
          </h2>
          <p className="mt-1 max-w-3xl text-[12.5px] text-slate-500">
            Tandai hari libur, jadwal ujian, dan kegiatan sekolah. Pada tanggal bertanda
            <b> KBM tidak berlaku</b>, jadwal mapel reguler otomatis non-aktif (absensi ditutup,
            alfa otomatis &amp; pengingat WhatsApp dilewati) — master jadwal mingguan tidak berubah.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={load}><RefreshCw size={14} /> Muat Ulang</button>
          <button className={cx('btn-ghost btn-sm', !daftar && 'btn-active')} onClick={() => setDaftar(false)} data-mode-grid>
            <CalendarRange size={14} /> Grid
          </button>
          <button className={cx('btn-ghost btn-sm', daftar && 'btn-active')} onClick={() => setDaftar(true)} data-mode-daftar>
            <ClipboardList size={14} /> Daftar
          </button>
          {bolehUbah ? (
            <button className="btn-primary btn-sm" onClick={() => setBulk({
              dari: hariIni(), sampai: hariIni(), kategori: 'libur', judul: '', keterangan: '',
              nonaktif: true, hari: []
            })} data-tandai-massal>
              <Upload size={14} /> Tandai Massal
            </button>
          ) : null}
          {/* EKSPOR & CETAK (kop + 3 tanda tangan, dipisah per semester) */}
          <span className="mx-1 hidden h-5 w-px bg-slate-300 sm:block" />
          {/* CETAK: pilih cakupan (satu tahun / per semester) & orientasi kertas */}
          <button className="btn-ghost btn-sm" onClick={() => setCetakOpen(true)} data-kal-cetak>
            <Printer size={14} /> Cetak / Simpan PDF
          </button>
          <a className="btn-ghost btn-sm" href={docUrl('/api/kalender-akademik/export?ta=' + encodeURIComponent(ta))} data-kal-excel>
            <FileSpreadsheet size={14} /> Export Excel
          </a>
          <a className="btn-ghost btn-sm" href={docUrl('/api/kalender-akademik/word?ta=' + encodeURIComponent(ta))} data-kal-word>
            <Download size={14} /> Export Word
          </a>
          {bolehUbah ? (
            <button className="btn-soft btn-sm" onClick={() => setWarnaOpen(true)} data-kal-pengaturan>
              <Settings2 size={14} /> Semester &amp; Warna
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Hari Efektif KBM" value={ringkas.hari_efektif || 0} sub="hari sekolah tanpa libur/ujian" icon={CheckCircle2} tone="emerald" />
        <Stat label="Hari Libur Nasional" value={ringkas.libur || 0} sub="tanggal ditandai libur" icon={CalendarOff} tone="rose" />
        <Stat label="Jadwal Ujian" value={ringkas.ujian || 0} sub="PTS/STS · PAS/SAS · Ujian Sekolah" icon={ClipboardList} tone="violet" />
        <Stat label="Kegiatan Sekolah" value={ringkas.kegiatan || 0} sub="kegiatan lain yang meniadakan KBM" icon={CalendarClock} tone="sky" />
      </div>

      <Alert tone="info" title={`Tahun Pelajaran ${d?.ta_nama || '-'}`}>
        {d?.dari && d?.sampai ? <>Rentang kalender <b>{tgl(d.dari)}</b> s.d. <b>{tgl(d.sampai)}</b>. </> : null}
        Hari sekolah aktif: <b>{(hariAktif || []).map(h => d?.hari_label?.[h] || h).join(', ') || '-'}</b>.
        Klik tanggal pada grid untuk menandainya.
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px]" data-kal-semester-info>
          <span>Semester 1: <b>{tgl(semester?.ganjil?.mulai)}</b> s.d. <b>{tgl(semester?.ganjil?.selesai)}</b></span>
          <span>Semester 2: <b>{tgl(semester?.genap?.mulai)}</b> s.d. <b>{tgl(semester?.genap?.selesai)}</b></span>
        </div>
      </Alert>

      {!daftar ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bulanList.map(bulan => (
            <BulanGrid key={bulan} bulan={bulan} kalMap={kalMap} hariAktif={hariAktif}
              warna={d?.warna} efektif={efektifOf(bulan)} onPick={bolehUbah ? selTanggal : null}
              onHapus={bolehHapus ? hapus : null} />
          ))}
        </div>
      ) : (
        <Card title={`Daftar Tanggal Khusus (${rows.length})`}
          right={<input className="input !w-[210px] !py-1.5 text-[12px]" placeholder="Cari tanggal / judul…"
            value={cari} onChange={e => setCari(e.target.value)} data-cari-kalender />}>
          {!rows.length ? (
            <Empty icon={CalendarClock} title="Belum ada tanggal khusus"
              desc="Klik Tandai Massal untuk menandai libur/ujian sekaligus, atau klik tanggal di grid." />
          ) : (
            <div className="tbl-wrap max-h-[62vh]">
              <table className="tbl" data-tbl="kalender-akademik">
                <thead><tr>
                  <th className="w-10 c">No</th><th>Tanggal</th><th>Hari</th><th>Kategori</th>
                  <th>Judul / Keterangan</th><th className="c">KBM</th><th className="c">Aksi</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} data-kal-row={r.id}>
                      <td className="c">{i + 1}</td>
                      <td className="font-semibold">{tgl(r.tanggal)}</td>
                      <td>{new Date(r.tanggal + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long' })}</td>
                      <td>
                        <span className="badge border"
                          style={(() => { const w = warnaOf(r, d?.warna); return { background: w.bg, color: w.text, borderColor: w.border }; })()}>
                          {d?.kategori?.find(k => k.key === r.kategori)?.label || r.kategori}
                        </span>
                      </td>
                      <td>
                        <div className="font-semibold text-slate-700">{r.judul || '-'}</div>
                        {r.keterangan ? <div className="text-[11px] text-slate-500">{r.keterangan}</div> : null}
                      </td>
                      <td className="c">
                        {Number(r.nonaktif) === 1
                          ? <span className="badge badge-siaga">Tidak berlaku</span>
                          : <span className="badge badge-aman">Tetap KBM</span>}
                      </td>
                      <td className="c">
                        <div className="flex items-center justify-center gap-1">
                          {bolehUbah ? (
                            <button className="btn-ghost btn-sm" onClick={() => selTanggal(r.tanggal)} title="Ubah"><Save size={12} /></button>
                          ) : null}
                          {bolehHapus ? (
                            <button className="btn-ghost btn-sm !text-rose-600" onClick={() => hapus(r)} title="Hapus"><Trash2 size={12} /></button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* modal satu tanggal */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form ? `Tanggal ${tgl(form.tanggal, { long: true })}` : ''}
        footer={form ? (
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" type="button" onClick={() => setForm(null)}>Batal</button>
            <button className="btn-primary" type="submit" form="fKalender" disabled={busy} data-simpan-tanggal>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan
            </button>
          </div>
        ) : null}>
        {form ? (
          <form id="fKalender" className="grid gap-3" onSubmit={simpanTanggal}>
            <Field label="Kategori" required>
              <select className="input" value={form.kategori} data-kal-kategori
                onChange={e => setForm(v => ({ ...v, kategori: e.target.value }))}>
                {kategoriList.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Judul" hint="Contoh: Hari Raya Idul Fitri · PAS Semester Ganjil · Peringatan HUT RI">
              <input className="input" value={form.judul || ''} data-kal-judul
                onChange={e => setForm(v => ({ ...v, judul: e.target.value }))} />
            </Field>
            <Field label="Keterangan (opsional)">
              <textarea className="input" rows={2} value={form.keterangan || ''} data-kal-keterangan
                onChange={e => setForm(v => ({ ...v, keterangan: e.target.value }))} />
            </Field>
            <Field label="Warna latar khusus tanggal ini (opsional)"
              hint="Kosongkan untuk memakai warna kategori. Berguna membedakan kegiatan sejenis (mis. awal masuk sekolah hijau, SMARTTREN oranye).">
              <div className="flex items-center gap-2">
                <input type="color" className="h-9 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
                  value={form.warna || (warnaOf({ kategori: form.kategori }, warna)?.bg || '#E2E8F0')}
                  data-kal-warna onChange={e => setForm(v => ({ ...v, warna: e.target.value }))} />
                <input className="input !w-[120px] font-mono text-[12px]" value={form.warna || ''} placeholder="(kategori)"
                  data-kal-warna-hex onChange={e => setForm(v => ({ ...v, warna: e.target.value }))} />
                {form.warna ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setForm(v => ({ ...v, warna: '' }))}>
                    Pakai warna kategori
                  </button>
                ) : null}
              </div>
            </Field>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!form.nonaktif}
                data-kal-nonaktif onChange={e => setForm(v => ({ ...v, nonaktif: e.target.checked }))} />
              <span>
                <span className="block text-[12.5px] font-semibold text-slate-700">KBM reguler tidak berlaku pada tanggal ini</span>
                <span className="block text-[11px] text-slate-500">
                  Absensi guru &amp; siswa ditutup, alfa otomatis dan pengingat WhatsApp dilewati.
                  Matikan bila kegiatan tetap berjalan bersama KBM normal.
                </span>
              </span>
            </label>
            {form.id && bolehHapus ? (
              <button type="button" className="btn-ghost btn-sm !text-rose-600" onClick={() => {
                const row = kalMap.get(form.tanggal);
                setForm(null);
                if (row) hapus(row);
              }}><Trash2 size={13} /> Hapus tanda tanggal ini</button>
            ) : null}
          </form>
        ) : null}
      </Modal>

      {/* modal pengaturan: rentang semester, warna kategori, pengawas */}
      <Modal open={warnaOpen} onClose={() => setWarnaOpen(false)} size="lg" title="Semester, Warna & Pengawas"
        subtitle="Rentang tanggal semester tercetak di header kalender; warna dipakai pada grid & dokumen cetak"
        footer={<>
          <button className="btn-ghost" type="button" onClick={() => setWarnaOpen(false)}>Batal</button>
          <button className="btn-primary" type="button" onClick={simpanPengaturan} disabled={simpanSet}
            data-kal-pengaturan-simpan>
            {simpanSet ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan Pengaturan
          </button>
        </>}>
        <form className="grid gap-4" onSubmit={e => { e.preventDefault(); simpanPengaturan(); }}>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-slate-800">
              <CalendarRange size={14} className="text-violet-600" /> Rentang Tanggal Semester
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {['ganjil', 'genap'].map((j, i) => (
                <div key={j} className="rounded-xl border border-slate-200 p-2.5">
                  <p className="mb-1.5 text-[11.5px] font-bold text-slate-700">Semester {i + 1} ({j === 'ganjil' ? 'Ganjil' : 'Genap'})</p>
                  <div className="grid gap-2">
                    <Field label="Tanggal Mulai">
                      <input type="date" className="input !py-1.5 text-[12px]"
                        value={semester?.[j]?.mulai || ''} data-kal-sem-mulai={j}
                        onChange={e => setSemester(v => ({ ...(v || {}), [j]: { ...(v?.[j] || {}), mulai: e.target.value } }))} />
                    </Field>
                    <Field label="Tanggal Selesai">
                      <input type="date" className="input !py-1.5 text-[12px]"
                        value={semester?.[j]?.selesai || ''} data-kal-sem-selesai={j}
                        onChange={e => setSemester(v => ({ ...(v || {}), [j]: { ...(v?.[j] || {}), selesai: e.target.value } }))} />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-slate-800">
              <Palette size={14} className="text-orange-600" /> Warna Kategori Kegiatan
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {kategoriList.map(k => (
                <div key={k.key} className="rounded-xl border border-slate-200 p-2.5">
                  <p className="mb-1.5 text-[11.5px] font-bold text-slate-700">{k.label}</p>
                  <div className="grid gap-1.5">
                    {[['bg', 'Latar'], ['text', 'Teks'], ['border', 'Garis']].map(([sisi, label]) => (
                      <label key={sisi} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                        <span>{label}</span>
                        <input type="color" className="h-7 w-12 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                          value={(warna?.[k.key] || WARNA_BAWAAN[k.key])[sisi] || '#FFFFFF'}
                          data-kal-warna-kat={k.key} data-kal-warna-sisi={sisi}
                          onChange={e => setWarnaKat(k.key, sisi, e.target.value)} />
                      </label>
                    ))}
                  </div>
                  <div className="mt-1.5 rounded-md border px-2 py-1 text-center text-[10.5px] font-semibold"
                    style={(() => { const w = (warna?.[k.key] || WARNA_BAWAAN[k.key]); return { background: w.bg, color: w.text, borderColor: w.border }; })()}>
                    Contoh tampilan
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Warna ini dipakai pada grid kalender dan dokumen cetak/Excel/Word. Warna per tanggal
              (di modal tanggal) menimpa warna kategori.
            </p>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-slate-800">
              <ClipboardList size={14} className="text-teal-600" /> Pengawas Pembina (tanda tangan ketiga)
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Nama Pembina / Pengawas Pembina">
                <input className="input" value={pengawas.nama} data-kal-pengawas-nama
                  placeholder="Nama lengkap & gelar"
                  onChange={e => setPengawas(v => ({ ...v, nama: e.target.value }))} />
              </Field>
              <Field label="NIP Pengawas">
                <input className="input" value={pengawas.nip} data-kal-pengawas-nip
                  onChange={e => setPengawas(v => ({ ...v, nip: e.target.value }))} />
              </Field>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Kepala Sekolah &amp; {d?.pengaturan?.wakasek_nama ? 'Wakasek Kurikulum' : 'Wakasek Kurikulum'} diambil dari
              menu Identitas Sekolah. Blok tanda tangan selalu berada di bagian bawah setiap halaman cetak.
            </p>
          </div>
        </form>
      </Modal>

      {/* modal massal */}
      <Modal open={!!bulk} onClose={() => setBulk(null)} title="Tandai Tanggal Massal" wide
        footer={bulk ? (
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" type="button" onClick={() => setBulk(null)}>Batal</button>
            <button className="btn-primary" type="submit" form="fKalenderMassal" disabled={busy} data-simpan-massal>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Tandai Tanggal
            </button>
          </div>
        ) : null}>
        {bulk ? (
          <form id="fKalenderMassal" className="grid gap-3" onSubmit={simpanMassal}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Dari Tanggal" required>
                <input type="date" className="input" required value={bulk.dari}
                  data-massal-dari onChange={e => setBulk(v => ({ ...v, dari: e.target.value }))} />
              </Field>
              <Field label="Sampai Tanggal" required>
                <input type="date" className="input" required value={bulk.sampai}
                  data-massal-sampai onChange={e => setBulk(v => ({ ...v, sampai: e.target.value }))} />
              </Field>
            </div>
            <Field label="Kategori" required>
              <select className="input" value={bulk.kategori} data-massal-kategori
                onChange={e => setBulk(v => ({ ...v, kategori: e.target.value }))}>
                {kategoriList.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Batasi pada hari tertentu" hint="Kosongkan bila semua hari pada rentang ikut ditandai (mis. libur panjang).">
              <div className="flex flex-wrap gap-1.5">
                {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((h, idx) => {
                  const on = (bulk.hari || []).includes(idx);
                  return (
                    <button type="button" key={h}
                      className={cx('rounded-lg border px-2.5 py-1 text-[12px] font-semibold',
                        on ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-white text-slate-600')}
                      data-massal-hari={idx}
                      onClick={() => setBulk(v => ({
                        ...v, hari: on ? (v.hari || []).filter(x => x !== idx) : [...(v.hari || []), idx]
                      }))}>{h}</button>
                  );
                })}
              </div>
            </Field>
            <Field label="Judul" hint="Contoh: Libur Semester Ganjil · Pekan PAS · Class Meeting">
              <input className="input" value={bulk.judul || ''} data-massal-judul
                onChange={e => setBulk(v => ({ ...v, judul: e.target.value }))} />
            </Field>
            <Field label="Keterangan (opsional)">
              <textarea className="input" rows={2} value={bulk.keterangan || ''} data-massal-keterangan
                onChange={e => setBulk(v => ({ ...v, keterangan: e.target.value }))} />
            </Field>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!bulk.nonaktif}
                data-massal-nonaktif onChange={e => setBulk(v => ({ ...v, nonaktif: e.target.checked }))} />
              <span>
                <span className="block text-[12.5px] font-semibold text-slate-700">KBM reguler tidak berlaku</span>
                <span className="block text-[11px] text-slate-500">Matikan bila kegiatan tetap berjalan bersama KBM normal.</span>
              </span>
            </label>
          </form>
        ) : null}
      </Modal>

      {/* ================= OPSI CETAK (cakupan & orientasi) ================= */}
      <Modal open={cetakOpen} onClose={() => setCetakOpen(false)} title="Cetak Kalender Akademik"
        footer={<>
          <button type="button" className="btn-ghost" onClick={() => setCetakOpen(false)}>Batal</button>
          <button type="button" className="btn-primary" data-kal-cetak-proses
            onClick={() => {
              const p = new URLSearchParams();
              if (ta) p.set('ta', ta);
              if (cetakForm.cakupan === 'tahun') p.set('cakupan', 'tahun');
              else if (cetakForm.cakupan === '1' || cetakForm.cakupan === '2') p.set('semester', cetakForm.cakupan);
              else p.set('cakupan', 'semester');
              p.set('orient', cetakForm.orient);
              openDoc('/api/kalender-akademik/cetak?' + p.toString());
              setCetakOpen(false);
            }}>
            <Printer size={15} /> Buka Dokumen Cetak
          </button>
        </>}>
        <form className="space-y-4" onSubmit={e => e.preventDefault()}>
          <Field label="Cakupan Cetak"
            hint="Satu tahun pelajaran dirender sebagai satu alur penuh tanpa pemisah halaman.">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['tahun', 'Satu Tahun Pelajaran', 'Semua bulan (Juli … Juni) dalam satu alur, tanpa pemisah halaman'],
                ['semester', 'Per Semester', 'Semester 1 & 2 masing-masing di halaman sendiri'],
                ['1', 'Semester 1 Saja', 'Hanya bulan-bulan semester ganjil'],
                ['2', 'Semester 2 Saja', 'Hanya bulan-bulan semester genap']
              ].map(([val, judul, ket]) => (
                <label key={val}
                  className={cx('flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2',
                    cetakForm.cakupan === val ? 'border-orange-400 bg-orange-50/60' : 'border-slate-200 bg-white')}>
                  <input type="radio" className="mt-0.5 h-4 w-4 accent-orange-600" checked={cetakForm.cakupan === val}
                    data-kal-cakupan={val}
                    onChange={() => setCetakForm(v => ({ ...v, cakupan: val }))} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-slate-700">{judul}</span>
                    <span className="block text-[11px] leading-snug text-slate-500">{ket}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Orientasi Kertas">
            <div className="flex gap-2">
              {[['portrait', 'Portrait (A4 tegak)'], ['landscape', 'Landscape (A4 melebar)']].map(([val, judul]) => (
                <label key={val}
                  className={cx('flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-semibold',
                    cetakForm.orient === val ? 'border-orange-400 bg-orange-50/60 text-orange-800' : 'border-slate-200 bg-white text-slate-600')}>
                  <input type="radio" className="h-4 w-4 accent-orange-600" checked={cetakForm.orient === val}
                    data-kal-orient={val}
                    onChange={() => setCetakForm(v => ({ ...v, orient: val }))} />
                  {judul}
                </label>
              ))}
            </div>
          </Field>
        </form>
      </Modal>
    </div>
  );
}

/* ------------------------- grid satu bulan ------------------------- */
function BulanGrid({ bulan, kalMap, hariAktif, efektif, onPick, onHapus, warna }) {
  const [y, m] = bulan.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  const startIdx = (new Date(y, m - 1, 1).getDay() + 6) % 7;  // Senin = 0
  const cells = [];
  for (let i = 0; i < startIdx; i++) cells.push(null);
  for (let day = 1; day <= total; day++) {
    const iso = `${y}-${pad(m)}-${pad(day)}`;
    const dow = new Date(y, m - 1, day).getDay();
    cells.push({ day, iso, dow, kal: kalMap.get(iso) || null });
  }
  while (cells.length % 7) cells.push(null);
  return (
    <div className="card p-3" data-bulan={bulan}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-extrabold text-slate-800">{BULAN[m - 1]} {y}</p>
        <p className="text-[11px] text-slate-500">
          <b className="text-emerald-600">{efektif.hari}</b> hari efektif
          {efektif.libur ? <> · <span className="text-rose-600">{efektif.libur}</span> libur</> : null}
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {HARI_SINGKAT.map(h => <div key={h} className="text-[10px] font-bold uppercase text-slate-400">{h}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={'x' + i} />;
          const aktif = (hariAktif || []).includes(c.dow);
          const st = warnaOf(c.kal, warna);
          const nonaktif = c.kal && Number(c.kal.nonaktif) === 1;
          return (
            <button key={c.iso} type="button" disabled={!onPick}
              onClick={() => onPick && onPick(c.iso)}
              title={c.kal ? `${c.kal.judul || c.kal.kategori}${nonaktif ? ' — KBM tidak berlaku' : ' — KBM tetap'}` : (aktif ? 'Hari sekolah' : 'Bukan hari sekolah')}
              data-day={c.iso}
              style={st ? { background: st.bg, color: st.text, borderColor: st.border } : undefined}
              className={cx('relative rounded-md border px-0.5 py-1 text-[11px] leading-tight transition',
                st ? '' : aktif ? 'border-slate-200 bg-white text-slate-700 hover:border-orange-400'
                  : 'border-slate-100 bg-slate-50 text-slate-400',
                onPick ? 'cursor-pointer hover:shadow' : 'cursor-default')}>
              <span className="block font-bold">{c.day}</span>
              {c.kal ? (
                <span className="mt-0.5 block truncate text-[8.5px] font-semibold">
                  {nonaktif ? (c.kal.kategori === 'ujian' ? 'UJIAN' : c.kal.kategori === 'libur' ? 'LIBUR' : 'KEGIATAN') : 'KBM'}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {(() => {
        const rentang = rentangDari([...kalMap.values()].filter(k => String(k.tanggal).startsWith(bulan)));
        if (!rentang.length) return null;
        return (
          <ul className="mt-2 space-y-0 divide-y divide-dotted divide-slate-200 border-t border-dashed border-slate-300 pt-1"
            data-bulan-keterangan={bulan}>
            {rentang.map(r => {
              const w = warnaOf(r.row, warna);
              return (
                <li key={r.row.id} className="flex items-center gap-1 py-0.5 text-[10.5px] leading-tight text-slate-600">
                  <span className="inline-block h-2 w-2 shrink-0 border" style={{ background: w.bg, borderColor: w.text }} />
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-semibold text-slate-700">{labelRentangTanggal(r.dari, r.sampai)}</b>{' '}
                    {r.row.judul || r.row.kategori}
                  </span>
                  {onHapus ? (
                    <button className="shrink-0 text-rose-400 hover:text-rose-600" onClick={() => onHapus(r.row)} title="Hapus">
                      <X size={10} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        );
      })()}
    </div>
  );
}
