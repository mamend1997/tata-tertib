'use strict';
/* =====================================================================
   MODUL REKAP ABSENSI (Guru & Siswa)
   ---------------------------------------------------------------------
   · Rekap absensi mengajar guru: filter guru, mapel, dan periode
     (harian / mingguan / bulanan / satu tahun pelajaran / rentang custom),
     lengkap dengan jurnal mengajar + ekspor Excel & cetak PDF.
   · Rekap absensi siswa per kelas & per siswa + peringkat ketidakhadiran
     (izin / sakit / alfa / bolos).
   · Otomatisasi pengiriman rekap harian ke WhatsApp Wali Kelas
     (jadwal jam & hari kerja diatur di Pengaturan).
   ===================================================================== */
const dbm = require('./db');
const lib = require('./lib');
const printdoc = require('./printdoc');
const doc = require('./doc');
const { db } = dbm;

const e = lib.esc;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = (d) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const parseISO = (s) => new Date(String(s) + 'T00:00:00');
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const cap = (s, n = 5000) => s.slice(0, n);

const GURU_STATUS_LABEL = { hadir: 'Hadir', izin: 'Izin', sakit: 'Sakit', alpha: 'Alpha', belum: 'Belum Absen' };
const SISWA_LABEL = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alpha', B: 'Bolos' };

module.exports = function mount(api) {
  const { get, post, json, fail, guard, readBody, ipOf } = api;
  const taOf = q => Number(q && q.ta) || (dbm.tahunAktif() || {}).id || 0;
  const todayISO = () => dbm.today();

  /* ---------- filter periode ---------- */
  function rangeOf(q) {
    const taId = taOf(q || {});
    const ta = dbm.tahunById(taId) || {};
    const tgl = ISO_RE.test(String((q && q.tanggal) || '')) ? String(q.tanggal) : todayISO();
    const periode = ['harian', 'mingguan', 'bulanan', 'tahun', 'custom'].includes(String((q && q.periode) || ''))
      ? String(q.periode) : 'bulanan';
    let dari = tgl, sampai = tgl, label = '';
    if (periode === 'harian') {
      label = dbm.tanggalPanjang(tgl);
    } else if (periode === 'mingguan') {
      const d = parseISO(tgl);
      const dow = (d.getDay() + 6) % 7;            // Senin = 0
      d.setDate(d.getDate() - dow);
      dari = isoOf(d);
      sampai = addDays(dari, 6);
      label = `${dbm.tanggalPanjang(dari)} – ${dbm.tanggalPanjang(sampai)}`;
    } else if (periode === 'bulanan') {
      const y = Number(tgl.slice(0, 4)), m = Number(tgl.slice(5, 7));
      dari = `${tgl.slice(0, 7)}-01`;
      sampai = isoOf(new Date(y, m, 0));
      label = `${lib.BULAN[m - 1]} ${y}`;
    } else if (periode === 'tahun') {
      dari = ta.tanggal_mulai || `${new Date().getFullYear()}-07-01`;
      sampai = ta.tanggal_selesai || `${new Date().getFullYear() + 1}-06-30`;
      label = `Tahun Pelajaran ${ta.nama || '-'}`;
    } else {
      const a = ISO_RE.test(String(q.dari || '')) ? String(q.dari) : tgl;
      const b = ISO_RE.test(String(q.sampai || '')) ? String(q.sampai) : tgl;
      dari = a <= b ? a : b;
      sampai = a <= b ? b : a;
      label = `${dbm.tanggalPanjang(dari)} – ${dbm.tanggalPanjang(sampai)}`;
    }
    /* batasi rentang maksimal 400 hari agar rekap tetap ringan */
    if (parseISO(sampai).getTime() - parseISO(dari).getTime() > 400 * 86400000) {
      sampai = addDays(dari, 400);
    }
    return { taId, ta, periode, dari, sampai, tgl, label };
  }

  function kelasListAll() {
    return dbm.kelasAll().map(k => ({
      id: k.id, nama: k.nama, tingkat: k.tingkat, ta_id: k.tahun_ajaran_id,
      wali_id: k.wali_id, wali_nama: k.wali_nama || '', wali_phone: k.wali_phone || ''
    }));
  }
  function kelasWithWali() {
    return db.prepare(`SELECT k.id, k.nama, k.tingkat, k.tahun_ajaran_id,
        u.id AS wali_id, u.nama AS wali_nama, COALESCE(u.phone,'') AS wali_phone
      FROM kelas k LEFT JOIN users u ON u.id=k.wali_id
      ORDER BY k.tahun_ajaran_id, k.urut, k.nama`).all();
  }

  /* =================================================================
     1. REKAP ABSENSI GURU
     ================================================================= */
  function guruRekap(opt = {}) {
    const r = rangeOf(opt);
    const guruId = Number(opt.guru) || 0;
    const mapelId = Number(opt.mapel) || 0;
    const slots = dbm.jadwalRows(r.taId).filter(s =>
      (!guruId || Number(s.guru_id) === guruId) && (!mapelId || Number(s.mapel_id) === mapelId));
    const abs = db.prepare('SELECT * FROM absensi_guru WHERE tanggal BETWEEN ? AND ? AND ta_id=?')
      .all(r.dari, r.sampai, r.taId);
    const absMap = new Map(abs.map(a => [`${a.jadwal_id}|${a.tanggal}`, a]));
    /* REKAM IZIN: saat guru pengganti ditunjuk, ketidakhadiran guru asli dipindahkan
       ke absensi_guru_izin. Tetap dihitung di rekap agar disiplin guru tercatat. */
    const izinRows = (() => {
      try {
        return db.prepare('SELECT * FROM absensi_guru_izin WHERE tanggal BETWEEN ? AND ?').all(r.dari, r.sampai);
      } catch (e) { return []; }
    })();
    const izinMap = new Map(izinRows.map(a => [`${a.jadwal_id}|${a.tanggal}`, a]));
    const cfg = dbm.jadwalConfig();
    const sesiOf = (no) => cfg.sesi.find(s => Number(s.idx) === Number(no)) || null;
    const rows = [];
    const batas = todayISO();
    const akhir = r.sampai > batas ? batas : r.sampai;
    for (let d = r.dari; d <= akhir; d = addDays(d, 1)) {
      if (parseISO(d).getTime() - parseISO(r.dari).getTime() > 400 * 86400000) break;
      const hari = dbm.hariOf(d);
      for (const s of slots) {
        if (Number(s.hari) !== hari) continue;
        const a = absMap.get(`${s.id}|${d}`);
        const iz = izinMap.get(`${s.id}|${d}`);
        /* baris pertama: pelaksana sesi (guru asli atau guru pengganti) */
        const status = a ? a.status : (iz ? 'belum' : 'belum');
        const sesi = sesiOf(s.sesi);
        const absId = a ? a.id : null;
        rows.push({
          tanggal: d, hari_label: dbm.HARI_LABEL[hari] || '',
          guru_id: a && a.guru_id ? a.guru_id : s.guru_id,
          guru_nama: a && a.guru_id && Number(a.guru_id) !== Number(s.guru_id)
            ? ((db.prepare('SELECT nama FROM users WHERE id=?').get(Number(a.guru_id)) || {}).nama || s.guru_nama)
            : s.guru_nama,
          guru_asli: s.guru_nama, jadwal_id: s.id, absensi_id: absId,
          mapel_id: s.mapel_id, mapel_nama: s.mapel_nama || '', sesi: s.sesi,
          jam: sesi ? `${sesi.mulai}–${sesi.selesai}` : '', kelas_nama: s.kelas_nama || '',
          status, status_label: GURU_STATUS_LABEL[status] || status,
          materi: a ? (a.materi || '') : '', catatan: a ? (a.catatan || '') : '',
          waktu_submit: a ? (a.waktu_submit || '') : '', foto_url: a ? (a.foto_url || '') : '',
          alpha: status === 'belum' || status === 'alpha' ? 1 : 0,
          ada_izin: !!iz
        });
        /* baris kedua: ketidakhadiran guru asli (bila sesi digantikan guru lain) */
        if (iz && a) {
          const jam = sesi ? `${sesi.mulai}–${sesi.selesai}` : '';
          rows.push({
            tanggal: d, hari_label: dbm.HARI_LABEL[hari] || '', guru_id: iz.guru_id,
            guru_nama: (db.prepare('SELECT nama FROM users WHERE id=?').get(Number(iz.guru_id)) || {}).nama || s.guru_nama,
            guru_asli: s.guru_nama, jadwal_id: s.id, absensi_id: iz.id, dari_izin: true,
            mapel_id: s.mapel_id, mapel_nama: s.mapel_nama || '', sesi: s.sesi, jam,
            kelas_nama: s.kelas_nama || '', status: iz.status,
            status_label: GURU_STATUS_LABEL[iz.status] || iz.status,
            materi: iz.materi || '', catatan: iz.catatan || '', waktu_submit: iz.waktu_submit || '',
            foto_url: iz.foto_url || '', alpha: 0, catatan_pengganti: 'digantikan guru lain'
          });
        }
      }
    }
    rows.sort((a, b) => (a.tanggal === b.tanggal
      ? String(a.guru_nama).localeCompare(String(b.guru_nama)) || a.sesi - b.sesi
      : (a.tanggal < b.tanggal ? 1 : -1)));

    const perGuru = new Map();
    for (const row of rows) {
      const o = perGuru.get(row.guru_id) || {
        guru_id: row.guru_id, guru_nama: row.guru_nama,
        H: 0, I: 0, S: 0, A: 0, belum: 0, total: 0, mapel: new Set(), materi: 0
      };
      if (row.status === 'hadir') o.H++;
      else if (row.status === 'izin') o.I++;
      else if (row.status === 'sakit') o.S++;
      else if (row.status === 'alpha') o.A++;
      else o.belum++;
      if (row.status === 'hadir' && String(row.materi).trim().length >= 4) o.materi++;
      if (row.mapel_nama) o.mapel.add(row.mapel_nama);
      o.total++;
      perGuru.set(row.guru_id, o);
    }
    const guru = [...perGuru.values()].map(o => ({
      ...o, mapel: [...o.mapel], A_total: o.A + o.belum,
      persen: o.total ? Math.round((o.H / o.total) * 1000) / 10 : 0
    })).sort((a, b) => String(a.guru_nama).localeCompare(String(b.guru_nama)));
    const hitung = { H: 0, I: 0, S: 0, A: 0, belum: 0, total: 0 };
    for (const g of guru) {
      hitung.H += g.H; hitung.I += g.I; hitung.S += g.S;
      hitung.A += g.A; hitung.belum += g.belum; hitung.total += g.total;
    }
    return {
      ...r, rows: cap(rows, 4000), jumlah_baris: rows.length, truncated: rows.length > 4000,
      guru, hitung,
      guru_list: db.prepare("SELECT id,nama,nip,jabatan FROM users WHERE aktif=1 ORDER BY nama").all(),
      mapel_list: dbm.mapelList({ aktifOnly: false }),
      filter: { guru: guruId, mapel: mapelId }
    };
  }

  get('/api/rekap/absensi-guru', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_guru', 'view')) return;
    json(res, 200, { ok: true, ...guruRekap(q) });
  });

  function guruSheet(data) {
    const head = [
      [{ v: 'REKAP ABSENSI MENGAJAR GURU', bold: true }],
      [{ v: `Periode: ${data.label}` }],
      [{ v: `Sekolah: ${dbm.allSettings().sekolah_nama || '-'} · Tahun Pelajaran: ${(data.ta || {}).nama || '-'}` }],
      [],
      ['NO', 'TANGGAL', 'HARI', 'NAMA GURU', 'MATA PELAJARAN', 'JAM', 'KELAS', 'STATUS', 'JURNAL MATERI', 'CATATAN']
    ];
    const body = data.rows.map((r, i) => [
      i + 1, lib.tglID(r.tanggal), r.hari_label, r.guru_nama, r.mapel_nama,
      r.jam, r.kelas_nama, r.status_label, r.materi, r.catatan
    ]);
    return lib.xlsxBuffer('Rekap Absensi Guru', [...head, ...body], [5, 13, 9, 26, 24, 13, 20, 14, 42, 32]);
  }

  function guruPrint(data) {
    const st = dbm.allSettings();
    const rows = data.rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c">${e(lib.tglID(r.tanggal))}</td><td class="c">${e(r.hari_label)}</td>
      <td>${e(r.guru_nama)}</td><td>${e(r.mapel_nama)}</td><td class="c">${e(r.jam)}</td>
      <td>${e(r.kelas_nama)}</td><td class="c">${e(r.status_label)}</td>
      <td>${e(r.materi || '-')}</td><td>${e(r.catatan || '')}</td></tr>`).join('')
      || '<tr><td colspan="10" class="c muted">Belum ada data pada periode ini.</td></tr>';
    const ringkas = data.guru.map(g => `<tr><td>${e(g.guru_nama)}</td><td>${e(g.mapel.join(', '))}</td>
      <td class="c">${g.H}</td><td class="c">${g.I}</td><td class="c">${g.S}</td><td class="c">${g.A_total}</td>
      <td class="c">${g.total}</td><td class="c">${g.persen}%</td></tr>`).join('');
    const body = `
      <div class="meta">
        <span>Periode: <b>${e(data.label)}</b></span>
        <span>Tahun Pelajaran: <b>${e((data.ta || {}).nama || '-')}</b></span>
        <span>Total jam mengajar: <b>${data.hitung.total}</b></span>
        <span>Hadir: <b>${data.hitung.H}</b> · Izin: <b>${data.hitung.I}</b> · Sakit: <b>${data.hitung.S}</b> ·
          Alpha/Belum: <b>${data.hitung.A + data.hitung.belum}</b></span>
      </div>
      <h3 class="sec">Ringkasan per Guru</h3>
      <table><thead><tr><th>Nama Guru</th><th>Mata Pelajaran</th><th>Hadir</th><th>Izin</th><th>Sakit</th>
        <th>Alpha</th><th>Total Jam</th><th>% Hadir</th></tr></thead>
        <tbody>${ringkas || '<tr><td colspan="8" class="c muted">-</td></tr>'}</tbody></table>
      <h3 class="sec">Rincian Absensi & Jurnal Mengajar</h3>
      <table><thead><tr><th>No</th><th>Tanggal</th><th>Hari</th><th>Nama Guru</th><th>Mata Pelajaran</th>
        <th>Jam</th><th>Kelas</th><th>Status</th><th>Jurnal Materi</th><th>Catatan</th></tr></thead>
        <tbody>${rows}</tbody></table>
      ${data.rows.length >= 4000 ? '<p class="note">Tampilan dibatasi 4.000 baris pertama — persempit periode atau unduh Excel untuk data lengkap.</p>' : ''}`;
    return printdoc.page({
      settings: st, title: 'Rekap Absensi Mengajar Guru', subtitle: `Periode ${data.label}`,
      body, paper: st.print_paper || 'A4', landscape: true
    });
  }

  get('/api/rekap/absensi-guru/export', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_guru', 'view')) return;
    const data = guruRekap(q);
    const buf = guruSheet(data);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="rekap-absensi-guru-${data.dari}-${data.sampai}.xlsx"`
    });
    res.end(buf);
  });
  get('/api/rekap/absensi-guru/cetak', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_guru', 'view')) return;
    const html = guruPrint(guruRekap(q));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  /* =================================================================
     2. REKAP ABSENSI SISWA (per kelas / per siswa) + PERINGKAT
     ================================================================= */
  function siswaQuery(opt = {}) {
    const r = rangeOf(opt);
    const kelasId = Number(opt.kelas) || 0;
    const siswaId = Number(opt.siswa) || 0;
    const mapelId = Number(opt.mapel) || 0;
    const where = ['a.tanggal BETWEEN ? AND ?', 'COALESCE(s.ta_id, j.ta_id)=?'];
    const args = [r.dari, r.sampai, r.taId];
    if (kelasId) { where.push('a.kelas_id=?'); args.push(kelasId); }
    if (siswaId) { where.push('a.siswa_id=?'); args.push(siswaId); }
    if (mapelId) { where.push('s.mapel_id=?'); args.push(mapelId); }
    if (opt.q) {
      where.push('(lower(sd.nama) LIKE ? OR sd.nisn LIKE ? OR sd.nis LIKE ?)');
      const like = '%' + String(opt.q).toLowerCase().trim() + '%';
      args.push(like, like, like);
    }
    const rows = db.prepare(`SELECT a.id, a.tanggal, a.siswa_id, a.status, a.keterangan, a.oleh_nama,
        a.kelas_id, sd.nama AS siswa_nama, sd.nisn, sd.nis,
        k.nama AS kelas_nama, m.nama AS mapel_nama, m.id AS mapel_id, j.sesi,
        s.pencatat, s.pencatat_role
      FROM absensi_siswa a
      LEFT JOIN absensi_sesi s ON s.id=a.sesi_id
      LEFT JOIN jadwal j ON j.id=s.jadwal_id
      LEFT JOIN mapel m ON m.id=s.mapel_id
      LEFT JOIN siswa sd ON sd.id=a.siswa_id
      LEFT JOIN kelas k ON k.id=a.kelas_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.tanggal, j.sesi, sd.nama LIMIT 8000`).all(...args);
    return { ...r, rows, kelasId, siswaId, mapelId };
  }

  function siswaRekap(opt = {}) {
    const data = siswaQuery(opt);
    const perSiswa = new Map();
    const perMapel = new Map();
    for (const a of data.rows) {
      const key = Number(a.siswa_id);
      const o = perSiswa.get(key) || {
        siswa_id: key, nama: a.siswa_nama, nisn: a.nisn || '', nis: a.nis || '',
        kelas_id: a.kelas_id, kelas_nama: a.kelas_nama,
        H: 0, S: 0, I: 0, A: 0, B: 0, total: 0, mapel: {}
      };
      o[a.status] = (o[a.status] || 0) + 1;
      o.total++;
      if (a.mapel_nama) o.mapel[a.mapel_nama] = (o.mapel[a.mapel_nama] || 0) + 1;
      perSiswa.set(key, o);
      if (a.mapel_nama) {
        const mk = a.mapel_nama;
        const mm = perMapel.get(mk) || { nama: mk, H: 0, S: 0, I: 0, A: 0, B: 0, total: 0 };
        mm[a.status] = (mm[a.status] || 0) + 1; mm.total++;
        perMapel.set(mk, mm);
      }
    }
    /* mode per kelas: seluruh siswa aktif kelas tsb, termasuk yang belum punya catatan */
    if (data.kelasId && !data.siswaId) {
      for (const s of dbm.siswaRows({ kelasId: data.kelasId, statusSiswa: 'aktif' })) {
        if (!perSiswa.has(Number(s.id))) {
          perSiswa.set(Number(s.id), {
            siswa_id: s.id, nama: s.nama, nisn: s.nisn || '', nis: s.nis || '',
            kelas_id: s.kelas_id, kelas_nama: s.kelas_nama, H: 0, S: 0, I: 0, A: 0, B: 0, total: 0, mapel: {}
          });
        }
      }
    }
    const siswa = [...perSiswa.values()].map(o => ({
      ...o,
      tidak_hadir: o.S + o.I + o.A + o.B,
      persen_hadir: o.total ? Math.round((o.H / o.total) * 1000) / 10 : 0
    })).sort((a, b) => {
      if (a.kelas_nama !== b.kelas_nama) return String(a.kelas_nama).localeCompare(String(b.kelas_nama));
      return String(a.nama).localeCompare(String(b.nama));
    });
    const total = { H: 0, S: 0, I: 0, A: 0, B: 0, total: 0 };
    for (const s of siswa) {
      total.H += s.H; total.S += s.S; total.I += s.I; total.A += s.A; total.B += s.B; total.total += s.total;
    }
    const siswaFiltered = data.siswaId
      ? (perSiswa.get(Number(data.siswaId)) ? siswa : [])
      : siswa;
    return {
      ...data, rows: cap(data.rows), siswa: siswaFiltered,
      mapel_ringkas: [...perMapel.values()].sort((a, b) => a.nama.localeCompare(b.nama)),
      total,
      kelas_list: kelasListAll(),
      siswa_list: dbm.siswaRows({ statusSiswa: 'aktif' }).map(s => ({
        id: s.id, nama: s.nama, nisn: s.nisn || '', kelas_id: s.kelas_id, kelas_nama: s.kelas_nama
      })),
      mapel_list: dbm.mapelList({ aktifOnly: false }),
      label_status: SISWA_LABEL
    };
  }

  get('/api/rekap/absensi-siswa', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_siswa', 'view')) return;
    const mode = q.mode === 'siswa' ? 'siswa' : 'kelas';
    const data = siswaRekap(q);
    json(res, 200, { ok: true, mode, auto_poin: dbm.absensiPoinConfig(), ...data });
  });

  /* peringkat: paling banyak izin / sakit / alfa / bolos */
  get('/api/rekap/ranking', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_siswa', 'view')) return;
    const data = siswaRekap(q);
    const limit = Math.max(3, Math.min(50, Number(q.limit) || 10));
    const sortBy = (key) => data.siswa
      .filter(s => (s[key] || 0) > 0)
      .sort((a, b) => (b[key] - a[key]) || String(a.nama).localeCompare(String(b.nama)))
      .slice(0, limit)
      .map((s, i) => ({ ...s, peringkat: i + 1, nilai: s[key] }));
    json(res, 200, {
      ok: true, dari: data.dari, sampai: data.sampai, label: data.label, periode: data.periode,
      ranking: {
        izin: sortBy('I'), sakit: sortBy('S'), alfa: sortBy('A'), bolos: sortBy('B')
      },
      total: data.total, jumlah_siswa: data.siswa.length,
      kelas_list: data.kelas_list, label_status: SISWA_LABEL
    });
  });

  function siswaPrint(data, mode) {
    const st = dbm.allSettings();
    const lihatSiswa = mode === 'siswa' && data.siswaId;
    const headSiswa = `<tr><th>No</th><th>NISN</th><th>Nama Siswa</th><th>Kelas</th>
      <th>Hadir</th><th>Sakit</th><th>Izin</th><th>Alpha</th><th>Bolos</th><th>Total</th><th>% Hadir</th></tr>`;
    const bodySiswa = data.siswa.map((s, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c">${e(s.nisn || '-')}</td><td>${e(s.nama)}</td><td>${e(s.kelas_nama || '-')}</td>
      <td class="c">${s.H}</td><td class="c">${s.S}</td><td class="c">${s.I}</td><td class="c">${s.A}</td>
      <td class="c">${s.B}</td><td class="c">${s.total}</td><td class="c">${s.persen_hadir}%</td></tr>`).join('')
      || '<tr><td colspan="11" class="c muted">Belum ada data pada periode ini.</td></tr>';
    const rincian = lu => lu.map((r, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c">${e(lib.tglID(r.tanggal))}</td><td>${e(r.siswa_nama || '-')}</td>
      <td>${e(r.kelas_nama || '-')}</td><td>${e(r.mapel_nama || '-')}</td><td class="c">${e(SISWA_LABEL[r.status] || r.status)}</td>
      <td>${e(r.keterangan || '-')}</td><td>${e(r.oleh_nama || r.pencatat || '-')}</td></tr>`).join('')
      || '<tr><td colspan="8" class="c muted">-</td></tr>';
    const body = `
      <div class="meta">
        <span>Periode: <b>${e(data.label)}</b></span>
        <span>Tahun Pelajaran: <b>${e((data.ta || {}).nama || '-')}</b></span>
        <span>Hadir: <b>${data.total.H}</b> · Sakit: <b>${data.total.S}</b> · Izin: <b>${data.total.I}</b>
          · Alpha: <b>${data.total.A}</b> · Bolos: <b>${data.total.B}</b></span>
      </div>
      <h3 class="sec">${lihatSiswa ? 'Akumulasi Kehadiran Siswa' : 'Rekap Per Siswa'}</h3>
      <table><thead>${headSiswa}</thead><tbody>${bodySiswa}</tbody></table>
      <h3 class="sec">Rincian Absensi</h3>
      <table><thead><tr><th>No</th><th>Tanggal</th><th>Nama Siswa</th><th>Kelas</th><th>Mata Pelajaran</th>
        <th>Status</th><th>Keterangan</th><th>Pencatat</th></tr></thead><tbody>${rincian(data.rows)}</tbody></table>
      ${data.rows.length >= 5000 ? '<p class="note">Tampilan dibatasi 5.000 baris — persempit periode atau unduh Excel untuk data lengkap.</p>' : ''}`;
    return printdoc.page({
      settings: st, title: 'Rekap Absensi Siswa', subtitle: `Periode ${data.label}`,
      body, paper: st.print_paper || 'A4', landscape: true
    });
  }

  get('/api/rekap/absensi-siswa/cetak', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_siswa', 'view')) return;
    const mode = q.mode === 'siswa' ? 'siswa' : 'kelas';
    const html = siswaPrint(siswaRekap(q), mode);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  get('/api/rekap/absensi-siswa/export', (req, res, q) => {
    if (!guard(req, res, 'rekap_absensi_siswa', 'view')) return;
    const data = siswaRekap(q);
    const head = [
      [{ v: 'REKAP ABSENSI SISWA', bold: true }],
      [{ v: `Periode: ${data.label}` }],
      [{ v: `Tahun Pelajaran: ${(data.ta || {}).nama || '-'}` }],
      [],
      ['NO', 'NISN', 'NIS', 'NAMA SISWA', 'KELAS', 'HADIR', 'SAKIT', 'IZIN', 'ALPHA', 'BOLOS', 'TOTAL PERTEMUAN', '% HADIR', 'TIDAK HADIR']
    ];
    const body = data.siswa.map((s, i) => [
      i + 1, s.nisn || '', s.nis || '', s.nama, s.kelas_nama || '', s.H, s.S, s.I, s.A, s.B, s.total, s.persen_hadir, s.tidak_hadir
    ]);
    const rincianHead = [];
    rincianHead.push([]);
    rincianHead.push([{ v: 'RINCIAN ABSENSI', bold: true }]);
    rincianHead.push(['NO', 'TANGGAL', 'NAMA SISWA', 'KELAS', 'MATA PELAJARAN', 'STATUS', 'KETERANGAN', 'PENCATAT']);
    const rincian = data.rows.map((r, i) => [
      i + 1, lib.tglID(r.tanggal), r.siswa_nama || '', r.kelas_nama || '', r.mapel_nama || '',
      SISWA_LABEL[r.status] || r.status, r.keterangan || '', r.oleh_nama || r.pencatat || ''
    ]);
    const rows = [...head, ...body, ...rincianHead, ...rincian];
    const buf = lib.xlsxBuffer('Rekap Absensi Siswa', rows, [5, 14, 12, 26, 16, 8, 8, 8, 8, 8, 16, 10, 12, 14, 20, 22, 12, 26, 20]);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="rekap-absensi-siswa-${data.dari}-${data.sampai}.xlsx"`
    });
    res.end(buf);
  });

  /* =================================================================
     2b. PENGHAPUSAN RIWAYAT ABSENSI (Bulk Delete & Filtered Delete)
     ---------------------------------------------------------------------
     Aman: wajib konfirmasi password/PIN akun, hasil penghapusan dicatat di
     Log Aktivitas dan snapshot baris yang dihapus disimpan (maks 3 berkas).
     ================================================================= */
  const SNAP_MAX = 3;
  function verifikasiPin(user, pin) {
    const p = String(pin || '').trim();
    if (!p) return { ok: false, pesan: 'Kata sandi / PIN konfirmasi wajib diisi.' };
    if (!lib.verifyPassword(p, user.pass_hash || '')) return { ok: false, pesan: 'Kata sandi konfirmasi salah.' };
    return { ok: true };
  }

  get('/api/rekap/absensi-siswa/hapus-info', (req, res) => {
    if (!guard(req, res, 'rekap_absensi_siswa', 'view')) return;
    json(res, 200, {
      ok: true,
      boleh: true,
      kelas: kelasListAll(),
      total: db.prepare('SELECT COUNT(*) c FROM absensi_siswa').get().c,
      sesi: db.prepare('SELECT COUNT(*) c FROM absensi_sesi').get().c
    });
  });

  /* hapus baris terpilih (cek box) */
  post('/api/rekap/absensi-siswa/hapus', async (req, res) => {
    const user = guard(req, res, 'rekap_absensi_siswa', 'write'); if (!user) return;
    const b = await readBody(req);
    const cek = verifikasiPin(user, b.pin);
    if (!cek.ok) return fail(res, 400, cek.pesan);
    const ids = (Array.isArray(b.ids) ? b.ids : String(b.ids || '').split(','))
      .map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return fail(res, 400, 'Pilih minimal satu baris riwayat absensi.');
    if (ids.length > 2000) return fail(res, 400, 'Maksimal 2.000 baris per sekali hapus.');
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM absensi_siswa WHERE id IN (${ph})`).all(...ids);
    if (!rows.length) return fail(res, 404, 'Baris yang dipilih sudah tidak ada.');
    const snap = dbm.snapshotJson('pre-hapus-absensi-siswa', { dibuat: dbm.now(), oleh: user.nama, ids, rows });
    const n = db.prepare(`DELETE FROM absensi_siswa WHERE id IN (${ph})`).run(...ids).changes;
    /* sesi yang seluruh barisnya dihapus tetap disimpan (token/QR masih bisa dipakai),
       tetapi penanda pencatat dihapus agar guru dapat mengisi ulang. */
    try { db.prepare(`DELETE FROM absensi_pencatat WHERE sesi_id IN (${rows.map(() => '?').join(',')})`).run(...[...new Set(rows.map(r => Number(r.sesi_id)))]); } catch (e) { /* opsional */ }
    dbm.logAudit(user, 'HAPUS', 'rekap_absensi_siswa',
      `Hapus ${n} baris riwayat absensi siswa (terpilih)${snap ? ' — snapshot tersimpan' : ''}`, ipOf(req));
    json(res, 200, { ok: true, dihapus: n, snapshot: snap ? 1 : 0, pesan: `${n} baris riwayat absensi siswa dihapus.` });
  });

  /* hapus berdasarkan filter tanggal & kelas */
  post('/api/rekap/absensi-siswa/hapus-filter', async (req, res) => {
    const user = guard(req, res, 'rekap_absensi_siswa', 'write'); if (!user) return;
    const b = await readBody(req);
    const cek = verifikasiPin(user, b.pin);
    if (!cek.ok) return fail(res, 400, cek.pesan);
    const dari = ISO_RE.test(String(b.dari || '')) ? String(b.dari) : '';
    const sampai = ISO_RE.test(String(b.sampai || '')) ? String(b.sampai) : dari;
    if (!dari) return fail(res, 400, 'Tanggal "Dari" wajib diisi.');
    const awal = dari <= sampai ? dari : sampai;
    const akhir = dari <= sampai ? sampai : dari;
    if (parseISO(akhir).getTime() - parseISO(awal).getTime() > 400 * 86400000) {
      return fail(res, 400, 'Rentang tanggal maksimal 400 hari.');
    }
    const kelasId = Number(b.kelas) || 0;
    const mapelId = Number(b.mapel) || 0;
    const where = ['a.tanggal BETWEEN ? AND ?'];
    const args = [awal, akhir];
    if (kelasId) { where.push('COALESCE(a.kelas_id, sd.kelas_id)=?'); args.push(kelasId); }
    if (mapelId) { where.push('COALESCE(s.mapel_id, j.mapel_id)=?'); args.push(mapelId); }
    const rows = db.prepare(`SELECT a.* FROM absensi_siswa a
      LEFT JOIN absensi_sesi s ON s.id=a.sesi_id
      LEFT JOIN jadwal j ON j.id=s.jadwal_id
      LEFT JOIN siswa sd ON sd.id=a.siswa_id
      WHERE ${where.join(' AND ')}`).all(...args);
    if (!rows.length) return fail(res, 404, 'Tidak ada riwayat absensi yang cocok dengan filter tersebut.');
    if (rows.length > 20000) return fail(res, 400, 'Hasil filter melebihi 20.000 baris — persempit rentang tanggal/kelas.');
    const snap = dbm.snapshotJson('pre-hapus-absensi-siswa', {
      dibuat: dbm.now(), oleh: user.nama, filter: { dari: awal, sampai: akhir, kelas: kelasId, mapel: mapelId }, rows
    });
    const ids = rows.map(r => Number(r.id));
    let n = 0;
    db.transaction(() => {
      const ph = ids.map(() => '?').join(',');
      n = db.prepare(`DELETE FROM absensi_siswa WHERE id IN (${ph})`).run(...ids).changes;
      const sesiIds = [...new Set(rows.map(r => Number(r.sesi_id)).filter(Boolean))];
      if (sesiIds.length) {
        const sph = sesiIds.map(() => '?').join(',');
        try { db.prepare(`DELETE FROM absensi_pencatat WHERE sesi_id IN (${sph})`).run(...sesiIds); } catch (e) { /* opsional */ }
      }
    })();
    const kelasNama = kelasId ? ((kelasListAll().find(k => Number(k.id) === kelasId) || {}).nama || '') : 'Semua kelas';
    dbm.logAudit(user, 'HAPUS', 'rekap_absensi_siswa',
      `Hapus ${n} baris riwayat absensi siswa (${awal} s.d. ${akhir}, ${kelasNama})${snap ? ' — snapshot tersimpan' : ''}`, ipOf(req));
    json(res, 200, {
      ok: true, dihapus: n, snapshot: snap ? 1 : 0, dari: awal, sampai: akhir,
      pesan: `${n} baris riwayat absensi siswa (${awal} s.d. ${akhir} · ${kelasNama}) dihapus.`
    });
  });

  /* ---------- absensi GURU: hapus terpilih & per tanggal ---------- */
  get('/api/rekap/absensi-guru/hapus-info', (req, res) => {
    if (!guard(req, res, 'rekap_absensi_guru', 'view')) return;
    json(res, 200, {
      ok: true,
      total: db.prepare('SELECT COUNT(*) c FROM absensi_guru').get().c,
      izin: db.prepare('SELECT COUNT(*) c FROM absensi_guru_izin').get().c
    });
  });

  post('/api/rekap/absensi-guru/hapus', async (req, res) => {
    const user = guard(req, res, 'rekap_absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const cek = verifikasiPin(user, b.pin);
    if (!cek.ok) return fail(res, 400, cek.pesan);
    /* items: [{jadwal_id, tanggal}] — baris rekap guru tidak memiliki id baris
       (slot yang belum diabsen pun tampil), jadi kunci pasangan slot+tanggal. */
    const items = (Array.isArray(b.items) ? b.items : []).map(it => ({
      jadwal_id: Number(it && it.jadwal_id) || 0,
      tanggal: ISO_RE.test(String((it && it.tanggal) || '')) ? String(it.tanggal) : ''
    })).filter(it => it.jadwal_id && it.tanggal);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(x => Number(x)).filter(n => n > 0);
    if (!items.length && !ids.length) return fail(res, 400, 'Pilih minimal satu baris absensi guru.');
    if (items.length > 2000) return fail(res, 400, 'Maksimal 2.000 baris per sekali hapus.');
    const rows = [];
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      rows.push(...db.prepare(`SELECT * FROM absensi_guru WHERE id IN (${ph})`).all(...ids));
    }
    for (const it of items) {
      const r = db.prepare('SELECT * FROM absensi_guru WHERE jadwal_id=? AND tanggal=?').get(it.jadwal_id, it.tanggal);
      if (r && !rows.some(x => Number(x.id) === Number(r.id))) rows.push(r);
    }
    if (!rows.length) return fail(res, 404, 'Baris absensi guru yang dipilih sudah tidak ada.');
    const snap = dbm.snapshotJson('pre-hapus-absensi-guru', { dibuat: dbm.now(), oleh: user.nama, rows });
    let n = 0;
    db.transaction(() => {
      const ph = rows.map(() => '?').join(',');
      n = db.prepare(`DELETE FROM absensi_guru WHERE id IN (${ph})`).run(...rows.map(r => Number(r.id))).changes;
    })();
    dbm.logAudit(user, 'HAPUS', 'rekap_absensi_guru',
      `Hapus ${n} baris absensi guru (terpilih)${snap ? ' — snapshot tersimpan' : ''}`, ipOf(req));
    json(res, 200, { ok: true, dihapus: n, snapshot: snap ? 1 : 0, pesan: `${n} baris absensi guru dihapus.` });
  });

  post('/api/rekap/absensi-guru/hapus-filter', async (req, res) => {
    const user = guard(req, res, 'rekap_absensi_guru', 'write'); if (!user) return;
    const b = await readBody(req);
    const cek = verifikasiPin(user, b.pin);
    if (!cek.ok) return fail(res, 400, cek.pesan);
    const dari = ISO_RE.test(String(b.dari || '')) ? String(b.dari) : '';
    const sampai = ISO_RE.test(String(b.sampai || '')) ? String(b.sampai) : dari;
    if (!dari) return fail(res, 400, 'Tanggal wajib diisi.');
    const awal = dari <= sampai ? dari : sampai;
    const akhir = dari <= sampai ? sampai : dari;
    if (parseISO(akhir).getTime() - parseISO(awal).getTime() > 400 * 86400000) {
      return fail(res, 400, 'Rentang tanggal maksimal 400 hari.');
    }
    const guruId = Number(b.guru) || 0;
    const where = ['tanggal BETWEEN ? AND ?'];
    const args = [awal, akhir];
    if (guruId) { where.push('guru_id=?'); args.push(guruId); }
    const rows = db.prepare(`SELECT * FROM absensi_guru WHERE ${where.join(' AND ')}`).all(...args);
    const izinRows = db.prepare(`SELECT * FROM absensi_guru_izin WHERE ${where.join(' AND ')}`).all(...args);
    if (!rows.length && !izinRows.length) return fail(res, 404, 'Tidak ada absensi guru pada rentang tanggal tersebut.');
    if (rows.length > 20000) return fail(res, 400, 'Hasil filter melebihi 20.000 baris — persempit rentang tanggal.');
    const snap = dbm.snapshotJson('pre-hapus-absensi-guru', {
      dibuat: dbm.now(), oleh: user.nama, filter: { dari: awal, sampai: akhir, guru: guruId }, rows, izinRows
    });
    let n = 0;
    db.transaction(() => {
      const sql = `DELETE FROM absensi_guru WHERE ${where.join(' AND ')}`;
      n = db.prepare(sql).run(...args).changes;
      db.prepare(`DELETE FROM absensi_guru_izin WHERE ${where.join(' AND ')}`).run(...args);
    })();
    const namaGuru = guruId ? ((db.prepare('SELECT nama FROM users WHERE id=?').get(guruId) || {}).nama || '') : 'Semua guru';
    dbm.logAudit(user, 'HAPUS', 'rekap_absensi_guru',
      `Hapus ${n} baris absensi guru (${awal} s.d. ${akhir}, ${namaGuru})${snap ? ' — snapshot tersimpan' : ''}`, ipOf(req));
    json(res, 200, { ok: true, dihapus: n, snapshot: snap ? 1 : 0, pesan: `${n} baris absensi guru (${awal} s.d. ${akhir}) dihapus.` });
  });

  /* =================================================================
     2c. REKAP BULANAN TERPADU (PORTOFOLIO KELAS) — Wali Kelas & Guru BK
     ---------------------------------------------------------------------
     Menggabungkan tiga sumber data satu bulan:
       · persentase kehadiran siswa (H/S/I/A/B) dari presensi per mapel
       · rekapitulasi catatan pelanggaran & prestasi (Input Kejadian)
       · ringkasan hasil asesmen BK (AKPD, RIASEC, Gaya Belajar, Kesulitan)
     Ditutup dengan kop sekolah + blok tanda tangan Kepala Sekolah, Wali Kelas
     (atau Guru BK). Ekspor: PDF (cetak), Excel (.xlsx), Word (.doc).
     ================================================================= */
  const bulanOf = (v) => {
    const t = String(v || '');
    if (/^\d{4}-\d{2}$/.test(t)) return t;
    return todayISO().slice(0, 7);
  };
  const bulanLabel = (ym) => {
    const y = Number(String(ym).slice(0, 4)), m = Number(String(ym).slice(5, 7));
    return `${lib.BULAN[(m || 1) - 1]} ${y}`;
  };
  const kelasById = (id) => db.prepare(`SELECT k.*, u.nama AS wali_nama, COALESCE(u.nip,'') AS wali_nip,
      COALESCE(u.phone,'') AS wali_phone
    FROM kelas k LEFT JOIN users u ON u.id=k.wali_id WHERE k.id=?`).get(Number(id) || 0) || null;
  /** kelas yang boleh dilihat pengguna: wali kelas → kelasnya; BK/kurikulum/admin → semua */
  function kelasBoleh(user) {
    const roles = dbm.userRoleList(user);
    const luas = roles.some(r => ['admin', 'kepala_sekolah', 'wakasek_kurikulum', 'guru_bk', 'kesiswaan', 'tu'].includes(r));
    const list = kelasListAll();
    if (luas) return { luas: true, list };
    const milik = list.filter(k => Number(k.wali_id) === Number(user.id));
    return { luas: false, list: milik };
  }

  function rekapBulanan(opt = {}) {
    const user = opt.user || {};
    const boleh = kelasBoleh(user);
    const daftarKelas = boleh.list.length ? boleh.list : kelasListAll();
    const ym = bulanOf(opt.bulan);
    const kelasId = Number(opt.kelas) || (boleh.luas ? (daftarKelas[0] || {}).id : (boleh.list[0] || {}).id) || 0;
    const k = kelasById(kelasId);
    if (!k) return { error: 'Kelas belum dipilih.', kelas_list: daftarKelas, bulan: ym, label: bulanLabel(ym) };
    if (!boleh.luas && !boleh.list.some(x => Number(x.id) === Number(kelasId))) {
      return { error: 'Anda hanya dapat melihat rekap kelas yang Anda ampu.', kelas_list: boleh.list, bulan: ym, label: bulanLabel(ym) };
    }
    const dari = `${ym}-01`;
    const akhirBulan = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const sampai = `${ym}-${String(akhirBulan).padStart(2, '0')}`;
    const siswaList = dbm.siswaRows({ kelasId: Number(kelasId), statusSiswa: 'aktif' });
    const idSet = new Set(siswaList.map(s => Number(s.id)));

    /* ---------- 1) KEHADIRAN ---------- */
    const absRows = db.prepare(`SELECT a.siswa_id, a.status, a.tanggal FROM absensi_siswa a
      LEFT JOIN siswa sd ON sd.id=a.siswa_id
      WHERE a.tanggal BETWEEN ? AND ? AND COALESCE(a.kelas_id, sd.kelas_id)=?`).all(dari, sampai, Number(kelasId));
    const hadir = new Map();
    for (const r of absRows) {
      if (!idSet.has(Number(r.siswa_id))) continue;
      const o = hadir.get(Number(r.siswa_id)) || { H: 0, S: 0, I: 0, A: 0, B: 0, total: 0 };
      o[r.status] = (o[r.status] || 0) + 1;
      o.total++;
      hadir.set(Number(r.siswa_id), o);
    }

    /* ---------- 2) KEJADIAN (pelanggaran & prestasi) ---------- */
    const kejRows = db.prepare(`SELECT e.siswa_id, e.tanggal, e.jenis, e.poin, e.keterangan, k.nama AS kategori,
        e.sumber, e.lokasi, e.jam
      FROM kejadian e LEFT JOIN kategori k ON k.id=e.kategori_id
      WHERE e.tanggal BETWEEN ? AND ? ORDER BY e.tanggal DESC`).all(dari, sampai);
    const kejMap = new Map();
    const rincianKejadian = [];
    for (const r of kejRows) {
      if (!idSet.has(Number(r.siswa_id))) continue;
      const o = kejMap.get(Number(r.siswa_id)) || { pel: 0, pres: 0, jumlah: 0 };
      if (r.jenis === 'prestasi') o.pres += Number(r.poin) || 0; else o.pel += Number(r.poin) || 0;
      o.jumlah++;
      kejMap.set(Number(r.siswa_id), o);
      rincianKejadian.push(r);
    }

    /* ---------- 3) ASESMEN BK (ringkasan per instrumen) ---------- */
    const ins = db.prepare('SELECT kode, nama FROM asesmen_instrumen ORDER BY kode').all();
    const asesmenRingkas = ins.map(i => {
      const rows = db.prepare(`SELECT skor FROM asesmen_hasil WHERE kode=? AND kelas_id=?`).all(i.kode, Number(kelasId));
      const dims = dbm.ASESMEN_KATEGORI[i.kode] || [];
      const agg = {};
      dims.forEach(d => { agg[d.key] = { label: d.label, sum: 0, count: 0 }; });
      for (const r of rows) {
        const dimS = (r.skor && r.skor.dim) || {};
        for (const d of dims) {
          const s = dimS[d.key];
          if (!s) continue;
          agg[d.key].sum += Number(s.sum) || 0;
          agg[d.key].count += Number(s.count) || 0;
        }
      }
      const dist = dims.map(d => ({
        key: d.key, label: d.label,
        pct: agg[d.key].count ? Math.round((agg[d.key].sum / agg[d.key].count) * 1000) / 10 : 0
      })).sort((a, b) => b.pct - a.pct);
      return {
        kode: i.kode, nama: i.nama, jumlah_terisi: rows.length,
        total_siswa: siswaList.length, distribusi: dist, utama: dist[0] || null
      };
    });

    /* ---------- gabungkan per siswa ---------- */
    const siswa = siswaList.map(s => {
      const h = hadir.get(Number(s.id)) || { H: 0, S: 0, I: 0, A: 0, B: 0, total: 0 };
      const kj = kejMap.get(Number(s.id)) || { pel: 0, pres: 0, jumlah: 0 };
      return {
        siswa_id: s.id, nama: s.nama, nisn: s.nisn || '', nis: s.nis || '',
        H: h.H, S: h.S, I: h.I, A: h.A, B: h.B, total: h.total,
        persen_hadir: h.total ? Math.round((h.H / h.total) * 1000) / 10 : 0,
        pel: kj.pel, pres: kj.pres, poin_bersih: kj.pel - kj.pres, jumlah_kejadian: kj.jumlah
      };
    }).sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
    const total = siswa.reduce((a, s) => ({
      H: a.H + s.H, S: a.S + s.S, I: a.I + s.I, A: a.A + s.A, B: a.B + s.B, total: a.total + s.total,
      pel: a.pel + s.pel, pres: a.pres + s.pres, kejadian: a.kejadian + s.jumlah_kejadian
    }), { H: 0, S: 0, I: 0, A: 0, B: 0, total: 0, pel: 0, pres: 0, kejadian: 0 });
    const totalPersen = total.total ? Math.round((total.H / total.total) * 1000) / 10 : 0;
    return {
      bulan: ym, label: bulanLabel(ym), dari, sampai,
      kelas: { id: k.id, nama: k.nama, tingkat: k.tingkat, wali_id: k.wali_id || null, wali_nama: k.wali_nama || '', wali_nip: k.wali_nip || '', wali_phone: k.wali_phone || '' },
      kelas_list: daftarKelas,
      luas: boleh.luas,
      siswa, total, total_persen: totalPersen,
      asesmen: asesmenRingkas,
      kejadian: rincianKejadian.slice(0, 300),
      jumlah_kejadian: rincianKejadian.length,
      ta: dbm.tahunById(rangeOf({}).taId) || {},
      sekolah: dbm.allSettings()
    };
  }

  const qBulanan = (q) => ({
    bulan: q.bulan, kelas: q.kelas, ta: q.ta
  });

  get('/api/rekap-bulanan', (req, res, q) => {
    const user = guard(req, res, 'rekap_bulanan', 'view'); if (!user) return;
    const d = rekapBulanan({ ...qBulanan(q), user });
    if (d.error) return fail(res, 400, d.error, { kelas_list: d.kelas_list });
    json(res, 200, { ok: true, ...d, kejadian: d.kejadian.slice(0, 60) });
  });

  /* ---- dokumen: kop + 3 blok tanda tangan ---- */
  function bulananTtd(d, opsi = {}) {
    const st = d.sekolah || {};
    const kanan = opsi.peran === 'bk'
      ? { label: 'Guru Bimbingan Konseling', nama: (opsi.user && opsi.user.nama) || '', nip: (opsi.user && opsi.user.nip) || '' }
      : { label: 'Wali Kelas ' + (d.kelas.nama || ''), nama: d.kelas.wali_nama || '', nip: d.kelas.wali_nip || '' };
    return `<div class="tanggal">${lib.esc(String(st.print_tempat || '').trim() ? String(st.print_tempat).trim() + ', ' : '')}${lib.esc(lib.tglID(todayISO()))}</div>
      <div class="ttd-grid three">
        <div class="ttd"><div>Mengetahui,</div><div>Kepala ${lib.esc(st.sekolah_nama || 'Sekolah')}</div>
          <div class="ruang"></div><div class="nama">${lib.esc(st.kepala_nama || '.................................')}</div>
          <div class="nip">NIP. ${lib.esc(st.kepala_nip || '-')}</div></div>
        <div class="ttd"><div>&nbsp;</div><div>${lib.esc(kanan.label)}</div>
          <div class="ruang"></div><div class="nama">${lib.esc(kanan.nama || '.................................')}</div>
          <div class="nip">NIP. ${lib.esc(kanan.nip || '-')}</div></div>
        <div class="ttd"><div>&nbsp;</div><div>Guru Bimbingan Konseling</div>
          <div class="ruang"></div><div class="nama">${lib.esc((opsi.bk && opsi.bk.nama) || '.................................')}</div>
          <div class="nip">NIP. ${lib.esc((opsi.bk && opsi.bk.nip) || '-')}</div></div>
      </div>`;
  }
  const TTD_CSS = `
    .tanggal { text-align: right; font-size: 10pt; margin-top: 14px; }
    .ttd-grid { display: flex; justify-content: space-between; gap: 16px; margin-top: 6px; page-break-inside: avoid; }
    .ttd { flex: 1; text-align: center; font-size: 9.6pt; }
    .ttd .ruang { height: 52px; }
    .ttd .nama { font-weight: 700; text-decoration: underline; }
    .ttd .nip { font-size: 9pt; }
    .subjudul-kecil { font-size: 10pt; color: #475569; margin: 14px 0 4px; font-weight: 700; }
  `;

  function bulananBody(d) {
    const barisSiswa = d.siswa.map((s, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c">${lib.esc(s.nisn || '-')}</td><td>${lib.esc(s.nama)}</td>
      <td class="c">${s.H}</td><td class="c">${s.S}</td><td class="c">${s.I}</td><td class="c">${s.A}</td>
      <td class="c">${s.B}</td><td class="c">${s.total}</td><td class="c">${s.persen_hadir}%</td>
      <td class="c">${s.pel}</td><td class="c">${s.pres}</td><td class="c">${s.poin_bersih}</td></tr>`).join('')
      || '<tr><td colspan="13" class="c muted">Belum ada siswa aktif pada kelas ini.</td></tr>';
    const asesmen = d.asesmen.map(a => `<tr>
      <td>${lib.esc(a.nama)}</td><td class="c">${a.jumlah_terisi}/${a.total_siswa}</td>
      <td>${lib.esc(a.utama ? a.utama.label : '-')}</td>
      <td>${a.distribusi.slice(0, 4).map(x => `${lib.esc(x.label)}: <b>${x.pct}%</b>`).join(' · ') || '-'}</td></tr>`).join('');
    const kejadian = d.kejadian.slice(0, 40).map((r, i) => `<tr>
      <td class="c">${i + 1}</td><td class="c">${lib.esc(lib.tglID(r.tanggal))}</td>
      <td>${lib.esc(r.kategori || '-')}</td><td class="c">${r.jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran'}</td>
      <td class="c">${r.poin}</td><td>${lib.esc(r.keterangan || '-')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="c muted">Tidak ada catatan kejadian pada bulan ini.</td></tr>';
    return `
      <div class="meta">
        <span>Kelas: <b>${lib.esc(d.kelas.nama)}</b></span>
        <span>Wali Kelas: <b>${lib.esc(d.kelas.wali_nama || '-')}</b></span>
        <span>Periode: <b>${lib.esc(d.label)}</b> (${lib.esc(lib.tglID(d.dari))} – ${lib.esc(lib.tglID(d.sampai))})</span>
        <span>Tahun Pelajaran: <b>${lib.esc((d.ta || {}).nama || '-')}</b></span>
        <span>Siswa: <b>${d.siswa.length}</b></span>
      </div>
      <h3 class="sec">A. Rekapitulasi Kehadiran &amp; Poin Kedisiplinan</h3>
      <table><thead><tr><th>No</th><th>NISN</th><th>Nama Siswa</th><th>H</th><th>S</th><th>I</th><th>A</th><th>B</th>
        <th>Total</th><th>% Hadir</th><th>Poin Pelanggaran</th><th>Poin Prestasi</th><th>Poin Bersih</th></tr></thead>
        <tbody>${barisSiswa}</tbody>
        <tfoot><tr><td colspan="3">JUMLAH</td><td class="c">${d.total.H}</td><td class="c">${d.total.S}</td>
          <td class="c">${d.total.I}</td><td class="c">${d.total.A}</td><td class="c">${d.total.B}</td>
          <td class="c">${d.total.total}</td><td class="c">${d.total_persen}%</td>
          <td class="c">${d.total.pel}</td><td class="c">${d.total.pres}</td><td class="c">${d.total.pel - d.total.pres}</td></tr></tfoot></table>
      <h3 class="sec">B. Ringkasan Hasil Asesmen BK</h3>
      <table><thead><tr><th>Instrumen</th><th>Terisi</th><th>Kecenderungan Utama</th><th>Sebaran</th></tr></thead>
        <tbody>${asesmen || '<tr><td colspan="4" class="c muted">Belum ada instrumen asesmen.</td></tr>'}</tbody></table>
      <h3 class="sec">C. Catatan Pelanggaran &amp; Prestasi (Input Kejadian)</h3>
      <table><thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Jenis</th><th>Poin</th><th>Keterangan</th></tr></thead>
        <tbody>${kejadian}</tbody></table>
      ${d.jumlah_kejadian > 40 ? `<p class="note">Ditampilkan 40 catatan terbaru dari ${d.jumlah_kejadian} catatan — daftar lengkap ada pada ekspor Excel.</p>` : ''}
    `;
  }

  get('/api/rekap-bulanan/cetak', (req, res, q) => {
    const user = guard(req, res, 'rekap_bulanan', 'view'); if (!user) return;
    const d = rekapBulanan({ ...qBulanan(q), user });
    if (d.error) return fail(res, 400, d.error);
    const roles = dbm.userRoleList(user);
    const peran = (roles.includes('guru_bk') && !roles.includes('wali_kelas')) ? 'bk' : 'wali';
    const bkPetugas = peran === 'bk' ? { nama: user.nama, nip: user.nip || '' } : null;
    const html = printdoc.page({
      settings: d.sekolah,
      title: 'Rekapitulasi Bulanan Portofolio Kelas',
      subtitle: `${d.kelas.nama} — ${d.label}`,
      paper: (d.sekolah.print_paper || 'A4'),
      landscape: true,
      css: TTD_CSS,
      body: `${bulananBody(d)}${bulananTtd(d, { peran, user, bk: bkPetugas })}`
    });
    dbm.logAudit(user, 'CETAK', 'rekap_bulanan', `Cetak rekap bulanan ${d.kelas.nama} — ${d.label}`, ipOf(req));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  get('/api/rekap-bulanan/export', (req, res, q) => {
    const user = guard(req, res, 'rekap_bulanan', 'view'); if (!user) return;
    const d = rekapBulanan({ ...qBulanan(q), user });
    if (d.error) return fail(res, 400, d.error);
    const st = d.sekolah || {};
    const head = [
      [{ v: (st.sekolah_nama || '').toUpperCase(), bold: true }],
      [{ v: st.sekolah_alamat || '' }],
      [{ v: 'REKAPITULASI BULANAN PORTOFOLIO KELAS', bold: true }],
      [{ v: `Kelas: ${d.kelas.nama} · Wali Kelas: ${d.kelas.wali_nama || '-'} · Periode: ${d.label}` }],
      [],
      [{ v: 'A. KEHADIRAN & POIN', bold: true }],
      ['NO', 'NISN', 'NAMA SISWA', 'HADIR', 'SAKIT', 'IZIN', 'ALPHA', 'BOLOS', 'TOTAL', '% HADIR', 'POIN PELANGGARAN', 'POIN PRESTASI', 'POIN BERSIH']
    ];
    const body = d.siswa.map((s, i) => [i + 1, s.nisn || '', s.nama, s.H, s.S, s.I, s.A, s.B, s.total,
      `${s.persen_hadir}%`, s.pel, s.pres, s.poin_bersih]);
    const totalRow = ['', '', 'JUMLAH', d.total.H, d.total.S, d.total.I, d.total.A, d.total.B, d.total.total,
      `${d.total_persen}%`, d.total.pel, d.total.pres, d.total.pel - d.total.pres];
    const asesmenHead = [[], [{ v: 'B. RINGKASAN ASESMEN BK', bold: true }],
      ['INSTRUMEN', 'TERISI', 'KECENDERUNGAN UTAMA', 'SEBARAN']];
    const asesmenBody = d.asesmen.map(a => [a.nama, `${a.jumlah_terisi}/${a.total_siswa}`,
      a.utama ? a.utama.label : '-', a.distribusi.slice(0, 4).map(x => `${x.label} ${x.pct}%`).join(' · ')]);
    const kejHead = [[], [{ v: 'C. CATATAN PELANGGARAN & PRESTASI', bold: true }],
      ['NO', 'TANGGAL', 'KATEGORI', 'JENIS', 'POIN', 'KETERANGAN', 'NAMA SISWA']];
    const namaById = new Map(d.siswa.map(s => [Number(s.siswa_id), s.nama]));
    const kejBody = d.kejadian.map((r, i) => [i + 1, lib.tglID(r.tanggal), r.kategori || '', r.jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran',
      r.poin, r.keterangan || '', namaById.get(Number(r.siswa_id)) || '']);
    const ttd = [[], [{ v: `Tanda tangan: Kepala Sekolah (${st.kepala_nama || '-'}) · Wali Kelas (${d.kelas.wali_nama || '-'})` }]];
    const rows = [...head, ...body, totalRow, ...asesmenHead, ...asesmenBody, ...kejHead, ...kejBody, ...ttd];
    const buf = lib.xlsxBuffer(`Rekap ${d.kelas.nama}`.slice(0, 30), rows,
      [5, 14, 26, 7, 7, 7, 7, 7, 8, 9, 16, 14, 12, 22, 26, 18, 10, 30, 24]);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="rekap-bulanan-${String(d.kelas.nama).replace(/[^\w]+/g, '-')}-${d.bulan}.xlsx"`
    });
    res.end(buf);
    dbm.logAudit(user, 'EXPORT', 'rekap_bulanan', `Ekspor Excel rekap bulanan ${d.kelas.nama} — ${d.label}`, ipOf(req));
  });

  get('/api/rekap-bulanan/word', (req, res, q) => {
    const user = guard(req, res, 'rekap_bulanan', 'view'); if (!user) return;
    const d = rekapBulanan({ ...qBulanan(q), user });
    if (d.error) return fail(res, 400, d.error);
    const st = d.sekolah || {};
    const esc = lib.esc;
    const rowsHtml = d.siswa.map((s, i) => `<tr><td align="center">${i + 1}</td><td align="center">${esc(s.nisn || '-')}</td>
      <td>${esc(s.nama)}</td><td align="center">${s.H}</td><td align="center">${s.S}</td><td align="center">${s.I}</td>
      <td align="center">${s.A}</td><td align="center">${s.B}</td><td align="center">${s.total}</td>
      <td align="center">${s.persen_hadir}%</td><td align="center">${s.pel}</td><td align="center">${s.pres}</td>
      <td align="center"><b>${s.poin_bersih}</b></td></tr>`).join('');
    const asesmenHtml = d.asesmen.map(a => `<tr><td>${esc(a.nama)}</td><td align="center">${a.jumlah_terisi}/${a.total_siswa}</td>
      <td>${esc(a.utama ? a.utama.label : '-')}</td><td>${esc(a.distribusi.slice(0, 4).map(x => `${x.label} ${x.pct}%`).join(' · '))}</td></tr>`).join('');
    const kejHtml = d.kejadian.slice(0, 60).map((r, i) => `<tr><td align="center">${i + 1}</td>
      <td align="center">${esc(lib.tglID(r.tanggal))}</td><td>${esc(r.kategori || '-')}</td>
      <td align="center">${r.jenis === 'prestasi' ? 'Prestasi' : 'Pelanggaran'}</td>
      <td align="center">${r.poin}</td><td>${esc(r.keterangan || '-')}</td></tr>`).join('');
    const bodyWord = `
    <h4 class="sec">A. Kehadiran &amp; Poin Kedisiplinan</h4>
    <table><thead><tr><th>NO</th><th>NISN</th><th>NAMA SISWA</th><th>H</th><th>S</th><th>I</th><th>A</th><th>B</th>
      <th>TOTAL</th><th>% HADIR</th><th>PEL</th><th>PRES</th><th>BERSIH</th></tr></thead><tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="3"><b>JUMLAH</b></td><td align="center"><b>${d.total.H}</b></td><td align="center"><b>${d.total.S}</b></td>
      <td align="center"><b>${d.total.I}</b></td><td align="center"><b>${d.total.A}</b></td><td align="center"><b>${d.total.B}</b></td>
      <td align="center"><b>${d.total.total}</b></td><td align="center"><b>${d.total_persen}%</b></td>
      <td align="center"><b>${d.total.pel}</b></td><td align="center"><b>${d.total.pres}</b></td>
      <td align="center"><b>${d.total.pel - d.total.pres}</b></td></tr></tfoot></table>
    <h4 class="sec">B. Ringkasan Hasil Asesmen BK</h4>
    <table><thead><tr><th>INSTRUMEN</th><th>TERISI</th><th>KECENDERUNGAN UTAMA</th><th>SEBARAN</th></tr></thead><tbody>${asesmenHtml || '<tr><td colspan="4" align="center">-</td></tr>'}</tbody></table>
    <h4 class="sec">C. Catatan Pelanggaran &amp; Prestasi</h4>
    <table><thead><tr><th>NO</th><th>TANGGAL</th><th>KATEGORI</th><th>JENIS</th><th>POIN</th><th>KETERANGAN</th></tr></thead><tbody>${kejHtml || '<tr><td colspan="6" align="center">-</td></tr>'}</tbody></table>
    <p style="text-align:right;margin-top:18px">${esc(String(st.print_tempat || '').trim() ? String(st.print_tempat).trim() + ', ' : '')}${esc(lib.tglID(todayISO()))}</p>
    <table class="ttd"><tr>
      <td>Mengetahui,<br>Kepala ${esc(st.sekolah_nama || 'Sekolah')}<br><br><br><br>
        <b><u>${esc(st.kepala_nama || '........................')}</u></b><br>NIP. ${esc(st.kepala_nip || '-')}</td>
      <td>Wali Kelas ${esc(d.kelas.nama)}<br><br><br><br><br>
        <b><u>${esc(d.kelas.wali_nama || '........................')}</u></b><br>NIP. ${esc(d.kelas.wali_nip || '-')}</td>
    </tr></table>
    <p class="note">Dicetak: ${esc(lib.stampID())}</p>`;
    const html = doc.wordPage({
      settings: st, title: 'REKAPITULASI BULANAN PORTOFOLIO KELAS',
      subtitle: `Kelas ${d.kelas.nama} — ${d.label} · Wali Kelas: ${d.kelas.wali_nama || '-'}`,
      landscape: true, body: bodyWord
    });
    res.writeHead(200, {
      'Content-Type': 'application/msword; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="rekap-bulanan-${String(d.kelas.nama).replace(/[^\w]+/g, '-')}-${d.bulan}.doc"`
    });
    res.end(html);
    dbm.logAudit(user, 'EXPORT', 'rekap_bulanan', `Ekspor Word rekap bulanan ${d.kelas.nama} — ${d.label}`, ipOf(req));
  });

  /* =================================================================
     3. PENGATURAN & OTOMATISASI WHATSAPP WALI KELAS
     ================================================================= */
  function waKelasConfig() {
    const hari = String(dbm.getSetting('absensi_wa_kelas_hari', '1,2,3,4,5'))
      .split(',').map(x => Number(x)).filter(n => n >= 0 && n <= 6);
    return {
      aktif: String(dbm.getSetting('absensi_wa_kelas_aktif', '0')) === '1',
      jam: String(dbm.getSetting('absensi_wa_kelas_jam', '15:00')) || '15:00',
      hari: hari.length ? hari : [1, 2, 3, 4, 5],
      terakhir: String(dbm.getSetting('absensi_wa_kelas_terakhir', '') || ''),
      gateway: dbm.waConfig()
    };
  }

  get('/api/rekap-absensi/pengaturan', (req, res) => {
    const user = guard(req, res, 'rekap_absensi_siswa', 'view'); if (!user) return;
    const cfg = waKelasConfig();
    json(res, 200, {
      ok: true,
      config: { ...cfg, gateway: { aktif: !!(cfg.gateway.aktif && cfg.gateway.url), source: cfg.gateway.source || '' } },
      poin: dbm.absensiPoinConfig(),
      kelas: kelasWithWali().map(k => ({ ...k, jumlah_siswa: db.prepare("SELECT COUNT(*) c FROM siswa WHERE kelas_id=? AND COALESCE(status,'aktif')='aktif'").get(k.id).c })),
      hari_label: dbm.HARI_LABEL
    });
  });

  post('/api/rekap-absensi/pengaturan', async (req, res) => {
    const user = guard(req, res, 'rekap_absensi_siswa', 'write'); if (!user) return;
    const b = await readBody(req);
    const jam = String(b.jam || '15:00').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(jam)) return fail(res, 400, 'Jam pengiriman tidak valid (format HH:MM, mis. 15:00).');
    const hari = [].concat(b.hari || []).map(x => Number(x)).filter(n => n >= 0 && n <= 6);
    if (!hari.length) return fail(res, 400, 'Pilih minimal satu hari pengiriman.');
    const aktif = b.aktif === 1 || b.aktif === '1' || b.aktif === true ? '1' : '0';
    const autoPoin = b.auto_poin === 1 || b.auto_poin === '1' || b.auto_poin === true ? '1' : '0';
    dbm.setSetting('absensi_wa_kelas_jam', jam);
    dbm.setSetting('absensi_wa_kelas_hari', [...new Set(hari)].sort((a, c) => a - c).join(','));
    dbm.setSetting('absensi_wa_kelas_aktif', aktif);
    dbm.setSetting('absensi_auto_poin', autoPoin);
    dbm.logAudit(user, 'UBAH', 'rekap_absensi_siswa',
      `Pengaturan rekap WA wali kelas: ${aktif === '1' ? 'aktif' : 'nonaktif'} ${jam} (${hari.join(',')}) · poin otomatis ${autoPoin === '1' ? 'aktif' : 'nonaktif'}`, ipOf(req));
    json(res, 200, { ok: true, pesan: 'Pengaturan rekap absensi tersimpan.' });
  });

  /* ---- isi pesan rekap per kelas ---- */
  function kelasAbsensiHarian(kelasId, tanggal) {
    const kelas = db.prepare(`SELECT k.*, u.nama AS wali_nama, COALESCE(u.phone,'') AS wali_phone
      FROM kelas k LEFT JOIN users u ON u.id=k.wali_id WHERE k.id=?`).get(Number(kelasId));
    if (!kelas) return null;
    const rows = db.prepare(`SELECT a.status, a.keterangan, sd.nama AS siswa_nama, m.nama AS mapel_nama, j.sesi
      FROM absensi_siswa a
      LEFT JOIN absensi_sesi s ON s.id=a.sesi_id
      LEFT JOIN jadwal j ON j.id=s.jadwal_id
      LEFT JOIN mapel m ON m.id=s.mapel_id
      LEFT JOIN siswa sd ON sd.id=a.siswa_id
      WHERE a.tanggal=? AND a.kelas_id=? ORDER BY j.sesi, sd.nama`).all(tanggal, Number(kelasId));
    const hitung = { H: 0, S: 0, I: 0, A: 0, B: 0 };
    const perMapel = new Map();
    const nama = { S: [], I: [], A: [], B: [] };
    for (const r of rows) {
      hitung[r.status] = (hitung[r.status] || 0) + 1;
      const mapel = r.mapel_nama || '(tanpa mapel)';
      const mp = perMapel.get(mapel) || { mapel, H: 0, S: 0, I: 0, A: 0, B: 0, nama: {} };
      mp[r.status] = (mp[r.status] || 0) + 1;
      if (['S', 'I', 'A', 'B'].includes(r.status)) {
        mp.nama[r.status] = mp.nama[r.status] || [];
        if (!mp.nama[r.status].includes(r.siswa_nama)) mp.nama[r.status].push(r.siswa_nama);
        if (!nama[r.status].includes(r.siswa_nama)) nama[r.status].push(r.siswa_nama);
      }
      perMapel.set(mapel, mp);
    }
    return { kelas, rows, hitung, perMapel, nama };
  }

  function waKelasText(kelasId, tanggal) {
    const st = dbm.allSettings();
    const d = kelasAbsensiHarian(kelasId, tanggal);
    if (!d) return null;
    const lines = [];
    lines.push(`*REKAP ABSENSI HARIAN*`);
    lines.push(st.sekolah_nama || '');
    lines.push(dbm.tanggalPanjang(tanggal));
    lines.push('');
    lines.push(`Kelas: *${d.kelas.nama}*`);
    if (d.kelas.wali_nama) lines.push(`Wali Kelas: ${d.kelas.wali_nama}`);
    lines.push('');
    const total = d.hitung.H + d.hitung.S + d.hitung.I + d.hitung.A + d.hitung.B;
    if (!total) {
      lines.push('Belum ada presensi yang tercatat untuk kelas ini hari ini.');
    } else {
      lines.push(`Hadir: ${d.hitung.H} · Sakit: ${d.hitung.S} · Izin: ${d.hitung.I} · Alpha: ${d.hitung.A} · Bolos: ${d.hitung.B}`);
      lines.push(`Total catatan presensi: ${total} (${d.perMapel.size} mata pelajaran)`);
      const belum = Object.entries(d.nama).filter(([, arr]) => arr.length);
      if (belum.length) {
        lines.push('');
        lines.push('*Siswa tidak hadir:*');
        const label = { S: 'Sakit', I: 'Izin', A: 'Alpha', B: 'Bolos' };
        for (const [k, arr] of belum) {
          lines.push(`• ${label[k]} (${arr.length}): ${arr.join(', ')}`);
        }
      }
      lines.push('');
      lines.push('*Rincian per mata pelajaran:*');
      for (const mp of [...d.perMapel.values()].sort((a, b) => a.mapel.localeCompare(b.mapel))) {
        const detail = ['S', 'I', 'A', 'B']
          .filter(k => (mp.nama[k] || []).length)
          .map(k => `${({ S: 'Sakit', I: 'Izin', A: 'Alpha', B: 'Bolos' })[k]}: ${mp.nama[k].join(', ')}`)
          .join('; ');
        lines.push(`• ${mp.mapel} — H:${mp.H} S:${mp.S} I:${mp.I} A:${mp.A} B:${mp.B}${detail ? ` (${detail})` : ''}`);
      }
    }
    lines.push('');
    lines.push(`_Pesan otomatis ${st.app_nama || 'aplikasi sekolah'} — mohon abaikan bila sudah menerima laporan lengkap._`);
    return { pesan: lines.join('\n'), data: d };
  }

  function daftarKelasWa(tanggal, kelasId) {
    const list = kelasWithWali().filter(k => !kelasId || Number(k.id) === Number(kelasId));
    return list.map(k => {
      const w = waKelasText(k.id, tanggal);
      return {
        kelas_id: k.id, kelas: k.nama, wali_nama: k.wali_nama || '', phone: k.wali_phone || '',
        pesan: w ? w.pesan : '', jumlah: w ? (w.data.hitung.H + w.data.hitung.S + w.data.hitung.I + w.data.hitung.A + w.data.hitung.B) : 0
      };
    });
  }

  get('/api/rekap-absensi/wa/preview', (req, res, q) => {
    const user = guard(req, res, 'rekap_absensi_siswa', 'view'); if (!user) return;
    const tanggal = ISO_RE.test(String(q.tanggal || '')) ? String(q.tanggal) : dbm.today();
    const kelasId = Number(q.kelas) || 0;
    if (kelasId) {
      const one = waKelasText(kelasId, tanggal);
      if (!one) return fail(res, 404, 'Kelas tidak ditemukan.');
      return json(res, 200, {
        ok: true, tanggal, tanggal_label: dbm.tanggalPanjang(tanggal), satu: true,
        kelas: { id: kelasId, nama: one.data.kelas.nama, wali_nama: one.data.kelas.wali_nama || '', phone: one.data.kelas.wali_phone || '' },
        pesan: one.pesan, hitung: one.data.hitung,
        gateway_aktif: !!(waKelasConfig().gateway.aktif && waKelasConfig().gateway.url)
      });
    }
    const rows = daftarKelasWa(tanggal, 0);
    json(res, 200, {
      ok: true, tanggal, tanggal_label: dbm.tanggalPanjang(tanggal), satu: false,
      rows, jumlah_kelas: rows.length, tanpa_nomor: rows.filter(r => !r.phone).length,
      gateway_aktif: !!(waKelasConfig().gateway.aktif && waKelasConfig().gateway.url)
    });
  });

  async function kirimRekapKelas(user, tanggal, kelasId, ip) {
    const rows = daftarKelasWa(tanggal, kelasId);
    if (!rows.length) return { ok: false, error: 'Tidak ada kelas pada tahun pelajaran aktif.' };
    const hasil = [];
    for (const r of rows) {
      if (!r.phone) {
        hasil.push({ ...r, status: 'tanpa-nomor', error: 'Nomor WhatsApp Wali Kelas belum diisi.' });
        continue;
      }
      if (!r.jumlah) {
        hasil.push({ ...r, status: 'tanpa-data', error: 'Belum ada presensi pada tanggal ini.' });
        continue;
      }
      const out = await dbm.waSend(r.phone, r.pesan);
      hasil.push({ ...r, status: out.status, error: out.error || '' });
      try {
        db.prepare(`INSERT INTO wa_log(siswa_id,nama,phone,jenis,pesan,oleh,oleh_nama,created_at,status,sumber,error,ta_id)
          VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(`Rekap ${r.kelas}`, r.phone, 'rekap-absensi-kelas', r.pesan,
            user ? user.id : null, user ? user.nama : 'Sistem', dbm.now(), out.status,
            out.status === 'terkirim' ? 'gateway' : 'manual', out.error || '', taOf({}));
      } catch (err) { /* log opsional */ }
    }
    const terkirim = hasil.filter(h => h.status === 'terkirim').length;
    if (user) {
      dbm.logAudit(user, 'WA', 'rekap_absensi_siswa',
        `Kirim rekap absensi ${dbm.tanggalPanjang(tanggal)} ke ${hasil.length} wali kelas (${terkirim} terkirim)`, ip || '');
    }
    return { ok: true, tanggal, hasil, terkirim, total: hasil.length };
  }

  post('/api/rekap-absensi/wa/kirim', async (req, res) => {
    const user = guard(req, res, 'rekap_absensi_siswa', 'write'); if (!user) return;
    const b = await readBody(req);
    const tanggal = ISO_RE.test(String(b.tanggal || '')) ? String(b.tanggal) : dbm.today();
    const kelasId = Number(b.kelas) || 0;
    const gw = waKelasConfig().gateway;
    if (!gw.aktif || !gw.url) {
      const rows = daftarKelasWa(tanggal, kelasId);
      return json(res, 200, {
        ok: true, tanggal, gateway: false, hasil: rows.map(r => ({ ...r, status: 'manual', error: '' })),
        pesan: 'Gateway WhatsApp belum aktif — pesan disiapkan sebagai tautan wa.me untuk dikirim manual.',
        tautan: rows.filter(r => r.phone).map(r => ({
          kelas: r.kelas, phone: r.phone, url: `https://wa.me/${String(r.phone).replace(/[^\d]/g, '')}?text=${encodeURIComponent(r.pesan)}`
        }))
      });
    }
    const out = await kirimRekapKelas(user, tanggal, kelasId, ipOf(req));
    if (!out.ok) return fail(res, 400, out.error);
    /* kirim seluruh kelas pada hari ini → tandai agar scheduler tidak mengirim ulang */
    if (!kelasId && tanggal === dbm.today()) dbm.setSetting('absensi_wa_kelas_terakhir', tanggal);
    json(res, 200, { ...out, gateway: true, pesan: `Rekap terkirim ke ${out.terkirim} dari ${out.total} wali kelas.` });
  });

  /* scheduler harian (dipanggil server.js untuk setiap sekolah) */
  async function checkWaKelas() {
    const cfg = waKelasConfig();
    if (!cfg.aktif) return { skip: 'nonaktif' };
    if (!cfg.gateway.aktif || !cfg.gateway.url) return { skip: 'gateway' };
    const tgl = dbm.today();
    if (!cfg.hari.includes(dbm.hariOf(tgl))) return { skip: 'bukan-hari-kerja' };
    const menit = dbm.nowMenit();
    const target = dbm.jamMenit(cfg.jam);
    if (target === null || menit < target) return { skip: 'belum-waktunya' };
    if (cfg.terakhir === tgl) return { skip: 'sudah' };
    const out = await kirimRekapKelas(null, tgl, 0, '');
    dbm.setSetting('absensi_wa_kelas_terakhir', tgl);
    return { sent: true, tanggal: tgl, terkirim: out.terkirim, total: out.total };
  }

  return { checkWaKelas };
};
