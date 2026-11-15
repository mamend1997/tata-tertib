'use strict';
process.env.TZ = 'Asia/Jakarta';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const assistant = require('../assistant');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'edupoin-assistant-'));
const DB = path.join(TMP, 'assistant.sqlite');
const APP_PORT = 3793;
let KODE = '';
let providerCalls = 0;
let providerPayload = null;
let providerReply = { answer: 'Buka Kalender Akademik, lalu pilih Cetak / Simpan PDF.', tour_id: 'btn-cetak-kalender' };
const provider = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    providerCalls += 1;
    providerPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerReply) } }] }));
  });
});
let providerPort = 0;

const srv = () => spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env,
    PORT: APP_PORT,
    DB_PATH: DB,
    DEMO_SEED: '1',
    EDUPOIN_AI_API_KEY: 'test-secret',
    EDUPOIN_AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    EDUPOIN_AI_MODEL: 'fake-model'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let server;
let serverLog = '';
const base = `http://127.0.0.1:${APP_PORT}`;
const results = [];
function ok(name, cond, extra = '') {
  results.push(!!cond);
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ` → ${extra}`));
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(method, url, cookie, body) {
  const response = await fetch(base + url, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    json: await response.json().catch(() => null),
    cookie: setCookie ? setCookie.split(';')[0] : cookie
  };
}

(async () => {
  try {
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    providerPort = provider.address().port;
    server = srv();
    server.stdout.on('data', data => { serverLog += data; });
    server.stderr.on('data', data => { serverLog += data; });

    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        const response = await fetch(base + '/api/public/config');
        if (response.ok) { ready = true; break; }
      } catch (e) { }
      await sleep(100);
    }
    if (!ready) throw new Error(`server startup failed: ${serverLog}`);
    const school = await (await fetch(base + '/api/public/sekolah')).json();
    KODE = ((school.rows || [])[0] || {}).kode || '';

    let result = await request('POST', '/api/assistant/chat', '', { message: 'Bagaimana absensi siswa?' });
    ok('chatbot hanya dapat digunakan setelah login', result.status === 401, JSON.stringify(result.json));

    result = await request('POST', '/api/login', '', { username: 'admin', password: 'admin123', kode: KODE });
    let cookie = result.cookie;
    ok('login admin untuk tes berhasil', result.status === 200 && !!cookie, JSON.stringify(result.json));

    const callsBeforeOffTopic = providerCalls;
    const offTopicQuestions = ['Bagaimana cuaca hari ini?', 'Berapa hasil matematika 2 tambah 2?', 'Tolong buatkan coding di luar edupoin.'];
    let offTopicOk = true;
    for (const message of offTopicQuestions) {
      result = await request('POST', '/api/assistant/chat', cookie, { message });
      offTopicOk = offTopicOk && result.status === 200 && result.json.answer === assistant.REFUSAL;
    }
    ok('cuaca, matematika umum, dan coding di luar aplikasi ditolak tanpa memanggil AI', offTopicOk
      && providerCalls === callsBeforeOffTopic, JSON.stringify(result.json));

    result = await request('POST', '/api/assistant/chat', cookie, {
      message: 'Bagaimana cara mencetak Kalender Akademik?',
      history: [{ role: 'user', content: 'Saya sedang mengelola kalender.' }]
    });
    ok('pertanyaan edupoin mengembalikan jawaban dan target yang valid', result.status === 200
      && result.json.tour?.id === 'btn-cetak-kalender', JSON.stringify(result.json));
    const systemPrompt = providerPayload?.messages?.[0]?.content || '';
    ok('system prompt membawa aturan penolakan, FAQ, dan daftar target', systemPrompt.includes(assistant.REFUSAL)
      && systemPrompt.includes('Kalender Akademik satu tahun')
      && systemPrompt.includes('btn-cetak-kalender'), systemPrompt.slice(0, 100));
    ok('request ke AI hanya menyertakan riwayat dan pertanyaan, tanpa data sekolah', !systemPrompt.includes(KODE)
      && !JSON.stringify(providerPayload).includes('admin123'));

    providerReply = { answer: 'Jawaban tes.', tour_id: 'id-yang-tidak-terdaftar' };
    result = await request('POST', '/api/assistant/chat', cookie, { message: 'Cara mengatur jadwal pelajaran?' });
    ok('ID sorotan yang tidak terdaftar tidak diteruskan ke UI', result.status === 200 && result.json.tour === null);

    result = await request('POST', '/api/logout', cookie, {});
    result = await request('POST', '/api/login', '', { username: 'guru', password: 'guru123', kode: KODE });
    cookie = result.cookie;
    providerReply = { answer: 'Buka pengaturan WhatsApp.', tour_id: 'btn-fonnte-wa' };
    result = await request('POST', '/api/assistant/chat', cookie, { message: 'Bagaimana mengatur Fonnte WhatsApp?' });
    const teacherPrompt = providerPayload?.messages?.[0]?.content || '';
    ok('target yang tidak berizin disaring untuk role guru', result.status === 200
      && result.json.tour === null && !teacherPrompt.includes('"id":"btn-fonnte-wa"'), JSON.stringify(result.json));

    result = await request('POST', '/api/assistant/chat', cookie, { message: 'x'.repeat(1201) });
    ok('panjang pertanyaan dibatasi', result.status === 400, JSON.stringify(result.json));
  } catch (error) {
    console.error('FAIL assistant test execution →', error.stack || error.message);
    results.push(false);
  } finally {
    if (server && !server.killed && server.exitCode === null) {
      server.kill();
      await new Promise(resolve => server.once('exit', resolve));
    }
    if (provider.listening) await new Promise(resolve => provider.close(resolve));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  }
  const passed = results.filter(Boolean).length;
  console.log(`assistant: ${passed}/${results.length} cek lulus`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
})();
