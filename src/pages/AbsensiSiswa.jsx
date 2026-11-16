import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, CheckCircle2, Copy, Download, ExternalLink, Loader2, Lock, QrCode, RefreshCw, Search, Users, X
} from 'lucide-react';
import { api, hariIni } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';
import AbsensiKelas from '../components/AbsensiKelas';

const TABS = [{ key: 'sesi', label: 'Sesi Hari Ini' }, { key: 'rekap', label: 'Rekap Presensi' }];

export default function AbsensiSiswa({ ctx }) {
  const { can, toast } = ctx;
  const [tab, setTab] = useState('sesi');
  const [tanggal, setTanggal] = useState(() => hariIni());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busyId, setBusyId] = useState(0);
  const [rekap, setRekap] = useState(null);
  const [filter, setFilter] = useState({ dari: '', sampai: '', kelas: '', mapel: '' });

  const load = useCallback(() => {
    setLoading(true);
    api(`/api/absensi-siswa?tanggal=${tanggal}`)
      .then(r => setData(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [tanggal]);
  useEffect(load, [load]);

  const loadRekap = useCallback(() => {
    const q = new URLSearchParams({ dari: filter.dari || tanggal, sampai: filter.sampai || tanggal });
    if (filter.kelas) q.set('kelas', filter.kelas);
    if (filter.mapel) q.set('mapel', filter.mapel);
    api('/api/absensi-siswa/rekap?' + q.toString()).then(setRekap).catch(e => toast.err(e.message));
  }, [filter, tanggal]);
  useEffect(() => { if (tab === 'rekap') loadRekap(); }, [tab, loadRekap]);

  async function bukaSesi(j) {
    setBusyId(j.id);
    try {
      const r = await api('/api/absensi-siswa/sesi', { method: 'POST', body: { jadwal_id: j.id, tanggal } });
      setDetail(r);
      toast.ok('Sesi presensi dibuka.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusyId(0); }
  }
  async function bukaSesiAda(j) {
    setBusyId(j.id);
    try { setDetail(await api(`/api/absensi-siswa/sesi?jadwal_id=${j.id}&tanggal=${tanggal}`)); }
    catch (e) { toast.err(e.message); }
    finally { setBusyId(0); }
  }
  /* Panel guru: nama pencatat TIDAK dikirim dari klien — server mencatat akun
     guru yang sedang login (lihat POST /api/absensi-siswa/simpan). */
  async function simpanPresensi({ items }) {
    const r = await api('/api/absensi-siswa/simpan', { method: 'POST', body: { sesi_id: detail.sesi.id, items } });
    setDetail(d => d ? {
      ...d,
      siswa: d.siswa.map(s => {
        const it = items.find(x => Number(x.siswa_id) === Number(s.id));
        return it ? { ...s, status: it.status, keterangan: it.keterangan, terisi: true } : s;
      })
    } : d);
    load();
    return r;
  }

  const jadwal = data?.jadwal || [];
  /* tombol presensi hanya aktif bila peran pengguna memang berhak MENGISI
     (izin absensi_siswa.write) dan server menyatakan sesi ini boleh dikelola. */
  const bolehKelola = can('absensi_siswa', 'write');
  const totalTerisi = jadwal.reduce((a, j) => a + (j.terisi || 0), 0);
  const sesiTerbuka = jadwal.filter(j => j.sesi_id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800" data-tour-id="btn-absensi-siswa">Absensi Siswa per Mata Pelajaran</h2>
          <p className="text-[12.5px] text-slate-500">
            Diisi guru pengampu, wali kelas, atau ketua kelas melalui tautan/QR sesi — otomatis masuk rekap per mapel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input !w-auto" value={tanggal} max={hariIni()}
            onChange={e => { setTanggal(e.target.value); setDetail(null); }} data-tanggal-presensi />
          <button className="btn-ghost" onClick={() => { load(); if (tab === 'rekap') loadRekap(); }}><RefreshCw size={14} /> Muat Ulang</button>
        </div>
      </div>

      {data?.poin?.aktif ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900" data-info-poin>
          Otomatis ke Buku Poin: status <b>Alpha</b> = {data.poin.alfa.poin} poin · <b>Bolos</b> = {data.poin.bolos.poin} poin.
          <span className="font-normal"> Bobot dapat diubah di menu <b>Kategori Poin</b> (kategori bertanda “Otomatis Absensi”).</span>
        </div>
      ) : null}

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx('tab flex items-center gap-1.5', tab === t.key && 'active')}>
            {t.key === 'sesi' ? <CalendarClock size={14} /> : <Users size={14} />} {t.label}
          </button>
        ))}
      </div>

      {tab === 'sesi' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Sesi Mengajar" value={jadwal.length} sub={data?.tanggal_label} icon={CalendarClock} tone="sky" />
            <Stat label="Sesi Presensi Dibuka" value={sesiTerbuka} sub="tautan/QR aktif" icon={QrCode} tone="violet" />
            <Stat label="Siswa Sudah Dicatat" value={totalTerisi} sub="seluruh sesi hari ini" icon={Users} tone="emerald" />
          </div>

          {!detail ? (
            <Card title={`Sesi Mata Pelajaran — ${data?.tanggal_label || ''}`}
              subtitle={data?.lihat_semua
                ? 'Admin dan Kepala Sekolah dapat melihat seluruh jadwal; tindakan hanya tersedia bagi guru pemilik sesi atau admin.'
                : 'Jadwal mengajar Anda hari ini.'}>
              {loading ? <Spinner /> : !jadwal.length ? (
                <Empty icon={CalendarClock} title="Tidak ada jadwal pada tanggal ini"
                  desc={data?.lihat_semua ? 'Belum ada slot jadwal pada tanggal yang dipilih.' : 'Belum ada slot jadwal mengajar untuk akun ini pada tanggal yang dipilih.'} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {jadwal.map(j => (
                    <div key={j.id} className="rounded-xl border border-slate-200 p-3" data-sesi-jadwal={j.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-bold text-slate-800">{j.mapel_nama || '-'}</p>
                          <p className="truncate text-[11.5px] text-slate-500">
                            {j.kelas_nama} · {j.jam}
                            {data?.lihat_semua && !j.tukar && j.guru_nama ? ` · ${j.guru_nama}` : ''}
                            {j.tukar ? ` · pengganti ${j.tukar.ke_nama}` : ''}
                          </p>
                        </div>
                        <span className={cx('badge shrink-0', j.sesi_id ? 'badge-aman' : 'badge-netral')}>
                          {j.sesi_id ? 'Sesi dibuka' : 'Belum dibuka'}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-slate-500">
                        Terisi <b>{j.terisi}</b> siswa{j.pencatat ? ` · pencatat: ${j.pencatat}` : ''}
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        {j.sesi_id ? (
                          <button className="btn-primary btn-sm flex-1" onClick={() => bukaSesiAda(j)}
                            disabled={!bolehKelola || !j.bisa || busyId === j.id} data-buka-presensi={j.id}
                            title={!bolehKelola || !j.bisa ? 'Hanya guru pemilik sesi, wali kelas yang berwenang, atau admin yang berhak mengelola presensi ini.' : undefined}>
                            {busyId === j.id ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Buka Presensi
                          </button>
                        ) : (
                          <button className="btn-primary btn-sm flex-1" onClick={() => bukaSesi(j)}
                            disabled={!bolehKelola || !j.bisa || busyId === j.id} data-buat-sesi={j.id}
                            title={!bolehKelola || !j.bisa ? 'Hanya guru pemilik sesi, wali kelas yang berwenang, atau admin yang berhak membuka presensi ini.' : undefined}>
                            {busyId === j.id ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />} Buat Sesi &amp; QR
                          </button>
                        )}
                      </div>
                      {!j.bisa ? (
                        <p className="mt-1 text-[10.5px] text-slate-500" data-sesi-hanya-lihat={j.id}>
                          Hanya dapat dilihat — pengelolaan hanya untuk guru pemilik sesi, wali kelas yang berwenang, atau admin.
                        </p>
                      ) : null}
                      {j.tukar ? (
                        <p className="mt-1 text-[10.5px] font-semibold text-violet-700">
                          Sesi pengganti dari {j.tukar.dari_nama}
                        </p>
                      ) : null}
                      {j.window && !j.window.aktif ? (
                        <p className={cx('mt-1 flex items-start gap-1 text-[10.5px]', j.window.terkunci ? 'font-semibold text-amber-700' : 'text-slate-400')}>
                          {j.window.terkunci ? <Lock size={10} className="mt-0.5 shrink-0" /> : null}
                          {j.window.alasan}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button className="btn-ghost btn-sm" onClick={() => setDetail(null)}>← Kembali ke daftar sesi</button>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary btn-sm" onClick={() => setQrOpen(true)} data-buka-qr><QrCode size={14} /> Generate Link &amp; Barcode Absensi Kelas</button>
                </div>
              </div>
              {!detail.window?.terbuka ? (
                <Alert tone="warn" title="Sesi presensi sudah ditutup" icon={Lock}>
                  {detail.window?.keterangan || 'Waktu pengisian presensi sudah berakhir.'}
                  <span className="mt-1 block">Presensi masih dapat dilihat, tetapi tidak dapat diubah lagi.</span>
                </Alert>
              ) : null}
              <Card bodyClass="p-3 sm:p-4">
                <AbsensiKelas detail={detail} simpan={simpanPresensi} mode="guru"
                  user={data?.saya} readOnly={detail.window?.terbuka === false} />
                {detail.pencatat_info && detail.pencatat_info.nama ? (
                  <div className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12.5px] text-emerald-900"
                    data-pencatat-info>
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                    <span>
                      Absensi ini diwakili/diisi oleh: <b>{detail.pencatat_info.nama}</b>
                      {detail.pencatat_info.kelas ? <span> (Siswa Kelas {detail.pencatat_info.kelas})</span> : null}
                      {detail.pencatat_info.at ? (
                        <span className="mt-0.5 block text-[11px] font-normal text-emerald-700">Dicatat {String(detail.pencatat_info.at).slice(0, 16)}</span>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </Card>
              <Card title="Generate Link & Barcode Absensi Kelas" subtitle="Bagikan ke ketua kelas — ia memverifikasi namanya sebelum menyimpan presensi">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-2" dangerouslySetInnerHTML={{ __html: detail.qr?.svg || '' }} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">{detail.qr?.url}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button className="btn-ghost btn-sm" onClick={async () => {
                        try { await navigator.clipboard.writeText(detail.qr?.url || ''); toast.ok('Tautan presensi disalin.'); }
                        catch (e) { toast.err('Gagal menyalin tautan.'); }
                      }}><Copy size={13} /> Salin Link</button>
                      <a className="btn-ghost btn-sm" href={detail.qr?.png} download={`qr-presensi-${detail.sesi.id}.png`}><Download size={13} /> Unduh QR</a>
                      <a className="btn-ghost btn-sm" href={detail.qr?.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Buka</a>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </>
      ) : (
        <RekapPresensi ctx={ctx} rekap={rekap} filter={filter} setFilter={setFilter} tanggal={tanggal} onLoad={loadRekap} />
      )}

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="QR & Tautan Presensi" size="md"
        subtitle={detail ? `${detail.mapel?.nama} · ${(detail.kelas || []).map(k => k.nama).join(' + ')}` : ''}
        footer={<button className="btn-ghost" onClick={() => setQrOpen(false)}>Tutup</button>}>
        {detail?.qr ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto w-[260px] rounded-2xl border border-slate-200 bg-white p-3" dangerouslySetInnerHTML={{ __html: detail.qr.svg || '' }} />
            <p className="break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">{detail.qr.url}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn-ghost btn-sm" onClick={async () => {
                try { await navigator.clipboard.writeText(detail.qr.url); toast.ok('Tautan presensi disalin.'); } catch (e) { toast.err('Gagal menyalin.'); }
              }}><Copy size={13} /> Salin Link Presensi</button>
              <a className="btn-primary btn-sm" href={detail.qr.png} download={`qr-presensi-${detail.sesi.id}.png`}><Download size={13} /> Unduh QR Code</a>
            </div>
            <p className="text-[11.5px] text-slate-500">
              Ketua kelas memindai QR / membuka tautan ini selama jam pelajaran, mencatat kehadiran (H/S/I/A/B),
              lalu <b>mengetik namanya pada kolom verifikasi</b> sebelum menyimpan — data langsung masuk ke sistem
              tanpa diinput guru.
            </p>
          </div>
        ) : <Spinner />}
      </Modal>
    </div>
  );
}

function RekapPresensi({ ctx, rekap, filter, setFilter, tanggal, onLoad }) {
  const set = (p) => setFilter(v => ({ ...v, ...p }));
  return (
    <div className="space-y-3">
      <Card title="Filter Rekap Presensi" bodyClass="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Dari"><input type="date" className="input" value={filter.dari || tanggal} onChange={e => set({ dari: e.target.value })} /></Field>
          <Field label="Sampai"><input type="date" className="input" value={filter.sampai || tanggal} onChange={e => set({ sampai: e.target.value })} /></Field>
          <Field label="Kelas">
            <select className="input" value={filter.kelas} onChange={e => set({ kelas: e.target.value })}>
              <option value="">Semua kelas</option>
              {(rekap?.kelas || []).map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </Field>
          <Field label="Mata Pelajaran">
            <select className="input" value={filter.mapel} onChange={e => set({ mapel: e.target.value })}>
              <option value="">Semua mapel</option>
              {(rekap?.mapel || []).map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><button className="btn-primary w-full" onClick={onLoad}><Search size={14} /> Tampilkan</button></div>
        </div>
      </Card>

      {!rekap ? <Spinner label="Memuat rekap…" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[['Hadir', rekap.total.H, 'emerald'], ['Sakit', rekap.total.S, 'orange'], ['Izin', rekap.total.I, 'sky'], ['Alpha', rekap.total.A, 'rose'], ['Bolos', rekap.total.B, 'slate']].map(([l, v, t]) => (
              <div key={l} className="card flex items-center justify-between p-4">
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                  <p className="text-[20px] font-extrabold text-slate-800">{v || 0}</p></div>
                <span className={cx('h-9 w-2 rounded-full', t === 'emerald' ? 'bg-emerald-400' : t === 'orange' ? 'bg-amber-400' : t === 'sky' ? 'bg-sky-400' : t === 'rose' ? 'bg-rose-400' : 'bg-slate-400')} />
              </div>
            ))}
          </div>
          <Card title="Rekap per Siswa" subtitle={`${rekap.jumlah} catatan presensi pada rentang tanggal terpilih`}
            right={<span className="chip">{rekap.dari} → {rekap.sampai}</span>}>
            <div className="tbl-wrap max-h-[460px]">
              <table className="tbl">
                <thead><tr><th>Nama Siswa</th><th>Kelas</th><th className="text-center">Sesi</th><th className="text-center">H</th><th className="text-center">S</th><th className="text-center">I</th><th className="text-center">A</th><th className="text-center">B</th><th className="text-center">% Hadir</th></tr></thead>
                <tbody>
                  {(rekap.per_siswa || []).map(s => (
                    <tr key={s.siswa_id}>
                      <td className="font-semibold">{s.nama}</td><td>{s.kelas_nama || '-'}</td>
                      <td className="text-center">{s.sesi}</td>
                      <td className="text-center text-emerald-700">{s.H}</td><td className="text-center text-amber-700">{s.S}</td>
                      <td className="text-center text-sky-700">{s.I}</td><td className="text-center text-rose-700">{s.A}</td>
                      <td className="text-center text-red-700">{s.B}</td>
                      <td className="text-center font-bold">{s.sesi ? Math.round((s.H / s.sesi) * 100) : 0}%</td>
                    </tr>
                  ))}
                  {!(rekap.per_siswa || []).length ? <tr><td colSpan={9} className="py-8 text-center text-slate-400">Belum ada presensi pada rentang tanggal ini.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
