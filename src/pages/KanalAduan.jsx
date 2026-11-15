import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, HeartPulse, Link2, Loader2,
  Printer, RefreshCw, Save, Search, Share2, Shield, ShieldAlert, ShieldCheck, Trash2, UserRound, Users
} from 'lucide-react';
import { api, docUrl, openDoc, tglPendek } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';

const TABS = [
  { key: 'semua', label: 'Semua' },
  { key: 'baru', label: 'Baru' },
  { key: 'diproses', label: 'Diproses' },
  { key: 'selesai', label: 'Selesai' }
];

export default function KanalAduan({ ctx }) {
  const { can, toast } = ctx;
  const [data, setData] = useState(null);
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('semua');
  const [q, setQ] = useState('');
  const [layanan, setLayanan] = useState({ keswa: '', ppa: '' });
  const [busy, setBusy] = useState('');
  const [pilih, setPilih] = useState([]);
  const [busyHapus, setBusyHapus] = useState(false);
  const [detail, setDetail] = useState(null);
  const [ubah, setUbah] = useState({ status: 'baru', tanggapan: '' });
  const readOnly = !can('aduan', 'write');

  const load = useCallback(() => {
    setLoading(true);
    api('/api/aduan?status=' + status + '&q=' + encodeURIComponent(q))
      .then(r => {
        setData(r);
        setLayanan(r.layanan || { keswa: '', ppa: '' });
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, [status, q]);
  useEffect(load, [load]);
  useEffect(() => { setPilih([]); }, [status, q]);

  useEffect(() => {
    api('/api/aduan/qr').then(r => setQr(r)).catch(() => setQr(null));
  }, []);

  async function resetQr() {
    if (!window.confirm('Reset QR & tautan aduan? QR/tautan lama TIDAK akan berlaku lagi.')) return;
    setBusy('reset');
    try {
      const r = await api('/api/aduan/reset', { method: 'POST', body: {} });
      setQr(q => ({ ...(q || {}), url: r.link.url, token: r.link.token, created_at: r.link.created_at }));
      toast.ok(r.pesan || 'QR baru dibuat.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }

  const link = (qr && qr.url) || data?.link?.url || '';
  const dibuat = (qr && qr.created_at) || data?.link?.created_at || '';

  async function salin() {
    try {
      await navigator.clipboard.writeText(link);
      toast.ok('Tautan aduan disalin ke clipboard.');
    } catch (e) {
      toast.err('Gagal menyalin — salin manual: ' + link);
    }
  }

  async function unduh() {
    if (!qr?.qr?.png) return toast.err('QR belum siap, muat ulang halaman.');
    const a = document.createElement('a');
    a.href = qr.qr.png;
    a.download = 'qr-aduan-kekerasan.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function bagikan() {
    if (!qr?.qr?.png) return toast.err('QR belum siap, muat ulang halaman.');
    try {
      const blob = await (await fetch(qr.qr.png)).blob();
      const file = new File([blob], 'qr-aduan-kekerasan.png', { type: blob.type || 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file], title: 'Kanal Aduan Kekerasan',
          text: 'Pindai QR atau buka tautan berikut untuk melapor: ' + link
        });
        return;
      }
      await unduh();
      toast.info('Perangkat tidak mendukung bagikan gambar — QR diunduh, silakan bagikan manual.');
    } catch (e) {
      toast.err('Gagal membagikan gambar: ' + e.message);
    }
  }

  async function simpanLayanan() {
    setBusy('layanan');
    try {
      const r = await api('/api/aduan/layanan', { method: 'POST', body: layanan });
      setLayanan(r.layanan);
      toast.ok(r.pesan || 'Nomor layanan bantuan tersimpan.');
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }

  async function hapusAduan(ids, label) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    const pesan = list.length === 1
      ? `Hapus aduan ${label || ''} secara permanen? Tindakan ini tidak dapat dibatalkan.`
      : `Hapus ${list.length} aduan terpilih secara permanen? Tindakan ini tidak dapat dibatalkan.`;
    if (!window.confirm(pesan)) return;
    setBusyHapus(true);
    try {
      const r = await api('/api/aduan/delete', { method: 'POST', body: { ids: list } });
      toast.ok(r.pesan || 'Aduan dihapus.');
      setPilih([]);
      if (detail && list.includes(detail.id)) setDetail(null);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusyHapus(false); }
  }

  function buka(r) {
    setDetail(r);
    setUbah({ status: r.status, tanggapan: r.tanggapan || '' });
  }
  async function simpanStatus() {
    if (!detail) return;
    setBusy('status');
    try {
      const r = await api('/api/aduan/status', { method: 'POST', body: { id: detail.id, ...ubah } });
      toast.ok(r.pesan || 'Status aduan diperbarui.');
      setDetail(null);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }

  const counts = data?.counts || { semua: 0, baru: 0, diproses: 0, selesai: 0 };
  const rows = data?.rows || [];

  return (
    <div className="space-y-4" data-page="kanal-aduan">
      <div>
        <h2 className="flex items-center gap-2 text-[19px] font-extrabold text-slate-800">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-soft">
            <Shield size={17} />
          </span>
          Kanal Aduan Kekerasan
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Bagikan QR ke siswa. Siswa melapor dengan kelas + tanggal lahir, lalu aduan masuk ke Guru BK siswa itu.
          Hanya Anda yang bisa membaca aduan untuk Anda.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="QR & Tautan Aduan Anda" subtitle="Tempel di kelas, mading, atau bagikan lewat grup kelas.">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="mx-auto grid h-[188px] w-[188px] shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white p-2 shadow-sm" data-qr-aduan>
              {qr?.qr?.svg ? (
                <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.qr.svg }} />
              ) : <Loader2 size={22} className="animate-spin text-slate-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-slate-600">Link aduan Anda</p>
              <div className="mt-1 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
                <input readOnly className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-slate-600 outline-none"
                  value={link} data-link-aduan />
                <button className="btn-ghost btn-sm" onClick={salin} data-salin-link><Copy size={12} /> Salin Link</button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">Dibuat/di-reset: <b className="text-slate-700">{dibuat ? tglPendek(dibuat) + ' ' + String(dibuat).slice(11, 16) : '-'}</b></p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className="btn-soft btn-sm" onClick={bagikan}><Share2 size={13} /> Bagikan Gambar QR</button>
                <button className="btn-ghost btn-sm" onClick={unduh} data-unduh-qr><Download size={13} /> Unduh</button>
                <button className="btn-danger btn-sm" onClick={resetQr} disabled={busy === 'reset' || readOnly} data-reset-qr>
                  {busy === 'reset' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Reset QR (QR lama tidak berlaku lagi)
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Siswa memindai QR lalu mengisi nama, kelas, dan tanggal lahir. Aduan langsung masuk ke daftar di bawah.
              </p>
            </div>
          </div>
        </Card>

        <Card title="Nomor Layanan Bantuan untuk Siswa"
          subtitle="Tampil di halaman aduan siswa. Bila dikosongkan, siswa hanya diarahkan untuk menghubungi Guru BK.">
          <div className="space-y-3">
            <Field label="Layanan kesehatan jiwa resmi" hint="Contoh: Kemenkes 119 ext. 8 / layanan psikologi daerah.">
              <div className="flex items-center gap-2">
                <HeartPulse size={15} className="text-rose-500" />
                <input className="input" placeholder="Nomor / kontak layanan kesehatan jiwa"
                  value={layanan.keswa} disabled={readOnly}
                  onChange={e => setLayanan(s => ({ ...s, keswa: e.target.value }))} data-aduan-keswa />
              </div>
            </Field>
            <Field label="Unit PPA setempat" hint="Unit Pelayanan Perempuan dan Anak (Polres/Pemda).">
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-sky-600" />
                <input className="input" placeholder="Nomor / kontak Unit PPA"
                  value={layanan.ppa} disabled={readOnly}
                  onChange={e => setLayanan(s => ({ ...s, ppa: e.target.value }))} data-aduan-ppa />
              </div>
            </Field>
            <button className="btn-primary btn-sm" onClick={simpanLayanan} disabled={readOnly || busy === 'layanan'} data-simpan-layanan>
              {busy === 'layanan' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Nomor Layanan
            </button>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Aduan" value={counts.semua} sub="seluruh kanal Anda" icon={Shield} tone="rose" />
        <Stat label="Baru" value={counts.baru} sub="belum ditangani" icon={ShieldAlert} tone="orange" />
        <Stat label="Diproses" value={counts.diproses} sub="sedang ditangani" icon={Loader2} tone="sky" />
        <Stat label="Selesai" value={counts.selesai} sub="sudah ditindaklanjuti" icon={CheckCircle2} tone="emerald" />
      </div>

      <Card
        title="Aduan Masuk"
        subtitle="Hanya aduan yang dikirim melalui QR/tautan Anda yang tampil di sini."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn-ghost btn-sm" href={docUrl('/api/aduan/export')} data-export-aduan>
              <FileSpreadsheet size={14} /> Unduh Excel
            </a>
            <button className="btn-ghost btn-sm" onClick={() => openDoc('/api/aduan/cetak?status=' + status + (q ? '&q=' + encodeURIComponent(q) : ''))} data-cetak-aduan>
              <Printer size={14} /> Cetak / Simpan PDF
            </button>
            <a className="btn-primary btn-sm !bg-emerald-600 !border-emerald-600 hover:!brightness-95"
              href={docUrl('/api/aduan/word?status=' + status + (q ? '&q=' + encodeURIComponent(q) : ''))} data-word-aduan>
              <Download size={14} /> Word (.docx)
            </a>
          </div>
        }>
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2">
          <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
              checked={rows.length > 0 && pilih.length === rows.length}
              onChange={e => setPilih(e.target.checked ? rows.map(r => r.id) : [])}
              data-aduan-all="1" />
            Pilih Semua
          </label>
          <span className="text-[12px] font-semibold text-slate-500">
            Terpilih: <b className="text-orange-700" data-aduan-count>{pilih.length}</b>
          </span>
          {pilih.length ? (
            <button className="chip !py-0.5 hover:!border-orange-300" onClick={() => setPilih([])}>Bersihkan</button>
          ) : null}
          <button className="btn-danger btn-sm ml-auto" disabled={!pilih.length || busyHapus || readOnly}
            onClick={() => hapusAduan(pilih)} data-aduan-hapus="1">
            {busyHapus ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Terpilih
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={cx('chip', status === t.key && '!border-blue-400 !bg-blue-50 !text-blue-700')}
                data-status-aduan={t.key}>
                {t.label} ({counts[t.key] || 0})
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input !pl-9" placeholder="Cari nama / kelas / isi aduan…" value={q}
              onChange={e => setQ(e.target.value)} />
          </div>
        </div>

        {loading ? <Spinner /> : !rows.length ? (
          <Empty icon={Shield} title="Belum ada aduan" desc="Bagikan QR/tautan aduan Anda ke siswa. Aduan yang masuk akan tampil di sini." />
        ) : (
          <div className="space-y-2" data-list-aduan>
            {rows.map(r => (
              <div key={r.id}
                className={cx('flex w-full flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2.5 transition',
                  pilih.includes(r.id) ? 'border-orange-300 bg-orange-50/50' : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/40')}>
                <input type="checkbox" className="h-4 w-4 shrink-0 cursor-pointer accent-orange-600" data-aduan-item={r.id}
                  checked={pilih.includes(r.id)} aria-label={`Pilih aduan ${r.nama_siswa || ''}`}
                  onChange={() => setPilih(l => l.includes(r.id) ? l.filter(x => x !== r.id) : [...l, r.id])} />
                <button type="button" onClick={() => buka(r)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
                  <span className={cx('badge',
                    r.status === 'baru' ? 'badge-siaga' : r.status === 'diproses' ? 'badge-perhatian' : 'badge-aman')}>
                    {(data.status_list || []).find(s => s.key === r.status)?.label || r.status}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-slate-800">{r.nama_siswa || 'Siswa'} — {r.kelas_nama || '-'}</span>
                    <span className="block truncate text-[11.5px] text-slate-500">{r.jenis} · {String(r.kronologi || '').slice(0, 110)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[11.5px] font-semibold text-slate-500">{tglPendek(r.created_at)}</span>
                    <span className="block text-[11px] text-slate-400">{String(r.created_at || '').slice(11, 16)}</span>
                  </span>
                </button>
                <button type="button" title="Hapus aduan" disabled={readOnly || busyHapus}
                  onClick={() => hapusAduan([r.id], `dari ${r.nama_siswa || 'siswa'}`)}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  data-aduan-hapus-satu={r.id}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} size="lg"
        title={detail ? `Aduan dari ${detail.nama_siswa || 'Siswa'}` : ''}
        subtitle={detail ? `${detail.kelas_nama || '-'} · ${detail.jenis || '-'} · ${tglPendek(detail.created_at)} ${String(detail.created_at || '').slice(11, 16)}` : ''}
        footer={<>
          <button className="btn-ghost" onClick={() => setDetail(null)}>Tutup</button>
          {detail ? (
            <>
              <a className="btn-ghost" href={docUrl('/api/aduan/' + detail.id + '/word')}><Download size={14} /> Word</a>
              <button className="btn-ghost" onClick={() => openDoc('/api/aduan/' + detail.id + '/cetak')}><Printer size={14} /> Cetak PDF</button>
            </>
          ) : null}
          {!readOnly ? (
            <button className="btn-primary" onClick={simpanStatus} disabled={busy === 'status'} data-simpan-status-aduan>
              {busy === 'status' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan Tindak Lanjut
            </button>
          ) : null}
        </>}>
        {detail ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10.5px] font-bold uppercase text-slate-400">Jenis Kekerasan</p><p className="text-[12.5px] font-semibold text-slate-700">{detail.jenis || '-'}</p></div>
              <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10.5px] font-bold uppercase text-slate-400">Lokasi</p><p className="text-[12.5px] font-semibold text-slate-700">{detail.lokasi || '-'}</p></div>
              <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10.5px] font-bold uppercase text-slate-400">Dugaan Pelaku</p><p className="text-[12.5px] font-semibold text-slate-700">{detail.pelaku || '-'}</p></div>
              <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-[10.5px] font-bold uppercase text-slate-400">Kontak Pelapor</p><p className="text-[12.5px] font-semibold text-slate-700">{detail.kontak || '-'}</p></div>
            </div>
            <div>
              <p className="label">Kronologi</p>
              <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-[12.5px] leading-relaxed text-slate-700">{detail.kronologi || '-'}</p>
            </div>
            {!readOnly ? (
              <>
                <Field label="Status Penanganan">
                  <select className="input" value={ubah.status} onChange={e => setUbah(s => ({ ...s, status: e.target.value }))} data-ubah-status>
                    {(data.status_list || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Catatan / Tindak Lanjut" hint="Hanya terlihat oleh Anda.">
                  <textarea className="input" rows={3} value={ubah.tanggapan} onChange={e => setUbah(s => ({ ...s, tanggapan: e.target.value }))}
                    placeholder="Catatan konseling, rujukan, koordinasi dengan orang tua, dsb." />
                </Field>
              </>
            ) : detail.tanggapan ? (
              <div>
                <p className="label">Tindak Lanjut</p>
                <p className="whitespace-pre-wrap rounded-xl bg-emerald-50 p-3 text-[12.5px] text-emerald-900">{detail.tanggapan}</p>
              </div>
            ) : null}
            <Alert tone="danger" title="Jaga kerahasiaan">
              Aduan ini bersifat rahasia. Jangan menyebarkan identitas pelapor. Tindak lanjuti sesuai prosedur sekolah
              dan libatkan Unit PPA / layanan kesehatan jiwa bila diperlukan.
            </Alert>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
