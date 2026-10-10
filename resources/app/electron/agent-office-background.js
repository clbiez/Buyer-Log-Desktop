'use strict';
// Optional tray mode keeps the existing backend alive. No login credentials,
// arbitrary IPC channels, model calls or operating-system service are added.
function createAgentOfficeBackground({app,BrowserWindow,Tray,Menu,Notification,icon,isAppWindow,isQuitting}) {
 let enabled=false,tray=null,language='tr',lastNotice=0;const attached=new WeakSet();
 const text=(tr,en)=>language==='en'?en:tr;
 const show=()=>{const windows=BrowserWindow.getAllWindows().filter(isAppWindow);for(const w of windows){w.show();if(w.isMinimized())w.restore();}windows[0]?.focus();};
 function attach(w){if(attached.has(w))return;attached.add(w);w.on('close',event=>{if(enabled&&!isQuitting()&&isAppWindow(w)){event.preventDefault();w.hide();}});}
 app.on('browser-window-created',(_event,w)=>attach(w));
 function set(value,lang){language=lang==='en'?'en':'tr';enabled=value===true;for(const w of BrowserWindow.getAllWindows())attach(w);
  if(enabled&&!tray){try{tray=new Tray(icon);tray.setToolTip('Buyer Log');tray.on('double-click',show);}catch(_){enabled=false;return{ok:false,enabled:false,code:'OFFICE_TRAY_UNAVAILABLE'};}}
  if(tray&&enabled)tray.setContextMenu(Menu.buildFromTemplate([{label:text('Buyer Log’u aç','Open Buyer Log'),click:show},{label:text('Çıkış · takibi durdur','Quit · stop monitoring'),click:()=>app.quit()}]));
  if(!enabled&&tray){tray.destroy();tray=null;show();}return{ok:true,enabled};
 }
 function notify(lang){language=lang==='en'?'en':'tr';if(!enabled||!Notification.isSupported()||Date.now()-lastNotice<60000)return{ok:true,shown:false};lastNotice=Date.now();const note=new Notification({title:'Buyer Log',body:text('Agent asistanında yeni bir uyarı var. İşler ve uyarılar ekranını inceleyin.','Your agent assistant has a new alert. Review Actions and alerts.'),silent:true});note.on('click',show);note.show();return{ok:true,shown:true};}
 return{set,notify,dispose(){enabled=false;tray?.destroy();tray=null;}};
}
module.exports={createAgentOfficeBackground};
