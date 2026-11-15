import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award, CalendarDays, CheckSquare, Clock, FileText, HeartHandshake, Loader2, MessageCircle, Pencil, Plus, Search,
  Send, Trash2, Upload, Users, X
} from 'lucide-react';
import { api, openDoc, tgl, tglPendek, waktu } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, StatusBadge, cx, useToast } from '../ui';
import ImportModal from '../components/ImportModal';

export default function Siswa({ ctx }) {
  const { filters, can, refreshKey, bump, toast, boot } = ctx;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [master, setMaster] = useState({ kelas: [], kategori: [] });
  const [quick, setQuick] = useState({ kategori_id: '', keterangan: '', tanggal: '' });
  const [savingQuick, setSavingQuick] = useState(false);
  const [filter, setFilter] = useState({ q: '', kelas: '', status: 'all', status_siswa: 'aktif' });
  const [edit, setEdit] = useState(null);
  const [detail, setDetail] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [wa, setWa] = useState(null);
  const [selected, setSelected] = useState([]);
  const [selRiwayat, setSelRiwayat] = useState([]);
  const [bulkKelas, setBulkKelas] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [waMassal, setWaMassal] = useState(null);   // hasil kirim masal
  const [waLog, setWaLog] = useState([]);
  const [waCfg, setWaCfg] = useState({ cooldown_jam: 24, gateway_aktif: false });
  const [locks, setLocks] = useState({});
  const [waBusy, setWaBusy] = useState(false);
  const [waTemplate, setWaTemplate] = useState('');

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams({ ta: filters.ta || '', ...filter });
    api('/api/siswa?' + q.toString())
      .then(r => setRows(r.rows))
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { api('/api/master').then(m => setMaster({ kelas: m.kelas, kategori: m.kategori })).catch(() => {}); }, []);
  useEffect(load, [filters.ta, filter.kelas, filter.status, filter.status_siswa, refreshKey]);

  useEffect(() => { setSelected([]); }, [filter.kelas, filter.status, filter.status_siswa, filter.q, refreshKey]);

  /* dibuka dari halaman lain (mis. Deteksi Dini): langsung tampilkan Kartu Siswa */
  useEffect(() => {
    if (!ctx.openSiswaId) return;
    let alive = true;
    api('/api/siswa/' + ctx.openSiswaId)
      .then(r => { if (alive) { setDetail(r); setSelRiwayat([]); } })
      .catch(e => toast.err(e.message))
      .finally(() => ctx.clearOpenSiswa && ctx.clearOpenSiswa());
    return () => { alive = false; };
  }, [ctx.openSiswaId]);

  const semuaRiwayat = detail ? (detail.riwayat || []).length > 0 && selRiwayat.length === (detail.riwayat || []).length : false;
  const toggleRiwayat = id => setSelRiwayat(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const toggleSemuaRiwayat = () => setSelRiwayat(semuaRiwayat ? [] : (detail?.riwayat || []).map(r => r.id));

  async function hapusRiwayat(ids) {
    const list = ids || selRiwayat;
    if (!list.length) return toast.err('Pilih minimal satu riwayat kejadian.');
    if (!window.confirm(`Hapus ${list.length} riwayat kejadian terpilih? Data dipindahkan ke Kotak Sampah dan masih dapat dipulihkan.`)) return;
    setSavingQuick(true);
    try {
      const r = await api('/api/kejadian/bulk-delete', { method: 'POST', body: { ids: list } });
      toast.ok(r.pesan || 'Riwayat kejadian dihapus.');
      const fresh = await api('/api/siswa/' + detail.siswa.id);
      setDetail(fresh); setSelRiwayat([]);
      load(); bump();
    } catch (e) { toast.err(e.message); }
    finally { setSavingQuick(false); }
  }

  const semuaDipilih = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(semuaDipilih ? [] : rows.map(r => r.id));
  const toggle = id => setSelected(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  async function aksiMasal(aksi) {
    if (!selected.length) return toast.err('Pilih minimal satu siswa terlebih dahulu.');
    if (aksi === 'delete' && !window.confirm(`Hapus ${selected.length} siswa terpilih beserta seluruh riwayat kejadian & catatan pembinaannya?`)) return;
    if (aksi === 'kelas' && !bulkKelas) return toast.err('Pilih kelas tujuan terlebih dahulu.');
    setBulkBusy(true);
    try {
      const r = await api('/api/siswa/bulk', { method: 'POST', body: { aksi, ids: selected, kelas_id: bulkKelas } });
      toast.ok(r.pesan || 'Aksi masal berhasil.');
      setSelected([]);
      load(); bump();
    } catch (e) { toast.err(e.message); }
    finally { setBulkBusy(false); }
  }

  /* ---------- WhatsApp masal & riwayat ---------- */
  const loadWa = useCallback(() => {
    api('/api/wa/log?limit=60').then(r => { setWaLog(r.rows || []); setWaCfg({ cooldown_jam: r.cooldown_jam, gateway_aktif: waCfg.gateway_aktif }); }).catch(() => {});
  }, []);
  useEffect(() => { if (can('siswa', 'view')) loadWa(); }, [refreshKey]);
  useEffect(() => {
    if (!rows.length) { setLocks({}); return; }
    const ids = rows.map(r => r.id).join(',');
    api('/api/wa/status?ids=' + ids).then(r => { setLocks(r.locks || {}); setWaCfg({ cooldown_jam: r.cooldown_jam, gateway_aktif: r.gateway_aktif }); }).catch(() => {});
  }, [rows]);

  async function kirimMassal() {
    if (!selected.length) return toast.err('Pilih minimal satu siswa terlebih dahulu.');
    setWaBusy(true);
    try {
      const r = await api('/api/wa/massal', { method: 'POST', body: { ids: selected, template: waTemplate } });
      setWaMassal(r);
      toast.ok(r.pesan);
      loadWa();
    } catch (e) { toast.err(e.message); }
    finally { setWaBusy(false); }
  }

  const stats = useMemo(() => ({
    total: rows.length,
    kritis: rows.filter(r => ['Kritis', 'Siaga', 'Waspada'].includes(r.status.label)).length,
    prestasi: rows.reduce((a, r) => a + r.pres, 0)
  }), [rows]);

  async function hapus(r) {
    if (!window.confirm(`Hapus ${r.nama} beserta seluruh riwayat kejadiannya? Tindakan ini tidak dapat dibatalkan.`)) return;
    try { await api('/api/siswa/' + r.id, { method: 'DELETE' }); toast.ok('Siswa dihapus.'); load(); }
    catch (e) { toast.err(e.message); }
  }
  async function kirimWA(id) {
    try {
      setWa(await api('/api/wa/siswa/' + id, { method: 'POST' }));
      /* segarkan riwayat + status penguncian jeda setelah pengiriman */
      loadWa();
      api('/api/wa/status?ids=' + rows.map(r => r.id).join(','))
        .then(r => setLocks(r.locks || {})).catch(() => {});
    } catch (e) { toast.err(e.message); }
  }
  async function bukaDetail(r) {
    try { setDetail(await api('/api/siswa/' + r.id)); setQuick({ kategori_id: '', keterangan: '', tanggal: '' }); setSelRiwayat([]); }
    catch (e) { toast.err(e.message); }
  }
  async function simpanPoin(e) {
    e && e.preventDefault();
    if (!quick.kategori_id) return toast.err('Pilih kategori poin terlebih dahulu.');
    setSavingQuick(true);
    try {
      await api('/api/kejadian/save', {
        method: 'POST',
        body: {
          siswa_id: detail.siswa.id, kategori_id: quick.kategori_id, keterangan: quick.keterangan,
          tanggal: quick.tanggal || new Date().toISOString().slice(0, 10),
          ta_id: filters.ta
        }
      });
      toast.ok('Transaksi poin tercatat.');
      setDetail(await api('/api/siswa/' + detail.siswa.id));
      setQuick({ kategori_id: '', keterangan: '', tanggal: '' });
      load();
    } catch (e2) { toast.err(e2.message); }
    finally { setSavingQuick(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Data Siswa</h2>
          <p className="text-[12.5px] text-slate-500">Master data siswa beserta nomor HP orang tua untuk notifikasi WhatsApp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setImportOpen(true)}><Upload size={15} /> Import Excel</button>
          <a className="btn-ghost" href={(window.__BASE__ || '') + '/api/siswa-template.xlsx'} download><FileText size={15} /> Template</a>
          {can('siswa', 'write') ? <button className="btn-primary" onClick={() => setEdit({ gender: 'L' })} data-guide-target="setup-student-add"><Plus size={15} /> Tambah Siswa</button> : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Siswa Terdaftar" value={stats.total} icon={Users} />
        <MiniStat label="Perlu Perhatian" value={stats.kritis} icon={AlertIcon} tone="rose" sub="Status Kritis / Siaga / Waspada" />
        <MiniStat label="Total Poin Prestasi" value={stats.prestasi} icon={Award} tone="violet" />
      </div>

      <Card title="Daftar Siswa" subtitle={`${rows.length} siswa pada periode & filter aktif`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input !w-[200px] !py-1.5 !pl-8 text-[12px]" placeholder="Cari nama / NIS / NISN…"
                value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') load(); }} />
            </div>
            <select className="input !w-auto !py-1.5 text-[12px]" value={filter.kelas} onChange={e => setFilter(f => ({ ...f, kelas: e.target.value }))}>
              <option value="">Semua kelas</option>
              {master.kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
            <select className="input !w-auto !py-1.5 text-[12px]" value={filter.status_siswa || 'aktif'}
              data-status-siswa onChange={e => setFilter(f => ({ ...f, status_siswa: e.target.value }))}>
              <option value="aktif">Siswa Aktif</option>
              <option value="lulus">Siswa Lulus</option>
              <option value="nonaktif">Siswa Nonaktif</option>
              <option value="semua">Semua siswa</option>
            </select>
            <select className="input !w-auto !py-1.5 text-[12px]" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
              <option value="all">Semua status</option>
              {(boot.settings.status_rules || []).map(r => <option key={r.label} value={r.key || r.label.toLowerCase()}>{r.label}</option>)}
            </select>
            <button className="btn-soft btn-sm" onClick={load}>Terapkan</button>
          </div>
        }>
        {/* toolbar aksi masal */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
            <CheckSquare size={14} className="text-orange-500" /> {selected.length} dipilih
          </span>
          {selected.length ? (
            <button onClick={() => setSelected([])} className="chip !py-0.5 hover:!border-orange-300">
              <X size={11} /> Bersihkan
            </button>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {can('siswa', 'write') ? (
              <>
                <select className="input !w-auto !py-1.5 text-[12px]" value={bulkKelas}
                  onChange={e => setBulkKelas(e.target.value)} disabled={!selected.length}>
                  <option value="">— kelas tujuan —</option>
                  {master.kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
                </select>
                <button className="btn-soft btn-sm" disabled={!selected.length || bulkBusy} onClick={() => aksiMasal('kelas')}>
                  {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Pindah Kelas Masal
                </button>
              </>
            ) : null}
            {can('siswa', 'delete') ? (
              <button className="btn-danger btn-sm" disabled={!selected.length || bulkBusy} onClick={() => aksiMasal('delete')}>
                <Trash2 size={13} /> Hapus Terpilih
              </button>
            ) : null}
            <button className="btn-primary btn-sm" disabled={!selected.length || waBusy} onClick={kirimMassal}
              data-wa-massal="1" title={`Jeda kirim ulang ${waCfg.cooldown_jam} jam per siswa`}>
              {waBusy ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} Kirim WA Peringatan Masal
            </button>
          </div>
        </div>

        {loading ? <Spinner /> : rows.length ? (
          <div className="tbl-wrap max-h-[74vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-9 text-center">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                      checked={semuaDipilih} onChange={toggleAll}
                      title={semuaDipilih ? 'Batalkan pilih semua' : 'Pilih semua'} />
                  </th>
                  <th>Nama / NISN</th><th>Kelas</th><th className="text-center">JK</th><th>Tanggal Lahir</th>
                  <th>No HP Orang Tua</th><th className="text-center">Poin</th><th>Status</th><th className="w-[110px]">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={selected.includes(r.id) ? 'bg-orange-50/60' : ''}>
                    <td className="text-center">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                        checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td>
                      <button onClick={() => bukaDetail(r)} className="text-left">
                        <span className="font-semibold text-slate-700 hover:text-orange-600">{r.nama}</span>
                        <span className="block text-[11px] text-slate-400">NIS {r.nis || '-'} · NISN {r.nisn || '-'}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap">{r.kelas_nama || '-'}</td>
                    <td className="text-center">{r.gender === 'P' ? 'P' : 'L'}</td>
                    <td className="whitespace-nowrap text-[12px]">{tglPendek(r.tanggal_lahir)}</td>
                    <td>
                      {r.parent_phone ? (
                        <>
                          <button onClick={() => kirimWA(r.id)} disabled={!!locks[r.id]}
                            title={locks[r.id] ? `Sudah dikirim ${locks[r.id].terakhir} — terbuka lagi ${locks[r.id].sampai}` : 'Kirim peringatan WhatsApp'}
                            className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold hover:underline',
                              locks[r.id] ? 'cursor-not-allowed text-slate-400' : 'text-emerald-700')}>
                            <MessageCircle size={13} /> {r.parent_phone}
                          </button>
                          {locks[r.id] ? (
                            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-amber-600" data-wa-lock={r.id}>
                              <Clock size={10} /> terkunci ± {locks[r.id].sisa_jam} jam
                            </span>
                          ) : null}
                        </>
                      ) : <span className="text-[11.5px] text-slate-400">belum diisi</span>}
                    </td>
                    <td className="text-center">
                      <span className="text-[11.5px] font-semibold text-rose-600">{r.pel}</span>
                      <span className="text-[11px] text-slate-300"> / </span>
                      <span className="text-[11.5px] font-semibold text-violet-600">{r.pres}</span>
                      <span className="block text-[10.5px] text-slate-400">bersih {r.bersih}</span>
                    </td>
                    <td>
                      <StatusBadge label={r.status.label} size="sm" />
                      {r.status_siswa && r.status_siswa !== 'aktif' ? (
                        <span className={cx('mt-1 block w-fit rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase',
                          r.status_siswa === 'lulus' ? 'bg-violet-100 text-violet-700' : 'bg-slate-200 text-slate-600')}
                          data-siswa-status>{r.status_siswa}</span>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => bukaDetail(r)} title="Detail" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><FileText size={14} /></button>
                        {can('siswa', 'write') ? <button onClick={() => setEdit(r)} title="Ubah" className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50"><Pencil size={14} /></button> : null}
                        {can('siswa', 'delete') ? <button onClick={() => hapus(r)} title="Hapus" className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Users} title="Tidak ada siswa" desc="Ubah filter atau tambahkan siswa baru / import dari Excel." />}
      </Card>

      {/* riwayat pengiriman WhatsApp (tanggal · waktu · akun pengirim) */}
      <Card title="Riwayat Pengiriman WhatsApp" subtitle="Peringatan yang sudah dikirim ke orang tua — lengkap dengan akun pengirim"
        right={<button className="btn-ghost btn-sm" onClick={loadWa}>Muat ulang</button>}>
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] text-amber-900">
          <Clock size={13} />
          Penguncian jeda: satu siswa tidak dapat dikirimi pesan lagi selama <b>{waCfg.cooldown_jam} jam</b> sejak pengiriman terakhir
          {waCfg.gateway_aktif ? ' · gateway WhatsApp aktif (terkirim otomatis)' : ' · gateway belum aktif (tautan WhatsApp dibuka manual)'}.
          Ubah durasi jeda di <b>Pengaturan → WhatsApp Gateway</b>.
        </div>
        {waLog.length ? (
          <div className="tbl-wrap max-h-[320px]">
            <table className="tbl" data-tbl="wa-log">
              <thead>
                <tr><th className="w-28">Tanggal</th><th className="w-16">Waktu</th><th>Siswa</th><th>No. HP</th>
                  <th>Jenis</th><th>Status</th><th>Akun Pengirim</th><th className="w-12" /></tr>
              </thead>
              <tbody>
                {waLog.map(l => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-[12px]">{tglPendek(l.created_at)}</td>
                    <td className="whitespace-nowrap text-[12px]">{String(l.created_at || '').slice(11, 16)}</td>
                    <td className="font-semibold text-slate-700">{l.nama}</td>
                    <td className="whitespace-nowrap text-[12px]">{l.phone || '-'}</td>
                    <td><span className="chip !py-0.5">{l.jenis === 'massal' ? 'Masal' : 'Perorangan'}</span></td>
                    <td><span className={cx('badge', l.status === 'gagal' ? 'badge-siaga' : l.status === 'manual' ? 'badge-pantau' : 'badge-aman')}>
                      {l.status || 'terkirim'}</span></td>
                    <td className="text-[12px]">{l.oleh_nama || '-'}</td>
                    <td>
                      <button className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" title="Lihat pesan"
                        onClick={() => setWaMassal({ tautan: [], pratinjau: l })}><MessageCircle size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={MessageCircle} title="Belum ada pengiriman" desc="Kirim peringatan ke orang tua lewat tombol WhatsApp pada daftar siswa." />}
      </Card>

      <FormSiswa open={!!edit} row={edit} kelas={master.kelas} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); load(); bump(); }} toast={toast} />

      <ImportModal open={importOpen} jenis="siswa" onClose={() => setImportOpen(false)} onDone={() => { load(); bump(); }} />

      {/* hasil kirim masal / pratinjau pesan */}
      <Modal open={!!waMassal} onClose={() => setWaMassal(null)} size="md" title="Hasil Pengiriman WhatsApp"
        subtitle={waMassal?.pratinjau ? `Pesan untuk ${waMassal.pratinjau.nama}` : `${(waMassal?.terkirim || []).length} pesan diproses`}>
        {waMassal?.pratinjau ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-emerald-50/70 p-3 text-[12.5px] leading-relaxed text-slate-700 whitespace-pre-wrap ring-1 ring-emerald-100">{waMassal.pratinjau.pesan}</div>
            <p className="text-[11.5px] text-slate-500">Dikirim oleh <b>{waMassal.pratinjau.oleh_nama || '-'}</b> pada {waktu(waMassal.pratinjau.created_at)}.</p>
          </div>
        ) : waMassal ? (
          <div className="space-y-3 text-[12.5px]">
            <div className="grid grid-cols-3 gap-2">
              <Box label="Diproses" value={(waMassal.terkirim || []).length} tone="text-emerald-600" />
              <Box label="Terkunci jeda" value={(waMassal.terkunci || []).length} tone="text-amber-600" />
              <Box label="Tanpa nomor" value={(waMassal.tanpa_nomor || []).length} tone="text-slate-500" />
            </div>
            {(waMassal.terkirim || []).length ? (
              <div>
                <p className="label">Terkirim / siap dibuka</p>
                <p className="rounded-xl bg-slate-50 p-2 text-[12px] text-slate-600">{(waMassal.terkirim || []).join(', ')}</p>
              </div>
            ) : null}
            {(waMassal.terkunci || []).length ? (
              <div>
                <p className="label">Masih terkunci jeda {waMassal.cooldown_jam} jam</p>
                <ul className="space-y-1">
                  {(waMassal.terkunci || []).map((k, i) => (
                    <li key={i} className="rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] text-amber-800">
                      {k.nama} — terakhir {k.terakhir}, dapat dikirim lagi {k.sampai}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(waMassal.tanpa_nomor || []).length ? (
              <p className="text-[11.5px] text-slate-500">Tanpa nomor HP orang tua: {(waMassal.tanpa_nomor || []).join(', ')}. Lengkapi pada form siswa.</p>
            ) : null}
            {!waMassal.gateway_aktif && (waMassal.tautan || []).length ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-2.5">
                <p className="text-[11.5px] font-semibold text-sky-900">Gateway belum aktif — buka tautan WhatsApp berikut satu per satu:</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(waMassal.tautan || []).map((t, i) => (
                    <a key={i} href={t.url} target="_blank" rel="noreferrer"
                      className="rounded-lg bg-white px-2 py-1 text-[11.5px] font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
                      {t.nama}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* detail */}
      <Modal open={!!detail} onClose={() => { setDetail(null); setSelRiwayat([]); }} size="lg"
        title={detail ? detail.siswa.nama : ''}
        subtitle={detail ? `${detail.siswa.kelas_nama || '-'} · NIS ${detail.siswa.nis || '-'} · NISN ${detail.siswa.nisn || '-'}` : ''}
        footer={detail ? (
          <>
            <button className="btn-ghost" onClick={() => kirimWA(detail.siswa.id)}><MessageCircle size={15} /> WhatsApp Orang Tua</button>
            <button className="btn-soft" onClick={() => openDoc(`/api/surat/${detail.siswa.id}?jenis=panggilan`)}><FileText size={15} /> Surat Panggilan</button>
            <button className="btn-primary" onClick={() => openDoc(`/api/surat/${detail.siswa.id}?jenis=sp1`)}>Surat SP 1</button>
          </>
        ) : null}>
        {detail ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['Poin Pelanggaran', detail.siswa.pel, 'text-rose-600'],
                ['Poin Prestasi', detail.siswa.pres, 'text-violet-600'],
                ['Poin Bersih', detail.siswa.bersih, 'text-slate-800']
              ].map(([l, v, c]) => (
                <div key={l} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                  <p className={cx('text-[18px] font-extrabold', c)}>{v}</p>
                </div>
              ))}
            </div>
            <div className={cx('flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px]',
              detail.siswa.sanksi ? 'border-orange-200 bg-orange-50/70 text-orange-800' : 'border-emerald-200 bg-emerald-50/70 text-emerald-800')}>
              <HeartHandshake size={15} />
              {detail.siswa.sanksi ? (
                <span><b>Rekomendasi sanksi otomatis:</b> {detail.siswa.sanksi.label}
                  {detail.siswa.sanksi.berikutnya ? ` · ${detail.siswa.sanksi.sisa} poin lagi menuju ${detail.siswa.sanksi.berikutnya}` : ' · ambang tertinggi'}</span>
              ) : (
                <span><b>Rekomendasi sanksi otomatis:</b> belum ada — poin pelanggaran masih di bawah ambang sanksi pertama.</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
              <StatusBadge label={detail.siswa.status.label} />
              {detail.siswa.status_siswa && detail.siswa.status_siswa !== 'aktif' ? (
                <span className="chip !bg-violet-100 !text-violet-700">Status: {detail.siswa.status_siswa}</span>
              ) : null}
              <span className="chip"><CalendarDays size={12} /> Lahir {tgl(detail.siswa.tanggal_lahir)}</span>
              <span className="chip">Wali Kelas: {detail.siswa.wali_nama || '-'}</span>
              <span className="chip">HP Orang Tua: {detail.siswa.parent_phone || '-'}</span>
            </div>

            {/* Riwayat penempatan kelas per tahun pelajaran (jenjang mengikuti TA masing-masing) */}
            <div data-riwayat-kelas>
              <p className="label">Riwayat Kelas per Tahun Pelajaran</p>
              {(detail.siswa.riwayat_kelas || []).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {detail.siswa.riwayat_kelas.map(rk => (
                    <span key={rk.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11.5px] text-slate-700">
                      <b>{rk.ta_nama || '-'}</b> · {rk.kelas_nama || '-'}
                      {rk.tingkat ? <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-bold text-slate-600">{rk.tingkat}</span> : null}
                    </span>
                  ))}
                </div>
              ) : <p className="text-[11.5px] text-slate-400">Belum ada riwayat kelas tercatat.</p>}
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="label !mb-0">Riwayat Kejadian ({detail.riwayat.length})</p>
                {can('kejadian', 'delete') && detail.riwayat.length ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] font-semibold text-slate-500">{selRiwayat.length} dipilih</span>
                    <button type="button" className="btn-danger btn-sm" disabled={!selRiwayat.length || savingQuick}
                      onClick={() => hapusRiwayat()}>
                      {savingQuick ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Terpilih
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="tbl-wrap max-h-[300px]">
                <table className="tbl">
                  <thead>
                    <tr>
                      {can('kejadian', 'delete') ? (
                        <th className="w-9 text-center">
                          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                            checked={semuaRiwayat} onChange={toggleSemuaRiwayat} title="Pilih semua riwayat" />
                        </th>
                      ) : null}
                      <th className="w-20">Tanggal</th><th>Kejadian</th><th className="w-24">Jenis</th><th className="w-14 text-center">Poin</th>
                      {can('kejadian', 'delete') ? <th className="w-10" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.riwayat.map(r => (
                      <tr key={r.id} className={selRiwayat.includes(r.id) ? 'bg-orange-50/60' : ''}>
                        {can('kejadian', 'delete') ? (
                          <td className="text-center">
                            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                              checked={selRiwayat.includes(r.id)} onChange={() => toggleRiwayat(r.id)} />
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap text-[12px]">{tglPendek(r.tanggal)}</td>
                        <td>
                          <p className="font-medium text-slate-700">{r.judul}</p>
                          <p className="text-[11px] text-slate-400">{r.keterangan || '-'}</p>
                          {r.ta_nama || r.kelas_saat_itu ? (
                            <p className="text-[10.5px] text-slate-400">TP {r.ta_nama || '-'}{r.kelas_saat_itu ? ` · kelas ${r.kelas_saat_itu}` : ''}</p>
                          ) : null}
                        </td>
                        <td><span className={cx('badge', r.jenis === 'prestasi' ? 'badge-prestasi' : 'badge-siaga')}>{r.jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran'}</span></td>
                        <td className="text-center font-bold">{r.poin}</td>
                        {can('kejadian', 'delete') ? (
                          <td className="text-center">
                            <button type="button" title="Hapus riwayat ini" className="rounded-lg p-1 text-rose-500 hover:bg-rose-50"
                              onClick={() => hapusRiwayat([r.id])}><Trash2 size={13} /></button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {!detail.riwayat.length ? (
                      <tr><td colSpan={can('kejadian', 'delete') ? 6 : 4} className="py-6 text-center text-slate-400">
                        Belum ada catatan kejadian — siswa ini bersih.
                      </td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <p className="label">Riwayat Pembinaan / Tindak Lanjut ({(detail.pembinaan || []).length})</p>
              {(detail.pembinaan || []).length ? (
                <ul className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
                  {detail.pembinaan.map(t => (
                    <li key={t.id} className="rounded-xl border border-slate-100 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <p className="text-[12px] font-bold text-slate-700">{t.jenis}</p>
                        <span className="text-[11px] text-slate-400">{waktu(t.tanggal)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-snug text-slate-600">{t.hasil}</p>
                      <p className="mt-1 text-[10.5px] font-semibold text-slate-400">
                        Status: {String(t.status)} · oleh {t.oleh_nama}
                        {t.next_at ? ` · sesi berikutnya ${tglPendek(t.next_at)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11.5px] text-slate-500">
                  Belum ada catatan pembinaan. Guru BK / Kesiswaan dapat menambahkan melalui menu <b>Tindak Lanjut</b>.
                </p>
              )}
            </div>

            {can('kejadian', 'write') ? (
              <form onSubmit={simpanPoin} className="rounded-xl border border-dashed border-orange-200 bg-orange-50/50 p-3">
                <p className="mb-2 text-[12.5px] font-bold text-orange-700">Catat Transaksi Poin</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select className="input !py-1.5 text-[12.5px]" value={quick.kategori_id}
                    onChange={e => setQuick(q => ({ ...q, kategori_id: e.target.value }))}>
                    <option value="">— pilih kategori —</option>
                    <optgroup label="Pelanggaran">
                      {master.kategori.filter(k => k.jenis === 'pelanggaran').map(k => <option key={k.id} value={k.id}>{k.nama} ({k.poin} poin)</option>)}
                    </optgroup>
                    <optgroup label="Prestasi">
                      {master.kategori.filter(k => k.jenis === 'prestasi').map(k => <option key={k.id} value={k.id}>{k.nama} ({k.poin} poin)</option>)}
                    </optgroup>
                  </select>
                  <input type="date" className="input !py-1.5 text-[12.5px]" value={quick.tanggal}
                    onChange={e => setQuick(q => ({ ...q, tanggal: e.target.value }))} />
                  <input className="input !py-1.5 text-[12.5px] sm:col-span-2" placeholder="Keterangan / kronologi kejadian"
                    value={quick.keterangan} onChange={e => setQuick(q => ({ ...q, keterangan: e.target.value }))} />
                </div>
                <button type="submit" className="btn-primary btn-sm mt-2 w-full" disabled={savingQuick}>
                  {savingQuick ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Simpan Poin
                </button>
              </form>
            ) : null}
            <div>
              <p className="label">Surat Peringatan</p>
              <div className="flex flex-wrap gap-2">
                {[['panggilan', 'Surat Panggilan Orang Tua'], ['sp1', 'SP 1'], ['sp2', 'SP 2'], ['sp3', 'SP 3']].map(([k, l]) => (
                  <button key={k} className="btn-ghost btn-sm" onClick={() => openDoc(`/api/surat/${detail.siswa.id}?jenis=${k}`)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!wa} onClose={() => setWa(null)} title="Peringatan WhatsApp" subtitle={wa ? `Nomor: ${wa.phone}` : ''}
        footer={wa ? <a className="btn-primary" href={wa.wa_url} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Buka WhatsApp</a> : null}>
        {wa ? <div className="whitespace-pre-wrap rounded-xl bg-emerald-50/70 p-3 text-[12.5px] leading-relaxed text-slate-700 ring-1 ring-emerald-100">{wa.pesan}</div> : null}
      </Modal>
    </div>
  );
}

const AlertIcon = ({ size }) => <span className="text-[15px] font-extrabold leading-none">!</span>;

function MiniStat({ label, value, icon: Icon, tone = 'orange', sub }) {
  const tones = { orange: 'from-orange-500 to-amber-500', rose: 'from-rose-500 to-orange-500', violet: 'from-violet-500 to-fuchsia-500' };
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={cx('grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', tones[tone])}>
        {typeof Icon === 'function' && Icon !== AlertIcon ? <Icon size={18} /> : <AlertIcon />}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-[19px] font-extrabold leading-tight text-slate-800">{value}</p>
        {sub ? <p className="text-[10.5px] text-slate-400">{sub}</p> : null}
      </div>
    </div>
  );
}

function FormSiswa({ open, row, kelas, onClose, onSaved, toast }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({
      id: row?.id || '', nama: row?.nama || '', nis: row?.nis || '', nisn: row?.nisn || '',
      kelas_id: row?.kelas_id || (kelas[0]?.id ?? ''), gender: row?.gender || 'L',
      tanggal_lahir: row?.tanggal_lahir || '', parent_phone: row?.parent_phone || '',
      status: row?.status_siswa || 'aktif'
    });
  }, [open, row, kelas]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/siswa/save', { method: 'POST', body: form });
      toast.ok(form.id ? 'Data siswa diperbarui.' : 'Siswa baru ditambahkan.');
      onSaved?.();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={form.id ? 'Ubah Data Siswa' : 'Tambah Siswa'}
      subtitle="Nomor HP orang tua dipakai untuk notifikasi WhatsApp."
      footer={<><button className="btn-ghost" onClick={onClose}>Batal</button><button className="btn-primary" form="fSiswa" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Simpan</button></>}>
      <form id="fSiswa" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama Lengkap" required className="sm:col-span-2">
          <input className="input" value={form.nama || ''} required onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} />
        </Field>
        <Field label="NIS"><input className="input" value={form.nis || ''} onChange={e => setForm(f => ({ ...f, nis: e.target.value }))} /></Field>
        <Field label="NISN"><input className="input" value={form.nisn || ''} onChange={e => setForm(f => ({ ...f, nisn: e.target.value }))} /></Field>
        <Field label="Kelas" required>
          <select className="input" value={form.kelas_id || ''} required onChange={e => setForm(f => ({ ...f, kelas_id: e.target.value }))}>
            <option value="">— pilih kelas —</option>
            {kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
          </select>
        </Field>
        <Field label="Jenis Kelamin" required>
          <select className="input" value={form.gender || 'L'} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
            <option value="L">Laki-laki</option><option value="P">Perempuan</option>
          </select>
        </Field>
        <Field label="Tanggal Lahir" hint="Dipakai untuk verifikasi portal cek poin.">
          <input type="date" className="input" value={form.tanggal_lahir || ''} onChange={e => setForm(f => ({ ...f, tanggal_lahir: e.target.value }))} />
        </Field>
        <Field label="No HP Orang Tua" hint="Contoh: 0812-3456-7890">
          <input className="input" value={form.parent_phone || ''} onChange={e => setForm(f => ({ ...f, parent_phone: e.target.value }))} />
        </Field>
        <Field label="Status Siswa" hint="Siswa tingkat akhir otomatis menjadi Lulus saat kenaikan kelas.">
          <select className="input" value={form.status || 'aktif'} data-siswa-status-form
            onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="aktif">Aktif</option>
            <option value="lulus">Lulus</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function Box({ label, value, tone = 'text-slate-800' }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cx('text-[17px] font-extrabold leading-tight', tone)}>{value}</p>
    </div>
  );
}
