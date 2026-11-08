'use strict';
// UNRUN V3: exact UI(corrected retirement), actual lexical lifecycle + native promotion.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const composition=require('./composed-source.cjs');
const {APP,hash,preUiSource:source,patched,quickSource,quickPatched,barSource,barPatched,selectedSource,baseline,seam,api,extractFunction,installLifecycle}=composition;
assert.equal(hash(fs.readFileSync(path.join(APP,'public/orders-full-promotion.js'))),'8e22220709e3352e6e12d12c2f8d61b1ace10aa2844b69e2172e5cdb882e5841');
const promotion=require(path.join(APP,'public/orders-full-promotion.js'));
function between(text,start,end){const at=text.indexOf(start),stop=text.indexOf(end,at);assert.ok(at>=0&&stop>at,start);return text.slice(at,stop);}
function nested(text,name){const at=text.indexOf('  function '+name+'(');assert.ok(at>=0,name);return extractFunction(text.slice(at+2),name);}
function callback(text,prefix,name,params=''){
 const at=text.indexOf(prefix);assert.ok(at>=0,prefix);const tail=text.slice(at+prefix.length);
 return extractFunction('function '+name+'('+params+'){'+tail,name);
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function node(id='',value=''){
 const listeners=new Map(),one=new Map(),many=new Map();return {id,value,checked:false,isConnected:true,tagName:'INPUT',dataset:{},style:{},classList:{add(){},contains:()=>true},
  listeners,one,many,innerHTML:'',setAttribute(){},getBoundingClientRect:()=>({left:1,bottom:2}),focus(){},remove(){this.isConnected=false;},
  addEventListener(type,fn){listeners.set(type,fn);},querySelector:q=>one.get(q)||null,querySelectorAll:q=>many.get(q)||[],
  closest(){return this;},contains(){return true;},
  dispatchEvent(){throw Error('candidate must not replay events');}};
}
function fire(n,type,event={}){const fn=n.listeners.get(type);assert.equal(typeof fn,'function',type+' actual listener');return fn({target:n,preventDefault(){},stopPropagation(){},...event});}
function fixture({thin=true,deny=false}={}){
 const events=[],nodes=new Map(),wait=deferred();let tab='orders',last=null,fetches=0,acceptedReads=0;
 const fullRows=[{_id:'row-a','Order Code':'same',zero:0,flag:false,nil:null,late:0},{_id:'row-b','Order Code':'same',zero:0}];
 const thinRows=fullRows.map(({late,...row})=>row),bytes=Buffer.from(JSON.stringify({rows:fullRows}));
 const identity=Object.freeze({ownerId:'owner',sessionId:'session-1',sourceId:'source-1',generation:'page-g1',accessHash:'access-1',scopeHash:'guard-1',module:'orders',planHash:'plan-1',fullProjectionChecksum:hash(bytes),fullByteLength:bytes.length,rowCount:2});
 const state={orders:{kind:thin?'thin':'full',rows:thin?thinRows:fullRows,identity,requiredKeys:[],ordinals:[0,1],selectedRows:[],mutationRevision:0,selectionRevision:0,dirty:false},
  currentUser:{id:'owner'},ordersSelected:new Set(),ordersSort:{key:null,dir:1},cpSort:{key:null,dir:1},colFilters:{orders:{},cp:{}},
  checkFilter:{orders:'',cp:''},ordersQuickExf:'',ordersQuickActive:new Set(),cpQuickExf:''};
 const controllers=new WeakMap(),moduleNow=()=>state.orders;
 const document={body:{dataset:{activeTab:tab},appendChild(){}},getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],createElement:()=>node(),activeElement:null};
 const ctx=vm.createContext({state,document,appLang:'en',_ordersFullViewControllers:controllers,BLOrdersUiCommand:api,
  BL_USER_CONTEXT:state.currentUser,
  currentActiveTab:()=>tab,BLCanAccessArea:()=>!deny,BLPerf:{mark(){}},_openFilterPanel:null,
  showToast:(message,options)=>events.push({type:'toast',message,options}),renderOrders:null,deferRenderForTab:module=>{assert.equal(module,'orders');events.push('render');},renderCP:()=>events.push('cp-render'),renderKol:()=>events.push('kol-render'),renderShip:()=>events.push('ship-render'),
  renderOrdersDebounced:()=>events.push('debounced-render'),saveCoreAutoFilterState:()=>events.push('save'),saveOrdersDimFilters:()=>events.push('dim-save'),updateOrdersDimBtnLabels:()=>events.push('dim-label'),
  BLStorage:{setItem:()=>events.push('storage')},norm:v=>String(v==null?'':v).trim(),comparableColumnFilterValue:(_key,v)=>String(v),
  BLSelectionBar:{refresh:()=>events.push('selection-bar')},BLGridClipboard:{clear:id=>events.push('clipboard-clear:'+id)},
  updateShippingBtnVisibility:()=>events.push('shipping'),getFreeze:()=>({left:0,right:0}),partialViewEnabled:()=>false,
  Map,Set,WeakMap,Promise,JSON,Error,Event,setTimeout:()=>0,clearTimeout(){},console});
 ctx.window=ctx;
 // Keep the real undefined return of the actual full renderer, even when the
 // observable defer sink returns an Array.push count.
 vm.runInContext(extractFunction(selectedSource,'renderOrders'),ctx);
 // This is the unchanged real retirement adapter, not counter assignments or
 // permissive replacements for the new lifecycle functions under test.
 installLifecycle(ctx,{_ordersProjectionClient:{invalidate:()=>events.push('invalidate')}});
 const admittedEpoch=ctx._ordersProjectionSourceEpoch,admittedSession=ctx._ordersUiSessionEpoch,admittedActor=state.currentUser;
 const sourceNow=()=>Object.freeze({ownerId:identity.ownerId,actorId:String(state.currentUser?.id||''),allowed:ctx.BLCanAccessArea('orders')===true,
  sessionId:identity.sessionId,sourceId:identity.sourceId,generation:identity.generation,accessHash:identity.accessHash,
  scopeHash:identity.scopeHash,planHash:identity.planHash,sourceEpoch:ctx._ordersProjectionSourceEpoch,sessionEpoch:ctx._ordersUiSessionEpoch});
 vm.runInContext(['ensureOrdersFullForAction','selectionIdKey','selectionHasId','selectionActualId','selectionSetId','normalizeCheckFilterMode']
  .map(name=>extractFunction(selectedSource,name)).join('\n')+'\n'+seam,ctx);
 const snapshot=()=>{state.orders.selectedRows=state.orders.rows.filter(row=>ctx.selectionHasId(state.ordersSelected,row._id));return state.orders;};
 const actual=promotion.create({snapshot,fetchFull:async()=>{fetches++;events.push('fetch');await wait.promise;return {identity,bytes};},
  normalize:async rows=>({rows:rows.map(row=>({...row,_canEdit:false})),ordinals:[0,1]}),
  publish:(next,{expected,assertCurrent})=>{assert.equal(state.orders,expected);assertCurrent();state.orders=next;return next;},
  isCurrent:()=>ctx._ordersProjectionSourceEpoch===admittedEpoch&&ctx._ordersUiSessionEpoch===admittedSession&&state.currentUser===admittedActor&&ctx.BLCanAccessArea('orders')===true});
 const privateSource=api.createPrivateSource({moduleNow,sourceNow,lastFull:()=>last});
 const controller={captureUiSource:privateSource.capture,async ensure(options){last=await actual.ensure(options);return last;},
  accepted:{assertCurrent(){acceptedReads++;throw Error('pending DOM differs from original acceptance capture');}}};
 if(thin)controllers.set(state.orders,controller);
 for(const id of ['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason']){const n=node(id);if(id!=='ordersSearch')n.tagName='SELECT';nodes.set(id,n);}
 function load(names,text=selectedSource){vm.runInContext(names.map(name=>extractFunction(text,name)).join('\n'),ctx);}
 function evaluate(code){return vm.runInContext(code,ctx);}
 return {ctx,state,events,nodes,wait,identity,fullRows,thinRows,controller,sourceNow,load,evaluate,
  fetches:()=>fetches,acceptedReads:()=>acceptedReads,setTab(value){tab=value;document.body.dataset.activeTab=value;},retire(){return ctx.retireOrdersProjectionSource('orders.ui.test-retire');},
  settle(){wait.resolve();},source:selectedSource};
}
module.exports={APP,api,source,patched,quickSource,quickPatched,barSource,barPatched,selectedSource,baseline,extractFunction,between,nested,callback,node,fire,fixture,deferred,hash,composition};
