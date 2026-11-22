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
test('büyük üyeden sonra gelen sondaki/boş virgül native parser gibi reddedilir (toplu çözümlemede boş üye yok)',async()=>{
 const big=JSON.stringify('x'.repeat(70000));
 for(const text of ['['+big+',]','{"a":['+big+',],"b":1}','['+big+',,1]','{"a":'+big+',}']){
  assert.throws(()=>JSON.parse(text),SyntaxError);await assert.rejects(parseJsonBufferAsync(Buffer.from(text),{yieldControl}),SyntaxError,text.slice(-10));
 }
});
/* Hızlı yol sözleşmesi: dizgiler native indexOf ile atlanır, büyük kapsayıcının
   sonu ayrıştırılarak bulunur (alt ağaç iki kez taranmaz) ve satır dizileri `},{`
   kesimiyle tahmini native toplu çözülür. Tahmin yanlış yerde kesse de (dizgi
   içinde, iç içe listede, dizinin bittiği yerin ötesinde) sonuç JSON.parse ile
   birebir aynı kalmalı ve bozuk veri yine SyntaxError vermelidir. */
test('hızlı yol: tuzaklı `},{` dizgileri, kaçışlı tırnaklar, iç içe nesne listeleri ve dizi sonu ötesi kesimler JSON.parse ile aynı',async()=>{
 const trap=i=>['},{','"},{"','\\"},{\\"','\\\\','\\\\\\"},{','x\\u0022},{','Türkçe 💙 },{ [}]'][i%7];
 const rows=Array.from({length:24000},(_,i)=>({id:i,t:trap(i),n:i%5?{list:[{a:i},{b:trap(i+1)}],w:'},{'.repeat(i%4)}:{deep:[[{x:1},{y:2}],[]]},tail:'\\'.repeat(i%3)}));
 const big='y'.repeat(90000);
 const text=JSON.stringify({head:1,rows,mid:{many:rows.slice(0,3000),long:big},list2:[big,{z:big},rows.slice(0,2000)],after:rows.slice(0,5000),last:'},{'});
 assert.ok(text.length>3*1024*1024,'birden çok toplu çözme kesimi');
 assert.deepEqual(await parseJsonBufferAsync(Buffer.from(text),{yieldControl}),JSON.parse(text));
 const pretty=JSON.stringify({rows:rows.slice(0,8000)},null,1); // boşluklu biçimde kesim deseni yok: kesin tarama
 assert.deepEqual(await parseJsonBufferAsync(Buffer.from(pretty),{yieldControl}),JSON.parse(pretty));
});
test('hızlı yol: toplu çözme kesiminin içinde kalan bozuk veri ve büyük kapsayıcıdan sonraki fazlalık native parser gibi reddedilir',async()=>{
 const rows=JSON.stringify(Array.from({length:30000},(_,i)=>({id:i,t:'satır '+i})));
 const broken=[
  rows.slice(0,700000)+'"oops":}'+rows.slice(700000+8), // ~1 MB toplu çözme bölgesinde bozuk üye
  rows.slice(0,-1)+',]',                                 // büyük dizi sonunda boş üye
  '{"a":'+rows+'} {"b":1}',                              // büyük kapsayıcıdan sonra fazlalık
  '{"a":'+rows+',"b":'+rows.slice(0,-1)+'}',             // iç büyük dizi kapanmadan nesne kapanır
  '{"a":'+rows+',"b":"kapanmayan',                       // kapanmayan dizgi
 ];
 for(const text of broken){
  assert.throws(()=>JSON.parse(text),SyntaxError);
  await assert.rejects(parseJsonBufferAsync(Buffer.from(text),{yieldControl}),SyntaxError,text.slice(-24));
 }
});
test('hızlı yol: olay döngüsüne dönüş sıklığı korunur (tek blok yok)',async()=>{
 const text=JSON.stringify({rows:Array.from({length:120000},(_,i)=>({id:i,a:'x'.repeat(i%40),b:[i,{c:'},{'}]})),map:Object.fromEntries(Array.from({length:40000},(_,i)=>['k'+i,{v:i}]))});
 let last=performance.now(),max=0;
 await parseJsonBufferAsync(Buffer.from(text),{yieldControl:async()=>{const now=performance.now();max=Math.max(max,now-last);await yieldControl();last=performance.now();}});
 assert.ok(max<150,`en uzun kesintisiz dilim ${Math.round(max)} ms`);
});
