// Acceptance host: real production workspace manager, shell and content preload.
// This deliberately omits the Windows launcher/updater and uses a local synthetic server.
const {app,BrowserWindow,WebContentsView,dialog,screen,ipcMain,nativeTheme,session}=require('electron');
const path=require('node:path'),crypto=require('node:crypto');
app.setPath('userData',process.env.SHELL05_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  const origin=process.env.SHELL05_ORIGIN,root=process.env.SHELL05_APP;
  const cookie=process.env.SHELL05_COOKIE,split=cookie.indexOf('=');
  await session.defaultSession.cookies.set({url:origin,name:cookie.slice(0,split),value:cookie.slice(split+1),httpOnly:true});
  const workspace=global.workspace=require(path.join(root,'electron/workspace-manager')).createWorkspaceManager({
    BrowserWindow,WebContentsView,dialog,screen,path,crypto,origin,nativeTheme,
    shellFile:path.join(root,'electron/workspace.html'),shellPreload:path.join(root,'electron/workspace-preload.js'),contentPreload:path.join(root,'electron/preload.js'),
    loadWindowState:()=>({width:1440,height:928,maximized:false}),saveWindowState:()=>{},applyNavigationPolicy:()=>{},log:()=>{},
  });
  ipcMain.handle('buyerlog:workspace-set-module',(event,module)=>workspace.updateTabModule(event.sender,module));
  ipcMain.handle('buyerlog:workspace-theme',(_event,theme)=>workspace.setTheme(theme));
  ipcMain.handle('buyerlog:workspace-snapshot',event=>workspace.shellSnapshot(event.sender));
  ipcMain.handle('buyerlog:workspace-open-module',(event,module)=>workspace.openModule(workspace.windowForContents(event.sender)?.id,module));
  global.shell05Ready=true;
});
