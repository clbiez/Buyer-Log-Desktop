'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const UI=fs.readFileSync(path.join(ROOT,'public','outlook-mail.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','outlook-mail.css'),'utf8');
const PS=fs.readFileSync(path.join(ROOT,'server','lib','OutlookLocal.ps1'),'utf8');
const {createOutlookLocalService,manualTerms}=require('../server/lib/outlook-local');
const {buildSearchQueries}=require('../server/lib/outlook-graph');

test('v7.10 Settings ekranı mailbox discovery beklemeden status üzerinden açılır',()=>{
  const start=UI.indexOf('async function openSettings()');
  const end=UI.indexOf('function setupFlag',start);
  const block=UI.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(block,/await loadStatus\(\)/);
  assert.doesNotMatch(block,/await loadV2Meta\(\)/);
  assert.match(block,/data-outlook-back-search/);
  assert.match(block,/data-outlook-settings-retry/);
});

test('v7.10 manuel anahtar kelime alanı arama ekranında her zaman görünür',()=>{
  assert.match(UI,/outlookQuickSearch/);
  assert.match(UI,/data-outlook-manual-search/);
  assert.match(UI,/data-outlook-manual-clear/);
  assert.match(UI,/data-outlook-quick-term/);
  assert.match(UI,/Birden fazla ifade için virgül kullanabilirsin/);
  assert.match(CSS,/\.outlookQuickSearch/);
});

test('v7.10 Classic Outlook manuel ifadeleri daraltma kriteri olarak ayrı gönderir',async()=>{
  assert.deepEqual(manualTerms('RFID, approval; strike off\nprice'),['RFID','approval','strike off','price']);
  let payload;
  const local=createOutlookLocalService({isWindows:true,runSync:()=>({ok:true,available:true,profileName:'User'}),run:async(action,value)=>{if(action==='Search'){payload=value;return{ok:true,items:[]};}throw new Error(action);}});
  await local.search({orderNo:'1341468',modelName:'SWT,PSG-1-YD'},{manual:'RFID, approval',pageSize:25});
  assert.deepEqual(payload.manualTerms,['RFID','approval']);
  assert.ok(payload.terms.includes('1341468'));
  assert.match(PS,/\$manualMatched/);
  assert.match(PS,/Search-Folder \$inbox 'INBOX' \$terms \$manualTerms/);
});

test('v7.10 Graph sorgularında manuel ifadeler tüm bağlam sorgularını daraltır',()=>{
  const queries=buildSearchQueries({orderNo:'1341468',plmCode:'2069551',modelName:'SWT,PSG-1-YD'},{manual:'RFID, approval',dateFrom:'2026-01-01',dateTo:'2026-08-25'});
  assert.ok(queries.length>0);
  for(const item of queries){
    assert.match(item.queryString,/"RFID"/);
    assert.match(item.queryString,/"approval"/);
    assert.match(item.queryString,/ AND /);
  }
});
