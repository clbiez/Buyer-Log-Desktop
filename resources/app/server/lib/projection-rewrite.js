'use strict';
/* Projeksiyon satır yaması yeniden yazımı: saf çekirdek (#1078 takip / WS7b).
 *
 * Ana iş parçacığı (geri dönüş yolu) ve projection-rewrite işçisi aynı fonksiyonları kullanır.
 * Satır yamasının tek tanımı lib/projection-row-patch.js'tir; burada yalnız uygulama sırası,
 * değişen modülün tespiti ve ardışık adımların birleştirilmesi vardır.
 *
 * Eski yolla eşdeğerlik:
 *  - Eski yol her kayıtta bütün modülleri ayrıştırır, yamalar ve stringifyWithDates ile yeniden yazar.
 *    Hiç satırı eşleşmeyen modülün içeriği değişmez: stringify(parse(x)) === x. Bu yüzden önceki
 *    sıkıştırılmış baytlar aynen taşınır (changed=false).
 *  - Ardışık adımlar (kayıtlar) tek ayrıştırmada uygulanır. Eski yolda bir sonraki kayıt, öncekinin
 *    diske yazılıp yeniden okunmuş hâlini görür (Date → 'YYYY-MM-DD'). Aynı sonucu vermek için her
 *    adımdan sonra o adımda değişen satırlar aynı serileştirmeyle JSON gidiş-dönüşünden geçirilir.
 *    Değişmeyen satırlar zaten ayrıştırılmış JSON'dur; gidiş-dönüş onlar için birim işlemdir.
 *  - Her adım kendi kayıt anında alınmış override bağlamını (rowPatchContext) kullanır. */
const parseLib = require('./parse');
const { stringifyWithDates } = require('./json-dates');
const { applyIncrementalProjectionPatch, projectionPatchMatches } = require('./projection-row-patch');
const cpRowStored = require('./cp-row-stored');

function dateOnlyISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Yamanın okuduğu override alanları, yalnız yamalanan siparişlerin anahtarlarıyla.
   applyIncrementalProjectionPatch override'dan yalnız şunları okur:
     notesmap[rowLineKey(row)] | notesmap[orderCodeKey]  (not yazarı/tarihi)
     importancemap (overrideGet: satır anahtarı | ham sipariş kodu) + importanceSettings
     noteColumnDefs, transitRules (tam liste)
   Eşleşen satırın sipariş kodu anahtarı yamanın sipariş kodu anahtarına eşittir; satır anahtarları
   orderCodeKey ile başlar. Bu yüzden ilk "|" öncesi parçası aynı sipariş koduna çözülen her anahtar
   alınır: aranabilecek her anahtarın üst kümesidir. */
/* shared: paylaşılan override belgesi (loadOverrides). CP satırının `_cpStored` değeri sunucu karşılaştırmasıyla
   aynı kaynaktan (CP-update alt üreticisi katmanı olmadan) yeniden hesaplanır. */
function rowPatchContext(overrides, items, shared = null) {
  const ov = overrides || {}, codes = new Set((Array.isArray(items) ? items : []).map(item => parseLib.orderCodeKey(item && item.orderCode)).filter(Boolean));
  const pick = map => {
    if (!map || typeof map !== 'object') return map;
    const out = {};
    for (const key of Object.keys(map)) {
      if (key === '__proto__' || !codes.has(parseLib.orderCodeKey(String(key).split('|')[0]))) continue;
      out[key] = map[key];
    }
    return out;
  };
  return {
    notesmap: pick(ov.notesmap), importancemap: pick(ov.importancemap), importanceSettings: ov.importanceSettings,
    noteColumnDefs: ov.noteColumnDefs, transitRules: ov.transitRules,
    cpRowStored: cpRowStored.pickCpRowStoredMaps(shared || ov, codes),
  };
}

/* Bir adımı bir modülün yükü üzerinde uygular (eski rewriteProjectionCacheForRowPatches transform'u).
   step: { items:[{orderCode,patch}], context, collectCpRows }
   Dönen: { changed, cpRows } — cpRows yalnız collectCpRows ve module==='cp' iken (yamalanan CP satırları,
   eski yoldaki sırayla ve tekil). */
function applyStep(module, payload, step) {
  const result = { changed: false, cpRows: step.collectCpRows && module === 'cp' ? [] : null };
  if (!payload || typeof payload !== 'object') return result;
  const lists = [];
  if (Array.isArray(payload.rows)) lists.push(payload.rows);
  if (Array.isArray(payload.orderSummary)) lists.push(payload.orderSummary);
  const includePriority = module !== 'orders';
  for (const rows of lists) {
    let touched = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      for (const item of step.items) {
        if (!projectionPatchMatches(row, item)) continue;
        applyIncrementalProjectionPatch(row, item.patch, step.context, includePriority, { cpStored: module === 'cp' && rows === payload.rows });
        (touched || (touched = new Set())).add(index);
        if (result.cpRows && rows === payload.rows && !result.cpRows.includes(row)) result.cpRows.push(row);
      }
    }
    if (!touched) continue;
    result.changed = true;
    // Diske yazılıp yeniden okunmuş hâl: sonraki adım eski yoldaki girdinin aynısını görür.
    // Eski nesneler mutasyona uğramaz (cpRows yama anındaki değerleri tutar).
    for (const index of touched) rows[index] = JSON.parse(stringifyWithDates(rows[index], dateOnlyISO));
  }
  return result;
}

/* Bir modülde adımları sırayla uygular. Dönen: { changed, data, cpRowsBySteps } */
function applySteps(module, payload, steps) {
  let changed = false;
  const cpRowsBySteps = steps.map(() => null);
  steps.forEach((step, index) => {
    const out = applyStep(module, payload, step);
    changed = changed || out.changed;
    cpRowsBySteps[index] = out.cpRows;
  });
  return { changed, data: payload, cpRowsBySteps };
}

function serializeProjection(value) { return stringifyWithDates(value, dateOnlyISO); }

module.exports = { rowPatchContext, applyStep, applySteps, serializeProjection, dateOnlyISO };
