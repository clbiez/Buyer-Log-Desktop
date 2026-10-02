'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const { APP_ROOT,readPackage,readJson,parseSemver }=require('./release-common');
const { APP_VERSION,DISPLAY_VERSION }=require('../server/lib/app-version');

function readVersionHistory(){
  const file=path.join(APP_ROOT,'public','version-history.js');
  const source=fs.readFileSync(file,'utf8');
  const sandbox={window:{}};
  vm.runInNewContext(source,sandbox,{filename:file,timeout:1000});
  const history=sandbox.window.BL_VERSION_HISTORY;
  if(!Array.isArray(history)||!history.length)throw new Error('Sürüm geçmişi boş veya okunamıyor.');
  return history;
}
function historyText(entry){
  const title=entry&&entry.title||{};
  const items=Array.isArray(entry&&entry.items)?entry.items:[];
  return [title.tr,title.en,...items.flatMap(item=>[item&&item.tr,item&&item.en])].filter(Boolean).join('\n');
}
function main(){
  const pkg=readPackage(),index=fs.readFileSync(path.join(APP_ROOT,'public','index.html'),'utf8');
  if(APP_VERSION!==pkg.version)throw new Error(`server APP_VERSION ${APP_VERSION} != package ${pkg.version}`);
  if(!parseSemver(pkg.version))throw new Error('Canonical version SemVer değil.');
  if(!index.includes('__BL_CANONICAL_VERSION__')||!index.includes('__BL_DISPLAY_VERSION__'))throw new Error('UI runtime version placeholders eksik.');

  // Sürüm geçmişi append-only'dir: yayımlanan sürüm gerçek numarasıyla arşive girer.
  // Hareketli "__CURRENT__" kaydı eski notları her yeni sürümde yeniden etiketleyip
  // ara sürümleri görünmez yapıyordu; release doğrulaması bunu artık engeller.
  const history=readVersionHistory();
  const versions=history.map(entry=>String(entry&&entry.v||'').trim());
  if(versions.includes('__CURRENT__'))throw new Error('Sürüm geçmişinde __CURRENT__ kullanılamaz; gerçek sürüm numarasını arşivleyin.');
  const unique=new Set(versions);
  if(unique.size!==versions.length)throw new Error('Sürüm geçmişinde yinelenen sürüm kaydı var.');
  if(versions[0]!==DISPLAY_VERSION)throw new Error(`Sürüm geçmişinin ilk kaydı ${DISPLAY_VERSION} olmalı; bulunan: ${versions[0]||'boş'}.`);
  const current=history[0];
  if(!Array.isArray(current.items)||!current.items.length)throw new Error(`Sürüm ${DISPLAY_VERSION} için güncelleme notu boş bırakılamaz.`);

  // Release request aynı source version'ı işaret ediyorsa notun arşivde birebir
  // bulunmasını da doğrula. Request başka source commit'e aitse bu kontrol atlanır.
  const request=readJson(path.resolve(APP_ROOT,'..','..','.github','release-requests','test.json'),null);
  if(request&&request.version===pkg.version&&String(request.release_notes||'').trim()){
    const note=String(request.release_notes).trim();
    if(!historyText(current).includes(note))throw new Error(`Sürüm ${DISPLAY_VERSION} release notu version-history arşivinde bulunamadı.`);
  }

  console.log(JSON.stringify({canonical:pkg.version,display:DISPLAY_VERSION,ui:'runtime-derived',historyRecords:history.length},null,2));
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main,readVersionHistory};
