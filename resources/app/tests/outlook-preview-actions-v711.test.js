'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const UI=fs.readFileSync(path.join(ROOT,'public','outlook-mail.js'),'utf8');
const PS=fs.readFileSync(path.join(ROOT,'server','lib','OutlookLocal.ps1'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const {cleanDisplayPreview,normalizeMessage}=require('../server/lib/outlook-graph');
const {createOutlookLocalService}=require('../server/lib/outlook-local');

test('v7.11 mail preview e-posta adresi, quoted header ve imza/disclaimer metnini temizler',()=>{
  const raw='Dear Team, layout is approved. Kind Regards, GOKBERK CELEBI <gokberk.celebi@company.com> Buyer Group Management Please consider the environment before printing this email. From: Supplier <supplier@example.com> Sent: Monday Subject: RE';
  const cleaned=cleanDisplayPreview(raw);
  assert.match(cleaned,/Dear Team, layout is approved\./);
  assert.doesNotMatch(cleaned,/@company\.com|@example\.com|Kind Regards|From:|Sent:|environment before printing/i);
  const normalized=normalizeMessage({id:'m1',subject:'Order',bodyPreview:raw,from:{emailAddress:{name:'Gökberk',address:'g@x.com'}},receivedDateTime:'2026-08-25T10:00:00Z'},1,{orderNo:'1'},{});
  assert.doesNotMatch(normalized.preview,/@|Kind Regards|From:/i);
});

test('v7.11 Outlook UI gerçek Order/PO kodunu dahili row id önüne alır ve aksiyonlar bağlıdır',()=>{
  assert.match(UI,/_entityId: pick\(source, \['_entityId','orderNo','Order Code'/);
  assert.match(UI,/context\._entityId=context\.orderNo\|\|context\.poNo/);
  assert.match(UI,/data-outlook-detail/);
  assert.match(UI,/data-outlook-link/);
  assert.match(UI,/data-outlook-analyze/);
  assert.match(UI,/data-outlook-open-local/);
  assert.match(SERVER,/write \? canUserEditOrderCode\(profile, entityId\) : \(userAccess\.hasCapability\(profile, 'ORDERS\.VIEW'\) \|\| userAccess\.hasPermission\(profile, 'manageAllOrders'\)\)/);
});

test('v7.11 Classic Outlook direct open başarısızsa güvenli arama fallback kullanır',async()=>{
  const calls=[];
  const local=createOutlookLocalService({isWindows:true,runSync:()=>({ok:true,available:true,profileName:'User'}),run:async(action,payload)=>{calls.push({action,payload});if(action==='Open')throw new Error('entry failed');if(action==='SearchOpen')return{ok:true,opened:true};throw new Error(action);}});
  const id=local.encodeMessageId(Buffer.from('entry').toString('base64'),Buffer.from('store').toString('base64'));
  const result=await local.open(id,{subject:'RE: Order 123',internetMessageId:'<id@example.com>'});
  assert.equal(result.method,'INTERNET_MESSAGE_ID_FALLBACK');
  assert.deepEqual(calls.map(x=>x.action),['Open','SearchOpen']);
  assert.equal(calls[1].payload.internetMessageId,'<id@example.com>');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1].payload,'subject'),false);
  assert.match(PS,/if \(\$Action -eq 'SearchOpen'\)/);
  assert.match(PS,/Show-OutlookItemForeground \$candidate/);
});
