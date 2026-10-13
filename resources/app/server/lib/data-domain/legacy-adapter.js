'use strict';

/* ===================================================================
   LEGACY ⇄ DOMAIN ADAPTER (Data Management P0)

   Bugün her şey TEK bir kayıt tipinde duruyor: modelConnections[i].
   Bağlantı, alan eşlemesi, filtre ve "hangi sayfayı besliyor" bilgisi
   aynı nesnenin içinde iç içe. Bu yüzden:

     · bir modülün bağlantısını kaldırmak eşlemesini de götürüyor (§11),
     · aynı filtre dört ayrı yerde kopyalanıyor,
     · iki yönetici aynı anda çalışamıyor (tek dizi, tek revizyon).

   Bu dosya o tek kaydı dört bağımsız varlığa AYIRIR ve geri BİRLEŞTİRİR:

     DataSource     — bağlantı: sunucu, model, sorgu modu
     MappingSet     — alan eşlemesi (kaynağa ait, bağlantıdan bağımsız)
     FilterSet      — filtre tanımı (paylaşılabilir)
     ModuleBinding  — hangi kaynak hangi modülü hangi filtreyle besliyor

   SÖZLEŞME — KAYIPSIZ GİDİŞ-DÖNÜŞ:

       toLegacy(fromLegacy(items))  ===  items          (derin eşitlik)

   Bu, migration'ın kanıtıdır. Ayrıca üretilen DAX'ın birebir aynı kalması
   ayrı bir testle sınanır. Adapter hiçbir değeri "düzeltmez", "tahmin
   etmez" ve varsayılan uydurmaz — yalnız yeniden şekillendirir.

   SAF MODÜL: disk, ağ ve db.js yok. Bu yüzden test edilebilir ve
   döngüsel bağımlılık üretmez.
   =================================================================== */

const crypto = require('crypto');
const sourceProfiles = require('./source-profiles');
const { canonicalize } = require('../horizon-source-planner');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

/* Kimlikler DETERMİNİSTİK olmak zorunda (§40). Migration ikinci kez
   çalıştığında aynı girdi aynı kimlikleri üretmeli; aksi hâlde her koşumda
   yeni bir FilterSet doğar ve kitaplık çoğalır. Math.random() kullanılmaz. */
function stableId(prefix, ...parts) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(parts)), 'utf8')
    .digest('hex');
  return `${prefix}_${digest.slice(0, 16)}`;
}

function signature(value) {
  return JSON.stringify(canonicalize(value == null ? null : value));
}

/* TEK BİR KAYNAĞIN YAPILANDIRMA SÜRÜMÜ (P9).

   Depodaki revizyon sayacı BÜTÜN diziye aittir: bir yönetici ASAS'ı, diğeri
   IAS'ı düzenlese bile ikincisi "başkası değiştirdi" diye reddediliyordu.
   Ölçüldü ve doğrulandı — §42'nin çekirdek şikâyeti buydu.

   Çözüm depo düzenini değiştirmeden: her kaynağın KENDİ yapılandırmasının
   parmak izi. Yazma yalnız dokunduğu kaynağın parmak izini kontrol eder;
   başka bir kaynaktaki eşzamanlı düzenleme artık engel değildir.

   lastRun BİLEREK DIŞARIDA: her yenilemede değişir ve bir yapılandırma
   düzenlemesi değildir. İçeride olsaydı, arka planda çalışan bir yenileme
   kullanıcının açık ekranını sürekli bayatlatırdı. */
function configRevision(item) {
  const source = item && typeof item === 'object' ? item : {};
  const config = { ...source };
  delete config.lastRun;
  return crypto.createHash('sha256')
    .update(signature(config), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/* -------------------------------------------------------------------
   LEGACY → DOMAIN
   ------------------------------------------------------------------- */

/**
 * @param {Array} items  db.js normalizeModelConnections() çıktısı
 * @returns {{sources, mappingSets, filterSets, bindings, retired, warnings}}
 */
function fromLegacy(items) {
  const list = Array.isArray(items) ? items : [];
  const sources = [];
  const mappingSets = [];
  const filterSets = [];
  const bindings = [];
  const retired = [];
  const warnings = [];

  // Kaynak içinde aynı tanımı taşıyan filtreler TEK bir FilterSet'e düşer.
  // Ad da imzaya dahildir: kullanıcı iki kapsama ayrı ad verdiyse bu bilinçli
  // bir ayrımdır ve birleştirilmez.
  const filterIndex = new Map();

  list.forEach((raw, order) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const legacyRole = clean(item.role);

    // Kullanımdan kaldırılmış rol (fabric). Silinmez, taşınır (§15).
    if (sourceProfiles.isRetiredRole(legacyRole)) {
      retired.push({ order, legacyRole, item: clone(item) });
      return;
    }

    const profile = sourceProfiles.fromLegacyRole(legacyRole);
    if (!profile) {
      // Tanınmayan rol: veriyi kaybetmektense olduğu gibi taşı ve uyar.
      retired.push({ order, legacyRole, item: clone(item), unknown: true });
      warnings.push(`"${legacyRole || '(boş)'}" rolü için kaynak profili yok; bağlantı olduğu gibi korundu ama yeni ekranda görünmez.`);
      return;
    }

    const sourceId = clean(item.id);
    const mappingSetId = stableId('ms', sourceId);

    mappingSets.push({
      id: mappingSetId,
      sourceId,
      profileId: profile.id,
      // Eşleme birebir taşınır. normalizeMapping zaten {table,name,kind,folder}
      // yapısına indirgemiş durumda; burada yeniden yorumlanmaz.
      entries: clone(item.mapping) || {},
      // Katalogda olmayan, kullanıcının elle eklediği başlıklar.
      customFields: clone(item.customFields) || [],
      // CP tablosuna eklenen salt-okunur model sütunları.
      extraColumns: clone(item.cpColumns) || [],
    });

    /* Bir filtre tanımını FilterSet'e çevirir; aynısı daha önce görüldüyse
       mevcut kaydı paylaştırır ve onu kullanan modülü işaretler. */
    function intern(definition, name, origin, moduleIds) {
      const key = `${sourceId}::${signature({ name: clean(name), definition })}`;
      let entry = filterIndex.get(key);
      if (!entry) {
        entry = {
          id: stableId('fs', sourceId, clean(name), definition),
          name: clean(name),
          // P0'da her filtre ORTAK katmandadır. Kişisel override'lar
          // user-preferences içinde ayrı yaşar ve P3'te bu kitaplığa taşınır.
          scope: 'shared',
          ownerId: null,
          sourceId,
          origin,
          definition: clone(definition) || {},
          moduleIds: [],
        };
        filterIndex.set(key, entry);
        filterSets.push(entry);
      }
      for (const moduleId of moduleIds || []) {
        if (!entry.moduleIds.includes(moduleId)) entry.moduleIds.push(moduleId);
      }
      return entry.id;
    }

    // Bağlantının kendi ufku: hiçbir kapsam bulunamazsa kullanılan taban.
    const defaultFilterSetId = intern(item.horizon, '', 'connection', []);

    sources.push({
      id: sourceId,
      name: clean(item.name),
      profileId: profile.id,
      engine: clean(item.engine) || profile.engine,
      connection: { server: clean(item.server), catalog: clean(item.catalog), connector: clone(item.connector) || null, discovery: clone(item.discovery) || null },
      query: {
        mode: item.mode === 'manual' ? 'manual' : 'auto',
        text: String(item.query == null ? '' : item.query),
        format: item.format === 'json' ? 'json' : 'csv',
        outputName: clean(item.outputName),
      },
      // Eski adıyla refreshEnabled. Rol başına tek aktif bağlantı kuralı
      // db.js'de yaşamaya devam eder; adapter o kuralı uygulamaz.
      enabled: item.refreshEnabled !== false,
      mappingSetId,
      defaultFilterSetId,
      markers: {
        defaultSeasonsApplied: item.defaultSeasonsApplied === true,
        mappingEnhancementScanVersion: Number(item.mappingEnhancementScanVersion) || 0,
        ...(Object.hasOwn(item, '_configVersion') ? { configVersion: item._configVersion } : {}),
      },
      lastRun: clone(item.lastRun) || null,
      legacyRole,
      /* Kapatılmış modül bağlantıları. Domain tarafında binding OLARAK
         doğmazlar (çünkü hiçbir sorguyu beslemiyorlar) ama kaybolmazlar:
         arayüz "tekrar bağlarsan eski filtren geri gelir" diyebilmeli. */
      parkedBindings: clone(item.parkedBindings) || [],
      /* Bağlı grup üyeliği ve ayrılan modüllerin saklanan filtreleri (v20260929).
         Yalnız kayıtta varsa taşınır; gidiş-dönüş eşitliği bozulmasın. */
      ...(Array.isArray(item.linkedTargets) ? { linkedTargets: clone(item.linkedTargets) } : {}),
      ...(Array.isArray(item.linkRestore) ? { linkRestore: clone(item.linkRestore) } : {}),
      order,
    });

    // Kapsamlar → modül bağlantıları. Bir kapsam N hedef taşıyorsa N binding
    // doğar ve hepsi AYNI FilterSet'i işaret eder: paylaşılan filtre kavramı
    // (§19) bugünkü veride zaten fiilen mevcut, sadece adı yoktu.
    const scopes = Array.isArray(item.scopes) ? item.scopes : [];
    scopes.forEach((scope, scopeOrder) => {
      const targets = Array.isArray(scope && scope.targets) ? scope.targets : [];
      if (!targets.length) return;

      const impossible = targets.filter(moduleId => !sourceProfiles.canFeed(profile.id, moduleId));
      if (impossible.length) {
        warnings.push(`${clean(item.name) || sourceId}: "${impossible.join(', ')}" bu kaynak profilinin besleyebileceği modüller arasında değil.`);
      }

      const filterSetId = intern(scope.horizon, scope.name, 'scope', targets);

      targets.forEach((moduleId, targetOrder) => {
        bindings.push({
          id: stableId('mb', sourceId, moduleId),
          sourceId,
          moduleId: clean(moduleId),
          mappingSetId,
          filterSetId,
          enabled: scope.enabled !== false,
          order: scopeOrder * 100 + targetOrder,
          // Eski kapsam kimliği ve adı geri yazma için saklanır. Kapsam
          // gruplaması kullanıcı tarafından kurulmuş bir yapıdır; adapter
          // onu yeniden icat etmez.
          legacy: {
            scopeId: clean(scope.id),
            scopeName: clean(scope.name),
            scopeOrder,
            limitToCpOrders: scope.limitToCpOrders === true,
          },
        });
      });
    });
  });

  return { sources, mappingSets, filterSets, bindings, retired, warnings };
}

/* -------------------------------------------------------------------
   DOMAIN → LEGACY
   ------------------------------------------------------------------- */

/**
 * Domain kayıtlarını db.js'in beklediği modelConnections dizisine çevirir.
 * Çıktı, replaceModelConnections()'a doğrudan verilebilir.
 */
function toLegacy(domain) {
  const model = domain && typeof domain === 'object' ? domain : {};
  const sources = Array.isArray(model.sources) ? model.sources : [];
  const mappingSets = new Map((Array.isArray(model.mappingSets) ? model.mappingSets : []).map(entry => [entry.id, entry]));
  const filterSets = new Map((Array.isArray(model.filterSets) ? model.filterSets : []).map(entry => [entry.id, entry]));
  const bindings = Array.isArray(model.bindings) ? model.bindings : [];
  const retired = Array.isArray(model.retired) ? model.retired : [];

  const bySource = new Map();
  for (const binding of bindings) {
    if (!bySource.has(binding.sourceId)) bySource.set(binding.sourceId, []);
    bySource.get(binding.sourceId).push(binding);
  }

  const emitted = sources.map(source => {
    const mapping = mappingSets.get(source.mappingSetId) || { entries: {}, customFields: [], extraColumns: [] };
    const defaultFilter = filterSets.get(source.defaultFilterSetId) || { definition: {} };

    /* Kapsamları yeniden kur. Gruplama anahtarı ESKİ kapsam kimliği VE
       sırasıdır; kullanıcının kurduğu gruplama korunur.

       Sıra neden anahtarın parçası: model-scopes.isolateOrdersScope() Orders
       hedefini ayrı bir kapsama çıkarırken kaynak kapsamın KİMLİĞİNİ kopyalar.
       Yani normalizeScopes çıktısında aynı id'yi taşıyan iki ayrı kapsam
       bulunabilir. Yalnız id'ye göre gruplamak bu ikisini sessizce tek kapsamda
       birleştirir ve Orders'ın bağımsız ufku kaybolur.

       Kimliği olmayan (yeni eklenmiş) bağlantılar filtre kimliğine göre
       gruplanır — aynı filtreyi paylaşan modüller tek kapsam, yani tek sorgu. */
    const groups = new Map();
    for (const binding of (bySource.get(source.id) || []).slice().sort((a, b) => a.order - b.order)) {
      const legacy = binding.legacy || {};
      const key = clean(legacy.scopeId)
        ? `${clean(legacy.scopeId)}#${Number.isFinite(legacy.scopeOrder) ? legacy.scopeOrder : 0}`
        : `filter:${binding.filterSetId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: clean(legacy.scopeId),
          name: clean(legacy.scopeName),
          targets: [],
          enabled: binding.enabled !== false,
          limitToCpOrders: legacy.limitToCpOrders === true,
          filterSetId: binding.filterSetId,
          order: Number.isFinite(legacy.scopeOrder) ? legacy.scopeOrder : binding.order,
        });
      }
      groups.get(key).targets.push(binding.moduleId);
    }

    const scopes = [...groups.values()]
      .sort((a, b) => a.order - b.order)
      .map(group => {
        const filter = filterSets.get(group.filterSetId) || { definition: {} };
        const scope = {
          id: group.id,
          name: group.name,
          targets: group.targets,
          enabled: group.enabled,
          limitToCpOrders: group.limitToCpOrders,
          horizon: clone(filter.definition) || {},
        };
        return scope;
      });

    return {
      id: source.id,
      name: source.name,
      server: source.connection ? source.connection.server : '',
      catalog: source.connection ? source.connection.catalog : '',
      engine: source.engine || '',
      connector: source.connection ? (clone(source.connection.connector) || null) : null,
      discovery: source.connection ? (clone(source.connection.discovery) || null) : null,
      query: source.query ? source.query.text : '',
      format: source.query && source.query.format === 'json' ? 'json' : 'csv',
      outputName: source.query ? source.query.outputName : '',
      mode: source.query && source.query.mode === 'manual' ? 'manual' : 'auto',
      role: sourceProfiles.toLegacyRole(source.profileId) || source.legacyRole || '',
      refreshEnabled: source.enabled !== false,
      defaultSeasonsApplied: Boolean(source.markers && source.markers.defaultSeasonsApplied),
      mappingEnhancementScanVersion: Number(source.markers && source.markers.mappingEnhancementScanVersion) || 0,
      ...(Object.hasOwn(source.markers || {}, 'configVersion') ? { _configVersion: source.markers.configVersion } : {}),
      horizon: clone(defaultFilter.definition) || {},
      scopes,
      parkedBindings: clone(source.parkedBindings) || [],
      ...(Array.isArray(source.linkedTargets) ? { linkedTargets: clone(source.linkedTargets) } : {}),
      ...(Array.isArray(source.linkRestore) ? { linkRestore: clone(source.linkRestore) } : {}),
      mapping: clone(mapping.entries) || {},
      customFields: clone(mapping.customFields) || [],
      cpColumns: clone(mapping.extraColumns) || [],
      lastRun: clone(source.lastRun) || null,
      _order: source.order,
    };
  });

  // Taşınan eski/tanınmayan kayıtlar orijinal sıralarına geri konur.
  const all = emitted.concat(retired.map(entry => ({ ...clone(entry.item), _order: entry.order })));
  all.sort((a, b) => (Number(a._order) || 0) - (Number(b._order) || 0));
  return all.map(item => { const out = { ...item }; delete out._order; return out; });
}

/* -------------------------------------------------------------------
   YARDIMCI SORGULAR — yeni arayüzün okuyacağı görünümler
   ------------------------------------------------------------------- */

/** Bir modülü besleyen bütün bağlantılar (kaynak + filtre çözülmüş hâlde). */
function bindingsForModule(domain, moduleId) {
  const wanted = clean(moduleId);
  const sources = new Map((domain.sources || []).map(entry => [entry.id, entry]));
  const filterSets = new Map((domain.filterSets || []).map(entry => [entry.id, entry]));
  return (domain.bindings || [])
    .filter(binding => binding.moduleId === wanted)
    .map(binding => ({
      binding,
      source: sources.get(binding.sourceId) || null,
      filterSet: filterSets.get(binding.filterSetId) || null,
    }));
}

/** Bir filtreyi kaç modül kullanıyor — "3 modül bunu kullanıyor" uyarısı için. */
function filterUsage(domain, filterSetId) {
  const wanted = clean(filterSetId);
  return (domain.bindings || []).filter(binding => binding.filterSetId === wanted).map(binding => binding.moduleId);
}

/**
 * Matris hücresinin durumu. Arayüz üç hâli birbirine karıştırmamalı:
 *   'on'          bağlı ve etkin
 *   'off'         bağlanabilir ama kapalı
 *   'unavailable' bu kaynak bu modülü YAPISAL OLARAK besleyemez
 */
function cellState(domain, sourceId, moduleId) {
  const source = (domain.sources || []).find(entry => entry.id === clean(sourceId));
  if (!source) return 'unavailable';
  if (!sourceProfiles.canFeed(source.profileId, moduleId)) return 'unavailable';
  const binding = (domain.bindings || []).find(entry => entry.sourceId === source.id && entry.moduleId === clean(moduleId));
  if (!binding) return 'off';
  return binding.enabled === false ? 'off' : 'on';
}

module.exports = {
  fromLegacy, toLegacy,
  bindingsForModule, filterUsage, cellState,
  stableId, signature, configRevision,
};
