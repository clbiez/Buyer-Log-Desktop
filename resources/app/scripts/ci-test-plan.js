'use strict';

const fs = require('node:fs');

// Conservative PR classification. Business logic, scripts, workflow and test
// changes ALWAYS receive the full regression suite.
const isMetadata = file => (
  /(^|\/)README\.md$/i.test(file)
  || /\.md$/i.test(file)
  || file.startsWith('docs/')
  || /^\.github\/release-requests\/(test|stable)\.json$/.test(file)
);
const isStyleOnly = file => /^resources\/app\/public\/.+\.css$/.test(file);

function classifyPaths(files) {
  const paths = files.map(file => String(file || '').trim().replace(/\\/g, '/')).filter(Boolean);
  if (!paths.length) return 'full';
  if (paths.every(isMetadata)) return 'metadata';
  if (paths.every(file => isMetadata(file) || isStyleOnly(file))) return 'ui';
  return 'full';
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/ci-test-plan.js changed-files.txt');
    process.exit(2);
  }
  const files = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
  process.stdout.write('mode=' + classifyPaths(files) + '\n');
}

module.exports = { classifyPaths };
