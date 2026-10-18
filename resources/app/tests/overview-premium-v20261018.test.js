'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../public/overview-premium.js');
const layout=require('../public/overview-layout.js');
const day=Date.UTC(2026,9,18)/86400000;

test('delivery horizon uses canonical ordinals, preserves missing/overdue dates and separates risk from unknown calculation',()=>{
 const orders=[
  {orderKey:'a',plannedLoadDate:day,qty:100,priority:'CRITICAL',calculationStatus:'UNKNOWN'},
  {orderKey:'b',plannedLoadDate:day+1,qty:200,priority:'ON_TRACK',calculationStatus:'OK'},
  {orderKey:'c',plannedLoadDate:null,qty:300,priority:'WATCH'},
  {orderKey:'d',plannedLoadDate:day-1,qty:400,priority:'ACTION_TODAY'},
  {orderKey:'e',plannedLoadDate:day+20,qty:500,priority:'ON_TRACK'},
 ];
 const h=P.buildHorizon(orders,{start:day,days:7});
 assert.equal(h.days.length,7);assert.equal(h.days[0].qty,100);assert.equal(h.days[0].riskQty,100);
 assert.equal(h.days[0].unknownRows,1);assert.equal(h.qty,300);assert.equal(h.missing.length,1);
 assert.equal(h.overdue.length,1);assert.equal(h.outside.length,1);assert.equal(h.days[1].riskQty,0);
 assert.equal(h.days[0].rows[0],orders[0]);
});

test('coverage is a union of required date fields and does not sum overlapping omissions',()=>{
 const result=P.buildCoverage([
  {plannedLoadDate:day,targetDate:day+10,calculationStatus:'OK'},
  {plannedLoadDate:null,targetDate:null,calculationStatus:'UNKNOWN'},
  {plannedLoadDate:day,targetDate:null,calculationStatus:'UNKNOWN'},
 ]);
 assert.equal(result.complete,1);assert.equal(result.total,3);assert.equal(result.percent,33);
 assert.equal(result.unknown,2);assert.equal(result.missingLoad,1);assert.equal(result.missingTarget,2);
 assert.equal(P.buildCoverage([]).percent,null);
});

test('metric chart retains signed values and plots each category once, never subtotal+leaf duplicates',()=>{
 const series=P.metricSeries([{label:'A',value:10},{label:'B',value:-5},{label:'C',value:null},{label:'D',value:0}]);
 assert.equal(series.rows.length,3);assert.equal(series.max,10);
 assert.equal(series.rows.find(r=>r.label==='B').value,-5);
 assert.equal(series.rows.find(r=>r.label==='D').value,0);
});

test('premium defaults surface map above details; saved v2 geometry and density survive normalisation',()=>{
 const next=layout.defaults();assert.equal(next.density,'compact');
 assert.ok(layout.locate(next,'globalFlowMap').item.y<layout.locate(next,'productionFocus').item.y);
 for(const key of ['pulse','deadline','collectionPreview'])assert.ok(layout.locate(next,key));
 const old={version:2,known:layout.widgets,pages:[{items:[{key:'globalFlowMap',x:0,y:16,w:8,h:9}]}]};
 const restored=layout.normalize(old);
 assert.equal(restored.density,'comfortable');assert.equal(layout.locate(restored,'globalFlowMap').item.y,16);
 assert.equal(layout.normalize(next).density,'compact');
});
