'use strict';
/*
 * v4.24 — Quotations'ta Drop düğmesinin ikinci tıklamayı beklemesi.
 *
 * Belirti: bir modeli drop ettikten sonra diğer modelleri drop ederken düğmeye
 * iki kez basmak gerekiyordu.
 *
 * Kök neden: qSave arka planda sunucuya PUT atıyor ve dönen kayıt için
 * qReplaceRequest çağrılıyordu. Bu fonksiyon depodaki istek nesnesini YENİ bir
 * nesneyle DEĞİŞTİRİYORDU. Oysa qRenderDetail içindeki bütün olay dinleyicileri
 * (Drop, Onayla, fiyat, sil) render anındaki `req` nesnesini kapatıyor ve
 * getLine = id => req.items.find(...) o nesne üzerinden arıyor.
 *
 * Yani ilk Drop'tan sonra ekrandaki dinleyiciler artık depoda olmayan bir nesneyi
 * güncelliyor, qRenderDetail ise depodaki yeni nesneyi çiziyordu: tıklama hiçbir
 * şey yapmamış gibi görünüyor, ikinci tıklama gerekiyordu.
 *
 * Çözüm: qReplaceRequest alanları YERİNDE birleştirir, nesne kimliği korunur.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf-8');

// qReplaceRequest'i bağımlılıkları taklit ederek izole çalıştır.
function loadReplaceRequest(store) {
  const match = SRC.match(/function qReplaceRequest\(request\)\{[\s\S]*?\n  \}/);
  assert.ok(match, 'qReplaceRequest bulunamadı');
  const factory = new Function('qNormalizeRequest', 'qLoad', 'qPersistLocal', `return (${match[0]})`);
  return factory(
    request => JSON.parse(JSON.stringify(request)), // sunucu yanıtı her zaman yeni nesnedir
    () => store,
    () => {},
  );
}

function request(id, items) {
  return { id, source: 'collection', updatedAt: '2026-08-01T00:00:00.000Z', items };
}

test('sunucu yanıtı istek nesnesinin kimliğini değiştirmez', () => {
  const store = { requests: [request('q1', [{ id: 'l1', dropped: false }])] };
  const before = store.requests[0];
  const replaceRequest = loadReplaceRequest(store);

  replaceRequest(request('q1', [{ id: 'l1', dropped: true }]));

  assert.strictEqual(store.requests[0], before,
    'depodaki nesne AYNI kalmalı; ekrandaki dinleyiciler bu nesneyi kapatıyor');
});

test('içerik sunucudan gelen hâle güncellenir', () => {
  const store = { requests: [request('q1', [{ id: 'l1', dropped: false }])] };
  const replaceRequest = loadReplaceRequest(store);

  replaceRequest(request('q1', [{ id: 'l1', dropped: true }, { id: 'l2', dropped: false }]));

  assert.strictEqual(store.requests[0].items.length, 2);
  assert.strictEqual(store.requests[0].items[0].dropped, true);
});

test('ekrandaki eski referans üzerinden yapılan Drop hâlâ depoya işler', () => {
  // Render sırasında yakalanan referans (dinleyicilerin kapattığı nesne).
  const store = { requests: [request('q1', [{ id: 'l1', dropped: false }, { id: 'l2', dropped: false }])] };
  const renderedReq = store.requests[0];
  const replaceRequest = loadReplaceRequest(store);

  // 1) İlk Drop → arka plan kaydı döner.
  renderedReq.items.find(i => i.id === 'l1').dropped = true;
  replaceRequest(request('q1', [{ id: 'l1', dropped: true }, { id: 'l2', dropped: false }]));

  // 2) İkinci Drop, ekrandaki ESKİ referans üzerinden yapılır (tıpkı arayüzdeki gibi).
  const getLine = id => renderedReq.items.find(x => x.id === id);
  const line = getLine('l2');
  assert.ok(line, 'eski referans üzerinden satır bulunabilmeli');
  line.dropped = true;

  // Depodaki aktif kayıt bu değişikliği TEK tıklamada görmeli.
  assert.strictEqual(store.requests[0].items.find(i => i.id === 'l2').dropped, true,
    'ikinci Drop tek tıklamada işlemeli');
});

test('sunucuda kalmayan alanlar temizlenir', () => {
  const store = { requests: [Object.assign(request('q1', []), { notebookPageId: 'p1' })] };
  const replaceRequest = loadReplaceRequest(store);
  replaceRequest(request('q1', []));
  assert.strictEqual('notebookPageId' in store.requests[0], false);
});

test('bilinmeyen istek listeye eklenir', () => {
  const store = { requests: [] };
  const replaceRequest = loadReplaceRequest(store);
  const added = replaceRequest(request('yeni', []));
  assert.strictEqual(store.requests.length, 1);
  assert.strictEqual(store.requests[0].id, 'yeni');
  assert.strictEqual(added.id, 'yeni');
});

test('nesne kimliğini değiştiren eski yazım geri gelmemeli', () => {
  assert.ok(!/st\.requests\[index\]\s*=\s*normalized/.test(SRC),
    'depodaki nesneyi yenisiyle değiştirmek eski/yeni referans ayrışmasına yol açıyor');
  assert.ok(SRC.includes('Object.assign(existing,normalized)'), 'yerinde birleştirme korunmalı');
});
