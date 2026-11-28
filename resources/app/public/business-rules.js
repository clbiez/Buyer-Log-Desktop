/* Buyer Log v2.92 — shared, dependency-free business rules for browser and Node.js */
(function attachBuyerLogBusinessRules(root, factory) {
  const api = factory(typeof module==='object'&&module.exports?require('./chronological-values'):root.BLChronologicalValues);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLBusinessRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBuyerLogBusinessRules(chronology) {
  'use strict';

  const DEFAULT_TRANSIT_DAYS = Object.freeze({
    Gemi: 70,
    'Uçak': 15,
    'Gemi+Uçak': 35,
    'Gemi+Tır': 70,
  });
  const TURKISH_ASCII_MAP = Object.freeze({ 'İ': 'I', 'Ş': 'S', 'Ç': 'C', 'Ö': 'O', 'Ü': 'U', 'Ğ': 'G' });

  function norm(value) {
    return String(value == null ? '' : value).trim();
  }

  // Saf fonksiyon; durum/sınıflandırma kurallarında satır başına çağrılır. Kısa
  // metinler sınırlı bir bellekte tutulur; sonuç birebir aynıdır.
  const TURK_NORM_CACHE = new Map();
  function turkNorm(value) {
    const raw = String(value == null ? '' : value), cacheable = raw.length <= 160;
    if (cacheable) { const hit = TURK_NORM_CACHE.get(raw); if (hit !== undefined) return hit; }
    const normalized = raw
      .toUpperCase()
      .replace(/[İŞÇÖÜĞ]/g, character => TURKISH_ASCII_MAP[character])
      .replace(/\s+/g, ' ')
      .trim();
    if (cacheable) { if (TURK_NORM_CACHE.size >= 50000) TURK_NORM_CACHE.clear(); TURK_NORM_CACHE.set(raw, normalized); }
    return normalized;
  }

  /* Lisansör ad nüansları ("ERMODA" / "ERMODA UK LTD"): şirket türü ve ülke ekleri
     atılınca aynı kalan adlar tek lisansör sayılır. Kullanıcı yanlış bir birleştirmeyi
     ayırabilir (split listesi). Royalty eşleşmesi önce birebir adı, yoksa birleşik adı
     kullanır; böylece iki adın ayrı sözleşmeleri varsa her biri kendi sözleşmesini alır. */
  const LICENSOR_SUFFIX_TOKENS = new Set(['LTD', 'LIMITED', 'LTDSTI', 'STI', 'SIRKETI', 'AS', 'INC', 'INCORPORATED', 'LLC', 'LLP', 'PLC', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'GMBH', 'AG', 'SA', 'SAS', 'SARL', 'SRL', 'SPA', 'BV', 'NV', 'PTY', 'KG', 'OY', 'AB', 'TIC', 'SAN', 'VE', 'UK', 'US', 'USA', 'EU', 'TR']);
  // Pure and called per order row by Non-DTR licensor matching: short names are memoized
  // in a bounded map like turkNorm; the result is identical.
  const LICENSOR_MERGE_KEY_CACHE = new Map();
  function licensorMergeKey(value) {
    const normalized = turkNorm(value), hit = LICENSOR_MERGE_KEY_CACHE.get(normalized);
    if (hit !== undefined) return hit;
    const full = normalized.replace(/[.'’]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
    // Only trailing tokens are suffixes: "AS ROMA" stays itself, "ERMODA UK LTD" → "ERMODA".
    const tokens = full.split(' ').filter(Boolean);
    while (tokens.length > 1 && LICENSOR_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) tokens.pop();
    const key = tokens.join(' ');
    if (normalized.length <= 160) { if (LICENSOR_MERGE_KEY_CACHE.size >= 20000) LICENSOR_MERGE_KEY_CACHE.clear(); LICENSOR_MERGE_KEY_CACHE.set(normalized, key); }
    return key;
  }
  function licensorMergeSplit(merges) {
    // Accepts the API shape {split:[keys]} or the stored shape {entries:{key:{split}}}.
    const entries = merges && merges.entries && typeof merges.entries === 'object' ? merges.entries : null;
    const list = entries ? Object.keys(entries).filter(key => entries[key] && entries[key].split === true && !entries[key].source) : (merges && Array.isArray(merges.split) ? merges.split : []);
    return new Set(list.map(key => licensorMergeKey(key)).filter(Boolean));
  }
  // The automatic suffix group remains the default. Explicit manual links connect
  // two whole groups; split automatic names stay separate unless linked explicitly.
  // Compute the same undirected component on browser and server, independent of order.
  const LICENSOR_GROUP_CACHE=new WeakMap();
  function licensorGroupKey(value, merges) {
    if(!licensorMergeKey(value))return '';
    // Pricing can project thousands of orders: construct the relation graph only
    // once per immutable merge snapshot, then memoize the component per alias.
    const stored=merges&&typeof merges==='object',cache=stored?LICENSOR_GROUP_CACHE.get(merges):null;
    let graph=cache;
    if(!graph){
      const split=licensorMergeSplit(merges),edges=new Map();
      const node=name=>{
        const raw=turkNorm(name),key=licensorMergeKey(raw);
        return split.has(key)?'EXACT:'+raw:'AUTO:'+key;
      };
      for(const entry of Object.values(merges?.entries||{})){
        if(!entry||!entry.source||!entry.target||entry.split===true)continue;
        const left=node(entry.source),right=node(entry.target);
        if(left===right)continue;
        if(!edges.has(left))edges.set(left,new Set());
        if(!edges.has(right))edges.set(right,new Set());
        edges.get(left).add(right);edges.get(right).add(left);
      }
      graph={node,edges,components:new Map()};
      if(stored)LICENSOR_GROUP_CACHE.set(merges,graph);
    }
    const initial=graph.node(value);
    if(graph.components.has(initial))return graph.components.get(initial);
    const seen=new Set([initial]),queue=[initial];
    for(let i=0;i<queue.length;i++)for(const next of graph.edges.get(queue[i])||[]){
      if(!seen.has(next)){seen.add(next);queue.push(next);}
    }
    const representative=[...seen].sort()[0];
    for(const item of seen)graph.components.set(item,representative);
    return representative;
  }
  function licensorsMerged(a, b, merges) {
    const left=turkNorm(a),right=turkNorm(b);
    return Boolean(left&&right)&&(left===right||licensorGroupKey(a,merges)===licensorGroupKey(b,merges));
  }
  // True when the licensor has any contract of its own for the license (any date/season).
  function licensorHasOwnRules(rules, licensor, license, licensorOf = rule => rule && rule.licensor) {
    return (Array.isArray(rules) ? rules : []).some(rule => turkNorm(licensorOf(rule)) === turkNorm(licensor) && turkNorm(rule && rule.license) === turkNorm(license));
  }
  // Exact licensor first. A merged licensor name is used only when the order's own name has
  // no contract at all for the license: its own expired/other-season contract stays "missing".
  function findRuleByLicensor(rules, licensor, matches, merges, licensorOf = rule => rule && rule.licensor, license = null) {
    const list = Array.isArray(rules) ? rules : [];
    const exact = list.find(rule => matches(rule) && turkNorm(licensorOf(rule)) === turkNorm(licensor));
    if (exact || !turkNorm(licensor)) return exact || null;
    if (license != null && licensorHasOwnRules(list, licensor, license, licensorOf)) return null;
    return list.find(rule => matches(rule) && licensorsMerged(licensor, licensorOf(rule), merges)) || null;
  }

  /* CP/Backlog status hücreleri yalnız yalın enum değildir. Gerçek veride
     "Loading Operations 5.003" gibi miktar suffix'leri ve
     "Loading Operations 773 | In Transit 1.390" gibi birden fazla aşamanın
     aynı hücrede birleştiği değerler bulunur. Status sınıflandırması bu display
     miktarlarından etkilenmemeli; bütün tüketiciler aynı canonical stage'i
     görmelidir. */
  const OPERATIONAL_STAGE_ALIASES = Object.freeze({
    PRODUCTION: Object.freeze(['URETIMDE', 'URETIM', 'PRODUCTION', 'IN PRODUCTION']),
    LOADING: Object.freeze(['YUKLEME OPERASYONLARI', 'LOADING OPERATIONS']),
    IN_TRANSIT: Object.freeze(['YOL OPERASYONLARI', 'YOLDA', 'IN TRANSIT']),
    // Kaynak İngilizce "Customs & Port Operations" ve boşluklu tire de gönderebiliyor;
    // bunlar eskiden UNKNOWN sınıflanıyordu (gümrükteki sipariş üretim sonrası sayılmıyordu).
    CUSTOMS: Object.freeze(['GUMRUK-LIMAN OPERASYONLARI', 'GUMRUK LIMAN OPERASYONLARI', 'GUMRUK - LIMAN OPERASYONLARI', 'CUSTOMS & PORT OPERATIONS', 'CUSTOMS AND PORT OPERATIONS', 'CUSTOMS & PORT', 'CUSTOMS AND PORT', 'CUSTOMS']),
    IN_WAREHOUSE: Object.freeze(['DEPODA', 'IN WAREHOUSE']),
    AWAITING_RETAIL_TRANSFER: Object.freeze(['RETAILE AKTARIM BEKLENIYOR', 'RETAILE AKTARIM BEKLIYOR', 'AWAITING RETAIL TRANSFER']),
    SHORTAGE: Object.freeze(['EKSIK YUKLEME', 'SHORTAGE', 'DEPODA - EKSIK YUKLEME', 'DEPODA EKSIK YUKLEME', 'IN WAREHOUSE - SHORTAGE', 'IN WAREHOUSE SHORTAGE']),
  });
  const OPERATIONAL_STAGE_RANK = Object.freeze({
    UNKNOWN: 0,
    PRODUCTION: 10,
    LOADING: 20,
    IN_TRANSIT: 30,
    CUSTOMS: 40,
    IN_WAREHOUSE: 50,
    AWAITING_RETAIL_TRANSFER: 60,
    // Shortage bir progression stage değil operasyonel istisnadır; görünürse
    // mevcut business davranışı korunarak öncelikli sınıflandırılır.
    SHORTAGE: 100,
  });
  const OPERATIONAL_STAGE_ALIAS_ENTRIES = Object.freeze(Object.entries(OPERATIONAL_STAGE_ALIASES));

  function isStatusQuantitySuffix(value) {
    const suffix = String(value == null ? '' : value).trim();
    return /^\d[\d.,\s]*$/.test(suffix);
  }

  function statusSegmentMatchesAlias(segment, alias) {
    if (segment === alias) return true;
    if (!segment.startsWith(`${alias} `)) return false;
    return isStatusQuantitySuffix(segment.slice(alias.length + 1));
  }

  function operationalStageForSegment(value) {
    const segment = turkNorm(value);
    if (!segment) return 'UNKNOWN';
    // Legacy production status'larında alt aşama metni suffix olarak gelir
    // ("Üretimde - Kesimde", "Üretimde/Planlama"). Bu davranış isProductionStatus
    // için yıllardır destekleniyor; canonical stage helper bunu kaybetmemeli.
    if (segment === 'URETIMDE' || segment.startsWith('URETIMDE ') || segment.startsWith('URETIMDE-') || segment.startsWith('URETIMDE/')) return 'PRODUCTION';
    if (segment === 'PRODUCTION' || segment.startsWith('PRODUCTION ') || segment.startsWith('PRODUCTION-') || segment.startsWith('PRODUCTION/')) return 'PRODUCTION';
    if (segment === 'IN PRODUCTION' || segment.startsWith('IN PRODUCTION ') || segment.startsWith('IN PRODUCTION-') || segment.startsWith('IN PRODUCTION/')) return 'PRODUCTION';
    for (const [stage, aliases] of OPERATIONAL_STAGE_ALIAS_ENTRIES) {
      if (aliases.some(alias => statusSegmentMatchesAlias(segment, alias))) return stage;
    }
    return 'UNKNOWN';
  }

  function operationalStageOf(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return 'UNKNOWN';
    const segments = /[|;\n]/.test(raw)
      ? raw.split(/[|;\n]+/).map(part => part.trim()).filter(Boolean)
      : [raw];
    let best = 'UNKNOWN';
    for (const segment of segments.length ? segments : [raw]) {
      const stage = operationalStageForSegment(segment);
      if ((OPERATIONAL_STAGE_RANK[stage] || 0) > (OPERATIONAL_STAGE_RANK[best] || 0)) best = stage;
    }
    return best;
  }

  /* Birincil lojistik segment: CP / Siparişler satırının ana STATUS, Del. Type, Ant. Arrival ve
     HANDOVER değerini veren segment. TEK TANIM: parse.js (tam kurulum), okuma modeli hazırlığı
     (overview-row-prep) ve istemci (app-main rebuildCpLogisticCaches) bu fonksiyonu kullanır.
     Ürün sahibi kuralı (ADR-0003 §6O.c):
       A) Miktarı 0 olan üretim aşaması segmenti tek başına üretim bakiyesi değildir.
       B) Eksik Yükleme ayrı istisnadır; seçilmez, aşamaya dönüştürülmez (başka segment yoksa yalnız o).
       C) Üretim bakiyesi yoksa tamamlanmamış lojistik aşama depodan önce gelir.
       D) Operasyonel olarak en geride kalan tamamlanmamış aşama seçilir.
     Aynı aşamada: en erken varış → üretim bakiyesi → parsiyel no. Dizinin sırasından bağımsızdır.
     Depoda ve Retaile Aktarım Bekleniyor aynı depo katmanıdır; bilinmeyen IAS statüsü (ör. "Yüklemede")
     yükleme katmanında sayılır. Girdi parse.js cpLogisticSegmentsForOrder biçimidir
     ({ kind, status, quantity, arrival, partialNo }); segmentlerin kendisi değiştirilmez. */
  const PRIMARY_SEGMENT_STAGE_RANK = Object.freeze({
    PRODUCTION: 10, UNKNOWN: 20, LOADING: 20, IN_TRANSIT: 30, CUSTOMS: 40, IN_WAREHOUSE: 50, AWAITING_RETAIL_TRANSFER: 50,
  });
  const PRIMARY_SEGMENT_KIND_ORDER = Object.freeze({ production: 0, partial: 1, shortage: 2 });
  // IAS'ta yalnız birkaç statü metni vardır; satır başına yeniden normalleştirilmez (sıcak yol, ölçüldü).
  const PRIMARY_SEGMENT_STAGE_CACHE = new Map();
  function primarySegmentStage(status) {
    if (typeof status !== 'string') return operationalStageOf(status);
    let stage = PRIMARY_SEGMENT_STAGE_CACHE.get(status);
    if (stage === undefined) {
      stage = operationalStageOf(status);
      if (PRIMARY_SEGMENT_STAGE_CACHE.size < 5000) PRIMARY_SEGMENT_STAGE_CACHE.set(status, stage);
    }
    return stage;
  }
  function primarySegmentRank(segment) {
    if (!segment || typeof segment !== 'object' || segment.kind === 'shortage') return null;
    const stage = segment.kind === 'production' ? 'PRODUCTION' : primarySegmentStage(segment.status);
    if (stage === 'SHORTAGE') return null;
    if (stage === 'PRODUCTION' && !(Number(segment.quantity) > 0)) return null;
    return Object.prototype.hasOwnProperty.call(PRIMARY_SEGMENT_STAGE_RANK, stage) ? PRIMARY_SEGMENT_STAGE_RANK[stage] : PRIMARY_SEGMENT_STAGE_RANK.UNKNOWN;
  }
  function comparePrimarySegmentTies(a, b) {
    const aDate = defaultDateOrdinal(a.arrival), bDate = defaultDateOrdinal(b.arrival);
    if (aDate !== bDate) {
      if (aDate == null) return 1;
      if (bDate == null) return -1;
      return aDate - bDate;
    }
    const kindDiff = (PRIMARY_SEGMENT_KIND_ORDER[a.kind] ?? 1) - (PRIMARY_SEGMENT_KIND_ORDER[b.kind] ?? 1);
    if (kindDiff) return kindDiff;
    return (Number(a.partialNo) || 0) - (Number(b.partialNo) || 0);
  }
  function selectPrimaryLogisticSegment(segments) {
    const list = Array.isArray(segments) ? segments : [];
    let best = null, bestRank = null;
    for (const segment of list) {
      const rank = primarySegmentRank(segment);
      if (rank == null) continue;
      if (best == null || rank < bestRank || (rank === bestRank && comparePrimarySegmentTies(segment, best) < 0)) { best = segment; bestRank = rank; }
    }
    if (best) return best;
    // Seçilebilir aşama yoksa (yalnız 0 adetlik üretim ya da yalnız kıtlık): önce kıtlık dışı segment.
    const objects = list.filter(segment => segment && typeof segment === 'object');
    const pickFirst = items => items.reduce((winner, segment) => (winner == null || comparePrimarySegmentTies(segment, winner) < 0 ? segment : winner), null);
    return pickFirst(objects.filter(segment => segment.kind !== 'shortage')) || pickFirst(objects);
  }

  function isProductionStatus(value) {
    return operationalStageOf(value) === 'PRODUCTION';
  }

  function isShortageStatus(value) {
    return operationalStageOf(value) === 'SHORTAGE';
  }

  function isWarehouseShortageStatus(value) {
    const key = turkNorm(value);
    return ['DEPODA - EKSIK YUKLEME', 'DEPODA EKSIK YUKLEME', 'IN WAREHOUSE - SHORTAGE', 'IN WAREHOUSE SHORTAGE']
      .some(alias => statusSegmentMatchesAlias(key, alias));
  }

  function manufacturerKey(value) {
    return turkNorm(value);
  }

  function normalizeManufacturerList(value) {
    return normalizeList(value, manufacturerKey);
  }

  function isNonDtrManufacturer(manufacturer, manufacturers) {
    const key = manufacturerKey(manufacturer);
    if (!key) return false;
    return normalizeManufacturerList(manufacturers).some(item => manufacturerKey(item) === key);
  }

  // LFL policy: the maintained manufacturer list is the single classification source.
  // A listed manufacturer is NON-DTR; every other order is DTR.
  function classifyDtrByManufacturer(manufacturer, manufacturers) {
    return isNonDtrManufacturer(manufacturer, manufacturers) ? 'NON-DTR' : 'DTR';
  }

  /* Yol süresi kuralları IAS'taki taşıt sözlüğünü sınırlamaz.
     Dört tarihsel Buyer Log tipi alias'larıyla kanonik kalır; bunun dışındaki
     bütün dolu IAS taşıt adları kendi kimliğiyle korunur. Böylece Kamyon,
     Tır, Truck+Air, Rail, Kurye, Direkt Sevkiyat vb. tipler birbirine
     katlanmadan ayrı ayrı kural alabilir. */
  function normalizeTransitDelType(value) {
    const raw = norm(value).replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ');
    if (!raw) return '';
    const key = turkNorm(raw).replace(/\s+/g, '');
    const hasShip = key.includes('GEMI') || key.includes('SEA') || key.includes('SHIP');
    const hasAir = key.includes('UCAK') || key.includes('AIR');
    const hasTruck = key.includes('TIR') || key.includes('TRUCK');
    if (hasShip && hasAir && !hasTruck) return 'Gemi+Uçak';
    if (hasShip && hasTruck && !hasAir) return 'Gemi+Tır';
    if (hasAir && !hasShip && !hasTruck) return 'Uçak';
    if (hasShip && !hasAir && !hasTruck) return 'Gemi';
    return raw;
  }

  function transitDelTypeKey(value) {
    const normalized = normalizeTransitDelType(value);
    return normalized ? turkNorm(normalized).replace(/\s+/g, '') : '';
  }

  function transitCountryKey(value) {
    const key = turkNorm(value);
    const aliases = {
      TR: 'TURKEY', TURKIYE: 'TURKEY', TURKEY: 'TURKEY',
      HINDISTAN: 'INDIA', INDIA: 'INDIA',
      BANGLADES: 'BANGLADESH', BANGLADESH: 'BANGLADESH',
      CIN: 'CHINA', CHINA: 'CHINA',
      MISIR: 'EGYPT', EGYPT: 'EGYPT',
      FAS: 'MOROCCO', MOROCCO: 'MOROCCO',
      ENDONEZYA: 'INDONESIA', INDONESIA: 'INDONESIA',
      MYANMAR: 'MYANMAR',
      PAKISTAN: 'PAKISTAN',
      KAMBOCYA: 'CAMBODIA', CAMBODIA: 'CAMBODIA',
      RUANDA: 'RWANDA', RWANDA: 'RWANDA',
      VIETNAM: 'VIETNAM', 'VIET NAM': 'VIETNAM',
    };
    return aliases[key] || key;
  }

  function normalizeList(value, keyFn = turkNorm) {
    const source = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
    const seen = new Set();
    const output = [];
    for (const item of source) {
      const text = norm(item);
      const key = keyFn(text);
      if (text && key && !seen.has(key)) {
        seen.add(key);
        output.push(text);
      }
    }
    return output.sort((a, b) => a.localeCompare(b, 'tr'));
  }

  function defaultDateOrdinal(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (match) return Math.trunc(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
    }
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.trunc(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  // License Royalty Calculations'ta tarih grubu seçerken JavaScript'in geçersiz
  // tarihleri sessizce normalize etmesine izin verme. Boş tarih açık uçlu,
  // biçimi bozuk tarih ise geçersiz kayıt kabul edilir.
  function validRuleDate(value) {
    const text = norm(value);
    if (!text) return { ordinal: null, invalid: false };
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
      return valid ? { ordinal: Math.trunc(date.getTime() / 86400000), invalid: false } : { ordinal: null, invalid: true };
    }
    const ordinal = defaultDateOrdinal(value);
    return ordinal == null ? { ordinal: null, invalid: true } : { ordinal, invalid: false };
  }

  // Collection'ın Licensor otomasyonu için ortak, exact ve tarih-grubu bazlı
  // çözüm. Kuralın ülke/sezon eşleştirmesi bu fonksiyonun sorumluluğunda
  // değildir; yalnız License → en yeni geçerli tarih grubu → Licensor zincirini
  // çözer. Kaynaktaki ilk yazım korunur, yalnız gösterim sıralanır.
  function resolveLatestLicensorsForLicense(license, rules) {
    const wanted = norm(license);
    const wantedKey = turkNorm(wanted);
    const empty = { license: wanted, latestDate: '', licensors: [], ambiguous: false, licensorsLabel: '', displayValue: '' };
    if (!wantedKey) return empty;
    // Only this license's contracts are date-parsed (same subset, same order as filtering after).
    const candidates = rulesForLicense(rules, wantedKey).map(rule => {
      const start = validRuleDate(rule && rule.opdStart);
      const end = validRuleDate(rule && rule.opdEnd);
      return { rule, start, end };
    }).filter(item => {
      const rule = item.rule || {};
      return turkNorm(norm(rule.license)) === wantedKey
        && norm(rule.licensor)
        && !item.start.invalid && !item.end.invalid;
    });
    if (!candidates.length) return empty;
    const freshness = item => [item.start.ordinal == null ? -Infinity : item.start.ordinal, item.end.ordinal == null ? -Infinity : item.end.ordinal];
    let latest = candidates[0];
    for (let index = 1; index < candidates.length; index += 1) {
      const current = candidates[index], left = freshness(current), right = freshness(latest);
      if (left[0] > right[0] || (left[0] === right[0] && left[1] > right[1])) latest = current;
    }
    const latestStart = latest.start.ordinal, latestEnd = latest.end.ordinal;
    const latestGroup = candidates.filter(item => item.start.ordinal === latestStart && item.end.ordinal === latestEnd);
    const licensors = normalizeList(latestGroup.map(item => item.rule.licensor), turkNorm);
    // Aynı Licensor'ı gösteren birden çok kural belirsizlik değildir; belirsizlik
    // yalnız DISTINCT Licensor sayısı > 1 olduğunda oluşur. Belirsiz durumda otomatik
    // değer ÜRETİLMEZ: eskiden 'DTR/Y' gibi birleşik bir Licensor yazılıyordu ve satır
    // hem çözülmüş görünüyor hem de DTR benzeri komisyonsuz FOB'a düşebiliyordu.
    const ambiguous = licensors.length > 1;
    return {
      license: wanted,
      latestDate: norm(latest.rule.opdStart) || norm(latest.rule.opdEnd) || '',
      licensors,
      ambiguous,
      licensorsLabel: licensors.join(' / '),
      displayValue: ambiguous ? '' : (licensors[0] || ''),
    };
  }

  // License → Licensor bağımlılığının tek durum sözleşmesi. Boş License için
  // Licensor hiçbir zaman varsayılan/placeholder değer almaz; dolu License ise
  // yalnız geçerli tarih aralığı ve dolu Licensor içeren bir License Royalty
  // kuralından çözülebilir. Bu saf yardımcı browser ve Node tarafında aynıdır.
  function resolveLicenseLicensor(license, rules) {
    const resolved = resolveLatestLicensorsForLicense(license, rules);
    const hasLicense = Boolean(turkNorm(norm(license)));
    if (!hasLicense) {
      return { ...resolved, hasLicense: false, hasRule: false, status: 'empty' };
    }
    if (resolved.ambiguous) {
      // Kural var ama hangisinin geçerli olduğu belli değil: otomatik Licensor,
      // royalty ve FOB durur, açık Licensor seçimi beklenir.
      return { ...resolved, hasLicense: true, hasRule: true, status: 'ambiguous' };
    }
    if (resolved.displayValue) {
      return { ...resolved, hasLicense: true, hasRule: true, status: 'resolved' };
    }
    return { ...resolved, hasLicense: true, hasRule: false, status: 'missing-rule' };
  }

  // Otomatik Licensor atamanın tek kapısı. NON-DTR MANUFACTURERS listesi DTR
  // sınıflandırmasının tek doğruluk kaynağıdır: listedeki bir üretici için otomatik
  // DTR yazılmaz, Licensor açık seçim bekler. Manuel seçim bu fonksiyonun
  // üstündedir ve çağıranları tarafından korunur.
  function resolveAutoLicensor(license, rules, options) {
    const opts = options || {};
    const state = resolveLicenseLicensor(license, rules);
    if (state.status !== 'resolved') return state;
    if (turkNorm(state.displayValue) !== 'DTR') return state;
    if (!isNonDtrManufacturer(opts.manufacturer, opts.nonDtrManufacturers)) return state;
    return { ...state, displayValue: '', status: 'manufacturer-conflict' };
  }

  // v7.0.340 — License Royalty sözleşmesi olan ve bu sözleşmelerin HİÇBİRİ DTR
  // lisansörlü olmayan lisans (ör. Formula 1 → FASHION UK) lisansör/ajans
  // üzerinden sipariş edilir. Üretici NON-DTR listesine eklenmemiş olsa bile bu
  // lisansın siparişi otomatik DTR sayılmaz; aksi halde Supp. FOB = FOB olur ve
  // royalty sessizce düşülmez. Tarih/sezon fark etmez: sınıflandırma lisansın
  // sözleşme yapısından gelir. Sözleşmesi olmayan veya DTR sözleşmesi bulunan
  // lisanslarda üretici listesi tek kaynak olmaya devam eder.
  function licenseHasOnlyNonDtrContracts(license, rules) {
    const wanted = turkNorm(norm(license));
    if (!wanted) return false;
    let found = false;
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!rule || typeof rule !== 'object' || turkNorm(norm(rule.license)) !== wanted) continue;
      const licensor = turkNorm(norm(rule.licensor != null ? rule.licensor : rule.manufacturer));
      if (!licensor) continue;
      if (licensor === 'DTR') return false;
      found = true;
    }
    return found;
  }

  /* Non-DTR üretici lisansörün kendi carisidir: aynı firma TR carisiyle üretici
     ("FAN MANİA DIŞ TİCARET LTD. ŞTİ."), YD carisiyle sözleşme lisansörü ("FAN MANIA",
     "Fan Mania General Trading L.L.C") olarak görünür. Eşleşme: Lisans Kartları'ndaki
     birleştirme (otomatik ek grubu veya manuel bağ) ya da lisansör adının, hukuki ek
     atılmış hâliyle, üretici adının baş kelimeleri olması ("ERMODA" → "ERMODA TEKSTİL
     KONFEKSİYON") ve o lisansörün birleştirme grubu (ERMODA ≡ ERMODA UK LTD). DTR
     hiçbir zaman üreticiden türetilmez. */
  const LICENSOR_LEGAL_FORM_TOKENS = new Set([...LICENSOR_SUFFIX_TOKENS].filter(token => !['UK', 'US', 'USA', 'EU', 'TR'].includes(token)));
  const LICENSOR_TOKEN_CACHE = new Map();
  function licensorNameTokens(value, stripLegalForm) {
    const raw = turkNorm(value), id = (stripLegalForm ? '1' : '0') + raw, hit = LICENSOR_TOKEN_CACHE.get(id);
    if (hit) return hit;
    const tokens = raw.replace(/[.'’]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    if (stripLegalForm) while (tokens.length > 1 && LICENSOR_LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1])) tokens.pop();
    if (LICENSOR_TOKEN_CACHE.size >= 20000) LICENSOR_TOKEN_CACHE.clear();
    LICENSOR_TOKEN_CACHE.set(id, tokens);
    return tokens;
  }
  function manufacturerMatchesLicensor(manufacturer, licensor, merges) {
    if (!manufacturerKey(manufacturer) || !turkNorm(licensor) || turkNorm(licensor) === 'DTR') return false;
    if (licensorsMerged(manufacturer, licensor, merges)) return true;
    const own = licensorNameTokens(licensor, true), maker = licensorNameTokens(manufacturer, false);
    return own.join(' ').length >= 3 && own.length <= maker.length && own.every((token, index) => maker[index] === token);
  }
  // Rule references grouped by license key, per immutable rules array (derived, never stored).
  // Row resolution over 30k orders scans only the license's own contracts; fields stay live.
  const RULE_INDEX = new WeakMap(), NO_MERGES = Object.freeze({});
  function ruleIndex(rules) {
    let index = RULE_INDEX.get(rules);
    if (!index || index.size !== rules.length) {
      index = { size: rules.length, byLicense: new Map(), licensors: new Map(), makers: new WeakMap() };
      for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue;
        const key = turkNorm(norm(rule.license)), name = norm(rule.licensor), nameKey = turkNorm(name);
        if (!index.byLicense.has(key)) index.byLicense.set(key, []);
        index.byLicense.get(key).push(rule);
        if (nameKey && !index.licensors.has(nameKey)) index.licensors.set(nameKey, name);
      }
      RULE_INDEX.set(rules, index);
    }
    return index;
  }
  function rulesForLicense(rules, wanted) {
    if (!Array.isArray(rules)) return [];
    return (ruleIndex(rules).byLicense.get(wanted) || []).filter(rule => turkNorm(norm(rule.license)) === wanted);
  }
  // The licensor groups (merge components) the manufacturer belongs to: its own group (a card
  // merge) plus the group of every contract licensor that matches it by name. "ERMODA" matches
  // "ERMODA TEKSTİL", so "ERMODA UK LTD" (same automatic group as ERMODA) is the same company.
  function manufacturerLicensorGroups(rules, manufacturer, merges) {
    const index = ruleIndex(rules), mergeKey = merges && typeof merges === 'object' ? merges : NO_MERGES;
    let byMaker = index.makers.get(mergeKey);
    if (!byMaker) { byMaker = new Map(); index.makers.set(mergeKey, byMaker); }
    const key = manufacturerKey(manufacturer), hit = byMaker.get(key);
    if (hit) return hit;
    const groups = new Set([licensorGroupKey(manufacturer, merges)]);
    for (const name of index.licensors.values()) if (manufacturerMatchesLicensor(manufacturer, name, merges)) groups.add(licensorGroupKey(name, merges));
    if (byMaker.size >= 5000) byMaker.clear();
    byMaker.set(key, groups);
    return groups;
  }
  // Lisansın sözleşme lisansörlerinden Non-DTR üreticiyle aynı firma olanı. Farklı
  // firmalara eşleşirse (iki ayrı birleştirme grubu) tahmin yapılmaz: null.
  // nonDtr: the caller's isNonDtrManufacturer result (the list is normalized once per row);
  // latest() lazily gives the rule-based state, needed only to rank several names.
  function resolveManufacturerLicensor(license, rules, options, latest, nonDtr) {
    const opts = options || {}, wanted = turkNorm(norm(license));
    if (!wanted || !nonDtr) return null;
    const own = rulesForLicense(rules, wanted);
    if (!own.length) return null;
    const makerGroups = manufacturerLicensorGroups(rules, opts.manufacturer, opts.licensorMerges);
    const names = new Map(), matched = new Map();
    for (const rule of own) {
      const name = norm(rule.licensor), key = turkNorm(name);
      if (!key || key === 'DTR') continue;
      if (!matched.has(key)) matched.set(key, makerGroups.has(licensorGroupKey(name, opts.licensorMerges)));
      if (!matched.get(key)) continue;
      const start = validRuleDate(rule.opdStart), end = validRuleDate(rule.opdEnd);
      if (start.invalid || end.invalid) continue;
      const fresh = [start.ordinal == null ? -Infinity : start.ordinal, end.ordinal == null ? -Infinity : end.ordinal];
      const prior = names.get(key);
      if (!prior || fresh[0] > prior.fresh[0] || (fresh[0] === prior.fresh[0] && fresh[1] > prior.fresh[1])) names.set(key, { name: prior ? prior.name : name, fresh, date: norm(rule.opdStart) || norm(rule.opdEnd) || '' });
    }
    if (!names.size) return null;
    const groups = new Set([...names.values()].map(item => licensorGroupKey(item.name, opts.licensorMerges)));
    if (groups.size > 1) return null;
    // Several names of one company: the manufacturer's own name, then the latest contract group.
    const self = turkNorm(opts.manufacturer), current = new Set(names.size > 1 && typeof latest === 'function' ? (latest().licensors || []).map(turkNorm) : []);
    const rank = item => [turkNorm(item.name) === self ? 1 : 0, current.has(turkNorm(item.name)) ? 1 : 0, item.fresh[0], item.fresh[1]];
    const chosen = [...names.values()].sort((a, b) => {
      const x = rank(a), y = rank(b);
      for (let index = 0; index < x.length; index += 1) if (x[index] !== y[index]) return y[index] > x[index] ? 1 : -1;
      return turkNorm(a.name).localeCompare(turkNorm(b.name));
    })[0];
    return {
      license: norm(license), latestDate: chosen.date, licensors: [chosen.name], ambiguous: false,
      licensorsLabel: chosen.name, displayValue: chosen.name, hasLicense: true, hasRule: true, status: 'resolved', source: 'manufacturer',
    };
  }

  // Orders use the manufacturer card's DTR classification before royalty rules,
  // unless every royalty contract of the license names a non-DTR licensor.
  // A Non-DTR manufacturer that is the same company as one of the license's contract
  // licensors decides the Licensor (options.licensorMerges carries the card merges).
  // Collection models keep their separate license-based selection policy.
  // Explicit source values and manual overrides are preserved by callers.
  function resolveOrderLicensor(license, rules, options) {
    const opts = options || {};
    const nonDtr = Boolean(norm(license) && manufacturerKey(opts.manufacturer) && isNonDtrManufacturer(opts.manufacturer, opts.nonDtrManufacturers));
    if (norm(license) && manufacturerKey(opts.manufacturer) && !nonDtr
      && !licenseHasOnlyNonDtrContracts(license, rules)) {
      return {
        license: norm(license), latestDate: '', licensors: ['DTR'], ambiguous: false,
        licensorsLabel: 'DTR', displayValue: 'DTR', hasLicense: true, hasRule: false, status: 'resolved',
      };
    }
    let state = null;
    const latest = () => state || (state = resolveAutoLicensor(license, rules, opts));
    return resolveManufacturerLicensor(license, rules, opts, latest, nonDtr) || latest();
  }

  // Otomatik çözümün değer üretemediği, fakat kuralın da eksik olmadığı
  // durumlar. Bu satırlarda royalty/FOB hesaplanmaz.
  function isUnresolvedLicensorStatus(status) {
    return status === 'ambiguous' || status === 'manufacturer-conflict';
  }

  function transitRuleSeasonMatches(rule, season) {
    const values = normalizeList(rule && rule.seasons, turkNorm);
    if (!values.length) return true;
    const key = turkNorm(season);
    return !!key && values.some(value => turkNorm(value) === key);
  }

  function transitRuleCountryMatches(rule, country) {
    const values = normalizeList(rule && rule.countries, transitCountryKey);
    if (!values.length) return true;
    const key = transitCountryKey(country);
    return !!key && values.some(value => transitCountryKey(value) === key);
  }

  function transitRuleSpecificity(rule, dateOrdinal = defaultDateOrdinal) {
    const countries = normalizeList(rule && rule.countries, transitCountryKey);
    const seasons = normalizeList(rule && rule.seasons, turkNorm);
    const start = dateOrdinal(rule && rule.exfStart);
    const end = dateOrdinal(rule && rule.exfEnd);
    const bounded = (start != null ? 1 : 0) + (end != null ? 1 : 0);
    const span = start != null && end != null ? Math.max(0, end - start) : Number.MAX_SAFE_INTEGER;
    return [
      countries.length ? 1 : 0,
      seasons.length ? 1 : 0,
      bounded,
      countries.length ? -countries.length : 0,
      seasons.length ? -seasons.length : 0,
      -span,
    ];
  }

  function compareTransitSpecificity(a, b, dateOrdinal = defaultDateOrdinal) {
    const left = transitRuleSpecificity(a, dateOrdinal);
    const right = transitRuleSpecificity(b, dateOrdinal);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return 0;
  }

  // A valid loading approval is authoritative, regardless of the planned day.
  function resolveExFactoryDate(planned, approval, dateOrdinal = defaultDateOrdinal) {
    const automatic = Number.isFinite(dateOrdinal(approval));
    return { value: automatic ? approval : planned, automatic };
  }

  function findTransitRule(rules, exFactory, season, country, delType, dateOrdinal = defaultDateOrdinal) {
    const wantedType = transitDelTypeKey(delType);
    if (!wantedType) return null;
    const day = dateOrdinal(exFactory);
    const matches = (Array.isArray(rules) ? rules : []).filter(rule => {
      if (transitDelTypeKey(rule && rule.delType) !== wantedType) return false;
      const start = dateOrdinal(rule && rule.exfStart);
      const end = dateOrdinal(rule && rule.exfEnd);
      const dateMatches = (start == null && end == null)
        || (day != null && (start == null || day >= start) && (end == null || day <= end));
      return dateMatches
        && transitRuleSeasonMatches(rule, season)
        && transitRuleCountryMatches(rule, country)
        && Number.isFinite(Number(rule && rule.days));
    });
    matches.sort((a, b) => compareTransitSpecificity(a, b, dateOrdinal));
    return matches[0] || null;
  }

  function defaultTransitDays(delType) {
    const key = normalizeTransitDelType(delType);
    return key && Object.prototype.hasOwnProperty.call(DEFAULT_TRANSIT_DAYS, key) ? DEFAULT_TRANSIT_DAYS[key] : null;
  }

  /* Kuralın günü HANGİ kilometre taşından sayılır (Yol Süresi Analizi'nde hangi
     ölçüden aktarıldıysa): Uçtan Uca → Yükleme Talep, Handover → Antrepo →
     Handover, Fiili Yükleme → Antrepo → Fiili Yükleme. Eski / elle girilmiş kural:
     Handover (önceki davranış). Üretimdeki siparişte gün her zaman Ex-Factory'ye
     eklenir; baz yalnız IAS tarihi olan sevk edilmiş parsiyelde uygulanır. */
  const TRANSIT_RULE_BASES = Object.freeze(['handover', 'loadingRequest', 'actualLoading']);
  function transitRuleBasis(rule) {
    const value = rule && rule.basis;
    return TRANSIT_RULE_BASES.includes(value) ? value : 'handover';
  }

  function resolveTransitDays(options, dateOrdinal = defaultDateOrdinal) {
    const input = options || {};
    const fallback = defaultTransitDays(input.delType);
    if (!input.forceRules && !isProductionStatus(input.status)) {
      return { days: fallback, rule: null, dynamic: false };
    }
    const rule = findTransitRule(input.rules, input.exFactory, input.season, input.country, input.delType, dateOrdinal);
    if (!rule) return { days: fallback, rule: null, dynamic: false };
    const ruleDays = Number(rule.days);
    const basis = transitRuleBasis(rule);
    /* anchor: çağıranın günü EKLEYECEĞİ kilometre taşı (ör. parsiyelin Handover'ı).
       Kural başka bir taştan sayılıyorsa gün, gerçekleşen "baz → anchor" farkı
       kadar düzeltilir: anchor + gün = baz + kural günü. Böylece "Handover + gün"
       kullanan bütün hesaplar kuralın kendi bazına göre çalışır. milestones bir
       nesne ya da tembel fonksiyon (m → tarih) olabilir. Baz tarihi yoksa gün
       düzeltilmez ve basisMissing işaretlenir. */
    const anchor = TRANSIT_RULE_BASES.includes(input.anchor) ? input.anchor : null;
    if (anchor && basis !== anchor && input.milestones) {
      const get = typeof input.milestones === 'function' ? input.milestones : m => input.milestones[m];
      const a = dateOrdinal(get(anchor)), b = dateOrdinal(get(basis));
      if (a != null && b != null) {
        const shift = a - b;
        // İşaretli: baz → anchor kural gününden uzunsa gün negatiftir (planlanan
        // varış anchor'dan öncedir). Sıfıra kırpmak planlanan ETA'yı kaydırırdı.
        return { days: ruleDays - shift, rule, dynamic: true, basis, ruleDays, basisShift: shift };
      }
      return { days: ruleDays, rule, dynamic: true, basis, ruleDays, basisMissing: true };
    }
    return { days: ruleDays, rule, dynamic: true, basis, ruleDays };
  }

  function roundHalfUp(value, decimals = 2) {
    const number = Number(value);
    const precision = Number.isInteger(decimals) && decimals >= 0 && decimals <= 12 ? decimals : 2;
    if (!Number.isFinite(number)) return 0;
    const factor = 10 ** precision;
    const sign = number < 0 ? -1 : 1;
    return sign * (Math.floor(Math.abs(number) * factor + 0.5 + 1e-10) / factor);
  }

  function computePriorityFlags(input, dateOrdinal = defaultDateOrdinal) {
    const values = input || {};
    const exFactory = dateOrdinal(values.exFactory);
    const retailDate = dateOrdinal(values.retailDate);
    const inStoreDate = dateOrdinal(values.inStoreDate);
    const antArrival = dateOrdinal(values.antArrival);
    const handoverDate = dateOrdinal(values.handoverDate);
    const shipConfirmationDate = dateOrdinal(values.shipConfirmationDate);
    const today = dateOrdinal(values.today == null ? new Date() : values.today);
    const status = norm(values.status);
    const operationalStage = operationalStageOf(status);
    const production = operationalStage === 'PRODUCTION';
    // Shortage'ın operasyonel hesaplamalara etkisi ile structured SHORTAGE
    // sinyalinin üretilmesi ayrı kararlardır. Eksik miktar transit/ETA hesabını
    // etkilemeye devam edebilir; sinyal yalnız çağıran katman shortageNote=true
    // verdiğinde üretilir.
    const shortageDetected = values.shortage === true || Number(values.shortageQty) > 0 || isShortageStatus(status);
    const shortageNote = Object.prototype.hasOwnProperty.call(values, 'shortageNote')
      ? values.shortageNote === true
      : (values.shortage === true || Number(values.shortageQty) > 0);
    const shortage = shortageDetected;
    // Shortage siparişleri üretimde değildir. Operasyonel transit hesabında
    // siparişin tamamı ASAS Ex-Factory tarihinde yüklenmiş kabul edilir; bu nedenle geçmiş bir
    // Ex-Factory tarihi bugüne taşınmaz. Transit kuralı yine ülke/sezon/yükleme
    // tipine göre çözülür.
    const transitInfo = resolveTransitDays({
      delType: values.delType,
      exFactory: values.exFactory,
      season: values.season,
      country: values.country,
      status,
      rules: values.rules,
      forceRules: shortage,
    }, dateOrdinal);
    const transitDays = transitInfo.days;
    const exr = exFactory != null && retailDate != null ? retailDate - exFactory : null;

    let delayBase = null;
    if (production) delayBase = exFactory != null && today != null && exFactory < today ? today : exFactory;
    else if (shortage) delayBase = exFactory;
    const delayEstimatedAntrepo = delayBase != null && transitDays != null ? delayBase + Number(transitDays) : null;
    const isDelay = delayEstimatedAntrepo != null && retailDate != null && delayEstimatedAntrepo > retailDate;

    let mbAntrepo = null;
    if (production || shortage) {
      if (exFactory != null && transitDays != null) {
        const effectiveExFactory = production && today != null && exFactory < today ? today : exFactory;
        mbAntrepo = effectiveExFactory + Number(transitDays);
      }
    } else {
      mbAntrepo = antArrival;
    }
    const mbGap = mbAntrepo != null && inStoreDate != null ? inStoreDate - mbAntrepo : null;
    const mbDelay = mbGap != null && mbGap < 14;

    /* Segment riskleri (ADR-0003 §6O.c, ürün sahibi kararı 2a): lojistik segmentli satırda HANDOVER_PENDING
       ve ANTREPO_DELAY, satırın görünen (birincil) segmentine değil ilgili HER segmente bakar; birincil segment
       üretim bakiyesi olunca yoldaki parsiyelin bugünkü uyarısı gizlenmez. Yüklem bugünküyle aynıdır, yalnız
       segment başına değerlendirilir; kıtlık segmenti ve kıtlıklı satır bugünkü gibi dışarıda kalır.
       Segmentsiz satır (ya da logisticSegments verilmeyen çağıran) satır alanlarıyla eskisi gibi çalışır. */
    const riskSegments = Array.isArray(values.logisticSegments)
      ? values.logisticSegments.filter(segment => segment && typeof segment === 'object' && segment.kind !== 'shortage')
      : [];
    const segmentStage = segment => (segment.kind === 'production' ? 'PRODUCTION' : primarySegmentStage(segment.status));
    const handoverMissingAt = (stage, handover) => handover == null
      && stage !== 'PRODUCTION' && stage !== 'SHORTAGE' && stage !== 'IN_WAREHOUSE';
    const handoverGap = riskSegments.length
      ? riskSegments.some(segment => handoverMissingAt(segmentStage(segment), dateOrdinal(segment.handover)))
      : handoverMissingAt(operationalStage, handoverDate);
    const handoverWarning = shipConfirmationDate != null
      && handoverGap
      && !shortage
      && today != null
      && today - shipConfirmationDate >= 3;
    // Shortage satırındaki antrepo tarihi gerçek bir IAS varış kaydı değil,
    // Ex-Factory + transit varsayımıdır. Bu sentetik tarih üzerinden Ant. Delay
    // üretmek, siparişi hâlâ yükleme bekliyormuş gibi gösterirdi.
    const arrivalOverdueAt = (stage, arrival) => arrival != null
      && today != null
      && arrival < today
      && stage !== 'SHORTAGE'
      && stage !== 'IN_WAREHOUSE'
      && stage !== 'AWAITING_RETAIL_TRANSFER';
    const antDelay = !shortage && (riskSegments.length
      ? riskSegments.some(segment => arrivalOverdueAt(segmentStage(segment), dateOrdinal(segment.arrival)))
      : arrivalOverdueAt(operationalStage, antArrival));
    const discountDelayDays = exFactory != null && today != null ? today - exFactory : null;
    const discountWarning = production && discountDelayDays != null && discountDelayDays > 9;

    /* Operasyonel gerçekler burada yalnız boolean/sayısal alanlar ve structured
       signals olarak üretilir. Eski CP warning-as-Priority metni
       (Handover / Delay / Ant. Delay / MB Delay / Discount / Shortage / In Time)
       kaldırılmıştır. Action Priority yalnız Unified OrderDecision tarafından
       üretilir; business-rules presentation etiketi üretmez.

       estimatedAntrepo: üretim/eksik yükleme satırında PROJEKSİYON
       (yükleme tarihi + transit), diğerlerinde IAS'ın gerçek antrepo varışı.
       retailGap: retailDate − estimatedAntrepo (pozitif = tampon, negatif =
       hedefin gerisinde). 'ANTREPO-RETAIL' sütununun işaretçe tersidir. */
    const estimatedAntrepoSource = mbAntrepo == null ? null : ((production || shortage) ? 'projected' : 'actual');
    const retailGap = mbAntrepo != null && retailDate != null ? retailDate - mbAntrepo : null;
    const latestSafeLoad = retailDate != null && transitDays != null ? retailDate - Number(transitDays) : null;

    // Structured operational signals are the canonical machine-readable facts.
    // Presentation and Action Priority are resolved downstream by OrderDecision.
    const signals = [];
    if (antDelay) signals.push({ code: 'ANTREPO_DELAY', source: 'business_rules' });
    if (isDelay) signals.push({ code: 'DELIVERY_DELAY', source: 'business_rules' });
    if (mbDelay) signals.push({ code: 'MODEL_BUDGET_DELAY', source: 'business_rules' });
    if (handoverWarning) signals.push({ code: 'HANDOVER_PENDING', source: 'business_rules', actionFloor: 'ACTION_THIS_WEEK' });
    if (discountWarning) signals.push({ code: 'DISCOUNT_DELAY', source: 'business_rules' });
    if (shortageNote) signals.push({ code: 'SHORTAGE', source: 'business_rules' });

    return {
      signals, exr, discountWarning, mbGap, transitDays, transitInfo, shortage, shortageNote,
      production, isDelay, mbDelay, antDelay, handoverWarning,
      delayBase, estimatedAntrepo: mbAntrepo, estimatedAntrepoSource, retailGap, latestSafeLoad,
    };
  }

  /* BACKLOG RİSK (PRIORITY) — kanonik kural. Excel'deki RİSK formülü
     (backlog-excel-formulas.js) bunun birebir aynısını hücre formülüyle kurar.

     Risk VAR, şu üç durumdan biri geçerliyse:
       1) RETAIL'E YETİŞMEME: tahmini antrepo girişi Retail Depo tarihinden
          sonra. Tahmin ortalama yol süresiyle (Yol Süreleri kuralı) yapılır:
            · Üretimde   → MAX(Ex-Factory, bugün) + yol süresi
            · Eksik Yük. → Ex-Factory + yol süresi (tamamı yüklenmiş sayılır)
            · Parsiyel   → IAS antrepo tarihi; yoksa yükleme (Handover, yoksa
              Ex-Factory) + yol süresi. Henüz depoya girmemiş bir parsiyelin
              tarihi geçmişte kalmışsa en erken bugün varabilir.
            · Retaile aktarım bekleyen → gerçekleşen antrepo tarihi.
       2) HANDOVER BEKLİYOR: yükleme onayı verilmiş, ürün handover edilmemiş
          ve onayın üzerinden 3 günden FAZLA geçmiş. Yalnız yükleme öncesi
          aşamalar (Üretimde bakiyesi, Üretimde / Yükleme Operasyonları
          statülü parsiyel) değerlendirilir: Yolda/Gümrük'teki ürün
          handover tarihi boş olsa da teslim edilmiştir.
       3) YOL SÜRESİ AŞILDI: yüklenmiş parsiyel, yükleme + ortalama yol süresi
          dolduğu hâlde depoya ulaşmamış (çağıran transitOverdue verir).
     Depoya girmiş satır risk taşımaz. In-Store (Model Bütçe) tamponu,
     indirim ve ETA kayması bu kararın girdisi DEĞİLDİR; onlar CP Action
     Priority sinyalleri olarak kalır. */
  const BACKLOG_HANDOVER_GRACE_DAYS = 3;
  function computeBacklogRisk(input, dateOrdinal = defaultDateOrdinal) {
    const values = input || {};
    const kind = values.segmentKind === 'production' || values.segmentKind === 'shortage' ? values.segmentKind : 'partial';
    const today = dateOrdinal(values.today == null ? new Date() : values.today);
    const exFactory = dateOrdinal(values.exFactory);
    const loadDate = dateOrdinal(values.loadDate) ?? exFactory;
    const antArrival = dateOrdinal(values.antArrival);
    const retailDate = dateOrdinal(values.retailDate);
    const shipConfirmation = dateOrdinal(values.shipConfirmationDate);
    const handover = dateOrdinal(values.handoverDate);
    const days = values.transitDays == null || values.transitDays === '' ? NaN : Number(values.transitDays);
    // Kural bazı düzeltmesiyle gün negatif olabilir (baz + kural günü, yükleme tarihinden önce).
    const hasTransit = Number.isFinite(days) && days > -3650;
    const inWarehouse = values.inWarehouse === true;
    const retailWaiting = values.retailWaiting === true;
    const stage = operationalStageOf(values.status);
    const preLoad = kind === 'production' || stage === 'PRODUCTION' || stage === 'LOADING';

    let estimatedAntrepo = null;
    if (!inWarehouse) {
      if (kind === 'production') {
        if (exFactory != null && hasTransit) estimatedAntrepo = (today != null && exFactory < today ? today : exFactory) + days;
      } else if (kind === 'shortage') {
        if (exFactory != null && hasTransit) estimatedAntrepo = exFactory + days;
      } else {
        estimatedAntrepo = antArrival != null ? antArrival : (loadDate != null && hasTransit ? loadDate + days : null);
        if (estimatedAntrepo != null && !retailWaiting && today != null && estimatedAntrepo < today) estimatedAntrepo = today;
      }
    }
    const retailRisk = estimatedAntrepo != null && retailDate != null && estimatedAntrepo > retailDate;
    const handoverPendingDays = shipConfirmation != null && handover == null && today != null ? today - shipConfirmation : null;
    const handoverRisk = handoverPendingDays != null
      && kind !== 'shortage' && preLoad && !inWarehouse && !retailWaiting
      && handoverPendingDays > BACKLOG_HANDOVER_GRACE_DAYS;
    const transitRisk = values.transitOverdue === true && !inWarehouse && !retailWaiting;
    const reasons = [];
    if (retailRisk) reasons.push('RETAIL_DATE_MISSED');
    if (handoverRisk) reasons.push('HANDOVER_PENDING');
    if (transitRisk) reasons.push('TRANSIT_OVERDUE');
    return {
      risk: reasons.length > 0, reasons, retailRisk, handoverRisk, transitRisk,
      estimatedAntrepo, retailGap: estimatedAntrepo != null && retailDate != null ? retailDate - estimatedAntrepo : null,
      handoverPendingDays,
    };
  }

  /* License Royalty v2: ülke artık kuralın eşleşme boyutu değil, aynı
     Licensor + License sözleşmesinin komisyon varyantıdır. TR/YD komisyonu
     Royalty'ye eklenir; hologram tutarı yüzde değildir. */
  function pricingRuleCountryGroup(value) {
    const raw = norm(value);
    if (!raw) return '';
    const key = turkNorm(raw).replace(/[\s_]+/g, '-');
    if (key === 'TR' || key === 'TURKIYE' || key === 'TURKEY') return 'TR';
    if (key === 'NON-TR' || key === 'NONTR' || key === 'YD' || key === 'YURT-DISI' || key === 'YURTDISI' || key === 'OVERSEAS') return 'YD';
    return 'YD';
  }

  function pricingRuleNumber(value) {
    if (value == null || String(value).trim() === '') return null;
    const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  // Oranlar ondalık girilir (ör. %0,1 + %0,2). İkili kayan nokta toplamı
  // 0.30000000000000004 üretir ve kesin kesirli fiyat hesabında yarım kuruş
  // sınırındaki satırları bir kuruş aşağı yuvarlar. Oran toplamı/farkı bu
  // yüzden girilen ondalık değere geri sabitlenir.
  function pricingRuleRate(value) {
    return Number.isFinite(value) ? Number(value.toFixed(10)) : value;
  }

  // DTR (iç tedarik) sözleşmesinde royalty, komisyon ve hologram yoktur: boş
  // alan "yok" demektir, 0 değildir. Non-DTR sözleşmede oranlar Final FOB'u
  // belirlediği için zorunlu kalır. Fiyat hesabı DTR satırında kural kullanmaz
  // (Final FOB = Supp. FOB); boş oranlı kural hiçbir ülkeye fiyat uygulamaz.
  function pricingRuleRatesOptional(rule) {
    const licensor = rule && typeof rule === 'object' ? (rule.licensor != null ? rule.licensor : rule.manufacturer) : '';
    return turkNorm(norm(licensor)) === 'DTR';
  }

  function pricingRuleCommissionForCountry(rule, countryOrGroup) {
    if (!rule || typeof rule !== 'object') return null;
    return commissionForGroup(rule, pricingRuleCountryGroup(countryOrGroup));
  }

  // Ülke grubu satır başına bir kez normalleştirilir (30k satırlık sıcak yol).
  function commissionForGroup(rule, group) {
    if (!group) return null;
    const key = group === 'TR' ? 'trCommission' : 'ydCommission';
    if (Object.prototype.hasOwnProperty.call(rule, key)) {
      const raw = rule[key];
      if (raw == null || String(raw).trim() === '') return null;
      const value = pricingRuleNumber(raw);
      return value != null && value >= 0 && value <= 100 ? value : null;
    }
    const legacyGroup = rule.countryGroup ? pricingRuleCountryGroup(rule.countryGroup) : '';
    if (legacyGroup) return legacyGroup === group ? 0 : null;
    return 0;
  }

  // `royalty` YD (ve TR için ayrı değer girilmemişse TR) royalty'sidir.
  // `trRoyalty` boşsa TR, YD royalty'sini kullanır: eski kayıtlar aynen hesaplanır.
  // Komisyon ayrı bir kavramdır ve tarafın royalty'sine eklenir.
  function pricingRuleRoyaltyForCountry(rule, countryOrGroup) {
    if (!rule || typeof rule !== 'object') return null;
    return royaltyForGroup(rule, pricingRuleCountryGroup(countryOrGroup));
  }
  function royaltyForGroup(rule, group) {
    const own = group === 'TR' && rule.trRoyalty != null && String(rule.trRoyalty).trim() !== '';
    const royalty = pricingRuleNumber(own ? rule.trRoyalty : rule.royalty);
    return royalty != null && royalty >= 0 && royalty <= 100 ? royalty : null;
  }

  function pricingRuleEffectiveRoyalty(rule, countryOrGroup) {
    if (!rule || typeof rule !== 'object') return null;
    const group = pricingRuleCountryGroup(countryOrGroup);
    const royalty = royaltyForGroup(rule, group);
    if (royalty == null) return null;
    if (countryOrGroup == null || String(countryOrGroup).trim() === '') return royalty;
    const commission = commissionForGroup(rule, group);
    if (commission == null) return null;
    const total = pricingRuleRate(royalty + commission);
    return Number.isFinite(total) && total >= 0 && total <= 100 ? total : null;
  }

  function pricingRuleHologramForCountry(rule, countryOrGroup) {
    if (!rule || typeof rule !== 'object') return null;
    const group = pricingRuleCountryGroup(countryOrGroup);
    // TR hologramı ayrı girilmişse o kullanılır; boşsa eski TR/YD ayrımı, o da yoksa YD hologramı.
    if (group === 'TR' && rule.trHologramCost != null && String(rule.trHologramCost).trim() !== '') {
      const own = pricingRuleNumber(rule.trHologramCost);
      return own != null && own >= 0 ? own : null;
    }
    const legacyKey = group === 'TR' ? 'legacyTrHologramCost' : group === 'YD' ? 'legacyYdHologramCost' : '';
    if (legacyKey && Object.prototype.hasOwnProperty.call(rule, legacyKey)) {
      const legacy = pricingRuleNumber(rule[legacyKey]);
      if (legacy != null && legacy >= 0) return legacy;
    }
    const value = pricingRuleNumber(rule.hologramCost);
    return value != null && value >= 0 ? value : null;
  }

  function normalizeRoyaltySeasons(value) {
    const raw = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
    const seen = new Set(), out = [];
    for (const item of raw) {
      const text = norm(item), key = turkNorm(text);
      if (text && key && !seen.has(key)) { seen.add(key); out.push(text); }
    }
    return out.sort((a, b) => a.localeCompare(b, 'tr'));
  }

  // Empty scope is the existing general contract; specific categories override it.
  const pricingRuleCategories = rule => normalizeRoyaltySeasons(rule && rule.categories);
  function pricingRuleCategoryMatches(rule, category) {
    const values = pricingRuleCategories(rule);
    return !values.length || values.some(value => turkNorm(value) === turkNorm(category));
  }
  function pricingRuleCategoryScopesOverlap(a, b) {
    const aa=pricingRuleCategories(a),bb=pricingRuleCategories(b);
    if (!aa.length || !bb.length) return !aa.length && !bb.length;
    return aa.some(value => bb.some(other => turkNorm(value) === turkNorm(other)));
  }
  function restoreOmittedCategoryScopes(incoming,existing){
    const byId=new Map((existing||[]).map(rule=>[String(rule.id),rule]));
    return Array.isArray(incoming)?incoming.map(rule=>rule&&typeof rule==='object'&&!Object.hasOwn(rule,'categories')&&byId.has(String(rule.id))
      ?{...rule,categories:pricingRuleCategories(byId.get(String(rule.id)))}:rule):incoming;
  }
  function prioritizeCategoryRules(rules) {
    return [...(rules || [])].sort((a,b)=>Number(!!pricingRuleCategories(b).length)-Number(!!pricingRuleCategories(a).length));
  }

  function royaltyMigrationConditionKey(rule) {
    return [
      norm(rule && rule.opdStart),
      norm(rule && rule.opdEnd),
      normalizeRoyaltySeasons(rule && rule.seasons != null ? rule.seasons : rule && rule.season).map(turkNorm).join('~'),
      turkNorm(rule && (rule.licensor != null ? rule.licensor : rule.manufacturer)),
      turkNorm(rule && rule.license),
      pricingRuleCategories(rule).map(turkNorm).join("~"),
    ].join('|');
  }

  function migrateLicenseRoyaltyRules(rules) {
    const input = Array.isArray(rules) ? rules : [];
    const modern = [];
    const legacy = new Map();
    input.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const source = { ...raw };
      source.licensor = norm(source.licensor != null ? source.licensor : source.manufacturer);
      delete source.manufacturer;
      source.license = norm(source.license);
      source.seasons = normalizeRoyaltySeasons(source.seasons != null ? source.seasons : source.season);
      delete source.season;
      const hasModernCommission = Object.prototype.hasOwnProperty.call(source, 'trCommission')
        || Object.prototype.hasOwnProperty.call(source, 'ydCommission');
      const legacyGroup = source.countryGroup ? pricingRuleCountryGroup(source.countryGroup) : '';
      if (hasModernCommission || !legacyGroup) {
        delete source.countryGroup;
        if (!hasModernCommission) {
          source.trCommission = 0;
          source.ydCommission = 0;
        }
        modern.push(source);
        return;
      }
      const key = royaltyMigrationConditionKey(source);
      if (!legacy.has(key)) legacy.set(key, []);
      legacy.get(key).push({ source, group: legacyGroup, index });
    });

    for (const entries of legacy.values()) {
      const tr = entries.find(item => item.group === 'TR');
      const yd = entries.find(item => item.group === 'YD');
      const samples = [tr, yd].filter(Boolean);
      if (!samples.length) continue;
      const effective = samples.map(item => Number(item.source.royalty)).filter(Number.isFinite);
      const baseRoyalty = effective.length ? Math.min(...effective) : Number(samples[0].source.royalty);
      const primary = (yd || tr).source;
      const merged = { ...primary };
      delete merged.countryGroup;
      merged.royalty = baseRoyalty;
      merged.trCommission = tr && Number.isFinite(Number(tr.source.royalty)) ? pricingRuleRate(Number(tr.source.royalty) - baseRoyalty) : null;
      merged.ydCommission = yd && Number.isFinite(Number(yd.source.royalty)) ? pricingRuleRate(Number(yd.source.royalty) - baseRoyalty) : null;
      const trHologram = tr ? Number(tr.source.hologramCost) : null;
      const ydHologram = yd ? Number(yd.source.hologramCost) : null;
      const validTrHologram = Number.isFinite(trHologram) && trHologram >= 0;
      const validYdHologram = Number.isFinite(ydHologram) && ydHologram >= 0;
      if (validTrHologram && validYdHologram && trHologram !== ydHologram) {
        merged.hologramCost = ydHologram;
        merged.legacyTrHologramCost = trHologram;
        merged.legacyYdHologramCost = ydHologram;
      } else {
        const hologram = validYdHologram ? ydHologram : validTrHologram ? trHologram : Number(primary.hologramCost);
        merged.hologramCost = hologram;
        delete merged.legacyTrHologramCost;
        delete merged.legacyYdHologramCost;
      }
      merged.legacyRuleIds = entries.map(item => String(item.source.id || '')).filter(Boolean);
      merged.migratedFromCountrySplit = true;
      modern.push(merged);
    }
    return modern;
  }

  function decimalFraction(value) {
    if (value == null || value === '') return null;
    let text = String(value).trim().replace(',', '.');
    if (!text || !Number.isFinite(Number(text))) return null;
    if (/[eE]/.test(text)) text = Number(text).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
    let sign = 1n;
    if (text.startsWith('-')) { sign = -1n; text = text.slice(1); }
    else if (text.startsWith('+')) text = text.slice(1);
    const parts = text.split('.');
    const whole = (parts[0] || '0').replace(/\D/g, '') || '0';
    const fraction = (parts[1] || '').replace(/\D/g, '');
    return { num: sign * BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
  }

  function roundFractionHalfUp(num, den, decimals = 2) {
    if (den === 0n) return null;
    const scale = 10n ** BigInt(decimals);
    let scaled = num * scale;
    const sign = scaled < 0n ? -1n : 1n;
    if (scaled < 0n) scaled = -scaled;
    let quotient = scaled / den;
    const remainder = scaled % den;
    if (remainder * 2n >= den) quotient += 1n;
    return Number(sign * quotient) / Number(scale);
  }

  function calculateSuppFobWithRule(fob, rule, countryOrGroup) {
    const fobFraction = decimalFraction(fob);
    const royalty = pricingRuleEffectiveRoyalty(rule, countryOrGroup);
    const hologram = pricingRuleHologramForCountry(rule, countryOrGroup);
    const royaltyFraction = decimalFraction(royalty);
    const hologramFraction = decimalFraction(hologram);
    if (!fobFraction || !royaltyFraction || !hologramFraction) return null;
    if (!Number.isFinite(royalty) || royalty < 0 || royalty > 100) return null;
    const baseNum = fobFraction.num * hologramFraction.den - hologramFraction.num * fobFraction.den;
    const baseDen = fobFraction.den * hologramFraction.den;
    const royaltyBase = 100n * royaltyFraction.den - royaltyFraction.num;
    return roundFractionHalfUp(baseNum * royaltyBase, baseDen * royaltyFraction.den * 100n, 2);
  }

  function calculateFinalFobWithRule(suppFob, rule, countryOrGroup) {
    const suppFraction = decimalFraction(suppFob);
    const royalty = pricingRuleEffectiveRoyalty(rule, countryOrGroup);
    const hologram = pricingRuleHologramForCountry(rule, countryOrGroup);
    const royaltyFraction = decimalFraction(royalty);
    const hologramFraction = decimalFraction(hologram);
    if (!suppFraction || !royaltyFraction || !hologramFraction) return null;
    if (!Number.isFinite(royalty) || royalty < 0 || royalty >= 100) return null;
    const royaltyBase = 100n * royaltyFraction.den - royaltyFraction.num;
    if (royaltyBase === 0n) return null;
    const baseNum = suppFraction.num * 100n * royaltyFraction.den;
    const baseDen = suppFraction.den * royaltyBase;
    const num = baseNum * hologramFraction.den + hologramFraction.num * baseDen;
    const den = baseDen * hologramFraction.den;
    return roundFractionHalfUp(num, den, 2);
  }

  const {monthParts,chronologyParts,compareChronologicalValues,compareSeasonLists,compareChronologicalPaths}=chronology;

  // Main CP/Koleksiyon policy: numeric generation first; for the same generation S precedes W.
  function seasonNumberLetterParts(value) {
    const raw = norm(value);
    const upper = raw.toLocaleUpperCase('tr-TR');
    const numberMatch = upper.match(/-?\d+(?:[.,]\d+)?/);
    const number = numberMatch ? Number(numberMatch[0].replace(',', '.')) : Number.POSITIVE_INFINITY;
    const letterMatch = upper.match(/[A-ZÇĞİÖŞÜ]/);
    const letter = letterMatch ? letterMatch[0] : '';
    const letterRank = letter === 'S' ? 0 : (letter === 'W' ? 1 : 2);
    return { number: Number.isFinite(number) ? number : Number.POSITIVE_INFINITY, letterRank, raw };
  }

  function compareSeasonNumberThenLetter(a, b) {
    return compareChronologicalValues(a, b);
  }

  // Descending table order is the reverse of the same chronology.
  function compareSeasonNewestFirst(a, b) {
    return compareChronologicalValues(a, b, -1);
  }

  // Prefix parsing is retained for like-for-like previous-year selection.
  function seasonPrefixParts(value) {
    const match = norm(value).match(/^(.*?)(\d+)\s*$/);
    return match ? { prefix: match[1], number: Number(match[2]) } : null;
  }

  function compareSeasonPrefixThenNumber(a, b) {
    return compareSeasonNumberThenLetter(a, b);
  }

  function previousSeasonByPrefix(current, seasons) {
    const parsed = seasonPrefixParts(current);
    if (parsed) {
      const exact = (seasons || []).find(value => {
        const candidate = seasonPrefixParts(value);
        return candidate && candidate.prefix === parsed.prefix && candidate.number === parsed.number - 1;
      });
      if (exact) return exact;
    }
    const sorted = [...(seasons || [])].sort(compareSeasonPrefixThenNumber);
    const index = sorted.indexOf(current);
    return index > 0 ? sorted[index - 1] : '';
  }

  return Object.freeze({
    DEFAULT_TRANSIT_DAYS,
    norm,
    turkNorm,
    operationalStageOf,
    selectPrimaryLogisticSegment,
    isProductionStatus,
    isShortageStatus,
    isWarehouseShortageStatus,
    manufacturerKey,
    normalizeManufacturerList,
    isNonDtrManufacturer,
    classifyDtrByManufacturer,
    normalizeTransitDelType,
    transitDelTypeKey,
    transitCountryKey,
    normalizeList,
    defaultDateOrdinal,
    resolveExFactoryDate,
    resolveLatestLicensorsForLicense,
    resolveLicenseLicensor,
    resolveAutoLicensor,
    resolveOrderLicensor,
    manufacturerMatchesLicensor,
    licenseHasOnlyNonDtrContracts,
    isUnresolvedLicensorStatus,
    transitRuleSeasonMatches,
    transitRuleCountryMatches,
    transitRuleSpecificity,
    compareTransitSpecificity,
    findTransitRule,
    defaultTransitDays,
    TRANSIT_RULE_BASES,
    transitRuleBasis,
    resolveTransitDays,
    roundHalfUp,
    computePriorityFlags,
    computeBacklogRisk,
    BACKLOG_HANDOVER_GRACE_DAYS,
    licensorMergeKey,
    licensorGroupKey,
    licensorsMerged,
    findRuleByLicensor,
    licensorHasOwnRules,
    pricingRuleCountryGroup,
    pricingRuleRate,
    pricingRuleCommissionForCountry,
    pricingRuleRoyaltyForCountry,
    pricingRuleEffectiveRoyalty,
    pricingRuleHologramForCountry,
    restoreOmittedCategoryScopes, pricingRuleCategories, pricingRuleCategoryMatches, pricingRuleCategoryScopesOverlap, prioritizeCategoryRules,
    migrateLicenseRoyaltyRules,
    decimalFraction,
    roundFractionHalfUp,
    calculateSuppFobWithRule,
    calculateFinalFobWithRule,
    pricingRuleRatesOptional,
    seasonNumberLetterParts,
    monthParts,
    chronologyParts,
    compareChronologicalValues,
    compareSeasonLists,
    compareChronologicalPaths,
    compareSeasonNumberThenLetter,
    compareSeasonNewestFirst,
    seasonPrefixParts,
    compareSeasonPrefixThenNumber,
    previousSeasonByPrefix,
  });
});
