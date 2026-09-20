let _xlsx = null;
function getXLSX() { if (!_xlsx) { _xlsx = require('xlsx'); try { require('../../public/excel-date-utils').installSheetJsHooks(_xlsx); } catch (_) {} } return _xlsx; }

function norm(value) { return String(value == null ? '' : value).trim(); }
function turknorm(value) {
  return norm(value)
    .toUpperCase()
    .replace(/İ/g, 'I').replace(/I/g, 'I')
    .replace(/Ş/g, 'S').replace(/Ç/g, 'C').replace(/Ö/g, 'O')
    .replace(/Ü/g, 'U').replace(/Ğ/g, 'G')
    .replace(/\s+/g, ' ')
    .trim();
}
function headerKey(value) {
  return turknorm(value).replace(/[^A-Z0-9]+/g, '');
}
function parseNumber(value, kind = 'generic') {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = norm(value);
  if (!text) return null;
  text = text.replace(/\s/g, '').replace(/[$€£₺%]/g, '');
  if (!text) return null;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = text.length - comma - 1;
    if (kind === 'quantity' && decimals === 3) text = text.replace(/,/g, '');
    else text = decimals > 0 && decimals <= 6 ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (dot >= 0) {
    const parts = text.split('.');
    if (kind === 'quantity' && parts.length === 2 && parts[1].length === 3) text = parts.join('');
    else if (parts.length > 2) {
      const last = parts.pop();
      text = parts.join('') + '.' + last;
    }
  }
  const number = Number(text.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(number) ? number : null;
}
function parseDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value)) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = getXLSX().SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  const text = norm(value);
  if (!text) return null;
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let year = +m[3]; if (year < 100) year += year >= 70 ? 1900 : 2000;
    return validDate(year, +m[2], +m[1]);
  }
  m = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  const d = new Date(text);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function validDate(y, m, d) {
  const out = new Date(y, m - 1, d);
  return out.getFullYear() === y && out.getMonth() === m - 1 && out.getDate() === d ? out : null;
}
function dateIso(value) {
  const d = parseDateOnly(value);
  if (!d) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function yearMonth(iso) { return iso ? iso.slice(0, 7) : ''; }
function isTurkeyCountry(value) { return ['TURKIYE', 'TURKEY', 'TR'].includes(turknorm(value)); }
function isoWeek(iso) {
  const d = parseDateOnly(iso); if (!d) return '';
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7; utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return `${utc.getUTCFullYear()}-${String(Math.ceil((((utc - y0) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

const FIELD_ALIASES = {
  orderCode: ['SIPARIS KOD', 'SIPARIS KODU', 'ORDER CODE', 'ORDER NO', 'PO', 'OCODE'],
  modelName: ['MODEL ADI', 'MODEL NAME', 'STYLE NAME', 'STYLE', 'MODEL'],
  productDescription: ['URUN ANA TANIM', 'URUN TANIM', 'URUN TANIMI', 'PRODUCT DESCRIPTION', 'PRODUCT DESC', 'PRODUCT DEFINITION'],
  colourCode: ['RENK KOD', 'RENK KODU', 'COLOUR CODE', 'COLOR CODE', 'C.CODE'],
  mag: ['MAG', 'MERCH ALT GRUP KOD', 'MERCH ALT GRUP', 'MERCHANDISE ALT GROUP', 'MERCH SUB GROUP'],
  mmyg: ['MMYG', 'MERCH MARKA YAS GRUP KOD', 'MERCH MARKA YAS GRUP', 'BRAND AGE GROUP'],
  brandDirectorate: ['MARKA MUDURLUKLERI', 'MARKA MUDURLUGU', 'MARKA DIREKTORLUKLERI', 'MARKA DIREKTORLUGU', 'BRAND DIRECTORATES', 'BRAND DIRECTORATE', 'BRAND MANAGEMENT'],
  classification: ['KLASMAN', 'URUN KLASMAN', 'PRODUCT CLASSIFICATION', 'PRODUCT CLASS', 'CLASSIFICATION', 'CLASS'],
  season: ['SEZON', 'SEASON'],
  inStore: ['IN-STORE (MODEL BUDGET)', 'IN-STORE', 'IN STORE', 'MODEL BUTCE TARIH YIL AY GUN', 'MODEL BUDGET DATE', 'INSTORE'],
  // LFL detail dates are bound strictly to the ASAS source columns requested by business.
  opd: ['SIPARIS YERLESTIRME MERCHTARIH'],
  exFactory: ['ORIJINAL EXFACTORY MERCH TARIH'],
  fob: ['FOB FIYATI', 'FOB PRICE', 'FOB ($)', 'FOB USD', 'CONF. FOB', 'CONF FOB', 'SUPP. FOB', 'SUPP FOB', 'FOB'],
  quantity: ['NET ALIM SIPARIS MIKTARI', 'ORDER QUANTITY', 'ORDER QTY', 'SIPARIS ADEDI', 'QUANTITY', 'QTY', 'ADET'],
  manufacturer: ['URETICI', 'MANUFACTURER', 'SUPPLIER', 'VENDOR'],
  country: ['SIPARISIN URETILDIGI ULKE', 'URETIM ULKESI', 'COUNTRY OF ORIGIN', 'COUNTRY'],
  buyer: ['BUYER', 'SATIN ALMACI', 'PURCHASING BUYER'],
  buyingGroup: ['BUYER GRUP (TR)', 'BUYING GROUP', 'BUYER GROUP'],
  license: ['LISANS', 'LICENSE'],
  licensor: ['LISANSOR', 'LICENSOR', 'LICENSE OWNER', 'RIGHTS HOLDER'],
  dtrType: ['DTR/NON-DTR', 'DTR NON-DTR', 'DTR STATUS', 'DTR TYPE', 'DTR TIPI', 'DTR DURUMU'],
  line: ['LINE', 'URUN GRUBU', 'PRODUCT LINE'],
  currency: ['PARA BIRIMI', 'CURRENCY'],
  mainFabric: ['ANA KUMAS MI', 'ANA KUMAS', 'MAIN FABRIC', 'IS MAIN FABRIC'],
  fabricCategory: ['KUMAS KATEGORISI', 'FABRIC CATEGORY'],
  fabricSupplierCountry: ['KUMASCI ULKESI', 'FABRIC SUPPLIER COUNTRY', 'FABRIC MILL COUNTRY', 'MILL COUNTRY'],
  fabricSupplier: ['KUMASCI', 'FABRIC SUPPLIER', 'FABRIC MILL', 'MILL'],
  kumasTipi: ['KUMAS TIPI', 'FABRIC TYPE'],
  iplikNo: ['IPLIK NO', 'YARN COUNT', 'YARN NO'],
  fabricWeight: ['KUMAS GRAMAJI', 'GRAMAJ', 'FABRIC WEIGHT', 'WEIGHT', 'GSM'],
  karisim: ['KARISIM', 'COMPOSITION', 'BLEND'],
};
const ALIAS_KEYS = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, aliases.map(headerKey)]));
// These LFL dates must come only from the exact ASAS business columns. Do not
// allow fuzzy header matching to fall back to generic OPD / EX-FACTORY fields.
const STRICT_HEADER_FIELDS = new Set(['opd', 'exFactory']);

function findFieldIndex(headers, field) {
  const keys = headers.map(headerKey);
  const aliases = ALIAS_KEYS[field] || [];
  for (const alias of aliases) {
    const exact = keys.indexOf(alias);
    if (exact >= 0) return exact;
  }
  if (STRICT_HEADER_FIELDS.has(field)) return -1;
  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const idx = keys.findIndex(k => k && (k.includes(alias) || alias.includes(k)));
    if (idx >= 0) return idx;
  }
  return -1;
}
function mapHeaders(headers) {
  const map = {};
  Object.keys(FIELD_ALIASES).forEach(field => { map[field] = findFieldIndex(headers, field); });
  return map;
}
function headerScore(map) {
  let score = 0;
  if (map.fob >= 0) score += 5;
  if (map.quantity >= 0) score += 5;
  if (map.season >= 0) score += 4;
  if (map.inStore >= 0) score += 4;
  if (map.mag >= 0) score += 2;
  if (map.mmyg >= 0) score += 2;
  if (map.classification >= 0) score += 2;
  if (map.orderCode >= 0) score += 1;
  if (map.manufacturer >= 0) score += 1;
  return score;
}
function detectSheet(sheet, name) {
  const matrix = getXLSX().utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  let best = null;
  const limit = Math.min(matrix.length, 60);
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const headers = (matrix[rowIndex] || []).map(norm);
    const map = mapHeaders(headers);
    const score = headerScore(map);
    if (!best || score > best.score) best = { name, matrix, rowIndex, headers, map, score };
  }
  return best;
}
function valueAt(row, index) { return index >= 0 ? row[index] : null; }
function isMainFabricFlag(value) {
  if (value === true) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value === 1;
  const text = norm(value).replace(',', '.');
  if (/^1(?:\.0+)?$/.test(text)) return true;
  const key = turknorm(text);
  return key === 'EVET' || key === 'YES' || key === 'TRUE';
}
function parseDetectedSheet(detected) {
  const rows = [];
  let skippedMissingPrice = 0, skippedMissingQuantity = 0, skippedEmpty = 0, skippedMissingDimensions = 0;
  let mainFabricRows = 0, ignoredNonMainFabricRows = 0;
  const missingDimensionCounts = { mag: 0, mmyg: 0, classification: 0, season: 0, inStore: 0, manufacturer: 0, country: 0, buyingGroup: 0, buyer: 0 };
  const { matrix, rowIndex, map, name } = detected;
  const hasMainFabricColumn = map.mainFabric >= 0;
  for (let i = rowIndex + 1; i < matrix.length; i++) {
    const source = matrix[i] || [];
    if (!source.some(v => norm(v))) { skippedEmpty++; continue; }
    const fob = parseNumber(valueAt(source, map.fob), 'price');
    const quantity = parseNumber(valueAt(source, map.quantity), 'quantity');
    if (!(fob > 0)) { skippedMissingPrice++; continue; }
    if (!(quantity > 0)) { skippedMissingQuantity++; continue; }
    const inStore = dateIso(valueAt(source, map.inStore));
    const core = {
      mag: norm(valueAt(source, map.mag)),
      mmyg: norm(valueAt(source, map.mmyg)),
      classification: norm(valueAt(source, map.classification)),
      season: norm(valueAt(source, map.season)),
      inStore,
      manufacturer: norm(valueAt(source, map.manufacturer)),
      country: norm(valueAt(source, map.country)),
      buyingGroup: norm(valueAt(source, map.buyingGroup)),
      buyer: norm(valueAt(source, map.buyer)),
    };
    const missing = Object.keys(core).filter(key => !core[key]);
    if (missing.length) {
      skippedMissingDimensions++;
      missing.forEach(key => { missingDimensionCounts[key] = (missingDimensionCounts[key] || 0) + 1; });
      continue;
    }
    const mainFabric = hasMainFabricColumn && isMainFabricFlag(valueAt(source, map.mainFabric));
    if (hasMainFabricColumn) {
      if (mainFabric) mainFabricRows++;
      else ignoredNonMainFabricRows++;
    }
    const row = {
      id: `${name}:${i + 1}`,
      sheet: name,
      sourceRow: i + 1,
      orderCode: norm(valueAt(source, map.orderCode)),
      modelName: norm(valueAt(source, map.modelName)),
      productDescription: norm(valueAt(source, map.productDescription)),
      colourCode: norm(valueAt(source, map.colourCode)),
      mag: core.mag,
      mmyg: core.mmyg,
      brandDirectorate: norm(valueAt(source, map.brandDirectorate)),
      classification: core.classification,
      season: core.season,
      inStore,
      inStoreMonth: yearMonth(inStore),
      inStoreWeek: isoWeek(inStore),
      opd: dateIso(valueAt(source, map.opd)),
      exFactory: dateIso(valueAt(source, map.exFactory)),
      fob,
      quantity,
      manufacturer: core.manufacturer,
      country: core.country,
      buyer: core.buyer,
      buyingGroup: core.buyingGroup,
      license: norm(valueAt(source, map.license)),
      licensor: norm(valueAt(source, map.licensor)),
      dtrType: (() => {
        const explicit = turknorm(valueAt(source, map.dtrType));
        if (explicit) {
          if (explicit.includes('NON') && explicit.includes('DTR')) return 'NON-DTR';
          if (explicit.includes('DTR')) return 'DTR';
        }
        const licensor = turknorm(valueAt(source, map.licensor));
        return licensor ? (licensor === 'DTR' ? 'DTR' : 'NON-DTR') : '';
      })(),
      line: norm(valueAt(source, map.line)),
      fabricCategory: mainFabric ? norm(valueAt(source, map.fabricCategory)) : '',
      fabricSupplierCountry: mainFabric ? norm(valueAt(source, map.fabricSupplierCountry)) : '',
      fabricSupplier: mainFabric ? norm(valueAt(source, map.fabricSupplier)) : '',
      kumasTipi: mainFabric ? norm(valueAt(source, map.kumasTipi)) : '',
      iplikNo: mainFabric ? norm(valueAt(source, map.iplikNo)) : '',
      fabricWeight: mainFabric ? norm(valueAt(source, map.fabricWeight)) : '',
      karisim: mainFabric ? norm(valueAt(source, map.karisim)) : '',
      _mainFabric: hasMainFabricColumn ? mainFabric : null,
      currency: isTurkeyCountry(core.country) ? 'TRY' : 'USD',
      // Preserve every column already returned by the ASAS model query. Dynamic
      // LFL breakdowns read from this bag; the raw database record is never mutated.
      _asas: Object.fromEntries(detected.headers.map((header, index) => [header, source[index]]).filter(([header]) => !!header)),
    };
    rows.push(row);
  }
  return {
    rows, skippedMissingPrice, skippedMissingQuantity, skippedEmpty, skippedMissingDimensions,
    missingDimensionCounts, mainFabricRows, ignoredNonMainFabricRows,
    missingMainFabricColumn: !hasMainFabricColumn,
  };
}
function objectRowsToMatrix(records) {
  const rows = Array.isArray(records) ? records : [];
  const headers = [];
  const seen = new Set();
  rows.forEach(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return;
    Object.keys(record).forEach(key => {
      const name = norm(key);
      if (name && !seen.has(name)) { seen.add(name); headers.push(name); }
    });
  });
  return [headers, ...rows.map(record => headers.map(header => record && Object.prototype.hasOwnProperty.call(record, header) ? record[header] : null))];
}

function finalizeParsedSheets(eligible) {
  const allRows = [];
  const sheets = [];
  let skippedMissingPrice = 0, skippedMissingQuantity = 0, skippedEmpty = 0, skippedMissingDimensions = 0;
  let mainFabricRows = 0, ignoredNonMainFabricRows = 0, missingMainFabricSheets = 0;
  const missingDimensionCounts = {};
  for (const item of eligible) {
    const parsed = parseDetectedSheet(item);
    allRows.push(...parsed.rows);
    skippedMissingPrice += parsed.skippedMissingPrice;
    skippedMissingQuantity += parsed.skippedMissingQuantity;
    skippedEmpty += parsed.skippedEmpty;
    skippedMissingDimensions += parsed.skippedMissingDimensions || 0;
    mainFabricRows += parsed.mainFabricRows || 0;
    ignoredNonMainFabricRows += parsed.ignoredNonMainFabricRows || 0;
    if (parsed.missingMainFabricColumn) missingMainFabricSheets++;
    Object.entries(parsed.missingDimensionCounts || {}).forEach(([key, value]) => { missingDimensionCounts[key] = (missingDimensionCounts[key] || 0) + value; });
    const mappedHeaders = {};
    Object.entries(item.map).forEach(([field, index]) => { if (index >= 0) mappedHeaders[field] = item.headers[index]; });
    sheets.push({ name: item.name, headerRow: item.rowIndex + 1, score: item.score, mappedHeaders, rows: parsed.rows.length });
  }
  const fabricFields = ['fabricCategory', 'fabricSupplierCountry', 'fabricSupplier', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim'];
  const seen = new Map();
  for (const row of allRows) {
    const key = [row.orderCode, row.modelName, row.colourCode, row.season, row.inStore, row.fob, row.quantity, row.mag, row.mmyg, row.brandDirectorate, row.classification, row.manufacturer, row.country, row.buyingGroup, row.buyer, row.license, row.licensor, row.dtrType].map(turknorm).join('|');
    const current = seen.get(key);
    if (!current) { seen.set(key, row); continue; }
    // Aynı ASAS sipariş satırı kumaş bileşeni kadar çoğalır. Ana kumaş satırı
    // kaynakta daha sonra gelse bile onun ayrıntıları mevcut rapor satırına taşınır.
    if (row._mainFabric === true) {
      fabricFields.forEach(field => { current[field] = norm(row[field]); });
      current._mainFabric = true;
    }
  }
  const rows = [...seen.values()].map(row => {
    const out = { ...row };
    delete out._mainFabric;
    return out;
  });
  const warnings = [];
  if (skippedMissingPrice) warnings.push(`${skippedMissingPrice} satır geçerli FOB bulunamadığı için dışarıda bırakıldı.`);
  if (skippedMissingQuantity) warnings.push(`${skippedMissingQuantity} satır geçerli miktar bulunamadığı için dışarıda bırakıldı.`);
  if (skippedMissingDimensions) warnings.push(`${skippedMissingDimensions} satır MAG, MMYG, Klasman, Sezon, In-Store, Üretici, Ülke, Buying Group veya Buyer alanlarından en az biri boş olduğu için dışarıda bırakıldı.`);
  if (missingMainFabricSheets) warnings.push(`${missingMainFabricSheets} ASAS sonucunda "Ana Kumaş Mı" alanı bulunamadı; LFL kumaş bilgileri uygulanmadı. Alanı ana ASAS bağlantısında eşleyin.`);
  if (ignoredNonMainFabricRows) warnings.push(`${ignoredNonMainFabricRows} yan kumaş satırı Ana Kumaş Mı = 0 olduğu için kumaş detaylarında dikkate alınmadı.`);
  if (!rows.some(r => r.inStore)) warnings.push('In-Store tarih sütunu bulunamadı veya tarihler okunamadı; dönem karşılaştırması sezon bazında çalışacaktır.');
  return {
    rows,
    meta: {
      sheets,
      rowCount: rows.length,
      rawValidRows: allRows.length,
      duplicateRowsRemoved: allRows.length - rows.length,
      skippedMissingPrice,
      skippedMissingQuantity,
      skippedEmpty,
      skippedMissingDimensions,
      missingDimensionCounts,
      mainFabricRows,
      ignoredNonMainFabricRows,
      missingMainFabricSheets,
      warnings,
      dimensions: {
        seasons: uniqueSorted(rows, 'season'),
        mags: uniqueSorted(rows, 'mag'),
        mmygs: uniqueSorted(rows, 'mmyg'),
        brandDirectorates: uniqueSorted(rows, 'brandDirectorate'),
        classifications: uniqueSorted(rows, 'classification'),
        productDescriptions: uniqueSorted(rows, 'productDescription'),
        manufacturers: uniqueSorted(rows, 'manufacturer'),
        countries: uniqueSorted(rows, 'country'),
        buyers: uniqueSorted(rows, 'buyer'),
        buyingGroups: uniqueSorted(rows, 'buyingGroup'),
        licenses: uniqueSorted(rows, 'license'),
        licensors: uniqueSorted(rows, 'licensor'),
        dtrTypes: uniqueSorted(rows, 'dtrType'),
        lines: uniqueSorted(rows, 'line'),
        fabricCategories: uniqueSorted(rows, 'fabricCategory'),
        fabricSupplierCountries: uniqueSorted(rows, 'fabricSupplierCountry'),
        fabricSuppliers: uniqueSorted(rows, 'fabricSupplier'),
        fabricTypes: uniqueSorted(rows, 'kumasTipi'),
        yarnCounts: uniqueSorted(rows, 'iplikNo'),
        fabricWeights: uniqueSorted(rows, 'fabricWeight'),
        fabricBlends: uniqueSorted(rows, 'karisim'),
        inStoreMonths: uniqueSorted(rows, 'inStoreMonth'),
      },
    },
  };
}

function withFabricDimensions(meta, rows) {
  const source = Array.isArray(rows) ? rows : [];
  const base = meta && typeof meta === 'object' ? meta : {};
  return {
    ...base,
    dimensions: {
      ...(base.dimensions || {}),
      fabricCategories: uniqueSorted(source, 'fabricCategory'),
      fabricSupplierCountries: uniqueSorted(source, 'fabricSupplierCountry'),
      fabricSuppliers: uniqueSorted(source, 'fabricSupplier'),
      fabricTypes: uniqueSorted(source, 'kumasTipi'),
      yarnCounts: uniqueSorted(source, 'iplikNo'),
      fabricWeights: uniqueSorted(source, 'fabricWeight'),
      fabricBlends: uniqueSorted(source, 'karisim'),
    },
  };
}

function parseLFLRows(records, sourceName = 'Data Model') {
  const matrix = objectRowsToMatrix(records);
  const headers = matrix[0] || [];
  const map = mapHeaders(headers);
  const detected = { name: sourceName, matrix, rowIndex: 0, headers, map, score: headerScore(map) };
  if (detected.score < 14 || map.fob < 0 || map.quantity < 0 || map.season < 0) {
    const found = headers.filter(Boolean).slice(0, 30).join(' | ') || 'Sütun bulunamadı';
    throw new Error(`LFL model alanları tanınamadı. En az Sezon, FOB ve miktar alanları gerekli. Bulunan başlıklar: ${found}`);
  }
  return finalizeParsedSheets([detected]);
}

/* LFL MODEL GÖRSEL KİMLİĞİ KÖPRÜSÜ.
 *
 * LFL kaynağı PLM ID içermez; model adı + renk kodu içerir. Contextual PLM
 * SYNC sırasında backend bu modeli ASAS siparişlerinden çözebildiği halde,
 * renderer aynı köprüyü bilmiyorsa indirilen görsel ekranda placeholder olarak
 * kalır. Bu yardımcı LFL satırını ASAS'ın gerçek Model + Renk Kodu kimliğiyle
 * zenginleştirir. Tahmin yapılmaz: çelişkili eşleşme varsa PLM ID yazılmaz.
 */
function modelImageIdentityText(value) {
  let text = norm(value).toUpperCase();
  [['İ', 'I'], ['I', 'I'], ['Ş', 'S'], ['Ç', 'C'], ['Ö', 'O'], ['Ü', 'U'], ['Ğ', 'G']]
    .forEach(([a, b]) => { text = text.split(a).join(b); });
  return text.replace(/\s+/g, ' ').trim();
}
function modelImagePlmId(value) {
  let text = norm(value);
  if (/^\d+(?:\.0+)?$/.test(text)) text = text.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
  return modelImageIdentityText(text);
}
function attachModelImageIdentities(rows, orders) {
  const exact = new Map(), byModel = new Map();
  const put = (map, key, plmId, colour) => {
    if (!key || !plmId) return;
    const current = map.get(key);
    if (!current) { map.set(key, { plmId, colour: norm(colour), conflict: false }); return; }
    if (current.plmId !== plmId) { current.conflict = true; current.colour = ''; return; }
    if (current.colour && norm(colour) && modelImageIdentityText(current.colour) !== modelImageIdentityText(colour)) current.colour = '';
    else if (!current.colour && norm(colour)) current.colour = norm(colour);
  };
  for (const order of Array.isArray(orders) ? orders : []) {
    const model = modelImageIdentityText(order && (order.model ?? order.modelName));
    const colourCode = modelImageIdentityText(order && (order.ccode ?? order.colourCode ?? order.colorCode));
    const plmId = modelImagePlmId(order && (order.plm ?? order.plmId));
    if (!model || !plmId) continue;
    put(byModel, model, plmId, order && (order.colour ?? order.color));
    if (colourCode) put(exact, `${model}\u0000${colourCode}`, plmId, order && (order.colour ?? order.color));
  }
  return (Array.isArray(rows) ? rows : []).map(row => {
    if (!row || typeof row !== 'object' || modelImagePlmId(row.plmId)) return row;
    const model = modelImageIdentityText(row.modelName ?? row.model);
    const colourCode = modelImageIdentityText(row.colourCode ?? row.colorCode ?? row.ccode);
    const exactHit = model && colourCode ? exact.get(`${model}\u0000${colourCode}`) : null;
    const modelHit = model ? byModel.get(model) : null;
    const hit = exactHit && !exactHit.conflict ? exactHit : (modelHit && !modelHit.conflict ? modelHit : null);
    if (!hit) return row;
    return { ...row, plmId: hit.plmId, colour: norm(row.colour ?? row.color) || hit.colour || '' };
  });
}

function uniqueSorted(rows, key) {
  return [...new Set(rows.map(row => norm(row[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
}
function parseLFLWorkbook(workbook) {
  const detected = workbook.SheetNames
    .map(name => detectSheet(workbook.Sheets[name], name))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const eligible = detected.filter(item => item.score >= 14 && item.map.fob >= 0 && item.map.quantity >= 0 && item.map.season >= 0);
  if (!eligible.length) {
    const best = detected[0];
    const found = best ? best.headers.filter(Boolean).slice(0, 30).join(' | ') : 'Çalışma sayfası bulunamadı';
    throw new Error(`LFL Excel sütunları tanınamadı. En az Sezon, FOB ve miktar sütunları gerekli. Bulunan başlıklar: ${found}`);
  }
  return finalizeParsedSheets(eligible);
}

module.exports = { parseLFLWorkbook, parseLFLRows, withFabricDimensions, attachModelImageIdentities, parseNumber, parseDateOnly, dateIso, headerKey };
