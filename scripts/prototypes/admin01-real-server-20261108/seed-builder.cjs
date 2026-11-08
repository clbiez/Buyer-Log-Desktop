'use strict';
const { fs, path, APP, assert, sha, save } = require('./common.cjs');
const { createFixture, fileHash } = require('./inherited/resources/app/scripts/lib/backup-diagnostic-fixture.js');
(async () => {
  const root = process.argv[2];
  const fixture = await createFixture(root);
  assert.equal(fixture.fixtureSha256, '18daf1cf78dba1b7e46be23c501333248b6e7ce31f207a7e7fa362ffdf42d8df');
  const mapped = [];
  for (const [i, entry] of fixture.entries.entries()) {
    const relative = 'local/admin01-payload/' + path.basename(entry.name), target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (entry.sourcePath) fs.renameSync(entry.sourcePath, target); else fs.writeFileSync(target, entry.buffer);
    assert.equal(await fileHash(target), fixture.expected[i].sha256);
    mapped.push({ ...fixture.expected[i], serverRelative: relative, archivePath: 'system/' + relative.replace(/^local\//, 'local-data/') });
  }
  const { build } = require(path.join(APP, 'scripts/generate-demo-data.js')), XLSX = require(path.join(APP, 'node_modules/xlsx'));
  const data = build({ rows: 30000, seed: 7, today: new Date('2026-11-07T00:00:00.000Z') });
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  for (const [name, sheet, rows] of [['ASAS - Demo.xlsx', 'ASAS', data.asas], ['Antrepo - Demo.xlsx', 'Antrepo Raporu', data.antrepo], ['LFL - Demo.xlsx', 'LFL', data.lfl]]) {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
    XLSX.writeFile(book, path.join(source, name), { bookType: 'xlsx' });
  }
  const hashes = Object.fromEntries(fs.readdirSync(source).sort().map(f => [f, sha(fs.readFileSync(path.join(source, f)))]));
  const marker = { synthetic: true, rows: 30000, seed: 7, fixedToday: '2026-11-07', hashes };
  save(path.join(source, 'benchmark-fixture.json'), marker);
  save(path.join(root, 'payload.json'), { synthetic: true, inheritedFixtureSha256: fixture.fixtureSha256, config: fixture.config, mapped, source: marker });
})().catch(error => { console.error(error); process.exitCode = 1; });
