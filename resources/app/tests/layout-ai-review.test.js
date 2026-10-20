'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const review=require('../public/layout-ai-review'),template=require('../public/layout-control-template');
const cp=[{orderCode:'1387740',modelName:'KK.BDY,PSG-5-YD',specialCode:'S7AF82Z4',colourCode:'HQ6',country:'India',line:'LSN-KKL5-NK LINE',mag:'CU4E',fabricComposition:'100% Cotton'},{orderCode:'1387748',modelName:'KK.BDY,PSG-5-YD',specialCode:'S7AF82Z4',colourCode:'HQ6',country:'India',line:'LSN-KKL5-NK LINE'}];
test('Buyer Log links exact orders and projects canonical CP facts without label judgments',()=>{
 const link=review.linkOrders({orderNumbers:['1387740','1387748'],modelCodes:['WRONG']},cp);
 assert.equal(link.reference.status,'MULTIPLE');assert.equal(link.referenceRows.length,2);
 assert.equal(review.projectRows(link.referenceRows)[0].line,'LSN-KKL5-NK LINE');assert.equal(review.projectRows(link.referenceRows)[0].country,'India');
 const absent=review.linkOrders({orderNumbers:['1397577'],modelCodes:['KK.BDY,PSG-5-YD']},cp);assert.equal(absent.referenceRows.length,0);assert.deepEqual(absent.reference.unmatchedOrderCodes,['1397577']);
 assert.equal(review.linkOrders({modelCodes:['KK.BDY,PSG-5-YD']},cp).reference.status,'AMBIGUOUS');
});
const finding={section:'PRICE_TAG',field:'modelName',title:'Model name',verdict:'ERROR',orderCode:'1387740',page:1,bbox:[.1,.2,.5,.1],actual:'PSG-5-Y',expected:'PSG-5-YD',comment:'The final D is missing.',correction:'Print PSG-5-YD.',standardType:'PRICE_TAG',standardPage:14};
function result(findings=[finding]){return {batches:[{pages:[1],data:{documentType:'MIXED',summary:'LCW AI found a model typo.',inspectedPages:['1'],findings:findings.map(f=>JSON.stringify(f))}}],totalPages:1};}
test('LCW AI owns actual/expected/comment/verdict; no local template checks are fabricated',()=>{
 const report=review.report(result(),{extraction:{},...review.linkOrders({orderNumbers:['1387740']},cp)},'en');
 assert.equal(report.checks.length,1);const check=report.checks[0];assert.equal(check.category,'AI_REVIEW');assert.equal(check.status,'MISMATCH');assert.equal(check.decision,'PENDING');assert.equal(check.title,'Model name');assert.deepEqual(check.expected,['PSG-5-YD']);assert.equal(check.detail,finding.comment);assert.equal(check.source,'LCW AI');
 assert.deepEqual(check.bbox,finding.bbox);assert.equal(report.aiSummary,'LCW AI found a model typo.');assert.equal(template.reviewStatus(report.checks),'PENDING');
 check.decision='APPROVED';check.status='MATCH';assert.equal(template.reviewStatus(report.checks),'APPROVED');
});
test('inner barcode alone never generates missing care-language or composition findings',()=>{
 const report=review.report(result([{...finding,section:'INNER_BARCODE',field:'orderCode',verdict:'MATCH',title:'Order',actual:'1387740',expected:'1387740',comment:'Order matches.'}]),{},'en');
 assert.equal(report.checks.length,1);assert.equal(report.checks[0].section,'INNER_BARCODE');assert.equal(report.checks[0].status,'MATCH');assert.ok(!report.checks.some(c=>/LANG|COMPOSITION/.test(c.rule)));
});
test('invalid AI records and missing page coverage cannot silently become an approvable review',()=>{
 for(const payload of [result([{...finding,verdict:'MADE_UP'}]),{batches:[],totalPages:2},result([])]){
  const report=review.report(payload,{},'en');assert.ok(report.checks.some(c=>c.rule==='LCW_REVIEW_INCOMPLETE'));assert.equal(template.reviewStatus(report.checks),'PENDING');
 }
 const report=review.report(result([{...finding,page:99,bbox:[0,0,3,1]}]),{},'en');assert.equal(report.checks[0].page,null);assert.equal(report.checks[0].bbox,null);
});
test('active UI only renders LCW AI findings; deterministic label assessments are no longer called',()=>{
 const ui=fs.readFileSync(require.resolve('../public/layout-control'),'utf8');assert.match(ui,/BLLayoutAIReview/);assert.match(ui,/reader\(\)\.review/);assert.doesNotMatch(ui,/E\(\)\.assess\(|template\(\)\.focusedChecks\(|E\(\)\.fireRequirement\(/);
});
test('review parser rejects oversized findings instead of discarding a final error',()=>{
 const prompts=require('../server/lib/lcwai/lcwai-prompt'),findings=Array.from({length:121},(_,i)=>JSON.stringify({...finding,verdict:i===120?'ERROR':'MATCH'}));
 const parsed=prompts.parseStructured(JSON.stringify({documentType:'PRICE_TAG',summary:'AI review',inspectedPages:['1'],findings}),'layout-review');
 assert.equal(parsed.ok,false);assert.ok(parsed.errors.includes('invalid-array:findings'));
 const valid=prompts.parseStructured(JSON.stringify({documentType:'PRICE_TAG',summary:'AI review',inspectedPages:['1'],findings:[JSON.stringify(finding)]}),'layout-review');assert.equal(valid.ok,true);
});
test('AI judgments and buyer decisions persist independently without allowing comment edits to rewrite AI evidence',t=>{
 const {spawnSync}=require('node:child_process'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'lcwai-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=`const assert=require('node:assert/strict'),s=require('./server/lib/layout-control-store');const run=s.add('owner',{mode:'LCW_AI',documentType:'MIXED',aiSummary:'Original AI conclusion',reference:{status:'MULTIPLE',orderCodes:['1','2']},checks:[{rule:'AI_0',category:'AI_REVIEW',source:'LCW AI',status:'MISMATCH',aiVerdict:'ERROR',title:'Model',field:'modelName',section:'PRICE_TAG',orderCode:'1',actual:['WRONG'],expected:['RIGHT'],detail:'AI reason'}]}).run;assert.equal(run.reviewStatus,'PENDING');const updated=s.review('owner',run.id,{check:{rule:'AI_0',decision:'APPROVED',comment:'Buyer checked',expected:['INJECTED'],detail:'Changed'}}).run;assert.equal(updated.reviewStatus,'APPROVED');assert.equal(updated.checks[0].assessmentStatus,'MISMATCH');assert.equal(updated.checks[0].aiVerdict,'ERROR');assert.deepEqual(updated.checks[0].expected,['RIGHT']);assert.equal(updated.checks[0].detail,'AI reason');assert.equal(updated.aiSummary,'Original AI conclusion');assert.equal(updated.reference.status,'MULTIPLE');assert.throws(()=>s.review('other',run.id,{check:{rule:'AI_0',decision:'REJECTED'}}),/NOT_FOUND/);`;
 const out=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:root},encoding:'utf8'});assert.equal(out.status,0,out.stderr||out.stdout);
});
