'use strict';

/* KOLEKSİYON'A YANSITMA — 20 KULLANICI (v2026-11-25).

   Sahibin istemcisi (qProjectForeignLineEdits) editörlerin satır değişikliğini
   Koleksiyon'a bir kez ve model × üretici başına en yeni satırdan yansıtır.

   RED ile kanıtlanan kök neden: "en yeni" yalnız YABANCI satırlar arasında
   seçiliyordu. Aynı model × üretici için sahibin başka bir talepte (veya diğer
   cihazında) yaptığı daha yeni fiyat/onay dikkate alınmıyordu; editörün daha
   eski değişikliği geç göründüğünde (senkron gecikmesi, sahibin ikinci cihazı)
   Koleksiyon'daki yeni değer eski değere geri dönüyordu. Sahibin Koleksiyon'dan
   elle yaptığı düzeltme de kendi satır düzenlemesidir; aynı kural onu korur. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sim = require('./helpers/pricing-sim');

const QUOTES = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* Gerçek fonksiyon; DOM/Koleksiyon yazımı kayıt eden saplarla. */
function projector(me) {
  const storage = new Map();
  const ctx = { requests: [], writes: [], saves: 0 };
  const body = [
    "const qNorm=v=>String(v==null?'':v).trim();",
    "const PROJECTED_KEY='lcw.quotations.projectedLineEdits.v1';",
    'const qLoad=()=>({requests:ctx.requests});',
    'const qCurrentUserId=()=>me;',
    'const qCanProjectToCollection=req=>req.ownerId===me;',
    'const qWritePriceToCollection=(req,item)=>{ctx.writes.push({requestId:req.id,lineId:item.id,rowId:item.rowId,manufacturer:item.manufacturer,price:item.price,approved:item.approved,at:item.updatedAt});return true;};',
    'const saveKolRows=()=>{ctx.saves++;};const qRefreshCollection=()=>{};',
    functionSource(QUOTES, 'qProjectForeignLineEdits'),
    'return qProjectForeignLineEdits;',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const run = new Function('ctx', 'me', 'kolRows', 'BLStorage', body)(ctx, me, [{ id: 1 }], { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) });
  storage.set('lcw.quotations.projectedLineEdits.v1', '{}'); // ilk çalışma değil
  return { ctx, run };
}
const line = (id, rowId, manufacturer, price, at, by, extra = {}) => ({ id, modelKey: `kol:${rowId}`, rowId, manufacturer, price, approved: false, dropped: false, updatedAt: at, updatedBy: by, ...extra });

test('eski talepteki editör fiyatı, sahibin yeni talepteki daha yeni fiyatını Koleksiyon\'da geri almaz', () => {
  const { ctx, run } = projector('owner');
  ctx.requests = [
    { id: 'old', source: 'collection', ownerId: 'owner', items: [line('l-old', 1, 'X', '5,00', '2026-11-25T09:00:00.000Z', 'editor-1', { approved: true })] },
    { id: 'new', source: 'collection', ownerId: 'owner', items: [line('l-new', 1, 'X', '4,00', '2026-11-25T10:00:00.000Z', 'owner', { approved: true })] },
  ];
  run();
  assert.deepEqual(ctx.writes, [], 'sahibin daha yeni satırı varken eski yabancı değişiklik yansımaz');
  // Editör daha sonra yeniden fiyat verirse (en yeni satır o olur) bir kez yansır.
  ctx.requests[0].items[0] = line('l-old', 1, 'X', '3,90', '2026-11-25T11:00:00.000Z', 'editor-1');
  run(); run();
  assert.deepEqual(ctx.writes.map(write => [write.lineId, write.price]), [['l-old', '3,90']]);
});

test('sahibin Koleksiyon\'dan elle düzeltmesi (kendi satır düzenlemesi) sonraki çalışmalarda ezilmez', () => {
  const { ctx, run } = projector('owner');
  ctx.requests = [{ id: 'r', source: 'collection', ownerId: 'owner', items: [line('l1', 2, 'Y', '6,00', '2026-11-25T09:00:00.000Z', 'editor-2')] }];
  run();
  assert.equal(ctx.writes.length, 1, 'editör değişikliği bir kez yansır');
  // Sahip elle düzeltti: Koleksiyon fiyatı aynı satıra sahip düzenlemesi olarak yazılır (recordManualCollectionPrice).
  ctx.requests[0].items[0] = line('l1', 2, 'Y', '5,50', '2026-11-25T09:30:00.000Z', 'owner');
  // Başka talepte aynı hücre için geç görünen daha eski editör değişikliği.
  ctx.requests.push({ id: 'r2', source: 'collection', ownerId: 'owner', items: [line('l2', 2, 'Y', '7,00', '2026-11-25T09:10:00.000Z', 'editor-3')] });
  run(); run();
  assert.equal(ctx.writes.length, 1, 'elle düzeltme eski yansımayla ezilmez');
});

for (const seed of sim.SEEDS) {
  test(`20 kullanıcı, gecikmeli görünürlük: Koleksiyon hücresi hiçbir zaman daha eski bir değere dönmez ve sonunda en yeni satırı gösterir (seed ${seed})`, async () => {
    const random = sim.seededRandom(seed), log = [], clock = sim.createClock();
    const users = Array.from({ length: 20 }, (_, i) => (i === 0 ? 'owner' : `editor-${i}`));
    const { ctx, run } = projector('owner');
    // Sahibin 3 talebi aynı 6 model × 3 üretici hücresini taşır (yeniden teklif).
    const truth = new Map(); // satır kimliği → en yeni gerçek hâl (sunucu)
    const requests = ['r1', 'r2', 'r3'];
    for (const requestId of requests) for (let row = 1; row <= 6; row++) for (const mfr of ['X', 'Y', 'Z']) truth.set(`${requestId}-${row}-${mfr}`, { requestId, ...line(`${requestId}-${row}-${mfr}`, row, mfr, '', '', '') });
    const visibleAt = new Map(); // sürüm → sahibin istemcisinde görüneceği zaman
    const versions = []; // { at, visible, item }
    const collection = new Map(); // hücre → { price, at }
    const cellOf = item => `${item.rowId}|${item.manufacturer}`;
    await sim.withRepro('pricing-projection', seed, log, async () => {
      for (let ordinal = 0; ordinal < sim.scale(400); ordinal++) {
        const by = sim.pick(random, users), id = sim.pick(random, [...truth.keys()]);
        const at = clock(users.indexOf(by));
        const next = { ...truth.get(id), price: sim.price(random), updatedAt: at, updatedBy: by };
        truth.set(id, next);
        // Sahibin kendi düzenlemesi kendi istemcisinde anında Koleksiyon'a yazılır; yabancı olan gecikmeyle görünür.
        const visible = by === 'owner' ? ordinal : ordinal + sim.int(random, 40);
        versions.push({ ordinal, visible, item: next });
        if (by === 'owner') collection.set(cellOf(next), { price: next.price, at });
        log.push({ ordinal, by, id, at, price: next.price, visible });
        visibleAt.set(`${id}@${at}`, visible);
        if (random() < 0.25) project(ordinal);
      }
      project(Infinity);
      // Sonunda her hücre, bütün taleplerdeki en yeni satırı gösterir.
      const latest = new Map();
      for (const item of truth.values()) if (item.updatedAt && (!latest.has(cellOf(item)) || item.updatedAt > latest.get(cellOf(item)).updatedAt)) latest.set(cellOf(item), item);
      for (const [cell, item] of latest) assert.equal(collection.get(cell)?.price, item.price, `${cell}: en yeni satırın fiyatı`);
    });
    function project(now) {
      // Sahibin istemcisinin o anda gördüğü sunucu hâli.
      const known = new Map();
      for (const version of versions) if (version.visible <= now) known.set(version.item.id, version.item);
      ctx.requests = requests.map(requestId => ({ id: requestId, source: 'collection', ownerId: 'owner', items: [...truth.values()].filter(item => item.requestId === requestId).map(item => known.get(item.id) || { ...item, price: '', updatedAt: '', updatedBy: '' }) }));
      const from = ctx.writes.length;
      run();
      for (const write of ctx.writes.slice(from)) {
        const cell = `${write.rowId}|${write.manufacturer}`, prev = collection.get(cell);
        assert.ok(!prev || write.at >= prev.at, `${cell}: ${prev && prev.at} değerinden daha eski ${write.at} değerine dönmemeli`);
        collection.set(cell, { price: write.price, at: write.at });
      }
    }
  });
}
