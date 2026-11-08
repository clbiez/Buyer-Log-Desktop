'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const APP=path.resolve(__dirname,'../../..');
const helper=require(path.join(APP,'tests/helpers/orders-retirement-source.js'));
const ui=require(path.join(APP,'public/orders-ui-command.js')),promotion=require(path.join(APP,'public/orders-full-promotion.js'));
const writer=require(path.join(APP,'server/lib/data-domain/source-writer.js'));
const adapter=require(path.join(APP,'server/lib/data-domain/legacy-adapter.js'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const reviewed=require('../orders-ready-integration/source.cjs'),recipe=require('./adoption-edits.json');
const candidate=reviewed.current('public/app-main.js');
let base=require('../orders-import-action-closure/source.cjs').beforeImport();
for(const edit of [...recipe.edits].reverse()){assert.equal(base.split(edit.next).length,2,'exact model closure reverse');base=base.replace(edit.next,edit.old);}
assert.equal(hash(base),recipe.baseSha256,'unchanged exact model closure predecessor');
const source=process.env.BL_MODEL_ACTION_BASELINE==='1'?base:candidate;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const clone=x=>JSON.parse(JSON.stringify(x));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};}
async function until(predicate){for(let i=0;i<50;i++){if(predicate())return;await turn();}assert.fail('fixture checkpoint not reached');}
class Node{
 constructor(document,id=''){this.document=document;this.id=id;this.isConnected=false;this.dataset={};this.value='';this.checked=false;this.disabled=false;this.listeners={};this.nodes=new Map();this.buttons=[];this.textContent='';this._html='';}
 set innerHTML(html){
  this._html=html;
  if(this.id==='_cpModelColumnModal'){
   for(const match of html.matchAll(/<(input|select|div|span|button|label)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const node=new Node(this.document,match[2]);node.tag=match[1];node.isConnected=this.isConnected;node.value=match[0].match(/\bvalue="([^"]*)"/)?.[1]||'';this.nodes.set('#'+node.id,node);
    if(node.tag==='select'){
     const tail=html.slice(match.index+match[0].length).split('</select>')[0],options=[...tail.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
     node.value=(options.find(x=>x[2].includes('selected'))||options[0])?.[1]||'';
    }
   }
   this.closeButtons=[new Node(this.document),new Node(this.document)];
  }
  if(this.id==='_cpModelColumnList')this.buttons=[...html.matchAll(/data-table="([^"]*)" data-name="([^"]*)"/g)].map(m=>{const n=new Node(this.document);n.isConnected=this.isConnected;n.dataset={table:m[1],name:m[2]};return n;});
 }
 get innerHTML(){return this._html;}
 querySelector(selector){return this.nodes.get(selector)||null;}
 querySelectorAll(selector){if(selector==='input,select,textarea')return [...this.nodes.values()].filter(n=>['input','select','textarea'].includes(n.tag));if(selector==='.cpModelClose')return this.closeButtons||[];if(selector==='[data-table]')return this.buttons;return [];}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
 async fire(type,extra={}){for(const fn of this.listeners[type]||[])await fn({currentTarget:this,target:this,...extra});}
 remove(){this.isConnected=false;for(const n of this.nodes.values())n.isConnected=false;if(this.document.live.get(this.id)===this)this.document.live.delete(this.id);this.document.events.push(['remove',this.id]);}
 focus(){this.document.events.push(['focus',this.id]);}
}
function fixture({thin=false,active=true,edit=true,tab='orders'}={}){
 const events=[],requests=[],patches=[],holds=[];
 let allowed=true,activeTab=tab,revision=5;
 let items=[{id:'a',role:'asas',server:'demo-a',catalog:'demo',name:'Demo A',cpColumns:edit?[{id:'column-one',label:'Old',labelEn:'Old',labelTr:'Eski',table:'Demo',name:'OldField',kind:'column',group:'Database'}]:[]},
  {id:'b',role:'antrepo',server:'demo-b',catalog:'demo',name:'Demo B',cpColumns:[]}];
 const payload=()=>({items:items.map(item=>({...clone(item),configRevision:adapter.configRevision(item)})),revision,supported:true,exportFolder:''});
 const document={events,live:new Map(),getElementById(id){return this.live.get(id)||null;},createElement(){events.push(['create']);return new Node(this);}};
 document.body={dataset:{activeTab:tab},appendChild(modal){modal.isConnected=true;for(const n of modal.nodes.values())n.isConnected=true;document.live.set(modal.id,modal);events.push(['append',modal.id]);}};
 const state={currentUser:{id:'demo-actor'},orders:{rows:[{_id:1}],...(thin?{projectionProfile:'thin'}:{})},ordersSelected:new Set(),ordersLogisticExpanded:new Set()};
 const c=vm.createContext({state,document,AbortController,Promise,Set,Map,WeakMap,Object,appLang:'en',
  window:{BL_USER_CONTEXT:state.currentUser,BLCanAccessArea:()=>allowed,BLOrdersUiCommand:ui},
  currentActiveTab:()=>activeTab,modelConnectionApiAvailable:()=>true,modelConnState:{...payload(),loaded:true},
  CP_MODEL_COLUMN_DEFS:[],BLColumnNames:{definitionLabels:d=>({en:d.labelEn||d.label,tr:d.labelTr||d.label})},
  DEFAULT_MODEL_COLUMN_GROUP:'Database',existingColumnGroups:()=>['Database'],groupKey:x=>String(x).toLowerCase(),escapeHtml:x=>String(x??''),
  confirm:()=>{events.push(['confirm']);return true;},showToast:message=>events.push(['toast',message]),renderCP:()=>events.push(['render']),
  forgetPersistedColumnKeys:(...x)=>events.push(['forget',...x]),
  syncCpModelColumns:defs=>{events.push(['sync',clone(defs)]);c.CP_MODEL_COLUMN_DEFS=defs;},
  refreshFieldMappingReadinessUI:()=>{events.push(['config-applied',c._ordersProjectionSourceEpoch]);},
  setOrdersLoadingState:()=>{},reviveServerDates:()=>{},invalidateUnifiedPriorityDecisions:()=>{},applyPricingRulesToLoadedRows:()=>{},
  buildOrdersFilters:()=>{},applyCoreAutoFilterState:()=>{},renderOrders:()=>{},ensureCollectionCatalogLoaded:()=>{},
  setTimeout:fn=>{queueMicrotask(fn);return 1;},console,
 });
 vm.runInContext(helper.extractFunction(base,'cpModelColumnDefinitionsFromConnections'),c);
 c.CP_MODEL_COLUMN_DEFS=c.cpModelColumnDefinitionsFromConnections(c.modelConnState.items);
 helper.installLifecycle(c,active?{_ordersProjectionClient:{invalidate:()=>events.push(['invalidate'])}}:{});
 const guard=candidate.slice(candidate.indexOf('const _ordersRequireFullSynchronousRead='),candidate.indexOf('\n};',candidate.indexOf('const _ordersRequireFullSynchronousRead='))+3);
 vm.runInContext(guard+'\nlet _ordersUiCommandGate=null;',c);
 // New lexical helper definitions are available in both arms; only real four
 // function bodies differ, so RED never relies on missing helper failures.
 const helperStart=candidate.indexOf('// Private lexical helpers for app-main.js;'),helperEnd=candidate.indexOf('async function writeCpModelColumn(',helperStart);assert.ok(helperStart>=0&&helperEnd>helperStart);
 vm.runInContext(candidate.slice(helperStart,helperEnd),c);
 vm.runInContext(['ordersProjectionIsThin','ordersFullActionError','ensureOrdersLoaded','ensureOrdersFullForAction','ordersUiChange','modelConnLoad','writeCpModelColumn','removeCpModelColumn','openCpModelColumnModal'].map(n=>helper.extractFunction(source,n)).join('\n')+'\nwindow.BLOrdersUiChange=ordersUiChange;',c);
 const fullWait=deferred(),raw=[{_id:1,hidden:42}],bytes=Buffer.from(JSON.stringify({rows:raw}));
 const identity={ownerId:'demo-actor',sessionId:'demo-session',sourceId:'demo-source',generation:'one',accessHash:'demo-allow',scopeHash:'demo-orders',module:'orders',planHash:'demo-omit',fullProjectionChecksum:hash(bytes),fullByteLength:bytes.length,rowCount:1};
 let view={kind:'thin',identity,rows:state.orders.rows,ordinals:[0],selectedRows:[],requiredKeys:['_id'],mutationRevision:0,selectionRevision:0,dirty:false},fullReceipt=null;
 const epoch=c._ordersProjectionSourceEpoch,session=c._ordersUiSessionEpoch,profile=state.currentUser;
 const coordinator=promotion.create({snapshot:()=>view,fetchFull:()=>{events.push(['full-fetch']);return fullWait.promise;},normalize:(rows,{ordinals})=>({rows,ordinals}),
  isCurrent:()=>allowed&&state.currentUser===profile&&epoch===c._ordersProjectionSourceEpoch&&session===c._ordersUiSessionEpoch,
  publish:(next,{assertCurrent})=>{assertCurrent();view=next;state.orders={rows:next.rows};return next;}});
 const binding=ui.createPrivateSource({moduleNow:()=>state.orders,lastFull:()=>fullReceipt,sourceNow:()=>Object.freeze({actorId:state.currentUser.id,allowed,epoch:c._ordersProjectionSourceEpoch,session:c._ordersUiSessionEpoch,parent:identity.fullProjectionChecksum})});
 if(thin)c._ordersFullViewControllers.set(state.orders,{ensure:async opts=>(fullReceipt=await coordinator.ensure(opts)),captureUiSource:()=>binding.capture()});
 async function pause(stage,request){
  const hold=holds.find(h=>!h.used&&h.stage===stage&&h.match(request));
  if(hold){hold.used=true;hold.request=request;hold.entered.resolve(request);return hold.wait.promise;}
 }
 c.fetch=async(url,opts={})=>{
  const request={url,opts,body:opts.body?JSON.parse(opts.body):null};requests.push(request);events.push(['fetch',url,opts.method||'GET']);
  await pause('before',request);
  let data,ok=true,status=200;
  if(url==='/api/model-connections')data=payload();
  else if(url==='/api/model-connections/schema')data={columns:[{kind:'column',table:'Demo',name:request.body.server==='demo-a'?'FieldA':'FieldB'}]};
  else if(url.startsWith('/api/data-management/source/')){
   const id=decodeURIComponent(url.split('/').at(-1)),old=items.find(x=>x.id===id);
   // Real per-source CAS value and the real server planner, synthetic store.
   if(request.body.expectedSourceRevision&&request.body.expectedSourceRevision!==adapter.configRevision(old)){ok=false;status=409;data={error:'SOURCE_CHANGED'};}
   else{const plan=writer.planCpColumn(items,{sourceId:id,...request.body.cpColumn});
    if(!plan.ok){ok=false;status=400;data={ok:false,error:plan.code};}
    else{if(plan.code!=='NO_CHANGE'){items=plan.items;revision++;}data={ok:true,changed:plan.code!=='NO_CHANGE',revision};patches.push({id,command:clone(request.body.cpColumn),revision});}}
  }else throw Error('Unexpected synthetic request '+url);
  request.data=data;request.ok=ok;
  await pause('http',request);
  return {ok,status,statusText:String(status),json:async()=>{await pause('json',request);return clone(request.data);}};
 };
 const hold=(match,stage='http')=>{const h={match:typeof match==='string'?r=>r.url===match:match,stage,wait:deferred(),entered:deferred()};holds.push(h);return {entered:h.entered.promise,get request(){return h.request;},release:()=>h.wait.resolve(),reject:error=>h.wait.reject(error)};};
 const api={c,state,events,requests,patches,document,hold,payload,
  get serverItems(){return items;},get revision(){return revision;},get modal(){return document.getElementById('_cpModelColumnModal');},
  tab:value=>{activeTab=value;document.body.dataset.activeTab=value;},revoke:()=>{allowed=false;},
  foreign:()=>{items[0]={...items[0],name:'Foreign'};revision++;},
  retire:()=>c.retireOrdersProjectionSource('foreign'),
  promote:()=>fullWait.resolve({identity,bytes:new Uint8Array(bytes)}),
  async open(id=edit?'column-one':null){await c.openCpModelColumnModal(id);await turn();assert.ok(api.modal,'modal created');return api.modal;},
  async chooseConnection(id){const node=api.modal.querySelector('#_cpModelConnection');node.value=id;await node.fire('change');await turn();},
  async chooseField(){await until(()=>api.modal.querySelector('#_cpModelColumnList').buttons.length>0);await api.modal.querySelector('#_cpModelColumnList').buttons[0].fire('click');},
  save(){return api.modal.querySelector('#_cpModelSave').fire('click');},
 };
 return api;
}
module.exports={APP,base,candidate,source,helper,fixture,turn,until,deferred,hash,clone};
