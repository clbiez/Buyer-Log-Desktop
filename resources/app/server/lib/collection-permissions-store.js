'use strict';

/*
 * Collection izinleri iş verisinden ayrıdır. Bir grant sahibin yönünde tutulur
 * (owner -> grantee); bu nedenle "kim hangi sayfayı görebilir" hesabı bir
 * kullanıcının hiyerarşisinden veya genel yönetici rolünden genişlemez.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync } = require('./shared-file-transaction');

const SCHEMA_VERSION = 1;
const MAX_AUDIT_ENTRIES = 1000;
const LEVELS = new Set(['view', 'edit']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function defaultState() { return { schemaVersion: SCHEMA_VERSION, revision: 0, grants: [], migrations: {}, audit: [] }; }
function safeId(value) { return clean(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100); }

function normalizeGrant(value) {
  const ownerId = clean(value && value.ownerId);
  const granteeId = clean(value && value.granteeId);
  const level = clean(value && value.level).toLowerCase();
  if (!ownerId || !granteeId || ownerId === granteeId || !LEVELS.has(level)) return null;
  return {
    ownerId,
    granteeId,
    level,
    grantedAt: clean(value && value.grantedAt) || null,
    grantedBy: clean(value && value.grantedBy) || null,
    updatedAt: clean(value && value.updatedAt) || null,
    updatedBy: clean(value && value.updatedBy) || null,
  };
}

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const grants = [], seen = new Set();
  for (const raw of Array.isArray(source.grants) ? source.grants : []) {
    const grant = normalizeGrant(raw);
    const key = grant && `${grant.ownerId}\u0000${grant.granteeId}`;
    if (!grant || seen.has(key)) continue;
    seen.add(key); grants.push(grant);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Number(source.revision) || 0),
    grants,
    migrations: source.migrations && typeof source.migrations === 'object' && !Array.isArray(source.migrations) ? clone(source.migrations) : {},
    audit: Array.isArray(source.audit) ? source.audit.filter(item => item && typeof item === 'object').slice(0, MAX_AUDIT_ENTRIES).map(item => ({
      id: clean(item.id) || crypto.randomUUID(), at: clean(item.at) || null, action: clean(item.action), ownerId: clean(item.ownerId), granteeId: clean(item.granteeId), level: clean(item.level) || null, actorId: clean(item.actorId) || null,
    })) : [],
  };
}

async function readJson(file) {
  try { return normalizeState(JSON.parse(await fsp.readFile(file, 'utf8'))); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
}

async function writeJson(file, state) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fsp.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(normalizeState(state), null, 2), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fsp.rename(temporary, file);
  } finally { try { await fsp.unlink(temporary); } catch (_) {} }
}

function createCollectionPermissionsStore({ file, getProfiles = () => [], getSharedSyncRoot = async () => '', onAudit = null, trialPolicy = require('./update-trial-backend').createTrialWritePolicy() } = {}) {
  if (!clean(file)) throw new Error('Collection permission cache file is required.');
  const localFile = path.resolve(file);
  const profiles = () => (Array.isArray(getProfiles()) ? getProfiles() : []).filter(Boolean);
  const knownIds = () => new Set(profiles().filter(profile => profile.enabled !== false).map(profile => clean(profile.id)).filter(Boolean));
  const remoteFile = root => path.join(path.resolve(root), 'BUYER_LOG_SYNC', 'collection-permissions', 'v1.json');
  const notify = entry => { try { if (typeof onAudit === 'function') onAudit(entry); } catch (_) {} };

  async function ensure() {
    return withFileLeaseAsync(localFile, async () => {
      const current = await readJson(localFile);
      if (current) return current;
      const state = defaultState(); await writeJson(localFile, state); return state;
    });
  }
  async function read() { return (await readJson(localFile)) || await ensure(); }
  async function replaceLocal(state) {
    const next = normalizeState(state);
    await withFileLeaseAsync(localFile, async () => { await writeJson(localFile, next); });
    return next;
  }
  function effectiveOwnersFrom(state, userId) {
    const id = clean(userId); if (!id) return [];
    const out = [{ ownerId: id, level: 'edit' }];
    for (const grant of state.grants) if (grant.granteeId === id) out.push({ ownerId: grant.ownerId, level: grant.level });
    return out;
  }
  function accessLevelFrom(state, userId, ownerId) {
    return effectiveOwnersFrom(state, userId).find(item => item.ownerId === clean(ownerId))?.level || null;
  }
  function effectiveOwners(userId) {
    try {
      const text = fs.readFileSync(localFile, 'utf8');
      return effectiveOwnersFrom(normalizeState(JSON.parse(text)), userId);
    } catch (_) { return clean(userId) ? [{ ownerId: clean(userId), level: 'edit' }] : []; }
  }
  function accessLevel(userId, ownerId) {
    return effectiveOwners(userId).find(item => item.ownerId === clean(ownerId))?.level || null;
  }
  function isReady() {
    try { return Boolean(normalizeState(JSON.parse(fs.readFileSync(localFile, 'utf8'))).migrations.legacyInboundAccessV1); }
    catch (_) { return false; }
  }
  function outgoing(ownerId) {
    const id = clean(ownerId);
    try { return normalizeState(JSON.parse(fs.readFileSync(localFile, 'utf8'))).grants.filter(item => item.ownerId === id); }
    catch (_) { return []; }
  }
  function validateGrant({ ownerId, granteeId, level }) {
    const owner = clean(ownerId), grantee = clean(granteeId), normalizedLevel = clean(level).toLowerCase();
    if (!owner || !grantee) throw Object.assign(new Error('Koleksiyon sahibi ve kullanıcı zorunludur.'), { code: 'COLLECTION_GRANT_REQUIRED', statusCode: 400 });
    if (owner === grantee) throw Object.assign(new Error('Kullanıcı kendisine Koleksiyon izni veremez.'), { code: 'COLLECTION_SELF_GRANT_DENIED', statusCode: 400 });
    if (!knownIds().has(owner) || !knownIds().has(grantee)) throw Object.assign(new Error('Seçilen Koleksiyon kullanıcısı bulunamadı veya aktif değil.'), { code: 'COLLECTION_GRANTEE_NOT_FOUND', statusCode: 400 });
    if (!LEVELS.has(normalizedLevel)) throw Object.assign(new Error('Geçersiz Koleksiyon izin seviyesi.'), { code: 'COLLECTION_GRANT_LEVEL_INVALID', statusCode: 400 });
    return { ownerId: owner, granteeId: grantee, level: normalizedLevel };
  }
  function apply(state, action, detail, actorId) {
    const next = normalizeState(state), at = new Date().toISOString();
    const key = `${detail.ownerId}\u0000${detail.granteeId}`;
    const index = next.grants.findIndex(item => `${item.ownerId}\u0000${item.granteeId}` === key);
    if (action === 'set') {
      const prior = index >= 0 ? next.grants[index] : null;
      const grant = { ownerId: detail.ownerId, granteeId: detail.granteeId, level: detail.level, grantedAt: prior && prior.grantedAt || at, grantedBy: prior && prior.grantedBy || clean(actorId), updatedAt: at, updatedBy: clean(actorId) };
      if (index >= 0) next.grants[index] = grant; else next.grants.push(grant);
    } else if (index >= 0) next.grants.splice(index, 1);
    else return { state: next, changed: false };
    next.revision += 1;
    const audit = { id: crypto.randomUUID(), at, action: action === 'set' ? 'COLLECTION_PERMISSION_SET' : 'COLLECTION_PERMISSION_REVOKED', ownerId: detail.ownerId, granteeId: detail.granteeId, level: action === 'set' ? detail.level : null, actorId: clean(actorId) || null };
    next.audit = [audit, ...next.audit].slice(0, MAX_AUDIT_ENTRIES);
    return { state: next, changed: true, audit };
  }
  async function mutate(action, input) {
    trialPolicy.assertConfirmed();
    const detail = action === 'set' ? validateGrant(input || {}) : validateGrant({ ...(input || {}), level: 'view' });
    const actorId = clean(input && input.actorId);
    const root = clean(await getSharedSyncRoot());
    const target = root ? remoteFile(root) : localFile;
    // Hub belgesi ilk kez oluşurken yerel önbellekten tohumlanır: yerelde
    // tamamlanmış geçiş işareti düşerse her cihaz isReady()=false görür ve
    // hub'daki hiçbir yetki etkili olmaz.
    const seed = target === localFile ? defaultState() : ((await readJson(localFile)) || defaultState());
    const result = await withFileLeaseAsync(target, async () => {
      const current = (await readJson(target)) || seed;
      const applied = apply(current, action, detail, actorId);
      if (applied.changed) await writeJson(target, applied.state);
      return applied;
    });
    const state = await replaceLocal(result.state);
    if (result.audit) notify(result.audit);
    return { ok: true, changed: result.changed, revision: state.revision, grant: action === 'set' ? state.grants.find(item => item.ownerId === detail.ownerId && item.granteeId === detail.granteeId) || null : null };
  }
  async function setGrant(input) { return mutate('set', input); }
  async function removeGrant(input) { return mutate('remove', input); }
  async function sync() {
    if(!trialPolicy.isConfirmed())return {synced:false,paused:true,reason:'UPDATE_TRIAL_VERIFYING',state:await read()};
    const root = clean(await getSharedSyncRoot());
    if (!root) return { synced: false, reason: 'not-configured', state: await read() };
    const remote = await readJson(remoteFile(root));
    if (!remote) return { synced: false, reason: 'not-initialized', state: await read() };
    // Eski sürümün işaretsiz bıraktığı hub belgesi burada onarılır; geçiş
    // idempotenttir ve hub belgesinin kendi kilidi altında yürür.
    if (!(remote.migrations && remote.migrations.legacyInboundAccessV1)) {
      await migrateLegacyInboundAccess(profiles());
      return { synced: true, migrated: true, state: await read() };
    }
    const state = await replaceLocal(remote);
    return { synced: true, state };
  }
  async function migrateLegacyInboundAccess(entries, { actorId = 'collection-migration' } = {}) {
    trialPolicy.assertConfirmed();
    const source = Array.isArray(entries) ? entries : [];
    const marker = 'legacyInboundAccessV1';
    const root = clean(await getSharedSyncRoot());
    const target = root ? remoteFile(root) : localFile;
    // Uzak izin belgesi ilk kez oluşturulurken mevcut yerel cache'i yalnız
    // migration girdisi olarak kullanırız. Yerel hedefte ise aynı lease'i
    // yeniden almamak için doğrudan boş durumla başlarız.
    const localFallback = target === localFile ? defaultState() : ((await readJson(localFile)) || defaultState());
    const result = await withFileLeaseAsync(target, async () => {
      // Aynı dosya üzerinde kilitliyken read()/ensure() çağrısı yeniden kilit
      // almaya çalışmamalı. Dosya yoksa boş, doğrulanmış başlangıç durumu ile
      // idempotent migrationı başlatırız.
      const state = (await readJson(target)) || localFallback;
      if (state.migrations && state.migrations[marker]) return { state, created: 0, skipped: true };
      let next = state, created = 0, invalid = 0;
      for (const profile of source) {
        const granteeId = clean(profile && profile.id);
        for (const raw of Array.isArray(profile && profile.collectionAccess) ? profile.collectionAccess : []) {
          let detail;
          // Eski profilde silinmiş/geçersiz bir kullanıcı kalmış olabilir.
          // Geçiş geniş erişim üretmez; bu girdiyi kayda geçirip atlar.
          try { detail = validateGrant({ ownerId: raw && raw.ownerId, granteeId, level: raw && raw.level }); }
          catch (_) { invalid += 1; continue; }
          const existed = next.grants.some(item => item.ownerId === detail.ownerId && item.granteeId === detail.granteeId);
          const applied = apply(next, 'set', detail, actorId);
          next = applied.state; if (applied.changed && !existed) created += 1;
        }
      }
      next.migrations = { ...next.migrations, [marker]: { at: new Date().toISOString(), actorId: clean(actorId), created, invalid } };
      await writeJson(target, next);
      return { state: next, created, invalid, skipped: false };
    });
    const saved = await replaceLocal(result.state);
    return { created: result.created, invalid: result.invalid || 0, skipped: result.skipped, revision: saved.revision };
  }
  return { file: localFile, ensure, read, sync, setGrant, removeGrant, effectiveOwners, accessLevel, outgoing, isReady, migrateLegacyInboundAccess };
}

module.exports = { SCHEMA_VERSION, LEVELS, normalizeGrant, normalizeState, createCollectionPermissionsStore };
