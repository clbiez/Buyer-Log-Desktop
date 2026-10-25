'use strict';
module.exports = source => `(async()=>{\n${source}\n})().catch(error=>{console.error(error);process.exitCode=1;});`;
