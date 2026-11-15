import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarRange, CheckCircle2, Home, Loader2, Pencil, Plus, RefreshCw, Save, Sparkles,
  Trash2, Users, Wand2
} from 'lucide-react';
import { api } from '../api';
import { Alert, Card, Empty, Field, Spinner, Stat, cx, useToast } from '../ui';

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const ATURAN = [
  { key: 'hindari_jam_kosong', label: 'Hindari jam kosong', desc: 'Jadwal dibuat padat — tidak ada lubang jam kosong di tengah hari (guru & kelas).' },
  { key: 'sebar_mapel_berat', label: 'Mapel berat di awal', desc: 'Mata pelajaran dengan jam banyak diletakkan pada jam pagi / awal pekan.' },
  { key: 'sebar_mapel_harian', label: 'Sebar mapel harian', desc: 'Mapel yang sama tidak dobel dalam satu hari di kelas yang sama.' },
  { key: 'hormati_ruang', label: 'Hindari bentrok ruang / lab', desc: 'Kewajiban sistem: ruangan fisik yang sama tidak dapat dipakai dua kelas pada jam yang sama.', wajib: true },
  { key: 'hormati_batas_guru', label: 'Hormati batas guru', desc: 'Batas jam maksimal per pekan dan hari tidak bersedia guru dihormati.' }
];

export default function GeneratorJadwal({ ctx, ta, onApplied }) {
  const { can, toast } = ctx;
  const bolehUbah = can('jadwal', 'write');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [hasil, setHasil] = useState(null);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/jadwal/ai/konfigurasi' + (ta ? '?ta=' + encodeURIComponent(ta) : ''))
      .then(r => { setData(r); setErr(''); })
      .catch(e => { setErr(e.message); toast.err(e.message); })
      .finally(() => setLoading(false));
  }, [ta]);
  useEffect(load, [load]);
  useEffect(() => {
    api('/api/jadwal/ai/terakhir' + (ta ? '?ta=' + encodeURIComponent(ta) : ''))
      .then(r => setInfo(r.info || null)).catch(() => setInfo(null));
  }, [ta]);

  const kelas = data?.kelas || [];
  const mapel = data?.mapel || [];
  const guru = data?.guru || [];
  const beban = data?.beban || [];
  const ruang = data?.ruang || [];
  const ring = data?.ringkasan || {};

  /* state yang dapat diubah sebelum generate */
  const [mode, setMode] = useState('tambah');
  const [aturanState, setAturanState] = useState({});
  const [kelasPilih, setKelasPilih] = useState([]);
  const [seed, setSeed] = useState(0);
  const [bebanState, setBebanState] = useState([]);
  const [guruState, setGuruState] = useState([]);
  const [ruangEditId, setRuangEditId] = useState(0);
  const [ruangBaru, setRuangBaru] = useState({ nama: '', jenis: 'kelas', kapasitas: '', aktif: 1 });

  /* sinkronisasi state lokal setiap kali data master dimuat ulang */
  useEffect(() => {
    if (!data) return;
    setMode(String((data.pengaturan || {}).mode) === 'ganti' ? 'ganti' : 'tambah');
    setSeed(Number((data.pengaturan || {}).seed) || 0);
    setAturanState({ ...(data.aturan_default || {}), ...((data.pengaturan || {}).aturan || {}), hormati_ruang: 1 });
    setKelasPilih((data.pengaturan || {}).kelas_ids || []);
    setBebanState((data.beban || []).map(b => ({
      kelas_id: b.kelas_id, mapel_id: b.mapel_id, guru_id: b.guru_id || '',
      jam_minggu: b.jam_minggu, ruang: b.ruang || ''
    })));
    setGuruState((data.guru || []).map(g => ({
      guru_id: g.guru_id, max_jam: g.max_jam || '', tidak_hadir: g.tidak_hadir || []
    })));
  }, [data]);

  const ringkasBeban = useMemo(() => {
    const total = bebanState.reduce((s, b) => s + (Number(b.jam_minggu) || 0), 0);
    const tanpaGuru = bebanState.filter(b => !b.guru_id && (Number(b.jam_minggu) || 0) > 0).length;
    const tanpaJam = bebanState.filter(b => !(Number(b.jam_minggu) > 0)).length;
    return { total, tanpaGuru, tanpaJam };
  }, [bebanState]);

  async function simpanKonfigurasi() {
    setBusy('konfigurasi');
    try {
      const r = await api('/api/jadwal/ai/konfigurasi', {
        method: 'POST', body: { mode, aturan: { ...aturanState, hormati_ruang: 1 }, kelas_ids: kelasPilih, seed: Number(seed) || 0, ta }
      });
      toast.ok('Konfigurasi AI disimpan.');
      setSeed(Number((r.pengaturan || {}).seed) || seed);
      load();
    } catch (e) { toast.err(e.message); } finally { setBusy(''); }
  }

  async function simpanBeban() {
    setBusy('beban');
    try {
      const r = await api('/api/jadwal/ai/beban', { method: 'POST', body: { items: bebanState, ta } });
      toast.ok(`${r.masuk} baris beban disimpan${r.hapus ? `, ${r.hapus} dihapus` : ''}.`);
      load();
    } catch (e) { toast.err(e.message); } finally { setBusy(''); }
  }

  async function sinkronBeban() {
    if (!window.confirm('Tarik beban mengajar dari slot jadwal yang sudah ada? Beban saat ini akan diganti.')) return;
    setBusy('sinkron');
    try {
      const r = await api('/api/jadwal/ai/beban/sinkron', { method: 'POST', body: { ta } });
      toast.ok(`${r.masuk} baris beban ditarik dari jadwal.`);
      load();
    } catch (e) { toast.err(e.message); } finally { setBusy(''); }
  }

  async function simpanGuru() {
    setBusy('guru');
    try {
      const r = await api('/api/jadwal/ai/guru', { method: 'POST', body: { items: guruState, ta } });
      toast.ok(`${r.jumlah} guru diperbarui.`);
      load();
    } catch (e) { toast.err(e.message); } finally { setBusy(''); }
  }

  async function simpanRuang() {
    if (!ruangBaru.nama.trim()) { toast.err('Nama ruangan wajib diisi.'); return; }
    setBusy('ruang');
    try {
      await api('/api/jadwal/ai/ruang', { method: 'POST', body: { ...ruangBaru, id: ruangEditId || undefined } });
      toast.ok(ruangEditId ? 'Ruang/lab diperbarui.' : 'Ruang/lab disimpan.');
      setRuangEditId(0);
      setRuangBaru({ nama: '', jenis: 'kelas', kapasitas: '', aktif: 1 });
      load();
    } catch (e) { toast.err(e.message); } finally { setBusy(''); }
  }

  function editRuang(r) {
    setRuangEditId(Number(r.id));
    setRuangBaru({ nama: r.nama || '', jenis: r.jenis || 'kelas', kapasitas: r.kapasitas || '', aktif: Number(r.aktif) === 1 ? 1 : 0 });
  }

  function batalEditRuang() {
    setRuangEditId(0);
    setRuangBaru({ nama: '', jenis: 'kelas', kapasitas: '', aktif: 1 });
  }

  async function hapusRuang(id, nama) {
    if (!window.confirm(`Hapus ruang "${nama}"?`)) return;
    setBusy('ruang');
    try {
      await api('/api/jadwal/ai/ruang/hapus', { method: 'POST', body: { id } });
      toast.ok('Ruang dihapus.');
      load();
    } catch (e) { toast.err(e.message); } finally { setBusy(''); }
  }

  async function generate() {
    setBusy('generate');
    setErr('');
    try {
      const r = await api('/api/jadwal/ai/generate', {
        method: 'POST',
        body: { ta, mode, aturan: { ...aturanState, hormati_ruang: 1 }, kelas_ids: kelasPilih, seed: Number(seed) || 0 }
      });
      setHasil(r.hasil);
      if (r.hasil.peringatan?.length) toast.info(r.hasil.peringatan[0]);
      else toast.ok('Pratinjau jadwal siap.');
    } catch (e) {
      setHasil(null);
      setErr(e.message);
      toast.err(e.message);
    } finally { setBusy(''); }
  }

  async function terapkan() {
    if (!hasil) return;
    const r0 = window.confirm(
      `Terapkan ${hasil.slots.length} slot baru ke jadwal pelajaran?`
      + (hasil.hapus.length ? `\n\n${hasil.hapus.length} slot lama pada kelas terpilih akan DIBONGKAR lebih dulu.` : '')
    );
    if (!r0) return;
    setBusy('apply');
    try {
      const r = await api('/api/jadwal/ai/apply', {
        method: 'POST',
        body: { ta, mode, aturan: { ...aturanState, hormati_ruang: 1 }, kelas_ids: kelasPilih, seed: Number(seed) || 0 }
      });
      toast.ok(r.pesan || 'Jadwal diterapkan.');
      setHasil(null);
      load();
      if (onApplied) onApplied();
    } catch (e) {
      setErr(e.message);
      toast.err(e.message);
    } finally { setBusy(''); }
  }

  function ulangi() {
    if (!window.confirm('Ulangi penyusunan dengan seed baru (pratinjau saja, jadwal tidak diubah)?')) return;
    setSeed(s => (Number(s) || 0) + 1);
    setHasil(null);
    setTimeout(generate, 60);
  }

  if (loading && !data) return <Spinner label="Memuat konfigurasi AI Timetable…" />;

  return (
    <div className="space-y-4" data-tab-ai>
      {err && !hasil ? <Alert tone="error" title="Konfigurasi belum lengkap">{err}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Beban Mengajar" value={ring.beban_total || 0} sub="jam/pekan terencana" icon={CalendarRange} tone="sky" />
        <Stat label="Slot Terpasang" value={ring.slot_terpasang || 0} sub="slot jadwal saat ini" icon={CheckCircle2} tone="emerald" />
        <Stat label="Guru Terlibat" value={ring.guru_terpakai || 0} sub={`${guru.length} guru aktif`} icon={Users} tone="violet" />
        <Stat label="Ruang / Lab" value={ring.ruang_aktif || 0} sub={`${ruang.length} ruang terdaftar`} icon={Home} tone="amber" />
      </div>

      {info ? (
        <Alert tone="info" title="Generate terakhir">
          {info.waktu} · mode {info.mode} · {info.terpasang}/{info.total} jam · {info.slot} slot baru
          {info.sisa ? ` · ${info.sisa} jam tidak terjadwal` : ''}
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:hidden">
        <Card title="Langkah" subtitle="Urutan pemakaian panel AI Timetable">
          <ol className="list-inside list-decimal space-y-1 text-[12.5px] text-slate-600">
            <li>Isi <b>Beban Mengajar</b> (jam per pekan tiap mapel per kelas) atau tarik dari jadwal yang ada.</li>
            <li>Atur <b>Batasan Guru</b> (maks jam/pekan & hari tidak bersedia) dan <b>Ruang / Lab</b>.</li>
            <li>Pilih <b>Mode</b> + <b>aturan</b>, lalu tekan <b>Generate Jadwal Otomatis</b>.</li>
            <li>Periksa pratinjau & daftar sisa jam, lalu <b>Terapkan Jadwal</b>.</li>
          </ol>
        </Card>
      </div>

      {/* ============================== ATURAN & MODE ============================== */}
      <Card title="Mode & Aturan Penyusunan" subtitle="Tentukan cara sistem menyusun dan aturan yang diikuti"
        right={bolehUbah ? (
          <button className="btn-ghost btn-sm" onClick={simpanKonfigurasi} disabled={busy === 'konfigurasi'} data-simpan-konfigurasi>
            {busy === 'konfigurasi' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Konfigurasi
          </button>
        ) : null}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Field label="Mode Penyusunan">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setMode('tambah')} disabled={!bolehUbah}
                  className={cx('tab !py-1.5', mode === 'tambah' && 'active')} data-mode-tambah>
                  Tambah / Tambal Slot Kosong
                </button>
                <button type="button" onClick={() => setMode('ganti')} disabled={!bolehUbah}
                  className={cx('tab !py-1.5', mode === 'ganti' && 'active')} data-mode-ganti>
                  Susun Ulang Kelas Terpilih
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {mode === 'tambah'
                  ? 'Slot yang sudah ada dipertahankan; sistem hanya menambah jam yang masih kurang.'
                  : 'Slot lama pada kelas terpilih dibongkar lebih dulu, lalu disusun ulang seluruhnya.'}
              </p>
            </Field>
            <Field label="Seed (opsional)" hint="Seed sama menghasilkan susunan yang sama.">
              <input className="input" type="number" min="0" value={seed} disabled={!bolehUbah}
                onChange={e => setSeed(e.target.value)} data-seed-ai />
            </Field>
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-bold text-slate-700">Aturan (centang yang berlaku)</p>
            {ATURAN.map(a => (
              <label key={a.key} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5',
                aturanState[a.key] ? 'border-orange-200 bg-orange-50/60' : 'border-slate-200 bg-white')}>
                <input type="checkbox" className="mt-0.5" disabled={!bolehUbah || !!a.wajib}
                  checked={!!aturanState[a.key] || !!a.wajib} data-aturan={a.key}
                  onChange={e => setAturanState(v => ({ ...v, [a.key]: e.target.checked ? 1 : 0 }))} />
                <span>
                  <span className="block text-[12.5px] font-semibold text-slate-800">{a.label}</span>
                  <span className="block text-[11px] leading-snug text-slate-500">{a.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <Field label="Kelas yang Disusun" hint={`${kelasPilih.length || kelas.length} kelas dipilih — kosong = seluruh kelas`}>
            <div className="flex flex-wrap gap-1.5">
              {kelas.map(k => (
                <label key={k.id} className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]',
                  kelasPilih.includes(Number(k.id)) ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-600')}>
                  <input type="checkbox" disabled={!bolehUbah} checked={kelasPilih.includes(Number(k.id))}
                    data-kelas-pilih={k.id}
                    onChange={e => setKelasPilih(v => e.target.checked ? [...v, Number(k.id)] : v.filter(x => x !== Number(k.id)))} />
                  {k.nama}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Card>

      {/* ============================== BEBAN MENGAJAR ============================== */}
      <Card title="Beban Mengajar (Kelas × Mata Pelajaran)"
        subtitle={`${ringkasBeban.total} jam/pekan · ${bebanState.length} baris${ringkasBeban.tanpaGuru ? ` · ${ringkasBeban.tanpaGuru} baris belum ada guru` : ''}`}
        right={bolehUbah ? (
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-ghost btn-sm" onClick={sinkronBeban} disabled={!!busy} data-sinkron-beban>
              {busy === 'sinkron' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Tarik dari Jadwal
            </button>
            <button className="btn-primary btn-sm" onClick={simpanBeban} disabled={!!busy} data-simpan-beban>
              {busy === 'beban' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Beban
            </button>
          </div>
        ) : null}>
        {bebanState.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" data-tbl-beban>
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 text-left">Kelas</th>
                  <th className="px-2 py-1.5 text-left">Mata Pelajaran</th>
                  <th className="px-2 py-1.5 text-left">Guru Pengampu</th>
                  <th className="px-2 py-1.5 text-center">Jam / Pekan</th>
                  <th className="px-2 py-1.5 text-left">Ruang Default</th>
                  <th className="px-2 py-1.5 text-center">Terpasang</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {bebanState.map((b, i) => {
                  const asli = beban.find(x => Number(x.kelas_id) === Number(b.kelas_id) && Number(x.mapel_id) === Number(b.mapel_id));
                  return (
                    <tr key={`${b.kelas_id}-${b.mapel_id}`} className="border-t border-slate-100" data-beban-row>
                      <td className="px-2 py-1">{asli?.kelas_nama || b.kelas_id}</td>
                      <td className="px-2 py-1">{asli?.mapel_nama || b.mapel_id}</td>
                      <td className="px-2 py-1">
                        <select className="input !py-1" disabled={!bolehUbah} value={b.guru_id || ''} data-beban-guru={i}
                          onChange={e => setBebanState(v => v.map((x, j) => j === i ? { ...x, guru_id: e.target.value ? Number(e.target.value) : '' } : x))}>
                          <option value="">(pilih guru)</option>
                          {guru.map(g => <option key={g.guru_id} value={g.guru_id}>{g.nama}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <input className="input !w-16 !py-1 text-center" type="number" min="0" max="40" disabled={!bolehUbah}
                          value={b.jam_minggu} data-beban-jam={i}
                          onChange={e => setBebanState(v => v.map((x, j) => j === i ? { ...x, jam_minggu: Number(e.target.value) } : x))} />
                      </td>
                      <td className="px-2 py-1">
                        <input className="input !py-1" disabled={!bolehUbah} value={b.ruang || ''} placeholder="(otomatis)"
                          data-beban-ruang={i}
                          onChange={e => setBebanState(v => v.map((x, j) => j === i ? { ...x, ruang: e.target.value } : x))} />
                      </td>
                      <td className="px-2 py-1 text-center text-slate-500">{asli ? asli.terpasang : 0}</td>
                      <td className="px-2 py-1 text-center">
                        <button type="button" className="btn-ghost btn-sm !px-1.5" disabled={!bolehUbah}
                          title="Hapus baris beban (jam 0)" data-beban-hapus={i}
                          onClick={() => setBebanState(v => v.filter((_, j) => j !== i))}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={CalendarRange} title="Belum ada beban mengajar"
            desc="Tarik dari jadwal yang sudah ada, atau tambahkan baris beban secara manual." />
        )}
        {bolehUbah ? <TambahBeban kelas={kelas} mapel={mapel} guru={guru} beban={bebanState}
          onTambah={rows => setBebanState(v => [...v, ...rows])} /> : null}
      </Card>

      {/* ============================== BATASAN GURU ============================== */}
      <Card title="Batasan Mengajar Guru" subtitle="Batas jam maksimal per pekan & hari tidak bersedia mengajar"
        right={bolehUbah ? (
          <button className="btn-primary btn-sm" onClick={simpanGuru} disabled={!!busy} data-simpan-guru>
            {busy === 'guru' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Simpan Batasan
          </button>
        ) : null}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" data-tbl-guru>
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-2 py-1.5 text-left">Guru</th>
                <th className="px-2 py-1.5 text-left">Mapel Diampu</th>
                <th className="px-2 py-1.5 text-center">Maks / Pekan</th>
                <th className="px-2 py-1.5 text-center">Jam Terpasang</th>
                <th className="px-2 py-1.5 text-left">Hari Tidak Bersedia</th>
              </tr>
            </thead>
            <tbody>
              {guru.map((g, i) => (
                <tr key={g.guru_id} className="border-t border-slate-100" data-guru-row={g.guru_id}>
                  <td className="px-2 py-1">
                    <div className="font-semibold text-slate-800">{g.nama}</div>
                    <div className="text-[10.5px] text-slate-500">{g.jabatan || g.role_label || g.role}</div>
                  </td>
                  <td className="px-2 py-1 text-[11px] text-slate-600">
                    {(g.mapel || []).map(m => m.nama).join(', ') || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input className="input !w-16 !py-1 text-center" type="number" min="0" max="40" disabled={!bolehUbah}
                      value={guruState[i]?.max_jam ?? ''} placeholder={g.batas || ''} data-guru-maks={g.guru_id}
                      onChange={e => setGuruState(v => v.map((x, j) => j === i ? { ...x, max_jam: e.target.value } : x))} />
                  </td>
                  <td className={cx('px-2 py-1 text-center font-semibold',
                    g.batas && g.jam_minggu > g.batas ? 'text-rose-600' : 'text-slate-600')}>
                    {g.jam_minggu}{g.batas ? ` / ${g.batas}` : ''}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      {HARI.map((h, idx) => {
                        if (idx === 0) return null;
                        const checked = (guruState[i]?.tidak_hadir || []).includes(idx);
                        return (
                          <label key={h} className={cx('flex cursor-pointer items-center gap-1 rounded border px-1 py-0.5 text-[10.5px]',
                            checked ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500')}>
                            <input type="checkbox" disabled={!bolehUbah} checked={checked} data-guru-hari={`${g.guru_id}-${idx}`}
                              onChange={e => setGuruState(v => v.map((x, j) => {
                                if (j !== i) return x;
                                const set = new Set(x.tidak_hadir || []);
                                if (e.target.checked) set.add(idx); else set.delete(idx);
                                return { ...x, tidak_hadir: [...set].sort((a, b) => a - b) };
                              }))} />
                            {h.slice(0, 3)}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ============================== RUANG / LAB ============================== */}
      <Card title="Ruang / Laboratorium" subtitle="Dipakai aturan “hormati ruang” — satu ruang tidak dobel pada jam sama">
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="overflow-x-auto">
            {ruang.length ? (
              <table className="w-full border-collapse text-[12px]" data-tbl-ruang>
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 text-left">Nama</th>
                    <th className="px-2 py-1.5 text-left">Jenis</th>
                    <th className="px-2 py-1.5 text-center">Kapasitas</th>
                    <th className="px-2 py-1.5 text-center">Aktif</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {ruang.map(r => (
                    <tr key={r.id} className="border-t border-slate-100" data-ruang-row={r.id}>
                      <td className="px-2 py-1 font-semibold text-slate-800">{r.nama}</td>
                      <td className="px-2 py-1 text-slate-600">{r.jenis}</td>
                      <td className="px-2 py-1 text-center text-slate-600">{r.kapasitas || '—'}</td>
                      <td className="px-2 py-1 text-center">{Number(r.aktif) === 1 ? 'Ya' : 'Tidak'}</td>
                      <td className="px-2 py-1 text-center">
                        {bolehUbah ? (
                          <div className="flex justify-center gap-1">
                            <button type="button" className="btn-ghost btn-sm !px-1.5" disabled={!!busy}
                              onClick={() => editRuang(r)} title="Ubah ruangan" data-edit-ruang={r.id}>
                              <Pencil size={13} />
                            </button>
                            <button type="button" className="btn-ghost btn-sm !px-1.5" disabled={!!busy}
                              onClick={() => hapusRuang(r.id, r.nama)} data-hapus-ruang={r.id}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty icon={Home} title="Belum ada ruang/lab" desc="Tambahkan bila sekolah memakai laboratorium atau ruang khusus." />}
          </div>
          {bolehUbah ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
              <Field label={ruangEditId ? 'Ubah Nama Ruang' : 'Nama Ruang'}><input className="input" value={ruangBaru.nama} placeholder="Lab IPA"
                onChange={e => setRuangBaru(v => ({ ...v, nama: e.target.value }))} data-ruang-nama /></Field>
              <Field label="Jenis">
                <select className="input" value={ruangBaru.jenis} onChange={e => setRuangBaru(v => ({ ...v, jenis: e.target.value }))}>
                  {['kelas', 'lab', 'lapangan', 'aula', 'lain'].map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </Field>
              <Field label="Kapasitas"><input className="input" type="number" min="0" value={ruangBaru.kapasitas}
                onChange={e => setRuangBaru(v => ({ ...v, kapasitas: e.target.value }))} /></Field>
              <label className="flex items-center gap-2 text-[12px] text-slate-700">
                <input type="checkbox" checked={Number(ruangBaru.aktif) === 1}
                  onChange={e => setRuangBaru(v => ({ ...v, aktif: e.target.checked ? 1 : 0 }))} />
                Ruangan aktif untuk alokasi
              </label>
              <button className="btn-primary btn-sm w-full" onClick={simpanRuang} disabled={busy === 'ruang'} data-tambah-ruang>
                <Plus size={13} /> {ruangEditId ? 'Simpan Perubahan' : 'Tambah Ruang'}
              </button>
              {ruangEditId ? <button className="btn-ghost btn-sm w-full" onClick={batalEditRuang}>Batal Ubah</button> : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* ============================== GENERATE ============================== */}
      <Card title="Generate Jadwal Otomatis"
        subtitle="Pratinjau dulu — jadwal baru tersimpan setelah tombol Terapkan ditekan"
        right={(
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-ghost btn-sm" onClick={ulangi} disabled={!hasil || !!busy} data-ulangi-jadwal>
              <RefreshCw size={13} /> Ulangi / Reset
            </button>
            <button className="btn-primary btn-sm" onClick={generate} disabled={!!busy} data-generate-jadwal data-tour-id="btn-generate-ai">
              {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Generate Jadwal Otomatis
            </button>
          </div>
        )}>
        {!hasil ? (
          <Empty icon={Sparkles} title="Belum ada pratinjau"
            desc="Tekan “Generate Jadwal Otomatis” untuk menyusun jadwal dari beban mengajar dan aturan di atas." />
        ) : (
          <div className="space-y-3">
            {hasil.peringatan?.length ? (
              <Alert tone="warn" title={`${hasil.peringatan.length} catatan`}>
                <ul className="list-inside list-disc space-y-0.5">
                  {hasil.peringatan.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Jam Terencana" value={hasil.ringkasan.total_unit} sub="dari beban mengajar" icon={CalendarRange} tone="sky" />
              <Stat label="Berhasil Ditempatkan" value={hasil.ringkasan.terpasang}
                sub={`${hasil.ringkasan.total_unit ? Math.round(hasil.ringkasan.terpasang / hasil.ringkasan.total_unit * 100) : 0}% kebutuhan`}
                icon={CheckCircle2} tone="emerald" />
              <Stat label="Slot Baru" value={hasil.slots.length} sub={hasil.hapus.length ? `${hasil.hapus.length} slot dibongkar` : 'tanpa bongkar'}
                icon={Wand2} tone="violet" />
              <Stat label="Sisa Jam" value={hasil.ringkasan.sisa} sub="tidak dapat ditempatkan" icon={AlertTriangle}
                tone={hasil.ringkasan.sisa ? 'rose' : 'emerald'} />
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-[11.5px]" data-tbl-pratinjau>
                <thead>
                  <tr className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 text-left">Kelas</th>
                    <th className="px-2 py-1.5 text-left">Hari</th>
                    <th className="px-2 py-1.5 text-left">Jam</th>
                    <th className="px-2 py-1.5 text-left">Mata Pelajaran</th>
                    <th className="px-2 py-1.5 text-left">Guru</th>
                    <th className="px-2 py-1.5 text-left">Ruang</th>
                  </tr>
                </thead>
                <tbody>
                  {hasil.slots.map((s, i) => (
                    <tr key={i} className="border-t border-slate-100" data-pratinjau-slot>
                      <td className="px-2 py-1 font-semibold text-slate-700">{s.kelas_nama}</td>
                      <td className="px-2 py-1">{s.hari_nama}</td>
                      <td className="px-2 py-1">{s.label_sesi}</td>
                      <td className="px-2 py-1">{s.mapel_nama}</td>
                      <td className="px-2 py-1">{s.guru_nama}</td>
                      <td className="px-2 py-1 text-slate-500">{s.ruang || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasil.sisa?.length ? (
              <div className="overflow-x-auto rounded-xl border border-rose-200">
                <table className="w-full border-collapse text-[11.5px]" data-tbl-sisa>
                  <thead>
                    <tr className="bg-rose-50 text-[10.5px] uppercase tracking-wide text-rose-700">
                      <th className="px-2 py-1.5 text-left">Kelas</th>
                      <th className="px-2 py-1.5 text-left">Mata Pelajaran</th>
                      <th className="px-2 py-1.5 text-left">Guru</th>
                      <th className="px-2 py-1.5 text-left">Alasan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hasil.sisa.map((s, i) => (
                      <tr key={i} className="border-t border-rose-100" data-sisa-item>
                        <td className="px-2 py-1">{s.kelas_nama}</td>
                        <td className="px-2 py-1">{s.mapel_nama}</td>
                        <td className="px-2 py-1">{s.guru_nama || '—'}</td>
                        <td className="px-2 py-1 text-rose-700">{s.alasan}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <p className="text-[12px] text-emerald-900">
                Pratinjau siap. {hasil.hapus.length
                  ? `${hasil.hapus.length} slot lama pada kelas terpilih akan dibongkar (termasuk turunannya) sebelum slot baru disimpan.`
                  : 'Slot lama tetap dipertahankan.'}
              </p>
              <button className="btn-primary btn-sm" onClick={terapkan} disabled={!bolehUbah || !!busy || (!hasil.slots.length && !hasil.hapus.length)}
                data-terapkan-jadwal>
                {busy === 'apply' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Terapkan Jadwal
              </button>
            </div>
            {!bolehUbah ? <Alert tone="warn" title="Hanya lihat">Akun Anda tidak memiliki izin mengubah jadwal.</Alert> : null}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------- pembantu UI ------------------------------- */

/** tambah baris beban (kelas + mapel) yang belum ada */
function TambahBeban({ kelas, mapel, guru, beban, onTambah }) {
  const [kelasId, setKelasId] = useState('');
  const [mapelId, setMapelId] = useState('');
  const [jam, setJam] = useState(2);
  const [guruId, setGuruId] = useState('');
  const [ruang, setRuang] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!kelasId && kelas[0]) setKelasId(String(kelas[0].id));
    if (!mapelId && mapel[0]) setMapelId(String(mapel[0].id));
  }, [kelas, mapel]);

  const tambah = () => {
    if (!kelasId || !mapelId) { setErr('Pilih kelas dan mata pelajaran.'); return; }
    const ada = beban.some(b => Number(b.kelas_id) === Number(kelasId) && Number(b.mapel_id) === Number(mapelId));
    if (ada) { setErr('Baris beban untuk kelas & mapel ini sudah ada.'); return; }
    /* guru default = pengampu pertama mapel terpilih (bila ada) */
    const g = guruId ? Number(guruId) : ((guru.find(x => (x.mapel || []).some(m => Number(m.id) === Number(mapelId))) || {}).guru_id || '');
    onTambah([{ kelas_id: Number(kelasId), mapel_id: Number(mapelId), guru_id: g, jam_minggu: Number(jam) || 0, ruang }]);
    setErr('');
    setRuang('');
  };

  return (
    <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-2.5" data-tambah-beban>
      <p className="mb-1.5 text-[11.5px] font-bold text-slate-700">Tambah Baris Beban</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_90px_1fr_auto]">
        <select className="input !py-1" value={kelasId} onChange={e => setKelasId(e.target.value)} data-beban-kelas-baru>
          {kelas.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
        </select>
        <select className="input !py-1" value={mapelId} onChange={e => setMapelId(e.target.value)} data-beban-mapel-baru>
          {mapel.map(m => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select className="input !py-1" value={guruId} onChange={e => setGuruId(e.target.value)}>
          <option value="">(guru otomatis)</option>
          {guru.map(g => <option key={g.guru_id} value={g.guru_id}>{g.nama}</option>)}
        </select>
        <input className="input !py-1 text-center" type="number" min="0" max="40" value={jam}
          onChange={e => setJam(e.target.value)} title="Jam per pekan" />
        <input className="input !py-1" value={ruang} placeholder="Ruang (opsional)" onChange={e => setRuang(e.target.value)} />
        <button type="button" className="btn-primary btn-sm" onClick={tambah} data-beban-tambah>
          <Plus size={13} /> Tambah
        </button>
      </div>
      {err ? <p className="mt-1 text-[11px] text-rose-600">{err}</p> : null}
    </div>
  );
}
