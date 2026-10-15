'use strict';
/* Agent cevabındaki e-posta taslakları. LCW AI her taslağı JSON nesnesi
   olarak verir; burada yalnız geçerli adresler, tek satır konu ve sınırlı
   gövde kalır. Taslak hiçbir yere gönderilmez: sahip istediğinde Outlook'ta
   (.eml, X-Unsent) gözden geçirmek için açılır. */

const MAX_DRAFTS = 20, MAX_ADDRESSES = 40, MAX_SUBJECT = 300, MAX_BODY = 12000;
// Başlığa ham UTF-8 gitmesin: adres yalnız yazdırılabilir ASCII (ad kısmı ayrıca RFC 2047 ile kodlanır).
const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

// "Ad Soyad <adres>" ya da "adres"; geçersiz veya yer tutucu ("[adres gerekli]") atılır.
function address(raw) {
  const value = String(raw == null ? '' : raw).replace(/[\r\n\t]+/g, ' ').trim();
  if (!value) return null;
  const match = value.match(/^(.*?)<([^<>]+)>\s*$/);
  const email = (match ? match[2] : value).trim().replace(/^mailto:/i, '');
  if (!EMAIL.test(email)) return null;
  const name = match ? match[1].replace(/["<>\\]/g, '').trim().slice(0, 120) : '';
  return name ? `${name} <${email}>` : email;
}

// Tek metin olarak gelen liste: ; ve satır sonu her zaman, virgül yalnız tırnak ve <> dışında ayırır ("Khan, Salem" <k@x.com>).
function split(text) {
  const out = []; let current = '', quoted = false, angle = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<') angle = true;
    else if (ch === '>') angle = false;
    if (ch === ';' || ch === '\n' || (ch === ',' && !quoted && !angle)) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out;
}

function addresses(raw) {
  const list = Array.isArray(raw) ? raw : split(String(raw == null ? '' : raw));
  const seen = new Set(), out = [];
  let dropped = 0;
  for (const item of list) {
    const value = address(item);
    if (!value) { if (String(item == null ? '' : item).trim()) dropped += 1; continue; }
    const key = value.replace(/^.*<|>$/g, '').toLowerCase();
    if (seen.has(key) || out.length >= MAX_ADDRESSES) continue;
    seen.add(key); out.push(value);
  }
  return { list: out, dropped };
}

function parseDrafts(items) {
  const drafts = [];
  for (const item of Array.isArray(items) ? items : []) {
    let value = item;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { continue; } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const to = addresses(value.to), cc = addresses(value.cc);
    const subject = String(value.subject == null ? '' : value.subject).replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_SUBJECT);
    const body = String(value.body == null ? '' : value.body).replace(/\r\n?/g, '\n').trim().slice(0, MAX_BODY);
    if (!subject && !body) continue;
    drafts.push({ to: to.list, cc: cc.list, subject, body, missingRecipient: !to.list.length, droppedAddresses: to.dropped + cc.dropped });
    if (drafts.length >= MAX_DRAFTS) break;
  }
  return drafts;
}

module.exports = { parseDrafts, address, addresses };
