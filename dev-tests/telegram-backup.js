'use strict';
process.env.APP_TIMEZONE = 'Asia/Jakarta';
process.env.TZ = 'Asia/Jakarta';

const assert = require('assert');
const telegram = require('../telegram-backup');

const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890';
const now = new Date('2026-11-15T00:00:00.000Z');

assert.deepStrictEqual(telegram.parseSchedule('06:00, 15:00, 06:00'), ['06:00', '15:00']);
assert.strictEqual(telegram.safeSchedule('bad', '06:00,15:00'), '06:00, 15:00');
assert.throws(() => telegram.parseSchedule('25:00'), /tidak valid/);
assert.throws(() => telegram.parseSchedule(''), /minimal satu jam/);
assert.strictEqual(telegram.partsAt(now).date, '2026-11-15');
assert.strictEqual(telegram.partsAt(now).time, '07:00');
assert.strictEqual(telegram.dueMarker(true, '06:00,07:00', '', now), '2026-11-15 07:00');
assert.strictEqual(telegram.dueMarker(true, '07:00', '2026-11-15 07:00', now), '');
assert.strictEqual(telegram.dueMarker(false, '07:00', '', now), '');
assert.strictEqual(telegram.isValidToken(token), true);
assert.strictEqual(telegram.isValidToken('not-a-token'), false);
assert.ok(!telegram.maskSecret(token).includes(token));
assert.strictEqual(telegram.redactSettingRows('settings', [{ key: 'backup_telegram_bot_token', value: token }])[0].value, '');

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) };
}

(async () => {
  let urlSeen = '';
  await telegram.testConnection(token, '-100123', async (url, options) => {
    urlSeen = url;
    assert.strictEqual(options.method, 'POST');
    assert.deepStrictEqual(JSON.parse(options.body), {
      chat_id: '-100123',
      text: 'Uji koneksi backup SMART TATA TERTIB SISWA berhasil.'
    });
    return response({ ok: true, result: { message_id: 1 } });
  });
  assert.strictEqual(urlSeen, `https://api.telegram.org/bot${token}/sendMessage`);

  await telegram.sendDocument(token, '-100123', Buffer.from('zip'), 'backup.zip', 'Uji backup', async (url, options) => {
    assert.strictEqual(url, `https://api.telegram.org/bot${token}/sendDocument`);
    assert.strictEqual(options.method, 'POST');
    assert.ok(options.body instanceof FormData);
    return response({ ok: true, result: { message_id: 2 } });
  });

  await assert.rejects(
    telegram.testConnection(token, '-100123', async () => response({ ok: false, description: 'Unauthorized' })),
    /Telegram: Unauthorized/
  );
  await assert.rejects(telegram.testConnection('invalid', '-100123', async () => response({ ok: true })), /Format Bot Token/);
  console.log('telegram-backup: 21 checks passed');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
