'use strict';
/* =====================================================================
   PAYMENT GATEWAY (QRIS DINAMIS) — pembayaran hybrid
   ---------------------------------------------------------------------
   Mendukung dua jalur pembayaran yang berdampingan:
     1. QRIS Otomatis  → dibuat & diverifikasi lewat API payment gateway
     2. QRIS Manual    → gambar QRIS statis + unggah bukti (verifikasi manual)

   Adapter yang tersedia (tanpa dependency tambahan, memakai fetch bawaan):
     · midtrans  — Core API /v2/charge (payment_type=qris)
     · duitku    — /api/merchant/v2/inquiry (QRIS) + transactionStatus
     · xendit    — /qr_codes (QR Code API)
     · sandbox   — mode SIMULASI: tidak menghubungi jaringan, berguna untuk
                   pengujian / demo sebelum kredensial asli dipasang

   Kredensial & sakelar disimpan di control plane (saas_settings) sehingga
   hanya Super Admin yang dapat mengubahnya.
   ===================================================================== */
const crypto = require('crypto');

const PROVIDERS = [
  { key: 'sandbox', label: 'Simulasi (tanpa gateway)', hint: 'Untuk uji coba: QR dibuat lokal & dapat disimulasikan lunas.' },
  { key: 'midtrans', label: 'Midtrans', hint: 'Core API QRIS — butuh Server Key & Client Key.' },
  { key: 'duitku', label: 'Duitku', hint: 'Inquiry QRIS — butuh Merchant Code & API Key.' },
  { key: 'xendit', label: 'Xendit', hint: 'QR Code API — butuh Secret Key & Callback Token.' },
  { key: 'kasera', label: 'Kasera', hint: 'Kasera Pay — API Key (Bearer) + Webhook Secret (verifikasi kasera-signature-v1).' }
];
const PROVIDER_KEYS = PROVIDERS.map(p => p.key);

const DEF = {
  pay_gateway_aktif: '0',          // sakelar metode QRIS OTOMATIS
  pay_manual_aktif: '1',           // sakelar metode QRIS MANUAL
  pay_gateway_provider: 'sandbox',
  pay_gateway_mode: 'sandbox',     // sandbox | production
  pay_gateway_merchant: '',        // merchant code (duitku) / merchant id
  pay_gateway_key: '',             // server key / api key / secret key
  pay_gateway_key2: '',            // client key (midtrans) / callback token (xendit)
  pay_gateway_callback: '',        // token callback duitku/xendit/kasera (opsional)
  pay_gateway_base: '',            // base URL API (khusus Kasera, opsional)
  pay_gateway_expire_menit: '60'
};

const clean = v => String(v === null || v === undefined ? '' : v).trim();
const rupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

/** buat order id unik: TT-<tenant>-<epoch> */
function orderId(tenantId) {
  return `TT-${Number(tenantId) || 0}-${Date.now().toString(36).toUpperCase()}`;
}

/** konfigurasi gateway yang aman dikirim ke klien (tanpa kredensial) */
function publicConfig(get) {
  const provider = PROVIDER_KEYS.includes(clean(get('pay_gateway_provider'))) ? clean(get('pay_gateway_provider')) : 'sandbox';
  return {
    gateway_aktif: String(get('pay_gateway_aktif')) === '1',
    manual_aktif: String(get('pay_manual_aktif', '1')) === '1',
    provider,
    provider_label: (PROVIDERS.find(p => p.key === provider) || {}).label || provider,
    mode: clean(get('pay_gateway_mode')) || 'sandbox',
    expire_menit: Math.max(5, Number(get('pay_gateway_expire_menit')) || 60),
    configured: provider === 'sandbox' ? true
      : !!clean(get('pay_gateway_key')) || (provider === 'kasera' && !!clean(process.env.KASERA_API_KEY)),
    /* khusus Kasera Pay */
    kasera_api: KASERA_API_MODES.includes(clean(get('pay_gateway_kasera_api')))
      ? clean(get('pay_gateway_kasera_api')) : 'auto',
    webhook_secret_set: !!clean(get('pay_gateway_callback') || get('pay_gateway_key2')
      || process.env.KASERA_WEBHOOK_SECRET),
    api_key_env_set: !!clean(process.env.KASERA_API_KEY),
    providers: PROVIDERS
  };
}

/** base URL API Kasera (dapat diatur Super Admin bila berbeda). */
function kaseraBase(mode) {
  return kaseraCfg({ mode }).base;
}
function kaseraHeaders(key, merchant, idempotencyKey) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key) h.Authorization = 'Bearer ' + key;
  if (merchant) h['X-Merchant-Id'] = merchant;
  if (idempotencyKey) h['Idempotency-Key'] = String(idempotencyKey);
  return h;
}
/** status pembayaran Kasera → boolean lunas */
function kaseraPaid(v) {
  const st = String(v || '').toUpperCase();
  return ['PAID', 'SETTLED', 'SETTLEMENT', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'CAPTURE',
    'PAYMENT.PAID', 'PAYMENT.SETTLED'].includes(st);
}

/* =====================================================================
   KASERA PAY — transaksi (checkout) + webhook bertanda tangan
   ---------------------------------------------------------------------
   POST {base}/v1/transactions
        Authorization: Bearer <API KEY>
        Idempotency-Key: <nomor pesanan>
        { amount (integer), external_id, description } → checkout_url

   Webhook: header `kasera-signature-v1` = HMAC-SHA256(timestamp + "." + body mentah)
            event `payment.paid` → external_id → tagihan LUNAS

   Endpoint QRIS lama (/v1/qris) tetap dipakai sebagai CADANGAN agar akun
   yang belum mengaktifkan API Transactions tidak langsung rusak.
   ===================================================================== */
const KASERA = {
  base: 'https://pay.kasera.id',
  base_sandbox: 'https://pay.kasera.id',
  timeout_ms: 20000,
  event_lunas: ['payment.paid', 'payment.settled', 'payment.capture']
};
const KASERA_API_MODES = ['auto', 'transactions', 'qris'];

/** konfigurasi Kasera: pengaturan aplikasi → variabel lingkungan */
function kaseraCfg(cfg = {}) {
  const c = cfg || {};
  const api = KASERA_API_MODES.includes(clean(c.kasera_api)) ? clean(c.kasera_api) : 'auto';
  const mode = String(c.mode || 'sandbox');
  const base = clean(c.base) || clean(process.env.KASERA_BASE_URL) || KASERA.base;
  return {
    api, mode,
    base: base.replace(/\/+$/, ''),
    key: clean(c.key) || clean(process.env.KASERA_API_KEY),
    merchant: clean(c.merchant),
    secret: clean(c.callback) || clean(c.key2) || clean(process.env.KASERA_WEBHOOK_SECRET)
  };
}
/** daftar secret yang mungkin dipakai sebuah notifikasi */
function kaseraSecrets(cfg = {}) {
  const c = cfg || {};
  return [...new Set([clean(c.callback), clean(c.key2), clean(process.env.KASERA_WEBHOOK_SECRET)].filter(Boolean))];
}
/** baca field pembayaran dari berbagai bentuk respons Kasera */
function kaseraPayload(j = {}) {
  const roots = [j && j.data, j && j.transaction, j && j.payment, j && j.qris, j]
    .filter(x => x && typeof x === 'object');
  const nestedPayments = roots.map(x => x.payment).filter(x => x && typeof x === 'object');
  const sources = [...nestedPayments, ...roots];
  const pick = (...keys) => {
    for (const d of sources) {
      for (const k of keys) {
        const v = d[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return '';
  };
  const status = pick('status', 'transaction_status', 'payment_status', 'state').toUpperCase();
  return {
    id: pick('id', 'transaction_id', 'payment_request_id'),
    checkout_url: pick('checkout_url', 'checkoutUrl', 'payment_url', 'paymentUrl', 'invoice_url', 'redirect_url'),
    qr_string: pick('qr_string', 'qrString', 'qr_code', 'qrCode', 'qris_string', 'qr_content'),
    qr_url: pick('qr_url', 'qrUrl', 'qr_image_url', 'qris_url'),
    expires_at: pick('expires_at', 'expired_at', 'expiry_at', 'expiresAt', 'expiry_time'),
    status, paid: sources.some(d => d.paid === true) || kaseraPaid(status), raw: j
  };
}
function kaseraUsable(p) { return !!(p && (p.checkout_url || p.qr_string || p.qr_url)); }
function kaseraErrorMessage(j = {}) {
  const root = j && typeof j === 'object' ? j : {};
  const err = root.error && typeof root.error === 'object'
    ? root.error
    : (root.data && root.data.error && typeof root.data.error === 'object' ? root.data.error : {});
  const code = clean(err.code || root.code);
  const message = clean(err.message || root.message || root.error_message
    || (typeof root.error === 'string' ? root.error : ''));
  const fields = err.fields && typeof err.fields === 'object'
    ? Object.keys(err.fields).join(', ') : '';
  const requestId = clean(err.request_id || root.request_id || root.requestId);
  return [
    code ? `Kasera ${code}` : '',
    message,
    fields ? `Periksa field: ${fields}` : '',
    requestId ? `Request ID: ${requestId}` : ''
  ].filter(Boolean).join(' — ');
}

/** Buat permintaan pembayaran ke Kasera Pay (endpoint resmi /v1/transactions). */
async function kaseraCreateTransaction(cfg, req = {}) {
  const k = kaseraCfg(cfg);
  const external_id = clean(req.external_id || req.order_id);
  const amount = Math.round(Number(req.amount) || 0);
  if (!k.key) return { ok: false, api: 'transactions', error: 'API Key Kasera belum diisi (KASERA_API_KEY).' };
  if (k.mode === 'production' && k.key.startsWith('kp_test_')) {
    return { ok: false, api: 'transactions', error: 'Mode Kasera Production memerlukan API Key kp_live_, bukan kp_test_.' };
  }
  if (k.mode === 'sandbox' && k.key.startsWith('kp_live_')) {
    return { ok: false, api: 'transactions', error: 'Mode Kasera Sandbox memerlukan API Key kp_test_, bukan kp_live_.' };
  }
  if (!external_id) return { ok: false, api: 'transactions', error: 'external_id (nomor pesanan) wajib diisi.' };
  if (!(amount > 0)) return { ok: false, api: 'transactions', error: 'Nominal pembayaran harus bilangan bulat > 0.' };
  const headers = kaseraHeaders(k.key, k.merchant, clean(req.idempotency_key) || external_id);
  const body = {
    amount,
    external_id,
    description: clean(req.description) || ('Pembayaran ' + external_id),
    payment_methods: ['qris']
  };
  const customer = req.customer || null;
  if (customer && (clean(customer.nama || customer.name) || clean(customer.email))) {
    body.customer = {
      name: clean(customer.nama || customer.name) || 'Pelanggan',
      email: clean(customer.email), phone: clean(customer.phone)
    };
  }
  if (clean(req.return_url)) body.return_url = clean(req.return_url);
  if (Number(cfg && (cfg.expire_menit || cfg.expiry_minutes))) {
    body.expires_in_minutes = Math.max(1, Number(cfg.expire_menit || cfg.expiry_minutes) || 60);
  }
  try {
    const r = await fetch(`${k.base}/v1/transactions`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(KASERA.timeout_ms)
    });
    const j = await r.json().catch(() => ({}));
    const p = kaseraPayload(j);
    const pesan = kaseraErrorMessage(j);
    if (!r.ok) {
      return {
        ok: false, api: 'transactions', http: Number(r.status),
        fallback: [404, 405, 501].includes(Number(r.status)),
        error: pesan || `Kasera menolak permintaan (HTTP ${r.status}).`, raw: j
      };
    }
    if (!kaseraUsable(p)) {
      return {
        ok: false, api: 'transactions', http: Number(r.status), fallback: false,
        error: pesan || 'Respons Kasera tidak memuat checkout_url / QR.', raw: j
      };
    }
    return { ok: true, api: 'transactions', http: Number(r.status), ...p, external_id, amount };
  } catch (e) {
    return { ok: false, api: 'transactions', fallback: false, error: 'Gagal menghubungi Kasera: ' + e.message };
  }
}

/** Cek status transaksi Kasera memakai id payreq_ yang dikembalikan saat create. */
async function kaseraCheckTransaction(cfg, transaction_id) {
  const k = kaseraCfg(cfg);
  if (!k.key) return { ok: false, api: 'transactions', error: 'API Key Kasera belum diisi.' };
  const oid = clean(transaction_id);
  if (!oid) return { ok: false, api: 'transactions', error: 'ID transaksi Kasera kosong.' };
  try {
    const r = await fetch(`${k.base}/v1/transactions/${encodeURIComponent(oid)}`, {
      headers: kaseraHeaders(k.key, k.merchant), signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false, api: 'transactions', http: Number(r.status),
        fallback: [404, 405, 501].includes(Number(r.status)),
        error: kaseraErrorMessage(j) || `HTTP ${r.status}`, raw: j
      };
    }
    const p = kaseraPayload(j);
    return { ok: true, api: 'transactions', paid: !!p.paid, status: p.status || 'PENDING', raw: j };
  } catch (e) {
    return { ok: false, api: 'transactions', fallback: true, error: e.message };
  }
}

/** HMAC-SHA256 tanda tangan webhook (hex huruf kecil). */
function kaseraSignature(rawBody, secret) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody === undefined || rawBody === null ? '' : rawBody), 'utf8');
  return crypto.createHmac('sha256', String(secret || '')).update(raw).digest('hex');
}
/** Verifikasi header v1 bertimestamp dan header legacy terhadap body MENTAH. */
function kaseraVerifySignature(rawBody, headers = {}, secrets = []) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).map(clean).filter(Boolean);
  if (!list.length) return { ok: false, reason: 'Webhook Secret Kasera belum diatur.' };
  const h = headers || {};
  const v1 = clean(h['kasera-signature-v1']);
  if (v1) {
    const signed = v1.match(/^t=(\d+),(.+)$/);
    if (!signed) return { ok: false, reason: 'Format tanda tangan webhook v1 tidak valid.' };
    const timestamp = Number(signed[1]);
    if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
      return { ok: false, reason: 'Timestamp tanda tangan webhook kedaluwarsa.' };
    }
    const candidates = signed[2].split(',').map(x => x.trim())
      .filter(x => /^v1=[0-9a-f]{64}$/i.test(x)).map(x => x.slice(3).toLowerCase());
    const raw = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(String(rawBody === undefined || rawBody === null ? '' : rawBody), 'utf8');
    for (const secret of list) {
      const expected = crypto.createHmac('sha256', secret)
        .update(String(timestamp) + '.').update(raw).digest('hex');
      for (const got of candidates) {
        const a = Buffer.from(expected, 'hex'), b = Buffer.from(got, 'hex');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, secret };
      }
    }
    return { ok: false, reason: 'Tanda tangan webhook tidak cocok.' };
  }
  const gotRaw = clean(h['kasera-signature'] || h['x-kasera-signature']
    || h['x-callback-signature'] || h['x-signature']);
  if (!gotRaw) return { ok: false, reason: 'Header kasera-signature-v1 tidak ada.' };
  const raw = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody === undefined || rawBody === null ? '' : rawBody), 'utf8');
  const got = gotRaw.toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(got)) return { ok: false, reason: 'Format tanda tangan webhook tidak valid.' };
  for (const secret of list) {
    const expect = kaseraSignature(raw, secret);
    try {
      const a = Buffer.from(expect, 'hex'), b = Buffer.from(got, 'hex');
      if (a.length && a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, secret };
    } catch (e) { /* coba secret berikutnya */ }
  }
  return { ok: false, reason: 'Tanda tangan webhook tidak cocok.' };
}

/** Inti event webhook Kasera (envelope event maupun payload polos). */
function kaseraEvent(body = {}) {
  const b = body || {};
  const d = b.data || b.transaction || b.payment || b.payload || b;
  const type = clean(b.event || b.event_type || b.type || b.event_name
    || (d && (d.event || d.event_type || d.type))).toLowerCase();
  const external_id = clean(d.external_id || d.externalId || d.reference_id || d.order_id
    || d.merchant_order_id || b.external_id || b.reference_id);
  const amount = Math.round(Number(d.amount || d.gross_amount || d.total || b.amount) || 0);
  const status = clean(d.status || d.transaction_status || d.payment_status).toUpperCase();
  const event_id = clean(b.id || b.event_id || b.eventId || b.notification_id
    || d.event_id || d.id || (external_id ? `${type || 'event'}:${external_id}:${status || ''}` : ''));
  const paid = KASERA.event_lunas.includes(type) || kaseraPaid(status)
    || (type.startsWith('payment.') && /paid|settled|success|capture|completed/.test(type));
  return { event_id, type, external_id, amount, status, paid, order_id: external_id };
}

/* ---------------- adapter: buat tagihan QRIS dinamis ---------------- */
/**
 * @returns {Promise<{ok:boolean, provider:string, order_id:string, qr_string?:string,
 *                    qr_url?:string, checkout_url?:string, expires_at?:string, raw?:any, error?:string}>}
 */
async function createCharge(cfg, { order_id, amount, label, customer }) {
  const provider = cfg.provider || 'sandbox';
  const mode = cfg.mode || 'sandbox';
  const key = clean(cfg.key);
  const key2 = clean(cfg.key2);
  const merchant = clean(cfg.merchant);
  const expireMin = Math.max(5, Number(cfg.expire_menit) || 60);
  const expiresAt = new Date(Date.now() + expireMin * 60000).toISOString();

  try {
    if (provider === 'sandbox') {
      const qr = `SIMULASI-QRIS|${order_id}|${Number(amount)}|${clean(customer && customer.nama) || 'Sekolah'}`;
      return { ok: true, provider, order_id, qr_string: qr, expires_at: expiresAt, simulated: true };
    }

    if (provider === 'midtrans') {
      if (!key) throw new Error('Server Key Midtrans belum diisi.');
      const base = mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const r = await fetch(`${base}/v2/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        body: JSON.stringify({
          payment_type: 'qris',
          transaction_details: { order_id, gross_amount: Number(amount) },
          qris: { acquirer: 'gopay' },
          custom_field1: label
        }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j.status_code && String(j.status_code) !== '201')) {
        throw new Error(j.status_message || `Midtrans menolak permintaan (HTTP ${r.status}).`);
      }
      const action = (j.actions || []).find(a => /qr|deeplink/i.test(a.name || '')) || (j.actions || [])[0] || {};
      return {
        ok: true, provider, order_id,
        qr_url: action.url || '', checkout_url: action.url || '',
        expires_at: j.expiry_time ? new Date(j.expiry_time).toISOString() : expiresAt,
        raw: j
      };
    }

    if (provider === 'duitku') {
      if (!merchant || !key) throw new Error('Merchant Code / API Key Duitku belum diisi.');
      const base = mode === 'production' ? 'https://passport.duitku.com/webapi' : 'https://sandbox.duitku.com/webapi';
      const signature = crypto.createHash('sha256').update(`${merchant}${order_id}${Number(amount)}${key}`).digest('hex');
      const r = await fetch(`${base}/api/merchant/v2/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantCode: merchant, merchantOrderId: order_id, paymentAmount: Number(amount),
          paymentMethod: 'SP', productDetails: label || 'Langganan',
          customerVaName: clean(customer && customer.nama) || 'Sekolah',
          email: clean(customer && customer.email) || 'sekolah@example.com',
          phoneNumber: clean(customer && customer.phone) || '0800000000',
          callbackUrl: clean(cfg.callback_url) || '', returnUrl: clean(cfg.return_url) || '',
          expiryPeriod: expireMin, signature
        }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || String(j.statusCode) !== '00') {
        throw new Error(j.statusMessage || `Duitku menolak permintaan (HTTP ${r.status}).`);
      }
      return { ok: true, provider, order_id, qr_string: j.qrString || '', checkout_url: j.paymentUrl || '', expires_at: expiresAt, raw: j };
    }

    if (provider === 'xendit') {
      if (!key) throw new Error('Secret Key Xendit belum diisi.');
      const r = await fetch('https://api.xendit.co/qr_codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
          'api-version': '2022-07-31'
        },
        body: JSON.stringify({ reference_id: order_id, type: 'DYNAMIC', currency: 'IDR', amount: Number(amount) }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `Xendit menolak permintaan (HTTP ${r.status}).`);
      return { ok: true, provider, order_id, qr_string: j.qr_string || '', expires_at: j.expires_at || expiresAt, raw: j };
    }

    if (provider === 'kasera') {
      const k = kaseraCfg({ ...cfg, base: clean(cfg.base || cfg.base_url) });
      if (!k.key) throw new Error('API Key / Server Key Kasera belum diisi (KASERA_API_KEY).');
      const webhookUrl = clean(cfg.webhook_url) || clean(cfg.callback_url);
      /* 1) endpoint resmi: POST /v1/transactions → checkout_url */
      if (k.api !== 'qris') {
        const hasil = await kaseraCreateTransaction({ ...cfg, key: k.key, merchant: k.merchant, base: k.base, kasera_api: k.api }, {
          external_id: order_id, amount, description: label || 'Langganan',
          customer, callback_url: clean(cfg.callback_url), return_url: clean(cfg.return_url),
          webhook_url: webhookUrl, idempotency_key: order_id
        });
        if (hasil.ok) {
          return {
            ok: true, provider, order_id, api: 'transactions',
            qr_string: clean(hasil.qr_string),
            qr_url: clean(hasil.qr_url),
            checkout_url: clean(hasil.checkout_url),
            expires_at: hasil.expires_at || expiresAt,
            raw: hasil.raw
          };
        }
        if (!hasil.fallback) throw new Error(hasil.error || 'Kasera menolak permintaan.');
        console.warn('[payment] Kasera /v1/transactions tidak tersedia → memakai /v1/qris:', hasil.error || '');
      }
      /* 2) cadangan: endpoint QRIS lama */
      const r = await fetch(`${k.base}/v1/qris`, {
        method: 'POST',
        headers: kaseraHeaders(k.key, k.merchant, order_id),
        body: JSON.stringify({
          merchant_id: k.merchant || undefined,
          reference_id: order_id,
          order_id,
          amount: Number(amount),
          currency: 'IDR',
          description: label || 'Langganan',
          customer: { name: clean(customer && customer.nama) || 'Sekolah', email: clean(customer && customer.email) || '' },
          callback_url: clean(cfg.callback_url) || '',
          return_url: clean(cfg.return_url) || '',
          expiry_minutes: expireMin
        }),
        signal: AbortSignal.timeout(20000)
      });
      const j = await r.json().catch(() => ({}));
      const p = kaseraPayload(j);
      if (!r.ok || (j.success === false) || (p.status && ['FAILED', 'ERROR'].includes(p.status))) {
        throw new Error(j.message || j.error_message || `Kasera menolak permintaan (HTTP ${r.status}).`);
      }
      return {
        ok: true, provider, order_id, api: 'qris',
        qr_string: p.qr_string,
        qr_url: p.qr_url || p.checkout_url,
        checkout_url: p.checkout_url,
        expires_at: p.expires_at || expiresAt,
        raw: j
      };
    }

    throw new Error('Provider payment gateway tidak dikenal.');
  } catch (e) {
    return { ok: false, provider, order_id, error: e.message };
  }
}

/* ---------------- adapter: cek status tagihan ---------------- */
async function checkStatus(cfg, { order_id, amount }) {
  const provider = cfg.provider || 'sandbox';
  const mode = cfg.mode || 'sandbox';
  const key = clean(cfg.key);
  const merchant = clean(cfg.merchant);
  try {
    if (provider === 'sandbox') {
      /* mode simulasi: status hanya berubah bila ditandai manual (endpoint simulasi) */
      return { ok: true, paid: false, status: 'PENDING' };
    }
    if (provider === 'midtrans') {
      const base = mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const r = await fetch(`${base}/v2/${encodeURIComponent(order_id)}/status`, {
        headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: j.status_message || ('HTTP ' + r.status) };
      const paid = ['capture', 'settlement'].includes(String(j.transaction_status)) && !['deny', 'cancel', 'expire'].includes(String(j.fraud_status || ''));
      return { ok: true, paid, status: String(j.transaction_status || '').toUpperCase(), raw: j };
    }
    if (provider === 'duitku') {
      const base = mode === 'production' ? 'https://passport.duitku.com/webapi' : 'https://sandbox.duitku.com/webapi';
      const signature = crypto.createHash('md5').update(`${merchant}${order_id}${key}`).digest('hex');
      const r = await fetch(`${base}/api/merchant/v2/transactionStatus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantCode: merchant, merchantOrderId: order_id, signature }),
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      const paid = String(j.statusCode) === '00';
      return { ok: r.ok, paid, status: String(j.statusCode || ''), raw: j };
    }
    if (provider === 'xendit') {
      const r = await fetch(`https://api.xendit.co/qr_codes/${encodeURIComponent(order_id)}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') },
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: j.message || ('HTTP ' + r.status) };
      return { ok: true, paid: String(j.status).toUpperCase() === 'COMPLETED', status: String(j.status || '').toUpperCase(), raw: j };
    }
    if (provider === 'kasera') {
      const k = kaseraCfg({ ...cfg, key: key || process.env.KASERA_API_KEY, base: clean(cfg.base || cfg.base_url) });
      if (!k.key) return { ok: false, paid: false, status: 'ERROR', error: 'API Key Kasera belum diisi.' };
      if (k.api !== 'qris') {
        const t = await kaseraCheckTransaction({ ...cfg, key: k.key, merchant: k.merchant, base: k.base, kasera_api: k.api },
          clean(cfg.transaction_id) || order_id);
        if (t.ok) return { ok: true, paid: !!t.paid, status: t.status || 'PENDING', api: 'transactions', raw: t.raw };
        return { ok: false, paid: false, status: 'ERROR', error: t.error || 'Gagal cek status Kasera.' };
      }
      const r = await fetch(`${k.base}/v1/qris/${encodeURIComponent(order_id)}`, {
        headers: kaseraHeaders(k.key, k.merchant),
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      const p = kaseraPayload(j);
      if (!r.ok) return { ok: false, paid: false, status: 'ERROR', error: j.message || ('HTTP ' + r.status) };
      return { ok: true, paid: !!p.paid, status: p.status || 'PENDING', api: 'qris', raw: j };
    }
    return { ok: false, paid: false, status: 'UNKNOWN' };
  } catch (e) {
    return { ok: false, paid: false, status: 'ERROR', error: e.message };
  }
}

/* ---------------- verifikasi signature callback ---------------- */
/**
 * @param {object} cfg konfigurasi gateway
 * @param {object|string} body payload hasil parse
 * @param {object} headers header permintaan
 * @param {string|Buffer} [raw] body MENTAH — wajib untuk Kasera (HMAC byte asli)
 * @returns {boolean} true bila signature/ token valid (atau provider simulasi)
 */
function verifyCallback(cfg, body = {}, headers = {}, raw = null) {
  const provider = cfg.provider || 'sandbox';
  const key = clean(cfg.key);
  const merchant = clean(cfg.merchant);
  if (provider === 'sandbox') return true;
  try {
    if (provider === 'midtrans') {
      const sig = String(body.signature_key || '');
      if (!sig) return false;
      const raw = `${body.order_id}${body.status_code}${body.gross_amount}${key}`;
      return crypto.createHash('sha512').update(raw).digest('hex') === sig;
    }
    if (provider === 'duitku') {
      const sig = String(body.signature || '');
      if (!sig) return false;
      return crypto.createHash('md5').update(`${merchant}${body.amount}${body.merchantOrderId}${key}`).digest('hex') === sig;
    }
    if (provider === 'xendit') {
      const token = String(headers['x-callback-token'] || body.callback_token || '');
      const expect = clean(cfg.callback) || clean(cfg.key2);
      if (!expect) return true;   // token callback tidak diatur → terima (dokumentasikan di UI)
      return token === expect;
    }
    if (provider === 'kasera') {
      const secrets = kaseraSecrets(cfg);
      if (!secrets.length) return true;   // belum diatur → perilaku lama dipertahankan
      const bahan = raw !== null && raw !== undefined
        ? raw
        : (typeof body === 'string' ? body : JSON.stringify(body));
      if (kaseraVerifySignature(bahan, headers, secrets).ok) return true;
      /* cadangan: sebagian akun menaruh tanda tangan di dalam body */
      const inBody = clean(body && (body.signature || body.callback_signature));
      return !!inBody && kaseraVerifySignature(bahan, { 'kasera-signature': inBody }, secrets).ok;
    }
  } catch (e) { return false; }
  return false;
}

/** payload callback → {order_id, paid, status} */
function parseCallback(cfg, body = {}) {
  const provider = cfg.provider || 'sandbox';
  if (provider === 'midtrans') {
    const st = String(body.transaction_status || '').toLowerCase();
    return { order_id: String(body.order_id || ''), paid: ['capture', 'settlement'].includes(st), status: st.toUpperCase(), amount: Number(body.gross_amount) || 0 };
  }
  if (provider === 'duitku') {
    return { order_id: String(body.merchantOrderId || ''), paid: String(body.resultCode) === '00', status: String(body.resultCode || ''), amount: Number(body.amount) || 0 };
  }
  if (provider === 'xendit') {
    return { order_id: String(body.reference_id || body.external_id || ''), paid: String(body.status).toUpperCase() === 'COMPLETED', status: String(body.status || '').toUpperCase(), amount: Number(body.amount) || 0 };
  }
  if (provider === 'kasera') {
    const ev = kaseraEvent(body);
    return {
      order_id: ev.order_id,
      paid: ev.paid,
      status: ev.status || (ev.paid ? 'PAID' : 'PENDING'),
      amount: ev.amount,
      event_id: ev.event_id,
      type: ev.type
    };
  }
  return { order_id: String(body.order_id || ''), paid: !!body.paid, status: body.paid ? 'PAID' : 'PENDING', amount: Number(body.amount) || 0 };
}

module.exports = {
  PROVIDERS, PROVIDER_KEYS, DEF, publicConfig, orderId, createCharge, checkStatus, verifyCallback, parseCallback, rupiah,
  kaseraBase, kaseraHeaders, kaseraPaid, kaseraCfg, kaseraSecrets, kaseraCreateTransaction,
  kaseraCheckTransaction, kaseraSignature, kaseraVerifySignature, kaseraEvent, kaseraPayload, kaseraUsable,
  KASERA, KASERA_API_MODES
};
