/* Read-only report projection. Canonical bindings own field identity; source
   columns remain intact for filtering, search, PLM and Excel export. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLDetailReportLayout=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const INTERNAL={model:'modelName',modelKod:'modelName',classification:'category',rowType:'rowType',period:'period',priority:'priority',currency:'currency',price:'price',amount:'amount',quantity:'orderQuantity'};
  const ROLES={
    identity:['orderCode','modelName','plmId','colourCode','colour','specialCode'],
    buyer:['buyer','buyingGroup','category','mag','mmyg','productGroup','line'],
    supplier:['manufacturer','subManufacturer','country','season','deliveryType'],
    context:['source','partial','shipmentFile','containerNo','vesselName','routeProgress','transitDays'],
    status:['orderStatus','status','priority','rowType','period','plmSampleStatus'],
  };
  function fieldId(col,moduleId,canonical){
    return col.canonicalId||canonical?.canonicalId?.(moduleId,col.key)||INTERNAL[col.key]||col.key;
  }
  function roleOf(col,moduleId,canonical){
    const id=fieldId(col,moduleId,canonical);
    for(const [role,ids] of Object.entries(ROLES))if(ids.includes(id))return role;
    return 'field';
  }
  function focusKeys(columns,moduleId,canonical,preferred){
    const wanted=new Set(preferred||[]),extras=[],dates=[],metrics=[],out=[];
    for(const col of columns){
      const id=fieldId(col,moduleId,canonical),def=canonical?.field?.(id);
      if(roleOf(col,moduleId,canonical)!=='field'||id==='currency')out.push(col.key);
      else if(def?.type==='date'||col.type==='date'||col.type==='datetime')dates.push(col.key);
      else if(def?.role==='measure'||['price','amount','orderQuantity','shipmentQuantity','collectionQuantity','remainingUnits'].includes(id))metrics.push(col.key);
      else extras.push(col.key);
    }
    const prioritize=keys=>keys.filter(key=>wanted.has(key)).concat(keys.filter(key=>!wanted.has(key)));
    return [...new Set(out.concat(prioritize(dates).slice(0,3),prioritize(metrics).slice(0,3),prioritize(extras).slice(0,3)))];
  }
  function project(columns,moduleId,canonical,labels){
    const groups=new Map(),singles=[];
    for(const col of columns){
      const role=roleOf(col,moduleId,canonical);
      if(role==='field'){singles.push(col);continue;}
      if(!groups.has(role))groups.set(role,[]);
      groups.get(role).push(col);
    }
    const out=[];
    for(const role of ['status','identity','buyer','supplier','context']){
      const fields=groups.get(role);if(!fields)continue;
      const ids=ROLES[role];
      fields.sort((a,b)=>ids.indexOf(fieldId(a,moduleId,canonical))-ids.indexOf(fieldId(b,moduleId,canonical)));
      out.push({key:'__report_'+role,label:labels[role],fields,reportRole:role,widthPx:role==='identity'?260:role==='status'?145:220});
    }
    const currency=singles.find(col=>fieldId(col,moduleId,canonical)==='currency');
    const price=singles.find(col=>['price','fob'].includes(fieldId(col,moduleId,canonical)));
    for(const col of singles){
      if(col===currency&&price)continue;
      const def=canonical?.field?.(fieldId(col,moduleId,canonical));
      out.push({...col,key:'__report_field_'+col.key,fields:col===price&&currency?[col,currency]:[col],reportRole:def?.type==='number'||['price','amount','orderQuantity'].includes(fieldId(col,moduleId,canonical))?'number':'field',widthPx:def?.type==='date'?110:120});
    }
    return out;
  }
  return {fieldId,roleOf,focusKeys,project};
});
