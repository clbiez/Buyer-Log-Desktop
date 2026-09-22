'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');

test('Orders PLM SYNC tek giriş noktasıdır ve ortak üç scope aksiyonunu kullanır',()=>{
  assert.match(INDEX,/id="ordersPlmSyncBtn"/);
  assert.match(INDEX,/data-plm-sync-category="plm" data-plm-sync-page="orders"/);
  const start=APP.indexOf('function plmSyncScopeActions');
  const body=APP.slice(start,APP.indexOf('function plmSyncActionModal',start));
  assert.match(body,/id:'all'/);
  assert.match(body,/id:'selected'[\s\S]*?disabled:!scope\?\.selectedIdentities\?\.length/);
  assert.match(body,/id:'missing'/);
});

test('selected link/image operation boş seçimde sessizce tüm kümeye genişlemez ve API bağlantısından önce durur',()=>{
  const start=APP.indexOf('async function updateModelLinks(mode,button');
  const body=APP.slice(start,APP.indexOf('/* --- 2) MODEL GÖRSELLERİ',start));
  const guard=body.indexOf("mode==='selected'&&!operation.identities.length");
  const api=body.indexOf('ensureCoreNectumApiConnection');
  assert.ok(guard>=0,'selected guard bulunmalı');
  assert.ok(api>guard,'boş seçim API bağlantısından önce reddedilmeli');
  assert.match(body.slice(guard),/reason:'no-selection'/);
});

test('model image selection guard da selected boşsa false döner',()=>{
  const start=APP.indexOf('function modelAssetRequireSelection(operation)');
  const body=APP.slice(start,start+700);
  assert.match(body,/operation\.mode==='selected'&&!operation\.identities\.length/);
  assert.match(body,/return false/);
});
