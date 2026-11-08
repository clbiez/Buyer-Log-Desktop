'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const clipboard=require('../public/grid-clipboard');

function element(tag,children=[]){
  const node={nodeType:1,tagName:tag,childNodes:children,dataset:{}};
  for(const child of children)child.parentNode=node;
  node.contains=target=>target===node||node.childNodes.some(child=>child===target||child.contains?.(target));
  node.closest=selector=>selector==='tr'?(tag==='TR'?node:node.parentNode?.closest(selector)):null;
  return node;
}
function fixture(){
  const body=element('TBODY'),table=element('TABLE',[body]);table.tBodies=[body];
  let base,extent,baseOffset,extentOffset,mutationCount=0;
  const selection={rangeCount:1,isCollapsed:false,
    getRangeAt:()=>({intersectsNode:node=>node===body}),
    removeAllRanges(){this.rangeCount=0;},
    setBaseAndExtent(a,ao,b,bo){base=a;baseOffset=ao;extent=b;extentOffset=bo;this.rangeCount=1;},
  };
  Object.defineProperties(selection,{anchorNode:{get:()=>base},anchorOffset:{get:()=>baseOffset},focusNode:{get:()=>extent},focusOffset:{get:()=>extentOffset}});
  const doc={activeElement:null,defaultView:{getSelection:()=>selection}};table.ownerDocument=doc;
  function rows(indexes){
    body.childNodes=indexes.map(index=>{
      const text={nodeType:3,data:'row '+index,childNodes:[]},cell=element('TD',[text]),row=element('TR',[cell]);
      row.dataset.blVirtualIndex=String(index);row.parentNode=body;return row;
    });
    body.querySelector=selector=>{const index=selector.match(/"(\d+)"/)?.[1];return body.childNodes.find(row=>row.dataset.blVirtualIndex===index)||null;};
  }
  rows([10,11]);selection.setBaseAndExtent(body,0,body,2);
  return {body,table,selection,doc,rows,mutate(){mutationCount++;rows(Array.from({length:20},(_,i)=>i));selection.setBaseAndExtent(body,0,body,0);},get mutationCount(){return mutationCount;}};
}

test('native select-all spans the completed body rather than losing the range',()=>{
  const f=fixture();
  f.selection.getRangeAt=()=>({intersectsNode:()=>true,startContainer:f.body,startOffset:0});
  f.doc.createRange=()=>({setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}});
  f.selection.addRange=range=>f.selection.setBaseAndExtent(range.startContainer,range.startOffset,range.endContainer,range.endOffset);
  assert.equal(clipboard.withNativeSelection(f.table,()=>f.mutate()),true);
  assert.equal(f.selection.anchorNode,f.body);assert.equal(f.selection.anchorOffset,0);
  assert.equal(f.selection.focusNode,f.body);assert.equal(f.selection.focusOffset,20);
});
test('partial reverse text selection keeps logical row, child path and character offsets',()=>{
  const f=fixture(),a=f.body.childNodes[1].childNodes[0].childNodes[0],b=f.body.childNodes[0].childNodes[0].childNodes[0];
  f.selection.setBaseAndExtent(a,4,b,1);
  clipboard.withNativeSelection(f.table,()=>f.mutate());
  assert.equal(f.selection.anchorNode,f.body.childNodes[11].childNodes[0].childNodes[0]);assert.equal(f.selection.anchorOffset,4);
  assert.equal(f.selection.focusNode,f.body.childNodes[10].childNodes[0].childNodes[0]);assert.equal(f.selection.focusOffset,1);
});
test('an unrelated or collapsed selection does not materialize a table',()=>{
  const f=fixture();f.selection.isCollapsed=true;
  assert.equal(clipboard.withNativeSelection(f.table,()=>f.mutate()),false);assert.equal(f.mutationCount,0);
  f.selection.isCollapsed=false;f.selection.getRangeAt=()=>({intersectsNode:()=>false});
  assert.equal(clipboard.withNativeSelection(f.table,()=>f.mutate()),false);assert.equal(f.mutationCount,0);
});
test('selection restoration also runs when the body update throws',()=>{
  const f=fixture();assert.throws(()=>clipboard.withNativeSelection(f.table,()=>{f.mutate();throw Error('update failed');}),/update failed/);
  assert.equal(f.selection.focusNode,f.body);assert.equal(f.selection.focusOffset,20);
});
test('hidden tables stay virtual when a page-wide range crosses their DOM',()=>{
  const f=fixture();f.table.getClientRects=()=>[];
  assert.equal(clipboard.withNativeSelection(f.table,()=>f.mutate()),false);assert.equal(f.mutationCount,0);
});
test('a focused row control is restored even without a native text selection',()=>{
  const f=fixture();f.selection.isCollapsed=true;f.doc.activeElement=f.body.childNodes[1].childNodes[0];
  let focused;
  assert.equal(clipboard.withNativeSelection(f.table,()=>{
    f.mutate();for(const row of f.body.childNodes)row.childNodes[0].focus=()=>{focused=row;};
  }),true);
  assert.equal(focused.dataset.blVirtualIndex,'11');
});
test('a Backlog render reuses the field lookup plan while reading changed row values live',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../public/detail-drawer.js'),'utf8');
  let plans=0,values=0;
  const context={active:{backlogLookupPlans:new WeakMap()},fieldRefs:()=>['alias'],rowSources:row=>[row,row.raw].filter(Boolean),detailModule:()=> 'backlog',hasValue:value=>value!==undefined&&value!==null&&value!=='',root:{BLCanonicalFields:{token:value=>String(value).toLowerCase(),canonicalId:()=>{plans++;return 'code';},canonicalValue:row=>{values++;return row.canonical;}}}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function lookupValue('),source.indexOf('\nfunction rawValueOf(')),context);
  const col={key:'alias'},row={canonical:'outer',raw:{alias:'old'}};
  assert.equal(context.lookupValue(col,row),'outer');row.canonical='changed';assert.equal(context.lookupValue(col,row),'changed');
  assert.equal(context.lookupValue(col,{alias:'direct',canonical:'unused'}),'direct');
  assert.equal(plans,1);assert.equal(values,2);
});
