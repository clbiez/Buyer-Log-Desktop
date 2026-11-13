const fs=require('fs'),path=require('path');const {parseJsonBuffer,jsonToBuffer}=require('/home/user/Buyer-Log-Desktop/resources/app/server/lib/large-json');
const dir=process.argv[2];const f=path.join(dir,'local/BuyerLogLocal.db');
const s=parseJsonBuffer(fs.readFileSync(f));const at='2026-11-01T00:00:00.000Z';
s.migrations={...(s.migrations||{}),legacyAssets:{at,count:0,status:'archived'},'deltaStoreSeed:plm-style-link':{at,count:0,mode:'shadow'},collectionLegacyDeltaQuarantineV1:{at,inspected:0,removed:0,quarantined:0,pending:0,status:'active-delta-retired'}};
s.collectionReplicationRecovery={version:1,entries:{},updatedAt:at};
const b=jsonToBuffer(s);fs.writeFileSync(f,b);fs.writeFileSync(f+'.bak',b);for(const x of ['.wal','.wal.bak'])try{fs.unlinkSync(f+x)}catch(_){}
console.log(dir,b.length);
