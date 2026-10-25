'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('public/index.html');
const css=require('./helpers/manifest-css')();
const app=read('public/app-main.js');
const parse=read('server/lib/parse.js');

test('v6.70 Logistics Flow kartı geniş tablodan bağımsız olarak görünür sayfa alanına sığar',()=>{
  assert.match(html,/class="tablewrap" id="cpTableWrap"><table id="cpTable"/);
  assert.match(html,/class="tablewrap" id="ordersTableWrap"><table id="ordersTable"/);
  for(const table of ['cpTableWrap','ordersTableWrap'])assert.ok(css.includes('#'+table+'{container-type:inline-size;}'));
  assert.match(css,/\.cpLogisticDetailCard\{position:sticky;left:10px;[^}]*max-width:calc\(100vw - 56px\)/);
  assert.match(css,/@supports\(width:100cqw\)[\s\S]*?#cpTableWrap \.cpLogisticDetailCard,#ordersTableWrap \.cpLogisticDetailCard\{width:calc\(100cqw - 20px\);max-width:calc\(100cqw - 20px\);\}/);
});

test('v6.70 Logistics Flow Priority 1-2-3 sırası operasyonel segment durumundan üretilir',()=>{
  assert.match(parse,/function cpLogisticPriority\(segment\)/);
  assert.match(parse,/segment\._segmentKind === 'production'.*return 1/s);
  assert.match(parse,/statusKey === 'DEPODA'.*return 3/s);
  assert.match(parse,/return 2;/);
  assert.match(parse,/cpLogisticPriority\(a\) - cpLogisticPriority\(b\)/);
  assert.match(app,/priority===1\?'Production \/ Shortage':priority===2\?'Pre-warehouse':'Warehouse'/);
});
