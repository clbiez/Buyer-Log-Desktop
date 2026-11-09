'use strict';
// Run under the shared measurement flock. No timing/clock control in either arm.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [outputArg, main, candidate] = process.argv.slice(2);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
const order = [];
for (const count of [100, 1000]) {
  for (let pair = 1; pair <= 3; pair++) {
    for (const arm of pair % 2 ? ['main', 'candidate'] : ['candidate', 'main']) {
      const file = path.join(output, `ab-${count}-${pair}-${arm}.json`);
      order.push({ count, pair, arm, file: path.basename(file) });
      fs.writeFileSync(path.join(output, 'execution-order.json'), JSON.stringify(order, null, 2) + '\n');
      const run = spawnSync(process.execPath, [
        path.join(__dirname, 'phase6c-http-acceptance.cjs'),
        arm === 'main' ? main : candidate, file, String(count),
      ], { env: process.env, stdio: 'inherit' });
      if (run.status !== 0) {
        console.error(`Stopped on failed arm ${file}: ${run.error || run.status}`);
        process.exit(run.status || 1);
      }
    }
  }
}
