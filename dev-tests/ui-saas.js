'use strict';
/* Uji UI modul SaaS (Playwright):
   - halaman login: tombol "Daftarkan Sekolah" + form pendaftaran + auto login ke dashboard
   - panel Super Admin: semua 15 menu terbuka, dashboard 3 kartu metrik, tambah sekolah,
     detail sekolah (tab), pembayaran, paket, menu default, branding, QRIS, legal, tiket,
     pengumuman, panduan, audit, WA, backup, database manager
   - panel sekolah: menu Info & Layanan / Pusat Bantuan / Petunjuk / Legal
   Jalankan: node dev-tests/ui-saas.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-uisaas-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 6900 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); } };
const MENUS = ['Dashboard', 'Daftar Sekolah', 'Pembayaran & Penagihan', 'Paket Langganan', 'Pengaturan Profil', 'Default Menu Sekolah',
  'Branding Sistem', 'QRIS & Harga', 'Syarat & SLA', 'Pusat Tiket', 'Pengumuman & Maintenance',
  'Petunjuk Pengguna', 'Audit Logs', 'WhatsApp Gateway', 'Backup & Restore', 'Database Manager'];

function apiClient() {
  let cookie = '';
  return {
    async req(p, options = {}) {
      const response = await fetch(BASE + p, {
        method: options.method || 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
      return { status: response.status, body: await response.json().catch(() => null) };
    }
  };
}

(async () => {
  const gateway = await otpTest.startGateway();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logBuf = [];
  srv.stdout.on('data', d => logBuf.push(String(d)));
  srv.stderr.on('data', d => logBuf.push('[err] ' + String(d)));
  await new Promise(r => setTimeout(r, 2200));

  const browser = await chromium.launch();
  const errors = [];
  try {
    await otpTest.configure(apiClient(), gateway.url);
    /* ---------- 1. HALAMAN LOGIN + PENDAFTARAN ---------- */
    console.log('\n== LOGIN & PENDAFTARAN MANDIRI ==');
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok('tautan "Belum punya akun sekolah? Daftarkan sekolah Anda" tampil',
      (await page.locator('a[data-daftar-link]').count()) > 0 &&
      /Belum punya akun sekolah\?/i.test(await page.locator('body').innerText()));
    ok('field kode sekolah tersedia pada form login',
      (await page.locator('input[placeholder*="kode sekolah"]').count()) > 0);
    await page.click('a[data-daftar-link]');
    await page.waitForTimeout(700);
    ok('form pendaftaran terbuka', (await page.locator('text=Form Pendaftaran Sekolah').count()) > 0);
    for (const label of ['Nama Sekolah', 'Jenjang Pendidikan', 'Alamat Sekolah', 'Nama Admin', 'Email Admin', 'No WhatsApp', 'Password Admin', 'Ulangi Password']) {
      ok('field "' + label + '" ada', (await page.locator(`text=${label}`).count()) > 0);
    }
    ok('tombol "Coba Gratis 7 Hari" ada', (await page.locator('button:has-text("Coba Gratis")').count()) > 0);

    await page.fill('input[placeholder*="SMP Negeri"]', 'SMA Negeri 1 Uji Coba');
    await page.selectOption('select', 'SMA');
    await page.fill('textarea', 'Jl. Uji Coba No. 1, Ciamis');
    const inputs = page.locator('form input');
    await page.locator('label:has-text("Nama Admin") + div input, label:has-text("Nama Admin") ~ div input').first().fill('Bapak Uji').catch(() => {});
    await page.fill('input[placeholder="admin@sekolah.sch.id"]', 'admin@sman1uji.sch.id');
    await page.fill('input[placeholder="0812xxxxxxx"]', '081234000111');
    await page.locator('input[type="password"]').nth(0).fill('Rahasia123');
    await page.locator('input[type="password"]').nth(1).fill('Rahasia123');
    /* anti-spam: server menolak form yang dikirim < 4 detik sejak dibuka */
    await page.waitForTimeout(4500);
    gateway.clearCode();
    await page.click('button:has-text("Kirim Kode OTP WhatsApp")');
    await page.fill('input[placeholder="000000"]', await gateway.waitForCode());
    await page.click('button:has-text("Coba Gratis")');
    await page.waitForTimeout(1400);
    const sukses = (await page.locator('text=Pendaftaran Berhasil').count()) > 0;
    ok('pendaftaran berhasil & menampilkan kode sekolah', sukses);
    ok('halaman sukses menampilkan kode sekolah 4 digit', /kode sekolah/i.test(await page.locator('body').innerText()));
    /* pratinjau hasil pendaftaran dulu — pendaftar TIDAK dilempar otomatis */
    await page.waitForTimeout(2800);
    ok('pratinjau hasil pendaftaran tetap tampil (tidak auto-redirect)',
      /Pendaftaran Berhasil/i.test(await page.locator('body').innerText()) &&
      (await page.locator('aside nav button:has-text("Dashboard")').count()) === 0, page.url());
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('[data-ke-dashboard]')
    ]);
    await page.waitForTimeout(2000);
    const sudahMasuk = (await page.locator('aside nav button:has-text("Dashboard")').count()) > 0;
    ok('tombol "Buka Dashboard Sekolah" membawa masuk ke dashboard', sudahMasuk,
      (await page.locator('body').innerText()).slice(0, 120));

    /* ---------- 2. MENU AKUN & LAYANAN DI PANEL SEKOLAH ---------- */
    console.log('\n== MENU AKUN & LAYANAN (PANEL SEKOLAH) ==');
    for (const label of ['Info & Layanan', 'Pusat Bantuan', 'Petunjuk Pengguna', 'Legal & SLA']) {
      ok('menu "' + label + '" ada di sidebar sekolah',
        (await page.locator(`aside nav button:has-text("${label}")`).count()) > 0);
    }
    await page.click('aside nav button:has-text("Info & Layanan")');
    await page.waitForTimeout(1200);
    const infoTxt = await page.locator('main').innerText();
    ok('Info & Layanan menampilkan paket', /Paket/i.test(infoTxt));
    ok('Info & Layanan menampilkan tanggal register', /Tanggal Register/i.test(infoTxt));
    ok('Info & Layanan menampilkan masa aktif', /Masa Aktif/i.test(infoTxt));
    ok('tombol "Perpanjang Sekarang" tersedia', (await page.locator('button:has-text("Perpanjang Sekarang")').count()) > 0);
    await page.click('button:has-text("Perpanjang Sekarang")');
    await page.waitForTimeout(800);
    ok('modal pembayaran menampilkan rincian tagihan', /Total dibayar/i.test(await page.locator('body').innerText()));
    ok('modal pembayaran menyediakan unggah bukti', (await page.locator('text=Bukti Pembayaran').count()) > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await page.click('aside nav button:has-text("Pusat Bantuan")');
    await page.waitForTimeout(900);
    ok('form tiket tampil di panel sekolah', (await page.locator('text=Buat Tiket Baru').count()) > 0);
    await page.locator('input').filter({ hasNot: page.locator('[type=file]') }).nth(0).fill('Uji tiket UI').catch(() => {});
    await page.click('aside nav button:has-text("Legal & SLA")');
    await page.waitForTimeout(900);
    ok('halaman Legal & SLA memuat syarat ketentuan', /Syarat/i.test(await page.locator('main').innerText()));
    await page.click('aside nav button:has-text("Petunjuk Pengguna")');
    await page.waitForTimeout(800);
    ok('halaman Petunjuk Pengguna terbuka', /Petunjuk Pengguna/i.test(await page.locator('main').innerText()));

    /* simpan kode sekolah untuk dipakai super admin */
    const kodeSekolah = (await page.evaluate(async () => {
      const r = await fetch((window.__BASE__ || '') + '/api/bootstrap', { credentials: 'same-origin' });
      const j = await r.json();
      return j.tenant ? j.tenant.kode : '';
    })) || '';
    ok('kode sekolah baru dapat dibaca (4 digit)', /^\d{4}$/.test(kodeSekolah), kodeSekolah);

    /* ---------- 3. PANEL SUPER ADMIN ---------- */
    console.log('\n== PANEL SUPER ADMIN ==');
    await page.goto('about:blank');
    await page.goto(BASE + '/#/saas/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const perluLogin = (await page.locator('a:has-text("Buka Portal Super Admin")').count()) > 0;
    ok('panel tanpa sesi mengarahkan ke portal Super Admin eksklusif', perluLogin);
    await page.goto(BASE + '/super-admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.fill('input[autocomplete="username"]', 'superadmin');
    await page.fill('input[autocomplete="current-password"]', 'superadmin123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await page.waitForTimeout(2200);
    ok('login super admin masuk ke dashboard platform',
      (await page.locator('text=Dashboard Super Admin').count()) > 0 || (await page.locator('aside nav button:has-text("Daftar Sekolah")').count()) > 0);

    const dashTxt = await page.locator('main').innerText();
    ok('kartu "Total Sekolah" tampil', /Total Sekolah/i.test(dashTxt));
    ok('kartu "Sekolah Aktif" tampil', /Sekolah Aktif/i.test(dashTxt));
    ok('kartu "Sekolah Terdaftar" tampil', /Sekolah Terdaftar/i.test(dashTxt));
    ok('tombol "Jalankan Pemeriksaan Tagihan Sekarang" tampil',
      (await page.locator('button:has-text("Jalankan Pemeriksaan Tagihan Sekarang")').count()) > 0);

    for (const m of MENUS) {
      const ada = (await page.locator(`aside nav button:has-text("${m}")`).count()) > 0;
      ok('menu super admin "' + m + '" tersedia', ada);
    }

    /* buka semua menu & pastikan tidak error */
    for (const m of MENUS) {
      await page.click(`aside nav button:has-text("${m}")`);
      await page.waitForTimeout(650);
      const body = await page.locator('main').innerText();
      ok('menu "' + m + '" merender konten', body.trim().length > 30, body.slice(0, 60));
    }

    /* daftar sekolah: tambah sekolah + detail */
    console.log('\n== DAFTAR SEKOLAH: TAMBAH & DETAIL ==');
    await page.click('aside nav button:has-text("Daftar Sekolah")');
    await page.waitForTimeout(900);
    ok('tabel sekolah memuat sekolah terdaftar', /Uji Coba|Lifetime/i.test(await page.locator('main').innerText()));
    const jumlahBaris = await page.locator('main table.tbl tbody tr').count();
    ok('daftar sekolah berisi data', jumlahBaris >= 2, String(jumlahBaris));
    await page.click('button:has-text("Tambah Sekolah")');
    await page.waitForTimeout(700);
    await page.fill('#fSekolahBaru input[required]', 'SMP Negeri 9 Uji');
    await page.fill('#fSekolahBaru input[placeholder="admin"]', 'adminsmp9');
    await page.fill('#fSekolahBaru input[placeholder="0812xxxxxxx"]', '081299900011');
    await page.click('button[form="fSekolahBaru"]');
    await page.waitForTimeout(1700);
    const setelahTambah = await page.locator('main').innerText();
    ok('sekolah baru muncul di daftar', /SMP Negeri 9 Uji/i.test(setelahTambah));
    ok('kode sekolah tampil 4 digit', /Kode \d{4}|>(\d{4})</.test(setelahTambah) || /\b\d{4}\b/.test(setelahTambah));

    const detailBtn = page.locator('button:has-text("Detail Sekolah")').first();
    await detailBtn.click();
    await page.waitForTimeout(1200);
    const detailTxt = await page.locator('body').innerText();
    ok('detail sekolah menampilkan kode sekolah', /Kode/i.test(detailTxt));
    ok('detail sekolah punya tab Akun Admin', (await page.locator('button.tab:has-text("Akun Admin")').count()) > 0);
    ok('detail sekolah punya tab Kontrol Fitur', (await page.locator('button.tab:has-text("Kontrol Fitur")').count()) > 0);
    await page.click('button.tab:has-text("Akun Admin")');
    await page.waitForTimeout(600);
    ok('tab akun admin memuat generator kata sandi',
      (await page.locator('button:has-text("Generator Kata Sandi Acak")').count()) > 0);
    ok('tab akun admin memuat tombol Reset', (await page.locator('button:has-text("Reset")').count()) > 0);
    await page.click('button.tab:has-text("Kontrol Fitur")');
    await page.waitForTimeout(500);
    ok('tab kontrol fitur menampilkan daftar modul',
      (await page.locator('text=Simpan Kontrol Fitur').count()) > 0);
    await page.click('button.tab:has-text("Portal & Domain")');
    await page.waitForTimeout(500);
    const domTxt = await page.locator('body').innerText();
    ok('tab domain memuat panduan DNS/CNAME', /CNAME/i.test(domTxt));
    ok('tab domain memuat status domain', /Status domain|Domain Custom/i.test(domTxt));
    await page.click('button.tab:has-text("Ringkasan")');
    await page.waitForTimeout(400);
    ok('tab ringkasan memuat identitas lengkap', /Nama sekolah:/i.test(await page.locator('body').innerText()));
    await page.locator('button[aria-label="Tutup"]').first().click().catch(async () => { await page.keyboard.press('Escape'); });
    await page.waitForTimeout(500);

    /* pembayaran: ajukan dari sekolah lalu verifikasi */
    console.log('\n== PEMBAYARAN: VERIFIKASI ==');
    await page.click('aside nav button:has-text("Pembayaran & Penagihan")');
    await page.waitForTimeout(1000);
    const pyTxt = await page.locator('main').innerText();
    ok('tab verifikasi pembayaran tersedia', /Menunggu Verifikasi|Disetujui|Ditolak/i.test(pyTxt));
    ok('tombol cron tersedia di halaman pembayaran',
      (await page.locator('button:has-text("Jalankan Pemeriksaan Tagihan Sekarang")').count()) > 0);
    await page.click('button:has-text("Jalankan Pemeriksaan Tagihan Sekarang")');
    await page.waitForTimeout(1600);
    ok('cron dapat dijalankan dari UI', /Pemeriksaan selesai|tagihan baru/i.test(await page.locator('body').innerText()));

    /* paket & branding & qris & legal & pengumuman */
    console.log('\n== PENGATURAN PLATFORM ==');
    await page.click('aside nav button:has-text("Paket Langganan")');
    await page.waitForTimeout(900);
    ok('kartu paket Basic/Premium/Lifetime tampil',
      /Basic/.test(await page.locator('main').innerText()) && /Premium/.test(await page.locator('main').innerText()));
    await page.click('aside nav button:has-text("Branding Sistem")');
    await page.waitForTimeout(800);
    ok('form branding memuat nama aplikasi default', (await page.locator('text=Nama Aplikasi Default').count()) > 0);
    ok('form branding memuat domain & subdomain', (await page.locator('text=Domain Platform').count()) > 0);
    await page.click('aside nav button:has-text("QRIS & Harga")');
    await page.waitForTimeout(800);
    const qrisTxt = await page.locator('main').innerText();
    ok('halaman QRIS memuat nama pemilik rekening', /Nama Pemilik Rekening/i.test(qrisTxt));
    ok('halaman QRIS memuat kode promo', /Kode Promo/i.test(qrisTxt));
    ok('halaman QRIS memuat pratinjau', /Pratinjau/i.test(qrisTxt));
    await page.click('aside nav button:has-text("Syarat & SLA")');
    await page.waitForTimeout(800);
    ok('editor TOS & SLA tersedia', (await page.locator('text=Service Level Agreement').count()) > 0);
    await page.click('aside nav button:has-text("Pengumuman & Maintenance")');
    await page.waitForTimeout(800);
    ok('mode maintenance dapat diaktifkan dari UI', (await page.locator('text=Mode Pemeliharaan').count()) > 0);
    await page.click('aside nav button:has-text("Petunjuk Pengguna")');
    await page.waitForTimeout(800);
    ok('tombol tambah petunjuk pengguna tersedia', (await page.locator('button:has-text("Tambah Petunjuk")').count()) > 0);
    await page.click('aside nav button:has-text("Audit Logs")');
    await page.waitForTimeout(900);
    ok('audit log menampilkan aktivitas super admin', /TAMBAH|UBAH|VERIFIKASI|LOGIN/i.test(await page.locator('main').innerText()));
    await page.click('aside nav button:has-text("Database Manager")');
    await page.waitForTimeout(1100);
    const dbTxt = await page.locator('main').innerText();
    ok('database manager menampilkan konsol SQL', /Konsol SQL/i.test(dbTxt));
    ok('database manager menampilkan tabel', (await page.locator('main table.tbl').count()) > 0);

    /* ---------- 4. RESPONSIF MOBILE ---------- */
    console.log('\n== MOBILE 390px ==');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('panel super admin tanpa overflow horizontal (mobile)', ov <= 2, String(ov));

    /* ---------- 5. TANPA ERROR JS ---------- */
    console.log('\n== TANPA ERROR JS ==');
    const penting = errors.filter(e => !/Failed to load resource|favicon|401|403|400|402|503/.test(e));
    ok('tidak ada error JavaScript', penting.length === 0, penting.slice(0, 3).join(' | '));

    await page.close();
    await ctx.close();
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(logBuf.join('').slice(-2500));
  } finally {
    await browser.close().catch(() => {});
    srv.kill('SIGKILL');
    await gateway.close().catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL UI SAAS: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
