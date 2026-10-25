'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const CSS=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','overview-home.css'] );

test('v7.75 Overview düzen çubuğu tek hizalı denetim grubudur',()=>{
  assert.match(CSS,/\.ovDashboardToolbar\{[^}]*align-items:center/);
  assert.match(CSS,/#ovLayoutEditBtn\.active\{[^}]*background:var\(--ui-selected\)/);
  assert.match(CSS,/\.ovLayoutEditPanel\{[^}]*min-height:var\(--ui-control-height\)/);
  assert.match(CSS,/\.ovLayoutEditPanel\[hidden\]\{\s*display:none!important;?\}/);
  assert.match(CSS,/\.ovLayoutEditPanel \.tbtn\{[^}]*height:var\(--ui-control-height\)/);
});
