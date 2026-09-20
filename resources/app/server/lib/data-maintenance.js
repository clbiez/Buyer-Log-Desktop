'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync } = require('./shared-file-transaction');

const CLASSIFICATIONS = Object.freeze([
  'CRITICAL','RECOVERABLE','SYNC','CACHE','BROWSER_SESSION','BROWSER_CACHE','EXPORT','BACKUP','LEGACY_VERIFIED','LEGACY_CANDIDATE','UNKNOWN',
]);
const NEVER_DELETE = new Set(['CRITICAL','RECOVERABLE','SYNC','BROWSER_SESSION','UNKNOWN','LEGACY_CANDIDATE']);
const BROWSER_CACHE_NAMES = new Set(['Cache','Code Cache','GPUCache','ShaderCache','GrShaderCache','BrowserMetrics']);
const BROWSER_SESSION_NAMES = new Set(['Cookies','Login Data','Local Storage','IndexedDB','OneAuth']);
const TEMP_NAMES = /(?:\.tmp$|\.partial$|\.compacting$|\.rollback$|\.tmp\.|\.rollback\.)/i;

function fmtPath(value) { return path.resolve(String(value || '.')); }
async function statSafe(file) { try { return await fsp.stat(file); } catch (_) { return null; } }
async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file); stream.on('data', chunk => hash.update(chunk)); stream.on('end', resolve); stream.on('error', reject);
  });
  return hash.digest('hex');
}
async function walkStats(root, { collectFiles = false, maxFiles = 250000 } = {}) {
  const result = { files: 0, directories: 0, bytes: 0, errors: 0, fileList: [] };
  const start = await statSafe(root); if (!start) return result;
  if (start.isFile()) return { ...result, files: 1, bytes: start.size, fileList: collectFiles ? [{ path: root, size: start.size, mtimeMs: start.mtimeMs }] : [] };
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop(); result.directories += 1;
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { result.errors += 1; continue; }
    for (const entry of entries) {
      if (result.files >= maxFiles) { result.errors += 1; break; }
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.isFile()) continue;
      try {
        const st = await fsp.stat(full); result.files += 1; result.bytes += st.size;
        if (collectFiles) result.fileList.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
      } catch (_) { result.errors += 1; }
    }
  }
  return result;
}
function item(category, target, classification, safeToClean, reason, stats = {}) {
  return { category, path: fmtPath(target), fileCount: Number(stats.files)||0, directoryCount: Number(stats.directories)||0, size: Number(stats.bytes)||0, classification, usedBy: reason.usedBy || '', safeToClean: Boolean(safeToClean), reason: reason.text || String(reason || '') };
}
function ensureClassification(value) { return CLASSIFICATIONS.includes(value) ? value : 'UNKNOWN'; }
function isInside(root, target) { const rel=path.relative(fmtPath(root),fmtPath(target)); return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)); }

async function findVerifiedDuplicateFiles(roots, { maxFiles = 10000 } = {}) {
  const activeRoots = [...new Set([roots.serverDataRoot, roots.appDataRoot, roots.localDataRoot].filter(Boolean).map(fmtPath))];
  const results = [];
  for (const legacyRootRaw of roots.legacyCandidates || []) {
    const legacyRoot = fmtPath(legacyRootRaw);
    // Never classify a path that is itself active (or nested inside an active
    // root) as legacy. This guard matters when environment variables point an
    // active data root at a project folder that would otherwise be a default
    // legacy candidate.
    if (activeRoots.some(active => isInside(active, legacyRoot))) continue;
    const scanned = await walkStats(legacyRoot, { collectFiles: true, maxFiles });
    for (const file of scanned.fileList) {
      const rel = path.relative(legacyRoot, file.path);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      for (const activeRoot of activeRoots) {
        const activePath = path.join(activeRoot, rel);
        const activeStat = await statSafe(activePath);
        if (!activeStat || !activeStat.isFile() || activeStat.size !== file.size) continue;
        const [legacyHash, activeHash] = await Promise.all([fileSha256(file.path), fileSha256(activePath)]);
        if (legacyHash !== activeHash) continue;
        results.push({ legacyPath: fmtPath(file.path), activePath: fmtPath(activePath), relativePath: rel, size: file.size, sha256: legacyHash, classification: 'LEGACY_VERIFIED' });
        break;
      }
      if (results.length >= maxFiles) return results;
    }
  }
  return results;
}

function createDataMaintenance({ roots, localDb, syncSettings = null } = {}) {
  if (!roots || !localDb) throw new Error('data-maintenance requires roots and localDb.');
  const lock = path.join(roots.localDataRoot || path.dirname(localDb.getFile()), '.data-maintenance.lock');

  async function analyze() {
    const definitions = [
      ['Business / Server Data', roots.serverDataRoot, 'CRITICAL', false, { usedBy:'Collection, Quotations, rules and shared business stores', text:'Active server business data.' }],
      ['Local Current State', roots.localDbPath, 'CRITICAL', false, { usedBy:'Local-first runtime', text:'Current local business state; never auto-delete.' }],
      ['Local Backup', roots.backupPath, 'BACKUP', false, { usedBy:'Local recovery', text:'Known-good local recovery snapshot.' }],
      ['Local WAL', roots.localWalPath, 'RECOVERABLE', false, { usedBy:'Crash-safe local writes', text:'Unsnapshotted local operations; never clean independently.' }],
      ['Page Cache', roots.cacheRoot, 'CACHE', true, { usedBy:'Rebuildable page cache', text:'Rebuildable cache; safe-clean candidate.' }],
      ['Model Snapshots', roots.modelSnapshotRoot, 'RECOVERABLE', false, { usedBy:'Fallback/model lookup', text:'Bounded fallback snapshots; handled by retention, not blanket delete.' }],
      ['Model Exports', roots.exportRoot, 'EXPORT', true, { usedBy:'Rebuildable exports', text:'Expired rebuildable exports are safe-clean candidates.' }],
      ['Shared Sync', roots.sharedRoot, 'SYNC', false, { usedBy:'Cross-device delta transport', text:'Transport and source generations; not removed by generic safe clean.' }],
      ['Source Generations', roots.sourceGenerationRoot, 'RECOVERABLE', false, { usedBy:'Data source fallback', text:'Current and required fallback generation must remain.' }],
      ['Logs', roots.logsRoot, 'CACHE', true, { usedBy:'Diagnostics', text:'Only bounded/rotated old log files are cleanable.' }],
    ];
    const rows=[];
    for (const [category,target,classification,safe,reason] of definitions) rows.push(item(category,target,classification,safe,reason,await walkStats(target)));

    // Browser profiles are classified one level below the root so auth/session
    // data is visibly separated from rebuildable cache.
    for (const base of [roots.browserProfileRoot, roots.browserProfilesRoot, path.join(roots.appDataRoot || '', 'agent-browser'), path.join(roots.serverDataRoot || '', 'agent-browser')]) {
      if (!base || !(await statSafe(base))) continue;
      let entries=[]; try { entries=await fsp.readdir(base,{withFileTypes:true}); } catch(_) {}
      for (const entry of entries) {
        const target=path.join(base,entry.name); if (!entry.isDirectory()&&!entry.isFile()) continue;
        const classification=BROWSER_CACHE_NAMES.has(entry.name)?'BROWSER_CACHE':BROWSER_SESSION_NAMES.has(entry.name)?'BROWSER_SESSION':'UNKNOWN';
        rows.push(item(`Browser · ${entry.name}`,target,classification,classification==='BROWSER_CACHE',{usedBy:classification==='BROWSER_SESSION'?'Browser authentication/session':'Browser runtime',text:classification==='BROWSER_CACHE'?'Rebuildable browser cache.':classification==='BROWSER_SESSION'?'Authentication/session data; never auto-delete.':'Unclassified browser profile data; never auto-delete.'},await walkStats(target)));
      }
    }
    for (const target of roots.legacyCandidates || []) {
      const st=await walkStats(target); if (!st.files&&!st.directories) continue;
      rows.push(item('Legacy Candidate',target,'LEGACY_CANDIDATE',false,{usedBy:'Unknown until reference/hash verification',text:'Candidate only; UNKNOWN ownership means no automatic deletion.'},st));
    }
    const verifiedDuplicates = await findVerifiedDuplicateFiles(roots, { maxFiles: 10000 });
    const totalSize=rows.reduce((sum,row)=>sum+row.size,0), totalFiles=rows.reduce((sum,row)=>sum+row.fileCount,0);
    const dbStats=typeof localDb.stats==='function'?await localDb.stats():null;
    return { generatedAt:new Date().toISOString(), totalSize, totalFiles, rows, localDb:dbStats, classifications:CLASSIFICATIONS, verifiedDuplicates, verifiedDuplicateBytes:verifiedDuplicates.reduce((sum,item)=>sum+Number(item.size||0),0) };
  }

  async function verify() {
    const state=await localDb.read();
    const dbStats=typeof localDb.stats==='function'?await localDb.stats():{};
    const criticalFiles=[];
    for (const file of [roots.localDbPath, roots.backupPath]) {
      const st=await statSafe(file); if (!st) { criticalFiles.push({path:file,exists:false}); continue; }
      let parseOk=false; try { JSON.parse(await fsp.readFile(file,'utf8')); parseOk=true; } catch(_) {}
      criticalFiles.push({path:file,exists:true,size:st.size,parseOk,sha256:parseOk?await fileSha256(file):null});
    }
    return { ok:Boolean(state&&state.records)&&criticalFiles.some(item=>item.path===roots.localDbPath&&item.parseOk), checkedAt:new Date().toISOString(), schemaVersion:state.schemaVersion, records:Object.keys(state.records||{}).length, journal:(state.journal||[]).length, unsynced:(state.journal||[]).filter(x=>!x.uploaded).length, businessHash:dbStats.businessHash||null, criticalFiles };
  }

  async function buildSafeCleanPlan({ nowMs=Date.now(), exportRetentionDays=30, tempOlderThanMs=3600000, logRetentionDays=30, scope='all' }={}) {
    const candidates=[];
    async function addFiles(root,predicate,classification,category) {
      const scanned=await walkStats(root,{collectFiles:true});
      for(const file of scanned.fileList){ if(!predicate(file))continue; candidates.push({path:file.path,size:file.size,classification,category}); }
    }
    await addFiles(roots.cacheRoot,()=>true,'CACHE','Page Cache');
    const browserBases=[roots.browserProfileRoot,roots.browserProfilesRoot,path.join(roots.appDataRoot||'','agent-browser'),path.join(roots.serverDataRoot||'','agent-browser')];
    for(const base of browserBases){
      let entries=[];try{entries=await fsp.readdir(base,{withFileTypes:true});}catch(_){}
      for(const entry of entries){if(!entry.isDirectory()||!BROWSER_CACHE_NAMES.has(entry.name))continue;await addFiles(path.join(base,entry.name),()=>true,'BROWSER_CACHE',`Browser ${entry.name}`);}
    }
    await addFiles(roots.exportRoot,file=>nowMs-file.mtimeMs>exportRetentionDays*86400000,'EXPORT','Expired Exports');
    await addFiles(roots.logsRoot,file=>nowMs-file.mtimeMs>logRetentionDays*86400000,'CACHE','Old Logs');
    for(const base of [roots.localDataRoot,roots.serverDataRoot,roots.appDataRoot]) await addFiles(base,file=>TEMP_NAMES.test(path.basename(file.path))&&nowMs-file.mtimeMs>tempOlderThanMs,'CACHE','Stale Temp');
    if(scope==='legacy'){
      const duplicates=await findVerifiedDuplicateFiles(roots,{maxFiles:10000});
      for(const item of duplicates)candidates.push({path:item.legacyPath,size:item.size,classification:'LEGACY_VERIFIED',category:'Verified Legacy Duplicate',activePath:item.activePath,sha256:item.sha256});
    }
    const unique=new Map();for(const candidate of candidates){if(NEVER_DELETE.has(ensureClassification(candidate.classification)))continue;unique.set(fmtPath(candidate.path),candidate);}
    let files=[...unique.values()];
    if(scope==='browser')files=files.filter(item=>String(item.category).startsWith('Browser '));
    else if(scope==='legacy')files=files.filter(item=>item.classification==='LEGACY_VERIFIED');
    return { files, fileCount:files.length, estimatedBytes:files.reduce((s,x)=>s+x.size,0), categories:[...new Set(files.map(x=>x.category))] };
  }

  async function safeClean({ apply=false, scope='all' }={}) {
    const plan=await buildSafeCleanPlan({scope});
    if(!apply)return {applied:false,scope,...plan};
    const sync=syncSettings?await syncSettings.read():null;
    const dbStats=typeof localDb.stats==='function'?await localDb.stats():null;
    if(dbStats&&dbStats.unsynced>0)throw Object.assign(new Error('Local changes are waiting to sync. Cleanup cannot continue.'),{code:'PENDING_SYNC_BLOCKS_CLEANUP',statusCode:409});
    if(sync&&sync.progress)throw Object.assign(new Error('Shared Sync is active. Cleanup cannot continue until the current transfer finishes.'),{code:'SYNC_ACTIVE_BLOCKS_CLEANUP',statusCode:409});
    return withFileLeaseAsync(lock,async()=>{
      const verification=await verify();if(!verification.ok)throw Object.assign(new Error('Current local data could not be verified; cleanup cancelled.'),{code:'DATA_INTEGRITY_ERROR',statusCode:503});
      let removed=0,freed=0,failed=0;
      for(const file of plan.files){try{if(![...CLASSIFICATIONS].includes(file.classification)||NEVER_DELETE.has(file.classification))continue;const st=await statSafe(file.path);if(!st||!st.isFile())continue;await fsp.unlink(file.path);removed++;freed+=st.size;}catch(_){failed++;}}
      return {applied:true,scope,fileCount:plan.fileCount,estimatedBytes:plan.estimatedBytes,removed,freed,failed,categories:plan.categories,businessIntegrity:(await verify()).ok,syncConfigured:Boolean(sync&&sync.sharedSyncRoot)};
    });
  }

  async function compactLocalData(options={}) {
    if(typeof localDb.compact!=='function')throw new Error('Local DB compaction is not supported by this build.');
    const sync=syncSettings?await syncSettings.read():null;
    if(sync&&sync.progress)throw Object.assign(new Error('Shared Sync is active. Local compaction cannot continue until the current transfer finishes.'),{code:'SYNC_ACTIVE_BLOCKS_COMPACTION',statusCode:409});
    const stats=typeof localDb.stats==='function'?await localDb.stats():null;
    if(stats&&stats.unsynced>0&&options.allowUnsynced!==true){
      // Compaction itself preserves unsynced events, so this is informational
      // rather than a data-safety prohibition. Manual maintenance may continue.
    }
    return withFileLeaseAsync(lock,()=>localDb.compact(options));
  }

  async function plmHealth() {
    let fileLinks=0,duplicateStyleIds=0;const seen=new Set();
    const file=path.join(roots.serverDataRoot,'plm-style-links.json');
    try{const value=JSON.parse(await fsp.readFile(file,'utf8'));for(const link of Object.values(value.links||{})){fileLinks++;const id=String(link&&link.styleId||'');if(id&&seen.has(id))duplicateStyleIds++;if(id)seen.add(id);}}catch(_){}
    const state=await localDb.read();const plmJournal=(state.journal||[]).filter(item=>String(item.entityType||'').startsWith('plm-style-link'));
    const meta=(state.records&&state.records['plm-style-link__meta:store'])||{};
    const changed=Number(meta.lastChangedCount)||0,generated=Number(meta.lastGeneratedEventCount)||0;
    return {records:Object.keys(state.records||{}).filter(key=>key.startsWith('plm-style-link:')).length||fileLinks,linkCount:fileLinks,duplicateLinks:duplicateStyleIds,lastSync:meta.updatedAt||null,lastChangedCount:changed,lastGeneratedEventCount:generated,amplificationRatio:changed?generated/changed:0,journalEvents:plmJournal.length,failedQueue:0};
  }

  async function syncHealth() {
    const dbStats=typeof localDb.stats==='function'?await localDb.stats():null;
    const settings=syncSettings?await syncSettings.read():null;
    let bundleCount=0,legacyReadyFiles=0;
    const root=settings&&settings.sharedSyncRoot?path.join(settings.sharedSyncRoot,'BUYER_LOG_SYNC','changes'):null;
    if(root){const scanned=await walkStats(root,{collectFiles:true,maxFiles:100000});for(const file of scanned.fileList){if(file.path.endsWith('.sync.gz'))bundleCount++;else if(file.path.endsWith('.ready'))legacyReadyFiles++;}}
    return {journal:dbStats&&dbStats.journal||0,unsynced:dbStats&&dbStats.unsynced||0,uploaded:dbStats&&dbStats.uploaded||0,acknowledged:dbStats&&dbStats.acknowledged||0,compactedEvents:dbStats&&dbStats.compactedEvents||0,bundleCount,legacyReadyFiles,currentProtocol:settings&&settings.protocolVersion||2,checkpointAckSupport:settings?settings.checkpointAckSupport!==false:true,sharedSyncRoot:settings&&settings.sharedSyncRoot||'',legacyCompatibilityMode:Boolean(settings&&settings.legacyCompatibilityMode),peerCapabilities:{gzipUnsupported:settings&&settings.gzipUnsupportedPeerDevices||[],legacy:settings&&settings.legacyPeerDevices||[]}};
  }

  return { analyze, verify, buildSafeCleanPlan, safeClean, compactLocalData, plmHealth, syncHealth, findVerifiedDuplicateFiles:(options)=>findVerifiedDuplicateFiles(roots,options) };
}

module.exports={CLASSIFICATIONS,NEVER_DELETE,BROWSER_CACHE_NAMES,BROWSER_SESSION_NAMES,createDataMaintenance,walkStats,fileSha256,findVerifiedDuplicateFiles};
