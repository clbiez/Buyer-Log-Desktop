'use strict';
/*
 * v7.0.178 — Yeni kullanıcı kurulum paketi.
 *
 * Saha olayı: yeni kullanıcılar GitHub kaynak ZIP'i + BuyerLog.exe ile
 * kurulum yapmaya çalıştı; node_modules olmadığı için uygulama açılmadı. Çare
 * olarak başka kullanıcının klasörü (data\ dâhil) kopyalandı. Kurulum paketi
 * bağımlılıklarla birlikte gelmeli ve ASLA kullanıcı/cihaz verisi taşımamalı.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const childProcess=require('child_process');
const { createZipFromDirectory,listZipEntries,extractZipSafe }=require('../electron/update/zip');
const { buildInstaller }=require('../scripts/build-installer');

const RUNTIME=['version','icudtl.dat','resources.pak','v8_context_snapshot.bin','snapshot_blob.bin','ffmpeg.dll','locales/tr.pak','locales/en-US.pak','LICENSES.chromium.html'];

function write(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
async function fixture(t,{appExtras={}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-installer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=path.join(root,'repo');
  for(const file of RUNTIME)write(path.join(repo,file),file==='version'?'44.3.0':'runtime:'+file);
  // Kaynak repoda duran ama pakete GİRMEMESİ gerekenler.
  for(const file of ['CLAUDE.md','AGENTS.md','manifest.json','.buyerlog-versions/7.0.116/app/package.json','docs/x.md','.github/workflows/x.yml','resources/app/package.json'])write(path.join(repo,file),'x');
  childProcess.execFileSync('git',['init','-q'],{cwd:repo});
  childProcess.execFileSync('git',['add','-A'],{cwd:repo});
  const app=path.join(root,'app');
  write(path.join(app,'package.json'),JSON.stringify({name:'buyer-log-desktop',version:'7.0.178',dependencies:{express:'^4.19.2',resedit:'3.1.0'}}));
  for(const file of ['electron/launcher.js','electron/launcher-core.js','electron/update/launcher-version.json','electron/main.js','server/server.js','public/index.html'])write(path.join(app,file),'// '+file);
  write(path.join(app,'node_modules','express','package.json'),'{"name":"express"}');
  for(const dependency of ['resedit','pe-library'])fs.cpSync(path.join(__dirname,'..','node_modules',dependency),path.join(app,'node_modules',dependency),{recursive:true});
  fs.copyFileSync(path.join(__dirname,'..','buyerlog.ico'),path.join(app,'buyerlog.ico'));
  for(const [file,content] of Object.entries(appExtras))write(path.join(app,file),content);
  const appZip=path.join(root,'BuyerLog-7.0.178.zip');createZipFromDirectory(app,appZip,{rootPrefix:'app'});
  const ResEdit=await import('resedit');
  const pe=ResEdit.NtExecutable.createEmpty(false,false);
  const resource=ResEdit.NtExecutableResource.from(pe);
  // Eski simgeli gerçek PE: paketleme yalnız simgeyi değiştirmeli.
  const icons=ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname,'..','buyerlog.ico')));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries,1,1033,[icons.icons[0].data]);
  resource.entries.push({type:10,id:42,lang:1033,codepage:0,bin:Buffer.from('runtime-metadata')});
  resource.outputResource(pe);
  const exe=path.join(root,'BuyerLog.exe');write(exe,Buffer.from(pe.generate()));
  const exeSha256=crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  return {root,repo,appZip,exe,exeSha256,out:path.join(root,'out')};
}

test('kurulum paketi exe + çalışma zamanı + bağımlılıklı STABLE çekirdeği taşır, veri ve kaynak dosyası taşımaz',async t=>{
  const f=await fixture(t);
  const result=await buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:f.exeSha256,runtimeRoot:f.repo,out:f.out,version:'7.0.178',createdAt:'2026-09-30T00:00:00Z'});
  assert.equal(result.name,'BuyerLog-Kurulum-7.0.178.zip');
  const names=listZipEntries(result.file).entries.map(item=>item.name);
  for(const expected of ['BuyerLog/BuyerLog.exe','BuyerLog/manifest.json','BuyerLog/KURULUM-OKU.txt','BuyerLog/locales/tr.pak','BuyerLog/resources/app/node_modules/express/package.json','BuyerLog/resources/app/electron/launcher.js'])
    assert.ok(names.includes(expected),'eksik: '+expected);
  for(const banned of [/CLAUDE\.md$/,/AGENTS\.md$/,/\.buyerlog-versions/,/\/docs\//,/\.github/,/^BuyerLog\/(data|resources\/app\/server\/data)\//,/config\.json$/])
    assert.ok(!names.some(name=>banned.test(name)),'pakete girmemeli: '+banned);
  assert.equal(fs.readFileSync(result.file+'.sha256','utf8').split(/\s+/)[0],result.sha256);
  const unpacked=path.join(f.root,'unpacked');extractZipSafe(result.file,unpacked);
  const exeBytes=fs.readFileSync(path.join(unpacked,'BuyerLog','BuyerLog.exe'));
  const ResEdit=await import('resedit');
  const resource=ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(exeBytes));
  const group=ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries)[0];
  const bytes=icon=>crypto.createHash('sha256').update(Buffer.from(icon.isIcon()?icon.generate():icon.bin)).digest('hex');
  const actual=group.getIconItemsFromEntries(resource.entries).map(bytes);
  const expected=ResEdit.Data.IconFile.from(fs.readFileSync(path.join(unpacked,'BuyerLog','resources','app','buyerlog.ico'))).icons.map(icon=>bytes(icon.data));
  assert.deepEqual(actual,expected,'paketteki EXE ilk açılıştan önce güncel simgenin tüm boyutlarını içermeli');
  assert.equal(Buffer.from(resource.entries.find(entry=>entry.type===10&&entry.id===42).bin).toString(),'runtime-metadata');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.exe)).digest('hex'),f.exeSha256,'sabitlenmiş kaynak EXE değişmemeli');
  const source=path.join(f.root,'source');extractZipSafe(f.appZip,source);
  for(const entry of listZipEntries(f.appZip).entries.filter(entry=>!entry.name.endsWith('/')))
    assert.ok(fs.readFileSync(path.join(source,entry.name)).equals(fs.readFileSync(path.join(unpacked,'BuyerLog','resources',entry.name))),'STABLE çekirdeği değişmemeli: '+entry.name);
  assert.ok(!names.some(name=>/\.icon-new$|\.old-/.test(name)),'simge yamasının geçici dosyaları pakete girmemeli');
  const again=await buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:f.exeSha256,runtimeRoot:f.repo,out:path.join(f.root,'again'),version:'7.0.178',createdAt:'2026-09-30T00:00:00Z'});
  assert.equal(again.sha256,result.sha256,'aynı girdiler aynı kurulum paketini üretmeli');
});

test('uygulama çekirdeğinde çalışma verisi varsa paket üretilmez',async t=>{
  const f=await fixture(t,{appExtras:{'server/data/BuyerLogLocal.db':'{"deviceId":"kaynak"}'}});
  await assert.rejects(buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:f.exeSha256,runtimeRoot:f.repo,out:f.out}),error=>error.code==='INSTALLER_DATA_LEAK');
});

test('bağımlılıkları olmayan çekirdek veya sabitlenmemiş exe ile paket üretilmez',async t=>{
  const f=await fixture(t);
  await assert.rejects(buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:'0'.repeat(64),runtimeRoot:f.repo,out:f.out}),error=>error.code==='INSTALLER_EXE_SHA');
  const g=await fixture(t,{appExtras:{'package.json':JSON.stringify({name:'buyer-log-desktop',version:'7.0.178',dependencies:{express:'^4',xlsx:'^0.18.5'}})}});
  await assert.rejects(buildInstaller({appZip:g.appZip,exe:g.exe,exeSha256:g.exeSha256,runtimeRoot:g.repo,out:g.out}),error=>error.code==='INSTALLER_DEPENDENCIES_MISSING');
});

test('eksik veya bozuk simge ve PE ile eski simgeli kurulum yayımlanamaz',async t=>{
  const missing=await fixture(t,{appExtras:{'buyerlog.ico':''}});
  await assert.rejects(buildInstaller({appZip:missing.appZip,exe:missing.exe,exeSha256:missing.exeSha256,runtimeRoot:missing.repo,out:missing.out}),error=>error.code==='INSTALLER_EXE_ICON');
  const invalid=await fixture(t);
  write(invalid.exe,'MZ-invalid-runtime');
  const exeSha256=crypto.createHash('sha256').update(fs.readFileSync(invalid.exe)).digest('hex');
  await assert.rejects(buildInstaller({appZip:invalid.appZip,exe:invalid.exe,exeSha256,runtimeRoot:invalid.repo,out:invalid.out}),error=>error.code==='INSTALLER_EXE_ICON');
});
