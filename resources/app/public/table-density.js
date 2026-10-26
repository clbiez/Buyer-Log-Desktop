(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.BLTableDensity=api.createController({storage:root.BLStorage,onChange:(tableKey,value)=>root.dispatchEvent(new CustomEvent('buyerlog:table-density-change',{detail:{tableKey,value}}))});}})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 // Table row density is a product-wide Compact setting, not a user preference.
 // Stored legacy values and density values from saved views must not override it.
 const TABLES=Object.freeze(['cp','orders','koleksiyon']),MODES=Object.freeze(['compact']),KEY='lcw.table.density.v1.';
 const normalize=()=> 'compact';
 function createController({onChange=()=>{}}={}){
  let fontAdd=0;
  function get(tableKey){return TABLES.includes(tableKey)?'compact':'default';}
  function set(tableKey){if(!TABLES.includes(tableKey))return 'default';onChange(tableKey,'compact');return 'compact';}
  function dimensions(tableKey,base){if(!TABLES.includes(tableKey))return base;return {...base,row:Math.ceil(Math.max(base.h+2,base.row-4,(12.5+fontAdd)*2.4+2))};}
  function setTextScale(scale){fontAdd=({compact:-1,standard:0,large:1.5,xl:3})[scale]??0;}
  function mount(host,tableKey){if(!host||!TABLES.includes(tableKey))return;host.querySelector('[data-density-control]')?.remove?.();}
  return {get,set,dimensions,setTextScale,mount,normalize};
 }
 return {createController,normalize,TABLES,MODES,KEY};
});
