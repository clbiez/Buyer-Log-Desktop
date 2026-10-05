'use strict';

// Kişisel yerel giriş önbelleği.
//
// Merkezi IAM kipinde giriş, Shared Hub'dan indirilen kullanıcı dizininin yerel
// önbelleğine (user-access.json) bağlıdır. O önbellek kaybolur/bozulur VE
// Shared Hub'daki dizin o an okunamazsa cihazda hiç kullanıcı görünmez.
//
// Bu dosya, bu cihazda şifresiyle BAŞARIYLA giriş yapmış kullanıcının yalnız
// kendi profilini (scrypt doğrulayıcısı dahil) ayrı ve sürümden bağımsız bir
// dosyada tutar. Merkezi önbellek geçerliyken hiç kullanılmaz; yalnız merkezi
// dizin ve yerel önbellek ikisi birden yokken o kullanıcıların giriş
// yapabilmesi için son çare kaynaktır. Başka kullanıcıların bilgisi buraya
// yazılmaz ve dosya Shared Hub'a/yedeğe taşınmaz.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 8;
const VERIFIER = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i;
const clone = value => JSON.parse(JSON.stringify(value));
const clean = value => String(value == null ? '' : value).trim();
const credential = profile => clean(profile && (profile.passwordHash || profile.pinHash));

function usable(profile) {
  return Boolean(profile && typeof profile === 'object' && clean(profile.id) && clean(profile.username)
    && profile.enabled !== false && clean(profile.status || 'ACTIVE') === 'ACTIVE' && VERIFIER.test(credential(profile)));
}

function createPersonalLoginCache({ file }) {
  let memo = null, memoTag = null;
  function statTag() {
    try { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; } catch (_) { return null; }
  }
  function read() {
    const tag = statTag();
    if (!tag) return { entries: [], iam: null };
    if (memo && memoTag === tag) return memo;
    let value = { entries: [], iam: null };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.entries)) {
        value = {
          entries: parsed.entries.filter(entry => entry && usable(entry.profile)),
          iam: parsed.iam && typeof parsed.iam === 'object' ? parsed.iam : null,
        };
      }
    } catch (_) {}
    memo = value; memoTag = tag;
    return value;
  }
  function write(entries, iamState) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), iam: iamState || null, entries });
    try {
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
    memo = null; memoTag = null;
  }
  // Başarılı şifre doğrulamasından sonra çağrılır: yalnız giriş yapan kişinin
  // profili saklanır/güncellenir.
  function remember(profile, store) {
    if (!usable(profile)) return false;
    const current = read();
    const saved = { id: clean(profile.id), username: clean(profile.username), savedAt: new Date().toISOString(), profile: clone(profile) };
    const entries = [saved, ...current.entries.filter(entry => entry.profile.id !== saved.id)].slice(0, MAX_ENTRIES);
    write(entries, store && store.iam ? clone(store.iam) : current.iam);
    return true;
  }
  // Yetkili merkezi dizin uygulandığında kayıtlı kişileri onunla hizalar:
  // silinen/pasifleşen kullanıcı çıkarılır, şifre/yetki değişikliği alınır.
  function reconcile(store) {
    const current = read();
    if (!current.entries.length || !store) return false;
    const byId = new Map([store.moderator, ...(Array.isArray(store.users) ? store.users : [])].filter(Boolean).map(profile => [clean(profile.id), profile]));
    const entries = [];
    for (const entry of current.entries) {
      const fresh = byId.get(entry.profile.id);
      if (!usable(fresh)) continue;
      entries.push({ ...entry, username: clean(fresh.username), profile: clone(fresh) });
    }
    const iamState = store.iam ? clone(store.iam) : current.iam;
    if (JSON.stringify(entries) === JSON.stringify(current.entries) && JSON.stringify(iamState) === JSON.stringify(current.iam)) return false;
    write(entries, iamState);
    return true;
  }
  function profiles() { return read().entries.map(entry => clone(entry.profile)); }
  function iamState() { const value = read().iam; return value ? clone(value) : null; }
  return { file, remember, reconcile, profiles, iamState };
}

module.exports = { createPersonalLoginCache, SCHEMA_VERSION };
