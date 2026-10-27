'use strict';
// Acceptance harness: real Electron Views + production workspace manager and UI,
// connected only to benchmark-startup-orders.js's isolated synthetic backend.
const {app,BrowserWindow,WebContentsView,ipcMain,session,screen,nativeTheme,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),output=process.env.BUYER_LOG_STARTUP_MEASURE_ROOT;
const origin=process.env.BUYER_LOG_STARTUP_MEASURE_ORIGIN;
if(!output||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin||''))throw new Error('Isolated benchmark origin/root required');
// A fresh profile is required after source changes: the production service
// worker otherwise correctly retains assets with the same release version.
const profile=fs.mkdtempSync(path.join(output,'native-profile-'));
app.setPath('userData',profile);
app.setPath('sessionData',profile);
fs.writeFileSync(path.join(output,'native-debug-profile.txt'),profile);
let manager,state;
global.__startupNativeDone=false;
global.__startupNativeResult={};
app.whenReady().then(async()=>{
  fs.writeFileSync(path.join(output,'native-workspace.log'),'');
  const cookie=process.env.BUYER_LOG_STARTUP_MEASURE_COOKIE,split=cookie.indexOf('=');
  await session.defaultSession.cookies.set({url:origin,name:cookie.slice(0,split),value:cookie.slice(split+1),httpOnly:true,sameSite:'strict'});
  session.defaultSession.webRequest.onBeforeRequest((details,done)=>done({cancel:!details.url.startsWith(origin+'/')&&!details.url.startsWith('file:')&&!details.url.startsWith('data:')}));
  const started=performance.now(),ready=[];
  let baselineProcesses=null;
  const processes=()=>app.getAppMetrics().map(metric=>({pid:metric.pid,type:metric.type,memory:metric.memory}));
  manager=require('../electron/workspace-manager').createWorkspaceManager({
    BrowserWindow,WebContentsView,dialog,screen,nativeTheme,path,crypto,origin,
    shellFile:path.join(ROOT,'electron/workspace.html'),shellPreload:path.join(ROOT,'electron/workspace-preload.js'),contentPreload:path.join(ROOT,'electron/preload.js'),
    iconPath:path.join(ROOT,'buyerlog.ico'),loadWindowState:()=>({width:1600,height:1000}),saveWindowState(){},
    applyNavigationPolicy(contents){contents.setWindowOpenHandler(()=>({action:'deny'}));},
    log(message){fs.appendFileSync(path.join(output,'native-workspace.log'),message+'\n');},
  });
  const trusted=event=>Boolean(manager.tabForContents(event.sender));
  ipcMain.handle('buyerlog:workspace-snapshot',event=>manager.shellSnapshot(event));
  ipcMain.handle('buyerlog:workspace-set-module',(event,module)=>trusted(event)&&manager.updateTabModule(event.sender,module));
  ipcMain.handle('buyerlog:workspace-theme',(event,theme)=>trusted(event)&&manager.setTheme(theme));
  ipcMain.handle('buyerlog:workspace-activate',(event,id)=>manager.activateTab(state.window.id,id));
  ipcMain.handle('buyerlog:update-status',()=>({supported:false}));
  ipcMain.handle('buyerlog:workspace-startup-ready',async(event,modules)=>{
    if(!trusted(event))return false;
    const tab=manager.tabForContents(event.sender);ready.push({module:tab.module,atMs:performance.now()-started});
    if(tab.module==='overview'&&!baselineProcesses)baselineProcesses=processes();
    const result=manager.startupReady(event.sender,modules);
    if(tab.module==='orders'){
      const contents=event.sender;
      const rows=await contents.executeJavaScript('window.__acceptanceRows=state.orders.rows; state.orders.rows.length');
      const oldId=contents.id;
      for(const module of ['koleksiyon','cp','orders'])manager.openModule(state.window.id,module);
      const retained=oldId===manager.activeContents(state).id&&await contents.executeJavaScript('state.orders.rows===window.__acceptanceRows');
      await new Promise(resolve=>setTimeout(resolve,200));
      // Window capture contains only the workspace shell; native child Views
      // must be captured through their own WebContents to include the table.
      const image=await contents.capturePage();fs.writeFileSync(path.join(output,'native-startup-orders.png'),image.toPNG());
      global.__startupNativeResult={ready,rows,retained,diagnostics:manager.diagnosticsSnapshot(),baselineProcesses,processes:processes()};
      global.__startupNativeDone=true;
    }
    return result;
  });
  state=manager.createWindow({module:'overview'});
}).catch(error=>{global.__startupNativeResult={error:error.stack};global.__startupNativeDone=true;});
app.on('before-quit',()=>manager?.destroyAllWindows());
