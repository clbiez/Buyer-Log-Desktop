'use strict';
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n=0; n<256; n+=1) {
    let c=n;
    for (let k=0; k<8; k+=1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n]=c>>>0;
  }
  return table;
})();
function crc32(buffer) {
  let crc=0xFFFFFFFF;
  for (let i=0; i<buffer.length; i+=1) crc=CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function walkFiles(root, options={}) {
  const out=[];
  const exclude = typeof options.exclude === 'function' ? options.exclude : () => false;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const full=path.join(dir,entry.name), rel=path.relative(root,full).replace(/\\/g,'/');
      if (exclude(rel,entry)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({full,rel});
    }
  }
  walk(root); return out;
}
function createZipFromDirectory(sourceDir, outputFile, options={}) {
  const prefix=String(options.rootPrefix||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
  const files=walkFiles(sourceDir,options);
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  const fd=fs.openSync(outputFile,'w');
  const central=[]; let offset=0;
  try {
    for (const file of files) {
      const body=fs.readFileSync(file.full), crc=crc32(body);
      const name=(prefix?prefix+'/':'')+file.rel;
      const nameBuf=Buffer.from(name,'utf8');
      if (nameBuf.length>0xFFFF) throw new Error('ZIP yolu çok uzun: '+name);
      const header=Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(0x0800,6);
      header.writeUInt16LE(0,8); header.writeUInt16LE(0,10); header.writeUInt16LE(0x0021,12);
      header.writeUInt32LE(crc,14); header.writeUInt32LE(body.length,18); header.writeUInt32LE(body.length,22);
      header.writeUInt16LE(nameBuf.length,26); header.writeUInt16LE(0,28);
      fs.writeSync(fd,header); fs.writeSync(fd,nameBuf); fs.writeSync(fd,body);
      central.push({nameBuf,crc,size:body.length,offset});
      offset += header.length + nameBuf.length + body.length;
    }
    const centralStart=offset;
    for (const entry of central) {
      const h=Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50,0); h.writeUInt16LE(20,4); h.writeUInt16LE(20,6); h.writeUInt16LE(0x0800,8);
      h.writeUInt16LE(0,10); h.writeUInt16LE(0,12); h.writeUInt16LE(0x0021,14);
      h.writeUInt32LE(entry.crc,16); h.writeUInt32LE(entry.size,20); h.writeUInt32LE(entry.size,24);
      h.writeUInt16LE(entry.nameBuf.length,28); h.writeUInt16LE(0,30); h.writeUInt16LE(0,32); h.writeUInt16LE(0,34);
      h.writeUInt16LE(0,36); h.writeUInt32LE(0,38); h.writeUInt32LE(entry.offset,42);
      fs.writeSync(fd,h); fs.writeSync(fd,entry.nameBuf); offset += h.length + entry.nameBuf.length;
    }
    const centralSize=offset-centralStart;
    if (central.length>0xFFFF || centralStart>0xFFFFFFFF || centralSize>0xFFFFFFFF) throw new Error('ZIP64 gerekli; paket bu sürümde desteklenen sınırı aşıyor.');
    const end=Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(0,4); end.writeUInt16LE(0,6);
    end.writeUInt16LE(central.length,8); end.writeUInt16LE(central.length,10); end.writeUInt32LE(centralSize,12); end.writeUInt32LE(centralStart,16); end.writeUInt16LE(0,20);
    fs.writeSync(fd,end);
  } finally { fs.closeSync(fd); }
  return { files:central.length, bytes:fs.statSync(outputFile).size };
}
function findEocd(fd,size) {
  const tailSize=Math.min(size,0xFFFF+22), start=size-tailSize, buf=Buffer.alloc(tailSize);
  fs.readSync(fd,buf,0,tailSize,start);
  for (let i=buf.length-22;i>=0;i-=1) if (buf.readUInt32LE(i)===0x06054b50) return { offset:start+i, buf:buf.subarray(i) };
  throw Object.assign(new Error('ZIP central directory bulunamadı.'),{code:'UPDATE_ZIP_CORRUPT'});
}
function safeEntryName(raw) {
  const name=String(raw||'').replace(/\\/g,'/');
  if (!name || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return '';
  const parts=name.split('/').filter(Boolean);
  if (!parts.length || parts.some(p=>p==='.'||p==='..')) return '';
  return parts.join('/');
}
function listZipEntries(archiveFile, limits={}) {
  const fd=fs.openSync(archiveFile,'r'), size=fs.fstatSync(fd).size;
  try {
    const eocd=findEocd(fd,size).buf;
    const count=eocd.readUInt16LE(10), centralSize=eocd.readUInt32LE(12), centralOffset=eocd.readUInt32LE(16);
    if (centralOffset+centralSize>size) throw Object.assign(new Error('ZIP central directory sınır dışı.'),{code:'UPDATE_ZIP_CORRUPT'});
    if (count>(limits.maxFiles||20000)) throw Object.assign(new Error('ZIP çok fazla dosya içeriyor.'),{code:'UPDATE_ZIP_LIMIT'});
    const entries=[]; let pos=centralOffset,total=0;
    for(let i=0;i<count;i+=1){
      const h=Buffer.alloc(46); fs.readSync(fd,h,0,46,pos);
      if(h.readUInt32LE(0)!==0x02014b50) throw Object.assign(new Error('ZIP central entry bozuk.'),{code:'UPDATE_ZIP_CORRUPT'});
      const method=h.readUInt16LE(10),crc=h.readUInt32LE(16),compressed=h.readUInt32LE(20),uncompressed=h.readUInt32LE(24);
      const nameLen=h.readUInt16LE(28),extraLen=h.readUInt16LE(30),commentLen=h.readUInt16LE(32),external=h.readUInt32LE(38),localOffset=h.readUInt32LE(42);
      const nameBuf=Buffer.alloc(nameLen); fs.readSync(fd,nameBuf,0,nameLen,pos+46); const name=safeEntryName(nameBuf.toString('utf8'));
      if(!name) throw Object.assign(new Error('ZIP içinde güvensiz yol bulundu.'),{code:'UPDATE_ZIP_TRAVERSAL'});
      const unixMode=(external>>>16)&0xFFFF; if((unixMode&0xF000)===0xA000) throw Object.assign(new Error('ZIP symbolic link içeremez.'),{code:'UPDATE_ZIP_SYMLINK'});
      if(method!==0) throw Object.assign(new Error('Bu updater yalnız deterministic STORE ZIP paketlerini kabul eder.'),{code:'UPDATE_ZIP_METHOD'});
      total+=uncompressed; if(total>(limits.maxBytes||1024*1024*1024)) throw Object.assign(new Error('ZIP açılmış boyut sınırını aşıyor.'),{code:'UPDATE_ZIP_LIMIT'});
      entries.push({name,method,crc,compressed,uncompressed,localOffset}); pos+=46+nameLen+extraLen+commentLen;
    }
    return { entries,totalBytes:total };
  } finally { fs.closeSync(fd); }
}
function extractZipSafe(archiveFile,destination,limits={}) {
  const listing=listZipEntries(archiveFile,limits); fs.mkdirSync(destination,{recursive:true});
  const root=path.resolve(destination), fd=fs.openSync(archiveFile,'r');
  try {
    for(const entry of listing.entries){
      const out=path.resolve(root,...entry.name.split('/'));
      if(out!==root && !out.startsWith(root+path.sep)) throw Object.assign(new Error('ZIP hedef dışına çıkmaya çalıştı.'),{code:'UPDATE_ZIP_TRAVERSAL'});
      const local=Buffer.alloc(30); fs.readSync(fd,local,0,30,entry.localOffset);
      if(local.readUInt32LE(0)!==0x04034b50) throw Object.assign(new Error('ZIP local header bozuk.'),{code:'UPDATE_ZIP_CORRUPT'});
      const nameLen=local.readUInt16LE(26),extraLen=local.readUInt16LE(28),dataOffset=entry.localOffset+30+nameLen+extraLen;
      const body=Buffer.alloc(entry.compressed); if(entry.compressed) fs.readSync(fd,body,0,entry.compressed,dataOffset);
      if(body.length!==entry.uncompressed || crc32(body)!==entry.crc) throw Object.assign(new Error('ZIP dosya checksum doğrulaması başarısız: '+entry.name),{code:'UPDATE_ZIP_CRC'});
      fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,body);
    }
  } finally { fs.closeSync(fd); }
  return { files:listing.entries.length, bytes:listing.totalBytes };
}
module.exports={ crc32, createZipFromDirectory, listZipEntries, extractZipSafe, safeEntryName };
