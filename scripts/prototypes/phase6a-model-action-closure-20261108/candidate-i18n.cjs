'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const coverage=require('../../../resources/app/tests/helpers/i18n-coverage.js');
const source=fs.readFileSync(path.join(__dirname,'app-main.js'),'utf8');
const missing=coverage.scanSource(source,'public/app-main.js');
assert.deepEqual(missing,[],'candidate scanned by unchanged native i18n validator');
console.log('candidate app-main: 0 missing TR/EN literals');
