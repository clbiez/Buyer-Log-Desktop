'use strict';

// A stale /api/data modelRefresh.scopes snapshot must never choose the next
// refresh group. The menu and /api/refresh must read the current ASAS config.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function client(fetchImpl) {
  const start = APP.indexOf('let authoritativeLinkedRefreshTargets=null;');
  const end = APP.indexOf('function refreshTargetsLabel(', start);
  assert.ok(start >= 0 && end > start, 'canonical refresh client functions exist');
  const functions = APP.slice(start, end);
  // Only the small, deterministic, production helper functions are evaluated.
  return new Function('fetch', 'renderHorizonBadges', 'appLang',
    'ALL_REFRESH_TARGETS', 'DEFAULT_LINKED_REFRESH_TARGETS',
    functions + ';return {syncLinkedRefreshMembers,linkedRefreshMembers,withLinkedRefreshTargets};'
  )(fetchImpl, () => {}, 'tr',
    ['cp','orders','backlog','lfl','priceanalysis'],
    ['orders','backlog','lfl','priceanalysis']);
}
function ok(members) {
  return {ok:true, json:async()=>({linkedTargets:members})};
}

test('refresh grouping uses live saved configuration, never old snapshot metadata', async () => {
  const requests=[];
  let members=['orders','backlog','lfl','priceanalysis'];
  const helper=client(async (url, options)=>{
    requests.push({url,options});
    return ok(members);
  });
  assert.deepEqual(helper.linkedRefreshMembers(),members);
  await helper.syncLinkedRefreshMembers();
  assert.deepEqual(helper.withLinkedRefreshTargets(['lfl']).slice().sort(),members.slice().sort());

  // User changes shared grouping in Data Management without a data refresh.
  members=['cp','orders'];
  await helper.syncLinkedRefreshMembers();
  assert.deepEqual(helper.linkedRefreshMembers(),['cp','orders']);
  assert.deepEqual(helper.withLinkedRefreshTargets(['cp']),['cp','orders']);
  assert.deepEqual(helper.withLinkedRefreshTargets(['lfl']),['lfl']);
  assert.ok(requests.every(item=>item.url==='/api/refresh-targets'
    && item.options.cache==='no-store'));
});

test('explicitly empty linked group remains empty, not silently defaulted', async () => {
  const helper=client(async ()=>ok([]));
  await helper.syncLinkedRefreshMembers();
  assert.deepEqual(helper.linkedRefreshMembers(),[]);
  assert.deepEqual(helper.withLinkedRefreshTargets(['orders']),['orders']);
});

test('invalid or failed refresh-config request cannot overwrite the last valid group', async () => {
  let payload=ok(['cp']);
  const helper=client(async ()=>payload);
  await helper.syncLinkedRefreshMembers();
  payload=ok(['unknown-target']);
  await assert.rejects(helper.syncLinkedRefreshMembers(), /geçersiz yenileme kapsamı/);
  assert.deepEqual(helper.linkedRefreshMembers(),['cp']);
  payload={ok:false,status:403,json:async()=>({error:'Yetki gerekli'})};
  await assert.rejects(helper.syncLinkedRefreshMembers(), /Yetki gerekli/);
  assert.deepEqual(helper.linkedRefreshMembers(),['cp']);
});

test('top refresh menu waits for current configuration, not modelScopes', () => {
  const menu=APP.slice(APP.indexOf('async function openTopRefreshMenu('),
    APP.indexOf('// Yenileme sürerken aynı düğmeye tekrar basmak'));
  const sync=menu.indexOf('await syncLinkedRefreshMembers()');
  const build=menu.indexOf('const members=linkedRefreshMembers()');
  assert.ok(sync >= 0 && build > sync);
  assert.doesNotMatch(menu,/state\.modelScopes|sharedFilter/);
  const refresh=APP.slice(APP.indexOf('async function loadFromServer(force, targets){'),
    APP.indexOf('const refreshTimerKey=',APP.indexOf('async function loadFromServer(force, targets){')));
  assert.ok(refresh.indexOf('await syncLinkedRefreshMembers()') >= 0);
  assert.ok(refresh.indexOf('withLinkedRefreshTargets(targets)') > refresh.indexOf('await syncLinkedRefreshMembers()'));
});

test('server uses the same config for menu and POST; source access is required', () => {
  const helper=SERVER.slice(SERVER.indexOf('function configuredRefreshMembers()'),
    SERVER.indexOf('const cpCoverage',SERVER.indexOf('function configuredRefreshMembers()')));
  assert.match(helper,/loadModelConnections\(\)/);
  assert.match(helper,/linkedTargetsOf\(asasItem\)/);
  assert.match(helper,/withRefreshTargets\(targets, configuredRefreshMembers\(\)\)/);
  const get=SERVER.slice(SERVER.indexOf("app.get('/api/refresh-targets'"),
    SERVER.indexOf("app.post('/api/refresh'"));
  assert.match(get,/userAccess\.requireArea\('source'\)/);
  assert.match(get,/linkedTargets: configuredRefreshMembers\(\)/);
  assert.match(get,/no-store/);
  assert.doesNotMatch(get,/modelRefresh\.scopes|lastRefreshResult/);
});
