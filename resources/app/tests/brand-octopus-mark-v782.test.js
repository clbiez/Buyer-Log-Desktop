'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(root,'public','app.css'),'utf8');

test('sol üst Buyer Log işareti eski BL metinli görünümü kullanır ve ahtapot görselini saklar',()=>{
  assert.match(INDEX,/class="brandMark"[^>]*>\s*BL\s*</);
  assert.doesNotMatch(INDEX,/class="brandMark"[^>]*>[\s\S]*class="brandLogoImage"/);
  assert.match(CSS,/\.brandLogoImage\{[^}]*width:34px[^}]*height:34px/);
  assert.ok(fs.existsSync(path.join(root,'public','icons','buyer-log-logo.png')));
});
