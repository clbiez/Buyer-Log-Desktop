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
  model:['Model Adı','Model Name','Model','Style Name','Style'],
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
  exFactory:['REVİZE YÜKLEME TARİHİ (EX-FACTORY)','Revize Yükleme Tarihi','Orijinal Exfactory Merch Tarih','Ex-Factory','Ex Factory','Handover Date','Planned Ex-Factory'],
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
function classifyState(status,mode,raw){
  const s=norm(status);
  const idx=normalizedIndex(raw||{});
  const received=toNumber(idx[norm('Net Gelen Alım Sipariş Miktarı')])+
    toNumber(idx[norm('Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo')]);
  if(/tamam|completed|teslim|delivered|magaza|store/.test(s))return 'arrived';
  if(/antrepo|istanbul|warehouse|depo giris|depo giri|received|ulasti|varis|arrival/.test(s)||received>0)return 'arrived';
  if(/yolda|transit|sevk edildi|sevkedildi|departed|shipped|loaded|yukleme operasyon|yuklendi/.test(s))return 'transit';
  if(mode!=='unknown'&&/sevk|shipment|loading|yukleme|handover/.test(s))return 'transit';
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
    model:clean(pick(row,FIELD_CANDIDATES.model)),
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
    country:country,
    status:status,
    mode:mode,
    modeRaw:clean(pick(row,FIELD_CANDIDATES.mode)),
    qty:Math.max(0,toNumber(pick(row,FIELD_CANDIDATES.qty))),
    eta:clean(pick(row,FIELD_CANDIDATES.eta)),
    exFactory:clean(pick(row,FIELD_CANDIDATES.exFactory)),
    priority:clean(pick(row,FIELD_CANDIDATES.priority)),
    origin:origin,
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

if(typeof document==='undefined'){
  return {ISTANBUL,FIELD_CANDIDATES,clean,norm,toNumber,pick,countryCoordinate,detectMode,classifyState,riskLevel,normalizeRecord,recordKey,dedupeRecords,aggregateRecords,uniqueValues};
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
  frame:0,lastFrame:0,lastBacklogRows:null,lastBacklogSignature:'',observers:[]
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
async function refresh(force){
  state.loading=true;state.error='';state.warning='';renderMeta();
  try{
    const rows=await sourceRows(state.source,Boolean(force));
    state.records=state.source==='combined'?dedupeRecords(rows):rows;
    hydrateFilterValidity();
    const unknown=state.records.filter(r=>!r.origin&&r.state!=='arrived').length;
    if(unknown)state.warning=L(unknown+' kayıtta üretim ülkesi haritada eşleşmedi.',unknown+' records have an origin country that could not be mapped.');
    if(!state.records.length)state.warning=L('Seçili kaynakta haritada gösterilebilir satır yok. Kaynak ekranın verisinin yüklenmiş olduğundan emin olun.','No mappable rows are available in the selected source. Make sure the source screen has loaded its data.');
    applyFilters();
  }catch(error){
    state.records=[];state.filtered=[];state.groups=[];state.error=String(error&&error.message||error);
  }finally{state.loading=false;renderControls();renderMeta();scheduleDraw();}
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
  if(state.loading){meta.textContent=L('Harita verisi hazırlanıyor…','Preparing map data…');meta.dataset.tone='loading';return;}
  if(state.error){meta.textContent=L('Harita verisi alınamadı: ','Could not load map data: ')+state.error;meta.dataset.tone='error';return;}
  const totalQty=state.filtered.reduce((sum,r)=>sum+(Number(r.qty)||0),0);
  meta.textContent=sourceLabel(state.source)+' · '+nf().format(state.filtered.length)+' '+L('kayıt','records')+' · '+nf().format(totalQty)+' '+L('adet','units')+(state.warning?' · '+state.warning:'');
  meta.dataset.tone=state.warning?'warn':'normal';
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
function drawLand2d(ctx,w,h,p){
  ctx.fillStyle=p.land;ctx.strokeStyle=p.line;ctx.lineWidth=1;
  LAND.forEach(poly=>{
    ctx.beginPath();poly.forEach((xy,i)=>{const q=project2d({lon:xy[0],lat:xy[1]},w,h);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});
    ctx.closePath();ctx.fill();ctx.stroke();
  });
  const target=project2d(ISTANBUL,w,h);drawTarget(ctx,target,p);
}
function drawLand3d(ctx,w,h,p){
  const r=Math.min(w,h)*.42*state.zoom3d;
  ctx.save();ctx.beginPath();ctx.arc(w/2,h/2,r,0,Math.PI*2);ctx.clip();
  ctx.fillStyle=p.water;ctx.fillRect(w/2-r,h/2-r,r*2,r*2);
  ctx.fillStyle=p.land;ctx.strokeStyle=p.line;ctx.lineWidth=1;
  LAND.forEach(poly=>{
    let started=false;ctx.beginPath();
    poly.forEach(xy=>{const q=project3d({lon:xy[0],lat:xy[1]},w,h,0);if(!q.visible){started=false;return;}if(!started){ctx.moveTo(q.x,q.y);started=true;}else ctx.lineTo(q.x,q.y);});
    if(started){ctx.fill();ctx.stroke();}
  });
  ctx.restore();
  ctx.strokeStyle=p.line;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(w/2,h/2,r,0,Math.PI*2);ctx.stroke();
  const target=project3d(ISTANBUL,w,h,0);if(target.visible)drawTarget(ctx,target,p);
}
function drawTarget(ctx,q,p){
  if(!q||!q.visible)return;ctx.save();ctx.translate(q.x,q.y);
  ctx.fillStyle=p.red;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;ctx.fillStyle=p.red;ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();ctx.restore();
}
function modeColor(mode,p){return mode==='air'?p.purple:mode==='sea'?p.cyan:mode==='road'?p.orange:mode==='sea-air'?p.acc:p.muted;}
function routePoints(group,w,h){
  const start=group.origin,end=ISTANBUL;if(!start)return [];
  const transfer=group.mode==='sea-air'?geoInterpolate(start,end,.55):null;
  const legs=group.mode==='sea-air'?[[start,transfer,'sea'],[transfer,end,'air']]:[[start,end,group.mode]];
  const out=[];
  legs.forEach((leg,legIndex)=>{
    const a=leg[0],b=leg[1],mode=leg[2],steps=state.view==='3d'?34:28;
    for(let i=0;i<=steps;i++){
      const t=i/steps;let q;
      if(state.view==='3d'){const geo=geoInterpolate(a,b,t);q=project3d(geo,w,h,mode==='air'?Math.sin(Math.PI*t)*.07:Math.sin(Math.PI*t)*.025);}
      else{
        const pa=project2d(a,w,h),pb=project2d(b,w,h),bend=(mode==='air'?-.18:mode==='sea'?.12:.04)*Math.min(w,h);
        const cx=(pa.x+pb.x)/2,cy=(pa.y+pb.y)/2+bend;
        q={x:(1-t)*(1-t)*pa.x+2*(1-t)*t*cx+t*t*pb.x,y:(1-t)*(1-t)*pa.y+2*(1-t)*t*cy+t*t*pb.y,visible:true};
      }
      if(q.visible)out.push({x:q.x,y:q.y,mode,legIndex});
    }
  });
  return out;
}
function drawVehicle(ctx,point,mode,color){
  if(!point)return;ctx.save();ctx.translate(point.x,point.y);ctx.fillStyle=color;ctx.strokeStyle=color;
  if(mode==='air'){ctx.beginPath();ctx.moveTo(7,0);ctx.lineTo(-5,-4);ctx.lineTo(-2,0);ctx.lineTo(-5,4);ctx.closePath();ctx.fill();}
  else if(mode==='sea'){ctx.beginPath();ctx.moveTo(-6,-2);ctx.lineTo(6,-2);ctx.lineTo(3,4);ctx.lineTo(-4,4);ctx.closePath();ctx.fill();ctx.fillRect(-1,-6,3,4);}
  else if(mode==='road'){ctx.fillRect(-6,-4,9,6);ctx.fillRect(3,-2,4,4);ctx.beginPath();ctx.arc(-3,3,1.8,0,Math.PI*2);ctx.arc(4,3,1.8,0,Math.PI*2);ctx.fill();}
  else {ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();}
  ctx.restore();
}
function drawRoutes(ctx,w,h,p,now){
  state.hitTargets=[];
  const phase=(now%9000)/9000;
  state.groups.forEach(group=>{
    if(group.state==='transit'&&group.origin){
      const points=routePoints(group,w,h);if(points.length<2)return;
      const color=modeColor(group.mode,p);const width=1.3+Math.min(6,Math.log10(1+group.qty)*.8);
      ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=.6;ctx.lineWidth=width;
      if(group.mode==='road')ctx.setLineDash([4,4]);else if(group.mode==='sea')ctx.setLineDash([2,5]);else ctx.setLineDash([]);
      ctx.beginPath();points.forEach((q,i)=>{if(i===0||points[i-1].legIndex!==q.legIndex)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();ctx.restore();
      const idx=Math.min(points.length-1,Math.floor(((phase+(Math.abs(hash(group.key))%100)/100)%1)*points.length));
      const vehicle=points[idx];drawVehicle(ctx,vehicle,vehicle.mode||group.mode,color);
      const mid=points[Math.floor(points.length/2)];state.hitTargets.push({x:mid.x,y:mid.y,group,r:Math.max(12,width*3)});
      state.hitTargets.push({x:vehicle.x,y:vehicle.y,group,r:18});
      points.forEach((point,index)=>{if(index%5===0)state.hitTargets.push({x:point.x,y:point.y,group,r:9});});
    }else{
      const loc=group.state==='arrived'?ISTANBUL:group.origin;if(!loc)return;
      const q=state.view==='3d'?project3d(loc,w,h,0):project2d(loc,w,h);if(!q||!q.visible)return;
      const pulse=5+Math.sin(now/550+group.orders)*1.8;
      const color=group.state==='arrived'?p.green:group.state==='ready'?p.orange:p.acc;
      ctx.save();ctx.fillStyle=color;ctx.globalAlpha=.15;ctx.beginPath();ctx.arc(q.x,q.y,pulse+6,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=.95;ctx.beginPath();ctx.arc(q.x,q.y,Math.max(4,Math.min(10,3+Math.log10(1+group.orders)*2)),0,Math.PI*2);ctx.fill();
      if(group.risk!=='none'){ctx.strokeStyle=p.red;ctx.lineWidth=2;ctx.beginPath();ctx.arc(q.x,q.y,pulse+4,0,Math.PI*2);ctx.stroke();}
      ctx.restore();state.hitTargets.push({x:q.x,y:q.y,group,r:15});
    }
  });
}
function hash(value){let h=0;for(const ch of String(value||''))h=((h<<5)-h)+ch.charCodeAt(0)|0;return h;}
function draw(now){
  state.frame=0;if(document.hidden||state.collapsed)return;
  const info=canvasInfo();if(!info)return;
  const {ctx,w,h}=info,p=palette();ctx.clearRect(0,0,w,h);ctx.fillStyle=p.water;ctx.fillRect(0,0,w,h);
  if(state.view==='3d')drawLand3d(ctx,w,h,p);else drawLand2d(ctx,w,h,p);
  drawRoutes(ctx,w,h,p,now||performance.now());
  if(state.hover)drawHoverHighlight(ctx,state.hover,p);
  if(state.groups.some(g=>g.state==='transit'))state.frame=requestAnimationFrame(throttledDraw);
}
function throttledDraw(now){
  if(now-state.lastFrame<33){state.frame=requestAnimationFrame(throttledDraw);return;}
  state.lastFrame=now;draw(now);
}
function scheduleDraw(){if(state.frame)cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(draw);}
function resizeCanvas(){scheduleDraw();}
function nearestHit(x,y){
  let best=null,bestD=Infinity;state.hitTargets.forEach(hit=>{const d=Math.hypot(hit.x-x,hit.y-y);if(d<=hit.r&&d<bestD){best=hit;bestD=d;}});return best;
}
function drawHoverHighlight(ctx,hit,p){
  ctx.save();ctx.strokeStyle=p.ink;ctx.globalAlpha=.45;ctx.lineWidth=1;ctx.beginPath();ctx.arc(hit.x,hit.y,hit.r+3,0,Math.PI*2);ctx.stroke();ctx.restore();
}
function canvasPoint(event){
  const canvas=$('globalFlowCanvas'),rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};
}
function showTooltip(hit,event){
  const tip=$('globalFlowTooltip');if(!tip)return;
  if(!hit){tip.hidden=true;return;}
  const group=hit.group,origin=group.origin?group.origin.name:L('Bilinmiyor','Unknown');
  tip.innerHTML='<b>'+esc(group.state==='transit'?origin+' → İstanbul':group.state==='arrived'?'İstanbul':origin)+'</b>'+
    '<span>'+esc(stateLabel(group.state))+(group.state==='transit'?' · '+esc(modeLabel(group.mode)):'')+'</span>'+
    '<span>'+nf().format(group.orders)+' '+esc(L('sipariş','orders'))+' · '+nf().format(group.qty)+' '+esc(L('adet','units'))+'</span>'+
    (group.risk!=='none'?'<em>'+esc(L('Risk sinyali var','Risk signal present'))+'</em>':'');
  const wrap=$('globalFlowCanvasWrap').getBoundingClientRect();tip.style.left=Math.min(wrap.width-230,Math.max(8,event.clientX-wrap.left+12))+'px';tip.style.top=Math.min(wrap.height-100,Math.max(8,event.clientY-wrap.top+12))+'px';tip.hidden=false;
}
function onPointerDown(event){
  if(event.button!==0)return;const p=canvasPoint(event);state.drag={id:event.pointerId,x:p.x,y:p.y,panX:state.panX,panY:state.panY,rotLon:state.rotLon,rotLat:state.rotLat,moved:false};
  try{event.currentTarget.setPointerCapture(event.pointerId);}catch(_){}
}
function onPointerMove(event){
  const p=canvasPoint(event);
  if(state.drag&&state.drag.id===event.pointerId){
    const dx=p.x-state.drag.x,dy=p.y-state.drag.y;if(Math.hypot(dx,dy)>3)state.drag.moved=true;
    if(state.view==='3d'){state.rotLon=state.drag.rotLon+dx*.35;state.rotLat=Math.max(-78,Math.min(78,state.drag.rotLat-dy*.28));}
    else {state.panX=state.drag.panX+dx;state.panY=state.drag.panY+dy;}
    scheduleDraw();return;
  }
  const hit=nearestHit(p.x,p.y);state.hover=hit;showTooltip(hit,event);scheduleDraw();
}
function onPointerUp(event){
  if(state.drag&&state.drag.id===event.pointerId)state.drag=null;
}
function onWheel(event){
  event.preventDefault();const factor=event.deltaY>0?.9:1.1;
  if(state.view==='3d')state.zoom3d=Math.max(.65,Math.min(2.2,state.zoom3d*factor));
  else state.zoom2d=Math.max(.65,Math.min(4.5,state.zoom2d*factor));
  scheduleDraw();
}
function openDrawer(group){
  const drawer=$('globalFlowDrawer');if(!drawer||!group)return;
  const rows=group.records.slice().sort((a,b)=>String(a.orderCode).localeCompare(String(b.orderCode),'tr',{numeric:true}));
  const title=group.state==='transit'?(group.origin?group.origin.name:L('Bilinmeyen çıkış','Unknown origin'))+' → İstanbul':stateLabel(group.state);
  drawer.innerHTML='<div class="gfDrawerHead"><div><b>'+esc(title)+'</b><span>'+esc(stateLabel(group.state))+(group.state==='transit'?' · '+esc(modeLabel(group.mode)):'')+' · '+nf().format(group.qty)+' '+esc(L('adet','units'))+'</span></div><button type="button" data-gf-drawer-close>×</button></div>'+
    '<div class="gfDrawerBody"><div class="gfDrawerNote">'+esc(L('Rotalar canlı GPS/AIS takibi değildir; Buyer Log durum ve yükleme tipi verisinden türetilen operasyonel görselleştirmedir.','Routes are not live GPS/AIS tracking; they are operational visualisations derived from Buyer Log status and loading-type data.'))+'</div>'+
    '<div class="gfDrawerTableWrap"><table class="gfDrawerTable"><thead><tr><th>'+esc(L('Kaynak','Source'))+'</th><th>'+esc(L('Sipariş','Order'))+'</th><th>'+esc(L('Model','Model'))+'</th><th>Buyer</th><th>'+esc(L('Üretici','Supplier'))+'</th><th>'+esc(L('Statü','Status'))+'</th><th>'+esc(L('Taşıma','Mode'))+'</th><th>'+esc(L('Adet','Qty'))+'</th><th>Ex-Factory</th><th>ETA</th></tr></thead><tbody>'+
    rows.map((r,i)=>'<tr data-gf-record="'+i+'"><td><button type="button" class="gfSourceJump" data-gf-jump="'+i+'">'+esc(sourceLabel(r.source))+'</button></td><td>'+esc(r.orderCode||'—')+'</td><td>'+esc([r.model,r.colourCode].filter(Boolean).join(' · ')||'—')+'</td><td>'+esc(r.buyer||'—')+'</td><td>'+esc(r.manufacturer||'—')+'</td><td>'+esc(r.status||'—')+'</td><td>'+esc(modeLabel(r.mode))+'</td><td class="num">'+nf().format(r.qty||0)+'</td><td>'+esc(r.exFactory||'—')+'</td><td>'+esc(r.eta||'—')+'</td></tr>').join('')+
    '</tbody></table></div></div>';
  drawer.classList.add('is-open');drawer.setAttribute('aria-hidden','false');
  drawer.querySelector('[data-gf-drawer-close]')?.addEventListener('click',closeDrawer);
  drawer.querySelectorAll('[data-gf-jump]').forEach(button=>button.addEventListener('click',()=>jumpToSource(rows[Number(button.dataset.gfJump)])));
}
function closeDrawer(){const drawer=$('globalFlowDrawer');if(drawer){drawer.classList.remove('is-open');drawer.setAttribute('aria-hidden','true');}}
function jumpToSource(rec){
  if(!rec)return;const tab=document.querySelector('nav.tabs button[data-tab="'+rec.source+'"]');if(tab)tab.click();
  const searchId=rec.source==='cp'?'cpSearch':rec.source==='orders'?'ordersSearch':'';
  if(searchId&&rec.orderCode)setTimeout(()=>{const input=$(searchId);if(!input)return;input.value=rec.orderCode;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();},80);
  closeDrawer();
}
function bindCanvas(){
  const canvas=$('globalFlowCanvas');if(!canvas||canvas.dataset.gfBound)return;canvas.dataset.gfBound='1';
  canvas.addEventListener('pointerdown',onPointerDown);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',onPointerUp);
  canvas.addEventListener('pointerleave',event=>{if(!state.drag){state.hover=null;showTooltip(null,event);scheduleDraw();}});
  canvas.addEventListener('wheel',onWheel,{passive:false});
  canvas.addEventListener('dblclick',event=>{const p=canvasPoint(event),hit=nearestHit(p.x,p.y);if(hit)openDrawer(hit.group);});
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
  bindCanvas();bindObservers();renderAll();void refresh(false);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(state.fullscreen)toggleFullscreen();else closeDrawer();}
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

return {
  ISTANBUL,FIELD_CANDIDATES,clean,norm,toNumber,pick,countryCoordinate,detectMode,classifyState,riskLevel,
  normalizeRecord,recordKey,dedupeRecords,aggregateRecords,uniqueValues,refresh:()=>refresh(true),resetView
};
});