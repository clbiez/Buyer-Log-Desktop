'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function boot({editable=true,rows=[],filtered=false,lang='tr'}={}){
 let options,added=0,cleared=0;
 const target={hidden:true,textContent:'',setAttribute(){}},context={document:{getElementById:()=>target},kolRows:rows,kolWorkspaceCanEdit:editable,appLang:lang,kolHasActiveTableFilters:()=>filtered,window:{BLUI:{renderState:(_target,value)=>options=value}},addBlankKolRow:()=>{if(context.kolWorkspaceCanEdit)added++;},clearTableFilters:()=>cleared++};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function renderKolEmptyState('),source.indexOf('\nfunction renderKol(){')),context);
 context.renderKolEmptyState([]);return {context,target,get options(){return options;},get added(){return added;},get cleared(){return cleared;}};
}
test('empty editable Collection starts the existing guarded Add Model flow in both languages',()=>{
 for(const lang of ['tr','en']){const ui=boot({lang});assert.equal(ui.options.actionLabel,lang==='en'?'Add first model':'İlk modeli ekle');ui.options.onAction();assert.equal(ui.added,1);ui.context.kolWorkspaceCanEdit=false;ui.options.onAction();assert.equal(ui.added,1,'a stale rendered action cannot bypass the existing edit guard');}
});
test('filtered Collection clears filters; read-only empty Collection does not offer an edit',()=>{
 const filtered=boot({rows:[{id:1}],filtered:true});filtered.options.onAction();assert.equal(filtered.cleared,1);assert.equal(filtered.added,0);
 const readOnly=boot({editable:false,lang:'en'});assert.equal(readOnly.options.actionLabel,'');assert.match(readOnly.options.detail,/read.only/i);
});
