'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const OVERVIEW=fs.readFileSync(path.join(ROOT,'public','backlog-overview.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','backlog-overview.css'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('Backlog Overview filter script remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(OVERVIEW));
});

test('filter button is immediately before refresh in Backlog Overview header',()=>{
  const filter=INDEX.indexOf('id="backlogOverviewFilter"');
  const refresh=INDEX.indexOf('id="backlogOverviewRefresh"');
  assert.ok(filter>-1,'filter button missing');
  assert.ok(refresh>filter,'filter button must be left of refresh');
  assert.match(INDEX,/id="backlogOverviewFilterCount"/);
});

test('overview filter catalogue exposes CP, ASAS and IAS sources',()=>{
  assert.match(OVERVIEW,/fetch\('\/api\/backlog-source-columns'/);
  assert.match(OVERVIEW,/\['cp','asas','antrepo'\]/);
  assert.match(OVERVIEW,/source==='antrepo'\?'IAS'/);
  assert.match(OVERVIEW,/defaultHeaders/);
});

test('selected raw source fields are lazily requested from backlog export',()=>{
  assert.match(OVERVIEW,/function filterSourceColumnIds\(\)/);
  assert.match(OVERVIEW,/params\.sourceColumns=/);
  assert.match(OVERVIEW,/const params=overviewQueryParams\(\)/);
});

test('overview filters support date ranges and multi-value filters locally',()=>{
  assert.match(OVERVIEW,/data-blvf-from/);
  assert.match(OVERVIEW,/data-blvf-to/);
  assert.match(OVERVIEW,/data-blvf-value/);
  assert.match(OVERVIEW,/function applyOverviewFilters\(rows\)/);
  assert.match(OVERVIEW,/items=applyOverviewFilters\(baseItems/);
});

test('filter drawer styling exists',()=>{
  assert.match(CSS,/\.blvFilterRoot/);
  assert.match(CSS,/\.blvFilterDrawer/);
  assert.match(CSS,/\.blvFilterSourceTabs/);
  assert.match(CSS,/\.blvFilterDateGrid/);
});
