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
    const out = { n: list.length, mean: round(mean), p80: round(quantile(list, 0.8)) };
    if (withQuantiles) out.q = QUANTILES.map(p => round(quantile(list, p / 100)));
    return out;
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
    const rem = (m, stat) => (group.remaining[m] ? group.remaining[m][stat] : null);

    // Planlı kilometre taşı (çapadan sonraki en ileri plan).
    let plan = null;
    for (let i = MILESTONES.length - 2; i > anchorIdx; i -= 1) {
      const m = MILESTONES[i];
      if (planned[m] != null && group.remaining[m]) { plan = m; break; }
    }
    // Bir sonraki ölçülen kilometre taşı (çapadan sonra, kalan dağılımı olan).
    let next = null;
    for (let i = anchorIdx + 1; i < MILESTONES.length - 1; i += 1) {
      const m = MILESTONES[i];
      if (group.remaining[m]) { next = m; break; }
    }
    const elapsed = today != null ? today - anchorDate : 0;
    const expectedGap = next ? Math.max(0, rem(anchor, 'mean') - rem(next, 'mean')) : rem(anchor, 'mean');
    // Sonraki kilometre taşı gelecekte PLANLIYSA (gemi tarifesi) aşama gecikmiş sayılmaz.
    const openOverrun = next && actual[next] == null && planned[next] == null && elapsed > expectedGap ? round(elapsed - expectedGap) : 0;

    const etaFor = stat => {
      let eta = plan ? planned[plan] + rem(plan, stat) : anchorDate + rem(anchor, stat);
      if (openOverrun > 0 && next && today != null) eta = Math.max(eta, today + rem(next, stat));
      // Henüz gerçekleşmemiş varış en erken bugündür.
      if (today != null) eta = Math.max(eta, today);
      return Math.round(eta);
    };
    const etaMean = etaFor('mean');
    const etaP80 = etaFor('p80');

    // Plansız temel çizgi: zincirin ilk ölçülen kilometre taşından ortalama.
    let first = null;
    for (const m of MILESTONES) { if (actual[m] != null && group.remaining[m]) { first = m; break; } }
    const baseline = first ? Math.round(actual[first] + rem(first, 'mean')) : null;

    // Aşama sapmaları (yalnız kritik yol, ortalamaya göre).
    const stages = STAGES.map(st => {
      const a = actual[st.from], b = actual[st.to];
      const ref = group.stages[st.code] ? group.stages[st.code].mean : null;
      if (a != null && b != null) {
        const days = b - a;
        return { code: st.code, status: 'done', days, mean: ref, deviation: ref == null ? null : round(days - ref) };
      }
      if (a != null && b == null) {
        const days = today != null ? today - a : null;
        const over = ref != null && days != null && days > ref ? round(days - ref) : 0;
        return { code: st.code, status: 'running', days, mean: ref, deviation: over > 0 ? over : null };
      }
      return { code: st.code, status: 'pending', days: null, mean: ref, deviation: null };
    });
    // Koşan aşama: çapadan sonraki ilk tamamlanmamış aşama.
    const current = stages.find(s => s.status === 'running' && MILESTONE_INDEX[STAGES.find(x => x.code === s.code).from] === anchorIdx)
      || stages.find(s => s.status === 'running') || null;
    const currentStage = current ? current.code : (next ? (STAGES.find(st => st.to === next) || {}).code || null : null);

    // Paralel kol: evrak ETA'dan sonra teslim edildiyse gümrüğü bekletebilir.
    const docDate = dayOrdinal(raw.documentDelivery);
    const etaDate = actual.eta != null ? actual.eta : planned.eta;
    const docsLateDays = docDate != null && etaDate != null && docDate > etaDate ? docDate - etaDate : 0;

    const probability = target => {
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
      next, currentStage, elapsedDays: elapsed, openOverrunDays: openOverrun,
      etaMean: isoFromOrdinal(etaMean), etaP80: isoFromOrdinal(etaP80),
      baselineEta: isoFromOrdinal(baseline),
      // + : plansız temel çizgiye göre erken (kazanç), − : geç.
      gainDays: baseline != null ? baseline - etaMean : null,
      docsLateDays,
      sample: dist0(group, plan || anchor), scope: group.scope,
      stages, probability,
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
      currentStage: projection.currentStage, openOverrunDays: projection.openOverrunDays,
      etaMean: projection.etaMean, etaP80: projection.etaP80,
      baselineEta: projection.baselineEta, gainDays: projection.gainDays,
      docsLateDays: projection.docsLateDays, sample: projection.sample, scope: projection.scope,
      pRetail: targets.retail != null ? projection.probability(targets.retail) : null,
      pInStore: targets.inStore != null ? projection.probability(targets.inStore) : null,
      // [kod, gerçekleşen/geçen gün, ortalama, durum d/r/p, sapma]
      stages: projection.stages.map(s => [s.code, s.days, s.mean, s.status === 'done' ? 'd' : s.status === 'running' ? 'r' : 'p', s.deviation]),
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
