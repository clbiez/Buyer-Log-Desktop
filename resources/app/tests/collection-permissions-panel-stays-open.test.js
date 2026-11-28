'use strict';
// Görünüm ve Yetkiler paneli seçimden sonra açık kalır (kullanıcı bulgusu: "her
// seçimde kapanıyor, tekrar açmak gerekiyor"). Kök neden: her değişiklik
// <details> kabuğunu innerHTML ile yeniden üretiyordu. Ayrıca panel açık kaldığı
// için art arda yapılan seçimler kaybolmamalı ve sırayla uygulanmalıdır.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const APP = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../public/collection-analytics.css'), 'utf8');
const block = (from, to) => { const a = APP.indexOf(from), b = APP.indexOf(to, a); assert.ok(a > 0 && b > a, from); return APP.slice(a, b); };

function harness() {
  const src = block('let kolScopeDesiredOwnerIds=null', 'function kolPlaceScopePanel(');
  const calls = [], toasts = [], gates = [];
  const ctx = {
    kolWorkspaceSelectedOwnerIds: new Set(['me']), renders: 0,
    showToast: msg => toasts.push(msg),
    renderKolScopeFilters: () => { ctx.renders += 1; },
    kolSaveWorkspaceNow: async () => { calls.push('save'); },
    kolLoadWorkspaceBatch: ids => { calls.push(ids.slice().sort().join(',')); return new Promise((resolve, reject) => gates.push({ ids, resolve: () => { ctx.kolWorkspaceSelectedOwnerIds = new Set(ids); resolve(); }, reject })); },
  };
  vm.createContext(ctx);
  vm.runInContext(src + ';this.apply=kolApplyScopeSelection;this.want=ids=>{kolScopeDesiredOwnerIds=new Set(ids);};this.desired=()=>kolScopeDesiredOwnerIds;', ctx);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return { ctx, calls, toasts, gates, tick };
}

test('render keeps the <details> shell and only refreshes panel content', () => {
  const render = block('function renderKolScopeFilters(){', "root.querySelectorAll('[data-owner-id]')");
  assert.match(render, /let details=root\.querySelector\(':scope>details\.kolScopeWorkspace'\)/);
  assert.match(render, /if\(!details\)\{\s*root\.innerHTML=`<details class="kolScopeDim kolScopeWorkspace/);
  assert.match(render, /panel\.innerHTML=/);
  // Kabuk var iken root.innerHTML yalnız ortak (paylaşımlı) modda yazılır.
  assert.equal((render.match(/root\.innerHTML=/g) || []).length, 2);
  assert.doesNotMatch(render, /<details[^`]*\$\{[^}]*open/, 'open state is never re-derived from markup');
});

test('panel UI state (scroll, picker, search, focus) survives a re-render', () => {
  const render = block('function renderKolScopeFilters(){', 'kolPlaceScopePanel(details);\n}');
  assert.match(render, /data-perm-list="view"/);
  assert.match(render, /const pickerOpen=/);
  assert.match(render, /const query=/);
  assert.match(render, /const focusKey=/);
  assert.match(render, /scroll\.forEach/);
});

test('outside-click close ignores clicks on panel controls detached by a re-render', () => {
  const bind = block('function bindKolScopeOutsideClick(){', 'function renderKolScopeFilters(){');
  assert.match(bind, /composedPath\(\)/);
  assert.match(bind, /!path\.includes\(bar\)/);
  assert.match(bind, /event\.key!=='Escape'/);
});

test('rapid selections are kept and applied in order; the latest set wins', async () => {
  const { ctx, calls, gates, tick } = harness();
  ctx.want(['me', 'a']);
  const run = ctx.apply();
  await tick();
  assert.deepEqual(calls, ['save', 'a,me']);
  // Kullanıcı ilk yükleme sürerken iki seçim daha yapar.
  ctx.want(['me', 'a', 'b']); void ctx.apply();
  ctx.want(['me', 'a', 'b', 'c']); void ctx.apply();
  gates.shift().resolve(); await tick();
  assert.deepEqual(calls, ['save', 'a,me', 'save', 'a,b,c,me'], 'intermediate set is skipped, latest set is loaded');
  gates.shift().resolve(); await run;
  assert.equal(ctx.desired(), null);
  assert.deepEqual([...ctx.kolWorkspaceSelectedOwnerIds].sort(), ['a', 'b', 'c', 'me']);
  assert.ok(ctx.renders >= 1, 'final render reflects the applied selection');
});

test('an unchanged or unloadable selection does not loop', async () => {
  const { ctx, calls } = harness();
  ctx.want(['me']);
  await ctx.apply();
  assert.deepEqual(calls, [], 'same set as applied: no save/load');
});

test('a failed load clears the pending selection and re-renders the real state', async () => {
  const { ctx, toasts, gates, tick } = harness();
  ctx.want(['me', 'x']);
  const run = ctx.apply();
  await tick();
  gates.shift().reject(new Error('denied'));
  await run;
  assert.deepEqual(toasts, ['denied']);
  assert.equal(ctx.desired(), null);
  assert.deepEqual([...ctx.kolWorkspaceSelectedOwnerIds], ['me']);
  assert.equal(ctx.renders, 1);
});

test('granted and received lists sit side by side and stack on narrow screens', () => {
  assert.match(CSS, /\.kolScopePanel\.kolPermPanel\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(CSS, /@media\(max-width:700px\)\{\s*\.kolScopePanel\.kolPermPanel\{grid-template-columns:minmax\(0,1fr\)/);
  const render = block('function renderKolScopeFilters(){', 'kolPlaceScopePanel(details);\n}');
  assert.match(render, /aria-label="\$\{t\('remove'\)\}: \$\{name\}"/, 'icon-only remove keeps a translated accessible name');
});
