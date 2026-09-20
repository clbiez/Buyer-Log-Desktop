'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// BL-011: automation-recipe-store.js TÜM kullanıcıların tariflerini tek dosyada
// tutuyor, oku-değiştir-yaz sırasında eşzamanlı bir yazma araya girerse (ör.
// runScheduledAutomations 60sn'lik zamanlayıcısı ile kullanıcının elle tetiklediği
// bir çalıştırma çakışırsa) diğer yazarın değişikliği kaybolabiliyordu. Bu test
// tam olarak o pencereyi simüle eder: store.updateRecipe() dosyayı OKUDUKTAN
// hemen sonra, o YAZMADAN ÖNCE başka bir "süreç" aynı dosyaya yeni bir kayıt yazar.
// Düzeltme sonrası bu durum sessizce üstüne yazılmamalı, ikisi de korunmalıdır.

function loadStoreWithRoot(root) {
  const oldRoot = process.env.BUYER_LOG_SERVER_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  const userDataPath = require.resolve('../server/user-data');
  const storePath = require.resolve('../server/lib/automation-recipe-store');
  delete require.cache[userDataPath]; delete require.cache[storePath];
  const mod = require('../server/lib/automation-recipe-store');
  return {
    mod,
    restore() {
      delete require.cache[userDataPath]; delete require.cache[storePath];
      if (oldRoot == null) delete process.env.BUYER_LOG_SERVER_DATA_ROOT; else process.env.BUYER_LOG_SERVER_DATA_ROOT = oldRoot;
    },
  };
}

test('eşzamanlı yazma penceresinde bir yarışmacının kaydı diğerini sessizce silmez', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-automation-race-'));
  const { mod: store, restore } = loadStoreWithRoot(tmp);
  const storeFile = path.join(tmp, 'automation-recipes.json');
  try {
    const original = store.createRecipe('u1', { name: 'İlk tarif', jobType: 'email' });

    // "Yarışmacı" yazma: updateRecipe kendi loadStore()'unu yaptıktan HEMEN SONRA,
    // henüz saveStore çağrılmadan, dosyaya bağımsız bir yazma enjekte ediyoruz —
    // gerçek dünyada bu, aynı 60sn'lik zamanlayıcı turunda başka bir kullanıcının
    // tarifi kaydetmesi veya runScheduledAutomations'ın bir run kaydı eklemesidir.
    let injected = false;
    const realReadFileSync = fs.readFileSync;
    fs.readFileSync = function patched(file, ...args) {
      const result = realReadFileSync.call(fs, file, ...args);
      if (!injected && String(file) === storeFile) {
        injected = true;
        const raw = JSON.parse(result.toString('utf8'));
        const concurrent = { ...raw, revision: raw.revision + 1, recipes: [...raw.recipes, { id: 'recipe_concurrent', ownerId: 'u2', name: 'Yarışmacının tarifi', jobType: 'email', enabled: true, filters: [], steps: [], schedule: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1 }] };
        fs.writeFileSync(storeFile, JSON.stringify(concurrent, null, 2), 'utf8');
      }
      return result;
    };
    let updated;
    try {
      updated = store.updateRecipe('u1', original.result.id, { name: 'Güncellenmiş tarif' });
    } finally {
      fs.readFileSync = realReadFileSync;
    }

    assert.equal(updated.result.name, 'Güncellenmiş tarif', 'kendi güncellememiz uygulanmalı');

    const finalRaw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const ownRecipe = finalRaw.recipes.find(r => r.id === original.result.id);
    const concurrentRecipe = finalRaw.recipes.find(r => r.id === 'recipe_concurrent');
    assert.ok(ownRecipe, 'kendi tarifimiz dosyada olmalı');
    assert.equal(ownRecipe.name, 'Güncellenmiş tarif');
    assert.ok(concurrentRecipe, 'yarışmacının eşzamanlı yazdığı tarif KAYBOLMAMALI — bu tam olarak BL-011\'in düzelttiği kayıp güncelleme senaryosu');
  } finally {
    restore();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
