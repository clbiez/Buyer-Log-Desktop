'use strict';

/* Buyer Log application version — single canonical source: package.json. */
const path = require('path');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');
function toDisplayVersion(packageVersion) {
  const parts=String(packageVersion||'').split('.');
  if(parts.length!==3||parts[1]!=='0')return String(packageVersion||'');
  return `${parts[0]}.${String(parts[2]).padStart(2,'0')}`;
}
const PACKAGE_VERSION=String(require(PACKAGE_JSON_PATH).version||'');
const APP_VERSION=PACKAGE_VERSION; // canonical SemVer for comparisons, manifests, backups, logs
const DISPLAY_VERSION=toDisplayVersion(PACKAGE_VERSION); // UI only
module.exports={PACKAGE_JSON_PATH,PACKAGE_VERSION,APP_VERSION,DISPLAY_VERSION,toDisplayVersion};
