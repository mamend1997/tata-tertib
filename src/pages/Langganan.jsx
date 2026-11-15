import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, CalendarDays, CheckCircle2, Clock, Copy, CreditCard, ExternalLink, FileText, Info, LifeBuoy,
  Loader2, QrCode, RefreshCw, Send, ShieldCheck, Sparkles, Wallet
} from 'lucide-react';
import { api, tgl, waktu, angka } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';

const rupiah = n => 'Rp ' + angka(n || 0);
const Badge = ({ children, tone = 'netral' }) => <span className={cx('badge', `badge-${tone}`)}>{children}</span>;

/* =====================================================================
   INFO & LAYANAN LANGGANAN (panel sekolah)
   ===================================================================== */
export default function Langganan({ ctx }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [bayarOpen, setBayarOpen] = useState(false);
  const [f, setF] = useState({ paket: '', bulan: 1, promo: '', metode: 'manual', bukti_url: '', catatan: '' });
  const [busy, setBusy] = useState(false);
  const [gtw, setGtw] = useState(null);        // QRIS dinamis hasil gateway
  const [gtwStatus, setGtwStatus] = useState('');
  const [sandi, setSandi] = useState('');
  const load = useCallback(async () => {
    const r = await api('/api/langganan');
    setD(r);
    setF(v => ({ ...v, paket: v.paket || r.tenant.paket, bulan: v.bulan || 1 }));
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  /* polling status pembayaran QRIS otomatis */
  useEffect(() => {
    if (!gtw || gtwStatus === 'disetujui') return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api('/api/langganan/gateway/status?order=' + encodeURIComponent(gtw.order_id));
        if (!alive) return;
        setGtwStatus(r.paid ? 'disetujui' : (r.gateway_status || 'menunggu'));
        if (r.paid) { toast.ok('Pembayaran terverifikasi — masa aktif layanan diperpanjang.'); load(); ctx.reload(); }
      } catch (e) { /* diamkan, coba lagi */ }
    };
    const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [gtw, gtwStatus]);

  if (!d) return <Spinner label="Memuat info langganan…" />;

  const t = d.tenant;
  const nominal = (() => {
    const paket = (d.paket_list || []).find(p => p.kode === f.paket);
    const harga = paket ? (Number(f.bulan) >= 12 ? paket.harga_tahunan : paket.harga_bulanan) : (Number(f.bulan) >= 12 ? d.harga_tahunan : d.harga_bulanan);
    const pr = (d.promo_aktif || []).find(p => String(p.kode).toUpperCase() === String(f.promo).toUpperCase());
    const potongan = pr ? Math.round(Number(harga || 0) * Number(pr.persen) / 100) : 0;
    return { harga: Number(harga || 0), potongan, total: Math.max(0, Number(harga || 0) - potongan) };
  })();

  async function ajukan(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/langganan/bayar', { method: 'POST', body: f });
      toast.ok(r.pesan);
      setBayarOpen(false); setF(v => ({ ...v, promo: '', bukti_url: '', catatan: '' }));
      load(); ctx.reload();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  /* ---------- QRIS otomatis (payment gateway) ---------- */
  async function buatQris() {
    setBusy(true); setGtwStatus('');
    try {
      const r = await api('/api/langganan/bayar', { method: 'POST', body: { ...f, metode: 'gateway' } });
      setGtw(r.pembayaran);
      setGtwStatus('menunggu');
      toast.ok(r.pesan);
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }

  async function simulasiLunas() {
    try {
      const r = await api('/api/langganan/gateway/simulasi', { method: 'POST', body: { order: gtw.order_id } });
      toast.ok(r.pesan);
      setGtwStatus('disetujui'); load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
  }
  async function unggahBukti(file) {
    if (!file) return;
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
        r.onerror = rej; r.readAsDataURL(file);
      });
      const r = await api('/api/upload', { method: 'POST', body: { base64: b64, filename: file.name, jenis: 'bukti' } });
      setF(v => ({ ...v, bukti_url: r.url }));
      toast.ok('Bukti pembayaran terunggah.');
    } catch (e) { toast.err(e.message); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Info &amp; Layanan</h2>
        <p className="text-[12.5px] text-slate-500">Ringkasan langganan sekolah Anda dan perpanjangan layanan.</p>
      </div>

      {t.lifetime ? (
        <div className="rounded-2xl p-4 text-white shadow-card" style={{ background: 'linear-gradient(135deg, #7c3aed, #4c1d95)' }}>
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-white/80"><Sparkles size={14} /> Paket Lifetime</p>
          <p className="mt-1 text-[19px] font-extrabold">{t.nama}</p>
          <p className="text-[12.5px] text-white/85">Akses seluruh fitur tanpa batas masa aktif — tidak ada tagihan berulang.</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Paket', t.paket_nama, t.lifetime ? 'Lifetime' : `${t.paket}`],
          ['Tanggal Register', tgl(t.created_at), 'sejak awal berlangganan'],
          ['Nominal Tagihan', d.tagihan ? rupiah(d.tagihan.total) : 'Tidak ada', d.tagihan ? `jatuh tempo ${tgl(d.tagihan.jatuh_tempo)}` : 'semua lunas'],
          ['Masa Aktif s.d.', t.lifetime ? 'Lifetime' : (t.aktif_sampai ? tgl(t.aktif_sampai) : '-'), d.sisa_hari !== null ? (d.sisa_hari >= 0 ? `${d.sisa_hari} hari tersisa` : `terlewat ${Math.abs(d.sisa_hari)} hari`) : 'tanpa batas']
        ].map(([l, v, s]) => (
          <div key={l} className="card p-3.5">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{l}</p>
            <p className="mt-0.5 text-[15px] font-extrabold leading-tight text-slate-800">{v}</p>
            <p className="text-[11px] text-slate-500">{s}</p>
          </div>
        ))}
      </div>

      {t.status === 'ditangguhkan' ? (
        <Alert tone="danger" title="Akun dibatasi">
          Masa aktif layanan telah berakhir sehingga menu operasional dibatasi. Silakan ajukan perpanjangan —
          setelah pembayaran diverifikasi, seluruh menu aktif kembali otomatis.
        </Alert>
      ) : null}
      {!t.lifetime && d.sisa_hari !== null && d.sisa_hari <= 7 && d.sisa_hari >= 0 ? (
        <Alert tone="warn" title="Masa aktif hampir berakhir">
          Tersisa {d.sisa_hari} hari. Ajukan perpanjangan sekarang agar layanan tidak terhenti.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Perpanjangan Layanan" subtitle="Pilih paket & durasi, lalu ajukan pembayaran">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Kode Sekolah"><input className="input font-mono" value={t.kode} readOnly /></Field>
              <Field label="Sekolah"><input className="input" value={t.nama} readOnly /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(d.paket_list || []).map(p => (
                <button key={p.kode} type="button" onClick={() => setF(v => ({ ...v, paket: p.kode }))}
                  className={cx('rounded-xl border p-3 text-left transition', f.paket === p.kode ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-200' : 'border-slate-200 hover:bg-slate-50')}>
                  <p className="text-[12.5px] font-extrabold text-slate-800">{p.nama}</p>
                  <p className="text-[11px] text-slate-500">{rupiah(p.harga_bulanan)} / bln</p>
                  <p className="text-[11px] text-slate-500">{rupiah(p.harga_tahunan)} / 12 bln</p>
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[1, 12].map(n => (
                <button key={n} type="button" onClick={() => setF(v => ({ ...v, bulan: n }))}
                  className={cx('rounded-xl border px-3 py-2 text-[12.5px] font-bold transition', Number(f.bulan) === n ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                  {n === 1 ? '1 Bulan' : '12 Bulan (hemat)'}
                </button>
              ))}
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Total</p>
                <p className="text-[14px] font-extrabold text-slate-800">{rupiah(nominal.total)}</p>
              </div>
            </div>
            <button className="btn-primary w-full py-2.5" onClick={() => setBayarOpen(true)} disabled={t.lifetime}>
              <Wallet size={16} /> Perpanjang Sekarang
            </button>
            {t.lifetime ? <p className="text-center text-[11.5px] text-slate-500">Sekolah Anda berstatus Lifetime — tidak memerlukan perpanjangan.</p> : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Metode Pembayaran" subtitle="QRIS otomatis & QRIS manual">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <span className={cx('badge', d.pay?.gateway_aktif ? 'badge-aman' : 'badge-netral')}>
                QRIS Otomatis {d.pay?.gateway_aktif ? `· ${d.pay.provider_label}` : '· nonaktif'}
              </span>
              <span className={cx('badge', d.pay?.manual_aktif ? 'badge-aman' : 'badge-netral')}>
                QRIS Manual {d.pay?.manual_aktif ? '· aktif' : '· nonaktif'}
              </span>
            </div>
            <div className={cx('grid place-items-center rounded-xl bg-slate-50 p-3', !d.pay?.manual_aktif && 'opacity-50')}>
              {d.qris.img ? <img src={d.qris.img} alt="QRIS" className="max-h-[190px] object-contain" /> :
                <div className="grid h-[150px] w-[150px] place-items-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400"><QrCode size={40} /></div>}
            </div>
            <div className="mt-2 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-slate-500">Pemilik</span><b>{d.qris.nama || '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">No. Rekening</span><b>{d.qris.nomor || '—'}</b></div>
            </div>
            {d.qris.instruksi ? <p className="mt-2 rounded-lg bg-orange-50 p-2 text-[11.5px] leading-relaxed text-orange-800">{d.qris.instruksi}</p> : null}
          </Card>
          {d.promo_aktif?.length ? (
            <Card title="Kode Promo Aktif" subtitle="Masukkan saat mengajukan pembayaran">
              <div className="flex flex-wrap gap-1.5">
                {d.promo_aktif.map(p => (
                  <span key={p.kode} className="rounded-lg bg-emerald-50 px-2 py-1 text-[11.5px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                    {p.kode} · -{p.persen}%
                  </span>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Riwayat Tagihan" bodyClass="p-0">
          <div className="max-h-[280px] overflow-auto">
            <table className="tbl">
              <thead><tr><th>Periode</th><th>Nominal</th><th>Jatuh Tempo</th><th>Status</th></tr></thead>
              <tbody>
                {(d.tagihan_list || []).map(g => (
                  <tr key={g.id}>
                    <td className="font-mono text-[11.5px]">{g.periode}</td>
                    <td>{rupiah(g.total)}</td>
                    <td className="text-[12px]">{tgl(g.jatuh_tempo)}</td>
                    <td><Badge tone={g.status === 'lunas' ? 'aman' : 'pantau'}>{g.status}</Badge></td>
                  </tr>
                ))}
                {!(d.tagihan_list || []).length ? <tr><td colSpan={4} className="text-slate-400">Belum ada tagihan.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Pengajuan Pembayaran" bodyClass="p-0">
          <div className="max-h-[280px] overflow-auto divide-y divide-slate-100">
            {(d.pembayaran || []).map(p => (
              <div key={p.id} className="flex items-center gap-2 p-2.5">
                <Badge tone={p.status === 'disetujui' ? 'aman' : p.status === 'ditolak' ? 'siaga' : 'pantau'}>{p.status}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-slate-700">{p.bulan} bulan · {rupiah(p.total)}</p>
                  <p className="text-[11px] text-slate-400">{waktu(p.created_at)}{p.catatan ? ' · ' + p.catatan : ''}</p>
                </div>
              </div>
            ))}
            {!(d.pembayaran || []).length ? <div className="p-3"><Empty title="Belum ada pengajuan" desc="Ajukan perpanjangan untuk memulai." /></div> : null}
          </div>
        </Card>
      </div>

      <Modal open={bayarOpen} onClose={() => { setBayarOpen(false); setGtw(null); setGtwStatus(''); }}
        title="Pembayaran Perpanjangan" size="md"
        subtitle={d.pay?.gateway_aktif && d.pay?.manual_aktif ? 'Pilih metode pembayaran yang Anda inginkan' : null}>
        {/* ---- pilih metode (hybrid) ---- */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2" data-metode-pilih="1">
          <button type="button" disabled={!d.pay?.gateway_aktif}
            data-metode="gateway"
            onClick={() => { setF(v => ({ ...v, metode: 'gateway' })); setGtw(null); }}
            className={cx('rounded-xl border p-3 text-left transition',
              f.metode === 'gateway' ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-200' : 'border-slate-200 hover:bg-slate-50',
              !d.pay?.gateway_aktif && 'cursor-not-allowed opacity-50')}>
            <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-slate-800"><QrCode size={14} /> QRIS Otomatis</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              {d.pay?.gateway_aktif ? 'QRIS dinamis, status pembayaran diverifikasi otomatis.' : 'Dinonaktifkan Super Admin.'}
            </p>
          </button>
          <button type="button" disabled={!d.pay?.manual_aktif}
            data-metode="manual"
            onClick={() => setF(v => ({ ...v, metode: 'manual' }))}
            className={cx('rounded-xl border p-3 text-left transition',
              f.metode === 'manual' ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-200' : 'border-slate-200 hover:bg-slate-50',
              !d.pay?.manual_aktif && 'cursor-not-allowed opacity-50')}>
            <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-slate-800"><Upload2 /> QRIS Manual</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              {d.pay?.manual_aktif ? 'Scan QRIS statis lalu unggah bukti transfer.' : 'Dinonaktifkan Super Admin.'}
            </p>
          </button>
        </div>

        {/* ---- QRIS OTOMATIS ---- */}
        {f.metode === 'gateway' ? (
          <div className="space-y-3" data-panel="gateway">
            <div className="rounded-xl bg-slate-50 p-3 text-[12.5px]">
              <div className="flex justify-between"><span className="text-slate-500">Paket</span><b>{f.paket || t.paket}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Durasi</span><b>{Number(f.bulan) >= 12 ? '12 bulan' : '1 bulan'}</b></div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="font-bold text-slate-700">Total dibayar</span>
                <b className="text-[14px] text-orange-700">{rupiah(nominal.total)}</b>
              </div>
            </div>
            {!gtw ? (
              <button type="button" className="btn-primary w-full py-2.5" onClick={buatQris} disabled={busy}
                data-buat-qris="1">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />} Buat QRIS Dinamis
              </button>
            ) : (
              <div className="space-y-2.5" data-qris-gateway="1">
                {gtw.checkout_url ? (
                  <a href={gtw.checkout_url} target="_blank" rel="noopener noreferrer"
                    className="btn-primary flex w-full items-center justify-center gap-2 py-2.5" data-checkout-url="1">
                    <ExternalLink size={15} /> Buka Halaman Pembayaran
                  </a>
                ) : null}
                <div className="grid place-items-center rounded-xl border border-slate-200 bg-white p-3">
                  {gtw.qr_url ? <img src={gtw.qr_url} alt="QRIS" className="max-h-[240px] object-contain" />
                    : <div className="text-center">
                        <div className="mx-auto grid h-[150px] w-[150px] place-items-center rounded-xl border-2 border-dashed border-orange-300 bg-orange-50/60 p-2">
                          <span className="break-all font-mono text-[9.5px] leading-tight text-slate-500">{gtw.qr_string || 'QR tidak tersedia'}</span>
                        </div>
                        <p className="mt-1 text-[10.5px] text-slate-400">QR string dari gateway</p>
                      </div>}
                </div>
                <div className="space-y-1 rounded-xl bg-slate-50 p-2.5 text-[11.5px]">
                  <div className="flex justify-between gap-2"><span className="text-slate-500">Order</span><b className="font-mono">{gtw.order_id}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">Nominal</span><b>{rupiah(gtw.total)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">Provider</span><b>{d.pay?.provider_label || gtw.provider}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">Status</span>
                    <span className={cx('badge', gtwStatus === 'disetujui' ? 'badge-aman' : 'badge-pantau')}>{gtwStatus || 'menunggu'}</span></div>
                </div>
                {gtwStatus === 'disetujui' ? (
                  <Alert tone="ok" title="Pembayaran terverifikasi">Masa aktif layanan sudah diperpanjang otomatis.</Alert>
                ) : (
                  <>
                    <p className="text-center text-[11.5px] text-slate-500">Halaman ini memeriksa status pembayaran secara otomatis setiap beberapa detik.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-ghost flex-1" onClick={async () => {
                        try { const r = await api('/api/langganan/gateway/status?order=' + encodeURIComponent(gtw.order_id));
                          setGtwStatus(r.paid ? 'disetujui' : (r.gateway_status || 'menunggu'));
                          if (r.paid) { toast.ok('Pembayaran terverifikasi.'); load(); ctx.reload(); }
                          else toast.info('Status: ' + (r.gateway_status || 'menunggu'));
                        } catch (e) { toast.err(e.message); }
                      }}><RefreshCw size={14} /> Cek Status</button>
                      {gtw.provider === 'sandbox' ? (
                        <button type="button" className="btn-primary flex-1" onClick={simulasiLunas} data-simulasi-lunas="1">
                          <CheckCircle2 size={14} /> Simulasikan Lunas
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
        <form className="space-y-3" onSubmit={ajukan} data-panel="manual">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Paket">
              <select className="input" value={f.paket} onChange={e => setF(v => ({ ...v, paket: e.target.value }))}>
                {(d.paket_list || []).map(p => <option key={p.kode} value={p.kode}>{p.nama}</option>)}
              </select>
            </Field>
            <Field label="Durasi">
              <select className="input" value={f.bulan} onChange={e => setF(v => ({ ...v, bulan: Number(e.target.value) }))}>
                <option value={1}>1 Bulan</option>
                <option value={12}>12 Bulan</option>
              </select>
            </Field>
            <Field label="Kode Promo (opsional)"><input className="input" value={f.promo} onChange={e => setF(v => ({ ...v, promo: e.target.value }))} placeholder="HEMAT10" /></Field>
            <Field label="Jenis Bukti"><select className="input" value={f.jenis_bayar || 'qris'}
              onChange={e => setF(v => ({ ...v, jenis_bayar: e.target.value }))}>
              <option value="qris">QRIS</option><option value="transfer">Transfer Bank</option><option value="ewallet">E-Wallet</option>
            </select></Field>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-[12.5px]">
            <div className="flex justify-between"><span className="text-slate-500">Harga</span><b>{rupiah(nominal.harga)}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">Potongan promo</span><b className="text-emerald-600">-{rupiah(nominal.potongan)}</b></div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1"><span className="font-bold text-slate-700">Total dibayar</span><b className="text-[14px] text-orange-700">{rupiah(nominal.total)}</b></div>
          </div>
          <Field label="Bukti Pembayaran" hint="Unggah tangkapan layar/foto bukti transfer agar dapat diverifikasi.">
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn-ghost btn-sm cursor-pointer">
                <Upload2 /> Pilih Gambar
                <input type="file" accept="image/*" className="hidden" onChange={e => unggahBukti(e.target.files?.[0])} />
              </label>
              {f.bukti_url ? <a href={f.bukti_url} target="_blank" rel="noreferrer" className="text-[11.5px] font-bold text-emerald-700 underline">Bukti terunggah</a> : <span className="text-[11.5px] text-slate-400">belum ada</span>}
            </div>
          </Field>
          <Field label="Catatan (opsional)"><textarea className="input" value={f.catatan} onChange={e => setF(v => ({ ...v, catatan: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setBayarOpen(false)}>Batal</button>
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Kirim Pengajuan</button>
          </div>
        </form>
        )}
      </Modal>
    </div>
  );
}
const Upload2 = () => <CreditCard size={14} />;

/* =====================================================================
   PUSAT BANTUAN / TIKET (panel sekolah)
   ===================================================================== */
export function Tiket({ ctx }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [form, setForm] = useState({ judul: '', kategori: 'umum', prioritas: 'normal', pesan: '' });
  const [buka, setBuka] = useState(null);
  const [balas, setBalas] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/tiket').then(setD).catch(e => toast.err(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner label="Memuat tiket…" />;

  async function kirim(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/tiket', { method: 'POST', body: form });
      toast.ok(r.pesan);
      setForm({ judul: '', kategori: 'umum', prioritas: 'normal', pesan: '' });
      load();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(false); }
  }
  async function kirimBalas() {
    setBusy(true);
    try {
      const r = await api('/api/tiket/balas', { method: 'POST', body: { id: buka.id, pesan: balas } });
      toast.ok(r.pesan);
      setBuka(r.tiket); setBalas(''); load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Pusat Bantuan</h2>
          <p className="text-[12.5px] text-slate-500">Kirim kendala ke tim dukungan — balasan masuk ke halaman ini dan WhatsApp sekolah.</p>
        </div>
        <Card title="Tiket Saya" bodyClass="p-0">
          <div className="divide-y divide-slate-100">
            {(d.rows || []).map(k => (
              <button key={k.id} onClick={() => { setBuka(k); setBalas(''); }} className="flex w-full items-center gap-2.5 p-3 text-left hover:bg-slate-50">
                <LifeBuoy size={16} className="text-orange-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-slate-800">#{k.id} {k.judul}</p>
                  <p className="text-[11px] text-slate-500">{waktu(k.dibuat)} · {k.kategori} · {k.jumlah_pesan} pesan</p>
                </div>
                <Badge tone={k.status === 'selesai' ? 'aman' : k.status === 'baru' ? 'pantau' : 'netral'}>{k.status}</Badge>
              </button>
            ))}
            {!(d.rows || []).length ? <div className="p-4"><Empty title="Belum ada tiket" desc="Kirim kendala pertama Anda melalui formulir di samping." /></div> : null}
          </div>
        </Card>
        {buka ? (
          <Card title={`#${buka.id} ${buka.judul}`} subtitle={`${buka.kategori} · ${buka.status}`} right={<button className="btn-ghost btn-sm" onClick={() => setBuka(null)}>Tutup</button>}>
            <div className="max-h-[300px] space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-2.5">
              {(buka.pesan || []).map(m => (
                <div key={m.id} className={cx('rounded-xl p-2.5 text-[12.5px]', m.dari === 'super' ? 'mr-6 bg-teal-50 ring-1 ring-teal-100' : 'ml-6 bg-white ring-1 ring-slate-200')}>
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{m.dari === 'super' ? 'Tim Dukungan' : 'Anda'} · {waktu(m.created_at)}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{m.pesan}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input className="input" value={balas} onChange={e => setBalas(e.target.value)} placeholder="Tulis balasan…" />
              <button className="btn-primary" disabled={!balas || busy} onClick={kirimBalas}><Send size={15} /> Kirim</button>
            </div>
          </Card>
        ) : null}
      </div>
      <Card title="Buat Tiket Baru" subtitle="Jelaskan kendala sedetail mungkin">
        <form className="space-y-2.5" onSubmit={kirim}>
          <Field label="Judul" required><input className="input" required value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))} /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kategori">
              <select className="input" value={form.kategori} onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))}>
                {(d.kategori || []).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Prioritas">
              <select className="input" value={form.prioritas} onChange={e => setForm(f => ({ ...f, prioritas: e.target.value }))}>
                <option value="rendah">Rendah</option><option value="normal">Normal</option><option value="tinggi">Tinggi</option>
              </select>
            </Field>
          </div>
          <Field label="Uraian Kendala"><textarea className="input min-h-[110px]" value={form.pesan} onChange={e => setForm(f => ({ ...f, pesan: e.target.value }))} /></Field>
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LifeBuoy size={16} />} Kirim Tiket
          </button>
        </form>
      </Card>
    </div>
  );
}

/* =====================================================================
   PETUNJUK PENGGUNA (panel sekolah)
   ===================================================================== */
export function Panduan() {
  const toast = useToast();
  const [d, setD] = useState(null);
  useEffect(() => { api('/api/panduan').then(setD).catch(e => toast.err(e.message)); }, []);
  if (!d) return <Spinner label="Memuat petunjuk…" />;
  const semua = [...(d.rows || []), ...(d.super_rows || [])];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Petunjuk Pengguna</h2>
        <p className="text-[12.5px] text-slate-500">Video dan dokumen panduan penggunaan aplikasi.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {semua.map(p => {
          const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(p.url || ''));
          return (
            <Card key={p.id} title={p.judul} subtitle={p.tipe === 'youtube' ? 'Video YouTube' : p.tipe === 'pdf' ? 'Dokumen PDF' : 'Tautan'}>
              {m ? <iframe title={p.judul} src={`https://www.youtube.com/embed/${m[1]}`} className="aspect-video w-full rounded-xl" allowFullScreen /> :
                <div className="grid h-28 place-items-center rounded-xl bg-slate-50 text-slate-300"><FileText size={30} /></div>}
              {p.deskripsi ? <p className="mt-2 text-[12px] leading-relaxed text-slate-600">{p.deskripsi}</p> : null}
              {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11.5px] font-bold text-orange-600 hover:underline">Buka tautan</a> : null}
            </Card>
          );
        })}
        {!semua.length ? <div className="sm:col-span-2"><Empty title="Belum ada petunjuk" desc="Tim dukungan belum menambahkan panduan." /></div> : null}
      </div>
    </div>
  );
}

/* =====================================================================
   LEGAL & SLA (panel sekolah)
   ===================================================================== */
export function Legal() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('tos');
  useEffect(() => { api('/api/legal').then(setD).catch(e => toast.err(e.message)); }, []);
  if (!d) return <Spinner label="Memuat dokumen legal…" />;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Legal &amp; SLA</h2>
        <p className="text-[12.5px] text-slate-500">Syarat ketentuan layanan dan kesepakatan tingkat layanan yang berlaku untuk sekolah Anda.</p>
      </div>
      <div className="tabs">
        <button className={cx('tab', tab === 'tos' && 'active')} onClick={() => setTab('tos')}>Syarat &amp; Ketentuan</button>
        <button className={cx('tab', tab === 'sla' && 'active')} onClick={() => setTab('sla')}>SLA</button>
      </div>
      <Card title={tab === 'tos' ? d.tos_judul : d.sla_judul} subtitle={d.diperbarui ? `Diperbarui ${tgl(d.diperbarui)}` : ''}>
        <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">{tab === 'tos' ? d.tos_isi : d.sla_isi}</div>
      </Card>
    </div>
  );
}
