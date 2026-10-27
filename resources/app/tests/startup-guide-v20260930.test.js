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
// Continue fades the curtain out, then removes it.
function finishFade(h){const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.leaving,'1');assert.equal(g.isConnected,true);for(const [id,t] of [...h.timers])if(t.ms===340){h.timers.delete(id);t.fn();}}
function guardHarness(search=''){
  const listeners={},nodes=new Map(),timers=new Map();let tick=0,stops=0,reloads=0;
  function node(id=''){
    const n={id,textContent:'',dataset:{},style:{},isConnected:true,children:[],classList:{add(){},contains(){return false;}},setAttribute(){},getClientRects(){return [{}];},focus(){doc.activeElement=n;},contains(o){return o===n||n.children.includes(o);},appendChild(c){n.children.push(c);},remove(){n.isConnected=false;nodes.delete(n.id);}};
    n.querySelector=selector=>{if(selector==='[data-boot-message]'||selector==='[data-boot-hint]')return n.message||(n.message=node());if(selector==='.blBootCard')return n.card||(n.card=node());if(selector==='[data-boot-retry]')return n.children.find(c=>c.dataset.bootRetry);if(selector==='.blBootOrb')return n.canvas||(n.canvas=node());return null;};
    n.querySelectorAll=()=>n.children;
    return n;
  }
  const doc={readyState:'loading',activeElement:null,body:node(),documentElement:node(),getElementById:id=>nodes.get(id)||null,createElement:()=>node(),addEventListener:(name,fn)=>{(listeners['doc:'+name]??=[]).push(fn);}};
  doc.body.appendChild=el=>{nodes.set(el.id,el);};
  const win={addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);},dispatchEvent:ev=>{for(const fn of listeners[ev.type]||[])fn(ev);},BLThinkingOrbBreathing:{attach:()=>({stop(){stops++;}})},BLGuide:{mountStartup(){},stage(){}}};
  const context=vm.createContext({window:win,document:doc,URLSearchParams,console:{error(){}},sessionStorage:{removeItem(){},getItem(){return null;},setItem(){}},location:{search,replace(){reloads++;}},fetch:async()=>({ok:true,json:async()=>({app:'Buyer Log'})}),AbortSignal:{timeout(){}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout:(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const script=INDEX.slice(INDEX.indexOf('<script>\n(function(){')+8,INDEX.indexOf('</script>',INDEX.indexOf('<script>\n(function(){')));
  vm.runInContext(script,context);
  win.BLBootGuard.mount();
  return {win,doc,nodes,timers,listeners,get stops(){return stops;},get reloads(){return reloads;},profile(){nodes.set('currentUserInitials',{textContent:'AB'});nodes.set('accessModeBadge',{textContent:'Buyer'});win.dispatchEvent({type:'bl:user-access-applied',detail:{id:'sample',displayName:'Example User'}});}};
}
function guideHarness(profile=null){
  const events={},timers=[];
  const win={BLGuideData:DATA,BL_USER_CONTEXT:profile,addEventListener:(name,fn)=>{(events[name]??=[]).push(fn);}};
  const doc={documentElement:{lang:'tr'},addEventListener:(name,fn,options)=>{(events['doc:'+name]??=[]).push({fn,options});},getElementById:()=>null};
  vm.runInNewContext(GUIDE,{window:win,document:doc,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}});
  return {win,doc,events,timers};
}
test('core markup and data wait for the authenticated profile but not a slow page projection',()=>{
  const h=guardHarness();h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');
  assert.ok(h.nodes.has('blBootGuard'));assert.equal(h.nodes.get('blBootGuard').dataset.ready,undefined);
  h.profile();assert.equal(h.stops,1);assert.equal(h.timers.size,0);
  // A delayed Overview/CP/Orders projection is no longer a hard startup gate.
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');assert.equal(g.message.textContent,'Buyer Log hazır');
  h.win.BLBootGuard.ready('ui');assert.equal(g.dataset.ready,'1');
  const button=g.card.children.find(c=>c.dataset.bootContinue);assert.ok(button);assert.equal(h.doc.activeElement,button);
  let completed=0;h.win.addEventListener('bl:startup-complete',()=>completed++);assert.equal(completed,0);
  button.onclick();assert.equal(completed,1);finishFade(h);assert.ok(!h.nodes.has('blBootGuard'));
  h.win.BLBootGuard.continue();assert.equal(completed,1,'a second Continue during the fade is ignored');
});
test('background startup tabs dismiss their curtain only after core, data and authenticated profile',()=>{
  const h=guardHarness('?module=orders&startupWarm=1');
  h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');
  assert.equal(h.nodes.get('blBootGuard').dataset.leaving,undefined);
  h.profile();assert.equal(h.nodes.get('blBootGuard').dataset.leaving,'1');
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
test('hard startup gates work regardless of arrival order and UI readiness is informational',()=>{
  for(const order of [['profile','data','core'],['core','profile','data'],['data','core','profile']]){
    const h=guardHarness();
    h.win.BLBootGuard.ready('ui');assert.equal(h.nodes.get('blBootGuard').dataset.ready,undefined);
    order.forEach((key,i)=>{if(key==='profile')h.profile();else h.win.BLBootGuard.ready(key==='core'?undefined:key);assert.equal(h.nodes.get('blBootGuard').dataset.ready,i<2?undefined:'1');});
    h.win.BLBootGuard.ready('ui');h.win.BLBootGuard.ready();assert.equal(h.stops,1,'startup orb stops once after all hard gates finish');
    assert.equal(h.nodes.get('blBootGuard').card.children.filter(c=>c.dataset.bootContinue).length,1);h.win.BLBootGuard.continue();finishFade(h);assert.ok(!h.nodes.has('blBootGuard'));
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
  const h=guardHarness();[...h.timers.values()].find(t=>t.ms===120000).fn();h.profile();['core','data','ui'].forEach(k=>h.win.BLBootGuard.ready(k));
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);h.win.BLBootGuard.continue();finishFade(h);assert.ok(!h.nodes.has('blBootGuard'));assert.equal(h.reloads,0);
});
test('a late page-projection failure cannot regress an already ready shell',()=>{
  const h=guardHarness();h.win.BLBootGuard.ready();h.win.BLBootGuard.ready('data');h.profile();
  const g=h.nodes.get('blBootGuard');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
  h.win.BLBootGuard.fail('initial-screen-failed');assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
});
test('recovery response cannot reload an already-ready app',async()=>{
  const h=guardHarness();const recovering=h.win.BLBootGuard.recover('missing-core');h.profile();['core','data','ui'].forEach(k=>h.win.BLBootGuard.ready(k));await recovering;assert.equal(h.reloads,0);
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
  const bodyAt=INDEX.indexOf('<body'),mountAt=INDEX.indexOf('<script>window.BLBootGuard?.mount();</script>');
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
  h.profile();assert.equal(g.dataset.ready,'1');assert.equal(g.dataset.failed,undefined);
});
test('the profile gate script is requested with the initial data, not after the whole deferred UI group',()=>{
  const PERF=read('perf-runtime.js');const src='user-access-ui.js?rev=APP-UPDATE-V3';
  assert.ok(PERF.includes(`'${src}'`),'deferredUi and the early load must use the same key');
  const boot=APP.slice(APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {"));
  const early=boot.indexOf(`_loadScript?.('${src}')`);
  assert.ok(early>0&&early<boot.indexOf('await loadInitialBuyerLogData()'));
});
