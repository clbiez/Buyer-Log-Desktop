(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOrderLinePeerIndex=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create(keyOf){
    if(typeof keyOf!=='function')throw new TypeError('A canonical row key function is required');
    let owner=null,byRows=new WeakMap();
    function selectOwner(value){const next=String(value??'');if(next!==owner){owner=next;byRows=new WeakMap();}}
    function add(cache,row,key){
      cache.keys.set(row,key);if(!key)return;
      let bucket=cache.byKey.get(key);if(!bucket){bucket=new Set();cache.byKey.set(key,bucket);}bucket.add(row);
    }
    function update(cache,row,key){
      const before=cache.keys.get(row);if(before===key)return;
      const bucket=cache.byKey.get(before);if(bucket){bucket.delete(row);if(!bucket.size)cache.byKey.delete(before);}
      add(cache,row,key);
    }
    function current(rows){
      let cache=byRows.get(rows);
      if(!cache||cache.length!==rows.length){
        cache={length:rows.length,byKey:new Map(),keys:new WeakMap()};
        for(const row of rows)if(row&&typeof row==='object')add(cache,row,keyOf(row));
        byRows.set(rows,cache);
      }
      return cache;
    }
    function peers(rows,key,ownerId=''){
      selectOwner(ownerId);if(!Array.isArray(rows)||!key)return [];
      const cache=current(rows),bucket=cache.byKey.get(key);if(!bucket)return [];
      const result=[];
      // Yalnız adayları doğrula. Atlanan bir kimlik bildirimi, eski anahtar
      // üzerinden farklı bir satırın değiştirilmesine izin vermemeli.
      for(const row of [...bucket]){const actual=keyOf(row);update(cache,row,actual);if(actual===key)result.push(row);}
      return result;
    }
    function updateIdentity(rows,row,ownerId=''){
      selectOwner(ownerId);const cache=byRows.get(rows);if(!cache||!cache.keys.has(row))return false;
      update(cache,row,keyOf(row));return true;
    }
    // Kaynak dizinin değişmesi WeakMap anahtarıyla kendiliğinden algılanır.
    // Aynı uzunluktaki yerinde üye değişiminde invalidate; mevcut satırın
    // kanonik alanları değiştiğinde updateIdentity çağrılmalı.
    function invalidate(rows){if(rows)byRows.delete(rows);else byRows=new WeakMap();}
    return Object.freeze({peers,updateIdentity,invalidate});
  }
  return Object.freeze({create});
});
