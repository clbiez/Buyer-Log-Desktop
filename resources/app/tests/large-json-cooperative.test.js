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
test('toplu çözümleme: çok sayıda küçük üye, batch sınırını aşan yinelenen anahtarlar ve iç __proto__ JSON.parse ile aynı',async()=>{
 const members=[];for(let i=0;i<40000;i++)members.push(JSON.stringify('k'+i)+':'+JSON.stringify({i,t:'Türkçe 💙 \\" '+'x'.repeat(i%50)}));
 members.splice(5,0,'"dup":1');members.push('"dup":{"late":true}');members.splice(20000,0,'"__proto__":{"polluted":true}');
 const text='{"outer":{'+members.join(',')+'},"list":['+Array.from({length:50000},(_,i)=>i%7?JSON.stringify({i}):'[]').join(',')+'],"empty":{},"tail":[]}';
 const actual=await parseJsonBufferAsync(Buffer.from(text),{yieldControl});
 assert.deepEqual(actual,JSON.parse(text));assert.deepEqual(Object.keys(actual.outer),Object.keys(JSON.parse(text).outer));
 assert.equal(Object.getPrototypeOf(actual.outer),Object.prototype);assert.equal({}.polluted,undefined);assert.deepEqual(actual.outer.dup,{late:true});
});
