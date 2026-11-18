import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, ChevronRight, FileText, HelpCircle, LifeBuoy, Loader2, MessageCircle, Play, Send, Smartphone,
  StickyNote, Youtube
} from 'lucide-react';
import { api, tgl, waktu, angka } from '../../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../../ui';
import { Badge, statusTone } from './ui-saas';

/* =====================================================================
   10. PUSAT TIKET (SUPER ADMIN)
   ===================================================================== */
export function SuperTiket({ ctx }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({});
  const [status, setStatus] = useState('semua');
  const [detail, setDetail] = useState(null);
  const [balas, setBalas] = useState('');
  const [kirimWa, setKirimWa] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api('/api/super/tiket?status=' + status);
    setRows(r.rows); setMeta({ status_list: r.status_list, kategori: r.kategori });
  }, [status]);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);

  async function buka(id) {
    try { const r = await api('/api/super/tiket/' + id); setDetail(r.tiket); setBalas(''); }
    catch (e) { toast.err(e.message); }
  }
  async function kirim() {
    setBusy(true);
    try {
      const r = await api('/api/super/tiket/balas', { method: 'POST', body: { id: detail.id, pesan: balas, kirim_wa: kirimWa } });
      toast.ok(r.pesan);
      setDetail(r.tiket); setBalas(''); load(); ctx.reload();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  if (!rows) return <Spinner label="Memuat tiket…" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Pusat Tiket Kendala</h2>
        <p className="text-[12.5px] text-slate-500">Kanal bantuan dua arah: sekolah mengirim kendala, Super Admin membalas — balasan juga dikirim via WhatsApp.</p>
      </div>
      <div className="tabs">
        {[['semua', 'Semua'], ['baru', 'Baru'], ['diproses', 'Diproses'], ['selesai', 'Selesai'], ['ditutup', 'Ditutup']].map(([k, l]) => (
          <button key={k} className={cx('tab', status === k && 'active')} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>#</th><th>Judul</th><th>Sekolah</th><th>Kategori</th><th>Pesan</th><th>Status</th><th className="text-right">Aksi</th></tr></thead>
            <tbody>
              {rows.map(k => (
                <tr key={k.id}>
                  <td className="font-mono text-[11.5px] text-slate-400">{k.id}</td>
                  <td className="font-semibold text-slate-800">{k.judul}</td>
                  <td className="text-[12px]">{k.sekolah}<p className="text-[11px] text-slate-400">{k.kode}</p></td>
                  <td><Badge tone="netral">{k.kategori}</Badge></td>
                  <td className="text-center text-[12px]">{k.jumlah_pesan}</td>
                  <td><Badge tone={statusTone(k.status)}>{k.status}</Badge></td>
                  <td className="text-right"><button className="btn-ghost btn-sm" onClick={() => buka(k.id)}><ChevronRight size={13} /> Buka</button></td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={7}><Empty title="Tidak ada tiket" desc="Belum ada kendala yang dilaporkan sekolah." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `#${detail.id} ${detail.judul}` : ''}
        subtitle={detail ? `${detail.sekolah} · ${detail.kategori} · ${detail.status}` : ''} size="lg">
        {detail ? (
          <div className="space-y-3">
            <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-2.5">
              {detail.pesan.map(m => (
                <div key={m.id} className={cx('rounded-xl p-2.5 text-[12.5px]', m.dari === 'super' ? 'ml-6 bg-teal-50 ring-1 ring-teal-100' : 'mr-6 bg-white ring-1 ring-slate-200')}>
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                    {m.dari === 'super' ? 'Super Admin' : 'Sekolah'} · {m.oleh} · {waktu(m.created_at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{m.pesan}</p>
                </div>
              ))}
              {!detail.pesan.length ? <p className="text-[12.5px] text-slate-400">Belum ada pesan.</p> : null}
            </div>
            <Field label="Balasan">
              <textarea className="input min-h-[90px]" value={balas} onChange={e => setBalas(e.target.value)} placeholder="Tulis balasan untuk sekolah…" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={kirimWa} onChange={e => setKirimWa(e.target.checked)} />
                Kirim juga via WhatsApp
              </label>
              <div className="ml-auto flex gap-2">
                <button className="btn-ghost" onClick={async () => {
                  await api('/api/super/tiket/balas', { method: 'POST', body: { id: detail.id, pesan: '', status: 'selesai' } });
                  toast.ok('Tiket ditandai selesai.'); buka(detail.id); load(); ctx.reload();
                }}>Tandai Selesai</button>
                <button className="btn-primary" disabled={!balas || busy} onClick={kirim}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Kirim Balasan
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* =====================================================================
   11. PETUNJUK PENGGUNA (PANDUAN)
   ===================================================================== */
export function SuperPanduan({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/super/panduan').then(setData).catch(e => toast.err(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Spinner label="Memuat petunjuk…" />;

  async function simpan(body) {
    setBusy(true);
    try {
      const r = await api('/api/super/panduan', { method: 'POST', body });
      toast.ok(r.pesan); setEdit(null); load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  const yid = url => {
    const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(url || ''));
    return m ? m[1] : '';
  };
  const List = ({ rows, untuk }) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map(p => (
        <div key={p.id} className="overflow-hidden rounded-xl border border-slate-100">
          {p.tipe === 'youtube' && yid(p.url) ? (
            <iframe title={p.judul} src={`https://www.youtube.com/embed/${yid(p.url)}`} className="aspect-video w-full" allowFullScreen />
          ) : (
            <div className="flex h-24 items-center justify-center bg-slate-50 text-slate-300">
              {p.tipe === 'pdf' ? <FileText size={28} /> : p.tipe === 'tautan' ? <Play size={28} /> : <StickyNote size={28} />}
            </div>
          )}
          <div className="p-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[13px] font-bold text-slate-800">{p.judul}</p>
              <Badge tone={p.aktif ? 'aman' : 'netral'}>{p.aktif ? 'Aktif' : 'Draft'}</Badge>
            </div>
            {p.deskripsi ? <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{p.deskripsi}</p> : null}
            {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 inline-block truncate text-[11.5px] font-semibold text-orange-600 hover:underline">{p.url}</a> : null}
            <div className="mt-2 flex gap-1.5">
              <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...p })}>Edit</button>
              <button className="btn-danger btn-sm" onClick={() => { if (confirm('Hapus petunjuk ini?')) simpan({ hapus: p.id }); }}>Hapus</button>
            </div>
          </div>
        </div>
      ))}
      {!rows.length ? <div className="sm:col-span-2"><Empty title="Belum ada petunjuk" desc="Tambahkan tautan video YouTube atau dokumen PDF panduan penggunaan." /></div> : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Petunjuk Pengguna</h2>
          <p className="text-[12.5px] text-slate-500">Panduan berupa video YouTube atau dokumen PDF — tersedia di panel Super Admin & panel sekolah.</p>
        </div>
        <button className="btn-primary" onClick={() => setEdit({ untuk: 'sekolah', judul: '', tipe: 'youtube', url: '', deskripsi: '', urutan: 1, aktif: 1 })}>
          <Play size={15} /> Tambah Petunjuk
        </button>
      </div>
      <Card title="Petunjuk untuk Sekolah" subtitle="Tampil pada menu Petunjuk Pengguna di akun sekolah"><List rows={data.sekolah} untuk="sekolah" /></Card>
      <Card title="Petunjuk untuk Super Admin" subtitle="Panduan internal pengelolaan platform"><List rows={data.super_rows} untuk="super" /></Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Petunjuk Pengguna" size="md">
        {edit ? (
          <form id="fPanduan" className="space-y-3" onSubmit={e => { e.preventDefault(); simpan(edit); }}>
            <Field label="Judul" required><input className="input" required value={edit.judul} onChange={e => setEdit(v => ({ ...v, judul: e.target.value }))} /></Field>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Untuk">
                <select className="input" value={edit.untuk} onChange={e => setEdit(v => ({ ...v, untuk: e.target.value }))}>
                  <option value="sekolah">Akun Sekolah</option>
                  <option value="super">Super Admin</option>
                </select>
              </Field>
              <Field label="Jenis">
                <select className="input" value={edit.tipe} onChange={e => setEdit(v => ({ ...v, tipe: e.target.value }))}>
                  <option value="youtube">Video YouTube</option>
                  <option value="pdf">Dokumen PDF</option>
                  <option value="tautan">Tautan umum</option>
                  <option value="teks">Catatan teks</option>
                </select>
              </Field>
            </div>
            <Field label="URL / Tautan" hint="Contoh: https://youtu.be/xxxx atau https://…/panduan.pdf">
              <input className="input" value={edit.url || ''} onChange={e => setEdit(v => ({ ...v, url: e.target.value }))} />
            </Field>
            <Field label="Deskripsi singkat"><textarea className="input min-h-[80px]" value={edit.deskripsi || ''} onChange={e => setEdit(v => ({ ...v, deskripsi: e.target.value }))} /></Field>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Urutan"><input className="input" inputMode="numeric" value={edit.urutan} onChange={e => setEdit(v => ({ ...v, urutan: e.target.value }))} /></Field>
              <label className="flex items-end gap-2 pb-2 text-[12.5px] font-semibold text-slate-700">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!Number(edit.aktif ?? 1)} onChange={e => setEdit(v => ({ ...v, aktif: e.target.checked ? 1 : 0 }))} /> Tampilkan
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Batal</button>
              <button className="btn-primary" type="submit" disabled={busy}><Play size={15} /> Simpan</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

/* =====================================================================
   12. AUDIT LOGS
   ===================================================================== */
export function SuperAudit() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [modul, setModul] = useState('');
  const load = useCallback(async () => {
    const r = await api('/api/super/audit?q=' + encodeURIComponent(q) + '&modul=' + encodeURIComponent(modul) + '&limit=400');
    setData(r);
  }, [q, modul]);
  useEffect(() => { const t = setTimeout(() => { load().catch(e => toast.err(e.message)); }, 300); return () => clearTimeout(t); }, [load]);
  if (!data) return <Spinner label="Memuat audit log…" />;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Audit Logs Platform</h2>
        <p className="text-[12.5px] text-slate-500">Seluruh aktivitas Super Admin tercatat: perubahan sekolah, verifikasi pembayaran, pengaturan, dan query database.</p>
      </div>
      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <input className="input flex-1 min-w-[200px]" placeholder="Cari aksi, detail, pelaku…" value={q} onChange={e => setQ(e.target.value)} />
          <select className="input max-w-[190px]" value={modul} onChange={e => setModul(e.target.value)}>
            <option value="">Semua modul</option>
            {data.modul.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="max-h-[65vh] overflow-auto">
          <table className="tbl">
            <thead><tr><th>Waktu</th><th>Pelaku</th><th>Modul</th><th>Aksi</th><th>Detail</th><th>IP</th></tr></thead>
            <tbody>
              {data.rows.map(a => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-[11.5px] text-slate-500">{waktu(a.created_at)}</td>
                  <td className="text-[12px] font-semibold text-slate-700">{a.oleh}</td>
                  <td><Badge tone="netral">{a.modul}</Badge></td>
                  <td className="text-[12px] font-semibold">{a.aksi}</td>
                  <td className="max-w-[360px] truncate text-[11.5px] text-slate-600" title={a.detail}>{a.detail}</td>
                  <td className="text-[11px] text-slate-400">{a.ip || '-'}</td>
                </tr>
              ))}
              {!data.rows.length ? <tr><td colSpan={6} className="text-slate-400">Belum ada aktivitas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* =====================================================================
   13. WHATSAPP GATEWAY
   ===================================================================== */
export function SuperWa({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState({});
  const [uji, setUji] = useState({ telp: '', pesan: '' });
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const r = await api('/api/super/wa');
    setData(r);
    setF({
      wa_aktif: !!r.cfg.aktif, wa_api_url: r.cfg.url || '', wa_api_token: r.cfg.token || '',
      wa_payload: r.cfg.payload || ''
    });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!data) return <Spinner label="Memuat gateway WhatsApp…" />;
  const fonnte = /fonnte\.(com|co\.id|id)/i.test(String(f.wa_api_url || ''));

  async function simpan() {
    setBusy('simpan');
    try { const r = await api('/api/super/wa', { method: 'POST', body: f }); toast.ok(r.pesan); load(); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function kirimUji() {
    setBusy('uji');
    try { const r = await api('/api/super/wa/uji', { method: 'POST', body: uji }); toast.ok(r.pesan); load(); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <Card title="Gateway WhatsApp" subtitle="Dipakai untuk notifikasi tagihan, jatuh tempo, dan pemberitahuan sistem ke sekolah">
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[12.5px] font-bold text-emerald-800">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!f.wa_aktif} onChange={e => setF(v => ({ ...v, wa_aktif: e.target.checked }))} />
              Aktifkan pengiriman WhatsApp otomatis
            </label>
            <Field label="URL API Gateway" hint={fonnte
              ? 'Fonnte memakai format khusus dan dideteksi otomatis dari URL.'
              : 'Endpoint pengiriman pesan (POST JSON) dari penyedia WA Anda.'}>
              <input className="input" value={f.wa_api_url} onChange={e => setF(v => ({ ...v, wa_api_url: e.target.value }))} placeholder="https://api.penyedia-wa.com/send" />
            </Field>
            <Field label="Token / API Key" hint={fonnte
              ? 'Token Fonnte dikirim apa adanya di header Authorization (tanpa awalan Bearer).'
              : 'Dikirim sebagai header Authorization: Bearer …; awalan Bearer yang sudah dimasukkan akan dirapikan.'}>
              <input className="input" type="password" value={f.wa_api_token} onChange={e => setF(v => ({ ...v, wa_api_token: e.target.value }))} />
            </Field>
            {fonnte
              ? <Alert tone="info" title="Format Fonnte terdeteksi">
                Pengiriman menggunakan form-urlencoded dengan kolom target dan message.
              </Alert>
              : <Field label="Format Payload JSON" hint="Gunakan {phone} dan {pesan} sebagai variabel">
                <textarea className="input min-h-[90px] font-mono text-[12px]" value={f.wa_payload} onChange={e => setF(v => ({ ...v, wa_payload: e.target.value }))} />
              </Field>}
            <button className="btn-primary w-full py-2.5" disabled={busy === 'simpan'} onClick={simpan}>
              {busy === 'simpan' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Simpan Konfigurasi
            </button>
          </div>
        </Card>

        <Card title="Uji Kirim" subtitle="Pastikan gateway benar-benar terhubung">
          <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
            <input className="input" placeholder="0812xxxxxxx" value={uji.telp} onChange={e => setUji(v => ({ ...v, telp: e.target.value }))} />
            <input className="input" placeholder="Isi pesan uji" value={uji.pesan} onChange={e => setUji(v => ({ ...v, pesan: e.target.value }))} />
            <button className="btn-ghost" disabled={busy === 'uji' || !uji.telp} onClick={kirimUji}>
              {busy === 'uji' ? <Loader2 size={15} className="animate-spin" /> : <Smartphone size={15} />} Kirim Uji
            </button>
          </div>
          <Alert tone="warn" title="Status gateway">
            {data.cfg.aktif ? 'Gateway aktif — notifikasi tagihan & suspend otomatis akan dikirim ke nomor sekolah.'
              : 'Gateway belum aktif. Notifikasi hanya dicatat pada log (status "antre").'}
          </Alert>
        </Card>

        <Card title="Template Pesan Otomatis" subtitle="Variabel: {sekolah} {tanggal} {nominal} {kode}">
          <div className="space-y-2 text-[12px]">
            {Object.entries(data.template).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 p-2.5">
                <p className="font-bold uppercase tracking-wide text-slate-500">{k}</p>
                <p className="mt-0.5 text-slate-700">{v}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Log Pengiriman" subtitle="300 pengiriman terakhir" bodyClass="p-0">
        <div className="max-h-[70vh] overflow-auto divide-y divide-slate-100">
          {data.log.map(l => (
            <div key={l.id} className="p-2.5">
              <div className="flex items-center gap-2">
                <Badge tone={l.status === 'terkirim' ? 'aman' : l.status === 'gagal' ? 'siaga' : 'pantau'}>{l.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">{l.sekolah || l.tujuan || '-'}</span>
                <span className="text-[10.5px] text-slate-400">{waktu(l.created_at)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-500">{l.pesan}</p>
              {l.error ? <p className="text-[11px] text-rose-500">{l.error}</p> : null}
            </div>
          ))}
          {!data.log.length ? <div className="p-4"><Empty title="Belum ada pengiriman" /></div> : null}
        </div>
      </Card>
    </div>
  );
}
