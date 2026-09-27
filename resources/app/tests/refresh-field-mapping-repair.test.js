'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fieldMappingRepairFromError, repairHorizonAgainstSchema } = require('../server/lib/model-refresh');

const ROOT = path.join(__dirname, '..');

test('missing tabular column is converted to a precise field-mapping repair action', () => {
  const repair = fieldMappingRepairFromError({
    id: 'ias-main',
    name: 'IAS Database',
    role: 'antrepo',
    horizon: { table: 'Siparis Bilgileri' },
    mapping: {
      'Buyer Grup (TR)': {
        table: 'Siparis Bilgileri',
        name: 'Buyer Grup (TR)',
        kind: 'column',
      },
    },
    _scopeTargets: ['cp', 'orders', 'backlog'],
  }, new Error("Query (10, 28) Column 'Buyer Grup (TR)' in table 'Siparis Bilgileri' cannot be found or may not be used in this expression. (DAX sorgusunda sözdizimi hatası var.)"));

  assert.ok(repair);
  assert.equal(repair.kind, 'field-mapping');
  assert.equal(repair.sourceId, 'ias-main');
  assert.equal(repair.header, 'Buyer Grup (TR)');
  assert.equal(repair.table, 'Siparis Bilgileri');
  assert.equal(repair.column, 'Buyer Grup (TR)');
  assert.deepEqual(repair.targets, ['cp', 'orders', 'backlog']);
});

test('unrelated database errors do not invent a field-mapping repair', () => {
  const repair = fieldMappingRepairFromError({
    id: 'ias-main',
    role: 'antrepo',
    mapping: {},
  }, new Error('VPN connection timed out'));
  assert.equal(repair, null);
});

test('refresh failure UI carries repair metadata into Data Management and retries after save', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const management = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  const mapping = fs.readFileSync(path.join(ROOT, 'public', 'data-management-mapping.js'), 'utf8');

  assert.match(app, /data-refresh-repair/);
  assert.match(app, /mappingRepair/);
  assert.match(app, /BLRetryRefreshAfterFieldMapping/);
  assert.match(app, /err\.repairAction=jobState\.repairAction\|\|null/);
  assert.match(management, /openMappingEditor\(sourceId, mappingRepair = null\)/);
  assert.match(management, /repairedTarget/);
  assert.match(mapping, /reopen\(payload\.warnings \|\| \[\], \{ header, entry \}\)/);
});


test('live IAS schema repairs stale Buyer Group horizon alias without user mapping', () => {
  const item = {
    id: 'ias-main',
    name: 'IAS',
    role: 'antrepo',
    horizon: {
      table: 'Siparis Bilgileri',
      groups: [{
        id: 'g1',
        conditions: [{
          id: 'c1',
          table: 'Siparis Bilgileri',
          field: 'Buyer Grup (TR)',
          op: 'in',
          valueType: 'text',
          values: ['LİSANS'],
        }],
      }],
    },
  };
  const repaired = repairHorizonAgainstSchema(item, {
    columns: [
      { table: 'Siparis Bilgileri', name: 'Buyer Grup Tanım', kind: 'column', dataType: 'String' },
      { table: 'Siparis Bilgileri', name: 'Merch Alt Grup Kod', kind: 'column', dataType: 'String' },
    ],
  });
  assert.equal(repaired.repaired, true);
  const condition = item.horizon.groups[0].conditions[0];
  assert.equal(condition.table, 'Siparis Bilgileri');
  assert.equal(condition.name, 'Buyer Grup Tanım');
  assert.match(repaired.warnings.join(' '), /Buyer Grup Tanım/);
});

test('live IAS schema repairs a removed horizon table when the condition has one exact current home', () => {
  const item = {
    id: 'ias-main',
    name: 'IAS',
    role: 'antrepo',
    horizon: {
      table: 'Model Özellikleri',
      groups: [{
        id: 'g1',
        conditions: [{
          id: 'c1',
          table: 'Model Özellikleri',
          field: 'Merch Alt Grup Kod',
          name: 'Merch Alt Grup Kod',
          op: 'in',
          valueType: 'text',
          values: ['CU4E'],
        }],
      }],
    },
  };
  const repaired = repairHorizonAgainstSchema(item, {
    columns: [
      { table: 'Siparis Bilgileri', name: 'Merch Alt Grup Kod', kind: 'column', dataType: 'String' },
      { table: 'Siparis Bilgileri', name: 'Sezon Kod', kind: 'column', dataType: 'String' },
    ],
  });
  assert.equal(repaired.repaired, true);
  assert.equal(item.horizon.table, 'Siparis Bilgileri');
  assert.equal(item.horizon.groups[0].conditions[0].table, 'Siparis Bilgileri');
});

test('live horizon repair refuses ambiguous schema candidates', () => {
  const item = {
    id: 'ias-main',
    role: 'antrepo',
    horizon: {
      table: 'Old Table',
      groups: [{
        conditions: [{
          table: 'Old Table',
          field: 'Buyer Grup (TR)',
          op: 'in',
          valueType: 'text',
          values: ['LİSANS'],
        }],
      }],
    },
  };
  const repaired = repairHorizonAgainstSchema(item, {
    columns: [
      { table: 'Table A', name: 'Buyer Grup Tanım', kind: 'column', dataType: 'String' },
      { table: 'Table B', name: 'Buyer Grup Tanım', kind: 'column', dataType: 'String' },
    ],
  });
  assert.equal(repaired.repaired, false);
  assert.equal(item.horizon.table, 'Old Table');
  assert.ok(repaired.unresolved);
});
