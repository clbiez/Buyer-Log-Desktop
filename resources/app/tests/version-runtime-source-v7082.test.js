'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const version=require('../server/lib/app-version');

test('package.json is the canonical semantic version source',()=>{assert.match(pkg.version,/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);assert.equal(version.APP_VERSION,pkg.version);assert.equal(version.PACKAGE_VERSION,pkg.version);assert.equal(version.DISPLAY_VERSION,version.toDisplayVersion(pkg.version));assert.equal(pkg.main,'electron/launcher.js');});

test('UI derives version and asset cache token at runtime',()=>{const index=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');assert.match(index,/BL_APP_VERSION="__BL_CANONICAL_VERSION__"/);assert.match(index,/Version __BL_DISPLAY_VERSION__/);assert.doesNotMatch(index,/Version 7\.81/);const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');assert.match(server,/replace\(\/__BL_CANONICAL_VERSION__\/g, APP_VERSION\)/);assert.match(server,/replace\(\/__BL_DISPLAY_VERSION__\/g, DISPLAY_VERSION\)/);});

test('runtime cache pins derive from canonical app version instead of a release number',()=>{for(const rel of ['public/index.html','public/perf-runtime.js','public/app-main.js','public/select-user.html','public/canonical-column-labels.js','public/revision-display.js','public/user-storage.js','server/lib/auth.js']){const text=fs.readFileSync(path.join(ROOT,rel),'utf8');assert.doesNotMatch(text,/[?&]v=7\.\d+(?:\.\d+)?/,rel);}const auth=fs.readFileSync(path.join(ROOT,'server','lib','auth.js'),'utf8');assert.match(auth,/giris\.css\?v=\$\{encodeURIComponent\(APP_VERSION\)\}/);});

test('server APP_VERSION remains canonical while display is presentation-only',()=>{const source=fs.readFileSync(path.join(ROOT,'server','lib','app-version.js'),'utf8');assert.match(source,/const APP_VERSION=PACKAGE_VERSION/);assert.match(source,/const DISPLAY_VERSION=toDisplayVersion/);});
