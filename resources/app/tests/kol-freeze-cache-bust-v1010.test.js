const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('Collection freeze sticky fix is served with a fresh stylesheet revision',()=>{
  const html=read('public/index.html');
  const css=require('./helpers/manifest-css')();
  const cssRef=html.match(/app\.css\?v=[^&]+&rev=(\d+)/);
  assert.ok(cssRef,'app.css must have an explicit cache-busting revision');
  assert.ok(Number(cssRef[1])>=7172,'Collection freeze CSS changes require a new app.css revision');
  assert.match(css,/#kolTable tbody td\.editTd\.frzL\{z-index:var\(--ui-z-raised\)/);
  assert.match(css,/#kolTable tbody td\.editTd\.frzL[\s\S]*position:sticky/);
});
