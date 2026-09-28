/* Buyer Log column schema / type registry.
 *
 * Source values are deliberately kept untouched.  A schema owns the typed
 * value used by presentation, filtering, sorting and export, so a new column
 * cannot accidentally make its raw database representation the UI contract.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.BLColumnSchema = api;
    root.resolveColumnSchema = api.resolveColumnSchema;
    root.resolveColumnSchemas = api.resolveColumnSchemas;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const TYPE_ALIASES = {
    ro: 'text', text: 'text', string: 'text',
    date: 'date', datetime: 'datetime', timestamp: 'datetime',
    int: 'integer', integer: 'integer', number: 'decimal', decimal: 'decimal',
    num: 'decimal', qty: 'quantity', quantity: 'quantity',
    money: 'currency', currency: 'currency', price: 'currency',
    pct: 'percentage', percent: 'percentage', percentage: 'percentage',
    bool: 'boolean', boolean: 'boolean', enum: 'enum',
    plm: 'code/id', ordercode: 'code/id', code: 'code/id', id: 'code/id',
  };
  const BOOLEAN_VALUES = new Map([
    ['true', true], ['false', false], ['1', true], ['0', false],
    ['y', true], ['n', false], ['yes', true], ['no', false],
    ['evet', true], ['hayir', false], ['x', true],
  ]);
  const DATE_ALIASES = new Set([
    'opd', 'exfactory', 'handovertarihi', 'retaildate', 'retail',
    'buyingsononaytarihi', 'instoremodelbudget', 'instore', 'antarrival',
    'exf', 'exfactorydate', 'retaildate', 'handoverdate',
  ]);
  const QUANTITY_ALIASES = new Set([
    'orderquantity', 'shipmentquantity', 'remainingunits', 'quantity',
    'adet', 'miktar', 'receivedquantity', 'units', 'qty',
  ]);
  const CURRENCY_ALIASES = new Set([
    'fob', 'fobusd', 'fob', 'suppfob', 'targetprice', 'previousseasonfob',
    'fabricprices6', 'fabricprices7', 'trprice', 'price', 'cost', 'maliyet',
  ]);
  const CODE_HINT = /(code|kod|id|no|number|numara|plm|style|model|colour|color|season|order)/i;
  const DATE_HINT = /(date|tarih|day|g[uü]n|opd|handover|retail|instore|ex.?factory|arrival)/i;

  function keyOf(value) {
    const text = String(value == null ? '' : value);
    return (typeof text.normalize === 'function' ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text)
      .toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]+/gi, '');
  }
  function fieldOf(column) {
    return column && (column.field || column.k || column.key || column.name || column.header || column.label) || '';
  }
  function labelOf(column) { return column && (column.displayName || column.label || column.header || fieldOf(column)) || ''; }
  function nonEmpty(value) { return value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === ''); }
  function valuesOf(column, rows) {
    const field = fieldOf(column);
    return (Array.isArray(rows) ? rows : []).map(row => row && row[field]).filter(nonEmpty);
  }
  function typeFrom(value) {
    const normalized = keyOf(value);
    return TYPE_ALIASES[normalized] || TYPE_ALIASES[String(value == null ? '' : value).toLowerCase()] || null;
  }
  function explicitType(column) {
    if (!column) return null;
    const nested = column.schema && typeof column.schema === 'object' ? column.schema : null;
    const explicit = nested && (nested.dataType || nested.type) || column.dataType || column.data_type;
    if (explicit) return typeFrom(explicit);
    if (column.boolean === true) return 'boolean';
    if (column.date === true) return 'date';
    if (column.datetime === true) return 'datetime';
    if (column.qty === true) return 'quantity';
    if (column.money === true) return 'currency';
    if (column.percent === true) return 'percentage';
    if (column.select) return 'enum';
    // `ro` is the table renderer's read-only flag, not a data type. Dynamic
    // model/Collection columns use it while their actual type is resolved
    // from metadata, aliases or samples below.
    return column.type && String(column.type).toLowerCase() !== 'ro' ? typeFrom(column.type) : null;
  }
  function metadataType(metadata) {
    if (!metadata) return null;
    if (typeof metadata === 'string') return typeFrom(metadata);
    return typeFrom(metadata.dataType || metadata.type || metadata.dbType || metadata.sqlType || metadata.kind);
  }
  function strictDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    if (!nonEmpty(value)) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const whole = Math.trunc(value);
      if (String(whole).length === 8) return dateParts(+String(whole).slice(0, 4), +String(whole).slice(4, 6), +String(whole).slice(6, 8));
      return null;
    }
    const text = String(value).trim();
    let match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if (match) return dateParts(+match[1], +match[2], +match[3]);
    match = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:$|T|\s)/.exec(text);
    if (match) return dateParts(+match[1], +match[2], +match[3], text);
    if (/^\d{4}-\d{1,2}-\d{1,2}T/.test(text)) {
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }
  function dateParts(year, month, day, source) {
    if (year < 1 || month < 1 || month > 12 || day < 1) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    if (source && /T|\s/.test(source)) {
      const time = new Date(source);
      if (!Number.isNaN(time.getTime())) return time;
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }
  function numeric(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (!nonEmpty(value) || typeof value === 'boolean') return null;
    let text = String(value).trim().replace(/\s/g, '');
    if (!/^[+-]?(?:\d+|\d{1,3}(?:[.,]\d{3})+)(?:[.,]\d+)?$/.test(text)) return null;
    const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    else if (comma >= 0) text = text.replace(',', '.');
    else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\./g, '');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function dateLike(value) { return strictDate(value) !== null; }
  function inferType(column, values) {
    if (!values.length) return 'text';
    const field = fieldOf(column), label = labelOf(column), joined = `${field} ${label}`;
    const normalizedField = keyOf(field);
    if (CODE_HINT.test(joined) && values.some(value => /^0\d+$/.test(String(value).trim()))) return 'code/id';
    const dateHint = DATE_HINT.test(joined);
    const dateEvidence = values.some(value => { const text = String(value).trim(); return /[-\/]/.test(text) || /^\d{8}$/.test(text); });
    // Tarih ayrıştırması yalnız tarih kanıtı olan sütunda (30k satırda pahalı).
    if ((dateHint && dateEvidence || dateEvidence && values.length > 1) && values.every(value => Boolean(strictDate(value)))) {
      return values.some(value => /T|\s\d{1,2}:\d{2}/.test(String(value))) ? 'datetime' : 'date';
    }
    // A date-looking column with an invalid sample must not silently fall
    // through to integer/decimal inference (for example 20261345).
    if (dateHint && dateEvidence) return 'text';
    if (normalizedField && CODE_HINT.test(field) && values.some(value => /^[+-]?\d+$/.test(String(value).trim()))) return 'code/id';
    let integer = true;
    for (const value of values) {
      const number = numeric(value);
      if (number === null) return 'text';
      if (!Number.isInteger(number)) integer = false;
    }
    return integer ? 'integer' : 'decimal';
  }
  function percentageScale(column, nested, metadata) {
    const scale = nested && (nested.scale || nested.percentageScale) || column && (column.scale || column.percentageScale) || metadata && (metadata.scale || metadata.percentageScale);
    if (scale === 'percent' || scale === '0-100' || scale === '100') return 'percent';
    if (scale === 'fraction' || scale === '0-1' || scale === '1') return 'fraction';
    // Existing BL pct columns are known to store fractions; an untyped new
    // percentage is intentionally left unscaled rather than guessed ×100.
    return column && (column.percent === true || column.type === 'pct') ? 'fraction' : null;
  }
  function localeNumber(value, decimals) {
    if (root && typeof root.Intl !== 'undefined') return Number(value).toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return Number(value).toFixed(decimals);
  }
  function displayDate(value) {
    if (root && typeof root.fmtDate === 'function') return root.fmtDate(value);
    const date = strictDate(value);
    if (!date) return '';
    const p = x => String(x).padStart(2, '0');
    return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)}`;
  }
  function displayDateTime(value) {
    const date = strictDate(value);
    if (!date) return '';
    const p = x => String(x).padStart(2, '0');
    return `${displayDate(date)} ${p(date.getHours())}:${p(date.getMinutes())}`;
  }
  function emptyValue(value) { return value === null || value === undefined || (typeof value === 'string' && value.trim() === ''); }
  function buildSchema(column, dataType, metadata) {
    const nested = column && column.schema && typeof column.schema === 'object' ? column.schema : {};
    const sourceField = fieldOf(column);
    const scale = dataType === 'percentage' ? percentageScale(column, nested, metadata) : null;
    const parser = value => {
      if (emptyValue(value)) return null;
      if (dataType === 'date' || dataType === 'datetime') return strictDate(value);
      if (dataType === 'integer' || dataType === 'decimal' || dataType === 'quantity' || dataType === 'currency' || dataType === 'percentage') return numeric(value);
      if (dataType === 'boolean') {
        if (typeof value === 'boolean') return value;
        const normalized = String(value).trim().toLocaleLowerCase('tr-TR');
        return BOOLEAN_VALUES.has(normalized) ? BOOLEAN_VALUES.get(normalized) : null;
      }
      return String(value);
    };
    const format = (raw, context) => {
      if (emptyValue(raw)) return '';
      const typed = parser(raw);
      if (dataType === 'date') return typed ? displayDate(typed) : String(raw);
      if (dataType === 'datetime') return typed ? displayDateTime(typed) : String(raw);
      if (dataType === 'integer' || dataType === 'quantity') return typed === null ? String(raw) : localeNumber(Math.trunc(typed), 0);
      if (dataType === 'decimal') return typed === null ? String(raw) : localeNumber(typed, Number.isInteger(typed) ? 0 : 2);
      if (dataType === 'currency') return typed === null ? String(raw) : localeNumber(typed, 2);
      if (dataType === 'percentage') {
        if (typed === null) return String(raw);
        const shown = scale === 'fraction' ? typed * 100 : typed;
        return `${localeNumber(shown, Number.isInteger(shown) ? 0 : 2)}%`;
      }
      if (dataType === 'boolean') {
        if (typed === null) return String(raw);
        return typed ? ((root.appLang === 'en') ? 'Yes' : 'Evet') : ((root.appLang === 'en') ? 'No' : 'Hayır');
      }
      return String(raw);
    };
    const exportValue = raw => {
      if (emptyValue(raw)) return '';
      const typed = parser(raw);
      return typed === null ? String(raw) : typed;
    };
    /* Excel keeps the underlying value typed while the number format mirrors
       Buyer Log's visible formatting. Clipboard/text paths continue to use
       formatter(), so both routes share one schema instead of re-interpreting
       raw database strings independently. */
    const excelValue = raw => {
      if (emptyValue(raw)) return '';
      const typed = parser(raw);
      if (typed === null) return String(raw);
      if (dataType === 'percentage') {
        if (scale === 'percent') return typed / 100;
        return typed;
      }
      if (dataType === 'boolean') return format(raw);
      return typed;
    };
    const excelNumberFormat = () => {
      if (dataType === 'date') return 'dd.mm.yy';
      if (dataType === 'datetime') return 'dd.mm.yy hh:mm';
      if (dataType === 'integer' || dataType === 'quantity') return '#,##0';
      if (dataType === 'decimal') return '#,##0.##';
      if (dataType === 'currency') return '#,##0.00';
      if (dataType === 'percentage' && (scale === 'percent' || scale === 'fraction')) return '0.00%';
      if (dataType === 'code/id') return '@';
      return '';
    };
    const schema = {
      field: sourceField,
      displayName: labelOf(column),
      dataType,
      percentageScale: scale,
      formatter: format,
      parser,
      sortType: ['date', 'datetime'].includes(dataType) ? 'date' : ['integer', 'decimal', 'quantity', 'currency', 'percentage'].includes(dataType) ? 'number' : 'text',
      filterType: ['date', 'datetime'].includes(dataType) ? 'date' : ['integer', 'decimal', 'quantity', 'currency', 'percentage'].includes(dataType) ? 'number' : 'text',
      editorType: dataType === 'boolean' ? 'checkbox' : dataType === 'enum' ? 'select' : dataType,
      nullBehavior: 'blank',
      exportFormatter: exportValue,
      normalize: value => ({ raw: value, value: parser(value) }),
      format,
      parse: parser,
      typedValue: parser,
      sortValue: value => {
        const parsed = parser(value);
        return parsed instanceof Date ? parsed.getTime() : parsed;
      },
      filterValue: value => {
        const parsed = parser(value);
        return parsed instanceof Date ? parsed.getTime() : parsed;
      },
      exportValue,
      excelValue,
      excelNumberFormat,
      isEmpty: emptyValue,
    };
    return Object.assign(schema, nested, { field: sourceField, displayName: labelOf(column), dataType, percentageScale: scale, formatter: format, parser, exportFormatter: exportValue, excelValue, excelNumberFormat });
  }
  function resolveColumnSchema(column, rows, metadata) {
    const source = column || {};
    const nested = source.schema && typeof source.schema === 'object' ? source.schema : null;
    const defined = explicitType(source);
    const fromMetadata = metadataType(metadata || source.sourceMetadata || source.metadata || source.dbMetadata);
    const alias = DATE_ALIASES.has(keyOf(fieldOf(source))) ? 'date' : QUANTITY_ALIASES.has(keyOf(fieldOf(source))) ? 'quantity' : CURRENCY_ALIASES.has(keyOf(fieldOf(source))) ? 'currency' : null;
    const dataType = defined || fromMetadata || alias || inferType(source, valuesOf(source, rows));
    return buildSchema(source, dataType || 'text', metadata || source.metadata);
  }
  function resolveColumnSchemas(columns, rows, metadata) {
    return (Array.isArray(columns) ? columns : []).map(column => {
      const schema = resolveColumnSchema(column, rows, metadata && (metadata[column.k] || metadata[column.field]));
      if (column && typeof column === 'object') column.schema = schema;
      return schema;
    });
  }
  return { resolveColumnSchema, resolveColumnSchemas, parseDate: strictDate, parseNumber: numeric, parseBoolean: value => buildSchema({ field: '' }, 'boolean').parser(value) };
}));
