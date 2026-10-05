/* Buyer Log — Koleksiyon Artwork Detayı sütunu
 *
 * PLM BOM'un kalıcı source-of-truth'u server/data/plm-bom.json'dır.
 * Koleksiyon satırına ikinci bir kalıcı kopya yazılmaz; bu dosya görünür
 * Collection satırlarını sidecar depodan projekte eder. Böylece PLM Sync
 * güncellediğinde tek gerçek kaynak korunur ve kullanıcı alanları kirlenmez.
 *
 * Sütun: Model Detayları içinde, Kumaş'ın hemen solunda, salt okunur.
 */
(function (global) {
  'use strict';
  if (global.BLCollectionArtworkDetail) return;

  const ART_KEY = 'artworkDetail';
  const FABRIC_KEY = 'fabric';
  const state = { requestSeq: 0, timer: 0, patchedRender: false, bound: false };

  const isEn = () => String(document.documentElement.lang || '').toLowerCase().startsWith('en')
    || (typeof global.appLang !== 'undefined' && global.appLang === 'en');
  const L = (tr, en) => (isEn() ? en : tr);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  function numericId(value) {
    let text = String(value == null ? '' : value).trim().replace(/^_+/, '');
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }
  function rowId(tr) {
    return String(tr && (tr.dataset.id || tr.dataset.kolid || tr.getAttribute('data-kolid')) || '');
  }
  function rowForTr(tr) {
    const id = rowId(tr);
    if (!id) return null;
    try {
      if (typeof global.BLGetContextRow === 'function') return global.BLGetContextRow('collection', id);
    } catch (_) {}
    try {
      const rows = global.BLCollection && typeof global.BLCollection.rows === 'function' ? global.BLCollection.rows() : [];
      return Array.isArray(rows) ? rows.find(row => String(row && row.id) === id) || null : null;
    } catch (_) { return null; }
  }
  function plmIdOfRow(row) {
    if (!row) return '';
    try {
      const canonical = global.BLCanonicalFields;
      const value = canonical && canonical.normalizedValue
        ? canonical.normalizedValue(row, 'collection', 'plmId') : '';
      const id = numericId(value);
      if (id) return id;
    } catch (_) {}
    return numericId(row.plmId || row['PLM ID'] || row._plmId);
  }
  function summaryFor(entry) {
    if (!entry) return '';
    /* Set Style özeti child A/B/C ayrımını server tarafındaki kanonik
       artworkSummary'dan alır. Placement'ları burada yeniden gruplayıp
       A ve B'yi tek modelmiş gibi birleştirmek parça bilgisini kaybettirir. */
    if (entry.isSetStyle && String(entry.artworkSummary || '').trim()) return String(entry.artworkSummary).trim();
    if (!entry.hasPrint) return L('Baskı yok', 'No print');
    const groups = new Map(), techniques = new Set();
    for (const item of Array.isArray(entry.placements) ? entry.placements : []) {
      const label = isEn() ? (item.placementEn || item.placement) : (item.placementTr || item.placement);
      const count = Math.max(1, Number(item.count) || 1);
      if (label) groups.set(label, (groups.get(label) || 0) + count);
      const technique = String(item.printType || '').trim();
      if (technique) techniques.add(technique);
    }
    const parts = [...groups].map(([label, count]) => `${label}: ${count}`);
    const total = Number(entry.totalPrintCount) || [...groups.values()].reduce((a, b) => a + b, 0);
    const tech = [...techniques].join(' + ') || String(entry.techniqueSummary || '').trim();
    return `${parts.join(' • ')}${tech ? ` | ${tech}` : ''} | ${L('Toplam', 'Total')}: ${total}`;
  }
  function aiStatus(entry) {
    const status = entry && entry.ai && entry.ai.status || 'not-needed';
    if (status === 'resolved') return L('LCW AI doğruladı', 'LCW AI verified');
    if (status === 'partial') return L('LCW AI kısmen çözümledi', 'LCW AI partially resolved');
    if (status === 'failed') return L('LCW AI kullanılamadı', 'LCW AI unavailable');
    if (status === 'deferred') return L('LCW AI analizi ertelendi', 'LCW AI analysis deferred');
    return L('Kural ile net', 'Resolved by rule');
  }

  function injectStyle() {
    if (document.getElementById('blCollectionArtworkStyle')) return;
    const style = document.createElement('style');
    style.id = 'blCollectionArtworkStyle';
    style.textContent = `
      #kolTable th[data-k="${ART_KEY}"]{min-width:210px;max-width:310px}
      #kolTable td[data-key="${ART_KEY}"]{min-width:210px;max-width:310px;white-space:normal;overflow:hidden}
      #kolTable td[data-key="${ART_KEY}"].kolArtworkNeedsReview{color:var(--orange);font-weight:650}
      #kolTable td[data-key="${ART_KEY}"] .kolArtworkText{display:block;overflow:hidden;white-space:pre-line;line-height:1.25}
      #kolTable td[data-key="${ART_KEY}"]{cursor:default}
    `;
    document.head.appendChild(style);
  }

  function wrapSpreadsheetBridge() {
    const bridge = global.BLCollectionSpreadsheetBridge;
    if (!bridge || bridge.__artworkDetailWrapped) return;
    bridge.__artworkDetailWrapped = true;
    const baseMeta = typeof bridge.columnMeta === 'function' ? bridge.columnMeta.bind(bridge) : null;
    const baseRaw = typeof bridge.rawValue === 'function' ? bridge.rawValue.bind(bridge) : null;
    bridge.columnMeta = key => {
      if (String(key) === ART_KEY) return {
        key: ART_KEY,
        label: L('Artwork Detayı', 'Artwork Detail'),
        editable: false,
        formula: 'CoreNectum BOM',
        col: { k: ART_KEY, noFilter: true, readonly: true, group: 'Model Detayları' },
      };
      return baseMeta ? baseMeta(key) : null;
    };
    bridge.rawValue = (row, key) => {
      if (String(key) === ART_KEY) return row && row[ART_KEY] || '';
      return baseRaw ? baseRaw(row, key) : row && row[key];
    };
  }

  function headerKey(th) {
    return String(th && (th.dataset.k || th.dataset.kcol) || '');
  }
  function insertionIndex(colRow) {
    const cells = [...colRow.cells];
    let index = cells.findIndex(th => headerKey(th) === FABRIC_KEY);
    if (index >= 0) return index;
    for (const fallback of ['assortment', 'fit', 'quantity']) {
      index = cells.findIndex(th => headerKey(th) === fallback);
      if (index >= 0) return index;
    }
    return -1;
  }
  function patchGroupRow(table, at) {
    const row = table.tHead && table.tHead.querySelector('tr.kolGroupRow');
    if (!row) return;
    let containing = null;
    for (const th of row.cells) {
      const start = Number(th.dataset.start), end = Number(th.dataset.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start <= at && end >= at) containing = th;
    }
    for (const th of row.cells) {
      const start = Number(th.dataset.start), end = Number(th.dataset.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (th === containing) {
        th.dataset.end = String(end + 1);
        const span = Math.max(1, Number(th.colSpan) || (end - start + 1));
        th.colSpan = span + 1;
      } else if (start >= at) {
        th.dataset.start = String(start + 1);
        th.dataset.end = String(end + 1);
      }
    }
  }
  function makeHeader(fabric) {
    const th = document.createElement('th');
    th.dataset.k = ART_KEY;
    th.dataset.kcol = ART_KEY;
    th.className = String(fabric && fabric.className || '').replace(/\b(sortAsc|sortDesc|filtered)\b/g, '').trim();
    th.title = L('PLM BOM baskı yerleşimi özeti · salt okunur', 'PLM BOM print-placement summary · read-only');
    th.innerHTML = `<span class="thLabel">${esc(L('Artwork Detayı', 'Artwork Detail'))}</span>`;
    return th;
  }
  function makeCell() {
    const td = document.createElement('td');
    td.dataset.key = ART_KEY;
    td.className = 'kolArtworkDetailCell kolSpreadsheetReadonly';
    td.setAttribute('aria-readonly', 'true');
    td.innerHTML = '<span class="kolArtworkText">…</span>';
    return td;
  }

  function ensureStructure() {
    injectStyle();
    wrapSpreadsheetBridge();
    const table = document.getElementById('kolTable');
    const colRow = table && table.tHead && table.tHead.querySelector('tr.colRow');
    if (!table || !colRow) return false;

    let artHead = colRow.querySelector(`th[data-k="${ART_KEY}"],th[data-kcol="${ART_KEY}"]`);
    let changed = false;
    if (!artHead) {
      const at = insertionIndex(colRow);
      if (at < 0) return false;
      const fabric = colRow.cells[at];
      artHead = makeHeader(fabric);
      colRow.insertBefore(artHead, fabric);

      const group = table.querySelector('colgroup');
      if (group) {
        const col = document.createElement('col');
        col.dataset.k = ART_KEY;
        col.style.width = '240px';
        group.insertBefore(col, group.children[at] || null);
      }
      patchGroupRow(table, at);
      changed = true;
    }

    const index = [...colRow.cells].indexOf(artHead);
    if (index < 0) return changed;
    for (const tr of table.tBodies[0] ? [...table.tBodies[0].rows] : []) {
      if (!rowId(tr) || tr.querySelector(`td[data-key="${ART_KEY}"]`)) continue;
      tr.insertBefore(makeCell(), tr.cells[index] || null);
      changed = true;
    }

    if (changed && global.BLCollectionSpreadsheet && typeof global.BLCollectionSpreadsheet.afterRender === 'function') {
      try { global.BLCollectionSpreadsheet.afterRender(); } catch (_) {}
    }
    return changed;
  }

  function visibleTargets() {
    const table = document.getElementById('kolTable');
    if (!table || !table.tBodies[0]) return [];
    const seen = new Set(), out = [];
    for (const tr of table.tBodies[0].rows) {
      const row = rowForTr(tr), plmId = plmIdOfRow(row);
      if (!row || !plmId || seen.has(plmId)) continue;
      seen.add(plmId);
      out.push({ plmId, row });
    }
    return out;
  }
  function paint(entries) {
    const table = document.getElementById('kolTable');
    if (!table || !table.tBodies[0]) return;
    for (const tr of table.tBodies[0].rows) {
      const cell = tr.querySelector(`td[data-key="${ART_KEY}"]`);
      if (!cell) continue;
      const row = rowForTr(tr), plmId = plmIdOfRow(row);
      const entry = plmId && entries ? entries[plmId] : null;
      const summary = summaryFor(entry);
      if (row) {
        row[ART_KEY] = summary;
        row._artworkDetailMeta = entry || null;
      }
      cell.classList.toggle('kolArtworkNeedsReview', Boolean(entry && entry.needsAi));
      const display = entry && entry.needsAi ? `⚠ ${summary || L('Kontrol gerekli', 'Review required')}` : (summary || '—');
      cell.innerHTML = `<span class="kolArtworkText">${esc(display)}</span>`;
      cell.title = entry
        ? [summary, `CoreNectum BOM · ${aiStatus(entry)}`, entry.fetchedAt ? new Date(entry.fetchedAt).toLocaleString(isEn() ? 'en-GB' : 'tr-TR') : ''].filter(Boolean).join('\n')
        : L('Bu model için BOM kaydı yok. PLM SYNC çalıştırıldığında otomatik oluşur.', 'No BOM record exists for this style. It is created automatically by PLM SYNC.');
    }
  }
  async function loadVisible() {
    const targets = visibleTargets();
    if (!targets.length) { paint({}); return; }
    const seq = ++state.requestSeq;
    try {
      const response = await fetch('/api/plm-sync/bom/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ plmIds: targets.map(item => item.plmId) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (seq !== state.requestSeq) return;
      if (!response.ok || !payload.ok) throw new Error(payload.error || response.statusText);
      paint(payload.entries || {});
    } catch (_) {
      if (seq !== state.requestSeq) return;
      paint({});
    }
  }

  function patchAndLoad() {
    ensureStructure();
    void loadVisible();
  }
  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(patchAndLoad, 40);
  }
  function wrapRender() {
    if (state.patchedRender || typeof global.renderKol !== 'function') return;
    const base = global.renderKol;
    const wrapped = function (...args) {
      const result = base.apply(this, args);
      queueMicrotask(schedule);
      return result;
    };
    wrapped.__artworkDetailWrapped = true;
    global.renderKol = wrapped;
    state.patchedRender = true;
  }
  function bind() {
    if (state.bound) return;
    state.bound = true;
    wrapRender();
    const table = document.getElementById('kolTable');
    if (table) {
      const observer = new MutationObserver(() => {
        const colRow = table.tHead && table.tHead.querySelector('tr.colRow');
        if (!colRow) return;
        const missingHead = !colRow.querySelector(`th[data-k="${ART_KEY}"],th[data-kcol="${ART_KEY}"]`);
        const missingCells = table.tBodies[0] && [...table.tBodies[0].rows].some(tr => rowId(tr) && !tr.querySelector(`td[data-key="${ART_KEY}"]`));
        if (missingHead || missingCells) schedule();
      });
      observer.observe(table, { childList: true, subtree: true });
      table.addEventListener('dblclick', async event => {
        const td = event.target.closest && event.target.closest(`td[data-key="${ART_KEY}"]`);
        if (!td) return;
        const row = rowForTr(td.closest('tr'));
        if (!row) return;
        try {
          if (!global.BLPlmBom && global.BLPerf && typeof global.BLPerf._loadScript === 'function') {
            await global.BLPerf._loadScript('plm-bom.js');
          }
          global.BLPlmBom && global.BLPlmBom.openForRow && global.BLPlmBom.openForRow(row, 'collection');
        } catch (_) {}
      });
    }
    document.addEventListener('bl:language-changed', schedule);
    schedule();
  }

  global.BLCollectionArtworkDetail = {
    key: ART_KEY,
    ensureStructure,
    loadVisible,
    refresh: patchAndLoad,
    summaryFor,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
