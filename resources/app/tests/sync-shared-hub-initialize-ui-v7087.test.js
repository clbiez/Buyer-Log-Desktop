'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');

test('Sync & Local Data offers Shared Hub initialization only to moderators after identity-missing response',()=>{
  const start=APP.indexOf('async function openSyncLocalDataModal');
  const block=APP.slice(start,start+14000);
  assert.match(block,/BLIsModerator/);
  assert.match(block,/data-init-hub/);
  assert.match(block,/SHARED_HUB_NOT_INITIALIZED/);
  assert.match(block,/\/api\/shared-hub\/initialize/);
  assert.match(block,/confirmCritical:true/);
});

test('Shared Hub initialization remains moderator-only, explicit-confirmation, and empty-folder safe on server',()=>{
  const start=SERVER.indexOf("app.post('/api/shared-hub/initialize'");
  const block=SERVER.slice(start,start+2200);
  assert.match(block,/userAccess\.requireModerator/);
  assert.match(block,/confirmCritical !== true/);
  assert.match(block,/allowNonEmpty:false/);
});
