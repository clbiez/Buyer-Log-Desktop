'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function setup(storage=new Map()){
 const notices=[],context={state:{currentUser:{id:'demo-user'}},window:{},appLang:'tr',Map,Date,BLStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},showToast:message=>notices.push(message)};
 vm.createContext(context);vm.runInContext(code.slice(code.indexOf('const masterReleaseNoticeVersions='),code.indexOf('function renderSyncStatusBadge(s){')),context);
 return {context,notices,observe:s=>context.observeMasterRelease(s),render:(node,s)=>context.renderMasterReleaseStatus(node,s)};
}
const status=(version,hub='demo-hub')=>({masterHubId:hub,masterRelease:{version,publishedBy:'Demo Moderator',publishedAt:'2026-10-09T12:00:00Z'}});
test('applied rule notice appears once per increasing version and persists across page restart',()=>{
 const storage=new Map(),a=setup(storage);a.observe(status(2));a.observe(status(2));a.observe(status(1));assert.equal(a.notices.length,1);
 const b=setup(storage);b.observe(status(2));assert.equal(b.notices.length,0);b.observe(status(3));assert.equal(b.notices.length,1);
 b.observe(status(3,'other-hub'));assert.equal(b.notices.length,2);b.context.state.currentUser.id='other-user';b.observe(status(3));assert.equal(b.notices.length,3);
});
test('missing release, hub or logged-in user never records a rule notice',()=>{
 const ui=setup();ui.observe({});ui.observe({...status(1),masterHubId:''});ui.context.state.currentUser=null;ui.observe(status(1));assert.equal(ui.notices.length,0);
 ui.context.state.currentUser={id:'demo-user'};ui.observe(status(1));assert.equal(ui.notices.length,1);
});
test('rule status reads current language and presents arbitrary metadata as text',()=>{
 const ui=setup(),node={};const s=status(4);s.masterRelease.publishedBy='<svg onload=alert(1)>';
 ui.render(node,s);assert.equal(node.hidden,false);assert.match(node.textContent,/^Kurallar v4/);assert.ok(node.textContent.includes('<svg'));assert.equal(node.innerHTML,undefined);
 ui.context.appLang='en';ui.render(node,s);assert.match(node.textContent,/^Rules v4/);ui.render(node,{});assert.equal(node.hidden,true);
});
test('rule history is moderator-only, dynamically translated and loaded after expansion',()=>{
 assert.match(code,/if\(window.BLIsModerator\?\.\(\)\)\{[\s\S]*?dataset\.masterReleases/);
 assert.match(code,/if\(!history\.open\)return;[\s\S]*?ensureFeature\?\.\('masterReleases'\)/);
 assert.match(code,/tx=\(tr,eng\)=>appLang==='en'\?eng:tr/);
 assert.match(code,/if\(document\.getElementById\('_syncStatusModal'\)\)void openSyncStatusModal\(\)/);
 const perf=fs.readFileSync(path.join(__dirname,'../public/perf-runtime.js'),'utf8');assert.match(perf,/masterReleases:\['master-releases-ui\.js'\]/);
});
