/* Buyer Log — Sessiz çalışma alanı (önizleme).
 * Görünüm menüsünden açılan, yerel-öncelikli ana uygulamanın İÇİNDE çalışan ayrı
 * bir görünüm stilidir. Veri, yetki ve yükleme ana uygulamanınkidir:
 *  - satırlar window.BLSessizSource üzerinden (state.cp, ensureCpLoaded) okunur,
 *  - alanlar yalnız BLCanonicalFields kanonik kimlikleriyle okunur (ham başlık yok),
 *  - öncelik etiketi ana uygulamanın birleşik öncelik kararından gelir.
 * Salt okunurdur: kayıt, düzenleme, senkron ve dışa aktarma klasik görünümde kalır.
 * Görünmezken hiçbir şey çizmez, yüklemez veya zamanlamaz; saat yalnız Genel Bakış
 * görünür ve sekme açıkken dakikada bir güncellenir. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.BLSessiz=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';

/* ------------------------------------------------------------------ 1) SAF MODEL */
const DAY=86400000;
function toNum(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  let s=String(value==null?'':value).replace(/\s/g,'');if(!s)return null;
  if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
  else if(/^-?\d+,\d+$/.test(s))s=s.replace(',','.');
  else s=s.replace(/,/g,'');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
function toDate(value){
  if(value instanceof Date)return Number.isFinite(value.getTime())?value:null;
  if(typeof value==='number'&&value>20000&&value<80000)return new Date(Math.round((value-25569)*DAY));
  const s=String(value==null?'':value).trim();if(!s)return null;
  let m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if(m){const y=+m[3]<100?2000+(+m[3]):+m[3];const d=new Date(y,+m[2]-1,+m[1]);return Number.isFinite(d.getTime())?d:null;}
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m){const d=new Date(+m[1],+m[2]-1,+m[3]);return Number.isFinite(d.getTime())?d:null;}
  return null;
}
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function mondayOf(d){const x=startOfDay(d);const wd=(x.getDay()+6)%7;return new Date(x.getTime()-wd*DAY);}
/* Ex-Factory haftası: bugünün haftasına göre göreli sıra (0 = bu hafta, <0 geçmiş). */
function weekIndex(date,today){if(!date)return null;return Math.round((mondayOf(date)-mondayOf(today))/(7*DAY));}
function isoWeek(d){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-day);const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil(((x-y)/DAY+1)/7);}
/* Satırları Ex-Factory haftasına göre gruplar: geçmiş tek grupta, tarihsiz en sonda. */
function groupByWeek(items,today){
  const map=new Map();
  for(const item of items){const w=weekIndex(item.exf,today);const key=w==null?'none':w<0?'past':String(w);
    if(!map.has(key))map.set(key,{key,week:w==null?null:Math.max(w,-1),items:[]});map.get(key).items.push(item);}
  const order=g=>g.key==='past'?-1:g.key==='none'?1e9:+g.key;
  return [...map.values()].sort((a,b)=>order(a)-order(b));
}
/* Ana başlık projeksiyonu (BL table-report-inline ile aynı kural): ardışık aynı ana
   başlık tek rapor sütunu olur, alanlar tablodaki sırayla alt alta durur. */
function projectReport(columns){
  const out=[];
  for(const col of columns){
    if(col.kind==='image'){out.push(col);continue;}
    const last=out[out.length-1];
    if(col.group&&last&&last.report&&last.group===col.group){last.fields.push(col);continue;}
    out.push({key:'__report_'+out.length,group:col.group||'',label:col.group||col.label,report:true,fields:[col]});
  }
  return out;
}
function quickFilterPass(item,filters){for(const k of Object.keys(filters||{})){const v=filters[k];if(v&&item.facets[k]!==v)return false;}return true;}
function summarize(values){const nums=values.map(toNum).filter(v=>v!=null);const sum=nums.reduce((a,b)=>a+b,0);return {count:nums.length,sum,avg:nums.length?sum/nums.length:0};}
/* Genel Bakış ızgarası: BL overview-layout.js sözleşmesi (12 sütun, en fazla 5 sayfa,
   çakışmada aşağı itme, yukarı hizalama, ilk uygun yer). */
const COLS=12,MAX_PAGES=5,MAX_ROWS=80;
const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
function clampItem(item,spec){const it=Object.assign({},item);it.w=Math.max(spec.minW,Math.min(spec.maxW,COLS,Math.round(it.w)));it.h=Math.max(spec.minH,Math.min(spec.maxH,Math.round(it.h)));
  it.x=Math.max(0,Math.min(COLS-it.w,Math.round(it.x)));it.y=Math.max(0,Math.min(MAX_ROWS,Math.round(it.y)));return it;}
function resolveCollisions(items,fixedKey){
  const fixed=items.find(i=>i.key===fixedKey);if(!fixed)return items;const placed=[fixed];
  items.filter(i=>i!==fixed).sort((a,b)=>a.y-b.y||a.x-b.x).forEach(it=>{let guard=0;while(placed.some(p=>overlaps(p,it))&&guard++<MAX_ROWS*2)it.y++;placed.push(it);});
  return items;
}
function compact(items){
  const sorted=items.slice().sort((a,b)=>a.y-b.y||a.x-b.x);
  sorted.forEach((it,i)=>{while(it.y>0){it.y--;if(sorted.slice(0,i).some(p=>overlaps(p,it))){it.y++;break;}}});
  return items;
}
function firstFit(items,w,h){for(let y=0;y<MAX_ROWS;y++)for(let x=0;x<=COLS-w;x++){const c={x,y,w,h};if(!items.some(p=>overlaps(p,c)))return c;}
  return {x:0,y:items.reduce((m,i)=>Math.max(m,i.y+i.h),0),w,h};}
const model=Object.freeze({toNum,toDate,weekIndex,isoWeek,groupByWeek,projectReport,quickFilterPass,summarize,clampItem,resolveCollisions,compact,firstFit,overlaps,COLS,MAX_PAGES});

const doc=root&&root.document;
if(!doc)return Object.freeze({model});

/* ------------------------------------------------------------------ 2) GÖRÜNÜM */
const STORE='buyerlog.sessiz.v1.';
const store=()=>root.BLStorage||root.localStorage;
function load(key,fallback){try{const v=store().getItem(STORE+key);return v==null?fallback:JSON.parse(v);}catch(_){return fallback;}}
function save(key,value){try{store().setItem(STORE+key,JSON.stringify(value));}catch(_){}}
const src=()=>root.BLSessizSource||null;
const isEn=()=>{try{return src()?.lang?.()==='en';}catch(_){return doc.documentElement.lang==='en';}};
const L=(tr,en)=>isEn()?en:tr;
const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const locale=()=>isEn()?'en-GB':'tr-TR';
const fmt=n=>n==null?'':Number(n).toLocaleString(locale(),{maximumFractionDigits:0});
const dec=(n,d=2)=>n==null?'':Number(n).toLocaleString(locale(),{minimumFractionDigits:d,maximumFractionDigits:d});
const dm=d=>d?String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0'):'';
const dmy=d=>d?dm(d)+'.'+d.getFullYear():'';

/* Kanonik CP alanları. Etiketler TR/EN; ana başlıklar Sessiz rapor sütunlarıdır. */
const FIELDS=[
  {id:'orderCode',group:['Sipariş','Order'],label:['Sipariş','Order'],kind:'code'},
  {id:'season',group:['Sipariş','Order'],label:['Sezon','Season'],kind:'mono'},
  {id:'buyingGroup',group:['Sipariş','Order'],label:['Buying group','Buying group'],kind:'text',facet:'buyingGroup'},
  {id:'image',group:['Model','Model'],label:['',''],kind:'image'},
  {id:'modelName',group:['Model','Model'],label:['Model','Model'],kind:'name'},
  {id:'license',group:['Model','Model'],label:['Lisans','License'],kind:'text',facet:'license'},
  {id:'category',group:['Model','Model'],label:['Klasman','Category'],kind:'text'},
  {id:'colour',group:['Model','Model'],label:['Renk','Colour'],kind:'muted'},
  {id:'manufacturer',group:['Üretici','Manufacturer'],label:['Üretici','Manufacturer'],kind:'text'},
  {id:'country',group:['Üretici','Manufacturer'],label:['Ülke','Country'],kind:'muted',facet:'country'},
  {id:'buyer',group:['Üretici','Manufacturer'],label:['Buyer','Buyer'],kind:'text',facet:'buyer'},
  {id:'orderQuantity',group:['Adet','Quantity'],label:['Sipariş','Ordered'],kind:'qty'},
  {id:'shipmentQuantity',group:['Adet','Quantity'],label:['Yüklenen','Shipped'],kind:'qty'},
  {id:'remainingUnits',group:['Adet','Quantity'],label:['Kalan','Remaining'],kind:'qty'},
  {id:'exFactory',group:['Tarihler','Dates'],label:['Ex-Factory','Ex-Factory'],kind:'date'},
  {id:'inStore',group:['Tarihler','Dates'],label:['Mağaza','In-Store'],kind:'date'},
  {id:'retailDate',group:['Tarihler','Dates'],label:['Retail','Retail'],kind:'date'},
  {id:'fob',group:['Ticari','Commercial'],label:['FOB','FOB'],kind:'money'},
  {id:'deliveryType',group:['Ticari','Commercial'],label:['Teslim tipi','Delivery type'],kind:'muted'},
  {id:'orderStatus',group:['Durum','Status'],label:['Statü','Status'],kind:'text',facet:'status'},
  {id:'priority',group:['Durum','Status'],label:['Dikkat','Attention'],kind:'priority',facet:'priority'}
];
const FACETS=[['country',['ülke','country']],['license',['lisans','license']],['season',['sezon','season']],['buyer',['buyer','buyer']],['priority',['dikkat','attention']]];
const pick=pair=>isEn()?pair[1]:pair[0];

let today=startOfDay(new Date());
let cache={rows:null,items:[]};
function canonical(row,id){const C=root.BLCanonicalFields;if(!C)return '';try{const v=C.canonicalValue(row,'cp',id);return v==null?'':v;}catch(_){return '';}}
function itemsFromRows(rows){
  if(cache.rows===rows&&cache.lang===isEn())return cache.items;
  const s=src();const items=rows.map((row,index)=>{
    const v={};for(const f of FIELDS){if(f.kind==='image'||f.kind==='priority')continue;v[f.id]=canonical(row,f.id);}
    const pr=s?.priority?.(row)||{code:'',label:'',risk:false,rank:99};
    const ordered=toNum(v.orderQuantity),shipped=toNum(v.shipmentQuantity);let remaining=toNum(v.remainingUnits);
    if(remaining==null&&ordered!=null)remaining=Math.max(0,ordered-(shipped||0));
    const exf=toDate(v.exFactory);
    return {row,index,v,exf,inStore:toDate(v.inStore),retail:toDate(v.retailDate),ordered,shipped,remaining,fob:toNum(v.fob),priority:pr,
      facets:{country:String(v.country||''),license:String(v.license||''),season:String(v.season||''),buyer:String(v.buyer||''),buyingGroup:String(v.buyingGroup||''),status:String(v.orderStatus||''),priority:pr.label||''},
      text:(Object.values(v).join(' ')+' '+(pr.label||'')).toLocaleLowerCase('tr-TR')};
  });
  cache={rows,items,lang:isEn()};return items;
}
function cellText(f,it){
  switch(f.kind){
    case 'qty':return fmt(f.id==='orderQuantity'?it.ordered:f.id==='shipmentQuantity'?it.shipped:it.remaining);
    case 'date':return dm(f.id==='exFactory'?it.exf:f.id==='inStore'?it.inStore:it.retail);
    case 'money':return it.fob==null?'':dec(it.fob);
    case 'priority':return it.priority.code==='ON_TRACK'?'':it.priority.label||'';
    case 'image':return '';
    default:return String(it.v[f.id]==null?'':it.v[f.id]);
  }
}
const critical=it=>!!(it.priority&&(it.priority.rank===0||it.priority.code==='CRITICAL'));
const urgent=it=>!!(it.priority&&it.priority.risk);

/* ------------------------------------------------------------------ 3) DURUM */
const S={open:false,view:load('view','cp'),filters:{},opt:null,report:!!load('report',false),collapsed:new Set(load('collapsed',[])),search:'',limit:300,sort:null,
  sel:null,detail:null,overview:load('overview',null),edit:false,drawer:false,send:null,dl:7,bd:'country',exc:'all'};
let host=null,clockTimer=0,langObserver=null;

/* ------------------------------------------------------------------ 4) KABUK */
const NAV=()=>[
  ['overview',L('Genel Bakış','Overview'),true],['cp','CP Tracker',true],
  ['orders',L('Siparişler','Orders')],['backlog','Backlog'],['koleksiyon',L('Koleksiyon','Collection')],['quotations',L('Fiyat Masası','Pricing Desk')],['lfl',L('LFL Analizi','LFL Analysis')]];
function shell(){
  return '<header class="slTop"><span class="slWord" aria-label="Buyer Log">buyer log</span><span class="slTag">'+esc(L('Sessiz · önizleme','Quiet · preview'))+'</span>'+
    '<label class="slSearch"><span class="slVisuallyHidden">'+esc(L('Ara','Search'))+'</span><input type="search" id="slSearch" value="'+esc(S.search)+'" placeholder="'+esc(S.view==='cp'?L('CP Tracker içinde ara','Search CP Tracker'):L('Ara','Search'))+'" autocomplete="off"></label>'+
    '<span class="slMeta" id="slMeta"></span><button type="button" class="slExit" data-sl="exit">'+esc(L('Klasik görünüm','Classic view'))+'</button></header>'+
    '<nav class="slNav" aria-label="'+esc(L('Modüller','Modules'))+'">'+NAV().map(([id,label,own])=>'<button type="button" data-sl-nav="'+id+'"'+(S.view===id?' aria-current="page"':'')+(own?'':' class="slClassic" title="'+esc(L('Klasik görünümde açılır','Opens in classic view'))+'"')+'>'+esc(label)+(own?'':' ↗')+'</button>').join('')+'</nav>'+
    '<main class="slMain" id="slMain"></main><footer class="slFoot" id="slFoot"></footer>';
}
function render(){
  if(!host||!S.open)return;
  host.querySelector('#slMain').innerHTML=S.view==='overview'?overviewHtml():cpHtml();
  host.querySelector('.slMain').classList.remove('blMotionEnter');void host.offsetWidth;host.querySelector('.slMain').classList.add('blMotionEnter');
  paint();
}
function renderAll(){if(!host)return;host.innerHTML=shell();render();}

/* ------------------------------------------------------------------ 5) CP TRACKER */
function visibleFields(){return FIELDS;}
function cpItems(){
  const s=src();const rows=s?.cpRows?.()||[];const items=itemsFromRows(rows);
  const terms=S.search.trim();const T=root.BLTableSearch;let parsed=null;
  if(terms&&T&&typeof T.parseTerms==='function'){try{parsed=T.parseTerms(terms);}catch(_){parsed=null;}}
  const q=terms.toLocaleLowerCase('tr-TR');
  return items.filter(it=>quickFilterPass(it,S.filters)&&(!q||(parsed&&T.matches?safeMatch(T,parsed,it):it.text.includes(q))));
}
function safeMatch(T,parsed,it){try{return T.matches(it.text,parsed);}catch(_){return it.text.includes(S.search.trim().toLocaleLowerCase('tr-TR'));}}
function sortItems(list){if(!S.sort)return list;const f=FIELDS.find(x=>x.id===S.sort.id);if(!f)return list;const dir=S.sort.dir;
  const key=it=>f.kind==='qty'?(f.id==='orderQuantity'?it.ordered:f.id==='shipmentQuantity'?it.shipped:it.remaining)??-1:f.kind==='date'?((f.id==='exFactory'?it.exf:f.id==='inStore'?it.inStore:it.retail)?.getTime()??0):f.kind==='money'?it.fob??-1:f.kind==='priority'?it.priority.rank??99:cellText(f,it).toLocaleLowerCase('tr-TR');
  return list.slice().sort((a,b)=>{const x=key(a),y=key(b);return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'tr'))*dir;});}
function weekLabel(g){if(g.key==='past')return L('geçmiş Ex-F','past Ex-F');if(g.key==='none')return L('tarihsiz','no date');
  if(g.week===0)return L('bu hafta','this week');if(g.week===1)return L('gelecek hafta','next week');const d=new Date(mondayOf(today).getTime()+g.week*7*DAY);return L(isoWeek(d)+'. hafta','week '+isoWeek(d));}
function weekSub(g){if(g.week==null||g.week<0)return fmt(g.items.length)+' '+L('sipariş','orders');const a=new Date(mondayOf(today).getTime()+g.week*7*DAY);return dm(a)+' – '+dm(new Date(a.getTime()+6*DAY));}
function columnsForView(){
  const cols=visibleFields().map(f=>({id:f.id,key:f.id,label:pick(f.label),group:pick(f.group),kind:f.kind,field:f}));
  if(!S.report){return cols.filter((c,i)=>!(c.group&&S.collapsed.has(c.group)&&cols.findIndex(x=>x.group===c.group)!==i));}
  return projectReport(cols);
}
const WIDTH={code:'84px',mono:'60px',text:'minmax(96px,1fr)',muted:'minmax(84px,.8fr)',name:'minmax(200px,1.6fr)',qty:'88px',date:'64px',money:'64px',priority:'minmax(96px,.8fr)',image:'38px'};
function colWidth(c){if(c.report){const n=c.fields.length;if(c.fields.some(f=>f.kind==='name'))return 'minmax(220px,1.6fr)';return n>1?'minmax('+Math.min(200,100+n*16)+'px,'+(1+n*0.15).toFixed(2)+'fr)':(WIDTH[c.fields[0].kind]||'minmax(90px,1fr)');}return WIDTH[c.kind]||'minmax(90px,1fr)';}
function imageHtml(it){const H=root.BLDetailImages;if(!H?.thumbHtml)return '';
  const plmId=canonical(it.row,'plmId'),colourCode=canonical(it.row,'colourCode'),colour=it.v.colour,modelName=it.v.modelName;
  let url='';try{url=H.sourceFor?.({plmId,colourCode,colour,modelName})||'';}catch(_){url='';}
  try{return H.thumbHtml(url,{modelId:plmId||modelName,plmId,modelName,colourCode,colour},{title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),allowEmpty:true});}catch(_){return '';}}
function cellHtml(c,it){
  if(c.report){const parts=c.fields.map(f=>({f,t:f.kind==='image'?'':cellText(f,it)})).filter(p=>p.t);if(!parts.length)return '<span class="slMuted">—</span>';
    const [p,...rest]=parts;const lab=f=>['qty','date','money','mono'].includes(f.kind)?esc(pick(f.field.label).toLocaleLowerCase(locale()))+' ':'';
    return '<div class="slRp"><span class="'+klass(p.f,it)+'" title="'+esc(pick(p.f.field.label)+': '+p.t)+'">'+esc(p.t)+'</span></div>'+(rest.length?'<div class="slRs">'+rest.map(x=>'<span class="'+(redFor(x.f,it)?'slRed':'')+'" title="'+esc(pick(x.f.field.label)+': '+x.t)+'">'+lab(x.f)+esc(x.t)+'</span>').join(' · ')+'</div>':'');}
  if(c.kind==='image')return imageHtml(it);
  return '<span class="'+klass(c,it)+'">'+esc(cellText(c,it))+'</span>';
}
function redFor(c,it){return (c.kind==='name'||c.kind==='priority'||(c.kind==='date'&&c.key==='exFactory'))&&critical(it);}
function klass(c,it){const k=c.kind;let cls=k==='name'?'slName':k==='code'?'slCode':['qty','money'].includes(k)?'slNum':['date','mono'].includes(k)?'slMono':k==='muted'?'slMuted':k==='priority'?'slPrio'+(urgent(it)?' slStrong':''):'slText';if(redFor(c,it))cls+=' slRed';return cls;}
let ROWMAP=[];
function cpHtml(){
  const s=src();
  if(!s){return '<p class="slLead">'+esc(L('Veri kaynağı hazır değil.','Data source is not ready.'))+'</p>';}
  if(s.cpState?.()!=='ready'){return '<p class="slLead">'+esc(L('CP verisi yükleniyor…','Loading CP data…'))+'</p>';}
  const all=s.cpRows?.()||[];if(!all.length)return '<p class="slLead">'+esc(L('Yetkili kapsamda CP satırı yok.','No CP rows in your scope.'))+'</p>';
  const list=sortItems(cpItems());const cols=columnsForView();const tpl=cols.map(colWidth).join(' ');
  const facetVals=key=>[...new Set(itemsFromRows(all).map(it=>it.facets[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
  let h='<div class="slTitle"><h2>CP Tracker</h2><p>'+esc(L('Ex-Factory haftasına göre · salt okunur · düzenleme klasik görünümde','By Ex-Factory week · read-only · edit in classic view'))+'</p></div>';
  h+='<div class="slTb"><div class="slTbL">'+FACETS.map(([k,l])=>'<button type="button" data-sl-opt="'+k+'" aria-pressed="'+(S.opt===k)+'"'+(S.filters[k]?' class="on"':'')+'>'+esc(pick(l))+' <b>'+esc(S.filters[k]||L('hepsi','all'))+'</b></button>').join('')+
    (Object.values(S.filters).some(Boolean)?'<button type="button" class="slClear" data-sl="clear">'+esc(L('temizle','clear'))+'</button>':'')+'</div>'+
    '<div class="slTbR"><span class="slSeg"><button type="button" data-sl="table" aria-pressed="'+!S.report+'">'+esc(L('tablo','table'))+'</button><button type="button" data-sl="report" aria-pressed="'+S.report+'">'+esc(L('rapor','report'))+'</button></span>'+
    '<button type="button" data-sl="copy">'+esc(L('görüneni kopyala','copy visible'))+'</button></div></div>';
  if(S.opt){h+='<div class="slOpt">'+['',...facetVals(S.opt)].slice(0,80).map(v=>'<button type="button" data-sl-set="'+esc(v)+'" aria-pressed="'+((S.filters[S.opt]||'')===v)+'">'+esc(v||L('hepsi','all'))+'</button>').join('')+'</div>';}
  const groups=groupByWeek(list,today);let shown=0;ROWMAP=[];
  h+='<div class="slScroll"><div class="slTbl'+(S.report?' isReport':'')+'" style="min-width:'+(S.report?1080:1900)+'px">';
  if(!S.report){h+='<div class="slHead"><span></span><div class="slGh" style="grid-template-columns:'+tpl+'">';let i=0;
    while(i<cols.length){const g=cols[i].group;let j=i;while(g&&j+1<cols.length&&cols[j+1].group===g)j++;const total=FIELDS.filter(f=>pick(f.group)===g).length;
      h+=g?'<button type="button" class="slGhb'+(S.collapsed.has(g)?' fold':'')+'" data-sl-group="'+esc(g)+'" style="grid-column:'+(i+1)+' / '+(j+2)+'" title="'+esc(S.collapsed.has(g)?L('Genişlet','Expand'):L('Daralt · yalnız ilk sütun kalır','Collapse · keeps the first column'))+'">'+esc(g)+(S.collapsed.has(g)?' <span>+'+(total-1)+'</span>':'')+'</button>':'<span></span>';i=j+1;}
    h+='</div></div>';}
  h+='<div class="slHead"><span></span><div class="slHr" style="grid-template-columns:'+tpl+'">'+cols.map((c,i)=>'<button type="button" class="slHc'+(['qty','money'].includes(c.kind)||(c.report&&c.fields.length===1&&['qty','money'].includes(c.fields[0].kind))?' r':'')+'" data-sl-sort="'+esc(c.report?c.fields[0].key:c.key)+'" title="'+esc(c.report?c.fields.map(f=>f.label).filter(Boolean).join(' · '):L('Sırala','Sort'))+'">'+esc(c.label)+(S.sort&&S.sort.id===(c.report?c.fields[0].key:c.key)?(S.sort.dir>0?' ↑':' ↓'):'')+'</button>').join('')+'</div></div><div class="slRule"></div>';
  for(const g of groups){if(shown>=S.limit)break;
    h+='<div class="slGrp"><div class="slGl"><span class="slGlT">'+esc(weekLabel(g))+'</span><span class="slGlS">'+esc(weekSub(g))+'</span><span class="slGlS">'+fmt(g.items.reduce((s2,it)=>s2+(it.ordered||0),0))+' '+esc(L('adet','pcs'))+'</span></div><div class="slGr">';
    for(const it of g.items){if(shown>=S.limit)break;const r=ROWMAP.length;ROWMAP.push(it);shown++;
      h+='<div class="slRow'+(S.report?' rep':'')+(critical(it)?' crit':'')+'" data-r="'+r+'" style="grid-template-columns:'+tpl+'">'+cols.map((c,ci)=>'<div class="slCell'+(['qty','money'].includes(c.kind)||(c.report&&c.fields.length===1&&['qty','money'].includes(c.fields[0].kind))?' r':'')+'" data-c="'+ci+'">'+cellHtml(c,it)+'</div>').join('')+'</div>';
      if(S.detail===it.index)h+=detailHtml(it);}
    h+='</div></div>';}
  h+='</div></div>';
  if(list.length>shown)h+='<div class="slMore"><button type="button" data-sl="more">'+esc(L('Daha fazla göster','Show more'))+' · '+fmt(list.length-shown)+'</button></div>';
  host._cols=cols;
  return h;
}
function detailHtml(it){
  const pairs=FIELDS.filter(f=>f.kind!=='image').map(f=>[pick(f.label)||pick(f.group),cellText(f,it)]).filter(p=>p[1]);
  return '<div class="slDet blMotionOverlay">'+pairs.map(p=>'<div><span>'+esc(p[0])+'</span><span>'+esc(p[1])+'</span></div>').join('')+
    '<div class="slDetActs"><button type="button" data-sl="open-classic" data-index="'+it.index+'">'+esc(L('Klasik CP\'de aç ve düzenle','Open and edit in classic CP'))+'</button></div></div>';
}

/* ------------------------------------------------------------------ 6) GENEL BAKIŞ */
const WIDGETS={
  launchpad:{group:'today',t:['Dünya Saatleri','World Clocks'],d:['Selamlama ve çalıştığın ülkelerin saatleri.','Greeting and clocks of the countries you work with.'],w:12,h:1,minW:6,minH:1,maxW:12,maxH:2},
  pulse:{group:'today',t:['Operasyon Nabzı','Operation Pulse'],d:['CP kapsamı, öncelikler ve yakın yüklemeler.','CP scope, priorities and upcoming loading.'],w:12,h:3,minW:6,minH:2,maxW:12,maxH:6},
  exceptionInbox:{group:'operations',t:['İstisna kutusu','Exception inbox'],d:['Ex-Factory\'si geçmiş, yüklenmemiş siparişler.','Orders past Ex-Factory and not loaded.'],w:12,h:4,minW:4,minH:3,maxW:12,maxH:12},
  deadline:{group:'operations',t:['Termin Ufku','Delivery Horizon'],d:['Önümüzdeki 7 veya 14 günün planlı yüklemeleri.','Planned loading over the next 7 or 14 days.'],w:6,h:5,minW:3,minH:3,maxW:12,maxH:10},
  breakdown:{group:'operations',t:['Aktif Sipariş Kırılımı','Active Order Breakdown'],d:['Ülke, üretici, sezon ve buying group dağılımı.','Country, manufacturer, season and buying group mix.'],w:6,h:5,minW:3,minH:4,maxW:12,maxH:10},
  globalFlowMap:{group:'operations',classic:true,t:['Global Flow Map','Global Flow Map'],d:['Üretim ve sevkiyat akışı haritası.','Production and shipment flow map.'],w:6,h:3,minW:4,minH:2,maxW:12,maxH:8},
  notes:{group:'operations',classic:true,t:['Not Hatırlatıcısı','Notes Reminder'],d:['Yalnız senin yazdığın CP notları.','Only the CP notes you wrote.'],w:6,h:3,minW:3,minH:2,maxW:12,maxH:8},
  collectionSummary:{group:'commercial',classic:true,t:['Koleksiyon','Collection'],d:['Aylık adet, model görselleri ve statü dağılımı.','Monthly quantity, model images and status mix.'],w:12,h:2,minW:4,minH:2,maxW:12,maxH:8},
  oab:{group:'commercial',classic:true,t:['OAB','OAB'],d:['Order-Assortment-Budget pivotu.','Order-Assortment-Budget pivot.'],w:6,h:3,minW:4,minH:2,maxW:12,maxH:12},
  intake:{group:'commercial',classic:true,t:['INTAKE','INTAKE'],d:['INTAKE bütçe pivotu.','INTAKE budget pivot.'],w:6,h:3,minW:4,minH:2,maxW:12,maxH:12}};
const GROUPS_W={today:['Bugün','Today'],operations:['Operasyon','Operations'],commercial:['Ticari','Commercial']};
function defaultLayout(){return {page:0,pages:[{name:['Operasyon','Operations'],items:[{key:'launchpad',x:0,y:0,w:12,h:1},{key:'pulse',x:0,y:1,w:12,h:2},{key:'exceptionInbox',x:0,y:3,w:12,h:4},{key:'deadline',x:0,y:7,w:6,h:5},{key:'breakdown',x:6,y:7,w:6,h:5},{key:'globalFlowMap',x:0,y:12,w:6,h:3},{key:'notes',x:6,y:12,w:6,h:3}]},
  {name:['Ticari','Commercial'],items:[{key:'collectionSummary',x:0,y:0,w:12,h:2},{key:'oab',x:0,y:2,w:6,h:3},{key:'intake',x:6,y:2,w:6,h:3}]}]};}
function layout(){const l=S.overview;if(l&&Array.isArray(l.pages)&&l.pages.length){l.pages=l.pages.slice(0,MAX_PAGES).map(p=>({name:p.name,items:(p.items||[]).filter(i=>WIDGETS[i.key]).map(i=>clampItem(i,WIDGETS[i.key]))}));l.page=Math.max(0,Math.min(l.pages.length-1,l.page|0));return l;}S.overview=defaultLayout();return S.overview;}
const pageName=p=>Array.isArray(p.name)?pick(p.name):String(p.name||'');
function saveLayout(){save('overview',S.overview);}
function clockHtml(){const now=new Date();const zones=[['TR','Europe/Istanbul'],['BD','Asia/Dhaka'],['IN','Asia/Kolkata'],['CN','Asia/Shanghai'],['EG','Africa/Cairo']];
  const hm=tz=>{try{return now.toLocaleTimeString(locale(),{timeZone:tz,hour:'2-digit',minute:'2-digit'});}catch(_){return '--:--';}};
  const off=tz=>{try{const a=new Date(now.toLocaleString('en-US',{timeZone:tz})),b=new Date(now.toLocaleString('en-US',{timeZone:'Europe/Istanbul'}));const d=Math.round((a-b)/1800000)/2;return d?(d>0?'+':'')+String(d).replace('.',isEn()?'.':',')+' '+L('sa','h'):'';}catch(_){return '';}};
  const hr=+hm('Europe/Istanbul').slice(0,2);const greet=hr<12?L('Günaydın','Good morning'):hr<18?L('İyi günler','Good afternoon'):L('İyi akşamlar','Good evening');const user=src()?.userName?.()||'';
  return '<div class="slClocks"><span class="slGreet">'+esc(greet+(user?', '+user:''))+'</span><span class="slMono slMuted">'+esc(now.toLocaleDateString(locale(),{timeZone:'Europe/Istanbul',day:'2-digit',month:'short',weekday:'short'}))+'</span>'+zones.map(([c,tz])=>'<span class="slClk"><b>'+c+'</b> <span class="slMono slT">'+hm(tz)+'</span> <span class="slMono slO">'+esc(off(tz))+'</span></span>').join('')+'</div>';}
function allItems(){return itemsFromRows(src()?.cpRows?.()||[]);}
const W={
  launchpad:()=>clockHtml(),
  pulse:()=>{const it=allItems();const week=it.filter(x=>{const w=weekIndex(x.exf,today);return w===0;});const near=it.filter(x=>x.exf&&x.exf>=today&&x.exf<new Date(today.getTime()+7*DAY));
    const prio=new Map();it.forEach(x=>{if(x.priority.label&&x.priority.code!=='ON_TRACK')prio.set(x.priority.label,(prio.get(x.priority.label)||0)+1);});
    return '<div class="slFigs"><div><span>'+esc(L('Aktif CP kapsamı','Active CP scope'))+'</span><span>'+fmt(it.length)+'</span></div><div><span>'+esc(L('Toplam adet','Total quantity'))+'</span><span>'+fmt(it.reduce((s,x)=>s+(x.ordered||0),0))+'</span></div><div><span>'+esc(L('Bu hafta Ex-F','Ex-F this week'))+'</span><span>'+fmt(week.length)+'</span></div><div><span>'+esc(L('Yakın yükleme · 7 gün','Upcoming loading · 7 days'))+'</span><span>'+fmt(near.reduce((s,x)=>s+(x.remaining||0),0))+'</span></div><div><span>'+esc(L('Kritik','Critical'))+'</span><span class="slRed">'+fmt(it.filter(critical).length)+'</span></div></div>'+
      '<div class="slDist">'+[...prio.entries()].slice(0,6).map(([l,n])=>'<span><b>'+esc(l)+'</b> <span class="slMono">'+fmt(n)+'</span></span>').join('')+'</div>';},
  exceptionInbox:()=>{const list=allItems().filter(x=>x.exf&&x.exf<today&&(x.remaining||0)>0).sort((a,b)=>a.exf-b.exf);
    if(!list.length)return '<p class="slMuted">'+esc(L('Ex-Factory\'si geçmiş açık sipariş yok.','No open orders past Ex-Factory.'))+'</p>';
    return '<div class="slMini">'+list.slice(0,40).map(x=>'<div class="slMiniRow'+(critical(x)?' crit':'')+'"><span class="slCode">'+esc(x.v.orderCode)+'</span><span class="slName">'+esc(x.v.modelName)+'</span><span class="slText">'+esc(x.v.manufacturer)+'</span><span class="slMono slRed">'+dm(x.exf)+'</span><span class="slNum">'+fmt(x.remaining)+'</span></div>').join('')+'</div>'+(list.length>40?'<p class="slMuted slSmall">+'+fmt(list.length-40)+'</p>':'');},
  deadline:()=>{const days=[...Array(S.dl)].map((_,d)=>{const day=new Date(today.getTime()+d*DAY);const l=allItems().filter(x=>x.exf&&startOfDay(x.exf).getTime()===day.getTime());return {day,q:l.reduce((s,x)=>s+(x.remaining||0),0),c:l.some(critical)};});const mx=Math.max(1,...days.map(x=>x.q));
    return '<div class="slPick">'+[7,14].map(n=>'<button type="button" data-sl-dl="'+n+'" aria-pressed="'+(S.dl===n)+'">'+n+' '+esc(L('gün','days'))+'</button>').join('')+'</div><div class="slBars">'+days.map(x=>'<div class="slBar" title="'+esc(dmy(x.day)+' · '+fmt(x.q))+'"><i class="'+(x.c?'crit':'')+'" style="height:'+(x.q/mx*100).toFixed(1)+'%"></i><span class="slMono">'+dm(x.day)+'</span></div>').join('')+'</div>';},
  breakdown:()=>{const D={country:L('Ülke','Country'),manufacturer:L('Üretici','Manufacturer'),season:L('Sezon','Season'),buyingGroup:'Buying group'};const m=new Map();allItems().forEach(x=>{const k=String(x.v[S.bd]||'—');m.set(k,(m.get(k)||0)+(x.ordered||0));});const list=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);const mx=Math.max(1,...list.map(x=>x[1]));
    return '<div class="slPick">'+Object.entries(D).map(([k,l])=>'<button type="button" data-sl-bd="'+k+'" aria-pressed="'+(S.bd===k)+'">'+esc(l)+'</button>').join('')+'</div>'+list.map(([k,q])=>'<div class="slBd"><span>'+esc(k)+'</span><span class="slMono">'+fmt(q)+'</span><i style="width:'+(q/mx*100).toFixed(1)+'%"></i></div>').join('');}
};
function classicWidget(key){const w=WIDGETS[key];return '<p class="slMuted">'+esc(pick(w.d))+'</p><p class="slMuted slSmall">'+esc(L('Bu widget önizlemede klasik Genel Bakış\'ta çalışır.','In the preview this widget runs in the classic Overview.'))+'</p><button type="button" class="slLink" data-sl="classic-overview">'+esc(L('Klasik Genel Bakış\'ta aç','Open in classic Overview'))+'</button>';}
function overviewHtml(){
  const l=layout(),P=l.pages[l.page],used=new Set(l.pages.flatMap(p=>p.items.map(i=>i.key)));
  let h='<div class="slTitle"><h2>'+esc(L('Genel Bakış','Overview'))+'</h2><p>'+esc(L('widget\'lı ana ekran · düzen bu cihazda saklanır','widget home · layout is saved on this device'))+'</p><span class="slSp"></span>'+
    (S.edit?'<button type="button" data-sl-ov="drawer" aria-pressed="'+S.drawer+'">'+esc(L('widget ekle','add widget'))+'</button><button type="button" data-sl-ov="compact">'+esc(L('yukarı hizala','align up'))+'</button><button type="button" data-sl-ov="addpage"'+(l.pages.length>=MAX_PAGES?' disabled':'')+'>'+esc(L('sayfa ekle','add page'))+'</button><button type="button" data-sl-ov="delpage">'+esc(L('boş sayfayı sil','delete empty page'))+'</button><button type="button" data-sl-ov="reset">'+esc(L('varsayılan düzen','default layout'))+'</button><button type="button" class="on" data-sl-ov="done">'+esc(L('bitti','done'))+'</button>':'<button type="button" data-sl-ov="edit">'+esc(L('düzenle','edit'))+'</button>')+'</div>';
  h+='<div class="slPages" role="tablist">'+l.pages.map((p,i)=>'<button type="button" role="tab" data-sl-page="'+i+'" aria-selected="'+(l.page===i)+'">'+esc(pageName(p))+' <span class="slMono">'+p.items.length+'</span></button>').join('')+'</div>';
  if(S.edit&&S.drawer)h+='<div class="slDrawer blMotionOverlay">'+Object.entries(GROUPS_W).map(([g,gl])=>'<div><span class="slKdh">'+esc(pick(gl))+'</span>'+Object.entries(WIDGETS).filter(([,w])=>w.group===g).map(([k,w])=>'<button type="button" class="slDw" data-sl-add="'+k+'"'+(used.has(k)?' disabled':'')+'><b>'+esc(pick(w.t))+'</b><span>'+esc(pick(w.d))+'</span><span class="slMono">'+w.w+'×'+w.h+(used.has(k)?' · '+esc(L('yerleşik','placed')):'')+'</span></button>').join('')+'</div>').join('')+'</div>';
  h+='<div class="slGrid'+(S.edit?' editing':'')+'">'+P.items.map(it=>{const w=WIDGETS[it.key];let body='';try{body=w.classic?classicWidget(it.key):W[it.key]();}catch(err){body='<span class="slRed">'+esc(L('Widget çizilemedi','Widget could not be drawn'))+'</span>';}
    return '<div class="slW blMotionEnter" data-w="'+it.key+'" style="grid-column:'+(it.x+1)+' / span '+it.w+';grid-row:'+(it.y+1)+' / span '+it.h+'"><div class="slWh"><span class="slWt">'+esc(pick(w.t))+'</span><span class="slWl"></span>'+
      (S.edit?'<span class="slMono slMuted">'+it.w+'×'+it.h+'</span><button type="button" data-sl-send="'+it.key+'">'+esc(L('sayfaya gönder','send to page'))+'</button><button type="button" data-sl-rm="'+it.key+'" aria-label="'+esc(L('Kaldır','Remove'))+'">×</button>':'')+'</div>'+
      (S.send===it.key?'<div class="slOpt">'+l.pages.map((p,i)=>i===l.page?'':'<button type="button" data-sl-to="'+i+'">'+esc(pageName(p))+'</button>').join('')+'</div>':'')+'<div class="slWb">'+body+'</div>'+(S.edit?'<span class="slResize" aria-hidden="true"></span>':'')+'</div>';}).join('')+'</div>';
  if(!P.items.length)h+='<p class="slLead">'+esc(L('Bu sayfa boş. Düzenle → widget ekle.','This page is empty. Edit → add widget.'))+'</p>';
  return h;
}

/* ------------------------------------------------------------------ 7) SEÇİM VE ALT ÇUBUK */
function rowEls(){return host?[...host.querySelectorAll('.slRow')]:[];}
function selCells(){if(!S.sel)return [];const rows=rowEls(),out=[];const ra=Math.min(S.sel.r0,S.sel.r1),rb=Math.max(S.sel.r0,S.sel.r1),ca=Math.min(S.sel.c0,S.sel.c1),cb=Math.max(S.sel.c0,S.sel.c1);
  for(let r=ra;r<=rb;r++){const line=[];for(let c=ca;c<=cb;c++)line.push(rows[r]?.children[c]||null);out.push(line);}return out;}
const cellPlain=el=>el?el.textContent.replace(/\s+/g,' ').trim():'';
function paint(){
  if(!host)return;host.querySelectorAll('.slCell.sel,.slCell.act').forEach(e=>e.classList.remove('sel','act'));
  const cells=selCells();cells.flat().forEach(el=>el&&el.classList.add('sel'));if(S.sel){const a=rowEls()[S.sel.r1]?.children[S.sel.c1];if(a)a.classList.add('act');}
  const foot=host.querySelector('#slFoot'),meta=host.querySelector('#slMeta');const s=src();
  if(meta){const items=S.view==='cp'?cpItems():allItems();meta.textContent=fmt(items.length)+' '+L('kayıt','records')+' · '+fmt(items.reduce((a,x)=>a+(x.ordered||0),0))+' '+L('adet','pcs')+(s?.cpState?.()!=='ready'?' · '+L('yükleniyor','loading'):'');}
  if(!foot)return;const flat=cells.flat().filter(Boolean);let stat='';
  if(flat.length){const sm=summarize(flat.map(cellPlain).filter(t=>!/^\d{2}\.\d{2}/.test(t)));stat=fmt(flat.length)+' '+L('hücre','cells')+(sm.count>1?' · '+L('toplam','sum')+' '+fmt(sm.sum)+' · '+L('ortalama','average')+' '+dec(sm.avg,sm.avg%1?2:0)+' · '+L('sayı','count')+' '+sm.count:'');}
  foot.innerHTML=(S.view==='cp'?'<span>'+fmt(rowEls().length)+' / '+fmt(cpItems().length)+' '+esc(L('satır','rows'))+'</span>':'<span>'+esc(L('Genel Bakış','Overview'))+'</span>')+(stat?'<span class="slStat">'+esc(stat)+'</span>':'')+'<span class="slSp"></span><span class="slKeys">'+esc(L('tık seç · Shift genişlet · Enter detay · Ctrl C kopyala · salt okunur','click select · Shift extend · Enter detail · Ctrl C copy · read-only'))+'</span>';
}
function toast(text){try{if(typeof root.showToast==='function')root.showToast(text);}catch(_){}}
function copy(text,msg){try{root.navigator.clipboard.writeText(text).then(()=>toast(msg),()=>toast(L('Kopyalanamadı','Copy failed')));}catch(_){toast(L('Kopyalanamadı','Copy failed'));}}

/* ------------------------------------------------------------------ 8) OLAYLAR */
let drag=false,searchTimer=0;
function onClick(e){
  const b=e.target.closest('button');if(!b||!host.contains(b))return;const d=b.dataset;const l=S.view==='overview'?layout():null;
  if(d.slNav){const s=src();if(['overview','cp'].includes(d.slNav)){S.view=d.slNav;save('view',S.view);S.sel=null;S.detail=null;renderAll();if(d.slNav==='cp')ensureData();}else{close();s?.openClassic?.(d.slNav);}return;}
  if(d.sl==='exit'){close();return;}
  if(d.sl==='classic-overview'){close();src()?.openClassic?.('overview');return;}
  if(d.sl==='open-classic'){const idx=+d.index;close();src()?.openClassic?.('cp',idx);return;}
  if(d.slOpt){S.opt=S.opt===d.slOpt?null:d.slOpt;render();return;}
  if(d.slSet!=null){if(d.slSet)S.filters[S.opt]=d.slSet;else delete S.filters[S.opt];S.opt=null;S.limit=300;S.sel=null;render();return;}
  if(d.sl==='clear'){S.filters={};S.opt=null;S.sel=null;render();return;}
  if(d.sl==='table'||d.sl==='report'){S.report=d.sl==='report';save('report',S.report);S.sel=null;render();return;}
  if(d.sl==='more'){S.limit+=300;render();return;}
  if(d.sl==='copy'){const cols=host._cols||[];copy([cols.map(c=>c.label).join('\t')].concat(rowEls().map(r=>[...r.children].map(cellPlain).join('\t'))).join('\n'),L('Görünen satırlar kopyalandı','Visible rows copied'));return;}
  if(d.slGroup){const g=d.slGroup;S.collapsed.has(g)?S.collapsed.delete(g):S.collapsed.add(g);save('collapsed',[...S.collapsed]);S.sel=null;render();return;}
  if(d.slSort){S.sort=S.sort&&S.sort.id===d.slSort?{id:d.slSort,dir:-S.sort.dir}:{id:d.slSort,dir:1};S.sel=null;render();return;}
  if(d.slDl){S.dl=+d.slDl;render();return;}
  if(d.slBd){S.bd=d.slBd;render();return;}
  if(d.slPage!=null){l.page=+d.slPage;S.send=null;saveLayout();render();return;}
  const ov=d.slOv;
  if(ov==='edit'){S.edit=true;render();return;}
  if(ov==='done'){S.edit=false;S.drawer=false;S.send=null;saveLayout();render();return;}
  if(ov==='drawer'){S.drawer=!S.drawer;render();return;}
  if(ov==='compact'){compact(l.pages[l.page].items);saveLayout();render();return;}
  if(ov==='addpage'&&l.pages.length<MAX_PAGES){l.pages.push({name:[L('Sayfa','Page')+' '+(l.pages.length+1),'Page '+(l.pages.length+1)],items:[]});l.page=l.pages.length-1;saveLayout();render();return;}
  if(ov==='delpage'){if(l.pages[l.page].items.length){toast(L('Yalnız boş sayfa silinir','Only an empty page can be deleted'));return;}if(l.pages.length>1){l.pages.splice(l.page,1);l.page=Math.max(0,l.page-1);saveLayout();render();}return;}
  if(ov==='reset'){S.overview=defaultLayout();saveLayout();render();return;}
  if(d.slAdd){const w=WIDGETS[d.slAdd];const P=l.pages[l.page];P.items.push(Object.assign({key:d.slAdd},firstFit(P.items,w.w,w.h)));saveLayout();render();return;}
  if(d.slRm){const P=l.pages[l.page];P.items=P.items.filter(i=>i.key!==d.slRm);saveLayout();render();return;}
  if(d.slSend){S.send=S.send===d.slSend?null:d.slSend;render();return;}
  if(d.slTo!=null){const P=l.pages[l.page],T=l.pages[+d.slTo],it=P.items.find(i=>i.key===S.send);if(it&&T){P.items=P.items.filter(i=>i!==it);Object.assign(it,firstFit(T.items,it.w,it.h));T.items.push(it);}S.send=null;saveLayout();render();}
}
function onMouseDown(e){
  if(e.button!==0)return;
  const rs=S.edit&&e.target.closest('.slResize'),wh=S.edit&&!rs&&!e.target.closest('button')&&e.target.closest('.slWh');
  if(rs||wh){startWidgetDrag(e,!!rs);return;}
  const cell=e.target.closest('.slRow > .slCell');if(!cell||e.target.closest('button,a,input'))return;
  const row=cell.parentElement,r=rowEls().indexOf(row),c=[...row.children].indexOf(cell);
  if(e.shiftKey&&S.sel){S.sel.r1=r;S.sel.c1=c;}else S.sel={r0:r,c0:c,r1:r,c1:c};drag=true;e.preventDefault();paint();
}
function onMouseOver(e){if(!drag||!S.sel)return;const cell=e.target.closest('.slRow > .slCell');if(!cell)return;const row=cell.parentElement;S.sel.r1=rowEls().indexOf(row);S.sel.c1=[...row.children].indexOf(cell);paint();}
function startWidgetDrag(e,resize){
  const sec=e.target.closest('.slW'),grid=sec.parentElement,l=layout(),P=l.pages[l.page],it=P.items.find(i=>i.key===sec.dataset.w);if(!it)return;
  const box=grid.getBoundingClientRect(),cw=(box.width+16)/COLS,rh=56+16,st={x:it.x,y:it.y,w:it.w,h:it.h,px:e.clientX,py:e.clientY};e.preventDefault();sec.classList.add('drag');
  const move=ev=>{const dx=Math.round((ev.clientX-st.px)/cw),dy=Math.round((ev.clientY-st.py)/rh);const next=clampItem(resize?{key:it.key,x:st.x,y:st.y,w:st.w+dx,h:st.h+dy}:{key:it.key,x:st.x+dx,y:st.y+dy,w:st.w,h:st.h},WIDGETS[it.key]);Object.assign(it,next);sec.style.gridColumn=(it.x+1)+' / span '+it.w;sec.style.gridRow=(it.y+1)+' / span '+it.h;};
  const up=()=>{doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerup',up);sec.classList.remove('drag');resolveCollisions(P.items,it.key);saveLayout();render();};
  doc.addEventListener('pointermove',move);doc.addEventListener('pointerup',up);
}
function onKey(e){
  if(!S.open)return;const t=e.target;if(t&&/INPUT|TEXTAREA|SELECT/.test(t.tagName))return;
  if(!S.sel||S.view!=='cp')return;const rows=rowEls();if(!rows.length)return;
  const k=e.key;const nc=rows[0].children.length;
  if(k.startsWith('Arrow')){e.preventDefault();const dlt={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[k];const r=Math.max(0,Math.min(rows.length-1,S.sel.r1+dlt[0])),c=Math.max(0,Math.min(nc-1,S.sel.c1+dlt[1]));
    if(e.shiftKey){S.sel.r1=r;S.sel.c1=c;}else S.sel={r0:r,c0:c,r1:r,c1:c};paint();rows[r]?.scrollIntoView({block:'nearest'});return;}
  if(k==='Enter'){e.preventDefault();const it=ROWMAP[S.sel.r1];if(it){S.detail=S.detail===it.index?null:it.index;const keep=S.sel;render();S.sel=keep;paint();}return;}
  if(k==='Escape'){S.sel=null;paint();}
}
function onCopy(e){if(!S.open||!S.sel)return;const t=doc.activeElement;if(t&&/INPUT|TEXTAREA/.test(t.tagName))return;
  e.clipboardData.setData('text/plain',selCells().map(l=>l.map(cellPlain).join('\t')).join('\n'));e.preventDefault();toast(L('Seçim kopyalandı','Selection copied'));}
function onInput(e){if(e.target.id!=='slSearch')return;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{S.search=e.target.value;S.limit=300;S.sel=null;const pos=e.target.selectionStart;render();},160);}

/* ------------------------------------------------------------------ 9) AÇ / KAPAT */
async function ensureData(){const s=src();if(!s)return;try{if(s.cpState?.()!=='ready'){paint();await s.ensureCp?.();}}catch(_){}if(S.open)render();}
function open(){
  if(S.open)return true;today=startOfDay(new Date());
  host=doc.createElement('div');host.className='blSessiz blMotionOverlay';host.id='blSessiz';host.setAttribute('role','region');host.setAttribute('data-no-i18n','');host.setAttribute('aria-label',L('Sessiz çalışma alanı','Quiet workspace'));
  doc.body.appendChild(host);doc.documentElement.classList.add('blSessizOpen');S.open=true;save('active',true);
  host.addEventListener('click',onClick);host.addEventListener('mousedown',onMouseDown);host.addEventListener('mouseover',onMouseOver);host.addEventListener('input',onInput);
  doc.addEventListener('mouseup',stopDrag);doc.addEventListener('keydown',onKey);doc.addEventListener('copy',onCopy);
  langObserver=new MutationObserver(()=>{cache={rows:null,items:[]};renderAll();});langObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
  clockTimer=setInterval(()=>{if(S.view!=='overview'||doc.visibilityState!=='visible')return;const w=host?.querySelector('.slW[data-w="launchpad"] .slWb');if(w)w.innerHTML=clockHtml();},60000);
  renderAll();ensureData();return true;
}
function stopDrag(){drag=false;}
function close(){
  if(!S.open)return;S.open=false;save('active',false);clearInterval(clockTimer);clockTimer=0;langObserver?.disconnect();langObserver=null;
  doc.removeEventListener('mouseup',stopDrag);doc.removeEventListener('keydown',onKey);doc.removeEventListener('copy',onCopy);
  host?.remove();host=null;doc.documentElement.classList.remove('blSessizOpen');cache={rows:null,items:[]};S.sel=null;S.detail=null;
  try{root.dispatchEvent(new CustomEvent('bl:sessiz-closed'));}catch(_){}
}
function refresh(){cache={rows:null,items:[]};if(S.open)render();}
return Object.freeze({model,open,close,refresh,isOpen:()=>S.open,wasActive:()=>load('active',false)===true});
});
