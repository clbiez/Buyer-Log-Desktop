'use strict';

/* FİYAT MASASI — 20 EŞZAMANLI KULLANICI / KURULUM (v2026-11-25).

   RED ile kanıtlanan kök nedenler:
   1) Eski görünümle gönderilen yapısal kayıt (PUT: not, üretici ekleme,
      alternatif fiyat) başka kullanıcının bu arada eklediği üreticiyi ve
      satırları, girdiği fiyatı ve defterini SİLİYORDU. İstemcide satır silen
      akış yoktur (drop bir işarettir); sunucu yapısal kayıtta eksik satırı ve
      o satırların üreticisini korur. Alternatif fiyat/etiket değişikliği de
      satır revizyonunu ilerletir; eski revizyonlu kayıt onları ezmez.
   2) Ortak veri köküne yazan kurulumlar (dosya kirası + revizyon CAS) ve aynı
      süreçteki toplu fiyat aktarımı, farklı satırlara yazarken bile 409
      üretiyordu (HTTP'de kira beklemesizdir). İstemci tek satır PATCH'ini 409'da
      kuyruktan düşürüp ekranda kaydedilmemiş fiyat bırakıyordu. Rotalar geçici
      çekişmeyi (SHARED_WRITE_BUSY / REVISION_CONFLICT) taze durumla yeniden
      dener; istemci tükenen denemede sunucu hâline döner.

   Senaryolar seed'lidir; başarısızlıkta seed + işlem kaydı yazılır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pricing-concurrency-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const ledger = require(path.join(ROOT, 'server', 'lib', 'quotation-ledger.js'));
const { runWithNonblockingFileLeases } = require(path.join(ROOT, 'server', 'lib', 'shared-file-transaction.js'));
const sim = require('./helpers/pricing-sim');

const USERS = Array.from({ length: 20 }, (_, i) => ({ id: `user-${i}`, role: 'user', displayName: `Kullanıcı ${i}` }));
const owner = USERS[0];
const ALL_IDS = USERS.map(user => user.id);
const findRequest = id => store.loadStore().requests.find(item => item.id === id);
const state = item => ({ price: item.price, approved: item.approved, dropped: item.dropped });

function createShared(payload) {
  const created = store.createRequest(owner, payload);
  store.setEditors(owner, created.id, ALL_IDS.slice(1), ALL_IDS);
  return findRequest(created.id);
}

for (const seed of sim.SEEDS) {
  test(`tek sunucu, 20 kullanıcı: eşzamanlı fiyat/onay/drop ve toplu fiyat — rev çakışması, defter ve tekil onay (seed ${seed})`, async () => {
    const random = sim.seededRandom(seed), log = [];
    const models = Array.from({ length: 6 }, (_, i) => ({ modelKey: `kol:a${seed}-${i + 1}`, rowId: i + 1, modelCode: `M-${i + 1}`, plmId: `P-${i + 1}` }));
    const lines = (tag, names) => models.flatMap(model => names.map(name => ({ id: `${tag}-${model.rowId}-${name}`, ...model, manufacturer: name, price: '' })));
    const r1 = createShared({ source: 'collection', manufacturers: ['A', 'B', 'C', 'D', 'E'].map(name => ({ name })), items: lines(`a${seed}r1`, ['A', 'B', 'C', 'D', 'E']) });
    const r2 = createShared({ source: 'collection', manufacturers: ['A', 'F'].map(name => ({ name })), items: lines(`a${seed}r2`, ['A', 'F']) });
    const ids = [r1.id, r2.id];
    const snapshot = () => {
      const st = store.loadStore();
      return new Map(ids.flatMap(id => st.requests.find(item => item.id === id).items.map(item => [item.id, { ...sim.clone(item), requestId: id }])));
    };
    let prev = snapshot();
    // Her kullanıcının bildiği satır revizyonları (istemcinin qServerState'i).
    const views = USERS.map(() => new Map([...prev].map(([id, item]) => [id, item.rev || 0])));
    const seen = new Set();
    await sim.withRepro('pricing-single-server', seed, log, async () => {
      for (let ordinal = 0; ordinal < sim.scale(260); ordinal++) {
        const u = sim.int(random, USERS.length), user = USERS[u];
        const target = sim.pick(random, [...prev.values()]);
        const roll = random();
        const kind = roll < 0.45 ? 'price' : roll < 0.62 ? 'approve' : roll < 0.7 ? 'unapprove' : roll < 0.8 ? 'drop' : roll < 0.9 ? 'batch' : 'refresh';
        if (kind === 'refresh') { for (const [id, item] of prev) views[u].set(id, item.rev || 0); continue; }
        const entry = { ordinal, user: user.id, kind };
        log.push(entry);
        let result = null, error = null, patch = null, changes = null;
        if (kind === 'batch') {
          const pool = sim.shuffle(random, [...prev.values()].filter(item => item.requestId === r1.id)).slice(0, 1 + sim.int(random, 3));
          changes = pool.map(item => ({ lineId: item.id, baseRev: views[u].get(item.id) || 0, price: sim.price(random), identity: { modelKey: item.modelKey, rowId: item.rowId, manufacturer: item.manufacturer, plmId: item.plmId, modelCode: item.modelCode, orderCode: item.orderCode } }));
          Object.assign(entry, { changes: changes.map(({ lineId, baseRev, price }) => ({ lineId, baseRev, price })) });
          try { result = store.patchLines(user, r1.id, changes); } catch (err) { error = err; }
        } else {
          patch = kind === 'price' ? { price: sim.price(random) } : kind === 'approve' ? { approved: true } : kind === 'unapprove' ? { approved: false } : { dropped: !target.dropped };
          patch.baseRev = random() < 0.1 ? null : views[u].get(target.id);
          Object.assign(entry, { line: target.id, patch });
          try { result = store.patchLine(user, target.requestId, target.id, patch); } catch (err) { error = err; }
        }
        entry.outcome = error ? error.code : 'ok';
        const after = snapshot();

        // Beklenen reddedişler hiçbir şeyi değiştirmez.
        if (kind === 'approve' && ledger.priceNumber(target.price) == null) {
          assert.equal(error && error.code, 'QUOTATION_PRICE_REQUIRED', 'fiyatsız satır onaylanamaz');
        } else if (kind === 'batch' && changes.some(change => change.baseRev !== (prev.get(change.lineId).rev || 0))) {
          assert.equal(error && error.code, 'QUOTATION_BATCH_STALE', 'eski önizlemeli toplu fiyat reddedilir');
        } else {
          assert.equal(error, null, `beklenmeyen hata: ${error && error.code}`);
        }
        if (error) { assert.deepEqual([...after], [...prev], 'reddedilen işlem hiçbir satırı değiştirmez'); continue; }

        if (kind !== 'batch') {
          const expectedConflict = patch.baseRev != null && patch.baseRev !== (target.rev || 0);
          assert.equal(result.conflict, expectedConflict, 'rev çakışması yalnız eski taban revizyonunda raporlanır');
          const line = after.get(target.id);
          if (kind === 'price') assert.equal(line.price, patch.price, 'çakışmada da yeni fiyat yazılır (önceki defterde kalır)');
          if (kind === 'approve') assert.equal(line.approved, true);
          if (kind === 'unapprove') assert.equal(line.approved, false);
          if (kind === 'drop') assert.equal(line.dropped, patch.dropped);
        } else {
          for (const change of changes) assert.equal(after.get(change.lineId).price, change.price, 'toplu fiyat uygulanır');
        }
        // Defter: değişen her satır tek rev ilerler ve yeni olaylar bu kullanıcıya aittir; diğerleri aynen kalır.
        const touched = new Set(kind === 'batch' ? changes.map(change => change.lineId) : [target.id]);
        for (const [id, line] of after) {
          const before = prev.get(id);
          const changed = JSON.stringify(state(line)) !== JSON.stringify(state(before));
          if (!changed) { assert.equal(line.rev, before.rev, `${id}: değişmeyen satırın rev'i sabit`); assert.deepEqual(line.history, before.history); continue; }
          const exclusive = kind === 'approve' && line.modelKey === target.modelKey && !line.approved;
          assert.ok(touched.has(id) || exclusive, `${id}: yalnız hedef satır ve aynı modelin onayları değişebilir`);
          assert.equal(line.rev, (before.rev || 0) + 1, `${id}: rev bir ilerler`);
          const old = new Set(before.history.map(event => event.id));
          assert.ok(before.history.every(event => line.history.some(item => item.id === event.id)), `${id}: eski olaylar korunur`);
          const fresh = line.history.filter(event => !old.has(event.id));
          assert.ok(fresh.length >= 1 && fresh.every(event => event.by === user.id), `${id}: yeni olaylar işlemi yapan kullanıcıya ait`);
          if (exclusive) assert.ok(fresh.some(event => event.type === 'unapprove' && event.source === 'exclusive'));
        }
        // Model başına tek onay (aynı sahip + kaynak, iki talep birlikte).
        const approvedByModel = new Map();
        for (const line of after.values()) if (line.approved) approvedByModel.set(line.modelKey, (approvedByModel.get(line.modelKey) || 0) + 1);
        for (const [modelKey, count] of approvedByModel) assert.ok(count <= 1, `${modelKey}: model başına en fazla bir onay`);
        const present = new Set([...after.values()].flatMap(line => line.history.map(event => event.id)));
        for (const id of seen) assert.ok(present.has(id), 'hiçbir defter olayı kaybolmaz');
        for (const id of present) seen.add(id);
        // İstemci yanıttaki talebi bütünüyle yeniler (qReplaceRequest).
        for (const [id, line] of after) if (line.requestId === target.requestId || kind === 'approve' || kind === 'batch') views[u].set(id, line.rev || 0);
        prev = after;
      }
    });
  });
}

for (const seed of sim.SEEDS) {
  test(`tek sunucu, 20 kullanıcı: eski görünümlü yapısal kayıtlar satır/üretici/fiyat/alternatif silmez; üreticisiz talep modelleri doğru (seed ${seed})`, async () => {
    const random = sim.seededRandom(seed), log = [];
    const models = Array.from({ length: 8 }, (_, i) => ({ modelKey: `kol:c${seed}-${i + 1}`, rowId: 100 + i, modelCode: `CM-${i + 1}`, plmId: `CP-${i + 1}`, targetPrice: '4,00' }));
    const created = createShared({ source: 'collection', manufacturers: [], items: [], models });
    const id = created.id;
    const views = USERS.map(() => sim.clone(created));
    const knownLines = new Set(), knownManufacturers = new Set(), lastPrice = new Map(), lastOptions = new Map(), seen = new Set();
    const counters = USERS.map(() => 0);
    // İstemcinin yapısal kaydı: satırlar bilinen sunucu revizyonuyla gider (qSave).
    const put = (user, view, { legacy = false } = {}) => {
      const body = sim.clone(view);
      if (legacy) { delete body.models; body.items.forEach(item => { delete item.options; delete item.priceLabel; delete item.priceNote; }); }
      return store.updateRequest(user, id, body);
    };
    await sim.withRepro('pricing-structural-put', seed, log, async () => {
      for (let ordinal = 0; ordinal < sim.scale(220); ordinal++) {
        const u = sim.int(random, USERS.length), user = USERS[u], view = views[u];
        const roll = random();
        const kind = roll < 0.25 || !view.items.length ? 'add-manufacturer' : roll < 0.55 ? 'price' : roll < 0.65 ? 'approve' : roll < 0.77 ? 'note' : roll < 0.87 ? 'legacy-note' : 'options';
        const entry = { ordinal, user: user.id, kind };
        log.push(entry);
        const current = findRequest(id);
        let response = null;
        if (kind === 'add-manufacturer') {
          const name = random() < 0.15 ? 'Ortak Atölye' : `Atölye ${u}-${++counters[u]}`;
          if (!view.manufacturers.some(m => sim.mfrKey(m.name) === sim.mfrKey(name))) view.manufacturers.push({ name, email: '' });
          const seeds = new Map();
          [...view.items, ...(view.models || [])].forEach(item => { if (!seeds.has(item.modelKey)) seeds.set(item.modelKey, item); });
          const added = [];
          for (const [modelKey, seedItem] of seeds) {
            if (added.length && random() < 0.3) continue;
            if (view.items.some(item => item.modelKey === modelKey && sim.mfrKey(item.manufacturer) === sim.mfrKey(name))) continue;
            const line = { ...seedItem, id: `put-${seed}-${ordinal}-${added.length}`, manufacturer: name, manufacturerEmail: '', price: '', approved: false, dropped: false, priceLabel: '', priceNote: '', options: [], rev: 0, updatedAt: '', updatedBy: '', history: [] };
            view.items.push(line); added.push(line.id);
          }
          const lined = new Set(view.items.map(item => item.modelKey));
          view.models = (view.models || []).filter(model => !lined.has(model.modelKey));
          Object.assign(entry, { name, added });
          response = put(user, view);
        } else if (kind === 'price' || kind === 'approve') {
          const line = sim.pick(random, view.items);
          const patch = kind === 'price' ? { price: sim.price(random), baseRev: line.rev } : { approved: true, baseRev: line.rev };
          Object.assign(entry, { line: line.id, patch });
          try { response = store.patchLine(user, id, line.id, patch).request; if (kind === 'price') lastPrice.set(line.id, patch.price); }
          catch (error) { assert.equal(error.code, 'QUOTATION_PRICE_REQUIRED'); entry.outcome = error.code; }
        } else if (kind === 'note' || kind === 'legacy-note') {
          view.note = `not ${u} ${ordinal}`;
          response = put(user, view, { legacy: kind === 'legacy-note' });
        } else {
          const line = sim.pick(random, view.items);
          const options = [{ id: `opt-${seed}-${ordinal}`, label: `Opsiyon ${u}`, price: sim.price(random), note: '' }];
          line.options = options; line.priceLabel = `Ana ${u}`;
          Object.assign(entry, { line: line.id, options, viewRev: line.rev });
          const before = current.items.find(item => item.id === line.id);
          response = put(user, view);
          // Eski revizyonlu kayıt alternatifleri değiştirmez; güncel revizyonlu kayıt değiştirir.
          if (line.rev === before.rev) lastOptions.set(line.id, options);
        }
        const after = findRequest(id);
        if (response) {
          response.items.forEach(item => knownLines.add(item.id));
          response.manufacturers.forEach(m => knownManufacturers.add(sim.mfrKey(m.name)));
          views[u] = sim.clone(response);
        }
        const ids = new Set(after.items.map(item => item.id));
        for (const lineId of knownLines) assert.ok(ids.has(lineId), `satır kaybolmamalı: ${lineId}`);
        const names = new Set(after.manufacturers.map(m => sim.mfrKey(m.name)));
        for (const name of knownManufacturers) assert.ok(names.has(name), `üretici kaybolmamalı: ${name}`);
        for (const item of after.items) assert.ok(names.has(sim.mfrKey(item.manufacturer)), `satırın üreticisi listelenmeli: ${item.manufacturer}`);
        for (const [lineId, price] of lastPrice) assert.equal(after.items.find(item => item.id === lineId).price, price, `${lineId}: kabul edilen son fiyat ezilmemeli`);
        for (const [lineId, options] of lastOptions) assert.deepEqual(after.items.find(item => item.id === lineId).options.map(o => [o.label, o.price]), options.map(o => [o.label, o.price]), `${lineId}: alternatif fiyatlar ezilmemeli`);
        const cells = new Map();
        for (const item of after.items) { const cell = `${item.modelKey}\u0000${sim.mfrKey(item.manufacturer)}`; cells.set(cell, (cells.get(cell) || 0) + 1); }
        for (const [cell, count] of cells) assert.equal(count, 1, `model × üretici hücresi tek satır olmalı: ${cell}`);
        const lined = new Set(after.items.map(item => item.modelKey));
        assert.deepEqual(after.models.map(m => m.modelKey), models.map(m => m.modelKey).filter(key => !lined.has(key)), 'bekleyen modeller = satırı açılmamış modeller');
        for (const item of after.items) for (const event of item.history) seen.add(event.id);
        const events = new Set(after.items.flatMap(item => item.history.map(event => event.id)));
        for (const eventId of seen) assert.ok(events.has(eventId), 'defter olayı kaybolmamalı');
        const approved = new Map();
        for (const item of after.items) if (item.approved) approved.set(item.modelKey, (approved.get(item.modelKey) || 0) + 1);
        for (const [modelKey, count] of approved) assert.ok(count <= 1, `${modelKey}: tek onay`);
      }
    });
  });
}

test('eski görünümlü kayıtta aynı hücreye açılan satır yalnız alternatif fiyat taşıyorsa korunur', () => {
  const created = createShared({ source: 'collection', manufacturers: [{ name: 'A' }], items: [{ id: 'oc-1', modelKey: 'kol:oc-1', rowId: 1, manufacturer: 'A', price: '' }] });
  const stale = sim.clone(created);
  // Başka kullanıcı aynı hücreyi (kol:oc-1 × B) açtı.
  store.updateRequest(USERS[1], created.id, { ...created, manufacturers: [{ name: 'A' }, { name: 'B' }], items: [...created.items, { id: 'oc-b1', modelKey: 'kol:oc-1', rowId: 1, manufacturer: 'B', price: '' }] });
  stale.manufacturers.push({ name: 'B' });
  stale.items.push({ id: 'oc-b2', modelKey: 'kol:oc-1', rowId: 1, manufacturer: 'B', price: '', priceLabel: 'Standart', options: [{ id: 'oc-opt', label: 'Opsiyon', price: '3,30', note: '' }] });
  const saved = store.updateRequest(USERS[2], created.id, stale);
  assert.deepEqual(saved.items.map(item => item.id).sort(), ['oc-1', 'oc-b1', 'oc-b2'], 'alternatif fiyatlı satır düşmez; mevcut satır da korunur');
  assert.equal(saved.items.find(item => item.id === 'oc-b2').options[0].price, '3,30');
});

test('üretici yeniden adlandırma (tam kayıt) eski adı geri getirmez', () => {
  const created = createShared({ source: 'collection', manufacturers: [{ name: 'Eski Ad' }], items: [{ id: 'rn-1', modelKey: 'kol:rn-1', manufacturer: 'Eski Ad', price: '3,00' }] });
  const renamed = sim.clone(created);
  renamed.manufacturers = [{ name: 'Yeni Ad' }];
  renamed.items = renamed.items.map(item => ({ ...item, manufacturer: 'Yeni Ad' }));
  const saved = store.updateRequest(owner, created.id, renamed);
  assert.deepEqual(saved.manufacturers.map(m => m.name), ['Yeni Ad']);
  assert.deepEqual(saved.items.map(item => [item.id, item.manufacturer, item.price]), [['rn-1', 'Yeni Ad', '3,00']]);
});

test('aynı süreçte toplu fiyat aktarımı sürerken tek satır PATCH beklemesiz kirada 409 alır; rota yeniden denemesi ikisini de yazar', async () => {
  const { withQuotationWriteRetry } = require(path.join(ROOT, 'server', 'lib', 'quotation-write-retry.js'));
  const created = createShared({ source: 'collection', manufacturers: [{ name: 'A' }], items: [
    { id: 'bt-1', modelKey: 'kol:bt-1', rowId: 1, manufacturer: 'A', price: '' }, { id: 'bt-2', modelKey: 'kol:bt-2', rowId: 2, manufacturer: 'A', price: '' }] });
  const line = created.items[0];
  const identity = { modelKey: line.modelKey, rowId: line.rowId, manufacturer: line.manufacturer, plmId: line.plmId, modelCode: line.modelCode, orderCode: line.orderCode };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let held;
  const holding = new Promise(resolve => { held = resolve; });
  const batch = store.mutateAgent(async options => { held(); await gate; return store.patchLines(USERS[3], created.id, [{ lineId: 'bt-1', baseRev: 0, price: '4,40', identity }], options); });
  await holding; // toplu aktarım kirayı tutuyor
  // Rota yeniden denemesiz: anında meşgul.
  await assert.rejects(() => runWithNonblockingFileLeases(async () => store.patchLine(USERS[4], created.id, 'bt-2', { price: '5,50' })), error => error.code === 'SHARED_WRITE_BUSY');
  const single = runWithNonblockingFileLeases(() => withQuotationWriteRetry(() => store.patchLine(USERS[4], created.id, 'bt-2', { price: '5,50' })));
  setTimeout(release, 40);
  const [batchResult, singleResult] = await Promise.all([batch, single]);
  assert.equal(batchResult.changed, true);
  assert.equal(singleResult.changed, true);
  const after = findRequest(created.id);
  assert.equal(after.items.find(item => item.id === 'bt-1').price, '4,40');
  assert.equal(after.items.find(item => item.id === 'bt-2').price, '5,50');
});

test('yeniden deneme yalnız geçici çekişmeyi tekrarlar ve sınırlıdır', async () => {
  const { withQuotationWriteRetry, RETRYABLE_CODES } = require(path.join(ROOT, 'server', 'lib', 'quotation-write-retry.js'));
  assert.deepEqual([...RETRYABLE_CODES].sort(), ['REVISION_CONFLICT', 'SHARED_WRITE_BUSY']);
  let calls = 0;
  const value = await withQuotationWriteRetry(() => { calls++; if (calls < 3) throw Object.assign(new Error('busy'), { code: 'SHARED_WRITE_BUSY' }); return 'ok'; }, { sleep: async () => {} });
  assert.equal(value, 'ok'); assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(() => withQuotationWriteRetry(() => { calls++; throw Object.assign(new Error('denied'), { code: 'QUOTATION_EDIT_DENIED' }); }, { sleep: async () => {} }), error => error.code === 'QUOTATION_EDIT_DENIED');
  assert.equal(calls, 1, 'yetki/doğrulama hatası tekrarlanmaz');
  calls = 0;
  await assert.rejects(() => withQuotationWriteRetry(() => { calls++; throw Object.assign(new Error('busy'), { code: 'REVISION_CONFLICT' }); }, { sleep: async () => {}, attempts: 4 }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(calls, 4, 'deneme sayısı sınırlıdır; son hata aynen raporlanır');
  // Bütçe süreye bağlıdır: yavaş makinede (her deneme uzun sürer) deneme sayısı
  // dolmadan da sınırda durur; hızlı makinede aynı süre içinde daha çok dener.
  let clock = 0; calls = 0;
  await assert.rejects(() => withQuotationWriteRetry(() => { calls++; clock += 400; throw Object.assign(new Error('busy'), { code: 'SHARED_WRITE_BUSY' }); }, { sleep: async ms => { clock += ms; }, now: () => clock, deadlineMs: 2000, random: () => 0 }), error => error.code === 'SHARED_WRITE_BUSY');
  assert.ok(calls >= 3 && calls <= 5, `süre sınırında durur (deneme: ${calls})`);
  clock = 0; calls = 0;
  const late = await withQuotationWriteRetry(() => { calls++; clock += 150; if (calls < 20) throw Object.assign(new Error('busy'), { code: 'SHARED_WRITE_BUSY' }); return 'ok'; }, { sleep: async ms => { clock += ms; }, now: () => clock, random: () => 0 });
  assert.equal(late, 'ok', 'varsayılan süre bütçesi 12 denemeden uzun çekişmeyi karşılar');
  assert.equal(calls, 20);
});

test('20 kurulum aynı ortak veri köküne eşzamanlı satır PATCH yazar: kayıp güncelleme ve sahte 409 yok', { timeout: process.platform === 'win32' ? 120000 : 60000 }, async () => {
  const shared = fs.mkdtempSync(path.join(tmpRoot, 'shared-instances-'));
  const serverRoot = path.join(shared, 'server');
  const seedRequest = {
    id: 'q-instances', source: 'collection', createdAt: '2026-11-25T08:00:00.000Z', updatedAt: '2026-11-25T08:00:00.000Z', ownerId: owner.id, ownerName: owner.displayName,
    editorIds: ALL_IDS.slice(1), manufacturers: [{ name: 'A' }],
    items: [...USERS.map((_, i) => ({ id: `own-${i}`, modelKey: `kol:inst-${i}`, rowId: i, manufacturer: 'A', price: '' })), { id: 'hot', modelKey: 'kol:inst-hot', rowId: 99, manufacturer: 'A', price: '' }],
  };
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.writeFileSync(path.join(serverRoot, 'quotations.json'), JSON.stringify({ schemaVersion: 1, requests: [store.normalizeRequest(seedRequest)], deletedRequests: {}, _revision: 1 }));
  const K = 4;
  const runs = USERS.map((_, index) => new Promise((resolve, reject) => {
    const ops = Array.from({ length: K }, (_, k) => ({ lineId: `own-${index}`, price: `${10 + index},${10 + k}` }));
    ops.splice(1 + (index % K), 0, { lineId: 'hot', price: `${50 + index},00` });
    const env = { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: serverRoot, BUYER_LOG_LOCAL_DATA_ROOT: path.join(shared, `local-${index}`) };
    const child = spawn(process.execPath, [path.join(__dirname, 'helpers', 'pricing-instance-worker.js'), JSON.stringify({ appRoot: ROOT, index, requestId: seedRequest.id, ops })], { env, cwd: ROOT });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => { if (code !== 0) reject(new Error(`kurulum ${index} çıktı ${code}: ${err}`)); else resolve(JSON.parse(out)); });
  }));
  // Bütün kurulumlar bitmeden temizlik başlamaz (biri başarısız olsa bile).
  const settled = await Promise.allSettled(runs);
  const crashed = settled.find(item => item.status === 'rejected');
  if (crashed) throw crashed.reason;
  const results = settled.map(item => item.value);
  const failures = results.flatMap(result => result.outcomes.filter(item => !item.ok).map(item => ({ index: result.index, ...item })));
  assert.deepEqual(failures, [], 'her kurulumun her satır yazımı kabul edilmeli');
  const saved = JSON.parse(fs.readFileSync(path.join(serverRoot, 'quotations.json'), 'utf8')).requests[0];
  for (let index = 0; index < USERS.length; index++) {
    const line = saved.items.find(item => item.id === `own-${index}`);
    assert.equal(line.price, `${10 + index},${10 + K - 1}`, `kurulum ${index}: son fiyat`);
    assert.equal(line.history.filter(event => event.type === 'offer').length, K, `kurulum ${index}: her teklif defterde`);
  }
  const hot = saved.items.find(item => item.id === 'hot');
  assert.deepEqual(new Set(hot.history.filter(event => event.type === 'offer').map(event => event.by)), new Set(ALL_IDS), 'aynı satırdaki 20 teklif de defterde');
  assert.equal(hot.rev, USERS.length, 'aynı satır 20 kez tek tek ilerler');
});

test('rota ve istemci sözleşmesi: yazım rotaları geçici çekişmeyi yeniden dener, istemci 409 sonrası sunucu hâline döner', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const route = (method, url) => {
    const start = server.indexOf(`app.${method}('${url}'`);
    assert.ok(start >= 0, `${method} ${url} bulunmalı`);
    return server.slice(start, server.indexOf('\n});', start));
  };
  assert.match(route('patch', '/api/quotations/:id/lines/:lineId'), /await withQuotationWriteRetry\(\(\) => quotationStore\.patchLine\(/);
  assert.match(route('put', '/api/quotations/:id'), /await withQuotationWriteRetry\(\(\) => quotationStore\.updateRequest\(/);
  assert.match(route('post', '/api/quotations'), /await withQuotationWriteRetry\(\(\) => quotationStore\.createRequest\(/);
  assert.match(route('post', '/api/quotations/:id/rounds'), /await withQuotationWriteRetry\(\(\) => quotationStore\.startRound\(/);
  assert.match(route('patch', '/api/quotations/:id/status'), /await withQuotationWriteRetry\(\(\) => quotationStore\.setStatus\(/);
  const quotes = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
  const lineOp = quotes.slice(quotes.indexOf('function qQueueLineOp('), quotes.indexOf('// Kaynak etiketi'));
  assert.match(lineOp, /err\?\.status===409/, 'tükenen çekişmede ekran kaydedilmemiş fiyatı göstermeye devam etmez');
  assert.match(lineOp, /const before=qOpenWorkspaceSignature\(\);await qHydrateShared\(true\);qRefreshOpenWorkspace\(before\);/, 'açık Fiyat Masası da sunucu hâliyle yeniden çizilir');
});
