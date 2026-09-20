(function(global){
  'use strict';

  // Küçük yerel önbellek yalnız aktif kullanıcının profil listesini ve tablo
  // kapsamındaki seçimleri tutar. Ağ/shared sync açılış yoluna girmez.
  var VERSION=2, PREFIX='buyerlog.presetCache.v2.';
  var memory=new Map();
  function text(value){return value==null?'':String(value).trim();}
  function userId(){return text(global.BL_USER_CONTEXT&&global.BL_USER_CONTEXT.id)||'anonymous';}
  function pageOf(item){
    var raw=item&&typeof item==='object'?item:{},data=raw.data&&typeof raw.data==='object'?raw.data:{};
    return text(raw.tableId||raw.moduleId||raw.page||data.__page||data.page);
  }
  function key(kind,page){return PREFIX+text(kind)+'.'+encodeURIComponent(text(page));}
  function storageKey(name){
    try{
      if(global.BLStorage&&global.BLStorage.actualKey&&global.BLStorage.native)return global.BLStorage.actualKey(name);
      return name;
    }catch(_){return name;}
  }
  function nativeGet(name){try{return global.localStorage.getItem(storageKey(name));}catch(_){return null;}}
  function nativeSet(name,value){try{global.localStorage.setItem(storageKey(name),value);}catch(_){}}
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function memoryKey(kind,page){return userId()+'|'+key(kind,page);}
  function time(item){var value=Date.parse(String(item&& (item.updatedAt||item.createdAt)||''));return isFinite(value)?value:0;}
  function recent(items){return items.slice().sort(function(a,b){return time(b)-time(a)||text(b.id).localeCompare(text(a.id));})[0]||null;}
  function itemsFor(store,page){var wanted=text(page);return (store&&Array.isArray(store.items)?store.items:[]).filter(function(item){return pageOf(item)===wanted;});}
  function normalizeItem(item){
    var raw=item&&typeof item==='object'?clone(item):{},data=raw.data&&typeof raw.data==='object'?raw.data:{};
    var page=pageOf(raw);if(page&&!data.__page)data.__page=page;
    return Object.assign(raw,{id:text(raw.id),name:text(raw.name)||text(raw.id),userId:userId(),moduleId:text(raw.moduleId)||page||null,tableId:text(raw.tableId)||page||null,schemaVersion:VERSION,data:data});
  }
  function normalize(kind,raw){
    var source=raw&&typeof raw==='object'?raw:{},items=(Array.isArray(source.items)?source.items:[]).filter(function(item){return text(item&&item.page||item&&item.data&&(item.data.page||item.data.__page))!=='appr';}).map(normalizeItem),byId=new Map(items.map(function(item){return [item.id,item];}));
    var hasFavoriteMap=Boolean(source.favoriteByPage&&typeof source.favoriteByPage==='object');
    var favorites=hasFavoriteMap?Object.assign({},source.favoriteByPage):{};
    var used=source.lastUsedByPage&&typeof source.lastUsedByPage==='object'?Object.assign({},source.lastUsedByPage):{};
    var legacy=text(source.favoriteId),pages=[];
    items.forEach(function(item){var page=pageOf(item);if(page&&pages.indexOf(page)<0)pages.push(page);});
    pages.forEach(function(page){
      var list=itemsFor({items:items},page),configured=text(favorites[page]),legacyItem=byId.get(legacy),flagged=list.find(function(item){return item.isDefault||item.isFavorite;}),chosen=(configured&&list.some(function(item){return item.id===configured;})&&configured)||(legacyItem&&pageOf(legacyItem)===page?legacy:'')||(flagged&&flagged.id)||(!hasFavoriteMap&&recent(list)&&recent(list).id);
      if(chosen)favorites[page]=chosen;
      if(used[page]&&!list.some(function(item){return item.id===used[page];}))delete used[page];
    });
    items.forEach(function(item){var selected=Boolean(favorites[pageOf(item)]===item.id);item.isFavorite=selected;item.isDefault=selected;});
    return {schemaVersion:VERSION,kind:text(kind)||text(source.kind)||'profile',userId:text(source.userId)||userId(),favoriteByPage:favorites,lastUsedByPage:used,favoriteId:pages.map(function(page){return favorites[page];}).find(Boolean)||null,items:items,_revision:Number(source._revision)||0,_updatedAt:source._updatedAt||null};
  }
  function read(kind,page){
    var cacheKey=key(kind,page),memKey=memoryKey(kind,page),value=memory.get(memKey);
    if(value)return clone(value);
    var raw=nativeGet(cacheKey);if(raw==null)return null;
    try{
      var parsed=normalize(kind,JSON.parse(raw));
      if(parsed.userId!==userId())return null;
      memory.set(memKey,parsed);return clone(parsed);
    }catch(_){return null;}
  }
  function write(kind,page,store){
    var normalized=normalize(kind,store),cacheKey=key(kind,page),memKey=memoryKey(kind,page);
    normalized.userId=userId();
    memory.set(memKey,normalized);nativeSet(cacheKey,JSON.stringify(normalized));return clone(normalized);
  }
  function favoriteId(store,page){
    var normalized=normalize(store&&store.kind||'profile',store),list=itemsFor(normalized,page),configured=text(normalized.favoriteByPage[text(page)]);
    if(configured&&list.some(function(item){return item.id===configured;}))return configured;
    var flagged=list.find(function(item){return item.isDefault||item.isFavorite;});
    if(flagged)return flagged.id;
    var last=text(normalized.lastUsedByPage[text(page)]);if(last&&list.some(function(item){return item.id===last;}))return last;
    return null;
  }
  function setFavorite(kind,page,store,id){
    var normalized=normalize(kind,store),wanted=text(id),item=normalized.items.find(function(candidate){return candidate.id===wanted&&pageOf(candidate)===text(page);});
    if(!item)return normalized;
    normalized.favoriteByPage=Object.assign({},normalized.favoriteByPage);normalized.favoriteByPage[text(page)]=wanted;
    normalized.items.forEach(function(candidate){if(pageOf(candidate)===text(page)){var selected=candidate.id===wanted;candidate.isFavorite=selected;candidate.isDefault=selected;}});
    return write(kind,page,normalized);
  }
  function markUsed(kind,page,store,id){
    var normalized=normalize(kind,store),wanted=text(id),item=normalized.items.find(function(candidate){return candidate.id===wanted&&pageOf(candidate)===text(page);});
    if(!item)return normalized;
    normalized.lastUsedByPage=Object.assign({},normalized.lastUsedByPage);normalized.lastUsedByPage[text(page)]=wanted;return write(kind,page,normalized);
  }
  global.BLPresetStore={
    VERSION:VERSION,key:key,normalize:normalize,read:read,write:write,pageItems:itemsFor,
    favoriteId:favoriteId,setFavorite:setFavorite,markUsed:markUsed,
  };
})(window);
