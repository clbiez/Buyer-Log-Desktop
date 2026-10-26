'use strict';
// Delays one real state read after the remote envelope was read. No fabricated I/O.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const root=path.dirname(process.env.BUYER_LOG_SERVER_DATA_ROOT),read=fsp.readFile;let held=false;
fsp.readFile=async function(file,...args){
 if(!held&&String(file).endsWith('collection-replication-state.json')&&fs.existsSync(path.join(root,'base-race-armed'))){
  held=true;fs.writeFileSync(path.join(root,'state-entered'),'1');const start=Date.now();
  while(!fs.existsSync(path.join(root,'state-release'))){if(Date.now()-start>20000)throw Error('state barrier deadline');await new Promise(r=>setTimeout(r,10));}
 }
 return read.call(this,file,...args);
};
require('../../../resources/app/server/server.js');
