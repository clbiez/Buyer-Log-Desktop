'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const notes=require('../public/private-order-notes');
const ROOT=path.join(__dirname,'..');
const source=pathName=>fs.readFileSync(path.join(ROOT,pathName),'utf8');
const app=source('public/app-main.js');
const storageClient=source('public/user-storage.js');
const storageServer=source('server/lib/user-preferences.js');

function memoryStore(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};
}
test('private order notes use distinct line keys and never touch shared override fields',()=>{
  const store=memoryStore();
  const first='123|MODEL A|BLUE',second='123|MODEL A|RED';
  assert.ok(notes.keyFor(first).startsWith('bl.privateOrderNotes.v1.'));
  notes.write(store,first,'India trip notes');
  assert.equal(notes.read(store,first),'India trip notes');
  assert.equal(notes.read(store,second),'');
  notes.write(store,first,'');
  assert.equal(notes.read(store,first),'');
  assert.equal(store.values.size,0);
});
test('storage validates key, length and is per-user/synced but not profile-copyable',()=>{
  const s=memoryStore();
  assert.throws(()=>notes.write(s,'','text'));
  assert.throws(()=>notes.write(s,'123|A|X','x'.repeat(notes.LIMIT+1)));
  assert.match(storageClient,/'bl\.privateOrderNotes\.v1\.'/);
  assert.match(storageServer,/'bl\.privateOrderNotes\.v1\.'/);
  const server=storageServer.slice(storageServer.indexOf('const WORKSPACE_CATEGORY_PREFIXES'),storageServer.indexOf('const WORKSPACE_CATEGORIES'));
  assert.doesNotMatch(server,/privateOrderNotes/,'personal notes are not transferred in profile/workspace copies');
});
test('personal note column is offered in both CP and Orders and bypasses order edit checks',()=>{
  assert.match(app,/k:'__personalOrderNote'.*type:'privateNote'/);
  assert.match(app,/if\(c\.type==='privateNote'\)return window\.BLPrivateOrderNotes\.cellHtml\(r,lineKeyOfRow\(r\),appLang\);/);
  assert.match(app,/const ORDERS_COLS = ordersColumnsFromCp\(CP_COLS\)/);
  assert.match(app,/function syncOrdersColumnsFromCp\(\)/);
  assert.doesNotMatch(app,/body\.privateOrderNote|body\.personalOrderNote/);
  assert.match(source('public/index.html'),/private-order-notes\.js\?v=__BL_ASSET_VERSION__/);
});
test('note content is HTML escaped and is not written onto an order row',()=>{
  const store=memoryStore();
  notes.write(store,'71|MODEL|RED','<img src=x onerror=alert(1)>');
  const old=global.BLStorage;
  // Test module client renderer through a browser-like global on a fresh import.
  const fake={BLStorage:store,document:null};
  const vm=require('node:vm');const context={window:fake,module:{exports:{}}};
  vm.runInNewContext(source('public/private-order-notes.js'),context);
  const html=context.module.exports.cellHtml({'Order Code':71,'Model Name':'M & M'},'71|MODEL|RED','en');
  assert.ok(html.includes('&lt;img'),html);
  assert.ok(!html.includes('<img'),html);
  assert.ok(html.includes('M &amp; M'),html);
});
