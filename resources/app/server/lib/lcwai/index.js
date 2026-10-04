'use strict';

/* Varsayılan LCW AI motoru: tarayıcı oturum sağlayıcısı (mevcut
   agent-browser-connector + browser-debug-service) + bellek içi auth +
   doğrudan HTTP istemcisi. Testler alt modülleri kendi sahteleriyle kurar. */
const config = require('./lcwai-config');
const errors = require('./lcwai-errors');
const { createLcwAiAuth } = require('./lcwai-auth');
const { createLcwAiBrowserSession } = require('./lcwai-browser-session');
const { createLcwAiClient } = require('./lcwai-client');
const { createLcwAiEngine } = require('./lcwai-engine');

function createDefaultEngine(options = {}) {
  const logger = typeof options.logger === 'function'
    ? options.logger
    // Yalnız olay adı + kod/durum/süre; metin ve başlık asla.
    : event => { try { console.info(`[LCWAI] ${event.event}${event.status != null ? ` status=${event.status}` : ''}${event.code ? ` code=${event.code}` : ''}${event.ms != null ? ` ms=${event.ms}` : ''}${event.types ? ` types=${event.types}` : ''}`); } catch (_) {} };
  const auth = createLcwAiAuth({ provider: options.provider || createLcwAiBrowserSession({ connector: options.connector }) });
  const client = createLcwAiClient({ auth, logger, fetch: options.fetch });
  return createLcwAiEngine({ auth, client });
}

let defaultEngine = null;
function getDefaultEngine() {
  if (!defaultEngine) defaultEngine = createDefaultEngine();
  return defaultEngine;
}

module.exports = { config, errors, createDefaultEngine, getDefaultEngine };
