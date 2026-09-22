'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const DASH=fs.readFileSync(path.join(__dirname,'..','public','overview-collection-dashboard.js'),'utf8');

test('built-in Collection statuses may translate while custom statuses remain literal',()=>{
  const start=APP.indexOf('function kolStatusDisplayLabel('),end=APP.indexOf('\nfunction ',start+1),body=APP.slice(start,end);
  assert.match(body,/entry&&entry\.builtin\?L\(entry\.name\):String\(name\|\|''\)/);
  assert.match(DASH,/ctx\.statusLabel\(row\.status\)/);
});
