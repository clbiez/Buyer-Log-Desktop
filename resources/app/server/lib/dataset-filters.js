'use strict';

// Pure comparison helpers shared by the native automation engine.
function clean(value) { return String(value == null ? '' : value).trim(); }
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
module.exports={filterRows,compare,getField};
