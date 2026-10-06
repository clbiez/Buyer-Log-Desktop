'use strict';
// Synthetic registry lookup benchmark. No image bytes, production data or network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const ref=process.argv[2]||'main';if(!/^[a-zA-Z0-9_./-]+$/.test(ref))throw Error('Invalid git ref');
const root=path.resolve(__dirname,'../../..'),relative='resources/app/public/model-image-cache.js';
const before=execFileSync('git',['show',`${ref}:${relative}`],{cwd:root,encoding:'utf8'}),after=fs.readFileSync(path.join(root,relative),'utf8');
function cache(source){const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports});return module.exports.createModelImageCache({});}
const registry=Object.fromEntries(Array.from({length:3000},(_,i)=>[`plm:${i}|colour:S01|name:SIYAH`,`synthetic-${i}`]));
const old=cache(before),current=cache(after);old.setRegistryMap(registry);current.setRegistryMap(registry);
const queries=Array.from({length:600},(_,i)=>i%3===0?i+5000:i*3);
function run(api){return queries.map(id=>[api.hasRegistryKey(id,'S01'),api.resolveRegistrySource(id,'S01')]);}
assert.deepEqual(JSON.parse(JSON.stringify(run(old))),JSON.parse(JSON.stringify(run(current))));
const samples={before:[],after:[]};for(let i=0;i<9;i++)for(const key of i%2?['after','before']:['before','after']){const t=performance.now();run(key==='before'?old:current);samples[key].push(performance.now()-t);}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
console.log(JSON.stringify({ref,registryKeys:3000,queries:600,samples:9,outputsEqual:true,medianMs:{before:median(samples.before),after:median(samples.after)}},null,2));
