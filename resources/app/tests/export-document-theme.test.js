'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const PUBLIC=path.join(__dirname,'../public');
test('supplier HTML embeds the frozen packaged fonts without reading UI style sheets',async()=>{
 const expected=require('./fixtures/export-document-fonts.json'),fetched=[];
 const document={get styleSheets(){throw Error('Document fonts cannot depend on UI CSS');}};
 const context={document,URL,Blob,location:{href:'http://buyerlog.local/'},BLLicenseAtlasEngine:require('../public/license-atlas-engine'),fetch:async url=>{assert.equal(url.origin,'http://buyerlog.local');const src=url.pathname.slice(1),bytes=fs.readFileSync(path.join(PUBLIC,src));fetched.push({src,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});return {ok:true,arrayBuffer:async()=>bytes};},FileReader:class{readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:font/woff2;base64,'+Buffer.from(b).toString('base64');this.onload();});}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(PUBLIC,'license-supplier-atlas.js'),'utf8'),context);
 const css=await context.BLLicenseSupplierAtlas.loadFonts();assert.deepEqual(fetched,expected);assert.equal((css.match(/@font-face/g)||[]).length,10);assert.equal((css.match(/data:font\/woff2;base64,/g)||[]).length,10);assert.match(css,/U\+0100-02BA/);assert.match(css,/U\+0131/);assert.doesNotMatch(css,/https?:\/\//);
 await context.BLLicenseSupplierAtlas.loadFonts();assert.equal(fetched.length,10,'font fetches are cached');
});
test('LCW AI palette remains equal to the independent export reference',()=>{const theme=require('../server/lib/lcwai-output/output-theme');assert.deepEqual(theme.theme().colors,require('./fixtures/export-document-palette.json'));assert.equal(theme.theme().source,'export-document-palette.json');assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../server/lib/lcwai-output/output-theme.js'),'utf8'),/readDesignTokens|DESIGN_CSS|APP_CSS/);});
