import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { api, docUrl } from '../api';
import { Alert, Modal, cx, useToast } from '../ui';

const JENIS = {
  siswa: {
    label: 'Data Siswa',
    template: '/api/siswa-template.xlsx',
    endpoint: '/api/siswa/import',
    cols: [
      { k: 'nama', l: 'Nama', cls: 'font-semibold' },
      { k: 'nis', l: 'NIS' }, { k: 'nisn', l: 'NISN' }, { k: 'kelas', l: 'Kelas' },
      { k: 'gender', l: 'JK', center: true }, { k: 'tanggal_lahir', l: 'Tgl Lahir' }, { k: 'parent_phone', l: 'No HP' }
    ]
  },
  kelas: {
    label: 'Data Kelas',
    template: '/api/kelas-template.xlsx',
    endpoint: '/api/kelas/import',
    cols: [
      { k: 'nama', l: 'Nama Kelas', cls: 'font-semibold' }, { k: 'tingkat', l: 'Tingkat', center: true },
      { k: 'jurusan', l: 'Jurusan' }, { k: 'wali_nama', l: 'Wali Kelas' }
    ]
  },
  kategori: {
    label: 'Kategori Poin',
    template: '/api/kategori-template.xlsx',
    endpoint: '/api/kategori/import',
    cols: [
      { k: 'nama', l: 'Nama Kategori', cls: 'font-semibold' },
      { k: 'jenis_label', l: 'Jenis', center: true },
      { k: 'poin', l: 'Poin', center: true },
      { k: 'keterangan', l: 'Keterangan' }
    ]
  },
  users: {
    label: 'Akun Guru / Pegawai',
    template: '/api/users-template.xlsx',
    endpoint: '/api/users/import',
    cols: [
      { k: 'nama', l: 'Nama', cls: 'font-semibold' }, { k: 'jabatan', l: 'Jabatan' },
      { k: 'username', l: 'Username' }, { k: 'role_label', l: 'Role' },
      { k: 'nip', l: 'NIP' }, { k: 'phone', l: 'No HP' },
      { k: 'password', l: 'Sandi', render: r => r.password ? '••••••' : <span className="text-slate-400">default</span> }
    ]
  }
};

const PETUNJUK = {
  siswa: ['Unduh template Excel, isi data mulai baris ke-4 (jangan mengubah judul kolom).',
    'Pilih berkas, sistem menampilkan pratinjau beserta validasi & deteksi duplikat.',
    'Klik Simpan untuk menyimpan baris yang valid saja.'],
  kelas: ['Unduh template, isi Nama Kelas, Tingkat (X/XI/XII), Jurusan, dan Wali Kelas.',
    'Nama wali kelas harus sama dengan nama pada akun ber-role Wali Kelas.',
    'Baris dengan nama kelas ganda otomatis dilewati.'],
  kategori: ['Unduh template Excel, isi NAMA KATEGORI, JENIS (Pelanggaran/Prestasi), POIN, dan KETERANGAN.',
    'Isi data mulai baris ke-4 — jangan mengubah baris judul kolom.',
    'JENIS kosong otomatis dianggap "Pelanggaran"; POIN harus angka lebih dari 0.',
    'Kategori dengan nama + jenis yang sudah ada otomatis dilewati agar tidak ganda.'],
  users: ['Unduh template, isi Nama, Jabatan, Username, Role, NIP, No HP, dan Kata Sandi (opsional).',
    'Role yang dikenali: Administrator, Kepala Sekolah, Guru BK, Guru Kesiswaan, Wali Kelas, Guru Mata Pelajaran, Guru Umum, Tenaga Administrasi (TU).',
    'Username ganda dilewati. Kata sandi kosong otomatis "sekolah123" (minta pegawai mengganti di menu Profil Akun).']
};

export default function ImportModal({ open, onClose, jenis = 'siswa', onDone }) {
  const toast = useToast();
  const cfg = JENIS[jenis] || JENIS.siswa;
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  function reset() {
    setFile(null); setRows(null); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }
  function close() { reset(); onClose?.(); }

  async function pilih(f) {
    if (!f) return;
    setFile(f); setRows(null); setBusy(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
        fr.onerror = rej; fr.readAsDataURL(f);
      });
      const r = await api(cfg.endpoint + '/preview', { method: 'POST', body: { filename: f.name, base64 } });
      setRows(r.rows);
      if (!r.rows.length) toast.info('Tidak ada baris data yang terdeteksi pada berkas.');
    } catch (e) {
      toast.err(e.message);
      setRows(null);
    } finally { setBusy(false); }
  }

  async function simpan() {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await api(cfg.endpoint + '/commit', { method: 'POST', body: { rows } });
      toast.ok(`${r.masuk} baris ${cfg.label.toLowerCase()} berhasil diimpor${r.dilewati ? `, ${r.dilewati} dilewati` : ''}.`);
      onDone?.();
      close();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  const errors = rows ? rows.filter(r => r.error).length : 0;
  const dups = rows ? rows.filter(r => r.duplikat).length : 0;
  const siap = rows ? rows.filter(r => !r.error && !r.skip).length : 0;

  return (
    <Modal open={open} onClose={close} title={`Import ${cfg.label} dari Excel`} size="xl"
      subtitle="Kolom dibaca otomatis dari baris header. Data ganda terdeteksi sebelum disimpan."
      footer={rows ? (
        <>
          <button className="btn-ghost" onClick={reset}>Pilih Berkas Lain</button>
          <button className="btn-primary" onClick={simpan} disabled={busy || !siap}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Simpan {siap} Baris
          </button>
        </>
      ) : (
        <a className="btn-ghost" href={docUrl(cfg.template)} download><Download size={15} /> Unduh Template</a>
      )}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <a className="btn-soft" href={docUrl(cfg.template)} download><Download size={15} /> Template Excel</a>
          <label className={cx('btn-ghost cursor-pointer', busy && 'opacity-60')}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Pilih Berkas Excel/CSV
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => pilih(e.target.files?.[0])} />
          </label>
          {file ? <span className="chip"><CheckCircle2 size={12} className="text-emerald-500" /> {file.name}</span> : null}
        </div>

        {errors ? <Alert tone="danger" title={`${errors} baris bermasalah`}>Baris yang error tidak akan disimpan. Perbaiki berkas lalu ulangi import.</Alert> : null}
        {dups ? <Alert tone="warn" title={`${dups} baris terdeteksi duplikat`}>Dilewati otomatis agar tidak terjadi data ganda.</Alert> : null}

        {rows ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Total Baris" value={rows.length} />
              <Stat label="Siap Simpan" value={siap} tone="emerald" />
              <Stat label="Duplikat" value={dups} tone="amber" />
              <Stat label="Error" value={errors} tone="rose" />
            </div>
            <div className="tbl-wrap max-h-[46vh]">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-14">Baris</th>
                    {cfg.cols.map(c => <th key={c.k} className={c.center ? 'text-center' : ''}>{c.l}</th>)}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={cx(r.error && 'bg-rose-50/50', r.duplikat && !r.error && 'bg-amber-50/50')}>
                      <td className="text-center text-slate-400">{r.baris}</td>
                      {cfg.cols.map(c => (
                        <td key={c.k} className={cx(c.cls, c.center && 'text-center')}>
                          {c.render ? c.render(r) : (r[c.k] || '-')}
                        </td>
                      ))}
                      <td>
                        {r.error ? <span className="badge badge-siaga"><AlertTriangle size={11} /> Error</span>
                          : r.duplikat ? <span className="badge badge-perhatian">Duplikat</span>
                            : <span className="badge badge-aman">Siap</span>}
                        {r.error ? <p className="mt-1 text-[10.5px] text-rose-600">{r.error}</p> : null}
                        {r.duplikat ? <p className="mt-1 text-[10.5px] text-amber-700">{r.duplikat}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-[12.5px] leading-relaxed text-slate-600">
            <p className="font-bold text-slate-700">Cara import:</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {(PETUNJUK[jenis] || PETUNJUK.siswa).map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone = 'slate' }) {
  const map = { slate: 'text-slate-700', emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600' };
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cx('text-[17px] font-extrabold leading-tight', map[tone])}>{value}</p>
    </div>
  );
}
