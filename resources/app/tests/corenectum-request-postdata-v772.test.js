'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const connector = require('../server/lib/agent-browser-connector');

test('CoreNectum capture recovers an omitted GetStyleList body through CDP', async () => {
  assert.equal(typeof connector.coreNectumListCapture, 'function');

  const body = { pageIndex: 0, pageSize: 250, filters: [] };
  class Client extends EventEmitter {
    async send(method) {
      if (method === 'Network.getRequestPostData') return { postData: JSON.stringify(body) };
      return {};
    }
  }

  const client = new Client();
  const capture = await connector.coreNectumListCapture({ client });
  client.emit('Network.requestWillBeSent', {
    requestId: 'style-list-request',
    request: {
      url: 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleList/GetStyleList',
      method: 'POST',
      hasPostData: true,
    },
  });

  assert.equal(await capture.waitForTemplate(250), true);
  assert.equal(capture.templates.length, 1);
  assert.deepEqual(capture.templates[0].body, body);
  await capture.stop();
});

test('CoreNectum capture keeps the existing inline POST-body path', async () => {
  const body = { pageNumber: 1, take: 20 };
  let recoveryCalls = 0;
  class Client extends EventEmitter {
    async send(method) {
      if (method === 'Network.getRequestPostData') recoveryCalls += 1;
      return {};
    }
  }

  const client = new Client();
  const capture = await connector.coreNectumListCapture({ client });
  client.emit('Network.requestWillBeSent', {
    requestId: 'inline-style-list-request',
    request: {
      url: 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleList/GetStyleList',
      method: 'POST',
      postData: JSON.stringify(body),
    },
  });

  assert.equal(await capture.waitForTemplate(250), true);
  assert.deepEqual(capture.templates[0].body, body);
  assert.equal(recoveryCalls, 0);
  await capture.stop();
});
