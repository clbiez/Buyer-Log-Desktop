'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const MAIN = read('electron/main.js');
const MANAGER = read('electron/workspace-manager.js');
const PRELOAD = read('electron/preload.js');
const SHELL_PRELOAD = read('electron/workspace-preload.js');
const SHELL = read('electron/workspace.html');
const SHELL_JS = read('electron/workspace-renderer.js');
const SHELL_CSS = read('electron/workspace.css');
const APP = read('public/app-main.js');
const { createWorkspaceManager, normalizeModule, normalizeWorkspaceTheme, clampIndex, MODULES } = require('../electron/workspace-manager');

let nextContentsId = 1;
let nextWindowId = 1;
class MockContents extends EventEmitter {
  constructor(){super();this.id=nextContentsId++;this.destroyed=false;this.url='';this.messages=[];this.closeDelay=0;this.blockBeforeUnload=false;this.hangClose=false;this.forceCrashCount=0;}
  isDestroyed(){return this.destroyed;}
  loadURL(url){this.url=url;this.emit('did-finish-load');return Promise.resolve();}
  getURL(){return this.url;}
  setWindowOpenHandler(handler){this.openHandler=handler;}
  reload(){this.reloaded=(this.reloaded||0)+1;}
  toggleDevTools(){this.devtools=(this.devtools||0)+1;}
  focus(){this.focused=true;}
  send(channel,payload){this.messages.push({channel,payload});}
  close(options={}){
    if(this.destroyed||this.hangClose)return;
    if(this.blockBeforeUnload&&options.waitForBeforeUnload){
      let allowed=false;
      this.emit('will-prevent-unload',{preventDefault:()=>{allowed=true;}});
      if(!allowed)return;
    }
    const destroy=()=>{if(this.destroyed)return;this.destroyed=true;this.emit('destroyed');};
    if(this.closeDelay>0)setTimeout(destroy,this.closeDelay);else destroy();
  }
  forcefullyCrashRenderer(){this.forceCrashCount+=1;this.hangClose=false;}
}
class MockView extends EventEmitter {
  constructor(){super();this.webContents=new MockContents();}
  setBackgroundColor(color){this.color=color;}
  setBounds(bounds){this.bounds=bounds;}
}
class MockWindow extends EventEmitter {
  static focused=null;
  static getFocusedWindow(){return MockWindow.focused;}
  constructor(options){super();this.id=nextWindowId++;this.options=options;this.webContents=new MockContents();this.children=[];this.destroyed=false;this.bounds={x:options.x||0,y:options.y||0,width:options.width,height:options.height};this.contentView={addChildView:view=>{this.children=this.children.filter(item=>item!==view);this.children.push(view);},removeChildView:view=>{this.children=this.children.filter(item=>item!==view);}};}
  getContentBounds(){return {...this.bounds};}
  getBounds(){return {...this.bounds};}
  getNormalBounds(){return {...this.bounds};}
  isDestroyed(){return this.destroyed;}
  isMaximized(){return false;}
  setTitle(title){this.title=title;}
  setBackgroundColor(color){this.backgroundColor=color;}
  setTitleBarOverlay(value){this.titleBarOverlay=value;}
  loadFile(file){this.file=file;this.webContents.emit('did-finish-load');this.emit('ready-to-show');return Promise.resolve();}
  show(){this.visible=true;}
  focus(){MockWindow.focused=this;this.emit('focus');}
  maximize(){this.maximized=true;this.emit('maximize');}
  close(){if(this.destroyed)return;let prevented=false;const event={preventDefault:()=>{prevented=true;}};this.emit('close',event);if(!prevented){this.destroyed=true;this.emit('closed');}}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
}

function mockManager({ dialogResponse=0, dark=false }={}){
  const nativeTheme=new EventEmitter();
  nativeTheme.shouldUseDarkColors=dark;
  let dialogCalls=0;
  const manager=createWorkspaceManager({
    BrowserWindow:MockWindow,WebContentsView:MockView,dialog:{showMessageBoxSync:()=>{dialogCalls+=1;return dialogResponse;}},screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:2560,height:1440}})},path,crypto:{randomUUID:(()=>{let id=0;return()=>`tab-${++id}`;})()},origin:'http://127.0.0.1:5055',nativeTheme,
    shellFile:'workspace.html',shellPreload:'workspace-preload.js',contentPreload:'preload.js',iconPath:'buyerlog.ico',
    loadWindowState:()=>({width:1200,height:800,maximized:false}),saveWindowState:()=>{},applyNavigationPolicy:()=>{},log:()=>{},onFirstRendererReady:()=>{},
  });
  manager.__nativeTheme=nativeTheme;
  manager.__dialogCalls=()=>dialogCalls;
  return manager;
}

test('workspace uses current WebContentsView API; deprecated BrowserView/webview are absent', () => {
  assert.match(MAIN, /BrowserWindow, WebContentsView/);
  assert.match(MANAGER, /new WebContentsView\(/);
  assert.match(MANAGER, /contentView\.addChildView\(tab\.view\)/);
  assert.match(MANAGER, /contentView\.removeChildView\(tab\.view\)/);
  assert.doesNotMatch(MANAGER, /\bBrowserView\b|<webview/i);
});

test('tab switch, reorder and cross-window transfer keep the same live View', () => {
  const moveStart = MANAGER.indexOf('function moveTab(');
  const moveEnd = MANAGER.indexOf('function detachTab(', moveStart);
  const move = MANAGER.slice(moveStart, moveEnd);
  assert.match(move, /const tab = tabs\.get/);
  assert.match(move, /tab\.windowId = target\.window\.id/);
  assert.match(move, /target\.tabs\.splice\(insertAt, 0, tab\.id\)/);
  assert.doesNotMatch(move, /new WebContentsView|loadURL|reload\(/);
  assert.match(MANAGER, /function activateTab[\s\S]*?showActive\(state, focus\)/);
});

test('live manager moves one WebContentsView across windows without recreating it', async () => {
  const manager=mockManager();
  const first=manager.createWindow({module:'koleksiyon'});
  const lfl=manager.openModule(first.window.id,'lfl');
  const liveContents=lfl.view.webContents;
  assert.equal(manager.snapshot(first).tabs.length,2);
  assert.equal(manager.snapshot(first).canReattach,false,'primary window never offers a misleading reattach action');
  assert.equal(manager.moveTab(lfl.id,first.window.id,0),true);
  assert.equal(manager.snapshot(first).tabs[0].id,lfl.id,'same-window drag order is persisted');
  assert.equal(lfl.view.webContents,liveContents,'reorder does not recreate the renderer');
  assert.equal(manager.updateTabModule(liveContents,'orders'),true);
  assert.equal(lfl.module,'orders','programmatic module changes keep the native tab metadata in sync');
  assert.equal(lfl.title,'Siparişler');
  manager.activateTab(first.window.id,manager.snapshot(first).tabs[0].id);
  assert.equal(liveContents.isDestroyed(),false,'inactive tab stays alive');
  assert.equal(manager.detachTab(lfl.id,first.window.id,{x:1700,y:100}),true);
  assert.equal(manager.windowCount(),2);
  assert.equal(manager.tabForContents(liveContents),lfl,'detach preserves the same tab object');
  const detached=manager.stateForWindow(lfl.windowId);
  assert.ok(detached && detached.window.id!==first.window.id);
  assert.equal(manager.snapshot(detached).canReattach,true,'detached window exposes a reliable reattach action');
  assert.equal(manager.reattachTab(lfl.id,detached.window.id),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.windowCount(),1,'empty detached window closes after the transfer event stack completes');
  assert.equal(lfl.view.webContents,liveContents,'reattach preserves renderer identity and state');
  assert.equal(liveContents.isDestroyed(),false);
});

test('workspace title bar stays within compact 28px geometry and preserves native interaction zones', () => {
  assert.match(MANAGER, /const WORKSPACE_BAR_HEIGHT = 28;/);
  assert.match(SHELL_CSS, /\.workspaceBar\{height:28px;[^}]*align-items:center;[^}]*padding:0 144px 0 4px;[^}]*border-bottom:1px solid var\(--line\);[^}]*-webkit-app-region:drag/);
  assert.match(SHELL_CSS, /\.tabStrip\{[^}]*height:27px;[^}]*-webkit-app-region:no-drag/);
  assert.match(SHELL_CSS, /\.workspaceTab\{[^}]*height:26px;[^}]*font:500 12px\/1[^}]*-webkit-app-region:no-drag/);
  assert.match(SHELL_CSS, /\.workspaceTab\.isActive\{height:26px;/);
  assert.match(SHELL_CSS, /\.newTabWrap\{[^}]*height:27px;[^}]*-webkit-app-region:no-drag/);
  assert.match(SHELL_CSS, /\.newTabButton\{width:26px;height:26px;font-size:18px\}/);
  assert.match(SHELL_CSS, /\.windowDrag\{[^}]*-webkit-app-region:drag/);
  assert.doesNotMatch(SHELL_CSS, /height:44px|height:37px|inset:52px/);

  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const tab=manager.tabForContents(manager.activeContents(state));
  assert.equal(state.window.options.titleBarOverlay.height,28);
  assert.equal(state.window.titleBarOverlay.height,28);
  assert.equal(tab.view.bounds.y,28);
  assert.equal(tab.view.bounds.height,772);
});

test('each window has a browser-like accessible tab strip and non-drag alternatives', () => {
  assert.match(SHELL, /role="tablist"/);
  assert.match(SHELL_JS, /role="tab"/);
  assert.match(SHELL_JS, /aria-selected/);
  assert.match(SHELL_JS, /data-detach/);
  assert.match(SHELL_JS, /altKey && event\.shiftKey/);
  assert.match(SHELL_JS, /ctrlKey && event\.shiftKey/);
  assert.match(SHELL_JS, /dragstart/);
  assert.match(SHELL_JS, /receiveTab/);
  assert.match(SHELL_JS, /finishTabDrag/);
  assert.match(SHELL_JS, /data-reattach/);
  assert.match(SHELL_PRELOAD, /showModuleMenu/);
  assert.match(SHELL_PRELOAD, /workspace-finish-tab-drag/);
  assert.match(SHELL_PRELOAD, /workspace-reattach-tab/);
  assert.match(MAIN, /Menu\.buildFromTemplate\(template\)\.popup/);
});

test('module rail opens or focuses a desktop workspace tab while internal switchTab remains reusable', () => {
  assert.match(PRELOAD, /workspace:[\s\S]*?openModule[\s\S]*?setModule/);
  assert.match(APP, /desktopWorkspace\.openModule\(target\)/);
  assert.match(APP, /workspace\?\.setModule\?\.\(tab\)/);
  assert.match(APP, /new URLSearchParams\(location\.search\)\.get\('module'\)/);
  assert.equal(normalizeModule('koleksiyon'), 'koleksiyon');
  assert.equal(normalizeModule('not-a-module'), 'overview');
  assert.equal(clampIndex(99, 3), 3);
  assert.ok(MODULES.lfl && MODULES.orders && MODULES.koleksiyon);
});

test('multi-window host keeps one backend and shuts it down only through app quit', () => {
  assert.equal((MAIN.match(/backend = new BackendProcess\(/g) || []).length, 1);
  assert.match(MAIN, /app\.on\('window-all-closed',[\s\S]*?app\.quit\(\)/);
  assert.match(MAIN, /app\.on\('before-quit',[\s\S]*?shutdown\(\)/);
  assert.match(MANAGER, /function closeEmptyDetachedWindow/);
  assert.match(MANAGER, /state\.window\.id === primaryWindowId/);
  assert.match(MANAGER, /setImmediate\(\(\) =>/);
  assert.match(MANAGER, /function settleSourceAfterMove/);
  assert.doesNotMatch(MANAGER, /BackendProcess|backend\.stop|app\.quit/);
});

test('window-specific IPC, download and auth flows resolve the requesting tab parent', () => {
  assert.match(MAIN, /workspace\.tabForContents\(event\.sender\)/);
  assert.match(MAIN, /activeBuyerLogWindow\(options\.requestingContents\)/);
  assert.match(MAIN, /requestingContents:event\.sender/);
  assert.match(MAIN, /sendToDownloadOwner\(initiatingContents/);
  assert.match(MAIN, /workspace\.broadcast\('buyerlog:update-status-changed'/);
  assert.match(SHELL_PRELOAD, /workspace-receive-tab/);
});

test('native window X closes deterministically even when tab destruction is delayed', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const tab=manager.tabForContents(manager.activeContents(state));
  tab.view.webContents.closeDelay=30;
  state.window.close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.window.isDestroyed(),true,'native X does not wait on a child renderer');
  assert.equal(manager.windowCount(),0);
});

test('explicit tab close bypasses beforeunload without showing the confirmation dialog', async () => {
  const manager=mockManager({dialogResponse:1});
  const state=manager.createWindow({module:'overview'});
  const tab=manager.openModule(state.window.id,'cp');
  tab.view.webContents.blockBeforeUnload=true;
  assert.equal(await manager.closeTab(tab.id),true);
  assert.equal(manager.snapshot(state).tabs.some(item=>item.id===tab.id),false);
  assert.equal(manager.__dialogCalls(),0);
  assert.equal(state.window.isDestroyed(),false,'other tabs keep the window alive');
});

test('close then reopen creates a fresh live tab instead of reusing stale state', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const oldTab=manager.openModule(state.window.id,'cp');
  const oldContents=oldTab.view.webContents;
  oldContents.closeDelay=40;
  assert.equal(await manager.closeTab(oldTab.id),true);
  const reopened=manager.openModule(state.window.id,'cp');
  assert.ok(reopened);
  assert.notEqual(reopened.id,oldTab.id);
  assert.notEqual(reopened.view.webContents,oldContents);
  assert.equal(reopened.view.webContents.isDestroyed(),false);
  assert.equal(manager.snapshot(state).tabs.filter(item=>item.module==='cp').length,1);
});

test('close and immediate reopen are race-safe before destroyed event delivery', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const oldTab=manager.openModule(state.window.id,'cp');
  oldTab.view.webContents.closeDelay=80;
  const closing=manager.closeTab(oldTab.id);
  const reopened=manager.openModule(state.window.id,'cp');
  assert.equal(await closing,true);
  assert.ok(reopened && reopened.id!==oldTab.id);
  assert.equal(manager.snapshot(state).tabs.filter(item=>item.module==='cp').length,1);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(manager.snapshot(state).tabs.filter(item=>item.module==='cp').length,1,'late destroyed cleanup cannot delete the replacement tab');
});

test('openModule purges a partially torn-down tab object instead of throwing isDestroyed errors', () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const stale=manager.openModule(state.window.id,'cp');
  stale.view=undefined;
  const reopened=manager.openModule(state.window.id,'cp');
  assert.ok(reopened);
  assert.notEqual(reopened.id,stale.id);
  assert.equal(manager.snapshot(state).tabs.filter(item=>item.module==='cp').length,1);
});

test('hung renderer fallback leaves no zombie registry entry and module can reopen immediately', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const oldTab=manager.openModule(state.window.id,'cp');
  const oldContents=oldTab.view.webContents;
  oldContents.hangClose=true;
  assert.equal(await manager.closeTab(oldTab.id),true);
  const reopened=manager.openModule(state.window.id,'cp');
  assert.ok(reopened && reopened.id!==oldTab.id);
  assert.equal(manager.tabForContents(oldContents),null);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(oldContents.forceCrashCount,1);
  assert.equal(oldContents.isDestroyed(),true);
});

test('double close is idempotent and never leaves a hanging promise', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const tab=manager.openModule(state.window.id,'cp');
  const [first,second]=await Promise.all([manager.closeTab(tab.id),manager.closeTab(tab.id)]);
  assert.equal(first,true);
  assert.equal(second,false);
  assert.equal(manager.snapshot(state).tabs.some(item=>item.id===tab.id),false);
});

test('native window X ignores beforeunload in every child tab', async () => {
  const manager=mockManager({dialogResponse:1});
  const state=manager.createWindow({module:'overview'});
  const blocked=manager.openModule(state.window.id,'cp');
  blocked.view.webContents.blockBeforeUnload=true;
  state.window.close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.window.isDestroyed(),true);
  assert.equal(manager.__dialogCalls(),0);
});

test('detached window close cleans its registry and the same module can reopen in primary', async () => {
  const manager=mockManager();
  const primary=manager.createWindow({module:'overview'});
  const tab=manager.openModule(primary.window.id,'cp');
  assert.equal(manager.detachTab(tab.id,primary.window.id,{x:1700,y:100}),true);
  const detached=manager.stateForWindow(tab.windowId);
  const oldId=tab.id;
  detached.window.close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(detached.window.isDestroyed(),true);
  const reopened=manager.openModule(primary.window.id,'cp');
  assert.ok(reopened && reopened.id!==oldId);
});

test('repeated open-close lifecycle keeps exactly one live module tab', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  let previousId='';
  for(let index=0;index<3;index+=1){
    const tab=manager.openModule(state.window.id,'cp');
    assert.ok(tab.id!==previousId);
    assert.equal(manager.snapshot(state).tabs.filter(item=>item.module==='cp').length,1);
    previousId=tab.id;
    if(index<2) {
      assert.equal(await manager.closeTab(tab.id),true);
      assert.equal(manager.snapshot(state).tabs.filter(item=>item.module==='cp').length,0);
    }
  }
});

test('closing one workspace window does not affect other Buyer Log windows', async () => {
  const manager=mockManager();
  const first=manager.createWindow({module:'overview'});
  const second=manager.createWindow({module:'cp'});
  second.window.close();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(second.window.isDestroyed(),true);
  assert.equal(first.window.isDestroyed(),false);
  assert.equal(manager.snapshot(first).tabs.length,1);
});

test('dragging a detached tab over another workspace window reattaches it without recreating the renderer', async () => {
  const manager=mockManager();
  const first=manager.createWindow({module:'overview'});
  const tab=manager.openModule(first.window.id,'cp');
  const contents=tab.view.webContents;
  assert.equal(manager.detachTab(tab.id,first.window.id,{x:1700,y:100}),true);
  const detached=manager.stateForWindow(tab.windowId);
  assert.ok(detached && detached.window.id!==first.window.id);
  assert.equal(manager.finishTabDrag(tab.id,detached.window.id,{x:100,y:20}),true);
  assert.equal(tab.windowId,first.window.id);
  assert.equal(tab.view.webContents,contents);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.windowCount(),1);
});

test('detached window with a remaining tab stays open when another tab moves away', async () => {
  const manager=mockManager();
  const primary=manager.createWindow({module:'overview'});
  const moved=manager.openModule(primary.window.id,'cp');
  assert.equal(manager.detachTab(moved.id,primary.window.id,{x:1700,y:100}),true);
  const detached=manager.stateForWindow(moved.windowId);
  const remaining=manager.openModule(detached.window.id,'orders');
  assert.equal(manager.moveTab(moved.id,primary.window.id,1),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(detached.window.isDestroyed(),false,'source window must remain because one tab still lives there');
  assert.equal(manager.snapshot(detached).tabs.length,1);
  assert.equal(manager.snapshot(detached).tabs[0].id,remaining.id);
});

test('primary workspace is never auto-closed when its last tab is detached', async () => {
  const manager=mockManager();
  const primary=manager.createWindow({module:'overview'});
  const only=manager.tabForContents(manager.activeContents(primary));
  assert.equal(manager.detachTab(only.id,primary.window.id,{x:1700,y:100}),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(primary.window.isDestroyed(),false);
  assert.equal(manager.snapshot(primary).tabs.length,0);
  assert.equal(manager.windowCount(),2);
});

test('Buyer Log app theme overrides OS theme and updates every open window live', () => {
  const manager=mockManager({dark:false});
  const first=manager.createWindow({module:'overview'});
  const second=manager.createWindow({module:'cp'});
  assert.equal(normalizeWorkspaceTheme('grey'),'grey');

  manager.setTheme('dark');
  for(const state of [first,second]){
    assert.equal(state.window.titleBarOverlay.color,'#212429');
    assert.equal(state.window.titleBarOverlay.symbolColor,'#E8EAED');
    assert.equal(state.window.backgroundColor,'#131417');
    assert.equal(manager.snapshot(state).theme,'dark');
  }

  // OS remains light; it must not overwrite the explicit Buyer Log theme.
  manager.__nativeTheme.shouldUseDarkColors=false;
  manager.__nativeTheme.emit('updated');
  assert.equal(first.window.titleBarOverlay.color,'#212429');

  manager.setTheme('light');
  for(const state of [first,second]){
    assert.equal(state.window.titleBarOverlay.color,'#FBFBFC');
    assert.equal(state.window.titleBarOverlay.symbolColor,'#101828');
    assert.equal(state.window.backgroundColor,'#F6F7F9');
    assert.equal(manager.snapshot(state).theme,'light');
  }
});

test('explicit close bypasses beforeunload and native F5/F12 target the live content renderer', () => {
  assert.match(MANAGER, /close\(\{ waitForBeforeUnload:false \}\)/);
  assert.doesNotMatch(MANAGER, /close\(\{ waitForBeforeUnload: true \}\)/);
  assert.match(MANAGER, /will-prevent-unload/);
  assert.match(MANAGER, /function cleanupTab/);
  assert.match(MANAGER, /function purgeStaleTabs/);
  assert.match(MANAGER, /finishTabDrag/);
  assert.match(MANAGER, /reattachTab/);
  assert.match(MAIN, /workspace-theme/);
  assert.match(PRELOAD, /workspace-theme/);
  assert.match(APP, /workspace\?\.setTheme\?\.\(resolved\)/);
  assert.match(SHELL_JS, /document\.documentElement\.dataset\.theme/);
  assert.match(MAIN, /nativeTheme/);
  assert.match(MAIN, /workspace-finish-tab-drag/);
  assert.match(MAIN, /workspace-reattach-tab/);
  assert.match(MANAGER, /contents\.reload\(\)/);
  assert.match(MANAGER, /contents\.toggleDevTools\(\)/);
});
