'use strict';
/* Pratinjau hasil pendaftaran sekolah (ronde 12):
   - /api/daftar mengembalikan data pratinjau lengkap (identitas sekolah, kode,
     akun admin, kelas bawaan, kategori, portal, menu) — bukan hanya kode
   - sesi login tetap dibuat (auto_login) supaya tombol dashboard langsung jalan
   - halaman pendaftaran TIDAK mengalihkan otomatis ke dashboard; pratinjau
     ditampilkan (kode sekolah besar + rincian) dan pendaftar menekan sendiri
     tombol "Buka Dashboard Sekolah"
   - tombol tersebut benar-benar membuka dashboard; tombol salin kode bekerja
   - tampilan pratinjau rapi di mobile 390px (tanpa overflow horizontal)
   Jalankan: node dev-tests/daftar.js */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-daftar-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 8300 + Math.floor(Math.random() * 250);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};

function client() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(p, o = {}) {
      const r = await fetch(BASE + p, {
        method: o.method || 'GET',
        headers: { ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: o.body ? JSON.stringify(o.body) : undefined,
        redirect: 'manual'
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      const ct = r.headers.get('content-type') || '';
      const body = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
      return { status: r.status, body, headers: r.headers };
    }
  };
}

const badan = (n) => ({
  nama_sekolah: `SMA Pratinjau ${n}`,
  jenjang: 'SMA',
  alamat: 'Jl. Pratinjau No. ' + n + ', Ciamis',
  kepala: 'Drs. Kepala ' + n,
  admin_nama: 'Admin Pratinjau ' + n,
  email: `admin${n}@pratinjau.sch.id`,
  password: 'Rahasia123!',
  telp: '0812345000' + String(10 + n),
  trial: true,
  t0: Date.now() - 10000
});

(async () => {
  const gateway = await otpTest.startGateway();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = [];
  srv.stdout.on('data', d => log.push(String(d)));
  srv.stderr.on('data', d => log.push('[err] ' + String(d)));
  let browser = null;

  try {
    for (let i = 0; i < 90; i++) {
      try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) break; } catch (e) { /* belum siap */ }
      await new Promise(r => setTimeout(r, 250));
    }
    await otpTest.configure(client(), gateway.url);

    /* ================= 1. RESPONS API ================= */
    console.log('\n== API /api/daftar: DATA PRATINJAU ==');
    const pub = client();
    const body1 = badan(1);
    let otp = await pub.req('/api/daftar/otp', { method: 'POST', body: { telp: body1.telp } });
    const code1 = gateway.code();
    ok('OTP dikirim melalui WhatsApp tanpa mengembalikan kodenya',
      otp.status === 200 && !JSON.stringify(otp.body).includes(code1) && /••••/.test(otp.body.pesan || ''),
      JSON.stringify(otp.body));
    const resend = await pub.req('/api/daftar/otp', { method: 'POST', body: { telp: body1.telp } });
    ok('permintaan OTP dibatasi cooldown', resend.status === 429, String(resend.status));
    let r = await pub.req('/api/daftar', { method: 'POST', body: { ...body1, otp: code1 } });
    ok('pendaftaran berhasil (200)', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    const h = r.body || {};
    ok('kode sekolah 4 digit dikirim', /^\d{4}$/.test(String(h.kode || '')), String(h.kode));
    ok('sesi login tetap dibuat (auto_login) agar tombol dashboard langsung bekerja', h.auto_login === true, String(h.auto_login));
    ok('identitas sekolah hasil daftar ikut dikirim', h.sekolah && h.sekolah.nama === 'SMA Pratinjau 1', JSON.stringify(h.sekolah || {}));
    ok('jenjang memakai label manusiawi', h.sekolah && /Sekolah Menengah Atas/.test(h.sekolah.jenjang_label || ''), h.sekolah && h.sekolah.jenjang_label);
    ok('kepala sekolah & alamat tersimpan benar',
      h.sekolah && h.sekolah.kepala === 'Drs. Kepala 1' && /Pratinjau No\. 1/.test(h.sekolah.alamat || ''),
      JSON.stringify({ k: h.sekolah && h.sekolah.kepala, a: h.sekolah && h.sekolah.alamat }));
    ok('akun admin (username + nama) tampil pada pratinjau',
      h.admin_username === 'admin1' && h.admin_nama === 'Admin Pratinjau 1',
      JSON.stringify({ u: h.admin_username, n: h.admin_nama }));
    ok('paket & status layanan dikirim', !!h.paket_nama && !!h.status_label, JSON.stringify({ p: h.paket_nama, s: h.status_label }));
    ok('masa aktif / uji coba dikirim', !!h.aktif_sampai, String(h.aktif_sampai));
    ok('tahun pelajaran aktif ikut ditampilkan', !!h.tahun_ajaran, String(h.tahun_ajaran));

    const ring = h.ringkasan || {};
    ok('kelas bawaan sesuai jenjang SMA (3 kelas)', ring.jumlah_kelas === 3, JSON.stringify(ring.kelas));
    ok('nama kelas bawaan benar (Kelas X/XI/XII)',
      Array.isArray(ring.kelas) && ring.kelas.includes('Kelas X') && ring.kelas.includes('Kelas XII'),
      JSON.stringify(ring.kelas));
    ok('kategori poin bawaan terhitung', Number(ring.jumlah_kategori) >= 10, String(ring.jumlah_kategori));
    ok('sekolah baru belum punya siswa', Number(ring.jumlah_siswa) === 0, String(ring.jumlah_siswa));
    ok('daftar menu yang siap dipakai dikirim', Array.isArray(ring.menu) && ring.menu.length >= 8 && ring.jumlah_menu === ring.menu.length,
      JSON.stringify({ n: ring.jumlah_menu, m: (ring.menu || []).slice(0, 5) }));
    ok('alamat portal siswa mengikuti slug sekolah', /^\/[a-z0-9-]+\/portal-siswa$/.test(String((h.portal || {}).path || '')),
      String((h.portal || {}).path));
    ok('portal siswa benar-benar hidup', (await pub.req(h.portal.path)).status === 200, h.portal.path);

    /* sesi hasil pendaftaran memang bisa langsung membuka dashboard */
    const sesi = client();
    r = await sesi.req('/api/daftar', { method: 'POST', body: await otpTest.bodyWithOtp(sesi, gateway, badan(2)) });
    ok('pendaftaran kedua berhasil', r.status === 200, String(r.status));
    r = await sesi.req('/api/bootstrap');
    ok('cookie hasil daftar langsung berlaku untuk dashboard',
      r.status === 200 && r.body.user && r.body.user.role === 'admin' && r.body.settings.sekolah_nama === 'SMA Pratinjau 2',
      JSON.stringify({ status: r.status, u: r.body.user && r.body.user.username, s: r.body.settings && r.body.settings.sekolah_nama }));

    /* ================= 2. UI: PRATINJAU, BUKAN AUTO-REDIRECT ================= */
    console.log('\n== UI: PRATINJAU HASIL PENDAFTARAN ==');
    browser = await chromium.launch();
    let ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    let page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE + '/daftar', { waitUntil: 'networkidle' });
    ok('halaman /daftar menampilkan formulir', /Form Pendaftaran Sekolah/i.test(await page.locator('body').innerText()));
    ok('form tidak lagi meminta nama kepala sekolah', await page.getByText('Nama Kepala Sekolah', { exact: false }).count() === 0);
    ok('form hanya memiliki satu field kata sandi', await page.locator('[data-password]').count() === 1);
    ok('nomor WhatsApp menampilkan awalan +62', await page.locator('text=+62').count() === 1);

    await page.fill('input[placeholder*="SMP Negeri"]', 'SMA Pratinjau UI');
    await page.selectOption('select', 'SMA');
    await page.fill('textarea', 'Jl. Pratinjau UI No. 7, Ciamis');
    await page.locator('label:has-text("Nama Admin") + div input, label:has-text("Nama Admin") ~ div input').first().fill('Admin UI').catch(() => {});
    await page.fill('input[placeholder="admin@sekolah.sch.id"]', 'adminpratinjauui.sch.id');
    await page.locator('[data-daftar-telp]').click();
    ok('email tanpa @ memberi peringatan setelah pindah field',
      await page.locator('[data-email-error]').isVisible()
        && /@/.test(await page.locator('[data-email-error]').innerText()));
    await page.fill('input[placeholder="admin@sekolah.sch.id"]', 'admin@pratinjauui');
    ok('email tanpa titik memberi peringatan',
      await page.locator('[data-email-error]').isVisible()
        && /titik/i.test(await page.locator('[data-email-error]').innerText()));
    await page.fill('input[placeholder="admin@sekolah.sch.id"]', 'admin@pratinjauui.sch.id');
    ok('peringatan email hilang setelah alamat valid', await page.locator('[data-email-error]').count() === 0);
    await page.locator('[data-daftar-telp]').fill('812abc34500077');
    await page.waitForFunction(() => document.querySelector('[data-daftar-telp]').value === '81234500077', null, { timeout: 1000 }).catch(() => {});
    const phoneValue = await page.locator('[data-daftar-telp]').inputValue();
    ok('field WhatsApp otomatis membuang huruf', phoneValue === '81234500077', phoneValue);
    await page.locator('[data-password]').fill('Rahasia123!');
    ok('kriteria sandi berubah hijau setelah dipenuhi',
      await page.locator('[data-password-check].text-emerald-600').count() === 4);
    await page.locator('[data-toggle-password]').click();
    ok('tombol mata menampilkan kata sandi', await page.locator('[data-password]').getAttribute('type') === 'text');
    await page.waitForTimeout(4600);   /* anti-spam: minimal 4 detik */
    gateway.clearCode();
    await page.click('button:has-text("Kirim Kode OTP WhatsApp")');
    const codeUi = await gateway.waitForCode();
    await page.fill('input[placeholder="000000"]', codeUi);
    await page.click('button:has-text("Coba Gratis")');
    await page.waitForTimeout(1500);

    const txt = await page.locator('body').innerText();
    ok('halaman sukses pratinjau tampil', /Pendaftaran Berhasil/i.test(txt));
    const kodeUi = (await page.locator('[data-preview-kode]').innerText().catch(() => '')).trim();
    ok('kode sekolah ditampilkan besar & 4 digit', /^\d{4}$/.test(kodeUi), kodeUi);
    ok('kode sekolah juga tertulis sebagai label "Kode Sekolah"', /Kode Sekolah/i.test(txt));
    for (const label of ['Identitas Sekolah', 'Akun & Layanan', 'Sudah Disiapkan Otomatis', 'Kelas X', 'kategori poin', 'Portal Cek Poin Siswa']) {
      ok(`pratinjau memuat bagian "${label}"`, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(txt), txt.slice(0, 200));
    }
    ok('username admin hasil daftar tampil di pratinjau', /admin/i.test(txt) && txt.includes(kodeUi));
    ok('alamat portal siswa ditampilkan', /\/portal-siswa/.test(txt));

    /* tombol lanjut TIDAK langsung ditekan: tunggu > 3 detik, harus tetap di pratinjau */
    await page.waitForTimeout(3500);
    ok('TIDAK dialihkan otomatis ke dashboard', /\/daftar$/.test(new URL(page.url()).pathname) &&
      /Pendaftaran Berhasil/i.test(await page.locator('body').innerText()), page.url());
    ok('sidebar dashboard belum tampil sebelum tombol ditekan', (await page.locator('aside nav button').count()) === 0);

    /* salin kode */
    await page.click('[data-salin-kode]');
    await page.waitForTimeout(400);
    const labelSalin = await page.locator('[data-salin-kode]').innerText();
    const tersalin = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '');
    ok('tombol "Salin Kode" menyalin kode sekolah', /Tersalin/i.test(labelSalin) || tersalin === kodeUi,
      `${labelSalin} | ${tersalin}`);

    /* tombol menuju dashboard */
    ok('tombol "Buka Dashboard Sekolah" tersedia', (await page.locator('[data-ke-dashboard]').count()) === 1);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('[data-ke-dashboard]')
    ]);
    await page.waitForTimeout(2200);
    ok('tombol membawa pendaftar ke dashboard sekolah', (await page.locator('aside nav button').count()) >= 8,
      (await page.locator('body').innerText()).slice(0, 120));
    ok('URL setelah masuk memakai #/dashboard', /#\/dashboard/.test(page.url()), page.url());
    ok('dashboard menampilkan identitas sekolah baru', /SMA Pratinjau UI/i.test(await page.locator('body').innerText()));
    ok('tanpa error JavaScript di halaman pendaftaran/pratinjau', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
    await ctx.close();

    /* ================= 3. MOBILE ================= */
    console.log('\n== MOBILE 390px ==');
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    page = await ctx.newPage();
    const mErrors = [];
    page.on('pageerror', e => mErrors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE + '/daftar', { waitUntil: 'networkidle' });
    await page.fill('input[placeholder*="SMP Negeri"]', 'SMA Pratinjau Mobile');
    await page.selectOption('select', 'SMA');
    await page.fill('textarea', 'Jl. Mobile No. 9');
    await page.locator('label:has-text("Nama Admin") + div input, label:has-text("Nama Admin") ~ div input').first().fill('Admin Mobile').catch(() => {});
    await page.fill('input[placeholder="admin@sekolah.sch.id"]', 'admin@pratinjaumobile.sch.id');
    await page.locator('[data-daftar-telp]').fill('81234500088');
    await page.locator('[data-password]').fill('Rahasia123!');
    await page.waitForTimeout(4600);
    gateway.clearCode();
    await page.click('button:has-text("Kirim Kode OTP WhatsApp")');
    const codeMobile = await gateway.waitForCode();
    await page.fill('input[placeholder="000000"]', codeMobile);
    await page.click('button:has-text("Coba Gratis")');
    await page.waitForTimeout(1500);
    ok('pratinjau tampil di layar 390px', /Pendaftaran Berhasil/i.test(await page.locator('body').innerText()));
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: document.documentElement.clientWidth
    }));
    ok('pratinjau tidak melebar horizontal di mobile', overflow.doc <= overflow.win + 2, JSON.stringify(overflow));
    ok('tombol dashboard tetap terlihat di mobile', await page.locator('[data-ke-dashboard]').isVisible());
    ok('tanpa error JavaScript di mobile', mErrors.length === 0, mErrors.slice(0, 2).join(' | '));
    await page.close();
    await ctx.close();
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.message);
    console.log('  ✗ EXCEPTION: ' + e.message);
    console.log(e.stack);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await gateway.close().catch(() => {});
    if (fail) console.log('\nLOG SERVER:\n' + log.join('').slice(-2500));
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} lulus, ${fail} gagal`);
  if (fail) { console.log('Gagal:\n- ' + fails.join('\n- ')); process.exit(1); }
})();
