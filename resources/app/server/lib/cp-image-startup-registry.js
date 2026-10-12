'use strict';

const parse = require('./parse');

/* Model görsellerini CP açılışında yalnız yetkili kullanıcının zaten
   filtrelenmiş CP projection satırlarıyla sınırla. Resim baytları taşınmaz.
   Adlı renk kayıtları ve boş ref (silme mezar taşı) da korunur. */
function scopedCpImageRegistry(rows, imagemap) {
  const colourKeys = new Set(), legacyKeys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const plmId = parse.normalizePlmImageId(row && row['PLM ID']);
    if (!plmId) continue;
    const colour = parse.normalizeCpImageColourCode(row && row['C.Code']);
    const legacy = parse.plmImageKey(plmId);
    if (legacy) legacyKeys.add(legacy);
    if (colour) {
      const key = parse.plmColourImageKey(plmId, colour);
      if (key) colourKeys.add(key);
    }
  }
  const scoped = Object.create(null);
  for (const [key, ref] of Object.entries(imagemap && typeof imagemap === 'object' ? imagemap : {})) {
    const namedAt = key.indexOf('|name:');
    const base = namedAt >= 0 ? key.slice(0, namedAt) : key;
    if (colourKeys.has(base) || (namedAt < 0 && legacyKeys.has(key))) scoped[key] = ref;
  }
  return { imagemap: scoped, scopeKeys: [...colourKeys, ...legacyKeys] };
}

module.exports = { scopedCpImageRegistry };
