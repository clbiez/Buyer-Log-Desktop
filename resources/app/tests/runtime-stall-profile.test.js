'use strict';
/* Stall diagnostics: the profile summary names the functions that used the
   blocked time and their call chains, with app-relative paths only. */
const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeProfile}=require('../server/lib/runtime-pressure-monitor');

test('summary ranks self time per function and keeps local folders out of paths',()=>{
  const frame=(id,name,url,line)=>({id,callFrame:{functionName:name,url,lineNumber:line},children:[]});
  const root=frame(1,'(root)','',0),outer=frame(2,'loadInitialData','file:///C:/Users/someone/BuyerLog/app/server/server.js',7071),inner=frame(3,'buildRows','C:\\Users\\someone\\BuyerLog\\app\\server\\lib\\parse.js',99),idle=frame(4,'(idle)','',0);
  root.children=[2,4];outer.children=[3];
  const summary=summarizeProfile({nodes:[root,outer,inner,idle],samples:[3,3,3,2,4],timeDeltas:[1000000,1000000,1000000,500000,250000]});
  assert.equal(summary.functions[0].label,'buildRows server/lib/parse.js:100');
  assert.equal(summary.functions[0].ms,3000);
  assert.deepEqual(summary.stacks[0].chain,['buildRows server/lib/parse.js:100','loadInitialData server/server.js:7072']);
  assert.doesNotMatch(JSON.stringify(summary),/someone|Users/);
});
