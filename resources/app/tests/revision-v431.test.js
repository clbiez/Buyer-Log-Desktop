const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const QUOT = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('CP kopyalama yalnız yaprak sütun başlıklarını kullanır', () => {
  assert.match(INDEX, /leafHeadersOnly:info\.tableKey==='cp'/);
  assert.match(INDEX, /options\.leafHeadersOnly \? allHeadRows\.slice\(-1\) : allHeadRows/);
});

test('Supp. FOB panoda ve standart Excel aktarımında dolar biçimindedir', () => {
  assert.match(INDEX, /fieldKey==='Supp\. FOB'/);
  assert.match(INDEX, /plainText='\$'\+n\.toFixed\(2\)/);
  assert.match(INDEX, /forceDollarCurrency/);
  assert.match(INDEX, /const fieldKey=td\.dataset\.key\|\|leafHeaders\[col-1\]/);
  assert.match(INDEX, /numFmt: money \? '\"\$\"#,##0\.00'/);
});

test('fiyat geçmişinde iki görünüm ve görünüm duyarlı Excel aktarımı vardır', () => {
  assert.match(QUOT, /data-qhview="matrix"/);
  assert.match(QUOT, /data-qhview="ranked"/);
  assert.match(QUOT, /qhExportExcel\(shown,manufacturers,viewMode\)/);
  assert.match(QUOT, /Array\.from\(\{length:maxRank\},\(_,i\)=>`\$\{i\+1\}\.\`\)/);
});

test('model teklifleri fiyat artan, eşitlikte üretici adına göre sıralanır', () => {
  const m = QUOT.match(/function qhOrderedOffers\(model,mfrs\)\{([\s\S]*?)\n  \}\n\n  async function qhExportExcel/);
  assert.ok(m, 'qhOrderedOffers bulunmalı');
  const fn = new Function(`return function qhOrderedOffers(model,mfrs){${m[1]}\n}`)();
  const model = {cells:new Map([
    ['Zeta', {price:12.5}],
    ['Beta', {price:9.25}],
    ['Alfa', {price:9.25}],
    ['Boş', {price:null}],
  ])};
  assert.deepEqual(fn(model, ['Zeta','Beta','Alfa','Boş']).map(x=>[x.price,x.manufacturer]), [
    [9.25,'Alfa'], [9.25,'Beta'], [12.5,'Zeta'],
  ]);
});

test('fiyat sırası hücresi fiyatı ve üretici adını aynı hücrede gösterir', () => {
  assert.match(QUOT, /qhOrderPrice[^`]*\$\{qhEsc\(qhMoney\(c\.price\)\)\}/);
  assert.match(QUOT, /qhOrderMfr[^`]*\$\{qhEsc\(c\.manufacturer\)\}/);
});

test('TPs profil menüleri modalın üzerinde açılır', () => {
  assert.match(INDEX, /select\.closest\('\.warnOverlay'\).*profileSelectMenuModal/);
  assert.match(CSS, /\.profileSelectMenu\.profileSelectMenuModal\{z-index:54010;\}/);
});

test('Koleksiyon dondurma fiziksel yaprak başlıklarını kullanır ve her çizimde uygulanır', () => {
  assert.match(INDEX, /function freezeHeaderCells\(table\)/);
  assert.match(INDEX, /th:not\(\.chkTh\):not\(\.groupSpacer\)/);
  assert.match(INDEX, /applyFreeze\('kolTable','koleksiyon',true\)/);
  assert.match(INDEX, /freezeStartFor\(String\(info\.tableSel\)\.replace\('#',''\),info\.tableKey/);
});

test('dondurma seçiminde tek sütun sınırı lazerle gösterilir ve buton kırmızı vurgulanır', () => {
  assert.match(CSS, /\.freezeLaser\{[^}]*width:2px/s);
  assert.match(CSS, /\.navActionBtn\.freezeOn,\.lflCpTableTool\.freezeOn/);
  assert.match(INDEX, /freezeColumnAtX\(table,event\.clientX\)/);
  assert.match(INDEX, /setFreeze\(pick\.tableKey,count\)/);
  assert.doesNotMatch(CSS, /freezeClosed|freezeOpen|freezeBar/);
});

test('Koleksiyon sütun düzeni landed sütunlarını her zaman en sağa taşır', () => {
  assert.match(INDEX, /const KOL_COL_LAYOUT_VERSION = 7/);
  assert.match(INDEX, /function kolPlaceLandedAtEnd\(order\)/);
  assert.match(INDEX, /out\.push\('ydLanded','trLanded'\)/);
  assert.match(INDEX, /kolColOrder\s*=\s*kolPlaceLandedAtEnd/);
  assert.match(INDEX, /normalizedKeys=kolPlaceLandedAtEnd/);
});

test('varsayılan Koleksiyon sırası normal alanlar, Overseas Landed, TR Landed şeklindedir', () => {
  const notes=INDEX.indexOf("{k:'not', label:'Notes'");
  const overseas=INDEX.indexOf("{k:'ydLanded', label:'Overseas Landed'");
  const tr=INDEX.indexOf("{k:'trLanded', label:'TR Landed'");
  assert.ok(notes>=0 && notes<overseas && overseas<tr);
});
