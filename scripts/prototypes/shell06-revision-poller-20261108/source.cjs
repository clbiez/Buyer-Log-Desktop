'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'resources/app/public/app-main.js'), 'utf8');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0) throw Error('Source anchor drift');
  return source.slice(a, b);
}
const poll = between('let sharedRevisionSnapshot=null,sharedRevisionTimer=0;', '// Yenile: ASAS');
const live = between('function initLiveSync(){', '/* Canlı bağlantı boşluğundan');
const tail = between('function liveSyncResyncAfterGap(){', '// ================= NOT DEFTERİ');
module.exports = { root, source, poll, live, tail };
