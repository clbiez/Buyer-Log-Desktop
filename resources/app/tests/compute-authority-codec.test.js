'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {encodeAuthority,decodeAuthority}=require('../server/lib/compute-authority-codec');
test('incremental authority encoding preserves exact JSON, special keys, Date values and shared row identity',async()=>{
 const shared={buyer:'Synthetic',date:new Date('2026-11-05T00:00:00Z'),optional:undefined};
 const value={10:[shared,null,undefined],2:[],long:Array.from({length:900},()=>shared),invalid:null};
 Object.defineProperty(value,'__proto__',{value:[shared],enumerable:true});let yields=0;
 const encoded=await encodeAuthority(value,{yieldControl:async()=>{yields++;await new Promise(setImmediate);}}),actual=decodeAuthority(encoded.bytes);
 assert.equal(JSON.stringify(actual),JSON.stringify(value));assert.equal(actual.long.length,900);assert.ok(yields>=4);
 assert.equal(actual['10'][0],actual.long[899]);assert.equal(actual.__proto__[0],actual['10'][0]);
 assert.ok(actual['10'][0].date instanceof Date);assert.equal(Object.getPrototypeOf(actual),Object.prototype);
 assert.equal(encoded.paramsChunks,yields);assert.ok(encoded.maxSerializeSliceMs<=encoded.paramsSerializeMs);
});
test('empty authority has an exact empty digest input and obsolete preparation stops at the first handoff',async()=>{
 assert.deepEqual(decodeAuthority((await encodeAuthority({})).bytes),{});
 let current=true,yields=0;const failure=Object.assign(Error('Synthetic obsolete generation'),{code:'COMPUTE_STALE_GENERATION'});
 await assert.rejects(encodeAuthority({1:Array.from({length:900},()=>({buyer:'Synthetic'}))},{assertCurrent:()=>{if(!current)throw failure;},yieldControl:async()=>{yields++;current=false;}}),error=>error===failure);
 assert.equal(yields,1);
});
