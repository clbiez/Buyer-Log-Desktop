'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {event}=require('./workload.cjs');
const {oracle}=require('./oracle.cjs');
const hashes=[];
for(const size of [10000,200000]){
 const seed=crypto.createHash('sha256'),mixed=crypto.createHash('sha256');
 for(let i=0;i<size;i++)seed.update(JSON.stringify(event(i,size))+'\n');
 for(let i=size;i<size+630;i++)mixed.update(JSON.stringify(event(i,size,'mixed'))+'\n');
 hashes.push({events:size,seedJsonLinesSha256:seed.digest('hex'),mixed630JsonLinesSha256:mixed.digest('hex'),seedBusinessOracle:oracle(size,0),finalBusinessOracle:oracle(size,630)});
}
fs.writeFileSync(process.argv[2],JSON.stringify(hashes,null,2)+'\n');
