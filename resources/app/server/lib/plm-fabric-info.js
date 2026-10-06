'use strict';

/* PLM "mainFabricInfo" ayrıştırıcısı ve ASAS ↔ PLM kumaş karşılaştırması.
 *
 * PLM Style List ana kumaşı tek serbest metin olarak verir:
 *   "3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed"
 *   "Orme,Süprem,150 gsm,100% Cotton"
 * Virgül alan ayracı DEĞİLDİR (ör. "30,Ne" iplik numarasının parçasıdır). Bu
 * yüzden metin bölünmez; önce kalıp (gramaj, karışım, iplik, kumaş kodu,
 * boya/apre) ve sözlük (kategori, kumaş tipi) ile tanınan parçalar çıkarılır,
 * kalan parçalar yalnız "tanınmadı" olarak raporlanır.
 *
 * Güven seviyesi:
 *   EXACT    → birimli/açık kalıp ya da sözlükte birebir karşılığı olan parça.
 *   INFERRED → kalıp veya konumdan çıkarılan ama birebir doğrulanamayan değer.
 *   UNKNOWN  → metinde yok ya da emin olunamadı; değer UYDURULMAZ (boş kalır).
 * Kumaşçı ve Kumaşçı Ülkesi PLM metninde hiç bulunmaz; her zaman UNKNOWN döner.
 *
 * Bu modül yalnız ölçüm/doğrulama içindir: ASAS kumaş alanlarının yerini
 * almaz ve hiçbir sipariş/LFL değerini değiştirmez. */

const CONFIDENCE = Object.freeze({ EXACT: 'EXACT', INFERRED: 'INFERRED', UNKNOWN: 'UNKNOWN' });
const COMPARISON = Object.freeze({
  MATCH: 'MATCH',
  DIFFERENT: 'DIFFERENT',
  PLM_MISSING: 'PLM_MISSING',
  ASAS_EMPTY: 'ASAS_EMPTY',
  NOT_IN_PLM: 'NOT_IN_PLM',
});
const FIELDS = Object.freeze(['fabricCategory', 'fabricSupplierCountry', 'fabricSupplier', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim']);
// PLM mainFabricInfo bu alanları taşımaz; karşılaştırmada ayrı sayılır.
const NOT_IN_PLM_FIELDS = Object.freeze(['fabricSupplierCountry', 'fabricSupplier']);

const TR_FOLD = { 'ı': 'I', 'İ': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };
function fold(value) {
  return String(value == null ? '' : value)
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => TR_FOLD[ch])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}
function clean(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function words(value) {
  return fold(value).replace(/[^A-Z0-9%]+/g, ' ').trim();
}
const escapeRx = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Kumaş kategorisi (yapı) sözlüğü. Anahtar karşılaştırma için kanonik addır.
const CATEGORY_ALIASES = Object.freeze({
  KNIT: ['ORME', 'KNIT', 'KNITTED', 'KNITTING'], // i18n-ignore
  WOVEN: ['DOKUMA', 'WOVEN'], // i18n-ignore
  SWEATER: ['TRIKO', 'SWEATER', 'FLAT KNIT'], // i18n-ignore
  DENIM: ['DENIM', 'KOT'], // i18n-ignore
});
// Kumaş tipi sözlüğü. Süprem sektörde single jersey'dir; ikisi aynı kanonik ada bağlanır.
const FABRIC_TYPE_ALIASES = Object.freeze({
  SINGLE_JERSEY: ['SUPREM', 'SINGLE JERSEY', 'JERSEY', 'TEK JERSEY'], // i18n-ignore
  RIB: ['RIBANA', 'RIB', '1X1 RIB', '2X2 RIB', 'KASKORSE'], // i18n-ignore
  INTERLOCK: ['INTERLOK', 'INTERLOCK'], // i18n-ignore
  PIQUE: ['PIKE', 'PIQUE', 'LACOSTE'], // i18n-ignore
  TWO_THREAD: ['IKI IPLIK', '2 IPLIK', 'TWO THREAD', '2 THREAD'], // i18n-ignore
  THREE_THREAD: ['UC IPLIK', '3 IPLIK', 'THREE THREAD', '3 THREAD', 'SWEAT'], // i18n-ignore
  FLEECE: ['POLAR', 'FLEECE'], // i18n-ignore
  FRENCH_TERRY: ['FRENCH TERRY', 'HAVLU', 'TERRY'], // i18n-ignore
  WAFFLE: ['WAFFLE', 'PETEK'], // i18n-ignore
  SCUBA: ['SCUBA', 'DALGIC'], // i18n-ignore
  MESH: ['MESH', 'FILE'], // i18n-ignore
  VELVET: ['KADIFE', 'VELVET', 'VELOUR'], // i18n-ignore
});
const MATERIAL_ALIASES = Object.freeze({
  COTTON: ['COTTON', 'PAMUK', 'CO', 'ORGANIC COTTON', 'ORGANIK PAMUK', 'RECYCLED COTTON', 'GERI DONUSUMLU PAMUK', 'BCI COTTON'], // i18n-ignore
  POLYESTER: ['POLYESTER', 'POLIESTER', 'PES', 'PE', 'RECYCLED POLYESTER', 'GERI DONUSUMLU POLYESTER'], // i18n-ignore
  ELASTANE: ['ELASTANE', 'ELASTAN', 'SPANDEX', 'LYCRA', 'EA', 'EL'], // i18n-ignore
  VISCOSE: ['VISCOSE', 'VISKON', 'VISKOZ', 'VI', 'CV', 'RAYON'], // i18n-ignore
  MODAL: ['MODAL', 'MD'], // i18n-ignore
  LYOCELL: ['LYOCELL', 'TENCEL', 'LIYOSEL'], // i18n-ignore
  POLYAMIDE: ['POLYAMIDE', 'POLYAMID', 'POLIAMID', 'NYLON', 'PA'], // i18n-ignore
  WOOL: ['WOOL', 'YUN', 'WO'], // i18n-ignore
  ACRYLIC: ['ACRYLIC', 'AKRILIK', 'PAN'], // i18n-ignore
  LINEN: ['LINEN', 'KETEN', 'LI'], // i18n-ignore
  CASHMERE: ['CASHMERE', 'KASMIR'], // i18n-ignore
  SILK: ['SILK', 'IPEK'], // i18n-ignore
});
const FINISH_ALIASES = Object.freeze({
  REACTIVE_DYED: ['REACTIVE DYED', 'REAKTIF BOYALI', 'REACTIVE'], // i18n-ignore
  PIGMENT_DYED: ['PIGMENT DYED', 'PIGMENT BOYALI'], // i18n-ignore
  YARN_DYED: ['YARN DYED', 'IPLIK BOYALI'], // i18n-ignore
  GARMENT_DYED: ['GARMENT DYED', 'PARCA BOYALI'], // i18n-ignore
  PRINTED: ['PRINTED', 'BASKILI'], // i18n-ignore
  MELANGE: ['MELANGE', 'MELANJ'], // i18n-ignore
  ENZYME_WASHED: ['ENZYME WASHED', 'ENZIM YIKAMALI'], // i18n-ignore
  BRUSHED: ['BRUSHED', 'SARDONLU', 'TACHED'], // i18n-ignore
});
const YARN_DESCRIPTORS = ['COMPACT', 'COMBED', 'CARDED', 'PENYE', 'KARDE', 'RING', 'OPEN END', 'OE', 'VORTEX', 'SLUB', 'FLAMLI', 'SIRO', 'MVS', 'ORGANIC', 'ORGANIK']; // i18n-ignore

function aliasRegexSource(aliases) {
  return [...new Set(aliases.map(alias => fold(alias)))].sort((a, b) => b.length - a.length)
    .map(alias => escapeRx(alias).replace(/ /g, '\\s+')).join('|');
}
function canonicalOf(dictionary, value) {
  const key = words(value);
  if (!key) return '';
  for (const [canonical, aliases] of Object.entries(dictionary)) {
    if (aliases.some(alias => words(alias) === key)) return canonical;
  }
  return '';
}
const MATERIAL_RX = aliasRegexSource(Object.values(MATERIAL_ALIASES).flat());
const FINISH_RX = aliasRegexSource(Object.values(FINISH_ALIASES).flat());
const DESCRIPTOR_RX = aliasRegexSource(YARN_DESCRIPTORS);

function field(value, confidence, extra = {}) {
  return { value: value || '', confidence: value ? confidence : CONFIDENCE.UNKNOWN, ...extra };
}

/* Metni katlanmış (folded) kopyası üzerinde tarar; eşleşen aralıklar maskelenir
   ki aynı karakter iki alana yazılmasın. Değerler özgün metinden kesilir. */
function parseMainFabricInfo(rawValue) {
  const raw = clean(rawValue);
  const result = {
    raw: rawValue == null ? '' : String(rawValue),
    fabricCode: field('', CONFIDENCE.UNKNOWN),
    fabricCategory: field('', CONFIDENCE.UNKNOWN),
    kumasTipi: field('', CONFIDENCE.UNKNOWN),
    iplikNo: field('', CONFIDENCE.UNKNOWN),
    fabricWeight: field('', CONFIDENCE.UNKNOWN),
    karisim: field('', CONFIDENCE.UNKNOWN),
    finish: field('', CONFIDENCE.UNKNOWN),
    fabricSupplier: field('', CONFIDENCE.UNKNOWN, { reason: 'not-in-plm' }),
    fabricSupplierCountry: field('', CONFIDENCE.UNKNOWN, { reason: 'not-in-plm' }),
    unknownTokens: [],
    warnings: [],
  };
  if (!raw) return result;
  // fold() harf sayısını korur (NFD işaretleri silinir ama Türkçe harfler tekli
  // eşlenir); güvence için uzunluk farklıysa maskeleme folded metinde yapılır.
  const folded = fold(raw);
  const source = folded.length === raw.length ? raw : folded;
  const mask = new Array(folded.length).fill(false);
  const free = (start, end) => { for (let i = start; i < end; i++) if (mask[i]) return false; return true; };
  const take = (start, end) => { for (let i = start; i < end; i++) mask[i] = true; return source.slice(start, end); };
  const scan = (rx, handler) => {
    rx.lastIndex = 0;
    let match;
    while ((match = rx.exec(folded))) {
      if (!match[0]) { rx.lastIndex++; continue; }
      if (free(match.index, match.index + match[0].length)) handler(match);
    }
  };

  // 1) Kumaş kodu: yalnız metnin başındaki "1234-" kalıbı.
  scan(/^\s*(\d{3,8})\s*-\s*/g, match => {
    take(match.index, match.index + match[0].length);
    result.fabricCode = field(match[1], CONFIDENCE.EXACT);
  });

  // 2) Gramaj: birimli sayı. gsm / g/m2 kesin, yalnız "gr" çıkarımdır.
  const weights = [];
  scan(/(\d{2,4}(?:[.,]\d+)?)\s*(GSM|GR?\s*\/\s*M\s*(?:2|²)|GRM2|GR\/M2|GRAM\/M2|GR\b|G\b)/g, match => {
    take(match.index, match.index + match[0].length);
    const unit = match[2].replace(/\s+/g, '');
    const exact = /^(GSM|GR?\/M(?:2|²)|GRM2|GRAM\/M2)$/.test(unit);
    weights.push({ value: `${match[1].replace(',', '.')} gsm`, confidence: exact ? CONFIDENCE.EXACT : CONFIDENCE.INFERRED });
  });
  if (weights.length === 1) result.fabricWeight = field(weights[0].value, weights[0].confidence);
  else if (weights.length > 1) {
    // Birden fazla gramaj (ör. set ya da çift kat) hangisinin ana olduğu belli değil.
    result.fabricWeight = field('', CONFIDENCE.UNKNOWN);
    result.warnings.push('multiple-weights');
  }

  // 3) Karışım: "100%Cotton", "%95 Pamuk", "Cotton 100%".
  const parts = [];
  const compositionRx = [
    new RegExp(`(\\d{1,3}(?:[.,]\\d+)?)\\s*%\\s*(${MATERIAL_RX})(?![A-Z])`, 'g'),
    new RegExp(`%\\s*(\\d{1,3}(?:[.,]\\d+)?)\\s*(${MATERIAL_RX})(?![A-Z])`, 'g'),
    new RegExp(`(?<![A-Z])(${MATERIAL_RX})\\s*(\\d{1,3}(?:[.,]\\d+)?)\\s*%`, 'g'),
  ];
  compositionRx.forEach((rx, index) => scan(rx, match => {
    const material = index === 2 ? match[1] : match[2];
    const percent = Number(String(index === 2 ? match[2] : match[1]).replace(',', '.'));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return;
    take(match.index, match.index + match[0].length);
    parts.push({ material: canonicalOf(MATERIAL_ALIASES, material), percent, text: clean(source.slice(match.index, match.index + match[0].length)) });
  }));
  if (parts.length) {
    const total = Math.round(parts.reduce((sum, item) => sum + item.percent, 0) * 100) / 100;
    const value = parts.map(item => item.text).join(' ');
    result.karisim = field(value, total === 100 ? CONFIDENCE.EXACT : CONFIDENCE.INFERRED, {
      parts: parts.map(({ material, percent }) => ({ material, percent })),
      key: compositionKey(parts),
    });
    if (total !== 100) result.warnings.push('composition-total-not-100');
  }

  // 4) İplik: "30,Ne Compact Combed", "Ne 30/1", "30/1 Ne", "150 Denier", "75D".
  //    Birimli sayı EXACT; birimsiz "30/1" yalnız INFERRED.
  const yarnUnits = '(NE|NM|DTEX|DENIER|DEN|D)';
  const descriptorTail = `((?:\\s+(?:${DESCRIPTOR_RX}))*)`;
  const yarns = [];
  scan(new RegExp(`(?<![\\d.])(\\d{1,3}(?:\\s*\\/\\s*\\d{1,2})?)\\s*[,]?\\s*${yarnUnits}(?![A-Z])${descriptorTail}`, 'g'), match => {
    take(match.index, match.index + match[0].length);
    yarns.push({ count: match[1].replace(/\s+/g, ''), unit: match[2], text: clean(source.slice(match.index, match.index + match[0].length)).replace(/\s*,\s*/g, ' '), confidence: CONFIDENCE.EXACT });
  });
  scan(new RegExp(`(?<![A-Z])${yarnUnits}\\s*(\\d{1,3}(?:\\s*\\/\\s*\\d{1,2})?)(?![\\d%])${descriptorTail}`, 'g'), match => {
    take(match.index, match.index + match[0].length);
    yarns.push({ count: match[2].replace(/\s+/g, ''), unit: match[1], text: clean(source.slice(match.index, match.index + match[0].length)), confidence: CONFIDENCE.EXACT });
  });
  if (!yarns.length) {
    scan(/(?<![\d.%])(\d{1,3}\s*\/\s*[1-4])(?![\d%])/g, match => {
      take(match.index, match.index + match[0].length);
      yarns.push({ count: match[1].replace(/\s+/g, ''), unit: '', text: clean(source.slice(match.index, match.index + match[0].length)), confidence: CONFIDENCE.INFERRED });
    });
  }
  if (yarns.length === 1) {
    const yarn = yarns[0];
    result.iplikNo = field(yarn.text, yarn.confidence, { count: yarn.count, unit: normalizeYarnUnit(yarn.unit) });
  } else if (yarns.length > 1) {
    result.iplikNo = field(yarns.map(item => item.text).join(' + '), CONFIDENCE.INFERRED, { count: '', unit: '' });
    result.warnings.push('multiple-yarns');
  }

  // 5) Boya/apre: yalnız sözlükte olanlar.
  const finishes = [];
  scan(new RegExp(`(?<![A-Z])(${FINISH_RX})(?![A-Z])`, 'g'), match => {
    take(match.index, match.index + match[0].length);
    finishes.push(clean(source.slice(match.index, match.index + match[0].length)));
  });
  if (finishes.length) result.finish = field(finishes.join(' '), CONFIDENCE.EXACT);

  // 6) Kalan metin parçaları sözlükle sınıflanır. Ayraç yalnız maskelenmiş
  //    aralıklar ve virgül/noktalı virgül/dikey çizgi/eğik çizgidir.
  const segments = [];
  let current = '', start = -1;
  const flush = () => { const text = clean(current); if (text) segments.push({ text, folded: fold(text), start }); current = ''; start = -1; };
  for (let i = 0; i < source.length; i++) {
    if (mask[i] || /[,;|\/]/.test(source[i])) { flush(); continue; }
    if (start < 0) start = i;
    current += source[i];
  }
  flush();
  const leftovers = [];
  const categories = [], types = [];
  for (const segment of segments) {
    const text = segment.text.replace(/^[\s\-–]+|[\s\-–]+$/g, '');
    if (!text || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(text)) { if (text) leftovers.push(text); continue; }
    const category = canonicalOf(CATEGORY_ALIASES, text);
    const type = canonicalOf(FABRIC_TYPE_ALIASES, text);
    if (category && !type) categories.push({ text, canonical: category });
    else if (type) types.push({ text, canonical: type });
    else leftovers.push(text);
  }
  const structured = Boolean(result.fabricCode.value || weights.length || parts.length || yarns.length || categories.length);
  if (categories.length === 1) result.fabricCategory = field(categories[0].text, CONFIDENCE.EXACT, { canonical: categories[0].canonical });
  else if (categories.length > 1) result.warnings.push('multiple-categories');
  if (types.length === 1) result.kumasTipi = field(types[0].text, CONFIDENCE.EXACT, { canonical: types[0].canonical });
  else if (types.length > 1) result.warnings.push('multiple-fabric-types');
  else if (leftovers.length === 1 && structured
    && leftovers[0].split(/\s+/).length <= 3
    && /^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü\s.'-]*$/.test(leftovers[0])) {
    // Tek tanınmayan kısa sözcük grubu, en az bir alanı kalıpla tanınmış yapılı
    // metinde kumaş tipi konumundadır: değer metinde gerçekten var ama sözlükte
    // değil → INFERRED. Birden fazla aday ya da yapısız serbest metin seçilmez.
    result.kumasTipi = field(leftovers.shift(), CONFIDENCE.INFERRED, { canonical: '' });
  }
  result.unknownTokens = leftovers;
  return result;
}

function normalizeYarnUnit(unit) {
  const key = fold(unit);
  if (key === 'NE') return 'Ne';
  if (key === 'NM') return 'Nm';
  if (key === 'DTEX') return 'dtex';
  if (key === 'D' || key === 'DEN' || key === 'DENIER') return 'den';
  return '';
}

function compositionKey(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map(item => `${item.material || 'OTHER'}:${Number(item.percent)}`)
    .sort().join('|');
}

/* ---------------- Karşılaştırma için normalleştiriciler ---------------- */

function weightNumber(value) {
  const match = fold(value).match(/(\d{2,4}(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(',', '.')) : null;
}
function asasCompositionKey(value) {
  const parsed = parseMainFabricInfo(value).karisim;
  return parsed.key || '';
}
// "30/1 Ne" ile "30 Ne" tek katlı aynı ipliktir; kat sayısı 1 dışındaysa korunur.
function yarnKey(value) {
  const text = fold(value).replace(/\s*,\s*/g, ' ');
  const unitMatch = text.match(/\b(NE|NM|DTEX|DENIER|DEN)\b|\d\s*D\b/);
  const unit = unitMatch ? normalizeYarnUnit(unitMatch[1] || 'D') : '';
  const countMatch = text.match(/(\d{1,3})(?:\s*\/\s*(\d{1,2}))?/);
  if (!countMatch) return '';
  const ply = countMatch[2] && countMatch[2] !== '1' ? `/${countMatch[2]}` : '';
  return `${countMatch[1]}${ply}${unit ? ` ${unit}` : ''}`;
}
function sameYarn(asasValue, plmValue) {
  const a = yarnKey(asasValue), b = yarnKey(plmValue);
  if (!a || !b) return false;
  if (a === b) return true;
  // Bir taraf birimsizse yalnız sayı/kat karşılaştırılır.
  const strip = key => key.replace(/\s+\S+$/, '');
  return (!/\s/.test(a) || !/\s/.test(b)) && strip(a) === strip(b);
}
function sameDictionaryValue(dictionary, asasValue, plmField) {
  const asasCanonical = canonicalOf(dictionary, asasValue);
  const plmCanonical = plmField.canonical || canonicalOf(dictionary, plmField.value);
  if (asasCanonical && plmCanonical) return asasCanonical === plmCanonical;
  return words(asasValue) === words(plmField.value);
}

function compareField(fieldName, asasValue, parsed) {
  if (NOT_IN_PLM_FIELDS.includes(fieldName)) return COMPARISON.NOT_IN_PLM;
  const plmField = parsed && parsed[fieldName];
  const asasText = clean(asasValue);
  if (!plmField || !plmField.value) return asasText ? COMPARISON.PLM_MISSING : COMPARISON.ASAS_EMPTY;
  if (!asasText) return COMPARISON.ASAS_EMPTY;
  let same;
  if (fieldName === 'fabricWeight') same = weightNumber(asasText) != null && weightNumber(asasText) === weightNumber(plmField.value);
  else if (fieldName === 'karisim') { const key = asasCompositionKey(asasText); same = Boolean(key) && key === plmField.key; }
  else if (fieldName === 'iplikNo') same = sameYarn(asasText, plmField.value);
  else if (fieldName === 'kumasTipi') same = sameDictionaryValue(FABRIC_TYPE_ALIASES, asasText, plmField);
  else if (fieldName === 'fabricCategory') same = sameDictionaryValue(CATEGORY_ALIASES, asasText, plmField);
  else same = words(asasText) === words(plmField.value);
  return same ? COMPARISON.MATCH : COMPARISON.DIFFERENT;
}

const plmKey = value => String(value == null ? '' : value).trim().replace(/\.0+$/, '').toUpperCase();

/* PLM kayıtlarından PLM ID → ham mainFabricInfo haritası. Aynı PLM ID'de
   farklı ham metin varsa ilk dolu değer kullanılır ve çakışma sayılır. */
function plmFabricIndex(records) {
  const byPlm = new Map();
  let conflicts = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const id = plmKey(record.plmId ?? record.plm ?? record['PLM ID']);
    const raw = clean(record.fabric ?? record.mainFabricInfo);
    if (!id || !raw) continue;
    const current = byPlm.get(id);
    if (!current) byPlm.set(id, { raw, conflict: false });
    else if (current.raw !== raw && !current.conflict) { current.conflict = true; conflicts++; }
  }
  return { byPlm, conflicts };
}

/* ASAS siparişleri ↔ PLM kayıtları. Yalnız ölçüm üretir; girdileri değiştirmez.
   Kimlik: ASAS "Plm Kod" = PLM ID. Aynı sipariş/model/renk bir kez sayılır. */
function compareFabricSources(asasOrders, plmRecords, options = {}) {
  const sampleLimit = Number.isInteger(options.sampleLimit) ? Math.max(0, options.sampleLimit) : 50;
  const { byPlm, conflicts } = plmFabricIndex(plmRecords);
  const parsedCache = new Map();
  const parsedFor = raw => {
    if (!parsedCache.has(raw)) parsedCache.set(raw, parseMainFabricInfo(raw));
    return parsedCache.get(raw);
  };
  const emptyCounts = () => Object.fromEntries(Object.values(COMPARISON).map(key => [key, 0]));
  const byField = Object.fromEntries(FIELDS.map(name => [name, emptyCounts()]));
  const confidence = Object.fromEntries(FIELDS.map(name => [name, { EXACT: 0, INFERRED: 0, UNKNOWN: 0 }]));
  const samples = [];
  const seen = new Set();
  let orders = 0, withPlmId = 0, withPlmFabric = 0;
  for (const order of Array.isArray(asasOrders) ? asasOrders : []) {
    if (!order || typeof order !== 'object') continue;
    const identity = [order.ocode, order.model, order.ccode].map(value => String(value == null ? '' : value).trim()).join('\u0000');
    if (seen.has(identity)) continue;
    seen.add(identity);
    orders++;
    const id = plmKey(order.plm);
    if (id) withPlmId++;
    const entry = id ? byPlm.get(id) : null;
    const parsed = entry ? parsedFor(entry.raw) : null;
    if (parsed) withPlmFabric++;
    for (const name of FIELDS) {
      const status = compareField(name, order[name], parsed);
      byField[name][status]++;
      if (parsed && !NOT_IN_PLM_FIELDS.includes(name)) confidence[name][parsed[name].confidence]++;
      if (status === COMPARISON.DIFFERENT && samples.length < sampleLimit) {
        samples.push({
          orderCode: order.ocode == null ? '' : String(order.ocode),
          model: clean(order.model), colourCode: clean(order.ccode), plmId: id,
          field: name, asasValue: clean(order[name]), plmValue: parsed[name].value,
          plmConfidence: parsed[name].confidence, plmRaw: entry.raw,
        });
      }
    }
  }
  const fields = Object.fromEntries(FIELDS.map(name => {
    const counts = byField[name];
    const compared = counts.MATCH + counts.DIFFERENT;
    return [name, { ...counts, compared, matchRate: compared ? Math.round((counts.MATCH / compared) * 10000) / 100 : null, plmConfidence: NOT_IN_PLM_FIELDS.includes(name) ? null : confidence[name] }];
  }));
  return {
    orders,
    withPlmId,
    withPlmFabric,
    plmCoverageRate: orders ? Math.round((withPlmFabric / orders) * 10000) / 100 : null,
    plmFabricConflicts: conflicts,
    fields,
    notInPlmFields: [...NOT_IN_PLM_FIELDS],
    differenceSamples: samples,
  };
}

module.exports = {
  CONFIDENCE,
  COMPARISON,
  FIELDS,
  NOT_IN_PLM_FIELDS,
  parseMainFabricInfo,
  compositionKey,
  yarnKey,
  compareField,
  compareFabricSources,
};
