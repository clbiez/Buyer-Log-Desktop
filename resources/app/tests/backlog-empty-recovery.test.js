'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const file=process.env.BACKLOG_OVERVIEW_SOURCE||require.resolve('../public/backlog-overview.js');
const source=fs.readFileSync(file,'utf8');
function renderState({rows=[],loading=false,error=''}={}){
 const host={innerHTML:''};
 const start=source.indexOf('function render(){'),end=source.indexOf('\n/* --------------------------------------------------------- tooltip',start);
 const helpers=source.slice(source.indexOf('function importanceSelector(){'),source.indexOf('function specialStrip('));
 const context={$:id=>id==='backlogOverviewBody'?host:null,state:{open:true},filterOpen:false,updateFilterButton(){},hideTip(){},loading,error,items:rows,R:()=>({}),importanceScope:()=> 'special',activeFilterCount:()=>1,esc:String,L:(_tr,en)=>en};
 vm.runInNewContext(helpers+'\n'+source.slice(start,end)+'\nrender();',context);return host.innerHTML;
}
for(const [name,opts] of [['zero matching rows',{}],['loading',{loading:true}],['request error',{error:'Demo failure'}],['not loaded',{rows:null}]]){
 test('scope and filter recovery remain available with '+name,()=>{
  const html=renderState(opts);
  assert.match(html,/data-blv-importance="all"/);
  assert.match(html,/data-blv-importance="special"/);
  assert.match(html,/data-blv-action="filters"/);
  assert.match(html,/data-blv-action="clearFilters"/);
 });
}
test('scope recovery refilters existing rows without issuing a new request',()=>{
 const handler=source.slice(source.indexOf("if(t.dataset.blvImportance){"),source.indexOf("if(t.dataset.blvGroup){"));
 const context={t:{dataset:{blvImportance:'all'}},state:{importanceScope:'special'},baseItems:[{special:false}],saveState(){},applyOverviewFilters:rows=>rows,render(){}};
 vm.runInNewContext('(function(){'+handler+'})()',context);
 assert.equal(context.state.importanceScope,'all');assert.equal(context.items.length,1);
});
