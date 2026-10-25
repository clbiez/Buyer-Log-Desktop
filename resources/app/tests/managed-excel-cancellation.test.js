'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),BLUI=require('../public/ui-primitives');
function fixture({cancelAt,packingCancel=false,failPacking=false}={}){
 const events={generated:0,downloads:0,released:0,removed:0,packed:0,labels:[],notices:[]};let cancel;
 const table={querySelectorAll:()=>[],closest(){return{before(){}};}},records=Array.from({length:1000},(_,i)=>({_id:i}));
 const context={window:{BLUI:{...BLUI,renderProgress(_region,value){cancel=value.onCancel;events.labels.push(value.label);if(cancelAt!=null&&value.completed>=cancelAt)cancel();}}},document:{querySelector:()=>table,createElement:()=>({remove(){events.removed++;}})},appLang:'en',managedExcelExportOperations:new WeakMap(),showToast:value=>events.notices.push(value),
  visibleCols:()=>[],beginFullTableLayout:()=>()=>events.released++,managedExcelExportRows:function*(rows){for(const row of rows){events.generated++;yield{dataset:{id:row._id},getAttribute:()=>row._id,children:[],getBoundingClientRect:()=>({height:20})};}},
  ExcelJS:{Workbook:class{constructor(){this.xlsx={writeBuffer:async()=>{events.packed++;if(packingCancel)cancel();if(failPacking)throw Error('packing failed');return Buffer.from('xlsx');}};}addWorksheet(){return{getRow:()=>({}),getColumn:()=>({})};}}},
  _prepareExcelJsImages:async()=>[],cpOrdersImageDims:()=>({row:20}),kolDownloadBuffer:()=>events.downloads++,setTimeout,Date,Map,Set,Number,String,Math,Error};
 context.window.BLPerf={ensureLibrary:async()=>{}};
 const a=APP.indexOf('async function exportStyledDomTable('),b=APP.indexOf('async function exportCpTableWithLightTheme',a);
 vm.runInNewContext(APP.slice(a,b),context);
 return {events,run:()=>context.exportStyledDomTable('#cpTable',{tableKey:'cp',records}),cancel:()=>cancel?.()};
}
test('main table export cancels between record chunks, releases layout and can retry',async()=>{
 const f=fixture({cancelAt:100});assert.equal(await f.run(),false);assert.equal(f.events.downloads,0);assert.equal(f.events.packed,0);assert.ok(f.events.generated<=100);assert.equal(f.events.released,1);assert.equal(f.events.removed,1);assert.match(f.events.notices.at(-1),/cancelled/i);
 assert.equal(await f.run(),false);assert.equal(f.events.released,2,'cancellation must release the per-table export lock');
});
test('cancellation during asynchronous workbook packing prevents file download',async()=>{
 const f=fixture({packingCancel:true});assert.equal(await f.run(),false);assert.equal(f.events.generated,1000);assert.equal(f.events.packed,1);assert.equal(f.events.downloads,0);assert.equal(f.events.released,1);
});
test('one table cannot start duplicate exports while its first job is pending',async()=>{
 const f=fixture(),pending=f.run();assert.equal(await f.run(),false);assert.equal(await pending,true);assert.equal(f.events.generated,1000);assert.equal(f.events.downloads,1);assert.equal(f.events.removed,1);
});
test('packing errors release progress and layout without downloading',async()=>{
 const f=fixture({failPacking:true});await assert.rejects(f.run(),/packing failed/);assert.equal(f.events.downloads,0);assert.equal(f.events.released,1);assert.equal(f.events.removed,1);
});
