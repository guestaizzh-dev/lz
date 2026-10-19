async page=>{
let checks=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:9081/#/pages/membership/gifts');await page.getByText('一份书香，伴你研习',{exact:true}).waitFor();await page.getByText('暂无可领取的签名礼遇',{exact:true}).waitFor();checks++;
await page.getByText('领取记录',{exact:true}).click();await page.getByText('还没有领取记录',{exact:true}).waitFor();checks++;
await page.setViewportSize({width:320,height:740});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Gift page overflow at 320px');checks++;await page.screenshot({path:'outputs/m09-remaining/app-member-gifts.png',fullPage:true});
await page.goto('http://127.0.0.1:9081/#/pages/membership/index');await page.getByText('签名书籍与文创礼遇 ›',{exact:true}).click();await page.getByText('一份书香，伴你研习',{exact:true}).waitFor();checks++;
if(errors.length)throw Error(errors.join(';'));return{checks,passed:checks,pageErrors:0,submittedBusinessData:false,backend:'local API proxy',coverage:'real membership entry, gift/claim empty states and narrow layout; stock/payment/fulfilment tested in isolated PostgreSQL'};
}
