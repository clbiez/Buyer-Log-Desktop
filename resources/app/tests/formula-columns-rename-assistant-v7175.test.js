'use strict';

/*
 * v7.175 — HESAPLANAN SÜTUN: YENİDEN ADLANDIRMAYA DAYANIKLILIK + ASİSTAN
 *
 * Kullanıcı talebi (birebir):
 *   "Calculated column ile oluşturulan bir sütun; eğer formülün içerdiği diğer
 *    sütunların isimlerinde değişiklik olursa, formülü bozulur mu? Bozulmamasını
 *    sağlayalım. Bir de bu Calculated Column modülünü uçtan uca elden geçirmeni
 *    istiyorum. Hiç excel bilmeyen biri bile kolaylıkla kullanabilsin. Çok
 *    basitleştir. İsteyen advanced modda formül de yazsın, formül yazmak için
 *    bir sözlük de sun ... karmaşıksa AI'a formül yazma kurallarını anlatıp
 *    istediklerini söylesinler ve çıktıyı buyer loga kopyalasınlar, buyer log
 *    da analiz edip varsa hata söylesin."
 *
 * KUSURUN SEBEBİ: formül hesaplanan / veri tabanı sütunlarına ADIYLA
 * başvuruyor ve ad düz metin olarak saklanıyordu. Sütun yeniden adlandırılınca
 * eski ad hiçbir şeye çözülmüyor, sütun "Sütun bulunamadı" ile boş kalıyordu.
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *  1) Formül depoda kalıcı anahtarla ([__f_<id>], [__CPX_<id>]) saklanır,
 *     ekranda güncel adla gösterilir; yeniden adlandırma formülü bozmaz.
 *  2) Eski (ad ile saklanmış) formüller anlamı değişmeden taşınır.
 *  3) Silinen sütun hatası iç anahtarı değil son bilinen adı söyler.
 *  4) Analiz: olmayan sütun / fonksiyon / yanlış argüman sayısı / hücre adresi
 *     düz dille ve öneriyle bildirilir; Türkçe Excel adları düzeltilir.
 *  5) AI yönergesi kuralları, sözlüğü ve YALNIZ sütun adlarını içerir.
 *  6) Basit kartlar (gün farkı, yüzde, tarihe gün, koşul) birebir formül
 *     üretir ve düzenlemede geri çözülür.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FC_SOURCE = read('public/formula-columns.js');
const APP = read('public/app-main.js');
const CSS = read('public/app.css');

global.document = { readyState: 'complete', addEventListener() {} };
global.window = global;
const engine = require('../public/formula-engine.js');
global.window.BLFormulaEngine = engine;

function memoryStorage() {
  const store = {};
  return { store, getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); } };
}

/* Tarayıcı modülünü taze bir tablo taklidiyle yükler. */
function setup({ cols, defs = [], rows = [] }) {
  const storage = memoryStorage();
  const table = cols.map(col => ({ ...col }));
  Object.assign(global.window, {
    BLStorage: storage,
    COLS_BY_TABLE: { cp: table, orders: [], ship: [] },
    colmgr: { cp: { order: table.map(col => col.k), hidden: new Set(), widthPx: {} } },
    BLFormulaRows: { cp: () => rows },
    tableColumnLabel: (tableKey, col) => col.label || col.k,
  });
  delete require.cache[require.resolve('../public/formula-columns.js')];
  require('../public/formula-columns.js');
  const api = global.window.BLFormulaColumns;
  if (defs.length) api.save('cp', defs);
  return { api, storage, table };
}

const BASE = [
  { k: 'Order Code', label: 'Sipariş Kodu' },
  { k: 'Ex-factory', label: 'Ex-factory' },
  { k: 'Retail Date', label: 'Retail Date' },
  { k: '__CPX_m1', label: 'Antrepo Adedi', modelCustom: true, role: 'antrepo', modelColumnId: 'm1' },
];

/* ------------------------------------------------------------------ */
/* 1) ASIL KUSUR: yeniden adlandırma formülü bozmamalı                  */
/* ------------------------------------------------------------------ */

test('v7.175 · başvurulan HESAPLANAN sütun yeniden adlandırılınca formül çalışmaya devam eder', () => {
  const rows = [{ 'Order Code': 'A1', 'Ex-factory': '20260216', 'Retail Date': '20260302' }];
  const { api } = setup({
    cols: BASE,
    // Eski biçim: başvuru ADLA saklanmış.
    defs: [
      { id: 'lead', label: 'Üretim Süresi', formula: 'DAYS([Ex-factory], [Retail Date])' },
      { id: 'late', label: 'Gecikme', formula: '[Üretim Süresi] - 10' },
    ],
    rows,
  });
  api.syncColumns('cp');
  // Kullanıcı "Üretim Süresi"ni yeniden adlandırır.
  const list = api.definitions('cp');
  list.find(item => item.id === 'lead').label = 'Lead Time';
  api.save('cp', list);
  api.syncColumns('cp');
  const result = api.refresh('cp', rows);
  assert.deepEqual(result.errors, {}, 'yeniden adlandırma sonrası hata olmamalı');
  assert.equal(rows[0].__f_lead, 14);
  assert.equal(rows[0].__f_late, 4, 'bağımlı formül yeni adla da hesaplanmalı');
  const late = api.definitions('cp').find(item => item.id === 'late');
  assert.equal(late.formula, '[__f_lead] - 10', 'depoda kalıcı anahtar saklanır');
  assert.equal(api.displayFormula('cp', late), '[Lead Time] - 10', 'ekranda GÜNCEL ad görünür');
});

test('v7.175 · başvurulan VERİ TABANI sütunu yeniden adlandırılınca formül bozulmaz', () => {
  const rows = [{ 'Order Code': 'A1', __CPX_m1: 250 }];
  const { api, table } = setup({ cols: BASE, defs: [{ id: 'rest', label: 'Kalan', formula: '[Antrepo Adedi] - 10' }], rows });
  api.syncColumns('cp');
  table.find(col => col.k === '__CPX_m1').label = 'Bonded Qty';
  api.syncColumns('cp');
  const result = api.refresh('cp', rows);
  assert.deepEqual(result.errors, {});
  assert.equal(rows[0].__f_rest, 240);
  assert.equal(api.displayFormula('cp', api.definitions('cp')[0]), '[Bonded Qty] - 10');
});

test('v7.175 · pencereden kaydedilen formül adları kalıcı anahtara çevirir, gösterim geri çevirir', () => {
  const { api } = setup({ cols: BASE, defs: [{ id: 'lead', label: 'Üretim Süresi', formula: '1' }] });
  api.syncColumns('cp');
  const stored = api.toStorage('cp', '[üretim süresi] + [Antrepo Adedi] + [Sipariş Kodu] & "[Üretim Süresi]"');
  assert.equal(stored.formula, '[__f_lead] + [__CPX_m1] + [Order Code] & "[Üretim Süresi]"',
    'büyük/küçük harf fark etmez; ekrandaki Türkçe başlık da tanınır; tırnak içindeki yazıya dokunulmaz');
  assert.deepEqual(stored.refs, { __f_lead: 'Üretim Süresi', __CPX_m1: 'Antrepo Adedi' });
  assert.equal(api.displayFormula('cp', stored.formula, stored.refs), '[Üretim Süresi] + [Antrepo Adedi] + [Sipariş Kodu] & "[Üretim Süresi]"');
});

test('v7.175 · silinen sütunun hatası iç anahtarı değil son bilinen ADI söyler', () => {
  const rows = [{ 'Order Code': 'A1', 'Ex-factory': '20260216' }];
  const { api } = setup({
    cols: BASE,
    defs: [{ id: 'x', label: 'X', formula: '[__f_gone] + 1', refs: { __f_gone: 'Eski Sütun' } }],
    rows,
  });
  const result = api.refresh('cp', rows);
  assert.match(result.errors.x, /Sütun bulunamadı: Eski Sütun/);
  assert.equal(api.displayFormula('cp', api.definitions('cp')[0]), '[Eski Sütun] + 1');
  // Aynı adla yeniden kaydedilirse kimlik korunur (sütun geri gelirse çalışır).
  assert.equal(api.toStorage('cp', '[Eski Sütun] + 1', { __f_gone: 'Eski Sütun' }).formula, '[__f_gone] + 1');
});

test('v7.175 · taşıma formülün ANLAMINI değiştirmez: satırın kendi alanı önceliğini korur', () => {
  /* Eski çalışma zamanında satırın kendi alanı hesaplanan/veri tabanı adından
     önce okunuyordu (v7.34). Taşıma bunu bozarsa formül sessizce başka bir
     değeri okumaya başlardı (§152). */
  const rows = [{ 'Antrepo Adedi': 7, __CPX_m1: 999 }];
  const { api } = setup({ cols: BASE, defs: [{ id: 'y', label: 'Test', formula: '[Antrepo Adedi] + 0' }], rows });
  api.syncColumns('cp');
  assert.equal(api.definitions('cp')[0].formula, '[Antrepo Adedi] + 0', 'satır alanıyla çakışan ad taşınmaz');
  api.refresh('cp', rows);
  assert.equal(rows[0].__f_y, 7);
});

test('v7.175 · eski formüller yalnız eski çalışma zamanının tanıdığı yollarla taşınır', () => {
  // Temel sütunun EKRAN başlığı ("Sipariş Kodu") eskiden tanınmıyordu; taşıma
  // onu anahtara çevirirse eskiden hatalı olan bir formül sessizce değer üretirdi.
  const { api } = setup({ cols: BASE, defs: [{ id: 'z', label: 'Z', formula: 'TEXT([Sipariş Kodu])' }] });
  api.syncColumns('cp');
  assert.equal(api.definitions('cp')[0].formula, 'TEXT([Sipariş Kodu])');
});

test('v7.175 · kendine başvuru taşındıktan sonra da ÇEVRİM olarak yakalanır', () => {
  const rows = [{ 'Order Code': 'A1' }];
  const { api } = setup({ cols: BASE, defs: [{ id: 'self', label: 'Z', formula: '[Z] + 1' }], rows });
  api.syncColumns('cp');
  assert.equal(api.definitions('cp')[0].formula, '[__f_self] + 1');
  const result = api.refresh('cp', rows);
  assert.match(result.errors.self, /Döngü/);
});

test('v7.175 · sütun listesi paneli formülü güncel adlarla gösterir', () => {
  assert.match(APP, /function formulaColumnTooltip\(c,tableKey\)/);
  assert.match(APP, /fc\.displayFormula\(tableKey,def\)/);
  assert.match(APP, /formulaColumnTooltip\(c,tableKey\)/);
});

/* ------------------------------------------------------------------ */
/* 2) ANALİZ — "buyer log da analiz edip varsa hata söylesin"          */
/* ------------------------------------------------------------------ */

const COLUMNS = ['Ex-factory', 'Retail Date', 'Adet', 'Fiyat'];

test('v7.175 · olmayan sütun en yakın adı önererek bildirilir', () => {
  const result = engine.analyze('[Adt] * [Fiyat]', { columns: COLUMNS });
  assert.equal(result.ok, false);
  const issue = result.issues.find(item => item.code === 'UNKNOWN_COLUMN');
  assert.equal(issue.column, 'Adt');
  assert.equal(issue.suggestion, 'Adet');
  assert.match(issue.hintTr, /Bunu mu demek istediniz: \[Adet\]/);
});

test('v7.175 · bilinmeyen fonksiyon ve yanlış argüman sayısı doğru yazımla bildirilir', () => {
  const result = engine.analyze('ROUND([Adet], 1, 2) + VLOOKUP([Adet])', { columns: COLUMNS });
  const arity = result.issues.find(item => item.code === 'BAD_ARITY');
  assert.match(arity.tr, /ROUND\(\) 1-2 değer ister, formülde 3 tane var/);
  assert.match(arity.hintTr, /ROUND\(sayı, basamak\)/);
  assert.ok(result.issues.some(item => item.code === 'UNKNOWN_FUNCTION' && /VLOOKUP/.test(item.tr)));
});

test('v7.175 · Excel alışkanlıkları düz dille açıklanır: hücre adresi, aralık, köşeli parantezsiz ad', () => {
  assert.match(engine.analyze('A1 * 2', { columns: COLUMNS }).issues[0].hintTr, /Hücre adresi/);
  assert.match(engine.analyze('SUM(A1:A3)', { columns: COLUMNS }).issues[0].hintTr, /Aralık/);
  assert.match(engine.analyze('Adet * 2', { columns: COLUMNS }).issues[0].hintTr, /\[Adet\]/);
  assert.match(engine.analyze('([Adet] * 2', { columns: COLUMNS }).issues[0].tr, /Parantezler dengeli değil/);
  const quoted = engine.analyze('"Adet" * 2', { columns: COLUMNS });
  assert.ok(quoted.issues.some(item => item.code === 'QUOTED_COLUMN'), 'tırnak içindeki sütun adı uyarılır');
});

test('v7.175 · Türkçe Excel adları, "=", kıvrık tırnak ve × ÷ işaretleri otomatik düzeltilir', () => {
  const result = engine.analyze('=EĞER([Adet] ≥ 100; “Büyük”; YUVARLA([Fiyat] × 1,2; 0))', { columns: COLUMNS });
  assert.equal(result.formula, 'IF([Adet] >= 100; "Büyük"; ROUND([Fiyat] * 1,2; 0))');
  assert.ok(result.fixes.length >= 3, 'ne düzeltildiği söylenmeli');
  // "1,2" ondalık virgülü ANLAMI belirsiz olduğu için düzeltilmez; analiz hata verir.
  assert.equal(result.ok, false);
  const clean = engine.analyze('EĞER([Adet] > 100; "Büyük"; "Küçük")', { columns: COLUMNS });
  assert.equal(clean.ok, true);
  assert.equal(clean.formula, 'IF([Adet] > 100; "Büyük"; "Küçük")');
});

test('v7.175 · tırnak içindeki yazıya düzeltme dokunmaz', () => {
  assert.equal(engine.autoFix('[A] & " – " & "EĞER("').formula, '[A] & " – " & "EĞER("');
});

test('v7.175 · AI cevabından formül kod bloğu, satır içi kod ya da düz satırdan çıkarılır', () => {
  const fenced = 'Elbette! İşte formül:\n```\n=IF([Ex-factory] > [Retail Date], "Gecikmeli", "Zamanında")\n```\nBu formül tarihleri karşılaştırır.';
  assert.equal(engine.extractFormula(fenced), 'IF([Ex-factory] > [Retail Date], "Gecikmeli", "Zamanında")');
  assert.equal(engine.extractFormula('Şunu kullan: `DAYS([Ex-factory], [Retail Date])` yeterli.'), 'DAYS([Ex-factory], [Retail Date])');
  assert.equal(engine.extractFormula('Formül: ROUND([Fiyat] / [Adet], 2)\nAçıklama: birim fiyat.'), 'ROUND([Fiyat] / [Adet], 2)');
});

/* ------------------------------------------------------------------ */
/* 3) SÖZLÜK ve AI YÖNERGESİ                                           */
/* ------------------------------------------------------------------ */

test('v7.175 · sözlük motordaki HER fonksiyonu anlatır (sözlük ile motor ayrışamaz)', () => {
  const documented = new Set(engine.FUNCTION_DOCS.flatMap(item => [item.name, ...(item.also || [])]));
  const aliases = new Set(['BIRLESTIR']); // eski ad, TEXTJOIN'in eşi
  for (const name of Object.keys(engine.FUNCTIONS)) {
    if (aliases.has(name)) continue;
    assert.ok(documented.has(name), `${name} sözlükte yok`);
  }
  for (const item of engine.FUNCTION_DOCS) {
    assert.ok(item.tr && item.en && item.syntax && item.syntaxEn && item.example, `${item.name} eksik anlatılmış`);
    assert.equal(engine.compile(item.example).ok, true, `${item.name} örneği derlenmiyor: ${item.example}`);
  }
  for (const recipe of engine.RECIPE_DOCS) assert.equal(engine.compile(recipe.formula).ok, true, recipe.formula);
  assert.ok(engine.RULES.length >= 6);
});

test('v7.175 · AI yönergesi kuralları, fonksiyonları, sütun ADLARINI ve isteği içerir — satır verisi içermez', () => {
  const prompt = engine.buildAiPrompt({
    lang: 'tr', tableName: 'CP', request: 'Gecikmeyi göster',
    columns: [{ name: 'Ex-factory', type: 'date' }, { name: 'Adet', type: 'number' }],
  });
  assert.match(prompt, /KURALLAR/);
  assert.match(prompt, /köşeli parantez/);
  assert.match(prompt, /DAYS\(\[başlangıç\], \[bitiş\]\)/);
  assert.match(prompt, /- \[Ex-factory\] — tarih/);
  assert.match(prompt, /- \[Adet\] — sayı/);
  assert.match(prompt, /Gecikmeyi göster/);
  assert.match(prompt, /kod bloğu/);
  const english = engine.buildAiPrompt({ lang: 'en', columns: ['Qty'] });
  assert.match(english, /RULES/);
  assert.match(english, /- \[Qty\]/);
  // Pencere yönergeye yalnız ad + tür verir; değer değil.
  const block = FC_SOURCE.slice(FC_SOURCE.indexOf('function aiPrompt()'), FC_SOURCE.indexOf('function renderAiPrompt()'));
  assert.match(block, /columns\.map\(col => \(\{ name: col\.label, type: columnType\(tableKey, col\.ref\) \}\)\)/);
  assert.match(FC_SOURCE, /hiçbir satır verisi \(sipariş, fiyat, tedarikçi\) eklenmez/);
});

test('v7.175 · yeni fonksiyonlar: IFS, ROUNDUP, ROUNDDOWN, DATEDIF birimleri', () => {
  const value = (source, row = {}) => engine.compile(source).evaluate(row, { strictColumns: true }).value;
  assert.equal(value('IFS([M] < 20, "Düşük", [M] < 40, "Orta", TRUE, "Yüksek")', { M: 35 }), 'Orta');
  assert.equal(value('IFS([M] < 20, "Düşük")', { M: 35 }), null, 'hiçbiri tutmazsa boş');
  assert.equal(value('ROUNDUP(2.01)'), 3);
  assert.equal(value('ROUNDUP(-2.01)'), -3, 'Excel gibi sıfırdan uzağa');
  assert.equal(value('ROUNDDOWN(2.99, 1)'), 2.9);
  assert.equal(value('DATEDIF("2026-01-15", "2026-04-14", "m")'), 2, 'tamamlanmış ay');
  assert.equal(value('DATEDIF("2024-03-01", "2026-02-28", "y")'), 1);
  assert.equal(value('DATEDIF("2026-01-01", "2026-01-11")'), 10, 'birim yoksa gün (eski davranış)');
});

/* ------------------------------------------------------------------ */
/* 4) BASİT KARTLAR                                                    */
/* ------------------------------------------------------------------ */

test('v7.175 · kartlar birebir formül üretir ve düzenlemede aynı karta geri çözülür', () => {
  const { api } = setup({ cols: BASE });
  const cases = [
    [{ mode: 'days', days: { start: 'A', end: 'B' } }, 'DAYS([A], [B])'],
    [{ mode: 'percent', percent: { kind: 'ratio', a: 'A', b: 'B' } }, 'ROUND([A] / [B] * 100, 1)'],
    [{ mode: 'percent', percent: { kind: 'change', a: 'New', b: 'Old' } }, 'ROUND(([New] - [Old]) / [Old] * 100, 1)'],
    [{ mode: 'adddays', adddays: { date: 'A', days: '30', dir: '+' } }, 'ADDDAYS([A], 30)'],
    [{ mode: 'adddays', adddays: { date: 'A', days: '7', dir: '-' } }, 'ADDDAYS([A], -7)'],
    [{ mode: 'ifelse', ifelse: { left: 'A', cmp: 'ge', right: { kind: 'value', value: '1000' }, then: 'Büyük', else: '' } }, 'IF([A] >= 1000, "Büyük", "")'],
    [{ mode: 'ifelse', ifelse: { left: 'A', cmp: 'gt', right: { kind: 'column', column: 'B' }, then: 'Gecikmeli', else: 'Zamanında' } }, 'IF([A] > [B], "Gecikmeli", "Zamanında")'],
    [{ mode: 'ifelse', ifelse: { left: 'A', cmp: 'blank', right: {}, then: 'Tarih yok', else: 'Var' } }, 'IF(ISBLANK([A]), "Tarih yok", "Var")'],
    [{ mode: 'ifelse', ifelse: { left: 'A', cmp: 'notblank', right: {}, then: 1, else: 0 } }, 'IF(NOT(ISBLANK([A])), 1, 0)'],
    [{ mode: 'ifelse', ifelse: { left: 'A', cmp: 'contains', right: { kind: 'value', value: 'ELBİSE' }, then: 'Elbise', else: 'Diğer' } }, 'IF(CONTAINS([A], "ELBİSE"), "Elbise", "Diğer")'],
  ];
  for (const [builder, formula] of cases) {
    assert.equal(api.builderFormula(builder), formula);
    assert.equal(engine.compile(formula).ok, true, formula);
    const back = api.builderFromFormula(formula);
    assert.equal(back && back.mode, builder.mode, `${formula} kendi kartına dönmeli`);
    assert.equal(api.builderFormula(back), formula, `${formula} geri çözülüp aynı metni üretmeli`);
  }
  // Eksik kutu formül üretmez.
  assert.equal(api.builderFormula({ mode: 'days', days: { start: 'A', end: '' } }), '');
  assert.equal(api.builderFormula({ mode: 'ifelse', ifelse: { left: 'A', cmp: 'gt', right: { kind: 'value', value: '' } } }), '');
});

test('v7.175 · kart sonuçları gerçek değerle doğru hesaplanır', () => {
  const { api } = setup({ cols: BASE });
  const run = (builder, row) => engine.compile(api.builderFormula(builder)).evaluate(row, { strictColumns: true }).value;
  assert.equal(run({ mode: 'percent', percent: { kind: 'ratio', a: 'A', b: 'B' } }, { A: 25, B: 200 }), 12.5);
  assert.equal(run({ mode: 'percent', percent: { kind: 'change', a: 'N', b: 'O' } }, { N: 100, O: 80 }), 25);
  assert.equal(engine.dateText(run({ mode: 'adddays', adddays: { date: 'A', days: '30', dir: '+' } }, { A: '20260301' })), '2026-03-31');
  assert.equal(run({ mode: 'ifelse', ifelse: { left: 'A', cmp: 'gt', right: { kind: 'column', column: 'B' }, then: 'Gecikmeli', else: 'Zamanında' } }, { A: '20260310', B: '20260302' }), 'Gecikmeli');
});

/* ------------------------------------------------------------------ */
/* 5) PENCERE SÖZLEŞMESİ                                               */
/* ------------------------------------------------------------------ */

test('v7.175 · pencere "ne yapmak istiyorsunuz?" kartlarıyla açılır; sekiz iş türü vardır', () => {
  const block = FC_SOURCE.slice(FC_SOURCE.indexOf('class="fcModes"'), FC_SOURCE.indexOf('data-fc-build'));
  for (const mode of ['days', 'calc', 'percent', 'adddays', 'join', 'ifelse', 'advanced', 'ai']) {
    assert.ok(block.includes(`['${mode}'`), `${mode} kartı yok`);
  }
  assert.match(FC_SOURCE, /Ne yapmak istiyorsunuz\?/);
  assert.match(CSS, /\.fcModes\[data-bl-tabs\]\[role="tablist"\]\{display:grid;/);
});

test('v7.175 · Gelişmiş kipte sözlük ve canlı analiz var; AI kipinde kopyala / yapıştır / denetle akışı var', () => {
  assert.match(FC_SOURCE, /data-fc-dict-search/);
  assert.match(FC_SOURCE, /data-fc-dict-insert/);
  assert.match(FC_SOURCE, /data-fc-analysis/);
  assert.match(FC_SOURCE, /data-fc-autofix/);
  assert.match(FC_SOURCE, /data-fc-ai-copy/);
  assert.match(FC_SOURCE, /data-fc-ai-answer/);
  assert.match(FC_SOURCE, /E\.extractFormula\(answer\)/);
  assert.match(FC_SOURCE, /Otomatik düzeltildi:/);
});

test('v7.175 · kayıt, analizin bulduğu kalıcı hatada durur ve kendine başvuruyu engeller', () => {
  const save = FC_SOURCE.slice(FC_SOURCE.indexOf("if (event.target.closest('[data-fc-save]'))"));
  assert.match(save, /entry\.level === 'error' && entry\.code !== 'UNKNOWN_COLUMN'/);
  assert.match(save, /program\.columns\.includes\(columnKey\(item\)\)/);
  assert.match(save, /aynı adda bir sütun zaten var/);
});

test('v7.175 · boş "Ondalık basamak" otomatiktir — %12,5 "13%" görünmez', () => {
  const { api } = setup({ cols: BASE });
  global.window.appLang = 'tr';
  assert.equal(api.formatValue(12.5, { format: 'percent', decimals: '' }), '12,5%');
  assert.equal(api.formatValue(12.5, { format: 'percent', decimals: '0' }), '13%', 'elle 0 seçilirse yuvarlanır');
  assert.equal(api.formatValue(3.25, { format: 'auto', decimals: '' }), '3,25');
  delete global.window.appLang;
});

test('v7.175 · gizli formül satırı ve önizleme kutusu tarayıcıda gerçekten gizli / sıkışmasız', () => {
  assert.match(CSS, /\.fcEcho\[hidden\]\{display:none;\}/);
  assert.match(CSS, /\.fcBody>\*\{flex-shrink:0;\}/);
});

test('v7.177 · Koşula göre yaz birden çok sütunun durumunu VE / VEYA ile bağlar', () => {
  const { api } = setup({ cols: BASE });
  const multi = {
    mode: 'ifelse',
    ifelse: {
      left: 'A', cmp: 'eq', right: { kind: 'value', value: '1' },
      more: [{ left: 'B', cmp: 'eq', right: { kind: 'value', value: '0' } }],
      join: 'and', then: 'TEST', else: '',
    },
  };
  const formula = 'IF(AND([A] = 1, [B] = 0), "TEST", "")';
  assert.equal(api.builderFormula(multi), formula);
  assert.equal(engine.compile(formula).ok, true);
  const run = (builder, row) => engine.compile(api.builderFormula(builder)).evaluate(row, { strictColumns: true }).value;
  assert.equal(run(multi, { A: 1, B: 0 }), 'TEST');
  assert.equal(run(multi, { A: 1, B: 5 }), '');
  // Üç sütun ve VEYA; sütunla karşılaştırma ve boşluk kontrolü karışık.
  const orRule = {
    mode: 'ifelse',
    ifelse: {
      left: 'A', cmp: 'gt', right: { kind: 'column', column: 'B' },
      more: [
        { left: 'B', cmp: 'blank', right: {} },
        { left: 'A', cmp: 'contains', right: { kind: 'value', value: 'ELBİSE' } },
      ],
      join: 'or', then: 'Kontrol', else: 'Tamam',
    },
  };
  const orFormula = 'IF(OR([A] > [B], ISBLANK([B]), CONTAINS([A], "ELBİSE")), "Kontrol", "Tamam")';
  assert.equal(api.builderFormula(orRule), orFormula);
  for (const text of [formula, orFormula]) {
    const back = api.builderFromFormula(text);
    assert.equal(back && back.mode, 'ifelse', `${text} Koşul kartına dönmeli`);
    assert.equal(api.builderFormula(back), text, `${text} geri çözülüp aynı metni üretmeli`);
  }
  assert.equal(api.builderFromFormula(orFormula).ifelse.more.length, 2);
  assert.equal(api.builderFromFormula(orFormula).ifelse.join, 'or');
  // Eksik ek koşul formül üretmez; tek koşullu eski kayıtlar değişmez.
  assert.equal(api.builderFormula({ mode: 'ifelse', ifelse: { ...multi.ifelse, more: [{ left: 'B', cmp: 'eq', right: { kind: 'value', value: '' } }] } }), '');
  assert.equal(api.builderFormula({ mode: 'ifelse', ifelse: { left: 'A', cmp: 'ge', right: { kind: 'value', value: '1000' }, then: 'Büyük', else: '' } }), 'IF([A] >= 1000, "Büyük", "")');
  // Arayüz: koşul ekle/kaldır ve ortak ve/veya seçimi.
  assert.match(FC_SOURCE, /data-fc-if-add/);
  assert.match(FC_SOURCE, /data-fc-if-drop="\$\{index\}"/);
  assert.match(FC_SOURCE, /data-fc-if-join/);
});

test('v7.178 · Koşula göre yaz: birden çok kural ("değilse eğer") — kullanıcının örneği', () => {
  /* Kullanıcı talebi (birebir): "label by condition alanında çoklu eğer koşulu
     koyamıyorum. Mesela X = 0 veya X = "" ise "N/A", X = 1 ve Y = 0 ise
     "Pending", X = 1 ve Y = 1 ise "OK" yazdırmak istiyorum." */
  const { api } = setup({ cols: BASE });
  const builder = {
    mode: 'ifelse',
    ifelse: {
      left: 'X', cmp: 'eq', right: { kind: 'value', value: '0' },
      more: [{ left: 'X', cmp: 'blank', right: {} }], join: 'or', then: 'N/A',
      cases: [
        { left: 'X', cmp: 'eq', right: { kind: 'value', value: '1' }, more: [{ left: 'Y', cmp: 'eq', right: { kind: 'value', value: '0' } }], join: 'and', then: 'Pending' },
        { left: 'X', cmp: 'eq', right: { kind: 'value', value: '1' }, more: [{ left: 'Y', cmp: 'eq', right: { kind: 'value', value: '1' } }], join: 'and', then: 'OK' },
      ],
      else: '',
    },
  };
  const formula = 'IFS(OR([X] = 0, ISBLANK([X])), "N/A", AND([X] = 1, [Y] = 0), "Pending", AND([X] = 1, [Y] = 1), "OK", TRUE, "")';
  assert.equal(api.builderFormula(builder), formula);
  const run = row => engine.compile(formula).evaluate(row, { strictColumns: true }).value;
  assert.equal(run({ X: 0, Y: 5 }), 'N/A');
  assert.equal(run({ X: '', Y: 1 }), 'N/A', 'boş X de N/A');
  assert.equal(run({ X: 1, Y: 0 }), 'Pending');
  assert.equal(run({ X: 1, Y: 1 }), 'OK');
  assert.equal(run({ X: 2, Y: 1 }), '', 'hiçbiri tutmazsa "değilse" değeri');
  // Kaydedilen formül düzenlemede AYNI kurallarla karta döner.
  const back = api.builderFromFormula(formula);
  assert.equal(back.mode, 'ifelse');
  assert.equal(back.ifelse.cases.length, 2);
  assert.equal(back.ifelse.join, 'or');
  assert.equal(back.ifelse.cases[0].then, 'Pending');
  assert.equal(api.builderFormula(back), formula);
  // Eksik bir kural formül üretmez; tek kural eski IF biçiminde kalır.
  assert.equal(api.builderFormula({ mode: 'ifelse', ifelse: { ...builder.ifelse, cases: [{ left: 'X', cmp: 'eq', right: { kind: 'value', value: '' }, more: [], then: 'x' }] } }), '');
  assert.equal(api.builderFormula({ mode: 'ifelse', ifelse: { ...builder.ifelse, cases: [] } }), 'IF(OR([X] = 0, ISBLANK([X])), "N/A", "")');
  // AI/Excel alışkanlığı: iç içe IF de kurallara açılır.
  const nested = api.builderFromFormula('IF([X] = 0, "N/A", IF(AND([X] = 1, [Y] = 0), "Pending", "OK"))');
  assert.equal(nested.mode, 'ifelse');
  assert.equal(nested.ifelse.cases.length, 1);
  assert.equal(nested.ifelse.else, 'OK');
  assert.equal(api.builderFromFormula('IFS([X] = 0, "N/A", [X] = 1, [Y] * 2, TRUE, "")'), null, 'hesaplı sonuç karta sığmaz');
  // Arayüz: kural ekle/kaldır, kurala özel satırlar, sıralama açıklaması.
  assert.match(FC_SOURCE, /data-fc-case-add/);
  assert.match(FC_SOURCE, /data-fc-case-drop=/);
  assert.match(FC_SOURCE, /data-fc-case="\$\{caseIndex\}"/);
  assert.match(FC_SOURCE, /Kurallar YUKARIDAN AŞAĞI denenir/);
  assert.match(CSS, /\.fcCase\.isMany\{/);
});
