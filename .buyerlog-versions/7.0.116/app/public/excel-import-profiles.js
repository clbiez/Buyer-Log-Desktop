/* ===================================================================
   KULLANICI EXCEL'İ İÇERİ AKTARMA — EŞLEME PROFİLLERİ

   Profil KULLANICIYA ve HEDEF MODÜLE aittir. Depolama Buyer Log'un
   mevcut kullanıcı deposudur (BLStorage → /api/user-preferences);
   ikinci bir profil sistemi kurulmaz.

   Profilde SADECE yapılandırma tutulur: hedef modül, sayfa tercihi,
   başlık satırı, kaynak sütun parmak izi, eşleme, yeni sütun tanımları,
   eşleşme kuralı, boş-hücre ve gizli/birleşik veri tercihleri. Çalışma
   kitabının kendisi, hücre içerikleri, parolalar veya iş verisi ASLA
   yazılmaz.

   Profil KENDİLİĞİNDEN ÇALIŞMAZ. En iyi durumda sihirbazı önceden
   doldurur; yapı değiştiyse yalnız güvenli alanlar doldurulur ve eşleme
   yeniden gözden geçirilmek zorunda kalır.
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelImportProfiles = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PREFIX = 'bl.excelImport.profiles.';
  var VERSION = 1;
  var MAX_PROFILES = 20;

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function storage() {
    if (root && root.BLStorage) return root.BLStorage;
    if (root && root.localStorage) return root.localStorage;
    return null;
  }
  function userId() {
    var context = root && root.BL_USER_CONTEXT;
    return text(context && context.id) || 'anonymous';
  }
  function keyFor(moduleId) { return PREFIX + text(moduleId) + '.v' + VERSION; }

  function read(moduleId) {
    var store = storage();
    if (!store) return { schemaVersion: VERSION, moduleId: text(moduleId), userId: userId(), items: [] };
    var raw = null;
    try { raw = store.getItem(keyFor(moduleId)); } catch (_) { raw = null; }
    var parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = null; }
    var items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    // Depo kullanıcı başına ayrılmış olsa da profil kaydı kendi sahibini
    // taşır; paylaşılan bir cihazda başka kullanıcının profili listelenmez.
    var owner = userId();
    return {
      schemaVersion: VERSION, moduleId: text(moduleId), userId: owner,
      items: items.filter(function (item) { return item && text(item.userId) === owner && text(item.moduleId) === text(moduleId); }),
    };
  }

  function write(moduleId, store0) {
    var store = storage();
    if (!store) return false;
    try { store.setItem(keyFor(moduleId), JSON.stringify(store0)); return true; }
    catch (_) { return false; }
  }

  function list(moduleId) { return read(moduleId).items.slice().sort(function (a, b) { return text(b.updatedAt).localeCompare(text(a.updatedAt)); }); }

  /* Profil gövdesi SINIRLIDIR: yalnız aşağıdaki alanlar saklanır. */
  function sanitize(profile, moduleId) {
    var source = profile || {};
    return {
      id: text(source.id) || ('imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      name: text(source.name).slice(0, 80) || 'Profil',
      userId: userId(),
      moduleId: text(moduleId),
      schemaVersion: VERSION,
      sheetName: text(source.sheetName).slice(0, 120),
      headerRow: Number.isFinite(Number(source.headerRow)) ? Number(source.headerRow) : 0,
      fingerprint: text(source.fingerprint).slice(0, 120),
      columnKeys: (Array.isArray(source.columnKeys) ? source.columnKeys : []).slice(0, 200).map(function (value) { return text(value).slice(0, 120); }),
      assignments: sanitizeAssignments(source.assignments),
      newColumns: (Array.isArray(source.newColumns) ? source.newColumns : []).slice(0, 40).map(function (item) {
        return { columnId: text(item && item.columnId), label: text(item && item.label).slice(0, 80), dataType: text(item && item.dataType) || 'text' };
      }),
      matchFieldIds: (Array.isArray(source.matchFieldIds) ? source.matchFieldIds : []).slice(0, 6).map(function (value) { return text(value); }),
      options: {
        blankClears: Boolean(source.options && source.options.blankClears),
        createNew: Boolean(source.options && source.options.createNew),
        includeHiddenRows: Boolean(source.options && source.options.includeHiddenRows),
        includeHiddenColumns: Boolean(source.options && source.options.includeHiddenColumns),
        fillMergedCells: Boolean(source.options && source.options.fillMergedCells),
        includeStructuralRows: Boolean(source.options && source.options.includeStructuralRows),
      },
      updatedAt: new Date().toISOString(),
    };
  }
  function sanitizeAssignments(raw) {
    var out = {};
    Object.keys(raw && typeof raw === 'object' ? raw : {}).slice(0, 200).forEach(function (columnId) {
      var entry = raw[columnId] || {};
      // Sütun kimliği konuma bağlıdır; profil bunu BAŞLIK ANAHTARIYLA
      // birlikte saklar ki başka bir dosyada sütun kaydığında da bulunabilsin.
      var action = text(entry.action).toLowerCase();
      if (['ignore', 'create', 'update', 'match'].indexOf(action) < 0) action = '';
      out[text(columnId)] = {
        action: action,
        targetId: text(entry.targetId) || '__ignore__',
        headerKey: text(entry.headerKey).slice(0, 120),
        newColumnLabel: text(entry.newColumnLabel).slice(0, 80),
        newColumnType: text(entry.newColumnType),
      };
    });
    return out;
  }

  function save(moduleId, profile) {
    var store0 = read(moduleId);
    var clean = sanitize(profile, moduleId);
    var items = store0.items.filter(function (item) { return item.id !== clean.id; });
    items.unshift(clean);
    store0.items = items.slice(0, MAX_PROFILES);
    write(moduleId, store0);
    return clean;
  }

  function remove(moduleId, id) {
    var store0 = read(moduleId);
    store0.items = store0.items.filter(function (item) { return item.id !== text(id); });
    write(moduleId, store0);
    return true;
  }

  /* Bir çalışma kitabı için uygun profilleri döndürür.
     exact  → parmak izi birebir aynı (güvenle ön doldurulur)
     partial→ sayfa/başlık örtüşüyor ama yapı değişmiş (gözden geçirme ZORUNLU) */
  function match(moduleId, context) {
    var fingerprint = text(context && context.fingerprint);
    var sheetName = text(context && context.sheetName);
    var columnKeys = (context && Array.isArray(context.columnKeys) ? context.columnKeys : []).map(text);
    var columnSet = new Set(columnKeys);
    return list(moduleId).map(function (item) {
      if (fingerprint && item.fingerprint === fingerprint) return { profile: item, quality: 'exact', overlap: 1 };
      var known = item.columnKeys.filter(function (key) { return columnSet.has(key); }).length;
      var overlap = item.columnKeys.length ? known / item.columnKeys.length : 0;
      if (overlap >= 0.6 || (sheetName && item.sheetName === sheetName && overlap > 0)) {
        return { profile: item, quality: 'partial', overlap: Math.round(overlap * 100) / 100 };
      }
      return null;
    }).filter(Boolean).sort(function (a, b) {
      if (a.quality !== b.quality) return a.quality === 'exact' ? -1 : 1;
      return b.overlap - a.overlap;
    });
  }

  /* Profili GÜNCEL sütun listesine uygular. Yapı değiştiyse yalnız
     başlık anahtarı birebir tutan sütunlar doldurulur; gerisi boş kalır
     ve `requiresReview` true döner. */
  function applyProfile(profile, columns, fields) {
    var byHeaderKey = new Map();
    (Array.isArray(columns) ? columns : []).forEach(function (column) {
      if (!byHeaderKey.has(column.key)) byHeaderKey.set(column.key, column);
    });
    var validTargets = new Set((Array.isArray(fields) ? fields : []).map(function (field) { return field.id; }));
    var assignments = {}, missing = [], dropped = [], claimed = new Set();
    Object.keys(profile.assignments || {}).forEach(function (columnId) {
      var entry = profile.assignments[columnId];
      /* BAŞLIK ANAHTARI yetkilidir. Anahtar bulunamadığında sütun KONUMUNA
         düşmek, farklı yapıdaki bir dosyada yanlış sütunu sessizce doğru
         alana bağlardı; bu yüzden konum yalnız profilde hiç başlık anahtarı
         yoksa (eski kayıt) kullanılır. */
      var column = entry.headerKey
        ? byHeaderKey.get(entry.headerKey)
        : (Array.isArray(columns) ? columns.find(function (item) { return item.id === columnId; }) : null);
      if (!column || claimed.has(column.id)) { missing.push(entry.headerKey || columnId); return; }
      claimed.add(column.id);
      if (entry.targetId !== '__ignore__' && entry.targetId !== '__new__' && !validTargets.has(entry.targetId)) {
        dropped.push({ columnId: column.id, targetId: entry.targetId });
        return;
      }
      var action = text(entry.action).toLowerCase();
      if (['ignore', 'create', 'update', 'match'].indexOf(action) < 0) {
        if (entry.targetId === '__ignore__') action = 'ignore';
        else if (entry.targetId === '__new__') action = 'create';
        else if ((profile.matchFieldIds || []).indexOf(entry.targetId) >= 0) action = 'match';
        else action = 'update';
      }
      assignments[column.id] = {
        action: action,
        targetId: entry.targetId,
        confidence: 'profile',
        needsReview: false,
        reviewed: true,
        fromProfile: true,
        newColumnLabel: entry.newColumnLabel || '',
        newColumnType: entry.newColumnType || 'text',
      };
    });
    var requiresReview = missing.length > 0 || dropped.length > 0;
    var restoredMatchFields = Object.keys(assignments).map(function (columnId) { return assignments[columnId]; })
      .filter(function (entry) { return entry.action === 'match' && validTargets.has(entry.targetId); })
      .map(function (entry) { return entry.targetId; });
    return { assignments: assignments, missing: missing, dropped: dropped, requiresReview: requiresReview, matchFieldIds: restoredMatchFields.length ? restoredMatchFields : (profile.matchFieldIds || []).filter(function (id) { return validTargets.has(id); }), options: profile.options || {} };
  }

  return {
    PREFIX: PREFIX,
    VERSION: VERSION,
    list: list,
    save: save,
    remove: remove,
    match: match,
    applyProfile: applyProfile,
    sanitize: sanitize,
  };
}));
