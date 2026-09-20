'use strict';
const fs=require('fs');
const path=require('path');
const C=require('./release-common');
const { parseReleaseManifest }=require('../electron/update/manifest');

function args(argv){const out={version:'',source:''};for(let i=0;i<argv.length;i+=1){const a=argv[i];if(a==='--source')out.source=String(argv[++i]||'');else if(!out.version)out.version=a;else C.fail('Bilinmeyen argüman: '+a,'RELEASE_ARG_INVALID');}return out;}
async function main(){
  const opt=args(process.argv.slice(2));if(!C.parseSemver(opt.version))C.fail('Promote için geçerli version verin. Örn: npm run release:promote -- 7.0.82','RELEASE_VERSION_INVALID');
  const source=C.releaseSource(opt.source);if(!source)C.fail('Release source yapılandırılmamış.','RELEASE_SOURCE_REQUIRED');
  const root=path.resolve(source),testManifestFile=path.join(root,'test','releases',`BuyerLog-${opt.version}.json`),raw=C.readJson(testManifestFile,null),testManifest=parseReleaseManifest(raw,'test');
  if(testManifest.version!==opt.version)C.fail('TEST release manifest version eşleşmiyor.','RELEASE_VERSION_MISMATCH');
  const testArtifact=path.join(root,'test',...testManifest.artifact.split('/'));
  if(!fs.existsSync(testArtifact))C.fail('TEST artifact bulunamadı.','RELEASE_ARTIFACT_MISSING');
  const hash=await C.sha256File(testArtifact);if(hash!==testManifest.sha256)C.fail('TEST artifact SHA-256 doğrulaması başarısız.','RELEASE_SHA_MISMATCH');
  const stableRoot=path.join(root,'stable'),stableReleases=path.join(stableRoot,'releases');C.ensureDir(stableReleases);
  const name=path.basename(testArtifact),target=path.join(stableReleases,name);await C.copyImmutable(testArtifact,target,hash);
  const stableHash=await C.sha256File(target);if(stableHash!==hash)C.fail('STABLE artifact TEST ile aynı değil.','RELEASE_PROMOTE_HASH_MISMATCH');
  const latest=C.readJson(path.join(stableRoot,'latest.json'),null);if(latest&&C.parseSemver(latest.version)&&C.compareSemver(latest.version,opt.version)>0)C.fail('STABLE kanalı daha yeni bir version taşıyor; downgrade promote reddedildi.','RELEASE_DOWNGRADE_BLOCKED');
  const stableManifest={...testManifest,channel:'stable',publishedAt:new Date().toISOString()};parseReleaseManifest(stableManifest,'stable');
  const per=path.join(stableReleases,`BuyerLog-${opt.version}.json`),existing=C.readJson(per,null);if(existing&&existing.sha256!==hash)C.fail('STABLE aynı version farklı binary içeriyor.','RELEASE_VERSION_IMMUTABLE');
  C.atomicWriteJson(per,stableManifest);fs.writeFileSync(target+'.sha256',`${hash}  ${name}\n`,'utf8');C.atomicWriteJson(path.join(stableRoot,'latest.json'),stableManifest);
  const verify=C.readJson(path.join(stableRoot,'latest.json'),null);if(verify.sha256!==testManifest.sha256)C.fail('Promote sonrası hash eşleşmiyor.','RELEASE_PROMOTE_HASH_MISMATCH');
  console.log(`STABLE promote OK: ${opt.version}`);console.log(`SHA-256 (TEST = STABLE): ${hash}`);
}
if(require.main===module)main().catch(error=>{console.error(`[${error.code||'RELEASE_FAILED'}] ${error.message}`);process.exitCode=1;});
module.exports={args,main};
