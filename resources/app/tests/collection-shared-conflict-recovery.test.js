'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function fixture({confirm=true}={}){
 const start=app.indexOf('async function kolLoadAcceptedWorkspaceAfterConflict('),end=app.indexOf('\nfunction kolReplicationFeedback',start);
 assert.ok(start>=0&&end>start,'shared-row rejection needs an explicit, guarded UI recovery action');
 let resolve,fetches=0;const response=new Promise(r=>resolve=r),events=[];
 const c={AbortController,setTimeout,clearTimeout,kolWorkspaceOwnerId:'shared',kolWorkspaceMode:'single',kolWorkspaceCanEdit:true,kolWorkspaceSaving:false,kolWorkspaceSaveTimer:null,kolWorkspacePending:false,kolWorkspaceRevision:7,kolBaseline:{},kolWorkspaceRecoveryOwnerId:'',appLang:'en',confirm:()=>confirm,document:{activeElement:{dataset:{}},addEventListener:()=>{}},change:{upserts:[{id:1,modelKod:'rejected'}]},pending:true,
  kolCollectChanges:()=>c.change,kolHasDirtyWorkspace:()=>false,kolClearPendingWorkspace:()=>{c.pending=false;events.push('clear')},kolApplyWorkspace:w=>{events.push('apply');c.applied=w},kolReportReplication:()=>{},kolReplicationFeedback:()=> 'local',kolSetSaveFeedback:()=>{},kolRenderSaveFeedback:()=>{},showToast:()=>{},
  fetch:()=>{fetches++;return response},
 };vm.createContext(c);vm.runInContext(app.slice(start,end),c);
 return {c,events,fetches:()=>fetches,reply:(ok=true,body={workspace:{ownerId:'shared',_revision:7,rows:[{id:1,modelKod:'accepted'}],manufacturers:[],customColumns:[]},access:{canEdit:true},replication:{ok:true}})=>resolve({ok,status:ok?200:503,statusText:'unavailable',json:async()=>body})};
}
test('cancelled recovery preserves the draft without fetching or applying',async()=>{const f=fixture({confirm:false});assert.equal(await f.c.kolLoadAcceptedWorkspaceAfterConflict(),false);assert.equal(f.c.pending,true);assert.equal(f.fetches(),0)});
test('draft is cleared only after native response and immediately before apply',async()=>{const f=fixture(),done=f.c.kolLoadAcceptedWorkspaceAfterConflict();assert.equal(f.c.pending,true);f.c.pending=true;f.reply();assert.equal(await done,true);assert.deepEqual(f.events,['clear','apply']);assert.equal(f.c.applied.rows[0].modelKod,'accepted')});
test('failed native read preserves rejected local data',async()=>{const f=fixture(),done=f.c.kolLoadAcceptedWorkspaceAfterConflict();f.reply(false);assert.equal(await done,false);assert.equal(f.c.pending,true);assert.deepEqual(f.events,[])});
test('new local input while recovery reads cannot be discarded',async()=>{const f=fixture(),done=f.c.kolLoadAcceptedWorkspaceAfterConflict();f.c.document.activeElement.dataset.kolUncommitted='1';f.reply();assert.equal(await done,false);assert.equal(f.c.pending,true)});
test('late recovery cannot replace an advanced workspace revision or changed owner',async()=>{for(const key of ['kolWorkspaceRevision','kolWorkspaceOwnerId']){const f=fixture(),done=f.c.kolLoadAcceptedWorkspaceAfterConflict();f.c[key]=key==='kolWorkspaceRevision'?8:'other';f.reply();assert.equal(await done,false);assert.equal(f.c.pending,true);assert.deepEqual(f.events,[])}});
test('shared conflict feedback offers the real recovery button with both languages',()=>{assert.ok(app.includes('data-kol-server-recovery'));assert.ok(app.includes('Sunucudakini yükle'));assert.ok(app.includes('Load accepted server data'));assert.ok(/addEventListener\('click'[\s\S]{0,300}kolLoadAcceptedWorkspaceAfterConflict/.test(app))});

test('an incomplete or wrong-owner HTTP 200 cannot discard the draft',async()=>{for(const workspace of [{rows:[]},{ownerId:'other',_revision:7,rows:[],manufacturers:[],customColumns:[]}]){const f=fixture(),done=f.c.kolLoadAcceptedWorkspaceAfterConflict();f.reply(true,{workspace,access:{canEdit:true}});assert.equal(await done,false);assert.equal(f.c.pending,true);assert.deepEqual(f.events,[])}});
