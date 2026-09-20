'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const engine=require('../server/lib/endeksmatik');

const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const ACCESS=fs.readFileSync(path.join(__dirname,'..','public','user-access-ui.js'),'utf8');
const SERVER=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');

function close(a,b,tol=1e-9){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);}

test('v5.47 Endeksmatik snapshot reproduces the workbook reference calculation',()=>{
  const status=engine.publicStatus();
  assert.ok(status.recordCount>=3500);
  assert.equal(status.sourceUpdatedAt,'2026-06-08');
  const result=engine.calculate({
    mmyg:'CUW4',mag:'CU4E',buyingGroup:'LİSANS',category:'KEY ORME BODY K.KOL-LİSANS',
    previousOrderMonth:'202507',previousInStoreMonth:'202602',newOrderMonth:'202607',newInStoreMonth:'202702',
    previousTryPrice:187,previousUsdPrice:2.75,
  });
  assert.equal(result.class.supplyGroup,'ÖRME');
  close(result.indexes.tl,0.3410857596083731);
  close(result.indexes.usd,0.10436276234437614);
  close(result.prices.try,250.78303704676577);
  close(result.prices.usd,3.0369975964470344);
});

test('v5.47 component periods follow the workbook: fabric/accessory order, CMT/extra In Store',()=>{
  const result=engine.calculate({
    mmyg:'CUW4',mag:'CU4E',buyingGroup:'LİSANS',category:'KEY ORME BODY K.KOL-LİSANS',
    previousOrderMonth:'202507',previousInStoreMonth:'202602',newOrderMonth:'202607',newInStoreMonth:'202702',
  });
  const by=Object.fromEntries(result.components.map(item=>[item.component,item]));
  assert.deepEqual([by.fabric.oldMonth,by.fabric.newMonth],['202507','202607']);
  assert.deepEqual([by.accessory.oldMonth,by.accessory.newMonth],['202507','202607']);
  assert.deepEqual([by.cmt.oldMonth,by.cmt.newMonth],['202602','202702']);
  assert.deepEqual([by.extra.oldMonth,by.extra.newMonth],['202602','202702']);
});

test('v5.47 Collection keeps old order/In Store and new order months manual, Previous Season FOB only defaults the editable USD field',()=>{
  const all=APP.slice(APP.indexOf("function endeksmatikModelContext"),APP.indexOf("function endeksmatikResultHtml"));
  const block=all.slice(all.indexOf('const saved='));
  assert.match(block,/previousOrderMonth:saved\.previousOrderMonth\|\|''/);
  // v5.92: geçen In Store ayı artık boş başlamıyor; yeni In Store modelden
  // geldiği için onun bir yıl öncesi tohumlanıyor. KAYITLI değer hâlâ önceliklidir,
  // yani kullanıcının seçimi korunuyor — testin asıl koruduğu şey budur.
  assert.match(block,/const seededPreviousInStore=saved\.previousInStoreMonth\|\|endeksmatikShiftMonthCode\(seededNewInStore,-1\)/);
  assert.match(block,/previousInStoreMonth:seededPreviousInStore/);
  assert.match(block,/newOrderMonth:saved\.newOrderMonth\|\|''/);
  assert.match(block,/const seededNewInStore=saved\.newInStoreMonth\|\|kolMonthCode\(row&&row\.inStoreMonth\)/);
  assert.match(block,/previousUsdPrice:saved\.previousUsdPrice!==undefined\?saved\.previousUsdPrice:\(row&&row\.previousFob\|\|''\)/);
  assert.doesNotMatch(block,/state\.orders|\.find\([^)]*model/i);
});

test('v5.47 Orders Endeksmatik starts from selected order dates/FOB and proposes exactly +1 year',()=>{
  const block=APP.slice(APP.indexOf("function endeksmatikModelContext"),APP.indexOf("function endeksmatikResultHtml"));
  assert.match(block,/row&&row\.OPD/);
  assert.match(block,/row&&row\['In-Store \(Model Budget\)'\]/);
  assert.match(block,/newOrderMonth:endeksmatikAddYear\(oldOrder\)/);
  assert.match(block,/newInStoreMonth:endeksmatikAddYear\(oldStore\)/);
  assert.match(block,/row&&row\['FOB \(\$\)'\]/);
  assert.match(INDEX,/id="ordersEndeksmatikBtn"/);
  assert.match(APP,/rows\.length!==1/);
});

test('v5.47 Collection Endeksmatik column is immediately left of Overseas/TR Landed and stores result separately from price fields',()=>{
  const cols=APP.slice(APP.indexOf('const KOL_COLS = ['),APP.indexOf('let kolCustomCols'));
  const e=cols.indexOf("k:'endeksmatik'"),yd=cols.indexOf("k:'ydLanded'"),tr=cols.indexOf("k:'trLanded'");
  assert.ok(e>=0&&yd>e&&tr>yd);
  assert.match(APP,/out\.push\('endeksmatik'\)/);
  assert.match(APP,/out\.push\('ydLanded','trLanded'\)/);
  assert.match(APP,/const nextEndeksmatik=\{/);
  assert.match(APP,/kolWriteGroupedStorageValue\(row,'endeksmatikData',nextEndeksmatik\)/);
  const saveAt=APP.indexOf('const nextEndeksmatik={');
  assert.doesNotMatch(APP.slice(saveAt,APP.indexOf('saveKolRows();renderKol();showToast',saveAt)),/row\.(targetPrice|fob|trPrice)\s*=/);
});

test('v5.47 Endeksmatik workbook update is permission-gated and the large workbook remains server-side',()=>{
  assert.match(INDEX,/id="endeksmatikUploadBtn"/);
  assert.match(ACCESS,/manageModelConnections:\['modelConnectionBtn','endeksmatikUploadBtn'\]/);
  assert.match(SERVER,/app\.post\('\/api\/endeksmatik\/upload', userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(SERVER,/app\.post\('\/api\/endeksmatik\/calculate'/);
  assert.ok(fs.existsSync(path.join(__dirname,'..','server','templates','endeksmatik-default.json.gz')));
});
