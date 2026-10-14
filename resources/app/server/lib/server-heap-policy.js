'use strict';

/* Sunucu V8 bellek sınırı politikası (gözetmen kullanır).

   Saha logu: büyük ASAS veri setinde sunucu ~2 GB V8 sınırında çalışıyordu.
   Her yenileme "snapshot-save" adımında heap out of memory ile çöktü; hazır
   ekran önbelleği ıskaladığında soğuk snapshot yüklemesi aynı sınırda GC
   döngüsüne girip sunucuyu dakikalarca yanıtsız bıraktı (giriş/ilk veri
   ekranı hiç açılmadı). V8 varsayılan sınırı fiziksel belleğin ~1/4'üdür;
   8 GB'lık bir makinede bu ~2 GB eder. Electron 44 (pointer compression)
   en fazla ~4 GB'a izin verir.

   Kural: sınır RAM'in %45'i (6 GB altı makinelerde %40), [1024, 4096] MB
   aralığında. Yalnız V8'in kendiliğinden vereceği sınırdan büyükse bayrak
   eklenir. V8 64-bit varsayılanı ~15 GB altında min(RAM/4, 2 GB), üstünde
   min(RAM/4, 4 GB)'dir; 16 GB'ta 4 GB zaten varsayılandır. Kullanıcı/yönetici NODE_OPTIONS veya
   BUYER_LOG_MAX_HEAP_MB ile kendi değerini verdiyse o korunur;
   BUYER_LOG_MAX_HEAP_MB=0 politikayı kapatır. */
const MIN_MB = 1024;
const MAX_MB = 4096;
const RAM_SHARE = 0.45;
const SMALL_RAM_SHARE = 0.4;
const SMALL_RAM_MB = 6144;
const FLAG = '--max-old-space-size';

function hasHeapFlag(value) {
  return String(value || '').split(/\s+/).some(part => part === FLAG || part.startsWith(`${FLAG}=`));
}
function clampMb(value) {
  return Math.max(MIN_MB, Math.min(MAX_MB, Math.floor(value)));
}
function v8DefaultMb(totalMb) {
  return Math.min(totalMb < 15360 ? 2048 : MAX_MB, Math.floor(totalMb / 4));
}
function serverHeapArgs({ env = {}, execArgv = [], totalMemBytes = 0 } = {}) {
  const totalMb = Math.floor(Number(totalMemBytes) / 1048576) || 0;
  const configured = String(env.BUYER_LOG_MAX_HEAP_MB == null ? '' : env.BUYER_LOG_MAX_HEAP_MB).trim();
  if (configured === '0' || /^off$/i.test(configured)) return { args: [], limitMb: null, source: 'disabled', totalMb };
  // The watchdog's own execArgv is forwarded so a flag given to it reaches the server.
  const own = execArgv.find(hasHeapFlag);
  if (own) return { args: [own], limitMb: Number(String(own).split('=')[1]) || null, source: 'watchdog-flag', totalMb };
  if (hasHeapFlag(env.NODE_OPTIONS)) return { args: [], limitMb: null, source: 'inherited', totalMb };
  if (/^\d+$/.test(configured)) {
    const limitMb = clampMb(Number(configured));
    return { args: [`${FLAG}=${limitMb}`], limitMb, source: 'configured', totalMb };
  }
  if (!totalMb) return { args: [], limitMb: null, source: 'unknown-memory', totalMb };
  const limitMb = clampMb(totalMb * (totalMb < SMALL_RAM_MB ? SMALL_RAM_SHARE : RAM_SHARE));
  if (limitMb <= v8DefaultMb(totalMb)) return { args: [], limitMb: null, source: 'v8-default', totalMb };
  return { args: [`${FLAG}=${limitMb}`], limitMb, source: 'auto', totalMb };
}

module.exports = { serverHeapArgs, hasHeapFlag, MIN_MB, MAX_MB };
