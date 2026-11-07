'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const parse = require('../../server/lib/parse');
const file = path.resolve(__dirname, '../../server/lib/model-refresh.js');

// Diskteki üretim modülüne yazmadan iki gerçek parse çağrısını gözlemler.
// Anchor değişirse sessizce yanlış zinciri ölçmek yerine durur.
function loadHarness(strategy) {
  const events = [];
  const calls = [];
  const runIds = new WeakMap();
  let nextRunId = 0;
  let source = fs.readFileSync(file, 'utf8');
  const startAnchor = 'async function loadFromModelConnections(items, options = {}) {';
  if (source.split(startAnchor).length !== 2) throw Error('INT-01 refresh lifecycle anchor changed');
  source = source.replace(startAnchor, startAnchor + "\n  const diagnosticParse = require('int-01-observer')();");
  for (const [kind, anchor, run] of [
    ['asas', 'parseASASRows(entry.run.rows, options.matchRule)', 'entry.run'],
    ['antrepo', 'parseAntrepoRows(run.rows, options.matchRule)', 'run'],
  ]) {
    if (source.split(anchor).length !== 2) throw Error(`INT-01 anchor changed: ${kind}`);
    source = source.replace(anchor, `diagnosticParse('${kind}', ${run}, options.matchRule)`);
  }
  const nativeParse = (kind, rows, rule) => {
    const start = performance.now();
    const result = (kind === 'asas' ? parse.parseASASRows : parse.parseAntrepoRows)(rows, rule);
    events.push({ kind, durationMs: performance.now() - start, rows: rows.length });
    return result;
  };
  const observe = () => {
    const parseRun = strategy ? strategy(nativeParse) : (kind, run, rule) => nativeParse(kind, run.rows, rule);
    return (kind, run, rule) => {
      if (!runIds.has(run)) runIds.set(run, ++nextRunId);
      const start = performance.now(), eventStart = events.length;
      const result = parseRun(kind, run, rule);
      calls.push({ kind, runId: runIds.get(run), durationMs: performance.now() - start,
        nativeParseMs: events.slice(eventStart).reduce((total, event) => total + event.durationMs, 0) });
      return result;
    };
  };
  const instance = new Module(file, module);
  instance.filename = file;
  instance.paths = Module._nodeModulePaths(path.dirname(file));
  const nativeRequire = instance.require.bind(instance);
  instance.require = name => name === 'int-01-observer' ? observe : nativeRequire(name);
  instance._compile(source, file);
  return { refresh: instance.exports, events, calls };
}

module.exports = { loadHarness };
