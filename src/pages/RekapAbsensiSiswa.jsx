import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award, CalendarRange, Download, FileSpreadsheet, Loader2, MessageCircle, Printer, RefreshCw,
  Search, Trash2, Trophy, Users
} from 'lucide-react';
import { api, docUrl, openDoc } from '../api';
import { Alert, Card, Empty, Field, Spinner, Stat, cx, useToast } from '../ui';
import RekapAbsensiWA from './PengaturanRekap';
import HapusKonfirmasi from '../components/HapusKonfirmasi';

const PERIODE = [
  { key: 'harian', label: 'Harian' },
  { key: 'mingguan', label: 'Mingguan' },
  { key: 'bulanan', label: 'Bulanan' },
  { key: 'tahun', label: 'Satu Tahun Pelajaran' },
  { key: 'custom', label: 'Rentang Tanggal' }
];
const RANKING = [
  { key: 'izin', label: 'Paling Banyak Izin', tone: 'sky', badge: 'badge-pantau' },
  { key: 'sakit', label: 'Paling Banyak Sakit', tone: 'orange', badge: 'badge-perhatian' },
  { key: 'alfa', label: 'Paling Banyak Alfa', tone: 'rose', badge: 'badge-siaga' },
  { key: 'bolos', label: 'Paling Banyak Bolos', tone: 'slate', badge: 'badge-waspada' }
];

export default function RekapAbsensiSiswa({ ctx }) {
  const { toast, filters, can } = ctx;
  const [tab, setTab] = useState('kelas');
  const [mode, setMode] = useState('kelas');
  const [f, setF] = useState({
    periode: 'bulanan', tanggal: new Date().toISOString().slice(0, 10),
    dari: '', sampai: '', kelas: '', siswa: '', q: '', mapel: ''
  });
  const [siswaQ, setSiswaQ] = useState('');
  const [data, setData] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rankLoad, setRankLoad] = useState(false);
  /* ---- hapus riwayat (ceklis & filter) ---- */
  const [pilih, setPilih] = useState([]);
  const [fHapus, setFHapus] = useState({ dari: '', sampai: '', kelas: '' });
  const [hapusKey, setHapusKey] = useState(0);

  const qs = useCallback((extra = {}) => {
    const q = new URLSearchParams();
    q.set('periode', f.periode);
    if (f.tanggal) q.set('tanggal', f.tanggal);
    if (f.dari) q.set('dari', f.dari);
    if (f.sampai) q.set('sampai', f.sampai);
    if (f.kelas) q.set('kelas', f.kelas);
    if (f.q) q.set('q', f.q);
    if (f.mapel) q.set('mapel', f.mapel);
    if (filters.ta) q.set('ta', filters.ta);
    Object.entries(extra).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) q.set(k, v); });
    return q.toString();
  }, [f, filters.ta]);

  const load = useCallback(() => {
    setLoading(true);
    const q = qs({ mode, siswa: mode === 'siswa' ? f.siswa : '' });
    api('/api/rekap/absensi-siswa?' + q)
      .then(r => setData(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [qs, mode, f.siswa]);
  useEffect(() => { if (tab !== 'whatsapp' && tab !== 'peringkat') load(); }, [tab, load]);
  useEffect(() => { setPilih([]); }, [tab, f.periode, f.tanggal, f.dari, f.sampai, f.kelas, f.mapel]);

  const loadRanking = useCallback(() => {
    setRankLoad(true);
    api('/api/rekap/ranking?' + qs({ limit: 10 }))
      .then(r => setRanking(r)).catch(e => toast.err(e.message)).finally(() => setRankLoad(false));
  }, [qs]);
  useEffect(() => { if (tab === 'peringkat') loadRanking(); }, [tab, loadRanking]);

  const siswaOptions = useMemo(() => {
    const list = data?.siswa_list || [];
    const kw = siswaQ.trim().toLowerCase();
    const dasar = kw ? list.filter(s => (s.nama + ' ' + (s.nisn || '') + ' ' + (s.kelas_nama || '')).toLowerCase().includes(kw)) : list;
    return dasar.slice(0, 60);
  }, [data, siswaQ]);

  const total = data?.total || {};
  const persenHadir = total.total ? Math.round((total.H / total.total) * 1000) / 10 : 0;

  return (
    <div className="space-y-4" data-page="rekap-absensi-siswa">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Rekap Absensi Siswa</h2>
          <p className="text-[12.5px] text-slate-500">
            Rekap kehadiran per kelas &amp; per siswa, peringkat ketidakhadiran, serta otomatisasi laporan WhatsApp Wali Kelas.
          </p>
        </div>
        {tab !== 'whatsapp' ? (
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost" href={docUrl('/api/rekap/absensi-siswa/export?' + qs({ mode }))} data-export-siswa>
              <FileSpreadsheet size={15} /> Excel (.xlsx)
            </a>
            <button className="btn-soft" onClick={() => openDoc('/api/rekap/absensi-siswa/cetak?' + qs({ mode }))} data-cetak-siswa>
              <Printer size={15} /> PDF / Cetak
            </button>
          </div>
        ) : null}
      </div>

      <div className="tabs">
        <button className={cx('tab flex items-center gap-1.5', tab === 'kelas' && 'active')} onClick={() => { setTab('kelas'); setMode('kelas'); }} data-tab="kelas">
          <Users size={14} /> Rekap Per Kelas
        </button>
        <button className={cx('tab flex items-center gap-1.5', tab === 'siswa' && 'active')} onClick={() => { setTab('siswa'); setMode('siswa'); }} data-tab="siswa">
          <Search size={14} /> Rekap Per Siswa
        </button>
        <button className={cx('tab flex items-center gap-1.5', tab === 'peringkat' && 'active')} onClick={() => setTab('peringkat')} data-tab="peringkat">
          <Trophy size={14} /> Peringkat Ketidakhadiran
        </button>
        {can('rekap_absensi_siswa', 'view') ? (
          <button className={cx('tab flex items-center gap-1.5', tab === 'whatsapp' && 'active')} onClick={() => setTab('whatsapp')} data-tab="whatsapp">
            <MessageCircle size={14} /> WhatsApp Wali Kelas
          </button>
        ) : null}
        {can('rekap_absensi_siswa', 'write') ? (
          <button className={cx('tab flex items-center gap-1.5', tab === 'hapus' && 'active')} onClick={() => setTab('hapus')} data-tab="hapus">
            <Trash2 size={14} /> Hapus Riwayat
          </button>
        ) : null}
      </div>

      {tab !== 'whatsapp' ? (
        <Card>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Periode Rekap">
              <select className="input" value={f.periode} onChange={e => setF(s => ({ ...s, periode: e.target.value }))} data-periode-siswa>
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
              <Field label={f.periode === 'tahun' ? 'Tahun Pelajaran (header)' : 'Tanggal Acuan'}>
                <input type="date" className="input" value={f.tanggal} disabled={f.periode === 'tahun'}
                  onChange={e => setF(s => ({ ...s, tanggal: e.target.value }))} />
              </Field>
            )}
            <Field label="Kelas">
              <select className="input" value={f.kelas} onChange={e => setF(s => ({ ...s, kelas: e.target.value }))} data-filter-kelas>
                <option value="">Semua Kelas</option>
                {(data?.kelas_list || []).map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
            </Field>
            <Field label="Mata Pelajaran">
              <select className="input" value={f.mapel} onChange={e => setF(s => ({ ...s, mapel: e.target.value }))}>
                <option value="">Semua Mata Pelajaran</option>
                {(data?.mapel_list || []).map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
              </select>
            </Field>
            {mode === 'siswa' ? (
              <Field label="Cari / Pilih Siswa">
                <input className="input" placeholder="Ketik nama / NISN…" value={siswaQ} onChange={e => setSiswaQ(e.target.value)} />
                <select className="input mt-2" value={f.siswa} onChange={e => setF(s => ({ ...s, siswa: e.target.value }))} data-filter-siswa>
                  <option value="">Semua siswa (akumulasi)</option>
                  {siswaOptions.map(s => <option key={s.id} value={s.id}>{s.nama} — {s.kelas_nama || '-'}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Cari Nama / NISN">
                <input className="input" placeholder="Cari di dalam kelas…" value={f.q} onChange={e => setF(s => ({ ...s, q: e.target.value }))} />
              </Field>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-primary btn-sm" onClick={load}><Search size={13} /> Terapkan Filter</button>
            <button className="btn-ghost btn-sm" onClick={() => { setF({ periode: 'bulanan', tanggal: new Date().toISOString().slice(0, 10), dari: '', sampai: '', kelas: '', siswa: '', q: '', mapel: '' }); setSiswaQ(''); }}>
              <RefreshCw size={13} /> Reset
            </button>
            {data ? <span className="ml-auto text-[12px] font-semibold text-slate-500">Periode: <b className="text-slate-700">{data.label}</b></span> : null}
          </div>
        </Card>
      ) : null}

      {tab === 'whatsapp' ? (
        <RekapAbsensiWA ctx={ctx} readOnly={!can('rekap_absensi_siswa', 'write')} compact />
      ) : tab === 'hapus' ? (
        <HapusRiwayatSiswa key={hapusKey} data={data} loading={loading} kelasList={data?.kelas_list || []}
          pilih={pilih} setPilih={setPilih} fHapus={fHapus} setFHapus={setFHapus}
          onFilter={load} onSelesai={() => { setPilih([]); setHapusKey(k => k + 1); load(); }} />
      ) : tab === 'peringkat' ? (
        <>
          {ranking ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Stat label="Siswa Dengan Catatan" value={ranking.jumlah_siswa} sub={`periode ${ranking.label}`} icon={Users} tone="sky" />
                <Stat label="Total Catatan Presensi" value={ranking.total.total || 0} sub="seluruh status" icon={CalendarRange} tone="emerald" />
              </div>
              {rankLoad ? <Spinner /> : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {RANKING.map(r => {
                    const rows = (ranking.ranking && ranking.ranking[r.key]) || [];
                    return (
                      <Card key={r.key} title={r.label} subtitle={`10 siswa teratas · ${ranking.label}`}
                        right={<span className={cx('badge', r.badge)}>{r.key.toUpperCase()}</span>}>
                        {!rows.length ? <Empty icon={Award} title="Belum ada data" desc="Tidak ada siswa dengan status ini pada periode tersebut." /> : (
                          <div className="tbl-wrap" style={{ maxHeight: '40vh' }}>
                            <table className="tbl" data-ranking={r.key}>
                              <thead><tr><th className="w-10">#</th><th>Nama Siswa</th><th>Kelas</th>
                                <th className="c">Jumlah</th><th className="c">% Hadir</th></tr></thead>
                              <tbody>
                                {rows.map(s => (
                                  <tr key={s.siswa_id}>
                                    <td className="c font-bold text-slate-400">{s.peringkat}</td>
                                    <td className="font-semibold text-slate-700">{s.nama}</td>
                                    <td className="text-[11.5px]">{s.kelas_nama || '-'}</td>
                                    <td className="c"><span className={cx('badge', r.badge)}>{s.nilai}</span></td>
                                    <td className="c">{s.persen_hadir}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
              <Alert tone="info" title="Pemanfaatan peringkat">
                Daftar ini membantu Guru BK dan Wali Kelas menemukan siswa yang membutuhkan perhatian khusus.
                Alpha &amp; Bolos secara otomatis tercatat ke Buku Poin sesuai bobot di Master Kategori Poin.
              </Alert>
            </>
          ) : <Spinner />}
        </>
      ) : tab === 'hapus' ? null : loading ? <Spinner /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Hadir" value={total.H || 0} sub={`${persenHadir}% kehadiran`} icon={Users} tone="emerald" />
            <Stat label="Sakit" value={total.S || 0} sub="dengan surat/keterangan" icon={Users} tone="orange" />
            <Stat label="Izin" value={total.I || 0} sub="dengan keterangan" icon={Users} tone="sky" />
            <Stat label="Alpha" value={total.A || 0} sub="tanpa keterangan" icon={Users} tone="rose" />
            <Stat label="Bolos" value={total.B || 0} sub="keluar kelas tanpa izin" icon={Users} tone="slate" />
          </div>

          <Card title={tab === 'kelas' ? 'Rekap Kehadiran Seluruh Siswa' : 'Akumulasi Kehadiran'}
            subtitle={`${(data?.siswa || []).length} siswa · periode ${data?.label || '-'}`}>
            {!(data?.siswa || []).length ? <Empty icon={Users} title="Belum ada data" desc="Belum ada presensi pada periode/filter ini." /> : (
              <div className="tbl-wrap" style={{ maxHeight: '58vh' }}>
                <table className="tbl" data-tbl="rekap-siswa">
                  <thead>
                    <tr>
                      <th className="w-10">No</th><th>NISN</th><th>Nama Siswa</th><th>Kelas</th>
                      <th className="c">Hadir</th><th className="c">Sakit</th><th className="c">Izin</th>
                      <th className="c">Alpha</th><th className="c">Bolos</th><th className="c">Total</th><th className="c">% Hadir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.siswa.map((s, i) => (
                      <tr key={s.siswa_id}>
                        <td className="c">{i + 1}</td>
                        <td className="text-[11.5px]">{s.nisn || '-'}</td>
                        <td className="font-semibold text-slate-700">{s.nama}</td>
                        <td className="text-[11.5px]">{s.kelas_nama || '-'}</td>
                        <td className="c text-emerald-700 font-bold">{s.H}</td>
                        <td className="c">{s.S}</td>
                        <td className="c">{s.I}</td>
                        <td className="c text-rose-700 font-bold">{s.A}</td>
                        <td className="c text-rose-700 font-bold">{s.B}</td>
                        <td className="c">{s.total}</td>
                        <td className="c">
                          <span className={cx('badge', s.persen_hadir >= 90 ? 'badge-aman' : s.persen_hadir >= 75 ? 'badge-perhatian' : 'badge-siaga')}>
                            {s.persen_hadir}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>JUMLAH</td>
                      <td className="c">{total.H}</td><td className="c">{total.S}</td><td className="c">{total.I}</td>
                      <td className="c">{total.A}</td><td className="c">{total.B}</td><td className="c">{total.total}</td><td className="c">{persenHadir}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {mode === 'siswa' && (data?.rows || []).length ? (
            <Card title="Riwayat Absensi Detail" subtitle={`${data.rows.length} catatan presensi`}>
              <div className="tbl-wrap" style={{ maxHeight: '52vh' }}>
                <table className="tbl">
                  <thead><tr><th>No</th><th>Tanggal</th><th>Siswa</th><th>Kelas</th><th>Mata Pelajaran</th>
                    <th>Status</th><th>Keterangan</th><th>Pencatat</th></tr></thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={r.id}>
                        <td className="c">{i + 1}</td>
                        <td className="whitespace-nowrap">{r.tanggal}</td>
                        <td className="font-semibold">{r.siswa_nama}</td>
                        <td className="text-[11.5px]">{r.kelas_nama || '-'}</td>
                        <td>{r.mapel_nama || '-'}</td>
                        <td><span className={cx('badge',
                          r.status === 'H' ? 'badge-aman' : r.status === 'S' ? 'badge-perhatian'
                            : r.status === 'I' ? 'badge-pantau' : 'badge-siaga')}>
                          {(data.label_status || {})[r.status] || r.status}
                        </span></td>
                        <td className="max-w-[220px] text-[11.5px]">{r.keterangan || '-'}</td>
                        <td className="text-[11.5px]">{r.oleh_nama || r.pencatat || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}


/* =====================================================================
   HAPUS RIWAYAT ABSENSI SISWA
   · ceklis per baris + Pilih Semua → hapus terpilih
   · form filter "Dari tanggal s.d. Sampai tanggal" + kelas → hapus massal
   · setiap aksi memakai dialog konfirmasi (kata sandi/PIN)
   ===================================================================== */
function HapusRiwayatSiswa({ data, loading, kelasList, pilih, setPilih, fHapus, setFHapus, onFilter, onSelesai }) {
  const toast = useToast();
  const [konfirm, setKonfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = data?.rows || [];
  const idsOf = (row) => (Array.isArray(row.ids) && row.ids.length ? row.ids : [row.id]).map(Number);
  const semuaId = rows.flatMap(idsOf);
  const semuaTerpilih = semuaId.length > 0 && semuaId.every(id => pilih.includes(id));

  const toggleRow = (row) => {
    const ids = idsOf(row);
    const allSelected = ids.every(id => pilih.includes(id));
    setPilih(list => allSelected ? list.filter(id => !ids.includes(id)) : [...new Set([...list, ...ids])]);
  };
  const toggleSemua = () => setPilih(semuaTerpilih ? [] : semuaId);

  async function jalankan(pin) {
    setBusy(true);
    try {
      const r = konfirm.mode === 'pilih'
        ? await api('/api/rekap/absensi-siswa/hapus', { method: 'POST', body: { ids: pilih, pin } })
        : await api('/api/rekap/absensi-siswa/hapus-filter', {
          method: 'POST', body: { ...fHapus, pin }
        });
      toast.ok(r.pesan || 'Data dihapus.');
      setKonfirm(null);
      onSelesai?.();
    } catch (e) { toast.err(e.message); throw e; }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3" data-hapus-riwayat-siswa>
      <Card title="Hapus Berdasarkan Tanggal &amp; Kelas"
        subtitle="Menghapus seluruh presensi siswa pada rentang tanggal dan kelas yang dipilih">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Dari Tanggal">
            <input type="date" className="input" value={fHapus.dari}
              onChange={e => setFHapus(v => ({ ...v, dari: e.target.value }))} data-hapus-dari />
          </Field>
          <Field label="Sampai Tanggal">
            <input type="date" className="input" value={fHapus.sampai}
              onChange={e => setFHapus(v => ({ ...v, sampai: e.target.value }))} data-hapus-sampai />
          </Field>
          <Field label="Kelas">
            <select className="input" value={fHapus.kelas} onChange={e => setFHapus(v => ({ ...v, kelas: e.target.value }))} data-hapus-kelas>
              <option value="">Semua kelas</option>
              {kelasList.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <button className="btn bg-rose-600 text-white hover:brightness-95 w-full"
              disabled={!fHapus.dari || busy} data-hapus-filter
              onClick={() => setKonfirm({
                mode: 'filter',
                ringkas: [
                  `Rentang tanggal: ${fHapus.dari || '-'} s.d. ${fHapus.sampai || fHapus.dari || '-'}`,
                  `Kelas: ${kelasList.find(k => String(k.id) === String(fHapus.kelas))?.nama || 'Semua kelas'}`,
                  'Seluruh presensi siswa pada kriteria tersebut akan dihapus permanen dari rekap.'
                ]
              })}>
              <Trash2 size={14} /> Hapus Data Sesuai Filter
            </button>
          </div>
        </div>
        {!fHapus.dari ? <p className="mt-2 text-[11.5px] text-slate-400">Tanggal "Dari" wajib diisi; "Sampai" kosong = tanggal yang sama.</p> : null}
      </Card>

      <Card title="Riwayat Absensi Siswa" subtitle={`${rows.length} baris pada periode ${data?.label || '-'}`}
        right={<div className="flex items-center gap-2">
          <span className="chip">{pilih.length} dipilih</span>
          <button className="btn bg-rose-600 text-white hover:brightness-95 btn-sm" disabled={!pilih.length || busy}
            data-hapus-terpilih
            onClick={() => setKonfirm({
              mode: 'pilih',
              ringkas: [`${pilih.length} baris presensi terpilih akan dihapus permanen dari rekap kehadiran.`]
            })}>
            <Trash2 size={13} /> Hapus Terpilih
          </button>
          <button className="btn-ghost btn-sm" onClick={onFilter}><RefreshCw size={13} /> Muat Ulang</button>
        </div>}>
        {loading ? <Spinner /> : !rows.length ? (
          <Empty icon={CalendarRange} title="Belum ada riwayat" desc="Ubah periode/filter di atas agar riwayat absensi tampil." />
        ) : (
          <div className="tbl-wrap max-h-[64vh]">
            <table className="tbl" data-tbl="hapus-siswa">
              <thead>
                <tr>
                  <th className="w-10 c">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                      checked={semuaTerpilih} onChange={toggleSemua} data-pilih-semua />
                  </th>
                  <th className="w-10 c">No</th><th>Tanggal</th><th>Siswa</th><th>Kelas</th><th>Mata Pelajaran</th>
                  <th className="c">Status</th><th>Keterangan</th><th>Pencatat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={cx(idsOf(r).every(id => pilih.includes(id)) && 'bg-orange-50/50')}>
                    <td className="c">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                        checked={idsOf(r).every(id => pilih.includes(id))} onChange={() => toggleRow(r)}
                        data-pilih={r.id} />
                    </td>
                    <td className="c">{i + 1}</td>
                    <td className="whitespace-nowrap">{r.tanggal}</td>
                    <td className="font-semibold">{r.siswa_nama}</td>
                    <td className="text-[11.5px]">{r.kelas_nama || '-'}</td>
                    <td>{r.mapel_nama || '-'}</td>
                    <td className="c">
                      <span className={cx('badge', r.status === 'H' ? 'badge-aman' : r.status === 'S' ? 'badge-perhatian'
                        : r.status === 'I' ? 'badge-pantau' : 'badge-siaga')}>
                        {(data?.label_status || {})[r.status] || r.status}
                      </span>
                    </td>
                    <td className="max-w-[200px] text-[11.5px]">{r.keterangan || '-'}</td>
                    <td className="text-[11.5px]">{r.oleh_nama || r.pencatat || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Alert tone="warn" title="Keamanan data historis">
          Setiap penghapusan meminta kata sandi akun Anda dan dicatat pada Log Aktivitas. Snapshot baris yang
          dihapus disimpan otomatis di server (3 berkas terakhir) untuk keperluan audit.
        </Alert>
      </Card>

      <HapusKonfirmasi open={!!konfirm} busy={busy}
        judul={konfirm?.mode === 'filter' ? 'Hapus Riwayat Sesuai Filter' : 'Hapus Riwayat Terpilih'}
        ringkas={konfirm?.ringkas || []}
        onClose={() => setKonfirm(null)} onConfirm={jalankan} />
    </div>
  );
}
