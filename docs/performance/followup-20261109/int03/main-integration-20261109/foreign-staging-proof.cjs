'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const globalTemp=os.tmpdir(),foreign=path.join(globalTemp,'buyerlog-plm-int03-foreign-proof-'+process.pid),read=fs.readdirSync;
let injected=false;
fs.readdirSync=function(directory,...args){
 const result=read.call(this,directory,...args);
 if(!injected&&path.resolve(String(directory))===globalTemp){
  injected=true;fs.mkdirSync(foreign);console.error('[foreign-staging-proof] created an unrelated staging directory after the baseline scan');
 }
 return result;
};
process.on('exit',()=>{if(injected)fs.rmSync(foreign,{recursive:true,force:true});});
