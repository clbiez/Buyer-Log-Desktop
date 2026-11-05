'use strict';
// Production server/auth with isolated demo data; only AI text generation is synthetic.
require('./legacy-authority-server.cjs');
process.on('message', async message => {
  if (message.command !== 'seedLcwOutputs') return;
  try {
    const { createOutputService } = require('../../server/lib/lcwai-output/output-service');
    const created = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const now = () => created;
    const engine = { async chat() { return { text: '<h1>Demo Raporu</h1><p>' + 'Demo verileri ile düzenlenebilir rapor. '.repeat(8) + '</p>', chatId: 'demo', model: { label: 'Demo' } }; } };
    const service = createOutputService({ engine, now, storeOptions: { now }, draftOptions: { now } });
    let first;
    for (let i = 0; i < 45; i++) {
      const result = await service.create('moderator', { message: 'Demo raporu', lang: 'tr', output: { format: 'html' } });
      first ||= result.output;
    }
    await service.create('foreign-owner', { message: 'Demo raporu', output: { format: 'html' } });
    process.send({ id: message.id, first });
  } catch (error) { process.send({ id: message.id, error: error.message }); }
});
