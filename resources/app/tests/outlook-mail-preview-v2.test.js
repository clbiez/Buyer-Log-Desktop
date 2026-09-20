'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const {parseEmailContent}=require('../server/lib/outlook-mail-content');
const {createOutlookIntelligenceService}=require('../server/lib/outlook-intelligence-service');
const UI=fs.readFileSync(path.join(ROOT,'public','outlook-mail.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','outlook-mail.css'),'utf8');
const PS=fs.readFileSync(path.join(ROOT,'server','lib','OutlookLocal.ps1'),'utf8');
const LOCAL=fs.readFileSync(path.join(ROOT,'server','lib','outlook-local.js'),'utf8');

test('Mail Preview V2 HTML tablo hücrelerini metne karıştırmaz ve paragraf yapısını korur',()=>{
  const html='<p>Merhaba tekrar,</p><p>Tam da bunu yazıyordum. 😊</p><table><tr><th>Season</th><th>Country</th></tr><tr><td>W6</td><td>Bangladesh</td></tr></table><p>Lisansörden dönüş bekliyoruz.</p>';
  const parsed=parseEmailContent(html,'html');
  assert.equal(parsed.previewText,'Merhaba tekrar,\n\nTam da bunu yazıyordum. 😊\n\n#Tablo1\n\nLisansörden dönüş bekliyoruz.');
  assert.doesNotMatch(parsed.previewText,/Season|Country|Bangladesh/);
  assert.equal(parsed.tableCount,1);
  assert.equal(parsed.tables[0].rows[1][1].text,'Bangladesh');
});

test('Mail Preview V2 plain text satır ve boş satırları korur',()=>{
  const parsed=parseEmailContent('Merhaba,\r\n\r\nİki model için onay bekliyoruz.\r\n\r\nDönüşünüzü rica ederiz.','text');
  assert.equal(parsed.mainText,'Merhaba,\n\nİki model için onay bekliyoruz.\n\nDönüşünüzü rica ederiz.');
  assert.equal(parsed.blocks.length,3);
});

test('Mail Preview V2 tracking/signature görsellerini ana içerik saymaz',()=>{
  const html='<p>Onayınızı rica ederim.</p><img src="cid:real" width="640" height="400"><img src="https://t/pixel" width="1" height="1"><p>Best Regards</p><img src="cid:logo" width="180">';
  const parsed=parseEmailContent(html,'html');
  assert.equal(parsed.imageCount,1);
  assert.match(parsed.previewText,/#Görsel1/);
  assert.doesNotMatch(parsed.previewText,/Best Regards|logo/);
});

test('Mail Preview V2 tehlikeli HTML yürütülebilir içerik üretmez',()=>{
  const parsed=parseEmailContent('<p>Merhaba<script>alert(1)</script></p><table><tr><td><img onerror="x" src="javascript:x">Safe</td></tr></table>','html');
  assert.doesNotMatch(parsed.mainText,/alert\(|javascript:|onerror/i);
  assert.equal(parsed.tableCount,1);
  assert.equal(parsed.tables[0].rows[0][0].text,'Safe');
});

test('V2 message detail ham body yerine structured content döndürür ve CID görsel attachment ile eşleşir',async()=>{
  const hybrid={
    publicStatus:()=>({connected:true}),accessibleSharedMailboxes:async()=>[],
    mailboxMessageDetail:async()=>({messageId:'local:1',contentType:'html',body:'<p>Merhaba</p><img src="cid:abc">',attachments:[{id:'4',name:'image.png',contentType:'image/png',isInline:true,contentId:'abc'}]}),
  };
  const service=createOutlookIntelligenceService({graph:hybrid,config:{outlookMailIntelligence:{}},env:{},canAccessEntity:()=>true,dataRoot:path.join(ROOT,'.tmp-mail-preview-test')});
  const detail=await service.messageDetail({id:'u1'},{entityType:'ORDER',entityId:'1',mailboxType:'CLASSIC_OUTLOOK_LOCAL',messageId:'local:1'});
  assert.equal(detail.body,undefined);
  assert.equal(detail.content.imageCount,1);
  assert.equal(detail.content.images[0].attachmentId,'4');
});

test('Classic Outlook Open EntryID/StoreID kullanır, fallback subject değil InternetMessageId kullanır ve pencereyi öne alır',()=>{
  assert.match(PS,/GetItemFromID\(\$entryId, \$storeId\)/);
  assert.match(PS,/Show-OutlookItemForeground/);
  assert.match(PS,/SetForegroundWindow/);
  assert.match(PS,/\$inspector\.Activate\(\)/);
  assert.match(LOCAL,/INTERNET_MESSAGE_ID_FALLBACK/);
  const searchOpen=PS.slice(PS.indexOf("if ($Action -eq 'SearchOpen')"),PS.indexOf("if ($Action -eq 'Search')"));
  assert.match(searchOpen,/internetMessageId/);
  assert.doesNotMatch(searchOpen,/subjectNeedle|candidateSubject/);
});

test('Frontend kompakt preview ve Detail structured content modelini kullanır',()=>{
  assert.match(UI,/class=\\?"outlookPreview/);
  assert.match(UI,/outlookContentRef/);
  assert.match(UI,/detailTableHtml/);
  assert.match(UI,/data\.content\|\|\{\}/);
  assert.match(UI,/data-outlook-inline-image/);
  assert.doesNotMatch(UI,/displayMailBody\(data\.body/);
  assert.match(CSS,/\.outlookPreview/);
  assert.match(CSS,/\.outlookTableScroll/);
});

test('Classic Outlook local adapter PowerShell preview satır sonlarını Node katmanında korur',async()=>{
  const {createOutlookLocalService}=require('../server/lib/outlook-local');
  const service=createOutlookLocalService({isWindows:true,runSync:()=>({ok:true,available:true,profileName:'User'}),run:async action=>action==='Search'?{ok:true,items:[{entryId:Buffer.from('e').toString('base64'),storeId:Buffer.from('s').toString('base64'),internetMessageId:'<x@y>',conversationId:'c',subject:'S',senderName:'A',receivedDateTime:'2026-08-25T10:00:00Z',sentDateTime:'2026-08-25T10:00:00Z',bodyPreview:'Merhaba\n\n#Tablo1\n\nTeşekkürler',tableCount:1,imageCount:0}]}:Promise.reject(new Error(action))});
  const result=await service.search({orderNo:'1'},{pageSize:25});
  assert.match(result.items[0].preview,/Merhaba\n\n#Tablo1\n\nTeşekkürler/);
});
