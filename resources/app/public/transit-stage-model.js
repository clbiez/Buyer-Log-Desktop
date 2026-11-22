/* Buyer Log — Aşama bazlı yol süresi modeli (tarayıcı + Node.js, bağımlılıksız).
 *
 * Global Lojistik "İthalat Yol Süresi Raporu"nun kritik yolu IAS (Antrepo)
 * parsiyellerinin GERÇEKLEŞEN tarihlerinden hesaplanır:
 *
 *   Yükleme Talep → Handover → Cut Off → Fiili Yükleme → ETA → Özet Beyan
 *     → Ambar Onay → Transit Beyanname → Antrepo Giriş
 *
 * Bu adımlar birbirini bekler (sıralıdır). Evrak/ödeme zinciri gemi yoldayken
 * PARALEL yürür; yalnız evrak ETA'dan sonra teslim edilirse (4.1 negatif)
 * gümrüğü bekletebilir. Paralel kol toplam süreye eklenmez.
 *
 * İki ürün:
 *   buildModel(shipments)   → ülke × taşıt için her aşamanın ortalama / P80
 *                             süresi ve her kilometre taşından antrepoya
 *                             KALAN sürenin dağılımı.
 *   project(milestones, …)  → tek parsiyel için son gerçekleşen kilometre
 *                             taşından ETA, aşama sapmaları, açık aşım ve
 *                             zamanında varış olasılığı.
 *
 * Neden "kalan süre" doğrudan ölçülür? Aşama ortalamalarını toplamak iki
 * hata üretir: (1) her aşamanın ortalaması farklı parsiyel kümesinden gelir,
 * (2) aşamalar bağımsız değildir — erken Handover gemi tarifesini beklerken
 * erir. "Handover'dan antrepoya kalan süre"yi geçmiş parsiyellerde doğrudan
 * ölçmek bu bekleşmeyi kendiliğinden içerir.
 *
 * AI YOK: bütün sayılar gerçekleşen tarihlerden deterministik hesaplanır. */
(function attachTransitStageModel(root, factory) {
  const api = factory(root && root.BLBusinessRules ? root.BLBusinessRules : (typeof require === 'function' ? require('./business-rules.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLTransitStageModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTransitStageModel(rules) {
  'use strict';

  const VERSION = 2;
  const KIND = 'stageModel';
  /* Kritik yol kilometre taşları (sıralı). */
  const MILESTONES = Object.freeze(['loadingRequest', 'handover', 'cutOff', 'actualLoading', 'eta', 'summaryDeclaration', 'warehouseApproval', 'transitDeclaration', 'warehouseEntry']);
  const MILESTONE_INDEX = Object.freeze(Object.fromEntries(MILESTONES.map((m, i) => [m, i])));
  /* Gelecek tarihi PLAN sayılabilecek kilometre taşları: gemi tarifesi (Cut Off,
     ETA) önceden bilinir. Diğer kilometre taşlarında gelecek tarih tutarsızdır. */
  const PLANNABLE = Object.freeze(new Set(['cutOff', 'eta']));
  const STAGES = Object.freeze([
    { code: '1', from: 'loadingRequest', to: 'handover', group: 'loading', tr: 'Yükleme Talep → Handover', en: 'Loading Request → Handover' },
    { code: '2', from: 'handover', to: 'cutOff', group: 'loading', tr: 'Handover → Cut Off', en: 'Handover → Cut-off' },
    { code: '3', from: 'cutOff', to: 'actualLoading', group: 'loading', tr: 'Cut Off → Fiili Yükleme', en: 'Cut-off → Actual Loading' },
    { code: '4', from: 'actualLoading', to: 'eta', group: 'transit', tr: 'Fiili Yükleme → ETA', en: 'Actual Loading → ETA' },
    { code: '5', from: 'eta', to: 'summaryDeclaration', group: 'customs', tr: 'ETA → Özet Beyan', en: 'ETA → Summary Declaration' },
    { code: '6', from: 'summaryDeclaration', to: 'warehouseApproval', group: 'customs', tr: 'Özet Beyan → Ambar Onay', en: 'Summary Declaration → Warehouse Approval' },
    { code: '7', from: 'warehouseApproval', to: 'transitDeclaration', group: 'customs', tr: 'Ambar Onay → Transit Beyanname', en: 'Warehouse Approval → Transit Declaration' },
    { code: '8', from: 'transitDeclaration', to: 'warehouseEntry', group: 'customs', tr: 'Transit Beyanname → Antrepo Giriş', en: 'Transit Declaration → Antrepo Entry' },
  ]);
  const MILESTONE_LABELS = Object.freeze({
    loadingRequest: ['Yükleme Talep', 'Loading Request'], handover: ['Handover', 'Handover'], cutOff: ['Cut Off', 'Cut-off'],
    actualLoading: ['Fiili Yükleme', 'Actual Loading'], eta: ['ETA', 'ETA'], summaryDeclaration: ['Özet Beyan', 'Summary Declaration'],
    warehouseApproval: ['Ambar Onay', 'Warehouse Approval'], transitDeclaration: ['Transit Beyanname', 'Transit Declaration'],
    warehouseEntry: ['Antrepo Giriş', 'Antrepo Entry'],
  });
  const GROUP_LABELS = Object.freeze({ loading: ['Yükleme', 'Loading'], transit: ['Yol', 'Transit'], customs: ['Gümrük', 'Customs'] });
  const STATS = Object.freeze(['mean', 'p80']);

  /* Geçerli süre aralıkları. Aşama süresi küçük negatif olabilir (aynı gün
     saat farkı, -3'e kadar kabul); antrepoya kalan süre negatif olamaz. */
  const STAGE_MIN = -3, STAGE_MAX = 365, REMAIN_MAX = 365;
  /* Grup, dağılımı temsil etmek için en az bu kadar parsiyel ister; azsa taşıt
     geneline (tüm ülkeler) düşülür. */
  const MIN_SAMPLE = 5;
  /* Olasılık için daha büyük örneklem gerekir; küçük örneklemde yüzde vermek
     yanıltıcı kesinlik üretir. */
  const MIN_PROBABILITY_SAMPLE = 8;
  const QUANTILES = Object.freeze(Array.from({ length: 21 }, (_, i) => i * 5)); // 0,5,…,100
  const MAX_GROUPS = 400;

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function round(value, digits = 1) {
    if (!Number.isFinite(value)) return null;
    const f = 10 ** digits;
    const out = Math.round(value * f) / f;
    return out === 0 ? 0 : out;
  }
  function dayOrdinal(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000);
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }
  // Sunucu yerel takvim günü (parse.js localIsoDate ile aynı); UTC günü gece yarısından sonra bir gün geride kalır.
  function localToday() { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function isoFromOrdinal(ord) { return ord == null ? null : new Date(ord * 86400000).toISOString().slice(0, 10); }
  function countryKey(value) {
    if (rules && rules.transitCountryKey) return rules.transitCountryKey(value);
    return text(value).toUpperCase();
  }
  function vehicleKey(value) {
    const raw = text(value);
    if (!raw) return '';
    const norm = rules && rules.normalizeTransitDelType ? rules.normalizeTransitDelType(raw) : raw;
    return rules && rules.transitDelTypeKey ? (rules.transitDelTypeKey(norm) || text(norm).toUpperCase()) : text(norm).toUpperCase();
  }
  function groupId(country, vehicle) { return countryKey(country) + '|' + vehicleKey(vehicle); }

  /* ------------------------------------------------------------ istatistik */
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function describe(values, withQuantiles) {
    const list = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
    if (!list.length) return null;
    const mean = list.reduce((s, v) => s + v, 0) / list.length;
    // Standart sapma (örneklem): aşama gecikmesinin "normal dalgalanma" mı yoksa
    // olağan dışı mı olduğunu σ cinsinden ölçmek için.
    const sd = list.length > 1 ? Math.sqrt(list.reduce((s, v) => s + (v - mean) ** 2, 0) / (list.length - 1)) : 0;
    const out = { n: list.length, mean: round(mean), p80: round(quantile(list, 0.8)), sd: round(sd) };
    if (withQuantiles) out.q = QUANTILES.map(p => round(quantile(list, p / 100)));
    return out;
  }
  /* Ters dağılım: 5'lik kantillerden doğrusal; p ∈ [0, 1]. */
  function quantileOf(q, p) {
    const pos = Math.max(0, Math.min(1, p)) * (q.length - 1);
    const lo = Math.floor(pos), hi = Math.min(q.length - 1, lo + 1);
    return q[lo] + (q[hi] - q[lo]) * (pos - lo);
  }
  /* Ampirik dağılım fonksiyonu: P(X ≤ x), 5'lik kantillerden doğrusal. */
  function cdf(q, x) {
    if (!Array.isArray(q) || q.length !== QUANTILES.length || !Number.isFinite(x)) return null;
    if (x < q[0]) return 0;
    if (x >= q[q.length - 1]) return 1;
    for (let i = 1; i < q.length; i += 1) {
      if (x < q[i]) {
        const span = q[i] - q[i - 1];
        const base = (i - 1) / (q.length - 1);
        return span > 0 ? base + ((x - q[i - 1]) / span) / (q.length - 1) : i / (q.length - 1);
      }
    }
    return 1;
  }

  /* -------------------------------------------------------------- model */
  function shipmentDates(shipment) {
    const s = shipment || {};
    const out = {};
    for (const m of MILESTONES) out[m] = dayOrdinal(s[m]);
    return out;
  }

  /* shipments: transit-analysis-source shipmentFromEntry çıktısı
     ({ country, vehicle, arrived, warehouseEntry, loadingRequest, handover, … }).
     Yalnız antrepoya GERÇEKTEN girmiş (warehouseEntry ≤ bugün) parsiyeller
     dağılıma girer: henüz yolda olanları katmak kalan süreyi kısa gösterirdi. */
  function buildModel(shipments, meta = {}) {
    const today = dayOrdinal(meta.today) != null ? dayOrdinal(meta.today) : dayOrdinal(localToday());
    const from = dayOrdinal(meta.fromDate), to = dayOrdinal(meta.toDate);
    const stats = { total: 0, used: 0, notArrived: 0, outOfWindow: 0, missingCountry: 0, inconsistent: 0 };
    const groups = new Map();
    const take = (id, seed) => {
      if (!groups.has(id)) groups.set(id, { ...seed, n: 0, stages: Object.fromEntries(STAGES.map(s => [s.code, []])), remaining: Object.fromEntries(MILESTONES.map(m => [m, []])), docs: [] });
      return groups.get(id);
    };
    for (const raw of Array.isArray(shipments) ? shipments : []) {
      stats.total += 1;
      const s = raw || {};
      const d = shipmentDates(s);
      const entry = d.warehouseEntry;
      if (!s.arrived || entry == null || (today != null && entry > today)) { stats.notArrived += 1; continue; }
      if ((from != null && entry < from) || (to != null && entry > to)) { stats.outOfWindow += 1; continue; }
      const country = text(s.country);
      if (!country) { stats.missingCountry += 1; continue; }
      const vehicle = text(s.vehicle);
      const targets = [take(groupId(country, vehicle), { country, countryKey: countryKey(country), vehicle, vehicleKey: vehicleKey(vehicle), scope: 'country' })];
      targets.push(take('*|' + vehicleKey(vehicle), { country: '', countryKey: '*', vehicle, vehicleKey: vehicleKey(vehicle), scope: 'vehicle' }));
      let usable = false, bad = false;
      const stageValues = {};
      for (const st of STAGES) {
        const a = d[st.from], b = d[st.to];
        if (a == null || b == null) continue;
        const v = b - a;
        if (v < STAGE_MIN || v > STAGE_MAX) { bad = true; continue; }
        stageValues[st.code] = Math.max(0, v);
      }
      const remainValues = {};
      for (const m of MILESTONES) {
        const a = d[m];
        if (a == null) continue;
        const v = entry - a;
        if (v < 0 || v > REMAIN_MAX) { bad = true; continue; }
        remainValues[m] = v;
        if (m !== 'warehouseEntry') usable = true;
      }
      const docDate = dayOrdinal(s.documentDelivery);
      const docLead = docDate != null && d.eta != null ? d.eta - docDate : null; // + : ETA'dan önce teslim
      if (bad) stats.inconsistent += 1;
      if (!usable) continue;
      stats.used += 1;
      for (const g of targets) {
        g.n += 1;
        for (const [code, v] of Object.entries(stageValues)) g.stages[code].push(v);
        for (const [m, v] of Object.entries(remainValues)) g.remaining[m].push(v);
        if (docLead != null && Math.abs(docLead) <= STAGE_MAX) g.docs.push(docLead);
      }
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.n < 1) continue;
      const stagesOut = {};
      for (const st of STAGES) { const dsc = describe(g.stages[st.code], false); if (dsc) stagesOut[st.code] = dsc; }
      const remainingOut = {};
      for (const m of MILESTONES) {
        if (m === 'warehouseEntry') continue;
        const dsc = describe(g.remaining[m], true);
        if (dsc) remainingOut[m] = dsc;
      }
      const docs = describe(g.docs, false);
      out.push({ country: g.country, countryKey: g.countryKey, vehicle: g.vehicle, vehicleKey: g.vehicleKey, scope: g.scope, n: g.n,
        stages: stagesOut, remaining: remainingOut, docsLateShare: g.docs.length ? round(g.docs.filter(v => v < 0).length / g.docs.length, 3) : null, docs });
    }
    out.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'vehicle' ? 1 : -1) || b.n - a.n);
    return normalizeModel({
      version: VERSION, kind: KIND,
      generatedAt: meta.generatedAt || new Date().toISOString(),
      generatedBy: meta.generatedBy || '',
      sourceLabel: meta.sourceLabel || '',
      window: meta.window || '', fromDate: isoFromOrdinal(from), toDate: isoFromOrdinal(to),
      stats, groups: out.slice(0, MAX_GROUPS),
    });
  }

  function cleanDescribe(value, withQuantiles) {
    if (!value || typeof value !== 'object') return null;
    const n = Math.max(0, Math.round(Number(value.n) || 0));
    const mean = Number(value.mean), p80 = Number(value.p80);
    if (!n || !Number.isFinite(mean) || !Number.isFinite(p80) || Math.abs(mean) > 3650 || Math.abs(p80) > 3650) return null;
    const out = { n, mean: round(mean), p80: round(p80) };
    const sd = Number(value.sd);
    if (Number.isFinite(sd) && sd >= 0 && sd <= 3650) out.sd = round(sd);
    if (withQuantiles) {
      const q = Array.isArray(value.q) ? value.q.map(Number) : null;
      if (q && q.length === QUANTILES.length && q.every(Number.isFinite) && q.every((v, i) => i === 0 || v >= q[i - 1])) out.q = q.map(v => round(v));
    }
    return out;
  }
  /* Sunucu ve istemci aynı doğrulamayı kullanır (kalıcı şekil). */
  function normalizeModel(input) {
    if (!input || typeof input !== 'object' || input.kind !== KIND) return null;
    const groups = (Array.isArray(input.groups) ? input.groups : []).slice(0, MAX_GROUPS).map(g => {
      if (!g || typeof g !== 'object') return null;
      const scope = g.scope === 'vehicle' ? 'vehicle' : 'country';
      const stages = {};
      for (const st of STAGES) { const dsc = cleanDescribe(g.stages && g.stages[st.code], false); if (dsc) stages[st.code] = dsc; }
      const remaining = {};
      for (const m of MILESTONES) { if (m === 'warehouseEntry') continue; const dsc = cleanDescribe(g.remaining && g.remaining[m], true); if (dsc) remaining[m] = dsc; }
      if (!Object.keys(remaining).length) return null;
      const share = g.docsLateShare == null || g.docsLateShare === '' ? NaN : Number(g.docsLateShare);
      return {
        country: text(g.country).slice(0, 60), countryKey: scope === 'vehicle' ? '*' : countryKey(g.country),
        vehicle: text(g.vehicle).slice(0, 40), vehicleKey: vehicleKey(g.vehicle), scope,
        n: Math.max(0, Math.round(Number(g.n) || 0)), stages, remaining,
        docsLateShare: Number.isFinite(share) && share >= 0 && share <= 1 ? share : null,
        docs: cleanDescribe(g.docs, false),
      };
    }).filter(Boolean);
    if (!groups.length) return null;
    const st = input.stats && typeof input.stats === 'object' ? input.stats : {};
    const stats = {};
    ['total', 'used', 'notArrived', 'outOfWindow', 'missingCountry', 'inconsistent'].forEach(k => { stats[k] = Math.max(0, Math.round(Number(st[k]) || 0)); });
    const iso = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '');
    const at = text(input.generatedAt);
    return {
      version: VERSION, kind: KIND,
      generatedAt: Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
      generatedBy: text(input.generatedBy).slice(0, 120),
      sourceLabel: text(input.sourceLabel).slice(0, 200),
      window: text(input.window).slice(0, 8), fromDate: iso(input.fromDate), toDate: iso(input.toDate),
      stats, groups,
    };
  }

  /* Model sorgusu: önce ülke × taşıt, örneklem azsa taşıt geneli. Her model
     çağrısında tekrar dizin kurmamak için WeakMap önbelleği. */
  const indexCache = new WeakMap();
  function indexOf(model) {
    if (!model || typeof model !== 'object') return null;
    let idx = indexCache.get(model);
    if (!idx) {
      idx = new Map();
      for (const g of Array.isArray(model.groups) ? model.groups : []) idx.set(g.countryKey + '|' + g.vehicleKey, g);
      indexCache.set(model, idx);
    }
    return idx;
  }
  function lookup(model, country, vehicle) {
    const idx = indexOf(model);
    if (!idx) return null;
    const vk = vehicleKey(vehicle);
    const own = country ? idx.get(countryKey(country) + '|' + vk) : null;
    if (own && own.n >= MIN_SAMPLE) return own;
    const general = idx.get('*|' + vk);
    if (general && general.n >= MIN_SAMPLE) return general;
    return null;
  }

  /* ------------------------------------------------------------ projeksiyon
     milestones: { loadingRequest, handover, cutOff, actualLoading, eta,
                   summaryDeclaration, warehouseApproval, transitDeclaration,
                   warehouseEntry, documentDelivery } — tarih (ISO/ordinal).
     Gerçekleşen = bugün veya öncesi. Cut Off/ETA gelecekteyse PLAN sayılır.

     ETA (her istatistik için ayrı):
       1. Çapa = en ileri GERÇEKLEŞEN kilometre taşı k. ETA_k = tarih_k + Kalan(k).
       2. Plan: k'dan sonra gelen planlı Cut Off/ETA varsa onun kalanı daha
          bilgilidir (gemi tarifesini içerir): ETA_p = plan + Kalan(plan).
       3. Açık aşım: k'dan bir sonraki ölçülen kilometre taşı j hâlâ
          gerçekleşmemişse ve geçen süre (bugün − tarih_k) beklenen aradan
          (Kalan(k) − Kalan(j), ortalama) uzunsa j EN ERKEN bugün gerçekleşir:
          ETA ≥ bugün + Kalan(j).
     Olasılık: P(varış ≤ hedef | çapadan beri geçen süre) — kalan süre
     dağılımından, çapadan bu yana zaten geçmiş günler koşullanarak. */
  function project(input, options = {}) {
    const model = options.model;
    const group = options.group || lookup(model, options.country, options.vehicle);
    if (!group) return null;
    const today = dayOrdinal(options.today) != null ? dayOrdinal(options.today) : dayOrdinal(localToday());
    const raw = input || {};
    const actual = {}, planned = {};
    for (const m of MILESTONES) {
      const d = dayOrdinal(raw[m]);
      if (d == null) continue;
      if (today == null || d <= today) actual[m] = d;
      else if (PLANNABLE.has(m)) planned[m] = d;
    }
    if (actual.warehouseEntry != null) return null; // varmış: tahmin gerekmez
    let anchor = null;
    for (let i = MILESTONES.length - 2; i >= 0; i -= 1) {
      const m = MILESTONES[i];
      if (actual[m] != null && group.remaining[m]) { anchor = m; break; }
    }
    if (!anchor) return null;
    const anchorIdx = MILESTONE_INDEX[anchor];
    const anchorDate = actual[anchor];
    /* Tahmin tam gün üzerinden yapılır: ortalama / P80 kalan süreler normal
       yuvarlanır (3,4 → 3; 3,7 → 4). Ondalıklı ortalamalarla hesaplayıp yalnız
       gösterimi yuvarlamak "3 g sürdü (ortalama 3 g): 1 g erken" gibi kendi
       içinde çelişen kalemler üretiyordu. */
    const rem = (m, stat) => (group.remaining[m] && Number.isFinite(group.remaining[m][stat]) ? Math.round(group.remaining[m][stat]) : null);

    /* Geçilmiş adım tabanı: IAS durumu (Yolda → yükleme, Gümrük-Liman → ETA
       geçildi) tarihi olmasa da o adımın gerçekleştiğini söyler. Gözlenebilirlik:
       kaynakta sütunu hiç olmayan kilometre taşı (ör. Backlog sorgusunda Cut
       Off) "henüz olmadı" sayılamaz; sıradaki adım gözlenebilenlerden seçilir.
       Aksi halde yoldaki parsiyel Handover'dan beri "Cut-off'ta bekliyor" görünür. */
    const passedIdx = options.passed && MILESTONE_INDEX[options.passed] != null ? MILESTONE_INDEX[options.passed] : -1;
    // observed: dizi ya da (tembel) milestone => boolean.
    const observedFn = typeof options.observed === 'function' ? options.observed : null;
    const observed = !observedFn && options.observed ? new Set(options.observed) : null;
    /* notReached: IAS durumunun HENÜZ gerçekleşmediğini söylediği adım (ör.
       "Yükleme Operasyonları" → Fiili Yükleme yok). Tarih sütunu kaynakta olmasa
       da o adım "bekleniyor" sayılır; aralık onun ötesine atlayıp parsiyeli
       yolda gibi göstermez. */
    const notReached = options.notReached && MILESTONE_INDEX[options.notReached] != null ? options.notReached : null;
    const isObserved = m => actual[m] != null || planned[m] != null || m === notReached
      || (observedFn ? observedFn(m) !== false : (!observed || observed.has(m)));
    const floorIdx = Math.max(anchorIdx, passedIdx);

    // Planlı kilometre taşı (geçilmiş tabandan sonraki en ileri plan).
    let plan = null;
    for (let i = MILESTONES.length - 2; i > floorIdx; i -= 1) {
      const m = MILESTONES[i];
      if (planned[m] != null && group.remaining[m]) { plan = m; break; }
    }
    // Bir sonraki ölçülebilir kilometre taşı: tabandan sonra, kalan dağılımı olan ve gözlenebilen.
    let next = null;
    for (let i = floorIdx + 1; i < MILESTONES.length - 1; i += 1) {
      const m = MILESTONES[i];
      if (group.remaining[m] && isObserved(m)) { next = m; break; }
    }
    const elapsed = today != null ? today - anchorDate : 0;

    /* Aralığın beklenen süresi ve σ'sı: aralıktaki aşamaların KENDİ ortalamaları
       (iki ucu gerçekleşen parsiyellerden) toplanır, σ bağımsız varsayımıyla
       √Σσ². Kalan-süre ortalamalarının farkı farklı örneklemlerden gelebildiği
       için (ör. Cut Off yalnız bazı parsiyellerde dolu) sahte aşım üretir; yalnız
       bir aşamanın verisi yoksa ona düşülür. */
    const spanList = (fromM, toM) => STAGES.filter(st => MILESTONE_INDEX[st.from] >= MILESTONE_INDEX[fromM] && MILESTONE_INDEX[st.to] <= MILESTONE_INDEX[toM]);
    const spanMean = (fromM, toM) => {
      if (fromM === toM) return 0;
      const list = spanList(fromM, toM);
      if (list.length && list.every(st => group.stages[st.code] && Number.isFinite(group.stages[st.code].mean))) {
        return Math.round(list.reduce((sum, st) => sum + group.stages[st.code].mean, 0));
      }
      const a = rem(fromM, 'mean'), b = rem(toM, 'mean');
      return a != null && b != null ? Math.max(0, a - b) : null;
    };
    const spanSd = (fromM, toM) => {
      const list = spanList(fromM, toM);
      if (list.length && list.every(st => group.stages[st.code] && Number.isFinite(group.stages[st.code].sd))) {
        return Math.sqrt(list.reduce((sum, st) => sum + group.stages[st.code].sd ** 2, 0));
      }
      return group.remaining[fromM] && Number.isFinite(group.remaining[fromM].sd) ? group.remaining[fromM].sd : null;
    };

    /* Açık aşım:
       - sıradaki gözlenebilir adım varsa: çapadan beri geçen gün > aralığın ortalaması;
       - yoksa (ör. Gümrük-Liman, sonraki adımların sütunu sorguda yok): çapadan
         antrepoya kalan ortalama süre aşıldı mı. Aksi halde takılı kalmış parsiyel
         hiç gecikme üretmezdi.
       Sonraki adım (veya daha ileri bir adım) gelecekte PLANLIYSA aşım sayılmaz. */
    const expectedGap = next ? (spanMean(anchor, next) || 0) : rem(anchor, 'mean');
    // Tam gün: aşama ortalamaları toplamı kesirli olabilir; gösterim ve eşikler gün cinsindendir.
    const openOverrun = today != null && !(next ? planned[next] != null : plan) && elapsed > expectedGap ? Math.round(elapsed - expectedGap) : 0;

    /* Sıradaki adım yokken ETA, çapadan kalan süre dağılımının geçen güne göre
       KOŞULLU değeridir (henüz varmadığı biliniyor): E[R | R > geçen] veya koşullu P80. */
    const conditionalRemaining = stat => {
      const dist = group.remaining[anchor];
      if (!dist || !Array.isArray(dist.q) || dist.q.length !== QUANTILES.length) return null;
      const c = cdf(dist.q, elapsed);
      if (c == null || c >= 1) return null;
      if (stat === 'p80') return Math.round(quantileOf(dist.q, c + 0.8 * (1 - c)));
      let sum = 0;
      for (let k = 0; k < 20; k += 1) sum += quantileOf(dist.q, c + (1 - c) * (k + 0.5) / 20);
      return Math.round(sum / 20);
    };
    const etaFor = stat => {
      let eta = plan ? planned[plan] + rem(plan, stat) : anchorDate + rem(anchor, stat);
      if (!plan && !next && today != null && elapsed > 0) {
        const cond = conditionalRemaining(stat);
        if (cond != null) eta = Math.max(eta, anchorDate + cond);
      }
      if (openOverrun > 0 && next && today != null) eta = Math.max(eta, today + rem(next, stat));
      // Henüz gerçekleşmemiş varış en erken bugündür.
      if (today != null) eta = Math.max(eta, today);
      return Math.round(eta);
    };
    const etaMean = etaFor('mean');
    // P80 "temkinli" seçimdir: aykırı değerli küçük örneklemde ortalamadan önce düşemez.
    const etaP80 = Math.max(etaFor('p80'), etaMean);

    // Plansız temel çizgi: zincirin ilk ölçülen kilometre taşından ortalama.
    let first = null;
    for (const m of MILESTONES) { if (actual[m] != null && group.remaining[m]) { first = m; break; } }
    const baseline = first ? Math.round(actual[first] + rem(first, 'mean')) : null;

    /* Koşan aralık: sıradaki gözlenebilir adıma (yoksa antrepoya) kadar. Etiket
       aşama kodudur; gün ve beklenen süre aşamanın KENDİ başlangıcından sayılır
       (çapadan aşama başlangıcına beklenen süre düşülür). Bu ara süre
       hesaplanamıyorsa sayım çapadan yapılır ve aralık (spanFrom → spanTo) açıkça
       taşınır; arayüz etiketi buna göre yazar. */
    /* Aşama kodu aralığın BAŞINDAN seçilir: parsiyelin bulunduğu aşama, geçilmiş
       tabandan sonraki ilk aşamadır. Aralığın sonundan seçmek, Handover'ı yapılmış
       ama yüklenmemiş parsiyeli "Yükleme → ETA" (yolda) gösterirdi; oysa Handover
       ile Cut Off ayrıdır, ürün Handover'dan sonra cut-off'u bekleyebilir. */
    const runningStage = STAGES.find(st => MILESTONE_INDEX[st.from] >= floorIdx
      && (!next || MILESTONE_INDEX[st.to] <= MILESTONE_INDEX[next])) || null;
    let running = null;
    if (runningStage) {
      const offset = runningStage.from === anchor || MILESTONE_INDEX[runningStage.from] < anchorIdx ? 0 : spanMean(anchor, runningStage.from);
      const spanFrom = offset == null ? anchor : (MILESTONE_INDEX[runningStage.from] < anchorIdx ? anchor : runningStage.from);
      const off = offset == null ? 0 : offset;
      running = {
        code: runningStage.code, from: spanFrom, to: next || 'warehouseEntry',
        days: Math.max(0, Math.round(elapsed - off)), mean: Math.round(Math.max(0, expectedGap - off)),
      };
    }
    const gapSd = next ? spanSd(anchor, next) : (group.remaining[anchor] && Number.isFinite(group.remaining[anchor].sd) ? group.remaining[anchor].sd : null);

    // Aşama sapmaları (yalnız kritik yol, ortalamaya göre).
    const stages = STAGES.map(st => {
      const a = actual[st.from], b = actual[st.to];
      const ref = group.stages[st.code] && Number.isFinite(group.stages[st.code].mean) ? group.stages[st.code].mean : null;
      const refDays = ref == null ? null : Math.round(ref);
      if (a != null && b != null) {
        const days = b - a;
        // Gerçekleşen tam gün − yuvarlanmış ortalama: gösterilen iki sayının farkı.
        return { code: st.code, status: 'done', days, mean: ref == null ? null : Math.round(ref), deviation: ref == null ? null : days - Math.round(ref) };
      }
      // Durumla geçildiği bilinen ya da çapanın gerisinde kalan adım: tarihsiz ama tamam.
      if (MILESTONE_INDEX[st.to] <= floorIdx) return { code: st.code, status: 'done', days: null, mean: refDays, deviation: null };
      if (running && st.code === running.code) {
        return { code: st.code, status: 'running', days: running.days, mean: running.mean, deviation: openOverrun > 0 ? openOverrun : null };
      }
      return { code: st.code, status: 'pending', days: null, mean: refDays, deviation: null };
    });
    const currentStage = running ? running.code : null;
    /* σ cinsinden açık gecikme: koşan aralıkta geçen gün beklenen süreyi kaç
       standart sapma aşıyor. Beklenen içinde / planlı adımda 0; σ yoksa null —
       uydurma eşik üretilmez. σ en az 0,5 gün alınır. */
    let overrunSigma = null;
    if (next ? planned[next] != null : plan) overrunSigma = 0;
    else if (gapSd != null) overrunSigma = openOverrun > 0 ? round(openOverrun / Math.max(0.5, gapSd)) : 0;

    /* Farkın kaynakları (ortalama, Handover'dan): Aşama ETA'sı = Handover +
       model ortalaması (base) + kalemler. Kalemler kümülatif yuvarlanır; toplamı
       tam olarak etaMean − Handover'dır. done: iki gerçekleşen tarih arası
       gerçek süre − beklenen; plan: planlı tarih (gemi tarifesi) etkisi;
       overrun: açık aşım; today: henüz varmadı (en erken bugün). */
    let drivers = null;
    if (actual.handover != null && group.remaining.handover) {
      const H = actual.handover, items = [];
      let cur = H + rem('handover', 'mean'), shown = Math.round(cur);
      const push = (kind, next, extra) => {
        const r = Math.round(next), days = r - shown;
        if (days !== 0) items.push({ kind, days, ...extra });
        cur = next; shown = r;
      };
      let prev = 'handover';
      for (let i = MILESTONE_INDEX.handover + 1; i <= anchorIdx; i += 1) {
        const m = MILESTONES[i];
        if (actual[m] == null || !group.remaining[m]) continue;
        push('done', actual[m] + rem(m, 'mean'), { from: prev, to: m, actual: actual[m] - actual[prev], expected: round(rem(prev, 'mean') - rem(m, 'mean')) });
        prev = m;
      }
      if (plan) push('plan', planned[plan] + rem(plan, 'mean'), { milestone: plan });
      if (etaMean !== shown) push(openOverrun > 0 ? 'overrun' : 'today', etaMean, openOverrun > 0 ? { stage: currentStage } : {});
      drivers = { base: Math.round(H + rem('handover', 'mean')) - H, items };
    }

    // Paralel kol: evrak ETA'dan sonra teslim edildiyse gümrüğü bekletebilir.
    const docDate = dayOrdinal(raw.documentDelivery);
    const etaDate = actual.eta != null ? actual.eta : planned.eta;
    const docsLateDays = docDate != null && etaDate != null && docDate > etaDate ? docDate - etaDate : 0;

    /* Açık aşım varken varış en erken bugün + Kalan(sıradaki adım): olasılık bu
       alt sınırın dağılımıyla da sınırlanır (aksi halde ETA geç derken olasılık
       "kesin yetişir" diyebilirdi). */
    const probability = target => {
      const base = probabilityBase(target);
      const t = dayOrdinal(target);
      const nd = next ? group.remaining[next] : null;
      if (!(openOverrun > 0) || !nd || !Array.isArray(nd.q) || nd.n < MIN_PROBABILITY_SAMPLE || t == null || today == null) return base;
      const pNext = round(cdf(nd.q, t - today), 3);
      return base == null ? pNext : Math.min(base, pNext);
    };
    const probabilityBase = target => {
      const t = dayOrdinal(target);
      const dist = plan ? group.remaining[plan] : group.remaining[anchor];
      if (t == null || !dist || !dist.q || dist.n < MIN_PROBABILITY_SAMPLE) return null;
      const base = plan ? planned[plan] : anchorDate;
      const slack = t - base;
      if (plan) return round(cdf(dist.q, slack), 3);
      const passed = Math.max(0, elapsed);
      const survived = 1 - cdf(dist.q, passed - 0.5);
      if (!(survived > 0.001)) return slack >= passed ? null : 0;
      if (slack < passed) return 0;
      return round(Math.max(0, Math.min(1, (cdf(dist.q, slack) - cdf(dist.q, passed - 0.5)) / survived)), 3);
    };

    return {
      anchor, anchorDate: isoFromOrdinal(anchorDate), plan, planDate: plan ? isoFromOrdinal(planned[plan]) : null,
      next, currentStage, elapsedDays: elapsed, openOverrunDays: openOverrun, overrunSigma,
      etaMean: isoFromOrdinal(etaMean), etaP80: isoFromOrdinal(etaP80),
      baselineEta: isoFromOrdinal(baseline),
      // + : plansız temel çizgiye göre erken (kazanç), − : geç.
      gainDays: baseline != null ? baseline - etaMean : null,
      docsLateDays,
      sample: dist0(group, plan || anchor), scope: group.scope,
      stages, running, probability, drivers,
    };
  }
  function dist0(group, m) { return group.remaining[m] ? group.remaining[m].n : 0; }

  /* Backlog satırına taşınacak sıkıştırılmış şekil (fonksiyon yok, JSON güvenli). */
  function compact(projection, targets = {}) {
    if (!projection) return null;
    return {
      v: VERSION,
      anchor: projection.anchor, anchorDate: projection.anchorDate,
      plan: projection.plan, planDate: projection.planDate,
      currentStage: projection.currentStage, openOverrunDays: projection.openOverrunDays, overrunSigma: projection.overrunSigma,
      etaMean: projection.etaMean, etaP80: projection.etaP80,
      baselineEta: projection.baselineEta, gainDays: projection.gainDays,
      docsLateDays: projection.docsLateDays, sample: projection.sample, scope: projection.scope,
      pRetail: targets.retail != null ? projection.probability(targets.retail) : null,
      pInStore: targets.inStore != null ? projection.probability(targets.inStore) : null,
      // [kod, gerçekleşen/geçen gün, ortalama, durum d/r/p, sapma]
      stages: projection.stages.map(s => [s.code, s.days, s.mean, s.status === 'done' ? 'd' : s.status === 'running' ? 'r' : 'p', s.deviation]),
      drivers: projection.drivers || null,
      // Koşan aralık: { code, from, to, days, mean } — etiket ve gün aynı aralığı anlatır.
      running: projection.running || null,
    };
  }

  function stageByCode(code) { return STAGES.find(s => s.code === String(code)) || null; }
  function stageLabel(code, lang) { const s = stageByCode(code); return s ? (lang === 'en' ? s.en : s.tr) : ''; }
  function milestoneLabel(m, lang) { const pair = MILESTONE_LABELS[m]; return pair ? pair[lang === 'en' ? 1 : 0] : ''; }
  function groupLabel(group, lang) { const pair = GROUP_LABELS[group]; return pair ? pair[lang === 'en' ? 1 : 0] : ''; }

  return {
    VERSION, KIND, MILESTONES, STAGES, STATS, MIN_SAMPLE, MIN_PROBABILITY_SAMPLE, QUANTILES,
    buildModel, normalizeModel, lookup, project, compact, cdf, dayOrdinal, isoFromOrdinal,
    stageByCode, stageLabel, milestoneLabel, groupLabel, countryKey, vehicleKey,
  };
});
