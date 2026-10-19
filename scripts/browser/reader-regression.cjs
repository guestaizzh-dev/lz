// Prepare with prepare-reader-regression.mjs, then run the generated .runtime file in Playwright CLI.
async page => {
  await page.goto('about:blank');
  await page.addScriptTag({content:'__READER_SOURCE__'});
  await page.setViewportSize({width:390,height:844});
  await page.addStyleTag({content:'__READER_STYLE__'});
  const result=await page.evaluate(()=>{
    const roots=[0,1].map(()=>{const root=document.createElement('div');root.className='academy-reader';document.body.append(root);return root;});
    const readers=roots.map(root=>AcademyReader.create(root,()=>{}));
    const payload={blocks:[{id:'one',type:'paragraph',text:'上善若水，水善利万物而不争。'}],fontSize:16,annotations:[],selectionMode:'native'};
    readers.forEach(reader=>reader.render(payload));
    const node=roots[0].querySelector('p').firstChild,range=document.createRange();range.setStart(node,0);range.setEnd(node,4);
    getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));
    if(getSelection().toString()!=='上善若水'||roots[0].querySelector('.reader-selection-tools').hidden)throw Error('Another reader cleared the active selection');
    readers[1].render(payload);if(getSelection().toString()!=='上善若水')throw Error('Unrelated rendering cleared selection');
    readers[1].destroy();if(getSelection().toString()!=='上善若水')throw Error('Unrelated unmount cleared selection');
    readers[0].clearSelection();if(getSelection().toString())throw Error('Owned selection was not cleared');
    readers[0].destroy();roots.forEach(root=>root.remove());
    return{tests:4,passed:4,failed:0};
  });
  await page.evaluate(()=>{
    const root=document.createElement('div');root.id='touch';root.className='academy-reader';root.style.padding='20px';document.body.append(root);globalThis.readerActions=[];
    globalThis.touchReader=AcademyReader.create(root,data=>readerActions.push(data));
    touchReader.render({blocks:[{id:'first',type:'paragraph',text:'上善😀若水，水善利万物而不争。'},{id:'second',type:'paragraph',text:'知行相照，静心研习。'},{id:'media',type:'audio',text:'',mediaId:'test'}],fontSize:20,annotations:[],selectionMode:'touch'});
  });
  const first=await page.locator('#touch p').first().boundingBox();
  await page.mouse.move(first.x+24,first.y+16);await page.mouse.down();await page.waitForTimeout(460);await page.mouse.up();
  if(await page.locator('#touch .reader-selection-tools').isHidden())throw Error('Long press did not open the single custom menu');
  if(await page.evaluate(()=>!!getSelection().toString()))throw Error('Touch mode leaked a native selection');
  const target=await page.locator('[data-reader-block="second"]').evaluate(p=>{const r=document.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,4);const box=r.getBoundingClientRect();return{x:box.right-1,y:box.top+box.height/2};});
  const handle=await page.locator('#touch .reader-selection-end').boundingBox();await page.mouse.move(handle.x+22,handle.y+22);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.up();
  await page.getByRole('button',{name:'笔记',exact:true}).click();
  const captured=await page.evaluate(()=>readerActions.at(-1));
  if(captured.action!=='note'||captured.selections.length!==2||captured.selections[1].blockId!=='second')throw Error('Handle dragging did not preserve a cross-paragraph snapshot');
  if(captured.selections.some(s=>/[\uD800-\uDBFF]$/.test(s.quote)||/^[\uDC00-\uDFFF]/.test(s.quote)))throw Error('Handle split a surrogate pair');
  await page.mouse.move(first.x+24,first.y+16);await page.mouse.down();await page.waitForTimeout(460);await page.mouse.up();
  const menus=await page.locator('.reader-selection-tools:not([hidden])').count();if(menus!==1)throw Error('More than one selection menu');
  if(!await page.locator('#touch audio').evaluate(el=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))))throw Error('Reader blocked the media context menu');
  if(await page.locator('[data-reader-block="first"]').evaluate(el=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))))throw Error('Native text menu was not suppressed in touch mode');
  await page.keyboard.press('Escape');if(!await page.locator('#touch .reader-selection-tools').isHidden())throw Error('Escape did not dismiss selection');
  async function selectAgain(){await page.mouse.move(first.x+24,first.y+16);await page.mouse.down();await page.waitForTimeout(460);await page.mouse.up();if(await page.locator('#touch .reader-selection-tools').isHidden())throw Error('Selection did not reopen');}
  await selectAgain();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(!await page.locator('#touch .reader-selection-tools').isHidden())throw Error('Backgrounding left a selection menu');
  await selectAgain();await page.locator('#touch').evaluate(root=>root.dispatchEvent(new PointerEvent('pointerdown',{isPrimary:false,bubbles:true,pointerId:22,button:0})));if(!await page.locator('#touch .reader-selection-tools').isHidden())throw Error('A second touch did not cancel selection');
  await selectAgain();await page.locator('#touch .reader-selection-end').evaluate(handle=>handle.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true})));if(!await page.locator('#touch .reader-selection-tools').isHidden())throw Error('Cancelled handle left a menu');
  await page.locator('#touch').evaluate(root=>root.dispatchEvent(new PointerEvent('pointerdown',{isPrimary:true,bubbles:true,pointerId:23,button:0,clientX:20,clientY:20})));await page.locator('#touch').evaluate(root=>root.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:23})));await page.waitForTimeout(460);if(!await page.locator('#touch .reader-selection-tools').isHidden())throw Error('Cancelled press opened a delayed menu');

  await page.evaluate(()=>{
    const blocks=[{id:'stable',type:'paragraph',text:'上善若水。'.repeat(800)},{id:'quoted',type:'quote',text:'道法自然。'}];
    const note={blockId:'stable',rangeStart:0,rangeEnd:4};
    for(const templateCode of ['CLASSIC','INK','PLAIN']){
      touchReader.render({blocks,fontSize:24,annotations:[note],selectionMode:'touch',templateCode});
      const root=document.querySelector('#touch');
      if(!root.classList.contains('reader-template-'+templateCode.toLowerCase()))throw Error('Template class missing');
      if(root.querySelector('[data-reader-block=stable]').textContent!==blocks[0].text||root.querySelector('mark').textContent!=='上善若水')throw Error('Template changed paragraph IDs or note snapshots');
      if(root.scrollWidth>root.clientWidth+1)throw Error('Long article overflowed');
    }
    if(document.querySelectorAll('#touch [data-reader-block]').length!==2)throw Error('Templates duplicated content');
  });
  await page.evaluate(()=>touchReader.destroy());
  return{tests:result.tests+14,passed:result.passed+14,failed:0};
}
