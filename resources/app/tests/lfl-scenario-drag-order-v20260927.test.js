const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.css'), 'utf8');

function loadReorderHelper() {
  const start = LFL.indexOf('function reorderComparisonScenarios');
  const end = LFL.indexOf('function commitComparisonScenarioOrderFromDom', start);
  assert.ok(start >= 0 && end > start, 'reorder helper source should exist');
  return vm.runInNewContext('(' + LFL.slice(start, end).trim() + ')');
}

test('saved LFL comparison cards expose a draggable title area and drop wiring', () => {
  assert.match(LFL, /class="lflScenarioCardDrag" draggable="true" data-scenario-drag=/);
  assert.match(LFL, /host\.ondragover=event=>/);
  assert.match(LFL, /host\.ondrop=event=>/);
  assert.match(LFL, /commitComparisonScenarioOrderFromDom\(a\)/);
  assert.match(CSS, /\.lflScenarioCardDrag\{[^}]*cursor:grab/);
  const shared=fs.readFileSync(path.join(ROOT,'public','ui-components.css'),'utf8');
  assert.match(shared,/\.lflScenarioCard\.isDragTarget\{[^}]*outline:2px solid var\(--ui-accent\)/);
});

test('scenario reorder follows DOM ids without dropping unknown or omitted saved scenarios', () => {
  const reorder = loadReorderHelper();
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  const result = reorder([a, b, c], ['c', 'a', 'missing']);
  assert.deepEqual(Array.from(result, item => item.id), ['c', 'a', 'b']);
});

test('committing a dragged order persists the reordered scenarios through existing storage', () => {
  assert.match(LFL, /const ids=\[\.\.\.host\.querySelectorAll\('\.lflScenarioCard\[data-scenario-id\]'\)\]/);
  assert.match(LFL, /state\.customCompare\.scenarios=next;state\.customCompare\.scenariosSeeded=true;/);
  assert.match(LFL, /saveCustomCompare\(\);lflScenarioCache\.clear\(\);renderCustomCompare/);
});
