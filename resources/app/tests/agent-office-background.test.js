'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createAgentOfficeBackground}=require('../electron/agent-office-background');
test('tray close is opt-in, excludes auth windows, permits quit, restores windows and rate-limits private generic notifications',()=>{
 const app=new EventEmitter();let quitting=false,quits=0,shown=0;app.quit=()=>quits++;
 class Win extends EventEmitter{constructor(valid){super();this.valid=valid;this.hidden=false;}hide(){this.hidden=true;}show(){this.hidden=false;}isMinimized(){return false;}focus(){}}
 const main=new Win(true),auth=new Win(false);let tray;
 class Tray{constructor(){tray=this;}setToolTip(){}on(){}setContextMenu(menu){this.menu=menu;}destroy(){this.destroyed=true;}}
 class Notification extends EventEmitter{constructor(options){super();this.options=options;}static isSupported(){return true;}show(){shown++;assert.ok(!this.options.body.includes('Order'));}}
 const runtime=createAgentOfficeBackground({app,BrowserWindow:{getAllWindows:()=>[main,auth]},Tray,Menu:{buildFromTemplate:x=>x},Notification,icon:'app.ico',isAppWindow:w=>w.valid,isQuitting:()=>quitting});
 let prevented=0;const close={preventDefault:()=>prevented++};main.emit('close',close);assert.equal(prevented,0);
 assert.equal(runtime.set(true,'en').enabled,true);main.emit('close',close);assert.equal(prevented,1);assert.equal(main.hidden,true);auth.emit('close',close);assert.equal(prevented,1);
 runtime.notify('en');runtime.notify('en');assert.equal(shown,1);tray.menu[1].click();assert.equal(quits,1);quitting=true;main.emit('close',close);assert.equal(prevented,1);
 runtime.set(false,'en');assert.equal(main.hidden,false);assert.equal(tray.destroyed,true);runtime.dispose();
});
