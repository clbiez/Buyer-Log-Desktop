'use strict';
const { fs, path, APP, assert, save } = require('./common.cjs');
const { inspectBackupArchive, extractBackupArchive } = require(path.join(APP, 'server/lib/backup-archive.js'));
const { fileHash } = require('./inherited/resources/app/scripts/lib/backup-diagnostic-fixture.js');
(async () => {
  const [archive, root, payloadFile, output] = process.argv.slice(2), payload = JSON.parse(fs.readFileSync(payloadFile));
  const info = await inspectBackupArchive(archive, { requireType: 'full', validateData: true });
  assert.equal(info.manifest.user.id, 'moderator'); assert.equal(info.manifest.user.systemRole, 'moderator');
  const entries = new Map(info.manifest.contents.map(f => [f.path, f]));
  for (const f of payload.mapped) { assert.equal(entries.get(f.archivePath)?.sha256, f.sha256); assert.equal(entries.get(f.archivePath)?.size, f.size); }
  await extractBackupArchive(archive, root, { preflight: info, requireType: 'full' });
  for (const f of info.manifest.contents) {
    const target = path.join(root, f.path); assert.equal(fs.statSync(target).size, f.size); assert.equal(await fileHash(target), f.sha256);
  }
  save(output, { passed: true, archiveSha256: info.archiveSha256, contents: info.manifest.contents, restoredFiles: info.manifest.contents.length, crcAndShaVerified: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
