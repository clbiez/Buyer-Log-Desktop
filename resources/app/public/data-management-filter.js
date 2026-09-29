/* ===================================================================
   ORTAK MODÜL FİLTRESİ DÜZENLEYİCİSİ (v7.81, P3-yazma)

   Veri Yönetimi ekranındaki modül satırından açılır. YALNIZ ortak katmanı
   düzenler; kişisel Horizon sayfa rozetindeki düzenleyiciyle yönetilmeye
   devam eder. İkisini tek yüzeye sıkıştırmak "hangi katmanı düzenliyorum?"
   belirsizliğini —düzeltmeye çalıştığımız sorunu— yeniden üretirdi.

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
  function operatorArity(op) {
    const found = OPERATORS.find(entry => entry.id === op);
    return found ? found.arity : 'list';
  }

  function fieldsKey() {
    return `${String(context && context.sourceId || '')}|${String(context && context.moduleId || '')}`;
  }
  function fieldsFor() {
    return (fieldsCache.get(fieldsKey()) || {}).fields || [];
  }

  function fieldMeta(condition) {
    return fieldsFor().find(entry => entry.header === condition.field) || null;
  }

  async function loadFields() {
    const cacheKey = fieldsKey();
    if (fieldsCache.has(cacheKey)) return;
    const fieldParams = new URLSearchParams({ target: context.moduleId, sourceId: context.sourceId });
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
    groups = Array.isArray(definition.groups) && definition.groups.length
      ? JSON.parse(JSON.stringify(definition.groups))
      : [{ id: uid(), conditions: [] }];
    if (!filterName) filterName = item.name;
    templateMessage = T(`"${item.name}" yüklendi — kaydetmek için Kaydet'e basın.`, `"${item.name}" loaded — press Save to apply.`);
    render();
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
    return `<p class="dmfMessage is-warn dmfLayerNote">
      ${esc(T(
        `Bu modülde şu an "${note.label}" katmanı çalışıyor${note.text ? ` (${note.text})` : ''}. Burada düzenlediğiniz ORTAK filtre kayıtlı kalır ama bu modülün sonucunu o katman kaldırılana kadar değiştirmez.`,
        `The "${note.label}" layer is currently in effect for this module${note.text ? ` (${note.text})` : ''}. The SHARED filter you edit here is saved, but it will not change this module's result until that layer is removed.`))}
      ${note.removable
        ? `<button type="button" class="tbtn dmfClearLayer" data-clear-layer ${busy ? 'disabled' : ''}>${esc(T('Kişisel ayarı kaldır', 'Remove personal setting'))}</button>`
        : `<span class="dmfLayerFixed">${esc(T('Bu katman çalışma alanı tarafından atanmış; buradan kaldırılamaz.', 'This layer is assigned by the workspace and cannot be removed here.'))}</span>`}
    </p>`;
  }

  function render() {
    if (!host) return;
    const shared = (context.sharedWith || []).length;
    /* v20260929 — Bağlı gruptaki bir modül artık gruptan AYRILABİLİR: "ayır"
       onu kendi filtresine çıkarır (sunucu üyelikten de düşürür). Yenileme
       her durumda ortaktır. */
    const canSplit = context.canSplit !== false;
    const linked = context.linked === true;

    host.innerHTML = `<div class="dmFilterEditor" role="region" aria-label="${esc(context.moduleLabel)}">
      <div class="dmfHead">
        <span class="dmfTitle">${esc(context.moduleLabel)} — ${esc(context.sourceName)}</span>
        <label class="dmfNameField">
          <span class="dmLabel">${esc(T('Filtre adı', 'Filter name'))}</span>
          <input type="text" id="_dmfName" value="${esc(filterName)}" maxlength="80"
            placeholder="${esc(T('adsız', 'unnamed'))}" autocomplete="off">
        </label>
      </div>

      ${layerBanner()}

      ${templateBar()}

      ${mappingPanel()}

      ${shared ? `<p class="dmfShared">${esc(T(
        `Bu filtreyi ${shared} modül daha kullanıyor: ${(context.sharedWith || []).map(id => context.labelOf(id)).join(', ')}`,
        `${shared} more modules use this filter: ${(context.sharedWith || []).map(id => context.labelOf(id)).join(', ')}`))}</p>` : ''}

      <div class="dmfGroups">
        ${groups.map((group, groupIndex) => `
          ${groupIndex > 0 ? `<div class="dmfOr">${esc(T('VEYA', 'OR'))}</div>` : ''}
          <div class="dmfGroup">
            ${group.conditions.map((condition, index) => conditionRow(groupIndex, index, condition)).join('')
              || `<p class="dmfEmpty">${esc(T('Bu grupta koşul yok.', 'No conditions in this group.'))}</p>`}
            <div class="dmfGroupActions">
              <button type="button" class="dmfAdd" data-add-condition="${groupIndex}">+ ${esc(T('Filtre ekle', 'Add filter'))}</button>
              ${groups.length > 1 ? `<button type="button" class="dmfDrop" data-drop-group="${groupIndex}"
                title="${esc(T('Grubu sil', 'Delete group'))}">🗑 ${esc(T('grup', 'group'))}</button>` : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="dmfFoot">
        <button type="button" class="dmfAdd" data-add-group>+ ${esc(T('VEYA grubu ekle', 'Add OR group'))}</button>
        <span class="dmfSpacer"></span>
        ${message ? `<span class="dmfMessage is-${esc(messageTone)}">${esc(message)}</span>` : ''}
        <button type="button" class="tbtn" data-cancel ${busy ? 'disabled' : ''}>${esc(T('İptal', 'Cancel'))}</button>
        ${shared && canSplit
          ? `<button type="button" class="tbtn" data-save="split" ${busy ? 'disabled' : ''}
               title="${esc(linked
                 ? T('Bu modül bağlı gruptan ayrılır ve bu filtreyle çalışır; diğer bağlı modüller ortak filtrede kalır. Yenileme yine ortaktır.', 'This module leaves the linked group and runs with this filter; the other linked modules keep the shared filter. Refresh stays shared.')
                 : T('Diğer modüller eski filtreyi kullanmaya devam eder', 'Other modules keep the previous filter'))}">
               ${esc(linked
                 ? T(`Yalnız ${context.moduleLabel} için ayır (gruptan çıkar)`, `Split ${context.moduleLabel} only (unlink)`)
                 : T(`Yalnız ${context.moduleLabel} için ayır`, `Split for ${context.moduleLabel} only`))}</button>
             <button type="button" class="navActionBtn" data-save="shared" ${busy ? 'disabled' : ''}
               title="${esc(T(`${shared + 1} modülün hepsini etkiler`, `Affects all ${shared + 1} modules`))}">
               ${esc(linked ? T('Bağlı modüllerin hepsini güncelle', 'Update all linked modules') : T('Hepsini güncelle', 'Update all'))}</button>`
          : shared
          ? `<button type="button" class="navActionBtn" data-save="shared" ${busy ? 'disabled' : ''}
               title="${esc(T('Bağlı modüller tek ufuk paylaşır; hepsi birlikte güncellenir', 'Linked modules share one horizon; all are updated together'))}">
               ${esc(T('Bağlı modüllerin hepsini güncelle', 'Update all linked modules'))}</button>`
          : `<button type="button" class="navActionBtn" data-save="shared" ${busy ? 'disabled' : ''}>${esc(T('Kaydet', 'Save'))}</button>`}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  /* Seçici ORTAK modülden gelir (data-management-picker.js). Eşleme
     düzenleyicisi de aynı etkileşimi kullanıyor; iki kopya tutmak §9'a
     aykırı olurdu. */
  const closePicker = () => window.BLDataPicker?.close?.();
  const openPicker = (anchor, items, onPick, options) => window.BLDataPicker?.open?.(anchor, items, onPick, options);

  async function pickValue(anchor, condition) {
    const meta = fieldMeta(condition);
    const params = new URLSearchParams({ target: context.moduleId, sourceId: context.sourceId, field: condition.field, limit: '500' });
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
      render();
      /* allowFree: liste erişilemezse ya da aranan değer listede yoksa
         kullanıcı kilitlenmemeli — Enter ile elle yazabilir (§18). */
    }, { placeholder: T('Değer ara veya yaz…', 'Search or type a value…'), allowFree: true });

  }

  /* ---------------------------------------------------------------- */

  function conditionAt(ref) {
    const [groupIndex, index] = String(ref).split(':').map(Number);
    return groups[groupIndex] && groups[groupIndex].conditions[index];
  }

  async function save(mode) {
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
      if (typeof onSaved === 'function') onSaved(payload.warnings || []);
    } catch (error) {
      message = String(error && error.message || error);
      messageTone = 'bad';
      busy = false;
      render();
    }
  }

  function onClick(event) {
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
    if (addGroup) { groups.push({ id: uid(), conditions: [] }); render(); return; }

    const dropGroup = event.target.closest('[data-drop-group]');
    if (dropGroup) { groups.splice(Number(dropGroup.dataset.dropGroup), 1); render(); return; }

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
      groups[groupIndex].conditions.splice(index, 1);
      render();
      return;
    }

    const dropValue = event.target.closest('[data-drop-value]');
    if (dropValue) {
      const [groupIndex, index, valueIndex] = dropValue.dataset.dropValue.split(':').map(Number);
      groups[groupIndex].conditions[index].values.splice(valueIndex, 1);
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
      }, { placeholder: T('Sütun ara…', 'Search columns…') });
      return;
    }

    const pickValueBtn = event.target.closest('[data-pick-value]');
    if (pickValueBtn) {
      const condition = conditionAt(pickValueBtn.dataset.pickValue);
      if (condition && condition.field) void pickValue(pickValueBtn, condition);
    }
  }

  function onChange(event) {
    const op = event.target.closest('[data-op]');
    if (op) {
      const condition = conditionAt(op.dataset.op);
      condition.op = op.value;
      render();
      return;
    }
    const range = event.target.closest('[data-range]');
    if (range) {
      const [groupIndex, index, side] = range.dataset.range.split(':');
      groups[Number(groupIndex)].conditions[Number(index)][side] = range.value;
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
    groups = Array.isArray(definition.groups) && definition.groups.length
      ? JSON.parse(JSON.stringify(definition.groups))
      : [{ id: uid(), conditions: [] }];

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    host.innerHTML = `<p class="dmfEmpty">${esc(T('Alanlar yükleniyor…', 'Loading fields…'))}</p>`;

    templateMessage = '';
    void loadTemplates().then(render);
    try { await loadFields(); }
    catch (error) {
      message = String(error && error.message || error);
      messageTone = 'warn';
    }
    render();
  }

  window.BLDataFilterEditor = { open, close };
})();
