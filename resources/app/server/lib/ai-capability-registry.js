'use strict';

const crypto = require('node:crypto');
const { APP_VERSION } = require('./app-version');
const canonicalFields = require('../../public/canonical-fields');
const moduleRegistry = require('./module-registry');
const modelFields = require('./model-fields');
const intakeReport = require('./intake-report');

const AUTOMATION_LANGUAGE_VERSION = '1.0';
const CAPABILITY_SCHEMA_VERSION = 1;
const DATASET_IDS = Object.freeze(['cp', 'orders', 'backlog', 'lfl', 'collection', 'asas', 'ias', 'intake']);
const REFRESHABLE_DATASETS = Object.freeze(['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
const DATASET_LABELS = Object.freeze({
  cp: { tr: 'CP Tracker', en: 'CP Tracker' },
  orders: { tr: 'Siparişler', en: 'Orders' },
  backlog: { tr: 'Backlog', en: 'Backlog' },
  lfl: { tr: 'LFL Analizi', en: 'LFL Analysis' },
  collection: { tr: 'Koleksiyon', en: 'Collection' },
  asas: { tr: 'ASAS', en: 'ASAS' },
  ias: { tr: 'Antrepo / IAS', en: 'Warehouse / IAS' },
  intake: { tr: 'INTAKE', en: 'INTAKE' },
});

const OPERATORS = Object.freeze([
  { id: 'eq', syntax: '=' }, { id: 'neq', syntax: '!=' }, { id: 'gt', syntax: '>' },
  { id: 'gte', syntax: '>=' }, { id: 'lt', syntax: '<' }, { id: 'lte', syntax: '<=' },
  { id: 'contains', syntax: 'CONTAINS' }, { id: 'not_contains', syntax: 'NOT_CONTAINS' },
  { id: 'in', syntax: 'IN' }, { id: 'between', syntax: 'BETWEEN' },
  { id: 'empty', syntax: 'IS_BLANK' }, { id: 'not_empty', syntax: 'IS_NOT_BLANK' },
]);

const FUNCTIONS = Object.freeze([
  { id: 'DAYS_UNTIL', returnType: 'number', args: ['date'] },
  { id: 'ISBLANK', returnType: 'boolean', args: ['any'] },
  { id: 'ISNOTBLANK', returnType: 'boolean', args: ['any'] },
]);

/* These are the only actions the AI language can name. Existing browser
   terminal code is deliberately not part of this registry. */
const ACTIONS = Object.freeze([
  {
    id: 'SEND_EMAIL', riskLevel: 'external', permission: 'automations',
    parameters: ['RECIPIENT_GROUP', 'SUBJECT', 'INCLUDE_MATCHING_ROWS', 'ATTACHMENT'],
    description: 'Creates a draft or sends through the existing controlled Outlook path after user approval.',
  },
  {
    id: 'OPEN_PAGE', riskLevel: 'read', permission: 'automations',
    parameters: ['MODULE'], description: 'Opens an existing Buyer Log module.'
  },
  {
    id: 'REFRESH_SOURCE', riskLevel: 'operational', permission: 'source',
    parameters: ['SOURCE'], allowedSources: REFRESHABLE_DATASETS.slice(), description: 'Uses the existing Buyer Log source refresh path.'
  },
  {
    id: 'SHOW_REPORT', riskLevel: 'read', permission: 'automations',
    parameters: ['TITLE'], description: 'Shows a result summary inside Buyer Log.'
  },
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function key(value) { return clean(value).replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => ({ ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' }[ch] || ch)).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim(); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function capabilityHash(model) { return crypto.createHash('sha256').update(stable(model), 'utf8').digest('hex').slice(0, 16); }

function canonicalFieldEntries() {
  const fields = canonicalFields && canonicalFields.fields || {};
  return Object.entries(fields).map(([id, field]) => ({
    id,
    label: field.label || { tr: id, en: id },
    type: field.type || 'text',
    role: field.role || 'attribute',
    aliases: Array.isArray(field.aliases) ? field.aliases.slice() : [],
    sources: Object.keys(field.modules || {}).filter(source => DATASET_IDS.includes(source)),
  })).filter(field => field.sources.length);
}

function sourceSpecificFields(source) {
  const wanted = clean(source).toLowerCase();
  if (wanted === 'intake') {
    return intakeReport.defaultFields().map(field => ({
      id: field.id,
      label: { tr: field.defaultLabel, en: field.defaultLabel },
      type: field.fieldType === 'measure' ? 'number' : (field.dataType || 'text'),
      role: field.fieldType === 'measure' ? 'measure' : 'dimension',
      aliases: [field.defaultLabel, field.sourceLabel, field.sourceUniqueName].filter(Boolean),
      sources: ['intake'],
      sourceUniqueName: field.sourceUniqueName,
    }));
  }
  if (wanted === 'asas' || wanted === 'ias') {
    const role = wanted === 'ias' ? 'antrepo' : 'asas';
    return modelFields.fieldsForRole(role).map(field => ({
      id: `${wanted}.${key(field.header).replace(/ /g, '_')}`,
      label: { tr: field.header, en: field.header },
      type: /tarih|date/i.test(field.header) ? 'date' : 'text',
      role: 'attribute', aliases: [field.header, ...(field.aliases || [])], sources: [wanted],
    }));
  }
  return canonicalFieldEntries().filter(field => field.sources.includes(wanted));
}

function allFields() {
  const byId = new Map();
  for (const field of canonicalFieldEntries()) byId.set(field.id, field);
  for (const source of ['asas', 'ias', 'intake']) for (const field of sourceSpecificFields(source)) byId.set(field.id, field);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function resolveField(ref, source) {
  const wanted = clean(ref);
  if (!wanted) return null;
  const sourceFields = sourceSpecificFields(source);
  const exact = sourceFields.find(field => field.id === wanted || key(field.label.tr) === key(wanted) || key(field.label.en) === key(wanted) || field.aliases.some(alias => key(alias) === key(wanted)));
  return exact ? clone(exact) : null;
}

function getCapabilityModel() {
  const datasets = DATASET_IDS.map(id => {
    const module = moduleRegistry.get(id);
    return {
      id,
      label: DATASET_LABELS[id] || { tr: id, en: id },
      fields: sourceSpecificFields(id).map(field => field.id),
      capabilities: module ? module.capabilities.slice() : (id === 'intake' ? ['read', 'filter', 'analyze', 'automate'] : ['read', 'filter', 'analyze']),
    };
  });
  const base = {
    appVersion: APP_VERSION,
    automationLanguageVersion: AUTOMATION_LANGUAGE_VERSION,
    capabilitySchemaVersion: CAPABILITY_SCHEMA_VERSION,
    canonicalFieldRegistryVersion: canonicalFields.version || '',
    datasets,
    fields: allFields(),
    operators: OPERATORS.map(clone),
    functions: FUNCTIONS.map(clone),
    actions: ACTIONS.map(clone),
    triggers: [
      { id: 'MANUAL', parameters: [] },
      { id: 'DAILY', parameters: ['AT'] },
      { id: 'WEEKLY', parameters: ['ON', 'AT'] },
      { id: 'INTERVAL', parameters: ['HOURS'] },
    ],
  };
  return { ...base, capabilityHash: capabilityHash(base) };
}

module.exports = {
  AUTOMATION_LANGUAGE_VERSION,
  CAPABILITY_SCHEMA_VERSION,
  DATASET_IDS,
  REFRESHABLE_DATASETS,
  OPERATORS,
  FUNCTIONS,
  ACTIONS,
  getCapabilityModel,
  resolveField,
  sourceSpecificFields,
  capabilityHash,
};
