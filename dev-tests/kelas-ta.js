'use strict';
/* Uji: halaman Data Kelas, modal tahun pelajaran (tampil utuh), hapus tahun pelajaran
   node dev-tests/kelas-ta.js                                                   */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const DB = path.join(os.tmpdir(), 'stt-kta-' + Date.now() + '.sqlite');
const PORT = 5200 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let KODE = '';
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };

let COOKIE = '';
async function req(p, body) {
  const r = await fetch(BASE + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(COOKIE ? { cookie: COOKIE } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) COOKIE = set.map(s => s.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) { }
  return { status: r.status, ...(j || {}) };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1900));
  KODE = (((await (await fetch(BASE + '/api/public/sekolah')).json()).rows[0]) || {}).kode || '';

  /* ---------- API ---------- */
  console.log('\n== API TAHUN PELAJARAN ==');
  let r = await req('/api/login', { kode: KODE, username: 'admin', password: 'admin123' });
  ok('login admin', r.ok === true, JSON.stringify(r).slice(0, 120));

  r = await req('/api/kelas');
  ok('GET /api/kelas 200 & berisi tingkat', r.status === 200 && Array.isArray(r.tingkat ? r.tingkat.list : null), JSON.stringify(r).slice(0, 120));

  const taAwal = (await req('/api/tahun')).rows;
  ok('daftar tahun pelajaran terbaca', Array.isArray(taAwal) && taAwal.length > 0);

  // tolak rentang tanggal terbalik
  r = await req('/api/tahun/save', { nama: 'UJI/2029', tanggal_mulai: '2029-07-01', tanggal_selesai: '2029-06-30' });
  ok('tolak tanggal selesai < mulai', r.status === 400 && /setelah tanggal mulai/i.test(r.error || ''), r.error);
  // tolak tumpang tindih
  const aktif = taAwal.find(t => t.aktif) || taAwal[0];
  r = await req('/api/tahun/save', { nama: 'UJI/TUMPANG', tanggal_mulai: aktif.tanggal_mulai, tanggal_selesai: aktif.tanggal_selesai });
  ok('tolak rentang bertumpang tindih', r.status === 400 && /tumpang tindih/i.test(r.error || ''), r.error);

  // tahun pelajaran baru tanpa data
  r = await req('/api/tahun/save', { nama: 'UJI/2029', tanggal_mulai: '2029-07-01', tanggal_selesai: '2030-06-30', aktif: 0 });
  ok('tambah tahun pelajaran uji', r.ok === true, JSON.stringify(r).slice(0, 160));
  const uji = ((await req('/api/tahun')).rows).find(t => t.nama === 'UJI/2029');
  ok('tahun uji muncul di daftar', !!uji);

  r = await req('/api/tahun/' + uji.id + '/dampak');
  ok('dampak tahun uji = 0 baris', r.total === 0 && r.bisa_hapus === true, JSON.stringify(r.dampak));

  r = await req('/api/tahun/delete', { id: uji.id });
  ok('hapus tahun pelajaran tanpa data', r.ok === true, r.error);
  ok('tahun uji hilang dari daftar', !((await req('/api/tahun')).rows).some(t => t.nama === 'UJI/2029'));

  r = await req('/api/tahun/delete', { id: aktif.id });
  ok('tahun pelajaran aktif tidak bisa dihapus', r.status === 400 && /aktif/i.test(r.error || ''), r.error);

  // tahun pelajaran berisi data → wajib paksa
  r = await req('/api/tahun/save', { nama: 'UJI/DATA', tanggal_mulai: '2031-07-01', tanggal_selesai: '2032-06-30', aktif: 0 });
  const uji2 = ((await req('/api/tahun')).rows).find(t => t.nama === 'UJI/DATA');
  const kls = await req('/api/kelas');
  const taUji = await req('/api/tahun/' + uji2.id + '/dampak');
  ok('tahun uji kedua dibuat', !!uji2 && taUji.total === 0);
  // buat kelas pada tahun uji (pakai tahun_ajaran_id)
  const master = await req('/api/form-master');
  r = await req('/api/kelas/save', { nama: 'UJI 1', tingkat: (master.tingkat ? master.tingkat.list[0] : 'X'), tahun_ajaran_id: uji2.id });
  ok('buat kelas pada tahun uji', r.ok === true, r.error);
  r = await req('/api/tahun/' + uji2.id + '/dampak');
  ok('dampak mendeteksi 1 kelas', r.total === 1 && r.dampak.kelas === 1, JSON.stringify(r.dampak));
  r = await req('/api/tahun/delete', { id: uji2.id });
  ok('hapus tanpa paksa ditolak (409)', r.status === 409 && /data terkait/i.test(r.error || ''), r.error + ' status=' + r.status);
  r = await req('/api/tahun/delete', { id: uji2.id, paksa: true });
  ok('hapus dengan paksa berhasil', r.ok === true && r.totalData >= 1, JSON.stringify(r).slice(0, 140));
  ok('kelas ikut terhapus', !(await req('/api/kelas')).rows.some(k => k.nama === 'UJI 1'));

  /* siswa + riwayat pada tahun pelajaran yang dihapus tidak meninggalkan data yatim.
     Tahun uji dijadikan AKTIF sementara agar siswa/kelas tercatat di tahun tersebut. */
  r = await req('/api/tahun/save', { nama: 'UJI/SISWA', tanggal_mulai: '2033-07-01', tanggal_selesai: '2034-06-30', aktif: 1 });
  const uji3 = ((await req('/api/tahun')).rows).find(t => t.nama === 'UJI/SISWA');
  ok('tahun uji menjadi aktif', !!uji3 && !!uji3.aktif);
  const tk0 = (master.tingkat ? master.tingkat.list[0] : 'X');
  await req('/api/kelas/save', { nama: 'UJI 3', tingkat: tk0 });
  const kls3 = (await req('/api/kelas')).rows.find(k => k.nama === 'UJI 3');
  ok('kelas dibuat pada tahun uji', !!kls3);
  await req('/api/siswa/save', { nama: 'Siswa Uji Hapus TA', nisn: '90012345', jenis_kelamin: 'L', kelas_id: kls3.id, status: 'aktif' });
  const siswaUji = (await req('/api/siswa?q=Siswa Uji Hapus TA')).rows.find(x => x.nama === 'Siswa Uji Hapus TA');
  ok('siswa uji tercatat pada tahun uji', !!siswaUji && Number(siswaUji.tahun_ajaran_id) === Number(uji3.id), JSON.stringify(siswaUji && siswaUji.tahun_ajaran_id));
  const kat = (await req('/api/kategori')).rows[0];
  await req('/api/kejadian/save', { tanggal: '2033-09-09', siswa_ids: [siswaUji.id], kategori_ids: [kat.id], jenis: 'pelanggaran', keterangan: 'uji' });
  r = await req('/api/tahun/' + uji3.id + '/dampak');
  ok('dampak menghitung siswa/kelas/kejadian', r.dampak.siswa === 1 && r.dampak.kelas === 1 && r.dampak.kejadian >= 1, JSON.stringify(r.dampak));
  /* kembalikan tahun pelajaran aktif ke semula, lalu hapus tahun uji */
  await req('/api/tahun/save', { id: aktif.id, nama: aktif.nama, tanggal_mulai: aktif.tanggal_mulai, tanggal_selesai: aktif.tanggal_selesai, aktif: true });
  r = await req('/api/tahun/delete', { id: uji3.id, paksa: true });
  ok('hapus tahun berisi siswa berhasil', r.ok === true, r.error);
  const orphan = await req('/api/audit-data');
  const orphanRows = (orphan.rows || []).filter(x => Number(x.jumlah) > 0);
  ok('tidak ada data yatim setelah hapus tahun pelajaran', orphanRows.length === 0,
    JSON.stringify(orphanRows).slice(0, 220));

  /* ---------- UI ---------- */
  console.log('\n== UI ==');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[autocomplete="current-password"]', 'admin123');
  await page.fill('input[placeholder*="kode sekolah"]', KODE);
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Distribusi Status Disiplin', { timeout: 20000 });
  await page.keyboard.press('Escape');

  await page.click('aside nav button:has-text("Data Kelas")');
  await page.waitForSelector('text=Daftar Kelas', { timeout: 15000 });
  await page.waitForTimeout(600);
  ok('halaman Data Kelas tampil (tidak blank)', (await page.locator('body').innerText()).includes('Daftar Kelas'));
  ok('tidak ada error JS di Data Kelas', errors.length === 0, errors[0]);
  await page.click('button:has-text("Tambah Kelas")');
  await page.waitForSelector('[data-modal-title="Tambah Kelas"]');
  const optTingkat = await page.locator('[data-modal] select').first().locator('option').count();
  ok('form kelas punya pilihan tingkat', optTingkat >= 2, 'opsi=' + optTingkat);
  await page.locator('[data-modal] button[aria-label="Tutup"]').first().click();

  await page.click('aside nav button:has-text("Pengaturan")');
  await page.waitForSelector('text=Identitas Sekolah', { timeout: 15000 });
  await page.click('button.tab:has-text("Tahun Pelajaran")');
  await page.waitForSelector('[data-ta-row]', { timeout: 15000 });

  // modal tahun pelajaran harus utuh di layar pendek
  for (const vp of [{ width: 1440, height: 980 }, { width: 1280, height: 520 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(250);
    await page.click('button:has-text("Tambah")');
    await page.waitForSelector('[data-modal-title="Tambah Tahun Pelajaran"]');
    await page.waitForTimeout(350);
    const m = page.locator('[data-modal] > div > div').first();
    const box = await m.boundingBox();
    const tf = page.locator('[data-modal] button:has-text("Simpan")');
    ok(`modal ${vp.width}x${vp.height} utuh di layar`,
      box.y >= 0 && box.y + box.height <= vp.height + 1,
      `y=${Math.round(box.y)} h=${Math.round(box.height)} layar=${vp.height}`);
    ok(`tombol Simpan terlihat ${vp.width}x${vp.height}`, await tf.isVisible());
    await page.locator('[data-modal] button[aria-label="Tutup"]').first().click();
    await page.waitForTimeout(200);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const barisAktif = page.locator('[data-ta-row]').filter({ hasText: 'Aktif' }).first();
  const idAktif = await barisAktif.getAttribute('data-ta-row');
  ok('tombol hapus tahun aktif nonaktif', await page.locator(`[data-ta-hapus="${idAktif}"]`).isDisabled());

  const arsip = page.locator('[data-ta-row]').filter({ hasText: 'Arsip' }).first();
  const idArsip = await arsip.getAttribute('data-ta-row');
  await page.click(`[data-ta-hapus="${idArsip}"]`);
  await page.waitForSelector('[data-modal-title="Hapus Tahun Pelajaran"]', { timeout: 8000 });
  ok('dialog hapus tahun pelajaran terbuka', true);
  const teksModal = await page.locator('[data-modal]').innerText();
  ok('dialog menyebut data terkait atau aman', /Data terkait|Tidak ada data/i.test(teksModal), teksModal.slice(0, 120));
  const tombolKonfirmasi = page.locator('[data-hapus-konfirmasi]');
  if (/Data terkait/i.test(teksModal)) {
    ok('tombol hapus terkunci sebelum centang', await tombolKonfirmasi.isDisabled());
    await page.locator('[data-hapus-paksa]').check();
    ok('tombol hapus aktif setelah centang', await tombolKonfirmasi.isEnabled());
    await page.locator('[data-modal] button:has-text("Batal")').click();
  } else {
    await tombolKonfirmasi.click();
    await page.waitForTimeout(1000);
    ok('tahun pelajaran terhapus dari tabel', (await page.locator(`[data-ta-row="${idArsip}"]`).count()) === 0);
  }
  ok('tanpa error JS di halaman pengaturan', errors.length === 0, errors[0]);

  await browser.close();
  srv.kill();
  console.log(`\n== HASIL: ${pass} lulus, ${fail} gagal ==`);
  if (fail) { console.log('GAGAL:\n - ' + fails.join('\n - ')); process.exit(1); }
})();
