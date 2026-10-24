'use strict';
// v3 has its own signed domain. Trust always comes from the installed bootstrap.
const crypto=require('node:crypto');
const {compareSemver}=require('../update/semver');
const {keyIdFor,parseSignature}=require('../update/signature');
const SCHEMA='buyer-log-manual-patch/v3',PRODUCT='BuyerLog',BOOTSTRAP_VERSION='1.1.0';
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_FILES=30000,MAX_BYTES=1024*1024*1024;
const IMMUTABLE_RUNTIME=['server/lib/update-trial-backend.js','server/lib/shared-file-transaction.js','server/lib/lease-worker-registry.js'];
function fail(code,tr,en){throw Object.assign(new Error(tr+' / '+en),{code});}
function invalid(){fail('PATCH_MANIFEST_INVALID','İmzalı yama tanımı geçersiz.','The signed patch manifest is invalid.');}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))invalid();}
function filePath(value){
 if(typeof value!=='string'||!value||value.length>240||value!==value.normalize('NFC')||/[\\\x00-\x1f\x7f:<>"|?*]/.test(value)||value.startsWith('/'))invalid();
 const parts=value.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))invalid();
 if(value==='config.json'||value.startsWith('server/data/')||value==='server/data'||parts.some(part=>part==='.git'||part==='.desktop-dev'||part==='dist-updates'||part==='dist-installer'||part==='tests'))invalid();
 return value;
}
function mutablePath(value){return !IMMUTABLE_RUNTIME.includes(value)&&(value.startsWith('public/')||value.startsWith('server/'));}
function sortedUnique(entries,keyOf){
 let previous='';const seen=new Set();
 for(const entry of entries){const key=filePath(keyOf(entry)),alias=key.normalize('NFKC').toUpperCase();
  if(previous&&previous>=key||seen.has(alias))invalid();previous=key;seen.add(alias);
 }
}
function validateManifest(manifest,{signed=true}={}){
 const fields=['schema','product','sequence','baseVersion','baseSourceCommit','sourceCommit','minimumBootstrapVersion','bootstrapSha256','artifact','files','changes','releaseNotes'];
 exact(manifest,signed?[...fields,'signature']:fields);
 const m=manifest;
 if(m.schema!==SCHEMA||m.product!==PRODUCT||!Number.isSafeInteger(m.sequence)||m.sequence<1||!VERSION.test(m.baseVersion)||!COMMIT.test(m.baseSourceCommit)||!COMMIT.test(m.sourceCommit)||m.baseSourceCommit===m.sourceCommit||!VERSION.test(m.minimumBootstrapVersion)||compareSemver(m.minimumBootstrapVersion,BOOTSTRAP_VERSION)<0||!HASH.test(m.bootstrapSha256))invalid();
 exact(m.artifact,['name','size','sha256']);
 if(typeof m.artifact.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.zip$/.test(m.artifact.name)||!Number.isSafeInteger(m.artifact.size)||m.artifact.size<1||m.artifact.size>MAX_BYTES||!HASH.test(m.artifact.sha256))invalid();
 if(!Array.isArray(m.files)||!m.files.length||m.files.length>MAX_FILES||!Array.isArray(m.changes)||!m.changes.length||m.changes.length>MAX_FILES)invalid();
 let bytes=0;const files=new Map();
 for(const file of m.files){exact(file,['path','size','sha256']);filePath(file.path);
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>128*1024*1024||!HASH.test(file.sha256))invalid();bytes+=file.size;if(bytes>MAX_BYTES)invalid();files.set(file.path,file);
 }
 sortedUnique(m.files,file=>file.path);
 for(const required of ['package.json','electron/main.js','server/server.js','public/index.html','electron/app-integrity.json','electron/manual-patch/bootstrap.json'])if(!files.has(required))invalid();
 for(const change of m.changes){exact(change,['path','kind','beforeSha256']);filePath(change.path);
  if(!mutablePath(change.path)||!['replace','delete'].includes(change.kind)||!Array.isArray(change.beforeSha256)||!change.beforeSha256.length||change.beforeSha256.length>512)invalid();
  const beforeKeys=change.beforeSha256.map(value=>{if(value!==null&&!HASH.test(value))invalid();return value||'';});
  if(beforeKeys.some((value,i)=>i&&beforeKeys[i-1]>=value))invalid();
  if(change.kind==='replace'?!files.has(change.path):[...files.keys()].some(name=>name.normalize('NFKC').toUpperCase()===change.path.normalize('NFKC').toUpperCase()))invalid();
 }
 sortedUnique(m.changes,change=>change.path);
 exact(m.releaseNotes,['tr','en']);for(const lang of ['tr','en'])if(typeof m.releaseNotes[lang]!=='string'||!m.releaseNotes[lang].trim()||m.releaseNotes[lang].length>8000)invalid();
 if(signed){try{parseSignature(m.signature);}catch(_){fail('PATCH_SIGNATURE_INVALID','Yama imzası geçersiz.','The patch signature is invalid.');}}
 return m;
}
function unsigned(manifest){const value={...manifest};delete value.signature;return validateManifest(value,{signed:false});}
function signedPayload(manifest){
 const m=unsigned(manifest);
 return Buffer.from(JSON.stringify([SCHEMA,PRODUCT,m.sequence,m.baseVersion,m.baseSourceCommit,m.sourceCommit,m.minimumBootstrapVersion,m.bootstrapSha256,
  [m.artifact.name,m.artifact.size,m.artifact.sha256],m.files.map(file=>[file.path,file.size,file.sha256]),m.changes.map(change=>[change.path,change.kind,change.beforeSha256]),[m.releaseNotes.tr,m.releaseNotes.en]]),'utf8');
}
function signManifest(manifest,privateKey){
 const key=crypto.createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ed25519')invalid();
 const value=crypto.sign(null,signedPayload(manifest),key).toString('base64');
 return {...unsigned(manifest),signature:{alg:'ed25519',keyId:keyIdFor(crypto.createPublicKey(key)),value}};
}
function verifyManifest(manifest,trustedKeys){
 if(!Array.isArray(trustedKeys)||!trustedKeys.length)fail('PATCH_TRUST_UNAVAILABLE','Kurulu imza anahtarı yok; imzalı tam kurulum gerekli.','Installed signing keys are missing; a signed full installation is required.');
 if(!manifest?.signature)fail('PATCH_SIGNATURE_MISSING','Yayıncı imzası gerekli.','A publisher signature is required.');
 validateManifest(manifest);
 const signature=parseSignature(manifest.signature),trusted=trustedKeys.find(item=>item.keyId===signature.keyId);
 if(!trusted||trusted.key?.asymmetricKeyType!=='ed25519'||!crypto.verify(null,signedPayload(manifest),trusted.key,Buffer.from(signature.value,'base64')))fail('PATCH_SIGNATURE_INVALID','Yama güvenilen yayıncı tarafından imzalanmamış.','The patch is not signed by a trusted publisher.');
 return {verified:true,keyId:signature.keyId};
}
module.exports={SCHEMA,PRODUCT,BOOTSTRAP_VERSION,MAX_FILES,MAX_BYTES,IMMUTABLE_RUNTIME,filePath,mutablePath,validateManifest,signedPayload,signManifest,verifyManifest,fail};
