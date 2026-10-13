'use strict';

const canonicalFields = require('./canonical-fields');
const moduleRegistry = require('./module-registry');
// Eylem listesi istemciyle TEK kaynaktan paylaşılır; kopyalamak iki doğru yaratırdı.

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
      return (Array.isArray(filters) ? filters : []).map(rule => {
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
    tools.set(meta.id, { ...meta, rollbackContract:typeof meta.rollback==='string'?meta.rollback:meta.rollbackContract, execute, rollback });
  }
  function executableFor(moduleId,ctx){
    const profile=adapter.userAccess?.profileById?adapter.userAccess.profileById(ctx?.ownerId):ctx?.profile;
    return [...tools.values()].filter(tool=>tool.module===moduleId&&require('./agent-capability-contract').allowed(tool,profile,adapter.userAccess)).map(({execute,rollback,...meta})=>clone(meta));
  }

  register({
    id: 'module.catalog', label: 'Buyer Log Module Catalog', category: 'query', kind: 'query', risk: 'read', area: '', rollbackable: false,
    description: 'Kullanıcının erişebildiği Buyer Log modüllerini TAM kayıtlarıyla listeler: veri kümeleri, yetenekler, ekran ve filtrelenebilirlik. Bu çıktı module.describe ile aynı bilgiyi zaten içerir — modülleri tek tek describe ETME. Nereden başlayacağını bilmediğinde ÖNCE bunu çağır.',
    inputSchema: {},
  }, async (_args, ctx) => {
    // Yetkisi olmayan modül hiç görünmemeli: ajan "yapabilirim" deyip 403 almasın.
    const modules = moduleRegistry.catalog(clean(ctx && ctx.language) === 'en' ? 'en' : 'tr', ctx && ctx.profile, adapter.userAccess || null);
    return { modules:modules.map(module=>({...module,agentTools:executableFor(module.id,ctx)})), capabilities: moduleRegistry.CAPABILITIES };
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
    return {...described,agentTools:executableFor(id,ctx)};
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
    id: 'app.order.update', label: 'Update Order', module:'orders', operation:'UPDATE', contractVersion:1, category: 'app', kind: 'app', risk: 'write', area: 'cp', areas:['cp'], approval: true, rollbackable: true,
    approvalMessage: 'Sipariş üzerinde kullanıcı verisi değiştirilecek. Değişiklikleri uygulamadan önce onaylayın.',
    description: 'Mevcut Buyer Log order override servisinin izin verdiği alanları günceller.',
    inputSchema: {type:'object',required:['orderCode','expectedRevision'],additionalProperties:false,properties:{orderCode:{type:'integer',minimum:1},expectedRevision:{type:'integer',minimum:0},model:{type:'string',maxLength:160},ccode:{type:'string',maxLength:80},notes:{type:'object',properties:Object.fromEntries(require('../db').NOTE_AUTHOR_FIELDS.map(spec=>[spec.field,{type:'string',maxLength:10000}])),additionalProperties:false},subManufacturer:{type:'string',maxLength:200},licensor:{type:'string',maxLength:200},delType:{type:'string',maxLength:80},dates:{type:'object',properties:Object.fromEntries(['exFactory','retailDate','inStoreDate'].map(key=>[key,{type:'string',pattern:'^(?:|\\d{4}-\\d{2}-\\d{2})$'}])),additionalProperties:false}}},
    outputSchema:{type:'object',required:['verified','revision','rollbackToken']},dryRunOutputSchema:{type:'object',required:['dryRun','orderCode','patch','revision']},
    dataScope:'current-IAM-editable-order',preview:'same-tool-dryRun',validation:'schema + existing order override service',audit:'AGENT_ORDER_UPDATE',idempotency:'expected order revision; interrupted effects require reconciliation',rollback:'restore only at effect revision',
  }, async (args, ctx) => {
    const patch = {};
    ['model', 'ccode', 'subManufacturer', 'licensor', 'delType'].forEach(key => { if (Object.prototype.hasOwnProperty.call(args || {}, key)) patch[key] = args[key]; });
    if (args && args.notes && typeof args.notes === 'object') patch.notes = args.notes;
    if (args && args.dates && typeof args.dates === 'object') patch.dates = args.dates;
    const orderCode = Number(args && args.orderCode);
    if (!Number.isFinite(orderCode)) throw Object.assign(new Error('Geçerli Order Code zorunlu.'), { code: 'ORDER_CODE_REQUIRED' });
    for(const date of Object.values(patch.dates||{}))if(date&&(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Object.assign(new Error('OFFICE_DATE_INVALID'),{code:'OFFICE_DATE_INVALID',statusCode:422});
    if(!['notes','dates','subManufacturer','licensor','delType'].some(key=>Object.hasOwn(patch,key)))throw Object.assign(new Error('OFFICE_TASK_INVALID'),{code:'OFFICE_TASK_INVALID',statusCode:422});
    const before = await adapter.snapshotOrder(ctx.ownerId, ctx.profile, orderCode, patch);
    if(before.revision!==args.expectedRevision)throw Object.assign(new Error('OFFICE_PREVIEW_CHANGED'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});
    if (ctx.dryRun) return { dryRun: true, orderCode, patch,revision:before.revision };
    ctx.assertAuthority();
    const result = await adapter.updateOrder(ctx.ownerId, ctx.profile, orderCode, patch,args.expectedRevision);
    if(result.verified!==true)throw Object.assign(new Error('OFFICE_ORDER_VERIFY_FAILED'),{code:'OFFICE_ORDER_VERIFY_FAILED',statusCode:409});
    return { ...result,verified:true, rollbackToken: { orderCode, before:before.patch,selector:{model:patch.model,ccode:patch.ccode},expectedRevision:result.revision } };
  }, async (token, ctx) => adapter.restoreOrder(ctx.ownerId, ctx.profile, token.orderCode, token.before,token.expectedRevision,token.selector));

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

  if (adapter.cp) require('./cp-agent-tools').registerCpTools(register, adapter.cp);
  if(adapter.getDataset)for(const [source,area,module]of [['cp','cp','cp'],['orders','orders','orders'],['backlog','backlog','backlog'],['lfl','lfl','lfl'],['collection','koleksiyon','koleksiyon']]){
    const {object,string,array}=require('./agent-capability-contract');
    require('./agent-capability-contract').register(register,{id:source+'.records',label:{tr:source+' kayıtları',en:source+' records'},module,operation:'READ',areas:[area],risk:'read',inputSchema:object({fields:array(string(160),200),filters:array({...object({field:string(160),operator:{enum:SUPPORTED_OPERATORS},value:{}}),required:['field','operator']},50),limit:{type:'integer',minimum:1,maximum:250}}),read:async(args,ctx)=>{
      const rows=await adapter.getDataset(ctx.ownerId,ctx.profile,source),matched=applyResolvedFilters(source,rows,args.filters,ctx.now),fields=args.fields?.length?args.fields:canonicalFields.moduleFields(source);
      // Canonical discovery is complete; record output is explicitly bounded,
      // while filtering/counting evaluates all authorized source rows.
      if(fields.some(field=>!canonicalFields.bindingFor(source,field)))throw Object.assign(new Error('OFFICE_FIELD_INVALID'),{code:'OFFICE_FIELD_INVALID',statusCode:422});
      const limit=args.limit||50;return{source,total:rows.length,matched:matched.length,rows:matched.slice(0,limit).map(row=>canonicalFields.project(row,source,fields)),truncated:matched.length>limit,fields:canonicalFields.moduleFields(source)};
    }},adapter.authorizeCapability);
  }

  function catalog() {
    return [...tools.values()].map(({ execute, rollback, ...meta }) => clone(meta));
  }
  function get(id) { return tools.get(clean(id)) || null; }
  async function execute(id, args, ctx) {
    const tool = get(id); if (!tool) throw Object.assign(new Error(`Tool bulunamadı: ${id}`), { code: 'TOOL_NOT_FOUND' });
    args=args||{};ctx=ctx||{};
    if(tool.contractVersion){
      require('./agent-tool-schema').validate(tool.inputSchema,args);
      const assertAuthority=()=>{
        const current=adapter.userAccess?.profileById?adapter.userAccess.profileById(ctx.ownerId):ctx.profile;
        if(!current||current.id!==ctx.ownerId||current.enabled===false||!(tool.areas||[tool.area]).filter(Boolean).every(area=>adapter.userAccess?.hasArea(current,area))||tool.anyAreas&&!tool.anyAreas.some(area=>adapter.userAccess?.hasArea(current,area))||(tool.permissions||[]).some(key=>!adapter.userAccess?.hasPermission(current,key))||(tool.capabilities||[]).some(key=>!adapter.userAccess?.hasCapability(current,key)))throw Object.assign(new Error('OFFICE_TOOL_FORBIDDEN'),{code:'OFFICE_TOOL_FORBIDDEN',statusCode:403});
        return current;
      };
      const profile=assertAuthority(),authorizationFingerprint=JSON.stringify(adapter.userAccess?.publicProfile?.(profile)||profile);
      const assertUnchanged=()=>{const current=assertAuthority();if(JSON.stringify(adapter.userAccess?.publicProfile?.(current)||current)!==authorizationFingerprint)throw Object.assign(new Error('OFFICE_PREVIEW_CHANGED'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});return current;};
      if(tool.approval&&!ctx.dryRun&&!ctx.approvalGranted)throw Object.assign(new Error('OFFICE_APPROVAL_REQUIRED'),{code:'OFFICE_APPROVAL_REQUIRED',statusCode:403});
      ctx={...ctx,profile,assertAuthority:assertUnchanged,toolId:id};
    }
    const result=await tool.execute(args,ctx);
    if(tool.contractVersion){require('./agent-tool-schema').validate(ctx.dryRun?tool.dryRunOutputSchema||tool.outputSchema:tool.outputSchema,result);adapter.userAccess.appendAudit(ctx.profile,tool.audit||'AGENT_CAPABILITY_TOOL',id,{runId:ctx.runId,nodeId:ctx.nodeId,dryRun:!!ctx.dryRun,verified:result.verified});}
    return result;
  }
  async function rollback(id, token, ctx) {
    const tool = get(id); if (!tool || typeof tool.rollback !== 'function') throw Object.assign(new Error('Bu tool rollback desteklemiyor.'), { code: 'ROLLBACK_UNSUPPORTED' });
    ctx=ctx||{};
    if(tool.contractVersion){
      const profile=adapter.userAccess?.profileById?adapter.userAccess.profileById(ctx.ownerId):ctx.profile;
      if(!profile||profile.id!==ctx.ownerId||profile.enabled===false||!ctx.approvalGranted||!(tool.areas||[tool.area]).filter(Boolean).every(area=>adapter.userAccess?.hasArea(profile,area))||(tool.permissions||[]).some(key=>!adapter.userAccess?.hasPermission(profile,key))||(tool.capabilities||[]).some(key=>!adapter.userAccess?.hasCapability(profile,key)))throw Object.assign(new Error('OFFICE_TOOL_FORBIDDEN'),{code:'OFFICE_TOOL_FORBIDDEN',statusCode:403});
      const fingerprint=JSON.stringify(adapter.userAccess?.publicProfile?.(profile)||profile);
      ctx={...ctx,profile,assertAuthority:()=>{
        const latest=adapter.userAccess?.profileById?adapter.userAccess.profileById(ctx.ownerId):profile;
        if(JSON.stringify(adapter.userAccess?.publicProfile?.(latest)||latest)!==fingerprint)throw Object.assign(new Error('OFFICE_PREVIEW_CHANGED'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});
        return latest;
      }};
    }
    const result=await tool.rollback(token,ctx);
    if(tool.contractVersion)adapter.userAccess.appendAudit(ctx.profile,'AGENT_CP_TOOL_ROLLBACK',id,{runId:ctx.runId,verified:result?.verified===true});
    return result;
  }
  return { catalog, get, execute, rollback, registerCapability(spec){require('./agent-capability-contract').register(register,spec,adapter.authorizeCapability);} };
}

module.exports = {
  createToolRegistry, filterRows, projectRows, compare, getField,
  calculateExpression, resolveDatasetField, applyResolvedFilters,
};
