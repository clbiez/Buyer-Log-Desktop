'use strict';
// In-memory exact-edit recipe ONLY. Never writes app-main.js or a full copy.
const assert = require('node:assert/strict');
const { source, poll, live, tail } = require('./source.cjs');
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, 'exact-edit anchor must occur once: '+before.slice(0,75));
  return text.replace(before, after);
}
function adaptBlocks() {
  const pollAfter = once(poll,
    'setTimeout(()=>{void pollSharedRevisions();sharedRevisionTimer=window.setInterval(pollSharedRevisions,7000);},2500);',
    `let sharedRevisionPublish=()=>{};
const sharedRevisionContext=window.BLSharedRevisionContext;
const sharedRevisionPoller=window.BLSharedRevisionPoller?.create({
  readContext:()=>sharedRevisionContext?.read()||null,
  onRevisions:detail=>window.dispatchEvent(new CustomEvent('bl-shared-revision',{detail})),
  publish:message=>sharedRevisionPublish(message)
});
// Missing helper keeps the exact legacy per-page fallback. No single-leader claim.
if(!sharedRevisionPoller)setTimeout(()=>{void pollSharedRevisions();sharedRevisionTimer=window.setInterval(pollSharedRevisions,7000);},2500);
window.addEventListener('pageshow',event=>{if(event.persisted)initLiveSync();});`);
  let next = once(live, '  if(!window.BL_CLIENT_ID)return;', '  window.__shell06StopLiveSync?.();\n  if(!window.BL_CLIENT_ID)return;');
  next = once(next,
    '  let source=null,gap=false,retryMs=1000,retryTimer=0,followed=false;',
    `  let source=null,gap=false,retryMs=1000,retryTimer=0,followed=false;
  let closed=false,releaseLeader=null;
  const lockAbort=new AbortController();`);
  next = once(next, "    if(typeof EventSource==='undefined')return;", "    if(closed||typeof EventSource==='undefined')return;");
  next = once(next, '    source=new EventSource(url);', '    const opened=source=new EventSource(url);');
  next = once(next, '    source.onopen=()=>{', `    source.onopen=()=>{
      if(closed||source!==opened)return;
      if(gap)sharedRevisionPoller?.catchUp();`);
  next = once(next, '    source.onmessage=event=>{', '    source.onmessage=event=>{\n      if(closed||source!==opened)return;');
  next = once(next, '    source.onerror=()=>{', '    source.onerror=()=>{\n      if(closed||source!==opened)return;');
  next = once(next, '  if(!shared){connect();return;}', `  const startPoll=()=>{
    sharedRevisionPublish=announce;
    sharedRevisionPoller?.start({catchUp:true});
  };
  const activity=()=>sharedRevisionPoller?.setActive(!document.hidden&&nativeActive);
  let nativeActive=true;
  const online=()=>sharedRevisionPoller?.setOnline(navigator.onLine!==false);
  const contextChanged=()=>{sharedRevisionPoller?.contextChanged();if(shared)announce({type:'status?'});};
  const unsubscribe=sharedRevisionContext?.subscribe(contextChanged);
  const unsubscribeNative=window.buyerLogDesktop?.workspace?.onTabActivity(payload=>{nativeActive=Boolean(payload&&payload.active);activity();});
  document.addEventListener('visibilitychange',activity);
  window.addEventListener('online',online);window.addEventListener('offline',online);
  window.addEventListener('bl:user-access-applied',contextChanged);
  window.addEventListener('bl:iam-revision-available',contextChanged);
  const stop=()=>{
    if(closed)return;closed=true;
    sharedRevisionPoller?.stop();sharedRevisionPublish=()=>{};
    clearTimeout(retryTimer);source?.close();source=null;
    lockAbort.abort();releaseLeader?.();channel?.close();
    if(typeof unsubscribe==='function')unsubscribe();
    if(typeof unsubscribeNative==='function')unsubscribeNative();
    document.removeEventListener('visibilitychange',activity);
    window.removeEventListener('online',online);window.removeEventListener('offline',online);
    window.removeEventListener('bl:user-access-applied',contextChanged);
    window.removeEventListener('bl:iam-revision-available',contextChanged);
    window.removeEventListener('pagehide',hide);
  };
  const hide=event=>{stop();if(!event.persisted)sharedRevisionPoller?.dispose();};
  window.__shell06StopLiveSync=stop;window.addEventListener('pagehide',hide);
  online();activity();
  if(!shared){startPoll();connect();return;}`);
  next = once(next, '    const message=event&&event.data||{};', `    const message=event&&event.data||{};
    if(closed)return;
    if(message.type==='shared-revisions'){sharedRevisionPoller?.receive(message);return;}
    if(message.type==='status?'&&source)sharedRevisionPoller?.share();`);
  next = once(next, `  locks.request('buyerlog-live-sync-leader',()=>new Promise(()=>{
    // Önceki liderden devralındıysa arada kaçırılmış olay olabilir.
    if(followed)gap=true;
    connect();
  }));`, `  locks.request('buyerlog-live-sync-leader',{signal:lockAbort.signal},()=>new Promise(resolve=>{
    if(closed){resolve();return;}
    releaseLeader=resolve;
    if(followed)gap=true;
    startPoll();
    connect();
  })).catch(()=>{if(!closed)stop();});`);
  return [pollAfter, next, tail];
}
function exactEdits() { const [a,b] = adaptBlocks(); return [{before:poll,after:a},{before:live,after:b}]; }
function verify() { const edits=exactEdits();for(const e of edits)once(source,e.before,e.after);return {base:'1796193f0a57c7785e7bf9fdb3557e33c550b25e',edits:edits.map(e=>({beforeLines:e.before.split('\n').length,afterLines:e.after.split('\n').length}))}; }
if(require.main===module)console.log(JSON.stringify(verify(),null,2));
module.exports={adaptBlocks,exactEdits,verify};
