const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');
const SERVER_PREFS = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'user-preferences.js'), 'utf8');

test('v6.14 places Notification History immediately left of Notebook', () => {
  const notifications = INDEX.indexOf('id="notificationsBtn"');
  const notebook = INDEX.indexOf('id="todoBtn"');
  assert.ok(notifications >= 0 && notebook > notifications);
  assert.match(INDEX.slice(notifications, notebook), /notificationUnreadBadge/);
  assert.match(INDEX, /id="i-bell"/);
});

test('History classifies toast and centre notices by severity', () => {
  const toast = APP.slice(APP.indexOf('function showToast'), APP.indexOf('const TABLE_META'));
  const center = APP.slice(APP.indexOf('function showCenterNotice'), APP.indexOf('function showToast'));
  assert.match(toast, /notificationHistoryAdd\(msg,'toast',\{severity:o\.kind/);
  assert.match(center, /notificationHistoryAdd\(msg,'center',\{severity:o\.kind/);
  assert.match(APP, /scope:'source-filter-required'/);
  assert.match(APP, /NOTIFICATION_HISTORY_LIMIT=250/);
});

test('v6.14 history is user-scoped and synchronized like Notebook', () => {
  assert.match(STORAGE, /'lcw\.todo\.','lcw\.notifications\.'/);
  const synced = STORAGE.slice(STORAGE.indexOf('var SYNCED='), STORAGE.indexOf('function synced'));
  assert.match(synced, /lcw\.notifications\./);
  assert.match(SERVER_PREFS, /'lcw\.notifications\.'/);
});

test('v6.14 panel supports search, unread badge, individual removal and clear all', () => {
  assert.match(APP, /function openNotificationHistory/);
  assert.match(APP, /notificationHistorySearch/);
  assert.match(APP, /data-notification-remove/);
  assert.match(APP, /notificationHistoryClear/);
  assert.match(APP, /notificationHistoryMarkAllRead/);
  assert.match(CSS, /\.notificationUnreadBadge/);
  assert.match(CSS, /\.notificationHistoryList/);
});
