/* Buyer Log — CP BOM Kontrol penceresi.
 *
 * Kapsam: CP'de seçili satırlar, seçim yoksa görünen (filtrelenmiş) satırlar.
 * Veri: PLM SYNC'in sakladığı tam BOM kalemleri (/api/plm-sync/bom/control);
 * bu pencere CoreNectum'a veya LCW AI'a istek atmaz, CP satırlarını
 * değiştirmez. Analiz BLBomControlEngine'dedir; burası yalnız çizim ve
 * kullanıcı tercihleridir (kırılım, kalem düzeyi, Ortak / Model bazlı
 * işaretleri — hesapla senkron 'lcw.cp.bomControl.' öneki).
 */
(function () {
  'use strict';
  if (window.BLBomControl) return;

  const PREF_KEY = 'lcw.cp.bomControl.v1';
  const MAX_LEVELS = 4;
  const CHIP_LIMIT = 8;
  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const engine = () => window.BLBomControlEngine;
  const storage = () => { try { return window.BLStorage || window.localStorage; } catch (_) { return null; } };

  function numericId(value) {
    let text = String(value == null ? '' : value).trim().replace(/^_+/, '');
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }
  /* Ortak alanlar canonical ID + CP bağlamasıyla okunur (ör. PLM ID / Plm Kod /
     plmId); ham başlık eşleştirmesi yapılmaz. */
  function canonicalValue(row, fieldId) {
    try {
      const canonical = window.BLCanonicalFields;
      // value(): ham değer (model adı görüntü için korunur; PLM ID numericId ile normalize edilir).
      return canonical && typeof canonical.value === 'function' ? canonical.value(row, 'cp', fieldId) : '';
    } catch (_) { return ''; }
  }
  function loadPrefs() {
    let raw = null;
    try { raw = JSON.parse(storage()?.getItem(PREF_KEY) || 'null'); } catch (_) { raw = null; }
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      levels: (Array.isArray(src.levels) ? src.levels : []).map(String).filter(Boolean).slice(0, MAX_LEVELS),
      slotLevel: engine().SLOT_LEVELS.includes(src.slotLevel) ? src.slotLevel : 'category',
      marks: engine().normalizeMarks(src.marks),
      onlyDeviations: src.onlyDeviations === true,
    };
  }
  function savePrefs(prefs) {
    try { storage()?.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* tercih kaydı opsiyoneldir */ }
  }

  async function fetchEntries(plmIds) {
    const out = new Map();
    for (let i = 0; i < plmIds.length; i += 500) {
      const response = await fetch('/api/plm-sync/bom/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ plmIds: plmIds.slice(i, i + 500) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || L('BOM verisi okunamadı.', 'BOM data could not be read.'));
      for (const [id, entry] of Object.entries(payload.entries || {})) out.set(id, entry);
    }
    return out;
  }

  function slotLevelLabel(level) {
    if (level === 'main') return L('Ana kategori', 'Main category');
    if (level === 'group') return L('Kategori grubu', 'Category group');
    return L('Kategori', 'Category');
  }
  function modeBadge(slot) {
    const errors = slot.findings.length;
    if (slot.mode === 'common') return errors
      ? `<span class="cpaPlm tone-bad">${esc(L(`Sapma · ${errors} model`, `Deviation · ${errors} models`))}</span>`
      : `<span class="cpaPlm tone-ok">${esc(L('Ortak · tutarlı', 'Common · consistent'))}</span>`;
    if (slot.mode === 'auto-common') return errors
      ? `<span class="cpaPlm tone-wait">${esc(L(`Olası sapma · ${errors} model`, `Possible deviation · ${errors} models`))}</span>`
      : `<span class="cpaPlm tone-ok">${esc(L('Ortak görünüyor', 'Looks common'))}</span>`;
    if (slot.mode === 'scattered') return `<span class="cpaPlm tone-bad">${esc(L('Ortak işaretli · baskın kod yok', 'Marked common · no dominant code'))}</span>`;
    if (slot.mode === 'model') return `<span class="cpaPlm tone-off">${esc(L('Model bazlı', 'Model-specific'))}</span>`;
    return `<span class="cpaPlm tone-off">${esc(L('Model bazlı görünüyor', 'Looks model-specific'))}</span>`;
  }

  function open(options = {}) {
    const E = engine();
    if (!E) throw new Error('BLBomControlEngine');
    const rows = Array.isArray(options.rows) ? options.rows : [];
    const columns = (Array.isArray(options.columns) ? options.columns : []).filter(col => col && col.key);
    const columnLabel = new Map(columns.map(col => [col.key, col.label || col.key]));
    const getValue = typeof options.getValue === 'function' ? options.getValue : (row, key) => row && row[key];
    const prefs = loadPrefs();
    prefs.levels = prefs.levels.filter(key => columnLabel.has(key));
    const view = { bom: null, error: '', nodeId: '', expanded: new Set(), tree: null, aggregates: new Map(), results: new Map(), models: [] };

    const overlay = document.createElement('div');
    overlay.className = 'cpaModalOverlay bomcOverlay';
    const titleId = 'bomcTitle' + Date.now().toString(36);
    overlay.innerHTML = `<div class="cpaModal bomcModal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <header><div><b id="${titleId}">${esc(L('BOM Kontrol', 'BOM Check'))}</b><small data-bomc-sub></small></div>
        <button type="button" data-bomc-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="bomcToolbar" data-bomc-toolbar></div>
      <div class="bomcBody"><nav class="bomcTree" data-bomc-tree aria-label="${esc(L('Kırılım', 'Breakdown'))}"></nav>
        <section class="bomcDetail" data-bomc-detail aria-live="polite"><p class="cpaEmpty">${esc(L('BOM kalemleri yükleniyor…', 'Loading BOM items…'))}</p></section></div>
      <footer><button type="button" class="cpaBtn ghost" data-bomc-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
    let releaseKeyboard = () => {};
    const close = () => {
      releaseKeyboard();
      overlay.remove();
      try { options.trigger?.focus?.(); } catch (_) { /* tetikleyici kaybolmuş olabilir */ }
    };
    overlay.querySelectorAll('[data-bomc-close]').forEach(el => { el.onclick = close; });
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.body.appendChild(overlay);
    releaseKeyboard = window.BLUI?.bindDialogKeyboard?.(overlay, { onEscape: close }) || (() => {});
    if (window.BLMotionPlus?.enabled?.()) window.BLMotionPlus.play('overlay', overlay.querySelector('.bomcModal'));
    overlay.querySelector('[data-bomc-close]')?.focus();

    const $ = sel => overlay.querySelector(sel);
    const labelOf = plmId => {
      const model = view.models.find(item => item.plmId === plmId);
      return model ? (model.label || 'PLM ' + plmId) : 'PLM ' + plmId;
    };

    function rebuild() {
      view.models = E.modelsFromRows(rows, {
        fields: prefs.levels,
        plmIdOf: row => numericId(canonicalValue(row, 'plmId')),
        labelOf: row => String(canonicalValue(row, 'modelName') || '').trim(),
        getValue,
      }).map(model => {
        const entry = view.bom && view.bom.get(model.plmId);
        const full = Boolean(entry && entry.coverage === 'full');
        return { ...model, hasBom: full, partial: Boolean(entry && !full), components: full ? entry.components : [] };
      });
      view.tree = E.buildTree(view.models, prefs.levels);
      view.aggregates = new Map();
      for (const [id, node] of view.tree.byId) view.aggregates.set(id, E.aggregate(node.models, prefs.slotLevel));
      if (!view.tree.byId.has(view.nodeId)) view.nodeId = '';
      reevaluate();
    }
    // İşaret değişimi toplamayı yeniden yapmaz; yalnız durum/sapma yeniden hesaplanır.
    function reevaluate() {
      view.results = new Map();
      for (const [id, agg] of view.aggregates) view.results.set(id, E.evaluate(agg, { marks: prefs.marks }));
    }

    function nodeLabel(node) {
      if (!node.depth) return L('Tüm kapsam', 'Whole scope');
      return node.value || L('(Boş)', '(Blank)');
    }
    function renderToolbar() {
      const chosen = prefs.levels.map((key, index) => `<span class="bomcLevel"><small>${index + 1}</small><b>${esc(columnLabel.get(key) || key)}</b>
        <button type="button" class="cpaIconBtn" data-level-up="${index}" ${index ? '' : 'disabled'} aria-label="${esc(L('Yukarı taşı', 'Move up'))}">↑</button>
        <button type="button" class="cpaIconBtn" data-level-remove="${index}" aria-label="${esc(L('Kırılımı kaldır', 'Remove breakdown'))}">×</button></span>`).join('<span class="bomcArrow" aria-hidden="true">›</span>');
      const options = columns.filter(col => !prefs.levels.includes(col.key))
        .map(col => `<option value="${esc(col.key)}">${esc(col.label)}</option>`).join('');
      const seg = E.SLOT_LEVELS.map(level => `<button type="button" data-slot-level="${level}" class="${prefs.slotLevel === level ? 'is-on' : ''}" aria-pressed="${prefs.slotLevel === level}">${esc(slotLevelLabel(level))}</button>`).join('');
      $('[data-bomc-toolbar]').innerHTML = `
        <div class="bomcGroup"><span class="bomcCap">${esc(L('Kırılım', 'Breakdown'))}</span>${chosen || `<span class="bomcHint">${esc(L('Kırılım yok · tüm kapsam tek grup', 'No breakdown · whole scope is one group'))}</span>`}
          ${prefs.levels.length < MAX_LEVELS ? `<select data-level-add aria-label="${esc(L('Kırılım ekle', 'Add breakdown'))}"><option value="">${esc(L('+ Kırılım ekle', '+ Add breakdown'))}</option>${options}</select>` : ''}</div>
        <div class="bomcGroup"><span class="bomcCap">${esc(L('Kalem düzeyi', 'Item level'))}</span><div class="cpaSeg" role="group">${seg}</div></div>
        <label class="cpaCheck bomcGroup"><input type="checkbox" data-only-dev ${prefs.onlyDeviations ? 'checked' : ''}><span>${esc(L('Yalnız sapmalar', 'Deviations only'))}</span></label>`;
    }
    function renderTree() {
      const items = [];
      const walk = node => {
        const result = view.results.get(node.id);
        const s = result ? result.summary : { errors: 0, warnings: 0 };
        items.push(`<button type="button" class="bomcNode${node.id === view.nodeId ? ' is-on' : ''}" data-node="${esc(node.id)}" style="--bomc-depth:${node.depth}" aria-current="${node.id === view.nodeId}">
          <span class="bomcNodeLabel" title="${esc(node.depth ? (columnLabel.get(node.field) || node.field) + ': ' + nodeLabel(node) : nodeLabel(node))}">${esc(nodeLabel(node))}</span>
          <span class="bomcNodeMeta">${s.errors ? `<span class="cpaPlm tone-bad">${s.errors}</span>` : ''}${s.warnings ? `<span class="cpaPlm tone-wait">${s.warnings}</span>` : ''}<small>${node.models.length}</small></span></button>`);
        node.children.forEach(walk);
      };
      walk(view.tree.root);
      $('[data-bomc-tree]').innerHTML = items.join('');
    }
    function codeLine(item, n) {
      const title = [item.name, item.description].filter(Boolean).join(' · ');
      const qty = item.quantities.length > 1 ? ` <small>${esc(L('Miktar', 'Qty'))}: ${item.quantities.slice(0, 3).map(q => `${esc(q.value)}×${q.count}`).join(' · ')}</small>` : '';
      return `<li class="${item.majority ? 'is-major' : 'is-minor'}"><b title="${esc(title)}">${esc(item.code)}</b><span>${esc(title || '—')}</span><span class="bomcCount">${item.count}/${n}</span>${qty}</li>`;
    }
    function findingChip(finding) {
      const detail = finding.kind === 'absent'
        ? L('kalem BOM\'da yok', 'item not in BOM')
        : [finding.extra.length ? L('kod: ', 'code: ') + finding.extra.join(', ') : '', finding.missing.length ? L('beklenen: ', 'expected: ') + finding.missing.join(', ') : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="bomcFinding tone-${finding.severity === 'error' ? 'bad' : 'wait'}" data-open-bom="${esc(finding.plmId)}" title="${esc(L('BOM detayını aç', 'Open BOM detail'))}">
        <b>${esc(labelOf(finding.plmId))}</b><small>PLM ${esc(finding.plmId)} · ${esc(detail)}</small></button>`;
    }
    function renderDetail() {
      const box = $('[data-bomc-detail]');
      if (view.error) { box.innerHTML = `<p class="cpaEmpty">${esc(view.error)}</p>`; return; }
      const node = view.tree.byId.get(view.nodeId) || view.tree.root;
      const result = view.results.get(node.id);
      const n = result.bomModelCount;
      const crumbs = [`<b>${esc(nodeLabel(view.tree.root))}</b>`];
      for (let depth = 1; depth <= node.depth; depth += 1) {
        const cur = view.tree.byId.get(JSON.stringify(node.path.slice(0, depth)));
        if (cur) crumbs.push(`${esc(columnLabel.get(cur.field) || cur.field)}: <b>${esc(nodeLabel(cur))}</b>`);
      }
      const partial = node.models.filter(model => model.partial);
      const missing = node.models.filter(model => !model.hasBom && !model.partial);
      const notice = (partial.length || missing.length) ? `<p class="cpaWarn bomcNotice">${esc(L(
        `${missing.length + partial.length} model karşılaştırmaya girmedi (${missing.length} BOM kaydı yok, ${partial.length} eski kayıt yalnız baskı içeriyor). CP'de PLM SYNC → Artwork/Fabric ile BOM'u yenileyin.`,
        `${missing.length + partial.length} models are not compared (${missing.length} without a BOM record, ${partial.length} older records with print items only). Refresh BOM in CP with PLM SYNC → Artwork/Fabric.`))}</p>` : '';
      const s = result.summary;
      const kpis = `<div class="cpaChips">
        <div class="cpaChip is-static"><span class="l">${esc(L('Model', 'Styles'))}</span><span class="n">${node.models.length}</span><span class="q">${esc(L(`${n} BOM ile`, `${n} with BOM`))}</span></div>
        <div class="cpaChip is-static"><span class="l">${esc(L('Ortak kalem', 'Common items'))}</span><span class="n">${s.commonSlots}</span></div>
        <div class="cpaChip is-static"><span class="l">${esc(L('Model bazlı kalem', 'Model-specific items'))}</span><span class="n">${s.modelSlots}</span></div>
        <div class="cpaChip is-static tone-red"><span class="l">${esc(L('Sapma (işaretli)', 'Deviation (marked)'))}</span><span class="n">${s.errors}</span></div>
        <div class="cpaChip is-static tone-orange"><span class="l">${esc(L('Olası sapma', 'Possible deviation'))}</span><span class="n">${s.warnings}</span></div>
        <div class="cpaChip is-static"><span class="l">${esc(L('Sapan model', 'Deviating styles'))}</span><span class="n">${s.flaggedModels}</span></div></div>`;
      const slots = prefs.onlyDeviations ? result.slots.filter(slot => slot.findings.length || slot.mode === 'scattered') : result.slots;
      const body = slots.map(slot => {
        const open = view.expanded.has(slot.key);
        const codes = open ? slot.codes : slot.codes.slice(0, 3);
        const findings = open ? slot.findings : slot.findings.slice(0, CHIP_LIMIT);
        const more = (slot.codes.length > codes.length || slot.findings.length > findings.length) || (open && (slot.codes.length > 3 || slot.findings.length > CHIP_LIMIT));
        const markSeg = [['common', L('Ortak', 'Common')], ['model', L('Model bazlı', 'Model-specific')], ['', L('Otomatik', 'Auto')]]
          .map(([value, text]) => `<button type="button" data-mark="${esc(slot.markKey)}" data-mark-value="${value}" class="${slot.mark === value ? 'is-on' : ''}" aria-pressed="${slot.mark === value}">${esc(text)}</button>`).join('');
        return `<tr data-slot="${esc(slot.key)}">
          <td><b>${esc(slot.label)}</b>${slot.part ? ` <span class="cpaPlm">${esc(L('Parça', 'Part'))} ${esc(slot.part)}</span>` : ''}<small>${esc(L(`${slot.presence.count}/${n} modelde`, `in ${slot.presence.count}/${n} styles`))}</small><div class="bomcState">${modeBadge(slot)}</div></td>
          <td><div class="cpaSeg bomcMarkSeg" role="group" aria-label="${esc(L('Kalem işareti', 'Item mark'))}">${markSeg}</div></td>
          <td><ul class="bomcCodes">${codes.map(item => codeLine(item, n)).join('')}</ul></td>
          <td><div class="bomcFindings">${findings.map(findingChip).join('') || '<span class="bomcHint">—</span>'}</div>
            ${more ? `<button type="button" class="cpaBtn sm ghost" data-expand="${esc(slot.key)}">${esc(open ? L('Daralt', 'Collapse') : L(`Tümü (${slot.codes.length} kod · ${slot.findings.length} model)`, `All (${slot.codes.length} codes · ${slot.findings.length} styles)`))}</button>` : ''}</td></tr>`;
      }).join('');
      const table = !n
        ? `<p class="cpaEmpty">${esc(L('Bu grupta karşılaştırılabilir BOM yok.', 'No comparable BOM in this group.'))}</p>`
        : slots.length
          ? `<div class="bomcScroll"><table class="cpaTable bomcTable"><thead><tr><th>${esc(L('Kalem', 'Item'))}</th><th>${esc(L('İşaret', 'Mark'))}</th><th>${esc(L('Kodlar', 'Codes'))}</th><th>${esc(L('Sapan modeller', 'Deviating styles'))}</th></tr></thead><tbody>${body}</tbody></table></div>`
          : `<p class="cpaEmpty">${esc(L('Bu grupta sapma yok.', 'No deviation in this group.'))}</p>`;
      box.innerHTML = `<div class="bomcCrumbs">${crumbs.join(' <span aria-hidden="true">›</span> ')}</div>${kpis}${notice}${table}
        <p class="bomcHint">${esc(L(
          'Ortak: grubun çoğunluğunun kullandığı koddan farklı veya eksik olan modeller sapma olarak işaretlenir. Model bazlı: karşılaştırılmaz. Otomatik: baskın kod grubun %60\'ında varsa olası sapma gösterilir. İşaretler kategori yoluna bağlıdır ve hatırlanır.',
          'Common: styles missing the code used by most of the group, or using a different code, are flagged. Model-specific: not compared. Auto: possible deviations are shown when one code covers 60% of the group. Marks are tied to the category path and remembered.'))}</p>`;
    }
    function renderAll() {
      const count = view.models.length;
      $('[data-bomc-sub]').textContent = L(
        `${count} model · ${rows.length} satır · ${options.scope === 'selected' ? 'seçili satırlar' : 'görünen satırlar'} · kaynak: son PLM SYNC BOM`,
        `${count} styles · ${rows.length} rows · ${options.scope === 'selected' ? 'selected rows' : 'visible rows'} · source: last PLM SYNC BOM`);
      renderToolbar();
      if (!view.bom && !view.error) return;
      renderTree();
      renderDetail();
    }
    function update(mutator, { keepNode = true, marksOnly = false } = {}) {
      mutator();
      savePrefs(prefs);
      if (!keepNode) view.nodeId = '';
      if (marksOnly) reevaluate(); else rebuild();
      renderAll();
    }

    overlay.addEventListener('change', event => {
      const target = event.target;
      if (target.matches('[data-level-add]') && target.value) update(() => { prefs.levels.push(target.value); }, { keepNode: false });
      else if (target.matches('[data-only-dev]')) { prefs.onlyDeviations = target.checked; savePrefs(prefs); renderDetail(); }
    });
    overlay.addEventListener('click', event => {
      const el = event.target.closest('button');
      if (!el || !overlay.contains(el)) return;
      if (el.dataset.levelRemove != null) update(() => { prefs.levels.splice(Number(el.dataset.levelRemove), 1); }, { keepNode: false });
      else if (el.dataset.levelUp != null) {
        const i = Number(el.dataset.levelUp);
        if (i > 0) update(() => { [prefs.levels[i - 1], prefs.levels[i]] = [prefs.levels[i], prefs.levels[i - 1]]; }, { keepNode: false });
      } else if (el.dataset.slotLevel) update(() => { prefs.slotLevel = el.dataset.slotLevel; });
      else if (el.dataset.node != null) { view.nodeId = el.dataset.node; renderTree(); renderDetail(); }
      else if (el.dataset.mark != null) {
        const key = el.dataset.mark, value = el.dataset.markValue;
        update(() => { if (value) prefs.marks[key] = value; else delete prefs.marks[key]; }, { marksOnly: true });
      } else if (el.dataset.expand != null) {
        const key = el.dataset.expand;
        if (view.expanded.has(key)) view.expanded.delete(key); else view.expanded.add(key);
        renderDetail();
      } else if (el.dataset.openBom != null) {
        window.BLPlmBom?.openForPlm?.(el.dataset.openBom, labelOf(el.dataset.openBom), { moduleId: 'cp' });
      }
    });

    rebuild();
    renderAll();
    const ids = view.models.map(model => model.plmId);
    if (!ids.length) {
      view.bom = new Map();
      view.error = L('Kapsamdaki satırlarda PLM ID yok.', 'Rows in scope have no PLM ID.');
      renderAll();
      return { close };
    }
    fetchEntries(ids).then(bom => {
      if (!overlay.isConnected) return;
      view.bom = bom;
      rebuild();
      renderAll();
    }).catch(error => {
      if (!overlay.isConnected) return;
      view.bom = new Map();
      view.error = L('BOM verisi okunamadı: ', 'BOM data could not be read: ') + String(error && error.message || error);
      rebuild();
      renderAll();
    });
    return { close };
  }

  window.BLBomControl = { open, PREF_KEY };
})();
