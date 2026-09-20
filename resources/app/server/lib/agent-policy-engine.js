'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
/* 'ui' okuma ile operasyonel arasındadır: veriyi değiştirmez ama görünür bir
   etki bırakır. Bilinmeyen risk hâlâ en yükseğe düşer — yeni bir katman
   eklenip burada tanımlanmazsa varsayılan olarak ONAY ister, sessizce
   serbest kalmaz. */
/* 'propose' okuma sınıfındadır çünkü HİÇBİR ŞEY YAZMAZ: bir öneri, kullanıcı
   onaylayana kadar atıl bir karttır. Onay kapısı araç seviyesinde değil,
   kullanıcının önizlemeyi görüp Onayla'ya basmasındadır — araç seviyesinde de
   onay istemek aynı kapıyı iki kez kurmak olurdu. */
function riskRank(value) { return ({ read: 0, ui: 0, propose: 0, operational: 1, write: 2, external: 3 })[value] ?? 3; }

function createPolicyEngine({ userAccess, allowedConnectorHosts = [], getAllowedBrowserHosts = null } = {}) {
  const hostSet = new Set((allowedConnectorHosts || []).map(host => clean(host).toLowerCase()).filter(Boolean));
  function areaAllowed(profile, area) {
    if (!area) return true;
    return Boolean(userAccess && typeof userAccess.hasArea === 'function' && userAccess.hasArea(profile, area));
  }
  function parseHttpsUrl(urlText) {
    let url;
    try { url = new URL(String(urlText || '')); } catch (_) { return { allowed: false, reason: 'Geçerli bir HTTPS URL gerekli.' }; }
    if (url.protocol !== 'https:') return { allowed: false, reason: 'Connector yalnız HTTPS adreslerine erişebilir.' };
    return { allowed:true, url, host:url.hostname.toLowerCase() };
  }
  function connectorAllowed(urlText) {
    const parsed = parseHttpsUrl(urlText); if (!parsed.allowed) return parsed;
    const host = parsed.host;
    if (!hostSet.size) return { allowed: false, reason: 'Dış connector host allowlist yapılandırılmamış.' };
    if (!hostSet.has(host)) return { allowed: false, reason: `${host} izin verilen connector host listesinde değil.` };
    return { allowed: true, host };
  }
  function browserAllowed(urlText) {
    const parsed = parseHttpsUrl(urlText); if (!parsed.allowed) return parsed;
    const browserHosts = new Set((typeof getAllowedBrowserHosts === 'function' ? getAllowedBrowserHosts() : []).map(host => clean(host).toLowerCase()).filter(Boolean));
    if (!browserHosts.size) return { allowed:false, reason:'Browser Automation host allowlist yapılandırılmamış.' };
    const host = parsed.host;
    if (![...browserHosts].some(item => host === item || host.endsWith(`.${item}`))) return { allowed:false, reason:`${host} Browser Automation host listesinde değil.` };
    return { allowed:true, host };
  }
  function evaluate(profile, tool, args, context = {}) {
    if (!tool) return { allowed: false, reason: 'Tool kayıtlı değil.', code: 'TOOL_NOT_FOUND' };
    if (!areaAllowed(profile, tool.area)) return { allowed: false, reason: `${tool.area} alanına erişim yetkisi yok.`, code: 'AREA_FORBIDDEN' };
    if (tool.kind === 'connector') {
      const connector = connectorAllowed(args && args.url);
      if (!connector.allowed) return { allowed: false, reason: connector.reason, code: 'CONNECTOR_BLOCKED' };
    }
    if (tool.kind === 'browser') {
      const browser = browserAllowed(args && args.url);
      if (!browser.allowed) return { allowed:false, reason:browser.reason, code:'BROWSER_CONNECTOR_BLOCKED' };
    }
    const risk = clean(tool.risk) || 'read';
    const approvalRequired = tool.approval === true || riskRank(risk) >= riskRank('write');
    if (approvalRequired && !context.dryRun && !context.approvalGranted) {
      return { allowed: false, approvalRequired: true, reason: tool.approvalMessage || 'Bu işlem veri veya dış sistem üzerinde değişiklik yapabilir ve kullanıcı onayı gerektirir.', code: 'APPROVAL_REQUIRED' };
    }
    return { allowed: true, approvalRequired, risk };
  }
  return { evaluate, connectorAllowed, browserAllowed, allowedConnectorHosts: [...hostSet], allowedBrowserHosts: () => (typeof getAllowedBrowserHosts === 'function' ? getAllowedBrowserHosts() : []) };
}

module.exports = { createPolicyEngine };
