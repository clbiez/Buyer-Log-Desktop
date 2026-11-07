'use strict';
const assert=require('node:assert/strict'),path=require('node:path');

module.exports=async function checkSharedUI(page,out,label){
  const results={geometry:[],screenshots:[],baselineGeometryIssues:[]};
  await page.emulateMedia({reducedMotion:'reduce'});
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
  // Dynamic fallback, including hidden UI; user data and editable content stay intact.
  await page.evaluate(()=>{
    applyLanguage('en');
    const el=document.createElement('section');el.id='shared-ui-guard-probe';
    el.innerHTML='<button title="Uygula">Kaydet</button><span hidden>Kaydet</span><textarea>Kaydet</textarea><div data-no-i18n>Kaydet</div><table><tbody><tr><td>Kaydet</td></tr></tbody></table>';
    document.body.append(el);
  });
  await settle();
  assert.deepEqual(await page.locator('#shared-ui-guard-probe').evaluate(el=>[el.querySelector('button').textContent,el.querySelector('button').title,el.querySelector('span').textContent,el.querySelector('textarea').value,el.querySelector('[data-no-i18n]').textContent,el.querySelector('td').textContent]),['Save','Apply','Save','Kaydet','Kaydet','Kaydet']);
  await page.evaluate(()=>{BLI18n.setLanguage('tr');});
  assert.equal(await page.locator('#shared-ui-guard-probe button').textContent(),'Kaydet');
  await page.locator('#shared-ui-guard-probe').evaluate(el=>el.remove());results.i18n=true;
  results.repeatedScrollMutations=await page.evaluate(async()=>{
    const table=document.getElementById('cpTable'),wrap=table.closest('.tablewrap');let count=0;
    const observer=new MutationObserver(records=>{count+=records.filter(r=>r.target.classList.contains('blGroupFollowLabel')).length;});
    observer.observe(table.tHead,{subtree:true,attributes:true,attributeFilter:['style']});
    wrap.dispatchEvent(new Event('scroll'));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));observer.disconnect();return count;
  });
  if(label.startsWith('after'))assert.equal(results.repeatedScrollMutations,0,'unchanged heading styles must not mutate the real DOM');
  for(const lang of ['tr','en']){
    await page.evaluate(lang=>applyLanguage(lang),lang);await settle();
    for(const module of ['cp','orders']){
      await page.evaluate(module=>switchTab(module),module);await settle();
      for(const scale of ['compact','large'])for(const count of [0,3,9]){
        await page.evaluate(scale=>applyUiFontStep(scale==='compact'?3:1,{persist:false}),scale);
        await page.waitForTimeout(150);await settle();
        await page.evaluate(({module,scale,count})=>{
          setFreeze(module,count);
          if(count)setFreezePane(module,320);freezeRefreshTable(module+'Table',module);BLFlushTableRenders();
        },{module,scale,count});await page.waitForTimeout(150);await settle();
        await page.evaluate(module=>{
          const wrap=document.getElementById(module+'Table').closest('.tablewrap');wrap.scrollLeft=700;wrap.scrollTop=250;wrap.dispatchEvent(new Event('scroll'));
          document.dispatchEvent(new PointerEvent('pointerup'));
        },module);await settle();
        const geometry=await page.evaluate(module=>{
          const table=document.getElementById(module+'Table'),wrap=table.closest('.tablewrap'),viewport=wrap.getBoundingClientRect();
          const pane=Number(table.getAttribute('data-bl-freeze-pane'))||0;
          const edge=table.tHead.querySelector('tr.colRow th.frzLEdge');
          const freezeRight=edge?Math.min(edge.getBoundingClientRect().right,pane?viewport.left+wrap.clientLeft+pane:Infinity):viewport.left;
          const groups=[...table.tHead.querySelectorAll('tr.groupRow th[data-grp]')].map(th=>{
            const label=th.querySelector(':scope > .blGroupFollowLabel');if(!label)return null;
            const frozen=th.classList.contains('frzL'),view=frozen?{left:viewport.left,right:Math.min(viewport.right,pane?viewport.left+wrap.clientLeft+pane:Infinity)}:viewport;
            const expected=BLTableGroupTracking.computeTrack(th.getBoundingClientRect(),view,freezeRight,frozen);
            const css=label.style,dx=new DOMMatrix(getComputedStyle(label).transform).m41;
            return {expected,visibility:css.visibility,maxWidth:parseFloat(css.maxWidth),dx};
          }).filter(Boolean);
          const headers=[...table.tHead.querySelectorAll('tr.colRow th')],row=table.querySelector('tbody tr[data-id]');
          const frozenAlignment=headers.flatMap((th,i)=>th.classList.contains('frzL')&&row?.children[i]?[Math.abs(th.getBoundingClientRect().left-row.children[i].getBoundingClientRect().left)]:[]);
          return {groups,frozenAlignment,groupHeight:table.tHead.querySelector('tr.groupRow').offsetHeight,columnTops:headers.map(th=>parseFloat(th.style.top)),sticky:[...table.tHead.querySelectorAll('tr.colRow th.frzL')].every(th=>getComputedStyle(th).position==='sticky'),bodyAnimations:document.getElementById('view-'+module).getAnimations({subtree:true}).filter(a=>a.playState==='running').length};
        },module);
        assert.ok(geometry.groups.length);assert.ok(geometry.sticky);
        for(const delta of geometry.frozenAlignment)assert.ok(delta<=1,'frozen header/body alignment: '+delta);
        if(label.startsWith('after'))for(const top of geometry.columnTops)assert.equal(top,geometry.groupHeight,'sticky column row must clear the group band');
        for(const g of geometry.groups){
          const detail=JSON.stringify({lang,module,scale,count,g});
          if(label.startsWith('before')){
            if(g.visibility!==(g.expected.visible?'visible':'hidden')||(g.expected.visible&&(Math.abs(g.dx-g.expected.dx)>1||Math.abs(g.maxWidth-g.expected.maxWidth)>1)))results.baselineGeometryIssues.push(JSON.parse(detail));
            continue;
          }
          assert.equal(g.visibility,g.expected.visible?'visible':'hidden',detail);
          if(g.expected.visible){
            assert.ok(Math.abs(g.dx-g.expected.dx)<=1,detail);
            // Fractional table widths can cross a floor() boundary after layout.
            assert.ok(Math.abs(g.maxWidth-g.expected.maxWidth)<=1,detail);
          }
        }
        results.geometry.push({lang,module,scale,count,...geometry});
        if(scale==='large'&&count===3){const file=`${label}-${module}-${lang}.png`;await page.screenshot({path:path.join(out,file)});results.screenshots.push(file);}
      }
      await page.evaluate(module=>openNotesEditor(state[module].rows[0]._id,'Notes'),module);
      await page.waitForFunction(()=>document.querySelector('.blWorkspaceBlur').dataset.blur==='dialog');await settle();
      assert.equal(await page.locator('.blWorkspaceBlur').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      const file=`${label}-${module}-${lang}-modal.png`;await page.screenshot({path:path.join(out,file)});results.screenshots.push(file);
      // A nested native dialog keeps one blur layer after the notes window closes.
      await page.evaluate(()=>{const d=document.createElement('dialog');d.id='shared-ui-native';d.textContent='Demo';document.body.append(d);d.showModal();});await settle();
      await page.evaluate(()=>document.querySelector('#_notesEditorModal button')?.click());
      assert.equal(await page.locator('.blWorkspaceBlur').getAttribute('data-blur'),'dialog');
      await page.locator('#shared-ui-native').evaluate(el=>el.remove());await page.keyboard.press('Escape');await settle();
      await page.waitForFunction(()=>document.querySelector('.blWorkspaceBlur').dataset.blur==='');
    }
  }
  // The unchanged image path must preserve original bytes for table, zoom and clipboard.
  results.image=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#035';ctx.fillRect(0,0,512,256);ctx.fillStyle='#fff';ctx.fillRect(30,30,400,100);
    const source=canvas.toDataURL('image/png'),input={source,modelId:'SYNTHETIC',colourCode:'DEMO'};
    const img=document.createElement('img');Object.assign(img.dataset,{src:source,modelId:input.modelId,colourCode:input.colourCode});document.body.append(img);
    const url=await BLModelImageCache.bind(img);await img.decode();
    const result={tableOriginal:url===source,zoomOriginal:(await BLModelImageCache.preloadOriginal(input))===source,clipboardOriginal:(await BLModelImageCache.getClipboardDataUrl(input))===source,width:img.naturalWidth};img.remove();return result;
  });
  assert.deepEqual(results.image,{tableOriginal:true,zoomOriginal:true,clipboardOriginal:true,width:512});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{document.documentElement.dataset.rail='min';});
  await page.locator('.rail').hover();await page.waitForFunction(()=>document.querySelector('.blWorkspaceBlur').dataset.blur==='rail');
  await page.mouse.move(1400,900);await page.waitForFunction(()=>document.querySelector('.blWorkspaceBlur').dataset.blur==='');
  results.motion=true;
  return results;
};
