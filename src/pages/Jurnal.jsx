import React, { useEffect, useState } from 'react';
import {
  Award, CheckCircle2, Clock, History, Loader2, NotebookPen, Save, TriangleAlert
} from 'lucide-react';
import { api, tgl } from '../api';
import { Alert, Card, Field, Spinner, cx, useToast } from '../ui';
import MultiStudentPicker from '../components/MultiStudentPicker';
import { JenisField, KategoriField, LokasiField, PhotoField } from '../components/FormParts';

const jamNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const todayISO = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* =====================================================================
   BUKU PENGHUBUNG DIGITAL (jurnal harian)
   Wali kelas BOLEH mencatat siswa kelas lain di sini (temuan harian lintas kelas).
   Riwayat jurnal ditampilkan di Dashboard (tidak dicampur pada form input).
   ===================================================================== */
export default function Jurnal({ ctx }) {
  const { can, refreshKey, toast, boot, setPage } = ctx;
  const [kategori, setKategori] = useState([]);
  const [lokasi, setLokasi] = useState([]);
  const [ring, setRing] = useState({ total: 0, hari_ini: 0, pelanggaran: 0, prestasi: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tanggal, setTanggal] = useState(todayISO());
  const [form, setForm] = useState({
    siswa_ids: [], jenis: 'pelanggaran', kategori_ids: [], lokasi: '', jam: jamNow(),
    keterangan: '', tanggal: todayISO(), bukti_url: ''
  });
  const [hasil, setHasil] = useState(null);

  const cfg = boot.settings.jurnal_config || {};
  const set = patch => setForm(f => ({ ...f, ...patch }));

  useEffect(() => {
    Promise.all([api('/api/form-master'), api('/api/jurnal?tanggal=' + tanggal)])
      .then(([m, j]) => {
        setKategori(m.kategori || []);
        setLokasi(m.lokasi || []);
        setRing(j.ringkas || { total: 0, hari_ini: 0, pelanggaran: 0, prestasi: 0 });
      })
      .catch(e => toast.err(e.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function simpan(e) {
    e.preventDefault();
    if (!form.siswa_ids.length) return toast.err('Pilih minimal satu siswa terlebih dahulu.');
    if (!form.kategori_ids.length) return toast.err('Pilih minimal satu kategori poin.');
    setSaving(true);
    try {
      const r = await api('/api/jurnal/save', {
        method: 'POST',
        body: {
          ...form,
          siswa_id: form.siswa_ids[0] || '',
          siswa_ids: form.siswa_ids,
          kategori_id: form.kategori_ids[0] || '',
          kategori_ids: form.kategori_ids
        }
      });
      setHasil(r);
      toast.ok(`Temuan tercatat untuk ${r.jumlah} siswa · ${r.jumlah_kategori} kategori · total ${r.poin} poin.`);
      set({ siswa_ids: [], kategori_ids: [], keterangan: '', jam: jamNow(), bukti_url: '' });
      const j = await api('/api/jurnal?tanggal=' + tanggal);
      setRing(j.ringkas || ring);
    } catch (e2) { toast.err(e2.message); }
    finally { setSaving(false); }
  }

  if (loading) return <Spinner label="Menyiapkan buku penghubung…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Buku Penghubung Digital</h2>
          <p className="text-[12.5px] text-slate-500">
            Pencatatan cepat temuan harian (Guru Piket, Guru Umum, TU, Wali Kelas) — langsung tercatat pada poin siswa.
            Anda dapat mencatat siswa dari kelas mana pun di sini.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip !border-orange-200 !bg-orange-50 !text-orange-700"><Clock size={12} /> {jamNow()} WIB · {tgl(todayISO(), { long: true })}</span>
          <button className="btn-ghost" onClick={() => setPage && setPage('dashboard')} data-go-riwayat="1">
            <History size={15} /> Riwayat Aktivitas
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Mini label="Temuan Hari Ini" value={ring.hari_ini} icon={NotebookPen} tone="orange" />
        <Mini label="Pelanggaran Hari Ini" value={ring.pelanggaran} icon={TriangleAlert} tone="rose" />
        <Mini label="Prestasi Hari Ini" value={ring.prestasi} icon={Award} tone="violet" />
        <Mini label="Total Tercatat" value={ring.total} icon={CheckCircle2} tone="sky" />
      </div>

      {hasil ? (
        <Alert tone="ok" title={`${hasil.jumlah} siswa tercatat · ${hasil.jumlah_kategori || 1} kategori · total ${hasil.poin} poin`}>
          {hasil.sanksi ? `Rekomendasi sanksi siswa terakhir: ${hasil.sanksi.label} (akumulasi poin pelanggaran).` : 'Belum ada rekomendasi sanksi — pertahankan kedisiplinan siswa.'}
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[520px_1fr]">
        <Card title="Catat Temuan Cepat" subtitle="Bisa untuk beberapa siswa sekaligus" className="h-fit">
          {can('jurnal', 'write') ? (
            <form onSubmit={simpan} className="space-y-3" data-form="jurnal">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Tanggal" required>
                  <input type="date" className="input" value={form.tanggal} required data-field="tanggal"
                    onChange={e => set({ tanggal: e.target.value })} />
                </Field>
                <Field label="Jam Temuan" required>
                  <input type="time" className="input" value={form.jam} required data-field="jam"
                    onChange={e => set({ jam: e.target.value })} />
                </Field>
              </div>

              <MultiStudentPicker label="Nama Siswa" required value={form.siswa_ids} all
                onChange={ids => set({ siswa_ids: ids })}
                hint="Semua siswa (lintas kelas) dapat dicatat di buku penghubung." />

              <LokasiField label="Lokasi Temuan" list={lokasi} value={form.lokasi}
                onChange={v => set({ lokasi: v })} required={!!cfg.wajib_lokasi}
                hint="Pilih “Lainnya” untuk menulis lokasi sendiri." />

              <JenisField value={form.jenis} onChange={v => set({ jenis: v })} />

              <KategoriField kategori={kategori} jenis={form.jenis} value={form.kategori_ids}
                onChange={v => set({ kategori_ids: v })} required
                hint="Boleh memilih beberapa kategori sekaligus — total poin dijumlahkan otomatis." />

              <Field label="Keterangan / Kronologi" hint={cfg.wajib_keterangan ? 'Wajib diisi sesuai pengaturan sekolah.' : 'Opsional — boleh dikosongkan.'}>
                <textarea className="input" value={form.keterangan} data-field="keterangan"
                  required={!!cfg.wajib_keterangan}
                  placeholder="Contoh: siswa datang pukul 07.20 tanpa dasi saat gerbang ditutup (opsional)"
                  onChange={e => set({ keterangan: e.target.value })} />
              </Field>

              <PhotoField value={form.bukti_url} onChange={url => set({ bukti_url: url })} settings={boot.settings} />

              <button type="submit" className="btn-primary w-full py-2.5" disabled={saving} data-save="jurnal">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Simpan &amp; Teruskan ke Poin Siswa
              </button>
            </form>
          ) : (
            <Alert tone="info" title="Mode baca saja">Role Anda belum diberi izin mencatat pada buku penghubung.</Alert>
          )}
        </Card>

        <Card title="Panduan Buku Penghubung" subtitle="Alur 8 langkah yang sama dengan Input Kejadian">
          <ol className="space-y-2 text-[12.5px] leading-relaxed text-slate-600">
            {[
              ['Tanggal & Waktu', 'Terisi otomatis, dapat diubah.'],
              ['Nama Siswa', 'Pilih satu atau beberapa siswa sekaligus (multi-select).'],
              ['Lokasi', 'Pilih daftar atau “Lainnya” untuk isian manual.'],
              ['Jenis Temuan', 'Tombol Pelanggaran / Prestasi.'],
              ['Kategori Poin', 'Cari lalu pilih satu atau beberapa kategori — total poin otomatis.'],
              ['Keterangan', 'Opsional.'],
              ['Bukti Foto', 'Opsional.'],
              ['Simpan', 'Temuan langsung menjadi poin siswa & tampil di Dashboard.']
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-2.5 rounded-xl border border-slate-100 px-3 py-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-orange-100 text-[11.5px] font-extrabold text-orange-700">{i + 1}</span>
                <span><b className="text-slate-700">{t}</b><span className="block text-[11.5px] text-slate-500">{d}</span></span>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-sky-900">
            Riwayat jurnal harian & siapa pelapornya kini tampil di <b>Dashboard → Riwayat Aktivitas Siswa</b>,
            lengkap dengan ceklis hapus masal.
          </div>
        </Card>
      </div>
    </div>
  );
}

function Mini({ label, value, icon: Icon, tone }) {
  const tones = {
    orange: 'from-orange-500 to-amber-500', rose: 'from-rose-500 to-orange-500',
    violet: 'from-violet-500 to-fuchsia-500', sky: 'from-sky-500 to-cyan-500'
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', tones[tone])}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-[19px] font-extrabold leading-tight text-slate-800">{value}</p>
      </div>
    </div>
  );
}
