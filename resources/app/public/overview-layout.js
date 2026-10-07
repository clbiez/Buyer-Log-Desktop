/* Genel Bakış · Ana ekran yerleşim motoru (v2).

   Android ana ekranı modeli: sabit sütunlu hücre ızgarası, birden çok sayfa,
   her widget için {x,y,w,h} hücre konumu ve widget başına min/max boyut
   sözleşmesi. Bu dosya SAF mantıktır (DOM yok): yerleştirme, çakışmada aşağı
   itme, boşluk kapatma, ilk uygun yer bulma, sayfa işlemleri ve v1 kayıtlarının
   güvenli taşınması. DOM denetleyicisi overview-home.js'tedir. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewLayout=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const VERSION=2;
  const COLS=12;
  const MAX_PAGES=5;
  const MAX_ROWS=80;
  /* Widget kataloğu. Boyutlar hücre cinsindendir; presets widget çekmecesinde
     ve klavye kısayollarında kullanılır. `group` çekmecedeki kategoridir. */
  const REGISTRY=Object.freeze({
    launchpad:{icon:'clock',group:'today',tr:'Dünya Saatleri',en:'World Clocks',descTr:'Selamlama ve çalıştığın ülkelerin canlı saatleri.',descEn:'Greeting and live clocks of the countries you work with.',w:12,h:3,minW:3,minH:2,maxW:12,maxH:5},
    productionFocus:{icon:'bl-cp',group:'operations',tr:'Üretim Odağı',en:'Production Focus',descTr:'Öncelik dağılımı, risk nedenleri ve kontrol listesi.',descEn:'Priority mix, risk reasons and checklist.',w:8,h:6,minW:4,minH:4,maxW:12,maxH:12},
    notes:{icon:'notebook',group:'operations',tr:'Not Hatırlatıcısı',en:'Notes Reminder',descTr:'Yalnız senin yazdığın CP notları.',descEn:'Only the CP notes you wrote.',w:4,h:6,minW:3,minH:3,maxW:12,maxH:12},
    breakdown:{icon:'chart-bar',group:'operations',tr:'Aktif Sipariş Kırılımı',en:'Active Order Breakdown',descTr:'Ülke, alt üretici, sezon ve buying group dağılımı tek grafikte.',descEn:'Country, sub-manufacturer, season and buying group in one chart.',w:6,h:7,minW:3,minH:4,maxW:12,maxH:14},
    attention:{icon:'alert-triangle',group:'operations',tr:'Aksiyon Gerekenler',en:'Orders Requiring Attention',descTr:'Bugün müdahale bekleyen sipariş satırları.',descEn:'Order rows that need action today.',w:6,h:7,minW:4,minH:4,maxW:12,maxH:16},
    dataCoverage:{icon:'checklist',group:'operations',tr:'Veri Kapsamı',en:'Data Coverage',descTr:'Eksik tarih/kural sayıları ve takip dışı alanlar.',descEn:'Missing dates/rules and untracked fields.',w:4,h:5,minW:3,minH:3,maxW:12,maxH:12},
    globalFlowMap:{icon:'globe',group:'operations',tr:'Global Flow Map',en:'Global Flow Map',descTr:'Üretim ve sevkiyat akışı haritası.',descEn:'Production and shipment flow map.',w:12,h:9,minW:5,minH:5,maxW:12,maxH:16},
    collectionSummary:{icon:'table',group:'commercial',tr:'Koleksiyon',en:'Collection',descTr:'Aylık adet, model görselleri ve status dağılımı.',descEn:'Monthly quantity, model images and status mix.',w:12,h:3,minW:4,minH:3,maxW:12,maxH:12},
    oab:{icon:'chart-histogram',group:'commercial',tr:'OAB',en:'OAB',descTr:'Order-Assortment-Budget pivotu.',descEn:'Order-Assortment-Budget pivot.',w:12,h:8,minW:6,minH:4,maxW:12,maxH:20},
    intake:{icon:'database-import',group:'commercial',tr:'INTAKE',en:'INTAKE',descTr:'INTAKE bütçe pivotu.',descEn:'INTAKE budget pivot.',w:12,h:8,minW:6,minH:4,maxW:12,maxH:20},
  });
  const WIDGETS=Object.freeze(Object.keys(REGISTRY));
  const DEFAULT_PAGES=Object.freeze([
    {name:{tr:'Operasyon',en:'Operations'},items:[
      {key:'launchpad',x:0,y:0,w:12,h:3},
      {key:'productionFocus',x:0,y:3,w:8,h:6},
      {key:'notes',x:8,y:3,w:4,h:6},
      {key:'breakdown',x:0,y:9,w:6,h:7},
      {key:'attention',x:6,y:9,w:6,h:7},
      {key:'globalFlowMap',x:0,y:16,w:8,h:9},
      {key:'dataCoverage',x:8,y:16,w:4,h:9},
    ]},
    {name:{tr:'Ticari',en:'Commercial'},items:[
      {key:'collectionSummary',x:0,y:0,w:12,h:3},
      {key:'oab',x:0,y:3,w:12,h:8},
      {key:'intake',x:0,y:11,w:12,h:8},
    ]},
  ]);
  /* v1 → v2 taşıması için eski anahtarlar. */
  const V1_WIDTH_COLS=Object.freeze({full:12,threeQuarter:9,twoThirds:8,half:6,third:4,quarter:3});
  const V1_BREAKDOWN_KEYS=Object.freeze(['country','subManufacturer','season','buyingGroup']);
  const V1_ROW_PX=64,V1_GAP_PX=16;

  const int=(value,fallback=0)=>{const n=Math.round(Number(value));return Number.isFinite(n)?n:fallback;};
  const clampNum=(value,min,max)=>Math.max(min,Math.min(max,value));
  function spec(key){return REGISTRY[key]||null;}
  function clampItem(item){
    const s=spec(item&&item.key);if(!s)return null;
    const w=clampNum(int(item.w,s.w),s.minW,Math.min(s.maxW,COLS));
    const h=clampNum(int(item.h,s.h),s.minH,s.maxH);
    const x=clampNum(int(item.x,0),0,COLS-w);
    const y=clampNum(int(item.y,0),0,MAX_ROWS);
    return {key:item.key,x,y,w,h};
  }
  function overlaps(a,b){return a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;}
  function byPosition(a,b){return a.y-b.y||a.x-b.x;}
  function cloneItems(items){return (Array.isArray(items)?items:[]).map(item=>({...item}));}
  /* Sabit tutulan widget'a çarpan diğerleri yer açar: önce aynı satırda en
     yakın boş sütuna kayar (Android'de komşu widget'ın yana çekilmesi), yer
     yoksa çarpışma kalmayana dek aşağı itilir. Yukarıdan aşağı sırayla
     yerleşir; kayan/itilen widget da zinciri sürdürür. */
  function resolveCollisions(items,fixedKey){
    const list=cloneItems(items),fixed=list.find(item=>item.key===fixedKey);
    const settled=fixed?[fixed]:[];
    list.filter(item=>item!==fixed).sort(byPosition).forEach(item=>{
      if(settled.some(other=>overlaps(item,other))){
        const origin=item.x,columns=[];
        for(let x=0;x+item.w<=COLS;x++)columns.push(x);
        columns.sort((a,b)=>Math.abs(a-origin)-Math.abs(b-origin)||a-b);
        const free=columns.find(x=>!settled.some(other=>overlaps({...item,x},other)));
        if(free!==undefined)item.x=free;
        else{let guard=0,hit;while((hit=settled.find(other=>overlaps(item,other)))&&guard++<400)item.y=hit.y+hit.h;}
      }
      settled.push(item);
    });
    return list;
  }
  /* Tüm widget'ları yukarı doğru boşluk kalmayacak şekilde kaydırır. */
  function compact(items){
    const placed=[];
    cloneItems(items).sort(byPosition).forEach(item=>{
      while(item.y>0&&!placed.some(other=>overlaps({...item,y:item.y-1},other)))item.y--;
      placed.push(item);
    });
    return placed;
  }
  function firstFit(items,w,h){
    const list=Array.isArray(items)?items:[];
    for(let y=0;y<=MAX_ROWS;y++){
      for(let x=0;x+w<=COLS;x++){
        const probe={x,y,w,h};
        if(!list.some(other=>overlaps(probe,other)))return {x,y};
      }
    }
    return {x:0,y:rows(list)};
  }
  function rows(items){return (Array.isArray(items)?items:[]).reduce((max,item)=>Math.max(max,item.y+item.h),0);}
  function sizeClass(item){
    const w=int(item&&item.w,12),h=int(item&&item.h,4);
    return {w:w<=3?'s':w<=6?'m':w<=9?'l':'xl',h:h<=2?'s':h<=4?'m':h<=7?'l':'xl'};
  }
  function pageName(page,index,lang){
    const name=page&&page.name;
    if(name&&typeof name==='object'){const text=String(name[lang==='en'?'en':'tr']||name.tr||name.en||'').trim();if(text)return text;}
    if(typeof name==='string'&&name.trim())return name.trim();
    return (lang==='en'?'Page ':'Sayfa ')+(index+1);
  }
  function cleanPageName(value){
    if(value&&typeof value==='object'){
      const tr=String(value.tr||'').trim().slice(0,40),en=String(value.en||'').trim().slice(0,40);
      return tr||en?{tr:tr||en,en:en||tr}:null;
    }
    const text=String(value||'').trim().slice(0,40);return text||null;
  }
  function blankState(){return {version:VERSION,page:0,known:WIDGETS.slice(),pages:[]};}
  function defaults(){
    const state=blankState();
    state.pages=DEFAULT_PAGES.map(page=>({name:{...page.name},items:page.items.map(item=>clampItem(item))}));
    return state;
  }
  /* Eski tek sütunlu sıra/genişlik düzeni tek sayfaya akış sırasıyla yerleşir;
     yarım/üçte bir genişlikler yan yana dizilir. Kullanıcının gizledikleri gizli
     kalır; CP Öncelik Radarı Üretim Odağı'na, dört kırılım tek widget'a katıldı. */
  function migrateV1(input){
    const detail=input.details&&typeof input.details==='object'?input.details:{};
    const pageOrder=Array.isArray(input.order)?input.order.map(String):[];
    const detailOrder=(Array.isArray(detail.order)?detail.order.map(String):[]).concat(['productionFocus','attention','dataCoverage',...V1_BREAKDOWN_KEYS]);
    const pageHidden=new Set(Array.isArray(input.hidden)?input.hidden.map(String):[]);
    const detailHidden=new Set(Array.isArray(detail.hidden)?detail.hidden.map(String):[]);
    const widths={...(input.widths||{})},heights={...(input.heights||{})};
    const detailWidths={...(detail.widths||{})},detailHeights={...(detail.heights||{})};
    const flat=[];const push=(key,width,height,hidden)=>{if(!REGISTRY[key]||flat.some(item=>item.key===key))return;flat.push({key,width,height,hidden});};
    const expandDetails=hiddenParent=>{
      const seen=new Set();
      detailOrder.forEach(key=>{
        if(seen.has(key))return;seen.add(key);
        if(key==='priorityRadar')return;
        if(V1_BREAKDOWN_KEYS.includes(key)){
          if(flat.some(item=>item.key==='breakdown'))return;
          const allHidden=V1_BREAKDOWN_KEYS.every(k=>detailHidden.has(k));
          push('breakdown','half',detailHeights[key],hiddenParent||allHidden);return;
        }
        push(key,detailWidths[key],detailHeights[key],hiddenParent||detailHidden.has(key));
      });
    };
    const order=pageOrder.length?pageOrder:['launchpad','globalFlowMap','notes','collectionSummary','oab','intake','overviewContent'];
    order.forEach(key=>{
      if(key==='overviewContent'){expandDetails(pageHidden.has('overviewContent'));return;}
      push(key,widths[key],heights[key],pageHidden.has(key));
    });
    if(!order.includes('overviewContent'))expandDetails(pageHidden.has('overviewContent'));
    ['launchpad','globalFlowMap','notes','collectionSummary','oab','intake'].forEach(key=>push(key,widths[key],heights[key],pageHidden.has(key)));
    const items=[];
    flat.forEach(entry=>{
      if(entry.hidden)return;
      const s=REGISTRY[entry.key];
      const w=V1_WIDTH_COLS[entry.width]||(entry.key==='breakdown'?6:s.w);
      const px=int(entry.height,0);
      const h=px>=120?Math.round((px+V1_GAP_PX)/(V1_ROW_PX+V1_GAP_PX)):s.h;
      const sized=clampItem({key:entry.key,x:0,y:0,w,h});
      const at=firstFit(items,sized.w,sized.h);
      items.push({...sized,...at});
    });
    const state=blankState();
    state.pages=[{name:null,items}];
    return state;
  }
  function normalize(value){
    const input=value&&typeof value==='object'?value:null;
    if(!input)return defaults();
    if(input.version!==VERSION)return ('order' in input||'details' in input||'widths' in input||'hidden' in input)?migrateV1(input):defaults();
    const known=new Set((Array.isArray(input.known)?input.known:[]).filter(key=>REGISTRY[key]));
    const placed=new Set();
    let pages=(Array.isArray(input.pages)?input.pages:[]).slice(0,MAX_PAGES).map(page=>{
      const items=[];
      (Array.isArray(page&&page.items)?page.items:[]).forEach(raw=>{
        const item=clampItem(raw);if(!item||placed.has(item.key))return;
        placed.add(item.key);items.push(item);
      });
      /* Bozuk kayıtta çakışan konumlar sabit sıra ile çözülür. */
      const clean=[];items.sort(byPosition).forEach(item=>{
        let guard=0,hit;while((hit=clean.find(other=>overlaps(item,other)))&&guard++<400)item.y=hit.y+hit.h;clean.push(item);
      });
      return {name:cleanPageName(page&&page.name),items:clean};
    });
    if(!pages.length)pages=[{name:null,items:[]}];
    /* Sonradan eklenen yeni widget'lar ilk sayfada ilk uygun yere yerleşir;
       kullanıcının kaldırdıkları (known ama yerleşmemiş) gizli kalır. */
    WIDGETS.forEach(key=>{
      if(known.has(key)||placed.has(key))return;
      const s=REGISTRY[key],target=pages[0],at=firstFit(target.items,s.w,s.h);
      target.items.push({key,x:at.x,y:at.y,w:s.w,h:s.h});placed.add(key);
    });
    const page=clampNum(int(input.page,0),0,pages.length-1);
    return {version:VERSION,page,known:WIDGETS.slice(),pages};
  }
  function locate(state,key){
    for(let p=0;p<state.pages.length;p++){const index=state.pages[p].items.findIndex(item=>item.key===key);if(index>=0)return {page:p,index,item:state.pages[p].items[index]};}
    return null;
  }
  function hiddenWidgets(state){const s=normalize(state);return WIDGETS.filter(key=>!locate(s,key));}
  /* Widget'ı hedef hücreye taşır (gerekirse başka sayfaya); çarpışanları iter. */
  function moveWidget(state,key,x,y,page){
    const next=normalize(state),found=locate(next,key);if(!found)return next;
    const target=Number.isInteger(page)?clampNum(page,0,next.pages.length-1):found.page;
    next.pages[found.page].items.splice(found.index,1);
    const item=clampItem({...found.item,x,y});
    next.pages[target].items.push(item);
    next.pages[target].items=resolveCollisions(next.pages[target].items,key);
    return next;
  }
  function resizeWidget(state,key,rect){
    const next=normalize(state),found=locate(next,key);if(!found)return next;
    const s=REGISTRY[key],r=rect||{};
    let w=clampNum(int(r.w,found.item.w),s.minW,Math.min(s.maxW,COLS)),h=clampNum(int(r.h,found.item.h),s.minH,s.maxH);
    let x=int(r.x,found.item.x),y=int(r.y,found.item.y);
    x=clampNum(x,0,COLS-w);y=Math.max(0,y);
    next.pages[found.page].items[found.index]={key,x,y,w,h};
    next.pages[found.page].items=resolveCollisions(next.pages[found.page].items,key);
    return next;
  }
  function addWidget(state,key,page){
    const next=normalize(state);if(!REGISTRY[key]||locate(next,key))return next;
    const target=clampNum(int(page,next.page),0,next.pages.length-1),s=REGISTRY[key],at=firstFit(next.pages[target].items,s.w,s.h);
    next.pages[target].items.push({key,x:at.x,y:at.y,w:s.w,h:s.h});
    return next;
  }
  function removeWidget(state,key){
    const next=normalize(state),found=locate(next,key);if(!found)return next;
    next.pages[found.page].items.splice(found.index,1);return next;
  }
  function sendToPage(state,key,page){
    const next=normalize(state),found=locate(next,key);if(!found)return next;
    const target=clampNum(int(page,0),0,next.pages.length-1);if(target===found.page)return next;
    next.pages[found.page].items.splice(found.index,1);
    const at=firstFit(next.pages[target].items,found.item.w,found.item.h);
    next.pages[target].items.push({...found.item,...at});return next;
  }
  function addPage(state){
    const next=normalize(state);if(next.pages.length>=MAX_PAGES)return next;
    next.pages.push({name:null,items:[]});next.page=next.pages.length-1;return next;
  }
  /* Yalnız boş sayfa silinir; son sayfa hiçbir zaman silinmez. */
  function removePage(state,page){
    const next=normalize(state),index=int(page,next.page);
    if(next.pages.length<=1||!next.pages[index]||next.pages[index].items.length)return next;
    next.pages.splice(index,1);next.page=clampNum(next.page>=index?next.page-1:next.page,0,next.pages.length-1);return next;
  }
  function compactPage(state,page){
    const next=normalize(state),index=clampNum(int(page,next.page),0,next.pages.length-1);
    next.pages[index].items=compact(next.pages[index].items);return next;
  }
  function setPage(state,page){const next=normalize(state);next.page=clampNum(int(page,0),0,next.pages.length-1);return next;}
  function renamePage(state,page,name){
    const next=normalize(state),index=int(page,next.page);if(!next.pages[index])return next;
    next.pages[index].name=cleanPageName(name);return next;
  }
  return {
    VERSION,COLS,MAX_PAGES,MAX_ROWS,REGISTRY,widgets:WIDGETS,spec,
    defaults,normalize,migrateV1,clampItem,overlaps,resolveCollisions,compact,firstFit,rows,sizeClass,pageName,
    locate,hiddenWidgets,moveWidget,resizeWidget,addWidget,removeWidget,sendToPage,addPage,removePage,compactPage,setPage,renamePage,
  };
});
