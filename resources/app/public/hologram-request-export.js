(function(root,factory){
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.BLHologramRequest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const fields=()=>root.BLCanonicalFields||(typeof require==='function'?require('./canonical-fields.js'):null);
  const capacity=()=>root.BLCapacityRequest||(typeof require==='function'?require('./capacity-request-export.js'):null);
  // The external workbook's column names are a file contract, not UI labels.
  const HEADERS=['TARİH','LİSANS','MMYG','BUYER GRUP','KATEGORİ','TALEP EDEN KİŞİ',' TALEP EDİLEN ADET','SİPARİŞ KODU','MODEL ADI','ÖZEL KOD','SİPARİŞ TERMİN TARİHİ']; // i18n-ignore
  const ORDER=['today','license','mmyg','buyingGroup','productMainDefinition','buyer','hologramQuantity','orderCode','modelName','specialCode','exFactory'];
  function quantity(value){
    const n=capacity().toNumber(value);
    if(n===null||!Number.isSafeInteger(n)||n<=0)throw new Error('INVALID_ORDER_QUANTITY');
    // Integer arithmetic avoids floating-point overshoot at exact multiples.
    return Math.ceil(n*3/5000)*50;
  }
  function buildExport(rows,options){
    const today=capacity().startOfDay(options&&options.today),api=fields();
    return {today,rows:rows.map(row=>{
      const out={today,hologramQuantity:quantity(api.value(row,'cp','orderQuantity'))};
      ORDER.filter(id=>id!=='today'&&id!=='hologramQuantity').forEach(id=>{out[id]=api.value(row,'cp',id)||'';});
      out.exFactory=capacity().toDate(out.exFactory)||'';
      return out;
    })};
  }
  function template(){return {sheetName:'Hologram Talep',headerRow:4,dataRow:5,columns:HEADERS.map((header,i)=>({header,column:i+1,field:ORDER[i]}))};}
  function fileName(date){return capacity().fileName(date).replace('Capacity Request','Hologram Request');}
  return {HEADERS,ORDER,quantity,buildExport,template,fileName};
});
