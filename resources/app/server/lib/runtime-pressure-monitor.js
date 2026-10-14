'use strict';

/* Olay döngüsü ve heap baskısı tanılaması.

   Sahada sunucu açılıştan sonra hiçbir log yazmadan dakikalarca yanıtsız
   kaldı; logda bunun bellek baskısı mı yoksa uzun bir eşzamanlı iş mi olduğunu
   ayıracak hiçbir iz yoktu. Bu izleyici yalnız sayısal ölçüm yazar
   (kullanıcı, yol veya iş verisi içermez):
   - açılışta V8 heap sınırı,
   - olay döngüsü eşikten uzun bloke kaldıysa, döngü serbest kaldığı anda
     süresiyle birlikte,
   - heap kullanımı sınırın %80'ini aştığında (dakikada en çok bir kez). */
const v8 = require('v8');

const MB = 1048576;
function heapNumbers() {
  const stats = v8.getHeapStatistics();
  return {
    heapUsedMb: Math.round(stats.used_heap_size / MB),
    heapLimitMb: Math.round(stats.heap_size_limit / MB),
    rssMb: Math.round(process.memoryUsage.rss() / MB),
  };
}
function formatLine(kind, values) {
  return `[RUNTIME] ${kind} ${Object.entries(values).map(([key, value]) => `${key}=${value}`).join(' ')}`;
}
function startRuntimePressureMonitor({ log = console.log, intervalMs = 5000, stallMs = 3000, pressureRatio = 0.8, pressureEveryMs = 60000, now = Date.now } = {}) {
  log(formatLine('heap-limit', heapNumbers()));
  let expected = now() + intervalMs, lastPressureAt = 0;
  const timer = setInterval(() => {
    const at = now(), lagMs = at - expected;
    expected = at + intervalMs;
    const numbers = heapNumbers();
    if (lagMs >= stallMs) log(formatLine('event-loop-stall', { blockedMs: lagMs, ...numbers }));
    if (numbers.heapUsedMb >= numbers.heapLimitMb * pressureRatio && at - lastPressureAt >= pressureEveryMs) {
      lastPressureAt = at;
      log(formatLine('heap-pressure', numbers));
    }
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

module.exports = { startRuntimePressureMonitor, formatLine };
