'use strict';

/* AŞAMA 1 PROTOTİPİ · İTERASYON 3 — ARTIMLI, SAATSİZ, SINIRLI TEKİLLEŞTİRME (GEÇİCİ, ÜRETİM DIŞI)
 *
 *  · Nedensel tamponlama: bir kayıt, dayandığı tüm sürümler (prev / observed)
 *    bilinmeden uygulanmaz. Geç gelen öncül tamponu çözer; sonuç teslim sırasından
 *    bağımsızdır (aynı küme → aynı durum).
 *  · Kompakt durum: hücre başına yalnız BAŞ sürümler {id, value}; ezilen sürümler
 *    tutulmaz. Silinen satır işaret olarak kalır.
 *  · SAATSİZ: hiçbir karar duvar saatine/HLC'ye bakmaz. Eşzamanlı başlar korunur ve
 *    kullanıcı çözene kadar çözülmemiş çakışma kalır (ürün sahibi kararı: seçenek A).
 *
 *  İTERASYON 3 — tekilleştirme geçmişle büyümez:
 *  · Kayıt kimliği (cihaz, seq). Cihaz kendi kayıtlarını 1'den boşluksuz numaralar.
 *  · Cihaz başına KESİNTİSİZ SINIR (floor): 1..floor arasının TAMAMI sıraya alınmıştır.
 *    Bu "alınan en yüksek seq" DEĞİLDİR: floor+1'den ileri gelen kayıt sınırı
 *    ilerletmez, öncülünü bekler (eksik kayıt görünür bekleme olur, sessizce atlanmaz).
 *  · Sınır içinde olup henüz uygulanmamış kayıtlar seyrek, geçici istisnalardır:
 *    `held` (izin henüz yok) ve `blocked` (başka cihazdan öncül bekliyor).
 *    "Sürüm biliniyor mu" = seq <= floor ve istisna değil (uygulandı ya da kesin reddedildi).
 *  · Cihaz zinciri: üretici her kaydına zincir değerini (`chain` = özet(prevChain | içerik))
 *    ve öncekini (`prevChain`) yazar; özet kayıt başına BİR kez, yazımda hesaplanır.
 *    Alıcı hash hesaplamaz, yalnız karşılaştırır (ölçüm: alıcıda özet hesabı kayıt
 *    alma CPU'sunu +%62 artırıyordu). Uyuşmazlık = aynı cihaz kimliğiyle iki farklı
 *    geçmiş (yedekten geri dönüş) → `device-fork` karantinası, sessiz düşürme yok.
 *    Hedef kazara çatallanmadır; kötü niyetli sahte zincir bu katmanın konusu değildir.
 */

const crypto = require('crypto');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const displayKey = id => crypto.createHash('sha1').update(String(id)).digest('hex');

const keyOf = batch => `${batch.device}@${batch.seq}`;
// Sürüm kimliği: `${cihaz}@${seq}:${işlem}` ya da yaratmada `…:${işlem}/${alan}`.
function parseKey(id) {
  const text = String(id);
  const colon = text.indexOf(':', text.lastIndexOf('@'));
  const key = colon < 0 ? text : text.slice(0, colon);
  const at = key.lastIndexOf('@');
  return { key, device: key.slice(0, at), seq: +key.slice(at + 1) };
}
// Üretici tarafı: zincir yalnız kaydın içeriğinden hesaplanır (taşıyıcı alanlar hariç).
const contentText = b => JSON.stringify([b.owner, b.device, b.user, b.seq, b.deps || {}, b.ops]);
const chainNext = (prev, b) => sha(`${prev || ''}|${contentText(b)}`);

function createState() {
  return {
    rows: new Map(),        // row -> { deleted:null|{observed:Set}, cells: Map(field -> heads:[{id,value}]) }
    devices: new Map(),     // cihaz -> { floor, chain } : boyut cihaz sayısıyla sınırlı
    held: new Map(),        // key -> kayıt (sınır içinde, izin bekliyor)
    blocked: new Map(),     // key -> kayıt (sınır içinde, başka cihazdan öncül bekliyor)
    waitingSeq: new Map(),  // eksik aynı-cihaz öncülü key -> kayıt (sınır dışında, sıra bekliyor)
    waiting: new Map(),     // eksik nedensel öncül key -> Set(key)
    grants: new Set(), revokes: new Map(),
    appliedMax: new Map(),  // yazar -> Map(cihaz -> en yüksek uygulanan seq): geri alma kesimi denetimi
    quarantine: [],
    forks: [],
  };
}

const deviceOf = (state, device) => state.devices.get(device) || { floor: 0, chain: '' };
const sequenced = (state, { device, seq }) => seq <= deviceOf(state, device).floor;
function known(state, id) {
  const p = parseKey(id);
  if (!sequenced(state, p)) return false;
  return (state.held.size === 0 || !state.held.has(p.key)) && (state.blocked.size === 0 || !state.blocked.has(p.key));
}
function depsOfOp(op) {
  if (op.t === 'set') return op.prev || [];
  if (op.t === 'delete') return Object.values(op.observed || {}).flat();
  return [];
}
function missingDeps(state, batch, own = keyOf(batch)) {
  let missing = null;
  for (const op of batch.ops) for (const id of depsOfOp(op)) {
    if (known(state, id)) continue;
    const key = parseKey(id).key;
    if (key !== own) (missing || (missing = new Set())).add(key);
  }
  return missing ? [...missing] : [];
}

function applySet(state, op, id) {
  const r = state.rows.get(op.row);
  if (!r) return;
  const prev = new Set(op.prev || []);
  const next = (r.cells.get(op.field) || []).filter(h => !prev.has(h.id));
  next.push({ id, value: op.value });
  r.cells.set(op.field, next);
  // Silinmiş satıra, silenin görmediği yeni sürüm: satır geri gelir ve bildirilir (mevcut politika).
  if (r.deleted) { r.resurrected = true; r.deleted = null; }
}
function applyDelete(state, op) {
  const r = state.rows.get(op.row);
  if (!r || r.deleted) return;
  const observed = new Set(Object.values(op.observed || {}).flat());
  const unseen = [];
  for (const [field, heads] of r.cells) for (const h of heads) if (!observed.has(h.id)) unseen.push({ field, id: h.id });
  if (unseen.length) { r.deleteConflict = unseen; return; }
  r.deleted = { observed };
}
function applyOps(state, batch, key) {
  batch.ops.forEach((op, index) => {
    const id = `${key}:${index}`;
    if (op.t === 'create') {
      if (!state.rows.has(op.row)) state.rows.set(op.row, { deleted: null, cells: new Map() });
      const r = state.rows.get(op.row);
      for (const [field, value] of Object.entries(op.fields || {})) r.cells.set(field, [...(r.cells.get(field) || []), { id: `${id}/${field}`, value }]);
    } else if (op.t === 'set') applySet(state, op, id);
    else if (op.t === 'delete') applyDelete(state, op);
  });
}

function authorized(state, batch, owner) {
  if (batch.user === owner) return true;
  if (!state.grants.has(batch.user)) return false;
  const cuts = state.revokes.get(batch.user);
  return !cuts || cuts.every(deps => Number(deps[batch.device] || 0) >= batch.seq);
}

/* Yetki varış sırasına bağlı olamaz. Geri alma, kesimin ötesinde uygulanmış kayıt
   varken gelirse durum checkpoint'ten, yetki kayıtları önce olmak üzere yeniden
   kurulur (nadir olay). Kayıtları çağıran sağlar (diskteki dosyalar): motor geçmişi
   bellekte tutmaz. Checkpoint sahibin o ana kadarki kabulüdür; geç gelen geri alma
   yalnız checkpoint sonrası kayıtları etkiler. */
function rebuild(state, { owner, allBatches }) {
  const batches = [...allBatches()];
  const fresh = state.baseCheckpoint ? restore(state.baseCheckpoint) : createState();
  const isPermission = b => b.user === owner && b.ops.some(op => op.t === 'grant' || op.t === 'revoke');
  // Yetki kayıtları cihaz sırasını bozmadan önce işlenir: izin/geri alma etkisi ingest
  // başında, sıra beklemesinden bağımsız uygulanır (aşağıda).
  for (const b of batches.filter(isPermission)) ingest(fresh, b, { owner, allBatches });
  for (const b of batches.filter(b => !isPermission(b))) ingest(fresh, b, { owner, allBatches });
  Object.assign(state, fresh);
  state.rebuilds = (state.rebuilds || 0) + 1;
}

function permissionEffects(state, batch, { owner, allBatches }) {
  if (batch.user !== owner) return false;
  let needsRebuild = false;
  for (const op of batch.ops) {
    if (op.t === 'grant' && !state.grants.has(op.user)) {
      state.grants.add(op.user);
      // Kayıt yeniden denenene kadar `held` içinde KALIR: aradaki işlemler onu bilinen
      // sürüm sanıp ona dayanan kaydı önce uygulamasın (eşdeğerlik testinde yakalandı).
      for (const [key, held] of [...state.held]) if (held.user === op.user) {
        state.quarantine = state.quarantine.filter(item => item.key !== key);
        state.deferredRetry = [...(state.deferredRetry || []), held];
      }
    }
    if (op.t === 'revoke') {
      if (!state.revokes.has(op.user)) state.revokes.set(op.user, []);
      const cut = batch.deps || {};
      const cuts = state.revokes.get(op.user);
      // Aynı geri alma ikinci kez işlenirse (sıra beklemesinden dönüş) yeniden kurulum tetiklenmez.
      if (cuts.some(c => JSON.stringify(c) === JSON.stringify(cut))) continue;
      cuts.push(cut);
      for (const [device, max] of state.appliedMax.get(op.user) || []) if (Number(cut[device] || 0) < max) needsRebuild = true;
    }
  }
  return needsRebuild && Boolean(allBatches);
}

/* Bir kaydı al: tekilleştir → cihaz sırası → yetki → nedensel öncüller → uygula.
   Serbest bırakmalar iş listesiyle yürür (ters sırada gelen uzun dizide yığın taşmaz). */
function ingest(state, batch, options) {
  if (!batch || batch.owner !== options.owner || !batch.device || !Number.isInteger(batch.seq) || batch.seq < 1) return;
  if (permissionEffects(state, batch, options)) { rebuild(state, options); return; }
  let current = batch;
  while (current) {
    const key = sequenceOne(state, current, options);
    if (!key) break;
    current = state.waitingSeq.get(key) || null;
    if (current) state.waitingSeq.delete(key);
  }
  flushDeferred(state, options);
}
// Sıraya alırsa kaydın anahtarını döndürür; tekrar, sıra beklemesi ya da çatallanmada null.
function sequenceOne(state, batch, options) {
  const key = keyOf(batch);
  const dev = deviceOf(state, batch.device);
  if (batch.seq <= dev.floor) {
    // Tekrarlı teslim. Sınırdaki kayıt zincirle doğrulanır; daha eskisi doğrulanamaz
    // (bilinen sınır; cihaz tarafı yayım kapısı kapatır: publishGate). Özet yalnız sınırda hesaplanır.
    if (batch.seq === dev.floor && dev.chain && batch.chain && batch.chain !== dev.chain) flagFork(state, batch, 'same-seq-different-content');
    return null;
  }
  if (batch.seq > dev.floor + 1) {
    // Cihaz sırası: öncülü gelmeden sınır ilerlemez (alınan en yüksek seq ≠ sınır).
    const previous = `${batch.device}@${batch.seq - 1}`;
    const waiting = state.waitingSeq.get(previous);
    if (waiting && waiting !== batch && (waiting.chain && batch.chain ? waiting.chain !== batch.chain : contentText(waiting) !== contentText(batch))) flagFork(state, batch, 'same-seq-different-content');
    else if (!waiting) state.waitingSeq.set(previous, batch);
    return null;
  }
  if (batch.prevChain !== undefined && dev.floor > 0 && batch.prevChain !== dev.chain) { flagFork(state, batch, 'chain-mismatch'); return null; }
  if (dev.floor === 0) state.devices.set(batch.device, { floor: batch.seq, chain: batch.chain || '' });
  else { dev.floor = batch.seq; dev.chain = batch.chain || ''; }
  decide(state, batch, options, { key });
  return key;
}

function decide(state, batch, options, { release = true, key = keyOf(batch) } = {}) {
  const { owner } = options;
  if (state.held.size) state.held.delete(key);
  const done = () => { if (release) releaseWaiters(state, key, options); return key; };
  if (!authorized(state, batch, owner)) {
    if (state.grants.has(batch.user)) {
      // Kesin ret (geri alma sonrası): sürümleri "bilinir ama yok sayılır"; bekleyenler ilerler.
      if (state.blocked.size) state.blocked.delete(key);
      state.quarantine.push({ key, user: batch.user, reason: 'after-revoke' });
      return done();
    }
    if (state.blocked.size) state.blocked.delete(key);
    state.held.set(key, batch);
    state.quarantine.push({ key, user: batch.user, reason: 'no-grant' });
    return null;
  }
  if (batch.user !== owner) {
    if (!state.appliedMax.has(batch.user)) state.appliedMax.set(batch.user, new Map());
    const perDevice = state.appliedMax.get(batch.user);
    perDevice.set(batch.device, Math.max(perDevice.get(batch.device) || 0, batch.seq));
  }
  // Kayıt bütün olarak bekler: işlemlerinden birinin öncülü eksikse hiçbiri uygulanmaz.
  const missing = missingDeps(state, batch, key);
  if (missing.length) {
    state.blocked.set(key, batch);
    for (const dep of missing) { if (!state.waiting.has(dep)) state.waiting.set(dep, new Set()); state.waiting.get(dep).add(key); }
    return null;
  }
  if (state.blocked.size) state.blocked.delete(key);
  applyOps(state, batch, key);
  return done();
}
function releaseWaiters(state, key, options) {
  const queue = [key];
  while (queue.length) {
    const released = queue.pop();
    const waiters = state.waiting.get(released);
    if (!waiters) continue;
    state.waiting.delete(released);
    for (const waiterKey of waiters) {
      const batch = state.blocked.get(waiterKey);
      if (!batch || missingDeps(state, batch).length) continue; // başka öncül bekliyor
      const applied = decide(state, batch, options, { release: false, key: waiterKey });
      if (applied) queue.push(applied);
    }
  }
}
function flushDeferred(state, options) {
  while (state.deferredRetry && state.deferredRetry.length) {
    const list = state.deferredRetry; state.deferredRetry = [];
    for (const batch of list) decide(state, batch, options);
  }
}

/* Cihaz tarafı yayım kapısı (yedekten geri dönüş): cihaz, kendi kimliği için
   gördüğü kanıt (paylaşılan klasördeki kendi kayıtları, checkpoint sınırı) yerel
   seq'inden ilerideyse geri yüklenmiştir; yayımlamadan önce yeni cihaz kimliği
   almalı ve yayımlanmamış kayıtlarını o kimlikle yeniden numaralamalıdır.
   Kanıt okunamıyorsa (çevrimdışı) yayım bekler. */
function publishGate({ localSeq, hubMaxSeq = null, checkpointFloor = null }) {
  if (hubMaxSeq === null && checkpointFloor === null) return { ok: false, reason: 'no-evidence' };
  const evidence = Math.max(Number(hubMaxSeq || 0), Number(checkpointFloor || 0));
  return evidence > localSeq ? { ok: false, reason: 'restored-device', evidence } : { ok: true };
}

function flagFork(state, batch, reason) {
  const hash = sha(contentText(batch));
  if (state.forks.some(f => f.key === keyOf(batch) && f.hash === hash)) return;
  state.forks.push({ key: keyOf(batch), device: batch.device, seq: batch.seq, reason, hash });
  state.quarantine.push({ key: keyOf(batch), user: batch.user, reason: 'device-fork' });
}

/* Görünüm: hücre başına değer + çakışma işareti. Saat yok; birden çok baş varsa
   görüntülenecek değer sürüm kimliği özetiyle seçilir ve çakışma açık kalır. */
function view(state) {
  const rows = new Map(), conflicts = [];
  for (const [row, r] of state.rows) {
    if (r.deleted) continue;
    const fields = {}, versions = {};
    for (const [field, heads] of r.cells) {
      const ordered = [...heads].sort((a, b) => (displayKey(a.id) < displayKey(b.id) ? -1 : 1));
      fields[field] = ordered[0].value;
      versions[field] = heads.map(h => h.id);
      // Aynı değere ulaşan eşzamanlı yazımlar kullanıcıya çakışma olarak sunulmaz.
      const distinct = [...new Set(ordered.map(h => JSON.stringify(h.value)))];
      if (distinct.length > 1) conflicts.push({ row, field, values: ordered.map(h => h.value), unresolved: true });
    }
    if (r.deleteConflict || r.resurrected) conflicts.push({ row, field: '_deleted', unresolved: true });
    rows.set(row, { id: row, fields, versions });
  }
  return { rows, conflicts, pending: state.blocked.size + state.waitingSeq.size, quarantine: state.quarantine, forks: state.forks };
}

/* Kompakt checkpoint: baş sürümler + silme işaretleri + cihaz sınırları + seyrek
   istisnalar (sınır içinde uygulanmamış kayıtların KENDİSİ: budamada kaybolmasınlar).
   Budama kuralı: bir kayıt dosyası yalnız checkpoint'te seq <= floor ve istisna
   değilse silinebilir. Emekli cihazların sınırı silinmez (silinirse eski kayıtlar
   yeni sanılıp iki kez uygulanır); cihaz başına birkaç düzine bayttır. */
function snapshot(state) {
  const rows = [];
  for (const [row, r] of state.rows) rows.push([row, r.deleted ? [...r.deleted.observed] : null, [...r.cells].map(([field, heads]) => [field, heads.map(h => [h.id, h.value])]), r.resurrected ? 1 : 0, r.deleteConflict || null]);
  const body = {
    v: 3, rows,
    devices: [...state.devices].map(([device, d]) => [device, d.floor, d.chain]),
    held: [...state.held.values()], blocked: [...state.blocked.values()], waitingSeq: [...state.waitingSeq.values()],
    grants: [...state.grants], revokes: [...state.revokes], forks: state.forks,
  };
  return { ...body, sha256: sha(JSON.stringify(body)) };
}
function restore(cp) {
  const { sha256, ...body } = cp || {};
  if (!cp || body.v !== 3 || sha(JSON.stringify(body)) !== sha256) throw Object.assign(new Error('checkpoint corrupt or incomplete'), { code: 'CHECKPOINT_CORRUPT' });
  const state = createState();
  state.baseCheckpoint = cp;
  for (const [row, deleted, cells, resurrected, deleteConflict] of body.rows) {
    const r = { deleted: deleted ? { observed: new Set(deleted) } : null, cells: new Map() };
    for (const [field, heads] of cells) r.cells.set(field, heads.map(([id, value]) => ({ id, value })));
    if (resurrected) r.resurrected = true;
    if (deleteConflict) r.deleteConflict = deleteConflict;
    state.rows.set(row, r);
  }
  for (const [device, floor, chain] of body.devices) state.devices.set(device, { floor, chain });
  for (const u of body.grants) state.grants.add(u);
  for (const [u, cuts] of body.revokes) state.revokes.set(u, cuts);
  state.forks = [...body.forks];
  for (const b of body.held) { state.held.set(keyOf(b), b); state.quarantine.push({ key: keyOf(b), user: b.user, reason: 'no-grant' }); }
  for (const f of body.forks) state.quarantine.push({ key: f.key, user: null, reason: 'device-fork' });
  for (const b of body.blocked) state.blocked.set(keyOf(b), b);
  for (const b of body.blocked) {
    for (const dep of missingDeps(state, b)) { if (!state.waiting.has(dep)) state.waiting.set(dep, new Set()); state.waiting.get(dep).add(keyOf(b)); }
  }
  for (const b of body.waitingSeq) state.waitingSeq.set(`${b.device}@${b.seq - 1}`, b);
  return state;
}

module.exports = { createState, ingest, view, snapshot, restore, rebuild, publishGate, keyOf, chainNext };

/* Budama kuralı: kayıt dosyası yalnız checkpoint onu sınır içinde ve istisna dışında
   tutuyorsa silinebilir (uygulanmış ya da kesin reddedilmiş). */
function canPrune(cp, batch) {
  const entry = (cp.devices || []).find(([device]) => device === batch.device);
  if (!entry || batch.seq > entry[1]) return false;
  const key = keyOf(batch);
  return ![...cp.held, ...cp.blocked].some(b => keyOf(b) === key);
}
module.exports.canPrune = canPrune;
