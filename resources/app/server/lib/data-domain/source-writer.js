'use strict';

/* ===================================================================
   KAYNAK EKLE / DÜZENLE / AÇ-KAPAT (§7, §8)

   Hedef: "Yeni bir database'i Buyer Log'a bağlamak birkaç dakika sürmeli"
   ve "kaynak koda `if (source === 'NEW_DB')` yazmak gerekmemeli."

   İkincisi P1'de çözüldü: kaynak türü artık bir PROFİL kaydı (source-profiles).
   Burada birincisi var — kaydın kendisini kurmak.

   AD DOĞRULAMASI UYDURULMAZ. Sunucu ve katalog adları bağlantı dizesine
   gömülür; modelQuery.validateName bunu zaten koruyor (noktalı virgül veya
   eşittir içeren bir değer dizeye yeni anahtar enjekte edebilirdi). Burada
   İKİNCİ bir desen yazmak yerine O fonksiyon çağrılır: bu sayede kurulumda
   kabul edilen her ad, gerçek sorguda da kabul edilir. İki ayrı desen er geç
   ayrışır ve "kaydettim ama sorgu çalışmıyor" üretirdi.

   ROL BAŞINA TEK AKTİF BAĞLANTI KURALI BURADA UYGULANMAZ — db.js'de yaşar
   (normalizeModelConnections ikinci aktif kaydı sessizce kapatır). Ama kural
   SESSİZ kalmamalı: aynı profilde zaten aktif bir kaynak varsa yeni kayıt
   kapalı doğar ve bu açıkça söylenir. Kullanıcı "ekledim ama çalışmıyor"
   dememeli.

   SAF MODÜL: disk ve ağ yok.
   =================================================================== */

const modelQuery = require('../modelQuery');
const databaseConnector = require('../database-connector');
const sourceProfiles = require('./source-profiles');

const MAX_NAME = 80;
const MAX_SOURCES = 20;   // db.js MODEL_CONNECTION_LIMIT ile aynı

function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

/** modelQuery.validateName'i istisna yerine mesaja çevirir. */
function checkName(value, label) {
  try { modelQuery.validateName(value, label); return ''; }
  catch (error) { return String(error && error.message || error); }
}

function newId() {
  return `mc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Yeni kaynak. Bağlantıyı SINAMAZ — sınama ayrı bir uçtur ve ağ gerektirir;
 * bu modül saf kalmalı. Arayüz sınamayı kaydetmeden önce yapar.
 *
 * @returns {{ok, code, message, items, warnings, sourceId}}
 */
function planSourceCreate(items, { name, profileId, server, catalog, moduleIds } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];

  if (list.length >= MAX_SOURCES) {
    return { ok: false, code: 'SOURCE_LIMIT', message: `En fazla ${MAX_SOURCES} kaynak tanımlanabilir.`, items: list, warnings };
  }

  const cleanName = clean(name).slice(0, MAX_NAME);
  if (!cleanName) return { ok: false, code: 'NAME_REQUIRED', message: 'Kaynağa bir ad verin.', items: list, warnings };

  const profile = sourceProfiles.get(clean(profileId));
  if (!profile) {
    return {
      ok: false, code: 'PROFILE_UNKNOWN',
      message: `Bilinmeyen kaynak türü. Seçenekler: ${sourceProfiles.ids().join(', ')}`,
      items: list, warnings,
    };
  }

  const serverProblem = checkName(server, 'Sunucu');
  if (serverProblem) return { ok: false, code: 'SERVER_INVALID', message: serverProblem, items: list, warnings };
  const catalogProblem = checkName(catalog, 'Model');
  if (catalogProblem) return { ok: false, code: 'CATALOG_INVALID', message: catalogProblem, items: list, warnings };

  const wantedModules = [...new Set((Array.isArray(moduleIds) ? moduleIds : []).map(clean).filter(Boolean))];
  const impossible = wantedModules.filter(moduleId => !profile.feedableModules.includes(moduleId));
  if (impossible.length) {
    return {
      ok: false, code: 'MODULE_NOT_FEEDABLE',
      message: `${profile.label.tr} türündeki bir kaynak şu modülleri besleyemez: ${impossible.join(', ')}`,
      items: list, warnings,
    };
  }

  /* Aynı sunucu+katalog ikinci kez eklenirse iki kayıt aynı veriyi çeker ve
     kullanıcı hangisinin çalıştığını ayırt edemez. Engellenmez (bilinçli bir
     kopya olabilir) ama söylenir. */
  const duplicate = list.find(item => item
    && clean(item.server).toLowerCase() === clean(server).toLowerCase()
    && clean(item.catalog).toLowerCase() === clean(catalog).toLowerCase());
  if (duplicate) warnings.push(`Aynı sunucu ve model zaten "${duplicate.name || duplicate.id}" olarak kayıtlı.`);

  /* ROL BAŞINA TEK AKTİF KURALI. db.js ikinci aktif kaydı sessizce kapatır;
     kullanıcı bunu ekranda görmeden önce BURADA öğrenmeli. */
  const activeSame = list.find(item => item && item.role === profile.legacyRole && item.refreshEnabled !== false);
  const enabled = !activeSame;
  if (activeSame) {
    warnings.push(`"${profile.label.tr}" türünde zaten aktif bir kaynak var (${activeSame.name || activeSame.id}). `
      + 'Yeni kaynak KAPALI olarak eklendi; etkinleştirmek için önce diğerini kapatın.');
  }

  const scopes = wantedModules.length
    ? [{
      id: `sc_${Math.random().toString(36).slice(2, 9)}`,
      name: '',
      targets: wantedModules,
      enabled: true,
      limitToCpOrders: false,
      /* Filtre UYDURULMAZ. Yeni kaynak filtresiz doğar ve ekran "filtre
         gerekli" der; kullanıcıdan bilinçli bir kapsam kararı istenir.
         Varsayılan bir ufuk koymak, beklenmedik hacimde ilk sorgu demekti. */
      horizon: {},
    }]
    : [];

  const item = {
    id: newId(),
    name: cleanName,
    server: clean(server),
    catalog: clean(catalog),
    role: profile.legacyRole,
    mode: 'auto',
    refreshEnabled: enabled,
    // Eşleme henüz yok: kurulum sihirbazı otomatik eşlemeyi ayrı adımda yazar.
    mapping: {},
    scopes,
  };

  const next = list.concat([item]);
  return { ok: true, code: 'OK', message: '', items: next, warnings, sourceId: item.id };
}

/** Bağlantı bilgilerini ve adı günceller. Eşleme, filtre ve bağlar korunur. */
function planSourceUpdate(items, { sourceId, name, server, catalog } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };

  const item = clone(list[index]);
  if (name != null) {
    const cleanName = clean(name).slice(0, MAX_NAME);
    if (!cleanName) return { ok: false, code: 'NAME_REQUIRED', message: 'Kaynağa bir ad verin.', items: list, warnings };
    item.name = cleanName;
  }
  if (server != null) {
    const problem = checkName(server, 'Sunucu');
    if (problem) return { ok: false, code: 'SERVER_INVALID', message: problem, items: list, warnings };
    if (clean(server) !== clean(item.server)) {
      /* Sunucu/model değişirse şema da değişmiş olabilir; mevcut eşleme
         sessizce yanlış sütunlara işaret edebilir. Silmiyoruz (kullanıcı
         kopyalanmış bir modele geçiyor olabilir) ama uyarıyoruz. */
      warnings.push('Sunucu değişti; alan eşlemesini gözden geçirin.');
    }
    item.server = clean(server);
  }
  if (catalog != null) {
    const problem = checkName(catalog, 'Model');
    if (problem) return { ok: false, code: 'CATALOG_INVALID', message: problem, items: list, warnings };
    if (clean(catalog) !== clean(item.catalog)) warnings.push('Model değişti; alan eşlemesini gözden geçirin.');
    item.catalog = clean(catalog);
  }

  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings, sourceId: item.id };
}

/**
 * Kaynağı yenileme akışına al / akıştan çıkar.
 * SİLMEZ: bağlantı, şema, eşleme, filtreler ve modül bağları korunur (§11).
 */
function planSourceEnabled(items, { sourceId, enabled } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };

  const item = clone(list[index]);
  const want = enabled !== false;
  if ((item.refreshEnabled !== false) === want) {
    return { ok: true, code: 'NO_CHANGE', message: '', items: list, warnings, sourceId: item.id };
  }

  if (want && item.role !== 'custom') {
    const activeSame = list.find((other, otherIndex) => otherIndex !== index
      && other && other.role === item.role && other.refreshEnabled !== false);
    if (activeSame) {
      /* Sessizce kapatmak yerine REDDET. db.js bu durumda ikinci kaydı
         kendiliğinden kapatır; kullanıcı "açtım ama kapalı kaldı" derdi. */
      return {
        ok: false, code: 'ROLE_ALREADY_ACTIVE',
        message: `Bu türde zaten aktif bir kaynak var: ${activeSame.name || activeSame.id}. Önce onu kapatın.`,
        items: list, warnings,
      };
    }
  } else {
    const targets = [...new Set((item.scopes || []).flatMap(scope => scope.targets || []))];
    if (targets.length) warnings.push(`Bu kaynak kapatıldı; ${targets.join(', ')} artık ondan veri almayacak.`);
  }

  item.refreshEnabled = want;
  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings, sourceId: item.id };
}

/**
 * KAYNAĞI SİL (§7).
 *
 * Silme, kapatmaktan farklıdır ve GERİ ALINAMAZ: bağlantı, alan eşlemesi,
 * kapsamlar, kapsam filtreleri, CP sütunları ve park edilmiş bağlantılar
 * birlikte gider. Bu yüzden ne sildiğini çağırana SAYARAK döndürür; arayüz
 * onayı bu sayıların üstüne kurulur. "Emin misiniz?" diye sorup ne
 * kaybedileceğini söylememek, kullanıcıya karar değil kumar oynatır.
 *
 * ZORUNLU BESLEME KORUMASI. Bir modül bu kaynak olmadan çalışamıyorsa
 * (source-profiles.requiredModules) silme REDDEDİLİR. Bağlantıyı tek tek
 * kapatmak zaten aynı kuralla engelleniyor; silmeyi açık bırakmak, kilidi
 * arka kapıdan atlatmak olurdu — kullanıcı CP'yi besleyen tek kaynağı
 * silip ekranın neden boş kaldığını sorardı.
 *
 * @returns {{ok, code, message, items, warnings, removed}}
 */
function planSourceDelete(items, { sourceId, expectedName = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };

  const item = list[index];
  const label = item.name || item.id;

  /* Ad teyidi İSTEĞE BAĞLI ama desteklenir: arayüz kullanıcıya kaynağın adını
     yazdırarak yanlış kartı silmesini önler. Gönderilmediyse zorlanmaz —
     betikler ve eski istemciler kırılmamalı. */
  if (expectedName != null && clean(expectedName) !== clean(label)) {
    return {
      ok: false, code: 'NAME_MISMATCH',
      message: `Yazdığınız ad bu kaynağın adıyla eşleşmiyor: ${label}`,
      items: list, warnings,
    };
  }

  const profile = sourceProfiles.fromLegacyRole(item.role);
  const boundTargets = [...new Set((item.scopes || []).flatMap(scope => scope.targets || []))];
  if (profile) {
    const blocking = boundTargets.filter(target => sourceProfiles.isModuleRequired(profile.id, target));
    if (blocking.length) {
      return {
        ok: false, code: 'SOURCE_REQUIRED',
        message: `${label} silinemez: ${blocking.join(', ')} bu veri olmadan çalışamaz. Önce yerine başka bir kaynak bağlayın.`,
        items: list, warnings,
      };
    }
  }

  const removed = {
    id: clean(item.id),
    name: label,
    moduleIds: boundTargets,
    scopeCount: (item.scopes || []).length,
    mappedFieldCount: Object.keys(item.mapping || {}).length,
    cpColumnCount: (item.cpColumns || []).length,
    customFieldCount: (item.customFields || []).length,
    parkedCount: (item.parkedBindings || []).length,
  };
  if (boundTargets.length) {
    warnings.push(`${boundTargets.join(', ')} artık bu kaynaktan veri almayacak.`);
  }

  const next = list.slice();
  next.splice(index, 1);
  return { ok: true, code: 'OK', message: '', items: next, warnings, removed };
}

/**
 * CP SÜTUNLARI (§7 — eski ekranda kalan yetenek).
 *
 * CP Tracker'a katalogda olmayan model sütunları eklemeye yarar. Alan
 * eşlemesinden farkı: eşleme uygulamanın BEKLEDİĞİ bir başlığı bir sütuna
 * bağlar; burası ise uygulamanın hiç bilmediği bir sütunu ekrana taşır ve
 * kendi etiketini taşır.
 *
 * TEK İŞLEM YAZILIR, tüm liste değil. Eşleme düzenleyicisiyle aynı gerekçe:
 * bayat bir görünüm üzerinden tam listeyi göndermek, o arada başka bir
 * pencerede eklenmiş bir sütunu SESSİZCE düşürürdü.
 *
 * YETENEK KONTROLÜ PROFİLDEN GELİR. Pivot raporunda (intake) "CP sütunu"
 * diye bir kavram yok; orada bu isteği kabul etmek, hiçbir yere çıkmayan bir
 * kayıt üretirdi.
 *
 * @param op    'add' | 'update' | 'remove'
 * @returns {{ok, code, message, items, warnings, columnId}}
 */
function planCpColumn(items, { sourceId, op, id, label, group, entry } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };

  const item = clone(list[index]);
  const profile = sourceProfiles.fromLegacyRole(item.role);
  if (!profile || !profile.capabilities.includes('extra-columns')) {
    return {
      ok: false, code: 'CP_COLUMNS_UNSUPPORTED',
      message: `${item.name || item.id} kaynağında CP sütunu kavramı yok.`,
      items: list, warnings,
    };
  }

  const columns = Array.isArray(item.cpColumns) ? clone(item.cpColumns) : [];
  const wantedId = clean(id);
  const action = clean(op) || (wantedId ? 'update' : 'add');
  let writtenId = wantedId;

  if (action === 'remove') {
    if (!wantedId) return { ok: false, code: 'CP_COLUMN_ID_REQUIRED', message: 'Silinecek sütun belirtilmedi.', items: list, warnings };
    const next = columns.filter(column => clean(column.id) !== wantedId);
    if (next.length === columns.length) return { ok: true, code: 'NO_CHANGE', message: '', items: list, warnings };
    item.cpColumns = next;
  } else {
    const cleanLabel = clean(label).slice(0, 120);
    if (!cleanLabel) return { ok: false, code: 'CP_COLUMN_LABEL_REQUIRED', message: 'Sütuna bir başlık verin.', items: list, warnings };
    /* Etiket ÇAKIŞMASI burada yakalanır. db.js aynı etiketi taşıyan ikinci
       kaydı sessizce atıyor; kullanıcı "ekledim ama listede yok" derdi. */
    const clash = columns.find(column => clean(column.id) !== wantedId
      && clean(column.label).toLocaleLowerCase('tr') === cleanLabel.toLocaleLowerCase('tr'));
    if (clash) {
      return {
        ok: false, code: 'CP_COLUMN_LABEL_TAKEN',
        message: `"${cleanLabel}" başlığı bu kaynakta zaten kullanılıyor.`,
        items: list, warnings,
      };
    }

    const existing = wantedId ? columns.find(column => clean(column.id) === wantedId) : null;
    if (wantedId && !existing) {
      return { ok: false, code: 'CP_COLUMN_NOT_FOUND', message: 'Sütun bulunamadı.', items: list, warnings };
    }
    // Sütun kaydı yoksa entry ZORUNLU: etiketi olan ama veriye bağlanmamış bir
    // sütun, CP'de boş bir kolon olarak görünürdü.
    const source = entry && typeof entry === 'object' ? entry : (existing ? { table: existing.table, name: existing.name, kind: existing.kind, folder: existing.folder } : null);
    if (!source || !clean(source.name)) {
      return { ok: false, code: 'CP_COLUMN_SOURCE_REQUIRED', message: 'Bu sütunun hangi model sütunundan geleceğini seçin.', items: list, warnings };
    }

    const record = {
      id: existing ? existing.id : `cpx_${Math.random().toString(36).slice(2, 10)}`,
      label: cleanLabel,
      table: clean(source.table),
      name: clean(source.name),
      kind: clean(source.kind) === 'measure' ? 'measure' : 'column',
      folder: clean(source.folder),
      group: clean(group != null ? group : (existing ? existing.group : '')).slice(0, 40),
    };
    if (existing) columns[columns.indexOf(existing)] = record;
    else {
      if (columns.length >= 40) {
        return { ok: false, code: 'CP_COLUMN_LIMIT', message: 'En fazla 40 CP sütunu eklenebilir.', items: list, warnings };
      }
      columns.push(record);
    }
    item.cpColumns = columns;
    writtenId = record.id;
  }

  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings, columnId: writtenId };
}

/**
 * SORGU MODU: otomatik üretilen DAX mı, elle yazılan DAX mı (§7).
 *
 * Elle yazılan sorgu GÜÇLÜ VE TEHLİKELİDİR: kullanıcının filtresi (Horizon)
 * artık uygulanmaz — sınır sorgunun kendi içindedir. Bu yüzden:
 *
 *   · 'manual'a geçerken sorgu metni ZORUNLUDUR. Boş bir manuel sorgu,
 *     yenilemenin sessizce hiçbir şey getirmemesi demekti.
 *   · Modül bağlantısı olan bir kaynakta geçiş UYARIYLA yapılır; hangi
 *     sayfaların artık filtre yerine bu metne bağlı olduğu söylenir.
 *   · 'auto'ya dönerken sorgu metni SİLİNMEZ. Kullanıcı deneme amacıyla
 *     geri dönmüş olabilir; yazdığı DAX'ı sessizce yok etmek, saatlerce
 *     uğraşılmış bir metni kaybettirmek olurdu.
 *
 * Sorgunun kendisi DOĞRULANMAZ: geçerli DAX'ı burada ayrıştırmak ikinci bir
 * dil yorumlayıcısı yazmak olurdu. Kullanıcı kaydetmeden önce "sına" ile
 * gerçek motorda çalıştırır — tek doğruluk kaynağı odur.
 *
 * @returns {{ok, code, message, items, warnings}}
 */
function planSourceQuery(items, { sourceId, mode, query } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };

  const item = clone(list[index]);
  const profile = sourceProfiles.fromLegacyRole(item.role);
  const wantMode = item.role === 'custom' ? 'manual' : (clean(mode) === 'manual' ? 'manual' : 'auto');

  if (wantMode === 'manual' && (!profile || !profile.capabilities.includes('manual-query'))) {
    return {
      ok: false, code: 'MANUAL_QUERY_UNSUPPORTED',
      message: `${item.name || item.id} kaynağında elle yazılan sorgu desteklenmiyor.`,
      items: list, warnings,
    };
  }

  // Metin boşluklarıyla anlamlıdır (DAX girintisi); clean() KULLANILMAZ.
  const text = query == null ? String(item.query || '') : String(query);
  if (wantMode === 'manual' && !text.trim()) {
    return {
      ok: false, code: 'QUERY_REQUIRED',
      message: 'Elle yazılan sorgu modunda sorgu metni boş bırakılamaz.',
      items: list, warnings,
    };
  }
  if (item.role === 'custom' && item.engine === 'relational-sql' && text.trim()) {
    try { databaseConnector.validateReadOnlyQuery(text); }
    catch (error) {
      return { ok:false, code:error.code || 'QUERY_NOT_ALLOWED', message:String(error.message || error), items:list, warnings };
    }
  }
  if (text.length > 20000) {
    return { ok: false, code: 'QUERY_TOO_LONG', message: 'Sorgu metni 20.000 karakteri aşamaz.', items: list, warnings };
  }

  if (wantMode === 'manual' && item.mode !== 'manual') {
    const targets = [...new Set((item.scopes || []).flatMap(scope => scope.targets || []))];
    if (targets.length) {
      warnings.push(`${targets.join(', ')} artık filtre yerine bu sorgu metniyle sınırlanacak; kapsam filtreleri uygulanmaz.`);
    }
  }
  if (wantMode === 'auto' && item.mode === 'manual' && text.trim()) {
    warnings.push('Otomatik moda dönüldü; yazdığınız sorgu metni saklandı, silinmedi.');
  }

  item.mode = wantMode;
  item.query = text;

  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings };
}

/** Otomatik eşlemenin sonucunu kaynağa yazar (sihirbazın eşleme adımı). */
function planMappingWrite(items, { sourceId, mapping } = {}) {
  const list = Array.isArray(items) ? items : [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings: [] };
  if (!mapping || typeof mapping !== 'object') {
    return { ok: false, code: 'MAPPING_INVALID', message: 'Alan eşlemesi bir nesne olmalı.', items: list, warnings: [] };
  }
  const item = clone(list[index]);
  // Normalleştirme db.js'de yapılır; burada ham eşleme taşınır.
  item.mapping = clone(mapping);
  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings: [], sourceId: item.id };
}

/**
 * TEK bir alanın eşlemesini değiştirir.
 *
 * Neden bütün eşlemeyi değil: istemci bayat bir görünüm üzerinden tam eşlemeyi
 * geri gönderirse, o arada eklenmiş bir alan SESSİZCE düşerdi. Kullanıcı üç
 * alanı düzeltirken dördüncüyü kaybetmemeli.
 *
 * entry null/boş ise alan eşlemeden KALDIRILIR (kullanıcı seçimi geri alabilir).
 */
function planMappingEntry(items, { sourceId, header, entry } = {}) {
  const list = Array.isArray(items) ? items : [];
  const index = list.findIndex(item => item && clean(item.id) === clean(sourceId));
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings: [] };

  const wantedHeader = String(header == null ? '' : header).trim().slice(0, 200);
  if (!wantedHeader) {
    return { ok: false, code: 'HEADER_REQUIRED', message: 'Hangi alanın eşleneceği belirtilmedi.', items: list, warnings: [] };
  }

  const item = clone(list[index]);
  const mapping = { ...(item.mapping && typeof item.mapping === 'object' ? item.mapping : {}) };

  if (!entry || !clean(entry.name)) {
    delete mapping[wantedHeader];
  } else {
    const name = clean(entry.name).slice(0, 300);
    const table = clean(entry.table).slice(0, 200);
    /* kind yalnız iki değer alır. Serbest metin kabul etmek, DAX üretiminde
       ölçü/sütun ayrımını bozar ve sorgu sessizce yanlış sonuç verir. */
    const kind = entry.kind === 'measure' ? 'measure' : 'column';
    mapping[wantedHeader] = { table, name, kind, folder: clean(entry.folder).slice(0, 200) };
  }

  item.mapping = mapping;
  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings: [], sourceId: item.id };
}

/** Excel connection discovery sonucunu AYNI canonical modelConnections store'una yazar.
 * Password/secret bu nesneye hiçbir zaman girmez; kimlik bilgisi local credential
 * store tarafından sourceId ile ayrı tutulur. */
function planDiscoveredSourceCreate(items, { name, connector, query = '', discovery = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  if (list.length >= MAX_SOURCES) return { ok:false, code:'SOURCE_LIMIT', message:`En fazla ${MAX_SOURCES} kaynak tanımlanabilir.`, items:list, warnings };
  const cleanName = clean(name).slice(0, MAX_NAME);
  if (!cleanName) return { ok:false, code:'NAME_REQUIRED', message:'Kaynağa bir ad verin.', items:list, warnings };

  const raw = connector && typeof connector === 'object' ? clone(connector) : {};
  const kind = clean(raw.kind).toLowerCase();
  let normalized = raw;
  let engine = 'relational-sql';
  if (kind === 'analysis-services') {
    const serverProblem = checkName(raw.server, 'Sunucu');
    if (serverProblem) return { ok:false, code:'SERVER_INVALID', message:serverProblem, items:list, warnings };
    const catalogProblem = checkName(raw.database, 'Model');
    if (catalogProblem) return { ok:false, code:'CATALOG_INVALID', message:catalogProblem, items:list, warnings };
    engine = 'tabular-dax';
  } else {
    try { normalized = databaseConnector.validateConnector(raw); }
    catch (error) { return { ok:false, code:error.code || 'CONNECTOR_INVALID', message:String(error.message || error), items:list, warnings }; }
  }

  const sourceId = newId();
  const server = clean(normalized.server || normalized.dsn || normalized.provider || normalized.driver).slice(0, 128);
  const catalog = clean(normalized.database || normalized.serviceName || normalized.sid || normalized.dsn || cleanName).slice(0, 128);
  if (!server || !catalog) return { ok:false, code:'CONNECTION_METADATA_INCOMPLETE', message:'Bağlantı metadata’sında kaynak/database kimliği eksik.', items:list, warnings };

  const duplicate = list.find(item => item && item.role === 'custom'
    && clean(item.server).toLowerCase() === server.toLowerCase()
    && clean(item.catalog).toLowerCase() === catalog.toLowerCase());
  if (duplicate) warnings.push(`Aynı database bağlantısı zaten "${duplicate.name || duplicate.id}" olarak kayıtlı olabilir.`);

  const queryText = String(query == null ? '' : query).slice(0, 20000);
  const item = {
    id: sourceId, name: cleanName, server, catalog, role: 'custom', engine,
    connector: normalized,
    discovery: discovery && typeof discovery === 'object' ? {
      origin: clean(discovery.origin).slice(0, 40), workbookName: clean(discovery.workbookName).slice(0, 240),
      connectionName: clean(discovery.connectionName).slice(0, 180), importedAt: clean(discovery.importedAt).slice(0, 40),
    } : null,
    query: queryText, mode: queryText.trim() ? 'manual' : 'auto', format: 'json', outputName: cleanName,
    refreshEnabled: true, horizon: {}, scopes: [], mapping: {}, customFields: [], cpColumns: [], parkedBindings: [],
  };
  return { ok:true, code:'OK', message:'', items:list.concat([item]), warnings, sourceId };
}

/** Sihirbazın "hangi modülleri besleyebilir" adımı için seçenekler. */
function createOptions() {
  return sourceProfiles.list().map(profile => ({
    id: profile.id,
    // Otomatik eşleme ucu hâlâ eski `role` sözleşmesini konuşuyor; profil ile
    // rol arasındaki eşleme TEK yerde (source-profiles) durur, istemci uydurmaz.
    legacyRole: profile.legacyRole,
    label: profile.label,
    summary: profile.summary,
    engine: profile.engine,
    shape: profile.shape,
    feedableModules: profile.feedableModules.slice(),
    capabilities: profile.capabilities.slice(),
    creationMethods: Array.isArray(profile.creationMethods) ? profile.creationMethods.slice() : ['manual'],
  }));
}

module.exports = {
  MAX_NAME, MAX_SOURCES,
  planSourceCreate, planDiscoveredSourceCreate, planSourceUpdate, planSourceEnabled, planSourceDelete,
  planCpColumn, planSourceQuery, planMappingWrite, planMappingEntry,
  createOptions,
  _checkName: checkName,
};
