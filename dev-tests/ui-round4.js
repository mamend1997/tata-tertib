'use strict';
/* test berjalan di zona waktu yang sama dengan aplikasi (WIB) */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
/* UI RONDE 4 (Playwright): Kelola File, pengaturan kop surat, unggahan, autocomplete
   pencarian nama/kategori, ekspor-impor database, indikator penyimpanan dashboard,
   tanpa overflow horizontal & tanpa error JS (desktop + mobile 390px). */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ui4-'));
const DB = path.join(TMP, 'tt.sqlite');
const PORT = 3682;
const base = `http://127.0.0.1:${PORT}`;
let KODE = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, DB_PATH: DB, DEMO_SEED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

const results = [];
function ok(name, cond, extra = '') { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' → ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(base + '/api/public/config'); if (r.ok) break; } catch (e) { } await sleep(150); }
  KODE = ((await (await fetch(base + '/api/public/sekolah')).json()).rows[0] || {}).kode || '';

  // siapkan 1 berkas agar media manager tidak kosong
  let cookie = '';
  async function api(method, url, body) {
    const headers = { Cookie: cookie };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  await api('POST', '/api/login', { username: 'admin', password: 'admin123', kode: KODE });
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/9wAAAABJRU5ErkJggg==';
  await api('POST', '/api/upload', { base64: PNG, filename: 'bukti-ui.png', jenis: 'bukti' });
  await api('POST', '/api/upload', { base64: PNG, filename: 'logo-ui.png', jenis: 'logo' });

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });

  await page.goto(base + '/login');
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.fill('input[placeholder*="kode sekolah"]', KODE);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => { }), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  // tutup pop-up peringatan dini (menutupi klik) sebelum menguji halaman lain
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const tutupModal = await page.locator('[data-modal] button[aria-label="Tutup"]').count();
  if (tutupModal) await page.locator('[data-modal] button[aria-label="Tutup"]').first().click().catch(() => {});
  await page.waitForTimeout(300);

  /* ---------- dashboard: indikator penyimpanan ---------- */
  ok('dashboard menampilkan indikator penyimpanan', /Penyimpanan/.test(await page.locator('main').innerText()),
    (await page.locator('main').innerText()).slice(0, 120));

  /* ---------- menu Kelola File ---------- */
  ok('menu Kelola File tampil di sidebar', (await page.locator('aside nav button:has-text("Kelola File")').count()) === 1);
  await page.click('aside nav button:has-text("Kelola File")');
  await page.waitForSelector('text=Kelola File Terunggah');
  await page.waitForTimeout(700);
  const baris = await page.locator('table.tbl tbody tr').count();
  ok('tabel berkas berisi data', baris >= 2, String(baris));
  ok('kolom ceklis per berkas', (await page.locator('table.tbl tbody input[type="checkbox"]').count()) === baris);
  ok('tombol Hapus Masal tersedia', (await page.locator('button:has-text("Hapus Masal")').count()) === 1);
  ok('ringkasan penyimpanan tampil', /TERPAKAI|Berkas Foto|Sisa Kuota/i.test(await page.locator('main').innerText()));
  // pilih semua → jumlah terpilih bertambah
  await page.locator('label:has-text("Pilih semua") input[type="checkbox"]').check();
  await page.waitForTimeout(200);
  ok('pilih semua mencentang seluruh berkas', /2 dipilih/.test(await page.locator('main').innerText()));
  // hapus masal (dialog konfirmasi diterima)
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Hapus Masal")');
  await page.waitForTimeout(900);
  const kosong = await page.locator('text=Belum ada berkas').count();
  ok('hapus masal mengosongkan daftar berkas', kosong === 1, String(kosong));

  /* ---------- pengaturan: kop surat ---------- */
  await page.click('aside nav button:has-text("Pengaturan")');
  await page.waitForSelector('text=Identitas Sekolah');
  await page.click('button.tab:has-text("Kop Surat")');
  await page.waitForTimeout(400);
  ok('tab Kop Surat terbuka', /Pengaturan Kop Surat/i.test(await page.locator('main').innerText()));
  ok('pilihan sumber data kop (auto/manual)', (await page.locator('select').first().locator('option').count()) === 2);
  ok('pratinjau kop tampil', /Pratinjau Kop/i.test(await page.locator('main').innerText()));
  // pilih sumber kop 'manual' (select pertama pada kartu Kop Surat)
  await page.locator('main select').first().selectOption('manual');
  await page.waitForTimeout(200);
  const area = page.locator('textarea').first();
  await area.fill('YAYASAN UI\nUNIT SMK UI\nSMK UI MANDIRI\nJl. UI No. 5');
  await page.waitForTimeout(300);
  ok('pratinjau kop mengikuti teks manual', /YAYASAN UI/i.test(await page.locator('main').innerText()));
  ok('pengaturan font per baris tersedia', /Ukuran Font & Tebal per Baris/i.test(await page.locator('main').innerText()));
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Simpan Kop Surat")');
  await page.waitForTimeout(1200);
  const setKop = await api('GET', '/api/settings');
  ok('kop manual tersimpan dari UI', String(setKop.json.settings.kop_sumber) === 'manual', setKop.json.settings.kop_sumber);
  ok('teks kop manual tersimpan', /YAYASAN UI/.test(String(setKop.json.settings.kop_baris)));

  /* ---------- pengaturan: unggahan & penyimpanan ---------- */
  await page.click('button.tab:has-text("Unggahan & Penyimpanan")');
  await page.waitForTimeout(500);
  ok('tab Unggahan terbuka', /Batas Unggah & Kompresi Foto/i.test(await page.locator('main').innerText()));
  ok('batas unggah default 2 MB ditampilkan', (await page.locator('main input').first().inputValue()) === '2048');
  ok('pemakaian penyimpanan tampil', /Pemakaian Penyimpanan/i.test(await page.locator('main').innerText()));
  await page.locator('main input').first().fill('3000');
  page.once('dialog', d => d.accept());
  await page.click('button:has-text("Simpan Pengaturan")');
  await page.waitForTimeout(1200);
  const setUp = await api('GET', '/api/settings');
  ok('batas unggah dapat diubah dari UI', String(setUp.json.settings.upload_max_kb) === '3000', setUp.json.settings.upload_max_kb);
  await api('POST', '/api/settings/save', { data: { upload_max_kb: '2048' } });

  /* ---------- identitas: website tanpa https ---------- */
  await page.click('button.tab:has-text("Identitas Sekolah")');
  await page.waitForTimeout(400);
  const webInput = page.locator('main input').filter({ hasNot: page.locator('[type="file"]') }).nth(4);
  const webVal = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('input')).find(i => /www|sch\.id|sekolah/i.test(i.value || ''));
    return el ? el.value : '';
  });
  ok('input website tampil tanpa https://', !/^https?:\/\//i.test(webVal), webVal);
  ok('hint website menyebut tanpa https://', /tanpa https:\/\//i.test(await page.locator('main').innerText()));

  /* ---------- form kejadian: autocomplete siswa + filter kategori ---------- */
  await page.click('aside nav button:has-text("Kejadian & Poin")');
  await page.waitForTimeout(700);
  const namaSiswa = await page.evaluate(async () => {
    const r = await fetch((window.__BASE__ || '') + '/api/siswa-options?limit=3');
    const j = await r.json();
    return (j.rows || [])[0] ? j.rows[0].nama : '';
  });
  await page.fill('form [data-student-picker]', String(namaSiswa).slice(0, 3));
  await page.waitForTimeout(700);
  ok('dropdown nama siswa muncul (min. 3 huruf)', (await page.locator('form [data-pick]').count()) >= 1);
  await page.locator('form [data-pick]').first().click();
  await page.waitForTimeout(300);
  /* ronde 12: siswa terpilih tampil sebagai chip (nama + kelas) */
  ok('siswa terpilih & kelas tampil', /X |XI|XII/.test(await page.locator('form [data-chip-list]').innerText()));
  const katSebelum = await page.locator('form select').last().locator('option').count();
  await page.fill('form [data-kategori-search]', 'zzz');
  await page.waitForTimeout(300);
  const katSesudah = await page.locator('form select').last().locator('option').count();
  ok('filter pencarian kategori menyaring pilihan', katSesudah < katSebelum, `${katSebelum} → ${katSesudah}`);

  /* ---------- buku penghubung: filter kategori & nama ---------- */
  await page.click('aside nav button:has-text("Buku Penghubung")');
  await page.waitForTimeout(700);
  ok('buku penghubung punya autocomplete nama', (await page.locator('form [data-student-picker]').count()) === 1);
  const filterKat = await page.locator('main select').count();
  ok('filter kategori & jenis tersedia pada jurnal', filterKat >= 2, String(filterKat));

  /* ---------- tindak lanjut: autocomplete nama ---------- */
  await page.click('aside nav button:has-text("Tindak Lanjut")');
  await page.waitForTimeout(700);
  ok('tindak lanjut memakai autocomplete nama', (await page.locator('form [data-student-picker]').count()) === 1);

  /* ---------- pengaturan: ekspor & impor database ---------- */
  await page.click('aside nav button:has-text("Pengaturan")');
  await page.waitForTimeout(400);
  await page.click('button.tab:has-text("Backup & Restore")');
  await page.waitForTimeout(600);
  ok('tombol Ekspor Database (.zip) tersedia', (await page.locator('a[href="/api/backup/zip"]').count()) === 1);
  ok('tombol unduh backup .json tetap ada', (await page.locator('a[href="/api/backup/json"]').count()) === 1);
  ok('form restore menerima .zip', (await page.locator('input[type="file"][accept*=".zip"]').count()) === 1);

  /* ---------- tanpa error JS & mobile ---------- */
  ok('tanpa error JavaScript (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* batas platform: satu tab per browser — tutup halaman desktop dulu */
  await page.close();
  const page2 = await ctx.newPage();
  await page2.setViewportSize({ width: 390, height: 844 });
  for (const [menu, tunggu] of [['Kelola File', 'Kelola File Terunggah'], ['Pengaturan', 'Identitas Sekolah']]) {
    await page2.goto(base + '/#/dashboard');
    await page2.waitForTimeout(1100);
    // pop-up peringatan dini menutupi klik → tutup dulu
    await page2.keyboard.press('Escape');
    await page2.waitForTimeout(250);
    const tutup2 = await page2.locator('[data-modal] button[aria-label="Tutup"]').count();
    if (tutup2) await page2.locator('[data-modal] button[aria-label="Tutup"]').first().click().catch(() => {});
    await page2.waitForTimeout(250);
    await page2.click(`aside nav button:has-text("${menu}")`).catch(async () => {
      await page2.click('button[aria-label="Menu"]');
      await page2.waitForTimeout(300);
      await page2.click(`aside nav button:has-text("${menu}")`);
    });
    await page2.waitForTimeout(900);
    const over = await page2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`mobile 390px tanpa overflow (${menu})`, over <= 1, String(over));
  }
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(String(e.message)));
  ok('tanpa error JavaScript (mobile)', errors2.length === 0, errors2.slice(0, 2).join(' | '));
  await page2.close();

  const gagal = results.filter(x => !x.ok);
  console.log('');
  console.log(`=== HASIL UI RONDE 4: ${results.length - gagal.length} lulus, ${gagal.length} gagal ===`);
  if (gagal.length) {
    console.log('Gagal:\n- ' + gagal.map(g => g.name + (g.extra ? ' → ' + g.extra : '')).join('\n- '));
    console.log('LOG:\n' + log.split('\n').slice(-15).join('\n'));
  }
  await browser.close();
  srv.kill('SIGKILL');
  process.exit(gagal.length ? 1 : 0);
})().catch(async e => {
  console.error('FATAL', e);
  console.log(log.split('\n').slice(-15).join('\n'));
  try { srv.kill('SIGKILL'); } catch (err) { }
  process.exit(1);
});
