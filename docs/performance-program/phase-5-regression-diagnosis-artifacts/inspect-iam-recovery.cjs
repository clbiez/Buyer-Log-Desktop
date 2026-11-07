'use strict';
// Read-only candidate diagnosis: expose existing private selectors in a child
// module instance. Do not change production files, migrate or authenticate.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-auth-diag-'));
try{
 const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BUYER_LOG_')));
 for(const key of Object.keys(process.env))if(key.startsWith('BUYER_LOG_'))delete process.env[key];
 Object.assign(process.env,inherited,{BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'auth'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_PORTABLE_DATA_ROOT:path.join(root,'no-other-install'),APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),BL_HOST_APPDATA:'',BL_HOST_LOCALAPPDATA:''});
 fs.mkdirSync(process.env.BUYER_LOG_AUTH_DATA_ROOT,{recursive:true});fs.writeFileSync(process.env.BUYER_LOG_CONFIG_PATH,'{}');
 const file='/workspace/Buyer-Log-Desktop/resources/app/server/lib/user-access.js',source=fs.readFileSync(file,'utf8');
 const diagnostic=`\nmodule.exports.__candidateDiagnostic=()=>legacyAccessCandidates().map(accessStoreQuality).filter(Boolean).sort(compareAccessStoreQuality).filter(q=>{const m=q.parsed?.moderator;return m&&typeof m==='object'&&!Array.isArray(m)&&credentialHash(m)&&hasUsableOfflineAuthStore(q.parsed);}).map(q=>({file:q.file,credentialCount:q.credentialCount,userCount:q.userCount,revision:q.revision}));`;
 const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));loaded._compile(source+diagnostic,file);
 const candidates=loaded.exports.__candidateDiagnostic();
 const capture='/tmp/buyerlog-perf-ui-CzOcfG/data/user-access.json';
 console.log(JSON.stringify({temporaryParent:os.tmpdir(),productionSourceSha256:crypto.createHash('sha256').update(source).digest('hex'),protectedCandidateCount:candidates.length,ownCaptureIsRecoveryCandidate:candidates.some(c=>c.file===capture),firstCandidates:candidates.slice(0,8)},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
