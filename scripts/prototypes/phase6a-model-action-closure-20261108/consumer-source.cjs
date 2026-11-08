'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const reviewed=require('../../../resources/app/tests/fixtures/orders-ready-integration/source.cjs');
const recipe=require('./patch-recipe.json');
const candidate=fs.readFileSync(path.join(__dirname,'app-main.js'),'utf8');
assert.equal(reviewed.hash(candidate),recipe.candidateSha256);
// Existing pins stay untouched: prove the exact predecessor before composing.
let reversed=candidate;
for(const edit of [...recipe.edits].reverse()){assert.equal(reversed.split(edit.next).length,2);reversed=reversed.replace(edit.next,edit.old);}
assert.equal(reversed,reviewed.current('public/app-main.js'));
module.exports={current:file=>file==='public/app-main.js'?candidate:reviewed.current(file),base:reviewed.base};
