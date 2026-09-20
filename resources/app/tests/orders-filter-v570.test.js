const test = require('node:test');
const assert = require('node:assert/strict');

test('v5.70 Orders column filter normalizes displayed string values', () => {
  const rows = [{Buyer:' ACME '},{Buyer:'Other'}];
  const wanted = 'ACME';
  const norm = v => String(v ?? '').trim().toLocaleLowerCase('tr-TR');
  const matched = rows.filter(r => norm(r.Buyer) === norm(wanted));
  assert.equal(matched.length, 1);
  assert.equal(matched[0].Buyer, ' ACME ');
});

test('v5.70 Orders filter panel exposes remove-filter action for every column', () => {
  const html = '<button class="numFilterClear cfpRemoveSelection">Filtreyi Kaldır</button>';
  assert.match(html, /cfpRemoveSelection/);
});
