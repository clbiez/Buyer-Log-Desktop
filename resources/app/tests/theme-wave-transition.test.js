'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/theme-transition.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function setup({reduced=false,supported=true}={}){
  const classes=new Set(),transitions=[],animations=[],listeners={};
  const motion={matches:reduced,addEventListener(type,fn){this.change=fn;}};
  const html={classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)},animate(frames,options){
    const done=deferred();
    const animation={frames,options,finished:done.promise,finish:done.resolve,cancel(){done.reject(new Error('cancelled'));}};
    animations.push(animation);return animation;
  }};
  const doc={documentElement:html,readyState:'complete',visibilityState:'visible',addEventListener(type,fn){listeners[type]=fn;}};
  if(supported)doc.startViewTransition=update=>{
    const ready=deferred(),done=deferred();
    const transition={ready:ready.promise,finished:done.promise,skipped:false,
      capture(){update();ready.resolve();},rejectCapture(){ready.reject(new Error('capture failed'));done.resolve();},
      finish:done.resolve,skipTransition(){this.skipped=true;done.resolve();}};
    transitions.push(transition);return transition;
  };
  const root={document:doc,matchMedia:()=>motion,getComputedStyle:()=>({getPropertyValue:key=>key==='--bl-motion-theme'?'1150ms':'cubic-bezier(.2,.75,.25,1)'})};
  vm.runInNewContext(source,{window:root});
  return{api:root.BLThemeTransition,doc,motion,classes,transitions,animations,listeners};
}

test('native snapshots reveal a full palette and release transient state',async()=>{
  const s=setup();let updates=0;
  assert.equal(s.api.start(()=>updates++),true);assert.equal(updates,0);
  s.transitions[0].capture();await settle();
  assert.equal(updates,1);assert.equal(s.animations.length,1);
  const a=s.animations[0];assert.equal(a.options.pseudoElement,'::view-transition-new(root)');
  assert.equal(a.options.duration,1150);assert.match(a.frames[0].clipPath,/-34%/);assert.match(a.frames.at(-1).clipPath,/136%/);
  a.finish();s.transitions[0].finish();await settle();
  assert.equal(s.classes.size,0);
});

test('rapid theme requests flush once and delayed callbacks cannot restore an older palette',async()=>{
  const s=setup(),applied=[];
  s.api.start(()=>applied.push('grey'));
  s.api.start(()=>applied.push('dark'));
  assert.equal(s.transitions[0].skipped,true);assert.deepEqual(applied,['grey']);
  s.transitions[1].capture();s.transitions[0].capture();await settle();
  assert.deepEqual(applied,['grey','dark']);assert.equal(s.animations.length,1);
  s.api.cancel();await settle();assert.equal(s.classes.size,0);
});

test('unsupported APIs, reduced motion and startup keep the existing immediate path',()=>{
  for(const opts of [{reduced:true},{supported:false},{}]){
    const s=setup(opts);if(!opts.reduced&&!Object.hasOwn(opts,'supported'))s.doc.readyState='loading';
    let updates=0;assert.equal(s.api.start(()=>updates++),false);assert.equal(updates,0);assert.equal(s.classes.size,0);
  }
});

test('snapshot and animation failures still apply the requested palette and clear state',async()=>{
  for(const phase of ['capture','animate','start']){
    const s=setup();let updates=0;
    if(phase==='start')s.doc.startViewTransition=()=>{throw new Error('unavailable');};
    const started=s.api.start(()=>updates++);
    if(phase==='start'){assert.equal(started,false);assert.equal(s.classes.size,0);continue;}
    if(phase==='capture')s.transitions[0].rejectCapture();
    else{s.transitions[0].capture();await settle();s.animations[0].cancel();}
    await settle();assert.equal(updates,1);assert.equal(s.classes.size,0);
  }
});

test('enabling reduced motion or hiding the window finishes a pending update once',async()=>{
  for(const event of ['motion','visibility']){
    const s=setup();let updates=0;s.api.start(()=>updates++);
    if(event==='motion'){s.motion.matches=true;s.motion.change({matches:true});}
    else{s.doc.visibilityState='hidden';s.listeners.visibilitychange();}
    s.transitions[0].capture();await settle();assert.equal(updates,1);assert.equal(s.transitions[0].skipped,true);assert.equal(s.classes.size,0);
  }
});
