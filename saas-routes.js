'use strict';
/* =====================================================================
   RUTE SAAS — panel Super Admin platform + layanan langganan sekolah
   =====================================================================
   Dipasang oleh server.js:
       require('./saas-routes')({
         get, post, del, json, fail, readBody, guard, guardSuper, guardTenant,
         ipOf, lib, saas, dbm, db, path, fs, appBaseUrl
       })

   Semua rute Super Admin didaftarkan dengan opsi { saas: true } sehingga
   server tidak membuka database sekolah (control plane saja).
   ===================================================================== */
const xr = require('./xlsx-read');
const telegramBackup = require('./telegram-backup');

module.exports = function mount(apiCtx) {
  const {
    get, post, json, fail, readBody, readRaw, guardSuper, guardTenant, ipOf,
    lib, saas, dbm, path, fs, appBaseUrl
  } = apiCtx;
  const db = dbm.db;
  const TENANT_DIR = path.join(__dirname, 'data', 'sekolah');
  /**
   * Body MENTAH untuk verifikasi tanda tangan webhook (HMAC dihitung dari
   * byte asli yang dikirim gateway). Jatuh kembali ke pembaca biasa bila
   * server tidak menyediakan pembaca mentah.
   */
  const rawBodyOf = async req => {
    if (typeof readRaw === 'function') return readRaw(req);
    const b = await readBody(req);
    return JSON.stringify(b || {});
  };

  const SAAS = { saas: true };            // tanda: rute control plane
  const settingsForClient = () => {
    const s = saas.settings();
    s.telegram_bot_token = '';
    s.telegram_bot_token_set = Boolean(saas.telegramCfg().token_set);
    return s;
  };
  /* pembatas percobaan login portal Super Admin (per IP) */
  const superHits = new Map();
  /* pembatas pendaftaran mandiri (anti-spam, per IP) */
  const daftarHits = new Map();
  const adminName = req => {
    const c = apiCtx.contextOf ? apiCtx.contextOf(req) : null;
    return (c && c.user && c.user.nama) || 'Super Admin';
  };
  const tenantOf = req => (apiCtx.contextOf ? apiCtx.contextOf(req).tenant : null);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const bool = v => v === true || v === 1 || v === '1' || v === 'on' || v === 'true';
  const money = v => lib.parseMoney(v);
  const mapBulan = m => (Number(m) >= 12 ? 12 : 1);

  /* =================================================================
     BAGIAN A — PUBLIK: PENDAFTARAN SEKOLAH MANDIRI
     ================================================================= */
  post('/api/daftar', async (req, res) => {
    const b = await readBody(req);
    const platform = saas.branding();
    if (!platform.pendaftaran_aktif) return fail(res, 403, 'Pendaftaran sekolah baru sedang ditutup. Hubungi layanan dukungan.');
    if (platform.maintenance) return fail(res, 503, platform.maintenance_pesan || 'Sistem sedang dalam pemeliharaan.');

    /* ---------- PROTEKSI ANTI-SPAM / BOT ----------
       1. honeypot: kolom tersembunyi yang tidak pernah diisi manusia
       2. waktu pengisian minimal (form dikirim terlalu cepat = bot)
       3. pembatasan laju per IP (per jam & per hari)
       4. reCAPTCHA (bila Site/Secret key diatur Super Admin) */
    const ip = ipOf(req);
    const honeypot = String(b.website || b.url_situs || b.hp_konfirmasi || '').trim();
    if (honeypot) {
      saas.logAudit('Sistem', 'DAFTAR DITOLAK', 'anti-spam', `Honeypot terisi dari ${ip}`, ip);
      return fail(res, 400, 'Pendaftaran ditolak karena aktivitas otomatis terdeteksi.');
    }
    const minDetik = Math.max(0, Number(platform.daftar_min_detik) || 0);
    const t0 = Number(b.t0 || 0);
    if (!t0 || !Number.isFinite(t0)) {
      return fail(res, 400, 'Sesi formulir tidak valid. Muat ulang halaman pendaftaran lalu coba lagi.');
    }
    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed < minDetik) {
      return fail(res, 429, `Formulir terkirim terlalu cepat. Tunggu sekitar ${Math.ceil(minDetik - elapsed)} detik lagi.`);
    }
    if (elapsed > 6 * 3600) {
      return fail(res, 400, 'Sesi formulir sudah kedaluwarsa. Muat ulang halaman lalu isi kembali.');
    }
    const nowT = Date.now();
    const hits = (daftarHits.get(ip) || []).filter(t => nowT - t < 24 * 3600 * 1000);
    const perJam = hits.filter(t => nowT - t < 3600 * 1000).length;
    if (perJam >= platform.daftar_limit_jam || hits.length >= platform.daftar_limit_hari) {
      saas.logAudit('Sistem', 'DAFTAR DIBATASI', 'anti-spam',
        `Batas pendaftaran per IP terlampaui (${perJam}/jam, ${hits.length}/hari) dari ${ip}`, ip);
      return fail(res, 429, 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti atau hubungi layanan dukungan.');
    }
    if (platform.recaptcha_site && saas.setting('recaptcha_secret')) {
      const token = String(b.captcha_token || b['g-recaptcha-response'] || '').trim();
      if (!token) return fail(res, 400, 'Verifikasi keamanan (reCAPTCHA) belum diselesaikan.');
      try {
        const body = new URLSearchParams({ secret: saas.setting('recaptcha_secret'), response: token, remoteip: ip });
        const rv = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body });
        const out = await rv.json();
        if (!out || !out.success) {
          saas.logAudit('Sistem', 'DAFTAR DITOLAK', 'anti-spam', `reCAPTCHA gagal dari ${ip}`, ip);
          return fail(res, 400, 'Verifikasi keamanan (reCAPTCHA) gagal. Silakan coba lagi.');
        }
      } catch (e) {
        return fail(res, 503, 'Verifikasi keamanan tidak dapat dihubungi. Coba beberapa saat lagi.');
      }
    }
    hits.push(nowT);
    daftarHits.set(ip, hits);

    const nama = String(b.nama_sekolah || b.nama || '').trim();
    const jenjang = String(b.jenjang || 'SMK').toUpperCase();
    const alamat = String(b.alamat || '').trim();
    const kepala = String(b.kepala || b.nama_kepala || '').trim();
    const adminNama = String(b.admin_nama || '').trim();
    const email = String(b.email || b.email_admin || '').trim().toLowerCase();
    const password = String(b.password || '');
    const password2 = String(b.password2 || b.ulangi_password || '');
    const telp = String(b.telp || b.whatsapp || b.no_wa || '').trim();
    const trial = b.trial === undefined ? true : bool(b.trial);

    const errs = [];
    if (nama.length < 3) errs.push('Nama sekolah minimal 3 karakter');
    if (!dbm.JENJANG.includes(jenjang)) errs.push('Jenjang pendidikan tidak dikenal');
    if (!alamat) errs.push('Alamat sekolah wajib diisi');
    if (adminNama.length < 3) errs.push('Nama admin minimal 3 karakter');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('Email admin tidak valid');
    if (password.length < 6) errs.push('Kata sandi minimal 6 karakter');
    if (password !== password2) errs.push('Ulangi kata sandi tidak sama');
    const phone = lib.normPhone(telp);
    if (!phone) errs.push('Nomor WhatsApp tidak valid (contoh 0812xxxxxxx)');
    if (!errs.length) {
      const kembar = saas.sdb.prepare('SELECT 1 FROM tenants WHERE lower(nama)=lower(?)').get(nama);
      if (kembar) errs.push('Nama sekolah ini sudah terdaftar — hubungi admin bila merasa keliru');
    }
    if (errs.length) return fail(res, 400, errs.join(' • '));

    const paketDefault = saas.sdb.prepare('SELECT * FROM saas_paket WHERE kode=?').get(saas.setting('paket_default', 'basic'))
      || saas.sdb.prepare('SELECT * FROM saas_paket WHERE aktif=1 ORDER BY urutan LIMIT 1').get();
    const adminUser = email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 20) || 'admin';
    let hasil;
    try {
      hasil = saas.createTenant({
        nama, jenjang, alamat, kepala, kontak_nama: adminNama, telp: phone, email_admin: email,
        admin_nama: adminNama, admin_username: adminUser, admin_password: password,
        paket: paketDefault ? paketDefault.kode : 'basic',
        /* pendaftaran mandiri selalu memakai masa uji coba platform (default 7 hari) */
        trial_hari: trial ? (Number(platform.trial_hari) || 7) : 0,
        oleh: adminNama + ' (pendaftaran mandiri)',
        catatan: 'Pendaftaran mandiri melalui halaman login'
      });
    } catch (e) {
      return fail(res, 400, e.message);
    }
    /* terapkan menu default platform + nonaktifkan akun contoh bawaan (keamanan) */
    saas.applyMenuDefault(hasil.tenant.id);
    try {
      dbm.useTenant(saas.absDb(hasil.tenant), () => {
        db.prepare("UPDATE users SET aktif=0 WHERE role<>'admin'").run();
      });
    } catch (e) { /* abaikan */ }

    /* masuk otomatis ke dashboard sekolah */
    let user = null;
    dbm.useTenant(saas.absDb(hasil.tenant), () => {
      user = dbm.userByUsername(adminUser);
    });
    const tenantRow = saas.tenantById(hasil.tenant.id);
    const tenantInfo = saas.decorateTenant(tenantRow);   /* paket_nama, status_label, portal_slug/path, fitur */
    if (user) apiCtx.createSession(res, user, req, tenantRow);
    saas.logAudit(adminNama, 'DAFTAR MANDIRI', 'sekolah',
      `${nama} (${hasil.tenant.kode}) mendaftar${trial ? ' — uji coba' : ''}`, ipOf(req));
    saas.waSend(phone, `Pendaftaran ${nama} berhasil. Kode sekolah: ${hasil.tenant.kode}. ` +
      `Masa aktif: ${hasil.tenant.aktif_sampai || 'Lifetime'}. Simpan kode ini untuk masuk kembali.`, { tenantId: tenantRow.id, jenis: 'pendaftaran' });

    /* ---------- PRATINJAU HASIL PENDAFTARAN ----------
       Halaman pendaftaran TIDAK langsung melempar pendaftar ke dashboard:
       semua yang baru dibuat ditampilkan dulu (identitas sekolah, kode sekolah,
       akun admin, isi bawaan) lalu pendaftar menekan tombol sendiri. */
    const fitur = tenantInfo.fitur;                       /* null = semua modul */
    const semuaFitur = !fitur || (Array.isArray(fitur) && fitur.includes('*'));
    let kelasBawaan = [], jumlahKategori = 0, jumlahSiswa = 0, taNama = '', menuSiap = [];
    try {
      dbm.useTenant(saas.absDb(tenantRow), () => {
        kelasBawaan = db.prepare('SELECT nama FROM kelas ORDER BY urut, id').all().map(r => r.nama);
        jumlahKategori = db.prepare('SELECT COUNT(*) c FROM kategori').get().c;
        jumlahSiswa = db.prepare('SELECT COUNT(*) c FROM siswa').get().c;
        const ta = dbm.tahunAktif();
        taNama = ta ? ta.nama : '';
        menuSiap = dbm.navConfig()
          .filter(n => !n.hidden && (semuaFitur || fitur.includes(n.key)))
          .map(n => n.label);
      });
    } catch (e) { /* pratinjau tetap ditampilkan walau pembacaan rincian gagal */ }

    json(res, 200, {
      ok: true, kode: hasil.tenant.kode, nama: hasil.tenant.nama,
      admin_username: adminUser, admin_nama: adminNama, trial: !!trial,
      aktif_sampai: hasil.tenant.aktif_sampai, auto_login: !!user,
      status_label: tenantInfo.status_label, paket: tenantInfo.paket, paket_nama: tenantInfo.paket_nama,
      /* identitas sekolah persis seperti yang tersimpan di database sekolah baru */
      sekolah: {
        nama: tenantInfo.nama,
        jenjang: tenantInfo.jenjang,
        jenjang_label: dbm.JENJANG_LABEL[tenantInfo.jenjang] || tenantInfo.jenjang,
        alamat: tenantInfo.alamat,
        kepala: tenantInfo.kepala,
        telp: tenantInfo.telp,
        email: tenantInfo.email_admin,
        terdaftar: tenantInfo.created_at
      },
      portal: { slug: tenantInfo.portal_slug, path: tenantInfo.portal_path },
      tahun_ajaran: taNama,
      ringkasan: {
        kelas: kelasBawaan, jumlah_kelas: kelasBawaan.length,
        jumlah_kategori: jumlahKategori, jumlah_siswa: jumlahSiswa,
        jumlah_menu: menuSiap.length, menu: menuSiap
      },
      pesan: `Selamat! Sekolah ${nama} berhasil terdaftar dengan kode ${hasil.tenant.kode}.`
    });
  });

  /* =================================================================
     BAGIAN B — PANEL SEKOLAH: INFO & LAYANAN, PERPANJANGAN, DOMAIN,
                     TIKET, PANDUAN, LEGAL
     ================================================================= */
  get('/api/langganan', (req, res) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    if (!t) return fail(res, 404, 'Data sekolah tidak ditemukan.');
    const r = saas.ringkasanTenant(t.id);
    json(res, 200, {
      ok: true, ...r,
      sekolah: { kode: t.kode, nama: t.nama, jenjang: t.jenjang },
      tagihan_list: saas.tagihanList({ tenant_id: t.id }).slice(0, 12),
      promo_aktif: saas.promos().filter(p => Number(p.persen) > 0),
      pay: saas.payConfig(appBaseUrl(req)),
      legal: { tos_judul: saas.setting('tos_judul'), sla_judul: saas.setting('sla_judul') }
    });
  });

  /* ---------- status pembayaran gateway (polling dari halaman perpanjangan) ---------- */
  get('/api/langganan/gateway/status', async (req, res, q) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    const order = String((q && q.order) || '').trim();
    if (!order) return fail(res, 400, 'Nomor order wajib diisi.');
    const row = saas.gatewayRow(order);
    if (!row || Number(row.tenant_id) !== Number(t.id)) return fail(res, 404, 'Transaksi tidak ditemukan.');
    try {
      const r = await saas.gatewaySync(order);
      return json(res, 200, {
        ok: true, status: r.status, paid: !!r.paid,
        gateway_status: r.gateway_status || '', error: r.error || '',
        pembayaran: r.pembayaran
      });
    } catch (e) { return fail(res, 400, e.message); }
  });

  /* ---------- SIMULASI pelunasan (hanya untuk provider sandbox) ---------- */
  post('/api/langganan/gateway/simulasi', async (req, res) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    const b = await readBody(req);
    const cfg = saas.gatewayCfg();
    if (cfg.provider !== 'sandbox') return fail(res, 400, 'Simulasi hanya tersedia pada provider "sandbox".');
    const row = saas.gatewayRow(String(b.order || ''));
    if (!row || Number(row.tenant_id) !== Number(t.id)) return fail(res, 404, 'Transaksi tidak ditemukan.');
    try {
      const r = saas.gatewayMarkPaid(row.order_id, 'Simulasi Gateway');
      return json(res, 200, { ok: true, paid: true, pembayaran: r.pembayaran, pesan: 'Pembayaran simulasi berhasil diverifikasi & masa aktif diperpanjang.' });
    } catch (e) { return fail(res, 400, e.message); }
  });

  /* ---------- CALLBACK payment gateway (publik, diverifikasi signature) ---------- */
  post('/api/pay/callback', async (req, res) => {
    const b = await readBody(req);
    const cfg = saas.gatewayCfg();
    if (!saas.payment.verifyCallback(cfg, b, req.headers || {})) {
      return fail(res, 401, 'Signature callback tidak valid.');
    }
    const parsed = saas.payment.parseCallback(cfg, b);
    if (!parsed.order_id) return fail(res, 400, 'order_id tidak ditemukan pada callback.');
    const row = saas.gatewayRow(parsed.order_id);
    if (!row) return fail(res, 404, 'Transaksi tidak ditemukan.');
    if (!parsed.paid) {
      saas.db.prepare('UPDATE saas_pembayaran SET gateway_status=? WHERE id=?').run(parsed.status || 'PENDING', row.id);
      return json(res, 200, { ok: true, paid: false });
    }
    try {
      const r = saas.gatewayMarkPaid(parsed.order_id, 'Payment Gateway');
      return json(res, 200, { ok: true, paid: true, sudah: r.sudah });
    } catch (e) { return fail(res, 400, e.message); }
  }, SAAS);

  /* ---------- WEBHOOK KASERA PAY (publik, tanpa sesi, bertanda tangan) ----------
     POST /api/webhook/kasera
       header : kasera-signature-v1 = HMAC-SHA256(body mentah, WEBHOOK SECRET)
       event  : payment.paid → external_id → tagihan menjadi LUNAS
     Rute ini DIKECUALIKAN dari CSRF (dipanggil server Kasera, bukan browser)
     dan idempoten: event yang sama tidak diproses dua kali. */
  post('/api/webhook/kasera', async (req, res) => {
    const balas = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      const raw = await rawBodyOf(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
      const hasil = saas.kaseraHandleWebhook({ raw, body, headers: req.headers || {} });
      return balas(hasil.code, hasil.out);
    } catch (e) {
      console.error('[kasera] gagal memproses webhook:', e);
      return balas(500, { ok: false, error: 'Terjadi kesalahan saat memproses webhook: ' + e.message });
    }
  }, SAAS);

  post('/api/langganan/bayar', async (req, res) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    const b = await readBody(req);
    if (Number(t.lifetime) === 1) return fail(res, 400, 'Sekolah Anda sudah berstatus Lifetime — tidak perlu perpanjangan.');
    const paket = String(b.paket || t.paket || '');
    const bulan = mapBulan(b.bulan);

    /* ---------- metode QRIS OTOMATIS (payment gateway) ---------- */
    if (String(b.metode || '') === 'gateway') {
      try {
        const py = await saas.bayarGateway({
          tenant_id: t.id, paket, bulan, promo: b.promo, oleh_nama: user.nama, base_url: appBaseUrl(req)
        });
        return json(res, 200, {
          ok: true, mode: 'gateway', pembayaran: py,
          pesan: 'QRIS dinamis berhasil dibuat. Pindai lalu pembayaran terverifikasi otomatis.'
        });
      } catch (e) { return fail(res, 400, e.message); }
    }

    try {
      const py = saas.bayarManual({
        tenant_id: t.id, paket, bulan, promo: b.promo, metode: b.metode || 'qris',
        bukti_url: String(b.bukti_url || ''), catatan: b.catatan, oleh_nama: user.nama
      });
      json(res, 200, {
        ok: true, pembayaran: py,
        pesan: `Pengajuan pembayaran Rp ${Number(py.total).toLocaleString('id-ID')} terkirim. Menunggu verifikasi Super Admin.`
      });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* domain custom diatur sendiri oleh sekolah (menu Pengaturan) */
  get('/api/domain', (req, res) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    const platform = saas.branding();
    json(res, 200, {
      ok: true,
      domain: t.custom_domain || '', status: t.domain_status || '', cek_at: t.domain_cek_at || '',
      target_cname: platform.domain, contoh: `tata-tertib.${String(t.nama || 'sekolah').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}.sch.id`,
      subdomain_platform: `${String(t.slug || '').slice(0, 30)}.${platform.domain || ''}`.replace(/\.$/, ''),
      langkah: [
        'Buka panel DNS domain sekolah (Registrar / Cloudflare / penyedia hosting).',
        `Tambahkan record CNAME: nama bebas (mis. tertib) → target ${platform.domain || 'domain platform'}.`,
        'Bila penyedia hanya mendukung A Record, arahkan ke IP server platform (minta ke dukungan).',
        'Kembali ke halaman ini lalu tekan "Cek Domain" — propagasi DNS biasanya 5–30 menit.',
        'Hubungi dukungan melalui Pusat Bantuan bila domain belum aktif setelah 24 jam.'
      ]
    });
  });
  post('/api/domain', async (req, res) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    const b = await readBody(req);
    try {
      const t2 = saas.setTenantDomain(t.id, b.domain, user.nama);
      json(res, 200, { ok: true, domain: t2.custom_domain || '', pesan: 'Domain custom diperbarui. Jalankan "Cek Domain" untuk memastikan sudah mengarah ke platform.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/domain/cek', async (req, res) => {
    const user = guardTenant(req, res, 'langganan', 'view'); if (!user) return;
    const t = tenantOf(req);
    if (!t.custom_domain) return fail(res, 400, 'Atur domain custom terlebih dahulu.');
    try {
      const hasil = await saas.checkDomain(t.id, req.headers.host);
      json(res, 200, { ok: true, ...hasil });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* ---------- Pusat Bantuan / Tiket (dua arah) ---------- */
  get('/api/tiket', (req, res, q) => {
    const user = guardTenant(req, res, 'tiket', 'view'); if (!user) return;
    const t = tenantOf(req);
    const rows = saas.tiketList({ tenant_id: t.id }).map(k => ({
      ...k, pesan: saas.sdb.prepare('SELECT * FROM saas_tiket_pesan WHERE tiket_id=? ORDER BY id').all(k.id)
    }));
    json(res, 200, {
      ok: true, rows, status_list: saas.TIKET_STATUS, kategori: saas.TIKET_KATEGORI,
      petunjuk: saas.panduanList('sekolah').filter(p => Number(p.aktif) === 1)
    });
  });
  post('/api/tiket', async (req, res) => {
    const user = guardTenant(req, res, 'tiket', 'view'); if (!user) return;
    const t = tenantOf(req);
    const b = await readBody(req);
    try {
      const k = saas.tiketBuat({
        tenant_id: t.id, judul: b.judul, kategori: b.kategori, prioritas: b.prioritas,
        pesan: b.pesan, oleh: `${user.nama} (${t.nama})`
      });
      json(res, 200, { ok: true, tiket: k, pesan: `Tiket #${k.id} terkirim. Tim dukungan akan membalas maksimal 1×24 jam kerja.` });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/tiket/balas', async (req, res) => {
    const user = guardTenant(req, res, 'tiket', 'view'); if (!user) return;
    const t = tenantOf(req);
    const b = await readBody(req);
    const k = saas.sdb.prepare('SELECT * FROM saas_tiket WHERE id=?').get(Number(b.id));
    if (!k || Number(k.tenant_id) !== Number(t.id)) return fail(res, 404, 'Tiket tidak ditemukan.');
    try {
      const hasil = saas.tiketBalas(k.id, { dari: 'tenant', oleh: `${user.nama} (${t.nama})`, pesan: b.pesan });
      json(res, 200, { ok: true, tiket: hasil, pesan: 'Balasan terkirim ke tim dukungan.' });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* ---------- Petunjuk & Legal ---------- */
  get('/api/panduan', (req, res) => {
    const user = guardTenant(req, res, 'panduan', 'view'); if (!user) return;
    const rows = saas.panduanList('sekolah').filter(p => Number(p.aktif) === 1)
      .map(p => ({ ...p, embed: p.tipe === 'youtube' ? saas.youtubeId(p.url) : '' }));
    json(res, 200, { ok: true, rows, super_rows: saas.panduanList('super').filter(p => Number(p.aktif) === 1) });
  });
  get('/api/legal', (req, res) => {
    const user = guardTenant(req, res, 'legal', 'view'); if (!user) return;
    json(res, 200, {
      ok: true,
      tos_judul: saas.setting('tos_judul'), tos_isi: saas.setting('tos_isi'),
      sla_judul: saas.setting('sla_judul'), sla_isi: saas.setting('sla_isi'),
      diperbarui: saas.setting('legal_updated'), kontak: saas.setting('rek_nama') || ''
    });
  });

  /* =================================================================
     BAGIAN C — PANEL SUPER ADMIN
     ================================================================= */
  /* ---------- dashboard ---------- */
  get('/api/super/dashboard', (req, res) => {
    if (!guardSuper(req, res)) return;
    const stats = saas.tenantStats();
    const tenants = saas.tenants();
    const totalSiswa = tenants.reduce((a, t) => a + saas.tenantSiswaCount(t), 0);
    json(res, 200, {
      ok: true, stats: { ...stats, siswa: totalSiswa },
      terbaru: tenants.slice(-5).reverse(),
      pembayaran: saas.pembayaranList({ status: 'menunggu' }).slice(0, 5),
      tiket: saas.tiketList({ status: 'baru' }).slice(0, 5),
      audit: saas.auditList({ limit: 8 }).rows,
      cron: { terakhir: saas.setting('cron_terakhir'), hasil: (() => { try { return JSON.parse(saas.setting('cron_hasil', '{}')); } catch (e) { return {}; } })() },
      paket: saas.paketList({ aktifOnly: true }),
      pengumuman: saas.pengumumanList({ aktifOnly: true }).slice(0, 3)
    });
  });

  /* ---------- daftar sekolah ---------- */
  get('/api/super/sekolah', (req, res, q) => {
    if (!guardSuper(req, res)) return;
    const rows = saas.tenants({ q: q.q, status: q.status, paket: q.paket });
    json(res, 200, {
      ok: true, rows, stats: saas.tenantStats(), paket: saas.paketList(),
      jenjang: dbm.JENJANG.map(j => ({ key: j, label: dbm.JENJANG_LABEL[j] || j })),
      fitur_all: dbm.FEATURES.map(f => ({ key: f.key, label: f.label, grup: f.grup }))
    });
  });
  get('/api/super/sekolah/:id', (req, res, q, params) => {
    if (!guardSuper(req, res)) return;
    const t = saas.tenantById(params.id);
    if (!t) return fail(res, 404, 'Sekolah tidak ditemukan.');
    const detail = saas.decorateTenant(t);
    /* akun admin sekolah (dibaca dari DB sekolah) */
    let admins = [], jumlah = { siswa: 0, kelas: 0, kejadian: 0 };
    try {
      dbm.useTenant(saas.absDb(t), () => {
        admins = db.prepare("SELECT id,nama,username,jabatan,aktif,created_at FROM users WHERE role='admin' ORDER BY id").all();
        jumlah = {
          siswa: db.prepare('SELECT COUNT(*) c FROM siswa').get().c,
          kelas: db.prepare('SELECT COUNT(*) c FROM kelas').get().c,
          kejadian: db.prepare('SELECT COUNT(*) c FROM kejadian').get().c,
          pengguna: db.prepare('SELECT COUNT(*) c FROM users').get().c
        };
      });
    } catch (e) { /* DB sekolah tidak terbaca */ }
    json(res, 200, {
      ok: true, tenant: detail, admins, jumlah,
      paket: saas.paketList(),
      paket_aktif: saas.paketByKode(t.paket),
      /* harga efektif (override per sekolah) & harga dasar paket */
      harga_bulanan: saas.hargaTenant(t, 1),
      harga_tahunan: saas.hargaTenant(t, 12),
      harga_paket_bulanan: saas.hargaPaket(t.paket, 1),
      harga_paket_tahunan: saas.hargaPaket(t.paket, 12),
      tagihan: saas.tagihanList({ tenant_id: t.id }),
      pembayaran: saas.pembayaranList({}).filter(p => Number(p.tenant_id) === Number(t.id)).slice(0, 10),
      tiket: saas.tiketList({ tenant_id: t.id }).slice(0, 5),
      fitur_all: dbm.FEATURES.map(f => ({ key: f.key, label: f.label, grup: f.grup })),
      domain_log: saas.sdb.prepare('SELECT * FROM saas_domain_log WHERE tenant_id=? ORDER BY id DESC LIMIT 10').all(t.id),
      platform: saas.branding(),
      wa: saas.waLogList({}).filter(w => Number(w.tenant_id) === Number(t.id)).slice(0, 8)
    });
  });
  post('/api/super/sekolah/simpan', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      if (b.id) {
        const t = saas.updateTenant(b.id, b, adminName(req));
        if (b.menu_default) saas.applyMenuDefault(t.id);
        return json(res, 200, { ok: true, tenant: t, pesan: 'Data sekolah diperbarui.' });
      }
      const hasil = saas.createTenant({
        nama: b.nama, jenjang: b.jenjang, alamat: b.alamat, kepala: b.kepala,
        kontak_nama: b.kontak_nama, telp: b.telp, email_admin: b.email_admin,
        admin_nama: b.admin_nama || b.kontak_nama, admin_username: b.admin_username,
        admin_password: b.admin_password, paket: b.paket, trial_hari: b.trial_hari,
        lifetime: bool(b.lifetime), aktif_sampai: b.aktif_sampai, oleh: adminName(req),
        catatan: b.catatan
      });
      saas.applyMenuDefault(hasil.tenant.id);
      json(res, 200, {
        ok: true, tenant: hasil.tenant,
        kredensial: { username: hasil.admin_username, password: hasil.admin_password },
        pesan: `Sekolah ${hasil.tenant.nama} dibuat dengan kode ${hasil.tenant.kode}.`
      });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/status', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const t = saas.setTenantStatus(b.id, b.status, adminName(req));
      if (b.status === 'ditangguhkan') saas.sessionHapusTenant(b.id);
      json(res, 200, { ok: true, tenant: t, pesan: b.status === 'ditangguhkan' ? 'Sekolah ditangguhkan.' : 'Sekolah diaktifkan.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/lifetime', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const t = saas.updateTenant(b.id, { lifetime: bool(b.lifetime) }, adminName(req));
      json(res, 200, { ok: true, tenant: t, pesan: t.lifetime ? 'Akses Lifetime diaktifkan (tanpa masa aktif).' : 'Status Lifetime dimatikan — atur paket & masa aktif.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/fitur', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const list = Array.isArray(b.fitur) ? b.fitur.map(String) : [];
      const t = saas.updateTenant(b.id, { fitur_override: list.length ? list : '' }, adminName(req));
      json(res, 200, { ok: true, tenant: t, pesan: list.length ? 'Kontrol fitur khusus disimpan.' : 'Kontrol fitur kembali mengikuti paket.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/password', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const hasil = saas.setTenantPassword(b.id, b.password, adminName(req));
      json(res, 200, { ok: true, ...hasil, pesan: `Kata sandi admin ${hasil.username} direset.` });
    } catch (e) { fail(res, 400, e.message); }
  });
  get('/api/super/sekolah/:id/password-acak', (req, res, q, params) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, { ok: true, password: saas.randomPassword(num(q.panjang, 12)) });
  });
  post('/api/super/sekolah/impersonate', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const t = saas.tenantById(b.id);
      if (!t) return fail(res, 404, 'Sekolah tidak ditemukan.');
      const uid = saas.impersonateUserId(t.id);
      const user = dbm.useTenant(saas.absDb(t), () => dbm.userById(uid));
      if (!user) return fail(res, 400, 'Akun admin sekolah tidak ditemukan.');
      apiCtx.createSession(res, user, req, t);
      saas.logAudit(adminName(req), 'LOGIN AS TENANT', 'sekolah', `Masuk sebagai admin ${t.nama} (${t.kode})`, ipOf(req));
      json(res, 200, { ok: true, pesan: `Masuk sebagai admin ${t.nama}.` });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/perpanjang', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const t = saas.perpanjang(b.id, b.bulan, adminName(req), b.catatan);
      json(res, 200, { ok: true, tenant: t, pesan: `Masa aktif diperpanjang sampai ${t.aktif_sampai}.` });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/domain', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const t = saas.setTenantDomain(b.id, b.domain, adminName(req));
      json(res, 200, { ok: true, tenant: t, pesan: 'Domain custom disimpan.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/domain/cek', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const hasil = await saas.checkDomain(b.id, req.headers.host);
      json(res, 200, { ok: true, ...hasil });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/hapus', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      saas.deleteTenant(b.id, adminName(req));
      saas.sessionHapusTenant(b.id);
      json(res, 200, { ok: true, pesan: 'Sekolah dinonaktifkan (data tetap tersimpan).' });
    } catch (e) { fail(res, 400, e.message); }
  });
  /* hapus permanen: baris tenant + berkas database sekolah (tidak dapat dibatalkan) */
  post('/api/super/sekolah/hapus-permanen', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    if (String(b.konfirmasi || '').trim().toUpperCase() !== 'HAPUS') {
      return fail(res, 400, 'Ketik kata HAPUS untuk mengonfirmasi penghapusan permanen.');
    }
    try {
      const r = saas.hapusPermanen(b.id, adminName(req));
      json(res, 200, { ok: true, ...r, pesan: `Sekolah ${r.nama} (${r.kode}) dihapus permanen. Berkas database ${r.berkas}.` });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/sekolah/wa', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const t = saas.tenantById(b.id);
    if (!t) return fail(res, 404, 'Sekolah tidak ditemukan.');
    const pesan = String(b.pesan || '').trim();
    if (!pesan) return fail(res, 400, 'Isi pesan wajib diisi.');
    const r = await saas.waSend(t.telp, pesan.split('{sekolah}').join(t.nama), { tenantId: t.id, jenis: 'manual' });
    if (!r.ok) return fail(res, 400, r.error || 'Gagal mengirim WhatsApp.');
    json(res, 200, { ok: true, pesan: 'Pesan WhatsApp dikirim.' });
  });

  /* ---------- pembayaran & tagihan ---------- */
  get('/api/super/pembayaran', (req, res, q) => {
    if (!guardSuper(req, res)) return;
    const rows = saas.pembayaranList({ status: q.status || 'semua' });
    json(res, 200, {
      ok: true, rows,
      ringkas: {
        menunggu: rows.filter(r => r.status === 'menunggu').length,
        disetujui: rows.filter(r => r.status === 'disetujui').length,
        ditolak: rows.filter(r => r.status === 'ditolak').length,
        total: rows.length,
        nominal_lunas: rows.filter(r => r.status === 'disetujui').reduce((a, r) => a + num(r.total), 0)
      },
      tagihan: saas.tagihanList({ status: 'menunggu' }),
      tenants: saas.tenants().map(t => ({ id: t.id, kode: t.kode, nama: t.nama, paket: t.paket, aktif_sampai: t.aktif_sampai })),
      cron: { terakhir: saas.setting('cron_terakhir'), hasil: (() => { try { return JSON.parse(saas.setting('cron_hasil', '{}')); } catch (e) { return {}; } })() },
      qris: { img: saas.setting('qris_img'), nama: saas.setting('rek_nama'), nomor: saas.setting('rek_nomor') }
    });
  });
  post('/api/super/pembayaran/verifikasi', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const py = saas.verifikasiPembayaran(b.id, b.aksi === 'tolak' ? 'tolak' : 'setuju', adminName(req), b.catatan);
      json(res, 200, { ok: true, pembayaran: py, pesan: b.aksi === 'tolak' ? 'Pembayaran ditolak.' : 'Pembayaran disetujui & masa aktif diperpanjang.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/cron', (req, res) => {
    if (!guardSuper(req, res)) return;
    const hasil = saas.runBillingCheck({ oleh: adminName(req) });
    json(res, 200, {
      ok: true, hasil,
      pesan: `Pemeriksaan selesai: ${hasil.dibuat} tagihan baru, ${hasil.notif} notifikasi, ${hasil.ditangguhkan} sekolah ditangguhkan.`
    });
  });
  post('/api/super/tagihan/buat', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const t = saas.tenantById(b.id);
    if (!t) return fail(res, 404, 'Sekolah tidak ditemukan.');
    const tag = saas.ensureTagihan(t, { periode: b.periode, bulan: mapBulan(b.bulan), jatuh_tempo: b.jatuh_tempo });
    if (!tag) return fail(res, 400, 'Sekolah Lifetime tidak memerlukan tagihan.');
    saas.logAudit(adminName(req), 'BUAT TAGIHAN', 'penagihan', `${t.nama} periode ${tag.periode}`);
    json(res, 200, { ok: true, tagihan: tag, pesan: `Tagihan periode ${tag.periode} siap.` });
  });

  /* ---------- paket langganan ---------- */
  get('/api/super/paket', (req, res) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, { ok: true, rows: saas.paketList(), fitur_all: dbm.FEATURES.map(f => ({ key: f.key, label: f.label, grup: f.grup })) });
  });
  post('/api/super/paket', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const p = saas.savePaket(b);
      saas.logAudit(adminName(req), p.created ? 'TAMBAH PAKET' : 'UBAH PAKET', 'paket', `${p.nama} (${p.kode})`);
      json(res, 200, { ok: true, paket: p, pesan: `Paket ${p.nama} disimpan.` });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/paket/hapus', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      saas.deletePaket(b.kode);
      saas.logAudit(adminName(req), 'HAPUS PAKET', 'paket', b.kode);
      json(res, 200, { ok: true, pesan: 'Paket dihapus.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/paket/toggle', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const p = saas.paketByKode(b.kode);
    if (!p) return fail(res, 404, 'Paket tidak ditemukan.');
    const next = saas.savePaket({ ...p, aktif: !p.aktif, fitur: p.fitur });
    json(res, 200, { ok: true, paket: next, pesan: `Paket ${next.nama} ${Number(next.aktif) ? 'diaktifkan' : 'dinonaktifkan'}.` });
  });

  /* ---------- menu default ---------- */
  get('/api/super/menu-default', (req, res) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, {
      ok: true, rows: saas.menuDefault(),
      fitur_all: dbm.FEATURES.map(f => ({ key: f.key, label: f.label, grup: f.grup })),
      nav_bawaan: dbm.DEFAULT_NAV
    });
  });
  post('/api/super/menu-default', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const list = saas.saveMenuDefault(b.rows);
    saas.logAudit(adminName(req), 'UBAH MENU DEFAULT', 'menu', `${list.length} menu`);
    let terpasang = 0;
    if (bool(b.terapkan)) {
      for (const t of saas.tenants()) { if (saas.applyMenuDefault(t.id)) terpasang++; }
    }
    json(res, 200, { ok: true, rows: list, pesan: `Menu default disimpan${terpasang ? ` & diterapkan ke ${terpasang} sekolah` : ''}.` });
  });

  /* ---------- branding sistem ---------- */
  get('/api/super/branding', (req, res) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, { ok: true, s: settingsForClient(), paket: saas.paketList({ aktifOnly: true }), platform: saas.branding() });
  });
  post('/api/super/branding', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    /* ---- validasi dulu, simpan kemudian (tidak ada penyimpanan separuh) ---- */
    const txt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
    if (b.app_nama !== undefined && txt(b.app_nama, 80).length < 2) return fail(res, 400, 'Nama aplikasi minimal 2 karakter.');
    if (b.daftar_min_detik !== undefined) {
      const n = num(b.daftar_min_detik, 4);
      if (n < 0 || n > 120) return fail(res, 400, 'Waktu minimal pengisian form harus 0–120 detik.');
    }
    if (b.daftar_limit_jam !== undefined && (num(b.daftar_limit_jam, 5) < 1 || num(b.daftar_limit_jam, 5) > 100)) {
      return fail(res, 400, 'Batas pendaftaran per jam harus 1–100.');
    }
    if (b.daftar_limit_hari !== undefined && (num(b.daftar_limit_hari, 20) < 1 || num(b.daftar_limit_hari, 20) > 500)) {
      return fail(res, 400, 'Batas pendaftaran per hari harus 1–500.');
    }
    if (b.recaptcha_site !== undefined && String(b.recaptcha_site).trim() && !/^[A-Za-z0-9_-]{10,120}$/.test(String(b.recaptcha_site).trim())) {
      return fail(res, 400, 'Site key reCAPTCHA tidak valid.');
    }

    const keys = ['app_nama', 'app_subtitle', 'logo', 'favicon', 'trial_hari', 'paket_default',
      'domain_info', 'subdomain_info', 'server_info',
      /* tampilan halaman login & anti-spam */
      'login_judul', 'login_subjudul', 'login_deskripsi', 'login_footer', 'login_copyright',
      'login_logo', 'recaptcha_site', 'recaptcha_secret'];
    for (const k of keys) if (b[k] !== undefined) saas.setSetting(k, b[k]);
    /* ---- SAKELAR BOOLEAN: selalu disimpan '1'/'0' ----
       Dulu nilai boolean dari formulir (true/false) disimpan apa adanya menjadi
       string "true"/"false", sedangkan pembacanya hanya mengenali '1' → pilihan
       "Dibuka" selalu kembali menjadi "Ditutup" setelah disimpan. */
    if (b.pendaftaran_aktif !== undefined) {
      saas.setSetting('pendaftaran_aktif', bool(b.pendaftaran_aktif) ? '1' : '0');
    }
    if (b.trial_hari !== undefined) saas.setSetting('trial_hari', String(Math.max(0, Math.min(365, num(b.trial_hari, 7)))));
    if (b.daftar_min_detik !== undefined) saas.setSetting('daftar_min_detik', String(Math.round(num(b.daftar_min_detik, 4))));
    if (b.daftar_limit_jam !== undefined) saas.setSetting('daftar_limit_jam', String(Math.round(num(b.daftar_limit_jam, 5))));
    if (b.daftar_limit_hari !== undefined) saas.setSetting('daftar_limit_hari', String(Math.round(num(b.daftar_limit_hari, 20))));
    /* versi branding baru → favicon/judul tab di semua perangkat ikut diperbarui */
    const ver = saas.bumpBranding();
    saas.logAudit(adminName(req), 'UBAH BRANDING', 'branding',
      `Pengaturan branding sistem (versi ${ver})`, ipOf(req));
    json(res, 200, { ok: true, platform: saas.branding(), version: ver, pesan: 'Branding sistem disimpan & disebarkan ke semua perangkat.' });
  });

  /* ---------- profil akun Super Admin yang sedang masuk ---------- */
  get('/api/super/profil', (req, res) => {
    const me = guardSuper(req, res);
    if (!me) return;
    const admins = saas.sdb.prepare('SELECT id,nama,username,email,aktif,terakhir_masuk,created_at FROM saas_admins ORDER BY id').all();
    json(res, 200, {
      ok: true,
      user: { id: me.id, nama: me.nama, username: me.username, email: me.email || '', terakhir_masuk: me.terakhir_masuk || '' },
      admins: admins.length, jumlah_admin: admins.length
    });
  });
  post('/api/super/profil', async (req, res) => {
    const me = guardSuper(req, res);
    if (!me) return;
    const b = await readBody(req);
    try {
      const r = saas.adminUpdateSelf(me.id, b);
      saas.logAudit(r.nama, 'UBAH PROFIL', 'auth',
        `Profil Super Admin diperbarui (username ${r.username}${r.password_diubah ? ', kata sandi diubah' : ''})`, ipOf(req));
      json(res, 200, {
        ok: true, user: { id: r.id, nama: r.nama, username: r.username, email: r.email },
        pesan: r.password_diubah ? 'Profil & kata sandi Super Admin diperbarui.' : 'Profil Super Admin diperbarui.'
      });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* ---------- login khusus Super Admin (portal terpisah) ---------- */
  post('/api/super/login', async (req, res) => {
    const b = await readBody(req);
    /* Mode pemeliharaan TIDAK memblokir Super Admin — panel platform harus tetap
       bisa diakses untuk mematikan/mengatur pemeliharaan. */
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const ip = ipOf(req);
    const nowT = Date.now();
    const arr = (superHits.get(ip) || []).filter(t => nowT - t < 300000);
    if (arr.length >= 10) return fail(res, 429, 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
    arr.push(nowT); superHits.set(ip, arr);
    const admin = saas.adminByUsername(username) || saas.adminByEmail(username);
    if (!admin || !admin.aktif || !lib.verifyPassword(password, admin.pass_hash)) {
      saas.logAudit(username || '-', 'LOGIN GAGAL', 'auth', 'Percobaan masuk panel Super Admin', ip);
      return fail(res, 401, 'Akun Super Admin tidak ditemukan atau kata sandi salah.');
    }
    superHits.delete(ip);
    saas.sdb.prepare('UPDATE saas_admins SET terakhir_masuk=? WHERE id=?').run(lib.nowStamp(), admin.id);
    apiCtx.createSuperSession(res, admin, req);
    saas.logAudit(admin.nama, 'LOGIN', 'auth', 'Masuk portal Super Admin', ip);
    json(res, 200, {
      ok: true, scope: 'super',
      user: { id: admin.id, nama: admin.nama, username: admin.username, role: 'super_admin', role_label: 'Super Admin' }
    });
  }, SAAS);

  /* ---------- QRIS & harga ---------- */
  get('/api/super/qris', (req, res) => {
    if (!guardSuper(req, res)) return;
    const pay = saas.payConfig(appBaseUrl(req));
    const cfg = saas.gatewayCfg();
    /* kredensial payment gateway TIDAK pernah dikirim balik ke klien */
    const RAHASIA = ['pay_gateway_key', 'pay_gateway_key2', 'pay_gateway_callback', 'telegram_bot_token'];
    const settingsAman = settingsForClient();
    RAHASIA.forEach(k => { if (k in settingsAman) settingsAman[k] = ''; });
    json(res, 200, {
      ok: true, s: settingsAman, promo: saas.promos(),
      paket: saas.paketList(), platform: saas.branding(),
      pay: {
        ...pay,
        /** kredensial TIDAK pernah dikirim balik — hanya penanda terisi */
        merchant_set: !!cfg.merchant, key_set: !!cfg.key, key2_set: !!cfg.key2,
        callback_set: !!cfg.callback, base_set: !!cfg.base,
        /** log webhook Kasera terakhir (8 baris) */
        events: (() => { try { return saas.kaseraEvents(8); } catch (e) { return []; } })()
      }
    });
  });
  post('/api/super/qris', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const keys = ['qris_img', 'rek_nama', 'rek_nomor', 'instruksi_bayar', 'harga_bulanan', 'harga_tahunan', 'layanan_nama'];
    for (const k of keys) if (b[k] !== undefined) saas.setSetting(k, b[k]);
    if (b.harga_bulanan !== undefined) saas.setSetting('harga_bulanan', String(money(b.harga_bulanan)));
    if (b.harga_tahunan !== undefined) saas.setSetting('harga_tahunan', String(money(b.harga_tahunan)));
    if (b.trial_hari !== undefined) saas.setSetting('trial_hari', String(Math.max(0, Math.min(365, num(b.trial_hari, 7)))));
    /* ---- metode pembayaran hybrid (sakelar QRIS otomatis / manual) ---- */
    if (b.pay) {
      const pay = b.pay;
      const provider = saas.payment.PROVIDER_KEYS.includes(String(pay.provider || '')) ? String(pay.provider) : 'sandbox';
      const mode = ['sandbox', 'production'].includes(String(pay.mode || '')) ? String(pay.mode) : 'sandbox';
      if (pay.gateway_aktif !== undefined) saas.setSetting('pay_gateway_aktif', bool(pay.gateway_aktif) ? '1' : '0');
      if (pay.manual_aktif !== undefined) saas.setSetting('pay_manual_aktif', bool(pay.manual_aktif) ? '1' : '0');
      saas.setSetting('pay_gateway_provider', provider);
      saas.setSetting('pay_gateway_mode', mode);
      saas.setSetting('pay_gateway_expire_menit', String(Math.max(5, Math.min(1440, num(pay.expire_menit, 60)))));
      if (pay.merchant !== undefined) saas.setSetting('pay_gateway_merchant', String(pay.merchant || '').trim());
      if (String(pay.key || '').trim()) saas.setSetting('pay_gateway_key', String(pay.key).trim());
      if (bool(pay.key_hapus)) saas.setSetting('pay_gateway_key', '');
      if (pay.key2 !== undefined) saas.setSetting('pay_gateway_key2', String(pay.key2 || '').trim());
      if (pay.callback !== undefined) saas.setSetting('pay_gateway_callback', String(pay.callback || '').trim());
      if (pay.base !== undefined) saas.setSetting('pay_gateway_base', String(pay.base || '').trim());
      /* Kasera Pay: pilihan API (auto/transactions/qris) */
      if (pay.kasera_api !== undefined) {
        const apiMode = ['auto', 'transactions', 'qris'].includes(String(pay.kasera_api))
          ? String(pay.kasera_api) : 'auto';
        saas.setSetting('pay_gateway_kasera_api', apiMode);
      }
      /* bila kedua metode dimatikan, paksa QRIS manual aktif agar sekolah tetap bisa membayar */
      if (saas.setting('pay_gateway_aktif') !== '1' && saas.setting('pay_manual_aktif') !== '1') {
        saas.setSetting('pay_manual_aktif', '1');
      }
    }
    if (Array.isArray(b.promo)) {
      const list = b.promo.map(p => ({
        kode: String(p.kode || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24),
        persen: Math.max(0, Math.min(100, num(p.persen))),
        catatan: String(p.catatan || '').slice(0, 80)
      })).filter(p => p.kode && p.persen > 0);
      saas.setSetting('promo_list', JSON.stringify(list.slice(0, 20)));
    }
    saas.logAudit(adminName(req), 'UBAH QRIS', 'qris', 'Pengaturan pembayaran & harga');
    json(res, 200, { ok: true, platform: saas.branding(), promo: saas.promos(), pesan: 'Pengaturan QRIS & harga disimpan.' });
  });

  /* ---------- legal (TOS & SLA) ---------- */
  get('/api/super/legal', (req, res) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, {
      ok: true,
      tos_judul: saas.setting('tos_judul'), tos_isi: saas.setting('tos_isi'),
      sla_judul: saas.setting('sla_judul'), sla_isi: saas.setting('sla_isi'),
      diperbarui: saas.setting('legal_updated')
    });
  });
  post('/api/super/legal', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    for (const k of ['tos_judul', 'tos_isi', 'sla_judul', 'sla_isi']) if (b[k] !== undefined) saas.setSetting(k, b[k]);
    saas.setSetting('legal_updated', lib.todayISO());
    saas.logAudit(adminName(req), 'UBAH LEGAL', 'legal', 'Syarat & Ketentuan / SLA diperbarui');
    json(res, 200, { ok: true, pesan: 'Dokumen legal diperbarui — otomatis tampil di menu Legal & SLA setiap sekolah.' });
  });

  /* ---------- tiket (sisi super admin) ---------- */
  get('/api/super/tiket', (req, res, q) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, {
      ok: true, rows: saas.tiketList({ status: q.status || 'semua' }),
      status_list: saas.TIKET_STATUS, kategori: saas.TIKET_KATEGORI
    });
  });
  get('/api/super/tiket/:id', (req, res, q, params) => {
    if (!guardSuper(req, res)) return;
    const t = saas.tiketDetail(params.id);
    if (!t) return fail(res, 404, 'Tiket tidak ditemukan.');
    json(res, 200, { ok: true, tiket: t });
  });
  post('/api/super/tiket/balas', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      const t = saas.tiketBalas(b.id, { dari: 'super', oleh: adminName(req), pesan: b.pesan, status: b.status });
      const tenant = saas.tenantById(t.tenant_id);
      if (tenant && b.kirim_wa !== false && b.pesan) {
        saas.waNotify(tenant.id, `Balasan tiket #${t.id} "${t.judul}": ${String(b.pesan).slice(0, 300)}`, 'tiket');
      }
      json(res, 200, { ok: true, tiket: t, pesan: 'Balasan terkirim ke sekolah.' });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* ---------- pengumuman & maintenance ---------- */
  get('/api/super/pengumuman', (req, res) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, {
      ok: true, rows: saas.pengumumanList({}), platform: saas.branding(),
      maintenance: {
        aktif: String(saas.setting('maintenance_aktif')) === '1',
        pesan: saas.setting('maintenance_pesan')
      }
    });
  });
  post('/api/super/pengumuman', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      if (b.maintenance_aktif !== undefined) saas.setSetting('maintenance_aktif', bool(b.maintenance_aktif) ? '1' : '0');
      if (b.maintenance_pesan !== undefined) saas.setSetting('maintenance_pesan', b.maintenance_pesan);
      if (b.hapus) {
        saas.pengumumanDelete(b.hapus);
        saas.logAudit(adminName(req), 'HAPUS PENGUMUMAN', 'pengumuman', `#${b.hapus}`);
        return json(res, 200, { ok: true, pesan: 'Pengumuman dihapus.' });
      }
      if (b.judul !== undefined) {
        const r = saas.pengumumanSave(b);
        saas.logAudit(adminName(req), r.created ? 'TAMBAH PENGUMUMAN' : 'UBAH PENGUMUMAN', 'pengumuman', b.judul);
      }
      json(res, 200, { ok: true, rows: saas.pengumumanList({}), pesan: 'Pengumuman & mode pemeliharaan disimpan.' });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* ---------- petunjuk pengguna (super admin) ---------- */
  get('/api/super/panduan', (req, res, q) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, {
      ok: true, rows: saas.panduanList(q.untuk || null),
      sekolah: saas.panduanList('sekolah'), super_rows: saas.panduanList('super')
    });
  });
  post('/api/super/panduan', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      if (b.hapus) {
        saas.panduanDelete(b.hapus);
        saas.logAudit(adminName(req), 'HAPUS PANDUAN', 'panduan', `#${b.hapus}`);
        return json(res, 200, { ok: true, pesan: 'Petunjuk dihapus.' });
      }
      const r = saas.panduanSave(b);
      saas.logAudit(adminName(req), 'SIMPAN PANDUAN', 'panduan', b.judul);
      json(res, 200, { ok: true, id: r.id, pesan: 'Petunjuk pengguna disimpan.' });
    } catch (e) { fail(res, 400, e.message); }
  });

  /* ---------- audit log ---------- */
  get('/api/super/audit', (req, res, q) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, { ok: true, ...saas.auditList(q) });
  });

  /* ---------- WhatsApp gateway ---------- */
  get('/api/super/wa', (req, res) => {
    if (!guardSuper(req, res)) return;
    json(res, 200, {
      ok: true, cfg: saas.waConfig(), s: settingsForClient(),
      log: saas.waLogList({}), template: {
        tagihan: 'Pengingat: masa aktif layanan {sekolah} berakhir {tanggal}. Tagihan Rp {nominal} dapat dibayar melalui menu Info & Layanan.',
        suspend: 'Masa aktif layanan {sekolah} telah berakhir. Akun ditangguhkan sementara, silakan perpanjang.',
        pendaftaran: 'Pendaftaran {sekolah} berhasil. Kode sekolah: {kode}.'
      }
    });
  });
  post('/api/super/wa', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    for (const k of ['wa_aktif', 'wa_api_url', 'wa_api_token', 'wa_payload']) {
      if (b[k] !== undefined) saas.setSetting(k, k === 'wa_aktif' ? (bool(b[k]) ? '1' : '0') : b[k]);
    }
    saas.logAudit(adminName(req), 'UBAH WA', 'wa', 'Konfigurasi gateway WhatsApp');
    json(res, 200, { ok: true, cfg: saas.waConfig(), pesan: 'Konfigurasi WhatsApp disimpan.' });
  });
  post('/api/super/wa/uji', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const tujuan = String(b.telp || '').trim();
    if (!tujuan) return fail(res, 400, 'Nomor tujuan wajib diisi.');
    const r = await saas.waSend(tujuan, String(b.pesan || 'Uji koneksi gateway WhatsApp dari panel Super Admin.'), { jenis: 'uji' });
    if (!r.ok) return fail(res, 400, r.error || 'Gagal mengirim.');
    json(res, 200, { ok: true, pesan: 'Pesan uji terkirim.' });
  });

  /* ---------- backup & restore lanjutan ---------- */
  get('/api/super/backup', (req, res) => {
    if (!guardSuper(req, res)) return;
    const tenants = saas.tenants();
    let total = 0;
    for (const t of tenants) total += num(t.db_size);
    json(res, 200, {
      ok: true, log: saas.backupLogList(), telegram: saas.telegramCfg(),
      ringkas: { sekolah: tenants.length, ukuran_db: total, ukuran_saas: (() => { try { return dbm.dbSizeOf(saas.SAAS_DB); } catch (e) { return 0; } })() },
      tenants: tenants.map(t => ({ id: t.id, kode: t.kode, nama: t.nama, db_size: t.db_size, db_file: t.db_file }))
    });
  });
  post('/api/super/backup/telegram', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const current = saas.telegramCfg();
    const token = String(b.telegram_bot_token || '').trim();
    const chat = b.telegram_chat_id === undefined ? current.chat : String(b.telegram_chat_id || '').trim();
    let jam = current.jam;
    try { jam = telegramBackup.parseSchedule(b.telegram_jam === undefined ? current.jam : b.telegram_jam).join(', '); }
    catch (e) { return fail(res, 400, e.message); }
    const auto = b.telegram_auto === undefined ? current.auto : bool(b.telegram_auto);
    if (token.length > 256) return fail(res, 400, 'Bot token terlalu panjang.');
    if (token && !telegramBackup.isValidToken(token)) return fail(res, 400, 'Format Bot Token Telegram tidak valid.');
    if (chat.length > 128) return fail(res, 400, 'Chat ID terlalu panjang.');
    if (auto && (!(token || current.token_set) || !chat)) {
      return fail(res, 400, 'Token bot dan Chat ID wajib diisi sebelum backup otomatis diaktifkan.');
    }
    if (token) saas.setSetting('telegram_bot_token', token);
    if (b.telegram_chat_id !== undefined) saas.setSetting('telegram_chat_id', chat);
    if (b.telegram_jam !== undefined) saas.setSetting('telegram_jam', jam);
    if (b.telegram_auto !== undefined) saas.setSetting('telegram_auto', auto ? '1' : '0');
    saas.logAudit(adminName(req), 'UBAH BACKUP', 'backup', 'Konfigurasi auto backup Telegram');
    json(res, 200, { ok: true, telegram: saas.telegramCfg(), pesan: 'Konfigurasi backup Telegram disimpan.' });
  });
  post('/api/super/backup/telegram/uji', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    try {
      await saas.testTelegram(b.telegram_bot_token, b.telegram_chat_id);
      json(res, 200, { ok: true, pesan: 'Pesan uji berhasil dikirim ke Telegram.' });
    } catch (e) { fail(res, 400, e.message); }
  });
  post('/api/super/backup/kirim', async (req, res) => {
    if (!guardSuper(req, res)) return;
    try {
      const buf = buildSystemZip();
      const nama = `Backup_Platform_${telegramBackup.partsAt().stamp}.zip`;
      await saas.sendTelegram(buf, nama, `Backup platform ${lib.stampID ? lib.stampID() : lib.nowStamp()}`);
      saas.backupLog('telegram', nama, buf.length, 'sukses', 'Terkirim ke Telegram', 'manual', adminName(req));
      saas.logAudit(adminName(req), 'BACKUP TELEGRAM', 'backup', nama);
      json(res, 200, { ok: true, pesan: 'Arsip sistem terkirim ke Telegram.' });
    } catch (e) {
      saas.backupLog('telegram', '', 0, 'gagal', e.message, 'manual', adminName(req));
      fail(res, 400, e.message);
    }
  });
  get('/api/super/backup/zip', (req, res) => {
    if (!guardSuper(req, res)) return;
    const buf = buildSystemZip();
    const nama = `Backup_Platform_${telegramBackup.partsAt().stamp}.zip`;
    saas.backupLog('zip', nama, buf.length, 'sukses', 'Unduh manual', 'manual', adminName(req));
    sendBuf(res, buf, 'application/zip', nama);
  });
  get('/api/super/backup/sql', (req, res) => {
    if (!guardSuper(req, res)) return;
    const buf = Buffer.from(dumpSql(), 'utf8');
    const nama = `Database_Platform_${lib.todayISO().replace(/-/g, '')}.sql`;
    saas.backupLog('sql', nama, buf.length, 'sukses', 'Unduh manual', 'manual', adminName(req));
    sendBuf(res, buf, 'application/sql', nama);
  });
  get('/api/super/backup/source', (req, res) => {
    if (!guardSuper(req, res)) return;
    const files = sourceFiles();
    const buf = lib.zip(files);
    const nama = `Source_SmartTataTertib_${lib.todayISO().replace(/-/g, '')}.zip`;
    saas.backupLog('source', nama, buf.length, 'sukses', 'Unduh source code', 'manual', adminName(req));
    sendBuf(res, buf, 'application/zip', nama);
  });
  post('/api/super/backup/restore', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const buf = base64ToBuffer(b.base64);
    if (!buf || !buf.length) return fail(res, 400, 'Berkas backup kosong.');
    try {
      const r = await restorePayload(buf, String(b.filename || ''));
      saas.logAudit(adminName(req), 'RESTORE DATABASE', 'backup', r.pesan);
      json(res, 200, { ok: true, ...r });
    } catch (e) {
      saas.backupLog('restore', String(b.filename || ''), buf.length, 'gagal', e.message, 'manual', adminName(req));
      fail(res, 400, e.message);
    }
  });

  /* ---------- Database Manager ---------- */
  get('/api/super/database', (req, res, q) => {
    if (!guardSuper(req, res)) return;
    const scope = String(q.scope || 'saas');
    const target = scopeOf(scope);
    if (!target) return fail(res, 404, 'Database tidak ditemukan.');
    const tabel = listTables(target.conn);
    const aktif = q.tabel && tabel.includes(q.tabel) ? q.tabel : tabel[0];
    let rows = [], kolom = [], total = 0;
    if (aktif) {
      const info = target.conn.prepare(`PRAGMA table_info(${q2(aktif)})`).all();
      kolom = info.map(c => c.name);
      total = target.conn.prepare(`SELECT COUNT(*) c FROM ${q2(aktif)}`).get().c;
      const offset = Math.max(0, num(q.hal, 1) - 1) * 40;
      rows = target.conn.prepare(`SELECT rowid AS __rowid, * FROM ${q2(aktif)} LIMIT 40 OFFSET ?`).all(offset);
      rows = telegramBackup.redactSettingRows(aktif, rows);
    }
    const payload = {
      ok: true, scope, tabel, aktif, kolom, rows, total, hal: num(q.hal, 1),
      daftar: [{ scope: 'saas', nama: 'Control Plane (platform)' }].concat(
        saas.tenants().map(t => ({ scope: 't:' + t.id, nama: `${t.nama} (${t.kode})` })))
    };
    if (target.close) target.close();
    json(res, 200, payload);
  });
  post('/api/super/database/query', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const target = scopeOf(String(b.scope || 'saas'));
    if (!target) return fail(res, 404, 'Database tidak ditemukan.');
    const sql = String(b.sql || '').trim();
    if (!sql) return fail(res, 400, 'Perintah SQL kosong.');
    if (/attach|detach|load_extension|pragma\s+wal_checkpoint|vacuum\s+into/i.test(sql)) {
      return fail(res, 400, 'Perintah tersebut diblokir untuk keamanan.');
    }
    const menulis = /^\s*(insert|update|delete|drop|alter|create|replace)\b/i.test(sql);
    if (menulis && !bool(b.konfirmasi)) return fail(res, 400, 'Perintah yang mengubah data memerlukan centang konfirmasi.');
    try {
      const st = target.conn.prepare(sql);
      const rows = st.reader ? st.all() : (st.run(), []);
      const info = st.reader ? { rows: rows.length } : null;
      saas.logAudit(adminName(req), menulis ? 'QUERY TULIS' : 'QUERY', 'database', `${b.scope}: ${sql.slice(0, 160)}`, ipOf(req));
      json(res, 200, {
        ok: true, rows: rows.slice(0, 200), kolom: rows[0] ? Object.keys(rows[0]) : [],
        info: info || {}, pesan: menulis ? 'Perintah dijalankan.' : `${rows.length} baris.`
      });
    } catch (e) { fail(res, 400, e.message); }
    finally { if (target.close) target.close(); }
  });
  /* berkas database yatim (tidak dipakai sekolah mana pun) */
  get('/api/super/database/orphan', (req, res) => {
    if (!guardSuper(req, res)) return;
    const rows = saas.orphanDbFiles();
    json(res, 200, { ok: true, rows, total: rows.reduce((a, r) => a + Number(r.ukuran || 0), 0) });
  });
  post('/api/super/database/orphan/hapus', (req, res) => {
    if (!guardSuper(req, res)) return;
    const r = saas.hapusOrphanDb();
    json(res, 200, {
      ok: true, ...r,
      pesan: r.dihapus || r.gagal
        ? `${r.dihapus} berkas database yatim dihapus${r.gagal ? `, ${r.gagal} gagal (terkunci sistem)` : ''}.`
        : 'Tidak ada berkas yatim yang perlu dirapikan.'
    });
  });

  post('/api/super/database/baris', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const target = scopeOf(String(b.scope || 'saas'));
    if (!target) return fail(res, 404, 'Database tidak ditemukan.');
    const tabel = String(b.tabel || '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tabel)) return fail(res, 400, 'Nama tabel tidak valid.');
    const kolom = target.conn.prepare(`PRAGMA table_info(${q2(tabel)})`).all().map(c => c.name);
    const data = b.data || {};
    if (['settings', 'saas_settings'].includes(tabel)) {
      const current = target.conn.prepare(`SELECT key FROM ${q2(tabel)} WHERE rowid=?`).get(num(b.rowid));
      if (current && telegramBackup.redactSettingRows(tabel, [{ key: current.key, value: 'x' }])[0].value === '') {
        if (target.close) target.close();
        return fail(res, 400, 'Kredensial rahasia hanya dapat diubah dari pengaturan gateway terkait.');
      }
    }
    const sets = Object.keys(data).filter(k => kolom.includes(k));
    if (!sets.length) return fail(res, 400, 'Tidak ada kolom yang bisa diperbarui.');
    try {
      const sql = `UPDATE ${q2(tabel)} SET ${sets.map(k => `${q2(k)}=?`).join(',')} WHERE rowid=?`;
      target.conn.prepare(sql).run(...sets.map(k => data[k]), num(b.rowid));
      saas.logAudit(adminName(req), 'EDIT BARIS', 'database', `${b.scope}/${tabel} rowid ${b.rowid}`, ipOf(req));
      json(res, 200, { ok: true, pesan: 'Baris diperbarui.' });
    } catch (e) { fail(res, 400, e.message); }
    finally { if (target.close) target.close(); }
  });
  post('/api/super/database/hapus', async (req, res) => {
    if (!guardSuper(req, res)) return;
    const b = await readBody(req);
    const target = scopeOf(String(b.scope || 'saas'));
    if (!target) return fail(res, 404, 'Database tidak ditemukan.');
    const tabel = String(b.tabel || '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tabel)) return fail(res, 400, 'Nama tabel tidak valid.');
    try {
      target.conn.prepare(`DELETE FROM ${q2(tabel)} WHERE rowid=?`).run(num(b.rowid));
      saas.logAudit(adminName(req), 'HAPUS BARIS', 'database', `${b.scope}/${tabel} rowid ${b.rowid}`, ipOf(req));
      json(res, 200, { ok: true, pesan: 'Baris dihapus.' });
    } catch (e) { fail(res, 400, e.message); }
    finally { if (target.close) target.close(); }
  });

  /* =================================================================
     BAGIAN D — UTILITAS INTERNAL
     ================================================================= */
  function q2(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
  function scopeOf(scope) {
    if (!scope || scope === 'saas') return { conn: saas.sdb, nama: 'Control Plane' };
    if (scope.startsWith('t:')) {
      const t = saas.tenantById(scope.slice(2));
      if (!t) return null;
      const conn = require('better-sqlite3')(saas.absDb(t));
      conn.pragma('busy_timeout = 5000');
      return { conn, nama: t.nama, tenant: t, close: () => { try { conn.close(); } catch (e) { /* abaikan */ } } };
    }
    return null;
  }
  function listTables(conn) {
    return conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(r => r.name);
  }
  function sendBuf(res, buf, mime, nama, inline) {
    res.writeHead(200, {
      'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${nama}"`
    });
    res.end(buf);
  }
  function base64ToBuffer(v) {
    const s = String(v || '').replace(/^data:[^,]*,/, '');
    try { return Buffer.from(s, 'base64'); } catch (e) { return null; }
  }
  function dumpSql() {
    const out = ['-- Backup SMART TATA TERTIB SISWA (platform)', `-- dibuat: ${lib.nowStamp()}`, 'BEGIN TRANSACTION;'];
    const dbs = [{ nama: 'saas', conn: saas.sdb, tutup: false }].concat(
      saas.tenants().map(t => {
        try {
          const c = require('better-sqlite3')(saas.absDb(t), { readonly: true });
          return { nama: t.kode, conn: c, tutup: true };
        } catch (e) { return null; }
      }).filter(Boolean));
    for (const d of dbs) {
      out.push(`\n-- ===== Database ${d.nama} =====`);
      const objs = d.conn.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
      for (const o of objs) out.push(o.sql + ';');
      for (const o of objs) {
        if (!/^CREATE TABLE/i.test(String(o.sql))) continue;
        const rows = telegramBackup.redactSettingRows(o.name, d.conn.prepare(`SELECT * FROM "${o.name}"`).all());
        for (const r of rows) {
          const keys = Object.keys(r);
          const vals = keys.map(k => sqlLit(r[k]));
          out.push(`INSERT INTO "${o.name}" (${keys.map(k => '"' + k + '"').join(',')}) VALUES (${vals.join(',')});`);
        }
      }
      /* hanya tutup koneksi yang memang dibuka di sini (control plane tetap hidup) */
      if (d.tutup) { try { d.conn.close(); } catch (e) { /* abaikan */ } }
    }
    out.push('COMMIT;');
    return out.join('\n');
  }
  function sqlLit(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (Buffer.isBuffer(v)) return "X'" + v.toString('hex') + "'";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }
  function buildSystemZip() {
    const files = [{ name: 'README.txt', data: `Backup platform SMART TATA TERTIB SISWA\nDibuat: ${lib.nowStamp()}\n` }];
    files.push({ name: 'saas/database.json', data: JSON.stringify(dumpDatabase(saas.sdb), null, 1) });
    for (const t of saas.tenants()) {
      let conn;
      try {
        conn = require('better-sqlite3')(saas.absDb(t), { readonly: true });
        files.push({ name: `sekolah/${t.kode}-${t.slug}/database.json`, data: JSON.stringify(dumpDatabase(conn), null, 1) });
      } catch (e) {
        throw new Error(`Database sekolah ${t.kode || t.nama || t.id} tidak dapat dibaca: ${e.message}`);
      } finally {
        if (conn) conn.close();
      }
    }
    files.push({ name: 'database.sql', data: dumpSql() });
    return lib.zip(files);
  }
  function dumpDatabase(conn) {
    const out = { app: 'tata-tertib-platform', versi: 1, dibuat: lib.nowStamp(), tabel: {} };
    for (const t of listTables(conn)) {
      try { out.tabel[t] = telegramBackup.redactSettingRows(t, conn.prepare(`SELECT * FROM "${t}"`).all()); }
      catch (e) { out.tabel[t] = []; }
    }
    return out;
  }
  function sourceFiles() {
    const roots = ['server.js', 'saas.js', 'saas-routes.js', 'telegram-backup.js', 'db.js', 'lib.js', 'doc.js', 'tz.js',
      'xlsx-read.js', 'package.json', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js',
      'index.html', 'README.md', 'AGENTS.md'];
    const files = [];
    for (const r of roots) {
      try {
        const p = path.join(__dirname, r);
        if (fs.existsSync(p)) files.push({ name: r, data: fs.readFileSync(p) });
      } catch (e) { /* abaikan */ }
    }
    const walk = (dir, prefix) => {
      let list = [];
      try { list = fs.readdirSync(path.join(__dirname, dir)); } catch (e) { return; }
      for (const f of list) {
        const rel = path.join(dir, f);
        const st = fs.statSync(path.join(__dirname, rel));
        if (st.isDirectory()) walk(rel, prefix);
        else if (/\.(js|jsx|css|json|md|html)$/.test(f)) files.push({ name: rel.split(path.sep).join('/'), data: fs.readFileSync(path.join(__dirname, rel)) });
      }
    };
    walk('src', 'src');
    walk('dev-tests', 'dev-tests');
    files.push({
      name: 'README-SOURCE.txt',
      data: 'Source code SMART TATA TERTIB SISWA (platform multi-tenant).\n' +
        'Pasang: npm install → npm run build → node server.js\n' +
        'Variabel: PORT, DB_PATH (DB sekolah utama), SAAS_DB_PATH (control plane), APP_BASE_URL, WA_API_URL/WA_API_TOKEN.\n' +
        'Akun super admin pertama dibuat otomatis (SAAS_ADMIN_USER / SAAS_ADMIN_PASS).\n'
    });
    return files;
  }
  async function restorePayload(buf, filename) {
    let payload = null;
    if (/\.zip$/i.test(filename) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
      const entries = xr.unzipEntries(buf);
      const key = Object.keys(entries).find(k => /(^|\/)database\.json$/i.test(k));
      if (!key) throw new Error('Berkas ZIP tidak memuat database.json.');
      payload = JSON.parse(entries[key].toString('utf8'));
    } else {
      payload = JSON.parse(buf.toString('utf8'));
    }
    if (!payload || payload.app !== 'tata-tertib-platform' || !payload.tabel) {
      throw new Error('Berkas backup bukan arsip platform ini (penanda app tidak sesuai).');
    }
    const hasil = { sekolah: 0, baris: 0 };
    try {
      restoreInto(saas.sdb, payload.tabel, ['saas_sesi', 'saas_backup_log']);
      hasil.baris += Object.values(payload.tabel).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    } catch (e) { throw new Error('Gagal memulihkan control plane: ' + e.message); }
    saas.backupLog('restore', filename, buf.length, 'sukses', `Restore OK (${hasil.baris} baris)`, 'manual', adminName({ headers: {} }));
    return { ...hasil, pesan: `Database platform dipulihkan (${hasil.baris} baris). Semua sesi dihapus — silakan masuk kembali.` };
  }
  function restoreInto(conn, tabel, skip) {
    conn.pragma('foreign_keys = OFF');
    const ada = listTables(conn);
    conn.transaction(() => {
      for (const [nama, rows] of Object.entries(tabel)) {
        if (skip.includes(nama) || !ada.includes(nama) || !Array.isArray(rows)) continue;
        conn.prepare(`DELETE FROM "${nama}"`).run();
        const kolom = conn.prepare(`PRAGMA table_info("${nama}")`).all().map(c => c.name);
        for (const row of rows) {
          const keys = Object.keys(row).filter(k => kolom.includes(k));
          if (!keys.length) continue;
          conn.prepare(`INSERT INTO "${nama}" (${keys.map(k => '"' + k + '"').join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
            .run(...keys.map(k => row[k]));
        }
      }
      if (ada.includes('saas_sesi')) conn.prepare('DELETE FROM saas_sesi').run();
    })();
    conn.pragma('foreign_keys = ON');
  }

  let platformBackupInFlight = false;
  async function checkPlatformTelegramBackup() {
    const cfg = saas.telegramCfg();
    if (!cfg.auto || !cfg.token_set || !cfg.chat) return;
    let marker;
    try {
      marker = telegramBackup.dueMarker(
        cfg.auto, cfg.jam, saas.setting('telegram_attempt', ''), new Date()
      );
    } catch (e) {
      console.error('[backup-telegram:platform] jadwal tidak valid:', e.message);
      return;
    }
    if (!marker || platformBackupInFlight) return;
    platformBackupInFlight = true;
    saas.setSetting('telegram_attempt', marker);
    const nama = `Backup_Platform_${marker.replace(/\D/g, '')}.zip`;
    try {
      const buf = buildSystemZip();
      await saas.sendTelegram(buf, nama, `Backup platform otomatis ${marker} (${require('./tz').label()})`);
      saas.backupLog('telegram', nama, buf.length, 'sukses', 'Backup otomatis terkirim ke Telegram', 'otomatis', 'Scheduler');
      saas.logAudit('Scheduler', 'BACKUP TELEGRAM', 'backup', `Backup otomatis ${nama}`);
    } catch (e) {
      saas.backupLog('telegram', nama, 0, 'gagal', e.message, 'otomatis', 'Scheduler');
      saas.logAudit('Scheduler', 'GAGAL BACKUP TELEGRAM', 'backup', `${nama}: ${e.message}`);
      console.error('[backup-telegram:platform] gagal:', e.message);
    } finally {
      platformBackupInFlight = false;
    }
  }
  setInterval(() => { checkPlatformTelegramBackup().catch(e => console.error('[backup-telegram:platform]', e.message)); }, 15 * 1000).unref();
  setTimeout(() => { checkPlatformTelegramBackup().catch(e => console.error('[backup-telegram:platform]', e.message)); }, 20000).unref();
};
