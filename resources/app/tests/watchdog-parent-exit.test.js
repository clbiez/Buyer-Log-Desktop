'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
async function until(check,ms){const end=Date.now()+ms;while(Date.now()<end){if(check())return true;await new Promise(r=>setTimeout(r,100));}return check();}

test('backend watchdog stops its server when the desktop process is killed (no orphan holding the port)',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-watchdog-parent-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const server=path.join(root,'server.js'),pidFile=path.join(root,'server.pid');
  fs.writeFileSync(server,`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  // Stand-in for the Electron main process; Task Manager "End task" is an abrupt kill.
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const watchdog=spawn(process.execPath,[path.join(__dirname,'../server/watchdog.js')],{stdio:'ignore',env:{...process.env,LOCALAPPDATA:root,BL_SERVER_FILE:server,BUYER_LOG_DESKTOP_PARENT_PID:String(parent.pid),BUYER_LOG_PARENT_POLL_MS:'200'}});
  t.after(()=>{for(const p of [parent,watchdog])try{p.kill('SIGKILL');}catch(_){}try{process.kill(Number(fs.readFileSync(pidFile,'utf8')),'SIGKILL');}catch(_){}});
  assert.ok(await until(()=>fs.existsSync(pidFile),10000),'server started');
  const serverPid=Number(fs.readFileSync(pidFile,'utf8'));
  await new Promise(r=>setTimeout(r,600));
  assert.ok(alive(watchdog.pid)&&alive(serverPid),'stays up while the desktop process lives');
  parent.kill('SIGKILL');await once(parent,'exit');
  assert.ok(await until(()=>!alive(watchdog.pid)&&!alive(serverPid),8000),'watchdog and server exit after the desktop process dies');
});
