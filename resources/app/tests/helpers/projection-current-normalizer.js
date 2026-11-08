'use strict';
// Execute the actual current app functions; never substitute business behavior.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { extractFunction } = require('./app-main-functions');
function loadReference() {
  const source = fs.readFileSync(path.join(__dirname, '../../public/app-main.js'), 'utf8');
  const constants = [/const CP_BASELINE_DATE_KEYS = .*;/, /const CP_DATE_KEYS = .*;/, /const ISO_DAY_CACHE_MAX = .*;/, /const _isoDayCache = .*;/]
    .map(pattern => { const match = source.match(pattern); if (!match) throw new Error('Missing actual normalizer constant: ' + pattern); return match[0]; });
  const names = ['norm', 'toNum', 'dateOrdinal', 'normalizeTransitDelType', 'turknorm', 'makeDateOnly', 'dateOnlyFromDateObject',
    'excelSerialToDateOnly', 'coerceDateLoose', 'normalizeCPDates', 'applyCpApprovalDate', 'cpLogisticSegments', 'cpLogisticHasDetails', 'rebuildCpLogisticCaches'];
  const context = vm.createContext({ Date, Map, Set, window: {}, BLBusinessRules: require('../../public/business-rules') });
  vm.runInContext([...constants, ...names.map(name => extractFunction(source, name)),
    'globalThis.reference={normalize:normalizeCPDates};'].join('\n'), context, { filename: 'app-main.js (actual projection normalizer)' });
  return context.reference;
}
module.exports = { loadReference };
