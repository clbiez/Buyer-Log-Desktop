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

  /* ---------------------------------------------------------------- */
  /* v2026-11-04 — BASİT KİP (kullanıcı kararı)

     "Backlog analizi filtresindeki ASAS ve IAS filtreleme alanını beğeniyorum;
     database filtreleme modülünü ona benzetelim. ASAS karşılığı IAS alanlarını
     otomatik önerme, eşleme ve hatırlama kalsın."

     Basit kip Backlog Analiz Filtreleri düzenidir: üstte aktif filtre kartları,
     solda kaynak sekmeli sütun kataloğu, sağda onay kutulu değer listesi ya da
     tarih/sayı aralığı. Durum (groups, pair.links, pair.extras) Gelişmiş kiple
     AYNIDIR; yalnız çizim değişir. Eşleme, hatırlama ve kayıt aynı işlevlerden
     geçer (rematch, syncPair, savePair) — ikinci bir mantık yoktur.

     Basit kip yalnız tek grup + in/between/gte/lte işleçleriyle ifade edilebilen
     filtreyi gösterir. VEYA grubu, diğer işleçler ya da ASAS/IAS arasında farklı
     işleç varsa Basit kip kapanır ve filtre Gelişmiş kipte açılır: basitleştirmek
     için koşul silinmez ya da anlamı değiştirilmez.

     Değer listesi database'den gelir (/api/horizon/values) ve adet SAYISI
     YOKTUR (kullanıcı kararı: önce ölçülecek). */
  const SIMPLE_OPS = ['in', 'between', 'gte', 'lte'];
  // Kişisel tercih: user-storage.js 'bl.dataManagement.' önekini kullanıcıya ayırır.
  const MODE_KEY = 'bl.dataManagement.horizonFilterMode.v1';
  const VALUE_LIMIT = 2000;
  const VISIBLE_LIMIT = 300;
  let viewMode = 'simple';
  let selectedKey = '';          // 'p:<koşul id>' (düzenlenen kaynak) · 'x:<grup>:<sıra>' (yalnız eş)
  let catalogSide = 'primary';   // 'primary' | 'pair'
  let catalogSearch = '';
  const valueSearches = new Map(); // liste anahtarı → arama metni
  const valueCache = new Map();    // kaynak|tablo|sütun|alan|arama → {loading, values, truncated, note}
  let valueSearchTimer = null;
  let baseline = '';
  let onClosed = null;

  const storage = () => window.BLStorage || window.localStorage;
  function readMode() {
    try { return storage().getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'simple'; } catch (_) { return 'simple'; }
  }
  function writeMode(value) {
    try { storage().setItem(MODE_KEY, value); } catch (_) { /* tercih yalnız kolaylık */ }
  }

  const pairName = () => (pair && pair.sourceName) || 'IAS';
  /* Basit kipte canlı database sütunu yalnız adıyla görünür; tablo ayrı bir
     ipucu satırıdır (kart başlığı "Dim_Urun · Sezon" yerine "Sezon"). */
  const fieldLabel = (condition, sourceId) => {
    const meta = fieldMeta(condition, sourceId);
    if (meta && meta.dynamic && meta.name) return meta.name;
    return meta ? ((en() ? meta.en : meta.tr) || condition.field) : (condition.name || condition.field || '');
  };
  const isRange = op => ['range', 'from', 'to'].includes(operatorArity(op));
  const rangeOp = (from, to) => (from && to ? 'between' : (from ? 'gte' : (to ? 'lte' : 'between')));

  /* Basit kipe engel olan durum; boş metin = Basit kip kullanılabilir. */
  function simpleBlocker() {
    if (groups.length > 1) return T('filtrede VEYA grubu var', 'the filter has OR groups');
    const conditions = (groups[0] ? groups[0].conditions : []).filter(condition => condition.field);
    if (conditions.some(condition => !SIMPLE_OPS.includes(condition.op))) return T('gelişmiş bir işleç kullanılıyor', 'an advanced operator is used');
    if (pair) {
      if (pair.extras.slice(1).some(list => list && list.length)) {
        return T(`yalnız ${pairName()} tarafında VEYA grubu var`, `there is an OR group only on the ${pairName()} side`);
      }
      if ((pair.extras[0] || []).some(condition => !SIMPLE_OPS.includes(condition.op))) {
        return T(`${pairName()} tarafında gelişmiş bir işleç var`, `the ${pairName()} side uses an advanced operator`);
      }
      if (conditions.some(condition => {
        const link = pair.links.get(condition.id);
        return link && link.condition && link.condition.op !== condition.op;
      })) return T(`${context.sourceName} ve ${pairName()} işleçleri farklı`, `${context.sourceName} and ${pairName()} use different operators`);
    }
    return '';
  }
  const simpleActive = () => viewMode === 'simple' && !simpleBlocker();

  /* Kayıt öncesi "değişti mi" imzası: sekme değiştirirken ya da çekmece
     kapanırken kaydedilmemiş iş sessizce kaybolmasın. */
  /* Yalnız kullanıcının değiştirdiği anlam imzalanır: değer listesi yüklenince
     koşula damgalanan alan tipi (valueType) "kaydedilmemiş değişiklik" sayılmaz. */
  const meaning = condition => (condition ? [condition.table || '', condition.name || '', condition.field || '', condition.op,
    (condition.values || []).slice(), condition.from || '', condition.to || ''] : null);
  function signature() {
    const links = pair ? [...pair.links.entries()].map(([id, link]) => [id, meaning(link.condition), link.valuesEdited]) : null;
    return JSON.stringify({
      groups: groups.map(group => group.conditions.filter(condition => condition.field).map(meaning)),
      links, extras: pair ? pair.extras.map(list => (list || []).map(meaning)) : null, filterName,
    });
  }
  function isDirty() { return Boolean(host && context && baseline && signature() !== baseline); }

  function resolveKey(key) {
    const text = String(key || '');
    if (text.startsWith('p:')) {
      const id = text.slice(2);
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const index = groups[groupIndex].conditions.findIndex(condition => condition.id === id);
        if (index >= 0) return { kind: 'p', groupIndex, index, condition: groups[groupIndex].conditions[index], sourceId: context.sourceId };
      }
      return null;
    }
    if (text.startsWith('q:')) {
      const base = resolveKey(`p:${text.slice(2)}`);
      const link = base && pair && pair.links.get(base.condition.id);
      return link && link.condition ? { kind: 'q', base, link, condition: link.condition, sourceId: pair.sourceId } : null;
    }
    if (text.startsWith('x:') && pair) {
      const [groupIndex, at] = text.slice(2).split(':').map(Number);
      const condition = pair.extras[groupIndex] && pair.extras[groupIndex][at];
      return condition ? { kind: 'x', groupIndex, index: at, condition, sourceId: pair.sourceId } : null;
    }
    return null;
  }
  function firstKey() {
    const first = (groups[0] ? groups[0].conditions : []).find(condition => condition.field);
    if (first) return `p:${first.id}`;
    return pair && (pair.extras[0] || []).length ? 'x:0:0' : '';
  }
  // Liste değiştikten sonra: düzenlenen kaynakta eş senkronlanır; eşte "elle değişti" işaretlenir.
  function touched(ref) {
    if (!ref) return;
    if (ref.kind === 'p') syncPair(ref.condition);
    if (ref.kind === 'q') ref.link.valuesEdited = true;
  }

  function cacheKey(condition, sourceId, q) {
    return [sourceId, condition.table || '', condition.name || '', condition.field, q || ''].join('|');
  }
  /* Değerler pickValue ile AYNI uçtan ve aynı parametrelerle okunur; alan tipi
     koşula aynı şekilde damgalanır. */
  function ensureValues(condition, sourceId, q = '') {
    const key = cacheKey(condition, sourceId, q);
    if (valueCache.has(key)) return valueCache.get(key);
    const entry = { loading: true, values: [], truncated: false, note: '' };
    valueCache.set(key, entry);
    const meta = fieldMeta(condition, sourceId);
    const params = new URLSearchParams({ target: context.moduleId, sourceId, field: condition.field, limit: String(VALUE_LIMIT) });
    if (meta && meta.dynamic) { params.set('table', meta.table || ''); params.set('column', meta.name || ''); }
    if (q) params.set('q', q);
    void (async () => {
      try {
        const response = await fetch(`/api/horizon/values?${params}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || '');
        entry.values = (Array.isArray(payload.values) ? payload.values : []).map(value => String(value));
        entry.truncated = Boolean(payload.truncated);
        if (payload.valueType) { condition.valueType = payload.valueType; condition.valueTypeSource = 'schema'; }
        if (payload.source && payload.source !== 'database') {
          entry.note = T('Liste yüklü veriden geliyor; eksik olabilir.', 'List comes from loaded data; it may be incomplete.');
        }
      } catch (_) {
        // Hata kaydı önbellekte kalır: her yeniden çizim yeni istek atmasın; çekmece yeniden açılınca denenir.
        entry.note = T('Değerler okunamadı; aşağıya elle yazabilirsiniz.', 'Values could not be read; you can type them below.');
      }
      entry.loading = false;
      if (!q && entry.truncated) runPendingSearches();
      if (host) render();
    })();
    return entry;
  }

  function valueView(listKey, condition, sourceId) {
    const q = String(valueSearches.get(listKey) || '').trim();
    const base = ensureValues(condition, sourceId, '');
    // Liste kesildiyse arama sunucuya itilir (debounce onInput'ta).
    const searched = q && base.truncated ? valueCache.get(cacheKey(condition, sourceId, q)) : null;
    const entry = searched || base;
    const selected = new Set((condition.values || []).map(String));
    const pool = [...new Set([...(condition.values || []).map(String), ...entry.values])];
    const fq = foldText(q);
    const matched = pool.filter(value => !fq || foldText(value).includes(fq))
      .sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)));
    return { entry, base, q, selected, matched, visible: matched.slice(0, VISIBLE_LIMIT) };
  }

  function valueListHtml(listKey, condition, sourceId) {
    const view = valueView(listKey, condition, sourceId);
    const loading = view.entry.loading || (view.q && view.base.truncated && !valueCache.get(cacheKey(condition, sourceId, view.q)));
    const rows = view.visible.map(value => `<label class="blvFilterValue">
        <input type="checkbox" data-dmf-value="${esc(listKey)}" data-dmf-v="${esc(encodeURIComponent(value))}"${view.selected.has(value) ? ' checked' : ''}>
        <span title="${esc(value)}">${esc(value)}</span></label>`).join('');
    return `<div class="blvFilterValueTools">
        <input type="search" data-dmf-value-search="${esc(listKey)}" value="${esc(valueSearches.get(listKey) || '')}" placeholder="${esc(T('Değer ara…', 'Search values…'))}" autocomplete="off">
        <button type="button" data-dmf-all-visible="${esc(listKey)}">${esc(T('Görünenleri seç', 'Select visible'))}</button>
        <button type="button" data-dmf-none="${esc(listKey)}">${esc(T('Seçimi kaldır', 'Clear selection'))}</button>
      </div>
      <div class="blvFilterValues dmfValueList">${rows
        || `<div class="blvFilterNoValue">${esc(loading ? T('Değerler database\'den okunuyor…', 'Reading values from the database…') : T('Eşleşen değer yok.', 'No matching values.'))}</div>`}</div>
      <label class="dmfFreeValue"><span>${esc(T('Listede yoksa yazın, Enter ile ekleyin', 'Not in the list? Type it and press Enter'))}</span>
        <input type="text" data-dmf-free="${esc(listKey)}" autocomplete="off" placeholder="${esc(T('değer', 'value'))}"></label>
      ${view.matched.length > view.visible.length ? `<div class="blvFilterRangeHint">${esc(T(`${view.matched.length} değerin ilk ${VISIBLE_LIMIT}'ü gösteriliyor. Aramayı daraltın.`, `Showing the first ${VISIBLE_LIMIT} of ${view.matched.length} values. Refine the search.`))}</div>` : ''}
      ${view.base.truncated && !view.q ? `<div class="blvFilterRangeHint">${esc(T('Database listesi kısaltıldı; aradığınız değer için aramayı kullanın.', 'The database list was shortened; use search to find a value.'))}</div>` : ''}
      ${view.entry.note ? `<div class="blvFilterRangeHint is-warn">${esc(view.entry.note)}</div>` : ''}`;
  }

  function rangeHtml(listKey, condition, readOnly = false) {
    const type = condition.valueType === 'date' ? 'date' : 'text';
    if (readOnly) {
      return `<div class="blvFilterRangeHint">${esc([condition.from || '…', condition.to || '…'].join(' → '))}</div>`;
    }
    return `<div class="blvFilterDateGrid">
      <label><span>${esc(T('Başlangıç', 'From'))}</span><input type="${type}" data-dmf-range="${esc(listKey)}:from" value="${esc(condition.from || '')}"></label>
      <label><span>${esc(T('Bitiş', 'To'))}</span><input type="${type}" data-dmf-range="${esc(listKey)}:to" value="${esc(condition.to || '')}"></label>
    </div>
    <div class="blvFilterRangeHint">${esc(T('Tek uç boş bırakılırsa o yöne sınır konmaz.', 'Leave one end empty for an open-ended range.'))}</div>`;
  }

  function criterionText(condition) {
    if (isRange(condition.op)) {
      return condition.from || condition.to ? [condition.from || '…', condition.to || '…'].join(' → ') : T('Aralık seçilmedi', 'No range selected');
    }
    const values = condition.values || [];
    if (!values.length) return T('Değer seçilmedi', 'No value selected');
    return values.length <= 2 ? values.join(', ') : T(`${values.length} değer`, `${values.length} values`);
  }
  const conditionEmpty = condition => (isRange(condition.op) ? !(condition.from || condition.to) : !(condition.values || []).length);

  function cardPairText(condition) {
    const link = pair && pair.links.get(condition.id);
    if (!link || link.matching) return T('karşılık aranıyor…', 'looking for the counterpart…');
    if (link.failed) return T('karşılık alınamadı — seçin', 'counterpart not retrieved — choose');
    if (!link.condition) return T(`${pairName()}'ta uygulanmaz`, `not applied in ${pairName()}`);
    const label = fieldLabel(link.condition, pair.sourceId);
    return link.valuesEdited ? `${label} · ${criterionText(link.condition)}` : label;
  }

  function cardsHtml() {
    const cards = [];
    (groups[0] ? groups[0].conditions : []).forEach((condition, index) => {
      if (!condition.field) return;
      const key = `p:${condition.id}`;
      const link = pair && pair.links.get(condition.id);
      const warn = conditionEmpty(condition) || (link && (link.failed || link.stale));
      cards.push(`<div class="dmfCard${key === selectedKey ? ' is-active' : ''}${warn ? ' is-warn' : ''}" role="listitem">
        <button type="button" class="dmfCardMain" data-dmf-select="${esc(key)}">
          <span class="dmfCardSource">${esc(context.sourceName)}</span>
          <b>${esc(fieldLabel(condition))}</b>
          <small>${esc(criterionText(condition))}</small>
          ${pair ? `<span class="dmfCardPair">↔ ${esc(pairName())}: ${esc(cardPairText(condition))}</span>` : ''}
        </button>
        <button type="button" class="blvFilterRemove" data-drop-condition="0:${index}" title="${esc(T('Filtreyi kaldır', 'Remove filter'))}" aria-label="${esc(T('Filtreyi kaldır', 'Remove filter'))}"><svg class="ic"><use href="#i-x"/></svg></button>
      </div>`);
    });
    if (pair) {
      (pair.extras[0] || []).forEach((condition, at) => {
        const key = `x:0:${at}`;
        cards.push(`<div class="dmfCard isExtra${key === selectedKey ? ' is-active' : ''}${conditionEmpty(condition) ? ' is-warn' : ''}" role="listitem">
          <button type="button" class="dmfCardMain" data-dmf-select="${esc(key)}">
            <span class="dmfCardSource">${esc(pairName())}</span>
            <b>${esc(fieldLabel(condition, pair.sourceId))}</b>
            <small>${esc(criterionText(condition))}</small>
            <span class="dmfCardPair">${esc(T(`yalnız ${pairName()} koşulu`, `${pairName()}-only condition`))}</span>
          </button>
          <button type="button" class="blvFilterRemove" data-pair-drop-extra="0:${at}" title="${esc(T('Filtreyi kaldır', 'Remove filter'))}" aria-label="${esc(T('Filtreyi kaldır', 'Remove filter'))}"><svg class="ic"><use href="#i-x"/></svg></button>
        </div>`);
      });
    }
    return cards.join('');
  }

  function selectableFields(sourceId) {
    const all = fieldsFor(sourceId);
    const physical = all.filter(entry => entry && entry.dynamic && entry.table && entry.name);
    return physical.length ? physical : all;
  }

  function catalogHtml() {
    const sides = [{ id: 'primary', name: context.sourceName, sourceId: context.sourceId }]
      .concat(pair ? [{ id: 'pair', name: pair.sourceName, sourceId: pair.sourceId }] : []);
    const side = sides.find(entry => entry.id === catalogSide) || sides[0];
    const used = new Set();
    if (side.id === 'primary') (groups[0] ? groups[0].conditions : []).forEach(condition => condition.field && used.add(condition.field));
    else {
      (pair.extras[0] || []).forEach(condition => used.add(condition.field));
      pair.links.forEach(link => { if (link && link.condition) used.add(link.condition.field); });
    }
    const q = foldText(catalogSearch);
    const list = selectableFields(side.sourceId)
      .filter(entry => !q || [entry.header, entry.tr, entry.en, entry.table, entry.name].some(text => foldText(text).includes(q)))
      .sort((a, b) => Number(used.has(b.header)) - Number(used.has(a.header)));
    const visible = list.slice(0, VISIBLE_LIMIT);
    const schemaError = (fieldsCache.get(fieldsKey(side.sourceId)) || {}).schemaError || '';
    return `<div class="blvFilterCatalogue dmfCatalogue">
      ${sides.length > 1 ? `<div class="blvFilterSourceTabs dmfSourceTabs" role="group" aria-label="${esc(T('Sütun kaynağı', 'Column source'))}">${sides.map(entry => `<button type="button" class="${entry.id === side.id ? 'is-active' : ''}" aria-pressed="${entry.id === side.id}" data-dmf-side="${entry.id}">${esc(entry.name)} <b>${selectableFields(entry.sourceId).length}</b></button>`).join('')}</div>` : ''}
      <input class="blvFilterSearch" type="search" data-dmf-col-search value="${esc(catalogSearch)}" placeholder="${esc(T('Sütun ara…', 'Search columns…'))}" autocomplete="off">
      <div class="blvFilterColumns">${visible.map(entry => {
        const added = used.has(entry.header);
        const hint = entry.dynamic ? [entry.table, entry.name].filter(Boolean).join(' · ') : T('mantıksal alan', 'logical field');
        return `<button type="button" class="${added ? 'is-added' : ''}" data-dmf-add-field="${esc(encodeURIComponent(entry.header))}" title="${esc(hint)}">
          <span>${esc(entry.dynamic ? entry.name || entry.header : ((en() ? entry.en : entry.tr) || entry.header))}${entry.dynamic && entry.table ? `<small class="dmfColTable">${esc(entry.table)}</small>` : ''}</span>
          <svg class="ic"><use href="#${added ? 'i-check' : 'i-plus'}"/></svg></button>`;
      }).join('') || `<div class="blvFilterNoValue">${esc(T('Eşleşen sütun yok.', 'No matching columns.'))}</div>`}</div>
      ${list.length > visible.length ? `<div class="blvFilterRangeHint">${esc(T(`${list.length} sütunun ilk ${VISIBLE_LIMIT}'ü gösteriliyor. Aramayı kullanın.`, `Showing the first ${VISIBLE_LIMIT} of ${list.length} columns. Use search.`))}</div>` : ''}
      ${side.id === 'pair' ? `<div class="blvFilterRangeHint">${esc(T(`Buradan eklenen sütun yalnız ${pairName()} filtresine girer.`, `A column added here goes into the ${pairName()} filter only.`))}</div>` : ''}
      ${schemaError ? `<div class="blvFilterRangeHint is-warn">${esc(schemaError)}</div>` : ''}
    </div>`;
  }

  /* Değer listesi ya da aralık; tarih/sayı alanında ikisi arasında seçim. */
  function criterionControls(listKey, condition, sourceId) {
    const canRange = ['date', 'number'].includes(condition.valueType) || isRange(condition.op);
    const range = isRange(condition.op);
    const toggle = canRange ? `<div class="dmViewToggle dmfKindToggle" role="group" aria-label="${esc(T('Filtre tipi', 'Filter type'))}">
        <button type="button" class="${range ? '' : 'is-active'}" aria-pressed="${!range}" data-dmf-kind="${esc(listKey)}" data-kind="list">${esc(T('Değer listesi', 'Value list'))}</button>
        <button type="button" class="${range ? 'is-active' : ''}" aria-pressed="${range}" data-dmf-kind="${esc(listKey)}" data-kind="range">${esc(T('Aralık', 'Range'))}</button>
      </div>` : '';
    return toggle + (range ? rangeHtml(listKey, condition) : valueListHtml(listKey, condition, sourceId));
  }

  function pairBox(ref) {
    const { condition, index } = ref;
    const pairRef = `0:${index}`;
    const link = pair.links.get(condition.id);
    let body;
    if (!link || link.matching) {
      body = `<p class="dmfPairStatus">${esc(T('karşılık aranıyor…', 'looking for the counterpart…'))}</p>`;
    } else if (link.failed) {
      body = `<button type="button" class="dmfField" data-pick-pair-field="${pairRef}"><span><em>${esc(T('karşılık alınamadı — seçin', 'counterpart not retrieved — choose'))}</em></span></button>
        <span class="dmfMapTag is-warn">⚠</span>`;
    } else {
      const tag = ORIGIN[link.origin] || { tr: link.origin, en: link.origin };
      const target = link.condition;
      body = `<div class="dmfPairPick">
          <button type="button" class="dmfField" data-pick-pair-field="${pairRef}"
            title="${esc(T(`${pairName()} karşılığını seç veya değiştir; elle seçim hatırlanır`, `Select or change the ${pairName()} counterpart; a manual choice is remembered`))}">
            <span>${target ? esc(fieldLabel(target, pair.sourceId)) : `<em>${esc(T(`${pairName()}'ta uygulanmaz`, `not applied in ${pairName()}`))}</em>`}</span>
            ${target && (target.table || target.name) ? `<span class="dmfFieldPhysical">${esc([target.table, target.name].filter(Boolean).join(' · '))}</span>` : ''}
          </button>
          <span class="dmfMapTag is-${esc(link.origin)}">${esc(tag[en() ? 'en' : 'tr'])}</span>
          ${link.stale ? `<span class="dmfMapTag is-warn" title="${esc(T(`Hatırlanan ${pairName()} sütunu canlı şemada yok; otomatik öneri kullanıldı.`, `The remembered ${pairName()} column is not in the live schema; the automatic suggestion was used.`))}">⚠</span>` : ''}
        </div>`;
      if (target) {
        const range = isRange(target.op);
        if (!link.valuesEdited) {
          body += `<p class="dmfPairStatus">${esc(T(`${context.sourceName} ile aynı ${range ? 'aralık' : 'değerler'} uygulanır.`, `The same ${range ? 'range' : 'values'} as ${context.sourceName} apply.`))}</p>
            ${range ? `<p class="dmfPairStatus">${esc(T(`${pairName()} için farklı aralık gerekiyorsa Gelişmiş kipi kullanın.`, `Use Advanced mode if ${pairName()} needs a different range.`))}</p>`
              : `<button type="button" class="tbtn" data-dmf-pair-custom="${esc(condition.id)}">${esc(T(`${pairName()} değerlerini ayrı seç`, `Choose ${pairName()} values separately`))}</button>`}`;
        } else {
          body += `<div class="dmfPairCustomHead"><span>${esc(T(`${pairName()} için ayrı ${range ? 'aralık' : 'değerler'}`, `Separate ${range ? 'range' : 'values'} for ${pairName()}`))}</span>
              <button type="button" class="tbtn" data-pair-sync="${pairRef}">${esc(T(`${context.sourceName} ile eşitle`, `Sync with ${context.sourceName}`))}</button></div>
            ${range ? rangeHtml(`q:${condition.id}`, target, true) : valueListHtml(`q:${condition.id}`, target, pair.sourceId)}`;
        }
      }
    }
    return `<section class="dmfPairBox" aria-label="${esc(T(`${pairName()} karşılığı`, `${pairName()} counterpart`))}">
      <div class="dmfPairBoxHead"><span class="blvFilterKicker">↔ ${esc(pairName())}</span>
        <span>${esc(T('otomatik eşlenir, elle değiştirilebilir', 'matched automatically, can be changed manually'))}</span></div>
      ${body}
    </section>`;
  }

  function simpleEditor() {
    const ref = resolveKey(selectedKey);
    if (!ref) {
      const names = [context.sourceName].concat(pair ? [pair.sourceName] : []).join(T(' veya ', ' or '));
      return `<div class="blvFilterEditorEmpty"><svg class="ic"><use href="#i-filter"/></svg>
        <b>${esc(T('Bir sütun seçin', 'Select a column'))}</b>
        <span>${esc(T(`Soldaki ${names} sütunlarından birini seçerek filtre ekleyin.`, `Choose a ${names} column on the left to add a filter.`))}</span></div>`;
    }
    const { condition } = ref;
    const sourceLabel = ref.kind === 'x' ? T(`${pairName()} · yalnız ${pairName()}`, `${pairName()} · ${pairName()} only`) : context.sourceName;
    const meta = fieldMeta(condition, ref.sourceId);
    const physical = meta && meta.dynamic ? [meta.table, meta.name].filter(Boolean).join(' · ') : (condition.table ? [condition.table, condition.name].filter(Boolean).join(' · ') : '');
    return `<div class="blvFilterEditorHead"><div><span>${esc(sourceLabel)}</span><h4>${esc(fieldLabel(condition, ref.sourceId))}</h4>
        ${physical ? `<small class="dmfFieldPhysical">${esc(physical)}</small>` : ''}</div>
        <button type="button" data-dmf-clear="${esc(selectedKey)}">${esc(T('Temizle', 'Clear'))}</button></div>
      ${criterionControls(selectedKey, condition, ref.sourceId)}
      ${ref.kind === 'p' && pair ? pairBox(ref) : ''}`;
  }

  function simpleBody() {
    if (!groups.length) groups.push({ id: uid(), conditions: [] });
    if (pair && !pair.extras.length) pair.extras.push([]);
    if (!resolveKey(selectedKey)) selectedKey = firstKey();
    const cards = cardsHtml();
    return `<div class="dmfSimple">
      <div class="dmfActive" role="list" aria-label="${esc(T('Aktif filtreler', 'Active filters'))}">${cards
        || `<span class="blvFilterNoActive">${esc(T('Henüz filtre yok — soldan bir sütun seçin.', 'No filters yet — pick a column on the left.'))}</span>`}</div>
      <div class="blvFilterWorkspace dmfWorkspace">${catalogHtml()}<div class="blvFilterEditor dmfEditorPane">${simpleEditor()}</div></div>
    </div>`;
  }

  function modeToggle(blocker, simple) {
    return `<div class="dmViewToggle dmfModeToggle" role="group" aria-label="${esc(T('Düzenleme kipi', 'Editing mode'))}">
      <button type="button" class="${simple ? 'is-active' : ''}" aria-pressed="${simple}" data-dmf-mode="simple"${blocker ? ' disabled' : ''}
        title="${esc(blocker ? T(`Basit kip kullanılamıyor: ${blocker}`, `Simple mode is unavailable: ${blocker}`) : T('Sütun seç, değerleri işaretle', 'Pick a column, tick the values'))}">${esc(T('Basit', 'Simple'))}</button>
      <button type="button" class="${simple ? '' : 'is-active'}" aria-pressed="${!simple}" data-dmf-mode="advanced"
        title="${esc(T('VEYA grupları ve tüm işleçler', 'OR groups and all operators'))}">${esc(T('Gelişmiş', 'Advanced'))}</button>
    </div>`;
  }

  /* Basit kip etkileşimleri. Döner: olay işlendiyse true. */
  function onSimpleClick(event) {
    const mode = event.target.closest('[data-dmf-mode]');
    if (mode) {
      const next = mode.dataset.dmfMode === 'advanced' ? 'advanced' : 'simple';
      if (next === 'simple' && simpleBlocker()) return true;
      if (next === 'simple' && groups[0]) groups[0].conditions = groups[0].conditions.filter(condition => condition.field);
      viewMode = next; writeMode(next); render();
      return true;
    }
    const side = event.target.closest('[data-dmf-side]');
    if (side) { catalogSide = side.dataset.dmfSide === 'pair' && pair ? 'pair' : 'primary'; catalogSearch = ''; render(); return true; }
    const select = event.target.closest('[data-dmf-select]');
    if (select) { selectedKey = select.dataset.dmfSelect; render(); return true; }

    const add = event.target.closest('[data-dmf-add-field]');
    if (add) {
      const header = decodeURIComponent(add.dataset.dmfAddField || '');
      const sourceId = catalogSide === 'pair' && pair ? pair.sourceId : context.sourceId;
      const meta = fieldsFor(sourceId).find(entry => entry.header === header);
      if (!meta) return true;
      const fresh = () => ({
        id: uid(), table: meta.dynamic ? meta.table || '' : '', name: meta.dynamic ? meta.name || '' : '', field: meta.header,
        op: meta.type === 'date' ? 'between' : 'in', valueType: meta.type || 'text', valueTypeSource: meta.typeSource || '',
        values: [], from: '', to: '',
      });
      if (sourceId === context.sourceId) {
        if (!groups.length) groups.push({ id: uid(), conditions: [] });
        const existing = groups[0].conditions.find(condition => condition.field === header);
        if (existing) { selectedKey = `p:${existing.id}`; render(); return true; }
        const condition = fresh();
        groups[0].conditions.push(condition);
        selectedKey = `p:${condition.id}`;
        render();
        // IAS karşılığı otomatik aranır (hatırlanan eşleme önce) — Gelişmiş kiple aynı yol.
        void rematch(condition);
      } else {
        if (!pair.extras.length) pair.extras.push([]);
        const at = pair.extras[0].findIndex(condition => condition.field === header);
        if (at >= 0) { selectedKey = `x:0:${at}`; render(); return true; }
        pair.extras[0].push(fresh());
        selectedKey = `x:0:${pair.extras[0].length - 1}`;
        render();
      }
      return true;
    }

    const clear = event.target.closest('[data-dmf-clear]');
    if (clear) {
      const ref = resolveKey(clear.dataset.dmfClear);
      if (ref) { ref.condition.values = []; ref.condition.from = ''; ref.condition.to = ''; touched(ref); }
      render();
      return true;
    }
    const kind = event.target.closest('[data-dmf-kind]');
    if (kind) {
      const ref = resolveKey(kind.dataset.dmfKind);
      if (ref) {
        const range = kind.dataset.kind === 'range';
        if (range !== isRange(ref.condition.op)) {
          ref.condition.op = range ? 'between' : 'in';
          ref.condition.values = []; ref.condition.from = ''; ref.condition.to = '';
          touched(ref);
        }
      }
      render();
      return true;
    }
    const allVisible = event.target.closest('[data-dmf-all-visible]');
    if (allVisible) {
      const ref = resolveKey(allVisible.dataset.dmfAllVisible);
      if (ref) {
        const view = valueView(allVisible.dataset.dmfAllVisible, ref.condition, ref.sourceId);
        ref.condition.values = [...new Set([...(ref.condition.values || []), ...view.visible])].slice(0, 500);
        touched(ref);
      }
      render();
      return true;
    }
    const none = event.target.closest('[data-dmf-none]');
    if (none) {
      const ref = resolveKey(none.dataset.dmfNone);
      if (ref) { ref.condition.values = []; touched(ref); }
      render();
      return true;
    }
    const custom = event.target.closest('[data-dmf-pair-custom]');
    if (custom && pair) {
      const link = pair.links.get(custom.dataset.dmfPairCustom);
      if (link && link.condition) link.valuesEdited = true;
      render();
      return true;
    }
    return false;
  }

  function onSimpleChange(event) {
    const box = event.target.closest('[data-dmf-value]');
    if (box) {
      const ref = resolveKey(box.dataset.dmfValue);
      if (!ref) return true;
      const value = decodeURIComponent(box.dataset.dmfV || '');
      const set = new Set(ref.condition.values || []);
      if (box.checked) set.add(value); else set.delete(value);
      ref.condition.values = [...set];
      touched(ref);
      render();
      return true;
    }
    const range = event.target.closest('[data-dmf-range]');
    if (range) {
      const text = String(range.dataset.dmfRange);
      const side = text.slice(text.lastIndexOf(':') + 1);
      const ref = resolveKey(text.slice(0, text.lastIndexOf(':')));
      if (!ref || !['from', 'to'].includes(side)) return true;
      // Ortak tarih bileşeni (enhanceDateInput) görünen GG.AA.YY kutusunu ekler; değer daima ISO native alandan okunur.
      ref.condition[side] = String((range._nativeDateInput || range).value || '').trim();
      // İşleç doldurulan uçtan türetilir; eş de aynı işleci alır (syncPair).
      ref.condition.op = rangeOp(ref.condition.from, ref.condition.to);
      touched(ref);
      render();
      return true;
    }
    return false;
  }

  function addFreeValue(input) {
    const ref = resolveKey(input.dataset.dmfFree);
    const value = String(input.value || '').trim();
    if (!ref || !value) return;
    if (!(ref.condition.values || []).includes(value)) ref.condition.values = [...(ref.condition.values || []), value];
    touched(ref);
    render(); // odak render içinde aynı kutuya döner (captureFocus/restoreFocus)
  }

  /* YENİDEN ÇİZİMDE ODAK KORUNUR (Codex incelemesi, PR #839).
     Düzenleyici innerHTML ile baştan çizilir; odaktaki öğe (onay kutusu, arama
     kutusu, aralık alanı…) kaybolursa klavye kullanıcısı Space ile seçmeye
     devam edemez ve Tab çekmeceden alttaki sayfaya kaçar. Odaktaki öğe data-*
     nitelikleriyle tanınır ve yeni DOM'daki karşılığına odak/imleç geri verilir. */
  const attrValue = value => String(value).replace(/["\\]/g, '\\$&');
  function captureFocus() {
    if (typeof document === 'undefined' || !host || typeof host.contains !== 'function') return null;
    const active = document.activeElement;
    if (!active || active === host || !host.contains(active)) return null;
    const attrs = [...(active.attributes || [])].filter(attr => attr.name.startsWith('data-') && attr.name !== 'data-date-enhanced');
    if (!attrs.length) return null;
    let start = null;
    let end = null;
    try { start = active.selectionStart; end = active.selectionEnd; } catch (_) { /* onay kutusu: imleç yok */ }
    return { selector: String(active.tagName || '').toLowerCase() + attrs.map(attr => `[${attr.name}="${attrValue(attr.value)}"]`).join(''), start, end };
  }
  function restoreFocus(state) {
    if (!state || !host || typeof host.querySelector !== 'function') return;
    const element = host.querySelector(state.selector);
    if (!element || typeof element.focus !== 'function') return;
    element.focus({ preventScroll: true });
    if (state.start != null) {
      try { element.setSelectionRange(state.start, state.end); } catch (_) { /* type=search bazı motorlarda desteklemez */ }
    }
  }

  /* Kesilmiş listede arama sunucuya gider. İlk liste henüz yüklenirken yazılan
     arama da kaybolmaz: liste "kesildi" diye dönünce bekleyen aramalar çalışır. */
  function runPendingSearches() {
    valueSearches.forEach((text, listKey) => {
      const q = String(text || '').trim();
      const ref = q && resolveKey(listKey);
      if (!ref) return;
      const base = valueCache.get(cacheKey(ref.condition, ref.sourceId, ''));
      if (base && !base.loading && base.truncated) ensureValues(ref.condition, ref.sourceId, q);
    });
  }

  /* Arama kutusunu her tuşta host.innerHTML ile sökmek odağı/IME imlecini
     kaybettirir. Yalnız sonuçlar ve ipuçları yenilenir; aktif input DOM'da kalır. */
  function refreshSearchResults(input) {
    if (!input || !host || !host.contains(input)) return false;
    if (input.matches('[data-dmf-col-search]')) {
      const catalog = input.closest('.dmfCatalogue');
      const current = catalog && catalog.querySelector('.blvFilterColumns');
      if (!current) return false;
      const staging = document.createElement('div');
      staging.innerHTML = catalogHtml();
      const next = staging.querySelector('.blvFilterColumns');
      if (!next) return false;
      const scrollTop = current.scrollTop;
      current.replaceWith(next);
      next.scrollTop = scrollTop;
      catalog.querySelectorAll(':scope > .blvFilterRangeHint').forEach(hint => hint.remove());
      staging.firstElementChild.querySelectorAll(':scope > .blvFilterRangeHint')
        .forEach(hint => catalog.append(hint));
      return true;
    }
    if (input.matches('[data-dmf-value-search]')) {
      const key = input.dataset.dmfValueSearch;
      const ref = resolveKey(key);
      const tools = input.closest('.blvFilterValueTools');
      const current = tools && tools.nextElementSibling;
      const free = current && current.nextElementSibling;
      if (!ref || !current?.matches('.dmfValueList') || !free?.matches('.dmfFreeValue')) return false;
      const staging = document.createElement('div');
      staging.innerHTML = valueListHtml(key, ref.condition, ref.sourceId);
      const next = staging.querySelector('.dmfValueList');
      if (!next) return false;
      const scrollTop = current.scrollTop;
      current.replaceWith(next);
      next.scrollTop = scrollTop;
      let hint = free.nextElementSibling;
      while (hint?.matches('.blvFilterRangeHint')) {
        const following = hint.nextElementSibling;
        hint.remove();
        hint = following;
      }
      free.after(...[...staging.children].filter(element => element.matches('.blvFilterRangeHint')));
      return true;
    }
    return false;
  }

  function onSimpleInput(event) {
    if (event.target.matches && event.target.matches('[data-dmf-col-search]')) {
      catalogSearch = event.target.value || '';
      if (!refreshSearchResults(event.target)) render();
      return true;
    }
    if (event.target.matches && event.target.matches('[data-dmf-value-search]')) {
      valueSearches.set(event.target.dataset.dmfValueSearch, event.target.value || '');
      if (!refreshSearchResults(event.target)) render();
      // Sunucu araması yalnız duraksayınca başlar; kutu her tuşta yeniden yaratılmaz.
      clearTimeout(valueSearchTimer);
      valueSearchTimer = setTimeout(() => {
        if (!host) return;
        runPendingSearches();
        if (!refreshSearchResults(document.activeElement)) render();
      }, 350);
      return true;
    }
    return false;
  }

  function onKeydown(event) {
    if (event.key === 'Enter' && event.target.matches && event.target.matches('[data-dmf-free]')) {
      event.preventDefault();
      addFreeValue(event.target);
    }
  }

  // Basit kipte değeri seçilmemiş liste koşulu kaydedilmez: hiçbir satırı tutmayan filtre üretirdi.
  function simpleSaveBlocker() {
    if (!simpleActive()) return '';
    const empty = [];
    (groups[0] ? groups[0].conditions : []).forEach(condition => {
      if (condition.field && conditionEmpty(condition)) empty.push(fieldLabel(condition));
    });
    if (pair) (pair.extras[0] || []).forEach(condition => { if (conditionEmpty(condition)) empty.push(`${pairName()} · ${fieldLabel(condition, pair.sourceId)}`); });
    return empty.length ? T(`Değer ya da aralık seçilmemiş: ${empty.join(', ')}`, `No value or range selected: ${empty.join(', ')}`) : '';
  }

  function render() {
    if (!host) return;
    const shared = (context.sharedWith || []).length;
    /* v2026-10-30 — İki sabit ufuk: "yalnız bu modül için ayır" yoktur. Ortak
       kapsam yalnız Diğer modüllerin kendi içindedir ve birlikte güncellenir. */
    // Ortak varsayılanı yazmak herkesi etkiler; yalnız yönetim yetkisiyle görünür.
    const canShare = context.canShare === true;
    const blocker = simpleBlocker();
    const simple = viewMode === 'simple' && !blocker;
    // Odak/kaydırma yeniden çizimde korunur (Backlog çekmecesiyle aynı davranış).
    const scroll = host.querySelector ? {
      columns: host.querySelector('.blvFilterColumns')?.scrollTop || 0,
      values: [...host.querySelectorAll('.dmfValueList')].map(el => el.scrollTop),
      editor: host.querySelector('.dmfEditorPane')?.scrollTop || 0,
      body: host.querySelector('.dmfBody')?.scrollTop || 0,
    } : null;
    const focus = captureFocus();

    host.innerHTML = `<div class="dmFilterEditor${simple ? ' isSimple' : ''}" role="region" aria-label="${esc(context.moduleLabel)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(context.moduleLabel)} — ${esc(context.sourceName)}${pair ? ` ⇄ ${esc(pair.sourceName)}` : ''}</span>
        ${modeToggle(blocker, simple)}
        ${canShare ? `<label class="dmfNameField">
          <span class="dmLabel">${esc(T('Ortak filtre adı', 'Shared filter name'))}</span>
          <input type="text" id="_dmfName" value="${esc(filterName)}" maxlength="80"
            placeholder="${esc(T('adsız', 'unnamed'))}" autocomplete="off">
        </label>` : ''}
      </div>

      <div class="dmfBody">
      ${layerBanner()}

      ${canShare ? templateBar() : ''}

      ${pair ? '' : mappingPanel()}

      ${viewMode === 'simple' && blocker ? `<p class="dmfMessage is-info dmfModeNote">${esc(T(
        `Bu filtre Gelişmiş kipte açıldı: ${blocker}. Koşullar olduğu gibi korunur.`,
        `This filter opened in Advanced mode: ${blocker}. The conditions are kept as they are.`))}</p>` : ''}

      ${pair ? `${simple ? '' : `<div class="dmfPairHead">
        <span>${esc(context.sourceName)}</span>
        <span>${esc(pair.sourceName)} · ${esc(T('otomatik eşlenir, elle değiştirilebilir', 'matched automatically, can be changed manually'))}</span>
      </div>`}
      ${pair.layerNote ? `<p class="dmfMapSkip">${esc(T(
        `${pair.sourceName} tarafı sizin "${pair.layerNote}" filtrenizden başlar. "Herkes için kaydet" bunu herkesin ortak ${pair.sourceName} filtresi yapar.`,
        `The ${pair.sourceName} side starts from your "${pair.layerNote}" filter. "Save for everyone" makes it everyone's shared ${pair.sourceName} filter.`))}</p>` : ''}
      ${pair.message ? `<p class="dmfMapSkip">${esc(pair.message)}</p>` : ''}` : ''}

      ${shared ? `<p class="dmfShared">${esc(T(
        `Bu filtreyi ${shared} modül daha kullanıyor: ${(context.sharedWith || []).map(id => context.labelOf(id)).join(', ')}`,
        `${shared} more modules use this filter: ${(context.sharedWith || []).map(id => context.labelOf(id)).join(', ')}`))}</p>` : ''}

      ${simple ? simpleBody() : `<div class="dmfGroups">
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
      </div>`}
      </div>

      <div class="dmfFoot">
        ${simple ? '' : `<button type="button" class="dmfAdd" data-add-group>+ ${esc(T('VEYA grubu ekle', 'Add OR group'))}</button>`}
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
    if (scroll && typeof requestAnimationFrame === 'function') {
      const columns = host.querySelector('.blvFilterColumns');
      if (columns) columns.scrollTop = scroll.columns;
      host.querySelectorAll('.dmfValueList').forEach((el, index) => { el.scrollTop = scroll.values[index] || 0; });
      const pane = host.querySelector('.dmfEditorPane');
      if (pane) pane.scrollTop = scroll.editor;
      const body = host.querySelector('.dmfBody');
      if (body) body.scrollTop = scroll.body;
    }
    restoreFocus(focus);
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
    const blocked = simpleSaveBlocker();
    if (blocked) { message = blocked; messageTone = 'bad'; render(); return; }
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
    if (onSimpleClick(event)) return;
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
    if (onSimpleChange(event)) return;
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
    if (event.target && event.target.id === '_dmfName') { filterName = event.target.value; return; }
    if (event.target) onSimpleInput(event);
  }

  /* ---------------------------------------------------------------- */

  /* silent: yeni bir açılış eskisini kapatırken çekmece kapanmaz. */
  function close(options = {}) {
    closePicker();
    clearTimeout(valueSearchTimer);
    const closed = onClosed;
    onClosed = null;
    if (!host) return;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host.removeEventListener('change', onChange);
    host.removeEventListener('input', onInput);
    host.removeEventListener('keydown', onKeydown);
    host = null;
    context = null;
    pair = null;
    busy = false;
    baseline = '';
    if (!options.silent && typeof closed === 'function') closed();
  }

  /**
   * @param {HTMLElement} container  satırın altındaki boş kap
   * @param {Object} options {sourceId, sourceName, moduleId, moduleLabel, revision,
   *                          definition, filterName, sharedWith, labelOf, onSaved}
   */
  async function open(container, options = {}) {
    close({ silent: true });
    host = container;
    context = { ...options, labelOf: options.labelOf || (id => id) };
    onSaved = options.onSaved || null;
    onClosed = typeof options.onClosed === 'function' ? options.onClosed : null;
    viewMode = readMode();
    selectedKey = '';
    catalogSide = 'primary';
    catalogSearch = '';
    valueSearches.clear();
    valueCache.clear();
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
    host.addEventListener('keydown', onKeydown);
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
    if (!host) return;
    render();
    baseline = signature();
    // Motion+ (DESIGN_SYSTEM §6): düzenleyici ortak kart hareketiyle açılır.
    if (host) window.BLMotionPlus?.play?.('card', host);
  }

  // TR/EN: açık düzenleyici dil değişiminde aktif dille yeniden çizilir.
  function refreshLanguage() { if (host && context) render(); }

  window.BLDataFilterEditor = { open, close, isDirty, isBusy: () => Boolean(host && busy), refreshLanguage };
})();
