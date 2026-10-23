'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/layout-control'),'utf8');
function fixture(){
  const controls=Object.fromEntries(['level','out','in'].map(key=>[key,{}]));
  let timer;
  const canvas={width:600,height:700,dataset:{layoutRendered:'1'},isConnected:true,getContext:()=>({drawImage:buffer=>{canvas.drawn=buffer;}})};
  const page={style:{},get clientWidth(){return 600*parseFloat(page.style.width||'100')/100;},getBoundingClientRect:()=>({left:10-viewport.scrollLeft,top:20-viewport.scrollTop}),querySelector:()=>canvas};
  canvas.parentElement=page;
  const viewport={clientWidth:600,clientHeight:400,clientLeft:0,clientTop:0,scrollLeft:120,scrollTop:80,getBoundingClientRect:()=>({left:10,top:20}),querySelector:()=>page};
  const host={querySelector:selector=>selector==='.layoutPage'?page:controls[selector==='[data-layout-zoom-level]'?'level':selector==='[data-layout-zoom-out]'?'out':'in']};
  const modal={querySelector:selector=>selector==='.layoutPageViewport'?viewport:host};
  const document={createElement:()=>({getContext:()=>({})})};
  const root={};
  const context=vm.createContext({window:root,document,setTimeout:callback=>{timer=callback;return 1;},clearTimeout:()=>{timer=null;}});
  vm.runInContext(source.replace('root.BLLayoutControl={open,','root.zoomTest={zoomDocument,renderPage,setModal:value=>{modal=value;},setPdf:value=>{pdfDocument=value;},invalidate:()=>{renderToken++;}};root.BLLayoutControl={open,'),context);
  root.zoomTest.setModal(modal);
  return {api:root.zoomTest,canvas,page,viewport,controls,flush:()=>timer&&timer()};
}
test('document zoom clamps to limits, preserves the viewport centre and Fit resets scroll',()=>{
  const {api,page,viewport,controls}=fixture();
  api.zoomDocument(2);
  assert.equal(page.style.width,'200%');assert.equal(viewport.scrollLeft,540);assert.equal(viewport.scrollTop,360);
  assert.equal(controls.level.textContent,'200%');
  api.zoomDocument(99);assert.equal(page.style.width,'400%');assert.equal(controls.in.disabled,true);
  api.zoomDocument(.01);assert.equal(page.style.width,'50%');assert.equal(controls.out.disabled,true);
  api.zoomDocument(1,{fit:true});assert.equal(page.style.width,'100%');assert.equal(viewport.scrollTop,0);assert.equal(viewport.scrollLeft,0);
});
test('wheel zoom anchors the document point under the pointer',()=>{
  const {api,viewport}=fixture();
  api.zoomDocument(1.25,{x:210,y:120});
  assert.equal(viewport.scrollLeft,200);assert.equal(viewport.scrollTop,125);
});
test('a stale PDF render cannot replace the latest zoom image',async()=>{
  const {api,canvas,page}=fixture();
  let finish;
  const pdf={getPage:async()=>({getViewport:({scale})=>({width:600*scale,height:700*scale}),render:()=>({promise:new Promise(resolve=>{finish=resolve;})})})};
  const old=api.renderPage(pdf,1,canvas);await new Promise(setImmediate);
  api.invalidate();finish();await old;
  assert.equal(canvas.drawn,undefined);
  page.style.width='400%';
  await api.renderPage({getPage:async()=>({getViewport:({scale})=>({width:600*scale,height:700*scale}),render:()=>({promise:Promise.resolve()})})},1,canvas);
  assert.equal(canvas.width,2400);assert.equal(canvas.height,2800);assert.ok(canvas.drawn);
});
test('closing before a scheduled zoom redraw prevents use of a detached canvas',()=>{
  const {api,canvas,flush}=fixture();
  api.setPdf({getPage:()=>{throw new Error('Detached canvas rendered');}});
  api.zoomDocument(2);canvas.isConnected=false;flush();
});
