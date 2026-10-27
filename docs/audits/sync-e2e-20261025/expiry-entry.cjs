'use strict';
// Isolated time fault only: real native signing/verification and storage remain.
const fs=require('node:fs'),path=require('node:path'),file=path.join(path.dirname(process.env.BUYER_LOG_SERVER_DATA_ROOT),'expire-session-clock');
const realNow=Date.now;let offset=0;setInterval(()=>{offset=fs.existsSync(file)?13*3600*1000:0},50).unref();Date.now=()=>realNow()+offset;
require('../../../resources/app/server/server.js');
