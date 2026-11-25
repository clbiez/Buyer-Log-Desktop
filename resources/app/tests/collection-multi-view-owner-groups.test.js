'use strict';
// Çoklu Koleksiyon görünümü sahipleri birbirine karıştırmaz. modelGroupId satır
// kimliğinden türetilir (mg_single_<hash(id)>); her buyer'ın satır kimlikleri 1'den
// başladığı için iki sahibin 1 numaralı satırı aynı grup kimliğini taşır. Birleşik
// görünümde kolNormalizeModelGroups bunları tek modelde birleştiriyordu: B'nin
// satırı A'nın modelinin "renk varyantı" olup A'nın model adını/fiyatını, kendi
// görselini gösteriyordu (gerçek tarayıcı kanıtı:
// scripts/multiuser-collection-pricing-e2e.js, X1 kullanıcısı).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const groups = require('../public/collection-model-groups.js');
const source = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const start = source.indexOf('function kolApplyCombinedWorkspaces(items){');
const end = source.indexOf('\nasync function kolLoadWorkspaceBatch(', start);
const normalizer = source.slice(source.indexOf('function kolNormalizeModelGroups(rows){'), source.indexOf('\nfunction kolLinkImportedColourVariants('));

function combine(items) {
  const noop = () => {};
  const ctx = {
    window: { BLCollectionModelGroups: groups }, kolSelected: new Set(), kolRows: [],
    migrateKolRow: row => row, kolNormalizeLflCountryExclusions: value => value || [], norm: v => String(v || '').trim(),
    KOL_STATUS_API: { normalize: () => [] }, kolNormalizeCustomCols: cols => cols,
    refreshSubmfrList: noop, loadKolColState: noop, kolWorkspaceSetReadonly: noop, renderKol: noop, renderKolScopeFilters: noop, scheduleOverviewCollectionSummaryRender: noop,
  };
  vm.createContext(ctx);
  vm.runInContext(`var kolWorkspaceMode,kolWorkspaceOwnerId,kolWorkspaceRevision,kolWorkspaceCanEdit,kolLflCountryExclusions,kolLflCountryExclusionsByOwner,kolStatusCatalog,kolManufacturers,kolCustomCols,kolNextId,kolUndoStack,kolRedoStack;\n${normalizer}\n${source.slice(start, end)}\nthis.run=items=>{kolApplyCombinedWorkspaces(items);return kolRows;};`, ctx);
  return JSON.parse(JSON.stringify(ctx.run(items)));
}
// Her sahibin kendi kaydettiği satırlar (kendi sayfasında normalize edilmiş).
const ownerRows = (key, extra = {}) => groups.normalizeRows([1, 2].map(id => ({ id, plmId: `P-${key}-${id}`, modelKod: `M-${key}-${id}`, colourCode: `C${key}${id}`, img: `/img/${key}${id}`, ...extra }))).rows;

test('kaynak blokları bulunur', () => { assert.ok(start > 0 && end > start && normalizer.length > 50); });

test('farklı sahiplerin aynı kimlikli satırları ayrı modeller kalır', () => {
  const a = ownerRows('A'), b = ownerRows('B');
  assert.equal(a[0].modelGroupId, b[0].modelGroupId, 'ön koşul: kaydedilmiş grup kimlikleri çakışır');
  const rows = combine([{ owner: { id: 'owner-a', displayName: 'A' }, workspace: { rows: a } }, { owner: { id: 'owner-b', displayName: 'B' }, workspace: { rows: b } }]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.modelGroupRole), ['single', 'single', 'single', 'single']);
  assert.equal(new Set(rows.map(r => r.modelGroupId)).size, 4);
  // Her satır kendi model adını gösterir (başka sahibin "ana modeli" değerleri devralınmaz).
  for (const row of rows) assert.equal(groups.effectiveValue(row, 'modelKod', rows), row.modelKod);
});

test('aynı PLM kimliğine sahip iki sahibin grupsuz satırları birleşik görünümde gruplanmaz', () => {
  const plain = key => [1, 2].map(id => ({ id, plmId: 'SAME', modelKod: 'SAME MODEL', inStoreMonth: '2026-10', colourCode: `C${key}${id}` }));
  const rows = combine([{ owner: { id: 'owner-a' }, workspace: { rows: plain('A') } }, { owner: { id: 'owner-b' }, workspace: { rows: plain('B') } }]);
  const byOwner = new Map();
  for (const row of rows) { const set = byOwner.get(row.modelGroupId) || new Set(); set.add(row._collectionOwnerId); byOwner.set(row.modelGroupId, set); }
  for (const owners of byOwner.values()) assert.equal(owners.size, 1, 'bir model grubu tek sahibe aittir');
});

test('sahip içindeki renk grubu korunur', () => {
  const a = groups.normalizeRows([1, 2].map(id => ({ id, plmId: 'P1', modelKod: 'M1', inStoreMonth: '2026-10', colourCode: 'C' + id }))).rows;
  const rows = combine([{ owner: { id: 'owner-a' }, workspace: { rows: a } }]);
  assert.deepEqual(rows.map(r => r.modelGroupRole), ['parent', 'variant']);
  assert.equal(rows[0].modelGroupId, rows[1].modelGroupId);
});
