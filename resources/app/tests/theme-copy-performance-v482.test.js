'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function bodyOf(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const open = HTML.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(open + 1, i);
  }
  throw new Error(`Unable to parse ${name}`);
}

test('v4.82 theme changes suspend the active heavy view while the palette is swapped', () => {
  const apply = bodyOf('applyTheme');
  const begin = bodyOf('beginFastThemeSwitch');
  assert.match(apply, /beginFastThemeSwitch\(\)/);
  assert.match(apply, /root\.dataset\.theme = resolved/);
  assert.match(begin, /root\.classList\.add\('blThemeSwitching'\)/);
  assert.match(begin, /requestAnimationFrame\(\(\)=>requestAnimationFrame\(finish\)\)/);
  assert.match(CSS, /html\.blThemeSwitching main section\.active\{content-visibility:hidden/);
  assert.match(CSS, /#_fastThemeCurtain\{position:fixed;inset:0/);
});

test('v4.82 table copy no longer switches theme or rerenders the source table', () => {
  const copy = bodyOf('copyStyledTableLikeExcel');
  const collectionCopy = bodyOf('copyKolSelectedRows');
  assert.doesNotMatch(copy, /dataset\.theme|rerender\s*\(/);
  assert.match(copy, /buildStyledCopyFromDom/);
  assert.doesNotMatch(collectionCopy, /dataset\.theme|renderKol\s*\(/);
  assert.match(collectionCopy, /buildStyledCopyFromDom\('#kolTable'/);
});

test('v4.82 copy reuses styles, parallelizes image cells and avoids finishing unrelated rows', () => {
  const build = bodyOf('buildStyledCopyFromDom');
  const ensure = bodyOf('_copyEnsureRequiredRowsRendered');
  assert.match(build, /const styleCache=new Map\(\),imageCache=new Map\(\)/);
  assert.match(build, /Promise\.all\(cells\.map\(td=>_copyCellFromTd\(td,styleCache,imageCache(?:,imageDimensionCache)?\)\)\)/);
  assert.match(ensure, /if\(!selSet\|\|!selSet\.size\)\{flushPendingTableRenders\(\);return;\}/);
  assert.match(ensure, /if\(found<wanted\.size\)flushPendingTableRenders\(\)/);
});
