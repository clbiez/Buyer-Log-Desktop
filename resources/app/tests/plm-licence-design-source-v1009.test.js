'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/app-main.js');
const index = read('public/index.html');
const connectorSource = read('server/lib/agent-browser-connector.js');
const connector = require('../server/lib/agent-browser-connector');
const licenceUtilsPath = path.join(root, 'public/plm-licence-utils.js');
const licenceUtils = fs.existsSync(licenceUtilsPath) ? require(licenceUtilsPath) : null;

test('yalnız PLM Design Source değeri Licence ise lisanslı kabul edilir', () => {
  assert.ok(licenceUtils, 'Licence Design Source helper henüz uygulanmadı.');
  assert.equal(licenceUtils.isLicenceDesignSource('Licence'), true);
  assert.equal(licenceUtils.isLicenceDesignSource('  LICENCE  '), true);
  assert.equal(licenceUtils.isLicenceDesignSource('All My Own Design'), false);
  assert.equal(licenceUtils.isLicenceDesignSource(''), false);
});

test('Design Source PLM alanı doğrudan aktarım ve Excel eşlemesine taşınır', () => {
  assert.match(connectorSource, /designSourceName/);
  assert.match(app, /Design Source/);
  assert.match(app, /designSourceRaw/);
  assert.match(index, /plm-licence-utils\.js/);
});

test('CoreNectum Design Source değeri ham PLM kaydından korunur', () => {
  const rows = connector.coreNectumStyleListRows({ data: { coreNectumResultData: { styleListResult: [{
    styleId: 300, plmCode: 200, styleName: 'MODEL-A', specialCode: 'S7X', designSourceName: 'All My Own Design',
  }] } } });
  assert.equal(rows[0].designSourceRaw, 'All My Own Design');
});

test('lisans adayı yalnız Licence Design Source için model adından üretilir', () => {
  const start = app.indexOf('function kolPlmIsLicensedDesignSource');
  const end = app.indexOf('function kolPlmNormalizeDirectRecord', start);
  assert.ok(start >= 0 && end > start);
  const gate = app.slice(start, end);
  assert.match(gate, /isLicenceDesignSource/);
  assert.match(gate, /brandToken/);
  assert.match(gate, /designSourceRaw/);
});
