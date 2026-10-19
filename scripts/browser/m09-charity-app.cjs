async page=>{
const errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;
await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:9081/#/pages/marketing/charity');await page.getByText('让经典走近更多人',{exact:true}).waitFor();await page.getByText('公益计划',{exact:true}).waitFor();checks++;
await page.setViewportSize({width:320,height:740});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('charity page overflows at 320px');checks++;await page.screenshot({path:'outputs/m09-remaining/app-charity.png',fullPage:true});
for(const path of ['pages/index/index','pages/teacher/index']){await page.goto('http://127.0.0.1:9081/#/'+path);await page.locator('.page').waitFor();await page.waitForFunction(()=>!document.querySelector('.sponsored-card'));checks++;}
if(errors.length)throw Error(errors.join(';'));return{checks,passed:checks,pageErrors:0,smallWidthOverflow:false,backend:'local API proxy',submittedBusinessData:false,coverage:'charity public empty state and disabled advertising; advertising payment/withdrawal covered by isolated database tests'};
}
