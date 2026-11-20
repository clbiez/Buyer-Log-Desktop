'use strict';
/* WS2b (#1075) parite kapısı: eski istemci normalleştirmesi (shipmentPartialsFromRows
   → applyFilters → buildFlowModel) ile arka uç kayıt yükü + istemci hidrasyonu
   aynı fixture'da hash olarak eşit olmalı. 2k fixture her koşuda; 30k fixture
   BUYER_LOG_PARITY_30K=1 ile (yavaş, kanıt için elle). */
const test=require('node:test');
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const parity=require('./helpers/read-model-parity.cjs');
const parse=require('../server/lib/parse');
const tasks=require('../server/lib/compute-tasks');
const model=require('../server/lib/read-model/global-flow-model');
const flow=require('../public/overview-global-flow');
const {build}=require('../scripts/generate-demo-data.js');

const NOW=Date.UTC(2026,0,15);
const RULES=[{delType:'Gemi',days:70,countries:[],seasons:[]},{delType:'Uçak',days:15,countries:[],seasons:[]},{delType:'Tır',days:10,countries:[],seasons:[]}];
const fixtures=new Map();
function backlogExport(rows){
  if(fixtures.has(rows))return fixtures.get(rows);
  const data=build({rows,seed:7,today:new Date(parity.DEFAULT_TODAY+'T00:00:00Z')});
  const asasBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(asasBook,XLSX.utils.aoa_to_sheet(data.asas),'ASAS');
  const iasBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(iasBook,XLSX.utils.aoa_to_sheet(data.antrepo),'IAS');
  const orders=parse.parseASASWorkbook(asasBook).orders;
  const source={loadedAt:'parity',asasOrders:orders,asasOrdersByTarget:{cp:orders,orders,backlog:orders},antrepoMap:parse.parseAntrepoWorkbook(iasBook)};
  const value=tasks.buildBacklog('export',source,{overrides:{},horizons:{},options:{},headers:[],sourceColumns:[],rowsRevision:'rows',sourceRevision:'parity-src',includeSourceDetails:false,mapProjection:true});
  // Sunucu ile istemci aynı JSON baytlarını görür (Date → metin).
  const out=JSON.parse(tasks.serialize(value));fixtures.set(rows,out);return out;
}
// İstemcideki ortak CP öncelik dizini taklidi: deterministik, bir kısmı boş.
function installPriorityIndex(salt){
  const codes=['CRITICAL','ACTION_TODAY','WATCH','',''];
  globalThis.BLCpPriorityIndex={lookup(order,modelName,colour){
    const key=String(order)+'|'+modelName+'|'+colour;let h=salt;for(const ch of key)h=(h*31+ch.charCodeAt(0))>>>0;
    const priority=codes[h%codes.length];if(!priority&&h%7===0)return null;
    return {priority,trackingTags:h%3===0?['WATCH']:[],priorityTags:h%4===0?['prio:demo-tag']:[]};
  }};
}
function legacyRecords(exported){
  return flow.shipmentPartialsFromRows(exported.rows.map(row=>({...row,_flowSourceRevision:exported.sourceRevision})),'backlog');
}
function candidateRecords(exported){
  const wire=JSON.parse(JSON.stringify(model.buildRecordsPayload(exported)));
  return flow.hydrateReadModelRecords(wire);
}
// Çizimin tükettiği model: düğüm/rota/araç toplamları + kayıt kimlikleri.
function drawn(records,filters,quick){
  const panel=flow.createPanelFilter(filters),panelRows=records.filter(panel);
  const filtered=quick.length?panelRows.filter(rec=>flow.quickFilterMatch(rec,quick)):panelRows;
  const m=flow.buildFlowModel(filtered,{rules:RULES,now:NOW});
  const ids=list=>list.map(rec=>rec.id);
  return {
    filtered:filtered.length,qty:filtered.reduce((sum,rec)=>sum+(Number(rec.qty)||0),0),critical:filtered.filter(rec=>rec.critical).length,
    nodes:m.nodes.map(node=>({key:node.key,kind:node.kind,location:node.location,records:ids(node.records),stages:[...node.stages].map(([stage,list])=>[stage,ids(list)])})),
    edges:m.edges.map(edge=>({key:edge.key,qty:edge.qty,records:ids(edge.records),origins:[...edge.origins].sort(),destinations:[...edge.destinations].sort()})),
    vehicles:m.vehicles.map(vehicle=>({id:vehicle.id,qty:vehicle.qty,items:(vehicle.items||[]).map(item=>item.rec?item.rec.id:item.id)})),
    unplaced:ids(m.unplaced),
    filterValues:flow.FILTER_KEYS.map(key=>[key,flow.uniqueValues(records,key)]),
  };
}
const withoutRaw=records=>records.map(({raw,...rec})=>({...rec,rawMarker:{thin:raw&&raw._flowThin,revision:raw&&raw._flowSourceRevision}}));
const SCENARIOS=[
  ['tümü',{},[]],
  ['hızlı filtre: üretim+yolda, kritik',{},['phase:production','phase:transit','critical']],
  ['panel: ülke + öncelik etiketi + arama',{country:['Bangladesh','China','India'],priority:['CRITICAL','prio:demo-tag'],search:'a'},[]],
  ['panel: taşıma + statü yok, hızlı: gemi',{mode:['sea','air']},['mode:sea']],
];

async function assertFixtureParity(rows){
  const exported=backlogExport(rows);
  assert.ok(exported.rows.length>=rows,'fixture Backlog satırı üretmeli');
  for(const salt of [7,1031]){
    installPriorityIndex(salt);
    const legacy=legacyRecords(exported),candidate=candidateRecords(exported);
    assert.ok(legacy.length>rows*0.5);
    await parity.assertParity({name:`global-flow kayıtları ${rows} satır / dizin ${salt}`,legacy:()=>withoutRaw(legacy),candidate:()=>withoutRaw(candidate)});
    for(const [name,filters,quick] of SCENARIOS){
      await parity.assertParity({name:`global-flow modeli ${rows} / ${salt} / ${name}`,legacy:()=>drawn(legacy,filters,quick),candidate:()=>drawn(candidate,filters,quick)});
    }
  }
  delete globalThis.BLCpPriorityIndex;
}

test('2k fixture: arka uç kayıtları + istemci hidrasyonu eski normalleştirme ve harita modeliyle hash olarak eşit',async()=>{
  await assertFixtureParity(2000);
});
test('30k fixture paritesi (BUYER_LOG_PARITY_30K=1)',{skip:process.env.BUYER_LOG_PARITY_30K!=='1'},async()=>{
  await assertFixtureParity(30000);
});
test('kayıt sözleşmesi uyumsuzsa hidrasyon sessizce yanlış model kurmaz',()=>{
  const wire=JSON.parse(JSON.stringify(model.buildRecordsPayload(backlogExport(2000))));
  assert.doesNotThrow(()=>flow.hydrateReadModelRecords(wire));
  assert.throws(()=>flow.hydrateReadModelRecords({...wire,fields:wire.fields.slice(1)}),/contract mismatch/);
  assert.throws(()=>flow.hydrateReadModelRecords({...wire,version:2}),/contract mismatch/);
});
test('ince Backlog işareti korunur: çekmece detayı yine kaynak sürümüyle istenir',()=>{
  const records=candidateRecords(backlogExport(2000));
  assert.ok(records.every(rec=>rec.raw._flowThin===1&&rec.raw._flowSourceRevision==='parity-src'));
});
test('işçi görevi gzip projeksiyonu gzip kayıt yüküne çevirir',()=>{
  const exported=backlogExport(2000),zlib=require('node:zlib');
  const out=model.execute({buffer:zlib.gzipSync(Buffer.from(JSON.stringify(exported)))});
  const payload=JSON.parse(zlib.gunzipSync(Buffer.from(out.buffer)).toString('utf8'));
  assert.equal(out.uncompressedBytes,Buffer.byteLength(JSON.stringify(payload)));
  assert.equal(payload.count,payload.rows.length);assert.equal(out.count,payload.count);
  assert.ok(flow.readModelPayloadValid(payload));
});
