'use strict';

const SECRET_KEY_RE = /(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|cookie|set-cookie)/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;

function redactUrl(value) {
  const text = String(value == null ? '' : value);
  try {
    const url = new URL(text);
    let changed = false;
    for (const [key] of url.searchParams) {
      if (!SECRET_KEY_RE.test(key)) continue;
      url.searchParams.set(key, '[REDACTED]');
      changed = true;
    }
    if (changed) return url.toString();
  } catch (_) {}
  return text.replace(/([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key)=)[^&#\s]*/gi, '$1[REDACTED]');
}

function redactSecrets(value) {
  let text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  })();
  text = redactUrl(text);
  text = text
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+\/-]{12,}/gi, '$1 [REDACTED]')
    .replace(/((?:cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/((?:["']?)(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|cookie|set-cookie)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(JWT_RE, '[REDACTED]');
  return text;
}

module.exports = { redactSecrets, redactUrl, SECRET_KEY_RE };
