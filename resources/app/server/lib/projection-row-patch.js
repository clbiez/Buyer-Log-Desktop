'use strict';
/* Projeksiyon satır yaması — TEK tanım (#1078 WS5 satır yaması).
   Projeksiyon önbelleğinin satır yaması yeniden yazımı (server.js rewriteProjectionCacheForRowPatches) ve
   okuma modeli işçisinin bekleyen satır yaması aynı fonksiyonu kullanır; iki uygulama ayrışırsa okuma
   modeli sessizce farklı değer hesaplar. Gövde server.js'ten değiştirilmeden taşındı. */
const parseLib = require('./parse');
const BLBusinessRules = require('../../public/business-rules');

function applyIncrementalProjectionPatch(row, patch, overrides, includePriority = true) {
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
  return row;
}

module.exports = { applyIncrementalProjectionPatch };
