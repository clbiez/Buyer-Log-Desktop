'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');
const pins=require('./source-pins.json'),app=path.resolve(__dirname,'../../..');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
for(const [relative,pin] of Object.entries(pins.actualSources))assert.equal(sha(fs.readFileSync(path.join(app,relative))),pin.sha256,'actual7f8 source '+relative);
const actualRequire=Module.createRequire(path.join(app,'server/lib/compute-tasks.js'));
const modelRefresh=actualRequire('./model-refresh'),modelScopes=actualRequire('./model-scopes'),tasks=actualRequire('./compute-tasks');
const {moduleSchemaParams}=require('../../../server/lib/compute-module-schema-policy');
const clone=value=>JSON.parse(JSON.stringify(value));
function definition(id='ZERO'){return{id,label:'Synthetic '+id,header:'__CPX_'+id,table:'SyntheticTable',name:'Synthetic'+id,kind:'measure',folder:'',group:'',sourceMetadata:{zero:0,flag:false,nil:null},percentageScale:0};}
function connection(id='asas1',role='asas',columns=[definition()]){
 const targets=modelScopes.allowedTargets(role);
 return{id,role,name:id,server:'SYNTHETIC_ONLY',catalog:'SYNTHETIC_ONLY',refreshEnabled:true,_configVersion:1,cpColumns:columns,
  horizon:{},parkedBindings:[],scopes:targets.filter(t=>t==='cp'||t==='orders'||t==='intake').map(target=>({id:id+'-'+target,enabled:true,targets:[target],horizon:{}}))};
}
function fixture(){
 const profile={id:'current-profile',enabled:true,status:'ACTIVE'},areas=new Set(['cp','orders']),calls=[];
 const deps={modelRefresh,modelScopes,hasArea(current,area){calls.push([current,area]);assert.strictEqual(current,profile,'same current caller profile');return areas.has(area);}};
 const items=[connection(),connection('antrepo1','antrepo',[definition('FALSE')]),connection('intake1','intake',[])];
 const context={collect:true,task:'projections',modules:['orders'],profile,connections:{items,revision:7},effectiveConnections:clone(items),sourceModes:{asas:'database',antrepo:'database'}};
 const flags=()=>moduleSchemaParams(context,deps);
 const rows=[0,1].map(index=>({ocode:String(100+index),model:'Synthetic '+index,ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G',license:'',manufacturer:'Synthetic',season:index?'S6':'W7',countryRaw:'TURKIYE',qty:index?0:10,kalan:index?0:5,fob:0,
  opd:new Date(2026,0,1),ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_cpExtra:{__CPX_ZERO:0,__CPX_FALSE:false,__CPX_NULL:null,...(index?{lateOnly:''}:{})}}));
 const source={loadedAt:'synthetic7f8',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
 // EXACT current computeParamsFor registration expression; no filtering/adaptation of raw definitions.
 const columns=()=>context.connections.items.flatMap(item=>(item.cpColumns||[]).map(col=>({...col,role:item.role,connectionId:item.id,connectionName:item.name||item.catalog||item.server})));
 function project(extra={}){
  const params={modules:['orders'],overrides:{},horizons:{},cpAllowed:true,summaryAllowed:true,cpModelColumns:columns(),...extra,...flags()};
  let schemas;const output=params.collectModuleSchemas===true?tasks.buildProjections(source,params,{onSchemas:value=>{schemas=value;}}):tasks.buildProjections(source,params);
  return{params,output,schemas};
 }
 return{context,deps,areas,calls,flags,profile,source,columns,project};
}
module.exports={fixture,definition,connection,moduleSchemaParams,modelRefresh,modelScopes,tasks,clone,sha,pins};
