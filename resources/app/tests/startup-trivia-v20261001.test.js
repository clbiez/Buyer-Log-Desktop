'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(ROOT,'public',name),'utf8');
const INDEX=read('index.html'),GUIDE=read('buyerlog-guide.js'),TRIVIA=read('buyerlog-trivia.js'),CSS=read('buyerlog-guide.css');
const DATA=require('../public/buyerlog-trivia-data.js');
const GUIDE_DATA=require('../public/buyerlog-guide-data.js');

function triviaHarness(storage=new Map()){
  const win={BLTriviaData:structuredClone(DATA),localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))}};
  vm.runInNewContext(TRIVIA,{window:win});
  return {win,storage};
}

// Loads the core archive plus every listed pack exactly as the browser does.
function fullArchive(){
  const win={BLTriviaData:structuredClone(DATA)},context=vm.createContext({window:win});
  vm.runInContext(TRIVIA,context);
  for(const file of DATA.packs){assert.ok(fs.existsSync(path.join(ROOT,'public',file)),file+' missing');vm.runInContext(read(file),context);}
  return win.BLTriviaData;
}
test('the archive holds thousands of unique, bilingual facts spread over every category',()=>{
  const all=fullArchive();
  assert.ok(all.items.length>=2000,`only ${all.items.length} facts`);
  const ids=new Set(),cats=new Set(all.categories.map(c=>c.id)),tones=new Set(['acc','green','orange','red','teal','purple']);
  const titles=new Set();
  for(const c of all.categories){assert.ok(tones.has(c.tone),c.id);assert.ok(c.label.tr&&c.label.en,c.id);}
  for(const item of all.items){
    assert.ok(!ids.has(item.id),item.id);ids.add(item.id);
    assert.ok(cats.has(item.category),item.id);assert.ok(item.icon,item.id);
    for(const l of ['tr','en']){assert.ok(item.title[l]&&item.title[l].length<=90,item.id+' title '+l);assert.ok(item.text[l]&&item.text[l].length>=40&&item.text[l].length<=360,item.id+' text '+l);}
    const key=item.title.en.toLowerCase();assert.ok(!titles.has(key),'duplicate title: '+item.title.en);titles.add(key);
  }
  for(const c of cats)assert.ok(all.items.filter(i=>i.category===c).length>=30,c);
  // Pack rows never reach the page as markup: every rendered field is escaped.
  for(const file of DATA.packs)assert.doesNotMatch(read(file),/<script|https?:\/\//i,file);
});
test('packs load asynchronously and never block the curtain',()=>{
  assert.match(TRIVIA,/script\.async=true;/);assert.match(TRIVIA,/BL_ASSET_VERSION/);
  for(const file of DATA.packs)assert.doesNotMatch(INDEX,new RegExp(file.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')),'pack files are not parser-blocking in index.html');
});
test('seen ids of packs that have not loaded yet are preserved',()=>{
  const storage=new Map([['bl.trivia.seen.v1',JSON.stringify(['future-pack-id'])]]);
  const {win}=engine(storage);win.BLTrivia.nextUnseen();
  assert.ok(JSON.parse(storage.get('bl.trivia.seen.v1')).includes('future-pack-id'));
});

test('cards render escaped local SVG art with no remote assets or script',()=>{
  const {win}=triviaHarness();
  for(const item of DATA.items){
    const html=win.BLTrivia.render(item,'tr');
    assert.match(html,/<svg viewBox="0 0 520 260"/);assert.doesNotMatch(html,/<img|<script|https?:\/\/(?!www\.w3)/);assert.doesNotMatch(html,/NaN|undefined/,item.id);
  }
  const hostile={...DATA.items[0],id:'x',title:{tr:'<script>alert(1)</script>',en:'x'},icon:'<b>'};
  const html=win.BLTrivia.render(hostile,'tr');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<b>'));
  assert.doesNotMatch(win.BLTrivia.render(DATA.items[0],'en'),/Archive|Arşiv|№/,'no archive numbering hints at the archive size');assert.match(win.BLTrivia.render(DATA.items[0],'en'),/>Space</);
});

// Minimal DOM double: each selector maps to one stable fake element.
function fakeDom(){
  const doc={hidden:false,activeElement:null};
  function el(){
    const handlers={},children=new Map();
    const e={dataset:{},style:{},textContent:'',innerHTML:'',disabled:false,title:'',isConnected:true,ownerDocument:doc,attrs:{},hovered:false,
      classList:{add(){},contains(){return false;}},setAttribute(k,v){e.attrs[k]=String(v);},addEventListener(name,fn){(handlers[name]??=[]).push(fn);},
      click(){for(const fn of handlers.click||[])fn();},matches(sel){return sel===':hover'?e.hovered:sel==='button'?Boolean(e.isButton):false;},
      contains(o){return o===e||[...children.values()].includes(o);},
      appendChild(c){c.parent=e;},
      querySelector(sel){if(!children.has(sel)){const c=el();c.isButton=/data-trivia-(prev|next|pause)/.test(sel);children.set(sel,c);}return children.get(sel);}};
    return e;
  }
  return {doc,host:el()};
}
function engine(storage=new Map()){
  const timers=[];
  const win={BLTriviaData:structuredClone(DATA),localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))}};
  vm.runInNewContext(TRIVIA,{window:win,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}});
  return {win,storage,timers};
}

test('every fact is shown exactly once before any repeats, and a new round starts only after the whole archive',()=>{
  const {win,storage}=engine();const seen=new Set();let prev='';let sameCategory=0;
  for(let i=0;i<DATA.items.length;i++){const item=win.BLTrivia.nextUnseen(prev);assert.ok(!seen.has(item.id),`repeat ${item.id} at ${i}`);seen.add(item.id);if(item.category===prev)sameCategory++;prev=item.category;}
  assert.equal(seen.size,DATA.items.length);assert.ok(sameCategory<=3,`${sameCategory} back-to-back categories`);
  assert.equal(win.BLTrivia.readSeen().length,DATA.items.length);
  win.BLTrivia.nextUnseen(prev);assert.equal(JSON.parse(storage.get('bl.trivia.seen.v1')).length,1,'new round restarts the list');
});

test('seen facts persist across startups and windows sharing the device storage',()=>{
  const storage=new Map();const first=engine(storage),ids=new Set();
  for(let i=0;i<40;i++)ids.add(first.win.BLTrivia.nextUnseen().id);
  const second=engine(storage);for(let i=0;i<DATA.items.length-40;i++)assert.ok(!ids.has(second.win.BLTrivia.nextUnseen().id));
});

test('blocked storage still never repeats within the session',()=>{
  const win={BLTriviaData:structuredClone(DATA),localStorage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}};
  vm.runInNewContext(TRIVIA,{window:win,setInterval(){},clearInterval(){},setTimeout(){}});
  const ids=new Set();for(let i=0;i<DATA.items.length;i++)ids.add(win.BLTrivia.nextUnseen().id);assert.equal(ids.size,DATA.items.length);
});

test('the card component navigates history, pauses while read, and auto-advances only to unseen facts',()=>{
  const {win,timers}=engine(),{doc,host}=fakeDom();
  const ctl=win.BLTrivia.mount(host,{lang:()=>'tr'});const first=ctl.current();
  const next=host.querySelector('[data-trivia-next]'),prev=host.querySelector('[data-trivia-prev]'),pause=host.querySelector('[data-trivia-pause]');
  assert.equal(prev.disabled,true);assert.doesNotMatch(host.innerHTML,/data-trivia-seen|görüldü|seen/,'no seen/total counter is shown');
  next.click();const second=ctl.current();assert.notEqual(second.id,first.id);
  prev.click();assert.equal(ctl.current().id,first.id,'Previous returns to the same fact');
  next.click();assert.equal(ctl.current().id,second.id,'Next walks forward through history before picking new facts');
  assert.equal(win.BLTrivia.readSeen().length,2,'revisiting history does not consume new facts');
  const tick=timers[0];host.querySelector('.blTriviaCard').hovered=true;for(let i=0;i<200;i++)tick();assert.equal(ctl.current().id,second.id,'hover pauses');
  host.querySelector('.blTriviaCard').hovered=false;pause.click();for(let i=0;i<200;i++)tick();assert.equal(ctl.current().id,second.id,'pause button pauses');
  pause.click();for(let i=0;i<100;i++)tick();assert.notEqual(ctl.current().id,second.id,'auto-advance resumes');assert.equal(win.BLTrivia.readSeen().length,3);
  host.isConnected=false;const at=ctl.current().id;for(let i=0;i<200;i++)tick();assert.equal(ctl.current().id,at,'disconnected cards stop');
});

test('the startup curtain delegates to the trivia card, while the F1 guide keeps the how-to lessons',()=>{
  const {win}=engine();win.BLGuideData=GUIDE_DATA;win.addEventListener=()=>{};
  const calls=[];win.BLTrivia={...win.BLTrivia,mount:(host,options)=>{calls.push({host,options});return {refresh(){},destroy(){}};}};
  const doc={documentElement:{lang:'tr'},addEventListener(){},getElementById:()=>null};
  vm.runInNewContext(GUIDE,{window:win,document:doc,setInterval:()=>1,clearInterval(){},setTimeout(){}});
  let markup='',mounted=false;const tip={id:'tip'},handlers={};
  const root={isConnected:true,dataset:{},classList:{add(){}},contains:()=>false,querySelector:s=>{
    if(s==='.blBootCard')return {insertAdjacentHTML(_,html){markup+=html;if(html.includes('data-boot-tip'))mounted=true;}};
    if(s==='[data-boot-tip]')return mounted?tip:null;return {addEventListener(name,fn){handlers[s]=fn;}};}};
  win.BLGuide.mountStartup(root);
  assert.equal(calls.length,1);assert.equal(calls[0].host,tip);assert.equal(typeof calls[0].options.blocked,'function');
  assert.match(markup,/BİLİYOR MUYDUNUZ\?/);assert.match(markup,/data-boot-continue-slot/);assert.match(markup,/Devam düğmesi görünecek/);
  assert.doesNotMatch(markup,/data-tip-prev|data-tip-next/,'legacy footer arrows are gone in trivia mode');
  assert.equal(win.BLGuide.available().length,GUIDE_DATA.lessons.filter(c=>!c.areas.length&&!c.capability).length);
});

// Page loading simulation: fake clock, fake interval and a minimal section/state DOM.
function pageHarness(){
  let clock=1000;const intervals=new Map();let nextId=1;const timeouts=[],appended=[];
  const section={id:'view-orders',isConnected:true,visible:true,getClientRects(){return this.visible?[{}]:[];},getBoundingClientRect:()=>({top:60,left:200,bottom:900,right:1400,width:1200,height:840}),states:[],querySelectorAll(){return this.states.filter(s=>s.isConnected);}};
  function state(opts={}){const st={isConnected:true,dataset:{},children:[],visible:true,
    classList:{list:new Set(['uiState','uiState--loading']),contains(c){return this.list.has(c);},add(c){this.list.add(c);}},
    closest:sel=>sel.startsWith('section')?section:(opts.excluded&&sel.includes(opts.excluded)?{}:null),
    parentElement:{getBoundingClientRect:()=>({width:opts.width??1100})},getClientRects(){return st.visible?[{}]:[];},
    querySelector(sel){return sel==='.blTriviaPanel'?st.children.find(c=>c.className==='blTriviaPanel')||null:null;},
    appendChild(c){st.children.push(c);c.parent=st;},matches:sel=>sel==='.uiState--loading'};section.states.push(st);return st;}
  const document={readyState:'complete',head:{appendChild(script){script.onerror?.();}},body:{nodeType:1,matches:()=>false,querySelectorAll:()=>[],appendChild(el){appended.push(el);el.isConnected=true;}},addEventListener(){},
    getElementById:()=>null,querySelector:sel=>sel==='.rail [data-tab="orders"] span'?{textContent:'Siparişler'}:null,
    createElement:()=>{const e=fakeDom().host;e.className='';e.remove=()=>{e.isConnected=false;};e.appendChild=c=>{c.parent=e;};e.getClientRects=()=>[{}];return e;}};
  const win={BLTriviaData:structuredClone(DATA),localStorage:{getItem:()=>null,setItem(){}},MutationObserver:class{observe(){}},document,innerWidth:1600,innerHeight:1000,addEventListener(){},removeEventListener(){}};
  vm.runInNewContext(TRIVIA,{window:win,Date:{now:()=>clock},setInterval:fn=>{const id=nextId++;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);},setTimeout:(fn,ms)=>{timeouts.push({fn,ms,at:clock+ms});}});
  const api={win,section,state,appended,
    add(st){document.body.querySelectorAll=()=>[st];win.BLTrivia.watchLoadingStates();},
    advance(ms){const end=clock+ms;while(clock<end){clock+=100;for(const fn of [...intervals.values()])fn();for(const t of timeouts.splice(0))if(t.at<=clock)t.fn();else timeouts.push(t);}}};
  return api;
}
test('page loading states get a delayed trivia panel, but compact and dialog indicators are left alone',()=>{
  const h=pageHarness();const wide=h.state(),narrow=h.state({width:300}),inDialog=h.state({excluded:'dialog'});
  [wide,narrow,inDialog].forEach(st=>h.add(st));
  h.advance(300);assert.equal(wide.children.length,0,'quick loads never flash a card');
  h.advance(600);assert.equal(wide.children.length,1);assert.ok(wide.classList.contains('hasTrivia'));assert.equal(narrow.children.length,0);assert.equal(inDialog.children.length,0);
});
test('when a page finishes loading the card stays with a "Continue to <module>" button',()=>{
  const h=pageHarness();const st=h.state();h.add(st);h.advance(4000);
  const panel=st.children[0];assert.ok(panel);
  st.isConnected=false;h.advance(800);
  const hold=h.appended.find(e=>e.className==='blTriviaHold');assert.ok(hold,'hold overlay shown');
  assert.notEqual(panel.parent,st,'panel moved into the hold slot');
  assert.ok(String(hold.innerHTML).includes('Siparişler ekranına devam et'));assert.ok(String(hold.innerHTML).includes('Siparişler hazır'));
  hold.querySelector('[data-hold-continue]').click();assert.equal(hold.dataset.leaving,'1');
});
test('short loads and multi-stage loads do not force a Continue click',()=>{
  const quick=pageHarness();const a=quick.state();quick.add(a);quick.advance(1200);assert.equal(a.children.length,1);
  a.isConnected=false;quick.advance(800);assert.ok(!quick.appended.some(e=>e.className==='blTriviaHold'),'under 2.5s the card simply closes');
  const multi=pageHarness();const first=multi.state();multi.add(first);multi.advance(4000);const panel=first.children[0];
  first.isConnected=false;const second=multi.state();multi.add(second);multi.advance(800);
  assert.ok(second.children.includes(panel),'the same card moves on to the next loading step');assert.ok(!multi.appended.some(e=>e.className==='blTriviaHold'));
});
test('cards never mount under the startup curtain and hidden tabs do not consume facts',()=>{
  const h=pageHarness();h.win.document.getElementById=id=>id==='blBootGuard'?{}:null;const st=h.state();h.add(st);h.advance(3000);assert.equal(st.children.length,0);
  h.win.document.getElementById=()=>null;h.advance(800);assert.equal(st.children.length,1,'mounts once the curtain is gone');
  const src=TRIVIA;assert.match(src,/getClientRects&&!host\.getClientRects\(\)\.length/,'invisible cards do not tick');
});
test('preparing a native tab never adds a trivia Continue overlay before first activation',()=>{
  const h=pageHarness();h.win.BL_STARTUP_WARMING=true;const state=h.state();h.add(state);
  h.advance(4000);assert.equal(state.children.length,0);assert.equal(h.appended.length,0);
  h.win.BL_STARTUP_WARMING=false;h.advance(800);assert.equal(state.children.length,1);
});
test('LFL and Backlog show the shared loading state on first load instead of an unready screen',()=>{
  const LFL=read('lfl.js'),LFLCSS=read('lfl.css'),APP=read('app-main.js');
  assert.match(INDEX,/<section id="view-lfl"[^>]*>\s*<div id="lflLoadingState" class="lflLoadingState" hidden><\/div>/);
  assert.match(LFL,/BLUI\.renderState\(host,\{kind:'loading'/);assert.match(LFL,/if\(state\.initialized&&!state\.serverRows\.length\)setLoadingView\(true\);/);
  assert.match(LFL,/setLoadingView\(false\);\s*if\(state\.initialized\)\{fillControls\(\);render\(\);\}/,'loading view is lifted before the first render');
  assert.match(LFLCSS,/#view-lfl\.lflIsLoading>:not\(#lflLoadingState\)\{display:none!important\}/);
  assert.match(APP,/async function fetchBacklog\(params\)\{\s*backlogPrefetch=null;\s*showBacklogLoadingState\(\);/);
  assert.match(APP,/function applyBacklogData\(data\)\{\s*restoreBacklogEmptyState\(\);/);
  assert.match(APP,/window\.BLUI\.renderState\(empty,\{kind:'loading',title,detail\}\);else empty\.textContent=title;\s*empty\.style\.display='block';content\.style\.display='none';/);
});

test('startup Continue button centers its label consistently',()=>{
  assert.match(CSS,/\.blBootContinue\{[^}]*display:inline-flex;[^}]*align-items:center;[^}]*justify-content:center;[^}]*text-align:center/); assert.match(require("./helpers/manifest-css").rules(/blBootContinue/),/line-height:1\.2/);
});

test('trivia scripts load before the guide and motion respects reduced-motion',()=>{
  const at=name=>INDEX.indexOf(name);
  assert.ok(at('buyerlog-trivia-data.js')>0&&at('buyerlog-trivia-data.js')<at('buyerlog-trivia.js')&&at('buyerlog-trivia.js')<at('buyerlog-guide.js?'));
  require('./helpers/manifest-css').assertStaticMotion();
  assert.doesNotMatch(TRIVIA,/fetch\(|XMLHttpRequest|https?:\/\//);
});
