'use strict';

const modelFields = require('./model-fields');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function isAsasConnection(item) {
  return Boolean(item && item.role !== 'antrepo' && item.role !== 'fabric' && clean(item.server) && clean(item.catalog));
}

function targetScope(item, target) {
  const wanted = clean(target).toLowerCase();
  if (!wanted) return null;
  return (Array.isArray(item && item.scopes) ? item.scopes : []).find(scope =>
    scope && scope.enabled !== false
    && (Array.isArray(scope.targets) ? scope.targets : []).some(value => clean(value).toLowerCase() === wanted)) || null;
}

function selectConnection(items, target) {
  const connections = (Array.isArray(items) ? items : []).filter(isAsasConnection);
  const wanted = clean(target).toLowerCase();
  if (wanted) {
    return connections.find(item => item.refreshEnabled !== false && targetScope(item, wanted))
      || connections.find(item => targetScope(item, wanted))
      || null;
  }
  return connections.find(item => item.refreshEnabled !== false) || connections[0] || null;
}

/**
 * Resolve a page Horizon's canonical Buyer Log field to the configured ASAS
 * database column. No column name is guessed: an explicit canonical mapping is
 * required before a database query may be built.
 */
function resolveHorizonValueSource(items, target, canonicalHeader) {
  const header = clean(canonicalHeader);
  const connection = selectConnection(items, target);
  if (!connection || !header) return null;

  const scope = targetScope(connection, target);
  const fallbackTable = clean(scope && scope.horizon && scope.horizon.table)
    || clean(connection.horizon && connection.horizon.table);
  const mapping = connection.mapping && typeof connection.mapping === 'object' ? connection.mapping : {};
  const entry = modelFields.normalizeMappingEntry(mapping[header], fallbackTable);
  if (!entry || entry.kind === 'measure' || !clean(entry.table) || !clean(entry.name)) return null;

  return {
    connectionId: clean(connection.id),
    server: clean(connection.server),
    catalog: clean(connection.catalog),
    table: clean(entry.table),
    field: clean(entry.name),
  };
}

function resolveDynamicHorizonValueSource(items, target, table, field) {
  const connection = selectConnection(items, target);
  const wantedTable = clean(table), wantedField = clean(field);
  if (!connection || !wantedTable || !wantedField) return null;
  return {
    connectionId: clean(connection.id), server: clean(connection.server), catalog: clean(connection.catalog),
    table: wantedTable, field: wantedField,
  };
}

module.exports = { resolveHorizonValueSource, resolveDynamicHorizonValueSource, selectConnection };
