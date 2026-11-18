'use strict';
// Every packaged file is SHA-256 verified on each launch; field logs showed the
// scan scales with file count on a cold disk. Development-only files (package
// docs, type declarations, source maps, package tests, measurement/release
// scripts) therefore stay out of the runtime package. The same predicate is used
// by the release builder, the signed manual patch builder and the scan.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const F=require('../electron/manual-patch/files');
const APP=path.join(__dirname,'..');

test('runtime code, package manifests, licences and shipped tools stay in the package',()=>{
  for(const relative of [
    'node_modules/express/index.js','node_modules/express/package.json',
    'node_modules/body-parser/lib/types/json.js','node_modules/body-parser/lib/types/urlencoded.js',
    'node_modules/xlsx/xlsx.js','node_modules/xlsx/dist/xlsx.full.min.js',
    'node_modules/qs/LICENSE.md','node_modules/ms/license.md','node_modules/express/LICENSE','node_modules/some/NOTICE.txt',
    'scripts/import-legacy-data.js','scripts/setup-release-signing.js','scripts/BuyerLog-Kullanici-Kurtarma.cmd',
    'server/server.js','public/app-main.js','public/release-notes/next.json','docs/README.md','electron/main.js',
  ])assert.equal(F.excluded(relative),false,relative);
});

test('package docs, type declarations, source maps, package tests and development scripts are not packaged',()=>{
  for(const relative of [
    'node_modules/express/Readme.md','node_modules/xlsx/CHANGELOG.md','node_modules/xlsx/README.md',
    'node_modules/xlsx/types/index.d.ts','node_modules/xlsx/dist/xlsx.full.min.map','node_modules/qs/test/parse.js',
    'node_modules/@kenjiuno/msgreader/node_modules/iconv-lite/.github/dependabot.yml','node_modules/debug/.npmignore',
    'node_modules/gopd/tsconfig.json','node_modules/xlsx/bower.json','node_modules/function-bind/.eslintrc',
    'scripts/benchmark-startup-orders.js','scripts/release-publish.js','scripts/lib/startup-benchmark.js','scripts/fixtures/a.json',
  ])assert.equal(F.excluded(relative),true,relative);
});

test('no file the backend and its dependencies load at runtime is excluded from the package',()=>{
  const before=new Set(Object.keys(require.cache));
  for(const name of ['express','xlsx','@kenjiuno/msgreader','resedit'])require(require.resolve(name,{paths:[APP]}));
  const loaded=Object.keys(require.cache).filter(file=>!before.has(file)&&file.startsWith(path.join(APP,'node_modules')+path.sep));
  assert.ok(loaded.length>20,'dependencies were loaded: '+loaded.length);
  const excluded=loaded.map(file=>path.relative(APP,file).split(path.sep).join('/')).filter(relative=>F.excluded(relative));
  assert.deepEqual(excluded,[]);
});

test('every script the app or a shipped .cmd tool runs is packaged',()=>{
  const sources=['electron/first-run-migration.js',...fs.readdirSync(path.join(APP,'scripts')).filter(name=>name.endsWith('.cmd')).map(name=>'scripts/'+name)];
  const referenced=new Set();
  for(const source of sources){
    const text=fs.readFileSync(path.join(APP,source),'utf8');
    // Code paths only: path.join(root,'scripts','x.js') and cmd calls like scripts\x.js.
    for(const match of text.matchAll(/'scripts',\s*'([A-Za-z0-9_.-]+\.js)'|node\s+(?:"[^"]*\\)?scripts\\([A-Za-z0-9_.-]+\.js)/g))referenced.add('scripts/'+(match[1]||match[2]));
  }
  assert.ok(referenced.has('scripts/import-legacy-data.js'));
  for(const relative of referenced){
    assert.ok(fs.existsSync(path.join(APP,relative)),relative+' exists');
    assert.equal(F.excluded(relative),false,relative+' is packaged');
  }
});
