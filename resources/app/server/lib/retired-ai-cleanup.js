'use strict';

/*
 * Kaldırılan AI asistan katmanının makinede bıraktığı kalıntıları açılışta temizler.
 *
 * Silinenler yalnız o katmana aittir: AI sağlayıcı ayar dosyası, şifreli API
 * anahtarlarını çözen anahtar dosyası ve config.json içindeki ai* alanları
 * (aiApiKey düz metin anahtar taşıyabilir). İş verisine dokunulmaz. İşlem
 * idempotenttir; dosya yoksa hiçbir şey yazılmaz. Hata açılışı asla durdurmaz.
 */

const fs = require('fs');
const path = require('path');

const RETIRED_FILES = Object.freeze([
  'agent-ai-settings.json', 'agent-ai-settings.json.bak',
  '.agent-ai-secret', '.agent-ai-secret.bak',
]);
const RETIRED_CONFIG_KEYS = Object.freeze(['aiEnabled', 'aiModel', 'aiHost', 'aiPort', 'aiProvider', 'aiBaseUrl', 'aiEndpoint', 'aiApiKey']);

// config.json kurulum kökünde durur ve uygulamanın veri-kökü yazıcısının izin
// alanı dışındadır; aynı klasörde geçici dosya + rename ile atomik yazılır.
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.retired-ai.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try { fs.renameSync(tmp, file); }
  catch (error) { try { fs.unlinkSync(tmp); } catch (_) {} throw error; }
}

function removeRetiredAiArtifacts({ serverDataRoot, configPath, writeJson = writeJsonAtomic, log = () => {} } = {}) {
  const removed = [];
  for (const name of RETIRED_FILES) {
    const file = path.join(String(serverDataRoot || ''), name);
    try { fs.unlinkSync(file); removed.push(name); }
    catch (error) { if (error && error.code !== 'ENOENT') log(`${name}: ${error.message}`); }
  }
  const strippedKeys = [];
  if (configPath && typeof writeJson === 'function') {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config && typeof config === 'object' && !Array.isArray(config)) {
        for (const key of RETIRED_CONFIG_KEYS) if (Object.prototype.hasOwnProperty.call(config, key)) { delete config[key]; strippedKeys.push(key); }
        if (strippedKeys.length) writeJson(configPath, config);
      }
    } catch (error) { if (error && error.code !== 'ENOENT') log(`config.json: ${error.message}`); }
  }
  return { removed, strippedKeys };
}

module.exports = { removeRetiredAiArtifacts, RETIRED_FILES, RETIRED_CONFIG_KEYS };
