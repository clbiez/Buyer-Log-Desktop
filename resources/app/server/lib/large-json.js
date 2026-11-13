'use strict';

/*
 * BÜYÜK JSON — V8 string sınırı olmadan yazma, okuma ve hash.
 *
 * V8'de tek bir string ~512 MB'ı (0x1fffffe8 karakter) aşamaz. Yerel DB'nin
 * anlık görüntüsü tek JSON.stringify ile üretildiğinde, durum bu sınırı
 * geçtiği an her yazma "RangeError: Invalid string length" ile düşüyor ve
 * sync kalıcı olarak duruyordu. Aynı sınır okuma tarafında da var:
 * readFile(…, 'utf8') bu boyutta string oluşturamaz.
 *
 * Bu modül çıktıyı PARÇA parça üretir: üst seviyeler elle gezilir, alt
 * ağaçlar yerel JSON.stringify ile serileştirilir. Parçaların birleşimi
 * JSON.stringify(value, null, indent) ile BAYT BAYT aynıdır; dolayısıyla
 * hash'ler ve dosya biçimi değişmez. Okuma da tersini yapar: tampon küçükse
 * tek JSON.parse, büyükse yapı tampon üzerinde taranıp her çocuk ayrı
 * çözülür.
 */
const crypto = require('crypto');

// Doğrudan JSON.parse edilecek en büyük tampon. utf8 çözümünde karakter
// sayısı bayt sayısını aşmaz; sınırın yarısı güvenli bir paydır.
const DIRECT_PARSE_MAX_BYTES = 256 * 1024 * 1024;
const FLUSH_CHARS = 8 * 1024 * 1024;

function toJsonValue(value, key) {
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') return value.toJSON(key);
  return value;
}
function serializable(value) {
  return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
}

/* JSON.stringify(value, null, indent) ile aynı metni parça parça üretir.
   `expandDepth` derinliğe kadar nesne/dizi elle gezilir; daha derindeki alt
   ağaçlar tek JSON.stringify ile üretilir (hızlı yol). Infinity verilirse
   her düğüm gezilir — önizleme gibi erken durması gereken çağrılar için. */
function* jsonChunks(value, { indent = 0, expandDepth = 3 } = {}) {
  const gap = typeof indent === 'number' ? ' '.repeat(Math.max(0, Math.min(10, indent))) : String(indent || '').slice(0, 10);
  function* walk(input, key, depth, prefix) {
    const node = toJsonValue(input, key);
    if (node === null || typeof node !== 'object' || depth >= expandDepth) {
      const text = JSON.stringify(node, null, gap);
      if (text === undefined) return;
      yield gap && prefix ? text.replace(/\n/g, `\n${prefix}`) : text;
      return;
    }
    const inner = prefix + gap, open = gap ? `\n${inner}` : '', close = gap ? `\n${prefix}` : '';
    if (Array.isArray(node)) {
      if (!node.length) { yield '[]'; return; }
      yield '[';
      for (let index = 0; index < node.length; index += 1) {
        yield index ? `,${open}` : open;
        const item = toJsonValue(node[index], String(index));
        if (!serializable(item)) yield 'null';
        else yield* walk(item, String(index), depth + 1, inner);
      }
      yield `${close}]`;
      return;
    }
    let first = true;
    for (const name of Object.keys(node)) {
      const item = toJsonValue(node[name], name);
      if (!serializable(item)) continue;
      yield first ? `{${open}` : `,${open}`;
      first = false;
      yield `${JSON.stringify(name)}:${gap ? ' ' : ''}`;
      yield* walk(item, name, depth + 1, inner);
    }
    yield first ? '{}' : `${close}}`;
  }
  if (!serializable(toJsonValue(value, ''))) return;
  yield* walk(value, '', 0, '');
}

function eachBatch(value, options, visit) {
  let batch = [], size = 0;
  for (const chunk of jsonChunks(value, options)) {
    batch.push(chunk); size += chunk.length;
    if (size >= FLUSH_CHARS) { visit(batch.join('')); batch = []; size = 0; }
  }
  if (batch.length) visit(batch.join(''));
}

/* Buffer.from(JSON.stringify(value, null, indent), 'utf8') eşdeğeri. */
function jsonToBuffer(value, options = {}) {
  const parts = [];
  eachBatch(value, options, text => parts.push(Buffer.from(text, 'utf8')));
  return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}

/* sha256(JSON.stringify(value)) eşdeğeri — tam metni hiç oluşturmaz. */
function jsonSha256(value, options = {}) {
  const hash = crypto.createHash('sha256');
  eachBatch(value, options, text => hash.update(text, 'utf8'));
  return hash.digest('hex');
}

/* En fazla maxChars karakterlik önizleme. Değer ne kadar büyük olursa olsun
   yalnız gereken kadarı gezilir. */
function jsonPreview(value, maxChars = 2000, indent = 2) {
  const limit = Math.max(1, Number(maxChars) || 2000);
  let text = '', truncated = false;
  for (const chunk of jsonChunks(value, { indent, expandDepth: Infinity })) {
    if (text.length + chunk.length > limit) { text += chunk.slice(0, limit - text.length); truncated = true; break; }
    text += chunk;
  }
  return { text: value === undefined ? '' : text, truncated };
}

/* ---------- Okuma ---------- */
const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
function skipWs(buffer, index, end) {
  while (index < end && WS.has(buffer[index])) index += 1;
  return index;
}
function stringEnd(buffer, index, end) {
  // index: açılış tırnağı. Dönüş: kapanış tırnağından sonraki konum.
  for (let i = index + 1; i < end; i += 1) {
    const byte = buffer[i];
    if (byte === 0x5c) { i += 1; continue; }
    if (byte === 0x22) return i + 1;
  }
  throw new SyntaxError('Unterminated string in JSON');
}
function valueEnd(buffer, index, end) {
  const first = buffer[index];
  if (first === 0x22) return stringEnd(buffer, index, end);
  if (first === 0x7b || first === 0x5b) {
    let depth = 0;
    for (let i = index; i < end; i += 1) {
      const byte = buffer[i];
      if (byte === 0x22) { i = stringEnd(buffer, i, end) - 1; continue; }
      if (byte === 0x7b || byte === 0x5b) depth += 1;
      else if (byte === 0x7d || byte === 0x5d) { depth -= 1; if (!depth) return i + 1; }
    }
    throw new SyntaxError('Unterminated container in JSON');
  }
  let i = index;
  while (i < end && !WS.has(buffer[i]) && buffer[i] !== 0x2c && buffer[i] !== 0x7d && buffer[i] !== 0x5d) i += 1;
  return i;
}
function parseRange(buffer, start, end, limit) {
  start = skipWs(buffer, start, end);
  let stop = end;
  while (stop > start && WS.has(buffer[stop - 1])) stop -= 1;
  if (stop - start <= limit) return JSON.parse(buffer.toString('utf8', start, stop));
  const open = buffer[start];
  if (open !== 0x7b && open !== 0x5b) return JSON.parse(buffer.toString('utf8', start, stop));
  const isArray = open === 0x5b, out = isArray ? [] : {};
  let i = skipWs(buffer, start + 1, stop);
  if (buffer[i] === (isArray ? 0x5d : 0x7d)) {
    if (skipWs(buffer, i + 1, stop) !== stop) throw new SyntaxError('Unexpected data after JSON value');
    return out;
  }
  for (;;) {
    let name = null;
    if (!isArray) {
      if (buffer[i] !== 0x22) throw new SyntaxError('Expected property name in JSON');
      const keyEnd = stringEnd(buffer, i, stop);
      name = JSON.parse(buffer.toString('utf8', i, keyEnd));
      i = skipWs(buffer, keyEnd, stop);
      if (buffer[i] !== 0x3a) throw new SyntaxError('Expected ":" in JSON');
      i = skipWs(buffer, i + 1, stop);
    }
    const childEnd = valueEnd(buffer, i, stop);
    const child = parseRange(buffer, i, childEnd, limit);
    if (isArray) out.push(child);
    else if (name === '__proto__') Object.defineProperty(out, name, { value: child, enumerable: true, writable: true, configurable: true });
    else out[name] = child;
    i = skipWs(buffer, childEnd, stop);
    if (buffer[i] === 0x2c) { i = skipWs(buffer, i + 1, stop); continue; }
    if (buffer[i] === (isArray ? 0x5d : 0x7d)) {
      if (skipWs(buffer, i + 1, stop) !== stop) throw new SyntaxError('Unexpected data after JSON value');
      return out;
    }
    throw new SyntaxError('Unexpected token in JSON');
  }
}
/* JSON.parse(buffer.toString('utf8')) eşdeğeri; V8 string sınırını aşan
   tamponları da okur. */
function parseJsonBuffer(buffer, { directMaxBytes = DIRECT_PARSE_MAX_BYTES } = {}) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8');
  let start = 0;
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) start = 3;
  if (data.length - start <= directMaxBytes) return JSON.parse(data.toString('utf8', start));
  return parseRange(data, start, data.length, Math.max(1, Number(directMaxBytes) || DIRECT_PARSE_MAX_BYTES));
}

// The serial recovery lane and the local DB load must yield while decoding a
// large snapshot. Object keys retain JSON semantics, including own __proto__
// properties and duplicate-key replacement.
//
// Performance (309 MB local DB snapshot): the original generator scanned every
// byte inside a generator and parsed each small member separately (~6.6 s).
// Here the byte scan is a plain loop over bounded slices and consecutive small
// members are decoded by ONE native JSON.parse per ~1 MB batch (~4.3 s), while
// the event loop still gets control at least every ~8 ms of work (measured max
// gap 26-47 ms). Result is deepEqual to parseJsonBuffer on the same snapshot.
const ASYNC_BATCH_BYTES = 1024 * 1024;
const ASYNC_SCAN_SLICE_BYTES = 256 * 1024;
const ASYNC_NATIVE_CHILD_BYTES = 64 * 1024;
async function parseJsonBufferAsync(buffer, {yieldControl} = {}) {
  if(typeof yieldControl!=='function')throw new TypeError('A cooperative yield callback is required');
  const data=Buffer.isBuffer(buffer)?buffer:Buffer.from(String(buffer||''),'utf8');
  let deadline=performance.now()+8;
  // Plain (non-generator) byte loop: V8 optimizes it like valueEnd(). The
  // caller yields between bounded slices, so huge values still stay responsive.
  // Key text ends at the closing quote; walk back over whitespace and ':'.
  function skipWsBack(from,to){let k=to;while(k>from&&(WS.has(data[k-1])||data[k-1]===0x3a))k--;return k;}
  function scanSlice(st,end){
    const data_=data,limit=Math.min(end,st.i+ASYNC_SCAN_SLICE_BYTES);
    let {i,depth,inString,escaped}=st;
    for(;i<limit;i++){
      const byte=data_[i];
      if(inString){if(escaped)escaped=false;else if(byte===0x5c)escaped=true;else if(byte===0x22){inString=false;if(!depth)return i+1;}continue;}
      if(byte===0x22){inString=true;continue;}
      if(byte===0x7b||byte===0x5b)depth++;
      else if(byte===0x7d||byte===0x5d){if(!depth)return i;if(!--depth)return i+1;}
      else if(!depth&&(byte===0x20||byte===0x0a||byte===0x0d||byte===0x09||byte===0x2c))return i;
    }
    st.i=i;st.depth=depth;st.inString=inString;st.escaped=escaped;return -1;
  }
  function* scan(index,end){
    const st={i:index,depth:0,inString:false,escaped:false};
    for(;;){
      const found=scanSlice(st,end);if(found>=0)return found;
      if(st.i>=end){if(st.inString||st.depth)throw new SyntaxError('Unterminated JSON value');return end;}
      yield;
    }
  }
  function* parse(start,end){
    start=skipWs(data,start,end);
    let stop=end;while(stop>start&&WS.has(data[stop-1]))stop--;
    const open=data[start];
    if(stop-start<=ASYNC_NATIVE_CHILD_BYTES||(open!==0x7b&&open!==0x5b))return JSON.parse(data.toString('utf8',start,stop));
    yield;
    const array=open===0x5b,out=array?[]:{};let i=skipWs(data,start+1,stop);
    if(data[i]===(array?0x5d:0x7d)){if(skipWs(data,i+1,stop)!==stop)throw new SyntaxError('Unexpected data after JSON value');return out;}
    // Consecutive small members are decoded by ONE native JSON.parse call per
    // ~BATCH bytes: per-member parse calls were the dominant cost on large DBs.
    let batchStart=-1,batchEnd=-1;
    const flush=()=>{
      if(batchStart<0)return;
      const text=data.toString('utf8',batchStart,batchEnd);batchStart=-1;
      if(array){const items=JSON.parse('['+text+']');for(let k=0;k<items.length;k++)out.push(items[k]);return;}
      const part=JSON.parse('{'+text+'}');
      for(const key of Object.keys(part)){if(key==='__proto__')Object.defineProperty(out,key,{value:part[key],enumerable:true,writable:true,configurable:true});else out[key]=part[key];}
    };
    for(;;){
      const memberStart=i;
      if(!array){
        if(data[i]!==0x22)throw new SyntaxError('Expected property name in JSON');
        const keyEnd=yield* scan(i,stop);
        i=skipWs(data,keyEnd,stop);if(data[i]!==0x3a)throw new SyntaxError('Expected colon in JSON');i=skipWs(data,i+1,stop);
      }
      const childEnd=yield* scan(i,stop);
      // A JSON value is never empty. Without this, a trailing comma after a
      // flushed large member became an empty batch that parsed as nothing.
      if(childEnd===i)throw new SyntaxError('Unexpected token in JSON');
      if(childEnd-i<=ASYNC_NATIVE_CHILD_BYTES){
        if(batchStart<0)batchStart=memberStart;
        batchEnd=childEnd;
        if(batchEnd-batchStart>=ASYNC_BATCH_BYTES){flush();yield;}
      }else{
        flush();
        const name=array?null:JSON.parse(data.toString('utf8',memberStart,skipWsBack(memberStart,i)));
        const child=yield* parse(i,childEnd);
        if(array)out.push(child);else if(name==='__proto__')Object.defineProperty(out,name,{value:child,enumerable:true,writable:true,configurable:true});else out[name]=child;
      }
      i=skipWs(data,childEnd,stop);
      if(data[i]===0x2c){i=skipWs(data,i+1,stop);continue;}
      if(data[i]===(array?0x5d:0x7d)){flush();if(skipWs(data,i+1,stop)!==stop)throw new SyntaxError('Unexpected data after JSON value');return out;}
      throw new SyntaxError('Unexpected token in JSON');
    }
  }
  const start=data[0]===0xef&&data[1]===0xbb&&data[2]===0xbf?3:0,steps=parse(start,data.length);
  for(;;){const step=steps.next();if(step.done)return step.value;if(performance.now()>=deadline){await yieldControl();deadline=performance.now()+8;}}
}

module.exports = { jsonChunks, jsonToBuffer, jsonSha256, jsonPreview, parseJsonBuffer, parseJsonBufferAsync, DIRECT_PARSE_MAX_BYTES };
