'use strict';

/* Görselden arama (CP / Siparişler / Koleksiyon arama kutusu) ve LCW AI'a
   giden model görseli paftaları. LCW AI yalnız aday önerir; tabloda
   bulunmayan değer aramaya girmez, sorgu yalnız kullanıcı onayıyla yazılır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const engine = require('../public/image-search-engine.js');
const { createTableSearch } = require('./helpers/bl-table-search');
const prompts = require('../server/lib/lcwai/lcwai-prompt');

const search = createTableSearch();
const matches = (haystack, value) => search.matches(haystack, search.parseTerms(value), { plainMode: 'contains' });

test('motor: aday değer arama dilini bozamaz; tekrar ve boş atılır', () => {
  assert.equal(engine.cleanValue('  2135851 '), '2135851');
  assert.equal(engine.cleanValue('PNT, ARTEMIS'), 'PNT,ARTEMIS', '", " VEYA ayırıcısı değerin içinde kalmaz');
  assert.equal(engine.cleanValue('Disney; Bangladesh'), 'Disney;Bangladesh', '"; " VE ayırıcısı değerin içinde kalmaz');
  assert.equal(engine.cleanValue('!W7J403Z4'), 'W7J403Z4', 'başta ! "içermez" ölçütüne dönmez');
  assert.equal(engine.cleanValue('(BOST)'), 'BOST');
  assert.equal(engine.cleanValue('x'.repeat(121)), '');
  assert.equal(engine.cleanValue('W6'), '', 'çok kısa değer tablonun çoğuna uyar; aday sayılmaz');
  assert.deepEqual(engine.cleanValues(['Beşiktaş', 'BEŞİKTAŞ', '', null, 'Fenerbahçe']), ['Beşiktaş', 'Fenerbahçe']);
  assert.deepEqual(engine.variantsFor('PNT,LUCAS-YD'), ['PNT,LUCAS-YD', 'LUCAS-YD']);
  assert.deepEqual(engine.variantsFor('UK.TSH,FT-AKISO'), ['UK.TSH,FT-AKISO', 'FT-AKISO']);
  assert.deepEqual(engine.variantsFor('1288035'), ['1288035']);
  assert.deepEqual(engine.variantsFor('12,50'), ['12,50'], 'ondalık sayı kısa parçaya düşmez');
  assert.deepEqual(engine.variantsFor('Disney,Bangladesh,Egypt'), ['Disney,Bangladesh,Egypt'], 'virgülle birleşmiş liste parçalanıp tek kuyruğa düşmez');
  assert.equal(engine.tabForInput('cpSearch'), 'cp');
  assert.equal(engine.tabForInput('ordersSearch'), 'orders');
  assert.equal(engine.tabForInput('kolSearch'), 'koleksiyon');
  assert.equal(engine.tabForInput('shipSearch'), '', 'kapsam yalnız CP, Siparişler ve Koleksiyon');
});

test('motor: yalnız tabloda gerçekten bulunan değerler sorguya girer; okuma hatası "bulunamadı" olur', () => {
  const space = { haystacks: [
    '2135851 bost key orme t-shirt fakir knitwears w7j403z4 1288035 r9j ecru',
    '1343645 artemis jek dokuma pantolon rql',
    '1304511 caribu-ny hpj',
    '7 lucas-yd pnt',
  ] };
  const checked = engine.validate({
    values: ['1288035', '1343645', '13O4511', 'PNT,LUCAS-YD', '1288035 '],
    field: 'Order Code',
    explanation: '…',
  }, space, matches);
  assert.equal(checked.ok, true);
  assert.equal(checked.field, 'Order Code');
  assert.deepEqual(checked.found.map(item => [item.value, item.query, item.count]), [
    ['1288035', '1288035', 1],
    ['1343645', '1343645', 1],
    ['PNT,LUCAS-YD', 'LUCAS-YD', 1],
  ]);
  assert.deepEqual(checked.missing, ['13O4511'], 'O/0 karışan değer sonuca karışmaz');
  assert.equal(checked.query, '1288035, 1343645, LUCAS-YD');
  assert.equal(checked.rowCount, 3);
  assert.deepEqual(search.parseTerms(checked.query).map(item => item.value), ['1288035', '1343645', 'lucas-yd'], 'üretilen sorgu mevcut arama diliyle VEYA listesi olarak okunur');

  const none = engine.validate({ values: ['XYZ'], explanation: '' }, space, matches);
  assert.equal(none.ok, false);
  assert.equal(none.query, '');
  assert.equal(engine.validate(null, space, matches).ok, false);
});

test('motor: LCW AI bağlamı tablonun arama alanlarını ve biçim örneklerini taşır', () => {
  const rows = [{ 'Order Code': '1288035', 'Model Name': 'BOST' }, { 'Order Code': '1288035', 'Model Name': 'URBAN' }, { 'Order Code': '', 'Model Name': 'CULTURE' }];
  const context = engine.aiContext({
    tab: 'cp', rows, haystacks: ['a', 'b', 'c'],
    fields: [{ key: 'Order Code', label: 'Order Code' }, { key: 'Model Name', label: 'Model Name' }],
    valueOf: (row, key) => row[key],
  });
  assert.deepEqual(context, {
    screen: 'cp', rowCount: 3,
    searchableFields: [{ label: 'Order Code', examples: ['1288035'] }, { label: 'Model Name', examples: ['BOST', 'URBAN', 'CULTURE'] }],
  });
});

test('app-main: arama uzayı ekrandaki aramayla aynı alanları ve haystack’i kullanır', () => {
  const source = read('public/app-main.js');
  const body = source.match(/\nfunction tableSearchSpace\(tab\)\{[^]*?\n\}/);
  assert.ok(body, 'tableSearchSpace bulunmalı');
  assert.match(source, /window\.BLTableSearch\.searchSpace=tableSearchSpace;/);
  const cpKeys = source.match(/const CP_SEARCH_KEYS=(\[[^\]]*\]);/)[1];
  const space = Function('state', 'kolRows', `
    const norm = value => String(value == null ? '' : value).trim();
    const CP_SEARCH_KEYS = ${cpKeys};
    const KOL_SEARCH_KEYS = ['plmId', 'modelKod'];
    const kolSearchHaystack = row => row.plmId + ' ' + row.modelKod.toLowerCase();
    const kolColDefs = () => [{ k: 'plmId', label: 'PLM ID' }];
    const kolColumnLabel = col => col.label;
    const kolEffectiveValue = (row, key) => row[key];
    ${body[0]}
    return tableSearchSpace;
  `)({ cp: { rows: [{ 'Order Code': '1288035', 'Model Name': 'BOST', Quantity: 6217 }] }, orders: { rows: [] } }, [{ plmId: '2135851', modelKod: 'BOST' }]);
  const cp = space('cp');
  assert.equal(cp.haystacks.length, 1);
  assert.match(cp.haystacks[0], /bost/);
  assert.doesNotMatch(cp.haystacks[0], /6217/, 'arama alanı olmayan sütun (adet) eşleşmeye girmez');
  assert.ok(cp.fields.some(field => field.label === 'Order Code'));
  assert.deepEqual(space('orders').haystacks, []);
  const kol = space('koleksiyon');
  assert.deepEqual(kol.haystacks, ['2135851 bost']);
  assert.deepEqual(kol.fields, [{ key: 'plmId', label: 'PLM ID' }, { key: 'modelKod', label: 'modelKod' }]);
  assert.equal(space('shipping'), null);
  // CP ve Siparişler süzgeci aynı CP_SEARCH_KEYS haystack'ini kurar.
  assert.equal((source.match(/for\(let i=0;i<CP_SEARCH_KEYS\.length;i\+\+\)/g) || []).length, 2);
});

test('LCW AI sözleşmesi: image-search tek AI yolundan geçer, cevap şekli denetlenir', () => {
  assert.ok(prompts.CONTRACTS['image-search']);
  const built = prompts.buildPrompt({ source: 'image-search', task: 'Bu görseldeki değerleri tabloda ara.', context: { screen: 'orders', searchableFields: [{ label: 'Order Code', examples: ['1288035'] }] }, lang: 'tr' });
  assert.equal(built.contract, 'image-search');
  assert.match(built.prompt, /CONTEXT\.searchableFields/);
  assert.match(built.prompt, /okuyamadığın değeri uydurma/);
  assert.match(built.prompt, /"values": string\[\]/);
  const en = prompts.buildPrompt({ source: 'image-search', task: 'x', lang: 'en' });
  assert.match(en.prompt, /never invent or complete a value you cannot read/);
  const parsed = prompts.parseStructured('```json\n{"values":["1288035","1343645"],"field":"Order Code","explanation":"Sipariş kodları"}\n```', 'image-search');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.values, ['1288035', '1343645']);
  assert.deepEqual(prompts.parseStructured('{"values":"1288035","explanation":"x"}', 'image-search').data.values, ['1288035'], 'tek değer dizi olur');
  assert.equal(prompts.parseStructured('Sipariş kodları: 1288035', 'image-search').ok, false, 'JSON olmayan cevap öneri sayılmaz');
});

function pasteHarness() {
  const listeners = [];
  const toasts = [];
  const document = {
    documentElement: { lang: 'tr' },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    querySelector: () => null,
  };
  const window = { appLang: 'tr', showToast: text => toasts.push(text) };
  const context = vm.createContext({ window, document, console });
  vm.runInContext(read('public/image-search.js'), context);
  return { listeners, toasts, window };
}

function pasteEvent(id, { text = '', image = true } = {}) {
  const calls = [];
  const items = image ? [{ kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 10 }) }] : [];
  return {
    calls,
    event: {
      target: { id },
      clipboardData: { items, getData: () => text },
      preventDefault: () => calls.push('preventDefault'),
      stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
    },
  };
}

test('yapıştırma: görsel yalnız üç arama kutusunda yakalanır; Excel metni ve diğer alanlar etkilenmez', () => {
  const harness = pasteHarness();
  const listener = harness.listeners.find(item => item.type === 'paste');
  assert.ok(listener && listener.capture === true, 'yakalama aşaması: satır görseline yapıştırmadan önce çalışır');

  const excel = pasteEvent('cpSearch', { text: '1288035\t6217\n1343645\t3880' });
  listener.fn(excel.event);
  assert.deepEqual(excel.calls, [], 'pano metin taşıyorsa mevcut Excel yapıştırması çalışır');

  const other = pasteEvent('kolNote');
  listener.fn(other.event);
  assert.deepEqual(other.calls, []);

  const plain = pasteEvent('ordersSearch', { image: false, text: '' });
  listener.fn(plain.event);
  assert.deepEqual(plain.calls, []);

  for (const id of ['cpSearch', 'ordersSearch', 'kolSearch']) {
    const shot = pasteEvent(id);
    listener.fn(shot.event);
    assert.deepEqual(shot.calls, ['preventDefault', 'stopImmediatePropagation'], `${id}: görsel aramaya gider, satır görseline yapıştırılmaz`);
  }
});

test('arayüz: görsel yalnız kullanıcı istediğinde yüklenir, sonuç yalnız onayla aramaya yazılır', () => {
  const source = read('public/image-search.js');
  assert.match(source, /ai\.openPanel\(\{[^]*source: 'image-search'/);
  assert.match(source, /async buildRequest\(text\) \{[^]*if \(!attachment\) attachment = await ai\.uploadFile\(upload\);/, 'yükleme panel açılırken değil, istek gönderilirken');
  assert.match(source, /interpret\(result\) \{[^]*engine\.validate\(data, space, matcher\(\)\)/);
  assert.match(source, /onApply\(query\) \{[^]*input\.value = query;[^]*dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
  assert.match(source, /return search\.matches\(haystack, parsed\.get\(value\), \{ plainMode: 'contains' \}\)/, 'ekrandaki aramayla aynı eşleşme');
  assert.doesNotMatch(source, /\/api\/lcwai\//, 'modül LCW AI\'a kendi entegrasyonuyla gitmez');
  const html = read('public/index.html');
  const order = ['app-main.js', 'table-search-row-groups.js', 'image-search.js'].map(name => html.indexOf(`<script src="${name}?`));
  assert.ok(order.every(index => index > 0) && order[0] < order[1] && order[1] < order[2], 'image-search.js app-main ve satır grubu aramasından sonra yüklenir');
  assert.doesNotMatch(html, /<script src="image-search-engine\.js/, 'motor ilk görsel yapıştırmada tembel yüklenir');
  assert.match(source, /_loadScript[^]*'image-search-engine\.js\?rev=1'/);
});

test('arayüz: önizleme bulunan/bulunamayan değerleri ve sorguyu TR/EN gösterir', () => {
  const window = { appLang: 'en' };
  const context = vm.createContext({ window, document: { documentElement: { lang: 'en' }, addEventListener() {} }, console });
  vm.runInContext(read('public/image-search.js'), context);
  const checked = { ok: true, field: 'Order Code', found: [{ value: 'PNT,LUCAS-YD', query: 'LUCAS-YD', count: 2 }], missing: ['13O4511'], query: 'LUCAS-YD', rowCount: 2 };
  const en = window.BLImageSearch.resultHtml(checked);
  assert.match(en, /Values found in the table \(1\) · 2 records/);
  assert.match(en, /PNT,LUCAS-YD → LUCAS-YD/);
  assert.match(en, /Values not found in this table \(1\)/);
  assert.match(en, /lcwaiChip is-error[^>]*>13O4511/);
  window.appLang = 'tr';
  assert.match(window.BLImageSearch.resultHtml(checked), /Tabloda bulunan değerler \(1\) · 2 kayıt/);
});

test('sohbet: model görselleri anahtar etiketli paftalarla LCW AI’a eklenir', () => {
  const window = {
    appLang: 'tr',
    BLAIScreenData: { lastTab: () => 'koleksiyon', pageTitle: () => 'Koleksiyon', table: () => null },
    BuyerLogAI: { registerContextProvider() {}, getAvailableContext: () => [] },
  };
  window.window = window;
  const context = vm.createContext({ window, document: { documentElement: { lang: 'tr' }, getElementById: () => null }, File: class {}, console });
  vm.runInContext(read('public/lcwai-chat.js'), context);
  const chat = window.BLLcwAiChat;
  const keys = Array.from({ length: 40 }, (_, index) => `KOL-${index + 1}`);
  const plan = chat.modelImageSheetPlan(keys, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.sheets.map(sheet => [sheet.fileName, sheet.keys.length]))), [['BuyerLog-model-images-1.jpg', 16], ['BuyerLog-model-images-2.jpg', 16]]);
  assert.equal(plan.sheets[1].keys[0], 'KOL-17');
  assert.equal(plan.omitted.length, 8, 'ek sınırı aşılınca kalan görseller bildirilir');
  assert.equal(chat.modelImageSheetPlan(keys, 0).sheets.length, 0);
  assert.equal(chat.modelImageSheetPlan(keys, 9).sheets.length, 3, 'en çok 3 pafta');
  assert.equal(chat.modelImageSheetPlan(['KOL-1', 'KOL-1'], 5).sheets[0].keys.length, 1);
  const note = chat.modelImageSheetsContext(['BuyerLog-model-images-1.jpg'], 16, 24);
  assert.equal(note.label, 'Model görselleri');
  assert.match(note.text, /“BuyerLog-model-images-1\.jpg” paftalarında 16 model görseli var; her karenin altında kaydın “BL Image” anahtarı yazılı/);
  assert.match(note.text, /24 model görseli ek sınırı nedeniyle ya da okunamadığı için eklenmedi/);
  window.appLang = 'en';
  assert.match(chat.modelImageSheetsContext(['a.jpg'], 3, 0).text, /hold 3 model images; each tile is labelled with the record’s “BL Image” key/);
  assert.equal(chat.modelImageSheetsContext([], 0, 0), null);

  const source = read('public/lcwai-chat.js');
  assert.match(source, /const sheets = await uploadModelImageSheets\(contextImages, maxFiles - userMessage\.attachments\.length,/, 'sohbet mesajı bağlamdaki görselleri ek olarak gönderir');
  assert.match(source, /userMessage\.attachments\.push\(\.\.\.sheets\.attachments\);[^]*if \(sheets\.context\) userMessage\.contexts\.unshift\(sheets\.context\);/, 'sunucunun bağlam sınırında pafta açıklaması kaybolmaz');
  assert.match(source, /ctx\.fillText\(key,/, 'her karenin altında anahtar yazılıdır');
  assert.match(source, /try \{ attachments\.push\(await api\.uploadFile\(new File\(\[blob\], sheet\.fileName[^]*catch \(error\) \{ if \(error && error\.code === 'LCWAI_CANCELLED'\) throw error; continue; \}/, 'pafta yüklenemezse mesaj yine gider (iptal hariç)');
  assert.doesNotMatch(source, /görselin kendisi LCW AI'a GİTMEZ/);
});

test('çıktı sözleşmesi: LCW AI’a görselleri göremeyeceği söylenmez; ekli paftalara bakması söylenir', () => {
  const contracts = require('../server/lib/lcwai-output/output-contracts');
  const template = require('../server/lib/lcwai-output/output-templates').TEMPLATES.general;
  const tr = contracts.buildInstruction({ format: 'pdf', template, lang: 'tr' });
  const en = contracts.buildInstruction({ format: 'pptx', template, lang: 'en' });
  assert.doesNotMatch(tr, /Görselleri göremezsin/);
  assert.doesNotMatch(en, /You cannot see the images/);
  assert.match(tr, /paftaları ekliyse[^]*onlara bak/);
  assert.match(en, /contact sheets of these images are attached[^]*look at them/);
});
