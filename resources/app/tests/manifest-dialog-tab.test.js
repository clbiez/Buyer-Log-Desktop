'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {trapDialogTab}=require('../public/layer-system');
function fixture(){
 const doc={activeElement:null};
 const make=(props={})=>({ownerDocument:doc,isConnected:true,tabIndex:0,getAttribute:()=>null,getClientRects:()=>[{}],focus(){doc.activeElement=this;},...props});
 const first=make(),hidden=make({hidden:true}),disabled=make({disabled:true}),last=make();
 const dialog=make({querySelectorAll:()=>[first,hidden,disabled,last]});
 const press=(active,shiftKey=false,extra={})=>{doc.activeElement=active;const event={key:'Tab',shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};trapDialogTab(dialog,event);return event;};
 return {doc,first,last,dialog,press};
}
test('shared Tab boundary wraps both directions and recovers outside focus',()=>{
 const f=fixture();assert.equal(f.press(f.last).defaultPrevented,true);assert.equal(f.doc.activeElement,f.first);
 f.press(f.first,true);assert.equal(f.doc.activeElement,f.last);
 f.press({});assert.equal(f.doc.activeElement,f.first);
 f.press({},true);assert.equal(f.doc.activeElement,f.last);
});
test('hidden and disabled controls are skipped without stealing handled keys',()=>{
 const f=fixture();f.press(f.first);assert.equal(f.doc.activeElement,f.last);
 assert.equal(f.press(f.first,false,{defaultPrevented:true}).defaultPrevented,true);assert.equal(f.doc.activeElement,f.first);
 assert.equal(f.press(f.last,false,{key:'ArrowRight'}).defaultPrevented,false);assert.equal(f.doc.activeElement,f.last);
});
test('a dialog without active controls retains focus on its container',()=>{
 const f=fixture();f.dialog.querySelectorAll=()=>[];f.press({});assert.equal(f.doc.activeElement,f.dialog);
});
