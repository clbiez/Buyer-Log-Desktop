'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../public/workspace-blur.js'),'utf8');

function setup(){
  const state={drawerOpen:false,drawerHidden:false,otherDialog:false,queries:0,styles:0,geometry:0};
  const frames=[],observers=[];
  let layer;
  const backdrop={
    nodeType:1,isConnected:true,hidden:false,
    matches:selector=>!selector.includes('.blDetailDrawer.is-open')||state.drawerOpen,
    contains:el=>el===backdrop,
    closest:selector=>state.drawerHidden&&selector.includes('aria-hidden')?{}:null,
    getBoundingClientRect:()=>{state.geometry++;return {width:900};}
  };
  const dialog={
    nodeType:1,isConnected:true,hidden:false,
    matches:()=>state.otherDialog,
    contains:el=>el===dialog,
    closest:()=>null,
    getBoundingClientRect:()=>{state.geometry++;return {width:600};}
  };
  dialog.querySelectorAll=()=>[];
  const document={
    body:{append:node=>{layer=node;}},
    documentElement:{dataset:{rail:''}},
    createElement:()=>({dataset:{},setAttribute(){}}),
    querySelectorAll:selector=>{state.queries++;return [
      // Closed drawers leave a backdrop mounted with nonzero dimensions.
      ...((state.drawerOpen||!selector.includes('.blDetailDrawer.is-open .blDetailDrawerBackdrop'))?[backdrop]:[]),
      ...(state.otherDialog?[dialog]:[])
    ].filter(el=>el.isConnected);},
    querySelector:()=>null,
    addEventListener:()=>{}
  };
  class MutationObserver{constructor(cb){observers.push(cb)}observe(){}}
  vm.runInNewContext(SOURCE,{
    document,MutationObserver,
    getComputedStyle:()=>{state.styles++;return {display:'block',visibility:'visible'};},
    requestAnimationFrame:cb=>frames.push(cb)
  });
  const mutate=records=>{observers[0](records);for(const cb of frames.splice(0))cb();};
  return {state,layer,mutate,backdrop,dialog,tick(){
    mutate([{type:'attributes',target:backdrop},...(state.otherDialog?[{
      type:'childList',target:{nodeType:1,matches:()=>false,contains:()=>false},addedNodes:[dialog],removedNodes:[]
    }]:[])]);
  }};
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

test('workspace blur ignores table caption style mutations without a document scan',()=>{
  const ui=setup(),before={...ui.state};
  const label={nodeType:1,matches:()=>false,contains:()=>false};
  ui.mutate([{type:'attributes',target:label,attributeName:'style'}]);
  for(const key of ['queries','styles','geometry'])assert.equal(ui.state[key],before[key],'unrelated style changes must not perform '+key);
});

test('surface registration follows ancestor visibility and removes disconnected surfaces',()=>{
  const ui=setup();ui.state.drawerOpen=true;
  const ancestor={nodeType:1,matches:()=>false,contains:el=>el===ui.backdrop};
  ui.mutate([{type:'attributes',target:ancestor,attributeName:'class'}]);assert.equal(ui.layer.dataset.blur,'dialog');
  ui.state.drawerHidden=true;
  ui.mutate([{type:'attributes',target:ancestor,attributeName:'aria-hidden'}]);assert.equal(ui.layer.dataset.blur,'');
  ui.state.drawerHidden=false;ui.backdrop.isConnected=false;
  ui.mutate([{type:'childList',target:ancestor,addedNodes:[],removedNodes:[ui.backdrop]}]);assert.equal(ui.layer.dataset.blur,'');
});
