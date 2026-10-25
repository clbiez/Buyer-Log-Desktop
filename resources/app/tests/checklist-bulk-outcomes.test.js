'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-checklist-bulk-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server');
const Store=require('../server/lib/checklist-supplier-store');test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('checklist batch reports accepted and rejected canonical items without replacing newer answers',async()=>{
 const actor={id:'demo',displayName:'Demo'},base={orderKey:'order',state:'approved',at:'2026-10-25T10:00:00.000Z'};
 const initial=await Store.applyEntries([{...base,itemId:'first'}],actor);
 await assert.rejects(Store.applyEntries([{...base,itemId:'second'}],actor,{expectedRevision:initial.revision-1}),{code:'CHECKLIST_REVISION_CONFLICT'});
 const result=await Store.applyEntries([{...base,itemId:'first',state:'open',baseAt:'2026-10-24T10:00:00.000Z'},{...base,itemId:'second',baseAt:'2026-10-24T10:00:00.000Z'}],actor,{expectedRevision:initial.revision,source:'supplier_excel'});
 assert.equal(result.updated,1);assert.equal(result.conflicts,1);assert.deepEqual(result.outcomes,[{key:'order::first',status:'rejected',code:'NEWER_ANSWER'},{key:'order::second',status:'accepted'}]);
 const current=await Store._readAsync();assert.equal(current.answers['order::first'].state,'approved');assert.equal(current.answers['order::second'].state,'approved');
});
