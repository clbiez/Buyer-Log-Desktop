'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const baseline='/workspace/work/buyerlog-main944/resources/app',candidate='/workspace/work/buyerlog-pr944/resources/app';
const arms=[['main-160',baseline,160],['main-1',baseline,512],['candidate-1',candidate,512],['candidate-2',candidate,512],['main-2',baseline,512],['main-3',baseline,512],['candidate-3',candidate,512],['recovery-final-1',candidate,160],['recovery-final-2',candidate,160],['recovery-final-3',candidate,160]];
for(const [label,app,budget]of arms){const r=spawnSync(process.execPath,[path.join(__dirname,'http-benchmark.cjs'),app,String(budget),path.join(__dirname,label+'.json')],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
