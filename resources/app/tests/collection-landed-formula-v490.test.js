'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8'));

test('v4.90 Collection landed formulas follow the approved DTR and Non-DTR rules', () => {
  assert.match(INDEX, /YD Landed = FOB × YD landed çarpanı/);
  assert.match(INDEX, /YD Landed = \(\(FOB ÷ \(1 − Royalty%\)\) \+ Hologram Cost\) × YD landed çarpanı/);
  assert.match(INDEX, /TR Landed = \(\(\(TR Fiyat \(TL\) ÷ Kur\) ÷ \(1 − Royalty%\)\) \+ Hologram Cost\) × TR landed çarpanı/);
  assert.match(INDEX, /const denom=1-royalty/);
  assert.match(INDEX, /if\(denom<=0\)return null/);
  assert.match(INDEX, /return base\/denom\+hologram/);
});
