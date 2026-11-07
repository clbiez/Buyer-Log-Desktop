'use strict';
// Diagnostic preload only: real native Worker and unmodified production entry.
const { parentPort, workerData, threadId } = require('node:worker_threads');
const Module = require('node:module');
const port = workerData?.fxDiagnosticPort;
if (port) {
  const emit = (event, extra = {}) => port.postMessage({ event, ns: process.hrtime.bigint().toString(), wall: new Date().toISOString(), threadId, ...extra });
  emit('worker-preload');
  const on = parentPort.on.bind(parentPort), post = parentPort.postMessage.bind(parentPort);
  parentPort.on = function (name, listener) {
    if (name !== 'message') return on(name, listener);
    emit('worker-listener-installed');
    return on(name, function (message) {
      if (message?.task) emit('task-received', { id: message.id, task: message.task });
      return listener.call(this, message);
    });
  };
  parentPort.postMessage = function (message, ...rest) {
    if (message?.id) emit('result-post', { id: message.id, type: message.type || 'legacy-result', metrics: message.metrics || null, ok: message.ok });
    return post(message, ...rest);
  };
  const load = Module._load;
  Module._load = function (request, parent, ...rest) {
    const value = load.call(this, request, parent, ...rest);
    if (/fxWorkbook$/.test(request) && !value.__fxDiagnosticWrapped) {
      for (const name of ['findKurWorkbook', 'readFxWorkbook']) {
        const original = value[name];
        value[name] = function (...args) {
          emit(name + '-enter');
          try { const result = original.apply(this, args); emit(name + '-return', { found: name === 'findKurWorkbook' ? Boolean(result) : undefined }); return result; }
          catch (error) { emit(name + '-throw', { code: error.code || error.message }); throw error; }
        };
      }
      Object.defineProperty(value, '__fxDiagnosticWrapped', { value: true });
    }
    return value;
  };
  port.unref();
}
