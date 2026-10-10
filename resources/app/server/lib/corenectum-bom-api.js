'use strict';

/* CoreNectum Style BOM — saf istek/yanıt sözleşmesi + baskı yerleşimi analizi.
 *
 * Canlı CoreNectum trafiğinde doğrulanan uç:
 *   POST .../StyleMainInformation/GetStyleBomInformation
 *   body: { styleId: <number> }
 *
 * Bu modül ağ/oturum bilmez. Ham BOM'dan yalnız Buyer Log'un ihtiyaç duyduğu
 * normalize edilmiş embellishment/print kanıtını çıkarır. Label/Sticker gibi
 * "SEE ARTWORK" taşıyan fakat Print olmayan satırlar baskı sayılmaz.
 */
const crypto = require('crypto');

const GET_STYLE_BOM_INFORMATION_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleMainInformation/GetStyleBomInformation';

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}
function coreId(value) {
  let text = clean(value, 80).replace(/^_+/, '');
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  text = text.replace(/^0+(?=\d)/, '');
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}
function norm(value) {
  return clean(value, 500)
    .toLocaleLowerCase('tr-TR')
    .replace(/[\/_-]+/g, ' ')
    .replace(/[^a-z0-9çğıöşü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function bomRequestBody(styleId) {
  const id = coreId(styleId);
  if (!id) throw Object.assign(new Error('Geçerli bir Style ID gerekli.'), { code: 'CORENECTUM_STYLE_ID_REQUIRED' });
  const numeric = Number(id);
  return { styleId: Number.isSafeInteger(numeric) ? numeric : id };
}
function bomBucket(payload) {
  const root = payload && payload.data && payload.data.coreNectumResultData;
  const styleBom = root && root.styleBom;
  return styleBom && typeof styleBom === 'object' ? styleBom : null;
}
function bomComponents(payload) {
  const bucket = bomBucket(payload);
  return bucket && Array.isArray(bucket.styleBomComponents) ? bucket.styleBomComponents : [];
}
function normalizeComponent(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    styleBomComponentId: coreId(item.styleBomComponentId) || clean(item.styleBomComponentId, 80),
    componentId: coreId(item.componentId) || clean(item.componentId, 80),
    componentCode: clean(item.componentCode, 120),
    componentName: clean(item.componentName, 500),
    description: clean(item.description, 500),
    componentType: clean(item.componentType, 120),
    mainCategoryId: Number.isFinite(Number(item.mainCategoryId)) ? Number(item.mainCategoryId) : null,
    mainCategoryName: clean(item.mainCategoryName, 160),
    categoryId: Number.isFinite(Number(item.categoryId)) ? Number(item.categoryId) : null,
    categoryName: clean(item.categoryName, 160),
    categoryGroupId: Number.isFinite(Number(item.categoryGroupId)) ? Number(item.categoryGroupId) : null,
    categoryGroupName: clean(item.categoryGroupName, 160),
    imageUrl: clean(item.imageUrl, 2000),
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
    graphicApprovalStatusName: clean(item.graphicApprovalStatusName, 160),
    licenseBrandName: clean(item.licenseBrandName, 200),
    licenseCharacterName: clean(item.licenseCharacterName, 200),
  };
}
function isEmbellishment(component) {
  return Boolean(component && (component.mainCategoryId === 1 || norm(component.mainCategoryName) === 'embellishment'));
}
function isPrint(component) {
  return Boolean(component && isEmbellishment(component)
    && (component.categoryId === 21 || norm(component.categoryName) === 'print'));
}

const PLACEMENTS = Object.freeze({
  front_body: Object.freeze({ key: 'front_body', tr: 'Ön', en: 'Front', count: 1 }),
  back_body: Object.freeze({ key: 'back_body', tr: 'Arka', en: 'Back', count: 1 }),
  left_sleeve: Object.freeze({ key: 'left_sleeve', tr: 'Sol Kol', en: 'Left Sleeve', count: 1 }),
  right_sleeve: Object.freeze({ key: 'right_sleeve', tr: 'Sağ Kol', en: 'Right Sleeve', count: 1 }),
  both_sleeves: Object.freeze({ key: 'both_sleeves', tr: 'Kollar', en: 'Sleeves', count: 2 }),
  sleeve: Object.freeze({ key: 'sleeve', tr: 'Kol', en: 'Sleeve', count: 1 }),
  chest: Object.freeze({ key: 'chest', tr: 'Göğüs', en: 'Chest', count: 1 }),
  pocket: Object.freeze({ key: 'pocket', tr: 'Cep', en: 'Pocket', count: 1 }),
  hood: Object.freeze({ key: 'hood', tr: 'Kapüşon', en: 'Hood', count: 1 }),
  left_leg: Object.freeze({ key: 'left_leg', tr: 'Sol Bacak', en: 'Left Leg', count: 1 }),
  right_leg: Object.freeze({ key: 'right_leg', tr: 'Sağ Bacak', en: 'Right Leg', count: 1 }),
  both_legs: Object.freeze({ key: 'both_legs', tr: 'Bacaklar', en: 'Legs', count: 2 }),
  leg: Object.freeze({ key: 'leg', tr: 'Bacak/Paça', en: 'Leg', count: 1 }),
  all_over: Object.freeze({ key: 'all_over', tr: 'All Over', en: 'All Over', count: 1 }),
  other: Object.freeze({ key: 'other', tr: 'Diğer', en: 'Other', count: 1 }),
});

function placementMeta(key) { return PLACEMENTS[key] || PLACEMENTS.other; }

/* Analiz kuralı değiştiğinde artır: BOM fingerprint'ine girer, böylece
   verisi değişmemiş eski kayıtlar da bir sonraki PLM Sync'te yeni kuralla
   yeniden çözümlenir. */
const ANALYZER_VERSION = 2;

const RX = Object.freeze({
  all_over: /(^| )(all over|allover|tüm yüzey|tum yuzey|tüm beden|tum beden|all body)( |$)/,
  left_sleeve: /(^| )(sol kol|left sleeve|left arm)( |$)/,
  right_sleeve: /(^| )(sağ kol|sag kol|right sleeve|right arm)( |$)/,
  both_sleeves: /(^| )(kollar|both sleeves|sleeves)( |$)/,
  front_body: /(^| )(ön beden|on beden|front body|front panel|ön panel|on panel)( |$)/,
  back_body: /(^| )(arka beden|back body|back panel|arka panel)( |$)/,
  front_back: /(^| )(ön ve arka|on ve arka|ön arka beden|on arka beden|front and back|front back body)( |$)/,
  left_leg: /(^| )(sol bacak|left leg)( |$)/,
  right_leg: /(^| )(sağ bacak|sag bacak|right leg)( |$)/,
  both_legs: /(^| )(bacaklar|both legs)( |$)/,
  chest: /(^| )(göğüs|gogus|chest)( |$)/,
  pocket: /(^| )(cep|pocket)( |$)/,
  hood: /(^| )(kapüşon|kapuson|hood)( |$)/,
  sleeve: /(^| )(kol|sleeve|arm)( |$)/,
  leg: /(^| )(paça|paca|leg)( |$)/,
});

/* Bir Print satırı birden çok bölgeyi kapsayabilir
   (ör. "ÖN BEDEN + ARKA BEDEN + FRONT BODY + BACK BODY" = Ön 1 + Arka 1).
   Göğüs/cep gövde içi alt konumdur; gövde bölgesi yoksa tek başına sayılır. */
function detectPlacements(description) {
  const text = norm(description);
  if (!text) return [PLACEMENTS.other];
  if (RX.all_over.test(text)) return [PLACEMENTS.all_over];
  const keys = [];
  const frontBack = RX.front_back.test(text);
  if (frontBack || RX.front_body.test(text)) keys.push('front_body');
  if (frontBack || RX.back_body.test(text)) keys.push('back_body');
  const left = RX.left_sleeve.test(text), right = RX.right_sleeve.test(text);
  if ((left && right) || RX.both_sleeves.test(text)) keys.push('both_sleeves');
  else if (left) keys.push('left_sleeve');
  else if (right) keys.push('right_sleeve');
  else if (RX.sleeve.test(text)) keys.push('sleeve');
  const leftLeg = RX.left_leg.test(text), rightLeg = RX.right_leg.test(text);
  if ((leftLeg && rightLeg) || RX.both_legs.test(text)) keys.push('both_legs');
  else if (leftLeg) keys.push('left_leg');
  else if (rightLeg) keys.push('right_leg');
  else if (RX.leg.test(text)) keys.push('leg');
  if (RX.hood.test(text)) keys.push('hood');
  if (!keys.includes('front_body') && !keys.includes('back_body')) {
    if (RX.chest.test(text)) keys.push('chest');
    else if (RX.pocket.test(text)) keys.push('pocket');
  }
  if (!keys.length) return [PLACEMENTS.other];
  const order = Object.keys(PLACEMENTS);
  return keys.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(placementMeta);
}

function detectPlacement(description) {
  return detectPlacements(description)[0];
}

function placementEntry(component, place) {
  return {
    componentCode: clean(component && component.componentCode, 120),
    styleBomComponentId: clean(component && component.styleBomComponentId, 80),
    placement: place.key,
    placementTr: place.tr,
    placementEn: place.en,
    count: place.count,
    printType: clean(component && (component.categoryGroupName || component.categoryName), 160) || 'Print',
    categoryName: clean(component && component.categoryName, 160),
    description: clean(component && component.description, 500),
    quantity: component && component.quantity != null ? component.quantity : null,
    imageUrl: clean(component && component.imageUrl, 2000),
    graphicApprovalStatusName: clean(component && component.graphicApprovalStatusName, 160),
  };
}

function placementFromComponent(component) {
  return placementEntry(component, detectPlacement(component && component.description));
}

function placementsFromComponent(component) {
  return detectPlacements(component && component.description).map(place => placementEntry(component, place));
}

/* All Over baskı kumaş detayında yazdığı için Artwork özetine/sayısına girmez.
   Bölgeler aynı tekniği paylaşıyorsa "Ön: 1 • Arka: 1 | Pigment | Toplam: 2";
   teknikler farklıysa her bölge kendi tekniğiyle yazılır:
   "Ön: 1 | Pigment • Arka: 1 | Transfer | Toplam: 2". */
function formatPlacementSummary(placements, labelOf, totalLabel, noneLabel) {
  const grouped = new Map();
  const techniques = new Set();
  let total = 0;
  for (const item of Array.isArray(placements) ? placements : []) {
    if (!item || item.placement === 'all_over') continue;
    const meta = placementMeta(item.placement);
    const label = labelOf(item, meta);
    const count = Math.max(1, Math.min(20, Number(item.count) || meta.count || 1));
    const technique = clean(item.printType, 160);
    total += count;
    const group = grouped.get(label) || { key: meta.key, count: 0, techniques: new Set() };
    group.count += count;
    if (technique) { group.techniques.add(technique); techniques.add(technique); }
    grouped.set(label, group);
  }
  const order = Object.keys(PLACEMENTS);
  const groups = [...grouped].sort((a, b) => order.indexOf(a[1].key) - order.indexOf(b[1].key));
  const techOf = group => [...group.techniques].join(' + ');
  const uniform = new Set(groups.map(([, group]) => techOf(group))).size <= 1;
  const parts = groups.map(([label, group]) => `${label}: ${group.count}`);
  const tech = [...techniques];
  let summary = noneLabel;
  if (total) {
    summary = uniform
      ? `${parts.join(' • ')}${tech.length ? ` | ${tech.join(' + ')}` : ''} | ${totalLabel}: ${total}`
      : `${groups.map(([label, group]) => `${label}: ${group.count}${techOf(group) ? ` | ${techOf(group)}` : ''}`).join(' • ')} | ${totalLabel}: ${total}`;
  }
  return { total, parts, tech, summary };
}

function summaryForPlacements(placements) {
  const result = formatPlacementSummary(placements, (_item, meta) => meta.tr, 'Toplam', 'Baskı yok');
  return {
    totalPrintCount: result.total,
    placementSummary: result.parts.join(' • '),
    techniqueSummary: result.tech.join(' + '),
    summary: result.summary,
  };
}

function fingerprint(styleBom, components) {
  const payload = {
    analyzerVersion: ANALYZER_VERSION,
    styleBomId: coreId(styleBom && styleBom.styleBomId) || clean(styleBom && styleBom.styleBomId, 80),
    components: (Array.isArray(components) ? components : []).map(item => ({
      styleBomComponentId: item.styleBomComponentId,
      componentCode: item.componentCode,
      description: item.description,
      mainCategoryId: item.mainCategoryId,
      mainCategoryName: item.mainCategoryName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      categoryGroupId: item.categoryGroupId,
      categoryGroupName: item.categoryGroupName,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
    })).sort((a, b) => String(a.styleBomComponentId || a.componentCode).localeCompare(String(b.styleBomComponentId || b.componentCode))),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function analyzeBom(payload) {
  const styleBom = bomBucket(payload) || {};
  const normalized = bomComponents(payload).map(normalizeComponent).filter(Boolean);
  const decorations = normalized.filter(isEmbellishment);
  const prints = decorations.filter(isPrint);
  const placements = prints.flatMap(placementsFromComponent);
  const unknown = placements.filter(item => item.placement === 'other');
  const summary = summaryForPlacements(placements);
  return {
    styleId: coreId(styleBom.styleId),
    styleBomId: coreId(styleBom.styleBomId),
    sourceCreatedDate: clean(styleBom.createdDate, 80) || null,
    sourceModifiedDate: clean(styleBom.modifiedDate, 80) || null,
    fingerprint: fingerprint(styleBom, decorations),
    components: decorations,
    fullComponents: normalized,
    fullFingerprint: crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
    fullComponentCount: normalized.length,
    placements,
    ...summary,
    hasPrint: summary.totalPrintCount > 0,
    needsAi: unknown.length > 0,
    ambiguousComponentCodes: unknown.map(item => item.componentCode || item.styleBomComponentId).filter(Boolean),
  };
}

function normalizeAiPlacement(item, unknownByCode) {
  if (!item || typeof item !== 'object') return null;
  const code = clean(item.componentCode || item.styleBomComponentId, 120);
  if (!code || !unknownByCode.has(code)) return null;
  const key = clean(item.placement, 40).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PLACEMENTS, key) || key === 'other') return null;
  const meta = placementMeta(key);
  return {
    code,
    placement: key,
    placementTr: meta.tr,
    placementEn: meta.en,
    count: meta.count,
    confidence: ['high', 'medium', 'low'].includes(clean(item.confidence, 20).toLowerCase()) ? clean(item.confidence, 20).toLowerCase() : '',
    reason: clean(item.reason, 500),
  };
}

function mergeAiAnalysis(base, aiObject) {
  const analysis = base && typeof base === 'object' ? JSON.parse(JSON.stringify(base)) : null;
  if (!analysis || !Array.isArray(analysis.placements)) return analysis;
  const unknownByCode = new Map();
  for (const item of analysis.placements.filter(item => item.placement === 'other')) {
    for (const key of [item.componentCode, item.styleBomComponentId].map(value => clean(value, 120)).filter(Boolean)) unknownByCode.set(key, item);
  }
  const accepted = (Array.isArray(aiObject && aiObject.placements) ? aiObject.placements : [])
    .map(item => normalizeAiPlacement(item, unknownByCode)).filter(Boolean);
  const applied = new Set();
  for (const item of accepted) {
    const target = unknownByCode.get(item.code);
    if (!target || applied.has(target)) continue;
    target.placement = item.placement;
    target.placementTr = item.placementTr;
    target.placementEn = item.placementEn;
    target.count = item.count;
    target.aiResolved = true;
    target.aiConfidence = item.confidence || clean(aiObject && aiObject.confidence, 20).toLowerCase();
    target.aiReason = item.reason;
    applied.add(target);
  }
  const summary = summaryForPlacements(analysis.placements);
  Object.assign(analysis, summary, {
    hasPrint: summary.totalPrintCount > 0,
    needsAi: analysis.placements.some(item => item.placement === 'other'),
    ambiguousComponentCodes: analysis.placements.filter(item => item.placement === 'other').map(item => item.componentCode || item.styleBomComponentId).filter(Boolean),
  });
  return analysis;
}

module.exports = {
  GET_STYLE_BOM_INFORMATION_URL,
  PLACEMENTS,
  clean,
  coreId,
  bomRequestBody,
  bomBucket,
  bomComponents,
  normalizeComponent,
  isEmbellishment,
  isPrint,
  ANALYZER_VERSION,
  detectPlacement,
  detectPlacements,
  placementFromComponent,
  placementsFromComponent,
  summaryForPlacements,
  analyzeBom,
  mergeAiAnalysis,
};
