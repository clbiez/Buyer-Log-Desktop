'use strict';

/* v9.48 — CP ÜRETİM ÖNCELİKLERİ PANELİ: BAĞLANTI NOKTALARI
 *
 * public/app-main.js ve görünüm katmanı DOM'a bağlı, ayrıştırılamaz
 * (CLAUDE.md §2) — kaynak metin eşleştirmesiyle test edilir.
 *
 * Korunan asıl kusurlar:
 * 1) Panelin KENDİ filtresini kurup Genel Bakış'tan farklı bir küme
 *    göstermesi. Aynı ekranda iki farklı toplam en pahalı rapor hatasıdır.
 * 2) İş mantığının görünüme sızması (eşik/sınıflandırma motorda kalmalı).
 * 3) Açılış kritik yolunun ağırlaşması (§11) — panel lazy yüklenmeli.
 * 4) Kullanıcı tercihlerinin hesaplar arasında sızması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const VIEW = read('public/cp-overview-assistant.js');
const HTML = read('public/index.html');
const PERF = read('public/perf-runtime.js');
const STORAGE = read('public/user-storage.js');
const CSS = read('public/cp-overview-assistant.css');

test('v9.48 panel KENDİ filtresini kurmaz: Genel Bakış\'ın satır kümesini alır', () => {
  // Kanca ovFilteredCpRows çıktısını (yetki+filtre uygulanmış) geçirir.
  assert.match(APP, /window\.BLCpAssistant\?\.onOverviewRendered\?\.\(cpRows,\{/);
  assert.match(APP, /ensureFeature\?\.\('cpAssistant'\)/);
  // Görünüm kendi veri çekmesini YAPMAMALI.
  // Formula AI is an explicit suggestion action and is the only allowed
  // network call in this view. Data rows still come from Overview.
  assert.doesNotMatch(VIEW, /fetch\(\s*['"]\/api\//, 'panel kendi dataset çağrısını açmamalı');
  assert.doesNotMatch(VIEW, /getElementById\('cpF|getElementById\("cpF/, 'panel CP filtre girdilerini okumamalı');
});

/* CANLI ÖLÇÜMDE GÖRÜLEN GERÇEK HATA (v9.48): kullanıcının kayıtlı sekmesi
   zaten Genel Bakış olduğunda switchTab hiç çağrılmıyor, dolayısıyla panel
   yüklenmiyor ve ekran sonsuza kadar boş kalıyordu. Yükleme bir KEZ, bayrakla
   korunarak çizim yolundan da tetiklenmeli. */
test('v9.48 kanca Genel Bakış çiziminin İÇİNDE; yükleme bir kez tetiklenir', () => {
  const renderIndex = APP.indexOf('function renderOverviewNow(');
  const hookIndex = APP.indexOf('window.BLCpAssistant?.onOverviewRendered?.(cpRows,{');
  assert.ok(renderIndex > 0 && hookIndex > renderIndex, 'kanca renderOverviewNow içinde olmalı');
  // Kanca ensureFeature'dan ÖNCE gelmeli: modül yüklüyse yükleme hiç denenmez.
  const bootstrapIndex = APP.indexOf('window.__cpAssistantBootstrapped');
  assert.ok(bootstrapIndex > hookIndex, 'önce mevcut panel güncellenmeli');
  assert.match(APP, /if\(!window\.BLCpAssistant && !window\.__cpAssistantBootstrapped\)\{/);
  // Bayrak ensureFeature'dan ÖNCE set edilmeli; yoksa yavaş yüklemede her
  // çizim yeni bir yükleme başlatır.
  const guard = APP.slice(bootstrapIndex, bootstrapIndex + 400);
  assert.ok(guard.indexOf('__cpAssistantBootstrapped = true') < guard.indexOf('ensureFeature'),
    'bayrak yükleme başlatılmadan önce set edilmeli');
});

/* CANLI ÖLÇÜMDE GÖRÜLEN GERÇEK HATA (v9.48): backlog-delivery-engine.js
   listede yoktu. CP hazırlık motoru teslimat sonucunu ondan okuduğu için
   1431 siparişin HEPSİ sessizce "Hesaplanamıyor" göründü; konsolda hiçbir
   hata yoktu. Kanonik motor listede ve görünümden ÖNCE olmak zorunda. */
test('v9.48 lazy yükleme listesi kanonik teslimat motorunu da içerir ve sıra doğru', () => {
  // order-decision-engine.js artık index.html'de eager. Aynı script'i lazy
  // listede yeniden beklemek geçmiş load event'inde deadlock oluşturuyordu.
  // PLM numune talepleri (kontrol listesi kanıtı) görünümden önce yüklenir.
  assert.match(PERF, /cpAssistant:\['backlog-delivery-engine\.js','cp-readiness-engine\.js','cp-checklist-engine\.js','cp-rules-engine\.js','plm-sample-requests-engine\.js','plm-sample-requests\.js','cp-overview-assistant\.js(?:\?[^']*)?'\]/);
  assert.doesNotMatch(PERF, /cpAssistant:\[[^\]]*'order-decision-engine\.js'/);
  assert.match(PERF, /if\(name==='cpAssistant'&&global\.BLCpAssistant&&typeof global\.BLCpAssistant\.computeDecisionsForRows==='function'\)return;/);
  // Görünüm üç motoru da window'dan okur; biri eksikse hiç kurulmamalı
  // (yarım kurulmuş panel sessiz yanlış sonuçtan iyidir).
  assert.match(VIEW, /if \(!Engine \|\| !Checklist \|\| !Rules\) return;/);
});

/* Kullanıcı talebi: "bu alandaki koşulları kullanıcı dilediği gibi ekle/çıkar
   yapabilsin". Kural düzenleyici olmadan kurallar gizli kalırdı. */
test('v9.49 kural düzenleyici arayüzü var ve yerleşik kurallar da düzenlenebilir', () => {
  assert.match(VIEW, /function openRules\(\)/);
  assert.match(VIEW, /data-cpa-rules/);
  assert.match(VIEW, /rulesBtn\.onclick = openRules/);
  // Ekle / sil / koşul ekle / koşul sil hepsi bağlı olmalı.
  for (const hook of ['data-cpa-add-priority', 'data-cpa-add-checklist', 'data-cpa-rule-delete', 'data-cpa-cond-add', 'data-cpa-cond-remove']) {
    assert.ok((VIEW.match(new RegExp(hook, 'g')) || []).length >= 2, `${hook} hem çizilmeli hem bağlanmalı`);
  }
  // Yerleşik kurallar listeden GİZLENMEMELİ.
  assert.doesNotMatch(VIEW, /filter\(rule => !rule\.builtIn\)/, 'yerleşik kurallar gizlenmemeli');
  // v7.221: kurallar kişiye özel, türüne göre AYRI hesap anahtarında saklanır
  // (Ön Ayar Paylaşımı öncelik kurallarını ve checklist sorularını ayrı aktarır).
  assert.match(VIEW, /priority: 'lcw\.cp\.rules\.priority\.v1'/);
  assert.match(VIEW, /checklist: 'lcw\.cp\.rules\.checklist\.v1'/);
  assert.match(VIEW, /rules: state\.rules\.filter\(rule => rule\.kind === kind\)/);
  assert.match(VIEW, /Rules\.mergeWithDefaults\(stored\.rules, state\.deletedRuleIds\)/);
  // Eski PREF_KEY içindeki kurallar kaybolmadan yeni anahtarlara taşınır.
  assert.match(VIEW, /function loadRuleStores\(legacy\)/);
  assert.match(VIEW, /if \(migrateRuleStores\) savePrefs\(\);/);
});

test('v9.49 kural uygulaması sırası doğru: kontrol durumu → öncelik → yeniden sayım', () => {
  // v9.64+ kişisel decision katmanı reusable analyzeRowsWithPersonalRules içine
  // taşındı; recompute yalnız bu ortak katmanı commit=true ile çağırıyor.
  const start = VIEW.indexOf('function analyzeRowsWithPersonalRules');
  const end = VIEW.indexOf('function recompute()', start);
  const decisionPass = VIEW.slice(start, end);
  // v7.221: checklist durumu ve öncelik kuralları birbirine koşul olarak
  // bağlanabildiği için ikisi Rules.evaluateOrder içinde bağımlılık sırasıyla
  // (tembel) çözülür; sonuç öncelik uygulamasından ÖNCE hazırdır.
  const evaluateIndex = decisionPass.indexOf('Rules.evaluateOrder(');
  const applyIndex = decisionPass.indexOf('const applied = evaluations.get(');
  const recountIndex = decisionPass.indexOf('Engine.recount');
  assert.ok(start > 0 && evaluateIndex > 0 && applyIndex > evaluateIndex, 'kontrol durumu önceliklerden ÖNCE hesaplanmalı');
  assert.ok(recountIndex > applyIndex, 'sayım kurallardan SONRA yeniden kurulmalı');
  // Özel kontrollerin kapsamı kural motorundan gelmeli.
  assert.match(decisionPass, /customItems\.set\(analysis\.orderKey, evaluated\.customItems\)/);
  assert.match(decisionPass, /customItemsFor:/);
  assert.match(VIEW, /function recompute\(\)[\s\S]*analyzeRowsWithPersonalRules\(lastRows, \{ commit: true \}\)/);
});

test('v9.48 teslimat motoru yoksa panel SESSİZCE UNKNOWN göstermez, uyarır', () => {
  const engine = read('public/cp-readiness-engine.js');
  assert.match(engine, /const deliveryEngineReady = typeof DE\.analyzeOrder === 'function'/);
  assert.match(engine, /deliveryEngineMissing: !deliveryEngineReady/);
  assert.match(VIEW, /quality\.deliveryEngineMissing/);
  // Canlı davranış: motor yokken bayrak kalkmalı.
  const Engine = require('../public/cp-readiness-engine.js');
  const model = Engine.analyze([], {});
  assert.equal(model.dataQuality.deliveryEngineMissing, false, 'Node tarafında motor mevcut (ön koşul)');
});

test('v9.48 panel kabuğu Genel Bakış içeriğinde ve stil sayfası kayıtlı', () => {
  assert.match(HTML, /<div id="cpAssistant"><\/div>/);
  assert.match(HTML, /cp-overview-assistant\.css/);
  // Kabuk artık kendi ana ekran widget'ının içindedir; veri yokken boş kart
  // yerine açıklayıcı boş durum görünür (ovContent sarmalayıcısı kaldırıldı).
  const widgetIndex = HTML.indexOf('data-overview-widget="productionFocus"');
  const hostIndex = HTML.indexOf('<div id="cpAssistant">');
  assert.ok(widgetIndex > 0 && hostIndex > widgetIndex);
  assert.match(HTML.slice(hostIndex, hostIndex + 300), /class="ovHomeHostEmpty"/);
});

test('v9.48 kullanıcı tercihleri hesapla birlikte taşınır (iki listeye de kayıtlı)', () => {
  for (const prefix of ["'lcw\\.cp\\.assistant\\.'", "'lcw\\.cp\\.checklist\\.'"]) {
    const count = (STORAGE.match(new RegExp(prefix, 'g')) || []).length;
    assert.equal(count, 2, `${prefix} hem scoped prefixes hem SYNCED listesinde olmalı`);
  }
  assert.match(VIEW, /PREF_KEY = 'lcw\.cp\.assistant\.v1'/);
  assert.match(VIEW, /ANSWER_KEY = 'lcw\.cp\.checklist\.v1'/);
});

test('v9.48 iş mantığı görünümde DEĞİL: eşik ve sınıflandırma motorda kalır', () => {
  assert.match(VIEW, /Engine\.analyze\(/);
  assert.match(VIEW, /Checklist\.summarize\(/);
  assert.match(VIEW, /Checklist\.normalizeSettings\(/);
  // Görünüm kendi öncelik/sonuç kuralını yazmamalı.
  assert.doesNotMatch(VIEW, /priority\s*=\s*'(CRITICAL|ACTION_TODAY|WATCH)'/, 'sınıflandırma görünümde üretilmemeli');
  assert.doesNotMatch(VIEW, /daysToLoad\s*<=\s*\d+/, 'eşik görünümde hesaplanmamalı');
});

test('v9.48 perspektif YETKİYİ değiştirmez, yalnız kart sırasını değiştirir', () => {
  assert.match(VIEW, /const CARD_ORDER = \{/);
  for (const key of ['buyer', 'merchandiser', 'manager']) {
    assert.ok(VIEW.includes(`${key}: [`), `${key} perspektifi tanımlı olmalı`);
  }
  assert.doesNotMatch(VIEW, /userAccess|hasArea|requireArea|profile\.role/, 'görünüm yetki kararı vermemeli');
});

/* CANLI ÖLÇÜMDE GÖRÜLEN GERÇEK HATA (v9.48): tercihler ve cevaplar HAM
   localStorage'a yazılıyordu. BLStorage sarmalayıcısı kullanıcı önekini
   uyguladığı için, onu atlamak aynı makinedeki iki kullanıcının aynı kontrol
   ayarlarını ve aynı "tamamlandı" cevaplarını paylaşması demekti — kullanıcı
   açıkça kişiye özel olmasını istemişti. */
test('v9.48 kontrol cevabı sipariş verisine DEĞİL, kullanıcıya ÖZEL kayda yazılır', () => {
  assert.match(VIEW, /state\.answers\[Checklist\.answerKey\(/);
  assert.match(VIEW, /store\.set\(ANSWER_KEY/);
  assert.match(VIEW, /store\.set\(PREF_KEY/);
  assert.match(VIEW, /window\.BLStorage\.setItem\(key, value\)/);
  assert.match(VIEW, /window\.BLStorage\.getItem\(key\)/);
  // Ham localStorage yalnız BLStorage yokken yedek olarak geçebilir; okuma ve
  // yazma yollarının dışında hiç kullanılmamalı.
  const rawUses = VIEW.match(/localStorage\.(get|set|remove)Item/g) || [];
  assert.equal(rawUses.length, 2, `BLStorage atlanıyor: ${rawUses.join(', ')}`);
  // Cevap ham CP satırına yazılmamalı.
  assert.doesNotMatch(VIEW, /sourceRow\[[^\]]*\]\s*=/, 'cevap kaynak satıra yazılmamalı');
});

test('v9.48 drill-down mevcut CP ekranını kullanır, ikinci bir liste kurmaz', () => {
  assert.match(VIEW, /switchTab\('cp'\)/);
  assert.match(VIEW, /renderCP\(\)/);
  assert.doesNotMatch(VIEW, /\/api\/cp|\/api\/orders/, 'panel için ayrı sunucu yolu açılmamalı');
});

test('v9.48 stil mevcut token\'ları kullanır, yeni renk uydurmaz', () => {
  // Ham renk kodu yalnız modal perdesinde (rgba) kabul edilir; kalan her renk
  // token'dan gelmeli (CLAUDE.md §9).
  const hexColours = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hexColours.filter(value => value.toLowerCase() !== '#fff'), [],
    `token dışı renk kullanılmış: ${hexColours.join(', ')}`);
  assert.match(CSS, /var\(--acc\)/);
  assert.match(CSS, /var\(--line\)/);
});

/* KULLANICI BİLDİRİMİ (v9.48): "modülün yazıları aşırı küçük".
   Sebep: panel sabit px yazı boyutlarıyla (7.8–9px) çizilmişti. Tasarım
   sistemindeki en küçük token --fs-xs bile 11px'tir ve TÜM token'lar
   calc(... + var(--ui-font-add)) ile tanımlıdır — yani kullanıcının yazı
   boyutu ayarıyla büyürler. Sabit px yazan bir kural o ayarı sessizce yok
   sayar ve ekranın geri kalanından küçük görünür. */
test('v9.48 yazı boyutları TOKEN\'dan gelir: sabit px yok, kullanıcı ayarı çalışır', () => {
  const hardcoded = CSS.match(/font-size:\s*[0-9.]+px/g) || [];
  assert.deepEqual(hardcoded, [], `sabit px yazı boyutu kullanıcının yazı ayarını yok sayar: ${hardcoded.join(', ')}`);
  // font kısayolu da boyut gömebilir; o yol da kapalı olmalı.
  const shorthand = CSS.match(/[^-]font:\s*[^;]*[0-9.]+px/g) || [];
  assert.deepEqual(shorthand, [], `font kısayolunda sabit boyut var: ${shorthand.join(', ')}`);
  // Ölçek gerçekten kullanılıyor mu?
  for (const token of ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl']) {
    assert.ok(CSS.includes(`var(${token})`), `${token} kullanılmalı`);
  }
  // Ön koşul: token'lar gerçekten kullanıcı ayarına bağlı.
  assert.match(read('public/app.css'), /--fs-xs:calc\(11px \+ var\(--ui-font-add\)\)/);
});

test('v9.48 köşe yarıçapı token\'dan gelir (uygulama kare köşe kullanır)', () => {
  const hardcoded = CSS.match(/border-radius:\s*[0-9.]+px/g) || [];
  assert.deepEqual(hardcoded, [], `sabit yarıçap görsel kimliği bozar: ${hardcoded.join(', ')}`);
  assert.match(read('public/app.css'), /--r-sm:0/, 'ön koşul: yarıçap token\'ları 0');
});

test('v9.48 <section> tuzağı: panel kartları görünür bir kurala sahip', () => {
  // CLAUDE.md §4 — kendisine display veren kuralı olmayan <section> sessizce kaybolur.
  assert.match(VIEW, /<section class="cpaCard"/);
  assert.match(CSS, /\.cpaCard\{display:/);
});

test('v9.48 hesaplama motorlarında AI iş mantığı yok', () => {
  for (const file of ['public/cp-readiness-engine.js', 'public/cp-checklist-engine.js']) {
    assert.doesNotMatch(read(file), /\/api\/copilot|BLCopilot|octopus/i, `${file} AI çağrısı içermemeli`);
  }
});

/* KULLANICI BİLDİRİMİ (v9.50): kural editörü bütün kuralları açık kart olarak
   alt alta çizdiği için özellikle 1366×768 ekranda koşullar görünmüyordu.
   Çözüm: geniş modal + tür sekmeleri + tek-açık accordion. İş mantığı aynı kalır. */
test('v9.50 kural penceresi geniş ve tek-açık accordion kullanır; v7.221 Rules yalnız öncelik kuralı gösterir', () => {
  assert.match(VIEW, /class="cpaModal cpaRulesModal"/);
  // Kullanıcı talebi: "Rules'da sadece Rules ayarları olsun, checklist
  // questions'u checklist settings'e taşı." Sekmeler kaldırıldı.
  assert.doesNotMatch(VIEW, /data-cpa-rules-tab=/);
  assert.match(VIEW, /function openRules\(\) \{ openRuleManager\('priority'\); \}/);
  assert.match(VIEW, /function openSettings\(\) \{ openRuleManager\('checklist'\); \}/);
  assert.match(VIEW, /let expandedRuleId = null/);
  assert.match(VIEW, /expandedRuleId = expandedRuleId === id \? null : id/);
  assert.match(VIEW, /visible\.map\(rule => ruleBlock\(rule, view\)\)/);
  assert.match(CSS, /\.cpaRulesModal\{[^}]*width:min\(1500px,96vw\)[^}]*height:auto[^}]*max-height:calc\(100vh\s*-\s*2\s*\*\s*var\(--sp-5\)\)/);
  assert.match(CSS, /\.cpaRulesBody\{[^}]*overflow:hidden/);
});

test('rules modal text selection drag ile backdrop kapanışını tetiklemez', () => {
  assert.match(VIEW, /let backdropPointerStarted = false/);
  assert.match(VIEW, /backdropPointerStarted = event\.target === modal/);
  assert.match(VIEW, /event\.target === modal && backdropPointerStarted/);
});

test('Checklist Settings ön tanımlı checklist rule kimliklerini kullanır ve checklist aç/kapat içerir', () => {
  assert.match(VIEW, /managedItemIds: Rules\.DEFAULT_CHECKLIST_RULE_IDS/);
  assert.match(VIEW, /'Checklist Settings'/);
  assert.match(VIEW, /data-cpa-master/);
  assert.doesNotMatch(VIEW, /data-cpa-open-rules/, 'checklist soruları artık kendi penceresinde; Rules\'a yönlendirme yok');
});

test('kural penceresinde uzun liste bağımsız olarak dikey kaydırılır', () => {
  assert.match(CSS, /\.cpaRulesBody\{[^}]*overflow:hidden/);
  assert.match(CSS, /\.cpaRuleList\{[^}]*flex:1 1 auto[^}]*overflow-y:auto/);
  assert.match(CSS, /\.cpaRuleList\{[^}]*overscroll-behavior:contain/);
});

test('kural satırı built-in dahil düzenleme ve silme aksiyonlarını gösterir', () => {
  assert.match(VIEW, /class="cpaSwitch"/);
  assert.match(VIEW, /class="cpaRuleSummary"/);
  assert.match(VIEW, /class="cpaBuiltIn"/);
  assert.match(VIEW, /data-cpa-rule-edit/);
  assert.match(VIEW, /data-cpa-rule-delete/);
  assert.match(VIEW, /class="cpaRuleChevron"/);
  assert.match(VIEW, /deletedRuleIds: state\.deletedRuleIds\.filter\(id => defaults\.has\(id\)\)/);
  assert.match(VIEW, /Rules\.mergeWithDefaults\(stored\.rules, state\.deletedRuleIds\)/);
  assert.match(CSS, /\.cpaRuleBar\{[^}]*min-height:48px/);
  assert.match(CSS, /\.cpaCondLabels,\.cpaCondRow\{[^}]*40fr[^}]*25fr[^}]*35fr/);
});

test('v9.50 yeni kural açılmış halde oluşturulur ve editöre kaydırılır', () => {
  assert.match(VIEW, /showTemplates = false;\s*expandedRuleId = rule\.id;/);
  assert.match(VIEW, /function createRule\(template\)/);
  assert.match(VIEW, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(VIEW, /scrollToRule\(rule\.id\)/);
});


/* KULLANICI TALEBİ (2026-09-06): Loading Plan alanı kaldırılmalı; kalan
   Production Focus modülleri kullanıcı bazlı gizlenip sıralanabilmeli. */
test('Production Focus Loading Plan render etmez ve layout kullanıcıya özeldir', () => {
  assert.doesNotMatch(VIEW, /function loadingCard\(/, 'Loading Plan görünüm rendererı kalmamalı');
  const orderBlock = VIEW.slice(VIEW.indexOf('const CARD_ORDER = {'), VIEW.indexOf('const MODULE_META'));
  assert.doesNotMatch(orderBlock, /['"]loading['"]/, 'Loading Plan hiçbir perspektifin varsayılan düzeninde olmamalı');
  assert.match(VIEW, /moduleLayout: state\.moduleLayout/);
  assert.match(VIEW, /state\.moduleLayout = normalizeModuleLayouts\(raw\.moduleLayout\)/);
  assert.match(VIEW, /state\.moduleLayout\[perspective\] = normalizeLayoutEntry/);
});

test('Production Focus Customize Layout görünürlük, sıra ve reset kontrollerini bağlar', () => {
  assert.match(VIEW, /data-cpa-layout/);
  assert.match(VIEW, /layoutBtn\.onclick = openModuleLayout/);
  assert.match(VIEW, /function openModuleLayout\(\)/);
  for (const hook of ['data-cpa-layout-visible', 'data-cpa-layout-item', 'data-cpa-layout-up', 'data-cpa-layout-down', 'data-cpa-layout-reset', 'data-cpa-layout-apply']) {
    assert.ok((VIEW.match(new RegExp(hook, 'g')) || []).length >= 2, `${hook} çizilmeli ve bağlanmalı`);
  }
  assert.match(VIEW, /draggable="true"/);
  assert.match(VIEW, /ondrop = event =>/);
});

test('Production Focus grid iki görünür modülü tüm genişlikte yarı yarıya, tek modülü tam genişlikte gösterir', () => {
  assert.match(CSS, /\.cpaGrid\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(CSS, /\.cpaGrid\.is-single\{[^}]*minmax\(0,1fr\)/);
  assert.match(CSS, /\.cpaLayoutEmpty\{[^}]*grid-column:1\/-1/);
  assert.match(CSS, /\.cpaLayoutModal\{/);
});

test('Rules Value alanı seçilen CP kolonunun canlı distinct değerlerini aranabilir picker olarak sunar', () => {
  assert.match(VIEW, /function ruleValueOptions\(fieldId\)/);
  assert.match(VIEW, /window\.BLCpAttentionColumns/);
  assert.match(VIEW, /data-cpa-value-search/);
  assert.match(VIEW, /data-cpa-value-options/);
  assert.match(VIEW, /\['in', 'notIn'\]\.includes\(condition\.operator\)/);
  assert.match(VIEW, /condition\.value = current\.join\(', '\)/);
  assert.match(VIEW, /condition\.field = el\.value;\s*condition\.value = '';/);
  assert.match(CSS, /\.cpaValueMenu\{/);
  assert.match(CSS, /\.cpaValueOptions\{/);
});

test('Rules Value picker body portal ile viewport-aware floating layer olarak açılır', () => {
  assert.match(VIEW, /document\.body\.appendChild\(menu\)/, 'value menu body portalına taşınmalı');
  assert.match(VIEW, /picker\.getBoundingClientRect\(\)/, 'anchor viewport konumu ölçülmeli');
  assert.match(VIEW, /spaceBelow/);
  assert.match(VIEW, /spaceAbove/);
  assert.match(VIEW, /openAbove = spaceBelow < 180 && spaceAbove > spaceBelow/);
  assert.match(VIEW, /document\.addEventListener\('scroll', onValueViewportChange, true\)/);
  assert.match(VIEW, /window\.addEventListener\('resize', onValueViewportChange\)/);
  assert.match(VIEW, /activeValueMenu === menu/);
  assert.match(VIEW, /aria-expanded/);
  assert.match(CSS, /\.cpaValueMenu\{position:fixed;z-index:120;/);
  assert.match(CSS, /--cpa-value-options-max-height/);
  assert.doesNotMatch(CSS, /\.cpaValueMenu\{position:absolute/);
  assert.doesNotMatch(CSS, /999999/);
});

test('Rules Field metadata kaynağı CP canlı column registry ile aynıdır', () => {
  const app = read('public/app-main.js');
  assert.match(VIEW, /columnCatalog: liveRuleColumnCatalog\(\)/);
  assert.match(app, /window\.BLCpAttentionColumns = \{/);
  assert.match(app, /dataType:c\.dataType\|\|c\._blSchema\?\.dataType\|\|''/);
});
