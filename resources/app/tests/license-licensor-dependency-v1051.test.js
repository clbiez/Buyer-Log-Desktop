'use strict';

/* v10.51 — License → Licensor dependency contract.
 * The resolver is shared by browser and Node. UI contracts remain source-led
 * because app-main.js is loaded by the browser rather than CommonJS. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const PARSE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'parse.js'), 'utf8');
const rules = require(path.join(ROOT, 'public', 'business-rules.js'));
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const db = require(path.join(ROOT, 'server', 'db.js'));

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0;
  let close = source.indexOf('(', start);
  for (; close < source.length; close += 1) {
    if (source[close] === '(') paren += 1;
    else if (source[close] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', close);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

test('License → Licensor resolver: boş, çözümlenmiş ve kuralı eksik durumları ayırır', () => {
  assert.deepEqual(rules.resolveLicenseLicensor('', []), {
    license: '', latestDate: '', licensors: [], ambiguous: false, licensorsLabel: '', displayValue: '',
    hasLicense: false, hasRule: false, status: 'empty',
  });

  const resolved = rules.resolveLicenseLicensor('Marvel', [
    { license: 'Marvel', licensor: 'Disney', opdStart: '2026-01-01', opdEnd: '2026-12-31' },
  ]);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.hasRule, true);
  assert.equal(resolved.displayValue, 'Disney');

  const missing = rules.resolveLicenseLicensor('Marvel', [
    { license: 'Marvel', licensor: 'Disney', opdStart: 'not-a-date', opdEnd: '2026-12-31' },
  ]);
  assert.equal(missing.status, 'missing-rule');
  assert.equal(missing.hasLicense, true);
  assert.equal(missing.hasRule, false);
  assert.equal(missing.displayValue, '');
});

test('Collection License temizlenince eski manuel Licensor da temizlenir', () => {
  const body = bodyOf(APP, 'kolApplyLicensorFromLicense');
  const apply = new Function(
    'norm', 'turknorm', 'editableValuesEqual', 'kolResolveLicensorsForLicense',
    `return function kolApplyLicensorFromLicense(row){${body}};`,
  )(
    value => String(value == null ? '' : value).trim(),
    value => String(value == null ? '' : value).toUpperCase().replace(/\s+/g, ' ').trim(),
    (left, right) => String(left == null ? '' : left) === String(right == null ? '' : right),
    () => ({ displayValue: '' }),
  );
  const row = { lisans: '', licensor: 'Eski değer', _licensorManual: true };
  assert.equal(apply(row), true);
  assert.equal(row.licensor, '');
});

test('CP/Siparişler Licensor üretimi kural yokken yalnız bilinen License kataloğuna düşer', () => {
  const order = {
    ocode: 7301, model: 'MODEL A', ccode: 'C01', colour: 'BLACK', license: 'Unmapped License',
    manufacturer: 'Factory A', season: 'W7', countryRaw: 'TURKIYE', buyerGrup: 'LISANS',
    merch: 'CU4E', category: 'T-Shirt', qty: 10, kalan: 10, fob: 5, antrepo: 0,
    merkezSevkeHazirKalan: 0, opd: new Date(2026, 0, 1), ex: new Date(2026, 6, 1),
    retail: new Date(2026, 7, 1), mb: new Date(2026, 7, 15), plm: 101,
  };
  const options = { ...db.defaultOverrides(), nonDtrManufacturers: ['Factory A'], pricingRules: [] };
  assert.equal(parse.buildCPRowsFromASAS([order], {}, options)[0].Licensor, '');
  assert.equal(parse.buildOrdersRowsFromASAS([order], {}, options)[0].Licensor, '');
  order.license = 'Marvel';
  assert.equal(parse.buildCPRowsFromASAS([order], {}, options)[0].Licensor, 'DTR');
  assert.equal(parse.buildOrdersRowsFromASAS([order], {}, options)[0].Licensor, 'DTR');
});

test('License yokken server projectionları ? veya Unknown üretmez', () => {
  assert.doesNotMatch(PARSE, /o\.license\) : '\?'/);
  assert.doesNotMatch(PARSE, /order\.license\) \? .*: '\?'/);
  const options = { ...db.defaultOverrides(), pricingRules: [] };
  const order = {
    ocode: 7302, model: 'MODEL B', ccode: 'C02', colour: 'WHITE', license: '',
    manufacturer: 'Factory B', season: 'W7', countryRaw: 'TURKIYE', buyerGrup: '',
    merch: 'CU4E', category: 'T-Shirt', qty: 10, kalan: 10, fob: 5, antrepo: 0,
    merkezSevkeHazirKalan: 0, opd: new Date(2026, 0, 1), ex: new Date(2026, 6, 1),
    retail: new Date(2026, 7, 1), mb: new Date(2026, 7, 15), plm: 102,
  };
  assert.equal(parse.buildCPRowsFromASAS([order], {}, options)[0].Licensor, '');
  assert.equal(parse.buildOrdersRowsFromASAS([order], {}, options)[0].Licensor, '');
});

test('Collection toplu edit/yapıştırma yolu da boş License için Licensor guardı taşır', () => {
  const commit = bodyOf(APP, 'commitKolEditor');
  assert.match(commit, /k==='licensor'&&!norm\(row\.lisans\)\)\{val='';el\.value='';\}/);
  assert.match(commit, /if\(!norm\(row\.lisans\)\)\{[\s\S]*row\._licensorManual=false/);
  const loaded = bodyOf(APP, 'applyLicensorRulesToLoadedRows');
  assert.match(loaded, /if\(!license\)\{/);
  assert.match(loaded, /row\.Licensor=''/);
  assert.doesNotMatch(loaded, /licensorOf\(/);
});

test('Licensor hücresi License yokken disabled, kural yokken görünür uyarı kullanır', () => {
  const start = APP.indexOf("case 'licensor': {");
  assert.ok(start >= 0, 'Licensor hücresi bulunmalı');
  const block = APP.slice(start, APP.indexOf("    default: {", start));
  assert.match(block, /licenseLicensorStateForRow\(r\)/);
  assert.match(APP, /kolAutoLicensorState\(r\)/);
  assert.match(block, /disabled/);
  assert.match(block, /kolRuleMissing/);
  assert.match(block, /⚠/);
  assert.match(APP, /function licenseLicensorWarningText\(resolution\)/);
  assert.match(APP, /License Royalty calculation rule found/);
});
