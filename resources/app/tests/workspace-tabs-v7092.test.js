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
const { createWorkspaceManager, normalizeModule, clampIndex, MODULES } = require('../electron/workspace-manager');

let nextContentsId = 1;
let nextWindowId = 1;
class MockContents extends EventEmitter {
  constructor(){super();this.id=nextContentsId++;this.destroyed=false;this.url='';this.messages=[];}
  isDestroyed(){return this.destroyed;}
  loadURL(url){this.url=url;this.emit('did-finish-load');return Promise.resolve();}
  getURL(){return this.url;}
  setWindowOpenHandler(handler){this.openHandler=handler;}
  reload(){this.reloaded=(this.reloaded||0)+1;}
  toggleDevTools(){this.devtools=(this.devtools||0)+1;}
  focus(){this.focused=true;}
  send(channel,payload){this.messages.push({channel,payload});}
  close(){if(this.destroyed)return;this.destroyed=true;this.emit('destroyed');}
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
  loadFile(file){this.file=file;this.webContents.emit('did-finish-load');this.emit('ready-to-show');return Promise.resolve();}
  show(){this.visible=true;}
  focus(){MockWindow.focused=this;this.emit('focus');}
  maximize(){this.maximized=true;this.emit('maximize');}
  close(){if(this.destroyed)return;let prevented=false;const event={preventDefault:()=>{prevented=true;}};this.emit('close',event);if(!prevented){this.destroyed=true;this.emit('closed');}}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
}

function mockManager(){
  return createWorkspaceManager({
    BrowserWindow:MockWindow,WebContentsView:MockView,dialog:{showMessageBoxSync:()=>0},screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:2560,height:1440}})},path,crypto:{randomUUID:(()=>{let id=0;return()=>`tab-${++id}`;})()},origin:'http://127.0.0.1:5055',
    shellFile:'workspace.html',shellPreload:'workspace-preload.js',contentPreload:'preload.js',iconPath:'buyerlog.ico',
    loadWindowState:()=>({width:1200,height:800,maximized:false}),saveWindowState:()=>{},applyNavigationPolicy:()=>{},log:()=>{},onFirstRendererReady:()=>{},
  });
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

test('live manager moves one WebContentsView across windows without recreating it', () => {
  const manager=mockManager();
  const first=manager.createWindow({module:'koleksiyon'});
  const lfl=manager.openModule(first.window.id,'lfl');
  const liveContents=lfl.view.webContents;
  assert.equal(manager.snapshot(first).tabs.length,2);
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
  assert.equal(manager.moveTab(lfl.id,first.window.id,1),true);
  assert.equal(manager.windowCount(),1,'empty detached window closes without closing the app workspace');
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
  assert.match(SHELL_PRELOAD, /showModuleMenu/);
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
  assert.match(MANAGER, /if \(source\.activeTabId\) showActive\(source, false\)/);
  assert.match(MANAGER, /else \{[\s\S]*?source\.forceClosing = true;[\s\S]*?source\.window\.close\(\)/);
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

test('tab close honors beforeunload and native F5/F12 target the live content renderer', () => {
  assert.match(MANAGER, /close\(\{ waitForBeforeUnload: true \}\)/);
  assert.match(MANAGER, /will-prevent-unload/);
  assert.match(MANAGER, /contents\.reload\(\)/);
  assert.match(MANAGER, /contents\.toggleDevTools\(\)/);
});
