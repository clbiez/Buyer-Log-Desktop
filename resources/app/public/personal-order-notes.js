(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLPersonalNoteColumns=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  // Kişisel notlar hiçbir zaman overrides/notesmap veya paylaşılan CP store'a yazılmaz.
  // Mevcut BLStorage, kullanıcı kapsamını ve hesapla /api/user-preferences eşitlemesini sağlar.
  const KEY='lcw.personalOrderNotes.definitions.v1';
  const VALUE_PREFIX='lcw.personalOrderNotes.value.v1.';
  const MAX_COLUMNS=24, MAX_TEXT=4000;
  const validId=id=>/^personal_note_[a-z0-9_-]{3,60}$/.test(String(id||''));
  const cleanText=value=>String(value==null?'':value).slice(0,MAX_TEXT);
  const cleanName=value=>String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,80);
  function normalizeDefinitions(source){
    const seen=new Set(),out=[];
    for(const raw of Array.isArray(source)?source:[]){
      if(!raw||!validId(raw.id)||seen.has(raw.id))continue;
      const labelTr=cleanName(raw.labelTr||raw.label),labelEn=cleanName(raw.labelEn||raw.label);
      if(!labelTr&&!labelEn)continue;
      seen.add(raw.id);out.push({id:String(raw.id),label:labelTr||labelEn,labelTr:labelTr||labelEn,labelEn:labelEn||labelTr});
      if(out.length===MAX_COLUMNS)break;
    }
    return out;
  }
  function create(storage){
    const store=()=>storage||(root&&root.BLStorage)||null;
    function readRaw(key){try{return store()?.getItem(key)??null;}catch(_){return null;}}
    function definitions(){
      try{return normalizeDefinitions(JSON.parse(readRaw(KEY)||'[]'));}catch(_){return [];}
    }
    function setDefinitions(next){
      if(!Array.isArray(next)||next.length>MAX_COLUMNS)throw new Error('PERSONAL_NOTE_COLUMN_LIMIT');
      const safe=normalizeDefinitions(next);
      if(safe.length!==next.length)throw new Error('PERSONAL_NOTE_INVALID_COLUMNS');
      const target=store();
      if(!target||typeof target.setItem!=='function')throw new Error('PERSONAL_NOTE_STORAGE_UNAVAILABLE');
      target.setItem(KEY,JSON.stringify(safe));
      return safe;
    }
    function valueKey(id,lineKey){
      if(!validId(id)||!/^\d{1,20}\|/.test(String(lineKey||''))||String(lineKey).length>600)return '';
      return VALUE_PREFIX+id+'.'+encodeURIComponent(String(lineKey));
    }
    function readValue(id,lineKey){
      const key=valueKey(id,lineKey);
      return key?cleanText(readRaw(key)):'';
    }
    function writeValue(id,lineKey,value){
      const key=valueKey(id,lineKey);
      if(!key||!definitions().some(def=>def.id===id))throw new Error('PERSONAL_NOTE_INVALID_TARGET');
      const target=store();
      if(!target||typeof target.setItem!=='function')throw new Error('PERSONAL_NOTE_STORAGE_UNAVAILABLE');
      // Boş değer dahi kayıt edilir: senkron edilmiş eski not geri gelmesin.
      const next=cleanText(value);
      target.setItem(key,next);
      return next;
    }
    function removeDefinition(id){
      if(!validId(id))return false;
      const current=definitions();
      if(!current.some(def=>def.id===id))return false;
      setDefinitions(current.filter(def=>def.id!==id));
      // Yalnız bu kullanıcının BLStorage namespace'ini temizle.
      const s=store(),prefix=VALUE_PREFIX+id+'.',actual=s?.actualKey?.(prefix)||prefix;
      if(s?.native&&typeof s.removeItem==='function'){
        const keys=[];
        for(let i=0;i<s.native.length;i++){
          const key=s.native.key(i);
          if(key&&key.startsWith(actual))keys.push(prefix+key.slice(actual.length));
        }
        keys.forEach(key=>s.removeItem(key));
      }
      return true;
    }
    return {definitions,setDefinitions,readValue,writeValue,removeDefinition,valueKey,normalizeDefinitions,MAX_TEXT,MAX_COLUMNS};
  }
  return Object.assign(create(null),{create});
});