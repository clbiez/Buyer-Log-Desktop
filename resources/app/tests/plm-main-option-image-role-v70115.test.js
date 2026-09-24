'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const jobs = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-job-store.js'), 'utf8');
const ingest = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-sync-service.js'), 'utf8');

test('collection parent/single ve variant rolleri PLM görsel isteğine taşınır', () => {
  assert.match(app, /modelGroupRole:row&&row\.modelGroupRole/);
  assert.match(app, /groupRole==='parent'\|\|groupRole==='single'\?'main':groupRole==='variant'\?'option':'auto'/);
  assert.match(app, /next=\{plmId,styleName,colourCode,colour,imageRole\}/);
});

test('imageRole server ve checkpoint\/ingest katmanlarında kaybolmaz', () => {
  assert.match(server, /imageRole:coreNectumStyleApi\.normalizeImageRole\(item&&item\.imageRole\)/);
  assert.match(jobs, /imageRole: \['main', 'option'\]\.includes/);
  assert.match(ingest, /imageRole: \['main', 'option'\]\.includes/);
  assert.match(sync, /imageRole: item\.imageRole/);
});
