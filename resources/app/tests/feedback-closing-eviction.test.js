'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/ui-primitives.js'),'utf8');
function dom(){
 const timers=new Map();let serial=0;const listeners=new Set();
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.parentElement=null;this.classList={add(){},contains(){return false}};if(tag==='template')this.content={firstElementChild:new Element('article')}}
  setAttribute(k,v){this.attrs[k]=v}get firstElementChild(){return this.children[0]}get lastElementChild(){return this.children.at(-1)}
  appendChild(e){e.parentElement=this;this.children.push(e)}remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null}}addEventListener(){}
 }
 const body=new Element('body'),document={body,createElement:tag=>new Element(tag),querySelector:selector=>body.children.find(e=>selector.includes('"'+e.dataset.uiFeedbackRegion+'"'))||null,addEventListener:(t,f)=>listeners.add(f),removeEventListener:(t,f)=>listeners.delete(f)};
 const context={document,setTimeout:(f,ms)=>{const id=++serial;timers.set(id,{f,ms});return id},clearTimeout:id=>timers.delete(id),requestAnimationFrame:f=>f(),console};vm.createContext(context);vm.runInContext(source,context);return {context,body,timers,listeners};
}
test('a closing oldest notification is immediately evicted without blocking the fifth notification',()=>{const f=dom();vm.runInContext("var closes=Array.from({length:4},(_,i)=>BLUI.notify('item '+i,{duration:0}));closes[0]();BLUI.notify('fifth',{duration:0});",f.context,{timeout:1000});assert.equal(f.body.firstElementChild.children.length,4);assert.equal(f.context.closes[0].element.parentElement,null);for(const t of f.timers.values())t.f();assert.equal(f.body.firstElementChild.children.length,4);});
test('immediate close after animated close removes the item and listener synchronously',()=>{const f=dom();vm.runInContext("var close=BLUI.notify('center',{duration:0,placement:'center'});close();close({immediate:true});",f.context,{timeout:1000});assert.equal(f.body.children.length,0);assert.equal(f.listeners.size,0);});
test('queue eviction always makes progress even if an old close hook is ineffective',()=>{const f=dom();vm.runInContext("Array.from({length:4},(_,i)=>BLUI.notify('item '+i,{duration:0}));document.body.firstElementChild.firstElementChild._uiFeedbackClose=()=>{};BLUI.notify('fifth',{duration:0});",f.context,{timeout:1000});assert.equal(f.body.firstElementChild.children.length,4);});
