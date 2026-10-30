'use strict';

/* v2026-10-30 — İKİ UFUK: BAĞIMSIZ DENETİM SONRASI KULLANICI KARARLARI.
 *
 * Bu dosya kaynak metnini değil DAVRANIŞI sınar: yan yana düzenleyici gerçek
 * public/data-management-filter.js kodudur (asgari DOM taklidiyle çalışır),
 * uçlar gerçek route işleyicileri ve gerçek db / tercih deposudur.
 *
 * Korunan kusurlar:
 *  1) Şablon yüklenince (ya da birkaç alan aynı anda eşlenirken) yalnız son
 *     eşleme işleniyor, ötekiler "aranıyor" kalıyor ve kayıt IAS'a eksik
 *     filtre yazıyordu.
 *  2) VEYA grubu silinince "yalnız IAS" koşulları sonraki gruba kayıyor,
 *     sondaki görünmeyen tek başına bir VEYA grubu olarak kaydediliyordu.
 *  3) IAS karşılığı alınamadığında IAS filtresi yine yeniden yazılıyor ve
 *     grup dışı alanları (sezon) düşüyordu. Beklenen: IAS değişmez.
 *  4) Kullanıcı kararı: CP'nin filtresi eksikse diğer modüller yine yenilenir,
 *     CP atlanır; yalnız CP istenirse eski ret korunur.
 *  5) Kullanıcı kararı: alan eşleme hafızası kişisel + yönetici. Yetkisiz
 *     kullanıcı ortak hafızayı yazamaz; kendi kişisel hafızası önce gelir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-two-horizon-decisions-'));
for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_AUTH_DATA_ROOT']) process.env[key] = root;
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const db = require('../server/db');
const prefs = require('../server/lib/user-preferences');
const scopes = require('../server/lib/model-scopes');
const fieldPairs = require('../server/lib/horizon-field-pairs');
const { inspectSourceFilterReadiness } = require('../server/lib/source-filter-readiness');

const EDITOR = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management-filter.js'), 'utf8');
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Yan yana düzenleyici: gerçek modül + asgari DOM                     */

const C = (id, name, values, table = 'ASAS') => ({ id, table, name, field: `${table} · ${name}`, op: 'in', values });
const MAP = { Sezon: 'Sezon Kod', 'Buyer Grup': 'Buyer Grup', Ürün: 'Ürün Tanım', Marka: 'Marka' };
const fieldList = (table, names) => names.map(name => ({ header: `${table} · ${name}`, table, name, dynamic: true, tr: name, en: name, type: 'text', typeSource: 'schema' }));

function editor({ left, right, templates = [], matchFails = false, canShare = true }) {
  const posts = [];
  let matchCalls = 0;
  const listeners = {};
  const host = { innerHTML: '', classList: { add() {}, remove() {} }, addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {} };
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (String(url).startsWith('/api/horizon/fields')) {
      const ias = new URLSearchParams(String(url).split('?')[1]).get('sourceId') === 'ias';
      return json({ ok: true, fields: ias ? fieldList('IAS', ['Sezon Kod', 'Buyer Grup', 'Ürün Tanım', 'Marka', 'Vasita']) : fieldList('ASAS', Object.keys(MAP)), operators: [{ id: 'in', arity: 'list' }, { id: 'gte', arity: 'from' }, { id: 'lte', arity: 'to' }] });
    }
    if (url === '/api/horizon/field-match') {
      matchCalls += 1;
      if (matchFails) return json({ ok: false, error: 'SSAS şeması okunamadı' }, 502);
      // Gerçek ağ gibi: istekler farklı sürelerde döner (yarışı ortaya çıkarır).
      await tick(matchCalls % 2 ? 15 : 3);
      return json({ ok: true, matches: body.fields.map((field, index) => {
        const name = MAP[field.name];
        return { index, target: name ? { field: `IAS · ${name}`, table: 'IAS', name, type: 'text', typeSource: 'schema' } : null, confidence: name ? 'exact' : '' };
      }) });
    }
    if (url === '/api/horizon-templates') return json({ ok: true, personal: [], shared: templates });
    posts.push({ url, body });
    return json({ ok: true, warnings: [] });
  };
  const context = { fetch, setTimeout, clearTimeout, console, URLSearchParams, BLDataPicker: { open: (_anchor, _items, onPick) => { context.lastPick = onPick; }, close() {} } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(EDITOR, context, { filename: 'data-management-filter.js' });
  const click = (attribute, value, dataset) => listeners.click({
    target: { closest: selector => (selector === `[${attribute}]` ? { dataset, getAttribute: () => value } : null) },
  });
  return {
    posts, host,
    open: () => context.BLDataFilterEditor.open(host, {
      sourceId: 'asas', sourceName: 'ASAS', sourceRole: 'asas', moduleId: 'cp', moduleLabel: 'CP', revision: 'r1', canShare,
      definition: left, sharedWith: [],
      pair: { sourceId: 'ias', sourceName: 'IAS', sourceRole: 'antrepo', revision: 'r2', definition: right },
    }),
    applyTemplate: id => click('data-apply-template', id, { applyTemplate: id, shared: '1' }),
    dropGroup: index => click('data-drop-group', String(index), { dropGroup: String(index) }),
    addGroup: () => click('data-add-group', '', {}),
    pickPairField: (ref, value) => { click('data-pick-pair-field', ref, { pickPairField: ref }); context.lastPick(value); },
    save: mode => click('data-save', mode, { save: mode }),
  };
}
const iasGroups = post => post.body.items[1].definition.groups.map(group => group.conditions.map(condition => `${condition.name}=${condition.values.join('|')}`));

test('şablon yüklenince bütün satırlar eşlenir; IAS\'a eksik filtre yazılmaz', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('a', 'Sezon', ['W26'])] }] },
    right: { table: 'IAS', groups: [{ id: 'h0', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] }] },
    templates: [{ id: 't1', name: 'Tpl', definition: { table: 'ASAS', groups: [{ id: 'tg', conditions: [C('t1', 'Sezon', ['W27']), C('t2', 'Buyer Grup', ['LIC']), C('t3', 'Ürün', ['Tee'])] }] } }],
  });
  await ed.open();
  await tick(5);
  ed.applyTemplate('t1');
  // Eşleme bitmeden kayıt engellenir.
  ed.save('shared');
  await tick(1);
  assert.equal(ed.posts.filter(post => post.url.endsWith('filter-pair')).length, 0, 'eşleme sürerken kayıt yapılmamalı');
  assert.match(ed.host.innerHTML, /hâlâ aranıyor/);
  await tick(60);
  assert.doesNotMatch(ed.host.innerHTML, /karşılık aranıyor/, 'hiçbir satır "aranıyor" kalmamalı');
  ed.save('shared');
  await tick(5);
  const post = ed.posts.find(item => item.url.endsWith('filter-pair'));
  assert.ok(post, 'çift kayıt yapılmalı');
  // Mevcut IAS Sezon Kod koşulu korunur (W26, kullanıcı elle eşitlemedikçe), öteki iki koşul eşlenir.
  assert.deepEqual(iasGroups(post), [['Sezon Kod=W26', 'Buyer Grup=LIC', 'Ürün Tanım=Tee']]);
});

test('VEYA grubu silinince o grubun yalnız-IAS koşulları da silinir; kaymaz, gizli grup oluşmaz', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('a', 'Sezon', ['W26'])] }, { id: 'g1', conditions: [C('b', 'Buyer Grup', ['LIC'])] }, { id: 'g2', conditions: [C('c', 'Marka', ['M'])] }] },
    right: { table: 'IAS', groups: [
      { id: 'h0', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] },
      { id: 'h1', conditions: [C('y', 'Buyer Grup', ['LIC'], 'IAS'), C('v', 'Vasita', ['Gemi'], 'IAS')] },
      { id: 'h2', conditions: [C('z', 'Marka', ['M'], 'IAS'), C('w', 'Vasita', ['Uçak'], 'IAS')] },
    ] },
  });
  await ed.open();
  await tick(5);
  ed.dropGroup(1);
  ed.save('shared');
  await tick(5);
  const post = ed.posts.find(item => item.url.endsWith('filter-pair'));
  assert.deepEqual(iasGroups(post), [['Sezon Kod=W26'], ['Marka=M', 'Vasita=Uçak']]);
});

test('sol taraftan fazla olan yalnız-IAS VEYA grubu ekranda görünür', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('a', 'Sezon', ['W26'])] }] },
    right: { table: 'IAS', groups: [{ id: 'h0', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] }, { id: 'h1', conditions: [C('w', 'Vasita', ['Uçak'], 'IAS')] }] },
  });
  await ed.open();
  await tick(5);
  assert.match(ed.host.innerHTML, /Yalnız IAS(?:'|&#39;)ta olan VEYA grubu/);
  assert.match(ed.host.innerHTML, /Uçak/);
  // Yeni VEYA grubu eklemek yalnız-IAS grubunu yeni grupla VE'lemez.
  ed.addGroup();
  ed.save('shared');
  await tick(5);
  const post = ed.posts.find(item => item.url.endsWith('filter-pair'));
  assert.deepEqual(iasGroups(post), [['Sezon Kod=W26'], ['Vasita=Uçak']]);
});

test('IAS karşılığı alınamazsa yan yana kip kapanır; IAS filtresi yazılmaz', async () => {
  const ed = editor({
    matchFails: true,
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('a', 'Sezon', ['W26'])] }] },
    right: { table: 'IAS', seasons: ['W26'], groups: [{ id: 'h0', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] }] },
  });
  await ed.open();
  assert.match(ed.host.innerHTML, /IAS filtresi değişmez/);
  ed.save('shared');
  await tick(5);
  assert.equal(ed.posts.filter(post => post.url.endsWith('filter-pair')).length, 0);
  assert.equal(ed.posts.filter(post => post.url === '/api/data-management/filter').length, 1, 'yalnız düzenlenen kaynak kaydedilir');
});

test('IAS\'ın grup dışı alanları (sezon) yan yana kayıtta korunur', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('a', 'Sezon', ['W26'])] }] },
    right: { table: 'IAS', seasons: ['W26'], dateStart: '2026-01-01', groups: [{ id: 'h0', conditions: [C('x', 'Sezon Kod', ['W26'], 'IAS')] }] },
  });
  await ed.open();
  await tick(5);
  ed.save('shared');
  await tick(5);
  const post = ed.posts.find(item => item.url.endsWith('filter-pair'));
  assert.deepEqual(post.body.items[1].definition.seasons, ['W26']);
  assert.equal(post.body.items[1].definition.dateStart, '2026-01-01');
});

/* Codex incelemesi (PR #790) — doğrulanan bulgular. */
test('yalnız sezonla sınırlı IAS filtresine koşul eklemek sezon sınırını kaldırmaz', async () => {
  // Sunucu etkin koşul grubu varken seasons alanını yok sayar; sınır koşula çevrilmeli.
  const ed = editor({
    left: { table: 'ASAS', seasons: ['W26'], seasonField: 'Sezon', groups: [] },
    right: { table: 'IAS', seasons: ['W26'], seasonField: 'Sezon Kod', groups: [] },
  });
  await ed.open();
  await tick(5);
  ed.save('shared');
  await tick(5);
  const post = ed.posts.find(item => item.url.endsWith('filter-pair'));
  assert.deepEqual(post.body.items[0].definition.groups.map(g => g.conditions.map(c => `${c.name}=${c.values.join('|')}`)), [['Sezon=W26']], 'ASAS sezon sınırı görünür koşul olur');
  assert.deepEqual(iasGroups(post), [['Sezon Kod=W26']], 'IAS sezon sınırı korunur');
  assert.equal(post.body.items[1].definition.seasons, undefined, 'koşula çevrilen eski alan iki yerde durmaz');
});

test('"IAS\'ta uygulanmaz" kararları yalnız ASAS kaydedilen yolda da hatırlanır', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [C('b', 'Buyer Grup', ['LIC'])] }] },
    right: { table: 'IAS', groups: [] },
  });
  await ed.open();
  await tick(5);
  ed.pickPairField('0:0', '__none__');
  ed.save('personal');
  await tick(10);
  assert.ok(ed.posts.some(item => item.url === '/api/data-management/filter'), 'yalnız ASAS kaydedilir');
  const memory = ed.posts.find(item => item.url === '/api/horizon/field-pairs');
  assert.ok(memory, 'elle karar hatırlanmalı');
  assert.equal(memory.body.scope, 'personal');
  assert.equal(memory.body.pairs[0].to, null);
});

test('IAS hücresi kaydedilecek IAS işlecine göre çizilir', async () => {
  const ed = editor({
    left: { table: 'ASAS', groups: [{ id: 'g0', conditions: [{ ...C('d', 'Sezon', []), op: 'gte', from: '2026-01-01' }] }] },
    right: { table: 'IAS', groups: [{ id: 'h0', conditions: [{ ...C('x', 'Sezon Kod', [], 'IAS'), op: 'lte', to: '2026-06-30' }] }] },
  });
  await ed.open();
  await tick(5);
  assert.match(ed.host.innerHTML, /data-pair-range="0:0:to"/);
  assert.doesNotMatch(ed.host.innerHTML, /data-pair-range="0:0:from"/);
});

test('yan yana eş tıklanan kaynağa bağlanır', () => {
  const DM = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management.js'), 'utf8');
  const start = DM.indexOf('function horizonPairFor(');
  const source = DM.slice(start, DM.indexOf('\n  }\n', start) + 4);
  const feed = (sourceId, sourceRole) => ({ sourceId, sourceRole, enabled: true });
  const model = { modules: [{ id: 'orders', feeds: [feed('asas1', 'asas'), feed('asas2', 'asas'), feed('ias1', 'antrepo')] }] };
  const pairFor = vm.runInNewContext(`(${source})`, { model, horizonGroupsOf: () => [{ id: 'linked', targets: ['orders'] }] });
  assert.equal(pairFor('orders', 'asas2').primary.sourceId, 'asas2', 'ikinci ASAS kaynağı kendi çipinden düzenlenir');
  assert.equal(pairFor('orders', 'ias1').pair.sourceId, 'ias1');
});

/* ------------------------------------------------------------------ */
/* Yenileme kararları                                                  */

const H = values => (values ? { table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Season', op: 'in', values }] }] } : { table: 'ASAS' });

test('CP\'nin filtresi eksikse diğer modüller yenilenir, CP atlanır; yalnız CP istenirse ret korunur', () => {
  const items = [db.normalizeModelConnection({ id: 'asas', server: 's', catalog: 'c', role: 'asas', defaultSeasonsApplied: true, scopes: [
    { id: 'cp', targets: ['cp'], horizon: H(null) },
    { id: 'core', targets: ['orders', 'backlog', 'lfl', 'priceanalysis'], horizon: H(['W26']) },
  ] })];
  const cpReady = () => inspectSourceFilterReadiness(items, ['cp'], { asasSourceMode: 'database' }).ready;
  const linked = scopes.skipUnreadyChain(scopes.withRefreshTargets(['orders']), cpReady);
  assert.deepEqual(linked.targets.slice().sort(), ['backlog', 'lfl', 'orders', 'priceanalysis']);
  assert.deepEqual(linked.skipped, [{ target: 'cp', code: 'SOURCE_FILTER_REQUIRED' }]);
  assert.equal(inspectSourceFilterReadiness(items, linked.targets, { asasSourceMode: 'database' }).ready, true, 'kalan modüller yenilenebilir');
  assert.deepEqual(scopes.skipUnreadyChain(['cp'], cpReady), { targets: ['cp'], skipped: [] }, 'yalnız CP: çağıran reddeder');
  assert.deepEqual(scopes.skipUnreadyChain(['cp', 'orders'], () => true).skipped, [], 'CP hazırsa atlanmaz');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /skippedTargets: targetPlan\.skippedTargets\.slice\(\),/, 'atlanan CP kullanıcıya bildirilir');
});

test('LFL tek başına yenilenebilir; genel yenileme LFL\'i kapsar', () => {
  assert.deepEqual(scopes.withRefreshTargets(['lfl']), ['lfl']);
  assert.deepEqual(scopes.withRefreshTargets(['orders']).slice().sort(), ['backlog', 'cp', 'lfl', 'orders', 'priceanalysis']);
});

/* ------------------------------------------------------------------ */
/* Alan eşleme hafızası: kişisel + yönetici (gerçek route işleyicileri) */

function routes(permissions) {
  const profile = { id: `u_${permissions.length}`, enabled: true, areas: ['source'], permissions };
  const handlers = new Map();
  const app = Object.fromEntries(['get', 'post', 'put', 'delete', 'patch'].map(method => [method, (url, ...fns) => handlers.set(`${method} ${url}`, fns.at(-1))]));
  const events = [];
  const access = { requireArea: () => () => {}, requirePermission: () => () => {}, hasPermission: (p, key) => p.permissions.includes(key), hasArea: () => true, appendAudit() {} };
  const schema = { columns: [{ table: 'IAS', name: 'Buyer Grup' }, { table: 'IAS', name: 'Sezon Kod' }] };
  require('../server/routes/horizon-routes')(app, {
    db, express: { json: () => () => {} }, userAccess: access, userPreferences: prefs,
    loadModelConnections: db.loadModelConnections, modelQuery: { discoverSchema: async () => schema },
    horizonFields: require('../server/lib/horizon-fields'), horizonFilterMapping: require('../server/lib/horizon-filter-mapping'),
    apiError: (res, err) => res.status(err.statusCode || 500).json({ code: err.code }), cacheForUser: () => ({}),
    publishSharedMasterChange: entity => events.push(entity), sourceUserId: req => req.currentUser.id,
  });
  const call = async (key, body) => {
    let status = 200, out;
    const res = { status: code => { status = code; return res; }, json: value => { out = value; return res; }, set: () => res };
    await handlers.get(key)({ body, currentUser: profile, query: {} }, res);
    return { status, out };
  };
  return { call, events, profile };
}
const PAIR = to => ({ fromRole: 'asas', toRole: 'antrepo', from: { table: 'ASAS', name: 'Buyer Grup' }, to });

test('ortak alan eşlemesini yalnız yönetici yazar; herkes kendi kişisel hafızasını tutar ve önce o kullanılır', async () => {
  db.replaceModelConnections([{ id: 'ias', name: 'IAS', server: 's', catalog: 'c', role: 'antrepo' }], null);
  const user = routes([]);
  const admin = routes(['manageModelConnections']);

  const denied = await user.call('put /api/horizon/field-pairs', { scope: 'shared', pairs: [PAIR({ table: 'IAS', name: 'Sezon Kod' })] });
  assert.equal(denied.status, 403);
  assert.equal(db.loadHorizonFieldPairs().items.length, 0, 'yetkisiz kullanıcı ortak hafızayı yazamaz');

  const shared = await admin.call('put /api/horizon/field-pairs', { scope: 'shared', pairs: [PAIR({ table: 'IAS', name: 'Buyer Grup' })] });
  assert.equal(shared.status, 200);
  assert.deepEqual(admin.events, ['horizonFieldPairs'], 'ortak karar ekibe yayımlanır');

  const personal = await user.call('put /api/horizon/field-pairs', { pairs: [PAIR({ table: 'IAS', name: 'Sezon Kod' })] });
  assert.equal(personal.out.scope, 'personal');
  assert.equal(db.loadHorizonFieldPairs().items[0].to.name, 'Buyer Grup', 'kişisel karar ortak hafızayı değiştirmez');
  assert.equal(fieldPairs.parsePersonal(prefs.load(user.profile.id).entries[fieldPairs.PERSONAL_KEY])[0].to.name, 'Sezon Kod');

  const field = [{ table: 'ASAS', name: 'Buyer Grup', field: 'ASAS · Buyer Grup' }];
  const mine = await user.call('post /api/horizon/field-match', { toSourceId: 'ias', fields: field });
  assert.equal(mine.out.matches[0].target.name, 'Sezon Kod', 'kullanıcının kendi kararı önce gelir');
  const team = await admin.call('post /api/horizon/field-match', { toSourceId: 'ias', fields: field });
  assert.equal(team.out.matches[0].target.name, 'Buyer Grup', 'başka kullanıcının kişisel kararı yöneticiyi etkilemez');
});
