'use strict';

/* KANONİK GÖRSEL KAYDI CANLI TAZELEME (D'nin gerçek tarayıcı bulgusu:
   collection-image-replace-stale-canonical-registry).

   Edit izinli kullanıcı sahibin Koleksiyonunda bir model görselini değiştirince
   sahip (belleğinde kanonik kayıt overrides.imagemap yüklü) sayfayı yenileyene
   kadar ESKİ görseli görüyordu: kolModelImageSources kanonik kaydı satır
   img alanından önce okur, /api/plm-image-links ise canlı olay yayımlamıyordu.

   Korunan sözleşme:
    · imagemap'i değiştiren sunucu yolları DEĞER TAŞIMAYAN `model-images`
      canlı sinyali (ve canlı akış kopukken shared-revision yedeği) yayımlar;
      PLM kimliği ya da görsel ref'i olaya girmez.
    · İstemci sinyalde kendi yetkili kapsamını mevcut kapsamlı uçlardan
      tazeler: CP için /api/model-images/registry/cp, Koleksiyon için aynı
      sözleşmeli /api/model-images/registry/collection/:ownerId. Erişimi
      olmayan kullanıcı Koleksiyon kaydını alamaz (403).
    · Kayıt yalnız ortak görsel boru hattında güncellenir; kolApplyRemotePatches
      kanonik kaydı doğrudan değiştirmez. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('./helpers/multi-user-access-server');

const SOURCE = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

function liveStream(session, base, clientId) {
  const events = [];
  const controller = new AbortController();
  const ready = (async () => {
    const response = await fetch(`${base}/api/live-events?clientId=${encodeURIComponent(clientId)}`, { headers: { Cookie: session.cookie }, signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let at;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, at); buffer = buffer.slice(at + 2);
            const line = chunk.split('\n').find(item => item.startsWith('data: '));
            if (line) { try { events.push(JSON.parse(line.slice(6))); } catch (_) {} }
          }
        }
      } catch (_) { /* aborted */ }
    })();
  })();
  return { events, ready, close: () => controller.abort() };
}
async function until(predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 50)); }
  return false;
}

test('görsel bağlantısı değişince yetkili aboneler değersiz model-images sinyali alır; kapsamlı Koleksiyon kaydı yetkiyle sınırlı', { timeout: 120000 }, async t => {
  const server = await startServer(t, { users: [{ id: 'own' }, { id: 'edi' }, { id: 'vie' }, { id: 'out' }] });
  const s = Object.fromEntries(await Promise.all(['own', 'edi', 'vie', 'out'].map(async id => [id, await server.login(id)])));
  const rows = [{ id: 1, plmId: 'PLM-LIVE-1', colourCode: 'BLK', colour: 'Black', modelKod: 'DM-LIVE-1' }, { id: 2, plmId: 'PLM-LIVE-2', colourCode: 'WHT', modelKod: 'DM-LIVE-2' }];
  assert.equal((await s.own.put('/api/collection-workspaces/own', { rows, nextId: 3 })).status, 200);
  assert.equal((await s.own.put('/api/collection-permissions/edi', { level: 'edit' })).status, 200);
  assert.equal((await s.own.put('/api/collection-permissions/vie', { level: 'view' })).status, 200);
  const first = await s.own.post('/api/plm-image-links', { items: [{ plmId: 'PLM-LIVE-1', colourCode: 'BLK', colour: 'Black', imageRef: 'ci_old_demo' }] });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const streams = { own: liveStream(s.own, server.base, 'own-tab'), vie: liveStream(s.vie, server.base, 'vie-tab'), edi: liveStream(s.edi, server.base, 'edi-tab') };
  t.after(() => Object.values(streams).forEach(stream => stream.close()));
  await Promise.all(Object.values(streams).map(stream => stream.ready));
  await new Promise(resolve => setTimeout(resolve, 400));

  // Düzenleyici görseli değiştirir (kendi sekmesi olayını yok sayar).
  const replaced = await s.edi.as('POST', '/api/plm-image-links', { body: { items: [{ plmId: 'PLM-LIVE-1', colourCode: 'BLK', colour: 'Black', imageRef: 'ci_new_demo' }] } });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  const signal = event => event && event.area === 'model-images';
  assert.ok(await until(() => streams.own.events.some(signal) && streams.vie.events.some(signal)), `owner/viewer did not receive model-images signal: ${JSON.stringify({ own: streams.own.events, vie: streams.vie.events })}`);
  for (const event of [...streams.own.events, ...streams.vie.events].filter(signal)) {
    assert.equal(event.mode, 'reload');
    const text = JSON.stringify(event);
    assert.doesNotMatch(text, /PLM-LIVE|ci_new_demo|ci_old_demo|imagemap/, 'signal carries no identity or image ref');
  }

  // Sahip ve izleyici kendi Koleksiyon kapsamını tazeler: yeni ref gelir.
  for (const who of ['own', 'vie', 'edi']) {
    const registry = await s[who].get('/api/model-images/registry/collection/own');
    assert.equal(registry.status, 200, `${who}: ${JSON.stringify(registry.body)}`);
    assert.equal(registry.body.ok, true);
    const entries = Object.entries(registry.body.imagemap).filter(([key]) => key.startsWith('plm:PLM-LIVE-1|colour:BLK'));
    assert.ok(entries.length && entries.every(([, ref]) => ref === 'ci_new_demo'), `${who}: ${JSON.stringify(registry.body)}`);
    // Dolu kapsam yinelenmez (yanıt yarıya iner): kaydı olmayan kapsam ayrı listelenir.
    assert.equal(registry.body.scopeKeys, undefined);
    assert.ok(!registry.body.emptyScopeKeys.includes('plm:PLM-LIVE-1|colour:BLK'), 'filled key is derived from imagemap');
    assert.ok(registry.body.emptyScopeKeys.includes('plm:PLM-LIVE-2|colour:WHT'));
  }
  // Erişimi olmayan kullanıcı başkasının Koleksiyon görsel kaydını alamaz.
  const denied = await s.out.get('/api/model-images/registry/collection/own');
  assert.equal(denied.status, 403);
  assert.doesNotMatch(JSON.stringify(denied.body), /PLM-LIVE|ci_new_demo/);
  // Kaydı kaldırmak (mezar taşı) da sinyal üretir; kapsamlı kayıt boş ref döner.
  const before = streams.vie.events.filter(signal).length;
  assert.equal((await s.edi.post('/api/plm-image-links', { items: [{ plmId: 'PLM-LIVE-1', colourCode: 'BLK', colour: 'Black', imageRef: '' }] })).status, 200);
  assert.ok(await until(() => streams.vie.events.filter(signal).length > before));
  const cleared = await s.vie.get('/api/model-images/registry/collection/own');
  assert.ok(Object.entries(cleared.body.imagemap).filter(([key]) => key.startsWith('plm:PLM-LIVE-1|colour:BLK')).every(([, ref]) => ref === ''));
});

test('sunucu sözleşmesi: imagemap değiştiren yollar sinyali yayımlar, canlı kopuksa shared-revision yedeği vardır', () => {
  const helper = SERVER.slice(SERVER.indexOf('function notifyModelImageRegistryChanged('), SERVER.indexOf('function notifyModelImageRegistryChanged(') + 900);
  assert.match(helper, /liveEvents\.notifyChange\('model-images', originClientId/);
  assert.match(helper, /sharedRevisionStore\.update\('modelImages'/);
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/plm-image-links'"), SERVER.indexOf("function collectionRowSelectedForImageDelete("));
  assert.match(route, /notifyModelImageRegistryChanged\(requestClientId\(req\)/);
  const deleteRoute = SERVER.slice(SERVER.indexOf("app.post('/api/model-images/delete-selected'"), SERVER.indexOf("app.post('/api/model-images/delete-selected'") + 9000);
  assert.match(deleteRoute, /notifyModelImageRegistryChanged\(requestClientId\(req\)/);
  // Senkron/PLM içe aktarma ve paylaşılan dağıtım (cihazlar arası) da aynı sinyali üretir.
  assert.equal((SERVER.match(/patchLinks: links => patchPlmImageLinksAndNotify\(links\)/g) || []).length, 2);
  const overridePatch = SERVER.slice(SERVER.indexOf("app.patch('/api/overrides/:orderCode'"), SERVER.indexOf("app.patch('/api/overrides/:orderCode'") + 2400);
  assert.match(overridePatch, /Object\.prototype\.hasOwnProperty\.call\(patchBody, 'imageRef'\)[\s\S]{0,120}notifyModelImageRegistryChanged/);
  const reload = SERVER.slice(SERVER.indexOf('liveEvents.setReloadAuthorizer('), SERVER.indexOf('liveEvents.setPatchAuthorizer('));
  assert.match(reload, /event\.area === 'model-images'[\s\S]{0,200}hasArea\(profile, area\)/);
});

function clientContext({ cpRows = null, owner = 'own', multi = null, activeTab = 'koleksiyon', registry = {}, cpRegistry = null, areas = null } = {}) {
  const calls = { fetch: [], render: [], invalidated: [], synced: 0, cpApplied: 0 };
  const ctx = {
    state: { overrides: { imagemap: { 'plm:PLM-LIVE-1|colour:BLK': 'ci_old_demo', 'plm:PLM-OTHER|colour:RED': 'ci_keep' } }, cp: cpRows ? { rows: cpRows } : null, orders: null },
    kolWorkspaceOwnerId: multi ? '__multi__' : owner,
    kolWorkspaceSelectedOwnerIds: new Set(multi || [owner]),
    window: { BLCanAccessArea: area => !areas || areas.includes(area) },
    currentActiveTab: () => activeTab,
    syncModelImageRegistry: () => { calls.synced++; },
    modelImageRefUrl: ref => `/api/collection-images/${ref}`,
    BLImageRuntime: { invalidate: urls => calls.invalidated.push(...urls) },
    renderKol: () => calls.render.push('kol'), renderCP: () => calls.render.push('cp'), renderOrders: () => calls.render.push('orders'),
    // Mevcut CP uygulaması (tam kopya + CP satır alanları) yalnız fark varsa çağrılmalı.
    applyCpStartupImageRegistry: (payload, rows) => {
      calls.cpApplied++; calls.cpRows = rows.length;
      ctx.state.overrides.imagemap = { ...ctx.state.overrides.imagemap, ...payload.imagemap };
      return true;
    },
    encodeURIComponent,
    fetch: async url => {
      calls.fetch.push(url);
      const owner = decodeURIComponent(String(url).split('/').pop());
      const body = owner === 'cp'
        ? { ok: true, imagemap: cpRegistry || {}, scopeKeys: Object.keys(cpRegistry || {}) }
        : registry[owner] || { ok: true, imagemap: {}, emptyScopeKeys: [] };
      return { ok: true, status: 200, json: async () => body };
    },
    console, Promise, Set, Map, Object, Array, String, Number, JSON,
  };
  const start = SOURCE.indexOf('/* KANONİK GÖRSEL KAYDI CANLI TAZELEME');
  const end = SOURCE.indexOf('// Tek görsel = tek URL', start);
  assert.ok(start > 0 && end > start, 'client refresh block exists in the shared image pipeline');
  // Değişiklik mevcut sessiz görsel tamamlama yamasıyla (gerçek kaynak) uygulanır.
  const patchStart = SOURCE.indexOf('function silentImageApplyPatch(');
  const patchEnd = SOURCE.indexOf('\n/* ', patchStart);
  assert.ok(patchStart > 0 && patchEnd > patchStart);
  vm.createContext(ctx);
  vm.runInContext(SOURCE.slice(start, end) + '\n' + SOURCE.slice(patchStart, patchEnd), ctx);
  return { ctx, calls };
}

test('istemci: sinyalde açık Koleksiyon sahiplerinin kapsamı tazelenir, yalnız değişen görsel geçersiz kılınır ve aktif tablo yeniden çizilir', async () => {
  const { ctx, calls } = clientContext({ registry: { own: { ok: true, imagemap: { 'plm:PLM-LIVE-1|colour:BLK': 'ci_new_demo' }, emptyScopeKeys: ['plm:PLM-LIVE-2|colour:WHT'] } } });
  const result = await ctx.refreshModelImageRegistryFromServer();
  assert.deepEqual(calls.fetch, ['/api/model-images/registry/collection/own']);
  assert.equal(ctx.state.overrides.imagemap['plm:PLM-LIVE-1|colour:BLK'], 'ci_new_demo');
  assert.equal(ctx.state.overrides.imagemap['plm:PLM-OTHER|colour:RED'], 'ci_keep', 'keys outside the refreshed scope stay');
  assert.equal(calls.synced, 1);
  assert.deepEqual(calls.invalidated, ['/api/collection-images/ci_old_demo']);
  assert.deepEqual(calls.render, ['kol']);
  assert.equal(result.changed, 1);
  // Değişiklik yoksa kayıt yeniden kurulmaz ve tablo çizilmez.
  const again = await ctx.refreshModelImageRegistryFromServer();
  assert.equal(again.changed, 0);
  assert.equal(calls.synced, 1);
  assert.deepEqual(calls.render, ['kol']);
});

test('istemci: kapsamdaki silinen görsel (ad varyantı dahil) kayıttan düşer ve eski URL geçersiz kılınır; kapsam dışı anahtar kalır', async () => {
  const { ctx, calls } = clientContext({ registry: { own: { ok: true, imagemap: {}, emptyScopeKeys: ['plm:PLM-LIVE-1|colour:BLK'] } } });
  ctx.state.overrides.imagemap['plm:PLM-LIVE-1|colour:BLK|name:Demo Navy'] = 'ci_named_demo';
  const result = await ctx.refreshModelImageRegistryFromServer();
  assert.equal(result.changed, 2);
  assert.deepEqual(Object.keys(ctx.state.overrides.imagemap), ['plm:PLM-OTHER|colour:RED']);
  assert.deepEqual(calls.invalidated.sort(), ['/api/collection-images/ci_named_demo', '/api/collection-images/ci_old_demo']);
  assert.deepEqual(calls.render, ['kol']);
});

test('istemci: tabanı yanıtta olan ad varyantı düşer (kapsam yanıt anahtarlarından türetilir); kayıt yerinde yamanır', async () => {
  const { ctx, calls } = clientContext({ registry: { own: { ok: true, imagemap: { 'plm:PLM-LIVE-1|colour:BLK': 'ci_old_demo' }, emptyScopeKeys: [] } } });
  const map = ctx.state.overrides.imagemap;
  map['plm:PLM-LIVE-1|colour:BLK|name:Demo Navy'] = 'ci_named_demo';
  const result = await ctx.refreshModelImageRegistryFromServer();
  assert.equal(result.changed, 1);
  assert.equal(ctx.state.overrides.imagemap, map, 'patched in place, no full copy');
  assert.deepEqual(Object.keys(map).sort(), ['plm:PLM-LIVE-1|colour:BLK', 'plm:PLM-OTHER|colour:RED']);
  assert.deepEqual(calls.invalidated, ['/api/collection-images/ci_named_demo']);
});

test('istemci: Koleksiyon erişimi olmayan kullanıcı sinyalde Koleksiyon kaydı istemez (gizli modül trafiği yok), CP kapsamı yine tazelenir', async () => {
  const { ctx, calls } = clientContext({ areas: ['cp'], cpRows: [{ 'PLM ID': 'PLM-LIVE-1' }], activeTab: 'cp', cpRegistry: { 'plm:PLM-CP|colour:NAV': 'ci_cp_new' } });
  await ctx.refreshModelImageRegistryFromServer();
  assert.deepEqual(calls.fetch, ['/api/model-images/registry/cp'], 'no Collection registry request');
  assert.equal(calls.cpApplied, 1);
  assert.deepEqual(calls.render, ['cp']);
});

test('istemci: çoklu görünüm her seçili sahibi, CP açık kullanıcı CP kapsamını tazeler; eşzamanlı sinyaller birleşir', async () => {
  const { ctx, calls } = clientContext({ multi: ['own', 'oth'], cpRows: [{ 'PLM ID': 'PLM-LIVE-1' }], activeTab: 'cp', cpRegistry: { 'plm:PLM-CP|colour:NAV': 'ci_cp_new' } });
  await Promise.all([ctx.refreshModelImageRegistryFromServer(), ctx.refreshModelImageRegistryFromServer(), ctx.refreshModelImageRegistryFromServer()]);
  assert.deepEqual(calls.fetch.slice(0, 3).sort(), ['/api/model-images/registry/collection/oth', '/api/model-images/registry/collection/own', '/api/model-images/registry/cp']);
  assert.ok(calls.fetch.length <= 6, `coalesced: ${calls.fetch.length} requests`);
  assert.equal(calls.cpApplied, 1, 'the repeat pass finds no CP difference and skips the full CP apply');
  assert.ok(calls.render.includes('cp'));
  assert.equal(calls.render.filter(item => item === 'cp').length, 1, 'one redraw for the coalesced burst');
  // CP kaydında değişiklik yoksa tam CP uygulaması çalışmaz ve CP yeniden çizilmez.
  const quiet = clientContext({ cpRows: [{ 'PLM ID': 'PLM-LIVE-1' }], activeTab: 'cp' });
  await quiet.ctx.refreshModelImageRegistryFromServer();
  assert.equal(quiet.calls.cpApplied, 0);
  assert.deepEqual(quiet.calls.render, []);
});

test('istemci sözleşmesi: canlı akış ve shared-revision yedeği tazelemeyi tetikler; uzak Koleksiyon yaması kaydı doğrudan değiştirmez', () => {
  const live = SOURCE.slice(SOURCE.indexOf('function initLiveSync('), SOURCE.indexOf('function initLiveSync(') + 4000);
  assert.match(live, /payload\.area==='model-images'\)\{[\s\S]{0,200}void refreshModelImageRegistryFromServer\(\)/);
  const fallback = SOURCE.slice(SOURCE.indexOf("window.addEventListener('bl-shared-revision'"), SOURCE.indexOf("window.addEventListener('bl-shared-revision'") + 3000);
  assert.match(fallback, /changed\.has\('modelImages'\)&&!liveSyncConnected\)void refreshModelImageRegistryFromServer\(\)/);
  const remote = SOURCE.slice(SOURCE.indexOf('function kolApplyRemotePatches('), SOURCE.indexOf('\nfunction kolHighlightRemoteRows'));
  assert.doesNotMatch(remote, /imagemap|setRegistryMap|syncModelImageRegistry/);
});
