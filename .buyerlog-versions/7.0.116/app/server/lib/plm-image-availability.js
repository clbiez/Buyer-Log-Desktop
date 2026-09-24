'use strict';

/*
 * Bir PLM görsel bağlantısının yalnız kayıtta değil, fiziksel depoda da
 * kullanılabilir olduğunu doğrular. Eski bağlantı anahtarları okunmaya devam
 * eder; ancak bir isim-özel anahtarı mevcutsa (bozuk olsa bile) ekranda önce
 * o seçileceğinden onun durumunu esas alırız.
 */
function resolveUsablePlmImage({ map, plmId, colourCode, colour, key: preferredKey, getImage, parse }) {
  const links = map && typeof map === 'object' ? map : {};
  const parser = parse || require('./parse');
  const has = key => Boolean(key) && Object.prototype.hasOwnProperty.call(links, key);
  const read = key => String(links[key] == null ? '' : links[key]).trim();
  const code = String(colourCode == null ? '' : colourCode).trim();
  let key = '', ref = '';

  if (code) {
    const namedKey = parser.plmColourImageNameKey(plmId, code, colour);
    const codeKey = parser.plmColourImageKey(plmId, code);
    if (has(preferredKey)) { key = preferredKey; ref = read(preferredKey); }
    else if (has(namedKey)) { key = namedKey; ref = read(namedKey); }
    else if (has(codeKey)) { key = codeKey; ref = read(codeKey); }
    else { key = namedKey || codeKey; }
  } else {
    key = parser.plmImageKey(plmId);
    ref = String(parser.plmImageRef(links, { plm: plmId, ccode: '' }) || '').trim();
  }

  return { key, ref, usable: Boolean(ref && typeof getImage === 'function' && getImage(ref)) };
}

module.exports = { resolveUsablePlmImage };
