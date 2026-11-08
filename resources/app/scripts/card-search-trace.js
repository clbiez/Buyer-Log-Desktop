'use strict';
// Aynı fixture'ın yalnız 5.000 lisans üzerindeki 10 arama aralığını profille.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Module = require('node:module'), { gzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1]; };
assert.ok(arg('--trace-prefix') && arg('--source-dir'));
const prefix = path.resolve(arg('--trace-prefix'));
fs.mkdirSync(path.dirname(prefix), { recursive: true });
for (const ext of ['.trace.json.gz', '.cpuprofile.json.gz', '.metadata.json']) assert.ok(!fs.existsSync(prefix + ext), 'existing evidence must be preserved');
const lock = path.join(os.tmpdir(), 'buyerlog-client-paired-benchmark.lock');
const fd = fs.openSync(lock, 'wx'); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
process.on('exit', () => fs.unlinkSync(lock));
global.__installCardSearchTrace = async (page, moduleName, count) => {
  if (moduleName !== 'license-cards' || count !== 5000) return;
  const cdp = await page.context().newCDPSession(page);
  let before;
  await page.exposeFunction('__startCardSearchTrace', async () => {
    before = { at: new Date().toISOString(), heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') };
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc', transferMode: 'ReturnAsStream' });
    await cdp.send('Profiler.start');
  });
  await page.exposeFunction('__stopCardSearchTrace', async () => {
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(prefix + '.cpuprofile.json.gz', gzipSync(JSON.stringify(profile)));
    const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await completed;
    assert.ok(stream, 'trace stream is required');
    const chunks = [];
    for (;;) {
      const part = await cdp.send('IO.read', { handle: stream });
      chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'));
      if (part.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    fs.writeFileSync(prefix + '.trace.json.gz', gzipSync(Buffer.concat(chunks)));
    const after = { at: new Date().toISOString(), heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') };
    fs.writeFileSync(prefix + '.metadata.json', JSON.stringify({ processId: process.pid, sourceDir: path.resolve(arg('--source-dir')), fixture: 'unchanged full acceptance sequence; tracing only 5000 license records / 10 search observations', before, after }, null, 2) + '\n');
  });
};
const filename = require.resolve('./card-render-acceptance');
let source = fs.readFileSync(filename, 'utf8');
const replace = (from, to) => { assert.ok(source.includes(from), 'trace anchor missing: ' + from); source = source.replace(from, to); };
replace('const result = await page.evaluate', 'await global.__installCardSearchTrace(page, module, count);\n      const result = await page.evaluate');
replace('await page.addScriptTag({ content: source });', "await page.addScriptTag({ content: source + '\\n//# sourceURL=' + module + '-trace.js' });");
const search = source.split('\n').find(line => line.includes("await measure('search'"));
assert.ok(search);
replace(search, "        if (module === 'license-cards' && count === 5000) await window.__startCardSearchTrace();\n" + search + "\n        if (module === 'license-cards' && count === 5000) await window.__stopCardSearchTrace();");
replace('const start = performance.now(); await fn(); void root.offsetHeight; timings[name].push(performance.now() - start);',
  "const traced = name === 'search' && module === 'license-cards' && count === 5000; const index = timings[name].length; if (traced) performance.mark('search-' + index + '-start'); const start = performance.now(); await fn(); void root.offsetHeight; timings[name].push(performance.now() - start); if (traced) performance.mark('search-' + index + '-end');");
const diagnostic = new Module(filename, module); diagnostic.filename = filename; diagnostic.paths = module.paths;
diagnostic._compile(source, filename);
