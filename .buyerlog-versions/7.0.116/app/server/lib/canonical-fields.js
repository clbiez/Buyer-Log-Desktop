'use strict';

// Single source of truth: browser and server use the same canonical registry.
// Do not duplicate field aliases/mappings in server code.
const fields = require('../../public/canonical-fields.js');
require('../../public/canonical-module-bindings.js')(fields);
module.exports = fields;
