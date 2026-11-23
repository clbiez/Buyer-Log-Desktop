'use strict';

/* Kanonik (anahtar sıralı) JSON özeti — olay döngüsünü bloklamadan.
   shared-hub.js ve master-releases.js içindeki stableJson ile BAYT BAYT aynı
   metni üretir; fark yalnız metnin tek parça string olarak kurulmaması ve
   SHA-256'ya parça parça akıtılmasıdır. Büyük Master/iş checkpoint'inde eski
   yol tek senkron blokta onlarca MB string kurup hash'liyordu (saha profili:
   publish başına saniyeler süren donma + GC). Burada ~10 ms'lik dilimlerden
   sonra setImmediate ile olay döngüsüne dönülür.
   Sözleşme: özet alınırken değer DEĞİŞTİRİLMEMELİDİR (çağıranlar ayrık kopya
   verir: masterRecordsFromState/businessRecordsFromState derin kopyadır). */
const crypto = require('node:crypto');

const DEFAULT_SLICE_MS = 10;
const CHECK_EVERY_NODES = 512;
const FLUSH_CHARS = 64 * 1024;
const MAX_DEPTH = 10000;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function yieldToEventLoop() { return new Promise(resolve => setImmediate(resolve)); }

/* Zaman bütçeli işbirlikçi yield. Uzun döngüler her adımda `await tick()`
   çağırır; bütçe dolmadıkça mikro-görev bile oluşturmaz. */
function createYielder(sliceMs = DEFAULT_SLICE_MS) {
  const budget = Math.max(1, Number(sliceMs) || DEFAULT_SLICE_MS);
  let sliceStart = Date.now();
  return async function tick() {
    if (Date.now() - sliceStart < budget) return false;
    await yieldToEventLoop();
    sliceStart = Date.now();
    return true;
  };
}

const isContainer = value => Boolean(value) && typeof value === 'object';

/* stableJson(value) metnini `write` fonksiyonuna parçalar halinde yazar.
   Dizi içinde undefined/function/symbol → '' (join davranışı), nesne içinde
   → 'undefined' (template literal davranışı): stableJson ile birebir. */
async function streamStableJson(value, write, { sliceMs = DEFAULT_SLICE_MS } = {}) {
  if (!isContainer(value)) {
    const text = JSON.stringify(value);
    if (text === undefined) throw new TypeError('stable digest requires a JSON value');
    write(text);
    return;
  }
  const tick = createYielder(sliceMs);
  const stack = [];
  let buffer = '', nodes = 0;
  const flush = () => { if (buffer) { write(buffer); buffer = ''; } };
  const open = item => {
    if (stack.length >= MAX_DEPTH) throw new RangeError('Maximum stable JSON depth exceeded');
    if (Array.isArray(item)) { buffer += '['; stack.push({ array:item, index:0 }); }
    else { buffer += '{'; stack.push({ object:item, keys:Object.keys(item).sort(), index:0 }); }
  };
  open(value);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.array) {
      if (frame.index >= frame.array.length) { buffer += ']'; stack.pop(); }
      else {
        if (frame.index > 0) buffer += ',';
        const item = frame.array[frame.index++];
        if (isContainer(item)) open(item);
        else { const text = JSON.stringify(item); if (text !== undefined) buffer += text; }
      }
    } else if (frame.index >= frame.keys.length) { buffer += '}'; stack.pop(); }
    else {
      const key = frame.keys[frame.index];
      if (frame.index > 0) buffer += ',';
      frame.index++;
      buffer += `${JSON.stringify(key)}:`;
      const item = frame.object[key];
      if (isContainer(item)) open(item);
      else buffer += `${JSON.stringify(item)}`;
    }
    if (buffer.length >= FLUSH_CHARS) flush();
    if (++nodes >= CHECK_EVERY_NODES) {
      nodes = 0;
      flush();
      await tick();
    }
  }
  flush();
}

/* sha256(Buffer.from(stableJson(value), 'utf8')) ile aynı hex özet. */
async function stableSha256(value, options = {}) {
  const hash = crypto.createHash('sha256');
  await streamStableJson(value, chunk => hash.update(chunk, 'utf8'), options);
  return hash.digest('hex');
}

/* Zarf ve iç alanın (ör. checkpoint ve payload) özetini TEK geçişte üretir:
   { outer: sha256(stableJson(envelope)), inner: sha256(stableJson(envelope[key])) }.
   İç alan metni iki hash'e aynı anda akıtılır; payload iki kez gezilmez. */
async function stableSha256Pair(envelope, key = 'payload', options = {}) {
  if (!isContainer(envelope) || Array.isArray(envelope)) throw new TypeError('stable digest pair requires an object envelope');
  const outer = crypto.createHash('sha256'), inner = crypto.createHash('sha256');
  const writeOuter = chunk => outer.update(chunk, 'utf8');
  const writeBoth = chunk => { outer.update(chunk, 'utf8'); inner.update(chunk, 'utf8'); };
  const keys = Object.keys(envelope).sort();
  let innerSeen = false;
  writeOuter('{');
  for (let index = 0; index < keys.length; index++) {
    const name = keys[index], item = envelope[name];
    writeOuter(`${index > 0 ? ',' : ''}${JSON.stringify(name)}:`);
    if (name === key) {
      innerSeen = true;
      await streamStableJson(item, writeBoth, options);
    } else if (isContainer(item)) await streamStableJson(item, writeOuter, options);
    else writeOuter(`${JSON.stringify(item)}`);
  }
  writeOuter('}');
  if (!innerSeen) throw new TypeError(`stable digest pair requires envelope.${key}`);
  return { outer:outer.digest('hex'), inner:inner.digest('hex') };
}

module.exports = { stableJson, stableSha256, stableSha256Pair, streamStableJson, createYielder, yieldToEventLoop };
