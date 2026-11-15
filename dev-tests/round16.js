'use strict';
/* =====================================================================
   RONDE 16 (tata-tertib) — INTEGRASI KASERA PAY
   ---------------------------------------------------------------------
   1. Adapter: POST /v1/transactions sesuai kontrak resmi Kasera → checkout_url,
      dengan /v1/qris sebagai cadangan.
   2. Webhook /api/webhook/kasera: verifikasi `Kasera-Signature-V1`
      bertimestamp, deduplikasi per id event, event payment.paid
      → tagihan perpanjangan otomatis LUNAS.
   3. Keamanan: tanpa secret 503 · tanda tangan salah 401 · nominal kurang
      ditolak · rute dikecualikan dari CSRF · log event di panel.
   Jalankan: node dev-tests/round16.js   (butuh `npx vite build` terbaru)
   ===================================================================== */
process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = 3795;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tt16-'));
const DB = path.join(DIR, 'tt.sqlite');
const SAAS = path.join(DIR, 'saas.sqlite');
const base = `http://127.0.0.1:${PORT}`;
const APP_DIR = path.join(__dirname, '..');

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; fails.push(n + (x ? ' — ' + x : '')); console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cookie = '';
async function req(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { }
  return { status: r.status, text, json };
}
async function hook(raw, headers = {}) {
  const r = await fetch(base + '/api/webhook/kasera', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { }
  return { status: r.status, text, json };
}
const sign = (raw, secret) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const signV1 = (raw, secret, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;

(async () => {
  /* =============== 1. ADAPTER (unit) =============== */
  console.log('\n== 1. ADAPTER KASERA PAY ==');
  const payment = require('../payment');
  ok('base production = https://pay.kasera.id', payment.kaseraCfg({ mode: 'production' }).base === 'https://pay.kasera.id',
    payment.kaseraCfg({ mode: 'production' }).base);
  ok('Kasera test/live memakai host API yang sama', payment.kaseraCfg({ mode: 'sandbox' }).base === 'https://pay.kasera.id');
  ok('API key dari env KASERA_API_KEY', (() => {
    process.env.KASERA_API_KEY = 'env-tt';
    const v = payment.kaseraCfg({}).key; delete process.env.KASERA_API_KEY; return v === 'env-tt';
  })());

  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/v1/transactions')) {
      return { ok: true, status: 201, json: async () => ({
        id: 'payreq_tt', status: 'pending', checkout_url: 'https://pay.kasera.id/p/tt',
        payment: { type: 'qr', qr_string: 'KASERA-QR-TT' }, expires_at: '2099-01-01T00:00:00Z'
      }) };
    }
    if (String(url).includes('/v1/transactions/')) {
      return { ok: true, status: 200, json: async () => ({ id: 'payreq_tt', status: 'succeeded' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const charge = await payment.createCharge(
    { provider: 'kasera', mode: 'production', key: 'ksr-tt', merchant: 'M-9', kasera_api: 'transactions', expire_menit: 45,
      return_url: 'https://app.example.id/langganan' },
    { order_id: 'TT-1-ABC', amount: 99000, label: 'Langganan 1 bulan', customer: { nama: 'Sekolah Uji' } }
  );
  ok('createCharge memakai /v1/transactions', calls[0].url === 'https://pay.kasera.id/v1/transactions', calls[0].url);
  ok('Authorization Bearer', calls[0].opts.headers.Authorization === 'Bearer ksr-tt');
  ok('Idempotency-Key = nomor pesanan', calls[0].opts.headers['Idempotency-Key'] === 'TT-1-ABC');
  ok('Accept & Content-Type JSON',
    calls[0].opts.headers.Accept === 'application/json' && calls[0].opts.headers['Content-Type'] === 'application/json');
  const b = JSON.parse(calls[0].opts.body);
  ok('body mengikuti API Kasera: amount, external_id, description, payment_methods',
    b.amount === 99000 && b.external_id === 'TT-1-ABC' && b.description === 'Langganan 1 bulan'
      && b.payment_methods[0] === 'qris', calls[0].opts.body);
  ok('waktu kedaluwarsa & return_url memakai nama field API resmi',
    b.expires_in_minutes === 45 && b.return_url === 'https://app.example.id/langganan'
      && b.expiry_minutes === undefined && b.webhook_url === undefined, calls[0].opts.body);
  ok('respons resmi Kasera memuat checkout_url, qr_string, expires_at, dan id transaksi',
    charge.ok && charge.raw.id === 'payreq_tt' && charge.checkout_url === 'https://pay.kasera.id/p/tt'
      && charge.qr_string === 'KASERA-QR-TT' && charge.expires_at === '2099-01-01T00:00:00Z',
    JSON.stringify({ ok: charge.ok, id: charge.raw && charge.raw.id, cu: charge.checkout_url, qr: charge.qr_string, err: charge.error }));
  const status = await payment.checkStatus({
    provider: 'kasera', mode: 'production', key: 'ksr-tt', kasera_api: 'transactions', transaction_id: charge.raw.id
  }, { order_id: 'TT-1-ABC', amount: 99000 });
  ok('cek status memakai id payreq_ Kasera, bukan external_id',
    status.ok && status.paid && calls[1].url.endsWith('/v1/transactions/payreq_tt'), calls[1] && calls[1].url);

  /* cadangan QRIS lama */
  calls.length = 0;
  const mockAsli = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/v1/transactions')) return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
    return { ok: true, status: 201, json: async () => ({ success: true, data: { qr_string: 'QR-LAMA-TT' } }) };
  };
  const charge2 = await payment.createCharge(
    { provider: 'kasera', mode: 'sandbox', key: 'k', kasera_api: 'auto' },
    { order_id: 'TT-1-FB', amount: 5000 }
  );
  ok('endpoint transaksi tidak ada → fallback /v1/qris',
    charge2.ok && charge2.api === 'qris' && charge2.qr_string === 'QR-LAMA-TT',
    JSON.stringify({ ok: charge2.ok, api: charge2.api, err: charge2.error }));

  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    throw new Error('network timeout');
  };
  const chargeNetwork = await payment.createCharge(
    { provider: 'kasera', mode: 'production', key: 'kp_live_test', kasera_api: 'auto' },
    { order_id: 'TT-1-NET', amount: 5000 }
  );
  ok('network timeout tidak membuat percobaan tagihan kedua ke endpoint legacy',
    !chargeNetwork.ok && calls.length === 1 && /menghubungi Kasera/.test(chargeNetwork.error));
  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, status: 201, json: async () => ({ id: 'payreq-incomplete', status: 'pending' }) };
  };
  const chargeIncomplete = await payment.createCharge(
    { provider: 'kasera', mode: 'production', key: 'kp_live_test', kasera_api: 'auto' },
    { order_id: 'TT-1-INCOMPLETE', amount: 5000 }
  );
  ok('respons 2xx tanpa checkout tidak membuat tagihan kedua ke endpoint legacy',
    !chargeIncomplete.ok && calls.length === 1 && /tidak memuat checkout_url/.test(chargeIncomplete.error));
  calls.length = 0;
  const modeMismatch = await payment.createCharge(
    { provider: 'kasera', mode: 'production', key: 'kp_test_wrong-mode', kasera_api: 'auto' },
    { order_id: 'TT-1-MODE', amount: 5000 }
  );
  ok('key sandbox ditolak pada mode Kasera production tanpa request ke jaringan',
    !modeMismatch.ok && /kp_live_/.test(modeMismatch.error) && calls.length === 0);

  /* kunci salah tidak di-fallback */
  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) };
  };
  const charge3 = await payment.createCharge({ provider: 'kasera', mode: 'sandbox', key: 'k' }, { order_id: 'TT-1-401', amount: 5000 });
  ok('401 → gagal tanpa fallback (hindari tagihan ganda)', charge3.ok === false && calls.length === 1, String(calls.length));
  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: false, status: 422, json: async () => ({
      error: { code: 'validation_failed', message: 'Amount is outside the permitted range.', fields: { amount: 'too_small' }, request_id: 'req-tt-422' }
    }) };
  };
  const invalid = await payment.createCharge(
    { provider: 'kasera', mode: 'production', key: 'kp_live_test', kasera_api: 'transactions' },
    { order_id: 'TT-1-422', amount: 5000 }
  );
  ok('error Kasera 422 menampilkan kode, pesan, field, dan request id',
    !invalid.ok && /validation_failed/.test(invalid.error) && /Amount is outside/.test(invalid.error)
      && /amount/.test(invalid.error) && /req-tt-422/.test(invalid.error), invalid.error);
  global.fetch = origFetch;

  /* tanda tangan & event */
  const rawC = '{"id":"ev-tt","event":"payment.paid","data":{"external_id":"TT-1-A","amount":99000}}';
  const sigC = sign(rawC, 'wh-tt');
  ok('signature legacy valid', payment.kaseraVerifySignature(rawC, { 'kasera-signature': sigC }, ['wh-tt']).ok === true);
  const timestamp = Math.floor(Date.now() / 1000);
  ok('format Kasera-Signature-V1 resmi (timestamp.raw) valid',
    payment.kaseraVerifySignature(rawC, { 'kasera-signature-v1': signV1(rawC, 'wh-tt', timestamp) }, ['wh-tt']).ok === true);
  ok('signature body-only tidak diterima pada header v1',
    payment.kaseraVerifySignature(rawC, { 'kasera-signature-v1': sigC }, ['wh-tt']).ok === false);
  ok('signature v1 di luar toleransi lima menit ditolak',
    payment.kaseraVerifySignature(rawC, { 'kasera-signature-v1': signV1(rawC, 'wh-tt', timestamp - 301) }, ['wh-tt']).ok === false);
  ok('signature salah ditolak', payment.kaseraVerifySignature(rawC, { 'kasera-signature-v1': 'abc' }, ['wh-tt']).ok === false);
  ok('body berubah → tanda tangan tidak cocok',
    payment.kaseraVerifySignature(rawC.replace('TT-1-A', 'TT-1-B'), { 'kasera-signature': sigC }, ['wh-tt']).ok === false);
  ok('event payment.paid → lunas + external_id',
    payment.kaseraEvent(JSON.parse(rawC)).paid === true && payment.kaseraEvent(JSON.parse(rawC)).external_id === 'TT-1-A');
  ok('verifyCallback dengan body mentah',
    payment.verifyCallback({ provider: 'kasera', callback: 'wh-tt' }, JSON.parse(rawC), { 'kasera-signature': sigC }, rawC) === true);
  const officialEvent = {
    id: 'evt-official', type: 'payment.paid', livemode: true,
    data: { payment_request_id: 'payreq_tt', external_id: 'TT-1-OFFICIAL', amount: 99000, status: 'succeeded' }
  };
  ok('format webhook resmi diparse dengan id transaksi dan external_id',
    payment.kaseraEvent(officialEvent).paid && payment.kaseraEvent(officialEvent).order_id === 'TT-1-OFFICIAL'
      && payment.kaseraEvent(officialEvent).amount === 99000);
  const srcServer = fs.readFileSync(path.join(APP_DIR, 'server.js'), 'utf8');
  ok('rute webhook dikecualikan dari CSRF', /CSRF_EXEMPT[\s\S]{0,300}\/api\/webhook\/kasera/.test(srcServer));
  const bundle = (() => {
    try {
      const dist = path.join(APP_DIR, 'dist', 'assets');
      const f = fs.readdirSync(dist).find(x => /^index-.*\.js$/.test(x));
      return f ? fs.readFileSync(path.join(dist, f), 'utf8') : '';
    } catch (e) { return ''; }
  })();
  ok('UI panel memuat pengaturan Kasera (bundle terbaru)', /data-pay-kasera-api/.test(bundle));

  /* =============== 2. SERVER & PENGATURAN =============== */
  const srv = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(base + '/')).status === 200) break; } catch (e) { }
      await sleep(250);
    }
    console.log('\n== 2. PENGATURAN KASERA DI PANEL SUPER ADMIN ==');
    const S = new Database(SAAS);
    const adm = S.prepare('SELECT username FROM saas_admins ORDER BY id LIMIT 1').get();
    let r = await req('POST', '/api/super/login', { username: adm.username, password: 'superadmin123' });
    ok('login Super Admin', r.status === 200 && r.json && r.json.ok === true, r.text.slice(0, 120));

    r = await req('GET', '/api/super/qris');
    ok('GET /api/super/qris memuat webhook_url', r.status === 200 && /\/api\/webhook\/kasera/.test(r.json.pay.webhook_url || ''),
      (r.json && r.json.pay && r.json.pay.webhook_url) || '');
    ok('belum ada Webhook Secret', r.json.pay.webhook_secret_set === false);

    r = await req('POST', '/api/super/qris', {
      pay: {
        gateway_aktif: true, manual_aktif: true, provider: 'kasera', mode: 'sandbox',
        key: 'ksr-tt-16', key2: 'wh2-tt-16', callback: 'wh-tt-16', kasera_api: 'transactions', expire_menit: 60
      }
    });
    ok('simpan konfigurasi Kasera', r.status === 200 && r.json && r.json.ok === true, r.text.slice(0, 140));
    const g = k => String((S.prepare('SELECT value FROM saas_settings WHERE key=?').get(k) || {}).value || '');
    ok('Webhook Secret tersimpan', g('pay_gateway_callback') === 'wh-tt-16', g('pay_gateway_callback'));
    ok('mode API tersimpan', g('pay_gateway_kasera_api') === 'transactions', g('pay_gateway_kasera_api'));
    ok('secret tidak dikirim balik', (JSON.stringify((await req('GET', '/api/super/qris')).json)).indexOf('wh-tt-16') === -1);
    ok('status secret terdeteksi', (await req('GET', '/api/super/qris')).json.pay.webhook_secret_set === true);
    r = await req('POST', '/api/super/qris', {
      pay: { provider: 'kasera', mode: 'sandbox', key: '', key2: '', callback: '', kasera_api: 'transactions' }
    });
    ok('simpan pengaturan tanpa secret tidak menghapus kredensial tersimpan',
      r.status === 200 && g('pay_gateway_key') === 'ksr-tt-16'
        && g('pay_gateway_key2') === 'wh2-tt-16' && g('pay_gateway_callback') === 'wh-tt-16');

    /* =============== 3. WEBHOOK =============== */
    console.log('\n== 3. WEBHOOK payment.paid → PERPANJANGAN ==');
    /* tenant utama dibuat otomatis oleh saas.init() = sekolah utama (lifetime) */
    const t = S.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get();
    S.prepare("UPDATE tenants SET lifetime=0, aktif_sampai='2026-11-20', status='aktif' WHERE id=?").run(t.id);
    const awal = S.prepare('SELECT aktif_sampai FROM tenants WHERE id=?').get(t.id).aktif_sampai;
    const order = `TT-${t.id}-UJI16`;
    S.prepare(`INSERT INTO saas_pembayaran(tenant_id,paket,bulan,nominal,potongan,total,metode,status,oleh_nama,created_at,channel,provider,order_id,gateway_status)
      VALUES(?,?,?,?,0,?,'qris-gateway','menunggu','Uji',?, 'gateway','kasera',?,'PENDING')`)
      .run(t.id, t.paket || 'basic', 1, 100000, 100000, new Date().toISOString().slice(0, 19).replace('T', ' '), order);

    const raw = JSON.stringify({ id: 'evt-tt-1', type: 'payment.paid', livemode: true, data: { payment_request_id: 'payreq-tt-1', external_id: order, amount: 100000, currency: 'IDR', status: 'succeeded' } });
    let h = await hook(raw);
    ok('tanpa tanda tangan → 401', h.status === 401, 'HTTP ' + h.status);
    ok('event tidak dicatat saat ditolak',
      !S.prepare('SELECT event_id FROM kasera_event WHERE event_id=?').get('evt-tt-1'));
    h = await hook(raw, { 'kasera-signature-v1': 'salah' });
    ok('tanda tangan salah → 401', h.status === 401, 'HTTP ' + h.status);

    h = await hook(raw, { 'kasera-signature-v1': signV1(raw, 'wh-tt-16') });
    ok('tanda tangan valid → 200 & lunas', h.status === 200 && h.json && h.json.paid === true, h.text.slice(0, 160));
    const st = S.prepare('SELECT status FROM saas_pembayaran WHERE order_id=?').get(order);
    ok('pembayaran menjadi disetujui', st.status === 'disetujui', JSON.stringify(st));
    const akhir = S.prepare('SELECT aktif_sampai FROM tenants WHERE id=?').get(t.id).aktif_sampai;
    ok('masa aktif sekolah bertambah otomatis', akhir > awal, `${awal} → ${akhir}`);
    ok('audit WEBHOOK KASERA tercatat',
      S.prepare("SELECT COUNT(*) c FROM saas_audit WHERE aksi='WEBHOOK KASERA'").get().c >= 1);

    h = await hook(raw, { 'kasera-signature-v1': signV1(raw, 'wh-tt-16') });
    ok('event ganda → duplicate', h.status === 200 && h.json && h.json.duplicate === true, h.text.slice(0, 140));
    ok('masa aktif tidak bertambah dua kali',
      S.prepare('SELECT aktif_sampai FROM tenants WHERE id=?').get(t.id).aktif_sampai === akhir);

    const rawX = JSON.stringify({ id: 'evt-tt-x', type: 'payment.paid', data: { external_id: 'TT-99-TIDAKADA', amount: 1000 } });
    h = await hook(rawX, { 'kasera-signature-v1': signV1(rawX, 'wh-tt-16') });
    ok('order tak dikenal → 404', h.status === 404, 'HTTP ' + h.status);

    const order2 = `TT-${t.id}-UJI16B`;
    S.prepare(`INSERT INTO saas_pembayaran(tenant_id,paket,bulan,nominal,potongan,total,metode,status,oleh_nama,created_at,channel,provider,order_id,gateway_status)
      VALUES(?,?,?,?,0,?,'qris-gateway','menunggu','Uji',?, 'gateway','kasera',?,'PENDING')`)
      .run(t.id, t.paket || 'basic', 1, 100000, 100000, new Date().toISOString().slice(0, 19).replace('T', ' '), order2);
    const rawK = JSON.stringify({ id: 'evt-tt-2', type: 'payment.paid', data: { external_id: order2, amount: 5000 } });
    h = await hook(rawK, { 'kasera-signature-v1': signV1(rawK, 'wh-tt-16') });
    ok('nominal kurang → 400, tagihan tetap menunggu', h.status === 400
      && S.prepare('SELECT status FROM saas_pembayaran WHERE order_id=?').get(order2).status === 'menunggu', h.text.slice(0, 120));

    const rawE = JSON.stringify({ id: 'evt-tt-3', type: 'payment.expired', data: { external_id: order2, status: 'expired' } });
    h = await hook(rawE, { 'kasera-signature-v1': signV1(rawE, 'wh-tt-16') });
    ok('payment.expired → 200 tanpa pelunasan', h.status === 200 && h.json && h.json.paid === false, h.text.slice(0, 120));

    /* log event terlihat pada pengaturan */
    r = await req('GET', '/api/super/qris');
    ok('log webhook tampil di pengaturan', Array.isArray(r.json.pay.events) && r.json.pay.events.length >= 3,
      String((r.json.pay.events || []).length));
    ok('hasil pemrosesan tersimpan',
      S.prepare('SELECT hasil FROM kasera_event').all().some(x => x.hasil === 'ok'));
    r = await req('POST', '/api/super/qris', {
      pay: { provider: 'kasera', mode: 'sandbox', key2_hapus: true, callback_hapus: true }
    });
    ok('penghapusan secret hanya dilakukan dengan permintaan eksplisit',
      r.status === 200 && !g('pay_gateway_key2') && !g('pay_gateway_callback'));

    /* =============== 4. PEMBUATAN TAGIHAN GATEWAY =============== */
    console.log('\n== 4. PEMBUATAN CHECKOUT GATEWAY ==');
    const usr = { username: 'admin' };
    cookie = '';    cookie = '';
    r = await req('POST', '/api/login', { kode: t.kode, username: 'admin', password: 'admin123' });
    ok('login admin sekolah dengan kode', r.status === 200 && r.json && r.json.ok === true, r.text.slice(0, 140));
    r = await req('GET', '/api/langganan');
    ok('halaman langganan terbuka', r.status === 200, 'HTTP ' + r.status);
    ok('URL webhook Kasera terkirim ke halaman', /\/api\/webhook\/kasera/.test(JSON.stringify(r.json)),
      JSON.stringify((r.json && r.json.pay && { w: r.json.pay.webhook_url, a: r.json.pay.kasera_api }) || ''));

    console.log(`\n=== HASIL RONDE 16 (tata-tertib): ${pass} lulus, ${fail} gagal ===`);
    if (fail) { console.log('GAGAL:'); fails.forEach(f => console.log(' - ' + f)); }
    if (fail && log) console.log('\n--- log server (ekor) ---\n' + log.slice(-2000));
  } catch (e) {
    console.error('\n[fatal]', e);
    if (log) console.log(log.slice(-2500));
    fail++;
  } finally {
    srv.kill();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { }
  }
  process.exit(fail ? 1 : 0);
})();
