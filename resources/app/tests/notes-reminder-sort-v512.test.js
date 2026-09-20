'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v5.12 Notes Reminder has a date sort toggle with oldest-to-newest default',()=>{
  assert.match(INDEX,/id="ovNotesSortBtn"/);
  assert.match(INDEX,/Eski → Yeni/);
  assert.match(APP,/let overviewNotesSortDirection='asc'/);
  assert.match(APP,/overviewNotesSortDirection=overviewNotesSortDirection==='asc'\?'desc':'asc'/);
  assert.match(APP,/asc\?'Old → New':'New → Old'/);
});

test('v5.12 Notes Reminder groups are sorted by registration date and undated legacy notes stay last',()=>{
  assert.match(APP,/if\(aHasDate!==bHasDate\)return aHasDate\?-1:1/);
  assert.match(APP,/overviewNotesSortDirection==='desc'\?b\.noteTimestamp-a\.noteTimestamp:a\.noteTimestamp-b\.noteTimestamp/);
  assert.match(APP,/updateOverviewNotesSortButton\(\);[\s\S]*?renderOverview\(\)/);
});

test('v5.12 Notes Reminder sort control is compact and responsive',()=>{
  assert.match(CSS,/\.ovNotesSortBtn\{/);
  assert.match(CSS,/\.ovPriorityHeaderActions\{/);
  assert.match(CSS,/@media\(max-width:700px\)\{\.ovPriorityHeader\{flex-direction:column;\}\.ovPriorityHeaderActions,\.ovPriorityStats\{justify-content:flex-start;\}/);
});
