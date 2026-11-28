'use strict';
/* Projeksiyon satır yaması — TEK tanım (#1078 WS5 satır yaması).
   Projeksiyon önbelleğinin satır yaması yeniden yazımı (server.js rewriteProjectionCacheForRowPatches) ve
   okuma modeli işçisinin bekleyen satır yaması aynı fonksiyonu kullanır; iki uygulama ayrışırsa okuma
   modeli sessizce farklı değer hesaplar. Gövde server.js'ten değiştirilmeden taşındı. */
const parseLib = require('./parse');
const BLBusinessRules = require('../../public/business-rules');
const cpRowStored = require('./cp-row-stored');

/* Yama öğesinin satırı: sipariş kodu + (varsa) model adı ve renk kodu birebir. */
function projectionPatchMatches(row, item) {
  const patch=item&&item.patch||{}, orderCode=parseLib.orderCodeKey(item&&item.orderCode);
  if (!row || parseLib.orderCodeKey(row['Order Code']) !== orderCode) return false;
  const model=String(patch.modelName??patch.model??'').trim(),ccode=String(patch.ccode??patch.colourCode??patch.colorCode??'').trim();
  if (model && String(row['Model Name']||'').trim() !== model) return false;
  if (ccode && String(row['C.Code']||'').trim() !== ccode) return false;
  return true;
}

/* Lojistik segment girdileri — TEK tanım (P1 2026-11-27; artımlı yeniden kurulum 2026-11-28, ADR-0003 §6O.d İş 2).
   Tam kurulumda (parse.js buildBacklogOperationalRows) üretim / kıtlık bakiyesi segmentinin Del. Type'ı delmap'ten,
   varışı Ex-factory + Del. Type + transit kuralından üretilir; satırın Del. Type / Ant. Arrival / STATUS / HANDOVER
   alanları birincil segmentten türetilir. Bu girdileri taşıyan yama (null "Kaynağa dön" dahil) applyIncrementalProjectionPatch
   içinde parse.refreshCpLogisticRow ile tam kurulumun aynı fonksiyonlarıyla yeniden kurulur; gerçekleşmiş IAS
   parsiyelleri kaynaktan gelir, dokunulmaz. Yeniden kurulamayan satır (rowPatchRequiresFullBuild) güvenli tam kuruluma
   düşer. Kural satırın segmentli olup olmadığına bakmaz (yama satırı bilmez). */
function patchTouchesLogisticSegments(patch) {
  if (!patch || typeof patch !== 'object') return false;
  // null ("Kaynağa dön": satır anahtarı silinir) da segment girdisidir; artımlı yol onu yok sayardı (#1241 geri gelir).
  if (Object.prototype.hasOwnProperty.call(patch, 'delType')) return true;
  return Boolean(patch.dates && typeof patch.dates === 'object' && Object.prototype.hasOwnProperty.call(patch.dates, 'exFactory'));
}

function rowPatchRequiresFullBuild(reason) {
  return Object.assign(new Error(`Satır yaması artımlı uygulanamaz (${reason}); tam kurulum gerekir.`), { code: 'ROW_PATCH_REQUIRES_FULL_BUILD', reason });
}
/* options.orderSummary: satır sipariş özeti listesindendir.
   options.cpStored: satır CP modülünün satırıdır (Orders / sipariş özeti satırı `_cpStored` taşımaz). */
function applyIncrementalProjectionPatch(row, patch, overrides, includePriority = true, options = null) {
  if (patch.notes && typeof patch.notes === 'object') {
    if (Object.prototype.hasOwnProperty.call(patch.notes,'Notes')) row.Notes=patch.notes.Notes==null?'':String(patch.notes.Notes);
    if (Object.prototype.hasOwnProperty.call(patch.notes,'EkNot')) row['Ek Not']=patch.notes.EkNot==null?'':String(patch.notes.EkNot);
    /* v7.29 — yazar ve tarih damgaları KAYDEDİLMİŞ notesmap'ten okunur, patch'ten
       değil: patch istemciden gelir ve yazar taşımaz (taşısa da kabul edilmezdi).
       Bu satır atlanırsa önbellekten dönen satırlar yazarsız kalır ve kullanıcının
       az önce yazdığı not kendi Genel Bakış listesinde görünmezdi. */
    const notesRec = (overrides && overrides.notesmap
      && (overrides.notesmap[parseLib.rowLineKey(row)] || overrides.notesmap[parseLib.orderCodeKey(row['Order Code'])])) || {};
    row.NotesHtml=notesRec.NotesHtml||'';row['Ek NotHtml']=notesRec.EkNotHtml||'';
    row._notesAt=notesRec.NotesAt||''; row._ekNotAt=notesRec.EkNotAt||'';
    row._notesBy=notesRec.NotesBy||''; row._notesByName=notesRec.NotesByName||'';
    row._ekNotBy=notesRec.EkNotBy||''; row._ekNotByName=notesRec.EkNotByName||'';
  }
  if (Object.prototype.hasOwnProperty.call(patch,'suppFob')) {
    row['Supp. FOB']=patch.suppFob==null?null:Number(patch.suppFob);
    const meta=patch.suppFobMeta&&typeof patch.suppFobMeta==='object'?patch.suppFobMeta:{source:'manual'};
    row._suppFobMeta=meta;
    row._suppFobManual=meta.source!=='rule';
    row._suppFobOverride=true;
    row._suppFobRule=row._suppFobManual?null:(meta.ruleId||true);
  }
  const delTypePatched = Object.prototype.hasOwnProperty.call(patch, 'delType');
  // Segmentsiz satır: sipariş özeti satırı delmap değerini aynen gösterir (yoksa IAS vasıtası → kaynağa dönüş artımlı
  // kurulamaz); segmentsiz CP / Siparişler satırı üretim vasıta kuralını (backlogProductionDelType) kullanır.
  // Segmentli satırda Del. Type birincil segmentten türetilir (aşağıda refreshCpLogisticRow).
  if (delTypePatched && !(Array.isArray(row._logisticSegments) && row._logisticSegments.length)) {
    if (options && options.orderSummary) {
      // Sipariş özeti delmap değerini aynen gösterir (bugünkü yama davranışı). Kaynağa dönüşte değer sipariş anahtarından
      // gelir; o da yoksa IAS vasıtası / Gemi — satırda IAS kaydı olmadığı için tam kuruluma düşer.
      if (patch.delType != null) row['Del. Type']=String(patch.delType);
      else if (parseLib.effectiveRowDelTypeOverrideHas(row, overrides) === true) row['Del. Type']=String(parseLib.effectiveRowDelTypeOverride(row, patch, overrides) ?? '');
      else throw rowPatchRequiresFullBuild('order-summary-deltype-source');
    } else row['Del. Type']=parseLib.productionDelTypeValue(parseLib.effectiveRowDelTypeOverride(row, patch, overrides));
  }
  if (patch.dates && typeof patch.dates === 'object') {
    const dateFields={exFactory:'Ex-factory',retailDate:'Retail Date',inStoreDate:'In-Store (Model Budget)'};
    for (const [incoming,field] of Object.entries(dateFields)) if (Object.prototype.hasOwnProperty.call(patch.dates,incoming)) row[field]=String(patch.dates[incoming]);
    if(Object.prototype.hasOwnProperty.call(patch.dates,'exFactory')&&row['Buying Son Onay Tarihi']){
      const planned=parseLib.parseDateOnly(row['Ex-factory']);
      const effective=BLBusinessRules.resolveExFactoryDate(planned,row['Buying Son Onay Tarihi'],parseLib.dateOrdinal);
      row._exFactoryRevision=effective.automatic?{source:'loading-approval',previousDate:planned}:null;
      row['Ex-factory']=effective.value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch,'imageRef')) {
    const ref=patch.imageRef==null?'':String(patch.imageRef).trim();
    row._imageRef=ref;row._imageUrl=ref?`/api/cp-images/${encodeURIComponent(ref)}`:'';
  }
  if (patch.noteColumns && typeof patch.noteColumns === 'object') {
    const validIds = new Set((overrides.noteColumnDefs || []).map(def => def.id));
    for (const [id, value] of Object.entries(patch.noteColumns)) {
      if (!validIds.has(id)) continue;
      row[id] = value == null ? '' : String(value);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch,'importance')) parseLib.applyImportanceToRow(row, overrides);
  // Lojistik segment girdisi (Del. Type, Ex-factory): segmentler tam kurulumla AYNI kuralla yeniden kurulur
  // (parse.refreshCpLogisticRow). Kurulamıyorsa (birincil segment IAS parsiyeline geçer/ayrılır) yama güvenli tam
  // kuruluma düşer: projeksiyon yeniden yazımı başarısız olur (sonraki okuma tam kurulum), satır yaması günlüğü kira +
  // tam hesaba döner.
  if (patchTouchesLogisticSegments(patch)) {
    const refreshed = parseLib.refreshCpLogisticRow(row, patch, overrides);
    if (!refreshed.ok) throw rowPatchRequiresFullBuild(refreshed.reason);
  }
  if (delTypePatched || patch.dates) parseLib.applyFormulas(row, overrides.transitRules, includePriority);
  /* CP satır kaydı base'i (`_cpStored`): bağlam paylaşılan belgenin kayıtlı değer haritalarını
     (overrides.cpRowStored, kayıt anında) taşıyorsa satırın kimliğiyle yeniden hesaplanır. */
  if (options && options.cpStored && overrides && overrides.cpRowStored && cpRowStored.patchTouchesCpRowStored(patch)) cpRowStored.setRowStored(row, overrides.cpRowStored);
  return row;
}

module.exports = { applyIncrementalProjectionPatch, projectionPatchMatches, patchTouchesLogisticSegments, rowPatchRequiresFullBuild };
