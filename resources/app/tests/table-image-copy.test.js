'use strict';
// "Görsel olarak kopyala" (CP / Orders / Koleksiyon): saf sınır/piksel planı,
// seçim anlık görüntüsü ve DOM'a bağlı yolların kaynak sözleşmesi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
const ImageCopy = require('../public/table-image-copy.js');
const GridClipboard = require('../public/grid-clipboard.js');

test('satır planı: pano 50 satırı taşır, fazlası PNG dosyasına yönlenir, dosya da sınırlıdır', () => {
  assert.deepEqual(ImageCopy.rowPlan(0), { ok: false, reason: 'empty', count: 0 });
  assert.equal(ImageCopy.rowPlan(1).ok, true);
  assert.equal(ImageCopy.rowPlan(ImageCopy.CLIPBOARD_MAX_ROWS).ok, true);
  const over = ImageCopy.rowPlan(ImageCopy.CLIPBOARD_MAX_ROWS + 1);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'needsFile');
  assert.equal(ImageCopy.rowPlan(ImageCopy.CLIPBOARD_MAX_ROWS + 1, 'file').ok, true);
  assert.equal(ImageCopy.rowPlan(ImageCopy.FILE_MAX_ROWS + 1, 'file').reason, 'tooManyRows');
});

test('piksel planı: küçük tablo 2x, geniş tablo tuval sınırına göre küçülür, okunamayacaksa reddedilir', () => {
  const small = ImageCopy.rasterPlan(1200, 300);
  assert.equal(small.ok, true);
  assert.equal(small.pixelRatio, 2);
  assert.equal(small.pixelWidth, 2400);

  // 8.150 px genişlik (CP'nin tüm sütunları) tuvalin 16.384 kenarına sığar.
  const wide = ImageCopy.rasterPlan(8150, 450);
  assert.equal(wide.ok, true);
  assert.ok(wide.pixelWidth <= 16384, JSON.stringify(wide));

  // Panoda alan tavanı aşılırsa 1x altına inilmez: dosyaya yönlendirilir.
  const tall = ImageCopy.rasterPlan(8000, 6000);
  assert.equal(tall.ok, false);
  assert.equal(tall.reason, 'needsFile');
  const tallFile = ImageCopy.rasterPlan(8000, 6000, 'file');
  assert.equal(tallFile.ok, true);
  assert.ok(tallFile.pixelRatio >= 0.75 && tallFile.pixelWidth * tallFile.pixelHeight <= 64e6, JSON.stringify(tallFile));

  // Dosyada bile okunamayacak kadar küçülecekse reddedilir; sessizce bulanıklaşmaz.
  assert.equal(ImageCopy.rasterPlan(16000, 16000, 'file').reason, 'tooLarge');
});

test('dosya adı modül ve tarihten üretilir, PNG uzantılıdır', () => {
  const date = new Date(2026, 10, 26, 9, 5);
  assert.equal(ImageCopy.fileName('cp', date), 'BuyerLog-CP-20261126-0905.png');
  assert.equal(ImageCopy.fileName('orders', date), 'BuyerLog-Orders-20261126-0905.png');
  assert.equal(ImageCopy.fileName('koleksiyon', date), 'BuyerLog-Collection-20261126-0905.png');
});

test('seçim anlık görüntüsü pencereli sağlayıcıyı önce doldurur ve kopyalamayla aynı aralığı döndürür', async () => {
  const rows = [{ _id: 1, _rmPending: true }, { _id: 2, _rmPending: true }, { _id: 3 }, { _id: 4 }];
  const columns = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
  let prepared = null;
  const state = GridClipboard.register('imageCopyTest', {
    rows: () => rows,
    columns: () => columns,
    prepareRange: async range => { prepared = range; rows[1] = { _id: 2, loaded: true }; return true; },
  });
  state.selectionAnchor = { rowId: 2, columnId: 'c' };
  state.selectionFocus = { rowId: 3, columnId: 'b' };
  const snapshot = await GridClipboard.selectionSnapshot('imageCopyTest');
  assert.deepEqual(prepared, { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 });
  assert.deepEqual(snapshot.range, { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 });
  assert.deepEqual(snapshot.rows, [{ _id: 2, loaded: true }, { _id: 3 }]);
  assert.deepEqual(snapshot.columns.map(c => c.k), ['b', 'c']);

  state.selectionAnchor = state.selectionFocus = null;
  assert.equal(await GridClipboard.selectionSnapshot('imageCopyTest'), null);
  assert.equal(await GridClipboard.selectionSnapshot('missingTable'), null);
});

test('anlık görüntü: hücreler gizlenir (silinmez), seçim/kaydırma durumu taşınmaz, kurallar id özgüllüğünü aşar', () => {
  const source = read('table-image-copy.js');
  // :first-child / :nth-child eşleşmesi korunur.
  assert.match(source, /function hideCell\(cell\)\{cell\.setAttribute\(HIDDEN_ATTR,''\);\}/);
  assert.doesNotMatch(source, /firstElementChild\.remove\(\)/);
  assert.match(source, /\[data-bl-image-copy-hidden\]\{display:none!important;\}/);
  // #kolTable … th{top:22px!important} gibi id seçicili kuralları ezer.
  assert.match(source, /:not\(#blImageCopyA\):not\(#blImageCopyB\):not\(#blImageCopyC\)/);
  assert.match(source, /position:relative!important;left:auto!important;right:auto!important;top:auto!important/);
  // Satır seçim tonu ve kaydırmayı izleyen grup etiketi konumu taşınmaz.
  assert.match(source, /input\.removeAttribute\('checked'\);input\.checked=false;/);
  assert.match(source, /\.blGroupFollowLabel'\)\.forEach\(node=>node\.removeAttribute\('style'\)\)/);
  // Görsel her zaman aydınlık temadır; kullanıcının teması değiştirilmez.
  assert.match(source, /skip:\['data-theme'\],extra:\{'data-theme':'light'\}/);
  assert.doesNotMatch(source, /documentElement\.dataset\.theme\s*=/);
});

test('rasterleştirme satır içi stil kopyalamaz; yalnız aynı kökenden kaynak okur', () => {
  const source = read('table-image-copy.js');
  assert.match(source, /data:image\/svg\+xml;charset=utf-8,/);
  assert.match(source, /<foreignObject/);
  assert.match(source, /<style>\$\{cdata\(css\)\}<\/style>/);
  assert.doesNotMatch(source, /getComputedStyle\([^)]*\)\.cssText|html-to-image|htmlToImage/);
  assert.match(source, /fetch\(url,\{credentials:'same-origin'/);
  // Yalnız XML ad alanı URI'leri; ağ adresi yok.
  assert.doesNotMatch(source.replace(/http:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml)/g, ''), /https?:\/\//);
});

test('pano yazımı tıklama anında blob sözüyle başlar; reddedilirse aynı görsel PNG olarak kaydedilebilir', () => {
  const app = read('app-main.js');
  const start = app.indexOf('async function copyActiveTableAsImage(');
  const body = app.slice(start, app.indexOf('window.BLTableImageCopyAction=', start));
  assert.ok(start > 0 && body.length > 0);
  assert.match(body, /Promise\.allSettled\(\[Copy\.writeClipboard\(blobPromise\),job\]\)/);
  assert.match(body, /blobPromise\.catch\(\(\)=>\{\}\)/);
  assert.match(body, /if\(plan\.reason==='needsFile'\)offerTableImageFile\(pending\.count\)/);
  assert.match(body, /Copy\.saveFile\(blob,Copy\.fileName\(tab\)\)/);
  assert.match(body, /finally\{_tableImageCopyBusy=false;closeProgress\?\.\(\);\}/);
});

test('satırlar tablonun kendi üreticisiyle üretilir: sayfa/pencere dışındaki seçili satırlar da girer', () => {
  const app = read('app-main.js');
  assert.match(app, /table\._blBuildRow=buildRow;\n  const canVirtualize/);
  assert.match(app, /const buildKolRow=\(r,ri\)=>\{/);
  assert.match(app, /visibleRows\.forEach\(\(r,ri\)=>frag\.appendChild\(buildKolRow\(r,ri\)\)\);\n  table\._blBuildRow=buildKolRow;table\._blKolVisibleRows=visibleRows;/);
  // İşaretli CP satırları tam veri kümesinden; geçici "Hesaplanıyor…" görsele taşınmaz.
  assert.match(app, /managedSelectionSourceRows\(tab,row=>selectionHasId\(selected,row\._id\)\)/);
  assert.match(app, /if\(tab==='cp'\)for\(let i=0;i<200&&cpComputed\.pendingView;i\+\+\)/);
  // Koleksiyon aralığı satır kimliği + sütun anahtarıyla çözülür (sheetR/sheetC ≠ data-r/data-c).
  assert.match(app, /sheet\.multiCells\.has\(`\$\{rowId\}\\u0000\$\{key\}`\)/);
});

test('giriş noktaları: araç çubuğu menüsü ve iki sağ tık menüsü TR/EN', () => {
  const app = read('app-main.js');
  assert.match(app, /if\(tableImageCopySupported\(\)\)items\.push\(\{label:appLang==='en'\?'Copy as image':'Görsel olarak kopyala'/);
  const rowMenu = read('row-context-menu.js');
  assert.match(rowMenu, /T\('Seçili hücreleri görsel olarak kopyala', 'Copy selected cells as image'\)/);
  assert.match(rowMenu, /imageCopy\.copy\(\{ source: 'checked' \}\)/);
  const sheet = read('collection-spreadsheet.js');
  assert.match(sheet, /'Copy selected cells as image':'Seçili hücreleri görsel olarak kopyala'/);
  assert.match(sheet, /BLTableImageCopyAction\.copy\(\{source:'checked'\}\)/);
  assert.match(read('index.html'), /<script src="table-image-copy\.js\?v=__BL_ASSET_VERSION__"><\/script>/);
  // Koleksiyon'da da kopyalama seçenekleri Kopyala düğmesinin hemen yanında.
  assert.match(app, /const kolCopy=document\.getElementById\('kolCopySelectedBtn'\),copyMenu=sharedTableActionNode\('navCopyMenuBtn'\)\|\|document\.getElementById\('navCopyMenuBtn'\);\n    if\(kolCopy&&copyMenu\)kolCopy\.after\(copyMenu\);/);
});

test('PNG en fazla 6 MiB (10 MB posta mesajı, base64 ~×1,37): aşılırsa çözünürlük karekök oranında düşer, okunabilirlik tabanının altına inmez', () => {
  const MAX = ImageCopy.MAX_PNG_BYTES;
  assert.equal(MAX, 6 * 1024 * 1024);
  // Base64 + MIME satır sonları (76 karakter + CRLF) ile mesajdaki boyut 10 MB'ın ~1 MB altında kalır.
  assert.ok(Math.ceil(MAX / 3) * 4 * (78 / 76) < 9e6);
  // Sığıyorsa oran aynı kalır.
  assert.equal(ImageCopy.nextPixelRatio(2, MAX, 1), 2);
  assert.equal(ImageCopy.nextPixelRatio(2, 1000, 1), 2);
  // 2x'te 12 MiB (sınırın 2 katı) → alan ≈ (8/12) × 0.9 hedeflenir; yeni oran < 2 ve ≥ taban.
  const next = ImageCopy.nextPixelRatio(2, 12 * 1024 * 1024, 1);
  assert.ok(next < 2 && next >= 1, String(next));
  assert.ok((next / 2) ** 2 * 12 < 6, 'tahmini boyut 6 MiB altında olmalı: ' + next);
  // Pano tabanı 1x: 1x'te bile 9 MiB ise pano olmaz (null → dosya önerisi).
  assert.equal(ImageCopy.nextPixelRatio(1, 9 * 1024 * 1024, 1), null);
  // Dosya tabanı 0.75x: 1x'te 7 MiB → ~0.88x denenir.
  const fileNext = ImageCopy.nextPixelRatio(1, 7 * 1024 * 1024, 0.75);
  assert.ok(fileNext >= 0.75 && fileNext < 1, String(fileNext));
  // Özel sınır (test/ileride ayar) desteklenir.
  assert.equal(ImageCopy.nextPixelRatio(2, 300, 1, 1000), 2);
});

test('PNG bayt sınırı render döngüsünde uygulanır; aşan görsel panoya yazılmaz, boyut kullanıcıya gösterilir', () => {
  const source = read('table-image-copy.js');
  assert.match(source, /if\(blob\.size<=maxBytes\)break;/);
  assert.match(source, /return \{error:mode==='file'\?'tooHeavy':'needsFile',reason:'bytes',bytes:blob\.size\};/);
  assert.match(source, /async function render\(\{table,rows,keepLeaf=null,mode='clipboard',maxBytes=MAX_PNG_BYTES\}\)/);
  const app = read('app-main.js');
  assert.match(app, /if\(code==='needsFile'\)\{offerTableImageFile\(pending\.count,error\.reason\);return false;\}/);
  assert.match(app, /if\(code==='tooHeavy'\)\{const limit=tableImageCopySizeText\(Copy\.MAX_PNG_BYTES,0\);/);
  assert.match(app, /satır görsel olarak kopyalandı \(\$\{tableImageCopySizeText\(render\.value\.bytes\)\}\)/);
});

test('alttaki seçim çubuğu CP/Orders/Koleksiyon’da işaretli satırları görsel olarak kopyalar (TR/EN)', () => {
  const bar = read('selection-action-bar.js');
  for (const key of ['cp', 'orders', 'koleksiyon']) {
    assert.match(bar, new RegExp(`${key}:\\{unit:\\[[^\\]]+\\],actions:\\[\\['copy','[^']+'\\],\\['image',''\\],`));
  }
  assert.match(bar, /image:\{icon:'#i-picture',label:\['Görsel olarak kopyala','Copy as image'\]\}/);
  // Yalnız destekli sayfada çizilir; işaretli satırları hedefler.
  assert.match(bar, /if\(!root\.BLTableImageCopyAction\?\.supported\?\.\(key\)\)return '';/);
  assert.match(bar, /if\(button\.dataset\.selectionImage!==undefined\)\{void root\.BLTableImageCopyAction\?\.copy\?\.\(\{source:'checked'\}\);/);
  assert.match(read('app-main.js'), /function tableImageCopySupported\(tab=currentActiveTab\(\)\)/);
});
