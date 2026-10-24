'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

test('routine clipboard/save/refresh feedback does not create bell records', () => {
  const start=APP.indexOf('function notificationHistoryAdd(');
  const end=APP.indexOf('function notificationHistoryDate(',start);
  assert.ok(start>=0&&end>start);
  const state={items:[]};let saves=0,badgeUpdates=0;
  const add=new Function('notificationHistoryLoad','notificationHistorySave','notificationHistoryUpdateBadge','NOTIFICATION_HISTORY_LIMIT',
    APP.slice(start,end)+'return notificationHistoryAdd;')(
      ()=>state,()=>{saves++;},()=>{badgeUpdates++;},250);
  assert.equal(add('1 cell copied','toast',{severity:'info'}),false);
  assert.equal(add('Operation completed','center',{severity:'success'}),false);
  assert.equal(state.items.length,0);
  assert.equal(saves,0);
  assert.equal(badgeUpdates,0);
  assert.equal(add('Could not save','toast',{severity:'error'}),true);
  assert.equal(state.items[0].severity,'error');
  assert.equal(add('Important approval','center',{severity:'success',persist:true}),true);
  assert.equal(state.items.length,2);
});

test('refresh warnings preserve safe message snapshot and do not duplicate unchanged sets', () => {
  const start=APP.indexOf('function notificationHistoryAdd(');
  const end=APP.indexOf('function notificationHistoryDate(',start);
  const state={items:[]};
  const add=new Function('notificationHistoryLoad','notificationHistorySave','notificationHistoryUpdateBadge','NOTIFICATION_HISTORY_LIMIT',
    APP.slice(start,end)+'return notificationHistoryAdd;')(()=>state,()=>{},()=>{},250);
  const options={severity:'warning',scope:'source-refresh-warnings',warnings:['Missing field','Invalid row']};
  assert.equal(add('2 warnings','toast',options),true);
  assert.equal(add('2 warnings','toast',options),false);
  assert.equal(state.items.length,1);
  assert.deepEqual(state.items[0].warnings,options.warnings);
  assert.equal(add('1 warning','toast',{...options,warnings:['Missing field']}),true);
  assert.equal(state.items.length,2);
  assert.equal(add('Routine saved','toast',{severity:'info',persist:false}),false);
  assert.match(APP,/notificationHistoryAdd\(\s*appLang==='en'\?/);
});

test('both current and historical warning lists drill on a single click, including keyboard-activated buttons',()=>{
  const start=APP.indexOf('function showWarnDetails(');
  const end=APP.indexOf('function updSourceHint(',start);
  const warning=APP.slice(start,end);
  assert.match(warning,/function showWarnDetails\(warnings=appWarnings\)/);
  assert.match(warning,/data-warning-open/);
  assert.match(warning,/type="button" class="warningListOpen"/);
  assert.match(warning,/ov\.addEventListener\('click'/);
  assert.doesNotMatch(warning,/dblclick/);
  assert.match(warning,/if\(detail\)\{close\(\);showWarningDetailTable\(detail\);\}/);
  const history=APP.slice(APP.indexOf('function renderNotificationHistoryList('),APP.indexOf('notificationHistoryUpdateBadge();\n\n// Ekranin'));
  assert.match(history,/data-notification-open/);
  assert.match(history,/showWarnDetails\(Array\.isArray\(item\.warnings\)/);
  assert.match(CSS,/\.notificationHistoryOpen:focus-visible/);
  assert.match(CSS,/\.warningListOpen:focus-visible/);
});
