'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Density=require('../public/table-density');
test('CP, Orders and Collection always use Compact spacing with unchanged image sizes',()=>{
 const saved=new Map([['lcw.table.density.v1.cp','comfortable']]),changes=[];
 const store={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 const d=Density.createController({storage:store,onChange:(key,value)=>changes.push({key,value})}),base={w:66,h:40,col:74,row:46};
 for(const tableKey of Density.TABLES){
  assert.equal(d.get(tableKey),'compact');
  assert.equal(d.dimensions(tableKey,base).row,42);
  assert.equal(d.dimensions(tableKey,base).w,66);
  assert.equal(d.dimensions(tableKey,base).h,40);
  assert.equal(d.set(tableKey,'comfortable'),'compact');
  assert.equal(d.set(tableKey,'default'),'compact','saved-view reset must not restore adjustable spacing');
  assert.equal(d.get(tableKey),'compact');
 }
 assert.deepEqual(changes.map(({value})=>value),Array(6).fill('compact'));
 assert.equal(saved.size,1,'legacy preferences are ignored, not rewritten');
 assert.equal(d.get('unknown-module'),'default');
 assert.equal(d.set('unknown-module','compact'),'default');
 assert.equal(d.dimensions('unknown-module',base),base);
 d.setTextScale('xl');
 assert.equal(d.dimensions('cp',{...base,w:42,h:28,row:34}).row,40,'Compact respects larger interface text');
});

test('Rows controls are removed and Actions remains available only via its keyboard palette',()=>{
 const d=Density.createController(),oldSelect={removeCalls:0,remove(){this.removeCalls++;}},host={querySelector:selector=>selector==='[data-density-control]'?oldSelect:null};
 d.mount(host,'cp','en');d.mount(host,'orders','tr');d.mount(host,'koleksiyon','en');
 assert.equal(oldSelect.removeCalls,3);
 assert.deepEqual(Array.from(Density.MODES),['compact']);
 const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
 const start=app.indexOf('function renderTableViewContext(tableKey)');
 const end=app.indexOf('\\n}',start);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(app.slice(start,end),/data-table-command-palette|commandsButton/,'Actions button must not be recreated on rerender or language changes');
 const palette=fs.readFileSync(path.join(__dirname,'../public/command-palette.js'),'utf8');
 assert.match(palette,/Ctrl\\+Shift\\+K/,'contextual command shortcut is retained');
});

test('changing virtual row spacing retains the visible row anchor and repaints once',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),start=source.indexOf('function syncVirtualizedTableRowHeight('),end=source.indexOf('\n}',start)+2,host={scrollTop:4600};let paints=0;
 const state={rowHeight:46,renderedStart:80,renderedEnd:120,paint:()=>paints++},table={tBodies:[{_virtualState:state}],closest:()=>host},context={tableImageSizeTable:()=>table};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.syncVirtualizedTableRowHeight('cp',54,{preserveAnchor:true});assert.equal(host.scrollTop,5400);assert.equal(state.rowHeight,54);assert.equal(paints,1);context.syncVirtualizedTableRowHeight('cp',54,{preserveAnchor:true});assert.equal(paints,1);
});
