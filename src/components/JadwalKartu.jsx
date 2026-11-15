import React from 'react';
import { tinggiSesi, labelSesi, sesiPadat } from '../jadwalSesi';

/* =====================================================================
   KARTU SLOT JADWAL — bentuknya SAMA dengan kartu pada halaman
   pengelolaan jadwal (kolom hari → kartu mapel), dipakai juga oleh halaman
   publik /jadwal-publik/<token> agar tampilan konsisten. Seluruh isi kartu
   rata tengah; tinggi kartu mengikuti durasi sesi (hari custom ikut).
   ===================================================================== */
export function KartuSlot({ row, sesi, dataAttr = {}, showClass = true }) {
  const padat = sesiPadat(sesi);
  const jam = sesi ? `${sesi.mulai}–${sesi.selesai}` : '';
  return (
    <div
      {...dataAttr}
      data-kartu-slot="mapel"
      style={padat ? { height: tinggiSesi(sesi) } : { minHeight: tinggiSesi(sesi) }}
      className={'flex flex-col overflow-hidden rounded-lg border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 px-1.5 text-center '
        + (padat ? 'py-0.5' : 'py-1')}>
      {/* label sesi + rentang waktu (rata tengah) */}
      <div className="text-center">
        <p className="truncate text-[9.5px] font-extrabold uppercase tracking-wide text-orange-700" data-slot-label>
          {labelSesi(sesi)}
        </p>
        <p className="whitespace-nowrap text-[9px] font-semibold leading-tight text-slate-500" data-slot-jam>{jam}</p>
      </div>
      {/* isi kartu: mapel (badge kode), kelas, guru */}
      {padat ? (
        <p className="mt-0.5 truncate text-[10px] font-bold leading-tight text-slate-800" data-slot-mapel>
          {row.mapel_kode ? <span className="mr-1 rounded bg-teal-100 px-1 text-[9px] font-extrabold text-teal-800">{row.mapel_kode}</span> : null}
          {row.mapel_nama || '-'} <span className="font-normal text-slate-500" data-slot-guru>· {row.guru_nama || '-'}</span>
        </p>
      ) : (
        <div className="mt-1 flex flex-1 flex-col items-center justify-center">
          <p className="text-[11.5px] font-bold leading-tight text-slate-800" data-slot-mapel>
            {row.mapel_kode ? <span className="mr-1 rounded bg-teal-100 px-1 text-[9.5px] font-extrabold text-teal-800">{row.mapel_kode}</span> : null}
            {' '}{row.mapel_nama || '-'}
          </p>
          {showClass && row.kelas_nama ? <p className="mt-0.5 truncate text-[9.5px] font-bold text-teal-700" data-slot-kelas>{row.kelas_nama}</p> : null}
          <p className="mt-0.5 truncate text-[10px] text-slate-500" data-slot-guru>{row.guru_nama || 'Guru belum dipilih'}</p>
          {showClass && row.kelas_ids && row.kelas_ids.length > 1
            ? <p className="mt-0.5 truncate text-[9.5px] font-semibold text-rose-600">Gabungan: {row.kelas_nama}</p>
            : row.ruang ? <p className="mt-0.5 text-[9.5px] text-slate-400">{row.ruang}</p> : null}
        </div>
      )}
    </div>
  );
}

/** kartu slot KOSONG (belum ada jadwal) — tetap menampilkan label jam */
export function KartuKosong({ sesi }) {
  return (
    <div style={{ minHeight: tinggiSesi(sesi) }} data-kartu-slot="kosong"
      className="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-200 px-1 py-1 text-center text-slate-300"
      data-slot-kosong-label={labelSesi(sesi)}>
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{labelSesi(sesi)}</span>
      <span className="text-[9px] font-semibold text-slate-400">{sesi ? `${sesi.mulai}–${sesi.selesai}` : ''}</span>
      <span className="text-[13px] font-bold">–</span>
    </div>
  );
}

/** kartu ISTIRAHAT / sesi non-KBM (kuning) */
export function KartuIstirahat({ sesi }) {
  return (
    <div style={{ minHeight: tinggiSesi(sesi) }} data-kartu-slot="istirahat" data-sesi-istirahat={String(labelSesi(sesi))}
      className="flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-1 text-center">
      <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-700">{labelSesi(sesi)}</span>
      <span className="text-[9px] font-semibold text-amber-600">{sesi.mulai}–{sesi.selesai}</span>
    </div>
  );
}

/** kepala kolom hari (nama hari + jumlah jam/sesi) */
export function KepalaHari({ nama, khusus, jumlahJam, jumlahSesi }) {
  return (
    <div className={'mb-1 rounded-lg border px-1.5 py-1 text-center '
      + (khusus ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50')}
      data-hari-khusus={khusus ? 1 : 0}>
      <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-slate-700">
        {nama}
        {khusus ? <span className="ml-1 rounded bg-violet-200 px-1 text-[8.5px] font-bold text-violet-800">khusus</span> : null}
      </p>
      <p className="text-[9.5px] font-semibold text-slate-500">{jumlahJam} jam · {jumlahSesi} sesi</p>
    </div>
  );
}
