'use strict';

/* Ortak veri köküne yazan ayrı bir Buyer Log kurulumu gibi davranan alt süreç.
   Ebeveyn BUYER_LOG_SERVER_DATA_ROOT'u (ortak) ve BUYER_LOG_LOCAL_DATA_ROOT'u
   (kuruluma özel) verir. İşlemler HTTP isteğindeki kira politikasıyla
   (beklemesiz) ve sunucu rotalarının kullandığı yeniden deneme yoluyla koşar. */

const path = require('node:path');

const config = JSON.parse(process.argv[2]);
const appRoot = config.appRoot;
const store = require(path.join(appRoot, 'server', 'lib', 'quotations-store.js'));
const { runWithNonblockingFileLeases } = require(path.join(appRoot, 'server', 'lib', 'shared-file-transaction.js'));
const { withQuotationWriteRetry } = require(path.join(appRoot, 'server', 'lib', 'quotation-write-retry.js'));

const profile = { id: `user-${config.index}`, role: 'user', displayName: `Kullanıcı ${config.index}` };

async function main() {
  const outcomes = [];
  for (const op of config.ops) {
    try {
      const result = await runWithNonblockingFileLeases(() => withQuotationWriteRetry(() => store.patchLine(profile, config.requestId, op.lineId, { price: op.price })));
      outcomes.push({ ...op, ok: Boolean(result && result.changed) });
    } catch (error) {
      outcomes.push({ ...op, ok: false, code: error.code || error.message });
    }
  }
  process.stdout.write(JSON.stringify({ index: config.index, outcomes }));
}

main().catch(error => { process.stderr.write(String(error && error.stack || error)); process.exit(1); });
