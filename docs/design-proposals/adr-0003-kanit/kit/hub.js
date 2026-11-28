'use strict';
// Uzak kullanıcı yolu (repo dışı): iki yerel sunucu aynı Shared Hub klasörünü paylaşır (OneDrive aktarımı yok = 0 sn varsayımı).
// node hub.js <APP> <SOURCE> <out.json>
//
// 2026-11-28 düzeltmesi (6N'deki "B bootstrap hata verdi"):
//   Kök neden [Doğrulandı: source + runtime]: A'nın merkezi IAM dizininde yalnız moderator vardı. B'nin yerel dizini de
//   tek kullanıcılıydı (boot sırasında parolası değişmiş moderator). central-iam.js refresh() yer tutucu değişimine
//   yalnız uzak dizin kesin daha zenginse izin verir (remote.users > local.users); izin yoksa IAM_MIGRATION_CONFLICT
//   döner ve bootstrap "Kullanıcı verileri Shared Hub'dan alınamadı" der. Bu bir ürün güvencesidir (bağımsız yerel
//   dizin sessizce ezilmez), kit hatası değil. Kurulum artık repo testi shared-hub-new-device-users ile aynı: A, Hub'ı
//   açmadan önce ikinci bir kullanıcı oluşturur.
// Senaryolar: (1) A→B Supp. FOB ×3 (6N ile aynı), (2) B→A dates (retailDate), (3) A→B subManufacturer,
// (4) A ve B aynı satırın Supp. FOB'unu eşzamanlı yazar → iki tarafta çakışma kaydı; değerlerden biri sessizce kaybolmaz.
// Aşamalar: kayıt → yayım (sync-now) → karşı taraf sync-now (algılama + uygulama) → projeksiyon (cp/query değeri).
const L = require('./lib.js'), fs = require('fs'), os = require('os'), path = require('path');
const [APP, SOURCE, OUT] = process.argv.slice(2);
const rep = { runtime: { exec: process.execPath, node: process.versions.node, electron: process.versions.electron || null, NODE_OPTIONS: process.env.NODE_OPTIONS || '' }, trials: [], scenarios: {}, errors: [], setup: {} };
const save = () => fs.writeFileSync(OUT, JSON.stringify(rep, null, 1));
const today = (() => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
const iso = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
(async () => {
  let A, B; const H = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-hub-'));
  try {
    A = await L.createApp({ APP, source: SOURCE, env: {}, label: 'hubA' }); B = await L.createApp({ APP, source: SOURCE, env: {}, label: 'hubB' });
    await L.boot(A); await L.boot(B);
    const j = async (app, u, init = {}) => { const t = performance.now(); const r = await fetch(app.base + u, { ...init, headers: { cookie: app.cookie, 'Content-Type': 'application/json', ...(init.headers || {}) } }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) {} return { ms: Math.round(performance.now() - t), status: r.status, json, text: text.slice(0, 300) }; };
    // Düzeltme: merkezi dizin, yeni cihazın tek kullanıcılı yer tutucusundan kesin daha zengin olmalı.
    const user = await j(A, '/api/users', { method: 'POST', body: JSON.stringify({ username: 'hub.buyer', displayName: 'Hub Buyer', title: 'T', password: 'synthetic-hub-only-456', systemRole: 'moderator', reason: 'hub', confirmCritical: true }) });
    rep.setup.secondUser = user.status;
    let t = Date.now(); const init = await j(A, '/api/shared-hub/initialize', { method: 'POST', body: JSON.stringify({ root: H, confirmCritical: true }) }); rep.setup.initialize = { ms: Date.now() - t, status: init.status, err: init.status !== 200 ? init.text : null }; save();
    if (init.status !== 200) throw Error('initialize ' + init.text);
    t = Date.now(); const cfg = await j(B, '/api/shared-hub/configure', { method: 'POST', body: JSON.stringify({ root: H }) }); rep.setup.configure = { status: cfg.status, err: cfg.status >= 300 ? cfg.text : null };
    for (let i = 0; i < 600; i++) { const st = await j(B, '/api/shared-hub/bootstrap-status'); rep.setup.lastStatus = st.json && { status: st.json.status, phase: st.json.phase, message: st.json.message, steps: st.json.steps }; if (st.json && st.json.status && !/syncing|pending|running|starting/i.test(st.json.status)) break; await L.delay(1000); }
    rep.setup.bootstrapMs = Date.now() - t; save();
    if (rep.setup.lastStatus && /error/i.test(rep.setup.lastStatus.status)) throw Error('B bootstrap: ' + JSON.stringify(rep.setup.lastStatus).slice(0, 400));
    try { await B.login(); rep.setup.bLogin = 'ok'; } catch (e) { rep.setup.bLogin = String(e.message); }
    try { await A.login(); } catch (_) {}
    const FIELDS = ['_id', 'Order Code', 'Model Name', 'C.Code', 'Supp. FOB', 'Retail Date', 'Sub-Manufacturer', 'Licensor'];
    const q = async app => j(app, '/api/read-model/cp/query', { method: 'POST', body: JSON.stringify({ version: 1, lang: 'tr', query: { version: 1, columns: [], base: [], groups: {}, today, offset: 0, limit: 400, fields: FIELDS } }) });
    const qa = await q(A), qb = await q(B); rep.setup.queries = { a: qa.status, b: qb.status, bErr: qb.status !== 200 ? qb.text : null }; save();
    if (qa.status !== 200 || qb.status !== 200) throw Error('cp/query A ' + qa.status + ' B ' + qb.status);
    const rowsA = qa.json.result.rows;
    const same = row => x => x['Order Code'] === row['Order Code'] && x['C.Code'] === row['C.Code'] && x['Model Name'] === row['Model Name'];
    const syncNow = async app => { const a = Date.now(); const r = await j(app, '/api/sync-settings/sync-now', { method: 'POST', body: '{}' }); return { ms: Date.now() - a, status: r.status, err: r.status !== 200 ? r.text : null }; };
    const waitValue = async (app, row, field, ok) => { const start = Date.now(); for (; Date.now() - start < 60000;) { const r = await q(app); const hit = r.status === 200 && r.json.result.rows.find(same(row)); if (hit && ok(hit[field])) return { ms: Date.now() - start, value: hit[field] }; await L.delay(250); } const r = await q(app); const hit = r.status === 200 && r.json.result.rows.find(same(row)); return { ms: null, value: hit ? hit[field] : '<yok>' }; };
    // (1) A → B Supp. FOB ×3 (6N ile aynı aşamalar)
    for (let i = 0; i < 3; i++) {
      const row = rowsA[10 + i * 7]; const val = Math.round((200 + i + 0.37) * 100) / 100; const tr = { kind: 'A→B suppFob', code: row['Order Code'], val }; const t0 = Date.now();
      const s = await j(A, '/api/overrides/' + row['Order Code'], { method: 'PATCH', body: JSON.stringify({ model: row['Model Name'], ccode: row['C.Code'], suppFob: val, suppFobMeta: { source: 'manual' } }) }); tr.saveStatus = s.status;
      tr.publish = await syncNow(A); tr.apply = await syncNow(B);
      const seen = await waitValue(B, row, 'Supp. FOB', v => Number(v) === val); tr.projectionAfterApplyMs = seen.ms; tr.bValue = seen.value; tr.totalFromT0 = seen.ms != null ? Date.now() - t0 : null;
      rep.trials.push(tr); save(); console.log(JSON.stringify(tr));
    }
    // (2) B → A dates.retailDate
    {
      const row = rowsA[60]; const d = new Date(row['Retail Date'] || Date.now()); d.setDate(d.getDate() + 17); const target = iso(d); const sc = { code: row['Order Code'], target };
      const s = await j(B, '/api/overrides/' + row['Order Code'], { method: 'PATCH', body: JSON.stringify({ model: row['Model Name'], ccode: row['C.Code'], dates: { retailDate: target } }) }); sc.saveStatus = s.status;
      sc.publish = await syncNow(B); sc.apply = await syncNow(A);
      const seen = await waitValue(A, row, 'Retail Date', v => String(v || '').slice(0, 10) === target); sc.aValue = seen.value; sc.ms = seen.ms;
      rep.scenarios.datesBtoA = sc; save(); console.log('dates', JSON.stringify(sc));
    }
    // (3) A → B subManufacturer (Licensor DTR olmayan satır)
    {
      const row = rowsA.find((r, k) => k > 70 && String(r.Licensor || '').toUpperCase() !== 'DTR') || rowsA[71]; const target = 'HUB SUB ' + Date.now() % 1000; const sc = { code: row['Order Code'], target };
      const s = await j(A, '/api/overrides/' + row['Order Code'], { method: 'PATCH', body: JSON.stringify({ model: row['Model Name'], ccode: row['C.Code'], subManufacturer: target }) }); sc.saveStatus = s.status;
      sc.publish = await syncNow(A); sc.apply = await syncNow(B);
      const seen = await waitValue(B, row, 'Sub-Manufacturer', v => String(v || '') === target); sc.bValue = seen.value; sc.ms = seen.ms;
      rep.scenarios.subManufacturerAtoB = sc; save(); console.log('sub', JSON.stringify(sc));
    }
    // (4) Eşzamanlı aynı alan: A ve B, yayım öncesi aynı satırın Supp. FOB'unu farklı değerle yazar.
    {
      const row = rowsA[90]; const sc = { code: row['Order Code'], a: 311.11, b: 322.22 };
      const body = v => JSON.stringify({ model: row['Model Name'], ccode: row['C.Code'], suppFob: v, suppFobMeta: { source: 'manual' } });
      const [sa, sb] = await Promise.all([j(A, '/api/overrides/' + row['Order Code'], { method: 'PATCH', body: body(sc.a) }), j(B, '/api/overrides/' + row['Order Code'], { method: 'PATCH', body: body(sc.b) })]);
      sc.saves = [sa.status, sb.status];
      for (let round = 0; round < 2; round++) { await syncNow(A); await syncNow(B); }
      await L.delay(1500);
      const va = (await q(A)).json.result.rows.find(same(row)), vb = (await q(B)).json.result.rows.find(same(row));
      sc.values = { A: va && va['Supp. FOB'], B: vb && vb['Supp. FOB'] };
      const conf = async app => { const r = await j(app, '/api/sync-conflicts'); const list = (r.json && r.json.conflicts) || []; return list.filter(c => !c.resolved && JSON.stringify(c).includes(String(row['Order Code']))).map(c => ({ field: c.field, local: c.local, incoming: c.incoming, id: c.id })); };
      sc.conflicts = { A: await conf(A), B: await conf(B) };
      const has = (list, v) => list.some(c => JSON.stringify(c).includes(String(v)));
      // Sessiz kayıp yok: her taraf karşı tarafın değerini ya değer ya çakışma kaydı olarak taşır.
      sc.noSilentLoss = (Number(sc.values.A) === sc.b || has(sc.conflicts.A, sc.b)) && (Number(sc.values.B) === sc.a || has(sc.conflicts.B, sc.a));
      rep.scenarios.concurrentSuppFob = sc; save(); console.log('concurrent', JSON.stringify(sc).slice(0, 800));
    }
    rep.pass = rep.trials.every(t => t.projectionAfterApplyMs != null) && rep.scenarios.datesBtoA.ms != null && rep.scenarios.subManufacturerAtoB.ms != null && rep.scenarios.concurrentSuppFob.noSilentLoss === true;
  } catch (e) { rep.errors.push(String(e.stack || e).slice(0, 800)); rep.pass = false; }
  finally { save(); try { await A && A.stop(); } catch (_) {} try { await B && B.stop(); } catch (_) {} }
})();
