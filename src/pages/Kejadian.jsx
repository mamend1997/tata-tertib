import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Camera, ClipboardList, History, Loader2, Plus, X } from 'lucide-react';
import { api, compressImage } from '../api';
import { Alert, Card, Field, Spinner, cx, useToast } from '../ui';
import MultiStudentPicker from '../components/MultiStudentPicker';
import { JenisField, KategoriField, LokasiField } from '../components/FormParts';

const todayISO = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* =====================================================================
   INPUT KEJADIAN (pelanggaran / prestasi)
   Urutan field (sesuai permintaan):
   1. Tanggal & Waktu · 2. Nama Siswa (multi) · 3. Lokasi (opsi manual)
   4. Jenis Temuan (tombol) · 5. Kategori · 6. Keterangan (opsional)
   7. Bukti foto (opsional) · 8. Simpan
   Riwayat pencatatan TIDAK lagi ditampilkan di sini — lihat Dashboard.
   ===================================================================== */
export default function Kejadian({ ctx }) {
  const { filters, can, boot, toast, bump, setPage } = ctx;
  const [master, setMaster] = useState({ kategori: [], lokasi: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const cfg = boot.settings.form_config || {};
  const jamNow = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const [form, setForm] = useState({
    tanggal: todayISO(), jam: jamNow(), lokasi: '', siswa_ids: [], kategori_ids: [],
    jenis: 'pelanggaran', keterangan: '', bukti_url: ''
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    /* /api/form-master: khusus pilihan FORM — tidak memerlukan izin menu
       "Kategori Poin"/"Data Siswa", jadi Guru Umum & TU tetap bisa mencatat. */
    api('/api/form-master')
      .then(m => setMaster({ kategori: m.kategori, lokasi: m.lokasi || [] }))
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { document.body.classList.add('app-bg'); }, []);

  const set = patch => setForm(f => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    if (!form.siswa_ids.length) return toast.err('Pilih minimal satu siswa terlebih dahulu.');
    if (!form.kategori_ids.length) return toast.err('Pilih minimal satu kategori poin.');
    setSaving(true);
    try {
      const r = await api('/api/kejadian/save', {
        method: 'POST',
        body: {
          ...form,
          siswa_id: form.siswa_ids[0] || '',
          siswa_ids: form.siswa_ids,
          kategori_id: form.kategori_ids[0] || '',
          kategori_ids: form.kategori_ids,
          ta_id: filters.ta
        }
      });
      toast.ok(`Tercatat untuk ${r.jumlah} siswa · ${r.jumlah_kategori} kategori · total ${r.poin} poin.`);
      set({ kategori_ids: [], keterangan: '', bukti_url: '', siswa_ids: [], jam: jamNow() });
      if (fileRef.current) fileRef.current.value = '';
      bump();
    } catch (e2) { toast.err(e2.message); }
    finally { setSaving(false); }
  }

  async function upload(file) {
    if (!file) return;
    const maxKb = Number(boot.settings.upload_max_kb) || 2048;
    setUploading(true);
    try {
      let payload = await compressImage(file, {
        maxKb,
        maxSide: Number(boot.settings.upload_max_side) || 1600,
        quality: Number(boot.settings.upload_jpeg_quality) || 0.82
      });
      if (!payload) {
        if (file.size > maxKb * 1024) throw new Error(`Ukuran berkas melebihi batas ${(maxKb / 1024).toFixed(1)} MB.`);
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
          fr.onerror = rej; fr.readAsDataURL(file);
        });
        payload = { base64: b64, filename: file.name };
      }
      if (payload.bytes && payload.bytes > maxKb * 1024) {
        throw new Error(`Foto masih ${(payload.bytes / 1024 / 1024).toFixed(2)} MB setelah dikompres — batas ${(maxKb / 1024).toFixed(1)} MB.`);
      }
      const r = await api('/api/upload', {
        method: 'POST',
        body: { base64: payload.base64, filename: payload.filename, jenis: 'bukti' }
      });
      set({ bukti_url: r.url });
      toast.ok(`Bukti foto terunggah${payload.bytes ? ` (${Math.round(payload.bytes / 1024)} KB setelah kompresi)` : ''}.`);
    } catch (e) { toast.err(e.message); }
    finally { setUploading(false); }
  }

  if (loading) return <Spinner label="Menyiapkan formulir kejadian…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Input Kejadian &amp; Poin Siswa</h2>
          <p className="text-[12.5px] text-slate-500">
            Catat pelanggaran maupun prestasi — poin siswa &amp; status disiplin diperbarui otomatis.
            Riwayat pencatatan kini tersedia di <b>Dashboard</b>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11.5px] font-semibold text-orange-700">
            <CalendarDays size={14} />
            TP {((boot.tahun || []).find(t => t.id === Number(filters.ta)) || {}).nama || '-'}
          </div>
          <button className="btn-ghost" onClick={() => setPage && setPage('dashboard')} data-go-riwayat="1">
            <History size={15} /> Riwayat Aktivitas
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[520px_1fr]">
        <Card title="Form Input Kejadian" subtitle="Semua kolom bertanda * wajib diisi" className="h-fit">
          {can('kejadian', 'write') ? (
            <form onSubmit={submit} className="space-y-3" data-form="kejadian">
              {/* 1. tanggal & waktu */}
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Tanggal" required>
                  <input type="date" className="input" value={form.tanggal} required data-field="tanggal"
                    onChange={e => set({ tanggal: e.target.value })} />
                </Field>
                <Field label="Jam Kejadian" hint="Untuk analitik jam rawan">
                  <input type="time" className="input" value={form.jam} data-field="jam"
                    onChange={e => set({ jam: e.target.value })} />
                </Field>
              </div>

              {/* 2. nama siswa (multi) */}
              <MultiStudentPicker label="Nama Siswa" required value={form.siswa_ids} all={false}
                onChange={ids => set({ siswa_ids: ids })}
                hint="Bisa menambahkan beberapa siswa sekaligus. Ketik 3 huruf nama/NIS lalu pilih dari daftar." />

              {/* 3. lokasi (dropdown + manual) */}
              <LokasiField label="Lokasi Temuan" list={master.lokasi} value={form.lokasi}
                onChange={v => set({ lokasi: v })}
                hint="Pilih “Lainnya” bila lokasi tidak ada di daftar → kolom isian manual muncul otomatis." />

              {/* 4. jenis temuan (tombol) */}
              <JenisField value={form.jenis} onChange={v => set({ jenis: v })} />

              {/* 5. kategori (boleh lebih dari satu) */}
              <KategoriField kategori={master.kategori} jenis={form.jenis} value={form.kategori_ids}
                onChange={v => set({ kategori_ids: v })}
                required
                hint="Klik satu atau beberapa kategori — poin dijumlahkan otomatis (bisa pelanggaran + prestasi sekaligus)." />

              {/* 6. keterangan (opsional) */}
              <Field label="Keterangan / Kronologi" hint={cfg.wajib_keterangan ? 'Wajib diisi sesuai pengaturan sekolah.' : 'Opsional — boleh dikosongkan.'}>
                <textarea className="input" value={form.keterangan} data-field="keterangan"
                  placeholder={cfg.placeholder_keterangan || 'Kronologi kejadian (opsional)…'}
                  required={!!cfg.wajib_keterangan} onChange={e => set({ keterangan: e.target.value })} />
              </Field>

              {/* 7. bukti foto (opsional) */}
              {cfg.tampilkan_bukti ? (
                <Field label="Bukti Foto (opsional)" hint={`JPG/PNG/WebP — otomatis dikompres (maks ${(Number(boot.settings.upload_max_kb) || 2048) / 1024} MB).`}>
                  <div className="flex items-center gap-2">
                    <label className={cx('btn-ghost flex-1 cursor-pointer', uploading && 'opacity-60')}>
                      {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                      {form.bukti_url ? 'Ganti Foto' : 'Pilih Foto'}
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" disabled={uploading}
                        onChange={e => upload(e.target.files?.[0])} />
                    </label>
                    {form.bukti_url ? (
                      <button type="button" className="btn-danger btn-sm"
                        onClick={() => { set({ bukti_url: '' }); if (fileRef.current) fileRef.current.value = ''; }}>
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>
                  {form.bukti_url ? <img src={form.bukti_url} alt="Bukti" className="mt-2 h-24 w-full rounded-xl object-cover ring-1 ring-slate-200" /> : null}
                </Field>
              ) : null}

              {/* 8. simpan */}
              <button type="submit" disabled={saving} className="btn-primary w-full py-2.5" data-save="kejadian">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Simpan Kejadian
              </button>
            </form>
          ) : (
            <Alert tone="info" title="Mode baca saja">Role Anda tidak memiliki izin mencatat kejadian. Hubungi administrator.</Alert>
          )}
        </Card>

        <Card title="Panduan Pengisian" subtitle="Alur 8 langkah pencatatan kejadian">
          <ol className="space-y-2 text-[12.5px] leading-relaxed text-slate-600">
            {[
              ['Tanggal & Waktu', 'Tanggal otomatis hari ini — ubah bila mencatat kejadian sebelumnya.'],
              ['Nama Siswa', 'Ketik minimal 3 huruf lalu pilih dari dropdown. Bisa menambahkan lebih dari satu siswa (masal).'],
              ['Lokasi', 'Pilih dari daftar, atau pilih “Lainnya” untuk menulis lokasi sendiri.'],
              ['Jenis Temuan', 'Tombol Pelanggaran / Prestasi — daftar kategori menyesuaikan otomatis.'],
              ['Kategori Poin', 'Bisa memilih BEBERAPA kategori sekaligus; total poin dijumlahkan otomatis.'],
              ['Keterangan', 'Opsional — tuliskan kronologi bila diperlukan.'],
              ['Bukti Foto', 'Opsional — foto otomatis dikompres sebelum diunggah.'],
              ['Simpan', 'Poin siswa langsung diperbarui; riwayat lengkap ada di Dashboard.']
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-2.5 rounded-xl border border-slate-100 px-3 py-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-orange-100 text-[11.5px] font-extrabold text-orange-700">{i + 1}</span>
                <span><b className="text-slate-700">{t}</b><span className="block text-[11.5px] text-slate-500">{d}</span></span>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
            <b>Catatan Wali Kelas:</b> pada menu Input Kejadian, hanya siswa kelas yang Anda ampu yang dapat dicatat.
            Untuk mencatat siswa kelas lain, gunakan menu <b>Buku Penghubung Digital</b>.
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-slate-500">
            <ClipboardList size={13} /> Riwayat pencatatan & jurnal harian ditampilkan khusus di Dashboard.
          </div>
        </Card>
      </div>
    </div>
  );
}
