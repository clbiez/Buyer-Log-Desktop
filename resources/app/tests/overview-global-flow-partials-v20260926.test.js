'use strict';
/* Global Flow Map — parsiyel bazlı sevkiyat motoru regresyonları.
   Her senaryo execution packet VALIDATION listesindeki bir maddeyi korur. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const flow=require('../public/overview-global-flow.js');
const parse=require('../server/lib/parse.js');
const userPreferences=require('../server/lib/user-preferences.js');
const ROOT=path.join(__dirname,'..');
const SOURCE=fs.readFileSync(path.join(ROOT,'public','overview-global-flow.js'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const USER_STORAGE=fs.readFileSync(path.join(ROOT,'public','user-storage.js'),'utf8');
const DAY=86400000;
const NOW=Date.UTC(2026,8,26);
const iso=ms=>new Date(ms).toISOString().slice(0,10);

function cpRow(extra={}){
  return {'Order Code':'1001','Model Name':'MODEL-1','C.Code':'01','Colour':'SİYAH','PLM ID':'55','Season':'W26','Country':'Bangladesh','Manufacturer':'SUP','Buyer':'Ayşe','Buyer Grup (TR)':'WOMEN','STATUS':'Üretimde','Del. Type':'Gemi','Order Quantity':1000,'Priority':'',...extra};
}
function segment(extra={}){return {id:'partial-0',kind:'partial',partialNo:1,quantity:100,status:'Yol Operasyonları',arrival:null,delType:'Gemi',handover:null,sourceRow:null,importFile:'',containerNo:'',vesselName:'',...extra};}
function transitRec(id,extra={}){
  const [rec]=flow.shipmentPartialsFromRows([cpRow({'Order Code':id,_logisticSegments:[segment({sourceRow:Number(String(id).replace(/\D/g,''))||1,...extra})]})],'cp');
  return rec;
}
const SEA_RULES=[{delType:'Gemi',days:70,countries:['Bangladesh','India'],seasons:[]},{delType:'Gemi + Uçak',days:35,countries:['Bangladesh','India'],seasons:[]},{delType:'Uçak',days:15,countries:[],seasons:[]}];

test('1 · aynı Order Code: Production parsiyeli ile Depo parsiyeli ayrı varlık ve konumdadır',()=>{
  const rows=[cpRow({_logisticSegments:[
    segment({id:'production-0',kind:'production',partialNo:null,quantity:300,status:'Üretimde',delType:'Gemi'}),
    segment({id:'partial-0',kind:'partial',partialNo:1,quantity:700,status:'Depoda',sourceRow:4,importFile:'IMP-1'}),
  ]})];
  const records=flow.shipmentPartialsFromRows(rows,'cp');
  assert.equal(records.length,2,'sipariş tek kayda indirgenmemeli');
  assert.notEqual(records[0].id,records[1].id);
  assert.deepEqual(records.map(r=>r.state),['production','arrived']);
  assert.deepEqual(records.map(r=>r.qty),[300,700]);
  const model=flow.buildFlowModel(records,{rules:[],now:NOW});
  const origin=model.nodes.find(n=>n.kind==='origin'),arrival=model.nodes.find(n=>n.kind==='arrival');
  assert.equal(origin.location.name,'Bangladesh');assert.equal(arrival.location.name,'İstanbul');
  assert.deepEqual(origin.records.map(r=>r.qty),[300]);assert.deepEqual(arrival.records.map(r=>r.qty),[700]);
});

test('2 · aynı Gemi Ad taşıyan parsiyeller aynı segmentte tek araçta toplanır; detayda tüm çocuklar vardır',()=>{
  const records=[
    transitRec('A1',{vesselName:'MSC Aurora',handover:iso(NOW-20*DAY)}),
    transitRec('A2',{vesselName:'  msc   AURORA ',handover:iso(NOW-24*DAY)}),
    transitRec('A3',{vesselName:'MSC AURORA',handover:iso(NOW-10*DAY)}),
    transitRec('A4',{vesselName:'EVER GIVEN',handover:iso(NOW-20*DAY)}),
  ];
  const model=flow.buildFlowModel(records,{rules:SEA_RULES,now:NOW});
  assert.equal(model.vehicles.length,2);
  const aurora=model.vehicles.find(v=>v.vesselKey==='msc aurora');
  assert.equal(aurora.records.length,3);assert.equal(aurora.mode,'sea');
  assert.deepEqual(aurora.records.map(r=>r.orderCode).sort(),['A1','A2','A3']);
  assert.match(aurora.legKey,/^sea:/);
});

test('3 · Gemi Ad boşsa yakın ilerleme birlikte, belirgin farklı ilerleme ayrı kümelenir',()=>{
  const records=[
    transitRec('B1',{handover:iso(NOW-21*DAY)}), // 0.30
    transitRec('B2',{handover:iso(NOW-23*DAY)}), // ~0.33
    transitRec('B3',{handover:iso(NOW-49*DAY)}), // 0.70
  ];
  const model=flow.buildFlowModel(records,{rules:SEA_RULES,now:NOW});
  assert.equal(model.vehicles.length,2);
  const sizes=model.vehicles.map(v=>v.records.map(r=>r.orderCode).sort().join(',')).sort();
  assert.deepEqual(sizes,['B1,B2','B3']);
});

function assertColomboSeaAir(country){
  const legs=flow.routeLegsFor(country,'sea-air');
  assert.equal(legs.length,2);
  assert.equal(legs[0].mode,'sea');assert.equal(legs[0].from,country);assert.equal(legs[0].to,'Colombo');
  const last=legs[0].points.at(-1);assert.ok(Math.abs(last.lon-flow.COLOMBO.lon)<.001&&Math.abs(last.lat-flow.COLOMBO.lat)<.001);
  assert.equal(legs[1].mode,'air');assert.equal(legs[1].from,'Colombo');assert.equal(legs[1].to,'İstanbul');
  assert.deepEqual(legs[1].points.map(p=>[p.lon,p.lat]),[[flow.COLOMBO.lon,flow.COLOMBO.lat],[flow.ISTANBUL.lon,flow.ISTANBUL.lat]]);
  // Konum: yol süresinin deniz kısmı bitmeden deniz ayağında, sonra hava ayağında.
  const early=transitRec('C1',{delType:'Gemi + Uçak',handover:iso(NOW-10*DAY)});early.country=country;early.origin=flow.countryCoordinate(country);
  const late=transitRec('C2',{delType:'Gemi + Uçak',handover:iso(NOW-34*DAY)});late.country=country;late.origin=flow.countryCoordinate(country);
  assert.equal(flow.transitPlacement(early,SEA_RULES,NOW).leg.mode,'sea');
  assert.equal(flow.transitPlacement(late,SEA_RULES,NOW).leg.mode,'air');
}
test('4 · Bangladesh Gemi+Uçak: Bangladesh → Colombo deniz, Colombo → İstanbul hava',()=>assertColomboSeaAir('Bangladesh'));
test('5 · India Gemi+Uçak aynı Colombo aktarmasını kullanır',()=>assertColomboSeaAir('India'));

test('6 · saf deniz / saf hava rotasına Colombo zorla eklenmez',()=>{
  const isColombo=p=>Math.abs(p.lon-flow.COLOMBO.lon)<.001&&Math.abs(p.lat-flow.COLOMBO.lat)<.001;
  for(const country of ['Bangladesh','India']){
    const sea=flow.routeLegsFor(country,'sea');assert.equal(sea.length,1);assert.equal(sea[0].to,'İstanbul');assert.ok(!sea[0].points.some(isColombo));
    const air=flow.routeLegsFor(country,'air');assert.equal(air.length,1);assert.equal(air[0].mode,'air');assert.equal(air[0].points.length,2);assert.ok(!air[0].points.some(isColombo));
    assert.deepEqual(flow.seaRouteCoordinates(country),sea[0].points,'saf deniz rotası değişmemeli');
  }
  const pk=flow.routeLegsFor('Pakistan','sea-air');assert.equal(pk[0].to,'Dubai','Colombo yalnız Bangladesh/India multimodalına uygulanır');
});

test('7 · Bangladesh + India Colombo → İstanbul ortak segmenti tek shared trunk olarak çizilir',()=>{
  const bd=transitRec('D1',{delType:'Gemi + Uçak',handover:iso(NOW-20*DAY)});
  const inRow=flow.shipmentPartialsFromRows([cpRow({'Order Code':'D2','Country':'India',_logisticSegments:[segment({delType:'Gemi + Uçak',sourceRow:2,handover:iso(NOW-20*DAY)})]})],'cp')[0];
  const model=flow.buildFlowModel([bd,inRow],{rules:SEA_RULES,now:NOW});
  const air=model.edges.filter(e=>e.mode==='air');
  assert.equal(air.length,1,'ortak hava ayağı tek kenar olmalı');
  assert.deepEqual([...air[0].origins].sort(),['Bangladesh','India']);
  assert.equal(air[0].records.length,2);
  const keys=model.edges.map(e=>e.key);assert.equal(new Set(keys).size,keys.length,'hiçbir kenar iki kez çizilmemeli');
  // Aynı koridoru paylaşan saf deniz rotaları da ortak kenarlarda birleşir.
  const seaBd=transitRec('D3',{handover:iso(NOW-5*DAY)}),seaIn=flow.shipmentPartialsFromRows([cpRow({'Order Code':'D4','Country':'India',_logisticSegments:[segment({sourceRow:9,handover:iso(NOW-5*DAY)})]})],'cp')[0];
  const seaModel=flow.buildFlowModel([seaBd,seaIn],{rules:SEA_RULES,now:NOW});
  assert.ok(seaModel.edges.some(e=>e.origins.size===2),'Kızıldeniz/Süveyş koridoru ortak olmalı');
  assert.ok(seaModel.edges.some(e=>e.origins.size===1),'ülkeye özgü başlangıç kenarları ayrı kalmalı');
});

test('8 · aynı İstanbul koordinatındaki semboller birbirini kapatmaz ve tek tek seçilebilir',()=>{
  for(const count of [2,3,9]){
    const symbols=Array.from({length:count},(_,i)=>({id:'s'+i,x:400,y:120}));
    flow.resolveSymbolCollisions(symbols,flow.SYMBOL_MIN_DISTANCE);
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)assert.ok(Math.hypot(symbols[i].x-symbols[j].x,symbols[i].y-symbols[j].y)>=flow.SYMBOL_MIN_DISTANCE-1e-6,'çakışma çözülmeli ('+count+')');
    const targets=symbols.map(s=>({type:'vehicle',id:s.id,x:s.x,y:s.y,r:flow.SYMBOL_MIN_DISTANCE/2,priority:90}));
    symbols.forEach(s=>assert.equal(flow.pickHit(targets,s.x,s.y).id,s.id));
    assert.ok(symbols.every(s=>s.anchorX===400&&s.anchorY===120&&s.displaced));
  }
  const alone=[{id:'x',x:10,y:10},{id:'y',x:200,y:200}];flow.resolveSymbolCollisions(alone,22);
  assert.deepEqual(alone.map(s=>[s.x,s.y,s.displaced]),[[10,10,false],[200,200,false]]);
});

test('8b · yakın araçlar düşük zoomda kümelenir, yüksek zoomda tekilleşir',()=>{
  const make=(id,x,mode,country)=>({id,x,y:100,kind:'vehicle',vehicle:{id,mode,records:[{id:'r-'+id,country,mode,origin:{name:country}}]}});
  const symbols=[make('a',100,'sea','Bangladesh'),make('b',122,'air','India'),make('c',190,'road','Pakistan')];
  const compact=flow.clusterVehicleSymbols(symbols,30);
  assert.equal(compact.length,2);
  const cluster=compact.find(item=>item.kind==='vehicleCluster');assert.ok(cluster);assert.equal(cluster.vehicles.length,2);assert.equal(cluster.records.length,2);
  const zoomed=flow.clusterVehicleSymbols(symbols,10);assert.equal(zoomed.length,3);assert.ok(zoomed.every(item=>item.kind==='vehicle'));
  assert.ok(flow.vehicleClusterDistanceForZoom(1)>flow.vehicleClusterDistanceForZoom(16),'zoom arttıkça cluster yarıçapı küçülmeli');
});

test('8c · ortak rota aynı koridoru tek anahtarda toplar ve ülke + taşıma seçeneklerini üretir',()=>{
  const a={mode:'sea',a:{lon:10,lat:20},b:{lon:20,lat:30}},b={mode:'sea',a:{lon:20,lat:30},b:{lon:10,lat:20}};
  assert.equal(flow.routeCorridorKey(a),flow.routeCorridorKey(b),'aynı koridor ters yönde gelse de tek görsel hat olmalı');
  const groups=flow.routeRecordGroups([
    {id:'bd1',country:'Bangladesh',mode:'sea',origin:{name:'Bangladesh'}},
    {id:'bd2',country:'Bangladesh',mode:'sea',origin:{name:'Bangladesh'}},
    {id:'in1',country:'India',mode:'sea',origin:{name:'India'}},
  ]);
  assert.deepEqual(groups.map(g=>[g.country,g.mode,g.records.length]),[['Bangladesh','sea',2],['India','sea',1]]);
});

test('9-10 · CP ve Orders haritası grid görünür satırlarından değil tüm veri kümesinden beslenir',()=>{
  assert.doesNotMatch(SOURCE,/cpTable|ordersTable|tableRows\(/,'harita grid DOM satırlarını okumamalı');
  assert.match(APP,/window\.BLGlobalFlowDataProviders=\{/);
  const provider=APP.slice(APP.indexOf('function globalFlowSourceRows'),APP.indexOf('window.BLGlobalFlowDataProviders=')+600);
  assert.match(provider,/state\[tableKey\]\.rows/);
  assert.doesNotMatch(provider,/filteredCP|filteredOrders|cpEvaluateAll|ordersEvaluateAll|visibleRows/);
  assert.match(APP,/bl:global-flow-data-changed/);
  // Kaynak satırların tamamı (grid filtresiyle eşleşmeyenler dahil) parsiyele genişler.
  const rows=[cpRow({'Order Code':'F1','Season':'W26',_logisticSegments:[segment({sourceRow:1})]}),cpRow({'Order Code':'F2','Season':'S27',_logisticSegments:[segment({sourceRow:2}),segment({sourceRow:3,status:'Depoda'})]})];
  assert.equal(flow.shipmentPartialsFromRows(rows,'cp').length,3);
  assert.equal(flow.shipmentPartialsFromRows(rows,'orders').length,3);
});

test('11 · çoklu seçim filtreleri: alan içi VEYA, alanlar arası VE, deterministik',()=>{
  const mk=(country,mode,season)=>({country,mode,season,orderCode:country+mode,state:'transit'});
  const recs=[mk('Bangladesh','sea','W26'),mk('India','sea','W26'),mk('Bangladesh','air','W26'),mk('China','sea','W26'),mk('India','sea','S27')];
  const match=flow.createPanelFilter({country:['Bangladesh','India'],mode:['sea'],season:['W26']});
  assert.deepEqual(recs.filter(match).map(r=>r.orderCode),['Bangladeshsea','Indiasea']);
  assert.equal(recs.filter(flow.createPanelFilter({})).length,5);
  assert.deepEqual(flow.normalizeFilters({country:'India',mode:['sea','sea',' ']}).country,['India'],'eski tekli değer diziye taşınır');
  assert.deepEqual(flow.normalizeFilters({mode:['sea','sea',' ']}).mode,['sea']);
  // Hızlı filtreler: aynı grup VEYA, gruplar arası VE.
  const q=[{state:'production',critical:true},{state:'transit',critical:false},{state:'transit',critical:true},{state:'arrived',critical:true}];
  assert.deepEqual(q.map(r=>flow.quickFilterMatch(r,['phase:production','phase:transit','critical'])),[true,false,true,false]);
  assert.deepEqual(q.map(r=>flow.quickFilterMatch(r,[])),[true,true,true,true]);
});

test('12 · hızlı filtreler: Warehouse varsayılanda yok, Critical var, düzenleme kalıcı saklanır',()=>{
  assert.deepEqual([...flow.DEFAULT_QUICK_FILTERS],['phase:production','phase:ready','phase:transit','critical']);
  assert.ok(!flow.DEFAULT_QUICK_FILTERS.includes('phase:arrived')&&!flow.DEFAULT_QUICK_FILTERS.includes('stage:IN_WAREHOUSE'));
  assert.ok(flow.QUICK_FILTERS['stage:IN_WAREHOUSE'],'Warehouse katalogdan silinmez; kullanıcı ekleyebilir');
  assert.ok(!Object.keys(flow.QUICK_FILTERS).some(id=>/risk/i.test(id)),'At Risk kaldırıldı');
  assert.deepEqual(flow.normalizeQuickFilterItems(['critical','phase:arrived','critical','risk','mode:sea']),['critical','phase:arrived','mode:sea'],'sıra korunur, tekrar/bilinmeyen atılır');
  assert.match(SOURCE,/quick:state\.quick/);assert.match(SOURCE,/data-gf-quick-move/);assert.match(SOURCE,/data-gf-quick-toggle/);
  assert.match(USER_STORAGE,/'buyerlog\.overview\.globalFlow\.'/);
  assert.equal(userPreferences.isSyncedKey('buyerlog.overview.globalFlow.v1'),true,'tercih kullanıcı çalışma alanıyla eşitlenir');
});

test('Critical tek kanonik Unified Action Priority kodundan türetilir',()=>{
  assert.equal(flow.actionPriorityCode('CRITICAL'),'CRITICAL');
  assert.equal(flow.actionPriorityCode('Kritik'),'CRITICAL');
  assert.equal(flow.actionPriorityCode('VAR'),'');
  assert.equal(flow.actionPriorityCode('ACTION_TODAY'),'ACTION_TODAY');
  const [crit]=flow.shipmentPartialsFromRows([cpRow({Priority:'CRITICAL',_logisticSegments:[segment({sourceRow:1}),segment({sourceRow:2})]})],'cp');
  assert.equal(crit.critical,true);
  const [plain]=flow.shipmentPartialsFromRows([cpRow({'RİSK (PRIORITY)':'VAR',_logisticSegments:[segment({sourceRow:1})]})],'backlog');
  assert.equal(plain.critical,false,'Backlog risk VAR/YOK metni Critical değildir');
});

test('Birleşik kaynak sipariş başına en öncelikli kaynağı seçer ve o kaynağın bütün parsiyellerini korur',()=>{
  const base={orderCode:'9',model:'M',colourCode:'1',orderKey:'9|m|1'};
  const recs=[{...base,source:'cp',id:'cp1'},{...base,source:'backlog',id:'b1'},{...base,source:'backlog',id:'b2'},{...base,source:'orders',id:'o1'}];
  assert.deepEqual(flow.dedupeRecords(recs).map(r=>r.id),['b1','b2']);
});

test('IAS Gemi Ad, İthalat Dosya No ve Konteyner No CP segmentlerine ve Backlog satırlarına taşınır',()=>{
  const ov={antrepoMatchConfig:parse.defaultAntrepoMatchConfig(),submap:{},delmap:{},suppfobmap:{},suppfobmetamap:{},notesmap:{},licensormap:{},pricingRules:[],transitRules:[]};
  const asasRow={'Sipariş Kod':'A','Model Adı':'MODEL-1','Renk Kod':'C01','Renk':'SİYAH','Net Alım Sipariş Miktarı':10000,'Kalan Alım Sipariş Miktarı':3000,'FOB Fiyatı':5,'Üretici':'SUPPLIER','Sezon':'W6','Buyer Grup (TR)':'BG','Siparişin Üretildiği Ülke':'BANGLADES','Orijinal Exfactory Merch Tarih':'2026-01-01','Retail Depo Tarih Yıl Ay Gün':'2026-06-01','Model Bütçe Tarih Yıl Ay Gün':'2026-06-15'};
  const iasRow=extra=>({'Sipariş Kod':'A','Ürün Ad':'MODEL-1','Renk Kod':'C01','Renk Tanım':'SİYAH','Supplier Portal Statü':'Yol Operasyonları','Tahmini Antrepo Giriş Tarihi':'2026-03-01','HANDOVER Tarihi':'2026-02-20','Vasita Tanim':'Gemi','Yükleme Toplam Adet':3000,'Net Alım Sipariş Miktarı':10000,'İthalat Dosya No':'IMP-1','Konteyner No':'CONT-1','Gemi Ad':'MSC AURORA',...extra});
  const orders=parse.parseASASRows([asasRow],ov.antrepoMatchConfig).orders;
  const map=parse.parseAntrepoRows([iasRow(),iasRow({'İthalat Dosya No':'IMP-2','Konteyner No':'CONT-2','Gemi Ad':'','Supplier Portal Statü':'Depoda','Yükleme Toplam Adet':4000})],ov.antrepoMatchConfig);
  const cp=parse.buildCPRowsFromASAS(orders,map,ov);
  const partials=cp[0]._logisticSegments.filter(s=>s.kind==='partial');
  assert.deepEqual(partials.map(s=>[s.importFile,s.containerNo,s.vesselName]).sort(),[['IMP-1','CONT-1','MSC AURORA'],['IMP-2','CONT-2','']]);
  const records=flow.shipmentPartialsFromRows(cp,'cp');
  assert.equal(records.length,cp[0]._logisticSegments.length);
  assert.ok(records.some(r=>r.vesselKey==='msc aurora'&&r.shipmentFile==='IMP-1'&&r.state==='transit'));
  const backlog=parse.buildBacklogTemplateRows(orders,map,ov,{},[]);
  assert.ok(backlog.length>=2);
  assert.ok(backlog.some(row=>row._partial&&row._partial.vesselName==='MSC AURORA'&&row._partial.importFile==='IMP-1'));
  const backlogRecords=flow.shipmentPartialsFromRows(backlog,'backlog');
  assert.equal(new Set(backlogRecords.map(r=>r.id)).size,backlogRecords.length,'her Backlog parsiyeli benzersiz kimlik taşır');
});

test('alan çözücüsü farklı ara sütunlara sahip aynı uzunluktaki satırları karıştırmaz',()=>{
  const a={'Sipariş Kod':'1','Lisans':'X','Adet':5,'Z':1},b={'Sipariş Kod':'2','Siparişin Üretildiği Ülke':'India','Adet':5,'Z':1};
  const [ra,rb]=flow.shipmentPartialsFromRows([a,b],'backlog');
  assert.equal(ra.license,'X');assert.equal(rb.country,'India');assert.equal(rb.origin.name,'India');
});

test('harita sağlayıcıları Overview koruma yolunu kullanır; gizli ızgarayı çizmez, başarısızlıkta döngüye girmez',()=>{
  const provider=APP.slice(APP.indexOf('const globalFlowLoadFailed'),APP.indexOf('window.BLGlobalFlowDataProviders=')+500);
  assert.match(provider,/ensureOverviewCpDependency\(\)/);
  assert.match(provider,/ensureOrdersLoaded\(\{deferRender:true\}\)/);
  assert.match(provider,/BL_CP_SOURCE_FILTER_REQUIRED/);
  assert.match(provider,/globalFlowLoadFailed\[tableKey\]&&!\(options&&options\.force\)/);
  assert.doesNotMatch(provider,/ensureCpLoaded\(\{reason:'overview'\}\)/);
});
