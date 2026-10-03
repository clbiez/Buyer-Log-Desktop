/* Buyer Log v9.49 — CP KURAL MOTORU (öncelik + özel kontrol kuralları)
 *
 * "Bu alandaki koşulları kullanıcı dilediği gibi ekle/çıkar yapabilsin."
 *
 * İki tür kural:
 *   · priority  → koşulu sağlayan siparişin ÖNCELİĞİNİ yükseltir
 *   · checklist → koşulu sağlayan siparişe kendi sorusunu sorar
 *
 * TASARIM KARARLARI:
 *
 * 1) YERLEŞİK KURALLAR DA AYNI BİÇİMDE YAZILIR. "Critical" ve "Bu Hafta
 *    Aksiyon" tanımları koda gömülü değil; DEFAULT_RULES içinde, kullanıcının
 *    ekranda görüp değiştirebileceği aynı koşul dilinde duruyor. Gizli bir
 *    kural kalırsa kullanıcı neden bir siparişin Kritik olduğunu göremez.
 *
 * 2) KURALLAR YALNIZ YÜKSELTİR. Bir kural önceliği düşüremez. Aksi hâlde
 *    yanlış yazılmış tek bir kural gerçekten geciken siparişleri listeden
 *    silebilirdi. Teslimat riski (ETA/sonuç) kurallardan HİÇ etkilenmez —
 *    onu yalnız kanonik motor belirler.
 *
 * 3) ALAN LİSTESİ VERİDEN GELİR. Kullanıcının CP'de kendi oluşturduğu
 *    hesaplamalı sütunlar (formül sütunları) da koşulda kullanılabilir;
 *    alan listesi satırın gerçek anahtarlarından üretilir, sabit liste yok.
 *
 * 4) BİLİNMEYEN DEĞER EŞLEŞMEZ. Boş/okunamayan bir alan sayısal
 *    karşılaştırmada asla doğru dönmez: veri yokluğundan uyarı üretmiyoruz.
 *
 * SAF: DOM yok, fetch yok, AI yok.
 */
(function (root, factory) {
  const isNode = typeof require === 'function' && typeof module === 'object';
  const api = factory(
    isNode ? require('./order-decision-engine') : (root && root.BLOrderDecisionEngine),
    isNode ? require('./cp-checklist-engine') : (root && root.BLCpChecklistEngine)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLCpRulesEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (decisionEngine, checklistEngine) {
  'use strict';

  const OD = decisionEngine || {};
  const Checklist = checklistEngine || {};
  /* Compatibility list keeps UNKNOWN visible to legacy editors, but new rules
     can target only real Action Priority severities. Rank comes from the shared
     decision registry. */
  const SEVERITY = Object.freeze([...(OD.ACTION_PRIORITIES || ['CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK']), 'UNKNOWN']);
  const severityRank = key => OD.priorityRank ? OD.priorityRank(key) : (() => {
    const index = SEVERITY.indexOf(key);
    return index < 0 ? SEVERITY.length : index;
  })();

  const OPERATORS = Object.freeze([
    { id: 'eq', tr: 'eşittir', en: 'equals', value: true },
    { id: 'ne', tr: 'eşit değildir', en: 'not equals', value: true },
    { id: 'in', tr: 'şunlardan biri', en: 'is one of', value: true, list: true },
    { id: 'notIn', tr: 'şunlardan biri değil', en: 'is not one of', value: true, list: true },
    { id: 'contains', tr: 'içerir', en: 'contains', value: true },
    { id: 'lt', tr: 'küçüktür', en: 'less than', value: true, numeric: true },
    { id: 'lte', tr: 'küçük veya eşittir', en: 'at most', value: true, numeric: true },
    { id: 'gt', tr: 'büyüktür', en: 'greater than', value: true, numeric: true },
    { id: 'gte', tr: 'büyük veya eşittir', en: 'at least', value: true, numeric: true },
    { id: 'empty', tr: 'boş', en: 'is empty', value: false },
    { id: 'notEmpty', tr: 'dolu', en: 'is not empty', value: false },
  ]);
  const OPERATOR_IDS = Object.freeze(OPERATORS.map(item => item.id));

  /* Motorun türettiği alanlar. Ham sütunlardan ayrı tutulur ki kullanıcı
     "yüklemeye kalan gün" gibi hesaplanmış bir değeri de koşulda kullanabilsin. */
  const DERIVED_FIELDS = Object.freeze([
    { id: '@daysToLoad', tr: 'Yüklemeye kalan gün', en: 'Days to load', numeric: true },
    { id: '@orderAgeDays', tr: 'Sipariş yaşı (gün)', en: 'Order age (days)', numeric: true },
    { id: '@stage', tr: 'Aşama', en: 'Stage' },
    { id: '@deliveryOutcome', tr: 'Teslimat sonucu', en: 'Delivery outcome' },
    { id: '@basePriority', tr: 'Hesaplanan öncelik', en: 'Calculated priority' },
    { id: '@scheduleBufferDays', tr: 'Hedefe tampon (gün)', en: 'Buffer to target (days)', numeric: true },
    { id: '@transitRuleMissing', tr: 'Yol süresi kuralı eksik', en: 'Transit rule missing' },
    { id: '@qty', tr: 'Adet', en: 'Quantity', numeric: true },
    { id: '@loadingType', tr: 'Yükleme tipi', en: 'Loading type' },
  ]);
  const DERIVED_IDS = Object.freeze(new Set(DERIVED_FIELDS.map(item => item.id)));

  /* Kontrol listesi durumu da koşulda kullanılabilir: "yükleme teyidi
     işaretlenmemiş" gibi bir kural ancak böyle yazılabilir. */
  const CHECKLIST_PREFIX = '@checklist:';
  const CHECKLIST_STATES = Object.freeze(['open', 'answered', 'notApplicable']);

  const text = value => String(value == null ? '' : value).trim();
  const lower = value => text(value).toLocaleLowerCase('tr-TR');

  function numberOf(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000);
    if (typeof value === 'boolean') return value ? 1 : 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function listOf(value) {
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    return text(value).split(/[;,]/).map(item => item.trim()).filter(Boolean);
  }

  /* --------------------------------------------------------- expression core
     Formula mode deliberately uses a small parser instead of JavaScript
     evaluation.  The parser is shared by basic conditions and formula rules,
     so a saved rule is parsed once and only its AST is evaluated per order. */
  const FORMULA_FUNCTIONS = Object.freeze(new Set([
    'IF', 'AND', 'OR', 'NOT', 'TODAY', 'ISBLANK', 'ISNOTBLANK',
    'IN', 'CONTAINS', 'DAYS_BETWEEN', 'BETWEEN',
  ]));
  const FORMULA_COMPARATORS = Object.freeze(new Set(['=', '<>', '>', '>=', '<', '<=']));

  function formulaError(message, position) {
    const error = new Error(`${message}${Number.isFinite(position) ? ` at ${position}` : ''}`);
    error.code = 'RULE_FORMULA_INVALID';
    error.position = position;
    return error;
  }

  function tokenizeFormula(source) {
    const input = String(source == null ? '' : source).trim().replace(/^=/, '').trim();
    if (!input) throw formulaError('Formula boş olamaz');
    const tokens = [];
    let index = 0;
    while (index < input.length) {
      const ch = input[index];
      if (/\s/.test(ch)) { index += 1; continue; }
      if (ch === '[') {
        const end = input.indexOf(']', index + 1);
        if (end < 0) throw formulaError('Eksik kapatma köşeli parantezi', index);
        const field = input.slice(index + 1, end).trim();
        if (!field) throw formulaError('Boş alan referansı', index);
        tokens.push({ type: 'field', value: field, position: index });
        index = end + 1;
        continue;
      }
      if (ch === '"') {
        let value = '';
        const start = index;
        index += 1;
        let closed = false;
        while (index < input.length) {
          const current = input[index++];
          if (current === '"') { closed = true; break; }
          if (current === '\\') {
            const escaped = input[index++];
            if (escaped === 'n') value += '\n';
            else if (escaped === 'r') value += '\r';
            else value += escaped || '\\';
          } else value += current;
        }
        if (!closed) throw formulaError('Eksik kapatma tırnağı', start);
        tokens.push({ type: 'string', value, position: start });
        continue;
      }
      const number = input.slice(index).match(/^\d+(?:\.\d+)?/);
      if (number) {
        tokens.push({ type: 'number', value: Number(number[0]), position: index });
        index += number[0].length;
        continue;
      }
      const identifier = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (identifier) {
        tokens.push({ type: 'identifier', value: identifier[0], position: index });
        index += identifier[0].length;
        continue;
      }
      const two = input.slice(index, index + 2);
      if (FORMULA_COMPARATORS.has(two)) {
        tokens.push({ type: 'operator', value: two, position: index });
        index += 2;
        continue;
      }
      if (FORMULA_COMPARATORS.has(ch) || '+-(),'.includes(ch)) {
        tokens.push({ type: ch === ',' ? 'comma' : ch === '(' || ch === ')' ? 'paren' : 'operator', value: ch, position: index });
        index += 1;
        continue;
      }
      throw formulaError(`Desteklenmeyen karakter: ${ch}`, index);
    }
    tokens.push({ type: 'eof', value: '', position: input.length });
    return tokens;
  }

  function parseFormula(source) {
    const tokens = tokenizeFormula(source);
    let cursor = 0;
    const fields = new Set();
    const peek = () => tokens[cursor];
    const take = () => tokens[cursor++];
    const expect = (type, value) => {
      const token = peek();
      if (token.type !== type || (value != null && token.value !== value)) {
        throw formulaError(`Beklenmeyen ifade; ${value || type} bekleniyordu`, token.position);
      }
      return take();
    };
    const parseExpression = () => parseComparison();
    const parseComparison = () => {
      const left = parseAdditive();
      const token = peek();
      if (token.type === 'operator' && FORMULA_COMPARATORS.has(token.value)) {
        take();
        return { type: 'compare', operator: token.value, left, right: parseAdditive() };
      }
      return left;
    };
    const parseAdditive = () => {
      let node = parsePrimary();
      while (peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
        const operator = take().value;
        node = { type: 'binary', operator, left: node, right: parsePrimary() };
      }
      return node;
    };
    const parsePrimary = () => {
      const token = peek();
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        take();
        return { type: 'unary', operator: token.value, value: parsePrimary() };
      }
      if (token.type === 'number' || token.type === 'string') {
        take();
        return { type: 'literal', value: token.value };
      }
      if (token.type === 'field') {
        take();
        fields.add(token.value);
        return { type: 'field', value: token.value };
      }
      if (token.type === 'paren' && token.value === '(') {
        take();
        const node = parseExpression();
        expect('paren', ')');
        return node;
      }
      if (token.type === 'identifier') {
        const name = String(take().value).toUpperCase();
        if (name === 'TRUE' || name === 'FALSE') return { type: 'literal', value: name === 'TRUE' };
        if (!FORMULA_FUNCTIONS.has(name)) throw formulaError(`Geçersiz fonksiyon: ${name}`, token.position);
        expect('paren', '(');
        const args = [];
        if (!(peek().type === 'paren' && peek().value === ')')) {
          args.push(parseExpression());
          while (peek().type === 'comma') { take(); args.push(parseExpression()); }
        }
        expect('paren', ')');
        const arity = {
          TODAY: [0, 0], NOT: [1, 1], ISBLANK: [1, 1], ISNOTBLANK: [1, 1],
          IF: [3, 3], DAYS_BETWEEN: [2, 2], BETWEEN: [3, 3], IN: [2, Infinity], CONTAINS: [2, 2],
          AND: [1, Infinity], OR: [1, Infinity],
        }[name];
        if (args.length < arity[0] || args.length > arity[1]) {
          throw formulaError(`${name} için geçersiz argüman sayısı`, token.position);
        }
        return { type: 'call', name, args };
      }
      throw formulaError('Beklenmeyen ifade', token.position);
    };
    const ast = parseExpression();
    if (peek().type !== 'eof') throw formulaError('Beklenmeyen ifade', peek().position);
    return { ast, fields: [...fields] };
  }

  function dateOrdinalOf(value) {
    if (value && value.__ruleDateOrdinal != null) return Number(value.__ruleDateOrdinal);
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000);
    }
    const raw = text(value);
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return Math.floor(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000);
    const slash = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (slash) return Math.floor(Date.UTC(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1])) / 86400000);
    return null;
  }

  function todayOrdinal(value) {
    const provided = dateOrdinalOf(value);
    if (provided != null) return provided;
    const now = new Date();
    return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  }

  function blank(value) { return value == null || text(value) === ''; }
  function numericValue(value) {
    if (blank(value)) return null;
    if (value && value.__ruleDateOrdinal != null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function dateValue(value) {
    const ordinal = dateOrdinalOf(value);
    return ordinal == null ? null : ordinal;
  }
  function dateMarker(ordinal) { return { __ruleDateOrdinal: ordinal }; }
  function truthy(value) { return typeof value === 'boolean' ? value : !blank(value) && value !== 0; }

  function compareValues(left, right, operator) {
    if (blank(left) || blank(right)) return false;
    const leftDate = dateValue(left);
    const rightDate = dateValue(right);
    let a = left;
    let b = right;
    if (leftDate != null && rightDate != null) { a = leftDate; b = rightDate; }
    else {
      const leftNumber = numericValue(left);
      const rightNumber = numericValue(right);
      if (leftNumber != null && rightNumber != null) { a = leftNumber; b = rightNumber; }
      else { a = lower(left); b = lower(right); }
    }
    if (operator === '=') return a === b;
    if (operator === '<>') return a !== b;
    if (operator === '>') return a > b;
    if (operator === '>=') return a >= b;
    if (operator === '<') return a < b;
    return a <= b;
  }

  function evaluateAst(ast, facts, options, diagnostics) {
    const opts = options || {};
    const diag = diagnostics || { fields: new Set(), values: [] };
    const evaluate = node => {
      if (node.type === 'literal') return node.value;
      if (node.type === 'field') {
        diag.fields.add(node.value);
        const value = readField(node.value, facts || { row: {}, derived: {}, checklist: {} });
        diag.values.push({ field: node.value, value });
        return value;
      }
      if (node.type === 'unary') {
        const value = numericValue(evaluate(node.value));
        return value == null ? null : (node.operator === '-' ? -value : value);
      }
      if (node.type === 'binary') {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        const leftDate = dateValue(left);
        const rightDate = dateValue(right);
        const leftNumber = numericValue(left);
        const rightNumber = numericValue(right);
        if (leftDate != null && rightNumber != null) return dateMarker(leftDate + (node.operator === '+' ? rightNumber : -rightNumber));
        if (node.operator === '+' && rightDate != null && leftNumber != null) return dateMarker(rightDate + leftNumber);
        if (node.operator === '-' && leftDate != null && rightDate != null) return leftDate - rightDate;
        if (leftNumber == null || rightNumber == null) return null;
        return node.operator === '+' ? leftNumber + rightNumber : leftNumber - rightNumber;
      }
      if (node.type === 'compare') return compareValues(evaluate(node.left), evaluate(node.right), node.operator);
      if (node.type !== 'call') return null;
      const args = node.args.map(evaluate);
      switch (node.name) {
        case 'TODAY': return dateMarker(todayOrdinal(opts.today || (facts && facts.today)));
        case 'IF': return truthy(args[0]) ? args[1] : args[2];
        case 'AND': return args.every(truthy);
        case 'OR': return args.some(truthy);
        case 'NOT': return !truthy(args[0]);
        case 'ISBLANK': return blank(args[0]);
        case 'ISNOTBLANK': return !blank(args[0]);
        case 'IN': return args.slice(1).some(item => compareValues(args[0], item, '='));
        case 'CONTAINS': return lower(args[0]).includes(lower(args[1]));
        case 'DAYS_BETWEEN': {
          const first = dateValue(args[0]); const second = dateValue(args[1]);
          return first == null || second == null ? null : second - first;
        }
        case 'BETWEEN': {
          const value = args[0];
          return compareValues(value, args[1], '>=') && compareValues(value, args[2], '<=');
        }
        default: return null;
      }
    };
    return { value: evaluate(ast), fields: [...diag.fields], diagnostics: diag.values };
  }

  function compileExpression(source, options) {
    const parsed = parseFormula(source);
    const opts = options || {};
    const catalog = Array.isArray(opts.fields) ? opts.fields.map(item => text(item && (item.id || item.key) || item)).filter(Boolean) : null;
    const errors = catalog ? parsed.fields.filter(field => !catalog.includes(field)).map(field => `Unknown field: ${field}`) : [];
    if (errors.length) throw formulaError(errors.join('; '));
    return {
      ast: parsed.ast,
      fields: parsed.fields,
      evaluate(facts, runtimeOptions) { return evaluateAst(parsed.ast, facts, runtimeOptions, { fields: new Set(), values: [] }); },
    };
  }

  function evaluateExpression(source, facts, options) {
    try { return compileExpression(source, options).evaluate(facts, options); }
    catch (error) { return { value: false, fields: [], diagnostics: [], error: error.message || String(error) }; }
  }

  function validateExpression(source, options) {
    try {
      const compiled = compileExpression(source, options);
      return { valid: true, errors: [], fields: compiled.fields, compiled };
    } catch (error) {
      return { valid: false, errors: [error.message || String(error)], fields: [] };
    }
  }

  function normalizeOffset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const value = Number(raw.value);
    const offset = { value: Number.isFinite(value) ? value : 0, unit: text(raw.unit).toLowerCase() === 'weeks' ? 'weeks' : 'days' };
    return offset.value ? offset : null;
  }

  function normalizeOperand(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : (fallback || {});
    const type = ['field', 'value', 'today'].includes(text(source.type)) ? text(source.type) : (fallback && fallback.type) || 'value';
    const operand = {
      type,
      field: text(source.field == null ? (fallback && fallback.field) : source.field),
      value: source.value == null ? ((fallback && fallback.value) == null ? '' : fallback.value) : source.value,
      offset: normalizeOffset(source.offset || (fallback && fallback.offset)),
      offsetField: text(source.offsetField == null ? (fallback && fallback.offsetField) : source.offsetField),
    };
    if (type === 'today') operand.field = '';
    if (type === 'field' && !operand.field) operand.type = 'value';
    return operand;
  }

  function normalizeCondition(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const operator = OPERATOR_IDS.includes(text(item.operator)) ? text(item.operator) : 'eq';
    const left = normalizeOperand(item.left, { type: 'field', field: text(item.field) });
    const valueType = text(item.valueType);
    const right = normalizeOperand(item.right || (valueType ? { type: valueType, field: item.valueField, value: item.value } : { type: 'value', value: item.value }), { type: 'value' });
    return {
      field: left.field,
      operator,
      value: right.type === 'value' ? right.value : (right.field || right.type),
      left,
      right,
    };
  }

  function formulaQuote(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    const raw = text(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${raw}"`;
  }

  function formulaOperand(operand, fallbackField) {
    const item = normalizeOperand(operand, { type: 'field', field: fallbackField || '' });
    let value = item.type === 'field' ? `[${item.field}]` : item.type === 'today' ? 'TODAY()' : formulaQuote(item.value);
    if (item.offset) {
      const days = Number(item.offset.value) * (item.offset.unit === 'weeks' ? 7 : 1);
      if (Number.isFinite(days) && days) value = `(${value}${days < 0 ? '' : '+'}${days})`;
    }
    if (item.offsetField) value = `(${value}+[${item.offsetField}])`;
    return value;
  }

  function conditionsToFormula(conditions, match) {
    const items = (Array.isArray(conditions) ? conditions : []).map(normalizeCondition).filter(item => item.left && item.left.field);
    const expressions = items.map(item => {
      const left = formulaOperand(item.left, item.field);
      const right = item.right;
      if (item.operator === 'empty') return `ISBLANK(${left})`;
      if (item.operator === 'notEmpty') return `ISNOTBLANK(${left})`;
      if (item.operator === 'in' || item.operator === 'notIn') {
        const values = Array.isArray(right.value) ? right.value : listOf(right.value);
        const expression = `IN(${left},${values.map(formulaQuote).join(',')})`;
        return item.operator === 'notIn' ? `NOT(${expression})` : expression;
      }
      if (item.operator === 'contains') return `CONTAINS(${left},${formulaOperand(right)})`;
      const operator = ({ eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' })[item.operator] || '=';
      return `${left}${operator}${formulaOperand(right)}`;
    });
    if (!expressions.length) return '';
    if (expressions.length === 1) return `=${expressions[0]}`;
    return `=${match === 'any' ? 'OR' : 'AND'}(${expressions.join(',')})`;
  }

  function formulaNodeOperand(node) {
    if (!node) return null;
    if (node.type === 'field') return { type: 'field', field: node.value, value: '' };
    if (node.type === 'literal') return { type: 'value', field: '', value: node.value };
    if (node.type === 'call' && node.name === 'TODAY') return { type: 'today', field: '', value: '' };
    if (node.type === 'binary' && (node.operator === '+' || node.operator === '-')) {
      const base = formulaNodeOperand(node.left);
      const delta = node.right && node.right.type === 'literal' ? Number(node.right.value) : NaN;
      if (base && Number.isFinite(delta)) {
        return { ...base, offset: { value: node.operator === '-' ? -delta : delta, unit: 'days' } };
      }
    }
    return null;
  }

  function formulaNodeConditions(node) {
    if (!node) return null;
    if (node.type === 'compare') {
      const left = formulaNodeOperand(node.left);
      const right = formulaNodeOperand(node.right);
      const operator = ({ '=': 'eq', '<>': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' })[node.operator];
      if (!left || left.type !== 'field' || !right || !operator) return null;
      return [{ field: left.field, operator, value: right.type === 'value' ? right.value : (right.field || right.type), left, right }];
    }
    if (node.type !== 'call') return null;
    if (node.name === 'ISBLANK' || node.name === 'ISNOTBLANK') {
      const left = formulaNodeOperand(node.args[0]);
      return left && left.type === 'field' ? [{ field: left.field, operator: node.name === 'ISBLANK' ? 'empty' : 'notEmpty', value: '', left, right: { type: 'value', value: '' } }] : null;
    }
    if (node.name === 'CONTAINS') {
      const left = formulaNodeOperand(node.args[0]);
      const right = formulaNodeOperand(node.args[1]);
      return left && left.type === 'field' && right ? [{ field: left.field, operator: 'contains', value: right.value, left, right }] : null;
    }
    if (node.name === 'IN' || (node.name === 'NOT' && node.args[0] && node.args[0].type === 'call' && node.args[0].name === 'IN')) {
      const source = node.name === 'IN' ? node : node.args[0];
      const left = formulaNodeOperand(source.args[0]);
      const values = source.args.slice(1).map(formulaNodeOperand);
      if (!left || left.type !== 'field' || values.some(item => !item || item.type !== 'value')) return null;
      return [{ field: left.field, operator: node.name === 'NOT' ? 'notIn' : 'in', value: values.map(item => item.value), left, right: { type: 'value', value: values.map(item => item.value) } }];
    }
    if (node.name === 'BETWEEN') {
      const value = formulaNodeOperand(node.args[0]);
      const lowerBound = formulaNodeOperand(node.args[1]);
      const upperBound = formulaNodeOperand(node.args[2]);
      if (!value || value.type !== 'field' || !lowerBound || !upperBound) return null;
      return [
        { field: value.field, operator: 'gte', value: lowerBound.value, left: value, right: lowerBound },
        { field: value.field, operator: 'lte', value: upperBound.value, left: value, right: upperBound },
      ];
    }
    return null;
  }

  function formulaToConditions(source) {
    let parsed;
    try { parsed = parseFormula(source); } catch (_) { return null; }
    const root = parsed.ast;
    if (root && root.type === 'literal' && root.value === false) return { match: 'all', conditions: [] };
    const match = root.type === 'call' && (root.name === 'AND' || root.name === 'OR') ? (root.name === 'OR' ? 'any' : 'all') : 'all';
    const nodes = root.type === 'call' && (root.name === 'AND' || root.name === 'OR') ? root.args : [root];
    const conditions = nodes.flatMap(node => formulaNodeConditions(node) || []);
    if (!conditions.length || conditions.length !== nodes.length && !(nodes.length === 1 && conditions.length === 2)) return null;
    return { match, conditions };
  }

  function normalizeRule(raw, kind) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const ruleKind = kind || (['priority', 'checklist'].includes(text(item.kind)) ? text(item.kind) : 'priority');
    const conditions = (Array.isArray(item.conditions) ? item.conditions : []).slice(0, 12).map(normalizeCondition).filter(rule => rule.field);
    const base = {
      id: text(item.id) || `rule_${Math.random().toString(36).slice(2, 10)}`,
      kind: ruleKind,
      name: text(item.name).slice(0, 160),
      enabled: item.enabled !== false,
      builtIn: item.builtIn === true,
      mode: text(item.mode) === 'formula' ? 'formula' : 'basic',
      formula: text(item.formula).slice(0, 4000),
      expressionVersion: Number(item.expressionVersion) || 1,
      conditions,
      // Koşulların hepsi mi biri mi? Varsayılan "hepsi": daha dar, daha güvenli.
      match: text(item.match) === 'any' ? 'any' : 'all',
    };
    if (ruleKind === 'priority') {
      base.target = SEVERITY.includes(text(item.target)) ? text(item.target) : 'ACTION_THIS_WEEK';
      base.reasonTr = text(item.reasonTr).slice(0, 200);
      base.reasonEn = text(item.reasonEn).slice(0, 200);
    } else {
      base.questionTr = text(item.questionTr).slice(0, 300);
      base.questionEn = text(item.questionEn).slice(0, 300);
      base.tr = text(item.tr).slice(0, 160) || base.name;
      base.en = text(item.en).slice(0, 160) || base.name;
    }
    if (base.mode === 'formula' && base.formula) {
      try {
        Object.defineProperty(base, '_compiledFormula', { value: compileExpression(base.formula), enumerable: false, configurable: true });
        Object.defineProperty(base, '_compiledFormulaSource', { value: base.formula, enumerable: false, configurable: true });
      } catch (error) {
        Object.defineProperty(base, '_formulaError', { value: error.message || String(error), enumerable: false, configurable: true });
        Object.defineProperty(base, '_compiledFormulaSource', { value: base.formula, enumerable: false, configurable: true });
      }
    }
    return base;
  }

  /* ------------------------------------------------------------- YERLEŞİK
     Kullanıcının tarif ettiği tanımlar, düzenlenebilir kural olarak. */
  const DEFAULT_PRIORITY_RULES = Object.freeze([
    Object.freeze(normalizeRule({
      id: 'builtin_critical_late', builtIn: true, kind: 'priority', target: 'CRITICAL',
      name: 'Yükleme geçti ve Retail tarihine yetişmiyor',
      reasonTr: 'Yükleme tarihi geçmiş ve hedef tarihe yetişmiyor',
      reasonEn: 'Load date passed and will not make the target date',
      match: 'all',
      conditions: [
        { field: '@daysToLoad', operator: 'lt', value: 0 },
        { field: '@deliveryOutcome', operator: 'in', value: ['EXPECTED_LATE', 'ALREADY_LATE'] },
      ],
    })),
    Object.freeze(normalizeRule({
      id: 'builtin_action_confirmation', builtIn: true, kind: 'priority', target: 'ACTION_THIS_WEEK',
      name: 'Gelecek hafta yüklenecek, üretici teyidi yok',
      reasonTr: 'Gelecek hafta yükleme var, üretici teyidi işaretlenmemiş',
      reasonEn: 'Loading next week without supplier confirmation',
      match: 'all',
      conditions: [
        { field: '@daysToLoad', operator: 'gte', value: 0 },
        { field: '@daysToLoad', operator: 'lte', value: 14 },
        { field: '@checklist:supplierConfirmation', operator: 'eq', value: 'open' },
      ],
    })),
    Object.freeze(normalizeRule({
      id: 'builtin_action_samples', builtIn: true, kind: 'priority', target: 'ACTION_THIS_WEEK',
      name: 'Gelecek hafta yüklenecek, numune onayı işaretlenmemiş',
      reasonTr: 'Gelecek hafta yükleme var, numune onayları işaretlenmemiş',
      reasonEn: 'Loading next week without sample approvals',
      match: 'all',
      conditions: [
        { field: '@daysToLoad', operator: 'gte', value: 0 },
        { field: '@daysToLoad', operator: 'lte', value: 14 },
        { field: '@checklist:pps', operator: 'eq', value: 'open' },
      ],
    })),
    /* PLM numune talepleri (CoreNectum Requests): Ex-factory yaklaşırken PPS
       hâlâ onaysız. Eşik (21 gün) kural düzenleyicisinden değiştirilebilir.
       PPS sorusu PLM onayı, aşama zinciri veya üretim sonrası sipariş
       aşamasıyla kapanır; açık kalması gerçekten onay olmadığı demektir. */
    Object.freeze(normalizeRule({
      id: 'builtin_action_pps_exfactory', builtIn: true, kind: 'priority', target: 'ACTION_THIS_WEEK',
      name: "Ex-factory'ye 21 gün kala PPS onayı yok",
      reasonTr: "Ex-factory yaklaşıyor, PPS onayı yok",
      reasonEn: 'Ex-factory is approaching without PPS approval',
      match: 'all',
      conditions: [
        { field: '@daysToLoad', operator: 'gte', value: 0 },
        { field: '@daysToLoad', operator: 'lte', value: 21 },
        { field: '@checklist:pps', operator: 'eq', value: 'open' },
      ],
    })),
    Object.freeze(normalizeRule({
      id: 'builtin_action_tests', builtIn: true, kind: 'priority', target: 'ACTION_THIS_WEEK',
      name: 'Gelecek hafta yüklenecek, test onayı işaretlenmemiş',
      reasonTr: 'Gelecek hafta yükleme var, testler işaretlenmemiş',
      reasonEn: 'Loading next week without test approvals',
      match: 'all',
      conditions: [
        { field: '@daysToLoad', operator: 'gte', value: 0 },
        { field: '@daysToLoad', operator: 'lte', value: 14 },
        { field: '@checklist:tests', operator: 'eq', value: 'open' },
      ],
    })),
  ]);

  /* Yerleşik checklist tanımları da aynı kural editörüne taşınır. Böylece
     kullanıcı ön tanımlı soruları görebilir, değiştirebilir, kapatabilir veya
     kullanıcı bazında silebilir. Kimlikler Checklist.ITEMS ile aynıdır; bu,
     mevcut cevap anahtarlarını ve @checklist:<id> priority koşullarını korur. */
  const DEFAULT_CHECKLIST_RULE_IDS = Object.freeze(
    (Array.isArray(Checklist.ITEMS) ? Checklist.ITEMS : []).map(item => item.id)
  );
  function checklistDefaultRule(item) {
    const stages = Array.isArray(item.stages) ? item.stages.slice() : [];
    const maxDays = Number(item.maxDaysToLoad);
    const minAge = item.minOrderAgeDays == null ? null : Number(item.minOrderAgeDays);
    const conditions = [
      { field: '@stage', operator: 'in', value: stages },
      { field: '@daysToLoad', operator: 'gte', value: -30 },
      { field: '@daysToLoad', operator: 'lte', value: Number.isFinite(maxDays) ? maxDays : 365 },
    ];
    if (Number.isFinite(minAge)) conditions.push({ field: '@orderAgeDays', operator: 'gte', value: minAge });
    const raw = {
      id: item.id, builtIn: true, kind: 'checklist', enabled: item.defaultEnabled !== false,
      name: item.tr || item.en || item.id, tr: item.tr || item.id, en: item.en || item.tr || item.id,
      questionTr: item.questionTr || item.tr || item.id,
      questionEn: item.questionEn || item.en || item.tr || item.id,
      match: 'all', conditions,
    };
    if (Number.isFinite(minAge)) {
      const stageArgs = stages.map(stage => JSON.stringify(String(stage))).join(',');
      const loadLimit = Number.isFinite(maxDays) ? maxDays : 365;
      raw.mode = 'formula';
      raw.formula = `=AND(IN([@stage],${stageArgs}),OR(ISBLANK([@daysToLoad]),[@daysToLoad]>=-30),OR([@daysToLoad]<=${loadLimit},[@orderAgeDays]>=${minAge}))`;
    }
    return Object.freeze(normalizeRule(raw));
  }
  const DEFAULT_CHECKLIST_RULES = Object.freeze(
    (Array.isArray(Checklist.ITEMS) ? Checklist.ITEMS : []).map(checklistDefaultRule)
  );
  const DEFAULT_RULES = Object.freeze([...DEFAULT_PRIORITY_RULES, ...DEFAULT_CHECKLIST_RULES]);

  /* --------------------------------------------------------------- gerçekler
     Bir sipariş için koşulların okuyacağı değerler. Ham satır alanları da
     dahildir; kullanıcının kendi hesaplamalı sütunu da böyle okunur. */
  function factsFor(analysis, checklistState) {
    const row = analysis && analysis.sourceRow ? analysis.sourceRow : {};
    return {
      derived: {
        '@daysToLoad': analysis.daysToLoad,
        '@orderAgeDays': analysis.orderAgeDays,
        '@stage': analysis.stage,
        '@deliveryOutcome': analysis.deliveryOutcome,
        '@basePriority': analysis.priority,
        '@scheduleBufferDays': analysis.scheduleBufferDays,
        '@transitRuleMissing': analysis.transitRuleMissing ? 'true' : 'false',
        '@qty': analysis.qty,
        '@loadingType': row['Del. Type'],
      },
      row,
      checklist: checklistState || {},
    };
  }

  function readField(field, facts) {
    if (DERIVED_IDS.has(field)) return facts.derived[field];
    if (field.indexOf(CHECKLIST_PREFIX) === 0) {
      const itemId = field.slice(CHECKLIST_PREFIX.length);
      return facts.checklist[itemId] || 'notApplicable';
    }
    return facts.row ? facts.row[field] : undefined;
  }

  function resolveOperand(operand, facts, options) {
    const item = operand || { type: 'value', value: '' };
    let value;
    if (item.type === 'field') value = readField(item.field, facts);
    else if (item.type === 'today') value = dateMarker(todayOrdinal((options && options.today) || (facts && facts.today)));
    else value = item.value;
    const baseDate = dateValue(value);
    let offset = 0;
    if (item.offsetField) offset = numericValue(readField(item.offsetField, facts)) || 0;
    if (item.offset) offset += Number(item.offset.value) * (item.offset.unit === 'weeks' ? 7 : 1);
    if (baseDate != null && offset) return dateMarker(baseDate + offset);
    return value;
  }

  function matchesCondition(condition, facts, options) {
    const item = normalizeCondition(condition);
    const left = resolveOperand(item.left, facts || {}, options || {});
    const right = resolveOperand(item.right, facts || {}, options || {});
    if (item.operator === 'empty') return blank(left);
    if (item.operator === 'notEmpty') return !blank(left);
    if (item.operator === 'in' || item.operator === 'notIn') {
      const values = listOf(item.right.type === 'value' ? item.right.value : right);
      const hit = values.some(value => compareValues(left, value, '='));
      return item.operator === 'in' ? hit : !hit;
    }
    if (item.operator === 'contains') return lower(left).includes(lower(right));
    const operator = ({ eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' })[item.operator] || '=';
    return compareValues(left, right, operator);
  }

  function matchesRule(rule, facts) {
    if (!rule.enabled) return false;
    if (rule.mode === 'formula') {
      let compiled = rule._compiledFormula;
      if (!compiled || rule._compiledFormulaSource !== rule.formula) {
        try {
          compiled = compileExpression(rule.formula);
          Object.defineProperty(rule, '_compiledFormula', { value: compiled, enumerable: false, configurable: true });
          Object.defineProperty(rule, '_compiledFormulaSource', { value: rule.formula, enumerable: false, configurable: true });
          if (Object.prototype.hasOwnProperty.call(rule, '_formulaError')) delete rule._formulaError;
        } catch (error) {
          Object.defineProperty(rule, '_formulaError', { value: error.message || String(error), enumerable: false, configurable: true });
          Object.defineProperty(rule, '_compiledFormulaSource', { value: rule.formula, enumerable: false, configurable: true });
          return false;
        }
      }
      if (!compiled || rule._formulaError) return false;
      const result = compiled.evaluate(facts || {}, { today: facts && facts.today });
      return !result.error && (typeof result.value === 'boolean' ? result.value : !blank(result.value));
    }
    if (!rule.conditions.length) return false;
    return rule.match === 'any'
      ? rule.conditions.some(condition => matchesCondition(condition, facts))
      : rule.conditions.every(condition => matchesCondition(condition, facts));
  }

  /* Öncelik kuralları: YALNIZ yükseltir (§2). Eşleşen kuralların adları
     döner ki kullanıcı bir siparişin neden Kritik olduğunu görebilsin. */
  function applyPriorityRules(analysis, rules, checklistState) {
    const list = (Array.isArray(rules) ? rules : []).filter(rule => rule.kind === 'priority');
    if (!list.length) return { priority: analysis.priority, matched: [], signals: [] };
    const facts = factsFor(analysis, checklistState);
    let priority = analysis.priority;
    const matched = [];
    const signals = [];
    for (const rule of list) {
      if (!matchesRule(rule, facts)) continue;
      matched.push(rule);
      const signal = {
        code: `CUSTOM_RULE:${rule.id}`,
        source: 'custom_rule',
        actionFloor: rule.target,
        textTr: rule.reasonTr || rule.name,
        textEn: rule.reasonEn || rule.name,
        ruleId: rule.id,
      };
      signals.push(signal);
      if (OD.moreUrgent) priority = OD.moreUrgent(priority, rule.target);
      else if (severityRank(rule.target) < severityRank(priority)) priority = rule.target;
    }
    return { priority, matched, signals };
  }

  /* Özel kontrol kuralları: koşulu sağlayan siparişe kendi sorusunu ekler.
     Kapsam koşulu buradadır — "yalnız şu lisanslar" gibi. */
  function customChecklistItems(analysis, rules, checklistState) {
    const list = (Array.isArray(rules) ? rules : []).filter(rule => rule.kind === 'checklist');
    if (!list.length) return [];
    const facts = factsFor(analysis, checklistState);
    return list.filter(rule => matchesRule(rule, facts)).map(rule => ({
      id: rule.id, group: 'custom', custom: true,
      tr: rule.tr || rule.name, en: rule.en || rule.name,
      questionTr: rule.questionTr || rule.name, questionEn: rule.questionEn || rule.name,
    }));
  }

  /* Koşulda seçilebilecek alanların listesi. Sabit değil: örnek satırların
     gerçek anahtarlarından üretilir, böylece kullanıcının CP'de kendi
     oluşturduğu hesaplamalı sütunlar da listede çıkar (§3). */
  function fieldCatalog(rows, options) {
    const opts = options || {};
    const sample = (Array.isArray(rows) ? rows : []).slice(0, 50);
    const seen = new Map();
    const cleanLabel = value => text(value);
    const humanLabel = value => {
      const source = text(value).replace(/^__f_/, '').replace(/^cp:/, '');
      if (!source) return '';
      return source
        .replace(/[_-]+/g, ' ')
        .replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase('tr-TR'));
    };
    const columnCatalog = new Map(
      (Array.isArray(opts.columnCatalog) ? opts.columnCatalog : [])
        .filter(item => item && text(item.key || item.id))
        .map(item => [text(item.key || item.id), item])
    );
    const metaFor = key => columnCatalog.get(key) || {};
    const entryFor = (key, fallbackSource) => {
      const meta = metaFor(key);
      const label = cleanLabel(meta.displayName || meta.label || meta.title || meta.header || meta.headerName || meta.name || meta.fieldName || meta.key)
        || humanLabel(key) || key;
      const dataType = lower(meta.dataType || meta.type);
      return {
        id: key,
        tr: label,
        en: label,
        source: fallbackSource || (meta.formulaCustom ? 'formula' : 'column'),
        type: dataType || '',
        numeric: meta.numeric === true || /^(number|numeric|integer|int|decimal|money|percent|percentage|pct)$/.test(dataType),
        date: meta.date === true || /^(date|datetime|timestamp)$/.test(dataType),
      };
    };

    // Canlı CP sütun kaydı birincil metadata kaynağıdır. Böylece bir sütunun
    // aktif ilk 50 satırda değeri olmasa bile Field listesinde doğru etiketiyle
    // görünür; yalnız CP'nin gerçekten kullanıcıya sunduğu kolonlar alınır.
    for (const [key, meta] of columnCatalog.entries()) {
      if (key.indexOf('_') === 0 && !meta.formulaCustom && !meta.modelCustom) continue;
      seen.set(key, entryFor(key, meta.formulaCustom ? 'formula' : 'column'));
    }
    for (const row of sample) {
      for (const key of Object.keys(row || {})) {
        if (key.indexOf('_') === 0) continue;          // iç alanlar
        if (seen.has(key)) continue;
        seen.set(key, entryFor(key, 'column'));
      }
    }
    // Hesaplamalı sütunlar teknik anahtarla (__f_<id>) durur; kullanıcı onları
    // KENDİ VERDİĞİ ADLA görmeli. Formula Columns tanımı `label` kullanır;
    // eski `name` fallback'i geriye dönük uyumluluk içindir.
    for (const definition of (Array.isArray(opts.formulaColumns) ? opts.formulaColumns : [])) {
      const key = `__f_${definition.id}`;
      const label = cleanLabel(definition.label || definition.name) || cleanLabel(metaFor(key).label) || humanLabel(key) || key;
      const dataType = lower(definition.dataType || definition.format || metaFor(key).dataType || metaFor(key).type);
      seen.set(key, {
        ...entryFor(key, 'formula'),
        tr: label,
        en: label,
        type: dataType || '',
        numeric: /^(number|numeric|integer|int|decimal|money|percent|percentage|pct)$/.test(dataType),
        date: /^(date|datetime|timestamp)$/.test(dataType),
      });
    }
    const columns = [...seen.values()]
      .map(item => ({ ...item, tr: cleanLabel(item.tr) || humanLabel(item.id) || item.id, en: cleanLabel(item.en) || cleanLabel(item.tr) || humanLabel(item.id) || item.id }))
      .sort((a, b) => String(a.tr).localeCompare(String(b.tr), 'tr-TR', { sensitivity: 'base' }));
    const checklist = (Array.isArray(opts.checklistItems) ? opts.checklistItems : []).map(item => ({
      id: `${CHECKLIST_PREFIX}${item.id}`, tr: `Kontrol: ${item.tr}`, en: `Check: ${item.en}`, source: 'checklist',
    }));
    return { derived: DERIVED_FIELDS.slice(), checklist, columns };
  }

  function normalizeRules(raw) {
    const list = (Array.isArray(raw) ? raw : []).slice(0, 100).map(item => normalizeRule(item));
    const seen = new Set();
    return list.filter(rule => {
      if (seen.has(rule.id)) return false;
      seen.add(rule.id);
      return true;
    });
  }

  function validateRule(rule, options) {
    const item = normalizeRule(rule);
    if (item.mode !== 'formula') {
      const errors = [];
      if (!item.conditions.length) errors.push('En az bir koşul ekleyin');
      return { valid: errors.length === 0, errors, rule: item };
    }
    const catalog = options && Array.isArray(options.fields) ? options : undefined;
    const result = validateExpression(item.formula, catalog);
    return { ...result, rule: item };
  }

  /* Kaydedilmiş kurallar ile yerleşikleri birleştirir. Kullanıcı yerleşik bir
     kuralı kapatmış ya da eşiğini değiştirmişse KAYDI kazanır; hiç dokunmadığı
     yerleşikler güncel tanımıyla gelir (yeni sürümde eklenen kural kaybolmaz). */
  function mergeWithDefaults(savedRules, deletedRuleIds) {
    const deleted = new Set((Array.isArray(deletedRuleIds) ? deletedRuleIds : []).map(text).filter(Boolean));
    const saved = normalizeRules(savedRules).filter(rule => !deleted.has(rule.id));
    const byId = new Map(saved.map(rule => [rule.id, rule]));
    const merged = DEFAULT_RULES
      .filter(rule => !deleted.has(rule.id))
      .map(rule => (byId.has(rule.id) ? byId.get(rule.id) : normalizeRule(rule)));
    for (const rule of saved) {
      if (!DEFAULT_RULES.some(item => item.id === rule.id)) merged.push(rule);
    }
    return merged;
  }

  return {
    SEVERITY, severityRank, OPERATORS, OPERATOR_IDS, DERIVED_FIELDS, CHECKLIST_PREFIX, CHECKLIST_STATES,
    DEFAULT_RULES, DEFAULT_PRIORITY_RULES, DEFAULT_CHECKLIST_RULES, DEFAULT_CHECKLIST_RULE_IDS,
    normalizeCondition, normalizeRule, normalizeRules, conditionsToFormula, formulaToConditions, validateRule, mergeWithDefaults,
    compileExpression, evaluateExpression, validateExpression,
    factsFor, readField, matchesCondition, matchesRule,
    applyPriorityRules, customChecklistItems, fieldCatalog,
  };
});
