async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/gifts');await page.getByRole('tab',{name:'礼物与充值',exact:true}).waitFor();
  await page.getByRole('button',{name:'新建充值包',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('充值包名称',{exact:true}).fill('书香初遇');await dialog.getByRole('spinbutton').fill('1000');
  if(await dialog.getByRole('textbox').count()!==2)throw Error('Recharge form exposes unexpected internal fields');await dialog.getByRole('button',{name:'取 消',exact:true}).click();
  await page.getByRole('tab',{name:'老师与合同',exact:true}).click();await page.getByRole('button',{name:'登记合同版本',exact:true}).click();await page.getByLabel('名师',{exact:true}).waitFor();await page.getByRole('button',{name:'上传私有附件',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'取 消',exact:true}).click();
  await page.getByRole('tab',{name:'充值与退款',exact:true}).click();await page.getByRole('columnheader',{name:'订单编号'}).waitFor();
  await page.getByRole('tab',{name:'老师分成结算',exact:true}).click();await page.getByRole('button',{name:'生成月结单',exact:true}).click();await page.getByLabel('合作方',{exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'取 消',exact:true}).click();
  await page.getByRole('tab',{name:'礼物与充值',exact:true}).click();await page.screenshot({path:'outputs/m08-final-delivery/admin-gifts.png',fullPage:true});
  await page.goto('http://127.0.0.1:5173/guide?workflow=gifts');await page.getByRole('heading',{name:'配置直播礼物、退款与老师分成',exact:true}).waitFor();await page.getByText('生成月结与复核',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join(';'));return{checks:6,passed:6,pageErrors:0};
}
