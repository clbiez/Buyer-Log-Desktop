'use strict';
// User-approved workflow capability. Only explicit workflow_dispatch can publish.
// No execution of this publisher is authorized by adding or merging its code.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const APP=path.resolve(__dirname,'../../resources/app');
const F=require(path.join(APP,'electron/manual-patch/files')),S=require(path.join(APP,'electron/manual-patch/signature'));
const {loadTrustedKeys,verifyManifestSignature}=require(path.join(APP,'electron/update/signature'));
const {parseReleaseManifest}=require(path.join(APP,'electron/update/manifest'));
const {extractZipSafe}=require(path.join(APP,'electron/update/zip'));
const {verifyPackagedCore}=require(path.join(APP,'electron/manual-patch/core-verification'));
const run=args=>cp.execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
function config(env=process.env){
 const source=String(env.APPROVED_SOURCE_SHA||''),baseVersion=String(env.BASE_VERSION||''),sequence=Number(env.PATCH_SEQUENCE),repo=String(env.RELEASE_REPO||'');
 if(env.PUBLISH_APPROVED!=='true'||!/^[a-f0-9]{40}$/.test(source)||!/^\d+\.\d+\.\d+$/.test(baseVersion)||!Number.isSafeInteger(sequence)||sequence<1||!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo)||!env.RUNNER_TEMP)throw Error('Explicit publication approval, exact SHA, base version, sequence, release repository and RUNNER_TEMP are required.');
 return {source,baseVersion,sequence,repo,root:path.join(path.resolve(env.RUNNER_TEMP),'buyerlog-signed-patch'),tag:`signed-patch-v${baseVersion}-${sequence}`};
}
function assertSource(c){
 const actual=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:APP,encoding:'utf8'}).trim();
 if(actual!==c.source)throw Error('Working source is not the explicitly approved SHA.');
}
function prepare(c){
 assertSource(c);fs.mkdirSync(c.root,{recursive:true});const input=path.join(c.root,'base');fs.mkdirSync(input);
 run(['release','download',`stable-v${c.baseVersion}`,'--repo',c.repo,'--pattern',`BuyerLog-${c.baseVersion}.zip`,'--pattern',`BuyerLog-${c.baseVersion}.json`,'--dir',input]);
 const raw=F.readJsonStrict(path.join(input,`BuyerLog-${c.baseVersion}.json`)),manifest=parseReleaseManifest(raw,'stable'),keys=loadTrustedKeys(APP);
 if(!keys.length)throw Error('Pinned publisher keys are required.');verifyManifestSignature(manifest,keys);
 const zip=path.join(input,`BuyerLog-${c.baseVersion}.zip`),stat=fs.statSync(zip);
 if(manifest.version!==c.baseVersion||stat.size!==manifest.size||F.sha(fs.readFileSync(zip))!==manifest.sha256)throw Error('Signed base archive identity mismatch.');
 extractZipSafe(zip,path.join(c.root,'unpacked'),{maxFiles:S.MAX_FILES,maxBytes:S.MAX_BYTES});
 const base=path.join(c.root,'unpacked/app');F.readBootstrap(base);verifyPackagedCore(base,c.baseVersion);
 if(c.sequence>1){
  const previous=path.join(c.root,'previous');fs.mkdirSync(previous);
  run(['release','download',`signed-patch-v${c.baseVersion}-${c.sequence-1}`,'--repo',c.repo,'--pattern',`BuyerLog-SignedPatch-${c.baseVersion}-${c.sequence-1}.json`,'--dir',previous]);
  require(path.join(APP,'scripts/signed-manual-patch')).historyFrom(F.readJsonStrict(path.join(previous,`BuyerLog-SignedPatch-${c.baseVersion}-${c.sequence-1}.json`)),base,c.sequence);
 }
 fs.writeFileSync(path.join(c.root,'notes.json'),JSON.stringify({tr:process.env.PATCH_NOTES_TR,en:process.env.PATCH_NOTES_EN}));
}
function build(c){
 assertSource(c);const previous=c.sequence>1?['--previous',path.join(c.root,'previous',`BuyerLog-SignedPatch-${c.baseVersion}-${c.sequence-1}.json`)]:[];
 return require(path.join(APP,'scripts/signed-manual-patch')).main(['--base-app',path.join(c.root,'unpacked/app'),'--source-app',APP,'--out',path.join(c.root,'out'),'--sequence',String(c.sequence),'--source-commit',c.source,'--notes',path.join(c.root,'notes.json'),...previous]);
}
function publish(c){
 assertSource(c);const name=`BuyerLog-SignedPatch-${c.baseVersion}-${c.sequence}`,out=path.join(c.root,'out'),manifest=F.readJsonStrict(path.join(out,name+'.json'));
 S.verifyManifest(manifest,loadTrustedKeys(APP));
 const zip=path.join(out,name+'.zip');
 if(manifest.sourceCommit!==c.source||manifest.baseVersion!==c.baseVersion||manifest.sequence!==c.sequence||fs.statSync(zip).size!==manifest.artifact.size||F.sha(fs.readFileSync(zip))!==manifest.artifact.sha256)throw Error('Prepared patch does not match explicit publication approval.');
 const listed=JSON.parse(run(['release','list','--repo',c.repo,'--limit','1000','--json','tagName']));
 if(listed.some(release=>release.tagName===c.tag)){
  const existing=path.join(c.root,'existing');fs.mkdirSync(existing);
  run(['release','download',c.tag,'--repo',c.repo,'--pattern',name+'.json','--pattern',name+'.zip','--dir',existing]);
  for(const ext of ['json','zip'])if(F.sha(fs.readFileSync(path.join(existing,name+'.'+ext)))!==F.sha(fs.readFileSync(path.join(out,name+'.'+ext))))throw Error('An immutable publication with different bytes already exists.');
 }else run(['release','create',c.tag,'--repo',c.repo,'--title',`Buyer Log ${c.baseVersion} signed patch ${c.sequence}`,'--notes-file',path.join(c.root,'notes.json'),'--latest=false',path.join(out,name+'.json'),zip]);
 const remote=path.join(c.root,'verified-remote');fs.mkdirSync(remote);
 run(['release','download',c.tag,'--repo',c.repo,'--pattern',name+'.json','--pattern',name+'.zip','--dir',remote]);
 for(const ext of ['json','zip'])if(F.sha(fs.readFileSync(path.join(remote,name+'.'+ext)))!==F.sha(fs.readFileSync(path.join(out,name+'.'+ext))))throw Error('Remote publication verification failed.');
 console.log(`Verified immutable signed publication: ${c.repo}/${c.tag}. Legacy, TEST and STABLE feeds were not changed.`);
}
if(require.main===module){try{const action=process.argv[2],c=config();if(action==='prepare')prepare(c);else if(action==='build')build(c);else if(action==='publish')publish(c);else throw Error('Unknown publication action');}catch(error){console.error(`[SIGNED_PATCH_PUBLISH_FAILED] ${error.message}`);process.exitCode=1;}}
module.exports={config,prepare,build,publish};
