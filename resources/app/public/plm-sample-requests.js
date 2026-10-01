/* Buyer Log — PLM NUMUNE TALEPLERİ (istemci)
 *
 * CoreNectum style-overview → Requests sekmesindeki numune talepleri
 * (Artwork / Fit Sample / Perfect Sign Off …) PLM Sync ile sunucuya alınır
 * (/api/plm-requests/sync) ve burada iki yerde kullanılır:
 *
 *   1) CP KONTROL LİSTESİ — PPS / S-Off / Kritik numune / Artwork soruları
 *      PLM'de onaylı talep varsa kendiliğinden kapanır (cp-checklist-engine
 *      ctx.plmEvidence). Kanıt yoksa soru eskisi gibi sorulur.
 *   2) MODEL NUMUNE PENCERESİ — model adına sağ tık → "PLM numune talepleri":
 *      PLM'deki tablonun aynısı + kilometre taşı özeti.
 *
 * Sınıflandırma kuralları plm-sample-requests-engine.js'tedir (sunucu ile
 * ortak); bu dosya yalnız veri taşır ve çizer.
 */
(function () {
  'use strict';
  const Engine = window.BLPlmSampleRequestsEngine;
  if (!Engine || window.BLPlmSampleRequests) return;

  const STYLE_OVERVIEW_URL = 'https://corenectum.lcwaikiki.com/models-options/style-overview';
  const state = { models: {}, updatedAt: null, revision: 0, loaded: false, loading: null, milestoneCache: new Map() };

  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const toast = (message, options) => { if (typeof showToast === 'function') showToast(message, { icon: false, duration: 9000, ...(options || {}) }); };
  const errorText = err => (typeof plmSyncErrorMessage === 'function' ? plmSyncErrorMessage(err) : String(err && err.message || err || ''));

  function dateText(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date) ? '—' : date.toLocaleDateString(isEn() ? 'en-GB' : 'tr-TR');
  }

  /* --------------------------------------------------------------- veri */
  function applyPayload(payload) {
    state.models = payload && payload.models && typeof payload.models === 'object' ? payload.models : {};
    state.updatedAt = (payload && payload.updatedAt) || null;
    state.revision = Number(payload && payload.revision) || 0;
    state.loaded = true;
    state.milestoneCache.clear();
  }

  function load(force) {
    if (state.loaded && !force) return Promise.resolve(state);
    if (state.loading) return state.loading;
    state.loading = fetch('/api/plm-requests', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(payload => { if (payload) applyPayload(payload); return state; })
      .catch(() => state)
      .finally(() => { state.loading = null; });
    return state.loading;
  }

  function plmIdOfRow(row, moduleId) {
    if (!row) return '';
    const canonical = window.BLCanonicalFields;
    let value = '';
    try { value = canonical && canonical.normalizedValue ? canonical.normalizedValue(row, moduleId || 'cp', 'plmId') : ''; } catch (_) { value = ''; }
    return Engine.numericId(value || row['PLM ID'] || row.plmId || row._plmId);
  }

  function entryFor(plmId) { return state.models[Engine.numericId(plmId)] || null; }

  function milestonesFor(plmId) {
    const id = Engine.numericId(plmId);
    if (!id) return null;
    if (state.milestoneCache.has(id)) return state.milestoneCache.get(id);
    const entry = state.models[id];
    const value = entry ? Engine.summarizeMilestones(entry.requests) : null;
    state.milestoneCache.set(id, value);
    return value;
  }

  /* Siparişin operasyon aşaması (CP satırı STATUS). Kanonik aşama kuralı
     business-rules.js'tedir; burada ikinci bir eşleme yazılmaz. */
  function rowStage(row) {
    const rules = window.BLBusinessRules;
    try { return rules && rules.operationalStageOf ? rules.operationalStageOf(row && row.STATUS) : 'UNKNOWN'; }
    catch (_) { return 'UNKNOWN'; }
  }

  /* Sipariş bazında kilometre taşları: PLM özeti + aşama kuralı (üretimi
     bitmiş siparişte numuneler onaylı kabul edilir). */
  function orderMilestones(plmId, stage) {
    return Engine.applyOrderStage(plmId ? milestonesFor(plmId) : null, stage);
  }

  /* CP kontrol listesi kanıt sağlayıcısı (cp-checklist-engine ctx.plmEvidence). */
  function evidenceForAnalysis(analysis, itemId) {
    const row = analysis && analysis.sourceRow;
    const plmId = plmIdOfRow(row, 'cp');
    const stage = (analysis && analysis.stage) || rowStage(row);
    return Engine.evidenceFor(orderMilestones(plmId, stage), itemId);
  }

  /* CP / Siparişler "PLM Numune" sütunu. Kalem sırası sabit; PLM'de talebi
     olmayan kalem yazılmaz (yok ≠ eksik). Hiç senkron yapılmamış model boş,
     senkronu yapılmış ama talebi olmayan model "Talep yok" gösterir. */
  const COLUMN_SHORT = {
    pps: { tr: 'PPS', en: 'PPS' },
    soff: { tr: 'S/Off', en: 'S/Off' },
    criticalSample: { tr: 'FIT/SIZE', en: 'Fit/Size' }, // TR büyük harf dönüşümü 'i'yi 'İ' yapmasın
    artwork: { tr: 'Artwork', en: 'Artwork' },
  };
  const STATE_SHORT = {
    tr: { approved: 'Onaylı', open: 'Açık', rejected: 'Red' },
    en: { approved: 'Approved', open: 'Open', rejected: 'Rejected' },
  };
  function inferenceText(item) {
    if (!item || !item.inferredFrom) return '';
    if (item.inferredFrom === 'stage') return L('Üretim sonrası sipariş: onaysız yükleme yapılmaz, onaylı kabul edildi', 'Post-production order: shipments require approval, treated as approved');
    const from = COLUMN_SHORT[item.inferredFrom] ? COLUMN_SHORT[item.inferredFrom][isEn() ? 'en' : 'tr'] : item.inferredFrom;
    return L(`${from} onaylı olduğu için onaylı kabul edildi`, `Treated as approved because ${from} is approved`);
  }

  /* Üretim sonrası siparişte tek rozet: "Onaylı · Üretim sonrası". Dört
     ayrı yeşil rozet bilgi katmaz, yalnız sütunu kalabalıklaştırır. */
  function columnParts(row, moduleId) {
    const plmId = plmIdOfRow(row, moduleId);
    const entry = plmId ? entryFor(plmId) : null;
    const stage = rowStage(row);
    const lang = isEn() ? 'en' : 'tr';
    if (Engine.isPostProductionStage(stage)) {
      return { plmId, stageApproved: true, parts: [{
        key: 'stage', state: 'approved',
        text: L('Onaylı · Üretim sonrası', 'Approved · Post-production'),
        title: inferenceText({ inferredFrom: 'stage' }),
      }] };
    }
    if (!entry) return null;
    const milestones = orderMilestones(plmId, stage) || {};
    const parts = Engine.MILESTONES.filter(key => milestones[key]).map(key => {
      const item = milestones[key];
      const source = item.requestCode ? `${item.subTypeName} · ${item.statusName} · ${item.requestCode}` : '';
      return {
        key, state: item.state, inferred: Boolean(item.inferredFrom),
        text: `${COLUMN_SHORT[key][lang]}: ${STATE_SHORT[lang][item.state] || item.state}`,
        title: [inferenceText(item), source].filter(Boolean).join(' — '),
      };
    });
    return { plmId, parts };
  }
  function columnText(row, moduleId) {
    const value = columnParts(row, moduleId);
    if (!value) return '';
    return value.parts.length ? value.parts.map(part => part.text).join(' · ') : L('Talep yok', 'No request');
  }

  /* PLM'den çek. Yetki/bağlantı akışı Collection PLM Sync ile AYNIDIR. */
  async function sync(plmIds, options) {
    const ids = [...new Set((Array.isArray(plmIds) ? plmIds : []).map(Engine.numericId).filter(Boolean))];
    if (!ids.length) return { ok: false, reason: 'no-targets' };
    const opts = options || {};
    if (opts.ensureConnection !== false && typeof ensureCoreNectumApiConnection === 'function') {
      if (!await ensureCoreNectumApiConnection()) return { ok: false, reason: 'api-not-configured' };
    }
    /* silent: arka plan tazelemesi. PLM İşlemleri panelini açmaz ve yetki
       yenileme penceresi göstermez (plmJsonRequest bunları yapar). */
    const request = typeof plmJsonRequest === 'function' && !opts.silent ? plmJsonRequest : async (url, init) => {
      const res = await fetch(url, init); const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { code: data.code });
      return data;
    };
    const result = await request('/api/plm-requests/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plmIds: ids, scope: opts.scope === 'cp' ? 'cp' : 'koleksiyon' }),
    });
    await load(true);
    try { window.dispatchEvent(new CustomEvent('bl:plm-requests-changed', { detail: { revision: state.revision } })); } catch (_) { /* eski tarayıcı */ }
    return { ok: true, ...result };
  }

  /* ESKİYEN VERİ OTOMATİK TAZELEME (kullanıcı onaylı öneri). CP açılınca
     ÜRETİMDEKİ siparişlerin modelleri, numune verisi hiç yoksa ya da 24
     saatten eskiyse arka planda PLM'den çekilir. Üretim sonrası siparişler
     zaten onaylı sayıldığı için çekilmez. Sessizdir: oturum yoksa ya da
     hata olursa kullanıcıyı rahatsız etmez; aynı oturumda saatte en fazla
     bir kez denenir. */
  const AUTO_REFRESH_MAX_AGE_MS = 24 * 3600 * 1000;
  const AUTO_REFRESH_RETRY_MS = 3600 * 1000;
  const AUTO_REFRESH_KEY = 'lcw.cp.plmSamples.autoRefreshAt';
  let autoRefreshRunning = false;
  function storageGet(key) { try { return (window.BLStorage || localStorage).getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { (window.BLStorage || localStorage).setItem(key, value); } catch (_) { /* kota */ } }
  function staleProductionPlmIds(rows, now = Date.now()) {
    const ids = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (rowStage(row) !== 'PRODUCTION') continue;
      const plmId = plmIdOfRow(row, 'cp');
      if (!plmId || ids.has(plmId)) continue;
      const entry = entryFor(plmId);
      const fetched = entry && entry.fetchedAt ? Date.parse(entry.fetchedAt) : NaN;
      if (!Number.isFinite(fetched) || now - fetched > AUTO_REFRESH_MAX_AGE_MS) ids.add(plmId);
    }
    return [...ids];
  }
  async function autoRefreshStale(rows) {
    if (autoRefreshRunning) return { ok: false, reason: 'running' };
    const last = Number(storageGet(AUTO_REFRESH_KEY)) || 0;
    if (Date.now() - last < AUTO_REFRESH_RETRY_MS) return { ok: false, reason: 'throttled' };
    autoRefreshRunning = true;
    try {
      await load();
      const ids = staleProductionPlmIds(rows);
      if (!ids.length) return { ok: true, synced: 0 };
      storageSet(AUTO_REFRESH_KEY, String(Date.now()));
      const result = await sync(ids, { scope: 'cp', ensureConnection: false, silent: true });
      if (result.ok && result.synced) toast(L(`PLM numune durumu arka planda güncellendi: ${summaryText(result)}`, `PLM sample status refreshed in the background: ${summaryText(result)}`), { duration: 6000 });
      return result;
    } catch (_) {
      return { ok: false, reason: 'failed' };
    } finally {
      autoRefreshRunning = false;
    }
  }

  function summaryText(result) {
    if (!result || !result.ok) return '';
    const parts = [L(`${result.synced}/${result.checked} model`, `${result.synced}/${result.checked} styles`),
      L(`${result.requestCount} numune talebi`, `${result.requestCount} sample requests`)];
    if (result.notFound && result.notFound.length) parts.push(L(`${result.notFound.length} PLM'de bulunamadı`, `${result.notFound.length} not found in PLM`));
    if (result.failed && result.failed.length) parts.push(L(`${result.failed.length} hata`, `${result.failed.length} error(s)`));
    return parts.join(' · ');
  }

  /* Collection PLM Sync'in numune adımı. Görsel adımı gibi İKİNCİL bir
     adımdır: hatası alan güncellemesini geri aldırmaz, yalnız raporlanır. */
  async function syncStep(plmIds) {
    try { return await sync(plmIds, { ensureConnection: false }); }
    catch (err) { return { ok: false, error: err }; }
  }
  function syncStepSuffix(result) {
    if (!result) return '';
    if (result.error) return L(` · numune talepleri alınamadı: ${errorText(result.error)}`, ` · sample requests failed: ${errorText(result.error)}`);
    if (!result.ok) return '';
    return L(` · numune talepleri ${result.requestCount}`, ` · sample requests ${result.requestCount}`);
  }

  /* --------------------------------------------------------- görünüm */
  const MILESTONE_LABELS = {
    pps: { tr: 'PPS', en: 'PPS' },
    soff: { tr: 'S/Off', en: 'S/Off' },
    criticalSample: { tr: 'Kritik numune', en: 'Critical sample' },
    artwork: { tr: 'Artwork', en: 'Artwork' },
  };
  function statusBadge(status, text) {
    const tone = status === 'approved' ? 'ok' : status === 'rejected' ? 'bad' : status === 'cancelled' ? 'off' : 'wait';
    const label = text || Engine.STATUS_LABELS[isEn() ? 'en' : 'tr'][status] || status;
    return `<span class="cpaPlm tone-${tone}">${esc(label)}</span>`;
  }
  function evidenceBadge(evidence) {
    if (!evidence) return '';
    const label = Engine.STATUS_LABELS[isEn() ? 'en' : 'tr'][evidence.state] || evidence.state;
    return `<span class="cpaPlm tone-${evidence.state === 'approved' ? 'ok' : evidence.state === 'rejected' ? 'bad' : 'wait'}" title="${esc([inferenceText(evidence), evidence.requestCode ? `${evidence.subTypeName} · ${evidence.statusName} · ${evidence.requestCode}` : ''].filter(Boolean).join(' — '))}">${evidence.inferredFrom === 'stage' ? esc(L('Üretim sonrası', 'Post-production')) : 'PLM'} · ${esc(label)}</span>`;
  }

  function openForPlm(plmId, title) {
    const id = Engine.numericId(plmId);
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    const close = () => modal.remove();
    const draw = () => {
      const entry = entryFor(id);
      const milestones = milestonesFor(id) || {};
      const requests = (entry && Array.isArray(entry.requests) ? entry.requests.slice() : [])
        .sort((a, b) => String(b.createdDate || '').localeCompare(String(a.createdDate || '')));
      const chips = Engine.MILESTONES.map(key => {
        const item = milestones[key];
        const label = MILESTONE_LABELS[key][isEn() ? 'en' : 'tr'];
        return `<div class="cpaChip is-static"${item && item.inferredFrom ? ` title="${esc(inferenceText(item))}"` : ''}><span class="l">${esc(label)}</span>${item ? statusBadge(item.state) : `<span class="q">${esc(L('PLM\'de talep yok', 'No request in PLM'))}</span>`}${item && item.inferredFrom ? `<span class="q">${esc(inferenceText(item))}</span>` : ''}</div>`;
      }).join('');
      const styleLink = entry && entry.styleId ? `${STYLE_OVERVIEW_URL}?styleId=${encodeURIComponent(entry.styleId)}&m=2` : '';
      const rows = requests.map(item => `<tr>
          <td>${styleLink ? `<a href="${esc(styleLink)}" target="_blank" rel="noopener">${esc(item.requestCode)}</a>` : esc(item.requestCode)}</td>
          <td>${statusBadge(item.status, item.statusName)}</td>
          <td>${item.evaluationStatusName ? esc(item.evaluationStatusName) : '—'}</td>
          <td>${esc(item.typeName)}</td>
          <td>${esc(item.subTypeName)}${item.iteration > 1 ? ` <small>#${esc(item.iteration)}</small>` : ''}</td>
          <td>${esc(item.supplierName)}</td>
          <td>${esc(item.responsibleUserName)}</td>
          <td>${esc(dateText(item.createdDate))}</td>
          <td>${esc(dateText(item.modifiedDate || item.approvedDate))}</td>
        </tr>`).join('');
      const body = !id
        ? `<p class="cpaEmpty">${esc(L('Bu satırda PLM ID yok.', 'This row has no PLM ID.'))}</p>`
        : !entry
          ? `<p class="cpaEmpty">${esc(L('Bu model için henüz PLM numune senkronu yapılmadı.', 'Sample requests have not been synced from PLM for this style yet.'))}</p>`
          : rows
            ? `<div class="cpaScroll"><table class="cpaTable"><thead><tr>
                <th>${esc(L('Talep Kodu', 'Request Code'))}</th><th>${esc(L('Durum', 'Status'))}</th><th>${esc(L('Numune Değerlendirme', 'Sample Evaluation'))}</th><th>${esc(L('Tip', 'Type'))}</th>
                <th>${esc(L('Alt Tip', 'Sub Type'))}</th><th>${esc(L('Tedarikçi', 'Supplier'))}</th><th>${esc(L('Sorumlu', 'Responsible'))}</th>
                <th>${esc(L('Oluşturma', 'Created'))}</th><th>${esc(L('Son Değişiklik', 'Modified'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<p class="cpaEmpty">${esc(L('PLM\'de bu model için numune talebi yok.', 'There are no sample requests for this style in PLM.'))}</p>`;
      modal.innerHTML = `<div class="cpaModal"><header>
          <div><b>${esc(L('PLM Numune Talepleri', 'PLM Sample Requests'))}</b><small>${esc([id && `PLM ${id}`, title].filter(Boolean).join(' · '))}${entry && entry.fetchedAt ? ` · ${esc(L('Son senkron', 'Last sync'))}: ${esc(dateText(entry.fetchedAt))}` : ''}</small></div>
          <button type="button" data-plmr-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
        <div class="cpaModalBody">
          ${id && entry ? `<div class="cpaChips">${chips}</div>` : ''}
          ${body}
        </div>
        <footer>
          ${id ? `<button type="button" class="cpaBtn" data-plmr-sync>${esc(L('PLM\'den yenile', 'Refresh from PLM'))}</button>` : ''}
          <button type="button" class="cpaBtn ghost" data-plmr-close>${esc(L('Kapat', 'Close'))}</button>
        </footer></div>`;
      modal.querySelectorAll('[data-plmr-close]').forEach(el => { el.onclick = close; });
      const syncBtn = modal.querySelector('[data-plmr-sync]');
      if (syncBtn) syncBtn.onclick = async () => {
        syncBtn.disabled = true;
        syncBtn.textContent = L('PLM\'den alınıyor…', 'Fetching from PLM…');
        try {
          const result = await sync([id]);
          if (result.ok) toast(summaryText(result));
        } catch (err) {
          toast(L('PLM numune talepleri alınamadı: ', 'PLM sample requests could not be retrieved: ') + errorText(err), { duration: 12000 });
        }
        if (modal.isConnected) draw();
      };
    };
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.body.appendChild(modal);
    draw();
    load().then(() => { if (modal.isConnected) draw(); });
  }

  function openForRow(row, moduleId) {
    const title = String((row && (row['Model Name'] || row.modelName || row.model || row.modelKod)) || '').trim();
    openForPlm(plmIdOfRow(row, moduleId), title);
  }

  /* PLM İşlemleri paneli → "Başarısızları yeniden dene": aynı senkron akışı. */
  window.BLPlmOpsRetry = window.BLPlmOpsRetry || {};
  window.BLPlmOpsRetry['plm-requests'] = async ({ plmIds, scope }) => {
    try {
      const result = await sync(plmIds, { scope });
      if (result.ok) toast(summaryText(result));
    } catch (err) {
      toast(L('PLM numune talepleri alınamadı: ', 'PLM sample requests could not be retrieved: ') + errorText(err), { duration: 12000 });
    }
  };

  /* Saklı veri ilk yüklemede CP/Siparişler tablosuna ve kontrol listesine
     haber verilir (sütun ve Priority aynı olayla yeniden çizilir). */
  load().then(() => {
    if (!Object.keys(state.models).length) return;
    try { window.dispatchEvent(new CustomEvent('bl:plm-requests-changed', { detail: { revision: state.revision } })); } catch (_) { /* eski tarayıcı */ }
  });

  window.BLPlmSampleRequests = {
    load, sync, syncStep, syncStepSuffix, summaryText, autoRefreshStale, staleProductionPlmIds,
    entryFor, milestonesFor, orderMilestones, rowStage, evidenceForAnalysis, plmIdOfRow,
    openForPlm, openForRow, evidenceBadge, columnParts, columnText,
    get loaded() { return state.loaded; },
    get updatedAt() { return state.updatedAt; },
  };
})();
