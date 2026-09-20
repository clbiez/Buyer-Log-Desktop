'use strict';

// v5.96 — Fiyat Geçmişi'nde fiyat revize/silme ve Quotations'a yansıma.
//
// Fiyat Geçmişi ayrı bir veri kümesi DEĞİL, quotation kalemleri üzerinden kurulan
// bir görünümdür (qhCollect → qLoad().requests[].items[]). Bu yüzden burada
// yapılan değişiklik doğrudan quotation kaydına yazılır; Quotations ekranı aynı
// kaydı okuduğu için ayrıca senkronize edilmesi gerekmez — tek kaynak korunur.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Q = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function bodyOf(name) {
  const start = Q.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = Q.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < Q.length; i++) {
    if (Q[i] === '{') depth++;
    else if (Q[i] === '}' && --depth === 0) return Q.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

// Gerçek yardımcıları izole çalıştırmak için sahte bir mağaza kuruyoruz.
function makeStore() {
  const request = {
    id: 'req-1', updatedAt: '2026-01-01T00:00:00.000Z',
    items: [
      { id: 'line-1', price: 4.5, manufacturer: 'A', approved: true },
      { id: 'line-2', price: 5.25, manufacturer: 'B', approved: false },
    ],
  };
  const saved = [];
  const env = {
    qLoad: () => ({ requests: [request] }),
    qMoneyNumber: value => { const n = Number(String(value == null ? '' : value).replace(',', '.')); return Number.isFinite(n) ? n : null; },
    qValidPrice: value => Number.isFinite(value) && value > 0,
    qSave: req => { saved.push(req.id); return true; },
  };
  const find = new Function('qLoad', `return function qhFindItem(requestId,itemId){${bodyOf('qhFindItem')}};`)(env.qLoad);
  // v5.99: düzenleme/silme artık Koleksiyon'a da yansıyor; sahte karşılıkları verilir.
  const synced = [];
  const qWritePriceToCollection = (req, item) => { synced.push(item.id); return true; };
  const qRefreshCollection = () => {};
  const update = new Function('qhFindItem', 'qMoneyNumber', 'qValidPrice', 'qSave', 'qWritePriceToCollection', 'qRefreshCollection',
    `return async function qhUpdatePrice(requestId,itemId,rawPrice){${bodyOf('qhUpdatePrice')}};`
  )(find, env.qMoneyNumber, env.qValidPrice, env.qSave, qWritePriceToCollection, qRefreshCollection);
  const drop = new Function('qhFindItem', 'qSave', 'qWritePriceToCollection', 'qRefreshCollection',
    `return async function qhDropItem(requestId,itemId){${bodyOf('qhDropItem')}};`
  )(find, env.qSave, qWritePriceToCollection, qRefreshCollection);
  return { request, saved, update, drop, synced };
}

test('v5.96 fiyat revizesi quotation kalemine yazılıyor', async () => {
  const store = makeStore();
  const result = await store.update('req-1', 'line-2', '6,75');
  assert.equal(result.ok, true);
  assert.equal(result.price, 6.75);
  // Değişiklik KAYNAK kayda uygulanmalı; Quotations aynı kaydı okuduğu için
  // yansıma kendiliğinden olur.
  assert.equal(store.request.items[1].price, 6.75);
  assert.deepEqual(store.saved, ['req-1'], 'kayıt sunucuya gönderilmeli');
  // Değişiklik zamanı güncellenmeli.
  assert.notEqual(store.request.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('v5.96 onaylanmış fiyat da revize edilebiliyor', async () => {
  // Kullanıcı kararı: tüm fiyatlar için geçerli.
  const store = makeStore();
  assert.equal(store.request.items[0].approved, true);
  const result = await store.update('req-1', 'line-1', '3.90');
  assert.equal(result.ok, true);
  assert.equal(store.request.items[0].price, 3.9);
  assert.equal(store.request.items[0].approved, true, 'onay bilgisi korunmalı');
});

test('v5.96 geçersiz ve değişmemiş fiyat kaydedilmiyor', async () => {
  const store = makeStore();
  for (const value of ['', 'abc', '0', '-2']) {
    const result = await store.update('req-1', 'line-2', value);
    assert.equal(result.ok, false, `${value} reddedilmeli`);
    assert.equal(result.reason, 'invalid');
  }
  // Aynı değeri tekrar yazmak gereksiz kayıt üretmemeli.
  const same = await store.update('req-1', 'line-2', '5.25');
  assert.equal(same.ok, false);
  assert.equal(same.reason, 'unchanged');
  assert.deepEqual(store.saved, [], 'hiçbiri kaydedilmemeli');
  assert.equal(store.request.items[1].price, 5.25);
});

test('v5.96 bulunamayan kalem sessizce başarısız olmuyor', async () => {
  const store = makeStore();
  assert.equal((await store.update('yok', 'line-1', '2')).reason, 'missing');
  assert.equal((await store.drop('req-1', 'yok')).reason, 'missing');
  assert.deepEqual(store.saved, []);
});

test('v5.96 silme kalemi yok etmiyor, dropped olarak işaretliyor', async () => {
  // Kalemi kayıttan çıkarmak, ona bağlı onay/kapasite bilgisini ve teklif
  // satırının izini de yok ederdi. dropped hem Fiyat Geçmişi'nden hem
  // Quotations listesinden düşürür ama kaydın izini bırakır.
  const store = makeStore();
  const result = await store.drop('req-1', 'line-1');
  assert.equal(result.ok, true);
  assert.equal(store.request.items.length, 2, 'kalem silinmemeli');
  assert.equal(store.request.items[0].dropped, true);
  assert.equal(store.request.items[0].price, 4.5, 'fiyat izi korunmalı');
  assert.deepEqual(store.saved, ['req-1']);
  // v5.99: düşülen fiyat Koleksiyon'daki Best Price hesabından da çıkmalı.
  assert.deepEqual(store.synced, ['line-1']);
});

test('v5.96 dropped kalemler Fiyat Geçmişi görünümünden düşüyor', () => {
  // qhCollect zaten dropped kalemleri atlıyor; silme bu mevcut kurala bağlanıyor.
  assert.match(bodyOf('qhCollect'), /if\(item\.dropped\) return;/);
});

test('v5.96 hücreler quotation kimliğini taşıyor', () => {
  // Kimlik olmadan düzenleme hangi kayda gideceğini bilemez.
  assert.match(Q, /requestId:req\.id, itemId:item\.id,/);
  assert.match(Q, /count,requestId:r\.requestId,itemId:r\.itemId,manufacturer:r\.manufacturer/);
  // Hem sıralı hem üretici bazlı görünümde hücre düzenlenebilir olmalı.
  assert.equal((Q.match(/data-qh-req="\$\{qhEsc\(c\.requestId\|\|''\)\}"/g) || []).length, 2);
  assert.equal((Q.match(/data-qh-drop/g) || []).length, 3);
});

test('v5.96 düzenleme sonrası tablo baştan hesaplanıyor', () => {
  const block = Q.slice(Q.indexOf('async function qhRefreshFromStore'), Q.indexOf('function qhBeginEdit'));
  // Yalnız hücre metnini değiştirmek madalyaları, hedef farkını ve sıralamayı
  // eski değerde bırakır; veri yeniden toplanmalı.
  assert.match(block, /const fresh=qhCollect\(rows\);/);
  assert.match(block, /const pivot=qhPivot\(fresh\);/);
  assert.match(block, /orderedColumnCount=Math\.max\(0/);
  assert.match(block, /repaint\(\);/);
  // models/manufacturers yerinde güncellenmeli ki kapanışlar aynı diziyi görsün.
  assert.match(block, /models\.length=0; models\.push\(\.\.\.pivot\.models\);/);
});

test('v5.96 düzenlemede ESC pencereyi kapatmıyor', () => {
  const block = Q.slice(Q.indexOf('function qhBeginEdit'), Q.indexOf("tbody?.addEventListener('dblclick'"));
  // Genel ESC kuralı en üstteki pencereyi kapatır; hücre düzenlemesinde olay
  // durdurulmazsa kullanıcı iptal ederken pencereyi de kaybederdi.
  assert.match(block, /event\.key==='Escape'.*event\.stopPropagation\(\); finish\(false\)/s);
  // Odak kaybında değişiklik kaydedilmeli.
  assert.match(block, /input\.addEventListener\('blur',\(\)=>finish\(true\)\)/);
});

test('v5.96 silme teyit istiyor', () => {
  const block = Q.slice(Q.indexOf("tbody?.addEventListener('click'"), Q.indexOf('function repaint()'));
  assert.match(block, /window\.confirm\(/);
  assert.match(block, /Quotation kaydından da düşecek/);
  assert.match(CSS, /td\.qhEditable \.qhCellDrop\{/);
});
