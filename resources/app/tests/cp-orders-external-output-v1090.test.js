'use strict';

/* v10.90 — CP / Orders DIŞ ÇIKTISI (pano + doğrudan XLSX)

   Üç doğrulanmış kusur:

   1) "Copy → Excel/e-posta": bir CP/Orders satırı Excel'e İKİ fiziksel satır
      olarak yapışıyordu (veri satırı + boş satır, dönüşümlü) ve komşu sütunlar
      bu iki satır boyunca dikey birleşiyordu. Sebep ekrandaki DOM'un serialize
      edilmesiydi: hücre metni normalize edilmiyor, yardımcı DOM düğümleri
      (pencereli çizim boşluk satırı, lojistik detay satırı) mantıksal veri
      sanılıyordu. Koleksiyon aynı kusuru v8.13'te kayıt kaynaklı yola geçerek
      çözmüştü; CP/Orders artık aynı sözleşmeyi kullanır.

   2) "Excel'e Aktar": hücre renkleri getComputedStyle ile ekrandan okunuyordu.
      Koyu/kurşun temada koyu dolgu + açık yazı doğrudan kitaba yazılıyor,
      beyaz sayfada okunamayan hücreler oluşuyordu. CP bunu geçici tema
      değişimiyle örtmeye çalışıyordu, Orders'ta örtü hiç yoktu.

   3) "Excel'e Aktar" model görselleri: görsel kaynağı ekrandaki <img>'in
      currentSrc'siydi. Lazy yükleme yüzünden viewport'a girmemiş satırlarda bu
      değer placeholder SVG'si olduğundan görseller ya hiç ya da eksik
      aktarılıyordu.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const BLTableExport = require(path.join(ROOT, 'public', 'table-export.js'));

function declOf(name) {
  const start = APP.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} bulunmalı`);
  const paramOpen = APP.indexOf('(', start);
  const paramClose = APP.indexOf(')', paramOpen);
  const params = APP.slice(paramOpen + 1, paramClose);
  const open = APP.indexOf('{', paramClose);
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return { params, body: APP.slice(open + 1, i) };
  }
  throw new Error(`${name} ayrıştırılamadı`);
}
function bodyOf(name) {
  return declOf(name).body;
}
function buildFn(name, deps, isAsync) {
  const { params, body } = declOf(name);
  const names = Object.keys(deps);
  const built = new Function(...names, `return ${isAsync ? 'async ' : ''}function ${name}(${params}){ ${body} };`);
  return built(...names.map(k => deps[k]));
}
const fnOf = (name, deps) => buildFn(name, deps, false);
const asyncFnOf = (name, deps) => buildFn(name, deps, true);

const escapeHtml = new Function('s', bodyOf('escapeHtml'));
const norm = v => String(v == null ? '' : v).trim();
const COPY_BORDER = 'thin solid #B4B8BD';

// ---------------------------------------------------------------- palet

const exportSemanticPalette = fnOf('exportSemanticPalette', {
  priorityTone: v => (norm(v) === 'P1' ? 'red' : ''),
  statusTone: v => (norm(v) === 'Tamam' ? 'green' : ''),
  norm,
  EXPORT_LIGHT_BODY_FG: '#101828',
});

const cellStyleFor = fnOf('cellStyleFor', {
  exportSemanticPalette,
  isTurkeyCountry: country => norm(country) === 'Türkiye',
});

test('v10.90 dışa aktarım paleti aydınlıktır: her anlamlı dolgunun üstünde koyu okunur yazı kalır', () => {
  const hit = exportSemanticPalette({ k: 'Priority', type: 'priority' }, { Priority: 'P1' }, null);
  assert.equal(hit.bg, '#FBEAEA');
  assert.equal(hit.color, '#B23B3A');
  assert.equal(hit.bold, true);

  const status = exportSemanticPalette({ k: 'STATUS', type: 'status' }, { STATUS: 'Tamam' }, null);
  assert.equal(status.bg, '#E3F2E9');
  assert.equal(status.color, '#1F7A4D');

  // Ex-factory yalnız dolgu tanımlar; yazı rengi belirtilmediğinde beyaz
  // üstüne beyaza yakın metin çıkmasın diye koyu gövde rengine düşer.
  const exf = exportSemanticPalette({ k: 'Ex-factory', type: 'exfactory' }, {}, { exfState: 'past' });
  assert.equal(exf.bg, '#F3D2D2');
  assert.equal(exf.color, '#101828');

  // Anlamlı rengi olmayan hücre hiç dolgu almaz (Excel'de beyaz sayfa).
  const plain = exportSemanticPalette({ k: 'Buyer', type: 'text' }, { Buyer: 'A' }, null);
  assert.equal(plain.bg, '');
  assert.equal(plain.color, '');

  // Palet fonksiyon yoluyla okunur: hiçbir dalda tema/CSS değişkeni yok.
  const source = bodyOf('exportSemanticPalette');
  assert.doesNotMatch(source, /getComputedStyle|var\(--|dataset\.theme/);
});

test('v10.90 cellStyleFor aynı paletten okur ve Excel sayı biçimini korur', () => {
  const style = cellStyleFor({ k: 'Priority', type: 'priority' }, { Priority: 'P1' }, null);
  assert.match(style, /background-color:#FBEAEA;/);
  assert.match(style, /color:#B23B3A;/);
  assert.match(style, /font-weight:bold;/);
  const money = cellStyleFor({ k: 'FOB ($)', type: 'money' }, { Country: 'Çin' }, null);
  assert.match(money, /text-align:right;/);
  assert.match(money, /mso-number-format:'\\\$#,##0\.00';/);
});

// --------------------------------------------------- kanonik görsel kimliği

function identityFactory(registry) {
  return fnOf('cpOrdersRowImageIdentity', {
    canonicalModelImageKnown: (plmId, code) => registry.has(`${plmId}|${code}`),
    canonicalModelImageSource: (plmId, code) => registry.get(`${plmId}|${code}`) || '',
    modelImageCacheKey: (plmId, code) => `${plmId}|${code}`.toUpperCase(),
  });
}

test('v10.90 model görseli KAYITTAN çözülür; ekrandaki <img> durumu kimliği değiştirmez', () => {
  const registry = new Map([['M1|001', '/api/collection-image/a.png']]);
  const identityOf = identityFactory(registry);

  const known = identityOf({ 'PLM ID': 'M1', 'C.Code': '001' });
  assert.equal(known.source, '/api/collection-image/a.png');
  assert.equal(known.key, 'M1|001|/api/collection-image/a.png');

  // Kayıt defterinde olmayan ama kendi yüklenmiş görseli olan satır.
  const own = identityOf({ 'PLM ID': 'M2', 'C.Code': '002', _imageRef: 'ref-2', _imageUrl: '/api/x/b.png' });
  assert.equal(own.source, '/api/x/b.png');

  // Görseli olmayan satır: sahte placeholder üretilmez.
  assert.equal(identityOf({ 'PLM ID': 'M3', 'C.Code': '003' }), null);

  // Kimlik viewport/lazy yükleme durumuna hiç bakmaz.
  const source = bodyOf('cpOrdersRowImageIdentity');
  assert.doesNotMatch(source, /currentSrc|getBoundingClientRect|dataset\.blImageLoaded|querySelector/);
});

// ------------------------------------------------------- pano: düz satırlar

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7mQAAAAASUVORK5CYII=';

const blMapWithConcurrency = asyncFnOf('blMapWithConcurrency', {});

// `images`: _id → data URL. Aynı data URL'i paylaşan satırlar aynı kanonik
// kimliği paylaşır (gerçek uygulamada aynı model/renk görselidir).
const kolFitImageDimensions = fnOf('kolFitImageDimensions', {});
const _copyImageFitBox = fnOf('_copyImageFitBox', { kolFitImageDimensions });
const cpOrdersImageCopyCell = fnOf('cpOrdersImageCopyCell', {
  escapeHtml,
  _COPY_BORDER: COPY_BORDER,
  _copyImageFitBox,
});

function imageRuntime(images, probe, natural) {
  const cpOrdersImageDataUrlFor = async identity => {
    if (probe) probe.resolved.push(identity.key);
    return identity.dataUrl;
  };
  return asyncFnOf('cpOrdersRecordImageCopyCells', {
    cpOrdersRowImageIdentity: row => {
      const dataUrl = images.get(row._id) || '';
      return dataUrl ? { key: `key:${dataUrl.slice(-12)}`, dataUrl } : null;
    },
    blMapWithConcurrency,
    _COPY_IMAGE_CONCURRENCY: 6,
    cpOrdersImageDataUrlFor,
    _copyImageNaturalSize: async () => {
      if (probe) probe.measured++;
      return natural || { width: 1200, height: 800 };
    },
    cpOrdersImageCopyCell,
  });
}

function copyBuilderFor(records, cols, images, probe) {
  return asyncFnOf('buildManagedTableStyledCopy', {
    BLTableExport,
    visibleCols: () => cols,
    tableColumnLabel: (tableKey, c) => c.label,
    cellPlainText: (c, r) => r[c.k],
    computeFlags: row => {
      if (probe) probe.flagCalls++;
      return { row: row._id };
    },
    cpOrdersImageDims: () => ({ w: 60, h: 60 }),
    cpOrdersRecordImageCopyCells: imageRuntime(images, probe),
    cellStyleFor,
    escapeHtml,
    ORDER_URL: code => `https://orders.example.test/${code}`,
    _COPY_BORDER: COPY_BORDER,
    EXPORT_LIGHT_HEADER_BG: '#F2F4F7',
    EXPORT_LIGHT_HEADER_FG: '#54595F',
  });
}

const COLS = [
  { k: '__picture', label: 'Picture', type: 'cpImage' },
  { k: 'Order Code', label: 'Order Code', type: 'ordercode' },
  { k: 'STATUS', label: 'STATUS', type: 'status' },
  { k: 'Not', label: 'Not', type: 'text' },
];

function records() {
  return [
    { _id: 1, __picture: 'Görsel mevcut', 'Order Code': '1001', STATUS: 'Tamam', Not: 'birinci satır\nikinci satır' },
    { _id: 2, __picture: 'Görsel yok', 'Order Code': '1002', STATUS: 'Açık', Not: 'tek\tsekme' },
    { _id: 3, __picture: 'Görsel mevcut', 'Order Code': '1003', STATUS: 'Tamam', Not: 'düz' },
  ];
}

function dataRowCount(html) {
  return (html.match(/<tr>/gi) || []).length - (/<th\b/i.test(html) ? 1 : 0);
}

test('v10.90 CP/Orders panosu: N mantıksal satır → tam olarak N Excel satırı', async () => {
  const rows = records();
  const images = new Map([[1, PNG], [3, PNG]]);
  const build = copyBuilderFor(rows, COLS, images);
  const built = await build('cp', rows, new Set());

  assert.equal(built.count, 3);
  assert.equal(dataRowCount(built.html), 3);

  // Görsel hücresi kendi satırının İÇİNDEDİR: ne ayrı bir <tr> ne rowspan.
  const flat = BLTableExport.assertFlat(built.html, 3);
  assert.deepEqual(flat.problems, []);
  assert.equal((built.html.match(/<img /g) || []).length, 2);

  // HTML ve TSV aynı matristen üretilir: satır sayıları eşittir.
  const tsvLines = built.plain.split('\r\n');
  assert.equal(tsvLines.length, 4); // 1 başlık + 3 veri
  assert.equal(dataRowCount(built.html), tsvLines.length - 1);

  // Sıra korunur.
  assert.match(tsvLines[1], /1001/);
  assert.match(tsvLines[2], /1002/);
  assert.match(tsvLines[3], /1003/);
});

test('v10.90 hücre içi satır sonu/sekme Excel satırını bölemez', async () => {
  const rows = records();
  const build = copyBuilderFor(rows, COLS, new Map());
  const built = await build('cp', rows, new Set());

  // Normalize edilmiş hücre: ham satır sonu ve sekme kalmaz.
  assert.match(built.html, /birinci satır ikinci satır/);
  assert.doesNotMatch(built.html, /birinci satır\nikinci satır/);
  const tsvLines = built.plain.split('\r\n');
  assert.equal(tsvLines.length, 4, 'çok satırlı not ek TSV satırı üretmemeli');
  assert.equal(tsvLines[2].split('\t').length, COLS.length, 'sekme ek sütun üretmemeli');

  // Her <td> Office'e "bu hücre bölünmez" der.
  const tdCount = (built.html.match(/<td /g) || []).length;
  const sameCell = (built.html.match(/mso-data-placement:same-cell/g) || []).length;
  assert.ok(sameCell >= tdCount, 'her hücrede mso-data-placement:same-cell olmalı');
});

test('v10.90 tek satır kopyası tek satır yapıştırır ve görseli aynı hücrede taşır', async () => {
  const rows = records();
  const build = copyBuilderFor(rows, COLS, new Map([[1, PNG]]));
  const built = await build('cp', rows, new Set([1]));

  assert.equal(built.count, 1);
  assert.equal(dataRowCount(built.html), 1);
  assert.equal(built.plain.split('\r\n').length, 2);
  const rowHtml = built.html.slice(built.html.lastIndexOf('<tr>'));
  assert.match(rowHtml, /<img src="data:image\/png;base64,/);
  assert.equal((rowHtml.match(/<tr>/g) || []).length, 1);
});

test('v10.90 görseli olmayan satır sahte placeholder almaz, diğer satırların görseli etkilenmez', async () => {
  const rows = records();
  const build = copyBuilderFor(rows, COLS, new Map([[1, PNG], [3, PNG]]));
  const built = await build('cp', rows, new Set());
  const bodyRows = built.html.split('<tr>').slice(2); // başlık + ilk parça atlanır

  assert.equal(dataRowCount(built.html), 3);
  assert.equal(bodyRows.length, 3);
  assert.ok(bodyRows[0].includes('<img '), '1. satır görselini almalı');
  assert.ok(!bodyRows[1].includes('<img '), 'görseli olmayan satıra görsel gömülmemeli');
  assert.match(bodyRows[1], /Görsel yok/);
  assert.ok(bodyRows[2].includes('<img '), '3. satır görselini almalı');
});

test('v10.90 pano biçimi kanonik aydınlık paletten gelir, ekranın temasından değil', async () => {
  const rows = records();
  const build = copyBuilderFor(rows, COLS, new Map());
  const built = await build('cp', rows, new Set());
  assert.match(built.html, /background-color:#F2F4F7;color:#54595F/); // başlık
  assert.match(built.html, /background-color:#E3F2E9;color:#1F7A4D;/); // STATUS=Tamam
  const source = bodyOf('buildManagedTableStyledCopy');
  assert.doesNotMatch(source, /getComputedStyle|querySelector|dataset\.theme/);
});

test('v10.91 çok satırlı kopyalama satır başına tek kez hesaplar ve görseli model başına bir kez çözer', async () => {
  // 200 kayıt, 4 sütun, yalnız 3 farklı model görseli.
  const urls = [PNG, PNG.replace(/.$/, 'A='), PNG.replace(/.$/, 'B=')];
  const rows = Array.from({ length: 200 }, (_, i) => ({
    _id: i + 1, __picture: 'Görsel mevcut', 'Order Code': String(2000 + i), STATUS: 'Tamam', Not: `not ${i}`,
  }));
  const images = new Map(rows.map((row, i) => [row._id, urls[i % urls.length]]));
  const probe = { flagCalls: 0, resolved: [], measured: 0 };
  const build = copyBuilderFor(rows, COLS, images, probe);
  const built = await build('cp', rows, new Set());

  assert.equal(built.count, 200);
  assert.equal(dataRowCount(built.html), 200);

  // computeFlags SATIR başına bir kez — hücre başına değil. Eski hâlinde bu
  // sayı satır × sütun × 2 idi (200 × 4 × 2 = 1600) ve gerçek CP'de ~60 sütunla
  // kopyalama görünürde donuyordu.
  assert.equal(probe.flagCalls, 200);

  // Aynı model görseli yeniden çözülmez: 200 satır, 3 benzersiz görsel.
  assert.equal(probe.resolved.length, 3);
  assert.equal(new Set(probe.resolved).size, 3);

  // Paylaşılan görseli olan HER satır yine kendi <img>'ini taşır.
  assert.equal((built.html.match(/<img /g) || []).length, 200);
});

test('v10.91 sınırlı eşzamanlılık: aynı anda çalışan görsel çözümü sınırı aşmaz', async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  let active = 0, peak = 0;
  const out = await blMapWithConcurrency(items, 6, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return value * 2;
  });
  assert.ok(peak <= 6, `eşzamanlılık sınırı aşıldı: ${peak}`);
  assert.deepEqual(out.slice(0, 4), [0, 2, 4, 6], 'sonuç girdi sırasını korumalı');

  // Tek bir görselin hatası diğerlerini düşürmez.
  const mixed = await blMapWithConcurrency([1, 2, 3], 2, async value => {
    if (value === 2) throw new Error('boom');
    return value;
  });
  assert.deepEqual(mixed, [1, null, 3]);
});

test('v10.92 görsel hücresi TEK satır içi <img> taşır — blok kutu, yüzde ölçü ve sarmalayıcı yok', () => {
  const cell = cpOrdersImageCopyCell(PNG, { w: 60, h: 60 }, { width: 1200, height: 800 });

  // Doğrulanan kusur: görseli OLAN satır Excel'e iki birleşik satır olarak
  // yapışıyordu. Hücrede birden çok blok kutusu kalırsa Excel içeriği iki satır
  // kutusuna çözüp komşu sütunları dikey birleştirebiliyor.
  assert.doesNotMatch(cell.html, /<div/i, 'sarmalayıcı blok düğüm olmamalı');
  assert.doesNotMatch(cell.html, /display:\s*block/i);
  assert.doesNotMatch(cell.html, /%/, 'yüzdeye bağlı ölçü olmamalı');
  assert.doesNotMatch(cell.html, /object-fit/i);
  // Hücrenin TEK çocuğu <img>; yanında metin düğümü de yok.
  assert.equal((cell.html.match(/</g) || []).length, 1, 'hücrede tek bir düğüm olmalı');
  assert.match(cell.html, /^<img [^>]*>$/);
  // Fazladan bir metin satır kutusu oluşmasın diye line-height görsele sabit.
  assert.match(cell.style, /line-height:43px;/);

  // Ölçü kaynak oranından gelir: 1200×800 (3:2) kutuya sığdırılır, ezilmez.
  const width = Number(cell.html.match(/width="(\d+)"/)[1]);
  const height = Number(cell.html.match(/height="(\d+)"/)[1]);
  assert.ok(Number.isInteger(width) && Number.isInteger(height));
  assert.equal(width, 64);
  assert.equal(height, 43);
  assert.ok(Math.abs(width / height - 1.5) < 0.05, 'en/boy oranı korunmalı');
  assert.match(cell.html, /style="width:64px;height:43px;border:0;"/);
});

test('v10.92 kare olmayan görsel hücre kutusuna zorlanmaz', async () => {
  const rows = records();
  const probe = { flagCalls: 0, resolved: [], measured: 0 };
  const build = copyBuilderFor(rows, COLS, new Map([[1, PNG]]), probe);
  const built = await build('cp', rows, new Set([1]));
  const img = built.html.match(/<img [^>]*>/)[0];
  const width = Number(img.match(/width="(\d+)"/)[1]);
  const height = Number(img.match(/height="(\d+)"/)[1]);
  assert.notEqual(width, height, '1200×800 kaynak kare hücreye eziltilmemeli');
  assert.ok(Math.abs(width / height - 1.5) < 0.05);
  assert.equal(probe.measured, 1, 'kaynak oranı model başına bir kez ölçülmeli');
});

// ------------------------------------------------------- kaynak sözleşmeleri

test('v10.90 CP/Orders "Copy" düğmesi ekran DOM’unu değil kayıt yolunu kullanır', () => {
  const at = APP.indexOf("document.getElementById('navCopy').addEventListener('click'");
  assert.ok(at >= 0, 'navCopy click dinleyicisi bulunmalı');
  const handler = APP.slice(at, at + 2200);
  assert.match(handler, /info\.tableKey==='cp'\|\|info\.tableKey==='orders'/);
  assert.match(handler, /copyManagedTableLikeExcel\(info\.tableKey,\s*info\.rowsFn\(\),\s*info\.selSet\(\),\s*'navCopy'\)/);
  // DOM serialize yolu yalnız kalan tablolar (Koleksiyon/Nakliye) için kalır.
  const cpBranch = handler.indexOf('copyManagedTableLikeExcel');
  const domBranch = handler.indexOf('copyStyledTableLikeExcel');
  assert.ok(cpBranch >= 0 && domBranch > cpBranch, 'kayıt yolu DOM yolundan önce gelmeli');
});

test('v10.90 doğrudan XLSX dışa aktarımı tema renklerini serialize etmez', () => {
  const block = APP.slice(
    APP.indexOf('async function exportStyledDomTable'),
    APP.indexOf('async function exportCpTableWithLightTheme')
  );
  // Başlık paleti sabittir.
  assert.match(block, /_xlsArgbFromHex\(EXPORT_LIGHT_HEADER_BG\)/);
  assert.match(block, /_xlsArgbFromHex\(EXPORT_LIGHT_HEADER_FG\)/);
  // Gövde hücresi kayıt varsa paletten stillenir.
  assert.match(block, /const palette=record\?exportSemanticPalette\(column,record,cf\):null;/);
  assert.match(block, /_xlsCellFromTd\(td,\{forceIdentifierText:[^)]*palette\}\)/);

  const cellFn = bodyOf('_xlsCellFromTd');
  assert.match(cellFn, /const palette = options\.palette \|\| null;/);
  assert.match(cellFn, /palette\s*\?\s*_xlsArgbFromHex\(palette\.bg\)/);

  // CP artık Excel'i aydınlık üretmek için temayı değiştirip tabloyu iki kez
  // yeniden çizmiyor; Orders ile aynı yolu kullanıyor.
  const cpExport = bodyOf('exportCpTableWithLightTheme');
  assert.doesNotMatch(cpExport, /dataset\.theme=|renderCP\(\)|beginThemeSwapCurtain/);
  assert.match(cpExport, /exportActiveTableStyled\(\)/);
  const active = bodyOf('exportActiveTableStyled');
  assert.match(active, /tableKey:'cp'/);
  assert.match(active, /tableKey:'orders'/);
  assert.match(active, /records:cfg\.rowsFn\?cfg\.rowsFn\(\):null/);
});

test('v10.90 XLSX model görselleri viewport/lazy DOM durumuna bağlı değildir', () => {
  const block = APP.slice(
    APP.indexOf('async function exportStyledDomTable'),
    APP.indexOf('async function exportCpTableWithLightTheme')
  );
  // Görsel kimliği kayıttan çözülür ve entry'ye kimlik olarak yazılır.
  assert.match(block, /cpOrdersRowImageIdentity\(record\)/);
  assert.match(block, /imageEntries\.push\(\{row:excelRow,col:col-1,identity,/);
  // Eski hata: ekrandaki <img>'in currentSrc'si (lazy satırda placeholder SVG).
  assert.doesNotMatch(block, /src:image\.currentSrc\|\|image\.src/);

  const prep = bodyOf('_prepareExcelJsImages');
  assert.match(prep, /_copyImageDataUrlFor\(\{modelId:identity\.modelId/);
  assert.match(prep, /data:image\\\/svg\\\+xml/, 'placeholder SVG başarılı görsel sayılmamalı');
  assert.match(prep, /blMapWithConcurrency\(unique,_COPY_IMAGE_CONCURRENCY/,
    'görseller sınırlı eşzamanlılıkla hazırlanmalı');
  assert.match(prep, /seen\.has\(key\)/, 'aynı model görseli bir kez hazırlanmalı');
  assert.match(prep, /list\.map\(entry=>byKey\.get\(keyOf\(entry\)\)\|\|null\)/,
    'sonuç entries ile aynı sırada olmalı');

  // Kitap, görseller çözülmeden SERİLEŞTİRİLMEZ.
  const prepareAt = block.indexOf('await _prepareExcelJsImages(imageEntries)');
  const writeAt = block.indexOf('await wb.xlsx.writeBuffer()');
  assert.ok(prepareAt >= 0 && writeAt > prepareAt, 'görseller writeBuffer öncesinde hazırlanmalı');

  // Sonuç tek bir özet olarak bildirilir (görsel başına bildirim yok).
  assert.match(block, /imagesEmbedded\}\/\$\{imagesRequested\} model görseli eklendi/);
});
