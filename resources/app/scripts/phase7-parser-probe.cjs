'use strict';
// Benchmark-only child probe: one measurement at result publication, no polling
// on the application's main thread. Does not change the parser result.
if(process.send){const send=process.send.bind(process);process.send=(message,...args)=>send({...message,phase7PeakRssKiB:process.resourceUsage().maxRSS},...args);}
