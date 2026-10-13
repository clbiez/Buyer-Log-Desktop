'use strict';

const { withFileLeaseAsync } = require('./shared-file-transaction');
// Only application code holding the same file lease may call the native sync core.
// This symbol cannot arrive through JSON/tool arguments.
const HELD_DOCUMENT_LEASE = Symbol('held-document-lease');
async function guardedDocumentMutation(documents, file, work) {
  return withFileLeaseAsync(file, async () => {
    await documents.refresh();
    const mirrorResults = [], legacyWrites = [];
    const commit=async()=>{
      for (const receipt of await Promise.all(mirrorResults.splice(0))) {
        if (!receipt.ok) throw receipt.error || Object.assign(new Error('Shared journal write failed.'), { code: 'SHARED_SYNC_WRITE_FAILED', statusCode: 503 });
      }
      for(const write of legacyWrites.splice(0))write();
    };
    const result = await work({ [HELD_DOCUMENT_LEASE]: true, mirrorResults, legacyWrites, commit });
    await commit();
    return result;
  });
}
module.exports = { guardedDocumentMutation, HELD_DOCUMENT_LEASE };
