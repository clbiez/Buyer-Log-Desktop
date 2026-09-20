'use strict';

/* v11.00 — CANLI CoreNectum Style API sözleşmesi.
 *
 * Bu dosyanın koruduğu regression: model/renk görselini bulmak için artık
 * kullanıcının GÖRÜNEN Style List ekranı sürülmüyor (filtre kaldırma, 15-20
 * bin satırlık sayfalama, model detay DOM'u). Bunun yerine canlı ölçümle
 * doğrulanmış iki uç doğrudan çağrılıyor. İstek gövdesi, parti bölme ve
 * görsel SEÇİM POLİTİKASI burada belirlenimci olarak sınanır.
 *
 * KRİTİK SEÇİM KURALI: varsayılan olmayan bir Style Image ASLA otomatik
 * seçilmez. Gerçek CoreNectum verisinde teknik çizimler de
 * imageType == "Style Image" ile geliyor; tek güvenilir ayraç isDefault.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../server/lib/corenectum-style-api');

test('GetStyleList 100 PLM parti gövdesi canlı doğrulanmış biçimdedir', () => {
  const codes = Array.from({ length: 100 }, (_, index) => String(2126000 + index));
  const body = api.styleListBatchBody(codes);

  assert.equal(body.pageNumber, 1);
  assert.ok(body.pageSize >= codes.length, 'pageSize parti boyundan küçük olamaz');
  assert.equal(body.filterCriterias.length, 1);
  assert.equal(body.filterCriterias[0].filterColumnName, 'plmCode');
  assert.equal(body.filterCriterias[0].filterOperator, 10);
  assert.equal(body.filterCriterias[0].filterValue, codes.join(','));
  assert.deepEqual(body.searchCriteria, { columnNames: [], searchText: '' });
  assert.equal(body.favoriteGroupId, null);
  assert.equal(api.STYLE_LIST_BATCH_SIZE, 100);
});

test('PLM listesi API çağrısından ÖNCE tekilleştirilir', () => {
  const body = api.styleListBatchBody(['2126186', '2126186', '02126186', '2126186.0', '2126147']);
  assert.equal(body.filterCriterias[0].filterValue, '2126186,2126147');
});

test('başarısız parti 100 -> 50 -> 20 basamaklarıyla bölünür, sonra durur', () => {
  assert.equal(api.nextFallbackBatchSize(100), 50);
  assert.equal(api.nextFallbackBatchSize(50), 20);
  assert.equal(api.nextFallbackBatchSize(20), 0);
  assert.equal(api.nextFallbackBatchSize(7), 0);
});

test('GetStyleImages gövdesi yalnız styleId taşır', () => {
  assert.deepEqual(api.styleImagesRequestBody('2508501'), { styleId: '2508501' });
  assert.throws(() => api.styleImagesRequestBody('abc'), /Style ID/);
});

test('GetStyleList satırları plmCode ile styleId ayrımını korur', () => {
  const payload = { data: { coreNectumResultData: { styleListResult: [
    { plmCode: 2126186, styleId: 2508501, styleName: 'SOFT-1-TR', model: { imageUrl: 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/aaa' }, colors: [{ colorCode: 'CVL', name: 'NEW BLACK' }] },
  ] } } };
  const { rows } = api.styleListRowsByPlm(payload);
  const row = rows.get('2126186');
  assert.equal(row.styleId, '2508501');
  assert.equal(row.styleName, 'SOFT-1-TR');
  assert.match(row.imageUrl, /Attachment\/GetAttachment\/aaa$/);
  assert.deepEqual(row.colors[0].colourCode, 'CVL');
});

test('aynı PLM için çelişen satırlar keyfi seçim yerine belirsiz sayılır', () => {
  const payload = { data: { coreNectumResultData: { styleListResult: [
    { plmCode: 1, styleId: 10 }, { plmCode: 1, styleId: 11 },
  ] } } };
  const parsed = api.styleListRowsByPlm(payload);
  assert.equal(parsed.rows.has('1'), false);
  assert.deepEqual(parsed.ambiguous, ['1']);
});

test('Attachment olmayan bir host ASLA görsel adresi sayılmaz', () => {
  assert.equal(api.attachmentUrl('https://evil.example.com/Attachment/GetAttachment/x'), '');
  assert.equal(api.attachmentUrl('http://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/x'), '');
  assert.equal(api.attachmentUrl('https://mym-api.lcwaikiki.com/other/path'), '');
  assert.match(api.attachmentUrl('https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/x'), /GetAttachment\/x$/);
});

/* ---------- Seçim politikası ---------- */

const ATTACH = name => `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/${name}`;

const OPTION_IMAGES = [
  { styleOptionId: '4141433', styleOptionImageId: '8138107', colorCode: 'FFS', name: 'BLUE', imageType: 'Option Image', imageUrl: ATTACH('ffs') },
  { styleOptionId: '4141440', styleOptionImageId: '8138200', colorCode: 'ZAK', name: 'ECRU', imageType: 'Option Image', imageUrl: ATTACH('zak') },
];
const STYLE_IMAGES = [
  // GERÇEK VERİ: teknik çizim de "Style Image" tipiyle gelir. isDefault false
  // olduğu için ASLA seçilemez.
  { attachmentAssociationId: '7000001', isDefault: false, imageType: 'Style Image', imageName: 'technical-drawing', imageUrl: ATTACH('technical') },
  { attachmentAssociationId: '8890711', isDefault: true, imageType: 'Style Image', imageName: 'default', imageUrl: ATTACH('default') },
];

test('1. öncelik: Renk Kodu birebir eşleşen Option Image seçilir', () => {
  const selection = api.selectColourImage({ colourCode: 'FFS', optionImages: OPTION_IMAGES, styleImages: STYLE_IMAGES, styleListImageUrl: ATTACH('list') });
  assert.equal(selection.sourceType, api.SOURCE_OPTION);
  assert.match(selection.imageUrl, /GetAttachment\/ffs$/);
  assert.equal(selection.sourceIdentity, 'option:4141433:8138107');
});

test('2. öncelik: eşleşen Option yoksa isDefault Style Image seçilir', () => {
  const selection = api.selectColourImage({ colourCode: 'QQQ', optionImages: OPTION_IMAGES, styleImages: STYLE_IMAGES, styleListImageUrl: ATTACH('list') });
  assert.equal(selection.sourceType, api.SOURCE_STYLE_DEFAULT);
  assert.match(selection.imageUrl, /GetAttachment\/default$/);
  assert.equal(selection.sourceIdentity, 'styledefault:8890711');
});

test('3. öncelik: Option ve varsayılan yoksa GetStyleList.imageUrl seçilir', () => {
  const selection = api.selectColourImage({ colourCode: 'QQQ', optionImages: [], styleImages: [], styleListImageUrl: ATTACH('list') });
  assert.equal(selection.sourceType, api.SOURCE_STYLE_LIST);
  assert.match(selection.imageUrl, /GetAttachment\/list$/);
});

test('VARSAYILAN OLMAYAN Style Image / teknik çizim ASLA otomatik seçilmez', () => {
  const onlyTechnical = STYLE_IMAGES.filter(item => item.isDefault !== true);
  const selection = api.selectColourImage({ colourCode: 'QQQ', optionImages: [], styleImages: onlyTechnical, styleListImageUrl: '' });
  assert.equal(selection.sourceType, api.SOURCE_MISSING);
  assert.equal(selection.imageUrl, '');
  assert.equal(selection.nonDefaultStyleImages, 1);
  // "İlk Style Image"e düşen bir yol kalmamalı.
  assert.notEqual(selection.imageUrl, onlyTechnical[0].imageUrl);
});

test('hiçbir kaynak yoksa görsel eksik kalır (uydurma seçim yok)', () => {
  const selection = api.selectColourImage({ colourCode: 'GRD', optionImages: [], styleImages: [], styleListImageUrl: '' });
  assert.equal(selection.sourceType, api.SOURCE_MISSING);
  assert.equal(selection.imageUrl, '');
});

test('Renk Kodu eşleşmesi Türkçe büyük/küçük ve boşluk farkını yok sayar', () => {
  const selection = api.selectColourImage({ colourCode: ' ffs ', optionImages: OPTION_IMAGES, styleImages: STYLE_IMAGES });
  assert.equal(selection.sourceType, api.SOURCE_OPTION);
  assert.match(selection.imageUrl, /GetAttachment\/ffs$/);
});

test('aynı renkte birden fazla Option Image belirlenimci biçimde seçilir', () => {
  const duplicates = [
    { styleOptionId: '1', styleOptionImageId: '900', colorCode: 'AAA', imageUrl: ATTACH('b') },
    { styleOptionId: '1', styleOptionImageId: '100', colorCode: 'AAA', imageUrl: ATTACH('a') },
  ];
  const first = api.selectColourImage({ colourCode: 'AAA', optionImages: duplicates, styleImages: [] });
  const second = api.selectColourImage({ colourCode: 'AAA', optionImages: duplicates.slice().reverse(), styleImages: [] });
  assert.equal(first.imageUrl, second.imageUrl, 'sıra değişince seçim değişmemeli');
  assert.equal(first.sourceIdentity, 'option:1:100');
});

test('GetStyleImages yanıtı styleImages.StyleImages / styleOptionImages.OptionImages yollarından okunur', () => {
  const parsed = api.parseStyleImages({
    data: { styleImages: { StyleImages: STYLE_IMAGES }, styleOptionImages: { OptionImages: OPTION_IMAGES } },
  });
  assert.equal(parsed.styleImages.length, 2);
  assert.equal(parsed.optionImages.length, 2);
  assert.equal(parsed.styleImages.find(item => item.isDefault).attachmentAssociationId, '8890711');
  assert.equal(parsed.optionImages[0].styleOptionImageId, '8138107');
});

test('aynı styleId birden çok renk için TEK metadata çağrısına indirgenir', () => {
  const plan = api.uniqueStyleIdPlan([
    { plmId: '2123595', styleId: '2508501', colourCode: 'CVL' },
    { plmId: '2123595', styleId: '2508501', colourCode: 'DWP' },
    { plmId: '2123595', styleId: '2508501', colourCode: 'HEC' },
    { plmId: '2121459', styleId: '2508999', colourCode: 'AAA' },
  ]);
  assert.deepEqual(plan.styleIds, ['2508501', '2508999']);
  assert.equal(plan.byStyleId.get('2508501').requests.length, 3);
});

test('sınırlı eşzamanlılık varsayılanları paket sözleşmesiyle aynıdır', () => {
  assert.equal(api.STYLE_IMAGES_CONCURRENCY, 5);
  assert.equal(api.IMAGE_DOWNLOAD_CONCURRENCY, 8);
  assert.equal(api.boundedConcurrency(0, 5), 5);
  assert.equal(api.boundedConcurrency(99, 5), 16);
  assert.equal(api.boundedConcurrency(3, 5), 3);
});
