'use strict';
/* PLM assets already stored in Buyer Log, for Office (no CoreNectum call):
   - collection.plm.bom.read: the normalized BOM/artwork summary saved by PLM Sync
     (same store as /api/plm-sync/bom/*), summary fields only;
   - collection.plm.techsheet.status: whether a technical sheet is on file per PLM
     ID (same ownership resolver as /api/plm-sync/model-files/status), computed on
     a copy so a read never migrates the file index.
   Downloading or refreshing assets from PLM stays in the user's PLM Sync flow. */
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store');
const plmIds={...array({...string(80),minLength:1},200),minItems:1,uniqueItems:true};
const text=(value,max)=>String(value==null?'':value).slice(0,max);
const bom=object({plmId:string(80),styleId:string(80),isSetStyle:{type:'boolean'},fetchedAt:{type:['string','null'],maxLength:80},sourceModifiedDate:{type:['string','null'],maxLength:80},
  fabric:string(2000),summary:string(4000),fabricSummary:string(4000),artworkSummary:string(4000),hasPrint:{type:'boolean'},totalPrintCount:{type:'integer',minimum:0},
  placementSummary:string(2000),techniqueSummary:string(2000),componentCount:{type:'integer',minimum:0},setComponentCount:{type:'integer',minimum:0},needsAi:{type:'boolean'},fullCoverage:string(40)});
const bomOutput={...object({verified:{enum:[true]},data:{...object({entries:array(bom,200),missing:array(string(80),200),revision:{type:'integer',minimum:0},updatedAt:{type:['string','null'],maxLength:80}}),required:['entries','missing']}}),required:['verified','data']};
const status=object({plmId:string(80),status:{enum:['ready','conflict','stale','missing']},hasTechnicalSheet:{type:'boolean'},languages:array(string(8),10),conflictCode:string(60)});
const statusOutput={...object({verified:{enum:[true]},data:{...object({items:array(status,200)}),required:['items']}}),required:['verified','data']};
function registerPlmAssetTools(registry,deps){
  registry.registerCapability({id:'collection.plm.bom.read',module:'koleksiyon',operation:'READ',risk:'read',areas:[],anyAreas:['koleksiyon','cp','orders'],agentAnyAreas:['collection','cp','orders'],
    label:{tr:'Kayıtlı PLM BOM özetini oku',en:'Read stored PLM BOM summary'},
    dataScope:'BOM/artwork summaries already saved by PLM Sync; no PLM request',
    inputSchema:{...object({plmIds}),required:['plmIds']},outputSchema:bomOutput,dryRunOutputSchema:bomOutput,
    read:async(args,ctx)=>{ctx.assertAuthority?.();
      const store=deps.bomStore.load(),entries=[],missing=[];
      for(const raw of args.plmIds){const id=deps.normalizePlmId(raw);const entry=id&&store.models&&store.models[id];if(!entry){missing.push(text(raw,80));continue;}
        entries.push({plmId:entry.plmId,styleId:entry.styleId,isSetStyle:Boolean(entry.isSetStyle),fetchedAt:entry.fetchedAt||null,sourceModifiedDate:entry.sourceModifiedDate||null,
          fabric:text(entry.fabric,2000),summary:text(entry.summary,4000),fabricSummary:text(entry.fabricSummary,4000),artworkSummary:text(entry.artworkSummary,4000),hasPrint:Boolean(entry.hasPrint),
          totalPrintCount:Number(entry.totalPrintCount)||0,placementSummary:text(entry.placementSummary,2000),techniqueSummary:text(entry.techniqueSummary,2000),
          componentCount:(entry.components||[]).length,setComponentCount:(entry.setComponents||[]).length,needsAi:Boolean(entry.needsAi),fullCoverage:text(entry.fullCoverage,40)});}
      return {entries,missing,revision:Number(store._revision)||0,updatedAt:store._updatedAt||null};}});
  registry.registerCapability({id:'collection.plm.techsheet.status',module:'koleksiyon',operation:'READ',risk:'read',areas:['koleksiyon'],agentAreas:['collection'],
    label:{tr:'PLM teknik föy durumunu oku',en:'Read PLM technical sheet status'},
    dataScope:'technical sheet metadata in the model files index; no PLM request and no index migration',
    inputSchema:{...object({plmIds}),required:['plmIds']},outputSchema:statusOutput,dryRunOutputSchema:statusOutput,
    read:async(args,ctx)=>{ctx.assertAuthority?.();
      const index=JSON.parse(JSON.stringify(deps.readModelFilesIndex()||[]));
      const {statusByPlmId}=deps.ownership.resolveTechnicalSheetOwnership(index,args.plmIds,{fileExists:deps.fileExists});
      return {items:Object.entries(statusByPlmId).map(([plmId,s])=>({plmId,status:s.status,hasTechnicalSheet:Boolean(s.hasTechnicalSheet),languages:(s.languages||[]).map(String),conflictCode:s.conflict?String(s.conflict.code||''):''}))};}});
}
module.exports={registerPlmAssetTools};
