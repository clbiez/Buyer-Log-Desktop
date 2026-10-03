'use strict';
const fs=require('fs');
const path=require('path');
const zlib=require('zlib');

const APP_ROOT=path.resolve(__dirname,'..');
const PUBLIC_ROOT=path.join(APP_ROOT,'public');
const NOTES_ROOT=path.join(PUBLIC_ROOT,'release-notes');
const NEXT_FILE=path.join(NOTES_ROOT,'next.json');
const NEXT_ASSETS=path.join(NOTES_ROOT,'next-assets');
const INDEX_FILE=path.join(NOTES_ROOT,'index.json');

function fail(message,code='RELEASE_NOTES_INVALID'){const error=new Error(message);error.code=code;throw error;}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){fail('JSON okunamadı: '+path.relative(APP_ROOT,file)+' · '+error.message);}}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8');}
function bilingual(value,label){if(!value||typeof value!=='object'||!String(value.tr||'').trim()||!String(value.en||'').trim())fail(label+' için TR ve EN zorunlu.');}
function safeName(value){const name=String(value||'').trim();if(!name||name.includes('..')||name.includes('/')||name.includes('\\'))fail('Geçersiz görsel dosya adı: '+name);return name;}
function stats(changes){return changes.reduce((out,change)=>{if(change.type==='feature')out.features++;else if(change.type==='fix')out.fixes++;else out.improvements++;return out;},{features:0,improvements:0,fixes:0});}
const SCREENSHOT_MIN_WIDTH=900,SCREENSHOT_MIN_HEIGHT=360,SCREENSHOT_MIN_RATIO=1.2,SCREENSHOT_MAX_RATIO=3.2;
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function inspectPngScreenshot(file,label='screenshot'){
  const buffer=fs.readFileSync(file),sig=Buffer.from([137,80,78,71,13,10,26,10]);
  if(buffer.length<33||!buffer.subarray(0,8).equals(sig))fail(label+' geçerli PNG değil.','RELEASE_NOTES_VISUAL_INVALID');
  let offset=8,width=0,height=0,sawIhdr=false,sawIend=false;const idat=[];
  while(offset+12<=buffer.length){
    const len=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8),end=offset+12+len;
    if(end>buffer.length)fail(label+' PNG dosyası eksik/truncated.','RELEASE_NOTES_VISUAL_INVALID');
    const data=buffer.subarray(offset+8,offset+8+len),stored=buffer.readUInt32BE(offset+8+len),actual=crc32(buffer.subarray(offset+4,offset+8+len));
    if(stored!==actual)fail(label+' PNG CRC doğrulaması başarısız.','RELEASE_NOTES_VISUAL_INVALID');
    if(type==='IHDR'){
      if(len!==13||sawIhdr)fail(label+' PNG IHDR geçersiz.','RELEASE_NOTES_VISUAL_INVALID');
      sawIhdr=true;width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      if(data[10]!==0||data[11]!==0||![0,1].includes(data[12]))fail(label+' PNG encoding desteklenmiyor.','RELEASE_NOTES_VISUAL_INVALID');
    }else if(type==='IDAT')idat.push(data);
    else if(type==='IEND'){sawIend=true;offset=end;break;}
    offset=end;
  }
  if(!sawIhdr||!sawIend||offset!==buffer.length||!idat.length)fail(label+' PNG yapısı tamamlanmamış.','RELEASE_NOTES_VISUAL_INVALID');
  try{zlib.inflateSync(Buffer.concat(idat));}catch(error){fail(label+' PNG piksel verisi açılamıyor: '+error.message,'RELEASE_NOTES_VISUAL_INVALID');}
  const ratio=height?width/height:0;
  if(width<SCREENSHOT_MIN_WIDTH||height<SCREENSHOT_MIN_HEIGHT)fail(label+' çok küçük/kırpılmış: en az '+SCREENSHOT_MIN_WIDTH+'x'+SCREENSHOT_MIN_HEIGHT+' olmalı.','RELEASE_NOTES_VISUAL_INVALID');
  if(ratio<SCREENSHOT_MIN_RATIO||ratio>SCREENSHOT_MAX_RATIO)fail(label+' ekran oranı okunabilir değil: '+ratio.toFixed(2)+'.','RELEASE_NOTES_VISUAL_INVALID');
  return {width,height,ratio};
}
function assertPostChangeVisual(change,src,label){
  if(String(change?.visual?.capture||'')!=='post-change')fail(label+' visual.capture="post-change" olmalı.','RELEASE_NOTES_VISUAL_INVALID');
  const text=[src,change?.visual?.alt?.tr,change?.visual?.alt?.en,change?.visual?.caption?.tr,change?.visual?.caption?.en].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
  if(/(^|[\\s._-])(before|previous|prior|old|önceki|önceden|eski)([\\s._-]|$)/i.test(text))fail(label+' değişiklikten önceki/eski durumu gösteremez; güncel post-change ekran gerekli.','RELEASE_NOTES_VISUAL_INVALID');
}
function validateNext(){
  if(!fs.existsSync(NEXT_FILE))fail('public/release-notes/next.json bulunamadı.');
  const data=readJson(NEXT_FILE);
  if(Number(data.schemaVersion)!==1)fail('next.json schemaVersion 1 olmalı.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(data.publishedAt||'')))fail('next.json publishedAt YYYY-MM-DD olmalı.');
  bilingual(data.title,'release title');bilingual(data.summary,'release summary');
  if(!Array.isArray(data.changes)||!data.changes.length)fail('Stable sürüm için en az bir release-note değişikliği zorunlu.');
  const ids=new Set();
  for(const [i,change] of data.changes.entries()){
    const p='changes['+i+']';
    const id=String(change?.id||'').trim();if(!id||ids.has(id))fail(p+' id boş veya tekrar ediyor.');ids.add(id);
    if(!['feature','improvement','fix'].includes(change.type))fail(p+' type feature/improvement/fix olmalı.');
    bilingual(change.module,p+' module');bilingual(change.title,p+' title');bilingual(change.body,p+' body');
    if(!change.visual||typeof change.visual!=='object')fail(p+' visual zorunlu.');
    const src=safeName(change.visual.src),asset=path.join(NEXT_ASSETS,src);
    if(!fs.existsSync(asset))fail(p+' görseli bulunamadı: '+src);
    bilingual(change.visual.alt,p+' visual.alt');bilingual(change.visual.caption,p+' visual.caption');
    const kind=String(change.visual.kind||'');
    if(data.bootstrapVisual===true){
      if(!['screenshot','component-preview'].includes(kind))fail(p+' bootstrap görsel kind geçersiz.');
    }else{
      if(kind!=='screenshot')fail(p+' gerçek Buyer Log ekran görüntüsü visual.kind="screenshot" olmalı.');
      if(!/\.png$/i.test(src))fail(p+' ekran görüntüsü kayıpsız PNG olmalı; JPG/WEBP kabul edilmez.');
      assertPostChangeVisual(change,src,p);
      inspectPngScreenshot(asset,p+' '+src);
    }
    if(change.path)bilingual(change.path,p+' path');
  }
  return data;
}
function ensureImmutable(target,payload){
  if(!fs.existsSync(target))return;
  const existing=fs.readFileSync(target,'utf8');
  if(existing!==payload)fail('Aynı stable version için release sunumu değiştirilemez: '+path.relative(APP_ROOT,target),'RELEASE_NOTES_IMMUTABLE');
}
function seal(version,{reset=false}={}){
  if(!/^\d+\.\d+\.\d+$/.test(String(version||'')))fail('Geçerli semantic version gerekli.');
  const data=validateNext(),dir=path.join(NOTES_ROOT,version);fs.mkdirSync(dir,{recursive:true});
  for(const change of data.changes){
    const src=safeName(change.visual.src),from=path.join(NEXT_ASSETS,src),to=path.join(dir,src);
    if(fs.existsSync(to)){
      const a=fs.readFileSync(from),b=fs.readFileSync(to);if(!a.equals(b))fail('Aynı version görseli değiştirilemez: '+src,'RELEASE_NOTES_IMMUTABLE');
    }else fs.copyFileSync(from,to);
  }
  const release={
    schemaVersion:1,version,channel:'stable',publishedAt:data.publishedAt,
    title:data.title,summary:data.summary,stats:stats(data.changes),changes:data.changes
  };
  const releaseFile=path.join(dir,'release.json'),payload=JSON.stringify(release,null,2)+'\n';
  ensureImmutable(releaseFile,payload);if(!fs.existsSync(releaseFile))fs.writeFileSync(releaseFile,payload,'utf8');
  const index=fs.existsSync(INDEX_FILE)?readJson(INDEX_FILE):{schemaVersion:1,releases:[]};
  index.schemaVersion=1;index.releases=Array.isArray(index.releases)?index.releases:[];
  const existing=index.releases.find(x=>x.version===version);
  const row={version,publishedAt:data.publishedAt,title:data.title,stats:release.stats,file:'release-notes/'+version+'/release.json'};
  if(existing&&JSON.stringify(existing)!==JSON.stringify(row))fail('Archive index aynı version için değiştirilemez.','RELEASE_NOTES_IMMUTABLE');
  if(!existing)index.releases.push(row);
  index.releases.sort((a,b)=>String(b.version).localeCompare(String(a.version),undefined,{numeric:true}));
  writeJson(INDEX_FILE,index);
  if(reset){
    writeJson(NEXT_FILE,{schemaVersion:1,publishedAt:'',bootstrapVisual:false,title:{tr:'',en:''},summary:{tr:'',en:''},changes:[]});
    if(fs.existsSync(NEXT_ASSETS))for(const name of fs.readdirSync(NEXT_ASSETS))fs.rmSync(path.join(NEXT_ASSETS,name),{recursive:true,force:true});
  }
  return release;
}
function main(){
  const [action,arg,...rest]=process.argv.slice(2);
  if(action==='validate'&&!arg&&!rest.length){const data=validateNext();console.log('Release notes OK: '+data.changes.length+' change(s).');return;}
  if(action==='seal'&&arg&&rest.every(x=>x==='--reset')){const release=seal(arg,{reset:rest.includes('--reset')});console.log('Release notes sealed: '+release.version);return;}
  fail('Kullanım: release-notes.js validate | seal VERSION [--reset]','RELEASE_NOTES_ARG_INVALID');
}
if(require.main===module){try{main();}catch(error){console.error('['+(error.code||'RELEASE_NOTES_FAILED')+'] '+error.message);process.exitCode=1;}}
module.exports={validateNext,seal,stats,inspectPngScreenshot,assertPostChangeVisual};
