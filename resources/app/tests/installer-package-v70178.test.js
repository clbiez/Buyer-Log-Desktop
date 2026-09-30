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
const { createZipFromDirectory,listZipEntries }=require('../electron/update/zip');
const { buildInstaller }=require('../scripts/build-installer');

const RUNTIME=['version','icudtl.dat','resources.pak','v8_context_snapshot.bin','snapshot_blob.bin','ffmpeg.dll','locales/tr.pak','locales/en-US.pak','LICENSES.chromium.html'];

function write(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
function fixture(t,{appExtras={}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-installer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=path.join(root,'repo');
  for(const file of RUNTIME)write(path.join(repo,file),file==='version'?'44.3.0':'runtime:'+file);
  // Kaynak repoda duran ama pakete GİRMEMESİ gerekenler.
  for(const file of ['CLAUDE.md','AGENTS.md','manifest.json','.buyerlog-versions/7.0.116/app/package.json','docs/x.md','.github/workflows/x.yml','resources/app/package.json'])write(path.join(repo,file),'x');
  childProcess.execFileSync('git',['init','-q'],{cwd:repo});
  childProcess.execFileSync('git',['add','-A'],{cwd:repo});
  const app=path.join(root,'app');
  write(path.join(app,'package.json'),JSON.stringify({name:'buyer-log-desktop',version:'7.0.178',dependencies:{express:'^4.19.2'}}));
  for(const file of ['electron/launcher.js','electron/main.js','server/server.js','public/index.html'])write(path.join(app,file),'// '+file);
  write(path.join(app,'node_modules','express','package.json'),'{"name":"express"}');
  for(const [file,content] of Object.entries(appExtras))write(path.join(app,file),content);
  const appZip=path.join(root,'BuyerLog-7.0.178.zip');createZipFromDirectory(app,appZip,{rootPrefix:'app'});
  const exe=path.join(root,'BuyerLog.exe');write(exe,'MZ-fake-electron');
  const exeSha256=crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  return {root,repo,appZip,exe,exeSha256,out:path.join(root,'out')};
}

test('kurulum paketi exe + çalışma zamanı + bağımlılıklı STABLE çekirdeği taşır, veri ve kaynak dosyası taşımaz',async t=>{
  const f=fixture(t);
  const result=await buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:f.exeSha256,runtimeRoot:f.repo,out:f.out,version:'7.0.178',createdAt:'2026-09-30T00:00:00Z'});
  assert.equal(result.name,'BuyerLog-Kurulum-7.0.178.zip');
  const names=listZipEntries(result.file).entries.map(item=>item.name);
  for(const expected of ['BuyerLog/BuyerLog.exe','BuyerLog/manifest.json','BuyerLog/KURULUM-OKU.txt','BuyerLog/locales/tr.pak','BuyerLog/resources/app/node_modules/express/package.json','BuyerLog/resources/app/electron/launcher.js'])
    assert.ok(names.includes(expected),'eksik: '+expected);
  for(const banned of [/CLAUDE\.md$/,/AGENTS\.md$/,/\.buyerlog-versions/,/\/docs\//,/\.github/,/\/data\//,/config\.json$/])
    assert.ok(!names.some(name=>banned.test(name)),'pakete girmemeli: '+banned);
  assert.equal(fs.readFileSync(result.file+'.sha256','utf8').split(/\s+/)[0],result.sha256);
});

test('uygulama çekirdeğinde çalışma verisi varsa paket üretilmez',async t=>{
  const f=fixture(t,{appExtras:{'server/data/BuyerLogLocal.db':'{"deviceId":"kaynak"}'}});
  await assert.rejects(buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:f.exeSha256,runtimeRoot:f.repo,out:f.out}),error=>error.code==='INSTALLER_DATA_LEAK');
});

test('bağımlılıkları olmayan çekirdek veya sabitlenmemiş exe ile paket üretilmez',async t=>{
  const f=fixture(t);
  await assert.rejects(buildInstaller({appZip:f.appZip,exe:f.exe,exeSha256:'0'.repeat(64),runtimeRoot:f.repo,out:f.out}),error=>error.code==='INSTALLER_EXE_SHA');
  const g=fixture(t,{appExtras:{'package.json':JSON.stringify({name:'buyer-log-desktop',version:'7.0.178',dependencies:{express:'^4',xlsx:'^0.18.5'}})}});
  await assert.rejects(buildInstaller({appZip:g.appZip,exe:g.exe,exeSha256:g.exeSha256,runtimeRoot:g.repo,out:g.out}),error=>error.code==='INSTALLER_DEPENDENCIES_MISSING');
});
