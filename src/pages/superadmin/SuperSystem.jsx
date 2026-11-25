import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Code, Database, Download, FileArchive, FileCode, HardDrive,
  Loader2, Play, RefreshCw, RotateCcw, Save, Search, Send, Server, Terminal, Trash2, Upload
} from 'lucide-react';
import { api, docUrl, tgl, waktu, angka } from '../../api';
import { Alert, Card, Empty, Field, Spinner, cx, useToast } from '../../ui';
import { Badge, Kpi, bytes } from './ui-saas';

/* =====================================================================
   14. BACKUP & RESTORE LANJUTAN
   ===================================================================== */
export function SuperBackup({ ctx }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tg, setTg] = useState({});
  const [busy, setBusy] = useState('');
  const [restoreFile, setRestoreFile] = useState(null);
  const load = useCallback(async () => {
    const r = await api('/api/super/backup');
    setData(r);
    setTg({
      telegram_bot_token: '', telegram_chat_id: r.telegram.chat || '',
      telegram_auto: r.telegram.auto, telegram_jam: r.telegram.jam || '02:00'
    });
  }, []);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  if (!data) return <Spinner label="Memuat backup…" />;

  const unduh = (path) => { window.open(docUrl(path), '_blank', 'noopener'); };

  async function simpanTg() {
    setBusy('tg');
    try { const r = await api('/api/super/backup/telegram', { method: 'POST', body: tg }); toast.ok(r.pesan); await load(); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function ujiTg() {
    setBusy('tg-uji');
    try {
      const r = await api('/api/super/backup/telegram/uji', { method: 'POST', body: tg });
      toast.ok(r.pesan);
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function kirimTg() {
    if (!confirm('Kirim arsip seluruh platform dan seluruh database sekolah ke Telegram?')) return;
    setBusy('tg-kirim');
    try { const r = await api('/api/super/backup/kirim', { method: 'POST' }); toast.ok(r.pesan); load(); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function restore() {
    if (!restoreFile) return;
    if (!confirm('Pulihkan database platform dari berkas ini? Semua sesi akan dihapus dan data saat ini ditimpa.')) return;
    setBusy('restore');
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
        r.onerror = rej; r.readAsDataURL(restoreFile);
      });
      const r = await api('/api/super/backup/restore', { method: 'POST', body: { base64: b64, filename: restoreFile.name } });
      toast.ok(r.pesan);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Backup &amp; Restore Lanjutan</h2>
        <p className="text-[12.5px] text-slate-500">Cadangkan seluruh platform (control plane + seluruh database sekolah) ke Telegram atau unduh manual.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Sekolah" value={angka(data.ringkas.sekolah)} icon={Server} tone="slate" />
        <Kpi label="Ukuran DB Sekolah" value={bytes(data.ringkas.ukuran_db)} icon={HardDrive} tone="sky" />
        <Kpi label="Control Plane" value={bytes(data.ringkas.ukuran_saas)} icon={Database} tone="violet" />
      </div>

      <Card title="Auto Backup Telegram" subtitle="Arsip ZIP berisi database platform + seluruh database sekolah"
        right={<Badge tone={data.telegram.auto ? 'aman' : 'netral'}>{data.telegram.auto ? 'Otomatis aktif' : 'Otomatis nonaktif'}</Badge>}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Bot Token Telegram" hint={data.telegram.token_set
            ? `Token tersimpan: ${data.telegram.token_masked}. Kosongkan bila tidak diubah.`
            : 'Dari @BotFather. Token disimpan di server, tidak dikirim kembali ke browser.'}>
            <input data-super-backup-token className="input" type="password" autoComplete="new-password"
              placeholder={data.telegram.token_set ? 'Token sudah tersimpan' : '123456:ABC…'}
              value={tg.telegram_bot_token || ''} onChange={e => setTg(v => ({ ...v, telegram_bot_token: e.target.value }))} />
          </Field>
          <Field label="Chat ID Tujuan" hint="ID chat/grup penerima arsip">
            <input className="input" value={tg.telegram_chat_id || ''} onChange={e => setTg(v => ({ ...v, telegram_chat_id: e.target.value }))} />
          </Field>
          <Field label="Jam Backup Harian" hint="Pisahkan beberapa jam dengan koma, contoh 06:00, 15:00.">
            <input data-super-backup-jam className="input" value={tg.telegram_jam || '02:00'}
              onChange={e => setTg(v => ({ ...v, telegram_jam: e.target.value }))} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-[12.5px] font-semibold text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!tg.telegram_auto} onChange={e => setTg(v => ({ ...v, telegram_auto: e.target.checked }))} />
            Aktifkan backup otomatis harian
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-primary btn-sm" disabled={busy !== ''} onClick={simpanTg}>
            {busy === 'tg' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan
          </button>
          <button data-super-backup-test className="btn-ghost btn-sm" disabled={busy !== ''} onClick={ujiTg}>
            {busy === 'tg-uji' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Uji Koneksi Bot
          </button>
          <button className="btn-ghost btn-sm" disabled={busy !== ''} onClick={kirimTg}>
            {busy === 'tg-kirim' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Kirim Backup Sekarang
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-slate-500">
          Backup terakhir: {data.telegram.terakhir ? waktu(data.telegram.terakhir) : 'belum pernah'} ·
          Konfigurasi juga dapat diberikan lewat variabel lingkungan <code>TELEGRAM_BOT_TOKEN</code> / <code>TELEGRAM_CHAT_ID</code>.
        </p>
        <p className="mt-1 text-[11.5px] text-slate-500">Backup adalah arsip satu arah, bukan sinkronisasi database dua arah. Token dan kunci layanan tidak dimasukkan ke arsip.</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Unduh Manual" subtitle="Arsip lengkap seluruh data" bodyClass="p-0">
          <div className="space-y-2 p-3">
            <button className="btn-ghost w-full justify-start" onClick={() => unduh('/api/super/backup/zip')}><FileArchive size={15} /> Unduh Backup (.zip)</button>
            <button className="btn-ghost w-full justify-start" onClick={() => unduh('/api/super/backup/sql')}><Database size={15} /> Unduh Database (.sql)</button>
            <button className="btn-ghost w-full justify-start" onClick={() => unduh('/api/super/backup/source')}><FileCode size={15} /> Unduh Source Code</button>
          </div>
        </Card>
        <Card title="Restore Database" subtitle="Pulihkan dari .zip / .json" bodyClass="p-0">
          <div className="space-y-2 p-3">
            <input type="file" accept=".zip,.json" onChange={e => setRestoreFile(e.target.files?.[0] || null)}
              className="block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 p-2 text-[11.5px] text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[11.5px] file:font-bold file:text-slate-700" />
            <button className="btn-danger w-full" disabled={!restoreFile || busy === 'restore'} onClick={restore}>
              {busy === 'restore' ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Pulihkan Database
            </button>
            <p className="text-[11px] text-slate-500">Data saat ini ditimpa. Arsip ZIP dari menu ini memuat control plane + semua sekolah.</p>
          </div>
        </Card>
        <Card title="Riwayat Backup" subtitle="60 aktivitas terakhir" bodyClass="p-0">
          <div className="max-h-[220px] divide-y divide-slate-100 overflow-auto">
            {data.log.map(l => (
              <div key={l.id} className="flex items-center gap-2 p-2 text-[11.5px]">
                <Badge tone={l.status === 'sukses' ? 'aman' : 'siaga'}>{l.jenis}</Badge>
                <span className="min-w-0 flex-1 truncate text-slate-600">{l.nama || l.pesan}</span>
                <span className="shrink-0 text-slate-400">{bytes(l.ukuran)}</span>
              </div>
            ))}
            {!data.log.length ? <div className="p-3"><Empty title="Belum ada riwayat" /></div> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* =====================================================================
   15. DATABASE MANAGER
   ===================================================================== */
export function SuperDatabase() {
  const toast = useToast();
  const [scope, setScope] = useState('saas');
  const [tabel, setTabel] = useState('');
  const [hal, setHal] = useState(1);
  const [data, setData] = useState(null);
  const [sql, setSql] = useState('SELECT name FROM sqlite_master WHERE type=\'table\' LIMIT 20;');
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [hasil, setHasil] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const [orphan, setOrphan] = useState(null);

  const load = useCallback(async () => {
    const r = await api(`/api/super/database?scope=${encodeURIComponent(scope)}&tabel=${encodeURIComponent(tabel)}&hal=${hal}`);
    setData(r);
  }, [scope, tabel, hal]);
  useEffect(() => { load().catch(e => toast.err(e.message)); }, [load]);
  const loadOrphan = useCallback(() => api('/api/super/database/orphan').then(setOrphan).catch(() => {}), []);
  useEffect(() => { loadOrphan(); }, [loadOrphan]);

  async function jalankan() {
    setBusy('sql');
    try {
      const r = await api('/api/super/database/query', { method: 'POST', body: { scope, sql, konfirmasi } });
      setHasil(r);
      toast.ok(r.pesan);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function simpanBaris() {
    setBusy('row');
    try {
      await api('/api/super/database/baris', { method: 'POST', body: { scope, tabel: data.aktif, rowid: edit.__rowid, data: edit } });
      toast.ok('Baris diperbarui.');
      setEdit(null); load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  if (!data) return <Spinner label="Memuat database…" />;

  const totalHal = Math.max(1, Math.ceil(data.total / 40));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Database Manager</h2>
        <p className="text-[12.5px] text-slate-500">Lihat, edit, dan rapikan tabel pada control plane maupun database setiap sekolah.</p>
      </div>

      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <select className="input max-w-[280px]" value={scope} onChange={e => { setScope(e.target.value); setTabel(''); setHal(1); }}>
            {data.daftar.map(d => <option key={d.scope} value={d.scope}>{d.nama}</option>)}
          </select>
          <select className="input max-w-[240px]" value={data.aktif || ''} onChange={e => { setTabel(e.target.value); setHal(1); }}>
            {data.tabel.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-[11.5px] text-slate-500">{angka(data.total)} baris</span>
          <div className="ml-auto flex items-center gap-1">
            <button className="btn-ghost btn-sm" disabled={hal <= 1} onClick={() => setHal(h => h - 1)}><ChevronLeft size={13} /></button>
            <span className="text-[11.5px] font-semibold text-slate-600">{hal} / {totalHal}</span>
            <button className="btn-ghost btn-sm" disabled={hal >= totalHal} onClick={() => setHal(h => h + 1)}><ChevronRight size={13} /></button>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-auto">
          <table className="tbl">
            <thead><tr><th>rowid</th>{data.kolom.map(k => <th key={k}>{k}</th>)}<th className="text-right">Aksi</th></tr></thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r.__rowid}>
                  <td className="font-mono text-[11px] text-slate-400">{r.__rowid}</td>
                  {data.kolom.map(k => (
                    <td key={k} className="max-w-[220px] truncate text-[11.5px]" title={String(r[k] ?? '')}>
                      {r[k] === null ? <span className="text-slate-300">NULL</span> : String(r[k]).slice(0, 80)}
                    </td>
                  ))}
                  <td className="text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...r })}>Edit</button>
                  </td>
                </tr>
              ))}
              {!data.rows.length ? <tr><td colSpan={data.kolom.length + 2} className="text-slate-400">Tabel kosong.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Rapikan Berkas Database" subtitle="Berkas SQLite di folder sekolah yang tidak lagi dipakai tenant mana pun"
        right={<div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={loadOrphan}><RefreshCw size={13} /> Pindai</button>
          <button className="btn-danger btn-sm" disabled={!orphan || !orphan.rows.length} onClick={async () => {
            if (!confirm(`Hapus ${orphan.rows.length} berkas database yatim (${bytes(orphan.total)})? Berkas ini tidak dipakai sekolah mana pun.`)) return;
            setBusy('orphan');
            try {
              const r = await api('/api/super/database/orphan/hapus', { method: 'POST' });
              toast.ok(r.pesan); loadOrphan();
            } catch (e) { toast.err(e.message); }
            finally { setBusy(''); }
          }}>{busy === 'orphan' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Rapikan</button>
        </div>}>
        {orphan && orphan.rows.length ? (
          <div className="space-y-1">
            <p className="text-[12px] text-slate-600">{orphan.rows.length} berkas · total {bytes(orphan.total)}</p>
            <div className="max-h-[160px] overflow-auto rounded-xl border border-slate-100">
              <table className="tbl">
                <thead><tr><th>Berkas</th><th>Ukuran</th></tr></thead>
                <tbody>
                  {orphan.rows.map(o => (
                    <tr key={o.rel}><td className="font-mono text-[11.5px]">{o.nama}</td><td className="text-[11.5px]">{bytes(o.ukuran)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <p className="text-[12.5px] text-slate-500">Tidak ada berkas database yatim — seluruh berkas dipakai oleh sekolah terdaftar.</p>}
      </Card>

      <Card title="Konsol SQL" subtitle="Satu perintah per eksekusi. Perintah pengubah data memerlukan centang konfirmasi."
        right={<button className="btn-primary btn-sm" disabled={busy === 'sql'} onClick={jalankan}>
          {busy === 'sql' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Jalankan
        </button>}>
        <textarea className="input min-h-[110px] font-mono text-[12px]" value={sql} onChange={e => setSql(e.target.value)} />
        <label className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-rose-700">
          <input type="checkbox" className="h-4 w-4 accent-rose-600" checked={konfirmasi} onChange={e => setKonfirmasi(e.target.checked)} />
          Saya paham perintah ini dapat mengubah/menghapus data
        </label>
        {hasil ? (
          <div className="mt-2 rounded-xl bg-slate-900 p-3 text-[11.5px] text-emerald-200">
            <p className="mb-1 text-slate-400">{hasil.pesan}</p>
            <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap">{JSON.stringify(hasil.rows?.slice(0, 40) || hasil.info, null, 1)}</pre>
          </div>
        ) : null}
        <Alert tone="warn" title="Hati-hati">
          Perintah <code>attach</code>, <code>detach</code>, <code>load_extension</code>, dan <code>vacuum into</code> diblokir.
          Semua eksekusi dicatat pada Audit Logs.
        </Alert>
      </Card>

      {edit ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-[560px] overflow-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-extrabold text-slate-800">Edit Baris — {data.aktif}</h3>
            <p className="text-[11.5px] text-slate-500">rowid {edit.__rowid}</p>
            <div className="mt-3 space-y-2">
              {data.kolom.map(k => (
                <Field key={k} label={k}>
                  <input className="input" value={edit[k] === null ? '' : String(edit[k])}
                    onChange={e => setEdit(v => ({ ...v, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>Batal</button>
              <button className="btn-primary" disabled={busy === 'row'} onClick={simpanBaris}>
                {busy === 'row' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
