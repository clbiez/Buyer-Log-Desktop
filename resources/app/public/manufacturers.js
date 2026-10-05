/* ===================================================================
   v7.0.229 — ÜRETİCİLER SAYFASI (eski "E-Mail Grupları")

   Kullanıcı talebi (özet, birebir parçalar):
     "E-Mail grupları, e-mailler ve üreticileri database'deki üreticilerle
      eşleyip bir üretici kartı formatı oluşturmak istiyorum."
     "E-mail grupları modülünü Üreticiler olarak revize edelim ve bunu direkt
      soldaki navigasyon bara taşıyalım. Bu kendi sayfası olması gereken bir
      alan. Bu sayfanın analizi direkt Orders/LFL/Price And Supplier Analysis
      alanlarının ortak verisine bağlı olsun."

   KARARLAR
   1) VERİ TEK KAYNAKTAN. Analiz, Orders/LFL/Fiyat & Üretici Analizi'nin
      paylaştığı ASAS sipariş projeksiyonundan (Siparişler satırları) okunur;
      ek sorgu yapılmaz. Hesap saf motordadır (manufacturer-cards-engine.js);
      bu dosya yalnız görünüm ve etkileşimdir.
   2) REHBER TEK KAYNAKTAN. Kart kayıtları, e-postalar, ülke/grup başlıkları
      ve düzenleme kilidi mevcut ortak rehberdir (/api/email-groups). Bu sayfa
      ikinci bir liste tutmaz; düzenleme mevcut kilitli editörde yapılır.
   3) ASAS ÖNCELİKLİ. Kartı olmayan ASAS üreticisi için kart TAM ASAS adıyla
      açılır. ASAS'ta karşılığı olmayan kart görünür kalır ve benzer ASAS adına
      bir tıkla bağlanır; benzerlik kendiliğinden eşleme YAPMAZ.
   4) Bölümler <section> değildir (global section{display:none} tuzağı).
   =================================================================== */
(() => {
  'use strict';

  const E = window.BLManufacturerCards;
  if (!E) return;
  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const toast = message => { try { if (typeof showToast === 'function') showToast(message); } catch (_) { /* toast yoksa sessiz */ } };
  const MONTHS = { tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  const STORE_KEY = 'lcw.manufacturersPage.v1';

  const S = {
    host: null, loading: false, error: '',
    rows: [], rowsVersion: '', directory: { countries: [], types: [], records: [], revision: -1 },
    result: null, selectedKey: '',
    search: '', status: '', country: '', area: '', sort: 'volume',
  };
  try { const saved = JSON.parse((window.BLStorage || localStorage).getItem(STORE_KEY) || '{}'); ['status', 'sort', 'selectedKey'].forEach(key => { if (typeof saved[key] === 'string') S[key] = saved[key]; }); } catch (_) { /* tercih yoksa varsayılan */ }
  function persist() { try { (window.BLStorage || localStorage).setItem(STORE_KEY, JSON.stringify({ status: S.status, sort: S.sort, selectedKey: S.selectedKey })); } catch (_) { /* depolama kapalı */ } }

  const nf = (value, digits = 0) => new Intl.NumberFormat(en() ? 'en-US' : 'tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(value) || 0);
  const pct = value => (value == null ? '—' : (en() ? `${nf(value * 100)}%` : `%${nf(value * 100)}`));
  const monthLabel = key => { const [y, m] = String(key).split('-'); return `${MONTHS[en() ? 'en' : 'tr'][Number(m) - 1] || m} ${String(y).slice(2)}`; };
  const canManage = () => typeof window.BLHasPermission !== 'function' || window.BLHasPermission('manageBusinessRules');
  const headingName = (list, id) => ((list || []).find(item => item.id === id) || {}).name || '';

  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'same-origin', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(window.BL_CLIENT_ID ? { 'X-Client-Id': window.BL_CLIENT_ID } : {}), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || response.statusText); error.code = data.code; throw error; }
    return data;
  }

  /* ---------------- veri ---------------- */
  async function loadDirectory() {
    const data = await api('/api/email-groups');
    S.directory = { countries: data.countries || [], types: data.types || [], records: data.records || [], revision: Number(data.revision) || 0 };
  }
  async function loadRows() {
    const bridge = window.BLManufacturerDataBridge;
    const rows = bridge && typeof bridge.rows === 'function' ? await bridge.rows() : [];
    S.rows = Array.isArray(rows) ? rows : [];
    S.rowsVersion = bridge && typeof bridge.version === 'function' ? bridge.version() : String(S.rows.length);
  }
  function compute() {
    S.result = E.buildCards(S.rows, S.directory.records, { today: new Date() });
    window.BLManufacturerAsasNames = S.result.asasNames.slice();
  }
  async function refresh({ rows = true } = {}) {
    S.loading = true; S.error = ''; render();
    try {
      await Promise.all([rows ? loadRows() : Promise.resolve(), loadDirectory()]);
      compute();
    } catch (error) { S.error = error && error.message || String(error); }
    S.loading = false; render();
  }

  /* ---------------- süzme ---------------- */
  function cardArea(card) { return card.record ? headingName(S.directory.types, card.record.typeId) : ''; }
  function cardCountry(card) { return (card.countries[0] && card.countries[0].name) || (card.record ? headingName(S.directory.countries, card.record.countryId) : ''); }
  function visibleCards() {
    const cards = (S.result && S.result.cards) || [];
    const query = E.nameKey(S.search);
    const list = cards.filter(card => {
      if (S.status === 'missing_email' ? !(card.record && !card.recipients.length) : (S.status && card.status !== S.status)) return false;
      if (S.country && cardCountry(card) !== S.country) return false;
      if (S.area && (card.record ? card.record.typeId : '') !== S.area) return false;
      if (!query) return true;
      return [card.name, ...(card.record ? [card.record.email, ...(card.record.aliases || [])] : []), ...card.mags.map(item => item.name)]
        .some(value => E.nameKey(value).includes(query));
    });
    const grade = card => (card.performance.score == null ? -1 : card.performance.score);
    if (S.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    else if (S.sort === 'performance') list.sort((a, b) => grade(b) - grade(a) || b.quantity - a.quantity);
    else if (S.sort === 'risk') list.sort((a, b) => (grade(a) < 0 ? 999 : grade(a)) - (grade(b) < 0 ? 999 : grade(b)) || b.quantity - a.quantity);
    else list.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'tr'));
    return list;
  }

  /* ---------------- çizim ---------------- */
  const STATUS_TEXT = {
    linked: () => T('ASAS ile eşli', 'Linked to ASAS'),
    missing_card: () => T('Kartı yok', 'No card'),
    not_in_asas: () => T('ASAS’ta yok', 'Not in ASAS'),
  };
  function statusBadge(card) {
    return `<span class="mfpBadge is-${esc(card.status)}">${esc(STATUS_TEXT[card.status] ? STATUS_TEXT[card.status]() : card.status)}</span>`;
  }
  function gradeBadge(perf, large = false) {
    if (!perf || !perf.grade) return `<span class="mfpGrade is-none${large ? ' isLarge' : ''}" title="${esc(T('Yeterli yükleme verisi yok', 'Not enough shipment data'))}">—</span>`;
    return `<span class="mfpGrade is-${esc(perf.grade)}${large ? ' isLarge' : ''}" title="${esc(T(`Termin puanı ${perf.score}/100`, `Delivery score ${perf.score}/100`))}">${esc(perf.grade)}</span>`;
  }

  function shellHtml() {
    return `<div class="mfp">
      <div class="mfpHead">
        <div class="mfpTitle"><h2>${esc(T('Üreticiler', 'Manufacturers'))}</h2>
          <p>${esc(T('ASAS üreticileri, e-posta adresleri ve sipariş performansı tek üretici kartında. Analiz Orders / LFL / Fiyat & Üretici Analizi ile ortak sipariş verisinden gelir.', 'ASAS manufacturers, e-mail addresses and order performance on one manufacturer card. The analysis uses the order data shared with Orders / LFL / Price & Supplier Analysis.'))}</p></div>
        <div class="mfpHeadActions" data-mfp-actions></div>
      </div>
      <div class="mfpStats" data-mfp-stats></div>
      <div class="mfpBar">
        <input type="search" class="mfpSearch" data-mfp-search placeholder="${esc(T('Üretici, e-posta, MAG ara…', 'Search manufacturer, e-mail, MAG…'))}" autocomplete="off">
        <label class="mfpField">${esc(T('Durum', 'Status'))}<select data-mfp-filter="status"></select></label>
        <label class="mfpField">${esc(T('Ülke', 'Country'))}<select data-mfp-filter="country"></select></label>
        <label class="mfpField">${esc(T('Üretim alanı', 'Production area'))}<select data-mfp-filter="area"></select></label>
        <label class="mfpField">${esc(T('Sırala', 'Sort'))}<select data-mfp-filter="sort"></select></label>
        <span class="mfpCount" data-mfp-count></span>
      </div>
      <div class="mfpBody" data-mfp-body></div>
    </div>`;
  }

  function optionList(values, selected, allLabel) {
    return `<option value="">${esc(allLabel)}</option>${values.map(item => `<option value="${esc(item.value)}"${item.value === selected ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}`;
  }
  function renderBar() {
    const host = S.host; if (!host) return;
    const cards = (S.result && S.result.cards) || [];
    const countries = [...new Set(cards.map(cardCountry).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')).map(value => ({ value, label: value }));
    const set = (name, html) => { const el = host.querySelector(`[data-mfp-filter="${name}"]`); if (el) el.innerHTML = html; };
    set('status', optionList([
      { value: 'linked', label: STATUS_TEXT.linked() }, { value: 'missing_card', label: STATUS_TEXT.missing_card() },
      { value: 'not_in_asas', label: STATUS_TEXT.not_in_asas() }, { value: 'missing_email', label: T('E-postası yok', 'No e-mail') },
    ], S.status, T('Tümü', 'All')));
    set('country', optionList(countries, S.country, T('Tüm ülkeler', 'All countries')));
    set('area', optionList(S.directory.types.map(item => ({ value: item.id, label: item.name })), S.area, T('Tüm alanlar', 'All areas')));
    const sort = host.querySelector('[data-mfp-filter="sort"]');
    if (sort) sort.innerHTML = [['volume', T('Hacim', 'Volume')], ['performance', T('En iyi termin', 'Best delivery')], ['risk', T('En riskli termin', 'Riskiest delivery')], ['name', T('İsim', 'Name')]]
      .map(([value, label]) => `<option value="${value}"${S.sort === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const search = host.querySelector('[data-mfp-search]'); if (search && search.value !== S.search) search.value = S.search;
  }

  function renderStats() {
    const host = S.host && S.host.querySelector('[data-mfp-stats]'); if (!host) return;
    const stats = S.result ? S.result.stats : null, un = S.result ? S.result.unassigned : null;
    if (!stats) { host.innerHTML = ''; return; }
    const chip = (status, value, label, warn) => `<button type="button" class="mfpStat${warn && value ? ' isWarn' : ''}${S.status === status ? ' isActive' : ''}" data-mfp-status="${esc(status)}"><b>${nf(value)}</b><span>${esc(label)}</span></button>`;
    host.innerHTML = [
      chip('', stats.asasManufacturers, T('ASAS üreticisi', 'ASAS manufacturers')),
      chip('linked', stats.linked, T('kartı eşli', 'linked cards')),
      chip('missing_card', stats.missingCard, T('kartı yok', 'without a card'), true),
      chip('not_in_asas', stats.notInAsas, T('ASAS’ta karşılığı yok', 'not found in ASAS'), true),
      chip('missing_email', stats.missingEmail, T('e-postası yok', 'without e-mail'), true),
      un && un.rows ? `<button type="button" class="mfpStat isWarn" data-mfp-unassigned title="${esc(T('Lisanslı Non-DTR siparişlerde sorumlu Alt Üreticidir; boş olduğu için bu siparişler hiçbir karta, kurala veya otomasyona bağlanamaz.', 'On licensed non-DTR orders the Sub-Manufacturer is responsible; these orders cannot be tied to any card, rule or automation while it is empty.'))}"><b>${nf(un.rows)}</b><span>${esc(T('Non-DTR siparişte Alt Üretici eksik', 'non-DTR orders missing Sub-Manufacturer'))}</span></button>` : '',
    ].join('');
  }

  function renderActions() {
    const host = S.host && S.host.querySelector('[data-mfp-actions]'); if (!host) return;
    const missing = S.result ? S.result.cards.filter(card => card.status === 'missing_card').length : 0;
    host.innerHTML = `
      ${canManage() && missing ? `<button type="button" class="mfpBtn isPrimary" data-mfp-create-all><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T(`Eksik kartları ASAS’tan oluştur (${nf(missing)})`, `Create missing cards from ASAS (${nf(missing)})`))}</button>` : ''}
      <button type="button" class="mfpBtn" data-mfp-directory><svg class="ic"><use href="#i-mail-send"/></svg>${esc(T('İletişim rehberi', 'Contact directory'))}</button>
      <button type="button" class="mfpBtn" data-mfp-refresh title="${esc(T('Sipariş verisini ve rehberi yeniden oku', 'Re-read order data and the directory'))}"><svg class="ic"><use href="#i-refresh"/></svg>${esc(T('Yenile', 'Refresh'))}</button>`;
  }

  function listRowHtml(card) {
    const country = cardCountry(card), area = cardArea(card);
    return `<button type="button" class="mfpRow${S.selectedKey === card.key ? ' isSelected' : ''}" data-mfp-select="${esc(card.key)}">
      <span class="mfpRowMain"><strong>${esc(card.name || T('(adsız üretici)', '(unnamed manufacturer)'))}</strong>
        <small>${esc([country, area].filter(Boolean).join(' · ') || T('Sınıflandırılmadı', 'Unclassified'))}</small></span>
      <span class="mfpRowMeta"><b>${card.quantity ? nf(card.quantity) : '—'}</b><small>${esc(T('adet', 'units'))}</small></span>
      ${gradeBadge(card.performance)}
      ${card.status === 'linked' ? '' : statusBadge(card)}
    </button>`;
  }

  function monthlyChartHtml(card) {
    const months = card.monthly || [];
    const max = Math.max(1, ...months.map(item => Math.max(item.planned, item.loaded)));
    const current = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const bars = months.map(item => {
      const planned = Math.round((item.planned / max) * 100), loaded = Math.round((item.loaded / max) * 100);
      const tip = T(`${monthLabel(item.month)} · Ex-Factory planı ${nf(item.planned)} · Yüklenen ${nf(item.loaded)}`, `${monthLabel(item.month)} · Ex-Factory plan ${nf(item.planned)} · Loaded ${nf(item.loaded)}`);
      return `<button type="button" class="mfpMonth isDrill${item.month === current ? ' isCurrent' : ''}" data-mfp-drill="month" data-mfp-drill-value="${esc(item.month)}" data-mfp-drill-label="${esc(monthLabel(item.month))}" title="${esc(tip)}"><div class="mfpMonthBars"><i class="isPlanned" style="height:${planned}%"></i><i class="isLoaded" style="height:${loaded}%"></i></div><span>${esc(monthLabel(item.month))}</span></button>`;
    }).join('');
    return `<div class="mfpChart" role="img" aria-label="${esc(T('Aylık yükleme adetleri', 'Monthly shipment quantities'))}">${bars}</div>
      <div class="mfpLegend"><span><i class="isPlanned"></i>${esc(T('Ex-Factory ayına göre plan', 'Planned by Ex-Factory month'))}</span><span><i class="isLoaded"></i>${esc(T('Yükleme onayı ayına göre yüklenen', 'Loaded by loading-approval month'))}</span></div>`;
  }

  /* Termin yorumu: sayılar düz dille anlatılır. */
  function performanceComment(perf) {
    if (!perf.measured && !perf.loaded) return T('Bu üretici için termin ölçülecek sipariş tarihi yok.', 'There are no order dates to measure delivery for this manufacturer.');
    const parts = [];
    if (perf.loaded) {
      if (perf.onTimeRate >= 0.85) parts.push(T('Yüklemelerin büyük çoğunluğunu ilk verilen tarihte ya da öncesinde yapıyor.', 'Ships most orders on or before the first promised date.'));
      else if (perf.onTimeRate >= 0.6) parts.push(T(`Yüklemelerin bir kısmı ilk söze göre gecikiyor; geç kalanlarda ortalama ${perf.avgDelayDays} gün.`, `Some shipments are late against the first promise; ${perf.avgDelayDays} days on average when late.`));
      else parts.push(T(`Yüklemelerin çoğu ilk söze göre gecikiyor (geç kalanlarda ortalama ${perf.avgDelayDays} gün).`, `Most shipments are late against the first promise (${perf.avgDelayDays} days on average when late).`));
    }
    if (perf.revisionRate != null && perf.revised) {
      parts.push(perf.revisionRate >= 0.3
        ? T(`Siparişlerin ${pct(perf.revisionRate)}’inde termin ileri revize edilmiş, yani ertelenmiş (ortalama +${perf.avgRevisionDays} gün): doğrudan gecikme olmasa da ilk söze sadakat düşük.`, `${pct(perf.revisionRate)} of orders had their date revised (+${perf.avgRevisionDays} days on average): even without direct delay, the first promise is often not kept.`)
        : T(`Erteleme (ileri revize) talebi sınırlı (${perf.revised} sipariş, ortalama +${perf.avgRevisionDays} gün).`, `Revised date requests are limited (${perf.revised} orders, +${perf.avgRevisionDays} days on average).`));
    }
    if (perf.pulledForward) parts.push(T(`${perf.pulledForward} siparişte termin öne çekilmiş; bu olumlu sayılır ve notu düşürmez.`, `${perf.pulledForward} orders had their date pulled forward; this counts as positive and does not lower the grade.`));
    if (perf.lateVsExFactory) parts.push(T(`${perf.lateVsExFactory} sipariş güncel (revize) Ex-Factory tarihini de kaçırmış.`, `${perf.lateVsExFactory} orders also missed the current (revised) Ex-Factory date.`));
    if (perf.openOverdue) parts.push(T(`${perf.openOverdue} açık siparişin Ex-Factory tarihi geçti ve yükleme onayı yok (ortalama ${perf.avgOpenOverdueDays} gün).`, `${perf.openOverdue} open orders are past Ex-Factory with no loading approval (${perf.avgOpenOverdueDays} days on average).`));
    return parts.join(' ');
  }

  function performanceHtml(card) {
    const perf = card.performance;
    const baselineNote = perf.baseline === 'asasExFactory'
      ? T('İlk söz olarak ASAS’ın ilk Ex-Factory değeri kullanıldı: ASAS bağlantısında Initial Inspection Tarih alanı eşlenince ölçüm ona göre yapılır.', 'The first ASAS Ex-Factory value was used as the first promise: once the Initial Inspection date field is mapped in the ASAS connection, it is used instead.')
      : perf.baseline === 'initialInspection' ? T('İlk söz: Initial Inspection tarihi.', 'First promise: Initial Inspection date.') : '';
    const metric = (label, value, hint, drillKind) => `<button type="button" class="mfpMetric isDrill" data-mfp-drill="${esc(drillKind)}" data-mfp-drill-label="${esc(label)}"><label>${esc(label)}</label><strong>${value}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</button>`;
    return `<div class="mfpPanel mfpPerf">
      <div class="mfpPanelHead"><strong>${esc(T('Yükleme termin performansı', 'Shipment delivery performance'))}</strong>${gradeBadge(perf, true)}</div>
      <div class="mfpMetrics">
        ${metric(T('İlk söze göre zamanında', 'On time vs first promise'), esc(pct(perf.onTimeRate)), T(`${nf(perf.onTime)} / ${nf(perf.loaded)} yüklenen sipariş`, `${nf(perf.onTime)} / ${nf(perf.loaded)} shipped orders`), 'on_time')}
        ${metric(T('Ertelenen termin (revize)', 'Postponed dates (revised)'), esc(pct(perf.revisionRate)), [perf.revised ? T(`${nf(perf.revised)} sipariş · ort. +${perf.avgRevisionDays} gün`, `${nf(perf.revised)} orders · avg +${perf.avgRevisionDays} days`) : T('Erteleme yok', 'No postponements'), perf.pulledForward ? T(`${nf(perf.pulledForward)} öne çekildi`, `${nf(perf.pulledForward)} pulled forward`) : ''].filter(Boolean).join(' · '), 'revised')}
        ${metric(T('Ortalama gecikme', 'Average delay'), perf.avgDelayDays ? esc(T(`${perf.avgDelayDays} gün`, `${perf.avgDelayDays} days`)) : '—', T('Geç yüklenenlerde, yükleme onayı − ilk söz', 'For late shipments, loading approval − first promise'), 'late')}
        ${metric(T('Açık ve gecikmiş', 'Open and overdue'), esc(nf(perf.openOverdue)), perf.openOverdue ? T(`ort. ${perf.avgOpenOverdueDays} gün`, `avg ${perf.avgOpenOverdueDays} days`) : T('Ex-Factory’si geçen açık sipariş yok', 'No open order past Ex-Factory'), 'overdue')}
      </div>
      <p class="mfpComment">${esc(performanceComment(perf))}</p>
      ${baselineNote ? `<p class="mfpNote">${esc(baselineNote)}</p>` : ''}
    </div>`;
  }

  function detailHtml(card) {
    if (!card) return `<div class="mfpEmpty"><strong>${esc(T('Bir üretici seçin', 'Select a manufacturer'))}</strong><p>${esc(T('Kartı görmek için soldaki listeden bir üretici seçin.', 'Select a manufacturer from the list to see its card.'))}</p></div>`;
    const record = card.record;
    const country = cardCountry(card), area = cardArea(card);
    const fabric = card.fabric.map(item => `${item.name} ${pct(item.share)}`).join(' · ');
    const manage = canManage();
    const actions = [
      record && manage ? `<button type="button" class="mfpBtn isPrimary" data-mfp-edit="${esc(record.id)}"><svg class="ic"><use href="#i-pencil"/></svg>${esc(T('Kartı düzenle', 'Edit card'))}</button>` : '',
      !record && manage ? `<button type="button" class="mfpBtn isPrimary" data-mfp-create="${esc(card.key)}"><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T('Kart oluştur', 'Create card'))}</button>` : '',
      card.orders ? `<button type="button" class="mfpBtn" data-mfp-orders="${esc(card.key)}"><svg class="ic"><use href="#i-search"/></svg>${esc(T('Siparişleri aç', 'Open orders'))}</button>` : '',
    ].join('');
    const warnings = [];
    if (card.status === 'missing_card') warnings.push(`<div class="mfpAlert">${esc(T('Bu ASAS üreticisinin kartı yok: e-posta adresi olmadığı için kurallar ve otomasyonlar bu üreticiye e-posta oluşturamaz.', 'This ASAS manufacturer has no card: without an e-mail address, rules and automations cannot create e-mails for it.'))}</div>`);
    if (card.status === 'not_in_asas') {
      const links = (card.suggestions || []).map(item => manage
        ? `<button type="button" class="mfpBtn isSmall" data-mfp-link="${esc(record.id)}" data-mfp-link-name="${esc(item.name)}">${esc(T(`“${item.name}” ile eşle`, `Link to “${item.name}”`))}</button>`
        : `<span class="mfpChip">${esc(item.name)}</span>`).join('');
      warnings.push(`<div class="mfpAlert">${esc(T('Bu kartın adı ASAS’taki hiçbir üreticiyle birebir eşleşmiyor; formüller, kurallar ve otomasyonlar bu karta sipariş bağlayamaz. Adı ASAS’taki tam adla eşleyin.', 'This card’s name does not exactly match any ASAS manufacturer; formulas, rules and automations cannot tie orders to it. Link it to the exact ASAS name.'))}${links ? `<div class="mfpAlertActions"><span>${esc(T('Benzer ASAS adları:', 'Similar ASAS names:'))}</span>${links}</div>` : ''}</div>`);
    }
    if (record && !card.recipients.length) warnings.push(`<div class="mfpAlert isSoft">${esc(T('Kartta e-posta adresi yok. Otomasyonlar bu üreticiyi “çözülemedi” olarak raporlar.', 'The card has no e-mail address. Automations report this manufacturer as “unresolved”.'))}</div>`);
    const aliases = record && record.aliases && record.aliases.length ? record.aliases : [];
    const spellings = (card.spellings || []).filter(name => name !== card.name);
    const tile = (label, value, hint, drillKind = '', drillLabel = '') => {
      const inner = `<label>${esc(label)}</label><strong>${value}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}`;
      return drillKind
        ? `<button type="button" class="mfpTile isDrill" data-mfp-drill="${esc(drillKind)}" data-mfp-drill-label="${esc(drillLabel || label)}">${inner}</button>`
        : `<div class="mfpTile">${inner}</div>`;
    };
    return `<article class="mfpCard">
      <header class="mfpCardHead"><div><span class="mfpEyebrow">${esc(T('Üretici kartı', 'Manufacturer card'))}</span><h3>${esc(card.name)}</h3>
        <div class="mfpCardBadges">${statusBadge(card)}${record && record.origin === 'manual' ? `<span class="mfpBadge">${esc(T('Elle eklendi', 'Added manually'))}</span>` : ''}</div></div>
        <div class="mfpCardActions">${actions}</div></header>
      ${warnings.join('')}
      ${card.inAsas ? `<div class="mfpTiles">
        ${tile(T('Ülke', 'Country'), esc(country || '—'), card.countries.length > 1 ? card.countries.slice(1).map(item => item.name).join(', ') : '')}
        ${tile(T('Üretim alanı', 'Production area'), esc(area || '—'), fabric ? T(`ASAS kumaş kategorisi: ${fabric}`, `ASAS fabric category: ${fabric}`) : '')}
        ${tile(T('Toplam sipariş hacmi', 'Total order volume'), `${esc(nf(card.quantity))} <small>${esc(T('adet', 'units'))}</small>`, T(`${nf(card.orders)} sipariş · ${nf(card.activeOrders)} açık`, `${nf(card.orders)} orders · ${nf(card.activeOrders)} open`), 'all')}
        ${tile(T('Açık bakiye', 'Open balance'), `${esc(nf(card.remaining))} <small>${esc(T('adet', 'units'))}</small>`, card.fobValue ? T(`FOB değeri ≈ ${nf(card.fobValue)}`, `FOB value ≈ ${nf(card.fobValue)}`) : '', 'open')}
        ${tile(T('Aylık ortalama yükleme', 'Average monthly shipment'), `${esc(nf(card.avgMonthlyLoaded))} <small>${esc(T('adet', 'units'))}</small>`, T('Son 6 ay, yükleme onayı ayına göre', 'Last 6 months, by loading-approval month'), 'recent_loaded')}
        ${tile(T('Sezonlar', 'Seasons'), esc(card.seasons.slice(-4).join(', ') || '—'), '')}
      </div>
      <div class="mfpPanel"><div class="mfpPanelHead"><strong>${esc(T('LCW’deki aylık yükleme adetleri', 'Monthly shipment quantities at LCW'))}</strong></div>${monthlyChartHtml(card)}</div>
      <div class="mfpPanel"><div class="mfpPanelHead"><strong>${esc(T('Sipariş aldığı MAG grupları', 'MAG groups ordered'))}</strong><span>${nf(card.mags.length)}</span></div>
        <div class="mfpChips">${card.mags.length ? card.mags.map(item => `<button type="button" class="mfpChip isDrill" data-mfp-drill="mag" data-mfp-drill-value="${esc(item.name)}" data-mfp-drill-label="${esc(item.name)}" title="${esc(nf(item.qty))}">${esc(item.name)} <b>${esc(pct(item.share))}</b></button>`).join('') : `<span class="mfpMuted">—</span>`}</div></div>
      ${performanceHtml(card)}` : ''}
      <div class="mfpPanel"><div class="mfpPanelHead"><strong>${esc(T('E-posta adresleri', 'E-mail addresses'))}</strong><span>${nf(card.recipients.length)}</span></div>
        <div class="mfpChips">${card.recipients.length ? card.recipients.map(item => `<a class="mfpChip isMail" href="mailto:${esc(item.email)}">${esc(item.name ? `${item.name} · ${item.email}` : item.email)}</a>`).join('') : `<span class="mfpMuted">${esc(T('E-posta adresi yok', 'No e-mail address'))}</span>`}</div>
        ${record && (record.contact || record.phone) ? `<p class="mfpNote">${esc([record.contact, record.phone].filter(Boolean).join(' · '))}</p>` : ''}</div>
      ${card.licensedOrders ? `<div class="mfpPanel"><div class="mfpPanelHead"><strong>${esc(T('Lisans sorumluluğu', 'License responsibility'))}</strong></div><p class="mfpNote">${esc(T(`${nf(card.licensedOrders)} lisanslı Non-DTR siparişte Alt Üretici (Sub-Manufacturer) olarak sorumlu. Bu siparişlerde Manufacturer alanında lisansör yazar: ${card.licensors.map(item => item.name).join(', ')}.`, `Responsible as Sub-Manufacturer on ${nf(card.licensedOrders)} licensed non-DTR orders. On these orders the Manufacturer field holds the licensor: ${card.licensors.map(item => item.name).join(', ')}.`))}</p></div>` : ''}
      ${aliases.length || spellings.length ? `<div class="mfpPanel"><div class="mfpPanelHead"><strong>${esc(T('Alternatif adlar', 'Alternative names'))}</strong></div><div class="mfpChips">${aliases.concat(spellings).map(name => `<span class="mfpChip">${esc(name)}</span>`).join('')}</div><p class="mfpNote">${esc(T('Bu adlarla gelen siparişler ve eski kayıtlar da bu karta bağlanır.', 'Orders and old records using these names are tied to this card too.'))}</p></div>` : ''}
      ${record ? `<footer class="mfpCardFoot">${esc(T('Son güncelleme', 'Last updated'))}: ${esc(window.BLEmailGroups?.stampText ? window.BLEmailGroups.stampText(record.updatedAt) : record.updatedAt || '—')}${record.updatedByName ? ` · ${esc(record.updatedByName)}` : ''}</footer>` : ''}
    </article>`;
  }

  function render() {
    const host = S.host; if (!host) return;
    if (!host.querySelector('.mfp')) host.innerHTML = shellHtml();
    renderActions(); renderStats(); renderBar();
    const body = host.querySelector('[data-mfp-body]');
    if (S.error) { body.innerHTML = `<div class="mfpEmpty"><strong>${esc(T('Üreticiler hazırlanamadı', 'Manufacturers could not be prepared'))}</strong><p>${esc(S.error)}</p></div>`; return; }
    if (!S.result) { body.innerHTML = `<div class="mfpEmpty"><strong>${esc(T('Veriler hazırlanıyor…', 'Preparing data…'))}</strong></div>`; return; }
    const list = visibleCards();
    const total = S.result.cards.length;
    const count = host.querySelector('[data-mfp-count]');
    if (count) count.textContent = list.length === total ? T(`${nf(total)} kart`, `${nf(total)} cards`) : T(`${nf(list.length)} / ${nf(total)} kart`, `${nf(list.length)} / ${nf(total)} cards`);
    if (!list.some(card => card.key === S.selectedKey)) S.selectedKey = list[0] ? list[0].key : '';
    const selected = list.find(card => card.key === S.selectedKey) || null;
    const scroll = body.querySelector('.mfpListScroll'); const top = scroll ? scroll.scrollTop : 0;
    body.innerHTML = `<div class="mfpList"><div class="mfpListScroll">${list.length ? list.map(listRowHtml).join('') : `<div class="mfpEmpty">${esc(total ? T('Filtreye uyan üretici yok.', 'No manufacturer matches the filter.') : T('Sipariş verisinde üretici bulunamadı.', 'No manufacturer was found in the order data.'))}</div>`}</div></div><div class="mfpDetail">${detailHtml(selected)}</div>`;
    const nextScroll = body.querySelector('.mfpListScroll'); if (nextScroll) nextScroll.scrollTop = top;
    if (S.loading) body.classList.add('isLoading'); else body.classList.remove('isLoading');
  }

  /* ---------------- eylemler ---------------- */
  function cardByKey(key) { return S.result ? S.result.cards.find(card => card.key === key) : null; }
  async function createCards(cards) {
    if (!cards.length) return;
    const message = cards.length === 1
      ? T(`“${cards[0].name}” için ASAS adıyla üretici kartı oluşturulsun mu?`, `Create a manufacturer card for “${cards[0].name}” with its ASAS name?`)
      : T(`${cards.length} ASAS üreticisi için TAM ASAS adıyla kart oluşturulsun mu? Mevcut kartlara dokunulmaz.`, `Create cards for ${cards.length} ASAS manufacturers with their exact ASAS names? Existing cards are not touched.`);
    if (!confirm(message)) return;
    try {
      const data = await api('/api/email-groups/asas-cards', { method: 'POST', body: JSON.stringify({ records: cards.map(card => ({ manufacturer: card.name, countryName: card.countries[0] ? card.countries[0].name : '' })) }) });
      S.directory = { countries: data.countries || [], types: data.types || [], records: data.records || [], revision: Number(data.revision) || 0 };
      compute(); render();
      window.BLEmailDirectory?.ensureDirectory?.(true);
      toast(T(`${(data.summary && data.summary.added || []).length} kart oluşturuldu. E-posta adreslerini kartı düzenleyerek ekleyin.`, `${(data.summary && data.summary.added || []).length} cards created. Add e-mail addresses by editing the card.`));
    } catch (error) { toast(error.message || String(error)); }
  }
  async function linkCard(recordId, name) {
    if (!confirm(T(`Kartın adı ASAS’taki “${name}” olarak değiştirilsin mi? Eski ad alternatif ad olarak korunur.`, `Rename the card to the ASAS name “${name}”? The old name is kept as an alternative name.`))) return;
    try {
      const data = await api(`/api/email-groups/records/${encodeURIComponent(recordId)}/link`, { method: 'POST', body: JSON.stringify({ name }) });
      S.directory = { countries: data.countries || [], types: data.types || [], records: data.records || [], revision: Number(data.revision) || 0 };
      compute(); S.selectedKey = E.nameKey(name); render();
      window.BLEmailDirectory?.ensureDirectory?.(true);
      toast(T('Kart ASAS adına bağlandı.', 'The card was linked to the ASAS name.'));
    } catch (error) { toast(error.message || String(error)); }
  }
  function openOrders(card, rows, title) {
    const bridge = window.BLManufacturerDataBridge;
    if (bridge && typeof bridge.openOrders === 'function') bridge.openOrders(rows, title);
  }
  function rowsForCard(card) { return S.rows.filter(row => E.nameKey(E.responsibleManufacturer(row).name) === card.key); }
  function rowsMissingSub() { return S.rows.filter(row => { const r = E.responsibleManufacturer(row); return !r.name && r.issue === 'sub_manufacturer_missing'; }); }

  /* Üretici özetleri aynı Backlog V3 alt detay çekmecesini kullanır. Sipariş
     satırlarını burada yalnız operasyon alanlarına adapte ederiz; kimlik,
     Buyer/üretici/sezon gibi alanlar canonical registry üzerinden aynen kalır. */
  function rowPick(row, keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && String(row[key]).trim() !== '') return row[key];
    }
    return '';
  }
  function canonicalValue(row, id) {
    try {
      const api = window.BLCanonicalFields;
      return api && typeof api.value === 'function' ? api.value(row, 'orders', id) : '';
    } catch (_) { return ''; }
  }
  function rowNumber(row, keys) {
    const raw = rowPick(row, keys);
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    const value = Number(String(raw == null ? '' : raw).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(value) ? value : 0;
  }
  function backlogStatus(value) {
    const raw = String(value == null ? '' : value).trim();
    const key = raw.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
    if (key.includes('IN PRODUCTION')) return 'Üretimde';
    if (key.includes('LOADING')) return 'Yükleme Operasyonları';
    if (key.includes('IN TRANSIT')) return 'Yolda';
    if (key.includes('CUSTOM')) return 'Gümrük';
    if (key.includes('SHORTAGE')) return 'Eksik Yükleme';
    if (key.includes('AWAITING RETAIL') || key.includes('RETAIL')) return 'Retail Bekliyor';
    if (key.includes('WAREHOUSE')) return 'Depoda';
    return raw;
  }
  function rowIsOpen(row) {
    if (typeof row?._isActive === 'boolean') return row._isActive;
    const explicit = String(rowPick(row, ['Active/Inactive']) || '').trim();
    if (explicit) return /^active$/i.test(explicit);
    return rowNumber(row, E.KEYS.remaining) > 0;
  }
  function dayMonth(value) {
    const day = E.dayValue(value);
    if (day == null) return '';
    const date = new Date(day);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  function recentLoadedMonths() {
    const now = new Date(), out = new Set();
    for (let offset = -6; offset < 0; offset += 1) {
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
      out.add(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }
  function drillRows(card, kind, value) {
    const rows = rowsForCard(card);
    if (kind === 'all') return rows;
    if (kind === 'open') return rows.filter(rowIsOpen);
    if (kind === 'recent_loaded') {
      const months = recentLoadedMonths();
      return rows.filter(row => months.has(dayMonth(rowPick(row, E.KEYS.loadingApproval))));
    }
    if (kind === 'month') return rows.filter(row => {
      const planned = dayMonth(rowPick(row, E.KEYS.exFactory));
      const loaded = dayMonth(rowPick(row, E.KEYS.loadingApproval));
      return planned === value || loaded === value;
    });
    if (kind === 'mag') return rows.filter(row => E.nameKey(rowPick(row, E.KEYS.mag)) === E.nameKey(value));
    const today = E.dayValue(new Date());
    if (kind === 'on_time') return rows.filter(row => { const d = E.rowDelivery(row, today); return d.delayDays != null && d.delayDays <= 0; });
    if (kind === 'revised') return rows.filter(row => E.rowDelivery(row, today).revised);
    if (kind === 'late') return rows.filter(row => { const d = E.rowDelivery(row, today); return d.delayDays != null && d.delayDays > 0; });
    if (kind === 'overdue') return rows.filter(row => E.rowDelivery(row, today).openOverdueDays != null);
    return rows;
  }
  function qtyForDrill(row, kind) {
    if (kind === 'open') return rowNumber(row, E.KEYS.remaining);
    if (kind === 'recent_loaded') {
      const shipped = rowNumber(row, E.KEYS.shipmentQuantity);
      return shipped > 0 ? shipped : rowNumber(row, E.KEYS.orderQuantity);
    }
    return rowNumber(row, E.KEYS.orderQuantity);
  }
  function backlogItemsFromOrders(rows, kind) {
    const report = window.BLBacklogV3Report;
    if (!report || typeof report.normalizeRows !== 'function') return [];
    const engineFields = window.BLBacklogDeliveryEngine?.FIELDS || {};
    const fallback = {
      status: 'GÜNCEL DURUM\n(STATUS)', revisedLoad: 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
      plannedLoad: 'Orijinal Exfactory Merch Tarih', antrepo: 'ANTREPO GİRİŞ TARİHİ',
      retail: 'Retail Depo Tarih Yıl Ay Gün', inStore: 'Model Bütçe Tarih Yıl Ay Gün', qty: 'Adet',
    };
    const adapted = (Array.isArray(rows) ? rows : []).map(row => {
      const next = { ...row };
      const put = (field, value) => { if (field && value != null && String(value).trim() !== '') next[field] = value; };
      const status = backlogStatus(canonicalValue(row, 'orderStatus') || rowPick(row, ['STATUS', 'Status', 'status', fallback.status]));
      const exFactory = canonicalValue(row, 'exFactory') || rowPick(row, E.KEYS.exFactory);
      const planned = rowPick(row, E.KEYS.initialInspection) || rowPick(row, E.KEYS.asasExFactory) || exFactory;
      const antrepo = rowPick(row, [engineFields.antrepo, fallback.antrepo, 'Ant. Arrival', 'Antrepo Giriş Tarihi', 'Warehouse Arrival', 'antrepo'].filter(Boolean));
      const retail = canonicalValue(row, 'retailDate') || rowPick(row, [engineFields.retail, fallback.retail, 'Retail Date', 'retailDate'].filter(Boolean));
      const inStore = canonicalValue(row, 'inStore') || rowPick(row, [engineFields.inStore, fallback.inStore, 'In-Store', 'In-Store (Model Budget)', 'inStore'].filter(Boolean));
      const qty = qtyForDrill(row, kind);
      [[engineFields.status || fallback.status, status], [fallback.status, status],
       [engineFields.revisedLoad || fallback.revisedLoad, exFactory], [fallback.revisedLoad, exFactory],
       [engineFields.plannedLoad || fallback.plannedLoad, planned], [fallback.plannedLoad, planned],
       [engineFields.antrepo || fallback.antrepo, antrepo], [fallback.antrepo, antrepo],
       [engineFields.retail || fallback.retail, retail], [fallback.retail, retail],
       [engineFields.inStore || fallback.inStore, inStore], [fallback.inStore, inStore],
       [engineFields.qty || fallback.qty, qty], [fallback.qty, qty]].forEach(([field, val]) => put(field, val));
      return next;
    });
    return report.normalizeRows(adapted).map((item, index) => {
      const responsible = E.responsibleManufacturer(rows[index] || {});
      if (responsible.name) item.manufacturer = responsible.name;
      return item;
    });
  }
  function openDrill(card, kind, value = '', label = '') {
    if (!card) return;
    const rows = drillRows(card, kind, value);
    if (!rows.length) { toast(T('Bu özet için eşleşen sipariş yok.', 'No orders match this summary.')); return; }
    const items = backlogItemsFromOrders(rows, kind);
    const title = [card.name, label || value].filter(Boolean).join(' · ');
    if (items.length && window.BLBacklogOverview?.openItems?.(items, {
      title,
      subtitle: T('Üreticiler · Sipariş alt detayı', 'Manufacturers · Order drill-down'),
    })) return;
    openOrders(card, rows, title || card.name);
  }

  function bind(host) {
    host.addEventListener('click', async event => {
      const target = event.target;
      const select = target.closest('[data-mfp-select]');
      if (select) { S.selectedKey = select.dataset.mfpSelect; persist(); render(); return; }
      const status = target.closest('[data-mfp-status]');
      if (status) { S.status = S.status === status.dataset.mfpStatus ? '' : status.dataset.mfpStatus; persist(); render(); return; }
      if (target.closest('[data-mfp-unassigned]')) { openOrders(null, rowsMissingSub(), T('Alt Üreticisi eksik Non-DTR lisans siparişleri', 'Non-DTR license orders missing a Sub-Manufacturer')); return; }
      if (target.closest('[data-mfp-refresh]')) { await refresh(); return; }
      if (target.closest('[data-mfp-directory]')) { window.BLEmailGroups?.open?.(); return; }
      if (target.closest('[data-mfp-create-all]')) { await createCards(S.result.cards.filter(card => card.status === 'missing_card')); return; }
      const create = target.closest('[data-mfp-create]');
      if (create) { const card = cardByKey(create.dataset.mfpCreate); if (card) await createCards([card]); return; }
      const edit = target.closest('[data-mfp-edit]');
      if (edit) { window.BLEmailGroups?.openRecord?.(edit.dataset.mfpEdit, { edit: true }); return; }
      const link = target.closest('[data-mfp-link]');
      if (link) { await linkCard(link.dataset.mfpLink, link.dataset.mfpLinkName); return; }
      const drill = target.closest('[data-mfp-drill]');
      if (drill) {
        const card = cardByKey(S.selectedKey);
        if (card) openDrill(card, drill.dataset.mfpDrill, drill.dataset.mfpDrillValue || '', drill.dataset.mfpDrillLabel || '');
        return;
      }
      const orders = target.closest('[data-mfp-orders]');
      if (orders) {
        const card = cardByKey(orders.dataset.mfpOrders);
        if (card) openDrill(card, 'all', '', T('Tüm siparişler', 'All orders'));
      }
    });
    host.addEventListener('input', event => {
      if (event.target.matches('[data-mfp-search]')) { S.search = event.target.value; render(); }
    });
    host.addEventListener('change', event => {
      const name = event.target.dataset && event.target.dataset.mfpFilter;
      if (!name) return;
      S[name] = event.target.value; persist(); render();
    });
  }

  /* Rehber değişince (kart düzenlendi, kilit alındı vb.) kartlar yeniden
     eşlenir; sipariş verisi yeniden okunmaz. */
  window.addEventListener('bl:manufacturer-directory-changed', event => {
    const detail = event.detail || {};
    if (!S.host || !Array.isArray(detail.records)) return;
    if (Number(detail.revision) === S.directory.revision) return;
    S.directory = { countries: detail.countries || [], types: detail.types || [], records: detail.records, revision: Number(detail.revision) || 0 };
    if (S.rows.length || S.result) { compute(); render(); }
  });

  async function initManufacturersPage() {
    const host = document.getElementById('manufacturersPage');
    if (!host) return;
    if (S.host !== host) { S.host = host; host.innerHTML = shellHtml(); bind(host); }
    const bridge = window.BLManufacturerDataBridge;
    const version = bridge && typeof bridge.version === 'function' ? bridge.version() : '';
    if (!S.result || (version && version !== S.rowsVersion)) await refresh();
    else { render(); try { await loadDirectory(); compute(); render(); } catch (_) { /* rehber geçici okunamadı */ } }
  }
  function renderManufacturersLanguage() { if (S.host) { S.host.innerHTML = shellHtml(); render(); } }

  window.initManufacturersPage = initManufacturersPage;
  window.renderManufacturersLanguage = renderManufacturersLanguage;
  window.BLManufacturersPage = { state: S, refresh, visibleCards, performanceComment, openDrill };
})();
