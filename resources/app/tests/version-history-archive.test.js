'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
const display=pkg.version.replace(/^7\.0\./,'7.');
const source=fs.readFileSync(path.join(ROOT,'public','version-history.js'),'utf8');
const sandbox={window:{}};
vm.runInNewContext(source,sandbox,{filename:'version-history.js'});
const history=sandbox.window.BL_VERSION_HISTORY;
const versions=history.map(entry=>String(entry&&entry.v||''));
const byVersion=new Map(history.map(entry=>[String(entry&&entry.v||''),entry]));
const textOf=entry=>[
  entry&&entry.title&&entry.title.tr,
  entry&&entry.title&&entry.title.en,
  ...(Array.isArray(entry&&entry.items)?entry.items.flatMap(item=>[item&&item.tr,item&&item.en]):[])
].filter(Boolean).join('\n');

test('sürüm geçmişi append-only gerçek sürüm numaraları taşır',()=>{
  assert.ok(Array.isArray(history)&&history.length>0);
  assert.equal(versions[0],display,'ilk kayıt kurulu sürüm olmalı');
  assert.equal(versions.includes('__CURRENT__'),false,'hareketli placeholder geçmişi ezmemeli');
  assert.equal(new Set(versions).size,versions.length,'aynı sürüm iki kez arşivlenmemeli');
});

test('self-update dönemindeki ara yayınlar arşivde kaybolmaz',()=>{
  for(const version of ['7.85','7.94','7.100','7.137','7.138','7.155','7.180','7.200','7.209','7.210']){
    assert.ok(byVersion.has(version),`${version} sürüm kaydı arşivde bulunmalı`);
  }
  assert.match(textOf(byVersion.get('7.138')),/Hazır ekran önbelleği|prepared-screen cache/i,
    'v7.138 notu kendi sürümünde kalmalı');
});

test('current release request notu aynı version ise arşivde birebir korunur',()=>{
  const requestPath=path.resolve(ROOT,'..','..','.github','release-requests','test.json');
  const request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
  if(request.version!==pkg.version)return;
  const note=String(request.release_notes||'').trim();
  assert.ok(note,'current release request notu boş olmamalı');
  assert.ok(textOf(byVersion.get(display)).includes(note),'current release notu arşiv kaydında birebir bulunmalı');
});
