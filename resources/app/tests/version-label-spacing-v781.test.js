'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');

test('v7.81 sürüm etiketi Buyer Log adından birkaç piksel aşağıda konumlanır',()=>{
  assert.match(CSS,/\.brandName small\{[^}]*margin-top:3px/);
});
