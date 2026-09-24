'use strict';
/* Publish the already-built GitHub-capable artifact to the legacy folder source. */
const fs=require('fs');
const path=require('path');
const C=require('./release-common');
const {parseReleaseManifest}=require('../electron/update/manifest');

async function main(){
  const [bundleDir,source,...extra]=process.argv.slice(2);
  if(!bundleDir||!source||extra.length)C.fail('Kullanım: bridge-publish.js BUNDLE_DIR OLD_RELEASE_FOLDER','RELEASE_ARG_INVALID');
  const manifest=parseReleaseManifest(C.readJson(path.join(bundleDir,'latest.test.json'),null),'test');
  const artifactName=path.posix.basename(manifest.artifact),artifactFile=path.join(bundleDir,artifactName);
  if(!fs.existsSync(artifactFile)||await C.sha256File(artifactFile)!==manifest.sha256||fs.statSync(artifactFile).size!==manifest.size)
    C.fail('Bridge artifact SHA/boyut doğrulaması başarısız.','RELEASE_SHA_MISMATCH');
  const built={artifactName,artifactFile,sha256:manifest.sha256,size:manifest.size,manifest};
  await C.publishManifest(source,'test',built);
  console.log(`Legacy TEST bridge yayınlandı: ${manifest.version} · ${manifest.sha256}`);
  console.log(`Moderator doğrulamasından sonra aynı klasörde npm run release:promote -- ${manifest.version} --source "${source}" çalıştırın.`);
}
if(require.main===module)main().catch(error=>{console.error(`[${error.code||'RELEASE_FAILED'}] ${error.message}`);process.exitCode=1;});
module.exports={main};
