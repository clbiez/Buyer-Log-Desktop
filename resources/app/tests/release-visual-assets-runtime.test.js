'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/release-notes.js'),'utf8');
function runtime(fetch){
 const context={fetch,document:{readyState:'loading',addEventListener(){}},window:{}};
 vm.createContext(context);
 vm.runInContext(source.replace('global.BLReleaseNotes={','global.testing={loadRelease,visualSource};global.BLReleaseNotes={'),context);
 return context.window.testing;
}
test('archive images use raw only when the packaged inventory lists them; recent visuals remain local',async()=>{
 const map={schemaVersion:1,baseUrl:'https://raw.githubusercontent.com/buyer/releases/release-visuals/',files:{'7.0.1/screen.png':{sha256:'a'.repeat(64)}}};
 const r=runtime(async url=>({ok:true,json:async()=>url.includes('asset-locations')?map:{version:url.includes('7.0.1/')?'7.0.1':'7.0.323'}}));
 const old=await r.loadRelease({file:'release-notes/7.0.1/release.json'});
 assert.equal(r.visualSource(old,{src:'screen.png'}),map.baseUrl+'7.0.1/screen.png?sha256='+'a'.repeat(64));
 const recent=await r.loadRelease({file:'release-notes/7.0.323/release.json'});
 assert.match(r.visualSource(recent,{src:'screen.png'}),/^release-notes\/7\.0\.323\/screen\.png\?/);
});
test('source/folder installations work without the generated map and reject arbitrary external hosts',async()=>{
 for(const bad of [null,{schemaVersion:1,baseUrl:'https://evil.invalid/',files:{}}]){
  const r=runtime(async url=>({ok:!url.includes('asset-locations')||!!bad,json:async()=>url.includes('asset-locations')?bad:{version:'7.0.1'}}));
  const release=await r.loadRelease({file:'release-notes/7.0.1/release.json'});
  assert.match(r.visualSource(release,{src:'screen.png'}),/^release-notes\//);
 }
});
