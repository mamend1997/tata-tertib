import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarRange, Download, FileSpreadsheet, Loader2, Printer, RefreshCw, Search, Trash2, UserCheck, Users
} from 'lucide-react';
import { api, docUrl, openDoc } from '../api';
import { Alert, Card, Empty, Field, Spinner, Stat, cx, useToast } from '../ui';
import HapusKonfirmasi from '../components/HapusKonfirmasi';

const PERIODE = [
  { key: 'harian', label: 'Harian' },
  { key: 'mingguan', label: 'Mingguan' },
  { key: 'bulanan', label: 'Bulanan' },
  { key: 'tahun', label: 'Satu Tahun Pelajaran' },
  { key: 'custom', label: 'Rentang Tanggal' }
];

export default function RekapAbsensiGuru({ ctx }) {
  const { toast, filters } = ctx;
  const [f, setF] = useState({
    periode: 'bulanan', tanggal: new Date().toISOString().slice(0, 10),
    dari: '', sampai: '', guru: '', mapel: ''
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('guru');
  /* ---- hapus riwayat absensi guru ---- */
  const [pilih, setPilih] = useState([]);         // key "jadwal_id|tanggal"
  const [konfirm, setKonfirm] = useState(null);
  const [hapusBusy, setHapusBusy] = useState(false);
  const [fHapus, setFHapus] = useState({ dari: '', sampai: '', guru: '' });

  const qs = useCallback((extra = {}) => {
    const q = new URLSearchParams();
    q.set('periode', f.periode);
    if (f.tanggal) q.set('tanggal', f.tanggal);
    if (f.dari) q.set('dari', f.dari);
    if (f.sampai) q.set('sampai', f.sampai);
    if (f.guru) q.set('guru', f.guru);
    if (f.mapel) q.set('mapel', f.mapel);
    if (filters.ta) q.set('ta', filters.ta);
    Object.entries(extra).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) q.set(k, v); });
    return q.toString();
  }, [f, filters.ta]);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/rekap/absensi-guru?' + qs())
      .then(r => setData(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [qs]);
  useEffect(load, [load]);
  useEffect(() => { setPilih([]); }, [tab, f.periode, f.tanggal, f.dari, f.sampai, f.guru, f.mapel]);

  const hitung = data?.hitung || {};
  const rows = data?.rows || [];
  const guru = data?.guru || [];
  const alphaTotal = (hitung.A || 0) + (hitung.belum || 0);

  const detail = useMemo(() => rows, [rows]);

  return (
    <div className="space-y-4" data-page="rekap-absensi-guru">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Rekap Absensi Guru</h2>
          <p className="text-[12.5px] text-slate-500">
            Rekap kehadiran mengajar guru beserta jurnal mengajar. Filter berdasarkan guru, mata pelajaran, dan periode.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={docUrl('/api/rekap/absensi-guru/export?' + qs())} data-export-guru>
            <FileSpreadsheet size={15} /> Excel (.xlsx)
          </a>
          <button className="btn-soft" onClick={() => openDoc('/api/rekap/absensi-guru/cetak?' + qs())} data-cetak-guru>
            <Printer size={15} /> PDF / Cetak
          </button>
        </div>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Periode Rekap">
            <select className="input" value={f.periode} onChange={e => setF(s => ({ ...s, periode: e.target.value }))} data-periode>
              {PERIODE.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
          {f.periode === 'custom' ? (
            <>
              <Field label="Dari Tanggal">
                <input type="date" className="input" value={f.dari} onChange={e => setF(s => ({ ...s, dari: e.target.value }))} />
              </Field>
              <Field label="Sampai Tanggal">
                <input type="date" className="input" value={f.sampai} onChange={e => setF(s => ({ ...s, sampai: e.target.value }))} />
              </Field>
            </>
          ) : (
            <Field label={f.periode === 'tahun' ? 'Tahun Pelajaran (dari header)' : 'Tanggal Acuan'}>
              <input type="date" className="input" value={f.tanggal} disabled={f.periode === 'tahun'}
                onChange={e => setF(s => ({ ...s, tanggal: e.target.value }))} />
            </Field>
          )}
          <Field label="Nama Guru">
            <select className="input" value={f.guru} onChange={e => setF(s => ({ ...s, guru: e.target.value }))} data-filter-guru>
              <option value="">Semua Guru</option>
              {(data?.guru_list || []).map(g => <option key={g.id} value={g.id}>{g.nama}{g.jabatan ? ` — ${g.jabatan}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Mata Pelajaran">
            <select className="input" value={f.mapel} onChange={e => setF(s => ({ ...s, mapel: e.target.value }))} data-filter-mapel>
              <option value="">Semua Mata Pelajaran</option>
              {(data?.mapel_list || []).map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-primary btn-sm" onClick={load}><Search size={13} /> Terapkan Filter</button>
          <button className="btn-ghost btn-sm" onClick={() => setF({ periode: 'bulanan', tanggal: new Date().toISOString().slice(0, 10), dari: '', sampai: '', guru: '', mapel: '' })}>
            <RefreshCw size={13} /> Reset
          </button>
          {data ? <span className="ml-auto text-[12px] font-semibold text-slate-500">Periode: <b className="text-slate-700">{data.label}</b></span> : null}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Total Jam Mengajar" value={hitung.total || 0} sub={data?.label} icon={CalendarRange} tone="sky" />
        <Stat label="Hadir" value={hitung.H || 0} sub="absensi tercatat" icon={UserCheck} tone="emerald" />
        <Stat label="Izin" value={hitung.I || 0} sub="dengan keterangan" icon={Users} tone="violet" />
        <Stat label="Sakit" value={hitung.S || 0} sub="dengan keterangan" icon={Users} tone="orange" />
        <Stat label="Alpha / Belum Absen" value={alphaTotal} sub="perlu tindak lanjut" icon={Users} tone="rose" />
      </div>

      <div className="tabs">
        <button className={cx('tab', tab === 'guru' && 'active')} onClick={() => setTab('guru')}>Ringkasan per Guru</button>
        <button className={cx('tab', tab === 'detail' && 'active')} onClick={() => setTab('detail')}>Rincian & Jurnal Mengajar</button>
        {ctx.can && ctx.can('rekap_absensi_guru', 'write') ? (
          <button className={cx('tab flex items-center gap-1.5', tab === 'hapus' && 'active')} onClick={() => setTab('hapus')} data-tab-hapus-guru>
            <Trash2 size={14} /> Hapus Riwayat
          </button>
        ) : null}
      </div>

      {tab === 'hapus' ? (
        <HapusRiwayatGuru data={data} rows={detail} guruList={data?.guru_list || []}
          pilih={pilih} setPilih={setPilih} fHapus={fHapus} setFHapus={setFHapus}
          onReload={load} />
      ) : loading ? <Spinner /> : tab === 'guru' ? (
        <Card title="Rekap Kehadiran per Guru" subtitle={`${guru.length} guru · periode ${data?.label || '-'}`}>
          {!guru.length ? <Empty icon={UserCheck} title="Belum ada data" desc="Tidak ada jadwal atau absensi pada periode ini." /> : (
            <div className="tbl-wrap" style={{ maxHeight: '62vh' }}>
              <table className="tbl" data-tbl="rekap-guru">
                <thead>
                  <tr>
                    <th>No</th><th>Nama Guru</th><th>Mata Pelajaran</th>
                    <th className="c">Hadir</th><th className="c">Izin</th><th className="c">Sakit</th>
                    <th className="c">Alpha</th><th className="c">Total Jam</th><th className="c">% Hadir</th><th className="c">Jurnal</th>
                  </tr>
                </thead>
                <tbody>
                  {guru.map((g, i) => (
                    <tr key={g.guru_id}>
                      <td className="c">{i + 1}</td>
                      <td className="font-semibold text-slate-700">{g.guru_nama}</td>
                      <td className="text-[11.5px] text-slate-500">{g.mapel.join(', ') || '-'}</td>
                      <td className="c text-emerald-700 font-bold">{g.H}</td>
                      <td className="c">{g.I}</td>
                      <td className="c">{g.S}</td>
                      <td className="c text-rose-700 font-bold">{g.A_total}</td>
                      <td className="c">{g.total}</td>
                      <td className="c">{g.persen}%</td>
                      <td className="c">{g.materi}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>JUMLAH</td>
                    <td className="c">{hitung.H}</td><td className="c">{hitung.I}</td><td className="c">{hitung.S}</td>
                    <td className="c">{alphaTotal}</td><td className="c">{hitung.total}</td><td className="c" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Rincian Absensi & Jurnal Mengajar" subtitle={`${detail.length} baris · periode ${data?.label || '-'}`}>
          {!detail.length ? <Empty icon={CalendarRange} title="Belum ada data" desc="Tidak ada jam mengajar pada periode ini." /> : (
            <div className="tbl-wrap" style={{ maxHeight: '68vh' }}>
              <table className="tbl" data-tbl="detail-guru">
                <thead>
                  <tr>
                    <th>No</th><th>Tanggal</th><th>Hari</th><th>Guru</th><th>Mata Pelajaran</th><th>Jam</th>
                    <th>Kelas</th><th>Status</th><th>Jurnal Materi</th><th>Catatan</th><th>Bukti</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((r, i) => (
                    <tr key={r.tanggal + '-' + r.guru_id + '-' + r.sesi}>
                      <td className="c">{i + 1}</td>
                      <td className="whitespace-nowrap">{r.tanggal}</td>
                      <td>{r.hari_label}</td>
                      <td className="font-semibold text-slate-700">{r.guru_nama}</td>
                      <td>{r.mapel_nama}</td>
                      <td className="whitespace-nowrap text-[11.5px]">{r.jam}</td>
                      <td className="text-[11.5px]">{r.kelas_nama}</td>
                      <td>
                        <span className={cx('badge',
                          r.status === 'hadir' ? 'badge-aman' : r.status === 'izin' ? 'badge-pantau'
                            : r.status === 'sakit' ? 'badge-perhatian' : 'badge-siaga')}>{r.status_label}</span>
                      </td>
                      <td className="max-w-[280px]">{r.materi || <span className="text-slate-400">-</span>}</td>
                      <td className="max-w-[180px] text-[11.5px] text-slate-500">{r.catatan || '-'}</td>
                      <td className="c">{r.foto_url ? <a className="link" href={r.foto_url} target="_blank" rel="noreferrer">Lihat</a> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Alert tone="info" title="Cara membaca rekap">
        Status <b>Hadir</b>/<b>Izin</b>/<b>Sakit</b>/<b>Alpha</b> berasal dari absensi yang diisi guru. Jam mengajar yang belum
        memiliki absensi dihitung sebagai <b>Alpha / Belum Absen</b> agar terlihat pada laporan. Gunakan tombol
        <b> Excel</b> atau <b>PDF/Cetak</b> untuk laporan resmi.
      </Alert>
    </div>
  );
}


/* =====================================================================
   HAPUS RIWAYAT ABSENSI GURU
   · ceklis per baris + Pilih Semua → hapus terpilih
   · form rentang tanggal (+ guru) → hapus massal
   · setiap aksi memakai dialog konfirmasi (kata sandi/PIN)
   ===================================================================== */
function HapusRiwayatGuru({ data, rows, guruList, pilih, setPilih, fHapus, setFHapus, onReload }) {
  const toast = useToast();
  const [konfirm, setKonfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  /* baris yang dapat dihapus: hanya yang sudah memiliki absensi tercatat */
  const bisa = rows.filter(r => r.absensi_id);
  const keyOf = (r) => `${r.jadwal_id}|${r.tanggal}`;
  const semuaKey = bisa.map(keyOf);
  const semuaTerpilih = semuaKey.length > 0 && semuaKey.every(k => pilih.includes(k));
  const toggle = (k) => setPilih(list => list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
  const toggleSemua = () => setPilih(semuaTerpilih ? [] : semuaKey);

  async function jalankan(pin) {
    setBusy(true);
    try {
      const r = konfirm.mode === 'pilih'
        ? await api('/api/rekap/absensi-guru/hapus', {
          method: 'POST',
          body: {
            pin,
            items: pilih.map(k => {
              const [jadwal_id, tanggal] = k.split('|');
              return { jadwal_id: Number(jadwal_id), tanggal };
            })
          }
        })
        : await api('/api/rekap/absensi-guru/hapus-filter', { method: 'POST', body: { ...fHapus, pin } });
      toast.ok(r.pesan || 'Data dihapus.');
      setKonfirm(null);
      setPilih([]);
      onReload?.();
    } catch (e) { toast.err(e.message); throw e; }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3" data-hapus-riwayat-guru>
      <Card title="Hapus Berdasarkan Tanggal" subtitle="Menghapus absensi & jurnal mengajar guru pada rentang tanggal tertentu">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Dari Tanggal">
            <input type="date" className="input" value={fHapus.dari}
              onChange={e => setFHapus(v => ({ ...v, dari: e.target.value }))} data-hapus-guru-dari />
          </Field>
          <Field label="Sampai Tanggal">
            <input type="date" className="input" value={fHapus.sampai}
              onChange={e => setFHapus(v => ({ ...v, sampai: e.target.value }))} data-hapus-guru-sampai />
          </Field>
          <Field label="Guru (opsional)">
            <select className="input" value={fHapus.guru} onChange={e => setFHapus(v => ({ ...v, guru: e.target.value }))} data-hapus-guru-guru>
              <option value="">Semua guru</option>
              {guruList.map(g => <option key={g.id} value={g.id}>{g.nama}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <button className="btn bg-rose-600 text-white hover:brightness-95 w-full" disabled={!fHapus.dari || busy}
              data-hapus-guru-filter
              onClick={() => setKonfirm({
                mode: 'filter',
                ringkas: [
                  `Rentang tanggal: ${fHapus.dari || '-'} s.d. ${fHapus.sampai || fHapus.dari || '-'}`,
                  `Guru: ${guruList.find(g => String(g.id) === String(fHapus.guru))?.nama || 'Semua guru'}`,
                  'Absensi, jurnal mengajar, dan rekam izin guru pada kriteria tersebut akan dihapus permanen.'
                ]
              })}>
              <Trash2 size={14} /> Hapus Data Sesuai Filter
            </button>
          </div>
        </div>
        {!fHapus.dari ? <p className="mt-2 text-[11.5px] text-slate-400">Tanggal "Dari" wajib diisi; "Sampai" kosong = tanggal yang sama.</p> : null}
      </Card>

      <Card title="Riwayat Absensi Guru" subtitle={`${rows.length} baris · ${bisa.length} sudah memiliki absensi`}
        right={<div className="flex items-center gap-2">
          <span className="chip">{pilih.length} dipilih</span>
          <button className="btn bg-rose-600 text-white hover:brightness-95 btn-sm" disabled={!pilih.length || busy}
            data-hapus-guru-terpilih
            onClick={() => setKonfirm({ mode: 'pilih', ringkas: [`${pilih.length} baris absensi guru akan dihapus permanen.`] })}>
            <Trash2 size={13} /> Hapus Terpilih
          </button>
          <button className="btn-ghost btn-sm" onClick={onReload}><RefreshCw size={13} /> Muat Ulang</button>
        </div>}>
        {!rows.length ? (
          <Empty icon={CalendarRange} title="Belum ada data" desc="Ubah periode/filter di atas agar riwayat tampil." />
        ) : (
          <div className="tbl-wrap max-h-[62vh]">
            <table className="tbl" data-tbl="hapus-guru">
              <thead>
                <tr>
                  <th className="w-10 c">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                      checked={semuaTerpilih} onChange={toggleSemua} data-pilih-semua-guru />
                  </th>
                  <th className="w-10 c">No</th><th>Tanggal</th><th>Guru</th><th>Mata Pelajaran</th><th>Jam</th>
                  <th>Kelas</th><th className="c">Status</th><th>Jurnal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const k = keyOf(r);
                  const bisaHapus = !!r.absensi_id;
                  return (
                    <tr key={k + '-' + i} className={cx(pilih.includes(k) && 'bg-orange-50/50', !bisaHapus && 'text-slate-400')}>
                      <td className="c">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" disabled={!bisaHapus}
                          checked={pilih.includes(k)} onChange={() => toggle(k)} data-pilih-guru={k} />
                      </td>
                      <td className="c">{i + 1}</td>
                      <td className="whitespace-nowrap">{r.tanggal}</td>
                      <td className="font-semibold">{r.guru_nama}</td>
                      <td>{r.mapel_nama}</td>
                      <td className="whitespace-nowrap text-[11.5px]">{r.jam}</td>
                      <td className="text-[11.5px]">{r.kelas_nama}</td>
                      <td className="c">
                        <span className={cx('badge',
                          r.status === 'hadir' ? 'badge-aman' : r.status === 'izin' ? 'badge-pantau'
                            : r.status === 'sakit' ? 'badge-perhatian' : 'badge-netral')}>{r.status_label}</span>
                        {r.catatan_pengganti ? <span className="ml-1 text-[10px] italic text-violet-600">{r.catatan_pengganti}</span> : null}
                      </td>
                      <td className="max-w-[240px] text-[11.5px]">{r.materi || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Alert tone="warn" title="Baris tanpa absensi tidak dapat dihapus">
          Baris berstatus <b>Belum Absen</b> berasal dari jadwal (bukan data absensi), jadi tidak punya data untuk dihapus.
          Hanya baris dengan absensi tercatat yang dapat dipilih.
        </Alert>
      </Card>

      <HapusKonfirmasi open={!!konfirm} busy={busy}
        judul={konfirm?.mode === 'filter' ? 'Hapus Absensi Guru Sesuai Filter' : 'Hapus Absensi Guru Terpilih'}
        ringkas={konfirm?.ringkas || []}
        onClose={() => setKonfirm(null)} onConfirm={jalankan} />
    </div>
  );
}
