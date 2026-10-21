'use strict';
/* Test Raporu Aktarımı — arayüz kaynak sözleşmesi. Uçtan uca bırakma akışı
   gerçek Chromium'da (Playwright) doğrulandı; burada bağlantıların sessizce
   kopmaması çivilenir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('modül tembel yüklenir: motor görünümden önce', () => {
  const perf = read('public/perf-runtime.js');
  const m = perf.match(/testReportImport:\[([^\]]+)\]/);
  assert.ok(m, 'testReportImport özelliği tanımlı');
  assert.ok(m[1].indexOf('test-report-engine.js') < m[1].indexOf('test-report-import.js'));
  assert.doesNotMatch(read('public/index.html'), /test-report-import\.js/, 'eager yüklenmez');
});

test('checklist menüsü, CP bırakma alanı ve görev listesi bağlı', () => {
  const sync = read('public/checklist-supplier-sync.js');
  assert.match(sync, /data-checklist-test-reports/);
  assert.match(sync, /T\('Test Raporu Aktar', 'Import Test Reports'\)/);
  assert.match(sync, /function bindReportDrop\(\)/);
  assert.match(sync, /activeTab\(\) === 'cp'/, 'bırakma yalnız CP ekranında');
  assert.match(sync, /\.cpaModalOverlay/, 'açık pencerelerin bırakması ele geçirilmez');
  assert.match(sync, /\/api\/test-reports\/tasks/);
  assert.match(sync, /_checklistTasks/);
});

test('CP içi sürükleme (sütun başlığı taşıma vb.) test raporu bırakma sayılmaz', () => {
  const sync = read('public/checklist-supplier-sync.js');
  const fn = sync.slice(sync.indexOf('function bindReportDrop()'), sync.indexOf('async function loadTestReportTasks'));
  assert.match(fn, /addEventListener\('dragstart'[^]*?internalDrag = true[^]*?, true\)/, 'sayfa içi sürükleme yakalanır');
  assert.match(fn, /endInternal = function \(\) \{ internalDrag = false; \}/);
  assert.match(fn, /addEventListener\('dragend', endInternal, true\)/, 'sürükleme bitince bayrak sıfırlanır');
  assert.match(fn, /addEventListener\('drop', endInternal, true\)/, 'bırakmada bayrak sıfırlanır');
  const enter = fn.slice(fn.indexOf("addEventListener('dragenter'"), fn.indexOf("addEventListener('dragover'"));
  assert.match(enter, /internalDrag/, 'iç sürüklemede bırakma katmanı açılmaz');
});

test('hücre Buying görevini TR/EN gösterir; düzenleme yetkisi korunur', () => {
  const app = read('public/app-main.js');
  assert.match(app, /clTaskFlag/);
  assert.match(app, /'Awaiting buying feedback':'Buying dönüşü bekleniyor'/);
  const css = read('public/app.css');
  assert.match(css, /\.clTaskFlag\{/);
  const ui = read('public/test-report-import.js');
  assert.match(ui, /row\._canEdit === false/, 'satır düzenleme yetkisi kontrol edilir');
  assert.match(ui, /answer\.source !== 'test_report'/, 'kullanıcı girişi öncelikli');
  assert.match(ui, /source: 'test_report'/);
});

test('CP dışında kalan sipariş yazılmaz; ham kaynakların tamamı LCW AI tarafından incelenir', () => {
  const ui = read('public/test-report-import.js');
  assert.match(ui, /const ignored = Boolean\(E\(\)\.normalizeOrderCode\(report\.siparisKodu\)\) && match\.level === 'none' && match\.reason === 'order'/);
  assert.match(ui, /include: !ignored && Boolean\(chosen\) && !fromAi/);
  assert.match(ui, /if \(entry\.ignored\) \{ out\.reason/, 'CP dışında kalan kapsamlar checklist yazımından elenir');
  assert.match(ui, /T\('Dikkate alınmadı', 'Ignored'\)/);
  assert.match(ui, /Review\.batches\(packet\)/, 'kaynakların tamamı inceleme partilerine alınır');
  assert.match(ui, /new File\(\[JSON\.stringify\(\{ \.\.\.packet, focusSourceIds: batch\.sourceIds \}\)\]/, 'her partide tam CP ve kaynak metin paketi korunur');
  assert.match(ui, /if \(!entry\.ignored && !entry\.itemId && entry\.typeKey/);
});

test('önizleme rapordaki test adlarını görünür gösterir', () => {
  const ui = read('public/test-report-import.js');
  assert.match(ui, /function testNames\(report\)/);
  assert.match(ui, /T\('Test adı: ', 'Test name: '\)/);
  assert.match(ui, /tests\.join\(', '\)/);
});

test('checklist cevabı kaynak alanını taşır; elle seçim kaynaksızdır', () => {
  const Checklist = require('../public/cp-checklist-engine');
  const analysis = { orderKey: 'PO1', plannedLoadDate: 1 };
  assert.equal(Checklist.makeAnswer('approved', analysis, { source: 'test_report' }).source, 'test_report');
  assert.equal(Object.prototype.hasOwnProperty.call(Checklist.makeAnswer('approved', analysis, {}), 'source'), false);
});

test('rota kayıtlı ve ek yükleme ile aynı yetki alanında', () => {
  assert.match(read('server/server.js'), /require\('\.\/routes\/test-report-routes'\)/);
  const routes = read('server/routes/test-report-routes.js');
  assert.match(routes, /'\/api\/test-reports\/parse', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(routes, /'\/api\/test-reports\/commit', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(read('server/lib/test-reports/extract.js'), /isEvalSupported: false/);
});

test('package.json msgreader bağımlılığını taşır', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['@kenjiuno/msgreader']);
});

test('LCW AI tek ortak yoldan çağrılır; öneri onaysız uygulanmaz', () => {
  const ui = read('public/test-report-import.js');
  assert.match(read('public/perf-runtime.js'), /testReportImport:\['lcwai-assistant\.js\?rev=1'/, 'ortak BuyerLogAI istemcisi önce yüklenir');
  assert.match(ui, /source: 'test-report-extract'/);
  assert.match(ui, /source: 'test-report-assess'/);
  assert.doesNotMatch(ui, /\/lcw\/gpt\/api|Authorization|Bearer/, 'modül kendi AI entegrasyonunu yazmaz');
  assert.match(ui, /include: !ignored && Boolean\(chosen\) && !fromAi/, 'LCW AI okuduğu ve CP dışında kalan satır varsayılan seçilmez');
  assert.match(ui, /entry\.include = Boolean\(entry\.chosen\) && !entry\.fromAi/, 'tip eşlemesi AI satırını seçmez');
  assert.match(ui, /data-tr-ai-step/);
  assert.match(ui, /Review\.validate\(/, 'AI incelemesi kaynak ve kapsam doğrulayıcısından geçer');
  assert.match(ui, /ui\.ai\.state !== 'done' \|\| !ui\.ai\.packet/, 'tamamlanmayan inceleme checklist yazamaz');
  assert.match(ui, /T\('LCW AI bağlı değil', 'LCW AI is not connected'\)/);
  const routes = read('server/routes/test-report-routes.js');
  assert.match(routes, /service\.acceptAi\(req\.currentUser/, 'UI aynı sunucu servisini kullanır');
  assert.match(read('server/lib/test-reports/service.js'), /Engine\.reportFromAiExtract\(body\.data/, 'AI okuması ortak sunucu servisinde doğrulanır');
});
