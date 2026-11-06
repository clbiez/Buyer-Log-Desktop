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

test('user menu and topbar initials share one appearance rule',()=>{
 const css=read('ui-components.css');
 const outer=css.match(/html\[data-ui-system="manifest"\] \.userMenu \.userMenuHead \.userMenuAvatar\s*\{([^}]+)\}/);
 const shared=css.match(/html\[data-ui-system="manifest"\] #currentUserBtn #currentUserInitials,\s*html\[data-ui-system="manifest"\] \.userMenu \.userMenuHead \.userMenuAvatar \.blSteelInitials\s*\{([^}]+)\}/);
 assert.ok(outer,'menu avatar container uses the shared 34px dimensions');
 assert.ok(shared,'menu and topbar initials share one 30px surface');
 for(const rule of [/width:34px/,/height:34px/,/background:transparent!important/])assert.match(outer[1],rule);
 for(const rule of [/width:30px/,/height:30px/,/background:var\(--ui-mark-paper\)!important/,/color:var\(--ui-avatar-ink\)!important/,/font-size:var\(--ui-font-sm\)!important/])assert.match(shared[1],rule);
 const ui=read('user-access-ui.js');
 assert.match(ui,/class="userMenuAvatar"><span class="blSteelInitials">/);
});
