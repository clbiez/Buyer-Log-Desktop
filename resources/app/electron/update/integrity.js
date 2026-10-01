'use strict';
/* Uygulama çekirdeği bütünlük manifesti (7.0.184).
 * Release build'i paketlenen her dosyanın SHA-256 değerini
 * electron/app-integrity.json içine yazar. Kurulu bilgisayar açılışta kendi
 * çekirdeğini bu listeyle karşılaştırır: eksik ya da farklı dosya, "sürüm
 * numarası yeni ama dosyalar eski" durumunu görünür kılar. */
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { walkFiles }=require('./zip');

const MANIFEST_REL='electron/app-integrity.json';

function hashFileSync(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

function buildIntegrityManifest(root,{version,exclude}={}){
  const skip=typeof exclude==='function'?exclude:()=>false;
  const files={};
  for(const file of walkFiles(root,{exclude:(rel,entry)=>rel===MANIFEST_REL||skip(rel,entry)}))files[file.rel]=hashFileSync(file.full);
  return {schemaVersion:1,version:String(version||''),fileCount:Object.keys(files).length,files};
}

function writeIntegrityManifest(root,options={}){
  const manifest=buildIntegrityManifest(root,options);
  fs.writeFileSync(path.join(root,...MANIFEST_REL.split('/')),JSON.stringify(manifest)+'\n','utf8');
  return manifest;
}

/* Ana süreci kilitlememek için dosyalar parça parça doğrulanır. */
async function verifyIntegrity(root,{version='',batch=200}={}){
  let manifest=null;
  try{manifest=JSON.parse(fs.readFileSync(path.join(root,...MANIFEST_REL.split('/')),'utf8'));}catch(_){return {status:'no-manifest',missing:[],changed:[],checked:0};}
  if(!manifest||manifest.schemaVersion!==1||!manifest.files||typeof manifest.files!=='object')return {status:'no-manifest',missing:[],changed:[],checked:0};
  if(version&&manifest.version&&manifest.version!==version)return {status:'version-mismatch',manifestVersion:manifest.version,missing:[],changed:[],checked:0};
  const missing=[],changed=[];let checked=0;
  const entries=Object.entries(manifest.files);
  for(let i=0;i<entries.length;i+=1){
    const [rel,expected]=entries[i];
    if(rel.split('/').includes('..'))continue;
    const full=path.join(root,...rel.split('/'));
    try{if(hashFileSync(full)!==expected)changed.push(rel);}catch(_){missing.push(rel);}
    checked+=1;
    if(i%batch===batch-1)await new Promise(resolve=>setImmediate(resolve));
  }
  return {status:missing.length||changed.length?'damaged':'ok',missing,changed,checked};
}

module.exports={MANIFEST_REL,buildIntegrityManifest,writeIntegrityManifest,verifyIntegrity};
