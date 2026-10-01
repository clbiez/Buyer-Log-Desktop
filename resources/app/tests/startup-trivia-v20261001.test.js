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

test('a deck covers the whole archive, avoids back-to-back categories and shows unseen facts first',()=>{
  const {win,storage}=triviaHarness();
  const deck=win.BLTrivia.deck();assert.equal(deck.length,DATA.items.length);assert.equal(new Set(deck.map(i=>i.id)).size,DATA.items.length);
  const repeats=deck.slice(1).filter((item,i)=>item.category===deck[i].category).length;assert.ok(repeats<=2,`${repeats} repeats`);
  const seen=deck.slice(0,20).map(i=>i.id);seen.forEach(id=>win.BLTrivia.markSeen(id));
  const next=win.BLTrivia.deck();assert.ok(next.slice(0,DATA.items.length-20).every(i=>!seen.includes(i.id)));
  DATA.items.forEach(i=>win.BLTrivia.markSeen(i.id));assert.equal(JSON.parse(storage.get('bl.trivia.seen.v1')).length,1);
});

test('blocked storage never breaks the deck',()=>{
  const win={BLTriviaData:DATA,localStorage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}};
  vm.runInNewContext(TRIVIA,{window:win});
  assert.equal(win.BLTrivia.deck().length,DATA.items.length);assert.doesNotThrow(()=>win.BLTrivia.markSeen(DATA.items[0].id));
});

test('the startup curtain shows trivia, while the F1 guide keeps the how-to lessons',()=>{
  const {win}=triviaHarness();win.BLGuideData=GUIDE_DATA;win.addEventListener=()=>{};
  const timers=[],doc={documentElement:{lang:'tr'},addEventListener(){},getElementById:()=>null};
  vm.runInNewContext(GUIDE,{window:win,document:doc,setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}});
  let html='',heading='',mounted=false;
  const tip={matches:()=>false,set innerHTML(v){html=v;}},count={textContent:''},pause={setAttribute(){},addEventListener(){},textContent:''};
  const root={isConnected:true,classList:{add(){}},contains:()=>false,querySelector:s=>{
    if(s==='.blBootCard')return {insertAdjacentHTML(_,markup){if(markup.includes('blBootTipHeading')){mounted=true;heading=markup;}}};
    if(s==='[data-boot-tip]')return mounted?tip:null;if(s==='[data-tip-count]')return count;if(s==='[data-tip-pause]')return pause;return {addEventListener(){}};}};
  win.BLGuide.mountStartup(root);
  assert.match(heading,/BİLİYOR MUYDUNUZ\?/);assert.match(html,/blTriviaVisual/);assert.match(count.textContent,new RegExp(`^1 / ${DATA.items.length}$`));
  const first=html;timers[0]();assert.notEqual(html,first);assert.match(html,/blTriviaVisual/);
  assert.equal(win.BLGuide.available().length,GUIDE_DATA.lessons.filter(c=>!c.areas.length&&!c.capability).length);
});

test('trivia scripts load before the guide and motion respects reduced-motion',()=>{
  const at=name=>INDEX.indexOf(name);
  assert.ok(at('buyerlog-trivia-data.js')>0&&at('buyerlog-trivia-data.js')<at('buyerlog-trivia.js')&&at('buyerlog-trivia.js')<at('buyerlog-guide.js?'));
  assert.match(CSS,/@media\(prefers-reduced-motion:reduce\)\{\.blTriviaVisual,\.blTriviaVisual \*/);
  assert.doesNotMatch(TRIVIA,/fetch\(|XMLHttpRequest|https?:\/\//);
});
