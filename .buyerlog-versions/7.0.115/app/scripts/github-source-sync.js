'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { bumpSemver, parseSemver } = require('../electron/update/semver');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const EXPECTED_REMOTE = 'https://github.com/clbiez/Buyer-Log-Desktop.git';
const MAX_GITHUB_BLOB_BYTES = 100 * 1024 * 1024;

function fail(message, code = 'GITHUB_SYNC_FAILED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function git(args, options = {}) {
  const output = childProcess.execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  return typeof output === 'string' ? output.trim() : '';
}

function parseArgs(argv) {
  const out = { bump: '', message: '', skipTests: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bump') out.bump = String(argv[++i] || '');
    else if (arg === '--message') out.message = String(argv[++i] || '');
    else if (arg === '--skip-tests') out.skipTests = true;
    else fail(`Bilinmeyen argüman: ${arg}`, 'GITHUB_SYNC_ARG_INVALID');
  }
  if (out.bump && !['patch', 'minor', 'major'].includes(out.bump)) {
    fail('--bump patch, minor veya major olmalı.', 'GITHUB_SYNC_BUMP_INVALID');
  }
  return out;
}

function normalizeRepoPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isForbiddenPath(value) {
  const file = normalizeRepoPath(value);
  const lower = file.toLowerCase();
  if (lower === 'config.json' || lower.startsWith('data/') || lower.startsWith('resources/app/server/data/')) return true;
  if (lower.includes('/node_modules/') || lower.startsWith('resources/app/node_modules/')) return true;
  if (/(^|\/)(?:\.env(?:\..*)?|\.release-pending\.json)$/.test(lower)) return true;
  if (/(^|\/)(?:dist-updates|coverage|logs?|cache|temp|tmp|backups?)(\/|$)/.test(lower)) return true;
  if (/\.(?:db|sqlite3?|log|tmp|bak|blgbackup)$/i.test(file)) return true;
  return false;
}

function packageFiles() {
  return {
    packageFile: path.join(APP_ROOT, 'package.json'),
    lockFile: path.join(APP_ROOT, 'package-lock.json'),
    installedLockFile: path.join(APP_ROOT, 'node_modules', '.package-lock.json'),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function currentVersion() {
  const version = String(readJson(packageFiles().packageFile).version || '');
  if (!parseSemver(version)) fail('package.json sürümü geçerli SemVer değil.', 'GITHUB_SYNC_VERSION_INVALID');
  return version;
}

function bumpVersion(kind) {
  const files = packageFiles();
  const version = bumpSemver(currentVersion(), kind);
  const pkg = readJson(files.packageFile);
  pkg.version = version;
  writeJson(files.packageFile, pkg);
  if (fs.existsSync(files.lockFile)) {
    const lock = readJson(files.lockFile);
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    writeJson(files.lockFile, lock);
  }
  if (fs.existsSync(files.installedLockFile)) {
    const installed = readJson(files.installedLockFile);
    installed.version = version;
    if (installed.packages && installed.packages['']) installed.packages[''].version = version;
    writeJson(files.installedLockFile, installed);
  }
  return version;
}

function versionBranch(version) {
  if (!parseSemver(version)) fail('Branch için geçersiz SemVer.', 'GITHUB_SYNC_VERSION_INVALID');
  return `updates/v${version}`;
}

function remoteBranchSha(branch) {
  const output = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  return output ? output.split(/\s+/)[0] : '';
}

function assertRepository() {
  const actualRoot = path.resolve(git(['rev-parse', '--show-toplevel']));
  if (actualRoot.toLowerCase() !== path.resolve(REPO_ROOT).toLowerCase()) {
    fail('Komut Buyer Log repository kökünde çalışmıyor.', 'GITHUB_SYNC_REPO_INVALID');
  }
  if (git(['branch', '--show-current']) !== 'main') {
    fail('GitHub sync yalnız main branch üzerinde çalışır.', 'GITHUB_SYNC_BRANCH_INVALID');
  }
  const remote = git(['remote', 'get-url', 'origin']).replace(/\/+$/, '');
  if (remote.toLowerCase() !== EXPECTED_REMOTE.toLowerCase()) {
    fail(`Beklenmeyen origin: ${remote}`, 'GITHUB_SYNC_REMOTE_INVALID');
  }
  git(['fetch', '--quiet', 'origin', 'main']);
  const remoteMain = git(['rev-parse', 'origin/main']);
  try { git(['merge-base', '--is-ancestor', remoteMain, 'HEAD']); }
  catch (_) { fail('Yerel main, origin/main ile fast-forward uyumlu değil. Önce çatışmayı çözün.', 'GITHUB_SYNC_DIVERGED'); }
}

function stagedPaths() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function assertSafeStage() {
  const forbidden = stagedPaths().filter(isForbiddenPath);
  if (forbidden.length) fail(`GitHub'a gönderilmesi yasak dosyalar stage alanında: ${forbidden.join(', ')}`, 'GITHUB_SYNC_DATA_LEAK');
  const tooLarge = stagedPaths().filter(file => {
    const full = path.join(REPO_ROOT, file);
    return fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size >= MAX_GITHUB_BLOB_BYTES;
  });
  if (tooLarge.length) fail(`GitHub 100 MB sınırını aşan dosyalar: ${tooLarge.join(', ')}`, 'GITHUB_SYNC_BLOB_TOO_LARGE');
  git(['diff', '--cached', '--check']);
}

function runTests() {
  childProcess.execFileSync(process.execPath, [path.join(APP_ROOT, 'tests', 'run-tests.js')], { cwd: APP_ROOT, stdio: 'inherit' });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertRepository();
  const version = options.bump ? bumpVersion(options.bump) : currentVersion();
  const branch = versionBranch(version);
  const existing = remoteBranchSha(branch);
  const before = git(['rev-parse', 'HEAD']);
  if (existing && existing !== before) {
    fail(`${branch} zaten farklı bir güncellemeyi kaydediyor. Yeni sürüm için --bump patch kullanın.`, 'GITHUB_SYNC_VERSION_BRANCH_EXISTS');
  }

  git(['add', '--all']);
  assertSafeStage();
  if (!options.skipTests) runTests();
  const hasChanges = (() => { try { git(['diff', '--cached', '--quiet']); return false; } catch (_) { return true; } })();
  if (hasChanges) {
    const message = options.message || `Update Buyer Log v${version}`;
    git(['commit', '-m', message], { inherit: true });
  }
  const commit = git(['rev-parse', 'HEAD']);
  const remoteVersion = remoteBranchSha(branch);
  if (remoteVersion && remoteVersion !== commit) {
    fail(`${branch} immutable ve ${remoteVersion} commit'ine bağlı.`, 'GITHUB_SYNC_VERSION_BRANCH_EXISTS');
  }
  const refspecs = [`${commit}:refs/heads/main`];
  if (!remoteVersion) refspecs.push(`${commit}:refs/heads/${branch}`);
  git(['push', '--atomic', 'origin', ...refspecs], { inherit: true });
  console.log(JSON.stringify({ ok:true, version, branch, commit, repository:EXPECTED_REMOTE }, null, 2));
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`[${error.code || 'GITHUB_SYNC_FAILED'}] ${error.message}`); process.exitCode = 1; }
}

module.exports = { parseArgs, normalizeRepoPath, isForbiddenPath, versionBranch };
