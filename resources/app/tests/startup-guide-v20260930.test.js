'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(ROOT,'public',name),'utf8');
const INDEX=read('index.html'),APP=read('app-main.js'),GUIDE=read('buyerlog-guide.js');
const DATA=require('../public/buyerlog-guide-data.js');
// Without the desktop capture bridge, Continue reveals the app immediately.
function finishDismissal(h){assert.equal(h.nodes.has('blBootGuard'),false);}
function guardHarness(search=''){
  const listeners={},nodes=new Map(),timers=new Map(),metrics=new Map();let tick=0,stops=0,reloads=0,clock=0;
  function node(id=''){
    const n={id,textContent:'',dataset:{},style:{},isConnected:true,children:[],classList:{add(){},contains(){return false;}},setAttribute(){},removeAttribute(){},getClientRects(){return [{}];},focus(){doc.activeElement=n;},contains(o){return o===n||n.children.includes(o);},appendChild(c){n.children.push(c);},remove(){n.isConnected=false;nodes.delete(n.id);}};
    n.querySelector=selector=>{if(selector==='[data-boot-message]'||selector==='[data-boot-hint]')return n.message||(n.message=node());if(selector==='[data-boot-detail]')return n.detail||(n.detail=node());if(selector==='.blBootCard')return n.card||(n.card=node());if(selector==='[data-boot-retry]')return n.children.find(c=>c.dataset.bootRetry);if(selector==='.blBootOrb')return n.canvas||(n.canvas=node());return null;};
    n.querySelectorAll=()=>n.children;
    return n;
  }
  const doc={readyState:'loading',activeElement:null,body:node(),documentElement:node(),getElementById:id=>nodes.get(id)||null,createElement:()=>node(),addEventListener:(name,fn)=>{(listeners['doc:'+name]??=[]).push(fn);}};
  doc.body.appendChild=el=>{nodes.set(el.id,el);};
  const win={addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);},dispatchEvent:ev=>{for(const fn of listeners[ev.type]||[])fn(ev);},BLThinkingOrbBreathing:{attach:()=>({stop(){stops++;}})},BLGuide:{mountStartup(){},stage(){}}};
  win.BLPerf={origin:()=>0,record:(name,value)=>metrics.set(name,value)};
  const context=vm.createContext({window:win,document:doc,URLSearchParams,performance:{now:()=>clock},console:{error(){}},sessionStorage:{removeItem(){},getItem(){return null;},setItem(){}},location:{search,replace(){reloads++;}},fetch:async()=>({ok:true,json:async()=>({app:'Buyer Log'})}),AbortSignal:{timeout(){}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout:(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const script=INDEX.slice(INDEX.indexOf('<script>\n(function(){')+8,INDEX.indexOf('</script>',INDEX.indexOf('<script>\n(function(){')));
  vm.runInContext(script,context);
  win.BLBootGuard.mount();
  return {win,doc,nodes,timers,listeners,metrics,setClock(value){clock=value;},get stops(){return stops;},get reloads(){return reloads;},profile(){nodes.set('currentUserInitials',{textContent:'AB'});nodes.set('accessModeBadge',{textContent:'Buyer'});win.dispatchEvent({type:'bl:user-access-applied',detail:{id:'sample',displayName:'Example User'}});}};
}
test('Continue keeps the trivia screen until capture, then completes exactly once and restores visible keyboard focus',()=>{
  const h=guardHarness(),pending=[];let completed=0;
  h.win.BLMotionPlus={startup:update=>{pending.push(update);return true;}};
  h.win.addEventListener('bl:startup-complete',()=>completed++);
  const target={focus(){h.doc.activeElement=target;}};h.nodes.set('corporateConnectionsBtn',target);
  h.win.BLBootGuard.ready('core');h.win.BLBootGuard.ready('data');h.profile();readyAll(h,['ui','modules']);
  const guard=h.nodes.get('blBootGuard');h.doc.activeElement=guard;
  h.win.BLBootGuard.continue();h.win.BLBootGuard.continue();
  assert.equal(pending.length,1);assert.equal(guard.inert,true);assert.equal(guard.isConnected,true);assert.equal(completed,0);
  pending[0]();assert.equal(guard.isConnected,false);assert.equal(completed,1);assert.equal(h.doc.activeElement,target);
});
// Every non-profile startup gate, in the order app-main.js reports them.
function readyAll(h,keys=['core','data','ui','modules']){keys.forEach(k=>h.win.BLBootGuard.ready(k==='core'?undefined:k));}
test('gate, actual dismissal and system usability exclude human wait but retain queued input and Motion time',()=>{
  const h=guardHarness(),motion=[];
  h.win.BLMotionPlus={startup:reveal=>{motion.push(reveal);return true;}};
  h.setClock(100);readyAll(h);h.profile();
  assert.equal(h.metrics.get('startupGateReadyMs'),100);
  assert.equal(h.metrics.has('firstUsableInteractionMs'),false,'the app is still covered');
  h.setClock(600);h.nodes.get('blBootGuard').card.children.find(c=>c.dataset.bootContinue).onclick({timeStamp:400});
  assert.equal(h.metrics.get('startupUserWaitMs'),300);
  assert.equal(h.metrics.get('startupContinueDispatchDelayMs'),200);
  assert.equal(h.metrics.has('firstUsableInteractionMs'),false,'Motion has not revealed the app yet');
  h.setClock(640);motion[0]();
  assert.equal(h.metrics.get('startupCurtainDismissedMs'),640);
  assert.equal(h.metrics.get('startupSystemCompleteMs'),340);
  assert.equal(h.metrics.get('firstUsableInteractionMs'),340);
});
test('automated Continue can declare its earlier intent without bypassing a gate',()=>{
  const h=guardHarness();h.win.BLBootGuard.continue({intentAtMs:0});assert.ok(h.nodes.has('blBootGuard'));
  h.setClock(100);readyAll(h);h.profile();
  h.setClock(500);h.win.BLBootGuard.continue({intentAtMs:100});
  assert.equal(h.metrics.get('startupUserWaitMs'),0);
  assert.equal(h.metrics.get('startupContinueDispatchDelayMs'),400);
  assert.equal(h.metrics.get('startupSystemCompleteMs'),500);
});
function guideHarness(profile=null){
  const events={},timers=[];
  const win={BLGuideData:DATA,BL_USER_CONTEXT:profile,addEventListener:(name,fn)=>{(events[name]??=[]).push(fn);}};
  const doc={documentElement:{lang:'tr'},addEventListener:(name,fn,options)=>{(events['doc:'+name]??=[]).push({fn,options});},getElementById:()=>null};
  vm.runInNewContext(GUIDE,{window:win,document:doc,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}});
  return {win,doc,events,timers};
}
test('the curtain waits for profile and opening screen while other modules remain in the background',()=>{
  const h=guardHarness();h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');
  assert.ok(h.nodes.has('blBootGuard'));assert.equal(h.nodes.get('blBootGuard').dataset.ready,undefined);
  h.profile();assert.equal(h.nodes.get('blBootGuard').dataset.ready,undefined,'an authenticated shell alone no longer releases the curtain');
  h.win.BLBootGuard.ready('ui');assert.equal(h.nodes.get('blBootGuard').dataset.ready,'1','the authenticated primary screen releases the gate immediately');
  const g=h.nodes.get('blBootGuard');assert.match(g.detail.textContent,/Başlangıç ekranı hazır/);
  h.win.dispatchEvent({type:'bl:startup-progress',detail:{stage:'modules',module:'orders',index:2,total:3}});
  assert.equal(g.dataset.ready,'1','background progress cannot close the primary gate');
  assert.ok(g.card.children.some(c=>c.dataset.bootContinue),'Continue is offered before other modules finish');
  h.win.BLBootGuard.ready('modules');
  assert.equal(h.stops,1);assert.equal(g.dataset.ready,'1');assert.equal(g.message.textContent,'Buyer Log hazır');assert.match(g.detail.textContent,/Başlangıç ekranı hazır/);
  const button=g.card.children.find(c=>c.dataset.bootContinue);assert.ok(button);assert.equal(h.doc.activeElement,button);
  let completed=0;h.win.addEventListener('bl:startup-complete',()=>completed++);assert.equal(completed,0);
  button.onclick();assert.equal(completed,1);finishDismissal(h);assert.ok(!h.nodes.has('blBootGuard'));
  h.win.BLBootGuard.continue();assert.equal(completed,1,'a second Continue during the fade is ignored');
});
test('stage detail follows the first unfinished gate',()=>{
  const h=guardHarness(),g=h.nodes.get('blBootGuard');
  assert.equal(g.detail.textContent,'Uygulama arayüzü yükleniyor…');
  h.win.BLBootGuard.ready();assert.equal(g.detail.textContent,'Başlangıç verisi yükleniyor…');
  h.win.BLBootGuard.ready('data');assert.equal(g.detail.textContent,'Kullanıcı bilgileri ve yetkiler uygulanıyor…');
  h.profile();assert.equal(g.detail.textContent,'Başlangıç ekranı hazırlanıyor…');
});
test('a module that never finishes cannot trap an authenticated user',()=>{
  const h=guardHarness();readyAll(h,['core','data','ui']);h.profile();
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');
  assert.equal([...h.timers.values()].some(t=>t.ms===90000),false,'no background-module timeout is a startup prerequisite');
  assert.match(g.detail.textContent,/arka planda/);
});
test('a failed opening screen never traps the authenticated user behind the curtain',()=>{
  const h=guardHarness();h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');
  h.win.BLBootGuard.fail('initial-screen-failed');
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.failed,'1','Retry is offered while the profile is still missing');
  h.profile();assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
  assert.match(g.detail.textContent,/Başlangıç ekranı hazırlanamadı/);
  assert.ok(g.card.children.some(c=>c.dataset.bootContinue));
});
test('first and secondary workspace tabs use the same primary-only readiness gate',()=>{
  const h=guardHarness('?module=orders&workspaceTab=abc');readyAll(h,['core','data','ui']);h.profile();
  assert.equal(h.nodes.get('blBootGuard').dataset.ready,'1');
  const first=guardHarness('?module=overview&workspaceTab=abc&startup=1');readyAll(first,['core','data','ui']);first.profile();
  assert.equal(first.nodes.get('blBootGuard').dataset.ready,'1','the first window also waits only for its authenticated primary screen');
});
test('background completion cannot bypass any core, data, primary-screen or profile gate',()=>{
  const required=['core','data','ui','profile'];
  for(const missing of required){
    const h=guardHarness();
    for(const key of required.filter(key=>key!==missing)){if(key==='profile')h.profile();else h.win.BLBootGuard.ready(key);}
    h.win.BLBootGuard.ready('modules');h.win.BLBootGuard.continue();
    assert.equal(h.nodes.get('blBootGuard').dataset.ready,undefined,missing+' must remain mandatory');
    assert.ok(h.nodes.has('blBootGuard'));
    if(missing==='profile')h.profile();else h.win.BLBootGuard.ready(missing);
    assert.equal(h.nodes.get('blBootGuard').dataset.ready,'1');
  }
});
test('a stale startupWarm address no longer auto-dismisses the curtain',()=>{
  const h=guardHarness('?module=orders&startupWarm=1');
  readyAll(h);h.profile();
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.leaving,undefined);
  assert.doesNotMatch(INDEX,/startupWarm|BL_STARTUP_WARMING/);
});
test('requested table module is selected before eager helpers and core health does not wait for images',()=>{
  assert.ok(INDEX.indexOf('window.BL_BOOT_MODULE=module')<INDEX.indexOf('<script src="app-main.js'));
  assert.match(INDEX,/\['koleksiyon','cp','orders'\]\.includes\(module\)/);
  assert.match(INDEX,/document\.addEventListener\('DOMContentLoaded',finishBoot,\{once:true\}\)/);
});
test('Continue does nothing until preparation is complete',()=>{
  const h=guardHarness();h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');h.win.BLBootGuard.continue();
  assert.ok(h.nodes.has('blBootGuard'));assert.equal(h.nodes.get('blBootGuard').dataset.ready,undefined);
});
test('hard startup gates work regardless of arrival order',()=>{
  const permutations=keys=>keys.length?keys.flatMap((key,i)=>permutations(keys.filter((_,index)=>index!==i)).map(rest=>[key,...rest])):[[]];
  for(const order of permutations(['profile','data','core','ui','modules'])){
    const h=guardHarness(),arrived=new Set();
    order.forEach(key=>{arrived.add(key);if(key==='profile')h.profile();else h.win.BLBootGuard.ready(key==='core'?undefined:key);const complete=['core','data','ui','profile'].every(gate=>arrived.has(gate));assert.equal(h.nodes.get('blBootGuard').dataset.ready,complete?'1':undefined,order.join(',')+' at '+key);});
    h.win.BLBootGuard.ready('ui');h.win.BLBootGuard.ready();assert.equal(h.stops,1,'startup orb stops once after all hard gates finish');
    assert.equal(h.nodes.get('blBootGuard').card.children.filter(c=>c.dataset.bootContinue).length,1);h.win.BLBootGuard.continue();finishDismissal(h);assert.ok(!h.nodes.has('blBootGuard'));
  }
});
test('an absent/incomplete profile cannot release the curtain',()=>{
  const h=guardHarness();['core','data','ui'].forEach(k=>h.win.BLBootGuard.ready(k));
  h.win.dispatchEvent({type:'bl:user-access-applied',detail:{id:'sample'}});assert.ok(h.nodes.has('blBootGuard'));
});
test('slow startup shows information without an automatic 12-second reload; bounded failure offers exactly one retry',()=>{
  const h=guardHarness();assert.deepEqual([...h.timers.values()].map(t=>t.ms),[15000,120000]);
  for(const timer of h.timers.values())timer.fn();assert.equal(h.reloads,0);assert.equal(h.nodes.get('blBootGuard').dataset.failed,'1');
  h.win.BLBootGuard.fail();h.win.BLBootGuard.fail();assert.equal(h.nodes.get('blBootGuard').card.children.length,1);
});
test('late successful preparation recovers from the timed-out curtain without reloading',()=>{
  const h=guardHarness();[...h.timers.values()].find(t=>t.ms===120000).fn();h.profile();readyAll(h);
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);h.win.BLBootGuard.continue();finishDismissal(h);assert.ok(!h.nodes.has('blBootGuard'));assert.equal(h.reloads,0);
});
test('a late page-projection failure cannot regress an already ready shell',()=>{
  const h=guardHarness();readyAll(h);h.profile();
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
  h.win.BLBootGuard.fail('initial-screen-failed');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
});
test('recovery response cannot reload an already-ready app',async()=>{
  const h=guardHarness();const recovering=h.win.BLBootGuard.recover('missing-core');h.profile();readyAll(h);await recovering;assert.equal(h.reloads,0);
});
test('each guide card has bilingual instructions, a unique ID, a module, an illustration and source evidence',()=>{
  const ids=new Set(),visuals=new Set(['map','formula','partial','column','menu','search','filter','view','grid','table']);
  assert.equal(DATA.lessons.length,68); // v2026-10-22: Fiyat Masası Turlar/Analiz + Koleksiyon Kompakt fiyat görünümüassert.equal(DATA.modules.length,16);
  for(const c of DATA.lessons){assert.ok(!ids.has(c.id),c.id);ids.add(c.id);assert.ok(DATA.modules.some(m=>m.id===c.module));assert.ok(visuals.has(c.visual));assert.ok(c.evidence.startsWith('public/'));for(const l of ['tr','en']){for(const k of ['title','summary','path'])assert.ok(c[k][l],c.id+' '+k);assert.equal(c.steps[l].length,3);assert.ok(c.steps[l].every(Boolean));}}
});
test('module and capability access filters match real Orders and quotation area aliases',()=>{
  const h=guideHarness({accessAreas:{automations:true},capabilities:[]});let lessons=h.win.BLGuide.available();assert.ok(lessons.some(c=>c.id==='automation'));for(const id of ['tools','search','focus','quotation','paste'])assert.ok(!lessons.some(c=>c.id===id),id);
  h.win.BL_USER_CONTEXT={accessAreas:{cp:true},capabilities:[]};lessons=h.win.BLGuide.available();assert.ok(lessons.some(c=>c.id==='orders'));assert.ok(!lessons.some(c=>c.id==='quotation'));
  h.win.BL_USER_CONTEXT={accessAreas:{koleksiyon:true},capabilities:[]};lessons=h.win.BLGuide.available();assert.ok(lessons.some(c=>c.id==='quotation'));assert.ok(!lessons.some(c=>c.id==='calculated'));
});
test('before a profile exists only general, unrestricted lessons are eligible',()=>{
  const h=guideHarness();assert.ok(h.win.BLGuide.available().every(c=>!c.areas.length&&!c.capability));
});
test('illustrations escape arbitrary content and never embed real records or remote image requests',()=>{
  const h=guideHarness({accessAreas:{cp:true}}),card={...DATA.lessons[0],example:'<script>alert(1)</script>'};const html=h.win.BLGuide.illustration(card);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.doesNotMatch(html,/<img|https?:\/\//);
});
test('startup tips rotate at the initial focused curtain and pause only when reading the card or a control',()=>{
  const h=guideHarness({accessAreas:{cp:true}});let writes=0,current='';
  const tip={matches:()=>false,set innerHTML(v){writes++;current=v;}},pause={setAttribute(){},addEventListener(){},textContent:''},count={textContent:''};
  const elements={'[data-boot-tip]':tip,'[data-tip-count]':count,'[data-tip-pause]':pause};
  const root={isConnected:true,classList:{add(){}},contains:v=>v===root,querySelector:s=>s==='.blBootCard'?{insertAdjacentHTML(){elements['[data-boot-tip]']=tip;}}:elements[s]||{addEventListener(){}}};
  // The content host appears after insertAdjacentHTML, matching actual mounting.
  let mounted=false;const query=root.querySelector;root.querySelector=s=>s==='[data-boot-tip]'&&!mounted?null:s==='.blBootCard'?{insertAdjacentHTML(){mounted=true;}}:query(s);
  h.doc.activeElement=root;h.win.BLGuide.mountStartup(root);const before=current;assert.equal(writes,1);h.timers[0]();assert.equal(writes,2);assert.notEqual(current,before);
  tip.matches=()=>true;h.timers[0]();assert.equal(writes,2);
});
test('opening screen projection and failure gate are awaited, while background feature loading stays scheduled',()=>{
  const startup=APP.slice(APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {"),APP.indexOf('async function refreshFolderLabel()'));
  assert.match(startup,/primaryScreenReady=initialDataLoaded&&await waitForStartupPrimaryScreen\(\)/);assert.match(startup,/if\(primaryScreenReady\)window\.BLBootGuard\?\.ready\('ui'\)/);
  const helper=APP.slice(APP.indexOf('async function waitForStartupPrimaryScreen()'),APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {"));assert.match(helper,/ensureOverviewLoaded/);assert.match(helper,/ensureCpLoaded/);assert.match(helper,/ensureOrdersLoaded/);assert.doesNotMatch(helper,/ensureFeature|ensureLibrary|ensureCollectionMaster/);
  // The curtain is the first thing in <body>: nothing of the app can paint before it.
  const bodyAt=INDEX.indexOf('<body'),mountAt=INDEX.indexOf('<script>window.BLBootGuard?.mount();');
  assert.ok(mountAt>bodyAt&&mountAt<INDEX.indexOf('<svg',bodyAt)&&mountAt<INDEX.indexOf('<aside'));
  assert.match(INDEX,/href="ui-startup\.css/);const startupCss=fs.readFileSync(path.join(__dirname,'../public/ui-startup.css'),'utf8');assert.match(startupCss,/prefers-reduced-motion:reduce/);assert.match(startupCss,/transition:opacity var\(--ui-motion-enter\)/);assert.doesNotMatch(startupCss,/background-color.*animation|blBootBgIn/);assert.match(APP,/'#buyerLogGuide\[open\]', '#blBootGuard'/);
});
test('guide keys are isolated at capture phase before legacy mutation shortcuts',()=>{
  assert.match(GUIDE,/document\.addEventListener\('keydown',ev=>\{if\(dialog\?\.open\)\{ev\.stopImmediatePropagation\(\)/);assert.match(GUIDE,/\}\},true\);/);
  assert.match(INDEX,/if\(ev.key!=='Tab'\)\{ev.stopImmediatePropagation\(\);return;\}/);
  assert.doesNotMatch(GUIDE,/node\.click\(|dispatchEvent.*click|fetch\(/);
});
test('calculated-column directions stay within supported tables and shipping uses the real Columns control',()=>{
  const ids=['calculated','formula-rules','formula-blanks','formula-ai'];for(const id of ids){const c=DATA.lessons.find(c=>c.id===id);assert.deepEqual(c.areas,['cp','orders','shipping']);}
  assert.match(DATA.lessons.find(c=>c.id==='calculated').path.tr,/Nakliye → Sütunlar/);assert.match(GUIDE,/selector='#shipColsBtn'/);
  assert.match(DATA.lessons.find(c=>c.id==='new-model').path.en,/PLM SYNC/);
});
test('after initial data arrives the 120-second deadline does not show a misleading Retry',()=>{
  const h=guardHarness();h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');
  const g=h.nodes.get('blBootGuard');[...h.timers.values()].find(t=>t.ms===120000).fn();
  assert.equal(g.dataset.failed,undefined);assert.ok(!g.querySelector(".blBootCard").children.some(c=>c.dataset.bootRetry));
  // A real stall still ends with a bounded Retry.
  [...h.timers.values()].find(t=>t.ms===180000).fn();assert.equal(g.dataset.failed,'1');
  h.profile();readyAll(h,['ui','modules']);assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
});
test('the profile gate script is requested with the initial data, not after the whole deferred UI group',()=>{
  const PERF=read('perf-runtime.js');const src='user-access-ui.js?rev=APP-UPDATE-V3';
  assert.ok(PERF.includes(`'${src}'`),'deferredUi and the early load must use the same key');
  const boot=APP.slice(APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {"));
  const early=boot.indexOf(`_loadScript?.('${src}')`);
  assert.ok(early>0&&early<boot.indexOf('await loadInitialBuyerLogData()'));
});
