'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTableSearch}=require('./helpers/bl-table-search');
const rowGroups=require('../public/table-search-row-groups');
const feedback=require('../public/table-search-feedback');
function missing(query,rows){
 const host={BLTableSearch:createTableSearch()};rowGroups.install(host);
 return feedback.findMissing(query,rows,x=>x,host.BLTableSearch);
}
test('eight pasted model searches identify exactly the three absent values in input order',()=>{
 const query=Array.from({length:8},(_,i)=>'DEMO-'+(i+1)).join(', ');
 assert.deepEqual(missing(query,['DEMO-1','DEMO-3','DEMO-4','DEMO-6','DEMO-8']),['DEMO-2','DEMO-5','DEMO-7']);
});
test('uses the existing case, Turkish, contains and decimal search rules',()=>{
 assert.deepEqual(missing('ŞİŞE, /ABC, 13,50, Missing',['sise abc123 13,50']),['Missing']);
 assert.deepEqual(missing('ABC123, ABC123, !BLOCKED',['ABC123']),[]);
 assert.deepEqual(missing('Missing, Missing',[]),['Missing']);
});
test('AND conditions and independent Excel row groups require a matching result row',()=>{
 assert.deepEqual(missing('(A; 1), (B; 2)',['A 1','B 3']),['(B; 2)']);
 assert.deepEqual(missing('Disney; !Bangladesh',['Disney Turkey']),[]);
 assert.deepEqual(missing('Disney; Turkey',[]),['Disney','Turkey']);
 assert.deepEqual(missing('(A\\;B; 1), (C; 2)',['A;B 1']),['(C; 2)']);
});
test('cleared searches and negative-only searches have no missing identifiers',()=>{
 assert.deepEqual(missing('',[]),[]);
 assert.deepEqual(missing('!BLOCKED',[]),[]);
});
test('feedback is accessible, preserves query text safely, updates language and clears stale warnings',()=>{
 const elements=new Map();
 function element(tag){return {tag,children:[],dataset:{},attrs:{},hidden:false,textContent:'',setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||null;},replaceChildren(...children){this.children=children;},insertAdjacentElement(_,el){elements.set(el.id,el);}};}
 const toolbar=element('div'),input=element('input');input.value='<img src=x onerror=alert(1)>';input.closest=()=>toolbar;elements.set('kolSearch',input);
 const previous={document:global.document,BLTableSearch:global.BLTableSearch,BLMotionPlus:global.BLMotionPlus};
 try{
  global.document={getElementById:id=>elements.get(id),createElement:element};global.BLTableSearch=createTableSearch();global.BLMotionPlus={play(){}};
  feedback.render('kolSearch',[],x=>x,false);
  const panel=elements.get('kolSearchFeedback');assert.equal(panel.attrs.role,'status');assert.equal(panel.attrs['aria-live'],'polite');
  assert.equal(input.attrs['aria-describedby'],'kolSearchFeedback');assert.equal(panel.children[1].textContent,input.value);
  feedback.render('kolSearch',[],x=>x,true);assert.match(panel.children[0].textContent,/Not found in filtered results/);
  feedback.render('kolSearch',[input.value],x=>x,true);assert.equal(panel.hidden,true);
  feedback.render('kolSearch',[],x=>x,true);assert.equal(panel.hidden,false);
  input.value='';feedback.render('kolSearch',[],()=>{throw Error('empty search must not scan rows');},false);assert.equal(panel.hidden,true);assert.deepEqual(panel.children,[]);
 }finally{Object.assign(global,previous);}
});

test('invalid filters have a separate bilingual panel and negative-only row groups stay silent',()=>{
 const s=createTableSearch();
 assert.deepEqual(feedback.findMissing('(!BLOCKED)',[],x=>x,s),[]);
 const invalid=['EX=W60','EX=M13','XX=W5','EX=W','EX = W22','!EX=W22'];
 assert.deepEqual(feedback.inspect(invalid.join(', '),[],x=>x,s),{missing:[],invalid});
});
