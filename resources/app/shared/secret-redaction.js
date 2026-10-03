'use strict';

// Log/teşhis metninden kimlik bilgisi temizleme. Anahtar adları: OAuth/Bearer
// token'ları, API anahtarları, çerezler, parolalar (password/passwd/pwd),
// oturum/imza sırları ve özel anahtarlar.
const SECRET_KEY_RE = /(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|x-api-key|cookie|set-cookie|password|passwd|pwd|session[_-]?secret|private[_-]?key|secret)/i;
const SECRET_KEY_SOURCE = '(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|x-api-key|cookie|set-cookie|password|passwd|pwd|pass(?:word)?[_-]?hash|pin[_-]?hash|session[_-]?secret|private[_-]?key|secret)';
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const QUERY_SECRET_RE = new RegExp(`([?&]${SECRET_KEY_SOURCE}=)[^&#\\s]*`, 'gi');
// "Server=x;User ID=y;Password=z;" — ADO/ODBC/OLE DB bağlantı dizeleri.
const CONNECTION_STRING_RE = /(\b(?:password|pwd)\s*=\s*)(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^;"'\r\n]*)/gi;
const KEY_VALUE_RE = new RegExp(`((?:["']?)${SECRET_KEY_SOURCE}(?:["']?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;}&]+)`, 'gi');
// scheme://user:password@host — URL içi kimlik bilgisi.
const URL_USERINFO_RE = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi;

function redactUrl(value) {
  const text = String(value == null ? '' : value);
  try {
    const url = new URL(text);
    let changed = false;
    if (url.password) { url.password = 'REDACTED'; changed = true; }
    for (const [key] of url.searchParams) {
      if (!SECRET_KEY_RE.test(key)) continue;
      url.searchParams.set(key, '[REDACTED]');
      changed = true;
    }
    if (changed) return url.toString();
  } catch (_) {}
  return text.replace(QUERY_SECRET_RE, '$1[REDACTED]');
}

function redactSecrets(value) {
  let text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  })();
  if (text == null) text = String(value);
  text = redactUrl(text);
  text = text
    .replace(PEM_RE, '[REDACTED PRIVATE KEY]')
    .replace(URL_USERINFO_RE, '$1[REDACTED]@')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+\/-]{12,}/gi, '$1 [REDACTED]')
    .replace(/((?:cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(CONNECTION_STRING_RE, '$1[REDACTED]')
    // Tırnaklı değerde tırnak korunur ki JSON metni ayrıştırılabilir kalsın.
    .replace(KEY_VALUE_RE, (match, key) => { const quote = /^["']/.test(match.slice(key.length)) ? match[key.length] : ''; return `${key}${quote}[REDACTED]${quote}`; })
    .replace(JWT_RE, '[REDACTED]');
  return text;
}

module.exports = { redactSecrets, redactUrl, SECRET_KEY_RE };
