async page=>{
await page.setViewportSize({width:390,height:844});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
if(!page.url().endsWith('/pages/marketing/coupons'))await page.goto('http://127.0.0.1:9081/#/pages/marketing/coupons');await page.getByText('领券中心',{exact:true}).waitFor();await page.getByText('我的券',{exact:true}).click();await page.getByText('暂无优惠券',{exact:true}).waitFor();await page.getByText('领券中心',{exact:true}).click();await page.screenshot({path:'outputs/m09-marketing/app-coupons.png',fullPage:true});
await page.goto('http://127.0.0.1:9081/#/pages/marketing/community');for(const title of ['我的投稿','置顶申请','案例授权','精选研习','主题征文']){await page.getByText(title,{exact:true}).click();await page.getByText(title==='主题征文'?'新一期征文正在酝酿':title==='精选研习'?'精选研习正在整理':'暂无记录',{exact:true}).waitFor();}await page.screenshot({path:'outputs/m09-marketing/app-community.png',fullPage:true});
await page.goto('http://127.0.0.1:9081/#/pages/profile/privacy');await page.getByText('个性化内容推荐',{exact:true}).waitFor();
await page.goto('http://127.0.0.1:9081/#/pages/profile/library?kind=practice');await page.getByText('＋ 写日志',{exact:true}).waitFor();let caseFormChecked=false;const button=page.getByText('授权课程案例',{exact:true}).first();if(await button.count()){await button.click();await page.getByText('选定一段自己的心得',{exact:true}).waitFor();await page.getByText('提交授权与审核',{exact:true}).waitFor();caseFormChecked=true;}
await page.setViewportSize({width:320,height:740});await page.goto('http://127.0.0.1:9081/#/pages/marketing/coupons');await page.getByText('领券中心',{exact:true}).waitFor();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Coupon screen overflow at 320px');
if(errors.length)throw Error(errors.join(';'));return{checks:caseFormChecked?10:9,passed:caseFormChecked?10:9,pageErrors:errors.length,smallWidthOverflow:false,caseFormChecked,submittedBusinessData:false,backend:'local API proxy'};
}
