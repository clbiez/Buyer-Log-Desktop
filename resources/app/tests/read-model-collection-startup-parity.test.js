'use strict';
/* WS6e (#1079) yazma yolu parite kapısı: açılışta gizli Koleksiyon sekmesi çizilmez.
 *
 * Kök neden (CDP, 30k ASAS + 2k/10k Koleksiyon satırı): kolApplyWorkspace sekme gizliyken
 * de renderKol çağırıyordu (2k ~445 ms, 10k ~1,2 sn tek blok). renderKol'un kalıcı etkisi
 * yalnız çizimden önceki yazma ön adımıdır: syncKolPlmFromCp → kolSyncLicensorsFromRules →
 * kolSyncRulePricing({save:true}) → gerekirse saveKolRows. Yeni yol bu ön adımı aynı yerde
 * çalıştırır, yalnız çizimi sekmeye girişe bırakır.
 *
 * Burada app-main.js'teki GERÇEK fonksiyonlar vm'de çalışır: kolApplyWorkspace, taslak
 * geri yükleme, temel anlık görüntü, değişiklik farkı (PATCH yükü), saveKolRows, kayıt
 * kuyruğu, PLM/OPD, Licensor ve fiyat kuralı (Royalty/Hologram/FOB) senkronu ile
 * renderKol'un çizime kadar olan kısmı. Çizim gövdesi DOM'a bağlıdır; kalıcı yazma
 * içermediği kaynakta doğrulandı, burada "çizildi" olarak sayılır.
 * Karşılaştırılan kalıcı çıktı: BLStorage + localStorage yazmaları (sıra dahil), sunucuya
 * giden kayıt yükleri ve son satırlar; read-model-parity hash'iyle.
 * Tam kanıt: BL_COLLECTION_STARTUP_PARITY_ROWS=2000,10000 BL_COLLECTION_STARTUP_PARITY_LOG=1
 */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { extractFunction } = require('./helpers/app-main-functions');
const parity = require('./helpers/read-model-parity.cjs');
const Catalog = require('../public/collection-status-catalog.js');
const ModelGroups = require('../public/collection-model-groups.js');
const { buildCollectionRows } = require('../scripts/lib/erp-collection-fixture');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const COUNTS = String(process.env.BL_COLLECTION_STARTUP_PARITY_ROWS || '2000').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
const LOG = process.env.BL_COLLECTION_STARTUP_PARITY_LOG === '1';
// Fark raporu yalnız mesajla atılır: hata nesnesindeki ayrışan alt ağaç (tüm kayıt yükü)
// test raporlayıcısında serileştirilince süreç belleği tükeniyordu.
const check = async spec => {
  const result = await parity.compareParity(spec);
  if (LOG) console.log(result.message, `rows=${spec.rows.length}`);
  if (!result.equal) throw new Error(result.message);
  return result;
};

const REAL = [
  'kolApplyWorkspace', 'kolRestorePendingWorkspace', 'kolReadPendingWorkspace', 'kolClearPendingWorkspace', 'kolHasDirtyWorkspace',
  'kolMergePendingWorkspace', 'kolRowChangedFromBase', 'kolCloneConflictValue', 'kolMergeLocalRowDelta', 'kolPersistPendingWorkspace',
  'kolWorkspaceLocalKey', 'kolWorkspacePendingKey', 'kolCaptureBaseline', 'kolStructureSignature', 'kolRowKey', 'kolRowEqual', 'kolValueEqual',
  'kolPersistableRow', 'kolCollectChanges', 'kolManufacturersForPersistence', 'kolNormalizeStatusCatalog', 'kolStatusEntries',
  'kolNormalizeLflCountryExclusions', 'kolNormalizeModelGroups', 'kolNormalizeCustomCols', 'saveKolRows', 'kolQueueWorkspaceSave',
  'syncKolPlmFromCp', 'sameOrderCode', 'kolSyncLicensorsFromRules', 'kolApplyLicensorFromLicense', 'kolSyncRulePricing', 'kolApplyRulePricing',
  'kolComputeFobFromConfirmed', 'kolSuppFob', 'kolLandedIsNonDtr', 'editableValuesEqual', 'norm', 'currentActiveTab',
  'kolStartupDeferEnabled', 'kolDeferHiddenRender',
];
// renderKol'un gerçek kaynağı, çizim gövdesinin başladığı satıra kadar.
const DRAW_MARKER = '  kolRenderDeferred=false;\n';
function renderKolPrefix() {
  const full = extractFunction(SOURCE, 'renderKol');
  const at = full.indexOf(DRAW_MARKER);
  assert.ok(at > 0, 'renderKol çizim başlangıcı (kolRenderDeferred=false) bulunmalı');
  return full.slice(0, at + DRAW_MARKER.length) + '  __draw();\n}';
}

// Sentetik kural tablosu: Licensor A tüm ülkelerde, B yalnız bazı ülkelerde, C hiç (Non-DTR + kural yok → FOB boş).
const RULE_COUNTRIES = { 'Licensor A': null, 'Licensor B': new Set(['Turkey', 'China', 'Egypt']) }; // i18n-ignore — sentetik veri
const AUTO_LICENSOR = { 'LIC-A': 'Licensor A', 'LIC-B': 'Licensor B', 'LIC-C': 'Licensor C' }; // i18n-ignore — sentetik veri
const parseNum = value => {
  if (value === '' || value == null) return NaN;
  const n = Number(String(value).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

function workspaceRows(count) {
  const rows = buildCollectionRows(count, 7);
  rows.forEach((row, i) => {
    // PLM/OPD: CP'den doldurulacak satırlar.
    if (i % 3 === 0) { row.plmId = ''; row._sourceOrderCode = 'OC-' + (100000 + i); }
    if (i % 5 === 0) { row._sourceOrderCode = row._sourceOrderCode || 'OC-' + (100000 + i); row.opd = ''; }
    // Licensor: boş bırakılmış lisanslı satırlar otomatik dolar; bazıları elle seçilmiş.
    if (row.lisans && i % 4 === 0) row.licensor = '';
    if (row.lisans && i % 11 === 0) row._licensorManual = true;
    // Eski türetilmiş değerler ve kaldırılmış alan: fiyat kuralı bunları düzeltir.
    if (i % 2 === 0) { row.royalty = '7.00%'; row.fob = '1.00'; }
    if (i % 9 === 0) row.suppFob = '9.99';
    if (i % 6 === 0) row.confirmedManufacturer = Object.keys(row.pricing)[0] || '';
    // Hesabı zaten güncel satırlar da olsun.
    if (i % 13 === 0) row._pricingRuleId = 'stale';
  });
  return rows;
}
function cpRows(count) {
  const out = [];
  for (let i = 0; i < count; i += 3) out.push({ 'Order Code': 'OC-' + (100000 + i), 'PLM ID': String(3100000 + i), OPD: i % 2 ? '2026-03-0' + (1 + (i % 9)) : '' });
  for (let i = 0; i < count; i += 5) out.push({ 'Order Code': 'OC-' + (100000 + i), 'PLM ID': '', OPD: '2026-04-1' + (i % 10) });
  return out;
}
function pendingDraft(rows) {
  const edited = rows.slice(0, Math.min(rows.length, 40)).map((row, i) => ({ ...row, not: 'yerel taslak ' + i, ...(i % 2 ? { targetPrice: '15.00' } : {}) }));
  return { schemaVersion: 2, ownerId: 'owner', status: 'pending', baseRevision: 3, baseRows: rows.slice(0, edited.length).map(row => ({ ...row })),
    rows: [...edited, ...rows.slice(edited.length)], manufacturers: [], customColumns: [], statusCatalog: [], nextId: rows.length + 1 };
}

/* Tek açılış senaryosu. flag=false eski yol (gizli sekmede de çizer), true yeni yol. */
function boot({ flag, rows, activeTab = 'overview', canEdit = true, draft = null, openLater = false, cp = null }) {
  const writes = [], saves = [], timers = new Map();
  let timerSeq = 0, draws = 0;
  const store = new Map();
  if (draft) store.set('bl.collection.pending.owner.v1', JSON.stringify(draft));
  const record = (area, key, value) => {
    let stored = value;
    if (typeof value === 'string' && value.includes('"updatedAt"')) { const parsed = JSON.parse(value); delete parsed.updatedAt; stored = parsed; }
    writes.push([area, key, typeof stored === 'string' ? parity.canonicalHash(stored) : stored]);
  };
  const ctx = {
    window: { BL_READ_MODEL_COLLECTION_STARTUP: flag, BLCollectionModelGroups: ModelGroups },
    document: { body: { dataset: { activeTab } }, getElementById: id => (id === 'kolTable' ? {} : null), querySelector: () => null },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); record('local', key, String(value)); },
      removeItem: key => { store.delete(key); writes.push(['local-remove', key]); },
    },
    BLStorage: { setItem: (key, value) => record('bl', key, String(value)) },
    setTimeout: fn => { const id = ++timerSeq; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
    KOL_STATUS_API: Catalog, KOL_STORAGE_KEY: 'lcw.koleksiyon.rows.v1', KOL_COLS: [{ k: 'modelKod' }, { k: 'durum' }],
    KOL_STARTUP_DEFER_STORAGE_KEY: 'buyerlog.readModel.collectionStartup.v1', kolStartupDeferEnabledCache: null, kolRenderDeferred: false,
    kolWorkspaceOwnerId: 'owner', kolWorkspaceMode: 'single', kolWorkspaceSelectedOwnerIds: new Set(), kolWorkspaceRevision: 0,
    kolWorkspaceCanEdit: false, kolWorkspaceSaving: false, kolWorkspaceSaveTimer: null, kolBulkPreparing: false, kolBaseline: null,
    kolRows: [], kolManufacturers: [], kolCustomCols: [], kolStatusCatalog: [], kolLflCountryExclusions: [], kolLflCountryExclusionsByOwner: new Map(),
    kolNextId: 1, kolSelected: new Set(), kolUndoStack: [], kolRedoStack: [], kolRemoteRenderPendingOwner: '',
    kolSaveFeedbackByOwner: new Map(), appLang: 'tr',
    state: { cp: cp ? { rows: cp } : null },
    // Sınırın dışındaki, iki yolda da aynı çalışan yardımcılar.
    migrateKolRow: row => { if (!row.pricing) row.pricing = {}; if (row.confirmedManufacturer == null) row.confirmedManufacturer = ''; return row; },
    turknorm: value => String(value == null ? '' : value).trim().toUpperCase(),
    toISODate: value => String(value || '').slice(0, 10),
    refreshSubmfrList: () => {}, loadKolColState: () => {}, kolWorkspaceSetReadonly: () => {}, scheduleOverviewCollectionSummaryRender: () => {},
    kolSetSaveFeedback: () => {}, kolRenderSaveFeedback: () => {}, showToast: message => { throw new Error('beklenmeyen uyarı: ' + message); },
    kolHasActiveRowEditor: () => false,
    kolAutoLicensorState: row => ({ displayValue: AUTO_LICENSOR[String(row && row.lisans || '').trim()] || '', status: 'resolved' }),
    kolLicensorUnresolvedState: row => (row && row.lisans === 'LIC-C' && !String(row.licensor || '').trim() ? { status: 'ambiguous' } : null),
    kolFindPricingRule: row => {
      const licensor = String(row && row.licensor || '').trim(), country = String(row && row.country || '').trim();
      if (!row || !row.lisans || !(licensor in RULE_COUNTRIES)) return null;
      const allowed = RULE_COUNTRIES[licensor];
      if (allowed && !allowed.has(country)) return null;
      return { id: 'rule-' + licensor.slice(-1) + '-' + country, royalty: licensor.endsWith('A') ? 10 : 12.5, hologramCost: licensor.endsWith('A') ? 0.1 : 0.05 };
    },
    kolParseMoneyNum: parseNum,
    kolConfirmedPricing: row => { const name = String(row.confirmedManufacturer || '').trim(), price = parseNum(row.pricing && row.pricing[name]); return name && price > 0 ? { name, price } : null; },
    kolBestPricing: row => { let out = null; Object.entries(row.pricing || {}).forEach(([name, raw]) => { const p = parseNum(raw); if (p > 0 && (!out || p < out.price)) out = { name, price: p }; }); return out; },
    kolFormatPercentDisplay: value => `${Number(value).toFixed(2)}%`,
    kolFormatHologramDisplay: value => Number(value).toFixed(2),
    kolFormatMoneyDisplay: value => Number(String(value).replace(',', '.')).toFixed(2),
    coerceDateLoose: value => (value instanceof Date ? value : new Date(value)),
    __draw: () => { draws++; },
  };
  // Sunucu kaydı: gönderilen PATCH yükü kaydedilir ve onay temeli günceller (gerçek akıştaki gibi).
  ctx.kolSaveWorkspaceNow = async () => {
    ctx.kolWorkspaceSaveTimer = null;
    const change = ctx.kolCollectChanges();
    saves.push(change && change.empty ? { empty: true } : JSON.parse(JSON.stringify(change)));
    if (change && !change.empty) ctx.kolCaptureBaseline();
    return { ok: true };
  };
  vm.createContext(ctx);
  vm.runInContext(REAL.map(name => extractFunction(SOURCE, name)).join('\n') + '\n' + renderKolPrefix(), ctx, { filename: 'app-main.js (WS6e seçili fonksiyonlar)' });
  const flush = async () => { while (timers.size) { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); } };
  return (async () => {
    ctx.kolApplyWorkspace({ _revision: 3, rows, manufacturers: [{ name: 'MFR-01' }], customColumns: [], statusCatalog: [], nextId: rows.length + 1 }, { canEdit });
    const deferredAfterStartup = ctx.kolRenderDeferred, drawsAtStartup = draws;
    await flush();
    const startup = { writes: writes.slice(), saves: saves.slice(), rows: ctx.kolRows.map(ctx.kolPersistableRow) };
    if (openLater) {
      // switchTab('koleksiyon') ilk girişte profil uygulandıktan sonra renderKol çağırır.
      ctx.document.body.dataset.activeTab = 'koleksiyon';
      vm.runInContext('renderKol()', ctx);
      await flush();
    }
    return { startup, final: { writes, saves, rows: ctx.kolRows.map(ctx.kolPersistableRow) }, drawsAtStartup, draws, deferredAfterStartup, renderDeferred: ctx.kolRenderDeferred };
  })();
}

for (const count of COUNTS) {
  test(`WS6e: sekme hiç açılmasa da fiyat kuralı sonucu ve kalıcı kayıt eski yolla aynı (${count} satır)`, async () => {
    const rows = workspaceRows(count), context = { cp: cpRows(count) };
    let legacyRun, candidateRun;
    const result = await check({
      name: `startup hidden never-opened ${count}`, rows, context,
      legacy: async (r, c) => (legacyRun = await boot({ flag: false, rows: r, cp: c.cp })).startup,
      candidate: async (r, c) => (candidateRun = await boot({ flag: true, rows: r, cp: c.cp })).startup,
    });
    assert.ok(result.equal);
    // Senaryo gerçekten yazıyor: fiyat/Licensor/PLM değişiklikleri tek kayıtta sunucuya gider.
    assert.equal(candidateRun.startup.saves.length, 1, 'açılış senkronu bir kez kaydedilmeli');
    assert.ok(candidateRun.startup.saves[0].upserts.length > count / 3, 'kayıt fiyat kuralı değişikliklerini taşımalı');
    assert.ok(candidateRun.startup.writes.some(([area]) => area === 'bl'), 'saveKolRows yerel kopyayı yazmalı');
    // Fark yalnız çizimde: eski yol gizli sekmeyi çizer, yeni yol çizmez ve ertelendiğini işaretler.
    assert.equal(legacyRun.drawsAtStartup, 1);
    assert.equal(candidateRun.drawsAtStartup, 0);
    assert.equal(candidateRun.deferredAfterStartup, true);
  });

  test(`WS6e: sekme sonradan açılınca tek çizim, ek kayıt yok; kalıcı çıktı eşit (${count} satır)`, async () => {
    const rows = workspaceRows(count), context = { cp: cpRows(count) };
    let candidateRun;
    await check({
      name: `startup hidden then opened ${count}`, rows, context,
      legacy: async (r, c) => (await boot({ flag: false, rows: r, cp: c.cp, openLater: true })).final,
      candidate: async (r, c) => (candidateRun = await boot({ flag: true, rows: r, cp: c.cp, openLater: true })).final,
    });
    assert.equal(candidateRun.draws, 1);
    assert.equal(candidateRun.renderDeferred, false);
    // Hash ile: büyük yük farkının tam dökümü raporlayıcıda belleği tüketir.
    assert.equal(candidateRun.final.saves.length, candidateRun.startup.saves.length, 'sekme açılışı ikinci kayıt üretmemeli (ön adım idempotent)');
    assert.equal(parity.canonicalHash(candidateRun.final.saves), parity.canonicalHash(candidateRun.startup.saves));
  });
}

test('WS6e: bekleyen yerel taslak geri yüklemesi ve kaydı iki yolda aynı', async () => {
  const rows = workspaceRows(600), context = { cp: cpRows(600), draft: pendingDraft(workspaceRows(600)) };
  let candidateRun;
  await check({
    name: 'startup pending draft', rows, context,
    legacy: async (r, c) => (await boot({ flag: false, rows: r, cp: c.cp, draft: c.draft })).startup,
    candidate: async (r, c) => (candidateRun = await boot({ flag: true, rows: r, cp: c.cp, draft: c.draft })).startup,
  });
  assert.ok(candidateRun.startup.saves[0].upserts.some(row => String(row.not).startsWith('yerel taslak')), 'taslak satırları kayıtta korunmalı');
  assert.equal(candidateRun.drawsAtStartup, 0);
});

test('WS6e: salt okunur çalışma alanı iki yolda da yazmaz; sekme görünürken yeni yol eskisi gibi hemen çizer', async () => {
  const rows = workspaceRows(300), context = { cp: cpRows(300) };
  for (const canEdit of [false, true]) {
    for (const activeTab of ['overview', 'koleksiyon']) {
      let legacyRun, candidateRun;
      await check({
        name: `startup canEdit=${canEdit} tab=${activeTab}`, rows, context,
        legacy: async (r, c) => (legacyRun = await boot({ flag: false, rows: r, cp: c.cp, canEdit, activeTab })).startup,
        candidate: async (r, c) => (candidateRun = await boot({ flag: true, rows: r, cp: c.cp, canEdit, activeTab })).startup,
      });
      if (!canEdit) assert.equal(candidateRun.startup.saves.length, 0);
      assert.equal(legacyRun.drawsAtStartup, 1);
      assert.equal(candidateRun.drawsAtStartup, activeTab === 'koleksiyon' ? 1 : 0);
    }
  }
});

test('WS6e: anahtar varsayılan açık; window ve localStorage ile geri dönüş', async () => {
  const load = (windowValue, stored) => {
    const ctx = { window: windowValue === undefined ? {} : { BL_READ_MODEL_COLLECTION_STARTUP: windowValue }, localStorage: { getItem: key => (key === 'buyerlog.readModel.collectionStartup.v1' ? stored : null) },
      KOL_STARTUP_DEFER_STORAGE_KEY: 'buyerlog.readModel.collectionStartup.v1', kolStartupDeferEnabledCache: null };
    vm.createContext(ctx);
    vm.runInContext(extractFunction(SOURCE, 'kolStartupDeferEnabled'), ctx);
    return ctx.kolStartupDeferEnabled();
  };
  assert.equal(load(undefined, null), true);
  assert.equal(load(undefined, '0'), false);
  assert.equal(load(undefined, '1'), true);
  assert.equal(load(false, null), false);
  assert.equal(load(true, '0'), true);
});

test('WS6e: kaynak sözleşmesi — erteleme yazma ön adımından ve aktif editör kontrolünden sonra; sekmeye girişte çizilir', () => {
  const render = extractFunction(SOURCE, 'renderKol');
  const sync = render.indexOf('kolSyncRulePricing({save:true})'), editor = render.indexOf('if(kolHasActiveRowEditor())'), defer = render.indexOf('if(kolDeferHiddenRender())return;');
  assert.ok(sync > 0 && editor > sync && defer > editor, 'sıra: yazma ön adımı → aktif editör → gizli sekme ertelemesi');
  assert.match(SOURCE, /var KOL_STARTUP_DEFER_STORAGE_KEY='buyerlog\.readModel\.collectionStartup\.v1';\nvar kolStartupDeferEnabledCache=null;\nvar kolRenderDeferred=false;/);
  const switchTab = extractFunction(SOURCE, 'switchTab');
  assert.match(switchTab, /else if\(tab==='koleksiyon'&&kolRenderDeferred&&!profileFirstVisit&&typeof renderKol==='function'\)renderKol\(\);/);
  // İlk giriş yolu profil sonrası renderKol çağırmaya devam eder (ertelenen çizimi o yapar).
  assert.match(switchTab, /tab==='koleksiyon'&&profileFirstVisit[\s\S]*?applyStoredProfilesForCurrentPage\(true\);renderKol\(\);/);
  // kolApplyWorkspace çağrı sırası değişmedi: temel → taslak → renderKol (kayıp güncelleme koruması).
  const apply = extractFunction(SOURCE, 'kolApplyWorkspace');
  assert.ok(apply.indexOf('kolCaptureBaseline();') < apply.indexOf('if(!kolRestorePendingWorkspace())renderKol();'));
});
