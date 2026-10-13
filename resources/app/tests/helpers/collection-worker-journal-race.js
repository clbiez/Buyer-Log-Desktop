'use strict';
// Test bootstrap loads the unchanged native worker. Only the real journal
// queue is interleaved with a real peer commit or grant-file change.
const {workerData}=require('node:worker_threads');Object.assign(process.env,workerData.env);
if(workerData.refreshRace){
 const module=require('../../server/lib/delta-store'),create=module.createDeltaStore;
 module.createDeltaStore=options=>{const delta=create(options),hydrate=delta.hydrate.bind(delta);let reads=0;delta.hydrate=async()=>{if(++reads===2){const peer=create(options);await peer.hydrate();const receipt=await module.createDocumentApi(peer).mirror(workerData.documentId,workerData.peerNative);if(!receipt.ok)throw receipt.error||Error('native peer write failed');}return hydrate();};return delta;};
}else{
const local=require('../../server/lib/local-db'),create=local.createLocalDb;
local.createLocalDb=(...args)=>{const db=create(...args),queue=db.queuePatches.bind(db);let fired=false;db.queuePatches=async(items,options)=>{if(!fired&&items.some(item=>item.id===workerData.target)){fired=true;if(workerData.grantFile)require('../../server/user-data').atomicWriteJson(workerData.grantFile,{revision:99,grants:[],migrations:{legacyInboundAccessV1:true}});else await create(...args).queuePatches([{id:workerData.target,entityType:'store',patch:workerData.peerPatch}]);}return queue(items,options);};return db;};
}
require('../../server/collection-save-worker');
