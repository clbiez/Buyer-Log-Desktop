'use strict';
// Lightweight event-loop stall probe: records gaps > 100ms; dumps on SIGUSR2.
const fs = require('fs'); const T0 = Date.now(); const out = process.env.LAG_OUT; const gaps = [];
let last = Date.now();
setInterval(() => { const n = Date.now(); const g = n - last - 20; if (g > 100) gaps.push({ at: last - T0, ms: g }); last = n; }, 20).unref();
process.on('SIGUSR2', () => { let io = ''; try { io = fs.readFileSync('/proc/self/io', 'utf8'); } catch (_) {} fs.writeFileSync(out, JSON.stringify({ gaps, io })); });
