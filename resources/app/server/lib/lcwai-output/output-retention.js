'use strict';

// Dosya sayısı son 60 günlük çıktıları veya düzenlenebilir kaynaklarını düşürmez.
const RETENTION_DAYS = 60;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
function isExpired(record, now) {
  const at = Date.parse(record.updatedAt || record.createdAt);
  // Eski/eksik tarihli kayıtları tahmin ederek silme.
  return Number.isFinite(at) && at <= now.getTime() - RETENTION_MS;
}
module.exports = { RETENTION_DAYS, RETENTION_MS, isExpired };
