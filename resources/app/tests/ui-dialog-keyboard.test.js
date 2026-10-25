'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bindDialogKeyboard}=require('../public/ui-primitives.js');
test('dialog keyboard wraps visible controls, delegates Escape and restores the opener',()=>{
 const previous=global.document,handlers=new Map();
 const element=(visible=true,disabled=false)=>({disabled,tabIndex:0,isConnected:true,checkVisibility:()=>visible,focus(){global.document.activeElement=this;}});
 const opener=element(),first=element(),hidden=element(false),disabled=element(true,true),last=element();global.document={activeElement:opener};
 const dialog={querySelectorAll:()=>[first,hidden,disabled,last],contains:e=>[first,hidden,disabled,last].includes(e),addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:(key)=>handlers.delete(key)};
 let closes=0;try{
  const dispose=bindDialogKeyboard(dialog,{onEscape:()=>closes++});assert.equal(document.activeElement,first);
  const press=(key,shiftKey=false,defaultPrevented=false)=>{let prevented=false;handlers.get('keydown')({key,shiftKey,defaultPrevented,preventDefault(){prevented=true;}});return prevented;};
  assert.equal(press('Tab',true),true);assert.equal(document.activeElement,last);
  assert.equal(press('Tab'),true);assert.equal(document.activeElement,first);
  press('Escape',false,true);assert.equal(closes,0,'an inner popup already handled this Escape');
  press('Escape');assert.equal(closes,1);assert.equal(document.activeElement,first,'caller retains validation control');
  dispose();assert.equal(document.activeElement,opener);assert.equal(handlers.size,0);
 }finally{global.document=previous;}
});
