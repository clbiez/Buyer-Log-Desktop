'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Review=require('../public/test-report-assessment'),Checklist=require('../public/cp-checklist-engine');
function fixture() {
  const events=[],row={'Order Code':'4100001'},context={document:{documentElement:{lang:'en'}},state:{cp:{rows:[row]}},File,AbortController,setTimeout,clearTimeout,
    BLCpChecklistEngine:Checklist,BLTestReportAssessment:Review,BLTestReports:require('../public/test-report-engine'),
    BLCpAssistant:{_state:{rules:[],answers:{}},computeDecisionsForRows:()=>({byRow:new Map([[row,{orderKey:'po1'}]])})},
    BLStorage:{flushPending:async()=>{events.push('preferences');}},
    BuyerLogAI:{getStatus:async()=>({connected:true}),askWithFiles:async()=>{events.push('AI');return {structured:{ok:true},data:{protocol:Review.PROTOCOL,caseId:'session',snapshotId:'snapshot',coveredSourceIds:['s1'],unresolvedSourceIds:['s1'],assessments:[],explanation:'Unreadable'}};}},
    fetch:async(url,options)=>{events.push(url);const body=JSON.parse(options.body);return {ok:true,json:async()=>url.endsWith('prepare-review')?{packet:{protocol:Review.PROTOCOL,caseId:'session',snapshotId:'snapshot',sources:[{id:'s1',complete:true,pages:[{page:0,text:'text'}]}],cp:body.cp,checklistSteps:[],checklistStatuses:[]}}:{reports:[],assessment:{assessments:[],unresolvedSourceIds:['s1']}}};}};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/test-report-import'),'utf8'),context);
  context.BLTestReportImport._ui.session='session';return {context,events};
}
test('review waits for shared answer load, its pending write and preferences before preparing the packet',async()=>{
  const {context,events}=fixture();let release;
  context.BLChecklistSupplierSync={loadShared:async()=>{events.push('load');await new Promise(resolve=>{release=resolve;});return {answers:{}};},syncAnswerChanges:async()=>{events.push('sync');}};
  const running=context.BLTestReportImport.runAi();
  await new Promise(resolve=>setImmediate(resolve));assert.ok(release);assert.ok(!events.includes('AI'));assert.ok(!events.includes('/api/test-reports/prepare-review'));
  release();await running;
  assert.deepEqual(events,['preferences','load','sync','preferences','/api/test-reports/prepare-review','AI','/api/test-reports/ai-assessment']);
  assert.equal(context.BLTestReportImport._ui.ai.state,'done');
});
test('failed shared checklist load stops before AI and preserves the preview session',async()=>{
  const {context,events}=fixture();context.BLChecklistSupplierSync={loadShared:async()=>null};
  await context.BLTestReportImport.runAi();
  assert.equal(context.BLTestReportImport._ui.ai.state,'error');assert.equal(context.BLTestReportImport._ui.session,'session');assert.ok(!events.includes('AI'));
});
test('rendered Priority changes do not invalidate review; business field changes still do',async()=>{
  for(const field of ['Priority','Order Quantity']) {
    const {context,events}=fixture(),ask=context.BuyerLogAI.askWithFiles;
    context.BuyerLogAI.askWithFiles=async()=>{context.state.cp.rows[0][field]='changed';return ask();};
    await context.BLTestReportImport.runAi();
    assert.equal(context.BLTestReportImport._ui.ai.state,field==='Priority'?'done':'error');
    assert.equal(events.includes('/api/test-reports/ai-assessment'),field==='Priority');
  }
});
