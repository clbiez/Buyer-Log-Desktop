'use strict';

/* ===================================================================
   DATA MANAGEMENT OKUMA MODELİ (P2)

   Yeni ekranın TEK veri kaynağı. Arayüz modelConnections'ı ham hâliyle
   okumaz; okusaydı rol adları, kapsam dizileri ve ufuk nesneleri yeniden
   istemciye sızar ve eski karmaşa yeni ekranda tekrar kurulurdu.

   Burası saf bir projeksiyondur: yazmaz, sorgu atmaz, diske dokunmaz.
   Veritabanına bağlanmadığı için bir kaynak erişilemez olsa bile ekran
   açılır — "kaynak erişilemezken uygulama normal çalışmaya devam eder"
   güvencesi (CLAUDE.md §10) bu ekran için de geçerlidir.

   ÜÇ HÂLİ BİRBİRİNE KARIŞTIRMAZ:
     on          → bağlı ve etkin
     off         → bağlanabilir ama kapalı
     unavailable → bu kaynak bu modülü YAPISAL OLARAK besleyemez

   Üçüncüsü mock-up'ta yoktu; olmadığı için ekran kullanıcıya var olmayan
   27 hücreden 16'sını "kapatılabilir bağlantı" gibi gösteriyordu.
   =================================================================== */

const horizon = require('../modelHorizon');
const modelFields = require('../model-fields');
const moduleRegistry = require('../module-registry');
const sourceProfiles = require('./source-profiles');
const adapter = require('./legacy-adapter');
const bindingWriter = require('./binding-writer');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

/* Bir filtrenin sorguyu gerçekten sınırlayıp sınırlamadığı.
   source-filter-readiness.js ile AYNI ölçüt kullanılır: yarım kalmış bir
   koşul (alan seçili, değer yok) sınırlayıcı SAYILMAZ ve istisna fırlatır. */
function describeFilter(definition) {
  let expression = '';
  let conditionCount = 0;
  let groupCount = 0;
  let error = '';
  try {
    const built = horizon.buildHorizonFilter(definition || {});
    expression = clean(built.expression);
    conditionCount = Number(built.conditionCount) || 0;
    groupCount = Number(built.groupCount) || 0;
  } catch (err) {
    error = String(err && err.message || err);
  }

  let text = '';
  try { text = clean(horizon.describeHorizon(definition || {}).text); } catch (_) { text = ''; }

  // Koşul grubu yoksa eski sezon/tarih ayarı okunabilir hâle getirilir;
  // describeHorizon yalnız grupları anlatır.
  if (!text) {
    const normalized = (() => { try { return horizon.normalizeHorizon(definition || {}); } catch (_) { return null; } })();
    const parts = [];
    if (normalized && normalized.seasons.length) parts.push(`Sezon: ${normalized.seasons.join(', ')}`);
    if (normalized && (normalized.dateStart || normalized.dateEnd)) {
      parts.push(`Tarih: ${normalized.dateStart || '…'} → ${normalized.dateEnd || '…'}`);
    }
    text = parts.join(' · ');
  }

  return {
    bounded: Boolean(expression),
    conditionCount,
    groupCount,
    text,
    error,
  };
}

function sourceStatus(source, filterInfo) {
  if (!source.connection || !source.connection.server || !source.connection.catalog) return 'unconfigured';
  if (source.enabled === false) return 'disabled';
  /* Eksik ZORUNLU alan, son yenileme başarılı görünse bile bir sonrakini
     kesin olarak engeller (model-refresh MAPPING_INCOMPLETE ile durur).
     Bunu "hata"dan önce raporlamak, kullanıcının düzeltilebilir bir kurulum
     eksiğini geçici bir ağ arızası sanmasını önler. */
  if (filterInfo && filterInfo.mappingBlocking) return 'needs-mapping';
  if (source.lastRun && source.lastRun.ok === false) return 'error';
  if (filterInfo && filterInfo.someUnbounded) return 'needs-filter';
  return 'ready';
}

/**
 * @param {Array}  items     db.loadModelConnections().items
 * @param {Object} options
 *   language     'tr' | 'en'
 *   resolveLayer ({moduleId, sourceId, role, definition}) => {horizon, layer, preferenceLayer}
 *
 * resolveLayer ENJEKTE EDİLİR, burada hesaplanmaz: kişisel/rol/ön ayar
 * katmanları user-preferences'ın işidir ve bu modül saf kalmalıdır. Verilmezse
 * ekran yalnız ortak (kaynak) katmanı gösterir — yanlış bir katman uydurmaz.
 */
function build(items, options = {}) {
  const language = options.language === 'en' ? 'en' : 'tr';
  const resolveLayer = typeof options.resolveLayer === 'function' ? options.resolveLayer : null;
  const domain = adapter.fromLegacy(items);

  /* Hangi hedefler kapatılamaz? Cevap kaynağın PROFİLİNDEN gelir
     (source-profiles.requiredModules, bkz. binding-writer). Ekran ve yazma
     yolu aynı kaydı okur; ikisi ayrı listeler tutsaydı biri "kapatabilirsin"
     der, diğeri reddeder ve kullanıcıya geri sıçrayan bir anahtar gösterirdi. */
  const lockedBySource = new Map();
  /* Kaynak başına yapılandırma sürümü (P9). Yazma bunu geri gönderir ve sunucu
     YALNIZ dokunulan kaynağı karşılaştırır; başka bir kaynakta çalışan ikinci
     bir yönetici artık engel değildir. */
  const revisionBySource = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || sourceProfiles.isRetiredRole(raw.role)) continue;
    lockedBySource.set(clean(raw.id), new Set(bindingWriter.lockedTargets(raw)));
    revisionBySource.set(clean(raw.id), adapter.configRevision(raw));
  }

  const filterById = new Map(domain.filterSets.map(entry => [entry.id, entry]));
  const sourceById = new Map(domain.sources.map(entry => [entry.id, entry]));

  /* ---- Filtreler ---- */
  const filterSets = domain.filterSets.map(entry => {
    const described = describeFilter(entry.definition);
    return {
      id: entry.id,
      name: entry.name,
      sourceId: entry.sourceId,
      sourceName: (sourceById.get(entry.sourceId) || {}).name || '',
      scope: entry.scope,
      origin: entry.origin,
      moduleIds: entry.moduleIds.slice(),
      usedByCount: entry.moduleIds.length,
      ...described,
    };
  });
  const describedById = new Map(filterSets.map(entry => [entry.id, entry]));

  /* ---- Kaynaklar ---- */
  const sources = domain.sources.map(source => {
    const profile = sourceProfiles.get(source.profileId) || {};
    const bindings = domain.bindings.filter(binding => binding.sourceId === source.id);
    const boundFilters = [...new Set(bindings.map(binding => binding.filterSetId))]
      .map(id => describedById.get(id)).filter(Boolean);
    const someUnbounded = bindings.length > 0 && boundFilters.some(entry => !entry.bounded);

    /* Eşleme sağlığı. Şema okunmaz, ağa çıkılmaz: katalog + saklanmış eşleme
       yeter. Bu sayede kaynak erişilemezken bile "3 alan gözden geçirilmeli"
       bilgisi doğru kalır. */
    const mappingSet = domain.mappingSets.find(entry => entry.id === source.mappingSetId);
    const health = profile.capabilities && profile.capabilities.includes('field-mapping')
      ? modelFields.mappingHealth(source.legacyRole, (mappingSet && mappingSet.entries) || {})
      : null;

    return {
      id: source.id,
      name: source.name || source.connection.catalog || source.connection.server,
      profileId: source.profileId,
      profileLabel: profile.label ? (profile.label[language] || profile.label.tr) : '',
      engine: source.engine,
      shape: profile.shape || 'rows',
      connection: { server: source.connection.server, catalog: source.connection.catalog },
      connector: source.connection.connector ? clone(source.connection.connector) : null,
      discovery: source.connection.discovery ? clone(source.connection.discovery) : null,
      queryMode: source.query.mode,
      /* SORGU METNİ de gider — özet değil, kendisi. Düzenleyicinin düzenlediği
         şey tam olarak budur; kesmek editörü boş açar ve kaydedince kullanıcının
         saatlerce uğraştığı DAX'ı silerdi (eşleme tanımıyla aynı gerekçe).
         Otomatik moddaki saklanmış metin de gönderilir: kullanıcı geri
         döndüğünde yazdığını bulmalı. */
      query: source.query.text,
      enabled: source.enabled,
      status: sourceStatus(source, { someUnbounded, mappingBlocking: Boolean(health && health.summary.blocking) }),
      moduleCount: bindings.filter(binding => binding.enabled !== false).length,
      feedableModules: profile.feedableModules ? profile.feedableModules.slice() : [],
      // Bu kaynağa yazarken geri gönderilir; eşzamanlılık kontrolü buna bakar.
      revision: revisionBySource.get(source.id) || '',
      lockedModules: [...(lockedBySource.get(source.id) || [])],
      /* Kapatılmış ama ayarları saklanan bağlantılar. Arayüz "tekrar bağlarsan
         eski filtren geri gelir" diyebilmeli; §11'in sözü ancak görünürse
         kullanıcı için bir güvence olur. */
      parkedModules: (source.parkedBindings || []).map(entry => ({
        moduleId: entry.moduleId,
        filterName: entry.scopeName || '',
        parkedAt: entry.parkedAt || '',
      })),
      capabilities: profile.capabilities ? profile.capabilities.slice() : [],
      mappedFieldCount: mappingSet ? Object.keys(mappingSet.entries || {}).length : 0,
      /* CP SÜTUNLARI (§7 — eski ekrandan taşınan yetenek).
         Alan eşlemesinden farklı: eşleme uygulamanın beklediği bir başlığı
         bir sütuna bağlar, bu ise uygulamanın hiç bilmediği bir sütunu CP
         Tracker'a taşır. Liste kısa (en çok 40) ve tamamı düzenlenebilir
         olduğu için özet değil, kendisi gönderilir. */
      cpColumns: ((mappingSet && mappingSet.extraColumns) || []).map(column => ({
        id: column.id,
        label: column.label,
        column: column.name,
        table: column.table || '',
        kind: column.kind || 'column',
        folder: column.folder || '',
        group: column.group || '',
      })),
      /* Ekrana yalnız ÖZET ve SORUNLU alanlar gider. 37–50 satırlık tam liste
         istemciye hiç taşınmaz: kullanıcının bakması gereken 3 satırsa, ağdan
         3 satır geçer. Tam listeyi görmek isteyen mevcut eşleme ekranını açar. */
      mapping: health ? {
        ...health.summary,
        problems: health.fields
          .filter(field => field.status === 'weak' || field.status === 'foreign' || (field.status === 'unmapped' && field.required))
          .map(field => ({
            header: field.header,
            status: field.status,
            required: field.required,
            identity: field.identity,
            column: field.column,
            table: field.table,
            expected: field.expected.slice(0, 4),
          })),
      } : null,
      lastRun: source.lastRun ? {
        at: source.lastRun.at || '',
        ok: source.lastRun.ok === true,
        rowCount: Number(source.lastRun.rowCount) || 0,
        error: clean(source.lastRun.error),
      } : null,
    };
  });

  /* ---- Modüller ---- */
  const fedModuleIds = sourceProfiles.feedableModules();
  const modules = fedModuleIds.map(moduleId => {
    const registered = moduleRegistry.get(moduleId);
    /* Sıralama ÖNCE kaynağa göre: bir modülün satırında kaynaklar her zaman
       kart şeridiyle aynı sırada görünmeli. Yalnız binding.order kullanmak
       IAS'ı ASAS'ın önüne atabiliyordu, çünkü o sıra kapsam indeksinden
       gelir ve kapsam sayısı kaynaktan kaynağa değişir. */
    const sourceOrder = new Map(domain.sources.map((entry, index) => [entry.id, index]));
    const feeds = domain.bindings
      .filter(binding => binding.moduleId === moduleId)
      .sort((a, b) => (sourceOrder.get(a.sourceId) - sourceOrder.get(b.sourceId)) || (a.order - b.order))
      .map(binding => {
        const source = sourceById.get(binding.sourceId);
        const shared = describedById.get(binding.filterSetId);

        /* Ekranda GÖSTERİLEN filtre, gerçekte ÇALIŞACAK filtredir. Kişisel bir
           ufuk ortak kapsamı eziyorsa ortak olanı göstermek, kullanıcının
           "ayarı değiştirdim ama hiçbir şey olmadı" demesine yol açan durumun
           ta kendisiydi. Ezen katman ayrıca rozetle söylenir. */
        const stored = filterById.get(binding.filterSetId);
        let effective = shared;
        let layer = 'source';
        /* Ezen katmanın HANGİ KAYITTA durduğu — ekran "bunu kaldır"
           diyebilmek için silinecek kaydı bilmek zorunda. */
        let layerKey = '';
        if (resolveLayer && shared) {
          const resolved = resolveLayer({
            moduleId,
            sourceId: binding.sourceId,
            role: source ? source.legacyRole : '',
            definition: (stored && stored.definition) || {},
          });
          if (resolved && resolved.layer) {
            layer = resolved.layer;
            layerKey = layer === 'source' ? '' : String(resolved.preferenceLayer || '');
            if (layer !== 'source') {
              /* ADI DA DÜŞÜR. Ortak filtrenin adını koruyup içeriğini kişisel
                 ufukla değiştirmek, ekranın "Licensing Core" yazıp aslında
                 bambaşka bir kapsam çalıştırması demekti — düzeltmeye
                 çalıştığımız yanlış anlamanın daha kötü bir hâli. Ezen
                 katmanların hiçbirinin kendi adı yoktur. */
              effective = { ...shared, name: '', ...describeFilter(resolved.horizon) };
            }
          }
        }

        return {
          sourceId: binding.sourceId,
          sourceName: source ? (source.name || source.connection.catalog) : '',
          /* v7.81 — ASAS→IAS filtre eşlemesi için gerekli: ekran, bir modülü
             besleyen İKİ kaynağın hangisinin hangisi olduğunu bilmeli. */
          sourceRole: source ? source.legacyRole : '',
          enabled: binding.enabled !== false,
          // Kapatılamayan bağlantıda "kopar" düğmesi gösterilmez.
          locked: (lockedBySource.get(binding.sourceId) || new Set()).has(moduleId),
          filterSetId: binding.filterSetId,
          filterName: effective ? effective.name : '',
          filterText: effective ? effective.text : '',
          filterBounded: effective ? effective.bounded : false,
          // Paylaşım sayısı aşağıda, bütün modüller çözümlendikten sonra
          // FİİLİ kullanıma göre yeniden yazılır (bkz. effectiveUsage).
          filterUsedByCount: layer === 'source' && shared ? shared.usedByCount : 0,
          conditionCount: effective ? effective.conditionCount : 0,
          layer,
          layerKey,
          /* Kullanıcı bu katmanı KENDİSİ kaldırabilir mi? Yalnız kendi kişisel
             kaydı kaldırılabilir; ön ayar ve rol şablonu çalışma alanının
             kararıdır ve buradan silinseydi başka kullanıcıları da etkilerdi. */
          layerRemovable: layerKey === 'personal' || layerKey === 'personalDefault',
          // Ortak katman ezildiyse ekranda "neyin üstüne yazıldığı" söylenebilsin.
          sharedFilterName: shared ? shared.name : '',
          sharedFilterText: shared ? shared.text : '',
          /* DÜZENLEME İÇİN gereken ham tanım. Ekran genel olarak ham kaydı
             okumaz (bkz. dosya başlığı) ama düzenleyicinin düzenlediği şey
             tam olarak budur; özetini göndermek editörü çalışamaz hâle
             getirirdi.

             EZEN KATMAN VARKEN DE GÖNDERİLİR. Düzenleyici her hâlükârda ORTAK
             katmanı düzenler; tanımı kesmek, kullanıcının boş bir editör açıp
             kaydettiğinde ortak filtreyi SİLMESİ demek olurdu. Gösterilen
             (ezen) filtre ile düzenlenen (ortak) filtre farklıdır ve ekran
             bunu açıkça söyler. */
          definition: stored ? clone(stored.definition) : null,
          // Aynı ortak filtreyi paylaşan diğer modüller — "hepsini güncelle mi,
          // ayır mı?" kararı bunlara bakılarak verilir (§19). Ezen katman bu
          // kararı değiştirmez: ortak filtreyi yazmak yine hepsini etkiler.
          sharedModuleIds: shared ? shared.moduleIds.filter(id => id !== moduleId) : [],
        };
      });
    return {
      id: moduleId,
      // INTAKE'in module-registry'de kendi kaydı yok: Overview'un içinde yaşar.
      label: registered ? (registered.label[language] || registered.label.tr) : moduleId.toUpperCase(),
      route: registered ? registered.route : null,
      feeds,
      connectedCount: feeds.filter(feed => feed.enabled).length,
      needsFilter: feeds.some(feed => feed.enabled && !feed.filterBounded),
    };
  });

  /* ---- Paylaşım sayısını FİİLİ kullanıma göre düzelt ----

     Bir ortak filtreye üç modül bağlı olabilir ama ikisinde kişisel ufuk
     ezdiyse o filtreyi gerçekte tek modül çalıştırıyordur. "3×" yazmak
     kullanıcıya yanlış bir paylaşım korkusu verir. Rozet fiili sayıyı
     gösterir; toplam bağ sayısı ayrıca taşınır, çünkü ortak filtreyi
     DÜZENLEMEK hâlâ üç bağı da etkiler. */
  const effectiveUsage = new Map();
  for (const module of modules) {
    for (const feed of module.feeds) {
      if (feed.layer !== 'source') continue;
      effectiveUsage.set(feed.filterSetId, (effectiveUsage.get(feed.filterSetId) || 0) + 1);
    }
  }
  for (const module of modules) {
    for (const feed of module.feeds) {
      feed.boundModuleCount = (describedById.get(feed.filterSetId) || {}).usedByCount || 0;
      feed.filterUsedByCount = feed.layer === 'source' ? (effectiveUsage.get(feed.filterSetId) || 0) : 0;
    }
  }
  for (const entry of filterSets) entry.activeUsedByCount = effectiveUsage.get(entry.id) || 0;

  /* ---- Kaynak beslemeyen modüller ----
     Mock-up bunları matriste gösteriyordu. Gerçekte yerel/türetilmiş veridir
     ve bir veritabanına bağlanamaz. Gizlemek yerine AÇIKÇA söylenir; yoksa
     kullanıcı "Koleksiyon neden listede yok?" diye arar. */
  const localModules = moduleRegistry.list()
    // 'source' bu ekranın KENDİSİdir. Kendini "kaynak beslemeyen modül" diye
    // listelemek kullanıcıya anlamsız bir satır gösterir.
    .filter(module => module.id !== 'source')
    .filter(module => module.route && !fedModuleIds.includes(module.id))
    .map(module => ({
      id: module.id,
      label: module.label[language] || module.label.tr,
      route: module.route,
      /* Neden bağlanamadığı tek kelimeyle. "Bağlantısı yok" demek yetmez:
         kullanıcı bunu bir eksiklik sanır ve aramaya devam eder.
           derived → başka bir modülün verisinden hesaplanır
           local   → kullanıcının kendi kaydettiği çalışma verisi
           tool    → veri taşımaz, araçtır */
      reason: !module.datasets.length ? 'tool'
        : module.datasets.every(dataset => dataset === 'collection') ? 'local'
          : 'derived',
    }));

  /* ---- Matris ---- */
  const matrix = {
    sourceIds: sources.map(source => source.id),
    moduleIds: modules.map(module => module.id),
    cells: {},
  };
  for (const source of sources) {
    const locked = lockedBySource.get(source.id) || new Set();
    for (const module of modules) {
      const state = adapter.cellState(domain, source.id, module.id);
      /* DÖRDÜNCÜ HÂL: 'locked'. Açık ama kapatılamaz. Bunu 'on' göstermek,
         kullanıcının tıklayıp hiçbir şey olmadığını (ya da daha kötüsü,
         kapanıp anında geri geldiğini) görmesi demekti. */
      matrix.cells[`${source.id}:${module.id}`] = state === 'on' && locked.has(module.id) ? 'locked' : state;
    }
  }

  /* ---- Özet ---- */
  const lastRefreshAt = sources
    .map(source => source.lastRun && source.lastRun.at)
    .filter(Boolean)
    .sort()
    .pop() || '';

  return {
    sources,
    modules,
    localModules,
    filterSets,
    matrix,
    retiredCount: domain.retired.length,
    warnings: domain.warnings.slice(),
    summary: {
      sourceCount: sources.length,
      readyCount: sources.filter(source => source.status === 'ready').length,
      problemCount: sources.filter(source => source.status === 'error' || source.status === 'needs-filter' || source.status === 'unconfigured').length,
      fedModuleCount: modules.filter(module => module.connectedCount > 0).length,
      totalFedModules: modules.length,
      localModuleCount: localModules.length,
      lastRefreshAt,
    },
  };
}

module.exports = { build, describeFilter };
