'use strict';

// Yalnız sentetik tanı verisi; canlı transport/şema keşfi kapalıdır.
const { build } = require('../generate-demo-data');
const fields = require('../../server/lib/model-fields');
const crypto = require('node:crypto');

function records(matrix, headerAt) {
  const header = matrix[headerAt];
  return matrix.slice(headerAt + 1).map(row => Object.fromEntries(header.map((key, i) => [key, row[i] ?? null])));
}

function createFixture(rows = 30000, separate = false) {
  const data = build({ rows, seed: 7, today: new Date('2026-11-05T00:00:00.000Z') });
  const source = { asas: records(data.asas, 2), antrepo: records(data.antrepo, 0) };
  // IAS fact-grain ve parsiyel kimliğini gerçek DB normalizasyonunda korur.
  source.antrepo.forEach((row, i) => { row['İthalat Dosya No'] = `DEMO-${i}`; });
  const items = ['asas', 'antrepo'].map(role => {
    const targets = role === 'asas' ? ['cp', 'orders', 'backlog', 'priceanalysis', 'lfl'] : ['cp', 'orders', 'backlog'];
    const table = role === 'asas' ? 'ASAS' : 'IAS';
    const headers = new Set([...Object.keys(source[role][0] || {}), ...fields.fieldsForRole(role).filter(f => f.required).map(f => f.header)]);
    const mapping = Object.fromEntries([...headers].map(header => [header, { table, name: header, kind: 'column' }]));
    return {
      id: `synthetic-${role}`, name: `DEMO ${role}`, role, refreshEnabled: true,
      server: 'synthetic.invalid', catalog: table, mode: 'auto', mapping, mappingEnhancementScanVersion: 4,
      scopes: (separate ? targets.map(target => [target]) : [targets]).map((scopeTargets, i) => ({
        id: `${role}-${i}`, targets: scopeTargets, enabled: true,
        // Farklı scope gerçekten farklı sorgu ve farklı sonuç alır.
        horizon: { table, groups: separate ? [{ conditions: [{ table, field: 'Sezon', op: 'in', valueType: 'text', values: [`SCOPE-${i}`] }] }] : [] },
      })),
    };
  });
  let transportCalls = 0;
  const options = {
    columnType: false,
    discoverSchema: async () => { throw Error('INT-01: live schema discovery forbidden'); },
    runModelRows: async request => {
      transportCalls++;
      const role = request.catalog === 'ASAS' ? 'asas' : 'antrepo';
      // Ayrı scope fixture'ında sorgu sırası yerine scope sorgusunun kendisi belirler.
      const scope = /SCOPE-(\d+)/.exec(request.query);
      const resultRows = scope ? source[role].filter((_, index) => index % 5 === Number(scope[1]) % 5) : source[role];
      return { rows: resultRows, elapsedMs: 0, provider: 'int-01-mock' };
    },
  };
  return {
    source, items, options, transportCalls: () => transportCalls,
    manifest: { version: 1, seed: 7, today: '2026-11-05', rows: Object.fromEntries(Object.entries(source).map(([role, value]) => [role, value.length])), sha256: crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex') },
  };
}

module.exports = { createFixture };
