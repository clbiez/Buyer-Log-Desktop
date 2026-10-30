'use strict';

/* v2026-10-30 — YAN YANA ASAS ⇄ IAS FİLTRE VE EŞLEME HAFIZASI.
 *
 * Kullanıcı kararı: "ASAS'ta X sütununu filtre için seçtiğimde IAS'ta da
 * eşleşen başlık otomatik seçilsin. ASAS ve IAS yan yana görünsün ki
 * karşılaştırma yapılabilsin. Otomatik eşleşme hatalı olabilir; manuel de
 * seçilebilsin. Manuel seçileni otomatik hatırla."
 *
 * Korunan kusurlar:
 *  1) HATIRLANMAYAN DÜZELTME. Kullanıcının elle seçtiği eşleme bir sonraki
 *     açılışta otomatik tahminden ÖNCE gelmeli; "karşılığı yok" kararı da
 *     aynı yanlış öneriyi geri getirmemeli.
 *  2) BAYAT HAFIZA. Hatırlanan sütun canlı şemada yoksa sessizce kullanılmaz;
 *     otomatik eşlemeye düşülür ve bu söylenir.
 *  3) YARIM KAYIT. ASAS ve IAS ortak filtresi tek işlemde yazılır: biri
 *     reddedilirse ikisi de yazılmaz.
 *  4) SİLİNEN IAS KOŞULU. Eşte olup solda karşılığı olmayan koşullar korunur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-asas-ias-pair-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const pairs = require('../server/lib/horizon-field-pairs');
const mapping = require('../server/lib/horizon-filter-mapping');
const adapter = require('../server/lib/data-domain/legacy-adapter');
const { createSourceWorkflowService } = require('../server/lib/source-workflow-service');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const FILTER_UI = read('public/data-management-filter.js');
const DM = read('public/data-management.js');
const HORIZON_ROUTES = read('server/routes/horizon-routes.js');
const TEMPLATE_ROUTES = read('server/routes/horizon-template-routes.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const IAS_FIELDS = [
  { header: 'Buyer Grup', table: 'Siparis Bilgileri', name: 'Buyer Grup', dynamic: true, type: 'text', typeSource: 'schema' },
  { header: 'Ürün Tanım', table: 'Siparis Bilgileri', name: 'Ürün Tanım', dynamic: true, type: 'text', typeSource: 'schema' },
  { header: 'Product Line', table: 'Siparis Bilgileri', name: 'Product Line', dynamic: true, type: 'text', typeSource: 'schema' },
];
const PRODUCT = { field: 'Product', table: 'ASAS', name: 'Product' };
const remember = (to) => ({ fromRole: 'asas', toRole: 'antrepo', from: PRODUCT, to });

test('hafıza: aynı kaynak alan için son karar kazanır; değişmeyen karar yeniden yazılmaz', () => {
  let state = pairs.upsertPairs([], [remember({ table: 'Siparis Bilgileri', name: 'Product Line', field: 'Product Line' })], { at: 't1', by: 'u1' });
  assert.equal(state.changed, 1);
  state = pairs.upsertPairs(state.items, [remember({ table: 'Siparis Bilgileri', name: 'Ürün Tanım', field: 'Ürün Tanım' })], { at: 't2', by: 'u2' });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].to.name, 'Ürün Tanım');
  assert.equal(state.items[0].updatedBy, 'u2');
  const again = pairs.upsertPairs(state.items, [remember({ table: 'Siparis Bilgileri', name: 'Ürün Tanım', field: 'Ürün Tanım' })], { at: 't3' });
  assert.equal(again.changed, 0, 'aynı karar zaman damgası almaz');
  // Büyük/küçük harf ve boşluk farkı aynı alan sayılır.
  assert.ok(pairs.lookupPair(state.items, 'asas', 'antrepo', { table: ' asas ', name: 'PRODUCT' }));
  // Geçersiz rol ve aynı rol reddedilir.
  assert.deepEqual(pairs.normalizePairs([{ fromRole: 'asas', toRole: 'asas', from: PRODUCT, to: null }, { fromRole: 'intake', toRole: 'antrepo', from: PRODUCT, to: null }]), []);
});

test('eşleme: hatırlanan karar otomatik tahminden önce gelir; "karşılığı yok" yanlış öneriyi geri getirmez', () => {
  const auto = mapping.matchFields({ fields: [PRODUCT], targetFields: IAS_FIELDS });
  assert.equal(auto[0].target && auto[0].target.name, 'Product Line', 'hafıza yokken otomatik (benzer ad) öneri');
  const remembered = mapping.matchFields({ fields: [PRODUCT], targetFields: IAS_FIELDS, pairs: [remember({ table: 'Siparis Bilgileri', name: 'Ürün Tanım', field: 'Ürün Tanım' })] });
  assert.equal(remembered[0].confidence, 'remembered');
  assert.equal(remembered[0].target.name, 'Ürün Tanım');
  const none = mapping.matchFields({ fields: [PRODUCT], targetFields: IAS_FIELDS, pairs: [remember(null)] });
  assert.equal(none[0].target, null);
  assert.equal(none[0].confidence, 'none');
  const exact = mapping.matchFields({ fields: [{ field: 'Buyer Grup', table: 'ASAS', name: 'Buyer Grup' }], targetFields: IAS_FIELDS });
  assert.equal(exact[0].confidence, 'exact');
});

test('eşleme: hatırlanan sütun canlı şemada yoksa sessizce kullanılmaz', () => {
  const stale = mapping.matchFields({ fields: [PRODUCT], targetFields: IAS_FIELDS, pairs: [remember({ table: 'Siparis Bilgileri', name: 'Silinmiş Sütun', field: 'Silinmiş Sütun' })] });
  assert.equal(stale[0].rememberedStale, true);
  assert.equal(stale[0].target.name, 'Product Line', 'otomatik eşlemeye düşülür');
  // Toplu öneri (eski "IAS filtresinden eşle" yolu) de hafızayı kullanır.
  const proposal = mapping.proposeMapping({
    groups: [{ conditions: [{ ...PRODUCT, op: 'in', values: ['Sweatshirt'] }] }],
    targetFields: IAS_FIELDS, pairs: [remember({ table: 'Siparis Bilgileri', name: 'Ürün Tanım', field: 'Ürün Tanım' })],
  });
  assert.equal(proposal.proposals[0].confidence, 'remembered');
  assert.equal(proposal.stats.remembered, 1);
});

test('hafıza ortak ayarlarda revizyonlu saklanır', () => {
  const first = db.upsertHorizonFieldPairs([remember({ table: 'Siparis Bilgileri', name: 'Ürün Tanım', field: 'Ürün Tanım' })], { by: 'moderator' });
  assert.equal(first.changed, 1);
  const loaded = db.loadHorizonFieldPairs();
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.revision, first.revision);
  const same = db.upsertHorizonFieldPairs([remember({ table: 'Siparis Bilgileri', name: 'Ürün Tanım', field: 'Ürün Tanım' })], { by: 'moderator' });
  assert.equal(same.changed, 0);
  assert.equal(db.loadHorizonFieldPairs().revision, first.revision, 'değişmeyen karar revizyon artırmaz');
});

const H = (table, field, values) => ({ table, groups: [{ id: 'g', conditions: [{ id: 'c', table, field, name: field, op: 'in', valueType: 'text', values }] }] });
function setup() {
  return db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
      scopes: [{ id: 'sc_cp', targets: ['cp'], horizon: H('ASAS', 'Sezon', ['W6']) }, { id: 'sc_l', targets: ['orders', 'backlog', 'lfl', 'priceanalysis'], horizon: H('ASAS', 'Sezon', ['W6', 'S7']) }] },
    { id: 'mc_ias', name: 'IAS', server: 's2', catalog: 'c2', role: 'antrepo', refreshEnabled: true,
      scopes: [{ id: 'sc_icp', targets: ['cp'], horizon: H('Siparis Bilgileri', 'Sezon Kod', ['2026W6']) }, { id: 'sc_io', targets: ['orders', 'backlog'], horizon: H('Siparis Bilgileri', 'Sezon Kod', ['2026W6']) }] },
  ], null).items;
}
const valuesOf = (items, sourceId, moduleId) => items.find(item => item.id === sourceId).scopes
  .find(scope => scope.targets.includes(moduleId)).horizon.groups[0].conditions.map(condition => `${condition.name}=${condition.values.join('/')}`);

test('ortak kayıt: ASAS ve IAS filtresi tek işlemde yazılır', async () => {
  const items = setup();
  const service = createSourceWorkflowService({ db });
  const rev = id => adapter.configRevision(items.find(item => item.id === id));
  const saved = await service.updateFilterPair([
    { sourceId: 'mc_asas', expected: rev('mc_asas'), args: { sourceId: 'mc_asas', moduleId: 'cp', definition: H('ASAS', 'Buyer Grup', ['LICENSE']), mode: 'shared' } },
    { sourceId: 'mc_ias', expected: rev('mc_ias'), args: { sourceId: 'mc_ias', moduleId: 'cp', definition: H('Siparis Bilgileri', 'Buyer Grup', ['LICENSE']), mode: 'shared' } },
  ]);
  assert.equal(saved.changed, true);
  const after = db.loadModelConnections().items;
  assert.deepEqual(valuesOf(after, 'mc_asas', 'cp'), ['Buyer Grup=LICENSE']);
  assert.deepEqual(valuesOf(after, 'mc_ias', 'cp'), ['Buyer Grup=LICENSE']);
  assert.deepEqual(valuesOf(after, 'mc_ias', 'orders'), ['Sezon Kod=2026W6'], 'diğer ufuk etkilenmez');
  assert.ok(saved.sourceRevisions.mc_asas && saved.sourceRevisions.mc_ias);
});

test('ortak kayıt: kaynaklardan biri araya giren değişiklikle eskidiyse HİÇBİRİ yazılmaz', async () => {
  const items = setup();
  const service = createSourceWorkflowService({ db });
  const before = JSON.stringify(db.loadModelConnections().items);
  await assert.rejects(service.updateFilterPair([
    { sourceId: 'mc_asas', expected: adapter.configRevision(items.find(item => item.id === 'mc_asas')), args: { sourceId: 'mc_asas', moduleId: 'cp', definition: H('ASAS', 'Buyer Grup', ['X']), mode: 'shared' } },
    { sourceId: 'mc_ias', expected: 'eski-revizyon', args: { sourceId: 'mc_ias', moduleId: 'cp', definition: H('Siparis Bilgileri', 'Buyer Grup', ['X']), mode: 'shared' } },
  ]), error => error.code === 'SOURCE_CHANGED');
  assert.equal(JSON.stringify(db.loadModelConnections().items), before, 'yarım kayıt yok');
  await assert.rejects(service.updateFilterPair([{ sourceId: 'mc_asas', expected: '', args: {} }]), error => error.code === 'VALIDATION_ERROR');
});

test('uçlar: eşleme önerisi yazmaz; hafıza ve çift kayıt Kaynak yetkisiyle korunur', () => {
  assert.match(HORIZON_ROUTES, /app\.post\('\/api\/horizon\/field-match', userAccess\.requireArea\('source'\)/);
  assert.match(HORIZON_ROUTES, /app\.put\('\/api\/horizon\/field-pairs', userAccess\.requireArea\('source'\)/);
  assert.match(HORIZON_ROUTES, /pairs: db\.loadHorizonFieldPairs\(\)\.items/);
  assert.match(HORIZON_ROUTES, /appendAudit\(req\.currentUser, 'HORIZON_FIELD_PAIRS_UPDATE'/);
  const route = TEMPLATE_ROUTES.slice(TEMPLATE_ROUTES.indexOf("app.post('/api/data-management/filter-pair'"), TEMPLATE_ROUTES.indexOf('/* EZEN KİŞİSEL KATMANI KALDIR'));
  assert.match(route, /userAccess\.requireArea\('source'\)/);
  assert.match(route, /hasPermission\(req\.currentUser, 'manageModelConnections'\)/, 'ortak kayıt yönetim yetkisi ister');
  assert.match(route, /sourceWorkflowService\.updateFilterPair\(/);
  assert.match(route, /code: 'PAIR_PARTIAL'/, 'kişisel yarım kayıt sessiz geçmez');
});

test('arayüz: Horizon panelinden açılan ufuk ASAS solda, IAS sağda yan yana açılır', () => {
  assert.match(DM, /function horizonPairFor\(moduleId\)/);
  assert.match(DM, /const paired = slotOverride \? horizonPairFor\(moduleId\) : null;/);
  assert.match(DM, /feed\.sourceRole === 'asas'/);
  assert.match(DM, /feed\.sourceRole === 'antrepo'/);
  assert.match(DM, /pair: paired \? \{/);
  // Sol alan seçilince IAS karşılığı otomatik aranır; değerler senkron kalır.
  assert.match(FILTER_UI, /void rematch\(condition\);/);
  assert.match(FILTER_UI, /fetch\('\/api\/horizon\/field-match'/);
  assert.match(FILTER_UI, /function syncPair\(condition\)[\s\S]{0,200}if \(link\.valuesEdited\) return;/);
  // Elle seçim: "IAS'ta uygulanmaz" seçeneği dahil; elle seçilen hatırlanır.
  assert.match(FILTER_UI, /value: '__none__'/);
  assert.match(FILTER_UI, /origin: 'manual', valuesEdited: Boolean\(previous\), manualPair: true/);
  assert.match(FILTER_UI, /if \(!link \|\| !link\.manualPair \|\| !condition\.field\) return;/);
  assert.match(FILTER_UI, /fetch\('\/api\/horizon\/field-pairs', \{\s*method: 'PUT'/);
  // Kayıt iki kaynağı tek uçla yazar; eşte koşul yoksa IAS'a sınırsız filtre yazılmaz.
  assert.match(FILTER_UI, /fetch\('\/api\/data-management\/filter-pair'/);
  assert.match(FILTER_UI, /if \(!definition\.groups\.length\) \{/);
  // Yalnız IAS'ta olan koşullar korunur.
  assert.match(FILTER_UI, /const conditions = \[\.\.\.mapped, \.\.\.\(pair\.extras\[groupIndex\] \|\| \[\]\)\];/);
});
