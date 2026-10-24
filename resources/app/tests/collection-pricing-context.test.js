'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Engine=require('../public/collection-pricing-engine');
const Business=require('../public/business-rules');
test('CP pricing context preserves numeric order matching and first-partial precedence',()=>{
 const rows=[{'Order Code':'00100',License:'FIRST'},{'Order Code':100,License:'SECOND'},{'Order Code':'AB',License:'TEXT'}],index=Engine.createCpContextIndex(row=>row['Order Code']);assert.equal(index.find(rows,100,'buyer:1'),rows[0]);assert.equal(index.find(rows,'1e2','buyer:1'),rows[0]);assert.equal(index.find(rows,' AB ','buyer:1'),rows[2]);assert.equal(index.find(rows,999,'buyer:1'),null);
});
test('a warm context lookup visits only its candidate rather than scanning the CP projection',()=>{
 const rows=Array.from({length:10000},(_,i)=>({'Order Code':i+1}));let reads=0;const index=Engine.createCpContextIndex(row=>{reads++;return row['Order Code'];});index.find(rows,9999,'owner:revision');const cold=reads;for(let i=0;i<100;i++)assert.equal(index.find(rows,9999,'owner:revision'),rows[9998]);assert.equal(reads-cold,100);
});
test('scope/source revisions, array replacement and length changes invalidate the context',()=>{
 const a={'Order Code':100,Country:'China'},rows=[a],index=Engine.createCpContextIndex(row=>row['Order Code']);assert.equal(index.find(rows,100,'buyer:1'),a);rows[0]={'Order Code':200};assert.equal(index.find(rows,200,'buyer:2'),rows[0]);assert.equal(index.find(rows,100,'buyer:2'),null);const replacement=[{'Order Code':100}];assert.equal(index.find(replacement,100,'buyer:2'),replacement[0]);replacement.push({'Order Code':300});assert.equal(index.find(replacement,300,'buyer:2'),replacement[1]);assert.equal(index.find([],100,'other-owner:1'),null);
});
test('in-place CP field updates stay live and stale identity candidates never match the old key',()=>{
 const row={'Order Code':100,Country:'China'},rows=[row],index=Engine.createCpContextIndex(item=>item['Order Code']);index.find(rows,100,'same');row.Country='Turkey';assert.equal(index.find(rows,100,'same').Country,'Turkey');row['Order Code']=200;assert.equal(index.find(rows,100,'same'),null);assert.equal(index.find(rows,200,'same'),row);rows[0]={'Order Code':300};index.invalidate(rows);assert.equal(index.find(rows,300,'same'),rows[0]);
});
test('the actual Collection helper binds the CP index to owner, authority and source revisions',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),name='kolSourceCpRow',start=app.indexOf('function '+name+'('),end=app.indexOf('\n}',start),row={'Order Code':100,License:'FIRST'},ctx={window:{BLCollectionPricingEngine:Engine},state:{currentUser:{id:'buyer',dataScope:{mode:'SELF'}},storeRevisions:{orders:1},cp:{rows:[row]}},sameOrderCode:(a,b)=>Number(a)===Number(b)};vm.createContext(ctx);vm.runInContext(app.slice(start,end+2),ctx);assert.equal(ctx.kolSourceCpRow({_sourceOrderCode:100}),row);
 const next={'Order Code':200,License:'SECOND'};ctx.state.cp.rows[0]=next;ctx.state.storeRevisions.orders++;assert.equal(ctx.kolSourceCpRow({_sourceOrderCode:200}),next);ctx.state.cp.rows[0]={'Order Code':300};ctx.state.currentUser.dataScope={mode:'NONE'};assert.equal(ctx.kolSourceCpRow({_sourceOrderCode:300}),ctx.state.cp.rows[0]);ctx.state.currentUser={id:'other',dataScope:{mode:'SELF'}};ctx.state.cp.rows=[];assert.equal(ctx.kolSourceCpRow({_sourceOrderCode:100}),null);
});

test('rule lookup memo preserves latest/future contract, country commission and missing results',()=>{
 const rules=[{id:'old',licensor:'DEMO',license:'LICENSE',opdStart:'2025-01-01',trCommission:1,ydCommission:2},{id:'future',licensor:'DEMO',license:'LICENSE',opdStart:'2027-01-01',trCommission:null,ydCommission:2}],ctx={country:'China',season:'W26',licensor:'DEMO',license:'LICENSE'};let calls=0;
 const helpers={api:Business,matches:(r,c)=>{calls++;return r.licensor===c.licensor&&r.license===c.license;},freshness:r=>({start:Date.parse(r.opdStart),end:0})},resolver=Engine.createRuleResolver(helpers);
 assert.equal(resolver.find(ctx,'China',rules,1),rules[1]);assert.equal(resolver.find(ctx,'TR',rules,1),rules[0]);const warm=calls;for(let i=0;i<100;i++)assert.equal(resolver.find(ctx,'China',rules,1),rules[1]);assert.equal(calls,warm);assert.equal(resolver.find({...ctx,licensor:''},'TR',rules,1),null);assert.equal(resolver.find({...ctx,license:'OTHER'},'TR',rules,1),null);
});

test('rule/source/scope revisions and explicit local invalidation refresh cached selections',()=>{
 const a={id:'a',opdStart:'2026-01-01'},b={id:'b',opdStart:'2025-01-01'},rules=[a,b],ctx={licensor:'DEMO',license:'LICENSE'},helpers={api:Business,matches:()=>true,freshness:r=>({start:Date.parse(r.opdStart),end:0})},resolver=Engine.createRuleResolver(helpers);assert.equal(resolver.find(ctx,'TR',rules,'owner:1'),a);b.opdStart='2027-01-01';assert.equal(resolver.find(ctx,'TR',rules,'owner:2'),b);a.opdStart='2028-01-01';resolver.invalidate();assert.equal(resolver.find(ctx,'TR',rules,'owner:2'),a);const replacement=[b];assert.equal(resolver.find(ctx,'TR',replacement,'owner:2'),b);replacement.push(a);assert.equal(resolver.find(ctx,'TR',replacement,'other-owner:1'),a);
});

test('the selected-rule cache is bounded when many different missing contexts are visited',()=>{
 let calls=0;const rules=[{id:'rule'}],helpers={api:Business,matches:()=>{calls++;return false;},freshness:()=>({start:0,end:0})},resolver=Engine.createRuleResolver(helpers);for(let i=0;i<600;i++)resolver.find({licensor:'DEMO',license:'LICENSE-'+i},'TR',rules,1);const after=calls;resolver.find({licensor:'DEMO',license:'LICENSE-599'},'TR',rules,1);assert.equal(calls,after);resolver.find({licensor:'DEMO',license:'LICENSE-0'},'TR',rules,1);assert.equal(calls,after+1,'older contexts are evicted rather than retained forever');
});
