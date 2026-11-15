import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CloudDownload, Database, FileArchive, FileJson, Loader2, RefreshCw, RotateCcw, ShieldAlert,
  Upload, ListChecks, FileSpreadsheet, Images
} from 'lucide-react';
import { api, docUrl } from '../api';
import { Alert, Card, Field, Spinner, cx, useToast } from '../ui';

/* ================= Backup & Restore JSON ================= */
export function BackupRestore({ ctx, readOnly }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState(null);
  const [konfirmasi, setKonfirmasi] = useState('');
  const inputRef = useRef(null);

  const load = () => api('/api/backup/info').then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);

  async function restore() {
    if (!file) return toast.err('Pilih berkas backup (.zip atau .json) terlebih dahulu.');
    if (konfirmasi.trim().toUpperCase() !== 'PULIHKAN') {
      return toast.err('Ketik kata PULIHKAN pada kolom konfirmasi untuk melanjutkan.');
    }
    setRestoring(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const r = await api('/api/backup/restore', { method: 'POST', body: { base64 } });
      toast.ok(r.pesan || 'Database dipulihkan.');
      setTimeout(() => window.location.reload(), 1400);
    } catch (e) {
      toast.err(e.message);
    } finally { setRestoring(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Backup Data (Unduh .json)" subtitle="Seluruh database aplikasi dalam satu berkas">
        {info ? (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[['Siswa', info.jumlah.siswa], ['Kejadian', info.jumlah.kejadian], ['Kelas', info.jumlah.kelas],
            ['Pengguna', info.jumlah.users], ['Tindak Lanjut', info.jumlah.tindak_lanjut], ['Total Baris', info.total]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-slate-100 bg-slate-50/60 px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{l}</p>
                <p className="text-[16px] font-extrabold text-slate-800">{v}</p>
              </div>
            ))}
          </div>
        ) : <Spinner label="Menghitung isi database…" />}
        <a className={cx('btn-primary w-full py-2.5', readOnly && 'pointer-events-none opacity-60')}
          href={docUrl('/api/backup/json')} download onClick={() => setTimeout(load, 1500)}>
          <CloudDownload size={16} /> Unduh Backup (.json)
        </a>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
          Berkas berisi seluruh tabel (siswa, kelas, kategori, kejadian, pembinaan, jurnal, pengaturan, akun, audit).
          Simpan berkas ini di tempat aman — ukuran ± {info ? info.ukuran_kb : 0} KB.
        </p>
      </Card>

      <Card title="Ekspor Lengkap (.zip)" subtitle="Satu berkas arsip: database + CSV tiap tabel + daftar berkas">
        <div className="mb-3 space-y-2 rounded-xl bg-slate-50/70 p-3 text-[12px] text-slate-600">
          <p className="flex items-center gap-2"><Database size={14} className="text-orange-500" /> <b>database.json</b> — dipakai untuk memulihkan data</p>
          <p className="flex items-center gap-2"><FileSpreadsheet size={14} className="text-emerald-600" /> <b>data/*.csv</b> — salinan tiap tabel, dapat dibuka di Excel</p>
          <p className="flex items-center gap-2"><Images size={14} className="text-sky-600" /> <b>media.json</b> — daftar berkas foto &amp; URL penyimpanannya</p>
          <p className="flex items-center gap-2"><FileJson size={14} className="text-slate-500" /> <b>README.txt</b> — petunjuk pemulihan</p>
        </div>
        <a className={cx('btn-primary w-full py-2.5', readOnly && 'pointer-events-none opacity-60')}
          href={docUrl('/api/backup/zip')} download onClick={() => setTimeout(load, 1500)}>
          <FileArchive size={16} /> Ekspor Database Sekarang (.zip)
        </a>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
          Praktis &amp; aman: arsip dibuat di server (tanpa menyentuh berkas sistem) dan hanya dapat diunduh oleh akun
          dengan izin Pengaturan. Membutuhkan izin <b>Lihat</b> pada modul Pengaturan.
        </p>
      </Card>

      <Card title="Restore Data (Unggah .zip / .json)" subtitle="Mengembalikan seluruh data dari berkas backup">
        <Alert tone="danger" title="Tindakan berisiko">
          Restore akan <b>mengganti seluruh data</b> aplikasi dengan isi berkas backup. Sistem otomatis membuat snapshot
          data saat ini lebih dulu, tetapi tetap periksa berkas yang Anda unggah.
        </Alert>
        <div className="mt-3 space-y-3">
          <Field label="Berkas backup" hint="Berkas .zip hasil “Ekspor Database” atau .json hasil tombol “Unduh Backup”.">
            <input ref={inputRef} type="file" accept=".zip,.json,application/zip,application/json" disabled={readOnly}
              className="input cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-orange-700"
              onChange={e => setFile(e.target.files?.[0] || null)} />
          </Field>
          <Field label="Ketik PULIHKAN untuk konfirmasi" required>
            <input className="input" value={konfirmasi} disabled={readOnly} placeholder="PULIHKAN"
              onChange={e => setKonfirmasi(e.target.value)} />
          </Field>
          <button className="btn-danger w-full py-2.5" disabled={readOnly || restoring || !file} onClick={restore}>
            {restoring ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Pulihkan Database Sekarang
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ================= Reset Data Tahun Ajaran ================= */
export function ResetTahun({ ctx }) {
  const { boot } = ctx;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [taId, setTaId] = useState('');
  const [scope, setScope] = useState(['kejadian']);
  const [konfirmasi, setKonfirmasi] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = boot.user?.role === 'admin';

  const load = (id) => {
    api('/api/reset-ta/preview?ta=' + (id || '')).then(r => {
      setData(r); if (!id) setTaId(String(r.ta_id || ''));
    }).catch(e => toast.err(e.message));
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);
  useEffect(() => { if (taId && isAdmin) load(taId); }, [taId]);

  if (!isAdmin) {
    return <Alert tone="danger" title="Akses ditolak">Reset data tahun ajaran hanya dapat dilakukan Administrator.</Alert>;
  }
  if (!data) return <Spinner label="Memuat pratinjau data…" />;

  const toggle = key => setScope(s => s.includes(key) ? s.filter(x => x !== key) : [...s, key]);
  const jumlah = data.jumlah || {};

  async function jalankan() {
    if (!scope.length) return toast.err('Pilih minimal satu bagian data.');
    if (konfirmasi.trim().toUpperCase() !== 'RESET') return toast.err('Ketik kata RESET untuk konfirmasi.');
    if (!window.confirm(`Reset data tahun pelajaran ${data.ta ? data.ta.nama : ''}? Snapshot otomatis dibuat sebelum penghapusan.`)) return;
    setBusy(true);
    try {
      const r = await api('/api/reset-ta', { method: 'POST', body: { ta_id: taId, scope, konfirmasi } });
      toast.ok(r.pesan);
      setKonfirmasi('');
      load(taId);
      ctx.bump();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Pilih Tahun Pelajaran" subtitle="Hanya data milik tahun pelajaran terpilih yang dihapus">
        <Field label="Tahun pelajaran">
          <select className="input" value={taId} onChange={e => setTaId(e.target.value)}>
            {(data.tahun || []).map(t => <option key={t.id} value={t.id}>{t.nama}{t.aktif ? ' (aktif)' : ''}</option>)}
          </select>
        </Field>
        <div className="mt-3 space-y-2">
          {data.scope.map(s => {
            const n = jumlah[s.key] ?? 0;
            return (
              <label key={s.key} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={scope.includes(s.key)} onChange={() => toggle(s.key)} />
                <span className="flex-1">
                  <span className="block text-[12.5px] font-semibold text-slate-700">{s.label}</span>
                  <span className="block text-[11px] text-slate-500">{n} baris akan dihapus</span>
                </span>
                <span className={cx('badge', n ? 'badge-perhatian' : 'badge-netral')}>{n}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
          Data siswa, kelas, kategori poin, dan akun <b>tidak</b> dihapus. Snapshot otomatis disimpan (maksimal 3 berkas terakhir) di folder <code>data/snapshots</code>.
        </p>
      </Card>

      <Card title="Konfirmasi Reset" subtitle="Prosedur keamanan agar tidak salah hapus">
        <Alert tone="danger" title="Data yang dihapus tidak masuk Kotak Sampah">
          Reset tahun ajaran menghapus permanen data terpilih. Pastikan Anda sudah mengunduh backup pada tab
          <b> Backup &amp; Restore</b> sebelum melanjutkan.
        </Alert>
        <div className="mt-3 space-y-3">
          <Field label="Ketik RESET untuk konfirmasi" required>
            <input className="input" value={konfirmasi} placeholder="RESET" onChange={e => setKonfirmasi(e.target.value)} />
          </Field>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-[12px] text-slate-600">
            Akan direset pada <b>{data.ta ? data.ta.nama : '-'}</b>: {scope.length ? scope.join(', ') : '— belum ada bagian dipilih —'}
          </div>
          <button className="btn-danger w-full py-2.5" disabled={busy || !scope.length} onClick={jalankan}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />} Reset Data Tahun Pelajaran
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ================= tautan ke halaman audit data (tersembunyi) ================= */
export function TautanAuditData({ ctx }) {
  const isAdmin = ctx.boot.user?.role === 'admin';
  return (
    <Card title="Audit Data Tersembunyi" subtitle="Halaman khusus Administrator — tidak tampil pada navigasi biasa">
      <p className="text-[12.5px] leading-relaxed text-slate-600">
        Memeriksa sisa data sistem yang tidak terikat (riwayat kejadian tanpa siswa, siswa tanpa kelas, catatan
        pembinaan yatim, dan sejenisnya) lalu membersihkannya secara tuntas dengan ceklis &amp; tombol hapus.
      </p>
      {isAdmin ? (
        <button className="btn-ghost mt-3" onClick={() => ctx.setPage('audit-data')}>
          <ListChecks size={15} /> Buka Audit Data Tersembunyi
        </button>
      ) : <Alert tone="info" title="Hanya Administrator">Menu ini tidak tersedia untuk role Anda.</Alert>}
    </Card>
  );
}
