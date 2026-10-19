async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByText('礼物余额',{exact:true}).waitFor();await page.getByText('书香点 · 与免费积分独立',{exact:true}).waitFor();
  await page.getByText('余额明细',{exact:true}).click();await page.getByText('暂无余额记录',{exact:true}).waitFor();
  await page.getByText('订单与退款',{exact:true}).click();await page.getByText('暂无充值订单',{exact:true}).waitFor();
  await page.getByText('充值',{exact:true}).click();await page.getByText('暂无可购买的充值包',{exact:true}).waitFor();
  await page.screenshot({path:'outputs/m08-final-delivery/app-wallet.png',fullPage:true,animations:'disabled'});
  await page.goto('http://127.0.0.1:9071/#/pages/course/downloads');await page.getByText('请在App查看本机课件',{exact:true}).waitFor();await page.getByText('设备授权',{exact:true}).click();await page.getByText('暂无有效设备授权',{exact:true}).waitFor();
  await page.goto('http://127.0.0.1:9071/#/pages/booking/consultations');await page.getByText('暂无在线咨询',{exact:true}).waitFor();
  await page.goto('http://127.0.0.1:9071/#/pages/booking/consult');await page.getByText('在线音视频咨询请使用Android或iOS App，网页暂不开放设备采集。',{exact:true}).waitFor();
  await page.setViewportSize({width:320,height:740});await page.goto('http://127.0.0.1:9071/#/pages/profile/gifts');await page.getByText('书香点 · 与免费积分独立',{exact:true}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('Wallet has horizontal page overflow at 320px');
  if(errors.length)throw Error(errors.join(';'));return{checks:7,passed:7,pageErrors:0,smallWidthOverflow:false,backend:'local HTTP/PostgreSQL proxy, no production writes'};
}
