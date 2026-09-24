'use strict';

/*
 * Veri modeli (SSAS Tabular) doğrudan sorgulama katmanı.
 *
 * Uygulamanın ana Refresh akışı, Data Model Connection bölümünde aktif edilen
 * ASAS ve Antrepo bağlantılarını bu katman üzerinden doğrudan sorgular. Aynı sorgu
 * altyapısı keşif, ön izleme ve CSV/JSON dışa aktarma işlemlerinde de kullanılır;
 * kaynak Excel klasörü ana veri yenileme zincirinde yer almaz.
 *
 * Gerçek iş ModelQuery.ps1 içinde yapılır. Burada yalnız girdi doğrulama, süreç
 * yönetimi ve hata sınıflandırma var — bu sayede Windows olmayan bir makinede de
 * test edilebilir (runner enjekte edilebilir).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('./platform');

const SCRIPT_PATH = path.join(__dirname, 'ModelQuery.ps1');

const MIN_TIMEOUT_MS = 15 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
// Kullanıcının ELLE yazdığı DAX için sınır. Amaç yazım hatası veya yapıştırma
// kazasını yakalamak; bu boyutta bir sorguyu insan yazmaz.
const MAX_QUERY_LENGTH = 20000;
// Uygulamanın ÜRETTİĞİ sorgular için ayrı ve çok daha yüksek sınır. Sipariş kodu
// filtresi gibi listeler binlerce değer taşıyabilir ve bunlar denetimimiz altında
// üretilir. Aynı sınırı paylaşmaları v3.61'e kadar sessiz bir çelişkiydi: kod
// listesi 10.000'e kadar sorguya gömülüyordu ama 20.000 karakter sınırı ~1.600
// koddan sonra sorguyu reddediyordu.
const MAX_GENERATED_QUERY_LENGTH = 4000000;

// Sunucu ve katalog adları bağlantı dizesine gömülür. Noktalı virgül veya eşittir
// içeren bir değer dizeye yeni bir anahtar enjekte edebilirdi; bu yüzden ad
// karakterleri beyaz listeyle sınırlanır (örnek: SUNUCU\ORNEK, sunucu.local:2383).
const NAME_PATTERN = /^[A-Za-z0-9._\-\\: ]{1,128}$/;

// Modele yazma XMLA komutlarıyla yapılır. Sorgu alanı yalnız okuma içindir; XMLA
// gövdesi benzeri bir metin geldiğinde hiç çalıştırmadan reddedilir.
const FORBIDDEN_QUERY_PATTERN = /<\s*(Batch|Alter|Create|Delete|Drop|Process|Restore|Backup|Execute)\b/i;

class ModelQueryError extends Error {
  constructor(message, code, statusCode = 500, extra = {}) {
    super(message);
    this.name = 'ModelQueryError';
    this.code = code || 'MODEL_QUERY_FAILED';
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}

function validateName(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new ModelQueryError(`${label} boş bırakılamaz.`, 'VALIDATION_ERROR', 400);
  if (!NAME_PATTERN.test(text)) {
    throw new ModelQueryError(`${label} yalnız güvenli model adı karakterleri içerebilir.`, 'VALIDATION_ERROR', 400);
  }
  return text;
}

function validateQuery(value, options = {}) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new ModelQueryError('Sorgu boş bırakılamaz.', 'VALIDATION_ERROR', 400);
  const limit = options.generated ? MAX_GENERATED_QUERY_LENGTH : MAX_QUERY_LENGTH;
  if (text.length > limit) {
    throw new ModelQueryError(
      options.generated
        ? `Üretilen sorgu çok uzun (${text.length} karakter, sınır ${limit}). Ufuk koşullarını daraltın.`
        : `Sorgu çok uzun (en fazla ${limit} karakter).`,
      'VALIDATION_ERROR', 400);
  }
  if (/\[object Object\]/i.test(text)) {
    throw new ModelQueryError(
      'DAX sorgusuna sütun adı yerine bir alan eşleme nesnesi yazılmış. Data Model Connection alan eşlemesini yeniden kaydedin.',
      'MODEL_MAPPING_SERIALIZATION_ERROR', 400);
  }
  if (FORBIDDEN_QUERY_PATTERN.test(text)) {
    throw new ModelQueryError('Bu alan yalnız okuma sorguları içindir; XMLA komutları çalıştırılamaz.', 'QUERY_NOT_ALLOWED', 400);
  }
  return text;
}

function clampTimeout(value) {
  const requested = Number(value) > 0 ? Number(value) : DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requested));
}

// PowerShell birden çok satır yazabilir (uyarılar vb.). Özet her zaman son geçerli
// JSON satırıdır; gerisi yok sayılır.
function parseSummary(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try { return JSON.parse(lines[i]); } catch (_) { /* sonraki satırı dene */ }
  }
  return null;
}

function cancelledError() {
  const error = new Error('Yenileme kullanıcı tarafından durduruldu.');
  error.name = 'AbortError';
  error.code = 'REFRESH_CANCELLED';
  return error;
}

function defaultRunner(args, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal && signal.aborted) return reject(cancelledError());
    let aborted = false;
    const child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (aborted) return reject(cancelledError());
        // Script hata durumunda da stdout'a özet yazar ve exit 1 döner; bu yüzden
        // hata nesnesini değil, önce çıktıyı değerlendiriyoruz.
        if (err && !stdout) return reject(Object.assign(err, { stderr: String(stderr || '') }));
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), error: err || null });
      });
    function onAbort() {
      aborted = true;
      // Yalnız bu sorguya ait doğrulanmış child process durdurulur.
      try { child.kill(); } catch (_) {}
    }
    if (signal) signal.addEventListener('abort', onAbort, { once:true });
  });
}

/**
 * Modele tek bir sorgu çalıştırır ve sonucu dosyaya yazar.
 * options.runner testlerde PowerShell'i devre dışı bırakmak için enjekte edilir.
 */
async function runModelQuery(input = {}, options = {}) {
  const runner = options.runner || defaultRunner;
  const server = validateName(input.server, 'Sunucu');
  const catalog = validateName(input.catalog, 'Model');
  const query = validateQuery(input.query, { generated: Boolean(input.generated) });
  const format = input.format === 'json' ? 'json' : 'csv';
  const timeoutMs = clampTimeout(input.timeoutMs);
  const previewRows = Math.min(50, Math.max(0, Number(input.previewRows) || 0));
  const maxRows = Math.min(2000000, Math.max(1, Number(input.maxRows) || 500000));

  if (!options.runner && !platform.IS_WINDOWS) {
    throw new ModelQueryError(
      'Veri modeli sorgusu yalnız Windows üzerinde çalışır; bu makinede MSOLAP sağlayıcısı bulunmuyor.',
      'MODEL_QUERY_UNSUPPORTED', 501);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blmodel-'));
  const queryFile = path.join(tempDir, 'query.dax');
  fs.writeFileSync(queryFile, query, 'utf8');

  const outFile = input.outFile ? String(input.outFile) : path.join(tempDir, `result.${format}`);
  const args = [
    '-Server', server, '-Catalog', catalog, '-QueryFile', queryFile,
    '-OutFile', outFile, '-Format', format,
    '-MaxRows', String(maxRows), '-PreviewRows', String(previewRows),
  ];
  // SUMMARIZECOLUMNS çıktısındaki "Tablo[Sütun]" adlarını uygulamanın beklediği
  // başlıklara çevirmek için (bkz. modelHorizon.buildSummarizeQuery).
  let headerMapFile = null;
  if (input.headerMap && Object.keys(input.headerMap).length) {
    headerMapFile = path.join(tempDir, 'headers.json');
    fs.writeFileSync(headerMapFile, JSON.stringify(input.headerMap), 'utf8');
    args.push('-HeaderMapFile', headerMapFile);
  }

  let raw;
  try {
    raw = await runner(args, timeoutMs, { signal: options.signal });
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive:true, force:true }); } catch (_) {}
    if ((options.signal && options.signal.aborted) || (err && (err.name === 'AbortError' || err.code === 'REFRESH_CANCELLED'))) {
      throw new ModelQueryError('Yenileme kullanıcı tarafından durduruldu.', 'REFRESH_CANCELLED', 409);
    }
    const timedOut = Boolean(err && (err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM'));
    throw new ModelQueryError(
      timedOut
        ? `Model sorgusu zaman aşımına uğradı (${Math.round(timeoutMs / 1000)} sn).`
        : `Model sorgusu çalıştırılamadı: ${String(err && (err.stderr || err.message) || 'bilinmeyen hata').replace(/\s+/g, ' ').trim()}`,
      timedOut ? 'MODEL_QUERY_TIMEOUT' : 'MODEL_QUERY_FAILED',
      timedOut ? 504 : 500);
  } finally {
    try { fs.unlinkSync(queryFile); } catch (_) {}
    if (headerMapFile) { try { fs.unlinkSync(headerMapFile); } catch (_) {} }
  }

  const summary = parseSummary(raw && raw.stdout);
  if (!summary) {
    try { fs.rmSync(tempDir, { recursive:true, force:true }); } catch (_) {}
    const detail = String((raw && raw.stderr) || '').replace(/\s+/g, ' ').trim();
    throw new ModelQueryError(
      `Model sorgusundan okunabilir bir sonuç dönmedi.${detail ? ` Ayrıntı: ${detail.slice(0, 300)}` : ''}`,
      'MODEL_QUERY_NO_RESULT', 502);
  }
  if (!summary.ok) {
    try { fs.rmSync(tempDir, { recursive:true, force:true }); } catch (_) {}
    const detail = String(summary.error || 'Model sorgusu başarısız oldu.').replace(/\s+/g, ' ').trim();
    // Sunucunun bellek hatası genellikle sorgunun ürettiği ara sonucun çok büyük
    // olmasından gelir; "sonra tekrar deneyin" mesajı tek başına yanıltıcıdır.
    const outOfMemory = /not enough memory|yeterli bellek|memory (?:limit|error)/i.test(detail);
    throw new ModelQueryError(
      `${detail}${summary.hint ? ` (${summary.hint})` : ''}` +
      (outOfMemory
        ? ' — Bu hata çoğunlukla sunucunun anlık yükünden değil, sorgunun ürettiği ara sonucun çok büyük olmasından gelir. Kapsam koşullarını daraltmayı (sezon, tarih aralığı) ve gruplama alanlarından gereksiz olanları çıkarmayı deneyin.'
        : ''),
      outOfMemory ? 'MODEL_QUERY_OUT_OF_MEMORY' : 'MODEL_QUERY_FAILED', 502, { provider: summary.provider || '' });
  }
  return { ...summary, tempDir, format, timeoutMs };
}

// --- Sonucu satır olarak okuma ----------------------------------------------
// runModelQuery yalnız bir önizleme döndürür (en fazla 50 satır). Şema keşfi için
// tüm satırlar gerekir; bu yardımcı sonucu hızlı CSV biçiminde geçici dosyaya yazdırıp
// okur, sonra geçici klasörü siler. Eski JSON test çıktıları da otomatik tanınır.
async function runModelRows(input = {}, options = {}) {
  // Büyük model sonuçlarında JSON yazmak PowerShell tarafında her hücre için
  // ConvertTo-Json çağrısı gerektiriyordu ve yüz binlerce satırda yenilemeyi
  // belirgin biçimde yavaşlatıyordu. CSV yazımı akışsal ve çok daha hafiftir.
  // Eski test runner'ları JSON dosyası üretebildiği için dosya içeriği otomatik
  // algılanır; böylece geriye dönük uyumluluk korunur.
  const summary = await runModelQuery({ ...input, format: 'csv', previewRows: 0 }, options);
  let rows = [];
  // Ayrıştırma süresi ayrı ölçülür: yavaşlığın sunucuda mı, PowerShell yazımında mı,
  // yoksa Node tarafındaki ayrıştırmada mı olduğunu tahmin etmeden görebilmek için.
  const parseStart = Date.now();
  try {
    const raw = (await fs.promises.readFile(summary.outFile, 'utf8')).replace(/^\uFEFF/, '');
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('[')) rows = JSON.parse(raw);
    else {
      const parsed = await parseSemicolonCsvAsync(raw, { signal:options.signal });
      rows = parsed.rows;
      summary.uiBlockingMs = parsed.uiBlockingMs;
    }
  } catch (error) {
    if ((options.signal && options.signal.aborted) || (error && (error.name === 'AbortError' || error.code === 'REFRESH_CANCELLED'))) {
      throw new ModelQueryError('Yenileme kullanıcı tarafından durduruldu.', 'REFRESH_CANCELLED', 409);
    }
    rows = [];
  } finally {
    try { if (summary.tempDir) fs.rmSync(summary.tempDir, { recursive: true, force: true }); } catch (_) {}
  }
  const parseMs = Date.now() - parseStart;
  return { ...summary, parseMs, uiBlockingMs:Number(summary.uiBlockingMs) || 0, rows: Array.isArray(rows) ? rows : [] };
}

function parseCsvLine(line, delimiter = ';') {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { value += '"'; i++; continue; }
      if (ch === '"') { quoted = false; continue; }
      value += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { cells.push(value); value = ''; continue; }
    value += ch;
  }
  cells.push(value);
  return cells;
}

function parseSemicolonCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line, index, all) => line.length || index < all.length - 1);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i] && headers.length === 1) continue;
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = values[c] == null ? '' : values[c];
    rows.push(row);
  }
  return rows;
}

async function parseSemicolonCsvAsync(text, options = {}) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line, index, all) => line.length || index < all.length - 1);
  if (!lines.length) return { rows:[], uiBlockingMs:0 };
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  const yieldEvery = Math.max(50, Number(options.yieldEvery) || 1000);
  let chunkStarted = Date.now(), uiBlockingMs = 0;
  for (let i = 1; i < lines.length; i++) {
    if (options.signal && options.signal.aborted) throw cancelledError();
    if (!lines[i] && headers.length === 1) continue;
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = values[c] == null ? '' : values[c];
    rows.push(row);
    if (i % yieldEvery === 0) {
      uiBlockingMs = Math.max(uiBlockingMs, Date.now() - chunkStarted);
      await new Promise(resolve => setImmediate(resolve));
      chunkStarted = Date.now();
    }
  }
  uiBlockingMs = Math.max(uiBlockingMs, Date.now() - chunkStarted);
  return { rows, uiBlockingMs };
}

// --- Şema keşfi --------------------------------------------------------------
// TMSCHEMA_* görünümleri SUNUCU YÖNETİCİSİ yetkisi ister; normal bir okuma
// kullanıcısı bunlara erişemez ("needs to be an administrator to read the
// metadata"). Excel'in pivot alan listesini doldururken kullandığı MDSCHEMA_*
// görünümleri ise okuma yetkisiyle çalışır. Bu yüzden sırayla denenir ve ilk
// başarılı olan kullanılır.
const cleanName = value => String(value == null ? '' : value).replace(/^[[$]+|]+$/g, '').trim();

const TABLE_DISCOVERY_STRATEGIES = [
  {
    id: 'tmschema',
    note: 'TMSCHEMA_TABLES (yönetici yetkisi gerektirir)',
    query: 'SELECT [Name] FROM $SYSTEM.TMSCHEMA_TABLES',
    extract: rows => rows.map(row => cleanName(row.Name)),
  },
  {
    id: 'mdschema',
    note: 'MDSCHEMA_DIMENSIONS (Excel alan listesiyle aynı kaynak)',
    query: 'SELECT [DIMENSION_NAME], [DIMENSION_UNIQUE_NAME] FROM $SYSTEM.MDSCHEMA_DIMENSIONS',
    extract: rows => rows
      // "Measures" gerçek bir tablo değil, ölçülerin sanal boyutudur.
      .filter(row => cleanName(row.DIMENSION_UNIQUE_NAME).toLowerCase() !== 'measures')
      .map(row => cleanName(row.DIMENSION_NAME)),
  },
  {
    id: 'dbschema',
    note: 'DBSCHEMA_TABLES',
    query: 'SELECT [TABLE_NAME] FROM $SYSTEM.DBSCHEMA_TABLES',
    // Tabular modelde tablolar MDX tarafında "$Tablo" olarak görünebilir; baştaki
    // dolar işareti temizlenir ve sistem görünümleri elenir.
    extract: rows => rows.map(row => cleanName(row.TABLE_NAME))
      .filter(name => name && !/^\$?system/i.test(name)),
  },
];

function dedupeNames(list) {
  const seen = new Set();
  const out = [];
  for (const name of list) {
    const value = String(name || '').trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}

// Tablo adlarını bulana kadar stratejileri sırayla dener.
async function discoverTablesUncached(input = {}, options = {}) {
  const attempts = [];
  for (const strategy of TABLE_DISCOVERY_STRATEGIES) {
    try {
      const result = await runModelRows({
        server: input.server, catalog: input.catalog, query: strategy.query,
        maxRows: 20000, timeoutMs: input.timeoutMs || 60000,
      }, options);
      const tables = dedupeNames(strategy.extract(result.rows));
      attempts.push({ method: strategy.id, ok: true, count: tables.length });
      if (tables.length) {
        return { tables, method: strategy.id, methodNote: strategy.note, provider: result.provider, elapsedMs: result.elapsedMs, attempts };
      }
    } catch (err) {
      attempts.push({ method: strategy.id, ok: false, error: String(err && err.message || err) });
      // Bağlantı hiç kurulamıyorsa sıradaki görünümü denemenin anlamı yok.
      if (err && err.code === 'MODEL_QUERY_UNSUPPORTED') throw err;
    }
  }
  const lastError = [...attempts].reverse().find(item => !item.ok);
  throw new ModelQueryError(
    `Modeldeki tablolar listelenemedi. Son hata: ${lastError ? lastError.error : 'bilinmeyen'}`,
    'MODEL_SCHEMA_UNAVAILABLE', 502, { attempts });
}

// Modelin TAMAMININ şeması: bütün tabloların sütunları + bütün ölçüler.
//
// NEDEN İKİ AYRI GÖRÜNÜM: Tabular modelde "Sipariş Kod", "Sezon" gibi alanlar boyut
// SÜTUNUdur ve MDSCHEMA_HIERARCHIES'te görünür. "FOB Fiyatı", "Net Alım Sipariş
// Miktarı" gibi alanlar ise çoğu modelde ÖLÇÜdür (measure) ve yalnız
// MDSCHEMA_MEASURES'ta bulunur. Yalnız birine bakmak alanların yarısını kaçırır.
// Ölçüler ayrıca "ASAS / Miktarlar" gibi görüntü klasörlerinde gruplanır; klasör
// bilgisi kullanıcıya nerede durduklarını göstermek için taşınır.
/* SÜTUN VERİ TİPLERİ (v7.83).

   MDSCHEMA_HIERARCHIES sütunun ADINI verir, TİPİNİ vermez. Tip bilinmeyince
   filtre değerleri DAX'a metin olarak yazılıyordu ve sayısal bir sütuna
   `IN { "123" }` göndermek sorguyu tip hatasıyla düşürüyordu (filter-value-types.js).

   İKİ GÖRÜNÜM SIRAYLA DENENİR, çünkü yetkiler kuruluma göre değişiyor —
   tablo keşfinde zaten bu desen var. Tip bilgisi ZORUNLU DEĞİLDİR: hiçbiri
   okunamazsa şema eskisi gibi tipsiz döner ve çağıran taraf bugünkü
   davranışına düşer. Tip okunamadı diye şema keşfi başarısız SAYILMAZ. */
const COLUMN_TYPE_STRATEGIES = [
  {
    id: 'mdschema-levels',
    query: 'SELECT [DIMENSION_UNIQUE_NAME], [HIERARCHY_NAME], [LEVEL_NAME], [LEVEL_NUMBER], [LEVEL_DBTYPE] FROM $SYSTEM.MDSCHEMA_LEVELS',
    extract: rows => rows.map(row => ({
      table: cleanName(row.DIMENSION_UNIQUE_NAME),
      name: cleanName(row.HIERARCHY_NAME),
      level: cleanName(row.LEVEL_NAME),
      // "(All)" seviyesi gerçek bir sütun değildir ve tipi yanıltır.
      rank: Number(row.LEVEL_NUMBER) || 0,
      dataType: String(row.LEVEL_DBTYPE == null ? '' : row.LEVEL_DBTYPE).trim(),
    })).filter(entry => entry.rank > 0 && entry.dataType),
  },
  {
    id: 'dbschema-columns',
    query: 'SELECT [TABLE_NAME], [COLUMN_NAME], [DATA_TYPE] FROM $SYSTEM.DBSCHEMA_COLUMNS',
    extract: rows => rows.map(row => ({
      table: cleanName(row.TABLE_NAME),
      name: cleanName(row.COLUMN_NAME),
      level: '',
      rank: 1,
      dataType: String(row.DATA_TYPE == null ? '' : row.DATA_TYPE).trim(),
    })).filter(entry => entry.dataType && !/^\$?system/i.test(entry.table)),
  },
];

const columnTypeKey = (table, name) => `${String(table || '').trim().toLowerCase()}\u0000${String(name || '').trim().toLowerCase()}`;

async function discoverColumnTypes(input, options) {
  for (const strategy of COLUMN_TYPE_STRATEGIES) {
    try {
      const result = await runModelRows({
        server: input.server, catalog: input.catalog, query: strategy.query,
        generated: true, maxRows: 200000, timeoutMs: input.timeoutMs || 120000,
      }, options);
      const types = new Map();
      for (const entry of strategy.extract(result.rows || [])) {
        if (!entry.table || !entry.name) continue;
        const key = columnTypeKey(entry.table, entry.name);
        const current = types.get(key);
        /* Bir hiyerarşi birden çok seviye taşıyabilir. Sütunun kendisiyle aynı
           adı taşıyan seviye ONUN tipidir; yoksa en alttaki (en yüksek numara)
           seviye alınır. Rastgele bir seviyenin tipini almak, tarih hiyerarşisi
           gibi yapılarda yanlış tip üretirdi. */
        const exactLevel = entry.level && entry.level.toLowerCase() === entry.name.toLowerCase();
        if (!current || exactLevel || (!current.exactLevel && entry.rank > current.rank)) {
          types.set(key, { dataType: entry.dataType, rank: entry.rank, exactLevel });
        }
      }
      if (types.size) return { types, method: strategy.id };
    } catch (err) {
      if (err && err.code === 'MODEL_QUERY_UNSUPPORTED') throw err;
      // Bu görünüm okunamadı; sıradakini dene.
    }
  }
  return { types: new Map(), method: '' };
}

async function discoverSchemaUncached(input = {}, options = {}) {
  const out = { columns: [], measures: [], errors: [] };

  try {
    const result = await runModelRows({
      server: input.server, catalog: input.catalog,
      query: 'SELECT [DIMENSION_UNIQUE_NAME], [HIERARCHY_NAME] FROM $SYSTEM.MDSCHEMA_HIERARCHIES',
      generated: true, maxRows: 200000, timeoutMs: input.timeoutMs || 120000,
    }, options);
    const seen = new Set();
    for (const row of result.rows) {
      const table = cleanName(row.DIMENSION_UNIQUE_NAME);
      const name = cleanName(row.HIERARCHY_NAME);
      if (!table || !name || table.toLowerCase() === 'measures') continue;
      const key = `${table}\u0000${name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.columns.push({ table, name, kind: 'column' });
    }
    out.provider = result.provider;
  } catch (err) { out.errors.push({ source: 'columns', error: String(err && err.message || err) }); }

  try {
    const result = await runModelRows({
      server: input.server, catalog: input.catalog,
      query: 'SELECT [MEASUREGROUP_NAME], [MEASURE_NAME], [MEASURE_DISPLAY_FOLDER] FROM $SYSTEM.MDSCHEMA_MEASURES',
      generated: true, maxRows: 200000, timeoutMs: input.timeoutMs || 120000,
    }, options);
    const seen = new Set();
    for (const row of result.rows) {
      const name = cleanName(row.MEASURE_NAME);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.measures.push({
        table: cleanName(row.MEASUREGROUP_NAME),
        folder: String(row.MEASURE_DISPLAY_FOLDER == null ? '' : row.MEASURE_DISPLAY_FOLDER).trim(),
        name, kind: 'measure',
      });
    }
    out.provider = out.provider || result.provider;
  } catch (err) { out.errors.push({ source: 'measures', error: String(err && err.message || err) }); }

  /* Sütun tipleri ayrı bir görünümden gelir ve BEST-EFFORT'tur: okunamazsa
     şema tipsiz döner, filtre üreticisi bugünkü davranışına düşer. Tip için
     şema keşfini düşürmek, çalışan bir yenilemeyi tip metadata'sı yüzünden
     durdurmak olurdu. */
  try {
    const discovered = await discoverColumnTypes(input, options);
    if (discovered.types.size) {
      for (const column of out.columns) {
        const hit = discovered.types.get(columnTypeKey(column.table, column.name));
        if (hit && hit.dataType) column.dataType = hit.dataType;
      }
      out.columnTypeMethod = discovered.method;
    }
  } catch (err) { out.errors.push({ source: 'columnTypes', error: String(err && err.message || err) }); }

  if (!out.columns.length && !out.measures.length) {

    throw new ModelQueryError(
      `Model şeması okunamadı. ${out.errors.map(item => item.error).join(' | ') || ''}`.trim(),
      'MODEL_SCHEMA_UNAVAILABLE', 502, { errors: out.errors });
  }
  return out;
}

// Seçilen tablonun sütunları. MDSCHEMA_HIERARCHIES, Excel'in alan listesinde
// gördüğün sütunların ta kendisidir ve okuma yetkisiyle erişilebilir.
async function discoverColumnsUncached(input = {}, options = {}) {
  const table = String(input.table || '').trim();
  if (!table) throw new ModelQueryError('Tablo adı boş.', 'VALIDATION_ERROR', 400);
  const result = await runModelRows({
    server: input.server, catalog: input.catalog,
    query: 'SELECT [DIMENSION_UNIQUE_NAME], [HIERARCHY_NAME] FROM $SYSTEM.MDSCHEMA_HIERARCHIES',
    maxRows: 50000, timeoutMs: input.timeoutMs || 60000,
  }, options);
  const wanted = table.toLowerCase();
  const columns = dedupeNames(result.rows
    .filter(row => cleanName(row.DIMENSION_UNIQUE_NAME).toLowerCase() === wanted)
    .map(row => cleanName(row.HIERARCHY_NAME)));
  return { table, columns, provider: result.provider, elapsedMs: result.elapsedMs };
}

// Metadata taramaları model sunucusunda pahalıdır. Aynı bağlantı için Source,
// Matching Rule ve Data Model Connection pencereleri peş peşe açıldığında aynı
// DMV sorgularını tekrar çalıştırmak yerine sonucu 10 dakika paylaşırız. Testlerde
// runner enjekte edildiğinde cache devre dışıdır; test izolasyonu korunur.
const METADATA_CACHE_TTL_MS = 10 * 60 * 1000;
const metadataCache = new Map();
const metadataPending = new Map();
function metadataCacheKey(kind, input) {
  return [kind, String(input && input.server || '').trim().toLowerCase(), String(input && input.catalog || '').trim().toLowerCase(), String(input && input.table || '').trim().toLowerCase()].join('|');
}
function cloneMetadata(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
async function cachedMetadata(kind, input, options, loader) {
  if (options && options.runner) return loader();
  const key = metadataCacheKey(kind, input);
  const hit = metadataCache.get(key);
  if (hit && Date.now() - hit.at < METADATA_CACHE_TTL_MS) return cloneMetadata(hit.value);
  if (metadataPending.has(key)) return cloneMetadata(await metadataPending.get(key));
  const pending = Promise.resolve().then(loader).then(value => {
    metadataCache.set(key, { at: Date.now(), value: cloneMetadata(value) });
    return value;
  }).finally(() => metadataPending.delete(key));
  metadataPending.set(key, pending);
  return cloneMetadata(await pending);
}
function discoverTables(input = {}, options = {}) {
  return cachedMetadata('tables', input, options, () => discoverTablesUncached(input, options));
}
function discoverSchema(input = {}, options = {}) {
  return cachedMetadata('schema', input, options, () => discoverSchemaUncached(input, options));
}
function discoverColumns(input = {}, options = {}) {
  return cachedMetadata('columns', input, options, () => discoverColumnsUncached(input, options));
}
function clearMetadataCache() { metadataCache.clear(); metadataPending.clear(); }

// --- Hazır sorgular ----------------------------------------------------------
function tablesQuery() {
  return TABLE_DISCOVERY_STRATEGIES[0].query;
}
function columnsQuery() {
  return 'SELECT [DIMENSION_UNIQUE_NAME], [HIERARCHY_NAME] FROM $SYSTEM.MDSCHEMA_HIERARCHIES';
}
// Bir tablonun ilk N satırını getiren güvenli DAX. Tablo adındaki tek tırnak kaçırılır.
function sampleQuery(tableName, topN = 20) {
  const safe = String(tableName || '').replace(/'/g, "''");
  const count = Math.min(500, Math.max(1, Number(topN) || 20));
  return `EVALUATE TOPN(${count}, '${safe}')`;
}

module.exports = {
  ModelQueryError,
  MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_QUERY_LENGTH, MAX_GENERATED_QUERY_LENGTH,
  validateName, validateQuery, clampTimeout, parseSummary,
  runModelQuery, runModelRows, parseCsvLine, parseSemicolonCsv, parseSemicolonCsvAsync, discoverTables, discoverColumns, discoverSchema,
  COLUMN_TYPE_STRATEGIES, discoverColumnTypes,
  TABLE_DISCOVERY_STRATEGIES, dedupeNames, METADATA_CACHE_TTL_MS, clearMetadataCache,
  tablesQuery, columnsQuery, sampleQuery,
};
