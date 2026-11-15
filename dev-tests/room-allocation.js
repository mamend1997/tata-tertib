'use strict';

const assert = require('assert');
process.env.DB_PATH = ':memory:';

const mount = require('../timetable');
const { susunJadwal } = mount({
  get() {}, post() {}, json() {}, fail() {}, guard() {}, readBody() {}, ipOf() {}
});

const cfg = {
  hari: [1],
  sesi: [{ idx: 1, no: 1, mulai: '07:00', selesai: '07:45', label: 'Jam' }],
  sesiHari: {},
  maxGuruJam: 8,
  maxMapelJam: 8
};
const aturan = {
  hindari_jam_kosong: 0,
  sebar_mapel_berat: 0,
  sebar_mapel_harian: 0,
  hormati_batas_guru: 0,
  hormati_ruang: 0
};

function generate({ classes, subjects, rooms, workload }) {
  const teachers = workload.map((b, i) => ({
    guru_id: 100 + i, nama: `Guru ${i + 1}`, max_jam: 0, tidak_hadir: [],
    mapel: [{ id: b.mapel_id }]
  }));
  return susunJadwal({
    taId: 1, cfg, mode: 'ganti', kelas: classes, mapel: subjects,
    guru: teachers, beban: workload, ruang: rooms, aturan, seed: 1,
    kelasIds: classes.map(k => k.id), jadwal: []
  });
}

const duaRuang = generate({
  classes: [{ id: 1, nama: 'X-A' }, { id: 2, nama: 'X-B' }],
  subjects: [{ id: 11, nama: 'Matematika' }, { id: 12, nama: 'IPA' }],
  rooms: [
    { id: 1, nama: 'Ruang 1', aktif: 1 },
    { id: 2, nama: 'Lab IPA', aktif: 1 }
  ],
  workload: [
    { kelas_id: 1, mapel_id: 11, jam_minggu: 1 },
    { kelas_id: 2, mapel_id: 12, jam_minggu: 1 }
  ]
});
assert.strictEqual(duaRuang.slots.length, 2);
assert.notStrictEqual(duaRuang.slots[0].ruang, duaRuang.slots[1].ruang);
assert(duaRuang.slots.every(s => s.ruang), 'available rooms should be assigned automatically');

const wajib = generate({
  classes: [{ id: 1, nama: 'X-A' }],
  subjects: [{ id: 21, nama: 'Praktikum Komputer', ruang_id: 8, ruang_wajib_nama: 'Lab Komputer', ruang_wajib_aktif: 1 }],
  rooms: [{ id: 8, nama: 'Lab Komputer', aktif: 1 }, { id: 9, nama: 'Ruang Kelas', aktif: 1 }],
  workload: [{ kelas_id: 1, mapel_id: 21, jam_minggu: 1 }]
});
assert.strictEqual(wajib.slots.length, 1);
assert.strictEqual(wajib.slots[0].ruang, 'Lab Komputer');

const terbatas = generate({
  classes: [{ id: 1, nama: 'X-A' }, { id: 2, nama: 'X-B' }],
  subjects: [{ id: 31, nama: 'Mapel A' }, { id: 32, nama: 'Mapel B' }],
  rooms: [{ id: 1, nama: 'Satu Ruang', aktif: 1 }],
  workload: [
    { kelas_id: 1, mapel_id: 31, jam_minggu: 1 },
    { kelas_id: 2, mapel_id: 32, jam_minggu: 1 }
  ]
});
assert.strictEqual(terbatas.slots.length, 1);
assert.strictEqual(terbatas.sisa.length, 1);
assert.strictEqual(terbatas.slots[0].ruang, 'Satu Ruang');

const wajibNonaktif = generate({
  classes: [{ id: 1, nama: 'X-A' }],
  subjects: [{ id: 41, nama: 'Praktikum', ruang_id: 4, ruang_wajib_nama: '', ruang_wajib_aktif: 0 }],
  rooms: [{ id: 4, nama: 'Lab Tutup', aktif: 0 }],
  workload: [{ kelas_id: 1, mapel_id: 41, jam_minggu: 1 }]
});
assert.strictEqual(wajibNonaktif.slots.length, 0);
assert.match(wajibNonaktif.sisa[0].alasan, /nonaktif/);

console.log('room-allocation: 4 focused checks passed');
