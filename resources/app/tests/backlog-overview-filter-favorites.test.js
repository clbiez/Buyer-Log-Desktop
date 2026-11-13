'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const OVERVIEW=fs.readFileSync(path.join(ROOT,'public','backlog-overview.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','backlog-overview.css'),'utf8');
const STORAGE=fs.readFileSync(path.join(ROOT,'public','user-storage.js'),'utf8');

test('favourite filter sets are stored per user under the overview prefix',()=>{
  const key=OVERVIEW.match(/const FAVORITES_KEY='([^']+)'/);
  assert.ok(key,'favourites key missing');
  assert.ok(key[1].startsWith('lcw.backlog.overview.'),'key must stay under the per-user overview prefix');
  assert.match(STORAGE,/'lcw\.backlog\.overview\.'/);
  assert.match(OVERVIEW,/\(window\.BLStorage\|\|localStorage\)\.setItem\(FAVORITES_KEY/);
});

test('favourites save only filters with criteria and reuse the shared normaliser',()=>{
  assert.match(OVERVIEW,/function normalizeFilters\(list\)/);
  assert.match(OVERVIEW,/merged\.filters=normalizeFilters\(raw\.filters\)/);
  assert.match(OVERVIEW,/const filters=normalizeFilters\(overviewFilters\(\)\)\.filter\(filterHasCriteria\)/);
});

test('applying a favourite replaces active filters and refreshes every Backlog consumer',()=>{
  const body=OVERVIEW.slice(OVERVIEW.indexOf('function applyFavorite('),OVERVIEW.indexOf('function deleteFavorite('));
  assert.match(body,/state\.filters=normalizeFilters\(fav\.filters\)/);
  assert.match(body,/reapplyOverviewFilters\(\)/);
});

test('favourite bar is rendered in the filter drawer and wired to events',()=>{
  assert.match(OVERVIEW,/\$\{renderFavoriteBar\(\)\}/);
  for(const attr of ['data-blvf-fav-apply','data-blvf-fav-delete','data-blvf-fav-new','data-blvf-fav-cancel','data-blvf-fav-form','data-blvf-fav-name']){
    assert.ok(OVERVIEW.split(attr).length>=3,`${attr} must be rendered and handled`);
  }
  assert.match(OVERVIEW,/addEventListener\('submit'/);
  assert.match(CSS,/\.blvFilterFavs\{/);
});

test('favourite UI strings are bilingual and destructive actions ask first',()=>{
  for(const pair of [["'Favoriler','Favourites'"],["'Favori olarak kaydet','Save as favourite'"],["'Favoriyi sil','Delete favourite'"]])
    assert.ok(OVERVIEW.includes(pair[0]),pair[0]);
  const del=OVERVIEW.slice(OVERVIEW.indexOf('function deleteFavorite('),OVERVIEW.indexOf('function favoriteTitle('));
  assert.match(del,/window\.confirm\(/);
  assert.doesNotMatch(OVERVIEW,/window\.prompt\(/,'Electron does not support prompt()');
});

test('favourite styles use UI tokens only',()=>{
  const block=CSS.slice(CSS.indexOf('.blvFilterFavs{'),CSS.indexOf('.blvFilterActive{'));
  assert.doesNotMatch(block,/#[0-9a-f]{3,6}\b|rgba?\(/i);
});
