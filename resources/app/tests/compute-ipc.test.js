'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),v8=require('node:v8'),threads=require('node:worker_threads');
const {takeEncodedBuffer,serializeForTransfer}=require('../server/lib/compute-ipc');
test('owned V8 encodings retain exact values and transfer without touching caller buffers',()=>{
 const value={bytes:Buffer.alloc(10000,7),when:new Date('2026-11-05T00:00:00Z')},encoded=v8.serialize(value),buffer=takeEncodedBuffer(encoded);
 if(typeof threads.isMarkedAsUntransferable==='function')assert.equal(buffer,encoded.buffer);
 else assert.notEqual(buffer,encoded.buffer);
 const transferred=structuredClone(buffer,{transfer:[buffer]});assert.equal(buffer.byteLength,0);
 assert.deepEqual(v8.deserialize(Buffer.from(transferred)),value);assert.equal(value.bytes.length,10000);assert.equal(value.bytes[0],7);
 assert.deepEqual(v8.deserialize(Buffer.from(serializeForTransfer(value))),value);
});
test('sliced and explicitly non-transferable encodings copy only their visible bytes',()=>{
 const storage=Buffer.allocUnsafeSlow(64).fill(19),slice=storage.subarray(9,25),first=takeEncodedBuffer(slice);
 assert.equal(first.byteLength,16);assert.deepEqual(Buffer.from(first),slice);structuredClone(first,{transfer:[first]});assert.equal(storage.length,64);
 const marked=Buffer.allocUnsafeSlow(32).fill(27);threads.markAsUntransferable(marked.buffer);const second=takeEncodedBuffer(marked);
 assert.notEqual(second,marked.buffer);assert.deepEqual(Buffer.from(second),marked);structuredClone(second,{transfer:[second]});assert.equal(marked.byteLength,32);
});
test('shared encodings and runtimes without a transferability query preserve the copying fallback',()=>{
 const shared=Buffer.from(new SharedArrayBuffer(16)).fill(5),copy=takeEncodedBuffer(shared);assert.ok(copy instanceof ArrayBuffer);assert.deepEqual(Buffer.from(copy),shared);
 const original=threads.isMarkedAsUntransferable,encoded=v8.serialize({synthetic:true});
 try{threads.isMarkedAsUntransferable=undefined;const fallback=takeEncodedBuffer(encoded);assert.notEqual(fallback,encoded.buffer);assert.deepEqual(v8.deserialize(Buffer.from(fallback)),{synthetic:true});}
 finally{threads.isMarkedAsUntransferable=original;}
});
