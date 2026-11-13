'use strict';

/* Sessiz (arka plan) görsel tamamlama yanıtı.
 *
 * Kullanıcı işi tam `overrides` nesnesini döndürür; istemci onu birleştirir ve
 * CP/Orders/Koleksiyon satırlarının hepsini dolaşır. Sessiz iş birkaç kimlik
 * için çalışır: tam nesne (on binlerce imagemap anahtarı) hem büyük bir JSON
 * parse'ı hem de 30k satırlık bir döngü demektir ve kullanıcıya takılma olarak
 * hissettirir. Bu yüzden arka plan yanıtı yalnız DEĞİŞEN imagemap anahtarlarını
 * taşır; kaldırılan anahtar null ile işaretlenir (boş dize imagemap'te bilinçli
   bir mezar taşıdır, kaldırma ile karıştırılmaz). */

function imagemapPatch(before, after) {
  const prev = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  const patch = {};
  for (const key of Object.keys(next)) if (next[key] !== prev[key]) patch[key] = next[key] == null ? null : String(next[key]);
  for (const key of Object.keys(prev)) if (!Object.prototype.hasOwnProperty.call(next, key)) patch[key] = null;
  return patch;
}

/* İstenen kimliklerin GÜNCEL anahtarları da yamaya girer. İstemci durumu
   eskiyse (görsel sunucuda zaten yerelde var, imagemap değişmedi) yalnız
   "değişenler" boş dönerdi; istemci kimliği hâlâ eksik görür ve onu yanlışlıkla
   "bulunamadı" belleğine yazardı. `relevantKeys(map)` sunucunun kanonik anahtar
   kuralını (parse.plmImageKeysFor) uygular; modül saf kalır. */
function compactBackgroundImageResult(result, beforeImagemap, { relevantKeys } = {}) {
  if (!result || typeof result !== 'object') return result;
  const { overrides, batchLog, diagnostics, ...rest } = result;
  const after = (overrides && overrides.imagemap) || beforeImagemap || {};
  const patch = imagemapPatch(beforeImagemap, after);
  if (typeof relevantKeys === 'function') {
    for (const key of relevantKeys(after) || []) {
      if (Object.prototype.hasOwnProperty.call(after, key) && !Object.prototype.hasOwnProperty.call(patch, key)) patch[key] = after[key] == null ? null : String(after[key]);
    }
  }
  return { ...rest, silent: true, imagemapPatch: patch };
}

module.exports = { imagemapPatch, compactBackgroundImageResult };
