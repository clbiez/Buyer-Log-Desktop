'use strict';
// Replay the added contract tests against the unchanged inherited prototypes.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const repo = path.resolve(__dirname, '../../..');
const testFile = path.join(repo, 'resources/app/tests/collection-client-delta-lifecycle.test.js');
const packet = path.join(repo, 'docs/performance-program/parallel-handoff-20261108/02-collection-client');
const source = fs.readFileSync(testFile, 'utf8')
  .replace("require('../public/collection-delta-commands.js')", 'require(' + JSON.stringify(path.join(packet, 'field/collection-field-command.cjs')) + ')')
  .replace("require('../public/collection-group-delta.js')", 'require(' + JSON.stringify(path.join(packet, 'group/collection-group-command.cjs')) + ')');
const mod = new Module(testFile, module); mod.filename = testFile; mod.paths = Module._nodeModulePaths(path.dirname(testFile));
mod._compile(source, testFile);
