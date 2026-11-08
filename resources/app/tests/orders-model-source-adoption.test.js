'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {extractFunction}=require('./helpers/app-main-functions.js');
const APP=path.resolve(__dirname,'..'),ROOT=path.resolve(APP,'../..'),FIX=path.join(__dirname,'fixtures/orders-model-action-closure');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const source=fs.readFileSync(path.join(APP,'public/app-main.js'),'utf8'),recipe=require('./fixtures/orders-model-action-closure/adoption-edits.json');
function predecessor(){let text=source;for(const edit of [...recipe.edits].reverse()){assert.equal(text.split(edit.next).length,2);text=text.replace(edit.next,edit.old);}assert.equal(hash(text),'b6659e5c522d8584cceaf5414e4f70e0e30b7ffc24d3d2de9c0bf5b6469bf666');return text;}
test('new model layer exactly reconstructs the complete unchanged predecessor and forward candidate',()=>{
 let text=predecessor();for(const edit of recipe.edits){assert.equal(text.split(edit.old).length,2);text=text.replace(edit.old,edit.next);}assert.equal(text,source);assert.equal(hash(source),recipe.candidateSha256);
});
test('only the four model functions and original private helper block change outside the predecessor',()=>{
 const names=['modelConnLoad','writeCpModelColumn','removeCpModelColumn','openCpModelColumnModal'];
 const strip=text=>names.reduce((value,name)=>value.replace(extractFunction(value,name),'/* '+name+' */'),text);
 const helper=fs.readFileSync(path.join(ROOT,'scripts/prototypes/phase6a-model-action-closure-20261108/action-ownership.js'),'utf8')+'\n';
 assert.equal(source.split(helper).length,2);assert.equal(strip(source).replace(helper,''),strip(predecessor()));
});
test('all adopted source pins remain exact and their original files remain hash-pinned snapshots',()=>{
 const proof=require('./fixtures/orders-model-action-closure/prior-pins/proof.json');const bytes=Buffer.from(source),blob=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 for(const [file,entry] of Object.entries(proof)){
  assert.equal(hash(fs.readFileSync(path.join(APP,entry.snapshot))),entry.priorSha256);const current=JSON.parse(fs.readFileSync(path.join(APP,file),'utf8'));
  if(current.captures){assert.equal(current.captures['app-main.js'].sha256,hash(bytes));assert.equal(current.captures['app-main.js'].gitBlob,blob);}
  else assert.equal(current.files['public/app-main.js'],hash(bytes));
 }
});
test('all contribution model ownership bodies and the old consumer assertions stay byte-identical',()=>{
 const original=fs.readFileSync(path.join(ROOT,'scripts/prototypes/phase6a-model-action-closure-20261108/model-action.test.cjs'));
 assert.deepEqual(fs.readFileSync(path.join(FIX,'model-action.test.cjs')),original);
 const consumer=fs.readFileSync(path.join(__dirname,'fixtures/orders-ready-integration/consumer/remaining-consumer-gates.test.cjs'),'utf8');
 assert.equal(hash(consumer.slice(consumer.indexOf("test('QFG save"))),"4e86aef9d67563080f64c75823b060802c4d1a0d217c3c7e28532546f76a2772");
 const prior=require('./fixtures/orders-model-action-closure/predecessor-integration-edits.json');assert.equal(prior.candidateSha256['public/app-main.js'],'b6659e5c522d8584cceaf5414e4f70e0e30b7ffc24d3d2de9c0bf5b6469bf666');
});
