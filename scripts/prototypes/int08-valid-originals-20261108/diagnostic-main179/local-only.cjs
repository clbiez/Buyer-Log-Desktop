'use strict';
// Probe process guard only. This is never copied into product code.
const fs = require('node:fs');
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  let host = typeof options === 'object' && options ? options.hostname || options.host :
    typeof args[1] === 'string' ? args[1] : undefined;
  const localPath = typeof options === 'string' && !/^\d+$/.test(options) ||
    typeof options === 'object' && options && (options.path || options.fd != null);
  if (!localPath && host && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    if (process.env.INT08_GUARD_LOG) fs.appendFileSync(process.env.INT08_GUARD_LOG, 'NONLOCAL_CONNECT_BLOCKED\n');
    throw Object.assign(new Error('INT08 nonlocal networking is disabled'), { code: 'INT08_NONLOCAL_NETWORK_BLOCKED' });
  }
  return original.apply(this, args);
};

// Read-only source hardlinks must never acquire the app's write permissions.
// Do not chmod their inodes: that would change the original cache files too.
// This probe-only guard applies identically to both arms and inherited Node
// children. It leaves all private mutable image/auth/cache paths unchanged.
const path=require('node:path');
const sourceRoots=JSON.parse(process.env.INT08_SOURCE_READONLY_ROOTS||'[]').map(p=>path.resolve(p));
const protectedPath=value=>{
  if(value instanceof URL)value=require('node:url').fileURLToPath(value);
  if(Buffer.isBuffer(value))value=value.toString();
  if(typeof value!=='string')return false;
  const resolved=path.resolve(value);
  return sourceRoots.some(root=>resolved===root||resolved.startsWith(root+path.sep));
};
const deny=value=>{if(protectedPath(value)){
  if(process.env.INT08_GUARD_LOG)fs.appendFileSync(process.env.INT08_GUARD_LOG,'IMMUTABLE_SOURCE_WRITE_BLOCKED\n');
  throw Object.assign(new Error('INT08 synthetic source workbooks are read only'),{code:'INT08_IMMUTABLE_SOURCE_WRITE_BLOCKED'});
}};
const writing=flags=>typeof flags==='number'?
  Boolean(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):
  /[wa+]/.test(String(flags||'r'));
for(const name of ['open','openSync']){const original=fs[name];fs[name]=function(file,flags,...args){if(writing(flags))deny(file);return original.call(this,file,flags,...args);};}
for(const name of ['writeFile','writeFileSync','appendFile','appendFileSync','truncate','truncateSync','unlink','unlinkSync',
  'rm','rmSync','rmdir','rmdirSync','mkdir','mkdirSync','chmod','chmodSync','chown','chownSync','utimes','utimesSync',
  'lchmod','lchmodSync','lchown','lchownSync','lutimes','lutimesSync','createWriteStream']){
  if(!fs[name])continue;const original=fs[name];fs[name]=function(file,...args){deny(file);return original.call(this,file,...args);};
}
for(const name of ['rename','renameSync','link','linkSync','symlink','symlinkSync']){
  const original=fs[name];fs[name]=function(from,to,...args){deny(from);deny(to);return original.call(this,from,to,...args);};
}
for(const name of ['copyFile','copyFileSync','cp','cpSync']){
  if(!fs[name])continue;const original=fs[name];fs[name]=function(from,to,...args){deny(to);return original.call(this,from,to,...args);};
}
const promises=fs.promises;
{const original=promises.open;promises.open=async function(file,flags,...args){if(writing(flags))deny(file);return original.call(this,file,flags,...args);};}
for(const name of ['writeFile','appendFile','truncate','unlink','rm','rmdir','mkdir','chmod','chown','utimes','lchmod','lchown','lutimes']){
  if(!promises[name])continue;const original=promises[name];promises[name]=async function(file,...args){deny(file);return original.call(this,file,...args);};
}
for(const name of ['rename','link','symlink']){
  const original=promises[name];promises[name]=async function(from,to,...args){deny(from);deny(to);return original.call(this,from,to,...args);};
}
for(const name of ['copyFile','cp']){
  if(!promises[name])continue;const original=promises[name];promises[name]=async function(from,to,...args){deny(to);return original.call(this,from,to,...args);};
}
