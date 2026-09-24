'use strict';

const canonicalFields = require('./canonical-fields');
const moduleRegistry = require('./module-registry');
// Eylem listesi istemciyle TEK kaynaktan paylaşılır; kopyalamak iki doğru yaratırdı.
const copilotActions = require('../../public/copilot-actions.js');

const DATASET_SOURCES = Object.freeze(['cp', 'orders', 'backlog', 'lfl', 'collection', 'asas', 'ias']);
const TIME_ZONE_ALIASES = Object.freeze({
  BANGLADESH: 'Asia/Dhaka', BANGLADES: 'Asia/Dhaka', DHAKA: 'Asia/Dhaka',
  TURKIYE: 'Europe/Istanbul', TURKEY: 'Europe/Istanbul', ISTANBUL: 'Europe/Istanbul',
  'UNITED KINGDOM': 'Europe/London', UK: 'Europe/London', LONDON: 'Europe/London',
  JAPAN: 'Asia/Tokyo', TOKYO: 'Asia/Tokyo', CHINA: 'Asia/Shanghai', BEIJING: 'Asia/Shanghai',
  INDIA: 'Asia/Kolkata', DELHI: 'Asia/Kolkata', PAKISTAN: 'Asia/Karachi',
  GERMANY: 'Europe/Berlin', FRANCE: 'Europe/Paris', USA: 'America/New_York',
  'UNITED STATES': 'America/New_York', 'NEW YORK': 'America/New_York',
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
// Yerel gece yarısına ayarlı bir Date'te toISOString() UTC'ye çevirir; UTC+X saat
// dilimlerinde bu bir gün geriye kayar. Takvim günü doğrudan yerel bileşenlerden
// okunur ki karşılaştırma ve filtre sınırları gerçek günle aynı olsun.
function calendarDayISO(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}
function comparable(value) {
  if (value instanceof Date) return calendarDayISO(value);
  return value == null ? '' : value;
}
function text(value) { return clean(comparable(value)).toLocaleLowerCase('tr-TR'); }
function getField(row, field) {
  const key = clean(field); if (!key) return undefined;
  if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const wanted = key.toLocaleLowerCase('tr-TR');
  const found = Object.keys(row || {}).find(name => name.toLocaleLowerCase('tr-TR') === wanted);
  return found ? row[found] : undefined;
}
function sourceId(value) {
  const source = clean(value).toLowerCase();
  // Hata mesajı GEÇERLİ listeyi taşımalı: ajan modül kimliğini (koleksiyon,
  // priceanalysis) dataset kimliği sanıp tur tur deniyordu.
  if (!DATASET_SOURCES.includes(source)) throw Object.assign(new Error(`Desteklenmeyen dataset: "${source}". Geçerli datasetler: ${DATASET_SOURCES.join(', ')}. Modül kimliği (ör. koleksiyon, priceanalysis) dataset DEĞİLDİR; modülün datasets listesine bakın.`), { code: 'DATASET_INVALID' });
  return source;
}
function fieldNames(rows) {
  return [...new Set((Array.isArray(rows) ? rows.slice(0, 240) : []).flatMap(row => Object.keys(row || {})))].slice(0, 320);
}
function resolveDatasetField(source, rows, fieldRef) {
  const ref = clean(fieldRef);
  if (!ref) throw Object.assign(new Error('Alan adı zorunludur.'), { code: 'DATASET_FIELD_REQUIRED' });
  const names = fieldNames(rows), canonicalId = canonicalFields.field(ref) ? ref : canonicalFields.canonicalId(source, ref);
  const binding = canonicalId && canonicalFields.bindingFor(source, canonicalId);
  if (binding) {
    const sourceKey = (binding.keys || []).find(key => names.some(name => canonicalFields.token(name) === canonicalFields.token(key))) || (binding.keys || [])[0] || ref;
    const definition = canonicalFields.field(canonicalId) || {};
    return { ref, canonicalId, sourceKey, label: canonicalFields.label(canonicalId, 'tr'), type: definition.type || 'text', role: definition.role || 'attribute' };
  }
  const wanted = canonicalFields.token(ref);
  const sourceKey = names.find(name => canonicalFields.token(name) === wanted);
  if (!sourceKey) {
    /* Geçerli alanlar mesajın İÇİNDE verilir: modelin ayrıca describe çağırıp
       bir tur daha harcaması gerekmesin. Liste kırpılır — 300 sütunlu bir
       tabloda mesaj bağlamı boğardı. */
    const available = names.slice(0, 40);
    const suffix = names.length > available.length ? ` (+${names.length - available.length} tane daha; tamamı için dataset.describe)` : '';
    throw Object.assign(new Error(`Dataset alanı bulunamadı: ${ref}. "${source}" datasetindeki gerçek alanlar: ${available.join(', ')}${suffix}`),
      { code: 'DATASET_FIELD_NOT_FOUND', details: { source, field: ref, available } });
  }
  return { ref, canonicalId: null, sourceKey, label: sourceKey, type: 'unknown', role: 'attribute' };
}
function resolvedValue(row, source, resolved) {
  if (resolved && resolved.canonicalId && canonicalFields.bindingFor(source, resolved.canonicalId)) return canonicalFields.value(row, source, resolved.canonicalId);
  return getField(row, resolved && resolved.sourceKey);
}
function resolveFilters(source, rows, filters, now = new Date()) {
  return (Array.isArray(filters) ? filters : []).slice(0, 20).map(rule => {
    const resolved = resolveDatasetField(source, rows, rule && rule.field);
    const rawValue = rule && rule.value;
    /* Model tutarlı biçimde "values" dizisi gönderiyor; şema "value" diyor.
       Reddetmek yerine kabul ediyoruz — anlam belirsiz değil, yalnız isim farkı. */
    const supplied = rawValue === undefined && rule && rule.values !== undefined ? rule.values : rawValue;
    const value = supplied === '@today' ? calendarDayISO(now) : supplied;
    return { resolved, operator: clean(rule && rule.operator) || 'eq', value };
  });
}
/* Sıfır eşleşmede, filtrelenen alanların GERÇEK değerlerini toplar.
   Canlı koşuda model durum değerlerini tahmin etti (closed/open/active/…),
   beşi de yoktu, her seferinde "0 satır" aldı ve tur bütçesini yaktı.
   Alan adlarında işe yarayan ilke: cevabı sonucun içine koy.
   Kardinalitesi yüksek alanlar atlanır — 200 farklı sipariş kodu listelemek
   modele yardım etmez, bağlamı şişirir. */
function zeroMatchHint(source, rows, filters, now) {
  let rules = [];
  try { rules = resolveFilters(source, rows, filters, now); } catch (_) { return null; }
  if (!rules.length || !Array.isArray(rows) || !rows.length) return null;
  const fields = rules.map(rule => {
    const values = [...new Set(rows.map(row => clean(resolvedValue(row, source, rule.resolved))).filter(Boolean))];
    if (!values.length || values.length > 25) return null;
    return { field: rule.resolved.sourceKey, label: rule.resolved.label, requested: rule.value, actualValues: values.slice(0, 25) };
  }).filter(Boolean);
  if (!fields.length) return null;
  return { fields, note: "Hiçbir satır eşleşmedi. Yukarıda o alanların GERÇEK değerleri var — filtre değerini bunlardan biriyle değiştir. Değer TAHMİN ETME." };
}
function applyResolvedFilters(source, rows, filters, now) {
  const rules = resolveFilters(source, rows, filters, now);
  if (!rules.length) return rows.slice();
  return rows.filter(row => rules.every(rule => compare(resolvedValue(row, source, rule.resolved), rule.operator, rule.value)));
}
/* Modelin görebilmesi için tek listede: hata mesajı ve inputSchema aynı
   kaynaktan beslenir, ayrışamazlar. */
/* Dizi ya da ayraçlı metin — model ikisini de gönderiyor, ikisi de anlamlı. */
function listValues(raw) {
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean);
  return String(raw == null ? '' : raw).split(/[\n,;|]+/).map(text).filter(Boolean);
}
const SUPPORTED_OPERATORS = Object.freeze(['eq', 'neq', 'contains', 'starts_with', 'in', 'not_in', 'empty', 'not_empty', 'gt', 'gte', 'lt', 'lte']);
function compare(leftRaw, operator, rightRaw) {
  const left = comparable(leftRaw), right = comparable(rightRaw), l = text(left), r = text(right);
  const ln = Number(left), rn = Number(right);
  const bothNumbers = left !== '' && right !== '' && Number.isFinite(ln) && Number.isFinite(rn);
  const ld = Date.parse(String(left)), rd = Date.parse(String(right));
  const bothDates = !bothNumbers && Number.isFinite(ld) && Number.isFinite(rd);
  const cmp = bothNumbers ? (ln === rn ? 0 : ln > rn ? 1 : -1) : bothDates ? (ld === rd ? 0 : ld > rd ? 1 : -1) : l.localeCompare(r, 'tr-TR', { numeric: true, sensitivity: 'base' });
  switch (operator) {
    case 'eq': case 'equals': case '=': case '==': case '===': return l === r;
    case 'neq': case 'not_equals': case '!=': case '<>': case '!==': return l !== r;
    case 'contains': return l.includes(r);
    case 'starts_with': return l.startsWith(r);
    case 'in': return listValues(rightRaw).includes(l);
    /* 'in' vardı ama olumsuzu yoktu; model "not in" yazıp hata alıyordu.
       Gerçek bir yetenek eksiğiydi, kılıf değil. */
    case 'not_in': case 'not in': case 'nin': return !listValues(rightRaw).includes(l);
    case 'empty': return !clean(left);
    case 'not_empty': return Boolean(clean(left));
    case 'gt': case '>': return cmp > 0;
    case 'gte': case '>=': return cmp >= 0;
    case 'lt': case '<': return cmp < 0;
    case 'lte': case '<=': return cmp <= 0;
    default:
      /* Sessizce eşittire düşmek YASAK: bilinmeyen bir operatör, sorulanın
         tersini döndürüp fark edilmeden geçebilir. */
      throw Object.assign(new Error(`Desteklenmeyen filtre operatörü: "${operator}". Geçerli olanlar: ${SUPPORTED_OPERATORS.join(', ')}.`),
        { code: 'FILTER_OPERATOR_INVALID', details: { operator, supported: SUPPORTED_OPERATORS } });
  }
}
function filterRows(rows, filters) {
  const list = Array.isArray(filters) ? filters.slice(0, 20) : [];
  if (!list.length) return rows.slice();
  return rows.filter(row => list.every(rule => compare(getField(row, rule && rule.field), clean(rule && rule.operator) || 'eq', rule && rule.value)));
}
function projectRows(rows, fields) {
  const selected = (Array.isArray(fields) ? fields : []).map(clean).filter(Boolean).slice(0, 40);
  if (!selected.length) return rows.map(row => clone(row));
  return rows.map(row => Object.fromEntries(selected.map(field => [field, comparable(getField(row, field))])));
}
function number(value) {
  return numericOrNull(value) ?? 0;
}
function numericOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const input = String(value == null ? '' : value).trim();
  if (!input) return null;
  const parsed = Number(input.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function calculateExpression(expression) {
  let input = clean(expression);
  if (!input || input.length > 300) throw Object.assign(new Error('Hesaplama ifadesi 1-300 karakter olmalıdır.'), { code: 'CALCULATION_INVALID' });
  if (input.includes(',') && !input.includes('.')) input = input.replace(/,/g, '.');
  const tokens = []; let index = 0;
  while (index < input.length) {
    const rest = input.slice(index), space = /^\s+/.exec(rest);
    if (space) { index += space[0].length; continue; }
    const value = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    if (value) { tokens.push({ type: 'number', value: Number(value[0]) }); index += value[0].length; continue; }
    const operator = /^[()+\-*/%^]/.exec(rest);
    if (operator) { tokens.push({ type: operator[0], value: operator[0] }); index += 1; continue; }
    throw Object.assign(new Error(`Hesaplama ifadesinde desteklenmeyen karakter: ${rest[0]}`), { code: 'CALCULATION_INVALID' });
  }
  let cursor = 0;
  const peek = type => tokens[cursor] && tokens[cursor].type === type;
  const take = type => { if (!peek(type)) throw Object.assign(new Error(`Hesaplama ifadesi geçersiz; ${type} bekleniyordu.`), { code: 'CALCULATION_INVALID' }); return tokens[cursor++]; };
  function primary() {
    if (peek('number')) return take('number').value;
    if (peek('(')) { take('('); const value = expressionValue(); take(')'); return value; }
    throw Object.assign(new Error('Hesaplama ifadesi geçersiz.'), { code: 'CALCULATION_INVALID' });
  }
  function unary() { if (peek('+')) { take('+'); return unary(); } if (peek('-')) { take('-'); return -unary(); } return primary(); }
  function power() { let value = unary(); if (peek('^')) { take('^'); value = Math.pow(value, power()); } return value; }
  function term() {
    let value = power();
    while (peek('*') || peek('/') || peek('%')) {
      const op = tokens[cursor++].type, right = power();
      if ((op === '/' || op === '%') && right === 0) throw Object.assign(new Error('Sıfıra bölme yapılamaz.'), { code: 'CALCULATION_INVALID' });
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  }
  function expressionValue() { let value = term(); while (peek('+') || peek('-')) { const op = tokens[cursor++].type, right = term(); value = op === '+' ? value + right : value - right; } return value; }
  const value = expressionValue();
  if (cursor !== tokens.length || !Number.isFinite(value)) throw Object.assign(new Error('Hesaplama sonucu geçersiz.'), { code: 'CALCULATION_INVALID' });
  return value;
}
function resolveTimeZone(args = {}) {
  const explicit = clean(args.timeZone || args.timezone);
  if (explicit) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: explicit }).format(new Date()); return explicit; }
    catch (_) { throw Object.assign(new Error('Geçersiz IANA saat dilimi.'), { code: 'TIMEZONE_INVALID' }); }
  }
  const place = canonicalFields.token(args.place || args.location);
  const zone = TIME_ZONE_ALIASES[place];
  if (!zone) throw Object.assign(new Error(`Saat dilimi çözülemedi: ${clean(args.place || args.location)}`), { code: 'TIMEZONE_UNRESOLVED' });
  return zone;
}
function localDateTime(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
function datasetScope(source, rows, horizon) {
  const seasons = [...new Set((Array.isArray(horizon && horizon.seasons) ? horizon.seasons : []).map(clean).filter(Boolean))];
  const present = [...new Set((Array.isArray(rows) ? rows : []).map(row => clean(canonicalFields.value(row, source, 'season'))).filter(Boolean))];
  const outsideSeasons = seasons.length ? present.filter(value => !seasons.includes(value)) : [];
  return { horizonSeasons: seasons, outsideHorizon: outsideSeasons.length > 0, outsideSeasons, policy: clean(horizon && horizon.outsideHorizon) || 'allow' };
}
function summarize(value) {
  if (Array.isArray(value)) return { type: 'array', count: value.length, sample: value.slice(0, 5) };
  if (value && typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 30), value };
  return { type: typeof value, value };
}

function createToolRegistry(adapter) {
  const tools = new Map();
  function register(meta, execute, rollback = null) {
    tools.set(meta.id, { ...meta, execute, rollback });
  }

  register({
    id: 'module.catalog', label: 'Buyer Log Module Catalog', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Kullanıcının erişebildiği Buyer Log modüllerini TAM kayıtlarıyla listeler: veri kümeleri, yetenekler, ekran ve filtrelenebilirlik. Bu çıktı module.describe ile aynı bilgiyi zaten içerir — modülleri tek tek describe ETME. Nereden başlayacağını bilmediğinde ÖNCE bunu çağır.',
    inputSchema: {},
  }, async (_args, ctx) => {
    // Yetkisi olmayan modül hiç görünmemeli: ajan "yapabilirim" deyip 403 almasın.
    const modules = moduleRegistry.catalog(clean(ctx && ctx.language) === 'en' ? 'en' : 'tr', ctx && ctx.profile, adapter.userAccess || null);
    return { modules, capabilities: moduleRegistry.CAPABILITIES };
  });

  register({
    id: 'module.describe', label: 'Describe Buyer Log Module', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'TEK bir modülün kaydını verir. module.catalog zaten hepsini döndürdüğü için, catalog çağırdıysan buna İHTİYACIN YOK — yalnız doğrudan tek bir modül adı verildiğinde kullan.',
    inputSchema: { module: 'cp|orders|koleksiyon|shipping|lfl|overview|priceanalysis|opencosting|backlog|automations|source|agents' },
  }, async (args, ctx) => {
    const id = clean(args && args.module);
    const described = moduleRegistry.describe(id, clean(ctx && ctx.language) === 'en' ? 'en' : 'tr');
    if (!described) {
      throw Object.assign(new Error(`Bilinmeyen modül: ${id}. module.catalog ile mevcut modülleri listeleyin.`), { code: 'MODULE_NOT_FOUND' });
    }
    // Erişimi olmayan modülün ayrıntısı da verilmemeli.
    const access = adapter.userAccess;
    if (access && typeof access.hasArea === 'function') {
      const module = moduleRegistry.get(id);
      if (!access.hasArea(ctx && ctx.profile, module.area)) {
        throw Object.assign(new Error(`${described.label} modülüne erişim yetkiniz yok.`), { code: 'AREA_FORBIDDEN' });
      }
    }
    return described;
  });

  register({
    id: 'dataset.catalog', label: 'Dataset Catalog', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Erişilebilir veri kümelerini SATIR SAYILARIYLA listeler. Herhangi bir veri sorgusundan ÖNCE bunu çağır: satır sayısı 0 olan bir kaynakta ne alan keşfedilebilir ne sorgu çalışır.',
    inputSchema: {},
  }, async (_args, ctx) => {
    const listed = typeof adapter.listDatasets === 'function' ? await adapter.listDatasets(ctx.ownerId, ctx.profile) : DATASET_SOURCES.map(id => ({ id, allowed: true }));
    const allowed = (Array.isArray(listed) ? listed : []).filter(item => item && item.allowed !== false);
    /* Satır sayısı KATALOGDA verilir: ajan boş bir kaynağı seçip alan adı
       tahmin etmeye çalışmasın. getDataContext ucuz olmalı; olmadığında
       sayı atlanır ve davranış eskisi gibi kalır. */
    const datasets = await Promise.all(allowed.map(async item => {
      const id = sourceId(item.id);
      let rows = null;
      if (typeof adapter.getDataContext === 'function') {
        try { rows = Number((await adapter.getDataContext(ctx.ownerId, ctx.profile, id) || {}).rowCount); } catch (_) { rows = null; }
      }
      return { id, area: clean(item.area), label: clean(item.label) || id, ...(Number.isFinite(rows) ? { rows, empty: rows === 0 } : {}) };
    }));
    return { datasets, note: 'Satır sayısı 0 olan dataset boştur; oradan alan keşfedilemez.' };
  });

  register({
    id: 'dataset.describe', label: 'Describe Dataset', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Seçilen Buyer Log datasetindeki alanları çalışma anında keşfeder ve ortak iş alanlarını canonical ID + module binding üzerinden çözer.',
    inputSchema: { source: 'cp|orders|backlog|lfl|collection' },
  }, async (args, ctx) => {
    const source = sourceId(args && args.source);
    const rows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const samples = Array.isArray(rows) ? rows.slice(0, 120) : [];
    const names = fieldNames(samples);
    const fields = names.map(sourceKey => {
      let resolved;
      try { resolved = resolveDatasetField(source, samples, sourceKey); } catch (_) { resolved = { canonicalId: null, sourceKey, label: sourceKey, type: 'unknown', role: 'attribute' }; }
      const values = samples.map(row => resolvedValue(row, source, resolved)).filter(value => value != null && value !== '').slice(0, 20);
      const kinds = new Set(values.map(value => value instanceof Date ? 'date' : Array.isArray(value) ? 'array' : typeof value));
      return { canonicalId: resolved.canonicalId, sourceKey: resolved.sourceKey, label: resolved.label, role: resolved.role, type: resolved.type, observedTypes: [...kinds].slice(0, 4), populatedInSample: values.length };
    });
    const context = typeof adapter.getDataContext === 'function' ? await adapter.getDataContext(ctx.ownerId, ctx.profile, source) : { source };
    const rowCount = Array.isArray(rows) ? rows.length : 0;
    const described = { source, rows: rowCount, fields, context, scope: datasetScope(source, rows, ctx.horizon) };
    if (!rowCount) {
      /* Alanlar örnek satırlardan çıkarıldığı için boş datasette alan listesi
         de boş olur. Bunu söylemeden döndürmek modeli ad tahminine iter. */
      described.empty = true;
      described.note = `"${source}" datasetinde hiç satır yok, bu yüzden alan listesi de boş — alan adı TAHMİN ETME. Dolu bir dataset seç: dataset.catalog satır sayılarını verir.`;
    }
    return described;
  });

  register({
    id: 'dataset.resolve_field', label: 'Resolve Dataset Field', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Doğal dildeki alan adını önce canonical registry ve module binding ile, gerekirse canlı şemadaki kesin başlıkla çözer.',
    inputSchema: { source: 'dataset', field: 'canonical ID, label or exact source field' },
  }, async (args, ctx) => {
    const source = sourceId(args && args.source), rows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const samples = Array.isArray(rows) ? rows.slice(0, 120) : [];
    /* Boş datasette alan çözümlemesi ANLAMSIZ: alan listesi örnek satırlardan
       çıkarılıyor. Bunu "bulunamadı" diye döndürmek modeli ad tahminine itiyor
       ve canlı koşuda 12 turun tamamı burada yandı. describe ile AYNI sinyal
       verilmeli — keşif araçları tutarlı konuşmalı. */
    if (!samples.length) {
      return {
        source, found: false, field: null, empty: true, requested: clean(args && args.field), available: [],
        note: `"${source}" datasetinde hiç satır yok, bu yüzden alan çözümlenemez. Bu datasette BAŞKA alan adı DENEME; dataset.catalog ile dolu bir kaynak seç.`,
      };
    }
    try {
      return { source, found: true, field: resolveDatasetField(source, samples, args && args.field) };
    } catch (error) {
      if (clean(error && error.code) !== 'DATASET_FIELD_NOT_FOUND') throw error;
      /* Çözemedik ama modeli boşluğa bırakmıyoruz: gerçek alanlar ve
         Türkçe etiketleriyle birlikte veriliyor ki eşlemeyi kendisi yapsın. */
      const names = fieldNames(samples);
      const options = names.slice(0, 60).map(sourceKey => {
        let label = sourceKey, canonicalId = null;
        try { const resolved = resolveDatasetField(source, samples, sourceKey); label = resolved.label; canonicalId = resolved.canonicalId; } catch (_) {}
        return { sourceKey, label, canonicalId };
      });
      return {
        source, found: false, field: null, requested: clean(args && args.field),
        available: options,
        note: `"${clean(args && args.field)}" bu datasette yok. Yukarıdaki listeden anlamca en yakın alanı seç (etiketler Türkçe) ve onunla devam et. Aynı adı tekrar sorma.`,
      };
    }
  });

  register({
    id: 'dataset.query', label: 'Dataset Query', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Buyer Log verisini güvenli yapılandırılmış filtrelerle sorgular; ortak alanları canonical binding üzerinden okur ve yalnız sınırlı satır döndürür.',
    inputSchema: { source: 'cp|orders|backlog|lfl|collection', filters: 'array', fields: 'array', limit: 'number' },
  }, async (args, ctx) => {
    const source = sourceId(args && args.source);
    const rows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const matched = applyResolvedFilters(source, Array.isArray(rows) ? rows : [], args && args.filters, ctx.now);
    const limit = Math.max(1, Math.min(500, Number(args && args.limit) || 100));
    const requested = (Array.isArray(args && args.fields) ? args.fields : []).map(clean).filter(Boolean).slice(0, 40);
    const resolved = requested.map(field => resolveDatasetField(source, rows, field));
    const projected = matched.slice(0, limit).map(row => requested.length
      ? Object.fromEntries(resolved.map(field => [field.canonicalId || field.sourceKey, comparable(resolvedValue(row, source, field))]))
      : canonicalFields.project(row, source, canonicalFields.moduleFields(source)));
    const context = typeof adapter.getDataContext === 'function' ? await adapter.getDataContext(ctx.ownerId, ctx.profile, source) : { source };
    const queryResult = { source, total: rows.length, matched: matched.length, rows: projected, truncated: matched.length > limit, context, scope: datasetScope(source, matched, ctx.horizon) };
    if (!matched.length && Array.isArray(args && args.filters) && args.filters.length) {
      const hint = zeroMatchHint(source, rows, args.filters, ctx.now);
      if (hint) queryResult.noMatchHint = hint;
    }
    return queryResult;
  });

  register({
    id: 'dataset.aggregate', label: 'Dataset Aggregate', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Dataset üzerinde group by, count, sum ve average hesaplar.',
    inputSchema: { source: 'dataset', filters: 'array', groupBy: 'field', metric: 'count|sum|avg', valueField: 'field' },
  }, async (args, ctx) => {
    const source = sourceId(args && args.source), allRows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const rows = applyResolvedFilters(source, allRows, args && args.filters, ctx.now);
    const groupBy = clean(args && args.groupBy), groupField = groupBy ? resolveDatasetField(source, allRows, groupBy) : null;
    const metric = ['sum', 'avg'].includes(clean(args && args.metric)) ? clean(args.metric) : 'count';
    const valueField = clean(args && args.valueField), valueResolved = valueField ? resolveDatasetField(source, allRows, valueField) : null, buckets = new Map();
    rows.forEach(row => {
      const group = groupField ? clean(resolvedValue(row, source, groupField)) || 'Belirtilmedi' : 'Tümü';
      const item = buckets.get(group) || { group, count: 0, numericCount: 0, total: 0 };
      item.count += 1;
      if (valueResolved) {
        const numeric = numericOrNull(resolvedValue(row, source, valueResolved));
        if (numeric != null) { item.total += numeric; item.numericCount += 1; }
      }
      buckets.set(group, item);
    });
    const result = [...buckets.values()].map(item => ({ group: item.group, count: item.count, value: metric === 'sum' ? item.total : metric === 'avg' ? (item.numericCount ? item.total / item.numericCount : null) : item.count }));
    const aggregateResult = { source, matched: rows.length, metric, groupBy: groupField && (groupField.canonicalId || groupField.sourceKey), rows: result.slice(0, 500), scope: datasetScope(source, rows, ctx.horizon) };
    // Sifir eslesmede gercek degerleri goster; query ile AYNI sinyal.
    if (!rows.length && Array.isArray(args && args.filters) && args.filters.length) {
      const hint = zeroMatchHint(source, allRows, args.filters, ctx.now);
      if (hint) aggregateResult.noMatchHint = hint;
    }
    return aggregateResult;
  });

  register({
    id: 'dataset.distinct', label: 'Distinct Dataset Values', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Bir alanın erişilebilir verideki benzersiz değerlerini ve frekanslarını döndürür.',
    inputSchema: { source: 'dataset', field: 'canonical ID or inspected field', filters: 'array', limit: 'number' },
  }, async (args, ctx) => {
    const source = sourceId(args && args.source), allRows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const rows = applyResolvedFilters(source, allRows, args && args.filters, ctx.now), field = resolveDatasetField(source, allRows, args && args.field), counts = new Map();
    rows.forEach(row => { const value = clean(resolvedValue(row, source, field)) || 'Belirtilmedi'; counts.set(value, (counts.get(value) || 0) + 1); });
    const limit = Math.max(1, Math.min(500, Number(args && args.limit) || 100));
    const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'tr-TR')).slice(0, limit);
    return { source, field: field.canonicalId || field.sourceKey, matchedRows: rows.length, values, truncated: counts.size > limit, scope: datasetScope(source, rows, ctx.horizon) };
  });

  register({
    id: 'dataset.analyze', label: 'Ad-hoc Dataset Analysis', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'İzinli Buyer Log verisini en fazla beş boyutta gruplar; count, sum, avg, min, max ve distinctCount ölçülerini ham satırları modele taşımadan hesaplar.',
    inputSchema: { source: 'dataset', filters: 'array', dimensions: 'field[]', measures: '{op,field?,as?}[]', orderBy: '{field,direction}[]', limit: 'number' },
  }, async (args, ctx) => {
    const source = sourceId(args && args.source), allRows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const rows = applyResolvedFilters(source, allRows, args && args.filters, ctx.now);
    const dimensionRefs = (Array.isArray(args && args.dimensions) ? args.dimensions : []).map(clean).filter(Boolean).slice(0, 5);
    const dimensions = dimensionRefs.map(ref => resolveDatasetField(source, allRows, ref));
    const measureSpecs = (Array.isArray(args && args.measures) && args.measures.length ? args.measures : [{ op: 'count', as: 'count' }]).slice(0, 8).map((raw, index) => {
      const op = clean(raw && raw.op);
      if (!['count', 'sum', 'avg', 'min', 'max', 'distinctCount'].includes(op)) throw Object.assign(new Error(`Desteklenmeyen analiz ölçüsü: ${op}`), { code: 'DATASET_MEASURE_INVALID' });
      const field = op === 'count' && !clean(raw && raw.field) ? null : resolveDatasetField(source, allRows, raw && raw.field);
      const as = clean(raw && raw.as) || (field ? `${op}_${field.canonicalId || field.sourceKey}` : index ? `count${index + 1}` : 'count');
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(as)) throw Object.assign(new Error('Ölçü adı yalnız harf, rakam ve alt çizgi içerebilir.'), { code: 'DATASET_MEASURE_INVALID' });
      return { op, field, as };
    });
    const buckets = new Map();
    rows.forEach(row => {
      const dimensionValues = dimensions.map(field => clean(resolvedValue(row, source, field)) || 'Belirtilmedi');
      const key = JSON.stringify(dimensionValues), bucket = buckets.get(key) || { dimensionValues, count: 0, measures: new Map() };
      bucket.count += 1;
      measureSpecs.forEach(spec => {
        const state = bucket.measures.get(spec.as) || { total: 0, count: 0, min: null, max: null, distinct: new Set() };
        const raw = spec.field ? resolvedValue(row, source, spec.field) : null;
        if (spec.op === 'count') state.count += 1;
        else if (spec.op === 'distinctCount') { if (raw != null && raw !== '') state.distinct.add(clean(raw)); }
        else if (raw != null && raw !== '') {
          const numeric = numericOrNull(raw);
          if (numeric != null) { state.total += numeric; state.count += 1; state.min = state.min == null ? numeric : Math.min(state.min, numeric); state.max = state.max == null ? numeric : Math.max(state.max, numeric); }
        }
        bucket.measures.set(spec.as, state);
      });
      buckets.set(key, bucket);
    });
    const output = [...buckets.values()].map(bucket => {
      const row = {};
      dimensions.forEach((field, index) => { row[field.canonicalId || field.sourceKey] = bucket.dimensionValues[index]; });
      measureSpecs.forEach(spec => { const state = bucket.measures.get(spec.as); row[spec.as] = spec.op === 'sum' ? state.total : spec.op === 'avg' ? (state.count ? state.total / state.count : null) : spec.op === 'min' ? state.min : spec.op === 'max' ? state.max : spec.op === 'distinctCount' ? state.distinct.size : state.count; });
      return row;
    });
    const orderBy = (Array.isArray(args && args.orderBy) ? args.orderBy : []).slice(0, 4);
    const defaultOrder = measureSpecs[0] ? [{ field: measureSpecs[0].as, direction: 'desc' }] : [];
    (orderBy.length ? orderBy : defaultOrder).reverse().forEach(rule => {
      const field = clean(rule && rule.field), direction = clean(rule && rule.direction).toLowerCase() === 'asc' ? 1 : -1;
      output.sort((a, b) => compare(a[field], 'gt', b[field]) ? direction : compare(a[field], 'lt', b[field]) ? -direction : 0);
    });
    const primary = measureSpecs[0] && measureSpecs[0].as, total = primary ? output.reduce((sum, row) => sum + number(row[primary]), 0) : 0;
    if (primary && total) output.forEach(row => { row[`${primary}SharePercent`] = number(row[primary]) / total * 100; });
    const currencies = [...new Set(rows.map(row => clean(getField(row, 'Currency') ?? getField(row, 'Para Birimi'))).filter(Boolean))].slice(0, 20);
    const limit = Math.max(1, Math.min(500, Number(args && args.limit) || 200));
    const context = typeof adapter.getDataContext === 'function' ? await adapter.getDataContext(ctx.ownerId, ctx.profile, source) : { source };
    const analyzeHint = (!rows.length && Array.isArray(args && args.filters) && args.filters.length) ? zeroMatchHint(source, allRows, args.filters, ctx.now) : null;
    return { source, ...(analyzeHint ? { noMatchHint: analyzeHint } : {}), matchedRows: rows.length, groupCount: output.length, rawRowsReturned: 0, dimensions: dimensions.map(field => field.canonicalId || field.sourceKey), measures: measureSpecs.map(spec => ({ op: spec.op, field: spec.field && (spec.field.canonicalId || spec.field.sourceKey), as: spec.as })), currencies, rows: output.slice(0, limit), truncated: output.length > limit, context, scope: datasetScope(source, rows, ctx.horizon) };
  });

  register({
    id: 'action.catalog', label: 'Available Change Actions', category: 'action', kind: 'action', risk: 'read', area: '', rollbackable: false,
    description: 'Kullanıcı adına önerebileceğin değişiklik türlerini ve her birinin gerektirdiği alanları listeler. Bir değişiklik yapman isteniyorsa ÖNCE bunu çağır.',
    inputSchema: {},
  }, async () => ({
    actions: Object.entries(copilotActions.ACTIONS).map(([id, definition]) => ({
      id, label: definition.label, area: definition.area, requiredFields: definition.fields,
    })),
    note: 'Bu eylemler doğrudan uygulanmaz; action.propose ile öneri üretilir ve kullanıcı onaylar.',
  }));

  register({
    id: 'action.propose', label: 'Propose a Change', category: 'action', kind: 'action', risk: 'propose', area: '', rollbackable: true,
    description: 'Kullanıcının onayına sunulacak bir değişiklik önerisi üretir. HİÇBİR ŞEY YAZMAZ — kullanıcı önizlemeyi görüp onaylarsa Buyer Log kendi kayıt yoluyla uygular.',
    inputSchema: { action: 'action.catalog çıktısındaki bir eylem kimliği', payload: 'eylemin gerektirdiği alanlar', reason: 'kullanıcıya gösterilecek kısa gerekçe' },
  }, async (args, ctx) => {
    const type = clean(args && args.action);
    const access = adapter.userAccess;
    const proposal = copilotActions.propose(
      { type, payload: (args && args.payload) || {}, reason: clean(args && args.reason) },
      { hasArea: area => !access || typeof access.hasArea !== 'function' ? true : access.hasArea(ctx && ctx.profile, area) },
    );
    if (!proposal.ok) {
      /* Reddi modele GÖZLEM olarak veriyoruz (fırlatmıyoruz) ki eksik alanı
         tamamlayıp yeniden önerebilsin; yetki reddi ise sınırdır ve durur. */
      if (proposal.area) throw Object.assign(new Error(proposal.reason), { code: 'AREA_FORBIDDEN' });
      throw Object.assign(new Error(proposal.reason), { code: 'PROPOSAL_INVALID', details: { missing: proposal.missing || [] } });
    }
    return { proposal };
  });

  register({
    id: 'ui.navigate', label: 'Open Buyer Log Screen', category: 'ui', kind: 'ui', risk: 'ui', area: '', rollbackable: true,
    description: 'Kullanıcıyı bir Buyer Log ekranına götürür. Analiz sonucunu kullanıcının kendi ekranında göstermek istediğinde kullan.',
    inputSchema: { module: 'module.catalog çıktısındaki bir modül kimliği' },
  }, async (args, ctx) => {
    const id = clean(args && args.module);
    const module = moduleRegistry.get(id);
    if (!module) throw Object.assign(new Error(`Bilinmeyen modül: ${id}. module.catalog ile listele.`), { code: 'MODULE_NOT_FOUND' });
    if (!module.route) throw Object.assign(new Error(`${module.id} bir ekran değil, gidilemez.`), { code: 'MODULE_NOT_NAVIGABLE' });
    const access = adapter.userAccess;
    if (access && typeof access.hasArea === 'function' && !access.hasArea(ctx && ctx.profile, module.area)) {
      throw Object.assign(new Error('Bu ekrana erişim yetkiniz yok.'), { code: 'AREA_FORBIDDEN' });
    }
    return { uiCommand: { command: 'navigate', module: module.id, route: module.route } };
  });

  register({
    id: 'ui.filter', label: 'Filter a Buyer Log Table', category: 'ui', kind: 'ui', risk: 'ui', area: '', rollbackable: true,
    description: 'Bir Buyer Log tablosuna sütun filtresi uygular ve kullanıcıyı o ekrana götürür. Birden çok koşul verebilirsin; "olmayan" için exclude:true kullan.',
    inputSchema: {
      module: 'modül kimliği',
      source: 'dataset kimliği (opsiyonel; modülün kendi dataseti varsayılan)',
      filters: '[{field, values:[...], exclude?:true}] — exclude:true "bu değerler DIŞINDAKİLER" demektir',
      field: 'tek koşullu kısayol (filters yerine)',
      values: 'tek koşullu kısayol',
    },
  }, async (args, ctx) => {
    const id = clean(args && args.module);
    const module = moduleRegistry.get(id);
    if (!module) throw Object.assign(new Error(`Bilinmeyen modül: ${id}. module.catalog ile listele.`), { code: 'MODULE_NOT_FOUND' });
    if (!module.agentFilter) {
      const supported = moduleRegistry.list().filter(item => item.agentFilter).map(item => item.id).join(', ');
      throw Object.assign(new Error(`${module.id} ekranını şu an filtreleyemiyorum. Filtreleyebildiğim ekranlar: ${supported}. Sonucu metin olarak özetle.`), { code: 'MODULE_NOT_FILTERABLE' });
    }
    const access = adapter.userAccess;
    if (access && typeof access.hasArea === 'function' && !access.hasArea(ctx && ctx.profile, module.area)) {
      throw Object.assign(new Error('Bu ekrana erişim yetkiniz yok.'), { code: 'AREA_FORBIDDEN' });
    }
    if (!module.tableKey) throw Object.assign(new Error(`${module.id} ekranında filtrelenecek bir tablo yok.`), { code: 'MODULE_NOT_FILTERABLE' });

    const requestedSource = clean(args && args.source);
    if (requestedSource && !module.datasets.includes(requestedSource.toLowerCase())) {
      throw Object.assign(new Error(`"${requestedSource}" ${module.id} ekranının veri kümesi değil. ${module.id} şunları taşıyor: ${module.datasets.join(', ')}.`), { code: 'DATASET_INVALID' });
    }
    const source = sourceId(requestedSource || module.datasets[0] || '');
    const rows = await adapter.getDataset(ctx.ownerId, ctx.profile, source);
    const samples = Array.isArray(rows) ? rows : [];

    // Tek koşullu kısayol da kabul edilir: model ikisini de üretiyor.
    const requested = Array.isArray(args && args.filters) && args.filters.length
      ? args.filters.slice(0, 6)
      : [{ field: args && args.field, values: args && args.values, exclude: args && args.exclude }];

    const columns = requested.map(rule => {
      const resolved = resolveDatasetField(source, samples.slice(0, 120), rule && rule.field);
      const wanted = (Array.isArray(rule && rule.values) ? rule.values : [rule && rule.values])
        .map(value => clean(value)).filter(Boolean).slice(0, 50);
      if (!wanted.length) throw Object.assign(new Error(`${resolved.label} için en az bir değer gerekli.`), { code: 'FILTER_VALUE_REQUIRED' });
      const actual = [...new Set(samples.map(row => clean(resolvedValue(row, source, resolved))).filter(Boolean))];
      const lower = new Set(wanted.map(value => value.toLocaleLowerCase('tr-TR')));
      const hits = actual.filter(value => lower.has(value.toLocaleLowerCase('tr-TR')));
      if (actual.length && !hits.length) {
        const sample = actual.slice(0, 25);
        throw Object.assign(new Error(`${resolved.label} alanında ${wanted.join(', ')} diye bir değer yok; filtre boş tablo gösterirdi. Gerçek değerler: ${sample.join(', ')}${actual.length > sample.length ? ' …' : ''}`),
          { code: 'FILTER_VALUE_NOT_FOUND', details: { field: resolved.sourceKey, requested: wanted, actualValues: sample } });
      }
      /* "Olmayan" tümleyene çevrilir: Buyer Log tablosunun filtresi bir değer
         kümesidir, olumsuzlama diye bir kipi yoktur. */
      const exclude = rule && rule.exclude === true;
      const values = exclude ? actual.filter(value => !lower.has(value.toLocaleLowerCase('tr-TR'))) : (hits.length ? hits : wanted);
      if (exclude && !values.length) {
        throw Object.assign(new Error(`${resolved.label} alanında ${wanted.join(', ')} dışında değer yok; dışlama filtresi boş tablo gösterirdi.`), { code: 'FILTER_VALUE_NOT_FOUND' });
      }
      const column = { field: resolved.sourceKey, canonicalId: resolved.canonicalId, label: resolved.label, values, exclude };
      if (!exclude && hits.length && hits.length < wanted.length) {
        column.ignoredValues = wanted.filter(value => !hits.some(hit => hit.toLocaleLowerCase('tr-TR') === value.toLocaleLowerCase('tr-TR')));
      }
      return column;
    });

    return {
      uiCommand: {
        command: 'filter', module: module.id, tableKey: module.tableKey, route: module.route, source,
        columns,
        // Tek sütunlu kısayol alanları, eski istemciler için korunur.
        field: columns[0].field, canonicalId: columns[0].canonicalId, label: columns[0].label, values: columns[0].values,
      },
      appliedColumns: columns.length,
    };
  });

  register({
    id: 'ui.clear_filters', label: 'Clear Table Filters', category: 'ui', kind: 'ui', risk: 'ui', area: '', rollbackable: true,
    description: 'Bir Buyer Log tablosundaki sütun filtrelerini temizler.',
    inputSchema: { module: 'modül kimliği' },
  }, async (args, ctx) => {
    const module = moduleRegistry.get(clean(args && args.module));
    if (!module) throw Object.assign(new Error('Bilinmeyen modül.'), { code: 'MODULE_NOT_FOUND' });
    const access = adapter.userAccess;
    if (access && typeof access.hasArea === 'function' && !access.hasArea(ctx && ctx.profile, module.area)) {
      throw Object.assign(new Error('Bu ekrana erişim yetkiniz yok.'), { code: 'AREA_FORBIDDEN' });
    }
    return { uiCommand: { command: 'clearFilters', module: module.id, tableKey: module.tableKey, route: module.route } };
  });

  /* MODEL GÖRSELLERİ — yapılandırılmış komut.
   *
   * Ajan DOM'a tıklamaz ve hedef modeli KENDİ seçmez: hangi kimlikler
   * işleneceğini istemcideki güncel görünüm çözümleyicisi belirler. Burada
   * yalnız NİYET doğrulanır (kaynak + kip) ve yetki kontrol edilir.
   *
   * Kaynak belirsizse zarf kaynaksız çıkar ve istemci kullanıcıya SORAR;
   * ASAS ile PLM birbirinin yerine sessizce geçemez. */
  register({
    id: 'ui.model_images', label: 'Update Model Images', category: 'ui', kind: 'ui', risk: 'ui', area: '', rollbackable: false,
    description: 'Güncel görünümdeki model görsellerini tamamlar veya yeniler. Hedef küme ekrandan gelir; kaynak ASAS ya da PLM olarak AÇIKÇA seçilir.',
    inputSchema: { module: 'modül kimliği (opsiyonel)', source: 'asas | plm (belirsizse kullanıcıya sorulur)', mode: 'missing | selected | all' },
  }, async (args, ctx) => {
    const moduleId = clean(args && args.module);
    const module = moduleId ? moduleRegistry.get(moduleId) : null;
    if (moduleId && !module) throw Object.assign(new Error('Bilinmeyen modül.'), { code: 'MODULE_NOT_FOUND' });
    const access = adapter.userAccess;
    if (module && access && typeof access.hasArea === 'function' && !access.hasArea(ctx && ctx.profile, module.area)) {
      throw Object.assign(new Error('Bu ekrana erişim yetkiniz yok.'), { code: 'AREA_FORBIDDEN' });
    }
    const source = clean(args && args.source).toLowerCase();
    const mode = clean(args && args.mode).toLowerCase();
    return {
      uiCommand: {
        command: 'modelImages',
        module: module ? module.id : '',
        route: module ? module.route : '',
        source: source === 'asas' || source === 'plm' ? source : '',
        mode: mode === 'all' || mode === 'selected' ? mode : 'missing',
      },
    };
  });

  register({
    id: 'system.calculate', label: 'Safe Calculator', category: 'system', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Temel aritmetik ifadeleri eval veya kod çalıştırmadan deterministik olarak hesaplar.',
    inputSchema: { expression: 'numbers, parentheses and + - * / % ^' },
  }, async args => ({ expression: clean(args && args.expression), value: calculateExpression(args && args.expression) }));

  register({
    id: 'system.datetime', label: 'Current Date and Time', category: 'system', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Sistem saatinden IANA saat dilimine göre güncel tarih ve saati üretir; desteklenen yer adlarını saat dilimine çözer.',
    inputSchema: { place: 'country or city', timeZone: 'optional IANA timezone' },
  }, async (args, ctx) => {
    const timeZone = resolveTimeZone(args || {}), now = ctx && ctx.now instanceof Date ? ctx.now : new Date();
    return { timeZone, localDateTime: localDateTime(now, timeZone), instant: now.toISOString(), source: 'system-clock' };
  });

  register({
    id: 'app.refresh', label: 'Refresh Buyer Log Data', category: 'app', kind: 'app', risk: 'operational', area: 'source', rollbackable: false,
    description: 'Buyer Log’un mevcut refresh mekanizmasını kullanır; business logic kopyalanmaz.',
    inputSchema: { targets: 'cp|orders|backlog|lfl[]' },
  }, async (args, ctx) => {
    const targets = (Array.isArray(args && args.targets) ? args.targets : []).map(clean).filter(value => ['cp', 'orders', 'backlog', 'lfl'].includes(value));
    if (ctx.dryRun) return { dryRun: true, action: 'refresh', targets: targets.length ? targets : ['cp', 'orders', 'backlog', 'lfl'] };
    return adapter.refresh(ctx.ownerId, ctx.profile, targets.length ? targets : null);
  });

  register({
    id: 'app.order.update', label: 'Update Order', category: 'app', kind: 'app', risk: 'write', area: 'cp', approval: true, rollbackable: true,
    approvalMessage: 'Sipariş üzerinde kullanıcı verisi değiştirilecek. Değişiklikleri uygulamadan önce onaylayın.',
    description: 'Mevcut Buyer Log order override servisinin izin verdiği alanları günceller.',
    inputSchema: { orderCode: 'number', model: 'string', ccode: 'string', notes: 'object', subManufacturer: 'string', licensor: 'string', delType: 'string', dates: 'object' },
  }, async (args, ctx) => {
    const patch = {};
    ['model', 'ccode', 'subManufacturer', 'licensor', 'delType'].forEach(key => { if (Object.prototype.hasOwnProperty.call(args || {}, key)) patch[key] = args[key]; });
    if (args && args.notes && typeof args.notes === 'object') patch.notes = args.notes;
    if (args && args.dates && typeof args.dates === 'object') patch.dates = args.dates;
    const orderCode = Number(args && args.orderCode);
    if (!Number.isFinite(orderCode)) throw Object.assign(new Error('Geçerli Order Code zorunlu.'), { code: 'ORDER_CODE_REQUIRED' });
    if (ctx.dryRun) return { dryRun: true, orderCode, patch };
    const before = await adapter.snapshotOrder(ctx.ownerId, ctx.profile, orderCode, patch);
    const result = await adapter.updateOrder(ctx.ownerId, ctx.profile, orderCode, patch);
    return { ...result, rollbackToken: { orderCode, before } };
  }, async (token, ctx) => adapter.restoreOrder(ctx.ownerId, ctx.profile, token && token.orderCode, token && token.before));

  register({
    id: 'report.summary', label: 'Build Result Summary', category: 'app', kind: 'transform', risk: 'read', rollbackable: false,
    description: 'Önceki node çıktısını kullanıcıya gösterilecek doğrulanabilir bir özet haline getirir.',
    inputSchema: { title: 'string' },
  }, async (args, ctx) => ({ title: clean(args && args.title) || 'Agent sonucu', summary: summarize(ctx.input), generatedAt: new Date().toISOString() }));

  register({
    id: 'connector.http', label: 'HTTP Connector', category: 'connector', kind: 'connector', risk: 'external', approval: true, rollbackable: false,
    approvalMessage: 'İzin verilen harici bir servise ağ isteği gönderilecek. URL ve payload’u kontrol edin.',
    description: 'Yalnız yapılandırılmış allowlist içindeki HTTPS hostlarına kontrollü istek gönderir.',
    inputSchema: { url: 'https URL', method: 'GET|POST|PUT|PATCH', headers: 'object', body: 'object|string' },
  }, async (args, ctx) => {
    if (ctx.dryRun) return { dryRun: true, url: clean(args && args.url), method: clean(args && args.method || 'GET').toUpperCase() };
    return adapter.httpRequest(args || {}, ctx);
  });


  register({
    id: 'connector.browser.run', label: 'Browser Automation', category: 'connector', kind: 'browser', risk: 'external', area: 'agents', approval: true, rollbackable: false,
    approvalMessage: 'Kaydedilmiş tarayıcı adımları harici web sitesinde uygulanacak. Hedef hostu ve tüm adımları kontrol edip onaylayın.',
    description: 'Buyer Log ile aynı yönetilen Edge penceresinde izinli siteyi yeni sekmede açar ve yalnız kayıtlı click/fill/select/press/check adımlarını tekrarlar. Arbitrary JavaScript çalıştırmaz.',
    inputSchema: { url: 'https URL', steps: 'recorded browser steps[]', items: 'optional array for batch replay', timeoutMs: 'number' },
  }, async (args, ctx) => {
    return adapter.browserRun(args || {}, ctx);
  });

  function catalog() {
    return [...tools.values()].map(({ execute, rollback, ...meta }) => clone(meta));
  }
  function get(id) { return tools.get(clean(id)) || null; }
  async function execute(id, args, ctx) { const tool = get(id); if (!tool) throw Object.assign(new Error(`Tool bulunamadı: ${id}`), { code: 'TOOL_NOT_FOUND' }); return tool.execute(args || {}, ctx || {}); }
  async function rollback(id, token, ctx) { const tool = get(id); if (!tool || typeof tool.rollback !== 'function') throw Object.assign(new Error('Bu tool rollback desteklemiyor.'), { code: 'ROLLBACK_UNSUPPORTED' }); return tool.rollback(token, ctx || {}); }
  return { catalog, get, execute, rollback };
}

module.exports = {
  createToolRegistry, filterRows, projectRows, compare, getField,
  calculateExpression, resolveDatasetField, applyResolvedFilters,
};
