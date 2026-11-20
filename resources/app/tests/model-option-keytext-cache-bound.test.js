'use strict';
// #1079 (a): keyText önbelleği CP/Siparişler/Koleksiyon arasında paylaşılır. CP'nin tek
// geçişi ~20–27k ham metin üretir; 20.000 sınırında önbellek tamamen boşalıyor ve
// Koleksiyon özetinin model metinlerini düşürüyordu. Sınır 65.536: 30k benzersiz metin
// sıcak kalır, sınır aşıldığında önbellek yine boşalır (bellek sınırlı) ve sonuçlar değişmez.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const MODULE=path.join(__dirname,'..','public','model-option-stats.js');
const LIMIT=65536;

function freshStats(){delete require.cache[require.resolve(MODULE)];return require(MODULE);}
function countUpperCalls(fn){
  const original=String.prototype.toLocaleUpperCase;let calls=0;
  String.prototype.toLocaleUpperCase=function(...args){calls++;return original.apply(this,args);};
  try{fn();}finally{String.prototype.toLocaleUpperCase=original;}
  return calls;
}
const reference=value=>String(value).trim().replace(/\s+/g,' ').toLocaleUpperCase('tr-TR');
// modelKey yalnız model alanıyla `model:<keyText>` döndürür; keyText'i doğrudan gözlemler.
const modelOf=value=>({modelKod:value});

test('30k distinct model texts stay cached across passes (no clear below 65,536)',()=>{
  const stats=freshStats(),values=Array.from({length:30000},(_,i)=>`ışıklı model ${i}`);
  countUpperCalls(()=>values.forEach(v=>stats.modelKey(modelOf(v))));
  const second=countUpperCalls(()=>values.forEach(v=>stats.modelKey(modelOf(v))));
  assert.equal(second,0,`second pass must be fully cached (${second} misses)`);
});

test('cache stays bounded: one entry past the limit clears it, results unchanged',()=>{
  const stats=freshStats();
  // modelKey boş PLM/stil alanları için keyText('') de çağırır; '' bir önbellek girdisidir.
  stats.modelKey({});
  const values=Array.from({length:LIMIT-1},(_,i)=>`istanbul renk ${i}`);
  const firstFill=countUpperCalls(()=>values.forEach(v=>stats.modelKey(modelOf(v))));
  assert.equal(firstFill,LIMIT-1);
  assert.equal(countUpperCalls(()=>stats.modelKey(modelOf(values[0]))),0,'full cache still serves hits');
  // Dolu önbellekte yeni metin önbelleği boşaltır: yeni metin + ardından gelen '' yeniden hesaplanır.
  assert.equal(countUpperCalls(()=>stats.modelKey(modelOf('yeni ılık metin'))),2);
  assert.equal(countUpperCalls(()=>stats.modelKey(modelOf(values[0]))),1,'cache must clear at the limit');
  for(const v of [values[0],values[LIMIT-2],'yeni ılık metin','  çift   boşluk  '])
    assert.equal(stats.modelKey(modelOf(v)),`model:${reference(v)}`);
});

test('keys and counts are identical before and after the cache overflows',()=>{
  const stats=freshStats();
  const rows=Array.from({length:500},(_,i)=>({'PLM ID':`p${i%40}`,'Model Name':`ılık model ${i%40}`,'C.Code':`ç${i%7}`}));
  const before={stats:stats.getModelOptionStats(rows,{optionMode:'unique'}),keys:rows.map((r,i)=>stats.optionKey(r,i))};
  for(let i=0;i<LIMIT+10;i++)stats.modelKey(modelOf(`dolgu ${i}`));
  const after={stats:stats.getModelOptionStats(rows,{optionMode:'unique'}),keys:rows.map((r,i)=>stats.optionKey(r,i))};
  assert.deepEqual(after,before);
  assert.equal(before.stats.modelCount,40);
  assert.equal(before.keys[1],'plm:P1|model:ILIK MODEL 1|colour:Ç1');
});
