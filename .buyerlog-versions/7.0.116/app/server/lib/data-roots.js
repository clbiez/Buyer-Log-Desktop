'use strict';

const path = require('path');
const os = require('os');

function uniq(values) {
  const seen = new Set(), out = [];
  for (const value of values || []) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    if (seen.has(resolved)) continue;
    seen.add(resolved); out.push(resolved);
  }
  return out;
}

/*
 * Single source of truth for maintenance/storage tooling. Runtime modules may
 * continue to own their existing paths; maintenance code MUST NOT guess
 * "data/" or "application-data/" independently.
 */
function resolveBuyerLogDataRoots(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..', '..'));
  const serverDataRoot = path.resolve(options.serverDataRoot || process.env.BUYER_LOG_SERVER_DATA_ROOT || path.join(projectRoot, 'server', 'data'));
  const appDataRoot = path.resolve(options.appDataRoot || process.env.BUYER_LOG_DATA_ROOT || (process.env.APPDATA ? path.join(process.env.APPDATA, 'Buyer Log') : path.join(os.homedir(), '.buyer-log')));
  const localDataRoot = path.resolve(options.localDataRoot || process.env.BUYER_LOG_LOCAL_DATA_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'BuyerLog') : appDataRoot));
  const localDbPath = path.resolve(options.localDbPath || process.env.BUYER_LOG_LOCAL_DB || path.join(localDataRoot, 'BuyerLogLocal.db'));
  const sharedRoot = options.sharedDataRoot ? path.resolve(options.sharedDataRoot) : path.join(localDataRoot, 'shared-data');

  const activeRoots = uniq([serverDataRoot, appDataRoot, localDataRoot]);
  const legacyCandidates = uniq([
    path.join(projectRoot, 'data'),
    path.join(projectRoot, 'application-data'),
    path.join(localDataRoot, 'local-first - Kopya'),
    path.join(localDataRoot, 'local-first-copy'),
  ]).filter(candidate => !activeRoots.includes(candidate));

  return Object.freeze({
    projectRoot,
    activeDataRoot: localDataRoot,
    serverDataRoot,
    appDataRoot,
    localDataRoot,
    localStatePath: localDbPath,
    localWalPath: `${localDbPath}.wal`,
    localWalBackupPath: `${localDbPath}.wal.bak`,
    localDbPath,
    backupPath: `${localDbPath}.bak`,
    cacheRoot: path.join(localDataRoot, 'page-cache'),
    browserProfileRoot: path.join(localDataRoot, 'agent-browser'),
    // Authenticated Chromium profiles are device-local sensitive state and
    // must remain separate from the legacy connector/cache root.
    browserProfilesRoot: path.join(localDataRoot, 'browser-profiles'),
    exportRoot: path.join(localDataRoot, 'model-exports'),
    modelSnapshotRoot: path.join(localDataRoot, 'model-snapshots'),
    modelFilesRoot: path.join(localDataRoot, 'model-files'),
    collectionImagesRoot: path.join(localDataRoot, 'collection-images'),
    logsRoot: path.join(localDataRoot, 'logs'),
    sharedRoot,
    sourceGenerationRoot: path.join(sharedRoot, 'source-generations'),
    legacyCandidates,
  });
}

module.exports = { resolveBuyerLogDataRoots };
