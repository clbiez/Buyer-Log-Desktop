'use strict';

// Synthetic, valid 1x1 RGBA PNGs with variable ancillary text payloads.
// No URLs are fetched. Descriptors contain no retained image buffers.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let n = 0xffffffff;
  for (const byte of bytes) n = TABLE[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  out.write(type, 4, 'ascii');
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
const HEAD = Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 40, 80, 120, 255])))]);
const END = chunk('IEND', Buffer.alloc(0));
function png(size, tag) {
  if (!Number.isInteger(size) || size < 512) throw new Error('Synthetic PNG size must be >=512');
  const text = Buffer.alloc(size - HEAD.length - END.length - 12, 65 + Number(tag) % 26);
  text.write(`synthetic\0fixture-v1-${tag}|`, 0, 'ascii');
  return Buffer.concat([HEAD, chunk('tEXt', text), END]);
}
function fixture(count = 2048, sizes = [8192, 32768, 131072, 524288]) {
  return Array.from({ length: count }, (_, i) => ({
    plmId: String(8000000 + i), colourCode: 'SYN', colour: 'SYNTHETIC',
    imageRole: 'option', styleId: String(9000000 + i),
    urlId: i, contentTag: i, size: sizes[i % sizes.length],
  }));
}
const url = id => `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/int03-synthetic-${id}`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
module.exports = { png, fixture, url, hash, crc32 };
