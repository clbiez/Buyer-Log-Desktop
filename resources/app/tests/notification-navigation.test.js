'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.NOTIFICATION_BASE_SOURCE||path.join(root,'public/app-main.js'),'utf8');
function fixture(){
 const saved=new Map(),messages=[],opened=[],rows=[{_id:10,key:'123|DEMO|001'},{_id:20,key:'123|DEMO|002'}];
 const ctx={console,Intl,Date,Math,JSON,appLang:'en',state:{currentUser:{id:'buyer'},cp:{rows}},
  BLStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},document:{getElementById:()=>null},
  BLCanAccessArea:()=>true,BL_USER_CONTEXT:{id:'buyer'},BLPerf:{ensureFeature:async()=>{}},
  ensureCpLoaded:async()=>true,ensureOrdersLoaded:async()=>true,lineKeyOfRow:r=>r.key,
  currentActiveTab:()=>'',switchTab:m=>opened.push(['module',m]),showToast:m=>messages.push(m),
  BLChecklistSupplierSync:{openNotificationForRow:(r,id)=>{opened.push(['checklist',r._id,id]);return true;}},
  BLCpAssistant:{openOverviewRows:r=>opened.push(['detail',r[0]._id])}};
 ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('const NOTIFICATION_HISTORY_KEY='),source.indexOf('function notificationHistoryDate')),ctx);
 return {ctx,saved,messages,opened,rows};
}
const target={module:'cp',lineKey:'123|DEMO|002',itemId:'tests~part~B',fieldTr:'Testler · B',fieldEn:'Tests · B',ownerId:'buyer'};
test('target survives history persistence without row IDs, URLs or functions; legacy notices still load',()=>{
 const f=fixture();f.ctx.notificationHistoryAdd('component rejected','toast',{...target,rowId:10,url:'javascript:bad()',onClick:()=>{}});
 const item=JSON.parse([...f.saved.values()][0]).items[0];assert.equal(item.target.lineKey,target.lineKey);assert.equal(item.target.rowId,undefined);assert.equal(item.target.url,undefined);
 assert.match(f.ctx.notificationTargetText(item.target),/123.*002.*Tests · B/);
 f.ctx.appLang='tr';assert.match(f.ctx.notificationTargetText(item.target),/Testler · B/);
 f.ctx.notificationHistoryAdd('old plain notification');assert.equal(f.ctx.notificationHistoryLoad().items[0].target,undefined);
 for(let i=0;i<260;i++)f.ctx.notificationHistoryAdd('bounded '+i);assert.equal(f.ctx.notificationHistoryLoad().items.length,250);
});
test('navigation uses current canonical line after IDs/order/filter change, including the exact part',async()=>{
 const f=fixture();f.rows.reverse();f.rows[0]._id=901;
 assert.equal(await f.ctx.openNotificationTarget(target),true);assert.deepEqual(f.opened,[['module','cp'],['checklist',901,'tests~part~B']]);
});
test('missing orders, revoked area, different user and session changes never open a record',async()=>{
 const f=fixture();assert.equal(await f.ctx.openNotificationTarget({...target,lineKey:'999|GONE|001'}),false);assert.match(f.messages.pop(),/no longer/);
 f.ctx.BLCanAccessArea=()=>false;assert.equal(await f.ctx.openNotificationTarget(target),false);assert.match(f.messages.pop(),/access/);
 f.ctx.BLCanAccessArea=()=>true;assert.equal(await f.ctx.openNotificationTarget({...target,ownerId:'other'}),false);
 f.ctx.BLPerf.ensureFeature=async()=>{f.ctx.state.currentUser.id='other';};assert.equal(await f.ctx.openNotificationTarget(target),false);assert.equal(f.opened.length,0);
});
test('records replaced during lazy loading are re-resolved and read-only rows open details',async()=>{
 const f=fixture();f.ctx.BLPerf.ensureFeature=async()=>{f.ctx.state.cp.rows=[{key:target.lineKey,_id:902,_canEdit:false}];};
 assert.equal(await f.ctx.openNotificationTarget(target),true);assert.deepEqual(f.opened,[['module','cp'],['detail',902]]);assert.match(f.messages[0],/read-only/);
});
test('target actions preserve unrelated callbacks and close only after successful navigation',async()=>{
 const f=fixture(),actions=[];const options=f.ctx.notificationOptions({target,actions:[{id:'other',label:'Other'}],onAction:id=>actions.push(id)});
 assert.equal(options.actions.length,2);await options.onAction('other');assert.deepEqual(actions,['other']);
 let closed=0;await options.onAction('notification-target',{close:()=>closed++});assert.equal(closed,1);
 f.ctx.BLCanAccessArea=()=>false;await options.onAction('notification-target',{close:()=>closed++});assert.equal(closed,1);
 assert.equal(f.ctx.notificationTarget({module:'https://bad'}),null);
});
