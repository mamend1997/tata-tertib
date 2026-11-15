import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, CheckCircle2, ChevronDown, Clock, Download, FileSignature, FileText, Filter,
  HeartHandshake, Loader2, MoreVertical, Paperclip, Pencil, Plus, Printer, Save, Settings2,
  Trash2, Users, X
} from 'lucide-react';
import { api, compressImage, docUrl, openDoc, tgl, tglPendek, waktu } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';
import MultiStudentPicker from '../components/MultiStudentPicker';

const KATEGORI = [
  { key: 'semua', label: 'Semua' },
  { key: 'dasar', label: 'Layanan Dasar' },
  { key: 'individual', label: 'Perencanaan Individual' },
  { key: 'responsif', label: 'Layanan Responsif' }
];
const KAT_LABEL = { dasar: 'Layanan Dasar', individual: 'Perencanaan Individual', responsif: 'Layanan Responsif' };

const KOSONG = {
  id: 0, jenis_id: '', tanggal: new Date().toISOString().slice(0, 10), jam: '',
  kelas_ids: [], siswa_ids: [], topik: '', tujuan: '', uraian: '', hasil: '',
  tindak_lanjut: '', tempat: '', foto: '', foto_nama: '', hapus_foto: 0
};

export default function ProgramBK({ ctx }) {
  const { can, toast } = ctx;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kategori, setKategori] = useState('semua');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...KOSONG });
  const [busy, setBusy] = useState(false);
  const [settingOpen, setSettingOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [menuId, setMenuId] = useState(0);
  const [pilih, setPilih] = useState([]);
  const [busyHapus, setBusyHapus] = useState(false);
  const fileRef = useRef(null);
  const [ttd, setTtd] = useState({ nama: '', nip: '', jabatan: 'Koordinator BK', guru_nama: '' });
  useEffect(() => { setPilih([]); }, [kategori, q]);
  const [jenisForm, setJenisForm] = useState({ id: 0, nama: '', kategori: 'responsif', sasaran: 'siswa', aktif: 1 });
  const readOnly = !can('bk_layanan', 'write');

  const load = useCallback(() => {
    setLoading(true);
    api('/api/bk/layanan?kategori=' + (kategori === 'semua' ? '' : kategori) + '&q=' + encodeURIComponent(q))
      .then(r => {
        setData(r);
        setTtd(r.ttd || ttd);
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, [kategori, q]);
  useEffect(load, [load]);

  const jenis = data?.jenis || [];
  const jenisAktif = useMemo(() => jenis.filter(j => j.aktif), [jenis]);
  const jenisTerpilih = jenis.find(j => Number(j.id) === Number(form.jenis_id)) || null;
  const sasaranMode = jenisTerpilih ? jenisTerpilih.sasaran : 'siswa';

  function baru() {
    setForm({ ...KOSONG, jenis_id: jenisAktif[0] ? jenisAktif[0].id : '', tanggal: new Date().toISOString().slice(0, 10) });
    setFormOpen(true);
  }
  function edit(r) {
    setForm({
      id: r.id, jenis_id: r.jenis_id, tanggal: r.tanggal, jam: r.jam || '',
      kelas_ids: r.kelas_ids || [], siswa_ids: r.siswa_ids || [],
      topik: r.topik || '', tujuan: r.tujuan || '', uraian: r.uraian || '', hasil: r.hasil || '',
      tindak_lanjut: r.tindak_lanjut || '', tempat: r.tempat || '', foto: '', foto_nama: '', hapus_foto: 0,
      foto_url: r.foto_url || ''
    });
    setFormOpen(true);
  }

  async function pilihFoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const out = await compressImage(file, { maxKb: 900, maxSide: 1400 });
      if (!out) return toast.err('Foto tidak dapat dibaca.');
      setForm(s => ({ ...s, foto: out.dataUrl || ('data:image/webp;base64,' + out.base64), foto_nama: out.filename, hapus_foto: 0 }));
    } catch (err) { toast.err(err.message); }
  }

  async function simpan(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form };
      if (body.foto && /^data:/.test(body.foto)) body.foto = body.foto.replace(/^data:[^,]*,/, '');
      const r = await api('/api/bk/layanan/save', { method: 'POST', body });
      toast.ok(r.pesan || 'Layanan BK tersimpan.');
      setFormOpen(false);
      load();
    } catch (err) { toast.err(err.message); }
    finally { setBusy(false); }
  }

  async function hapus(r) {
    if (!window.confirm(`Hapus catatan layanan "${r.topik}"? Data dipindahkan ke Kotak Sampah.`)) return;
    try {
      const out = await api('/api/bk/layanan/' + r.id, { method: 'DELETE' });
      toast.ok(out.pesan || 'Catatan layanan dihapus.');
      setMenuId(0);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function hapusTerpilih() {
    if (!pilih.length) return;
    if (!window.confirm(`Hapus ${pilih.length} riwayat layanan BK terpilih? Data dipindahkan ke Kotak Sampah (dapat dipulihkan).`)) return;
    setBusyHapus(true);
    try {
      const r = await api('/api/bk/layanan/delete-masal', { method: 'POST', body: { ids: pilih } });
      toast.ok(r.pesan || 'Riwayat layanan dihapus.');
      setPilih([]);
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusyHapus(false); }
  }

  async function simpanTtd() {
    setBusy(true);
    try {
      const r = await api('/api/bk/ttd', { method: 'POST', body: ttd });
      toast.ok(r.pesan || 'Pengaturan tanda tangan tersimpan.');
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }

  async function simpanJenis() {
    if (!jenisForm.nama.trim()) return toast.err('Nama jenis layanan wajib diisi.');
    setBusy(true);
    try {
      const r = await api('/api/bk/jenis/save', { method: 'POST', body: jenisForm });
      toast.ok(r.pesan || 'Jenis layanan tersimpan.');
      setJenisForm({ id: 0, nama: '', kategori: 'responsif', sasaran: 'siswa', aktif: 1 });
      load();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  }
  async function hapusJenis(j) {
    if (!window.confirm(`Hapus jenis layanan "${j.nama}"?`)) return;
    try {
      const r = await api('/api/bk/jenis/delete', { method: 'POST', body: { id: j.id } });
      toast.ok(r.pesan || 'Jenis layanan dihapus.');
      load();
    } catch (e) { toast.err(e.message); }
  }

  const rows = data?.rows || [];
  const counts = data?.counts || { semua: 0, dasar: 0, individual: 0, responsif: 0 };
  const totalSiswa = rows.reduce((a, r) => a + (r.siswa_ids?.length || 0), 0);

  return (
    <div className="space-y-4" data-page="program-bk">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Program Layanan BK</h2>
          <p className="text-[12.5px] text-slate-500">Catat dan pantau layanan bimbingan konseling komprehensif.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setSettingOpen(true)}>
            <FileSignature size={14} /> Pengaturan Tanda Tangan
          </button>
          <a className="btn-ghost btn-sm" href={docUrl('/api/bk/layanan/export?kategori=' + (kategori === 'semua' ? '' : kategori))} data-export-bk>
            <Download size={14} /> Excel
          </a>
          <button className="btn-ghost btn-sm" onClick={() => openDoc('/api/bk/layanan/cetak?kategori=' + (kategori === 'semua' ? '' : kategori))} data-cetak-bk>
            <Printer size={14} /> Cetak / Simpan PDF
          </button>
          <a className="btn-ghost btn-sm" href={docUrl('/api/bk/layanan/word?kategori=' + (kategori === 'semua' ? '' : kategori))} data-word-bk>
            <Download size={14} /> Word (.docx)
          </a>
          {!readOnly ? (
            <button className="btn-primary !bg-blue-600 !border-blue-600 hover:!brightness-95" onClick={baru} data-catat-layanan>
              <Plus size={15} /> Catat Layanan
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Layanan" value={counts.semua} sub="seluruh kategori" icon={HeartHandshake} tone="orange" />
        <Stat label="Layanan Dasar" value={counts.dasar || 0} sub="klasikal & kelompok" icon={Users} tone="sky" />
        <Stat label="Perencanaan Individual" value={counts.individual || 0} sub="pendidikan/karir/pribadi" icon={FileText} tone="violet" />
        <Stat label="Layanan Responsif" value={counts.responsif || 0} sub="konseling & mediasi" icon={HeartHandshake} tone="rose" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="tabs">
          {KATEGORI.map(k => (
            <button key={k.key} className={cx('tab', kategori === k.key && 'active !text-blue-700')} onClick={() => setKategori(k.key)}
              data-kategori-bk={k.key}>
              {k.label}{k.key !== 'semua' ? ` (${counts[k.key] || 0})` : ` (${counts.semua || 0})`}
            </button>
          ))}
        </div>
        <input className="input ml-auto !w-auto min-w-[220px]" placeholder="Cari topik / jenis layanan…"
          value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2">
        <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">
          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
            checked={rows.length > 0 && pilih.length === rows.length} disabled={readOnly}
            onChange={e => setPilih(e.target.checked ? rows.map(r => r.id) : [])} data-layanan-all="1" />
          Pilih Semua
        </label>
        <span className="text-[12px] font-semibold text-slate-500">
          Terpilih: <b className="text-orange-700" data-layanan-count>{pilih.length}</b>
        </span>
        {pilih.length ? <button className="chip !py-0.5 hover:!border-orange-300" onClick={() => setPilih([])}>Bersihkan</button> : null}
        <button className="btn-danger btn-sm ml-auto" disabled={!pilih.length || busyHapus || readOnly || !can('bk_layanan', 'delete')}
          onClick={hapusTerpilih} data-layanan-hapus="1">
          {busyHapus ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Terpilih
        </button>
      </div>

      {loading ? <Spinner /> : !rows.length ? (
        <Card>
          <Empty icon={HeartHandshake} title="Belum ada catatan layanan"
            desc="Klik “+ Catat Layanan” untuk mendokumentasikan bimbingan klasikal, konseling, mediasi, kunjungan rumah, dan layanan lainnya." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-list-bk>
          {rows.map(r => (
            <div key={r.id} className={cx('card p-4', pilih.includes(r.id) && 'ring-2 ring-orange-300')}>
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-orange-600" data-layanan-item={r.id}
                  checked={pilih.includes(r.id)} disabled={readOnly}
                  aria-label={`Pilih layanan ${r.topik || ''}`}
                  onChange={() => setPilih(l => l.includes(r.id) ? l.filter(x => x !== r.id) : [...l, r.id])} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cx('badge',
                      r.kategori === 'dasar' ? 'badge-pantau' : r.kategori === 'individual' ? 'badge-prestasi' : 'badge-perhatian')}>
                      {r.jenis_nama}
                    </span>
                    <span className="chip !py-0.5"><Users size={11} /> {r.siswa_ids?.length || 0} siswa</span>
                    {r.kelas_ids?.length ? <span className="chip !py-0.5">{r.kelas_ids.length} kelas</span> : null}
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-extrabold text-slate-800">{r.topik}</h3>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-slate-500">{r.tujuan || r.uraian || '-'}</p>
                </div>
                <div className="relative shrink-0">
                  <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setMenuId(menuId === r.id ? 0 : r.id)}>
                    <MoreVertical size={16} />
                  </button>
                  {menuId === r.id ? (
                    <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold hover:bg-slate-50" onClick={() => { setDetail(r); setMenuId(0); }}>
                        <FileText size={13} /> Lihat Detail
                      </button>
                      {!readOnly ? (
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold hover:bg-slate-50" onClick={() => { edit(r); setMenuId(0); }}>
                          <Pencil size={13} /> Edit Catatan
                        </button>
                      ) : null}
                      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold hover:bg-slate-50" onClick={() => { openDoc('/api/bk/layanan/' + r.id + '/cetak'); setMenuId(0); }}>
                        <Printer size={13} /> Cetak / Simpan PDF
                      </button>
                      <a className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold hover:bg-slate-50"
                        href={docUrl('/api/bk/layanan/' + r.id + '/word')} data-word-bk-row={r.id}>
                        <Download size={13} /> Download Word
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 space-y-0.5 text-[11.5px] text-slate-500">
                <p className="flex items-center gap-1.5"><CalendarDays size={12} /> {tgl(r.tanggal, { long: true })}{r.jam ? ` · ${r.jam}` : ''}</p>
                <p className="flex items-center gap-1.5"><Users size={12} /> {[r.kelas_nama, (r.siswa_detail || []).map(s => s.nama).join(', ')].filter(Boolean).join(' · ') || '-'}</p>
                <p className="flex items-center gap-1.5"><UserRoundIcon /> Guru pelapor: <b className="font-semibold text-slate-600">{r.oleh_nama || '-'}</b></p>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button className="btn-ghost btn-sm" onClick={() => openDoc('/api/bk/layanan/' + r.id + '/cetak')}><Printer size={12} /> Cetak PDF</button>
                <a className="btn-ghost btn-sm" href={docUrl('/api/bk/layanan/' + r.id + '/word')}><Download size={12} /> Word</a>
                {!readOnly && can('bk_layanan', 'delete') ? (
                  <button className="btn-danger btn-sm" onClick={() => hapus(r)}><Trash2 size={12} /> Hapus</button>
                ) : null}
                {r.foto_url ? (
                  <a className="btn-ghost btn-sm" href={r.foto_url} target="_blank" rel="noreferrer"><Paperclip size={12} /> Foto</a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- Modal form ---------- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} size="lg"
        title={form.id ? 'Ubah Catatan Layanan BK' : 'Catat Layanan BK'}
        subtitle="Isi detail layanan bimbingan konseling yang diberikan."
        footer={<>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Batal</button>
          <button className="btn-primary" onClick={simpan} disabled={busy} data-simpan-layanan-bk>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan Layanan
          </button>
        </>}>
        <form className="space-y-3" onSubmit={simpan}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Jenis Layanan" required className="sm:col-span-2">
              <select className="input" required value={form.jenis_id} onChange={e => setForm(s => ({ ...s, jenis_id: e.target.value }))} data-jenis-layanan>
                <option value="">— pilih jenis layanan —</option>
                {['dasar', 'individual', 'responsif'].map(k => (
                  <optgroup key={k} label={KAT_LABEL[k]}>
                    {jenisAktif.filter(j => j.kategori === k).map(j => <option key={j.id} value={j.id}>{j.nama}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Tanggal" required>
              <input type="date" className="input" value={form.tanggal} onChange={e => setForm(s => ({ ...s, tanggal: e.target.value }))} required />
            </Field>
          </div>

          {sasaranMode !== 'siswa' ? (
            <Field label="Sasaran Kelas" hint="Boleh lebih dari satu kelas.">
              <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2" data-kelas-bk>
                <div className="grid gap-1 sm:grid-cols-2">
                  {(data?.kelas || []).map(k => (
                    <label key={k.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-slate-50">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-orange-600"
                        checked={form.kelas_ids.includes(k.id)}
                        onChange={e => setForm(s => ({
                          ...s, kelas_ids: e.target.checked ? [...s.kelas_ids, k.id] : s.kelas_ids.filter(x => x !== k.id)
                        }))} />
                      <span className="truncate">{k.nama}</span>
                    </label>
                  ))}
                </div>
              </div>
            </Field>
          ) : null}

          {sasaranMode !== 'kelas' ? (
            <MultiStudentPicker label="Sasaran Siswa" value={form.siswa_ids} all
              onChange={ids => setForm(s => ({ ...s, siswa_ids: ids }))} />
          ) : null}

          <Field label="Topik / Tema Bimbingan" required>
            <input className="input" required placeholder="Contoh: Berkelahi, kesulitan belajar, perencanaan karier…"
              value={form.topik} onChange={e => setForm(s => ({ ...s, topik: e.target.value }))} data-topik-bk />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tujuan Layanan">
              <input className="input" placeholder="Tujuan yang ingin dicapai"
                value={form.tujuan} onChange={e => setForm(s => ({ ...s, tujuan: e.target.value }))} />
            </Field>
            <Field label="Tempat (opsional)">
              <input className="input" placeholder="Ruang BK, kelas, rumah siswa…"
                value={form.tempat} onChange={e => setForm(s => ({ ...s, tempat: e.target.value }))} />
            </Field>
          </div>
          <Field label="Uraian Kegiatan">
            <textarea className="input" rows={3} placeholder="Narasi kegiatan yang dilakukan…"
              value={form.uraian} onChange={e => setForm(s => ({ ...s, uraian: e.target.value }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hasil yang Dicapai">
              <textarea className="input" rows={2} value={form.hasil} onChange={e => setForm(s => ({ ...s, hasil: e.target.value }))} />
            </Field>
            <Field label="Tindak Lanjut (opsional)">
              <textarea className="input" rows={2} value={form.tindak_lanjut} onChange={e => setForm(s => ({ ...s, tindak_lanjut: e.target.value }))} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jam (opsional)">
              <input type="time" className="input" value={form.jam} onChange={e => setForm(s => ({ ...s, jam: e.target.value }))} />
            </Field>
            <Field label="Foto Bukti (opsional)" hint="Gambar otomatis dikompres sebelum diunggah.">
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pilihFoto} />
                <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  <Paperclip size={13} /> Pilih Foto
                </button>
                {form.foto || form.foto_url ? (
                  <button type="button" className="btn-danger btn-sm"
                    onClick={() => setForm(s => ({ ...s, foto: '', foto_url: '', hapus_foto: 1 }))}>
                    <X size={12} /> Hapus Foto
                  </button>
                ) : null}
                {form.foto || form.foto_url ? (
                  <img src={form.foto || form.foto_url} alt="bukti" className="h-12 w-16 rounded-lg border border-slate-200 object-cover" />
                ) : null}
              </div>
            </Field>
          </div>
        </form>
      </Modal>

      {/* ---------- Modal detail ---------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="lg"
        title={detail ? detail.topik : ''} subtitle={detail ? `${detail.jenis_nama} · ${tgl(detail.tanggal, { long: true })}${detail.jam ? ' · ' + detail.jam : ''}` : ''}
        footer={<>
          <button className="btn-ghost" onClick={() => setDetail(null)}>Tutup</button>
          {detail ? (
            <>
              <a className="btn-ghost" href={docUrl('/api/bk/layanan/' + detail.id + '/word')}><Download size={14} /> Word</a>
              <button className="btn-primary" onClick={() => openDoc('/api/bk/layanan/' + detail.id + '/cetak')}><Printer size={14} /> Cetak / Simpan PDF</button>
            </>
          ) : null}
        </>}>
        {detail ? (
          <div className="space-y-3 text-[12.5px]">
            <div className="flex flex-wrap gap-1.5">
              <span className="chip">{detail.kategori_label}</span>
              <span className="chip"><Users size={11} /> {detail.siswa_ids?.length || 0} siswa</span>
              {detail.tempat ? <span className="chip">{detail.tempat}</span> : null}
            </div>
            <Info label="Sasaran" value={[detail.kelas_nama, (detail.siswa_detail || []).map(s => s.nama).join(', ')].filter(Boolean).join(' · ') || '-'} />
            <Info label="Tujuan" value={detail.tujuan || '-'} />
            <Info label="Uraian Kegiatan" value={detail.uraian || '-'} multiline />
            <Info label="Hasil yang Dicapai" value={detail.hasil || '-'} multiline />
            <Info label="Tindak Lanjut" value={detail.tindak_lanjut || '-'} />
            <Info label="Dicatat oleh" value={`${detail.oleh_nama || '-'} (${detail.oleh_role || ''})`} />
            {detail.foto_url ? <img src={detail.foto_url} alt="bukti" className="max-h-64 rounded-xl border border-slate-200 object-contain" /> : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------- Modal pengaturan ---------- */}
      <Modal open={settingOpen} onClose={() => setSettingOpen(false)} size="lg"
        title="Pengaturan Program Layanan BK" subtitle="Tanda tangan dokumen cetak & daftar jenis layanan."
        footer={<button className="btn-ghost" onClick={() => setSettingOpen(false)}>Tutup</button>}>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700"><FileSignature size={14} /> Tanda Tangan Dokumen</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Jabatan Penanggung Jawab">
                <input className="input" value={ttd.jabatan || ''} onChange={e => setTtd(s => ({ ...s, jabatan: e.target.value }))} placeholder="Koordinator BK" />
              </Field>
              <Field label="Nama Penanggung Jawab">
                <input className="input" value={ttd.nama || ''} onChange={e => setTtd(s => ({ ...s, nama: e.target.value }))} placeholder="Nama Guru BK" />
              </Field>
              <Field label="NIP">
                <input className="input" value={ttd.nip || ''} onChange={e => setTtd(s => ({ ...s, nip: e.target.value }))} />
              </Field>
              <Field label="Guru Pembimbing (opsional)">
                <input className="input" value={ttd.guru_nama || ''} onChange={e => setTtd(s => ({ ...s, guru_nama: e.target.value }))} />
              </Field>
            </div>
            <button className="btn-primary btn-sm mt-2" onClick={simpanTtd} disabled={busy || readOnly}><Save size={13} /> Simpan Tanda Tangan</button>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700"><Settings2 size={14} /> Jenis Layanan (dapat diedit)</p>
            <div className="tbl-wrap" style={{ maxHeight: '34vh' }}>
              <table className="tbl">
                <thead><tr><th>Nama</th><th>Kategori</th><th>Sasaran</th><th className="c">Status</th><th className="c">Aksi</th></tr></thead>
                <tbody>
                  {jenis.map(j => (
                    <tr key={j.id}>
                      <td className="font-semibold">{j.nama}</td>
                      <td className="text-[11.5px]">{KAT_LABEL[j.kategori]}</td>
                      <td className="text-[11.5px]">{j.sasaran === 'kelas' ? 'Kelas' : j.sasaran === 'keduanya' ? 'Kelas & Siswa' : 'Siswa'}</td>
                      <td className="c">{j.aktif ? <span className="badge badge-aman">Aktif</span> : <span className="badge badge-netral">Nonaktif</span>}</td>
                      <td className="c">
                        <div className="flex justify-center gap-1">
                          <button className="btn-ghost btn-sm !px-2" onClick={() => setJenisForm({ ...j })} disabled={readOnly}><Pencil size={12} /></button>
                          <button className="btn-danger btn-sm !px-2" onClick={() => hapusJenis(j)} disabled={readOnly}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Field label="Nama Jenis Layanan">
                <input className="input" value={jenisForm.nama} onChange={e => setJenisForm(s => ({ ...s, nama: e.target.value }))} placeholder="Contoh: Konseling Individual" />
              </Field>
              <Field label="Kategori">
                <select className="input" value={jenisForm.kategori} onChange={e => setJenisForm(s => ({ ...s, kategori: e.target.value }))}>
                  <option value="dasar">Layanan Dasar</option>
                  <option value="individual">Perencanaan Individual</option>
                  <option value="responsif">Layanan Responsif</option>
                </select>
              </Field>
              <Field label="Sasaran Form">
                <select className="input" value={jenisForm.sasaran} onChange={e => setJenisForm(s => ({ ...s, sasaran: e.target.value }))}>
                  <option value="siswa">Siswa</option>
                  <option value="kelas">Kelas</option>
                  <option value="keduanya">Kelas &amp; Siswa</option>
                </select>
              </Field>
              <div className="flex items-end gap-2">
                <button className="btn-primary btn-sm" onClick={simpanJenis} disabled={busy || readOnly}>
                  {jenisForm.id ? <><Save size={13} /> Perbarui</> : <><Plus size={13} /> Tambah</>}
                </button>
                {jenisForm.id ? <button className="btn-ghost btn-sm" onClick={() => setJenisForm({ id: 0, nama: '', kategori: 'responsif', sasaran: 'siswa', aktif: 1 })}>Batal</button> : null}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function UserRoundIcon() { return <Users size={12} />; }
function Info({ label, value, multiline }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cx('text-[12.5px] text-slate-700', multiline && 'whitespace-pre-wrap')}>{value}</p>
    </div>
  );
}
