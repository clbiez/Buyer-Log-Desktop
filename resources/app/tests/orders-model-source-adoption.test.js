'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {extractFunction}=require('./helpers/app-main-functions.js');
const APP=path.resolve(__dirname,'..'),ROOT=path.resolve(APP,'../..'),FIX=path.join(__dirname,'fixtures/orders-model-action-closure');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const actualSource=fs.readFileSync(path.join(APP,'public/app-main.js'),'utf8'),source=require('./fixtures/orders-import-action-closure/source.cjs').beforeImport(),recipe=require('./fixtures/orders-model-action-closure/adoption-edits.json');
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
 const proof=require('./fixtures/orders-model-action-closure/prior-pins/proof.json');const bytes=Buffer.from(actualSource),blob=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
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

test('compute schema app source pin has the exact unchanged older lineage, with every producer/schema pin retained',()=>{
 const file=path.join(FIX,'../orders-import-action-closure/foundation-prior-pins/compute-module-schema-source-pins.json');const bytes=fs.readFileSync(file);
 assert.equal(hash(bytes),'a16cdc26684644dfa42146a4a47b29b46a84e077e7b14147eb05c99de2cf124c');const old=JSON.parse(bytes),current=require('./fixtures/compute-module-schema/source-pins.json');
 const before=Buffer.from(predecessor()),blob=value=>crypto.createHash('sha1').update('blob '+value.length+'\0').update(value).digest('hex');
 assert.equal(blob(before),old.runtimeBlobs['public/app-main.js']);assert.equal(current.runtimeBlobs['public/app-main.js'],blob(Buffer.from(actualSource)));
 for(const [name,value]of Object.entries(old.runtimeBlobs))if(name!=='public/app-main.js')assert.equal(current.runtimeBlobs[name],value,name+' producer pin unchanged');
 for(const key of ['runtimeSchemaSha256','frozenSchemaFixture','frozenSchemaSha256'])assert.equal(current[key],old[key]);
});

test('the original switchTab and its prior outside-source hash survive the complete model/import lineage',()=>{
 const prior=require('./fixtures/orders-model-action-closure/prior-pins/profile-rejection-pins.json'),current=require('./fixtures/profile-rejection-pins.json');
 const before=predecessor(),oldSwitch=extractFunction(before,'switchTab'),currentSwitch=extractFunction(actualSource,'switchTab');
 assert.equal(hash(before.replace(oldSwitch,'__SWITCH_TAB__')),prior.outsideSwitchSha256,'the old outside-source proof is retained, not replaced');
 assert.equal(currentSwitch,oldSwitch,'model/import integration must not alter profile rejection handling');
 assert.equal(hash(currentSwitch),prior.currentSwitchSha256);
 assert.equal(hash(actualSource.replace(currentSwitch,'__SWITCH_TAB__')),current.outsideSwitchSha256);
 for(const key of ['baselineSwitchSha256','beforeAppSha256','currentSwitchSha256'])assert.equal(current[key],prior[key]);
});
