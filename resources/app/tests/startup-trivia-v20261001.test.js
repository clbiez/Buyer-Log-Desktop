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
  const win={BLTriviaData:DATA,localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))}};
  vm.runInNewContext(TRIVIA,{window:win});
  return {win,storage};
}

test('the trivia archive is large, bilingual, unique and spread over every category',()=>{
  assert.ok(DATA.items.length>=150,`only ${DATA.items.length} facts`);
  const ids=new Set(),cats=new Set(DATA.categories.map(c=>c.id)),tones=new Set(['acc','green','orange','red','teal','purple']);
  for(const c of DATA.categories){assert.ok(tones.has(c.tone),c.id);assert.ok(c.label.tr&&c.label.en,c.id);}
  for(const item of DATA.items){
    assert.ok(!ids.has(item.id),item.id);ids.add(item.id);
    assert.ok(cats.has(item.category),item.id);assert.ok(item.icon,item.id);
    for(const l of ['tr','en']){assert.ok(item.title[l]&&item.title[l].length<=80,item.id+' title '+l);assert.ok(item.text[l]&&item.text[l].length>=40&&item.text[l].length<=320,item.id+' text '+l);}
  }
  for(const c of cats)assert.ok(DATA.items.filter(i=>i.category===c).length>=10,c);
});

test('cards render escaped local SVG art with no remote assets or script',()=>{
  const {win}=triviaHarness();
  for(const item of DATA.items){
    const html=win.BLTrivia.render(item,'tr');
    assert.match(html,/<svg viewBox="0 0 520 260"/);assert.doesNotMatch(html,/<img|<script|https?:\/\/(?!www\.w3)/);assert.doesNotMatch(html,/NaN|undefined/,item.id);
  }
  const hostile={...DATA.items[0],id:'x',title:{tr:'<script>alert(1)</script>',en:'x'},icon:'<b>'};
  const html=win.BLTrivia.render(hostile,'tr');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<b>'));
  assert.match(win.BLTrivia.render(DATA.items[0],'en'),/Archive № 001/);assert.match(win.BLTrivia.render(DATA.items[0],'en'),/>Space</);
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
      querySelector(sel){if(!children.has(sel)){const c=el();c.isButton=/data-trivia-(prev|next|pause)/.test(sel);children.set(sel,c);}return children.get(sel);}};
    return e;
  }
  return {doc,host:el()};
}
function engine(storage=new Map()){
  const timers=[];
  const win={BLTriviaData:DATA,localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))}};
  vm.runInNewContext(TRIVIA,{window:win,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}});
  return {win,storage,timers};
}

test('every fact is shown exactly once before any repeats, and a new round starts only after the whole archive',()=>{
  const {win,storage}=engine();const seen=new Set();let prev='';let sameCategory=0;
  for(let i=0;i<DATA.items.length;i++){const item=win.BLTrivia.nextUnseen(prev);assert.ok(!seen.has(item.id),`repeat ${item.id} at ${i}`);seen.add(item.id);if(item.category===prev)sameCategory++;prev=item.category;}
  assert.equal(seen.size,DATA.items.length);assert.ok(sameCategory<=3,`${sameCategory} back-to-back categories`);
  assert.equal(win.BLTrivia.seenCount(),DATA.items.length);
  win.BLTrivia.nextUnseen(prev);assert.equal(JSON.parse(storage.get('bl.trivia.seen.v1')).length,1,'new round restarts the list');
});

test('seen facts persist across startups and windows sharing the device storage',()=>{
  const storage=new Map();const first=engine(storage),ids=new Set();
  for(let i=0;i<40;i++)ids.add(first.win.BLTrivia.nextUnseen().id);
  const second=engine(storage);for(let i=0;i<DATA.items.length-40;i++)assert.ok(!ids.has(second.win.BLTrivia.nextUnseen().id));
});

test('blocked storage still never repeats within the session',()=>{
  const win={BLTriviaData:DATA,localStorage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}};
  vm.runInNewContext(TRIVIA,{window:win,setInterval(){},clearInterval(){},setTimeout(){}});
  const ids=new Set();for(let i=0;i<DATA.items.length;i++)ids.add(win.BLTrivia.nextUnseen().id);assert.equal(ids.size,DATA.items.length);
});

test('the card component navigates history, pauses while read, and auto-advances only to unseen facts',()=>{
  const {win,timers}=engine(),{doc,host}=fakeDom();
  const ctl=win.BLTrivia.mount(host,{lang:()=>'tr'});const first=ctl.current();
  const next=host.querySelector('[data-trivia-next]'),prev=host.querySelector('[data-trivia-prev]'),pause=host.querySelector('[data-trivia-pause]');
  assert.equal(prev.disabled,true);assert.match(host.querySelector('[data-trivia-seen]').textContent,/^1 \/ \d+ bilgi görüldü$/);
  next.click();const second=ctl.current();assert.notEqual(second.id,first.id);
  prev.click();assert.equal(ctl.current().id,first.id,'Previous returns to the same fact');
  next.click();assert.equal(ctl.current().id,second.id,'Next walks forward through history before picking new facts');
  assert.equal(win.BLTrivia.seenCount(),2,'revisiting history does not consume new facts');
  const tick=timers[0];host.querySelector('.blTriviaCard').hovered=true;for(let i=0;i<200;i++)tick();assert.equal(ctl.current().id,second.id,'hover pauses');
  host.querySelector('.blTriviaCard').hovered=false;pause.click();for(let i=0;i<200;i++)tick();assert.equal(ctl.current().id,second.id,'pause button pauses');
  pause.click();for(let i=0;i<100;i++)tick();assert.notEqual(ctl.current().id,second.id,'auto-advance resumes');assert.equal(win.BLTrivia.seenCount(),3);
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

test('page loading states get a delayed trivia panel, but compact and dialog indicators are left alone',()=>{
  const delayed=[];const added=[];
  const win={BLTriviaData:DATA,localStorage:{getItem:()=>null,setItem(){}},MutationObserver:class{constructor(fn){this.fn=fn;}observe(){}},
    document:{readyState:'complete',body:null,addEventListener(){},createElement:()=>{const p=fakeDom().host;added.push(p);return p;}}};
  function state(opts){return {isConnected:true,dataset:{},classList:{list:new Set(['uiState','uiState--loading']),contains(c){return this.list.has(c);},add(c){this.list.add(c);}},
    closest:sel=>opts.excluded&&sel.includes(opts.excluded)?{}:null,parentElement:{getBoundingClientRect:()=>({width:opts.width})},getClientRects:()=>[{}],
    querySelector:()=>null,appendChild(child){this.child=child;},matches:sel=>sel==='.uiState--loading'};}
  vm.runInNewContext(TRIVIA,{window:win,setInterval:()=>1,clearInterval(){},setTimeout:(fn,ms)=>{delayed.push({fn,ms});}});
  const wide=state({width:1100}),narrow=state({width:300}),inDialog=state({width:1100,excluded:'dialog'});
  const scan=s=>{const body={nodeType:1,matches:()=>false,querySelectorAll:()=>[s]};win.document.body=body;win.BLTrivia.watchLoadingStates();};
  [wide,narrow,inDialog].forEach(scan);
  assert.ok(delayed.every(d=>d.ms>=500),'quick loads never flash a card');delayed.forEach(d=>d.fn());
  assert.ok(wide.child);assert.ok(wide.classList.contains('hasTrivia'));assert.ok(!narrow.child);assert.ok(!inDialog.child);
});

test('trivia scripts load before the guide and motion respects reduced-motion',()=>{
  const at=name=>INDEX.indexOf(name);
  assert.ok(at('buyerlog-trivia-data.js')>0&&at('buyerlog-trivia-data.js')<at('buyerlog-trivia.js')&&at('buyerlog-trivia.js')<at('buyerlog-guide.js?'));
  assert.match(CSS,/@media\(prefers-reduced-motion:reduce\)\{\.blTriviaVisual,\.blTriviaVisual \*/);
  assert.doesNotMatch(TRIVIA,/fetch\(|XMLHttpRequest|https?:\/\//);
});
