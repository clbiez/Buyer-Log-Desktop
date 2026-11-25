'use strict';
// Çoklu (salt okunur) Koleksiyon görünümü canlı güncellenir: görüntüleme izinli
// kullanıcı başka bir sahibin Koleksiyonunu ancak "Görünüm ve Yetkiler" ile
// kendi sayfasının yanına ekleyerek görebilir (kolWorkspaceOwnerId='__multi__').
// Sahibin kaydı SSE 'collection' olayıyla gelir; eskiden kolHandleRemoteChange
// sahip kimliği '__multi__' ile eşleşmediği için olayı sessizce atıyordu ve
// görüntüleyen kullanıcı fiyat/onay değişikliğini sayfayı yenileyene kadar
// görmüyordu (gerçek tarayıcı kanıtı: scripts/multiuser-collection-pricing-e2e.js).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const start = source.indexOf('let kolRemoteChangeNoticeShown=false;');
const end = source.indexOf('\n/* ===================================================================\n   v7.19 — EKİP ARKADAŞININ', start);

function fixture({ mode = 'multi', selected = ['me', 'owner'], editor = false } = {}) {
  const calls = { batch: [], single: [], timers: [] };
  const ctx = {
    kolWorkspaceMode: mode,
    kolWorkspaceOwnerId: mode === 'multi' ? '__multi__' : 'me',
    kolWorkspaceSelectedOwnerIds: new Set(selected),
    kolWorkspaceSaving: false, kolWorkspaceSaveTimer: 0,
    kolRemoteReloadPendingOwner: '', kolSelected: new Set(),
    kolHasDirtyWorkspace: () => false,
    kolHasActiveWorkspaceEditor: () => editor,
    kolApplyRemotePatches: () => 0,
    kolPersistPendingWorkspace: () => {},
    kolRowIndexById: () => -1,
    kolLoadWorkspace: async owner => { calls.single.push(owner); return true; },
    kolLoadWorkspaceBatch: async ids => { calls.batch.push([...ids]); },
    showToast: () => {}, appLang: 'tr', console,
    document: { getElementById: () => null },
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  const flush = async () => { while (calls.timers.length) { const { fn } = calls.timers.shift(); await fn(); } };
  return { ctx, calls, flush };
}

test('kaynak bloğu bulunur', () => {
  assert.ok(start > 0 && end > start, 'kolHandleRemoteChange bloğu');
});

test('çoklu görünümde seçili sahibin değişikliği birleşik görünümü yeniden okur', async () => {
  const { ctx, calls, flush } = fixture();
  await ctx.kolHandleRemoteChange('owner', { mode: 'patch', rowPatches: [{ kind: 'changed', row: { id: 2 } }] });
  await flush();
  assert.deepEqual(calls.batch, [['me', 'owner']]);
  assert.deepEqual(calls.single, [], 'tek sahip yolu (__multi__ için 403) çağrılmaz');
});

test('art arda gelen olaylar tek yeniden okumada birleşir', async () => {
  const { ctx, calls, flush } = fixture();
  await ctx.kolHandleRemoteChange('owner', {});
  await ctx.kolHandleRemoteChange('me', {});
  await ctx.kolHandleRemoteChange('owner', {});
  await flush();
  assert.equal(calls.batch.length, 1);
});

test('seçili olmayan sahibin değişikliği çoklu görünümü etkilemez', async () => {
  const { ctx, calls, flush } = fixture();
  await ctx.kolHandleRemoteChange('stranger', {});
  await flush();
  assert.deepEqual(calls.batch, []);
});

test('bağlantı boşluğu sonrası __multi__ ile gelen yeniden okuma batch yolunu kullanır', async () => {
  const { ctx, calls, flush } = fixture();
  await ctx.kolHandleRemoteChange('__multi__', { mode: 'reload' });
  await flush();
  assert.deepEqual(calls.batch, [['me', 'owner']]);
  assert.deepEqual(calls.single, []);
});

test('kullanıcı filtre/arama alanındayken yeniden okuma ertelenir', async () => {
  const { ctx, calls, flush } = fixture({ editor: true });
  await ctx.kolHandleRemoteChange('owner', {});
  await flush();
  assert.deepEqual(calls.batch, []);
  assert.equal(ctx.kolRemoteReloadPendingOwner, '__multi__');
});

test('tek sahip görünümü eski davranışı korur', async () => {
  const { ctx, calls, flush } = fixture({ mode: 'single', selected: ['me'] });
  await ctx.kolHandleRemoteChange('me', { mode: 'reload' });
  await flush();
  assert.deepEqual(calls.single, ['me']);
  assert.deepEqual(calls.batch, []);
});
