/* PLM Operasyon Merkezi — jobId bazlı, sayfa kapsamına göre izole.

   NEDEN AYRI DOSYA: app-main.js zaten 25.000 satırın üzerinde. Bu modül
   kendi kendine yeten bir birim; app-main'in global yardımcılarını
   (escapeHtml, appLang, plmJsonRequest…) kullanır ama ona hiçbir şey eklemez
   — yalnız window.BLPlmOps üzerinden dışa açılır.

   TASARIM: Arayüz sıfırdan uydurulmadı. Buyer Log'un mevcut bileşen dili
   kullanıldı: .panel / .modalCard / .warnOverlay kabuklar, .kolPlanStat
   istatistik kutucukları, .badge durum etiketleri, .tbtn düğmeler ve
   :root'taki tema değişkenleri. Uygulama bilinçli olarak köşe yuvarlaması
   kullanmadığı için (--r-*: 0) burada da kullanılmaz.

   KAPSAM KURALI: Her ekran yalnız KENDİ işlerini gösterir; operasyon merkezi
   ise hepsini gösterir. Sayfa değişince iş durmaz — sunucuda arka planda
   sürer (bkz. server/lib/job-registry.js). */
(function () {
  'use strict';

  const POLL_MS = 1000;
  const SCOPE_BY_TAB = { koleksiyon: 'koleksiyon', cp: 'cp', orders: 'orders' };

  const KIND_LABEL = {
    'plm-sync': { tr: 'PLM verisi', en: 'PLM data' },
    'plm-links': { tr: 'Model linki', en: 'Model links' },
    'plm-images': { tr: 'Model görseli', en: 'Model images' },
    'plm-files': { tr: 'Teknik föy', en: 'Technical sheets' },
  };
  const STATUS_LABEL = {
    running: { tr: 'Çalışıyor', en: 'Running' },
    succeeded: { tr: 'Tamamlandı', en: 'Completed' },
    failed: { tr: 'Başarısız', en: 'Failed' },
    cancelled: { tr: 'İptal edildi', en: 'Cancelled' },
  };

  const en = () => (typeof appLang !== 'undefined' && appLang === 'en');
  const t = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(value) : String(value == null ? '' : value));
  const label = (map, key) => { const entry = map[key]; return entry ? (en() ? entry.en : entry.tr) : key; };

  function activeScope() {
    const tab = (document.body && document.body.dataset && document.body.dataset.activeTab) || '';
    return SCOPE_BY_TAB[tab] || '';
  }

  // Süreler kısa ve okunur: 45sn / 3dk 20sn / 1sa 05dk
  function humanDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
    if (total < 60) return `${Math.round(total)}${t('sn', 's')}`;
    const minutes = Math.floor(total / 60), seconds = Math.round(total % 60);
    if (minutes < 60) return `${minutes}${t('dk', 'm')}${seconds ? ` ${seconds}${t('sn', 's')}` : ''}`;
    const hours = Math.floor(minutes / 60);
    return `${hours}${t('sa', 'h')} ${String(minutes % 60).padStart(2, '0')}${t('dk', 'm')}`;
  }

  async function api(path, options) {
    if (typeof plmJsonRequest === 'function') return plmJsonRequest(path, options);
    const res = await fetch(path, { credentials: 'same-origin', ...(options || {}) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- veri katmanı ---------- */

  const state = { jobs: [], timer: null, subscribers: new Set(), panelOpen: false, expanded: new Set(), failureCache: new Map(), failureLoads: new Map() };

  async function refresh() {
    try {
      const data = await api('/api/plm-jobs');
      state.jobs = Array.isArray(data && data.jobs) ? data.jobs : [];
      const liveIds = new Set(state.jobs.map(job => String(job && job.id != null ? job.id : '')));
      for (const id of state.expanded) if (!liveIds.has(id)) state.expanded.delete(id);
      for (const id of state.failureCache.keys()) if (!liveIds.has(id)) state.failureCache.delete(id);
    } catch (_) { /* ağ hatası izlemeyi durdurmamalı */ }
    state.subscribers.forEach(fn => { try { fn(state.jobs); } catch (_) {} });
    render();
  }

  // Yoklama yalnız GEREKTİĞİNDE çalışır: çalışan iş yoksa ve panel kapalıysa
  // durur. Boşuna istek atıp sunucuyu meşgul etmez.
  function syncPolling() {
    const needed = state.panelOpen || state.jobs.some(job => job.running);
    if (needed && !state.timer) state.timer = setInterval(refresh, POLL_MS);
    else if (!needed && state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function jobsForScope(scope) {
    return scope ? state.jobs.filter(job => job.scope === scope) : state.jobs.slice();
  }

  function jobById(jobId) {
    const id = String(jobId == null ? '' : jobId);
    return state.jobs.find(job => String(job && job.id != null ? job.id : '') === id) || null;
  }

  /* ---------- görünüm parçaları ---------- */

  function statusBadge(job) {
    const tone = job.status === 'failed' ? 'isFail' : job.status === 'cancelled' ? 'isCancel'
      : job.running ? 'isRun' : 'isOk';
    const text = job.cancelRequested && job.running ? t('Durduruluyor', 'Stopping') : label(STATUS_LABEL, job.status);
    return `<span class="badge plmOpsBadge ${tone}">${esc(text)}</span>`;
  }

  function progressBar(job) {
    const tone = job.status === 'failed' ? ' isFail' : job.running ? '' : ' isDone';
    return `<div class="plmOpsBar${tone}" role="progressbar" aria-valuenow="${job.percent}" aria-valuemin="0" aria-valuemax="100">
      <span style="width:${Math.max(0, Math.min(100, job.percent))}%"></span></div>`;
  }

  function metric(caption, value) {
    return `<div class="kolPlanStat plmOpsStat"><span>${esc(caption)}</span><strong>${esc(value)}</strong></div>`;
  }

  function jobMetrics(job) {
    const cells = [
      metric(t('Toplam', 'Total'), job.total),
      metric(t('İşlenen', 'Processed'), job.processed),
      metric(t('Başarılı', 'Succeeded'), job.succeeded),
      metric(t('Başarısız', 'Failed'), job.failed),
      metric(t('Kalan', 'Remaining'), job.remaining),
      metric(t('Geçen süre', 'Elapsed'), humanDuration(job.elapsedMs)),
    ];
    // Hız ve ETA yalnız anlamlıysa gösterilir; "0/dk" veya uydurma ETA yok.
    if (job.ratePerMinute > 0) cells.push(metric(t('Hız', 'Rate'), `${job.ratePerMinute}/${t('dk', 'min')}`));
    if (job.etaMs != null && job.running) cells.push(metric(t('Tahmini kalan', 'ETA'), humanDuration(job.etaMs)));
    return `<div class="kolPlanStats plmOpsStats">${cells.join('')}</div>`;
  }

  function failureTable(failures) {
    if (!failures.length) return `<div class="plmOpsEmpty">${esc(t('Hatalı model yok.', 'No failed models.'))}</div>`;
    const rows = failures.map(item => `<tr>
      <td>${esc(item.plmId || '—')}</td>
      <td>${esc(item.model || '—')}</td>
      <td>${esc(item.code || '—')}</td>
      <td>${esc(item.error || '')}</td></tr>`).join('');
    return `<div class="plmImportTableWrap"><table class="plmImportTable plmOpsFailTable">
      <thead><tr><th>PLM ID</th><th>${esc(t('Model', 'Model'))}</th><th>${esc(t('Kod', 'Code'))}</th><th>${esc(t('Hata', 'Error'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function jobCard(job, { detailed }) {
    const jobId = String(job && job.id != null ? job.id : '');
    const expanded = state.expanded.has(jobId);
    const cached = state.failureCache.get(jobId);
    const failureHtml = cached ? failureTable(cached.failures)
      : `<div class="plmOpsEmpty">${esc(t('Yükleniyor…', 'Loading…'))}</div>`;
    const active = job.running && job.activeModel
      ? `<span class="plmOpsActive">${esc(t('İşlenen model: ', 'Active model: '))}${esc(job.activeModel)}</span>` : '';
    const actions = [];
    if (job.running && !job.cancelRequested) actions.push(`<button type="button" class="tbtn" data-plmops-cancel="${esc(jobId)}">${esc(t('Durdur', 'Stop'))}</button>`);
    if (job.failureCount) actions.push(`<button type="button" class="tbtn" data-plmops-toggle="${esc(jobId)}">${esc(expanded ? t('Hataları gizle', 'Hide errors') : t('Hataları göster', 'Show errors'))} (${job.failureCount})</button>`);
    if (job.failureCount && !job.running) actions.push(`<button type="button" class="tbtn primary" data-plmops-retry="${esc(jobId)}">${esc(t('Başarısızları yeniden dene', 'Retry failed'))}</button>`);

    return `<article class="plmOpsJob${job.running ? ' isRunning' : ''}" data-plmops-job="${esc(jobId)}">
      <header class="plmOpsJobHead">
        <div class="plmOpsTitle"><strong>${esc(label(KIND_LABEL, job.kind))}</strong>
          <span class="plmOpsScope">${esc(job.scope)}</span>${statusBadge(job)}</div>
        <div class="plmOpsPhase">${esc(job.phase || '')}${active}</div>
      </header>
      ${progressBar(job)}
      <div class="plmOpsLine">${esc(job.label || '')} · ${job.processed}/${job.total} (%${job.percent})</div>
      ${detailed ? jobMetrics(job) : ''}
      ${actions.length ? `<div class="plmOpsActions">${actions.join('')}</div>` : ''}
      ${expanded ? `<div class="plmOpsFailures" data-plmops-failures="${esc(jobId)}">${failureHtml}</div>` : ''}
    </article>`;
  }

  /* ---------- sayfa içi şerit (yalnız kendi kapsamı) ---------- */

  function stripHost() {
    let host = document.getElementById('plmOpsStrip');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'plmOpsStrip';
    host.className = 'plmOpsStrip';
    document.body.appendChild(host);
    return host;
  }

  function renderStrip() {
    const host = stripHost();
    const scope = activeScope();
    // KAPSAM KURALI: sayfa yalnız kendi işlerini görür.
    const running = jobsForScope(scope).filter(job => job.running);
    if (!scope || !running.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `<div class="plmOpsStripInner">
      ${running.map(job => jobCard(job, { detailed: false })).join('')}
      <button type="button" class="tbtn plmOpsOpen" data-plmops-open>${esc(t('Operasyon Merkezi', 'Operations Center'))}</button>
    </div>`;
  }

  /* ---------- operasyon merkezi (hepsi + geçmiş) ---------- */

  function renderPanel() {
    const modal = document.getElementById('plmOpsPanel');
    if (!modal) return;
    const all = state.jobs;
    const running = all.filter(job => job.running);
    const history = all.filter(job => !job.running);
    const body = modal.querySelector('[data-plmops-body]');
    if (!body) return;
    const scrollTop = body.scrollTop;
    body.innerHTML = `
      <section class="plmOpsSection">
        <h4>${esc(t('Çalışan işler', 'Running jobs'))} <span class="plmOpsCount">${running.length}</span></h4>
        ${running.length ? running.map(job => jobCard(job, { detailed: true })).join('')
          : `<div class="plmOpsEmpty">${esc(t('Şu anda çalışan bir iş yok.', 'No jobs are running.'))}</div>`}
      </section>
      <section class="plmOpsSection">
        <h4>${esc(t('Geçmiş', 'History'))} <span class="plmOpsCount">${history.length}</span></h4>
        ${history.length ? history.map(job => jobCard(job, { detailed: true })).join('')
          : `<div class="plmOpsEmpty">${esc(t('Geçmiş boş.', 'History is empty.'))}</div>`}
      </section>`;
    body.scrollTop = scrollTop;
    body.querySelectorAll('[data-plmops-failures]').forEach(node => {
      const id = String(node.dataset.plmopsFailures || '');
      const job = jobById(id);
      const cached = state.failureCache.get(id);
      if (job && (!cached || cached.failureCount !== Number(job.failureCount || 0))) void loadFailures(id);
    });
  }

  function loadFailures(jobId) {
    const id = String(jobId == null ? '' : jobId);
    if (!id) return Promise.resolve();
    const pending = state.failureLoads.get(id);
    if (pending) return pending;

    const task = (async () => {
      try {
        const data = await api(`/api/plm-jobs/${encodeURIComponent(id)}`);
        const failures = Array.isArray(data && data.failures) ? data.failures : [];
        const current = jobById(id);
        if (!current) return;
        state.failureCache.set(id, { failureCount: Number(current.failureCount || 0), failures });
        const node = document.querySelector(`[data-plmops-failures="${CSS.escape(id)}"]`);
        if (node && state.expanded.has(id)) node.innerHTML = failureTable(failures);
      } catch (error) {
        const node = document.querySelector(`[data-plmops-failures="${CSS.escape(id)}"]`);
        if (node && state.expanded.has(id) && !state.failureCache.has(id)) {
          node.innerHTML = `<div class="plmOpsEmpty">${esc(t('Hata listesi alınamadı.', 'Could not load errors.'))}</div>`;
        }
      } finally {
        state.failureLoads.delete(id);
      }
    })();
    state.failureLoads.set(id, task);
    return task;
  }

  function render() { renderStrip(); if (state.panelOpen) renderPanel(); syncPolling(); }

  function openPanel() {
    if (document.getElementById('plmOpsPanel')) return;
    const modal = document.createElement('div');
    modal.id = 'plmOpsPanel';
    modal.className = 'warnOverlay';
    modal.innerHTML = `<div class="modalCard verHistCard plmOpsCard" role="dialog" aria-modal="true" aria-label="${esc(t('PLM Operasyon Merkezi', 'PLM Operations Center'))}">
      <div class="verHistHead"><div>
        <strong>${esc(t('PLM Operasyon Merkezi', 'PLM Operations Center'))}</strong>
        <div class="muted">${esc(t('Tüm ekranlardaki PLM işleri. İşler arka planda sürer; sayfa değiştirmek onları durdurmaz.', 'PLM jobs across all screens. Jobs continue in the background; changing pages does not stop them.'))}</div>
      </div></div>
      <div class="plmImportBody" data-plmops-body></div>
      <div class="verHistFoot">
        <button type="button" class="tbtn" data-plmops-clear>${esc(t('Geçmişi temizle', 'Clear history'))}</button>
        <span style="flex:1"></span>
        <button type="button" class="tbtn" data-plmops-close>${esc(t('Kapat', 'Close'))}</button>
      </div></div>`;
    document.body.appendChild(modal);
    state.panelOpen = true;
    renderPanel();
    syncPolling();
    void refresh();
  }

  function closePanel() {
    document.getElementById('plmOpsPanel')?.remove();
    state.panelOpen = false;
    syncPolling();
  }

  function autoOpenOnOperationStart(event) {
    const detail = event && event.detail;
    if (!detail || !detail.kind) return;
    openPanel();
  }

  /* ---------- olaylar ---------- */

  document.addEventListener('click', async event => {
    const open = event.target.closest('[data-plmops-open]');
    if (open) { openPanel(); return; }
    if (event.target.closest('[data-plmops-close]')) { closePanel(); return; }
    if (event.target.id === 'plmOpsPanel') { closePanel(); return; }

    const cancel = event.target.closest('[data-plmops-cancel]');
    if (cancel) {
      const id = cancel.dataset.plmopsCancel;
      cancel.disabled = true;
      try { await api(`/api/plm-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); } catch (_) {}
      void refresh();
      return;
    }

    const toggle = event.target.closest('[data-plmops-toggle]');
    if (toggle) {
      const id = toggle.dataset.plmopsToggle;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      render();
      return;
    }

    const clear = event.target.closest('[data-plmops-clear]');
    if (clear) { try { await api('/api/plm-jobs/clear-finished', { method: 'POST' }); } catch (_) {} void refresh(); return; }

    const retry = event.target.closest('[data-plmops-retry]');
    if (retry) {
      const id = retry.dataset.plmopsRetry;
      retry.disabled = true;
      try {
        const data = await api(`/api/plm-jobs/${encodeURIComponent(id)}/failed-ids`);
        const plmIds = Array.isArray(data && data.plmIds) ? data.plmIds : [];
        if (!plmIds.length) { retry.disabled = false; return; }
        /* Yeniden deneme, işi BAŞLATAN akışın kendisine devredilir: burada
           ikinci bir "yalnız başarısızlar" yolu yazmak, iki farklı davranış
           üretme riski taşırdı. Akış yoksa kullanıcı bilgilendirilir. */
        const handler = window.BLPlmOpsRetry && window.BLPlmOpsRetry[data.kind];
        if (typeof handler === 'function') await handler({ plmIds, scope: data.scope, jobId: id });
        else if (typeof showToast === 'function') showToast(t('Bu iş türü için yeniden deneme akışı tanımlı değil.', 'No retry flow is defined for this job type.'));
      } catch (_) {}
      retry.disabled = false;
      void refresh();
    }
  });

  // PLM akışı panel yüklenmeden başlarsa bile olay kaybolmamalı; app-main
  // isteği başlatırken hem olay gönderir hem de mevcut paneli doğrudan açar.
  window.addEventListener('bl:plm-operation-started', autoOpenOnOperationStart);

  // Sekme değişince şerit yeniden çizilir: kapsam değişti demektir.
  const observer = new MutationObserver(() => renderStrip());
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] });

  window.BLPlmOps = {
    refresh, open: openPanel, close: closePanel,
    jobs: () => state.jobs.slice(),
    jobsForScope,
    subscribe: fn => { state.subscribers.add(fn); return () => state.subscribers.delete(fn); },
    humanDuration,
  };

  // İlk okuma: sayfa açılışında arka planda süren bir iş varsa hemen görünsün.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void refresh(), { once: true });
  else void refresh();
})();
