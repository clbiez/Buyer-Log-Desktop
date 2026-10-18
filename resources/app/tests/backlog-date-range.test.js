'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const parse=require('../server/lib/parse');
const date=require('../public/backlog-date-range');

test('date window shifts through month ends, leap years and week boundaries',()=>{
  assert.deepEqual(date.shift({from:'2028-01-01',to:'2028-01-31'},'month',1),{from:'2028-02-01',to:'2028-02-29'});
  assert.deepEqual(date.shift({from:'2028-02-01',to:'2028-02-29'},'month',1),{from:'2028-03-01',to:'2028-03-31'});
  assert.deepEqual(date.shift({from:'2026-12-28',to:'2027-01-03'},'week',1),{from:'2027-01-04',to:'2027-01-10'});
  assert.deepEqual(date.shift({from:'2026-10-18',to:''},'day',-1),{from:'2026-10-17',to:''});
  assert.equal(date.day('2026-02-30'),null);
});
test('calendar presets use Monday weeks and inclusive 30-day windows',()=>{
  assert.deepEqual(date.preset('week','2026-10-18'),{from:'2026-10-12',to:'2026-10-18'});
  assert.deepEqual(date.preset('month','2028-02-12'),{from:'2028-02-01',to:'2028-02-29'});
  assert.deepEqual(date.preset('next30','2026-12-18'),{from:'2026-12-18',to:'2027-01-16'});
});
test('slider boundaries snap to full calendar periods and support long ranges without truncation',()=>{
  const months=date.axis({from:'2028-02-12',to:'2028-03-15'},'month');
  assert.equal(months.at(months.start),'2028-02-01');
  assert.equal(months.at(months.end),'2028-04-01');
  const weeks=date.axis({from:'2026-10-18',to:'2026-10-21'},'week');
  assert.equal(weeks.at(weeks.start),'2026-10-12');
  assert.equal(weeks.at(weeks.end),'2026-10-26');
  const long=date.axis({from:'1900-01-01',to:'2100-12-31'},'day');
  assert.equal(long.at(long.start),'1900-01-01');
  assert.equal(long.at(long.end),'2101-01-01');
});
const ov={notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[]};
const order=(code,ex)=>({ocode:code,model:'DEMO',ccode:'C1',colour:'BLACK',season:'W6',countryRaw:'MISIR',manufacturer:'DEMO',buyerGrup:'DEMO',qty:100,kalan:100,fob:5,ex,retail:new Date(2027,0,1),mb:new Date(2026,11,1)});
test('Exfactory boundaries are inclusive, optional and shared by pivot and export detail',()=>{
  const rows=[order(101,new Date(2026,9,1)),order(102,new Date(2026,9,31)),order(103,new Date(2026,10,1)),order(104,null)];
  const opts={groupBy:['buyerGrup'],exFactoryFrom:'2026-10-01',exFactoryTo:'2026-10-31'};
  const pivot=parse.buildBacklogGrouped(rows,{},ov,opts);
  assert.equal(pivot.totalOrders,2);
  assert.equal(pivot.exFactoryFrom,opts.exFactoryFrom);
  assert.equal(pivot.exFactoryTo,opts.exFactoryTo);
  assert.equal(parse.buildBacklogDetailRows(rows,{},ov,{...opts,path:'0'}).length,2);
  assert.equal(parse.buildBacklogGrouped(rows,{},ov,{}).totalOrders,4);
  assert.equal(parse.buildBacklogGrouped(rows,{},ov,{exFactoryFrom:'2026-11-01'}).totalOrders,1);
  assert.equal(parse.buildBacklogGrouped(rows,{},ov,{exFactoryTo:'2026-10-01'}).totalOrders,1);
  assert.equal(parse.buildBacklogGrouped(rows,{},ov,{...opts,inStoreFrom:'2026-12-02'}).totalOrders,0);
});
test('Exfactory range is carried by query, export, detail and persisted settings',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
  assert.match(app,/exFactoryFrom: document\.getElementById\('backlogExFactoryFrom'\)/);
  assert.match(app,/setVal\('backlogExFactoryFrom',saved\.exFactoryFrom\)/);
  assert.match(server,/exFactoryFrom: body\.exFactoryFrom/);
  assert.match(server,/filterOpts=\{[^}]*exFactoryFrom/);
  assert.match(server,/exFactoryFrom:exFactoryFrom\|\|''/);
  const index=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.ok(index.indexOf('src="backlog-date-range.js')<index.indexOf('src="app-main.js'),'date range API must load before app bootstrap mounts it');
});
test('an older Backlog response cannot replace a newer date selection',async()=>{
  const vm=require('node:vm');
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const start=app.indexOf('let backlogFetchGeneration=0;'),end=app.indexOf('async function prefetchBacklogForRefresh()',start);
  const pending=[],applied=[];
  const sandbox={window:{},showBacklogLoadingState(){},backlogQueryString:p=>String(p.id),fetchJSON:()=>new Promise(resolve=>pending.push(resolve)),applyBacklogData:data=>applied.push(data)};
  vm.createContext(sandbox);vm.runInContext(app.slice(start,end),sandbox);
  const old=sandbox.fetchBacklog({id:1}),latest=sandbox.fetchBacklog({id:2});
  pending[1]('latest');await latest;pending[0]('old');await old;
  assert.deepEqual(applied,['latest']);
});
