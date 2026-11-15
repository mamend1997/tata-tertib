import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, FileSpreadsheet, Info, Loader2, Plus, RefreshCw, Save, Trash2, Upload, Wand2
} from 'lucide-react';
import { api, compressImage, docUrl } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, cx, useToast } from '../ui';

export default function AsesmenSoal({ ctx }) {
  const { can, toast } = ctx;
  const [kode, setKode] = useState('akpd');
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ nama: '', deskripsi: '', petunjuk: '', tipe: 'centang', aktif: 1 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pilih, setPilih] = useState([]);          // id butir terpilih (hanya butir tersimpan)
  const [busyHapus, setBusyHapus] = useState(false);
  const [impor, setImpor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [modeImpor, setModeImpor] = useState('tambah');
  const fileRef = useRef(null);
  const readOnly = !can('asesmen_soal', 'write');

  const load = useCallback(() => {
    setLoading(true);
    api('/api/asesmen/soal?kode=' + kode)
      .then(r => {
        setData(r);
        setRows((r.soal || []).map(s => ({ ...s })));
        setMeta({
          nama: r.instrumen.nama || '', deskripsi: r.instrumen.deskripsi || '',
          petunjuk: r.instrumen.petunjuk || '', tipe: r.instrumen.tipe || 'centang', aktif: r.instrumen.aktif ? 1 : 0
        });
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, [kode]);
  useEffect(load, [load]);

  const kategori = data?.kategori || [];
  const idTersimpan = rows.filter(r => r.id).map(r => r.id);
  const semuaTerpilih = idTersimpan.length > 0 && pilih.length === idTersimpan.length;
  useEffect(() => { setPilih([]); }, [kode]);

  async function hapusTerpilih() {
    if (!pilih.length) return;
    if (!window.confirm(`Hapus ${pilih.length} butir pernyataan terpilih? Hasil asesmen yang sudah masuk tetap tersimpan.`)) return;
    setBusyHapus(true);
    try {
      const r = await api('/api/asesmen/soal/delete-masal', { method: 'POST', body: { ids: pilih } });
      toast.ok(r.pesan || 'Butir pernyataan dihapus.');
      setPilih([]);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusyHapus(false); }
  }

  function ubah(i, key, val) {
    setRows(list => list.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }
  function tambah() {
    setRows(list => [...list, { id: 0, nomor: list.length + 1, teks: '', kategori: kategori[0]?.key || '', indikator: '', aktif: 1 }]);
  }
  async function hapus(row, i) {
    if (row.id) {
      if (!window.confirm('Hapus butir pernyataan ini dari bank soal?')) return;
      try {
        await api('/api/asesmen/soal/delete', { method: 'POST', body: { id: row.id } });
        toast.ok('Butir dihapus.');
      } catch (e) { return toast.err(e.message); }
    }
    setRows(list => list.filter((_, idx) => idx !== i));
  }

  async function simpan() {
    if (readOnly) return;
    setBusy(true);
    try {
      const r = await api('/api/asesmen/soal/simpan', { method: 'POST', body: { kode, ...meta, rows } });
      toast.ok(r.pesan || 'Bank soal diperbarui.');
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  function pilihBerkas(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try {
        const b64 = String(reader.result).replace(/^data:[^,]*,/, '');
        const r = await api('/api/asesmen/import/preview', { method: 'POST', body: { kode, base64: b64, filename: file.name } });
        setImpor({ base64: b64, filename: file.name });
        setPreview(r);
      } catch (e2) { toast.err(e2.message); }
      finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  }

  async function commitImpor() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api('/api/asesmen/import/commit', {
        method: 'POST',
        body: { kode, mode: modeImpor, rows: preview.rows }
      });
      toast.ok(r.pesan || 'Import selesai.');
      setPreview(null); setImpor(null);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  const instrumen = data?.semua_instrumen || [];

  return (
    <div className="space-y-4" data-page="asesmen-soal">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Pengaturan Soal &amp; Kategori Asesmen</h2>
          <p className="text-[12.5px] text-slate-500">
            Kelola bank soal serta kategori analisis untuk AKPD, RIASEC, Gaya Belajar, dan Kesulitan Belajar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={docUrl('/api/asesmen/template.xlsx?kode=' + kode)}><Download size={15} /> Template Excel</a>
          {!readOnly ? (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={pilihBerkas} />
              <button className="btn-soft" onClick={() => fileRef.current?.click()} disabled={busy} data-import-soal>
                <Upload size={15} /> Import Soal
              </button>
              <button className="btn-primary" onClick={simpan} disabled={busy} data-simpan-bank-soal>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Simpan &amp; Perbarui Bank Soal
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="tabs">
        {instrumen.map(i => (
          <button key={i.kode} className={cx('tab', kode === i.kode && 'active')} onClick={() => setKode(i.kode)} data-instrumen-soal={i.kode}>
            {i.nama} ({i.jumlah_soal})
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : !data ? <Empty icon={Info} title="Instrumen tidak ditemukan" /> : (
        <>
          <Card title="Identitas & Petunjuk Instrumen" subtitle="Tampil pada halaman pengisian siswa.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nama Instrumen">
                <input className="input" value={meta.nama} disabled={readOnly} onChange={e => setMeta(s => ({ ...s, nama: e.target.value }))} />
              </Field>
              <Field label="Jenis Jawaban">
                <select className="input" value={meta.tipe} disabled={readOnly} onChange={e => setMeta(s => ({ ...s, tipe: e.target.value }))}>
                  <option value="likert4">Skala Likert 1–4 (AKPD)</option>
                  <option value="centang">Centang (Ya/Tidak)</option>
                </select>
              </Field>
              <Field label="Deskripsi Singkat">
                <input className="input" value={meta.deskripsi} disabled={readOnly} onChange={e => setMeta(s => ({ ...s, deskripsi: e.target.value }))} />
              </Field>
              <Field label="Status Instrumen">
                <select className="input" value={meta.aktif} disabled={readOnly} onChange={e => setMeta(s => ({ ...s, aktif: Number(e.target.value) }))}>
                  <option value={1}>Aktif (tautan publik dapat dibuka)</option>
                  <option value={0}>Nonaktif</option>
                </select>
              </Field>
              <Field label="Petunjuk Pengerjaan" className="md:col-span-2">
                <textarea className="input" rows={2} value={meta.petunjuk} disabled={readOnly} onChange={e => setMeta(s => ({ ...s, petunjuk: e.target.value }))} />
              </Field>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500">
              Versi bank soal saat ini: <b>{data.instrumen.versi}</b> · {rows.length} butir ·
              kategori tersedia: {kategori.map(k => `${k.key} (${k.label})`).join(', ')}
            </p>
          </Card>

          <Card title="Bank Soal / Pernyataan"
            subtitle="Setiap butir wajib dikaitkan dengan kategori analisis agar perhitungan hasil akurat."
            right={!readOnly ? <button className="btn-soft btn-sm" onClick={tambah} data-tambah-butir><Plus size={13} /> Tambah Butir</button> : null}>
            {!rows.length ? <Empty icon={Wand2} title="Belum ada butir" desc="Tambahkan butir atau gunakan import template Excel." /> : (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2">
                <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                    checked={semuaTerpilih} disabled={readOnly}
                    onChange={e => setPilih(e.target.checked ? idTersimpan : [])} data-butir-all="1" />
                  Pilih Semua
                </label>
                <span className="text-[12px] font-semibold text-slate-500">
                  Terpilih: <b className="text-orange-700" data-butir-count>{pilih.length}</b>
                </span>
                {pilih.length ? <button className="chip !py-0.5 hover:!border-orange-300" onClick={() => setPilih([])}>Bersihkan</button> : null}
                <button className="btn-danger btn-sm ml-auto" disabled={!pilih.length || busyHapus || readOnly}
                  onClick={hapusTerpilih} data-butir-hapus="1">
                  {busyHapus ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Terpilih
                </button>
              </div>
            )}
            {!rows.length ? null : (
              <div className="tbl-wrap" style={{ maxHeight: '62vh' }}>
                <table className="tbl" data-tbl="bank-soal">
                  <thead>
                    <tr>
                      <th className="w-9"></th><th className="w-10">#</th><th className="min-w-[280px]">Pernyataan</th>
                      <th className="min-w-[140px]">Kategori Analisis</th><th className="min-w-[130px]">Indikator</th>
                      <th className="c w-16">Aktif</th><th className="c w-16">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id || 'new-' + i} className={r.id && pilih.includes(r.id) ? 'bg-orange-50/60' : ''}>
                        <td className="c">
                          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" data-butir-item={r.id || ''}
                            disabled={!r.id || readOnly} checked={!!r.id && pilih.includes(r.id)}
                            onChange={() => setPilih(l => l.includes(r.id) ? l.filter(x => x !== r.id) : [...l, r.id])} />
                        </td>
                        <td className="c font-bold text-slate-400">{i + 1}</td>
                        <td>
                          <textarea className="input !min-h-[44px] !py-1.5 text-[12.5px]" rows={2} value={r.teks} disabled={readOnly}
                            onChange={e => ubah(i, 'teks', e.target.value)} data-butir-teks={i} />
                        </td>
                        <td>
                          <select className="input !py-1.5 text-[12px]" value={r.kategori} disabled={readOnly}
                            onChange={e => ubah(i, 'kategori', e.target.value)} data-butir-kategori={i}>
                            <option value="">— pilih —</option>
                            {kategori.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="input !py-1.5 text-[12px]" value={r.indikator || ''} disabled={readOnly}
                            onChange={e => ubah(i, 'indikator', e.target.value)} placeholder="mis. Konsentrasi" />
                        </td>
                        <td className="c">
                          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={!!r.aktif} disabled={readOnly}
                            onChange={e => ubah(i, 'aktif', e.target.checked ? 1 : 0)} />
                        </td>
                        <td className="c">
                          <button className="btn-danger btn-sm !px-2" onClick={() => hapus(r, i)} disabled={readOnly} data-hapus-butir={i}>
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!readOnly ? (
                <button className="btn-primary btn-sm" onClick={simpan} disabled={busy}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan &amp; Perbarui Bank Soal
                </button>
              ) : null}
              <span className="text-[11.5px] text-slate-500">
                Menyimpan akan menaikkan versi bank soal. Hasil asesmen yang sudah masuk tetap memakai versi lamanya.
              </span>
            </div>
          </Card>

          <Alert tone="info" title="Kategori analisis otomatis">
            {kode === 'akpd' && 'Setiap pernyataan dikelompokkan ke Bidang Layanan (Pribadi, Sosial, Belajar, Karir) dan dihitung IR (Intensitas Kebutuhan) dari skala 1–4.'}
            {kode === 'riasec' && 'Setiap butir diberi kode Holland (R, I, A, S, E, C) agar akumulasi skor masuk ke tipe karir yang tepat.'}
            {kode === 'gaya' && 'Setiap butir dikategorikan ke modalitas Visual, Auditorial, atau Kinestetik untuk menghitung persentase kecenderungan belajar.'}
            {kode === 'kesulitan' && 'Setiap butir dikategorikan ke faktor Internal atau Eksternal untuk merekomendasikan jenis layanan konseling yang tepat.'}
          </Alert>
        </>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} size="lg"
        title="Pratinjau Import Bank Soal" subtitle={impor?.filename || ''}
        footer={<>
          <button className="btn-ghost" onClick={() => setPreview(null)}>Batal</button>
          <button className="btn-primary" onClick={commitImpor} disabled={busy} data-commit-import-soal>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Simpan {preview?.siap || 0} Butir
          </button>
        </>}>
        {preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">{preview.total} baris</span>
              <span className="chip !border-emerald-200 !text-emerald-700">{preview.siap} siap</span>
              {preview.total - preview.siap ? <span className="chip !border-rose-200 !text-rose-700">{preview.total - preview.siap} error</span> : null}
              <div className="ml-auto flex gap-1.5">
                <button className={cx('chip', modeImpor === 'tambah' && '!border-orange-300 !bg-orange-50 !text-orange-700')}
                  onClick={() => setModeImpor('tambah')}>Tambah ke bank soal</button>
                <button className={cx('chip', modeImpor === 'ganti' && '!border-orange-300 !bg-orange-50 !text-orange-700')}
                  onClick={() => setModeImpor('ganti')}>Ganti semua butir</button>
              </div>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: '46vh' }}>
              <table className="tbl">
                <thead><tr><th>#</th><th>Pernyataan</th><th>Kategori</th><th>Indikator</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.baris} className={r.error ? 'bg-rose-50/50' : ''}>
                      <td className="c">{r.baris}</td>
                      <td className="text-[12px]">{r.teks}</td>
                      <td className="text-[11.5px]">{r.kategori_label || r.kategori || '-'}</td>
                      <td className="text-[11.5px]">{r.indikator || '-'}</td>
                      <td className="text-[11px]">{r.error ? <span className="font-semibold text-rose-700">{r.error}</span> : <span className="font-semibold text-emerald-700">Siap</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-slate-500">Baris error tidak disimpan. Import akan menaikkan versi bank soal.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
