'use strict';

/* Varsayılan LCW AI motoru: ortak masaüstü/tarayıcı oturum sağlayıcısı,
   bellek içi auth ve doğrudan HTTP istemcisi. */
const config = require('./lcwai-config');
const errors = require('./lcwai-errors');
const { createLcwAiAuth } = require('./lcwai-auth');
const { createLcwAiBrowserSession } = require('./lcwai-browser-session');
const { createLcwAiClient } = require('./lcwai-client');
const { createLcwAiEngine } = require('./lcwai-engine');
const { createDesktopAwareProvider, getDesktopTokenHolder } = require('./lcwai-desktop-session');
const { createDesktopAuthRelay } = require('./lcwai-desktop-relay');

function createDefaultEngine(options = {}) {
  const logger = typeof options.logger === 'function'
    ? options.logger
    // Yalnız olay adı + kod/durum/süre; metin ve başlık asla.
    : event => { try { console.info(`[LCWAI] ${event.event}${event.status != null ? ` status=${event.status}` : ''}${event.code ? ` code=${event.code}` : ''}${event.reason ? ` reason=${event.reason}` : ''}${event.ms != null ? ` ms=${event.ms}` : ''}${event.types ? ` types=${event.types}` : ''}${event.reasoningLevel ? ` reasoning=${event.reasoningLevel}` : ''}${event.reasoningChunks != null ? ` reasoningChunks=${event.reasoningChunks}` : ''}`); } catch (_) {} };
  // Masaüstü köprüsü ilk token'ı da gerektiğinde alır; yalnız tarayıcı
  // kipi/eski kabuk Edge/CDP oturum sağlayıcısını kullanır.
  const desktopRelay = options.desktopRelay || createDesktopAuthRelay();
  const provider = options.provider || createDesktopAwareProvider({ holder: options.holder || getDesktopTokenHolder(), desktopRelay, fallback: createLcwAiBrowserSession({ connector: options.connector }) });
  const auth = createLcwAiAuth({ provider });
  const client = createLcwAiClient({ auth, logger, fetch: options.fetch });
  return createLcwAiEngine({ auth, client, desktopRelay });
}

let defaultEngine = null;
function getDefaultEngine() {
  if (!defaultEngine) defaultEngine = createDefaultEngine();
  return defaultEngine;
}

/* AI Çıktı Oluşturma (Export Engine): aynı motoru kullanır. */
let defaultOutputService = null;
function getDefaultOutputService() {
  if (!defaultOutputService) {
    const { createOutputService } = require('../lcwai-output/output-service');
    defaultOutputService = createOutputService({ engine: () => getDefaultEngine() });
  }
  return defaultOutputService;
}

module.exports = { config, errors, createDefaultEngine, getDefaultEngine, getDefaultOutputService, getDesktopTokenHolder };
