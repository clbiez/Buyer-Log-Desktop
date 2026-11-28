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

/* Lojistik segment girdileri — TEK tanım (P1, 2026-11-27).
   Tam kurulumda (parse.js buildBacklogOperationalRows) üretim segmentinin Del. Type'ı delmap'ten, varışı Ex-factory +
   Del. Type + transit kuralından üretilir; satırın Del. Type / Ant. Arrival / STATUS / HANDOVER alanları segmentten
   türetilir (okuma modeli hazırlığı overview-row-prep rebuildLogisticCaches, istemci rebuildCpLogisticCaches).
   applyIncrementalProjectionPatch segmentleri yeniden üretmez: bu girdileri değiştiren yama artımlı uygulanırsa
   hazırlık eski segmentten eski değeri geri yazar (Del. Type Uçak → Gemi). Böyle bir yama hiçbir yolda artımlı
   uygulanmaz (server.js rowPatchIncrementalSafe: canlı yama, projeksiyon önbelleği, satır yaması günlüğü) → tam kurulum.
   Gerçekleşmiş IAS parsiyellerinin değerleri kaynaktan gelir; tam kurulum onlara dokunmaz.
   KAPSAM: kural satırın segmentli olup olmadığına BAKMAZ (yama satırı bilmez; aktif her siparişin en az bir üretim
   segmenti vardır). Del. Type ya da Ex-factory içeren BÜTÜN yamalar tam kurulum yoluna düşer — değer değişmemiş
   görünse bile (eski kayıt gövdesi görünen Del. Type'ı gönderir; bkz. ADR-0003 §6H). Performans bedeli geçici
   istisnadır (L2 FAIL, #1241). */
function patchTouchesLogisticSegments(patch) {
  if (!patch || typeof patch !== 'object') return false;
  // null ("Kaynağa dön": satır anahtarı silinir) da segment girdisidir; artımlı yol onu yok sayardı (#1241 geri gelir).
  if (Object.prototype.hasOwnProperty.call(patch, 'delType')) return true;
  return Boolean(patch.dates && typeof patch.dates === 'object' && Object.prototype.hasOwnProperty.call(patch.dates, 'exFactory'));
}

/* options.cpStored: satır CP modülünün satırıdır (Orders / sipariş özeti satırı `_cpStored` taşımaz). */
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
  if (patch.delType != null) row['Del. Type']=String(patch.delType);
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
  if (patch.delType != null || patch.dates) parseLib.applyFormulas(row, overrides.transitRules, includePriority);
  /* CP satır kaydı base'i (`_cpStored`): bağlam paylaşılan belgenin kayıtlı değer haritalarını
     (overrides.cpRowStored, kayıt anında) taşıyorsa satırın kimliğiyle yeniden hesaplanır. */
  if (options && options.cpStored && overrides && overrides.cpRowStored && cpRowStored.patchTouchesCpRowStored(patch)) cpRowStored.setRowStored(row, overrides.cpRowStored);
  return row;
}

module.exports = { applyIncrementalProjectionPatch, projectionPatchMatches, patchTouchesLogisticSegments };
