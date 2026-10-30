'use strict';

/* v7.81 (P6) — YENİLEME GRUPLARI.
 *
 * Korunan kusurlar:
 *
 * 1) Gruba yenilenemeyen bir modül konabilseydi (INTAKE kendi ayrı akışından
 *    gelir) kullanıcı "Yenile" der, hiçbir şey olmaz ve sebebini bulamazdı.
 *    Hedef listesi tek kanonik kaynaktan gelir.
 *
 * 2) Geçersiz grup SESSİZCE düşerse kullanıcı kaydettiğini sanır ve grubunu
 *    bulamaz. Kaydetmeden önce sebebi söylenir.
 *
 * 3) İkinci bir yenileme motoru yazmak (§9: aynı işlev için ikinci component
 *    üretme) — grup yalnız hedef listesi verir, akış mevcut olandır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-rg-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const groups = require('../server/lib/data-domain/refresh-groups');
const readiness = require('../server/lib/source-filter-readiness');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */

test('v7.81 gruba konabilen modüller /api/refresh ile AYNI listeden gelir', () => {
  /* Ayrı bir liste tutmak, gruba konabilen ama yenilenemeyen bir modül
     yaratırdı. Tek kanonik kaynak: source-filter-readiness. */
  assert.deepEqual(groups.refreshableModules(), readiness.SUPPORTED_TARGETS);

  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const filter = server.match(/rawTargets\.filter\(t => \[([^\]]+)\]\.includes\(String\(t\)\)\)/);
  assert.ok(filter, '/api/refresh hedef süzgeci bulunamadı');
  const accepted = filter[1].split(',').map(value => value.trim().replace(/^'|'$/g, '')).sort();
  assert.deepEqual(readiness.SUPPORTED_TARGETS.slice().sort(), accepted,
    'grup listesi ile /api/refresh’in kabul ettiği hedefler ayrışmış');
});

test('v7.81 INTAKE bir gruba konamaz ve sebebi söylenir', () => {
  const check = groups.validateGroups([{ name: 'Bütçe', moduleIds: ['intake'] }]);
  assert.equal(check.ok, false);
  assert.match(check.problems[0], /intake/);
  assert.match(check.problems[0], /kendi ekranlarından/);
  // Normalleştirme de onu düşürür.
  assert.deepEqual(groups.normalizeGroups([{ name: 'Bütçe', moduleIds: ['intake'] }]), []);
});

test('v7.81 adsız veya modülsüz grup kabul edilmez', () => {
  assert.equal(groups.validateGroups([{ name: '', moduleIds: ['cp'] }]).ok, false);
  assert.equal(groups.validateGroups([{ name: 'Boş', moduleIds: [] }]).ok, false);
  assert.match(groups.validateGroups([{ name: 'Boş', moduleIds: [] }]).problems[0], /hiç modül seçilmemiş/);
});

test('v7.81 aynı ad iki gruba verilemez', () => {
  const check = groups.validateGroups([
    { name: 'Buying Core', moduleIds: ['cp'] },
    { name: 'buying core', moduleIds: ['orders'] },
  ]);
  assert.equal(check.ok, false);
  assert.match(check.problems.join(' '), /birden fazla grupta/);
});

test('v7.81 modül sırası sabittir — seçim sırası hatırlanmak zorunda değil', () => {
  const a = groups.normalizeGroups([{ name: 'A', moduleIds: ['orders', 'cp', 'backlog'] }])[0];
  const b = groups.normalizeGroups([{ name: 'A', moduleIds: ['backlog', 'cp', 'orders'] }])[0];
  assert.deepEqual(a.moduleIds, b.moduleIds);
  // v20260928 — bağlı modüller (Orders · Backlog · LFL · Price & Supplier) tek
  // yenilemedir: gruba biri konunca hepsi gelir; sıra yine sabittir.
  assert.deepEqual(a.moduleIds, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
});

/* v20260929 — Tek yenileme motoru: gruba hangi modül konursa konsun (CP dahil)
   beş modül birlikte yenilenir; grup tanımı gerçekte ne yenilendiğini söyler. */
/* v20260930 — Tek motor geri alındı: bağlı gruptan bir modül konursa grup gelir;
   gruptan ayrı CP yalnız açıkça seçilirse (dar CP yenilemesi geniş grubu beklemez). */
/* v2026-10-30: Diğer modüllerden biri konursa grup CP ile birlikte gelir
   (Diğer modüller yenilenince CP de yenilenir); CP tek başına kalabilir. */
test('v2026-10-30 gruba Diğer modüllerden biri konursa bütün grup ve CP gelir; CP tek başına kalır', () => {
  assert.deepEqual(groups.normalizeGroups([{ name: 'L', moduleIds: ['lfl'] }])[0].moduleIds, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.deepEqual(groups.normalizeGroups([{ name: 'C', moduleIds: ['cp'] }])[0].moduleIds, ['cp']);
});

test('v7.81 tekrarlanan modül tek sayılır', () => {
  const group = groups.normalizeGroups([{ name: 'A', moduleIds: ['cp', 'cp', 'CP'] }])[0];
  assert.equal(new Set(group.moduleIds).size, group.moduleIds.length);
});

/* ------------------------------------------------------------------ */

test('v7.81 gruplar ORTAK ayarlarda, revizyon korumalı saklanır', () => {
  const saved = db.replaceRefreshGroups([
    { name: 'Buying Core', moduleIds: ['cp', 'orders'] },
    { name: 'Planlama', moduleIds: ['backlog', 'lfl'] },
  ], null);
  assert.equal(saved.items.length, 2);
  assert.ok(saved.revision > 0);

  const loaded = db.loadRefreshGroups();
  assert.deepEqual(loaded.items.map(group => group.name), ['Buying Core', 'Planlama']);
  assert.equal(loaded.revision, saved.revision);

  // Eski revizyonla yazmak reddedilmeli: iki yönetici birbirini ezmemeli.
  assert.throws(() => db.replaceRefreshGroups([{ name: 'X', moduleIds: ['cp'] }], saved.revision - 1));
});

test('v7.81 kimlikler kalıcıdır — kaydetmek grubun kimliğini değiştirmez', () => {
  db.replaceRefreshGroups([{ name: 'Sabit', moduleIds: ['cp'] }], null);
  const first = db.loadRefreshGroups();
  const id = first.items[0].id;
  const again = db.replaceRefreshGroups(first.items, first.revision);
  assert.equal(again.items[0].id, id, 'kimlik değişirse üstteki menünün bağlantısı kopar');
});

test('v7.81 targetsFor grubun hedeflerini verir', () => {
  const list = groups.normalizeGroups([{ id: 'rg_a', name: 'A', moduleIds: ['cp', 'lfl'] }]);
  assert.deepEqual(groups.targetsFor(list, 'rg_a'), ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'], 'CP + bağlı bir modül = CP + grup');
  assert.deepEqual(groups.targetsFor(list, 'yok'), []);
});

/* ------------------------------------------------------------------ */

/* v2026-10-30 — Adlandırılmış grup düzenleyicisi Veri Yönetimi'nden kalktı;
   yerini iki sabit ufkun Yenile düğmeleri aldı. Kural aynı: ikinci bir
   yenileme motoru yoktur, düğme yalnız hedef listesi verir. */
test('v7.81 ikinci bir yenileme motoru yazılmadı', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management.js'), 'utf8');
  const runner = ui.match(/function refreshHorizon\(groupId\) \{[\s\S]*?\n  \}/);
  assert.ok(runner, 'ufuk yenileme dalı bulunamadı');
  assert.match(runner[0], /window\.loadFromServer\(true, group\.targets\.slice\(\)\)/);
  // Kendi başına /api/refresh çağırmamalı.
  assert.doesNotMatch(ui, /fetch\(\s*['"`]\/api\/refresh/);
});

/* v20260929 — Gruplar üst menüde ayrı satır olarak GÖSTERİLMEZ; v20260930'dan
   beri menü satırları filtre bağından üretilir (bağlı grup · ayrı sayfalar · Tümü). */
test('v20260929 üst Yenile menüsünde grup satırı yoktur; satırlar filtre bağından gelir', () => {
  const appMain = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const menu = appMain.slice(appMain.indexOf('function openTopRefreshMenu'), appMain.indexOf('// Yenileme sürerken aynı düğmeye tekrar basmak'));
  assert.doesNotMatch(menu, /data-refresh-group="/);
  assert.match(menu, /const members=linkedRefreshMembers\(\);/);
  // Grup listesi menü için okunmaz; Veri Yönetimi kaydı önbellek kancasını çağırmaya devam eder.
  assert.doesNotMatch(appMain, /ensureRefreshGroupsLoaded/);
  assert.match(appMain, /window\.BLInvalidateRefreshGroups=/);
});

test('v2026-10-30 grup düzenleyicisi kalktı; kayıtlı gruplar sunucuda korunur', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management.js'), 'utf8');
  assert.doesNotMatch(ui, /data-new-group|data-run-group|async function saveGroups\(/);
  assert.doesNotMatch(ui, /\/api\/data-management\/refresh-groups/);
  const server = require('./helpers/server-source')();
  // Veri silinmez: uç ve depo yerinde durur, eski kayıtlar okunabilir.
  assert.match(server, /app\.get\('\/api\/data-management\/refresh-groups'/);
  db.replaceRefreshGroups([{ name: 'Korunan', moduleIds: ['cp'] }], null);
  assert.deepEqual(db.loadRefreshGroups().items.map(group => group.name), ['Korunan']);
});
