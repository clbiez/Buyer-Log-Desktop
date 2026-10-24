'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const signature=require('../electron/manual-patch/signature');
const official=require('../electron/update/signature');
const pair=()=>{const key=crypto.generateKeyPairSync('ed25519');return {privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:key.publicKey.export({type:'spki',format:'pem'})};};
const first=pair(),second=pair(),hash='a'.repeat(64),keys=official.normalizeKeys({keys:[{publicKey:first.publicKey}]});
function manifest(){return {schema:signature.SCHEMA,product:'BuyerLog',sequence:1,baseVersion:'7.0.294',baseSourceCommit:'a'.repeat(40),sourceCommit:'b'.repeat(40),minimumBootstrapVersion:'1.1.0',bootstrapSha256:hash,artifact:{name:'BuyerLog-SignedPatch-1.zip',size:42,sha256:hash},files:['electron/app-integrity.json','electron/main.js','electron/manual-patch/bootstrap.json','package.json','public/index.html','server/server.js'].map(path=>({path,size:1,sha256:hash})),changes:[{path:'server/server.js',kind:'replace',beforeSha256:[hash]}],releaseNotes:{tr:'Sentetik test yaması',en:'Synthetic test patch'}};}
const signed=value=>signature.signManifest(value||manifest(),first.privateKey);
test('a v3 publisher signature verifies offline only under an installed pinned key',()=>{
 assert.deepEqual(signature.verifyManifest(signed(),keys),{verified:true,keyId:keys[0].keyId});
 assert.throws(()=>signature.verifyManifest(manifest(),[]),{code:'PATCH_TRUST_UNAVAILABLE'});
 assert.throws(()=>signature.verifyManifest(manifest(),keys),{code:'PATCH_SIGNATURE_MISSING'});
 assert.throws(()=>signature.verifyManifest(signed(),official.normalizeKeys({keys:[{publicKey:second.publicKey}]})),{code:'PATCH_SIGNATURE_INVALID'});
});
test('coherent payload/hash replacement cannot reuse the publisher signature',()=>{
 for(const mutate of [m=>m.artifact.sha256='b'.repeat(64),m=>m.files[2].sha256='b'.repeat(64),m=>m.sequence++,m=>m.sourceCommit='c'.repeat(40),m=>m.baseSourceCommit='d'.repeat(40),m=>m.bootstrapSha256='b'.repeat(64),m=>m.releaseNotes.en='Different instructions']){
  const m=signed();mutate(m);assert.throws(()=>signature.verifyManifest(m,keys),{code:'PATCH_SIGNATURE_INVALID'});
 }
});
test('official release signatures cannot authorize the separate manual-patch domain',()=>{
 const m=manifest();m.signature=official.signManifest({version:'7.0.294',artifact:m.artifact.name,size:42,sha256:hash},first.privateKey);
 assert.throws(()=>signature.verifyManifest(m,keys),{code:'PATCH_SIGNATURE_INVALID'});
 const fake=signed();fake.trustedKeys=[second.publicKey];assert.throws(()=>signature.verifyManifest(fake,keys),{code:'PATCH_MANIFEST_INVALID'});
});
test('pinned-key overlap permits rotation while a removed key no longer verifies',()=>{
 const overlap=official.normalizeKeys({keys:[{publicKey:first.publicKey},{publicKey:second.publicKey}]}),next=signature.signManifest(manifest(),second.privateKey);
 signature.verifyManifest(signed(),overlap);signature.verifyManifest(next,overlap);
 assert.throws(()=>signature.verifyManifest(signed(),overlap.slice(1)),{code:'PATCH_SIGNATURE_INVALID'});
});
test('ambiguous Windows paths, duplicate aliases and protected code changes fail closed',()=>{
 for(const bad of ['../server.js','/server.js','C:/server.js','server\\server.js','server/a:stream','server/CON.txt','server/file.','server/file ','server//file','server/data/config.json']){
  const m=manifest();m.changes[0].path=bad;assert.throws(()=>signed(m),{code:'PATCH_MANIFEST_INVALID'},bad);
 }
 for(const protectedFile of ['electron/launcher.js','electron/update/release-signing-keys.json','electron/manual-patch/signature.js']){
  const m=manifest();m.changes[0].path=protectedFile;assert.throws(()=>signed(m),{code:'PATCH_MANIFEST_INVALID'});
 }
 const duplicate=manifest();duplicate.files.push({...duplicate.files[4],path:'public/INDEX.html'});duplicate.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);assert.throws(()=>signed(duplicate),{code:'PATCH_MANIFEST_INVALID'});
});
test('invalid sequence, incomplete manifests and oversized/unknown metadata are rejected',()=>{
 for(const mutate of [m=>m.sequence=0,m=>m.sequence=Number.MAX_SAFE_INTEGER+1,m=>m.minimumBootstrapVersion='1.0.0',m=>m.files.pop(),m=>m.artifact.size=2**40,m=>m.files[0].extra='unsigned',m=>m.changes[0].kind='execute']){
  const m=manifest();mutate(m);assert.throws(()=>signed(m),{code:'PATCH_MANIFEST_INVALID'});
 }
});
