'use strict';
/* WS6b (#1079) parite kapısı: Backlog V3 satır normalleştirmesi.
 *
 * Kök neden (CDP profili, 30k ASAS fixture = 37.708 operasyon satırı): Backlog
 * açılışında BLBacklogV3Report.normalizeRows ~0,9 sn tek blok; bunun ~0,56 sn'si
 * canonical-fields value() → rowLookup'ın, satırda birebir bulunmayan her bağlama
 * anahtarı için satırın tüm anahtarlarını token'laştırıp taramasıydı. Anahtar
 * (BL_READ_MODEL_BACKLOG) açıkken alan → anahtar çözümü şema başına bir kez yapılır.
 *
 * Girdi gerçek veri yolundan gelir: generate-demo-data → parseASASRows/parseAntrepoRows
 * → compute-tasks.buildBacklog('export') → sunucu serileştirmesi (tarih biçimi dahil)
 * → JSON.parse; yani tarayıcının /api/backlog-export?format=json'dan aldığı satırlar.
 * İki yetki kapsamı: (1) ALL (moderatör), (2) CUSTOM (iki buyer; sunucu
 * compute-access süzmesi) + ek ASAS kaynak sütunları (farklı başlık şeması).
 * Ayrıca karışık şema, token eşleşmesi, boş değer geri düşüşü ve geçersiz satırlar
 * için çekişmeli bir küme. Eski yol (compiledCanonical:false) = yeni yol (true).
 * Varsayılan 2k ASAS satırı. Tam kanıt:
 *   BL_BACKLOG_PARITY_ROWS=2000,30000 BL_BACKLOG_PARITY_LOG=1 npm test -- read-model-backlog
 */
const test = require('node:test'), assert = require('node:assert/strict');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const access = require('../server/lib/compute-access');
const V3 = require('../public/backlog-v3-report.js');

const COUNTS = String(process.env.BL_BACKLOG_PARITY_ROWS || '2000').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
const LOG = process.env.BL_BACKLOG_PARITY_LOG === '1';
const TODAY = parity.DEFAULT_TODAY;

function backlogSource(count) {
  const fixture = parity.makeFixture({ rows: count });
  const orders = parse.parseASASRows(fixture.asas).orders, antrepo = parse.parseAntrepoRows(fixture.antrepo);
  return { orders, source: { loadedAt: 'r1', asasOrders: orders, asasOrdersByTarget: { backlog: orders }, antrepoMap: antrepo, antrepoMapByTarget: { backlog: antrepo }, lflRows: [] } };
}
function scopeContext(orders, all) {
  const buyers = [...new Set(orders.map(order => order.buyer))].sort().slice(0, 2);
  return access.createAccessContext({ userId: 'a', systemRole: all ? 'moderator' : 'buyer', manageAll: all,
    viewScope: { all, mode: all ? 'ALL' : 'CUSTOM', buyers: all ? [] : buyers }, editScopes: { buyers },
    authority: Object.fromEntries(orders.map(order => [order.ocode, [order]])), profiles: [{ id: 'a', username: buyers[0] }] });
}
// Tarayıcıya giden satırlar: sunucu sözleşmesi + sunucu serileştirmesi.
function exportedRows({ orders, source }, scope) {
  const all = scope === 'all', ctx = scopeContext(orders, all);
  const custom = parse.backlogCustomDimensionContext(access.filterRows(ctx, orders), source.antrepoMap);
  const sourceColumns = all ? [] : custom.customDimensions.filter(column => column.source === 'asas').slice(0, 3).map(column => column.id);
  const out = tasks.buildBacklog('export', source, { access: ctx, overrides: {}, horizons: {}, headers: ['Demo'], sourceRevision: 'r', rowsRevision: 'r', calendar: { configured: false }, options: {}, sourceColumns });
  return { rows: JSON.parse(tasks.serialize(out)).rows, sourceColumns };
}
// item.row satırın kendisidir (girdi); karşılaştırma yalnız türetilen alanlar üzerinde.
const derived = items => items.map(({ row, ...item }) => item);
async function check(name, rows) {
  const result = await parity.assertParity({
    name, rows, context: { today: TODAY },
    legacy: (input, context) => derived(V3.normalizeRows(input, { ...context, compiledCanonical: false })),
    candidate: (input, context) => derived(V3.normalizeRows(input, { ...context, compiledCanonical: true })),
  });
  if (LOG) console.log(result.message, `rows=${rows.length}`);
  return result;
}

for (const count of COUNTS) {
  test(`Backlog V3 normalizeRows: şema başına kanonik erişim eski yolla aynı (${count} ASAS satırı, iki kapsam)`, { timeout: 600000 }, async () => {
    const data = backlogSource(count);
    const all = exportedRows(data, 'all'), scoped = exportedRows(data, 'custom');
    assert.ok(all.rows.length > count, 'ALL kapsamı operasyon satırlarını (parsiyel dahil) içerir');
    assert.ok(scoped.rows.length > 0 && scoped.rows.length < all.rows.length, 'CUSTOM kapsamı yalnız yetkili buyer satırlarını içerir');
    assert.ok(scoped.sourceColumns.length > 0, 'CUSTOM kapsamı farklı başlık şeması (ek ASAS sütunları) taşır');
    await check(`normalize all ${count}`, all.rows);
    await check(`normalize custom ${count}`, scoped.rows);
    // Toplulaştırma da aynı (Genel Bakış kutucukları, gruplar, zaman çizelgesi).
    for (const [scope, rows] of [['all', all.rows], ['custom', scoped.rows]]) {
      const summary = await parity.assertParity({
        name: `summary ${scope} ${count}`, rows, context: { today: TODAY },
        legacy: (input, context) => { const items = V3.normalizeRows(input, { ...context, compiledCanonical: false }); return { s: V3.summarize(items), g: V3.groupBy(items, 'buyer').map(({ items: _, ...g }) => g) }; },
        candidate: (input, context) => { const items = V3.normalizeRows(input, { ...context, compiledCanonical: true }); return { s: V3.summarize(items), g: V3.groupBy(items, 'buyer').map(({ items: _, ...g }) => g) }; },
      });
      if (LOG) console.log(summary.message, `rows=${rows.length}`);
    }
  });
}

test('Backlog V3 normalizeRows: karışık şema, token eşleşmesi, boş değer geri düşüşü ve geçersiz satır eski yolla aynı', async () => {
  const base = exportedRows(backlogSource(200), 'all').rows.slice(0, 60);
  const rows = base.map((row, index) => {
    const copy = { ...row };
    switch (index % 6) {
      case 1: // birebir anahtar yok → token eşleşmesi ('Sipariş Kod' → 'SIPARIS  KOD')
        copy['SIPARIS  KOD'] = copy['Sipariş Kod']; delete copy['Sipariş Kod']; break;
      case 2: // ilk bağlama anahtarı var ama boş → sonraki anahtara düşüş (Season → Sezon, C.Code → Renk Kod …)
        copy.Season = ''; copy.Manufacturer = null; copy['C.Code'] = undefined; copy['Order Code'] = ''; copy.Buyer = ''; break;
      case 3: // anahtar sırası farklı (aynı küme, başka şema)
        return Object.fromEntries(Object.entries(copy).reverse());
      case 4: // eksik alanlar
        delete copy['Üretici']; delete copy['Alt Üretici']; delete copy['ÖNEM ETİKETİ\n(IMPORTANCE)']; break;
      case 5: // ek kaynak sütunu (farklı şema uzunluğu)
        copy['ASAS · Extra'] = 'x' + index; break;
      default: break;
    }
    return copy;
  });
  rows.splice(7, 0, null, {}, { Buyer: 'Tek' });
  await check('normalize adversarial', rows);
});

test('Backlog V3 anahtarı varsayılan kapalı; bağlam ve window bayrağı açar/kapatır', () => {
  const previous = globalThis.BL_READ_MODEL_BACKLOG;
  try {
    delete globalThis.BL_READ_MODEL_BACKLOG;
    assert.equal(V3.readModelEnabled({}), false, 'varsayılan kapalı (Node: localStorage okunmaz)');
    globalThis.BL_READ_MODEL_BACKLOG = true;
    assert.equal(V3.readModelEnabled({}), true);
    assert.equal(V3.readModelEnabled({ compiledCanonical: false }), false, 'bağlam bayrağı window bayrağından önce gelir');
    globalThis.BL_READ_MODEL_BACKLOG = false;
    assert.equal(V3.readModelEnabled({}), false);
  } finally {
    if (previous === undefined) delete globalThis.BL_READ_MODEL_BACKLOG; else globalThis.BL_READ_MODEL_BACKLOG = previous;
  }
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'backlog-v3-report.js'), 'utf8');
  assert.match(src, /getItem\(BACKLOG_READ_MODEL_STORAGE_KEY\) === '1'/, 'tarayıcı yerel tercihi yalnız açıkça "1" ise açar');
});
