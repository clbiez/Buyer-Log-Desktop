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
  const src = `let appLang=${JSON.stringify(lang)};${extract('shipMoney')}${extract('shipLicenseNote')}${extract('shipDomesticLicenseNote')}${extract('shipOverseasLicenseNote')}return {dom:shipDomesticLicenseNote,yd:shipOverseasLicenseNote};`;
  const api = new Function(src)();
  return Object.assign(api.dom, { yd: api.yd });
}

test('royalty ve hologram eklendiyse not üretilir (TR/EN)', () => {
  const nb = s => s.replace(/\u00a0/g, ' ');
  const tr = load('tr')({ trRoyaltyPct: 12, trHologramCost: 0.05 }, true);
  assert.equal(nb(tr.text), '+Roy. %12 +Holo. $0,05');
  assert.match(tr.title, /Royalty %12 \+ Hologram \$0,05/);
  const en = load('en')({ trRoyaltyPct: 12.5, trHologramCost: '' }, false);
  assert.equal(nb(en.text), '+Roy. 12.5%');
  assert.match(en.title, /License cost/);
});

test('lisans maliyeti yoksa not basılmaz', () => {
  const fn = load('tr');
  assert.equal(fn({}, true), null);
  assert.equal(fn({ trRoyaltyPct: 0, trHologramCost: 0 }, true), null);
});

test('Overseas FOB kırılımı aynı biçimde, yalnız varsa gösterilir', () => {
  const fn = load('tr');
  const note = fn.yd({ ydRoyaltyPct: 15, ydHologramCost: 0.03 }, true);
  assert.equal(note.text.replace(/\u00a0/g, ' '), '+Roy. %15 +Holo. $0,03');
  assert.match(note.title, /Supp\. FOB ÷ \(1 − royalty\)/);
  assert.equal(load('en').yd({ ydRoyaltyPct: 15 }, false).title.startsWith('License cost added to the base price'), true);
  assert.equal(fn.yd({ trRoyaltyPct: 12 }, true), null, 'TR alanları yurt dışı notu üretmez');
  assert.equal(fn.yd({}, true), null);
  assert.match(APP, /license:fob!=null\?shipOverseasLicenseNote\(row,tr\):null/);
});

test('not Domestic kartında FOB satırının solunda render edilir', () => {
  assert.match(APP, /license:trUnit!=null\?shipDomesticLicenseNote\(row,tr\):null/);
  const i = APP.indexOf('data-ship-license');
  const j = APP.indexOf("${escapeHtml(option.sub||'')}");
  assert.ok(i > 0 && j > i, 'lisans notu FOB satırından önce gelmeli');
});
