'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/checklist-supplier-sync.js'),'utf8'),main=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const row=(code)=>({_id:1,'Order Code':code,'Model Name':'DEMO','C.Code':'01'}),deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness(){
 const original=row('100'),ready=deferred(),calls={answers:[],sync:0,refresh:0,dialogs:0,components:0},ctx={state:{currentUser:{id:'buyer'},cp:{rows:[original]}},ensureAssistant:()=>ready.promise,analysesForRows:rows=>({byRow:new Map(rows.map(row=>[row,{orderKey:row['Order Code']}]))}),syncAnswerChanges:async()=>{calls.sync++;},refreshColumns:()=>{calls.refresh++;},T:(_tr,en)=>en,toast(){},currentRows:()=>[],html:String,assistantState:()=>({answers:{}}),Components:{configKey:()=> 'components'},componentParts:()=>[],openComponentCountDialog:(_count,_minimum,onSave)=>{calls.dialogs++;ctx.saveComponents=onSave;}};
 ctx.root=ctx;vm.createContext(ctx);vm.runInContext(main.slice(main.indexOf('function turknorm('),main.indexOf('function lineIdentity(')),ctx);
 if(source.includes('function checklistTriggerIdentity('))vm.runInContext(source.slice(source.indexOf('function checklistTriggerIdentity('),source.indexOf('function elementCellHtml(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function cpRowById('),source.indexOf('function openStatusMenu(')),ctx);
 vm.runInContext(source.slice(source.indexOf('async function configureComponents('),source.indexOf('function currentRows(')),ctx);
 const trigger={dataset:{id:'1',item:'tests',lineKey:ctx.lineKeyOfRow(original),editOwner:'buyer'}};
 return {ctx,ready,trigger,original,calls,assistant:{setChecklistAnswer:(analysis,item,status)=>{calls.answers.push({analysis,item,status});return true;},setChecklistComponents:()=>{calls.components++;return true;}}};
}

for(const change of ['identity','owner','view-only'])test('checklist status rechecks '+change+' after awaiting its assistant',async()=>{
 const h=harness(),pending=h.ctx.chooseStatus(h.trigger,'approved');
 if(change==='identity')h.ctx.state.cp.rows=[row('999')];else if(change==='owner')h.ctx.state.currentUser={id:'other'};else h.original._canEdit=false;
 h.ready.resolve(h.assistant);await pending;assert.equal(h.calls.answers.length,0);assert.equal(h.calls.sync,0);assert.equal(h.calls.refresh,0);
});

test('a current checklist trigger still saves and synchronizes its exact canonical order',async()=>{
 const h=harness(),pending=h.ctx.chooseStatus(h.trigger,'approved');h.ready.resolve(h.assistant);await pending;assert.equal(h.calls.answers.length,1);assert.equal(h.calls.answers[0].analysis.orderKey,'100');assert.equal(h.calls.sync,1);assert.equal(h.calls.refresh,1);
});

test('readonly legacy evidence remains readable while status mutations stay blocked',()=>{
 const h=harness();h.original._canEdit=false;assert.equal(h.ctx.boundChecklistTriggerRow(h.trigger),null);assert.equal(h.ctx.boundChecklistTriggerRow(h.trigger,{write:false}),h.original);
});

for(const change of ['identity','owner'])test('component configuration rechecks '+change+' after assistant readiness',async()=>{
 const h=harness(),pending=h.ctx.configureComponents(h.trigger);if(change==='identity')h.ctx.state.cp.rows=[row('999')];else h.ctx.state.currentUser={id:'other'};
 h.ready.resolve(h.assistant);await pending;assert.equal(h.calls.dialogs,0);assert.equal(h.calls.components,0);
});

for(const change of ['identity','owner'])test('an open component dialog cannot save after '+change+' changes',async()=>{
 const h=harness(),pending=h.ctx.configureComponents(h.trigger);h.ready.resolve(h.assistant);await pending;assert.equal(h.calls.dialogs,1);
 if(change==='identity')h.ctx.state.cp.rows=[row('999')];else h.ctx.state.currentUser={id:'other'};
 await assert.rejects(h.ctx.saveComponents(2),/order|session/i);assert.equal(h.calls.components,0);assert.equal(h.calls.sync,0);
});
