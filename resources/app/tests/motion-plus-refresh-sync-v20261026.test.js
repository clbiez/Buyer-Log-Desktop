'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'..','public');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');

function harness({reduced=false,hidden=false,off=false}={}){
  const animations=[],observers=new Map(),listeners={};
  function el(id){
    const classes=new Set();
    const icon={
      isConnected:true,hidden:false,closest:()=>null,
      getBoundingClientRect:()=>({left:10,top:10,right:40,bottom:40,width:30,height:30}),
      animate(frames,options){
        const entry={id,frames,options,cancelled:false};
        animations.push(entry);
        return {cancel(){entry.cancelled=true;},addEventListener(){}};
      }
    };
    return {id,classList:{contains:name=>classes.has(name)},setClass(name,on){
      if(on)classes.add(name);else classes.delete(name);
      observers.get(id)?.();
    },querySelector:()=>icon,icon};
  }
  const controls=Object.fromEntries(
    ['topRefreshBtn','serverRefreshBtn','syncStatusBadge','cpRefreshBtn','ordersRefreshBtn','cpPlmSyncBtn'].map(id=>[id,el(id)])
  );
  const doc={
    documentElement:{dataset:{blMotion:off?'off':'on'}},
    body:{dataset:{activeTab:'cp'}},
    visibilityState:hidden?'hidden':'visible',readyState:'complete',
    getElementById:id=>controls[id]||null,
    querySelector:selector=>selector==='main > section.active'?{
      isConnected:true,hidden:false,closest:()=>null,
      getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600,width:800,height:600}),
      querySelector:()=>null,querySelectorAll:()=>[]
    }:null,querySelectorAll:()=>[],
    addEventListener:(name,handler)=>{listeners[name]=handler;}
  };
  const root={
    document:doc,innerWidth:1200,innerHeight:800,
    matchMedia:()=>({matches:reduced,addEventListener(){}}),
    getComputedStyle:()=>({getPropertyValue:()=>''}),
    setTimeout:()=>1,clearTimeout(){},addEventListener(){},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(element){observers.set(element.id,this.fn);}}
  };
  vm.runInNewContext(read('motion-plus.js'),{window:root});
  function click(id){
    const control=controls[id];
    listeners.click({target:{closest:selector=>
      selector.includes('#'+id)?control:null}});
  }
  return {root,doc,controls,animations,click,listeners,
    changeTab(name){doc.body.dataset.activeTab=name;observers.get(undefined)?.();},
    visibility(state){doc.visibilityState=state;listeners.visibilitychange?.();}
  };
}

test('one-shot refresh feedback and sync pulse retain finite Motion+ durations',()=>{
  const h=harness();
  h.click('cpRefreshBtn');
  h.click('cpPlmSyncBtn');
  assert.equal(h.animations.length,2);
  assert.equal(h.animations[0].id,'cpRefreshBtn');
  assert.equal(h.animations[0].frames.at(-1).transform,'rotate(360deg)');
  assert.equal(h.animations[1].id,'cpPlmSyncBtn');
  assert.equal(h.animations[1].frames[1].opacity,.48);
  assert.ok(h.animations.every(a=>Number.isFinite(a.options.iterations)&&a.options.iterations<=8));
});
test('active refresh rotates indefinitely and stops only when busy state clears',()=>{
  const h=harness(),{topRefreshBtn,serverRefreshBtn,cpRefreshBtn,ordersRefreshBtn,syncStatusBadge}=h.controls;
  topRefreshBtn.setClass('spinning',true);
  serverRefreshBtn.setClass('spinning',true);
  cpRefreshBtn.setClass('spinning',true);
  ordersRefreshBtn.setClass('spinning',true);
  syncStatusBadge.setClass('is-syncing',true);
  assert.equal(h.animations.length,5);
  assert.ok(h.animations.slice(0,4).every(a=>a.options.iterations===Infinity));
  assert.equal(h.animations[4].options.iterations,8);
  topRefreshBtn.setClass('spinning',false);
  assert.equal(h.animations[0].cancelled,true);
  assert.equal(h.animations[1].cancelled,false);
  serverRefreshBtn.setClass('spinning',false);
  cpRefreshBtn.setClass('spinning',false);
  ordersRefreshBtn.setClass('spinning',false);
  syncStatusBadge.setClass('is-syncing',false);
  assert.ok(h.animations.every(x=>x.cancelled));
});
test('busy refresh resumes after a tab change and visibility restoration',()=>{
  const h=harness(),button=h.controls.topRefreshBtn;
  button.setClass('spinning',true);
  const first=h.animations.at(-1);
  h.changeTab('orders');
  assert.equal(first.cancelled,true);
  const second=h.animations.at(-1);
  assert.notEqual(second,first);
  assert.equal(second.options.iterations,Infinity);
  h.visibility('hidden');
  assert.equal(second.cancelled,true);
  h.visibility('visible');
  const third=h.animations.at(-1);
  assert.notEqual(third,second);
  assert.equal(third.options.iterations,Infinity);
  button.setClass('spinning',false);
  assert.equal(third.cancelled,true);
});
test('no action animation with reduced motion, hidden tab, or opt-out',()=>{
  for(const opt of [{reduced:true},{hidden:true},{off:true}]){
    const h=harness(opt);
    h.click('cpRefreshBtn');
    h.click('cpPlmSyncBtn');
    h.controls.syncStatusBadge.setClass('is-syncing',true);
    h.controls.topRefreshBtn.setClass('spinning',true);
    assert.equal(h.animations.length,0,JSON.stringify(opt));
  }
});
test('only real refresh activity may loop; other controls remain finite',()=>{
  const script=read('motion-plus.js'),css=read('ui-motion.css'),components=read('app.css');
  assert.match(script,/REFRESH_CONTROLS/);
  assert.match(script,/SYNC_CONTROLS/);
  assert.match(script,/syncStatusBadge','is-syncing','sync'/);
  assert.match(components,/\[data-plm-sync-category\]\) \.ic\{transform-origin:center/);
  assert.match(script,/iterations:kind==='refresh-active'\?Infinity:2/);
  assert.doesNotMatch(script,/setInterval\(/);
  assert.doesNotMatch(css,/animation:[^;]*infinite/);
});
