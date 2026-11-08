'use strict';
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {deferred,flush}=require('./clock.cjs');
const {poll,live,tail}=require('../../../../../scripts/prototypes/shell06-revision-poller-20261108/source.cjs');
const {adaptBlocks}=require('../../../../../scripts/prototypes/shell06-revision-poller-20261108/recipe.cjs');
const helper=fs.readFileSync(path.join(__dirname,'../../../public/shared-revision-poller.js'),'utf8');
function browser({channel=true,locks=true,baseline=process.env.SHELL06_BASELINE_RED==='1',helperAsset=true,uuid=true}={}){
 let time=0,id=0,holder=null;const timers=new Map(),channels=new Set(),waiters=[],gets=[],sources=[],tabs=[];
 const clock={setTimeout(fn,ms){const k=++id;timers.set(k,{at:time+ms,fn});return k;},clearTimeout(k){timers.delete(k);},setInterval(fn,ms){const k=++id;timers.set(k,{at:time+ms,fn,ms});return k;}};clock.clearInterval=clock.clearTimeout;
 async function tick(ms=0){const target=time+ms;for(let guard=0;guard<1000;guard++){await flush();let next;for(const [k,t]of timers)if(t.at<=target&&(!next||t.at<next[1].at))next=[k,t];if(!next){time=target;await flush();return;}time=next[1].at;timers.delete(next[0]);if(next[1].ms)timers.set(next[0],{...next[1],at:time+next[1].ms});next[1].fn();}throw Error('runaway');}
 class Channel{constructor(name){this.name=name;channels.add(this);}postMessage(data){for(const c of channels)if(c!==this&&c.name===this.name)queueMicrotask(()=>{if(channels.has(c))c.onmessage?.({data:structuredClone(data)});});}close(){channels.delete(this);}}
 function grant(){if(holder)return;const w=waiters.shift();if(!w)return;if(w.signal.aborted){w.reject(new DOMException('Aborted','AbortError'));grant();return;}holder=w;Promise.resolve(w.callback({name:w.name})).then(()=>{holder=null;w.resolve();grant();});}
 const lockApi={request(name,{signal},callback){return new Promise((resolve,reject)=>{waiters.push({name,signal,callback,resolve,reject});signal.addEventListener('abort',()=>{if(holder?.signal!==signal){const i=waiters.findIndex(w=>w.signal===signal);if(i>=0){waiters.splice(i,1);reject(new DOMException('Aborted','AbortError'));}}},{once:true});grant();});}};
 // Original coordinator uses the older two-argument request overload.
 const request=lockApi.request;lockApi.request=(name,options,callback)=>typeof options==='function'?request(name,{signal:new AbortController().signal},options):request(name,options,callback);
 class Source{constructor(url){this.url=url;this.readyState=0;sources.push(this);}open(){this.readyState=1;this.onopen?.();}error(){this.readyState=2;this.onerror?.();}message(payload){this.onmessage?.({data:JSON.stringify(payload)});}close(){this.readyState=2;this.closed=true;}}
 function tab(name){
  const win=new EventTarget(),doc=new EventTarget(),events=[],outputs=[];doc.hidden=false;doc.activeElement=null;
  const contextPort={value:{actor:'actor',source:'demo',authority:'grant',valid:true},listeners:new Set(),read(){return this.value;},subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}};
  const sandbox={...clock,Date:class extends Date{static now(){return time;}},crypto:uuid?require('node:crypto').webcrypto:{},AbortController,DOMException,CustomEvent,document:doc,navigator:{onLine:true,...(locks?{locks:lockApi}:{})},...(channel?{BroadcastChannel:Channel}:{}),EventSource:Source,
   fetch:(url,options)=>{const d=deferred();gets.push({tab:name,url,options,...d});return d.promise;},
   liveSyncConnected:false,state:{},kolWorkspaceOwnerId:null,appLang:'en',
   renderSyncStatusBadge(){},syncStatusModalRenderer:null,refreshSharedMasterClient:async area=>outputs.push(area),refreshPricingRulesFromServer:async()=>outputs.push('pricing'),loadFromServer:async()=>outputs.push('load'),kolHandleRemoteChange:async()=>outputs.push('collection'),initKolWorkspaces:async()=>{},applyRemoteRowPatches:()=>outputs.push('patch'),showToast(){},
  };
  Object.assign(win,{BL_CLIENT_ID:name,BLSharedRevisionContext:contextPort,BL_QUOTATIONS:{refresh:()=>outputs.push('quotation')},BLLicenseCardsPage:{invalidate:()=>outputs.push('licenseCards')},setInterval:clock.setInterval});sandbox.window=win;
  win.addEventListener('bl-shared-revision',e=>events.push(structuredClone(e.detail)));
  const context=vm.createContext(sandbox);if(helperAsset)vm.runInContext(helper,context);
  // The helper uses the same global object as a browser's window.
  win.BLSharedRevisionPoller=context.BLSharedRevisionPoller;
  vm.runInContext((baseline?[poll,live,tail]:adaptBlocks()).join('\n'),context);
  const result={name,window:win,document:doc,context,port:contextPort,events,outputs,stop:()=>win.__shell06StopLiveSync?.(),change(value){contextPort.value=value;for(const fn of contextPort.listeners)fn();}};tabs.push(result);return result;
 }
 async function reply(index,revision){gets[index].resolve({ok:true,json:async()=>({schemaVersion:1,revision,entities:{quotation:{revision},pricingRules:{revision}}})});await flush();}
 return {tab,tick,gets,sources,tabs,reply,channels};
}
module.exports={browser};
