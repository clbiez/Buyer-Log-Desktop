'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const APP=path.resolve(__dirname,'../../..'),recipe=require('./integration-edits.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function current(file){const s=fs.readFileSync(path.join(APP,file),'utf8');assert.equal(hash(s),recipe.candidateSha256[file],'exact adopted ready integration '+file);return s;}
function base(file){let s=current(file);for(const edit of recipe.edits.filter(e=>e.file===file).reverse()){
 assert.equal(s.split(edit.next).length,2,'one exact reverse anchor');s=s.replace(edit.next,edit.old);
}assert.equal(hash(s),recipe.baseSha256[file],'all predecessor bytes preserved '+file);return s;}
module.exports={APP,current,base,recipe,hash};
