const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public/app.css'), 'utf8');

test('resizable headers show a short visible divider while preserving the wide drag target', () => {
  assert.match(css, /\.colResizer\{[^}]*width:7px[^}]*cursor:col-resize/);
  assert.match(css, /\.colResizer::after\{[^}]*top:28%[^}]*bottom:28%[^}]*width:1px[^}]*background:color-mix\(in srgb,var\(--thead-ink\) 28%,transparent\)[^}]*opacity:\.68/);
  assert.match(css, /\.colResizer:hover::after\{[^}]*background:var\(--acc\)[^}]*opacity:1/);
  assert.match(css, /\.quotationColResize::after\{[^}]*top:28%[^}]*bottom:28%[^}]*background:color-mix\(in srgb,var\(--thead-ink\) 28%,transparent\)/);
});
