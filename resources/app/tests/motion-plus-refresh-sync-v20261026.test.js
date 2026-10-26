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
    ['topRefreshBtn','serverRefreshBtn','syncStatusBadge','cpRefreshBtn','cpPlmSyncBtn'].map(id=>[id,el(id)])
  );
  const doc={
    documentElement:{dataset:{blMotion:off?'off':'on'}},
    body:{dataset:{activeTab:'cp'}},
    visibilityState:hidden?'hidden':'visible',readyState:'complete',
    getElementById:id=>controls[id]||null,
    querySelector:()=>null,querySelectorAll:()=>[],
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
  return {root,doc,controls,animations,click,listeners};
}

test('7.0.294 refresh rotation and sync pulse return through shared finite Motion+',()=>{
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
test('busy state is animated on entrance and stopped when actual status clears',()=>{
  const h=harness(),{topRefreshBtn,syncStatusBadge}=h.controls;
  topRefreshBtn.setClass('spinning',true);
  syncStatusBadge.setClass('is-syncing',true);
  assert.equal(h.animations.length,2);
  assert.equal(h.animations[0].options.iterations,8);
  assert.equal(h.animations[1].options.iterations,8);
  topRefreshBtn.setClass('spinning',false);
  syncStatusBadge.setClass('is-syncing',false);
  assert.ok(h.animations.every(x=>x.cancelled));
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
test('control feedback keeps finite timings, theme tokens and no independent keyframe loop',()=>{
  const script=read('motion-plus.js'),css=read('ui-motion.css'),components=read('app.css');
  assert.match(script,/REFRESH_CONTROLS/);
  assert.match(script,/SYNC_CONTROLS/);
  assert.match(script,/syncStatusBadge','is-syncing','sync'/);
  assert.match(components,/\[data-plm-sync-category\]\) \.ic\{transform-origin:center/);
  assert.doesNotMatch(script,/setInterval\(|iterations\s*:\s*Infinity/);
  assert.doesNotMatch(css,/animation:[^;]*infinite/);
});
