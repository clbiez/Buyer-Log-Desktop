'use strict';

/* v2026-11-04 — HORIZON ÇEKMECESİ + BASİT KİP (kullanıcı kararları).
 *
 *  1) Database filtre düzenleyicisi Backlog Analiz Filtreleri düzenini alır
 *     (kartlar + sütun kataloğu + onay kutulu değer listesi); Gelişmiş kip kalır.
 *  2) ASAS→IAS otomatik öneri, eşleme ve hatırlama AYNI yoldan geçer.
 *  3) Tek yer Veri Yönetimi; CP / Diğer modüller / INTAKE ayrı sekmeler.
 *  4) Yalnız Kaydet; değer adedi yok.
 *
 * Basit kip davranışı gerçek public/data-management-filter.js koduyla,
 * asgari DOM taklidiyle sınanır (two-horizon-decisions testiyle aynı desen).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EDITOR = fs.readFileSync(path.join(ROOT, 'public', 'data-management-filter.js'), 'utf8');
const DM = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

const C = (id, name, values, table = 'ASAS', extra = {}) => ({ id, table, name, field: name, op: 'in', valueType: 'text', values, ...extra });
const MAP = { Sezon: 'Sezon Kod', Marka: 'Marka', Tarih: 'Antrepo Tarih' };
const F = (table, name, type = 'text') => ({ header: name, table, name, dynamic: true, tr: `${table} · ${name}`, en: `${table} · ${name}`, type, typeSource: 'schema' });
const FIELDS = {
  asas: [F('ASAS', 'Sezon'), F('ASAS', 'Marka'), F('ASAS', 'Tarih', 'date'), F('ASAS', 'Kategori')],
  ias: [F('IAS', 'Sezon Kod'), F('IAS', 'Marka'), F('IAS', 'Antrepo Tarih', 'date'), F('IAS', 'Vasita')],
};
const VALUES = { Sezon: ['W26', 'S27'], 'Sezon Kod': ['W26', 'S27'], Marka: ['A', 'B', 'C'], Vasita: ['Gemi', 'Uçak'] };
const OPS = [{ id: 'in', arity: 'list' }, { id: 'notIn', arity: 'list' }, { id: 'between', arity: 'range' }, { id: 'gte', arity: 'from' }, { id: 'lte', arity: 'to' }, { id: 'contains', arity: 'single' }];

function editor({ left, right = null, storage = null, valuesFail = null, values = null }) {
  const posts = [];
  const listeners = {};
  const host = { innerHTML: '', classList: { add() {}, remove() {} }, addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {} };
  const json = body => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const query = new URLSearchParams(String(url).split('?')[1] || '');
    if (String(url).startsWith('/api/horizon/fields')) return json({ ok: true, fields: FIELDS[query.get('sourceId')] || [], operators: OPS });
    if (String(url).startsWith('/api/horizon/values') && valuesFail) { valuesFail(); return { ok: false, status: 502, json: async () => ({ ok: false, error: 'SSAS' }) }; }
    if (String(url).startsWith('/api/horizon/values') && values) return values(query);
    if (String(url).startsWith('/api/horizon/values')) return json({ ok: true, values: VALUES[query.get('column') || query.get('field')] || [], source: 'database' });
    if (url === '/api/horizon/field-match') {
      await tick(2);
      return json({ ok: true, matches: body.fields.map((field, index) => {
        const name = MAP[field.name];
        const target = name && FIELDS.ias.find(entry => entry.name === name);
        return { index, target: target ? { field: target.header, table: target.table, name: target.name, type: target.type, typeSource: 'schema' } : null, confidence: target ? 'exact' : '' };
      }) });
    }
    posts.push({ url, body });
    return json({ ok: true, warnings: [] });
  };
  let closed = 0;
  const store = storage || new Map();
  const context = {
    fetch, setTimeout, clearTimeout, console, URLSearchParams,
    BLStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) },
    BLDataPicker: { open: (_anchor, _items, onPick) => { context.lastPick = onPick; }, close() {} },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(EDITOR, context, { filename: 'data-management-filter.js' });
  const element = (attribute, value, extra = {}) => ({ getAttribute: () => value, dataset: extra.dataset || {}, checked: extra.checked, value: extra.value });
  const fire = (type, attribute, value, extra = {}) => listeners[type]({
    target: { closest: selector => (selector === `[${attribute}]` ? element(attribute, value, extra) : null) },
  });
  const ed = context.BLDataFilterEditor;
  return {
    posts, host, store, ed, closedCount: () => closed,
    setLang: language => vm.runInContext(`var appLang = ${JSON.stringify(language)};`, context),
    context, listeners,
    open: () => ed.open(host, {
      sourceId: 'asas', sourceName: 'ASAS', sourceRole: 'asas', moduleId: 'cp', moduleLabel: 'CP', revision: 'r1', canShare: true,
      definition: left, sharedWith: [], onClosed: () => { closed += 1; },
      pair: right ? { sourceId: 'ias', sourceName: 'IAS', sourceRole: 'antrepo', revision: 'r2', definition: right } : null,
    }),
    click: (attribute, value, dataset) => fire('click', attribute, value, { dataset }),
    change: (attribute, value, extra) => fire('change', attribute, value, extra),
    addField: header => fire('click', 'data-dmf-add-field', header, { dataset: { dmfAddField: encodeURIComponent(header) } }),
    tick: (key, value, checked) => fire('change', 'data-dmf-value', key, { dataset: { dmfValue: key, dmfV: encodeURIComponent(value) }, checked }),
    save: mode => fire('click', 'data-save', mode, { dataset: { save: mode } }),
  };
}
const keyOf = (html, name) => {
  const match = html.match(new RegExp(`data-dmf-select="(p:[^"]+)">\\s*<span class="dmfCardSource">ASAS</span>\\s*<b>${name}</b>`));
  return match && match[1];
};
const pairPost = ed => ed.posts.find(item => item.url === '/api/data-management/filter-pair');
const conditionsOf = definition => definition.groups.map(group => group.conditions.map(condition => `${condition.name}:${condition.op}=${(condition.values || []).join('|') || [condition.from, condition.to].join('→')}`));

test('basit kip: tek gruplu ASAS ⇄ IAS filtresi Backlog düzeniyle açılır; eşleme kartta görünür', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] },
    right: { table: 'IAS', groups: [{ id: 'h', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] }] },
  });
  await ed.open();
  await tick(10);
  const html = ed.host.innerHTML;
  assert.match(html, /class="dmfSimple"/);
  assert.match(html, /blvFilterWorkspace/, 'Backlog çekmecesinin ortak kabuğu kullanılmalı');
  assert.match(html, /data-dmf-side="pair"/, 'IAS sütun kataloğu sekmesi olmalı');
  assert.match(html, /↔ IAS: Sezon Kod/);
  assert.match(html, /data-dmf-mode="advanced"/);
  assert.doesNotMatch(html, /class="dmfGroups"/, 'Gelişmiş koşul satırları basit kipte çizilmez');
  assert.doesNotMatch(html, /data-add-group/, 'VEYA grubu yalnız Gelişmiş kipte');
  assert.equal(ed.ed.isDirty(), false, 'açılışta kaydedilmemiş değişiklik yok');
  // İlk kart açılışta seçilir; değer listesinin yüklenmesi (alan tipi damgası) değişiklik sayılmaz.
  assert.match(html, /data-dmf-v="S27"/, 'değer listesi yüklendi');
});

test('değer listesi okunamazsa her çizimde yeniden istek atılmaz; elle yazma yolu açık kalır', async () => {
  let calls = 0;
  const ed = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] }, valuesFail: () => { calls += 1; } });
  await ed.open();
  await tick(10);
  ed.click('data-dmf-mode', 'simple', { dmfMode: 'simple' });
  ed.click('data-dmf-select', 'p:a', { dmfSelect: 'p:a' });
  await tick(10);
  assert.equal(calls, 1, 'başarısız okuma bu açılışta tek istektir');
  assert.match(ed.host.innerHTML, /Değerler okunamadı/);
  assert.match(ed.host.innerHTML, /data-dmf-free="p:a"/);
});

test('basit kip: katalogdan sütun eklenir, IAS karşılığı otomatik bulunur, değer seçimi IAS\'a taşınır ve tek işlemle kaydedilir', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] },
    right: { table: 'IAS', groups: [{ id: 'h', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] }] },
  });
  await ed.open();
  await tick(10);
  ed.addField('Marka');
  await tick(10);
  const key = keyOf(ed.host.innerHTML, 'Marka');
  assert.ok(key, 'Marka kartı oluşmalı');
  assert.match(ed.host.innerHTML, /data-dmf-v="B"/, 'değerler database ucundan listelenir');
  assert.match(ed.host.innerHTML, /birebir/, 'otomatik eşleme kökeni görünür');
  ed.tick(key, 'B', true);
  assert.equal(ed.ed.isDirty(), true);
  ed.save('personal');
  await tick(10);
  const post = pairPost(ed);
  assert.ok(post, 'ASAS ve IAS birlikte kaydedilir');
  assert.deepEqual(conditionsOf(post.body.items[0].definition), [['Sezon:in=W26', 'Marka:in=B']]);
  assert.deepEqual(conditionsOf(post.body.items[1].definition), [['Sezon Kod:in=W26', 'Marka:in=B']]);
  assert.equal(ed.closedCount(), 1, 'başarılı kayıt çekmeceyi kapatır');
});

test('basit kip: IAS değerleri ayrı seçilince ASAS değişikliği onları ezmez', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Marka', ['A'])] }] },
    right: { table: 'IAS', groups: [] },
  });
  await ed.open();
  await tick(10);
  ed.click('data-dmf-pair-custom', 'a', { dmfPairCustom: 'a' });
  ed.tick('q:a', 'C', true);
  ed.tick('p:a', 'B', true);
  ed.save('personal');
  await tick(10);
  const post = pairPost(ed);
  assert.deepEqual(conditionsOf(post.body.items[0].definition), [['Marka:in=A|B']]);
  assert.deepEqual(conditionsOf(post.body.items[1].definition), [['Marka:in=A|C']], 'IAS ayrı değerleri korunur');
});

test('basit kip: aralık uçlarından işleç türetilir ve IAS aynı işleci alır', async () => {
  const ed = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [] }] }, right: { table: 'IAS', groups: [] } });
  await ed.open();
  await tick(5);
  ed.addField('Tarih');
  await tick(10);
  const key = keyOf(ed.host.innerHTML, 'Tarih');
  assert.match(ed.host.innerHTML, /data-dmf-range="p:[^"]+:from"/, 'tarih alanı aralık kontrolüyle açılır');
  ed.change('data-dmf-range', `${key}:from`, { dataset: { dmfRange: `${key}:from` }, value: '2026-01-05' });
  ed.save('personal');
  await tick(10);
  const post = pairPost(ed);
  assert.deepEqual(conditionsOf(post.body.items[0].definition), [['Tarih:gte=2026-01-05→']]);
  assert.deepEqual(conditionsOf(post.body.items[1].definition), [['Antrepo Tarih:gte=2026-01-05→']]);
});

test('basit kip: değer seçilmemiş filtre kaydedilmez (hiçbir satırı tutmayan sorgu üretmez)', async () => {
  const ed = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] } });
  await ed.open();
  await tick(5);
  ed.addField('Kategori');
  ed.save('personal');
  await tick(5);
  assert.equal(ed.posts.filter(item => item.url.startsWith('/api/data-management/')).length, 0);
  assert.match(ed.host.innerHTML, /Değer ya da aralık seçilmemiş: Kategori/);
});

test('VEYA grubu ya da gelişmiş işleç varsa Gelişmiş kipte açılır; koşullar değişmeden korunur', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('a', 'Sezon', ['W26'])] }, { id: 'g1', conditions: [C('b', 'Marka', ['A'], 'ASAS', { op: 'notIn' })] }] },
  });
  await ed.open();
  await tick(5);
  assert.match(ed.host.innerHTML, /class="dmfGroups"/);
  assert.match(ed.host.innerHTML, /data-dmf-mode="simple" disabled/);
  assert.match(ed.host.innerHTML, /Gelişmiş kipte açıldı/);
  ed.click('data-dmf-mode', 'simple', { dmfMode: 'simple' });
  assert.match(ed.host.innerHTML, /class="dmfGroups"/, 'engelli basit kip seçilemez');
  ed.save('personal');
  await tick(5);
  const post = ed.posts.find(item => item.url === '/api/data-management/filter');
  assert.deepEqual(conditionsOf(post.body.definition), [['Sezon:in=W26'], ['Marka:notIn=A']]);
});

test('kip tercihi tarayıcıda hatırlanır', async () => {
  const storage = new Map();
  const first = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] }, storage });
  await first.open();
  await tick(5);
  first.click('data-dmf-mode', 'advanced', { dmfMode: 'advanced' });
  assert.equal(storage.get('bl.dataManagement.horizonFilterMode.v1'), 'advanced');
  const second = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] }, storage });
  await second.open();
  await tick(5);
  assert.match(second.host.innerHTML, /class="dmfGroups"/);
});

test('Veri Yönetimi: tek düzenleme yeri Horizon çekmecesi; CP, Diğer modüller ve INTAKE sekmeleri', () => {
  assert.match(DM, /function openHorizonDrawer\(groupId, moduleId = '', sourceId = ''\)/);
  assert.match(DM, /const drawerGroups = \(\) => \[\.\.\.horizonGroupsOf\(\), \{ id: 'intake', targets: \['intake'\] \}\];/);
  assert.match(DM, /openFilterEditor\(moduleId, sourceId, mountEl\)/);
  assert.match(DM, /onClosed: \(\) => closeHorizonDrawer\(true\)/);
  assert.match(DM, /className = 'blvFilterRoot dmHorizonDrawer'/, 'Backlog çekmecesinin ortak kabuğu');
  assert.match(DM, /BLMotionPlus\?\.play\?\.\('overlay'/, 'Motion+ overlay hareketi');
  // Kaydedilmemiş değişiklik sekme değişiminde ve kapanışta sorulur.
  assert.match(DM, /function switchHorizon\([^)]*\) \{\s*if \(window\.BLDataFilterEditor\?\.isBusy\?\.\(\)\) return;\s*if \(window\.BLDataFilterEditor\?\.isDirty\?\.\(\) && !window\.confirm/);
  assert.match(DM, /if \(event\.key === 'Escape'\)/);
  // Yalnız Kaydet: çekmece yenileme başlatmaz.
  const drawer = DM.slice(DM.indexOf('let horizonDrawer = null;'), DM.indexOf('function openFilterEditor('));
  assert.doesNotMatch(drawer, /loadFromServer|refreshHorizon\(/);
});

test('TR/EN: açık çekmece ve düzenleyici dil değişiminde yeniden çizilir', async () => {
  const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const apply = APP.slice(APP.indexOf('function applyLanguage(lang){'), APP.indexOf('function applyLanguage(lang){') + 4000);
  assert.match(apply, /else if\(tab==='source'\) window\.BLDataManagement\?\.refreshLanguage\?\.\(\);/);
  assert.match(DM, /function refreshLanguage\(\) \{\s*if \(!horizonDrawer\) return;\s*renderDrawerHead\(\);\s*window\.BLDataFilterEditor\?\.refreshLanguage\?\.\(\);/);
  assert.match(DM, /document\.addEventListener\('bl:language-changed', refreshLanguage\)/);
  // Düzenleyici gerçekten aktif dille yeniden çizilir.
  const ed = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Sezon', ['W26'])] }] } });
  await ed.open();
  await tick(5);
  assert.match(ed.host.innerHTML, /Gelişmiş/);
  ed.setLang('en');
  ed.ed.refreshLanguage();
  assert.match(ed.host.innerHTML, />Advanced</);
  assert.doesNotMatch(ed.host.innerHTML, /Gelişmiş|Kaydet \(yalnız benim için\)/);
});

/* Codex incelemesi (PR #839) — doğrulanan iki bulgu. */
test('klavye: onay kutusu Space ile değişince yeniden çizimde odak aynı kutuya döner', async () => {
  const ed = editor({ left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Marka', ['A'])] }] } });
  const focused = [];
  ed.host.contains = () => true;
  ed.host.querySelector = selector => (selector.startsWith('input[') ? { focus: () => focused.push(selector), setSelectionRange() {} } : null);
  ed.host.querySelectorAll = () => [];
  await ed.open();
  await tick(5);
  const box = { tagName: 'INPUT', attributes: [{ name: 'type', value: 'checkbox' }, { name: 'data-dmf-value', value: 'p:a' }, { name: 'data-dmf-v', value: 'B' }], selectionStart: null };
  ed.context.document = { activeElement: box };
  focused.length = 0;
  ed.tick('p:a', 'B', true);
  assert.deepEqual(focused, ['input[data-dmf-value="p:a"][data-dmf-v="B"]'], 'odak yeni DOM\'daki aynı onay kutusuna döner');
});

test('ilk değer listesi yüklenirken yazılan arama, liste kesik dönünce sunucuya gider', async () => {
  const asked = [];
  let releaseBase;
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g', conditions: [C('a', 'Marka', [])] }] },
    values: async query => {
      asked.push(query.get('q') || '');
      if (!query.get('q')) await new Promise(resolve => { releaseBase = resolve; });
      return { ok: true, status: 200, json: async () => ({ ok: true, values: query.get('q') ? ['ZZ-2500'] : ['A'], truncated: !query.get('q'), source: 'database' }) };
    },
  });
  const opening = ed.open();
  await tick(5);
  // Liste daha yüklenmeden kullanıcı arar ve duraksar.
  ed.listeners.input({ target: { matches: selector => selector === '[data-dmf-value-search]', dataset: { dmfValueSearch: 'p:a' }, value: 'ZZ' } });
  await tick(400);
  assert.deepEqual(asked, [''], 'ilk liste bitmeden sunucu araması kararı verilmez');
  releaseBase();
  await opening;
  await tick(10);
  assert.deepEqual(asked, ['', 'ZZ'], 'liste kesik dönünce bekleyen arama sunucuya gider');
  assert.match(ed.host.innerHTML, /data-dmf-v="ZZ-2500"/);
});
