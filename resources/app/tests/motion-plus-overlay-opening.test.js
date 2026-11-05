'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/motion-plus.js'),'utf8');

function harness({reduced=false,off=false}={}){
  const calls=[],listeners={},frames=new Map(),timers=new Map(),nodes=[];let id=0;
  function node(parent=null){
    const el={hidden:true,isConnected:true,parentElement:parent,style:{},animations:[],
      contains(other){return other===this||other?.parentElement&&this.contains(other.parentElement);},
      closest(){return this.hidden||parent?.hidden?this:null;},
      getBoundingClientRect:()=>({left:10,top:10,right:110,bottom:110,width:100,height:100}),
      getAnimations({subtree=false}={}){return nodes.filter(n=>n===this||subtree&&this.contains(n)).flatMap(n=>n.animations);},
      animate(keyframes,options){
        const handlers={};
        const a={effect:{target:this},playState:'running',id:'',addEventListener(type,fn){handlers[type]=fn;},
          cancel(){this.playState='idle';el.animations=el.animations.filter(x=>x!==this);handlers.cancel?.();}};
        this.animations.push(a);calls.push({el,keyframes,options,a});return a;
      }
    };nodes.push(el);return el;
  }
  const doc={documentElement:{dataset:{blMotion:off?'off':'on'}},body:{dataset:{activeTab:'cp'}},
    readyState:'complete',visibilityState:'visible',querySelector:()=>null,
    querySelectorAll:()=>nodes.filter(n=>!n.hidden),
    addEventListener(type,fn){(listeners[type]||=[]).push(fn);}};
  const root={document:doc,innerWidth:1200,innerHeight:800,matchMedia:()=>({matches:reduced,addEventListener(){}}),
    getComputedStyle:el=>({transform:el.style?.transform||'none',getPropertyValue:()=>''}),addEventListener(){},
    requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,{window:root});
  function click(action=()=>{}){
    const target={closest:selector=>selector==='button,[role="button"]'?target:null};
    listeners.click.forEach(fn=>fn({target}));action();
  }
  function paint(){for(const [id,fn] of [...frames]){frames.delete(id);fn();}}
  function flushTimers(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}
  return {root,doc,node,calls,click,paint,flushTimers};
}

test('new menus animate before the first paint, once even with delegated clicks',()=>{
  const h=harness(),menu=h.node();
  h.click(()=>h.click(()=>menu.hidden=false));h.paint();
  assert.equal(h.calls.length,1,'one entrance at the first rendering opportunity');
  h.flushTimers();assert.equal(h.calls.length,1,'no delayed second entrance');
});

test('clicking inside an already open menu never replays its entrance',()=>{
  const h=harness(),menu=h.node();menu.hidden=false;
  h.click();h.paint();h.flushTimers();
  assert.equal(h.calls.length,0);
});

test('fast close/reopen gets a fresh entrance without a time-based throttle',()=>{
  const h=harness(),menu=h.node();h.click(()=>menu.hidden=false);h.paint();h.flushTimers();
  h.click(()=>menu.hidden=true);h.paint();
  assert.equal(h.calls[0].a.playState,'idle','closing cancels the unfinished entrance');
  h.click(()=>menu.hidden=false);h.paint();h.flushTimers();assert.equal(h.calls.length,2);
  h.click(()=>menu.hidden=true);h.click(()=>menu.hidden=false);h.paint();
  assert.equal(h.calls.length,3,'close/reopen within a frame cancels the previous entrance');
});

test('explicit drawer/overlay and CSS entrances own the surface without a fallback',()=>{
  for(const kind of ['drawer','overlay']){
    const h=harness(),menu=h.node();
    h.click(()=>{menu.hidden=false;h.root.BLMotionPlus.play(kind,menu);});h.paint();h.flushTimers();
    assert.equal(h.calls.length,1,kind);
    h.root.BLMotionPlus.play(kind,menu);assert.equal(h.calls.length,1,'an in-flight entrance is not restarted');
  }
  const h=harness(),overlay=h.node(),card=h.node(overlay);
  h.click(()=>{overlay.hidden=card.hidden=false;card.animations.push({animationName:'blMotionOverlay'});});
  h.paint();h.flushTimers();assert.equal(h.calls.length,0,'CSS entrance on a child owns its overlay');
});

test('a nested dialog gets one entrance and never moves an already open parent',()=>{
  const h=harness(),parent=h.node(),child=h.node(parent);parent.hidden=false;
  h.click(()=>child.hidden=false);h.paint();h.flushTimers();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].el,child);
  const other=harness(),outer=other.node(),inner=other.node(outer);
  other.click(()=>{outer.hidden=inner.hidden=false;});other.paint();other.flushTimers();
  assert.equal(other.calls.length,1,'a newly opened nested surface has one moving ancestor');
});

test('opening preserves a menu placement transform and respects motion guards',()=>{
  const h=harness(),menu=h.node();menu.style.transform='matrix(1, 0, 0, 1, -120, 0)';
  h.click(()=>menu.hidden=false);h.paint();h.flushTimers();
  assert.ok(h.calls[0].keyframes.every(frame=>frame.transform.startsWith(menu.style.transform)));
  for(const options of [{reduced:true},{off:true}]){
    const h=harness(options),menu=h.node();h.click(()=>menu.hidden=false);h.paint();h.flushTimers();assert.equal(h.calls.length,0);
  }
  const hidden=harness(),closed=hidden.node();hidden.click(()=>closed.hidden=false);hidden.doc.visibilityState='hidden';
  hidden.paint();hidden.flushTimers();assert.equal(hidden.calls.length,0);
  const disabled=harness(),pending=disabled.node();disabled.click(()=>pending.hidden=false);
  disabled.root.BLMotionPlus.setEnabled(false);disabled.paint();assert.equal(disabled.calls.length,0);
});
