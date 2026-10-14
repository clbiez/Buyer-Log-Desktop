'use strict';

/* ÖN AYAR PAYLAŞIMI (self-service)

   Kullanıcı, kullanıcı menüsünden başka bir aktif kullanıcıyı seçer ve onun
   kişisel görünüm ayarlarını KENDİ çalışma alanına alır. Yönetici tarafındaki
   Profil Kopyalama (user-access.js) kaynaktan hedeflere İTER ve yetki ister;
   bu akış yalnız talep eden kullanıcının kendi kaydına YAZAR, başkasının
   kaydına dokunmaz.

   Neler paylaşılabilir: yalnız sunumu değiştiren kişisel tercihler —
   Database Horizon filtreleri, Focus/Extended sütun ön ayarları, sütun
   sırası/genişliği/dondurma, kullanıcının oluşturduğu hesaplanan sütunlar,
   kayıtlı görünüm ve filtre profilleri. Horizon bir FİLTREDİR, veri değil:
   veri kapsamı (dataScope) ayrıca sunucuda uygulanır, alınan ufuk erişimi
   genişletmez (bkz. /api/horizon/users). Parola, yetki, organizasyon ve
   uygulanmış (applied) Horizon anlık görüntüsü hiçbir zaman aktarılmaz.

   Birleştirme (MERGE) sayfa bazlıdır: kaynağın ayarı olan sayfalar alınır,
   talep edenin diğer sayfaları korunur. Değiştirme (REPLACE) seçilen alanda
   talep edenin kaydını kaynağınkiyle bire bir değiştirir. Her uygulama
   öncesinde talep edenin etkilenen kaydı saklanır; "Geri Al" onu döndürür. */

const fs = require('fs');
const path = require('path');
const userPreferences = require('./user-preferences');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { pageOf } = require('./profile-store');

const UNDO_ROOT = path.join(SERVER_DATA_ROOT, 'preset-share-undo');
const HORIZON_PREFIX = userPreferences.WORKSPACE_HORIZON_PREFIX;
const TABLE_VIEW_PRESET_PREFIX = 'lcw.tableViewFocus.';
const FORMULA_COLUMNS_PREFIX = 'bl.formulaColumns.';
// v7.221 — kişisel CP kuralları: öncelik kuralları ve checklist soruları ayrı
// anahtarlarda durur ki kullanıcı ikisini ayrı ayrı alabilsin.
const PRIORITY_RULES_KEY_PREFIX = 'lcw.cp.rules.priority.';
const CHECKLIST_RULES_KEY_PREFIX = 'lcw.cp.rules.checklist.';
const RULE_STORE_PREFIX = 'lcw.cp.rules.';
const COLUMN_PREFIXES = userPreferences.WORKSPACE_CATEGORY_PREFIXES.columns;

// Değeri { sayfa: ayar } biçiminde tutulan anahtarlar. MERGE bu anahtarlarda
// sayfa düzeyinde birleştirir; kaynağın hiç dokunmadığı sayfa korunur.
const PAGE_KEYED_KEYS = new Set([
  'lcw.tableViewFocus.v1', 'lcw.table.columnState.v1', 'lcw.freeze.v1', 'lcw.corePageFilters.auto.v1',
]);

const SHARE_ITEMS = Object.freeze([
  { id: 'horizon', prefixes: [HORIZON_PREFIX], defaultSelected: true,
    labelTr: 'Database Horizon filtreleri', labelEn: 'Database Horizon filters',
    hintTr: 'Modül bazlı kişisel veri ufku. Yeni ufuk bir sonraki veri yenilemesinde uygulanır.',
    hintEn: 'Personal per-module data horizon. The new horizon applies on the next data refresh.' },
  { id: 'tablePresets', prefixes: [TABLE_VIEW_PRESET_PREFIX], defaultSelected: true,
    labelTr: 'Focus / Extended ön ayarları', labelEn: 'Focus / Extended presets',
    hintTr: 'Sayfa bazlı Focus ve Extended sütun seçimleri.', hintEn: 'Per-page Focus and Extended column selections.' },
  { id: 'columnLayout', prefixes: COLUMN_PREFIXES.filter(prefix => prefix !== TABLE_VIEW_PRESET_PREFIX && prefix !== FORMULA_COLUMNS_PREFIX), defaultSelected: true,
    labelTr: 'Sütun sırası, genişliği ve dondurma', labelEn: 'Column order, width and freeze',
    hintTr: 'Sütunların yerleri, genişlikleri, gizli sütunlar ve dondurulan sütunlar.', hintEn: 'Column positions, widths, hidden columns and frozen columns.' },
  { id: 'customColumns', prefixes: [FORMULA_COLUMNS_PREFIX], defaultSelected: true,
    labelTr: 'Oluşturulan sütunlar', labelEn: 'Created columns',
    hintTr: 'Kullanıcının oluşturduğu hesaplanan (formül) sütunlar. Kendi sütunlarınız korunur.', hintEn: 'Calculated (formula) columns the user created. Your own columns are kept.' },
  { id: 'cpPriorityRules', prefixes: [PRIORITY_RULES_KEY_PREFIX], defaultSelected: false,
    labelTr: 'Öncelik kuralları', labelEn: 'Priority rules',
    hintTr: 'Kullanıcının CP öncelik kuralları (Rules). Aynı kimlikli kurallarınız güncellenir, diğerleri korunur.', hintEn: 'The user’s CP priority rules (Rules). Your rules with the same ID are updated, the others are kept.' },
  { id: 'cpChecklistQuestions', prefixes: [CHECKLIST_RULES_KEY_PREFIX], defaultSelected: false,
    labelTr: 'Checklist soruları', labelEn: 'Checklist questions',
    hintTr: 'Kullanıcının checklist soruları ve kimlere sorulduğu (Checklist Settings). Kendi sorularınız korunur.', hintEn: 'The user’s checklist questions and who they are asked for (Checklist Settings). Your own questions are kept.' },
  { id: 'views', prefixes: ['lcw_view_favorite_'], profileStore: 'views', defaultSelected: true,
    labelTr: 'Kayıtlı görünümler', labelEn: 'Saved views',
    hintTr: 'Adlandırılmış görünüm profilleri ve sayfa favorisi.', hintEn: 'Named view profiles and the page favourite.' },
  { id: 'filters', prefixes: userPreferences.WORKSPACE_CATEGORY_PREFIXES.filters, profileStore: 'filters', defaultSelected: false,
    labelTr: 'Sayfa filtreleri', labelEn: 'Page filters',
    hintTr: 'Sayfa filtreleri, hızlı filtreler ve kayıtlı filtre profilleri.', hintEn: 'Page filters, quick filters and saved filter profiles.' },
]);
const SHARE_ITEM_IDS = SHARE_ITEMS.map(item => item.id);

function shareError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function parseJson(value) { try { return JSON.parse(value); } catch (_) { return undefined; } }
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function itemById(id) { return SHARE_ITEMS.find(item => item.id === id) || null; }
function normalizeItems(value) {
  const source = Array.isArray(value) ? value : Object.entries(value || {}).filter(([, on]) => Boolean(on)).map(([id]) => id);
  return [...new Set(source.map(id => String(id || '').trim()).filter(id => SHARE_ITEM_IDS.includes(id)))];
}
function normalizeMode(value) { return String(value || '').toUpperCase() === 'REPLACE' ? 'REPLACE' : 'MERGE'; }
function keyMatches(item, key) { return item.prefixes.some(prefix => String(key).indexOf(prefix) === 0); }
function entriesFor(entries, item) {
  return Object.fromEntries(Object.entries(entries || {}).filter(([key]) => keyMatches(item, key)));
}

/* Önizlemede kullanıcıya "hangi sayfalar" sorusunu cevaplar. Anahtarın
   kendisi sayfayı taşıyorsa (horizon.cp.v1) oradan, sayfa bazlı JSON ise
   üst seviye anahtarlarından okunur. */
function pagesOfEntry(key, value) {
  const text = String(key);
  const horizon = text.indexOf(HORIZON_PREFIX) === 0 && text.slice(HORIZON_PREFIX.length).replace(/\.v\d+$/, '');
  if (horizon) return [horizon];
  const formula = text.indexOf(FORMULA_COLUMNS_PREFIX) === 0 && text.slice(FORMULA_COLUMNS_PREFIX.length).replace(/\.v\d+$/, '');
  if (formula) return [formula];
  if (PAGE_KEYED_KEYS.has(text)) {
    const parsed = parseJson(value);
    return isPlainObject(parsed) ? Object.keys(parsed) : [];
  }
  const suffix = text.match(/^lcw_(?:view|filter)_favorite_(.+)$/);
  return suffix ? [suffix[1]] : [];
}
function countOfEntry(key, value) {
  const parsed = parseJson(value);
  if (String(key).indexOf(RULE_STORE_PREFIX) === 0 && isPlainObject(parsed) && Array.isArray(parsed.rules)) return parsed.rules.length;
  if (String(key).indexOf(FORMULA_COLUMNS_PREFIX) === 0 && Array.isArray(parsed)) return parsed.length;
  if (PAGE_KEYED_KEYS.has(String(key)) && isPlainObject(parsed)) return Object.keys(parsed).length;
  return 1;
}

/* MERGE birleştirmesi. Sayfa bazlı JSON'da sayfa düzeyinde, formül
   sütunlarında sütun kimliği düzeyinde, kişisel Horizon'da bağlantı
   düzeyinde birleştirir; diğer anahtarlarda kaynağın değeri alınır. */
function mergeValue(key, targetValue, sourceValue) {
  if (targetValue == null) return sourceValue;
  const target = parseJson(targetValue), source = parseJson(sourceValue);
  if (PAGE_KEYED_KEYS.has(String(key)) && isPlainObject(target) && isPlainObject(source)) {
    return JSON.stringify({ ...target, ...source });
  }
  if (String(key).indexOf(FORMULA_COLUMNS_PREFIX) === 0 && Array.isArray(target) && Array.isArray(source)) {
    const ids = new Set(source.map(column => column && column.id).filter(Boolean));
    return JSON.stringify([...source, ...target.filter(column => column && column.id && !ids.has(column.id))]);
  }
  /* Kural deposu: kural kimliği düzeyinde birleşir. Kaynağın kuralı aynı
     kimlikli kuralı günceller; talep edenin diğer kuralları korunur. Kaynakta
     bulunan yerleşik kural, talep edende silinmiş olsa bile geri gelir. */
  if (String(key).indexOf(RULE_STORE_PREFIX) === 0 && isPlainObject(target) && isPlainObject(source)
    && Array.isArray(target.rules) && Array.isArray(source.rules)) {
    const ids = new Set(source.rules.map(rule => rule && rule.id).filter(Boolean));
    const rules = [...source.rules, ...target.rules.filter(rule => rule && rule.id && !ids.has(rule.id))];
    const deletedRuleIds = (Array.isArray(target.deletedRuleIds) ? target.deletedRuleIds : []).filter(id => !ids.has(id));
    const adopted = Boolean(target.sharedChecklistAdopted || source.sharedChecklistAdopted);
    return JSON.stringify({ ...target, ...source, rules, deletedRuleIds, ...(adopted ? { sharedChecklistAdopted: true } : {}) });
  }
  if (String(key).indexOf(HORIZON_PREFIX) === 0 && isPlainObject(target) && isPlainObject(source)
    && isPlainObject(target.byConnection) && isPlainObject(source.byConnection)) {
    return JSON.stringify({
      ...target, ...source,
      byConnection: { ...target.byConnection, ...source.byConnection },
      ...(target.connectionRoles || source.connectionRoles ? { connectionRoles: { ...(target.connectionRoles || {}), ...(source.connectionRoles || {}) } } : {}),
    });
  }
  return sourceValue;
}

/* Kayıtlı görünüm / filtre profilleri. Kimlikler kullanıcı dosyası içinde
   benzersizdir; kaynağın kimliği korunur ki kopyalanan sayfa favorisi
   (lcw_view_favorite_*) doğru profili göstersin. MERGE'de aynı kimlik ya da
   aynı sayfa + ad talep edenin kaydını günceller; diğer profilleri korunur. */
function mergeProfileStore(targetStore, sourceStore, mode) {
  const now = new Date().toISOString();
  const sourceItems = (sourceStore && Array.isArray(sourceStore.items) ? sourceStore.items : [])
    .map(item => ({ ...clone(item), isFavorite: false, isDefault: false, updatedAt: now }));
  const sourceFavorites = isPlainObject(sourceStore && sourceStore.favoriteByPage) ? sourceStore.favoriteByPage : {};
  if (mode === 'REPLACE') {
    return { ...clone(targetStore), items: sourceItems, favoriteByPage: { ...sourceFavorites }, lastUsedByPage: {}, favoriteId: null };
  }
  const nameKey = item => `${pageOf(item)}\u0000${String(item && item.name || '').trim().toLocaleLowerCase('tr-TR')}`;
  const incomingIds = new Set(sourceItems.map(item => item.id));
  const incomingNames = new Set(sourceItems.map(nameKey));
  const kept = (targetStore && Array.isArray(targetStore.items) ? targetStore.items : [])
    .filter(item => !incomingIds.has(item.id) && !incomingNames.has(nameKey(item)));
  const favoriteByPage = { ...(isPlainObject(targetStore && targetStore.favoriteByPage) ? targetStore.favoriteByPage : {}), ...sourceFavorites };
  return { ...clone(targetStore), items: [...kept.map(clone), ...sourceItems], favoriteByPage, favoriteId: null };
}

function createPresetShare({ loadProfiles, restoreProfiles } = {}) {
  if (typeof loadProfiles !== 'function' || typeof restoreProfiles !== 'function') {
    throw new Error('Ön ayar paylaşımı profil deposu bağımlılıkları eksik.');
  }
  const undoFile = userId => path.join(UNDO_ROOT, `${userPreferences.safeId(userId)}.json`);
  // İstemci yazılan değerleri sunucunun zaman damgasıyla benimser; aksi hâlde
  // sayfa kapanırken bellekteki eski ayar daha yeni damgayla geri itilirdi.
  const storedEntries = (userId, keys) => {
    const entries = userPreferences.load(userId).entries;
    return Object.fromEntries(keys.filter(key => entries[key]).map(key => [key, { ...entries[key] }]));
  };

  function preview(sourceUserId) {
    const entries = userPreferences.load(sourceUserId).entries;
    const profiles = loadProfiles(sourceUserId) || {};
    return SHARE_ITEMS.map(item => {
      const matched = entriesFor(entries, item), pages = new Set();
      let count = 0;
      for (const [key, entry] of Object.entries(matched)) {
        count += countOfEntry(key, entry.value);
        pagesOfEntry(key, entry.value).forEach(page => pages.add(page));
      }
      const store = item.profileStore && profiles[item.profileStore];
      const profileItems = store && Array.isArray(store.items) ? store.items : [];
      profileItems.forEach(profile => { const page = pageOf(profile); if (page) pages.add(page); });
      count += profileItems.length;
      return {
        id: item.id, labelTr: item.labelTr, labelEn: item.labelEn, hintTr: item.hintTr, hintEn: item.hintEn,
        defaultSelected: item.defaultSelected, count, pages: [...pages].sort(),
        profileCount: profileItems.length,
      };
    });
  }

  /* plan() computes the exact change without writing; commit() writes it.
     apply() = commit(plan()) keeps the user-menu behaviour unchanged; the
     Office capability previews the same plan and commits it CAS-bound. */
  function plan({ sourceUserId, targetUserId, items, mode }) {
    const source = String(sourceUserId || ''), target = String(targetUserId || '');
    if (!source || !target) throw shareError('Kaynak ve hedef kullanıcı zorunludur.', 'PRESET_SHARE_USER_REQUIRED');
    if (source === target) throw shareError('Kendi ayarlarınızı kendinize aktaramazsınız.', 'PRESET_SHARE_SELF', 400);
    const selected = normalizeItems(items).map(itemById);
    if (!selected.length) throw shareError('Aktarılacak en az bir ayar seçin.', 'PRESET_SHARE_ITEM_REQUIRED');
    const copyMode = normalizeMode(mode);

    const sourceEntries = userPreferences.load(source).entries;
    const targetEntries = userPreferences.load(target).entries;
    const set = {}, remove = [], previous = {};
    for (const item of selected) {
      const incoming = entriesFor(sourceEntries, item);
      for (const [key, entry] of Object.entries(incoming)) {
        const current = targetEntries[key];
        set[key] = copyMode === 'REPLACE' ? entry.value : mergeValue(key, current && current.value, entry.value);
      }
      if (copyMode === 'REPLACE') {
        for (const key of Object.keys(entriesFor(targetEntries, item))) if (!incoming[key]) remove.push(key);
      }
    }
    for (const key of [...Object.keys(set), ...remove]) previous[key] = targetEntries[key] ? targetEntries[key].value : null;
    // Değişmeyen değeri yeniden yazmak yalnız zaman damgasını oynatır.
    for (const key of Object.keys(set)) if (targetEntries[key] && targetEntries[key].value === set[key]) delete set[key];

    const profileKinds = [...new Set(selected.map(item => item.profileStore).filter(Boolean))];
    const sourceProfiles = profileKinds.length ? loadProfiles(source) || {} : {};
    const targetProfiles = profileKinds.length ? loadProfiles(target) || {} : {};
    const nextProfiles = {}, previousProfiles = {};
    for (const kind of profileKinds) {
      const sourceStore = sourceProfiles[kind] || { items: [] };
      if (copyMode === 'MERGE' && !(sourceStore.items || []).length) continue;
      previousProfiles[kind] = clone(targetProfiles[kind] || { items: [] });
      nextProfiles[kind] = mergeProfileStore(targetProfiles[kind] || { items: [] }, sourceStore, copyMode);
    }

    return { source, target, mode: copyMode, items: selected.map(item => item.id), set, remove, previous, nextProfiles, previousProfiles,
      targetEntries: Object.fromEntries([...Object.keys(set), ...remove].map(key => [key, targetEntries[key] ? clone(targetEntries[key]) : null])) };
  }
  function commit(planned, options = {}) {
    const { source, target, mode: copyMode, set, remove, previous, nextProfiles, previousProfiles } = planned;
    const selected = planned.items.map(itemById);
    const changedKeys = Object.keys(set).length + remove.length;
    const changedProfiles = Object.keys(nextProfiles).length;
    if (!changedKeys && !changedProfiles) {
      return { ok: true, changed: false, mode: copyMode, items: selected.map(item => item.id), setKeys: [], removedKeys: [] };
    }
    options.assertAuthority?.();
    // Geri alma kaydı yazmadan ÖNCE diske iner: uygulama yarıda kalsa bile
    // kullanıcının eski ayarı kaybolmaz.
    fs.mkdirSync(UNDO_ROOT, { recursive: true });
    const createdAt = new Date().toISOString();
    let earlierUndo = null;
    try { earlierUndo = fs.readFileSync(undoFile(target), 'utf8'); } catch (_) {}
    atomicWriteJson(undoFile(target), { version: 1, createdAt, sourceUserId: source, mode: copyMode, items: selected.map(item => item.id), entries: previous, profiles: previousProfiles });
    try {
      if (changedKeys) userPreferences.applyEntryChanges(target, set, remove, options.expectedEntries ? { expectedEntries: options.expectedEntries, assertAuthority: options.assertAuthority } : {});
    } catch (error) {
      // Hiçbir şey yazılmadı (ör. kişisel veri sınırı): önceki geri alma kaydı
      // aynen geri konur, "geri al" boş bir aktarımı göstermez.
      if (earlierUndo != null) fs.writeFileSync(undoFile(target), earlierUndo, 'utf8');
      else fs.rmSync(undoFile(target), { force: true });
      throw error;
    }
    // Profil yazımı başarısız olursa anahtarlar zaten yazılmıştır; geri alma
    // kaydı yerinde kalır ve kullanıcı yarım aktarımı geri alabilir.
    if (changedProfiles) restoreProfiles(target, nextProfiles);
    return {
      ok: true, changed: true, mode: copyMode, items: selected.map(item => item.id), createdAt,
      setKeys: Object.keys(set), removedKeys: remove, profiles: Object.keys(nextProfiles),
      entries: storedEntries(target, Object.keys(set)),
    };
  }
  function apply(request) { return commit(plan(request)); }

  function undoInfo(userId) {
    try {
      const raw = JSON.parse(fs.readFileSync(undoFile(userId), 'utf8'));
      return raw && raw.version === 1 ? { available: true, createdAt: raw.createdAt, sourceUserId: raw.sourceUserId, items: raw.items || [], mode: raw.mode } : { available: false };
    } catch (_) { return { available: false }; }
  }

  function undo(userId) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(undoFile(userId), 'utf8')); } catch (_) { raw = null; }
    if (!raw || raw.version !== 1) throw shareError('Geri alınacak bir ön ayar aktarımı yok.', 'PRESET_SHARE_UNDO_EMPTY', 404);
    const set = {}, remove = [];
    for (const [key, value] of Object.entries(raw.entries || {})) {
      if (value == null) remove.push(key); else set[key] = value;
    }
    if (Object.keys(set).length || remove.length) userPreferences.applyEntryChanges(userId, set, remove);
    if (raw.profiles && Object.keys(raw.profiles).length) restoreProfiles(userId, raw.profiles);
    fs.rmSync(undoFile(userId), { force: true });
    return { ok: true, setKeys: Object.keys(set), removedKeys: remove, profiles: Object.keys(raw.profiles || {}), sourceUserId: raw.sourceUserId || null, entries: storedEntries(userId, Object.keys(set)) };
  }

  // An Office inverse already restored this application: its menu undo slot
  // would otherwise offer to restore the same state again later.
  function discardUndo(userId, createdAt) {
    const info = undoInfo(userId);
    if (info.available && info.createdAt === createdAt) fs.rmSync(undoFile(userId), { force: true });
  }

  return { preview, plan, commit, apply, undo, undoInfo, discardUndo, storedEntries };
}

module.exports = {
  SHARE_ITEMS, SHARE_ITEM_IDS, PAGE_KEYED_KEYS, UNDO_ROOT,
  createPresetShare, mergeValue, mergeProfileStore, normalizeItems, normalizeMode,
};
