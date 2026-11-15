import React, { useEffect, useState } from 'react';
import { Activity, MessageCircle, Send, ShieldAlert, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { api, tglPendek } from '../api';
import { Alert, Card, Empty, Modal, Spinner, StatusBadge, cx, useToast } from '../ui';

export default function Deteksi({ ctx }) {
  const { filters, refreshKey, boot, setPage } = ctx;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wa, setWa] = useState(null);

  useEffect(() => {
    setLoading(true);
    api(`/api/deteksi?ta=${filters.ta || ''}`)
      .then(setData).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [filters.ta, refreshKey]);

  async function kirimWA(id) {
    try { setWa(await api('/api/wa/siswa/' + id, { method: 'POST' })); }
    catch (e) { toast.err(e.message); }
  }

  if (loading && !data) return <Spinner label="Menganalisis peringatan dini…" />;
  const dini = data?.dini || boot.settings.dini;
  const list = data?.list || [];
  const siaga = list.filter(s => s.level === 'siaga');
  const waspada = list.filter(s => s.level === 'waspada');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Deteksi Dini Kedisiplinan</h2>
        <p className="text-[12.5px] text-slate-500">
          Sistem memantau akumulasi poin pelanggaran <b>{dini.hari} hari terakhir</b> dan memberi peringatan otomatis:
          <span className="mx-1 badge badge-siaga">SIAGA ≥ {dini.siaga} poin</span>
          <span className="badge badge-waspada">WASPADA ≥ {dini.waspada} poin</span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white"><ShieldAlert size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status SIAGA</p><p className="text-[19px] font-extrabold text-slate-800">{siaga.length} siswa</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-red-600 to-rose-500 text-white"><TriangleAlert size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status WASPADA</p><p className="text-[19px] font-extrabold text-slate-800">{waspada.length} siswa</p></div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white"><ShieldCheck size={18} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total Peringatan</p><p className="text-[19px] font-extrabold text-slate-800">{list.length}</p></div>
        </div>
      </div>

      <Alert tone="info" title="Bagaimana peringatan dihitung?">
        Setiap kejadian pelanggaran pada {dini.hari} hari terakhir dijumlahkan per siswa. Bila totalnya melewati ambang
        {dini.siaga} poin maka muncul sinyal <b>SIAGA</b>, dan bila melewati {dini.waspada} poin menjadi <b>WASPADA</b>.
        Ambang dan rentang hari dapat diubah pada menu Pengaturan → Deteksi Dini.
      </Alert>

      <Card title="Siswa dengan Peringatan Dini" subtitle="Diurutkan dari poin 14 hari terbesar · klik baris untuk membuka Kartu Siswa">
        {list.length ? (
          <div className="tbl-wrap max-h-[54vh]">
            <table className="tbl">
              <thead><tr><th>Nama</th><th>Kelas</th><th className="text-center">Poin 14 Hari</th><th className="text-center">Kejadian</th><th>Terakhir</th><th className="text-center">Status Disiplin</th><th>Peringatan</th><th className="w-16">Aksi</th></tr></thead>
              <tbody>
                {list.map(s => (
                  <tr key={s.id} className="cursor-pointer transition hover:bg-orange-50/70"
                    onClick={() => ctx.openSiswaCard && ctx.openSiswaCard(s.id)}
                    title="Buka Kartu Siswa">
                    <td className="font-semibold text-slate-700">{s.nama}</td>
                    <td className="whitespace-nowrap">{s.kelas_nama || '-'}</td>
                    <td className="text-center font-extrabold text-rose-600">{s.poin14}</td>
                    <td className="text-center">{s.jml14}×</td>
                    <td className="whitespace-nowrap text-[12px]">{tglPendek(s.terakhir)}</td>
                    <td className="text-center"><StatusBadge label={s.status.label} size="sm" /></td>
                    <td>
                      <span className={cx('badge', s.level === 'waspada' ? 'badge-waspada' : 'badge-siaga')}>
                        <ShieldAlert size={11} /> {s.level === 'waspada' ? 'WASPADA' : 'SIAGA'}
                      </span>
                    </td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); kirimWA(s.id); }} title="Kirim WhatsApp" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><MessageCircle size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={ShieldCheck} title="Tidak ada peringatan dini" desc="Tidak ada siswa yang menembus ambang Siaga/Waspada pada periode ini." />}
      </Card>

      <Card title="Riwayat Pelanggaran 14 Hari Terakhir" subtitle={`${(data?.riwayat || []).length} kejadian terakhir`}>
        {data?.riwayat?.length ? (
          <div className="tbl-wrap max-h-[44vh]">
            <table className="tbl">
              <thead><tr><th className="w-24">Tanggal</th><th>Kategori</th><th className="text-center">Poin</th><th className="w-40">Siswa</th><th>Kronologi</th></tr></thead>
              <tbody>
                {data.riwayat.map(r => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-[12px]">{tglPendek(r.tanggal)}</td>
                    <td className="font-medium text-slate-700">{r.kategori_nama || r.judul}</td>
                    <td className="text-center font-bold text-rose-600">{r.poin}</td>
                    <td className="whitespace-nowrap text-[12px]">{r.siswa_nama}<span className="block text-[10.5px] text-slate-400">{r.kelas_nama}</span></td>
                    <td className="max-w-[320px]"><p className="truncate text-[11.5px] text-slate-500" title={r.keterangan}>{r.keterangan || '-'}</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Activity} title="Belum ada pelanggaran" desc="Tidak ada catatan pelanggaran dalam periode deteksi." />}
      </Card>

      <Modal open={!!wa} onClose={() => setWa(null)} title="Peringatan WhatsApp" subtitle={wa ? `Nomor: ${wa.phone}` : ''}
        footer={wa ? <a className="btn-primary" href={wa.wa_url} target="_blank" rel="noreferrer"><Send size={15} /> Buka WhatsApp</a> : null}>
        {wa ? <div className="whitespace-pre-wrap rounded-xl bg-emerald-50/70 p-3 text-[12.5px] leading-relaxed text-slate-700 ring-1 ring-emerald-100">{wa.pesan}</div> : null}
      </Modal>
    </div>
  );
}
