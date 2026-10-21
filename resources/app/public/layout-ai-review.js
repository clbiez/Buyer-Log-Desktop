'use strict';
(function(root,factory){const api=factory(root?root.BLLayoutControlEngine:require('./layout-control-engine'));if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BLLayoutAIReview=api;})(typeof window!=='undefined'?window:null,function(E){
  const list=v=>Array.isArray(v)?v:[],clean=v=>String(v==null?'':v).trim(),unique=v=>[...new Set(v.filter(Boolean))];
  const identity=v=>E.fold(v).replace(/^KK[.,\s]*BDY[.,\s]*/, '').replace(/[^A-Z0-9]/g,'');
  const FIELDS=['orderCode','modelName','specialCode','colourCode','colour','country','line','mag','mmyg','season','productDescription','productMainDefinition','category','fabricComposition','cashRetailPrice','productGroup','buyingGroup'];
  function projectRows(rows){return list(rows).map(row=>Object.fromEntries(FIELDS.map(id=>[id,E.cpValue(row,id)]).filter(([,v])=>v!=null&&clean(v)!=='')));}
  function linkOrders(extraction,cpRows){
    const ex=extraction||{},all=list(cpRows).filter(row=>clean(E.cpValue(row,'orderCode'))),requested=unique(list(ex.orderNumbers).map(clean)),models=list(ex.modelCodes).map(identity),specials=list(ex.specialCodes).map(identity),colours=list(ex.colourCodes).map(identity);
    let rows=[];
    if(requested.length)rows=all.filter(row=>requested.some(v=>identity(v)===identity(E.cpValue(row,'orderCode'))));
    else {
      rows=all.filter(row=>models.includes(identity(E.cpValue(row,'modelName')))||specials.some(v=>v.replace(/Z[148]$/,'')===identity(E.cpValue(row,'specialCode')).replace(/Z[148]$/,'')));
      if(colours.length){const narrowed=rows.filter(row=>colours.includes(identity(E.cpValue(row,'colourCode'))));if(narrowed.length)rows=narrowed;}
    }
    const orderCodes=unique(rows.map(row=>clean(E.cpValue(row,'orderCode')))),unmatchedOrderCodes=requested.filter(v=>!orderCodes.some(code=>identity(code)===identity(v)));
    return {referenceRows:rows,reference:{status:!rows.length?'NONE':unmatchedOrderCodes.length?'PARTIAL':orderCodes.length>1?(requested.length?'MULTIPLE':'AMBIGUOUS'):'MATCH',orderCodes,requestedOrderCodes:requested,unmatchedOrderCodes}};
  }
  function report(result,context={},language='tr'){
    const batches=list(result&&result.batches),totalPages=Number(result&&result.totalPages)||0,read=new Set(),seen=new Set(),checks=[],summaries=[];let invalid=false;
    for(const batch of batches){
      const data=batch.data||{},pages=list(batch.pages),findings=list(data.findings);let valid=0;
      if(clean(data.summary))summaries.push(clean(data.summary));
      for(const line of findings){
        let f;try{f=typeof line==='string'?JSON.parse(line):line;}catch(_){invalid=true;continue;}
        if(!f||!['CARE_LABEL','INNER_BARCODE','PRICE_TAG','DOCUMENT'].includes(f.section)||!['MATCH','ERROR','REVIEW','NOT_VISIBLE','NOT_APPLICABLE'].includes(f.verdict)||typeof f.title!=='string'||!clean(f.title)||typeof f.comment!=='string'||!clean(f.comment)||['actual','expected','correction','orderCode'].some(key=>f[key]!=null&&typeof f[key]!=='string')){invalid=true;continue;}
        const duplicate=JSON.stringify([f.section,f.field,f.title,f.orderCode,f.page,f.verdict,f.actual,f.expected,f.comment,f.correction]);
        if(seen.has(duplicate)){valid++;continue;}seen.add(duplicate);
        if(checks.length>=239){invalid=true;continue;}
        const page=Number(f.page),position=Number.isInteger(page)&&pages.includes(page)&&page>=1&&page<=totalPages? page:null,b=f.bbox;
        const box=position&&Array.isArray(b)&&b.length===4&&b.every(n=>typeof n==='number'&&Number.isFinite(n))&&b[0]>=0&&b[1]>=0&&b[2]>0&&b[3]>0&&b[0]+b[2]<=1.001&&b[1]+b[3]<=1.001?b:null;
        const status={MATCH:'MATCH',ERROR:'MISMATCH',REVIEW:'REVIEW',NOT_VISIBLE:'REVIEW',NOT_APPLICABLE:'NOT_CHECKED'}[f.verdict];
        checks.push({rule:'AI_'+checks.length,category:'AI_REVIEW',source:'LCW AI',title:clean(f.title).slice(0,180),field:clean(f.field).slice(0,80),section:f.section,orderCode:clean(f.orderCode).slice(0,80),status,assessmentStatus:status,expected:clean(f.expected)?[clean(f.expected).slice(0,1200)]:[],actual:clean(f.actual)?[clean(f.actual).slice(0,1200)]:[],detail:clean(f.comment).slice(0,1200),correction:clean(f.correction).slice(0,1200),aiVerdict:f.verdict,severity:['CRITICAL','ERROR','COMMENT'].includes(f.severity)?f.severity:'COMMENT',page:position,bbox:box,standardType:['CARE_LABEL','PRICE_TAG'].includes(f.standardType)?f.standardType:'UNKNOWN',standardPage:Number.isInteger(f.standardPage)&&f.standardPage>=1&&f.standardPage<= (f.standardType==='PRICE_TAG'?28:18)?f.standardPage:0,decision:'PENDING',comment:''});valid++;
      }
      if(valid&&clean(data.summary))list(data.inspectedPages).map(Number).filter(n=>pages.includes(n)).forEach(n=>read.add(n));
    }
    const failedPages=Array.from({length:totalPages},(_,i)=>i+1).filter(n=>!read.has(n));
    if(invalid||failedPages.length||result&&result.error||!checks.length)checks.push({rule:'LCW_REVIEW_INCOMPLETE',category:'READING',source:'Buyer Log',status:'REVIEW',expected:[],actual:failedPages.map(String),detail:language==='en'?'LCW AI review was not received in full. Retry before approving.':'LCW AI incelemesi eksiksiz alınamadı. Onaydan önce yeniden deneyin.'});
    const types=unique(batches.map(b=>b.data&&b.data.documentType).filter(t=>['CARE_LABEL','INNER_BARCODE','PRICE_TAG','MIXED'].includes(t)));
    return {mode:'LCW_AI',documentType:types.length===1?types[0]:types.length?'MIXED':'UNKNOWN',extraction:context.extraction||{},referenceRows:context.referenceRows||[],reference:context.reference||{status:'NONE',orderCodes:[]},checks,aiSummary:unique(summaries).join('\n\n'),reading:{totalPages,readPages:[...read],failedPages},summary:E.summarize(checks)};
  }
  return {projectRows,linkOrders,report};
});
