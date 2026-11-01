'use strict';
// Keep update ZIPs compatible with STORE-only clients and GitHub's blob limit.
// Historical screenshots stay byte-identical in a separate, additive archive.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {compareSemver}=require('../electron/update/semver');
const {parseGitHubSource}=require('../electron/update/github-provider');
const MAX_RAW_MIRROR_BYTES=100*1024*1024;
const ASSET_MAP='public/release-notes/asset-locations.json';
const VISUAL_BRANCH='release-visuals';
function fail(message){throw Object.assign(new Error(message),{code:'RELEASE_VISUAL_ASSET_INVALID'});}
function visualAssets(appRoot){
  const root=path.join(appRoot,'public/release-notes'),assets=[];
  if(!fs.existsSync(root))return assets;
  for(const dir of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(!/^\d+\.\d+\.\d+$/.test(dir.name))continue;
    if(!dir.isDirectory())fail('Release archive must contain regular directories.');
    const folder=path.join(root,dir.name),releaseFile=path.join(folder,'release.json');
    if(!fs.existsSync(releaseFile))continue;
    const release=JSON.parse(fs.readFileSync(releaseFile,'utf8')),seen=new Set();
    for(const change of release.changes||[]){
      const name=change.visual?.src;if(!name||seen.has(name))continue;seen.add(name);
      if(!/^[A-Za-z0-9_.-]+\.(png|svg|jpg|jpeg|webp)$/i.test(name)||name.includes('..'))fail('Unsafe release visual filename.');
      const file=path.join(folder,name),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_RAW_MIRROR_BYTES)fail('Release visual must fit in a regular Git blob.');
      const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      assets.push({key:dir.name+'/'+name,relative:'public/release-notes/'+dir.name+'/'+name,file,size:stat.size,sha256,version:dir.name});
    }
  }
  return assets;
}
function planVisualAssets(appRoot,source,{keepVersions=3}={}){
  const assets=visualAssets(appRoot),external=new Set();
  if(!source)return {external,map:null}; // Offline/folder distributions keep their complete archive.
  const {owner,repo}=parseGitHubSource(source);
  const versions=[...new Set(assets.map(a=>a.version))].sort((a,b)=>compareSemver(b,a));
  const bundled=new Set(versions.slice(0,keepVersions)),files={};
  for(const asset of assets)if(!bundled.has(asset.version)){
    external.add(asset.relative);files[asset.key]={sha256:asset.sha256,size:asset.size};
  }
  return {external,map:{schemaVersion:1,baseUrl:`https://raw.githubusercontent.com/${owner}/${repo}/${VISUAL_BRANCH}/`,files}};
}
function assertMirrorable(manifest){
  if(!Number.isSafeInteger(manifest.size)||manifest.size<=0||manifest.size>MAX_RAW_MIRROR_BYTES)
    throw Object.assign(new Error('Update ZIP must be at most 100 MiB so existing clients can download the raw mirror. Publication stopped before advancing latest.'),{code:'RELEASE_RAW_MIRROR_REQUIRED'});
}
module.exports={MAX_RAW_MIRROR_BYTES,ASSET_MAP,VISUAL_BRANCH,visualAssets,planVisualAssets,assertMirrorable};
