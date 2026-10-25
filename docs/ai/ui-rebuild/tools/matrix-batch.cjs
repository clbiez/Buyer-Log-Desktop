'use strict';
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);for(const recipe of args){const log='/tmp/bl-p3-matrix-'+recipe+'.log',fd=fs.openSync(log,'a'),script=recipe==='entry'?'matrix-entry.cjs':'matrix-recipes.cjs';console.log('START',recipe);const result=spawnSync(process.execPath,[path.join(__dirname,script),...(recipe==='entry'?[]:[recipe])],{stdio:['ignore',fd,fd],env:process.env});fs.closeSync(fd);console.log('END',recipe,result.status);if(result.status!==0)process.exit(result.status||1);}
