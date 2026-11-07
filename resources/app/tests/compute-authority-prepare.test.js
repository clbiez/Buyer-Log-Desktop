'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const access=require('../server/lib/compute-access');
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('authority preparation shares one promise, yields by rows, redacts before worker handoff and preserves exact context hashes',async()=>{
 const rows=Array.from({length:1100},(_,i)=>({buyer:'Demo '+i,merch:'M',ageGroup:'A',buyerGrup:'G',password:'SYNTHETIC_PRIVATE'}));
 const original={101:rows},input={userId:'a',systemRole:'buyer',viewScope:{buyers:['Demo']},editScopes:{buyers:['Demo']},profiles:[]};
 const expected=access.createAccessContext({...input,authority:structuredClone(original)});let yields=0,hashes=0;
 const options={batchSize:32,yieldControl:async()=>{yields++;await new Promise(setImmediate);},hashAuthority:async authority=>{hashes++;assert.doesNotMatch(JSON.stringify(authority),/SYNTHETIC_PRIVATE|password/);return sha(authority);}};
 const pending=access.prepareAuthority(original,options);assert.equal(access.prepareAuthority(original,options),pending);
 assert.throws(()=>access.createAccessContext({...input,authority:original}),{code:'COMPUTE_ACCESS_NOT_READY'});
 await pending;assert.ok(yields>=Math.floor(rows.length/32));assert.equal(hashes,1);assert.deepEqual(access.createAccessContext({...input,authority:original}),expected);
 await access.prepareAuthority(original,options);assert.equal(hashes,1);assert.equal(original[101][0].password,'SYNTHETIC_PRIVATE');
});
test('failed preparation can retry and never publishes a half-built authority snapshot',async()=>{
 const original={101:[{buyer:'Demo'}]},input={userId:'a',authority:original};
 await assert.rejects(access.prepareAuthority(original,{hashAuthority:async()=>{throw Error('Synthetic worker failure');}}),/Synthetic worker failure/);
 await access.prepareAuthority(original,{hashAuthority:async value=>sha(value)});assert.equal(access.createAccessContext(input).authorityHash,sha({101:[{buyer:'Demo'}]}));
});

test('obsolete authority preparation stops before hashing and cannot publish its partial directory',async()=>{
 const original={101:Array.from({length:80},()=>({buyer:'Demo'}))};let current=true,hashes=0;
 await assert.rejects(access.prepareAuthority(original,{batchSize:8,isCurrent:()=>current,yieldControl:async()=>{current=false;},hashAuthority:async value=>{hashes++;return sha(value);}}),{code:'COMPUTE_STALE_GENERATION'});
 assert.equal(hashes,0);current=true;await access.prepareAuthority(original,{hashAuthority:async value=>sha(value)});
 assert.equal(access.createAccessContext({userId:'a',authority:original}).authority['101'].length,80);
});
