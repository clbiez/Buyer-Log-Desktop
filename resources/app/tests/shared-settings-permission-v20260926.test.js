'use strict';

/* Kullanıcı kararı: Endeksmatik, kur, yol süreleri, License Royalty, landed
   çarpanları, navlun, e-posta grupları, DTR/non-DTR üreticiler ve veri
   bağlantıları herkese yansır; DEĞİŞTİRME yalnız Moderatörün kişiye verdiği
   ortak ayar yetkisiyle yapılır. Önceden kur ve e-posta grupları her
   kullanıcıya yazılabiliyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = require('./helpers/server-source')();

function routeLine(method, route) {
  const start = source.indexOf(`app.${method}('${route}'`);
  assert.ok(start >= 0, `${method.toUpperCase()} ${route} bulunamadı`);
  return source.slice(start, source.indexOf('\n', start));
}

test('Ortak ayarların her yazma ucu yönetim iznini ister', () => {
  const business = [
    ['put', '/api/fx'], ['put', '/api/pricing-rules'], ['put', '/api/transit-rules'], ['put', '/api/non-dtr-manufacturers'],
    ['put', '/api/landed-multipliers'], ['put', '/api/freight-rates'],
    ['put', '/api/email-groups/headings/:kind'], ['post', '/api/email-groups/records'], ['post', '/api/email-groups/import'],
    ['put', '/api/email-groups/records/:id'], ['delete', '/api/email-groups/records/:id'], ['post', '/api/email-groups/records/:id/lock'],
  ];
  for (const [method, route] of business) assert.match(routeLine(method, route), /requirePermission\('manageBusinessRules'\)/, `${method} ${route}`);
  for (const [method, route] of [['put', '/api/model-connections'], ['post', '/api/endeksmatik/upload'], ['put', '/api/asas-source'], ['delete', '/api/model-images/all']]) {
    assert.match(routeLine(method, route), /requirePermission\('manageModelConnections'\)/, `${method} ${route}`);
  }
});

test('Kaynak klasördeki KUR.xlsx yalnız yetkili kullanıcıda ortak kura yazılır', () => {
  const start = source.indexOf("app.post('/api/choose-folder'");
  const body = source.slice(start, source.indexOf('\n});', start));
  assert.match(body, /hasPermission\(req\.currentUser, 'manageBusinessRules'\) \? await syncFxFromKurWorkbook/);
});

test('İstemci yetkisiz kullanıcıya ortak ayar düzenleyicilerini göstermez', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-access-ui.js'), 'utf8');
  const controls = ui.match(/manageBusinessRules:\[([^\]]*)\]/)[1];
  for (const id of ['transitRulesBtn', 'nonDtrManufacturersBtn', 'cpLicenseRoyaltyBtn', 'ordersLicenseRoyaltyBtn', 'kolLicenseRoyaltyBtn', 'ocFxBtn', 'btnSourceFx']) {
    assert.ok(controls.includes(`'${id}'`), `${id} izne bağlı olmalı`);
  }
  const email = fs.readFileSync(path.join(__dirname, '..', 'public', 'email-groups.js'), 'utf8');
  assert.match(email, /function canManage\(\) \{\s*return typeof window\.BLHasPermission !== 'function' \|\| window\.BLHasPermission\('manageBusinessRules'\);/);
  assert.match(email, /async function addRecord\(\) \{\s*if \(!canManage\(\)\) return;/);
  assert.match(email, /async function startEdit\(id\) \{\s*if \(!canManage\(\)\) return;/);
});
