'use strict';

/* ===================================================================
   OCTOPUS ÇIKTISI — CEVABIN DAYANDIĞI VERİYİ EXCEL'E ÇEVİRİR

   NEDEN SUNUCUDA. Araç sonuçlarının `result` alanı istemciye KASITLI olarak
   gönderilmiyor (copilot-agent.js: `toolCalls.map(({result, ...call}) => call)`).
   Satırlar yalnız sunucuda var; çıktı da orada üretilmek zorunda. İstemciye
   satırları göndermek yalnız bir çıktı üretebilmek için o kararı geri almak
   olurdu.

   NE İHRAÇ EDİLİR. Yalnız araçların GERÇEKTEN döndürdüğü satırlar. Modelin
   cümlesinden sayı çıkarılmaz, eksik hücre uydurulmaz. Ortada tablo yoksa
   çıktı da yoktur — boş bir Excel sunmak, olmayan bir dayanağı varmış gibi
   göstermek olurdu.

   RAPOR SAYFASI ZORUNLUDUR. Bir Excel dosyası e-postayla tedarikçiye gider,
   altı ay sonra klasörde bulunur ve kimse hangi soruya cevap olduğunu
   hatırlamaz. Bu yüzden ilk sayfa her zaman soruyu, cevabı, modeli, kapsamı,
   zamanı ve dayanağı taşır. Bağlamsız bir sayı, yanlış bir sayıdan daha
   tehlikelidir çünkü sorgulanmaz.
   =================================================================== */

/* Excel'in kendi sınırları değil, MAKUL sınırlar: bir cevabın dayanağı
   milyonlarca satır olamaz; olduysa zaten cevap değil veri dökümüdür. */
const MAX_SHEETS = 8;
const MAX_ROWS_PER_SHEET = 5000;
const MAX_COLUMNS = 60;
/* Excel hücre sınırı 32767; altında kalıp kırpıldığını BELLİ ediyoruz. */
const MAX_CELL = 4000;
const SHEET_NAME_LIMIT = 31;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

/* Excel sayfa adı: 31 karakter ve : \ / ? * [ ] yasak. Çakışan adlar
   Excel'de dosyayı bozuyor, bu yüzden benzersizleştirilir. */
function sheetName(base, used) {
  const safe = clean(base).replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Veri';
  let name = safe.slice(0, SHEET_NAME_LIMIT);
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = safe.slice(0, SHEET_NAME_LIMIT - suffix.length) + suffix;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/* Hücreye yazılabilir değer. Nesne ve dizi JSON'a çevrilir — "[object Object]"
   yazmak, veriyi kaybetmenin sessiz hâli. */
function cellValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : '';
  if (typeof value === 'object') {
    let text;
    try { text = JSON.stringify(value); } catch (_) { text = String(value); }
    return text.length > MAX_CELL ? text.slice(0, MAX_CELL) + '…' : text;
  }
  const text = String(value);
  return text.length > MAX_CELL ? text.slice(0, MAX_CELL) + '…' : text;
}

/* Sütun sırası İLK GÖRÜLDÜĞÜ sıradır, alfabetik değil: araçlar alanları
   anlamlı bir sırayla döndürüyor (kimlik önce, ölçü sonra) ve alfabetik
   sıralamak o bilgiyi yok ederdi. */
function columnsOf(rows) {
  const seen = [];
  const known = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) {
      if (known.has(key)) continue;
      known.add(key);
      seen.push(key);
      if (seen.length >= MAX_COLUMNS) return seen;
    }
  }
  return seen;
}

/* Bir araç çağrısından tablo çıkar. Tabloya benzemeyen sonuçlar (tek bir
   sayı, bir onay, bir gezinme komutu) atlanır — zorlamak, tek satırlık
   anlamsız sayfalar üretirdi. */
function tableFrom(call) {
  const result = call && call.result;
  if (!result || typeof result !== 'object') return null;
  const rows = Array.isArray(result.rows) ? result.rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
  if (!rows.length) return null;
  const columns = columnsOf(rows);
  if (!columns.length) return null;
  const capped = rows.slice(0, MAX_ROWS_PER_SHEET);
  return {
    tool: clean(call.id),
    source: clean(result.source),
    columns,
    rows: capped,
    total: rows.length,
    truncated: rows.length > capped.length || Boolean(result.truncated),
  };
}

function tableSheetName(table) {
  const kind = table.tool.startsWith('dataset.aggregate') || table.tool.startsWith('dataset.analyze') ? 'ozet' : 'satirlar';
  return [table.source || 'veri', kind].filter(Boolean).join(' ');
}

/* Rapor sayfası: dosyanın kendi kendini açıklaması. */
function reportSheet(input, tables) {
  const at = clean(input.at) || new Date().toISOString();
  const aoa = [
    ['Buyer Log · Octopus'],
    [],
    ['Soru', clean(input.question)],
    ['Cevap', clean(input.answer)],
    [],
    ['Üreten', clean(input.actor) || '—'],
    ['Model', clean(input.model) || '—'],
    ['Oluşturma', at],
    [],
    ['DAYANAK'],
    ['Kaynak', 'İncelenen kayıt', 'Verinin güncelliği', 'Kapsam'],
  ];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (evidence.length) {
    evidence.forEach(item => aoa.push([
      clean(item && item.source),
      Number(item && item.matched) || '',
      clean(item && item.refreshedAt),
      item && item.scope && item.scope.outsideHorizon ? 'Horizon dışı veriler dahil' : '',
    ]));
  } else {
    aoa.push(['—', '', '', '']);
  }
  aoa.push([], ['SAYFALAR'], ['Sayfa', 'Araç', 'Satır', 'Not']);
  tables.forEach(table => aoa.push([
    table.sheet, table.tool, table.total,
    /* Kırpma GİZLENMEZ: eksik olduğunu bilmeyen biri toplamı yanlış okur. */
    table.truncated ? `İlk ${table.rows.length} satır gösteriliyor` : '',
  ]));
  return { name: 'Rapor', aoa };
}

/* Çıktı modeli: sayfa listesi. Dosyanın kendisini yazmaz — o iş çağırana
   ait; burası saf kalır ve test edilebilir olur. */
function buildExportModel(input) {
  const source = input && typeof input === 'object' ? input : {};
  const calls = Array.isArray(source.toolCalls) ? source.toolCalls : [];
  const used = new Set();
  const tables = [];
  for (const call of calls) {
    if (tables.length >= MAX_SHEETS) break;
    if (call && call.error) continue;
    const table = tableFrom(call);
    if (!table) continue;
    table.sheet = sheetName(tableSheetName(table), used);
    tables.push(table);
  }
  /* Tablo yoksa çıktı da yok. Yalnız rapor sayfasından oluşan bir Excel,
     kullanıcıya "verin burada" diyip boş bir dosya vermek olurdu. */
  if (!tables.length) return null;

  const sheets = [reportSheet(source, tables)];
  for (const table of tables) {
    const aoa = [table.columns.slice()];
    for (const row of table.rows) aoa.push(table.columns.map(column => cellValue(row[column])));
    sheets.push({ name: table.sheet, aoa });
  }

  return {
    sheets,
    fileName: fileNameFor(source),
    tableCount: tables.length,
    rowCount: tables.reduce((sum, table) => sum + table.rows.length, 0),
  };
}

/* Dosya adı sorudan türer: indirilenler klasöründe on tane
   "Octopus_Rapor.xlsx" işe yaramaz. */
function fileNameFor(input) {
  const stamp = (clean(input.at) || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  const slug = clean(input.question)
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, ch => ({ 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' }[ch]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `Octopus_${slug || 'rapor'}_${stamp}.xlsx`;
}

module.exports = {
  buildExportModel, fileNameFor, cellValue, columnsOf, sheetName,
  MAX_SHEETS, MAX_ROWS_PER_SHEET, MAX_COLUMNS, MAX_CELL,
};
