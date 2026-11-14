'use strict';

/* Çizgi arayüz stili (data-ui-style="line") sözleşmesi.
   Klasik stil varsayılan kalır; Çizgi yalnız kullanıcı Görünüm › Stil ile seçtiğinde
   açılır, seçim cihazda saklanır ve ilk karede uygulanır. Görünüm token'larla gelir;
   Motion+ çizgi çerçevesi yalnız bu stilde eklenir ve iz bırakmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

function block(source, selector) {
  const start = source.indexOf(selector + '{');
  assert.ok(start >= 0, selector + ' block is missing');
  return source.slice(start, source.indexOf('}', start));
}

test('Line style defines complete light and dark token sets without touching the classic palette', () => {
  const tokens = read('ui-tokens.css');
  const light = block(tokens, ':root[data-ui-style="line"]');
  const dark = block(tokens, ':root[data-ui-style="line"][data-theme="dark"]');
  for (const name of ['--ui-canvas', '--ui-surface', '--ui-text', '--ui-text-muted', '--ui-accent', '--ui-on-accent', '--ui-selected',
    '--ui-danger', '--ui-row-divider', '--ui-group-divider', '--ui-field-border', '--ui-header-bg', '--ui-line-ink', '--ui-line-mark']) {
    assert.match(light, new RegExp(name + ':'), 'light ' + name);
    assert.match(dark, new RegExp(name + ':'), 'dark ' + name);
  }
  assert.match(light, /--ui-font-body:"BL Schibsted Grotesk"/);
  assert.match(light, /--ui-font-mono:"BL JetBrains Mono"/);
  assert.match(light, /color-scheme:light/);
  assert.match(dark, /color-scheme:dark/);
  // Geometry stays with the four interface sizes; the style changes appearance only.
  for (const geometry of ['--ui-table-row-height', '--ui-control-height', '--ui-rail-width', '--ui-topbar-height', '--ui-radius:']) {
    assert.doesNotMatch(light + dark, new RegExp(geometry), geometry + ' belongs to the size presets');
  }
  // Classic palette is unchanged and the shared line tokens have a classic fallback.
  assert.match(tokens, /--ui-canvas:#f5f7f9;--ui-rail:#f0f3f6;--ui-surface:#fff;/);
  assert.match(tokens, /--ui-accent:#356a96;/);
  assert.match(tokens, /--ui-line-ink:var\(--ui-text\);--ui-line-mark:var\(--ui-danger\);/);
});

test('Line fonts are packaged locally with Latin-ext, OFL notices and catalog entries', () => {
  const tokens = read('ui-tokens.css');
  const families = { 'schibsted-grotesk': [400, 500, 600, 700], 'jetbrains-mono': [400, 600] };
  for (const [file, weights] of Object.entries(families)) {
    for (const weight of weights) for (const subset of ['latin', 'latin-ext']) {
      const name = `vendor/fonts/${file}-${weight}-${subset}.woff2`;
      assert.ok(fs.existsSync(path.join(PUBLIC, name)), name);
      assert.ok(tokens.includes(`url("${name}")`), name + ' font-face');
    }
  }
  for (const notice of ['SchibstedGrotesk-OFL.txt', 'JetBrainsMono-OFL.txt']) {
    assert.match(fs.readFileSync(path.join(PUBLIC, 'vendor/fonts', notice), 'utf8'), /SIL Open Font License/);
  }
  assert.doesNotMatch(tokens, /fonts\.(?:googleapis|gstatic)\.com/, 'no network fonts');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dependency-catalog.json'), 'utf8'));
  const group = catalog.groups.find(entry => entry.id === 'line-style-fonts');
  assert.ok(group && group.license === 'OFL-1.1');
});

test('Appearance menu offers the interface style in TR/EN; the choice persists and applies before first paint', () => {
  const html = read('index.html');
  const menu = html.slice(html.indexOf('id="railAppearanceMenu"'), html.indexOf('</aside>'));
  assert.match(menu, /<button type="button" id="railUiStyleBtn" aria-pressed="false"[^>]*data-i18n-title-tr="Arayüz stili: Klasik ↔ Çizgi" data-i18n-title-en="Interface style: Classic ↔ Line"/);
  assert.ok(menu.indexOf('id="railFontSizeBtn"') < menu.indexOf('id="railUiStyleBtn"'));
  assert.ok(menu.indexOf('id="railUiStyleBtn"') < menu.indexOf('id="railThemeFxToggle"'));
  // Boot script reads the stored choice; anything but "line" keeps the classic default.
  assert.match(html, /if\(BLStorage\.getItem\('lcw_ui_style'\)==='line'\)document\.documentElement\.dataset\.uiStyle='line';/);

  const app = read('app-main.js');
  assert.match(app, /const UI_STYLES=\{classic:\{tr:'Klasik',en:'Classic'\},line:\{tr:'Çizgi',en:'Line'\}\};/);
  assert.match(app, /if\(persist\)try\{BLStorage\.setItem\('lcw_ui_style',style\);\}catch\(_\)\{\}/);
  assert.match(app, /if\(style==='line'\)root\.dataset\.uiStyle='line';else delete root\.dataset\.uiStyle;/);
  assert.match(app, /if\(animate&&window\.BLMotionPlus\?\.theme\?\.\(update,origin\)\)return style;/);
  assert.match(app, /label\.textContent=appLang==='en'\?`Style: \$\{preset\.en\}`:`Stil: \$\{preset\.tr\}`/);
  assert.match(app, /if\(typeof syncUiStyleControl==='function'\) syncUiStyleControl\(\);/, 'language change relabels the control');

  const shell = read('ui-appearance.js');
  assert.match(shell, /if\(saved\.style==='line'\)root\.dataset\.uiStyle='line';/);
  // The sign-in cache stays {theme,step} for Classic; only Line adds the cosmetic style field.
  for (const style of ['line', 'classic', '<script>']) {
    const values = new Map([['buyerlog.ui.appearance', JSON.stringify({ theme: 'dark', step: 2, style })]]), writes = [], root = { dataset: {} }, window = {};
    vm.runInNewContext(shell, { document: { documentElement: root }, window, matchMedia: () => ({ matches: false }),
      localStorage: { getItem: k => values.get(k), setItem: (k, v) => writes.push([k, JSON.parse(v)]) } });
    assert.equal(root.dataset.uiStyle, style === 'line' ? 'line' : undefined, style);
    window.BLUIAppearance.remember();
    assert.equal(JSON.stringify(writes), JSON.stringify([['buyerlog.ui.appearance', style === 'line' ? { theme: 'dark', step: 2, style: 'line' } : { theme: 'dark', step: 2 }]]), style);
  }
});

test('Line component rules are scoped to the style and add no frames, shadows or radii', () => {
  const css = read('ui-components.css');
  const start = css.indexOf('/* Çizgi arayüz stili (data-ui-style="line"');
  assert.ok(start > 0);
  const section = css.slice(start);
  const rules = section.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(rule => rule.trim()).filter(Boolean);
  assert.ok(rules.length >= 10);
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf('{'));
    for (const part of selector.split(/,(?![^()]*\))/)) assert.match(part.trim(), /^html\[data-ui-system="manifest"\]\[data-ui-style="line"\]/, part);
    assert.doesNotMatch(rule, /(?:^|[;{\s])(?:border(?:-[\w-]+)?|box-shadow|border-radius|outline)\s*:/, selector);
  }
  assert.match(section, /\.blLineFrame \{position:fixed;overflow:visible;pointer-events:none;z-index:var\(--ui-z-tooltip\)/);
  assert.match(section, /nav\.tabs button\.active > span\[data-i18n-tr\]::after \{content:"";[^}]*background:var\(--ui-line-ink\)/);
});

function motionHarness(style) {
  const created = [], calls = [];
  function element(tag) {
    const el = {
      tag, children: [], attrs: {}, style: {}, dataset: {}, isConnected: true, hidden: false, parentElement: null,
      setAttribute(name, value) { this.attrs[name] = value; },
      appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
      querySelectorAll(selector) { return selector === 'path' ? this.children.filter(c => c.tag === 'path') : []; },
      remove() { this.removed = true; },
      closest() { return null; },
      getBoundingClientRect: () => ({ left: 100, top: 80, right: 400, bottom: 280, width: 300, height: 200 }),
      getAnimations: () => [],
      animate(keyframes, options) {
        const handlers = {};
        const a = { id: '', effect: { target: el }, keyframes, options, addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
          fire(type) { (handlers[type] || []).forEach(fn => fn()); }, cancel() { this.fire('cancel'); } };
        calls.push(a); return a;
      }
    };
    return el;
  }
  const body = element('body');
  const html = { dataset: { blMotion: 'on' } };
  if (style) html.dataset.uiStyle = style;
  const doc = { documentElement: html, body, readyState: 'complete', visibilityState: 'visible',
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    createElementNS(ns, tag) { const el = element(tag); created.push(el); return el; } };
  const root = { document: doc, innerWidth: 1600, innerHeight: 1000, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ transform: 'none', getPropertyValue: () => '' }), addEventListener() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(read('motion-plus.js'), { window: root });
  return { root, body, created, calls, element };
}

test('Motion+ draws an ink frame around opening surfaces only in Line style and leaves no trace', () => {
  const classic = motionHarness();
  classic.root.BLMotionPlus.play('overlay', classic.element('div'));
  assert.equal(classic.created.length, 0, 'classic adds no frame');
  assert.equal(classic.calls.length, 1, 'classic keeps the single entrance');
  assert.equal(classic.calls[0].options.duration, 240);

  const line = motionHarness('line');
  line.root.BLMotionPlus.play('drawer', line.element('div'));
  const svg = line.created.find(el => el.tag === 'svg');
  assert.ok(svg && svg.attrs.class === 'blLineFrame' && svg.attrs['aria-hidden'] === 'true');
  const paths = svg.children.filter(el => el.tag === 'path');
  assert.equal(paths.length, 4, 'four strokes, one per edge');
  assert.ok(paths.every(p => p.attrs.pathLength === '1' && p.attrs['stroke-dasharray'] === '1'));
  const entrance = line.calls.find(a => a.id === 'bl-motion-entrance');
  assert.equal(entrance.keyframes[0].opacity, 0, 'content waits for the drawn frame');
  assert.equal(entrance.keyframes[1].offset, .42);
  assert.ok(Math.abs(entrance.options.duration - 456) < 1);
  const strokes = line.calls.filter(a => paths.includes(a.effect.target));
  assert.equal(strokes.map(a => a.options.delay).join(','), '0,60,120,180', 'edges are drawn one after another');
  // The last stroke fades the frame, then removes it.
  strokes.at(-1).fire('finish');
  const fade = line.calls.find(a => a.effect.target === svg);
  assert.equal(JSON.stringify(fade.keyframes), JSON.stringify([{ opacity: 1 }, { opacity: 0 }]));
  fade.fire('finish');
  assert.equal(svg.removed, true);

  // Cancellation (navigation, hidden tab, motion off) removes an unfinished frame at once.
  const cancelled = motionHarness('line');
  cancelled.root.BLMotionPlus.play('overlay', cancelled.element('div'));
  const frame = cancelled.created.find(el => el.tag === 'svg');
  cancelled.root.BLMotionPlus.setEnabled(false);
  assert.equal(frame.removed, true);
});
