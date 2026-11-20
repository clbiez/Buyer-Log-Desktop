'use strict';
/* Genel Bakış okuma modeli (#1074): CP projeksiyon satırlarını tarayıcının
 * gördüğü biçime getirir. app-main.js normalizeCPDates zincirinin aynası:
 *   tarih alanları → yerel gün Date'i; yükleme onayı Ex-factory revizyonu
 *   (applyCpApprovalDate); lojistik segment tarihleri ve segmentlerden türeyen
 *   alanlar (rebuildCpLogisticCaches: STATUS, Ant. Arrival, HANDOVER Tarihi,
 *   Del. Type, kalan/yüklenen adet).
 * Projeksiyon bu alanları ham taşır; istemci açılışta yeniden türetir. Karar
 * katmanı türetilmiş değerleri okuduğu için sunucu da aynısını yapmalıdır.
 * tests/read-model-overview-parity.test.js gerçek app-main fonksiyonlarıyla
 * eşitliği kilitler. Satırları YERİNDE değiştirir: çağıran paylaşılmayan bir
 * kopya vermelidir (WS1 sorgu veri kümesi ayrı tutulur).
 */
const query=require('../../../public/read-model-query');
const rules=require('../../../public/business-rules');
const revision=require('../../../public/revision-display');
const {norm,turknorm,toNum,coerceDateLoose}=query.internals;
const DATE_KEYS=query.DATE_KEYS;

function dateOrdinal(v){const d=coerceDateLoose(v);return d?Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000):null;}
const delType=value=>rules.normalizeTransitDelType(value);
const segmentsOf=row=>Array.isArray(row&&row._logisticSegments)?row._logisticSegments:[];

function applyApprovalDate(row,planned){
  const previousDate=coerceDateLoose(planned);
  const effective=rules.resolveExFactoryDate(planned,row['Buying Son Onay Tarihi'],dateOrdinal);
  if(effective.automatic){
    if(!Object.prototype.hasOwnProperty.call(row,'_asasExFactory'))row._asasExFactory=previousDate;
    row._exFactoryRevision={source:'loading-approval',previousDate};
    row['Ex-factory']=coerceDateLoose(effective.value);
  }else{
    row._exFactoryRevision=null;
    row['Ex-factory']=previousDate;
  }
  delete row._revBaseRow;
}
function rebuildLogisticCaches(row){
  const segments=segmentsOf(row);if(!segments.length)return;
  const partials=segments.filter(s=>s&&s.kind==='partial');
  const statusSource=segments.filter(s=>s&&s.kind!=='shortage');
  row._logisticStatusValues=[...new Set(statusSource.map(s=>norm(s.status)).filter(Boolean))];
  row._logisticDelTypeValues=[...new Set(segments.map(s=>delType(s.delType)||norm(s.delType)).filter(Boolean))];
  row._logisticArrivalValues=segments.map(s=>coerceDateLoose(s.arrival)).filter(Boolean);
  row._logisticProductionQty=segments.filter(s=>s.kind==='production').reduce((sum,s)=>sum+(toNum(s.quantity)||0),0);
  row._logisticShortageQty=segments.filter(s=>s.kind==='shortage').reduce((sum,s)=>sum+(toNum(s.quantity)||0),0);
  row._logisticLoadedQty=partials.reduce((sum,s)=>sum+(toNum(s.quantity)||0),0);
  row['Shipment Quantity']=row._logisticLoadedQty;
  row._logisticPartialCount=partials.length;
  row._logisticAllPartialsInWarehouse=partials.length>0&&partials.every(s=>turknorm(s.status)==='DEPODA');
  row._logisticRemainingQty=Math.max(0,(toNum(row['Order Quantity'])||0)-row._logisticLoadedQty);
  row['Remaining Units']=row._logisticRemainingQty;
  row['%']=toNum(row['Order Quantity'])?((toNum(row['Order Quantity'])-row._logisticRemainingQty)/toNum(row['Order Quantity'])):'';
  const primary=partials[0]||segments.find(s=>s&&s.kind!=='shortage')||segments[0];
  row.STATUS=primary.status||'Üretimde'; // i18n-ignore
  row['Ant. Arrival']=coerceDateLoose(primary.arrival);
  row['Del. Type']=delType(primary.delType)||norm(primary.delType);
  row['HANDOVER Tarihi']=coerceDateLoose(primary.handover);
}
function prepareCpRows(rows){
  for(const r of Array.isArray(rows)?rows:[]){
    if(!r||typeof r!=='object')continue;
    for(const k of DATE_KEYS)if(k in r)r[k]=coerceDateLoose(r[k]);
    const planned=revision.isAutomaticExFactory(r)?r._exFactoryRevision.previousDate:r['Ex-factory'];
    applyApprovalDate(r,planned);
    for(const segment of segmentsOf(r)){segment.arrival=coerceDateLoose(segment.arrival);segment.handover=coerceDateLoose(segment.handover);}
    if(segmentsOf(r).length)rebuildLogisticCaches(r);
  }
  return rows;
}
module.exports={prepareCpRows};
