'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// Sem I, O, 0 e 1 para evitar confusão ao ler o código em voz alta.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function generateCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}

function sanitizeName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const clean = value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return clean || fallback;
}

function sanitizePassword(value) {
  if (typeof value !== 'string') return null;
  const pw = value.slice(0, 64);
  return pw.length ? pw : null;
}

const isValidId = (value) => typeof value === 'string' && ID_RE.test(value);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [saltHex, keyHex] = String(stored).split(':');
    const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(keyHex, 'hex');
    return expected.length === key.length && crypto.timingSafeEqual(expected, key);
  } catch {
    return false;
  }
}

const newHostKey = () => crypto.randomBytes(24).toString('hex');
const hashHostKey = (key, secret) => crypto.createHmac('sha256', secret).update(String(key)).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Valida o formato de uma mensagem de sinalização WebRTC antes de repassá-la. */
function validSignal(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.sid !== 'string' || data.sid.length < 4 || data.sid.length > 64) return false;
  if (data.description) {
    const d = data.description;
    return (
      typeof d === 'object' &&
      (d.type === 'offer' || d.type === 'answer') &&
      typeof d.sdp === 'string' &&
      d.sdp.length > 0 &&
      d.sdp.length <= 100000
    );
  }
  if (data.candidate) {
    const c = data.candidate;
    return typeof c === 'object' && typeof c.candidate === 'string' && c.candidate.length <= 2000;
  }
  return false;
}

function getClientIp(headers, address) {
  const raw =
    headers['cf-connecting-ip'] ||
    headers['true-client-ip'] ||
    String(headers['x-forwarded-for'] || '').split(',')[0] ||
    address ||
    'unknown';
  return String(raw).trim().slice(0, 64);
}

/** Rate limit simples em memória (janela fixa). */
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  _entry(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, e);
    }
    return e;
  }
  /** Conta uma tentativa e informa se ainda está dentro do limite. */
  take(key) {
    const e = this._entry(key);
    e.count += 1;
    return e.count <= this.limit;
  }
  hit(key) {
    this._entry(key).count += 1;
  }
  isLimited(key) {
    return this._entry(key).count >= this.limit;
  }
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.hits) if (e.reset <= now) this.hits.delete(k);
  }
}

module.exports = {
  generateCode,
  normalizeCode,
  sanitizeName,
  sanitizePassword,
  isValidId,
  hashPassword,
  verifyPassword,
  newHostKey,
  hashHostKey,
  safeEqual,
  validSignal,
  getClientIp,
  RateLimiter,
};
