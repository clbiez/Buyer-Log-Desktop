'use strict';

/* Scheduled refresh is an operational preference, not proof that a configured
   INTAKE connection is unusable. Manual Overview reads must retain the latter. */
function configuredIntakeConnections(items) {
  return (Array.isArray(items) ? items : []).filter(item => item
    && item.role === 'intake'
    && String(item.server || '').trim()
    && String(item.catalog || '').trim());
}

function selectIntakeConnection(items) {
  const candidates = configuredIntakeConnections(items);
  return candidates.find(item => item.refreshEnabled !== false) || candidates[0] || null;
}

module.exports = { configuredIntakeConnections, selectIntakeConnection };
