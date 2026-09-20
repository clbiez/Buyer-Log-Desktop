'use strict';
const fs = require('fs');
const path = require('path');

function readJson(file, fallback=null) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch (_) { return fallback; }
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive:true }); }
function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try { fs.renameSync(tmp, file); }
  catch (error) {
    try { fs.rmSync(file, { force:true }); fs.renameSync(tmp, file); }
    catch (_) { try { fs.rmSync(tmp, { force:true }); } catch (_) {} throw error; }
  }
}
module.exports = { readJson, atomicWriteJson, ensureDir };
