'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../public/order-license-atlas-engine'),A=require('../public/license-supplier-atlas');
const cards=[{id:'a',license:'NORTH STAR',licensor:'Demo'},{id:'b',license:'NORTH STAR',licensor:'Other'},{id:'c',license:'ORBIT',licensor:'Studio'},{id:'d',license:'CLOSED',licensor:'Studio',processAtlas:{version:1,license:{id:'d',name:'CLOSED',manufacturerVisible:false,stages:[],addresses:[],portal:{}},sharedAddresses:[],visualLibrary:[]}}];
for(const moduleId of ['cp','orders'])test(`${moduleId}: canonical license / licensor pairs select unique cards only`,()=>{
  const result=E.match([{License:' north star ',Licensor:'demo'},{license:'NORTH STAR',licensor:'Demo'},{Lisans:'ORBIT'},{License:'CLOSED'}],moduleId,cards);
  assert.deepEqual(result.cards.map(c=>c.id),['a','c','d']);assert.deepEqual(result.issues,[]);assert.equal(result.withoutLicense,0);
  const output=A.project(result.cards,'en');assert.deepEqual(output.licenses.map(l=>l.name),['NORTH STAR','ORBIT']);assert.deepEqual(output.skipped,['CLOSED']);
});
test('missing and ambiguous pairs never fall back to another licensor or unrelated card',()=>{
  const result=E.match([{License:'NORTH STAR'},{License:'NORTH STAR',Licensor:'Unknown'},{License:'NO CARD'},{License:'NO CARD'},{License:''}], 'orders',cards);
  assert.deepEqual(result.cards,[]);assert.deepEqual(result.issues.map(i=>i.reason),['ambiguous','missing','missing']);assert.equal(result.withoutLicense,1);
});
test('empty selection exports nothing and unsupported modules are rejected',()=>{
  assert.deepEqual(E.match([],'cp',cards),{cards:[],issues:[],withoutLicense:0});assert.throws(()=>E.match([],'collection',cards),/INVALID_ORDER_ATLAS_MODULE/);
});
test('canonical enrichments take precedence over stale source fields',()=>{
  const row={License:'STALE',Licensor:'Unknown',__canonical:{license:'NORTH STAR',licensor:'Demo'}};
  assert.deepEqual(E.match([row],'cp',cards).cards.map(c=>c.id),['a']);
});
test('both Tools menus expose the same lazy feature without mounting License Cards',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),html=read('index.html'),main=read('app-main.js');
  for(const moduleId of ['cp','orders'])assert.match(html,new RegExp(`id="${moduleId}ToolsMenu"[\\s\\S]*?data-order-license-atlas="${moduleId}"`));
  assert.match(main,/ensureFeature\('orderLicenseAtlas'\)/);assert.match(read('perf-runtime.js'),/orderLicenseAtlas:\['license-atlas-engine.js\?rev=2','license-supplier-atlas.js\?rev=3','order-license-atlas-engine.js\?rev=1','order-license-atlas.js\?rev=1'\]/);
});
