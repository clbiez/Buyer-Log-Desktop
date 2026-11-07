'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-local-images-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=root;process.env.BUYER_LOG_DATA_ROOT=root;process.env.BUYER_LOG_LOCAL_DATA_ROOT=root;process.env.BUYER_LOG_TEMP_ROOT=path.join(root,'temp');process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {createModelImageDistribution}=require('../server/lib/model-image-distribution');
const ownership=require('../server/lib/plm-image-ownership');
function fixture({alive=true,roleRefresh=false,batch=true}={}){
 const calls=[];const shared={available:async()=>{calls.push('available');return true;},lookup:async key=>{calls.push(key);return null;}};
 if(batch)shared.lookupMany=async keys=>{calls.push(keys);return new Map();};
 const store=ownership.emptyStore();
 const distribution=createModelImageDistribution({sharedStore:shared,getImage:ref=>alive&&ref?{}:null,ownership:{...ownership,canWriteAutomatic:(_,key)=>({allowed:key!=='plm:2'}),loadOwnership:()=>store}});
 return {calls,distribution,store};
}
test('INT-04: local and manual hits never resolve or scan the shared folder',async()=>{
 const {calls,distribution}=fixture();
 const plan=await distribution.plan([{plmId:'1'},{plmId:'2'}],{source:'PLM',imagemap:{'plm:1':'ci_local','plm:2':'ci_manual'}});
 assert.deepEqual(calls,[]);assert.equal(plan.local.length,1);assert.equal(plan.manualProtected.length,1);
});
for(const batch of [true,false])test(`INT-04: only unresolved identities reach shared lookup (batch=${batch})`,async()=>{
 const {calls,distribution}=fixture({batch});
 const plan=await distribution.plan([{plmId:'1'},{plmId:'2'},{plmId:'3'},{plmId:'3'}],{source:'ASAS',imagemap:{'plm:1':'ci_local','plm:2':'ci_manual'}});
 assert.deepEqual(calls,['available',batch?['plm:3']:'plm:3']);assert.equal(plan.upstream.length,1);assert.equal(plan.identities,3);
});
test('INT-04: selected/all refresh still consult shared metadata for live local files',async()=>{
 for(const mode of ['selected','all']){
  const {calls,distribution}=fixture();await distribution.plan([{plmId:'1'}],{source:'PLM',mode,imagemap:{'plm:1':'ci_local'}});
  assert.deepEqual(calls,['available',['plm:1']]);
 }
});
