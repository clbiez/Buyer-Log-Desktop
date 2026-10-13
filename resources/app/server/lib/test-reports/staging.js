'use strict';
/* Önizleme ile onay arasındaki geçici alan. Ayrıştırılan dosyalar ve
   normal aktarımda raporlar süreç belleğinde tutulur. Agent görevleri açıkça
   yüklenen dosyaları aynı süre sınırıyla yerel geçici alanda saklayabilir.
   Onayda sunucunun kendi ayrıştırması ve içerik parmak izi kullanılır. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {SERVER_DATA_ROOT, atomicWriteJson, atomicWriteBuffer} = require('../../user-data');
const {withFileLeaseSync}=require('../shared-file-transaction');
const ROOT = path.join(SERVER_DATA_ROOT, 'agent-test-report-staging');

const TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const sessions = new Map();
let restored = false;
function diskPath(id) { return /^[a-f0-9]{32}$/.test(String(id)) ? path.join(ROOT,id) : ''; }
function persistSession(session) {
  if (!session?.durable) return;
  if(!sessions.has(session.id))throw Object.assign(new Error('Staging capacity reached.'),{code:'TEST_REPORT_STAGING_CAPACITY',statusCode:413});
  const directory=diskPath(session.id);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const files=[];
  for(const [id,file] of session.files) {
    if(!/^[a-f0-9]{24}$/.test(id))throw new Error('Invalid staged file identifier.');
    atomicWriteBuffer(path.join(directory,id+'.bin'),file.buffer);
    const {buffer,...metadata}=file;files.push([id,metadata]);
  }
  atomicWriteJson(path.join(directory,'session.json'),{...session,files,aiCandidates:[...session.aiCandidates]});
}
function restoreSession(id) {
    const directory=diskPath(id);if(!directory)return;
    try {
      const data=JSON.parse(fs.readFileSync(path.join(directory,'session.json'),'utf8'));
      if(data.id!==id||!data.userId||!data.durable||Date.now()-data.lastAccessAt>TTL_MS){removeSession(id);return;}
      const cached=sessions.get(id);
      const files=new Map(data.files.map(([key,file])=>{
        if(!/^[a-f0-9]{24}$/.test(key))throw new Error('Invalid file');
        const verified=cached?.files.get(key)?.hash===file.hash;
        const buffer=verified?cached.files.get(key).buffer:fs.readFileSync(path.join(directory,key+'.bin'));
        if(buffer.length>40*1024*1024||!verified&&crypto.createHash('sha256').update(buffer).digest('hex')!==file.hash)throw new Error('Staged file changed');
        return [key,{...file,buffer}];
      }));
      sessions.set(id,{...data,files,aiCandidates:new Map(data.aiCandidates)});
    }catch(err){if(err.code==='ENOENT'){sessions.delete(id);return;}removeSession(id);}
}
function restoreSessions() {
  if(restored)return;restored=true;
  if(fs.existsSync(ROOT))for(const id of fs.readdirSync(ROOT))restoreSession(id);
}
function removeSession(id) { sessions.delete(id);const directory=diskPath(id);if(directory)fs.rmSync(directory,{recursive:true,force:true}); }

function purge(now) {
  restoreSessions();
  for (const [id, session] of sessions) if (now - (session.lastAccessAt || session.createdAt) > TTL_MS) removeSession(id);
  while (sessions.size > MAX_SESSIONS) removeSession(sessions.keys().next().value);
  let total = 0;
  for (const session of sessions.values()) total += session.bytes;
  for (const [id, session] of sessions) {
    if (total <= MAX_TOTAL_BYTES) break;
    total -= session.bytes; removeSession(id);
  }
}

function createSession(userId, options = {}) {
  const now = Date.now();
  purge(now);
  const id = crypto.randomBytes(16).toString('hex');
  const session = { id, userId: String(userId || ''), durable:options.durable===true, createdAt: now, lastAccessAt: now, bytes: 0, files: new Map(), reports: [], aiCandidates: new Map() };
  sessions.set(id, session);
  return {
    id,
    stage(file) {
      const fileId = crypto.randomBytes(12).toString('hex');
      session.files.set(fileId, { name: file.name, buffer: file.buffer, hash: file.hash, kind: file.kind });
      session.bytes += file.buffer.length;
      return fileId;
    },
    setReports(reports) { session.reports = reports; },
    // LCW AI'a gönderilebilecek, deterministik okunamayan dosyalar (ada göre).
    setAiCandidates(files) { (files || []).forEach(f => { if (f && f.ai && f.ai.eligible) session.aiCandidates.set(f.name, f.ai); });purge(Date.now());persistSession(session); },
  };
}

function getSession(id, userId) {
  const now = Date.now();
  purge(now);
  const directory=diskPath(id),known=sessions.get(String(id));
  if(directory&&(!known||known.durable))restoreSession(String(id));
  const session = sessions.get(String(id || ''));
  if (!session || session.userId !== String(userId || '')) return null;
  session.lastAccessAt = now;
  return session;
}
function dropSession(id) { removeSession(String(id || '')); }
function withSessionLease(id,owner,operation) {
  const session=getSession(id,owner);if(!session)throw Object.assign(new Error('Staged session expired.'),{code:'TEST_REPORT_SESSION_EXPIRED',statusCode:410});
  return session.durable?withFileLeaseSync(path.join(diskPath(id),'session.json'),operation):operation();
}

module.exports = { createSession, getSession, dropSession, persistSession, withSessionLease, TTL_MS };
