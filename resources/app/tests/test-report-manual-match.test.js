'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Checklist=require('../public/cp-checklist-engine');
function preview(){
  const rows=[{'Order Code':'PO1',Category:'T-shirt'},{'Order Code':'PO2',Category:'T-shirt'}];
  const analyses=rows.map((sourceRow,i)=>({sourceRow,orderKey:'key'+i,checklistItemIds:['tests']}));
  const context={document:{documentElement:{lang:'en'}},state:{cp:{rows}},BLCpChecklistEngine:Checklist,BLTestReports:require('../public/test-report-engine'),
    BLCpAssistant:{_state:{rules:[{id:'tests',kind:'checklist'}],answers:{'key1::tests':{state:'rejected',source:'manual'}}}}};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/test-report-import.js'),'utf8'),context);
  const api=context.BLTestReportImport,entry={id:'source',report:require('../public/test-report-engine').reportFromAiExtract({talepNo:'90001',confidence:'HIGH'}),candidates:[{key:'key0',row:rows[0]}],chosen:'key0',itemId:'tests',include:false};
  api._ui.decision={byRow:new Map(rows.map((row,i)=>[row,analyses[i]]))};
  api._ui.store={reports:{},links:{}};api._ui.entries=[entry];
  const review={reportId:'90001',orderKey:'key0',step:'tests',status:'approved',blocked:false};
  api._ui.ai={state:'done',packet:{},reviews:{'90001::key0::tests':review}};
  return {api,entry,review,rows};
}
test('changing the match clears prior approvals and cannot transfer an AI pass to another PO',()=>{
  const {api,entry,review}=preview();
  assert.equal(api._plan(entry).next,'approved');
  Object.assign(entry,{include:true,reviewVerified:true,status:'approved',override:true});
  api._changeMatch(entry,'key1');
  assert.equal(entry.include,false);assert.equal(entry.reviewVerified,false);assert.equal(entry.status,'');assert.equal(entry.override,false);
  assert.equal(entry.originReview,review);assert.equal(review.orderKey,'key0');
  assert.equal(api._plan(entry).ready,false);
  entry.reviewVerified=true;entry.itemId='tests';
  assert.equal(api._plan(entry).next,'','scope verification alone never carries a pass');
  entry.status='rejected';assert.equal(api._plan(entry).next,'rejected');
  entry.include=true;
  api._changeMatch(entry,'key0');assert.equal(entry.reviewVerified,false);assert.equal(entry.include,false);assert.equal(entry.status,'');
});
test('extra PO is independent, starts empty, and duplicate report/PO selections block approval',()=>{
  const {api,entry}=preview();api._addPo(entry);
  const extra=api._ui.entries[1];
  assert.equal(api._ui.entries.length,2);assert.equal(entry.chosen,'key0');assert.equal(extra.chosen,'');assert.equal(extra.include,false);
  assert.equal(api._plan(extra).ready,false);
  api._changeMatch(extra,'key1');extra.itemId='tests';extra.reviewVerified=true;extra.status='approved';extra.include=true;entry.include=true;
  assert.equal(api._selectionConflicts(api._ui.entries.map(api._plan)),false);
  api._changeMatch(extra,'key0');extra.itemId='tests';extra.reviewVerified=true;extra.status='approved';extra.include=true;
  assert.equal(api._selectionConflicts(api._ui.entries.map(api._plan)),true,'same target and same status is still a duplicate report');
});
test('manual match still obeys CP freshness and edit permission',()=>{
  const {api,entry,rows}=preview();api._changeMatch(entry,'key1');entry.itemId='tests';entry.reviewVerified=true;entry.status='approved';
  api._ui.ai.cpChanged=true;assert.equal(api._plan(entry).ready,false);
  api._ui.ai.cpChanged=false;rows[1]._canEdit=false;assert.equal(api._plan(entry).ready,false);
});
test('a PO change clears the old checklist step, and a single product cannot receive a set-part answer',()=>{
  const {api,entry}=preview();entry.itemId='tests~part~A';
  api._changeMatch(entry,'key1');assert.equal(entry.itemId,'');
  entry.reviewVerified=true;entry.status='approved';entry.itemId='tests~part~A';
  assert.equal(api._plan(entry).ready,false);
});
