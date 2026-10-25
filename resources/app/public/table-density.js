(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.BLTableDensity=api.createController({storage:root.BLStorage,onChange:(tableKey,value)=>root.dispatchEvent(new CustomEvent('buyerlog:table-density-change',{detail:{tableKey,value}}))});}})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const TABLES=Object.freeze(['cp','orders','koleksiyon']),MODES=Object.freeze(['default','compact','standard','comfortable']),KEY='lcw.table.density.v1.';
 const normalize=value=>MODES.includes(value)?value:'default';
 function createController({storage=null,onChange=()=>{}}={}){
  const values=new Map();let fontAdd=0;
  function get(tableKey){if(!TABLES.includes(tableKey))return 'default';if(!values.has(tableKey)){let value;try{value=storage?.getItem(KEY+tableKey);}catch(_){}values.set(tableKey,normalize(value));}return values.get(tableKey);}
  function set(tableKey,value,{persist=true}={}){if(!TABLES.includes(tableKey))return 'default';const mode=normalize(value);values.set(tableKey,mode);if(persist)try{if(mode==='default')storage?.removeItem(KEY+tableKey);else storage?.setItem(KEY+tableKey,mode);}catch(_){}onChange(tableKey,mode);return mode;}
  function dimensions(tableKey,base){const mode=get(tableKey);if(mode==='default')return base;const padding=mode==='compact'?1:mode==='comfortable'?7:3,extra=mode==='compact'?-4:mode==='comfortable'?8:0;return {...base,row:Math.ceil(Math.max(base.h+2*padding,base.row+extra,(12.5+fontAdd)*2.4+2*padding))};}
  function setTextScale(scale){fontAdd=({compact:-1,standard:0,large:1.5,xl:3})[scale]??0;}
  function mount(host,tableKey,language='tr'){
   if(!host||!TABLES.includes(tableKey))return;let control=host.querySelector('[data-density-control]');
   if(!control){control=document.createElement('label');control.className='tableDensityControl';control.dataset.densityControl='';const caption=document.createElement('span'),select=document.createElement('select');select.dataset.tableDensity=tableKey;control.append(caption,select);host.appendChild(control);select.onchange=()=>set(tableKey,select.value);}
   const en=language==='en',select=control.querySelector('select'),caption=control.querySelector('span');caption.textContent=en?'Rows':'Satırlar';select.setAttribute('aria-label',en?'Table row density':'Tablo satır sıklığı');select.title=en?'Row spacing changes independently from interface text size. Images retain their selected size.':'Satır aralığı arayüz yazı boyutundan bağımsızdır. Görseller seçilen boyutunu korur.';
   const labels=en?['Default','Compact','Standard','Comfortable']:['Varsayılan','Sık','Standart','Rahat'];select.replaceChildren(...MODES.map((mode,i)=>{const option=document.createElement('option');option.value=mode;option.textContent=labels[i];return option;}));select.value=get(tableKey);
  }
  return {get,set,dimensions,setTextScale,mount,normalize};
 }
 return {createController,normalize,TABLES,MODES,KEY};
});
