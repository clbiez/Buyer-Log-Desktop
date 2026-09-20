'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { canEditOrder, effectiveScopes, hashPin, verifyPin } = require('../server/lib/user-access');

function buyer(overrides = {}) {
  return {
    id: 'buyer-a', role: 'buyer', displayName: 'Buyer A', enabled: true,
    scopeMode: 'auto',
    autoScopes: { buyers:['Buyer A'], mags:['MAG-1'], mmygs:['MMYG-1'], buyingGroups:['BG-1'] },
    customScopes: { buyers:[], mags:[], mmygs:[], buyingGroups:[] },
    ...overrides,
  };
}

test('moderator can edit every order', () => {
  assert.equal(canEditOrder({ role:'moderator' }, { buyer:'Other' }), true);
});

test('buyer can edit exact Buyer ownership and cannot edit unrelated orders', () => {
  const profile = buyer();
  assert.equal(canEditOrder(profile, { buyer:'Buyer A', merch:'X', ageGroup:'Y', buyerGrup:'Z' }), true);
  assert.equal(canEditOrder(profile, { buyer:'Other', merch:'MAG-2', ageGroup:'MMYG-2', buyerGrup:'BG-2' }), false);
});

test('buyer can edit an order when MAG, MMYG and Buying Group all match', () => {
  const profile = buyer();
  assert.equal(canEditOrder(profile, { buyer:'Shared Buyer', merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' }), true);
  assert.equal(canEditOrder(profile, { buyer:'Shared Buyer', merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-X' }), false);
});

test('custom scope replaces automatic scope and empty custom scope is view-only', () => {
  const profile = buyer({ scopeMode:'custom', customScopes:{ buyers:['Buyer B'], mags:['M2'], mmygs:['A2'], buyingGroups:['G2'] } });
  assert.deepEqual(effectiveScopes(profile).buyers, ['Buyer B']);
  assert.equal(canEditOrder(profile, { buyer:'Buyer A', merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' }), false);
  assert.equal(canEditOrder(profile, { buyer:'Buyer B' }), true);
});

test('PINs are salted and validated without storing plain text', () => {
  const hashed = hashPin('2468');
  assert.match(hashed, /^scrypt\$/);
  assert.equal(hashed.includes('2468'), false);
  assert.equal(verifyPin('2468', hashed), true);
  assert.equal(verifyPin('0000', hashed), false);
});

test('per-user storage scopes preferences but keeps shared business records shared', () => {
  const source = fs.readFileSync(path.join(__dirname,'../public/user-storage.js'),'utf8');
  const store = new Map([['lcw_theme','dark'], ['lcw.collection.rows','shared']]);
  const native = {
    get length(){ return store.size; },
    key(i){ return [...store.keys()][i] ?? null; },
    getItem(k){ return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k,v){ store.set(String(k),String(v)); },
    removeItem(k){ store.delete(String(k)); },
    clear(){ store.clear(); },
  };
  const window = { localStorage:native, BL_USER_CONTEXT:{id:'moderator'} };
  vm.runInNewContext(source, { window });
  assert.equal(window.BLStorage.getItem('lcw_theme'),'dark');
  assert.equal(store.get('bl.user.moderator.lcw_theme'),'dark');
  window.BLStorage.setItem('lcw_theme','light');
  window.BLStorage.setItem('lcw.collection.rows','changed');
  assert.equal(store.get('bl.user.moderator.lcw_theme'),'light');
  assert.equal(store.get('lcw.collection.rows'),'changed');
});

test('v2.91 contains startup user selection, server-side order enforcement and moderator tools', () => {
  const server = fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
  const index = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  // rowViewOnly sınıfının uygulandığı yer index.html'den app-main.js'e taşındı.
  const appMain = fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const ui = fs.readFileSync(path.join(__dirname,'../public/user-access-ui.js'),'utf8');
  assert.match(server, /app\.get\('\/select-user'/);
  assert.match(server, /app\.use\(userAccess\.requireSelection\)/);
  assert.match(server, /rejectUnauthorizedOrders\(req, res/);
  assert.match(server, /userAccess\.requireModerator/);
  assert.match(appMain, /rowViewOnly/);
  assert.match(index, /user-context\.js/);
  // v3.83 (manuel kullanıcı hesapları): "Kullanıcıları ve Yetkileri Yönet" ->
  // "Kullanıcılar ve Hiyerarşi" olarak yeniden adlandırıldı.
  assert.match(ui, /Kullanıcılar ve Hiyerarşi/);
});
