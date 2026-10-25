'use strict';
// Deterministic, offline source-distribution inventory. Advisory lookup is an
// explicit dated review in the catalog, never an inferred clean-security badge.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const APP=path.resolve(__dirname,'..'),REPO=path.resolve(APP,'../..'),CATALOG=path.join(__dirname,'dependency-catalog.json'),OUTPUT=path.join(REPO,'docs/dependencies/sbom.cdx.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),portable=file=>file.split(path.sep).join('/');
function filesUnder(root){if(!fs.existsSync(root))return[];const result=[];for(const entry of fs.readdirSync(root,{withFileTypes:true})){const full=path.join(root,entry.name);if(entry.isSymbolicLink())throw Error('Symlinks are not supported in dependency artifacts: '+full);if(entry.isDirectory())result.push(...filesUnder(full));else if(entry.isFile())result.push(full);}return result.sort();}
function distributionFiles(){
 const files=filesUnder(path.join(APP,'public/vendor')).map(file=>({file,relative:portable(path.relative(APP,file)),runtime:false}));
 for(const name of ['thinking-orb-working.js','thinking-orb-breathing.js']){const file=path.join(APP,'public',name);if(fs.existsSync(file))files.push({file,relative:'public/'+name,runtime:false});}
 for(const file of filesUnder(path.join(APP,'vendor')))files.push({file,relative:portable(path.relative(APP,file)),runtime:false});
 for(const entry of fs.readdirSync(REPO,{withFileTypes:true}))if(entry.isFile()&&(/\.(dll|pak|bin|dat)$/.test(entry.name)||['version','LICENSE','LICENSES.chromium.html','vk_swiftshader_icd.json'].includes(entry.name)))files.push({file:path.join(REPO,entry.name),relative:'../../'+entry.name,runtime:true});
 for(const file of filesUnder(path.join(REPO,'locales')))files.push({file,relative:'../../'+portable(path.relative(REPO,file)),runtime:true});
 return files.sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
}
function buildInventory(){
 const catalog=read(CATALOG),pkg=read(path.join(APP,'package.json')),lock=read(path.join(APP,'package-lock.json')),artifacts=[],groups=new Map(catalog.groups.map(group=>[group.id,{...group,artifacts:[]}]));
 for(const item of distributionFiles()){
  const matches=[...groups.values()].filter(group=>group.patterns.some(prefix=>prefix==='@runtime'?item.runtime:!item.runtime&&item.relative.startsWith(prefix)));
  if(matches.length!==1)throw Error('Every artifact needs exactly one dependency owner: '+item.relative);
  const group=matches[0],bytes=fs.readFileSync(item.file),artifact={path:item.relative,component:group.id,bytes:bytes.length,sha256:sha(bytes)};artifacts.push(artifact);group.artifacts.push(artifact);
 }
 const components=[...groups.values()].map(group=>{
  if(!group.owner||!group.updateMethod||!group.source||!group.versionEvidence)throw Error('Incomplete dependency ownership: '+group.id);
  return {type:group.type,'bom-ref':'vendor:'+group.id,name:group.name,version:group.versionFile?fs.readFileSync(path.resolve(APP,group.versionFile),'utf8').trim():group.version,licenses:[{expression:group.license}],hashes:[{alg:'SHA-256',content:sha(Buffer.from(group.artifacts.map(file=>file.path+'\0'+file.sha256).join('\n')))}],externalReferences:[{type:'distribution',url:group.source}],properties:[{name:'buyerlog:owner',value:group.owner},{name:'buyerlog:update-method',value:group.updateMethod},{name:'buyerlog:version-evidence',value:group.versionEvidence},{name:'buyerlog:file-count',value:String(group.artifacts.length)}]};
 });
 for(const [location,entry]of Object.entries(lock.packages||{})){if(!location||!location.includes('node_modules/'))continue;const name=location.split('node_modules/').at(-1),license=entry.license||(name==='xlsx'?'Apache-2.0':null),component={type:'library','bom-ref':'npm:'+location,name,version:entry.version,purl:'pkg:npm/'+name.split('/').map(encodeURIComponent).join('/')+'@'+entry.version,properties:[{name:'buyerlog:owner',value:'Buyer Log Node dependency maintainers'},{name:'buyerlog:update-method',value:'Update package.json/package-lock.json together; install with npm ci; review advisory changes and run relevant contracts plus final integrated regression.'},{name:'buyerlog:lock-location',value:location}]};if(license)component.licenses=[{expression:license}];else component.properties.push({name:'buyerlog:license-status',value:'Not declared by upstream lock metadata; review required before redistributing.'});if(entry.resolved)component.externalReferences=[{type:'distribution',url:entry.resolved}];if(entry.integrity?.startsWith('sha512-'))component.hashes=[{alg:'SHA-512',content:Buffer.from(entry.integrity.slice(7),'base64').toString('hex')}];components.push(component);}
 return {bomFormat:'CycloneDX',specVersion:'1.6',version:1,metadata:{component:{type:'application',name:pkg.name,version:pkg.version},properties:[{name:'buyerlog:advisory-lookup-date',value:catalog.advisoryLookupDate},{name:'buyerlog:scope',value:'Checked-out source distribution: locked Node packages and every vendored/runtime artifact. Excluded executable and published artifact identity are not certified.'},{name:'buyerlog:package-lock-sha256',value:sha(fs.readFileSync(path.join(APP,'package-lock.json')))}]},components:components.sort((a,b)=>a['bom-ref'].localeCompare(b['bom-ref'],'en')),properties:[{name:'buyerlog:artifact-manifest',value:JSON.stringify(artifacts)}]};
}
function serialized(){return JSON.stringify(buildInventory(),null,2)+'\n';}
if(require.main===module){const bytes=serialized();if(process.argv.includes('--check')){if(!fs.existsSync(OUTPUT)||fs.readFileSync(OUTPUT,'utf8')!==bytes)throw Error('Dependency inventory is stale; run node scripts/dependency-inventory.js');console.log('Dependency inventory matches all vendored/runtime files and the lock.');}else{fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,bytes);console.log('Dependency inventory written: '+path.relative(REPO,OUTPUT));}}
module.exports={buildInventory,distributionFiles,serialized,OUTPUT};
