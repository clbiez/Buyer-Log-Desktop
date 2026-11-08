'use strict';
const lib = require('../../server/lib/collection-delta-commit');
const { verifyDurability } = require('./collection-committed-native.cjs');
module.exports = { ...lib, readWorkspace: lib.decodeWorkspace, createCollectionDeltaService: options => lib.createCollectionDeltaService({ ...options, verifyDurability }) };
