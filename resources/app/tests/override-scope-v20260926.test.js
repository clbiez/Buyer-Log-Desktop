'use strict';

/* CP notları ve elle revizeler kullanıcılar arasında aktarılır ama yalnız
   yetki (veri kapsamı) dahilinde görünür. Düzenleme uçlarının yanıtı tüm
   override belgesini döndürdüğü için kapsam dışı siparişlerin notları
   yetkisiz kullanıcıya ulaşıyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeOverridesForViewer, orderCodeOfKey } = require('../server/lib/override-scope');
const source = require('./helpers/server-source')();

test('Sipariş bazlı haritalar kapsamla kırpılır; ortak ayarlar ve görsel haritası korunur', () => {
  const overrides = {
    notesmap: { 4100002: { Notes: 'benim' }, '4100000|MODEL|NVY': { Notes: 'başkasının' } },
    submap: { 4100002: 'Alt A', 4100000: 'Alt B' },
    suppfobmap: { '4100000': 5 }, delmap: { 4100002: 'Uçak' }, licensormap: {}, datemap: { '4100000|X|Y': {} },
    noteColumnValues: { 4100000: { c1: 'gizli' } },
    imagemap: { 'plm:1|colour:NVY': 'ci_1' },
    pricingRules: [{ id: 'r1' }], transitRules: [{ id: 't1' }], _revision: 9,
  };
  const scoped = scopeOverridesForViewer(overrides, code => code === 4100002);
  assert.deepEqual(scoped.notesmap, { 4100002: { Notes: 'benim' } });
  assert.deepEqual(scoped.submap, { 4100002: 'Alt A' });
  assert.deepEqual(scoped.suppfobmap, {});
  assert.deepEqual(scoped.delmap, { 4100002: 'Uçak' });
  assert.deepEqual(scoped.datemap, {});
  assert.deepEqual(scoped.noteColumnValues, {});
  assert.deepEqual(scoped.imagemap, overrides.imagemap, 'görsel haritası kırpılmaz');
  assert.deepEqual(scoped.pricingRules, overrides.pricingRules, 'ortak ayarlar kırpılmaz');
  assert.equal(scoped._revision, 9);
  assert.deepEqual(Object.keys(overrides.notesmap).length, 2, 'kaynak nesne değişmez');
  assert.equal(orderCodeOfKey('4.100.002|M|C'), 4100002);
  assert.equal(orderCodeOfKey('abc'), null);
});

test('Her /api yanıtındaki overrides nesnesi oturumdaki kullanıcıya göre kırpılır', () => {
  const at = source.indexOf('app.use(userAccess.requireSelection);');
  const guard = source.indexOf('function overridesForViewer(', 0);
  assert.ok(at > 0 && guard > 0);
  const middleware = source.slice(at, at + 1400);
  assert.match(middleware, /res\.json = body =>[\s\S]*body\.overrides[\s\S]*overridesForViewer\(req\.currentUser, body\.overrides\)/);
});
