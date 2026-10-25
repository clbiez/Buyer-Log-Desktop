const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('v6.10 CP and Orders render PLM ID as plain text and Model Name as the bridge', () => {
  assert.match(APP, /case 'plm': return `<td class="num">\$\{escapeHtml\(fmtOC\(v\)\)\}<\/td>`/);
  assert.match(APP, /case 'modelLink': return `<td class="plmModelLinkCell"/);
  assert.match(APP, /plmModelLinkHtml\(v,\{plmId:r\['PLM ID'\]\}\)/);
  assert.doesNotMatch(APP, /function plmLinkHtml/);
});

test('Collection PLM ID editable kalır; hücre içi PLM ikonu yerine context-menu bridge kullanılır', () => {
  const plmBlock = APP.slice(APP.indexOf("}else if(c.k==='plmId'){"), APP.indexOf("}else if(c.k==='modelKod'){"));
  const modelStart = APP.indexOf("}else if(c.k==='modelKod'){");
  const modelBlock = APP.slice(modelStart, APP.indexOf("}else if(c.suggest){", modelStart));
  assert.match(plmBlock, /plmEditInput/);
  assert.doesNotMatch(plmBlock, /plmBridge|plmModelLinkHtml|<a\b/);
  assert.doesNotMatch(modelBlock, /plmModelLinkHtml|<a\b/);
  assert.match(APP, /function kolCollectionPlmUrl\(row\)/);
  assert.match(APP, /BLPlmModelLinks\?\.url\?\.\(row\?\.modelKod,row\?\.plmId,\{allowNameMatch:Boolean\(norm\(row\?\.specialCode\)\)\}\)/);
  assert.match(APP, /canOpenPlm:row=>Boolean\(kolCollectionPlmUrl\(row\)\)/);
  assert.match(APP, /openPlm:row=>\{const url=kolCollectionPlmUrl\(row\);if\(url\)window\.open\(url,'_blank','noopener,noreferrer'\)/);
  assert.match(CSS, /\.plmEditInput\{[^}]*color:inherit/);
});
