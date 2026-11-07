'use strict';
const Module=require('node:module'),load=Module._load;
Module._load=function(request,...args){if(!Module.isBuiltin(request)&&!request.startsWith('.')&&!require('node:path').isAbsolute(request))throw Error('External dependency forbidden in Node-only CI verification: '+request);return load.call(this,request,...args);};
