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

// Async request path. Recovery is opt-in: ordinary reads may use the verified
// backup without mutating a file outside its caller's write lease.
async function readJsonWithValidatedBackupAsync(file, { fallback, normalize = value => value, restore, beforeRestore } = {}) {
  const fsp = require('fs/promises'), errors = [];
  let found = false;
  for (const candidate of [file, `${file}.bak`]) {
    let bytes;
    try { bytes = await fsp.readFile(candidate, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') { found = true; errors.push({ file: candidate, error }); } continue; }
    found = true;
    let value;
    try { value = normalize(JSON.parse(bytes)); }
    catch (error) { errors.push({ file: candidate, error }); continue; }
    if (candidate !== file && typeof restore === 'function') {
      beforeRestore?.();
      try { await fsp.rename(file, `${file}.corrupt-${Date.now()}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      beforeRestore?.();
      await restore(value);
    }
    return value;
  }
  if (!found) return typeof fallback === 'function' ? fallback() : fallback;
  throw integrityError(file, errors);
}

module.exports = { readJsonWithValidatedBackup, readJsonWithValidatedBackupAsync, integrityError };
