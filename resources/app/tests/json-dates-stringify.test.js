'use strict';
// sendDateSafeJson / page-cache writes used a per-key replacer; the toJSON form
// must produce byte-identical output and never leak the override.
const test=require('node:test'),assert=require('node:assert/strict');
const { stringifyWithDates }=require('../server/lib/json-dates');

const dateOnly=d=>{if(!(d instanceof Date)||isNaN(d))return null;const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
function replacerReference(value){return JSON.stringify(value,function(key,v){const raw=this[key];return raw instanceof Date?dateOnly(raw):v;});}

test('dates anywhere in the tree serialise exactly as with the replacer', () => {
  const value={rows:[{a:new Date(2026,9,28),b:'x',c:[new Date(Date.UTC(2026,0,1)),null,1]},{a:new Date('invalid'),nested:{d:new Date(2025,1,2,13,45)}}],
    at:new Date(2026,0,31),n:0,s:'2026-10-28',u:undefined,empty:{},list:[]};
  assert.equal(stringifyWithDates(value,dateOnly),replacerReference(value));
  assert.equal(stringifyWithDates(new Date(2026,4,5),dateOnly),replacerReference(new Date(2026,4,5)));
  assert.equal(stringifyWithDates([new Date('x')],dateOnly),'[null]');
});

test('the override is restored, also when serialisation throws', () => {
  const original=Date.prototype.toJSON;
  stringifyWithDates({a:new Date()},dateOnly);
  assert.equal(Date.prototype.toJSON,original);
  const circular={};circular.self=circular;
  assert.throws(()=>stringifyWithDates(circular,dateOnly),TypeError);
  assert.equal(Date.prototype.toJSON,original);
  assert.equal(JSON.stringify(new Date(Date.UTC(2026,0,1))),'"2026-01-01T00:00:00.000Z"');
});
