'use strict';

/* Fiyat Masası çok kullanıcılı senkron testleri için ortak, seed'li yardımcılar.
   Gerçek iş verisi kullanılmaz; bütün kimlik, ad ve fiyatlar sentetiktir.
   Başarısız senaryo seed + işlem kaydını dosyaya yazar ve hata mesajına
   PRICING_SYNC_REPRO satırı ekler; aynı seed ile birebir tekrar üretilir. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seededRandom } = require('./sync-sim');

const SOAK = process.env.BUYERLOG_PRICING_SOAK === '1';
// Varsayılan koşu Windows runner'da da kısa kalır; ağır koşu yalnız bayrakla.
const SEEDS = SOAK ? Array.from({ length: 12 }, (_, i) => 20261125 + i * 7919) : [20261125, 4711, 90210];
const scale = n => (SOAK ? n * 10 : n);

function int(random, n) { return Math.floor(random() * n); }
function pick(random, list) { return list[int(random, list.length)]; }
function shuffle(random, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = int(random, i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
// Türkçe ondalıklı, her zaman geçerli (> 0) bir teklif fiyatı.
function price(random) { return (1 + int(random, 900) / 100).toFixed(2).replace('.', ','); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

/* Her işlem benzersiz bir zaman alır (cihazlar arası aynı milisaniye ayrı bir
   testte ele alınır). Cihaz kimliği milisaniyeye gömülür; sıra korunur. */
function createClock(start = Date.UTC(2026, 10, 25, 8)) {
  let tick = 0;
  return device => new Date(start + (++tick) * 64 + (Number(device) || 0)).toISOString();
}

async function withRepro(label, seed, log, work) {
  try { return await work(); }
  catch (error) {
    const root = process.env.BUYERLOG_PRICING_SIM_FAILURE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pricing-sim-failure-'));
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `${label}-seed-${seed}.json`);
    fs.writeFileSync(file, JSON.stringify({ label, seed, operations: log.length, log }, null, 2));
    error.message += `\nPRICING_SYNC_REPRO=${JSON.stringify({ label, seed, operations: log.length, operationLog: file })}`;
    throw error;
  }
}

/* Birleşim sonucunun anlamsal biçimi: talep içindeki satır ve üretici SIRASI
   görüntü sırasıdır (matris hücreleri kimlik/üretici anahtarıyla okunur);
   üç yollu eşzamanlı eklemede sıra cihazlar arasında farklı olabilir.
   Yakınsama içerikle karşılaştırılır; değişme/idempotentlik ise birebir. */
const mfrKey = value => String(value == null ? '' : value).trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
function canonicalRequest(request) {
  if (!request) return request;
  const out = clone(request);
  out.items = (out.items || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  out.manufacturers = (out.manufacturers || []).slice().sort((a, b) => mfrKey(a.name).localeCompare(mfrKey(b.name)));
  out.models = (out.models || []).slice().sort((a, b) => String(a.modelKey).localeCompare(String(b.modelKey)));
  return out;
}
function canonicalRequests(list) {
  return (Array.isArray(list) ? list : []).map(canonicalRequest).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

module.exports = { SOAK, SEEDS, scale, seededRandom, int, pick, shuffle, price, clone, createClock, withRepro, mfrKey, canonicalRequest, canonicalRequests };
