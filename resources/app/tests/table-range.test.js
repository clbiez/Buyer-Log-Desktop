'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,normalizeSize}=require('../public/table-range');
test('33,000 records remain accessible in 50/100/200/all ranges without altering the source',()=>{
 const rows=Array.from({length:33000},(_,id)=>Object.freeze({id})),c=create();
 assert.equal(c.update(rows).rows.length,50);assert.equal(c.snapshot().pages,660);
 for(const size of [50,100,200]){
  c.setSize(size);const seen=[];
  for(let p=0;p<c.snapshot().pages;p++)seen.push(...c.go(p).rows);
  assert.deepEqual(seen,rows);assert.equal(c.go(99999).end,33000);
 }
 c.setSize('all');assert.equal(c.snapshot().rows,rows);assert.equal(rows.length,33000);
});
test('unchanged results preserve the page; filtering, sorting and refresh reset it',()=>{
 const rows=Array.from({length:201},(_,id)=>({id})),c=create(100);c.update(rows);c.go(2);
 assert.equal(c.update(rows.slice()).page,2);
 assert.equal(c.update(rows.filter(r=>r.id>=100)).page,0);
 c.go(1);assert.equal(c.update(rows.slice().reverse()).page,0);
 c.go(1);assert.equal(c.update(rows.map(r=>({...r}))).page,0);
 assert.equal(c.update([]).total,0);assert.equal(c.snapshot().pages,1);assert.equal(c.go(-3).page,0);
});
test('invalid preferences cannot create unbounded or empty ranges',()=>{
 for(const value of [null,0,1,-1,Infinity,'bad',{}])assert.equal(normalizeSize(value),50);
 assert.equal(normalizeSize('200'),200);assert.equal(normalizeSize('all'),'all');
 const c=create(200);c.update(Array.from({length:205},(_,id)=>({id})));
 assert.equal(c.go(1).rows.length,5);assert.equal(c.setSize(50).page,0);
});
