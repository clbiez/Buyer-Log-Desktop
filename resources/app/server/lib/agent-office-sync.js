'use strict';

// Private training is NOT added to the generic peer delta allowlist. Every
// recipient gets an AES-GCM envelope wrapped to its own RSA public key. The
// shared folder and its IAM/key announcements retain the hub's trust boundary.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { withFileLeaseAsync, replaceFileWithRetry } = require('./shared-file-transaction');
const { hash, error } = require('./agent-office-store');
const MAX_BYTES = 19 * 1024 * 1024;
const BATCH_BYTES = 512 * 1024;
async function readJson(file, max = 30 * 1024 * 1024) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > max) throw error('OFFICE_SYNC_FILE_TOO_LARGE', 413);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  return withFileLeaseAsync(file, async () => {
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(value)); try { await handle.sync(); } catch (err) { if (!['EPERM','EINVAL','ENOTSUP'].includes(err.code)) throw err; } }
      finally { await handle.close(); }
      await replaceFileWithRetry(temporary, file);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  });
}
function seal(value, publicKey, aad) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const plain = Buffer.from(JSON.stringify(value));
  if (plain.length > MAX_BYTES) throw error('OFFICE_SYNC_BATCH_TOO_LARGE', 413);
  const bytes = Buffer.concat([cipher.update(zlib.gzipSync(plain)), cipher.final()]);
  return { version: 1, aad, iv: iv.toString('base64'), key: crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key).toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: bytes.toString('base64') };
}
function open(envelope, privateKey, aad) {
  if (envelope?.version !== 1 || envelope.aad !== aad) throw error('OFFICE_SYNC_ENVELOPE_INVALID');
  const key = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: MAX_BYTES }).toString('utf8'));
}
function partition(records, limit = BATCH_BYTES) {
  const blocks = []; let block = [], size = 0;
  for (const record of records) {
    const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
    if (bytes > MAX_BYTES - 2048) throw error('OFFICE_SYNC_RECORD_TOO_LARGE', 413);
    if (block.length && size + bytes > limit) { blocks.push(block); block = []; size = 0; }
    block.push(record); size += bytes;
  }
  if (block.length) blocks.push(block);
  return blocks;
}

function createAgentOfficeSync({ store, localRoot, getSharedRoot, profileById, deviceId, audit = () => {} } = {}) {
  const keyCache = new Map(), running = new Map(), status = new Map();
  async function keyFor(profile) {
    const name = hash(`${profile.id}:${deviceId}`), file = path.join(localRoot, 'keys', `${name}.json`);
    if (keyCache.has(name)) return keyCache.get(name);
    const result = await withFileLeaseAsync(file, async () => {
      const previous = await readJson(file, 20000);
      if (previous) return previous;
      const pair = await new Promise((resolve, reject) => crypto.generateKeyPair('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }, (err, publicKey, privateKey) => err ? reject(err) : resolve({ publicKey, privateKey })));
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Already holding this key's lease; exclusive creation protects recovery.
      await fs.writeFile(file, JSON.stringify({ ...pair, ownerId: profile.id, keyId: name }), { flag: 'wx', mode: 0o600 });
      return { ...pair, ownerId: profile.id, keyId: name };
    });
    keyCache.set(name, result); return result;
  }
  async function sharedRoot() {
    const root = await getSharedRoot();
    return root ? path.join(path.resolve(root), 'BUYER_LOG_SYNC', 'agent-office', 'v1') : null;
  }
  async function announcements(root) {
    let names = []; try {names = await fs.readdir(path.join(root,'keys'));} catch(err) {if(err.code !== 'ENOENT') throw err;}
    const keys = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const key = await readJson(path.join(root,'keys',name),20000), profile = key && profileById(key.ownerId);
      if (!profile || profile.enabled === false || key.keyId !== name.slice(0,-5) || key.keyId !== hash(`${key.ownerId}:${key.deviceId}`)) continue;
      try {if(crypto.createPublicKey(key.publicKey).asymmetricKeyType !== 'rsa') continue;} catch(_) {continue;}
      keys.push({...key,fingerprint:hash(key.publicKey),role:profile.systemRole});
    }
    return keys;
  }
  async function trustState(profile) {return await readJson(path.join(localRoot,'trusted',hash(profile.id)+'.json'),1024*1024) || {};}
  async function trusted(profile, key, current) {
    if(key.keyId === current.keyId && key.publicKey === current.publicKey && key.ownerId === profile.id) return true;
    const pins = await trustState(profile); return pins[key.keyId]?.publicKey === key.publicKey && pins[key.keyId]?.ownerId === key.ownerId;
  }
  async function keysFor(profile) {
    const root = await sharedRoot();if(!root)return [];
    const current = await keyFor(profile);
    const list = (await announcements(root)).filter(key=>key.ownerId === profile.id || key.role === 'moderator' || profile.systemRole === 'moderator');
    return Promise.all(list.map(async key=>({keyId:key.keyId,ownerId:key.ownerId,deviceId:key.deviceId,fingerprint:key.fingerprint,role:key.role,trusted:await trusted(profile,key,current)})));
  }
  async function approveKey(profile, raw) {
    if(raw.confirmed !== true)throw error('OFFICE_APPROVAL_REQUIRED',409);
    const root = await sharedRoot();if(!root)throw error('OFFICE_SYNC_NOT_CONFIGURED',409);
    const key = (await announcements(root)).find(key=>key.keyId === raw.keyId && key.fingerprint === raw.fingerprint);
    if(!key || !(key.ownerId === profile.id || key.role === 'moderator' || profile.systemRole === 'moderator'))throw error('OFFICE_SYNC_KEY_INVALID',403);
    const file = path.join(localRoot,'trusted',hash(profile.id)+'.json');
    const pins = await trustState(profile);pins[key.keyId] = {ownerId:key.ownerId,publicKey:key.publicKey,fingerprint:key.fingerprint,at:new Date().toISOString()};
    await writeJson(file,pins);audit(profile,'AGENT_SYNC_KEY_TRUST',key.ownerId,{keyId:key.keyId,fingerprint:key.fingerprint});return {ok:true};
  }
  async function recipients(root, owner, current) {
    const profile = profileById(owner), list = [];
    for(const key of await announcements(root))if((key.ownerId === owner || key.role === 'moderator') && await trusted(profile,key,current))list.push(key);
    return list;
  }
  async function publish(root, profile, key) {
    const records = (await store.records(profile.id, true)).map(doc => ({ doc })), targetKeys = await recipients(root, profile.id, key);
    let batches = 0, sent = 0, pending = false;
    const revision = (await store.db(profile.id).read()).revision;
    for (const recipient of targetKeys) {
      const stateFile = path.join(localRoot, 'state', `${hash(profile.id)}-${recipient.keyId}.json`);
      const state = await readJson(stateFile, 32 * 1024 * 1024) || { hashes: {}, head: null, sequence: 0 };
      if(state.sourceRevision === revision)continue;
      const changed = records.filter(record => state.hashes[`${record.doc.kind}:${record.doc.id}`] !== hash(JSON.stringify(record)));
      const blocks = partition(changed);pending ||= blocks.length > 32;
      for (const block of blocks.slice(0,32)) {
        const batch = { ownerId: profile.id, deviceId, sequence: state.sequence + 1, previous: state.head, records: block, createdAt: new Date().toISOString() };
        const name = crypto.randomUUID() + '.json', aad = `${hash(profile.id)}:${recipient.keyId}:${hash(deviceId)}:${name}`;
        const folder = path.join(root, 'private', hash(profile.id), recipient.keyId, hash(deviceId));
        const envelope = {...seal(batch, recipient.publicKey, aad), signerKeyId:key.keyId};
        envelope.signature = crypto.sign('sha256',Buffer.from(JSON.stringify(envelope)),key.privateKey).toString('base64');
        await writeJson(path.join(folder, name), envelope);
        state.sequence++; state.head = name;
        for (const record of block) state.hashes[`${record.doc.kind}:${record.doc.id}`] = hash(JSON.stringify(record));
        // Head follows the durable batch. A crash can resend a record safely.
        await writeJson(path.join(folder, 'head.json'), { ownerId: profile.id, deviceId, head: name, sequence: state.sequence });
        await writeJson(stateFile, state);
        batches++; sent += block.length;
      }
      if(blocks.length <= 32){state.sourceRevision=revision;await writeJson(stateFile,state);}
    }
    return { batches, sent, pending, recipients: targetKeys.length };
  }
  async function receiveOwner(root, recipient, key, ownerId) {
    if (ownerId !== recipient.id && recipient.systemRole !== 'moderator') throw error('OFFICE_MODERATOR_REQUIRED', 403);
    const area = path.join(root, 'private', hash(ownerId), key.keyId);
    let writers = []; try { writers = await fs.readdir(area); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    let applied = 0, pending = false;
    for (const writer of writers) {
      if (!/^[a-f0-9]{64}$/.test(writer)) continue;
      const folder = path.join(area, writer), head = await readJson(path.join(folder, 'head.json'), 4096);
      if (!head || head.ownerId !== ownerId || hash(head.deviceId) !== writer) throw error('OFFICE_SYNC_HEAD_INVALID');
      const stateFile = path.join(localRoot, 'received', `${key.keyId}-${hash(ownerId)}-${writer}.json`);
      const state = await readJson(stateFile, 2 * 1024 * 1024) || { seen: {} };
      let name = state.seen[head.head] ? state.continuation : head.head; const blocks = [], visited = new Set();
      while (name && !state.seen[name]) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name) || visited.has(name)) throw error('OFFICE_SYNC_CHAIN_INVALID');
        visited.add(name);
        const envelope = await readJson(path.join(folder, name)), aad = `${hash(ownerId)}:${key.keyId}:${writer}:${name}`;
        if (!envelope) throw error('OFFICE_SYNC_BATCH_MISSING', 503);
        const signer = (await announcements(root)).find(item=>item.keyId === envelope.signerKeyId && item.ownerId === ownerId && hash(item.deviceId) === writer);
        if (!signer || !await trusted(recipient,signer,key)) {pending = true; break;}
        const {signature,...signed} = envelope;
        if(!signature || !crypto.verify('sha256',Buffer.from(JSON.stringify(signed)),signer.publicKey,Buffer.from(signature,'base64')))throw error('OFFICE_SYNC_SIGNATURE_INVALID',403);
        const batch = open(envelope, key.privateKey, aad);
        if (batch.ownerId !== ownerId || hash(batch.deviceId) !== writer || !Array.isArray(batch.records)) throw error('OFFICE_SYNC_BATCH_INVALID');
        blocks.push({ name, batch }); name = batch.previous;
        // Bound network work per activation. Older blocks are fetched next time;
        // import is order-independent and never deletes unseen history.
        if (blocks.length >= 32) break;
      }
      for (const block of blocks.reverse()) {
        applied += (await store.importRecords(ownerId, block.batch.records)).applied;
        state.seen[block.name] = true;
      }
      state.continuation = name && !state.seen[name] ? name : null;
      pending ||= Boolean(state.continuation);
      await writeJson(stateFile, state);
    }
    if (applied && recipient.systemRole === 'moderator' && ownerId !== recipient.id) audit(recipient, 'AGENT_TRAINING_SYNC_READ', ownerId, { applied });
    return { applied, pending };
  }
  async function sync(profile, owners = []) {
    const fresh = profileById(profile.id);
    if (!fresh || fresh.enabled === false) throw error('OFFICE_USER_DISABLED', 403);
    if (running.has(profile.id)) return running.get(profile.id);
    const work = (async () => {
      const root = await sharedRoot();
      if (!root) return { state: 'local', privateTrainingEncrypted: true };
      const key = await keyFor(fresh);
      await writeJson(path.join(root, 'keys', `${key.keyId}.json`), { ownerId: fresh.id, deviceId, keyId: key.keyId, publicKey: key.publicKey });
      const sent = await publish(root, fresh, key), result = { state: 'synced', ...sent, received: 0, pending: sent.pending, privateTrainingEncrypted: true, at: new Date().toISOString() };
      for (const owner of [...new Set([fresh.id, ...owners])]) {
        const received = await receiveOwner(root, fresh, key, owner); result.received += received.applied; result.pending ||= received.pending;
      }
      status.set(fresh.id, result); return result;
    })();
    running.set(profile.id, work);
    try { return await work; } finally { running.delete(profile.id); }
  }
  async function catalog() {
    const root = await sharedRoot(); if (!root) return [];
    let owners = []; try { owners = await fs.readdir(path.join(root, 'catalog')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const items = [];
    for (const owner of owners) {
      if (!/^[a-f0-9]{64}$/.test(owner)) continue;
      const names = await fs.readdir(path.join(root, 'catalog', owner));
      for (const name of names) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const item = await readJson(path.join(root, 'catalog', owner, name), 256 * 1024);
        if (item && !item.deleted && hash(item.ownerId) === owner && item.profile?.id === name.slice(0,-5) && profileById(item.ownerId) && profileById(item.ownerId).enabled !== false) items.push(item);
      }
    }
    return items;
  }
  async function publishCatalog(profile, entry) {
    const root = await sharedRoot(); if (!root) throw error('OFFICE_SYNC_NOT_CONFIGURED', 409);
    if (entry.ownerId !== profile.id) throw error('OFFICE_OWNER_FORBIDDEN', 403);
    await writeJson(path.join(root, 'catalog', hash(profile.id), `${entry.profile.id}.json`), entry);
  }
  return { keysFor, approveKey, sync, catalog, publishCatalog, status: owner => status.get(owner) || { state: 'local' }, sharedRoot };
}
module.exports = { createAgentOfficeSync, partition, seal, open, readJson, writeJson, MAX_BYTES };
