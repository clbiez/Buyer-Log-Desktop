'use strict';
/* Test raporu deposu (anahtar = talep no, metin).
   - reports : talepNo → birleştirilmiş rapor (test-report-engine şeması)
   - links   : talepNo → { orderKey, itemId, targets: [...] } — her sipariş
               kendi checklist adımı ve eklerini taşır. Üst alanlar eski tek
               hedefli kaydın uyumlu ana bağlantısıdır; siblings korunur.
   - typeMap : talep tipi anahtarı → checklist adımı (kullanıcının seçimi)
   - events  : değişiklik izi (kaynak dosya, talep no, onaylayan kullanıcı)
   Rapor iş verisi değil kanıttır; checklist cevabı ayrıca kullanıcı onayıyla
   checklist-supplier-store'a yazılır. */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../../user-data');
const { withFileLeaseSync } = require('../shared-file-transaction');
const Engine = require('../../../public/test-report-engine.js');

const FILE = path.join(SERVER_DATA_ROOT, 'test-reports.json');
const RECOVERY_FILE = path.join(SERVER_DATA_ROOT, 'test-reports.last-good.json');
const SCHEMA_VERSION = 1;
const MAX_REPORTS = 100000;
const MAX_EVENTS = 20000;

function text(value, max = 500) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max); }
function emptyStore() { return { schemaVersion: SCHEMA_VERSION, revision: 0, updatedAt: '', reports: {}, links: {}, typeMap: {}, events: [] }; }
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function read() {
  const parse = filename => {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!isObject(value) || !isObject(value.reports)) throw new Error('Invalid test report store structure.');
    return value;
  };
  if (!fs.existsSync(FILE) && !fs.existsSync(RECOVERY_FILE)) return emptyStore();
  let raw;
  try { raw = parse(FILE); }
  catch (error) {
    try { raw = parse(RECOVERY_FILE); }
    catch (_) { throw Object.assign(new Error('Test report storage is unreadable; existing data was preserved.'), { code: 'TEST_REPORT_STORE_UNREADABLE', statusCode: 503, cause: error }); }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Number(raw.revision) || 0,
    updatedAt: text(raw.updatedAt, 80),
    reports: raw.reports,
    links: isObject(raw.links) ? raw.links : {},
    typeMap: isObject(raw.typeMap) ? raw.typeMap : {},
    events: Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [],
  };
}
function write(store) {
  if (Object.keys(store.reports).length > MAX_REPORTS) throw Object.assign(new Error('Test report capacity reached; existing records were preserved.'), { code: 'TEST_REPORT_CAPACITY', statusCode: 507 });
  store.revision += 1;
  store.updatedAt = new Date().toISOString();
  if (store.events.length > MAX_EVENTS) store.events = store.events.slice(-MAX_EVENTS);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  atomicWriteJson(RECOVERY_FILE, store);
  atomicWriteJson(FILE, store);
}

function publicPayload(allowedOrderKeys) {
  const store = read();
  const payload = { revision: store.revision, updatedAt: store.updatedAt, reports: store.reports, links: store.links, typeMap: store.typeMap };
  if (!allowedOrderKeys) return payload;
  payload.links = Object.fromEntries(Object.entries(payload.links).flatMap(([id, link]) => {
    const targets = Engine.reportLinks(link).filter(target => allowedOrderKeys.has(target.orderKey));
    return targets.length ? [[id, { ...targets[0], targets }]] : [];
  }));
  payload.reports = Object.fromEntries(Object.entries(payload.links).map(([id, link]) => [id, {
    ...store.reports[id],
    ...(store.reports[id].aiAssessment ? {aiAssessment: allowedOrderKeys.has(store.reports[id].aiAssessment.orderKey) ? store.reports[id].aiAssessment : null} : {}),
    ...(store.reports[id].aiAssessments ? {aiAssessments: store.reports[id].aiAssessments.filter(review=>allowedOrderKeys.has(review.orderKey))} : {}),
    dosyalar: [...new Map(Engine.reportLinks(link).flatMap(target => target.files || store.reports[id].dosyalar || []).map(file => [file.attachmentId || file.hash, file])).values()],
  }]));
  return payload;
}

/* Satır + adım başına rapor grupları ve kullanıcıdan beklenen işler
   ("Buyingden dönüş bekleniyor"). CP hücresi bunu öne çıkarır. */
function groupsOf(store) {
  const groups = new Map();
  for (const [talepNo, storedLink] of Object.entries(store.links)) {
    for (const link of Engine.reportLinks(storedLink)) {
      const report = store.reports[talepNo];
      if (!report) continue;
      const key = link.orderKey + '::' + link.itemId;
      if (!groups.has(key)) groups.set(key, { orderKey: link.orderKey, itemId: link.itemId, reports: [] });
      groups.get(key).reports.push(report);
    }
  }
  return [...groups.values()];
}
function tasks() {
  const out = [];
  for (const group of groupsOf(read())) {
    const step = Engine.deriveStepStatus(group.reports);
    for (const task of step.tasks) out.push({ orderKey: group.orderKey, itemId: group.itemId, ...task });
  }
  return out;
}

function actorInfo(actor) {
  return { id: text(actor && actor.id, 160), name: text(actor && (actor.displayName || actor.username || actor.name), 200) };
}

/* Kullanıcının onayladığı önizleme kalemlerini yazar.
   items: [{ report, orderKey, itemId }]  (report sunucunun kendi ayrıştırması)
   attach(fileEntry, report, item) → checklist eki meta | null
   Aynı karar ikinci kez gelirse yeni karar sayılmaz (decisionKey). */
function commit(items, typeMap, actor, attach, options = {}) {
  const who = actorInfo(actor);
  return withFileLeaseSync(FILE, () => {
    options.assertAuthority?.();
    const store = read();
    if (options.authorizedOrderKeys && items.some(item => Engine.reportLinks(store.links[item.report.talepNo]).some(link => !options.authorizedOrderKeys.has(link.orderKey)))) {
      throw Object.assign(new Error('All linked orders require write access.'), { code: 'TEST_REPORT_SHARED_SCOPE_FORBIDDEN', statusCode: 403 });
    }
    if (options.expectedRevision != null && store.revision !== options.expectedRevision) throw Object.assign(new Error('Test report revision changed.'), { code:'TEST_REPORT_REVISION_CONFLICT', statusCode:409 });
    const at = new Date().toISOString();
    const results = [];
    for (const item of items) {
      const incoming = item.report;
      const talepNo = Engine.normalizeTalepNo(incoming && incoming.talepNo) || (incoming && incoming.aiAssessment ? require('../../../public/test-report-assessment').identifier(incoming.talepNo) : '');
      const orderKey = text(item.orderKey, 300);
      const itemId = text(item.itemId, 160);
      if (!talepNo || !orderKey || !itemId) continue;
      const previous = store.reports[talepNo] || null;
      const knownDecisions = new Set((previous && previous.kararlar || []).map(d => Engine.decisionKey(d, talepNo)));
      const previousLinks = Engine.reportLinks(store.links[talepNo]);
      // v7.0.290 — Takım (set) siparişinde aynı rapor aynı adımın birden çok
      // parçasına (A, B …) bağlanabilir; bu hedefler yan yana durur. Diğer
      // durumlarda sipariş başına tek hedef kuralı korunur (yeniden eşleme).
      const partOf = id => /^(.*)~part~([A-Z])$/.exec(String(id || ''));
      const coexists = link => { const a = partOf(link.itemId), b = partOf(itemId); return Boolean(a && b && a[1] === b[1] && a[2] !== b[2]); };
      const replaces = link => link.orderKey === orderKey && !coexists(link);
      const previousTarget = previousLinks.find(replaces);
      const knownFiles = new Map((previousTarget && (previousTarget.files || (previous && previous.dosyalar)) || []).map(f => [Engine.fileKey(f), f]));
      const newDecisions = (incoming.kararlar || []).filter(d => !knownDecisions.has(Engine.decisionKey(d, talepNo))).length;
      const attachments = [];
      const files = [];
      for (const file of incoming.dosyalar || []) {
        const existing = knownFiles.get(Engine.fileKey(file));
        if (existing && existing.attachmentId) { files.push(existing); continue; }
        const meta = typeof attach === 'function' ? attach(file, incoming, item) : null;
        const clean = { ad: text(file.ad, 300), tur: text(file.tur, 20), boyut: Number(file.boyut) || 0, hash: text(file.hash, 80) };
        if (meta) { clean.attachmentId = meta.id; attachments.push(meta); }
        files.push(clean);
      }
      const merged = Engine.mergeReports(previous, { ...incoming, dosyalar: files });
      delete merged.kaynakDosya;
      merged.guncelleme = at;
      store.reports[talepNo] = merged;
      const target = { orderKey, itemId, at, by: who.name || who.id, byId: who.id, ...(item.review ? { review: item.review } : {}), files: [...new Map([...knownFiles.values(), ...files].map(f => [Engine.fileKey(f), f])).values()] };
      const targets = [];
      for (const link of previousLinks) {
        if (!replaces(link)) targets.push(link);
        else if (!targets.includes(target)) targets.push(target);
      }
      if (!previousTarget) targets.push(target);
      // Keep the legacy primary fields while preserving all approved targets.
      store.links[talepNo] = { ...targets[0], targets };
      store.events.push({
        type: 'test-report-import', at, talepNo, orderKey, itemId,
        by: who.name || who.id, byId: who.id,
        sourceFiles: (incoming.dosyalar || []).map(f => text(f.ad, 300)),
        sources: (incoming.kaynaklar || []).slice(0, 10),
        newDecisions, newAttachments: attachments.map(a => a.id),
        ...(item.review ? {review: item.review} : {}),
      });
      results.push({ talepNo, orderKey, itemId, report: merged, attachments, newDecisions, decisionsSkipped: (incoming.kararlar || []).length - newDecisions });
    }
    for (const [key, value] of Object.entries(typeMap || {})) {
      const typeKey = text(key, 200), itemId = text(value, 160);
      if (typeKey && itemId) store.typeMap[typeKey] = { itemId, at, by: who.name || who.id };
    }
    options.assertAuthority?.();write(store);
    return { ok: true, revision: store.revision, results, typeMap: store.typeMap };
  });
}

function restore(receipt, actor, options = {}) {
  return withFileLeaseSync(FILE, () => {
    const applyInverse = () => {
    options.assertAuthority?.();
    const current = read();
    if (current.revision !== receipt.expectedRevision) throw Object.assign(new Error('Test report revision changed.'), { code:'TEST_REPORT_REVISION_CONFLICT', statusCode:409 });
    for (const [id, previous] of Object.entries(receipt.records)) {
      if (previous.report == null) delete current.reports[id]; else current.reports[id] = previous.report;
      if (previous.link == null) delete current.links[id]; else current.links[id] = previous.link;
    }
    current.events.push({type:'agent-report-undo', at:new Date().toISOString(), by:actorInfo(actor), talepNos:Object.keys(receipt.records)});
    options.assertAuthority?.();write(current);
    return {verified:true, revision:current.revision};
    };
    return options.withDependencies ? options.withDependencies(applyInverse) : applyInverse();
  });
}
module.exports = { FILE, SCHEMA_VERSION, read: () => read(), publicPayload, commit, restore, tasks };
