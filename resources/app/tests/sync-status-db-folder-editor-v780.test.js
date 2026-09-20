'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');

test('v7.80 Sync Status kanonik yolları salt okunur gösterir',()=>{
  assert.match(APP,/q\.localDbPath/);
  assert.match(APP,/q\.sharedSyncRoot/);
  assert.doesNotMatch(APP,/addEditableSyncDbFolder|data-db-folder|data-db-save/);
  assert.doesNotMatch(APP,/DB klasör yolu|DB folder path/);
  assert.doesNotMatch(APP,/document\.addEventListener\('click',event=>\{if\(event\.target\.closest\('#syncStatusBtn'\)\)/);
});
