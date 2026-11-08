'use strict';
// Measurement-only preload: forwards the real service arguments/results/errors.
// No request, auth, archive, filesystem or compute-pool implementation is replaced.
const { fs, path, APP, now, delay, save } = require('./common.cjs');
if (process.argv[1] === path.join(APP, 'server/server.js')) {
  const inspector = require('node:inspector'), { promisify } = require('node:util');
  const { performance } = require('node:perf_hooks'), zlib = require('node:zlib');
  const mod = require(path.join(APP, 'server/lib/backup-service.js'));
  const original = mod.createBackupService;
  mod.createBackupService = function (...factoryArgs) {
    const service = original.apply(this, factoryArgs), create = service.create;
    service.create = async function (...args) {
      let session, post, profile;
      if (process.env.ADMIN01_PROFILE === '1') {
        session = new inspector.Session(); session.connect(); post = promisify(session.post.bind(session));
        await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 }); await post('Profiler.start');
      }
      const gaps = []; let previous = now();
      const timer = setInterval(() => { const end = now(); gaps.push({ fromMs: previous, toMs: end, gapMs: end - previous }); previous = end; }, 10);
      // The operation starts between timer ticks; crossing gaps remain whole.
      await delay(30);
      const cpu = process.cpuUsage(), elu = performance.eventLoopUtilization();
      const measurement = { startedMs: now(), memoryBefore: process.memoryUsage(), phases: [] };
      process.send?.({ kind: 'backup-start', startedMs: measurement.startedMs });
      let result;
      try {
        const options = { ...args[0] }, progress = options.onProgress;
        options.onProgress = value => {
          if (measurement.phases.at(-1)?.phase !== value.phase) measurement.phases.push({ phase: value.phase, atMs: now() });
          return progress?.(value);
        };
        result = await create.call(this, options, ...args.slice(1));
        measurement.archive = { path: result.path, size: result.size, fileCount: result.fileCount };
      } catch (error) { measurement.error = { message: error.message, stack: error.stack }; throw error; }
      finally {
        measurement.endedMs = now();
        const used = process.cpuUsage(cpu);
        Object.assign(measurement, { wallMs: measurement.endedMs - measurement.startedMs,
          cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
          cpuMs: (used.user + used.system) / 1000, memoryAfter: process.memoryUsage(),
          lifetimePeakRssBytes: process.resourceUsage().maxRSS * 1024,
          eventLoopUtilization: performance.eventLoopUtilization(elu) });
        if (session) {
          try { ({ profile } = await post('Profiler.stop')); }
          finally { session.disconnect(); }
        }
        await delay(25); clearInterval(timer);
        measurement.gaps = gaps.filter(g => g.toMs >= measurement.startedMs && g.fromMs <= measurement.endedMs);
        save(process.env.ADMIN01_OBSERVATION, measurement);
        if (profile) fs.writeFileSync(process.env.ADMIN01_OBSERVATION + '.cpuprofile.gz', zlib.gzipSync(JSON.stringify(profile)));
        process.send?.({ kind: 'backup-end', measurement });
      }
      return result;
    };
    return service;
  };
}
