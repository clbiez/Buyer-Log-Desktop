'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
for(const [pair,labels]of [[1,['a','b']],[2,['b','a']],[3,['a','b']]])for(const label of labels){
 const output=path.join(__dirname,`aa-${pair}-${label}.json`),r=spawnSync(process.execPath,[path.join(__dirname,'http-benchmark.cjs'),'/workspace/work/buyerlog-main944/resources/app','512',output],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}
