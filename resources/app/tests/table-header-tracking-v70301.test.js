'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..','public');
const js=fs.readFileSync(path.join(root,'table-header-tracking.js'),'utf8');
const css=fs.readFileSync(path.join(root,'table-header-tracking.css'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function geometry(){
  const window={};
  vm.runInNewContext(js,{window,document:{readyState:'loading',addEventListener(){}}});
  return window.BLTableGroupTracking.computeTrack;
}
test('group captions track the visible center and respect frozen columns',()=>{
  const position=geometry(),v={left:0,right:400};
  assert.equal(position({left:0,right:400},v,0,false).dx,0);
  assert.equal(position({left:-500,right:500},v,0,false).dx,200);
  assert.equal(position({left:-500,right:500},v,200,false).dx,300);
  assert.equal(position({left:-500,right:500},v,200,false).maxWidth,188);
  assert.equal(position({left:20,right:140},v,200,false).visible,false);
  assert.equal(position({left:20,right:140},v,200,true).visible,true);
});
test('scroll, rerender and geometry changes repaint the shared header',()=>{
  assert.match(js,/tr\.groupRow th\[data-grp\]/);
  assert.match(js,/new MutationObserver/);
  assert.match(js,/addEventListener\('scroll'/);
  assert.match(js,/ResizeObserver/);
  assert.match(js,/frzLEdge/);
  assert.doesNotMatch(js,/scrollLeft\s*=/);
});
test('the header-only theme layer is mounted for all three main grids',()=>{
  assert.match(index,/href="table-header-tracking\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(index,/src="table-header-tracking\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(css,/:is\(#cpTable,#ordersTable,#kolTable\) thead tr\.colRow th:not\(:last-child\)/);
  assert.match(css,/border-inline-end:1px solid var\(--ui-row-divider\)!important/);
  assert.doesNotMatch(css,/tbody|tfoot/);
});
