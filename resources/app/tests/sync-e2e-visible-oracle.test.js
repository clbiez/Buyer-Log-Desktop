'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../scripts/sync-e2e/run.cjs'),'utf8'),start=code.indexOf('function verifyCalculation('),end=code.indexOf('\nasync function daily(s)',start),context=vm.createContext({Intl});vm.runInContext(code.slice(start,end),context);
const sample=require('./fixtures/sync-visible-cost-race.json');
test('native long-run stale drawer total fails even when sampled raw calculation matches',()=>{const checks=context.verifyCalculation(structuredClone(sample));assert.equal(checks.find(v=>v.name==='overseas-landed').ok,true);assert.equal(checks.find(v=>v.name==='visible-overseas-landed').ok,false)});
test('real displayed value must match the independent financial result at two decimals',()=>{const copy=structuredClone(sample);copy.displayedWaterfall[0].total='$5,93';assert.ok(context.verifyCalculation(copy).every(v=>v.ok))});
test('different observed row versions remain a traceability comparison instead of a false arithmetic failure',()=>{const copy=structuredClone(sample);copy.lineage.revisions.row++;const checks=context.verifyCalculation(copy);assert.ok(checks.every(v=>v.ok));assert.equal(copy.visibleComparison.status,'different-observed-source-version');assert.equal(checks.some(v=>v.name.startsWith('visible-')),false)});

const browserSource=fs.readFileSync(path.join(__dirname,'../scripts/sync-e2e/browser.cjs'),'utf8');
function settleFixture(status='draft',dirty=true){
 const ctx={dirty,feedback:{status,detail:''},kolWorkspaceSaveTimer:null,kolWorkspaceSaving:false,kolWorkspacePending:false,kolWorkspaceRevision:2,kolWorkspaceOwnerId:'owner',kolReadPendingWorkspace:()=>null,document:{getElementById:()=>({innerText:'state'})}};
 ctx.kolHasDirtyWorkspace=()=>ctx.dirty;ctx.kolSaveFeedbackByOwner={get:()=>ctx.feedback};
 ctx.R={deadline:async promise=>promise};
 const vmctx=vm.createContext(ctx),a=browserSource.indexOf('async function settle(',b=browserSource.indexOf('\nasync function snapshot(',a);vm.runInContext(browserSource.slice(a,b),vmctx);return{ctx,settle:vmctx.settle};
}
test('settle waits through a nonterminal automatic draft and returns one atomic snapshot',async()=>{
 const f=settleFixture();let disposed=false;
 const page={evaluate:()=>{throw Error('split post-wait read reopens the race')},waitForFunction:async predicate=>{
   assert.equal(predicate(),false,'a new automatic draft is not a completed save');f.ctx.dirty=false;f.ctx.feedback={status:'local',detail:''};const snap=predicate();
   // A real remote event may run after the wait. The captured result stays true.
   f.ctx.dirty=true;f.ctx.feedback={status:'draft',detail:''};
   return{jsonValue:async()=>JSON.parse(JSON.stringify(snap)),dispose:async()=>{disposed=true}};
 }};const result=await f.settle({page});assert.equal(result.dirty,false);assert.equal(result.feedback.status,'local');assert.equal(disposed,true);
});
test('settle returns explicit conflict and failed states without disguising them as accepted',async()=>{
 for(const status of ['conflict','failed']){const f=settleFixture(status),page={evaluate:()=>{throw Error('split read')},waitForFunction:async predicate=>{const snap=predicate();assert.equal(snap.dirty,true);return{jsonValue:async()=>JSON.parse(JSON.stringify(snap)),dispose:async()=>{}}}};const out=await f.settle({page});assert.equal(out.dirty,true);assert.equal(out.feedback.status,status)}
});
test('a permanently dirty nonterminal draft remains a bounded failure without driver retry',async()=>{
 const f=settleFixture();const page={waitForFunction:async(predicate,_arg,options)=>{assert.equal(options.timeout,45000);assert.equal(predicate(),false);throw Error('bounded nonterminal draft timeout')}};await assert.rejects(f.settle({page}),/bounded nonterminal draft timeout/);
});
