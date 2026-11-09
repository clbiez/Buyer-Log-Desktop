'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseJsonBufferAsync}=require('../server/lib/large-json');
const yieldControl=()=>new Promise(resolve=>setImmediate(resolve));
test('cooperative snapshot parsing keeps native JSON values, own keys and Unicode across large nested boundaries',async()=>{
 const text='{"__proto__":{"polluted":true},"dup":1,"items":'+JSON.stringify(Array.from({length:30000},(_,i)=>({id:i,text:'Türkçe \\" \\n {}[] 💙',values:[null,false,0,-1.25,{},[]]})))+',"dup":2}';
 let yields=0;const actual=await parseJsonBufferAsync(Buffer.from(text),{yieldControl:async()=>{yields++;await yieldControl();}});
 assert.deepEqual(actual,JSON.parse(text));assert.equal(Object.getPrototypeOf(actual),Object.prototype);assert.equal({}.polluted,undefined);assert.ok(yields>0);
 assert.deepEqual(await parseJsonBufferAsync(Buffer.concat([Buffer.from([239,187,191]),Buffer.from(text)]),{yieldControl}),actual);
 await assert.rejects(parseJsonBufferAsync(Buffer.from(text),{yieldControl:async()=>{throw Object.assign(Error('replaced'),{code:'COMPUTE_STALE_GENERATION'});}}),{code:'COMPUTE_STALE_GENERATION'});
});
test('cooperative parser rejects malformed containers and trailing data like the native parser',async()=>{
 const prefix='{"large":'+JSON.stringify(Array(70000).fill(0))+',';
 for(const text of [prefix+'}',prefix+'"x":[1,]}',prefix+'"x":1} trailing',prefix+'"x":"unterminated}',prefix+'"x":tru}',prefix+'"x":{]}']){
  assert.throws(()=>JSON.parse(text),SyntaxError);await assert.rejects(parseJsonBufferAsync(Buffer.from(text),{yieldControl}),SyntaxError);
 }
});
