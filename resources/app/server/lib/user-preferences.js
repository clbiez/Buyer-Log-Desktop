'use strict';

/* KULLANICI TERCİHLERİ / PERSONAL WORKSPACE — SUNUCU TARAFI (v7.01)

   Not Defteri, mail şablonları ve benzeri kişisel veriler bugüne kadar yalnız
   tarayıcının localStorage'ında duruyordu. localStorage TARAYICIYA özeldir:
   Edge'de yazılan not Chrome'da görünmez, tarayıcı verisi temizlenince ya da
   makine değişince tamamen kaybolur.

   Burada gerçek kullanıcı kimliğine bağlı, sunucuda duran tek bir depo var.
   v7.01 ile filtre, görünüm, kolon ve Horizon tercihleri de aynı depoya
   bağlanır. Operasyonel kayıtlar (Collection satırları/notları, CP revizyonu),
   parola ve oturum verisi bu whitelist'e özellikle dahil edilmez.

   Çakışma çözümü zaman damgasına göredir: aynı anahtarın en son yazılan
   sürümü kazanır. İki tarayıcıda aynı anda not yazmak nadir olduğu için bu
   yeterli; kaybı önlemek adına yazma her zaman TAM değeri gönderir. */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const modelScopes = require('./model-scopes');

const ROOT = path.join(SERVER_DATA_ROOT, 'user-preferences');
const MAX_VALUE_BYTES = 2 * 1024 * 1024;   // tek anahtar
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;   // kullanıcı başına

const WORKSPACE_HORIZON_PREFIX = 'buyerlog.workspace.horizon.';
// Applied Horizon is derived from the last successful refresh. It is persisted
// for restart consistency, but is intentionally not part of profile/workspace
// copying because it describes the data snapshot on this device.
const APPLIED_HORIZON_PREFIX = 'buyerlog.workspace.applied-horizon.';

// Kopyalama ve reset işlemleri bu kategoriler üzerinden çalışır. Aynı anahtar
// birden fazla kategoriye girmez; böylece REPLACE yalnız seçilen alanı siler.
const WORKSPACE_CATEGORY_PREFIXES = Object.freeze({
  horizon: Object.freeze([WORKSPACE_HORIZON_PREFIX]),
  filters: Object.freeze([
    'lcw.corePageFilters.', 'lcw.cp.dimFilters.', 'lcw.orders.dimFilters.',
    'lcw.overview.dimFilters.', 'lcw.overview.bgDimFilters.',
    'lcw.backlog.autoState.', 'lcw.lfl.filters.', 'lcw.lfl.readyFilters.',
    'lcw.lfl.customCompare.', 'lcw.lfl.analysisSplit.', 'lcw.koleksiyon.scope.',
    'lcw.koleksiyon.analytics.', 'lcw.oab.', 'lcw.intake.', 'lcw_filter_favorite_',
    'bl.autoRefresh.',
    // Global Flow Map kaynak, görünüm, çoklu filtre ve hızlı filtre seti.
    'buyerlog.overview.globalFlow.',
  ]),
  columns: Object.freeze([
    'lcw.table.columnState.', 'lcw.freeze.', 'lcw.backlog.columnWidths.',
    'lcw.quotations.columnWidths.', 'lcw.koleksiyon.colState.',
    'lcw.koleksiyon.pricingExcelColumns.', 'bl.backlog.excelColumns.',
    'bl.detailTables.showImages.', 'lcw.cp.imageSize.',
    // v7.28 — hesaplanan (formül) sütun tanımları. "columns" kategorisinde
    // olduğu için Profil Kopyalama panelinden başka kullanıcıya aktarılabilir.
    'bl.formulaColumns.',
    // Sayfa bazlı Focus / Extended sütun ön ayarları. İstemci bu anahtarı
    // hesaba bağlı senkron listesinde tutuyordu ama sunucu whitelist'inde
    // yoktu; yazma 'not-synced' diye reddediliyor, ön ayar makineye kalıyordu.
    'lcw.tableViewFocus.',
    // v7.0.229 — Alanlar: ana başlık bazında Tümü / Gizli katmanı (presetten bağımsız).
    'lcw.tableGroupOverrides.',
  ]),
  views: Object.freeze(['lcw_view_favorite_']),
  // v7.221 — kişisel CP öncelik kuralları ve checklist soruları. Kullanıcıya
  // aittir; Ön Ayar Paylaşımı / Profil Kopyalama ile başkasına aktarılabilir.
  rules: Object.freeze(['lcw.cp.rules.']),
  dashboard: Object.freeze(['buyerlog.dashboard.', 'lcw.dashboard.']),
  favorites: Object.freeze(['buyerlog.favorites.', 'lcw.favorites.']),
  appearance: Object.freeze([
    'lcw_theme', 'lcw_rail', 'lcw_sidebar_collapsed', 'lcw.lang.',
    'lcw.font.', 'lcw_font_step', 'buyerlog.overview.notesReminderCollapsed', 'bl.refreshHistory.',
  ]),
});

const WORKSPACE_CATEGORIES = Object.freeze(Object.keys(WORKSPACE_CATEGORY_PREFIXES));

// Tarayıcılar arasında taşınacak anahtar önekleri. Kişisel çalışma alanı
// anahtarları kullanıcı değiştirince sunucudan hydrate edilir; bu depo tek
// source of truth'tur, localStorage yalnız çevrimdışı/başlangıç önbelleğidir.
const SYNCED_PREFIXES = Object.freeze([
  'lcw.todo.',            // Not Defteri — asıl istek
  'lcw.notifications.',   // kullanıcının bildirim geçmişi
  'lcw.mailTemplates.',   // mail şablonları
  'lcw.prodstatus.mails.',
  // Already owner-scoped/synchronized by BLStorage; the server must retain
  // the same CP context used by the UI and deterministic agent previews.
  'lcw.cp.assistant.',
  'lcw.cp.checklist.',
  'lcw_view_favorite_',   // kayıtlı görünümler
  'lcw_filter_favorite_', // kayıtlı filtreler
  ...Object.values(WORKSPACE_CATEGORY_PREFIXES).flat(),
  APPLIED_HORIZON_PREFIX,
]);

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'anonymous';
}
function prefsFile(userId) { return path.join(ROOT, `${safeId(userId)}.json`); }
function isSyncedKey(key) {
  const text = String(key || '');
  return SYNCED_PREFIXES.some(prefix => text.indexOf(prefix) === 0);
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function categoryForKey(key) {
  const text = String(key || '');
  for (const [category, prefixes] of Object.entries(WORKSPACE_CATEGORY_PREFIXES)) {
    if (prefixes.some(prefix => text.indexOf(prefix) === 0)) return category;
  }
  return null;
}
function normalizeCategories(value) {
  const source = Array.isArray(value) ? value : Object.entries(value || {}).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name);
  return [...new Set(source.map(item => String(item || '').toLowerCase()).filter(item => WORKSPACE_CATEGORIES.includes(item)))];
}
function horizonKey(moduleName) {
  const module = String(moduleName || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'default';
  return `${WORKSPACE_HORIZON_PREFIX}${module}.v1`;
}
function appliedHorizonKey(moduleName) {
  const module = String(moduleName || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'default';
  return `${APPLIED_HORIZON_PREFIX}${module}.v1`;
}

/* AÇIKÇA SİLİNMİŞ ANAHTAR (mezar taşı).

   Kayıtta üç durum ayırt edilmelidir: (1) anahtar hiç yazılmamış,
   (2) anahtar var, (3) anahtar KULLANICI TARAFINDAN SİLİNMİŞ. Eskiden (1) ve
   (3) diskte aynı görünüyordu: silinen kayıt yalnız yok oluyordu. Tarayıcıdaki
   yerel kopya bir sonraki açılışta "sunucuda yok, bende var" diyerek onu geri
   gönderiyor ve silinen kişisel Horizon diriliyordu.

   Silme artık zaman damgasıyla kaydedilir. Aynı anahtara DAHA YENİ bir yazma
   gelirse mezar taşı kalkar — kullanıcı yeni bir kişisel katman kaydedebilir.
   Daha eski bir yazma (bayat tarayıcı kopyası) reddedilir. */
const MAX_DELETIONS = 500;

function normalizeDeletions(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, at] of Object.entries(source)) {
    if (!isSyncedKey(key)) continue;
    const stamp = String(at || '');
    if (stamp) out[key] = stamp;
  }
  return out;
}

// Mezar taşı sonsuza kadar birikmesin: en yeni MAX_DELETIONS kaydı tutulur.
function capDeletions(deletions) {
  const keys = Object.keys(deletions);
  if (keys.length <= MAX_DELETIONS) return deletions;
  const kept = keys.sort((a, b) => String(deletions[b]).localeCompare(String(deletions[a]))).slice(0, MAX_DELETIONS);
  return Object.fromEntries(kept.map(key => [key, deletions[key]]));
}

function load(userId) {
  const file = prefsFile(userId);
  return readJsonWithValidatedBackup(file, {
    fallback: () => ({ userId: String(userId || ''), entries: {}, deletions: {}, _updatedAt: '' }),
    normalize: raw => {
      const entries = raw && typeof raw.entries === 'object' && raw.entries ? raw.entries : {};
      const clean = {};
      for (const [key, entry] of Object.entries(entries)) {
        if (!isSyncedKey(key) || !entry || typeof entry !== 'object') continue;
        clean[key] = { value: String(entry.value == null ? '' : entry.value), updatedAt: String(entry.updatedAt || '') };
      }
      const deletions = normalizeDeletions(raw && raw.deletions);
      // Kayıt geri yazıldıysa mezar taşı anlamını yitirmiştir; kendiliğinden temizlenir.
      for (const [key, stamp] of Object.entries(deletions)) {
        const entry = clean[key];
        if (entry && entry.updatedAt && entry.updatedAt > stamp) delete deletions[key];
      }
      const _horizonRevisions=Object.fromEntries(Object.entries(raw?._horizonRevisions||{}).filter(([key,value])=>key.startsWith(WORKSPACE_HORIZON_PREFIX)&&Number.isSafeInteger(value)&&value>=0));
      return { userId: String(userId || ''), entries: clean, deletions, _updatedAt: String(raw && raw._updatedAt || ''), _horizonRevisions };
    },
    restore: value => atomicWriteJson(file, value),
  });
}
// Horizon generations are server-owned and survive removal and workspace restore.
// Every native preference writer includes them in its existing single atomic save.
function persistPreferences(userId,saved,current){
  const versions={...(current._horizonRevisions||{})},keys=new Set([...Object.keys(current.entries),...Object.keys(current.deletions),...Object.keys(saved.entries),...Object.keys(saved.deletions)]);
  for(const key of keys)if(key.startsWith(WORKSPACE_HORIZON_PREFIX)&&JSON.stringify([current.entries[key]||null,current.deletions[key]||null])!==JSON.stringify([saved.entries[key]||null,saved.deletions[key]||null]))versions[key]=(versions[key]||0)+1;
  saved._horizonRevisions=versions;atomicWriteJson(prefsFile(userId),saved);
}

function totalBytes(entries) {
  return Object.values(entries).reduce((sum, entry) => sum + Buffer.byteLength(entry.value || '', 'utf8'), 0);
}

/**
 * Gelen anahtarları birleştirir. Aynı anahtarda GELEN daha eskiyse yazılmaz —
 * böylece geç açılan bir tarayıcının bayat kopyası yenisini ezmez.
 */
function merge(userId, incoming) {
  const current = load(userId);
  const entries = { ...current.entries };
  const deletions = { ...current.deletions };
  const now = new Date().toISOString();
  const rejected = [];
  for (const [key, raw] of Object.entries(incoming || {})) {
    if (!isSyncedKey(key)) { rejected.push({ key, reason: 'not-synced' }); continue; }
    const item = raw && typeof raw === 'object' ? raw : { value: raw };
    const value = String(item.value == null ? '' : item.value);
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) { rejected.push({ key, reason: 'too-large' }); continue; }
    const updatedAt = String(item.updatedAt || now);
    const existing = entries[key];
    if (existing && existing.updatedAt && updatedAt < existing.updatedAt) { rejected.push({ key, reason: 'stale' }); continue; }
    /* SİLİNMİŞ ANAHTARI BAYAT KOPYA DİRİLTEMEZ. Kullanıcı kaydı sildikten
       SONRA yazılmış bir değer (yeni kişisel katman) mezar taşını kaldırır;
       silmeden ÖNCEKİ bir kopya reddedilir. */
    const tombstone = deletions[key];
    if (tombstone && updatedAt <= tombstone) { rejected.push({ key, reason: 'deleted' }); continue; }
    delete deletions[key];
    entries[key] = { value, updatedAt };
  }
  if (totalBytes(entries) > MAX_TOTAL_BYTES) {
    const error = new Error('Kişisel veri sınırı aşıldı.');
    error.statusCode = 413; error.code = 'USER_PREFS_TOO_LARGE';
    throw error;
  }
  fs.mkdirSync(ROOT, { recursive: true });
  const saved = { userId: String(userId || ''), entries, deletions: capDeletions(deletions), _updatedAt: now };
  persistPreferences(userId,saved,current);
  return { ...saved, rejected };
}

/* Anahtarı siler ve silmeyi KAYIT ALTINA ALIR (bkz. mezar taşı notu).
   `options.tombstone === false` yalnız bakım/taşıma amaçlı sessiz temizlik
   içindir; kullanıcının açık silme eylemleri her zaman iz bırakır. */
function removeKeys(userId, keys, options = {}) {
  const current = load(userId);
  const entries = { ...current.entries };
  const deletions = { ...current.deletions };
  const now = new Date().toISOString();
  const tombstone = options.tombstone !== false;
  (Array.isArray(keys) ? keys : []).forEach(key => {
    const name = String(key);
    delete entries[name];
    if (tombstone && isSyncedKey(name)) deletions[name] = now;
  });
  fs.mkdirSync(ROOT, { recursive: true });
  const saved = { userId: String(userId || ''), entries, deletions: capDeletions(deletions), _updatedAt: now };
  persistPreferences(userId,saved,current);
  return saved;
}


/* Kişisel backup restore bir MERGE değildir: backup, kullanıcının o andaki
   kişisel çalışma alanının snapshot'ıdır. Bu yüzden yalnız whitelist'teki
   senkron anahtarları kabul edip mevcut kişisel kaydı atomik olarak değiştirir.
   Restore anı yeni zaman damgası olur; açık kalmış eski bir tarayıcı sekmesi
   backup'tan daha eski değerleri sonradan geri itemez. */
function restoreSnapshot(userId, snapshot) {
  const current=load(userId);
  const raw = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const now = new Date().toISOString(), entries = {}, rejected = [];
  for (const [key, itemRaw] of Object.entries(raw.entries && typeof raw.entries === 'object' ? raw.entries : {})) {
    if (!isSyncedKey(key)) { rejected.push({ key, reason: 'not-synced' }); continue; }
    const item = itemRaw && typeof itemRaw === 'object' ? itemRaw : { value: itemRaw };
    const value = String(item.value == null ? '' : item.value);
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) { rejected.push({ key, reason: 'too-large' }); continue; }
    entries[key] = { value, updatedAt: now };
  }
  if (totalBytes(entries) > MAX_TOTAL_BYTES) {
    const error = new Error('Kişisel restore veri sınırı aşıldı.');
    error.statusCode = 413; error.code = 'USER_PREFS_TOO_LARGE'; throw error;
  }
  const deletions = {};
  for (const key of Object.keys(raw.deletions && typeof raw.deletions === 'object' ? raw.deletions : {})) {
    if (isSyncedKey(key) && !entries[key]) deletions[key] = now;
  }
  fs.mkdirSync(ROOT, { recursive: true });
  const saved = { userId: String(userId || ''), entries, deletions: capDeletions(deletions), _updatedAt: now };
  persistPreferences(userId,saved,current);
  return { ...saved, rejected };
}

/* Seçili anahtarları TEK atomik yazmayla uygular: `set` değerleri kopyalama
   anının zaman damgasıyla yazılır (snapshot semantiği, bkz.
   replaceWorkspaceEntries), `remove` anahtarları mezar taşıyla kaldırılır.
   Ön Ayar Paylaşımı ve onun geri alma yolu bu fonksiyonu kullanır. */
function applyEntryChanges(userId, set = {}, remove = [], options = {}) {
  options.assertAuthority?.();
  const current = load(userId), entries = { ...current.entries };
  for (const [key, expected] of Object.entries(options.expectedEntries || {})) {
    if (JSON.stringify(current.entries[key] || null) !== JSON.stringify(expected)) {
      throw Object.assign(new Error('OFFICE_PREVIEW_CHANGED'), { code:'OFFICE_PREVIEW_CHANGED', statusCode:409 });
    }
  }
  for(const [key,expected]of Object.entries(options.expectedHorizonRevisions||{}))if((current._horizonRevisions?.[key]||0)!==expected)throw Object.assign(new Error('OFFICE_PREVIEW_CHANGED'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});
  for(const [key,expected]of Object.entries(options.expectedDeletions||{}))if((current.deletions[key]||null)!==expected)throw Object.assign(new Error('OFFICE_PREVIEW_CHANGED'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});
  const deletions = { ...current.deletions };
  const now = new Date().toISOString(), rejected = [];
  for (const key of Array.isArray(remove) ? remove : []) {
    const name = String(key);
    if (!isSyncedKey(name)) continue;
    delete entries[name];
    deletions[name] = now;
  }
  for (const [key, raw] of Object.entries(set || {})) {
    if (!isSyncedKey(key)) { rejected.push({ key, reason: 'not-synced' }); continue; }
    const value = String(raw == null ? '' : raw);
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) { rejected.push({ key, reason: 'too-large' }); continue; }
    entries[key] = { value, updatedAt: now };
    delete deletions[key];
  }
  if (totalBytes(entries) > MAX_TOTAL_BYTES) {
    const error = new Error('Kişisel veri sınırı aşıldı.');
    error.statusCode = 413; error.code = 'USER_PREFS_TOO_LARGE'; throw error;
  }
  fs.mkdirSync(ROOT, { recursive: true });
  const saved = { userId: String(userId || ''), entries, deletions: capDeletions(deletions), _updatedAt: now };
  options.assertAuthority?.();persistPreferences(userId,saved,current);
  return { ...saved, rejected };
}

function workspaceEntries(userId, categories = WORKSPACE_CATEGORIES) {
  const wanted = new Set(normalizeCategories(categories));
  const entries = load(userId).entries;
  return Object.fromEntries(Object.entries(entries).filter(([key]) => wanted.has(categoryForKey(key))));
}

function normalizeWorkspaceEntryMap(incoming, categories = WORKSPACE_CATEGORIES) {
  const wanted = new Set(normalizeCategories(categories)), out = {};
  for (const [key, raw] of Object.entries(incoming || {})) {
    if (!wanted.has(categoryForKey(key))) continue;
    const item = raw && typeof raw === 'object' ? raw : { value: raw };
    const value = String(item.value == null ? '' : item.value);
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) continue;
    out[key] = { value, updatedAt: String(item.updatedAt || '') };
  }
  return out;
}

function effectiveWorkspaceEntries(userId, roleEntries, categories = WORKSPACE_CATEGORIES) {
  const inherited = normalizeWorkspaceEntryMap(roleEntries, categories);
  const personal = workspaceEntries(userId, categories);
  return { entries: { ...inherited, ...personal }, personal, inherited };
}

function replaceWorkspaceEntries(userId, incoming, categories, mode = 'MERGE') {
  const wanted = new Set(normalizeCategories(categories));
  if (!wanted.size) return { ...load(userId), rejected: [] };
  const current = load(userId), entries = { ...current.entries };
  const deletions = { ...current.deletions };
  const now = new Date().toISOString(), rejected = [];
  if (String(mode || '').toUpperCase() === 'REPLACE') {
    // REPLACE, hedefteki kaydı KALDIRIR; iz bırakmasaydı hedef kullanıcının
    // tarayıcısındaki yerel kopya onu ilk açılışta geri gönderirdi.
    for (const key of Object.keys(entries)) {
      if (!wanted.has(categoryForKey(key))) continue;
      delete entries[key];
      deletions[key] = now;
    }
  }
  for (const [key, raw] of Object.entries(incoming || {})) {
    const category = categoryForKey(key);
    if (!category || !wanted.has(category)) { rejected.push({ key, reason: 'category-not-selected' }); continue; }
    const item = raw && typeof raw === 'object' ? raw : { value: raw };
    const value = String(item.value == null ? '' : item.value);
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) { rejected.push({ key, reason: 'too-large' }); continue; }
    // Profil kopyalama bir snapshot'tır. Kaynağın eski zaman damgasını hedefe
    // taşımak yerine kopyalama anını yazarız; aksi halde hedefteki yeni kayıt
    // last-write-wins kontrolünde snapshot'ı yanlışlıkla reddederdi.
    entries[key] = { value, updatedAt: now };
    delete deletions[key];
  }
  if (totalBytes(entries) > MAX_TOTAL_BYTES) {
    const error = new Error('Kişisel çalışma alanı veri sınırı aşıldı.');
    error.statusCode = 413; error.code = 'USER_WORKSPACE_TOO_LARGE'; throw error;
  }
  fs.mkdirSync(ROOT, { recursive: true });
  const saved = { userId: String(userId || ''), entries, deletions: capDeletions(deletions), _updatedAt: now };
  persistPreferences(userId,saved,current);
  return { ...saved, rejected };
}

function copyWorkspaceSnapshot(sourceUserId, targetUserId, categories, mode = 'MERGE') {
  const selected = normalizeCategories(categories);
  return replaceWorkspaceEntries(targetUserId, workspaceEntries(sourceUserId, selected), selected, mode);
}

function copyWorkspaceEntrySnapshot(sourceEntries, targetUserId, categories, mode = 'MERGE') {
  const selected = normalizeCategories(categories);
  return replaceWorkspaceEntries(targetUserId, normalizeWorkspaceEntryMap(sourceEntries, selected), selected, mode);
}

function parseStoredJson(entry) {
  if (!entry || entry.value == null || entry.value === '') return null;
  try { const parsed = JSON.parse(entry.value); return parsed && typeof parsed === 'object' ? parsed : null; }
  catch (_) { return null; }
}

function getHorizon(userId, moduleName) {
  const entries = load(userId).entries;
  return clone(parseStoredJson(entries[horizonKey(moduleName)]));
}

/* v7.81 — getHorizonGroups / saveHorizonGroups KALDIRILDI.
   Adlandırılmış Horizon grupları artık yok; okuyan da yazan da kalmadı.
   Diskteki eski "groups" kaydına dokunulmaz. */

function saveHorizonState(userId, key, moduleName, horizon, context = {}) {
  const now = new Date().toISOString();
  const value=buildHorizonValue(getStoredHorizon(userId,key),horizon,context);
  return merge(userId, { [key]: { value: JSON.stringify(value), updatedAt: now } });
}
function buildHorizonValue(current,horizon,context={}){
  let value = horizon && typeof horizon === 'object' ? clone(horizon) : {};
  /* v7.81 — linkedGroupId ARTIK YAZILMAZ. Horizon grupları kaldırıldı; alanı
     yazmaya devam etmek, hiçbir şeyin okumadığı bir işaret bırakmak olurdu.
     Eski kayıtlardaki alan olduğu gibi durur ve zararsızdır (okunmaz). */
  const connectionId = String(context.connectionId || '').trim();
  if (connectionId) {
    const bundle = current && current.byConnection ? clone(current) : { version: 1, byConnection: {} };
    Object.defineProperty(bundle.byConnection,connectionId,{value,enumerable:true,writable:true,configurable:true});
    if (context.role) {
      bundle.connectionRoles = bundle.connectionRoles || {};
      Object.defineProperty(bundle.connectionRoles,connectionId,{value:String(context.role),enumerable:true,writable:true,configurable:true});
    }
    value = bundle;
  }
  return value;
}
function horizonEntrySnapshot(store,keys){return {entries:Object.fromEntries(keys.map(key=>[key,store.entries[key]||null])),deletions:Object.fromEntries(keys.map(key=>[key,store.deletions[key]||null])),revisions:Object.fromEntries(keys.map(key=>[key,store._horizonRevisions?.[key]||0]))};}
function planHorizonEntries(store,modules,horizon,context={}){
  const entries={};for(const moduleName of [...new Set(modules)]){const key=horizonKey(moduleName),value=JSON.stringify(buildHorizonValue(parseStoredJson(store.entries[key]),horizon,context));if(Buffer.byteLength(value)>MAX_VALUE_BYTES)throw Object.assign(new Error('USER_PREFS_TOO_LARGE'),{code:'USER_PREFS_TOO_LARGE',statusCode:413});entries[key]=value;}return entries;
}
function saveHorizons(userId,modules,horizon,context={},options={}){
  const current=load(userId),set=planHorizonEntries(current,modules,horizon,context),saved=applyEntryChanges(userId,set,[],options);
  if(saved.rejected.length||Object.entries(set).some(([key,value])=>saved.entries[key]?.value!==value))throw Object.assign(new Error('OFFICE_RESOURCE_VERIFY_FAILED'),{code:'OFFICE_RESOURCE_VERIFY_FAILED',statusCode:409});
  return saved;
}

function getStoredHorizon(userId, key) {
  const entries = load(userId).entries;
  return clone(parseStoredJson(entries[key]));
}

function saveHorizon(userId, moduleName, horizon, context = {}) {
  return saveHorizonState(userId, horizonKey(moduleName), moduleName, horizon, context);
}

function getAppliedHorizon(userId, moduleName) {
  const entries = load(userId).entries;
  return clone(parseStoredJson(entries[appliedHorizonKey(moduleName)]));
}

function saveAppliedHorizon(userId, moduleName, horizon, context = {}) {
  return saveHorizonState(userId, appliedHorizonKey(moduleName), moduleName, horizon, context);
}

function resetWorkspace(userId, moduleName, categories = WORKSPACE_CATEGORIES) {
  const wanted = new Set(normalizeCategories(categories));
  const module = String(moduleName || '').toLowerCase();
  const keys = Object.keys(load(userId).entries).filter(key => {
    const category = categoryForKey(key);
    if (!wanted.has(category)) return false;
    if (!module || module === 'all') return true;
    if (category === 'horizon') return key === horizonKey(module) || key === appliedHorizonKey(module);
    // Modül adı anahtarın doğal parçasıysa yalnız onu sil; genel görünüm
    // anahtarları ancak all ile sıfırlanır.
    return key.toLowerCase().includes(`.${module}.`) || key.toLowerCase().endsWith(`_${module}`);
  });
  return { ...removeKeys(userId, keys), removedKeys: keys };
}

/* ATANMIŞ VARSAYILAN UFUK — "SON KARAR KAZANIR".

   Moderatör/Yönetici bir kullanıcıya varsayılan ufuk atadığında (merkezi IAM,
   bkz. iam-core normalizeUserWorkspaceDefaults) kullanıcının o ekran için
   ATAMADAN ÖNCE kaydedilmiş kişisel ufku, atamanın görünmesini engellerdi.
   Bu yüzden atamadan eski kişisel kayıt (ekranın kendi ufku, uygulanan ufku ve
   kişinin tüm ekranlar için varsayılanı) bir kez kaldırılır; mezar taşı
   tarayıcıdaki bayat kopyanın onu geri getirmesini engeller. Atamadan SONRA
   kullanıcının kendi yaptığı değişiklik daha yenidir ve korunur: kullanıcı
   ufkunu her zaman kendisi değiştirebilir. */
function supersedePersonalHorizons(userId, assignedKeys, assignedAt) {
  const stamp = String(assignedAt || '');
  if (!stamp) return [];
  const candidates = new Set();
  for (const key of Array.isArray(assignedKeys) ? assignedKeys : []) {
    const match = /^buyerlog\.workspace\.horizon\.([a-z0-9_-]+)\.v1$/.exec(String(key || ''));
    if (!match) continue;
    candidates.add(horizonKey(match[1]));
    candidates.add(appliedHorizonKey(match[1]));
  }
  if (!candidates.size) return [];
  candidates.add(horizonKey('default'));
  const entries = load(userId).entries;
  const stale = [...candidates].filter(key => entries[key] && String(entries[key].updatedAt || '') < stamp);
  if (stale.length) removeKeys(userId, stale);
  return stale;
}

/* v7.81 — KATMAN GÖRÜNÜR OLDU.

   Bir modülün ufku beş ayrı yerden gelebiliyor ve ekran bugüne kadar hangisinin
   kazandığını SÖYLEMİYORDU. Kullanıcı ekranda bir filtre görüyor, ortak ayarı
   değiştiriyor, hiçbir şey değişmiyordu — çünkü kendi kişisel ayarı üstteydi.
   Bu, Veri Yönetimi analizinde tespit edilen bir numaralı UX sorunuydu.

   Katman bilgisi AYRI bir çözümleme yazılarak üretilmez: ikinci bir uygulama
   er geç asıl çözümlemeden sapar ve ekran yanlış katmanı gösterir — sessizce.
   Bunun yerine tek çözümleme çekirdeği hem değeri hem katmanı döndürür;
   resolveHorizon() artık o çekirdeğin ince bir sarmalayıcısıdır.

   Katmanlar, öncelik sırasıyla:
     personal        kullanıcının bu modül için kendi ayarı
     personalDefault kullanıcının tüm modüller için varsayılanı
     roleTemplate    rolünden miras aldığı şablon (bu modül)
     roleDefault     rolünden miras aldığı şablon (varsayılan)
     source          hiçbiri yok; bağlantının/kapsamın kendi ufku geçerli

   v7.81 — 'preset' VE 'group' KATMANLARI KALDIRILDI (kullanıcı kararı).

   Ön ayar, hiç seçim yapmamış kullanıcıya profiline (MAG/MMYG/Buying Group)
   göre otomatik bir ufuk atıyordu; grup ise kişisel bir ufku adlandırılmış
   bir kayda bağlıyordu. İkisi de kullanıcının GÖRMEDİĞİ bir katmandı ve
   ortak filtreyi sessizce eziyordu: "Veri Yönetimi'nden filtreyi değiştirdim,
   ekranımda hiçbir şey değişmedi" şikâyetinin kaynağı buydu.

   Kalan zincir üç soruyu cevaplar: kendi ayarım var mı, rolümün şablonu var
   mı, yoksa kaynağın (Veri Yönetimi'ndeki ortak) filtresi mi geçerli.

   VERİ SİLİNMEZ: eskiden yazılmış horizon:__groups__ kaydı ve
   horizon-presets.json diskte durur, yalnız artık okunmaz. Bir kararı geri
   almak, kullanıcının verisini yok etmekten her zaman kolaydır.
*/
const HORIZON_LAYERS = Object.freeze(['personal', 'personalDefault', 'roleTemplate', 'roleDefault', 'source']);

function selectHorizonPreference(userId, moduleName, context = {}, roleEntries = null) {
  const personalEntries = load(userId).entries;
  const inheritedEntries = normalizeWorkspaceEntryMap(roleEntries, ['horizon']);

  // Sıra, eski koddaki || zincirinin BİREBİR aynısıdır. Değiştirilirse
  // çözümleme davranışı değişir; yalnız hangi dalın kazandığı artık kaydediliyor.
  const candidates = [
    ['personal', parseStoredJson(personalEntries[horizonKey(moduleName)])],
    ['personalDefault', parseStoredJson(personalEntries[horizonKey('default')])],
    ['roleTemplate', parseStoredJson(inheritedEntries[horizonKey(moduleName)])],
    ['roleDefault', parseStoredJson(inheritedEntries[horizonKey('default')])],
  ];
  const hit = candidates.find(entry => entry[1]) || ['source', null];
  return { preference: hit[1], layer: hit[0] };
}

function resolveHorizon(userId, moduleName, applicationDefault, context = {}, roleEntries = null) {
  return resolveHorizonProvenance(userId, moduleName, applicationDefault, context, roleEntries).horizon;
}

/** resolveHorizon ile AYNI değeri, ayrıca hangi katmandan geldiğini döndürür. */
function resolveHorizonProvenance(userId, moduleName, applicationDefault, context = {}, roleEntries = null) {
  const selected = selectHorizonPreference(userId, moduleName, context, roleEntries);
  const resolved = resolveHorizonValueProvenance(selected.preference, applicationDefault, context);
  return {
    horizon: resolved.horizon,
    // Kayıt bulundu ama içi boştu → gerçekte kaynağın ufku geçerli oldu.
    layer: resolved.layer === 'source' ? 'source' : selected.layer,
    preferenceLayer: selected.layer,
  };
}

function resolveHorizonValue(preference, applicationDefault, context = {}) {
  return resolveHorizonValueProvenance(preference, applicationDefault, context).horizon;
}

function resolveHorizonValueProvenance(preference, applicationDefault, context = {}) {
  const none = { horizon: clone(applicationDefault || {}), layer: 'source' };
  if (!preference) return none;
  const connectionId = String(context.connectionId || '');
  const role = String(context.role || '');
  let selected = preference;
  if (preference.byConnection && connectionId && preference.byConnection[connectionId]) selected = preference.byConnection[connectionId];
  else if (preference.byRole && role && preference.byRole[role]) selected = preference.byRole[role];
  else if (preference.horizon && typeof preference.horizon === 'object') selected = preference.horizon;
  /* v7.81: linkedGroupId ARTIK ÇÖZÜMLENMEZ. Adlandırılmış Horizon grupları
     kaldırıldı; bir gruba bağlı eski kayıt artık kendi içindeki ufukla (varsa)
     ya da kaynağın ufkuyla çalışır. Alan SİLİNMEZ: kayıtta durur, okunmaz —
     bir kararı geri almak, kullanıcının verisini yok etmekten kolaydır. */
  if (selected && typeof selected === 'object' && (selected.table || Array.isArray(selected.groups)
    || Array.isArray(selected.seasons) || selected.dateStart || selected.dateEnd)) {
    return { horizon: clone(selected), layer: 'preference' };
  }
  // v7.01'in ilk geliştirme paketinde yazılmış düz Horizon kayıtlarıyla uyum.
  return none;
}

/* KİŞİSEL UFKU BAĞLANTI KAPSAMLARINA UYGULAR.

   Sıra: KİŞİSEL > ROL ŞABLONU > bağlantının (kapsamın) kendi ufku.

   v7.81 — ÖN AYAR GERİ DÜŞÜŞÜ VE GRUP ÇÖZÜMLEMESİ KALDIRILDI (kullanıcı
   kararı). İkisi de kullanıcının görmediği bir katmandı ve Veri Yönetimi'nde
   ayarlanan ortak filtreyi sessizce eziyordu; "filtreyi değiştirdim, ekranımda
   hiçbir şey değişmedi" şikâyetinin kaynağı buydu. Hiç kişisel ayarı olmayan
   kullanıcı artık doğrudan kaynağın ortak filtresini görür.

   Eski kayıtlar SİLİNMEZ, yalnız okunmaz (bkz. selectHorizonPreference). */
function applyHorizonOverrides(items, userId, requestedTargets, roleEntries = null) {
  const wanted = new Set(Array.isArray(requestedTargets) && requestedTargets.length
    ? requestedTargets.map(value => String(value || '').toLowerCase())
    : ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  // Tek Refresh içinde aynı preference dosyasını scope/target başına tekrar
  // okumak senkron disk yükü yaratır. Bir kez yükle, bütün modül Horizon'larını
  // bu immutable snapshot üzerinden çöz.
  const storedEntries = load(userId).entries;
  const inheritedEntries = normalizeWorkspaceEntryMap(roleEntries, ['horizon']);
  const preferenceCache = new Map();
  const preferenceFor = moduleName => {
    const module = String(moduleName || 'default').toLowerCase();
    if (!preferenceCache.has(module)) preferenceCache.set(module, clone(parseStoredJson(storedEntries[horizonKey(module)])));
    return preferenceCache.get(module);
  };
  const inheritedFor = moduleName => clone(parseStoredJson(inheritedEntries[horizonKey(moduleName)]));
  const resolvedPreference = moduleName => preferenceFor(moduleName) || preferenceFor('default') || inheritedFor(moduleName) || inheritedFor('default');
  /* v20260928 — BAĞLI MODÜLLER tek ufuk taşır. Modül başına eski bir kişisel
     ya da rol ufku grubu yeniden bölseydi aynı yenileme iki sorguya ayrılır,
     sayfalar farklı satır evrenleri gösterirdi. Grup için ilk bulunan kayıt
     (Orders → Backlog → LFL → Price & Supplier sırasıyla) hepsine uygulanır. */
  /* v20260929 — Grubun üyeleri bağlantı kaydından okunur (üyelik düzenlenebilir;
     gruptan ayrılan modül kendi kişisel ufkunu yeniden kullanabilir). */
  const linkedPreference = members => {
    for (const moduleName of members) { const pref = preferenceFor(moduleName); if (pref) return pref; }
    if (preferenceFor('default')) return preferenceFor('default');
    for (const moduleName of members) { const pref = inheritedFor(moduleName); if (pref) return pref; }
    return inheritedFor('default');
  };
  return (Array.isArray(items) ? items : []).map(item => {
    // CP gruba eklenmiş olsa bile grubun kişisel ufkunu CP'ninki belirlemez: en sona.
    const members = modelScopes.linkedTargetsOf(item).sort((a, b) => (a === 'cp') - (b === 'cp'));
    const linkedWanted = members.some(target => wanted.has(target));
    const isMember = target => members.includes(target);
    const preferenceOf = target => (isMember(target) ? linkedPreference(members) : resolvedPreference(target));
    const isWanted = target => wanted.has(target) || (linkedWanted && isMember(target));
    const next = clone(item || {}), baseScopes = Array.isArray(next.scopes) && next.scopes.length
      ? next.scopes : [{ id: `${next.id || 'connection'}-default`, name: '', targets: [], enabled: true, horizon: next.horizon || {} }];
    const scopes = [];
    for (const scope of baseScopes) {
      const targets = Array.isArray(scope.targets) ? scope.targets : [];
      const groups = new Map();
      for (const target of targets) {
        const normalizedTarget = String(target || '').toLowerCase();
        const horizon = isWanted(normalizedTarget)
          ? resolveHorizonValue(
            preferenceOf(normalizedTarget),
            scope.horizon || next.horizon || {},
            { connectionId: next.id, role: next.role },
          )
          : clone(scope.horizon || next.horizon || {});
        const signature = JSON.stringify(horizon || {});
        if (!groups.has(signature)) groups.set(signature, { horizon, targets: [] });
        groups.get(signature).targets.push(target);
      }
      if (!targets.length) scopes.push(scope);
      else for (const [signature, group] of groups) {
        const personal = group.targets.some(target => {
          const pref = preferenceOf(String(target || '').toLowerCase());
          return Boolean(pref && ((pref.byConnection && pref.byConnection[next.id]) || (pref.byRole && pref.byRole[next.role]) || pref.horizon || pref.table || Array.isArray(pref.groups)));
        });
        scopes.push({
          ...scope,
          id: groups.size === 1 ? scope.id : `${scope.id || 'scope'}-user-${group.targets.join('-')}`,
          name: groups.size === 1 ? scope.name : `${scope.name || 'Scope'} · ${group.targets.join(' + ')}`,
          targets: group.targets,
          horizon: group.horizon,
          _personalHorizon: personal,
          _horizonSignature: signature,
        });
      }
    }
    next.scopes = scopes;
    return next;
  });
}

module.exports = {
  load, merge, removeKeys, restoreSnapshot, applyEntryChanges, isSyncedKey, SYNCED_PREFIXES, MAX_VALUE_BYTES, MAX_TOTAL_BYTES, safeId,
  WORKSPACE_HORIZON_PREFIX, APPLIED_HORIZON_PREFIX, WORKSPACE_CATEGORY_PREFIXES, WORKSPACE_CATEGORIES,
  categoryForKey, normalizeCategories, workspaceEntries, replaceWorkspaceEntries,
  normalizeWorkspaceEntryMap, effectiveWorkspaceEntries, copyWorkspaceSnapshot, copyWorkspaceEntrySnapshot,
  horizonKey, appliedHorizonKey, getHorizon, saveHorizon, saveHorizons, planHorizonEntries, horizonEntrySnapshot, getAppliedHorizon, saveAppliedHorizon, resetWorkspace, resolveHorizon,
  supersedePersonalHorizons,
  applyHorizonOverrides,
  // v7.81 — Veri Yönetimi ekranı hangi katmanın kazandığını gösterebilsin diye.
  HORIZON_LAYERS, resolveHorizonProvenance, selectHorizonPreference,
};

// All exported preference writers share the same lease as the CP agent CAS.
// Internal synchronous calls stay within the outer writer's lease.
for (const name of ['merge','removeKeys','restoreSnapshot','applyEntryChanges','replaceWorkspaceEntries','copyWorkspaceSnapshot','copyWorkspaceEntrySnapshot','saveHorizon','saveHorizons','saveAppliedHorizon','resetWorkspace','supersedePersonalHorizons']) {
  const writer=module.exports[name];
  module.exports[name]=(...args)=>require('./shared-file-transaction').withFileLeaseSync(prefsFile(name.startsWith('copyWorkspace')?args[1]:args[0]),()=>writer(...args));
}
