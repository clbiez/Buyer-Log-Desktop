'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../public/collection-lfl-engine');
test('cooperative LFL recovery preserves complete seasonal, monthly, country and cumulative summaries',async()=>{
 const rows=Array.from({length:30000},(_,i)=>({orderCode:'DEMO-'+(i%12000),season:i%2?'S6':'S5',mag:'CU4E',classification:'K',inStoreMonth:i%3?'2026-02':'2026-03',fob:i%11,quantity:i%7?100:0,country:i%5?'CHINA':'TURKEY'}));
 rows.push({orderCode:'UNDATED',season:'S6',mag:'CU4E',classification:'K',fob:4,quantity:100,country:'CHINA'});
 const expected=engine.buildReferences(rows);let yields=0;
 const actual=await engine.buildReferencesAsync(rows,()=>new Promise(resolve=>setImmediate(()=>{yields++;resolve();})));
 assert.ok(yields>0,'large recovery must give other server requests a turn');
 assert.deepEqual(actual,expected,'all quantities, distinct orders, countries and cumulative metadata match');
 await assert.rejects(engine.buildReferencesAsync(rows,async()=>{throw Object.assign(Error('Source replaced'),{code:'COMPUTE_STALE_GENERATION'});}),{code:'COMPUTE_STALE_GENERATION'});
});
test('ASCII shortcut keeps Turkish folded identifiers and whitespace semantics',()=>{
 assert.equal(engine.previousSeason(' i07 '),'I06');assert.equal(engine.previousSeason(' ı07 '),'I06');
 const row={orderCode:'demo',season:'s6',mag:'i',classification:'lisans',inStoreMonth:'2026-02',fob:10,quantity:100,country:'CHINA'};
 const a=engine.buildReferences([row]),b=engine.buildReferences([{...row,season:'S6',mag:'İ',classification:'LİSANS'}]);
 assert.deepEqual(a,b);
});
