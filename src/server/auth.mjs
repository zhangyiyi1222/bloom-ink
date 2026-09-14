import crypto from 'node:crypto';
import { all, get, nowIso, run } from './db.mjs';
import { sessionSecret } from './config.mjs';

const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function userCount() {
  return get('SELECT COUNT(*) AS n FROM users').n;
}

export function createUser(username, password) {
  const ts = nowIso();
  run(
    'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
    username,
    hashPassword(password),
    ts,
    ts
  );
  return get('SELECT * FROM users WHERE username = ?', username);
}

export function setPassword(userId, password) {
  run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    hashPassword(password),
    nowIso(),
    userId
  );
}

export function findUser(username) {
  return get('SELECT * FROM users WHERE username = ?', username) || null;
}

/* ---------------------------- 会话 ---------------------------- */

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function createSession(userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    token,
    userId,
    nowIso(),
    expires.toISOString(),
    String(userAgent).slice(0, 200)
  );
  return `${token}.${sign(token)}`;
}

export function destroySession(cookieValue) {
  const token = parseCookieValue(cookieValue);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

function parseCookieValue(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const idx = cookieValue.lastIndexOf('.');
  if (idx < 0) return null;
  const token = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  const expected = sign(token);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return token;
}

export function currentUser(cookieValue) {
  const token = parseCookieValue(cookieValue);
  if (!token) return null;
  const session = get('SELECT * FROM sessions WHERE token = ?', token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  return get('SELECT * FROM users WHERE id = ?', session.user_id) || null;
}

export function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
}

/* --------------------------- 限流 ---------------------------- */

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginAllowed(key) {
  const record = attempts.get(key);
  if (!record) return true;
  if (Date.now() - record.first > WINDOW_MS) {
    attempts.delete(key);
    return true;
  }
  return record.count < MAX_ATTEMPTS;
}

export function noteLoginFailure(key) {
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
    return;
  }
  record.count += 1;
}

export function clearLoginAttempts(key) {
  attempts.delete(key);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_DAYS * 864e5,
  };
}

export function listSessions() {
  return all('SELECT token, created_at, expires_at, user_agent FROM sessions ORDER BY created_at DESC');
}
