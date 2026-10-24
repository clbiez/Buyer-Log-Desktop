'use strict';
/*
 * v7.0.178 — Kopyalanmış kurulum regresyonu (launcher tarafı).
 *
 * Saha olayı: bir kullanıcı çalışan Buyer Log klasörünü (data\ dâhil) başka
 * kullanıcılara kopyaladı. data\local\updater\current.json, kaynak
 * bilgisayarın MUTLAK yolunu (C:\Users\<kaynak>\...\.buyerlog-versions\...)
 * taşıyordu; hedefte bu yol geçersiz sayıldı ve launcher sessizce eski
 * bootstrap çekirdeğine düştü. Sonuç: bazı kullanıcılar eski sürümde kaldı ve
 * 7.0.163 ile gelen PLM → Koleksiyon sürükle-bırak gibi özellikler kayboldu.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const { createLauncherState }=require('../electron/update/launcher-state');
const { atomicWriteJson }=require('../electron/update/json-store');

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-copied-install-'));}
function core(root,version){const app=path.join(root,'app');for(const d of ['electron','server','public'])fs.mkdirSync(path.join(app,d),{recursive:true});fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'buyer-log-desktop',version,main:'electron/launcher.js'}));fs.writeFileSync(path.join(app,'electron','main.js'),'module.exports=true;');require('./helpers/update-trial-core')(app);fs.writeFileSync(path.join(app,'public','index.html'),'<html>Buyer Log</html>');return app;}
const FOREIGN_WIN='C:\\Users\\kaynak\\Desktop\\Buyer Log Desktop\\.buyerlog-versions\\7.0.177\\app';

test('kopyalanmış current.json yabancı mutlak yolu bu kurulumdaki aynı sürüme yeniden bağlanır',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'resources'),'7.0.84');
  const managed=core(path.join(root,'.buyerlog-versions','7.0.177'),'7.0.177');
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root});
  atomicWriteJson(life.currentFile,{schemaVersion:1,version:'7.0.177',appCoreRoot:FOREIGN_WIN,source:'managed',updatedAt:new Date().toISOString()});
  const pointer=life.currentPointer();
  assert.equal(pointer.version,'7.0.177');
  assert.equal(path.resolve(pointer.appCoreRoot),path.resolve(managed));
});

test('başka makinedeki POSIX mutlak yol da yeniden bağlanır',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'resources'),'7.0.84');
  const managed=core(path.join(root,'.buyerlog-versions','7.0.177'),'7.0.177');
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root});
  atomicWriteJson(life.currentFile,{schemaVersion:1,version:'7.0.177',appCoreRoot:'/home/kaynak/BuyerLog/.buyerlog-versions/7.0.177/app',source:'managed'});
  assert.equal(path.resolve(life.currentPointer().appCoreRoot),path.resolve(managed));
});

test('yeniden bağlanacak sürüm yoksa bootstrap çekirdeğine dönülür (mevcut davranış)',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'resources'),'7.0.84');
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root});
  atomicWriteJson(life.currentFile,{schemaVersion:1,version:'7.0.177',appCoreRoot:FOREIGN_WIN,source:'managed'});
  const pointer=life.currentPointer();
  assert.equal(pointer.source,'bootstrap');
  assert.equal(pointer.version,'7.0.84');
});

test('yerel sürüm klasörü farklı bir sürüm içeriyorsa yeniden bağlanmaz',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'resources'),'7.0.84');
  core(path.join(root,'.buyerlog-versions','7.0.177'),'7.0.170');
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root});
  atomicWriteJson(life.currentFile,{schemaVersion:1,version:'7.0.177',appCoreRoot:FOREIGN_WIN,source:'managed'});
  assert.equal(life.currentPointer().source,'bootstrap');
});

test('bootstrap çekirdeği işaretçideki yönetilen sürümden yeniyse yeni tam paket kazanır',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'resources'),'7.0.178');
  const managed=core(path.join(root,'.buyerlog-versions','7.0.116'),'7.0.116');
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root});
  atomicWriteJson(life.currentFile,{schemaVersion:1,version:'7.0.116',appCoreRoot:managed,source:'managed'});
  const pointer=life.currentPointer();
  assert.equal(pointer.version,'7.0.178');
  assert.equal(path.resolve(pointer.appCoreRoot),path.resolve(bootstrap));
});

test('kopyalanmış hazır (pending) update yabancı yolla da etkinleşir',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'resources'),'7.0.84');
  const managed=core(path.join(root,'.buyerlog-versions','7.0.177'),'7.0.177');
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root,makeToken:()=> 'tok'});
  life.writeState({pending:{version:'7.0.177',sha256:'a'.repeat(64),ready:true,appCoreRoot:FOREIGN_WIN}});
  const result=life.activatePending();
  assert.ok(result&&result.activation,'pending update etkinleşmeli');
  assert.equal(path.resolve(life.currentPointer().appCoreRoot),path.resolve(managed));
});

const { missingRuntimeDependencies }=require('../electron/backend');

test('kaynak ZIP gibi node_modules taşımayan çekirdek açılıştan önce eksik bağımlılık olarak raporlanır',t=>{
  const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const app=core(root,'7.0.178');
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'buyer-log-desktop',version:'7.0.178',dependencies:{express:'^4.19.2',xlsx:'^0.18.5','@scope/pkg':'1.0.0'}}));
  assert.deepEqual(missingRuntimeDependencies(app),['express','xlsx','@scope/pkg']);
  for(const name of ['express','xlsx','@scope/pkg']){const dir=path.join(app,'node_modules',...name.split('/'));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),'{}');}
  assert.deepEqual(missingRuntimeDependencies(app),[]);
});

test('eksik bağımlılıkta sunucu hiç başlatılmaz ve kullanıcıya kurulum paketi yönlendirmesi gösterilir',()=>{
  const backendSource=fs.readFileSync(path.join(__dirname,'..','electron','backend.js'),'utf8');
  const mainSource=fs.readFileSync(path.join(__dirname,'..','electron','main.js'),'utf8');
  const startBody=backendSource.slice(backendSource.indexOf('  start() {'));
  assert.ok(startBody.indexOf('missingRuntimeDependencies(this.appCoreRoot)')>=0);
  assert.ok(startBody.indexOf('missingRuntimeDependencies(this.appCoreRoot)')<startBody.indexOf('spawn(process.execPath'),'kontrol spawn öncesinde olmalı');
  assert.match(mainSource,/BACKEND_DEPENDENCIES_MISSING[\s\S]{0,400}BuyerLog-Kurulum-/);
});
