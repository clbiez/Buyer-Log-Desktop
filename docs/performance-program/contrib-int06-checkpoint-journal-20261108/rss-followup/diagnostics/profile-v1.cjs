'use strict';

// DIAGNOSTIC ONLY: preload for the unchanged measure.cjs. Never acceptance data.
// Caller holds the common flock. JSON/FS probes, heap sampling and optional full
// collections perturb timing/allocation. Do not pass this preload to cohort.cjs.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const inspector = require('node:inspector');
const { performance, PerformanceObserver } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const output = process.env.INT06_PROFILE_OUTPUT;
if (!output) throw Error('INT06_PROFILE_OUTPUT required');
if (fs.existsSync(output)) throw Error('never overwrite diagnostic evidence');
const forceGC = process.env.INT06_PROFILE_GC === '1';
if (forceGC && !global.gc) throw Error('--expose-gc required for diagnostic collections');
const original = { stringify: JSON.stringify, parse: JSON.parse, write: fs.writeFileSync, load: Module._load };
const events = [], collections = [], session = new inspector.Session();
let busy = false, region = 'startup', oracleCreated = false;
function memory() { return { ...process.memoryUsage(), maxRSS: process.resourceUsage().maxRSS * 1024 }; }
function record(stage, extra = {}) { events.push({ stage, region, ms: performance.now(), ...memory(), ...extra }); }
function collect(stage) {
  record(stage + ':before-gc');
  if (forceGC) { global.gc(); record(stage + ':after-gc'); }
}
function sampling(stage) {
  session.post('HeapProfiler.getSamplingProfile', {}, (error, result) => {
    if (error) throw error;
    original.write(output + '.' + stage + '.heap-sampling.json', original.stringify(result.profile), { flag: 'wx' });
  });
}
session.connect();
session.post('HeapProfiler.startSampling', { samplingInterval: 16384 }, error => { if (error) throw error; });
const gcObserver = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) collections.push({ startTime: entry.startTime, duration: entry.duration, ...entry.detail });
});
gcObserver.observe({ entryTypes: ['gc'] });

for (const name of ['stringify', 'parse']) JSON[name] = function(value, ...args) {
  if (busy) return original[name](value, ...args);
  const stack = new Error().stack.split('\n').slice(2, 7).map(line => line.trim());
  const fullGraph = name === 'stringify' && value && typeof value === 'object'
    && (value.schemaVersion === 1 || value.type === 'snapshot' || typeof value.payload === 'string' && value.payload.length > 100000);
  const largeParse = name === 'parse' && typeof value === 'string' && value.length > 100000;
  if (fullGraph || largeParse) record('json:' + name + ':before', { stack });
  const result = original[name](value, ...args);
  if (fullGraph || largeParse) record('json:' + name + ':after', {
    stack, chars: typeof result === 'string' ? result.length : typeof value === 'string' ? value.length : undefined,
  });
  return result;
};
fs.writeFileSync = function(file, data, ...args) {
  const snapshot = typeof file === 'string' && /snapshot\.json\..*\.tmp$/.test(file);
  if (snapshot) record('snapshot:write:before', { chars: data.length });
  const result = original.write.call(this, file, data, ...args);
  if (snapshot) record('snapshot:write:after');
  return result;
};
Module._load = function(request, parent, ...args) {
  const value = original.load.call(this, request, parent, ...args);
  if (request.endsWith('/powerbi-checkpoint-fixture.js.source')) return { ...value,
    createFixture(config) {
      const fixture = value.createFixture(config);
      const getExpected = Object.getOwnPropertyDescriptor(fixture, 'expected').get;
      Object.defineProperty(fixture, 'expected', { get() {
        if (!oracleCreated) record('oracle:first-access');
        const expected = getExpected.call(fixture);
        if (!oracleCreated) { oracleCreated = true; record('oracle:created'); }
        return expected;
      } });
      record('fixture:created'); return fixture;
    },
    digest(input) {
      const trace = Array.isArray(input) && input[0] && input[0].seq === 1;
      if (trace) { region = 'trace'; collect('trace:ready'); sampling('trace'); }
      const result = value.digest(input);
      if (trace) record('trace:hashed');
      return result;
    },
  };
  if (request.endsWith('/power-bi-checkpoint-journal')) return { ...value,
    openCheckpointJournal(options) {
      region = options.initial ? 'initialize' : 'load-after-measurement';
      collect('journal:open');
      const journal = value.openCheckpointJournal(options);
      collect('journal:opened');
      return { ...journal,
        commit(delta) {
          region = 'commit-' + delta.seq;
          const boundary = delta.seq % 64 === 0 || delta.seq === 400;
          if (boundary) collect('commit:boundary');
          const result = journal.commit(delta);
          if (boundary) collect('commit:complete');
          return result;
        },
        compact() {
          region = 'final-compact'; collect('final:before'); sampling('before-final');
          const result = journal.compact();
          collect('final:after'); sampling('after-final'); record('acceptance-peak-boundary', { oracleCreated });
          return result;
        },
      };
    },
  };
  return value;
};
process.once('beforeExit', () => {
  setImmediate(() => {
    gcObserver.disconnect(); session.post('HeapProfiler.stopSampling'); session.disconnect();
    busy = true;
    const helper = path.resolve(__dirname, '../../../server/lib/power-bi-checkpoint-journal.js');
    original.write(output, original.stringify({ diagnosticOnly: true, forceGC, execArgv: process.execArgv,
      node: process.version, helperSha256: createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),
      events, collections }, null, 2) + '\n', { flag: 'wx' });
  });
});
