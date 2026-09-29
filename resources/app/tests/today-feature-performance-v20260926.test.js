'use strict';
/* 26 Eylül 2026 özellikleri — performans/entegrasyon regresyonları.
   Ölçülen sorunlar: satır başına tekrarlanan başlık normalizasyonu, saniyelik
   Intl.DateTimeFormat kurulumu, her resize olayında senkron radar çizimi,
   detay çekmecesinde her tuşta tam tablo + iki kez görsel indeksi. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,'public',file),'utf8');
const flow=require('../public/overview-global-flow.js');

test('Global Flow alan çözücüsü satır biçimini satır başına bir kez tarar',()=>{
  let ownKeys=0;
  const rows=Array.from({length:200},(_,i)=>new Proxy({'Order Code':String(i),'Model Name':'M','C.Code':'1','Country':'India','STATUS':'Yol Operasyonları','Del. Type':'Gemi','Order Quantity':10,_logisticSegments:[{kind:'partial',partialNo:1,quantity:5,status:'Depoda',sourceRow:i}]},{ownKeys(target){ownKeys++;return Reflect.ownKeys(target);}}));
  const records=flow.shipmentPartialsFromRows(rows,'cp');
  assert.equal(records.length,200);
  assert.ok(ownKeys<=rows.length,'Object.keys satır başına en fazla bir kez çağrılmalı (ölçülen: '+ownKeys+')');
});

test('Global Flow görünmezken çizmez; kenar geometrisi ve dünya katmanı önbelleklidir',()=>{
  const src=read('overview-global-flow.js');
  assert.match(src,/new IntersectionObserver\(/);
  assert.match(src,/function isLive\(\)\{return state\.workspaceActive&&!document\.hidden&&!state\.collapsed&&state\.inView;\}/);
  assert.match(src,/if\(!rect\.width\|\|!rect\.height\)return null;/,'gizli sekmedeki tuval çizilmez');
  assert.match(src,/EDGE_SAMPLE_CACHE/);assert.match(src,/function baseLayer\(/);assert.match(src,/state\.paletteCache/);
  assert.doesNotMatch(src,/new MutationObserver\(\(\)=>\{\s*if\(state\.source===id/,'grid tablolarına MutationObserver bağlanmaz');
  assert.match(src,/reducedMotion\(\)/,'hareket azaltma tercihi animasyonu kapatır');
});

test('World clocks Intl.DateTimeFormat nesnesini saat dilimi başına bir kez kurar ve gizliyken tick yazmaz',()=>{
  const launchpad=require('../public/overview-launchpad.js');
  const Original=Intl.DateTimeFormat;let constructed=0;
  Intl.DateTimeFormat=function(...args){constructed++;return new Original(...args);};
  try{
    const now=new Date(Date.UTC(2026,8,26,12,0,0));
    for(let i=0;i<50;i++)launchpad.clockParts(now,'Asia/Dhaka','tr');
    const parts=launchpad.clockParts(now,'Asia/Dhaka','tr');
    assert.equal(parts.time,'18:00:00');
    assert.ok(constructed<=1,'formatter önbelleklenmeli (kurulan: '+constructed+')');
  }finally{Intl.DateTimeFormat=Original;}
  const src=read('overview-launchpad.js');
  assert.match(src,/if\(document\.hidden\)return;/);assert.match(src,/getClientRects\(\)\.length/);
});

test('Overview widget boyut değişimi senkron yeniden çizim yapmaz',()=>{
  // Radarlar kaldırıldı; kırılım grafiği CSS ile uyum sağlar, yalnız veri
  // değişince çizilir. Harita kabını izler ve çizimi kareye erteler.
  const breakdown=read('overview-breakdown.js');
  assert.doesNotMatch(breakdown,/addEventListener\('resize'/);
  const flowSrc=read('overview-global-flow.js');
  assert.match(flowSrc,/new ResizeObserver\(\(\)=>\{if\(state\.inView\)scheduleDraw\(\);\}\)/);
});

test('Ortak detay çekmecesi büyük kümeleri parça parça çizer, aramayı geciktirir ve görsel indeksini tek kurar',()=>{
  const src=read('detail-drawer.js');
  assert.match(src,/const RENDER_CHUNK=300;/);assert.match(src,/data-bl-detail-more/);
  assert.match(src,/active\.searchTimer=setTimeout\(/);assert.match(src,/active\.searchIndex/);
  const render=src.slice(src.indexOf('function renderTable()'),src.indexOf('function downloadBuffer'));
  assert.equal((render.match(/buildIndex\(/g)||[]).length,1,'renderTable görsel indeksini bir kez kurmalı');
  assert.ok(render.includes(",rows,imageIndex);"),'varlık kapsamı aynı indeksi kullanmalı');
  // Excel her iki sütun modunda da TÜM filtreli satırlarla çalışmaya devam eder.
  assert.match(src,/const columns=mode==='all'\?active\.columns:currentColumns\(\),rows=filteredRows\(\)/);
  assert.match(src,/data-bl-export-mode="all"/);assert.match(src,/data-bl-export-mode="visible"/);
});
