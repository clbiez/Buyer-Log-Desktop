'use strict';

const MAX_BODY = 500000;
const QUOTE_SIGNATURE_PATTERNS = [
  /(?:^|\n)\s*-{2,}\s*(?:original message|forwarded message|ilet(?:ilen|ilmiş) ileti)\s*-{2,}/i,
  /(?:^|\n)\s*(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:/i,
  /(?:^|\n)\s*(?:kind regards|best regards|warm regards|regards|thanks\s*(?:&|and)\s*regards|saygılarımla|saygılar|iyi çalışmalar|best wishes)\b/i,
  /(?:^|\n)\s*(?:please consider the environment before printing|save paper!?|this e-?mail and any attachments|bu e-?posta ve ekleri)\b/i,
];
const INLINE_CUT_PATTERNS = [
  /\s+-{2,}\s*(?:original message|forwarded message)\s*-{2,}/i,
  /\s+(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:\s+/i,
  /\s+(?:kind regards|best regards|warm regards|regards|thanks\s*(?:&|and)\s*regards|saygılarımla|saygılar|iyi çalışmalar|best wishes)\b/i,
  /\s+(?:please consider the environment before printing|save paper!?|this e-?mail and any attachments|bu e-?posta ve ekleri)\b/i,
];

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#(\d+);/g, (_, n) => { const code=Number(n); return Number.isFinite(code) ? String.fromCodePoint(code) : _; })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const code=parseInt(n,16); return Number.isFinite(code) ? String.fromCodePoint(code) : _; })
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function removeEmailAddresses(value) {
  return String(value == null ? '' : value)
    .replace(/<mailto:[^>]+>/gi, ' ')
    .replace(/mailto:[^\s>]+/gi, ' ')
    .replace(/<?[A-Z0-9._%+\-']+@[A-Z0-9.\-]+\.[A-Z]{2,}>?/gi, ' ');
}

function cutQuotedAndSignature(value) {
  let text=String(value == null ? '' : value);
  for (const pattern of QUOTE_SIGNATURE_PATTERNS) {
    const match=pattern.exec(text); if(match && match.index>=0) text=text.slice(0,match.index);
  }
  if (!text.includes('\n')) {
    for (const pattern of INLINE_CUT_PATTERNS) {
      const match=pattern.exec(text); if(match && match.index>24) text=text.slice(0,match.index);
    }
  }
  return text;
}

function normalizeLines(value) {
  let text=removeEmailAddresses(decodeEntities(String(value == null ? '' : value).replace(/\r/g,'')));
  text=cutQuotedAndSignature(text);
  const lines=text.split('\n').map(line=>line.replace(/[\t ]+/g,' ').trimEnd());
  const out=[]; let blank=false;
  for (let line of lines) {
    line=line.replace(/^\s+/, '');
    if (!line) { if(out.length && !blank){out.push('');blank=true;} continue; }
    out.push(line); blank=false;
  }
  return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function stripTags(value) {
  return normalizeLines(String(value == null ? '' : value)
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/?(?:p|div|h[1-6]|blockquote|section|article|header|footer)\b[^>]*>/gi,'\n')
    .replace(/<li\b[^>]*>/gi,'\n• ')
    .replace(/<\/li\s*>/gi,'\n')
    .replace(/<[^>]+>/g,' '));
}

function htmlAttributes(tag) {
  const out={};
  String(tag||'').replace(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,(_m,key,a,b,c)=>{out[String(key).toLowerCase()]=a??b??c??'';return _m;});
  return out;
}

function isTrackingImage(tag) {
  const attrs=htmlAttributes(tag),style=String(attrs.style||'').toLowerCase(),src=String(attrs.src||'').toLowerCase(),alt=String(attrs.alt||'').toLowerCase();
  const width=parseInt(attrs.width,10),height=parseInt(attrs.height,10);
  if ((Number.isFinite(width)&&width<=3) || (Number.isFinite(height)&&height<=3)) return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden|width\s*:\s*[0-3]px|height\s*:\s*[0-3]px/.test(style)) return true;
  if (/spacer|tracking|pixel|transparent|beacon/.test(src+' '+alt)) return true;
  return false;
}

function extractTable(tableHtml, index) {
  const rows=[];
  const rowMatches=String(tableHtml||'').match(/<tr\b[\s\S]*?<\/tr\s*>/gi)||[];
  for(const rowHtml of rowMatches){
    const cells=[]; let match;
    const re=/<t([dh])\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi;
    while((match=re.exec(rowHtml))){
      const text=stripTags(match[2]).replace(/\n+/g,' ').trim();
      cells.push({text,header:String(match[1]).toLowerCase()==='h'});
    }
    if(cells.length)rows.push(cells);
  }
  return {id:`table-${index}`,index,label:`#Tablo${index}`,rowCount:rows.length,columnCount:rows.reduce((m,row)=>Math.max(m,row.length),0),rows};
}

function parseHtml(body) {
  let html=String(body == null ? '' : body).slice(0,MAX_BODY)
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi,' ')
    .replace(/<(?:iframe|object|embed|form|head|meta|link|base)\b[\s\S]*?<\/(?:iframe|object|embed|form|head)\s*>/gi,' ')
    .replace(/<(?:meta|link|base)\b[^>]*>/gi,' ');
  const tables=[]; let tableNo=0;
  html=html.replace(/<table\b[\s\S]*?<\/table\s*>/gi,match=>{tableNo++;tables.push(extractTable(match,tableNo));return `\n\n[[BL_TABLE_${tableNo}]]\n\n`;});
  const images=[]; let imageNo=0;
  html=html.replace(/<img\b[^>]*>/gi,tag=>{
    if(isTrackingImage(tag))return ' ';
    const attrs=htmlAttributes(tag);imageNo++;
    images.push({id:`image-${imageNo}`,index:imageNo,label:`#Görsel${imageNo}`,src:String(attrs.src||'').slice(0,2000),alt:decodeEntities(attrs.alt||'').slice(0,500),contentId:String(attrs.src||'').toLowerCase().startsWith('cid:')?String(attrs.src||'').slice(4):''});
    return `\n\n[[BL_IMAGE_${imageNo}]]\n\n`;
  });
  html=html
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<li\b[^>]*>/gi,'\n• ')
    .replace(/<\/li\s*>/gi,'\n')
    .replace(/<\/?(?:p|div|h[1-6]|blockquote|section|article|header|footer|ul|ol)\b[^>]*>/gi,'\n')
    .replace(/<[^>]+>/g,' ');
  let text=normalizeLines(html);
  const activeTableIds=new Set(),activeImageIds=new Set();
  text=text.replace(/\[\[BL_TABLE_(\d+)\]\]/g,(_m,n)=>{activeTableIds.add(Number(n));return `#Tablo${n}`;});
  text=text.replace(/\[\[BL_IMAGE_(\d+)\]\]/g,(_m,n)=>{activeImageIds.add(Number(n));return `#Görsel${n}`;});
  return {text,tables:tables.filter(t=>activeTableIds.has(t.index)),images:images.filter(i=>activeImageIds.has(i.index))};
}

function blocksFromText(text) {
  const blocks=[];
  const paragraphs=String(text||'').split(/\n{2,}/);
  for(const paragraph of paragraphs){
    const lines=paragraph.split('\n'); let buffer=[];
    const flush=()=>{if(buffer.length){const value=buffer.join('\n').trim();if(value)blocks.push({type:'paragraph',text:value});buffer=[];}};
    for(const line of lines){
      const t=line.trim(); let m;
      if((m=/^#Tablo(\d+)$/i.exec(t))){flush();blocks.push({type:'tableRef',id:`table-${m[1]}`,index:Number(m[1]),label:`#Tablo${m[1]}`});}
      else if((m=/^#Görsel(\d+)$/i.exec(t))){flush();blocks.push({type:'imageRef',id:`image-${m[1]}`,index:Number(m[1]),label:`#Görsel${m[1]}`});}
      else buffer.push(line);
    }
    flush();
  }
  return blocks;
}

function truncatePreview(text,max=900){
  const value=String(text||'').trim();if(value.length<=max)return value;
  const head=value.slice(0,max+1);let cut=Math.max(head.lastIndexOf('\n\n'),head.lastIndexOf('. '),head.lastIndexOf('! '),head.lastIndexOf('? '));
  if(cut<Math.floor(max*.6))cut=max;
  let out=value.slice(0,cut).trimEnd();
  // Never leave a marker half-written.
  out=out.replace(/#(?:Tablo|Görsel)\d*$/i,'').trimEnd();
  return out+'…';
}

function parseEmailContent(body,contentType='text',options={}){
  const isHtml=String(contentType||'').toLowerCase()==='html';
  const parsed=isHtml?parseHtml(body):{text:normalizeLines(String(body||'').slice(0,MAX_BODY)),tables:[],images:[]};
  const blocks=blocksFromText(parsed.text);
  const tables=parsed.tables.filter(table=>blocks.some(block=>block.type==='tableRef'&&block.index===table.index));
  const images=parsed.images.filter(image=>blocks.some(block=>block.type==='imageRef'&&block.index===image.index));
  return {
    mainText:parsed.text,
    previewText:truncatePreview(parsed.text,Number(options.previewMax)||900),
    blocks,tables,images,
    tableCount:tables.length,imageCount:images.length,
  };
}

module.exports={decodeEntities,removeEmailAddresses,cutQuotedAndSignature,normalizeLines,stripTags,isTrackingImage,extractTable,parseEmailContent,truncatePreview,blocksFromText};
