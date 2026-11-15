import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, MessageCircle, Phone, RefreshCw, Save, Send, Users
} from 'lucide-react';
import { api, waLink } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/* =====================================================================
   Pengaturan & otomatisasi rekap absensi siswa → WhatsApp Wali Kelas
   Dipakai di menu Pengaturan (tab) dan di halaman Rekap Absensi Siswa.
   ===================================================================== */
export default function RekapAbsensiWA({ ctx, readOnly = false, compact = false }) {
  const { toast } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [hasil, setHasil] = useState(null);
  const [f, setF] = useState({ aktif: false, jam: '15:00', hari: [1, 2, 3, 4, 5], auto_poin: true });
  const [tanggal, setTanggal] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(() => {
    setLoading(true);
    api('/api/rekap-absensi/pengaturan')
      .then(r => {
        setData(r);
        setF({
          aktif: !!(r.config && r.config.aktif),
          jam: (r.config && r.config.jam) || '15:00',
          hari: (r.config && r.config.hari) || [1, 2, 3, 4, 5],
          auto_poin: !!(r.poin && r.poin.aktif)
        });
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const toggleHari = (n) => setF(s => ({
    ...s, hari: s.hari.includes(n) ? s.hari.filter(x => x !== n) : [...s.hari, n].sort((a, b) => a - b)
  }));

  async function simpan() {
    setBusy(true);
    try {
      const r = await api('/api/rekap-absensi/pengaturan', {
        method: 'POST',
        body: { aktif: f.aktif, jam: f.jam, hari: f.hari, auto_poin: f.auto_poin }
      });
      toast.ok(r.pesan || 'Pengaturan tersimpan.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  async function bukaPreview() {
    try {
      const r = await api('/api/rekap-absensi/wa/preview?tanggal=' + tanggal);
      setPreview(r);
      setHasil(null);
    } catch (e) { toast.err(e.message); }
  }

  async function kirim() {
    setSending(true);
    try {
      const r = await api('/api/rekap-absensi/wa/kirim', { method: 'POST', body: { tanggal } });
      setHasil(r);
      toast.ok(r.pesan || 'Rekap diproses.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setSending(false); }
  }

  if (loading) return <Spinner />;
  const cfg = data?.config || {};
  const kelas = data?.kelas || [];
  const tanpaNomor = kelas.filter(k => !k.wali_phone);
  const gateway = cfg.gateway || {};

  return (
    <div className="space-y-4" data-page="pengaturan-rekap-absensi">
      {!compact ? (
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Rekap Absensi &amp; WhatsApp Wali Kelas</h2>
          <p className="text-[12.5px] text-slate-500">
            Atur jam pengiriman otomatis rekap kehadiran harian ke WhatsApp masing-masing Wali Kelas.
          </p>
        </div>
      ) : null}

      <Card title="Jadwal Pengiriman Otomatis"
        subtitle="Rekap dikirim setiap hari kerja pada jam yang ditentukan (zona waktu WIB)."
        right={<span className={cx('badge', f.aktif ? 'badge-aman' : 'badge-netral')}>{f.aktif ? 'Aktif' : 'Nonaktif'}</span>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Status Pengiriman Otomatis">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={f.aktif} disabled={readOnly}
                onChange={e => setF(s => ({ ...s, aktif: e.target.checked }))} data-wa-kelas-aktif />
              <span className="text-[12.5px] font-semibold text-slate-700">{f.aktif ? 'Kirim otomatis' : 'Matikan dulu'}</span>
            </label>
          </Field>
          <Field label="Jam Pengiriman" hint="Bawaan 15:00 setiap hari kerja.">
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-slate-400" />
              <input type="time" className="input" value={f.jam} disabled={readOnly}
                onChange={e => setF(s => ({ ...s, jam: e.target.value }))} data-wa-kelas-jam />
            </div>
          </Field>
          <Field label="Poin otomatis Alpha/Bolos" hint={<>
            Buku Poin: Alpha {data?.poin?.alfa?.poin ?? 5} poin · Bolos {data?.poin?.bolos?.poin ?? 10} poin.
            {ctx.setPage ? <> · <button type="button" className="link" onClick={() => ctx.setPage('kategori')}>Ubah bobot di Kategori Poin</button></> : null}
          </>}>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={f.auto_poin} disabled={readOnly}
                onChange={e => setF(s => ({ ...s, auto_poin: e.target.checked }))} data-absensi-auto-poin />
              <span className="text-[12.5px] font-semibold text-slate-700">
                {f.auto_poin ? 'Aktif — absensi Alpha/Bolos membuat catatan poin' : 'Nonaktif'}
              </span>
            </label>
          </Field>
        </div>
        <div className="mt-3">
          <p className="label">Hari Pengiriman</p>
          <div className="flex flex-wrap gap-1.5">
            {HARI.map((h, i) => (
              <button key={h} type="button" disabled={readOnly} onClick={() => toggleHari(i)}
                className={cx('chip', f.hari.includes(i) && '!border-orange-300 !bg-orange-50 !text-orange-700')}>
                {h}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!readOnly ? (
            <button className="btn-primary btn-sm" onClick={simpan} disabled={busy} data-simpan-wa-rekap>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Pengaturan
            </button>
          ) : null}
          <button className="btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /> Muat Ulang</button>
          <span className="ml-auto text-[11.5px] text-slate-500">
            Status gateway: <b className={gateway.aktif ? 'text-emerald-700' : 'text-rose-700'}>{gateway.aktif ? 'aktif' : 'belum aktif'}</b>
          </span>
        </div>
        {!gateway.aktif ? (
          <div className="mt-3">
            <Alert tone="warn" title="Gateway WhatsApp belum aktif">
              Isi URL &amp; token gateway di <b>Pengaturan → WhatsApp Gateway</b> agar pesan terkirim otomatis.
              Tanpa gateway, sistem menyiapkan tautan <b>wa.me</b> yang dapat Anda kirim manual.
            </Alert>
          </div>
        ) : null}
      </Card>

      <Card title="Pemetaan Nomor WhatsApp Wali Kelas"
        subtitle="Nomor diambil dari data akun Wali Kelas pada masing-masing kelas."
        right={<span className="badge badge-netral">{kelas.length} kelas</span>}>
        {tanpaNomor.length ? (
          <div className="mb-3">
            <Alert tone="warn" title={`${tanpaNomor.length} kelas belum memiliki nomor Wali Kelas`}>
              {tanpaNomor.map(k => k.nama).join(', ')} — perbarui nomor pada menu <b>Akun Pengguna</b> (akun Wali Kelas)
              atau tunjuk Wali Kelas pada menu <b>Data Kelas</b>.
            </Alert>
          </div>
        ) : null}
        {!kelas.length ? <Empty icon={Users} title="Belum ada kelas" desc="Tambahkan kelas pada menu Data Kelas." /> : (
          <div className="tbl-wrap" style={{ maxHeight: '46vh' }}>
            <table className="tbl" data-tbl="wali-kelas">
              <thead><tr><th>No</th><th>Kelas</th><th>Wali Kelas</th><th>Nomor WhatsApp</th><th className="c">Siswa Aktif</th><th className="c">Status</th></tr></thead>
              <tbody>
                {kelas.map((k, i) => (
                  <tr key={k.id}>
                    <td className="c">{i + 1}</td>
                    <td className="font-semibold">{k.nama}</td>
                    <td>{k.wali_nama || <span className="text-rose-600">belum ditunjuk</span>}</td>
                    <td>{k.wali_phone ? k.wali_phone : <span className="text-rose-600">belum diisi</span>}</td>
                    <td className="c">{k.jumlah_siswa || 0}</td>
                    <td className="c">
                      {k.wali_phone
                        ? <span className="badge badge-aman">Siap</span>
                        : <span className="badge badge-siaga">Perlu nomor</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Kirim Rekap Hari Ini"
        subtitle="Pratinjau pesan per kelas sebelum dikirim (atau siapkan tautan wa.me).">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Tanggal Rekap">
            <input type="date" className="input !w-auto" value={tanggal} onChange={e => setTanggal(e.target.value)} data-wa-tanggal />
          </Field>
          <button className="btn-soft btn-sm" onClick={bukaPreview} data-wa-preview><MessageCircle size={13} /> Pratinjau Pesan</button>
          <button className="btn-primary btn-sm" onClick={kirim} disabled={sending} data-wa-kirim>
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Kirim Sekarang
          </button>
        </div>
        {hasil ? (
          <div className="mt-3 space-y-2">
            <Alert tone={hasil.terkirim ? 'ok' : 'info'}>
              {hasil.pesan || `Rekap diproses untuk ${hasil.total || 0} kelas.`}
            </Alert>
            {hasil.tautan && hasil.tautan.length ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <p className="mb-1 text-[11.5px] font-bold text-slate-600">Tautan WhatsApp (klik untuk mengirim manual):</p>
                <div className="flex flex-wrap gap-1.5">
                  {hasil.tautan.map(t => (
                    <a key={t.kelas} className="chip hover:!border-emerald-300" href={t.url} target="_blank" rel="noreferrer">
                      <Phone size={11} /> {t.kelas}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Modal open={!!preview} onClose={() => setPreview(null)} size="lg"
        title="Pratinjau Rekap Absensi per Kelas" subtitle={preview?.tanggal_label || ''}
        footer={<button className="btn-ghost" onClick={() => setPreview(null)}>Tutup</button>}>
        {preview ? (
          !preview.rows || !preview.rows.length ? <Empty icon={Users} title="Tidak ada kelas" /> : (
            <div className="space-y-3" data-preview-rekap>
              <p className="text-[12px] text-slate-500">
                {preview.jumlah_kelas} kelas · {preview.tanpa_nomor} kelas tanpa nomor WhatsApp ·
                gateway {preview.gateway_aktif ? 'aktif' : 'belum aktif'}
              </p>
              {preview.rows.map(r => (
                <div key={r.kelas_id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[13px] text-slate-800">{r.kelas}</b>
                    <span className="chip">{r.wali_nama || 'wali belum ditunjuk'}</span>
                    <span className={cx('chip', r.phone ? '' : '!border-rose-200 !text-rose-700')}>{r.phone || 'nomor belum diisi'}</span>
                    <span className="ml-auto text-[11px] text-slate-400">{r.jumlah} catatan presensi</span>
                  </div>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-700">{r.pesan}</pre>
                  {r.phone ? (
                    <a className="btn-ghost btn-sm mt-2" href={waLink(r.phone, r.pesan)} target="_blank" rel="noreferrer">
                      <Phone size={12} /> Buka WhatsApp
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </Modal>
    </div>
  );
}
