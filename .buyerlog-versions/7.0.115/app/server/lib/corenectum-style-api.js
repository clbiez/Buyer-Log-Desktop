'use strict';

/* CoreNectum Style API — SAF istek/yanıt sözleşmesi ve görsel seçim politikası.
 *
 * NEDEN VAR: Model görselini bulmak için eskiden kullanıcının GÖRÜNEN Style
 * List ekranı sürülüyordu — yakalanan GetStyleList isteği filtresiz biçimde
 * SAYFA SAYFA dolaşılıyor (15-20 bin satır), sonra gerekirse model detay
 * (Style Overview) sayfasının DOM'u okunuyordu. 400-500 modellik normal bir
 * iş bile listenin tamamını taramak zorundaydı.
 *
 * CANLI DOĞRULAMA (kullanıcının kendi CoreNectum oturumunda ölçüldü):
 *   - GetStyleList, plmCode alanında filterOperator 10 ("virgülle ayrılmış
 *     listede var") ile TEK istekte 22/22 PLM döndürdü.
 *   - 100'lük partiler tekrar tekrar 100/100 döndürdü, tipik ~0,8-1,3 sn.
 *   - GetStyleImages renk bazlı Option Image'ları veriyor; renk için model
 *     detay sayfasına gitmek gereksiz.
 *
 * Bu modül BİLEREK saftır: ağ, tarayıcı, dosya sistemi bilmez. Böylece istek
 * gövdesi, parti bölme, alan çıkarımı ve seçim politikası belirlenimci olarak
 * sınanabilir. Ağ tarafı agent-browser-connector (yetkili metadata) ve
 * plm-image-download-queue (Attachment indirme) içindedir.
 */

const { normalizeCpImageColourCode } = require('./parse');

const GET_STYLE_LIST_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleList/GetStyleList';
const GET_STYLE_IMAGES_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleMainInformation/GetStyleImages';

/* plmCode süzgeci: 10 = "virgülle ayrılmış değer listesinden biri".
   Canlı trafikte ÖLÇÜLDÜ; tahmin değildir. */
const PLM_CODE_FILTER_OPERATOR = 10;
const PLM_CODE_FILTER_COLUMN = 'plmCode';

// Canlı ölçümle doğrulanan parti boyu ve başarısız parti için düşüş basamakları.
const STYLE_LIST_BATCH_SIZE = 100;
const STYLE_LIST_FALLBACK_SIZES = Object.freeze([50, 20]);
// Sınırlı eşzamanlılık: paket sözleşmesindeki varsayılanlar.
const STYLE_IMAGES_CONCURRENCY = 5;
const IMAGE_DOWNLOAD_CONCURRENCY = 8;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 16;

const SOURCE_OPTION = 'OPTION';
const SOURCE_STYLE_DEFAULT = 'STYLE_DEFAULT';
const SOURCE_STYLE_LIST = 'STYLE_LIST';
const SOURCE_MISSING = 'MISSING';
const IMAGE_ROLE_AUTO = 'auto';
const IMAGE_ROLE_MAIN = 'main';
const IMAGE_ROLE_OPTION = 'option';
// Otomatik kaynak önceliği. Kullanıcının elle koyduğu görsel bu sıranın
// ÜSTÜNDEDİR; o kural plm-image-ownership.js içindedir.
const SOURCE_PRIORITY = Object.freeze([SOURCE_OPTION, SOURCE_STYLE_DEFAULT, SOURCE_STYLE_LIST]);

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

/* Sayısal CoreNectum kimliği (plmCode, styleId, styleOptionImageId…).
   123, 123.0 ve 000123 aynı kimliktir. */
function coreId(value) {
  let text = clean(value, 80).replace(/^_+/, '');
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  text = text.replace(/^0+(?=\d)/, '');
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function normalizeColourCode(value) {
  return normalizeCpImageColourCode(value);
}

function normalizeImageRole(value) {
  const role = clean(value, 20).toLowerCase();
  if (role === IMAGE_ROLE_MAIN || role === IMAGE_ROLE_OPTION) return role;
  return IMAGE_ROLE_AUTO;
}

function boundedConcurrency(value, fallback) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, number));
}

/* Yalnız CoreNectum Attachment servisine izin verilir. Kaynaktan gelen keyfi
   bir URL indirme kuyruğuna GİRMEZ: yanıt gövdesi dış bir hostu işaret
   ediyorsa bu bir veri sızdırma yoluna dönüşebilirdi. */
function attachmentUrl(value) {
  try {
    const url = new URL(clean(value, 2000));
    if (url.protocol !== 'https:') return '';
    if (!/(^|\.)lcwaikiki\.com$/i.test(url.hostname)) return '';
    if (!/\/Attachment\/GetAttachment\//i.test(url.pathname)) return '';
    return url.href;
  } catch (_) { return ''; }
}

/* Attachment kimliği: aynı görselin URL'si sorgu dizesiyle değişse de
   (bl_refresh gibi) kimliği aynı kalsın. */
function attachmentIdentity(value) {
  const url = attachmentUrl(value);
  if (!url) return '';
  try { return new URL(url).pathname.replace(/\/+$/, '').toLowerCase(); }
  catch (_) { return ''; }
}

function dedupePlmCodes(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = coreId(typeof value === 'object' && value ? (value.plmId ?? value.plmCode) : value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/* GetStyleList parti gövdesi — canlı doğrulanmış biçim.
   pageSize parti boyundan KÜÇÜK olamaz; aksi hâlde sunucu sayfalar ve parti
   "eksik döndü" sanılır. */
function styleListBatchBody(plmCodes, options = {}) {
  const codes = dedupePlmCodes(plmCodes);
  const requested = Math.trunc(Number(options.pageSize)) || 0;
  const pageSize = Math.max(requested, codes.length + 20, STYLE_LIST_BATCH_SIZE + 20);
  return {
    pageNumber: Math.max(1, Math.trunc(Number(options.pageNumber)) || 1),
    pageSize,
    filterCriterias: [{
      filterColumnName: PLM_CODE_FILTER_COLUMN,
      filterOperator: PLM_CODE_FILTER_OPERATOR,
      filterValue: codes.join(','),
    }],
    searchCriteria: { columnNames: [], searchText: '' },
    favoriteGroupId: null,
  };
}

/* Başarısız partiyi tekil PLM'lere indirmek yerine 100 -> 50 -> 20 basamakları
   denenir. 0 dönerse artık bölme yoktur; partideki PLM'ler başarısızdır. */
function nextFallbackBatchSize(currentSize) {
  const size = Math.trunc(Number(currentSize)) || 0;
  for (const candidate of STYLE_LIST_FALLBACK_SIZES) if (size > candidate) return candidate;
  return 0;
}

function splitBatches(values, size) {
  const step = Math.max(1, Math.trunc(Number(size)) || STYLE_LIST_BATCH_SIZE);
  const codes = dedupePlmCodes(values);
  const out = [];
  for (let index = 0; index < codes.length; index += step) out.push(codes.slice(index, index + step));
  return out;
}

/* Yanıt gövdesi beklenen yolda değilse (sürüm farkı) iç içe aranır. Bu
   davranış corenectum-plm-integrity-v825'te korunan regression'dır: geçerli
   bir yanıt başka bir sonuç dizisinde durduğu için "boş" sanılıyordu. */
function styleListRecords(payload) {
  const preferred = payload && payload.data && payload.data.coreNectumResultData
    && payload.data.coreNectumResultData.styleListResult;
  if (Array.isArray(preferred) && preferred.length) return preferred;
  let source = null;
  const visit = (value, depth = 0) => {
    if (source || depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      if (value.some(item => item && typeof item === 'object' && ('styleId' in item) && ('plmCode' in item))) { source = value; return; }
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value === 'object') Object.values(value).forEach(item => visit(item, depth + 1));
  };
  visit(payload);
  return Array.isArray(source) ? source : (Array.isArray(preferred) ? preferred : []);
}

function styleColours(value) {
  return (Array.isArray(value) ? value : []).map(item => {
    if (!item || typeof item !== 'object') return null;
    const colourCode = clean(item.colorCode ?? item.colourCode ?? item.code, 80);
    const name = clean(item.name ?? item.colorName ?? item.colourName, 160);
    if (!colourCode && !name) return null;
    return { colourCode, colour: name, hexCode: clean(item.hexCode ?? item.hex, 40), pantone: clean(item.pantone, 60) };
  }).filter(Boolean);
}

function styleListRow(record) {
  const plmId = coreId(record && record.plmCode);
  const styleId = coreId(record && record.styleId);
  if (!plmId) return null;
  const imageUrl = attachmentUrl((record && record.model && record.model.imageUrl) || (record && record.imageUrl));
  return {
    plmId,
    styleId,
    styleName: clean(record && record.styleName, 300),
    imageUrl,
    colors: styleColours(record && (record.colors || record.colours)),
  };
}

/* Aynı PLM Code için çelişen birden fazla satır gelirse keyfi satır seçilmez;
   PLM "belirsiz" sayılır (CORENECTUM_STYLE_AMBIGUOUS). */
function styleListRowsByPlm(payload) {
  const rows = new Map();
  const ambiguous = new Set();
  for (const record of styleListRecords(payload)) {
    const row = styleListRow(record);
    if (!row) continue;
    const previous = rows.get(row.plmId);
    if (!previous) { rows.set(row.plmId, row); continue; }
    if (previous.styleId !== row.styleId || previous.imageUrl !== row.imageUrl) ambiguous.add(row.plmId);
  }
  for (const plmId of ambiguous) rows.delete(plmId);
  return { rows, ambiguous: [...ambiguous] };
}

function styleImagesRequestBody(styleId) {
  const id = coreId(styleId);
  if (!id) throw Object.assign(new Error('Geçerli bir Style ID gerekli.'), { code: 'CORENECTUM_STYLE_ID_REQUIRED' });
  return { styleId: id };
}

function firstArray(...candidates) {
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate;
  return [];
}

function truthy(value) {
  if (value === true) return true;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === '1';
}

function normalizeStyleImage(item) {
  const imageUrl = attachmentUrl(item && item.imageUrl);
  if (!imageUrl) return null;
  return {
    imageUrl,
    isDefault: truthy(item && item.isDefault),
    imageType: clean(item && item.imageType, 120),
    imageName: clean(item && item.imageName, 300),
    attachmentAssociationId: coreId(item && item.attachmentAssociationId) || clean(item && item.attachmentAssociationId, 80),
  };
}

function normalizeOptionImage(item) {
  const imageUrl = attachmentUrl(item && item.imageUrl);
  if (!imageUrl) return null;
  return {
    imageUrl,
    styleOptionId: coreId(item && item.styleOptionId) || clean(item && item.styleOptionId, 80),
    styleOptionImageId: coreId(item && item.styleOptionImageId) || clean(item && item.styleOptionImageId, 80),
    colourCode: clean(item && (item.colorCode ?? item.colourCode), 80),
    colour: clean(item && item.name, 160),
    hexCode: clean(item && item.hexCode, 40),
    pantone: clean(item && item.pantone, 60),
    imageType: clean(item && item.imageType, 120),
    imageName: clean(item && item.imageName, 300),
    isDefault: truthy(item && item.isDefault),
  };
}

/* GetStyleImages yanıtı: styleImages.StyleImages[] ve
   styleOptionImages.OptionImages[]. Yanıt sarmalayıcısı sürümler arasında
   değişebildiği için data/result altları da denenir. */
function parseStyleImages(payload) {
  const root = (payload && payload.data) || payload || {};
  const core = root.coreNectumResultData || root.result || root;
  const styleBucket = core.styleImages || root.styleImages || {};
  const optionBucket = core.styleOptionImages || root.styleOptionImages || {};
  const styleImages = firstArray(styleBucket.StyleImages, styleBucket.styleImages, Array.isArray(styleBucket) ? styleBucket : null)
    .map(normalizeStyleImage).filter(Boolean);
  const optionImages = firstArray(optionBucket.OptionImages, optionBucket.optionImages, Array.isArray(optionBucket) ? optionBucket : null)
    .map(normalizeOptionImage).filter(Boolean);
  return { styleImages, optionImages };
}

/* Aynı styleId birden çok renk için istenmiş olabilir: metadata TEK kez
   çekilir. Renk başına GetStyleImages çağırmak yanıtı değiştirmez, yalnız
   CoreNectum'u gereksiz meşgul eder. */
function uniqueStyleIdPlan(requests) {
  const byStyleId = new Map();
  const unresolved = [];
  for (const request of Array.isArray(requests) ? requests : []) {
    const styleId = coreId(request && request.styleId);
    const plmId = coreId(request && request.plmId);
    if (!styleId) { if (plmId) unresolved.push(request); continue; }
    if (!byStyleId.has(styleId)) byStyleId.set(styleId, { styleId, plmIds: [], requests: [] });
    const entry = byStyleId.get(styleId);
    if (plmId && !entry.plmIds.includes(plmId)) entry.plmIds.push(plmId);
    entry.requests.push(request);
  }
  return { styleIds: [...byStyleId.keys()], byStyleId, unresolved };
}

function stableBy(items, keyOf) {
  return items.slice().sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber;
    return String(left).localeCompare(String(right));
  });
}

/* ======================================================================
   GÖRSEL SEÇİM POLİTİKASI

   1. Renk Kodu birebir eşleşen Option Image.
   2. Yoksa isDefault === true olan Style Image.
   3. Yoksa GetStyleList satırının imageUrl alanı.
   4. Yoksa görsel YOK.

   KRİTİK: "ilk Style Image" veya keyfi bir Style Image ASLA seçilmez. Gerçek
   CoreNectum verisi teknik çizimlerin de imageType == "Style Image" ile
   geldiğini kanıtladı; imageType bu yüzden güvenilir bir ayraç DEĞİLDİR.
   Tek güvenilir işaret isDefault bayrağıdır. Varsayılan olmayan bir Style
   Image Buyer Log model görseli olamaz.
   ====================================================================== */
function selectColourImage({ colourCode, imageRole = IMAGE_ROLE_AUTO, optionImages = [], styleImages = [], styleListImageUrl = '' } = {}) {
  const wanted = normalizeColourCode(colourCode);
  const role = normalizeImageRole(imageRole);
  const listUrl = attachmentUrl(styleListImageUrl);

  const matches = wanted
    ? optionImages.filter(item => normalizeColourCode(item && (item.colourCode ?? item.colorCode)) === wanted
      && attachmentUrl(item && item.imageUrl))
    : [];
  const optionPick = () => {
    if (!matches.length) return null;
    const preferred = matches.filter(item => item.isDefault);
    const pick = stableBy(preferred.length ? preferred : matches, item => item.styleOptionImageId)[0];
    return {
      sourceType: SOURCE_OPTION,
      imageUrl: attachmentUrl(pick.imageUrl),
      sourceIdentity: optionIdentity(pick),
      colour: clean(pick.colour ?? pick.name, 160),
      reason: 'Exact ColourCode Option Image.',
      candidateCount: matches.length,
    };
  };

  // isDefault SADECE birebir true kabul edilir: keyfi teknik çizim seçilmez.
  const defaults = styleImages.filter(item => item && truthy(item.isDefault) && attachmentUrl(item.imageUrl));
  const defaultPick = reason => {
    if (!defaults.length) return null;
    const pick = stableBy(defaults, item => item.attachmentAssociationId)[0];
    return {
      sourceType: SOURCE_STYLE_DEFAULT,
      imageUrl: attachmentUrl(pick.imageUrl),
      sourceIdentity: styleDefaultIdentity(pick),
      colour: '',
      reason,
      candidateCount: defaults.length,
    };
  };
  const listPick = reason => listUrl ? {
    sourceType: SOURCE_STYLE_LIST,
    imageUrl: listUrl,
    sourceIdentity: `stylelist:${attachmentIdentity(listUrl)}`,
    colour: '',
    reason,
    candidateCount: 1,
  } : null;

  /* Collection ana renk/single satırı PLM'in model seviyesindeki görselini
     kullanır. Bu, CoreNectum sol panelinde ön+arka birlikte gösterilen
     GetStyleList.model.imageUrl kaynağıdır. Option Image ana rengi ezemez. */
  if (role === IMAGE_ROLE_MAIN) {
    const selected = listPick('Main colour uses GetStyleList model image (front/back).')
      || defaultPick('Main colour model image missing; explicit isDefault Style Image fallback.');
    if (selected) return selected;
  }

  /* Variant satırında renk bazlı Option Image esastır. O renk için Option
     Image yoksa önce ana model görseline, o da yoksa güvenli default'a düş. */
  if (role === IMAGE_ROLE_OPTION) {
    const selected = optionPick()
      || listPick(wanted ? `No matching Option Image for ${wanted}; GetStyleList model image fallback.` : 'No colour code; GetStyleList model image fallback.')
      || defaultPick('Option/model image missing; explicit isDefault Style Image fallback.');
    if (selected) return selected;
  }

  /* CP/Orders ve rol bilgisi taşımayan eski çağrılar için mevcut davranış
     aynen korunur: Option > explicit default > Style List. */
  if (role === IMAGE_ROLE_AUTO) {
    const selected = optionPick()
      || defaultPick(wanted ? `No matching Option Image for ${wanted}; explicit isDefault Style Image fallback.` : 'Explicit isDefault Style Image.')
      || listPick('GetStyleList row image fallback.');
    if (selected) return selected;
  }

  return {
    sourceType: SOURCE_MISSING,
    imageUrl: '',
    sourceIdentity: '',
    colour: '',
    reason: role === IMAGE_ROLE_MAIN
      ? 'No GetStyleList model image and no explicit DEFAULT Style Image.'
      : role === IMAGE_ROLE_OPTION
        ? 'No matching Option Image, GetStyleList model image or explicit DEFAULT Style Image.'
        : (styleImages.length
          ? 'No matching Option Image and no explicit DEFAULT Style Image (non-default Style Images are never auto-selected).'
          : 'No matching Option Image and no explicit DEFAULT Style Image.'),
    candidateCount: 0,
    nonDefaultStyleImages: styleImages.length,
  };
}
function optionIdentity(item) {
  const imageId = clean(item && item.styleOptionImageId, 80);
  const optionId = clean(item && item.styleOptionId, 80);
  if (imageId) return `option:${optionId || '-'}:${imageId}`;
  return `option-url:${attachmentIdentity(item && item.imageUrl)}`;
}

function styleDefaultIdentity(item) {
  const associationId = clean(item && item.attachmentAssociationId, 80);
  if (associationId) return `styledefault:${associationId}`;
  return `styledefault-url:${attachmentIdentity(item && item.imageUrl)}`;
}

/* Paket (BUYERLOG_IMPORT) girdileri için kaynak kimliği. Manifest
   styleOptionImageId taşımadığı için içerik özeti kimliğin parçasıdır;
   böylece "aynı dosya yeniden içe aktarılırsa" önbellek isabeti olur. */
function packageIdentity({ sourceType, plmId, colourCode, hash } = {}) {
  const type = clean(sourceType, 40).toUpperCase() || SOURCE_MISSING;
  return `package:${type}:${coreId(plmId) || clean(plmId, 40)}:${normalizeColourCode(colourCode)}:${clean(hash, 80)}`;
}

module.exports = {
  GET_STYLE_LIST_URL,
  GET_STYLE_IMAGES_URL,
  PLM_CODE_FILTER_COLUMN,
  PLM_CODE_FILTER_OPERATOR,
  STYLE_LIST_BATCH_SIZE,
  STYLE_LIST_FALLBACK_SIZES,
  STYLE_IMAGES_CONCURRENCY,
  IMAGE_DOWNLOAD_CONCURRENCY,
  SOURCE_OPTION,
  SOURCE_STYLE_DEFAULT,
  SOURCE_STYLE_LIST,
  SOURCE_MISSING,
  IMAGE_ROLE_AUTO,
  IMAGE_ROLE_MAIN,
  IMAGE_ROLE_OPTION,
  SOURCE_PRIORITY,
  clean,
  coreId,
  normalizeColourCode,
  normalizeImageRole,
  boundedConcurrency,
  attachmentUrl,
  attachmentIdentity,
  dedupePlmCodes,
  styleListBatchBody,
  nextFallbackBatchSize,
  splitBatches,
  styleListRecords,
  styleListRow,
  styleListRowsByPlm,
  styleImagesRequestBody,
  parseStyleImages,
  uniqueStyleIdPlan,
  selectColourImage,
  optionIdentity,
  styleDefaultIdentity,
  packageIdentity,
};
