'use strict';
const fs=require('node:fs'),path=require('node:path'),read=fs.readdirSync;
let injected=false,leak;
fs.readdirSync=function(directory,...args){
 const result=read.call(this,directory,...args);
 if(!injected&&path.basename(String(directory)).startsWith('buyerlog-int03-test-')){
  injected=true;leak=path.join(String(directory),'buyerlog-plm-int03-owned-leak-proof');fs.mkdirSync(leak);
 }
 return result;
};
process.on('exit',()=>{if(leak)fs.rmSync(leak,{recursive:true,force:true});});
