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
const APP = read('public/app-main.js');
const { createWorkspaceManager, normalizeModule, normalizeWorkspaceTheme, clampIndex, MODULES } = require('../electron/workspace-manager');

let nextContentsId = 1;
let nextWindowId = 1;
class MockContents extends EventEmitter {
  constructor(){super();this.id=nextContentsId++;this.destroyed=false;this.url='';this.messages=[];this.closeDelay=0;this.blockBeforeUnload=false;}
  isDestroyed(){return this.destroyed;}
  loadURL(url){this.url=url;this.emit('did-finish-load');return Promise.resolve();}
  getURL(){return this.url;}
  setWindowOpenHandler(handler){this.openHandler=handler;}
  reload(){this.reloaded=(this.reloaded||0)+1;}
  toggleDevTools(){this.devtools=(this.devtools||0)+1;}
  focus(){this.focused=true;}
  send(channel,payload){this.messages.push({channel,payload});}
  close(options={}){
    if(this.destroyed)return;
    if(this.blockBeforeUnload&&options.waitForBeforeUnload){
      let allowed=false;
      this.emit('will-prevent-unload',{preventDefault:()=>{allowed=true;}});
      if(!allowed)return;
    }
    const destroy=()=>{if(this.destroyed)return;this.destroyed=true;this.emit('destroyed');};
    if(this.closeDelay>0)setTimeout(destroy,this.closeDelay);else destroy();
  }
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
  const manager=createWorkspaceManager({
    BrowserWindow:MockWindow,WebContentsView:MockView,dialog:{showMessageBoxSync:()=>dialogResponse},screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:2560,height:1440}})},path,crypto:{randomUUID:(()=>{let id=0;return()=>`tab-${++id}`;})()},origin:'http://127.0.0.1:5055',nativeTheme,
    shellFile:'workspace.html',shellPreload:'workspace-preload.js',contentPreload:'preload.js',iconPath:'buyerlog.ico',
    loadWindowState:()=>({width:1200,height:800,maximized:false}),saveWindowState:()=>{},applyNavigationPolicy:()=>{},log:()=>{},onFirstRendererReady:()=>{},
  });
  manager.__nativeTheme=nativeTheme;
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

test('window close waits for asynchronous tab destruction instead of getting stuck open', async () => {
  const manager=mockManager();
  const state=manager.createWindow({module:'overview'});
  const tab=manager.tabForContents(manager.activeContents(state));
  tab.view.webContents.closeDelay=30;
  state.window.close();
  assert.equal(state.window.isDestroyed(),false,'native close is intercepted while the live tab is still closing');
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(state.window.isDestroyed(),true,'window closes after its tab renderer is actually destroyed');
  assert.equal(manager.windowCount(),0);
});

test('beforeunload cancellation keeps the tab open and does not trigger the force-close fallback', async () => {
  const manager=mockManager({dialogResponse:1});
  const state=manager.createWindow({module:'overview'});
  const tab=manager.tabForContents(manager.activeContents(state));
  tab.view.webContents.blockBeforeUnload=true;
  assert.equal(await manager.closeTab(tab.id),false);
  assert.equal(tab.view.webContents.isDestroyed(),false);
  assert.equal(state.window.isDestroyed(),false);
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

test('tab close honors beforeunload and native F5/F12 target the live content renderer', () => {
  assert.match(MANAGER, /close\(\{ waitForBeforeUnload: true \}\)/);
  assert.match(MANAGER, /will-prevent-unload/);
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
