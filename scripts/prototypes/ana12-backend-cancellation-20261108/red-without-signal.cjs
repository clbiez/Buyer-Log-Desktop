'use strict';
// Negative control: compile an in-memory mutant; never edit the production file.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.resolve(__dirname,'../../../resources/app/server/lib/backlog-compute-lifecycle.js');
const original=fs.readFileSync(file,'utf8');
if(!original.includes('flight.controller.abort();'))throw Error('Negative control anchor missing');
const mutant=original.replaceAll('flight.controller.abort();','/* negative control: HTTP rejection without pool abort */');
const moduleInstance=new Module(file,module);moduleInstance.filename=file;moduleInstance.paths=Module._nodeModulePaths(path.dirname(file));
require.cache[file]=moduleInstance;moduleInstance._compile(mutant,file);
require('../../../resources/app/tests/backlog-compute-lifecycle-native.test.js');
