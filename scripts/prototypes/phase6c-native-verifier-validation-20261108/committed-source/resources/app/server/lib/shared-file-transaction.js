'use strict';
const path = require('node:path');
const { appRoot } = require("../../../../../preparation/tests/helpers/native-verifier-subject.cjs");
module.exports = require(path.join(appRoot, 'server/lib', "shared-file-transaction.js"));
