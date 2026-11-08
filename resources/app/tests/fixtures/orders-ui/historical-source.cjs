'use strict';
// Reconstruct the exact already-reviewed baseline without requiring Git history
// in a shallow CI checkout or adding another whole-app snapshot.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const legacySha='ad985cfd3345de35a8c105539d430fa11f1bbd329cedcd3b3896efdcc989a515';
const retiredSha='d0885781d9b9a5e88135a1fd7a7c9c309603d4f4484191219079408ad1237810';
let legacy,retired,configured;
function forward(source,patch){
 const input=source.split('\n'),lines=patch.split('\n'),output=[];let cursor=0,hunks=0;
 for(let index=0;index<lines.length;index++){
  const header=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]);
  if(!header)continue;
  assert.ok(++hunks<=64,'bounded historical source patch');
  const start=Number(header[1])-1,oldCount=header[2]===undefined?1:Number(header[2]),newCount=header[4]===undefined?1:Number(header[4]);
  assert.ok(start>=cursor&&start<=input.length,'ordered historical patch');
  output.push(...input.slice(cursor,start));cursor=start;let before=0,after=0;
  for(index++;index<lines.length&&!lines[index].startsWith('@@');index++){
   const line=lines[index];if(line===''&&index===lines.length-1)break;
   assert.ok([' ','-','+'].includes(line[0]),'only exact unified text hunks');
   const value=line.slice(1);
   if(line[0]!=='+' ){assert.equal(input[cursor],value,'historical context/removal must match');cursor++;before++;}
   if(line[0]!=='-'){output.push(value);after++;}
  }
  assert.equal(before,oldCount);assert.equal(after,newCount);index--;
 }
 assert.ok(hunks>0);return [...output,...input.slice(cursor)].join('\n');
}
function legacyApp(){
 if(!legacy){
  const before=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../orders-table-summary/app-main-before.js.gz'))).toString('utf8');
  legacy=require('../orders-sync-provider/patch-recipe.cjs').app(require('../orders-table-summary/patch-recipe.cjs').app(before));
  assert.equal(sha(legacy),legacySha,'exact existing baseline replay');
 }
 return legacy;
}
function read(ref,file){
 assert.ok(['0d127f58db13051d4714abf54fed3b6c000a7607','5829fcf4fa4ec9b7bfb1815bb43577943177dd38'].includes(ref),'known immutable source reference');
 if(file==='public/app-main.js'){
  if(ref.startsWith('0d127'))return legacyApp();
  if(!retired){retired=forward(legacyApp(),zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'core-retirement-forward.patch.gz'))).toString('utf8'));assert.equal(sha(retired),retiredSha,'exact corrected retirement replay');}
  return retired;
 }
 const names={'public/quick-filter-groups.js':'quick-filter-groups-before.js','public/selection-action-bar.js':'selection-action-bar-before.js'};
 assert.ok(Object.hasOwn(names,file),'known bounded UI fixture');return fs.readFileSync(path.join(__dirname,names[file]),'utf8');
}
function configurationBase(){
 if(!configured){
  const origin=read('5829fcf4fa4ec9b7bfb1815bb43577943177dd38','public/app-main.js');
  const delta=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'configuration-forward.patch.gz'))).toString('utf8');
  configured=forward(origin,delta);
  assert.equal(sha(configured),'54f6484b4582fbcff16fd033fa61a048da53f239664a61196d70c5345e462f99','exact reviewed configuration delta before the unchanged UI recipe');
 }
 return configured;
}
module.exports=Object.freeze({read,configurationBase});
