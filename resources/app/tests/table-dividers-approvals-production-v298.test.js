const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const css = require('./helpers/manifest-css')();

test('group boundaries remain visible; resizers keep their full drag target without a body grid',()=>{
 assert.match(css,/\.colResizer\{[^}]*width:7px[^}]*cursor:col-resize/);
 assert.match(css,/\.quotationColResize\{[^}]*cursor:col-resize/);
 for(const id of ['cpTable','ordersTable','kolTable']){const base='#'+id+' thead :is(.groupRow th.groupDivider,.colRow th.groupBoundary)'; const exact=['.groupDivider','.groupBoundary'].map(key=>base+':where('+key+')').join(',');assert.ok(css.includes(exact+'{border-inline-start:1px solid var(--ui-group-divider)'));}
 assert.match(css,/\[data-ui-migrated\] \.colResizer::after\{background:transparent!important/);
});
