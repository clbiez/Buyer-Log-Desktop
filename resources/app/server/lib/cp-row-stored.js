'use strict';
/* CP satır kaydının KAYITLI değerleri: tek tanım.
   db.patchOrderOverrideRows her alanı paylaşılan override belgesindeki (loadOverrides) kayıtlı
   değerle karşılaştırır. İstemcinin gönderdiği `base` aynı değer olmalıdır; aksi hâlde kimse
   satırı değiştirmemişken çakışma döner. İstemci tam override belgesini almaz (çok büyük), bu
   yüzden CP projeksiyon satırı yalnız kayıtlı değeri OLAN satırlarda bu değerleri kompakt
   biçimde taşır (`_cpStored`) ve satır yaması onu güncel tutar.
   Biçim sunucunun çakışma/onay yanıtındaki `current` biçimidir (boş alanlar atlanır):
     {notes?:{Notes,NotesHtml,EkNot,EkNotHtml}, delType?, subManufacturer?, licensor?,
      noteColumns?:{id:value}, dates?:{exFactory?,retailDate?,inStoreDate?}}
   Kaynak HER ZAMAN paylaşılan belgedir; CP-update dosyasından gelen alt üretici (kullanıcı
   çalışma alanı katmanı) kayıtlı değer değildir ve sunucu karşılaştırmasına girmez. */
const parseLib = require('./parse');

const CP_ROW_NOTE_PAIRS = Object.freeze([['Notes', 'NotesHtml'], ['EkNot', 'EkNotHtml']]);
const CP_ROW_DATE_FIELDS = Object.freeze({ exFactory: 'ex', retailDate: 'retail', inStoreDate: 'mb' });
const CP_ROW_SCALAR_MAPS = Object.freeze([['delType', 'delmap'], ['subManufacturer', 'submap'], ['licensor', 'licensormap']]);
const CP_ROW_STORED_MAPS = Object.freeze(['notesmap', 'delmap', 'submap', 'licensormap', 'noteColumnValues', 'datemap']);
// Satır yamasında kayıtlı değeri değiştirebilen alanlar (db.CP_ROW_SAVE_FIELDS ile aynı küme).
const CP_ROW_STORED_PATCH_FIELDS = Object.freeze(['notes', 'delType', 'subManufacturer', 'licensor', 'noteColumns', 'dates']);

const cpRowText = value => value == null ? '' : String(value);
const isRecord = value => Boolean(value) && typeof value === 'object';
function cpRowStored(ov, orderCode, key, mapName) {
  const map = ov[mapName] || {};
  if (Object.hasOwn(map, key)) return map[key];
  return key !== orderCode && Object.hasOwn(map, orderCode) ? map[orderCode] : undefined;
}
function cpRowRecord(ov, orderCode, key, mapName) {
  const map = ov[mapName] || {};
  return { ...(key !== orderCode && isRecord(map[orderCode]) ? map[orderCode] : {}), ...(isRecord(map[key]) ? map[key] : {}) };
}
/* Satırın kayıtlı (geçersiz kılınmış) değerleri; çakışma/onayda istemciye döner. Kayıt yoksa alan yazılmaz. */
function currentOrderLineValues(ov, orderCode, key) {
  const out = {};
  const notes = cpRowRecord(ov, orderCode, key, 'notesmap');
  if (Object.keys(notes).length) out.notes = Object.fromEntries(CP_ROW_NOTE_PAIRS.flat().map(name => [name, cpRowText(notes[name])]));
  for (const [field, map] of CP_ROW_SCALAR_MAPS) { const value = cpRowStored(ov, orderCode, key, map); if (value !== undefined) out[field] = value; }
  const columns = cpRowRecord(ov, orderCode, key, 'noteColumnValues'); if (Object.keys(columns).length) out.noteColumns = columns;
  const dates = cpRowRecord(ov, orderCode, key, 'datemap');
  out.dates = Object.fromEntries(Object.entries(CP_ROW_DATE_FIELDS).map(([field, stored]) => [field, dates[stored] || null]));
  return out;
}
/* Sunucunun satır kaydında kullanacağı kimlik: istemci Number(Order Code) + satırın model / renk kodunu
   gönderir; db.overrideWriteKey ile birebir. */
function cpRowStoredIdentity(row) {
  const orderCode = Number(row && row['Order Code']);
  if (!Number.isFinite(orderCode)) return null;
  const model = row['Model Name'], ccode = row['C.Code'];
  return { orderCode, key: model && ccode ? parseLib.orderLineKey(orderCode, model, ccode) : orderCode };
}
/* Kompakt kayıtlı değerler; kayıtlı hiçbir değer yoksa null. Boş değer (''/null) karşılaştırmada
   "kayıt yok" ile aynıdır (cpRowText / tarih null), bu yüzden atlanır. Sonuç currentOrderLineValues'in
   boş alanları atılmış hâliyle birebir aynıdır (parite testi); 30k satırda nesne üretmemek için yalnız
   anahtarı bulunan haritalar okunur. */
function cpRowStoredValues(ov, orderCode, key) {
  const source = ov || {}, out = {};
  const has = map => isRecord(map) && (Object.hasOwn(map, key) || (key !== orderCode && Object.hasOwn(map, orderCode)));
  if (has(source.notesmap)) {
    const notes = cpRowRecord(source, orderCode, key, 'notesmap'), fields = CP_ROW_NOTE_PAIRS.flat();
    if (fields.some(name => cpRowText(notes[name]) !== '')) out.notes = Object.fromEntries(fields.map(name => [name, cpRowText(notes[name])]));
  }
  for (const [field, map] of CP_ROW_SCALAR_MAPS) if (has(source[map])) { const value = cpRowStored(source, orderCode, key, map); if (value !== undefined) out[field] = value; }
  if (has(source.noteColumnValues)) { const columns = cpRowRecord(source, orderCode, key, 'noteColumnValues'); if (Object.keys(columns).length) out.noteColumns = columns; }
  if (has(source.datemap)) {
    const record = cpRowRecord(source, orderCode, key, 'datemap'), dates = {};
    for (const [field, stored] of Object.entries(CP_ROW_DATE_FIELDS)) if (record[stored]) dates[field] = record[stored];
    if (Object.keys(dates).length) out.dates = dates;
  }
  return Object.keys(out).length ? out : null;
}
// Anahtarın sipariş kodu parçası. Yazılan anahtarlar zaten kanoniktir (orderCodeKey / Number); yalnız
// kanonik olmayan eski biçimler orderCodeKey'den geçer (sonuç aynı, 30k anahtarda düzenli ifade yok).
const CANONICAL_CODE = /^(?:0|[1-9]\d*)$/;
function codeOfKey(key) {
  const text = String(key), bar = text.indexOf('|'), head = bar < 0 ? text : text.slice(0, bar);
  return CANONICAL_CODE.test(head) ? head : parseLib.orderCodeKey(head);
}
// Kayıtlı değer taşıyabilecek sipariş kodları (anahtarın ilk "|" öncesi parçası): satırların çoğu hızlıca atlanır.
function storedOrderCodes(ov) {
  const codes = new Set();
  for (const name of CP_ROW_STORED_MAPS) {
    const map = ov && ov[name];
    if (!isRecord(map)) continue;
    for (const key of Object.keys(map)) codes.add(codeOfKey(key));
  }
  return codes;
}
function setRowStored(row, ov) {
  const identity = cpRowStoredIdentity(row);
  const values = identity ? cpRowStoredValues(ov, identity.orderCode, identity.key) : null;
  if (values) row._cpStored = values; else delete row._cpStored;
  return row;
}
/* CP projeksiyon satırlarına kayıtlı değerleri yazar (yalnız kaydı olan satırlar). */
function attachCpRowStored(rows, sharedOverrides) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const codes = storedOrderCodes(sharedOverrides);
  for (const row of list) {
    if (!row) continue;
    if (codes.has(codeOfKey(row['Order Code']))) setRowStored(row, sharedOverrides);
    else if (Object.hasOwn(row, '_cpStored')) delete row._cpStored;
  }
  return list;
}
// Yama kayıtlı değeri değiştirebilir mi?
function patchTouchesCpRowStored(patch) {
  return isRecord(patch) && CP_ROW_STORED_PATCH_FIELDS.some(field => Object.hasOwn(patch, field));
}
/* Yamalanan satırların kayıtlı değer haritaları (satır yaması bağlamı; tam belge taşınmaz).
   items: [{orderCode, patch}]. Model + renk kodu taşıyan öğe yalnız kendi satırına eşleşir
   (projectionPatchMatches): o satırın anahtarı ve eski sipariş kodu anahtarı doğrudan okunur — her kayıtta
   bütün haritaları taramak ana iş parçacığında on milisaniyeler sürer. Sipariş bazlı öğe (eski içe aktarma)
   siparişin bütün satırlarına eşleşir: yalnız o durumda haritalar taranır. */
function pickCpRowStoredMaps(ov, items) {
  const exact = new Set(), scanCodes = new Set(), out = {};
  for (const item of Array.isArray(items) ? items : []) {
    const code = parseLib.orderCodeKey(item && item.orderCode);
    if (!code) continue;
    const patch = item && item.patch || {};
    const model = String(patch.modelName ?? patch.model ?? '').trim(), ccode = String(patch.ccode ?? patch.colourCode ?? patch.colorCode ?? '').trim();
    exact.add(code);
    if (model && ccode) exact.add(parseLib.orderLineKey(code, model, ccode)); else scanCodes.add(code);
  }
  for (const name of CP_ROW_STORED_MAPS) {
    const map = ov && ov[name], picked = {};
    if (isRecord(map)) {
      for (const key of exact) if (key !== '__proto__' && Object.hasOwn(map, key)) picked[key] = map[key];
      if (scanCodes.size) for (const key of Object.keys(map)) if (key !== '__proto__' && scanCodes.has(codeOfKey(key))) picked[key] = map[key];
    }
    out[name] = picked;
  }
  return out;
}

module.exports = {
  CP_ROW_NOTE_PAIRS, CP_ROW_DATE_FIELDS, CP_ROW_STORED_MAPS, cpRowText, cpRowStored, cpRowRecord, currentOrderLineValues,
  cpRowStoredIdentity, cpRowStoredValues, setRowStored, attachCpRowStored, patchTouchesCpRowStored, pickCpRowStoredMaps,
};
