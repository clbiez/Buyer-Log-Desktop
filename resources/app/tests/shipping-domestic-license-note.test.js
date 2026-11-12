'use strict';

// Domestic Landed kartı: girilen TL fiyatına royalty/hologram eklendiyse
// "FOB $x" satırının solunda neyin eklendiği gösterilir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function extract(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  let depth = 0;
  for (let i = APP.indexOf('{', start); i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

function load(lang) {
  const src = `let appLang=${JSON.stringify(lang)};${extract('shipMoney')}${extract('shipDomesticLicenseNote')}return shipDomesticLicenseNote;`;
  return new Function(src)();
}

test('royalty ve hologram eklendiyse not üretilir (TR/EN)', () => {
  const tr = load('tr')({ trRoyaltyPct: 12, trHologramCost: 0.05 }, true);
  assert.equal(tr.text, '+Roy. %12 +Holo. $0,05');
  assert.match(tr.title, /Royalty %12 \+ Hologram \$0,05/);
  const en = load('en')({ trRoyaltyPct: 12.5, trHologramCost: '' }, false);
  assert.equal(en.text, '+Roy. 12.5%');
  assert.match(en.title, /License cost/);
});

test('lisans maliyeti yoksa not basılmaz', () => {
  const fn = load('tr');
  assert.equal(fn({}, true), null);
  assert.equal(fn({ trRoyaltyPct: 0, trHologramCost: 0 }, true), null);
});

test('not Domestic kartında FOB satırının solunda render edilir', () => {
  assert.match(APP, /license:trUnit!=null\?shipDomesticLicenseNote\(row,tr\):null/);
  const i = APP.indexOf('data-ship-license');
  const j = APP.indexOf("${escapeHtml(option.sub||'')}");
  assert.ok(i > 0 && j > i, 'lisans notu FOB satırından önce gelmeli');
});
