'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('v6.33 License Royalty Calculations stores rules by Licensor again', () => {
  assert.match(DB, /current\.licensor = String\(current\.licensor != null \? current\.licensor : \(current\.manufacturer \|\| ''\)\)\.trim\(\);/);
  assert.match(DB, /delete current\.manufacturer;/);
  assert.match(SERVER, /licensor: String\(r\.licensor != null \? r\.licensor : \(r\.manufacturer \|\| ''\)\)\.trim\(\)/);
  assert.doesNotMatch(SERVER, /manufacturer: String\(r\.manufacturer != null \? r\.manufacturer : \(r\.licensor \|\| ''\)\)\.trim\(\)/);
});

test('v6.33 rule matching uses CP and Collection Licensor, not Manufacturer', () => {
  assert.match(APP, /return !!row&&pricingRuleMatchesValues\(rule,row\.OPD,row\.Country,row\.Season,row\.Licensor,row\.License\);/);
  assert.match(APP, /calculateSuppFobFromRule\(row\['FOB \(\$\)'\],row\.OPD,row\.Country,row\.Season,row\.Licensor,row\.License\)/);
  assert.match(APP, /licensor: norm\(row&&row\.licensor\) \|\| norm\(cp&&cp\.Licensor\)/);
  assert.match(APP, /turknorm\(ctx\.licensor\)===turknorm\(rule&&rule\.licensor\)/);
});

test('v6.33 royalty UI labels the dimension as Licensor', () => {
  assert.match(APP, /data-sort="licensor"><span>Licensor<\/span>/);
  assert.match(APP, /data-filter="licensor" type="search" placeholder="Licensor"/);
  assert.match(APP, /<label>Licensor<\/label><input id="_ruleLicensor"/);
  /* v7.81: açıklama eski menü düğmesinin title'ındaydı (yalnız fareyle
     üzerine gelince okunuyordu); artık Veri Yönetimi araç satırında GÖRÜNÜR. */
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /Licensor ve License bazlı royalty/);
  assert.doesNotMatch(APP.slice(APP.indexOf('function openSuppFobRulesModal'), APP.indexOf("document.getElementById('licenseRoyaltyRulesBtn')")), /Manufacturer \+ License|Manufacturer ve License|data-sort="manufacturer"|data-filter="manufacturer"/);
});
