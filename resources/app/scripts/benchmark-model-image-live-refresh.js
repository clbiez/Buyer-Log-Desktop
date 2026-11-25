'use strict';
// L2: model görseli canlı yolu (docs/performance/2026-11-25-model-image-live-refresh.md).
// Kullanım: BENCH_SIDE=cand [BENCH_APP_ROOT=<Main çalışma ağacı>/resources/app]
//           [BENCH_N=30000] [BENCH_BATCH=1000] node scripts/benchmark-model-image-live-refresh.js
// BENCH_APP_ROOT ile Main veya aday sunucusu başlatılır (varsayılan: bu uygulama).
// Ölçülenler (her iki taraf): edit izinli kullanıcının tek görsel bağlama POST'u,
// aynı 30k çalışma alanının GET'i (mevcut canlı tazeleme referansı), POST'lar
// sırasında sahibin SSE akışına düşen olaylar ve shared-revision modelImages artışı.
// Yalnız aday: kapsamlı Koleksiyon kayıt GET'i ve istemci uygulama (değişen / değişmeyen).
const path = require('path'), fs = require('fs'), vm = require('vm');
const APP = process.env.BENCH_APP_ROOT || path.join(__dirname, '..');
const helper = require(path.join(APP, 'tests/helpers/multi-user-access-server.js'));
const N = Number(process.env.BENCH_N || 30000), B = Number(process.env.BENCH_BATCH || 1000);
const median = l => { const s = [...l].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const now = () => Number(process.hrtime.bigint()) / 1e6;
const stat = l => ({ median: +median(l).toFixed(2), samples: l.map(v => +v.toFixed(1)) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function liveStream(cookie, base, clientId) {
  const events = [], controller = new AbortController();
  const ready = (async () => {
    const response = await fetch(`${base}/api/live-events?clientId=${clientId}`, { headers: { Cookie: cookie }, signal: controller.signal });
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let at; while ((at = buffer.indexOf('\n\n')) >= 0) { const chunk = buffer.slice(0, at); buffer = buffer.slice(at + 2); const line = chunk.split('\n').find(item => item.startsWith('data: ')); if (line) { try { events.push(JSON.parse(line.slice(6))); } catch (_) {} } } } } catch (_) {} })();
  })();
  return { events, ready, close: () => controller.abort() };
}
(async () => {
  const cleanups = []; const t = { after: fn => cleanups.push(fn) };
  const out = { side: process.env.BENCH_SIDE, n: N };
  try {
    const server = await helper.startServer(t, { users: [{ id: 'own' }, { id: 'edi' }] });
    const own = await server.login('own'), edi = await server.login('edi');
    const rows = Array.from({ length: N }, (_, i) => ({ id: i + 1, plmId: `PLM-B-${i}`, colourCode: `C${i % 7}`, modelKod: `M-${i}` }));
    let r = await own.put('/api/collection-workspaces/own', { rows, nextId: N + 1 }); if (r.status !== 200) throw new Error('save ' + r.status);
    r = await own.put('/api/collection-permissions/edi', { level: 'edit' }); if (r.status !== 200) throw new Error('grant ' + r.status);
    const seed = Array.from({ length: N }, (_, i) => ({ plmId: `PLM-B-${i}`, colourCode: `C${i % 7}`, imageRef: `ci_seed_${i}` }));
    for (let i = 0; i < seed.length; i += B) { r = await own.post('/api/plm-image-links', { items: seed.slice(i, i + B) }); if (r.status !== 200) throw new Error('seed ' + r.status); }
    await sleep(1500); // tohumlamanın sinyal/revizyon kuyruğu boşalsın
    const ws = [], wsBytes = [];
    for (let i = 0; i < 9; i++) { const t0 = now(); r = await own.get('/api/collection-workspaces/own'); ws.push(now() - t0); wsBytes.push(Buffer.byteLength(JSON.stringify(r.body))); }
    out.workspaceGetMs = { ...stat(ws), bytes: wsBytes[0] };
    const base = server.base || `http://127.0.0.1:${new URL(own.base || 'http://x:0').port}`;
    const revBefore = (await own.get('/api/shared-revisions')).body;
    const stream = server.base ? liveStream(own.cookie, server.base, 'bench-owner') : null;
    if (stream) { await stream.ready; await sleep(200); }
    const link = [];
    for (let i = 0; i < 15; i++) { const t0 = now(); r = await edi.post('/api/plm-image-links', { items: [{ plmId: `PLM-B-${i}`, colourCode: `C${i % 7}`, imageRef: `ci_new_${i}` }] }); link.push(now() - t0); if (r.status !== 200) throw new Error('link ' + r.status); }
    out.plmImageLinksMs = stat(link);
    await sleep(1500);
    if (stream) { stream.close(); const areas = {}; for (const e of stream.events) if (e && e.area) areas[e.area] = (areas[e.area] || 0) + 1; out.ownerSseEventsDuring15Posts = areas; }
    const revAfter = (await own.get('/api/shared-revisions')).body;
    const revOf = body => { const e = body && (body.entities || body)['modelImages']; return e ? Number(e.revision || e.rev || 0) : 0; };
    out.sharedRevisionModelImagesDelta = revOf(revAfter) - revOf(revBefore);
    const reg = [];
    for (let i = 0; i < 9; i++) { const t0 = now(); r = await own.get('/api/model-images/registry/collection/own'); reg.push(now() - t0); }
    out.collectionRegistryMs = r.status === 200 ? { ...stat(reg), keys: Object.keys(r.body.imagemap).length, bytes: Buffer.byteLength(JSON.stringify(r.body)) } : { status: r.status };
    if (r.status === 200) {
      const src = fs.readFileSync(path.join(APP, 'public/app-main.js'), 'utf8');
      const start = src.indexOf('function syncModelImageRegistry(){'), end = src.indexOf('// Tek görsel = tek URL', start);
      const pStart = src.indexOf('function silentImageApplyPatch('), pEnd = src.indexOf('\n/* ', pStart);
      const { createModelImageCache } = require(path.join(APP, 'public/model-image-cache.js'));
      const seedMap = Object.fromEntries(seed.map(item => [`plm:${item.plmId}|colour:${item.colourCode}`, item.imageRef]));
      const changedRuns = [], quietRuns = [];
      for (let i = 0; i < 7; i++) {
        const cache = createModelImageCache({}, {});
        const ctx = { state: { overrides: { imagemap: { ...seedMap } } }, window: { BLModelImageCache: cache }, modelImageRefUrl: x => x, BLImageRuntime: { invalidate() {} }, console, Set, Object, Array, String, Number, JSON, Promise };
        vm.createContext(ctx); vm.runInContext(src.slice(start, end) + '\n' + src.slice(pStart, pEnd), ctx);
        ctx.syncModelImageRegistry(); // açılıştaki gibi yayımlanmış kayıt
        let payload = JSON.parse(JSON.stringify(r.body)); let t0 = now(); const c = ctx.applyScopedModelImageRegistry(payload); changedRuns.push(now() - t0);
        payload = JSON.parse(JSON.stringify(r.body)); t0 = now(); const q = ctx.applyScopedModelImageRegistry(payload); quietRuns.push(now() - t0);
        const map = ctx.state.overrides.imagemap;
        const parity = Object.keys(map).length === N && Array.from({ length: 15 }, (_, k) => map[`plm:PLM-B-${k}|colour:C${k % 7}`] === `ci_new_${k}`).every(Boolean) && cache.resolveRegistrySource('PLM-B-3', 'C3', '/api/collection-images') !== '';
        if (c !== 15 || q !== 0 || !parity) throw new Error(`apply parity changed=${c} quiet=${q} parity=${parity}`);
      }
      out.clientApplyChangedMs = stat(changedRuns); out.clientApplyUnchangedMs = stat(quietRuns);
    }
  } finally { for (const fn of cleanups.reverse()) await fn(); }
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
