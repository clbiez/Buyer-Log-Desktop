'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Density=require('../public/table-density');
test('default density preserves legacy geometry; explicit spacing does not resize images or other tables',()=>{
 const map=new Map(),store={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)},d=Density.createController({storage:store}),base={w:66,h:40,col:74,row:46};
 assert.equal(d.dimensions('cp',base),base);d.set('cp','compact');assert.equal(d.get('orders'),'default');assert.equal(d.dimensions('cp',base).row,42);assert.equal(d.dimensions('cp',base).w,66);assert.equal(d.dimensions('cp',base).h,40);
 d.setTextScale('xl');assert.equal(d.dimensions('cp',base).row,42);assert.equal(d.dimensions('cp',{...base,w:42,h:28,row:34}).row,40,'large text still fits above the compact image minimum');
 d.set('cp','comfortable');assert.equal(d.dimensions('cp',base).row,54);d.set('cp','default');assert.equal(d.dimensions('cp',base),base);assert.equal(map.size,0);
});
test('corrupt density preferences fail to the legacy default and are scoped by actual user storage',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/user-storage.js'),'utf8'),values=new Map(),native={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const boot=id=>{const window={localStorage:native,BL_USER_CONTEXT:{id}};vm.runInNewContext(source,{window,fetch:()=>new Promise(()=>{})});return window.BLStorage;};
 const a=Density.createController({storage:boot('buyer-a')});a.set('cp','comfortable');const b=Density.createController({storage:boot('buyer-b')});assert.equal(b.get('cp'),'default');assert.equal(Density.createController({storage:boot('buyer-a')}).get('cp'),'comfortable');
 const corrupt=Density.createController({storage:{getItem:()=>'{broken'}});assert.equal(corrupt.get('cp'),'default');assert.equal(corrupt.set('unknown-module','compact'),'default');
});
test('changing virtual row spacing retains the visible row anchor and repaints once',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),start=source.indexOf('function syncVirtualizedTableRowHeight('),end=source.indexOf('\n}',start)+2,host={scrollTop:4600};let paints=0;
 const state={rowHeight:46,renderedStart:80,renderedEnd:120,paint:()=>paints++},table={tBodies:[{_virtualState:state}],closest:()=>host},context={tableImageSizeTable:()=>table};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.syncVirtualizedTableRowHeight('cp',54,{preserveAnchor:true});assert.equal(host.scrollTop,5400);assert.equal(state.rowHeight,54);assert.equal(paints,1);context.syncVirtualizedTableRowHeight('cp',54,{preserveAnchor:true});assert.equal(paints,1);
});
