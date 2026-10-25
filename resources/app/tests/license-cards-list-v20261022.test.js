'use strict';
// License cards list view, inline rates, compact approval map and supplier atlas file.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../public/license-cards-engine');
const S=require('../public/license-supplier-atlas');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const day='2026-10-22';
const card=(id,license,licensor,rules=[],atlas=null)=>({id,license,licensor,editToken:id+'-t',rules,processAtlas:atlas});

test('one row per license × licensor; several licensors are never merged', () => {
  const cards=[card('a','NORTH STAR','Demo Licensing',[{id:'r1',royalty:10,trCommission:2,ydCommission:3,hologramCost:.15,opdStart:'2026-01-01'}]),
    card('b','NORTH STAR','DTR',[{id:'r2',royalty:8,trCommission:1,ydCommission:2,hologramCost:.2,opdStart:'2025-01-01'}]),card('c','BLUE','',[])];
  const rows=E.rows(cards,{day});
  assert.deepEqual(rows.map(r=>[r.license,r.licensor]),[['BLUE',''],['NORTH STAR','Demo Licensing'],['NORTH STAR','DTR']]);
  assert.equal(E.rows(cards,{day,licensor:'DTR'}).length,1);
  assert.equal(E.rows(cards,{day,licensor:''}).map(r=>r.id).join(),'c');
  assert.equal(E.rows(cards,{day,status:'missing'}).map(r=>r.id).join(),'c');
  assert.equal(E.rows(cards,{day,query:'dtr'}).map(r=>r.id).join(),'b');
  assert.deepEqual(E.rows(cards,{day,sort:{key:'royalty',dir:'desc'}}).map(r=>r.id),['a','b','c']);
  assert.deepEqual(E.licensorOptions(cards).map(o=>o.label),['Demo Licensing','DTR','']);
});

test('row contract is the newest active one; inline rates use the server limits', () => {
  const rules=[{id:'old',royalty:9,opdStart:'2025-01-01',opdEnd:'2025-12-31'},{id:'cur',royalty:10,opdStart:'2026-01-01'},{id:'aw',royalty:7,opdStart:'2026-03-01',seasons:['AW26']}];
  const primary=E.primaryContract(rules,day);assert.equal(primary.rule.id,'aw');assert.equal(primary.extraActive,1);assert.equal(primary.status,'active');
  assert.equal(E.primaryContract([],day).status,'none');
  assert.equal(E.parseRate('1,5'),1.5);assert.equal(E.parseRate(''),null);assert.ok(Number.isNaN(E.parseRate('x')));
  const ok={royalty:18.7,trCommission:2.9,ydCommission:null,hologramCost:0.05,opdStart:'2026-01-01',opdEnd:''};
  assert.equal(E.rateError(ok),'');
  assert.equal(E.rateError({...ok,royalty:null}),'royalty');
  assert.equal(E.rateError({...ok,trCommission:null}),'commission-missing');
  assert.equal(E.rateError({...ok,royalty:99,trCommission:5}),'commission');
  assert.equal(E.rateError({...ok,royalty:99.9,trCommission:0.1}),'','exact decimal sum may reach 100');
  assert.equal(E.rateError({...ok,hologramCost:-1}),'hologram');
  assert.equal(E.rateError({...ok,opdEnd:'2025-12-31'}),'date');
});

test('compact approval map: enabled steps, approver, test, routes; image comes from the atlas cover', () => {
  const atlas={license:{cover:'data:image/webp;base64,AAAA',stages:[{id:'s1',title:'Konsept',approver:'licensor',testRequired:true,submissions:[{id:'r'}]},{id:'s2',title:'Off',enabled:false},{id:'s3',title:'Odd',approver:'weird'}]}};
  const c=card('a','A','L',[],atlas);
  assert.deepEqual(E.mapSummary(c).map(s=>[s.index,s.title,s.approver,s.test,s.routes]),[[1,'Konsept','licensor',true,1],[2,'Odd','unknown',false,0]]);
  assert.equal(E.cardImage(c),'data:image/webp;base64,AAAA');
  assert.equal(E.cardImage({symbolDataUrl:'data:image/png;base64,BBBB'}),'data:image/png;base64,BBBB');
  assert.equal(E.cardImage({processAtlas:{license:{cover:'javascript:alert(1)'}}}),'');
});

test('supplier atlas contains only selected, supplier-visible content and never commercial terms', () => {
  const atlas={version:1,license:{id:'x',name:'NORTH STAR',internalNotes:'SECRET-INTERNAL',stages:[{id:'s1',title:'Konsept',approver:'licensor',note:'PRIVATE NOTE',supplierShowSourceNote:false,supplierInstructions:'Send via portal',submissions:[{id:'r1',method:'portal',recipientType:'licensor',recipient:'Demo',note:'ROUTE PRIVATE'}]},{id:'s2',title:'HiddenStep',manufacturerVisible:false,submissions:[]}],addresses:[],portal:{url:'https://portal.example',notes:'P'}},sharedAddresses:[],visualLibrary:[]};
  const cards=[card('a','NORTH STAR','Demo',[{id:'r',royalty:12.345}],atlas),card('b','BARE','',[]),card('c','CLOSED','X',[],{...atlas,license:{...atlas.license,manufacturerVisible:false}})];
  const {licenses,skipped}=S.project(cards,'tr');
  assert.deepEqual(licenses.map(l=>l.name),['NORTH STAR','BARE']);assert.deepEqual(skipped,['CLOSED']);
  const html=S.buildHTML(licenses,{lang:'en',fonts:'@font-face{font-family:"Barlow"}'});
  for(const secret of ['SECRET-INTERNAL','PRIVATE NOTE','ROUTE PRIVATE','HiddenStep','portal.example','12.345'])assert.ok(!html.includes(secret),secret);
  assert.ok(html.includes('Send via portal')&&html.includes('Licensor')&&html.includes('No approval steps are defined'));
  assert.match(html,/default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'/);
  assert.ok(!/<script/i.test(html),'the supplier file runs no script');
  assert.match(html,/prefers-color-scheme:dark/);
});

test('supplier atlas keeps route addresses only in steps and opens collapsible guides inside initially closed steps', () => {
  const license={
    name:'Demo',agency:'Licensor',cover:'',requirements:'',
    stages:[{id:'step-1',title:'Fit sample',approver:'LCW',testRequired:false,
      visualGuideId:'guide-1',submissions:[{id:'route-1',method:'physical',recipientType:'LCW',
        recipient:'Local Office',addressId:'address-1',qty:'1 piece',timing:'approval'}]}],
    addresses:[{id:'address-1',label:'LCW HQ',text:'42 Sample Lane'}],
    visualLibrary:[{id:'guide-1',name:'Fit guide',data:'data:image/png;base64,AAAA'}],
    portal:{url:'',notes:''},customSelectOptions:{}
  };
  for(const lang of ['en','tr']){
    const html=S.buildHTML([license],{lang});
    assert.equal(html.split('42 Sample Lane').length-1,1,'address should appear once in its route');
    assert.match(html,/<small>LCW HQ · 42 Sample Lane<\/small>/);
    assert.doesNotMatch(html,/Shipping addresses|Gönderim adresleri/);
    assert.match(html,/<li class="step"><details class="step-fold"><summary class="step-head"><span class="dot">1<\/span>/,
      'stage should start closed, with an accessible native toggle at its number');
    assert.match(html,/<span class="step-title">Fit sample/,
      'clicking the title should also toggle the stage');
    assert.match(html,/<div class="step-body">[\s\S]*?<div class="routes">/,
      'route details should be inside the collapsible body');
    assert.match(html,/<details class="vg" open><summary>(?:Visual guide|Görsel kılavuz)<\/summary><img class="guide"/,
      'guide should be open when its parent step is expanded, and independently collapsible');
    assert.doesNotMatch(html,/<details class="step-fold" open>/);
    assert.match(html, /\.step-fold::details-content[\s\S]*?content-visibility:visible/,
      'printing must show stage details even when folded on screen');
    assert.match(html,/<details class="lic" id="l0"/,'license drawer must remain user-toggleable');
    assert.doesNotMatch(html,/<script/i,'supplier export must stay script-free');
  }
});

test('all atlas stages are independently collapsible by their 1/2/3/4 number, with no embedded scripts',()=>{
  const stages=Array.from({length:4},(_,i)=>({id:'s'+i,title:'Stage '+(i+1),approver:'LCW',
    submissions:[],testRequired:false,visualGuideId:''}));
  const html=S.buildHTML([{name:'Four steps',agency:'LCW',cover:'',requirements:'',stages,addresses:[],
    visualLibrary:[],portal:{url:'',notes:''},customSelectOptions:{}}],{lang:'en'});
  assert.equal((html.match(/<details class="step-fold">/g)||[]).length,4);
  assert.deepEqual([...html.matchAll(/<summary class="step-head"><span class="dot">(\d+)<\/span>/g)].map(m=>m[1]),
    ['1','2','3','4']);
  assert.equal((html.match(/<div class="step-body">/g)||[]).length,4);
  assert.equal((html.match(/<details class="step-fold" open>/g)||[]).length,0);
  assert.doesNotMatch(html,/<script/i);
});

test('supplier HTML for email has a hard decimal 9MB limit, unchanged for small exports',async()=>{
  assert.equal(S.MAX_EMAIL_BYTES,9000000);
  const item={name:'LCW',agency:'Licensor',cover:'',requirements:'Gönderim / approval',
    stages:[],addresses:[],portal:{url:'',notes:''},visualLibrary:[],customSelectOptions:{}};
  const fonts='@font-face{font-family:"Barlow";}';
  const date=new Date('2026-10-23T00:00:00Z');
  const original=S.buildHTML([item],{lang:'tr',fonts,generatedAt:date});
  const file=await S.buildEmailSafeHTML([item],{lang:'tr',fonts,generatedAt:date});
  assert.equal(file.blob.size,new Blob([original]).size);
  assert.equal(file.bytes,file.blob.size);
  assert.equal(file.optimized,false);
  assert.ok(file.bytes<=S.MAX_EMAIL_BYTES);
});

test('oversized supplier visuals are compressed in browser without omitting approved steps',async()=>{
  const image='data:image/png;base64,'+'A'.repeat(12000);
  const item={name:'LCW',agency:'Licensor',cover:image,requirements:'',
    stages:[{id:'s',title:'Accessory',approver:'LCW',visualGuideId:'g',testRequired:false,
      submissions:[{method:'physical',recipientType:'LCW',recipient:'Office',addressId:'a'}]}],
    addresses:[{id:'a',label:'LCW',text:'Delivery address'}],
    visualLibrary:[{id:'g',name:'Visual',data:image}],portal:{url:'',notes:''},customSelectOptions:{}};
  const replacement='data:image/webp;base64,'+'B'.repeat(360),encodes=[];
  const file=await S.buildEmailSafeHTML([item],{lang:'en',maxBytes:12500,
    encodeImage:async (value,edge,quality)=>{encodes.push({value,edge,quality});return replacement;}});
  assert.equal(encodes.length,1,'same source is encoded once per pass');
  assert.equal(file.compressedImages,1);
  assert.ok(file.blob.size<=12500&&file.bytes<=S.MAX_EMAIL_BYTES);
  const html=await file.blob.text();
  assert.ok(html.includes('Delivery address'));
  assert.match(html,/<details class="step-fold">/);
  assert.match(html,/<details class="vg" open>/);
  assert.equal(html.split(replacement).length-1,3,'cover twice and visual once');
  assert.ok(!html.includes(image));
});

test('atlas may drop embedded font CSS but never drop required content to reach size',async()=>{
  const item={name:'LCW',agency:'Licensor',cover:'',requirements:'X'.repeat(10000),
    stages:[],addresses:[],portal:{url:'',notes:''},visualLibrary:[],customSelectOptions:{}};
  await assert.rejects(S.buildEmailSafeHTML([item],{maxBytes:4000}),e=>
    e.code==='ATLAS_EMAIL_SIZE_LIMIT'&&e.limit===4000&&e.bytes>4000);
  const small={...item,requirements:'Approval'};
  const fonts='/* '+('F'.repeat(8000))+' */';
  const file=await S.buildEmailSafeHTML([small],{fonts,maxBytes:12500});
  assert.equal(file.fontsRemoved,true);
  assert.equal(file.compressedImages,0);
  assert.ok(file.blob.size<=12500);
  assert.match(await file.blob.text(),/Approval/);
});

test('supplier download is guarded by final Blob size and transparent error handling',()=>{
  const ui=read('public/license-cards.js');
  assert.match(ui,/await A\.buildEmailSafeHTML\(licenses/);
  assert.match(ui,/result\.blob\.size>A\.MAX_EMAIL_BYTES/);
  assert.match(ui,/URL\.createObjectURL\(result\.blob\)/);
  assert.match(ui,/ATLAS_EMAIL_SIZE_LIMIT/);
});

test('list module: inline edits, selection export, map button and Buyer Log contracts', () => {
  const ui=read('public/license-cards.js'),map=read('public/license-map-editor.js'),css=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','license-cards.css']),perf=read('public/perf-runtime.js');
  assert.match(ui,/data-lc-rate="\$\{key\}"/);
  assert.match(ui,/if\(e\.key==='Enter'&&el\.tagName!=='TEXTAREA'\)\{e\.preventDefault\(\);el\.blur\(\);save\(id\);\}/);
  assert.match(ui,/const cards=\(S\.data\?\.cards\|\|\[\]\)\.filter\(c=>S\.selected\.has\(c\.id\)\)/);
  assert.match(ui,/data-lc-act="map"/);
  assert.match(ui,/body\.rules=rules/);
  assert.match(map,/window\.BLLicenseMapEditor=\{open/);
  assert.match(map,/BLLicenseAtlasEngine\.normalize\(atlas\)/);
  assert.match(perf,/licensecards:\['license-cards-engine\.js\?rev=4','license-atlas-engine\.js\?rev=2','license-supplier-atlas\.js\?rev=3','license-map-editor\.js\?rev=1','license-cards\.js\?rev=7'\]/);
  assert.doesNotMatch(perf,/license-atlas-shell/,'the legacy iframe atlas is no longer loaded');
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  const common=require('./helpers/manifest-css')(); for(const selector of ['.lcwaiSeg>button.active','.dmViewToggle>button.active','.lcSeg>button.active']) assert.ok(common.includes(selector),selector);
});
