import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, GraduationCap, Loader2, RefreshCw, Save, Wand2 } from 'lucide-react';
import { api } from '../api';
import { Alert, Card, Field, Spinner, cx, useToast } from '../ui';

/* =====================================================================
   PENGATURAN JENJANG PENDIDIKAN & FORMAT TINGKAT KELAS
   ---------------------------------------------------------------------
   Perubahan format tingkat dipetakan berdasarkan URUTAN (bukan nama),
   sehingga hierarki kenaikan kelas & deteksi tingkat akhir tetap akurat.
   ===================================================================== */
export function TingkatJenjang({ ctx, readOnly }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState({ jenjang: 'SMK', mode: 'jenjang', custom: '', terapkan: false });
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api('/api/tingkat');
      setData(r);
      setF(v => ({
        ...v,
        jenjang: r.config.jenjang,
        mode: r.config.mode,
        custom: (r.config.kustom || []).join('\n')
      }));
    } catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <Spinner label="Memuat pengaturan tingkat…" />;
  if (!data) return <Alert tone="error" title="Gagal memuat">Pengaturan tingkat tidak dapat dibaca.</Alert>;

  const modeOptions = data.modes || [];
  /* Pratinjau LANGSUNG mengikuti pilihan yang sedang diisi (bukan konfigurasi
     tersimpan), supaya perubahan format/jenjang/kustom segera terlihat. */
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  const angkaOf = tk => {
    const s = String(tk || '').trim().toUpperCase().replace(/^KELAS\s+/, '');
    return /^\d+$/.test(s) ? Number(s) : (ROMAN[s] || 0);
  };
  const formatOf = (n, mode) => (mode === 'angka' ? String(n) : mode === 'kelas' ? `Kelas ${n}` : (Object.keys(ROMAN).find(k => ROMAN[k] === n) || String(n)));
  const bawaanJenjang = (data.per_jenjang || {})[f.jenjang] || (data.per_jenjang || {}).SMK || [];
  const previewList = (() => {
    if (f.mode === 'custom') {
      const list = String(f.custom || '').split(/\r?\n|\|/).map(x => x.trim()).filter(Boolean);
      return list.length ? list : bawaanJenjang;
    }
    if (f.mode === 'jenjang') return bawaanJenjang;
    return bawaanJenjang.map((tk, i) => formatOf(angkaOf(tk) || (i + 1), f.mode));
  })();

  async function simpan(e) {
    e?.preventDefault();
    setBusy('simpan');
    try {
      const r = await api('/api/tingkat', {
        method: 'POST',
        body: { jenjang: f.jenjang, mode: f.mode, custom: f.custom, terapkan: !!f.terapkan }
      });
      toast.ok(`Format tingkat disimpan: ${(r.config.list || []).join(' → ')}` +
        (r.hasil && r.hasil.diubah ? ` · ${r.hasil.diubah} kelas disesuaikan.` : '.'));
      await load();
      ctx?.reloadBoot && ctx.reloadBoot();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(''); }
  }

  async function terapkan() {
    if (!window.confirm('Terapkan format tingkat aktif ke SELURUH data kelas? Tingkat kelas dipetakan menurut urutan.')) return;
    setBusy('terapkan');
    try {
      const r = await api('/api/tingkat/terapkan', { method: 'POST', body: {} });
      toast.ok(`${r.hasil.diubah} kelas diperbarui${r.hasil.dilewati ? `, ${r.hasil.dilewati} dilewati` : ''}.`);
      await load();
    } catch (e2) { toast.err(e2.message); }
    finally { setBusy(''); }
  }

  return (
    <div className="space-y-4">
      <Card title="Jenjang Pendidikan & Format Tingkat Kelas"
        subtitle="Daftar tingkat kelas menyesuaikan jenjang sekolah dan dapat dikustomisasi">
        <form onSubmit={simpan} className="space-y-3" data-tingkat-form="1">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Jenjang Pendidikan" hint="Menentukan jumlah & nama tingkat bawaan">
              <select className="input" value={f.jenjang} data-tingkat-jenjang disabled={readOnly}
                onChange={e => setF(v => ({ ...v, jenjang: e.target.value }))}>
                {(data.jenjang || []).map(j => <option key={j.key} value={j.key}>{j.label}</option>)}
              </select>
            </Field>
            <Field label="Format Nama Tingkat">
              <select className="input" value={f.mode} data-tingkat-mode disabled={readOnly}
                onChange={e => setF(v => ({ ...v, mode: e.target.value }))}>
                {modeOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </Field>
          </div>

          {f.mode === 'custom' ? (
            <Field label="Daftar Tingkat Kustom" hint="Satu tingkat per baris, urut dari tingkat awal ke tingkat akhir (maks. 12). Contoh: Kelas 1, Kelas 2, Kelas 3">
              <textarea className="input min-h-[110px] font-mono text-[12px]" value={f.custom} data-tingkat-custom
                disabled={readOnly} placeholder={'Fase A\nFase B\nFase C'}
                onChange={e => setF(v => ({ ...v, custom: e.target.value }))} />
            </Field>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Pratinjau Urutan Tingkat</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-tingkat-preview>
              {previewList.map((tk, i) => (
                <React.Fragment key={tk + i}>
                  {i ? <ArrowRight size={12} className="text-slate-400" /> : null}
                  <span className={cx('rounded-lg px-2 py-1 text-[12px] font-bold',
                    i === previewList.length - 1 ? 'bg-orange-100 text-orange-700' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>
                    {tk}
                  </span>
                </React.Fragment>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Tingkat terakhir ({previewList.slice(-1)[0] || '-'}) adalah tingkat akhir —
              siswa di tingkat ini otomatis berstatus <b>Lulus</b> saat kenaikan kelas.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-orange-200 bg-orange-50/60 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-600" checked={!!f.terapkan}
              data-tingkat-terapkan disabled={readOnly}
              onChange={e => setF(v => ({ ...v, terapkan: e.target.checked }))} />
            <span>
              <span className="block text-[12.5px] font-bold text-orange-900">Sekaligus terapkan ke data kelas yang ada</span>
              <span className="block text-[11px] text-orange-800">
                Tingkat kelas dipetakan menurut urutan (mis. kelas tingkat ke-1 → tingkat ke-1 format baru).
                Nama kelas ikut disesuaikan bila memuat label tingkat lama.
              </span>
            </span>
          </label>

          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" type="submit" disabled={!!busy} data-tingkat-simpan>
                {busy === 'simpan' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan Pengaturan
              </button>
              <button className="btn-ghost" type="button" disabled={!!busy} onClick={terapkan} data-tingkat-terapkan-btn>
                {busy === 'terapkan' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Petakan Ulang Data Kelas
              </button>
            </div>
          ) : null}
        </form>
      </Card>

      <Card title="Dampak Perubahan" subtitle="Yang ikut menyesuaikan otomatis">
        <ul className="space-y-1.5 text-[12.5px] text-slate-600">
          <li>• <b>Data Kelas</b> — pilihan tingkat pada form & filter memakai daftar di atas.</li>
          <li>• <b>Kenaikan Kelas</b> — siswa naik ke tingkat berikutnya sesuai urutan; tingkat akhir menjadi Lulus.</li>
          <li>• <b>Riwayat Siswa</b> — penempatan kelas per tahun pelajaran tersimpan dan tetap dapat dilihat.</li>
          <li>• <b>Surat & Laporan</b> — label tingkat pada kop/dokumen mengikuti nama kelas yang tersimpan.</li>
        </ul>
      </Card>
    </div>
  );
}

/* =====================================================================
   KENAIKAN KELAS (manual / pratinjau)
   ===================================================================== */
export function KenaikanKelas({ ctx }) {
  const toast = useToast();
  const [tahun, setTahun] = useState([]);
  const [dari, setDari] = useState('');
  const [ke, setKe] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');

  const loadTahun = useCallback(async () => {
    try {
      const r = await api('/api/tahun');
      setTahun(r.rows || []);
      const aktif = (r.rows || []).find(t => t.aktif) || (r.rows || [])[0];
      setDari(v => v || (aktif ? String(aktif.id) : ''));
    } catch (e) { toast.err(e.message); }
  }, []);
  useEffect(() => { loadTahun(); }, [loadTahun]);

  const lihat = async () => {
    if (!dari || !ke) return toast.err('Pilih tahun pelajaran asal dan tujuan.');
    setBusy('preview');
    try { const r = await api(`/api/tahun/kenaikan/preview?dari=${dari}&ke=${ke}`); setPreview(r.preview); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  };

  const jalankan = async () => {
    if (!window.confirm('Jalankan kenaikan kelas sekarang? Siswa tingkat akhir akan berstatus Lulus.')) return;
    setBusy('run');
    try {
      const r = await api('/api/tahun/kenaikan', { method: 'POST', body: { dari, ke } });
      toast.ok(`${r.hasil.naik} siswa naik tingkat · ${r.hasil.lulus} siswa lulus.`);
      setPreview(null);
      ctx?.reloadBoot && ctx.reloadBoot();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  };

  return (
    <Card title="Kenaikan Kelas Otomatis" subtitle="Naikkan tingkat seluruh siswa & luluskan tingkat akhir"
      right={<button className="btn-ghost btn-sm" onClick={lihat} disabled={!!busy} data-kenaikan-preview>
        {busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Pratinjau
      </button>}>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Dari Tahun Pelajaran">
          <select className="input" value={dari} onChange={e => setDari(e.target.value)} data-kenaikan-dari>
            <option value="">— pilih —</option>
            {tahun.map(t => <option key={t.id} value={t.id}>{t.nama}{t.aktif ? ' (aktif)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Ke Tahun Pelajaran">
          <select className="input" value={ke} onChange={e => setKe(e.target.value)} data-kenaikan-ke>
            <option value="">— pilih —</option>
            {tahun.map(t => <option key={t.id} value={t.id}>{t.nama}{t.aktif ? ' (aktif)' : ''}</option>)}
          </select>
        </Field>
      </div>

      {preview ? (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 ring-1 ring-emerald-100">
              <p className="text-[10.5px] font-bold uppercase text-emerald-700">Naik Tingkat</p>
              <p className="text-[18px] font-extrabold text-emerald-800" data-kenaikan-naik>{preview.naik}</p>
            </div>
            <div className="rounded-xl bg-violet-50 px-3 py-2 ring-1 ring-violet-100">
              <p className="text-[10.5px] font-bold uppercase text-violet-700">Lulus</p>
              <p className="text-[18px] font-extrabold text-violet-800" data-kenaikan-lulus>{preview.lulus}</p>
            </div>
            <div className="rounded-xl bg-sky-50 px-3 py-2 ring-1 ring-sky-100">
              <p className="text-[10.5px] font-bold uppercase text-sky-700">Kelas Baru</p>
              <p className="text-[18px] font-extrabold text-sky-800">{preview.kelasBaru}</p>
            </div>
          </div>
          <div className="tbl-wrap max-h-[240px] overflow-auto">
            <table className="tbl">
              <thead><tr><th>Kelas</th><th>Tingkat</th><th>Menjadi</th><th className="text-center">Siswa</th></tr></thead>
              <tbody>
                {preview.plan.map((p, i) => (
                  <tr key={i}>
                    <td className="font-semibold text-slate-700">{p.kelas}</td>
                    <td>{p.tingkat}</td>
                    <td>{p.ke}</td>
                    <td className="text-center">{p.siswa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-primary" onClick={jalankan} disabled={!!busy} data-kenaikan-jalankan>
            {busy === 'run' ? <Loader2 size={15} className="animate-spin" /> : <GraduationCap size={15} />} Jalankan Kenaikan Kelas
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-slate-500">
          Pilih tahun asal & tujuan lalu tekan <b>Pratinjau</b> untuk melihat daftar kelas yang akan naik.
          Proses ini juga berjalan otomatis saat menambah tahun pelajaran dengan centang <b>Salin Periodik</b>.
        </p>
      )}
    </Card>
  );
}
