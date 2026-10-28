'use strict';
// On VDI/RDP Chromium often falls back to software compositing; backdrop blur and
// hundreds of cell animations then run on the CPU. The desktop reports only that
// boolean; the UI swaps blur for a token-derived veil and skips the cell wave.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('main exposes a read-only, sender-checked render profile and logs GPU status', () => {
  const main=read('electron/main.js'),preload=read('electron/preload.js');
  assert.match(main,/ipcMain\.handle\('buyerlog:render-profile', event => \{\s*if \(!trustedBuyerLogIpcSender\(event\)\) return null;\s*return \{ softwareCompositing: softwareCompositing\(\) \};/);
  assert.match(main,/startsWith\('enabled'\)/);
  assert.match(main,/logGpuStatus\('ready'\);/);
  assert.match(preload,/renderProfile: \(\) => ipcRenderer\.invoke\('buyerlog:render-profile'\),/);
});

test('software compositing removes blur and the table wave but keeps page motion', () => {
  const motion=read('public/motion-plus.js'),css=read('public/ui-components.css');
  assert.match(motion,/if\(html\.dataset\.blRender==='software'\)return 0;/);
  assert.match(motion,/if\(profile&&profile\.softwareCompositing===true\)html\.dataset\.blRender='software';/);
  assert.match(css,/html\[data-bl-render="software"\] \.blWorkspaceBlur\[data-blur\]\{backdrop-filter:none;background:color-mix\(in srgb,var\(--ui-text\) 8%,transparent\);\}/);
  const enterPage=motion.slice(motion.indexOf('function enterPage(view){'),motion.indexOf('function activate(force){'));
  assert.doesNotMatch(enterPage,/blRender/);
});
