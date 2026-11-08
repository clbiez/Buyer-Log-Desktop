'use strict';
// Synthetic process-loss probe. This is not a physical power-loss simulator.
const fs=require('node:fs/promises'),{createLocalDb}=require('./helpers/native-verifier-subject.cjs');
const file=process.argv[2];if(!file)throw Error('native fixture file required');
const original=fs.open;fs.open=async function(target,...args){const handle=await original.call(this,target,...args);if(String(target)===file+'.wal')handle.sync=async()=>process.exit(91);return handle;};
createLocalDb(file,{walMaxBytes:64*1024*1024}).privateRecordTransaction(()=>({records:{'native-test:receipt':{doc:{kind:'native-test',transactionId:'child-unconfirmed'}}}})).then(()=>process.exit(92),error=>{process.stderr.write(String(error.stack||error));process.exit(93);});
