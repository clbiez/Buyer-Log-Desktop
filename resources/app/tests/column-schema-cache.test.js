'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const schema=require('../public/column-schema');
test('schema cache reuses all-source inference across filtered renders and invalidates changed sources',()=>{
  const cache=schema.createResolverCache();let reads=0;
  const rows=Array.from({length:33000},(_,i)=>({get Custom(){reads++;return i===32999?'0042':String(i);}})),col={k:'Custom',label:'Order Code'};
  const first=cache.resolve(col,rows,null,1);assert.equal(first.dataType,'code/id');const baseline=reads;
  for(let i=0;i<30;i++)assert.equal(cache.resolve(col,rows,null,1),first);
  assert.equal(reads,baseline);
  assert.notEqual(cache.resolve(col,rows,null,2),first);
  assert.equal(cache.resolve(col,[{Custom:1.2}],null,2).dataType,'decimal');
});
test('metadata, definition edits and replaced custom functions cannot reuse a stale schema',()=>{
  const cache=schema.createResolverCache(),rows=[{X:0.25}],meta={type:'percentage',scale:'fraction'},col={k:'X'};
  assert.equal(cache.resolve(col,rows,meta,1).format(0.25),'25%');
  meta.scale='percent';assert.equal(cache.resolve(col,rows,meta,1).format(0.25),'0,25%');
  col.schema={format:()=> 'custom'};const a=cache.resolve(col,rows,meta,1);assert.equal(a.format(0.25),'custom');
  col.schema.format=()=> 'changed';assert.notEqual(cache.resolve(col,rows,meta,1),a);
});
