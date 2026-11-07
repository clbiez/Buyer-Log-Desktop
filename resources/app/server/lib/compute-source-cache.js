'use strict';
// Worker içi salt okunur snapshot kopyaları. bytes, güvenilir servis tarafından
// dosya boyutlarından ayrılan bellek tahminidir; fiziksel heap ölçümü değildir.
function sourceError(code){
  const values={COMPUTE_SOURCE_OWNER_MISMATCH:['Kaynak sahibi uyuşmuyor.','Source owner mismatch.',403],COMPUTE_SOURCE_INVALID:['Geçersiz kaynak tanımı.','Invalid source descriptor.',400],
    COMPUTE_SOURCE_TOO_LARGE:['Kaynak bellek bütçesine sığmıyor.','Source exceeds the memory budget.',413],COMPUTE_SOURCE_BUSY:['Kaynak önbelleği kullanımda.','Source cache is busy.',503],
    COMPUTE_STALE_GENERATION:['Kaynak sürümü değişti.','Source generation changed.',409]};
  const [tr,en,statusCode]=values[code];return Object.assign(Error(`${tr} / ${en}`),{code,statusCode,errorEn:en});
}
function createComputeSourceCache({maxBytes=2*1024*1024*1024,loadSnapshot}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid source cache byte limit');
  const load=loadSnapshot||((owner)=>require('./model-snapshot').loadModelSnapshotAsync(owner));
  const entries=new Map(),held=new Set(),loading=new Map(),epochs=new Map();
  let reservedBytes=0,sequence=0,loads=0,hits=0,evictions=0;
  function drop(entry){
    if(entries.get(entry.key)===entry)entries.delete(entry.key);
    entry.retired=true;
    if(entry.pins===0&&held.delete(entry)){reservedBytes-=entry.bytes;entry.snapshot=null;}
  }
  function capacity(bytes){
    while(reservedBytes+bytes>maxBytes){
      const victim=[...held].filter(entry=>entry.pins===0).sort((a,b)=>a.used-b.used)[0];
      if(!victim)throw sourceError('COMPUTE_SOURCE_BUSY');drop(victim);evictions++;
    }
  }
  function identity(snapshot,descriptor){
    if(descriptor.loadedAt!=null&&String(snapshot.loadedAt||snapshot.savedAt||'')!==String(descriptor.loadedAt))throw sourceError('COMPUTE_STALE_GENERATION');
  }
  function unpin(entry){entry.pins--;if(entry.pins===0&&entry.retired)drop(entry);}
  function lease(entry,alreadyPinned=false){
    if(!entry)return {snapshot:null,release(){}};
    if(!alreadyPinned)entry.pins++;
    entry.used=++sequence;let released=false;
    return {snapshot:entry.snapshot,release(){if(released)return;released=true;unpin(entry);}};
  }
  async function acquire(descriptor,requestOwner){
    if(!descriptor||typeof descriptor!=='object'||!descriptor.ownerId||String(descriptor.ownerId)!==String(requestOwner))throw sourceError('COMPUTE_SOURCE_OWNER_MISMATCH');
    const owner=String(descriptor.ownerId),generation=String(descriptor.generation||''),bytes=descriptor.bytes;
    if(!generation||!Number.isSafeInteger(bytes)||bytes<1)throw sourceError('COMPUTE_SOURCE_INVALID');
    if(bytes>maxBytes)throw sourceError('COMPUTE_SOURCE_TOO_LARGE');
    const key=JSON.stringify([owner,generation]),existing=entries.get(key);
    if(existing){identity(existing.snapshot,descriptor);hits++;return lease(existing);}
    let record=loading.get(key);
    if(!record){
      capacity(bytes);reservedBytes+=bytes;
      record={owner,epoch:epochs.get(owner)||0,waiters:0};loading.set(key,record);
      record.promise=Promise.resolve().then(async()=>{
        let retained=false;
        try{
          loads++;const snapshot=await load(owner,descriptor);
          if(record.epoch!==(epochs.get(owner)||0))throw sourceError('COMPUTE_STALE_GENERATION');
          if(snapshot==null)return null;
          identity(snapshot,descriptor);
          // Bekleyen alıcılar, Promise çözülmeden pin alır: başka bir yükleme
          // bu veriyi ilk await devamı çalışmadan LRU'dan çıkaramaz.
          const entry={key,owner,generation,bytes,snapshot,pins:record.waiters,used:++sequence,retired:false};
          entries.set(key,entry);held.add(entry);retained=true;return entry;
        }finally{if(!retained)reservedBytes-=bytes;if(loading.get(key)===record)loading.delete(key);}
      });
    }else hits++;
    record.waiters++;
    const entry=await record.promise;
    if(!entry)return lease(null);
    try{if(entry.retired||record.epoch!==(epochs.get(owner)||0))throw sourceError('COMPUTE_STALE_GENERATION');identity(entry.snapshot,descriptor);}
    catch(error){unpin(entry);throw error;}
    return lease(entry,true);
  }
  function invalidate(owner){
    owner=String(owner);epochs.set(owner,(epochs.get(owner)||0)+1);
    for(const entry of held)if(entry.owner===owner)drop(entry);
  }
  function clear(){for(const owner of new Set([...held].map(entry=>entry.owner).concat([...loading.values()].map(record=>record.owner))))invalidate(owner);}
  function stats(){return {maxBytes,reservedBytes,entries:entries.size,loading:loading.size,pinnedEntries:[...held].filter(entry=>entry.pins>0).length,loads,hits,evictions};}
  return {acquire,invalidate,clear,stats};
}
module.exports={createComputeSourceCache};
