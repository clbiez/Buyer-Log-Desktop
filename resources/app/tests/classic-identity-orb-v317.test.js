'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
test('all tables override obsolete custom checkboxes with native checks and suppress pseudo checkmarks',()=>{
 const css=read('ui-components.css').slice(read('ui-components.css').indexOf('7.0.294 table semantics'));
 assert.match(css,/:is\(#cpTable,#ordersTable,#kolTable,table\) input\[type="checkbox"\]/);
 assert.match(css,/appearance:auto!important/);assert.match(css,/::after\{content:none!important/);
 assert.match(css,/rowDirty>td:first-child/);
});
test('identity marks share rounded geometry and no outer frame or satin texture',()=>{
 const css=read('ui-components.css').slice(read('ui-components.css').indexOf('No outer frame:'));
 assert.match(css,/border:0!important;background:transparent!important;box-shadow:none!important/);
 assert.match(css,/clip-path:inset\(2px round var\(--ui-mark-radius\)\)/);
 assert.match(css,/#currentUserBtn #currentUserInitials/);assert.match(css,/background:var\(--ui-mark-paper\)!important/);
});
test('startup orb uses its 7.0.294 inline size and placement while retaining readiness lifecycle',()=>{
 assert.match(read('ui-startup.css'),/\.blBootOrb\{display:inline-block;width:64px;height:64px;margin:0 12px 0 0/);
 assert.match(read('ui-startup.css'),/data-ready="1"\] \.blBootOrb/);
 assert.match(read('index.html'),/BLThinkingOrbBreathing\.attach/);
});
