/* ===================================================================
   ORTAK MODÜL FİLTRESİ DÜZENLEYİCİSİ (v7.81, P3-yazma)

   Veri Yönetimi ekranındaki modül satırından açılır.

   v7.0.183 — HORIZON KULLANICI BAZLI (kullanıcı kararı). Varsayılan kaydetme
   (mode 'personal') kullanıcının KENDİ filtresini yazar; başka kullanıcıyı
   etkilemez. Ortak filtre Sync klasörü üzerinden her makineye dağıtıldığı
   için eskiden bir bilgisayardaki değişiklik herkesinkini eziyordu. Ortak
   varsayılanı ('shared' / 'split') yalnız yönetim yetkisi olan görür ve bu
   düğmeler "Herkes için" diye açıkça etiketlenir.

   TASARIM KARARLARI

   1) SATIR İÇİ, MODAL DEĞİL. Ekranın kendisi zaten bir yönetim yüzeyi;
      modal-içinde-modal (§48'de istenmeyen) kurmak yerine satır açılır.

   2) PAYLAŞIM KARARINI KULLANICI VERİR. Filtre birden çok modül tarafından
      paylaşılıyorsa iki ayrı kaydetme düğmesi çıkar: "Hepsini güncelle" ve
      "Yalnız bunun için ayır". Varsayılan uydurulmaz — kullanıcının farkında
      olmadığı bir karar verilmiş olurdu.

   3) ALAN LİSTESİ DATABASE'DEN GELİR. Yalnız eşlenmiş alanlar değil,
      şemadaki TÜM sütunlar seçilebilir (§17); /api/horizon/fields bunu
      zaten döndürüyor.

   4) DEĞER UYDURULMAZ (§152). Seçenekler /api/horizon/values üzerinden
      database'den okunur; arama sorguya itilir, sayfalama vardır. Elle
      değer yazmak da mümkündür — liste erişilemezse kullanıcı kilitlenmez.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const uid = () => `c_${Math.random().toString(36).slice(2, 9)}`;

  /* Operatörlerin kaç değer aldığı. Sunucudaki model-conditions.OPERATORS ile
     aynı sözleşme; arity'yi oradan alıyoruz, burada ikinci bir liste tutmuyoruz. */
  let OPERATORS = [];
  let fieldsCache = new Map();   // sourceId|moduleId → {fields, operators, schemaError}

  let host = null;
  let context = null;            // {sourceId, sourceName, moduleId, moduleLabel, revision, sharedWith, filterName}
  let groups = [];               // [{id, conditions:[...]}]
  let filterName = '';
  let busy = false;
  let message = '';
  let messageTone = 'info';
  let onSaved = null;

  /* ---------------------------------------------------------------- */

  /* v7.81 — Kaydedilmiş hazır ufuklar. Kişisel ve paylaşılan ayrı
     listelerde gelir; paylaşılanı herkes görür, kişiseli yalnız sahibi. */
  let templates = { personal: [], shared: [] };
  let templateMessage = '';

  /* v7.81 — ASAS→IAS eşleme teklifi. `mapping` doluyken panel açıktır;
     ONAYLANANA KADAR koşullara hiçbir şey yazılmaz. */
  let mapping = null;          // {proposals, unmapped, groups, stats, fromSource}
  let mappingMessage = '';
  let mappingBusy = false;

  /* v2026-10-30 — YAN YANA ASAS ⇄ IAS (kullanıcı kararı).

     "ASAS'ta X sütununu filtre için seçtiğimde IAS'ta da eşleşen başlık
     otomatik seçilsin; ASAS ve IAS yan yana görünsün ki karşılaştırma
     yapılabilsin; otomatik eşleşme hatalı olabilir, manuel de seçilebilsin;
     manuel seçileni hatırla."

     `pair` doluyken düzenleyici iki sütunludur: solda düzenlenen kaynak
     (ASAS), sağda eşi (IAS). Her sol koşulun bir `link`i vardır:
       condition    eşin koşulu (null → IAS'ta karşılığı yok)
       origin       kept · remembered · auto · manual · none · unmatched
       valuesEdited IAS değerleri elle değiştirildi; sol değişince EZİLMEZ
       manualPair   kullanıcı alanı elle seçti; kayıtta hatırlanır
     Eşte olup solda karşılığı olmayan koşullar SİLİNMEZ (extras), görünür
     kalır ve kayıtta korunur. Kayıt iki kaynağı TEK işlemde yazar. */
  let pair = null;             // {sourceId, sourceName, sourceRole, revision, table, base, initial, links:Map, extras:[[]], message, layerNote}
  /* v2026-10-30 — Eşleme isteklerinin sırası KOŞUL BAŞINADIR. Tek ortak sayaç,
     aynı anda birkaç koşul eşlenirken (şablon yükleme, art arda alan seçimi)
     yalnız sonuncusunun cevabını işliyor; ötekiler sonsuza dek "aranıyor"
     kalıyor ve kayıt IAS'a eksik filtre yazıyordu. initSeq açılış/şablon
     eşlemesinin bayat cevabını eler. */
  const matchSeqs = new Map();
  let initSeq = 0;
  /* v2026-10-30 — ESKİ SEZON / TARİH KISITI GÖRÜNÜR KOŞUL OLUR.
     Sunucu (modelHorizon.buildHorizonFilter) etkin koşul grubu varken
     seasons/dateStart/dateEnd alanlarını YOK SAYAR. Düzenleyici bu alanları
     göstermediği için, yalnız sezon/tarihle sınırlı bir filtreye koşul eklemek
     eski sınırı sessizce kaldırıyordu (ör. W26 sezonu → bütün sezonlar).
     Açılışta bu kısıt sunucunun anlamıyla (model-conditions.
     legacyGroupsFromHorizon: sezon VEYA tarih, ayrı gruplar) koşula çevrilir;
     kullanıcı görür, düzenler ve kayıt anlamı korur. */
  function hasActiveGroups(definition) {
    return (Array.isArray(definition && definition.groups) ? definition.groups : [])
      .some(group => group && Array.isArray(group.conditions) && group.conditions.some(condition => condition && condition.field));
  }
  function legacyGroups(definition) {
    const out = [];
    const table = String(definition.table || '');
    const seasons = Array.isArray(definition.seasons) ? definition.seasons.filter(Boolean) : [];
    if (seasons.length) {
      const field = String(definition.seasonField || 'Sezon'); // i18n-ignore
      out.push({ id: uid(), conditions: [{ id: uid(), table: String(definition.seasonTable || table), name: field, field, op: 'in', valueType: 'text', values: seasons.map(String), from: '', to: '' }] });
    }
    if (definition.dateStart || definition.dateEnd) {
      const field = String(definition.dateField || 'Orijinal Exfactory Merch Tarih'); // i18n-ignore
      out.push({ id: uid(), conditions: [{ id: uid(), table: String(definition.dateTable || table), name: field, field,
        op: definition.dateStart && definition.dateEnd ? 'between' : (definition.dateStart ? 'gte' : 'lte'),
        valueType: 'date', values: [], from: String(definition.dateStart || ''), to: String(definition.dateEnd || '') }] });
    }
    return out;
  }
  function editableGroups(definition) {
    const def = definition && typeof definition === 'object' ? definition : {};
    if (hasActiveGroups(def)) return JSON.parse(JSON.stringify(def.groups));
    const legacy = legacyGroups(def);
    return legacy.length ? legacy : [{ id: uid(), conditions: [] }];
  }
  /* Kısıt koşula çevrildiyse eski alanlar tanımdan çıkarılır: iki yerde
     durması "hangisi geçerli" belirsizliği yaratırdı. */
  function withoutLegacy(definition) {
    const { seasons, dateStart, dateEnd, ...rest } = definition && typeof definition === 'object' ? definition : {};
    return hasActiveGroups(definition) ? definition : rest;
  }

  function operatorArity(op) {
    const found = OPERATORS.find(entry => entry.id === op);
    return found ? found.arity : 'list';
  }

  function fieldsKey(sourceId = context && context.sourceId) {
    return `${String(sourceId || '')}|${String(context && context.moduleId || '')}`;
  }
  function fieldsFor(sourceId) {
    return (fieldsCache.get(fieldsKey(sourceId)) || {}).fields || [];
  }

  function fieldMeta(condition, sourceId) {
    return fieldsFor(sourceId).find(entry => entry.header === condition.field) || null;
  }

  async function loadFields(sourceId = context.sourceId) {
    const cacheKey = fieldsKey(sourceId);
    if (fieldsCache.has(cacheKey)) return;
    const fieldParams = new URLSearchParams({ target: context.moduleId, sourceId });
    const response = await fetch(`/api/horizon/fields?${fieldParams}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || T('Alan listesi okunamadı.', 'Could not read the field list.'));
    OPERATORS = Array.isArray(payload.operators) ? payload.operators : [];
    fieldsCache.set(cacheKey, {
      fields: Array.isArray(payload.fields) ? payload.fields : [],
      schemaError: String(payload.schemaError || ''),
    });
  }

  /* ---------------------------------------------------------------- */

  async function loadTemplates() {
    try {
      const response = await fetch('/api/horizon-templates', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '');
      templates = {
        personal: Array.isArray(payload.personal) ? payload.personal : [],
        shared: Array.isArray(payload.shared) ? payload.shared : [],
      };
    } catch (_) {
      /* Şablonlar yüklenemezse filtre editörü ÇALIŞMAYA DEVAM EDER:
         şablon bir kolaylık, filtre kurmanın önkoşulu değil. */
      templates = { personal: [], shared: [] };
    }
  }

  function findTemplate(id, shared) {
    const list = shared ? templates.shared : templates.personal;
    return (list || []).find(item => item && String(item.id) === String(id)) || null;
  }

  function applyTemplate(id, shared) {
    const item = findTemplate(id, shared);
    if (!item || !item.definition) return;
    /* Şablon SADECE koşulları doldurur; kaydetmez. Kullanıcı görüp
       onaylamadan ortak filtre değişmemeli. */
    const definition = item.definition;
    context.table = String(definition.table || context.table || '');
    groups = editableGroups(definition);
    if (!filterName) filterName = item.name;
    templateMessage = T(`"${item.name}" yüklendi — kaydetmek için Kaydet'e basın.`, `"${item.name}" loaded — press Save to apply.`);
    render();
    /* Yan yana kipte eş, açılıştaki IAS filtresine göre TEK toplu istekle
       yeniden kurulur: mevcut IAS koşulları yine "mevcut" olarak eşleşir,
       eşleşmeyenler "yalnız IAS" olarak görünür kalır. */
    if (pair) void reinitPair();
  }

  async function saveAsTemplate() {
    const name = String(window.prompt(T('Şablon adı:', 'Template name:'), filterName || '') || '').trim();
    if (!name) return;
    try {
      const response = await fetch('/api/horizon-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, definition: { table: context.table || '', groups } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Şablon kaydedilemedi.', 'Could not save template.'));
      await loadTemplates();
      templateMessage = T(`"${name}" şablon olarak kaydedildi.`, `"${name}" saved as a template.`);
    } catch (error) {
      templateMessage = String(error && error.message || error);
    }
    render();
  }

  async function shareTemplate(id) {
    const item = findTemplate(id, false);
    if (!item) return;
    if (!window.confirm(T(`"${item.name}" herkesle paylaşılsın mı?`, `Share "${item.name}" with everyone?`))) return;
    try {
      const response = await fetch(`/api/horizon-templates/${encodeURIComponent(id)}/share`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Paylaşılamadı.', 'Could not share.'));
      await loadTemplates();
      templateMessage = T(`"${item.name}" paylaşıldı.`, `"${item.name}" shared.`);
    } catch (error) {
      templateMessage = String(error && error.message || error);
    }
    render();
  }

  async function deleteTemplate(id, shared) {
    const item = findTemplate(id, shared);
    if (!item) return;
    if (!window.confirm(T(`"${item.name}" silinsin mi?`, `Delete "${item.name}"?`))) return;
    try {
      const url = `/api/horizon-templates/${encodeURIComponent(id)}${shared ? '?shared=1' : ''}`;
      const response = await fetch(url, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Silinemedi.', 'Could not delete.'));
      await loadTemplates();
      templateMessage = T(`"${item.name}" silindi.`, `"${item.name}" deleted.`);
    } catch (error) {
      templateMessage = String(error && error.message || error);
    }
    render();
  }

  /* ---------------------------------------------------------------- */

  /* ASAS filtresini bu kaynağın alanlarına EŞLE — YALNIZ ÖNERİ.

     İki model birbirinin kopyası değil: alan adı farklı olabilir, karşılığı
     hiç olmayabilir ve değer alfabesi ("W6" ⇄ "2026W6") tutmayabilir.
     Sessizce yazılan bir eşleme, kullanıcının filtre koyduğunu sandığı ama
     hiçbir satırı tutmayan bir sorgu üretir — ekranda boş tablo, sebebi
     görünmez. Bu yüzden önce gösterilir, sonra onaylanır. */
  async function requestMapping() {
    if (!context.mapFrom) return;
    mappingBusy = true; mappingMessage = ''; render();
    try {
      const url = `/api/horizon/filter-mapping?target=${encodeURIComponent(context.moduleId)}`
        + `&from=${encodeURIComponent(context.mapFrom.role)}&to=${encodeURIComponent(context.mapFrom.toRole)}`
        + `&fromSourceId=${encodeURIComponent(context.mapFrom.sourceId || '')}&toSourceId=${encodeURIComponent(context.sourceId || '')}`;
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Eşleme üretilemedi.', 'Could not build the mapping.'));
      mapping = payload;
      if (!payload.proposals.length) {
        mappingMessage = T('Hiçbir koşul eşlenemedi — alan adları tutmuyor.', 'No condition could be mapped — the field names do not match.');
      }
    } catch (error) {
      mapping = null;
      mappingMessage = String(error && error.message || error);
    }
    mappingBusy = false;
    render();
  }

  /* ONAY. Şablon yüklemeyle aynı sözleşme: koşulları DOLDURUR, kaydetmez.
     Kullanıcı hâlâ tek tek düzeltebilir ve Kaydet'e basmadan hiçbir şey
     değişmez. */
  function approveMapping() {
    if (!mapping || !Array.isArray(mapping.groups) || !mapping.groups.length) return;
    groups = JSON.parse(JSON.stringify(mapping.groups)).map(group => ({ id: uid(), conditions: group.conditions }));
    const skipped = (mapping.unmapped || []).length;
    mappingMessage = skipped
      ? T(`${mapping.proposals.length} koşul dolduruldu, ${skipped} tanesi eşlenemediği için atlandı — kaydetmek için Kaydet'e basın.`,
          `${mapping.proposals.length} conditions filled, ${skipped} skipped because they could not be mapped — press Save to apply.`)
      : T(`${mapping.proposals.length} koşul dolduruldu — kaydetmek için Kaydet'e basın.`,
          `${mapping.proposals.length} conditions filled — press Save to apply.`);
    mapping = null;
    render();
  }

  function dismissMapping() { mapping = null; mappingMessage = ''; render(); }

  const CONFIDENCE = {
    exact: { tr: 'birebir', en: 'exact' },
    alias: { tr: 'bilinen karşılık', en: 'known alias' },
    fuzzy: { tr: 'benzer ad — kontrol edin', en: 'similar name — check' },
  };

  function mappingPanel() {
    if (!context.mapFrom && !mappingMessage) return '';
    if (!mapping) {
      return `<div class="dmfMapBar">
        ${context.mapFrom ? `<button type="button" class="dmfMapAsk" data-request-mapping ${mappingBusy ? 'disabled' : ''}>
          ${esc(mappingBusy ? T('Eşleniyor…', 'Mapping…') : T(`${context.mapFrom.name} filtresinden eşle`, `Map from the ${context.mapFrom.name} filter`))}</button>` : ''}
        ${mappingMessage ? `<span class="dmfMapMsg">${esc(mappingMessage)}</span>` : ''}
      </div>`;
    }
    const rows = (mapping.proposals || []).map(item => `<tr>
      <td>${esc(item.sourceField)}</td>
      <td class="dmfMapArrow">→</td>
      <td><span>${esc(item.targetField)}</span>
        ${(item.table || item.column) ? `<span class="dmfMapPhysical">${esc([item.table, item.column].filter(Boolean).join(' · '))}</span>` : ''}</td>
      <td><span class="dmfMapTag is-${esc(item.confidence)}">${esc(CONFIDENCE[item.confidence] ? CONFIDENCE[item.confidence][en() ? 'en' : 'tr'] : item.confidence)}</span>
        ${item.typeMismatch ? `<span class="dmfMapTag is-warn">${esc(item.typeMismatch)}</span>` : ''}</td>
    </tr>`).join('');
    const skipped = (mapping.unmapped || []).map(item => item.sourceField).filter(Boolean);
    return `<div class="dmfMapPanel" role="group" aria-label="${esc(T('Filtre eşleme önerisi', 'Filter mapping proposal'))}">
      <p class="dmfMapHead">${esc(T(
        `${mapping.fromSource} filtresi bu kaynağın alanlarına eşlendi. Kontrol edip onaylayın.`,
        `The ${mapping.fromSource} filter was mapped onto this source's fields. Review and approve.`))}</p>
      ${rows ? `<table class="dmfMapTable"><tbody>${rows}</tbody></table>` : ''}
      ${skipped.length ? `<p class="dmfMapSkip">${esc(T(
        `Eşlenemeyen ve ATLANACAK koşullar: ${skipped.join(', ')}`,
        `Conditions that could not be mapped and will be SKIPPED: ${skipped.join(', ')}`))}</p>` : ''}
      ${(mapping.proposals || []).some(item => item.valuesUnverified) ? `<p class="dmfMapSkip">${esc(T(
        'Değerler olduğu gibi taşındı ama bu kaynakta doğrulanmadı — iki modelin değer yazımı farklı olabilir.',
        'Values were carried over as-is but not verified against this source — the two models may spell values differently.'))}</p>` : ''}
      <div class="dmfMapActions">
        <button type="button" class="tbtn" data-dismiss-mapping>${esc(T('Vazgeç', 'Dismiss'))}</button>
        <button type="button" class="navActionBtn" data-approve-mapping ${rows ? '' : 'disabled'}>
          ${esc(T('Onayla ve doldur', 'Approve and fill'))}</button>
      </div>
    </div>`;
  }
  function templateChip(item, shared) {
    return `<span class="dmfTplChip${shared ? ' isShared' : ''}">
      <button type="button" class="dmfTplName" data-apply-template="${esc(item.id)}" data-shared="${shared ? '1' : '0'}"
        title="${esc(T('Bu şablonu yükle', 'Load this template'))}">${esc(item.name)}</button>
      ${shared ? '' : `<button type="button" class="dmfTplAct" data-share-template="${esc(item.id)}"
        title="${esc(T('Herkesle paylaş', 'Share with everyone'))}" aria-label="${esc(T('Herkesle paylaş', 'Share with everyone'))}">↗</button>`}
      <button type="button" class="dmfTplAct" data-delete-template="${esc(item.id)}" data-shared="${shared ? '1' : '0'}"
        title="${esc(T('Sil', 'Delete'))}" aria-label="${esc(T('Sil', 'Delete'))}">×</button>
    </span>`;
  }

  function templateBar() {
    const personal = templates.personal || [];
    const shared = templates.shared || [];
    const empty = !personal.length && !shared.length;
    return `<div class="dmfTemplates">
      <div class="dmfTplRow">
        <span class="dmLabel">${esc(T('Hazır ufuklar', 'Saved horizons'))}</span>
        ${empty ? `<span class="dmfTplEmpty">${esc(T('henüz kayıt yok', 'none saved yet'))}</span>` : ''}
        ${personal.map(item => templateChip(item, false)).join('')}
        ${shared.map(item => templateChip(item, true)).join('')}
        <span class="dmfSpacer"></span>
        <button type="button" class="dmfTplSave" data-save-template>${esc(T('Şablon olarak kaydet', 'Save as template'))}</button>
      </div>
      ${templateMessage ? `<p class="dmfTplMsg">${esc(templateMessage)}</p>` : ''}
    </div>`;
  }
  /* ---------------------------------------------------------------- */
  /* YAN YANA EŞ — eşleme, senkron ve hücre                            */

  const foldText = value => String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR');
  const sameEnd = (a, b) => Boolean(a && b) && foldText(a.table) === foldText(b.table)
    && foldText(a.name || a.field) === foldText(b.name || b.field);
  const ORIGIN = {
    kept: { tr: 'mevcut', en: 'existing' },
    remembered: { tr: 'hatırlanan', en: 'remembered' },
    exact: { tr: 'birebir', en: 'exact' },
    alias: { tr: 'bilinen karşılık', en: 'known alias' },
    fuzzy: { tr: 'benzer ad — kontrol edin', en: 'similar name — check' },
    manual: { tr: 'elle seçildi', en: 'chosen manually' },
    none: { tr: 'karşılığı yok', en: 'no counterpart' },
    unmatched: { tr: 'eşleşme bulunamadı', en: 'no match found' },
  };

  function pairConditionFrom(source, target, previous = null) {
    return {
      id: uid(),
      table: target.table || '', name: target.name || '', field: target.field || target.header || target.name || '',
      op: source.op,
      valueType: target.typeSource === 'schema' && target.type ? target.type : (source.valueType || 'text'),
      valueTypeSource: target.typeSource === 'schema' ? 'schema' : '',
      values: previous ? previous.values.slice() : (source.values || []).slice(),
      from: previous ? previous.from || '' : source.from || '',
      to: previous ? previous.to || '' : source.to || '',
    };
  }

  async function fetchMatches(conditions) {
    const fields = conditions.map(condition => ({ field: condition.field, table: condition.table || '', name: condition.name || '' }));
    if (!fields.length) return [];
    const response = await fetch('/api/horizon/field-match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toSourceId: pair.sourceId, fromRole: context.sourceRole || 'asas', fields }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || T('IAS karşılığı bulunamadı.', 'Could not find the IAS counterpart.'));
    return Array.isArray(payload.matches) ? payload.matches : [];
  }

  function linkFromMatch(source, match) {
    if (!match || !match.target) {
      return { condition: null, origin: match && match.confidence === 'none' ? 'none' : 'unmatched', valuesEdited: false, manualPair: false, stale: false };
    }
    return {
      condition: pairConditionFrom(source, match.target),
      origin: match.confidence === 'remembered' ? 'remembered' : (match.confidence || 'auto'),
      valuesEdited: false, manualPair: false, stale: Boolean(match.rememberedStale),
    };
  }

  /* Açılışta: sol koşulların karşılığı bulunur; eşin MEVCUT filtresinde aynı
     alanda bir koşul varsa onun değerleri korunur (kept). Kalanlar extras. */
  /* Eşleme alınamazsa HATA FIRLATILIR: çağıran yan yana kipi kapatır ve IAS
     filtresi hiç yazılmaz. Eskiden hata yutuluyor, IAS koşulları "yalnız IAS"
     sayılıp yeniden yazılıyor ve grup dışı alanlar (sezon/tarih) düşüyordu. */
  async function initPair(definition) {
    const existing = (Array.isArray(definition.groups) ? definition.groups : [])
      .map(group => (group && Array.isArray(group.conditions) ? group.conditions : []).map(condition => ({ ...condition, values: (condition.values || []).slice() })));
    const used = new Set();
    const all = [];
    groups.forEach(group => group.conditions.forEach(condition => { if (!condition.id) condition.id = uid(); }));
    groups.forEach((group, groupIndex) => group.conditions.forEach(condition => { if (condition.field) all.push({ groupIndex, condition }); }));
    const seq = ++initSeq;
    // Eşleme sürerken her satır "aranıyor" görünür ve kayıt engellenir.
    pair.links = new Map(all.map(entry => [entry.condition.id, { condition: null, origin: 'unmatched', matching: true, valuesEdited: false, manualPair: false, stale: false }]));
    pair.extras = [];
    const matches = await fetchMatches(all.map(entry => entry.condition));
    if (!pair || seq !== initSeq) return;
    pair.links = new Map();
    all.forEach((entry, index) => {
      const match = matches[index];
      const target = match && match.target;
      const pool = existing[entry.groupIndex] || [];
      const keptIndex = target ? pool.findIndex((candidate, at) => !used.has(`${entry.groupIndex}:${at}`)
        && sameEnd({ table: candidate.table, name: candidate.name || candidate.field }, { table: target.table, name: target.name || target.field })) : -1;
      if (keptIndex >= 0) {
        used.add(`${entry.groupIndex}:${keptIndex}`);
        const kept = pool[keptIndex];
        const sameValues = JSON.stringify(kept.values || []) === JSON.stringify(entry.condition.values || [])
          && String(kept.from || '') === String(entry.condition.from || '') && String(kept.to || '') === String(entry.condition.to || '');
        pair.links.set(entry.condition.id, { condition: { ...kept, id: kept.id || uid() }, origin: 'kept', valuesEdited: !sameValues, manualPair: false, stale: false });
      } else {
        pair.links.set(entry.condition.id, linkFromMatch(entry.condition, match));
      }
    });
    pair.extras = existing.map((pool, groupIndex) => pool.filter((_, at) => !used.has(`${groupIndex}:${at}`)));
  }

  async function reinitPair() {
    if (!pair) return;
    render();
    try { await initPair(pair.initial); }
    catch (error) {
      // Eşleme alınamadı: yan yana kip kapanır, IAS filtresi değişmez.
      const name = pair ? pair.sourceName : 'IAS';
      pair = null;
      message = T(`${name} karşılığı alınamadı; yalnız bu filtre kaydedilir, ${name} filtresi değişmez. (${error && error.message || error})`,
        `Could not get the ${name} counterpart; only this filter is saved, the ${name} filter is not changed. (${error && error.message || error})`);
      messageTone = 'warn';
    }
    render();
  }

  async function rematch(condition) {
    if (!pair || !condition || !condition.field) return;
    const seq = (matchSeqs.get(condition.id) || 0) + 1;
    matchSeqs.set(condition.id, seq);
    pair.links.set(condition.id, { condition: null, origin: 'unmatched', matching: true, valuesEdited: false, manualPair: false, stale: false });
    render();
    try {
      const [match] = await fetchMatches([condition]);
      if (!pair || matchSeqs.get(condition.id) !== seq) return;
      pair.links.set(condition.id, linkFromMatch(condition, match));
    } catch (error) {
      if (!pair || matchSeqs.get(condition.id) !== seq) return;
      /* Karşılık alınamadı: satır "IAS'ta uygulanmaz" diye sessizce düşmez;
         kullanıcı elle seçene ya da "uygulanmaz" diyene kadar kayıt engellenir. */
      pair.links.set(condition.id, { condition: null, origin: 'unmatched', failed: true, valuesEdited: false, manualPair: false, stale: false });
      pair.message = String(error && error.message || error);
    }
    render();
  }

  // Sol koşul değişince eş, kullanıcı elle değiştirmediyse aynı değerleri alır.
  function syncPair(condition) {
    const link = pair && pair.links.get(condition.id);
    if (!link || !link.condition) return;
    link.condition.op = condition.op;
    if (link.valuesEdited) return;
    link.condition.values = (condition.values || []).slice();
    link.condition.from = condition.from || '';
    link.condition.to = condition.to || '';
  }

  function pairCell(groupIndex, index, condition) {
    if (!condition.field) return `<span class="dmfPairEmpty">${esc(T('önce soldaki alanı seçin', 'pick the field on the left first'))}</span>`;
    const link = pair.links.get(condition.id);
    if (!link || link.matching) return `<span class="dmfPairEmpty">${esc(T('karşılık aranıyor…', 'looking for the counterpart…'))}</span>`;
    if (link.failed) {
      return `<button type="button" class="dmfField" data-pick-pair-field="${groupIndex}:${index}"
        title="${esc(T('Karşılık alınamadı — IAS sütununu elle seçin ya da "IAS\'ta uygulanmaz" deyin', 'The counterpart could not be retrieved — pick the IAS column manually or choose "not applied in IAS"'))}">
        <span><em>${esc(T('karşılık alınamadı — seçin', 'counterpart not retrieved — choose'))}</em></span></button>
        <span class="dmfMapTag is-warn">⚠</span>`;
    }
    const ref = `${groupIndex}:${index}`;
    const tag = ORIGIN[link.origin] || { tr: link.origin, en: link.origin };
    const target = link.condition;
    const meta = target ? fieldMeta(target, pair.sourceId) : null;
    const label = target ? (meta ? (en() ? meta.en : meta.tr) || target.field : target.field) : '';
    // Kontroller KAYDEDİLECEK işlece göre çizilir: korunan IAS koşulunun işleci ASAS'tan farklı olabilir.
    const arity = operatorArity(target && target.op ? target.op : condition.op);
    const values = target && (arity === 'list' || arity === 'single')
      ? `${(target.values || []).map((value, valueIndex) => `<button type="button" class="dmfChip" data-pair-drop-value="${ref}:${valueIndex}"
          title="${esc(T('Kaldır', 'Remove'))}">${esc(value)} ×</button>`).join('')}
         <button type="button" class="dmfAddValue" data-pair-pick-value="${ref}">+ ${esc(T('değer', 'value'))}</button>` : '';
    const range = target && (arity === 'range' || arity === 'from' || arity === 'to') ? `
      ${arity !== 'to' ? `<input type="text" class="dmfRange" data-pair-range="${ref}:from" value="${esc(target.from || '')}" placeholder="${esc(T('başlangıç', 'from'))}">` : ''}
      ${arity === 'range' ? `<span class="dmfArrow">→</span>` : ''}
      ${arity !== 'from' ? `<input type="text" class="dmfRange" data-pair-range="${ref}:to" value="${esc(target.to || '')}" placeholder="${esc(T('bitiş', 'to'))}">` : ''}` : '';
    return `<button type="button" class="dmfField" data-pick-pair-field="${ref}"
        title="${esc(T('IAS karşılığını seç veya değiştir; elle seçim hatırlanır', 'Select or change the IAS counterpart; a manual choice is remembered'))}">
        <span>${target ? esc(label) : `<em>${esc(T('IAS\'ta uygulanmaz', 'not applied in IAS'))}</em>`}</span>
        ${target && (target.table || target.name) ? `<span class="dmfFieldPhysical">${esc([target.table, target.name].filter(Boolean).join(' · '))}</span>` : ''}
      </button>
      <span class="dmfMapTag is-${esc(link.origin)}">${esc(tag[en() ? 'en' : 'tr'])}</span>
      ${link.stale ? `<span class="dmfMapTag is-warn" title="${esc(T('Hatırlanan IAS sütunu canlı şemada yok; otomatik öneri kullanıldı.', 'The remembered IAS column is not in the live schema; the automatic suggestion was used.'))}">⚠</span>` : ''}
      <span class="dmfValues">${values}${range}${arity === 'none' && target ? `<span class="dmfNoValue">${esc(T('değer gerekmez', 'no value needed'))}</span>` : ''}</span>
      ${target && link.valuesEdited ? `<button type="button" class="dmfAdd" data-pair-sync="${ref}"
        title="${esc(T('IAS değerlerini soldaki değerlerle eşitle', 'Copy the values from the left side'))}">${esc(T('ASAS ile eşitle', 'Sync with ASAS'))}</button>` : ''}`;
  }

  function extraRows(groupIndex) {
    const list = pair && pair.extras[groupIndex] || [];
    return list.map((condition, at) => `<div class="dmfPairRow isExtra">
      <div class="dmfPairCell"><span class="dmfPairEmpty">${esc(T('Yalnız IAS\'ta olan koşul (korunur)', 'Condition only in IAS (kept)'))}</span></div>
      <div class="dmfPairCell dmfPairIas">
        <span class="dmfField"><span>${esc(condition.field || condition.name || '')}</span></span>
        <span class="dmfValues">${esc((condition.values || []).join(', ') || [condition.from, condition.to].filter(Boolean).join(' → '))}</span>
        <button type="button" class="dmfDrop" data-pair-drop-extra="${groupIndex}:${at}"
          aria-label="${esc(T('Koşulu sil', 'Delete condition'))}" title="${esc(T('Koşulu sil', 'Delete condition'))}">🗑</button>
      </div>
    </div>`).join('');
  }

  function groupRows(group, groupIndex) {
    const rows = group.conditions.map((condition, index) => pair
      ? `<div class="dmfPairRow"><div class="dmfPairCell">${conditionRow(groupIndex, index, condition)}</div>
          <div class="dmfPairCell dmfPairIas">${pairCell(groupIndex, index, condition)}</div></div>`
      : conditionRow(groupIndex, index, condition)).join('');
    return rows + (pair ? extraRows(groupIndex) : '');
  }

  /* Eşin kaydedilecek tanımı: sol gruplarla aynı VE/VEYA yapısı + korunan
     yalnız-IAS koşulları. Değeri seçilmemiş liste koşulu sessizce düşmez. */
  function pairDefinition() {
    const out = [];
    const count = Math.max(groups.length, pair.extras.length);
    for (let groupIndex = 0; groupIndex < count; groupIndex += 1) {
      const mapped = ((groups[groupIndex] || {}).conditions || [])
        .map(condition => pair.links.get(condition.id))
        .filter(link => link && link.condition && link.condition.field)
        .map(link => ({ ...link.condition, values: (link.condition.values || []).slice() }));
      const conditions = [...mapped, ...(pair.extras[groupIndex] || [])];
      if (conditions.length) out.push({ id: `g_${groupIndex}`, conditions });
    }
    /* Eşin grup dışı alanları (sezon, tarih, ek ifade) düzenleyicide görünmez;
       DEĞİŞMEDEN korunur. Eskiden yalnız {table, groups} gidiyor ve bunlar
       her yan yana kayıtta sessizce düşüyordu. */
    return { ...(pair.base || {}), table: pair.table || '', groups: out };
  }

  /* Sol taraftaki grup sayısını aşan "yalnız IAS" VEYA grupları da görünür
     ve silinebilir olmalı; görünmeyen bir koşul kaydedilmemeli. */
  function extraOnlyGroups() {
    if (!pair) return '';
    let html = '';
    for (let groupIndex = groups.length; groupIndex < pair.extras.length; groupIndex += 1) {
      if (!(pair.extras[groupIndex] || []).length) continue;
      html += `<div class="dmfOr">${esc(T('VEYA', 'OR'))}</div>
        <div class="dmfGroup"><p class="dmfEmpty">${esc(T('Yalnız IAS\'ta olan VEYA grubu (korunur)', 'OR group only in IAS (kept)'))}</p>${extraRows(groupIndex)}</div>`;
    }
    return html;
  }

  function conditionRow(groupIndex, index, condition) {
    const meta = fieldMeta(condition);
    const arity = operatorArity(condition.op);
    const showValues = arity === 'list' || arity === 'single';
    const showRange = arity === 'range' || arity === 'from' || arity === 'to';
    const physicalField = meta && meta.dynamic && (meta.table || meta.name)
      ? [meta.table, meta.name].filter(Boolean).join(' · ')
      : '';
    const livePhysicalAvailable = fieldsFor().some(entry => entry && entry.dynamic && entry.table && entry.name);
    const stalePhysical = condition.field && !meta && (condition.table || condition.name)
      ? [condition.table, condition.name].filter(Boolean).join(' · ')
      : '';
    const logicalOnly = condition.field && meta && !meta.dynamic && livePhysicalAvailable;

    const values = (condition.values || []).map((value, valueIndex) =>
      `<button type="button" class="dmfChip" data-drop-value="${groupIndex}:${index}:${valueIndex}"
        title="${esc(T('Kaldır', 'Remove'))}">${esc(value)} ×</button>`).join('');

    return `<div class="dmfRow">
      <button type="button" class="dmfField" data-pick-field="${groupIndex}:${index}"
        title="${esc(T('Canlı database alanını seç veya değiştir', 'Select or change the live database field'))}">
        <span>${condition.field ? esc(meta ? (en() ? meta.en : meta.tr) || condition.field : condition.field)
          : `<em>${esc(T('alan seç', 'select field'))}</em>`}</span>
        ${physicalField ? `<span class="dmfFieldPhysical">${esc(physicalField)}</span>` : ''}
        ${logicalOnly ? `<span class="dmfFieldPhysical is-warn">⚠ ${esc(T('mantıksal alan · canlı database sütunu seçilmeli', 'logical field · select a live database column'))}</span>` : ''}
        ${stalePhysical ? `<span class="dmfFieldPhysical is-warn">⚠ ${esc(stalePhysical)} · ${esc(T('canlı şemada doğrulanamadı', 'not verified in live schema'))}</span>` : ''}
      </button>
      <select class="dmfOp" data-op="${groupIndex}:${index}">
        ${OPERATORS.map(entry => `<option value="${esc(entry.id)}"${entry.id === condition.op ? ' selected' : ''}>${esc(entry.label)}</option>`).join('')}
      </select>
      <span class="dmfValues">
        ${showValues ? `${values}<button type="button" class="dmfAddValue" data-pick-value="${groupIndex}:${index}"
          ${condition.field ? '' : 'disabled'}>+ ${esc(T('değer', 'value'))}</button>` : ''}
        ${showRange ? `
          ${arity !== 'to' ? `<input type="text" class="dmfRange" data-range="${groupIndex}:${index}:from" value="${esc(condition.from || '')}" placeholder="${esc(T('başlangıç', 'from'))}">` : ''}
          ${arity === 'range' ? `<span class="dmfArrow">→</span>` : ''}
          ${arity !== 'from' ? `<input type="text" class="dmfRange" data-range="${groupIndex}:${index}:to" value="${esc(condition.to || '')}" placeholder="${esc(T('bitiş', 'to'))}">` : ''}` : ''}
        ${arity === 'none' ? `<span class="dmfNoValue">${esc(T('değer gerekmez', 'no value needed'))}</span>` : ''}
      </span>
      <button type="button" class="dmfDrop" data-drop-condition="${groupIndex}:${index}"
        aria-label="${esc(T('Koşulu sil', 'Delete condition'))}" title="${esc(T('Koşulu sil', 'Delete condition'))}">🗑</button>
    </div>`;
  }

  /* EZEN KATMAN UYARISI.

     Bu düzenleyici her zaman ORTAK katmanı yazar. Üstünde kişisel bir ufuk ya
     da bir ön ayar varsa, buradan kaydedilen filtre kullanıcının ekranında
     hiçbir şeyi değiştirmez — ve bu, sessiz kalırsa "ayarı değiştirdim ama
     olmadı" diyen durumun ta kendisidir. Eskiden düzenleyici bu yüzden hiç
     açılmıyordu; o da kullanıcıyı başka bir ekrana gönderen bir çıkmazdı.
     Şimdi açılır, durumu söyler ve KALDIRILABİLİYORSA kaldırma yolunu verir.

     Ön ayar / rol şablonu kaldırılmaz: kullanıcının değil, çalışma alanının
     kararıdır ve buradan silinseydi başka kullanıcıları da etkilerdi. */
  function layerBanner() {
    const note = context.layerNote;
    if (!note) return '';
    return `<p class="dmfMessage is-info dmfLayerNote">
      ${esc(T(
        `Bu modülde şu an "${note.label}" filtreniz çalışıyor${note.text ? ` (${note.text})` : ''}. "Kaydet (yalnız benim için)" onu günceller; kaldırırsanız ortak filtre geçerli olur.`,
        `Your "${note.label}" filter is currently in effect for this module${note.text ? ` (${note.text})` : ''}. "Save (just for me)" updates it; removing it brings back the shared filter.`))}
      ${note.removable
        ? `<button type="button" class="tbtn dmfClearLayer" data-clear-layer ${busy ? 'disabled' : ''}>${esc(T('Kişisel ayarı kaldır', 'Remove personal setting'))}</button>`
        : `<span class="dmfLayerFixed">${esc(T('Bu katman çalışma alanı tarafından atanmış; buradan kaldırılamaz.', 'This layer is assigned by the workspace and cannot be removed here.'))}</span>`}
    </p>`;
  }

  function render() {
    if (!host) return;
    const shared = (context.sharedWith || []).length;
    /* v2026-10-30 — İki sabit ufuk: "yalnız bu modül için ayır" yoktur. Ortak
       kapsam yalnız Diğer modüllerin kendi içindedir ve birlikte güncellenir. */
    // Ortak varsayılanı yazmak herkesi etkiler; yalnız yönetim yetkisiyle görünür.
    const canShare = context.canShare === true;

    host.innerHTML = `<div class="dmFilterEditor" role="region" aria-label="${esc(context.moduleLabel)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(context.moduleLabel)} — ${esc(context.sourceName)}</span>
        ${canShare ? `<label class="dmfNameField">
          <span class="dmLabel">${esc(T('Ortak filtre adı', 'Shared filter name'))}</span>
          <input type="text" id="_dmfName" value="${esc(filterName)}" maxlength="80"
            placeholder="${esc(T('adsız', 'unnamed'))}" autocomplete="off">
        </label>` : ''}
      </div>

      ${layerBanner()}

      ${canShare ? templateBar() : ''}

      ${pair ? '' : mappingPanel()}

      ${pair ? `<div class="dmfPairHead">
        <span>${esc(context.sourceName)}</span>
        <span>${esc(pair.sourceName)} · ${esc(T('otomatik eşlenir, elle değiştirilebilir', 'matched automatically, can be changed manually'))}</span>
      </div>
      ${pair.layerNote ? `<p class="dmfMapSkip">${esc(T(
        `${pair.sourceName} tarafı sizin "${pair.layerNote}" filtrenizden başlar. "Herkes için kaydet" bunu herkesin ortak ${pair.sourceName} filtresi yapar.`,
        `The ${pair.sourceName} side starts from your "${pair.layerNote}" filter. "Save for everyone" makes it everyone's shared ${pair.sourceName} filter.`))}</p>` : ''}
      ${pair.message ? `<p class="dmfMapSkip">${esc(pair.message)}</p>` : ''}` : ''}

      ${shared ? `<p class="dmfShared">${esc(T(
        `Bu filtreyi ${shared} modül daha kullanıyor: ${(context.sharedWith || []).map(id => context.labelOf(id)).join(', ')}`,
        `${shared} more modules use this filter: ${(context.sharedWith || []).map(id => context.labelOf(id)).join(', ')}`))}</p>` : ''}

      <div class="dmfGroups">
        ${groups.map((group, groupIndex) => `
          ${groupIndex > 0 ? `<div class="dmfOr">${esc(T('VEYA', 'OR'))}</div>` : ''}
          <div class="dmfGroup">
            ${groupRows(group, groupIndex)
              || `<p class="dmfEmpty">${esc(T('Bu grupta koşul yok.', 'No conditions in this group.'))}</p>`}
            <div class="dmfGroupActions">
              <button type="button" class="dmfAdd" data-add-condition="${groupIndex}">+ ${esc(T('Filtre ekle', 'Add filter'))}</button>
              ${groups.length > 1 ? `<button type="button" class="dmfDrop" data-drop-group="${groupIndex}"
                title="${esc(T('Grubu sil', 'Delete group'))}">🗑 ${esc(T('grup', 'group'))}</button>` : ''}
            </div>
          </div>`).join('')}
        ${extraOnlyGroups()}
      </div>

      <div class="dmfFoot">
        <button type="button" class="dmfAdd" data-add-group>+ ${esc(T('VEYA grubu ekle', 'Add OR group'))}</button>
        <span class="dmfSpacer"></span>
        ${message ? `<span class="dmfMessage is-${esc(messageTone)}">${esc(message)}</span>` : ''}
        <button type="button" class="tbtn" data-cancel ${busy ? 'disabled' : ''}>${esc(T('İptal', 'Cancel'))}</button>
        ${canShare ? (shared
          ? `<button type="button" class="tbtn" data-save="shared" ${busy ? 'disabled' : ''}
               title="${esc(T('HERKES İÇİN: diğer modüller tek ortak ufuk paylaşır; hepsi birlikte güncellenir', 'FOR EVERYONE: the other modules share one horizon; all are updated together'))}">
               ${esc(T('Herkes için: diğer modüllerin hepsini güncelle', 'For everyone: update all other modules'))}</button>`
          : `<button type="button" class="tbtn" data-save="shared" ${busy ? 'disabled' : ''}
               title="${esc(T('Tüm kullanıcıların ortak varsayılan filtresini değiştirir', 'Changes the shared default filter for all users'))}">${esc(T('Herkes için kaydet', 'Save for everyone'))}</button>`) : ''}
        <button type="button" class="navActionBtn" data-save="personal" ${busy ? 'disabled' : ''}
          title="${esc(T('Yalnız sizin filtrenizi değiştirir; diğer kullanıcılar ve bilgisayarlar etkilenmez', 'Changes only your filter; other users and computers are not affected'))}">
          ${esc(T('Kaydet (yalnız benim için)', 'Save (just for me)'))}</button>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  /* Seçici ORTAK modülden gelir (data-management-picker.js). Eşleme
     düzenleyicisi de aynı etkileşimi kullanıyor; iki kopya tutmak §9'a
     aykırı olurdu. */
  const closePicker = () => window.BLDataPicker?.close?.();
  const openPicker = (anchor, items, onPick, options) => window.BLDataPicker?.open?.(anchor, items, onPick, options);

  async function pickValue(anchor, condition, sourceId = context.sourceId, onAdded = null) {
    const meta = fieldMeta(condition, sourceId);
    const params = new URLSearchParams({ target: context.moduleId, sourceId, field: condition.field, limit: '500' });
    if (meta && meta.dynamic) { params.set('table', meta.table || ''); params.set('column', meta.name || ''); }
    let values = [];
    let note = '';
    try {
      const response = await fetch(`/api/horizon/values?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      values = Array.isArray(payload.values) ? payload.values : [];
      /* Değer listesi ALANIN TİPİNİ de getirir. Listeden seçilen bir değerin
         aynı şemaya karşı doğrudan çalışması için koşul o tiple damgalanır;
         aksi hâlde sayısal bir sütuna metin literali yazılıyordu. */
      if (payload.valueType) { condition.valueType = payload.valueType; condition.valueTypeSource = 'schema'; }
      /* Değer listesi NEREDEN geldiği söylenir: database erişilemediğinde
         yüklü satırlardan gelen kısmi bir liste, tam liste sanılmamalı. */
      if (payload.source && payload.source !== 'database') {
        note = T('Liste yüklü veriden geliyor; eksik olabilir.', 'List comes from loaded data; it may be incomplete.');
      }
    } catch (_) {
      note = T('Değerler okunamadı; elle yazabilirsiniz.', 'Values could not be read; you can type them.');
    }
    const entries = values.map(value => ({ value, label: value }));
    openPicker(anchor, entries, value => {
      if (!condition.values.includes(value)) condition.values.push(value);
      message = note; messageTone = note ? 'warn' : 'info';
      if (typeof onAdded === 'function') onAdded();
      render();
      /* allowFree: liste erişilemezse ya da aranan değer listede yoksa
         kullanıcı kilitlenmemeli — Enter ile elle yazabilir (§18). */
    }, {
      placeholder: T('Değer ara veya yaz…', 'Search or type a value…'),
      allowFree: true,
      keepOpen: true,
      selectedValues: condition.values,
    });

  }

  /* ---------------------------------------------------------------- */

  function conditionAt(ref) {
    const [groupIndex, index] = String(ref).split(':').map(Number);
    return groups[groupIndex] && groups[groupIndex].conditions[index];
  }

  /* Elle seçilen eşleme: "Herkes için" kaydında (yalnız yönetici) ekibin ortak
     hafızasına, kişisel kayıtta kullanıcının kendi hafızasına yazılır
     (kullanıcı kararı: kişisel + yönetici). */
  const pairMemoryScope = mode => (mode === 'shared' && context && context.canShare === true ? 'shared' : 'personal');
  async function rememberManualPairs(mode) {
    return putManualPairs(pairMemoryScope(mode), collectManualPairs());
  }
  function collectManualPairs() {
    const pairs = [];
    groups.forEach(group => group.conditions.forEach(condition => {
      const link = pair.links.get(condition.id);
      if (!link || !link.manualPair || !condition.field) return;
      pairs.push({
        fromRole: context.sourceRole || 'asas', toRole: pair.sourceRole || 'antrepo',
        from: { table: condition.table || '', name: condition.name || '', field: condition.field },
        to: link.condition ? { table: link.condition.table || '', name: link.condition.name || '', field: link.condition.field } : null,
      });
    }));
    return pairs;
  }
  // scope kayıttan ÖNCE hesaplanır: başarılı kayıt düzenleyiciyi kapatır (context null olur).
  async function putManualPairs(scope, pairs) {
    if (!pairs.length) return '';
    try {
      const response = await fetch('/api/horizon/field-pairs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs, scope }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || '');
      return '';
    } catch (error) {
      return T('Filtreler kaydedildi ama elle seçilen eşleme hatırlanamadı.', 'Filters were saved but the manual mapping could not be remembered.');
    }
  }

  async function savePair(mode) {
    // Eşleşmesi bitmemiş ya da alınamamış satır varken IAS'a eksik filtre yazılmaz.
    const links = groups.flatMap(group => group.conditions.filter(condition => condition.field).map(condition => pair.links.get(condition.id)));
    if (links.some(link => !link || link.matching)) {
      message = T('IAS karşılıkları hâlâ aranıyor; birkaç saniye sonra tekrar kaydedin.', 'IAS counterparts are still being looked up; save again in a few seconds.');
      messageTone = 'bad'; render(); return;
    }
    if (links.some(link => link.failed)) {
      message = T('Bazı satırların IAS karşılığı alınamadı: IAS sütununu elle seçin ya da "IAS\'ta uygulanmaz" deyin.', 'Some rows have no IAS counterpart yet: pick the IAS column manually or choose "not applied in IAS".');
      messageTone = 'bad'; render(); return;
    }
    const definition = pairDefinition();
    const missing = definition.groups.flatMap(group => group.conditions)
      .filter(condition => ['list', 'single'].includes(operatorArity(condition.op)) && !(condition.values || []).length)
      .map(condition => condition.field);
    if (missing.length) {
      message = T(`IAS tarafında değer seçilmemiş: ${missing.join(', ')}`, `No value selected on the IAS side: ${missing.join(', ')}`);
      messageTone = 'bad'; render(); return;
    }
    // Eşte hiç koşul kalmadıysa IAS'a sınırsız filtre yazılmaz; yalnız sol kaydedilir.
    if (!definition.groups.length) {
      const pairName = pair.sourceName;
      const pairState = pair;
      // "IAS'ta uygulanmaz" gibi elle kararlar bu yolda da hatırlanır.
      const manual = collectManualPairs();
      const scope = pairMemoryScope(mode);
      pair = null;
      await save(mode, T(`${pairName} filtresi değiştirilmedi: eşlenen koşul yok.`, `${pairName} filter was not changed: no condition was mapped.`));
      if (host) { pair = pairState; render(); return; } // kayıt başarısız: yan yana kip geri gelir
      if (manual.length) {
        const warning = await putManualPairs(scope, manual);
        if (warning && typeof showToast === 'function') showToast(warning);
      }
      return;
    }
    busy = true; message = ''; render();
    try {
      const response = await fetch('/api/data-management/filter-pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId: context.moduleId, mode, name: filterName,
          items: [
            { sourceId: context.sourceId, expectedSourceRevision: context.revision, definition: { table: context.table || '', groups } },
            { sourceId: pair.sourceId, expectedSourceRevision: pair.revision, definition },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('ASAS ve IAS filtreleri kaydedilemedi.', 'Could not save the ASAS and IAS filters.'));
      const memoryWarning = await rememberManualPairs(mode);
      close();
      if (typeof onSaved === 'function') onSaved([...(payload.warnings || []), ...(memoryWarning ? [memoryWarning] : [])], payload);
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
      busy = false;
      render();
    }
  }

  async function save(mode, extraWarning = '') {
    if (pair) { await savePair(mode); return; }
    busy = true; message = ''; render();
    try {
      const response = await fetch('/api/data-management/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: context.sourceId,
          moduleId: context.moduleId,
          mode,
          name: filterName,
          expectedSourceRevision: context.revision,
          definition: { table: context.table || '', groups },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Filtre kaydedilemedi.', 'Could not save the filter.'));
      close();
      if (typeof onSaved === 'function') onSaved([...(payload.warnings || []), ...(extraWarning ? [extraWarning] : [])], payload);
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
      busy = false;
      render();
    }
  }

  /* Eş hücresindeki etkileşimler. Döner: olay işlendiyse true. */
  function onPairClick(event) {
    if (!pair) return false;
    const pairRef = (attr, element) => String(element.getAttribute(attr)).split(':');

    const pickPairField = event.target.closest('[data-pick-pair-field]');
    if (pickPairField) {
      const condition = conditionAt(pickPairField.dataset.pickPairField);
      if (!condition) return true;
      const link = pair.links.get(condition.id) || { condition: null, origin: 'unmatched' };
      const all = fieldsFor(pair.sourceId);
      const physical = all.filter(entry => entry && entry.dynamic && entry.table && entry.name);
      const entries = [{ value: '__none__', label: T('— IAS\'ta uygulanmaz —', '— not applied in IAS —'), hint: T('bu koşul IAS filtresine eklenmez', 'this condition is not added to the IAS filter') }]
        .concat((physical.length ? physical : all).map(entry => ({
          value: entry.header,
          label: (en() ? entry.en : entry.tr) || entry.header,
          hint: entry.dynamic ? [entry.table, entry.name].filter(Boolean).join(' · ') : T('mantıksal alan', 'logical field'),
        })));
      openPicker(pickPairField, entries, value => {
        if (value === '__none__') {
          pair.links.set(condition.id, { condition: null, origin: 'none', valuesEdited: false, manualPair: true, stale: false });
        } else {
          const meta = all.find(entry => entry.header === value);
          if (!meta) return;
          const previous = link.condition && link.valuesEdited ? link.condition : null;
          pair.links.set(condition.id, {
            condition: pairConditionFrom(condition, { field: meta.header, table: meta.dynamic ? meta.table || '' : '', name: meta.dynamic ? meta.name || '' : '', type: meta.type, typeSource: meta.typeSource }, previous),
            origin: 'manual', valuesEdited: Boolean(previous), manualPair: true, stale: false,
          });
        }
        render();
      }, { placeholder: T('IAS sütunu ara…', 'Search IAS columns…') });
      return true;
    }

    const pairPickValue = event.target.closest('[data-pair-pick-value]');
    if (pairPickValue) {
      const condition = conditionAt(pairPickValue.dataset.pairPickValue);
      const link = condition && pair.links.get(condition.id);
      if (link && link.condition) void pickValue(pairPickValue, link.condition, pair.sourceId, () => { link.valuesEdited = true; });
      return true;
    }

    const pairDropValue = event.target.closest('[data-pair-drop-value]');
    if (pairDropValue) {
      const [groupIndex, index, valueIndex] = pairRef('data-pair-drop-value', pairDropValue).map(Number);
      const condition = groups[groupIndex] && groups[groupIndex].conditions[index];
      const link = condition && pair.links.get(condition.id);
      if (link && link.condition) { link.condition.values.splice(valueIndex, 1); link.valuesEdited = true; }
      render();
      return true;
    }

    const pairSync = event.target.closest('[data-pair-sync]');
    if (pairSync) {
      const condition = conditionAt(pairSync.dataset.pairSync);
      const link = condition && pair.links.get(condition.id);
      if (link) { link.valuesEdited = false; syncPair(condition); }
      render();
      return true;
    }

    const dropExtra = event.target.closest('[data-pair-drop-extra]');
    if (dropExtra) {
      const [groupIndex, at] = pairRef('data-pair-drop-extra', dropExtra).map(Number);
      if (pair.extras[groupIndex]) pair.extras[groupIndex].splice(at, 1);
      render();
      return true;
    }
    return false;
  }

  function onClick(event) {
    if (onPairClick(event)) return;
    const cancel = event.target.closest('[data-cancel]');
    if (cancel) { close(); return; }

    const applyTpl = event.target.closest('[data-apply-template]');
    if (applyTpl) { applyTemplate(applyTpl.dataset.applyTemplate, applyTpl.dataset.shared === '1'); return; }
    const shareTpl = event.target.closest('[data-share-template]');
    if (shareTpl) { void shareTemplate(shareTpl.dataset.shareTemplate); return; }
    const deleteTpl = event.target.closest('[data-delete-template]');
    if (deleteTpl) { void deleteTemplate(deleteTpl.dataset.deleteTemplate, deleteTpl.dataset.shared === '1'); return; }
    if (event.target.closest('[data-save-template]')) { void saveAsTemplate(); return; }
    if (event.target.closest('[data-request-mapping]')) { void requestMapping(); return; }
    if (event.target.closest('[data-approve-mapping]')) { approveMapping(); return; }
    if (event.target.closest('[data-dismiss-mapping]')) { dismissMapping(); return; }

    const clearLayer = event.target.closest('[data-clear-layer]');
    if (clearLayer) {
      /* Kaldırma ekranın işidir (yetki ve onay orada). Düzenleyici kapanır:
         katman gidince bu modülün gördüğü filtre değişir ve ekran zaten
         baştan çizilir — açık kalan bir editör bayat veriyle yazardı. */
      const run = context.layerNote && context.layerNote.onClear;
      close();
      if (typeof run === 'function') void run();
      return;
    }

    const saveBtn = event.target.closest('[data-save]');
    if (saveBtn) { void save(saveBtn.dataset.save); return; }

    const addGroup = event.target.closest('[data-add-group]');
    if (addGroup) {
      /* Yan yana kipte sağda soldan fazla "yalnız IAS" VEYA grubu varsa yeni sol
         grup onların ÖNÜNE boş bir IAS yuvasıyla girer; yoksa yeni koşullar o
         IAS grubuyla VE'lenirdi. */
      if (pair && pair.extras.length > groups.length) pair.extras.splice(groups.length, 0, []);
      groups.push({ id: uid(), conditions: [] });
      render();
      return;
    }

    const dropGroup = event.target.closest('[data-drop-group]');
    if (dropGroup) {
      const at = Number(dropGroup.dataset.dropGroup);
      const [removed] = groups.splice(at, 1);
      /* Yan yana kipte grubun "yalnız IAS" koşulları da grupla birlikte silinir.
         Silinmezse sonraki gruba kayıyor, sondaki de görünmeyen tek başına bir
         VEYA grubu olarak IAS filtresini genişletiyordu. */
      if (pair) {
        pair.extras.splice(at, 1);
        (removed && removed.conditions || []).forEach(condition => { pair.links.delete(condition.id); matchSeqs.delete(condition.id); });
      }
      render();
      return;
    }

    const addCondition = event.target.closest('[data-add-condition]');
    if (addCondition) {
      groups[Number(addCondition.dataset.addCondition)].conditions.push({
        id: uid(), table: '', field: '', name: '', op: 'in', valueType: 'text', values: [], from: '', to: '',
      });
      render();
      return;
    }

    const dropCondition = event.target.closest('[data-drop-condition]');
    if (dropCondition) {
      const [groupIndex, index] = dropCondition.dataset.dropCondition.split(':').map(Number);
      const [removed] = groups[groupIndex].conditions.splice(index, 1);
      if (pair && removed) pair.links.delete(removed.id);
      render();
      return;
    }

    const dropValue = event.target.closest('[data-drop-value]');
    if (dropValue) {
      const [groupIndex, index, valueIndex] = dropValue.dataset.dropValue.split(':').map(Number);
      groups[groupIndex].conditions[index].values.splice(valueIndex, 1);
      syncPair(groups[groupIndex].conditions[index]);
      render();
      return;
    }

    const pickField = event.target.closest('[data-pick-field]');
    if (pickField) {
      const condition = conditionAt(pickField.dataset.pickField);
      /* Canlı şema varsa yalnız GERÇEK fiziksel database sütunları seçilir.
         Mantıksal Buyer Log alanını yeniden seçmek eski tablo/sütun hatasını
         tekrar üretirdi. Şema yoksa geriye dönük olarak mantıksal liste kalır. */
      const allFields = fieldsFor();
      const physicalFields = allFields.filter(entry => entry && entry.dynamic && entry.table && entry.name);
      const selectableFields = physicalFields.length ? physicalFields : allFields;
      const entries = selectableFields.map(entry => ({
        value: entry.header,
        label: (en() ? entry.en : entry.tr) || entry.header,
        hint: entry.dynamic
          ? [entry.table, entry.name].filter(Boolean).join(' · ')
          : T('mantıksal alan', 'logical field'),
      }));
      openPicker(pickField, entries, value => {
        const meta = fieldsFor().find(entry => entry.header === value);
        condition.field = value;
        condition.table = meta && meta.dynamic ? (meta.table || '') : '';
        condition.name = meta && meta.dynamic ? (meta.name || '') : '';
        condition.valueType = meta && meta.type ? meta.type : 'text';
        /* Tipin ŞEMADAN mı gelip addan mı tahmin edildiği taşınır: sunucu
           predicate üretirken şema tipini otorite sayar, tahmini saymaz. */
        condition.valueTypeSource = meta && meta.typeSource ? meta.typeSource : '';
        condition.values = [];
        render();
        // Yan yana kipte IAS karşılığı otomatik aranır (hatırlanan eşleme önce).
        void rematch(condition);
      }, { placeholder: T('Sütun ara…', 'Search columns…') });
      return;
    }

    const pickValueBtn = event.target.closest('[data-pick-value]');
    if (pickValueBtn) {
      const condition = conditionAt(pickValueBtn.dataset.pickValue);
      if (condition && condition.field) void pickValue(pickValueBtn, condition, context.sourceId, () => syncPair(condition));
    }
  }

  function onChange(event) {
    const op = event.target.closest('[data-op]');
    if (op) {
      const condition = conditionAt(op.dataset.op);
      condition.op = op.value;
      syncPair(condition);
      render();
      return;
    }
    const range = event.target.closest('[data-range]');
    if (range) {
      const [groupIndex, index, side] = range.dataset.range.split(':');
      const condition = groups[Number(groupIndex)].conditions[Number(index)];
      condition[side] = range.value;
      syncPair(condition);
      if (pair) render();
      return;
    }
    const pairRange = event.target.closest('[data-pair-range]');
    if (pairRange && pair) {
      const [groupIndex, index, side] = pairRange.dataset.pairRange.split(':');
      const condition = groups[Number(groupIndex)] && groups[Number(groupIndex)].conditions[Number(index)];
      const link = condition && pair.links.get(condition.id);
      if (link && link.condition) { link.condition[side] = pairRange.value; link.valuesEdited = true; }
    }
  }

  function onInput(event) {
    if (event.target && event.target.id === '_dmfName') filterName = event.target.value;
  }

  /* ---------------------------------------------------------------- */

  function close() {
    closePicker();
    if (!host) return;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host.removeEventListener('change', onChange);
    host.removeEventListener('input', onInput);
    host = null;
    context = null;
    pair = null;
    busy = false;
  }

  /**
   * @param {HTMLElement} container  satırın altındaki boş kap
   * @param {Object} options {sourceId, sourceName, moduleId, moduleLabel, revision,
   *                          definition, filterName, sharedWith, labelOf, onSaved}
   */
  async function open(container, options = {}) {
    close();
    host = container;
    context = { ...options, labelOf: options.labelOf || (id => id) };
    onSaved = options.onSaved || null;
    filterName = String(options.filterName || '');
    busy = false;
    message = '';

    const definition = options.definition && typeof options.definition === 'object' ? options.definition : {};
    context.table = String(definition.table || '');
    groups = editableGroups(definition);

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    host.innerHTML = `<p class="dmfEmpty">${esc(T('Alanlar yükleniyor…', 'Loading fields…'))}</p>`;

    templateMessage = '';
    // Şablon uçları yönetim yetkisi ister; yetkisiz kullanıcıda istek atılmaz.
    if (context.canShare === true) void loadTemplates().then(render);
    try { await loadFields(); }
    catch (error) {
      message = String(error && error.message || error);
      messageTone = 'warn';
    }
    /* Yan yana kip: eşin alanları ve mevcut filtresi yüklenir, sol koşulların
       karşılığı bulunur. Eş yüklenemezse düzenleyici tek kaynakla çalışır. */
    if (options.pair && options.pair.sourceId) {
      groups.forEach(group => group.conditions.forEach(condition => { if (!condition.id) condition.id = uid(); }));
      const pairDef = options.pair.definition && typeof options.pair.definition === 'object' ? options.pair.definition : {};
      const pairEditable = { ...withoutLegacy(pairDef), groups: editableGroups(pairDef).filter(group => group.conditions.length) };
      const { groups: _pairGroups, ...pairBase } = JSON.parse(JSON.stringify(pairEditable));
      pair = {
        sourceId: options.pair.sourceId, sourceName: options.pair.sourceName || '', sourceRole: options.pair.sourceRole || 'antrepo',
        revision: options.pair.revision || '', table: String(pairDef.table || ''), links: new Map(), extras: [], message: '',
        base: pairBase, initial: JSON.parse(JSON.stringify(pairEditable)), layerNote: String(options.pair.layerNote || ''),
      };
      try {
        await loadFields(pair.sourceId);
        await initPair(pairEditable);
      } catch (error) {
        pair = null;
        message = T(`IAS yan yana açılamadı; yalnız bu filtre kaydedilir, IAS filtresi değişmez: ${error && error.message || error}`,
          `IAS side-by-side could not open; only this filter is saved, the IAS filter is not changed: ${error && error.message || error}`);
        messageTone = 'warn';
      }
    }
    render();
    // Motion+ (DESIGN_SYSTEM §6): düzenleyici ortak kart hareketiyle açılır.
    if (host) window.BLMotionPlus?.play?.('card', host);
  }

  window.BLDataFilterEditor = { open, close };
})();
