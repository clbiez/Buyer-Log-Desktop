'use strict';

/* Koleksiyon'da Ctrl+C ve Ctrl+V ölü kalmıştı.
 *
 * ÖLÇÜLEN NEDEN (canlı uygulamada doğrulandı): collection-spreadsheet.js
 * içindeki modalOpen() bir pencerenin AÇIK olup olmadığını değil, DOM'da
 * VAR olup olmadığını soruyordu:
 *
 *     Boolean(document.querySelector('[role="dialog"][aria-modal="true"], ...'))
 *
 * index.html bu seçiciye uyan üç pencereyi statik olarak taşıyor
 * (lflScenarioEditorDialog, ocCompareCard, ocFxCard). Üçü de 'hidden' bir
 * sarmalayıcının İÇİNDE duruyor, ama 'hidden' sarmalayıcıda, eşleşen öğede
 * değil; querySelector da CSS'i ve ata 'hidden'ını umursamaz. Dolayısıyla
 * modalOpen() kalıcı olarak true dönüyordu ve bu kapıdan geçen her şey
 * Koleksiyon'da çalışmıyordu: handleCopyShortcut (Ctrl+C), paste dinleyicisi
 * (Ctrl+V), ok tuşlarıyla gezinme ve yazarak düzenleme. İşaretçiyle çoklu
 * seçim modalOpen()'a bakmadığı için çalışmaya devam ediyordu — kullanıcının
 * "hücreleri çoklu seçebiliyorum ama kopyalayamıyorum" tarifi tam olarak bu.
 *
 * Bu test metin eşleştirmesi yapmaz; gerçek kaynaktan çıkardığı predicate'i
 * ÇALIŞTIRIR. Böylece açıklama yorumlarına takılmaz (bkz. CLAUDE.md §2).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* Kaynaktan iki fonksiyonun gövdesini satır olarak al ve izole çalıştır. */
function extractPredicate() {
  const lines = SRC.split(/\r?\n/);
  const visible = lines.find(l => l.includes('function modalVisible('));
  const open = lines.find(l => l.includes('function modalOpen('));
  assert.ok(visible, 'modalVisible() bulunamadı — görünürlük süzgeci kaldırılmış olabilir');
  assert.ok(open, 'modalOpen() bulunamadı');

  const factory = new Function('document', 'getComputedStyle', `
    ${visible}
    ${open}
    return modalOpen;
  `);
  return (elements) => {
    const doc = { querySelectorAll: () => elements };
    const gcs = (el) => ({ visibility: el.visibility || 'visible' });
    return factory(doc, gcs)();
  };
}

/* rects: getClientRects() uzunluğu. Ata display:none ise 0'dır — öğenin
   KENDİ computed display'i hâlâ 'flex'/'grid' göründüğü için asıl ayrım
   burada. position:fixed pencerelerde offsetParent null olduğundan
   offsetParent kullanılamaz; bu yüzden getClientRects. */
const el = (rects, visibility) => ({
  getClientRects: () => new Array(rects).fill({}),
  visibility: visibility || 'visible',
});

test('modalOpen(): gizli sarmalayıcı içindeki statik pencere AÇIK sayılmaz', () => {
  const modalOpen = extractPredicate();
  // index.html'in taşıdığı üç statik pencere: hepsi hidden sarmalayıcı içinde.
  assert.equal(modalOpen([el(0), el(0), el(0)]), false,
    'Görünmeyen statik pencereler modalOpen() true yapıyor — Ctrl+C/Ctrl+V yine ölür');
});

test('modalOpen(): gerçekten açık pencere AÇIK sayılır', () => {
  const modalOpen = extractPredicate();
  assert.equal(modalOpen([el(0), el(1), el(0)]), true,
    'Açık bir pencere kaçırılıyor — yapıştırma önizlemesi üzerine yazılabilir');
  assert.equal(modalOpen([el(1)]), true);
});

test('modalOpen(): visibility:hidden açık sayılmaz', () => {
  const modalOpen = extractPredicate();
  assert.equal(modalOpen([el(1, 'hidden')]), false);
});

test('modalOpen() varlık kontrolüne geri dönmemeli', () => {
  /* Kendi açıklama yorumlarım "querySelector" kelimesini içeriyor; bu yüzden
     karşılaştırmadan ÖNCE yorumlar ayıklanır (CLAUDE.md §2'de kayıtlı tuzak). */
  const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
  const line = code.split(/\r?\n/).find(l => l.includes('function modalOpen('));
  assert.ok(line, 'modalOpen() bulunamadı');
  assert.ok(!/Boolean\(\s*document\.querySelector\(/.test(line),
    'modalOpen() yine varlığa bakıyor; görünürlük süzgeci şart');
});

test('tehlike gerçek: index.html statik [role=dialog][aria-modal=true] taşıyor', () => {
  /* Bu iddia düzeltmeyi değil, düzeltmenin NEDENİNİ kilitler. Sayı düşerse
     tehlike kalkmış demektir; artarsa görünürlük süzgeci daha da kritiktir. */
  const count = (INDEX.match(/aria-modal="true"/g) || []).length;
  assert.ok(count >= 1,
    'Statik modal markup kalmamış — modalOpen() notu güncellenmeli');
});

/* ------------------------------------------------------------------ *
 * Uygulama içi yapıştırmada sütun başlıkları
 *
 * Kopyalama başlık satırını BİLEREK panoya yazıyor (Excel'e yapıştırırken
 * isteniyor, v6.61'den beri öyle). Ama aynı içerik uygulama İÇİNDE başka
 * hücrelere yapıştırıldığında başlıklar veri olarak hücrelere giriyordu:
 * E2:G4 kopyalanıp başka bir aralığa yapıştırıldığında ilk satıra
 * "Fabric", "Fit" gibi sütun adları yazılıyordu.
 *
 * Çözüm kopyalamayı değil YAPIŞTIRMAYI düzeltir: gelen matrisin ilk satırı
 * başlık satırıysa ayıklanır. Tanıma iki kademeli, çünkü tek kademe yetmiyor:
 * hafıza aynı oturumda kesin kanıttır ama sayfa yenilenince kaybolur;
 * yapısal tanıma ise yenilemeden sonra da çalışır.
 * ------------------------------------------------------------------ */

function loadStripper() {
  const start = SRC.indexOf('function stripCopiedHeaderRow(');
  assert.ok(start > -1, 'stripCopiedHeaderRow() bulunamadı');
  const end = SRC.indexOf('\n  }', start);
  assert.ok(end > -1, 'stripCopiedHeaderRow() gövdesi kapanmıyor');
  const body = SRC.slice(start, end + 4);
  return (labels, lastCopyHeaderLine) => {
    const factory = new Function('state', 'knownHeaderLabels', `${body} return stripCopiedHeaderRow;`);
    const set = new Set(labels.map(l => l.toLowerCase()));
    return factory({ lastCopyHeaderLine }, () => set);
  };
}

const LABELS = ['Fabric', 'Fit', 'Quantity'];
const DATA = [['KUMAS-1', 'SLIM FIT'], ['KUMAS-2', 'WIDE FIT']];

test('yapıştırma: aynı oturumda kopyalanan başlık satırı ayıklanır', () => {
  const strip = loadStripper()(LABELS, 'Fabric\tFit');
  const matrix = [['Fabric', 'Fit'], ...DATA];
  assert.deepEqual(strip(matrix, 'Fabric\tFit\r\nKUMAS-1\tSLIM FIT\r\nKUMAS-2\tWIDE FIT'), DATA);
});

test('yapıştırma: sayfa yenilendikten sonra da başlık satırı tanınır', () => {
  /* state.lastCopyHeaderLine boş — yalnız yapısal tanıma kalıyor. */
  const strip = loadStripper()(LABELS, '');
  const matrix = [['Fabric', 'Fit'], ...DATA];
  assert.deepEqual(strip(matrix, 'Fabric\tFit\r\nKUMAS-1\tSLIM FIT'), DATA,
    'Hafıza yokken başlık satırı hücrelere yazılıyor');
});

test('yapıştırma: başlık OLMAYAN veri ayıklanmaz', () => {
  /* Yanlış pozitif en pahalı hata olurdu: kullanıcının ilk veri satırı sessizce düşerdi. */
  const strip = loadStripper()(LABELS, '');
  assert.deepEqual(strip(DATA, 'KUMAS-1\tSLIM FIT\r\nKUMAS-2\tWIDE FIT'), DATA);
});

test('yapıştırma: tek satırlık veriye dokunulmaz', () => {
  const strip = loadStripper()(LABELS, 'Fabric\tFit');
  const one = [['Fabric', 'Fit']];
  assert.deepEqual(strip(one, 'Fabric\tFit'), one,
    'Tek satır ayıklanırsa yapıştıracak hiçbir şey kalmaz');
});

test('yapıştırma: başlık eşleşmesi harf büyüklüğüne takılmaz', () => {
  const strip = loadStripper()(LABELS, '');
  const matrix = [['fabric', 'FIT'], ...DATA];
  assert.deepEqual(strip(matrix, 'fabric\tFIT\r\nKUMAS-1\tSLIM FIT'), DATA);
});

test('yapıştırma: satırın YALNIZ bir hücresi başlıksa ayıklanmaz', () => {
  const strip = loadStripper()(LABELS, '');
  const matrix = [['Fabric', 'KUMAS-9'], ...DATA];
  assert.deepEqual(strip(matrix, 'Fabric\tKUMAS-9'), matrix,
    'Kısmi eşleşme başlık sayılırsa gerçek veri satırı kaybolur');
});
