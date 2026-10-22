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

test('list module: inline edits, selection export, map button and Buyer Log contracts', () => {
  const ui=read('public/license-cards.js'),map=read('public/license-map-editor.js'),css=read('public/license-cards.css'),perf=read('public/perf-runtime.js');
  assert.match(ui,/data-lc-rate="\$\{key\}"/);
  assert.match(ui,/if\(e\.key==='Enter'&&el\.tagName!=='TEXTAREA'\)\{e\.preventDefault\(\);el\.blur\(\);save\(id\);\}/);
  assert.match(ui,/const cards=\(S\.data\?\.cards\|\|\[\]\)\.filter\(c=>S\.selected\.has\(c\.id\)\)/);
  assert.match(ui,/data-lc-act="map"/);
  assert.match(ui,/body\.rules=rules/);
  assert.match(map,/window\.BLLicenseMapEditor=\{open/);
  assert.match(map,/BLLicenseAtlasEngine\.normalize\(atlas\)/);
  assert.match(perf,/licensecards:\['license-cards-engine\.js\?rev=3','license-atlas-engine\.js\?rev=2','license-supplier-atlas\.js\?rev=1','license-map-editor\.js\?rev=1','license-cards\.js\?rev=5'\]/);
  assert.doesNotMatch(perf,/license-atlas-shell/,'the legacy iframe atlas is no longer loaded');
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(read('public/experience.css'),/\.lcwaiSeg,\.dmViewToggle,\.lcSeg\)>button:is\(/);
});
