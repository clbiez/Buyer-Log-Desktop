'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Markdown = require('../public/lcwai-markdown');
const source = fs.readFileSync(require.resolve('../public/lcwai-chat'), 'utf8').replace(
  'window.BLLcwAiChat = {', 'window.BLLcwAiChat = { draw: renderMessages,');

function fixture() {
  let parses = 0, writes = 0;
  const box = {
    scrollTop: 0, scrollHeight: 2000, clientHeight: 400, children: [],
    get lastElementChild() { return this.children.at(-1); },
    get innerHTML() { return this.children.map(node => node.html).join(''); },
    set innerHTML(html) {
      writes++;
      this.children = html.split(/(?=<div class="lcwaiMsg (?:is-user|is-ai))/).filter(Boolean).map(value => ({
        parentNode: box, html: value,
        set outerHTML(next) { this.html = next; },
      }));
    },
  };
  const window = { appLang: 'en', addEventListener() {}, BLMarkdown: { render(...args) { parses++; return Markdown.render(...args); } } };
  const host = { querySelector: selector => selector === '[data-chat-messages]' ? box : null };
  vm.runInNewContext(source, { window, document: { getElementById: () => host, documentElement: {} }, setTimeout, clearTimeout });
  const chat = window.BLLcwAiChat, state = chat._state;
  const answer = { role: 'ai', text: '', streaming: true };
  const conv = { id: 'demo', messages: [{ role: 'user', text: 'Question' }, { role: 'ai', text: '**History**' }, answer] };
  state.conversations = [conv]; state.activeId = conv.id;
  return { chat, state, answer, conv, window, box, get parses() { return parses; }, get writes() { return writes; } };
}

test('stream draws only its active message and retains history nodes and reading position', () => {
  const p = fixture(); p.chat.draw(); const history = p.box.children[1], before = p.parses, writes = p.writes;
  p.box.scrollTop = 120;
  for (let i = 0; i < 10; i++) { p.answer.text += '\n**Delta**'; p.chat.draw(p.answer); }
  assert.equal(p.parses - before, 10);
  assert.equal(p.writes, writes, 'the conversation container must not be replaced');
  assert.equal(p.box.children[1], history);
  assert.equal(p.box.scrollTop, 120);
  const optimized = p.box.innerHTML; p.chat.draw(); assert.equal(p.box.innerHTML, optimized);
});

test('active rendering keeps safe Markdown, bottom-follow, final error and language output', () => {
  const p = fixture(); p.chat.draw(); p.box.scrollTop = 1600;
  p.answer.text = '<img onerror=alert(1)> [bad](javascript:alert(1))\n```js\nconst x=1;';
  p.chat.draw(p.answer);
  assert.equal(p.box.scrollTop, p.box.scrollHeight);
  assert.doesNotMatch(p.box.innerHTML, /<img|href="javascript:/);
  p.answer.text += '\n```'; p.chat.draw(p.answer);
  const optimized = p.box.innerHTML; p.chat.draw(); assert.equal(p.box.innerHTML, optimized);
  p.answer.streaming = false; p.answer.error = 'Cancelled <script>'; p.answer.login = true;
  p.chat.draw(p.answer); const failed = p.box.innerHTML; p.chat.draw(); assert.equal(p.box.innerHTML, failed);
  p.window.appLang = 'tr'; p.chat.draw(p.answer); const translated = p.box.innerHTML; p.chat.draw(); assert.equal(p.box.innerHTML, translated);
  assert.match(translated, /LCW AI Girişi Yap/);
});

test('conversation, output view and appended messages invalidate the active-message fast path', () => {
  const p = fixture(); p.chat.draw();
  p.conv.messages.push({ role: 'user', text: 'Next' }); p.chat.draw(p.answer);
  assert.match(p.box.innerHTML, /Next/);
  const other = { id: 'other', messages: [{ role: 'ai', text: 'Other' }] };
  p.state.conversations.push(other); p.state.activeId = other.id; p.chat.draw(p.answer);
  assert.match(p.box.innerHTML, /Other/); assert.doesNotMatch(p.box.innerHTML, /History/);
  p.state.viewingOutputs = true; p.chat.draw(p.answer); assert.match(p.box.innerHTML, /My files/);
  p.state.viewingOutputs = false; p.state.activeId = p.conv.id; p.chat.draw(p.answer); assert.match(p.box.innerHTML, /History/);
});
