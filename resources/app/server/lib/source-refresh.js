'use strict';

const fs = require('fs');
const path = require('path');
const { refreshExcelFile } = require('./refreshExcel');

const MIN_REFRESH_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_REFRESH_TIMEOUT_MS = 20 * 60 * 1000;
const EXTRA_PER_MIB_MS = 4000;

function fileSizeSafe(filePath) {
  try { return Number(fs.statSync(filePath).size) || 0; }
  catch (_) { return 0; }
}

function computeRefreshTimeoutMs(filePath, configuredMs) {
  const configured = Number(configuredMs) > 0 ? Number(configuredMs) : 0;
  const sizeMiB = fileSizeSafe(filePath) / (1024 * 1024);
  const sizeAware = MIN_REFRESH_TIMEOUT_MS + Math.ceil(sizeMiB * EXTRA_PER_MIB_MS);
  return Math.min(MAX_REFRESH_TIMEOUT_MS, Math.max(MIN_REFRESH_TIMEOUT_MS, configured, sizeAware));
}

function safeErrorReason(file, error) {
  const name = file && file.name ? file.name : path.basename(file && file.full || '');
  const full = String(file && file.full || '');
  let raw = String(error && error.message || error || '').replace(/\s+/g, ' ').trim();
  if (full) raw = raw.split(full).join(name || 'kaynak dosya');
  return raw.length > 420 ? raw.slice(0, 417) + '…' : raw;
}
function safeFailureMessage(source, file, error) {
  const label = source === 'ASAS' ? 'ASAS' : 'Antrepo';
  const name = file && file.name ? file.name : path.basename(file && file.full || '');
  const reason = safeErrorReason(file, error);
  return `${label} Excel iç yenilemesi tamamlanamadı (${name || 'dosya'}). Dosyanın mevcut kayıtlı hali okunmaya devam edildi.${reason ? ` Neden: ${reason}` : ''}`;
}

async function refreshSourceWorkbooks(found, options = {}) {
  const enabled = options.enabled !== false;
  const refreshFn = options.refreshFn || refreshExcelFile;
  const configuredTimeoutMs = options.configuredTimeoutMs;
  const result = { enabled, attempted: 0, succeeded: 0, failed: 0, warnings: [], files: [] };
  if (!enabled) return result;

  const sources = [
    ['ASAS', found && found.asas],
    ['ANTREPO', found && found.antrepo],
  ];
  for (const [source, file] of sources) {
    if (!file || !file.full) continue;
    const timeoutMs = computeRefreshTimeoutMs(file.full, configuredTimeoutMs);
    result.attempted += 1;
    try {
      const output = await refreshFn(file.full, timeoutMs);
      result.succeeded += 1;
      result.files.push({ source, name: file.name, ok: true, timeoutMs, output: String(output || '') });
    } catch (error) {
      result.failed += 1;
      const warning = safeFailureMessage(source, file, error);
      result.warnings.push(warning);
      result.files.push({ source, name: file.name, ok: false, timeoutMs, errorCode: error && error.code || 'EXCEL_REFRESH_FAILED', error: safeErrorReason(file, error) });
    }
  }
  return result;
}

function computeParseTimeoutMs(found, configuredMs) {
  const paths = [found && found.asas && found.asas.full, found && found.antrepo && found.antrepo.full, found && found.cpupdate && found.cpupdate.full].filter(Boolean);
  const totalMiB = paths.reduce((sum, file) => sum + fileSizeSafe(file), 0) / (1024 * 1024);
  const configured = Number(configuredMs) > 0 ? Number(configuredMs) : 0;
  const sizeAware = 5 * 60 * 1000 + Math.ceil(totalMiB * 3500);
  return Math.min(20 * 60 * 1000, Math.max(5 * 60 * 1000, configured, sizeAware));
}

module.exports = {
  MIN_REFRESH_TIMEOUT_MS,
  MAX_REFRESH_TIMEOUT_MS,
  computeRefreshTimeoutMs,
  computeParseTimeoutMs,
  refreshSourceWorkbooks,
};
