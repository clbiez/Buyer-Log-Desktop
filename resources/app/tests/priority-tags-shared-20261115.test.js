'use strict';
/* Öncelik Kuralları etiketleri CP dışında da görünür (Global Flow + Backlog).
   Kök neden: Global Flow özel "prio:<slug>" kodunu büyük harfe çevirip
   sözlükte bulamıyordu; takip etiketleri hiç okunmuyordu. Backlog CP
   önceliğini hiç bilmiyordu. Ortak kaynak app-main.js → BLCpPriorityIndex. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const OD=require('../public/order-decision-engine.js');
const flow=require('../public/overview-global-flow.js');
const canonical=require('../public/canonical-fields.js');
const {loadAppMainFunctions}=require('./helpers/app-main-functions');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');

const CATALOG=[
  {id:'CRITICAL'},
  {id:'prio:gecikme-yukleme',tr:'Gecikme - Yükleme Tarihi',en:'Delay - Loading Date',tone:'red',isRisk:true},
  {id:'prio:indirim',tr:'İndirim takibi',en:'Discount watch',tone:'teal',usage:'tracking'},
  {id:'ACTION_TODAY'},{id:'ACTION_THIS_WEEK'},{id:'WATCH'},{id:'ON_TRACK'},
];
function withCatalog(fn){
  const previous=globalThis.BLOrderDecisionEngine;
  globalThis.BLOrderDecisionEngine=OD;OD.setPriorityCatalog(CATALOG);
  try{return fn();}finally{OD.setPriorityCatalog(null);if(previous===undefined)delete globalThis.BLOrderDecisionEngine;else globalThis.BLOrderDecisionEngine=previous;}
}

test('Global Flow özel öncelik kodunu ve etiket adını kaybetmez',()=>withCatalog(()=>{
  assert.equal(flow.actionPriorityCode('prio:gecikme-yukleme'),'prio:gecikme-yukleme');
  assert.equal(flow.actionPriorityCode('Gecikme - Yükleme Tarihi'),'prio:gecikme-yukleme');
  assert.equal(flow.actionPriorityCode('CRITICAL'),'CRITICAL');
  assert.equal(flow.actionPriorityCode('VAR'),'','Backlog risk metni öncelik değildir');
}));

test('CP kaydı ana öncelik + takip etiketlerini taşır ve öncelik filtresiyle süzülür',()=>withCatalog(()=>{
  const row={'Order Code':'1354165','Model Name':'UK.BDY','C.Code':'3CD','Country':'Bangladesh','STATUS':'Üretimde',Priority:'prio:gecikme-yukleme',_trackingTags:['prio:indirim']};
  const other={'Order Code':'1405814','Model Name':'SRT','C.Code':'R34','Country':'Bangladesh','STATUS':'Üretimde',Priority:'ON_TRACK'};
  const [rec]=flow.shipmentPartialsFromRows([row],'cp'),[plain]=flow.shipmentPartialsFromRows([other],'cp');
  assert.equal(rec.actionPriority,'prio:gecikme-yukleme');
  assert.deepEqual(rec.trackingTags,['prio:indirim']);
  assert.deepEqual(rec.priorityTags,['prio:gecikme-yukleme','prio:indirim']);
  assert.ok(flow.FILTER_KEYS.includes('priority'));
  assert.deepEqual(flow.uniqueValues([rec,plain],'priority'),['prio:gecikme-yukleme','prio:indirim','ON_TRACK'],'katalog sırası');
  const byTracking=flow.createPanelFilter({priority:['prio:indirim']});
  assert.equal(byTracking(rec),true);assert.equal(byTracking(plain),false);
}));

test('Backlog kaydı CP ortak öncelik dizininden etiketlenir',()=>withCatalog(()=>{
  const previous=globalThis.BLCpPriorityIndex;
  globalThis.BLCpPriorityIndex={lookup:(order,model,colour)=>order==='1001'&&colour==='01'?{priority:'prio:gecikme-yukleme',trackingTags:['prio:indirim']}:null};
  try{
    const rec=flow.normalizeRecord({'Sipariş Kod':'1001','Model Adı':'M','Renk Kod':'01','Siparişin Üretildiği Ülke':'Bangladesh','GÜNCEL DURUM (STATUS)':'Üretimde','RİSK (PRIORITY)':'VAR'},'backlog',0);
    assert.equal(rec.actionPriority,'prio:gecikme-yukleme');
    assert.deepEqual(rec.priorityTags,['prio:gecikme-yukleme','prio:indirim']);
    const miss=flow.normalizeRecord({'Sipariş Kod':'2002','Siparişin Üretildiği Ülke':'India','GÜNCEL DURUM (STATUS)':'Üretimde'},'backlog',1);
    assert.deepEqual(miss.trackingTags,[]);
  }finally{if(previous===undefined)delete globalThis.BLCpPriorityIndex;else globalThis.BLCpPriorityIndex=previous;}
}));

test('Ortak öncelik dizini sipariş+model+renk eşler, başka rengin etiketini ödünç vermez',()=>withCatalog(()=>{
  const rows=[
    {'Order Code':'1001','Model Name':'M','C.Code':'01',Priority:'prio:gecikme-yukleme',_trackingTags:['prio:indirim']},
    {'Order Code':'1001','Model Name':'M','C.Code':'02',Priority:'WATCH',_trackingTags:[]},
    {'Order Code':'3003','Model Name':'X','C.Code':'09',Priority:'CRITICAL',_trackingTags:[]},
  ];
  const day=new Date().toDateString();
  const api=loadAppMainFunctions(['cpPriorityIdentityPart','cpPriorityIdentity','cpPriorityHeaderKey','cpPriorityIndexReady','priorityIndexFromRows','buildCpPriorityIndex','buildOrdersPriorityIndex','lookupPriorityIn','lookupCpPriority','ordersPriorityReady','ordersPriorityContextKey','ordersPriorityContext','actionPriorityCode','norm'],{
    window:{BLOrderDecisionEngine:OD,BLCanonicalFields:canonical},state:{cp:{rows}},_unifiedPriorityCache:{cp:{rows,day}},_cpPriorityIndex:null,_cpPriorityIdentityCache:new Map(),_unifiedPriorityTableRevision:{cp:1,orders:1},_ordersPriority:{stamp:null},_ordersPriorityIndex:null,_ordersPriorityContextKey:null,
  });
  assert.equal(JSON.stringify(api.lookupCpPriority('1001','m','01')),JSON.stringify({priority:'prio:gecikme-yukleme',trackingTags:['prio:indirim'],source:'cp'}),'büyük/küçük harf duyarsız tam eşleşme');
  assert.equal(api.lookupCpPriority('1001','Başka model','02').priority,'WATCH','sipariş+renk yedeği');
  assert.equal(api.lookupCpPriority('1001','',''),null,'iki renkli siparişte yalnız kodla eşleşme yapılmaz');
  assert.equal(api.lookupCpPriority('3003','','')?.priority,'CRITICAL','tek satırlı siparişte kod yedeği');
  assert.equal(api.lookupCpPriority('3003','X','10'),null,'tek satırlı siparişte farklı renk etiketi ödünç almaz');
  assert.equal(api.lookupCpPriority('3003','Y',''),null,'renk yokken farklı model etiketi ödünç almaz');
  api.context._unifiedPriorityCache.cp=null;
  assert.equal(api.lookupCpPriority('1001','M','01'),null,'önbellek düşünce dizin geçersizdir');
}));

test('Backlog Genel Bakış: Eksik Yükleme ve Riskli adet kutucukları yerine öncelik etiketleri',()=>{
  const src=read('backlog-overview.js'),hero=src.slice(src.indexOf('function hero(s){'),src.indexOf('/* Veri kalitesi şeridi'));
  assert.doesNotMatch(hero,/stageLabel\('SHORTAGE'\)/,'Eksik Yükleme kutucuğu kaldırıldı');
  assert.doesNotMatch(hero,/Riskli adet/,'Riskli adet kutucuğu kaldırıldı');
  assert.match(hero,/priorityTiles\(s,tile,by\)/);
  assert.match(src,/BLCpPriorityIndex/);
  assert.match(src,/const dims=\[\.\.\.R\(\)\.DIMENSIONS,PRIORITY_DIMENSION\]/,'Operasyon dağılımında Öncelik kırılımı');
  assert.match(src,/bl:cp-priority-index-changed/);
  assert.match(read('app-main.js'),/window\.BLCpPriorityIndex=\{/);
});

/* Global Flow haritası: sembol işareti en öncelikli etiketin tonundadır;
   Kritik zaten kırmızı alarmla göründüğü için işaret onu tekrar etmez. */
test('Global Flow etiket özeti katalog sırasıyla ve adetle hesaplanır',()=>withCatalog(()=>{
  const recs=[
    {id:'a',orderKey:'1',qty:10,priorityTags:['CRITICAL','prio:indirim']},
    {id:'b',orderKey:'2',qty:5,priorityTags:['prio:gecikme-yukleme']},
    {id:'c',orderKey:'3',qty:7,priorityTags:['ON_TRACK']},
  ];
  const summary=flow.priorityTagSummary(recs);
  assert.deepEqual(summary.map(e=>[e.code,e.qty,e.orders.size]),[['CRITICAL',10,1],['prio:gecikme-yukleme',5,1],['prio:indirim',10,1]]);
  const src=read('overview-global-flow.js');
  assert.match(src,/PRIORITY_MARKER_SKIP=new Set\(\['ON_TRACK','CRITICAL'\]\)/);
  assert.match(src,/drawPriorityMarker\(ctx,symbol,symbol\.x,symbol\.y,11\*scale,p\);/);
  assert.match(src,/symbol\._priorityTag!==undefined/,'işaret sembol başına bir kez hesaplanır');
}));

test('Excel Backlog V3: Öncelik kırılımı, Kırılımlar sayfası ve detay sütunları',async()=>{
  const V3=require('../public/backlog-v3-report.js');
  const ExcelJS=require('../public/vendor/exceljs.min.js');
  const base={'Sezon':'W26','Buyer':'Ayşe','Siparişin Üretildiği Ülke':'Turkey','Model Adı':'M','Renk Kod':'01','GÜNCEL DURUM\n(STATUS)':'Üretimde','REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)':'2026-09-25'};
  const rows=[{...base,'Sipariş Kod':'1001','Adet':100},{...base,'Sipariş Kod':'1002','Adet':40},{...base,'Sipariş Kod':'9999','Adet':5}];
  const hits={'1001':{priority:'prio:gecikme-yukleme',trackingTags:['prio:indirim']},'1002':{priority:'CRITICAL',trackingTags:[]}};
  const labels={'prio:gecikme-yukleme':'Gecikme - Yükleme Tarihi','prio:indirim':'İndirim takibi',CRITICAL:'Kritik'};
  const ranks={CRITICAL:0,'prio:gecikme-yukleme':1};
  const priority={lookup:order=>hits[order]||null,label:code=>labels[code]||code,rank:code=>ranks[code]??9};
  const out=await V3.buildXlsx({rows,headers:['Sipariş Kod','Adet'],groupBy:'priority',priority},{ExcelJS,lang:'tr',today:'2026-10-02'});
  const book=new ExcelJS.Workbook();await book.xlsx.load(out.data);
  const texts=ws=>{const all=[];ws.eachRow(r=>r.eachCell(c=>{if(typeof c.value==='string')all.push(c.value);}));return all;};
  const dash=texts(book.worksheets[0]);
  assert.ok(dash.includes('Öncelik kırılımı'),'Özet kırılımı Öncelik: '+dash.slice(0,40).join('|'));
  const order=[...new Set(dash.slice(dash.indexOf('Öncelik kırılımı')))].filter(v=>['Kritik','Gecikme - Yükleme Tarihi','(öncelik eşleşmesi yok)'].includes(v));
  assert.deepEqual(order.slice(0,3),['Kritik','Gecikme - Yükleme Tarihi','(öncelik eşleşmesi yok)'],'katalog sırası');
  const br=texts(book.getWorksheet('Kırılımlar'));
  assert.equal(br.filter(v=>v==='Öncelik')[0],'Öncelik');
  const detail=book.getWorksheet('Backlog V3');
  assert.equal(detail.getCell('C1').value,'Öncelik');assert.equal(detail.getCell('D1').value,'Takip etiketleri');
  assert.equal(detail.getCell('C2').value,'Gecikme - Yükleme Tarihi');assert.equal(detail.getCell('D2').value,'İndirim takibi');
  const plain=await V3.buildXlsx({rows,headers:['Sipariş Kod'],groupBy:'priority'},{ExcelJS,lang:'tr',today:'2026-10-02'});
  const plainBook=new ExcelJS.Workbook();await plainBook.xlsx.load(plain.data);
  assert.notEqual(plainBook.getWorksheet('Backlog V3').getCell('C1').value,'Öncelik','dizin yoksa rapor değişmez');
  assert.ok(texts(plainBook.worksheets[0]).some(v=>/kırılımı$/.test(v)&&v!=='Öncelik kırılımı'),'dizin yoksa Buyer kırılımına düşer');
});

test('Backlog Zaman Akışı: Öncelik alt kırılımı ana öncelikle yığılır, renk katalog tonundan',()=>{
  const src=read('backlog-overview.js');
  assert.match(src,/const TIMELINE_DIMENSIONS=\['buyingGroup','buyer',PRIORITY_DIMENSION\]/);
  assert.match(src,/data-blv-timeline-dim="\$\{PRIORITY_DIMENSION\}"/,'seçicide Öncelik düğmesi');
  assert.match(src,/state\.timelineDimension=timelineDimensionKey\(t\.dataset\.blvTimelineDim\)/,'bilinmeyen değer Buyer Grup’a düşer');
  assert.match(src,/dimension===PRIORITY_DIMENSION\?priorityGroupsOf\(list\)/,'ana öncelik gruplaması (toplam = dönem adedi)');
  assert.match(src,/dimension===PRIORITY_DIMENSION\?priorityToneVar\(g\.code\):timelineGroupColor\(index\)/,'renk katalog tonundan');
  assert.match(src,/dimension===PRIORITY_DIMENSION\?timelineTrackingTipRows\(bucket&&bucket\.items\):''/,'takip etiketleri yalnız ipucunda');
  const tokens=src.match(/const PRIORITY_TONE_TOKEN=\{([^}]*)\}/)[1];
  for(const tone of OD.PRIORITY_TONES)assert.match(tokens,new RegExp(tone+":'--ui-"),`ton eşlemesi eksik: ${tone}`);
});
