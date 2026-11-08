'use strict';
// Execute the actual polling block and live leader with a deterministic browser.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {extractFunction}=require('./helpers/app-main-functions');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const polling=source.slice(source.indexOf('let sharedRevisionSnapshot='),source.indexOf('// Yenile: ASAS aktif',source.indexOf('let sharedRevisionSnapshot=')));
const code=polling+'\n'+extractFunction(source,'initLiveSync')+'\ninitLiveSync();';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const snapshot=n=>({revision:n,entities:{quotation:{revision:n},fx:{revision:n}}});
function browser({channel=true,locks=true,channelThrows=false,lockRejects=false}={}){
  let now=0,seq=0;
  const timers=new Map(),channels=new Set(),holders=new Map(),waiters=new Map(),requests=[],sources=[],tabs=[];
  const setTimer=(fn,ms=0)=>{const id=++seq;timers.set(id,{fn,at:now+ms});return id;};
  function release(name,entry){if(holders.get(name)!==entry)return;holders.delete(name);grant(name);}
  function grant(name){if(holders.has(name))return;const entry=(waiters.get(name)||[]).shift();if(!entry)return;if(entry.signal?.aborted){grant(name);return;}holders.set(name,entry);Promise.resolve(entry.fn({name})).then(()=>release(name,entry));}
  class Channel{
    constructor(name){if(channelThrows)throw Error('disabled');this.name=name;channels.add(this);}
    postMessage(data){for(const other of channels)if(other!==this&&other.name===this.name)queueMicrotask(()=>other.onmessage?.({data:structuredClone(data)}));}
    close(){channels.delete(this);this.onmessage=null;}
  }
  const lockApi={request(name,options,fn){if(typeof options==='function'){fn=options;options={};}if(lockRejects)return Promise.reject(Error('disabled'));return new Promise((resolve,reject)=>{const entry={signal:options.signal,fn:async lock=>{await fn(lock);resolve();}};if(!waiters.has(name))waiters.set(name,[]);waiters.get(name).push(entry);options.signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));grant(name);});}};
  function tab(id,user={id:'same-user',iamRevision:1,permissions:{read:true}}){
    const events=[],patches=[],resync=[],win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';
    Object.assign(win,{BL_CLIENT_ID:id,BL_USER_CONTEXT:user,setTimeout:setTimer,setInterval(fn,ms){const repeat=()=>{fn();setTimer(repeat,ms);};return setTimer(repeat,ms);},dispatchEvent:win.dispatchEvent.bind(win)});
    const context=vm.createContext({window:win,document:doc,navigator:{onLine:true,...(locks?{locks:lockApi}:{})},state:{currentUser:user},
      ...(channel?{BroadcastChannel:Channel}:{}),AbortController,CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}},
      EventSource:class{constructor(url){this.url=url;this.tab=id;this.readyState=0;sources.push(this);}close(){this.readyState=2;this.closed=true;}},
      fetch(url,options){return new Promise((resolve,reject)=>{const req={id,url,options,resolve:n=>resolve({ok:true,json:async()=>n}),fail:reject};requests.push(req);options?.signal?.addEventListener('abort',()=>{req.aborted=true;reject(Object.assign(Error('aborted'),{name:'AbortError'}));});});},
      setTimeout:setTimer,clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),liveSyncConnected:false,
      renderSyncStatusBadge(){},syncStatusModalRenderer:null,refreshSharedMasterClient:async()=>{},refreshPricingRulesFromServer:async()=>{},
      applyRemoteRowPatches:rows=>patches.push(rows),loadFromServer:async()=>{},kolHandleRemoteChange:async()=>{},initKolWorkspaces:async()=>{},liveSyncResyncAfterGap:()=>resync.push(now),
    });
    win.addEventListener('bl-shared-revision',e=>events.push(structuredClone(e.detail)));
    vm.runInContext(code,context);
    const result={id,win,doc,context,events,patches,resync,close(){win.dispatchEvent(new Event('pagehide'));},access(profile){win.BL_USER_CONTEXT=profile;context.state.currentUser=profile;win.dispatchEvent(new Event('bl:user-access-applied'));}};
    tabs.push(result);return result;
  }
  async function tick(ms){const end=now+ms;for(let steps=0;steps<10000;steps++){await flush();const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){now=end;await flush();return;}now=next[1].at;timers.delete(next[0]);next[1].fn();}throw Error('timer loop');}
  return {tab,tick,requests,sources,tabs,channels,timers,flush};
}

test('three tabs use the existing single SSE leader for revision polling and fan out snapshots',async()=>{
  const b=browser(),tabs=[b.tab('a'),b.tab('b'),b.tab('c')];await b.tick(2500);
  assert.equal(b.sources.length,1);assert.equal(b.requests.length,1);
  b.requests[0].resolve(snapshot(1));await b.flush();await b.tick(7000);
  assert.equal(b.requests.length,2);b.requests[1].resolve(snapshot(2));await b.flush();
  for(const t of tabs){assert.equal(t.events.length,1);assert.deepEqual(t.events[0],{changed:['quotation','fx'],revisions:snapshot(2)});}
});
test('slow or stuck fetch never overlaps; timeout and failures back off and recover',async()=>{
  const b=browser();b.tab('a');await b.tick(2500);await b.tick(14000);assert.equal(b.requests.length,1);
  await b.tick(1000);assert.equal(b.requests[0].aborted,true);await b.tick(13999);assert.equal(b.requests.length,1);
  await b.tick(1);assert.equal(b.requests.length,2);b.requests[1].resolve(snapshot(1));await b.flush();await b.tick(7000);assert.equal(b.requests.length,3);
});
test('closing a leader aborts its request and transfers polling with follower catch-up',async()=>{
  const b=browser(),a=b.tab('a'),f=b.tab('b');await b.tick(2500);b.requests[0].resolve(snapshot(1));await b.flush();await b.tick(7000);
  a.close();await b.flush();assert.equal(b.requests[1].aborted,true);await b.tick(2500);
  assert.equal(b.sources.filter(s=>!s.closed).length,1);assert.equal(b.requests.at(-1).id,'b');b.requests.at(-1).resolve(snapshot(3));await b.flush();
  assert.equal(f.events.at(-1).revisions.revision,3);
});
test('late follower uses cached baseline and catches subsequent changes',async()=>{
  const b=browser();b.tab('a');await b.tick(2500);b.requests[0].resolve(snapshot(1));await b.flush();const f=b.tab('late');await b.flush();
  await b.tick(7000);b.requests.at(-1).resolve(snapshot(2));await b.flush();assert.equal(f.events.at(-1).revisions.revision,2);
});
test('hidden owner slows polling, online and visible follower wake it without overlapping',async()=>{
  const b=browser(),a=b.tab('a'),f=b.tab('b');await b.tick(2500);b.requests[0].resolve(snapshot(1));await b.flush();
  a.doc.visibilityState='hidden';a.doc.dispatchEvent(new Event('visibilitychange'));await b.tick(7000);b.requests.at(-1).resolve(snapshot(1));await b.flush();const count=b.requests.length;
  await b.tick(29999);assert.equal(b.requests.length,count);
  f.doc.dispatchEvent(new Event('visibilitychange'));await b.flush();assert.equal(b.requests.length,count+1);
  a.context.navigator.onLine=false;a.win.dispatchEvent(new Event('offline'));assert.equal(b.requests.at(-1).aborted,true);
  await b.tick(60000);assert.equal(b.requests.length,count+1);a.context.navigator.onLine=true;a.win.dispatchEvent(new Event('online'));await b.flush();assert.equal(b.requests.length,count+2);
});
test('different users/access revisions do not share events, and old in-flight context is discarded',async()=>{
  const b=browser(),a=b.tab('a'),other=b.tab('other',{id:'other',iamRevision:1}),access=b.tab('scope',{id:'same-user',iamRevision:2});await b.tick(2500);assert.equal(b.sources.length,3);
  const old=b.requests.find(r=>r.id==='a');a.access({id:'same-user',iamRevision:3});await b.flush();assert.equal(old.aborted,true);old.resolve(snapshot(90));await b.flush();assert.equal(a.events.length,0);
  const s=b.sources.find(s=>s.tab==='other');s.onmessage({data:JSON.stringify({area:'orders',mode:'patch',rowPatches:[{id:1}]})});await b.flush();assert.equal(other.patches.length,1);assert.equal(a.patches.length,0);assert.equal(access.patches.length,0);
});
test('normal SSE patches, origin suppression and reconnect resync remain shared',async()=>{
  const b=browser(),a=b.tab('a'),f=b.tab('b');await b.flush();const s=b.sources[0];s.onopen();s.onmessage({data:JSON.stringify({area:'orders',mode:'patch',rowPatches:[{id:1}],originClientId:'b'})});await b.flush();assert.equal(a.patches.length,1);assert.equal(f.patches.length,0);
  s.readyState=2;s.onerror();await b.tick(1000);b.sources[1].onopen();await b.flush();assert.equal(a.resync.length,1);assert.equal(f.resync.length,1);
});
test('closing a waiting follower removes it from lock handoff and stops all of its work',async()=>{
  const b=browser(),a=b.tab('a'),closed=b.tab('closed'),f=b.tab('f');closed.close();await b.tick(2500);b.requests[0].resolve(snapshot(1));await b.flush();a.close();await b.tick(2500);
  assert.equal(b.requests.at(-1).id,'f');assert.equal(b.sources.some(s=>s.tab===closed.id),false);b.requests.at(-1).resolve(snapshot(2));await b.flush();assert.equal(f.events.at(-1).revisions.revision,2);assert.equal(closed.events.length,0);
});
test('BFCache restore restarts ownership and clears the baseline if access changed while suspended',async()=>{
  const b=browser(),a=b.tab('a');await b.tick(2500);b.requests[0].resolve(snapshot(5));await b.flush();
  const hide=new Event('pagehide');Object.defineProperty(hide,'persisted',{value:true});a.win.dispatchEvent(hide);await b.flush();
  a.win.BL_USER_CONTEXT={id:'different-user',iamRevision:2};a.win.dispatchEvent(new Event('pageshow'));await b.tick(2500);assert.equal(b.sources.filter(s=>!s.closed).length,1);
  b.requests.at(-1).resolve(snapshot(6));await b.flush();assert.equal(a.events.length,0,'new user gets a fresh baseline');
});
test('followers compare their own snapshots, reject stale publications and exclude unscoped messages',async()=>{
  const b=browser(),a=b.tab('a'),f=b.tab('f');await b.tick(2500);b.requests[0].resolve(snapshot(1));await b.flush();
  const channels=[...b.channels],sender=channels[0],context=JSON.stringify(['same-user',1,null,null,null,null,null,null,{read:true},null,null,null,null]);
  sender.postMessage({type:'revisions',context,revisions:snapshot(3)});await b.flush();assert.equal(f.events.length,1);
  sender.postMessage({type:'revisions',context,revisions:snapshot(2)});sender.postMessage({type:'event',payload:{area:'orders',mode:'patch',rowPatches:[{id:8}]}});await b.flush();
  assert.equal(f.events.length,1);assert.equal(f.patches.length,0);assert.equal(a.events.length,0);
});
test('a missing identity safely polls locally rather than consuming another session broadcast',async()=>{
  const b=browser();b.tab('a',{});b.tab('b',{});await b.tick(2500);assert.equal(b.sources.length,2);assert.equal(b.requests.length,2);
});
for(const config of [{channel:false},{locks:false},{channelThrows:true},{lockRejects:true}])test('safe local fallback '+JSON.stringify(config),async()=>{
  const b=browser(config);b.tab('a');b.tab('b');await b.tick(2500);assert.equal(b.sources.length,2);assert.equal(b.requests.length,2);
});
