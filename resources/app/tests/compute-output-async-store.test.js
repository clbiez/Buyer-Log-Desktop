'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createOutputStore}=require('../server/lib/lcwai-output/output-store');
test('async Office save keeps collision/owner/metadata rules and removes only its rejected new file',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-async-output-store-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=createOutputStore({root:path.join(root,'files'),now:()=>new Date('2026-11-05T12:00:00Z')}),input={buffer:Buffer.from('PK Synthetic Office'),format:'xlsx',title:'Synthetic'};
 const first=store.save('a',input),second=await store.saveAsync('a',input);
 assert.notEqual(first.fileName,second.fileName);assert.equal(store.get('b',second.id),null);assert.deepEqual(fs.readFileSync(second.path),input.buffer);assert.equal(store.list('a').length,2);
 const before=fs.readdirSync(store.root()).sort();let calls=0;
 await assert.rejects(store.saveAsync('a',input,{assertCurrent:()=>{if(++calls===2)throw Error('Synthetic revoked');}}),/Synthetic revoked/);
 assert.deepEqual(fs.readdirSync(store.root()).sort(),before);assert.equal(store.list('a').length,2);
});
