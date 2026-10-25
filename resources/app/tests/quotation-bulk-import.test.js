'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-quotation-bulk-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server');
const Store=require('../server/lib/quotations-store');test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const owner={id:'owner',role:'user',displayName:'Demo'},foreign={id:'foreign',role:'user'};
const identity=line=>Object.fromEntries(['modelKey','rowId','manufacturer','plmId','modelCode','orderCode'].map(key=>[key,line[key]]));
test('supplier price batch uses the native ledger, one revision and all-or-none stale/permission validation',async()=>{
 const req=Store.createRequest(owner,{source:'collection',items:[{id:'one',modelKey:'m1',manufacturer:'A',price:'2'},{id:'two',modelKey:'m2',manufacturer:'A',price:'3'}]});
 const changes=req.items.map(item=>({lineId:item.id,baseRev:item.rev,price:'4.25',identity:identity(item)})),before=Store.loadStore();
 assert.throws(()=>Store.patchLines(foreign,req.id,changes),{code:'QUOTATION_EDIT_DENIED'});assert.deepEqual(Store.loadStore(),before);
 assert.throws(()=>Store.patchLines(owner,req.id,[changes[0],{...changes[1],baseRev:0}]),{code:'QUOTATION_BATCH_STALE'});assert.deepEqual(Store.loadStore(),before);
 const result=await Store.mutateAgent(options=>Store.patchLines(owner,req.id,changes,options));
 assert.equal(Store.loadStore()._revision,before._revision+1);assert.equal(result.outcomes.length,2);assert.ok(result.outcomes.every(item=>item.status==='accepted'));
 const current=Store.loadStore().requests.find(item=>item.id===req.id);assert.deepEqual(current.items.map(item=>item.price),['4.25','4.25']);assert.ok(current.items.every(item=>item.history.at(-1).source==='import'&&item.history.at(-1).by===owner.id));
 const accepted=Store.loadStore();assert.throws(()=>Store.patchLines(owner,req.id,changes),{code:'QUOTATION_BATCH_STALE'});assert.deepEqual(Store.loadStore(),accepted);
});
test('duplicate and invalid supplier prices do not produce any ledger events',()=>{
 const req=Store.createRequest(owner,{source:'collection',items:[{id:'x',modelKey:'m',manufacturer:'A',price:'2'}]}),item={lineId:'x',baseRev:req.items[0].rev,price:'5',identity:identity(req.items[0])},before=Store.loadStore();
 assert.throws(()=>Store.patchLines(owner,req.id,[item,item]),{code:'QUOTATION_BATCH_INVALID'});
 assert.throws(()=>Store.patchLines(owner,req.id,[{...item,price:'12invalid'}]),{code:'QUOTATION_BATCH_INVALID'});assert.deepEqual(Store.loadStore(),before);
});
test('a structural identity change with the same price revision invalidates the supplier preview',()=>{
 const req=Store.createRequest(owner,{source:'collection',items:[{id:'id-change',modelKey:'m',modelCode:'OLD',manufacturer:'A',price:'2'}]}),line=req.items[0],change={lineId:line.id,baseRev:line.rev,price:'6',identity:identity(line)};
 Store.updateRequest(owner,req.id,{...req,items:req.items.map(item=>({...item,modelCode:'NEW'}))});const before=Store.loadStore();assert.equal(before.requests.find(item=>item.id===req.id).items[0].rev,line.rev);
 assert.throws(()=>Store.patchLines(owner,req.id,[change]),{code:'QUOTATION_BATCH_STALE'});assert.deepEqual(Store.loadStore(),before);
});
