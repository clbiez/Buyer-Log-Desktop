'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm'),crypto=require('node:crypto');
const script=path.resolve(__dirname,'../scripts/buyerlog-release-distribution.js');
const git=(cwd,...args)=>cp.execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function load(downloads){const module={exports:{}};const nativeRequire=spec=>spec==='child_process'?{...cp,execFileSync(command,args,options){if(command!=='gh')return cp.execFileSync(command,args,options);assert.equal(args[0],'release');assert.equal(args[1],'download');downloads.push(args[2]);const target=args[args.indexOf('--dir')+1],name=args[args.indexOf('--pattern')+1];fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,name),'verified-small-native-asset');return '';} }:require(spec);vm.runInNewContext(fs.readFileSync(script,'utf8'),{module,exports:module.exports,require:nativeRequire,__dirname:path.dirname(script),process:{pid:process.pid,env:{BUYER_LOG_GITHUB_RELEASE_REPO:'buyer/releases'}},Buffer,console,clearTimeout},{filename:script});return module.exports;}
function manifest(channel,version,size,sha256){return {schemaVersion:1,channel,version,publishedAt:'2026-10-13T00:00:00.000Z',artifact:'releases/BuyerLog-'+version+'.zip',sha256,size,mandatory:false,releaseNotes:'',minimumUpdaterVersion:'1.0.0'};}
test('oversized target fails publication; legacy opposite channel does not block the small recovery release',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-distribution-native-git-')),repo=path.join(root,'repo'),bare=path.join(root,'remote.git'),downloads=[];
 try{fs.mkdirSync(repo);cp.execFileSync('git',['init','--bare',bare],{stdio:'ignore'});git(repo,'init','-b','main');git(repo,'config','user.name','Anonymous Test');git(repo,'config','user.email','demo@example.invalid');git(repo,'remote','add','origin',bare);
  const small=Buffer.from('verified-small-native-asset'),stable=manifest('stable','7.0.269',small.length,crypto.createHash('sha256').update(small).digest('hex')),large=manifest('test','7.0.272',160*1024*1024,'0'.repeat(64));
  for(const m of [stable,large]){const dir=path.join(repo,m.channel);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(m));}git(repo,'add','.');git(repo,'commit','-m','Anonymous canonical channel manifests');git(repo,'push','origin','main');
  const publisher=load(downloads);
  await assert.rejects(()=>publisher.publishRawMirror(repo,{test:large}),{code:'RELEASE_RAW_MIRROR_REQUIRED'});
  assert.deepEqual(downloads,[],'fail before downloading or publishing anything');
  const recovery={...stable,channel:'test',version:'7.0.273',artifact:'releases/BuyerLog-7.0.273.zip'};
  fs.writeFileSync(path.join(repo,'stable/latest.json'),JSON.stringify({...large,channel:'stable'}));git(repo,'add','.');git(repo,'commit','-m','Legacy large stable');
  await publisher.publishRawMirror(repo,{test:recovery});const index=JSON.parse(git(bare,'show','raw-dist:index.json'));assert.equal(index.channels.test.mirrored,true);assert.equal(index.channels.stable.mirrored,false);
  assert.deepEqual(downloads,['test-v7.0.273']);assert.equal(git(bare,'show','raw-dist:test/BuyerLog-7.0.273.zip'),small.toString());assert.notEqual(cp.spawnSync('git',['-C',bare,'cat-file','-e','raw-dist:stable/BuyerLog-7.0.272.zip'],{stdio:'ignore'}).status,0);
  // Stable promotion has an intermediate mirror path too; it must not push a large blob.
  const artifact=path.join(root,'BuyerLog-7.0.272.zip');fs.writeFileSync(artifact,'');fs.truncateSync(artifact,large.size);const before=git(bare,'rev-parse','raw-dist');assert.throws(()=>publisher.updateRawMirror(repo,'stable',{...large,channel:'stable'},artifact),{code:'RELEASE_RAW_MIRROR_REQUIRED'});assert.equal(git(bare,'rev-parse','raw-dist'),before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('native raw mirror threshold rejects oversized or invalid sizes before Git operations',()=>{const p=load([]);assert.equal(p.canMirror({size:p.MAX_RAW_MIRROR_BYTES}),true);assert.equal(p.canMirror({size:p.MAX_RAW_MIRROR_BYTES+1}),false);assert.equal(p.canMirror({size:Infinity}),false);assert.equal(p.canMirror({size:Number.MAX_SAFE_INTEGER+1}),false);});
test('visual archive is additive, byte-identical and refuses changes to published images',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-visual-publish-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),bare=path.join(root,'remote.git');fs.mkdirSync(repo);cp.execFileSync('git',['init','--bare',bare],{stdio:'ignore'});
 git(repo,'init','-b','main');git(repo,'config','user.name','Anonymous Test');git(repo,'config','user.email','demo@example.invalid');git(repo,'remote','add','origin',bare);
 fs.writeFileSync(path.join(repo,'README.md'),'No application source in the image branch');git(repo,'add','.');git(repo,'commit','-m','Public manifest repository');git(repo,'push','origin','main');
 const file=path.join(root,'screen.png');fs.writeFileSync(file,'immutable image');
 const asset={key:'7.0.323/screen.png',file,size:15,sha256:crypto.createHash('sha256').update('immutable image').digest('hex')};
 const publisher=load([]);publisher.publishVisualAssets(repo,[asset]);
 assert.equal(git(bare,'show','release-visuals:'+asset.key),'immutable image');
 assert.equal(git(bare,'ls-tree','--name-only','release-visuals'),'7.0.323');
 const before=git(bare,'rev-parse','release-visuals');publisher.publishVisualAssets(repo,[asset]);assert.equal(git(bare,'rev-parse','release-visuals'),before,'idempotent publication');
 fs.writeFileSync(file,'tampered image!');assert.throws(()=>publisher.publishVisualAssets(repo,[{...asset,sha256:'f'.repeat(64)}]),{code:'RELEASE_VISUAL_IMMUTABLE'});
 assert.equal(git(bare,'rev-parse','release-visuals'),before);
});
test('raw transport alone must return exact bytes; Release CDN fallback cannot hide a broken mirror',async t=>{
 const publisher=load([]),original=global.fetch;t.after(()=>{global.fetch=original;});
 const bytes=Buffer.from('signed package'),m=manifest('test','7.0.323',bytes.length,crypto.createHash('sha256').update(bytes).digest('hex')),seen=[];
 global.fetch=async url=>{seen.push(url);return {ok:true,url,body:require('node:stream').Readable.toWeb(require('node:stream').Readable.from(bytes))};};
 await publisher.verifyRawMirror('test',m);assert.equal(seen.length,1);assert.match(seen[0],/^https:\/\/raw\.githubusercontent\.com\//);
 global.fetch=async url=>({ok:true,url,body:require('node:stream').Readable.toWeb(require('node:stream').Readable.from(Buffer.from('corrupt')))});
 await assert.rejects(()=>publisher.verifyRawMirror('test',m),{code:'RELEASE_RAW_MIRROR_VERIFY'});
 global.fetch=async()=>({ok:false,status:404});await assert.rejects(()=>publisher.verifyRawMirror('test',m),{code:'UPDATE_SOURCE_HTTP'});
});
test('TEST publisher uses separate workflow revision and exact app dependencies; STABLE uses the same canonical publisher',()=>{const workflows=path.resolve(__dirname,'../workflows'),t=fs.readFileSync(path.join(workflows,'buyerlog-test-release.yml'),'utf8'),s=fs.readFileSync(path.join(workflows,'buyerlog-promote-stable.yml'),'utf8');assert.match(t,/ref: \$\{\{ github\.workflow_sha \}\}[\s\S]*path: release-publisher/);assert.match(t,/BUYER_LOG_RELEASE_APP_ROOT: \$\{\{ github\.workspace \}\}\/resources\/app/);assert.match(t,/node \.\.\/\.\.\/release-publisher\/\.github\/scripts\/buyerlog-release-distribution\.js publish-test/);assert.match(s,/node \.\.\/\.\.\/\.github\/scripts\/buyerlog-release-distribution\.js promote-stable/);});
