'use strict';
const assert=require('node:assert/strict'),reviewed=require('../orders-ready-integration/source.cjs'),recipe=require('./integration-edits.json');
function beforeImport(){let s=reviewed.current('public/app-main.js');for(const e of [...recipe.edits].reverse()){assert.equal(s.split(e.next).length,2,'exact original import layer');s=s.replace(e.next,e.old);}assert.equal(reviewed.hash(s),recipe.baseSha256,'exact model layer before import');return s;}
module.exports={beforeImport};
