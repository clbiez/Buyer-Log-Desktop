'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
test('registering a cold read keeps the source guard stable; publishing a live exact replica changes it',()=>{
  const publishedComputeSources=new Map(),context={publishedComputeSources,computeSourceBase:()=>({key:'k1'})};
  vm.createContext(context);vm.runInContext(extractFunction(source,'computeSourceToken')+';globalThis.read=computeSourceToken;',context);
  const cold=context.read('a');publishedComputeSources.set('a',{key:'k1',descriptor:{capability:'cold-random'}});assert.equal(context.read('a'),cold);
  publishedComputeSources.set('a',{key:'k1',descriptor:{capability:'exact-random',replicaFile:'private-file'}});assert.notEqual(context.read('a'),cold);
});
test('learning cold source metadata keeps the guard stable but a different source manifest invalidates it',()=>{
  let base={key:'empty',active:{},manifest:null};const publishedComputeSources=new Map(),context={publishedComputeSources,computeSourceBase:()=>base};
  vm.createContext(context);vm.runInContext(extractFunction(source,'computeSourceToken')+';globalThis.read=computeSourceToken;',context);
  const initial=context.read('a');publishedComputeSources.set('a',{key:'empty',guardToken:initial,descriptor:{loadedAt:null,capability:'cold'}});
  publishedComputeSources.set('a',{key:'source-1',guardToken:initial,descriptor:{loadedAt:'r1',capability:'cold'}});
  base={key:'source-1',active:{},manifest:{sourceLoadedAt:'r1'}};assert.equal(context.read('a'),initial);
  base={key:'source-2',active:{},manifest:{sourceLoadedAt:'r2'}};assert.notEqual(context.read('a'),initial);
});
