'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('./platform');

const SCRIPT_PATH = path.join(__dirname, 'DatabaseQuery.ps1');
const ALLOWED_KINDS = new Set(['sqlserver', 'odbc', 'oledb']);
const MAX_QUERY_LENGTH = 200000;

class DatabaseConnectorError extends Error {
  constructor(message, code = 'DATABASE_CONNECTION_FAILED', statusCode = 502, extra = {}) {
    super(message); this.name = 'DatabaseConnectorError'; this.code = code; this.statusCode = statusCode; Object.assign(this, extra);
  }
}
function clean(value, max = 1000) { return String(value == null ? '' : value).trim().slice(0, max); }
function normalizeConnector(raw = {}) {
  const auth = raw.auth && typeof raw.auth === 'object' ? raw.auth : {};
  return {
    kind: ALLOWED_KINDS.has(clean(raw.kind, 40).toLowerCase()) ? clean(raw.kind, 40).toLowerCase() : clean(raw.kind, 40).toLowerCase(),
    family: clean(raw.family, 80), provider: clean(raw.provider, 240), driver: clean(raw.driver, 240),
    server: clean(raw.server, 512), port: Number(raw.port) > 0 && Number(raw.port) <= 65535 ? Number(raw.port) : null,
    database: clean(raw.database, 240), dsn: clean(raw.dsn, 240), serviceName: clean(raw.serviceName, 240), sid: clean(raw.sid, 240),
    auth: { type: ['windows', 'username-password', 'office-managed', 'unknown'].includes(clean(auth.type, 40)) ? clean(auth.type, 40) : 'unknown', username: clean(auth.username, 300), passwordRequired: Boolean(auth.passwordRequired), officeManaged: Boolean(auth.officeManaged) },
    options: raw.options && typeof raw.options === 'object' ? {
      encrypt: raw.options.encrypt == null ? '' : clean(raw.options.encrypt, 20),
      trustServerCertificate: raw.options.trustServerCertificate == null ? '' : clean(raw.options.trustServerCertificate, 20),
      applicationName: clean(raw.options.applicationName, 120),
    } : {},
  };
}
function validateConnector(raw) {
  const c = normalizeConnector(raw);
  if (!ALLOWED_KINDS.has(c.kind)) throw new DatabaseConnectorError('Bu database provider Buyer Log tarafından desteklenmiyor.', 'UNSUPPORTED_PROVIDER', 400);
  if (c.kind === 'sqlserver' && !c.server) throw new DatabaseConnectorError('SQL Server bağlantısında sunucu bilgisi yok.', 'SERVER_REQUIRED', 400);
  if (c.kind === 'odbc' && !c.dsn && !c.driver) throw new DatabaseConnectorError('ODBC bağlantısında DSN veya driver bilgisi yok.', 'DRIVER_NOT_FOUND', 400);
  if (c.kind === 'oledb' && !c.provider) throw new DatabaseConnectorError('OLE DB provider bilgisi yok.', 'DRIVER_NOT_FOUND', 400);
  return c;
}
function validateReadOnlyQuery(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new DatabaseConnectorError('Sorgu boş.', 'QUERY_REQUIRED', 400);
  if (text.length > MAX_QUERY_LENGTH) throw new DatabaseConnectorError('SQL sorgusu çok uzun.', 'QUERY_TOO_LONG', 400);
  if (!/^(select\b|with\b)/i.test(text)) throw new DatabaseConnectorError('Yalnız SELECT/WITH ile başlayan salt-okunur SQL sorguları çalıştırılabilir.', 'QUERY_NOT_ALLOWED', 400);
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec(?:ute)?|call)\b/i.test(text)) throw new DatabaseConnectorError('Bu alan yalnız salt-okunur SQL sorguları içindir.', 'QUERY_NOT_ALLOWED', 400);
  return text;
}
function parseSummary(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) { if (lines[i].startsWith('{')) { try { return JSON.parse(lines[i]); } catch (_) {} } }
  return null;
}
function defaultRunner(args, timeoutMs, env = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, ...args], {
      timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, BUYERLOG_DB_USERNAME: String(env.username || ''), BUYERLOG_DB_PASSWORD: String(env.password || '') },
    }, (error, stdout, stderr) => {
      if (error && !stdout) return reject(Object.assign(error, { safeStderr: '' }));
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
function publicError(summary) {
  const code = String(summary && summary.code || 'DATABASE_CONNECTION_FAILED');
  const messages = {
    AUTH_REQUIRED: 'Bu bağlantı için kullanıcı adı ve parola gerekiyor.', AUTH_FAILED: 'Database kimlik doğrulaması başarısız oldu.',
    DRIVER_NOT_FOUND: 'Bu bağlantının kullandığı database driver/provider bu bilgisayarda bulunamadı.', SERVER_UNREACHABLE: 'Database sunucusuna erişilemedi.',
    DATABASE_NOT_FOUND: 'Database veya service bulunamadı.', UNSUPPORTED_PROVIDER: 'Bu database provider Buyer Log tarafından desteklenmiyor.',
    QUERY_NOT_ALLOWED: 'Yalnız salt-okunur SQL sorguları çalıştırılabilir.', QUERY_REQUIRED: 'Sorgu bulunamadı.', CONNECTION_FAILED: 'Database bağlantısı kurulamadı.',
  };
  return new DatabaseConnectorError(messages[code] || 'Database işlemi tamamlanamadı.', code, code === 'AUTH_REQUIRED' ? 401 : 502);
}
async function execute(connector, options = {}) {
  const normalized = validateConnector(connector);
  if (!options.runner && !platform.IS_WINDOWS) throw new DatabaseConnectorError('Doğrudan database bağlantısı yalnız Windows üzerinde sınanabilir.', 'DATABASE_CONNECTOR_UNSUPPORTED', 501);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bldb-'));
  const configPath = path.join(tempDir, 'config.json');
  const config = { ...normalized, authType: normalized.auth.type, username: normalized.auth.username };
  fs.writeFileSync(configPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
  let queryPath = '';
  const args = ['-ConfigPath', configPath, '-TimeoutSeconds', String(Math.max(5, Math.min(300, Number(options.timeoutSeconds) || 30))), '-MaxRows', String(Math.max(1, Math.min(5000, Number(options.maxRows) || 50)))];
  if (options.testOnly) args.push('-TestOnly');
  else {
    const query = validateReadOnlyQuery(options.query);
    queryPath = path.join(tempDir, 'query.sql'); fs.writeFileSync(queryPath, query, { encoding: 'utf8', mode: 0o600 }); args.push('-QueryPath', queryPath);
  }
  let raw;
  try {
    raw = await (options.runner || defaultRunner)(args, (Number(options.timeoutSeconds) || 30) * 1000 + 10000, options.credentials || {});
  } catch (_) {
    throw new DatabaseConnectorError('Database bağlantı işlemi başlatılamadı.', 'DATABASE_CONNECTOR_FAILED', 502);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
  const summary = parseSummary(raw && raw.stdout);
  if (!summary || !summary.ok) throw publicError(summary);
  return { ok: true, provider: clean(summary.provider, 240), elapsedMs: Number(summary.elapsedMs) || 0, rowCount: Number(summary.rowCount) || 0, rows: Array.isArray(summary.rows) ? summary.rows : [], truncated: Boolean(summary.truncated) };
}
function testConnection(connector, options = {}) { return execute(connector, { ...options, testOnly: true }); }
function runRows(connector, query, options = {}) { return execute(connector, { ...options, query, testOnly: false }); }

module.exports = { DatabaseConnectorError, ALLOWED_KINDS, MAX_QUERY_LENGTH, normalizeConnector, validateConnector, validateReadOnlyQuery, parseSummary, testConnection, runRows };
