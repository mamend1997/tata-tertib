'use strict';
/* Uji verifikasi OTP WhatsApp sebelum pendaftaran sekolah mandiri. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-daftar-otp-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (name, condition, extra = '') => {
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

function client() {
  let cookie = '';
  return {
    async req(p, options = {}) {
      const response = await fetch(BASE + p, {
        method: options.method || 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: 'manual'
      });
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (setCookies.length) cookie = setCookies.map(value => value.split(';')[0]).join('; ');
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('json') ? await response.json().catch(() => null) : await response.text();
      return { status: response.status, body };
    }
  };
}

(async () => {
  const gateway = await otpTest.startGateway();
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS, DEMO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  server.stdout.on('data', data => logs.push(String(data)));
  server.stderr.on('data', data => logs.push(String(data)));
  try {
    for (let i = 0; i < 90; i++) {
      try {
        const response = await fetch(BASE + '/api/public/config');
        if (response.ok) break;
      } catch (e) { /* server is still starting */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const admin = client();
    await otpTest.configure(admin, gateway.url);
    const applicant = client();
    const phone = '081234567801';
    const invalid = await applicant.req('/api/daftar/otp', { method: 'POST', body: { telp: 'nomor-salah' } });
    ok('nomor WhatsApp tidak valid ditolak', invalid.status === 400);

    const sent = await applicant.req('/api/daftar/otp', { method: 'POST', body: { telp: phone } });
    const code = gateway.code();
    ok('OTP dikirim melalui gateway WhatsApp', sent.status === 200 && /^\d{6}$/.test(code), JSON.stringify(sent.body));
    ok('API hanya mengirim status, bukan kode OTP', !JSON.stringify(sent.body).includes(code));
    ok('nomor WhatsApp pada respons disamarkan', /••••\d{4}/.test(sent.body.pesan || ''));
    const cooldown = await applicant.req('/api/daftar/otp', { method: 'POST', body: { telp: phone } });
    ok('permintaan OTP dibatasi cooldown', cooldown.status === 429);

    const form = {
      nama_sekolah: 'SMA OTP Uji',
      jenjang: 'SMA',
      alamat: 'Jl. Uji OTP 1',
      admin_nama: 'Admin OTP',
      email: 'admin-otp@uji.sch.id',
      password: 'Rahasia123',
      password2: 'Rahasia123',
      telp: phone,
      t0: Date.now() - 10000
    };
    const wrongCode = code === '000000' ? '000001' : '000000';
    const wrong = await applicant.req('/api/daftar', { method: 'POST', body: { ...form, otp: wrongCode } });
    ok('kode OTP salah tidak membuat sekolah', wrong.status === 400 && /OTP salah/i.test(wrong.body.error || ''));
    const registered = await applicant.req('/api/daftar', { method: 'POST', body: { ...form, otp: code } });
    ok('kode OTP benar mengizinkan pendaftaran', registered.status === 200 && /^\d{4}$/.test(String(registered.body.kode)),
      JSON.stringify(registered.body).slice(0, 120));

    const replay = await applicant.req('/api/daftar', { method: 'POST', body: {
      ...form, nama_sekolah: 'SMA OTP Replay', email: 'replay@uji.sch.id'
    } });
    ok('OTP yang sudah digunakan tidak dapat dipakai ulang', replay.status === 400 && /OTP/i.test(replay.body.error || ''));
    const log = await admin.req('/api/super/wa');
    ok('kode OTP tidak tersimpan pada log gateway', !JSON.stringify(log.body.log || []).includes(code));

    gateway.failNext();
    const failedSend = await applicant.req('/api/daftar/otp', { method: 'POST', body: { telp: '081234567802' } });
    ok('gateway yang menolak pesan tidak dianggap berhasil mengirim OTP',
      failedSend.status === 503 && /tidak dapat dikirim/i.test(failedSend.body.error || ''));
  } catch (error) {
    fail++;
    console.log('  ✗ EXCEPTION: ' + error.message);
    console.log(error.stack);
    console.log('SERVER LOG:\n' + logs.join('').slice(-2000));
  } finally {
    server.kill();
    await gateway.close().catch(() => {});
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} lulus, ${fail} gagal`);
  if (fail) process.exit(1);
})();
