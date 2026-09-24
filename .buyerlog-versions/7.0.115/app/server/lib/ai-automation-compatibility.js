'use strict';

const registry = require('./ai-capability-registry');

function clean(value) { return String(value == null ? '' : value).trim(); }

function check(recipe, model = registry.getCapabilityModel()) {
  const ai = recipe && recipe.ai;
  if (!ai || ai.origin !== 'ai_import') return { compatible: true, status: 'not_ai', reasons: [] };
  const reasons = [];
  if (Number(ai.capabilitySchemaVersion || 0) !== Number(model.capabilitySchemaVersion)) reasons.push('capability_schema_changed');
  if (clean(ai.languageVersion) !== clean(model.automationLanguageVersion)) reasons.push('language_version_changed');
  const definition = ai.definition && typeof ai.definition === 'object' ? ai.definition : {};
  if (!model.datasets.some(dataset => dataset.id === clean(definition.source).toLowerCase())) reasons.push('dataset_removed');
  for (const condition of Array.isArray(definition.conditions) ? definition.conditions : []) {
    const ref = condition.kind === 'function' ? condition.args && condition.args[0] : condition.field;
    if (!registry.resolveField(ref, definition.source)) reasons.push(`field_removed:${clean(ref)}`);
  }
  for (const action of Array.isArray(definition.actions) ? definition.actions : []) {
    if (!model.actions.some(item => item.id === clean(action.type))) reasons.push(`action_removed:${clean(action.type)}`);
  }
  if (reasons.length) return { compatible: false, status: 'needs_review', reasons };
  if (clean(ai.capabilityHash) && clean(ai.capabilityHash) !== clean(model.capabilityHash)) return { compatible: true, status: 'capability_drift', reasons: ['capability_hash_changed'] };
  return { compatible: true, status: 'current', reasons: [] };
}

module.exports = { check };
