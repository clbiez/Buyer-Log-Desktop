'use strict';

const crypto = require('crypto');

const CLASSIFICATIONS = Object.freeze([
  'ORDER_CONFIRMATION','ORDER_REVISION','DELIVERY_DATE_CHANGE','PRICE_CHANGE','QUANTITY_CHANGE',
  'CANCELLATION','APPROVAL','REJECTION','SAMPLE','PRODUCTION','SHIPMENT','QUALITY','PAYMENT','DOCUMENT','GENERAL','UNKNOWN',
]);
const DICTIONARY = Object.freeze({
  DELIVERY_DATE_CHANGE: ['termin','delivery date','revised delivery','delivery revised','new ex-factory','new ex factory','ex-fac','shipment date','new date','etd','eta','week'],
  PRICE_CHANGE: ['price','cost','new price','revised price','unit price','fob','cmt','increase','decrease','fiyat','maliyet','zam','indirim'],
  CANCELLATION: ['cancel','cancelled','cancellation','iptal','cancel order'],
  APPROVAL: ['approve','approved','approval','confirm','confirmed','onay','onaylandı','uygundur'],
  REJECTION: ['reject','rejected','decline','not approved','red','reddedildi','uygun değil'],
  ORDER_REVISION: ['revision','revised','revize','değişiklik','update','updated'],
  ORDER_CONFIRMATION: ['order confirmed','sipariş onay','po confirmed'],
  QUANTITY_CHANGE: ['quantity revised','qty updated','order reduced','order increased','adet revize','miktar değiş'],
  SAMPLE: ['sample','numune','lab dip','proto'], PRODUCTION: ['production','üretim','cutting','sewing'],
  SHIPMENT: ['shipment','dispatch','cargo','sevkiyat','yükleme','awb'], QUALITY: ['quality','inspection','kalite','defect','hata'],
  PAYMENT: ['payment','invoice','ödeme','fatura'], DOCUMENT: ['document','certificate','doküman','belge'],
});
const STRONG_FIELDS = Object.freeze(['orderNo','poNo','plmCode','styleId']);
const INDEPENDENT_FIELDS = Object.freeze(['orderNo','poNo','plmCode','styleId','modelCode','modelName','colourCode','manufacturer','supplier']);

function clean(value, max = 10000) { return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function norm(value) { return clean(value).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' '); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function messageText(message) { return clean([message && message.subject, message && (message.bodyText || message.body || message.preview || message.bodyPreview)].filter(Boolean).join('\n'), 250000); }
function stripNoise(input) {
  let value = clean(input, 250000).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\r/g, '');
  value = value.split(/\n(?:from|kimden|sent|gönderildi|subject|konu)\s*:/i)[0];
  value = value.replace(/\n(?:best regards|kind regards|saygılarımla|regards)[\s\S]*$/i, '');
  value = value.replace(/(?:this email and any attachments|bu e-posta ve ekleri)[\s\S]*$/i, '');
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function classify(message) {
  const haystack = norm(messageText(message)), hits = [];
  for (const [type, terms] of Object.entries(DICTIONARY)) {
    const matched = terms.filter(term => haystack.includes(norm(term)));
    if (matched.length) hits.push({ type, matchedTerms: matched, confidence: Math.min(99, 58 + matched.length * 10) });
  }
  if (!hits.length) hits.push({ type: 'GENERAL', matchedTerms: [], confidence: 35 });
  return hits.sort((a,b)=>b.confidence-a.confidence);
}
function monthNumber(value) {
  const months = { jan:1,january:1,ocak:1,feb:2,february:2,şubat:2,subat:2,mar:3,march:3,mart:3,apr:4,april:4,nisan:4,may:5,mayıs:5,mayis:5,jun:6,june:6,haziran:6,jul:7,july:7,temmuz:7,aug:8,august:8,ağustos:8,agustos:8,sep:9,september:9,eylül:9,eylul:9,oct:10,october:10,ekim:10,nov:11,november:11,kasım:11,kasim:11,dec:12,december:12,aralık:12,aralik:12 };
  return months[norm(value)] || 0;
}
function isoDate(year, month, day) { const y=Number(year),m=Number(month),d=Number(day),date=new Date(Date.UTC(y,m-1,d)); return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:''; }
function parseDateToken(token, context = {}) {
  const value = clean(token, 80), yearHint = Number(context.year) || new Date(context.receivedAt || Date.now()).getUTCFullYear();
  let match = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(value); if (match) return { value: isoDate(match[1],match[2],match[3]), ambiguous:false };
  match = /\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\b/.exec(value); if (match) return { value: isoDate(match[3],match[2],match[1]), ambiguous:false };
  match = /\b(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s*(20\d{2})?\b/.exec(value); if (match && monthNumber(match[2])) return { value: isoDate(match[3]||yearHint,monthNumber(match[2]),match[1]), ambiguous:false };
  match = /\b([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/.exec(value); if (match && monthNumber(match[1])) return { value: isoDate(match[3]||yearHint,monthNumber(match[1]),match[2]), ambiguous:false };
  match = /\b(\d{1,2})[/.](\d{1,2})(?![/.]\d)\b/.exec(value); if (match) return { value: isoDate(yearHint,match[2],match[1]), ambiguous:true, raw:value };
  return null;
}
function dateTokens(text) {
  const patterns = [/(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/g,/(?:\d{1,2}[.]\d{1,2}[.](?:20\d{2}))/g,/(?:\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+(?:\s+20\d{2})?)/g,/(?:[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{1,2}(?:,?\s+20\d{2})?)/g,/(?:\d{1,2}[\/]\d{1,2})(?![\/]\d)/g];
  return unique(patterns.flatMap(regex => clean(text,250000).match(regex) || []));
}
function detectDeliveryChange(message, currentValue) {
  const text = stripNoise(messageText(message)), lower = norm(text);
  if (!DICTIONARY.DELIVERY_DATE_CHANGE.some(term => lower.includes(norm(term)))) return null;
  const dates = dateTokens(text).map(token => ({ token, parsed: parseDateToken(token,{receivedAt:message.receivedAt||message.receivedDateTime}) })).filter(item=>item.parsed&&item.parsed.value);
  if (!dates.length) return null;
  const next = dates.at(-1), previous = dates.length > 1 ? dates.at(-2) : currentValue ? { token:clean(currentValue), parsed:parseDateToken(currentValue,{receivedAt:message.receivedAt})||{value:clean(currentValue),ambiguous:false} } : null;
  const excerptIndex = Math.max(0, lower.indexOf(norm(next.token)) - 100);
  return { type:'DELIVERY_DATE_CHANGE', oldValue:previous&&previous.parsed.value||'', newValue:next.parsed.value, ambiguous:Boolean(next.parsed.ambiguous), confidence:next.parsed.ambiguous?68:(previous?94:86), sourceExcerpt:text.slice(excerptIndex,excerptIndex+320), reasons:['Termin/delivery ifadesi bulundu',`Yeni tarih: ${next.parsed.value}`].concat(previous?[`Önceki tarih: ${previous.parsed.value}`]:[]) };
}
function currencyCode(value) { const v=upperCurrency(value); return ({'$':'USD','US$':'USD','USD':'USD','€':'EUR','EUR':'EUR','£':'GBP','GBP':'GBP','₺':'TRY','TL':'TRY','TRY':'TRY'})[v]||''; }
function upperCurrency(value){return clean(value,20).toUpperCase();}
function detectPriceChange(message, currentValue) {
  const text=stripNoise(messageText(message)), lower=norm(text); if(!DICTIONARY.PRICE_CHANGE.some(term=>lower.includes(norm(term)))) return null;
  const regex=/(?:USD|EUR|GBP|TRY|US\$|\$|€|£|₺|TL)?\s*\d+(?:[.,]\d{1,4})?\s*(?:USD|EUR|GBP|TRY|US\$|\$|€|£|₺|TL)?/gi, matches=[];
  for(const raw of text.match(regex)||[]){const number=/\d+(?:[.,]\d{1,4})?/.exec(raw);if(!number)continue;const currency=currencyCode(raw.replace(number[0], '').replace(/\s/g,''));matches.push({raw:clean(raw),value:Number(number[0].replace(',','.')),currency});}
  const priced=matches.filter(item=>Number.isFinite(item.value)&&item.value>0); if(!priced.length)return null; const next=priced.at(-1),previous=priced.length>1?priced.at(-2):currentValue?{value:Number(String(currentValue).replace(',','.')),currency:''}:null;
  const excerptIndex=Math.max(0,lower.indexOf(norm(next.raw))-100);return{type:'PRICE_CHANGE',oldValue:previous&&Number.isFinite(previous.value)?String(previous.value):'',newValue:String(next.value),currency:next.currency,ambiguous:!next.currency,confidence:next.currency?(previous?93:84):62,sourceExcerpt:text.slice(excerptIndex,excerptIndex+320),reasons:['Fiyat/price ifadesi bulundu',`Yeni değer: ${next.value}${next.currency?' '+next.currency:''}`]};
}
function detectQuantityChange(message,currentValue){const text=stripNoise(messageText(message)),lower=norm(text);if(!DICTIONARY.QUANTITY_CHANGE.some(term=>lower.includes(norm(term))))return null;const values=(text.match(/\b\d[\d.,]*\s*(?:pcs|pieces|adet|units?)\b/gi)||[]).map(raw=>({raw,value:Number(raw.replace(/[^\d.,]/g,'').replace(/\./g,'').replace(',','.'))})).filter(item=>Number.isFinite(item.value));if(!values.length)return null;const next=values.at(-1),previous=values.length>1?values.at(-2):currentValue?{value:Number(currentValue)}:null;return{type:'QUANTITY_CHANGE',oldValue:previous&&Number.isFinite(previous.value)?String(previous.value):'',newValue:String(next.value),unit:'PCS',confidence:previous?91:78,sourceExcerpt:text.slice(Math.max(0,text.indexOf(next.raw)-100),text.indexOf(next.raw)+220),reasons:['Miktar değişikliği ifadesi bulundu',`Yeni miktar: ${next.value}`]};}
function detectCancellation(message){const text=stripNoise(messageText(message)),lower=norm(text),terms=DICTIONARY.CANCELLATION.filter(term=>lower.includes(norm(term)));if(!terms.length)return null;const negated=/not\s+cancel|do not cancel|iptal değil|iptal etmeyin/i.test(text);return{type:'CANCELLATION',newValue:'POSSIBLE_CANCELLATION',confidence:negated?35:Math.min(99,86+terms.length*4),sourceExcerpt:text.slice(Math.max(0,lower.indexOf(norm(terms[0]))-100),Math.max(0,lower.indexOf(norm(terms[0]))-100)+320),reasons:[`İptal ifadesi bulundu: ${terms.join(', ')}`].concat(negated?['Olumsuzlama bulundu; kullanıcı teyidi gerekir']:[])};}
function matchContext(message, context = {}, config = {}) {
  const haystack=norm(messageText(message)),matched=[];for(const field of INDEPENDENT_FIELDS){const value=clean(context[field],300);if(value&&haystack.includes(norm(value)))matched.push({field,value,strong:STRONG_FIELDS.includes(field)});}
  const strong=matched.filter(item=>item.strong).length,independent=matched.length,score=Math.min(100,strong*55+Math.max(0,independent-strong)*22);
  const falsePositiveProtected=strong===0&&independent<2,threshold=Number(config.autoLinkThreshold)||95,confirmation=Number(config.confirmationThreshold)||80;
  return{score,matched,strongIdentifierCount:strong,independentIdentifierCount:independent,falsePositiveProtected,decision:!falsePositiveProtected&&score>=threshold?'AUTO_LINK':score>=confirmation?'USER_CONFIRMATION':'SEARCH_ONLY',reasons:matched.map(item=>`${item.field}${item.strong?' (strong)':''} eşleşti`)};
}
function analyzeMessage(message, context = {}, config = {}) {
  const classifications=classify(message),match=matchContext(message,context,config),candidates=[];
  const add=value=>{if(value)candidates.push({...value,sourceMessageId:clean(message.messageId||message.id,1000),conversationId:clean(message.conversationId,1000),classification:classifications.map(item=>item.type)});};
  add(detectDeliveryChange(message,context.deliveryDate));add(detectPriceChange(message,context.price||context.fob));add(detectQuantityChange(message,context.quantity));add(detectCancellation(message));
  return{normalized:{subject:clean(message.subject,1000),text:stripNoise(messageText(message)),sender:message.sender||message.from||{},receivedAt:clean(message.receivedAt||message.receivedDateTime,80)},classifications,match,candidates};
}
function deterministicSummary(messages) {
  const list=(Array.isArray(messages)?messages:[]).map((message,index)=>({...message,_index:index+1,_analysis:analyzeMessage(message)}));const classes=unique(list.flatMap(item=>item._analysis.classifications.map(row=>row.type))).filter(type=>type!=='GENERAL');const candidates=list.flatMap(item=>item._analysis.candidates.map(candidate=>({...candidate,sourceIndex:item._index})));const dates=candidates.filter(c=>c.type==='DELIVERY_DATE_CHANGE').map(c=>({value:c.newValue,sourceMessage:c.sourceIndex}));const prices=candidates.filter(c=>c.type==='PRICE_CHANGE').map(c=>({value:c.newValue,currency:c.currency||'',sourceMessage:c.sourceIndex}));const risks=candidates.filter(c=>c.type==='CANCELLATION').map(c=>({type:'CANCELLATION',confidence:c.confidence,sourceMessage:c.sourceIndex}));const latest=list.at(-1);return{summary:list.length?`${list.length} mail incelendi. ${classes.length?classes.join(', '):'Belirgin operasyonel sınıf bulunmadı.'}`:'Özetlenecek mail bulunamadı.',keyDecisions:classes.filter(c=>['APPROVAL','REJECTION','CANCELLATION'].includes(c)).map(c=>({text:c,sourceMessage:(list.find(i=>i._analysis.classifications.some(x=>x.type===c))||{})._index||null})),openQuestions:[],actions:risks.length?['Olası iptal sinyalini doğrulayın.']:dates.length?['Termin değişikliği adayını inceleyin.']:[],dates,prices,risks,confidence:list.length?Math.min(92,55+list.length*6):0,latestMessageId:latest&&clean(latest.messageId||latest.id,1000),provider:'deterministic-fallback'};}
function summaryCacheKey(conversationId,messages){const latest=(messages||[]).at(-1)||{};return hash([conversationId,latest.messageId||latest.id,latest.receivedAt||latest.receivedDateTime].join('|'));}

module.exports={CLASSIFICATIONS,DICTIONARY,STRONG_FIELDS,INDEPENDENT_FIELDS,stripNoise,classify,parseDateToken,detectDeliveryChange,detectPriceChange,detectQuantityChange,detectCancellation,matchContext,analyzeMessage,deterministicSummary,summaryCacheKey,clean,norm,hash};
