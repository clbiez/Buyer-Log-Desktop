'use strict';

/* KOLEKSİYON — 20 KURULUMLU SEED'Lİ SENKRON SİMÜLASYONU
 *
 * Sahibin iki kurulumu, on düzenleyici, beş izleyici ve üç yetkisiz kullanıcı
 * aynı sahibin Koleksiyonunu ortak hub üzerinden eşitler. Her epoch'ta
 * çevrimdışı cihazlar yerel düzenleme biriktirir; yoklamalar seed'li sırayla
 * gecikir, karışır ve çift çalışır; bozuk nihai JSON penceresi, yarım geçici
 * dosya ve OneDrive çakışma kopyası enjekte edilir. Her epoch sonunda en fazla
 * üç tam yoklama turunda bütün yetkili kurulumların aynı kopyaya yakınsaması,
 * her kabul edilen alanın (fiyat haritasında üretici anahtarının) korunması,
 * silinen satırın dirilmemesi, eklenen satırın kaybolmaması, sahte çakışma
 * olmaması ve yetkisiz kurulumun hiçbir satır almaması zorunludur. Son sessiz
 * turda hiçbir kurulum yeniden okuma/yayım yapmaz.
 *
 * Başarısız seed, sentetik işlem günlüğünü yazar (COLLECTION_SYNC_SIM_REPRO).
 * Tam sıralı tekrar: BUYERLOG_COLLECTION_SIM_SERIAL=1. Uzun koşu:
 * BUYERLOG_COLLECTION_SIM_SOAK=1. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCollectionScenario } = require('./helpers/collection-sync-sim');

// Gerçek dosya G/Ç'si ve kira kullanılır; Windows barındırılan koşucuda aynı
// iş belirgin biçimde yavaştır. Süre bir tamamlanma bekçisidir, gecikme ölçütü
// değildir; her seed, işlem ve değişmez denetimi korunur.
const SCENARIO_TIMEOUT_MS = process.platform === 'win32' ? 120000 : 30000;
for (const seed of [20261125, 4242, 0xC011EC]) {
  test(`Koleksiyon simülasyonu: 20 kurulum, 120 işlem, seed ${seed}`, { timeout: SCENARIO_TIMEOUT_MS }, async t => {
    const result = await runCollectionScenario({ seed, devices: 20, operations: 120 });
    assert.ok(result.operations >= 100);
    assert.ok(result.metrics.applied > 60, 'scenario applied real edits');
    assert.ok(result.metrics.offlineEdits > 0 && result.metrics.corruptWindows === 3);
    assert.ok(result.metrics.settleRounds.every(rounds => rounds <= 3));
    t.diagnostic(JSON.stringify(result));
  });
}

test('Koleksiyon simülasyonu soak: 20 kurulum, 2.400 işlem', { skip: process.env.BUYERLOG_COLLECTION_SIM_SOAK !== '1', timeout: 900000 }, async t => {
  for (const seed of [7, 8, 9, 10]) {
    const result = await runCollectionScenario({ seed, devices: 20, operations: 600, epochs: 6 });
    t.diagnostic(JSON.stringify(result));
  }
});
