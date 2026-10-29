'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../public/workspace-blur.js'),'utf8');

function setup(){
  const state={drawerOpen:false,drawerHidden:false,otherDialog:false};
  const frames=[],observers=[];
  let layer;
  const backdrop={
    hidden:false,
    closest:selector=>state.drawerHidden&&selector.includes('aria-hidden')?{}:null,
    getBoundingClientRect:()=>({width:900})
  };
  const dialog={
    hidden:false,
    closest:()=>null,
    getBoundingClientRect:()=>({width:600})
  };
  const document={
    body:{append:node=>{layer=node;}},
    documentElement:{dataset:{rail:''}},
    createElement:()=>({dataset:{},setAttribute(){}}),
    querySelectorAll:selector=>[
      // Closed drawers leave a backdrop mounted with nonzero dimensions.
      ...((state.drawerOpen||!selector.includes('.blDetailDrawer.is-open .blDetailDrawerBackdrop'))?[backdrop]:[]),
      ...(state.otherDialog?[dialog]:[])
    ],
    querySelector:()=>null,
    addEventListener:()=>{}
  };
  class MutationObserver{constructor(cb){observers.push(cb)}observe(){}}
  vm.runInNewContext(SOURCE,{
    document,MutationObserver,
    getComputedStyle:()=>({display:'block',visibility:'visible'}),
    requestAnimationFrame:cb=>frames.push(cb)
  });
  return {state,layer,tick(){observers.forEach(cb=>cb());for(const cb of frames.splice(0))cb();}};
}

test('Global Flow detail close restores sharp workspace on repeated cycles',()=>{
  const ui=setup();
  assert.equal(ui.layer.dataset.blur,'');
  ui.state.drawerOpen=true;ui.tick();assert.equal(ui.layer.dataset.blur,'dialog');
  ui.state.drawerOpen=false;ui.tick();assert.equal(ui.layer.dataset.blur,'');
  ui.state.drawerOpen=true;ui.tick();assert.equal(ui.layer.dataset.blur,'dialog');
  ui.state.drawerOpen=false;ui.tick();assert.equal(ui.layer.dataset.blur,'');
});

test('aria-hidden ancestor does not count as an active blur surface',()=>{
  const ui=setup();ui.state.drawerOpen=true;ui.state.drawerHidden=true;ui.tick();
  assert.equal(ui.layer.dataset.blur,'');
  ui.state.drawerHidden=false;ui.tick();assert.equal(ui.layer.dataset.blur,'dialog');
});

test('other visible dialog keeps workspace blur active after detail close',()=>{
  const ui=setup();ui.state.drawerOpen=true;ui.tick();
  ui.state.drawerOpen=false;ui.state.otherDialog=true;ui.tick();
  assert.equal(ui.layer.dataset.blur,'dialog');
  ui.state.otherDialog=false;ui.tick();assert.equal(ui.layer.dataset.blur,'');
});
