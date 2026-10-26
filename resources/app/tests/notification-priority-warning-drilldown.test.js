'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');

function createHistoryRecorder(){
  const start=APP.indexOf('function notificationHistoryAdd(');
  const end=APP.indexOf('function notificationHistoryDate(',start);
  assert.ok(start>=0&&end>start,'notificationHistoryAdd code must be accessible');
  const state={items:[]};
  let writes=0;
  const factory=new Function('notificationHistoryLoad','notificationHistorySave','notificationHistoryUpdateBadge','NOTIFICATION_HISTORY_LIMIT',
    APP.slice(start,end)+'\nreturn notificationHistoryAdd;');
  const add=factory(()=>state,()=>{writes++;},()=>{},250);
  return{add,state,writes:()=>writes};
}

test('routine info/success and file-ready confirmations do not clutter notification history',()=>{
  const {add,state,writes}=createHistoryRecorder();
  assert.equal(add('1 cell pasted','toast',{severity:'info'}),false);
  assert.equal(add('Saved','center',{severity:'success'}),false);
  assert.equal(add('File ready','toast',{severity:'success'}),false);
  assert.equal(state.items.length,0);
  assert.equal(writes(),0);
  assert.doesNotMatch(APP,/notificationHistoryAdd\(\x60\$\{label\}: \$\{text\}\x60,'toast'\)/);
});

test('warnings, failures and explicitly important messages persist with their proper metadata',()=>{
  const {add,state}=createHistoryRecorder();
  assert.equal(add('Seven warnings','toast',{severity:'warning',warnings:['Missing mapping','Invalid date'],scope:'refresh-warnings'}),true);
  assert.equal(state.items[0].severity,'warning');
  assert.deepEqual(state.items[0].warnings,['Missing mapping','Invalid date']);
  assert.equal(add('Seven warnings','toast',{severity:'warning',warnings:['Missing mapping','Invalid date'],scope:'refresh-warnings'}),false);
  assert.equal(add('Seven warnings','toast',{severity:'warning',warnings:['Missing mapping','Another issue'],scope:'refresh-warnings'}),true);
  assert.equal(state.items.length,2);
  assert.equal(add('Import failed','toast',{severity:'info'}),true);
  assert.equal(state.items[0].severity,'error');
  assert.equal(add('Forced important announcement','toast',{persist:true}),true);
  assert.equal(add('Hidden warning','toast',{severity:'warning',persist:false}),false);
});

test('saved warnings open a readable list; linked rows activate by single click and keyboard',()=>{
  const warningUi=APP.slice(APP.indexOf('function showWarnDetails('),APP.indexOf('function updSourceHint('));
  const historyUi=APP.slice(APP.indexOf('function renderNotificationHistoryList('),APP.indexOf('notificationHistoryUpdateBadge();\n\n// Ekranin ORTASINDA',APP.indexOf('function renderNotificationHistoryList(')));
  assert.match(warningUi,/showWarnDetails\(warnings=appWarnings\)/);
  assert.match(warningUi,/visibleWarnings\.map/);
  assert.match(warningUi,/role="button" tabindex="0"/);
  assert.match(warningUi,/addEventListener\('click',e=>/);
  assert.match(warningUi,/addEventListener\('keydown',e=>/);
  assert.doesNotMatch(warningUi,/addEventListener\('dblclick'/);
  assert.match(historyUi,/data-notification-open/);
  assert.match(historyUi,/showWarnDetails\(warnings\)/);
  assert.match(historyUi,/Array\.isArray\(item\.warnings\)/);
});
