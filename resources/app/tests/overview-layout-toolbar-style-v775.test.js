'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const CSS=fs.readFileSync(path.join(__dirname,'..','public','overview-home.css'),'utf8');

test('v7.75 Overview düzen çubuğu tek hizalı denetim grubudur',()=>{
  assert.match(CSS,/\.ovDashboardToolbar\{[^}]*align-items:center/);
  assert.match(CSS,/#ovLayoutEditBtn\.active\{[^}]*background:var\(--acc-bg\)/);
  assert.match(CSS,/\.ovLayoutEditPanel\{[^}]*min-height:var\(--ctl-h\)/);
  assert.match(CSS,/\.ovLayoutEditPanel\[hidden\]\{\s*display:none!important;?\}/);
  assert.match(CSS,/\.ovLayoutEditPanel \.tbtn\{[^}]*height:var\(--ctl-h\)/);
});
