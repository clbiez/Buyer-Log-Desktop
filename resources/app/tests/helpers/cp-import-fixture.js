'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./app-main-functions');
const Plan=require('../../public/excel-import-plan');
const app=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(app,'public/app-main.js'),'utf8');
function actualCpAdapter(options={}){
 const f=require('../fixtures/orders-model-action-closure/native-fixture.cjs').fixture({thin:options.thin===true,active:options.finite===true,tab:options.tab||'cp'}),c=f.c;
 const row={'Order Code':7,'Model Name':'Synthetic','C.Code':'01',Notes:'unchanged',note_existing:'old'};
 c.state.cp={rows:[row]};c.state.cpDirty=new Set();c.state.cpSelected=new Set();c.state.cpLogisticExpanded=new Set();c.state.storeRevisions={orders:1};c.state.overrides={};
 Object.assign(c,{CP_NOTE_COLUMN_DEFS:[{id:'note_existing',label:'Existing'}],CP_NOTE_COLUMN_DEFS_REVISION:1,CP_COLS:[{k:'note_existing',label:'Existing'}],activeProfilePage:()=>options.tab||'cp',toISODate:v=>String(v),BLRevision:{isAutomaticExFactory:()=>false}});
 c.window.SERVER_BACKED=true;c.window.BLExcelImportPlan=Plan;
 const constants=source.slice(source.indexOf('const CP_IMPORT_IDENTITY_FIELDS='),source.indexOf('function canonicalIdOf('));vm.runInContext(constants,c);
 const names=['norm','turknorm','lineKeyOfRow','lineIdentity','canonicalIdOf','importNormalizeText','cpImportRowRevision','cpImportFields','cpImportReadValue','cpImportRowLabel','cpImportCreateCustomColumns','cpImportBuildItems',
  'ordersNoteActionStamp','captureOrdersNoteAction','assertOrdersNoteActionSource','assertOrdersNoteAction','acknowledgeOrdersNoteAction','saveCpNoteColumnDefs'];
 vm.runInContext(names.map(n=>extractFunction(source,n)).join('\n'),c);
 const start=source.indexOf('// BEGIN private CP import action guards'),end=source.indexOf('// END private CP import action guards');
 if(start>=0&&end>start)vm.runInContext(source.slice(start,end),c);
 c.syncCpNoteColumns=defs=>{c.CP_NOTE_COLUMN_DEFS=defs;c.CP_COLS=defs.map(d=>({k:d.id,label:d.label}));};c.forgetPersistedColumnKeys=()=>{};
 if(options.realRefresh){
  const testSource=fs.readFileSync(path.join(app,'tests/orders-source-retirement.test.js'),'utf8');
  const boot=Function('fixture','vm','source','extractFunction','return ('+extractFunction(testSource,'bootstrap')+');')(()=>({state:c.state,context:c,events:f.events,requests:[]}),vm,source,extractFunction);
  boot({data:options.refreshData||{}});
 }
 c.CustomEvent=class {constructor(type){this.type=type;}};c.window.dispatchEvent=event=>f.events.push(['event',event.type]);
 const sent=[],baseFetch=c.fetch;
 c.fetch=async(url,opts={})=>{
  if(url==='/api/note-columns'){f.events.push(['note-put',JSON.parse(opts.body),{...opts.headers}]);if(options.noteWait)await options.noteWait.promise;return {ok:true,json:async()=>({revision:2,columns:JSON.parse(opts.body).columns})};}
  return baseFetch(url,opts);
 };
 c.enqueueOverrideMutation=async(...args)=>{sent.push(args);return {updated:1};};
 if(options.actualQueue){c.fetchJSON=async(url,opts)=>{sent.push([url,opts]);return options.fetchJSON?options.fetchJSON(url,opts):{updated:1,revision:2};};vm.runInContext(fs.readFileSync(path.join(app,'public/override-sync.js'),'utf8'),c);}
 if(!options.actualItems)c.cpImportBuildItems=()=>[{orderCode:7,patch:{notes:{Notes:'synthetic'}}}];
 if(!options.realRefresh)c.loadFromServer=async()=>true;
 const at=source.indexOf('window.BLExcelImportBridge={'),stop=source.indexOf('\n};',at)+3;vm.runInContext(source.slice(at,stop),c);
 const adapter=options.thin?null:c.window.BLExcelImportBridge.get('cp');
 return {...f,adapter,scope:c,row,sent,source};
}
module.exports={actualCpAdapter};
