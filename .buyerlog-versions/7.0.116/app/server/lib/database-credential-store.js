'use strict';

/* Local-only encrypted credentials for direct database sources.
 * Nothing in this file participates in Shared Hub/master-data serialization.
 * The canonical shared source config stores authentication TYPE and username,
 * never the password. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LOCAL_DATA_ROOT, atomicWriteJson, atomicWriteBuffer } = require('../user-data');

const KEY_FILE = path.join(LOCAL_DATA_ROOT, '.database-credential-key');
const STORE_FILE = path.join(LOCAL_DATA_ROOT, 'database-credentials.json');

function ensureDir() { fs.mkdirSync(LOCAL_DATA_ROOT, { recursive: true }); }
function key() {
  ensureDir();
  if (fs.existsSync(KEY_FILE)) {
    const buf = fs.readFileSync(KEY_FILE);
    if (buf.length === 32) return buf;
  }
  const buf = crypto.randomBytes(32);
  atomicWriteBuffer(KEY_FILE, buf);
  try { fs.chmodSync(KEY_FILE, 0o600); } catch (_) {}
  return buf;
}
function encrypt(value) {
  const text = String(value == null ? '' : value);
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(payload) {
  if (!payload || payload.v !== 1 || !payload.iv || !payload.tag || !payload.data) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) { return ''; }
}
function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { version: 1, items: {} };
  } catch (_) { return { version: 1, items: {} }; }
}
function writeStore(store) {
  ensureDir();
  atomicWriteJson(STORE_FILE, { version: 1, items: store.items || {} });
  try { fs.chmodSync(STORE_FILE, 0o600); } catch (_) {}
}
function safeId(value) { return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80); }
function set(sourceId, credential = {}) {
  const id = safeId(sourceId);
  if (!id) throw new Error('Geçersiz database source kimliği.');
  const username = String(credential.username == null ? '' : credential.username).trim().slice(0, 300);
  const password = String(credential.password == null ? '' : credential.password);
  const store = readStore();
  if (!password) {
    delete store.items[id]; writeStore(store); return { saved: false };
  }
  store.items[id] = { username, password: encrypt(password), updatedAt: new Date().toISOString() };
  writeStore(store);
  return { saved: true };
}
function get(sourceId) {
  const id = safeId(sourceId), item = readStore().items[id];
  if (!item) return { username: '', password: '' };
  return { username: String(item.username || ''), password: decrypt(item.password) };
}
function remove(sourceId) {
  const id = safeId(sourceId), store = readStore();
  if (!id || !store.items[id]) return false;
  delete store.items[id]; writeStore(store); return true;
}
function publicStatus(sourceId) {
  const id = safeId(sourceId), item = readStore().items[id];
  return { hasCredential: Boolean(item && item.password), username: item ? String(item.username || '') : '' };
}

module.exports = { KEY_FILE, STORE_FILE, set, get, remove, publicStatus };
