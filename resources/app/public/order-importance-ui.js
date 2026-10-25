/* Buyer Log — Sipariş önem etiketi arayüzü (CP / Orders hücresi + Ayarlar).
 *
 * Kural motoru public/order-importance.js'tedir (BLOrderImportance); burada
 * yalnız gösterim, seçim menüsü ve katalog düzenleyicisi vardır.
 *  - Hücre serbest metin kabul etmez: katalogdaki etiketlerden, Regular'dan ya
 *    da "Line kuralına dön" seçeneğinden seçilir. Menüden yeni etiket
 *    eklenebilir (katalog Ayarlar ile aynı uçtan kaydedilir).
 *  - Seçim hemen sunucuya yazılır (/api/overrides/:orderCode { importance }).
 *    Aynı sipariş satırı CP ve Orders'ta birlikte güncellenir.
 */
(function () {
  'use strict';
  const OI = window.BLOrderImportance;
  if (!OI) return;
  let settings = OI.defaultSettings();
  let revision = 0;
  let menu = null, trigger = null;

  const isEn = () => (typeof appLang !== 'undefined' ? appLang : document.documentElement.lang) === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const toast = message => { if (typeof showToast === 'function') showToast(message); };
  const appState = () => (typeof state !== 'undefined' ? state : window.state) || {};

  function setSettings(next, rev) {
    settings = OI.normalizeSettings(next);
    if (rev != null && Number.isFinite(Number(rev))) revision = Number(rev);
  }
  function getSettings() { return settings; }
  function excelValues() { return OI.excelValues(settings); }

  function rowResolution(row) {
    const id = row && row._importanceId;
    const tag = OI.tagById(settings, id);
    return { id: tag ? tag.id : OI.REGULAR_ID, tag, source: row && row._importanceSource || 'default' };
  }
  function plainText(row) {
    const { tag } = rowResolution(row);
    return tag ? OI.displayLabel(tag, isEn() ? 'en' : 'tr') : OI.REGULAR_LABEL;
  }
  function chipHtml(tag, source) {
    if (!tag) return `<span class="impChip impChip--regular">${esc(OI.REGULAR_LABEL)}</span>`;
    const ruleMark = source === 'rule' ? `<span class="impChipRule" aria-hidden="true">${esc(L('kural', 'rule'))}</span>` : '';
    return `<span class="impChip" data-tone="${esc(tag.tone || 'blue')}"><i class="impDot" aria-hidden="true"></i>${esc(OI.displayLabel(tag, isEn() ? 'en' : 'tr'))}${ruleMark}</span>`;
  }
  function sourceTitle(res) {
    if (res.source === 'rule') return L('Line kuralından geldi. Sipariş için farklı etiket seçebilirsiniz.', 'Comes from a Line rule. You can pick a different tag for this order.');
    if (res.source === 'manual') return L('Bu sipariş için seçildi.', 'Selected for this order.');
    return L('Etiket yok: Regular.', 'No tag: Regular.');
  }
  function cellHtml(row, canEdit, tableKey) {
    const res = rowResolution(row);
    const title = esc(sourceTitle(res));
    if (!canEdit) return `<td class="impTd" title="${title}">${chipHtml(res.tag, res.source)}</td>`;
    return `<td class="editTd impTd"><button type="button" class="editCell impTrigger" data-id="${esc(row._id)}" data-table="${esc(tableKey || 'cp')}" aria-haspopup="listbox" aria-expanded="false" title="${title}">${chipHtml(res.tag, res.source)}<span class="delTypeChevron" aria-hidden="true">▾</span></button></td>`;
  }

  /* ---------------------------------------------------------- satır güncelleme */
  function sourceRows(tableKey) {
    const st = appState();
    if (tableKey === 'orders') return st.orders && st.orders.rows || [];
    if (tableKey === 'orderSummary') return st.orderSummary && st.orderSummary.rows || [];
    return st.cp && st.cp.rows || [];
  }
  const keyOf = row => (typeof lineKeyOfRow === 'function' ? lineKeyOfRow(row) : '') || String(row && row['Order Code'] || '');
  function applyToRow(row, manual) {
    const resolved = OI.resolve({ line: row.Line, season: row.Season }, manual, settings);
    row[OI.ROW_KEY] = resolved.label;
    row._importanceId = resolved.id;
    row._importanceSource = resolved.source;
  }
  function manualOf(row) { return row && row._importanceSource === 'manual' ? row._importanceId : undefined; }
  function sameLineRows(row) {
    const key = keyOf(row);
    const all = [...sourceRows('cp'), ...sourceRows('orders'), ...sourceRows('orderSummary')];
    return key ? all.filter(item => keyOf(item) === key) : [row];
  }
  function repaint(rows) {
    if(window.isPreparingCpBulk?.())return;
    const st = appState();
    const cpRow = rows.find(item => (st.cp && st.cp.rows || []).includes(item));
    if (typeof invalidateCoreFacetCaches === 'function') invalidateCoreFacetCaches();
    if (cpRow && typeof refreshRowEverywhere === 'function') refreshRowEverywhere(cpRow._id);
    if (st.orders && typeof renderOrders === 'function') renderOrders();
  }
  // Katalog/kural değişince elle seçilmemiş satırlar kurala göre yeniden çözülür.
  function recomputeAllRows() {
    [...sourceRows('cp'), ...sourceRows('orders'), ...sourceRows('orderSummary')].forEach(row => applyToRow(row, manualOf(row)));
    if (typeof invalidateCoreFacetCaches === 'function') invalidateCoreFacetCaches();
    const st = appState();
    if (st.cp && typeof renderCP === 'function') renderCP();
    if (st.orders && typeof renderOrders === 'function') renderOrders();
  }

  async function assign(row, value) {
    if(window.isSavingCpBulk?.()&&!window.isPreparingCpBulk?.()){toast(L('Toplu kayıt sürüyor. Sonucundan sonra yeniden deneyin.','A bulk save is still pending. Retry after its result.'));return;}
    if (!row) return;
    if (row._canEdit === false) { toast(L('Bu sipariş için yalnız görüntüleme yetkiniz var.', 'You only have view access to this order.')); return; }
    const orderCode = row['Order Code'];
    if (orderCode == null) return;
    const rows = sameLineRows(row);
    const before = rows.map(item => [item, item[OI.ROW_KEY], item._importanceId, item._importanceSource]);
    rows.forEach(item => applyToRow(item, value || undefined));
    const st = appState(), key = keyOf(row);
    if (st.overrides) {
      st.overrides.importancemap = st.overrides.importancemap || {};
      if (value) st.overrides.importancemap[key] = value; else delete st.overrides.importancemap[key];
    }
    repaint(rows);
    if (!window.SERVER_BACKED || typeof window.enqueueOverrideMutation !== 'function') return;
    const identity = typeof lineIdentity === 'function' ? lineIdentity(row) : {};
    try {
      await window.enqueueOverrideMutation('orders', `/api/overrides/${orderCode}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identity, importance: value || null }),
      });
    } catch (err) {
      before.forEach(([item, label, id, source]) => { item[OI.ROW_KEY] = label; item._importanceId = id; item._importanceSource = source; });
      repaint(rows);
      if (err && err.code !== 'REVISION_CONFLICT') toast(L('Önem etiketi kaydedilemedi: ', 'Importance tag could not be saved: ') + (err && err.message || ''));
    }
  }

  /* CP çoklu yapıştırma: görünen etiket (TR/EN) veya "Regular" katalog
     kimliğine çözülür; boş değer elle seçimi kaldırır. Serbest metin kabul edilmez. */
  function pasteResolve(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: true, value: '' };
    const id = OI.idForLabel(settings, raw);
    return id ? { ok: true, value: id } : { ok: false };
  }
  function pasteAssign(row, id) {
    if (!row || row._canEdit === false) return false;
    const res = rowResolution(row);
    if (id ? res.id === id : res.source !== 'manual') return false;
    void assign(row, id || '');
    return true;
  }

  /* ---------------------------------------------------------- katalog kaydı */
  async function saveSettings(next) {
    const body = JSON.stringify({ settings: OI.normalizeSettings(next) });
    let data;
    if (typeof fetchJSON === 'function') {
      data = await fetchJSON('/api/order-importance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, expectedRevision: revision });
    } else {
      const res = await fetch('/api/order-importance', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(revision) }, body });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { code: data.code || '' });
    }
    setSettings(data.settings, data.revision);
    return data;
  }
  async function reloadSettings() {
    try {
      const res = await fetch('/api/order-importance', { credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok) setSettings(data.settings, data.revision);
    } catch (_) { /* çevrimdışı: eldeki katalog kalır */ }
  }
  function saveErrorText(err) {
    if (err && err.code === 'REVISION_CONFLICT') return L('Etiketler başka bir pencerede değişti; güncel liste yüklendi, tekrar deneyin.', 'Tags changed in another window; the current list was loaded, please try again.');
    return L('Önem etiketleri kaydedilemedi: ', 'Importance tags could not be saved: ') + (err && err.message || '');
  }

  async function askLabel(title) {
    if (typeof openHorizonTextInput === 'function') {
      return openHorizonTextInput({ title, label: L('Etiket adı', 'Tag name'), confirmLabel: L('Ekle', 'Add'), maxLength: 40 });
    }
    return window.prompt(title, '');
  }
  async function addTagAndAssign(row) {
    const label = String(await askLabel(L('Yeni önem etiketi', 'New importance tag')) || '').trim();
    if (!label) return;
    const existing = OI.idForLabel(settings, label);
    if (existing) { await assign(row, existing); return; }
    const next = { ...settings, tags: [...settings.tags, { label, tone: OI.TONES[settings.tags.length % OI.TONES.length] }] };
    try {
      await saveSettings(next);
      const id = OI.idForLabel(settings, label);
      if (id) await assign(row, id);
      toast(L(`"${label}" etiketi eklendi.`, `Tag "${label}" added.`));
    } catch (err) { toast(saveErrorText(err)); if (err && err.code === 'REVISION_CONFLICT') await reloadSettings(); }
  }

  /* ---------------------------------------------------------- seçim menüsü */
  function closeMenu() {
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.remove();
    menu = null; trigger = null;
  }
  function findRow(btn) {
    const id = Number(btn.dataset.id);
    return sourceRows(btn.dataset.table === 'orders' ? 'orders' : 'cp').find(row => row && row._id === id) || null;
  }
  function openMenu(btn) {
    if (trigger === btn) { closeMenu(); return; }
    closeMenu();
    const row = findRow(btn);
    if (!row) return;
    trigger = btn; btn.setAttribute('aria-expanded', 'true');
    const res = rowResolution(row);
    const option = (value, html, selected, extra) => `<button type="button" class="delTypeOption impOption${extra ? ' ' + extra : ''}" role="option" aria-selected="${selected ? 'true' : 'false'}" data-imp-value="${esc(value)}">${html}</button>`;
    const items = [
      option(OI.REGULAR_ID, chipHtml(null), res.id === OI.REGULAR_ID && res.source === 'manual'),
      ...settings.tags.map(tag => option(tag.id, chipHtml(tag), res.id === tag.id)),
    ];
    if (res.source === 'manual') items.push(option('', esc(L('Seçimi kaldır (Line kuralı / Regular)', 'Clear selection (Line rule / Regular)')), false, 'impOptionAction'));
    items.push('<div class="impMenuSep" role="separator"></div>');
    items.push(`<button type="button" class="delTypeOption impOption impOptionAction" data-imp-action="add">＋ ${esc(L('Yeni etiket ekle…', 'Add new tag…'))}</button>`);
    items.push(`<button type="button" class="delTypeOption impOption impOptionAction" data-imp-action="manage">${esc(L('Etiketleri ve Line kurallarını yönet…', 'Manage tags and Line rules…'))}</button>`);
    menu = document.createElement('div');
    menu.className = 'delTypeMenu impMenu'; menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', L('Önem etiketi', 'Importance tag'));
    menu.innerHTML = items.join('');
    document.body.appendChild(menu);
    menu.style.width = Math.max(btn.getBoundingClientRect().width, 220) + 'px';
    menu.style.maxHeight = Math.min(320, window.innerHeight - 20) + 'px';
    if (typeof window.positionBuyerLogPopup === 'function') window.positionBuyerLogPopup(menu, btn, { gap: 4 });
    else { const r = btn.getBoundingClientRect(); menu.style.left = r.left + 'px'; menu.style.top = (r.bottom + 4) + 'px'; }
    menu.addEventListener('click', event => {
      event.stopPropagation();
      const el = event.target.closest('[data-imp-value],[data-imp-action]');
      if (!el) return;
      closeMenu();
      if (el.dataset.impAction === 'add') { void addTagAndAssign(row); return; }
      if (el.dataset.impAction === 'manage') { openSettings(); return; }
      void assign(row, el.dataset.impValue || '');
    });
    requestAnimationFrame(() => (menu && (menu.querySelector('[aria-selected="true"]') || menu.querySelector('.impOption')))?.focus());
  }
  document.addEventListener('click', event => {
    const btn = event.target.closest && event.target.closest('.impTrigger');
    if (btn) { event.preventDefault(); event.stopPropagation(); openMenu(btn); return; }
    if (menu && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (!menu) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const opts = [...menu.querySelectorAll('.impOption')], i = opts.indexOf(document.activeElement);
      opts[(i + (event.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
    }
  });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', event => { if (event.target instanceof Element && event.target.closest('.impMenu')) return; closeMenu(); }, true);

  /* ---------------------------------------------------------- Ayarlar penceresi */
  function knownValues(field) {
    const seen = new Map();
    [...sourceRows('cp'), ...sourceRows('orders')].forEach(row => {
      const value = String(row && row[field] || '').trim();
      if (value && !seen.has(OI.fold(value))) seen.set(OI.fold(value), value);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
  }
  function usageCounts() {
    const counts = new Map();
    const rows = sourceRows('orders').length ? sourceRows('orders') : sourceRows('cp');
    rows.forEach(row => {
      const id = row && row._importanceId;
      if (id && id !== OI.REGULAR_ID) counts.set(id, (counts.get(id) || 0) + 1);
    });
    return counts;
  }
  function openSettings() {
    closeMenu();
    document.getElementById('orderImportanceSettingsModal')?.remove();
    let working = JSON.parse(JSON.stringify(settings));
    const modal = document.createElement('div');
    modal.id = 'orderImportanceSettingsModal';
    modal.className = 'warnOverlay';
    const lineOptions = knownValues('Line').map(value => `<option value="${esc(value)}"></option>`).join('');
    const seasonOptions = knownValues('Season').map(value => `<option value="${esc(value)}"></option>`).join('');
    const toneLabel = tone => ({ red: L('Kırmızı', 'Red'), orange: L('Turuncu', 'Orange'), gold: L('Altın', 'Gold'), green: L('Yeşil', 'Green'), teal: L('Camgöbeği', 'Teal'), blue: L('Mavi', 'Blue'), purple: L('Mor', 'Purple'), pink: L('Pembe', 'Pink') }[tone] || tone);
    function render() {
      const counts = usageCounts();
      const tagRows = working.tags.map((tag, index) => `<div class="impSetRow" data-tag-index="${index}">
          <span class="impChip" data-tone="${esc(tag.tone || 'blue')}"><i class="impDot"></i></span>
          <input type="text" maxlength="40" data-tag-field="label" value="${esc(tag.label)}" aria-label="${esc(L('Etiket (rapor değeri)', 'Tag (report value)'))}" placeholder="${esc(L('Etiket', 'Tag'))}">
          <input type="text" maxlength="40" data-tag-field="labelEn" value="${esc(tag.labelEn || '')}" aria-label="${esc(L('İngilizce görünen ad', 'English display name'))}" placeholder="${esc(L('İngilizce ad (isteğe bağlı)', 'English name (optional)'))}">
          <select data-tag-field="tone" aria-label="${esc(L('Renk', 'Colour'))}">${OI.TONES.map(tone => `<option value="${tone}"${tone === (tag.tone || 'blue') ? ' selected' : ''}>${esc(toneLabel(tone))}</option>`).join('')}</select>
          <span class="impSetCount">${counts.get(tag.id) ? esc(L(`${counts.get(tag.id)} satır`, `${counts.get(tag.id)} lines`)) : ''}</span>
          <button type="button" class="pricingRuleIconBtn" data-tag-delete="${index}" title="${esc(L('Etiketi sil', 'Delete tag'))}" aria-label="${esc(L('Etiketi sil', 'Delete tag'))}"><svg class="ic"><use href="#i-trash"/></svg></button>
        </div>`).join('');
      const tagSelect = selected => working.tags.map(tag => `<option value="${esc(tag.id)}"${tag.id === selected ? ' selected' : ''}>${esc(tag.label)}</option>`).join('');
      const ruleRows = working.rules.map((rule, index) => `<div class="impSetRow impRuleRow" data-rule-index="${index}">
          <select data-rule-field="tagId" aria-label="${esc(L('Etiket', 'Tag'))}">${tagSelect(rule.tagId)}</select>
          <input type="text" list="impLineList" data-rule-field="lines" value="${esc((rule.lines || []).join(', '))}" placeholder="${esc(L('Line (virgülle birden fazla)', 'Line (comma-separated)'))}" aria-label="Line">
          <input type="text" list="impSeasonList" data-rule-field="seasons" value="${esc((rule.seasons || []).join(', '))}" placeholder="${esc(L('Sezon (boş = tüm sezonlar)', 'Season (blank = all seasons)'))}" aria-label="${esc(L('Sezon', 'Season'))}">
          <button type="button" class="pricingRuleIconBtn" data-rule-delete="${index}" title="${esc(L('Kuralı sil', 'Delete rule'))}" aria-label="${esc(L('Kuralı sil', 'Delete rule'))}"><svg class="ic"><use href="#i-trash"/></svg></button>
        </div>`).join('');
      modal.innerHTML = `<div class="modalCard impSetCard" role="dialog" aria-modal="true" aria-labelledby="impSetTitle">
        <div class="modelConnHead"><div><div class="modalTitle" id="impSetTitle">${esc(L('Sipariş Önem Etiketleri', 'Order Importance Tags'))}</div>
          <div class="modelConnSub">${esc(L('Özel siparişleri (BTS, Bayram …) ayırt eder. Etiketi olmayan sipariş Regular sayılır; Backlog raporu ve özetleri bu etikete göre ayrı değerlendirilir.', 'Marks special orders (BTS, Eid …). Untagged orders count as Regular; the Backlog report and summaries evaluate them separately.'))}</div></div>
          <button type="button" class="pricingRuleIconBtn" data-imp-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
        <div class="impSetBody">
          <section class="impSetSection"><div class="impSetSectionHead"><b>${esc(L('Etiketler', 'Tags'))}</b><span>${esc(L('Rapor ve Excel listesinde etiket adı kullanılır.', 'The tag name is used in reports and the Excel list.'))}</span></div>
            <div class="impSetList">${tagRows || `<div class="impSetEmpty">${esc(L('Etiket yok. Tüm siparişler Regular.', 'No tags. Every order is Regular.'))}</div>`}</div>
            <button type="button" class="tbtn" data-tag-add>＋ ${esc(L('Etiket ekle', 'Add tag'))}</button></section>
          <section class="impSetSection"><div class="impSetSectionHead"><b>${esc(L('Line kuralları', 'Line rules'))}</b><span>${esc(L('Line grubunun (isteğe bağlı sezonla) tüm siparişlerini etiketler. Siparişte seçilen etiket kuralı ezer.', 'Tags every order of a Line group (optionally by season). A tag chosen on the order overrides the rule.'))}</span></div>
            <div class="impSetList">${ruleRows || `<div class="impSetEmpty">${esc(L('Kural yok.', 'No rules.'))}</div>`}</div>
            <button type="button" class="tbtn" data-rule-add${working.tags.length ? '' : ' disabled'}>＋ ${esc(L('Kural ekle', 'Add rule'))}</button></section>
          <datalist id="impLineList">${lineOptions}</datalist><datalist id="impSeasonList">${seasonOptions}</datalist>
        </div>
        <div class="modelConnFoot"><button type="button" class="tbtn" data-imp-defaults>${esc(L('Ön tanımlı etiketleri ekle', 'Add default tags'))}</button><span style="flex:1"></span><button type="button" class="tbtn" data-imp-close>${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="navActionBtn" data-imp-save>${esc(L('Kaydet', 'Save'))}</button></div>
      </div>`;
    }
    function collect() {
      modal.querySelectorAll('[data-tag-index]').forEach(rowEl => {
        const tag = working.tags[Number(rowEl.dataset.tagIndex)];
        if (!tag) return;
        rowEl.querySelectorAll('[data-tag-field]').forEach(input => { tag[input.dataset.tagField] = input.value; });
      });
      modal.querySelectorAll('[data-rule-index]').forEach(rowEl => {
        const rule = working.rules[Number(rowEl.dataset.ruleIndex)];
        if (!rule) return;
        rowEl.querySelectorAll('[data-rule-field]').forEach(input => {
          rule[input.dataset.ruleField] = input.dataset.ruleField === 'tagId' ? input.value : OI.normalizeList(input.value);
        });
      });
    }
    render();
    document.body.appendChild(modal);
    modal.addEventListener('click', async event => {
      const target = event.target;
      if (target === modal || target.closest('[data-imp-close]')) { modal.remove(); return; }
      if (target.closest('[data-tag-add]')) {
        collect();
        // Kimlik hemen verilir: aynı pencerede bu etikete Line kuralı bağlanabilsin.
        working.tags.push({ id: `tag-${Date.now().toString(36)}`, label: '', tone: OI.TONES[working.tags.length % OI.TONES.length] });
        render();
        modal.querySelector('[data-tag-index]:last-of-type [data-tag-field="label"]')?.focus();
        return;
      }
      const tagDelete = target.closest('[data-tag-delete]');
      if (tagDelete) {
        collect();
        const tag = working.tags[Number(tagDelete.dataset.tagDelete)];
        const used = tag && usageCounts().get(tag.id);
        if (used && !window.confirm(L(`"${tag.label}" ${used} satırda kullanılıyor. Silinirse bu siparişler Regular olur. Devam edilsin mi?`, `"${tag.label}" is used on ${used} lines. Deleting it turns those orders Regular. Continue?`))) return;
        working.tags.splice(Number(tagDelete.dataset.tagDelete), 1);
        const ids = new Set(working.tags.map(item => item.id));
        working.rules = working.rules.filter(rule => ids.has(rule.tagId));
        render();
        return;
      }
      if (target.closest('[data-rule-add]')) {
        collect();
        const firstId = (working.tags[0] || {}).id;
        if (!firstId) return;
        working.rules.push({ id: '', tagId: firstId, lines: [], seasons: [] });
        render();
        return;
      }
      const ruleDelete = target.closest('[data-rule-delete]');
      if (ruleDelete) { collect(); working.rules.splice(Number(ruleDelete.dataset.ruleDelete), 1); render(); return; }
      if (target.closest('[data-imp-defaults]')) {
        collect();
        working.tags = OI.normalizeTags([...working.tags, ...OI.DEFAULT_TAGS]);
        render();
        return;
      }
      if (target.closest('[data-imp-save]')) {
        collect();
        const incompleteRule = working.rules.some(rule => !rule.lines || !rule.lines.length);
        if (incompleteRule && !window.confirm(L('Line girilmemiş kurallar kaydedilmeyecek. Devam edilsin mi?', 'Rules without a Line will not be saved. Continue?'))) return;
        const button = target.closest('[data-imp-save]'); button.disabled = true;
        try {
          const data = await saveSettings(working);
          modal.remove();
          recomputeAllRows();
          toast(data && data.pruned
            ? L(`Önem etiketleri kaydedildi. Silinen etiketlerin ${data.pruned} ataması Regular'a döndü.`, `Importance tags saved. ${data.pruned} assignments of deleted tags reverted to Regular.`)
            : L('Önem etiketleri kaydedildi.', 'Importance tags saved.'));
        } catch (err) {
          button.disabled = false;
          toast(saveErrorText(err));
          if (err && err.code === 'REVISION_CONFLICT') { await reloadSettings(); working = JSON.parse(JSON.stringify(settings)); render(); }
        }
      }
    });
    modal.addEventListener('change', event => {
      if (event.target.matches('[data-tag-field="tone"]')) { collect(); render(); }
    });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); modal.remove(); } });
    setTimeout(() => modal.querySelector('[data-tag-field="label"]')?.focus(), 0);
  }

  // Canlı yama (başka pencere / ekip arkadaşı): değer etiket kimliği ya da null.
  function applyRemote(row, value) { if (row) applyToRow(row, value || undefined); }

  window.BLOrderImportanceUI = Object.freeze({
    setSettings, getSettings, excelValues, plainText, cellHtml, openSettings, reloadSettings, recomputeAllRows, applyRemote, pasteResolve, pasteAssign,
    revision: () => revision,
  });
})();
