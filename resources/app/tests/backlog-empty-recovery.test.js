'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const file=process.env.BACKLOG_OVERVIEW_SOURCE||require.resolve('../public/backlog-overview.js');
const source=fs.readFileSync(file,'utf8');
// #1079 WS6c: panel görünüm modelinden çizer (anahtar açık: okuma modeli; kapalı: yerel panelModel).
function renderState({model=null,loading=false,error='',backend=true}={}){
 const host={innerHTML:''};
 const start=source.indexOf('function render(){'),end=source.indexOf('\n/* --------------------------------------------------------- tooltip',start);
 const helpers=source.slice(source.indexOf('function importanceSelector(){'),source.indexOf('function specialStrip('));
 const context={$:id=>id==='backlogOverviewBody'?host:null,state:{open:true},filterOpen:false,updateFilterButton(){},hideTip(){},loading,error,model,baseItems:backend?null:(model?[]:null),
  backendModelEnabled:()=>backend,localModel:()=>model,remote:null,overviewRequest:null,R:()=>({}),importanceScope:()=> 'special',activeFilterCount:()=>1,esc:String,L:(_tr,en)=>en};
 vm.runInNewContext(helpers+'\n'+source.slice(start,end)+'\nrender();',context);return host.innerHTML;
}
for(const backend of [true,false]){
 for(const [name,opts] of [['zero matching rows',{model:{count:0,baseCount:3}}],['loading',{loading:true}],['request error',{error:'Demo failure'}],['not loaded',{model:null}]]){
  test(`scope and filter recovery remain available with ${name} (${backend?'read model':'local rows'})`,()=>{
   const html=renderState({...opts,backend});
   assert.match(html,/data-blv-importance="all"/);
   assert.match(html,/data-blv-importance="special"/);
   assert.match(html,/data-blv-action="filters"/);
   assert.match(html,/data-blv-action="clearFilters"/);
  });
 }
}
test('scope recovery re-renders existing rows without a new row request; the read model asks for the result only',()=>{
 const handler=source.slice(source.indexOf("if(t.dataset.blvImportance){"),source.indexOf("if(t.dataset.blvGroup){"));
 const update=source.slice(source.indexOf('function updateView(){'),source.indexOf('\n',source.indexOf('function updateView(){')));
 for(const backend of [false,true]){
  const calls=[];
  const context={t:{dataset:{blvImportance:'all'}},state:{importanceScope:'special'},saveState(){},backendModelEnabled:()=>backend,render(){calls.push('render');},refresh(force){calls.push('refresh:'+force);}};
  vm.runInNewContext(update+'\n(function(){'+handler+'})()',context);
  assert.equal(context.state.importanceScope,'all');
  // Yerel yol satırları yeniden süzüp çizer; okuma modeli yolu satır listesi değil, yalnız modeli ister (refresh(false) önbellekli veri kümesinden).
  assert.deepEqual(calls,backend?['refresh:false']:['render']);
 }
 // Okuma modeli yolu satır listesini (/api/backlog-export) istemez.
 const remoteRefresh=source.slice(source.indexOf('async function refreshRemote(force){'),source.indexOf('// Görünüm seçimi değişti'));
 assert.doesNotMatch(remoteRefresh,/loadRows|loadData|backlog-export/);
 assert.match(remoteRefresh,/postModel\(body\(\),request\.signal\)/);
});
