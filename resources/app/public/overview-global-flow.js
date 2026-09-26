(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewGlobalFlow=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';

const ISTANBUL=Object.freeze({name:'İstanbul',lat:41.0082,lon:28.9784});
const STORAGE_KEY='buyerlog.overview.globalFlow.v1';
const SOURCE_PRIORITY=Object.freeze({cp:1,orders:2,backlog:3});
const FIELD_CANDIDATES=Object.freeze({
  orderCode:['Sipariş Kod','Sipariş Kodu','Order Code','Order No','Order','OCode'],
  shipmentFile:['İhracat Dosya No','İhracat Dosya Numarası','Export File No','Export File Number','Export File','İthalat Dosya No','İthalat Dosya Numarası','Import File No','Import File Number','Import File'],
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
  eta:['ANTREPO GİRİŞ TARİHİ','Antrepo Giriş Tarihi','Antrepo ETA','Warehouse ETA','ETA'],
  handover:['HANDOVER Tarihi','Handover Tarihi','Handover Date','HANDOVER','Handover'],
  exFactory:['REVİZE YÜKLEME TARİHİ (EX-FACTORY)','Revize Yükleme Tarihi','Orijinal Exfactory Merch Tarih','Ex-Factory','Ex Factory','Planned Ex-Factory'],
  transitDays:['Yol Süresi','Yol Süresi (Gün)','Transit Süresi','Transit Gün','Transit Days','Lead Time Days'],
  priority:['RİSK (PRIORITY)','Priority','Risk','RİSK'],
});

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
function norm(value){
  return clean(value).toLocaleLowerCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i')
    .replace(/[()]/g,' ').replace(/[_/\\-]+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
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
function countryCoordinate(value){
  const key=norm(value);if(!key)return null;
  if(COUNTRY_POINTS[key])return {...COUNTRY_POINTS[key]};
  const entries=Object.entries(COUNTRY_POINTS);
  const found=entries.find(([name])=>key===name||key.includes(name)||name.includes(key));
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
function classifyState(status,mode,raw){
  const stage=operationalStage(status),s=norm(status),idx=normalizedIndex(raw||{});
  const received=toNumber(idx[norm('Net Gelen Alım Sipariş Miktarı')])+
    toNumber(idx[norm('Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo')]);
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
function riskLevel(priority,status){
  const s=norm(clean(priority)+' '+clean(status));
  if(/critical|kritik|already late|gecik|late|overdue|riskli|at risk/.test(s))return 'high';
  if(/watch|izle|action|aksiyon|warning|uyari/.test(s))return 'medium';
  return 'none';
}
function normalizeRecord(row,source,index){
  const mode=detectMode(pick(row,FIELD_CANDIDATES.mode));
  const status=clean(pick(row,FIELD_CANDIDATES.status));
  const country=clean(pick(row,FIELD_CANDIDATES.country));
  const origin=countryCoordinate(country);
  const rec={
    id:String(source||'source')+':'+String(index||0),
    source:String(source||''),
    orderCode:clean(pick(row,FIELD_CANDIDATES.orderCode)),
    shipmentFile:clean(pick(row,FIELD_CANDIDATES.shipmentFile)),
    model:clean(pick(row,FIELD_CANDIDATES.model)),
    plmId:clean(pick(row,FIELD_CANDIDATES.plmId)),
    colourCode:clean(pick(row,FIELD_CANDIDATES.colourCode)),
    colour:clean(pick(row,FIELD_CANDIDATES.colour)),
    season:clean(pick(row,FIELD_CANDIDATES.season)),
    mag:clean(pick(row,FIELD_CANDIDATES.mag)),
    mmyg:clean(pick(row,FIELD_CANDIDATES.mmyg)),
    line:clean(pick(row,FIELD_CANDIDATES.line)),
    category:clean(pick(row,FIELD_CANDIDATES.category)),
    license:clean(pick(row,FIELD_CANDIDATES.license)),
    buyer:clean(pick(row,FIELD_CANDIDATES.buyer)),
    buyingGroup:clean(pick(row,FIELD_CANDIDATES.buyingGroup)),
    manufacturer:clean(pick(row,FIELD_CANDIDATES.manufacturer)),
    country,
    status,
    operationalStage:operationalStage(status),
    mode,
    modeRaw:clean(pick(row,FIELD_CANDIDATES.mode)),
    qty:Math.max(0,toNumber(pick(row,FIELD_CANDIDATES.qty))),
    eta:clean(pick(row,FIELD_CANDIDATES.eta)),
    handover:clean(pick(row,FIELD_CANDIDATES.handover)),
    exFactory:clean(pick(row,FIELD_CANDIDATES.exFactory)),
    transitDays:Math.max(0,toNumber(pick(row,FIELD_CANDIDATES.transitDays))),
    priority:clean(pick(row,FIELD_CANDIDATES.priority)),
    origin,
    raw:row
  };
  rec.state=classifyState(rec.status,rec.mode,row);
  rec.risk=riskLevel(rec.priority,rec.status);
  return rec;
}
function recordKey(rec){
  const order=norm(rec&&rec.orderCode),model=norm(rec&&rec.model),colour=norm(rec&&rec.colourCode);
  if(order)return order+'|'+model+'|'+colour;
  return (rec&&rec.source||'')+'|'+(rec&&rec.id||Math.random());
}
function dedupeRecords(records){
  const map=new Map();
  (records||[]).forEach(rec=>{
    const key=recordKey(rec),prev=map.get(key);
    if(!prev||(SOURCE_PRIORITY[rec.source]||0)>=(SOURCE_PRIORITY[prev.source]||0))map.set(key,rec);
  });
  return [...map.values()];
}
function aggregateRecords(records){
  const groups=new Map();
  (records||[]).forEach(rec=>{
    const origin=rec.origin;
    const location=rec.state==='arrived'?ISTANBUL:origin;
    const key=[rec.state,rec.mode,origin?origin.name:'unknown',location?location.name:'unknown'].join('|');
    if(!groups.has(key))groups.set(key,{key,state:rec.state,mode:rec.mode,origin,location,qty:0,orders:0,risk:'none',records:[]});
    const group=groups.get(key);group.qty+=Number(rec.qty)||0;group.orders++;group.records.push(rec);
    if(rec.risk==='high')group.risk='high';else if(rec.risk==='medium'&&group.risk==='none')group.risk='medium';
  });
  return [...groups.values()];
}
function uniqueValues(records,key){
  return [...new Set((records||[]).map(r=>clean(r&&r[key])).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true,sensitivity:'base'}));
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
  let best=Infinity;for(let i=1;i<points.length;i++){if(points[i].legIndex!==points[i-1].legIndex)continue;best=Math.min(best,distancePointToSegment(x,y,points[i-1].x,points[i-1].y,points[i].x,points[i].y));}
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
  const out=[];prefix.forEach(point=>{if(!out.length||Math.abs(out[out.length-1][0]-point[0])>.0001||Math.abs(out[out.length-1][1]-point[1])>.0001)out.push(point);});
  return out.map(point=>({lon:Number(point[0]),lat:Number(point[1])}));
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

if(typeof document==='undefined'){
  return {ISTANBUL,FIELD_CANDIDATES,clean,norm,toNumber,pick,countryCoordinate,detectMode,operationalStage,classifyState,riskLevel,normalizeRecord,recordKey,dedupeRecords,aggregateRecords,uniqueValues,parseDateMs,resolveRecordTransitDays,recordRouteProgress,distancePointToSegment,distanceToPolyline,decodeWorldTopology,seaRouteCoordinates,seaAirRouteCoordinates};
}

const $=id=>document.getElementById(id);
const isEn=()=>String(document.documentElement.lang||'tr').toLowerCase().startsWith('en');
const L=(tr,en)=>isEn()?en:tr;
const esc=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const nf=()=>new Intl.NumberFormat(isEn()?'en-GB':'tr-TR',{maximumFractionDigits:0});
const state={
  source:'backlog',view:'2d',records:[],filtered:[],groups:[],loading:false,error:'',warning:'',
  filters:{search:'',season:'',mag:'',mmyg:'',buyer:'',buyingGroup:'',manufacturer:'',country:'',line:'',category:'',license:'',mode:'',status:''},
  phaseFilter:'',riskOnly:false,transitOnly:false,measure:'qty',collapsed:false,fullscreen:false,filterOpen:false,
  panX:0,panY:0,zoom2d:1,rotLon:18,rotLat:-12,zoom3d:1,drag:null,hover:null,hitTargets:[],
  frame:0,lastFrame:0,lastBacklogRows:null,lastBacklogSignature:'',observers:[],
  worldPolygons:[],worldLoading:true,worldError:'',transitRules:[],transitRulesLoaded:false,
  expandedNodeKey:'',lastDragMoved:false,orbHandle:null
};

function loadPrefs(){
  try{
    const raw=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'{}')||{};
    if(['cp','orders','backlog','combined'].includes(raw.source))state.source=raw.source;
    if(raw.view==='2d'||raw.view==='3d')state.view=raw.view;
    if(raw.measure==='qty'||raw.measure==='orders')state.measure=raw.measure;
    if(raw.filters&&typeof raw.filters==='object')Object.keys(state.filters).forEach(key=>{if(typeof raw.filters[key]==='string')state.filters[key]=raw.filters[key];});
    state.phaseFilter=['production','ready','transit','arrived'].includes(raw.phaseFilter)?raw.phaseFilter:'';
    state.riskOnly=Boolean(raw.riskOnly);state.transitOnly=Boolean(raw.transitOnly);state.collapsed=Boolean(raw.collapsed);
  }catch(_){}
}
function savePrefs(){
  try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify({
    source:state.source,view:state.view,measure:state.measure,filters:state.filters,phaseFilter:state.phaseFilter,riskOnly:state.riskOnly,transitOnly:state.transitOnly,collapsed:state.collapsed
  }));}catch(_){}
}

function tableRows(tableId,source){
  const table=$(tableId);if(!table)return [];
  const headerRow=table.tHead&&table.tHead.rows.length?table.tHead.rows[table.tHead.rows.length-1]:table.querySelector('thead tr:last-child');
  const headers=headerRow?[...headerRow.cells].map(cell=>clean(cell.dataset&&cell.dataset.colLabel||cell.getAttribute('data-title')||cell.textContent)):[];
  const rows=[];
  [...(table.tBodies&&table.tBodies[0]?table.tBodies[0].rows:table.querySelectorAll('tbody tr'))].forEach((tr,rowIndex)=>{
    if(tr.hidden||tr.classList.contains('groupRow')||tr.classList.contains('subtotal'))return;
    const cells=[...tr.cells];if(!cells.length)return;
    const obj={};
    cells.forEach((cell,i)=>{
      const control=cell.querySelector&&cell.querySelector('input:not([type="checkbox"]),select,textarea');
      const value=control&&control.value!=null?control.value:clean(cell.textContent);
      obj[headers[i]||('Column '+(i+1))]=value;
    });
    const rec=normalizeRecord(obj,source,rowIndex);
    if(rec.orderCode||rec.model||rec.country||rec.status)rows.push(rec);
  });
  return rows;
}
function backlogSignature(){
  try{return typeof backlogExportQueryParams==='function'?JSON.stringify(backlogExportQueryParams()):'';}catch(_){return '';}
}
async function backlogRows(force){
  const signature=backlogSignature();
  if(!force&&state.lastBacklogRows&&signature===state.lastBacklogSignature)return state.lastBacklogRows.slice();
  if(typeof backlogExportQueryParams!=='function')return [];
  const params=backlogExportQueryParams()||{};
  const response=await fetch('/api/backlog-export?'+new URLSearchParams(params).toString(),{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data&&data.error?data.error:'HTTP '+response.status);
  const rows=(Array.isArray(data.rows)?data.rows:[]).map((row,index)=>normalizeRecord(row,'backlog',index));
  state.lastBacklogRows=rows;state.lastBacklogSignature=signature;return rows.slice();
}
async function sourceRows(source,force){
  if(window.BLGlobalFlowDataProviders&&typeof window.BLGlobalFlowDataProviders[source]==='function'){
    const provided=await window.BLGlobalFlowDataProviders[source]();
    return (Array.isArray(provided)?provided:[]).map((row,index)=>row&&row.source?row:normalizeRecord(row,source,index));
  }
  if(source==='cp')return tableRows('cpTable','cp');
  if(source==='orders')return tableRows('ordersTable','orders');
  if(source==='backlog')return backlogRows(force);
  const parts=await Promise.all([
    Promise.resolve(tableRows('cpTable','cp')),
    Promise.resolve(tableRows('ordersTable','orders')),
    backlogRows(force).catch(()=>[])
  ]);
  return dedupeRecords(parts.flat());
}
async function loadWorldTopology(){
  if(state.worldPolygons.length){state.worldLoading=false;return state.worldPolygons;}
  state.worldLoading=true;syncLoadingOverlay();
  try{
    const response=await fetch('vendor/world-atlas-countries-110m.json',{cache:'force-cache'});if(!response.ok)throw new Error('HTTP '+response.status);
    const topology=await response.json();state.worldPolygons=decodeWorldTopology(topology);if(!state.worldPolygons.length)throw new Error('World topology is empty');state.worldError='';
  }catch(error){state.worldError=String(error&&error.message||error);}
  finally{state.worldLoading=false;syncLoadingOverlay();scheduleDraw();}
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
async function refresh(force){
  state.loading=true;state.error='';state.warning='';renderMeta();syncLoadingOverlay();
  try{
    const results=await Promise.all([sourceRows(state.source,Boolean(force)),loadTransitRules(Boolean(force)),loadWorldTopology()]),rows=results[0];
    state.records=state.source==='combined'?dedupeRecords(rows):rows;hydrateFilterValidity();
    const unknown=state.records.filter(r=>!r.origin&&r.state!=='arrived').length;
    if(unknown)state.warning=L(unknown+' kayıtta üretim ülkesi haritada eşleşmedi.',unknown+' records have an origin country that could not be mapped.');
    if(state.worldError)state.warning=(state.warning?state.warning+' · ':'')+L('Detaylı dünya sınırı yüklenemedi; yedek harita kullanılıyor.','Detailed world outline could not be loaded; fallback map is in use.');
    if(!state.records.length)state.warning=L('Seçili kaynakta haritada gösterilebilir satır yok. Kaynak ekranın verisinin yüklenmiş olduğundan emin olun.','No mappable rows are available in the selected source. Make sure the source screen has loaded its data.');
    applyFilters();
  }catch(error){state.records=[];state.filtered=[];state.groups=[];state.error=String(error&&error.message||error);}
  finally{state.loading=false;renderControls();renderMeta();syncLoadingOverlay();scheduleDraw();}
}
function filterMatch(rec){
  const f=state.filters;
  if(f.search){
    const hay=norm([rec.orderCode,rec.model,rec.colourCode,rec.buyer,rec.manufacturer,rec.status,rec.country].join(' '));
    if(!hay.includes(norm(f.search)))return false;
  }
  for(const key of ['season','mag','mmyg','buyer','buyingGroup','manufacturer','country','line','category','license','mode','status']){
    if(f[key]&&clean(rec[key])!==f[key])return false;
  }
  if(state.phaseFilter&&rec.state!==state.phaseFilter)return false;
  if(state.riskOnly&&rec.risk==='none')return false;
  if(state.transitOnly&&rec.state!=='transit')return false;
  return true;
}
function hydrateFilterValidity(){
  for(const key of ['season','mag','mmyg','buyer','buyingGroup','manufacturer','country','line','category','license','mode','status']){
    if(state.filters[key]&&!uniqueValues(state.records,key).includes(state.filters[key]))state.filters[key]='';
  }
  savePrefs();
}
function applyFilters(renderPanel=true){
  state.filtered=state.records.filter(filterMatch);
  state.groups=aggregateRecords(state.filtered);
  if(renderPanel!==false)renderFilters();
  renderControls();renderKpis();renderMeta();scheduleDraw();
}
function sourceLabel(source){return ({cp:'CP',orders:'Orders',backlog:'Backlog',combined:L('Birleşik','Combined')})[source]||source;}
function stateLabel(value){return ({
  production:L('Üretimde','In production'),ready:L('Sevke hazır','Ready to ship'),transit:L('Yolda','In transit'),arrived:L('İstanbul / depo','Istanbul / warehouse')
})[value]||value;}
function modeLabel(value){return ({
  sea:L('Gemi','Sea'),air:L('Uçak','Air'),road:L('Tır','Road'), 'sea-air':L('Gemi + Uçak','Sea + Air'),unknown:L('Belirsiz','Unknown')
})[value]||value;}
function renderControls(){
  const host=$('globalFlowControls');if(!host)return;
  host.innerHTML=
    '<label class="gfCompactField"><span>'+esc(L('Kaynak','Source'))+'</span><select id="globalFlowSource">'+
    [['backlog','Backlog'],['orders','Orders'],['cp','CP'],['combined',L('Birleşik','Combined')]].map(x=>'<option value="'+x[0]+'"'+(state.source===x[0]?' selected':'')+'>'+esc(x[1])+'</option>').join('')+
    '</select></label>'+
    '<div class="gfSegment" role="group" aria-label="'+esc(L('Harita görünümü','Map view'))+'"><button type="button" data-gf-view="2d" class="'+(state.view==='2d'?'active':'')+'">2D</button><button type="button" data-gf-view="3d" class="'+(state.view==='3d'?'active':'')+'">3D</button></div>'+
    '<label class="gfCompactField"><span>'+esc(L('Ölçü','Measure'))+'</span><select id="globalFlowMeasure"><option value="qty"'+(state.measure==='qty'?' selected':'')+'>'+esc(L('Adet','Units'))+'</option><option value="orders"'+(state.measure==='orders'?' selected':'')+'>'+esc(L('Sipariş','Orders'))+'</option></select></label>'+
    '<button type="button" class="tbtn gfIconBtn'+(activeFilterCount()?' hasActive':'')+'" id="globalFlowFilterBtn" aria-expanded="'+(state.filterOpen?'true':'false')+'" title="'+esc(L('Harita filtreleri','Map filters'))+'"><svg class="ic"><use href="#i-filter"/></svg><span>'+esc(L('Filtre','Filter'))+(activeFilterCount()?' · '+activeFilterCount():'')+'</span></button>'+
    '<button type="button" class="tbtn gfIconBtn" id="globalFlowRefreshBtn" title="'+esc(L('Harita verisini yenile','Refresh map data'))+'"><svg class="ic"><use href="#i-refresh"/></svg></button>'+
    '<button type="button" class="tbtn gfIconBtn" id="globalFlowResetViewBtn" title="'+esc(L('Harita konumunu sıfırla','Reset map position'))+'"><svg class="ic"><use href="#i-globe"/></svg></button>'+
    '<button type="button" class="tbtn gfIconBtn" id="globalFlowFullscreenBtn" title="'+esc(state.fullscreen?L('Tam ekrandan çık','Exit fullscreen'):L('Tam ekran','Fullscreen'))+'">'+(state.fullscreen?'↙':'↗')+'</button>';
  $('globalFlowSource')?.addEventListener('change',event=>{state.source=event.target.value;savePrefs();void refresh(false);});
  host.querySelectorAll('[data-gf-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.gfView;state.drag=null;savePrefs();renderControls();scheduleDraw();}));
  $('globalFlowMeasure')?.addEventListener('change',event=>{state.measure=event.target.value;savePrefs();renderKpis();scheduleDraw();});
  $('globalFlowFilterBtn')?.addEventListener('click',()=>{state.filterOpen=!state.filterOpen;renderFilters();renderControls();});
  $('globalFlowRefreshBtn')?.addEventListener('click',()=>void refresh(true));
  $('globalFlowResetViewBtn')?.addEventListener('click',resetView);
  $('globalFlowFullscreenBtn')?.addEventListener('click',toggleFullscreen);
}
function activeFilterCount(){
  return Object.values(state.filters).filter(Boolean).length+(state.phaseFilter?1:0)+(state.riskOnly?1:0)+(state.transitOnly?1:0);
}
function filterOptions(key,label){
  const values=key==='mode'
    ?uniqueValues(state.records,key).filter(Boolean)
    :uniqueValues(state.records,key);
  return '<label class="gfFilterField"><span>'+esc(label)+'</span><select data-gf-filter="'+esc(key)+'"><option value="">'+esc(L('Tümü','All'))+'</option>'+
    values.map(value=>'<option value="'+esc(value)+'"'+(state.filters[key]===value?' selected':'')+'>'+esc(key==='mode'?modeLabel(value):value)+'</option>').join('')+
    '</select></label>';
}
function renderFilters(){
  const panel=$('globalFlowFilters');if(!panel)return;
  panel.hidden=!state.filterOpen;
  if(!state.filterOpen)return;
  panel.innerHTML=
    '<label class="gfFilterField gfFilterSearch"><span>'+esc(L('Ara','Search'))+'</span><input type="search" data-gf-search value="'+esc(state.filters.search)+'" placeholder="'+esc(L('Sipariş, model, üretici…','Order, model, supplier…'))+'"></label>'+
    filterOptions('season',L('Sezon','Season'))+filterOptions('mag','MAG')+filterOptions('mmyg','MMYG')+filterOptions('buyer','Buyer')+
    filterOptions('buyingGroup','Buyer Group')+filterOptions('manufacturer',L('Üretici','Supplier'))+
    filterOptions('country',L('Ülke','Country'))+filterOptions('line','Line')+filterOptions('category',L('Kategori','Category'))+filterOptions('license',L('Lisans','License'))+
    filterOptions('mode',L('Taşıma','Transport'))+filterOptions('status',L('Statü','Status'))+
    '<label class="gfCheck"><input type="checkbox" data-gf-flag="transitOnly"'+(state.transitOnly?' checked':'')+'><span>'+esc(L('Yalnız yoldakiler','In transit only'))+'</span></label>'+
    '<label class="gfCheck"><input type="checkbox" data-gf-flag="riskOnly"'+(state.riskOnly?' checked':'')+'><span>'+esc(L('Yalnız riskliler','Risk only'))+'</span></label>'+
    '<button type="button" class="tbtn" data-gf-clear>'+esc(L('Filtreleri temizle','Clear filters'))+'</button>';
  panel.querySelector('[data-gf-search]')?.addEventListener('input',event=>{state.filters.search=event.target.value;savePrefs();applyFilters(false);});
  panel.querySelectorAll('[data-gf-filter]').forEach(select=>select.addEventListener('change',()=>{state.filters[select.dataset.gfFilter]=select.value;savePrefs();applyFilters();}));
  panel.querySelectorAll('[data-gf-flag]').forEach(input=>input.addEventListener('change',()=>{
    if(input.dataset.gfFlag==='riskOnly')state.riskOnly=input.checked;
    if(input.dataset.gfFlag==='transitOnly')state.transitOnly=input.checked;
    savePrefs();applyFilters();
  }));
  panel.querySelector('[data-gf-clear]')?.addEventListener('click',()=>{
    Object.keys(state.filters).forEach(key=>state.filters[key]='');state.phaseFilter='';state.riskOnly=false;state.transitOnly=false;savePrefs();applyFilters();renderControls();
  });
}
function renderKpis(){
  const host=$('globalFlowKpis');if(!host)return;
  const totals={production:0,ready:0,transit:0,arrived:0,risk:0};
  const orders={production:0,ready:0,transit:0,arrived:0,risk:0};
  state.filtered.forEach(rec=>{
    const q=Number(rec.qty)||0;totals[rec.state]=(totals[rec.state]||0)+q;orders[rec.state]=(orders[rec.state]||0)+1;
    if(rec.risk!=='none'){totals.risk+=q;orders.risk++;}
  });
  const val=key=>state.measure==='orders'?orders[key]:totals[key];
  const cards=[
    ['production',stateLabel('production')],['ready',stateLabel('ready')],['transit',stateLabel('transit')],['arrived',stateLabel('arrived')],['risk',L('Riskli','At risk')]
  ];
  host.innerHTML=cards.map(([key,label])=>'<button type="button" class="gfKpi gfKpi--'+key+(state.phaseFilter===key||key==='risk'&&state.riskOnly?' active':'')+'" data-gf-kpi="'+key+'"><span>'+esc(label)+'</span><b>'+esc(nf().format(val(key)||0))+'</b></button>').join('');
  host.querySelectorAll('[data-gf-kpi]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.gfKpi;
    if(key==='risk')state.riskOnly=!state.riskOnly;
    else state.phaseFilter=state.phaseFilter===key?'':key;
    savePrefs();applyFilters();renderControls();
  }));
}
function renderMeta(){
  const meta=$('globalFlowMeta');if(!meta)return;
  if(state.loading||state.worldLoading){meta.textContent=L('Harita verisi ve coğrafya hazırlanıyor…','Preparing map data and geography…');meta.dataset.tone='loading';return;}
  if(state.error){meta.textContent=L('Harita verisi alınamadı: ','Could not load map data: ')+state.error;meta.dataset.tone='error';return;}
  const totalQty=state.filtered.reduce((sum,r)=>sum+(Number(r.qty)||0),0);
  meta.textContent=sourceLabel(state.source)+' · '+nf().format(state.filtered.length)+' '+L('kayıt','records')+' · '+nf().format(totalQty)+' '+L('adet','units')+(state.warning?' · '+state.warning:'');
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
  if(!state.collapsed)scheduleDraw();
}
function toggleFullscreen(){
  state.fullscreen=!state.fullscreen;
  const widget=$('globalFlowMapWidget');if(widget)widget.classList.toggle('is-fullscreen',state.fullscreen);
  document.body.classList.toggle('gfFullscreenOpen',state.fullscreen);
  renderControls();setTimeout(()=>{resizeCanvas();scheduleDraw();},0);
}
function resetView(){
  state.panX=0;state.panY=0;state.zoom2d=1;state.rotLon=18;state.rotLat=-12;state.zoom3d=1;scheduleDraw();
}
function palette(){
  const style=getComputedStyle(document.documentElement);
  const css=(name,fallback)=>clean(style.getPropertyValue(name))||fallback;
  return {
    water:css('--card2','#edf2f7'),land:css('--card','#ffffff'),line:css('--line','#d8dee8'),
    ink:css('--ink','#1f2937'),muted:css('--muted','#6b7280'),acc:css('--acc','#3f6488'),
    green:css('--green','#16845b'),red:css('--red','#c04455'),orange:css('--orange','#c47a20'),
    cyan:'#0891b2',purple:'#7c5ce0'
  };
}
function canvasInfo(){
  const canvas=$('globalFlowCanvas');if(!canvas)return null;
  const rect=canvas.getBoundingClientRect(),dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
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
function xyz(point){
  const lat=Number(point.lat)*Math.PI/180,lon=Number(point.lon)*Math.PI/180;
  const c=Math.cos(lat);return {x:c*Math.sin(lon),y:Math.sin(lat),z:c*Math.cos(lon)};
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
function geoInterpolate(a,b,t){
  const av=xyz(a),bv=xyz(b);let dot=av.x*bv.x+av.y*bv.y+av.z*bv.z;dot=Math.max(-1,Math.min(1,dot));
  const omega=Math.acos(dot),sin=Math.sin(omega);
  let x,y,z;
  if(sin<1e-6){x=av.x+(bv.x-av.x)*t;y=av.y+(bv.y-av.y)*t;z=av.z+(bv.z-av.z)*t;}
  else {const aa=Math.sin((1-t)*omega)/sin,bb=Math.sin(t*omega)/sin;x=av.x*aa+bv.x*bb;y=av.y*aa+bv.y*bb;z=av.z*aa+bv.z*bb;}
  const lat=Math.atan2(y,Math.hypot(x,z))*180/Math.PI,lon=Math.atan2(x,z)*180/Math.PI;
  return {lat,lon};
}
function worldPolygons(){return state.worldPolygons.length?state.worldPolygons:LAND.map(ring=>[ring.map(xy=>[xy[0],xy[1]])]);}
function drawLand2d(ctx,w,h,p){
  ctx.fillStyle=p.land;ctx.strokeStyle=p.line;ctx.lineWidth=.7;
  worldPolygons().forEach(polygon=>{
    ctx.beginPath();polygon.forEach(ring=>{
      let started=false,last=null;ring.forEach(xy=>{
        const q=project2d({lon:xy[0],lat:xy[1]},w,h);
        if(!started||(last&&Math.abs(q.x-last.x)>w*.55*state.zoom2d)){ctx.moveTo(q.x,q.y);started=true;}else ctx.lineTo(q.x,q.y);last=q;
      });if(started)ctx.closePath();
    });
    try{ctx.fill('evenodd');}catch(_){ctx.fill();}ctx.stroke();
  });
  const target=project2d(ISTANBUL,w,h);drawTarget(ctx,target,p);
}
function drawLand3d(ctx,w,h,p){
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
function modeColor(mode,p){return mode==='air'?p.purple:mode==='sea'?p.cyan:mode==='road'?p.orange:mode==='sea-air'?p.acc:p.muted;}
function geographicLegs(group){
  const origin=group&&group.origin;if(!origin)return [];
  if(group.mode==='sea')return [{mode:'sea',points:seaRouteCoordinates(origin.name)}];
  if(group.mode==='sea-air'){const sea=seaAirRouteCoordinates(origin.name),hub=sea[sea.length-1]||{lon:55.03,lat:25};return [{mode:'sea',points:sea},{mode:'air',points:[hub,ISTANBUL]}];}
  return [{mode:group.mode||'unknown',points:[origin,ISTANBUL]}];
}
function routePoints(group,w,h){
  const legs=geographicLegs(group),out=[];
  legs.forEach((leg,legIndex)=>{
    const source=Array.isArray(leg.points)?leg.points:[];
    for(let segment=1;segment<source.length;segment++){
      const a=source[segment-1],b=source[segment],steps=leg.mode==='sea'?Math.max(2,Math.round(Math.hypot(Number(b.lon)-Number(a.lon),Number(b.lat)-Number(a.lat))/3)):14;
      for(let i=segment===1?0:1;i<=steps;i++){
        const t=i/steps,geo=geoInterpolate(a,b,t),q=state.view==='3d'?project3d(geo,w,h,leg.mode==='air'?Math.sin(Math.PI*t)*.065:0):project2d(geo,w,h);
        if(q&&q.visible)out.push({x:q.x,y:q.y,mode:leg.mode,legIndex,geo});
      }
    }
  });
  return out;
}
function positionAlongPolyline(points,progress){
  if(!points||!points.length)return null;if(points.length===1)return {...points[0],index:0};
  const lengths=[],totals=[];let total=0;
  for(let i=1;i<points.length;i++){const length=points[i].legIndex===points[i-1].legIndex?Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y):0;lengths[i]=length;total+=length;totals[i]=total;}
  if(total<=0)return {...points[0],index:0};const target=Math.max(0,Math.min(1,progress))*total;
  for(let i=1;i<points.length;i++){if(!lengths[i])continue;const before=totals[i]-lengths[i];if(target<=totals[i]){const t=Math.max(0,Math.min(1,(target-before)/lengths[i]));return {x:points[i-1].x+(points[i].x-points[i-1].x)*t,y:points[i-1].y+(points[i].y-points[i-1].y)*t,mode:points[i].mode,legIndex:points[i].legIndex,index:i,progress:target/total};}}
  return {...points[points.length-1],index:points.length-1,progress:1};
}
function shipmentUnits(group,points,now){
  const byFile=new Map();
  (group.records||[]).forEach(rec=>{
    const file=clean(rec.shipmentFile)||clean(rec.orderCode)||rec.id;if(!byFile.has(file))byFile.set(file,{file,records:[],qty:0,progresses:[],known:0,leadDays:[],elapsedDays:[]});
    const unit=byFile.get(file),meta=recordRouteProgress(rec,state.transitRules,now);unit.records.push(rec);unit.qty+=Number(rec.qty)||0;unit.progresses.push(meta.progress);unit.known+=meta.known?1:0;unit.leadDays.push(meta.leadDays);if(meta.elapsedDays!=null)unit.elapsedDays.push(meta.elapsedDays);
  });
  return [...byFile.values()].map(unit=>{
    unit.progress=unit.progresses.length?unit.progresses.reduce((a,b)=>a+b,0)/unit.progresses.length:.04;unit.leadDaysAvg=unit.leadDays.length?unit.leadDays.reduce((a,b)=>a+b,0)/unit.leadDays.length:null;unit.elapsedDaysAvg=unit.elapsedDays.length?unit.elapsedDays.reduce((a,b)=>a+b,0)/unit.elapsedDays.length:null;
    unit.point=positionAlongPolyline(points,unit.progress);unit.mode=unit.point&&unit.point.mode||group.mode;return unit;
  }).filter(unit=>unit.point);
}
function clusterVehicleUnits(units,radius){
  const clusters=[];
  (units||[]).forEach(unit=>{
    let best=null,bestD=Infinity;clusters.forEach(cluster=>{const d=Math.hypot(cluster.x-unit.point.x,cluster.y-unit.point.y);if(d<=radius&&d<bestD){best=cluster;bestD=d;}});
    if(!best){best={x:unit.point.x,y:unit.point.y,units:[],records:[],files:[],qty:0,modes:new Set(),progresses:[],known:0,leadDays:[],elapsedDays:[]};clusters.push(best);}
    best.units.push(unit);best.records.push(...unit.records);best.files.push(unit.file);best.qty+=unit.qty;best.modes.add(unit.mode);best.progresses.push(unit.progress);best.known+=unit.known;if(unit.leadDaysAvg!=null)best.leadDays.push(unit.leadDaysAvg);if(unit.elapsedDaysAvg!=null)best.elapsedDays.push(unit.elapsedDaysAvg);
    const count=best.units.length;best.x=(best.x*(count-1)+unit.point.x)/count;best.y=(best.y*(count-1)+unit.point.y)/count;
  });
  clusters.forEach(cluster=>{cluster.progress=cluster.progresses.reduce((a,b)=>a+b,0)/Math.max(1,cluster.progresses.length);cluster.mode=cluster.modes.size===1?[...cluster.modes][0]:'mixed';cluster.leadDays=cluster.leadDays.length?cluster.leadDays.reduce((a,b)=>a+b,0)/cluster.leadDays.length:null;cluster.elapsedDays=cluster.elapsedDays.length?cluster.elapsedDays.reduce((a,b)=>a+b,0)/cluster.elapsedDays.length:null;});
  return clusters;
}
function drawVehicle(ctx,point,mode,color,count){
  if(!point)return;ctx.save();ctx.translate(point.x,point.y);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.shadowColor='rgba(0,0,0,.22)';ctx.shadowBlur=4;
  if(mode==='air'){ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-6,-4);ctx.lineTo(-2,0);ctx.lineTo(-6,4);ctx.closePath();ctx.fill();}
  else if(mode==='sea'){ctx.beginPath();ctx.moveTo(-7,-2);ctx.lineTo(7,-2);ctx.lineTo(4,5);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.fillRect(-1,-7,3,5);}
  else if(mode==='road'){ctx.fillRect(-7,-4,10,6);ctx.fillRect(3,-2,5,4);ctx.beginPath();ctx.arc(-4,3,2,0,Math.PI*2);ctx.arc(5,3,2,0,Math.PI*2);ctx.fill();}
  else {ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();}
  ctx.shadowBlur=0;
  if(Number(count)>1){const card=pColorForBadge();ctx.fillStyle=color;ctx.strokeStyle=card;ctx.lineWidth=1;ctx.beginPath();ctx.arc(8,-8,7,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=card;ctx.font='700 8px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(count),8,-8);}
  ctx.restore();
}
function pColorForBadge(){try{return getComputedStyle(document.documentElement).getPropertyValue('--card').trim()||'#fff';}catch(_){return '#fff';}}
function routeStroke(ctx,points,color,width,mode,alpha){
  ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=alpha==null ? .72 : alpha;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
  if(mode==='road')ctx.setLineDash([5,4]);else if(mode==='sea')ctx.setLineDash([2,4]);else ctx.setLineDash([]);
  ctx.beginPath();points.forEach((q,i)=>{if(i===0||points[i-1].legIndex!==q.legIndex)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();ctx.restore();
}
const STAGE_META={
  PRODUCTION:{tr:'Üretimde',en:'In production',glyph:'P'},LOADING:{tr:'Yükleme Operasyonları',en:'Loading Operations',glyph:'L'},
  CUSTOMS:{tr:'Gümrük Operasyonları',en:'Customs Operation',glyph:'C'},IN_WAREHOUSE:{tr:'Depoda',en:'In Warehouse',glyph:'W'},
  AWAITING_RETAIL_TRANSFER:{tr:'Retail Aktarım Bekliyor',en:'Awaiting Retail Transfer',glyph:'R'}
};
function stageLabel(stage){const meta=STAGE_META[stage];return meta?(isEn()?meta.en:meta.tr):stage;}
function nodeBundles(){
  const origins=new Map(),arrival={key:'arrival:istanbul',kind:'arrival',location:ISTANBUL,records:[],stages:new Map()};
  state.filtered.forEach(rec=>{
    const stage=rec.operationalStage||operationalStage(rec.status);
    if(stage==='CUSTOMS'||stage==='IN_WAREHOUSE'||stage==='AWAITING_RETAIL_TRANSFER'){arrival.records.push(rec);if(!arrival.stages.has(stage))arrival.stages.set(stage,[]);arrival.stages.get(stage).push(rec);return;}
    if((stage==='PRODUCTION'||stage==='LOADING'||rec.state==='production'||rec.state==='ready')&&rec.origin){
      const key='origin:'+rec.origin.name;if(!origins.has(key))origins.set(key,{key,kind:'origin',location:rec.origin,records:[],stages:new Map()});
      const bundle=origins.get(key);bundle.records.push(rec);if(stage==='PRODUCTION'||stage==='LOADING'){if(!bundle.stages.has(stage))bundle.stages.set(stage,[]);bundle.stages.get(stage).push(rec);}
    }
  });
  const out=[...origins.values()];if(arrival.records.length)out.push(arrival);return out;
}
function screenPoint(location,w,h){return state.view==='3d'?project3d(location,w,h,0):project2d(location,w,h);}
function drawStageIcon(ctx,x,y,stage,p){
  const meta=STAGE_META[stage]||{glyph:'•'},color=stage==='PRODUCTION'?p.acc:stage==='LOADING'?p.orange:stage==='CUSTOMS'?p.red:stage==='IN_WAREHOUSE'?p.green:p.purple;
  ctx.save();ctx.fillStyle=p.land;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.font='800 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(meta.glyph,x,y+.5);ctx.restore();
}
function drawNodeBundles(ctx,w,h,p){
  nodeBundles().forEach(bundle=>{
    const q=screenPoint(bundle.location,w,h);if(!q||!q.visible)return;const expanded=state.expandedNodeKey===bundle.key,baseColor=bundle.kind==='arrival'?p.green:p.acc,radius=5+Math.min(6,Math.log10(1+bundle.records.length)*2);
    ctx.save();ctx.fillStyle=baseColor;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(q.x,q.y,radius+8,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.95;ctx.beginPath();ctx.arc(q.x,q.y,radius,0,Math.PI*2);ctx.fill();ctx.restore();
    state.hitTargets.push({type:'node',x:q.x,y:q.y,r:expanded?46:18,bundle,records:bundle.records,priority:70});
    if(!expanded)return;
    const stages=bundle.kind==='arrival'?['AWAITING_RETAIL_TRANSFER','CUSTOMS','IN_WAREHOUSE']:['PRODUCTION','LOADING'],available=stages.filter(stage=>(bundle.stages.get(stage)||[]).length),offsets=available.length===3?[[-28,-30],[0,-38],[28,-30]]:available.length===2?[[-18,-30],[18,-30]]:[[0,-32]];
    available.forEach((stage,index)=>{const records=bundle.stages.get(stage)||[],offset=offsets[index]||[0,-32],x=q.x+offset[0],y=q.y+offset[1];drawStageIcon(ctx,x,y,stage,p);state.hitTargets.push({type:'stage',x,y,r:14,stage,nodeKey:bundle.key,records,priority:100});});
  });
}
function drawRoutes(ctx,w,h,p,now){
  state.hitTargets=[];
  state.groups.forEach(group=>{
    if(group.state!=='transit'||!group.origin)return;const points=routePoints(group,w,h);if(points.length<2)return;
    const color=modeColor(group.mode,p),width=1.35+Math.min(5,Math.log10(1+group.qty)*.7);routeStroke(ctx,points,color,width,group.mode,.68);
    state.hitTargets.push({type:'route',points,group,records:group.records,r:Math.max(8,width+5),priority:10});
    clusterVehicleUnits(shipmentUnits(group,points,Date.now()),20).forEach(cluster=>{const point={x:cluster.x,y:cluster.y};drawVehicle(ctx,point,cluster.mode==='mixed'?group.mode:cluster.mode,color,cluster.units.length);state.hitTargets.push({type:'vehicle',x:cluster.x,y:cluster.y,r:18,cluster,group,records:cluster.records,priority:90});});
  });
  drawNodeBundles(ctx,w,h,p);
}
function hash(value){let h=0;for(const ch of String(value||''))h=((h<<5)-h)+ch.charCodeAt(0)|0;return h;}
function draw(now){
  state.frame=0;if(document.hidden||state.collapsed)return;const info=canvasInfo();if(!info)return;
  const {ctx,w,h}=info,p=palette();ctx.clearRect(0,0,w,h);ctx.fillStyle=p.water;ctx.fillRect(0,0,w,h);
  if(state.view==='3d')drawLand3d(ctx,w,h,p);else drawLand2d(ctx,w,h,p);drawRoutes(ctx,w,h,p,now||performance.now());if(state.hover)drawHoverHighlight(ctx,state.hover,p);
  if(state.groups.some(g=>g.state==='transit')||state.expandedNodeKey)state.frame=requestAnimationFrame(throttledDraw);
}
function throttledDraw(now){if(now-state.lastFrame<50){state.frame=requestAnimationFrame(throttledDraw);return;}state.lastFrame=now;draw(now);}
function scheduleDraw(){if(state.frame)cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(draw);}
function resizeCanvas(){scheduleDraw();}
function nearestHit(x,y){
  let best=null,bestPriority=-Infinity,bestDistance=Infinity;
  state.hitTargets.forEach(hit=>{
    const distance=hit.type==='route'?distanceToPolyline(x,y,hit.points):Math.hypot((hit.x||0)-x,(hit.y||0)-y);if(distance>Number(hit.r||10))return;
    const priority=Number(hit.priority)||0;if(priority>bestPriority||(priority===bestPriority&&distance<bestDistance)){best=hit;bestPriority=priority;bestDistance=distance;}
  });
  return best;
}
function drawHoverHighlight(ctx,hit,p){
  if(hit.type==='route'){routeStroke(ctx,hit.points,p.ink,Math.max(3,Number(hit.r||8)/2),'unknown',.45);return;}
  ctx.save();ctx.strokeStyle=p.ink;ctx.globalAlpha=.55;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(hit.x,hit.y,Math.min(24,Number(hit.r||10)+3),0,Math.PI*2);ctx.stroke();ctx.restore();
}
function canvasPoint(event){const canvas=$('globalFlowCanvas'),rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
function totalOf(records,key){return (records||[]).reduce((sum,row)=>sum+(key==='qty'?(Number(row.qty)||0):1),0);}
function showTooltip(hit,event){
  const tip=$('globalFlowTooltip');if(!tip)return;if(!hit){tip.hidden=true;return;}let title='',lines=[],risk=false;
  if(hit.type==='vehicle'){
    const c=hit.cluster,files=c.files.filter(Boolean);title=files.length===1?files[0]:files.slice(0,2).join(' + ')+(files.length>2?' +'+(files.length-2):'');
    lines.push(modeLabel(c.mode==='mixed'?hit.group.mode:c.mode)+' · '+Math.round(c.progress*100)+'% '+L('yol ilerlemesi','route progress'));if(c.elapsedDays!=null&&c.leadDays!=null)lines.push(Math.floor(c.elapsedDays)+' / '+Math.round(c.leadDays)+' '+L('gün','days'));lines.push(nf().format(c.records.length)+' '+L('sipariş','orders')+' · '+nf().format(c.qty)+' '+L('adet','units'));risk=c.records.some(r=>r.risk!=='none');
  }else if(hit.type==='route'){title=(hit.group.origin?hit.group.origin.name:L('Bilinmiyor','Unknown'))+' → İstanbul';lines.push(modeLabel(hit.group.mode)+' · '+nf().format(hit.records.length)+' '+L('sipariş','orders'));lines.push(nf().format(hit.group.qty)+' '+L('adet','units'));risk=hit.group.risk!=='none';}
  else if(hit.type==='stage'){title=stageLabel(hit.stage);lines.push(nf().format(hit.records.length)+' '+L('sipariş','orders')+' · '+nf().format(totalOf(hit.records,'qty'))+' '+L('adet','units'));if(hit.nodeKey==='arrival:istanbul')lines.push('İstanbul');}
  else if(hit.type==='node'){title=hit.bundle.kind==='arrival'?'İstanbul':hit.bundle.location.name;const parts=[...hit.bundle.stages.entries()].map(entry=>stageLabel(entry[0])+' '+nf().format(entry[1].length));lines.push(parts.join(' · ')||nf().format(hit.records.length)+' '+L('sipariş','orders'));lines.push(L('Durum simgeleri için üzerinde kalın.','Keep hovering to reveal status icons.'));}
  tip.innerHTML='<b>'+esc(title||L('Detay','Detail'))+'</b>'+lines.map(line=>'<span>'+esc(line)+'</span>').join('')+(risk?'<em>'+esc(L('Risk sinyali var','Risk signal present'))+'</em>':'');
  const wrap=$('globalFlowCanvasWrap').getBoundingClientRect();tip.style.left=Math.min(wrap.width-240,Math.max(8,event.clientX-wrap.left+12))+'px';tip.style.top=Math.min(wrap.height-118,Math.max(8,event.clientY-wrap.top+12))+'px';tip.hidden=false;
}
function onPointerDown(event){
  if(event.button!==0)return;const p=canvasPoint(event);state.lastDragMoved=false;state.drag={id:event.pointerId,x:p.x,y:p.y,panX:state.panX,panY:state.panY,rotLon:state.rotLon,rotLat:state.rotLat,moved:false};try{event.currentTarget.setPointerCapture(event.pointerId);}catch(_){}
}
function onPointerMove(event){
  const p=canvasPoint(event);
  if(state.drag&&state.drag.id===event.pointerId){const dx=p.x-state.drag.x,dy=p.y-state.drag.y;if(Math.hypot(dx,dy)>3)state.drag.moved=true;if(state.view==='3d'){state.rotLon=state.drag.rotLon+dx*.35;state.rotLat=Math.max(-78,Math.min(78,state.drag.rotLat-dy*.28));}else{state.panX=state.drag.panX+dx;state.panY=state.drag.panY+dy;}scheduleDraw();return;}
  const hit=nearestHit(p.x,p.y);if(hit&&hit.type==='node')state.expandedNodeKey=hit.bundle.key;else if(hit&&hit.nodeKey)state.expandedNodeKey=hit.nodeKey;else if(state.expandedNodeKey){const node=state.hitTargets.find(target=>target.type==='node'&&target.bundle&&target.bundle.key===state.expandedNodeKey);if(!node||Math.hypot(node.x-p.x,node.y-p.y)>48)state.expandedNodeKey='';}
  state.hover=hit;showTooltip(hit,event);scheduleDraw();
}
function onPointerUp(event){if(state.drag&&state.drag.id===event.pointerId){state.lastDragMoved=Boolean(state.drag.moved);state.drag=null;}}
function onWheel(event){event.preventDefault();const factor=event.deltaY>0?.9:1.1;if(state.view==='3d')state.zoom3d=Math.max(.65,Math.min(2.2,state.zoom3d*factor));else state.zoom2d=Math.max(.65,Math.min(4.5,state.zoom2d*factor));scheduleDraw();}
function detailColumns(records){
  const standard=[
    {key:'source',label:L('Kaynak','Source'),value:r=>sourceLabel(r.source)},{key:'shipmentFile',label:L('İhracat / İthalat Dosya No','Export / Import File No')},
    {key:'orderCode',label:L('Sipariş Kod','Order Code')},{key:'plmId',label:'PLM ID'},{key:'model',label:L('Model Adı','Model Name')},{key:'colourCode',label:L('Renk Kod','Colour Code')},{key:'colour',label:L('Renk','Colour')},
    {key:'season',label:L('Sezon','Season')},{key:'buyer',label:'Buyer'},{key:'buyingGroup',label:'Buying Group'},{key:'manufacturer',label:L('Üretici','Supplier')},{key:'country',label:L('Ülke','Country')},{key:'status',label:L('Statü','Status')},
    {key:'mode',label:L('Taşıma','Transport'),value:r=>modeLabel(r.mode)},{key:'qty',label:L('Adet','Qty')},{key:'handover',label:'Handover'},{key:'exFactory',label:'Ex-Factory'},{key:'eta',label:'ETA'},{key:'priority',label:L('Öncelik','Priority')}
  ];
  const labels=new Set(standard.map(col=>norm(col.label)).concat(standard.map(col=>norm(col.key)))),extras=[],seen=new Set();
  (records||[]).slice(0,40).forEach(rec=>Object.keys(rec&&rec.raw||{}).forEach(rawKey=>{const label=clean(rawKey),keyNorm=norm(label);if(!label||label.startsWith('_')||labels.has(keyNorm)||seen.has(keyNorm))return;seen.add(keyNorm);extras.push({key:'raw:'+rawKey,label,value:r=>r&&r.raw?r.raw[rawKey]:''});}));
  return standard.concat(extras);
}
function openRecordsDrawer(title,records,subtitle){
  const rows=(records||[]).filter(Boolean);if(!rows.length)return;
  if(window.BLDetailDrawer&&typeof window.BLDetailDrawer.open==='function'){
    const actions=rows.length===1?[{label:L('Kaynakta Aç','Open source'),run:()=>jumpToSource(rows[0])}]:[];
    window.BLDetailDrawer.open({storageKey:'overview.globalFlow.detail',source:'global-flow',title,subtitle:subtitle||'',rows,columns:detailColumns(rows),images:true,fileName:'Global_Flow_'+title,actions,note:L('Araç konumu canlı GPS/AIS değildir; Handover tarihi ve ülke/yükleme yol süresi kuralından hesaplanan operasyonel ilerlemedir.','Vehicle position is not live GPS/AIS; it is operational progress calculated from Handover date and the country/transport lead-time rule.')});return;
  }
  const drawer=$('globalFlowDrawer');if(!drawer)return;drawer.innerHTML='<div class="gfDrawerHead"><div><b>'+esc(title)+'</b><span>'+esc(subtitle||'')+'</span></div><button type="button" data-gf-drawer-close>×</button></div><div class="gfDrawerBody"><div class="gfDrawerTableWrap"><table class="gfDrawerTable"><thead><tr><th>'+esc(L('Sipariş','Order'))+'</th><th>'+esc(L('Model','Model'))+'</th><th>'+esc(L('Statü','Status'))+'</th><th>'+esc(L('Adet','Qty'))+'</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.orderCode||'—')+'</td><td>'+esc(r.model||'—')+'</td><td>'+esc(r.status||'—')+'</td><td class="num">'+nf().format(r.qty||0)+'</td></tr>').join('')+'</tbody></table></div></div>';
  drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');drawer.querySelector('[data-gf-drawer-close]')?.addEventListener('click',closeDrawer);
}
function openHitDetail(hit){
  if(!hit)return;
  if(hit.type==='vehicle'){const files=hit.cluster.files.filter(Boolean),title=files.length===1?files[0]:L('Gruplanmış sevkiyatlar','Grouped shipments')+' · '+files.length;openRecordsDrawer(title,hit.records,Math.round(hit.cluster.progress*100)+'% · '+modeLabel(hit.group.mode));return;}
  if(hit.type==='route'){openRecordsDrawer((hit.group.origin?hit.group.origin.name:L('Bilinmeyen çıkış','Unknown origin'))+' → İstanbul',hit.records,modeLabel(hit.group.mode));return;}
  if(hit.type==='stage'){openRecordsDrawer(stageLabel(hit.stage),hit.records,hit.nodeKey==='arrival:istanbul'?'İstanbul':'');return;}
  if(hit.type==='node')openRecordsDrawer(hit.bundle.kind==='arrival'?'İstanbul':hit.bundle.location.name,hit.records,L('Operasyon durumları','Operational stages'));
}
function openDrawer(group){if(group)openRecordsDrawer(group.origin?group.origin.name+' → İstanbul':stateLabel(group.state),group.records,modeLabel(group.mode));}
function closeDrawer(){const drawer=$('globalFlowDrawer');if(drawer){drawer.classList.remove('is-open');drawer.setAttribute('aria-hidden','true');}window.BLDetailDrawer?.close?.();}
function jumpToSource(rec){
  if(!rec)return;const tab=document.querySelector('nav.tabs button[data-tab="'+rec.source+'"]');if(tab)tab.click();const searchId=rec.source==='cp'?'cpSearch':rec.source==='orders'?'ordersSearch':'';
  if(searchId&&rec.orderCode)setTimeout(()=>{const input=$(searchId);if(!input)return;input.value=rec.orderCode;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();},80);closeDrawer();
}
function bindCanvas(){
  const canvas=$('globalFlowCanvas');if(!canvas||canvas.dataset.gfBound)return;canvas.dataset.gfBound='1';
  canvas.addEventListener('pointerdown',onPointerDown);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',onPointerUp);
  canvas.addEventListener('pointerleave',event=>{if(!state.drag){state.hover=null;state.expandedNodeKey='';showTooltip(null,event);scheduleDraw();}});
  canvas.addEventListener('wheel',onWheel,{passive:false});
  canvas.addEventListener('click',event=>{if(state.lastDragMoved){state.lastDragMoved=false;return;}const p=canvasPoint(event),hit=nearestHit(p.x,p.y);if(hit)openHitDetail(hit);});
  canvas.addEventListener('dblclick',event=>event.preventDefault());
}
function bindObservers(){
  ['cpTable','ordersTable'].forEach(id=>{
    const table=$(id);if(!table)return;const observer=new MutationObserver(()=>{
      if(state.source===id.replace('Table','')||state.source==='combined')clearTimeout(observer._timer),observer._timer=setTimeout(()=>void refresh(false),180);
    });observer.observe(table,{childList:true,subtree:true,characterData:true});state.observers.push(observer);
  });
  const themeObserver=new MutationObserver(scheduleDraw);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','lang']});state.observers.push(themeObserver);
  window.addEventListener('resize',resizeCanvas,{passive:true});
  document.addEventListener('bl:language-changed',()=>{renderAll();});
}
function renderAll(){renderControls();renderFilters();renderKpis();renderMeta();setCollapsed(state.collapsed);scheduleDraw();}
function init(){
  const widget=$('globalFlowMapWidget');if(!widget)return;loadPrefs();
  $('globalFlowCollapseBtn')?.addEventListener('click',()=>setCollapsed(!state.collapsed));
  bindCanvas();bindObservers();renderAll();syncLoadingOverlay();void refresh(false);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(state.fullscreen)toggleFullscreen();else closeDrawer();}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

return {
  ISTANBUL,FIELD_CANDIDATES,clean,norm,toNumber,pick,countryCoordinate,detectMode,operationalStage,classifyState,riskLevel,
  normalizeRecord,recordKey,dedupeRecords,aggregateRecords,uniqueValues,parseDateMs,resolveRecordTransitDays,recordRouteProgress,
  distancePointToSegment,distanceToPolyline,decodeWorldTopology,seaRouteCoordinates,seaAirRouteCoordinates,refresh:()=>refresh(true),resetView
};
});