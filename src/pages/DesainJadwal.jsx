import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarRange, Eye, FileSignature, Loader2, Printer, Save, Type
} from 'lucide-react';
import { api, docUrl, openDoc } from '../api';
import { Alert, Card, Field, Spinner, cx, useToast } from '../ui';

/* =====================================================================
   Desain Jadwal Pelajaran — mengatur judul, semester, tahun pelajaran,
   tempat/tanggal & blok tanda tangan pada cetakan jadwal (PDF/Excel).
   ===================================================================== */
const KOSONG = {
  judul: 'JADWAL PELAJARAN', semester: 'Semester Genap', ta_teks: '',
  tempat: '', tanggal: '', pengawas_tampil: 1,
  pengawas_nama: '', pengawas_nip: '',
  kepala_nama: '', kepala_nip: '',
  wakasek_nama: '', wakasek_nip: '', wakasek_jabatan: 'Wakasek Kurikulum'
};
/* isi sel & ukuran kolom tabel jadwal (berlaku pada cetak PDF & Excel) */
const TAMPIL_KOSONG = { kode: 1, nama: 1, guru: 1, ruang: 0, gabungan: 1, kolomJam: 72, kolomFont: 7.4 };
const CONTOH = {
  kode: 'MTK', nama: 'Matematika', guru: 'Budi Santoso, S.Pd.', ruang: 'R-12', gabungan: 'X 1, X 2'
};

export default function DesainJadwal({ ctx }) {
  const { can, toast, filters } = ctx;
  const [f, setF] = useState({ ...KOSONG });
  const [tam, setTam] = useState({ ...TAMPIL_KOSONG });
  const [identitas, setIdentitas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const readOnly = !can('jadwal', 'write');

  const load = useCallback(() => {
    setLoading(true);
    api('/api/jadwal/desain')
      .then(r => {
        setF({ ...KOSONG, ...r.desain });
        setTam({ ...TAMPIL_KOSONG, ...(r.tampil || {}) });
        setIdentitas(r.identitas || null);
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const set = (patch) => setF(v => ({ ...v, ...patch }));
  const setT = (patch) => setTam(v => ({ ...v, ...patch }));

  async function simpan(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/jadwal/desain', { method: 'POST', body: { ...f, tampil: tam } });
      setF({ ...KOSONG, ...r.desain });
      if (r.tampil) setTam({ ...TAMPIL_KOSONG, ...r.tampil });
      toast.ok(r.pesan || 'Desain cetak jadwal tersimpan.');
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  if (loading) return <Spinner label="Memuat desain jadwal…" />;

  const qsCetak = (mode) => `/api/jadwal/cetak?mode=${mode}&ta=${encodeURIComponent(filters?.ta || '')}`;

  return (
    <div className="space-y-4" data-page="desain-jadwal">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[19px] font-extrabold text-slate-800">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-soft">
              <FileSignature size={17} />
            </span>
            Desain Jadwal Pelajaran
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Atur judul, semester, tahun pelajaran, tempat/tanggal, dan blok penandatangan pada hasil cetak
            (PDF maupun Excel) jadwal pelajaran.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={docUrl(qsCetak('kelas'))} target="_blank" rel="noreferrer" data-preview-kelas>
            <Eye size={15} /> Pratinjau per Kelas
          </a>
          <a className="btn-ghost" href={docUrl(qsCetak('vertikal'))} target="_blank" rel="noreferrer" data-preview-vertikal>
            <Printer size={15} /> Pratinjau Matriks
          </a>
        </div>
      </div>

      <form onSubmit={simpan} className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card title="Header Cetak" subtitle="Tampil di atas tabel jadwal">
          <div className="grid gap-3">
            <Field label="Judul Utama" required>
              <div className="flex items-center gap-2">
                <Type size={15} className="text-slate-400" />
                <input className="input" required value={f.judul || ''} disabled={readOnly}
                  onChange={e => set({ judul: e.target.value })} data-desain-judul />
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Semester" hint="Contoh: Semester Genap">
                <input className="input" value={f.semester || ''} disabled={readOnly}
                  onChange={e => set({ semester: e.target.value })} data-desain-semester />
              </Field>
              <Field label="Tahun Pelajaran" hint="Kosong = otomatis mengikuti tahun pelajaran aktif.">
                <input className="input" value={f.ta_teks || ''} disabled={readOnly}
                  placeholder="Tahun Pelajaran 2026/2027"
                  onChange={e => set({ ta_teks: e.target.value })} data-desain-ta />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Preview Sub-judul" subtitle="Baris kedua di bawah judul utama">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-[13.5px] font-extrabold uppercase tracking-wide text-slate-800">{f.judul || 'JADWAL PELAJARAN'}</p>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              {[f.semester, f.ta_teks || (identitas ? `Tahun Pelajaran …` : '')].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Tempat" hint="Kosong = ikut pengaturan tempat cetak sekolah.">
              <input className="input" value={f.tempat || ''} disabled={readOnly}
                placeholder="Ciamis" onChange={e => set({ tempat: e.target.value })} data-desain-tempat />
            </Field>
            <Field label="Tanggal" hint="Kosong = otomatis bulan & tahun cetak.">
              <input className="input" value={f.tanggal || ''} disabled={readOnly}
                placeholder="Januari 2027" onChange={e => set({ tanggal: e.target.value })} data-desain-tanggal />
            </Field>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Baris tanda tangan: <b>{(f.tempat || 'Cikoneng')}, {f.tanggal || '…'}</b>
          </p>
        </Card>

        <Card title="Isian Tabel & Ukuran Kolom" className="xl:col-span-2"
          subtitle="Tentukan apa saja yang ditulis di dalam sel jadwal dan lebar kolomnya — berlaku pada cetak PDF &amp; ekspor Excel">
          <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="mb-2 text-[12px] font-bold text-slate-700">Isi sel jadwal</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['kode', 'Kode Mapel', 'contoh: MTK'],
                  ['nama', 'Nama Mapel', 'contoh: Matematika'],
                  ['guru', 'Nama Guru', 'contoh: Budi Santoso, S.Pd.'],
                  ['gabungan', 'Keterangan gabungan kelas', 'muncul bila 1 slot dipakai beberapa kelas'],
                  ['ruang', 'Ruang', 'contoh: R-12']
                ].map(([key, label, hint]) => (
                  <label key={key} className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" disabled={readOnly}
                      checked={!!Number(tam[key])} data-desain-sel={key}
                      onChange={e => setT({ [key]: e.target.checked ? 1 : 0 })} />
                    <span>
                      <span className="block text-[12.5px] font-semibold text-slate-700">{label}</span>
                      <span className="block text-[11px] text-slate-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Contoh pilihan: <b>Kode Mapel + Nama Guru</b> saja, atau <b>Kode + Nama Mapel + Nama Guru</b> lengkap.
                Bila kode &amp; nama mapel sama-sama dimatikan, nama mapel tetap dicetak agar sel tidak kosong.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Lebar kolom JAM (px)" hint="Perlebar bila tulisan jam (07:15–08:00) terlipat ke bawah.">
                  <div className="flex items-center gap-2">
                    <input type="range" min="40" max="200" step="2" className="w-full accent-orange-600" disabled={readOnly}
                      value={Number(tam.kolomJam) || 72} data-desain-jam-range
                      onChange={e => setT({ kolomJam: Number(e.target.value) })} />
                    <input type="number" min="40" max="200" className="input !w-[86px]" disabled={readOnly}
                      value={Number(tam.kolomJam) || 72} data-desain-kolom-jam
                      onChange={e => setT({ kolomJam: Number(e.target.value) })} />
                  </div>
                </Field>
                <Field label="Ukuran font tabel (pt)" hint="Kecilkan bila isi sel terlalu panjang (6–12 pt).">
                  <div className="flex items-center gap-2">
                    <input type="range" min="6" max="12" step="0.2" className="w-full accent-orange-600" disabled={readOnly}
                      value={Number(tam.kolomFont) || 7.4} data-desain-font-range
                      onChange={e => setT({ kolomFont: Number(e.target.value) })} />
                    <input type="number" min="6" max="12" step="0.2" className="input !w-[86px]" disabled={readOnly}
                      value={Number(tam.kolomFont) || 7.4} data-desain-kolom-font
                      onChange={e => setT({ kolomFont: Number(e.target.value) })} />
                  </div>
                </Field>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[[64, 7.4, 'Rapat'], [72, 7.4, 'Standar'], [92, 8, 'Jam Lebar'], [110, 8.5, 'Sangat Lebar']].map(([jam, font, label]) => (
                  <button type="button" key={label} className="btn-ghost btn-sm" disabled={readOnly}
                    onClick={() => setT({ kolomJam: jam, kolomFont: font })}>{label}</button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[12px] font-bold text-slate-700">Pratinjau sel &amp; kolom jam</p>
              <div className="overflow-hidden rounded-lg border border-slate-300">
                <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th className="whitespace-nowrap border border-slate-300 bg-orange-50 px-1 py-1 text-center font-bold"
                        style={{ width: Number(tam.kolomJam) || 72, fontSize: (Number(tam.kolomFont) || 7.4) + 2 }}>JAM</th>
                      <th className="border border-slate-300 bg-slate-100 px-1 py-1 text-center font-bold"
                        style={{ fontSize: (Number(tam.kolomFont) || 7.4) + 2 }}>SENIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th className="whitespace-nowrap border border-slate-300 bg-orange-50 px-1 py-1 text-center font-normal"
                        style={{ width: Number(tam.kolomJam) || 72, fontSize: Math.max(7, (Number(tam.kolomFont) || 7.4)) }}>
                        Jam 1<span className="block text-[10px] text-slate-500">07:15–08:00</span>
                      </th>
                      <td className="border border-slate-300 px-1 py-1 text-center align-middle leading-tight"
                        style={{ fontSize: (Number(tam.kolomFont) || 7.4) + 2 }} data-desain-preview>
                        {(() => {
                          const isi = [];
                          if (Number(tam.kode)) isi.push(<b key="kode" className="block font-bold text-slate-800">{CONTOH.kode}</b>);
                          if (Number(tam.nama)) isi.push(<span key="nama" className="block text-slate-600">{CONTOH.nama}</span>);
                          if (!Number(tam.kode) && !Number(tam.nama)) isi.push(<b key="fallback" className="block font-bold text-slate-800">{CONTOH.nama}</b>);
                          if (Number(tam.guru)) isi.push(<span key="guru" className="block text-slate-600">{CONTOH.guru}</span>);
                          if (Number(tam.gabungan)) isi.push(<i key="gabungan" className="block text-rose-600">gabungan: {CONTOH.gabungan}</i>);
                          if (Number(tam.ruang)) isi.push(<span key="ruang" className="block text-slate-500">{CONTOH.ruang}</span>);
                          return isi;
                        })()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Pratinjau diperbesar agar mudah dibaca — hasil cetak memakai ukuran sebenarnya dan otomatis terbagi ke
                beberapa halaman bila tabel melebihi kertas.
              </p>
              <a className="btn-ghost btn-sm mt-2 inline-flex" href={docUrl(`${qsCetak('vertikal')}`)} target="_blank" rel="noreferrer">
                <Eye size={13} /> Lihat hasil cetak matriks
              </a>
            </div>
          </div>
        </Card>

        <Card title="Blok Penandatangan" subtitle="Nama & NIP di bawah tabel jadwal" className="xl:col-span-2">
          <label className="mb-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" disabled={readOnly}
              checked={f.pengawas_tampil === 1 || f.pengawas_tampil === '1' || f.pengawas_tampil === true}
              onChange={e => set({ pengawas_tampil: e.target.checked ? 1 : 0 })} data-desain-pengawas-tampil />
            <span className="text-[12.5px]">
              <b className="text-slate-700">Tampilkan kolom “Mengetahui, Pengawas Pembina”</b>
              <span className="block text-[11px] text-slate-500">Jika dimatikan, blok tanda tangan berisi Kepala Sekolah dan Wakasek Kurikulum saja.</span>
            </span>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-[12px] font-bold text-slate-700">Kepala Sekolah</p>
              <div className="grid gap-2">
                <Field label="Nama Kepala Sekolah" hint={identitas?.kepala_nama ? `Default: ${identitas.kepala_nama}` : ''}>
                  <input className="input" value={f.kepala_nama || ''} disabled={readOnly}
                    placeholder={identitas?.kepala_nama || 'Nama kepala sekolah'}
                    onChange={e => set({ kepala_nama: e.target.value })} data-desain-kepala-nama />
                </Field>
                <Field label="NIP Kepala Sekolah" hint={identitas?.kepala_nip ? `Default: ${identitas.kepala_nip}` : ''}>
                  <input className="input" value={f.kepala_nip || ''} disabled={readOnly}
                    placeholder={identitas?.kepala_nip || 'NIP'}
                    onChange={e => set({ kepala_nip: e.target.value })} data-desain-kepala-nip />
                </Field>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-[12px] font-bold text-slate-700">Wakasek Kurikulum (kolom kanan)</p>
              <div className="grid gap-2 md:grid-cols-3">
                <Field label="Jabatan" hint="Contoh: Wakasek Kurikulum">
                  <input className="input" value={f.wakasek_jabatan || ''} disabled={readOnly}
                    placeholder="Wakasek Kurikulum" onChange={e => set({ wakasek_jabatan: e.target.value })} data-desain-wakasek-jabatan />
                </Field>
                <Field label="Nama Wakasek Kurikulum" hint={identitas?.wakasek_nama ? `Default: ${identitas.wakasek_nama}` : ''}>
                  <input className="input" value={f.wakasek_nama || ''} disabled={readOnly}
                    placeholder={identitas?.wakasek_nama || 'Nama wakasek'}
                    onChange={e => set({ wakasek_nama: e.target.value })} data-desain-wakasek-nama />
                </Field>
                <Field label="NIP Wakasek Kurikulum" hint={identitas?.wakasek_nip ? `Default: ${identitas.wakasek_nip}` : ''}>
                  <input className="input" value={f.wakasek_nip || ''} disabled={readOnly}
                    placeholder={identitas?.wakasek_nip || 'NIP'}
                    onChange={e => set({ wakasek_nip: e.target.value })} data-desain-wakasek-nip />
                </Field>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-[12px] font-bold text-slate-700">Mengetahui — Pengawas Pembina</p>
              <div className="grid gap-2">
                <Field label="Nama Pengawas">
                  <input className="input" value={f.pengawas_nama || ''} disabled={readOnly}
                    placeholder="Nama lengkap & gelar" onChange={e => set({ pengawas_nama: e.target.value })} data-desain-pengawas-nama />
                </Field>
                <Field label="NIP Pengawas">
                  <input className="input" value={f.pengawas_nip || ''} disabled={readOnly}
                    onChange={e => set({ pengawas_nip: e.target.value })} data-desain-pengawas-nip />
                </Field>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!readOnly ? (
              <button className="btn-primary btn-sm" disabled={busy} data-desain-simpan>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Desain
              </button>
            ) : null}
            <button type="button" className="btn-ghost btn-sm" onClick={load}><CalendarRange size={13} /> Muat Ulang</button>
            <span className="text-[11.5px] text-slate-500">
              Perubahan berlaku pada cetakan PDF &amp; Excel jadwal (panel admin maupun portal publik).
            </span>
          </div>
        </Card>
      </form>

      <Alert tone="info" title="Tampilan cetak otomatis">
        Halaman cetak tidak lagi menampilkan instruksi “Ctrl/Cmd + P”, tombol cetak disembunyikan saat dicetak,
        dan tidak ada footer “Dicetak … oleh …”. Kerangka tabel tetap tampil walau jadwal belum terisi.
      </Alert>
    </div>
  );
}
