'use strict';
// Kompakt node:test reporter'ı: başarılı testleri ve test gürültüsünü (console
// çıktısı) yazmaz; yalnız başarısız testleri (dosya:satır + hata) ve batch
// özetini yazar. Ayrıntılı çıktı için BUYER_LOG_TEST_VERBOSE=1 veya --verbose.
// Başarısız dosyanın stdout/stderr çıktısı (sınırlı kuyruk) hata ile birlikte
// gösterilir; böylece yükleme anında çöken dosyanın nedeni kaybolmaz.
// Dosya bazlı süre: her test dosyasının alt süreç dahil duvar saati süresi
// BUYER_LOG_TEST_TIMINGS_FILE verilmişse JSON satırı olarak eklenir (run-tests.js
// en yavaş dosyaları ve batch kritik yolunu buradan özetler). `todo` testleri
// bilinen açıktır: başarısız sayılmaz, ✖ yerine tek satır ◌ todo yazılır.
const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const MAX_FILE_OUTPUT_CHARS = 4000;
// Yükleme anında okunur ve ortamdan silinir: test dosyalarının kendi başlattığı iç
// `node --test` süreçleri bu dosyaya yazıp dış özeti kirletmez.
const TIMINGS_FILE = process.env.BUYER_LOG_TEST_TIMINGS_FILE || '';
delete process.env.BUYER_LOG_TEST_TIMINGS_FILE;
const MAX_ERROR_LINES = 40;

function key(file) {
  return file ? path.resolve(process.cwd(), String(file)) : '';
}

function rel(file) {
  return file ? path.relative(process.cwd(), key(file)).split(path.sep).join('/') : '';
}

// Node iç çerçeveleri (node:internal, node:async_hooks) teşhise katkı vermez; atlanır.
function withoutNodeFrames(text) {
  return String(text).split('\n').filter(line => !/^\s+at (?:.*\()?node:/.test(line) && !/^\s+at (?:(?:new )?(?:Safe)?Promise|Array\.map) \(<anonymous>\)/.test(line)).join('\n');
}

function errorText(error) {
  const cause = error && error.cause !== undefined ? error.cause : error;
  const text = cause instanceof Error ? (cause.stack || cause.message) : inspect(cause, { depth: 4 });
  const lines = withoutNodeFrames(text).split('\n');
  return lines.length > MAX_ERROR_LINES
    ? lines.slice(0, MAX_ERROR_LINES).concat(`… (${lines.length - MAX_ERROR_LINES} satır daha)`).join('\n')
    : lines.join('\n');
}

function firstLine(error) {
  const cause = error && error.cause !== undefined ? error.cause : error;
  const text = cause instanceof Error ? cause.message : inspect(cause, { depth: 1 });
  return String(text || '').split('\n').map(line => line.trim()).filter(Boolean)[0] || '';
}

// Dosya düzeyindeki kayıt: --test süreç yalıtımında her dosya, adı dosya yolu olan
// nesting 0 bir test olarak tamamlanır; süresi alt sürecin başlangıcını da içerir.
function isFileLevel(data) {
  return data.nesting === 0 && data.file && data.name && key(data.name) === key(data.file);
}

module.exports = async function* compactReporter(source) {
  const output = new Map();
  const failedFiles = new Set();
  const timingsFile = TIMINGS_FILE;
  const timings = [];
  let summary = null;
  for await (const event of source) {
    const data = event.data || {};
    if (event.type === 'test:complete' && isFileLevel(data)) {
      const ms = Number(data.details && data.details.duration_ms);
      if (Number.isFinite(ms)) timings.push({ file: rel(data.file), ms: Math.round(ms) });
    } else if (event.type === 'test:fail' && data.todo !== undefined && data.todo !== false) {
      const where = rel(data.file) + (data.line ? `:${data.line}` : '');
      yield `◌ todo (bilinen açık, başarısız sayılmaz): ${data.name} (${where}) — ${firstLine(data.details && data.details.error)}\n`;
    } else if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      const k = key(data.file);
      const next = (output.get(k) || '') + String(data.message || '');
      output.set(k, next.length > MAX_FILE_OUTPUT_CHARS ? next.slice(-MAX_FILE_OUTPUT_CHARS) : next);
    } else if (event.type === 'test:fail') {
      const error = data.details && data.details.error;
      // Alt testleri başarısız olan suite/dosya kaydı tekrar sayılmaz; asıl test zaten yazıldı.
      if (error && error.failureType === 'subtestsFailed') continue;
      failedFiles.add(key(data.file));
      const where = rel(data.file) + (data.line ? `:${data.line}:${data.column || 0}` : '');
      yield `\n✖ ${data.name} (${where})\n${errorText(error)}\n`;
    } else if (event.type === 'test:summary' && !data.file) {
      summary = data.counts || null;
    }
  }
  for (const file of failedFiles) {
    const text = withoutNodeFrames(output.get(file) || '').trim();
    if (text) yield `\n--- ${rel(file)} çıktısı (son ${MAX_FILE_OUTPUT_CHARS} karakter) ---\n${text}\n`;
  }
  if (timingsFile && timings.length) {
    try { fs.appendFileSync(timingsFile, timings.map(t => JSON.stringify(t)).join('\n') + '\n'); } catch (_) { /* süre özeti isteğe bağlıdır; testi bozmaz */ }
  }
  if (summary) {
    yield `tests ${summary.tests} · pass ${summary.passed} · fail ${summary.failed} · cancelled ${summary.cancelled} · skipped ${summary.skipped} · todo ${summary.todo}\n`;
  }
};
