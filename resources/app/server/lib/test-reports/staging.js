'use strict';
/* Önizleme ile onay arasındaki geçici alan. Ayrıştırılan dosyalar ve
   raporlar yalnız süreç belleğinde ve kısa süre tutulur; onaylanmayan dosya
   diske yazılmaz. Onayda istemcinin gönderdiği rapor değil, sunucunun kendi
   ayrıştırması kullanılır. */

const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 20;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const sessions = new Map();

function purge(now) {
  for (const [id, session] of sessions) if (now - session.createdAt > TTL_MS) sessions.delete(id);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  let total = 0;
  for (const session of sessions.values()) total += session.bytes;
  for (const [id, session] of sessions) {
    if (total <= MAX_TOTAL_BYTES) break;
    total -= session.bytes; sessions.delete(id);
  }
}

function createSession(userId) {
  const now = Date.now();
  purge(now);
  const id = crypto.randomBytes(16).toString('hex');
  const session = { id, userId: String(userId || ''), createdAt: now, bytes: 0, files: new Map(), reports: [] };
  sessions.set(id, session);
  return {
    id,
    stage(file) {
      const fileId = crypto.randomBytes(12).toString('hex');
      session.files.set(fileId, { name: file.name, buffer: file.buffer, hash: file.hash, kind: file.kind });
      session.bytes += file.buffer.length;
      return fileId;
    },
    setReports(reports) { session.reports = reports; },
  };
}

function getSession(id, userId) {
  purge(Date.now());
  const session = sessions.get(String(id || ''));
  if (!session || session.userId !== String(userId || '')) return null;
  return session;
}
function dropSession(id) { sessions.delete(String(id || '')); }

module.exports = { createSession, getSession, dropSession, TTL_MS };
