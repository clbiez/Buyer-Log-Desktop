(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewGlobalFlow=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';

/* Global Flow Map — parsiyel bazlı sevkiyat motoru.
 *
 * Temel varlık sipariş değil, mümkün olan en düşük gerçek sevkiyat birimidir:
 * CP/Orders satırlarının `_logisticSegments` parsiyelleri ve Backlog'un
 * parsiyel satırları ayrı ayrı konumlanır. Aynı siparişin bir parsiyeli
 * üretimde, diğeri İstanbul deposunda olabilir; ikisi haritada ayrı görünür.
 *
 * Konum canlı GPS/AIS değildir: Handover + ülke/yükleme tipi yol süresi
 * kuralından hesaplanan operasyonel ilerlemedir. Aynı "Gemi Ad" taşıyan
 * parsiyeller aynı gemi + aynı rota ayağında tek araçta toplanır; gemi adı
 * yoksa yakın ilerlemedeki parsiyeller kümelenir.
 */

const ISTANBUL=Object.freeze({name:'İstanbul',lat:41.0082,lon:28.9784});
const COLOMBO=Object.freeze({name:'Colombo',lat:6.93,lon:79.85});
const STORAGE_KEY='buyerlog.overview.globalFlow.v1';
const SOURCE_PRIORITY=Object.freeze({cp:1,orders:2,backlog:3});
/* Gemi+Uçak akışında aktarma limanından İstanbul'a hava ayağının süresi (gün).
   Toplam yol süresi mevcut ülke/yükleme tipi kuralından gelir; deniz ayağı bu
   sürenin kalanıdır. Görsel konumlandırma yaklaşımıdır, iş kuralı değildir. */
const SEA_AIR_AIR_LEG_DAYS=3;
/* Gemi Ad boş parsiyellerde aynı rota ayağındaki araç kümeleme penceresi
   (ayak ilerlemesinin oranı). 70 günlük deniz yolunda ≈3,5 gün. */
const PROGRESS_BUCKET=0.05;
const SYMBOL_MIN_DISTANCE=22;
const FILTER_KEYS=Object.freeze(['season','mag','mmyg','buyer','buyingGroup','manufacturer','country','line','category','license','mode','status']);
const FIELD_CANDIDATES=Object.freeze({
  orderCode:['Sipariş Kod','Sipariş Kodu','Order Code','Order No','Order','OCode'],
  shipmentFile:['İhracat Dosya No','İhracat Dosya Numarası','Export File No','Export File Number','Export File','İthalat Dosya No','İthalat Dosya Numarası','Import File No','Import File Number','Import File'],
  containerNo:['Konteyner No','Konteyner Numarası','Container No','Container Number'],
  vesselName:['Gemi Ad','Gemi Adı','Vessel Name','Ship Name'],
  model:['Model Adı','Model Name','Model','Style Name','Style'],
  plmId:['PLM ID','PLM Id','PLMID','Style ID','StyleId'],
  colourCode:['Renk Kod','Renk Kodu','Colour Code','Color Code'],
  colour:['Renk','Colour','Color'],
  season:['Sezon','Season'],
  mag:['MAG','Merch','Merchandiser','Merch Group','Merch Grubu'],
  mmyg:['MMYG','Age Group','AgeGroup'],
  line:['Line','Product Line'],
  category:['Kategori','Category'],
  license:['Lisans','License'],
  buyer:['Buyer','Alıcı'],
  buyingGroup:['Buyer Grup (TR)','Buyer Group','Buying Group','Buyer Grup','Buying Grup'],
  manufacturer:['Üretici','Manufacturer','Supplier','Alt Üretici','Sub-Manufacturer','Vendor'],
  country:['Siparişin Üretildiği Ülke','Country','Ülke','Origin Country','Origin'],
  status:['GÜNCEL DURUM (STATUS)','Güncel Durum','Status','STATUS','Production Status','Order Status'],
  mode:['YÜKLEME TİPİ','Yükleme Tipi','Loading Type','Shipment Mode','Shipping Mode','Transport Type','Delivery Type','Del. Type'],
  qty:['Adet','Net Alım Sipariş Miktarı','Order Quantity','Qty','Quantity','Kalan Alım Sipariş Miktarı'],
  eta:['ANTREPO GİRİŞ TARİHİ','Antrepo Giriş Tarihi','Antrepo ETA','Warehouse ETA','ETA','Ant. Arrival'],
  handover:['HANDOVER Tarihi','Handover Tarihi','Handover Date','HANDOVER','Handover'],
  exFactory:['REVİZE YÜKLEME TARİHİ (EX-FACTORY)','Revize Yükleme Tarihi','Orijinal Exfactory Merch Tarih','Ex-Factory','Ex Factory','Planned Ex-Factory'],
  transitDays:['Yol Süresi','Yol Süresi (Gün)','Transit Süresi','Transit Gün','Transit Days','Lead Time Days'],
  priority:['Priority','RİSK (PRIORITY)','Risk','RİSK'],
  receivedQty:['Net Gelen Alım Sipariş Miktarı'],
  warehouseReadyQty:['Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo'],
});
/* Ortak alanlar önce kanonik alan kayıt defterinin modül bağlamasından okunur
   (public/canonical-fields.js). FIELD_CANDIDATES yalnız kayıt defterinde
   karşılığı olmayan kaynak başlıkları (Backlog Excel şablonu gibi) için
   yedek listedir. */
const CANONICAL_FIELD_IDS=Object.freeze({
  orderCode:'orderCode',model:'modelName',plmId:'plmId',colourCode:'colourCode',colour:'colour',season:'season',
  mag:'mag',mmyg:'mmyg',line:'line',category:'category',license:'license',buyer:'buyer',buyingGroup:'buyingGroup',
  manufacturer:'manufacturer',country:'country',status:'orderStatus',mode:'deliveryType'
});
const RECORD_FIELDS=Object.freeze(Object.keys(FIELD_CANDIDATES));

const COUNTRY_POINTS=Object.freeze({
  'turkey':ISTANBUL,'turkiye':ISTANBUL,'türkiye':ISTANBUL,'tr':ISTANBUL,
  'bangladesh':{name:'Bangladesh',lat:23.685,lon:90.3563},'bd':{name:'Bangladesh',lat:23.685,lon:90.3563},
  'india':{name:'India',lat:20.5937,lon:78.9629},'in':{name:'India',lat:20.5937,lon:78.9629},
  'china':{name:'China',lat:35.8617,lon:104.1954},'cn':{name:'China',lat:35.8617,lon:104.1954},
  'egypt':{name:'Egypt',lat:26.8206,lon:30.8025},'misir':{name:'Egypt',lat:26.8206,lon:30.8025},'mısır':{name:'Egypt',lat:26.8206,lon:30.8025},
  'pakistan':{name:'Pakistan',lat:30.3753,lon:69.3451},
  'vietnam':{name:'Vietnam',lat:14.0583,lon:108.2772},'viet nam':{name:'Vietnam',lat:14.0583,lon:108.2772},
  'indonesia':{name:'Indonesia',lat:-0.7893,lon:113.9213},
  'cambodia':{name:'Cambodia',lat:12.5657,lon:104.991},
  'myanmar':{name:'Myanmar',lat:21.9162,lon:95.956},
  'sri lanka':{name:'Sri Lanka',lat:7.8731,lon:80.7718},
  'morocco':{name:'Morocco',lat:31.7917,lon:-7.0926},'fas':{name:'Morocco',lat:31.7917,lon:-7.0926},
  'tunisia':{name:'Tunisia',lat:33.8869,lon:9.5375},'tunus':{name:'Tunisia',lat:33.8869,lon:9.5375},
  'portugal':{name:'Portugal',lat:39.3999,lon:-8.2245},
  'spain':{name:'Spain',lat:40.4637,lon:-3.7492},'ispanya':{name:'Spain',lat:40.4637,lon:-3.7492},
  'italy':{name:'Italy',lat:41.8719,lon:12.5674},'italya':{name:'Italy',lat:41.8719,lon:12.5674},
  'germany':{name:'Germany',lat:51.1657,lon:10.4515},'almanya':{name:'Germany',lat:51.1657,lon:10.4515},
  'united kingdom':{name:'United Kingdom',lat:55.3781,lon:-3.436},'uk':{name:'United Kingdom',lat:55.3781,lon:-3.436},
  'bulgaria':{name:'Bulgaria',lat:42.7339,lon:25.4858},'bulgaristan':{name:'Bulgaria',lat:42.7339,lon:25.4858},
  'romania':{name:'Romania',lat:45.9432,lon:24.9668},'romanya':{name:'Romania',lat:45.9432,lon:24.9668},
  'serbia':{name:'Serbia',lat:44.0165,lon:21.0059},'sirbistan':{name:'Serbia',lat:44.0165,lon:21.0059},'sırbistan':{name:'Serbia',lat:44.0165,lon:21.0059},
  'north macedonia':{name:'North Macedonia',lat:41.6086,lon:21.7453},'macedonia':{name:'North Macedonia',lat:41.6086,lon:21.7453},
  'greece':{name:'Greece',lat:39.0742,lon:21.8243},'yunanistan':{name:'Greece',lat:39.0742,lon:21.8243},
  'uae':{name:'UAE',lat:23.4241,lon:53.8478},'united arab emirates':{name:'UAE',lat:23.4241,lon:53.8478},'bae':{name:'UAE',lat:23.4241,lon:53.8478},
  'saudi arabia':{name:'Saudi Arabia',lat:23.8859,lon:45.0792},
  'south korea':{name:'South Korea',lat:35.9078,lon:127.7669},'korea':{name:'South Korea',lat:35.9078,lon:127.7669},
  'japan':{name:'Japan',lat:36.2048,lon:138.2529},
  'usa':{name:'USA',lat:37.0902,lon:-95.7129},'united states':{name:'USA',lat:37.0902,lon:-95.7129},
  'mexico':{name:'Mexico',lat:23.6345,lon:-102.5528},
  'brazil':{name:'Brazil',lat:-14.235,lon:-51.9253},
  'south africa':{name:'South Africa',lat:-30.5595,lon:22.9375},
  'australia':{name:'Australia',lat:-25.2744,lon:133.7751}
});

const LAND=Object.freeze([
  [[-168,72],[-150,70],[-136,58],[-126,51],[-124,42],[-116,32],[-105,24],[-98,19],[-88,20],[-82,25],[-80,32],[-74,40],[-64,46],[-58,52],[-66,60],[-85,66],[-105,72],[-130,70],[-150,75]],
  [[-82,12],[-76,5],[-79,-7],[-73,-18],[-70,-31],[-64,-45],[-55,-55],[-47,-52],[-40,-25],[-35,-8],[-50,2],[-60,8],[-72,11]],
  [[-18,36],[-8,43],[5,45],[13,52],[26,59],[45,66],[70,73],[100,74],[130,65],[156,58],[176,50],[168,39],[145,36],[129,30],[120,22],[111,8],[101,2],[91,9],[80,22],[68,24],[55,26],[45,34],[37,40],[30,45],[23,41],[15,39],[7,36],[-2,35]],
  [[-17,34],[-7,36],[10,36],[25,31],[35,22],[43,12],[50,2],[43,-12],[34,-24],[25,-35],[14,-35],[5,-30],[-2,-20],[-8,-4],[-16,14]],
  [[112,-11],[125,-11],[138,-17],[153,-28],[151,-39],[136,-44],[119,-35],[113,-22]],
  [[-52,82],[-26,78],[-18,70],[-28,60],[-45,60],[-61,70]],
  [[47,-13],[50,-16],[49,-25],[44,-25],[43,-18]]
]);

function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
/* norm saf bir fonksiyondur; statü, ülke, yükleme tipi gibi değerler binlerce
   parsiyelde tekrar ettiği için sınırlı bir önbellekle hesaplanır. */
const NORM_CACHE=new Map(),NORM_CACHE_LIMIT=20000;
function norm(value){
  const key=typeof value==='string'?value:String(value==null?'':value);
  let out=NORM_CACHE.get(key);if(out!==undefined)return out;
  out=clean(key).toLocaleLowerCase('tr-TR')
    .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ı/g,'i')
    .replace(/[()]/g,' ').replace(/[_/\\-]+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  if(NORM_CACHE.size>=NORM_CACHE_LIMIT)NORM_CACHE.clear();
  NORM_CACHE.set(key,out);return out;
}
function toNumber(value){
  if(typeof value==='number')return Number.isFinite(value)?value:0;
  let s=clean(value);if(!s)return 0;
  s=s.replace(/[^\d,.-]/g,'');
  if(s.includes(',')&&s.includes('.')){
    if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');
    else s=s.replace(/,/g,'');
  }else if(/^\-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else if(/^\-?\d{1,3}(,\d{3})+$/.test(s))s=s.replace(/,/g,'');
  else s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:0;
}
function dateText(value){
  if(value==null||value==='')return '';
  if(value instanceof Date){
    if(Number.isNaN(value.getTime()))return '';
    const p=n=>String(n).padStart(2,'0');return value.getFullYear()+'-'+p(value.getMonth()+1)+'-'+p(value.getDate());
  }
  return clean(value);
}
function normalizedIndex(row){
  const out={};Object.keys(row||{}).forEach(key=>{const nk=norm(key);if(nk&&!Object.prototype.hasOwnProperty.call(out,nk))out[nk]=row[key];});return out;
}
function pick(row,candidates){
  const idx=normalizedIndex(row);
  for(const name of candidates||[]){
    const value=idx[norm(name)];
    if(value!=null&&clean(value)!=='')return value;
  }
  return '';
}
function canonicalKeys(field,moduleId){
  const registry=(typeof globalThis!=='undefined'&&globalThis.BLCanonicalFields)||null,id=CANONICAL_FIELD_IDS[field];
  if(!registry||!id||typeof registry.bindingFor!=='function')return [];
  try{const binding=registry.bindingFor(moduleId,id);return binding&&Array.isArray(binding.keys)?binding.keys:[];}catch(_){return [];}
}
/* Satır biçimi başına bir kez çözülen alan → gerçek sütun anahtarı eşlemesi.
   Eski yol her alan okumasında satırın bütün başlıklarını yeniden normalize
   ediyordu (satır başına ~25 × sütun sayısı norm() çağrısı). */
function createFieldResolver(moduleId){
  const shapes=new Map();
  function mappingFor(row){
    // Anahtar tam başlık listesidir: JSON undefined alanları düşürdüğü için aynı
    // uzunluktaki iki satır farklı ara sütunlara sahip olabilir.
    const keys=Object.keys(row||{}),shape=keys.join('\u0001');
    let mapping=shapes.get(shape);if(mapping)return mapping;
    const index=new Map();keys.forEach(key=>{const nk=norm(key);if(nk&&!index.has(nk))index.set(nk,key);});
    mapping={};
    RECORD_FIELDS.forEach(field=>{
      const out=[],seen=new Set();
      canonicalKeys(field,moduleId).concat(FIELD_CANDIDATES[field]).forEach(candidate=>{const actual=index.get(norm(candidate));if(actual!=null&&!seen.has(actual)){seen.add(actual);out.push(actual);}});
      mapping[field]=out;
    });
    shapes.set(shape,mapping);return mapping;
  }
  // Aynı satırın alanları art arda okunur; biçim eşlemesi satır başına bir kez bulunur.
  let lastRow=null,lastMapping=null;
  return function get(row,field){
    if(row!==lastRow){lastRow=row;lastMapping=mappingFor(row);}
    const keys=lastMapping[field]||[];
    for(const key of keys){const value=row[key];if(value!=null&&clean(value)!=='')return value;}
    return '';
  };
}
function countryCoordinate(value){
  const key=norm(value);if(!key)return null;
  if(COUNTRY_POINTS[key])return {...COUNTRY_POINTS[key]};
  const entries=Object.entries(COUNTRY_POINTS);
  const found=entries.find(([name])=>key===name||(name.length>2&&key.includes(name))||(key.length>2&&name.includes(key)));
  return found?{...found[1]}:null;
}
function detectMode(value){
  const s=norm(value);
  const sea=/deniz|gemi|sea|ocean|vessel/.test(s);
  const air=/hava|ucak|air|flight/.test(s);
  const road=/kara|tir|truck|road|land/.test(s);
  if(sea&&air)return 'sea-air';
  if(air)return 'air';
  if(sea)return 'sea';
  if(road)return 'road';
  return 'unknown';
}
function operationalStage(status){
  const br=(typeof globalThis!=='undefined'&&globalThis.BLBusinessRules)||null;
  if(br&&typeof br.operationalStageOf==='function'){
    try{return br.operationalStageOf(status);}catch(_){}
  }
  const s=norm(status);
  if(/retail aktarim|awaiting retail transfer/.test(s))return 'AWAITING_RETAIL_TRANSFER';
  if(/gumruk|liman|customs|port operation/.test(s))return 'CUSTOMS';
  if(/depoda|in warehouse|warehouse/.test(s))return 'IN_WAREHOUSE';
  if(/yol operasyon|yolda|in transit|transit|departed|shipped/.test(s))return 'IN_TRANSIT';
  if(/yukleme operasyon|loading operation/.test(s))return 'LOADING';
  if(/uretim|production|imalat|sewing|cutting|dikim|kesim/.test(s))return 'PRODUCTION';
  if(/eksik yukleme|shortage/.test(s))return 'SHORTAGE';
  return 'UNKNOWN';
}
function classifyState(status,mode,raw,receivedQty){
  const stage=operationalStage(status),s=norm(status);
  let received=Number(receivedQty);
  if(!Number.isFinite(received)){
    const idx=raw&&Object.keys(raw).length?normalizedIndex(raw):{};
    received=toNumber(idx[norm('Net Gelen Alım Sipariş Miktarı')])+toNumber(idx[norm('Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo')]);
  }
  if(stage==='CUSTOMS'||stage==='IN_WAREHOUSE'||stage==='AWAITING_RETAIL_TRANSFER')return 'arrived';
  if(stage==='IN_TRANSIT')return 'transit';
  if(stage==='LOADING')return 'ready';
  if(stage==='PRODUCTION')return 'production';
  if(stage==='SHORTAGE')return /depoda|warehouse/.test(s)?'arrived':'ready';
  if(/tamam|completed|teslim|delivered|magaza|store/.test(s))return 'arrived';
  if(/antrepo|istanbul|warehouse|depo giris|depo giri|received|ulasti|varis|arrival/.test(s)||received>0)return 'arrived';
  if(/yolda|transit|sevk edildi|sevkedildi|departed|shipped|loaded/.test(s))return 'transit';
  if(/yukleme operasyon|loading operation/.test(s))return 'ready';
  if(mode!=='unknown'&&/sevk|shipment|handover/.test(s))return 'transit';
  if(/hazir|ready|sevke hazir|production complete|uretim tamam/.test(s))return 'ready';
  if(/uretim|production|imalat|sewing|cutting|dikim|kesim/.test(s))return 'production';
  if(mode!=='unknown'&&s&&!/iptal|cancel/.test(s))return 'transit';
  return 'production';
}
/* Tek kanonik Unified Action Priority kodu (order-decision-engine.js).
   CP/Orders satırındaki Priority zaten bu koddur; etiket (Kritik/Critical)
   gelirse aynı sözlükten koda çevrilir. "Risk VAR" gibi metinler öncelik
   değildir ve Critical sayılmaz. */
const ACTION_PRIORITY_FALLBACK=Object.freeze(['CRITICAL','ACTION_TODAY','ACTION_THIS_WEEK','WATCH','ON_TRACK']);
function actionPriorityCode(value){
  const text=clean(value).toLocaleUpperCase('en-US').replace(/\s+/g,'_');if(!text)return '';
  const od=(typeof globalThis!=='undefined'&&globalThis.BLOrderDecisionEngine)||null,table=od&&od.ACTION_PRIORITY||null;
  if(table?table[text]:ACTION_PRIORITY_FALLBACK.includes(text))return text;
  if(text==='ACT_TODAY')return 'ACTION_TODAY';if(text==='ACT_THIS_WEEK')return 'ACTION_THIS_WEEK';
  if(table){const wanted=norm(value);for(const [code,meta] of Object.entries(table)){if(norm(meta&&meta.tr)===wanted||norm(meta&&meta.en)===wanted)return code;}}
  else if(/^(kritik|critical)$/.test(norm(value)))return 'CRITICAL';
  return '';
}
function backlogActionPriority(row){
  const engine=(typeof globalThis!=='undefined'&&globalThis.BLBacklogDeliveryEngine)||null;
  if(!engine||typeof engine.analyzeOrder!=='function'||!row||!row._backlogExcel)return '';
  try{const result=engine.analyzeOrder(row);return actionPriorityCode(result&&(result.actionPriority||result.priority));}catch(_){return '';}
}
function vesselKey(value){return norm(value);}
function orderKeyOf(rec){
  const order=norm(rec&&rec.orderCode);if(!order)return '';
  return order+'|'+norm(rec&&rec.model)+'|'+norm(rec&&rec.colourCode);
}
function partialIdentity(rec,segmentIndex){
  const base=(rec&&rec.orderKey!=null?rec.orderKey:orderKeyOf(rec))||('row#'+String(rec&&rec.rowIndex!=null?rec.rowIndex:0));
  const prefix=String(rec&&rec.source||'source')+'|'+base+'|';
  if(rec&&rec.sourceRow!=null&&rec.sourceRow!=='')return prefix+'ias#'+rec.sourceRow;
  if(rec&&rec.partialKind&&rec.partialNo!=null)return prefix+rec.partialKind+'-'+rec.partialNo;
  if(rec&&rec.partialKind)return prefix+rec.partialKind+'@'+(segmentIndex!=null?segmentIndex:(rec.rowIndex||0));
  return prefix+'row#'+String(rec&&rec.rowIndex!=null?rec.rowIndex:0);
}
function normalizeRecord(row,source,index,resolver){
  const get=typeof resolver==='function'?resolver:createFieldResolver(source);
  const src=row||{},meta=src._backlogExcel&&typeof src._backlogExcel==='object'?src._backlogExcel:null,partial=src._partial&&typeof src._partial==='object'?src._partial:null;
  const modeRaw=clean(get(src,'mode')),mode=detectMode(modeRaw);
  const status=clean(get(src,'status'));
  const country=clean(get(src,'country'));
  const priority=clean(get(src,'priority'));
  const rec={
    id:'',rowIndex:index||0,
    source:String(source||''),
    orderCode:clean(get(src,'orderCode')),
    shipmentFile:clean(partial&&partial.importFile||get(src,'shipmentFile')),
    containerNo:clean(partial&&partial.containerNo||get(src,'containerNo')),
    vesselName:clean(partial&&partial.vesselName||get(src,'vesselName')),
    partialKind:partial?clean(partial.kind):'',
    partialNo:partial&&partial.partialNo!=null?partial.partialNo:null,
    sourceRow:partial&&partial.sourceRow!=null?partial.sourceRow:null,
    model:clean(get(src,'model')),
    plmId:clean(get(src,'plmId')),
    colourCode:clean(get(src,'colourCode')),
    colour:clean(get(src,'colour')),
    season:clean(get(src,'season')),
    mag:clean(get(src,'mag')||(meta&&meta.mag)),
    mmyg:clean(get(src,'mmyg')||(meta&&meta.mmyg)),
    line:clean(get(src,'line')),
    category:clean(get(src,'category')),
    license:clean(get(src,'license')),
    buyer:clean(get(src,'buyer')),
    buyingGroup:clean(get(src,'buyingGroup')),
    manufacturer:clean(get(src,'manufacturer')),
    country,
    status,
    operationalStage:operationalStage(status),
    mode,
    modeRaw,
    qty:Math.max(0,toNumber(get(src,'qty'))),
    eta:dateText(get(src,'eta')),
    handover:dateText(meta&&meta.handoverDate)||dateText(get(src,'handover')),
    exFactory:dateText(get(src,'exFactory')),
    transitDays:Math.max(0,meta&&Number(meta.transitDays)>0?Number(meta.transitDays):toNumber(get(src,'transitDays'))),
    priority,
    actionPriority:actionPriorityCode(priority)||backlogActionPriority(src),
    origin:countryCoordinate(country),
    raw:src
  };
  rec.vesselKey=vesselKey(rec.vesselName);
  rec.orderKey=orderKeyOf(rec);
  rec.critical=rec.actionPriority==='CRITICAL';
  rec.state=classifyState(rec.status,rec.mode,null,toNumber(get(src,'receivedQty'))+toNumber(get(src,'warehouseReadyQty')));
  rec.id=partialIdentity(rec);
  return rec;
}
/* CP/Orders satırı sipariş seviyesindedir; gerçek sevkiyat birimleri
   `_logisticSegments` içindeki IAS parsiyelleri + üretim/eksik yükleme
   bakiyeleridir. Her segment kendi statü, miktar, yükleme tipi, handover ve
   parsiyel kimliğiyle ayrı kayıt olur; sipariş alanları paylaşılır. */
function expandSourceRow(row,source,index,resolver){
  const base=normalizeRecord(row,source,index,resolver);
  const segments=Array.isArray(row&&row._logisticSegments)?row._logisticSegments.filter(Boolean):[];
  if(!segments.length)return [base];
  return segments.map((segment,segmentIndex)=>{
    const rec={...base};
    rec.partialKind=clean(segment.kind)||'partial';
    rec.partialNo=segment.partialNo!=null?segment.partialNo:null;
    rec.sourceRow=segment.sourceRow!=null?segment.sourceRow:null;
    rec.status=clean(segment.status)||base.status;
    rec.operationalStage=operationalStage(rec.status);
    rec.modeRaw=clean(segment.delType)||base.modeRaw;rec.mode=detectMode(rec.modeRaw);
    rec.qty=Math.max(0,toNumber(segment.quantity));
    // Handover yalnız parsiyelin kendi IAS satırından gelir; başka parsiyelin tarihi ödünç alınmaz.
    rec.handover=dateText(segment.handover);
    rec.eta=dateText(segment.arrival)||base.eta;
    rec.shipmentFile=clean(segment.importFile);rec.containerNo=clean(segment.containerNo);
    rec.vesselName=clean(segment.vesselName);rec.vesselKey=vesselKey(rec.vesselName);
    rec.state=classifyState(rec.status,rec.mode,null,0);
    rec.id=partialIdentity(rec,segmentIndex);
    return rec;
  });
}
function shipmentPartialsFromRows(rows,source){
  const resolver=createFieldResolver(source),out=[];
  (Array.isArray(rows)?rows:[]).forEach((row,index)=>{
    if(!row||typeof row!=='object')return;
    expandSourceRow(row,source,index,resolver).forEach(rec=>{if(rec.orderCode||rec.model||rec.country||rec.status)out.push(rec);});
  });
  return out;
}
function recordKey(rec){
  const key=orderKeyOf(rec);if(key)return key;
  return (rec&&rec.source||'')+'|'+(rec&&rec.id||'');
}
/* Birleşik kaynak: aynı sipariş kimliği için en öncelikli kaynak
   (Backlog > Orders > CP) seçilir ve O KAYNAĞIN BÜTÜN parsiyelleri korunur.
   Parsiyeller hiçbir zaman tek kayda indirgenmez. */
function dedupeRecords(records){
  const best=new Map(),list=Array.isArray(records)?records:[];
  list.forEach(rec=>{const key=recordKey(rec),prev=best.get(key);if(prev==null||(SOURCE_PRIORITY[rec.source]||0)>(SOURCE_PRIORITY[prev]||0))best.set(key,rec.source);});
  const seen=new Set();
  return list.filter(rec=>{
    if(best.get(recordKey(rec))!==rec.source)return false;
    const id=rec.source+'#'+rec.id;if(seen.has(id))return false;seen.add(id);return true;
  });
}
function aggregateRecords(records){
  const groups=new Map();
  (records||[]).forEach(rec=>{
    const origin=rec.origin;
    const location=rec.state==='arrived'?ISTANBUL:origin;
    const key=[rec.state,rec.mode,origin?origin.name:'unknown',location?location.name:'unknown'].join('|');
    if(!groups.has(key))groups.set(key,{key,state:rec.state,mode:rec.mode,origin,location,qty:0,orders:0,critical:false,records:[]});
    const group=groups.get(key);group.qty+=Number(rec.qty)||0;group.orders++;group.records.push(rec);if(rec.critical)group.critical=true;
  });
  return [...groups.values()];
}
function uniqueValues(records,key){
  const set=new Set();(records||[]).forEach(r=>{const value=clean(r&&r[key]);if(value)set.add(value);});
  return [...set].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true,sensitivity:'base'}));
}

function parseDateMs(value){
  if(value==null||value==='')return null;
  if(value instanceof Date)return Number.isNaN(value.getTime())?null:value.getTime();
  const text=clean(value);let m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]));
  m=text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if(m)return Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]));
  const parsed=Date.parse(text);return Number.isFinite(parsed)?parsed:null;
}
function defaultTransitDaysForMode(mode){return mode==='sea'?70:mode==='air'?15:mode==='sea-air'?35:mode==='road'?10:30;}
function ruleListMatches(values,wanted){
  const list=Array.isArray(values)?values:(values==null||values===''?[]:[values]);if(!list.length)return true;
  const target=norm(wanted);return list.some(item=>{const value=norm(item);return value===target||value.includes(target)||target.includes(value);});
}
function localTransitRule(rec,rules){
  const day=parseDateMs(rec.handover||rec.exFactory);
  const matches=(Array.isArray(rules)?rules:[]).filter(rule=>{
    if(detectMode(rule&&rule.delType)!==rec.mode)return false;
    if(!ruleListMatches(rule&&rule.countries,rec.country)||!ruleListMatches(rule&&rule.seasons,rec.season))return false;
    const start=parseDateMs(rule&&rule.exfStart),end=parseDateMs(rule&&rule.exfEnd);
    if(day!=null&&start!=null&&day<start)return false;if(day!=null&&end!=null&&day>end)return false;
    return Number.isFinite(Number(rule&&rule.days))&&Number(rule.days)>=0;
  });
  matches.sort((a,b)=>{
    const score=r=>(Array.isArray(r.countries)&&r.countries.length?2:0)+(Array.isArray(r.seasons)&&r.seasons.length?1:0)+(r.exfStart||r.exfEnd?1:0);
    return score(b)-score(a);
  });
  return matches[0]||null;
}
function resolveRecordTransitDays(rec,rules){
  if(Number(rec&&rec.transitDays)>0)return Number(rec.transitDays);
  const br=(typeof globalThis!=='undefined'&&globalThis.BLBusinessRules)||null;
  if(br&&typeof br.resolveTransitDays==='function'&&rec){
    try{
      const resolved=br.resolveTransitDays({delType:rec.modeRaw||rec.mode,exFactory:rec.handover||rec.exFactory,season:rec.season,country:rec.country,status:rec.status,rules:Array.isArray(rules)?rules:[],forceRules:true});
      if(resolved&&Number(resolved.days)>0)return Number(resolved.days);
    }catch(_){}
  }
  const rule=localTransitRule(rec||{},rules);if(rule&&Number(rule.days)>0)return Number(rule.days);
  const start=parseDateMs(rec&&(rec.handover||rec.exFactory)),eta=parseDateMs(rec&&rec.eta);
  if(start!=null&&eta!=null&&eta>start){const days=Math.round((eta-start)/86400000);if(days>0)return days;}
  return defaultTransitDaysForMode(rec&&rec.mode);
}
function recordRouteProgress(rec,rules,nowValue){
  const start=parseDateMs(rec&&(rec.handover||rec.exFactory)),leadDays=Math.max(1,resolveRecordTransitDays(rec||{},rules));
  const now=nowValue==null?Date.now():(nowValue instanceof Date?nowValue.getTime():Number(nowValue));
  if(start==null||!Number.isFinite(now))return {progress:.04,known:false,elapsedDays:null,leadDays,remainingDays:leadDays};
  const elapsedDays=Math.max(0,(now-start)/86400000),progress=Math.max(0,Math.min(1,elapsedDays/leadDays));
  return {progress,known:true,elapsedDays,leadDays,remainingDays:Math.max(0,leadDays-elapsedDays)};
}
function distancePointToSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;if(!len2)return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function distanceToPolyline(x,y,points){
  if(!Array.isArray(points)||!points.length)return Infinity;if(points.length===1)return Math.hypot(x-points[0].x,y-points[0].y);
  let best=Infinity;for(let i=1;i<points.length;i++){if(points[i].legIndex!==points[i-1].legIndex||points[i].gap)continue;best=Math.min(best,distancePointToSegment(x,y,points[i-1].x,points[i-1].y,points[i].x,points[i].y));}
  return best;
}
function decodeWorldTopology(topology){
  if(!topology||!Array.isArray(topology.arcs)||!topology.objects)return [];
  const transform=topology.transform||{},scale=transform.scale||[1,1],translate=transform.translate||[0,0],cache=new Map();
  function arcAt(index){
    const reverse=index<0,key=reverse?~index:index;
    if(!cache.has(key)){
      let x=0,y=0;cache.set(key,(topology.arcs[key]||[]).map(delta=>{x+=Number(delta[0])||0;y+=Number(delta[1])||0;return [x*Number(scale[0]||1)+Number(translate[0]||0),y*Number(scale[1]||1)+Number(translate[1]||0)];}));
    }
    const points=cache.get(key).slice();return reverse?points.reverse():points;
  }
  function ringOf(indexes){const out=[];(indexes||[]).forEach((arcIndex,i)=>{const part=arcAt(arcIndex);if(i&&part.length)part.shift();out.push(...part);});return out;}
  const object=topology.objects.countries||Object.values(topology.objects)[0],geometries=object&&object.type==='GeometryCollection'?object.geometries:[object],polygons=[];
  (geometries||[]).forEach(geometry=>{
    if(!geometry)return;
    if(geometry.type==='Polygon')polygons.push((geometry.arcs||[]).map(ringOf).filter(r=>r.length>=3));
    else if(geometry.type==='MultiPolygon')(geometry.arcs||[]).forEach(poly=>polygons.push((poly||[]).map(ringOf).filter(r=>r.length>=3)));
  });
  return polygons.filter(poly=>poly.length);
}

const SEA_CORRIDOR_EAST=Object.freeze([[88,15],[81,7],[72,8],[59,11.5],[48,12.2],[43.4,12.6],[39,20],[35,27.2],[32.55,30],[32.3,31.3],[29.2,33.4],[26.1,35.1],[24.7,37.3],[26.4,40.2],[27.7,40.7],[28.9784,41.0082]]);
const SEA_CORRIDOR_MED_WEST=Object.freeze([[-5.5,35.9],[1,37],[10,37.5],[18,36],[24.7,37.3],[26.4,40.2],[27.7,40.7],[28.9784,41.0082]]);
function dedupePoints(points){
  const out=[];points.forEach(point=>{if(!out.length||Math.abs(out[out.length-1][0]-point[0])>.0001||Math.abs(out[out.length-1][1]-point[1])>.0001)out.push(point);});
  return out.map(point=>({lon:Number(point[0]),lat:Number(point[1])}));
}
function seaRouteCoordinates(countryValue){
  const key=norm(countryValue),origin=countryCoordinate(countryValue);let prefix=[];
  if(/bangladesh/.test(key))prefix=[[91.82,22.35],[90,17],...SEA_CORRIDOR_EAST];
  else if(/india/.test(key))prefix=[[72.88,19.08],[66,15],[59,11.5],...SEA_CORRIDOR_EAST.slice(4)];
  else if(/pakistan/.test(key))prefix=[[67.01,24.86],[62,18],[56,13],...SEA_CORRIDOR_EAST.slice(5)];
  else if(/sri lanka/.test(key))prefix=[[79.85,6.93],[72,8],...SEA_CORRIDOR_EAST.slice(3)];
  else if(/china/.test(key))prefix=[[121.5,31.2],[122,24],[116,15],[107,7],[103,1.6],[94,3],[82,6],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/vietnam|viet nam/.test(key))prefix=[[106.72,10.75],[105,5],[103,1.6],[94,3],[82,6],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/cambodia/.test(key))prefix=[[103.5,10.5],[103,1.6],[94,3],[82,6],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/myanmar/.test(key))prefix=[[96.16,16.77],[92,10],[84,7],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/indonesia/.test(key))prefix=[[106.8,-6],[105,-7],[96,-4],[88,2],[82,6],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/japan/.test(key))prefix=[[139.7,35.2],[132,28],[123,22],[116,15],[107,7],[103,1.6],[94,3],[82,6],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/south korea|korea/.test(key))prefix=[[129.04,35.1],[124,27],[116,15],[107,7],[103,1.6],[94,3],[82,6],...SEA_CORRIDOR_EAST.slice(2)];
  else if(/uae|united arab emirates|bae/.test(key))prefix=[[55.03,25],[56.4,25.7],[58,20],[55,15],[48,12.2],...SEA_CORRIDOR_EAST.slice(5)];
  else if(/saudi arabia/.test(key))prefix=[[39.17,21.5],[37,24],[34.8,28],[32.55,30],...SEA_CORRIDOR_EAST.slice(9)];
  else if(/egypt|misir/.test(key))prefix=[[29.9,31.2],[27,33],[25,36],[24.7,37.3],[26.4,40.2],[27.7,40.7],[28.9784,41.0082]];
  else if(/morocco|fas/.test(key))prefix=[[-7.62,33.6],[-8,35],...SEA_CORRIDOR_MED_WEST];
  else if(/portugal/.test(key))prefix=[[-9.14,38.7],[-9,36.5],...SEA_CORRIDOR_MED_WEST];
  else if(/spain|ispanya/.test(key))prefix=[[-5.35,36.14],...SEA_CORRIDOR_MED_WEST];
  else if(/tunisia|tunus/.test(key))prefix=[[10.3,36.8],[12,36],[18,36],...SEA_CORRIDOR_MED_WEST.slice(3)];
  else if(/italy|italya/.test(key))prefix=[[15.3,37],[19,36],[24.7,37.3],[26.4,40.2],[27.7,40.7],[28.9784,41.0082]];
  else if(/greece|yunanistan/.test(key))prefix=[[23.7,37.9],[24.7,39],[26.4,40.2],[27.7,40.7],[28.9784,41.0082]];
  else if(/south africa/.test(key))prefix=[[18.4,-34],[5,-28],[-5,-10],[-12,12],[-12,28],...SEA_CORRIDOR_MED_WEST];
  else if(/australia/.test(key))prefix=[[115.8,-32],[100,-25],[88,-10],[80,2],[72,8],...SEA_CORRIDOR_EAST.slice(3)];
  else if(/usa|united states/.test(key))prefix=[[-74,40],[-50,39],[-30,38],[-12,36],...SEA_CORRIDOR_MED_WEST];
  else if(/mexico/.test(key))prefix=[[-96,20],[-80,25],[-60,33],[-30,37],[-12,36],...SEA_CORRIDOR_MED_WEST];
  else if(/brazil/.test(key))prefix=[[-43,-23],[-25,-5],[-18,15],[-12,30],...SEA_CORRIDOR_MED_WEST];
  else if(origin)prefix=[[origin.lon,origin.lat],...SEA_CORRIDOR_MED_WEST];
  else prefix=[[28.9784,41.0082]];
  return dedupePoints(prefix);
}
function seaAirRouteCoordinates(countryValue){
  const key=norm(countryValue),origin=countryCoordinate(countryValue);let sea=[];
  if(/bangladesh/.test(key))sea=[[91.82,22.35],[88,15],[80,8],[70,10],[60,17],[55.03,25]];
  else if(/india/.test(key))sea=[[72.88,19.08],[66,19],[60,21],[55.03,25]];
  else if(/pakistan/.test(key))sea=[[67.01,24.86],[61,24],[55.03,25]];
  else if(/china|vietnam|cambodia|myanmar|indonesia|japan|korea/.test(key)){
    const full=seaRouteCoordinates(countryValue),cut=full.findIndex(p=>p.lon<80);
    sea=(cut>1?full.slice(0,cut):full.slice(0,Math.min(7,full.length))).map(p=>[p.lon,p.lat]);sea.push([64,18],[58,22],[55.03,25]);
  }else if(origin)sea=[[origin.lon,origin.lat],[55.03,25]];else sea=[[55.03,25]];
  return sea.map(point=>({lon:Number(point[0]),lat:Number(point[1])}));
}
/* Bangladesh ve India Gemi+Uçak: origin → Colombo deniz, Colombo → İstanbul
   hava. Bangladesh deniz ayağı saf deniz rotasıyla aynı koridor noktalarını
   kullanır; böylece ortak kısım tek hat olarak birleşir. */
const COLOMBO_SEA_AIR_ORIGINS=Object.freeze(['Bangladesh','India']);
function colomboSeaCoordinates(countryValue){
  const name=(countryCoordinate(countryValue)||{}).name;
  if(name==='Bangladesh')return dedupePoints([[91.82,22.35],[90,17],[88,15],[81,7],[COLOMBO.lon,COLOMBO.lat]]);
  if(name==='India')return dedupePoints([[78.15,8.78],[79.3,7.9],[COLOMBO.lon,COLOMBO.lat]]);
  return [];
}
function usesColomboTransit(countryValue,mode){
  if(mode!=='sea-air')return false;
  const origin=countryCoordinate(countryValue);return Boolean(origin&&COLOMBO_SEA_AIR_ORIGINS.includes(origin.name));
}
function pointKey(point){return Number(point.lon).toFixed(3)+','+Number(point.lat).toFixed(3);}
function routeLeg(mode,from,to,points){
  const pts=(points||[]).map(p=>({lon:Number(p.lon),lat:Number(p.lat)}));
  return {mode,from,to,points:pts,key:mode+':'+(pts.length?pointKey(pts[0])+'>'+pointKey(pts[pts.length-1]):'')+'#'+pts.length};
}
function routeLegsFor(countryValue,mode){
  const origin=countryCoordinate(countryValue);if(!origin||origin.name===ISTANBUL.name)return [];
  if(mode==='sea')return [routeLeg('sea',origin.name,ISTANBUL.name,seaRouteCoordinates(countryValue))];
  if(mode==='sea-air'){
    if(usesColomboTransit(countryValue,mode))return [routeLeg('sea',origin.name,COLOMBO.name,colomboSeaCoordinates(countryValue)),routeLeg('air',COLOMBO.name,ISTANBUL.name,[COLOMBO,ISTANBUL])];
    const sea=seaAirRouteCoordinates(countryValue),hub=sea[sea.length-1]||{lon:55.03,lat:25};
    return [routeLeg('sea',origin.name,'Dubai',sea),routeLeg('air','Dubai',ISTANBUL.name,[hub,ISTANBUL])];
  }
  return [routeLeg(mode||'unknown',origin.name,ISTANBUL.name,[origin,ISTANBUL])];
}
/* Kanonik segment grafı: iki rota yalnız AYNI iki ardışık koridor noktasını
   aynı yükleme tipiyle paylaşıyorsa aynı kenardır. Geometrik kesişme
   birleştirme nedeni değildir. */
function routeEdges(legs){
  const out=[];
  (legs||[]).forEach(leg=>{for(let i=1;i<leg.points.length;i++){const a=leg.points[i-1],b=leg.points[i];out.push({key:leg.mode+'|'+pointKey(a)+'>'+pointKey(b),mode:leg.mode,a,b,to:i===leg.points.length-1?leg.to:''});}});
  return out;
}
function xyz(point){
  const lat=Number(point.lat)*Math.PI/180,lon=Number(point.lon)*Math.PI/180;
  const c=Math.cos(lat);return {x:c*Math.sin(lon),y:Math.sin(lat),z:c*Math.cos(lon)};
}
function geoInterpolate(a,b,t){
  const av=xyz(a),bv=xyz(b);let dot=av.x*bv.x+av.y*bv.y+av.z*bv.z;dot=Math.max(-1,Math.min(1,dot));
  const omega=Math.acos(dot),sin=Math.sin(omega);
  let x,y,z;
  if(sin<1e-6){x=av.x+(bv.x-av.x)*t;y=av.y+(bv.y-av.y)*t;z=av.z+(bv.z-av.z)*t;}
  else {const aa=Math.sin((1-t)*omega)/sin,bb=Math.sin(t*omega)/sin;x=av.x*aa+bv.x*bb;y=av.y*aa+bv.y*bb;z=av.z*aa+bv.z*bb;}
  const lat=Math.atan2(y,Math.hypot(x,z))*180/Math.PI,lon=Math.atan2(x,z)*180/Math.PI;
  return {lat,lon};
}
function angularDistance(a,b){const av=xyz(a),bv=xyz(b);return Math.acos(Math.max(-1,Math.min(1,av.x*bv.x+av.y*bv.y+av.z*bv.z)));}
/* Kenar geometrisi statiktir: bir kez örneklenir ve anahtarla önbelleğe
   alınır. Kare başına yalnız projeksiyon yapılır. */
const EDGE_SAMPLE_CACHE=new Map();
function edgeSamples(edge){
  let samples=EDGE_SAMPLE_CACHE.get(edge.key);if(samples)return samples;
  const steps=edge.mode==='sea'?Math.max(2,Math.round(Math.hypot(edge.b.lon-edge.a.lon,edge.b.lat-edge.a.lat)/3)):edge.mode==='air'?24:12;
  samples=[];for(let i=0;i<=steps;i++){const t=i/steps,geo=geoInterpolate(edge.a,edge.b,t);samples.push({lon:geo.lon,lat:geo.lat,alt:edge.mode==='air'?Math.sin(Math.PI*t)*.065:0});}
  EDGE_SAMPLE_CACHE.set(edge.key,samples);return samples;
}
const LEG_PATH_CACHE=new Map();
function legPath(leg){
  let path=LEG_PATH_CACHE.get(leg.key);if(path)return path;
  const samples=[];routeEdges([leg]).forEach((edge,i)=>{const part=edgeSamples(edge);samples.push(...(i?part.slice(1):part));});
  const cum=[0];for(let i=1;i<samples.length;i++)cum.push(cum[i-1]+angularDistance(samples[i-1],samples[i]));
  path={samples,cum,total:cum[cum.length-1]||0};LEG_PATH_CACHE.set(leg.key,path);return path;
}
function pointAlongLeg(leg,progress){
  const path=legPath(leg),samples=path.samples;if(!samples.length)return null;
  if(samples.length===1||path.total<=0)return {...samples[0],ahead:samples[samples.length-1]};
  const target=Math.max(0,Math.min(1,Number(progress)||0))*path.total;
  for(let i=1;i<samples.length;i++){
    if(target<=path.cum[i]){
      const span=path.cum[i]-path.cum[i-1]||1,t=(target-path.cum[i-1])/span,geo=geoInterpolate(samples[i-1],samples[i],t);
      return {lon:geo.lon,lat:geo.lat,alt:samples[i-1].alt+(samples[i].alt-samples[i-1].alt)*t,ahead:samples[i],behind:samples[i-1]};
    }
  }
  const last=samples[samples.length-1],prev=samples[samples.length-2];
  return {...last,ahead:last,behind:prev};
}
/* Parsiyelin rota ayağı ve ayak içi ilerlemesi. Tek ayaklı rotada toplam
   ilerlemenin aynısıdır; Gemi+Uçak'ta toplam yol süresi deniz ayağı +
   SEA_AIR_AIR_LEG_DAYS hava ayağı olarak bölünür. */
function transitPlacement(rec,rules,now){
  const legs=routeLegsFor(rec&&rec.country,rec&&rec.mode);if(!legs.length)return null;
  const meta=recordRouteProgress(rec,rules,now);let legIndex=0,legProgress=meta.progress;
  if(legs.length>1&&meta.known){
    const airDays=Math.min(SEA_AIR_AIR_LEG_DAYS,meta.leadDays/2),seaDays=Math.max(.5,meta.leadDays-airDays);
    if(meta.elapsedDays<seaDays)legProgress=meta.elapsedDays/seaDays;
    else {legIndex=1;legProgress=Math.min(1,(meta.elapsedDays-seaDays)/Math.max(.5,airDays));}
  }
  return {rec,legs,legIndex,leg:legs[legIndex],legProgress:Math.max(0,Math.min(1,legProgress)),meta};
}
function makeVehicle(leg,items,vessel){
  const records=items.map(p=>p.rec),mean=list=>list.length?list.reduce((a,b)=>a+b,0)/list.length:null;
  const progress=mean(items.map(p=>p.legProgress))||0,elapsed=items.map(p=>p.meta.elapsedDays).filter(v=>v!=null);
  const first=[...items].sort((a,b)=>a.rec.id<b.rec.id?-1:a.rec.id>b.rec.id?1:0)[0];
  return {
    id:'veh:'+leg.key+'|'+(vessel?'v:'+vessel.key:'p:'+first.rec.id),leg,legKey:leg.key,mode:leg.mode,
    vesselName:vessel?vessel.name:'',vesselKey:vessel?vessel.key:'',progress,geo:pointAlongLeg(leg,progress),records,
    qty:records.reduce((sum,r)=>sum+(Number(r.qty)||0),0),elapsedDays:elapsed.length?mean(elapsed):null,
    leadDays:mean(items.map(p=>p.meta.leadDays)),known:items.some(p=>p.meta.known),
    origins:[...new Set(records.map(r=>r.origin&&r.origin.name).filter(Boolean))],
    files:[...new Set(records.map(r=>r.shipmentFile||r.orderCode).filter(Boolean))],
    critical:records.some(r=>r.critical)
  };
}
/* Araç gruplama: aynı rota ayağı + aynı normalize Gemi Ad → tek gemi. Gemi
   adı yalnız deniz ayağında anlamlıdır; hava ayağında ve Gemi Ad boş
   parsiyellerde ilerlemesi PROGRESS_BUCKET içinde kalanlar kümelenir. */
function groupTransitPlacements(placements,bucket){
  const window=Number(bucket)>0?Number(bucket):PROGRESS_BUCKET,byLeg=new Map(),out=[];
  (placements||[]).forEach(p=>{if(!byLeg.has(p.leg.key))byLeg.set(p.leg.key,[]);byLeg.get(p.leg.key).push(p);});
  byLeg.forEach(list=>{
    const leg=list[0].leg,vessels=new Map(),loose=[];
    list.forEach(p=>{const key=leg.mode==='sea'?p.rec.vesselKey:'';if(key){if(!vessels.has(key))vessels.set(key,[]);vessels.get(key).push(p);}else loose.push(p);});
    [...vessels.keys()].sort().forEach(key=>{const items=vessels.get(key);out.push(makeVehicle(leg,items,{key,name:items[0].rec.vesselName}));});
    loose.sort((a,b)=>a.legProgress-b.legProgress||(a.rec.id<b.rec.id?-1:a.rec.id>b.rec.id?1:0));
    const buckets=[];let current=null;
    loose.forEach(p=>{if(!current||p.legProgress-current.start>window){current={start:p.legProgress,items:[]};buckets.push(current);}current.items.push(p);});
    buckets.forEach(b=>out.push(makeVehicle(leg,b.items,null)));
  });
  return out.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
const ARRIVAL_STAGES=Object.freeze(['AWAITING_RETAIL_TRANSFER','CUSTOMS','IN_WAREHOUSE']);
const ORIGIN_STAGES=Object.freeze(['PRODUCTION','LOADING']);
function buildFlowModel(records,options){
  const opts=options||{},rules=opts.rules||[],now=opts.now==null?Date.now():opts.now;
  const origins=new Map(),arrival={key:'arrival:istanbul',kind:'arrival',location:ISTANBUL,records:[],stages:new Map()},placements=[],unplaced=[];
  (records||[]).forEach(rec=>{
    const stage=rec.operationalStage||operationalStage(rec.status);
    if(rec.state==='arrived'){arrival.records.push(rec);if(ARRIVAL_STAGES.includes(stage)){if(!arrival.stages.has(stage))arrival.stages.set(stage,[]);arrival.stages.get(stage).push(rec);}return;}
    if(rec.state==='transit'){const placement=rec.origin?transitPlacement(rec,rules,now):null;if(placement)placements.push(placement);else unplaced.push(rec);return;}
    if(!rec.origin){unplaced.push(rec);return;}
    const key='origin:'+rec.origin.name;if(!origins.has(key))origins.set(key,{key,kind:'origin',location:rec.origin,records:[],stages:new Map()});
    const bundle=origins.get(key);bundle.records.push(rec);if(ORIGIN_STAGES.includes(stage)){if(!bundle.stages.has(stage))bundle.stages.set(stage,[]);bundle.stages.get(stage).push(rec);}
  });
  const edges=new Map();
  placements.forEach(p=>routeEdges(p.legs).forEach(edge=>{
    if(!edges.has(edge.key))edges.set(edge.key,{...edge,records:[],qty:0,origins:new Set(),destinations:new Set()});
    const agg=edges.get(edge.key);agg.records.push(p.rec);agg.qty+=Number(p.rec.qty)||0;agg.origins.add(p.rec.origin.name);agg.destinations.add(p.legs[p.legs.length-1].to);
  }));
  const nodes=[...origins.values()].sort((a,b)=>a.key<b.key?-1:1);if(arrival.records.length)nodes.push(arrival);
  const placementById=new Map(placements.map(p=>[p.rec.id,p]));
  return {nodes,edges:[...edges.values()],vehicles:groupTransitPlacements(placements),placementById,unplaced};
}
/* Aynı noktaya düşen semboller birleşmez; çakışma kümesi sembolleri kümenin
   merkezi etrafında halkalara açılır ve her biri kendi tıklama hedefini
   korur. Sıra kimliğe göre deterministiktir. */
function resolveSymbolCollisions(symbols,minDistance){
  const list=Array.isArray(symbols)?symbols:[],min=Number(minDistance)>0?Number(minDistance):SYMBOL_MIN_DISTANCE,n=list.length,parent=list.map((_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const grid=new Map(),cell=(x,y)=>Math.floor(x/min)+':'+Math.floor(y/min);
  list.forEach((s,i)=>{s.anchorX=s.x;s.anchorY=s.y;s.displaced=false;const key=cell(s.x,s.y);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);});
  list.forEach((s,i)=>{
    const cx=Math.floor(s.x/min),cy=Math.floor(s.y/min);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)(grid.get((cx+dx)+':'+(cy+dy))||[]).forEach(j=>{if(j<=i)return;const o=list[j];if(Math.hypot(s.x-o.x,s.y-o.y)<min){const a=find(i),b=find(j);if(a!==b)parent[b]=a;}});
  });
  const clusters=new Map();for(let i=0;i<n;i++){const r=find(i);if(!clusters.has(r))clusters.set(r,[]);clusters.get(r).push(list[i]);}
  clusters.forEach(members=>{
    if(members.length<2)return;
    members.sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
    const cx=members.reduce((s,m)=>s+m.anchorX,0)/members.length,cy=members.reduce((s,m)=>s+m.anchorY,0)/members.length,k=members.length;
    if(k<=6){
      const radius=min/(2*Math.sin(Math.PI/k));
      members.forEach((m,i)=>{const a=-Math.PI/2+2*Math.PI*i/k;m.x=cx+Math.cos(a)*radius;m.y=cy+Math.sin(a)*radius;m.displaced=true;});
      return;
    }
    let index=0,ring=1;
    while(index<k){
      const radius=min*ring,capacity=Math.max(1,Math.floor(2*Math.PI*ring)),count=Math.min(capacity,k-index);
      for(let i=0;i<count;i++,index++){const a=-Math.PI/2+2*Math.PI*i/count,m=members[index];m.x=cx+Math.cos(a)*radius;m.y=cy+Math.sin(a)*radius;m.displaced=true;}
      ring++;
    }
  });
  return list;
}
function pickHit(targets,x,y){
  let best=null,bestPriority=-Infinity,bestDistance=Infinity;
  (targets||[]).forEach(hit=>{
    const distance=hit.type==='route'?distanceToPolyline(x,y,hit.points):Math.hypot((hit.x||0)-x,(hit.y||0)-y);if(distance>Number(hit.r||10))return;
    const priority=Number(hit.priority)||0;if(priority>bestPriority||(priority===bestPriority&&distance<bestDistance)){best=hit;bestPriority=priority;bestDistance=distance;}
  });
  return best;
}

/* Hızlı filtreler. Varsayılan set: Üretimde, Sevke hazır, Yolda, Kritik.
   Depo/İstanbul (Warehouse) varsayılandan çıktı ama katalogda kalır;
   kullanıcı ekleyip çıkarabilir ve sırayı değiştirebilir. Seçim kuralı
   deterministiktir: aynı gruptaki seçimler VEYA, gruplar arası VE. */
const QUICK_FILTERS=Object.freeze({
  'phase:production':{group:'phase',tone:'production',tr:'Üretimde',en:'In production',test:r=>r.state==='production'},
  'phase:ready':{group:'phase',tone:'ready',tr:'Sevke hazır',en:'Ready to ship',test:r=>r.state==='ready'},
  'phase:transit':{group:'phase',tone:'transit',tr:'Yolda',en:'In transit',test:r=>r.state==='transit'},
  'phase:arrived':{group:'phase',tone:'arrived',tr:'İstanbul / depo',en:'Istanbul / warehouse',test:r=>r.state==='arrived'},
  'stage:CUSTOMS':{group:'phase',tone:'customs',tr:'Gümrük',en:'Customs',test:r=>r.operationalStage==='CUSTOMS'},
  'stage:IN_WAREHOUSE':{group:'phase',tone:'arrived',tr:'Depoda',en:'In warehouse',test:r=>r.operationalStage==='IN_WAREHOUSE'},
  'stage:AWAITING_RETAIL_TRANSFER':{group:'phase',tone:'retail',tr:'Retail aktarım bekliyor',en:'Awaiting retail transfer',test:r=>r.operationalStage==='AWAITING_RETAIL_TRANSFER'},
  'critical':{group:'critical',tone:'critical',tr:'Kritik',en:'Critical',test:r=>Boolean(r.critical)},
  'mode:sea':{group:'mode',tone:'sea',tr:'Gemi',en:'Sea',test:r=>r.mode==='sea'},
  'mode:air':{group:'mode',tone:'air',tr:'Uçak',en:'Air',test:r=>r.mode==='air'},
  'mode:sea-air':{group:'mode',tone:'seaair',tr:'Gemi + Uçak',en:'Sea + Air',test:r=>r.mode==='sea-air'},
  'mode:road':{group:'mode',tone:'road',tr:'Tır',en:'Road',test:r=>r.mode==='road'}
});
const DEFAULT_QUICK_FILTERS=Object.freeze(['phase:production','phase:ready','phase:transit','critical']);
function normalizeQuickFilterItems(items){
  const out=[];(Array.isArray(items)?items:[]).forEach(id=>{const key=String(id||'');if(QUICK_FILTERS[key]&&!out.includes(key))out.push(key);});
  return out;
}
function quickFilterMatch(rec,activeIds){
  const groups=new Map();
  normalizeQuickFilterItems(activeIds).forEach(id=>{const def=QUICK_FILTERS[id];if(!groups.has(def.group))groups.set(def.group,[]);groups.get(def.group).push(def);});
  for(const defs of groups.values())if(!defs.some(def=>def.test(rec)))return false;
  return true;
}
function emptyFilters(){const out={search:''};FILTER_KEYS.forEach(key=>{out[key]=[];});return out;}
function normalizeFilters(raw){
  const out=emptyFilters();if(!raw||typeof raw!=='object')return out;
  out.search=typeof raw.search==='string'?raw.search:'';
  FILTER_KEYS.forEach(key=>{
    const value=raw[key],list=Array.isArray(value)?value:(typeof value==='string'&&value?[value]:[]);
    out[key]=[...new Set(list.map(clean).filter(Boolean))];
  });
  return out;
}
/* Panel filtreleri: aynı alan içindeki çoklu seçimler VEYA, alanlar arası VE. */
function createPanelFilter(filters){
  const f=normalizeFilters(filters),search=norm(f.search),sets=FILTER_KEYS.filter(key=>f[key].length).map(key=>[key,new Set(f[key])]);
  return rec=>{
    if(search){const hay=norm([rec.orderCode,rec.model,rec.colourCode,rec.buyer,rec.manufacturer,rec.status,rec.country,rec.shipmentFile,rec.containerNo,rec.vesselName].join(' '));if(!hay.includes(search))return false;}
    for(const [key,set] of sets)if(!set.has(clean(rec[key])))return false;
    return true;
  };
}

if(typeof document==='undefined'){
  return {ISTANBUL,COLOMBO,FIELD_CANDIDATES,QUICK_FILTERS,DEFAULT_QUICK_FILTERS,SEA_AIR_AIR_LEG_DAYS,PROGRESS_BUCKET,SYMBOL_MIN_DISTANCE,
    clean,norm,toNumber,pick,createFieldResolver,countryCoordinate,detectMode,operationalStage,classifyState,actionPriorityCode,
    normalizeRecord,expandSourceRow,shipmentPartialsFromRows,partialIdentity,recordKey,dedupeRecords,aggregateRecords,uniqueValues,
    parseDateMs,resolveRecordTransitDays,recordRouteProgress,distancePointToSegment,distanceToPolyline,decodeWorldTopology,
    seaRouteCoordinates,seaAirRouteCoordinates,colomboSeaCoordinates,usesColomboTransit,routeLegsFor,routeEdges,pointAlongLeg,
    transitPlacement,groupTransitPlacements,buildFlowModel,resolveSymbolCollisions,pickHit,
    normalizeQuickFilterItems,quickFilterMatch,normalizeFilters,createPanelFilter};
}

const $=id=>document.getElementById(id);
const isEn=()=>String(document.documentElement.lang||'tr').toLowerCase().startsWith('en');
const L=(tr,en)=>isEn()?en:tr;
const esc=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let numberFormat=null,numberFormatLang='';
const nf=()=>{const lang=isEn()?'en-GB':'tr-TR';if(!numberFormat||numberFormatLang!==lang){numberFormat=new Intl.NumberFormat(lang,{maximumFractionDigits:0});numberFormatLang=lang;}return numberFormat;};
const reducedMotion=()=>{try{return window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_){return false;}};
const state={
  source:'backlog',view:'2d',records:[],panelFiltered:[],filtered:[],model:null,modelRevision:0,loading:false,error:'',warning:'',
  filters:emptyFilters(),quick:{items:DEFAULT_QUICK_FILTERS.slice(),active:[]},quickEditorOpen:false,
  measure:'qty',collapsed:false,fullscreen:false,filterOpen:false,
  panX:0,panY:0,zoom2d:1,rotLon:18,rotLat:-12,zoom3d:1,drag:null,hover:null,
  frame:0,lastFrame:0,observers:[],inView:true,dirty:false,refreshTimer:0,savePrefsTimer:0,searchTimer:0,
  worldPolygons:[],worldLoading:true,worldError:'',worldRevision:0,transitRules:[],transitRulesLoaded:false,
  expandedNodeKey:'',lastDragMoved:false,orbHandle:null,paletteCache:null,paletteRevision:0,
  base:null,scene:null,sourceCache:new Map(),sourceIncomplete:false,lastBacklogRows:null,lastBacklogSignature:'',refreshSeq:0
};

function prefStore(){return window.BLStorage||localStorage;}
function loadPrefs(){
  try{
    const store=prefStore();let text=store.getItem(STORAGE_KEY);
    // v1 tercihleri kullanıcıya bağlı depoya taşınmadan önce ham localStorage'daydı.
    if(text==null&&store!==localStorage){try{text=localStorage.getItem(STORAGE_KEY);}catch(_){}}
    const raw=JSON.parse(text||'{}')||{};
    if(['cp','orders','backlog','combined'].includes(raw.source))state.source=raw.source;
    if(raw.view==='2d'||raw.view==='3d')state.view=raw.view;
    if(['qty','orders','partials'].includes(raw.measure))state.measure=raw.measure;
    state.filters=normalizeFilters(raw.filters);
    const items=raw.quick&&Array.isArray(raw.quick.items)?normalizeQuickFilterItems(raw.quick.items):DEFAULT_QUICK_FILTERS.slice();
    let active=raw.quick&&Array.isArray(raw.quick.active)?normalizeQuickFilterItems(raw.quick.active):[];
    // Eski tekli seçimler (phaseFilter / riskOnly / transitOnly) yeni çoklu hızlı filtreye taşınır.
    if(!raw.quick){
      if(['production','ready','transit','arrived'].includes(raw.phaseFilter))active.push('phase:'+raw.phaseFilter);
      if(raw.transitOnly&&!active.includes('phase:transit'))active.push('phase:transit');
      if(raw.riskOnly)active.push('critical');
    }
    state.quick={items,active:active.filter(id=>items.includes(id))};
    state.collapsed=Boolean(raw.collapsed);
  }catch(_){}
}
function writePrefs(){
  state.savePrefsTimer=0;
  try{prefStore().setItem(STORAGE_KEY,JSON.stringify({
    source:state.source,view:state.view,measure:state.measure,filters:state.filters,quick:state.quick,collapsed:state.collapsed
  }));}catch(_){}
}
// Arama gibi hızlı değişen durumlarda depo her tuşta serileştirilmez.
function savePrefs(){if(state.savePrefsTimer)clearTimeout(state.savePrefsTimer);state.savePrefsTimer=setTimeout(writePrefs,250);}
function flushPrefs(){if(state.savePrefsTimer){clearTimeout(state.savePrefsTimer);writePrefs();}}

/* Kaynak verisi. CP ve Orders haritası ekrandaki grid'in görünür satırlarından
   veya son sayfa filtresinden DEĞİL, ilgili kaynağın bütün veri kümesinden
   gelir (app-main.js → BLGlobalFlowDataProviders). Yalnız haritanın kendi
   filtreleri veriyi daraltır. Parsiyel genişletmesi satır dizisi + veri
   revizyonu aynı kaldıkça yeniden yapılmaz. */
function providers(){return window.BLGlobalFlowDataProviders||null;}
async function providedPartials(source,force){
  const api=providers();if(!api||typeof api[source]!=='function')return [];
  const rows=await api[source]({force:Boolean(force)}),revision=typeof api.revision==='function'?api.revision(source):0;
  const cached=state.sourceCache.get(source);
  if(cached&&cached.rows===rows&&cached.revision===revision)return cached.records;
  const records=shipmentPartialsFromRows(rows,source);
  state.sourceCache.set(source,{rows,revision,records});
  return records;
}
function backlogSignature(){
  try{return typeof backlogExportQueryParams==='function'?JSON.stringify(backlogExportQueryParams()):'';}catch(_){return '';}
}
async function ensureDecisionEngine(){
  if(window.BLBacklogDeliveryEngine)return true;
  try{await window.BLPerf?.ensureFeature?.('cpAssistant');}catch(_){}
  return Boolean(window.BLBacklogDeliveryEngine);
}
async function backlogPartials(force){
  const signature=backlogSignature();
  if(!force&&state.lastBacklogRows&&signature===state.lastBacklogSignature)return state.lastBacklogRows;
  if(typeof backlogExportQueryParams!=='function')return [];
  const params=backlogExportQueryParams()||{};
  const [response]=await Promise.all([fetch('/api/backlog-export?'+new URLSearchParams(params).toString(),{credentials:'same-origin',cache:'no-store'}),ensureDecisionEngine()]);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data&&data.error?data.error:'HTTP '+response.status);
  const records=shipmentPartialsFromRows(Array.isArray(data.rows)?data.rows:[],'backlog');
  state.lastBacklogRows=records;state.lastBacklogSignature=signature;return records;
}
async function sourceRecords(source,force){
  state.sourceIncomplete=false;
  if(source==='cp'||source==='orders')return providedPartials(source,force);
  if(source==='backlog')return backlogPartials(force);
  // Bir kaynak başarısız olursa harita kalanlarla çizilir ama kayıtlı filtreler budanmaz.
  const soft=promise=>promise.catch(()=>{state.sourceIncomplete=true;return [];});
  const parts=await Promise.all([soft(providedPartials('cp',force)),soft(providedPartials('orders',force)),soft(backlogPartials(force))]);
  return dedupeRecords(parts.flat());
}
async function loadWorldTopology(){
  if(state.worldPolygons.length){state.worldLoading=false;return state.worldPolygons;}
  state.worldLoading=true;syncLoadingOverlay();
  try{
    const response=await fetch('vendor/world-atlas-countries-110m.json',{cache:'force-cache'});if(!response.ok)throw new Error('HTTP '+response.status);
    const topology=await response.json();state.worldPolygons=decodeWorldTopology(topology);if(!state.worldPolygons.length)throw new Error('World topology is empty');state.worldError='';
  }catch(error){state.worldError=String(error&&error.message||error);}
  finally{state.worldLoading=false;state.worldRevision++;syncLoadingOverlay();scheduleDraw();}
  return state.worldPolygons;
}
async function loadTransitRules(force){
  if(state.transitRulesLoaded&&!force)return state.transitRules;
  try{
    const response=await fetch('/api/transit-rules',{credentials:'same-origin',cache:force?'no-store':'default'}),data=await response.json().catch(()=>({}));
    if(response.ok&&Array.isArray(data.rules)){state.transitRules=data.rules;state.transitRulesLoaded=true;}
  }catch(_){}
  return state.transitRules;
}
function isLive(){return !document.hidden&&!state.collapsed&&state.inView;}
async function refresh(force){
  // Daraltılmış veya görünmeyen harita veri çekmez; görünür olduğunda bir kez tazelenir.
  if(!force&&!isLive()){state.dirty=true;return;}
  state.dirty=false;const seq=++state.refreshSeq;
  state.loading=true;state.error='';state.warning='';renderMeta();syncLoadingOverlay();
  try{
    const results=await Promise.all([sourceRecords(state.source,Boolean(force)),loadTransitRules(Boolean(force)),loadWorldTopology()]);
    if(seq!==state.refreshSeq)return;
    state.records=results[0];hydrateFilterValidity();
    const unknown=state.records.filter(r=>!r.origin&&r.state!=='arrived').length;
    if(unknown)state.warning=L(unknown+' parsiyelde üretim ülkesi haritada eşleşmedi.',unknown+' partials have an origin country that could not be mapped.');
    if(state.worldError)state.warning=(state.warning?state.warning+' · ':'')+L('Detaylı dünya sınırı yüklenemedi; yedek harita kullanılıyor.','Detailed world outline could not be loaded; fallback map is in use.');
    if(!state.records.length)state.warning=L('Seçili kaynakta haritada gösterilebilir parsiyel yok. Kaynak verisinin yüklenmiş olduğundan emin olun.','No mappable partials are available in the selected source. Make sure the source data has loaded.');
    applyFilters();
  }catch(error){if(seq!==state.refreshSeq)return;state.records=[];state.panelFiltered=[];state.filtered=[];state.model=null;state.modelRevision++;state.error=String(error&&error.message||error);}
  finally{if(seq===state.refreshSeq){state.loading=false;renderControls();renderKpis();renderMeta();syncLoadingOverlay();scheduleDraw();}}
}
function scheduleRefresh(delay){
  if(state.refreshTimer)clearTimeout(state.refreshTimer);
  state.refreshTimer=setTimeout(()=>{state.refreshTimer=0;void refresh(false);},delay==null?180:delay);
}
function hydrateFilterValidity(){
  // Kaynak henüz boşken veya birleşik kaynağın bir parçası alınamadıysa kalıcı seçimler silinmez.
  if(!state.records.length||state.sourceIncomplete)return;
  let changed=false;
  FILTER_KEYS.forEach(key=>{
    if(!state.filters[key].length)return;const available=new Set(uniqueValues(state.records,key)),next=state.filters[key].filter(value=>available.has(value));
    if(next.length!==state.filters[key].length){state.filters[key]=next;changed=true;}
  });
  if(changed)savePrefs();
}
function applyFilters(renderPanel=true){
  const panel=createPanelFilter(state.filters);
  state.panelFiltered=state.records.filter(panel);
  state.filtered=state.quick.active.length?state.panelFiltered.filter(rec=>quickFilterMatch(rec,state.quick.active)):state.panelFiltered;
  state.model=buildFlowModel(state.filtered,{rules:state.transitRules,now:Date.now()});state.modelRevision++;state.scene=null;
  if(state.hover&&state.hover.type!=='route')state.hover=null;
  if(renderPanel!==false)renderFilters();else updateFilterSummaries();
  renderControls();renderKpis();renderMeta();scheduleDraw();
}
function sourceLabel(source){return ({cp:'CP',orders:'Orders',backlog:'Backlog',combined:L('Birleşik','Combined')})[source]||source;}
function stateLabel(value){return ({
  production:L('Üretimde','In production'),ready:L('Sevke hazır','Ready to ship'),transit:L('Yolda','In transit'),arrived:L('İstanbul / depo','Istanbul / warehouse')
})[value]||value;}
function modeLabel(value){return ({
  sea:L('Gemi','Sea'),air:L('Uçak','Air'),road:L('Tır','Road'), 'sea-air':L('Gemi + Uçak','Sea + Air'),unknown:L('Belirsiz','Unknown')
})[value]||value;}
function quickLabel(id){const def=QUICK_FILTERS[id];return def?(isEn()?def.en:def.tr):id;}
function renderControls(){
  const host=$('globalFlowControls');if(!host)return;
  const active=activeFilterCount();
  host.innerHTML=
    '<label class="gfCompactField"><span>'+esc(L('Kaynak','Source'))+'</span><select id="globalFlowSource">'+
    [['backlog','Backlog'],['orders','Orders'],['cp','CP'],['combined',L('Birleşik','Combined')]].map(x=>'<option value="'+x[0]+'"'+(state.source===x[0]?' selected':'')+'>'+esc(x[1])+'</option>').join('')+
    '</select></label>'+
    '<div class="gfSegment" role="group" aria-label="'+esc(L('Harita görünümü','Map view'))+'"><button type="button" data-gf-view="2d" class="'+(state.view==='2d'?'active':'')+'">2D</button><button type="button" data-gf-view="3d" class="'+(state.view==='3d'?'active':'')+'">3D</button></div>'+
    '<label class="gfCompactField"><span>'+esc(L('Ölçü','Measure'))+'</span><select id="globalFlowMeasure"><option value="qty"'+(state.measure==='qty'?' selected':'')+'>'+esc(L('Adet','Units'))+'</option><option value="orders"'+(state.measure==='orders'?' selected':'')+'>'+esc(L('Sipariş','Orders'))+'</option><option value="partials"'+(state.measure==='partials'?' selected':'')+'>'+esc(L('Parsiyel','Partials'))+'</option></select></label>'+
    '<button type="button" class="tbtn gfIconBtn'+(active?' hasActive':'')+'" id="globalFlowFilterBtn" aria-expanded="'+(state.filterOpen?'true':'false')+'" title="'+esc(L('Harita filtreleri','Map filters'))+'"><svg class="ic"><use href="#i-filter"/></svg><span>'+esc(L('Filtre','Filter'))+(active?' · '+active:'')+'</span></button>'+
    '<button type="button" class="tbtn gfIconBtn" id="globalFlowRefreshBtn" title="'+esc(L('Harita verisini yenile','Refresh map data'))+'"><svg class="ic"><use href="#i-refresh"/></svg></button>'+
    '<button type="button" class="tbtn gfIconBtn" id="globalFlowResetViewBtn" title="'+esc(L('Harita konumunu sıfırla','Reset map position'))+'"><svg class="ic"><use href="#i-globe"/></svg></button>'+
    '<button type="button" class="tbtn gfIconBtn" id="globalFlowFullscreenBtn" title="'+esc(state.fullscreen?L('Tam ekrandan çık','Exit fullscreen'):L('Tam ekran','Fullscreen'))+'">'+(state.fullscreen?'↙':'↗')+'</button>';
}
// Kontrol olayları bir kez, kalıcı kap üzerinde delege edilir (her çizimde yeniden bağlanmaz).
function bindControls(){
  const host=$('globalFlowControls');if(!host||host.dataset.gfBound)return;host.dataset.gfBound='1';
  host.addEventListener('change',event=>{
    const target=event.target;
    if(target.id==='globalFlowSource'){state.source=target.value;savePrefs();void refresh(false);}
    else if(target.id==='globalFlowMeasure'){state.measure=target.value;savePrefs();renderKpis();renderMeta();}
  });
  host.addEventListener('click',event=>{
    const view=event.target.closest('[data-gf-view]');
    if(view){state.view=view.dataset.gfView;state.drag=null;state.scene=null;savePrefs();renderControls();scheduleDraw();return;}
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='globalFlowFilterBtn'){state.filterOpen=!state.filterOpen;renderFilters();renderControls();}
    else if(button.id==='globalFlowRefreshBtn')void refresh(true);
    else if(button.id==='globalFlowResetViewBtn')resetView();
    else if(button.id==='globalFlowFullscreenBtn')toggleFullscreen();
  });
}
function activeFilterCount(){
  return (clean(state.filters.search)?1:0)+FILTER_KEYS.reduce((n,key)=>n+(state.filters[key].length?1:0),0)+state.quick.active.length;
}
function filterSummary(key){
  const values=state.filters[key]||[];if(!values.length)return L('Tümü','All');
  const label=v=>key==='mode'?modeLabel(v):v;
  return values.length===1?label(values[0]):values.length+' '+L('seçili','selected');
}
function filterOptions(key,label){
  const values=uniqueValues(state.records,key),selected=new Set(state.filters[key]);
  state.filters[key].forEach(value=>{if(!values.includes(value))values.push(value);});
  const search=values.length>8?'<input type="search" class="gfMultiSearch" data-gf-multi-search placeholder="'+esc(L('Ara…','Search…'))+'">':'';
  return '<div class="gfFilterField"><span>'+esc(label)+'</span><details class="gfMulti'+(selected.size?' hasValue':'')+'" data-gf-multi="'+esc(key)+'"><summary><b data-gf-multi-summary>'+esc(filterSummary(key))+'</b></summary>'+
    '<div class="gfMultiPanel">'+search+'<div class="gfMultiList">'+(values.length?values.map(value=>'<label><input type="checkbox" value="'+esc(value)+'"'+(selected.has(value)?' checked':'')+'><span>'+esc(key==='mode'?modeLabel(value):value)+'</span></label>').join(''):'<small>'+esc(L('Değer yok','No values'))+'</small>')+'</div>'+
    '<button type="button" class="gfMultiClear" data-gf-multi-clear>'+esc(L('Temizle','Clear'))+'</button></div></details></div>';
}
function renderFilters(){
  const panel=$('globalFlowFilters');if(!panel)return;
  panel.hidden=!state.filterOpen;
  if(!state.filterOpen)return;
  panel.innerHTML=
    '<label class="gfFilterField gfFilterSearch"><span>'+esc(L('Ara','Search'))+'</span><input type="search" data-gf-search value="'+esc(state.filters.search)+'" placeholder="'+esc(L('Sipariş, model, dosya, gemi…','Order, model, file, vessel…'))+'"></label>'+
    filterOptions('season',L('Sezon','Season'))+filterOptions('mag','MAG')+filterOptions('mmyg','MMYG')+filterOptions('buyer','Buyer')+
    filterOptions('buyingGroup','Buyer Group')+filterOptions('manufacturer',L('Üretici','Supplier'))+
    filterOptions('country',L('Ülke','Country'))+filterOptions('line','Line')+filterOptions('category',L('Kategori','Category'))+filterOptions('license',L('Lisans','License'))+
    filterOptions('mode',L('Taşıma','Transport'))+filterOptions('status',L('Statü','Status'))+
    '<button type="button" class="tbtn" data-gf-clear>'+esc(L('Filtreleri temizle','Clear filters'))+'</button>';
}
function updateFilterSummaries(){
  const panel=$('globalFlowFilters');if(!panel||panel.hidden)return;
  panel.querySelectorAll('[data-gf-multi]').forEach(details=>{
    const key=details.dataset.gfMulti,summary=details.querySelector('[data-gf-multi-summary]');
    if(summary)summary.textContent=filterSummary(key);details.classList.toggle('hasValue',Boolean(state.filters[key]&&state.filters[key].length));
  });
}
function bindFilters(){
  const panel=$('globalFlowFilters');if(!panel||panel.dataset.gfBound)return;panel.dataset.gfBound='1';
  panel.addEventListener('input',event=>{
    const target=event.target;
    if(target.matches('[data-gf-search]')){
      state.filters.search=target.value;savePrefs();
      if(state.searchTimer)clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{state.searchTimer=0;applyFilters(false);},160);
    }else if(target.matches('[data-gf-multi-search]')){
      const q=norm(target.value);target.closest('.gfMultiPanel').querySelectorAll('.gfMultiList label').forEach(label=>{label.hidden=Boolean(q)&&!norm(label.textContent).includes(q);});
    }
  });
  panel.addEventListener('change',event=>{
    const input=event.target;if(!input.matches('.gfMultiList input[type="checkbox"]'))return;
    const details=input.closest('[data-gf-multi]'),key=details&&details.dataset.gfMulti;if(!key)return;
    // Seçim sırası seçenek sırasıyla aynı tutulur; kalıcı durum deterministiktir.
    state.filters[key]=[...details.querySelectorAll('.gfMultiList input[type="checkbox"]:checked')].map(x=>x.value);
    savePrefs();applyFilters(false);
  });
  panel.addEventListener('click',event=>{
    const clear=event.target.closest('[data-gf-multi-clear]');
    if(clear){const details=clear.closest('[data-gf-multi]');state.filters[details.dataset.gfMulti]=[];details.querySelectorAll('.gfMultiList input').forEach(x=>{x.checked=false;});savePrefs();applyFilters(false);return;}
    if(event.target.closest('[data-gf-clear]')){state.filters=emptyFilters();state.quick.active=[];savePrefs();applyFilters();}
  });
  // Bir çoklu seçim açıldığında diğerleri kapanır.
  panel.addEventListener('toggle',event=>{const d=event.target;if(d.matches&&d.matches('details.gfMulti')&&d.open)panel.querySelectorAll('details.gfMulti[open]').forEach(other=>{if(other!==d)other.open=false;});},true);
}
function measureOf(records){
  if(state.measure==='partials')return records.length;
  if(state.measure==='orders'){const set=new Set();records.forEach(r=>set.add(r.orderKey||r.id));return set.size;}
  return records.reduce((sum,r)=>sum+(Number(r.qty)||0),0);
}
function renderKpis(){
  const host=$('globalFlowKpis');if(!host)return;
  // Çip sayıları hızlı filtre seçimi hariç tutularak hesaplanır: bir çip
  // seçildiğinde diğerleri sıfırlanıp kaybolmaz.
  const base=state.panelFiltered,active=new Set(state.quick.active);
  const chips=state.quick.items.map(id=>{
    const def=QUICK_FILTERS[id],value=measureOf(base.filter(def.test));
    return '<button type="button" class="gfKpi gfKpi--'+esc(def.tone)+(active.has(id)?' active':'')+'" data-gf-quick="'+esc(id)+'" aria-pressed="'+(active.has(id)?'true':'false')+'"><span>'+esc(quickLabel(id))+'</span><b>'+esc(nf().format(value||0))+'</b></button>';
  }).join('');
  host.innerHTML='<button type="button" class="gfKpiEdit" data-gf-quick-edit aria-expanded="'+(state.quickEditorOpen?'true':'false')+'" title="'+esc(L('Hızlı filtreleri düzenle','Edit quick filters'))+'" aria-label="'+esc(L('Hızlı filtreleri düzenle','Edit quick filters'))+'"><svg class="ic"><use href="#i-settings"/></svg></button>'+chips+
    (state.quickEditorOpen?quickEditorHtml():'');
}
function quickEditorHtml(){
  const visible=state.quick.items,hidden=Object.keys(QUICK_FILTERS).filter(id=>!visible.includes(id));
  const row=(id,index,shown)=>'<li data-gf-quick-item="'+esc(id)+'"><label><input type="checkbox" data-gf-quick-toggle'+(shown?' checked':'')+'><span>'+esc(quickLabel(id))+'</span></label>'+
    (shown?'<span class="gfQuickMove"><button type="button" data-gf-quick-move="-1"'+(index===0?' disabled':'')+' aria-label="'+esc(L('Yukarı taşı','Move up'))+'">↑</button><button type="button" data-gf-quick-move="1"'+(index===visible.length-1?' disabled':'')+' aria-label="'+esc(L('Aşağı taşı','Move down'))+'">↓</button></span>':'')+'</li>';
  return '<div class="gfQuickEditor" role="dialog" aria-label="'+esc(L('Hızlı filtreler','Quick filters'))+'"><div class="gfQuickEditorHead"><b>'+esc(L('Hızlı filtreler','Quick filters'))+'</b><button type="button" data-gf-quick-reset>'+esc(L('Varsayılana dön','Reset to default'))+'</button></div>'+
    '<ul>'+visible.map((id,i)=>row(id,i,true)).join('')+hidden.map((id,i)=>row(id,i,false)).join('')+'</ul></div>';
}
function bindKpis(){
  const host=$('globalFlowKpis');if(!host||host.dataset.gfBound)return;host.dataset.gfBound='1';
  const commit=()=>{state.quick.active=state.quick.active.filter(id=>state.quick.items.includes(id));savePrefs();applyFilters(false);};
  host.addEventListener('click',event=>{
    if(event.target.closest('[data-gf-quick-edit]')){state.quickEditorOpen=!state.quickEditorOpen;renderKpis();return;}
    const chip=event.target.closest('[data-gf-quick]');
    if(chip){const id=chip.dataset.gfQuick,active=state.quick.active;state.quick.active=active.includes(id)?active.filter(x=>x!==id):state.quick.items.filter(x=>x===id||active.includes(x));savePrefs();applyFilters(false);return;}
    const move=event.target.closest('[data-gf-quick-move]');
    if(move){const id=move.closest('[data-gf-quick-item]').dataset.gfQuickItem,items=state.quick.items.slice(),i=items.indexOf(id),j=i+Number(move.dataset.gfQuickMove);if(i<0||j<0||j>=items.length)return;[items[i],items[j]]=[items[j],items[i]];state.quick.items=items;commit();return;}
    if(event.target.closest('[data-gf-quick-reset]')){state.quick.items=DEFAULT_QUICK_FILTERS.slice();commit();}
  });
  host.addEventListener('change',event=>{
    const toggle=event.target.closest('[data-gf-quick-toggle]');if(!toggle)return;
    const id=toggle.closest('[data-gf-quick-item]').dataset.gfQuickItem;
    state.quick.items=toggle.checked?state.quick.items.concat(id):state.quick.items.filter(x=>x!==id);commit();
  });
  document.addEventListener('pointerdown',event=>{if(state.quickEditorOpen&&!event.target.closest('#globalFlowKpis')){state.quickEditorOpen=false;renderKpis();}},true);
}
function renderMeta(){
  const meta=$('globalFlowMeta');if(!meta)return;
  if(state.loading||state.worldLoading){meta.textContent=L('Harita verisi ve coğrafya hazırlanıyor…','Preparing map data and geography…');meta.dataset.tone='loading';return;}
  if(state.error){meta.textContent=L('Harita verisi alınamadı: ','Could not load map data: ')+state.error;meta.dataset.tone='error';return;}
  const orders=new Set(state.filtered.map(r=>r.orderKey||r.id)).size,totalQty=state.filtered.reduce((sum,r)=>sum+(Number(r.qty)||0),0),vehicles=state.model?state.model.vehicles.length:0;
  meta.textContent=sourceLabel(state.source)+' · '+nf().format(state.filtered.length)+' '+L('parsiyel','partials')+' · '+nf().format(orders)+' '+L('sipariş','orders')+' · '+nf().format(totalQty)+' '+L('adet','units')+
    (vehicles?' · '+nf().format(vehicles)+' '+L('araç','vehicles'):'')+(state.warning?' · '+state.warning:'');
  meta.dataset.tone=state.warning?'warn':'normal';
}
function ensureLoadingOverlay(){
  const wrap=$('globalFlowCanvasWrap');if(!wrap)return null;let overlay=$('globalFlowLoadingOverlay');if(overlay)return overlay;
  overlay=document.createElement('div');overlay.id='globalFlowLoadingOverlay';overlay.className='globalFlowLoadingOverlay';
  overlay.innerHTML='<div class="gfWorkingCard"><canvas id="globalFlowWorkingOrb" width="64" height="64" aria-hidden="true"></canvas><b>'+esc(L('Harita hazırlanıyor','Preparing map'))+'</b><span>'+esc(L('Sevkiyatlar ve coğrafi katmanlar eşleştiriliyor…','Matching shipments and geographic layers…'))+'</span></div>';
  wrap.appendChild(overlay);const canvas=$('globalFlowWorkingOrb');
  if(window.BLThinkingOrb&&typeof window.BLThinkingOrb.attach==='function'&&canvas)state.orbHandle=window.BLThinkingOrb.attach(canvas,{state:'working'});
  return overlay;
}
function syncLoadingOverlay(){
  const overlay=ensureLoadingOverlay();if(!overlay)return;const busy=Boolean(state.loading||state.worldLoading);
  overlay.hidden=!busy;overlay.setAttribute('aria-hidden',busy?'false':'true');
}
function setCollapsed(next){
  state.collapsed=Boolean(next);savePrefs();
  const body=$('globalFlowBody'),button=$('globalFlowCollapseBtn');
  if(body)body.hidden=state.collapsed;
  if(button){button.setAttribute('aria-expanded',state.collapsed?'false':'true');const use=button.querySelector('use');if(use)use.setAttribute('href',state.collapsed?'#i-chevron-down':'#i-chevron-up');}
  if(!state.collapsed){if(state.dirty)void refresh(false);scheduleDraw();}
}
function toggleFullscreen(){
  state.fullscreen=!state.fullscreen;
  const widget=$('globalFlowMapWidget');if(widget)widget.classList.toggle('is-fullscreen',state.fullscreen);
  document.body.classList.toggle('gfFullscreenOpen',state.fullscreen);
  renderControls();requestAnimationFrame(scheduleDraw);
}
function resetView(){
  state.panX=0;state.panY=0;state.zoom2d=1;state.rotLon=18;state.rotLat=-12;state.zoom3d=1;scheduleDraw();
}
// Tema değişmedikçe getComputedStyle çağrılmaz.
function palette(){
  if(state.paletteCache&&state.paletteCache.revision===state.paletteRevision)return state.paletteCache;
  const style=getComputedStyle(document.documentElement);
  const css=(name,fallback)=>clean(style.getPropertyValue(name))||fallback;
  state.paletteCache={
    revision:state.paletteRevision,
    water:css('--card2','#edf2f7'),land:css('--card','#ffffff'),card:css('--card','#ffffff'),line:css('--line','#d8dee8'),
    ink:css('--ink','#1f2937'),muted:css('--muted','#6b7280'),acc:css('--acc','#3f6488'),
    green:css('--green','#16845b'),red:css('--red','#c04455'),orange:css('--orange','#c47a20'),
    cyan:'#0891b2',purple:'#7c5ce0'
  };
  return state.paletteCache;
}
function canvasInfo(){
  const canvas=$('globalFlowCanvas');if(!canvas)return null;
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const w=Math.max(320,Math.round(rect.width)),h=Math.max(280,Math.round(rect.height));
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {canvas,ctx,w,h,dpr};
}
function project2d(point,w,h){
  if(!point)return null;
  const baseX=(Number(point.lon)+180)/360*w,baseY=(90-Number(point.lat))/180*h;
  const cx=w/2,cy=h/2;
  return {x:(baseX-cx)*state.zoom2d+cx+state.panX,y:(baseY-cy)*state.zoom2d+cy+state.panY,visible:true};
}
function rotate3(v){
  const lon=-state.rotLon*Math.PI/180,lat=-state.rotLat*Math.PI/180;
  const x1=v.x*Math.cos(lon)+v.z*Math.sin(lon),z1=-v.x*Math.sin(lon)+v.z*Math.cos(lon);
  const y2=v.y*Math.cos(lat)-z1*Math.sin(lat),z2=v.y*Math.sin(lat)+z1*Math.cos(lat);
  return {x:x1,y:y2,z:z2};
}
function project3d(point,w,h,altitude){
  if(!point)return null;const v=rotate3(xyz(point)),r=Math.min(w,h)*.42*state.zoom3d*(1+(altitude||0));
  return {x:w/2+v.x*r,y:h/2-v.y*r,visible:v.z>-.02,z:v.z};
}
function screenPoint(location,w,h,altitude){return state.view==='3d'?project3d(location,w,h,altitude||0):project2d(location,w,h);}
function worldPolygons(){return state.worldPolygons.length?state.worldPolygons:LAND.map(ring=>[ring.map(xy=>[xy[0],xy[1]])]);}
function drawLand2d(ctx,w,h,p){
  ctx.fillStyle=p.water;ctx.fillRect(0,0,w,h);ctx.fillStyle=p.land;ctx.strokeStyle=p.line;ctx.lineWidth=.7;
  worldPolygons().forEach(polygon=>{
    ctx.beginPath();polygon.forEach(ring=>{
      let started=false,last=null;ring.forEach(xy=>{
        const q=project2d({lon:xy[0],lat:xy[1]},w,h);
        if(!started||(last&&Math.abs(q.x-last.x)>w*.55*state.zoom2d)){ctx.moveTo(q.x,q.y);started=true;}else ctx.lineTo(q.x,q.y);last=q;
      });if(started)ctx.closePath();
    });
    try{ctx.fill('evenodd');}catch(_){ctx.fill();}ctx.stroke();
  });
  drawTarget(ctx,project2d(ISTANBUL,w,h),p);
}
function drawLand3d(ctx,w,h,p){
  ctx.fillStyle=p.water;ctx.fillRect(0,0,w,h);
  const r=Math.min(w,h)*.42*state.zoom3d;ctx.save();ctx.beginPath();ctx.arc(w/2,h/2,r,0,Math.PI*2);ctx.clip();
  ctx.fillStyle=p.water;ctx.fillRect(w/2-r,h/2-r,r*2,r*2);ctx.fillStyle=p.land;ctx.strokeStyle=p.line;ctx.lineWidth=.7;
  worldPolygons().forEach(polygon=>{
    ctx.beginPath();let hasPath=false;polygon.forEach(ring=>{
      let started=false;ring.forEach(xy=>{const q=project3d({lon:xy[0],lat:xy[1]},w,h,0);if(!q.visible){started=false;return;}if(!started){ctx.moveTo(q.x,q.y);started=true;hasPath=true;}else ctx.lineTo(q.x,q.y);});if(started)ctx.closePath();
    });if(hasPath){try{ctx.fill('evenodd');}catch(_){ctx.fill();}ctx.stroke();}
  });
  ctx.restore();ctx.strokeStyle=p.line;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(w/2,h/2,r,0,Math.PI*2);ctx.stroke();
  const target=project3d(ISTANBUL,w,h,0);if(target.visible)drawTarget(ctx,target,p);
}
function drawTarget(ctx,q,p){
  if(!q||!q.visible)return;ctx.save();ctx.translate(q.x,q.y);
  ctx.fillStyle=p.red;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;ctx.fillStyle=p.red;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();ctx.restore();
}
function viewKey(info){return [state.view,info.w,info.h,info.dpr,state.panX,state.panY,state.zoom2d,state.rotLon,state.rotLat,state.zoom3d].join('|');}
/* Dünya katmanı yalnız görünüm/tema/coğrafya değişince yeniden çizilir;
   akış animasyonu kareleri hazır katmanı kopyalar. */
function baseLayer(info,p){
  const key=viewKey(info)+'|'+state.paletteRevision+'|'+state.worldRevision+'|'+state.worldPolygons.length;
  if(state.base&&state.base.key===key)return state.base.canvas;
  const canvas=state.base&&state.base.canvas||document.createElement('canvas');
  canvas.width=Math.round(info.w*info.dpr);canvas.height=Math.round(info.h*info.dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(info.dpr,0,0,info.dpr,0,0);
  if(state.view==='3d')drawLand3d(ctx,info.w,info.h,p);else drawLand2d(ctx,info.w,info.h,p);
  state.base={key,canvas};return canvas;
}
function modeColor(mode,p){return mode==='air'?p.purple:mode==='sea'?p.cyan:mode==='road'?p.orange:mode==='sea-air'?p.acc:p.muted;}
function projectEdge(edge,w,h){
  const out=[];let gap=false;
  edgeSamples(edge).forEach(sample=>{
    const q=screenPoint(sample,w,h,sample.alt);
    if(!q||!q.visible){gap=true;return;}
    out.push({x:q.x,y:q.y,legIndex:0,gap});gap=false;
  });
  return out;
}
function nodeRadius(bundle){return 5+Math.min(6,Math.log10(1+bundle.records.length)*2);}
/* Sahne: projeksiyon, çakışma yerleşimi ve tıklama hedefleri. Görünüm, model
   ve genişletilmiş düğüm aynı kaldıkça animasyon kareleri arasında aynen
   kullanılır. */
function buildScene(info,p){
  const key=viewKey(info)+'|'+state.modelRevision+'|'+state.expandedNodeKey+'|'+state.paletteRevision;
  if(state.scene&&state.scene.key===key)return state.scene;
  const {w,h}=info,model=state.model||{nodes:[],edges:[],vehicles:[]},hitTargets=[],maxQty=Math.max(1,...model.edges.map(e=>e.qty));
  const edges=model.edges.map(edge=>{
    const points=projectEdge(edge,w,h),width=1.3+Math.sqrt(edge.qty/maxQty)*4.2,color=modeColor(edge.mode,p);
    if(points.length>1)hitTargets.push({type:'route',points,edge,records:edge.records,r:Math.max(7,width+4),priority:10});
    return {edge,points,width,color};
  }).filter(item=>item.points.length>1);
  const symbols=[];
  model.nodes.forEach(bundle=>{const q=screenPoint(bundle.location,w,h);if(q&&q.visible)symbols.push({id:'node:'+bundle.key,kind:'node',bundle,x:q.x,y:q.y,r:nodeRadius(bundle)});});
  model.vehicles.forEach(vehicle=>{
    if(!vehicle.geo)return;const q=screenPoint(vehicle.geo,w,h,vehicle.geo.alt);if(!q||!q.visible)return;
    const ahead=vehicle.geo.ahead?screenPoint(vehicle.geo.ahead,w,h,vehicle.geo.ahead.alt):null,behind=vehicle.geo.behind?screenPoint(vehicle.geo.behind,w,h,vehicle.geo.behind.alt):null;
    let heading=0;if(ahead&&Math.hypot(ahead.x-q.x,ahead.y-q.y)>.5)heading=Math.atan2(ahead.y-q.y,ahead.x-q.x);else if(behind)heading=Math.atan2(q.y-behind.y,q.x-behind.x);
    symbols.push({id:vehicle.id,kind:'vehicle',vehicle,x:q.x,y:q.y,heading,r:9});
  });
  resolveSymbolCollisions(symbols,SYMBOL_MIN_DISTANCE);
  symbols.forEach(symbol=>{
    if(symbol.kind==='node'){
      const expanded=state.expandedNodeKey===symbol.bundle.key;
      hitTargets.push({type:'node',x:symbol.x,y:symbol.y,r:expanded?46:Math.max(11,symbol.r+4),bundle:symbol.bundle,records:symbol.bundle.records,priority:70});
      if(expanded){
        const stages=symbol.bundle.kind==='arrival'?ARRIVAL_STAGES:ORIGIN_STAGES,available=stages.filter(stage=>(symbol.bundle.stages.get(stage)||[]).length),offsets=available.length===3?[[-28,-30],[0,-38],[28,-30]]:available.length===2?[[-18,-30],[18,-30]]:[[0,-32]];
        symbol.stageIcons=available.map((stage,index)=>{const offset=offsets[index]||[0,-32],x=symbol.x+offset[0],y=symbol.y+offset[1],records=symbol.bundle.stages.get(stage)||[];hitTargets.push({type:'stage',x,y,r:12,stage,nodeKey:symbol.bundle.key,records,priority:100});return {stage,x,y};});
      }
    }else hitTargets.push({type:'vehicle',x:symbol.x,y:symbol.y,r:SYMBOL_MIN_DISTANCE/2,vehicle:symbol.vehicle,records:symbol.vehicle.records,priority:90});
  });
  state.scene={key,edges,symbols,hitTargets};
  return state.scene;
}
function strokePath(ctx,points){ctx.beginPath();points.forEach((q,i)=>{if(i===0||q.gap)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();}
const FLOW_STYLE=Object.freeze({sea:{dash:[2,9],speed:16},air:{dash:[7,9],speed:42},road:{dash:[5,7],speed:24},unknown:{dash:[4,8],speed:20}});
/* Ortak kenar bir kez çizilir; ince akış çizgileri varış yönüne (kenarın
   a→b yönü, yani İstanbul/aktarma limanı yönü) kayar. */
function drawEdges(ctx,scene,now,animate){
  scene.edges.forEach(item=>{
    ctx.save();ctx.strokeStyle=item.color;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.globalAlpha=.34;ctx.lineWidth=item.width;ctx.setLineDash(item.edge.mode==='road'?[6,4]:[]);strokePath(ctx,item.points);
    const style=FLOW_STYLE[item.edge.mode]||FLOW_STYLE.unknown,period=style.dash[0]+style.dash[1];
    ctx.globalAlpha=.92;ctx.lineWidth=Math.max(1.2,item.width*.55);ctx.setLineDash(style.dash);
    ctx.lineDashOffset=animate?-((now/1000*style.speed)%period):0;strokePath(ctx,item.points);
    ctx.restore();
  });
}
function drawVehicle(ctx,symbol,p){
  const vehicle=symbol.vehicle,color=modeColor(vehicle.mode,p),count=vehicle.records.length;
  if(symbol.displaced){ctx.save();ctx.strokeStyle=p.muted;ctx.globalAlpha=.55;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(symbol.anchorX,symbol.anchorY);ctx.lineTo(symbol.x,symbol.y);ctx.stroke();ctx.fillStyle=color;ctx.beginPath();ctx.arc(symbol.anchorX,symbol.anchorY,2,0,Math.PI*2);ctx.fill();ctx.restore();}
  ctx.save();ctx.translate(symbol.x,symbol.y);
  ctx.fillStyle=p.card;ctx.strokeStyle=vehicle.critical?p.red:color;ctx.lineWidth=vehicle.critical?2:1.2;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle=color;
  if(vehicle.mode==='air'){ctx.save();ctx.rotate(symbol.heading||0);ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-4.5,-3.5);ctx.lineTo(-1.5,0);ctx.lineTo(-4.5,3.5);ctx.closePath();ctx.fill();ctx.restore();}
  else if(vehicle.mode==='sea'){ctx.beginPath();ctx.moveTo(-5.5,-1);ctx.lineTo(5.5,-1);ctx.lineTo(3.2,4);ctx.lineTo(-3.8,4);ctx.closePath();ctx.fill();ctx.fillRect(-1,-5,2.4,4);}
  else if(vehicle.mode==='road'){ctx.fillRect(-5.5,-3,7.5,4.6);ctx.fillRect(2.3,-1.4,3.4,3);ctx.beginPath();ctx.arc(-3,2.6,1.5,0,Math.PI*2);ctx.arc(3.8,2.6,1.5,0,Math.PI*2);ctx.fill();}
  else {ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();}
  if(count>1){const label=count>99?'99+':String(count);ctx.font='700 9px sans-serif';const bw=Math.max(13,ctx.measureText(label).width+6);ctx.fillStyle=vehicle.critical?p.red:color;ctx.beginPath();ctx.arc(8,-8,bw/2,0,Math.PI*2);ctx.fill();ctx.fillStyle=p.card;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,8,-7.5);}
  ctx.restore();
}
const STAGE_META={
  PRODUCTION:{tr:'Üretimde',en:'In production',glyph:'P'},LOADING:{tr:'Yükleme Operasyonları',en:'Loading Operations',glyph:'L'},
  CUSTOMS:{tr:'Gümrük Operasyonları',en:'Customs Operation',glyph:'C'},IN_WAREHOUSE:{tr:'Depoda',en:'In Warehouse',glyph:'W'},
  AWAITING_RETAIL_TRANSFER:{tr:'Retail Aktarım Bekliyor',en:'Awaiting Retail Transfer',glyph:'R'}
};
function stageLabel(stage){const meta=STAGE_META[stage];return meta?(isEn()?meta.en:meta.tr):stage;}
function drawStageIcon(ctx,x,y,stage,p){
  const meta=STAGE_META[stage]||{glyph:'•'},color=stage==='PRODUCTION'?p.acc:stage==='LOADING'?p.orange:stage==='CUSTOMS'?p.red:stage==='IN_WAREHOUSE'?p.green:p.purple;
  ctx.save();ctx.fillStyle=p.land;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.font='800 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(meta.glyph,x,y+.5);ctx.restore();
}
function drawNode(ctx,symbol,p){
  const bundle=symbol.bundle,baseColor=bundle.kind==='arrival'?p.green:p.acc,radius=symbol.r;
  if(symbol.displaced){ctx.save();ctx.strokeStyle=p.muted;ctx.globalAlpha=.55;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(symbol.anchorX,symbol.anchorY);ctx.lineTo(symbol.x,symbol.y);ctx.stroke();ctx.restore();}
  ctx.save();ctx.fillStyle=baseColor;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(symbol.x,symbol.y,radius+8,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.95;ctx.beginPath();ctx.arc(symbol.x,symbol.y,radius,0,Math.PI*2);ctx.fill();
  if(bundle.records.some(r=>r.critical)){ctx.globalAlpha=1;ctx.strokeStyle=p.red;ctx.lineWidth=2;ctx.beginPath();ctx.arc(symbol.x,symbol.y,radius+3,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
  (symbol.stageIcons||[]).forEach(icon=>drawStageIcon(ctx,icon.x,icon.y,icon.stage,p));
}
function drawHoverHighlight(ctx,hit,p){
  if(hit.type==='route'){ctx.save();ctx.strokeStyle=p.ink;ctx.globalAlpha=.45;ctx.lineWidth=Math.max(3,Number(hit.r||8)/2);ctx.lineCap='round';ctx.setLineDash([]);strokePath(ctx,hit.points);ctx.restore();return;}
  ctx.save();ctx.strokeStyle=p.ink;ctx.globalAlpha=.55;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(hit.x,hit.y,Math.min(24,Number(hit.r||10)+3),0,Math.PI*2);ctx.stroke();ctx.restore();
}
function hitIdentity(hit){if(!hit)return '';return hit.type+':'+(hit.vehicle?hit.vehicle.id:hit.edge?hit.edge.key:hit.bundle?hit.bundle.key:hit.stage?hit.nodeKey+'/'+hit.stage:'');}
function currentHit(){
  // Sahne yeniden kurulduğunda hover nesnesi eski hedefi tutmasın.
  if(!state.hover||!state.scene)return null;const id=hitIdentity(state.hover);
  return state.scene.hitTargets.find(target=>hitIdentity(target)===id)||null;
}
function wantsAnimation(){return Boolean(state.model&&state.model.edges.length)&&!reducedMotion();}
function draw(now){
  state.frame=0;if(!isLive())return;const info=canvasInfo();if(!info)return;
  const p=palette(),{ctx,w,h}=info,t=now||performance.now(),animate=wantsAnimation();
  ctx.clearRect(0,0,w,h);ctx.drawImage(baseLayer(info,p),0,0,w,h);
  const scene=buildScene(info,p);drawEdges(ctx,scene,t,animate);
  scene.symbols.forEach(symbol=>{if(symbol.kind==='node')drawNode(ctx,symbol,p);});
  scene.symbols.forEach(symbol=>{if(symbol.kind==='vehicle')drawVehicle(ctx,symbol,p);});
  const hover=currentHit();if(hover)drawHoverHighlight(ctx,hover,p);
  if(animate||state.expandedNodeKey)state.frame=requestAnimationFrame(throttledDraw);
}
function throttledDraw(now){if(now-state.lastFrame<50){state.frame=requestAnimationFrame(throttledDraw);return;}state.lastFrame=now;draw(now);}
function scheduleDraw(){if(state.frame)cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(draw);}
function nearestHit(x,y){return pickHit(state.scene?state.scene.hitTargets:[],x,y);}
function canvasPoint(event){const canvas=$('globalFlowCanvas'),rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
function totalOf(records){return (records||[]).reduce((sum,row)=>sum+(Number(row.qty)||0),0);}
function countSummary(records){
  const orders=new Set((records||[]).map(r=>r.orderKey||r.id)).size;
  return nf().format(records.length)+' '+L('parsiyel','partials')+' · '+nf().format(orders)+' '+L('sipariş','orders')+' · '+nf().format(totalOf(records))+' '+L('adet','units');
}
function edgeTitle(edge){
  const origins=[...edge.origins].sort(),dest=[...edge.destinations].sort();
  return origins.join(', ')+' → '+(dest.join(' / ')||ISTANBUL.name);
}
function vehicleTitle(vehicle){
  if(vehicle.vesselName)return vehicle.vesselName;
  const files=vehicle.files;return files.length===1?files[0]:files.slice(0,2).join(' + ')+(files.length>2?' +'+(files.length-2):'');
}
function showTooltip(hit,event){
  const tip=$('globalFlowTooltip');if(!tip)return;if(!hit){tip.hidden=true;return;}let title='',lines=[],critical=false;
  if(hit.type==='vehicle'){
    const v=hit.vehicle;title=vehicleTitle(v);
    lines.push(modeLabel(v.mode)+' · '+v.leg.from+' → '+v.leg.to);
    lines.push(Math.round(v.progress*100)+'% '+L('ayak ilerlemesi','leg progress')+(v.elapsedDays!=null&&v.leadDays!=null?' · '+Math.floor(v.elapsedDays)+' / '+Math.round(v.leadDays)+' '+L('gün','days'):''));
    if(v.vesselName)lines.push(L('Gemi','Vessel')+': '+v.vesselName);
    lines.push(countSummary(v.records));critical=v.critical;
  }else if(hit.type==='route'){
    const edge=hit.edge;title=edgeTitle(edge);
    lines.push(modeLabel(edge.mode)+(edge.origins.size>1?' · '+L('Ortak koridor','Shared corridor'):''));lines.push(countSummary(edge.records));critical=edge.records.some(r=>r.critical);
  }else if(hit.type==='stage'){title=stageLabel(hit.stage);lines.push(countSummary(hit.records));if(hit.nodeKey==='arrival:istanbul')lines.push(ISTANBUL.name);critical=hit.records.some(r=>r.critical);}
  else if(hit.type==='node'){title=hit.bundle.kind==='arrival'?ISTANBUL.name:hit.bundle.location.name;const parts=[...hit.bundle.stages.entries()].map(entry=>stageLabel(entry[0])+' '+nf().format(entry[1].length));lines.push(parts.join(' · ')||countSummary(hit.records));lines.push(countSummary(hit.records));lines.push(L('Durum simgeleri için üzerinde kalın.','Keep hovering to reveal status icons.'));critical=hit.records.some(r=>r.critical);}
  tip.innerHTML='<b>'+esc(title||L('Detay','Detail'))+'</b>'+lines.map(line=>'<span>'+esc(line)+'</span>').join('')+(critical?'<em>'+esc(L('Kritik parsiyel var','Critical partial present'))+'</em>':'');
  const wrap=$('globalFlowCanvasWrap').getBoundingClientRect();tip.style.left=Math.min(wrap.width-240,Math.max(8,event.clientX-wrap.left+12))+'px';tip.style.top=Math.min(wrap.height-130,Math.max(8,event.clientY-wrap.top+12))+'px';tip.hidden=false;
}
function onPointerDown(event){
  if(event.button!==0)return;const p=canvasPoint(event);state.lastDragMoved=false;state.drag={id:event.pointerId,x:p.x,y:p.y,panX:state.panX,panY:state.panY,rotLon:state.rotLon,rotLat:state.rotLat,moved:false};try{event.currentTarget.setPointerCapture(event.pointerId);}catch(_){}
}
function onPointerMove(event){
  const p=canvasPoint(event);
  if(state.drag&&state.drag.id===event.pointerId){const dx=p.x-state.drag.x,dy=p.y-state.drag.y;if(Math.hypot(dx,dy)>3)state.drag.moved=true;if(state.view==='3d'){state.rotLon=state.drag.rotLon+dx*.35;state.rotLat=Math.max(-78,Math.min(78,state.drag.rotLat-dy*.28));}else{state.panX=state.drag.panX+dx;state.panY=state.drag.panY+dy;}scheduleDraw();return;}
  const hit=nearestHit(p.x,p.y),prevExpanded=state.expandedNodeKey,prevHover=hitIdentity(state.hover);
  if(hit&&hit.type==='node')state.expandedNodeKey=hit.bundle.key;else if(hit&&hit.nodeKey)state.expandedNodeKey=hit.nodeKey;else if(state.expandedNodeKey){const node=(state.scene?state.scene.hitTargets:[]).find(target=>target.type==='node'&&target.bundle&&target.bundle.key===state.expandedNodeKey);if(!node||Math.hypot(node.x-p.x,node.y-p.y)>48)state.expandedNodeKey='';}
  state.hover=hit;showTooltip(hit,event);
  // Yalnız hover hedefi veya düğüm genişlemesi değiştiğinde yeniden çiz.
  if(prevExpanded!==state.expandedNodeKey||prevHover!==hitIdentity(hit))scheduleDraw();
}
function onPointerUp(event){if(state.drag&&state.drag.id===event.pointerId){state.lastDragMoved=Boolean(state.drag.moved);state.drag=null;}}
// 2D'de yakınlaştırma imlecin altındaki noktayı sabit tutar; kullanıcı ilgilendiği
// koridora doğrudan yaklaşır. 3D küre merkezden ölçeklenir.
function onWheel(event){
  event.preventDefault();const factor=event.deltaY>0?.9:1.1;
  if(state.view==='3d'){state.zoom3d=Math.max(.65,Math.min(2.2,state.zoom3d*factor));scheduleDraw();return;}
  const next=Math.max(.65,Math.min(4.5,state.zoom2d*factor)),canvas=$('globalFlowCanvas');
  if(canvas&&next!==state.zoom2d){
    const rect=canvas.getBoundingClientRect(),p=canvasPoint(event),cx=Math.max(320,Math.round(rect.width))/2,cy=Math.max(280,Math.round(rect.height))/2,ratio=next/state.zoom2d;
    state.panX=p.x-cx-(p.x-cx-state.panX)*ratio;state.panY=p.y-cy-(p.y-cy-state.panY)*ratio;
  }
  state.zoom2d=next;scheduleDraw();
}
function placementOf(rec){return state.model&&state.model.placementById?state.model.placementById.get(rec.id):null;}
function partialLabel(rec){
  if(rec.partialKind==='production')return L('Üretim bakiyesi','Production balance');
  if(rec.partialKind==='shortage')return L('Eksik yükleme','Shortage');
  return rec.partialNo!=null?'P'+rec.partialNo:(rec.partialKind?L('Parsiyel','Partial'):'—');
}
function detailColumns(records){
  const priorityLabel=code=>{const meta=window.BLOrderDecisionEngine&&window.BLOrderDecisionEngine.ACTION_PRIORITY&&window.BLOrderDecisionEngine.ACTION_PRIORITY[code];return meta?(isEn()?meta.en:meta.tr):code||'';};
  const standard=[
    {key:'source',label:L('Kaynak','Source'),value:r=>sourceLabel(r.source)},{key:'partial',label:L('Parsiyel','Partial'),value:partialLabel},
    {key:'shipmentFile',label:L('İhracat / İthalat Dosya No','Export / Import File No')},{key:'containerNo',label:L('Konteyner No','Container No')},{key:'vesselName',label:L('Gemi Ad','Vessel Name')},
    {key:'orderCode',label:L('Sipariş Kod','Order Code')},{key:'plmId',label:'PLM ID'},{key:'model',label:L('Model Adı','Model Name')},{key:'colourCode',label:L('Renk Kod','Colour Code')},{key:'colour',label:L('Renk','Colour')},
    {key:'season',label:L('Sezon','Season')},{key:'buyer',label:'Buyer'},{key:'buyingGroup',label:'Buying Group'},{key:'manufacturer',label:L('Üretici','Supplier')},{key:'country',label:L('Ülke','Country')},{key:'status',label:L('Statü','Status')},
    {key:'mode',label:L('Taşıma','Transport'),value:r=>modeLabel(r.mode)},{key:'qty',label:L('Adet','Qty')},{key:'handover',label:'Handover'},{key:'exFactory',label:'Ex-Factory'},{key:'eta',label:'ETA'},
    {key:'routeProgress',label:L('Rota ilerlemesi','Route progress'),value:r=>{const p=placementOf(r);return p?Math.round(p.meta.progress*100)+'%'+(p.meta.known?'':' ~'):'';}},
    {key:'transitDays',label:L('Geçen / yol süresi (gün)','Elapsed / lead days'),value:r=>{const p=placementOf(r);return p&&p.meta.elapsedDays!=null?Math.floor(p.meta.elapsedDays)+' / '+Math.round(p.meta.leadDays):'';}},
    {key:'priority',label:'Priority',value:r=>priorityLabel(r.actionPriority)}
  ];
  const labels=new Set(standard.map(col=>norm(col.label)).concat(standard.map(col=>norm(col.key)))),extras=[],seen=new Set();
  (records||[]).slice(0,40).forEach(rec=>Object.keys(rec&&rec.raw||{}).forEach(rawKey=>{const label=clean(rawKey),keyNorm=norm(label);if(!label||label.startsWith('_')||labels.has(keyNorm)||seen.has(keyNorm))return;seen.add(keyNorm);extras.push({key:'raw:'+rawKey,label,value:r=>r&&r.raw?r.raw[rawKey]:''});}));
  return standard.concat(extras);
}
function openRecordsDrawer(title,records,subtitle){
  const rows=(records||[]).filter(Boolean);if(!rows.length)return;
  if(window.BLDetailDrawer&&typeof window.BLDetailDrawer.open==='function'){
    const actions=rows.length===1?[{label:L('Kaynakta Aç','Open source'),run:()=>jumpToSource(rows[0])}]:[];
    window.BLDetailDrawer.open({storageKey:'overview.globalFlow.detail',source:'global-flow',title,subtitle:subtitle||'',rows,columns:detailColumns(rows),images:true,fileName:'Global_Flow_'+title,actions,note:L('Araç konumu canlı GPS/AIS değildir; parsiyel Handover tarihi ve ülke/yükleme yol süresi kuralından hesaplanan operasyonel ilerlemedir. Aynı Gemi Ad taşıyan parsiyeller tek araçta gösterilir.','Vehicle position is not live GPS/AIS; it is operational progress calculated from the partial Handover date and the country/transport lead-time rule. Partials with the same vessel name are shown as one vehicle.')});return;
  }
  const drawer=$('globalFlowDrawer');if(!drawer)return;drawer.innerHTML='<div class="gfDrawerHead"><div><b>'+esc(title)+'</b><span>'+esc(subtitle||'')+'</span></div><button type="button" data-gf-drawer-close>×</button></div><div class="gfDrawerBody"><div class="gfDrawerTableWrap"><table class="gfDrawerTable"><thead><tr><th>'+esc(L('Sipariş','Order'))+'</th><th>'+esc(L('Parsiyel','Partial'))+'</th><th>'+esc(L('Model','Model'))+'</th><th>'+esc(L('Statü','Status'))+'</th><th>'+esc(L('Adet','Qty'))+'</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.orderCode||'—')+'</td><td>'+esc(partialLabel(r))+'</td><td>'+esc(r.model||'—')+'</td><td>'+esc(r.status||'—')+'</td><td class="num">'+nf().format(r.qty||0)+'</td></tr>').join('')+'</tbody></table></div></div>';
  drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');drawer.querySelector('[data-gf-drawer-close]')?.addEventListener('click',closeDrawer);
}
function openHitDetail(hit){
  if(!hit)return;
  if(hit.type==='vehicle'){const v=hit.vehicle,title=v.vesselName||(v.files.length===1?v.files[0]:L('Gruplanmış sevkiyatlar','Grouped shipments')+' · '+v.files.length);openRecordsDrawer(title,v.records,modeLabel(v.mode)+' · '+v.leg.from+' → '+v.leg.to+' · '+Math.round(v.progress*100)+'%');return;}
  if(hit.type==='route'){openRecordsDrawer(edgeTitle(hit.edge),hit.records,modeLabel(hit.edge.mode)+(hit.edge.origins.size>1?' · '+L('Ortak koridor','Shared corridor'):''));return;}
  if(hit.type==='stage'){openRecordsDrawer(stageLabel(hit.stage),hit.records,hit.nodeKey==='arrival:istanbul'?ISTANBUL.name:'');return;}
  if(hit.type==='node')openRecordsDrawer(hit.bundle.kind==='arrival'?ISTANBUL.name:hit.bundle.location.name,hit.records,L('Operasyon durumları','Operational stages'));
}
function closeDrawer(){const drawer=$('globalFlowDrawer');if(drawer){drawer.classList.remove('is-open');drawer.setAttribute('aria-hidden','true');}window.BLDetailDrawer?.close?.();}
function jumpToSource(rec){
  if(!rec)return;const tab=document.querySelector('nav.tabs button[data-tab="'+rec.source+'"]');if(tab)tab.click();const searchId=rec.source==='cp'?'cpSearch':rec.source==='orders'?'ordersSearch':'';
  if(searchId&&rec.orderCode)setTimeout(()=>{const input=$(searchId);if(!input)return;input.value=rec.orderCode;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();},80);closeDrawer();
}
function bindCanvas(){
  const canvas=$('globalFlowCanvas');if(!canvas||canvas.dataset.gfBound)return;canvas.dataset.gfBound='1';
  canvas.addEventListener('pointerdown',onPointerDown);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',onPointerUp);
  canvas.addEventListener('pointerleave',event=>{if(!state.drag){const had=Boolean(state.hover||state.expandedNodeKey);state.hover=null;state.expandedNodeKey='';showTooltip(null,event);if(had)scheduleDraw();}});
  canvas.addEventListener('wheel',onWheel,{passive:false});
  canvas.addEventListener('click',event=>{if(state.lastDragMoved){state.lastDragMoved=false;return;}const p=canvasPoint(event),hit=nearestHit(p.x,p.y);if(hit)openHitDetail(hit);});
  canvas.addEventListener('dblclick',event=>event.preventDefault());
}
function bindObservers(){
  // Kaynak verisi değiştiğinde app-main bildirir; ızgara DOM'u izlenmez.
  window.addEventListener('bl:global-flow-data-changed',event=>{
    const tables=event&&event.detail&&Array.isArray(event.detail.tables)?event.detail.tables:['cp','orders'];
    if(state.source==='combined'||tables.includes(state.source))scheduleRefresh(250);
  });
  const themeObserver=new MutationObserver(()=>{state.paletteRevision++;state.scene=null;scheduleDraw();});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','lang']});state.observers.push(themeObserver);
  const widget=$('globalFlowMapWidget');
  if(widget&&typeof IntersectionObserver==='function'){
    const io=new IntersectionObserver(entries=>{
      const visible=entries.some(entry=>entry.isIntersecting);if(visible===state.inView)return;state.inView=visible;
      if(visible){if(state.dirty)void refresh(false);scheduleDraw();}
      else if(state.frame){cancelAnimationFrame(state.frame);state.frame=0;}
    });io.observe(widget);state.observers.push(io);
  }
  window.addEventListener('resize',scheduleDraw,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.dirty)void refresh(false);scheduleDraw();}});
  window.addEventListener('pagehide',flushPrefs);
  document.addEventListener('bl:language-changed',()=>{renderAll();});
}
function renderAll(){renderControls();renderFilters();renderKpis();renderMeta();setCollapsed(state.collapsed);scheduleDraw();}
function init(){
  const widget=$('globalFlowMapWidget');if(!widget)return;loadPrefs();
  $('globalFlowCollapseBtn')?.addEventListener('click',()=>setCollapsed(!state.collapsed));
  bindControls();bindFilters();bindKpis();bindCanvas();bindObservers();renderAll();syncLoadingOverlay();
  // Uygulama başka sekmede açıldıysa veri gözlemci görünür dediğinde yüklenir.
  state.inView=widget.getClientRects().length>0;
  state.dirty=true;if(isLive())void refresh(false);
  // Yakalama evresinde çalışır: açık detay çekmecesi kendi Escape'iyle
  // kapanmadan önce durum okunur; Escape önce çekmeceyi, sonra tam ekranı kapatır.
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(state.quickEditorOpen){state.quickEditorOpen=false;renderKpis();return;}
    const drawerOpen=Boolean(window.BLDetailDrawer&&window.BLDetailDrawer.isOpen&&window.BLDetailDrawer.isOpen())||Boolean($('globalFlowDrawer')?.classList.contains('is-open'));
    if(drawerOpen){if($('globalFlowDrawer')?.classList.contains('is-open'))closeDrawer();return;}
    if(state.fullscreen)toggleFullscreen();
  },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

return {
  ISTANBUL,COLOMBO,FIELD_CANDIDATES,QUICK_FILTERS,DEFAULT_QUICK_FILTERS,clean,norm,toNumber,pick,countryCoordinate,detectMode,operationalStage,classifyState,actionPriorityCode,
  normalizeRecord,expandSourceRow,shipmentPartialsFromRows,recordKey,dedupeRecords,aggregateRecords,uniqueValues,parseDateMs,resolveRecordTransitDays,recordRouteProgress,
  distancePointToSegment,distanceToPolyline,decodeWorldTopology,seaRouteCoordinates,seaAirRouteCoordinates,routeLegsFor,routeEdges,buildFlowModel,resolveSymbolCollisions,pickHit,
  refresh:()=>refresh(true),resetView
};
});
