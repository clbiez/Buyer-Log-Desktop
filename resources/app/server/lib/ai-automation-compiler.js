'use strict';

const { APP_VERSION } = require('./app-version');
const registry = require('./ai-capability-registry');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function weekdayNumber(value) {
  const names = { SUNDAY: 0, PAZAR: 0, MONDAY: 1, PAZARTESI: 1, TUESDAY: 2, SALI: 2, WEDNESDAY: 3, CARSAMBA: 3, THURSDAY: 4, PERSEMBE: 4, FRIDAY: 5, CUMA: 5, SATURDAY: 6, CUMARTESI: 6 };
  return names[clean(value).toLocaleUpperCase('en-US').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')];
}

function scheduleFromTrigger(trigger) {
  const value = trigger || { type: 'MANUAL' };
  if (value.type === 'DAILY') return { enabled: false, mode: 'daily', time: value.time, weekdays: [1], intervalHours: 24 };
  if (value.type === 'WEEKLY') return { enabled: false, mode: 'weekly', time: value.time, weekdays: [weekdayNumber(value.weekday)].filter(Number.isFinite), intervalHours: 24 };
  if (value.type === 'INTERVAL') return { enabled: false, mode: 'interval', time: '09:00', weekdays: [1], intervalHours: value.hours };
  return { enabled: false, mode: 'manual', time: '09:00', weekdays: [1], intervalHours: 24 };
}

function appActions(actions) {
  return (Array.isArray(actions) ? actions : []).flatMap(action => {
    if (action.type === 'OPEN_PAGE') return [{ action: 'open_page', page: clean(action.MODULE), source: '', label: clean(action.MODULE) }];
    if (action.type === 'REFRESH_SOURCE') return [{ action: 'refresh_source', page: '', source: clean(action.SOURCE).toLowerCase(), label: clean(action.SOURCE) }];
    if (action.type === 'SHOW_REPORT') return [{ action: 'show_report', page: '', source: '', label: clean(action.TITLE) }];
    return [];
  });
}

function compile(ast, validation, options = {}) {
  if (!ast || !validation || validation.ok !== true) {
    const error = new Error('Automation Code doğrulanmadan taslağa dönüştürülemez.');
    error.code = 'AI_AUTOMATION_VALIDATION_REQUIRED';
    error.details = validation && validation.errors || [];
    throw error;
  }
  const sourceCode = clean(options.sourceCode);
  if (sourceCode.length > 120000) {
    const error = new Error('Automation Code 120000 karakter sınırını aşamaz.');
    error.code = 'AI_AUTOMATION_CODE_TOO_LARGE';
    throw error;
  }
  const actions = Array.isArray(ast.actions) ? ast.actions : [];
  const emailAction = actions.find(action => action.type === 'SEND_EMAIL') || null;
  const hasAppActions = actions.some(action => action.type !== 'SEND_EMAIL');
  const emailGroupId = clean(options.emailGroupId);
  // RECIPIENT_FIELD [Üretici] → alana göre bölünmüş alıcı; köşeli parantez
  // yazılmış olsa da alan adı olarak saklanır.
  const recipientField = emailAction ? clean(emailAction.RECIPIENT_FIELD).replace(/^\[|\]$/g, '').trim() : '';
  if (emailAction && !recipientField && String(emailAction.RECIPIENT_GROUP || '').toUpperCase() === 'ASK_USER' && !emailGroupId) {
    const error = new Error('E-posta grubu seçilmeden taslak oluşturulamaz.');
    error.code = 'AI_AUTOMATION_INPUT_REQUIRED';
    error.details = { requiredInputs: ['EMAIL_GROUP'] };
    throw error;
  }
  const definition = {
    languageVersion: ast.languageVersion,
    name: ast.name,
    trigger: clone(ast.trigger),
    source: ast.source,
    conditions: clone(ast.conditions),
    actions: clone(ast.actions),
    requiredInputs: clone(ast.requiredInputs || []),
  };
  return {
    name: ast.name || 'AI otomasyon taslağı',
    description: 'Buyer Log Automation Code ile oluşturuldu. İnceleme ve açık aktivasyon gerekir.',
    enabled: false,
    purpose: emailAction && hasAppActions ? 'mixed' : (emailAction ? 'email' : (hasAppActions ? 'app' : 'analysis')),
    source: ast.source,
    filters: [],
    limit: 50,
    email: emailAction ? {
      groupId: recipientField ? '' : (emailGroupId || clean(emailAction.RECIPIENT_GROUP)),
      recipientMode: recipientField ? 'field' : 'group',
      recipientField,
      subject: clean(emailAction.SUBJECT) || ast.name || 'Buyer Log Raporu',
      body: '',
      includeReport: emailAction.INCLUDE_MATCHING_ROWS !== false,
      reportFields: [],
      deliveryMode: 'draft',
      openDraftOnManual: true,
      languageMode: 'tr',
      subjectEn: '',
      bodyEn: '',
    } : {},
    schedule: scheduleFromTrigger(ast.trigger),
    appActions: appActions(actions),
    steps: [],
    terminalCode: '',
    ai: {
      origin: 'ai_import',
      status: 'draft',
      appVersion: APP_VERSION,
      capabilitySchemaVersion: registry.CAPABILITY_SCHEMA_VERSION,
      capabilityHash: validation.capabilityHash || registry.getCapabilityModel().capabilityHash,
      languageVersion: ast.languageVersion,
      sourceCode,
      definition,
    },
  };
}

module.exports = { compile, scheduleFromTrigger };
