'use strict';

const http = require('http');

async function startGateway() {
  let latestCode = '';
  let rejectNext = false;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        if (rejectNext) {
          rejectNext = false;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: false, reason: 'test gateway rejection' }));
          return;
        }
        const match = String(body.message || body.pesan || '').match(/\b(\d{6})\b/);
        if (match) latestCode = match[1];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: true }));
      } catch (e) {
        res.writeHead(400);
        res.end('invalid json');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/send`,
    code: () => latestCode,
    clearCode: () => { latestCode = ''; },
    failNext: () => { rejectNext = true; },
    waitForCode: async (timeout = 5000) => {
      const end = Date.now() + timeout;
      while (!latestCode && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
      if (!latestCode) throw new Error('Timed out waiting for the mock WhatsApp gateway.');
      return latestCode;
    },
    close: () => new Promise(resolve => server.close(resolve))
  };
}

async function configure(client, url) {
  const login = await client.req('/api/super/login', {
    method: 'POST', body: { username: 'superadmin', password: 'superadmin123' }
  });
  if (login.status !== 200) throw new Error('Super Admin login failed while configuring OTP fixture.');
  const saved = await client.req('/api/super/wa', {
    method: 'POST',
    body: {
      wa_aktif: true,
      wa_api_url: url,
      wa_api_token: '',
      wa_payload: '{"target":"{phone}","message":"{pesan}"}'
    }
  });
  if (saved.status !== 200) throw new Error('Could not configure the mock WhatsApp gateway.');
}

async function issue(client, gateway, phone) {
  gateway.clearCode();
  const result = await client.req('/api/daftar/otp', {
    method: 'POST', body: { telp: phone }
  });
  if (result.status !== 200) {
    throw new Error(`Could not request registration OTP: ${result.body && result.body.error}`);
  }
  const code = gateway.code();
  if (!/^\d{6}$/.test(code)) throw new Error('Mock WhatsApp gateway did not receive a six-digit OTP.');
  return code;
}

async function bodyWithOtp(client, gateway, body) {
  return { ...body, otp: await issue(client, gateway, body.telp || body.whatsapp || body.no_wa) };
}

module.exports = { startGateway, configure, issue, bodyWithOtp };
