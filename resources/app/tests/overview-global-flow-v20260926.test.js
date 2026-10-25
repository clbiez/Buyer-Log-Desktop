'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const flow=require('../public/overview-global-flow.js');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','overview-global-flow.css'),'utf8');
const SOURCE=fs.readFileSync(path.join(ROOT,'public','overview-global-flow.js'),'utf8');
const LAYOUT=require('../public/overview-layout.js');

test('Global Flow taşıma tiplerini ayırır',()=>{assert.equal(flow.detectMode('GEMİ'),'sea');assert.equal(flow.detectMode('Uçak'),'air');assert.equal(flow.detectMode('TIR'),'road');assert.equal(flow.detectMode('Gemi + Uçak'),'sea-air');});
test('operasyon durumları üretim, loading, transit ve İstanbul aşamalarını ayırır',()=>{assert.equal(flow.classifyState('Üretimde','unknown',{}),'production');assert.equal(flow.classifyState('Yükleme Operasyonları','sea',{}),'ready');assert.equal(flow.classifyState('Yol Operasyonları','sea',{}),'transit');assert.equal(flow.classifyState('Customs Operation','sea',{}),'arrived');assert.equal(flow.operationalStage('Awaiting Retail Transfer'),'AWAITING_RETAIL_TRANSFER');assert.equal(flow.operationalStage('In Warehouse'),'IN_WAREHOUSE');});
test('satır adaptörü sevkiyat dosyası, handover ve PLM kimliğini korur',()=>{const rec=flow.normalizeRecord({'Sipariş Kod':'1001','İhracat Dosya No':'EXP-88','PLM ID':'PLM-5','Model Adı':'MODEL-1','Renk Kod':'01','Sezon':'W26','Buyer':'Ayşe','Buyer Grup (TR)':'WOMEN','Üretici':'SUPPLIER A','Siparişin Üretildiği Ülke':'Bangladesh','GÜNCEL DURUM (STATUS)':'Yol Operasyonları','YÜKLEME TİPİ':'GEMİ','Adet':'24.600','HANDOVER Tarihi':'2026-09-01','RİSK (PRIORITY)':'CRITICAL'},'backlog',0);assert.equal(rec.orderCode,'1001');assert.equal(rec.shipmentFile,'EXP-88');assert.equal(rec.plmId,'PLM-5');assert.equal(rec.handover,'2026-09-01');assert.equal(rec.qty,24600);assert.equal(rec.mode,'sea');assert.equal(rec.state,'transit');assert.equal(rec.origin.name,'Bangladesh');assert.equal(rec.actionPriority,'CRITICAL');assert.equal(rec.critical,true);});
test('Combined önceliği Backlog > Orders > CP',()=>{const base={orderCode:'1001',model:'M',colourCode:'01'},rows=[{...base,id:'cp:1',source:'cp',qty:10},{...base,id:'orders:1',source:'orders',qty:20},{...base,id:'backlog:1',source:'backlog',qty:30}],result=flow.dedupeRecords(rows);assert.equal(result.length,1);assert.equal(result[0].source,'backlog');assert.equal(result[0].qty,30);});
test('ülke merkezi ve grup toplaması rota metasını üretir',()=>{assert.equal(flow.countryCoordinate('Türkiye').name,'İstanbul');assert.equal(flow.countryCoordinate('India').name,'India');const rows=[flow.normalizeRecord({'Sipariş Kod':'1','Country':'India','Status':'In Transit','Shipment Mode':'Air','Qty':'100'},'orders',0),flow.normalizeRecord({'Sipariş Kod':'2','Country':'India','Status':'In Transit','Shipment Mode':'Air','Qty':'50'},'orders',1)],groups=flow.aggregateRecords(rows);assert.equal(groups.length,1);assert.equal(groups[0].orders,2);assert.equal(groups[0].qty,150);});
test('Bangladesh deniz rotası Suez ve Çanakkale koridorundan İstanbul’a gelir',()=>{const route=flow.seaRouteCoordinates('Bangladesh');assert.ok(route.length>10);assert.ok(route.some(p=>Math.abs(p.lon-32.55)<.2&&Math.abs(p.lat-30)<.2));assert.ok(route.some(p=>Math.abs(p.lon-26.4)<.2&&Math.abs(p.lat-40.2)<.2));const last=route.at(-1);assert.ok(Math.abs(last.lon-flow.ROUTING.ARRIVAL_PORT.lon)<.001&&Math.abs(last.lat-flow.ROUTING.ARRIVAL_PORT.lat)<.001);});
test('araç ilerlemesi Handover + yol süresi kuralından hesaplanır',()=>{const rec=flow.normalizeRecord({'Sipariş Kod':'BD-1','Country':'Bangladesh','Status':'In Transit','Shipment Mode':'Gemi','HANDOVER Tarihi':'2026-09-01'},'orders',0),rules=[{id:'bd-sea',delType:'Gemi',days:70,countries:['Bangladesh'],seasons:[],exfStart:'',exfEnd:''}],meta=flow.recordRouteProgress(rec,rules,Date.UTC(2026,8,21));assert.equal(meta.leadDays,70);assert.ok(Math.abs(meta.progress-(20/70))<.001);assert.ok(Math.abs(meta.elapsedDays-20)<.001);});
test('rota hit testi örnekleme noktaları arasındaki tüm segmentte çalışır',()=>{const points=[{x:0,y:0,legIndex:0},{x:100,y:0,legIndex:0},{x:200,y:80,legIndex:0}];assert.ok(flow.distanceToPolyline(50,3,points)<4);assert.ok(flow.distanceToPolyline(150,39,points)<3);assert.ok(flow.distanceToPolyline(50,30,points)>20);});
test('rota hover ortak koridorda yalnız segmenti değil ilişkili tam güzergâhı vurgular',()=>{
  const bd={id:'bd1'},ind={id:'in1'},pk={id:'pk1'};
  const scene={edges:[
    {edge:{key:'bd',records:[bd]},points:[{x:0,y:0},{x:40,y:0}],width:3},
    {edge:{key:'shared',records:[bd,ind]},points:[{x:40,y:0},{x:100,y:0}],width:4},
    {edge:{key:'in',records:[ind]},points:[{x:40,y:20},{x:40,y:0}],width:3},
    {edge:{key:'pk',records:[pk]},points:[{x:0,y:40},{x:100,y:40}],width:3},
  ]};
  const sharedHit={type:'route',edge:scene.edges[1].edge,records:[bd,ind],points:scene.edges[1].points};
  assert.deepEqual(flow.routeHighlightEdges(scene,sharedHit).map(item=>item.edge.key),['bd','shared','in']);
  const bdHit={type:'route',edge:scene.edges[0].edge,records:[bd],points:scene.edges[0].points};
  assert.deepEqual(flow.routeHighlightEdges(scene,bdHit).map(item=>item.edge.key),['bd','shared']);
});
test('Natural Earth TopoJSON decoder gerçek polygon üretir',()=>{const topology=JSON.parse(fs.readFileSync(path.join(ROOT,'public','vendor','world-atlas-countries-110m.json'),'utf8')),polygons=flow.decodeWorldTopology(topology);assert.ok(polygons.length>100);assert.ok(polygons.some(poly=>poly.some(ring=>ring.length>20)));});
test('Global Flow accurate world, square loading marker ve ortak detay çekmecesi ile bağlıdır',()=>{assert.match(INDEX,/data-overview-widget="globalFlowMap"/);assert.doesNotMatch(INDEX,/<script[^>]*thinking-orb-working\.js/);assert.match(SOURCE,/id="globalFlowWorkingOrb" class="blOrb"/);assert.match(INDEX,/detail-drawer\.js/);assert.match(SOURCE,/vendor\/world-atlas-countries-110m\.json/);assert.match(SOURCE,/\/api\/transit-rules/);assert.match(SOURCE,/BLDetailDrawer/);assert.match(CSS,/\.globalFlowLoadingOverlay/);assert.ok(LAYOUT.widgets.includes('globalFlowMap'));assert.ok(LAYOUT.locate(LAYOUT.defaults(),'globalFlowMap').item.w>=8);});
test('Global Flow widget global section hidden kuralını override eder',()=>{assert.match(CSS,/\.globalFlowMapWidget\{display:block;/);assert.match(INDEX,/data-overview-widget="globalFlowMap"/);});
test('2D dünya görünümü ekran oranından bağımsız 2:1 en/boy oranını korur',()=>{const wide=flow.fitWorld2dViewport(1000,480),tall=flow.fitWorld2dViewport(800,600);assert.equal(wide.w/wide.h,2);assert.equal(wide.h,480);assert.equal(wide.x,20);assert.equal(tall.w,800);assert.equal(tall.h,400);assert.equal(tall.y,100);});
test('2D ve 3D yakınlaştırma sınırları detay incelemeye izin verir',()=>{assert.ok(flow.MAX_ZOOM_2D>=20);assert.ok(flow.MAX_ZOOM_3D>=10);});
test('aydınlık harita paleti kara, deniz ve sınırları daha belirgin ayırır',()=>{const p=flow.mapSurfacePalette('light');assert.equal(p.water,'#DCE8F2');assert.equal(p.land,'#F7F2E7');assert.equal(p.line,'#9AAABC');assert.equal(flow.mapSurfacePalette('dark'),null);});
test('3D globe sürükleme bırakıldıktan sonra inertia ile akıcı devam eder',()=>{assert.match(SOURCE,/globeInertia/);assert.match(SOURCE,/applyGlobeInertia/);assert.match(SOURCE,/MAX_ZOOM_3D/);});
test('3D globe fare sürüklemesi yüzeyi tutup çekiyormuş gibi yatay yönde hareket eder',()=>{const delta=flow.globeDragDelta(20,10,1);assert.ok(delta.lon<0,'sağa sürükleme ters kamera dönüşü üretmeli');assert.ok(delta.lat<0,'aşağı sürükleme yüzeyi aşağı taşımalı');});
