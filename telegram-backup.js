'use strict';

const tz = require('./tz');

const DEFAULT_SCHEDULE = '06:00, 15:00';
const MAX_SCHEDULES = 10;
const MAX_DOCUMENT_BYTES = 49 * 1024 * 1024;
const SECRET_SETTING_KEYS = new Set([
  'telegram_bot_token',
  'backup_telegram_bot_token',
  'wa_api_token',
  'wa_gateway_token',
  'recaptcha_secret',
  'pay_gateway_key',
  'pay_gateway_key2',
  'pay_gateway_callback'
]);

function parseSchedule(value) {
  const entries = String(value || '').split(/[,\s]+/).filter(Boolean);
  if (!entries.length) throw new Error('Masukkan minimal satu jam backup (format HH:mm).');
  if (entries.some(time => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error('Jam backup tidak valid. Gunakan format HH:mm, contoh 06:00, 15:00.');
  }
  const unique = [...new Set(entries)];
  if (unique.length > MAX_SCHEDULES) throw new Error(`Maksimal ${MAX_SCHEDULES} jam backup per hari.`);
  return unique;
}

function isValidToken(value) {
  return /^\d+:[A-Za-z0-9_-]+$/.test(String(value || '').trim());
}

function safeSchedule(value, fallback = DEFAULT_SCHEDULE) {
  try { return parseSchedule(value).join(', '); }
  catch (e) { return parseSchedule(fallback).join(', '); }
}

function maskSecret(value) {
  const secret = String(value || '');
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}${'•'.repeat(Math.max(3, secret.length - 4))}${secret.slice(-2)}`;
  return `${secret.slice(0, 4)}${'•'.repeat(Math.min(12, secret.length - 8))}${secret.slice(-4)}`;
}

function partsAt(date = new Date()) {
  const p = tz.partsOf(date);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    stamp: `${p.year}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}`
  };
}

function dueMarker(enabled, schedule, lastAttempt, date = new Date()) {
  if (!enabled) return '';
  const p = partsAt(date);
  const marker = `${p.date} ${p.time}`;
  return parseSchedule(schedule).includes(p.time) && marker !== String(lastAttempt || '') ? marker : '';
}

function telegramUrl(token, method) {
  return `https://api.telegram.org/bot${String(token || '')}/${method}`;
}

function credentialsOf(token, chat) {
  const botToken = String(token || '').trim();
  const chatId = String(chat || '').trim();
  if (!isValidToken(botToken)) throw new Error('Format Bot Token Telegram tidak valid.');
  if (!chatId) throw new Error('Chat ID Telegram belum diatur.');
  return { token: botToken, chat: chatId };
}

function requestOptions(options) {
  return {
    ...options,
    ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? { signal: AbortSignal.timeout(120000) } : {})
  };
}

async function telegramResponse(response) {
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { /* response may not be JSON */ }
  if (!response.ok || !data || data.ok !== true) {
    const message = data && data.description ? data.description : `HTTP ${response.status}`;
    throw new Error(`Telegram: ${String(message).slice(0, 220)}`);
  }
  return data;
}

async function sendDocument(token, chat, fileBuf, filename, caption, fetchImpl = global.fetch) {
  const credentials = credentialsOf(token, chat);
  if (!Buffer.isBuffer(fileBuf) || !fileBuf.length) throw new Error('Arsip backup kosong atau tidak dapat dibuat.');
  if (fileBuf.length > MAX_DOCUMENT_BYTES) throw new Error('Arsip melebihi batas Telegram 49 MB.');
  const form = new FormData();
  form.append('chat_id', credentials.chat);
  form.append('caption', String(caption || filename).slice(0, 900));
  form.append('document', new Blob([fileBuf], { type: 'application/zip' }), String(filename));
  const response = await fetchImpl(telegramUrl(credentials.token, 'sendDocument'), requestOptions({ method: 'POST', body: form }));
  await telegramResponse(response);
  return true;
}

async function testConnection(token, chat, fetchImpl = global.fetch) {
  const credentials = credentialsOf(token, chat);
  const response = await fetchImpl(telegramUrl(credentials.token, 'sendMessage'), requestOptions({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: credentials.chat, text: 'Uji koneksi backup SMART TATA TERTIB SISWA berhasil.' })
  }));
  await telegramResponse(response);
  return true;
}

function redactSettingRows(table, rows) {
  if (!['settings', 'saas_settings'].includes(String(table))) return rows;
  return rows.map(row => SECRET_SETTING_KEYS.has(String(row.key || ''))
    ? { ...row, value: '' }
    : row);
}

module.exports = {
  DEFAULT_SCHEDULE, MAX_SCHEDULES, MAX_DOCUMENT_BYTES, parseSchedule, safeSchedule, maskSecret,
  partsAt, dueMarker, sendDocument, testConnection, redactSettingRows, isValidToken
};
