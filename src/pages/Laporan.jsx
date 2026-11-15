import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, Clock, Download, FileSpreadsheet, FileText, Filter, Gavel, Mail, MapPin, Printer,
  Search, Send, ShieldAlert, TrendingUp
} from 'lucide-react';
import { api, docUrl, openDoc, tglPendek } from '../api';
import { Alert, Card, Empty, Modal, Spinner, StatusBadge, cx, useToast } from '../ui';

export default function Laporan({ ctx }) {
  const { boot, filters, refreshKey, toast } = ctx;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [master, setMaster] = useState({ kelas: [] });
  const [f, setF] = useState({ kelas: '', status: 'all', q: '' });
  const [paper, setPaper] = useState(boot.settings.print_paper || 'A4');
  const [surat, setSurat] = useState(null);
  const [wa, setWa] = useState(null);
  const [pola, setPola] = useState(null);

  useEffect(() => { api('/api/master').then(m => setMaster({ kelas: m.kelas })).catch(() => {}); }, []);

  const qs = useMemo(() => new URLSearchParams({
    ta: filters.ta || '', kelas: f.kelas || '', status: f.status || 'all', q: f.q || '', paper
  }).toString(), [filters.ta, f.kelas, f.status, f.q, paper]);

  const load = () => {
    setLoading(true);
    api('/api/laporan/rekap?' + qs).then(r => setRows(r.rows)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [qs, refreshKey]);

  useEffect(() => {
    if (!ctx.can('analitik', 'view')) return;
    const p = new URLSearchParams({ ta: filters.ta || '' }).toString();
    api('/api/analitik?' + p).then(r => setPola(r.pola)).catch(() => {});
  }, [filters.ta, refreshKey]);

  async function kirimWA(id) {
    try { setWa(await api('/api/wa/siswa/' + id, { method: 'POST' })); }
    catch (e) { toast.err(e.message); }
  }

  const total = rows.reduce((a, r) => ({
    pel: a.pel + r.pel, pres: a.pres + r.pres,
    kritis: a.kritis + (['Kritis', 'Siaga', 'Waspada'].includes(r.status.label) ? 1 : 0)
  }), { pel: 0, pres: 0, kritis: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Laporan Poin & Surat</h2>
          <p className="text-[12.5px] text-slate-500">Rekapitulasi poin seluruh siswa, ekspor Excel/Word, cetak PDF, dan surat pemanggilan orang tua otomatis.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto !py-1.5 text-[12px]" value={paper} onChange={e => setPaper(e.target.value)}>
            <option value="A4">Kertas A4</option><option value="F4">Kertas F4 / Legal</option>
          </select>
          <button className="btn-ghost" onClick={() => openDoc('/api/export/rekap.doc?' + qs)}><FileText size={15} /> Word</button>
          <button className="btn-ghost" onClick={() => openDoc('/api/export/rekap.xlsx?' + qs)}><FileSpreadsheet size={15} /> Excel</button>
          <button className="btn-primary" onClick={() => openDoc('/api/rekap/print?' + qs)}><Printer size={15} /> Cetak / PDF</button>
        </div>
      </div>

      <Card title="Filter Rekapitulasi" subtitle="Filter berlaku untuk tampilan, cetak, dan ekspor">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Kelas</label>
            <select className="input" value={f.kelas} onChange={e => setF(v => ({ ...v, kelas: e.target.value }))}>
              <option value="">Semua kelas</option>
              {master.kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status Disiplin</label>
            <select className="input" value={f.status} onChange={e => setF(v => ({ ...v, status: e.target.value }))}>
              <option value="all">Semua status</option>
              {(boot.settings.status_rules || []).map(r => <option key={r.label} value={(r.label || '').toLowerCase()}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cari Nama / NISN</label>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" value={f.q} placeholder="nama atau NISN…"
                onChange={e => setF(v => ({ ...v, q: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <button className="btn-soft flex-1" onClick={load}><Filter size={15} /> Terapkan</button>
            <button className="btn-ghost" onClick={() => setF({ kelas: '', status: 'all', q: '' })}>Reset</button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <MiniTotal label="Total Pelanggaran" value={total.pel} tone="rose" />
          <MiniTotal label="Total Prestasi" value={total.pres} tone="violet" />
          <MiniTotal label="Siswa Kritis+" value={total.kritis} tone="amber" />
        </div>
      </Card>

      <Card title="Rekapitulasi Poin Murid" subtitle={`${rows.length} siswa · TP ${((boot.tahun || []).find(t => t.id === Number(filters.ta)) || {}).nama || '-'} `}
        right={<span className="chip"><FileText size={12} /> Kop surat otomatis dari Identitas Sekolah</span>}>
        {loading ? <Spinner /> : rows.length ? (
          <div className="tbl-wrap max-h-[70vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-10 text-center">No</th><th className="w-24">NISN</th><th>Nama Murid</th><th className="w-20">Kelas</th>
                  <th className="w-14 text-center">Pel</th><th className="w-14 text-center">Pres</th><th className="w-16 text-center">Total</th>
                  <th className="w-24">Status</th><th className="w-40">Rekomendasi Sanksi</th><th>Keterangan</th><th className="w-28">Surat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="text-center text-slate-400">{r.no}</td>
                    <td className="whitespace-nowrap text-[12px]">{r.nisn || '-'}</td>
                    <td className="font-semibold text-slate-700">{r.nama}</td>
                    <td className="whitespace-nowrap">{r.kelas_nama || '-'}</td>
                    <td className={cx('text-center font-bold', r.pel > 0 ? 'text-rose-600' : 'text-slate-400')}>{r.pel}</td>
                    <td className={cx('text-center font-semibold', r.pres > 0 ? 'text-violet-600' : 'text-slate-400')}>{r.pres}</td>
                    <td className="text-center font-extrabold">{r.bersih}</td>
                    <td><StatusBadge label={r.status.label} size="sm" /></td>
                    <td className="text-[11.5px]">
                      {r.sanksi ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-orange-700">
                          <Gavel size={11} /> {r.sanksi.label}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="max-w-[280px]">
                      <p className="truncate text-[11.5px] text-slate-500" title={r.keterangan}>{r.keterangan}</p>
                    </td>
                    <td>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => setSurat(r)} title="Buat surat" className="rounded-lg p-1.5 text-orange-600 hover:bg-orange-50"><Mail size={14} /></button>
                        <button onClick={() => kirimWA(r.id)} title="WhatsApp orang tua" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><Send size={14} /></button>
                        <button onClick={() => openDoc(`/api/surat/${r.id}?jenis=panggilan`)} title="Cetak surat panggilan" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Printer size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={FileText} title="Tidak ada data" desc="Ubah filter atau tambahkan data siswa." />}
      </Card>

      {pola ? (
        <Card title="Pola Waktu & Tempat Pelanggaran" subtitle="Ringkasan analitik — detail lengkap di menu Analitik Pola"
          right={ctx.can('analitik', 'view') ? <button className="text-[12px] font-bold text-orange-600" onClick={() => ctx.setPage('analitik')}>Buka analitik</button> : null}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><CalendarDays size={12} /> Hari Rawan</p>
              <p className="text-[15px] font-extrabold text-slate-800">{(pola.hariRawan?.[0] || {}).label || '-'}</p>
              <p className="text-[11px] text-slate-500">{(pola.hariRawan?.[0] || {}).jml || 0} kejadian</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Clock size={12} /> Jam Rawan</p>
              <p className="text-[15px] font-extrabold text-slate-800">{pola.jamRawan?.[0] ? String(pola.jamRawan[0].hour).padStart(2, '0') + ':00' : '-'}</p>
              <p className="text-[11px] text-slate-500">{(pola.jamRawan?.[0] || {}).jml || 0} kejadian</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><MapPin size={12} /> Lokasi Rawan</p>
              <p className="truncate text-[15px] font-extrabold text-slate-800">{(pola.lokasiRawan?.[0] || {}).label || '-'}</p>
              <p className="text-[11px] text-slate-500">{(pola.lokasiRawan?.[0] || {}).jml || 0} kejadian</p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card title="Rekap Bulanan Kelas (Portofolio)"
        subtitle="Kehadiran + catatan pelanggaran/prestasi + ringkasan asesmen BK dalam satu laporan bulanan"
        right={ctx.can('rekap_bulanan', 'view') ? (
          <button className="btn-primary btn-sm" onClick={() => ctx.setPage('rekap_bulanan')} data-ke-rekap-bulanan>
            <FileSpreadsheet size={13} /> Buka Rekap Bulanan
          </button>
        ) : null}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Kehadiran', 'Persentase Hadir / Sakit / Izin / Alfa / Bolos per siswa'],
            ['Catatan Kejadian', 'Rekap poin pelanggaran & prestasi (Input Kejadian)'],
            ['Asesmen BK', 'Ringkasan AKPD, RIASEC, Gaya Belajar, Kesulitan Belajar']
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <p className="text-[12.5px] font-bold text-slate-700">{t}</p>
              <p className="text-[11px] text-slate-500">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-slate-500">
          Tersedia tombol ekspor <b>PDF</b>, <b>Excel</b>, dan <b>Word</b> lengkap dengan kop sekolah serta blok
          tanda tangan Kepala Sekolah dan Wali Kelas / Guru BK — siap dilampirkan pada rapor karakter akhir semester.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Format Cetak & Tanda Tangan" subtitle="Semua dokumen siap kertas A4 / F4">
          <ul className="space-y-2 text-[12.5px] text-slate-600">
            <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" /> Kop surat resmi berisi logo, nama sekolah, alamat, dan kontak (dari menu Identitas Sekolah); baris tambahan serta ukuran font tiap baris diatur di <b>Pengaturan → Kop Surat</b>.</li>
            <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" /> Footer tanda tangan: <b>Mengetahui Kepala Sekolah</b> (kiri) dan <b>Wali Kelas</b> (kanan), lengkap dengan nama &amp; NIP serta tempat-tanggal otomatis.</li>
            <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" /> Tombol <b>Cetak / PDF</b> membuka halaman siap cetak — pilih "Save as PDF" pada dialog cetak untuk menyimpan berkas PDF.</li>
            <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" /> Ekspor <b>Word</b> menghasilkan berkas .doc yang dapat diedit kembali.</li>
          </ul>
        </Card>
        <Card title="Surat Peringatan Otomatis" subtitle="Data siswa & poin terisi otomatis dari sistem">
          <div className="grid gap-2 sm:grid-cols-2">
            {[['panggilan', 'Surat Pemanggilan Orang Tua', 'Panggilan pembinaan pertama'],
            ['sp1', 'Surat Peringatan 1', 'Teguran tertulis pertama'],
            ['sp2', 'Surat Peringatan 2', 'Peringatan serius'],
            ['sp3', 'Surat Peringatan 3', 'Peringatan terakhir']].map(([k, l, d]) => (
              <div key={k} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-[12.5px] font-bold text-slate-700">{l}</p>
                <p className="text-[11px] text-slate-500">{d}</p>
              </div>
            ))}
          </div>
          <Alert tone="info" title="Cara membuat surat">
            Buka ikon <Mail size={12} className="inline" /> pada tabel rekap di atas untuk memilih jenis surat. Nomor surat dibuat
            otomatis dan setiap pencetakan tercatat di Log Aktivitas.
          </Alert>
        </Card>
      </div>

      <Modal open={!!surat} onClose={() => setSurat(null)} title="Buat Surat untuk Orang Tua"
        subtitle={surat ? `${surat.nama} · ${surat.kelas_nama || '-'} · Status ${surat.status.label}` : ''}>
        {surat ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[['Pelanggaran', surat.pel], ['Prestasi', surat.pres], ['Poin Bersih', surat.bersih]].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-center">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                  <p className="text-[17px] font-extrabold text-slate-800">{v}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {[['panggilan', 'Surat Pemanggilan Orang Tua / Wali', 'Memanggil orang tua untuk pembinaan'],
              ['sp1', 'Surat Peringatan Pertama (SP 1)', 'Teguran tertulis pertama'],
              ['sp2', 'Surat Peringatan Kedua (SP 2)', 'Peringatan serius'],
              ['sp3', 'Surat Peringatan Ketiga (SP 3)', 'Peringatan terakhir sebelum tindakan lanjutan']].map(([k, l, d]) => (
                <button key={k} onClick={() => openDoc(`/api/surat/${surat.id}?jenis=${k}&paper=${paper}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-orange-300 hover:bg-orange-50/50">
                  <span>
                    <span className="block text-[12.5px] font-bold text-slate-700">{l}</span>
                    <span className="block text-[11px] text-slate-500">{d}</span>
                  </span>
                  <Printer size={15} className="text-orange-500" />
                </button>
              ))}
            </div>
            <Alert tone="warn" title="Periksa sebelum mencetak">
              Pastikan data pelanggaran siswa sudah benar. Surat memuat rincian kejadian, poin, status disiplin, dan tanda tangan Kepala Sekolah serta Wali Kelas.
            </Alert>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!wa} onClose={() => setWa(null)} title="Peringatan WhatsApp" subtitle={wa ? `Nomor orang tua: ${wa.phone}` : ''}
        footer={wa ? <a className="btn-primary" href={wa.wa_url} target="_blank" rel="noreferrer"><Send size={15} /> Buka WhatsApp</a> : null}>
        {wa ? <div className="whitespace-pre-wrap rounded-xl bg-emerald-50/70 p-3 text-[12.5px] leading-relaxed text-slate-700 ring-1 ring-emerald-100">{wa.pesan}</div> : null}
      </Modal>
    </div>
  );
}

function MiniTotal({ label, value, tone }) {
  const map = { rose: 'text-rose-600', violet: 'text-violet-600', amber: 'text-amber-600' };
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cx('text-[17px] font-extrabold', map[tone])}>{value}</p>
    </div>
  );
}
