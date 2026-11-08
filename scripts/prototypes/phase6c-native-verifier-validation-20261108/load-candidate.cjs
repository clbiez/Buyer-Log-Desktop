'use strict';
// Process-local locator for unchanged existing native regression tests.
const Module = require('node:module');
const path = require('node:path');
const subject = require('./preparation/tests/helpers/native-verifier-subject.cjs');
const filename = path.join(subject.appRoot, 'server/lib/local-db.js');
const loaded = new Module(filename, module);
loaded.filename = filename; loaded.loaded = true; loaded.exports = subject;
require.cache[filename] = loaded;
