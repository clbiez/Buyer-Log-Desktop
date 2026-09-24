'use strict';

const registry = require('./ai-capability-registry');

const FORBIDDEN = /(?:\beval\s*\(|\bnew\s+function\b|\bexec\s*\(|\bspawn\s*\(|\bchild_process\b|powershell|cmd\.exe|bash\b|rm\s+-|\bdel\s+|drop\s+table|<\s*script|javascript\s*:)/i;
const ACTION_IDS = new Set(registry.ACTIONS.map(action => action.id));
const OPERATOR_IDS = new Set(registry.OPERATORS.map(operator => operator.id));

function clean(value) { return String(value == null ? '' : value).trim(); }
function unquote(value) {
  const text = clean(value);
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1).replace(/\\([\\"'])/g, '$1');
  return text;
}
function scalar(value) {
  const text = clean(value);
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return unquote(text);
}
function splitConditionLines(lines) {
  // A condition is line-oriented.  Do not split on every AND token: BETWEEN
  // ranges contain a required `AND` of their own.
  return lines.map(line => clean(line).replace(/^(?:AND|OR)\s+/i, '')).filter(Boolean);
}
function parseCondition(text) {
  const functionRange = /^DAYS_UNTIL\s*\(\s*\[([^\]]+)\]\s*\)\s+BETWEEN\s+(-?\d+(?:\.\d+)?)\s+AND\s+(-?\d+(?:\.\d+)?)$/i.exec(text);
  if (functionRange) return { kind: 'function', function: 'DAYS_UNTIL', args: [functionRange[1].trim()], operator: 'between', value: [Number(functionRange[2]), Number(functionRange[3])] };
  const blank = /^\s*(?:ISBLANK|IS_BLANK)\s*\(\s*\[([^\]]+)\]\s*\)\s*$/i.exec(text);
  if (blank) return { kind: 'field', field: blank[1].trim(), operator: 'empty', value: '' };
  const notBlank = /^\s*(?:ISNOTBLANK|IS_NOT_BLANK)\s*\(\s*\[([^\]]+)\]\s*\)\s*$/i.exec(text);
  if (notBlank) return { kind: 'field', field: notBlank[1].trim(), operator: 'not_empty', value: '' };
  const match = /^\s*\[([^\]]+)\]\s*(=|==|!=|<>|>=|<=|>|<|CONTAINS|NOT_CONTAINS|IN|BETWEEN|IS_BLANK|IS_NOT_BLANK)\s*(.*?)\s*$/i.exec(text);
  if (!match) throw Object.assign(new Error(`Geçersiz koşul: ${text}`), { code: 'AUTOMATION_DSL_CONDITION_INVALID' });
  const opToken = match[2].toUpperCase();
  const operator = ({ '==': 'eq', '=': 'eq', '!=': 'neq', '<>': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', CONTAINS: 'contains', NOT_CONTAINS: 'not_contains', IN: 'in', BETWEEN: 'between', IS_BLANK: 'empty', IS_NOT_BLANK: 'not_empty' })[opToken];
  if (!OPERATOR_IDS.has(operator)) throw new Error(`Desteklenmeyen operatör: ${opToken}`);
  const raw = clean(match[3]);
  if (operator === 'between') {
    const range = raw.match(/^(-?\d+(?:\.\d+)?)\s+AND\s+(-?\d+(?:\.\d+)?)$/i);
    if (!range) throw new Error(`BETWEEN aralığı geçersiz: ${raw}`);
    return { kind: 'field', field: match[1].trim(), operator, value: [Number(range[1]), Number(range[2])] };
  }
  if (operator === 'in') {
    const values = raw.replace(/^\(|\)$/g, '').split(',').map(scalar).filter(value => value !== '');
    if (!values.length) throw new Error('IN için en az bir değer gerekli.');
    return { kind: 'field', field: match[1].trim(), operator, value: values };
  }
  return { kind: 'field', field: match[1].trim(), operator, value: scalar(raw) };
}

function parseTrigger(line) {
  const text = clean(line);
  if (/^MANUAL$/i.test(text)) return { type: 'MANUAL' };
  const daily = /^DAILY\s+AT\s+(\d{2}:\d{2})$/i.exec(text);
  if (daily) return { type: 'DAILY', time: daily[1] };
  const weekly = /^WEEKLY\s+ON\s+([A-Z]+)\s+AT\s+(\d{2}:\d{2})$/i.exec(text);
  if (weekly) return { type: 'WEEKLY', weekday: weekly[1].toUpperCase(), time: weekly[2] };
  const interval = /^INTERVAL\s+(\d+)\s+HOURS?$/i.exec(text);
  if (interval) return { type: 'INTERVAL', hours: Number(interval[1]) };
  throw Object.assign(new Error(`Geçersiz TRIGGER: ${text}`), { code: 'AUTOMATION_DSL_TRIGGER_INVALID' });
}

function parse(raw) {
  const source = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!source.trim()) throw new Error('Automation Code boş olamaz.');
  if (FORBIDDEN.test(source)) throw Object.assign(new Error('Forbidden automation code: yalnız Buyer Log DSL içerebilir; çalıştırılabilir kod reddedildi.'), { code: 'AUTOMATION_DSL_FORBIDDEN' });
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const header = /^BUYERLOG_AUTOMATION\s+(\d+\.\d+)$/i.exec(lines.shift() || '');
  if (!header || header[1] !== registry.AUTOMATION_LANGUAGE_VERSION) throw Object.assign(new Error('Desteklenmeyen Automation Language sürümü.'), { code: 'AUTOMATION_DSL_VERSION_UNSUPPORTED' });
  const ast = { languageVersion: header[1], name: '', trigger: null, source: '', conditions: [], actions: [], requiredInputs: [] };
  if (!/^NAME\s+/i.test(lines[0] || '')) throw new Error('NAME satırı gerekli.');
  ast.name = unquote(lines.shift().replace(/^NAME\s+/i, ''));
  if (!/^TRIGGER$/i.test(lines.shift() || '')) throw new Error('TRIGGER bölümü gerekli.');
  if (!lines.length) throw new Error('TRIGGER değeri gerekli.');
  ast.trigger = parseTrigger(lines.shift());
  if (!/^END$/i.test(lines.shift() || '')) throw new Error('TRIGGER END eksik.');
  const sourceLine = lines.shift() || '';
  const sourceMatch = /^SOURCE\s+(.+)$/i.exec(sourceLine);
  if (!sourceMatch) throw new Error('SOURCE satırı gerekli.');
  ast.source = unquote(sourceMatch[1]).toLowerCase();
  if (!/^WHEN$/i.test(lines.shift() || '')) throw new Error('WHEN bölümü gerekli.');
  const conditionLines = [];
  while (lines.length && !/^END$/i.test(lines[0])) conditionLines.push(lines.shift());
  if (!/^END$/i.test(lines.shift() || '')) throw new Error('WHEN END eksik.');
  ast.conditions = splitConditionLines(conditionLines).map(parseCondition);
  if (!/^ACTIONS$/i.test(lines.shift() || '')) throw new Error('ACTIONS bölümü gerekli.');
  while (lines.length && !/^END$/i.test(lines[0])) {
    const actionLine = lines.shift();
    const actionType = clean(actionLine).toUpperCase();
    if (!ACTION_IDS.has(actionType)) throw new Error(`Desteklenmeyen action: ${actionType}`);
    const action = { type: actionType };
    while (lines.length && !/^END$/i.test(lines[0])) {
      const propertyLine = lines.shift();
      const property = /^([A-Z_]+)\s*(.*)$/i.exec(propertyLine);
      if (!property) throw new Error(`Geçersiz action parametresi: ${propertyLine}`);
      const propertyName = property[1].toUpperCase();
      const definition = registry.ACTIONS.find(item => item.id === actionType);
      if (!definition || !definition.parameters.includes(propertyName)) throw Object.assign(new Error(`Desteklenmeyen action parametresi: ${actionType}.${propertyName}`), { code: 'AUTOMATION_DSL_ACTION_PARAMETER_INVALID' });
      action[propertyName] = scalar(property[2]);
      if (propertyName === 'RECIPIENT_GROUP' && String(action[propertyName]).toUpperCase() === 'ASK_USER') ast.requiredInputs.push('EMAIL_GROUP');
    }
    if (!/^END$/i.test(lines.shift() || '')) throw new Error(`${actionType} END eksik.`);
    ast.actions.push(action);
  }
  if (!/^END$/i.test(lines.shift() || '')) throw new Error('ACTIONS END eksik.');
  if (lines.length) throw new Error('Automation Code sonunda tanınmayan içerik var.');
  ast.requiredInputs = [...new Set(ast.requiredInputs)];
  return ast;
}

function folded(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('tr-TR');
}

function rowValue(row, field) {
  if (!row || typeof row !== 'object' || !field) return undefined;
  const candidates = [field.id, field.defaultLabel, field.sourceUniqueName, field.name]
    .concat(field.aliases || [])
    .filter(Boolean).map(folded);
  for (const key of Object.keys(row)) {
    if (candidates.includes(folded(key))) return row[key];
  }
  return undefined;
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const text = clean(value);
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(text);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? NaN : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = clean(value).replace(/\s/g, '').replace(',', '.');
  if (!text) return NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sameValue(left, right) {
  const leftNumber = numeric(left), rightNumber = numeric(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  return folded(left) === folded(right);
}

function evaluateFieldCondition(condition, actual) {
  const operator = String(condition && condition.operator || '').toLowerCase();
  const expected = condition && condition.value;
  const empty = actual == null || clean(actual) === '';
  if (operator === 'empty') return empty;
  if (operator === 'not_empty') return !empty;
  if (operator === 'contains' || operator === 'not_contains') {
    const result = folded(actual).includes(folded(expected));
    return operator === 'contains' ? result : !result;
  }
  if (operator === 'in') return (Array.isArray(expected) ? expected : [expected]).some(item => sameValue(actual, item));
  if (operator === 'between') {
    const actualNumber = numeric(actual), range = Array.isArray(expected) ? expected.map(numeric) : [];
    return Number.isFinite(actualNumber) && range.length === 2 && actualNumber >= range[0] && actualNumber <= range[1];
  }
  if (operator === 'eq') return sameValue(actual, expected);
  if (operator === 'neq') return !sameValue(actual, expected);
  const leftNumber = numeric(actual), rightNumber = numeric(expected);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (operator === 'gt') return leftNumber > rightNumber;
  if (operator === 'gte') return leftNumber >= rightNumber;
  if (operator === 'lt') return leftNumber < rightNumber;
  if (operator === 'lte') return leftNumber <= rightNumber;
  return false;
}

function evaluateConditions(conditions, row, source, options = {}) {
  const now = dateOnly(options.now == null ? new Date() : options.now);
  return (Array.isArray(conditions) ? conditions : []).every(condition => {
    if (!condition || typeof condition !== 'object') return false;
    if (condition.kind === 'function' && String(condition.function).toUpperCase() === 'DAYS_UNTIL') {
      const field = registry.resolveField(condition.args && condition.args[0], source);
      const value = dateOnly(rowValue(row, field));
      if (!field || !Number.isFinite(value) || !Number.isFinite(now)) return false;
      const days = Math.round((value - now) / 86400000);
      return evaluateFieldCondition({ operator: condition.operator, value: condition.value }, days);
    }
    const field = registry.resolveField(condition.field, source);
    if (!field) return false;
    return evaluateFieldCondition(condition, rowValue(row, field));
  });
}

function validate(ast, model = registry.getCapabilityModel()) {
  const errors = [], warnings = [], resolvedFields = [];
  if (!ast || ast.languageVersion !== model.automationLanguageVersion) errors.push('Automation Language sürümü desteklenmiyor.');
  if (!model.datasets.some(dataset => dataset.id === ast.source)) errors.push(`Bilinmeyen dataset: ${ast && ast.source}`);
  for (const condition of ast && ast.conditions || []) {
    const ref = condition.kind === 'function' ? condition.args[0] : condition.field;
    const resolved = registry.resolveField(ref, ast.source);
    if (!resolved) errors.push(`Bilinmeyen alan: ${ref}`);
    else { resolvedFields.push({ requested: ref, ...resolved }); if (condition.kind === 'function' && condition.function === 'DAYS_UNTIL' && resolved.type !== 'date') errors.push(`DAYS_UNTIL tarih alanı bekler: ${ref}`); }
  }
  for (const action of ast && ast.actions || []) {
    const definition = model.actions.find(item => item.id === action.type);
    if (!definition) errors.push(`Desteklenmeyen action: ${action.type}`);
    if (definition) {
      for (const property of Object.keys(action).filter(key => key !== 'type')) {
        if (!definition.parameters.includes(property)) errors.push(`Desteklenmeyen action parametresi: ${action.type}.${property}`);
      }
    }
    if (action.type === 'SEND_EMAIL' && !action.RECIPIENT_GROUP) errors.push('SEND_EMAIL için RECIPIENT_GROUP gerekli.');
    if (action.type === 'REFRESH_SOURCE' && action.SOURCE && !(definition.allowedSources || []).includes(String(action.SOURCE).toLowerCase())) errors.push(`REFRESH_SOURCE dataset'i bu action için desteklenmiyor: ${action.SOURCE}`);
  }
  return { ok: errors.length === 0, errors, warnings, resolvedFields, requiredInputs: [...new Set(ast && ast.requiredInputs || [])], capabilityHash: model.capabilityHash };
}

module.exports = { parse, validate, parseCondition, evaluateConditions };
