const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('Collection freeze sticky fix is served with a fresh stylesheet revision',()=>{
  const html=read('public/index.html');
  assert.match(html,/table-freeze\.css\?v=__BL_ASSET_VERSION__&rev=\d+/,'freeze picker styles must be cache-busted');
  assert.match(html,/table-freeze\.js\?v=__BL_ASSET_VERSION__&rev=\d+/,'freeze engine must be cache-busted');
  assert.ok(html.indexOf('table-freeze.js')<html.indexOf('app-main.js?'),'engine loads before app-main');
});
