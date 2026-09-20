'use strict';

const fs = require('fs');

const DEFAULT_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 6194,
  refreshWithExcel: true,
  excelRefreshTimeoutMs: 600000,
  sharedDataRoot: '',
  sourceQueryTimeoutMs: { asas: 900000, ias: 900000 },
  powerBiDashboardBatchSize: 250,
  powerBiDashboardMaxRetries: 2,
  powerBiDashboardBackoffMs: 500,
});

function normalizeConfig(raw, defaults = DEFAULT_CONFIG) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const merged = { ...defaults, ...source };
  const port = Number(merged.port);
  merged.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : defaults.port;
  merged.host = typeof merged.host === 'string' && merged.host.trim() ? merged.host.trim() : defaults.host;
  merged.refreshWithExcel = merged.refreshWithExcel !== false;
  const timeout = Number(merged.excelRefreshTimeoutMs);
  merged.excelRefreshTimeoutMs = Number.isFinite(timeout) && timeout >= 30000 && timeout <= 3600000
    ? Math.round(timeout)
    : defaults.excelRefreshTimeoutMs;
  merged.sharedDataRoot = typeof merged.sharedDataRoot === 'string' ? merged.sharedDataRoot.trim() : '';
  const timeoutMap = merged.sourceQueryTimeoutMs && typeof merged.sourceQueryTimeoutMs === 'object' ? merged.sourceQueryTimeoutMs : {};
  merged.sourceQueryTimeoutMs = {
    asas: Math.max(60000, Math.min(3600000, Number(timeoutMap.asas) || defaults.sourceQueryTimeoutMs.asas)),
    ias: Math.max(60000, Math.min(3600000, Number(timeoutMap.ias) || defaults.sourceQueryTimeoutMs.ias)),
  };
  const dashboardBatch = Number(merged.powerBiDashboardBatchSize);
  merged.powerBiDashboardBatchSize = Number.isFinite(dashboardBatch) ? Math.max(1, Math.min(500, Math.round(dashboardBatch))) : defaults.powerBiDashboardBatchSize;
  const dashboardRetries = Number(merged.powerBiDashboardMaxRetries);
  merged.powerBiDashboardMaxRetries = Number.isFinite(dashboardRetries) ? Math.max(0, Math.min(5, Math.round(dashboardRetries))) : defaults.powerBiDashboardMaxRetries;
  const dashboardBackoff = Number(merged.powerBiDashboardBackoffMs);
  merged.powerBiDashboardBackoffMs = Number.isFinite(dashboardBackoff) ? Math.max(0, Math.min(30000, Math.round(dashboardBackoff))) : defaults.powerBiDashboardBackoffMs;
  return merged;
}

function loadRuntimeConfig(file, options = {}) {
  const defaults = normalizeConfig(options.defaults || DEFAULT_CONFIG, DEFAULT_CONFIG);
  if (!file || !fs.existsSync(file)) return { config: defaults, found: false, warning: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { config: normalizeConfig(parsed, defaults), found: true, warning: null };
  } catch (error) {
    return {
      config: defaults,
      found: true,
      warning: `config.json okunamadı; güvenli varsayılanlar kullanılıyor: ${error.message}`,
      error,
    };
  }
}

module.exports = { DEFAULT_CONFIG, normalizeConfig, loadRuntimeConfig };
