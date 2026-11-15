import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CreditCard, Download, Eye, Loader2, Package, Pencil, Plus, QrCode, Save,
  Sparkles, Trash2, Wallet, X, Zap
} from 'lucide-react';
import { api, tgl, waktu, angka } from '../../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../../ui';
import { Kpi, Badge, statusTone, rupiah, bytes, salin, UploadGambar } from './ui-saas';

/* =====================================================================
   3. PEMBAYARAN & PENAGIHAN
   ===================================================================== */
export function SuperPembayaran({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('semua');
  const [busy, setBusy] = useState('');
  const [lihat, setLihat] = useState(null);
  const load = useCallback(() => api('/api/super/pembayaran?status=' + status).then(setData).catch(e => toast.err(e.message)), [status]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Spinner label="Memuat pembayaran…" />;

  const TABS = [['menunggu', 'Menunggu Verifikasi'], ['disetujui', 'Disetujui'], ['ditolak', 'Ditolak'], ['semua', 'Semua']];

  async function verifikasi(id, aksi, catatan) {
    setBusy('v' + id);
    try {
      const r = await api('/api/super/pembayaran/verifikasi', { method: 'POST', body: { id, aksi, catatan } });
      toast.ok(r.pesan);
      setLihat(null); load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function jalankanCron() {
    setBusy('cron');
    try {
      const r = await api('/api/super/cron', { method: 'POST' });
      toast.ok(r.pesan);
      load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function buatTagihan(t) {
    try {
      const r = await api('/api/super/tagihan/buat', { method: 'POST', body: { id: t.id, bulan: 1 } });
      toast.ok(r.pesan);
      load();
    } catch (e) { toast.err(e.message); }
  }
  const rows = data.rows || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Pembayaran & Penagihan</h2>
          <p className="text-[12.5px] text-slate-500">Verifikasi bukti pembayaran sekolah, pantau tagihan, dan jalankan cron penagihan otomatis.</p>
        </div>
        <button className="btn-primary" disabled={!!busy} onClick={jalankanCron}>
          {busy === 'cron' ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />} Jalankan Pemeriksaan Tagihan Sekarang
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Menunggu Verifikasi" value={angka(data.ringkas.menunggu)} icon={Wallet} tone="orange" />
        <Kpi label="Disetujui" value={angka(data.ringkas.disetujui)} sub={rupiah(data.ringkas.nominal_lunas)} icon={CheckCircle2} tone="emerald" />
        <Kpi label="Ditolak" value={angka(data.ringkas.ditolak)} icon={AlertTriangle} tone="rose" />
        <Kpi label="Tagihan Terbuka" value={angka((data.tagihan || []).length)} sub="belum dibayar" icon={CreditCard} tone="slate" />
      </div>

      <Card title="Penagihan & Pembekuan Otomatis" subtitle="Cron harian: tagihan H-7, notifikasi WhatsApp, dan suspend otomatis">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Cron terakhir</p>
            <p className="text-[13px] font-bold text-slate-700">{data.cron.terakhir ? waktu(data.cron.terakhir) : 'Belum pernah'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Tagihan baru</p>
            <p className="text-[13px] font-bold text-slate-700">{angka(data.cron.hasil?.dibuat || 0)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Notifikasi H-7</p>
            <p className="text-[13px] font-bold text-slate-700">{angka(data.cron.hasil?.notif || 0)}</p>
          </div>
        </div>
        <Alert tone="info" title="Idempoten">
          Menekan tombol berulang kali tidak akan membuat tagihan ganda: tagihan unik per sekolah + periode,
          notifikasi H-7 hanya sekali, dan sekolah yang sudah ditangguhkan tidak diproses ulang.
        </Alert>
        {data.cron.hasil?.detail?.length ? (
          <ul className="mt-2 space-y-1 text-[12px] text-slate-600">
            {data.cron.hasil.detail.map((d, i) => <li key={i}>• {d}</li>)}
          </ul>
        ) : null}
      </Card>

      <Card bodyClass="p-0">
        <div className="tabs m-3">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} className={cx('tab', status === k && 'active')}>{l}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Diajukan</th><th>Sekolah</th><th>Paket</th><th>Nominal</th><th>Status</th><th className="text-right">Aksi</th></tr></thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap text-[11.5px]">{waktu(p.created_at)}</td>
                  <td>
                    <p className="font-bold text-slate-800">{p.sekolah || '—'}</p>
                    <p className="text-[11px] text-slate-500">Kode {p.kode || '-'} · {p.oleh_nama || '-'}</p>
                  </td>
                  <td className="text-[12px]">{p.paket} · {p.bulan} bln</td>
                  <td className="whitespace-nowrap font-semibold">{rupiah(p.total)}{p.potongan ? <span className="ml-1 text-[10.5px] text-emerald-600">(-{rupiah(p.potongan)})</span> : null}</td>
                  <td><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                  <td className="text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setLihat(p)}><Eye size={13} /> Tinjau</button>
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={6}><Empty title="Belum ada pembayaran" desc="Pengajuan dari sekolah akan tampil di sini." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Tagihan Terbuka" subtitle="Dibuat otomatis H-7 atau manual" right={
        <div className="text-[11.5px] text-slate-500">Total {rupiah((data.tagihan || []).reduce((a, g) => a + Number(g.total || 0), 0))}</div>
      }>
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="tbl">
            <thead><tr><th>Sekolah</th><th>Periode</th><th>Nominal</th><th>Jatuh Tempo</th><th>Notif H-7</th></tr></thead>
            <tbody>
              {(data.tagihan || []).map(g => (
                <tr key={g.id}>
                  <td><p className="font-semibold">{g.sekolah}</p><p className="text-[11px] text-slate-500">Kode {g.kode}</p></td>
                  <td className="font-mono text-[12px]">{g.periode}</td>
                  <td>{rupiah(g.total)}</td>
                  <td>{tgl(g.jatuh_tempo)}</td>
                  <td className="text-[11.5px] text-slate-500">{g.notif_h7 ? waktu(g.notif_h7) : 'belum dikirim'}</td>
                </tr>
              ))}
              {!(data.tagihan || []).length ? <tr><td colSpan={5} className="text-slate-400">Tidak ada tagihan terbuka.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Buat Tagihan Manual" subtitle="Untuk sekolah yang masa aktifnya belum memasuki H-7">
        <div className="flex flex-wrap gap-2">
          {(data.tenants || []).filter(t => t.paket !== 'lifetime').slice(0, 12).map(t => (
            <button key={t.id} className="btn-ghost btn-sm" onClick={() => buatTagihan(t)} title={`Tagihan 1 bulan untuk ${t.nama}`}>
              <CreditCard size={12} /> {t.nama.slice(0, 22)}
            </button>
          ))}
          {(data.tenants || []).length ? null : <p className="text-[12.5px] text-slate-400">Belum ada sekolah.</p>}
        </div>
      </Card>

      <Modal open={!!lihat} onClose={() => setLihat(null)} title="Tinjau Pembayaran" size="md">
        {lihat ? (
          <div className="space-y-3 text-[13px]">
            <div className="grid gap-2 sm:grid-cols-2">
              {[['Sekolah', lihat.sekolah], ['Kode', lihat.kode], ['Paket', `${lihat.paket} · ${lihat.bulan} bulan`],
                ['Nominal', rupiah(lihat.nominal)], ['Potongan', rupiah(lihat.potongan)], ['Total', rupiah(lihat.total)],
                ['Promo', lihat.promo || '—'], ['Metode', lihat.metode || 'qris']].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{l}</p>
                  <p className="font-semibold text-slate-800">{v}</p>
                </div>
              ))}
            </div>
            {lihat.bukti_url ? (
              <a href={lihat.bukti_url} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 p-2">
                <img src={lihat.bukti_url} alt="Bukti" className="max-h-64 w-full object-contain" />
                <p className="mt-1 text-center text-[11.5px] font-semibold text-orange-700">Buka bukti pembayaran</p>
              </a>
            ) : <Alert tone="warn" title="Tanpa bukti">Sekolah belum melampirkan bukti transfer.</Alert>}
            {lihat.catatan ? <p className="rounded-lg bg-slate-50 p-2 text-[12px] text-slate-600">Catatan: {lihat.catatan}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy === 'v' + lihat.id} onClick={() => verifikasi(lihat.id, 'setuju')}>
                {busy === 'v' + lihat.id ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Setujui & Perpanjang
              </button>
              <button className="btn-danger" disabled={busy === 'v' + lihat.id} onClick={() => {
                const c = prompt('Alasan penolakan (dikirim ke sekolah):', 'Bukti pembayaran tidak terbaca');
                if (c !== null) verifikasi(lihat.id, 'tolak', c);
              }}><X size={15} /> Tolak</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* =====================================================================
   4. PAKET LANGGANAN
   ===================================================================== */
export function SuperPaket({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api('/api/super/paket').then(setData).catch(e => toast.err(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Spinner label="Memuat paket…" />;

  const kosong = { kode: '', nama: '', harga_bulanan: '', harga_tahunan: '', deskripsi: '', trial_hari: 7, fitur: [], aktif: 1, urutan: (data.rows.length || 0) + 1 };
  async function simpan(e) {
    e.preventDefault();
    try {
      const r = await api('/api/super/paket', { method: 'POST', body: edit });
      toast.ok(r.pesan);
      setEdit(null); load(); ctx.reload();
    } catch (e2) { toast.err(e2.message); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Paket Langganan</h2>
          <p className="text-[12.5px] text-slate-500">Atur harga, masa uji coba, dan modul yang dibuka untuk setiap paket.</p>
        </div>
        <button className="btn-primary" onClick={() => setEdit({ ...kosong })}><Plus size={15} /> Tambah Paket</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.rows.map(p => (
          <Card key={p.kode} title={p.nama} subtitle={`Kode: ${p.kode}`} right={<Badge tone={p.aktif ? 'aman' : 'netral'}>{p.aktif ? 'Aktif' : 'Nonaktif'}</Badge>}>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">1 Bulan</p>
                  <p className="text-[14px] font-extrabold text-slate-800">{rupiah(p.harga_bulanan)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">12 Bulan</p>
                  <p className="text-[14px] font-extrabold text-slate-800">{rupiah(p.harga_tahunan)}</p>
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-slate-600">{p.deskripsi || '—'}</p>
              <p className="text-[11.5px] text-slate-500">Uji coba: <b>{p.trial_hari} hari</b> · Fitur: <b>{p.fitur.includes('*') ? 'semua modul' : p.fitur.length + ' modul'}</b></p>
              <div className="flex flex-wrap gap-1.5">
                {p.fitur.includes('*') ? <Badge tone="prestasi">Semua fitur</Badge> :
                  p.fitur.slice(0, 6).map(f => <Badge key={f} tone="netral">{f}</Badge>)}
                {!p.fitur.includes('*') && p.fitur.length > 6 ? <Badge tone="netral">+{p.fitur.length - 6}</Badge> : null}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...p })}><Pencil size={12} /> Edit</button>
                <button className="btn-ghost btn-sm" onClick={async () => {
                  try { const r = await api('/api/super/paket/toggle', { method: 'POST', body: { kode: p.kode } }); toast.ok(r.pesan); load(); }
                  catch (e) { toast.err(e.message); }
                }}>{p.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button className="btn-danger btn-sm" onClick={async () => {
                  if (!confirm(`Hapus paket ${p.nama}?`)) return;
                  try { const r = await api('/api/super/paket/hapus', { method: 'POST', body: { kode: p.kode } }); toast.ok(r.pesan); load(); }
                  catch (e) { toast.err(e.message); }
                }}><Trash2 size={12} /> Hapus</button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit Paket' : 'Tambah Paket'} size="lg">
        {edit ? (
          <form id="fPaket" className="space-y-3" onSubmit={simpan}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Kode Paket" required hint="huruf kecil, tanpa spasi (mis. basic)"><input className="input" required value={edit.kode} onChange={e => setEdit(v => ({ ...v, kode: e.target.value }))} /></Field>
              <Field label="Nama Paket" required><input className="input" required value={edit.nama} onChange={e => setEdit(v => ({ ...v, nama: e.target.value }))} /></Field>
              <Field label="Harga 1 Bulan (Rp)"><input className="input" inputMode="numeric" value={edit.harga_bulanan} onChange={e => setEdit(v => ({ ...v, harga_bulanan: e.target.value }))} /></Field>
              <Field label="Harga 12 Bulan (Rp)"><input className="input" inputMode="numeric" value={edit.harga_tahunan} onChange={e => setEdit(v => ({ ...v, harga_tahunan: e.target.value }))} /></Field>
              <Field label="Masa Uji Coba (hari)"><input className="input" inputMode="numeric" value={edit.trial_hari} onChange={e => setEdit(v => ({ ...v, trial_hari: e.target.value }))} /></Field>
              <Field label="Urutan"><input className="input" inputMode="numeric" value={edit.urutan} onChange={e => setEdit(v => ({ ...v, urutan: e.target.value }))} /></Field>
              <Field label="Deskripsi" className="sm:col-span-2"><textarea className="input" value={edit.deskripsi || ''} onChange={e => setEdit(v => ({ ...v, deskripsi: e.target.value }))} /></Field>
            </div>
            <div>
              <p className="label">Fitur yang dibuka</p>
              <div className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-slate-100 p-2 sm:grid-cols-2">
                {(data.fitur_all || []).map(f => (
                  <label key={f.key} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-slate-50">
                    <input type="checkbox" className="h-4 w-4 accent-orange-600"
                      checked={edit.fitur.includes('*') || edit.fitur.includes(f.key)}
                      disabled={edit.fitur.includes('*')}
                      onChange={e => setEdit(v => ({ ...v, fitur: e.target.checked ? [...v.fitur, f.key] : v.fitur.filter(x => x !== f.key) }))} />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  </label>
                ))}
              </div>
              <label className="mt-1.5 flex items-center gap-2 text-[12px] font-semibold text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={edit.fitur.includes('*')}
                  onChange={e => setEdit(v => ({ ...v, fitur: e.target.checked ? ['*'] : [] }))} />
                Semua fitur (tanpa batas)
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!Number(edit.aktif ?? 1)}
                onChange={e => setEdit(v => ({ ...v, aktif: e.target.checked ? 1 : 0 }))} /> Paket aktif & dapat dipilih
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Batal</button>
              <button className="btn-primary" type="submit"><Save size={15} /> Simpan Paket</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

/* =====================================================================
   5. QRIS & HARGA
   ===================================================================== */
export function SuperQris({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState({});
  const [promo, setPromo] = useState([]);
  const [pay, setPay] = useState({ gateway_aktif: false, manual_aktif: true, provider: 'sandbox', mode: 'sandbox', expire_menit: 60 });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api('/api/super/qris');
    setData(r);
    setF({
      qris_img: r.s.qris_img || '', rek_nama: r.s.rek_nama || '', rek_nomor: r.s.rek_nomor || '',
      instruksi_bayar: r.s.instruksi_bayar || '', harga_bulanan: r.s.harga_bulanan || '',
      harga_tahunan: r.s.harga_tahunan || '', layanan_nama: r.s.layanan_nama || '',
      trial_hari: r.s.trial_hari || '7'
    });
    setPromo(r.promo || []);
    const pay = r.pay || {};
    setPay({
      gateway_aktif: !!pay.gateway_aktif, manual_aktif: pay.manual_aktif !== false,
      provider: pay.provider || 'sandbox', mode: pay.mode || 'sandbox',
      expire_menit: pay.expire_menit || 60, merchant: '', key: '', key2: '',
      callback: '', base: '', merchant_set: !!pay.merchant_set, key_set: !!pay.key_set,
      key2_set: !!pay.key2_set, callback_set: !!pay.callback_set, base_set: !!pay.base_set,
      callback_url: pay.callback_url || '',
      /* Kasera Pay: mode API, URL webhook, log notifikasi terakhir */
      kasera_api: pay.kasera_api || 'auto',
      webhook_url: pay.webhook_url || '', webhook_secret_set: !!pay.webhook_secret_set,
      events: pay.events || []
    });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!data) return <Spinner label="Memuat pengaturan QRIS…" />;

  async function simpan() {
    setBusy(true);
    try {
      const r = await api('/api/super/qris', { method: 'POST', body: { ...f, promo, pay } });
      toast.ok(r.pesan);
      load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <Card title="Metode Pembayaran" subtitle="Tampil pada halaman perpanjangan sekolah">
          <div className="space-y-3">
            <UploadGambar label="Gambar QRIS" value={f.qris_img} onChange={u => setF(v => ({ ...v, qris_img: u }))}
              hint="Unggah QRIS resmi (PNG/JPG/WebP). Ditampilkan di halaman pembayaran sekolah." jenis="logo" />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Nama Pemilik Rekening"><input className="input" value={f.rek_nama} onChange={e => setF(v => ({ ...v, rek_nama: e.target.value }))} /></Field>
              <Field label="Nomor Rekening / E-Wallet" hint="Contoh: 0812xxxx (DANA) / BCA 1234567890">
                <input className="input" value={f.rek_nomor} onChange={e => setF(v => ({ ...v, rek_nomor: e.target.value }))} />
              </Field>
            </div>
            <Field label="Instruksi Pembayaran"><textarea className="input min-h-[90px]" value={f.instruksi_bayar} onChange={e => setF(v => ({ ...v, instruksi_bayar: e.target.value }))} /></Field>
            <Field label="Nama Layanan (judul halaman login)"><input className="input" value={f.layanan_nama} onChange={e => setF(v => ({ ...v, layanan_nama: e.target.value }))} /></Field>
          </div>
        </Card>

        <Card title="Metode Pembayaran Hybrid" subtitle="Aktifkan QRIS otomatis (payment gateway) &/atau QRIS manual secara berdampingan"
          data-pay-methods="1">
          <div className="space-y-2.5">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!pay.gateway_aktif}
                data-pay-gateway onChange={e => setPay(v => ({ ...v, gateway_aktif: e.target.checked }))} />
              <span>
                <span className="block text-[12.5px] font-semibold text-slate-700">QRIS Otomatis (Payment Gateway)</span>
                <span className="block text-[11px] text-slate-500">QRIS dinamis + verifikasi status pembayaran otomatis lewat callback.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!pay.manual_aktif}
                data-pay-manual onChange={e => setPay(v => ({ ...v, manual_aktif: e.target.checked }))} />
              <span>
                <span className="block text-[12.5px] font-semibold text-slate-700">QRIS Manual (Transfer / Unggah Bukti)</span>
                <span className="block text-[11px] text-slate-500">Gambar QRIS statis + rekening/e-wallet, bukti diverifikasi manual oleh Super Admin.</span>
              </span>
            </label>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Provider Gateway">
                <select className="input" value={pay.provider} data-pay-provider
                  onChange={e => setPay(v => ({ ...v, provider: e.target.value }))}>
                  {(data.pay?.providers || [{ key: 'sandbox', label: 'Simulasi' }]).map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mode">
                <select className="input" value={pay.mode} data-pay-mode
                  onChange={e => setPay(v => ({ ...v, mode: e.target.value }))}>
                  <option value="sandbox">Sandbox / Uji Coba</option>
                  <option value="production">Production (Live)</option>
                </select>
              </Field>
            </div>
            {pay.provider === 'kasera' ? (
              <p className="text-[11px] text-slate-500">
                Kasera memakai URL API yang sama untuk test dan live; gunakan key <span className="font-mono">kp_test_</span> untuk Sandbox
                atau <span className="font-mono">kp_live_</span> untuk Production.
              </p>
            ) : null}
            <Field label="Merchant Code / Merchant ID" hint="Duitku: Merchant Code · Kasera: Merchant ID. Boleh kosong untuk provider lain.">
              <input className="input" value={pay.merchant} placeholder={pay.merchant_set ? '•••• (tersimpan)' : 'mis. D1234'}
                onChange={e => setPay(v => ({ ...v, merchant: e.target.value }))} />
            </Field>
            <Field label="Server Key / API Key" hint={pay.key_set ? 'Kunci sudah tersimpan — isi hanya bila ingin mengganti.'
              : pay.provider === 'kasera' ? 'Masukkan API Key Kasera dari menu Developer (kp_test_… atau kp_live_…).'
                : 'Belum ada kunci tersimpan.'}>
              <input className="input" type="password" value={pay.key} autoComplete="new-password"
                placeholder={pay.key_set ? '•••••••• (tersimpan)' : 'tempel kunci di sini'}
                data-pay-key onChange={e => setPay(v => ({ ...v, key: e.target.value }))} />
            </Field>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Client Key / Callback Token" hint="Midtrans: Client Key · Xendit: Callback Token · Kasera: Callback Secret">
                <input className="input" value={pay.key2} onChange={e => setPay(v => ({ ...v, key2: e.target.value }))} />
              </Field>
              <Field label="Kedaluwarsa QRIS (menit)">
                <input className="input" inputMode="numeric" value={pay.expire_menit}
                  onChange={e => setPay(v => ({ ...v, expire_menit: e.target.value }))} />
              </Field>
            </div>
            <Field label="Base URL API Gateway (opsional)" hint="Khusus Kasera: isi hanya bila base URL API berbeda. URL resmi untuk Sandbox maupun Production adalah https://pay.kasera.id.">
              <input className="input font-mono text-[11.5px]" value={pay.base || ''} data-pay-base placeholder={pay.base_set ? '•••• (tersimpan)' : 'https://pay.kasera.id'}
                onChange={e => setPay(v => ({ ...v, base: e.target.value }))} />
            </Field>
            <Field label="URL Callback (otomatis)" hint="Daftarkan URL ini pada dashboard payment gateway agar status pembayaran terverifikasi otomatis.">
              <input className="input font-mono text-[11.5px]" value={pay.callback_url || ''} readOnly />
            </Field>

            {/* ---- Kasera Pay: transaksi + webhook otomatis ---- */}
            <div className="rounded-xl border border-dashed border-slate-200 p-3" data-kasera-pay="1">
              <div className="mb-2">
                <div className="text-[12.5px] font-semibold text-slate-700">Kasera Pay — Transaksi &amp; Webhook Otomatis</div>
                <div className="text-[11px] text-slate-500">
                  POST <span className="font-mono">/v1/transactions</span> → <span className="font-mono">checkout_url</span> ·
                  verifikasi tanda tangan bertimestamp <span className="font-mono">Kasera-Signature-V1</span>
                </div>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="Webhook Secret" hint={pay.callback_set
                  ? 'Secret sudah tersimpan — isi hanya bila ingin mengganti.'
                  : 'Tempel Webhook Secret dari dashboard Kasera (atau set KASERA_WEBHOOK_SECRET).'}>
                  <input className="input" type="password" autoComplete="new-password"
                    placeholder={pay.callback_set ? '•••••••• (tersimpan)' : 'webhook secret'}
                    data-pay-callback onChange={e => setPay(v => ({ ...v, callback: e.target.value }))} />
                </Field>
                <Field label="API Kasera yang dipakai">
                  <select className="input" value={pay.kasera_api || 'auto'} data-pay-kasera-api
                    onChange={e => setPay(v => ({ ...v, kasera_api: e.target.value }))}>
                    <option value="auto">Otomatis — /v1/transactions, QRIS lama cadangan</option>
                    <option value="transactions">Hanya /v1/transactions</option>
                    <option value="qris">Hanya /v1/qris (QRIS lama)</option>
                  </select>
                </Field>
              </div>
              <Field label="URL Webhook untuk dashboard Kasera">
                <input className="input font-mono text-[11.5px]" value={pay.webhook_url || ''} readOnly data-pay-webhook />
                <div className="mt-1 text-[11px] text-slate-500">
                  Status secret:{' '}
                  <span className={pay.webhook_secret_set ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                    {pay.webhook_secret_set ? 'terpasang' : 'belum diisi'}
                  </span>
                  {' · '}rute webhook tidak memakai sesi &amp; dikecualikan dari CSRF.
                </div>
              </Field>
              {(pay.events || []).length > 0 && (
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-[11px]" data-tbl="kasera-event">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr><th className="px-2 py-1.5">Waktu</th><th className="px-2 py-1.5">Event</th>
                        <th className="px-2 py-1.5">Nomor Pesanan</th><th className="px-2 py-1.5 text-right">Nominal</th>
                        <th className="px-2 py-1.5">Hasil</th></tr>
                    </thead>
                    <tbody>
                      {(pay.events || []).map(ev => (
                        <tr key={ev.event_id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-500">{ev.diterima_at}</td>
                          <td className="px-2 py-1.5">{ev.tipe || '-'}</td>
                          <td className="px-2 py-1.5 font-mono">{ev.order_id || '-'}</td>
                          <td className="px-2 py-1.5 text-right">{Number(ev.jumlah || 0).toLocaleString('id-ID')}</td>
                          <td className="px-2 py-1.5">
                            <span className={ev.hasil === 'ok' ? 'font-semibold text-emerald-700'
                              : ev.hasil === 'gagal' ? 'font-semibold text-rose-700' : 'text-slate-600'}>
                              {ev.hasil || '-'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className={cx('rounded-xl px-3 py-2 text-[11.5px] leading-relaxed',
              pay.gateway_aktif && pay.provider !== 'sandbox' && !pay.key_set
                ? 'border border-rose-200 bg-rose-50 text-rose-800'
                : 'border border-sky-200 bg-sky-50/70 text-sky-900')}>
              {pay.gateway_aktif && pay.provider !== 'sandbox' && !pay.key_set
                ? 'Kredensial gateway belum lengkap — QRIS otomatis akan gagal sampai kunci diisi.'
                : pay.provider === 'sandbox'
                  ? 'Provider "Simulasi" tidak menghubungi jaringan: QRIS dibuat lokal dan dapat disimulasikan lunas oleh sekolah untuk pengujian.'
                  : 'Pastikan URL callback di atas terdaftar pada dashboard provider agar pembayaran terverifikasi real-time.'}
            </div>
          </div>
        </Card>

        <Card title="Harga & Masa Uji Coba" subtitle="Harga dasar bila paket tidak memiliki harga sendiri">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Field label="Harga 1 Bulan (Rp)"><input className="input" inputMode="numeric" value={f.harga_bulanan} onChange={e => setF(v => ({ ...v, harga_bulanan: e.target.value }))} /></Field>
            <Field label="Harga 12 Bulan (Rp)"><input className="input" inputMode="numeric" value={f.harga_tahunan} onChange={e => setF(v => ({ ...v, harga_tahunan: e.target.value }))} /></Field>
            <Field label="Masa Uji Coba (hari)"><input className="input" inputMode="numeric" value={f.trial_hari} onChange={e => setF(v => ({ ...v, trial_hari: e.target.value }))} /></Field>
          </div>
        </Card>

        <Card title="Kode Promo" subtitle="Potongan persen untuk perpanjangan sekolah"
          right={<button className="btn-ghost btn-sm" onClick={() => setPromo(p => [...p, { kode: '', persen: 10, catatan: '' }])}><Plus size={13} /> Tambah</button>}>
          <div className="space-y-2">
            {promo.map((p, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <Field label={i === 0 ? 'Kode' : undefined} className="min-w-[120px] flex-1">
                  <input className="input" value={p.kode} placeholder="HEMAT10" onChange={e => setPromo(list => list.map((x, j) => j === i ? { ...x, kode: e.target.value } : x))} />
                </Field>
                <Field label={i === 0 ? 'Potongan %' : undefined} className="w-[110px]">
                  <input className="input" inputMode="numeric" value={p.persen} onChange={e => setPromo(list => list.map((x, j) => j === i ? { ...x, persen: e.target.value } : x))} />
                </Field>
                <Field label={i === 0 ? 'Catatan' : undefined} className="min-w-[160px] flex-[2]">
                  <input className="input" value={p.catatan || ''} onChange={e => setPromo(list => list.map((x, j) => j === i ? { ...x, catatan: e.target.value } : x))} />
                </Field>
                <button className="btn-danger btn-sm" onClick={() => setPromo(list => list.filter((x, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
            {!promo.length ? <p className="text-[12.5px] text-slate-400">Belum ada kode promo.</p> : null}
          </div>
        </Card>

        <button className="btn-primary w-full py-2.5" disabled={busy} onClick={simpan}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Simpan QRIS & Harga
        </button>
      </div>

      <div className="space-y-4">
        <Card title="Pratinjau Halaman Pembayaran" subtitle="Tampilan yang dilihat sekolah">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-center text-[12px] font-bold uppercase tracking-wide text-slate-500">{f.layanan_nama || 'Nama Layanan'}</p>
            <p className="mt-0.5 text-center text-[15px] font-extrabold text-slate-800">Perpanjang Langganan</p>
            <div className="mt-3 grid place-items-center rounded-xl bg-slate-50 p-3">
              {f.qris_img ? <img src={f.qris_img} alt="QRIS" className="max-h-[170px] object-contain" /> :
                <div className="grid h-[150px] w-[150px] place-items-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400"><QrCode size={44} /></div>}
            </div>
            <div className="mt-3 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-slate-500">Pemilik</span><b className="text-slate-800">{f.rek_nama || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">No. Rekening</span><b className="text-slate-800">{f.rek_nomor || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">1 Bulan</span><b className="text-slate-800">{rupiah(f.harga_bulanan)}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">12 Bulan</span><b className="text-slate-800">{rupiah(f.harga_tahunan)}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Uji coba</span><b className="text-slate-800">{f.trial_hari} hari</b></div>
            </div>
            {f.instruksi_bayar ? <p className="mt-2 rounded-lg bg-orange-50 p-2 text-[11.5px] leading-relaxed text-orange-800">{f.instruksi_bayar}</p> : null}
          </div>
        </Card>
        <Card title="Ringkasan" subtitle="Status pengaturan pembayaran">
          <div className="space-y-1.5 text-[12.5px]">
            <div className="flex justify-between"><span className="text-slate-500">QRIS</span><Badge tone={f.qris_img ? 'aman' : 'pantau'}>{f.qris_img ? 'Terpasang' : 'Belum'}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-500">QRIS Otomatis</span>
              <Badge tone={pay.gateway_aktif ? 'aman' : 'netral'}>{pay.gateway_aktif ? `${pay.provider} aktif` : 'Nonaktif'}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-500">QRIS Manual</span>
              <Badge tone={pay.manual_aktif ? 'aman' : 'netral'}>{pay.manual_aktif ? 'Aktif' : 'Nonaktif'}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-500">Rekening / E-Wallet</span><Badge tone={f.rek_nomor ? 'aman' : 'pantau'}>{f.rek_nomor ? 'Terisi' : 'Belum'}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-500">Kode promo aktif</span><b>{promo.filter(p => Number(p.persen) > 0).length}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">Paket terdaftar</span><b>{data.paket.length}</b></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
