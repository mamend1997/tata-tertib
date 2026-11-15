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
let failPrimary = false;
const providerAttempts = [];
let providerReply = { answer: 'Buka Kalender Akademik, lalu pilih Cetak / Simpan PDF.', tour_id: 'btn-cetak-kalender' };
const provider = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    providerCalls += 1;
    providerAttempts.push({ url: req.url, authorization: req.headers.authorization });
    if (failPrimary && req.url.startsWith('/primary/')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'primary unavailable' }));
      return;
    }
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

    result = await request('POST', '/api/assistant/chat', cookie, { message: 'Bagaimana cara mencetak Kalender Akademik?' });
    ok('pertanyaan fitur memberi petunjuk saat AI belum dikonfigurasi', result.status === 503
      && /Super Admin/.test(result.json.error || result.json.pesan || ''));

    result = await request('GET', '/api/super/ai-config', cookie);
    ok('endpoint konfigurasi AI menolak sesi sekolah', result.status === 401, JSON.stringify(result.json));
    result = await request('POST', '/api/super/login', '', { username: 'superadmin', password: 'superadmin123' });
    const superCookie = result.cookie;
    ok('login Super Admin untuk konfigurasi AI berhasil', result.status === 200 && !!superCookie, JSON.stringify(result.json));
    result = await request('GET', '/api/super/ai-config', superCookie);
    ok('konfigurasi awal tidak mengirim API key', result.status === 200 && !('api_key' in result.json)
      && result.json.api_key_set === false);

    const secret = 'test-secret-from-super-panel';
    const fallbackSecret = 'test-groq-secret-from-super-panel';
    result = await request('POST', '/api/super/ai-config', superCookie, {
      api_key: secret,
      base_url: `http://127.0.0.1:${providerPort}/primary/v1`,
      model: 'fake-primary-model',
      fallback_api_key: fallbackSecret,
      fallback_base_url: `http://127.0.0.1:${providerPort}/fallback/v1`,
      fallback_model: 'fake-groq-model'
    });
    const savedConfig = result.json;
    ok('Super Admin dapat menyimpan API key utama dan cadangan', result.status === 200
      && savedConfig.database_key_set && savedConfig.api_key_source === 'super_admin'
      && savedConfig.fallback_database_key_set && savedConfig.fallback_key_source === 'super_admin'
      && !JSON.stringify(savedConfig).includes(secret) && !JSON.stringify(savedConfig).includes(fallbackSecret),
    JSON.stringify(savedConfig));
    result = await request('POST', '/api/super/ai-config', superCookie, {
      fallback_base_url: `http://127.0.0.1:${providerPort}/fallback/v1`,
      fallback_model: 'fake-groq-model'
    });
    const configRead = await request('GET', '/api/super/ai-config', superCookie);
    ok('mengubah penyedia cadangan tidak menghapus konfigurasi utama dan secret tidak dikirim balik',
      result.status === 200 && configRead.status === 200
      && configRead.json.model === 'fake-primary-model'
      && configRead.json.fallback_model === 'fake-groq-model'
      && !JSON.stringify(configRead.json).includes(secret)
      && !JSON.stringify(configRead.json).includes(fallbackSecret));
    result = await request('GET', '/api/super/qris', superCookie);
    ok('API key AI tidak bocor lewat endpoint pengaturan Super Admin lain',
      result.status === 200 && !JSON.stringify(result.json).includes(secret) && !JSON.stringify(result.json).includes(fallbackSecret));
    result = await request('POST', '/api/super/ai-config', superCookie, {
      base_url: 'http://example.com/v1', model: 'fake-model'
    });
    ok('Base URL HTTP non-localhost ditolak', result.status === 400);

    result = await request('POST', '/api/assistant/chat', cookie, {
      message: 'Bagaimana cara mencetak Kalender Akademik?',
      history: [{ role: 'user', content: 'Saya sedang mengelola kalender.' }]
    });
    ok('pertanyaan edupoin mengembalikan jawaban dan target yang valid', result.status === 200
      && result.json.tour?.id === 'btn-cetak-kalender' && providerCalls === callsBeforeOffTopic + 1, JSON.stringify(result.json));
    const systemPrompt = providerPayload?.messages?.[0]?.content || '';
    ok('system prompt membawa aturan penolakan, FAQ, dan daftar target', systemPrompt.includes(assistant.REFUSAL)
      && systemPrompt.includes('Kalender Akademik satu tahun')
      && systemPrompt.includes('btn-cetak-kalender'), systemPrompt.slice(0, 100));
    ok('request ke AI hanya menyertakan riwayat dan pertanyaan, tanpa data sekolah', !systemPrompt.includes(KODE)
      && !JSON.stringify(providerPayload).includes('admin123'));

    failPrimary = true;
    const attemptsBeforeFallback = providerAttempts.length;
    providerReply = { answer: 'Jawaban dari Groq cadangan.', tour_id: 'btn-cetak-kalender' };
    result = await request('POST', '/api/assistant/chat', cookie, { message: 'Bagaimana mencetak Kalender Akademik?' });
    const fallbackAttempts = providerAttempts.slice(attemptsBeforeFallback);
    ok('kegagalan provider utama otomatis dicoba ke Groq cadangan',
      result.status === 200 && result.json.answer === 'Jawaban dari Groq cadangan.'
      && fallbackAttempts.length === 2
      && fallbackAttempts[0].url.startsWith('/primary/')
      && fallbackAttempts[1].url.startsWith('/fallback/')
      && fallbackAttempts[0].authorization === `Bearer ${secret}`
      && fallbackAttempts[1].authorization === `Bearer ${fallbackSecret}`,
    JSON.stringify({ result: result.json, fallbackAttempts }));
    failPrimary = false;

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

    result = await request('POST', '/api/super/ai-config', superCookie, {
      api_key_clear: true,
      fallback_api_key_clear: true,
      base_url: `http://127.0.0.1:${providerPort}/primary/v1`,
      model: 'fake-primary-model',
      fallback_base_url: `http://127.0.0.1:${providerPort}/fallback/v1`,
      fallback_model: 'fake-groq-model'
    });
    ok('API key tersimpan dapat dihapus tanpa mengirimkannya kembali', result.status === 200
      && !result.json.database_key_set && !result.json.api_key_set
      && !result.json.fallback_database_key_set && !result.json.fallback_key_set);
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
