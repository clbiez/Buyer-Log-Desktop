'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const layout=require('../public/detail-report-layout');
const canonical=require('../public/canonical-fields');
const labels={identity:'Order / Model',buyer:'Buyer / Group',supplier:'Manufacturer / Season',status:'Status / Portfolio'};
const cols=keys=>keys.map(key=>({key,label:key}));
test('CP raw fields project into Backlog identities without losing source columns',()=>{
 const input=cols(['Order Code','Model Name','C.Code','Colour','Buyer','Buying Group','Manufacturer','Country','Season','Order Quantity','FOB']);
 const before=JSON.stringify(input),report=layout.project(input,'cp',canonical,labels);
 assert.deepEqual(report.find(c=>c.reportRole==='identity').fields.map(c=>c.key),['Order Code','Model Name','C.Code','Colour']);
 assert.deepEqual(report.find(c=>c.reportRole==='supplier').fields.map(c=>c.key),['Manufacturer','Country','Season']);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(new Set(report.flatMap(c=>c.fields.map(c=>c.key))),new Set(input.map(c=>c.key)));
 assert.ok(report.length<input.length);
});
test('LFL retains period distinction, monetary metrics and dates in the focused report',()=>{
 const input=cols(['period','rowType','orderCode','modelName','classification','manufacturer','country','season','buyer','quantity','fob','amount','exFactory','inStore']);
 const focus=layout.focusKeys(input,'lfl',canonical),report=layout.project(input,'lfl',canonical,labels);
 for(const key of ['period','rowType','quantity','fob','amount','exFactory','inStore'])assert.ok(focus.includes(key),key);
 assert.deepEqual(report.find(c=>c.reportRole==='status').fields.map(c=>c.key),['rowType','period']);
});
test('price and currency are stacked together without merging monetary values',()=>{
 const report=layout.project(cols(['model','manufacturer','price','currency','quantity']),'collection',canonical,labels);
 assert.deepEqual(report.find(c=>c.fields.some(f=>f.key==='price')).fields.map(f=>f.key),['price','currency']);
 assert.equal(report.flatMap(c=>c.fields).filter(f=>f.key==='currency').length,1);
});
test('arbitrary OAB fields preserve selected metrics and remain available in the catalog',()=>{
 const input=cols(['customA','customB','customC','customD','clickedMetric','otherMetric']);
 const keys=layout.focusKeys(input,'overview',canonical,['clickedMetric']);
 assert.ok(keys.includes('clickedMetric'));
 assert.equal(keys.length,3);
 const report=layout.project(input,'overview',canonical,labels);
 assert.deepEqual(report.flatMap(c=>c.fields.map(f=>f.key)),input.map(c=>c.key));
});
test('a large CP catalog cannot reintroduce 100 columns into the default report',()=>{
 const input=cols(['Order Code','Model Name','Buyer','Manufacturer','Order Quantity','FOB',...Array.from({length:100},(_,i)=>'custom_'+i)]);
 const keys=layout.focusKeys(input,'cp',canonical),report=layout.project(input.filter(c=>keys.includes(c.key)),'cp',canonical,labels);
 assert.ok(report.length<=9);
 assert.ok(keys.includes('Order Quantity'));
});
test('empty source columns are supported',()=>assert.deepEqual(layout.project([],'cp',canonical,labels),[]));

test('shipment context groups operational fields without discarding individual filters',()=>{
 const input=cols(['orderCode','source','partial','shipmentFile','containerNo','vesselName','routeProgress','transitDays']);
 const report=layout.project(input,'overview',canonical,{...labels,context:'Shipment / Route'});
 assert.deepEqual(report.find(c=>c.reportRole==='context').fields.map(c=>c.key),input.slice(1).map(c=>c.key));
});
