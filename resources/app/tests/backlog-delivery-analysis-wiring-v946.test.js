'use strict';

/* v9.46 — TESLİMAT ANALİZİ BAĞLANTI NOKTALARI (kaynak-metin doğrulaması)
 *
 * public/app-main.js ve görünüm katmanı DOM'a bağlı, ayrıştırılamaz
 * (CLAUDE.md §2) — bu yüzden kaynak metin eşleştirmesiyle test edilir.
 *
 * Korunan asıl kusurlar:
 * 1) Analizin KENDİ filtresini kurup Backlog'dan farklı bir küme göstermesi.
 *    Bu, aynı ekranda iki farklı "toplam" demekti; en pahalı rapor hatası.
 * 2) Mevcut Backlog akışının (filtre, pivot, export, toplamlar) bozulması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const VIEW = read('public/backlog-delivery-analysis.js');
const HTML = read('public/index.html');
const PERF = read('public/perf-runtime.js');
const STORAGE = read('public/user-storage.js');
const PARSE = read('server/lib/parse.js');

test('v9.46 analiz KENDİ filtresini kurmaz: Backlog\'un kanonik filtre tanımını kullanır', () => {
  // buildBacklogParams tek filtre kaynağıdır; export sarmalayıcısı onu kullanır.
  assert.match(VIEW, /backlogExportQueryParams\(\)/);
  assert.match(VIEW, /\/api\/backlog-export\?/);
  // Analiz kendi tarih girdilerini okumaya KALKIŞMAMALI.
  assert.doesNotMatch(VIEW, /getElementById\('backlogFrom'\)|getElementById\("backlogFrom"\)/);
  assert.doesNotMatch(VIEW, /getElementById\('backlogInStoreFrom'\)/);
});

test('v9.46 toplam eşitliği ölçülür ve sapma gizlenmez', () => {
  assert.match(VIEW, /window\.lastBacklogData/);
  assert.match(VIEW, /parity/);
  assert.match(VIEW, /is-warn.*Backlog|Backlog.*is-warn/s);
});

test('v9.46 Backlog her çizildiğinde analiz haberdar edilir (ayrı fetch döngüsü yok)', () => {
  assert.match(APP, /window\.BLBacklogAnalysis\?\.onBacklogRendered\?\.\(data\)/);
  // Kanca renderBacklog'un SONUNDA olmalı: tfoot yazımından sonra.
  const renderIndex = APP.indexOf('function renderBacklog(');
  const hookIndex = APP.indexOf('window.BLBacklogAnalysis?.onBacklogRendered?.(data)');
  const nextFunction = APP.indexOf('function renderBacklogFlatRows(');
  assert.ok(renderIndex > 0 && hookIndex > renderIndex && hookIndex < nextFunction, 'kanca renderBacklog içinde olmalı');
});

test('v9.46 modül lazy yüklenir; motorlar görünümden ÖNCE gelir', () => {
  assert.match(PERF, /backlogAnalysis:\['backlog-delivery-engine\.js','backlog-delivery-insights\.js','backlog-delivery-analysis\.js'\]/);
  assert.match(PERF, /if\(name==='backlogAnalysis'&&global\.BLBacklogAnalysis\)return;/);
  assert.match(APP, /ensureFeature\?\.\('backlogAnalysis'\)/);
});

test('v9.46 panel kabuğu Backlog ile otomatik görünür; ayrı toggle yoktur', () => {
  assert.match(HTML, /<div id="backlogAnalysis"><\/div>/);
  assert.doesNotMatch(HTML, /id="backlogAnalysisToggle"/);
  assert.match(HTML, /backlog-delivery-analysis\.css/);
  assert.match(VIEW, /state\.open = true/);
  assert.doesNotMatch(VIEW, /saved\.open/);
  assert.ok(HTML.includes('id="i-chart-histogram"'), 'kullanılan simge sprite\'ta tanımlı olmalı');
});

test('v9.46 kullanıcı tercihi hesapla birlikte taşınır (iki listeye de kayıtlı)', () => {
  const prefixCount = (STORAGE.match(/'lcw\.backlog\.analysis\.'/g) || []).length;
  assert.equal(prefixCount, 2, 'önek hem scoped prefixes hem SYNCED listesinde olmalı');
  assert.match(VIEW, /STORAGE_KEY\s*=\s*'lcw\.backlog\.analysis\.v1'/);
});

test('v9.46 drill-down mevcut Backlog detay penceresini kullanır, yenisini kurmaz', () => {
  assert.match(VIEW, /openBacklogDetailShell/);
  assert.match(VIEW, /renderBacklogDetailTable/);
  assert.doesNotMatch(VIEW, /fetch\('\/api\/backlog-detail'/, 'detay için ikinci bir sunucu yolu açılmamalı');
});

test('v9.46 sunucu: MAG/MMYG ve priority analiz için taşınır, Excel şablonu DEĞİŞMEZ', () => {
  assert.match(PARSE, /mag: order\.merch \|\| '',/);
  assert.match(PARSE, /mmyg: order\.ageGroup \|\| '',/);
  /* v9.53: analiz artık Priority METNİNİ ayrıştırmıyor. parse.js yapılandırılmış
     operasyonel sinyaller taşıyor ve teslimat motoru onları tüketiyor — metin
     ayrıştırmaktan kesinlikle daha sağlam. Korunan şey değişmedi: analizin
     ihtiyaç duyduğu alanlar satıra taşınmalı.
     Satır sonu CRLF/LF karışık olabilir (CLAUDE.md §3): duyarsız eşleştir. */
  assert.match(PARSE, /\r?\n\s*signals: operationalSignals,\r?\n/);
  const ENGINE = read('public/backlog-delivery-engine.js');
  assert.match(ENGINE, /meta\.signals/, 'motor yapılandırılmış sinyalleri okumalı');
  assert.doesNotMatch(ENGINE, /priorityHas\(|meta\.priority\b/, 'Priority metni ayrıştırılmamalı');
  // BACKLOG_TEMPLATE_HEADERS'a yeni sütun EKLENMEMELİ: Excel çıktısı korunur.
  const server = read('server/server.js');
  const headerLine = server.slice(server.indexOf('const BACKLOG_TEMPLATE_HEADERS'), server.indexOf('const BACKLOG_TEMPLATE_HEADERS') + 1400);
  assert.doesNotMatch(headerLine, /Merch Alt Grup Kod|Merch Marka Yaş Grup Kod/,
    'analiz alanları Excel başlık listesine sızmamalı');
});

test('v9.46 iş mantığı görünümde DEĞİL: eşik ve sınıflandırma motorda kalır', () => {
  // Görünüm kendi gecikme kuralını yazmamalı.
  assert.doesNotMatch(VIEW, /EXPECTED_LATE\s*=|deliveryOutcome\s*=\s*['"]/, 'sınıflandırma görünümde üretilmemeli');
  assert.match(VIEW, /Engine\.analyze\(/);
  assert.match(VIEW, /Insights\.build\(/);
});

test('v9.46 AI iş mantığı yok: analiz zinciri tamamen deterministik', () => {
  for (const file of ['public/backlog-delivery-engine.js', 'public/backlog-delivery-insights.js', 'public/backlog-delivery-analysis.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /\/api\/copilot|BLCopilot|octopus/i, `${file} AI çağrısı içermemeli`);
  }
});
