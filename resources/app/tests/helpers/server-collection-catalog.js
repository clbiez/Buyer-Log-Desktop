'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `${startText} not found`);
  assert.ok(end > start, `${endText} boundary not found`);
  return source.slice(start, end);
}

// Exercise the server's actual catalog bindings and forwarding functions with
// their real shared implementation. The old contiguous slice also instantiated
// unrelated compute services, whose live session/source dependencies it lacked.
// Do not stub those guards or start the HTTP server for a pure catalog contract.
module.exports = function serverCollectionCatalog() {
  const source = fs.readFileSync(path.join(__dirname, '../../server/server.js'), 'utf8');
  const bindings = between(source, 'const COLLECTION_CATALOG_FIELDS', 'function stableHashValue(');
  const builder = between(source, 'function buildCollectionCatalogs(', 'async function buildResponse(');
  const factory = new Function('collectionCatalog', `'use strict';\n${bindings}\n${builder}\nreturn {
    COLLECTION_CATALOG_FIELDS, COLLECTION_CATALOG_CANONICAL_FIELDS,
    COLLECTION_CATALOG_SCHEMA_VERSION, collectionCatalogsComplete,
    collectionCatalogProjectionComplete, buildCollectionCatalogs
  };`);
  return factory(require('../../server/lib/collection-catalog'));
};
