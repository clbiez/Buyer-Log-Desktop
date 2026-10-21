(function(root,factory){
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.BLHologramRequest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const fields=()=>root.BLCanonicalFields||(typeof require==='function'?require('./canonical-fields.js'):null);
  const capacity=()=>root.BLCapacityRequest||(typeof require==='function'?require('./capacity-request-export.js'):null);
  // The external workbook's column names are a file contract, not UI labels.
  const HEADERS=['TARİH','LİSANS','MMYG','BUYER GRUP','KATEGORİ','TALEP EDEN KİŞİ',' TALEP EDİLEN ADET','SİPARİŞ KODU','MODEL ADI','ÖZEL KOD','SİPARİŞ TERMİN TARİHİ']; // i18n-ignore
  const ORDER=['today','license','mmyg','buyingGroup','productMainDefinition','buyer','hologramQuantity','orderCode','modelName','specialCode','exFactory'];
  const DEFAULT_QUANTITY_RULE=Object.freeze({multiplier:1.03,roundTo:50});
  function normalizeQuantityRule(rule){
    const input=rule&&typeof rule==='object'?rule:{};
    const multiplier=input.multiplier===undefined?DEFAULT_QUANTITY_RULE.multiplier:Number(input.multiplier);
    const roundTo=input.roundTo===undefined?DEFAULT_QUANTITY_RULE.roundTo:Number(input.roundTo);
    // Support six decimal places without floating-point overshoot on exact boundaries.
    const scaled=Math.round(multiplier*1000000);
    if(!Number.isFinite(multiplier)||multiplier<=0||multiplier>100||
      Math.abs(multiplier*1000000-scaled)>1e-7||
      !Number.isSafeInteger(roundTo)||roundTo<1||roundTo>1000000)throw new Error('INVALID_HOLOGRAM_RULE');
    return {multiplier,roundTo};
  }
  function quantity(value,rule){
    const n=capacity().toNumber(value);
    if(n===null||!Number.isSafeInteger(n)||n<=0)throw new Error('INVALID_ORDER_QUANTITY');
    const {multiplier,roundTo}=normalizeQuantityRule(rule);
    // Use exact scaled integers for the ceiling, including very large quantities.
    const divisor=1000000n*BigInt(roundTo);
    const result=((BigInt(n)*BigInt(Math.round(multiplier*1000000))+divisor-1n)/divisor)*BigInt(roundTo);
    if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('INVALID_ORDER_QUANTITY');
    return Number(result);
  }
  function buildExport(rows,options){
    const today=capacity().startOfDay(options&&options.today),api=fields();
    return {today,rows:rows.map(row=>{
      const out={today,hologramQuantity:quantity(api.value(row,'cp','orderQuantity'),options&&options.quantityRule)};
      ORDER.filter(id=>id!=='today'&&id!=='hologramQuantity').forEach(id=>{out[id]=api.value(row,'cp',id)||'';});
      out.exFactory=capacity().toDate(out.exFactory)||'';
      return out;
    })};
  }
  function template(){return {sheetName:'Hologram Talep',headerRow:4,dataRow:5,columns:HEADERS.map((header,i)=>({header,column:i+1,field:ORDER[i]})),quantityRule:{...DEFAULT_QUANTITY_RULE}};}
  function fileName(date){return capacity().fileName(date).replace('Capacity Request','Hologram Request');}
  return {HEADERS,ORDER,DEFAULT_QUANTITY_RULE,normalizeQuantityRule,quantity,buildExport,template,fileName};
});
