/* Buyer Log — Koleksiyon Artwork Detayı sütunu
 *
 * PLM BOM'un kalıcı source-of-truth'u server/data/plm-bom.json'dır.
 * Sütunun kendisi KOL_COLS içinde sıradan bir Koleksiyon sütunudur
 * (k:'artworkDetail', Model Detayları, Kumaş'ın solunda): filtre, sıralama,
 * sürükleyerek taşıma, gizleme, manuel düzenleme ve LCW AI bağlamı diğer
 * sütunlarla aynı yoldan çalışır. Bu dosya yalnız PLM değerini satırlara
 * projekte eder; DOM'a ayrı hücre/başlık enjekte etmez.
 *
 * Sahiplik kuralı: satırdaki değer son PLM özetine eşitse (veya boşsa) PLM'e
 * aittir ve PLM SYNC güncellediğinde yenilenir. Kullanıcı hücreyi farklı bir
 * değerle düzenlerse değer manueldir ve korunur; hücreyi temizlemek PLM
 * değerine geri döndürür. Projeksiyon saveKolRows çağırmaz; ikinci bir kalıcı
 * kaynak oluşturmaz.
 */
(function (global) {
  'use strict';
  if (global.BLCollectionArtworkDetail) return;

  const ART_KEY = 'artworkDetail';
  const PLM_KEY = 'artworkDetailPlm';
  const FRESH_MS = 20000;
  const BATCH = 500;
  const state = { cache: new Map(), meta: new Map(), fetchedAt: 0, inflight: null, timer: 0, patchedRender: false, bound: false, rendering: false };

  const isEn = () => String(document.documentElement.lang || '').toLowerCase().startsWith('en')
    || (typeof global.appLang !== 'undefined' && global.appLang === 'en');
  const L = (tr, en) => (isEn() ? en : tr);
  function numericId(value) {
    let text = String(value == null ? '' : value).trim().replace(/^_+/, '');
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }
  function bridge() { return global.BLCollectionSpreadsheetBridge || null; }
  function allRows() {
    try {
      const rows = bridge() && typeof bridge().rows === 'function' ? bridge().rows() : [];
      return Array.isArray(rows) ? rows : [];
    } catch (_) { return []; }
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
    return numericId(row.plmId || row['PLM ID'] || row._plmId); // i18n-ignore — kaynak başlığı
  }
  function summaryFor(entry) {
    if (!entry) return '';
    /* Set Style özeti child A/B/C ayrımını server tarafındaki kanonik
       artworkSummary'dan alır. Placement'ları burada yeniden gruplayıp
       A ve B'yi tek modelmiş gibi birleştirmek parça bilgisini kaybettirir. */
    if (entry.isSetStyle && String(entry.artworkSummary || '').trim()) return String(entry.artworkSummary).trim();
    if (!entry.hasPrint) return L('Baskı yok', 'No print');
    /* All Over baskı kumaş detayında yazdığı için burada sayılmaz. Bölgeler
       aynı tekniği paylaşıyorsa "Front: 1 • Back: 1 | Pigment | Total: 2";
       farklıysa her bölge kendi tekniğiyle: "Front: 1 | Pigment • Back: 1 |
       Transfer | Total: 2" (server summaryForPlacements ile aynı kural). */
    const groups = new Map(), techniques = new Set();
    let total = 0;
    for (const item of Array.isArray(entry.placements) ? entry.placements : []) {
      if (!item || item.placement === 'all_over') continue;
      const label = isEn() ? (item.placementEn || item.placement) : (item.placementTr || item.placement);
      if (!label) continue;
      const count = Math.max(1, Number(item.count) || 1);
      const technique = String(item.printType || '').trim();
      const group = groups.get(label) || { count: 0, techniques: new Set() };
      group.count += count;
      if (technique) { group.techniques.add(technique); techniques.add(technique); }
      groups.set(label, group);
      total += count;
    }
    if (!total) return L('Baskı yok', 'No print');
    const techOf = group => [...group.techniques].join(' + ');
    const uniform = new Set([...groups.values()].map(techOf)).size <= 1;
    const totalText = `${L('Toplam', 'Total')}: ${total}`;
    if (!uniform) {
      return `${[...groups].map(([label, group]) => `${label}: ${group.count}${techOf(group) ? ` | ${techOf(group)}` : ''}`).join(' • ')} | ${totalText}`;
    }
    const parts = [...groups].map(([label, group]) => `${label}: ${group.count}`);
    const tech = [...techniques].join(' + ');
    return `${parts.join(' • ')}${tech ? ` | ${tech}` : ''} | ${totalText}`;
  }
  function aiStatus(entry) {
    const status = entry && entry.ai && entry.ai.status || 'not-needed';
    if (status === 'resolved') return L('LCW AI doğruladı', 'LCW AI verified');
    if (status === 'partial') return L('LCW AI kısmen çözümledi', 'LCW AI partially resolved');
    if (status === 'failed') return L('LCW AI kullanılamadı', 'LCW AI unavailable');
    if (status === 'deferred') return L('LCW AI analizi ertelendi', 'LCW AI analysis deferred');
    return L('Kural ile net', 'Resolved by rule');
  }

  /* PLM özetini satıra yazar. Manuel değer (son PLM özetinden farklı ve dolu)
     korunur. Henüz izlenmeyen eski satırlar (PLM_KEY yok) önceki sürümün
     salt-okunur projeksiyonundan geldiği için PLM'e ait sayılır. */
  function applyToRow(row, summary) {
    if (!row) return false;
    const current = row[ART_KEY] == null ? '' : String(row[ART_KEY]);
    const tracked = Object.prototype.hasOwnProperty.call(row, PLM_KEY);
    const plmOwned = !current.trim() || !tracked || current === String(row[PLM_KEY] == null ? '' : row[PLM_KEY]);
    let changed = false;
    if (plmOwned && current !== summary) { row[ART_KEY] = summary; changed = true; }
    if (!tracked || row[PLM_KEY] !== summary) row[PLM_KEY] = summary;
    return changed;
  }
  /* Önbellekteki BOM özetlerini TÜM Koleksiyon satırlarına uygular (yalnız
     görünenlere değil): filtre, sıralama ve LCW AI tüm veriyi görür. Henüz
     okunmamış PLM ID'lere dokunulmaz; okunamayan bir istek değeri silmez. */
  function project() {
    let changed = 0;
    for (const row of allRows()) {
      const plmId = plmIdOfRow(row);
      if (plmId && !state.cache.has(plmId)) continue;
      const entry = plmId ? state.cache.get(plmId) : null;
      if (applyToRow(row, summaryFor(entry))) changed++;
    }
    return changed;
  }
  function missingIds() {
    const ids = new Set();
    for (const row of allRows()) {
      const plmId = plmIdOfRow(row);
      if (plmId && !state.cache.has(plmId)) ids.add(plmId);
    }
    return ids;
  }
  async function fetchEntries(ids) {
    const list = [...ids];
    const out = {};
    for (let i = 0; i < list.length; i += BATCH) {
      const response = await fetch('/api/plm-sync/bom/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ plmIds: list.slice(i, i + BATCH) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || response.statusText);
      Object.assign(out, payload.entries || {});
    }
    return out;
  }
  /* BOM özetlerini yerel depodan tazeler (uzak PLM/AI çağrısı yapmaz).
     Değer değiştiyse Koleksiyon yeniden çizilir. */
  function ensureFresh(options = {}) {
    /* Zorla tazeleme (PLM SYNC sonrası) devam eden eski okumayı yeniden
       kullanmaz; o istek sunucu BOM'u yazmadan önce başlamış olabilir. */
    if (state.inflight) return options.force ? state.inflight.then(() => ensureFresh(options)) : state.inflight;
    const stale = Date.now() - state.fetchedAt > FRESH_MS || options.force;
    const ids = stale ? new Set(allRows().map(plmIdOfRow).filter(Boolean)) : missingIds();
    if (!ids.size) return Promise.resolve(project());
    state.inflight = (async () => {
      try {
        const entries = await fetchEntries(ids);
        for (const id of ids) {
          state.cache.set(id, entries[id] || null);
          state.meta.set(id, entries[id] || null);
        }
        if (stale) state.fetchedAt = Date.now();
      } catch (_) {
        return 0;
      } finally {
        state.inflight = null;
      }
      const changed = project();
      if (changed && !options.silent && typeof global.renderKol === 'function' && document.getElementById('kolTable')) {
        try { global.renderKol(); } catch (_) {}
      }
      return changed;
    })();
    return state.inflight;
  }

  function injectStyle() {
    if (document.getElementById('blCollectionArtworkStyle')) return;
    const style = document.createElement('style');
    style.id = 'blCollectionArtworkStyle';
    style.textContent = `
      #kolTable td[data-key="${ART_KEY}"].kolArtworkNeedsReview .editCell{color:var(--orange);font-weight:650}
      #kolTable td[data-key="${ART_KEY}"] .editCell{white-space:pre-line}
    `;
    document.head.appendChild(style);
  }
  /* Hücreye yalnız bilgi (ipucu + kontrol gerekli vurgusu) ekler; değer ve
     düzenleyici app-main'in ortak metin hücresinden gelir. */
  function decorate() {
    injectStyle();
    const table = document.getElementById('kolTable');
    if (!table || !table.tBodies[0]) return;
    const byId = new Map(allRows().map(row => [String(row && row.id), row]));
    for (const td of table.tBodies[0].querySelectorAll(`td[data-key="${ART_KEY}"]`)) {
      const tr = td.closest('tr');
      const row = byId.get(String(tr && (tr.dataset.id || tr.dataset.kolid || tr.getAttribute('data-kolid')) || ''))
        || byId.get(String(td.querySelector('[data-id]') && td.querySelector('[data-id]').dataset.id || ''));
      if (!row) continue;
      const entry = state.meta.get(plmIdOfRow(row)) || null;
      const plmValue = String(row[PLM_KEY] == null ? '' : row[PLM_KEY]);
      const current = String(row[ART_KEY] == null ? '' : row[ART_KEY]);
      const manual = Boolean(current.trim()) && current !== plmValue;
      td.classList.toggle('kolArtworkNeedsReview', Boolean(entry && entry.needsAi && !manual));
      const lines = [];
      if (manual) {
        lines.push(L('Manuel değer · temizlerseniz PLM değeri geri gelir', 'Manual value · clear it to restore the PLM value'));
        if (plmValue) lines.push(`PLM: ${plmValue}`);
      } else if (entry) {
        if (entry.needsAi) lines.push(L('⚠ Kontrol gerekli', '⚠ Review required'));
        lines.push(`CoreNectum BOM · ${aiStatus(entry)}`);
        if (entry.fetchedAt) lines.push(new Date(entry.fetchedAt).toLocaleString(isEn() ? 'en-GB' : 'tr-TR'));
      } else {
        lines.push(L('Bu model için BOM kaydı yok. PLM SYNC çalıştırıldığında otomatik oluşur.', 'No BOM record exists for this style. It is created automatically by PLM SYNC.'));
      }
      lines.push(L('Sağ tık › BOM Detayını Aç', 'Right-click › Open BOM Detail'));
      td.title = [current, ...lines].filter(Boolean).join('\n');
    }
  }

  async function openBom(row) {
    if (!row) return false;
    try {
      if (!global.BLPlmBom && global.BLPerf && typeof global.BLPerf._loadScript === 'function') {
        await global.BLPerf._loadScript('plm-bom.js');
      }
      if (global.BLPlmBom && global.BLPlmBom.openForRow) { global.BLPlmBom.openForRow(row, 'collection'); return true; }
    } catch (_) {}
    return false;
  }
  function extendBridge() {
    const b = bridge();
    if (b && !b.openArtworkBom) b.openArtworkBom = openBom;
  }

  function wrapRender() {
    if (state.patchedRender || typeof global.renderKol !== 'function') return;
    const base = global.renderKol;
    const wrapped = function (...args) {
      // Önbellekteki PLM özetleri render'dan ÖNCE satıra yazılır; böylece
      // filtre/sıralama/hücre aynı çizimde doğru değeri görür.
      project();
      const result = base.apply(this, args);
      extendBridge();
      decorate();
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { void ensureFresh(); }, 40);
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
    extendBridge();
    // PLM işlemi başlarken önbellek bayatlatılır; sonraki render'lar (ve
    // FRESH_MS süresi) PLM SYNC'in yazdığı yeni BOM özetlerini okur.
    global.addEventListener('bl:plm-operation-started', () => { state.fetchedAt = 0; });
    // Özet metni dile bağlıdır (Toplam/Total); dil değişince önbellekten yeniden yazılır.
    document.addEventListener('bl:language-changed', () => { project(); });
  }

  global.BLCollectionArtworkDetail = {
    key: ART_KEY,
    plmKey: PLM_KEY,
    ensureFresh,
    project,
    applyToRow,
    refresh: () => ensureFresh({ force: true }),
    openBom,
    summaryFor,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
