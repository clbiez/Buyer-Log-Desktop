'use strict';

// Buyer Log embedded web-automation engine.
//
// This module talks directly to Chromium/Edge through the Chrome DevTools
// Protocol (CDP). It intentionally has ZERO npm dependencies so web-agent
// workflows keep working even when playwright-core was not installed by npm.
// The browser itself remains the locally installed Microsoft Edge; this file is
// the automation engine/driver that Buyer Log carries inside its own package.

const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const ENGINE_NAME = 'buyerlog-cdp';
const ENGINE_VERSION = '1.1';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function engineError(message, code = 'PORTABLE_WEB_ENGINE_ERROR') {
  return Object.assign(new Error(message), { code });
}

function httpJson(endpoint, pathname, method = 'GET', timeoutMs = 10000) {
  const url = new URL(pathname, endpoint);
  return new Promise((resolve, reject) => {
    const request = http.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { Accept: 'application/json', Connection: 'close' },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode || 500) >= 400) {
          reject(engineError(`CDP HTTP ${response.statusCode}: ${text.slice(0, 500)}`, 'CDP_HTTP_ERROR'));
          return;
        }
        try { resolve(text ? JSON.parse(text) : {}); }
        catch (error) { reject(engineError(`CDP JSON okunamadı: ${error.message}`, 'CDP_JSON_ERROR')); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(engineError('CDP HTTP zaman aşımı.', 'CDP_HTTP_TIMEOUT'), { timeoutType:'networkTimeout', timeoutMs })));
    request.on('error', reject);
    request.end();
  });
}

class LocalWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = new URL(url);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.fragmentOpcode = 0;
    this.fragments = [];
    this.closed = false;
  }

  async connect(timeoutMs = 10000) {
    if (this.url.protocol !== 'ws:') throw engineError('Yerel CDP yalnız ws:// bağlantısını destekler.', 'CDP_WS_PROTOCOL');
    const port = Number(this.url.port) || 80;
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const path = `${this.url.pathname || '/'}${this.url.search || ''}`;
    await new Promise((resolve, reject) => {
      let done = false, header = Buffer.alloc(0);
      const finishError = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { this.socket && this.socket.destroy(); } catch (_) {}
        reject(error);
      };
      const timer = setTimeout(() => finishError(Object.assign(engineError('CDP WebSocket bağlantısı zaman aşımına uğradı.', 'CDP_WS_TIMEOUT'), { timeoutType:'networkTimeout', timeoutMs })), timeoutMs);
      const socket = net.createConnection({ host: this.url.hostname, port });
      this.socket = socket;
      socket.once('error', finishError);
      socket.once('connect', () => {
        socket.write([
          `GET ${path} HTTP/1.1`,
          `Host: ${this.url.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ].join('\r\n'));
      });
      const onHandshake = chunk => {
        header = Buffer.concat([header, chunk]);
        const split = header.indexOf('\r\n\r\n');
        if (split < 0) return;
        socket.off('data', onHandshake);
        const head = header.subarray(0, split).toString('utf8');
        const rest = header.subarray(split + 4);
        const status = /^HTTP\/1\.1\s+101\b/m.test(head);
        const acceptMatch = /\r\nSec-WebSocket-Accept:\s*([^\r\n]+)/i.exec(`\r\n${head}`);
        if (!status || !acceptMatch || acceptMatch[1].trim() !== expectedAccept) {
          finishError(engineError(`CDP WebSocket el sıkışması reddedildi: ${head.split('\r\n')[0] || 'bilinmeyen yanıt'}`, 'CDP_WS_HANDSHAKE'));
          return;
        }
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.off('error', finishError);
        socket.on('error', error => this.emit('error', error));
        socket.on('close', () => { this.closed = true; this.emit('close'); });
        socket.on('data', data => this._consume(data));
        if (rest.length) this._consume(rest);
        resolve(this);
      };
      socket.on('data', onHandshake);
    });
    return this;
  }

  _consume(chunk) {
    if (!chunk || !chunk.length) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const fin = Boolean(b0 & 0x80), opcode = b0 & 0x0f, masked = Boolean(b1 & 0x80);
      let length = b1 & 0x7f, offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2), low = this.buffer.readUInt32BE(6);
        const combined = high * 0x100000000 + low;
        if (!Number.isSafeInteger(combined)) { this.destroy(); return; }
        length = combined; offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      let mask = null;
      if (masked) { mask = this.buffer.subarray(offset, offset + 4); offset += 4; }
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (masked && mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { this.closed = true; this.destroy(); return; }
      if (opcode === 0x9) { this._sendFrame(0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x0) {
        if (!this.fragmentOpcode) continue;
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments); const original = this.fragmentOpcode;
          this.fragmentOpcode = 0; this.fragments = [];
          this._deliver(original, full);
        }
        continue;
      }
      if (!fin) { this.fragmentOpcode = opcode; this.fragments = [payload]; continue; }
      this._deliver(opcode, payload);
    }
  }

  _deliver(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload.toString('utf8'));
    else if (opcode === 0x2) this.emit('message', payload.toString('utf8'));
  }

  _sendFrame(opcode, payload) {
    if (!this.socket || this.closed) throw engineError('CDP WebSocket kapalı.', 'CDP_WS_CLOSED');
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload == null ? '' : payload), 'utf8');
    const mask = crypto.randomBytes(4);
    let head;
    if (body.length < 126) {
      head = Buffer.alloc(2); head[0] = 0x80 | opcode; head[1] = 0x80 | body.length;
    } else if (body.length <= 0xffff) {
      head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(body.length, 2);
    } else {
      head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127;
      const high = Math.floor(body.length / 0x100000000), low = body.length >>> 0;
      head.writeUInt32BE(high, 2); head.writeUInt32BE(low, 6);
    }
    const masked = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i += 1) masked[i] = body[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([head, mask, masked]));
  }

  sendText(text) { this._sendFrame(0x1, Buffer.from(String(text), 'utf8')); }
  close() {
    if (this.closed) return;
    try { this._sendFrame(0x8, Buffer.alloc(0)); } catch (_) {}
    this.closed = true;
    setTimeout(() => this.destroy(), 50).unref?.();
  }
  destroy() { try { this.socket && this.socket.destroy(); } catch (_) {} }
}

class CdpClient extends EventEmitter {
  constructor(wsUrl) {
    super();
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }
  async connect() {
    this.ws = await new LocalWebSocket(this.wsUrl).connect();
    this.ws.on('message', text => this._message(text));
    this.ws.on('close', () => this._closed());
    // Transport errors close the local CDP session; they must never become an
    // unhandled EventEmitter 'error' that could terminate the Buyer Log server.
    this.ws.on('error', () => this._closed());
    return this;
  }
  _message(text) {
    let message;
    try { message = JSON.parse(text); } catch (_) { return; }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(engineError(message.error.message || 'CDP komutu başarısız.', 'CDP_COMMAND_ERROR'));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method) {
      const params = message.params || {};
      this.emit(message.method, params);
      if (message.sessionId) this.emit('session-event', { sessionId:message.sessionId, method:message.method, params });
    }
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(engineError('CDP bağlantısı kapandı.', 'CDP_CLOSED')); }
    this.pending.clear();
    this.emit('close');
  }
  _send(method, params = {}, timeoutMs = 45000, sessionId = '') {
    if (!this.ws || this.closed) return Promise.reject(engineError('CDP bağlantısı hazır değil.', 'CDP_NOT_CONNECTED'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(engineError(`CDP komutu zaman aşımına uğradı: ${method}`, 'CDP_COMMAND_TIMEOUT'), { timeoutType:'networkTimeout', timeoutMs })); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.sendText(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  send(method, params = {}, timeoutMs = 45000) { return this._send(method, params, timeoutMs); }
  sendSession(sessionId, method, params = {}, timeoutMs = 45000) { return this._send(method, params, timeoutMs, sessionId); }
  close() { if (this.ws) this.ws.close(); this._closed(); }
}

// DevToolsActivePort can expose only the browser-level WebSocket while hiding
// /json/* HTTP endpoints. Flat Target sessions let every page keep the same
// PortablePage API without trying to send a ws:// URL through node:http.
class CdpSessionClient extends EventEmitter {
  constructor(root, sessionId) {
    super();
    this.root = root;
    this.sessionId = sessionId;
    this.closed = false;
    this._event = event => { if (event.sessionId === this.sessionId) this.emit(event.method, event.params || {}); };
    this._rootClosed = () => this._closed();
    root.on('session-event', this._event);
    root.on('close', this._rootClosed);
  }
  send(method, params = {}, timeoutMs = 45000) {
    if (this.closed) return Promise.reject(engineError('CDP sayfa oturumu kapalı.', 'CDP_SESSION_CLOSED'));
    return this.root.sendSession(this.sessionId, method, params, timeoutMs);
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.root.off('session-event', this._event);
    this.root.off('close', this._rootClosed);
    this.emit('close');
  }
  close() { this._closed(); }
}

function finderFunctionSource() {
  return `function(strategy, selector, role) {
    const needle = String(selector || '').trim();
    const lower = value => String(value == null ? '' : value).replace(/\\s+/g,' ').trim().toLocaleLowerCase('tr-TR');
    const wanted = lower(needle);
    const visible = el => { if (!el || !el.isConnected) return false; const style=getComputedStyle(el),r=el.getBoundingClientRect(); return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)!==0&&r.width>0&&r.height>0; };
    const nameOf = el => lower((el.getAttribute&&el.getAttribute('aria-label')) || (el.getAttribute&&el.getAttribute('title')) || (el.getAttribute&&el.getAttribute('placeholder')) || el.innerText || el.textContent || el.value || '');
    const contains = value => !wanted || lower(value).includes(wanted);
    const roots=[document], all=[];
    for(let i=0;i<roots.length;i++){
      const root=roots[i],elements=[...(root.querySelectorAll?root.querySelectorAll('*'):[])];
      for(const el of elements){
        all.push(el);
        if(el.shadowRoot)roots.push(el.shadowRoot);
        if(el.tagName==='IFRAME'||el.tagName==='FRAME'){try{if(el.contentDocument)roots.push(el.contentDocument);}catch(_){} }
      }
    }
    const deepQuery = css => { for(const root of roots){try{const el=root.querySelector&&root.querySelector(css);if(el)return el;}catch(_){return null;}} return null; };
    let candidates=[];
    if (strategy==='css') return deepQuery(needle);
    if (strategy==='placeholder') candidates=all.filter(el=>el.matches&&el.matches('[placeholder],[aria-placeholder],[data-placeholder]')&&contains(el.getAttribute('placeholder')||el.getAttribute('aria-placeholder')||el.getAttribute('data-placeholder')));
    else if (strategy==='label') {
      candidates=all.filter(el=>el.getAttribute&&el.hasAttribute('aria-label')&&contains(el.getAttribute('aria-label')));
      for (const label of all.filter(el=>el.tagName==='LABEL')) {
        if (!contains(label.innerText||label.textContent)) continue;
        const id=label.getAttribute('for'); const localRoot=label.getRootNode&&label.getRootNode();
        const el=id?((localRoot&&localRoot.getElementById&&localRoot.getElementById(id))||document.getElementById(id)):label.querySelector('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
        if (el) candidates.push(el);
      }
    } else if (strategy==='role') {
      const wantedRole=String(role||'button').toLowerCase();
      candidates=all.filter(el=>{
        if(!el.matches)return false;
        const explicit=String(el.getAttribute&&el.getAttribute('role')||'').toLowerCase();
        const implicit=(wantedRole==='button'&&el.matches('button,input[type="button"],input[type="submit"]'))
          ||(wantedRole==='link'&&el.matches('a[href]'))
          ||(wantedRole==='searchbox'&&el.matches('input[type="search"]'))
          ||(wantedRole==='textbox'&&el.matches('input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="url"],input[type="number"],textarea,[contenteditable]:not([contenteditable="false"])'))
          ||(wantedRole==='combobox'&&el.matches('select,input[list]'))
          ||(wantedRole==='checkbox'&&el.matches('input[type="checkbox"]'))
          ||(wantedRole==='radio'&&el.matches('input[type="radio"]'));
        return (explicit===wantedRole||implicit)&&contains(nameOf(el));
      });
    } else {
      const preferred=all.filter(el=>el.matches&&el.matches('button,a,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[onclick],[tabindex],label')&&contains(nameOf(el)));
      if (preferred.length) candidates=preferred;
      else candidates=all.filter(el=>contains(nameOf(el))&&!([...el.children].some(child=>contains(nameOf(child)))));
    }
    return candidates.find(visible) || candidates[0] || null;
  }`;
}
const FINDER_SOURCE = finderFunctionSource();
function elementExpression(strategy, selector, role) {
  return `(${FINDER_SOURCE})(${JSON.stringify(clean(strategy) || 'text')},${JSON.stringify(clean(selector))},${JSON.stringify(clean(role))})`;
}

class PortableLocator {
  constructor(page, strategy, selector, role = '') { this.page = page; this.strategy = strategy || 'text'; this.selector = clean(selector); this.role = clean(role); }
  first() { return this; }
  _element() { return elementExpression(this.strategy, this.selector, this.role); }
  async waitFor(options = {}) {
    const timeout = Math.max(100, Number(options.timeout) || 20000), deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0&&r.width>0&&r.height>0;})()`);
      if (found) return;
      await sleep(120);
    }
    throw engineError(`Web öğesi bulunamadı veya görünür değil: ${this.selector}`, 'WEB_ELEMENT_TIMEOUT');
  }
  async click() {
    const point = await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if (!point) throw engineError(`Web öğesi bulunamadı: ${this.selector}`, 'WEB_ELEMENT_NOT_FOUND');
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
    await sleep(80);
  }
  async dblclick() {
    const point = await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if (!point) throw engineError(`Web öğesi bulunamadı: ${this.selector}`, 'WEB_ELEMENT_NOT_FOUND');
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:2 });
    await this.page.client.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:2 });
    await sleep(100);
  }
  async fill(value) {
    const text = String(value == null ? '' : value);
    const ok = await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el)return false;el.focus();const value=${JSON.stringify(text)};if(el.isContentEditable||String(el.getAttribute&&el.getAttribute('role')||'').toLowerCase()==='textbox'&&!('value' in el)){el.textContent=value;}else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')&&Object.getOwnPropertyDescriptor(proto,'value').set;if(setter)setter.call(el,value);else el.value=value;}el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    if (!ok) throw engineError(`Doldurulacak alan bulunamadı: ${this.selector}`, 'WEB_ELEMENT_NOT_FOUND');
  }
  async selectOption(option) {
    const wanted = typeof option === 'object' && option ? (option.label != null ? option.label : option.value) : option;
    const ok = await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el||el.tagName!=='SELECT')return false;const wanted=${JSON.stringify(String(wanted == null ? '' : wanted))};const opt=[...el.options].find(o=>o.label===wanted||o.text===wanted||o.value===wanted)||[...el.options].find(o=>String(o.label||o.text||o.value).toLocaleLowerCase('tr-TR').includes(wanted.toLocaleLowerCase('tr-TR')));if(!opt)return false;el.value=opt.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    if (!ok) throw engineError(`Seçenek bulunamadı: ${this.selector} = ${wanted}`, 'WEB_OPTION_NOT_FOUND');
  }
  async press(key) {
    const name = clean(key) || 'Enter';
    const focused = await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el)return false;el.focus();return true;})()`);
    if (!focused) throw engineError(`Tuş gönderilecek alan bulunamadı: ${this.selector}`, 'WEB_ELEMENT_NOT_FOUND');
    const table = { Enter:{code:'Enter',key:'Enter',windowsVirtualKeyCode:13,text:'\r'}, Tab:{code:'Tab',key:'Tab',windowsVirtualKeyCode:9,text:''}, Escape:{code:'Escape',key:'Escape',windowsVirtualKeyCode:27,text:''}, ArrowDown:{code:'ArrowDown',key:'ArrowDown',windowsVirtualKeyCode:40,text:''}, ArrowUp:{code:'ArrowUp',key:'ArrowUp',windowsVirtualKeyCode:38,text:''} };
    const meta = table[name] || { code:name, key:name, windowsVirtualKeyCode:0, text:name.length===1?name:'' };
    await this.page.client.send('Input.dispatchKeyEvent', { type:'keyDown', key:meta.key, code:meta.code, windowsVirtualKeyCode:meta.windowsVirtualKeyCode, text:meta.text });
    await this.page.client.send('Input.dispatchKeyEvent', { type:'keyUp', key:meta.key, code:meta.code, windowsVirtualKeyCode:meta.windowsVirtualKeyCode });
  }
  async _setChecked(checked) {
    const current = await this.page._evaluateValue(`(()=>{const el=${this._element()};return el&&('checked' in el)?!!el.checked:null;})()`);
    if (current == null) throw engineError(`İşaretlenecek alan bulunamadı: ${this.selector}`, 'WEB_ELEMENT_NOT_FOUND');
    if (current !== checked) await this.click();
    const after = await this.page._evaluateValue(`(()=>{const el=${this._element()};return el&&('checked' in el)?!!el.checked:null;})()`);
    if (after !== checked) {
      await this.page._evaluateValue(`(()=>{const el=${this._element()};if(!el)return false;el.checked=${checked?'true':'false'};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    }
  }
  check() { return this._setChecked(true); }
  uncheck() { return this._setChecked(false); }
}

class PortablePage extends EventEmitter {
  constructor(context, target, attachedClient = null) {
    super();
    this.context = context;
    this.targetId = target.id || target.targetId || '';
    this.openerId = target.openerId || '';
    /* Edge'in her profili AYRI bir browser context'tir. Bu kimlik olmadan
       "yeni sekmeyi hangi profilde açtım?" sorusunun cevabı yoktu ve
       Target.createTarget sessizce VARSAYILAN profile düşüyordu — çok
       profilli bir makinede bu, başka bir kişinin oturumu demekti. */
    this.browserContextId = target.browserContextId || '';
    this.wsUrl = target.webSocketDebuggerUrl || '';
    this._url = target.url || 'about:blank';
    this.client = attachedClient;
    this.closed = false;
    this._listenersWired = false;
  }
  async init() {
    if (!this.client) this.client = await new CdpClient(this.wsUrl).connect();
    /* init() bugün yalnız _addTarget'tan ve targetId başına bir kez çağrılıyor
       (bkz. PortableContext._addTarget'taki _attaching rezervasyonu). Ama bu
       üç dinleyici daha önce SADECE istemci OLUŞTURMA koşuluna (if(!this.client))
       bağlıydı, kendi koşuluna değil — init() ikinci kez çağrılsaydı (ör.
       ileride başka bir çağıran attachedClient'ı yeniden kullansaydı) aynı
       istemciye üç dinleyici daha eklenir, hiçbiri kaldırılmazdı. Bayrak bunu
       çağrı sayısından bağımsız olarak imkânsız kılar. */
    if (this._listenersWired) return this;
    this._listenersWired = true;
    this.client.on('close', () => { if (!this.closed) { this.closed = true; this.emit('close'); } });
    this.client.on('Page.frameNavigated', params => { if (params.frame && !params.frame.parentId && params.frame.url) this._url = params.frame.url; });
    this.client.on('Runtime.bindingCalled', params => this.context._bindingCalled(this, params));
    await this.client.send('Page.enable');
    await this.client.send('Runtime.enable');
    await this.context._configurePage(this);
    return this;
  }
  isClosed() { return this.closed || !this.client || this.client.closed; }
  url() { return this._url; }
  async title() { return String(await this._evaluateValue('document.title') || ''); }
  async _evaluate(expression, options = {}) {
    const result = await this.client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: options.returnByValue !== false, userGesture: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text || 'JavaScript hatası';
      throw engineError(detail, 'CDP_EVALUATION_ERROR');
    }
    return result.result || {};
  }
  async _evaluateValue(expression) { const remote = await this._evaluate(expression, { returnByValue:true }); return remote.value; }
  async evaluate(fn) {
    const source = typeof fn === 'function' ? `(${fn.toString()})()` : String(fn || '');
    return this._evaluateValue(source);
  }
  async goto(url, options = {}) {
    const timeout = Math.max(1000, Number(options.timeout) || 45000), waitUntil = options.waitUntil || 'domcontentloaded';
    const eventName = waitUntil === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
    let resolveEvent;
    const eventPromise = new Promise(resolve => { resolveEvent = resolve; });
    const listener = () => resolveEvent(true);
    this.client.once(eventName, listener);
    let nav;
    try {
      nav = await this.client.send('Page.navigate', { url:String(url) }, timeout);
    } catch (error) {
      if (error && error.code === 'CDP_COMMAND_TIMEOUT') {
        this.client.off(eventName, listener);
        throw Object.assign(error, { code:'WEB_NAVIGATION_TIMEOUT', timeoutType:'navigationTimeout', timeoutMs:timeout });
      }
      this.client.off(eventName, listener);
      throw error;
    }
    if (nav.errorText) {
      this.client.off(eventName, listener);
      const networkFailure = /ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_|ADDRESS_UNREACHABLE|NETWORK_CHANGED)/i.test(String(nav.errorText));
      throw Object.assign(engineError(`Sayfa açılamadı: ${nav.errorText}`, networkFailure ? 'WEB_NETWORK_ERROR' : 'WEB_NAVIGATION_FAILED'), networkFailure ? { timeoutType:'networkTimeout', timeoutMs } : {});
    }
    this._url = String(url);
    const navigationCompleted = await Promise.race([eventPromise, sleep(timeout).then(() => false)]);
    if (!navigationCompleted) {
      this.client.off(eventName, listener);
      throw Object.assign(new Error('Sayfa navigasyonu zaman aşımına uğradı.'), {
        code: 'WEB_NAVIGATION_TIMEOUT',
        timeoutType: 'navigationTimeout',
        timeoutMs: timeout,
      });
    }
    this.client.off(eventName, listener);
    // URL may have redirected. Ask the page once after navigation.
    try { this._url = String(await this._evaluateValue('location.href') || this._url); } catch (_) {}
  }
  waitForTimeout(ms) { return sleep(Math.max(0, Number(ms) || 0)); }
  locator(selector) { return new PortableLocator(this, 'css', selector); }
  getByText(selector) { return new PortableLocator(this, 'text', selector); }
  getByLabel(selector) { return new PortableLocator(this, 'label', selector); }
  getByPlaceholder(selector) { return new PortableLocator(this, 'placeholder', selector); }
  getByRole(role, options = {}) { return new PortableLocator(this, 'role', options.name || '', role); }
  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.context.browser.closeTarget(this.targetId); } catch (_) {}
    try { this.client && this.client.close(); } catch (_) {}
    this.emit('close');
  }
}

class PortableContext extends EventEmitter {
  constructor(browser) {
    super();
    this.browser = browser;
    this._pages = [];
    this.bindings = new Map();
    this.initScripts = [];
    this.closed = false;
    /* v7.75 — EŞZAMANLI TARGET ATTACH KORUMASI.
       Bulunan kusur: kayıt (recording) modu her 180ms'de bir syncPages()
       çağırıyordu (setInterval, önceki turu BEKLEMEDEN). attachTargetClient +
       PortablePage.init() (Target.attachToTarget, Page.enable, Runtime.enable,
       varsa binding/init-script kurulumu) birkaç CDP round-trip'i tutuyor ve
       180ms'den uzun sürebiliyor. Bu pencerede YENİ görülen bir hedef için
       ÜST ÜSTE gelen syncPages() turları _addTarget'ı aynı targetId için
       PARALEL çağırıyordu: ikisi de "existing" kontrolünde henüz _pages'e
       eklenmemiş aynı hedefi görüyor, ikisi de kendi CdpSessionClient'ını
       kuruyordu. Her CdpSessionClient kurulumu paylaşılan browserClient'a
       ('session-event','close') için 2 dinleyici ekliyor ve YETİM kalan kopya
       hiç kapanmadığı için hiç kaldırılmıyordu — "11 close listeners added to
       [CdpClient]" uyarısının kök nedeni buydu.

       Çözüm: hedef, İLK await'ten ÖNCE (senkron olarak) bu Map'te rezerve
       edilir. Aynı targetId için üst üste gelen her çağrı AYNI devam eden
       sözü paylaşır; ikinci bir attach hiç başlamaz. */
    this._attaching = new Map();
  }
  async init() {
    await this.syncPages();
    return this;
  }
  pages() { return this._pages.filter(page => !page.isClosed()); }
  /* Ek (sonradan açılmış) profil bağlamları; varsayılan bağlam listede yoktur.
     Senkron tüketiciler için son okunan değer `extraBrowserContextIds`
     alanında tutulur. */
  async refreshBrowserContextIds() {
    this.extraBrowserContextIds = await this.browser.additionalBrowserContextIds();
    return this.extraBrowserContextIds;
  }
  async _addTarget(target) {
    if (!target || target.type !== 'page') return null;
    const targetId = target.id || target.targetId || '';
    if (!targetId || (!target.webSocketDebuggerUrl && !this.browser.browserClient)) return null;
    const existing = this._pages.find(page => page.targetId === targetId && !page.isClosed());
    if (existing) {
      /* PROFİL KİMLİĞİ UZLAŞTIRILIR.
       *
       * `Target.createTarget` yanıtı browserContextId TAŞIMAZ; createTarget()
       * onu çağıranın verdiği seçenekten doldurur. Buyer Log bir sekmeyi açık
       * bir profil kimliği vermeden açtığında sayfa nesnesi BOŞ bir
       * browserContextId ile doğuyor, oysa gerçekte varsayılan profile
       * aittir. `Target.getTargets` daha sonra GERÇEK kimliği getirir ama
       * sayfa "zaten var" diye erkenden dönüldüğü için bu değer hiç
       * yazılmıyordu.
       *
       * Sonuç: Buyer Log'un KENDİ açtığı sekme ile keşfedilen sekmeler aynı
       * profilde olsalar bile kimlikleri eşleşmiyordu; profil bazlı her
       * karşılaştırma yanlış sonuç veriyordu (çok profilli makinede yanlış
       * CoreNectum sekmesinin seçilmesinin kök nedeni budur). */
      const discovered = String(target.browserContextId || '');
      if (discovered && !existing.browserContextId) existing.browserContextId = discovered;
      return existing;
    }
    const pending = this._attaching.get(targetId);
    if (pending) return pending;
    const attach = (async () => {
      const attachedClient = target.webSocketDebuggerUrl ? null : await this.browser.attachTargetClient(targetId);
      const page = await new PortablePage(this, target, attachedClient).init();
      this._pages.push(page);
      this.emit('page', page);
      return page;
    })();
    this._attaching.set(targetId, attach);
    try { return await attach; }
    finally { if (this._attaching.get(targetId) === attach) this._attaching.delete(targetId); }
  }
  async syncPages() {
    const targets = await this.browser.listTargets();
    const activeIds = new Set();
    for (const target of Array.isArray(targets) ? targets : []) {
      if (target.type !== 'page') continue;
      const targetId = target.id || target.targetId || '';
      if (targetId) activeIds.add(targetId);
      await this._addTarget(target);
    }
    for (const page of this._pages) {
      if (page.targetId && !activeIds.has(page.targetId) && !page.closed) {
        page.closed = true;
        try { page.client && page.client.close(); } catch (_) {}
        page.emit('close');
      }
    }
    return this.pages();
  }
  /* browserContextId verilirse sekme O PROFİLDE açılır. Verilmezse Edge
     varsayılan profili seçer; çağıran bunu bilerek yapmalıdır. */
  async newPage(url = 'about:blank', options = {}) {
    const target = await this.browser.createTarget(url, options);
    if (!target || !(target.id || target.targetId)) throw engineError('Yeni Edge sekmesi açılamadı.', 'CDP_TARGET_CREATE_FAILED');
    return this._addTarget(target);
  }
  async newPageFrom(referencePage, url = 'about:blank') {
    if (!referencePage || referencePage.isClosed()) return this.newPage(url);
    const before = new Set(this.pages().map(page => page.targetId));
    const targetUrl = String(url || 'about:blank');
    await referencePage._evaluateValue(`(()=>{const w=window.open(${JSON.stringify(targetUrl)},'_blank');return !!w;})()`).catch(() => false);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await sleep(90);
      await this.syncPages().catch(() => {});
      const opened = this.pages().filter(page => !before.has(page.targetId) && !page.isClosed());
      const sameProfile = opened.find(page => page.openerId === referencePage.targetId);
      if (sameProfile) return sameProfile;
      if (opened.length === 1) return opened[0];
    }
    /* window.open engellenmiş olabilir (pop-up politikası, kurumsal eklenti).
       Referans sekmenin profili BİLİNİYORSA sekme doğrudan o profilde açılır;
       bu, eski davranışın (hata) aksine oturumu korur. Profil bilinmiyorsa
       varsayılana düşmek yerine yine hata verilir: yanlış profilde sessizce
       çalışmak, hiç çalışmamaktan daha kötüdür. */
    const contextId = referencePage.browserContextId || '';
    if (contextId) return this.newPage(url, { browserContextId: contextId });
    throw engineError('Buyer Log ile aynı Edge profilinde yeni sekme açılamadı.', 'CDP_SAME_PROFILE_TAB_FAILED');
  }
  async exposeBinding(name, callback) {
    const publicName = clean(name); if (!publicName) return;
    const internal = `__bl_cdp_${crypto.createHash('sha1').update(publicName).digest('hex').slice(0, 12)}`;
    this.bindings.set(internal, { publicName, callback });
    for (const page of this.pages()) await this._installBinding(page, internal, publicName);
  }
  async addInitScript(script) {
    const source = typeof script === 'function' ? `(${script.toString()})()` : String(script || '');
    if (!source) return;
    this.initScripts.push(source);
    for (const page of this.pages()) await this._installScript(page, source);
  }
  async _installScript(page, source) {
    await page.client.send('Page.addScriptToEvaluateOnNewDocument', { source }).catch(() => {});
    await page._evaluate(source).catch(() => {});
  }
  async _installBinding(page, internal, publicName) {
    const wrapper = `(()=>{try{const raw=window[${JSON.stringify(internal)}];if(typeof raw!=='function')return;Object.defineProperty(window,${JSON.stringify(publicName)},{configurable:true,writable:true,value:(payload)=>{try{raw(JSON.stringify(payload));}catch(_){}return Promise.resolve();}});}catch(_){}})()`;
    await page.client.send('Runtime.addBinding', { name: internal }).catch(() => {});
    await page.client.send('Page.addScriptToEvaluateOnNewDocument', { source: wrapper }).catch(() => {});
    await page._evaluate(wrapper).catch(() => {});
  }
  async _configurePage(page) {
    for (const [internal, binding] of this.bindings) await this._installBinding(page, internal, binding.publicName);
    for (const source of this.initScripts) await this._installScript(page, source);
  }
  _bindingCalled(page, params) {
    const binding = this.bindings.get(params && params.name); if (!binding) return;
    let payload = params.payload;
    try { payload = JSON.parse(payload); } catch (_) {}
    Promise.resolve(binding.callback({ page }, payload)).catch(() => {});
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const page of this.pages()) await page.close().catch(() => {});
    this.emit('close');
  }
}

class PortableBrowser extends EventEmitter {
  constructor(endpoint) { super(); this.endpoint = endpoint; this.context = new PortableContext(this); this.browserClient = null; this.closed = false; }
  async init() {
    const endpointUrl = new URL(this.endpoint);
    if (endpointUrl.protocol === 'ws:') this.browserClient = await new CdpClient(endpointUrl.href).connect();
    else {
      const version = await httpJson(this.endpoint, '/json/version');
      if (version && version.webSocketDebuggerUrl) this.browserClient = await new CdpClient(version.webSocketDebuggerUrl).connect().catch(() => null);
    }
    if (this.browserClient) this.browserClient.on('close', () => { if (!this.closed) this.emit('disconnected'); });
    await this.context.init();
    return this;
  }
  async listTargets() {
    if (!this.browserClient) return httpJson(this.endpoint, '/json/list');
    const result = await this.browserClient.send('Target.getTargets');
    return (result.targetInfos || []).map(target => ({ ...target, id:target.targetId }));
  }
  async attachTargetClient(targetId) {
    if (!this.browserClient) return null;
    const result = await this.browserClient.send('Target.attachToTarget', { targetId, flatten:true });
    if (!result.sessionId) throw engineError('Edge sayfa oturumu açılamadı.', 'CDP_TARGET_ATTACH_FAILED');
    return new CdpSessionClient(this.browserClient, result.sessionId);
  }
  async createTarget(url = 'about:blank', options = {}) {
    const target = String(url || 'about:blank');
    const browserContextId = String((options && options.browserContextId) || '');
    if (!this.browserClient) return httpJson(this.endpoint, `/json/new?${encodeURIComponent(target)}`, 'PUT');
    const params = browserContextId ? { url:target, browserContextId } : { url:target };
    const result = await this.browserClient.send('Target.createTarget', params);
    return { id:result.targetId, targetId:result.targetId, type:'page', url:target, browserContextId };
  }
  async closeTarget(targetId) {
    if (!this.browserClient) return httpJson(this.endpoint, `/json/close/${encodeURIComponent(targetId)}`);
    return this.browserClient.send('Target.closeTarget', { targetId });
  }
  contexts() { return [this.context]; }
  /* SONRADAN OLUŞTURULMUŞ profil bağlamları. `Target.getBrowserContexts`
     yalnız ek olarak açılan profilleri döndürür; tarayıcının AÇILDIĞI
     varsayılan bağlam bu listede YOKTUR. Fark alınarak "Buyer Log'un kendi
     profili hangisi" sorusu deterministik biçimde yanıtlanır — ön plandaki
     pencereye ya da en yeni sekmeye bakmaya gerek kalmaz. */
  async additionalBrowserContextIds() {
    if (!this.browserClient) return [];
    const result = await this.browserClient.send('Target.getBrowserContexts', {}, 10000).catch(() => null);
    return Array.isArray(result && result.browserContextIds) ? result.browserContextIds.map(String) : [];
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.browserClient && !this.browserClient.closed) {
      try { await this.browserClient.send('Browser.close', {}, 3000); } catch (_) {}
      this.browserClient.close();
    } else await this.context.close().catch(() => {});
    this.emit('disconnected');
  }
}

async function connectOverCDP(endpoint) {
  const browser = await new PortableBrowser(endpoint).init();
  return browser;
}

function engineStatus() {
  return { installed:true, embedded:true, engine:ENGINE_NAME, engineVersion:ENGINE_VERSION, dependencyFree:true };
}

module.exports = { ENGINE_NAME, ENGINE_VERSION, connectOverCDP, engineStatus, LocalWebSocket, CdpClient };
