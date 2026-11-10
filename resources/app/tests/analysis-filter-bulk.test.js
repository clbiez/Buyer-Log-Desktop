'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
function button(dataset){return {dataset,addEventListener(type,fn){assert.equal(type,'click');this.click=()=>fn({stopPropagation(){}});}};}
function handlerBlock(source,start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}

test('LFL bulk actions select visible values, preserve hidden selections and other dimensions',()=>{
  const selected=new Set(['Hidden']),state={filters:{manufacturer:selected,country:new Set(['TR'])}};
  const rows=Array.from({length:20},(_,i)=>({hidden:i>=17,querySelector:()=>({value:`Demo ${i}`})}));
  const all=button({lflBulk:'all'}),clear=button({lflBulk:'clear'});let renders=0;
  const panel={querySelectorAll(selector){if(selector==='[data-lfl-bulk]')return [all,clear];assert.equal(selector,'.lflDimOption[data-search]');return rows;}};
  const code=handlerBlock(read('lfl.js'),"    panel.querySelectorAll('[data-lfl-bulk]')","    panel.querySelectorAll('.lflDimCheck')");
  vm.runInNewContext(code,{panel,state,dim:'manufacturer',rerender(){renders++;}});
  all.click();assert.equal(selected.size,18);assert.ok(selected.has('Demo 16'));assert.ok(!selected.has('Demo 17'));
  all.click();assert.equal(selected.size,18,'idempotent');
  clear.click();assert.deepEqual([...selected],['Hidden']);assert.deepEqual([...state.filters.country],['TR']);
  rows.forEach(row=>row.hidden=false);all.click();assert.equal(selected.size,21);
  clear.click();assert.deepEqual([...selected],['Hidden']);assert.equal(renders,5);
});

test('Pricing Desk bulk actions select all 20 options, persist, reopen drawer and preserve other filters',()=>{
  const all=button({pdAbulk:'all',pdAdim:'manufacturer'}),clear=button({pdAbulk:'clear',pdAdim:'manufacturer'});
  const a={filters:{country:['TR']}},state={drill:{}};let renders=0,saves=0,opened=0;
  const body={querySelectorAll:()=>[all,clear],querySelector(){return {closest(){return {setAttribute(name,value){assert.equal(name,'open');assert.equal(value,'');opened++;}};}};}};
  const code=handlerBlock(read('pricing-desk.js'),"    body.querySelectorAll('[data-pd-abulk]')","    body.querySelectorAll('[data-pd-afilter]')");
  const observations=Array.from({length:20},(_,i)=>({manufacturer:`Demo ${i}`}));
  vm.runInNewContext(code,{body,a,state,observations,E:{dimensionValues:rows=>rows.map(row=>({label:row.manufacturer}))},ANALYSIS_KEY:'analysis',analysisPrefs:()=>a,store:{set(key,value){assert.equal(key,'analysis');assert.equal(value,a);saves++;}},renderAnalysis(){renders++;}});
  all.click();assert.equal(a.filters.manufacturer.length,20);assert.equal(new Set(a.filters.manufacturer).size,20);assert.deepEqual(a.filters.country,['TR']);assert.equal(state.drill,null);
  a.filters.manufacturer.splice(0,3);assert.equal(a.filters.manufacturer.length,17);
  clear.click();assert.equal(a.filters.manufacturer,undefined);assert.deepEqual(a.filters.country,['TR']);assert.equal(renders,2);assert.equal(saves,2);assert.equal(opened,2);
});
