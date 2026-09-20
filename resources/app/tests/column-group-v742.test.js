'use strict';

/*
 * v7.42 — SÜTUNUN ÜST BAŞLIĞINI (GRUBUNU) KULLANICI SEÇER
 *
 * Kullanıcı talebi (birebir):
 *   "sütun ve hesaplamalı sütun eklerken temel sütun başlığını da
 *    ayarlayabileyim. Şu an Calculated Column adı altında görünüyor, dilersem
 *    Order Info'ya dahil edebileyim, dilersem yeni alan adı yaratabileyim."
 *
 * İŞİN ASIL ZORLUĞU — VE BU DOSYANIN ASIL KORUDUĞU ŞEY:
 *   Tablo başlık satırı bandı, sütunların grup ADINDAN değil, YAN YANA duran
 *   aynı gruplu sütunların oluşturduğu diziden kurar (renderFullTable içindeki
 *   "runs" döngüsü). Yani bir sütuna yalnızca group:'Order Info' demek yetmez;
 *   sütun o grubun yanına TAŞINMAZSA ekranda İKİNCİ bir "Order Info" bandı
 *   belirir ve kullanıcı haklı olarak "dahil edemedim" der. Aşağıdaki testler
 *   bandın gerçekten TEK parça olduğunu, sıra üzerinde hesaplayarak doğrular.
 *
 * KORUNAN DAVRANIŞLAR
 *   1) Var olan bir başlık seçilince sütun o bandın sonuna girer — bant bölünmez.
 *   2) Yeni bir başlık adı kendi bandını açar.
 *   3) Grup seçilmezse eski varsayılan korunur (hesaplanan → Hesaplanan,
 *      veri tabanı → Database). Uydurma değer yazılmaz (§152).
 *   4) Sıra YALNIZ sütun yeniyken ya da grubu değiştiğinde kurulur; her
 *      eşitlemede taşımak kullanıcının elle sürüklediği sırayı bozardı (§142).
 *   5) Grup adı serbest metindir ve başlığa KAÇIŞLI yazılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app-main.js');
const FC = read('public/formula-columns.js');
const DB = read('server/db.js');

/* Kaynaktan tek bir işlevi söker. ÖNCE parametre parantezi atlanır: varsayılan
   değerli bir parametre (options={}) süslü parantez içerir ve doğrudan süslü
   saymak imzayı gövde sanardı. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  let i = source.indexOf('(', start), paren = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')') { paren--; if (paren === 0) { i++; break; } }
  }
  while (i < source.length && source[i] !== '{') i++;
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  throw new Error(`${name} kapanmıyor`);
}

const GROUP_KEY_LINE = APP.match(/^const groupKey=.*$/m);
assert.ok(GROUP_KEY_LINE, 'groupKey tanımı bulunmalı');

/* Gerçek işlevleri sahte bir tablo durumuyla çalıştırır: sıra üzerindeki etki
   iddia edilmez, ÖLÇÜLÜR. */
function groupApi(cols, order) {
  const state = { cols: cols.map(col => ({ ...col })), order: order.slice() };
  const api = new Function('state', `
    const COLS_BY_TABLE = { cp: state.cols };
    const colmgr = { cp: { order: state.order } };
    ${GROUP_KEY_LINE[0]}
    ${extractFunction(APP, 'existingColumnGroups')}
    ${extractFunction(APP, 'placeColumnInGroup')}
    return { existingColumnGroups, placeColumnInGroup };
  `)(state);
  return { ...api, state };
}

/* renderFullTable'daki bant kurucusunun aynısı: sıraya göre bitişik aynı
   gruplu sütunlar tek bir bant olur. */
function bands(state) {
  const byKey = new Map(state.cols.map(col => [col.k, col]));
  const runs = [];
  for (const key of state.order) {
    const group = (byKey.get(key) || {}).group || '';
    const last = runs[runs.length - 1];
    if (last && last.group === group) { last.span++; last.keys.push(key); }
    else runs.push({ group, span: 1, keys: [key] });
  }
  return runs;
}

const SAMPLE = [
  { k: 'order', group: 'Order Info' },
  { k: 'model', group: 'Order Info' },
  { k: 'qty', group: 'Order Info' },
  { k: 'fabric', group: 'Kumaş' },
  { k: 'eta', group: 'Lojistik' },
];

/* ------------------------------------------------------------------ */
/* 1) VAR OLAN BAŞLIĞA DAHİL ETME — TALEBİN ÖZÜ                        */
/* ------------------------------------------------------------------ */

test('v7.42 · "Order Info" seçilen sütun O BANDIN İÇİNE girer, ikinci bant açılmaz', () => {
  const cols = [...SAMPLE, { k: 'fc_lead', group: 'Order Info' }];
  const api = groupApi(cols, cols.map(col => col.k));
  /* Sütun sonda: taşımadan önce iki ayrı "Order Info" bandı vardır — kullanıcının
     şikâyet ettiği tam olarak budur. */
  assert.equal(bands(api.state).filter(run => run.group === 'Order Info').length, 2);

  api.placeColumnInGroup('cp', 'fc_lead', 'Order Info');
  const runs = bands(api.state);
  assert.equal(runs.filter(run => run.group === 'Order Info').length, 1, 'tek bant kalmalı');
  assert.deepEqual(runs[0].keys, ['order', 'model', 'qty', 'fc_lead'], 'grubun SONUNA eklenir');
  assert.equal(api.state.order.length, cols.length, 'hiçbir sütun kaybolmaz (§142)');
});

test('v7.42 · ortadaki bir gruba eklemek sonraki grupları bozmaz', () => {
  const cols = [...SAMPLE, { k: 'fc_x', group: 'Kumaş' }];
  const api = groupApi(cols, cols.map(col => col.k));
  api.placeColumnInGroup('cp', 'fc_x', 'Kumaş');
  assert.deepEqual(api.state.order, ['order', 'model', 'qty', 'fabric', 'fc_x', 'eta']);
  assert.deepEqual(bands(api.state).map(run => run.group), ['Order Info', 'Kumaş', 'Lojistik']);
});

test('v7.42 · başlık adı büyük/küçük harften bağımsız eşleşir (TR duyarlı)', () => {
  const cols = [...SAMPLE, { k: 'fc_x', group: 'ORDER INFO' }];
  const api = groupApi(cols, cols.map(col => col.k));
  api.placeColumnInGroup('cp', 'fc_x', 'ORDER INFO');
  assert.equal(api.state.order.indexOf('fc_x'), 3, 'yazım farkı yeni bant açmamalı');
});

/* ------------------------------------------------------------------ */
/* 2) YENİ BAŞLIK YARATMA                                              */
/* ------------------------------------------------------------------ */

test('v7.42 · bilinmeyen başlık kendi bandını açar (sütun sonda kalır)', () => {
  const cols = [...SAMPLE, { k: 'fc_new', group: 'Üretim Takibi' }];
  const api = groupApi(cols, cols.map(col => col.k));
  api.placeColumnInGroup('cp', 'fc_new', 'Üretim Takibi');
  const runs = bands(api.state);
  assert.equal(runs[runs.length - 1].group, 'Üretim Takibi');
  assert.deepEqual(runs[runs.length - 1].keys, ['fc_new']);
});

test('v7.42 · aynı yeni başlığı alan ikinci sütun BİRİNCİNİN yanına gider', () => {
  const cols = [...SAMPLE, { k: 'a', group: 'Üretim' }, { k: 'b', group: 'Üretim' }];
  const api = groupApi(cols, ['a', 'order', 'model', 'qty', 'fabric', 'eta', 'b']);
  api.placeColumnInGroup('cp', 'b', 'Üretim');
  assert.equal(bands(api.state).filter(run => run.group === 'Üretim').length, 1);
});

/* ------------------------------------------------------------------ */
/* 3) MEVCUT BAŞLIKLARIN LİSTESİ                                       */
/* ------------------------------------------------------------------ */

test('v7.42 · seçenek listesi başlıkları EKRANDAKİ sırayla ve tekrarsız verir', () => {
  const api = groupApi(SAMPLE, SAMPLE.map(col => col.k));
  assert.deepEqual(api.existingColumnGroups('cp'), ['Order Info', 'Kumaş', 'Lojistik']);
});

test('v7.42 · sıra kullanıcının sürüklediği hâlde ise liste de o sırayı izler', () => {
  const api = groupApi(SAMPLE, ['eta', 'fabric', 'order', 'model', 'qty']);
  assert.deepEqual(api.existingColumnGroups('cp'), ['Lojistik', 'Kumaş', 'Order Info']);
});

test('v7.42 · sırada olmayan (gizlenmiş/yeni) sütunun grubu da listede kalır', () => {
  const cols = [...SAMPLE, { k: 'gizli', group: 'Notlar' }];
  const api = groupApi(cols, SAMPLE.map(col => col.k));
  assert.ok(api.existingColumnGroups('cp').includes('Notlar'), 'seçenek kaybolmamalı');
});

test('v7.42 · grupsuz sütun listeye boş bir başlık eklemez', () => {
  const cols = [...SAMPLE, { k: 'serbest', group: '' }];
  const api = groupApi(cols, cols.map(col => col.k));
  assert.deepEqual(api.existingColumnGroups('cp'), ['Order Info', 'Kumaş', 'Lojistik']);
});

/* ------------------------------------------------------------------ */
/* 4) HESAPLANAN SÜTUN TARAFI                                          */
/* ------------------------------------------------------------------ */

test('v7.42 · hesaplanan sütun grubu tanımdan gelir, seçilmemişse Hesaplanan', () => {
  const fn = new Function(`
    const clean = value => String(value == null ? '' : value).trim();
    const DEFAULT_GROUP = 'Hesaplanan';
    ${extractFunction(FC, 'definitionGroup')}
    return definitionGroup;`)();
  assert.equal(fn({ group: 'Order Info' }), 'Order Info');
  assert.equal(fn({ group: '   ' }), 'Hesaplanan', 'boş bırakılırsa eski davranış');
  assert.equal(fn({}), 'Hesaplanan');
  assert.equal(fn(null), 'Hesaplanan');
});

test('v7.42 · syncColumns sütuna seçilen grubu verir', () => {
  const fn = extractFunction(FC, 'syncColumns');
  assert.match(fn, /group: definitionGroup\(definition\)/);
  assert.doesNotMatch(fn, /group: 'Hesaplanan'/, 'grup artık sabit değil');
});

test('v7.42 · sıra YALNIZ sütun yeniyken ya da grubu değişince kurulur', () => {
  /* Aksi hâlde her eşitleme, kullanıcının elle sürüklediği sırayı geri alırdı. */
  const fn = extractFunction(FC, 'syncColumns');
  assert.match(fn, /const placed = col\.formulaDef && col\.formulaDef\._placedGroup;/);
  assert.match(fn, /if \(isNew \|\| nameKey\(placed \|\| ''\) !== nameKey\(col\.group\)\) \{/);
  assert.match(fn, /placeInGroup\(tableKey, col\.k, col\.group\);/);
  assert.match(fn, /rememberPlacedGroup\(tableKey, col\.formulaId, col\.group\);/);
});

test('v7.42 · son yerleştirilen grup tanımın yanında saklanır, gereksiz yazma yok', () => {
  const fn = extractFunction(FC, 'rememberPlacedGroup');
  assert.match(fn, /if \(!item \|\| nameKey\(item\._placedGroup \|\| ''\) === nameKey\(group\)\) return;/);
  assert.match(fn, /item\._placedGroup = group;\s*save\(tableKey, list\);/);
});

test('v7.42 · pencerede başlık seçimi ve yeni başlık kutusu var', () => {
  assert.match(FC, /<select data-fc-group>/);
  assert.match(FC, /Üst başlık \(grup\)/);
  assert.match(FC, /data-fc-group-new maxlength="40"/);
  assert.match(FC, /const NEW_GROUP = '__fc_new_group__';/);
  assert.match(FC, /const chosenGroup = \(\) => \(groupInput\.value === NEW_GROUP \? clean\(groupNewInput\.value\) : clean\(groupInput\.value\)\);/);
  assert.match(FC, /group: chosenGroup\(\),/, 'kaydedilen tanıma girmeli');
});

test('v7.42 · yeni başlık seçilip adı boş bırakılırsa kaydedilmez', () => {
  assert.match(FC, /if \(groupInput\.value === NEW_GROUP && !item\.group\) \{[\s\S]*?Yeni başlık adı gerekli\./);
});

test('v7.42 · hesaplanan sütun ile veri tabanı sütunu AYNI yerleştirmeyi kullanır', () => {
  /* İki ayrı kopya zamanla ayrışır; bant birleşmesi tek bir yerde durmalı. */
  assert.match(APP, /window\.BLColumnGroups=\{ list:existingColumnGroups, placeInGroup:placeColumnInGroup, key:groupKey \};/);
  assert.match(extractFunction(FC, 'placeInGroup'), /shared\.placeInGroup\(tableKey, key, group\)/);
  assert.match(extractFunction(FC, 'existingGroups'), /shared\.list\(tableKey\)/);
});

/* ------------------------------------------------------------------ */
/* 5) VERİ TABANI SÜTUNU TARAFI                                        */
/* ------------------------------------------------------------------ */

test('v7.42 · veri tabanı sütunu da seçilen grubu alır, boşsa Database', () => {
  const fn = extractFunction(APP, 'syncCpModelColumns');
  assert.match(fn, /group:String\(d\.group\|\|''\)\.trim\(\)\|\|DEFAULT_MODEL_COLUMN_GROUP/);
  assert.match(APP, /const DEFAULT_MODEL_COLUMN_GROUP='Database';/);
});

test('v7.42 · veri tabanı sütunu da yalnız yeniyken/grubu değişince taşınır', () => {
  const fn = extractFunction(APP, 'syncCpModelColumns');
  assert.match(fn, /const previousGroup=new Map\(CP_MODEL_COLUMN_DEFS\.map\(d=>\[d\.header,d\.group\|\|DEFAULT_MODEL_COLUMN_GROUP\]\)\);/);
  assert.match(fn, /if\(isNew\|\|groupKey\(previousGroup\.get\(c\.k\)\|\|''\)!==groupKey\(c\.group\)\)placeColumnInGroup\('cp',c\.k,c\.group\);/);
});

test('v7.42 · sunucu grubu saklar; uydurmaz (§152)', () => {
  const fn = extractFunction(DB, 'normalizeCpModelColumns');
  assert.match(fn, /group: String\(item\.group == null \? '' : item\.group\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, 40\)/);
  assert.doesNotMatch(fn, /group: item\.group \|\| 'Database'/, 'varsayılanı sunucu yazmaz');
});

test('v7.42 · sunucu grubu kaydeder ve uzunluğu sınırlar', () => {
  const db = require('../server/db.js');
  const out = db.normalizeCpModelColumns([
    { id: 'a1', label: 'Sipariş No', table: 'ASAS', name: 'OrderNo', group: '  Order   Info  ' },
    { id: 'a2', label: 'Depo', table: 'ASAS', name: 'Depot', group: 'x'.repeat(80) },
    { id: 'a3', label: 'Renk', table: 'ASAS', name: 'Color' },
  ]);
  assert.equal(out[0].group, 'Order Info', 'boşluklar sadeleşir');
  assert.equal(out[1].group.length, 40);
  assert.equal(out[2].group, '', 'grup verilmediyse sunucu boş bırakır; varsayılanı arayüz koyar');
});

test('v7.42 · veri tabanı sütunu penceresinde başlık seçimi var', () => {
  const fn = extractFunction(APP, 'openCpModelColumnModal');
  assert.match(fn, /const NEW_GROUP_OPTION='__new_group__';/);
  assert.match(fn, /const groupChoices=existingColumnGroups\('cp'\);/);
  assert.match(fn, /id="_cpModelGroup"/);
  assert.match(fn, /id="_cpModelGroupNew"/);
  assert.match(fn, /Üst başlık \(grup\)/);
  assert.match(fn, /if\(groupSelect\.value===NEW_GROUP_OPTION&&!group\)/, 'boş yeni ad kaydedilmemeli');
  /* v7.81: sütun artık TEK İŞLEM olarak yazılıyor (writeCpModelColumn →
     PATCH .../source/:id). Bütün diziyi PUT etmek, bayat bir görünümde başka
     bir pencerede eklenmiş sütunu sessizce düşürüyordu. Korunan asıl iddia
     aynı: seçilen başlık (grup) kayda GİDİYOR. */
  assert.match(fn, /writeCpModelColumn\(selectedConnectionId,\{op:'(add|update)',[^}]*group,/,
    'seçilen üst başlık kayda gitmeli');
  assert.doesNotMatch(fn, /cpColumns\.push\(/, 'tam dizi üzerinde düzenleme kalmamalı');
});

test('v7.42 · düzenlemede sütunun kayıtlı başlığı seçili gelir', () => {
  const fn = extractFunction(APP, 'openCpModelColumnModal');
  assert.match(fn, /const currentGroup=String\(\(existing&&existing\.group\)\|\|''\)\.trim\(\)\|\|DEFAULT_MODEL_COLUMN_GROUP;/);
  assert.match(fn, /groupKey\(g\)===groupKey\(currentGroup\)\?' selected':''/);
});

/* ------------------------------------------------------------------ */
/* 6) SERBEST METİN BAŞLIK GÜVENLİ ÇİZİLİR                             */
/* ------------------------------------------------------------------ */

test('v7.42 · başlık adı serbest metin olduğu için kaçışlı yazılır', () => {
  assert.match(APP, /data-grp="\$\{escapeHtml\(r\.group\)\}"[\s\S]{0,160}\$\{escapeHtml\(L\(r\.group\)\)\}<\/th>/);
});

test('v7.42 · bilinmeyen başlık rengi varsayılana düşer (çizim bozulmaz)', () => {
  assert.match(APP, /GROUP_ACCENTS\[r\.group\]\|\|'var\(--acc\)'/);
});

/* ------------------------------------------------------------------ */
/* 6b) GİZLEME VE YERLEŞİM — TARAYICIDA GÖRÜLEN İKİ KUSUR              */
/* ------------------------------------------------------------------ */

test('v7.42 · "yeni başlık adı" kutusu gerçekten gizlenir', () => {
  /* Ölçüldü: display:flex kuralı [hidden] özniteliğinin display:none'unu
     yeniyordu; kutu kapalıyken bile ekranda duruyordu. */
  const css = read('public/app.css');
  assert.match(css, /\.fcField\[hidden\]\{display:none;\}/);
  assert.match(css, /\.cpModelColumnBody>label\[hidden\]\{display:none;\}/);
});

test('v7.42 · veri tabanı penceresinde tam genişlik alan SIRAYLA değil adıyla seçilir', () => {
  /* Pencereye üst başlık alanı eklenince nth-child(3) arama kutusundan
     kayıyor, arama kutusu yarım genişliğe düşüyordu. */
  const css = read('public/app.css');
  assert.match(css, /\.cpModelColumnBody>label\.cpModelWide\{grid-column:1\/-1;\}/);
  assert.doesNotMatch(css, /\.cpModelColumnBody>label:nth-child\(3\)/, 'sıraya bağlı kural kalmamalı');
  assert.match(APP, /<label class="cpModelWide">\$\{escapeHtml\(appLang==='en'\?'Search source columns'/);
});

/* ------------------------------------------------------------------ */
/* 7) SÜRÜM                                                            */
/* ------------------------------------------------------------------ */

/* v7.43 — GÜNCELLENDİ (§156). Amaç aynı: sürüm tüm dosyalarda BİRLİKTE
   ilerlesin. Sabit '7.42' beklemek bu testi her yükseltmede engele çevirirdi;
   sürüm artık package.json'dan okunuyor, v7.42 kaydının geçmişte durduğu ayrıca
   doğrulanıyor. */
test('v7.42/v7.43 · sürüm tek canonical kaynaktan runtime türetilir', () => {
  const canonical = JSON.parse(read('package.json')).version;
  assert.match(canonical, /^\d+\.0\.\d+$/);
  const index = read('public/index.html');
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  const tags = [...index.matchAll(/[?&]v=([^&\"']+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(tags)], ['__BL_ASSET_VERSION__']);
  assert.match(read('public/version-history.js'), /v: '7\.42'/, 'v7.42 kaydı geçmişte durmalı');
});
