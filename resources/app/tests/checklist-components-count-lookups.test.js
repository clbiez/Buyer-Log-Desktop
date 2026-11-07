'use strict';
// count() re-derived the same row description through isSet(), doubling the
// canonical field lookups for every checklist status on every CP row. The
// description is read once; results are unchanged.
const test=require('node:test'),assert=require('node:assert/strict');
const Components=require('../public/checklist-components-engine.js');

function probe(row){
  const counter={reads:0};
  const proxied=new Proxy(row,{
    getOwnPropertyDescriptor(target,key){counter.reads++;return Reflect.getOwnPropertyDescriptor(target,key);},
    ownKeys(target){counter.reads++;return Reflect.ownKeys(target);},
  });
  return {proxied,counter};
}
const rows=[
  {'Order Code':'1','Product Main Definition':'Kazak','Category':'Knit'},
  {'Order Code':'2','Product Main Definition':'2 Parça Takım','Category':'Set'},
  {'Order Code':'3','Product Main Definition':'Set of 3','Category':'Set'},
  {'Order Code':'4','Product Main Definition':'Takım','Category':'Set','setPieceCount':4},
];

test('count reads the row description once, not again through isSet', () => {
  for(const row of rows.slice(0,3)){
    const counted=probe(row),described=probe(row),explicit=probe(row);
    Components.count(counted.proxied,'cp');
    Components.isSet(described.proxied,'cp');
    require('../public/canonical-fields.js').value(explicit.proxied,'cp','setPieceCount');
    assert.ok(counted.counter.reads<=described.counter.reads+explicit.counter.reads,
      `count used ${counted.counter.reads} reads; description ${described.counter.reads} + explicit ${explicit.counter.reads}`);
  }
});

test('set identity results are unchanged', () => {
  assert.deepEqual(rows.map(row=>Components.count(row,'cp')),[0,2,3,4]);
  assert.deepEqual(rows.map(row=>Components.isSet(row,'cp')),[false,true,true,true]);
});
