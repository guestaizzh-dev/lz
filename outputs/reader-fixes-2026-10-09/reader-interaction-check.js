async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.setViewportSize({width:390,height:844});
  await page.setContent('<html><body style="margin:20px;background:#F4F0E7"><div id="reader" class="academy-reader"></div></body></html>');
  await page.addStyleTag({path:'C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/static/reader/reader.css'});
  await page.addScriptTag({path:'C:/Users/l6658/Documents/ChatGPT/道学书院/apps/mobile/static/reader/reader-engine.js'});
  await page.evaluate(()=>{
    window.actions=[];
    window.payload={fontSize:18,selectionMode:'touch',blocks:[{id:'first',type:'quote',text:'致虚极，守静笃。万物并作，吾以观复。'},{id:'second',type:'paragraph',text:'读完这一段，留意观与复的关系，经典不是把一句话直接当作所有生活问题的答案。'},{id:'third',type:'paragraph',text:'Learning notes preserve selected words and offsets. 😀'}],annotations:[{blockId:'second',rangeStart:2,rangeEnd:5}]};
    window.reader=AcademyReader.create(document.querySelector('#reader'),data=>window.actions.push(data));
    window.reader.render(window.payload);
  });
  const point = async (id,offset) => page.evaluate(({id,offset})=>{
    const block=document.querySelector('[data-reader-block="'+id+'"]');
    const walk=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node;
    while(node=walk.nextNode()){if(offset<node.length){const r=document.createRange();r.setStart(node,offset);r.setEnd(node,offset+1);const b=r.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2};}offset-=node.length;}
  },{id,offset});
  const press = async (id,offset) => {const at=await point(id,offset);await page.mouse.move(at.x,at.y);await page.mouse.down();await page.waitForTimeout(480);await page.mouse.up();};
  await press('second',15);
  check(await page.locator('.reader-selection-tools').isVisible(),'long press should show one action menu');
  check(await page.evaluate(()=>window.getSelection().isCollapsed),'APP selection must not invoke Android native selection');
  const end=await page.locator('.reader-selection-end').boundingBox(),to=await point('third',18);
  await page.mouse.move(end.x+22,end.y+22);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();
  await page.screenshot({path:'outputs/reader-fixes-2026-10-09/cross-paragraph-selection.png'});
  await page.getByRole('button',{name:'笔记',exact:true}).click();
  let actions=await page.evaluate(()=>window.actions);
  check(actions[0]?.selections.length===2,'dragging end handle should extend across paragraphs');
  check(actions[0].selections[0].blockId==='second'&&actions[0].selections[1].blockId==='third','ranges must remain ordered');
  check(await page.evaluate(()=>window.actions.every(action=>action.selections.every(range=>range.quote===window.payload.blocks.find(block=>block.id===range.blockId).text.slice(range.rangeStart,range.rangeEnd)))),'quoted text must match persisted UTF16 offsets');
  await press('second',15);
  const start=await page.locator('.reader-selection-start').boundingBox(),from=await point('first',2);
  await page.mouse.move(start.x+22,start.y+22);await page.mouse.down();await page.mouse.move(from.x,from.y,{steps:12});await page.mouse.up();
  await page.getByRole('button',{name:'评论',exact:true}).click();
  actions=await page.evaluate(()=>window.actions);check(actions[1].selections[0].blockId==='first','start handle should extend backward across paragraphs');
  await press('first',3);await page.getByRole('button',{name:'复制',exact:true}).click();
  await press('third',10);await page.getByRole('button',{name:'划线',exact:true}).click();
  check((await page.evaluate(()=>window.actions.map(action=>action.action))).join(',')==='note,comment,copy,highlight','all four action buttons should emit preserved ranges');
  const scrollFrom=await point('second',10);await page.mouse.move(scrollFrom.x,scrollFrom.y);await page.mouse.down();await page.mouse.move(scrollFrom.x,scrollFrom.y+35);await page.waitForTimeout(480);await page.mouse.up();
  check(!(await page.locator('.reader-selection-tools').isVisible()),'scroll gesture must cancel long press');
  await press('first',3);await page.evaluate(()=>window.reader.render({...window.payload,fontSize:20}));
  check(!(await page.locator('.reader-selection-tools').isVisible()),'rerender must clear selection');
  await page.evaluate(()=>{window.reader.render({...window.payload,selectionMode:'native'});const p=document.querySelector('[data-reader-block="first"]');const r=document.createRange();r.selectNodeContents(p);window.getSelection().addRange(r);});
  await page.waitForTimeout(100);check(await page.locator('.reader-selection-tools').isVisible(),'desktop native text selection should remain available');
  await page.evaluate(()=>window.reader.destroy());
  check(await page.locator('#reader').textContent()==='','destroy should release reader content');
  console.log('PASS: long press, both handles, cross-paragraph offsets, copy/note/comment/highlight, scroll cancellation, rerender, desktop selection');
}
