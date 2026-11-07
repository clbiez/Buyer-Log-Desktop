'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.env.BUYER_LOG_TEST_FLOW_SOURCE||require.resolve('../public/overview-global-flow'),'utf8');
test('opening a map drawer waits for source details and closing it prevents late reopening',async()=>{
 let resolve,opened=0;const statuses=[],classes=new Set();
 const drawer={innerHTML:'',classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),contains:key=>classes.has(key)},setAttribute(){},querySelector:()=>({addEventListener(){}})};
 const context={AbortController,window:{BLDetailDrawer:{open:()=>{opened++;},close(){}},BLUI:{renderState:(_node,state)=>statuses.push(state)},BLMotionPlus:{play(){}}},
  $:()=>drawer,L:(tr)=>tr,esc:String,flowMotionAllowed:()=>true,resolveMapDetailRecords:()=>new Promise(done=>{resolve=done;}),cpDetailRows:rows=>rows,detailContextColumns:()=>[]};
 const start=source.includes('let detailRequestGeneration=')?source.indexOf('let detailRequestGeneration='):source.indexOf('function openRecordsDrawer('),end=source.indexOf('function openRouteChoice(',start);
 const closeStart=source.indexOf('function closeDrawer()'),closeEnd=source.indexOf('\nfunction jumpToSource',closeStart);
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\n'+source.slice(closeStart,closeEnd),context);
 const thin=[{source:'backlog',raw:{_flowThin:1}}],first=context.openRecordsDrawer('Demo',thin,'Synthetic');
 assert.equal(opened,0);assert.equal(statuses[0]?.kind,'loading');
 resolve([{source:'backlog',raw:{_detailSource:{'Model Name':'Demo'}}}]);await first;assert.equal(opened,1);
 const second=context.openRecordsDrawer('Demo',thin,'Synthetic');context.closeDrawer();resolve(thin);await second;assert.equal(opened,1);
});
test('map loads its thin variant through the same bounded Backlog request cache as Chart',()=>{
 const start=source.indexOf('async function backlogPartials('),end=source.indexOf('async function sourceRecords(',start),block=source.slice(start,end);
 assert.match(block,/projection:'global-flow'/);assert.match(block,/BLBacklogRows\.loadData\(query\)/);assert.doesNotMatch(block,/includeSourceDetails:'1'/);
});
