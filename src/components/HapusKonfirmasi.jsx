import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Lock, Trash2 } from 'lucide-react';
import { Modal, Field, Alert, cx } from '../ui';

/* =====================================================================
   Dialog konfirmasi penghapusan data historis (riwayat absensi).
   Wajib mengetik kata sandi/PIN akun + centang pernyataan agar tidak
   terjadi penghapusan data sekolah karena kekeliruan.
   ===================================================================== */
export default function HapusKonfirmasi({
  open, onClose, onConfirm, judul = 'Konfirmasi Hapus Data', ringkas = [],
  labelTombol = 'Hapus Sekarang', busy = false, peringatan
}) {
  const [pin, setPin] = useState('');
  const [cek, setCek] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setPin(''); setCek(false); setErr(''); }
  }, [open]);

  async function kirim() {
    setErr('');
    if (!pin.trim()) { setErr('Kata sandi / PIN wajib diisi.'); return; }
    if (!cek) { setErr('Centang pernyataan bahwa Anda yakin menghapus data ini.'); return; }
    try {
      await onConfirm(pin.trim());
    } catch (e) { setErr(e.message || 'Penghapusan gagal.'); }
  }

  return (
    <Modal open={open} onClose={onClose} size="md" title={judul}
      subtitle="Tindakan ini tidak dapat dibatalkan dari antarmuka."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Batal</button>
        <button className="btn bg-rose-600 text-white hover:brightness-95" disabled={busy || !cek || !pin.trim()}
          onClick={kirim} data-konfirmasi-hapus>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {labelTombol}
        </button>
      </>}>
      <div className="space-y-3" data-modal-hapus>
        <Alert tone="danger" title="Perhatian" icon={AlertTriangle}>
          {peringatan || 'Data riwayat absensi yang dihapus akan hilang dari rekap, peringkat, dan laporan. Snapshot baris yang dihapus tetap disimpan di server (maksimal 3 berkas terakhir).'}
        </Alert>

        {ringkas.length ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[12px] text-slate-700">
            {ringkas.map((r, i) => (
              <p key={i} className={cx(i > 0 && 'mt-1')}>{r}</p>
            ))}
          </div>
        ) : null}

        <Field label="Kata sandi akun Anda" required hint="Dipakai sebagai PIN konfirmasi (keamanan data historis sekolah).">
          <div className="relative">
            <Lock size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input !pl-9" type="password" autoComplete="new-password" value={pin}
              onChange={e => setPin(e.target.value)} placeholder="••••••••" data-pin-hapus />
          </div>
        </Field>

        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-rose-600" checked={cek}
            onChange={e => setCek(e.target.checked)} data-cek-hapus />
          <span className="text-[12px] font-semibold text-rose-900">
            Saya yakin menghapus data ini dan memahami bahwa rekap kehadiran akan berubah.
          </span>
        </label>

        {err ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700" data-err-hapus>{err}</p> : null}
      </div>
    </Modal>
  );
}
