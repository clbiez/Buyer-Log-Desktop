'use strict';

/* İŞBİRLİKÇİ (COOPERATIVE) ADIMLI AYRIŞTIRMA.
 *
 * Model yenilemesinde ASAS/LFL ayrıştırması 60 bin satırda ana iş parçacığını
 * saniyelerce kilitliyordu. Ayrıştırma bir worker'a ya da compute havuzuna
 * taşınmaz (paylaşılan heap kafesi çökmeleri, #1148 geri alındı). Bunun yerine
 * ayrıştırıcı döngü bir generator olarak yazılır ve belirli aralıklarla `yield`
 * eder; TEK uygulama iki sürücüyle çalışır:
 *   - runStepsSync: eski senkron çağıranlar; davranış ve çıktı birebir aynıdır.
 *   - runStepsAsync: süre bütçesi dolunca olay döngüsüne (setImmediate) döner.
 * Generator, `yield` noktaları dışında aynı kodu aynı sırayla çalıştırır; böylece
 * iki sürücünün çıktısı bayt bayt aynıdır.
 */

const { performance } = require('node:perf_hooks');

// Döngülerde kaç satırda bir yield noktası olacağı (2'nin kuvveti - 1 maske).
const STEP_MASK = 511;
const DEFAULT_BUDGET_MS = 40;

const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

function runStepsSync(iterator) {
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

async function runStepsAsync(iterator, options = {}) {
  const budgetMs = Number(options.budgetMs) > 0 ? Number(options.budgetMs) : DEFAULT_BUDGET_MS;
  const yieldControl = typeof options.yieldControl === 'function' ? options.yieldControl : yieldToEventLoop;
  let start = performance.now();
  let step = iterator.next();
  while (!step.done) {
    if (performance.now() - start >= budgetMs) {
      await yieldControl();
      start = performance.now();
    }
    step = iterator.next();
  }
  return step.value;
}

module.exports = { STEP_MASK, DEFAULT_BUDGET_MS, yieldToEventLoop, runStepsSync, runStepsAsync };
