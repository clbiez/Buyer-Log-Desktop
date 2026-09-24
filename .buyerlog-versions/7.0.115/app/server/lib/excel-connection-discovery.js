'use strict';

/*
 * Excel workbook connection discovery.
 *
 * Scope is intentionally metadata-only. We never read worksheet/pivot result
 * rows and we never attempt Office/Credential Manager/DPAPI secret recovery.
 * Supported containers are OOXML .xlsx/.xlsm. Workbook Connections are read
 * from xl/connections.xml; Microsoft.Mashup.OleDb.1 is reported as unsupported
 * because the real source is hidden in the Power Query mashup payload.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const MAX_WORKBOOK_BYTES = 128 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xlsm']);
const SECRET_KEY = /^(password|pwd|pass|token|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|client[_ -]?secret|secret|api[_ -]?key)$/i;
const SECRETISH_TEXT = /(password\s*=|pwd\s*=|access[_ -]?token\s*=|refresh[_ -]?token\s*=|client[_ -]?secret\s*=|api[_ -]?key\s*=)/i;

function clean(value, max = 1000) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
function xmlDecode(value) {
  return String(value == null ? '' : value)
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function attrs(fragment) {
  const out = {};
  const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(String(fragment || '')))) out[match[1]] = xmlDecode(match[3] != null ? match[3] : match[4]);
  return out;
}
function packagePart(buffer, partName) {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const suffix = `/${String(partName || '').replace(/^\/+/, '')}`.toLowerCase();
  const index = cfb.FullPaths.findIndex(value => String(value || '').replace(/\\/g, '/').toLowerCase().endsWith(suffix));
  if (index < 0 || !cfb.FileIndex[index] || !cfb.FileIndex[index].content) return null;
  return Buffer.from(cfb.FileIndex[index].content);
}

/* Semicolon parser that respects braces and quoted values. It is deliberately
   small and deterministic: connection metadata is not executed here. */
function parseConnectionString(raw) {
  let text = clean(raw, 20000);
  if (/^odbc\s*;/i.test(text)) text = text.replace(/^odbc\s*;/i, '');
  const pairs = [];
  let token = '', quote = '', braceDepth = 0;
  const push = () => { if (token.trim()) pairs.push(token.trim()); token = ''; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      token += ch;
      if (ch === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; token += ch; continue; }
    if (ch === '{') { braceDepth += 1; token += ch; continue; }
    if (ch === '}' && braceDepth) { braceDepth -= 1; token += ch; continue; }
    if (ch === ';' && braceDepth === 0) { push(); continue; }
    token += ch;
  }
  push();
  const map = {};
  let hasSecret = false;
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = clean(pair.slice(0, eq), 120);
    let value = clean(pair.slice(eq + 1), 4000);
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!key) continue;
    if (SECRET_KEY.test(key)) { hasSecret = Boolean(value) || hasSecret; continue; }
    map[key.toLowerCase()] = value;
  }
  return { map, hasSecret };
}
function pick(map, ...keys) {
  for (const key of keys) {
    const value = map[String(key).toLowerCase()];
    if (value != null && String(value).trim()) return clean(value, 1000);
  }
  return '';
}
function boolText(value) { return /^(1|true|yes|sspi)$/i.test(clean(value, 40)); }
function splitServerPort(value) {
  const raw = clean(value, 512);
  if (!raw) return { server: '', port: null };
  // Do not split SQL named instances (SERVER\\INSTANCE) or IPv6.
  const match = !raw.includes('\\') && !raw.startsWith('[') ? raw.match(/^(.*?),(\d{1,5})$/) || raw.match(/^(.*?):(\d{1,5})$/) : null;
  if (!match) return { server: raw, port: null };
  const port = Number(match[2]);
  return { server: clean(match[1], 512), port: port > 0 && port <= 65535 ? port : null };
}
function classifyConnection(map, rawText = '') {
  const provider = pick(map, 'provider');
  const driver = pick(map, 'driver');
  const dsn = pick(map, 'dsn');
  const providerLower = provider.toLowerCase();
  const driverLower = driver.toLowerCase();
  const rawLower = clean(rawText, 20000).toLowerCase();

  if (providerLower.includes('microsoft.mashup.oledb.1') || rawLower.includes('$workbook$')) {
    return { kind: 'unsupported', family: 'power-query', reason: 'POWER_QUERY_MASHUP' };
  }
  if (/msolap/.test(providerLower) || /analysis services/.test(driverLower)) {
    return { kind: 'analysis-services', family: 'analysis-services', reason: '' };
  }
  if (dsn || driver) {
    const family = /oracle|ora/.test(driverLower) ? 'oracle' : (/sql server|sqlsrv|mssql/.test(driverLower) ? 'sqlserver' : 'generic');
    return { kind: 'odbc', family, reason: '' };
  }
  if (provider) {
    const family = /oraoledb|oracle/.test(providerLower) ? 'oracle' : (/sqloledb|sqlncli|msoledbsql/.test(providerLower) ? 'sqlserver' : 'generic');
    return family === 'sqlserver'
      ? { kind: 'sqlserver', family, reason: '' }
      : { kind: 'oledb', family, reason: '' };
  }
  if (pick(map, 'initial catalog', 'database') && pick(map, 'data source', 'server', 'address', 'addr', 'network address')) {
    return { kind: 'sqlserver', family: 'sqlserver', reason: '' };
  }
  return { kind: 'unsupported', family: 'unknown', reason: 'UNSUPPORTED_CONNECTION' };
}
function authInfo(map, hasSecret) {
  const integrated = pick(map, 'integrated security', 'trusted_connection', 'trusted connection');
  const username = pick(map, 'user id', 'uid', 'username', 'user');
  if (boolText(integrated)) return { type: 'windows', username: '', passwordRequired: false, officeManaged: false };
  if (username) return { type: 'username-password', username, passwordRequired: true, officeManaged: Boolean(hasSecret) };
  if (hasSecret) return { type: 'office-managed', username: '', passwordRequired: true, officeManaged: true };
  return { type: 'unknown', username: '', passwordRequired: false, officeManaged: true };
}
function normalizeQuery(command, commandType) {
  const query = clean(command, 20000);
  if (!query || SECRETISH_TEXT.test(query)) return { text: '', found: Boolean(query), safe: false, commandType: clean(commandType, 40) };
  // Store only read-only command text in v1. Stored procedures / table names / cube
  // commands are metadata but are not automatically executed as SQL.
  const safe = /^(select\b|with\b|evaluate\b)/i.test(query);
  return { text: safe ? query : '', found: true, safe, commandType: clean(commandType, 40) };
}
function connectionFromXml(connectionAttrs, dbAttrs, workbookName, index) {
  const parsed = parseConnectionString(dbAttrs.connection || '');
  const map = parsed.map;
  const cls = classifyConnection(map, dbAttrs.connection || '');
  const source = splitServerPort(pick(map, 'data source', 'server', 'address', 'addr', 'network address'));
  const database = pick(map, 'initial catalog', 'database');
  const dsn = pick(map, 'dsn');
  const provider = pick(map, 'provider');
  const driver = pick(map, 'driver');
  const serviceName = pick(map, 'service name', 'service_name', 'dbq');
  const sid = pick(map, 'sid');
  const auth = authInfo(map, parsed.hasSecret);
  const query = normalizeQuery(dbAttrs.command || '', dbAttrs.commandType || '');
  const name = clean(connectionAttrs.name || `Connection ${index + 1}`, 180);
  const supported = cls.kind !== 'unsupported';
  const safeOptions = {};
  for (const [src, dest] of [
    ['encrypt', 'encrypt'], ['trustservercertificate', 'trustServerCertificate'],
    ['application name', 'applicationName'], ['network library', 'networkLibrary'],
  ]) {
    const value = pick(map, src);
    if (value) safeOptions[dest] = clean(value, 200);
  }
  const connector = {
    kind: cls.kind,
    family: cls.family,
    provider: clean(provider, 240),
    driver: clean(driver, 240),
    server: source.server,
    port: source.port,
    database: clean(database, 240),
    dsn: clean(dsn, 240),
    serviceName: clean(serviceName, 240),
    sid: clean(sid, 240),
    auth,
    options: safeOptions,
  };
  const identityMaterial = JSON.stringify({ name, kind: connector.kind, family: connector.family, provider: connector.provider, driver: connector.driver, server: connector.server, port: connector.port, database: connector.database, dsn: connector.dsn, serviceName: connector.serviceName, sid: connector.sid });
  return {
    id: `xc_${crypto.createHash('sha256').update(identityMaterial).digest('hex').slice(0, 16)}`,
    name,
    supported,
    unsupportedReason: supported ? '' : cls.reason,
    connector,
    query,
    hasEmbeddedSecret: parsed.hasSecret,
    source: { workbookName: clean(workbookName, 240), connectionId: clean(connectionAttrs.id, 80), connectionType: clean(connectionAttrs.type, 40) },
  };
}
function dedupeConnections(items) {
  const out = [], seen = new Set();
  for (const item of items) {
    const c = item.connector || {};
    const key = JSON.stringify([c.kind, c.family, c.server.toLowerCase(), c.port || 0, c.database.toLowerCase(), c.dsn.toLowerCase(), c.provider.toLowerCase(), c.driver.toLowerCase(), item.query && item.query.text || '']);
    if (seen.has(key)) continue;
    seen.add(key); out.push(item);
  }
  return out;
}
function discoverBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw Object.assign(new Error('Workbook buffer is required.'), { code: 'WORKBOOK_REQUIRED' });
  if (buffer.length > MAX_WORKBOOK_BYTES) throw Object.assign(new Error('Excel çalışma kitabı çok büyük.'), { code: 'WORKBOOK_TOO_LARGE' });
  const workbookName = path.basename(clean(options.workbookName || 'workbook.xlsx', 260));
  const part = packagePart(buffer, 'xl/connections.xml');
  if (!part) return { workbookName, connections: [], warnings: ['Workbook Connections metadata bulunamadı.'] };
  const xml = part.toString('utf8');
  const connections = [];
  const re = /<(?:\w+:)?connection\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?connection\s*>|<(?:\w+:)?connection\b([^>]*)\/>/gi;
  let match, index = 0;
  while ((match = re.exec(xml))) {
    const connectionAttrs = attrs(match[1] || match[3] || '');
    const inner = match[2] || '';
    const dbMatch = inner.match(/<(?:\w+:)?dbPr\b([^>]*)\/?\s*>/i);
    if (!dbMatch) {
      // A Power Query/mashup connection may have no directly usable dbPr.
      const name = clean(connectionAttrs.name || `Connection ${index + 1}`, 180);
      connections.push({
        id: `xc_${crypto.createHash('sha256').update(`${name}|${index}`).digest('hex').slice(0, 16)}`,
        name, supported: false, unsupportedReason: 'NO_DATABASE_METADATA',
        connector: { kind: 'unsupported', family: 'unknown', provider: '', driver: '', server: '', port: null, database: '', dsn: '', serviceName: '', sid: '', auth: { type: 'unknown', username: '', passwordRequired: false, officeManaged: true }, options: {} },
        query: { text: '', found: false, safe: false, commandType: '' }, hasEmbeddedSecret: false,
        source: { workbookName, connectionId: clean(connectionAttrs.id, 80), connectionType: clean(connectionAttrs.type, 40) },
      });
    } else {
      connections.push(connectionFromXml(connectionAttrs, attrs(dbMatch[1] || ''), workbookName, index));
    }
    index += 1;
    if (connections.length >= 100) break;
  }
  return { workbookName, connections: dedupeConnections(connections), warnings: [] };
}
function discoverFile(filePath) {
  const full = path.resolve(String(filePath || ''));
  const ext = path.extname(full).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) throw Object.assign(new Error('Yalnız .xlsx ve .xlsm bağlantı keşfi destekleniyor.'), { code: 'WORKBOOK_FORMAT_UNSUPPORTED' });
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw Object.assign(new Error('Seçilen Excel yolu bir dosya değil.'), { code: 'WORKBOOK_NOT_FILE' });
  if (stat.size > MAX_WORKBOOK_BYTES) throw Object.assign(new Error('Excel çalışma kitabı çok büyük.'), { code: 'WORKBOOK_TOO_LARGE' });
  return discoverBuffer(fs.readFileSync(full), { workbookName: path.basename(full) });
}
function publicCandidate(item) {
  const c = item.connector || {}, a = c.auth || {}, q = item.query || {};
  return {
    id: item.id, name: item.name, supported: Boolean(item.supported), unsupportedReason: item.unsupportedReason || '',
    kind: c.kind, family: c.family, provider: c.provider, driver: c.driver, server: c.server, port: c.port,
    database: c.database, dsn: c.dsn, serviceName: c.serviceName, sid: c.sid,
    authentication: { type: a.type, username: a.username, passwordRequired: Boolean(a.passwordRequired), officeManaged: Boolean(a.officeManaged) },
    query: { found: Boolean(q.found), safe: Boolean(q.safe), preview: q.text ? q.text.slice(0, 800) : '', commandType: q.commandType || '' },
    hasEmbeddedSecret: Boolean(item.hasEmbeddedSecret),
  };
}

module.exports = {
  MAX_WORKBOOK_BYTES, SUPPORTED_EXTENSIONS,
  xmlDecode, attrs, parseConnectionString, classifyConnection, authInfo, normalizeQuery,
  discoverBuffer, discoverFile, publicCandidate,
};
