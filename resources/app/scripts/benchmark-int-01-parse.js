'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createFixture } = require('./lib/int-01-fixture');
const { loadHarness } = require('./lib/int-01-refresh-harness');

async function main() {
  const mode = process.argv[2] || 'before';
  const output = process.argv[3];
  if (!output || !['before', 'after'].includes(mode)) throw Error('Usage: node benchmark-int-01-parse.js before|after output.json [rows]');
  const fixture = createFixture(Number(process.argv[4] || 30000));
  const strategy = mode === 'after' ? require('./lib/int-01-parse-prototype').createStrategy : undefined;
  const harness = loadHarness(strategy);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  await new Promise(resolve => setTimeout(resolve, 30));
  const cpu = process.cpuUsage();
  const start = performance.now();
  // Tek çağrı; HTTP/DB bağlantısı ve POST retry yoktur.
  const result = await harness.refresh.loadFromModelConnections(fixture.items, fixture.options);
  const wallMs = performance.now() - start;
  const cpuUsed = process.cpuUsage(cpu);
  await new Promise(resolve => setTimeout(resolve, 30));
  loop.disable();
  const peakRssKiB = process.resourceUsage().maxRSS;
  const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const report = {
    mode, fixture: fixture.manifest, node: process.version, platform: process.platform,
    wallMs, cpuMs: (cpuUsed.user + cpuUsed.system) / 1000, peakRssKiB,
    eventLoop: { maxMs: loop.max / 1e6, p95Ms: loop.percentile(95) / 1e6 },
    transportCalls: fixture.transportCalls(), parses: harness.events, targetMaterializations: harness.calls,
    outputs: {
      asas: Object.fromEntries(Object.entries(result.asasOrdersByTarget).map(([target, rows]) => [target, { rows: rows.length, sha256: hash(rows) }])),
      antrepo: Object.fromEntries(Object.entries(result.antrepoMapByTarget).map(([target, map]) => [target, { keys: Object.keys(map).length, sha256: hash(map), metadataSha256: hash(require('../server/lib/parse').antrepoParseMeta(map)) }])),
      lfl: { rows: result.lflRows?.length ?? null, sha256: hash([result.lflRows, result.lflMeta]) },
      warningsSha256: hash(result.warnings),
    },
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ mode, wallMs, peakRssKiB, parses: harness.events.length, transportCalls: fixture.transportCalls() }));
}

if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
