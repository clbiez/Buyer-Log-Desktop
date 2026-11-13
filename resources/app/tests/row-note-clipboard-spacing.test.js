'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('public/app-main.js','utf8');
function harness(text,html='asd'){
 const start=app.indexOf('function copyRichNoteSelection('),end=app.indexOf('\nfunction bindRichNoteEditor(',start);
 const fragment={},inside={},outside={},editor={contains:node=>node===inside};
 const range={startContainer:inside,endContainer:inside,cloneContents:()=>fragment};
 const selection={rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=>text};
 const data={},event={defaultPrevented:false,clipboardData:{setData:(type,value)=>{data[type]=value;}},preventDefault(){this.defaultPrevented=true;}};
 const box={append:node=>assert.equal(node,fragment),innerHTML:html};
 const context={window:{getSelection:()=>selection},document:{createElement:()=>box},todoSanitize:value=>value,trimRichNoteClipboard:node=>{assert.equal(node,box);}};
 vm.createContext(context);vm.runInContext(app.slice(start,end),context);
 return {copy:()=>context.copyRichNoteSelection(event,editor),data,event,selection,range,outside};
}
test('row note copy removes surrounding blank lines from the reported asd case',()=>{
 const h=harness('\n\nasd\n');h.copy();assert.equal(h.data['text/plain'],'asd');assert.equal(h.data['text/html'],'asd');assert.equal(h.event.defaultPrevented,true);
});
test('copy keeps internal blank lines, tabs, Unicode and meaningful spaces',()=>{
 const h=harness('\n  ilk\t satır\n\nson satır  \n','<b>ilk</b>');h.copy();assert.equal(h.data['text/plain'],'  ilk\t satır\n\nson satır  ');assert.equal(h.data['text/html'],'<b>ilk</b>');
});
test('partial selections use the range rather than the whole saved note',()=>{
 const h=harness('sd','sd');h.copy();assert.equal(h.data['text/plain'],'sd');assert.equal(h.data['text/html'],'sd');
});
test('collapsed, cross-editor, handled and unavailable clipboard copies stay native',()=>{
 for(const mutate of [h=>h.selection.isCollapsed=true,h=>h.selection.rangeCount=0,h=>h.range.endContainer=h.outside,h=>h.range.startContainer=h.outside,h=>h.event.defaultPrevented=true,h=>h.event.clipboardData=null]){
  const h=harness('asd');mutate(h);h.copy();assert.deepEqual(h.data,{});
 }
});

// Small DOM fixture for the recursive edge walk; the browser acceptance also
// exercises these shapes with real Range/Clipboard APIs and rich paste.
function node(tag,...children){
 const n=tag==='#text'?{nodeType:3,data:children[0],childNodes:[]}:{nodeType:1,tagName:tag,childNodes:children};
 for(const child of n.childNodes)child.parent=n;
 Object.defineProperties(n,{firstChild:{get:()=>n.childNodes[0]},lastChild:{get:()=>n.childNodes.at(-1)}});
 n.remove=()=>n.parent.childNodes.splice(n.parent.childNodes.indexOf(n),1);
 return n;
}
function trim(fragment){
 const start=app.indexOf('function trimRichNoteClipboard('),end=app.indexOf('\nfunction copyRichNoteSelection(',start),context={};
 vm.createContext(context);vm.runInContext(app.slice(start,end),context);context.trimRichNoteClipboard(fragment);return fragment;
}
test('HTML edge cleanup removes empty paragraphs and breaks, preserves inner empty lines and formatting',()=>{
 const bold=node('B',node('#text','asd')),middle=node('DIV',bold,node('BR'),node('BR'),node('#text','next'));
 const fragment=node('DIV',node('P',node('BR')),node('DIV',node('BR')),middle,node('P',node('BR')));
 trim(fragment);assert.deepEqual(fragment.childNodes,[middle]);assert.equal(middle.childNodes[0],bold);assert.equal(middle.childNodes.length,4);
});
test('image-only selections and meaningful leading/trailing spaces survive HTML cleanup',()=>{
 const image=node('IMG'),left=node('#text','  left'),right=node('#text','right  '),fragment=node('DIV',left,image,right);
 trim(fragment);assert.equal(left.data,'  left');assert.equal(right.data,'right  ');assert.equal(fragment.childNodes[1],image);
 assert.equal(trim(node('DIV',node('P',image))).firstChild.firstChild,image);
});
test('HTML whitespace-only newline boundaries are removed from the cloned fragment',()=>{
 const value=node('#text','\n\nasd\n'),fragment=node('DIV',value);trim(fragment);assert.equal(value.data,'asd');
 const empty=node('DIV',node('BR'));trim(empty);assert.equal(empty.childNodes.length,0);
});
test('clipboard padding containing spaces or non-breaking spaces is removed at both edges',()=>{
 const text=node('#text','one line'),fragment=node('DIV',node('#text','  '),node('P',node('#text','\u00a0')),node('DIV',text),node('P',node('#text','\u00a0')));
 trim(fragment);assert.equal(fragment.childNodes.length,1);assert.equal(fragment.firstChild.firstChild,text);
});
