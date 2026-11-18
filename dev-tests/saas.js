'use strict';
/* Uji API modul SaaS / Super Admin (multi-tenant):
   dashboard, daftar sekolah, kode 4 digit, paket, pembayaran & verifikasi, cron idempoten,
   tiket dua arah, pengumuman & maintenance, panduan, audit, WA, backup/restore, database manager,
   pendaftaran mandiri + kelas otomatis, kontrol fitur per paket, serta batas akses.
   Jalankan: node dev-tests/saas.js */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-saas-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 6000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];
let waMock = null;
let waLastRequest = null;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra !== undefined ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function client() {
  let cookie = '';
  const req = async (p, opts = {}) => {
    const r = await fetch(BASE + p, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.raw ? { 'Content-Type': 'application/octet-stream' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : (opts.raw || undefined),
      redirect: 'manual'
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    if (sc.length) {
      const list = sc.map(c => c.split(';')[0]).filter(Boolean);
      const map = new Map();
      for (const part of (cookie ? cookie.split('; ') : []).concat(list)) {
        const i = part.indexOf('=');
        if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
      }
      cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const ct = r.headers.get('content-type') || '';
    let body = null;
    if (ct.includes('json')) body = await r.json().catch(() => null);
    else if (ct.includes('text') || ct.includes('html')) body = await r.text();
    else body = Buffer.from(await r.arrayBuffer());
    return { status: r.status, body, ct, headers: r.headers };
  };
  return { req, cookieOf: () => cookie };
}

(async () => {
  const gateway = await otpTest.startGateway();
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, APP_TIMEZONE: 'Asia/Jakarta' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logBuf = [];
  srv.stdout.on('data', d => logBuf.push(String(d)));
  srv.stderr.on('data', d => logBuf.push('[err] ' + String(d)));
  const waitUp = async () => {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(BASE + '/api/public/config'); if (r.ok) return; } catch (e) { /* belum */ }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('server tidak siap: ' + logBuf.join(''));
  };

  const su = client();     // super admin
  const t1 = client();     // sekolah pertama (Lifetime / sekolah lama)
  const t2 = client();     // sekolah baru hasil pendaftaran

  try {
    await waitUp();

    /* ================= 1. LOGIN SUPER ADMIN & DASHBOARD ================= */
    console.log('\n== SUPER ADMIN: LOGIN & DASHBOARD ==');
    let r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'salah' } });
    ok('login super admin dengan sandi salah ditolak', r.status === 401, String(r.status));
    r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('login super admin berhasil', r.status === 200 && r.body.scope === 'super', JSON.stringify(r.body).slice(0, 120));
    r = await su.req('/api/bootstrap');
    ok('bootstrap super admin memakai scope super', r.body.scope === 'super');
    ok('bootstrap super admin memuat statistik', !!r.body.stats && typeof r.body.stats.total === 'number');
    r = await su.req('/api/super/dashboard');
    ok('dashboard: kartu Total Sekolah tersedia', typeof r.body.stats.total === 'number', JSON.stringify(r.body.stats));
    ok('dashboard: kartu Sekolah Aktif tersedia', typeof r.body.stats.aktif === 'number');
    ok('dashboard: kartu Sekolah Terdaftar tersedia', typeof r.body.stats.terdaftar === 'number');
    ok('sekolah lama otomatis jadi tenant Lifetime',
      (r.body.terbaru || []).some(t => t.lifetime), JSON.stringify((r.body.terbaru || []).map(t => [t.kode, t.paket])));
    ok('menampilkan paket bawaan (basic/premium/lifetime)',
      (r.body.paket || []).map(p => p.kode).join(',') === 'basic,premium,lifetime',
      (r.body.paket || []).map(p => p.kode).join(','));

    /* ================= 2. DAFTAR SEKOLAH ================= */
    console.log('\n== DAFTAR SEKOLAH (TENANT) ==');
    r = await su.req('/api/super/sekolah');
    ok('daftar sekolah memuat tenant pertama', (r.body.rows || []).length >= 1);
    const tenantAwal = r.body.rows[0];
    ok('tenant pertama berstatus Lifetime', tenantAwal.lifetime === true, JSON.stringify({ p: tenantAwal.paket, l: tenantAwal.lifetime }));
    ok('kode sekolah 4 digit', /^\d{4}$/.test(String(tenantAwal.kode)), tenantAwal.kode);

    r = await su.req('/api/super/sekolah/simpan', { method: 'POST', body: {
      nama: 'SD Negeri 3 Ciamis', jenjang: 'SD', alamat: 'Jl. Pendidikan 3', kepala: 'Drs. Contoh',
      kontak_nama: 'Ibu Rina', telp: '081200000003', email_admin: 'sd3@contoh.sch.id',
      admin_username: 'admin', admin_password: 'SandiSekolah1', paket: 'basic', trial_hari: 7
    } });
    ok('tambah sekolah berhasil', r.status === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 200));
    const sd = r.body.tenant;
    ok('kode sekolah baru 4 digit acak', /^\d{4}$/.test(String(sd.kode)), String(sd.kode));
    ok('kode sekolah baru berbeda dari sekolah lama', sd.kode !== tenantAwal.kode);
    ok('status sekolah baru = trial/uji coba', sd.status_label === 'Uji Coba', sd.status_label);
    ok('masa uji coba = hari ini + 7', (() => {
      const d = new Date(); d.setDate(d.getDate() + 7);
      const p = n => String(n).padStart(2, '0');
      return sd.aktif_sampai === `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })(), sd.aktif_sampai);

    r = await su.req('/api/super/sekolah/' + sd.id);
    ok('detail sekolah memuat akun admin', (r.body.admins || []).length >= 1, JSON.stringify((r.body.admins || []).map(a => a.username)));
    ok('detail memuat ringkasan jumlah data', r.body.jumlah && typeof r.body.jumlah.siswa === 'number');
    ok('detail memuat daftar paket & fitur', (r.body.paket || []).length >= 3 && (r.body.fitur_all || []).length >= 10);

    /* kelas otomatis sesuai jenjang SD */
    r = await t2.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiSekolah1', kode: sd.kode } });
    ok('admin sekolah baru dapat masuk dengan kode sekolah', r.status === 200 && r.body.scope === 'tenant', JSON.stringify(r.body).slice(0, 160));
    r = await t2.req('/api/kelas');
    const namaKelas = (r.body.rows || []).map(k => k.nama).join(', ');
    ok('kelas bawaan dibuat otomatis sesuai jenjang SD (I–VI)',
      /I/.test(namaKelas) && /VI/.test(namaKelas) && !/X 1/.test(namaKelas), namaKelas);
    ok('jumlah kelas bawaan = 6', (r.body.rows || []).length === 6, String((r.body.rows || []).length));

    /* kontrol fitur per paket */
    r = await t2.req('/api/jurnal');
    ok('paket basic tidak membuka modul Buku Penghubung (403)', r.status === 403, String(r.status));
    r = await t2.req('/api/siswa');
    ok('paket basic tetap membuka Data Siswa', r.status === 200, String(r.status));
    r = await su.req('/api/super/sekolah/fitur', { method: 'POST', body: { id: sd.id, fitur: ['dashboard', 'jurnal', 'siswa'] } });
    ok('kontrol fitur khusus disimpan', r.status === 200 && r.body.tenant.fitur.length === 3, JSON.stringify(r.body.tenant && r.body.tenant.fitur));
    r = await t2.req('/api/jurnal');
    ok('modul Buku Penghubung terbuka setelah kontrol fitur', r.status === 200, String(r.status));
    r = await su.req('/api/super/sekolah/fitur', { method: 'POST', body: { id: sd.id, fitur: [] } });

    /* reset sandi + generator + login as tenant */
    r = await su.req('/api/super/sekolah/' + sd.id + '/password-acak?panjang=12');
    ok('generator kata sandi acak menghasilkan 12 karakter', r.body.password && r.body.password.length === 12, String(r.body.password || '').length);
    r = await su.req('/api/super/sekolah/password', { method: 'POST', body: { id: sd.id, password: 'SandiBaru123' } });
    ok('reset kata sandi admin sekolah', r.status === 200 && r.body.username === 'admin', JSON.stringify(r.body).slice(0, 120));
    const t2b = client();
    r = await t2b.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBaru123', kode: sd.kode } });
    ok('login memakai kata sandi hasil reset', r.status === 200, String(r.status));

    /* lifetime toggle */
    r = await su.req('/api/super/sekolah/lifetime', { method: 'POST', body: { id: sd.id, lifetime: true } });
    ok('toggle akses Lifetime aktif', r.body.tenant.lifetime === true && r.body.tenant.aktif_sampai === '');
    r = await su.req('/api/super/sekolah/lifetime', { method: 'POST', body: { id: sd.id, lifetime: false } });
    ok('toggle Lifetime bisa dimatikan kembali', r.body.tenant.lifetime === false);
    await su.req('/api/super/sekolah/perpanjang', { method: 'POST', body: { id: sd.id, bulan: 1 } });

    /* login as tenant */
    const sp = client();
    await sp.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    r = await sp.req('/api/super/sekolah/impersonate', { method: 'POST', body: { id: sd.id } });
    ok('fitur Login as Tenant berhasil', r.status === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 120));
    r = await sp.req('/api/bootstrap');
    ok('setelah Login as Tenant, sesi menjadi admin sekolah', r.body.scope === 'tenant' && r.body.user.role === 'admin',
      JSON.stringify({ scope: r.body.scope, role: r.body.user && r.body.user.role }));
    ok('panel sekolah menampilkan kode sekolah', r.body.tenant.kode === sd.kode);

    /* ================= 3. PAKET LANGGANAN ================= */
    console.log('\n== PAKET LANGGANAN ==');
    r = await su.req('/api/super/paket');
    ok('daftar paket memuat fitur & harga', (r.body.rows || []).every(p => Array.isArray(p.fitur)));
    r = await su.req('/api/super/paket', { method: 'POST', body: {
      kode: 'sekolahkecil', nama: 'Sekolah Kecil', harga_bulanan: 25000, harga_tahunan: 250000,
      trial_hari: 5, deskripsi: 'Uji paket baru', fitur: ['dashboard', 'kejadian']
    } });
    ok('tambah paket baru', r.status === 200 && r.body.paket.kode === 'sekolahkecil');
    r = await su.req('/api/super/paket/toggle', { method: 'POST', body: { kode: 'sekolahkecil' } });
    ok('paket dapat dinonaktifkan', Number(r.body.paket.aktif) === 0, JSON.stringify(r.body.paket && r.body.paket.aktif));
    r = await su.req('/api/super/paket/hapus', { method: 'POST', body: { kode: 'basic' } });
    ok('paket yang masih dipakai tidak boleh dihapus', r.status === 400, String(r.status));
    r = await su.req('/api/super/paket/hapus', { method: 'POST', body: { kode: 'sekolahkecil' } });
    ok('paket tak terpakai dapat dihapus', r.status === 200);

    /* ================= 4. PEMBAYARAN & CRON ================= */
    console.log('\n== PEMBAYARAN & PENAGIHAN ==');
    /* ajukan pembayaran dari sisi sekolah */
    const t3 = client();
    await t3.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBaru123', kode: sd.kode } });
    r = await t3.req('/api/langganan');
    ok('sekolah dapat membuka Info & Layanan', r.status === 200 && !!r.body.tenant, String(r.status));
    ok('info langganan memuat tanggal register', !!r.body.tenant.created_at);
    ok('info langganan memuat nominal tagihan/paket', typeof r.body.harga_bulanan === 'number');
    ok('info langganan memuat masa aktif', !!r.body.tenant.aktif_sampai);
    r = await t3.req('/api/langganan/bayar', { method: 'POST', body: { paket: 'basic', bulan: 1, metode: 'qris', catatan: 'transfer BCA' } });
    ok('sekolah mengajukan perpanjangan 1 bulan', r.status === 200 && r.body.pembayaran.status === 'menunggu', JSON.stringify(r.body).slice(0, 160));
    const pyId = r.body.pembayaran.id;
    r = await t3.req('/api/langganan/bayar', { method: 'POST', body: { paket: 'basic', bulan: 12, promo: 'HEMAT10' } });
    ok('pengajuan 12 bulan + kode promo tidak dikenal tetap dihitung', r.status === 200 && Number(r.body.pembayaran.potongan) === 0);

    r = await su.req('/api/super/pembayaran?status=menunggu');
    ok('super admin melihat pembayaran menunggu verifikasi', (r.body.rows || []).length >= 2, String((r.body.rows || []).length));
    ok('ringkasan status verifikasi tersedia', r.body.ringkas && r.body.ringkas.menunggu >= 2);
    const aktifSebelum = (await su.req('/api/super/sekolah/' + sd.id)).body.tenant.aktif_sampai;
    r = await su.req('/api/super/pembayaran/verifikasi', { method: 'POST', body: { id: pyId, aksi: 'setuju' } });
    ok('verifikasi pembayaran disetujui', r.status === 200 && r.body.pembayaran.status === 'disetujui');
    const aktifSesudah = (await su.req('/api/super/sekolah/' + sd.id)).body.tenant.aktif_sampai;
    ok('masa aktif sekolah bertambah setelah verifikasi', aktifSesudah > aktifSebelum, `${aktifSebelum} → ${aktifSesudah}`);
    r = await su.req('/api/super/pembayaran/verifikasi', { method: 'POST', body: { id: pyId, aksi: 'setuju' } });
    ok('pembayaran yang sudah diproses tidak bisa diverifikasi ulang', r.status === 400);

    /* cron idempoten */
    r = await su.req('/api/super/cron', { method: 'POST' });
    const run1 = r.body.hasil;
    ok('tombol pemeriksaan tagihan berjalan', r.status === 200 && !!run1, JSON.stringify(run1));
    r = await su.req('/api/super/cron', { method: 'POST' });
    const run2 = r.body.hasil;
    ok('cron kedua tidak membuat tagihan ganda', run2.dibuat === 0, JSON.stringify(run2));
    ok('cron kedua tidak mengirim notifikasi ganda', run2.notif === 0, JSON.stringify(run2));
    r = await su.req('/api/super/pembayaran');
    const periodeTagihan = (r.body.tagihan || []).map(g => g.periode);
    ok('tidak ada tagihan periode ganda', new Set(periodeTagihan).size === periodeTagihan.length, periodeTagihan.join(','));

    /* suspend otomatis untuk sekolah kedaluwarsa */
    r = await su.req('/api/super/sekolah/simpan', { method: 'POST', body: {
      id: sd.id, aktif_sampai: '2020-01-01'
    } });
    ok('masa aktif sekolah dapat dimundurkan (uji suspend)', r.status === 200);
    await su.req('/api/super/cron', { method: 'POST' });
    r = await su.req('/api/super/sekolah/' + sd.id);
    ok('sekolah kedaluwarsa otomatis ditangguhkan', r.body.tenant.status === 'ditangguhkan', r.body.tenant.status);
    const t4 = client();
    r = await t4.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBaru123', kode: sd.kode } });
    ok('sekolah ditangguhkan masih bisa masuk (untuk perpanjang)', r.status === 200 && r.body.ditangguhkan === true, JSON.stringify(r.body).slice(0, 160));
    r = await t4.req('/api/siswa');
    ok('menu operasional diblokir saat ditangguhkan', r.status === 402, String(r.status));
    r = await t4.req('/api/langganan');
    ok('menu Info & Layanan tetap terbuka saat ditangguhkan', r.status === 200, String(r.status));
    await su.req('/api/super/sekolah/status', { method: 'POST', body: { id: sd.id, status: 'aktif' } });
    await su.req('/api/super/sekolah/perpanjang', { method: 'POST', body: { id: sd.id, bulan: 1 } });

    /* ================= 5. TIKET DUA ARAH ================= */
    console.log('\n== PUSAT TIKET ==');
    r = await t3.req('/api/tiket', { method: 'POST', body: { judul: 'Tidak bisa cetak surat', kategori: 'teknis', prioritas: 'tinggi', pesan: 'Tombol cetak tidak merespon' } });
    ok('sekolah membuat tiket', r.status === 200 && r.body.tiket.id > 0);
    const tiketId = r.body.tiket.id;
    r = await su.req('/api/super/tiket');
    ok('tiket tampil di panel super admin', (r.body.rows || []).some(k => k.id === tiketId));
    r = await su.req('/api/super/tiket/balas', { method: 'POST', body: { id: tiketId, pesan: 'Terima kasih, kami periksa ya.' } });
    ok('super admin membalas tiket', r.status === 200 && r.body.tiket.pesan.length >= 2);
    ok('status tiket otomatis menjadi diproses', r.body.tiket.status === 'diproses', r.body.tiket.status);
    r = await t3.req('/api/tiket');
    const tiketSekolah = (r.body.rows || []).find(k => k.id === tiketId);
    ok('balasan super admin tampil di akun sekolah', !!tiketSekolah && tiketSekolah.pesan.some(m => m.dari === 'super'));
    r = await t3.req('/api/tiket/balas', { method: 'POST', body: { id: tiketId, pesan: 'Sudah dicoba, masih sama.' } });
    ok('sekolah dapat membalas kembali (dua arah)', r.status === 200 && r.body.tiket.pesan.length >= 3);
    const tLain = client();
    await tLain.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123', kode: tenantAwal.kode } });
    r = await tLain.req('/api/tiket/balas', { method: 'POST', body: { id: tiketId, pesan: 'coba titip balasan' } });
    ok('sekolah lain tidak bisa membalas tiket sekolah ini', r.status === 404, String(r.status));

    /* ================= 6. PENGUMUMAN & MAINTENANCE ================= */
    console.log('\n== PENGUMUMAN & MAINTENANCE ==');
    r = await su.req('/api/super/pengumuman', { method: 'POST', body: { judul: 'Pembaruan fitur Juli', isi: 'Portal orang tua diperbarui.', tipe: 'info', aktif: 1 } });
    ok('pengumuman dibuat', r.status === 200 && (r.body.rows || []).length >= 1);
    r = await t3.req('/api/bootstrap');
    ok('pengumuman tampil di panel sekolah', (r.body.pengumuman || []).some(p => /Pembaruan fitur/.test(p.judul)));
    r = await su.req('/api/super/pengumuman', { method: 'POST', body: { maintenance_aktif: true, maintenance_pesan: 'Sedang pemeliharaan 30 menit.' } });
    ok('mode pemeliharaan diaktifkan', r.status === 200);
    const t5 = client();
    r = await t5.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBaru123', kode: sd.kode } });
    ok('login diblokir saat mode pemeliharaan', r.status === 503, String(r.status));
    await su.req('/api/super/pengumuman', { method: 'POST', body: { maintenance_aktif: false, maintenance_pesan: 'Sistem normal.' } });
    r = await t5.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBaru123', kode: sd.kode } });
    ok('login kembali normal setelah maintenance dimatikan', r.status === 200);

    /* ================= 7. PANDUAN & LEGAL ================= */
    console.log('\n== PANDUAN & LEGAL ==');
    r = await su.req('/api/super/panduan', { method: 'POST', body: { untuk: 'sekolah', judul: 'Cara input kejadian', tipe: 'youtube', url: 'https://youtu.be/aBcD1234xyz', deskripsi: 'Video singkat', urutan: 1, aktif: 1 } });
    ok('petunjuk pengguna (YouTube) disimpan', r.status === 200);
    r = await su.req('/api/super/panduan', { method: 'POST', body: { untuk: 'sekolah', judul: 'Panduan PDF', tipe: 'pdf', url: 'https://contoh.id/panduan.pdf', aktif: 1 } });
    ok('petunjuk pengguna (PDF) disimpan', r.status === 200);
    r = await su.req('/api/super/panduan', { method: 'POST', body: { untuk: 'sekolah', judul: 'Salah', tipe: 'pdf', url: 'bukan-url' } });
    ok('tautan panduan tidak valid ditolak', r.status === 400);
    r = await t3.req('/api/panduan');
    ok('petunjuk tampil di akun sekolah', (r.body.rows || []).length >= 2);
    ok('YouTube embed id terdeteksi', (r.body.rows || []).some(p => p.embed === 'aBcD1234xyz'), JSON.stringify((r.body.rows || []).map(p => p.embed)));

    r = await su.req('/api/super/legal', { method: 'POST', body: {
      tos_judul: 'Syarat Layanan Uji', tos_isi: '1. Ketentuan pertama.\n2. Ketentuan kedua.',
      sla_judul: 'SLA Uji', sla_isi: '1. Uptime 99%.'
    } });
    ok('dokumen TOS & SLA disimpan', r.status === 200);
    r = await t3.req('/api/legal');
    ok('TOS otomatis muncul di menu Legal sekolah', r.body.tos_judul === 'Syarat Layanan Uji' && /Ketentuan pertama/.test(r.body.tos_isi));
    ok('SLA otomatis muncul di menu Legal sekolah', r.body.sla_judul === 'SLA Uji' && /Uptime/.test(r.body.sla_isi));

    /* ================= 8. BRANDING, QRIS, MENU, AUDIT ================= */
    console.log('\n== BRANDING / QRIS / MENU / AUDIT ==');
    r = await su.req('/api/super/branding', { method: 'POST', body: {
      app_nama: 'TATA TERTIB DIGITAL', app_subtitle: 'Uji Subjudul', trial_hari: 10,
      paket_default: 'premium', domain_info: 'tertib.contoh.id', subdomain_info: 'sekolah.contoh.id', server_info: 'VPS Uji'
    } });
    ok('branding sistem disimpan', r.status === 200 && r.body.platform.app_nama === 'TATA TERTIB DIGITAL');
    r = await fetch(BASE + '/api/public/config').then(x => x.json());
    ok('branding nama aplikasi platform tersimpan', r.platform.app_nama === 'TATA TERTIB DIGITAL', r.platform.app_nama);
    ok('judul halaman login mengikuti nama aplikasi bila nama layanan kosong',
      r.platform.layanan_nama === 'TATA TERTIB DIGITAL', r.platform.layanan_nama);
    ok('halaman login memuat harga & trial', typeof r.platform.harga_bulanan === 'number' && r.platform.trial_hari === 10);
    ok('pendaftaran mandiri terbuka', r.platform.pendaftaran_aktif === true);

    r = await su.req('/api/super/qris', { method: 'POST', body: {
      qris_img: 'https://contoh.id/qris.png', rek_nama: 'Yayasan Contoh', rek_nomor: '081200001111',
      instruksi_bayar: 'Scan QRIS lalu unggah bukti.', harga_bulanan: 75000, harga_tahunan: 750000, trial_hari: 7,
      layanan_nama: 'Tata Tertib Digital', promo: [{ kode: 'HEMAT20', persen: 20, catatan: 'awal tahun' }]
    } });
    ok('QRIS & harga disimpan', r.status === 200 && r.body.promo.length === 1, JSON.stringify(r.body.promo));
    r = await t3.req('/api/langganan');
    ok('halaman perpanjangan menampilkan QRIS & instruksi', r.body.qris.img.includes('qris.png') && /Scan QRIS/.test(r.body.qris.instruksi));
    ok('kode promo aktif tampil di akun sekolah', (r.body.promo_aktif || []).some(p => p.kode === 'HEMAT20'));
    r = await t3.req('/api/langganan/bayar', { method: 'POST', body: { paket: 'basic', bulan: 1, promo: 'HEMAT20' } });
    ok('potongan promo dihitung otomatis (20%)',
      Number(r.body.pembayaran.potongan) === Math.round(Number(r.body.pembayaran.nominal) * 0.2),
      JSON.stringify({ n: r.body.pembayaran.nominal, p: r.body.pembayaran.potongan }));

    r = await su.req('/api/super/menu-default');
    const rowsMenu = (r.body.rows || []).map((m, i) => ({ ...m, label: i === 0 ? 'Beranda Utama' : m.label, urutan: i + 1 }));
    ok('menu default memuat seluruh menu', rowsMenu.length >= 15, String(rowsMenu.length));
    r = await su.req('/api/super/menu-default', { method: 'POST', body: { rows: rowsMenu, terapkan: true } });
    ok('menu default disimpan & diterapkan ke sekolah', r.status === 200 && /disimpan/.test(r.body.pesan), r.body.pesan);
    r = await t3.req('/api/bootstrap');
    ok('nama menu pada akun sekolah ikut berubah', (r.body.settings.nav || []).some(n => n.label === 'Beranda Utama'),
      JSON.stringify((r.body.settings.nav || []).slice(0, 2)));

    r = await su.req('/api/super/audit?limit=200');
    ok('audit log mencatat aktivitas super admin', (r.body.rows || []).length >= 10, String((r.body.rows || []).length));
    ok('audit memuat aksi verifikasi pembayaran', (r.body.rows || []).some(a => /VERIFIKASI BAYAR/.test(a.aksi)));
    ok('audit memuat aksi pembuatan sekolah', (r.body.rows || []).some(a => /TAMBAH/.test(a.aksi) && /sekolah/.test(a.modul)));

    /* ================= 9. WHATSAPP ================= */
    console.log('\n== WHATSAPP GATEWAY ==');
    r = await su.req('/api/super/wa', { method: 'POST', body: { wa_aktif: false, wa_api_url: '', wa_api_token: '', wa_payload: '{"target":"{phone}","message":"{pesan}"}' } });
    ok('konfigurasi WA disimpan', r.status === 200);
    r = await su.req('/api/super/wa/uji', { method: 'POST', body: { telp: '081200000003', pesan: 'uji' } });
    ok('uji WA tanpa gateway ditolak dengan pesan jelas', r.status === 400, String(r.status));
    r = await su.req('/api/super/wa');
    ok('log pengiriman WA tercatat', (r.body.log || []).length >= 1);
    waMock = http.createServer((request, response) => {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { raw += chunk; });
      request.on('end', () => {
        waLastRequest = {
          authorization: request.headers.authorization || '',
          contentType: request.headers['content-type'] || '',
          body: raw
        };
        let accepted = false;
        if (waLastRequest.authorization === 'TOKEN-FONNTE'
          && /application\/x-www-form-urlencoded/i.test(waLastRequest.contentType)) {
          const form = new URLSearchParams(raw);
          accepted = form.get('target') === '6281200000003' && form.get('message') === 'uji Fonnte';
        } else if (waLastRequest.authorization === 'Bearer TOKEN-GENERIK'
          && /application\/json/i.test(waLastRequest.contentType)) {
          try {
            const json = JSON.parse(raw);
            accepted = json.target === '6281200000003' && json.message === 'uji generik';
          } catch (e) { accepted = false; }
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(accepted ? { status: true } : { status: false, reason: 'Invalid token or request format' }));
      });
    });
    await new Promise((resolve, reject) => {
      waMock.once('error', reject);
      waMock.listen(0, '127.0.0.1', resolve);
    });
    const waMockUrl = `http://127.0.0.1:${waMock.address().port}`;
    r = await su.req('/api/super/wa', { method: 'POST', body: {
      wa_aktif: true, wa_api_url: waMockUrl + '/api.fonnte.com/send',
      wa_api_token: 'Bearer TOKEN-FONNTE', wa_payload: '{"target":"{phone}","message":"{pesan}"}'
    } });
    ok('gateway Super Admin menerima konfigurasi Fonnte', r.status === 200);
    r = await su.req('/api/super/wa/uji', {
      method: 'POST', body: { telp: '081200000003', pesan: 'uji Fonnte' }
    });
    ok('gateway Super Admin mengirim token Fonnte tanpa Bearer dan form-urlencoded',
      r.status === 200 && waLastRequest.authorization === 'TOKEN-FONNTE'
        && /application\/x-www-form-urlencoded/i.test(waLastRequest.contentType),
      JSON.stringify({ response: r.body, request: waLastRequest }));
    r = await su.req('/api/super/wa', { method: 'POST', body: {
      wa_aktif: true, wa_api_url: waMockUrl + '/generic/send',
      wa_api_token: 'Bearer TOKEN-GENERIK', wa_payload: '{"target":"{phone}","message":"{pesan}"}'
    } });
    ok('gateway generik Super Admin tetap tersimpan', r.status === 200);
    r = await su.req('/api/super/wa/uji', {
      method: 'POST', body: { telp: '081200000003', pesan: 'uji generik' }
    });
    ok('gateway generik tidak menggandakan awalan Bearer',
      r.status === 200 && waLastRequest.authorization === 'Bearer TOKEN-GENERIK',
      JSON.stringify({ response: r.body, authorization: waLastRequest.authorization }));
    await su.req('/api/super/wa', { method: 'POST', body: {
      wa_aktif: false, wa_api_url: '', wa_api_token: ''
    } });

    /* ================= 10. BACKUP & DATABASE MANAGER ================= */
    console.log('\n== BACKUP & DATABASE MANAGER ==');
    r = await su.req('/api/super/backup');
    ok('halaman backup memuat ringkasan & tenant', r.status === 200 && (r.body.tenants || []).length >= 2);
    const tgToken = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890';
    r = await su.req('/api/super/backup/telegram', { method: 'POST', body: { telegram_bot_token: tgToken,
      telegram_chat_id: '-100123', telegram_jam: '06:00, 15:00', telegram_auto: false } });
    ok('konfigurasi Telegram platform menyimpan token tanpa mengembalikannya', r.status === 200
      && r.body.telegram.token_set && !JSON.stringify(r.body).includes(tgToken));
    r = await su.req('/api/super/backup/telegram', { method: 'POST', body: { telegram_jam: '25:00' } });
    ok('jadwal Telegram platform tidak valid ditolak', r.status === 400);
    r = await su.req('/api/super/backup');
    ok('API backup platform hanya mengirim status token tersamar', r.status === 200
      && r.body.telegram.token_set && !JSON.stringify(r.body).includes(tgToken));
    r = await su.req('/api/super/branding');
    ok('API branding tidak membocorkan token Telegram', r.body.s.telegram_bot_token === '');
    r = await su.req('/api/super/wa');
    ok('API WhatsApp tidak membocorkan token Telegram dari settings', r.body.s.telegram_bot_token === '');
    r = await su.req('/api/super/qris');
    ok('API gateway pembayaran tidak membocorkan token Telegram', r.body.s.telegram_bot_token === '');
    r = await su.req('/api/super/database?scope=saas&tabel=saas_settings');
    const tgDbRow = (r.body.rows || []).find(x => x.key === 'telegram_bot_token');
    ok('Database Manager menyamarkan token Telegram', !!tgDbRow && tgDbRow.value === '');
    r = await su.req('/api/super/database/baris', { method: 'POST', body: {
      scope: 'saas', tabel: 'saas_settings', rowid: tgDbRow && tgDbRow.__rowid, data: { value: 'must-not-save' }
    } });
    ok('Database Manager tidak dapat menimpa kredensial yang disamarkan', r.status === 400);
    r = await su.req('/api/super/backup/zip');
    ok('unduh backup ZIP berhasil', r.status === 200 && r.body.length > 500 && /zip/.test(r.ct), `${r.status} ${r.ct} ${r.body.length}`);
    const zipBuf = r.body;
    const backupEntries = require('../xlsx-read').unzipEntries(zipBuf);
    const platformDb = JSON.parse(backupEntries['saas/database.json'].toString('utf8'));
    ok('ZIP platform meredaksi token dari JSON dan SQL', (platformDb.tabel.saas_settings || [])
      .find(x => x.key === 'telegram_bot_token')?.value === ''
      && !backupEntries['database.sql'].toString('utf8').includes(tgToken));
    r = await su.req('/api/super/backup');
    ok('log backup tercatat setelah unduh ZIP', (r.body.log || []).some(l => l.jenis === 'zip'),
      JSON.stringify((r.body.log || []).map(l => l.jenis)));
    r = await su.req('/api/super/backup/sql');
    ok('unduh backup SQL berhasil', r.status === 200 && /CREATE TABLE/i.test(r.body.toString()), String(r.status));
    r = await su.req('/api/super/backup/source');
    ok('unduh source code berhasil', r.status === 200 && r.body.length > 10000, `${r.status} ${r.body.length}`);
    r = await su.req('/api/super/backup/restore', { method: 'POST', body: { base64: zipBuf.toString('base64'), filename: 'backup.zip' } });
    ok('restore database dari ZIP berhasil', r.status === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 200));
    /* (riwayat backup diperiksa setelah login ulang di blok berikut) */

    /* restore menghapus seluruh sesi (keamanan) → semua klien harus login ulang */
    const sesiHilang = await t3.req('/api/bootstrap');
    ok('restore menghapus semua sesi aktif (wajib login ulang)', !sesiHilang.body.user, JSON.stringify(sesiHilang.body.user || null));
    r = await su.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    ok('super admin dapat masuk kembali setelah restore', r.status === 200, String(r.status));
    await t3.req('/api/login', { method: 'POST', body: { username: 'admin', password: 'SandiBaru123', kode: sd.kode } });
    r = await su.req('/api/super/backup');
    ok('riwayat backup mencatat unduhan manual', (r.body.log || []).some(l => l.jenis === 'zip'),
      JSON.stringify((r.body.log || []).map(l => l.jenis)));

    r = await su.req('/api/super/database?scope=saas');
    ok('database manager memuat daftar tabel control plane', (r.body.tabel || []).includes('tenants'));
    ok('database manager memuat daftar database sekolah', (r.body.daftar || []).length >= 3, String((r.body.daftar || []).length));
    r = await su.req('/api/super/database?scope=t:' + sd.id);
    ok('database manager dapat membuka DB sekolah', (r.body.tabel || []).includes('siswa'), JSON.stringify((r.body.tabel || []).slice(0, 5)));
    r = await su.req('/api/super/database/query', { method: 'POST', body: { scope: 'saas', sql: 'SELECT COUNT(*) c FROM tenants' } });
    ok('konsol SQL membaca data', r.status === 200 && r.body.rows[0].c >= 2, JSON.stringify(r.body.rows));
    r = await su.req('/api/super/database/query', { method: 'POST', body: { scope: 'saas', sql: 'DELETE FROM tenants' } });
    ok('perintah tulis tanpa konfirmasi ditolak', r.status === 400);
    r = await su.req('/api/super/database/query', { method: 'POST', body: { scope: 'saas', sql: 'PRAGMA wal_checkpoint' } });
    ok('perintah berbahaya diblokir', r.status === 400);
    r = await su.req('/api/super/database/orphan');
    ok('pemindaian berkas database yatim berjalan', r.status === 200 && Array.isArray(r.body.rows));
    r = await su.req('/api/super/database/orphan/hapus', { method: 'POST' });
    ok('perapian berkas yatim tidak error', r.status === 200 && typeof r.body.dihapus === 'number', JSON.stringify(r.body).slice(0, 120));

    /* ================= 11. PENDAFTARAN MANDIRI ================= */
    console.log('\n== PENDAFTARAN MANDIRI (SELF REGISTRATION) ==');
    const pub = client();
    const t6 = client();
    r = await pub.req('/api/daftar', { method: 'POST', body: {
      nama_sekolah: 'S', jenjang: 'SMA', alamat: '', admin_nama: 'A', email: 'salah', password: '123', password2: '456', telp: 'abc',
      t0: Date.now() - 10000
    } });
    ok('validasi pendaftaran menolak data tidak lengkap', r.status === 400 && /minimal|tidak valid|wajib/i.test(r.body.error), r.body.error);
    await otpTest.configure(su, gateway.url);
    r = await t6.req('/api/daftar', { method: 'POST', body: await otpTest.bodyWithOtp(t6, gateway, {
      nama_sekolah: 'SMA Negeri 1 Contoh', jenjang: 'SMA', alamat: 'Jl. Merdeka 1', kepala: 'Drs. Kepala',
      admin_nama: 'Bapak Admin', email: 'admin@sman1contoh.sch.id', password: 'Rahasia123!',
      telp: '081377788899', trial: true, t0: Date.now() - 10000
    }) });
    ok('pendaftaran mandiri berhasil', r.status === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 200));
    ok('kode sekolah otomatis 4 digit', /^\d{4}$/.test(String(r.body.kode)), String(r.body.kode));
    ok('uji coba 7 hari diberikan', (() => {
      const d = new Date(); d.setDate(d.getDate() + 7);
      const p = n => String(n).padStart(2, '0');
      return r.body.aktif_sampai === `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    })(), r.body.aktif_sampai);
    const kodeBaru = r.body.kode;
    r = await t6.req('/api/bootstrap');
    ok('pendaftar langsung masuk dashboard (auto login)', r.body.scope === 'tenant' && r.body.user && r.body.tenant.kode === kodeBaru,
      JSON.stringify({ scope: r.body.scope, tenant: r.body.tenant && r.body.tenant.kode }));
    r = await t6.req('/api/kelas');
    const kelasSMA = (r.body.rows || []).map(k => k.nama).join(',');
    ok('kelas bawaan SMA = X, XI, XII', /X/.test(kelasSMA) && /XI/.test(kelasSMA) && /XII/.test(kelasSMA), kelasSMA);
    r = await t6.req('/api/siswa');
    ok('akun baru dapat memakai aplikasi (Data Siswa)', r.status === 200, String(r.status));
    ok('menu akun & layanan tersedia untuk sekolah baru',
      r.status === 200);
    const bootBaru = (await t6.req('/api/bootstrap')).body;
    const navBaru = (bootBaru.settings.nav || []).map(n => n.key);
    ok('menu Info & Layanan, Pusat Bantuan, Petunjuk, Legal ada di sidebar',
      ['langganan', 'tiket', 'panduan', 'legal'].every(k => navBaru.includes(k)), navBaru.join(','));
    r = await pub.req('/api/daftar', { method: 'POST', body: {
      nama_sekolah: 'SMA Negeri 1 Contoh', jenjang: 'SMA', alamat: 'Jl. Merdeka 1',
      admin_nama: 'Bapak Admin', email: 'lain@sman1contoh.sch.id', password: 'Rahasia123!', telp: '081377788890',
      t0: Date.now() - 10000
    } });
    ok('nama sekolah ganda ditolak', r.status === 400, String(r.status));

    /* ================= 12. DOMAIN CUSTOM ================= */
    console.log('\n== DOMAIN CUSTOM ==');
    r = await t3.req('/api/domain', { method: 'POST', body: { domain: 'tertib.sd3contoh.sch.id' } });
    ok('sekolah dapat mengubah domain custom sendiri (menu Pengaturan)', r.status === 200 && /tertib/.test(r.body.domain || r.body.pesan));
    r = await t3.req('/api/domain');
    ok('panduan pemasangan domain tersedia', (r.body.langkah || []).length >= 4 && r.body.domain === 'tertib.sd3contoh.sch.id');
    r = await t3.req('/api/domain', { method: 'POST', body: { domain: 'bukan domain!!' } });
    ok('domain tidak valid ditolak', r.status === 400);
    r = await su.req('/api/super/sekolah/domain', { method: 'POST', body: { id: sd.id, domain: 'tertib.sd3contoh.sch.id' } });
    ok('super admin juga dapat melihat/menyimpan domain', r.status === 200);

    /* ================= 13. BATAS AKSES ================= */
    console.log('\n== BATAS AKSES (RBAC) ==');
    r = await t3.req('/api/super/sekolah');
    ok('sesi sekolah tidak boleh membuka API super admin', r.status === 401 || r.status === 403, String(r.status));
    const suOnly = client();
    await suOnly.req('/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin123' } });
    r = await suOnly.req('/api/siswa');
    ok('super admin tidak memakai endpoint panel sekolah (pesan jelas)', r.status === 400, String(r.status));
    const tanpaSesi = client();
    r = await tanpaSesi.req('/api/super/sekolah');
    ok('tanpa sesi, panel super admin ditolak', r.status === 401, String(r.status));
    r = await tanpaSesi.req('/api/langganan');
    ok('tanpa sesi, endpoint langganan ditolak', r.status === 401, String(r.status));

    /* ================= 14. DATA TERPISAH ANTAR SEKOLAH ================= */
    console.log('\n== ISOLASI DATA ANTAR SEKOLAH ==');
    await t6.req('/api/siswa/save', { method: 'POST', body: { nama: 'Siswa SMA Satu', kelas_id: (await t6.req('/api/kelas')).body.rows[0].id, gender: 'L' } });
    r = await t6.req('/api/siswa');
    ok('sekolah baru dapat menyimpan siswanya sendiri', (r.body.rows || []).some(s => /Siswa SMA Satu/.test(s.nama)));
    r = await t3.req('/api/siswa');
    ok('siswa sekolah lain tidak terlihat', !(r.body.rows || []).some(s => /Siswa SMA Satu/.test(s.nama)));
    r = await su.req('/api/super/dashboard');
    ok('dashboard menghitung total siswa lintas sekolah', r.body.stats.siswa >= 1, String(r.body.stats.siswa));
  } catch (e) {
    fail++;
    fails.push('EXCEPTION: ' + e.stack);
    console.error(e);
    console.error(logBuf.join('').slice(-3000));
  } finally {
    srv.kill('SIGKILL');
    await gateway.close().catch(() => {});
    if (waMock) await new Promise(resolve => waMock.close(resolve)).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
    console.log(`\n=== HASIL SAAS: ${pass} lulus, ${fail} gagal ===`);
    if (fails.length) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
