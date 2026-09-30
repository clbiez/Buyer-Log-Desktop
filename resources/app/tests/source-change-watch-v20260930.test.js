'use strict';

/* v20260930 — KAYNAK DEĞİŞİNCE OTOMATİK GÜNCELLEME.
 *
 * Kullanıcı: "Program sürekli database'i tarasın, yeni veri varsa getirsin;
 * buyer refresh yapmak veya refresh beklemek zorunda kalmasın." ASAS modeli
 * günde ~3 kez (9/12/15) işleniyor.
 *
 * Korunan kusurlar:
 *  1) Ağır ASAS sorgusu periyodik ATILMAZ; yalnız modelin son işlenme zamanı
 *     (metadata) okunur ve kısa aralıkta tekrar sorulursa önbellekten döner.
 *  2) Yalnız CP yenilendiyse bağlı grup "güncel" sayılmamalı (temel çizgi sayfa başına).
 *  3) Metadata okunamazsa (yetki) uygulama eskisi gibi çalışır; sinyal "desteklenmiyor" olur.
 *  4) İkinci bir yenileme motoru yazılmaz: istemci mevcut loadFromServer akışını çağırır,
 *     kullanıcı hücre düzenlerken / pencere açıkken araya girmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const watch = require('../server/lib/source-change-watch');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const APP = read('public/app-main.js');
const DM = read('public/data-management.js');
const SERVER = read('server/server.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-source-watch-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const ASAS = { id: 'mc_asas', role: 'asas', refreshEnabled: true, server: 'srv', catalog: 'ASAS' };

function harness(stampRef, extra = {}) {
  const calls = [];
  let clock = Date.parse('2026-09-30T09:00:00Z');
  const instance = watch.createSourceChangeWatch({
    stateFile: path.join(root, `${Math.random().toString(36).slice(2)}.json`),
    now: () => clock,
    runModelRows: async input => {
      calls.push(input.query);
      if (extra.fail && extra.fail(input.query)) throw new Error('needs to be an administrator');
      return { rows: [{ CUBE_NAME: 'Model', LAST_DATA_UPDATE: stampRef.value }, { CUBE_NAME: 'Persp', LAST_DATA_UPDATE: '2026-09-29T15:00:00' }] };
    },
  });
  return { instance, calls, advance: ms => { clock += ms; } };
}

test('damga: satırlardaki en yeni zaman; çözülemeyen biçimde de değişiklik yakalanır', () => {
  assert.equal(watch.extractStamp([{ LAST_DATA_UPDATE: '2026-09-30T09:01:00' }, { LAST_DATA_UPDATE: '2026-09-30T12:02:00' }], 'LAST_DATA_UPDATE'), '2026-09-30T12:02:00');
  assert.equal(watch.extractStamp([{ X: 'b' }, { X: 'a' }], 'X'), 'a|b');
  assert.equal(watch.extractStamp([], 'X'), '');
});

test('yalnız Database ASAS bağlantısı izlenir', () => {
  assert.equal(watch.selectAsasConnection([{ role: 'antrepo', server: 's', catalog: 'c' }]), null);
  assert.equal(watch.selectAsasConnection([{ ...ASAS, refreshEnabled: false }]), null);
  assert.equal(watch.selectAsasConnection([ASAS]).id, 'mc_asas');
});

test('ilk kullanımda değişiklik sayılmaz; yenileme temel çizgiyi kurar; model işlenince fark görülür', async () => {
  const stamp = { value: '2026-09-30T09:05:00' };
  const { instance, advance } = harness(stamp);
  const first = await instance.status('u1', [ASAS]);
  assert.equal(first.supported, true);
  assert.equal(first.changed, false, 'temel çizgi yokken bütün sayfalar boşuna yenilenmemeli');

  instance.recordRefresh('u1', ASAS, stamp.value, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.equal((await instance.status('u1', [ASAS], { force: true })).changed, false);

  stamp.value = '2026-09-30T12:03:00';
  advance(watch.MIN_PROBE_INTERVAL_MS + 1);
  const after = await instance.status('u1', [ASAS]);
  assert.equal(after.changed, true);
  assert.deepEqual(after.changedTargets, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
});

test('temel çizgi sayfa başınadır: yalnız CP yenilendiyse bağlı grup hâlâ değişmiş sayılır', async () => {
  const stamp = { value: '2026-09-30T09:05:00' };
  const { instance } = harness(stamp);
  instance.recordRefresh('u2', ASAS, stamp.value, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  stamp.value = '2026-09-30T12:03:00';
  instance.recordRefresh('u2', ASAS, stamp.value, ['cp']);
  const status = await instance.status('u2', [ASAS], { force: true });
  assert.deepEqual(status.changedTargets, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  // Kullanıcılar birbirini etkilemez.
  assert.equal((await instance.status('someone-else', [ASAS])).changed, false);
});

test('metadata kısa aralıkta tekrar sorgulanmaz; eşzamanlı istekler tek sorgu', async () => {
  const stamp = { value: '2026-09-30T09:05:00' };
  const { instance, calls, advance } = harness(stamp);
  await Promise.all([instance.probe(ASAS), instance.probe(ASAS), instance.probe(ASAS)]);
  assert.equal(calls.length, 1);
  advance(60 * 1000);
  assert.equal((await instance.probe(ASAS)).cached, true);
  assert.equal(calls.length, 1);
  advance(watch.MIN_PROBE_INTERVAL_MS);
  await instance.probe(ASAS);
  assert.equal(calls.length, 2);
  // Yalnız metadata görünümleri sorgulanır; veri sorgusu (EVALUATE) atılmaz.
  assert.ok(calls.every(query => /\$SYSTEM\.(MDSCHEMA_CUBES|DBSCHEMA_CATALOGS)/.test(query)));
});

test('ilk görünüm okunamazsa sıradaki denenir; hiçbiri okunamazsa desteklenmiyor', async () => {
  const stamp = { value: '2026-09-30T09:05:00' };
  const rows = [{ CATALOG_NAME: 'ASAS', DATE_MODIFIED: '2026-09-30T09:05:00' }];
  const inst = watch.createSourceChangeWatch({
    runModelRows: async input => {
      if (/MDSCHEMA_CUBES/.test(input.query)) throw new Error('denied');
      return { rows };
    },
  });
  const probed = await inst.probe(ASAS);
  assert.equal(probed.ok, true);
  assert.equal(probed.method, 'dbschema-catalogs');

  const none = harness(stamp, { fail: () => true });
  const status = await none.instance.status('u3', [ASAS]);
  assert.equal(status.supported, false);
  assert.equal(status.changed, false);
  assert.match(status.error, /administrator/);
});

test('sunucu: damga yenilemenin başında okunur, veri yayınlandıktan sonra temel çizgi olur', () => {
  assert.match(SERVER, /const \{ createSourceChangeWatch \} = require\('\.\/lib\/source-change-watch'\);/);
  const perform = SERVER.slice(SERVER.indexOf('async function performRefresh('), SERVER.indexOf('async function performRefresh(') + 12000);
  const probeAt = perform.indexOf('sourceChangeWatch.probe(watchItem, { force: true })');
  const loadAt = perform.indexOf('await loadFromModels(id, targets');
  const publishAt = perform.indexOf("() => publishRefreshedRuntime(id, staged));");
  const recordAt = perform.indexOf('sourceChangeWatch.recordRefresh(id, watchItem, probed.stamp, requestedTargets)');
  assert.ok(probeAt > 0 && probeAt < loadAt, 'damga ağır sorgudan önce okunmalı');
  assert.ok(publishAt > 0 && recordAt > publishAt, 'temel çizgi yalnız başarılı yayından sonra ilerler');
  assert.match(SERVER, /app\.get\('\/api\/source-watch', userAccess\.requireArea\('source'\), async \(req, res\) => \{/);
  assert.match(SERVER, /reason: 'asas-excel'/);
});

test('istemci: izleyici mevcut yenileme akışını kullanır, kullanıcıyı bölmez, CP önce gelir', () => {
  const block = APP.slice(APP.indexOf("const SOURCE_WATCH_KEY='bl.autoRefresh.sourceWatch.v1';"), APP.indexOf('function sourceWatchLabel(){'));
  assert.ok(block.length > 0);
  assert.match(block, /fetchJSON\('\/api\/source-watch'/);
  assert.match(block, /const ok=await loadFromServer\(true,unit\);/);
  assert.match(block, /const blocked=autoRefreshBlockedReason\(\);/);
  assert.match(block, /if\(autoRefreshBlockedReason\(\)\)break;/);
  assert.match(block, /units\.push\(members\.includes\(target\)\?members\.slice\(\):\[target\]\);/);
  assert.match(block, /\(a==='cp'\?-1:0\)-\(b==='cp'\?-1:0\)/);
  assert.doesNotMatch(block, /fetch\(\s*['"`]\/api\/refresh/, 'ikinci bir yenileme motoru yazılmadı');
  // Varsayılan açık; tercih kullanıcı tercihleriyle senkronlanan bl.autoRefresh. önekinde.
  assert.match(block, /return BLStorage\.getItem\(SOURCE_WATCH_KEY\)!=='0';/);
  assert.match(DM, /id="sourceWatchToggle"/);
  assert.match(DM, /const on = setSourceWatchEnabled\(event\.target\.checked\);/);
});
