'use strict';

/* Hybrid Logical Clock: the physical clock may move backwards, but generated
   event stamps remain monotonic. No persistence, network or event replay here. */
const SKEW_THRESHOLD_MS = 5 * 60 * 1000;
const HEX_WIDTH = 16;
const SERIALIZED = /^([0-9a-f]{16})-([0-9a-f]{16})-((?:[0-9a-f]{4})+)$/;

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid HLC ${name}`);
  return value;
}
function nodeId(value) {
  if (typeof value !== 'string' || !value.length) throw new TypeError('Invalid HLC node');
  return value;
}
function stamp(value) {
  if (typeof value === 'string') return parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid HLC stamp');
  return { wallMs: safeInteger(value.wallMs, 'wallMs'), counter: safeInteger(value.counter, 'counter'), node: nodeId(value.node) };
}

function compare(a, b) {
  const left = stamp(a), right = stamp(b);
  if (left.wallMs !== right.wallMs) return left.wallMs < right.wallMs ? -1 : 1;
  if (left.counter !== right.counter) return left.counter < right.counter ? -1 : 1;
  return left.node < right.node ? -1 : left.node > right.node ? 1 : 0;
}

function serialize(value) {
  const clock = stamp(value);
  // UTF-16 code-unit hex preserves JS string ordering, including astral
  // characters and prefix nodes. Percent escaping/locale collation would not.
  let node = '';
  for (let index = 0; index < clock.node.length; index++) node += clock.node.charCodeAt(index).toString(16).padStart(4, '0');
  return clock.wallMs.toString(16).padStart(HEX_WIDTH, '0') + '-' + clock.counter.toString(16).padStart(HEX_WIDTH, '0') + '-' + node;
}

function parse(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid serialized HLC');
  const match = SERIALIZED.exec(value);
  if (!match) throw new TypeError('Invalid serialized HLC');
  let node = '';
  for (let index = 0; index < match[3].length; index += 4) node += String.fromCharCode(Number.parseInt(match[3].slice(index, index + 4), 16));
  return { wallMs: safeInteger(Number.parseInt(match[1], 16), 'wallMs'), counter: safeInteger(Number.parseInt(match[2], 16), 'counter'), node: nodeId(node) };
}

function advance(wallMs, counter, node) {
  if (counter <= Number.MAX_SAFE_INTEGER) return { wallMs, counter, node };
  if (wallMs === Number.MAX_SAFE_INTEGER) throw new RangeError('HLC representation exhausted');
  return { wallMs: wallMs + 1, counter: 0, node };
}

function createHlc({ node, now = Date.now, state, onSkew } = {}) {
  const localNode = nodeId(node);
  if (typeof now !== 'function') throw new TypeError('Invalid HLC physical clock');
  const initial = state == null ? { wallMs: 0, counter: 0, node: localNode } : stamp(state);
  let current = { wallMs: initial.wallMs, counter: initial.counter, node: localNode };

  function physicalTime() { return safeInteger(now(), 'physical time'); }
  function tick() {
    const physical = physicalTime();
    const next = physical > current.wallMs ? { wallMs: physical, counter: 0, node: localNode } : advance(current.wallMs, current.counter + 1, localNode);
    current = next;
    return { ...next };
  }
  function receive(value) {
    const remote = stamp(value), physical = physicalTime();
    const wallMs = Math.max(physical, current.wallMs, remote.wallMs);
    let counter = 0;
    if (wallMs === current.wallMs && wallMs === remote.wallMs) counter = Math.max(current.counter, remote.counter) + 1;
    else if (wallMs === current.wallMs) counter = current.counter + 1;
    else if (wallMs === remote.wallMs) counter = remote.counter + 1;
    const next = advance(wallMs, counter, localNode);
    current = next;
    if (remote.wallMs - physical > SKEW_THRESHOLD_MS && typeof onSkew === 'function') {
      try { onSkew({ code: 'SYNC_HLC_CLOCK_SKEW', remote: { ...remote }, localWallMs: physical, skewMs: remote.wallMs - physical, thresholdMs: SKEW_THRESHOLD_MS }); }
      catch (_) { /* A trace failure cannot discard an otherwise valid event. */ }
    }
    return { ...next };
  }
  return { tick, receive, state: () => ({ ...current }) };
}

module.exports = { createHlc, compare, serialize, parse };
