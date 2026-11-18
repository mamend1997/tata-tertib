'use strict';
/* Uji pemulihan kata sandi Super Admin dengan OTP WhatsApp terdaftar. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const otpTest = require('./daftar-otp-fixture');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-super-recovery-'));
const DB = path.join(TMP, 'main.sqlite');
const SAAS = path.join(TMP, 'saas.sqlite');
const PORT = 8900 + Math.floor(Math.random() * 200);
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
      const type = response.headers.get('content-type') || '';
      return { status: response.status, body: type.includes('json') ? await response.json().catch(() => null) : await response.text() };
    }
  };
}

(async () => {
  const gateway = await otpTest.startGateway();
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: DB, SAAS_DB_PATH: SAAS,
      SAAS_ADMIN_PHONE: '081234567801', DEMO_SEED: '1'
    },
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
    const profile = await admin.req('/api/super/profil');
    ok('nomor pemulihan deployment tersimpan pada profil', profile.status === 200
      && profile.body.user.phone === '6281234567801');
    const anonymous = client();
    const requested = await anonymous.req('/api/super/password/otp', {
      method: 'POST', body: { identifier: 'superadmin' }
    });
    const code = await gateway.waitForCode();
    ok('OTP diminta untuk akun melalui endpoint tanpa sesi', requested.status === 200 && /^\d{6}$/.test(code));
    ok('OTP tidak dikembalikan pada respons API', !JSON.stringify(requested.body).includes(code));
    ok('nomor tujuan OTP tidak dibocorkan', !JSON.stringify(requested.body).includes('081234567801'));
    const log = await admin.req('/api/super/wa');
    ok('kode OTP tidak disimpan dalam log gateway', !JSON.stringify(log.body || {}).includes(code));

    const repeated = await anonymous.req('/api/super/password/otp', {
      method: 'POST', body: { identifier: 'superadmin' }
    });
    ok('pengiriman OTP memiliki cooldown', repeated.status === 200 && gateway.code() === code);
    const wrongCode = code === '000000' ? '000001' : '000000';
    const wrong = await anonymous.req('/api/super/password/reset', {
      method: 'POST',
      body: { identifier: 'superadmin', otp: wrongCode, password: 'KataSandiBaru123', password_ulang: 'KataSandiBaru123' }
    });
    ok('OTP yang salah tidak mengganti kata sandi', wrong.status === 400);

    const newPassword = 'SuperAdminBaru2026!';
    const reset = await anonymous.req('/api/super/password/reset', {
      method: 'POST',
      body: { identifier: 'superadmin', otp: code, password: newPassword, password_ulang: newPassword }
    });
    ok('OTP valid dapat mengatur kata sandi baru', reset.status === 200, JSON.stringify(reset.body));
    const replay = await anonymous.req('/api/super/password/reset', {
      method: 'POST',
      body: { identifier: 'superadmin', otp: code, password: 'KataSandiLain123', password_ulang: 'KataSandiLain123' }
    });
    ok('OTP hanya dapat dipakai satu kali', replay.status === 400);

    const oldSession = await admin.req('/api/super/profil');
    ok('reset membatalkan sesi Super Admin yang masih aktif', oldSession.status !== 200);
    const oldLogin = await anonymous.req('/api/super/login', {
      method: 'POST', body: { username: 'superadmin', password: 'superadmin123' }
    });
    const newLogin = await anonymous.req('/api/super/login', {
      method: 'POST', body: { username: 'superadmin', password: newPassword }
    });
    ok('kata sandi lama ditolak', oldLogin.status === 401);
    ok('kata sandi baru dapat digunakan untuk login', newLogin.status === 200 && newLogin.body.scope === 'super');

    const unknown = await anonymous.req('/api/super/password/otp', {
      method: 'POST', body: { identifier: 'akun-tidak-ada' }
    });
    ok('respons permintaan OTP tidak mengungkap akun terdaftar', unknown.status === requested.status
      && unknown.body.pesan === requested.body.pesan);
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
