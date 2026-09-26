'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname,'..');
const { createOutlookLocalService } = require('../server/lib/outlook-local');
const { createOutlookHybridService } = require('../server/lib/outlook-hybrid');
const UI = fs.readFileSync(path.join(ROOT,'public','outlook-mail.js'),'utf8');
const SERVER = require('./helpers/server-source')();
const PS = fs.readFileSync(path.join(ROOT,'server','lib','OutlookLocal.ps1'),'utf8');

function psRow(overrides={}){
  return {
    entryId:Buffer.from('entry-1','utf8').toString('base64'),storeId:Buffer.from('store-1','utf8').toString('base64'),
    internetMessageId:'<mail-1@buyerlog>',conversationId:'conv-1',subject:'RE: 4500123456 MAKTANAS termin',senderName:'Supplier A',
    receivedDateTime:'2026-08-25T08:00:00.000Z',sentDateTime:'2026-08-25T08:00:00.000Z',bodyPreview:'PO 4500123456 / PLM 2111030 / 3E8 termin revizesi',hasAttachments:true,attachmentCount:1,isRead:false,importance:'high',folderName:'Inbox',...overrides,
  };
}

test('v7.08 Classic Outlook local adapter aynı normalize edilmiş mail DTOsunu üretir', async()=>{
  const calls=[];
  const local=createOutlookLocalService({isWindows:true,runSync:(action)=>({ok:true,available:true,profileName:'Gökberk',storeName:'Mailbox',engine:'CLASSIC_OUTLOOK_LOCAL'}),run:async(action,payload)=>{calls.push({action,payload});if(action==='Search')return{ok:true,items:[psRow()]};if(action==='Detail')return{ok:true,subject:'Mail',contentType:'html',body:'<p>Test</p>',attachments:[]};if(action==='Open')return{ok:true,opened:true};if(action==='Bridge')return{ok:true,mode:'INSTANT_SEARCH'};throw new Error(action);}});
  const status=local.status();assert.equal(status.connected,true);assert.equal(status.engine,'CLASSIC_OUTLOOK_LOCAL');
  const result=await local.search({orderNo:'4500123456',plmCode:'2111030',modelName:'MAKTANAS',colourCode:'3E8'},{dateFrom:'2026-05-01',dateTo:'2026-08-25',pageSize:25});
  assert.equal(result.engine,'CLASSIC_OUTLOOK_LOCAL');assert.equal(result.items.length,1);assert.equal(result.items[0].mailboxType,'CLASSIC_OUTLOOK_LOCAL');assert.match(result.items[0].messageId,/^local:/);assert.ok(result.items[0].score>0);assert.ok(result.items[0].matchedFields.some(x=>x.field==='orderNo'));
  const detail=await local.detail(result.items[0].messageId);assert.equal(detail.contentType,'html');
  const opened=await local.open(result.items[0].messageId);assert.equal(opened.opened,true);
  const bridge=await local.bridge({orderNo:'4500123456'},{manual:'termin'});assert.equal(bridge.mode,'INSTANT_SEARCH');assert.match(bridge.query,/4500123456/);assert.match(bridge.query,/termin/);
  assert.ok(calls.some(x=>x.action==='Search'));
});

test('v7.08 local attachment yalnız kullanıcı istediğinde temp dosyadan okunur', async()=>{
  const local=createOutlookLocalService({isWindows:true,runSync:()=>({ok:true,available:true,profileName:'User'}),run:async(action,_payload,attachmentOutput)=>{if(action==='Attachment'){fs.writeFileSync(attachmentOutput,'%PDF-1.4\nTEST');return{ok:true,name:'order.pdf',size:13};}throw new Error(action);}});
  const messageId=local.encodeMessageId(Buffer.from('e').toString('base64'),Buffer.from('s').toString('base64'));
  const result=await local.attachmentContent(messageId,'1');
  assert.equal(result.contentType,'application/pdf');assert.match(result.buffer.toString(),/%PDF/);
});

test('v7.08 AUTO motor Graph bağlı değilken Classic Outlook Local, Graph bağlanınca Graph kullanır', async()=>{
  let connected=false,graphSearch=0,localSearch=0;
  const graph={
    setup:{ready:false,code:'CONFIG_REQUIRED'},config:{applicationConfigured:false},
    publicStatus:()=>({enabled:true,configured:connected,connected,state:connected?'CONNECTED':'CONFIG_REQUIRED',email:connected?'user@company.com':''}),
    search:async()=>{graphSearch++;return{items:[{messageId:'graph'}]}},messageDetail:async()=>({}),mailboxMessageDetail:async()=>({}),attachmentContent:async()=>({}),
    beginConnect(){},handleCallback(){},disconnect(){},contextHash:()=> 'hash',accessibleSharedMailboxes:async()=>[],probeSharedMailbox:async()=>null,searchSharedMailbox:async()=>({items:[]}),applicationGraph:async()=>({}),applicationAccessToken:async()=>'',
  };
  const local={status:()=>({connected:true,available:true,bridgeAvailable:true,profileName:'Classic'}),search:async()=>{localSearch++;return{items:[{messageId:'local'}]}},detail:async()=>({}),attachmentContent:async()=>({}),open:async()=>({opened:true}),bridge:async()=>({opened:true})};
  const hybrid=createOutlookHybridService({graph,local});
  let status=hybrid.publicStatus('u1');assert.equal(status.activeEngine,'CLASSIC_OUTLOOK_LOCAL');
  await hybrid.search('u1',{orderNo:'1'},{});assert.equal(localSearch,1);assert.equal(graphSearch,0);
  connected=true;status=hybrid.publicStatus('u1');assert.equal(status.activeEngine,'MICROSOFT_GRAPH');
  await hybrid.search('u1',{orderNo:'1'},{});assert.equal(graphSearch,1);
});

test('v7.08 server ve UI Classic Outlook + Bridge + gelecekte Graph geçişini birlikte içerir',()=>{
  assert.match(SERVER,/createOutlookLocalService/);assert.match(SERVER,/createOutlookHybridService/);assert.match(SERVER,/\/api\/outlook\/local\/open/);assert.match(SERVER,/\/api\/outlook\/bridge/);
  assert.match(UI,/Classic Outlook Local/);assert.match(UI,/MICROSOFT_GRAPH/);assert.match(UI,/OUTLOOK_BRIDGE/);assert.match(UI,/data-outlook-open-local/);assert.match(UI,/data-outlook-bridge/);assert.match(UI,/enginePreference:'AUTO'/);
  assert.match(PS,/Outlook\.Application/);assert.match(PS,/GetDefaultFolder\(6\)/);assert.match(PS,/GetDefaultFolder\(5\)/);assert.match(PS,/\.Search\(\$query, 2\)/);assert.doesNotMatch(PS,/\.Send\(/);
});
