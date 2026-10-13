'use strict';

/* Koleksiyon kumaş kartları.
   - Saf motor (public/fabric-cards-engine.js) canlı test edilir.
   - Sunucu sözlüğü (server/lib/fabric-cards.js) geçici veri kökünde canlı test edilir.
   - app-main.js entegrasyonu kaynak sözleşmesiyle denetlenir: PLM metni satırda
     kalır, hücre kart özetini gösterir, içe aktarımlar eksik kartları önerir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BUYER_LOG_SERVER_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-fabric-cards-'));

const engine = require('../public/fabric-cards-engine.js');
const store = require('../server/lib/fabric-cards');
const prompts = require('../server/lib/lcwai/lcwai-prompt');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const SUPREM = '3859-Örme,Süprem,30/1 Ne,Compact Penye,Pamuk,150 gsm,100% Pamuk,Reaktif,Silikon + Dikiş Kolaylığı Apresi,Enzim,32,28,Sürdürülebilir İçerik Yok'; // i18n-ignore
const TWO_THREAD = '361819-Örme,İki İplik,30/1,Poliester,Pamuk,20/1,Pamuk,220 gsm,%80 Pamuk, %20 Poliester,Reaktif, Dispers,Silikon + Dikiş Kolaylığı Apresi, Enzim,28,Sürdürülebilir İçerik Yok'; // i18n-ignore

test('kumaş kodu yalnız metnin başındaki "1234-" kalıbından okunur', () => {
  assert.equal(engine.codeOf(SUPREM), '3859');
  assert.equal(engine.codeOf(TWO_THREAD), '361819');
  assert.equal(engine.codeOf('Örme,Süprem,150 gsm'), ''); // i18n-ignore
  assert.equal(engine.codeOf('Pamuk 3859-150'), ''); // i18n-ignore
});

test('9 haneli kod ve takım modelin A/B kumaşları ayrı kart kodu olarak okunur', () => {
  const SCUBA = '100000627-Örme,Soft Touch Scuba,230 gsm,40/1,%47 Poliester, %48 Viskoz, %5 Elastan'; // i18n-ignore
  assert.equal(engine.codeOf(SCUBA), '100000627');
  assert.equal(engine.ruleCard(SCUBA).code, '100000627');
  assert.equal(engine.ruleCard(SCUBA).summary, 'Soft Touch Scuba · 230 gsm · 48% Viskoz 47% Poliester 5% Elastan'); // i18n-ignore
  const SET = `A - ${SUPREM}\nB - ${TWO_THREAD}`;
  assert.deepEqual(engine.parts(SET).map(part => [part.label, part.code]), [['A', '3859'], ['B', '361819']]);
  assert.equal(engine.parts(SET)[1].raw, TWO_THREAD, 'her kumaş kendi PLM metniyle analiz edilir');
  assert.deepEqual(engine.parts('A - 3859-Örme,Süprem B - 32181-Örme,İki İplik').map(part => part.code), ['3859', '32181']); // i18n-ignore
  const cards = new Map([['3859', { code: '3859', summary: 'Süprem 150' }], ['361819', { code: '361819', summary: 'İki İplik 220' }]]); // i18n-ignore
  assert.equal(engine.displayText(SET, cards, 'tr'), 'A · 3859 · Süprem 150 / B · 361819 · İki İplik 220'); // i18n-ignore
  assert.deepEqual(engine.missingCodes([{ fabric: SET }, { fabric: SCUBA }], new Map([['3859', {}]])).map(item => item.code), ['361819', '100000627']);
  assert.equal(store.normalizeCode('100000627'), '100000627');
});

test('kural kartı PLM metninden kısa özet çıkarır ve değer uydurmaz', () => {
  const card = engine.ruleCard(SUPREM);
  assert.equal(card.code, '3859');
  assert.equal(card.summary, 'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk'); // i18n-ignore
  assert.ok(card.summary.length <= engine.SUMMARY_MAX);
  assert.equal(card.details.weight, '150 gsm');
  const blend = engine.ruleCard(TWO_THREAD);
  assert.equal(blend.details.composition, '80% Pamuk 20% Poliester'); // i18n-ignore
  assert.equal(engine.ruleCard('9999-Örme').details.weight, ''); // i18n-ignore
});

test('özet iki dillidir: TR ve EN, aynı sayılarla', () => {
  const card = engine.ruleCard(SUPREM);
  assert.equal(card.summaryEn, 'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton');
  assert.equal(engine.ruleCard(TWO_THREAD).summaryEn, 'Two Thread · 220 gsm · 80% Cotton 20% Polyester');
  assert.equal(engine.ruleCard('370380-Interlock,70,Denye Continue Flament 140 gsm,100%Polyester').summary, 'Interlock · 70 Denye · 140 gsm · 100% Poliester', 'TR özette kumaş tipi PLM yazımıyla kalır'); // i18n-ignore
  const cards = new Map([['3859', card]]);
  assert.equal(engine.displayText(SUPREM, cards, 'tr'), card.summary);
  assert.equal(engine.displayText(SUPREM, cards, 'en'), card.summaryEn);
  // Yalnız TR özetli eski kart EN'de sözlük çevirisiyle görünür.
  assert.equal(engine.summaryFor({ summary: 'Süprem · 100% Pamuk' }, 'en'), 'Single Jersey · 100% Cotton'); // i18n-ignore
  const ai = engine.validateAiCards([
    'code=3859|summary=Süprem · 150 gsm · 100% Pamuk|summaryEn=Single Jersey · 150 gsm · 100% Cotton', // i18n-ignore
    'code=4207|summary=Süprem · 180 gsm|summaryEn=Single Jersey · 999 gsm', // i18n-ignore — uydurma EN sayı
  ], [{ code: '3859', raw: SUPREM }, { code: '4207', raw: '4207-Örme,Süprem,180 gsm' }]); // i18n-ignore
  assert.equal(ai.cards['3859'].summaryEn, 'Single Jersey · 150 gsm · 100% Cotton');
  assert.equal(ai.cards['4207'].summarySource, 'ai');
  assert.equal(ai.cards['4207'].summaryEn, 'Single Jersey · 180 gsm', 'doğrulanamayan EN özet TR çevirisine düşer');
});

test('LCW AI önerisi deterministik doğrulayıcıdan geçer', () => {
  const requested = [{ code: '3859', raw: SUPREM }, { code: '361819', raw: TWO_THREAD }];
  const result = engine.validateAiCards([
    'code=3859|summary=Süprem · 30/1 Ne Penye · 150 gsm · 100% Pamuk|weight=150 gsm|yarn=40/1 Ne', // i18n-ignore
    'code=361819|summary=İki İplik · 999 gsm', // i18n-ignore — uydurma gramaj
    'code=111111|summary=Uydurma kumaş', // i18n-ignore — istenmeyen kod
  ], requested);
  assert.equal(result.cards['3859'].summarySource, 'ai');
  assert.equal(result.cards['3859'].details.weight, '150 gsm');
  assert.equal(result.cards['3859'].details.yarn, '', 'kaynakta olmayan sayı atılır');
  assert.equal(result.cards['361819'].summarySource, 'rule', 'doğrulanamayan öneri kural kartına düşer');
  assert.equal(result.cards['111111'], undefined);
  assert.deepEqual(result.rejected.map(item => item.reason).sort(), ['unknown-code', 'unsupported-number']);
});

test('kartı olan kod tekrar istenmez; tablo metni kart özetidir', () => {
  const cards = new Map([['3859', { code: '3859', summary: 'Süprem 150' }]]); // i18n-ignore
  const missing = engine.missingCodes([{ fabric: SUPREM }, { fabric: SUPREM }, { fabric: TWO_THREAD }, { fabric: 'Pamuk' }], cards); // i18n-ignore
  assert.deepEqual(missing.map(item => item.code), ['361819']);
  assert.equal(engine.displayText(SUPREM, cards), 'Süprem 150'); // i18n-ignore
  assert.equal(engine.displayText(TWO_THREAD, cards), TWO_THREAD);
  assert.deepEqual(engine.aiContext([{ code: '3859', raw: SUPREM }, { code: '3859', raw: SUPREM }]).fabrics, [`3859 :: ${SUPREM}`]);
});

test('sunucu sözlüğü kartı saklar, onlyMissing düzenlemeyi ezmez, silme çalışır', () => {
  const actor = { id: 'u1', displayName: 'Buyer' };
  const first = store.upsertFabricCards([{ code: '3859', summary: 'Süprem 150 gsm', summarySource: 'ai', raw: SUPREM }], actor); // i18n-ignore
  assert.equal(first.updated, 1);
  const manual = store.upsertFabricCards([{ code: '3859', summary: 'Benim özetim', summaryEn: 'My summary', summarySource: 'manual' }], actor); // i18n-ignore
  assert.equal(manual.updated, 1);
  assert.equal(manual.cards[0].summaryEn, 'My summary');
  assert.equal(manual.cards[0].raw, SUPREM, 'PLM metni korunur');
  const auto = store.upsertFabricCards([{ code: '3859', summary: 'Yeni AI', summarySource: 'ai' }], actor, null, { onlyMissing: true }); // i18n-ignore
  assert.equal(auto.updated, 0);
  assert.equal(store.loadFabricCards().cards['3859'].summary, 'Benim özetim'); // i18n-ignore
  assert.equal(store.upsertFabricCards([{ code: 'abc', summary: 'x' }, { code: '4207', summary: '' }], actor).updated, 0);
  const removed = store.deleteFabricCard('3859', actor);
  assert.equal(removed.deleted, true);
  assert.equal(store.loadFabricCards().cards['3859'], undefined);
});

test('LCW AI sözleşmesi tek kayıtta tanımlı ve cevap biçimi şekil olarak denetlenir', () => {
  assert.ok(prompts.contractFor('fabric-card'));
  const built = prompts.buildPrompt({ source: 'fabric-card', task: 'x', context: engine.aiContext([{ code: '3859', raw: SUPREM }]), lang: 'en' });
  assert.equal(built.contract, 'fabric-card');
  assert.match(built.prompt, /3859 :: 3859-/);
  const parsed = prompts.parseStructured('{"cards":["code=3859|summary=Suprem"]}', 'fabric-card');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.cards, ['code=3859|summary=Suprem']);
});

test('Koleksiyon tablosu PLM metnini korur, kart özetini gösterir ve içe aktarımda eksik kartları önerir', () => {
  assert.ok(HTML.indexOf('fabric-cards-engine.js') > 0 && HTML.indexOf('fabric-cards-engine.js') < HTML.indexOf('app-main.js'), 'motor app-main.js öncesinde yüklenir');
  assert.match(APP, /\}else if\(c\.k==='fabric'&&kolFabricParts\(val\)\.length\)\{\n\s*kolFabricCardsEnsureLoaded\(\);\n\s*html\+=kolFabricCellHtml\(r,val,rc\);/);
  assert.match(APP, /\.kolFabricTd\[data-fabric-id\]'\)\.forEach\(cell=>cell\.addEventListener\('dblclick'/);
  assert.match(APP, /if\(key==='fabric'\)return kolFabricDisplay\(effective\);/);
  assert.equal((APP.match(/kolFabricCardsAfterImport\(/g) || []).length, 5, 'tanım + dört PLM içe aktarma akışı');
  // Kart kaydı yalnız kullanıcı onayından sonra; otomatik akış mevcut kartı ezmez.
  assert.match(APP, /const cards=await showKolFabricBatchPreview\(still,analysis\);[\s\S]{0,400}kolFabricCardsSave\(cards,\{onlyMissing:true\}\)/);
  // Satırdaki PLM kumaş metni kart işlemlerinde yazılmaz.
  const block = APP.slice(APP.indexOf('// ================= KOLEKSİYON KUMAŞ KARTLARI'), APP.indexOf('function kolPlmListStatusOptions('));
  assert.doesNotMatch(block, /\.fabric\s*=(?!=)/);
});


test('fabric blends use numeric descending order and suffix percent signs in both languages',()=>{
  const raw='360236-Dokuma,Gabardin,250 gsm,15*15,%2 Yün, %2 Poliamid, %8 Akrilik, %6 Viskoz, %37 Pamuk, %45 Poliester,İpliği Boyalı'; // i18n-ignore
  const tr='45% Poliester 37% Pamuk 8% Akrilik 6% Viskoz 2% Yün 2% Poliamid'; // i18n-ignore
  const en='45% Polyester 37% Cotton 8% Acrylic 6% Viscose 2% Wool 2% Polyamide';
  const card=engine.ruleCard(raw);
  assert.equal(card.details.composition,tr);
  assert.equal(card.summary,'Gabardin · 250 gsm · '+tr);
  assert.equal(card.summaryEn,'Gabardin · 250 gsm · '+en);
  const old={code:'360236',summary:'Gabardin · 2% Yün 45% Poliester 37% Pamuk',summaryEn:'Gabardin · 2% Wool 45% Polyester 37% Cotton'};
  assert.equal(engine.summaryFor(old,'tr'),'Gabardin · 45% Poliester 37% Pamuk 2% Yün');
  assert.equal(engine.summaryFor(old,'en'),'Gabardin · 45% Polyester 37% Cotton 2% Wool');
  assert.equal(engine.translateTerms('%100 Pamuk','tr'),'100% Pamuk'); // i18n-ignore
  assert.equal(engine.normalizeComposition('100% Cotton'),'100% Cotton');
  assert.equal(engine.displayText(raw,new Map([['360236',card]]),'tr'),card.summary);
});

test('no arbitrary text limits: UI and persistent server preserve complete summaries and details',()=>{
  const long='Pamuk '+('detay '.repeat(170));
  const card=engine.normalizeCard({code:'360236',summary:long,summaryEn:long,details:{composition:long,yarn:long},raw:'360236-Örme'});
  assert.equal(card.summary.length,long.trim().length);
  assert.equal(card.details.composition,long.trim());
  const normalized=store.normalizeCard(card);
  assert.equal(normalized.summary,long.trim());
  assert.equal(normalized.details.yarn,long.trim());
  assert.equal(normalized.details.composition,long.trim());
  assert.equal(engine.SUMMARY_MAX,Infinity);
  assert.equal(engine.DETAIL_MAX,Infinity);
  assert.doesNotMatch(APP,/maxlength="\$\{(?:api|kolFabricApi\(\))\.(?:SUMMARY_MAX|DETAIL_MAX)\}"/);
});

test('Collection Fabric detail facets use same-card AND semantics, active filter persistence and whole-dataset filtering',()=>{
  assert.match(APP,/function kolFabricDetailMatches\(row,omitKey/);
  assert.match(APP,/kolFabricDetailsForRow\(row\)\.some\(details=>active\.every/);
  assert.match(APP,/if\(!passesKolColFilters\(r\)\|\|!kolFabricDetailMatches\(r\)\) return false/);
  assert.match(APP,/fabricDetails:Object\.fromEntries/);
  assert.match(APP,/if\(key==='fabric'\)kolFabricDetailPanel\(panel\)/);
  assert.match(APP,/kind:'fabricDetail'/);
  const css=fs.readFileSync(path.join(ROOT,'public','collection-spreadsheet.css'),'utf8');
  assert.match(css,/\.kolFabricFacetPanel/);
});

test('Collection copy, range clipboard, and both Excel exporters use visible Fabric Card summary',()=>{
  const sheet=fs.readFileSync(path.join(ROOT,'public','collection-spreadsheet.js'),'utf8');
  assert.match(APP,/if\(c\.k==='fabric'\)return kolFabricDisplay\(v\)/);
  assert.match(sheet,/coord\.key==='fabric'&&typeof global\.kolFabricDisplay==='function'/);
  assert.match(APP,/if\(c\.k==='fabric'\)\{put\(ri\+1,ci\+imgOff/);
  assert.match(APP,/if\(c\.k==='fabric'\)\{cell\.value=kolExportSingleLineText\(kolFabricDisplay\(raw\)\)/);
  assert.match(APP,/function kolStyleExportValue\(field,row\)[\s\S]*?if\(field\.k==='fabric'\)return kolFabricDisplay\(raw\)/);
});
