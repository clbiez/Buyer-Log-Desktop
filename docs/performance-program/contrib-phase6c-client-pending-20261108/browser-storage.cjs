'use strict';
// Real Chromium localStorage acceptance, isolated synthetic origin per case.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const playwright = require(process.env.BUYER_LOG_PLAYWRIGHT_MODULE || require.resolve('playwright', { paths: [process.cwd(), '/workspace/.buyerlog-tools'] }));
const publicRoot = path.resolve(__dirname, '../../../resources/app/public');
async function main() {
  const server = http.createServer((req, res) => {
    const name = req.url.slice(1);
    if (['collection-delta-commands.js','collection-delta-pending-journal.js'].includes(name)) { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync(path.join(publicRoot, name))); }
    else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><script src="/collection-delta-commands.js"></script><script src="/collection-delta-pending-journal.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({ executablePath: process.env.BUYER_LOG_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const results = [];
  async function setup(page, open) {
    await page.goto('http://127.0.0.1:' + server.address().port);
    return page.evaluate(open => {
      window.failHead = false;
      const current = { ownerId: 'synthetic-owner', clientGeneration: 7, sourceId: 'accepted-4', view: 'single', canEdit: true };
      const storage = BLCollectionDeltaPendingJournal.createWebStorage({ getItem: key => localStorage.getItem(key), setItem(key, value) {
        if (window.failHead && key.endsWith('/head')) throw new DOMException('synthetic head interruption', 'QuotaExceededError');
        localStorage.setItem(key, value);
      } });
      window.a = BLCollectionDeltaPendingJournal.createPendingJournal({ storage, getCurrent: () => ({ ...current }), legacyKey: 'old-pending' });
      window.command = (id, rowId = 1) => BLCollectionDeltaCommands.prepareFieldCommand(a.getState(), { kind: BLCollectionDeltaCommands.UNIT, operationId: id, rowId, writes: [{ key: 'quantity', after: { present: true, value: '20' } }] });
      if (open) a.open();
      else {
        a.bindAccepted({ bindingId: 'browser', rows: [{ id: 1, _rev: 4, quantity: '10' }, { id: 2, _rev: 4, quantity: '10' }], customColumns: [], workspaceRevision: 4, baseStructure: '{"order":["1","2"]}' });
        localStorage.setItem('old-pending', '{"schemaVersion":2,"ownerId":"synthetic-owner","rows":[],"extension":"preserve"}');
        a.record(command('edit')); a.prepareRequest(['edit'], { requestId: 'req' });
      }
      return { value: a.getState().rows[0].quantity, originalPending: localStorage.getItem('old-pending') };
    }, open);
  }
  try {
    for (const mode of ['quota','missing','corrupt','half-compaction','ack-storage-failure']) {
      const context = await browser.newContext(), page = await context.newPage();
      try {
        const seed = await setup(page, false);
        const result = await page.evaluate(mode => {
          const saved = localStorage.getItem('old-pending');
          let rejected = false;
          if (mode === 'quota') {
            for (const size of [65536, 1024, 64]) for (let i = 0; i < 20000; i++) {
              try { localStorage.setItem('synthetic-filler-' + size + '-' + i, 'x'.repeat(size)); } catch (error) { if (error.name !== 'QuotaExceededError') throw error; break; }
            }
            try { a.record(command('quota-edit', 2)); } catch (error) { rejected = error.name === 'QuotaExceededError'; }
          } else if (mode === 'missing' || mode === 'corrupt') {
            const key = Object.keys(localStorage).find(key => key.includes('/event/'));
            if (mode === 'missing') localStorage.removeItem(key); else localStorage.setItem(key, '{');
            const probe = BLCollectionDeltaPendingJournal.createPendingJournal({ storage: localStorage, getCurrent: () => ({ ownerId: 'synthetic-owner', clientGeneration: 7, sourceId: 'accepted-4', view: 'single', canEdit: true }), legacyKey: 'old-pending' });
            try { probe.open(); } catch (_) { rejected = true; }
          } else {
            window.failHead = true;
            try {
              if (mode === 'half-compaction') a.compact();
              else { const delivery = a.retry('req'); a.acknowledgePrimary(delivery, { ok: true, revision: 5, conflicts: [], applied: [{ id: '1', kind: 'changed', rev: 5 }] }); }
            } catch (error) { rejected = error.name === 'QuotaExceededError'; }
          }
          return { rejected, oldPendingPreserved: localStorage.getItem('old-pending') === saved, history: a.getState().history.undo, basePresent: Object.keys(localStorage).some(key => key.includes('/base/')) };
        }, mode);
        assert.equal(result.rejected, true); assert.equal(result.oldPendingPreserved, true); assert.equal(result.basePresent, true); assert.deepEqual(result.history, []);
        let reopened = null;
        if (!['missing','corrupt'].includes(mode)) {
          reopened = await setup(page, true); assert.equal(reopened.value, '20'); assert.equal(reopened.originalPending, seed.originalPending);
        }
        results.push({ mode, ...result, reopened });
      } finally { await context.close(); }
    }
    const report = { browser: await browser.version(), engine: 'Chromium real localStorage', cases: results, claims: 'Storage API success and page reload only; no power-loss or physical fsync proof' };
    fs.writeFileSync(path.join(__dirname, 'evidence/browser-storage.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
