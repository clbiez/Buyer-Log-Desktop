'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../public/pricing-workspace-engine.js');

function fixture(){
  const rows=[{id:1,modelKod:'MODEL-A',plmId:'10',targetPrice:'2,00'},{id:2,modelKod:'MODEL-B',plmId:'20',targetPrice:'3.00'}];
  const requests=[{id:'q1',source:'collection',status:'active',manufacturers:[{name:'A'},{name:'B'}],items:[
    {id:'l1',rowId:1,modelKey:'kol:1',modelCode:'MODEL-A',manufacturer:'A',price:'1,85',approved:true,dropped:false},
    {id:'l2',rowId:1,modelKey:'kol:1',modelCode:'MODEL-A',manufacturer:'B',price:'',approved:false,dropped:false},
    {id:'l3',rowId:2,modelKey:'kol:2',modelCode:'MODEL-B',manufacturer:'A',price:'2.80',approved:false,dropped:false},
  ]}];
  return {rows,requests};
}
function loadData(){
  const root=process.env.BL_PRICING_TEST_DATA;
  if(!root)return fixture();
  const q=JSON.parse(fs.readFileSync(path.join(root,'application-data','quotations.json'),'utf8'));
  const c=JSON.parse(fs.readFileSync(path.join(root,'application-data','collection-workspaces','moderator.json'),'utf8'));
  return {rows:c.rows||[],requests:q.requests||[],real:true};
}

test('pricing engine classifies request workflow without mutating quotation records',()=>{
  const {requests}=fixture(),before=JSON.stringify(requests),stats=E.requestStats(requests[0]);
  assert.equal(stats.workflow,'approved');assert.equal(stats.modelCount,2);assert.equal(stats.manufacturerCount,2);assert.equal(JSON.stringify(requests),before);
});

test('selection summary matches Collection rows to quotation lines using stable identities',()=>{
  const {rows,requests}=fixture(),summary=E.selectionSummary(rows,requests,'collection');
  assert.equal(summary.selected,2);assert.equal(summary.targetCoverage,2);assert.equal(summary.approved,1);assert.equal(summary.partial,0);assert.equal(summary.ready,1);
});

test('uploaded Buyer Log dataset produces finite, internally consistent Pricing Workspace metrics',()=>{
  const data=loadData(),k=E.workspaceKpis(data.requests,'collection');
  assert.ok(k.allRequests>=k.requests);assert.equal(k.requests,k.waitingApproval+k.approved+k.waitingQuote);assert.ok(k.closed>=0);
  if(data.real){
    assert.equal(data.requests.length,38);assert.equal(k.allRequests,37);assert.equal(k.closed,26);assert.equal(k.requests,11);
    assert.equal(k.waitingApproval,5);assert.equal(k.approved,3);assert.equal(k.waitingQuote,3);
    const matched=data.rows.filter(row=>data.requests.some(req=>req.source==='collection'&&(req.items||[]).some(item=>E.lineMatchesRow(item,row))));
    assert.equal(matched.length,94);const summary=E.selectionSummary(matched.slice(0,20),data.requests,'collection');assert.equal(summary.selected,20);assert.equal(summary.targetCoverage,17);assert.equal(summary.approved,15);
  }
});

test('history summary ignores missing/zero prices and calculates best, average and spread',()=>{
  const s=E.historySummary([{manufacturer:'A',price:'1,50'},{manufacturer:'B',price:'2.00'},{manufacturer:'C',price:'0'},{manufacturer:'D',price:''}]);
  assert.equal(s.count,2);assert.equal(s.best,1.5);assert.equal(s.average,1.75);assert.equal(s.suppliers,2);assert.ok(Math.abs(s.spreadPct-33.3333333333)<1e-6);
});
