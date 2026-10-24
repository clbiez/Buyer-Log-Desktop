'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('opening version history initializes the real desktop update panel on its own modal',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),start=source.indexOf('function renderVersionHistoryModal(){'),end=source.indexOf('(function bindVersionHistory(){',start);
 assert.ok(start>0&&end>start);const calls=[],node={addEventListener(){},focus(){},scrollTo(){}};
 const modal={addEventListener(){},querySelector(){return node;},remove(){}};
 const context={document:{getElementById(){return null;},createElement(){return modal;},body:{appendChild(){}},addEventListener(){}},
  versionHistoryText:()=>({}),escapeHtml:String,renderVersionHistoryList(){},setTimeout(){},_verHistSelected:null,_verHistQuery:'',
  bindBuyerLogUpdatePanel:host=>calls.push(['bind',host]),refreshBuyerLogUpdatePanel:()=>calls.push(['refresh'])};
 vm.runInNewContext(source.slice(start,end)+'\nrenderVersionHistoryModal();',context);
 assert.equal(calls.filter(c=>c[0]==='bind').length,1);assert.equal(calls[0][1],modal);
 assert.equal(calls.filter(c=>c[0]==='refresh').length,1);
});
