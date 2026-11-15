import React, { useCallback, useEffect, useState } from 'react';
import {
  Award, CalendarRange, Download, FileSpreadsheet, FileText, Loader2, Printer, RefreshCw, Search,
  ShieldAlert, Sparkles, Users
} from 'lucide-react';
import { api, docUrl, openDoc } from '../api';
import { Alert, Card, Empty, Field, Spinner, Stat, cx, useToast } from '../ui';

/* =====================================================================
   REKAP BULANAN TERPADU (PORTOFOLIO KELAS) — Wali Kelas & Guru BK
   Satu halaman memuat: persentase kehadiran, rekapitulasi catatan
   pelanggaran/prestasi, dan ringkasan hasil asesmen BK untuk satu bulan.
   Ekspor: PDF (cetak) · Excel · Word, lengkap kop sekolah + tanda tangan.
   ===================================================================== */
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export default function RekapBulanan({ ctx }) {
  const { toast, filters } = ctx;
  const [bulan, setBulan] = useState(() => new Date().toISOString().slice(0, 7));
  const [kelas, setKelas] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('kehadiran');

  const qs = useCallback(() => {
    const q = new URLSearchParams({ bulan });
    if (kelas) q.set('kelas', kelas);
    if (filters?.ta) q.set('ta', String(filters.ta));
    return q.toString();
  }, [bulan, kelas, filters?.ta]);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/rekap-bulanan?' + qs())
      .then(r => {
        setData(r);
        if (!kelas && r.kelas && r.kelas.id) setKelas(String(r.kelas.id));
      })
      .catch(e => {
        toast.err(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [qs, kelas]);
  useEffect(load, [load]);

  if (loading && !data) return <Spinner label="Menyusun rekapitulasi bulanan…" />;

  const total = data?.total || {};
  const siswa = data?.siswa || [];
  const labelBulan = data?.label || (() => {
    const [y, m] = bulan.split('-');
    return `${BULAN[Number(m) - 1] || ''} ${y}`;
  })();

  return (
    <div className="space-y-4" data-page="rekap-bulanan">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Rekap Bulanan Kelas (Portofolio)</h2>
          <p className="text-[12.5px] text-slate-500">
            Rekapitulasi bulanan terpadu untuk Wali Kelas &amp; Guru BK: kehadiran, catatan pelanggaran/prestasi,
            dan ringkasan asesmen — siap dicetak sebagai lampiran rapor karakter.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => openDoc('/api/rekap-bulanan/cetak?' + qs())} data-cetak-bulanan>
            <Printer size={15} /> PDF / Cetak
          </button>
          <a className="btn-ghost" href={docUrl('/api/rekap-bulanan/export?' + qs())} data-export-bulanan>
            <FileSpreadsheet size={15} /> Excel
          </a>
          <a className="btn-ghost" href={docUrl('/api/rekap-bulanan/word?' + qs())} data-word-bulanan>
            <FileText size={15} /> Word
          </a>
        </div>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Bulan">
            <input type="month" className="input" value={bulan} onChange={e => setBulan(e.target.value)} data-filter-bulan />
          </Field>
          <Field label="Kelas">
            <select className="input" value={kelas} onChange={e => setKelas(e.target.value)} data-filter-kelas-bulanan>
              {(data?.kelas_list || []).map(k => (
                <option key={k.id} value={k.id}>{k.nama}{k.wali_nama ? ` — ${k.wali_nama}` : ''}</option>
              ))}
              {!(data?.kelas_list || []).length ? <option value="">(tidak ada kelas)</option> : null}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <button className="btn-primary flex-1" onClick={load}><Search size={15} /> Tampilkan</button>
            <button className="btn-ghost" onClick={() => { setBulan(new Date().toISOString().slice(0, 7)); setKelas(''); }}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        {data?.kelas ? (
          <p className="mt-2 text-[12px] text-slate-500">
            Kelas <b className="text-slate-700">{data.kelas.nama}</b>
            {data.kelas.wali_nama ? <> · Wali Kelas <b className="text-slate-700">{data.kelas.wali_nama}</b></> : null}
            {' · '}Periode <b className="text-slate-700">{labelBulan}</b>
            {' · '}{data.dari} s.d. {data.sampai}
            {!data.luas ? <span className="ml-2 badge badge-pantau">akses wali kelas</span> : null}
          </p>
        ) : null}
      </Card>

      {!data ? <Empty icon={FileText} title="Rekap belum tersedia" desc="Pilih bulan & kelas lalu tekan Tampilkan." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Siswa" value={siswa.length} sub={data.kelas?.nama} icon={Users} tone="sky" />
            <Stat label="Kehadiran" value={`${data.total_persen || 0}%`} sub={`${total.H || 0} dari ${total.total || 0} pertemuan`} icon={CalendarRange} tone="emerald" />
            <Stat label="Alpha / Bolos" value={(total.A || 0) + (total.B || 0)} sub={`${total.A || 0} alpha · ${total.B || 0} bolos`} icon={ShieldAlert} tone="rose" />
            <Stat label="Poin Pelanggaran" value={total.pel || 0} sub={`${total.kejadian || 0} catatan kejadian`} icon={FileText} tone="orange" />
            <Stat label="Poin Prestasi" value={total.pres || 0} sub="penghargaan & capaian" icon={Award} tone="violet" />
          </div>

          <div className="tabs">
            <button className={cx('tab', tab === 'kehadiran' && 'active')} onClick={() => setTab('kehadiran')} data-tab-bulanan="kehadiran">
              Kehadiran &amp; Poin
            </button>
            <button className={cx('tab', tab === 'asesmen' && 'active')} onClick={() => setTab('asesmen')} data-tab-bulanan="asesmen">
              Ringkasan Asesmen
            </button>
            <button className={cx('tab', tab === 'kejadian' && 'active')} onClick={() => setTab('kejadian')} data-tab-bulanan="kejadian">
              Catatan Kejadian
            </button>
          </div>

          {tab === 'kehadiran' ? (
            <Card title="Rekapitulasi Kehadiran & Poin Kedisiplinan" subtitle={`${siswa.length} siswa · ${labelBulan}`}>
              {!siswa.length ? <Empty icon={Users} title="Belum ada siswa" desc="Belum ada siswa aktif pada kelas ini." /> : (
                <div className="tbl-wrap max-h-[62vh]">
                  <table className="tbl" data-tbl="bulanan-kehadiran">
                    <thead>
                      <tr>
                        <th className="w-10 c">No</th><th>NISN</th><th>Nama Siswa</th>
                        <th className="c">H</th><th className="c">S</th><th className="c">I</th><th className="c">A</th><th className="c">B</th>
                        <th className="c">Total</th><th className="c">% Hadir</th>
                        <th className="c">Pelanggaran</th><th className="c">Prestasi</th><th className="c">Bersih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {siswa.map((s, i) => (
                        <tr key={s.siswa_id}>
                          <td className="c">{i + 1}</td>
                          <td className="text-[11.5px]">{s.nisn || '-'}</td>
                          <td className="font-semibold text-slate-700">{s.nama}</td>
                          <td className="c text-emerald-700 font-bold">{s.H}</td>
                          <td className="c">{s.S}</td>
                          <td className="c">{s.I}</td>
                          <td className="c text-rose-700">{s.A}</td>
                          <td className="c text-rose-700">{s.B}</td>
                          <td className="c">{s.total}</td>
                          <td className="c">
                            <span className={cx('badge', s.persen_hadir >= 90 ? 'badge-aman' : s.persen_hadir >= 75 ? 'badge-perhatian' : 'badge-siaga')}>
                              {s.persen_hadir}%
                            </span>
                          </td>
                          <td className={cx('c', s.pel > 0 && 'font-bold text-rose-600')}>{s.pel}</td>
                          <td className={cx('c', s.pres > 0 && 'font-bold text-violet-600')}>{s.pres}</td>
                          <td className="c font-extrabold">{s.poin_bersih}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>JUMLAH</td>
                        <td className="c">{total.H}</td><td className="c">{total.S}</td><td className="c">{total.I}</td>
                        <td className="c">{total.A}</td><td className="c">{total.B}</td><td className="c">{total.total}</td>
                        <td className="c">{data.total_persen}%</td>
                        <td className="c">{total.pel}</td><td className="c">{total.pres}</td><td className="c">{(total.pel || 0) - (total.pres || 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          ) : tab === 'asesmen' ? (
            <Card title="Ringkasan Hasil Asesmen BK" subtitle="AKPD, RIASEC, Gaya Belajar, dan Kesulitan Belajar pada kelas ini">
              {!(data.asesmen || []).length ? <Empty icon={Sparkles} title="Belum ada instrumen" desc="Belum ada instrumen asesmen pada aplikasi." /> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {data.asesmen.map(a => (
                    <div key={a.kode} className="rounded-xl border border-slate-200 p-3" data-asesmen={a.kode}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-bold text-slate-800">{a.nama}</p>
                        <span className="chip shrink-0">{a.jumlah_terisi}/{a.total_siswa} terisi</span>
                      </div>
                      {a.utama ? (
                        <p className="mt-1 text-[11.5px] text-slate-600">
                          Kecenderungan utama: <b className="text-orange-700">{a.utama.label}</b> ({a.utama.pct}%)
                        </p>
                      ) : <p className="mt-1 text-[11.5px] text-slate-400">Belum ada hasil pada kelas ini.</p>}
                      <div className="mt-2 space-y-1">
                        {a.distribusi.slice(0, 4).map(d => (
                          <div key={d.key} className="flex items-center gap-2">
                            <span className="w-[110px] shrink-0 truncate text-[10.5px] text-slate-500">{d.label}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-400" style={{ width: `${Math.min(100, d.pct)}%` }} />
                            </span>
                            <span className="w-10 shrink-0 text-right text-[10.5px] font-bold text-slate-600">{d.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Catatan Pelanggaran & Prestasi" subtitle={`${data.jumlah_kejadian || 0} catatan pada ${labelBulan}`}>
              {!(data.kejadian || []).length ? <Empty icon={FileText} title="Tidak ada catatan" desc="Tidak ada kejadian pada bulan ini." /> : (
                <div className="tbl-wrap max-h-[58vh]">
                  <table className="tbl" data-tbl="bulanan-kejadian">
                    <thead><tr><th className="w-10 c">No</th><th>Tanggal</th><th>Kategori</th><th className="c">Jenis</th><th className="c">Poin</th><th>Keterangan</th></tr></thead>
                    <tbody>
                      {data.kejadian.map((r, i) => (
                        <tr key={i}>
                          <td className="c">{i + 1}</td>
                          <td className="whitespace-nowrap">{r.tanggal}</td>
                          <td className="font-semibold text-slate-700">{r.kategori || '-'}</td>
                          <td className="c">
                            <span className={cx('badge', r.jenis === 'prestasi' ? 'badge-aman' : 'badge-siaga')}>
                              {r.jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran'}
                            </span>
                          </td>
                          <td className="c font-bold">{r.poin}</td>
                          <td className="max-w-[300px] text-[11.5px]">{r.keterangan || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          <Alert tone="info" title="Ekspor laporan portofolio">
            Tombol <b>PDF / Cetak</b>, <b>Excel</b>, dan <b>Word</b> menghasilkan dokumen lengkap (kehadiran, poin, asesmen,
            catatan kejadian) dengan kop sekolah serta blok tanda tangan <b>Kepala Sekolah</b> dan <b>Wali Kelas</b>
            (Guru BK ikut tercantum pada cetakan PDF).
          </Alert>
        </>
      )}
    </div>
  );
}
