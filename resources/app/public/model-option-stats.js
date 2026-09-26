(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLModelOptionStats=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const MODEL_FIELDS=['modelKod','Model Name','modelName','model','styleName','modelCode'];
  const PLM_FIELDS=['plmId','PLM ID','plm','plmID'];
  const STYLE_FIELDS=['styleId','Style ID','styleCode','Style Code'];
  const text=value=>String(value==null?'':value).trim().replace(/\s+/g,' ');
  // Aynı model/renk metni binlerce satırda tekrarlanır; tr-TR büyük harf
  // dönüşümü sınırlı önbellekle bir kez yapılır.
  const KEY_TEXT_CACHE_MAX=20000,keyTextCache=new Map();
  const keyText=value=>{
    const raw=value==null?'':value;
    if(typeof raw!=='string'&&typeof raw!=='number')return text(raw).toLocaleUpperCase('tr-TR');
    let key=keyTextCache.get(raw);
    if(key===undefined){
      if(keyTextCache.size>=KEY_TEXT_CACHE_MAX)keyTextCache.clear();
      key=text(raw).toLocaleUpperCase('tr-TR');keyTextCache.set(raw,key);
    }
    return key;
  };
  const first=(row,fields)=>{for(const field of fields){const value=text(row?.[field]);if(value)return value;}return '';};
  const stableId=(row)=>first(row,['id','_id','rowId']);

  function modelKey(row,index=0){
    const plm=keyText(first(row,PLM_FIELDS)),model=keyText(first(row,MODEL_FIELDS)),style=keyText(first(row,STYLE_FIELDS));
    if(plm&&model)return `plm:${plm}|model:${model}`;
    if(plm)return `plm:${plm}`;
    if(style&&model)return `style:${style}|model:${model}`;
    if(style)return `style:${style}`;
    if(model)return `model:${model}`;
    const id=keyText(stableId(row));
    return id?`row:${id}`:`unknown-row:${index}`;
  }

  function optionKey(row,index=0){
    const explicit=keyText(first(row,['optionKey','optionId','optionCode','colourCode','colour','Colour','colorCode','color','Color','C.Code','Colour Code']));
    const model=modelKey(row,index);
    return explicit?`${model}|option:${explicit}`:`row:${keyText(stableId(row))||index}`;
  }

  function getModelOptionStats(rows,options={}){
    const list=Array.isArray(rows)?rows:[];
    const modelFor=typeof options.modelKey==='function'?options.modelKey:modelKey;
    const optionFor=typeof options.optionKey==='function'?options.optionKey:optionKey;
    const models=new Set(),optionsSeen=new Set();
    list.forEach((row,index)=>{
      const model=keyText(modelFor(row,index));if(model)models.add(model);
      if(options.optionMode==='unique'){
        const option=keyText(optionFor(row,index));if(option)optionsSeen.add(option);
      }
    });
    return {rowCount:list.length,modelCount:models.size,optionCount:options.optionMode==='unique'?optionsSeen.size:list.length};
  }

  return {modelKey,optionKey,getModelOptionStats,normalize:text};
});
