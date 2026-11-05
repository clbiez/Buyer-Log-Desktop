'use strict';

// Entries are immutable projections of one user's source revision. The caller
// includes horizon, IAM, overrides, calendar and day in the key. Bound both the
// number of query variants and retained operational rows; TTL is not freshness.
function createBacklogQueryCache({maxEntries=12,maxRows=150000,ttlMs=60000,now=Date.now}={}){
  const entries=new Map();let rowCount=0;
  const remove=key=>{const entry=entries.get(key);if(entry){rowCount-=entry.weight;entries.delete(key);}};
  return {
    get(key,compute){
      const time=now();
      for(const [id,entry] of entries)if(time-entry.at>=ttlMs)remove(id);
      const hit=entries.get(key);
      if(hit){entries.delete(key);entries.set(key,hit);return hit.value;}
      const value=compute(),query=value.query || value;
      const weight=(query.filtered?.length||0)+(query.windowed?.length||0);
      if(weight>maxRows)return value;
      entries.set(key,{value,weight,at:time});rowCount+=weight;
      while(entries.size>maxEntries || rowCount>maxRows)remove(entries.keys().next().value);
      return value;
    },
    clear(){entries.clear();rowCount=0;},
  };
}
module.exports={createBacklogQueryCache};
