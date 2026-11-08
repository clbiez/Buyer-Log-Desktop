'use strict';

const path = require('path');

function isNetworkPath(value) {
  const raw = String(value || '').trim().replace(/\//g, '\\');
  return raw.startsWith('\\\\');
}

function resolveLocalDbFolder(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Yerel DB klasörü boş olamaz.');
  if (isNetworkPath(raw)) {
    const error = new Error('BuyerLogLocal.db yerel diskte tutulmalıdır; ortak ağ klasörü seçilemez.');
    error.code = 'LOCAL_DB_NETWORK_PATH';
    error.statusCode = 400;
    throw error;
  }
  return path.resolve(raw);
}

module.exports = { isNetworkPath, resolveLocalDbFolder };
