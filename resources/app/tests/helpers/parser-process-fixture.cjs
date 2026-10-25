'use strict';
process.once('message',({operation,payload})=>{if(operation==='crash')process.exit(2);if(operation==='spin'){const end=Date.now()+payload.ms;while(Date.now()<end){};}process.send({ok:true,result:{bytes:payload.buffer?.byteLength||0}});});
