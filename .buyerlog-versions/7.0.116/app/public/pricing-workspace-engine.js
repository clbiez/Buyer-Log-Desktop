(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./model-option-stats.js'):root.BLModelOptionStats);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLPricingWorkspaceEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(modelOptionStats){
  'use strict';

  const clean=value=>String(value==null?'':value).trim();
  function price(value){
    if(value==null||value==='')return null;
    if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
    let text=clean(value).replace(/\s+/g,'').replace(/[$€£₺]/g,'');
    if(!text)return null;
    if(text.includes(',')&&text.includes('.')){
      if(text.lastIndexOf(',')>text.lastIndexOf('.')) text=text.replace(/\./g,'').replace(',','.');
      else text=text.replace(/,/g,'');
    }else if(text.includes(',')){
      const parts=text.split(',');
      text=parts.length===2&&parts[1].length<=3?`${parts[0].replace(/\./g,'')}.${parts[1]}`:text.replace(/,/g,'');
    }else if(/^\d{1,3}(?:\.\d{3})+$/.test(text)) text=text.replace(/\./g,'');
    const n=Number(text);
    return Number.isFinite(n)&&n>0?n:null;
  }
  function itemModelKey(item,index){return modelOptionStats?.modelKey?modelOptionStats.modelKey({plmId:item?.plmId,modelKod:item?.modelCode,styleId:item?.styleId,id:item?.modelKey||item?.rowId||item?.id},index):clean(item?.modelKey);}
  function modelCount(req){return new Set((req?.items||[]).map(itemModelKey).filter(Boolean)).size;}
  function manufacturerCount(req){return new Set((req?.items||[]).map(item=>clean(item?.manufacturer)).filter(Boolean)).size;}
  function requestStats(req){
    const items=(req?.items||[]).filter(Boolean);
    const live=items.filter(item=>!item.dropped);
    const valid=live.filter(item=>price(item.price)!=null);
    const approved=valid.filter(item=>item.approved===true);
    const models=new Set(live.map(itemModelKey).filter(Boolean));
    const pricedModels=new Set(valid.map(itemModelKey).filter(Boolean));
    const approvedModels=new Set(approved.map(itemModelKey).filter(Boolean));
    let workflow='in_progress';
    if(req?.status==='closed')workflow='closed';
    else if(approvedModels.size)workflow='approved';
    else if(valid.length)workflow='waiting_approval';
    else workflow='waiting_quote';
    return {
      workflow,
      lineCount:items.length,
      liveLineCount:live.length,
      validPriceCount:valid.length,
      waitingPriceCount:Math.max(0,live.length-valid.length),
      approvedPriceCount:approved.length,
      modelCount:models.size||modelCount(req),
      pricedModelCount:pricedModels.size,
      approvedModelCount:approvedModels.size,
      manufacturerCount:manufacturerCount(req),
    };
  }
  function requestMatchesFilter(req,filter){
    const stats=requestStats(req);
    if(filter==='all')return true;
    if(filter==='closed')return stats.workflow==='closed';
    if(filter==='approved')return req?.status!=='closed'&&stats.approvedPriceCount>0;
    if(filter==='waiting-approval')return req?.status!=='closed'&&stats.validPriceCount>0&&stats.approvedPriceCount===0;
    if(filter==='waiting-quote')return req?.status!=='closed'&&stats.validPriceCount===0;
    return req?.status!=='closed';
  }
  function workspaceKpis(requests,source='collection'){
    const rows=(Array.isArray(requests)?requests:[]).filter(req=>!source||req?.source===source);
    const active=rows.filter(req=>req.status!=='closed');
    const manufacturers=new Set();
    active.forEach(req=>(req.manufacturers||[]).forEach(m=>{const name=clean(m?.name);if(name)manufacturers.add(name);}));
    return {
      requests:active.length,
      allRequests:rows.length,
      manufacturers:manufacturers.size,
      waitingApproval:active.filter(req=>requestMatchesFilter(req,'waiting-approval')).length,
      approved:active.filter(req=>requestMatchesFilter(req,'approved')).length,
      waitingQuote:active.filter(req=>requestMatchesFilter(req,'waiting-quote')).length,
      closed:rows.filter(req=>req.status==='closed').length,
    };
  }
  function rowStableKeys(row){
    const keys=[];
    const id=Number(row?.id);
    if(Number.isFinite(id))keys.push(`row:${id}`);
    const code=clean(row?._sourceOrderCode||row?.orderCode||row?.['Order Code']);
    if(code)keys.push(`order:${code.toLocaleLowerCase('tr-TR')}`);
    return keys;
  }
  function lineStableKeys(item){
    const keys=[];
    const id=Number(item?.rowId);
    if(Number.isFinite(id))keys.push(`row:${id}`);
    const code=clean(item?.orderCode);
    if(code)keys.push(`order:${code.toLocaleLowerCase('tr-TR')}`);
    return keys;
  }
  function legacyRowKey(row){return `${clean(row?.plmId||row?.['PLM ID']).toLocaleLowerCase('tr-TR')}\u0000${clean(row?.modelKod||row?.modelCode||row?.['Model Name']).toLocaleLowerCase('tr-TR')}`;}
  function legacyLineKey(item){return `${clean(item?.plmId).toLocaleLowerCase('tr-TR')}\u0000${clean(item?.modelCode).toLocaleLowerCase('tr-TR')}`;}
  function lineMatchesRow(item,row){
    const rowKeys=new Set(rowStableKeys(row));
    const lineKeys=lineStableKeys(item);
    if(lineKeys.length)return lineKeys.some(key=>rowKeys.has(key));
    const legacy=legacyRowKey(row);
    return legacy!=='\u0000'&&legacy===legacyLineKey(item);
  }
  function selectionSummary(rows,requests,source='collection'){
    const selected=Array.isArray(rows)?rows.filter(Boolean):[];
    const allReq=(Array.isArray(requests)?requests:[]).filter(req=>!source||req?.source===source);
    let targetCoverage=0,waiting=0,partial=0,ready=0,approved=0,bestOpportunity=null;
    selected.forEach(row=>{
      const target=price(row?.targetPrice);
      if(target!=null)targetCoverage++;
      const lines=[];
      allReq.forEach(req=>(req.items||[]).forEach(item=>{if(!item?.dropped&&lineMatchesRow(item,row))lines.push({req,item});}));
      const valid=lines.filter(x=>price(x.item.price)!=null),hasApproved=valid.some(x=>x.item.approved===true);
      if(hasApproved)approved++;
      else if(lines.length&&!valid.length)waiting++;
      else if(valid.length){
        const manufacturers=new Set(lines.map(x=>clean(x.item.manufacturer)).filter(Boolean));
        const pricedManufacturers=new Set(valid.map(x=>clean(x.item.manufacturer)).filter(Boolean));
        if(manufacturers.size&&pricedManufacturers.size<manufacturers.size)partial++;
        else ready++;
      }
      if(target!=null&&valid.length){
        const best=Math.min(...valid.map(x=>price(x.item.price)).filter(Number.isFinite));
        const advantage=target-best;
        if(advantage>0&&(bestOpportunity==null||advantage>bestOpportunity.amount))bestOpportunity={amount:advantage,target,best,percent:(advantage/target)*100};
      }
    });
    return {selected:selected.length,targetCoverage,waiting,partial,ready,approved,bestOpportunity};
  }
  function historySummary(records){
    const valid=(Array.isArray(records)?records:[]).map(record=>({...record,_price:price(record?.price)})).filter(record=>record._price!=null);
    if(!valid.length)return {count:0,modelCount:0,optionCount:0,best:null,average:null,max:null,spreadPct:null,suppliers:0};
    const values=valid.map(record=>record._price),best=Math.min(...values),max=Math.max(...values),average=values.reduce((a,b)=>a+b,0)/values.length;
    const bestRecord=valid.find(record=>record._price===best);
    const counts=modelOptionStats?.getModelOptionStats?.(valid,{modelKey:(record,index)=>modelOptionStats.modelKey({plmId:record?.plmId,modelKod:record?.modelCode||record?.model},index),optionMode:'unique',optionKey:record=>record?.identityKey||record?.id||record?.itemId});
    return {count:valid.length,modelCount:counts?.modelCount||new Set(valid.map(record=>clean(record?.modelKey||record?.model)).filter(Boolean)).size,optionCount:counts?.optionCount||valid.length,best,bestManufacturer:clean(bestRecord?.manufacturer),average,max,spreadPct:best>0?((max-best)/best)*100:null,suppliers:new Set(valid.map(record=>clean(record?.manufacturer)).filter(Boolean)).size};
  }
  return {price,modelCount,manufacturerCount,requestStats,requestMatchesFilter,workspaceKpis,lineMatchesRow,selectionSummary,historySummary};
});
