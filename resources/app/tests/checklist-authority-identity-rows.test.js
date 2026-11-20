'use strict';
/* #1079 WS6 — checklist yetki çözümü tam CP/Orders kurulumu yerine kimlik satırı kullanır.
   Kimlik satırı gerçek buildOrdersRowsFromASAS çıktısıyla aynı dört alanı, aynı orderKey ve
   opsiyon kimliğini üretmelidir; anahtar '0' eski tam kurulum yoluna döner. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const serverPath = path.join(__dirname, '../server/server.js'), source = fs.readFileSync(serverPath, 'utf8');
function fn(name) { const at = source.indexOf('function ' + name + '('); assert.ok(at >= 0, name); return source.slice(at, source.indexOf('\n}', at) + 2); }
const parse = require('../server/lib/parse'), CP = require('../public/cp-readiness-engine'), Checklist = require('../public/cp-checklist-engine');
const FIELDS = ['Order Code', 'Model Name', 'C.Code', 'PLM ID'];

const base = { season: 'SS27', manufacturer: 'Demo Supplier', license: 'Demo', category: 'Knit', qty: 100, kalan: 100, fob: 4.2, opd: new Date(Date.UTC(2026, 9, 1)), countryRaw: 'TR' };
const orders = [
  { ocode: '4100001', model: 'DEMO MODEL', ccode: '01', plm: '12345' },
  { ocode: 4100002, model: ' demo  model ', ccode: 1, plm: '12345.0' },
  { ocode: '4100003', model: 'İPEK ışık', ccode: 'A1', plm: 12345.7 },
  { ocode: '4100004', model: 'DEMO', ccode: '02', plm: null, kalan: 0 },
  { ocode: '4100005', model: '', ccode: '', plm: '' },
  { ocode: '4100006', model: 'DEMO', ccode: '03', plm: 'ABC' },
  { ocode: '4100007', model: null, ccode: null, plm: ' 77 ' },
  { ocode: '4100001', model: 'DEMO MODEL', ccode: '02', plm: '12345', kalan: 0 },
].map(o => ({ ...base, ...o }));

function context(env) {
  const c = { process: { env }, Number, isNaN, Math };
  vm.createContext(c);
  vm.runInContext(['checklistIdentityRowsEnabled', 'orderIdentityRowsFromASAS'].map(fn).join('\n'), c);
  return c;
}

test('identity rows equal the real Orders builder on identity fields, orderKey and option identity', () => {
  const built = parse.buildOrdersRowsFromASAS(orders, {}, {});
  const identity = context({}).orderIdentityRowsFromASAS(orders, { includeInactive: true });
  assert.equal(identity.length, built.length, 'one row per ASAS input, inactive rows included');
  built.forEach((row, i) => {
    for (const field of FIELDS) assert.strictEqual(identity[i][field], row[field], `${field} @${i}`);
    const a = CP.analyzeOrder(row), b = CP.analyzeOrder(identity[i]);
    assert.equal(b.orderKey, a.orderKey);
    assert.equal(b.orderCode, a.orderCode);
    assert.equal(Checklist.optionIdentity(b), Checklist.optionIdentity(a));
  });
});

test('without includeInactive the identity rows keep the active filter of the CP builder', () => {
  const built = parse.buildCPRowsFromASAS(orders, {}, {});
  const identity = context({}).orderIdentityRowsFromASAS(orders);
  assert.deepEqual(identity.map(r => CP.analyzeOrder(r).orderKey), built.map(r => CP.analyzeOrder(r).orderKey));
});

test('switch defaults on; BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS=0 restores the full build path', () => {
  assert.equal(context({}).checklistIdentityRowsEnabled(), true);
  assert.equal(context({ BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS: '1' }).checklistIdentityRowsEnabled(), true);
  assert.equal(context({ BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS: '0' }).checklistIdentityRowsEnabled(), false);
  const rowsFn = fn('agentQualityOrderRowsNow');
  // Kimlik yolu yalnız yetki/Horizon süzgecinden SONRA ve anahtar açıkken devreye girer.
  assert.match(rowsFn, /const businessRows=[\s\S]*if\(identityOnly&&checklistIdentityRowsEnabled\(\)\)return orderIdentityRowsFromASAS\(businessRows,\{includeInactive\}\);[\s\S]*build\(businessRows,/);
  assert.match(fn('checklistAuthorizedOrdersNow'), /agentQualityOrderRowsNow\(profile,\{source,includeInactive:true,identityOnly:true\}\)/);
  // Yazma yolu: çağrı genelindeki manageAllOrders kararı satır başına yeniden hesaplanmaz.
  assert.match(fn('checklistAuthorizedOrdersNow'), /canUserEditOrderCode\(profile,canonicalFields\.value\(row,source,'orderCode'\),\{manageAll:manageAllOrders\}\)/);
  // Test raporu değerlendirmesi tam satırı kullanmaya devam eder.
  assert.doesNotMatch(fn('agentQualityAuthorizedOrdersNow'), /identityOnly/);
});
