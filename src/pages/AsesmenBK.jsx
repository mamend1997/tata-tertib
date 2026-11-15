import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3, BookOpenCheck, CheckCircle2, ClipboardCheck, Download, ExternalLink, FileSpreadsheet,
  Loader2, Link2, Printer, QrCode, RefreshCw, RotateCcw, Settings2, Sparkles, Trash2, Users
} from 'lucide-react';
import { api, docUrl, openDoc } from '../api';
import { Alert, Card, Empty, Field, Modal, Spinner, Stat, cx, useToast } from '../ui';

const IKON = { akpd: ClipboardCheck, riasec: Sparkles, gaya: BookOpenCheck, kesulitan: BarChart3 };

export default function AsesmenBK({ ctx }) {
  const { can, toast, setPage } = ctx;
  const [inst, setInst] = useState(null);
  const [kode, setKode] = useState('akpd');
  const [kelas, setKelas] = useState('');
  const [analisis, setAnalisis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [tab, setTab] = useState('hasil');
  const [pilih, setPilih] = useState([]);       // id hasil asesmen terpilih
  const [busyHapus, setBusyHapus] = useState(false);
  const readOnly = !can('asesmen', 'write');

  const loadInst = useCallback(() => {
    api('/api/asesmen').then(r => {
      setInst(r);
      if (!r.rows.some(x => x.kode === kode) && r.rows[0]) setKode(r.rows[0].kode);
    }).catch(e => toast.err(e.message));
  }, [kode]);
  useEffect(loadInst, [loadInst]);

  useEffect(() => { setPilih([]); }, [kode, kelas]);

  const loadAnalisis = useCallback(() => {
    setLoading(true);
    api('/api/asesmen/analisis?kode=' + kode + (kelas ? '&kelas=' + kelas : ''))
      .then(r => setAnalisis(r)).catch(e => toast.err(e.message)).finally(() => setLoading(false));
  }, [kode, kelas]);
  useEffect(loadAnalisis, [loadAnalisis]);

  const loadLink = useCallback(() => {
    api('/api/asesmen/link?kode=' + kode).then(r => setLink(r)).catch(() => setLink(null));
  }, [kode]);
  useEffect(loadLink, [loadLink]);

  const row = (inst?.rows || []).find(r => r.kode === kode);
  const kategori = inst?.kategori?.[kode] || [];

  async function ubahLink(rotate) {
    setBusy(rotate ? 'rotate' : 'toggle');
    try {
      const r = await api('/api/asesmen/link', {
        method: 'POST',
        body: rotate ? { kode, rotate: 1 } : { kode, aktif: link && link.aktif ? 0 : 1 }
      });
      setLink(r);
      toast.ok(r.pesan);
      loadInst();
    } catch (e) { toast.err(e.message); }
    finally { setBusy(''); }
  }
  async function hapusHasil() {
    if (!pilih.length) return;
    if (!window.confirm(`Hapus ${pilih.length} riwayat asesmen terpilih? Siswa yang bersangkutan dapat mengisi ulang instrumen ini.`)) return;
    setBusyHapus(true);
    try {
      const r = await api('/api/asesmen/hasil/delete', { method: 'POST', body: { ids: pilih } });
      toast.ok(r.pesan || 'Riwayat asesmen dihapus.');
      setPilih([]);
      loadAnalisis();
      loadInst();
    } catch (e) { toast.err(e.message); }
    finally { setBusyHapus(false); }
  }

  function unduhQr() {
    if (!link?.qr?.png) return toast.err('QR belum siap.');
    const a = document.createElement('a');
    a.href = link.qr.png; a.download = `qr-asesmen-${kode}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* Hanya pakai analisis yang KODENYA sama dengan instrumen aktif — respons lama
     (mis. saat pengguna berpindah tab cepat) tidak boleh dirender dengan bentuk lain,
     karena struktur AKPD (bidang) berbeda dengan instrumen lain (distribusi). */
  const analisisAktif = analisis && analisis.kode === kode ? analisis : null;
  const a = analisisAktif?.analisis;
  const isAkpd = kode === 'akpd';
  const sisi = isAkpd ? (s) => (s.bidang || []) : (s) => (s.rincian || []);
  const kelasAnalisis = analisisAktif?.kelas_analisis || [];

  return (
    <div className="space-y-4" data-page="asesmen-bk">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-extrabold text-slate-800">Asesmen Siswa BK</h2>
          <p className="text-[12.5px] text-slate-500">
            AKPD, RIASEC, Gaya Belajar, dan Kesulitan Belajar — pengisian mandiri lewat tautan/QR, hasil terekam otomatis.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={docUrl('/api/asesmen/export?kode=' + kode + (kelas ? '&kelas=' + kelas : ''))} data-export-asesmen>
            <FileSpreadsheet size={15} /> Excel
          </a>
          <button className="btn-soft" onClick={() => openDoc('/api/asesmen/cetak?kode=' + kode + (kelas ? '&kelas=' + kelas : ''))} data-cetak-asesmen>
            <Printer size={15} /> Cetak PDF
          </button>
          {can('asesmen_soal', 'view') ? (
            <button className="btn-primary" onClick={() => setPage('asesmen_soal')}>
              <Settings2 size={15} /> Pengaturan Soal
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(inst?.rows || []).map(r => {
          const Ikon = IKON[r.kode] || ClipboardCheck;
          return (
            <button key={r.kode} onClick={() => { setKode(r.kode); setTab('hasil'); }}
              className={cx('kpi flex items-start gap-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg',
                kode === r.kode && 'ring-2 ring-orange-300')} data-instrumen={r.kode}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white">
                <Ikon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-extrabold leading-tight text-slate-800">{r.nama}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{r.jumlah_soal} butir · {r.jumlah_hasil} responden</p>
                <p className="mt-1 text-[10.5px] font-semibold text-slate-400">Versi bank soal {r.versi}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title={`Tautan & QR Publik — ${row?.nama || ''}`}
          subtitle="Bagikan ke siswa untuk pengisian mandiri tanpa login. Setiap siswa hanya dapat mengisi satu kali (validasi NISN).">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="mx-auto grid h-[188px] w-[188px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
              data-qr-asesmen>
              {link?.qr?.svg ? (
                <div className="h-full w-full cursor-zoom-in [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                  role="button" tabIndex={0} title="Perbesar QR"
                  onClick={() => setQrOpen(true)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setQrOpen(true); }}
                  dangerouslySetInnerHTML={{ __html: link.qr.svg }} />
              ) : <Loader2 size={20} className="animate-spin text-slate-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
                <Link2 size={13} className="text-slate-400" />
                <input readOnly value={link?.url || ''} className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-slate-600 outline-none" data-link-asesmen />
                <button className="btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(link?.url || '').then(() => toast.ok('Tautan disalin.'), () => toast.err('Gagal menyalin.'))}>
                  Salin
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cx('badge', link?.aktif ? 'badge-aman' : 'badge-netral')}>{link?.aktif ? 'Tautan aktif' : 'Tautan nonaktif'}</span>
                <button className="btn-ghost btn-sm" onClick={unduhQr} data-unduh-qr-asesmen><Download size={12} /> Unduh QR</button>
                <a className="btn-ghost btn-sm" href={link?.url || '#'} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Buka</a>
                {!readOnly ? (
                  <>
                    <button className="btn-soft btn-sm" onClick={() => ubahLink(false)} disabled={!!busy} data-toggle-link>
                      {busy === 'toggle' ? <Loader2 size={12} className="animate-spin" /> : <QrCode size={12} />} {link?.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => { if (window.confirm('Reset tautan? Tautan/QR lama tidak berlaku lagi.')) ubahLink(true); }}
                      disabled={!!busy} data-rotate-link>
                      {busy === 'rotate' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reset QR
                    </button>
                  </>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Halaman publik: siswa memasukkan NISN + nama lengkap, lalu mengisi {row?.jumlah_soal || 0} pernyataan.
                Hasil otomatis masuk ke rekap & analisis di bawah.
              </p>
            </div>
          </div>
        </Card>

        <Card title="Identitas Instrumen" subtitle="Deskripsi & petunjuk yang tampil di halaman siswa.">
          <p className="text-[12.5px] font-semibold text-slate-700">{row?.nama || '-'}</p>
          <p className="mt-1 text-[12px] text-slate-500">{row?.deskripsi || '-'}</p>
          <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[11.5px] text-slate-600">
            <b>Petunjuk:</b> {row?.petunjuk || '-'}
          </div>
          <p className="mt-2 text-[11.5px] text-slate-500">
            Jenis jawaban: <b>{row?.tipe === 'likert4' ? 'Skala Likert 1–4' : 'Centang (Ya/Tidak)'}</b> ·
            Kategori analisis: {kategori.map(k => k.label).join(', ')}
          </p>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="tabs">
            <button className={cx('tab', tab === 'hasil' && 'active')} onClick={() => setTab('hasil')}>Analisis &amp; Rekap</button>
            <button className={cx('tab', tab === 'siswa' && 'active')} onClick={() => setTab('siswa')}>Daftar Responden ({(a?.siswa || []).length})</button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Field label="" className="!mb-0">
              <select className="input !w-auto" value={kelas} onChange={e => setKelas(e.target.value)} data-filter-kelas-asesmen>
                <option value="">Semua Kelas</option>
                {(analisis?.kelas || []).map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
            </Field>
            <button className="btn-ghost btn-sm" onClick={loadAnalisis}><RefreshCw size={13} /> Muat Ulang</button>
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : !a || !a.total ? (
        <Card>
          <Empty icon={ClipboardCheck} title="Belum ada hasil asesmen"
            desc="Bagikan tautan/QR asesmen ke siswa. Hasil yang masuk akan otomatis terekap pada panel ini." />
        </Card>
      ) : tab === 'siswa' ? (
        <Card title="Daftar Responden" subtitle={`${a.siswa.length} siswa mengisi ${row?.nama || ''}`}
          right={<span className="text-[11.5px] font-semibold text-slate-500">Terpilih: <b className="text-orange-700" data-count-hasil>{pilih.length}</b></span>}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-[12px] font-bold text-slate-600">
              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600"
                checked={a.siswa.length > 0 && pilih.length === a.siswa.length}
                onChange={e => setPilih(e.target.checked ? a.siswa.map(x => x.id) : [])} data-hasil-all="1" />
              Pilih Semua
            </label>
            <button className="btn-danger btn-sm ml-auto" disabled={!pilih.length || busyHapus || readOnly}
              onClick={hapusHasil} data-hasil-hapus="1">
              {busyHapus ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Hapus Riwayat Asesmen Terpilih
            </button>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: '62vh' }}>
            <table className="tbl" data-tbl="responden-asesmen">
              <thead>
                <tr>
                  <th className="w-9"></th><th>No</th><th>NISN</th><th>Nama</th><th>Kelas</th><th>Tanggal</th>
                  {isAkpd
                    ? ['Pribadi', 'Sosial', 'Belajar', 'Karir'].map(k => <th key={k} className="c">{k}</th>)
                    : <th>Kecenderungan</th>}
                  <th>{isAkpd ? 'Prioritas' : 'Skor'}</th>
                </tr>
              </thead>
              <tbody>
                {a.siswa.map((s, i) => (
                  <tr key={s.id} className={pilih.includes(s.id) ? 'bg-orange-50/60' : ''}>
                    <td className="c">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-orange-600" data-hasil-item={s.id}
                        checked={pilih.includes(s.id)}
                        onChange={() => setPilih(l => l.includes(s.id) ? l.filter(x => x !== s.id) : [...l, s.id])} />
                    </td>
                    <td className="c">{i + 1}</td>
                    <td className="text-[11.5px]">{s.nisn || '-'}</td>
                    <td className="font-semibold text-slate-700">{s.nama}</td>
                    <td className="text-[11.5px]">{s.kelas || '-'}</td>
                    <td className="whitespace-nowrap text-[11.5px]">{s.tanggal}</td>
                    {isAkpd
                      ? sisi(s).map(b => <td key={b.key} className="c">{b.ir}%</td>)
                      : <td>{s.utama}</td>}
                    <td className="c font-semibold">{isAkpd ? s.utama : `${s.nilai}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : isAkpd ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Responden" value={a.total} sub="pengisian AKPD" icon={Users} tone="sky" />
            {(a.bidang || []).slice(0, 3).map((b, i) => (
              <Stat key={b.key} label={`Prioritas ${i + 1}: ${b.label.replace('Bidang ', '')}`} value={`${b.ir}%`} sub={`alokasi ${b.proporsi}%· IR`} icon={BarChart3} tone={['rose', 'orange', 'violet'][i]} />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="1. Rekap Bidang Layanan (IR)" subtitle="IR = Σ skor / (jumlah butir × 4) × 100. Urut prioritas tertinggi.">
              <div className="space-y-2">
                {(a.bidang || []).map(b => (
                  <div key={b.key} className="rounded-xl border border-slate-200 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-orange-100 text-[11px] font-extrabold text-orange-700">{b.peringkat}</span>
                      <b className="text-[12.5px] text-slate-700">{b.label}</b>
                      <span className="ml-auto text-[12.5px] font-extrabold text-orange-700">{b.ir}%</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${Math.min(100, b.ir)}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">Proporsi alokasi program: <b>{b.proporsi}%</b></p>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="2. Rumusan Kebutuhan Nyata / Mendesak" subtitle="Pernyataan dengan skor ≥ 3 yang paling banyak dipilih siswa.">
              <div className="tbl-wrap" style={{ maxHeight: '40vh' }}>
                <table className="tbl">
                  <thead><tr><th className="w-8">#</th><th>Kebutuhan</th><th>Bidang</th><th className="c">Siswa</th></tr></thead>
                  <tbody>
                    {(a.rumusan || []).map((k, i) => (
                      <tr key={i}>
                        <td className="c">{i + 1}</td>
                        <td className="text-[12px]">{k.kebutuhan}</td>
                        <td className="text-[11px]">{k.bidang}</td>
                        <td className="c font-bold">{k.jumlah_siswa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="3. Draf Program BK (Protah / Prosem) & Proporsi Alokasi Waktu"
            subtitle="Rekomendasi otomatis berdasarkan urutan prioritas bidang layanan.">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Bidang</th><th className="c">IR</th><th className="c">Alokasi</th><th>Kebutuhan Utama</th><th>Rekomendasi Program</th></tr></thead>
                <tbody>
                  {(a.program || []).map(p => (
                    <tr key={p.bidang}>
                      <td className="font-semibold">{p.bidang}</td>
                      <td className="c">{p.ir}%</td>
                      <td className="c"><span className="badge badge-perhatian">{p.alokasi}%</span></td>
                      <td className="text-[11.5px]">{p.kebutuhan.length ? p.kebutuhan.map((x, i) => <div key={i}>• {x}</div>) : '-'}</td>
                      <td className="text-[11.5px]">{p.program.map((x, i) => <div key={i}>• {x}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="4. Profil Konseli / Kelompok Bermasalah" subtitle="Siswa dengan rata-rata IR ≥ 70% — perlu pendampingan prioritas.">
              {!(a.kelompok_bermasalah || []).length ? <Empty icon={CheckCircle2} title="Tidak ada siswa berisiko tinggi" desc="Tidak ada siswa dengan rata-rata IR ≥ 70%." /> : (
                <div className="tbl-wrap" style={{ maxHeight: '38vh' }}>
                  <table className="tbl">
                    <thead><tr><th>Nama</th><th>Kelas</th><th>Bidang Prioritas</th><th className="c">IR</th></tr></thead>
                    <tbody>
                      {a.kelompok_bermasalah.map(s => (
                        <tr key={s.id}>
                          <td className="font-semibold">{s.nama}</td>
                          <td className="text-[11.5px]">{s.kelas || '-'}</td>
                          <td className="text-[11.5px]">{s.utama}</td>
                          <td className="c font-bold text-rose-700">{s.ir}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="5. Rekap per Kelas" subtitle="Prioritas bidang layanan tiap kelas.">
              <div className="tbl-wrap" style={{ maxHeight: '38vh' }}>
                <table className="tbl">
                  <thead><tr><th>Kelas</th><th className="c">Responden</th><th>Prioritas 1</th><th>Prioritas 2</th></tr></thead>
                  <tbody>
                    {kelasAnalisis.map(k => (
                      <tr key={k.kelas}>
                        <td className="font-semibold">{k.kelas}</td>
                        <td className="c">{k.jumlah}</td>
                        <td className="text-[11.5px]">{(k.bidang || [])[0] ? `${k.bidang[0].label} (${k.bidang[0].ir}%)` : '-'}</td>
                        <td className="text-[11.5px]">{(k.bidang || [])[1] ? `${k.bidang[1].label} (${k.bidang[1].ir}%)` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Responden" value={a.total} sub={row?.nama} icon={Users} tone="sky" />
            {(a.distribusi || []).slice(0, 3).map((d, i) => (
              <Stat key={d.key} label={d.label} value={`${d.pct}%`} sub={`${d.siswa} siswa dominan`} icon={BarChart3} tone={['rose', 'orange', 'violet'][i]} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Distribusi Kecenderungan" subtitle="Persentase rata-rata per kategori.">
              <div className="space-y-2">
                {(a.distribusi || []).map(d => (
                  <div key={d.key}>
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <b className="text-slate-700">{d.label}</b>
                      <span className="ml-auto font-extrabold text-orange-700">{d.pct}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${Math.min(100, d.pct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Rekomendasi Layanan" subtitle="Tindak lanjut untuk Guru BK & guru mapel.">
              <div className="space-y-2">
                {(a.rekomendasi || []).map((r, i) => (
                  <div key={i} className="rounded-xl border border-orange-200 bg-orange-50/60 p-2.5">
                    <p className="text-[12.5px] font-extrabold text-orange-900">{r.tipe}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-orange-800">{r.saran}</p>
                  </div>
                ))}
                {(a.indikator || []).length ? (
                  <div className="rounded-xl border border-slate-200 p-2.5">
                    <p className="mb-1 text-[11.5px] font-bold text-slate-600">Indikator terbanyak</p>
                    <ul className="space-y-0.5 text-[11.5px] text-slate-600">
                      {a.indikator.slice(0, 8).map((x, i) => <li key={i}>• {x.indikator} <b>({x.jumlah})</b></li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
          <Card title="Rekap per Kelas" subtitle="Sebaran kecenderungan tiap kelas.">
            <div className="tbl-wrap" style={{ maxHeight: '38vh' }}>
              <table className="tbl">
                <thead><tr><th>Kelas</th><th className="c">Responden</th><th>Kecenderungan Utama</th><th className="c">Persentase</th></tr></thead>
                <tbody>
                  {kelasAnalisis.map(k => (
                    <tr key={k.kelas}>
                      <td className="font-semibold">{k.kelas}</td>
                      <td className="c">{k.jumlah}</td>
                      <td>{(k.distribusi || [])[0] ? k.distribusi[0].label : '-'}</td>
                      <td className="c">{(k.distribusi || [])[0] ? k.distribusi[0].pct + '%' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Alert tone="info" title="Histori aman saat bank soal diubah">
        Bank soal dapat diperbarui kapan saja. Hasil yang sudah masuk menyimpan jawaban &amp; skor pada versi soal saat pengisian,
        sehingga laporan lama tidak berubah ketika pernyataan diedit.
      </Alert>

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} size="sm" title={`QR ${row?.nama || ''}`}
        footer={<>
          <button className="btn-ghost" onClick={() => setQrOpen(false)}>Tutup</button>
          <button className="btn-primary" onClick={unduhQr}><Download size={14} /> Unduh</button>
        </>}>
        {link?.qr?.svg ? (
          <div className="mx-auto w-[300px] max-w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: link.qr.svg }} />
        ) : null}
      </Modal>
    </div>
  );
}
