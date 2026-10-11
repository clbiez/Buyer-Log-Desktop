'use strict';
const {object,string,array}=require('./agent-capability-contract');
const {hash,error}=require('./agent-office-store');
const {applyResolvedFilters,SUPPORTED_OPERATORS}=require('./agent-tool-registry');
const Delivery=require('../../public/backlog-delivery-engine');
const filters=array({...object({field:string(160),operator:{enum:SUPPORTED_OPERATORS},value:{}}),required:['field','operator']},50);
const analysis=object({filters,dimensions:array(string(160),5),measures:array({...object({op:{enum:['count','sum','avg','min','max','distinctCount']},field:string(160),as:{type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]{0,63}$'}}),required:['op']},8),orderBy:array({...object({field:string(160),direction:{enum:['asc','desc']}}),required:['field','direction']},4),limit:{type:'integer',minimum:1,maximum:500}});
const delivery=object({filters,asOf:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}});
const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reportData(report,title){
  const rows=report.rows||report.topRiskOrders||[],keys=[...new Set(rows.flatMap(row=>Object.keys(row).filter(key=>row[key]==null||['number','string','boolean'].includes(typeof row[key]))))];
  if(report.truncated||rows.length>5000||keys.length>40)throw error('OFFICE_REPORT_LIMIT',422);
  const tableRows=rows.map(row=>keys.map(key=>row[key]==null?'':row[key]));
  const summary=Object.entries({...report,rows:undefined,topRiskOrders:undefined}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v]);
  return {workbook:{title,sheets:[{name:'Summary',columns:['Metric','Value'],rows:summary},...(keys.length?[{name:'Report',columns:keys.map(key=>({header:key,type:tableRows.some(row=>typeof row[keys.indexOf(key)]==='number')?'number':'text'})),rows:tableRows}]:[])]},html:{body:`<h1>${escape(title)}</h1><p>${escape(JSON.stringify({...report,rows:undefined,topRiskOrders:undefined}))}</p><table><thead><tr>${keys.map(k=>`<th>${escape(k)}</th>`).join('')}</tr></thead><tbody>${tableRows.map(row=>`<tr>${row.map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}};
}
function registerReportCapability(registry,spec,outputService){
  const querySchema=spec.inputSchema,inputSchema={...object({query:querySchema,format:{enum:['html','xlsx','pdf']},title:string(140),language:{enum:['tr','en']}}),required:['query','format','title','language']};
  registry.registerCapability({...spec,operation:'EXPORT',risk:'write',inputSchema,
    read:async(args,ctx)=>{const data=await spec.read(args.query,ctx);reportData(data.report,args.title);return data;},
    apply:async(args,ctx,preview)=>{const current=await spec.read(args.query,ctx);ctx.assertAuthority();if(JSON.stringify(current)!==JSON.stringify(preview))throw error('OFFICE_PREVIEW_CHANGED',409);
      const requestId=hash(ctx.input.officeJobId+':'+ctx.input.officeStepId),data=reportData(preview.report,args.title),output=outputService().renderStructured(ctx.ownerId,{format:args.format,data:args.format==='xlsx'?data.workbook:data.html,title:args.title,lang:args.language,requestId});
      if(output.pending)return {verified:true,completionPending:'pdf',output:{pendingId:output.pendingId,format:'pdf',requestId}};
      if(!outputService().get(ctx.ownerId,output.id))throw error('OFFICE_OUTPUT_INVALID',409);
      return {verified:true,output:{id:output.id,fileName:output.fileName,format:output.format,bytes:output.bytes,requestId}};
    }});
}
function registerAnalyticsTools(registry,deps){
  const {dataset,outputService}=deps;
  async function read(source,mode,args,ctx){
    const sourceRows=await dataset(ctx.ownerId,ctx.profile,source),sourceFingerprint=hash(JSON.stringify(sourceRows));ctx.assertAuthority();
    if(mode==='delivery'){
      const asOf=args.asOf||new Date().toISOString().slice(0,10);if(!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf)throw error('OFFICE_TASK_INVALID',422);
      const rows=applyResolvedFilters(source,sourceRows,args.filters,ctx.now),report=Delivery.analyze(rows,{today:Delivery.defaultOrdinal(asOf)});
      delete report.orders;if(report.context)delete report.context.generatedAt;
      return {sourceFingerprint,report:{source,asOf,matchedRows:rows.length,...report}};
    }
    const report=await registry.execute('dataset.analyze',{...args,source},{ownerId:ctx.ownerId,profile:ctx.profile,now:ctx.now});ctx.assertAuthority();
    if(hash(JSON.stringify(await dataset(ctx.ownerId,ctx.profile,source)))!==sourceFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);ctx.assertAuthority();
    return {sourceFingerprint,report};
  }
  for(const source of ['cp','orders','backlog','lfl','collection']){
    const base={module:source==='collection'?'koleksiyon':source,areas:[source==='collection'?'koleksiyon':source],agentAreas:[source]};
    registry.registerCapability({...base,id:source+'.fields',operation:'READ',risk:'read',label:{tr:source+' alanlarını keşfet',en:'Discover '+source+' fields'},inputSchema:object({}),read:async(_args,ctx)=>registry.execute('dataset.describe',{source},{ownerId:ctx.ownerId,profile:ctx.profile})});
    registry.registerCapability({...base,id:source+'.analyze',operation:'READ',risk:'read',label:{tr:source+' filtre / grup / ölçü analizi',en:source+' filter / group / measure analysis'},inputSchema:analysis,read:async(args,ctx)=>(await read(source,'analysis',args,ctx)).report});
    for(const mode of source==='backlog'?['analysis','delivery']:['analysis']){
      if(mode==='delivery')registry.registerCapability({...base,id:'backlog.delivery',operation:'READ',risk:'read',label:{tr:'Backlog gecikme ve risk raporu',en:'Backlog delay and risk report'},inputSchema:delivery,read:async(args,ctx)=>(await read(source,mode,args,ctx)).report});
      if(!outputService)continue;
      registerReportCapability(registry,{...base,id:source+'.'+mode+'.export',label:{tr:source+' '+mode+' raporunu dışa aktar',en:'Export '+source+' '+mode+' report'},inputSchema:mode==='delivery'?delivery:analysis,read:(args,ctx)=>read(source,mode,args,ctx)},outputService);
    }
  }
}
module.exports={registerAnalyticsTools,registerReportCapability,analysis,delivery,reportData};
