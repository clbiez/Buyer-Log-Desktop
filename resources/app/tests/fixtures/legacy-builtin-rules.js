'use strict';

/* 2026-11-21 — yerleşik öncelik/checklist kuralları üründen kaldırıldı.
   Parite ve read-model testleri dolu (boş olmayan) veride koşmak için eski
   yerleşik tanımların AYNISINI kullanıcı kuralı (builtIn:false) olarak kurar.
   Ürün kodu bu dosyayı kullanmaz. */

const Checklist = require('../../public/cp-checklist-engine');
const Rules = require('../../public/cp-rules-engine');

const LOAD_SOON = [
  { field: '@daysToLoad', operator: 'gte', value: 0 },
  { field: '@daysToLoad', operator: 'lte', value: 14 },
];
const PRIORITY = [
  { id: 'fx_critical_late', target: 'CRITICAL', name: 'Late', reasonTr: 'Geç', reasonEn: 'Late', conditions: [
    { field: '@daysToLoad', operator: 'lt', value: 0 },
    { field: '@deliveryOutcome', operator: 'in', value: ['EXPECTED_LATE', 'ALREADY_LATE'] },
  ] },
  { id: 'fx_action_confirmation', target: 'ACTION_THIS_WEEK', name: 'Confirmation', conditions: [...LOAD_SOON,
    { field: '@checklist:supplierConfirmation', operator: 'in', value: ['open', 'rejected'] }] },
  { id: 'fx_action_samples', target: 'ACTION_THIS_WEEK', name: 'Samples', conditions: [...LOAD_SOON,
    { field: '@checklist:pps', operator: 'in', value: ['open', 'rejected'] }] },
  { id: 'fx_action_pps_exfactory', target: 'ACTION_THIS_WEEK', name: 'PPS', conditions: [
    { field: '@daysToLoad', operator: 'gte', value: 0 },
    { field: '@daysToLoad', operator: 'lte', value: 21 },
    { field: '@checklist:pps', operator: 'in', value: ['open', 'rejected'] }] },
  { id: 'fx_action_tests', target: 'ACTION_THIS_WEEK', name: 'Tests', conditions: [...LOAD_SOON,
    { field: '@checklist:tests', operator: 'in', value: ['open', 'rejected'] }] },
];

function priorityRules() {
  return PRIORITY.map(rule => Rules.normalizeRule({ ...rule, kind: 'priority', match: 'all' }));
}

/* Eski checklistDefaultRule ile aynı kapsam: aşama + yükleme penceresi
   (+ varsa sipariş yaşı). Kimlikler Checklist.ITEMS ile aynıdır. */
function checklistRules() {
  return Checklist.ITEMS.map(item => {
    const stages = item.stages.slice();
    const maxDays = Number(item.maxDaysToLoad);
    const minAge = item.minOrderAgeDays == null ? null : Number(item.minOrderAgeDays);
    const raw = {
      id: item.id, kind: 'checklist', enabled: item.defaultEnabled !== false, approvalScope: 'order',
      name: item.tr, nameEn: item.en, tr: item.tr, en: item.en, questionTr: item.questionTr, questionEn: item.questionEn,
      match: 'all', conditions: [
        { field: '@stage', operator: 'in', value: stages },
        { field: '@daysToLoad', operator: 'gte', value: -30 },
        { field: '@daysToLoad', operator: 'lte', value: maxDays },
      ],
    };
    if (Number.isFinite(minAge)) {
      raw.mode = 'formula';
      raw.formula = `=AND(IN([@stage],${stages.map(s => JSON.stringify(s)).join(',')}),OR(ISBLANK([@daysToLoad]),[@daysToLoad]>=-30),OR([@daysToLoad]<=${maxDays},[@orderAgeDays]>=${minAge}))`;
    }
    return Rules.normalizeRule(raw);
  });
}

/* Tercih deposu kayıtları (cp-overview-assistant RULE_KEYS biçimi). */
function storeEntries({ extraPriority = [], priorityCatalog } = {}) {
  return {
    'lcw.cp.rules.priority.v1': JSON.stringify({ version: 2, rules: [...extraPriority, ...priorityRules()], deletedRuleIds: [], ...(priorityCatalog ? { priorityCatalog } : {}) }),
    'lcw.cp.rules.checklist.v1': JSON.stringify({ version: 2, rules: checklistRules(), deletedRuleIds: [] }),
  };
}

module.exports = { priorityRules, checklistRules, storeEntries };
