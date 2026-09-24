'use strict';

const fs = require('fs');
const path = require('path');

function integrityError(file, errors) {
  const detail = errors.map(item => `${path.basename(item.file)}: ${item.error && item.error.message || item.error}`).join('; ');
  return Object.assign(new Error(`${path.basename(file)} okunamadı; mevcut veri korunuyor. ${detail}`), {
    code: 'DATA_INTEGRITY_ERROR', statusCode: 503, file, errors,
  });
}

function readJsonWithValidatedBackup(file, { fallback, normalize = value => value, restore } = {}) {
  const primaryExists = fs.existsSync(file), backup = `${file}.bak`, backupExists = fs.existsSync(backup);
  if (!primaryExists && !backupExists) return typeof fallback === 'function' ? fallback() : fallback;
  const errors = [];
  for (const candidate of [file, backup]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const value = normalize(JSON.parse(fs.readFileSync(candidate, 'utf8')));
      if (candidate === backup && typeof restore === 'function') {
        if (fs.existsSync(file)) fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        restore(value);
      }
      return value;
    } catch (error) { errors.push({ file: candidate, error }); }
  }
  throw integrityError(file, errors);
}

module.exports = { readJsonWithValidatedBackup, integrityError };
